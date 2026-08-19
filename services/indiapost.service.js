require('dotenv').config();
const https = require('https');
const http = require('http');

// ⏱️ In-memory cache for Live Tracking (5 mins TTL) and Auth Token
const trackingCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedAccessToken = null;
let tokenExpiresAt = 0;
let cachedRefreshToken = null;

/**
 * 🔐 Step 1: Automatic Authentication & Token Generation (AUTH01 / AUTH02)
 * Calls: POST {base_path}/v1/access/Login
 */
async function getValidAccessToken() {
    // Return cached token if still valid (with 60s buffer)
    if (cachedAccessToken && Date.now() < (tokenExpiresAt - 60000)) {
        return cachedAccessToken;
    }

    const baseUrl = (process.env.INDIAPOST_API_URL || 'https://test.cept.gov.in/beextcustomer').replace(/\/+$/, '');
    const customerId = (process.env.INDIAPOST_CUSTOMER_ID || '').trim();
    const clientSecret = (process.env.INDIAPOST_API_KEY || process.env.INDIAPOST_PASSWORD || process.env.INDIAPOST_CLIENT_SECRET || '').trim();

    // If direct token is provided in .env
    if (process.env.INDIAPOST_BEARER_TOKEN) {
        return process.env.INDIAPOST_BEARER_TOKEN.trim();
    }

    if (!customerId || !clientSecret) {
        return null; // Credentials not configured yet
    }

    // Try Refresh Token (AUTH02) if available
    if (cachedRefreshToken) {
        try {
            const refreshRes = await executePostRequest(`${baseUrl}/v1/access/TokenWithRtoken`, {
                refreshToken: cachedRefreshToken
            });
            if (refreshRes && (refreshRes.access_token || refreshRes.accessToken || (refreshRes.data && refreshRes.data.accessToken))) {
                const tokenData = refreshRes.data || refreshRes;
                cachedAccessToken = tokenData.access_token || tokenData.accessToken;
                const expiresInSec = tokenData.expires_in || tokenData.expiresIn || 3600;
                tokenExpiresAt = Date.now() + (expiresInSec * 1000);
                if (tokenData.refresh_token || tokenData.refreshToken) {
                    cachedRefreshToken = tokenData.refresh_token || tokenData.refreshToken;
                }
                return cachedAccessToken;
            }
        } catch (rErr) {
            console.log("Token refresh failed, falling back to Login:", rErr.message);
        }
    }

    // Call AUTH01 (POST /v1/access/Login)
    try {
        const loginPayload = {
            username: customerId,
            customerId: customerId,
            password: clientSecret,
            clientSecret: clientSecret
        };

        const loginRes = await executePostRequest(`${baseUrl}/v1/access/Login`, loginPayload);

        if (loginRes && (loginRes.access_token || loginRes.accessToken || (loginRes.data && loginRes.data.accessToken))) {
            const tokenData = loginRes.data || loginRes;
            cachedAccessToken = tokenData.access_token || tokenData.accessToken;
            const expiresInSec = tokenData.expires_in || tokenData.expiresIn || 3600;
            tokenExpiresAt = Date.now() + (expiresInSec * 1000);
            cachedRefreshToken = tokenData.refresh_token || tokenData.refreshToken || null;
            return cachedAccessToken;
        } else {
            console.warn("India Post Login response:", JSON.stringify(loginRes));
            return null;
        }
    } catch (err) {
        console.error("India Post Login Error (AUTH01):", err.message);
        return null;
    }
}

/**
 * 📦 Step 2: Track Single Article (TNT01)
 * Calls: GET {base_path}/v1/tracking/{trackingNumber}
 * 
 * @param {string} consignmentNumber India Post Tracking Barcode (e.g. 'RM019388105IN' or 'CG245521086IN')
 * @returns {Promise<object>} Parsed live tracking object
 */
