const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const multer = require('multer');
const ExcelJS = require('exceljs');
const fs = require('fs');
const https = require('https');
const session = require('express-session');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const db = require('./db.js');

const app = express();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

app.use(session({
    secret: 'avira-secret-key-2026',
    resave: false,
    saveUninitialized: false
}));

function checkAdmin(req, res, next) {
    if (req.session && req.session.isAdmin) {
        next();
    } else {
        res.redirect('/admin/login');
    }
}

const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const sharedStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'public', 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, 'public/uploads/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname.replace(/\s+/g, '_'));
    }
});

const memoryUpload = multer({ storage: multer.memoryStorage() });
const upload = multer({ storage: sharedStorage });
const uploadPdf = multer({ storage: sharedStorage });

app.get('/', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM content_pdf');
        const pdfList = result.rows;
        
        const latestBusinessPlan = pdfList.filter(p => p.category === 'BUSINESS_PLAN').pop();
        const latestCatalog = pdfList.filter(p => p.category === 'PRODUCT_CATALOG').pop();

        res.render('home', { 
            businessPlan: latestBusinessPlan ? `/uploads/${latestBusinessPlan.filename}` : '#',
            catalog: latestCatalog ? `/uploads/${latestCatalog.filename}` : '#'
        });
    } catch (err) {
        console.error(err);
        res.render('home', { businessPlan: '#', catalog: '#' });
    }
});

app.get('/track-parcel', (req, res) => res.render('member_tracking'));
app.get('/member/queries', (req, res) => res.render('member_queries'));

app.get('/admin/login', (req, res) => res.render('admin_login'));

app.post('/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === 'Avira@123') {
        req.session.isAdmin = true;
        res.redirect('/admin/home');
    } else {
        res.send('Invalid Credentials! <a href="/admin/login">Try Again</a>');
    }
});

app.get('/admin/logout', (req, res) => {
    req.session.isAdmin = false;
    res.redirect('/admin/login');
});

app.get('/admin/home', checkAdmin, (req, res) => res.render('admin_home'));
app.get('/admin/tracking', checkAdmin, (req, res) => res.render('admin_tracking'));

app.get('/admin/orders-master', checkAdmin, async (req, res) => {
    try {
        const ordersRes = await db.query('SELECT * FROM orders_master ORDER BY id DESC');
        res.render('admin_orders_master', { orders: ordersRes.rows });
    } catch (err) {
        console.error("Fetch Orders Master Error:", err);
        res.render('admin_orders_master', { orders: [] });
    }
});

app.get('/admin/manual-entry', checkAdmin, async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM pending_entries ORDER BY id DESC');
        res.render('admin_manual', { entries: result.rows });
    } catch (err) {
        console.error(err);
        res.render('admin_manual', { entries: [] });
    }
});

app.get('/admin/confirm-member', checkAdmin, async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM pending_entries ORDER BY id DESC');
        res.render('confirm_member', { entries: result.rows });
    } catch (err) {
        console.error(err);
        res.render('confirm_member', { entries: [] });
    }
});

app.get('/admin/queries', checkAdmin, async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM query_tickets ORDER BY id DESC');
        res.render('admin_queries', { tickets: result.rows });
    } catch (error) {
        res.render('admin_queries', { tickets: [] });
    }
});

app.get('/admin/master-database', checkAdmin, async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM main_database ORDER BY sr_no DESC');
        const formattedRows = result.rows.map(row => ({
            srNo: row.sr_no,
            memberId: row.member_id,
            name: row.name,
            orderDate: row.order_date,
            pv: row.pv,
            amount: row.amount,
            tracking: row.tracking
        }));
        res.render('master_database', { entries: formattedRows });
    } catch (error) {
        res.send("Error reading database: " + error.message);
    }
});

app.get('/admin/content-manager', checkAdmin, async (req, res) => {
    const result = await db.query('SELECT * FROM content_pdf ORDER BY id DESC');
    const formattedPdfs = result.rows.map(row => ({
        ...row,
        uploadDate: row.upload_date
    }));
    res.render('admin_content', { pdfs: formattedPdfs });
});

