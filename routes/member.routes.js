const express = require('express');
const router = express.Router();
const db = require('../db');

// 🏠 Homepage / Member Portal Hub
router.get('/', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM content_pdf');
        const pdfList = result.rows;
        
        const latestBusinessPlan = pdfList.filter(p => p.category === 'BUSINESS_PLAN').pop();
        const latestCatalog = pdfList.filter(p => p.category === 'PRODUCT_CATALOG').pop();

        res.render('member/home', { 
            businessPlan: latestBusinessPlan ? `/uploads/${latestBusinessPlan.filename}` : '#',
            catalog: latestCatalog ? `/uploads/${latestCatalog.filename}` : '#'
        });
    } catch (err) {
        console.error("Home route error:", err);
        res.render('member/home', { businessPlan: '#', catalog: '#' });
    }
});

// 📦 Product Showcase
router.get('/products', async (req, res) => {
    try {
        const result = await db.query('SELECT id, name, amount, pv, image_url FROM avira_products ORDER BY id DESC');
        res.render('member/products', { products: result.rows });
    } catch (err) {
        console.error("Products catalog error:", err);
        res.render('member/products', { products: [] });
    }
});

// 🔍 Product Detail View
router.get('/products/:id', async (req, res) => {
    try {
        const productId = req.params.id;
        const result = await db.query('SELECT * FROM avira_products WHERE id = $1', [productId]);
        
        if (result.rows.length === 0) {
            return res.status(404).render('member/product_detail', { product: null });
        }
        
        res.render('member/product_detail', { product: result.rows[0] });
    } catch (err) {
        console.error("Product detail error:", err);
        res.status(500).send("Server Error");
    }
});

// 🚚 Live Parcel Tracking Page
router.get('/track-parcel', (req, res) => {
    res.render('member/tracking');
});

// 📡 Live Tracking API Lookup
router.get('/api/track', async (req, res) => {
    const { memberId } = req.query;
    try {
        if (!memberId) return res.json([]);
        const searchMemberId = memberId.toUpperCase().trim();
        const queryText = 'SELECT * FROM main_database WHERE UPPER(member_id) = $1 ORDER BY sr_no DESC';
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

// 🎫 Member Support & Query Center Page
router.get('/member/queries', (req, res) => {
    res.render('member/queries');
});

// 📝 Create New Support Ticket API
router.post('/api/queries/create', async (req, res) => {
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
        console.error("Create Query Error:", error);
        res.json({ success: false, msg: error.message });
    }
});

// 📜 Member Ticket History API
router.get('/api/queries/history', async (req, res) => {
    try {
        const memberId = req.query.memberId ? req.query.memberId.toUpperCase().trim() : '';
        if (!memberId) return res.json([]);
        const result = await db.query('SELECT * FROM query_tickets WHERE member_id = $1 ORDER BY id DESC', [memberId]);
        res.json(result.rows);
    } catch (error) {
        console.error("Queries History Error:", error);
        res.json([]);
    }
});

// 📄 Downloads & Resources Hub
router.get('/member/downloads', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM content_pdf ORDER BY id DESC');
        const formattedPdfs = result.rows.map(row => ({
            ...row,
            uploadDate: row.upload_date
        }));
        res.render('member/downloads', { pdfs: formattedPdfs });
    } catch (err) {
        console.error("Downloads error:", err);
        res.render('member/downloads', { pdfs: [] });
    }
});

module.exports = router;