async function fetchIndiaPostLiveStatus(consignmentNumber) {
    if (!consignmentNumber || typeof consignmentNumber !== 'string') {
        return {
            success: false,
            isLive: false,
            msg: "Invalid consignment number."
        };
    }

    const cleanBarcode = consignmentNumber.trim().toUpperCase();

    // 1. Check in-memory cache
    const cached = trackingCache.get(cleanBarcode);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
        return cached.data;
    }

    const baseUrl = (process.env.INDIAPOST_API_URL || 'https://test.cept.gov.in/beextcustomer').replace(/\/+$/, '');
    const token = await getValidAccessToken();

    // If credentials are not yet configured in .env
    if (!token) {
        return {
            success: true,
            isLive: false,
            needsConfig: true,
            trackingNumber: cleanBarcode,
            statusBadge: 'DISPATCHED',
            statusText: 'Dispatched via India Post Speed Post',
            articleType: 'India Post Speed Post (Domestic)',
            bookingOffice: 'Surat RMS / Surat H.O.',
            currentLocation: 'In Transit',
            events: [], // NO FAKE EVENTS
            msg: "Consignment registered. Configure INDIAPOST_CUSTOMER_ID & password in .env to stream live CEPT server events."
        };
    }

    try {
        const fullUrl = `${baseUrl}/v1/tracking/${encodeURIComponent(cleanBarcode)}`;
        const liveResult = await executeIndiaPostGetRequest(fullUrl, token, cleanBarcode);

        if (liveResult && liveResult.success) {
            trackingCache.set(cleanBarcode, {
                timestamp: Date.now(),
                data: liveResult
            });
            return liveResult;
        }

        return {
            success: true,
            isLive: false,
            trackingNumber: cleanBarcode,
            statusBadge: 'DISPATCHED',
            statusText: 'Consignment Dispatched (Awaiting India Post Live Sync)',
            articleType: 'India Post Speed Post (Domestic)',
            bookingOffice: 'Surat RMS',
            events: [],
            msg: liveResult ? (liveResult.msg || "Awaiting scan update from India Post") : "India Post live query sent."
        };

    } catch (err) {
        console.error(`India Post Live API Error for [${cleanBarcode}]:`, err.message);
        return {
            success: false,
            isLive: false,
            trackingNumber: cleanBarcode,
            statusBadge: 'DISPATCHED',
            statusText: 'Consignment Dispatched',
            articleType: 'India Post Speed Post (Domestic)',
            events: [],
            error: err.message
        };
    }
}

/**
 * Execute HTTP GET request to India Post REST API with Bearer Token
 */
function executeIndiaPostGetRequest(fullUrl, token, articleNumber) {
    return new Promise((resolve) => {
        try {
            const urlObj = new URL(fullUrl);
            const isHttps = urlObj.protocol === 'https:';
            const client = isHttps ? https : http;

            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || (isHttps ? 443 : 80),
                path: urlObj.pathname + urlObj.search,
                method: 'GET',
                headers: {
                    'accept': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'User-Agent': 'AviraCare-Logistics-Client/1.0'
                },
                timeout: 10000
            };

            const req = client.request(options, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(body);

                        if (res.statusCode === 200 && parsed.success !== false) {
                            const normalized = normalizeIndiaPostData(parsed, articleNumber);
                            resolve(normalized);
                        } else if (res.statusCode === 404) {
                            resolve({
                                success: true,
                                isLive: false,
                                trackingNumber: articleNumber,
                                statusBadge: 'DISPATCHED',
                                statusText: 'Awaiting Initial Scan at India Post Hub',
                                articleType: 'India Post Speed Post (Domestic)',
                                bookingOffice: 'Surat RMS',
                                events: [],
                                msg: parsed.message || "Tracking number not yet scanned into India Post network."
                            });
                        } else {
                            resolve({
                                success: false,
                                msg: parsed.message || `India Post server responded with HTTP ${res.statusCode}`,
                                raw: body.slice(0, 300)
                            });
                        }
                    } catch (jsonErr) {
                        resolve({
                            success: false,
                            msg: "Invalid JSON response from India Post server.",
                            raw: body.slice(0, 300)
                        });
                    }
                });
            });

            req.on('error', (err) => resolve({ success: false, msg: err.message }));
            req.on('timeout', () => {
                req.destroy();
                resolve({ success: false, msg: "India Post server connection timed out." });
            });

            req.end();
        } catch (e) {
            resolve({ success: false, msg: e.message });
        }
    });
}

