const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const db = require('../db');
const { checkAdmin } = require('../middleware/auth');
const { upload, uploadPdf, memoryUpload } = require('../config/multer');
const { getModel, scanParcelLabel } = require('../config/ai');
const { uploadFile, deleteCloudinaryFile } = require('../config/cloudinary');

// Protect all admin APIs with checkAdmin
router.use(checkAdmin);

// 🔍 1. AI Parcel Label Scanner with Multi-Model & Multi-Key Cascade
router.post('/scan-ai-label', memoryUpload.single('labelImage'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, msg: 'No image uploaded' });

        const result = await scanParcelLabel(req.file.buffer, req.file.mimetype);
        return res.json(result);
    } catch (err) {
        console.error("AI Scan API Error:", err);
        return res.json({ 
            success: false, 
            msg: err.message || 'AI scanning error. Please try again.' 
        });
    }
});

// 🔄 2. Match Confirm DB Mapping
router.get('/match-confirm-db', async (req, res) => {
    try {
        const result = await db.query('SELECT order_date, member_id, name, pv, amount FROM orders_master');
        
        let dbRowsMap = {};
        
        result.rows.forEach(row => {
            if (row.name) {
                const rawName = row.name.toUpperCase().trim();
                const cleanKey = rawName.replace(/[^A-Z0-9]/g, '');
                
                const rowDataObj = {
                    dateStr: row.order_date || '',
                    memberId: row.member_id || '',
                    pv: row.pv || '0',
                    amount: row.amount || '0'
                };

                dbRowsMap[cleanKey] = rowDataObj;
                dbRowsMap[rawName] = rowDataObj;
            }
        });

        res.json({ success: true, dbData: dbRowsMap });
    } catch (error) {
        console.error("DB Match Fetch Error:", error);
        res.json({ success: false, msg: error.message });
    }
});

// 📥 3. Upload Orders Master Excel
router.post('/upload-orders-excel', upload.single('excelFile'), async (req, res) => {
    try {
        if (!req.file) return res.json({ success: false, msg: "Please select an Excel file." });

        const filePath = req.file.path;
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(filePath);
        const worksheet = workbook.getWorksheet(1) || workbook.worksheets[0];

        let addedCount = 0;
        let skippedCount = 0;

        function formatDateObj(d) {
            const day = d.getDate();
            let suffix = 'th';
            if (day === 1 || day === 21 || day === 31) suffix = 'st';
            else if (day === 2 || day === 22) suffix = 'nd';
            else if (day === 3 || day === 23) suffix = 'rd';
            const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
            return `${day}${suffix} ${months[d.getMonth()]} ${d.getFullYear()}`;
        }

        const parseExcelDate = (cell) => {
            if (!cell || cell.value === null || cell.value === undefined) return '';

            let val = cell.value;

            if (val instanceof Date) {
                return formatDateObj(val);
            }

            if (typeof val === 'object') {
                if (val.result instanceof Date) return formatDateObj(val.result);
                if (val.result) val = val.result;
                else if (cell.text) val = cell.text;
            }

            let rawStr = cell.text ? String(cell.text).trim() : String(val).trim();
            let cleanDateText = rawStr.replace(/(\d+)(st|nd|rd|th)/i, '$1');

            let parsedDate = new Date(cleanDateText);
            if (!isNaN(parsedDate.getTime())) {
                return formatDateObj(parsedDate);
            }

            return rawStr;
        };

        if (worksheet) {
            for (let rowNumber = 3; rowNumber <= worksheet.rowCount; rowNumber++) {
                const row = worksheet.getRow(rowNumber);

                const dateCell = row.getCell(2);
                const memberId = row.getCell(5).text ? row.getCell(5).text.trim().toUpperCase() : '';
                const name = row.getCell(6).text ? row.getCell(6).text.trim().toUpperCase() : '';
                const pv = row.getCell(8).value ? row.getCell(8).value.toString().trim() : '0';
                const amount = row.getCell(9).value ? row.getCell(9).value.toString().trim() : '0';

                if (name && name !== 'NAME') {
                    const formattedDate = parseExcelDate(dateCell);

                    const insertQuery = `
                        INSERT INTO orders_master (order_date, member_id, name, pv, amount)
                        VALUES ($1, $2, $3, $4, $5)
                        ON CONFLICT (member_id, name, order_date, pv, amount) DO NOTHING
                        RETURNING id;
                    `;

                    const result = await db.query(insertQuery, [formattedDate, memberId, name, pv, amount]);
                    if (result.rows.length > 0) {
                        addedCount++;
                    } else {
                        skippedCount++;
                    }
                }
            }
        }

        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        const allOrders = await db.query('SELECT * FROM orders_master ORDER BY id DESC');
        res.json({
            success: true,
            msg: `🎉 ${addedCount} નવી એન્ટ્રી ઉમેરાઈ! (${skippedCount} ડુપ્લિકેટ એન્ટ્રી હટાવી દીધી)`,
            orders: allOrders.rows
        });

    } catch (error) {
        console.error("Order Excel Import Error:", error);
        res.json({ success: false, msg: error.message });
    }
});

