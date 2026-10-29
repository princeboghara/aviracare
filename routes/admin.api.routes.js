const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');
const ExcelJS = require('exceljs');
const db = require('../db');
const { checkAdmin } = require('../middleware/auth');
const { upload, uploadPdf, memoryUpload } = require('../config/multer');
const { getModel, scanParcelLabel, extractBillInvoice } = require('../config/ai');
const { uploadFile, deleteCloudinaryFile } = require('../config/cloudinary');
const orderSyncBot = require('../config/order_sync');

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
            // Load existing orders to accurately filter duplicates without SQL constraint errors
            const existingRes = await db.query('SELECT order_date, member_id, name, pv, amount FROM orders_master');
            const existingSet = new Set(
                existingRes.rows.map(r => 
                    `${String(r.order_date || '').trim()}|${String(r.member_id || '').trim().toUpperCase()}|${String(r.name || '').trim().toUpperCase()}|${String(r.pv || '0').trim()}|${String(r.amount || '0').trim()}`
                )
            );

            const newRows = [];

            for (let rowNumber = 3; rowNumber <= worksheet.rowCount; rowNumber++) {
                const row = worksheet.getRow(rowNumber);

                const dateCell = row.getCell(2);
                const memberId = row.getCell(5).text ? String(row.getCell(5).text).trim().toUpperCase() : '';
                const name = row.getCell(6).text ? String(row.getCell(6).text).trim().toUpperCase() : '';
                const pv = row.getCell(8).value !== null && row.getCell(8).value !== undefined ? String(row.getCell(8).value).trim() : '0';
                const amount = row.getCell(9).value !== null && row.getCell(9).value !== undefined ? String(row.getCell(9).value).trim() : '0';

                if (name && name !== 'NAME') {
                    const formattedDate = parseExcelDate(dateCell);
                    const sig = `${formattedDate}|${memberId}|${name}|${pv}|${amount}`;

                    if (!existingSet.has(sig)) {
                        existingSet.add(sig);
                        newRows.push({
                            order_date: formattedDate,
                            member_id: memberId,
                            name: name,
                            pv: pv,
                            amount: amount
                        });
                        addedCount++;
                    } else {
                        skippedCount++;
                    }
                }
            }

            // Insert new rows inside transaction into both orders_master and main_database
            if (newRows.length > 0) {
                const client = await db.pool.connect();
                try {
                    await client.query('BEGIN');
                    const insertSql = `
                        INSERT INTO orders_master (order_date, member_id, name, pv, amount)
                        VALUES ($1, $2, $3, $4, $5)
                        RETURNING *;
                    `;
                    const insertMainSql = `
                        INSERT INTO main_database (order_no, order_date, member_id, name, pv, amount, tracking, delivery_status)
                        VALUES ($1, $2, $3, $4, $5, '', 'Pending')
                        ON CONFLICT (order_no) DO NOTHING;
                    `;
                    for (const item of newRows) {
                        const omRes = await client.query(insertSql, [
                            item.order_date,
                            item.member_id,
                            item.name,
                            item.pv,
                            item.amount
                        ]);
                        const insertedOm = omRes.rows[0];
                        if (insertedOm) {
                            await client.query(insertMainSql, [
                                insertedOm.order_no,
                                insertedOm.order_date,
                                insertedOm.member_id,
                                insertedOm.name,
                                insertedOm.pv,
                                insertedOm.amount
                            ]);
                        }
                    }
                    await client.query('COMMIT');
                } catch (insertErr) {
                    await client.query('ROLLBACK');
                    throw insertErr;
                } finally {
                    client.release();
                }
            }
        }

        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        const allOrders = await db.query('SELECT * FROM orders_master ORDER BY id DESC');
        res.json({
            success: true,
            msg: `🎉 ${addedCount} New Entries added(${skippedCount} Duplicate Entry Deleted)`,
            orders: allOrders.rows
        });

    } catch (error) {
        console.error("Order Excel Import Error:", error);
        res.json({ success: false, msg: error.message });
    }
});

// 📦 Helper: Fetch all orders from orders_master with joined or manual tracking number
async function getOrdersMasterWithTracking() {
    return await db.query(`
        SELECT 
            om.*,
            COALESCE(
                NULLIF(om.tracking_no, ''),
                NULLIF(ot.tracking_no, ''),
                NULLIF(cp.tracking, ''),
                NULLIF(mb.tracking, ''),
                ''
            ) as tracking_no
        FROM orders_master om
        LEFT JOIN order_trackings ot ON (ot.order_no = om.order_no AND ot.tracking_no IS NOT NULL AND ot.tracking_no != '')
        LEFT JOIN LATERAL (
            SELECT tracking 
            FROM consignment_parcels 
            WHERE order_no = om.order_no
              AND tracking IS NOT NULL AND TRIM(tracking) != ''
            ORDER BY id DESC LIMIT 1
        ) cp ON true
        LEFT JOIN LATERAL (
            SELECT tracking 
            FROM main_database 
            WHERE order_no = om.order_no
              AND tracking IS NOT NULL AND TRIM(tracking) != ''
            ORDER BY sr_no DESC LIMIT 1
        ) mb ON true
        ORDER BY 
            CASE 
                WHEN om.order_no ~ '^ORD-[0-9]+$' THEN CAST(SUBSTRING(om.order_no FROM 5) AS INTEGER)
                ELSE om.id 
            END DESC
    `);
}

// ✏️ 4. Update Single Order (With Tracking Number Editing & Shop Pickup Support)
router.post('/update-order/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { orderDate, memberId, name, pv, amount, trackingNo } = req.body;

        const cleanTracking = trackingNo !== undefined ? trackingNo.trim().toUpperCase() : '';

        const updateQuery = `
            UPDATE orders_master 
            SET order_date = $1, member_id = $2, name = $3, pv = $4, amount = $5, tracking_no = $6
            WHERE id = $7
            RETURNING *;
        `;

        const updatedRes = await db.query(updateQuery, [
            (orderDate || '').trim(),
            (memberId || '').toUpperCase().trim(),
            (name || '').toUpperCase().trim(),
            (pv || '0').toString().trim(),
            (amount || '0').toString().trim(),
            cleanTracking,
            id
        ]);

        const updatedOrder = updatedRes.rows[0];
        if (updatedOrder && updatedOrder.order_no) {
            // Also sync tracking to consignment_parcels if order exists there
            await db.query(`
                UPDATE consignment_parcels 
                SET tracking = $1 
                WHERE order_no = $2
            `, [cleanTracking, updatedOrder.order_no]);

            // Directly sync updates to main_database
            await db.query(`
                INSERT INTO main_database (order_no, member_id, name, order_date, pv, amount, tracking)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (order_no) DO UPDATE
                SET member_id = EXCLUDED.member_id,
                    name = EXCLUDED.name,
                    order_date = EXCLUDED.order_date,
                    pv = EXCLUDED.pv,
                    amount = EXCLUDED.amount,
                    tracking = EXCLUDED.tracking;
            `, [
                updatedOrder.order_no,
                updatedOrder.member_id,
                updatedOrder.name,
                updatedOrder.order_date,
                updatedOrder.pv,
                updatedOrder.amount,
                cleanTracking
            ]);

            // 🛡️ Permanently preserve in Tracking Vault
            await db.query(`
                INSERT INTO order_trackings (order_no, tracking_no, member_id, updated_at)
                VALUES ($1, $2, $3, NOW())
                ON CONFLICT (order_no) DO UPDATE
                SET tracking_no = EXCLUDED.tracking_no, member_id = EXCLUDED.member_id, updated_at = NOW();
            `, [updatedOrder.order_no, cleanTracking, updatedOrder.member_id]);
        }

        const allOrders = await getOrdersMasterWithTracking();
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
        const oRes = await db.query('SELECT order_no FROM orders_master WHERE id = $1', [id]);
        if (oRes.rows.length > 0 && oRes.rows[0].order_no) {
            await db.query('DELETE FROM main_database WHERE order_no = $1', [oRes.rows[0].order_no]);
        }
        await db.query('DELETE FROM orders_master WHERE id = $1', [id]);

        const allOrders = await getOrdersMasterWithTracking();
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

        const allOrders = await getOrdersMasterWithTracking();
        
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

        const allOrders = await getOrdersMasterWithTracking();
        
        res.json({ 
            success: true, 
            msg: ` ${ids.length} Entry Deleted Successfully!`, 
            orders: allOrders.rows 
        });

    } catch (err) {
        console.error("Bulk Delete Orders Error:", err);
        res.json({ success: false, msg: "Server Error: " + err.message });
    }
});