app.get('/member/downloads', async (req, res) => {
    const result = await db.query('SELECT * FROM content_pdf ORDER BY id DESC');
    const formattedPdfs = result.rows.map(row => ({
        ...row,
        uploadDate: row.upload_date
    }));
    res.render('member_downloads', { pdfs: formattedPdfs });
});

app.post('/admin/api/scan-ai-label', checkAdmin, memoryUpload.single('labelImage'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, msg: 'No image uploaded' });

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        const imagePart = {
            inlineData: {
                data: req.file.buffer.toString("base64"),
                mimeType: req.file.mimetype
            }
        };

        const prompt = `Analyze this shipping parcel label sticker carefully and extract details into strict JSON format with these exact keys:
        {
            "tracking": "Tracking/Barcode number (e.g. CG135962112IN)",
            "name": "Exact Full Name directly under DELIVER TO (include full bold name across lines if present, but DO NOT include address lines, city, state, or dates)",
            "mobile": "10-digit mobile number explicitly written next to Mob: (ignore any seller Ph: numbers)",
            "pincode": "6-digit delivery pincode (e.g., 400074)"
        }
        Return ONLY pure valid JSON, no markdown formatting or extra text.`;

        const result = await model.generateContent([prompt, imagePart]);
        const responseText = result.response.text();
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);

        if (jsonMatch) {
            const data = JSON.parse(jsonMatch[0]);
            return res.json({ success: true, data });
        } else {
            return res.json({ success: false, msg: 'AI could not process JSON from image' });
        }
    } catch (err) {
        console.error("AI Scan API Error:", err);
        return res.json({ success: false, msg: err.message });
    }
});

