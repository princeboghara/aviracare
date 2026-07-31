const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { upload } = require('../config/multer');
const { checkAdmin } = require('../middleware/auth');

router.get('/products', async (req, res) => {
    try {
        const result = await db.query('SELECT id, name, amount, pv, image_url FROM avira_products ORDER BY id DESC');
        res.render('member_products', { products: result.rows });
    } catch (err) {
        res.render('member_products', { products: [] });
    }
});

router.get('/products/:id', async (req, res) => {
    try {
        const productId = req.params.id;
        const result = await db.query('SELECT * FROM avira_products WHERE id = $1', [productId]);
        if (result.rows.length === 0) return res.status(404).send("Product Not Found!");
        res.render('product_detail', { product: result.rows[0] });
    } catch (err) {
        res.status(500).send("Server Error");
    }
});

router.post('/admin/api/add-product', checkAdmin, upload.array('productImages', 5), async (req, res) => {
    try {
        const { name, amount, pv, info, benefits, how_to_use } = req.body;
        if (!req.files || req.files.length === 0) {
            return res.json({ success: false, msg: "કૃપા કરીને ઓછામાં ઓછો ૧ ફોટો અપલોડ કરો!" });
        }

        const imagePaths = req.files.map(file => `/uploads/${file.filename}`);
        const queryText = `
            INSERT INTO avira_products (name, amount, pv, info, benefits, how_to_use, image_url, all_images) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id
        `;
        const values = [name.trim(), parseFloat(amount), parseInt(pv), info.trim(), benefits.trim(), how_to_use.trim(), imagePaths[0], JSON.stringify(imagePaths)];
        
        await db.query(queryText, values);
        res.json({ success: true, msg: "પ્રોડક્ટ સફળતાપૂર્વક પબ્લિશ થઈ ગઈ છે! 🎉" });
    } catch (error) {
        res.json({ success: false, msg: "ડેટાબેઝ અથવા સર્વરમાં ભૂલ થઈ છે: " + error.message });
    }
});

router.delete('/admin/api/delete-product/:id', checkAdmin, async (req, res) => {
    try {
        await db.query('DELETE FROM avira_products WHERE id = $1', [req.params.id]);
        res.json({ success: true, msg: "પ્રોડક્ટ સફળતાપૂર્વક ડીલીટ થઈ ગઈ છે! 🗑️" });
    } catch (error) {
        res.json({ success: false, msg: "Failed to delete product: " + error.message });
    }
});

router.post('/admin/api/update-product/:id', checkAdmin, upload.array('productImages', 5), async (req, res) => {
    try {
        const productId = req.params.id;
        const { name, amount, pv, info, benefits, how_to_use, existingImages } = req.body;

        let finalImages = [];
        if (existingImages) finalImages = Array.isArray(existingImages) ? existingImages : [existingImages];
        if (req.files && req.files.length > 0) {
            req.files.forEach(file => finalImages.push(`/uploads/${file.filename}`));
        }
        if (finalImages.length === 0) finalImages.push('/images/placeholder.jpg');

        const queryText = `
            UPDATE avira_products 
            SET name = $1, amount = $2, pv = $3, info = $4, benefits = $5, how_to_use = $6, image_url = $7, all_images = $8
            WHERE id = $9
        `;
        const values = [name.trim(), parseFloat(amount), parseInt(pv), info.trim(), benefits.trim(), how_to_use.trim(), finalImages[0], JSON.stringify(finalImages), productId];
        await db.query(queryText, values);
        res.json({ success: true, msg: "પ્રોડક્ટ અને ઈમેજ પ્રોપરલી અપડેટ થઈ ગઈ છે! 🚀" });
    } catch (error) {
        res.json({ success: false, msg: "Failed to update product: " + error.message });
    }
});

module.exports = router;