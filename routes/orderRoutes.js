const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const db = require('../config/db');
const { upload, memoryUpload } = require('../config/multer');
const { checkAdmin } = require('../middleware/auth');
const { formatDateObj } = require('../utils/helpers');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// AI Shipping Label Scanner
router.post('/admin/api/scan-ai-label', checkAdmin, memoryUpload.single('labelImage'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, msg: 'No image uploaded' });

        const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });
        const imagePart = {
            inlineData: {
                data: req.file.buffer.toString("base64"),
                mimeType: req.file.mimetype
            }
        };

        const prompt = `Analyze this shipping parcel label sticker carefully and extract details into strict JSON format with these exact keys:
        {
            "tracking": "Tracking/Barcode number (e.g. CG135962112IN)",
            "name": "Exact Full Name directly under DELIVER TO",
            "mobile": "10-digit mobile number explicitly written next to Mob:",
            "pincode": "6-digit delivery pincode (e.g., 400074)"
        }
        Return ONLY pure valid JSON, no markdown formatting or extra text.`;

        const result = await model.generateContent([prompt, imagePart]);
        const responseText = result.response.text();
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);

        if (jsonMatch) {
            return res.json({ success: true, data: JSON.parse(jsonMatch[0]) });
        } else {
            return res.json({ success: false, msg: 'AI could not process JSON from image' });
        }
    } catch (err) {
        return res.json({ success: false, msg: err.message });
    }
});

// Confirm DB Auto Match
router.get('/admin/api/match-confirm-db', checkAdmin, async (req, res) => {
    try {
        const result = await db.query('SELECT order_date, member_id, name, pv, amount FROM orders_master');
        let dbRowsMap = {};
        result.rows.forEach(row => {
            if (row.name) {
                const rawName = row.name.toUpperCase().trim();
                const cleanKey = rawName.replace(/[^A-Z0-9]/g, '');
                const rowDataObj = { dateStr: row.order_date || '', memberId: row.member_id || '', pv: row.pv || '0', amount: row.amount || '0' };
                dbRowsMap[cleanKey] = rowDataObj;
                dbRowsMap[rawName] = rowDataObj;
            }
        });
        res.json({ success: true, dbData: dbRowsMap });
    } catch (error) {
        res.json({ success: false, msg: error.message });
    }
});

// Excel Orders Import
router.post('/admin/api/upload-orders-excel', checkAdmin, upload.single('excelFile'), async (req, res) => {
    try {
        if (!req.file) return res.json({ success: false, msg: "Please select an Excel file." });

        const filePath = req.file.path;
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(filePath);
        const worksheet = workbook.getWorksheet(1) || workbook.worksheets[0];

        let addedCount = 0;
        let skippedCount = 0;

        const parseExcelDate = (cell) => {
            if (!cell || cell.value === null || cell.value === undefined) return '';
            let val = cell.value;
            if (val instanceof Date) return formatDateObj(val);
            if (typeof val === 'object') {
                if (val.result instanceof Date) return formatDateObj(val.result);
                if (val.result) val = val.result;
                else if (cell.text) val = cell.text;
            }
            let rawStr = cell.text ? String(cell.text).trim() : String(val).trim();
            let cleanDateText = rawStr.replace(/(\d+)(st|nd|rd|th)/i, '$1');
            let parsedDate = new Date(cleanDateText);
            if (!isNaN(parsedDate.getTime())) return formatDateObj(parsedDate);
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
                    if (result.rows.length > 0) addedCount++;
                    else skippedCount++;
                }
            }
        }

        fs.unlinkSync(filePath);
        const allOrders = await db.query('SELECT * FROM orders_master ORDER BY id DESC');
        res.json({ success: true, msg: `🎉 ${addedCount} નવી એન્ટ્રી ઉમેરાઈ! (${skippedCount} ડુપ્લિકેટ એન્ટ્રી હટાવી દીધી)`, orders: allOrders.rows });
    } catch (error) {
        res.json({ success: false, msg: error.message });
    }
});