// ✏️ 4. Update Single Order
router.post('/update-order/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { orderDate, memberId, name, pv, amount } = req.body;

        const updateQuery = `
            UPDATE orders_master 
            SET order_date = $1, member_id = $2, name = $3, pv = $4, amount = $5
            WHERE id = $6
            RETURNING *;
        `;

        await db.query(updateQuery, [
            (orderDate || '').trim(),
            (memberId || '').toUpperCase().trim(),
            (name || '').toUpperCase().trim(),
            (pv || '0').toString().trim(),
            (amount || '0').toString().trim(),
            id
        ]);

        const allOrders = await db.query('SELECT * FROM orders_master ORDER BY id DESC');
        res.json({ success: true, msg: "Order updated successfully", orders: allOrders.rows });
    } catch (err) {
        console.error("Update Order Error:", err);
        res.json({ success: false, msg: err.message });
    }
});

// 🗑️ 5. Delete Single Order
router.delete('/delete-order/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await db.query('DELETE FROM orders_master WHERE id = $1', [id]);

        const allOrders = await db.query('SELECT * FROM orders_master ORDER BY id DESC');
        res.json({ success: true, msg: "Order deleted successfully", orders: allOrders.rows });
    } catch (err) {
        console.error("Delete Order Error:", err);
        res.json({ success: false, msg: err.message });
    }
});

// 🗑️ 6. Delete Multiple Selected Orders
router.post('/delete-multiple-orders', async (req, res) => {
    try {
        const { ids } = req.body;

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.json({ success: false, msg: "No orders selected for deletion." });
        }

        const numericIds = ids.map(id => parseInt(id)).filter(id => !isNaN(id));

        if (numericIds.length === 0) {
            return res.json({ success: false, msg: "Invalid order IDs provided." });
        }

        const placeholders = numericIds.map((_, index) => `$${index + 1}`).join(', ');
        const deleteQuery = `DELETE FROM orders_master WHERE id IN (${placeholders})`;

        await db.query(deleteQuery, numericIds);

        const allOrders = await db.query('SELECT * FROM orders_master ORDER BY id DESC');
        
        res.json({ 
            success: true, 
            msg: `${numericIds.length} orders deleted successfully`, 
            orders: allOrders.rows 
        });
    } catch (err) {
        console.error("Bulk Delete Orders Error:", err);
        res.json({ success: false, msg: err.message });
    }
});

// 🗑️ 7. Delete Bulk Orders (ANY array syntax)
router.post('/delete-bulk-orders', async (req, res) => {
    try {
        const { ids } = req.body;

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.json({ success: false, msg: "No Entries Are Selected." });
        }

        await db.query('DELETE FROM orders_master WHERE id = ANY($1::int[])', [ids]);

        const allOrders = await db.query('SELECT * FROM orders_master ORDER BY id DESC');
        
        res.json({ 
            success: true, 
            msg: ` ${ids.length} Entry Deleted Successfully!`, 
            orders: allOrders.rows 
        });

    } catch (err) {
        console.error("Bulk Delete Orders Error:", err);
        res.json({ success: false, msg: "સર્વર એરર: " + err.message });
    }
});

// 🎟️ 8. Update Query Ticket Status
router.post('/queries/update-status', async (req, res) => {
    try {
        const { ticketId, status } = req.body;
        await db.query('UPDATE query_tickets SET status = $1 WHERE id = $2', [status, ticketId]);
        res.json({ success: true, msg: "Ticket status updated successfully" });
    } catch (error) {
        console.error("Update Query Status Error:", error);
        res.json({ success: false, msg: error.message });
    }
});

