const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../db');

// 📄 1. Document Stream / View Endpoint (In-Browser Preview)
router.get('/api/documents/view/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await db.query('SELECT * FROM content_pdf WHERE id = $1', [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).send(`
                <div style="font-family:sans-serif; text-align:center; padding:50px;">
                    <h2>📄 Document Not Found</h2>
                    <p>The requested PDF file is not available in the database.</p>
                    <a href="/member/downloads" style="color:#059669; font-weight:bold;">&larr; Back to Downloads</a>
                </div>
            `);
        }

        const doc = result.rows[0];
        const safeTitle = (doc.title || 'Document').replace(/[^a-zA-Z0-9_\-\s]/g, '').trim() || 'Avira_Document';
        let rawFilename = doc.filename || '';

        let candidateLocalName = rawFilename;
        if (rawFilename.startsWith('http')) {
            const urlParts = rawFilename.split('/');
            candidateLocalName = urlParts[urlParts.length - 1];
        } else if (rawFilename.startsWith('/uploads/')) {
            candidateLocalName = rawFilename.replace('/uploads/', '');
        }

        let localPath = path.join(__dirname, '..', 'public', 'uploads', candidateLocalName);

        if (!fs.existsSync(localPath)) {
            const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
            if (fs.existsSync(uploadsDir)) {
                const files = fs.readdirSync(uploadsDir);
                const matchingPdf = files.find(f => f.toLowerCase().endsWith('.pdf') && (
                    (candidateLocalName && f.includes(candidateLocalName.slice(0, 10))) ||
                    (doc.category === 'PRODUCT_CATALOG' && f.toLowerCase().includes('product')) ||
                    (doc.category === 'BUSINESS_PLAN' && (f.toLowerCase().includes('plan') || f.toLowerCase().includes('ppt')))
                ));
                if (matchingPdf) {
                    localPath = path.join(uploadsDir, matchingPdf);
                }
            }
        }

        if (fs.existsSync(localPath)) {
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(safeTitle)}.pdf"`);
            return res.sendFile(path.resolve(localPath));
        }

        return res.status(404).send(`
            <div style="font-family:sans-serif; text-align:center; padding:50px;">
                <h2>📄 PDF File Temporarily Unavailable</h2>
                <p>The document "${safeTitle}" is being updated. Please check back shortly or download another file.</p>
                <a href="/member/downloads" style="color:#059669; font-weight:bold;">&larr; Back to Document Library</a>
            </div>
        `);
    } catch (err) {
        console.error("Document View Error:", err);
        res.status(500).send("Server Error loading document.");
    }
});

// 📥 2. Document Direct Download Endpoint (Forced Attachment)
router.get('/api/documents/download/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await db.query('SELECT * FROM content_pdf WHERE id = $1', [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).send("Document not found");
        }

        const doc = result.rows[0];
        const safeTitle = (doc.title || 'Document').replace(/[^a-zA-Z0-9_\-\s]/g, '').trim() || 'Avira_Document';
        let rawFilename = doc.filename || '';

        let candidateLocalName = rawFilename;
        if (rawFilename.startsWith('http')) {
            const urlParts = rawFilename.split('/');
            candidateLocalName = urlParts[urlParts.length - 1];
        } else if (rawFilename.startsWith('/uploads/')) {
            candidateLocalName = rawFilename.replace('/uploads/', '');
        }

        let localPath = path.join(__dirname, '..', 'public', 'uploads', candidateLocalName);

        if (!fs.existsSync(localPath)) {
            const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
            if (fs.existsSync(uploadsDir)) {
                const files = fs.readdirSync(uploadsDir);
                const matchingPdf = files.find(f => f.toLowerCase().endsWith('.pdf') && (
                    (candidateLocalName && f.includes(candidateLocalName.slice(0, 10))) ||
                    (doc.category === 'PRODUCT_CATALOG' && f.toLowerCase().includes('product')) ||
                    (doc.category === 'BUSINESS_PLAN' && (f.toLowerCase().includes('plan') || f.toLowerCase().includes('ppt')))
                ));
                if (matchingPdf) {
                    localPath = path.join(uploadsDir, matchingPdf);
                }
            }
        }

        if (fs.existsSync(localPath)) {
            return res.download(path.resolve(localPath), `${safeTitle}.pdf`);
        }

        return res.status(404).send("Document file not available on server.");
    } catch (err) {
        console.error("Document Download Error:", err);
        res.status(500).send("Server error during download.");
    }
});

