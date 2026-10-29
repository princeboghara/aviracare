const crypto = require('crypto');

const AUTH_SECRET = process.env.SESSION_SECRET || 'avira-secret-key-2026';
const COOKIE_NAME = 'avira_admin_token';
const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 Days

/**
 * Fast native cookie parser without external dependencies
 */
function parseCookies(req) {
    const list = {};
    const rc = req.headers && req.headers.cookie;
    if (rc) {
        rc.split(';').forEach(cookie => {
            const parts = cookie.split('=');
            if (parts.length >= 2) {
                const key = parts[0].trim();
                const val = decodeURIComponent(parts.slice(1).join('=').trim());
                list[key] = val;
            }
        });
    }
    return list;
}

/**
 * Generate a cryptographically signed 30-day remember-me token
 */
function generateAdminToken(username = 'admin', maxAgeMs = DEFAULT_MAX_AGE_MS) {
    const expiresAt = Date.now() + maxAgeMs;
    const payload = `${username}.${expiresAt}`;
    const signature = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('hex');
    return `${payload}.${signature}`;
}

/**
 * Verify signed admin token authenticity and expiration
 */
function verifyAdminToken(token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const [username, expStr, signature] = parts;
    const expiresAt = parseInt(expStr, 10);
    
    if (isNaN(expiresAt) || Date.now() > expiresAt) {
        return null;
    }
    
    const payload = `${username}.${expStr}`;
    const expectedSig = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('hex');
    
    if (signature.length !== expectedSig.length) return null;
    
    try {
        const isValid = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig));
        if (isValid) {
            return { username, expiresAt };
        }
    } catch (e) {
        return null;
    }
    return null;
}

/**
 * Authentication Middleware:
 * Uses fast in-memory session, with instant persistent cookie fallback.
 * Prevents unwanted logouts on server restarts or browser reload.
 */
function checkAdmin(req, res, next) {
    // 1. Session is already authenticated
    if (req.session && req.session.isAdmin) {
        return next();
    }
    
    // 2. Check persistent signed token cookie (prevents logout after restart)
    const cookies = parseCookies(req);
    const token = cookies[COOKIE_NAME];
    const verified = verifyAdminToken(token);
    
    if (verified) {
        if (!req.session) req.session = {};
        req.session.isAdmin = true;
        req.session.adminUser = verified.username;
        if (typeof req.session.save === 'function') {
            return req.session.save((err) => {
                if (err) console.error('Session save warning:', err);
                next();
            });
        }
        return next();
    }
    
    // 3. Unauthorized request
    const isApi = req.xhr || 
                  (req.headers.accept && req.headers.accept.includes('application/json')) || 
                  req.path.startsWith('/api') || 
                  req.baseUrl.includes('/api');

    if (isApi) {
        return res.status(401).json({ 
            success: false, 
            authError: true,
            msg: "સત્ર સમાપ્ત થઈ ગયું છે. કૃપા કરીને ફરીથી લોગિન કરો!" 
        });
    }

    return res.redirect('/admin/login');
}

module.exports = { 
    checkAdmin, 
    generateAdminToken, 
    verifyAdminToken, 
    parseCookies,
    COOKIE_NAME,
    DEFAULT_MAX_AGE_MS
};
