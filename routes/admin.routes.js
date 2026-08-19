const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { checkAdmin } = require('../middleware/auth');

// 🔐 Admin Login Page
router.get('/login', (req, res) => {
    if (req.session && req.session.isAdmin) {
        return res.redirect('/admin/home');
    }
    const error = req.query.error || null;
    res.render('admin/login', { error });
});

// 🔑 Admin Login Authentication Handler
router.post('/login', (req, res) => {
    const { username, password } = req.body;
    const adminUser = process.env.ADMIN_USERNAME || 'admin';
    const adminPass = process.env.ADMIN_PASSWORD || 'Avira@123';
    
    const isAjax = req.xhr || 
                   req.headers['x-requested-with'] === 'XMLHttpRequest' ||
                   (req.headers.accept && req.headers.accept.includes('application/json')) ||
                   (req.headers['content-type'] && req.headers['content-type'].includes('application/json'));
    
    if (username === adminUser && password === adminPass) {
        req.session.isAdmin = true;
        if (isAjax) {
            return res.json({ success: true, redirectUrl: '/admin/home' });
        }
        res.redirect('/admin/home');
    } else {
        if (isAjax) {
            return res.status(401).json({ success: false, message: 'Invalid Admin Credentials! Access Denied.' });
        }
        res.render('admin/login', { error: 'Invalid Credentials! Please try again.' });
    }
});

// 🚪 Admin Logout Handler
router.get('/logout', (req, res) => {
    req.session.isAdmin = false;
    res.redirect('/admin/login');
});

// 📊 Admin Dashboard Hub
router.get('/home', checkAdmin, (req, res) => {
    res.render('admin/home');
});

// 🏷️ Admin Tracking & Label Generation
router.get('/tracking', checkAdmin, (req, res) => {
    res.render('admin/tracking');
});

// 📋 Admin Orders Master View
router.get('/orders-master', checkAdmin, async (req, res) => {
    try {
        const ordersRes = await db.query('SELECT * FROM orders_master ORDER BY id DESC');
        res.render('admin/orders_master', { orders: ordersRes.rows });
    } catch (err) {
        console.error("Fetch Orders Master Error:", err);
        res.render('admin/orders_master', { orders: [] });
    }
});

// ✍️ Admin Manual Entry View
router.get('/manual-entry', checkAdmin, async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM pending_entries ORDER BY id DESC');
        res.render('admin/manual_entry', { entries: result.rows });
    } catch (err) {
        console.error("Fetch Manual Entry Error:", err);
        res.render('admin/manual_entry', { entries: [] });
    }
});

// 🤝 Admin Confirm & Match Member View
router.get('/confirm-member', checkAdmin, async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM pending_entries ORDER BY id DESC');
        res.render('admin/confirm_member', { entries: result.rows });
    } catch (err) {
        console.error("Fetch Confirm Member Error:", err);
        res.render('admin/confirm_member', { entries: [] });
    }
});

// 📨 Admin Helpdesk Queries View
router.get('/queries', checkAdmin, async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM query_tickets ORDER BY id DESC');
        
        const formattedTickets = result.rows.map(ticket => {
            let formattedCreatedAt = '';
            let formattedRepliedAt = '';

            if (ticket.created_at) {
                const d = new Date(ticket.created_at);
                if (!isNaN(d.getTime())) {
                    formattedCreatedAt = d.toLocaleString('en-IN', {
                        timeZone: 'Asia/Kolkata',
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true
                    });
                }
            }

            if (ticket.replied_at) {
                const rd = new Date(ticket.replied_at);
                if (!isNaN(rd.getTime())) {
                    formattedRepliedAt = rd.toLocaleString('en-IN', {
                        timeZone: 'Asia/Kolkata',
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true
                    });
                }
            }

            return {
                ...ticket,
                formattedCreatedAt: formattedCreatedAt || 'N/A',
                formattedRepliedAt
            };
        });

        res.render('admin/queries', { tickets: formattedTickets });
    } catch (error) {
        console.error("Fetch Admin Queries Error:", error);
        res.render('admin/queries', { tickets: [] });
    }
});

// 🗄️ Admin Master Database View
router.get('/master-database', checkAdmin, async (req, res) => {
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
        res.render('admin/master_database', { entries: formattedRows });
    } catch (error) {
        console.error("Fetch Master Database Error:", error);
        res.send("Error reading database: " + error.message);
    }
});

// 📑 Admin Content & PDF Manager View
router.get('/content-manager', checkAdmin, async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM content_pdf ORDER BY id DESC');
        const formattedPdfs = result.rows.map(row => {
            let fileSizeStr = 'PDF File';
            try {
                let candidateLocalName = row.filename || '';
                if (candidateLocalName.startsWith('http')) {
                    const parts = candidateLocalName.split('/');
                    candidateLocalName = parts[parts.length - 1];
                } else if (candidateLocalName.startsWith('/uploads/')) {
                    candidateLocalName = candidateLocalName.replace('/uploads/', '');
                }

                const fullPath = path.join(__dirname, '..', 'public', 'uploads', candidateLocalName);
                if (fs.existsSync(fullPath)) {
                    const stats = fs.statSync(fullPath);
                    const bytes = stats.size;
                    if (bytes >= 1048576) {
                        fileSizeStr = (bytes / 1048576).toFixed(2) + ' MB';
                    } else {
                        fileSizeStr = (bytes / 1024).toFixed(1) + ' KB';
                    }
                }
            } catch (e) {}

            return {
                ...row,
                viewUrl: `/api/documents/view/${row.id}`,
                downloadUrl: `/api/documents/download/${row.id}`,
                fileUrl: `/api/documents/view/${row.id}`,
                isCloud: row.filename && row.filename.startsWith('http'),
                fileSize: fileSizeStr,
                uploadDate: row.upload_date || 'N/A'
            };
        });

        const stats = {
            total: formattedPdfs.length,
            plans: formattedPdfs.filter(p => p.category === 'BUSINESS_PLAN').length,
            catalogs: formattedPdfs.filter(p => p.category === 'PRODUCT_CATALOG').length,
            others: formattedPdfs.filter(p => p.category !== 'BUSINESS_PLAN' && p.category !== 'PRODUCT_CATALOG').length
        };

        res.render('admin/content_manager', { pdfs: formattedPdfs, stats });
    } catch (error) {
        console.error("Fetch Content PDFs Error:", error);
        res.render('admin/content_manager', { 
            pdfs: [], 
            stats: { total: 0, plans: 0, catalogs: 0, others: 0 } 
        });
    }
});

// ➕ Admin Add Product View
router.get('/add-product', checkAdmin, (req, res) => {
    res.render('admin/add_product');
});

// 🛍️ Admin View & Edit Products View
router.get('/view-products', checkAdmin, async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM avira_products ORDER BY id DESC');
        res.render('admin/view_products', { products: result.rows });
    } catch (error) {
        console.error("View Products Route Error:", error);
        res.status(500).send("Server error: Unable to load products.");
    }
});

// ⚙️ Admin Settings & Box Presets View
router.get('/settings', checkAdmin, async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM box_presets ORDER BY id DESC');
        res.render('admin/settings', { presets: result.rows });
    } catch (err) {
        console.error("Admin Settings Error:", err);
        res.render('admin/settings', { presets: [] });
    }
});

module.exports = router;