// 🏠 Homepage / Member Portal Hub
router.get('/', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM content_pdf ORDER BY id DESC');
        const pdfList = result.rows;
        
        const latestBusinessPlan = pdfList.find(p => p.category === 'BUSINESS_PLAN');
        const latestCatalog = pdfList.find(p => p.category === 'PRODUCT_CATALOG');

        const planDownloadUrl = latestBusinessPlan 
            ? `/api/documents/download/${latestBusinessPlan.id}`
            : '/member/downloads';

        const catalogDownloadUrl = latestCatalog
            ? `/api/documents/download/${latestCatalog.id}`
            : '/member/downloads';

        res.render('member/home', { 
            businessPlan: planDownloadUrl,
            businessPlanTitle: latestBusinessPlan ? latestBusinessPlan.title : 'Official Business Plan',
            hasBusinessPlan: !!latestBusinessPlan,
            catalog: catalogDownloadUrl,
            catalogTitle: latestCatalog ? latestCatalog.title : 'Official Product Catalog',
            hasCatalog: !!latestCatalog
        });
    } catch (err) {
        console.error("Home route error:", err);
        res.render('member/home', { 
            businessPlan: '/member/downloads', 
            businessPlanTitle: 'Official Business Plan',
            hasBusinessPlan: false,
            catalog: '/member/downloads', 
            catalogTitle: 'Official Product Catalog',
            hasCatalog: false
        });
    }
});

// 📦 Product Showcase
router.get('/products', async (req, res) => {
    try {
        const result = await db.query('SELECT id, name, amount, pv, image_url, category FROM avira_products ORDER BY id DESC');
        res.render('member/products', { products: result.rows });
    } catch (err) {
        console.error("Products catalog error:", err);
        res.render('member/products', { products: [] });
    }
});