// 🔎 9. Fetch Details by Pincode or Name
router.get('/fetch-details', async (req, res) => {
    const pincode = req.query.pincode ? String(req.query.pincode).trim() : '';
    const name = req.query.name ? req.query.name.trim().toUpperCase() : '';
    
    let responseData = { success: false, memberId: '', city: '', state: '', address: '' };

    try {
        if (pincode.length > 0) {
            const pinResult = await db.query('SELECT * FROM pincodes WHERE pincode = $1 LIMIT 1', [pincode]);
            
            if (pinResult.rows.length > 0) {
                const pinRow = pinResult.rows[0];
                responseData.address = pinRow.address ? pinRow.address.toString().toUpperCase().trim() : '';
                responseData.city = pinRow.city ? pinRow.city.toString().toUpperCase().trim() : '';
                responseData.state = pinRow.state ? pinRow.state.toString().toUpperCase().trim() : '';
                responseData.success = true; 
            }
        }

        if (name.length > 0) {
            const nameResult = await db.query('SELECT member_id FROM main_database WHERE UPPER(name) LIKE $1 LIMIT 1', [`%${name}%`]);
            if (nameResult.rows.length > 0) {
                responseData.memberId = nameResult.rows[0].member_id ? nameResult.rows[0].member_id.toUpperCase().trim() : '';
                responseData.success = true;
            }
        }

        res.json(responseData);
    } catch (error) {
        console.error("Fetch Details Error:", error); 
        res.json({ success: false, msg: error.message });
    }
});

// 💾 10. Save Manual Parcel Entry
router.post('/save-manual', async (req, res) => {
    try {
        const item = req.body;
        const queryText = `
            INSERT INTO pending_entries (tracking, weight, length, breadth, height, name, mobile, pincode, city, state, address)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *
        `;
        const values = [item.tracking, item.weight, item.length, item.breadth, item.height, item.name, item.mobile, item.pincode, item.city, item.state, item.address];
        
        await db.query(queryText, values);
        const allEntries = await db.query('SELECT * FROM pending_entries ORDER BY id DESC');
        res.json({ success: true, entries: allEntries.rows });
    } catch (error) {
        console.error("Save Manual Entry Error:", error);
        res.json({ success: false, msg: error.message });
    }
});