/**
 * Execute HTTP POST Request (for AUTH01 Login and AUTH02 Refresh)
 */
function executePostRequest(fullUrl, postPayload) {
    return new Promise((resolve) => {
        try {
            const urlObj = new URL(fullUrl);
            const isHttps = urlObj.protocol === 'https:';
            const client = isHttps ? https : http;

            const postData = JSON.stringify(postPayload);

            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || (isHttps ? 443 : 80),
                path: urlObj.pathname + urlObj.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'accept': 'application/json',
                    'Content-Length': Buffer.byteLength(postData),
                    'User-Agent': 'AviraCare-Logistics-Client/1.0'
                },
                timeout: 10000
            };

            const req = client.request(options, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(body);
                        resolve(parsed);
                    } catch (jsonErr) {
                        resolve({ success: false, raw: body.slice(0, 300) });
                    }
                });
            });

            req.on('error', (err) => resolve({ success: false, error: err.message }));
            req.on('timeout', () => {
                req.destroy();
                resolve({ success: false, error: "Timeout during authentication" });
            });

            req.write(postData);
            req.end();
        } catch (e) {
            resolve({ success: false, error: e.message });
        }
    });
}

/**
 * Normalizes Official India Post Response Schema
 */
function normalizeIndiaPostData(responseJson, articleNumber) {
    if (!responseJson) return { success: false, msg: "Empty payload from India Post" };

    const data = responseJson.data || responseJson;
    const trackingNo = data.trackingNumber || articleNumber;
    const currentStatus = (data.currentStatus || 'IN_TRANSIT').toUpperCase();
    const origin = data.origin || 'Surat RMS';
    const destination = data.destination || '';
    const estimatedDelivery = data.estimatedDelivery || '';
    const historyList = data.history || data.events || [];

    const cleanEvents = Array.isArray(historyList) ? historyList.map(item => {
        let dateStr = '';
        let timeStr = '';
        if (item.timestamp) {
            try {
                const d = new Date(item.timestamp);
                dateStr = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
                timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
            } catch (e) {
                dateStr = item.timestamp;
            }
        } else {
            dateStr = item.date || item.EventDate || 'Recent';
            timeStr = item.time || item.EventTime || '';
        }

        return {
            date: dateStr,
            time: timeStr,
            location: item.location || item.office || item.OfficeName || 'India Post Facility',
            event: item.status || item.event || item.EventDescription || 'Status Update',
            detail: item.detail || item.remarks || ''
        };
    }) : [];

    let statusBadge = 'IN_TRANSIT';
    let statusText = 'In Transit - India Post Speed Post';
    let currentStep = 3;

    if (currentStatus.includes('DELIVERED') || currentStatus.includes('CONFIRMED')) {
        statusBadge = 'DELIVERED';
        statusText = 'Item Delivered Successfully';
        currentStep = 5;
    } else if (currentStatus.includes('OUT') || currentStatus.includes('DELIVERY')) {
        statusBadge = 'OUT_FOR_DELIVERY';
        statusText = 'Out for Delivery (Local Postman Assigned)';
        currentStep = 4;
    } else if (currentStatus.includes('BOOKED') || currentStatus.includes('ACCEPTED')) {
        statusBadge = 'BOOKED';
        statusText = 'Item Booked at Origin Post Office';
        currentStep = 2;
    }

    return {
        success: true,
        isLive: true,
        trackingNumber: trackingNo,
        statusBadge,
        statusText,
        currentStep,
        articleType: 'India Post Speed Post (Domestic)',
        bookingOffice: origin,
        destinationOffice: destination,
        estimatedDelivery: estimatedDelivery,
        events: cleanEvents
    };
}

module.exports = {
    fetchIndiaPostLiveStatus,
    getValidAccessToken
};