// 📄 Download Product Price List PDF
router.get('/products/price-list-pdf', async (req, res) => {
    try {
        const { generateAviraExactPriceList } = require('../scripts/generate_price_list_pdf');
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename="AviraCare_Product_Price_List.pdf"');
        
        generateAviraExactPriceList(null, res);
    } catch (err) {
        console.error("Error generating price list PDF:", err);
        res.status(500).send("Unable to generate price list PDF.");
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

// 📡 Order Tracking API Lookup (Fast Direct Database Lookup)
router.get('/api/track', async (req, res) => {
    const rawSearch = (req.query.memberId || req.query.query || req.query.tracking || '').toUpperCase().trim();
    try {
        if (!rawSearch) return res.json([]);

        // Generate smart search variants for 5 or 6 digit member IDs (e.g. 123456 or AV123456)
        let withAv = rawSearch;
        let withoutAv = rawSearch;
        if (rawSearch.startsWith('AV')) {
            withoutAv = rawSearch.substring(2);
        } else if (/^\d+$/.test(rawSearch)) {
            withAv = 'AV' + rawSearch;
        }

        const queryText = `
            SELECT * FROM main_database 
            WHERE UPPER(TRIM(member_id)) IN ($1, $2)
               OR UPPER(TRIM(order_no)) IN ($1, $2)
               OR UPPER(TRIM(tracking)) IN ($1, $2)
               OR UPPER(name) LIKE $3
            ORDER BY sr_no DESC
        `;
        const result = await db.query(queryText, [withAv, withoutAv, `%${rawSearch}%`]);
        
        const formattedResults = result.rows.map((row) => {
            const trackingNum = (row.tracking || '').trim().toUpperCase();

            return {
                srNo: row.sr_no,
                orderNo: row.order_no || '',
                memberId: row.member_id || '',
                name: row.name || '',
                orderDate: row.order_date || '',
                pv: row.pv || '0',
                amount: row.amount || '0',
                tracking: trackingNum
            };
        });

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
        let { memberId, name, subject, description, contactNo } = req.body;
        if (!memberId || !name || !subject || !description || !contactNo) {
            return res.json({ success: false, msg: "All fields (Name, Mobile, Subject, Description) are required." });
        }

        const cleanMemberId = memberId.toString().toUpperCase().trim();
        const cleanMobile = contactNo.toString().replace(/[^0-9]/g, '').trim();

        if (!/^AV\d{5,6}$/.test(cleanMemberId)) {
            return res.json({ success: false, msg: "Member ID must be in the format AV followed by 5 or 6 digits (e.g. AV12345 or AV123456)." });
        }

        if (cleanMobile.length !== 10) {
            return res.json({ success: false, msg: "Mobile number must be exactly 10 digits." });
        }

        const insertQuery = `
            INSERT INTO query_tickets (member_id, name, subject, description, contact_no, created_at)
            VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *
        `;
        await db.query(insertQuery, [
            cleanMemberId, 
            name.toUpperCase().trim(), 
            subject.trim(), 
            description.trim(), 
            cleanMobile
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
        
        const formatted = result.rows.map(ticket => {
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
                formattedCreatedAt: formattedCreatedAt || 'Recent',
                formattedRepliedAt
            };
        });

        res.json(formatted);
    } catch (error) {
        console.error("Queries History Error:", error);
        res.json([]);
    }
});

// 📄 Downloads & Resources Hub
router.get('/member/downloads', async (req, res) => {
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
                fileSize: fileSizeStr,
                uploadDate: row.upload_date || 'Recent'
            };
        });

        res.render('member/downloads', { pdfs: formattedPdfs });
    } catch (err) {
        console.error("Downloads error:", err);
        res.render('member/downloads', { pdfs: [] });
    }
});

