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

const { fetchIndiaPostLiveStatus } = require('../services/indiapost.service');

// 📡 Live Tracking API Lookup (100% Real Live India Post Corporate / CEPT API Integration)
router.get('/api/track', async (req, res) => {
    const rawSearch = (req.query.memberId || req.query.query || req.query.tracking || '').toUpperCase().trim();
    try {
        if (!rawSearch) return res.json([]);

        const queryText = `
            SELECT * FROM main_database 
            WHERE UPPER(member_id) = $1 
               OR UPPER(tracking) = $1 
               OR UPPER(name) LIKE $2
            ORDER BY sr_no DESC
        `;
        const result = await db.query(queryText, [rawSearch, `%${rawSearch}%`]);
        
        const formattedResults = await Promise.all(result.rows.map(async (row) => {
            const trackingNum = (row.tracking || '').trim().toUpperCase();
            const isDispatched = trackingNum.length > 0 && trackingNum !== 'PENDING' && trackingNum !== '-';

            let liveInfo = {
                isLive: false,
                statusBadge: isDispatched ? 'DISPATCHED' : 'PROCESSING',
                statusText: isDispatched ? 'Dispatched via India Post Speed Post' : 'Processing at Central Fulfillment Warehouse',
                currentStep: isDispatched ? 3 : 1,
                articleType: 'India Post Speed Post (Domestic)',
                bookingOffice: 'Surat RMS / Surat H.O.',
                events: [] // ZERO FAKE EVENTS
            };

            if (isDispatched) {
                try {
                    const apiData = await fetchIndiaPostLiveStatus(trackingNum);
                    if (apiData) {
                        liveInfo = {
                            ...liveInfo,
                            ...apiData,
                            events: apiData.events || []
                        };
                    }
                } catch (apiErr) {
                    console.error("Live India Post Query Error for", trackingNum, apiErr.message);
                }
            }

            return {
                srNo: row.sr_no,
                memberId: row.member_id,
                name: row.name,
                orderDate: row.order_date,
                pv: row.pv,
                amount: row.amount,
                tracking: trackingNum,
                isDispatched,
                isLive: liveInfo.isLive || false,
                statusBadge: liveInfo.statusBadge || (isDispatched ? 'DISPATCHED' : 'PROCESSING'),
                statusText: liveInfo.statusText || (isDispatched ? 'Dispatched via India Post' : 'Processing in Warehouse'),
                currentStep: liveInfo.currentStep || (isDispatched ? 3 : 1),
                articleType: liveInfo.articleType || 'India Post Speed Post (Domestic)',
                bookingOffice: liveInfo.bookingOffice || 'Surat RMS',
                indiaPostUrl: 'https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx',
                parcelsAppUrl: isDispatched ? `https://parcelsapp.com/en/tracking/${encodeURIComponent(trackingNum)}` : '#',
                events: liveInfo.events || [] // Authentic live events only
            };
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
        let { memberId, name, subject, description, contactNo } = req.body;
        if (!memberId || !name || !subject || !description || !contactNo) {
            return res.json({ success: false, msg: "All fields (Name, Mobile, Subject, Description) are required." });
        }

        const cleanMemberId = memberId.toString().toUpperCase().trim();
        const cleanMobile = contactNo.toString().replace(/[^0-9]/g, '').trim();

        if (!/^AV\d{5}$/.test(cleanMemberId)) {
            return res.json({ success: false, msg: "Member ID must be in the format AV followed by exactly 5 digits (e.g. AV12345)." });
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

module.exports = router;