// 🏬 7b. Bulk Mark Orders as Shoppee / Shop Pickup
router.post('/bulk-shoppee-orders', async (req, res) => {
    try {
        const { ids } = req.body;

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.json({ success: false, msg: "No orders selected for Shoppee update." });
        }

        const numericIds = ids.map(id => parseInt(id)).filter(id => !isNaN(id));
        if (numericIds.length === 0) {
            return res.json({ success: false, msg: "Invalid order IDs provided." });
        }

        // 1. Fetch targeted orders to retrieve order_no, member_id, and details
        const fetchRes = await db.query(
            `SELECT id, order_no, member_id, name, order_date, pv, amount FROM orders_master WHERE id = ANY($1::int[])`,
            [numericIds]
        );

        if (fetchRes.rows.length === 0) {
            return res.json({ success: false, msg: "No matching orders found." });
        }

        // 2. Bulk update orders_master tracking_no to 'SHOP PICKUP'
        await db.query(
            `UPDATE orders_master SET tracking_no = 'SHOP PICKUP' WHERE id = ANY($1::int[])`,
            [numericIds]
        );

        const orderNos = fetchRes.rows.map(r => r.order_no).filter(Boolean);

        if (orderNos.length > 0) {
            // 3. Update main_database tracking and delivery_status
            await db.query(
                `UPDATE main_database SET tracking = 'SHOP PICKUP', delivery_status = 'Shop Pickup' WHERE order_no = ANY($1::varchar[])`,
                [orderNos]
            );

            // 4. Update consignment_parcels if existing
            await db.query(
                `UPDATE consignment_parcels SET tracking = 'SHOP PICKUP' WHERE order_no = ANY($1::varchar[])`,
                [orderNos]
            );

            // 5. Ensure each order is mirrored in main_database and securely saved in Tracking Vault
            for (const r of fetchRes.rows) {
                if (r.order_no) {
                    await db.query(`
                        INSERT INTO main_database (order_no, member_id, name, order_date, pv, amount, tracking, delivery_status)
                        VALUES ($1, $2, $3, $4, $5, $6, 'SHOP PICKUP', 'Shop Pickup')
                        ON CONFLICT (order_no) DO UPDATE
                        SET tracking = 'SHOP PICKUP', delivery_status = 'Shop Pickup';
                    `, [
                        r.order_no,
                        r.member_id || '',
                        r.name || '',
                        r.order_date || '',
                        r.pv || 0,
                        r.amount || 0
                    ]);

                    // 🛡️ Permanently preserve in Tracking Vault (order_trackings)
                    await db.query(`
                        INSERT INTO order_trackings (order_no, tracking_no, member_id, updated_at)
                        VALUES ($1, 'SHOP PICKUP', $2, NOW())
                        ON CONFLICT (order_no) DO UPDATE
                        SET tracking_no = 'SHOP PICKUP', member_id = EXCLUDED.member_id, updated_at = NOW();
                    `, [r.order_no, r.member_id || null]);
                }
            }
        }

        const allOrders = await getOrdersMasterWithTracking();

        res.json({
            success: true,
            msg: `Successfully marked ${numericIds.length} orders as Shoppee (Shop Pickup)!`,
            orders: allOrders.rows
        });
    } catch (err) {
        console.error("Bulk Shoppee Orders Error:", err);
        res.json({ success: false, msg: "Server Error: " + err.message });
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

// 📦 Consignments Engine APIs
// 1. Fetch All Consignments with Parcel Counts
router.get('/consignments', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT c.*, 
                   COALESCE(COUNT(p.id), 0)::int as total_parcels
            FROM consignments c
            LEFT JOIN consignment_parcels p ON c.id = p.consignment_id
            GROUP BY c.id
            ORDER BY c.id DESC
        `);
        res.json({ success: true, consignments: result.rows });
    } catch (error) {
        console.error("Fetch Consignments Error:", error);
        res.status(500).json({ success: false, msg: error.message });
    }
});

//  Helper to generate a guaranteed unique consignment number (e.g. CN-271026 or CN-271026-01)
async function generateUniqueConsignmentNumber() {
    const now = new Date();
    const d = String(now.getDate());
    const m = String(now.getMonth() + 1);
    const y = String(now.getFullYear()).slice(-2);
    const baseNo = `CN-${d}${m}${y}`;

    // Check if base exists
    const checkRes = await db.query('SELECT consignment_no FROM consignments WHERE consignment_no LIKE $1', [`${baseNo}%`]);
    const existingNos = new Set(checkRes.rows.map(r => (r.consignment_no || '').toUpperCase().trim()));

    if (!existingNos.has(baseNo)) {
        return baseNo;
    }

    // Try suffixes -01, -02, -03 ...
    for (let i = 1; i <= 99; i++) {
        const candidate = `${baseNo}-${String(i).padStart(2, '0')}`;
        if (!existingNos.has(candidate)) {
            return candidate;
        }
    }
    return `${baseNo}-${Date.now().toString().slice(-4)}`;
}

// 1.1 Generate guaranteed unique consignment number
router.get('/generate-consignment-no', async (req, res) => {
    try {
        const uniqueNo = await generateUniqueConsignmentNumber();
        res.json({ success: true, consignment_no: uniqueNo });
    } catch (err) {
        console.error("Error generating consignment no:", err);
        res.status(500).json({ success: false, msg: err.message });
    }
});

// 2. Create New Consignment
router.post('/create-consignment', async (req, res) => {
    try {
        let { consignment_no, title, dispatch_date, notes } = req.body;
        
        // Auto-generate unique consignment_no if blank
        if (!consignment_no || !consignment_no.trim()) {
            consignment_no = await generateUniqueConsignmentNumber();
        } else {
            consignment_no = consignment_no.trim().toUpperCase();
            // Verify uniqueness in DB, auto-append unique suffix if already exists
            const existsCheck = await db.query('SELECT id FROM consignments WHERE UPPER(consignment_no) = $1', [consignment_no]);
            if (existsCheck.rows.length > 0) {
                for (let i = 1; i <= 99; i++) {
                    const candidate = `${consignment_no}-${String(i).padStart(2, '0')}`;
                    const cCheck = await db.query('SELECT id FROM consignments WHERE UPPER(consignment_no) = $1', [candidate]);
                    if (cCheck.rows.length === 0) {
                        consignment_no = candidate;
                        break;
                    }
                }
            }
        }

        // Default title if blank
        if (!title || !title.trim()) {
            const now = new Date();
            const d = String(now.getDate());
            const m = String(now.getMonth() + 1);
            const y = String(now.getFullYear()).slice(-2);
            title = `${d}-${m}-${y} Dispatch`;
        }
        title = title.trim();

        // Default dispatch_date if blank
        if (!dispatch_date || !dispatch_date.trim()) {
            const now = new Date();
            dispatch_date = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        }
        dispatch_date = dispatch_date.trim();

        const insertQuery = `
            INSERT INTO consignments (consignment_no, title, dispatch_date, status, notes)
            VALUES ($1, $2, $3, 'ACTIVE', $4)
            RETURNING *
        `;
        const result = await db.query(insertQuery, [consignment_no, title, dispatch_date, notes || '']);
        const newConsignment = result.rows[0];
        newConsignment.total_parcels = 0;

        res.json({ success: true, consignment: newConsignment, msg: "Consignment created successfully" });
    } catch (error) {
        console.error("Create Consignment Error:", error);
        res.status(500).json({ success: false, msg: error.message });
    }
});

// 3. Delete Consignment and its Parcels
router.delete('/delete-consignment/:id', async (req, res) => {
    try {
        const targetId = parseInt(req.params.id, 10);
        if (isNaN(targetId)) {
            return res.status(400).json({ success: false, msg: "Invalid Consignment ID" });
        }

        // Clean up from consignment_parcels and pending_entries
        await db.query('DELETE FROM consignment_parcels WHERE consignment_id = $1', [targetId]);
        await db.query('DELETE FROM pending_entries WHERE consignment_id = $1', [targetId]);
        await db.query('DELETE FROM consignments WHERE id = $1', [targetId]);

        res.json({ success: true, msg: "Consignment and its parcels deleted successfully" });
    } catch (error) {
        console.error("Delete Consignment Error:", error);
        res.status(500).json({ success: false, msg: error.message });
    }
});

// 4. Fetch Details & Parcels of a Specific Consignment
router.get('/consignment-details/:id', async (req, res) => {
    try {
        const targetId = parseInt(req.params.id, 10);
        if (isNaN(targetId)) {
            return res.status(400).json({ success: false, msg: "Invalid Consignment ID" });
        }

        const cRes = await db.query('SELECT * FROM consignments WHERE id = $1', [targetId]);
        if (cRes.rows.length === 0) {
            return res.status(404).json({ success: false, msg: "Consignment not found" });
        }

        const pRes = await db.query('SELECT * FROM consignment_parcels WHERE consignment_id = $1 ORDER BY id DESC', [targetId]);

        res.json({
            success: true,
            consignment: cRes.rows[0],
            parcels: pRes.rows
        });
    } catch (error) {
        console.error("Consignment Details Error:", error);
        res.status(500).json({ success: false, msg: error.message });
    }
});

// 5. Delete Consignment Parcel
router.delete('/delete-consignment-parcel/:id', async (req, res) => {
    try {
        const targetId = parseInt(req.params.id, 10);
        if (isNaN(targetId)) {
            return res.status(400).json({ success: false, msg: "Invalid Parcel ID" });
        }

        const pRes = await db.query('SELECT * FROM consignment_parcels WHERE id = $1', [targetId]);
        if (pRes.rows.length > 0) {
            const parcel = pRes.rows[0];
            await db.query('DELETE FROM consignment_parcels WHERE id = $1', [targetId]);
            if (parcel.tracking) {
                await db.query(`
                    DELETE FROM pending_entries 
                    WHERE id IN (
                        SELECT id FROM pending_entries 
                        WHERE UPPER(tracking) = $1 AND (consignment_id = $2 OR consignment_id IS NULL)
                        ORDER BY id DESC LIMIT 1
                    )
                `, [parcel.tracking.toUpperCase().trim(), parcel.consignment_id]);
            }
        }

        res.json({ success: true, msg: "Parcel removed successfully" });
    } catch (error) {
        console.error("Delete Consignment Parcel Error:", error);
        res.status(500).json({ success: false, msg: error.message });
    }
});

// 🔍 5.1 Search & Barcode Scan Orders from Order Master (With Customer Mobile)
router.get('/search-orders', async (req, res) => {
    try {
        const q = (req.query.q || '').trim();
        if (!q) {
            return res.json({ success: true, orders: [], exactMatch: false, order: null });
        }

        // Check for exact order_no or member_id match (ideal for barcode scanner gun)
        const exactSql = `
            SELECT o.id, o.order_no, o.member_id, o.name, o.order_date, o.pv, o.amount,
                   COALESCE(c.mobile, '') as mobile, COALESCE(c.email, '') as email
            FROM orders_master o
            LEFT JOIN customers c ON UPPER(o.member_id) = UPPER(c.member_id)
            WHERE UPPER(o.order_no) = UPPER($1) 
               OR UPPER(o.order_no) = UPPER('ORD-' || $1)
               OR UPPER(o.member_id) = UPPER($1)
            LIMIT 1
        `;
        const exactRes = await db.query(exactSql, [q]);
        const exactOrder = exactRes.rows.length > 0 ? exactRes.rows[0] : null;

        // Search matching orders by name, order_no, or member_id
        const searchSql = `
            SELECT o.id, o.order_no, o.member_id, o.name, o.order_date, o.pv, o.amount,
                   COALESCE(c.mobile, '') as mobile, COALESCE(c.email, '') as email
            FROM orders_master o
            LEFT JOIN customers c ON UPPER(o.member_id) = UPPER(c.member_id)
            WHERE o.name ILIKE $1 
               OR o.order_no ILIKE $1 
               OR o.member_id ILIKE $1
            ORDER BY 
                CASE 
                    WHEN UPPER(o.order_no) = UPPER($2) THEN 1
                    WHEN UPPER(o.member_id) = UPPER($2) THEN 2
                    WHEN UPPER(o.name) = UPPER($2) THEN 3
                    WHEN UPPER(o.name) LIKE (UPPER($2) || '%') THEN 4
                    ELSE 5 
                END,
                o.name ASC
            LIMIT 25
        `;
        const searchRes = await db.query(searchSql, [`%${q}%`, q]);

        res.json({
            success: true,
            exactMatch: Boolean(exactOrder),
            order: exactOrder,
            orders: searchRes.rows
        });
    } catch (err) {
        console.error("Order search error:", err);
        res.status(500).json({ success: false, msg: err.message });
    }
});

// 🔍 5.2 Search Members by Member ID, Name, or Mobile (With Latest Order Info)
router.get('/search-members', async (req, res) => {
    try {
        const q = (req.query.q || '').trim();
        if (!q) {
            return res.json({ success: true, members: [], exactMatch: false, member: null });
        }

        const sql = `
            SELECT c.id, c.member_id, c.name, c.mobile, c.email,
                   o.order_no, o.order_date, o.pv, o.amount
            FROM customers c
            LEFT JOIN LATERAL (
                SELECT order_no, order_date, pv, amount
                FROM orders_master
                WHERE UPPER(member_id) = UPPER(c.member_id)
                ORDER BY id DESC
                LIMIT 1
            ) o ON true
            WHERE c.member_id ILIKE $1 
               OR c.name ILIKE $1 
               OR c.mobile ILIKE $1
            ORDER BY 
                CASE 
                    WHEN UPPER(c.member_id) = UPPER($2) THEN 1
                    WHEN UPPER(c.member_id) LIKE (UPPER($2) || '%') THEN 2
                    WHEN UPPER(c.name) LIKE (UPPER($2) || '%') THEN 3
                    ELSE 4
                END,
                c.member_id ASC
            LIMIT 25
        `;
        const result = await db.query(sql, [`%${q}%`, q]);

        let exactMember = null;
        if (result.rows.length > 0 && result.rows[0].member_id.toUpperCase() === q.toUpperCase()) {
            exactMember = result.rows[0];
        }

        res.json({
            success: true,
            exactMatch: Boolean(exactMember),
            member: exactMember,
            members: result.rows
        });
    } catch (err) {
        console.error("Member search error:", err);
        res.status(500).json({ success: false, msg: err.message });
    }
});

// 🔄 5.3 Trigger Live Customer / Member Directory Sync
router.post('/sync-customers', async (req, res) => {
    try {
        const customerSyncBot = require('../config/customer_sync');
        const syncResult = await customerSyncBot.syncMembers();
        res.json({ success: true, ...syncResult });
    } catch (err) {
        console.error("Customer sync error:", err);
        res.status(500).json({ success: false, msg: err.message });
    }
});

// 💾 10. Save Manual Parcel Entry (Supports Consignments & Standalone)
router.post('/save-manual', async (req, res) => {
    try {
        const item = req.body;
        const consignmentId = item.consignment_id ? parseInt(item.consignment_id, 10) : null;

        const tracking = (item.tracking || '').trim().toUpperCase();
        const weight = item.weight || '';
        const length = item.length || '';
        const breadth = item.breadth || '';
        const height = item.height || '';
        const name = (item.name || '').trim().toUpperCase();
        const mobile = item.mobile || '';
        const pincode = item.pincode || '';
        const city = (item.city || '').trim().toUpperCase();
        const state = (item.state || '').trim().toUpperCase();
        const address = (item.address || '').trim().toUpperCase();

        const order_no = (item.order_no || '').trim().toUpperCase();
        const member_id = (item.member_id || '').trim().toUpperCase();
        const order_date = (item.order_date || '').trim();
        const pv = item.pv !== undefined && item.pv !== null ? String(item.pv).trim() : '';
        const amount = item.amount !== undefined && item.amount !== null ? String(item.amount).trim() : '';

        if (consignmentId) {
            // 1. Insert into consignment_parcels
            const cpRes = await db.query(`
                INSERT INTO consignment_parcels (consignment_id, tracking, weight, length, breadth, height, name, mobile, pincode, city, state, address, order_no, member_id, order_date, pv, amount)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING *
            `, [consignmentId, tracking, weight, length, breadth, height, name, mobile, pincode, city, state, address, order_no, member_id, order_date, pv, amount]);
            const savedParcel = cpRes.rows[0];

            // 2. Direct Sync to main_database & orders_master (no pending_entries or confirm_member required)
            if (order_no) {
                await db.query(`
                    INSERT INTO main_database (order_no, member_id, name, order_date, pv, amount, tracking, consignment_id, delivery_status, destination)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Pending', $9)
                    ON CONFLICT (order_no) DO UPDATE
                    SET tracking = EXCLUDED.tracking,
                        consignment_id = COALESCE(EXCLUDED.consignment_id, main_database.consignment_id),
                        destination = COALESCE(NULLIF(EXCLUDED.destination, ''), main_database.destination);
                `, [order_no, member_id, name, order_date, pv, amount, tracking, consignmentId, city]);

                await db.query(`
                    UPDATE orders_master 
                    SET tracking_no = $1 
                    WHERE UPPER(order_no) = $2
                `, [tracking, order_no]);

                // 🛡️ Permanently preserve in Tracking Vault
                if (tracking) {
                    await db.query(`
                        INSERT INTO order_trackings (order_no, tracking_no, member_id, updated_at)
                        VALUES ($1, $2, $3, NOW())
                        ON CONFLICT (order_no) DO UPDATE
                        SET tracking_no = EXCLUDED.tracking_no, member_id = EXCLUDED.member_id, updated_at = NOW();
                    `, [order_no, tracking, member_id]);
                }
            } else if (member_id) {
                const existingMain = await db.query('SELECT sr_no FROM main_database WHERE UPPER(member_id) = $1 ORDER BY sr_no DESC LIMIT 1', [member_id]);
                if (existingMain.rows.length > 0) {
                    await db.query('UPDATE main_database SET tracking = $1, consignment_id = $2, destination = COALESCE(NULLIF($3, \'\'), destination) WHERE sr_no = $4', [tracking, consignmentId, city, existingMain.rows[0].sr_no]);
                } else {
                    await db.query(`
                        INSERT INTO main_database (member_id, name, order_date, pv, amount, tracking, consignment_id, delivery_status, destination)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending', $8)
                    `, [member_id, name, order_date, pv, amount, tracking, consignmentId, city]);
                }
            } else {
                await db.query(`
                    INSERT INTO main_database (order_no, member_id, name, order_date, pv, amount, tracking, consignment_id, delivery_status, destination)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Pending', $9)
                `, [order_no || null, member_id, name, order_date, pv, amount, tracking, consignmentId, city]);
            }

            // 3. Return all parcels for this consignment
            const allParcels = await db.query('SELECT * FROM consignment_parcels WHERE consignment_id = $1 ORDER BY id DESC', [consignmentId]);

            return res.json({ 
                success: true, 
                parcel: savedParcel, 
                parcels: allParcels.rows,
                msg: "Parcel added directly to master database successfully" 
            });
        } else {
            // Standalone save directly to main_database & orders_master
            if (order_no) {
                await db.query(`
                    INSERT INTO main_database (order_no, member_id, name, order_date, pv, amount, tracking, delivery_status, destination)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending', $8)
                    ON CONFLICT (order_no) DO UPDATE
                    SET tracking = EXCLUDED.tracking,
                        destination = COALESCE(NULLIF(EXCLUDED.destination, ''), main_database.destination);
                `, [order_no, member_id, name, order_date, pv, amount, tracking, city]);

                await db.query(`
                    UPDATE orders_master 
                    SET tracking_no = $1 
                    WHERE UPPER(order_no) = $2
                `, [tracking, order_no]);

                // 🛡️ Permanently preserve in Tracking Vault
                if (tracking) {
                    await db.query(`
                        INSERT INTO order_trackings (order_no, tracking_no, member_id, updated_at)
                        VALUES ($1, $2, $3, NOW())
                        ON CONFLICT (order_no) DO UPDATE
                        SET tracking_no = EXCLUDED.tracking_no, member_id = EXCLUDED.member_id, updated_at = NOW();
                    `, [order_no, tracking, member_id]);
                }
            } else {
                await db.query(`
                    INSERT INTO main_database (order_no, member_id, name, order_date, pv, amount, tracking, delivery_status, destination)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending', $8)
                `, [order_no || null, member_id, name, order_date, pv, amount, tracking, city]);
            }

            return res.json({ success: true, parcel: { tracking, name, member_id, order_no }, msg: "Saved directly to master database" });
        }
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

        function extractAreaOnly(fullAddress, city, state) {
            if (!fullAddress) return '';
            let clean = String(fullAddress).trim();
            if (city && city.trim()) {
                clean = clean.replace(new RegExp(`\\b${city.trim().replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'gi'), '');
            }
            if (state && state.trim()) {
                clean = clean.replace(new RegExp(`\\b${state.trim().replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'gi'), '');
            }
            clean = clean.replace(/^[,\s\-]+|[,\s\-]+$/g, '').replace(/,\s*,/g, ',').trim();
            return clean || fullAddress;
        }

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
                r_add1: extractAreaOnly(item.address, item.city, item.state),
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

// 📊 11.2 Export Consignment Excel (India Post format for a specific consignment)
router.get('/export-consignment-excel/:id', async (req, res) => {
    try {
        const consignmentId = parseInt(req.params.id, 10);
        if (isNaN(consignmentId)) {
            return res.status(400).send("Invalid Consignment ID");
        }

        const cRes = await db.query('SELECT * FROM consignments WHERE id = $1', [consignmentId]);
        if (cRes.rows.length === 0) {
            return res.status(404).send("Consignment not found");
        }
        const consignment = cRes.rows[0];

        const querySql = `
            SELECT p.*, COALESCE(NULLIF(p.mobile, ''), c.mobile, '') as resolved_mobile
            FROM consignment_parcels p
            LEFT JOIN customers c ON UPPER(p.member_id) = UPPER(c.member_id)
            WHERE p.consignment_id = $1 
            ORDER BY p.id ASC
        `;
        const result = await db.query(querySql, [consignmentId]);
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

        function extractAreaOnly(fullAddress, city, state) {
            if (!fullAddress) return '';
            let clean = String(fullAddress).trim();
            if (city && city.trim()) {
                clean = clean.replace(new RegExp(`\\b${city.trim().replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'gi'), '');
            }
            if (state && state.trim()) {
                clean = clean.replace(new RegExp(`\\b${state.trim().replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'gi'), '');
            }
            clean = clean.replace(/^[,\s\-]+|[,\s\-]+$/g, '').replace(/,\s*,/g, ',').trim();
            return clean || fullAddress;
        }

        dbEntries.forEach((item, index) => {
            const mobileNum = (item.resolved_mobile && item.resolved_mobile.trim() !== '')
                ? item.resolved_mobile.trim()
                : (item.mobile ? item.mobile.trim() : '');

            const areaOnly = extractAreaOnly(item.address, item.city, item.state);

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
                r_add1: areaOnly,
                r_city: item.city,
                r_state: item.state,
                r_pin: item.pincode,
                s_mobile: mobileNum, 
                r_mobile: mobileNum,
                cod_val: 0,
                ack: 'False',
                alt_add: 'False',
                ins_val: 0
            });
        });

        const customFileName = req.query.filename 
            ? req.query.filename.trim().replace(/[^a-zA-Z0-9_\-]/g, '_')
            : (consignment.consignment_no || 'Consignment').replace(/[^a-zA-Z0-9_\-]/g, '_') + '_IndiaPost_Dispatch';

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${customFileName}.xlsx"`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        console.error("Export Consignment Excel Error:", err);
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

// ✅ 14. Approve Entry to Master DB (Supports tracking number, multiple parcels per tracking, and Shop Pickups)
router.post('/approve-entry-by-tracking', async (req, res) => {
    const { tracking, memberId, orderDate, pv, amount, pendingId: passedPendingId, id: passedId } = req.body;
    const cleanTracking = (tracking || '').trim().toUpperCase();
    const explicitPendingId = passedPendingId || passedId || null;

    if (!cleanTracking && !explicitPendingId) {
        return res.json({ success: false, msg: "Tracking number or entry ID required" });
    }

    try {
        let pendingResult;
        if (explicitPendingId) {
            pendingResult = await db.query('SELECT * FROM pending_entries WHERE id = $1', [explicitPendingId]);
        } else {
            pendingResult = await db.query('SELECT * FROM pending_entries WHERE UPPER(tracking) = $1 ORDER BY id DESC LIMIT 1', [cleanTracking]);
        }
        
        let name = '';
        let pendingId = explicitPendingId;

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
            cleanTracking
        ];
        
        await db.query(insertQuery, insertValues);

        if (pendingId) {
            await db.query('DELETE FROM pending_entries WHERE id = $1', [pendingId]);
        } else if (cleanTracking) {
            await db.query('DELETE FROM pending_entries WHERE UPPER(tracking) = $1', [cleanTracking]);
        }

        res.json({ success: true, msg: "Saved to main database successfully" });
    } catch (err) {
        console.error("Approve Error:", err);
        res.json({ success: false, msg: err.message });
    }
});

// ✅ 14.2 Bulk Approve Selected Entries to Master DB (Handles multi-parcel tracking and shop deliveries)
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
            const memberId = (item.memberId || '').trim().toUpperCase();
            const orderDate = item.orderDate || '';
            const pv = item.pv || '0';
            const amount = item.amount || '0';
            const pendingId = item.id ? parseInt(item.id, 10) : null;

            if (!pendingId && !tracking) continue;

            // Get pending details for name & id
            let pendingRes;
            if (pendingId) {
                pendingRes = await client.query('SELECT * FROM pending_entries WHERE id = $1', [pendingId]);
            } else {
                pendingRes = await client.query('SELECT * FROM pending_entries WHERE UPPER(tracking) = $1 ORDER BY id DESC LIMIT 1', [tracking]);
            }

            let name = item.name || '';
            let targetPendingId = pendingId;

            if (pendingRes.rows.length > 0) {
                name = pendingRes.rows[0].name || name;
                targetPendingId = pendingRes.rows[0].id;
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

            // Remove only the specific pending entry
            if (targetPendingId) {
                await client.query('DELETE FROM pending_entries WHERE id = $1', [targetPendingId]);
            } else if (tracking) {
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
        res.status(500).json({ success: false, msg: err.message });
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

// 🏬 15c. Bulk Mark Master Records as Shoppee / Shop Pickup
router.post('/bulk-shoppee-master', async (req, res) => {
    try {
        const { srNos } = req.body;
        if (!srNos || !Array.isArray(srNos) || srNos.length === 0) {
            return res.json({ success: false, msg: "No records selected." });
        }

        const numericSrNos = srNos.map(s => parseInt(s)).filter(s => !isNaN(s));
        if (numericSrNos.length === 0) {
            return res.json({ success: false, msg: "Invalid record numbers provided." });
        }

        // 1. Fetch targeted records
        const fetchRes = await db.query(
            `SELECT sr_no, order_no, member_id FROM main_database WHERE sr_no = ANY($1::int[])`,
            [numericSrNos]
        );

        // 2. Update main_database
        await db.query(
            `UPDATE main_database SET tracking = 'SHOP PICKUP', delivery_status = 'Shop Pickup' WHERE sr_no = ANY($1::int[])`,
            [numericSrNos]
        );

        const orderNos = fetchRes.rows.map(r => r.order_no).filter(Boolean);
        if (orderNos.length > 0) {
            // Update orders_master
            await db.query(
                `UPDATE orders_master SET tracking_no = 'SHOP PICKUP' WHERE order_no = ANY($1::varchar[])`,
                [orderNos]
            );

            // Update consignment_parcels
            await db.query(
                `UPDATE consignment_parcels SET tracking = 'SHOP PICKUP' WHERE order_no = ANY($1::varchar[])`,
                [orderNos]
            );

            // 🛡️ Preserve in Tracking Vault
            for (const r of fetchRes.rows) {
                if (r.order_no) {
                    await db.query(`
                        INSERT INTO order_trackings (order_no, tracking_no, member_id, updated_at)
                        VALUES ($1, 'SHOP PICKUP', $2, NOW())
                        ON CONFLICT (order_no) DO UPDATE
                        SET tracking_no = 'SHOP PICKUP', member_id = EXCLUDED.member_id, updated_at = NOW();
                    `, [r.order_no, r.member_id || null]);
                }
            }
        }

        res.json({
            success: true,
            msg: `Successfully marked ${numericSrNos.length} records as Shoppee (Shop Pickup)!`
        });
    } catch (err) {
        console.error("Bulk Shoppee Master Error:", err);
        res.json({ success: false, msg: "Server Error: " + err.message });
    }
});

// ✏️ 16. Update Record in Master Database
router.post('/update-master/:srNo', async (req, res) => {
    try {
        const srNo = parseInt(req.params.srNo);
        const { memberId, name, orderDate, pv, amount, tracking, orderNo } = req.body;
        const cleanTracking = tracking ? tracking.toUpperCase().trim() : '';

        const updateRes = await db.query(
            `UPDATE main_database 
             SET member_id = $1, name = $2, order_date = $3, pv = $4, amount = $5, tracking = $6,
                 order_no = COALESCE(NULLIF($7, ''), order_no)
             WHERE sr_no = $8
             RETURNING *`,
            [
                memberId ? memberId.toUpperCase().trim() : '', 
                name ? name.toUpperCase().trim() : '', 
                orderDate ? orderDate.trim() : '', 
                pv ? pv.toString().trim() : '0', 
                amount ? amount.toString().trim() : '0', 
                cleanTracking,
                orderNo ? orderNo.toUpperCase().trim() : '',
                srNo
            ]
        );

        const updated = updateRes.rows[0];
        if (updated && updated.order_no) {
            await db.query(`
                UPDATE orders_master 
                SET tracking_no = $1 
                WHERE UPPER(order_no) = UPPER($2)
            `, [cleanTracking, updated.order_no]);

            // 🛡️ Permanently preserve in Tracking Vault
            await db.query(`
                INSERT INTO order_trackings (order_no, tracking_no, member_id, updated_at)
                VALUES ($1, $2, $3, NOW())
                ON CONFLICT (order_no) DO UPDATE
                SET tracking_no = EXCLUDED.tracking_no, member_id = EXCLUDED.member_id, updated_at = NOW();
            `, [updated.order_no, cleanTracking, updated.member_id]);
        }

        res.json({ success: true, msg: "Record updated successfully", record: updated });
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
        const { name, amount, pv, category, info, benefits, how_to_use } = req.body;

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
            INSERT INTO avira_products (name, amount, pv, category, info, benefits, how_to_use, image_url, all_images) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id
        `;
        
        const values = [
            name.trim(),
            parseFloat(amount),
            parseInt(pv),
            (category || 'Health & Wellness').trim(),
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
        const { name, amount, pv, category, info, benefits, how_to_use, existingImages } = req.body;

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
            SET name = $1, amount = $2, pv = $3, category = $4, info = $5, benefits = $6, how_to_use = $7, 
                image_url = $8, all_images = $9
            WHERE id = $10
        `;
        const values = [
            (name || '').trim(), 
            parseFloat(amount), 
            parseInt(pv), 
            (category || 'Health & Wellness').trim(),
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

// =============================================================
// 🎛️ COMBO MASTER PRESET APIs
// =============================================================

// 31. Get all combo presets
router.get('/get-combos', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM combo_presets ORDER BY id DESC');
        res.json({ success: true, combos: result.rows });
    } catch (err) {
        console.error("Fetch Combos Error:", err);
        res.json({ success: false, msg: err.message });
    }
});

// 32. Get single combo preset
router.get('/get-combo/:id', async (req, res) => {
    try {
        const comboId = parseInt(req.params.id);
        const result = await db.query('SELECT * FROM combo_presets WHERE id = $1', [comboId]);
        
        if (result.rows.length === 0) {
            return res.json({ success: false, msg: "કોમ્બો મળ્યો નથી!" });
        }
        
        res.json({ success: true, combo: result.rows[0] });
    } catch (err) {
        console.error("Fetch Single Combo Error:", err);
        res.json({ success: false, msg: err.message });
    }
});

// 33. Save or update combo preset
router.post('/save-combo', async (req, res) => {
    try {
        const { id, combo_name, products } = req.body;

        if (!combo_name || !products) {
            return res.json({ success: false, msg: "કોમ્બોનું નામ અને પ્રોડક્ટ્સ જરૂરી છે!" });
        }

        const productsJson = typeof products === 'string' ? products : JSON.stringify(products);

        if (id && parseInt(id) > 0) {
            const updateQuery = `
                UPDATE combo_presets 
                SET combo_name = $1, products = $2 
                WHERE id = $3 
                RETURNING *;
            `;
            await db.query(updateQuery, [combo_name.trim(), productsJson, parseInt(id)]);
        } else {
            const insertQuery = `
                INSERT INTO combo_presets (combo_name, products) 
                VALUES ($1, $2) 
                RETURNING *;
            `;
            await db.query(insertQuery, [combo_name.trim(), productsJson]);
        }

        const result = await db.query('SELECT * FROM combo_presets ORDER BY id DESC');
        res.json({ 
            success: true, 
            msg: id ? "ડેટાબેઝમાં કોમ્બો સફળતાપૂર્વક અપડેટ થઈ ગયો છે! 🚀" : "નવો કોમ્બો સેવ થઈ ગયો છે! 🎉", 
            combos: result.rows 
        });

    } catch (err) {
        console.error("Save Combo Error:", err);
        res.json({ success: false, msg: err.message });
    }
});

// 34. Delete combo preset
router.delete('/delete-combo/:id', async (req, res) => {
    try {
        const comboId = parseInt(req.params.id);
        await db.query('DELETE FROM combo_presets WHERE id = $1', [comboId]);
        
        const result = await db.query('SELECT * FROM combo_presets ORDER BY id DESC');
        res.json({ success: true, msg: "કોમ્બો ડેટાબેઝમાંથી ડિલીટ થયો!", combos: result.rows });
    } catch (err) {
        console.error("Delete Combo Error:", err);
        res.json({ success: false, msg: err.message });
    }
});

// =============================================================
// 📥 PROCESS BILLS API (AI VISION INVOICE EXTRACTION & COMBO BREAKUP)
// =============================================================

// 35. Process uploaded bills
router.post('/process-bills', upload.array('billFiles', 25), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.json({ success: false, msg: "કૃપા કરીને ફાઇલ સિલેક્ટ કરો!" });
        }

        // Read optional custom starting invoice number
        const startInvoiceNo = req.body.customInvoiceNo ? parseInt(req.body.customInvoiceNo.trim()) : NaN;
        const rawInvoiceStr = req.body.customInvoiceNo ? req.body.customInvoiceNo.trim() : '';

        const comboRes = await db.query('SELECT * FROM combo_presets');
        const comboList = comboRes.rows || [];

        // Parallel processing of each bill
        const filePromises = req.files.map(async (file, idx) => {
            let extractedData = {};

            try {
                let fileBuffer;
                if (file.buffer) {
                    fileBuffer = file.buffer;
                } else if (file.path && fs.existsSync(file.path)) {
                    fileBuffer = fs.readFileSync(file.path);
                } else {
                    throw new Error("File buffer or path not accessible");
                }

                extractedData = await extractBillInvoice(fileBuffer, file.mimetype || 'application/pdf');
            } catch (aiErr) {
                console.error("AI Extraction Error:", aiErr.message);
                extractedData = {
                    invoice_no: "",
                    invoice_date: new Date().toLocaleDateString('en-GB'),
                    buyer_name: file.originalname.replace(/\.[^/.]+$/, ""),
                    buyer_id: "",
                    raw_items: []
                };
            }

            // Incremental Numbering for Multiple Files
            let finalInvoiceNo = extractedData.invoice_no || "";
            if (!isNaN(startInvoiceNo)) {
                finalInvoiceNo = String(startInvoiceNo + idx);
            } else if (rawInvoiceStr !== '') {
                finalInvoiceNo = req.files.length > 1 ? `${rawInvoiceStr}-${idx + 1}` : rawInvoiceStr;
            }

            // Process Product Items (Combos Breakup + Single Products)
            let finalProductsList = [];
            let srNoCounter = 1;
            let totalBillAmount = 0;
            let totalBillPv = 0;

            const extractedItems = extractedData.raw_items || [];

            for (let rawIt of extractedItems) {
                const itemProdName = (rawIt.product || "").toLowerCase().trim();

                let matchedCombo = comboList.find(c => {
                    const dbComboName = (c.combo_name || "").toLowerCase().trim();
                    return itemProdName.includes(dbComboName) || dbComboName.includes(itemProdName);
                });

                if (matchedCombo) {
                    let subProducts = typeof matchedCombo.products === 'string' 
                        ? JSON.parse(matchedCombo.products) 
                        : matchedCombo.products;

                    subProducts.forEach(subP => {
                        const subNet = parseFloat(subP.net_amt) || 0;
                        const subPv = parseInt(subP.pv) || 0;
                        const subOfferPv = parseInt(subP.offer_pv) || 0;

                        finalProductsList.push({
                            sr: srNoCounter++,
                            product: subP.product,
                            hsn: subP.hsn || "30045090",
                            qty: parseInt(subP.qty) || 1,
                            rate: parseFloat(subP.rate) || 0,
                            pv: subPv,
                            offer_pv: subOfferPv,
                            discount: parseFloat(subP.discount) || 0,
                            offer_discount: parseFloat(subP.offer_discount) || 0,
                            taxable_val: parseFloat(subP.taxable_val) || 0,
                            gst_pct: parseFloat(subP.gst_pct) || 18,
                            gst_amt: parseFloat(subP.gst_amt) || 0,
                            net_amt: subNet
                        });

                        totalBillAmount += subNet;
                        totalBillPv += (subPv + subOfferPv);
                    });
                } else {
                    const singleNet = parseFloat((rawIt.net_amt || 0).toString().replace(/,/g, '')) || 0;
                    const singlePv = parseInt((rawIt.pv || 0).toString().replace(/,/g, '')) || 0;
                    const singleOfferPv = parseInt((rawIt.offer_pv || 0).toString().replace(/,/g, '')) || 0;

                    finalProductsList.push({
                        sr: srNoCounter++,
                        product: (rawIt.product || "PRODUCT").toUpperCase().trim(),
                        hsn: rawIt.hsn || "30045090",
                        qty: parseInt(rawIt.qty) || 1,
                        rate: parseFloat(rawIt.rate) || 0,
                        pv: singlePv,
                        offer_pv: singleOfferPv,
                        discount: parseFloat(rawIt.discount) || 0,
                        offer_discount: parseFloat(rawIt.offer_discount) || 0,
                        taxable_val: parseFloat(rawIt.taxable_val) || 0,
                        gst_pct: parseFloat(rawIt.gst_pct) || 18,
                        gst_amt: parseFloat(rawIt.gst_amt) || 0,
                        net_amt: singleNet
                    });

                    totalBillAmount += singleNet;
                    totalBillPv += (singlePv + singleOfferPv);
                }
            }

            const rawComboNameSummary = extractedItems.map(i => i.product).join(', ');

            const insertQuery = `
                INSERT INTO bill_history 
                (invoice_no, invoice_date, buyer_name, buyer_id, buyer_address, buyer_phone, buyer_state, buyer_state_code, buyer_pincode, buyer_gstin,
                 consignee_name, consignee_address, consignee_phone, consignee_state, consignee_state_code, consignee_pincode, consignee_gstin,
                 raw_combo_name, items, total_amount, total_pv)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
                RETURNING *;
            `;

            const dbRes = await db.query(insertQuery, [
                finalInvoiceNo,
                extractedData.invoice_date || "",
                extractedData.buyer_name || "",
                extractedData.buyer_id || "",
                extractedData.buyer_address || "",
                extractedData.buyer_phone || "",
                extractedData.buyer_state || "",
                extractedData.buyer_state_code || "",
                extractedData.buyer_pincode || "",
                extractedData.buyer_gstin || "",
                extractedData.consignee_name || "",
                extractedData.consignee_address || "",
                extractedData.consignee_phone || "",
                extractedData.consignee_state || "",
                extractedData.consignee_state_code || "",
                extractedData.consignee_pincode || "",
                extractedData.consignee_gstin || "",
                rawComboNameSummary || "",
                JSON.stringify(finalProductsList),
                totalBillAmount.toFixed(2),
                totalBillPv
            ]);

            // Clean temporary file if exists on disk
            if (file.path && fs.existsSync(file.path)) {
                try { fs.unlinkSync(file.path); } catch(e){}
            }

            return dbRes.rows[0];
        });

        await Promise.all(filePromises);

        const allBills = await db.query(`
            SELECT * FROM bill_history 
            ORDER BY 
                CASE 
                    WHEN invoice_no ~ '^[0-9]+$' THEN CAST(invoice_no AS INTEGER)
                    ELSE 999999
                END ASC,
                id ASC
        `);
        res.json({ success: true, msg: "બિલ સફળતાપૂર્વક કન્વર્ટ થઈ ગયા છે! 🚀", bills: allBills.rows });

    } catch (err) {
        console.error("Process Bill Error:", err);
        res.json({ success: false, msg: err.message });
    }
});

// =============================================================
// 🗑️ DELETE BILLS APIs
// =============================================================

// 36. Bulk delete bills
router.post('/delete-bills', async (req, res) => {
    try {
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.json({ success: false, msg: "કોઈ બિલ સિલેક્ટ કરેલ નથી!" });
        }
        await db.query('DELETE FROM bill_history WHERE id = ANY($1::int[])', [ids]);
        res.json({ success: true, msg: `${ids.length} બિલ સફળતાપૂર્વક ડિલીટ થયા!` });
    } catch (err) {
        console.error("Delete Bills Error:", err);
        res.json({ success: false, msg: err.message });
    }
});

// 37. Single delete bill
router.delete('/delete-bill/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        await db.query('DELETE FROM bill_history WHERE id = $1', [id]);
        res.json({ success: true, msg: "બિલ ડિલીટ થઈ ગયું!" });
    } catch (err) {
        console.error("Delete Single Bill Error:", err);
        res.json({ success: false, msg: err.message });
    }
});

// 🔢 Helper Function: Convert Number to Words
function numberToWords(num) {
    const a = ['', 'One ', 'Two ', 'Three ', 'Four ', 'Five ', 'Six ', 'Seven ', 'Eight ', 'Nine ', 'Ten ', 'Eleven ', 'Twelve ', 'Thirteen ', 'Fourteen ', 'Fifteen ', 'Sixteen ', 'Seventeen ', 'Eighteen ', 'Nineteen '];
    const b = ['', '', 'Twenty ', 'Thirty ', 'Forty ', 'Fifty ', 'Sixty ', 'Seventy ', 'Eighty ', 'Ninety '];
    
    let n = Math.floor(num);
    if (n === 0) return 'Zero Rupees Only';
    
    function inWords(n) {
        if (n < 20) return a[n];
        if (n < 100) return b[Math.floor(n / 10)] + a[n % 10];
        if (n < 1000) return a[Math.floor(n / 100)] + 'Hundred ' + inWords(n % 100);
        if (n < 100000) return inWords(Math.floor(n / 1000)) + 'Thousand ' + inWords(n % 1000);
        if (n < 10000000) return inWords(Math.floor(n / 100000)) + 'Lakh ' + inWords(n % 100000);
        return inWords(Math.floor(n / 10000000)) + 'Crore ' + inWords(n % 10000000);
    }
    
    return inWords(n).trim() + ' Rupees Only';
}

// =============================================================
// 🖨️ BULK PRINT SELECTED BILLS API
// =============================================================

// 38. Print multiple bills combined
router.get('/print-multiple-bills', async (req, res) => {
    try {
        const idsRaw = req.query.ids;
        if (!idsRaw) return res.status(400).send("No bills selected!");

        const ids = idsRaw.split(',').map(id => parseInt(id)).filter(id => !isNaN(id));
        if (ids.length === 0) return res.status(400).send("Invalid bill IDs!");

        const dbRes = await db.query(`
            SELECT * FROM bill_history 
            WHERE id = ANY($1::int[]) 
            ORDER BY 
                CASE 
                    WHEN invoice_no ~ '^[0-9]+$' THEN CAST(invoice_no AS INTEGER)
                    ELSE 999999
                END ASC,
                id ASC
        `, [ids]);
        const bills = dbRes.rows || [];

        if (bills.length === 0) return res.status(404).send("No bill records found!");

        // 🎯 Guarantee exact 1, 2, 3, 4... numeric ascending order for Bulk Print
        bills.sort((a, b) => {
            const numA = parseInt(String(a.invoice_no || '').replace(/[^0-9]/g, '')) || 0;
            const numB = parseInt(String(b.invoice_no || '').replace(/[^0-9]/g, '')) || 0;
            if (numA !== numB) return numA - numB;
            return (a.id || 0) - (b.id || 0);
        });

        let allBillsHtml = bills.map((bill, index) => {
            let items = [];
            if (Array.isArray(bill.items)) items = bill.items;
            else if (typeof bill.items === 'string') {
                try { items = JSON.parse(bill.items); } catch (e) { items = []; }
            }

            let totalQty = 0, totalPv = 0, totalOfferPv = 0;
            let totalDiscount = 0, totalOfferDiscount = 0, totalTaxable = 0, totalGstAmt = 0, totalNetAmt = 0;
            let primaryGstPct = 18;

            items.forEach(it => {
                const qty = parseInt(it.qty) || 1;
                const netAmt = parseFloat((it.net_amt || 0).toString().replace(/,/g, ''));
                const gstPct = parseFloat((it.gst_pct || 18).toString().replace(/,/g, ''));
                const discount = parseFloat((it.discount || 0).toString().replace(/,/g, ''));
                const offerDiscount = parseFloat((it.offer_discount || 0).toString().replace(/,/g, ''));
                
                const taxableVal = it.taxable_val ? parseFloat(it.taxable_val) : parseFloat((netAmt / (1 + (gstPct / 100))).toFixed(2));
                const gstAmt = it.gst_amt ? parseFloat(it.gst_amt) : parseFloat((netAmt - taxableVal).toFixed(2));
                const rate = it.rate ? parseFloat(it.rate) : parseFloat((taxableVal / qty).toFixed(2));

                it.calculated_rate = rate;
                it.calculated_taxable = taxableVal;
                it.calculated_gst = gstAmt;

                totalQty += qty;
                totalPv += parseFloat((it.pv || 0).toString().replace(/,/g, ''));
                totalOfferPv += parseFloat((it.offer_pv || 0).toString().replace(/,/g, ''));
                totalDiscount += discount;
                totalOfferDiscount += offerDiscount;
                totalTaxable += taxableVal;
                totalGstAmt += gstAmt;
                totalNetAmt += netAmt;
                if (gstPct) primaryGstPct = gstPct;
            });

            const buyerState = (bill.buyer_state || '').toLowerCase().trim();
            const isInterState = buyerState !== 'gujarat' && buyerState !== 'gj';
            const amountInWords = numberToWords(totalNetAmt);

            return `
                <div class="invoice-container ${index > 0 ? 'page-break' : ''}">
                    <div class="doc-type">Original/Duplicate/Triplicate</div>
                    
                    <div class="top-header">
                        <img src="/images/logo.jpg" class="logo-img" onerror="this.style.display='none'">
                        <div class="company-name">Avira Lifecare</div>
                        <div class="company-address">
                            103, The Galleria 2 Mahavir Chowk, Near by Yogichok, Surat 395010, Gujarat<br>
                            Surat<br>
                            Ph.: +91 9712326273 &nbsp; Email Id: info@aviralifecare.com<br>
                            State: Gujarat &nbsp; StateCode: GJ
                        </div>
                        <div class="gstin-right">GSTIN: 24ABFCA6751MIZE</div>
                    </div>

                    <div class="tax-invoice-bar">TAX INVOICE</div>

                    <table class="grid-tbl">
                        <tr>
                            <td width="50%"><span class="bold">Inv. No. :</span> ${bill.invoice_no || ''}</td>
                            <td width="50%"><span class="bold">Date:</span> ${bill.invoice_date || ''}</td>
                        </tr>
                        <tr>
                            <td>
                                <span class="bold">Details Of Buyer (Billing To)</span><br><br>
                                <span class="bold">Name :</span> ${bill.buyer_name || ''} ${bill.buyer_id ? '( ID : ' + bill.buyer_id + ' )' : ''}<br><br>
                                <span class="bold">Address:</span> ${bill.buyer_address || ''}<br><br>
                                <span class="bold">Phone :</span> ${bill.buyer_phone || ''}<br>
                                <span class="bold">STATE :</span> ${bill.buyer_state || ''} &nbsp;&nbsp;&nbsp; <span class="bold">STATE-CODE :</span> ${bill.buyer_state_code || ''} &nbsp;&nbsp;&nbsp; <span class="bold">PINCODE :</span> ${bill.buyer_pincode || ''}<br>
                                <span class="bold">GSTIN :</span> ${bill.buyer_gstin || ''}
                            </td>
                            <td>
                                <span class="bold">Details Of Consignee (Shipped To)</span><br><br>
                                <span class="bold">Name :</span> ${bill.consignee_name || bill.buyer_name || ''}<br><br>
                                <span class="bold">Address:</span> ${bill.consignee_address || bill.buyer_address || ''}<br><br>
                                <span class="bold">Phone :</span> ${bill.consignee_phone || bill.buyer_phone || ''}<br>
                                <span class="bold">STATE :</span> ${bill.consignee_state || bill.buyer_state || ''} &nbsp;&nbsp;&nbsp; <span class="bold">STATE-CODE :</span> ${bill.consignee_state_code || bill.buyer_state_code || ''} &nbsp;&nbsp;&nbsp; <span class="bold">PINCODE :</span> ${bill.consignee_pincode || bill.buyer_pincode || ''}<br>
                                <span class="bold">GSTIN :</span> ${bill.consignee_gstin || bill.buyer_gstin || ''}
                            </td>
                        </tr>
                        <tr><td colspan="2"><span class="bold">Transport By:</span></td></tr>
                    </table>

                    <table class="grid-tbl">
                        <thead>
                            <tr style="background-color: #f9f9f9;">
                                <th class="text-center" width="3%">Sr.</th>
                                <th>Product</th>
                                <th class="text-center">HSN Code</th>
                                <th class="text-center">Qty.</th>
                                <th class="text-right">Rate</th>
                                <th class="text-right">Amount</th>
                                <th class="text-center">PV</th>
                                <th class="text-center">Offer PV</th>
                                <th class="text-right">Discount</th>
                                <th class="text-right">Offer Discount</th>
                                <th class="text-right">Taxable Value</th>
                                <th class="text-center">GST%</th>
                                <th class="text-right">GST Amt.</th>
                                <th class="text-right">Net Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${items.map((it, idx) => `
                                <tr>
                                    <td class="text-center">${idx + 1}</td>
                                    <td class="bold">${it.product || 'N/A'}</td>
                                    <td class="text-center">${it.hsn || '30045090'}</td>
                                    <td class="text-center">${it.qty || 1}</td>
                                    <td class="text-right">${parseFloat(it.calculated_rate || it.rate || 0).toFixed(2)}</td>
                                    <td class="text-right">${parseFloat(it.calculated_taxable || it.taxable_val || 0).toFixed(2)}</td>
                                    <td class="text-center">${it.pv || 0}</td>
                                    <td class="text-center">${it.offer_pv || 0}</td>
                                    <td class="text-right">${parseFloat(it.discount || 0).toFixed(2)}</td>
                                    <td class="text-right">${parseFloat(it.offer_discount || 0).toFixed(2)}</td>
                                    <td class="text-right">${parseFloat(it.calculated_taxable || it.taxable_val || 0).toFixed(2)}</td>
                                    <td class="text-center">${parseFloat(it.gst_pct || 18).toFixed(2)}</td>
                                    <td class="text-right">${parseFloat(it.calculated_gst || it.gst_amt || 0).toFixed(2)}</td>
                                    <td class="text-right bold">${parseFloat(it.net_amt || 0).toFixed(2)}</td>
                                </tr>
                            `).join('')}
                            <tr class="bold" style="background-color: #f9f9f9;">
                                <td colspan="3"></td>
                                <td class="text-center">${totalQty}</td>
                                <td></td>
                                <td class="text-right">${totalTaxable.toFixed(2)}</td>
                                <td class="text-center">${totalPv}</td>
                                <td class="text-center">${totalOfferPv}</td>
                                <td class="text-right">${totalDiscount.toFixed(2)}</td>
                                <td class="text-right">${totalOfferDiscount.toFixed(2)}</td>
                                <td class="text-right">${totalTaxable.toFixed(2)}</td>
                                <td></td>
                                <td class="text-right">${totalGstAmt.toFixed(2)}</td>
                                <td class="text-right">${totalNetAmt.toFixed(2)}</td>
                            </tr>
                        </tbody>
                    </table>

                    <div class="summary-wrapper">
                        <div class="left-boxes">
                            <table class="sub-table">
                                <thead>
                                    <tr style="background-color: #f9f9f9;">
                                        <th>Tax Type</th>
                                        <th class="text-right">Amount</th>
                                        <th class="text-right">CGST</th>
                                        <th class="text-right">SGST</th>
                                        <th class="text-right">IGST</th>
                                        <th class="text-right">Discount</th>
                                        <th class="text-right">Net Amt.</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td>GST ${primaryGstPct.toFixed(4)}%</td>
                                        <td class="text-right">${totalTaxable.toFixed(2)}</td>
                                        <td class="text-right">${!isInterState ? (totalGstAmt / 2).toFixed(2) : '0.00'}</td>
                                        <td class="text-right">${!isInterState ? (totalGstAmt / 2).toFixed(2) : '0.00'}</td>
                                        <td class="text-right">${isInterState ? totalGstAmt.toFixed(2) : '0.00'}</td>
                                        <td class="text-right">${totalDiscount.toFixed(2)}</td>
                                        <td class="text-right font-bold">${totalNetAmt.toFixed(2)}</td>
                                    </tr>
                                </tbody>
                            </table>

                            <table class="sub-table">
                                <tr>
                                    <td width="22%" class="bold">Rs. In Word</td>
                                    <td class="bold">${amountInWords}</td>
                                </tr>
                            </table>

                            <table class="sub-table">
                                <tr><td class="bold" style="background-color: #f9f9f9;">Our Bank Detail</td></tr>
                                <tr>
                                    <td>
                                        BANK NAME: INDUSIND BANK<br>
                                        A/C NO: 259998826273<br>
                                        IFSC: INDB0001409
                                    </td>
                                </tr>
                            </table>

                            <table class="sub-table">
                                <tr><td class="bold" style="background-color: #f9f9f9;">Terms & Condition</td></tr>
                                <tr><td>Goods once sold will not be taken back or exchanged.</td></tr>
                            </table>

                            <div style="font-size: 8px;">Subject To SURAT Jurisdiction.</div>
                        </div>

                        <div class="right-box">
                            <table class="sub-table">
                                <tr><td>Amount</td><td class="text-right font-bold">${totalTaxable.toFixed(2)}</td></tr>
                                <tr><td>Discount</td><td class="text-right font-bold">${totalDiscount.toFixed(2)}</td></tr>
                                <tr><td>CGST</td><td class="text-right">${!isInterState ? (totalGstAmt / 2).toFixed(2) : '0.00'}</td></tr>
                                <tr><td>SGST</td><td class="text-right">${!isInterState ? (totalGstAmt / 2).toFixed(2) : '0.00'}</td></tr>
                                <tr><td>IGST</td><td class="text-right font-bold">${isInterState ? totalGstAmt.toFixed(2) : '0.00'}</td></tr>
                                <tr><td>Scheme/offer</td><td class="text-right">0.00</td></tr>
                                <tr><td>Freight</td><td class="text-right">0.00</td></tr>
                                <tr><td>Others</td><td class="text-right">0.00</td></tr>
                                <tr><td>Round Off</td><td class="text-right">0.00</td></tr>
                                <tr style="background-color: #eee; font-weight: bold; font-size: 10px;">
                                    <td>Net Amount</td>
                                    <td class="text-right">${totalNetAmt.toFixed(2)}</td>
                                </tr>
                            </table>

                            <div style="text-align: right; margin-top: 30px; padding-right: 5px;">
                                <span class="bold">Avira Lifecare</span><br><br><br>
                                <span style="font-size: 8px;">Authorised Signatory</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        const finalHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Bulk Tax Invoices (${bills.length} Records)</title>
            <style>
                @page { size: A4 portrait; margin: 0; }
                * { box-sizing: border-box; }
                body { font-family: Arial, Helvetica, sans-serif; font-size: 9px; color: #000; margin: 0; padding: 0; background: #1e293b; }
                .action-bar { position: sticky; top: 0; background: #0f172a; padding: 12px 24px; display: flex; justify-content: space-between; align-items: center; color: white; z-index: 1000; box-shadow: 0 4px 12px rgba(0,0,0,0.4); border-bottom: 1px solid #334155; }
                .btn { background: #10b981; color: white; border: none; padding: 8px 18px; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 11px; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; }
                .btn-secondary { background: #475569; margin-right: 8px; }
                .preview-wrapper { padding: 24px 0; display: flex; flex-direction: column; align-items: center; gap: 20px; }
                .invoice-container { width: 210mm; min-height: 297mm; padding: 10mm; background: white; box-shadow: 0 10px 30px rgba(0,0,0,0.5); margin: auto; }
                .doc-type { text-align: right; font-size: 8px; font-weight: bold; margin-bottom: 2px; }
                .top-header { text-align: center; position: relative; padding-bottom: 4px; }
                .logo-img { position: absolute; left: 0; top: 0; width: 65px; height: auto; }
                .company-name { font-size: 18px; font-weight: bold; font-family: 'Times New Roman', Times, serif; }
                .company-address { font-size: 8.5px; margin-top: 2px; line-height: 1.2; }
                .gstin-right { text-align: right; font-weight: bold; font-size: 9px; margin-top: -8px; }
                .tax-invoice-bar { border-top: 1px solid #000; border-bottom: 1px solid #000; text-align: center; font-weight: bold; font-size: 11px; padding: 2px; margin: 4px 0; background: #ffffff; }
                table.grid-tbl { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
                table.grid-tbl td, table.grid-tbl th { border: 1px solid #000; padding: 3px 4px; vertical-align: top; font-size: 8.5px; }
                .text-center { text-align: center; } .text-right { text-align: right; } .bold { font-weight: bold; }
                .summary-wrapper { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 4px; gap: 6px; }
                .left-boxes { width: 58%; } .right-box { width: 41%; }
                .sub-table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
                .sub-table td, .sub-table th { border: 1px solid #000; padding: 2.5px 4px; font-size: 8.5px; }
                
                @media print {
                    .action-bar { display: none !important; }
                    body { background: white !important; }
                    .preview-wrapper { padding: 0 !important; gap: 0 !important; }
                    .invoice-container { box-shadow: none !important; border: none !important; width: 100% !important; padding: 5mm !important; }
                    .page-break { page-break-before: always !important; }
                }
            </style>
        </head>
        <body>
            <div class="action-bar">
                <div style="font-weight: bold; font-size: 13px;">📄 Bulk Invoices Preview (${bills.length} Selected)</div>
                <div>
                    <button class="btn btn-secondary" onclick="window.close()">Close</button>
                    <button class="btn" onclick="window.print()">🖨️ Print All Selected PDFs</button>
                </div>
            </div>
            <div class="preview-wrapper">
                ${allBillsHtml}
            </div>
        </body>
        </html>
        `;

        res.setHeader('Content-Type', 'text/html');
        res.send(finalHtml);
    } catch (err) {
        console.error("Bulk Print Error:", err);
        res.status(500).send("Error rendering bulk print: " + err.message);
    }
});

// =============================================================
// 🖨️ SINGLE TAX INVOICE PREVIEW ROUTE
// =============================================================

// 39. Print single bill
router.get('/print-bill/:id', async (req, res) => {
    try {
        const billRes = await db.query('SELECT * FROM bill_history WHERE id = $1', [req.params.id]);
        if (billRes.rows.length === 0) return res.status(404).send("Bill record not found");

        const bill = billRes.rows[0];

        let items = [];
        if (Array.isArray(bill.items)) {
            items = bill.items;
        } else if (typeof bill.items === 'string') {
            try { items = JSON.parse(bill.items); } catch (e) { items = []; }
        }

        let totalQty = 0, totalPv = 0, totalOfferPv = 0;
        let totalDiscount = 0, totalOfferDiscount = 0, totalTaxable = 0, totalGstAmt = 0, totalNetAmt = 0;
        let primaryGstPct = 18;

        items.forEach(it => {
            const qty = parseInt(it.qty) || 1;
            const netAmt = parseFloat((it.net_amt || 0).toString().replace(/,/g, ''));
            const gstPct = parseFloat((it.gst_pct || 18).toString().replace(/,/g, ''));
            const discount = parseFloat((it.discount || 0).toString().replace(/,/g, ''));
            const offerDiscount = parseFloat((it.offer_discount || 0).toString().replace(/,/g, ''));
            
            const taxableVal = it.taxable_val ? parseFloat(it.taxable_val) : parseFloat((netAmt / (1 + (gstPct / 100))).toFixed(2));
            const gstAmt = it.gst_amt ? parseFloat(it.gst_amt) : parseFloat((netAmt - taxableVal).toFixed(2));
            const rate = it.rate ? parseFloat(it.rate) : parseFloat((taxableVal / qty).toFixed(2));

            it.calculated_rate = rate;
            it.calculated_taxable = taxableVal;
            it.calculated_gst = gstAmt;

            totalQty += qty;
            totalPv += parseFloat((it.pv || 0).toString().replace(/,/g, ''));
            totalOfferPv += parseFloat((it.offer_pv || 0).toString().replace(/,/g, ''));
            totalDiscount += discount;
            totalOfferDiscount += offerDiscount;
            totalTaxable += taxableVal;
            totalGstAmt += gstAmt;
            totalNetAmt += netAmt;
            if (gstPct) primaryGstPct = gstPct;
        });

        const buyerState = (bill.buyer_state || '').toLowerCase().trim();
        const isInterState = buyerState !== 'gujarat' && buyerState !== 'gj';
        const amountInWords = numberToWords(totalNetAmt);

        const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Tax Invoice - ${bill.invoice_no || 'Invoice'}</title>
            <style>
                @page { size: A4 portrait; margin: 0; }
                * { box-sizing: border-box; }
                body { font-family: Arial, Helvetica, sans-serif; font-size: 8.5px; color: #000; margin: 0; padding: 0; background: #1e293b; }
                .action-bar { position: sticky; top: 0; background: #0f172a; padding: 10px 20px; display: flex; justify-content: space-between; align-items: center; color: white; z-index: 1000; box-shadow: 0 4px 12px rgba(0,0,0,0.4); border-bottom: 1px solid #334155; }
                .btn { background: #10b981; color: white; border: none; padding: 7px 16px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 11px; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; }
                .btn-secondary { background: #475569; margin-right: 8px; }
                .preview-wrapper { padding: 20px 0; display: flex; justify-content: center; }
                .invoice-container { width: 210mm; min-height: 297mm; padding: 8mm; background: white; box-shadow: 0 10px 30px rgba(0,0,0,0.5); margin: auto; border: 1px solid #000; transform: scale(0.95); transform-origin: top center; }
                .doc-type { text-align: right; font-size: 8px; font-weight: bold; margin-bottom: 2px; }
                .top-header { text-align: center; position: relative; padding-bottom: 4px; }
                .logo-img { position: absolute; left: 0; top: 0; width: 60px; height: auto; }
                .company-name { font-size: 17px; font-weight: bold; font-family: 'Times New Roman', Times, serif; text-transform: uppercase; }
                .company-address { font-size: 8px; margin-top: 1px; line-height: 1.2; }
                .gstin-right { text-align: right; font-weight: bold; font-size: 8.5px; margin-top: -6px; }
                .tax-invoice-bar { border-top: 1px solid #000; border-bottom: 1px solid #000; text-align: center; font-weight: bold; font-size: 10.5px; padding: 2px; margin: 4px 0; background: #ffffff; letter-spacing: 0.5px; }
                table.grid-tbl { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
                table.grid-tbl td, table.grid-tbl th { border: 1px solid #000; padding: 2.5px 3.5px; vertical-align: top; font-size: 8px; }
                .text-center { text-align: center; } .text-right { text-align: right; } .bold { font-weight: bold; }
                .summary-wrapper { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 4px; gap: 6px; }
                .left-boxes { width: 58%; } .right-box { width: 41%; }
                .sub-table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
                .sub-table td, .sub-table th { border: 1px solid #000; padding: 2px 3.5px; font-size: 8px; }
                @media print {
                    .action-bar { display: none !important; }
                    body { background: white !important; }
                    .preview-wrapper { padding: 0 !important; }
                    .invoice-container { box-shadow: none !important; border: none !important; width: 100% !important; padding: 4mm !important; transform: scale(1) !important; }
                }
            </style>
        </head>
        <body>
            <div class="action-bar">
                <div style="font-weight: bold; font-size: 13px;">📄 Tax Invoice Preview (Inv No: #${bill.invoice_no || 'N/A'})</div>
                <div>
                    <button class="btn btn-secondary" onclick="window.close()">Close</button>
                    <button class="btn" onclick="window.print()">🖨️ Download / Print PDF</button>
                </div>
            </div>
            <div class="preview-wrapper">
                <div class="invoice-container">
                    <div class="doc-type">Original/Duplicate/Triplicate</div>
                    
                    <div class="top-header">
                        <img src="/images/logo.jpg" class="logo-img" onerror="this.style.display='none'">
                        <div class="company-name">Avira Lifecare</div>
                        <div class="company-address">
                            103, The Galleria 2 Mahavir Chowk, Near by Yogichok, Surat 395010, Gujarat<br>
                            Surat<br>
                            Ph.: +91 9712326273 &nbsp; Email Id: info@aviralifecare.com<br>
                            State: Gujarat &nbsp; StateCode: GJ
                        </div>
                        <div class="gstin-right">GSTIN: 24ABFCA6751MIZE</div>
                    </div>

                    <div class="tax-invoice-bar">TAX INVOICE</div>

                    <table class="grid-tbl">
                        <tr>
                            <td width="50%"><span class="bold">Inv. No. :</span> ${bill.invoice_no || ''}</td>
                            <td width="50%"><span class="bold">Date:</span> ${bill.invoice_date || ''}</td>
                        </tr>
                        <tr>
                            <td>
                                <span class="bold">Details Of Buyer (Billing To)</span><br><br>
                                <span class="bold">Name :</span> ${bill.buyer_name || ''} ${bill.buyer_id ? '( ID : ' + bill.buyer_id + ' )' : ''}<br><br>
                                <span class="bold">Address:</span> ${bill.buyer_address || ''}<br><br>
                                <span class="bold">Phone :</span> ${bill.buyer_phone || ''}<br>
                                <span class="bold">STATE :</span> ${bill.buyer_state || ''} &nbsp;&nbsp;&nbsp; <span class="bold">STATE-CODE :</span> ${bill.buyer_state_code || ''} &nbsp;&nbsp;&nbsp; <span class="bold">PINCODE :</span> ${bill.buyer_pincode || ''}<br>
                                <span class="bold">GSTIN :</span> ${bill.buyer_gstin || ''}
                            </td>
                            <td>
                                <span class="bold">Details Of Consignee (Shipped To)</span><br><br>
                                <span class="bold">Name :</span> ${bill.consignee_name || bill.buyer_name || ''}<br><br>
                                <span class="bold">Address:</span> ${bill.consignee_address || bill.buyer_address || ''}<br><br>
                                <span class="bold">Phone :</span> ${bill.consignee_phone || bill.buyer_phone || ''}<br>
                                <span class="bold">STATE :</span> ${bill.consignee_state || bill.buyer_state || ''} &nbsp;&nbsp;&nbsp; <span class="bold">STATE-CODE :</span> ${bill.consignee_state_code || bill.buyer_state_code || ''} &nbsp;&nbsp;&nbsp; <span class="bold">PINCODE :</span> ${bill.consignee_pincode || bill.buyer_pincode || ''}<br>
                                <span class="bold">GSTIN :</span> ${bill.consignee_gstin || bill.buyer_gstin || ''}
                            </td>
                        </tr>
                        <tr><td colspan="2"><span class="bold">Transport By:</span></td></tr>
                    </table>

                    <table class="grid-tbl">
                        <thead>
                            <tr style="background-color: #f9f9f9;">
                                <th class="text-center" width="3%">Sr.</th>
                                <th>Product</th>
                                <th class="text-center">HSN Code</th>
                                <th class="text-center">Qty.</th>
                                <th class="text-right">Rate</th>
                                <th class="text-right">Amount</th>
                                <th class="text-center">PV</th>
                                <th class="text-center">Offer PV</th>
                                <th class="text-right">Discount</th>
                                <th class="text-right">Offer Discount</th>
                                <th class="text-right">Taxable Value</th>
                                <th class="text-center">GST%</th>
                                <th class="text-right">GST Amt.</th>
                                <th class="text-right">Net Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${items.map((it, idx) => `
                                <tr>
                                    <td class="text-center">${idx + 1}</td>
                                    <td class="bold">${it.product || 'N/A'}</td>
                                    <td class="text-center">${it.hsn || '30045090'}</td>
                                    <td class="text-center">${it.qty || 1}</td>
                                    <td class="text-right">${parseFloat(it.calculated_rate || it.rate || 0).toFixed(2)}</td>
                                    <td class="text-right">${parseFloat(it.calculated_taxable || it.taxable_val || 0).toFixed(2)}</td>
                                    <td class="text-center">${it.pv || 0}</td>
                                    <td class="text-center">${it.offer_pv || 0}</td>
                                    <td class="text-right">${parseFloat(it.discount || 0).toFixed(2)}</td>
                                    <td class="text-right">${parseFloat(it.offer_discount || 0).toFixed(2)}</td>
                                    <td class="text-right">${parseFloat(it.calculated_taxable || it.taxable_val || 0).toFixed(2)}</td>
                                    <td class="text-center">${parseFloat(it.gst_pct || 18).toFixed(2)}</td>
                                    <td class="text-right">${parseFloat(it.calculated_gst || it.gst_amt || 0).toFixed(2)}</td>
                                    <td class="text-right bold">${parseFloat(it.net_amt || 0).toFixed(2)}</td>
                                </tr>
                            `).join('')}
                            <tr class="bold" style="background-color: #f9f9f9;">
                                <td colspan="3"></td>
                                <td class="text-center">${totalQty}</td>
                                <td></td>
                                <td class="text-right">${totalTaxable.toFixed(2)}</td>
                                <td class="text-center">${totalPv}</td>
                                <td class="text-center">${totalOfferPv}</td>
                                <td class="text-right">${totalDiscount.toFixed(2)}</td>
                                <td class="text-right">${totalOfferDiscount.toFixed(2)}</td>
                                <td class="text-right">${totalTaxable.toFixed(2)}</td>
                                <td></td>
                                <td class="text-right">${totalGstAmt.toFixed(2)}</td>
                                <td class="text-right">${totalNetAmt.toFixed(2)}</td>
                            </tr>
                        </tbody>
                    </table>

                    <div class="summary-wrapper">
                        <div class="left-boxes">
                            <table class="sub-table">
                                <thead>
                                    <tr style="background-color: #f9f9f9;">
                                        <th>Tax Type</th>
                                        <th class="text-right">Amount</th>
                                        <th class="text-right">CGST</th>
                                        <th class="text-right">SGST</th>
                                        <th class="text-right">IGST</th>
                                        <th class="text-right">Discount</th>
                                        <th class="text-right">Net Amt.</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td>GST ${primaryGstPct.toFixed(4)}%</td>
                                        <td class="text-right">${totalTaxable.toFixed(2)}</td>
                                        <td class="text-right">${!isInterState ? (totalGstAmt / 2).toFixed(2) : '0.00'}</td>
                                        <td class="text-right">${!isInterState ? (totalGstAmt / 2).toFixed(2) : '0.00'}</td>
                                        <td class="text-right">${isInterState ? totalGstAmt.toFixed(2) : '0.00'}</td>
                                        <td class="text-right">${totalDiscount.toFixed(2)}</td>
                                        <td class="text-right font-bold">${totalNetAmt.toFixed(2)}</td>
                                    </tr>
                                </tbody>
                            </table>

                            <table class="sub-table">
                                <tr>
                                    <td width="22%" class="bold">Rs. In Word</td>
                                    <td class="bold">${amountInWords}</td>
                                </tr>
                            </table>

                            <table class="sub-table">
                                <tr><td class="bold" style="background-color: #f9f9f9;">Our Bank Detail</td></tr>
                                <tr>
                                    <td>
                                        BANK NAME: INDUSIND BANK<br>
                                        A/C NO: 259998826273<br>
                                        IFSC: INDB0001409
                                    </td>
                                </tr>
                            </table>

                            <table class="sub-table">
                                <tr><td class="bold" style="background-color: #f9f9f9;">Terms & Condition</td></tr>
                                <tr><td>Goods once sold will not be taken back or exchanged.</td></tr>
                            </table>

                            <div style="font-size: 8px;">Subject To SURAT Jurisdiction.</div>
                        </div>

                        <div class="right-box">
                            <table class="sub-table">
                                <tr><td>Amount</td><td class="text-right font-bold">${totalTaxable.toFixed(2)}</td></tr>
                                <tr><td>Discount</td><td class="text-right font-bold">${totalDiscount.toFixed(2)}</td></tr>
                                <tr><td>CGST</td><td class="text-right">${!isInterState ? (totalGstAmt / 2).toFixed(2) : '0.00'}</td></tr>
                                <tr><td>SGST</td><td class="text-right">${!isInterState ? (totalGstAmt / 2).toFixed(2) : '0.00'}</td></tr>
                                <tr><td>IGST</td><td class="text-right font-bold">${isInterState ? totalGstAmt.toFixed(2) : '0.00'}</td></tr>
                                <tr><td>Scheme/offer</td><td class="text-right">0.00</td></tr>
                                <tr><td>Freight</td><td class="text-right">0.00</td></tr>
                                <tr><td>Others</td><td class="text-right">0.00</td></tr>
                                <tr><td>Round Off</td><td class="text-right">0.00</td></tr>
                                <tr style="background-color: #eee; font-weight: bold; font-size: 9.5px;">
                                    <td>Net Amount</td>
                                    <td class="text-right">${totalNetAmt.toFixed(2)}</td>
                                </tr>
                            </table>

                            <div style="text-align: right; margin-top: 25px; padding-right: 5px;">
                                <span class="bold">Avira Lifecare</span><br><br><br>
                                <span style="font-size: 8px;">Authorised Signatory</span>
                            </div>
                        </div>
                    </div>

                </div>
            </div>

        </body>
        </html>
        `;

        res.setHeader('Content-Type', 'text/html');
        res.send(html);

    } catch (err) {
        console.error("Preview Bill Error:", err);
        res.status(500).send("Error rendering bill preview: " + err.message);
    }
});

// 🤖 Live Avira Order Sync Endpoints & Real-Time SSE Stream
router.get('/order-sync-status', async (req, res) => {
    try {
        const status = await orderSyncBot.getStatus();
        res.json({ success: true, status });
    } catch (err) {
        res.status(500).json({ success: false, msg: err.message });
    }
});

// ⏸️ Toggle 5-min Auto-Sync (Pause / Resume)
router.post('/toggle-auto-sync', (req, res) => {
    try {
        const result = orderSyncBot.toggleAutoSync();
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, msg: err.message });
    }
});

// ⚡ Real-Time Live Sync Event Stream (Streams progress, percentages & live steps)
router.get('/order-sync-stream', async (req, res) => {
    const mode = (req.query.mode || 'new').toLowerCase().trim(); // 'new' or 'wipe_all'
    
    // Set headers for SSE stream
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (res.flushHeaders) res.flushHeaders();

    const sendEvent = (data) => {
        try {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
            if (res.flush) res.flush();
        } catch (e) {}
    };

    // Send immediate initial event to acknowledge connection immediately
    sendEvent({ step: 'init', message: 'Connected to Live Sync Engine. Checking Avira portal...', percent: 5 });

    try {
        if (mode === 'wipe_all') {
            await orderSyncBot.wipeAndSyncAll(sendEvent);
        } else {
            await orderSyncBot.syncNewOrders(sendEvent);
        }
    } catch (err) {
        sendEvent({ step: 'error', message: err.message, error: err.message, percent: 100 });
    } finally {
        res.end();
    }
});

// 🗑️ Direct Wipe Orders Endpoint
router.post('/wipe-orders', async (req, res) => {
    try {
        // 🛡️ Snapshot all existing tracking numbers into Tracking Vault before wipe
        await db.query(`
            INSERT INTO order_trackings (order_no, tracking_no, member_id, updated_at)
            SELECT order_no, tracking_no, member_id, NOW()
            FROM orders_master
            WHERE order_no IS NOT NULL AND tracking_no IS NOT NULL AND TRIM(tracking_no) != ''
            ON CONFLICT (order_no) DO UPDATE
            SET tracking_no = EXCLUDED.tracking_no, member_id = EXCLUDED.member_id, updated_at = NOW();
        `);
        await db.query(`
            INSERT INTO order_trackings (order_no, tracking_no, member_id, updated_at)
            SELECT order_no, tracking, member_id, NOW()
            FROM main_database
            WHERE order_no IS NOT NULL AND tracking IS NOT NULL AND TRIM(tracking) != ''
            ON CONFLICT (order_no) DO UPDATE
            SET tracking_no = EXCLUDED.tracking_no, member_id = EXCLUDED.member_id, updated_at = NOW();
        `);

        await db.query('DELETE FROM orders_master');
        res.json({ success: true, count: 0, msg: 'Orders repository wiped clean (all tracking numbers safely preserved in Tracking Vault).' });
    } catch (err) {
        res.status(500).json({ success: false, msg: err.message });
    }
});

// 📋 Get Latest Orders List (JSON sorted by latest)
router.get('/orders-list', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT 
                om.*,
                COALESCE(
                    NULLIF(om.tracking_no, ''),
                    NULLIF(ot.tracking_no, ''),
                    NULLIF(cp.tracking, ''),
                    NULLIF(mb.tracking, ''),
                    ''
                ) as tracking_no
            FROM orders_master om
            LEFT JOIN order_trackings ot ON (ot.order_no = om.order_no AND ot.tracking_no IS NOT NULL AND ot.tracking_no != '')
            LEFT JOIN LATERAL (
                SELECT tracking 
                FROM consignment_parcels 
                WHERE order_no = om.order_no
                  AND tracking IS NOT NULL AND TRIM(tracking) != ''
                ORDER BY id DESC LIMIT 1
            ) cp ON true
            LEFT JOIN LATERAL (
                SELECT tracking 
                FROM main_database 
                WHERE order_no = om.order_no
                  AND tracking IS NOT NULL AND TRIM(tracking) != ''
                ORDER BY sr_no DESC LIMIT 1
            ) mb ON true
            ORDER BY 
                CASE 
                    WHEN om.order_no ~ '^ORD-[0-9]+$' THEN CAST(SUBSTRING(om.order_no FROM 5) AS INTEGER)
                    ELSE om.id 
                END DESC
        `);
        res.json({ success: true, orders: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, msg: err.message });
    }
});

router.post('/sync-orders-now', async (req, res) => {
    try {
        const result = await orderSyncBot.syncNewOrders();
        res.json({ success: true, result });
    } catch (err) {
        res.status(500).json({ success: false, msg: err.message });
    }
});

router.post('/sync-all-orders', async (req, res) => {
    try {
        const result = await orderSyncBot.wipeAndSyncAll();
        res.json({ success: true, result });
    } catch (err) {
        res.status(500).json({ success: false, msg: err.message });
    }
});

// =========================================================================
// 📮 INDIA POST CUSTOMER SELF SERVICE AUTOMATION ENDPOINTS
// =========================================================================
const indiaPostBot = require('../config/indiapost_sync');

// 📊 1. Get Live India Post Bot & Consignment Statistics
router.get('/indiapost-status', async (req, res) => {
    try {
        const botStatus = indiaPostBot.getStatus();
        const countsRes = await db.query(`
            SELECT 
                COUNT(*) as total_tracked,
                COUNT(*) FILTER (WHERE LOWER(delivery_status) LIKE '%delivered%') as delivered_count,
                COUNT(*) FILTER (WHERE LOWER(delivery_status) LIKE '%transit%') as in_transit_count,
                COUNT(*) FILTER (WHERE LOWER(delivery_status) LIKE '%dispatch%') as dispatched_count,
                COUNT(*) FILTER (WHERE delivery_status IS NULL OR LOWER(delivery_status) LIKE '%pending%') as pending_count
            FROM main_database
            WHERE tracking IS NOT NULL AND tracking != '' AND tracking != 'PENDING'
        `);

        res.json({
            success: true,
            bot: botStatus,
            stats: countsRes.rows[0]
        });
    } catch (err) {
        res.status(500).json({ success: false, msg: err.message });
    }
});

// ⚡ 2. Real-Time Server-Sent Events (SSE) Stream for India Post Sync
router.get('/indiapost-live-stream', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const sendEvent = (data) => {
        try {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
            if (res.flush) res.flush();
        } catch (e) {}
    };

    sendEvent({ step: 'init', message: 'Connected to India Post Bot Engine...', percent: 5 });

    try {
        const result = await indiaPostBot.startLiveSync((status) => {
            sendEvent({
                step: status.currentStep,
                message: status.currentStep,
                percent: status.progressPercent,
                syncedArticles: status.syncedArticles,
                updatedRecords: status.updatedRecords,
                walletBalance: status.walletBalance,
                accountName: status.accountName
            });
        });

        sendEvent({
            step: 'complete',
            message: `Sync completed! ${result.updatedCount || 0} records updated in database.`,
            percent: 100,
            result
        });
    } catch (err) {
        sendEvent({ step: 'error', message: err.message, error: err.message, percent: 100 });
    } finally {
        res.end();
    }
});

// 🚀 3. Trigger One-Click India Post Live Sync
router.post('/indiapost-sync-now', async (req, res) => {
    try {
        const result = await indiaPostBot.startLiveSync();
        res.json({ success: true, result });
    } catch (err) {
        res.status(500).json({ success: false, msg: err.message });
    }
});

// ⏸️ 4. Pause India Post Auto-Scheduler
router.post('/indiapost-pause-scheduler', (req, res) => {
    const result = indiaPostBot.pauseScheduler();
    res.json(result);
});

// ▶️ 5. Resume India Post Auto-Scheduler
router.post('/indiapost-resume-scheduler', (req, res) => {
    const result = indiaPostBot.resumeScheduler();
    res.json(result);
});

// =========================================================================
// 📋 MANUAL BULK TRACKING: COPY TRACKING NUMBERS & EXCEL UPLOAD
// =========================================================================

// Helper function to auto-detect columns from Excel/CSV headers
// Helper function to format dates from India Post (e.g. "27/10/2026 17:40:20" -> "27 Oct 2026")
function formatIndiaPostDate(raw) {
    if (!raw || raw === '—' || raw === '-' || raw === 'null' || raw === '01 Jan 1') return null;
    if (raw instanceof Date) {
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const d = String(raw.getDate()).padStart(2, '0');
        const m = months[raw.getMonth()];
        const y = raw.getFullYear();
        return `${d} ${m} ${y}`;
    }
    const str = String(raw).trim();
    // Handles "27/10/2026 17:40:20" or "27/10/2026"
    const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (slashMatch) {
        const [_, d, m, y] = slashMatch;
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const monthName = months[parseInt(m, 10) - 1] || m;
        return `${d.padStart(2, '0')} ${monthName} ${y}`;
    }
    // Handles "27-10-2026 17:40:20" or "27-10-2026"
    const dashMatch = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
    if (dashMatch) {
        const [_, d, m, y] = dashMatch;
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const monthName = months[parseInt(m, 10) - 1] || m;
        return `${d.padStart(2, '0')} ${monthName} ${y}`;
    }
    // Handles already formatted "27 Oct 2026"
    if (/^\d{1,2}\s+[A-Za-z]{3}\s+\d{4}/.test(str)) {
        return str;
    }
    return str.split(' ')[0];
}

// Helper function to auto-detect columns from India Post Excel / CSV headers
function findTrackingColumnIndices(headerRow) {
    const mapping = {
        trackingCol: -1,
        statusCol: -1,
        eventCol: -1,
        eventDateCol: -1,
        deliveryDateCol: -1,
        destinationCol: -1,
        bookedDateCol: -1,
        locationCol: -1
    };

    headerRow.forEach((val, idx) => {
        if (!val) return;
        const colStr = String(val).toLowerCase().trim();

        // 1. Article / Tracking Number (e.g. "Article Number")
        if (mapping.trackingCol === -1 && (
            colStr.includes('article') || colStr.includes('tracking') || colStr.includes('consignment') ||
            colStr.includes('barcode') || colStr.includes('awb') || colStr === 'number' || colStr === 'no' || colStr === 'art_no'
        )) {
            mapping.trackingCol = idx;
        }
        // 2. Status (e.g. "Status")
        else if (mapping.statusCol === -1 && colStr === 'status') {
            mapping.statusCol = idx;
        }
        // 3. Latest Event (e.g. "Latest Event")
        else if (mapping.eventCol === -1 && (colStr.includes('latest event') || colStr.includes('event description') || colStr === 'event')) {
            mapping.eventCol = idx;
        }
        // 4. Latest Event On / Delivery Date (e.g. "Latest Event On")
        else if (mapping.eventDateCol === -1 && (
            colStr.includes('latest event on') || colStr.includes('event on') || colStr.includes('event date') ||
            colStr.includes('delivery date') || colStr.includes('delivered on') || colStr.includes('del date') ||
            colStr.includes('delivery dt') || (colStr.includes('date') && !colStr.includes('book'))
        )) {
            mapping.eventDateCol = idx;
            mapping.deliveryDateCol = idx;
        }
        // 5. Booking Date / Booked On (e.g. "Booked On")
        else if (mapping.bookedDateCol === -1 && colStr.includes('book')) {
            mapping.bookedDateCol = idx;
        }
        // 6. Destination (e.g. "Destination")
        else if (mapping.destinationCol === -1 && (
            colStr.includes('destination') || colStr.includes('delivery office') || colStr === 'dest'
        )) {
            mapping.destinationCol = idx;
        }
        // 7. Latest Location (e.g. "Latest Location")
        else if (mapping.locationCol === -1 && (
            colStr.includes('latest location') || (colStr.includes('location') && !colStr.includes('booking'))
        )) {
            mapping.locationCol = idx;
        }
    });

    // Fallbacks
    if (mapping.trackingCol === -1) mapping.trackingCol = 1;
    if (mapping.statusCol === -1 && mapping.eventCol !== -1) mapping.statusCol = mapping.eventCol;
    if (mapping.deliveryDateCol === -1 && mapping.eventDateCol !== -1) mapping.deliveryDateCol = mapping.eventDateCol;

    return mapping;
}

// 📋 6. Get All & Active Daily Tracking Numbers for 1-Click Copy
router.get('/tracking-numbers-list', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT 
                tracking, 
                delivery_status,
                name,
                member_id,
                order_date
            FROM main_database
            WHERE tracking IS NOT NULL 
              AND tracking != '' 
              AND tracking != 'PENDING'
              AND tracking != 'SHOP PICKUP'
            ORDER BY sr_no DESC
        `);

        const all = [];
        const active = []; // in-transit, item dispatched, pending
        const delivered = [];

        result.rows.forEach(r => {
            const trk = (r.tracking || '').trim().toUpperCase();
            if (!trk) return;
            all.push(trk);

            const st = (r.delivery_status || '').toLowerCase();
            if (st.includes('delivered') || st.includes('pickup')) {
                delivered.push(trk);
            } else {
                active.push(trk);
            }
        });

        // Deduplicate maintaining order
        const uniqueAll = [...new Set(all)];
        const uniqueActive = [...new Set(active)];
        const uniqueDelivered = [...new Set(delivered)];

        res.json({
            success: true,
            counts: {
                total: uniqueAll.length,
                active: uniqueActive.length,
                delivered: uniqueDelivered.length
            },
            active: uniqueActive,
            all: uniqueAll,
            delivered: uniqueDelivered
        });
    } catch (err) {
        console.error('Fetch tracking numbers list error:', err);
        res.status(500).json({ success: false, msg: err.message });
    }
});

// 📤 7. Upload Tracking Excel / CSV (Bulk Update Tracking Status & Delivery Dates)
router.post('/upload-tracking-excel', memoryUpload.single('trackingFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, msg: 'No Excel/CSV file was selected. Please choose a file.' });
        }

        const buffer = req.file.buffer;
        const originalName = req.file.originalname || '';
        const ext = path.extname(originalName).toLowerCase();

        const workbook = new ExcelJS.Workbook();

        if (ext === '.csv') {
            const stream = Readable.from(buffer);
            await workbook.csv.read(stream);
        } else {
            await workbook.xlsx.load(buffer);
        }

        const worksheet = workbook.worksheets[0];
        if (!worksheet || worksheet.rowCount < 1) {
            return res.status(400).json({ success: false, msg: 'Uploaded file is empty or cannot be read.' });
        }

        // Search for header row among first 10 rows
        let headerRowNumber = 1;
        let columnMapping = null;

        for (let r = 1; r <= Math.min(10, worksheet.rowCount); r++) {
            const rowValues = worksheet.getRow(r).values;
            if (Array.isArray(rowValues)) {
                const rowStr = rowValues.join(' ').toLowerCase();
                if (rowStr.includes('article') || rowStr.includes('tracking') || rowStr.includes('consignment') || rowStr.includes('awb')) {
                    headerRowNumber = r;
                    columnMapping = findTrackingColumnIndices(rowValues);
                    break;
                }
            }
        }

        if (!columnMapping) {
            const rowValues = worksheet.getRow(1).values;
            columnMapping = findTrackingColumnIndices(Array.isArray(rowValues) ? rowValues : []);
        }

        let totalProcessed = 0;
        let updatedCount = 0;
        let notFoundCount = 0;
        let deliveredCount = 0;
        let inTransitCount = 0;
        let dispatchedCount = 0;
        const updatedSamples = [];

        for (let r = headerRowNumber + 1; r <= worksheet.rowCount; r++) {
            const row = worksheet.getRow(r);
            if (!row || !row.values) continue;

            const values = row.values;
            const rawTracking = values[columnMapping.trackingCol];
            if (!rawTracking) continue;

            let trackingNo = String(rawTracking).trim().toUpperCase();
            if (typeof rawTracking === 'object' && rawTracking !== null) {
                trackingNo = String(rawTracking.text || rawTracking.result || rawTracking).trim().toUpperCase();
            }

            if (!trackingNo || trackingNo === 'PENDING' || trackingNo.length < 5) continue;

            totalProcessed++;

            // Extract raw fields
            const rawStatus = columnMapping.statusCol > 0 ? values[columnMapping.statusCol] : null;
            const rawEvent = columnMapping.eventCol > 0 ? values[columnMapping.eventCol] : null;
            const rawEventDate = columnMapping.eventDateCol > 0 ? values[columnMapping.eventDateCol] : null;
            const rawBooked = columnMapping.bookedDateCol > 0 ? values[columnMapping.bookedDateCol] : null;
            const rawDest = columnMapping.destinationCol > 0 ? values[columnMapping.destinationCol] : null;
            const rawLoc = columnMapping.locationCol > 0 ? values[columnMapping.locationCol] : null;

            const statusStr = rawStatus ? String(rawStatus.text || rawStatus.result || rawStatus).trim() : '';
            const eventStr = rawEvent ? String(rawEvent.text || rawEvent.result || rawEvent).trim() : '';
            const bookedStr = rawBooked ? String(rawBooked.text || rawBooked.result || rawBooked).trim() : '';

            const statusLower = statusStr.toLowerCase();
            const eventLower = eventStr.toLowerCase();

            // 1. Resolve Standard Delivery Status
            let finalStatus = 'In Transit';
            if (eventLower.includes('returned') || statusLower.includes('returned')) {
                finalStatus = 'Returned';
            } else if (statusLower.includes('delivered') || eventLower.includes('delivered')) {
                finalStatus = 'Delivered';
                deliveredCount++;
            } else if (eventLower.includes('out for delivery') || statusLower.includes('out for delivery')) {
                finalStatus = 'Out for Delivery';
                inTransitCount++;
            } else if (eventLower === 'dispatched' || statusLower === 'dispatched') {
                finalStatus = 'Item Dispatched';
                dispatchedCount++;
            } else if (eventLower.includes('hold') || statusLower.includes('hold')) {
                finalStatus = 'On Hold';
                inTransitCount++;
            } else if (bookedStr === '01 Jan 1' && !eventStr) {
                finalStatus = 'Pending';
            } else if (statusStr) {
                finalStatus = statusStr;
                inTransitCount++;
            } else {
                finalStatus = 'In Transit';
                inTransitCount++;
            }

            // 2. Delivery Date (only when Delivered)
            let deliveryDate = null;
            if (finalStatus === 'Delivered') {
                deliveryDate = formatIndiaPostDate(rawEventDate);
            }

            // 3. Booking Date
            let bookedDate = formatIndiaPostDate(rawBooked);

            // 4. Destination
            let destination = null;
            const destCandidate = rawDest ? String(rawDest.text || rawDest.result || rawDest).trim() : '';
            const locCandidate = rawLoc ? String(rawLoc.text || rawLoc.result || rawLoc).trim() : '';

            if (destCandidate && destCandidate !== '—' && destCandidate !== '-') {
                destination = destCandidate;
            } else if (locCandidate && locCandidate !== '—' && !locCandidate.startsWith('₹')) {
                destination = locCandidate;
            }

            // Update main_database
            const updateRes = await db.query(`
                UPDATE main_database
                SET 
                    delivery_status = COALESCE($1, delivery_status),
                    delivery_date = COALESCE($2, delivery_date),
                    destination = COALESCE($3, destination),
                    booked_date = COALESCE($4, booked_date),
                    last_sync_time = NOW()
                WHERE UPPER(TRIM(tracking)) = $5
                RETURNING sr_no, tracking, delivery_status, delivery_date, destination
            `, [finalStatus, deliveryDate, destination, bookedDate, trackingNo]);

            if (updateRes.rowCount > 0) {
                updatedCount += updateRes.rowCount;
                if (updatedSamples.length < 6) {
                    updatedSamples.push({
                        tracking: trackingNo,
                        status: updateRes.rows[0].delivery_status,
                        deliveryDate: updateRes.rows[0].delivery_date || '-',
                        destination: updateRes.rows[0].destination || '-'
                    });
                }

                // Also sync order_trackings
                await db.query(`
                    UPDATE order_trackings
                    SET 
                        delivery_status = COALESCE($1, delivery_status),
                        destination = COALESCE($2, destination),
                        updated_at = NOW()
                    WHERE UPPER(TRIM(tracking_no)) = $3
                `, [finalStatus, destination, trackingNo]).catch(() => {});
            } else {
                notFoundCount++;
            }
        }

        return res.json({
            success: true,
            msg: `India Post Tracking file imported successfully: ${updatedCount} parcels updated (${deliveredCount} Delivered, ${dispatchedCount} Dispatched, ${inTransitCount} In-Transit).`,
            totalProcessed,
            updatedCount,
            notFoundCount,
            deliveredCount,
            samples: updatedSamples
        });

    } catch (err) {
        console.error('Tracking Excel Upload Error:', err);
        return res.status(500).json({ success: false, msg: err.message || 'Error processing Excel tracking file' });
    }
});

module.exports = router;

