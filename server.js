const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const https = require('https');
const session = require('express-session');
require('dotenv').config();

const memberRoutes = require('./routes/member.routes');
const adminRoutes = require('./routes/admin.routes');
const adminApiRoutes = require('./routes/admin.api.routes');

const app = express();
const PORT = process.env.PORT || 3000;

// ⚡ View Engine Configuration
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 📁 Static Assets Configuration
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// 📦 Request Parsing Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// 🔐 Session Management
app.use(session({
    secret: process.env.SESSION_SECRET || 'avira-secret-key-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 Hours
}));

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

// 🌐 Server Boot
app.listen(PORT, () => {
    console.log(`✅ AviraCare System running smoothly on port ${PORT}`);
});

// 🔄 Auto Keep-Alive Heartbeat for Cloud Deployments
setInterval(() => {
    https.get('https://aviracare.onrender.com/', () => {
        // ping success
    }).on('error', (err) => {
        console.error('Keep-alive ping error:', err.message);
    });
}, 300000); // 5 minutes
