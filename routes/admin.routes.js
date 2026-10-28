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
    const adminUser = process.env.ADMIN_USERNAME || process.env.ADMIN_USER || 'admin';
    const adminPass = process.env.ADMIN_PASSWORD || process.env.ADMIN_PASS || 'Avira@123';
    
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

// ⚡ Root Admin Redirect
router.get('/', (req, res) => {
    res.redirect('/admin/home');
});

// 📊 Admin Dashboard Hub
router.get('/home', checkAdmin, (req, res) => {
    res.render('admin/home');
});

// 🏷️ Admin Tracking & Label Generation
router.get('/tracking', checkAdmin, (req, res) => {
    res.render('admin/tracking');
});

// 🚚 Admin Live Tracking Hub (India Post Integration)
router.get('/live-tracking', checkAdmin, async (req, res) => {
    try {
        const indiaPostBot = require('../config/indiapost_sync');
        const dbResult = await db.query(`
            SELECT 
                sr_no, member_id, name, order_date, pv, amount, tracking,
                delivery_status, destination, booked_date, delivery_date, last_sync_time
            FROM main_database 
            WHERE tracking IS NOT NULL AND tracking != '' AND tracking != 'PENDING'
            ORDER BY sr_no DESC
        `);

        const statsResult = await db.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE LOWER(delivery_status) LIKE '%delivered%') as delivered,
                COUNT(*) FILTER (WHERE LOWER(delivery_status) LIKE '%transit%') as in_transit,
                COUNT(*) FILTER (WHERE LOWER(delivery_status) LIKE '%dispatch%') as dispatched,
                COUNT(*) FILTER (WHERE delivery_status IS NULL OR LOWER(delivery_status) LIKE '%pending%') as pending
            FROM main_database
            WHERE tracking IS NOT NULL AND tracking != '' AND tracking != 'PENDING'
        `);

        const botStatus = indiaPostBot.getStatus();
        res.render('admin/live_tracking', {
            consignments: dbResult.rows,
            stats: statsResult.rows[0],
            botStatus
        });
    } catch (err) {
        console.error("Fetch Live Tracking Error:", err);
        res.render('admin/live_tracking', {
            consignments: [],
            stats: { total: 0, delivered: 0, in_transit: 0, dispatched: 0, pending: 0 },
            botStatus: null
        });
    }
});

// 📋 Admin Orders Master View
router.get('/orders-master', checkAdmin, async (req, res) => {
    try {
        const orderSyncBot = require('../config/order_sync');
        const ordersRes = await db.query(`
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
                WHERE (order_no = om.order_no OR (member_id = om.member_id AND om.member_id IS NOT NULL AND om.member_id != ''))
                  AND tracking IS NOT NULL AND TRIM(tracking) != ''
                ORDER BY id DESC LIMIT 1
            ) cp ON true
            LEFT JOIN LATERAL (
                SELECT tracking 
                FROM main_database 
                WHERE (order_no = om.order_no OR (member_id = om.member_id AND om.member_id IS NOT NULL AND om.member_id != ''))
                  AND tracking IS NOT NULL AND TRIM(tracking) != ''
                ORDER BY sr_no DESC LIMIT 1
            ) mb ON true
            ORDER BY 
                CASE 
                    WHEN om.order_no ~ '^ORD-[0-9]+$' THEN CAST(SUBSTRING(om.order_no FROM 5) AS INTEGER)
                    ELSE om.id 
                END DESC
        `);
        const syncStatus = await orderSyncBot.getStatus();
        res.render('admin/orders_master', { orders: ordersRes.rows, syncStatus });
    } catch (err) {
        console.error("Fetch Orders Master Error:", err);
        res.render('admin/orders_master', { orders: [], syncStatus: null });
    }
});

// ✍️ Admin Manual Entry View
router.get('/manual-entry', checkAdmin, async (req, res) => {
    try {
        const consignmentId = req.query.consignmentId ? parseInt(req.query.consignmentId, 10) : null;
        
        // Fetch all consignments with parcel count
        const consignmentsRes = await db.query(`
            SELECT c.*, 
                   COALESCE(COUNT(p.id), 0)::int as total_parcels
            FROM consignments c
            LEFT JOIN consignment_parcels p ON c.id = p.consignment_id
            GROUP BY c.id
            ORDER BY c.id DESC
        `);

        let activeConsignment = null;
        let activeParcels = [];

        if (consignmentId) {
            const cRes = await db.query('SELECT * FROM consignments WHERE id = $1', [consignmentId]);
            if (cRes.rows.length > 0) {
                activeConsignment = cRes.rows[0];
                const pRes = await db.query('SELECT * FROM consignment_parcels WHERE consignment_id = $1 ORDER BY id DESC', [consignmentId]);
                activeParcels = pRes.rows;
            }
        }

        res.render('admin/manual_entry', { 
            consignments: consignmentsRes.rows,
            activeConsignment,
            activeParcels,
            consignmentId: activeConsignment ? activeConsignment.id : null
        });
    } catch (err) {
        console.error("Fetch Manual Entry Error:", err);
        res.render('admin/manual_entry', { 
            consignments: [],
            activeConsignment: null,
            activeParcels: [],
            consignmentId: null
        });
    }
});

// 👥 Admin Customers & Members Directory View
router.get('/customers', checkAdmin, async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM customers ORDER BY id ASC');
        res.render('admin/customers', { customers: result.rows });
    } catch (err) {
        console.error("Fetch Customers Error:", err);
        res.render('admin/customers', { customers: [] });
    }
});

// Legacy redirect from /confirm-member to /master-database
router.get('/confirm-member', checkAdmin, (req, res) => {
    res.redirect('/admin/master-database');
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
            orderNo: row.order_no || '-',
            memberId: row.member_id,
            name: row.name,
            orderDate: row.order_date,
            pv: row.pv,
            amount: row.amount,
            tracking: row.tracking || '',
            deliveryStatus: row.delivery_status || 'Pending'
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

// 📄 Admin Bill Uploader & Converter View (Temporarily Locked)
router.get('/bill-uploader', checkAdmin, (req, res) => {
    res.redirect('/admin/home?locked=bill-combo');
});

// 🎛️ Admin Manage Combo Presets View (Temporarily Locked)
router.get('/manage-combos', checkAdmin, (req, res) => {
    res.redirect('/admin/home?locked=bill-combo');
});

module.exports = router;