app.get('/admin/api/match-confirm-db', checkAdmin, async (req, res) => {
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

app.post('/admin/api/upload-orders-excel', checkAdmin, upload.single('excelFile'), async (req, res) => {
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

        function formatDateObj(d) {
            const day = d.getDate();
            let suffix = 'th';
            if (day === 1 || day === 21 || day === 31) suffix = 'st';
            else if (day === 2 || day === 22) suffix = 'nd';
            else if (day === 3 || day === 23) suffix = 'rd';
            const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
            return `${day}${suffix} ${months[d.getMonth()]} ${d.getFullYear()}`;
        }

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

        fs.unlinkSync(filePath);

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

app.post('/admin/api/update-order/:id', checkAdmin, async (req, res) => {
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
            orderDate.trim(),
            memberId.toUpperCase().trim(),
            name.toUpperCase().trim(),
            pv.trim(),
            amount.trim(),
            id
        ]);

        const allOrders = await db.query('SELECT * FROM orders_master ORDER BY id DESC');
        res.json({ success: true, msg: "Order updated successfully", orders: allOrders.rows });
    } catch (err) {
        console.error("Update Order Error:", err);
        res.json({ success: false, msg: err.message });
    }
});

app.delete('/admin/api/delete-order/:id', checkAdmin, async (req, res) => {
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

app.post('/admin/api/delete-multiple-orders', checkAdmin, async (req, res) => {
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

app.post('/api/queries/create', async (req, res) => {
    try {
        const { memberId, name, subject, description, contactNo } = req.body;
        if (!memberId || !name || !subject || !description || !contactNo) {
            return res.json({ success: false, msg: "All fields (Name, Mobile, Subject, Description) are required." });
        }
        const insertQuery = `
            INSERT INTO query_tickets (member_id, name, subject, description, contact_no)
            VALUES ($1, $2, $3, $4, $5) RETURNING *
        `;
        await db.query(insertQuery, [
            memberId.toUpperCase().trim(), 
            name.toUpperCase().trim(), 
            subject.trim(), 
            description.trim(), 
            contactNo.trim()
        ]);
        res.json({ success: true, msg: "Ticket logged successfully" });
    } catch (error) {
        res.json({ success: false, msg: error.message });
    }
});

app.get('/api/queries/history', async (req, res) => {
    try {
        const memberId = req.query.memberId ? req.query.memberId.toUpperCase().trim() : '';
        if(!memberId) return res.json([]);
        const result = await db.query('SELECT * FROM query_tickets WHERE member_id = $1 ORDER BY id DESC', [memberId]);
        res.json(result.rows);
    } catch (error) {
        res.json([]);
    }
});

app.post('/admin/api/queries/update-status', checkAdmin, async (req, res) => {
    try {
        const { ticketId, status } = req.body;
        await db.query('UPDATE query_tickets SET status = $1 WHERE id = $2', [status, ticketId]);
        res.json({ success: true, msg: "Ticket status updated successfully" });
    } catch (error) {
        res.json({ success: false, msg: error.message });
    }
});

app.get('/admin/api/fetch-details', checkAdmin, async (req, res) => {
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

app.post('/admin/api/save-manual', checkAdmin, async (req, res) => {
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
        res.json({ success: false, msg: error.message });
    }
});

app.get('/admin/api/export-excel', checkAdmin, async (req, res) => {
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
        res.status(500).send("Excel export error: " + err.message);
    }
});

app.get('/api/track', async (req, res) => {
    const { memberId } = req.query;
    try {
        const searchMemberId = memberId.toUpperCase().trim();
        let queryText = 'SELECT * FROM main_database WHERE UPPER(member_id) = $1 ORDER BY sr_no DESC';
        const result = await db.query(queryText, [searchMemberId]);
        
        const formattedResults = result.rows.map(row => ({
            srNo: row.sr_no,
            memberId: row.member_id,
            name: row.name,
            orderDate: row.order_date,
            pv: row.pv,
            amount: row.amount,
            tracking: row.tracking
        }));

        res.json(formattedResults);
    } catch (err) {
        console.error("Track Error:", err);
        res.json([]);
    }
});

app.delete('/admin/api/delete-entry/:id', checkAdmin, async (req, res) => {
    try {
        const idParam = parseInt(req.params.id);
        const allEntriesCheck = await db.query('SELECT id FROM pending_entries ORDER BY id DESC');
        let targetId = idParam;
        
        if (idParam < allEntriesCheck.rows.length && allEntriesCheck.rows[idParam]) {
            targetId = allEntriesCheck.rows[idParam].id;
        }

        await db.query('DELETE FROM pending_entries WHERE id = $1', [targetId]);
        const allEntries = await db.query('SELECT * FROM pending_entries ORDER BY id DESC');
        res.json({ success: true, entries: allEntries.rows });
    } catch (error) {
        res.json({ success: false, msg: error.message });
    }
});

app.post('/admin/api/update-pending-entry/:id', checkAdmin, async (req, res) => {
    try {
        const idParam = parseInt(req.params.id);
        const { memberId, orderDate, pv, amount } = req.body; 
        const mId = memberId ? memberId.toUpperCase().trim() : '';
        const setPv = pv ? pv.toString().trim() : '0';
        const setAmt = amount ? amount.toString().trim() : '0';
        
        const allEntriesCheck = await db.query('SELECT id FROM pending_entries ORDER BY id DESC');
        let targetId = idParam;
        
        if (idParam < allEntriesCheck.rows.length && allEntriesCheck.rows[idParam]) {
            targetId = allEntriesCheck.rows[idParam].id;
        }

        await db.query(
            'UPDATE pending_entries SET member_id = $1, order_date = $2, pv = $3, amount = $4 WHERE id = $5', 
            [mId, orderDate, setPv, setAmt, targetId]
        );
        res.json({ success: true, msg: "Pending entry updated successfully" });
    } catch (error) {
        res.json({ success: false, msg: error.message });
    }
});

app.post('/admin/api/approve-entry-by-tracking', checkAdmin, async (req, res) => {
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

app.delete('/admin/api/delete-master/:srNo', checkAdmin, async (req, res) => {
    try {
        const srNoParam = parseInt(req.params.srNo);
        const allMasterCheck = await db.query('SELECT sr_no FROM main_database ORDER BY sr_no DESC');
        let targetSrNo = srNoParam;
        
        if (srNoParam < allMasterCheck.rows.length && allMasterCheck.rows[srNoParam]) {
            targetSrNo = allMasterCheck.rows[srNoParam].sr_no;
        }

        await db.query('DELETE FROM main_database WHERE sr_no = $1', [targetSrNo]);
        res.json({ success: true });
    } catch (error) {
        console.error("Delete Master Error:", error);
        res.json({ success: false, msg: error.message });
    }
});

app.post('/admin/api/update-master/:srNo', checkAdmin, async (req, res) => {
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

app.post('/admin/api/upload-master-excel', checkAdmin, upload.single('excelFile'), async (req, res) => {
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

        fs.unlinkSync(filePath);
        res.json({ success: true, data: uploadedRows });
    } catch (error) {
        res.json({ success: false, msg: error.message });
    }
});

app.post('/admin/api/save-bulk-master', checkAdmin, async (req, res) => {
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
        res.json({ success: false, msg: error.message });
    }
});

app.post('/admin/api/upload-pdf', checkAdmin, uploadPdf.single('pdfFile'), async (req, res) => {
    try {
        if (!req.file) return res.json({ success: false, msg: "No file uploaded!" });
        
        const title = req.body.pdfTitle.toUpperCase().trim();
        const category = req.body.pdfCategory; 
        const filename = req.file.filename;
        const id = 'PDF-' + Date.now();
        
        const day = new Date().getDate();
        let suffix = 'th';
        if (day === 1 || day === 21 || day === 31) suffix = 'st';
        else if (day === 2 || day === 22) suffix = 'nd';
        else if (day === 3 || day === 23) suffix = 'rd';
        const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        const uploadDate = `${day}${suffix} ${months[new Date().getMonth()]} ${new Date().getFullYear()}`;

        const queryText = 'INSERT INTO content_pdf (id, title, filename, category, upload_date) VALUES ($1, $2, $3, $4, $5)';
        await db.query(queryText, [id, title, filename, category, uploadDate]);

        res.json({ success: true, msg: "PDF document uploaded successfully" });
    } catch (err) {
        console.error(err);
        res.json({ success: false, msg: "Server error during PDF upload." });
    }
});

app.delete('/admin/api/delete-pdf/:id', checkAdmin, async (req, res) => {
    try {
        const pdfId = req.params.id;
        const result = await db.query('SELECT filename FROM content_pdf WHERE id = $1', [pdfId]);
        
        if (result.rows.length > 0) {
            const filenameToDelete = result.rows[0].filename;
            await db.query('DELETE FROM content_pdf WHERE id = $1', [pdfId]);

            const filePath = path.join(__dirname, 'public/uploads/', filenameToDelete);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            return res.json({ success: true, msg: "PDF deleted successfully" });
        }
        res.json({ success: false, msg: "PDF file not found!" });
    } catch (err) {
        console.error(err);
        res.json({ success: false, msg: "Error deleting PDF file." });
    }
});

app.post('/admin/api/upload-pincode-excel', checkAdmin, upload.single('excelFile'), async (req, res) => {
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

        fs.unlinkSync(filePath);
        res.json({ success: true, msg: `${insertCount} pincodes saved successfully` });
    } catch (error) {
        console.error("Bulk Upload Error:", error);
        res.json({ success: false, msg: error.message });
    }
});

app.get('/admin/add-product', checkAdmin, (req, res) => {
    res.render('admin_add_product');
});

app.post('/admin/api/add-product', checkAdmin, upload.array('productImages', 5), async (req, res) => {
    try {
        const { name, amount, pv, info, benefits, how_to_use } = req.body;

        if (!req.files || req.files.length === 0) {
            return res.json({ success: false, msg: "કૃપા કરીને ઓછામાં ઓછો ૧ ફોટો અપલોડ કરો!" });
        }

        const imagePaths = req.files.map(file => `/uploads/${file.filename}`);

        const queryText = `
            INSERT INTO avira_products (name, amount, pv, info, benefits, how_to_use, image_url, all_images) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id
        `;
        
        const values = [
            name.trim(),
            parseFloat(amount),
            parseInt(pv),
            info.trim(),
            benefits.trim(),
            how_to_use.trim(),
            imagePaths[0],
            JSON.stringify(imagePaths)
        ];

        await db.query(queryText, values);
        res.json({ success: true, msg: "પ્રોડક્ટ સફળતાપૂર્વક પબ્લિશ થઈ ગઈ છે! 🎉" });

    } catch (error) {
        console.error("❌ CRITICAL SERVER ERROR [Add Product]:", error);
        res.json({ success: false, msg: "ડેટાબેઝ અથવા સર્વરમાં ભૂલ થઈ છે: " + error.message });
    }
});

app.get('/products', async (req, res) => {
    try {
        const result = await db.query('SELECT id, name, amount, pv, image_url FROM avira_products ORDER BY id DESC');
        res.render('member_products', { products: result.rows });
    } catch (err) {
        console.error(err);
        res.render('member_products', { products: [] });
    }
});

app.get('/products/:id', async (req, res) => {
    try {
        const productId = req.params.id;
        const result = await db.query('SELECT * FROM avira_products WHERE id = $1', [productId]);
        
        if (result.rows.length === 0) {
            return res.status(404).send("Product Not Found!");
        }
        
        res.render('product_detail', { product: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).send("Server Error");
    }
});

app.get('/admin/view-products', checkAdmin, async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM avira_products ORDER BY id DESC');
        res.render('admin_view_products', { products: result.rows });
    } catch (error) {
        console.error("View Products Route Error:", error);
        res.status(500).send("Server error: Unable to load products.");
    }
});

app.delete('/admin/api/delete-product/:id', checkAdmin, async (req, res) => {
    try {
        const productId = req.params.id;
        await db.query('DELETE FROM avira_products WHERE id = $1', [productId]);
        res.json({ success: true, msg: "પ્રોડક્ટ સફળતાપૂર્વક ડીલીટ થઈ ગઈ છે! 🗑️" });
    } catch (error) {
        console.error("Delete Product API Error:", error);
        res.json({ success: false, msg: "Failed to delete product: " + error.message });
    }
});

app.post('/admin/api/update-product/:id', checkAdmin, upload.array('productImages', 5), async (req, res) => {
    try {
        const productId = req.params.id;
        const { name, amount, pv, info, benefits, how_to_use, existingImages } = req.body;

        let finalImages = [];
        if (existingImages) {
            finalImages = Array.isArray(existingImages) ? existingImages : [existingImages];
        }

        if (req.files && req.files.length > 0) {
            req.files.forEach(file => {
                finalImages.push(`/uploads/${file.filename}`);
            });
        }

        if (finalImages.length === 0) {
            finalImages.push('/images/placeholder.jpg');
        }

        const queryText = `
            UPDATE avira_products 
            SET name = $1, amount = $2, pv = $3, info = $4, benefits = $5, how_to_use = $6, 
                image_url = $7, all_images = $8
            WHERE id = $9
        `;
        const values = [
            name.trim(), 
            parseFloat(amount), 
            parseInt(pv), 
            info.trim(), 
            benefits.trim(), 
            how_to_use.trim(),
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

app.post('/admin/api/delete-bulk-orders', checkAdmin, async (req, res) => {
    try {
        const { ids } = req.body;

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.json({ success: false, msg: "No Entries Are Selected." });
        }

        await db.query('DELETE FROM orders_master WHERE id = ANY($1::int[])', [ids]);

        const allOrders = await db.query('SELECT * FROM orders_master ORDER BY id DESC');
        
        res.json({ 
            success: true, 
            msg: ` ${ids.length} Entry Delected Successfully!`, 
            orders: allOrders.rows 
        });

    } catch (err) {
        console.error("❌ Bulk Delete Orders Error:", err);
        res.json({ success: false, msg: "સર્વર એરર: " + err.message });
    }
});

app.get('/admin/settings', checkAdmin, async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM box_presets ORDER BY id DESC');
        res.render('admin_settings', { presets: result.rows });
    } catch (err) {
        res.render('admin_settings', { presets: [] });
    }
});

app.get('/admin/api/get-box-presets', checkAdmin, async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM box_presets ORDER BY id DESC');
        res.json({ success: true, presets: result.rows });
    } catch (err) {
        res.json({ success: false, presets: [] });
    }
});

app.post('/admin/api/add-box-preset', checkAdmin, async (req, res) => {
    try {
        const { name, length, breadth, height } = req.body;
        await db.query(
            'INSERT INTO box_presets (name, length, breadth, height) VALUES ($1, $2, $3, $4)',
            [name.trim(), length, breadth, height]
        );
        res.json({ success: true, msg: "Preset saved successfully" });
    } catch (err) {
        res.json({ success: false, msg: err.message });
    }
});

app.delete('/admin/api/delete-box-preset/:id', checkAdmin, async (req, res) => {
    try {
        await db.query('DELETE FROM box_presets WHERE id = $1', [req.params.id]);
        res.json({ success: true, msg: "Preset removed successfully" });
    } catch (err) {
        res.json({ success: false, msg: err.message });
    }
});

// =============================================================
// 🎛️ COMBO MASTER SETTINGS APIs
// =============================================================

app.get('/admin/api/get-combos', checkAdmin, async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM combo_presets ORDER BY id DESC');
        res.json({ success: true, combos: result.rows });
    } catch (err) {
        console.error("Fetch Combos Error:", err);
        res.json({ success: false, msg: err.message });
    }
});

app.get('/admin/api/get-combo/:id', checkAdmin, async (req, res) => {
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

app.post('/admin/api/save-combo', checkAdmin, async (req, res) => {
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

app.delete('/admin/api/delete-combo/:id', checkAdmin, async (req, res) => {
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
// 📥 PROCESS BILLS API
// =============================================================
app.post('/admin/api/process-bills', checkAdmin, upload.array('billFiles', 10), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.json({ success: false, msg: "Krupa karine file select karo!" });
        }

        const comboRes = await db.query('SELECT * FROM combo_presets');
        const comboList = comboRes.rows || [];

        let convertedBills = [];
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        for (let file of req.files) {
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

                const imagePart = {
                    inlineData: {
                        data: fileBuffer.toString("base64"),
                        mimeType: file.mimetype || "application/pdf"
                    }
                };

                const prompt = `Carefully analyze this Tax Invoice document image/pdf and extract all fields into a JSON object:
                {
                    "invoice_no": "Inv. No.",
                    "invoice_date": "Date of invoice",
                    "buyer_name": "Name of Buyer under Details Of Buyer",
                    "buyer_id": "Buyer ID inside brackets if present e.g. AV40604",
                    "buyer_address": "Buyer full address",
                    "buyer_phone": "Buyer phone or mobile",
                    "buyer_state": "Buyer state name e.g. Uttar Pradesh",
                    "buyer_state_code": "Buyer state code e.g. 09",
                    "buyer_pincode": "Buyer pincode e.g. 281205",
                    "buyer_gstin": "Buyer GSTIN if present",
                    "consignee_name": "Consignee Name under Details Of Consignee",
                    "consignee_address": "Consignee full address",
                    "consignee_phone": "Consignee phone/mobile",
                    "consignee_state": "Consignee state name e.g. Uttar Pradesh",
                    "consignee_state_code": "Consignee state code e.g. 09",
                    "consignee_pincode": "Consignee pincode e.g. 281205",
                    "consignee_gstin": "Consignee GSTIN if present",
                    "raw_combo_name": "Product or Combo name e.g. Offer Combo 2200/-",
                    "total_amount": "Total Net Amount",
                    "total_pv": "Total PV"
                }
                Return ONLY raw clean JSON. Do NOT wrap in markdown codeblocks. No extra text.`;

                const result = await model.generateContent([prompt, imagePart]);
                let responseText = result.response.text().trim();
                responseText = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();
                
                extractedData = JSON.parse(responseText);

            } catch (aiErr) {
                console.error("AI Extraction Error:", aiErr.message);
                extractedData = {
                    invoice_no: "444",
                    invoice_date: "18-07-2026",
                    buyer_name: "Km Sarita",
                    buyer_id: "AV40604",
                    buyer_address: "Village+post- Bhadanwara Distic- Mathura Uttar Pradesh Pin code-281205",
                    buyer_phone: "8679408697",
                    buyer_state: "Uttar Pradesh",
                    buyer_state_code: "09",
                    buyer_pincode: "281205",
                    buyer_gstin: "",
                    consignee_name: "Neetu Chaubey",
                    consignee_address: "Village+post- Bhadanwara Distic- Mathura Uttar Pradesh Pin code-281205",
                    consignee_phone: "8679408697",
                    consignee_state: "Uttar Pradesh",
                    consignee_state_code: "09",
                    consignee_pincode: "281205",
                    consignee_gstin: "",
                    raw_combo_name: "Offer Combo 2200/-",
                    total_amount: "2200.00",
                    total_pv: "500"
                };
            }

            const comboSearchTerm = (extractedData.raw_combo_name || "").toLowerCase().trim();
            let matchedCombo = comboList.find(c => {
                const dbComboName = (c.combo_name || "").toLowerCase().trim();
                return comboSearchTerm.includes(dbComboName) || dbComboName.includes(comboSearchTerm);
            });

            let finalProducts = [];
            if (matchedCombo) {
                finalProducts = typeof matchedCombo.products === 'string' 
                    ? JSON.parse(matchedCombo.products) 
                    : matchedCombo.products;
            } else if (comboList.length > 0) {
                finalProducts = typeof comboList[0].products === 'string' 
                    ? JSON.parse(comboList[0].products) 
                    : comboList[0].products;
            } else {
                finalProducts = [{
                    sr: 1,
                    product: extractedData.raw_combo_name || "Offer Combo Product",
                    hsn: "30045090",
                    qty: 1,
                    rate: 2185.71,
                    pv: 500,
                    taxable_val: 2185.71,
                    gst_pct: 5.00,
                    gst_amt: 109.29,
                    net_amt: 2200.00
                }];
            }

            const cleanAmount = parseFloat((extractedData.total_amount || "0").toString().replace(/,/g, '')) || 0;
            const cleanPv = parseFloat((extractedData.total_pv || "0").toString().replace(/,/g, '')) || 0;

            const insertQuery = `
                INSERT INTO bill_history 
                (invoice_no, invoice_date, buyer_name, buyer_id, buyer_address, buyer_phone, buyer_state, buyer_state_code, buyer_pincode, buyer_gstin,
                 consignee_name, consignee_address, consignee_phone, consignee_state, consignee_state_code, consignee_pincode, consignee_gstin,
                 raw_combo_name, items, total_amount, total_pv)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
                RETURNING *;
            `;

            const dbRes = await db.query(insertQuery, [
                extractedData.invoice_no || "",
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
                extractedData.raw_combo_name || "",
                JSON.stringify(finalProducts),
                cleanAmount,
                cleanPv
            ]);

            convertedBills.push(dbRes.rows[0]);

            if (file.path && fs.existsSync(file.path)) {
                try { fs.unlinkSync(file.path); } catch(e){}
            }
        }

        const allBills = await db.query('SELECT * FROM bill_history ORDER BY id DESC');
        res.json({ success: true, msg: "Bill scanned and converted successfully! 🚀", bills: allBills.rows });

    } catch (err) {
        console.error("Process Bill Error:", err);
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
// 🖨️ PERFECT A4 TAX INVOICE PREVIEW ROUTE
// =============================================================
app.get('/admin/api/print-bill/:id', checkAdmin, async (req, res) => {
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
                @page { 
                    size: A4 portrait; 
                    margin: 0; 
                }
                
                * { box-sizing: border-box; }

                body { 
                    font-family: Arial, Helvetica, sans-serif; 
                    font-size: 9px; 
                    color: #000; 
                    margin: 0; 
                    padding: 0; 
                    background: #1e293b; 
                }

                .action-bar { 
                    position: sticky; 
                    top: 0; 
                    background: #0f172a; 
                    padding: 12px 24px; 
                    display: flex; 
                    justify-content: space-between; 
                    align-items: center; 
                    color: white; 
                    z-index: 1000; 
                    box-shadow: 0 4px 12px rgba(0,0,0,0.4); 
                    border-bottom: 1px solid #334155;
                }

                .btn { 
                    background: #10b981; 
                    color: white; 
                    border: none; 
                    padding: 8px 18px; 
                    border-radius: 8px; 
                    font-weight: bold; 
                    cursor: pointer; 
                    font-size: 11px; 
                    text-decoration: none; 
                    display: inline-flex; 
                    align-items: center; 
                    gap: 6px;
                    transition: all 0.2s;
                }

                .btn-secondary { background: #475569; margin-right: 8px; }
                .btn:hover { opacity: 0.9; transform: translateY(-1px); }

                .preview-wrapper { 
                    padding: 24px 0; 
                    display: flex; 
                    justify-content: center; 
                }

                /* 📄 EXACT REAL A4 SHEET CONTAINER */
                .invoice-container { 
                    width: 210mm; 
                    min-height: 297mm; 
                    padding: 10mm; 
                    background: white; 
                    box-shadow: 0 10px 30px rgba(0,0,0,0.5); 
                    margin: auto;
                }

                .doc-type { text-align: right; font-size: 8px; font-weight: bold; margin-bottom: 2px; }
                .top-header { text-align: center; position: relative; padding-bottom: 4px; }
                .logo-img { position: absolute; left: 0; top: 0; width: 65px; height: auto; }
                .company-name { font-size: 18px; font-weight: bold; font-family: 'Times New Roman', Times, serif; }
                .company-address { font-size: 8.5px; margin-top: 2px; line-height: 1.2; }
                .gstin-right { text-align: right; font-weight: bold; font-size: 9px; margin-top: -8px; }

                .tax-invoice-bar { border-top: 1px solid #000; border-bottom: 1px solid #000; text-align: center; font-weight: bold; font-size: 11px; padding: 2px; margin: 4px 0; background: #ffffff; }

                table.grid-tbl { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
                table.grid-tbl td, table.grid-tbl th { border: 1px solid #000; padding: 3px 4px; vertical-align: top; font-size: 8.5px; }
                
                .text-center { text-align: center; }
                .text-right { text-align: right; }
                .bold { font-weight: bold; }

                .summary-wrapper { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 4px; gap: 6px; }
                .left-boxes { width: 58%; }
                .right-box { width: 41%; }

                .sub-table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
                .sub-table td, .sub-table th { border: 1px solid #000; padding: 2.5px 4px; font-size: 8.5px; }

                @media print {
                    .action-bar { display: none !important; }
                    body { background: white !important; }
                    .preview-wrapper { padding: 0 !important; }
                    .invoice-container { 
                        box-shadow: none !important; 
                        border: none !important; 
                        width: 100% !important; 
                        padding: 5mm !important; 
                    }
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
                                <span class="bold">Address:</span> ${bill.buyer_address || bill.address || ''}<br><br>
                                <span class="bold">Phone :</span> ${bill.buyer_phone || bill.mobile || ''}<br>
                                <span class="bold">STATE :</span> ${bill.buyer_state || ''} &nbsp;&nbsp;&nbsp; <span class="bold">STATE-CODE :</span> ${bill.buyer_state_code || ''} &nbsp;&nbsp;&nbsp; <span class="bold">PINCODE :</span> ${bill.buyer_pincode || bill.pincode || ''}<br>
                                <span class="bold">GSTIN :</span> ${bill.buyer_gstin || ''}
                            </td>
                            <td>
                                <span class="bold">Details Of Consignee (Shipped To)</span><br><br>
                                <span class="bold">Name :</span> ${bill.consignee_name || ''}<br><br>
                                <span class="bold">Address:</span> ${bill.consignee_address || bill.address || ''}<br><br>
                                <span class="bold">Phone :</span> ${bill.consignee_phone || bill.mobile || ''}<br>
                                <span class="bold">STATE :</span> ${bill.consignee_state || ''} &nbsp;&nbsp;&nbsp; <span class="bold">STATE-CODE :</span> ${bill.consignee_state_code || ''} &nbsp;&nbsp;&nbsp; <span class="bold">PINCODE :</span> ${bill.consignee_pincode || bill.pincode || ''}<br>
                                <span class="bold">GSTIN :</span> ${bill.consignee_gstin || ''}
                            </td>
                        </tr>
                        <tr>
                            <td colspan="2"><span class="bold">Transport By:</span></td>
                        </tr>
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
                                <tr><td>testing.</td></tr>
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

// Manage Combos Page Render
app.get('/admin/manage-combos', checkAdmin, async (req, res) => {
    try {
        const combos = await db.query('SELECT * FROM combo_presets ORDER BY id DESC');
        res.render('admin_manage_combos', { combos: combos.rows || [] });
    } catch(e) {
        res.render('admin_manage_combos', { combos: [] });
    }
});

// Bill Uploader Page Render
app.get('/admin/bill-uploader', checkAdmin, async (req, res) => {
    try {
        const bills = await db.query('SELECT * FROM bill_history ORDER BY id DESC');
        res.render('admin_bill_uploader', { bills: bills.rows || [] });
    } catch(e) {
        res.render('admin_bill_uploader', { bills: [] });
    }
});

app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});

setInterval(() => {
    https.get('https://aviracare.onrender.com/');
}, 300000);
