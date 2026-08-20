const express = require('express');
const bodyParser = require('body-parser');
const compression = require('compression');
const path = require('path');
const https = require('https');
const session = require('express-session');
require('dotenv').config();

const db = require('./db');
const memberRoutes = require('./routes/member.routes');
const adminRoutes = require('./routes/admin.routes');
const adminApiRoutes = require('./routes/admin.api.routes');

const app = express();
const PORT = process.env.PORT || 3000;

// ⚡ Security & Cloud Proxy Optimizations
app.disable('x-powered-by');
app.set('trust proxy', 1);

// 🚀 HTTP Response Compression (Gzip / Brotli for 70-80% smaller payloads)
app.use(compression({
    level: 6,
    threshold: 1024, // Compress responses above 1KB
    filter: (req, res) => {
        if (req.headers['x-no-compression']) return false;
        return compression.filter(req, res);
    }
}));

// ⚡ View Engine Configuration
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 📁 Static Assets Configuration with Cache Headers for High Speed
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '1d',
    etag: true
}));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads'), {
    maxAge: '7d',
    etag: true
}));

// 📦 High Capacity Request Parsing Middleware (Supports large Excel & Batch uploads)
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(bodyParser.json({ limit: '50mb' }));

// 🔐 Session Management
app.use(session({
    secret: process.env.SESSION_SECRET || 'avira-secret-key-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        maxAge: 24 * 60 * 60 * 1000, // 24 Hours
        httpOnly: true,
        sameSite: 'lax'
    }
}));

// 🗄️ Active Database Information Engine (Available across all EJS Views)
app.use((req, res, next) => {
    res.locals.dbInfo = db.getDbInfo();
    next();
});

// 🚀 Register Modular Route Handlers
app.use('/', memberRoutes);
app.use('/admin', adminRoutes);
app.use('/admin/api', adminApiRoutes);

// 404 Handler for undefined routes
app.use((req, res) => {
    res.status(404).render('member/home', { 
        businessPlan: '#', 
        catalog: '#' 
    });
});

// 🛡️ Global Error Handler (Prevents server crashes on runtime errors)
app.use((err, req, res, next) => {
    console.error('🔥 Global Server Error:', err.stack || err.message);
    if (res.headersSent) return next(err);
    if (req.xhr || req.path.startsWith('/admin/api') || req.path.startsWith('/api')) {
        return res.status(500).json({ success: false, msg: 'Server error: ' + (err.message || 'Internal Error') });
    }
    res.status(500).send('Internal Server Error. Please refresh.');
});

// 🛡️ Unhandled Process Protection (Ensures 100% uptime under load)
process.on('uncaughtException', (err) => {
    console.error('⚠️ Uncaught Exception:', err.message || err);
});
process.on('unhandledRejection', (reason) => {
    console.error('⚠️ Unhandled Rejection:', reason);
});

// 🌐 Server Boot & Auto Index Optimization
if (!process.env.VERCEL) {
    app.listen(PORT, async () => {
        console.log(`✅ AviraCare High-Performance System running on port ${PORT}`);
        // Auto-verify and create DB indexes on startup
        try {
            await db.initIndexes();
        } catch (e) {
            console.warn('DB index init error:', e.message);
        }
    });
}

// 🔄 Auto Keep-Alive Heartbeat for Cloud Deployments (optional)
if (process.env.APP_URL) {
    setInterval(() => {
        https.get(process.env.APP_URL, () => {
            // ping success
        }).on('error', () => {
            // quiet error logging
        });
    }, 300000); // 5 minutes
}

module.exports = app;

