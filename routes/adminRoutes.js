const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { checkAdmin } = require('../middleware/auth');

// Login Page
router.get('/admin/login', (req, res) => res.render('admin_login'));

router.post('/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === 'Avira@123') {
        req.session.isAdmin = true;
        res.redirect('/admin/home');
    } else {
        res.send('Invalid Credentials! <a href="/admin/login">Try Again</a>');
    }
});

router.get('/admin/logout', (req, res) => {
    req.session.isAdmin = false;
    res.redirect('/admin/login');
});

// Admin Pages
router.get('/admin/home', checkAdmin, (req, res) => res.render('admin_home'));
router.get('/admin/tracking', checkAdmin, (req, res) => res.render('admin_tracking'));

router.get('/admin/orders-master', checkAdmin, async (req, res) => {
    try {
        const ordersRes = await db.query('SELECT * FROM orders_master ORDER BY id DESC');
        res.render('admin_orders_master', { orders: ordersRes.rows });
    } catch (err) {
        res.render('admin_orders_master', { orders: [] });
    }
});

router.get('/admin/manual-entry', checkAdmin, async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM pending_entries ORDER BY id DESC');
        res.render('admin_manual', { entries: result.rows });
    } catch (err) {
        res.render('admin_manual', { entries: [] });
    }
});

router.get('/admin/confirm-member', checkAdmin, async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM pending_entries ORDER BY id DESC');
        res.render('confirm_member', { entries: result.rows });
    } catch (err) {
        res.render('confirm_member', { entries: [] });
    }
});

router.get('/admin/queries', checkAdmin, async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM query_tickets ORDER BY id DESC');
        res.render('admin_queries', { tickets: result.rows });
    } catch (error) {
        res.render('admin_queries', { tickets: [] });
    }
});

router.get('/admin/master-database', checkAdmin, async (req, res) => {
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

router.get('/admin/content-manager', checkAdmin, async (req, res) => {
    const result = await db.query('SELECT * FROM content_pdf ORDER BY id DESC');
    const formattedPdfs = result.rows.map(row => ({
        ...row,
        uploadDate: row.upload_date
    }));
    res.render('admin_content', { pdfs: formattedPdfs });
});

router.get('/admin/add-product', checkAdmin, (req, res) => {
    res.render('admin_add_product');
});

router.get('/admin/view-products', checkAdmin, async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM avira_products ORDER BY id DESC');
        res.render('admin_view_products', { products: result.rows });
    } catch (error) {
        res.status(500).send("Server error: Unable to load products.");
    }
});

router.get('/admin/settings', checkAdmin, async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM box_presets ORDER BY id DESC');
        res.render('admin_settings', { presets: result.rows });
    } catch (err) {
        res.render('admin_settings', { presets: [] });
    }
});

router.get('/admin/manage-combos', checkAdmin, async (req, res) => {
    try {
        const combos = await db.query('SELECT * FROM combo_presets ORDER BY id DESC');
        res.render('admin_manage_combos', { combos: combos.rows || [] });
    } catch(e) {
        res.render('admin_manage_combos', { combos: [] });
    }
});

router.get('/admin/bill-uploader', checkAdmin, async (req, res) => {
    try {
        const bills = await db.query('SELECT * FROM bill_history ORDER BY id DESC');
        res.render('admin_bill_uploader', { bills: bills.rows || [] });
    } catch(e) {
        res.render('admin_bill_uploader', { bills: [] });
    }
});

module.exports = router;