const express = require('express');
const router = express.Router();
const db = require('../config/db');

router.get('/', async (req, res) => {
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
        res.render('home', { businessPlan: '#', catalog: '#' });
    }
});

router.get('/track-parcel', (req, res) => res.render('member_tracking'));
router.get('/member/queries', (req, res) => res.render('member_queries'));

router.get('/member/downloads', async (req, res) => {
    const result = await db.query('SELECT * FROM content_pdf ORDER BY id DESC');
    res.render('member_downloads', { pdfs: result.rows });
});

router.get('/api/track', async (req, res) => {
    const { memberId } = req.query;
    try {
        const searchMemberId = memberId.toUpperCase().trim();
        const result = await db.query('SELECT * FROM main_database WHERE UPPER(member_id) = $1 ORDER BY sr_no DESC', [searchMemberId]);
        const formattedResults = result.rows.map(row => ({
            srNo: row.sr_no, memberId: row.member_id, name: row.name, orderDate: row.order_date, pv: row.pv, amount: row.amount, tracking: row.tracking
        }));
        res.json(formattedResults);
    } catch (err) {
        res.json([]);
    }
});

module.exports = router;