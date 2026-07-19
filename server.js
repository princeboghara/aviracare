const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const multer = require('multer');
const ExcelJS = require('exceljs');
const fs = require('fs');
const db = require('./db.js'); // 🔌 ડેટાબેઝ કનેક્શન

const app = express(); 
const session = require('express-session');

// ==========================================
// 🔒 SECURE SESSION CONFIGURATION
// ==========================================
app.use(session({
    secret: 'avira-secret-key-2026', // Secure Session Key
    resave: false,
    saveUninitialized: false
}));

// 🛡️ Admin Authentication Gatekeeper Middleware
function checkAdmin(req, res, next) {
    if (req.session && req.session.isAdmin) {
        next(); // Authorization Granted
    } else {
        res.redirect('/admin/login'); // Unauthorized - Kick back to Login
    }
}

const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 🎯 FIXED: પ્રોપર સ્ટેટિક કન્ફિગરેશન (બ્રાઉઝર પબ્લિકલી ફોટા એક્સેસ કરી શકશે)
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// ==========================================
// 📂 MULTI-IMAGE & PDF UNIFORM STORAGE SETUP
// ==========================================
const sharedStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        // બધા જ મીડિયા ફાઇલો એક જ સેફ પબ્લિક ફોલ્ડરમાં જશે
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

// 🎯 FIXED: બંને ઇનપુટ માટે સેમ એક્સ્ટેન્શન ક્લીન સ્ટોરેજ એન્જિન લિંક કરી દીધું
const upload = multer({ storage: sharedStorage });
const uploadPdf = multer({ storage: sharedStorage });

// 🚀 MASTER EXCEL PATHS
const PINCODE_FILE = path.join(__dirname, 'master_files', 'pincode.xlsx');
const ORDERS_FILE = path.join(__dirname, 'master_files', 'orders.xlsx');

// ------------------ FRONTEND PUBLIC PAGES ROUTES ------------------

// Main Home Page - Dynamic PDF Fetch Loader
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

// Member Query Workspace Route
app.get('/member/queries', (req, res) => {
    res.render('member_queries');
});

// ------------------ 🔑 ADMIN CREDENTIAL AUTHENTICATION ------------------

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

// ------------------ 🔒 100% LOCKED & SECURED ADMIN ROUTES ------------------

app.get('/admin/home', checkAdmin, (req, res) => res.render('admin_home'));
app.get('/admin/tracking', checkAdmin, (req, res) => res.render('admin_tracking'));

// Manual Entry Workspace
app.get('/admin/manual-entry', checkAdmin, async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM pending_entries ORDER BY id DESC');
        res.render('admin_manual', { entries: result.rows });
    } catch (err) {
        console.error(err);
        res.render('admin_manual', { entries: [] });
    }
});

// Member Verification Desk
app.get('/admin/confirm-member', checkAdmin, async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM pending_entries ORDER BY id DESC');
        res.render('confirm_member', { entries: result.rows });
    } catch (err) {
        console.error(err);
        res.render('confirm_member', { entries: [] });
    }
});

// Admin Control Hub Query Desk Router
app.get('/admin/queries', checkAdmin, async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM query_tickets ORDER BY id DESC');
        res.render('admin_queries', { tickets: result.rows });
    } catch (error) {
        res.render('admin_queries', { tickets: [] });
    }
});

// Live Master Database View
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

// Content Manager Workspace Router
app.get('/admin/content-manager', checkAdmin, async (req, res) => {
    const result = await db.query('SELECT * FROM content_pdf ORDER BY id DESC');
    const formattedPdfs = result.rows.map(row => ({
        ...row,
        uploadDate: row.upload_date
    }));
    res.render('admin_content', { pdfs: formattedPdfs });
});

