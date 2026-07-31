const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../config/db');
const { upload } = require('../config/multer');
const { checkAdmin } = require('../middleware/auth');

// Query Ticket Log
router.post('/api/queries/create', async (req, res) => {
    try {
        const { memberId, name, subject, description, contactNo } = req.body;
        if (!memberId || !name || !subject || !description || !contactNo) {
            return res.json({ success: false, msg: "All fields are required." });
        }
        const insertQuery = `INSERT INTO query_tickets (member_id, name, subject, description, contact_no) VALUES ($1, $2, $3, $4, $5) RETURNING *`;
        await db.query(insertQuery, [memberId.toUpperCase().trim(), name.toUpperCase().trim(), subject.trim(), description.trim(), contactNo.trim()]);
        res.json({ success: true, msg: "Ticket logged successfully" });
    } catch (error) {
        res.json({ success: false, msg: error.message });
    }
});

router.get('/api/queries/history', async (req, res) => {
    try {
        const memberId = req.query.memberId ? req.query.memberId.toUpperCase().trim() : '';
        if(!memberId) return res.json([]);
        const result = await db.query('SELECT * FROM query_tickets WHERE member_id = $1 ORDER BY id DESC', [memberId]);
        res.json(result.rows);
    } catch (error) {
        res.json([]);
    }
});

router.post('/admin/api/queries/update-status', checkAdmin, async (req, res) => {
    try {
        const { ticketId, status } = req.body;
        await db.query('UPDATE query_tickets SET status = $1 WHERE id = $2', [status, ticketId]);
        res.json({ success: true, msg: "Ticket status updated successfully" });
    } catch (error) {
        res.json({ success: false, msg: error.message });
    }
});

// PDF Content Upload & Delete
router.post('/admin/api/upload-pdf', checkAdmin, upload.single('pdfFile'), async (req, res) => {
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

        await db.query('INSERT INTO content_pdf (id, title, filename, category, upload_date) VALUES ($1, $2, $3, $4, $5)', [id, title, filename, category, uploadDate]);
        res.json({ success: true, msg: "PDF document uploaded successfully" });
    } catch (err) {
        res.json({ success: false, msg: "Server error during PDF upload." });
    }
});

router.delete('/admin/api/delete-pdf/:id', checkAdmin, async (req, res) => {
    try {
        const pdfId = req.params.id;
        const result = await db.query('SELECT filename FROM content_pdf WHERE id = $1', [pdfId]);
        if (result.rows.length > 0) {
            const filenameToDelete = result.rows[0].filename;
            await db.query('DELETE FROM content_pdf WHERE id = $1', [pdfId]);
            const filePath = path.join(__dirname, '../public/uploads/', filenameToDelete);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            return res.json({ success: true, msg: "PDF deleted successfully" });
        }
        res.json({ success: false, msg: "PDF file not found!" });
    } catch (err) {
        res.json({ success: false, msg: "Error deleting PDF file." });
    }
});

// Combo Settings APIs
router.get('/admin/api/get-combos', checkAdmin, async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM combo_presets ORDER BY id DESC');
        res.json({ success: true, combos: result.rows });
    } catch (err) {
        res.json({ success: false, msg: err.message });
    }
});

router.post('/admin/api/save-combo', checkAdmin, async (req, res) => {
    try {
        const { id, combo_name, products } = req.body;
        if (!combo_name || !products) return res.json({ success: false, msg: "કોમ્બોનું નામ અને પ્રોડક્ટ્સ જરૂરી છે!" });
        const productsJson = typeof products === 'string' ? products : JSON.stringify(products);

        if (id && parseInt(id) > 0) {
            await db.query(`UPDATE combo_presets SET combo_name = $1, products = $2 WHERE id = $3`, [combo_name.trim(), productsJson, parseInt(id)]);
        } else {
            await db.query(`INSERT INTO combo_presets (combo_name, products) VALUES ($1, $2)`, [combo_name.trim(), productsJson]);
        }

        const result = await db.query('SELECT * FROM combo_presets ORDER BY id DESC');
        res.json({ success: true, msg: id ? "કોમ્બો અપડેટ થઈ ગયો!" : "નવો કોમ્બો સેવ થયો!", combos: result.rows });
    } catch (err) {
        res.json({ success: false, msg: err.message });
    }
});

router.delete('/admin/api/delete-combo/:id', checkAdmin, async (req, res) => {
    try {
        await db.query('DELETE FROM combo_presets WHERE id = $1', [parseInt(req.params.id)]);
        const result = await db.query('SELECT * FROM combo_presets ORDER BY id DESC');
        res.json({ success: true, msg: "કોમ્બો ડિલીટ થયો!", combos: result.rows });
    } catch (err) {
        res.json({ success: false, msg: err.message });
    }
});

module.exports = router;