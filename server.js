const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const https = require('https');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 3000;

// Express Session
app.use(session({
    secret: 'avira-secret-key-2026',
    resave: false,
    saveUninitialized: false
}));

// View Engine Setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static Folders
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// Body Parser Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// 🔀 Modular Routes Mount
app.use('/', require('./routes/publicRoutes'));
app.use('/', require('./routes/adminRoutes'));
app.use('/', require('./routes/billRoutes'));
app.use('/', require('./routes/productRoutes'));
app.use('/', require('./routes/orderRoutes'));
app.use('/', require('./routes/queryRoutes'));

// Start Express Server
app.listen(PORT, () => {
    console.log(`✅ Server running smoothly on port ${PORT}`);
});

// Self-Ping Keep-Alive for Render
setInterval(() => {
    https.get('https://aviracare.onrender.com/');
}, 300000);