// Public Member Downloads Repository Alias
app.get('/member/downloads', async (req, res) => {
    const result = await db.query('SELECT * FROM content_pdf ORDER BY id DESC');
    const formattedPdfs = result.rows.map(row => ({
        ...row,
        uploadDate: row.upload_date
    }));
    res.render('member_downloads', { pdfs: formattedPdfs });
});

// ------------------ ⚡ SMART BACKEND OPERATIONS & SYSTEM APIs ------------------

// Member Ticket Generation Web API Endpoint
app.post('/api/queries/create', async (req, res) => {
    try {
        const { memberId, subject, description, contactNo } = req.body;
        if (!memberId || !subject || !description || !contactNo) {
            return res.json({ success: false, msg: "All fields are required!" });
        }
        const insertQuery = `
            INSERT INTO query_tickets (member_id, subject, description, contact_no)
            VALUES ($1, $2, $3, $4) RETURNING *
        `;
        await db.query(insertQuery, [memberId.toUpperCase().trim(), subject.trim(), description.trim(), contactNo.trim()]);
        res.json({ success: true, msg: "Your ticket has been logged successfully! 🚀" });
    } catch (error) {
        res.json({ success: false, msg: error.message });
    }
});

// Member Historical Tickets Fetch Pipeline API
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

// Admin Ticket Status Update State Mutator API Engine
app.post('/admin/api/queries/update-status', checkAdmin, async (req, res) => {
    try {
        const { ticketId, status } = req.body;
        await db.query('UPDATE query_tickets SET status = $1 WHERE id = $2', [status, ticketId]);
        res.json({ success: true, msg: "Ticket status modified successfully!" });
    } catch (error) {
        res.json({ success: false, msg: error.message });
    }
});

// Auto-Fetch Smart Pincode Map & Customer Validation API
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
        console.error("❌ Neon Fetch Error Details:", error); 
        res.json({ success: false, msg: error.message });
    }
});

// Admin Manual Entry Creator Endpoint
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

// India Post Uniform Matrix Format Excel Generator Engine
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
                s_add1: 'The Galleria Bussiness Hub 2',
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

// Public Dynamic Tracking API for Members
app.get('/api/track', async (req, res) => {
    const { memberId, fromDate, toDate } = req.query;
    try {
        const searchMemberId = memberId.toUpperCase().trim();
        let queryText = 'SELECT * FROM main_database WHERE UPPER(member_id) = $1';
        let params = [searchMemberId];

        queryText += ' ORDER BY sr_no DESC';
        const result = await db.query(queryText, params);
        
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
        console.error("❌ TRACK ERROR:", err);
        res.json([]);
    }
});

// Admin Pending Row Shredder API
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

// Inline Pending Entry Data Editor API
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
        res.json({ success: true, msg: "Row updated in pending_entries database" });
    } catch (error) {
        res.json({ success: false, msg: error.message });
    }
});

// Commit Pending Row to Master Production DB Engine API
app.post('/admin/api/approve-entry-by-tracking', checkAdmin, async (req, res) => {
    const { tracking } = req.body;
    if (!tracking) return res.json({ success: false, msg: "Tracking number required" });

    try {
        const pendingResult = await db.query('SELECT * FROM pending_entries WHERE UPPER(tracking) = $1', [tracking.trim().toUpperCase()]);
        if (pendingResult.rows.length === 0) {
            return res.json({ success: false, msg: "Entry not found in pending list" });
        }
        
        const approvedData = pendingResult.rows[0];

        const insertQuery = `
            INSERT INTO main_database (member_id, name, order_date, pv, amount, tracking)
            VALUES ($1, $2, $3, $4, $5, $6)
        `;
        const insertValues = [
            approvedData.member_id || '', 
            approvedData.name || '',
            approvedData.order_date || '', 
            approvedData.pv || '0', 
            approvedData.amount || '0', 
            approvedData.tracking || ''
        ];
        await db.query(insertQuery, insertValues);
        await db.query('DELETE FROM pending_entries WHERE id = $1', [approvedData.id]);

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.json({ success: false, msg: err.message });
    }
});