// Update & Delete Order
router.post('/admin/api/update-order/:id', checkAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { orderDate, memberId, name, pv, amount } = req.body;
        await db.query(`UPDATE orders_master SET order_date = $1, member_id = $2, name = $3, pv = $4, amount = $5 WHERE id = $6`, [orderDate.trim(), memberId.toUpperCase().trim(), name.toUpperCase().trim(), pv.trim(), amount.trim(), id]);
        const allOrders = await db.query('SELECT * FROM orders_master ORDER BY id DESC');
        res.json({ success: true, msg: "Order updated successfully", orders: allOrders.rows });
    } catch (err) {
        res.json({ success: false, msg: err.message });
    }
});

router.delete('/admin/api/delete-order/:id', checkAdmin, async (req, res) => {
    try {
        await db.query('DELETE FROM orders_master WHERE id = $1', [req.params.id]);
        const allOrders = await db.query('SELECT * FROM orders_master ORDER BY id DESC');
        res.json({ success: true, msg: "Order deleted successfully", orders: allOrders.rows });
    } catch (err) {
        res.json({ success: false, msg: err.message });
    }
});

router.post('/admin/api/delete-multiple-orders', checkAdmin, async (req, res) => {
    try {
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids) || ids.length === 0) return res.json({ success: false, msg: "No orders selected." });
        await db.query('DELETE FROM orders_master WHERE id = ANY($1::int[])', [ids]);
        const allOrders = await db.query('SELECT * FROM orders_master ORDER BY id DESC');
        res.json({ success: true, msg: `${ids.length} orders deleted successfully`, orders: allOrders.rows });
    } catch (err) {
        res.json({ success: false, msg: err.message });
    }
});

// Save Manual & Export Excel
router.post('/admin/api/save-manual', checkAdmin, async (req, res) => {
    try {
        const item = req.body;
        const queryText = `INSERT INTO pending_entries (tracking, weight, length, breadth, height, name, mobile, pincode, city, state, address) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`;
        await db.query(queryText, [item.tracking, item.weight, item.length, item.breadth, item.height, item.name, item.mobile, item.pincode, item.city, item.state, item.address]);
        const allEntries = await db.query('SELECT * FROM pending_entries ORDER BY id DESC');
        res.json({ success: true, entries: allEntries.rows });
    } catch (error) {
        res.json({ success: false, msg: error.message });
    }
});