// =============================================================
// 📦 PUBLIC TRACKING API FOR CRM / WHATSAPP CHATBOT
// =============================================================
// Compatible with: /v1/api/data/tracking/:id, /api/tracking/:id, /api/tracking
router.all(['/v1/api/data/tracking/:id', '/api/tracking/:id', '/api/tracking', '/v1/api/data/tracking'], async (req, res) => {
    try {
        const rawId = req.params.id || req.query.id || req.body?.track || req.body?.trackingid || req.body?.member_id || req.body?.id || '';
        const cleanRaw = String(rawId).replace(/[\s\-_]/g, '').trim().toUpperCase();

        if (!cleanRaw) {
            return res.status(400).json({ error: 'Please provide a valid Member ID or Tracking Number' });
        }

        // Generate smart search variants (e.g. 726340, AV726340, etc.)
        let withAv = cleanRaw;
        let withoutAv = cleanRaw;
        if (cleanRaw.startsWith('AV')) {
            withoutAv = cleanRaw.substring(2);
        } else if (/^\d+$/.test(cleanRaw)) {
            withAv = 'AV' + cleanRaw;
        }

        const querySql = `
            SELECT m.sr_no, m.member_id, m.name, m.order_date, m.pv, m.amount, m.tracking,
                   c.mobile, c.city, c.state, c.pincode
            FROM main_database m
            LEFT JOIN consignment_parcels c ON (m.tracking IS NOT NULL AND m.tracking != '' AND m.tracking = c.tracking)
            WHERE UPPER(TRIM(m.member_id)) IN ($1, $2)
               OR UPPER(TRIM(m.tracking)) IN ($1, $2)
               OR (c.mobile IS NOT NULL AND TRIM(c.mobile) IN ($1, $2))
            ORDER BY m.sr_no DESC
        `;

        const result = await db.query(querySql, [withAv, withoutAv]);

        if (!result.rows || result.rows.length === 0) {
            return res.status(404).json({ error: 'No tracking data found for this member' });
        }

        const first = result.rows[0];
        const memberName = first.name || 'Valued Member';

        // Deduplicate and group unique parcels
        const uniqueOrders = [];
        const seen = new Set();
        for (const row of result.rows) {
            const tr = (row.tracking || '').trim().toUpperCase();
            const od = (row.order_date || '').trim();
            const key = `${tr}_${od}`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueOrders.push({
                    order_date: od || 'Recent',
                    tracking: tr || 'Pending Dispatch',
                    pv: row.pv || '0',
                    amount: row.amount || '0',
                    city: row.city || '',
                    state: row.state || '',
                    mobile: row.mobile || '',
                    tracking_url: tr && tr !== 'Pending Dispatch' ? 'https://www.indiapost.gov.in/_layouts/15/dpt.cept.tracking/trackconsignment.aspx' : ''
                });
            }
        }

        const latestOrder = uniqueOrders[0];
        const trackingNo = latestOrder.tracking;
        const allTrackingsStr = uniqueOrders.map(o => o.tracking).join(', ');

        let parcelDetailsText = '';
        let readyMsg = '';
        const indiapostUrl = 'https://www.indiapost.gov.in/_layouts/15/dpt.cept.tracking/trackconsignment.aspx';
        const pvVal = latestOrder.pv || '0';
        const amountVal = latestOrder.amount || '0';

        if (uniqueOrders.length === 1) {
            parcelDetailsText = `🚚 Tracking Number (Tap to Copy):\n\`${latestOrder.tracking}\`\n💎 PV: ${latestOrder.pv} | 💰 Amount: ₹${latestOrder.amount}\n📅 Order Date: ${latestOrder.order_date}`;
            readyMsg = `Hello ${memberName},\n\nYour Parcel has been dispatched Successfully! 📦\n\n🆔 Member ID: ${first.member_id}\n\n${parcelDetailsText}\n\nYou can track your parcel using the India Post tracking portal:\n${indiapostUrl}\n\nIf you need any assistance, Please feel free to contact us.\nThank you,\n\n*AviraCare Team*`;
        } else {
            parcelDetailsText = uniqueOrders.map((o, idx) => {
                return `📦 Parcel ${idx + 1} (Tap to Copy):\n🚚 \`${o.tracking}\`\n💎 PV: ${o.pv} | 💰 Amount: ₹${o.amount}\n📅 Date: ${o.order_date}`;
            }).join('\n\n');

            readyMsg = `Hello ${memberName},\n\nWe found ${uniqueOrders.length} parcels for your account: 📦\n\n🆔 Member ID: ${first.member_id}\n\n${parcelDetailsText}\n\nYou can track your parcels using the India Post tracking portal:\n${indiapostUrl}\n\nIf you need any assistance, Please feel free to contact us.\nThank you,\n\n*AviraCare Team*`;
        }

        return res.json({
            success: true,
            count: uniqueOrders.length,
            tracking: trackingNo,
            consignmentid: trackingNo,
            all_trackings: allTrackingsStr,
            parcel_info: parcelDetailsText,
            name: memberName,
            member_id: first.member_id,
            pv: pvVal,
            amount: amountVal,
            reply_text: readyMsg,
            message: readyMsg,
            data: {
                count: uniqueOrders.length,
                member_id: first.member_id,
                name: memberName,
                pv: pvVal,
                amount: amountVal,
                tracking: trackingNo,
                consignmentid: trackingNo,
                all_trackings: allTrackingsStr,
                parcel_info: parcelDetailsText,
                order_date: latestOrder.order_date,
                city: latestOrder.city || '',
                state: latestOrder.state || '',
                tracking_url: indiapostUrl,
                orders: uniqueOrders
            }
        });
    } catch (err) {
        console.error('WhatsApp Bot Tracking API Error:', err);
        return res.status(500).json({ error: 'Server error while fetching tracking: ' + err.message });
    }
});

module.exports = router;