// Master Row Purge Endpoint API
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
        console.error("❌ DELETE MASTER ERROR:", error);
        res.json({ success: false, msg: error.message });
    }
});

// Bulk Import Matrix Excel Pipeline Parser
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

// Matrix Array Bulk Stash API
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
        res.json({ success: true, msg: `${entries.length} entries pushed to Pending List successfully! 🚀` });
    } catch (error) {
        res.json({ success: false, msg: error.message });
    }
});

// Corporate PDF Asset Push Handler
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

        res.json({ success: true, msg: "PDF Document Uploaded to Database Successfully!" });
    } catch (err) {
        console.error(err);
        res.json({ success: false, msg: "Server error during PDF upload." });
    }
});

// Asset Discard Pipeline Engine
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
            return res.json({ success: true, msg: "PDF Deleted from database and storage!" });
        }
        res.json({ success: false, msg: "PDF Not Found!" });
    } catch (err) {
        console.error(err);
        res.json({ success: false, msg: "Error deleting PDF." });
    }
});

// Master Logistics Pincode Registry Seeder API
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
        res.json({ success: true, msg: `Success! ${insertCount} pincodes saved to Neon Database.` });
    } catch (error) {
        console.error("❌ Bulk Upload Error:", error);
        res.json({ success: false, msg: error.message });
    }
});

// Pre-verification Multi-matrix Auto Match Parser API Engine
app.post('/admin/api/match-confirm-excel', checkAdmin, upload.single('excelFile'), async (req, res) => {
    try {
        if (!req.file) return res.json({ success: false, msg: "Please select an Excel file." });

        const filePath = req.file.path;
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(filePath);
        const worksheet = workbook.getWorksheet(1) || workbook.worksheets[0];

        let excelRowsMap = {};

        if (worksheet) {
            for(let rowNumber = 3; rowNumber <= worksheet.rowCount; rowNumber++) {
                const row = worksheet.getRow(rowNumber);
                
                const rawDate = row.getCell(2).text ? row.getCell(2).text.trim() : ''; 
                const memberId = row.getCell(5).text ? row.getCell(5).text.trim().toUpperCase() : ''; 
                const name = row.getCell(6).text ? row.getCell(6).text.trim().toUpperCase() : ''; 
                const pv = row.getCell(8).value ? row.getCell(8).value.toString().trim() : '0'; 
                const amount = row.getCell(9).value ? row.getCell(9).value.toString().trim() : '0'; 

                let dateStr = rawDate;
                if (row.getCell(2).value instanceof Date) {
                    const d = row.getCell(2).value;
                    const day = d.getDate();
                    let suffix = 'th';
                    if (day === 1 || day === 21 || day === 31) suffix = 'st';
                    else if (day === 2 || day === 22) suffix = 'nd';
                    else if (day === 3 || day === 23) suffix = 'rd';
                    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
                    dateStr = `${day}${suffix} ${months[d.getMonth()]} ${d.getFullYear()}`;
                }

                if (name) {
                    excelRowsMap[name] = { dateStr, memberId, pv, amount };
                }
            }
        }

        fs.unlinkSync(filePath); 
        res.json({ success: true, excelData: excelRowsMap });
    } catch (error) {
        res.json({ success: false, msg: error.message });
    }
});

// ==========================================
// 📦 VERSION 1.1: ADMIN PRODUCT MANAGEMENT
// ==========================================

// ૧. એડમિન પ્રોડક્ટ એડ કરવાનું પેજ વ્યૂ
app.get('/admin/add-product', checkAdmin, (req, res) => {
    res.render('admin_add_product');
});