router.get('/admin/api/export-excel', checkAdmin, async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM pending_entries ORDER BY id DESC');
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('ArticleDetails');

        sheet.columns = [
            { header: 'ARTICLE SERIAL NUMBER', key: 'sn' }, { header: 'BARCODE NO india post', key: 'tracking' },
            { header: 'delhivary', key: 'blank1' }, { header: 'PHYSICAL WEIGHT', key: 'weight' },
            { header: 'SHAPE OF ARTICLE', key: 'shape' }, { header: 'LENGTH', key: 'length' },
            { header: 'BREADTH/DIAMETER', key: 'breadth' }, { header: 'HEIGHT', key: 'height' },
            { header: 'SENDER NAME', key: 's_name' }, { header: 'RECEIVER NAME', key: 'r_name' },
            { header: 'RECEIVER ADD LINE 1', key: 'r_add1' }, { header: 'RECEIVER CITY', key: 'r_city' },
            { header: 'RECEIVER STATE/UT', key: 'r_state' }, { header: 'RECEIVER PINCODE', key: 'r_pin' },
            { header: 'RECEIVER MOBILE NO', key: 'r_mobile' }
        ];

        result.rows.forEach((item, index) => {
            sheet.addRow({
                sn: index + 1, tracking: item.tracking, weight: item.weight, shape: 'NROL', length: item.length,
                breadth: item.breadth, height: item.height, s_name: 'Avira LifeCare', r_name: item.name,
                r_add1: item.address, r_city: item.city, r_state: item.state, r_pin: item.pincode, r_mobile: item.mobile
            });
        });

        const customFileName = req.query.filename || "avira_india_post_dispatch";
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${customFileName}.xlsx`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        res.status(500).send("Excel export error: " + err.message);
    }
});

// Pincode & Address Search API
router.get('/admin/api/fetch-details', checkAdmin, async (req, res) => {
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
        res.json({ success: false, msg: error.message });
    }
});

// Master DB APIs
router.post('/admin/api/approve-entry-by-tracking', checkAdmin, async (req, res) => {
    const { tracking, memberId, orderDate, pv, amount } = req.body;
    if (!tracking) return res.json({ success: false, msg: "Tracking number required" });

    try {
        const pendingResult = await db.query('SELECT * FROM pending_entries WHERE UPPER(tracking) = $1', [tracking.trim().toUpperCase()]);
        let name = pendingResult.rows.length > 0 ? pendingResult.rows[0].name || '' : '';
        let pendingId = pendingResult.rows.length > 0 ? pendingResult.rows[0].id : null;

        const insertQuery = `INSERT INTO main_database (member_id, name, order_date, pv, amount, tracking) VALUES ($1, $2, $3, $4, $5, $6)`;
        await db.query(insertQuery, [memberId ? memberId.toUpperCase().trim() : '', name ? name.toUpperCase().trim() : '', orderDate || '', pv || '0', amount || '0', tracking.trim().toUpperCase()]);

        if (pendingId) await db.query('DELETE FROM pending_entries WHERE id = $1', [pendingId]);
        else await db.query('DELETE FROM pending_entries WHERE UPPER(tracking) = $1', [tracking.trim().toUpperCase()]);

        res.json({ success: true, msg: "Saved to main database successfully" });
    } catch (err) {
        res.json({ success: false, msg: err.message });
    }
});

router.delete('/admin/api/delete-master/:srNo', checkAdmin, async (req, res) => {
    try {
        await db.query('DELETE FROM main_database WHERE sr_no = $1', [parseInt(req.params.srNo)]);
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, msg: error.message });
    }
});

router.post('/admin/api/update-master/:srNo', checkAdmin, async (req, res) => {
    try {
        const srNo = parseInt(req.params.srNo);
        const { memberId, name, orderDate, pv, amount, tracking } = req.body;
        await db.query(`UPDATE main_database SET member_id = $1, name = $2, order_date = $3, pv = $4, amount = $5, tracking = $6 WHERE sr_no = $7`,
            [memberId ? memberId.toUpperCase().trim() : '', name ? name.toUpperCase().trim() : '', orderDate ? orderDate.trim() : '', pv ? pv.toString().trim() : '0', amount ? amount.toString().trim() : '0', tracking ? tracking.toUpperCase().trim() : '', srNo]
        );
        res.json({ success: true, msg: "Record updated successfully" });
    } catch (error) {
        res.json({ success: false, msg: error.message });
    }
});

// =============================================================
// 📦 BOX DIMENSIONS PRESETS APIs (SYSTEM SETTINGS)
// =============================================================

// 1. Fetch All Saved Box Presets
router.get('/admin/api/get-box-presets', checkAdmin, async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM box_presets ORDER BY id DESC');
        res.json({ success: true, presets: result.rows || [] });
    } catch (err) {
        console.error("Fetch Box Presets Error:", err);
        res.json({ success: false, presets: [] });
    }
});

// 2. Add New Box Preset
router.post('/admin/api/add-box-preset', checkAdmin, async (req, res) => {
    try {
        const { name, length, breadth, height } = req.body;
        if (!name || !length || !breadth || !height) {
            return res.json({ success: false, msg: "બધી માહિતી પૂરવી જરૂરી છે!" });
        }

        await db.query(
            'INSERT INTO box_presets (name, length, breadth, height) VALUES ($1, $2, $3, $4)',
            [name.trim(), parseFloat(length), parseFloat(breadth), parseFloat(height)]
        );
        res.json({ success: true, msg: "બોક્સ સેટિંગ્સ સફળતાપૂર્વક સેવ થઈ ગઈ છે! 🎉" });
    } catch (err) {
        console.error("Add Box Preset Error:", err);
        res.json({ success: false, msg: err.message });
    }
});

// 3. Delete Box Preset
router.delete('/admin/api/delete-box-preset/:id', checkAdmin, async (req, res) => {
    try {
        const presetId = parseInt(req.params.id);
        await db.query('DELETE FROM box_presets WHERE id = $1', [presetId]);
        res.json({ success: true, msg: "બોક્સ પ્રેસેટ ડિલીટ થઈ ગયો છે! 🗑️" });
    } catch (err) {
        console.error("Delete Box Preset Error:", err);
        res.json({ success: false, msg: err.message });
    }
});

module.exports = router;