// 📊 11. Export India Post Dispatch Excel
router.get('/export-excel', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM pending_entries ORDER BY id DESC');
        const dbEntries = result.rows;

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('ArticleDetails');

        sheet.columns = [
            { header: 'ARTICLE SERIAL NUMBER', key: 'sn' },
            { header: 'BARCODE NO india post', key: 'tracking' },
            { header: 'delhivary', key: 'blank1' },
            { header: 'PHYSICAL WEIGHT', key: 'weight' },
            { header: 'SHAPE OF ARTICLE', key: 'shape' },
            { header: 'LENGTH', key: 'length' },
            { header: 'BREADTH/DIAMETER', key: 'breadth' },
            { header: 'HEIGHT', key: 'height' },
            { header: 'PRIORITY FLAG', key: 'priority' },
            { header: 'DELIVERY INSTRUCTION', key: 'del_inst' },
            { header: 'INSTRUCTION RTS', key: 'rts' },
            { header: 'SENDER NAME', key: 's_name' },
            { header: 'SENDER ADD LINE 1', key: 's_add1' },
            { header: 'SENDER ADD LINE 2', key: 's_add2' },
            { header: 'SENDER ADD LINE 3', key: 's_add3' },
            { header: 'SENDER CITY', key: 's_city' },
            { header: 'SENDER STATE/UT', key: 's_state' },
            { header: 'SENDER PINCODE', key: 's_pin' },
            { header: 'SENDER EMAIL ID', key: 's_email' },
            { header: 'RECEIVER NAME', key: 'r_name' },
            { header: 'RECEIVER ADD LINE 1', key: 'r_add1' },
            { header: 'RECEIVER ADD LINE 2', key: 'r_add2' },
            { header: 'RECEIVER ADD LINE 3', key: 'r_add3' },
            { header: 'RECEIVER CITY', key: 'r_city' },
            { header: 'RECEIVER STATE/UT', key: 'r_state' },
            { header: 'RECEIVER PINCODE', key: 'r_pin' },
            { header: 'RECEIVER EMAILID', key: 'r_email' },
            { header: 'SENDER MOBILE NO', key: 's_mobile' },
            { header: 'RECEIVER MOBILE NO', key: 'r_mobile' },
            { header: 'CODR/COD', key: 'cod' },
            { header: 'VALUE FOR CODR/COD', key: 'cod_val' },
            { header: 'ACK', key: 'ack' },
            { header: 'PREPAYMENT CODE', key: 'prep_code' },
            { header: 'VALUE OF PREPAYMENT', key: 'prep_val' },
            { header: 'ALT ADDRESS FLAG', key: 'alt_add' },
            { header: 'INSURANCE TYPE', key: 'ins_type' },
            { header: 'VALUE OF INSURANCE', key: 'ins_val' }
        ];

        dbEntries.forEach((item, index) => {
            sheet.addRow({
                sn: index + 1,
                tracking: item.tracking,
                weight: item.weight,
                shape: 'NROL',
                length: item.length,
                breadth: item.breadth,
                height: item.height,
                priority: 'False',
                del_inst: 'NROL',
                rts: 'RTA',
                s_name: 'Avira LifeCare',
                s_add1: '103 The Galleria Bussiness Hub 2',
                s_add2: 'SURAT',
                s_city: 'SURAT',
                s_state: 'GUJRAT',
                s_pin: '395010',
                r_name: item.name,
                r_add1: item.address,
                r_city: item.city,
                r_state: item.state,
                r_pin: item.pincode,
                s_mobile: item.mobile, 
                r_mobile: item.mobile,
                cod_val: 0,
                ack: 'False',
                alt_add: 'False',
                ins_val: 0
            });
        });

        const customFileName = req.query.filename || "avira_india_post_dispatch";
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${customFileName}.xlsx`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        console.error("Export Excel Error:", err);
        res.status(500).send("Excel export error: " + err.message);
    }
});

// 🗑️ 12. Delete Pending Entry
router.delete('/delete-entry/:id', async (req, res) => {
    try {
        const targetId = parseInt(req.params.id);
        if (isNaN(targetId)) {
            return res.status(400).json({ success: false, msg: "Invalid ID parameter" });
        }

        await db.query('DELETE FROM pending_entries WHERE id = $1', [targetId]);
        const allEntries = await db.query('SELECT * FROM pending_entries ORDER BY id DESC');
        res.json({ success: true, entries: allEntries.rows });
    } catch (error) {
        console.error("Delete Pending Entry Error:", error);
        res.json({ success: false, msg: error.message });
    }
});

// ✏️ 13. Update Pending Entry
router.post('/update-pending-entry/:id', async (req, res) => {
    try {
        const targetId = parseInt(req.params.id);
        if (isNaN(targetId)) {
            return res.status(400).json({ success: false, msg: "Invalid ID parameter" });
        }
        const { memberId, orderDate, pv, amount } = req.body; 
        const mId = memberId ? memberId.toUpperCase().trim() : '';
        const setPv = pv ? pv.toString().trim() : '0';
        const setAmt = amount ? amount.toString().trim() : '0';

        await db.query(
            'UPDATE pending_entries SET member_id = $1, order_date = $2, pv = $3, amount = $4 WHERE id = $5', 
            [mId, orderDate, setPv, setAmt, targetId]
        );
        res.json({ success: true, msg: "Pending entry updated successfully" });
    } catch (error) {
        console.error("Update Pending Entry Error:", error);
        res.json({ success: false, msg: error.message });
    }
});

// ✅ 14. Approve Entry by Tracking to Master DB
router.post('/approve-entry-by-tracking', async (req, res) => {
    const { tracking, memberId, orderDate, pv, amount } = req.body;
    if (!tracking) return res.json({ success: false, msg: "Tracking number required" });

    try {
        const pendingResult = await db.query('SELECT * FROM pending_entries WHERE UPPER(tracking) = $1', [tracking.trim().toUpperCase()]);
        
        let name = '';
        let pendingId = null;

        if (pendingResult.rows.length > 0) {
            name = pendingResult.rows[0].name || '';
            pendingId = pendingResult.rows[0].id;
        }

        const insertQuery = `
            INSERT INTO main_database (member_id, name, order_date, pv, amount, tracking)
            VALUES ($1, $2, $3, $4, $5, $6)
        `;
        const insertValues = [
            memberId ? memberId.toUpperCase().trim() : '', 
            name ? name.toUpperCase().trim() : '',
            orderDate || '', 
            pv || '0', 
            amount || '0', 
            tracking.trim().toUpperCase()
        ];
        
        await db.query(insertQuery, insertValues);

        if (pendingId) {
            await db.query('DELETE FROM pending_entries WHERE id = $1', [pendingId]);
        } else {
            await db.query('DELETE FROM pending_entries WHERE UPPER(tracking) = $1', [tracking.trim().toUpperCase()]);
        }

        res.json({ success: true, msg: "Saved to main database successfully" });
    } catch (err) {
        console.error("Approve Error:", err);
        res.json({ success: false, msg: err.message });
    }
});

// ✅ 14.2 Bulk Approve Selected Entries to Master DB
router.post('/approve-multiple-entries', async (req, res) => {
    const { entries } = req.body;
    if (!Array.isArray(entries) || entries.length === 0) {
        return res.status(400).json({ success: false, msg: "No entries selected for confirmation" });
    }

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        let approvedCount = 0;
        for (const item of entries) {
            const tracking = (item.tracking || '').trim().toUpperCase();
            if (!tracking) continue;

            const memberId = (item.memberId || '').trim().toUpperCase();
            const orderDate = item.orderDate || '';
            const pv = item.pv || '0';
            const amount = item.amount || '0';

            // Get pending details for name & id
            const pendingRes = await client.query('SELECT * FROM pending_entries WHERE UPPER(tracking) = $1', [tracking]);
            let name = item.name || '';
            let pendingId = null;

            if (pendingRes.rows.length > 0) {
                name = pendingRes.rows[0].name || name;
                pendingId = pendingRes.rows[0].id;
            }

            // Insert into main_database
            const insertQuery = `
                INSERT INTO main_database (member_id, name, order_date, pv, amount, tracking)
                VALUES ($1, $2, $3, $4, $5, $6)
            `;
            await client.query(insertQuery, [
                memberId,
                name ? name.toUpperCase().trim() : '',
                orderDate,
                pv,
                amount,
                tracking
            ]);

            // Remove from pending_entries
            if (pendingId) {
                await client.query('DELETE FROM pending_entries WHERE id = $1', [pendingId]);
            } else {
                await client.query('DELETE FROM pending_entries WHERE UPPER(tracking) = $1', [tracking]);
            }

            approvedCount++;
        }

        await client.query('COMMIT');
        res.json({ 
            success: true, 
            count: approvedCount, 
            msg: `${approvedCount} entries confirmed and saved to Master Database successfully!` 
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Bulk Approve Error:", err);
        res.status(500).json({ success: false, msg: "Bulk approval failed: " + err.message });
    } finally {
        client.release();
    }
});

// 🗑️ 15. Delete from Master Database
router.delete('/delete-master/:srNo', async (req, res) => {
    try {
        const targetSrNo = parseInt(req.params.srNo);
        if (isNaN(targetSrNo)) {
            return res.status(400).json({ success: false, msg: "Invalid SR No parameter" });
        }

        await db.query('DELETE FROM main_database WHERE sr_no = $1', [targetSrNo]);
        res.json({ success: true, msg: "Record deleted successfully" });
    } catch (error) {
        console.error("Delete Master Error:", error);
        res.json({ success: false, msg: error.message });
    }
});

// 🗑️ 15b. Delete Multiple Selected Master Records
router.post('/delete-multiple-master', async (req, res) => {
    try {
        const { srNos } = req.body;
        if (!srNos || !Array.isArray(srNos) || srNos.length === 0) {
            return res.json({ success: false, msg: "No records selected for deletion." });
        }

        const numericSrNos = srNos.map(s => parseInt(s)).filter(s => !isNaN(s));
        if (numericSrNos.length === 0) {
            return res.json({ success: false, msg: "Invalid record numbers provided." });
        }

        const placeholders = numericSrNos.map((_, idx) => `$${idx + 1}`).join(', ');
        await db.query(`DELETE FROM main_database WHERE sr_no IN (${placeholders})`, numericSrNos);

        const allEntries = await db.query('SELECT * FROM main_database ORDER BY sr_no DESC');
        res.json({
            success: true,
            msg: `${numericSrNos.length} records deleted successfully!`,
            entries: allEntries.rows.map(row => ({
                srNo: row.sr_no,
                memberId: row.member_id,
                name: row.name,
                orderDate: row.order_date,
                pv: row.pv,
                amount: row.amount,
                tracking: row.tracking
            }))
        });
    } catch (err) {
        console.error("Bulk Delete Master Error:", err);
        res.json({ success: false, msg: err.message });
    }
});

// ✏️ 16. Update Record in Master Database
router.post('/update-master/:srNo', async (req, res) => {
    try {
        const srNo = parseInt(req.params.srNo);
        const { memberId, name, orderDate, pv, amount, tracking } = req.body;

        await db.query(
            `UPDATE main_database 
             SET member_id = $1, name = $2, order_date = $3, pv = $4, amount = $5, tracking = $6 
             WHERE sr_no = $7`,
            [
                memberId ? memberId.toUpperCase().trim() : '', 
                name ? name.toUpperCase().trim() : '', 
                orderDate ? orderDate.trim() : '', 
                pv ? pv.toString().trim() : '0', 
                amount ? amount.toString().trim() : '0', 
                tracking ? tracking.toUpperCase().trim() : '', 
                srNo
            ]
        );

        res.json({ success: true, msg: "Record updated successfully" });
    } catch (error) {
        console.error("Update Master Error:", error);
        res.json({ success: false, msg: error.message });
    }
});

// 📥 17. Upload Master Excel File
router.post('/upload-master-excel', upload.single('excelFile'), async (req, res) => {
    try {
        if (!req.file) return res.json({ success: false, msg: "Please select an Excel file." });

        const filePath = req.file.path;
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(filePath);
        const worksheet = workbook.getWorksheet(1) || workbook.worksheets[0];

        let uploadedRows = [];

        if (worksheet) {
            worksheet.eachRow((row, rowNumber) => {
                if (rowNumber > 1) {
                    const dateValue = row.getCell(1).text ? row.getCell(1).text.trim() : '';
                    const memberId = row.getCell(2).text ? row.getCell(2).text.trim().toUpperCase() : '';
                    const name = row.getCell(3).text ? row.getCell(3).text.trim().toUpperCase() : '';
                    const totalPv = row.getCell(4).value ? row.getCell(4).value.toString().trim() : '0';
                    const amount = row.getCell(5).value ? row.getCell(5).value.toString().trim() : '0';
                    const tracking = row.getCell(6).text ? row.getCell(6).text.trim().toUpperCase() : '';

                    uploadedRows.push({
                        date: dateValue,
                        memberId: memberId || '',
                        name: name || '',
                        pv: totalPv || '0',
                        amount: amount || '0',
                        tracking: tracking || ''
                    });
                }
            });
        }

        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        res.json({ success: true, data: uploadedRows });
    } catch (error) {
        console.error("Upload Master Excel Error:", error);
        res.json({ success: false, msg: error.message });
    }
});

// 💾 18. Save Bulk Master Entries
router.post('/save-bulk-master', async (req, res) => {
    const { entries } = req.body;
    if (!entries || entries.length === 0) return res.json({ success: false, msg: "No entries to save." });

    try {
        for (const item of entries) {
            const insertQuery = `
                INSERT INTO pending_entries (member_id, name, order_date, pv, amount, tracking)
                VALUES ($1, $2, $3, $4, $5, $6)
            `;
            const values = [
                item.memberId || '', 
                item.name || '', 
                item.date || '', 
                item.pv || '0', 
                item.amount || '0', 
                item.tracking || ''
            ];
            await db.query(insertQuery, values);
        }
        res.json({ success: true, msg: `${entries.length} entries pushed to pending list successfully` });
    } catch (error) {
        console.error("Save Bulk Master Error:", error);
        res.json({ success: false, msg: error.message });
    }
});

// 📑 19. Upload Content PDF
router.post('/upload-pdf', uploadPdf.single('pdfFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, msg: "Please select a valid PDF file to upload!" });
        }
        
        // Ensure file is actually a PDF
        if (path.extname(req.file.originalname).toLowerCase() !== '.pdf' && req.file.mimetype !== 'application/pdf') {
            const tempPath = req.file.path;
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            return res.status(400).json({ success: false, msg: "Only PDF (.pdf) files are supported!" });
        }

        const title = (req.body.pdfTitle || 'OFFICIAL DOCUMENT').toUpperCase().trim();
        const category = (req.body.pdfCategory || 'BUSINESS_PLAN').toUpperCase().trim(); 
        const id = 'PDF-' + Date.now();
        
        const day = new Date().getDate();
        let suffix = 'th';
        if (day === 1 || day === 21 || day === 31) suffix = 'st';
        else if (day === 2 || day === 22) suffix = 'nd';
        else if (day === 3 || day === 23) suffix = 'rd';
        const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        const uploadDate = `${day}${suffix} ${months[new Date().getMonth()]} ${new Date().getFullYear()}`;

        // ☁️ Upload to Cloudinary Permanent Cloud Storage (and retain local backup for zero-delay delivery)
        let storedFileRef = req.file.filename;
        try {
            const cloudUpload = await uploadFile(req.file.path, {
                folder: 'aviracare/pdfs',
                resource_type: 'raw',
                public_id: `pdf_${Date.now()}_${path.parse(req.file.originalname).name.replace(/[^a-zA-Z0-9]/g, '_')}`,
                removeLocalAfterUpload: false
            });
            if (cloudUpload && cloudUpload.url) {
                storedFileRef = cloudUpload.url;
            }
        } catch (cloudErr) {
            console.error("Cloudinary PDF upload error, keeping local:", cloudErr);
        }

        const queryText = 'INSERT INTO content_pdf (id, title, filename, category, upload_date) VALUES ($1, $2, $3, $4, $5)';
        await db.query(queryText, [id, title, storedFileRef, category, uploadDate]);

        res.json({ 
            success: true, 
            msg: `PDF document "${title}" uploaded and synced permanently to cloud storage!`,
            document: { id, title, filename: storedFileRef, category, uploadDate }
        });
    } catch (err) {
        console.error("Upload PDF Error:", err);
        res.status(500).json({ success: false, msg: "Server error during PDF upload: " + err.message });
    }
});

// 🗑️ 20. Delete Content PDF
router.delete('/delete-pdf/:id', async (req, res) => {
    try {
        const pdfId = req.params.id;
        const result = await db.query('SELECT filename, title FROM content_pdf WHERE id = $1', [pdfId]);
        
        if (result.rows.length > 0) {
            const { filename, title } = result.rows[0];
            await db.query('DELETE FROM content_pdf WHERE id = $1', [pdfId]);

            // ☁️ Remove from Cloudinary if stored there
            if (filename && filename.startsWith('http')) {
                await deleteCloudinaryFile(filename, { resource_type: 'raw' });
                await deleteCloudinaryFile(filename, { resource_type: 'image' });
            } else if (filename) {
                const filePath = path.join(__dirname, '..', 'public/uploads/', filename);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            }
            return res.json({ success: true, msg: `Document "${title || 'PDF'}" deleted successfully.` });
        }
        res.status(404).json({ success: false, msg: "PDF record not found in database!" });
    } catch (err) {
        console.error("Delete PDF Error:", err);
        res.status(500).json({ success: false, msg: "Error deleting PDF document: " + err.message });
    }
});

// 📍 21. Upload Pincodes Excel
router.post('/upload-pincode-excel', upload.single('excelFile'), async (req, res) => {
    try {
        if (!req.file) return res.json({ success: false, msg: "Please select an Excel file." });

        const filePath = req.file.path;
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(filePath);
        const worksheet = workbook.getWorksheet(1) || workbook.worksheets[0];

        let insertCount = 0;

        if (worksheet) {
            for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
                const row = worksheet.getRow(rowNumber);
                
                const pincode = row.getCell(1).text ? row.getCell(1).text.trim() : '';
                const address = row.getCell(2).text ? row.getCell(2).text.toUpperCase().trim() : ''; 
                const city = row.getCell(3).text ? row.getCell(3).text.toUpperCase().trim() : '';    
                const state = row.getCell(5).text ? row.getCell(5).text.toUpperCase().trim() : ''; 

                if (pincode) {
                    const insertQuery = `
                        INSERT INTO pincodes (pincode, address, city, state)
                        VALUES ($1, $2, $3, $4)
                    `;
                    await db.query(insertQuery, [pincode, address, city, state]);
                    insertCount++;
                }
            }
        }

        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        res.json({ success: true, msg: `${insertCount} pincodes saved successfully` });
    } catch (error) {
        console.error("Bulk Pincode Upload Error:", error);
        res.json({ success: false, msg: error.message });
    }
});

// 🛍️ 22. Add Product
router.post('/add-product', upload.array('productImages', 5), async (req, res) => {
    try {
        const { name, amount, pv, info, benefits, how_to_use } = req.body;

        if (!req.files || req.files.length === 0) {
            return res.json({ success: false, msg: "કૃપા કરીને ઓછામાં ઓછો ૧ ફોટો અપલોડ કરો!" });
        }

        // ☁️ Upload all images to Cloudinary
        const imagePaths = [];
        for (const file of req.files) {
            try {
                const cloudRes = await uploadFile(file.path, {
                    folder: 'aviracare/products',
                    resource_type: 'image'
                });
                imagePaths.push(cloudRes.url);
            } catch (imgErr) {
                console.error("Cloudinary product image upload error:", imgErr);
                imagePaths.push(`/uploads/${file.filename}`);
            }
        }

        const queryText = `
            INSERT INTO avira_products (name, amount, pv, info, benefits, how_to_use, image_url, all_images) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id
        `;
        
        const values = [
            name.trim(),
            parseFloat(amount),
            parseInt(pv),
            (info || '').trim(),
            (benefits || '').trim(),
            (how_to_use || '').trim(),
            imagePaths[0] || '/images/logo.jpg',
            JSON.stringify(imagePaths)
        ];

        await db.query(queryText, values);
        res.json({ success: true, msg: "પ્રોડક્ટ સફળતાપૂર્વક પબ્લિશ થઈ ગઈ છે અને ક્લાઉડમાં સેવ થઈ ગઈ છે! 🎉" });

    } catch (error) {
        console.error("Add Product Error:", error);
        res.json({ success: false, msg: "ડેટાબેઝ અથવા સર્વરમાં ભૂલ થઈ છે: " + error.message });
    }
});

// 🗑️ 23. Delete Product
router.delete('/delete-product/:id', async (req, res) => {
    try {
        const productId = req.params.id;
        const result = await db.query('SELECT image_url, all_images FROM avira_products WHERE id = $1', [productId]);
        
        if (result.rows.length > 0) {
            const row = result.rows[0];
            let imagesToDelete = [];
            if (row.all_images) {
                try {
                    const parsed = typeof row.all_images === 'string' ? JSON.parse(row.all_images) : row.all_images;
                    if (Array.isArray(parsed)) imagesToDelete = parsed;
                } catch(e) {}
            }
            if (row.image_url && !imagesToDelete.includes(row.image_url)) {
                imagesToDelete.push(row.image_url);
            }

            // Delete from Cloudinary
            for (const imgUrl of imagesToDelete) {
                if (imgUrl && imgUrl.startsWith('http')) {
                    await deleteCloudinaryFile(imgUrl, { resource_type: 'image' });
                }
            }
        }

        await db.query('DELETE FROM avira_products WHERE id = $1', [productId]);
        res.json({ success: true, msg: "પ્રોડક્ટ સફળતાપૂર્વક ડીલીટ થઈ ગઈ છે! 🗑️" });
    } catch (error) {
        console.error("Delete Product API Error:", error);
        res.json({ success: false, msg: "Failed to delete product: " + error.message });
    }
});

// ✏️ 24. Update Product
router.post('/update-product/:id', upload.array('productImages', 5), async (req, res) => {
    try {
        const productId = req.params.id;
        const { name, amount, pv, info, benefits, how_to_use, existingImages } = req.body;

        let finalImages = [];
        if (existingImages) {
            finalImages = Array.isArray(existingImages) ? existingImages : [existingImages];
        }

        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                try {
                    const cloudRes = await uploadFile(file.path, {
                        folder: 'aviracare/products',
                        resource_type: 'image'
                    });
                    finalImages.push(cloudRes.url);
                } catch (imgErr) {
                    console.error("Cloudinary product update image error:", imgErr);
                    finalImages.push(`/uploads/${file.filename}`);
                }
            }
        }

        if (finalImages.length === 0) {
            finalImages.push('/images/logo.jpg');
        }

        const queryText = `
            UPDATE avira_products 
            SET name = $1, amount = $2, pv = $3, info = $4, benefits = $5, how_to_use = $6, 
                image_url = $7, all_images = $8
            WHERE id = $9
        `;
        const values = [
            (name || '').trim(), 
            parseFloat(amount), 
            parseInt(pv), 
            (info || '').trim(), 
            (benefits || '').trim(), 
            (how_to_use || '').trim(),
            finalImages[0], 
            JSON.stringify(finalImages), 
            productId
        ];

        await db.query(queryText, values);
        res.json({ success: true, msg: "પ્રોડક્ટ અને ઈમેજ પ્રોપરલી અપડેટ થઈ ગઈ છે! 🚀" });
    } catch (error) {
        console.error("Update Product API Error:", error);
        res.json({ success: false, msg: "Failed to update product: " + error.message });
    }
});

// ⚙️ 25. Get Box Presets
router.get('/get-box-presets', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM box_presets ORDER BY id DESC');
        res.json({ success: true, presets: result.rows });
    } catch (err) {
        console.error("Get Box Presets Error:", err);
        res.json({ success: false, presets: [] });
    }
});

// ⚙️ 26. Add Box Preset
router.post('/add-box-preset', async (req, res) => {
    try {
        const { name, length, breadth, height } = req.body;
        await db.query(
            'INSERT INTO box_presets (name, length, breadth, height) VALUES ($1, $2, $3, $4)',
            [(name || '').trim(), length, breadth, height]
        );
        res.json({ success: true, msg: "Preset saved successfully" });
    } catch (err) {
        console.error("Add Box Preset Error:", err);
        res.json({ success: false, msg: err.message });
    }
});

// 💬 28. Reply to Support Query Ticket
router.post('/queries/reply', async (req, res) => {
    try {
        const { ticketId, reply, status } = req.body;
        if (!ticketId || !reply || !reply.trim()) {
            return res.json({ success: false, msg: "Ticket ID and reply message are required." });
        }

        const newStatus = status || 'SOLVED';
        await db.query(
            `UPDATE query_tickets 
             SET admin_reply = $1, status = $2, replied_at = NOW() 
             WHERE id = $3`,
            [reply.trim(), newStatus, ticketId]
        );

        res.json({ success: true, msg: "Reply sent to member successfully! 📨" });
    } catch (err) {
        console.error("Query Reply Error:", err);
        res.json({ success: false, msg: "Failed to send reply: " + err.message });
    }
});

// 🔄 29. Update Query Status
router.post('/queries/update-status', async (req, res) => {
    try {
        const { ticketId, status } = req.body;
        if (!ticketId || !status) {
            return res.json({ success: false, msg: "Ticket ID and status are required." });
        }
        await db.query('UPDATE query_tickets SET status = $1 WHERE id = $2', [status, ticketId]);
        res.json({ success: true, msg: "Query status updated successfully!" });
    } catch (err) {
        console.error("Update Query Status Error:", err);
        res.json({ success: false, msg: "Failed to update status: " + err.message });
    }
});

// 🗑️ 30. Delete Query Ticket
router.delete('/queries/delete/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await db.query('DELETE FROM query_tickets WHERE id = $1', [id]);
        res.json({ success: true, msg: "Ticket deleted successfully!" });
    } catch (err) {
        console.error("Delete Query Error:", err);
        res.json({ success: false, msg: err.message });
    }
});

module.exports = router;