// 📦 ૧૦૦% પરફેક્ટ અને સિક્યોર પ્રોડક્ટ એડ કરવાની API 🚀
app.post('/admin/api/add-product', checkAdmin, upload.array('productImages', 5), async (req, res) => {
    try {
        const { name, amount, pv, info, benefits, how_to_use } = req.body;

        // ૧. ચેક કરો કે ફાઈલો અપલોડ થઈ છે કે નહીં
        if (!req.files || req.files.length === 0) {
            return res.json({ success: false, msg: "કૃપા કરીને ઓછામાં ઓછો ૧ ફોટો અપલોડ કરો!" });
        }

        // ૨. બધી જ અપલોડ થયેલી ઈમેજીસના પાથ એક એરેમાં સેવ કરો
        const imagePaths = req.files.map(file => `/uploads/${file.filename}`);

        // ૩. ડેટાબેઝ ક્વેરી ફાયર કરો
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
            imagePaths[0], // Main display image string path
            JSON.stringify(imagePaths) // Store all images path as text/JSON
        ];

        await db.query(queryText, values);
        res.json({ success: true, msg: "પ્રોડક્ટ સફળતાપૂર્વક પબ્લિશ થઈ ગઈ છે! 🎉" });

    } catch (error) {
        console.error("❌ CRITICAL SERVER ERROR [Add Product]:", error);
        res.json({ success: false, msg: "ડેટાબેઝ અથવા સર્વરમાં ભૂલ થઈ છે: " + error.message });
    }
});

// ==========================================
// 🛒 VERSION 1.1: MEMBER PRODUCT CATALOG
// ==========================================

// 1. બધી પ્રોડક્ટ્સ એમેઝોન સ્ટાઈલ ગ્રીડમાં બતાવવાનું પેજ
app.get('/products', async (req, res) => {
    try {
        const result = await db.query('SELECT id, name, amount, pv, image_url FROM avira_products ORDER BY id DESC');
        res.render('member_products', { products: result.rows });
    } catch (err) {
        console.error(err);
        res.render('member_products', { products: [] });
    }
});

// 2. કોઈ સિંગલ પ્રોડક્ટ પર ક્લિક કરે ત્યારે તેનું ડિટેઇલ પેજ
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

// ૧. પ્રોડક્ટ્સ જોવા માટેનું મેઈન પેજ રાઉટ 📦
app.get('/admin/view-products', checkAdmin, async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM avira_products ORDER BY id DESC');
        res.render('admin_view_products', { products: result.rows });
    } catch (error) {
        console.error("❌ View Products Route Error:", error);
        res.status(500).send("સર્વર એરર: પ્રોડક્ટ્સ લોડ થઈ શકી નથી.");
    }
});

// ૨. કોઈ પ્રોડક્ટને ઇન્સ્ટન્ટ ડીલીટ કરવાની API ❌
app.delete('/admin/api/delete-product/:id', checkAdmin, async (req, res) => {
    try {
        const productId = req.params.id;
        await db.query('DELETE FROM avira_products WHERE id = $1', [productId]);
        res.json({ success: true, msg: "પ્રોડક્ટ સફળતાપૂર્વક ડીલીટ થઈ ગઈ છે! 🗑️" });
    } catch (error) {
        console.error("❌ Delete Product API Error:", error);
        res.json({ success: false, msg: "ડીલીટ કરવામાં ભૂલ થઈ: " + error.message });
    }
});

// 🔄 પ્રોડક્ટની વિગતો અને મલ્ટિપલ ઈમેજ લાઈવ અપડેટ કરવાની API ⚡
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
        console.error("❌ Update Product API Error:", error);
        res.json({ success: false, msg: "અપડેટ કરવામાં ભૂલ થઈ: " + error.message });
    }
});

// ------------------ SERVER KEEPALIVE ENGINE ------------------
app.listen(PORT, () => {
    console.log(`🚀 Engine running on http://localhost:${PORT}`);
});

// Production Render Automated Keepalive Route Trigger
const https = require('https');
setInterval(() => {
    https.get('https://aviracare.onrender.com/');
}, 300000); // 5 Minutes Interval Loop Trigger