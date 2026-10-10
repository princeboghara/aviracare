const https = require('https');
const http = require('http');
const db = require('../db');
require('dotenv').config();

/**
 * 🌐 AviraGlobal (AVGControl) Automated Order Sync Service
 * Seamlessly authenticates with https://aviraglobal.in/AVGControl and synchronizes all live orders
 */

class AviraGlobalSyncService {
    constructor() {
        this.baseUrl = (process.env.AVG_BASE_URL || 'https://aviraglobal.in').replace(/\/+$/, '');
    }

    /**
     * Helper to make HTTP/HTTPS requests with Cookie persistence
     */
    async request(url, options = {}, cookies = '') {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const isHttps = urlObj.protocol === 'https:';
            const client = isHttps ? https : http;

            const headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                ...(options.headers || {})
            };

            if (cookies) {
                headers['Cookie'] = cookies;
            }

            const reqOptions = {
                hostname: urlObj.hostname,
                port: urlObj.port || (isHttps ? 443 : 80),
                path: urlObj.pathname + urlObj.search,
                method: options.method || 'GET',
                headers,
                timeout: 15000,
                maxRedirects: 0
            };

            const req = client.request(reqOptions, (res) => {
                let data = '';
                res.setEncoding('utf8');

                res.on('data', chunk => { data += chunk; });
                res.on('end', () => {
                    const rawSetCookies = res.headers['set-cookie'] || [];
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        setCookies: rawSetCookies,
                        location: res.headers['location'],
                        body: data
                    });
                });
            });

            req.on('timeout', () => {
                req.destroy(new Error(`Request timed out after 15s to ${url}`));
            });

            req.on('error', err => reject(err));

            if (options.body) {
                req.write(options.body);
            }
            req.end();
        });
    }

    /**
     * Merge response Set-Cookie headers into a single cookie string
     */
    mergeCookies(existingCookieStr, newSetCookies = []) {
        const cookieMap = new Map();

        if (existingCookieStr) {
            existingCookieStr.split(';').forEach(c => {
                const [key, ...val] = c.trim().split('=');
                if (key) cookieMap.set(key, val.join('='));
            });
        }

        newSetCookies.forEach(c => {
            const part = c.split(';')[0];
            const [key, ...val] = part.trim().split('=');
            if (key) cookieMap.set(key, val.join('='));
        });

        return Array.from(cookieMap.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
    }

    /**
     * Step 1 & 2: Log into AVGControl and obtain authenticated cookies
     */
    async login(email, password) {
        const loginUrl = `${this.baseUrl}/AVGControl`;

        // 1. Fetch login page to extract CSRF token and initial cookies
        const initialRes = await this.request(loginUrl);
        let cookies = this.mergeCookies('', initialRes.setCookies);

        // Extract __RequestVerificationToken
        const tokenMatch = initialRes.body.match(/name=["']__RequestVerificationToken["']\s+type=["']hidden["']\s+value=["']([^"']+)["']/i) ||
                           initialRes.body.match(/value=["']([^"']+)["']\s+name=["']__RequestVerificationToken["']/i);

        if (!tokenMatch) {
            throw new Error("Could not extract security verification token from AVGControl login page.");
        }

        const csrfToken = tokenMatch[1];

        // 2. Submit credentials
        const postData = new URLSearchParams({
            '__RequestVerificationToken': csrfToken,
            'ReturnUrl': '/AVGControl/orders?status=ALL',
            'Email': email,
            'Password': password,
            'RememberMe': 'true'
        }).toString();

        const postRes = await this.request(loginUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Origin': this.baseUrl,
                'Referer': loginUrl,
                'Content-Length': Buffer.byteLength(postData)
            },
            body: postData
        }, cookies);

        cookies = this.mergeCookies(cookies, postRes.setCookies);

        if (postRes.statusCode === 302 || postRes.statusCode === 303 || cookies.includes('Avira.Admin')) {
            return cookies;
        }

        if (postRes.body.includes('Invalid login') || postRes.body.includes('incorrect') || postRes.body.includes('Invalid')) {
            throw new Error("Invalid AVGControl Email or Password. Please verify your credentials.");
        }

        return cookies;
    }

    /**
     * Step 3: Fetch orders page from AVGControl for a given page index
     */
    async fetchOrdersHtml(cookies, page = 1) {
        const ordersUrl = `${this.baseUrl}/AVGControl/orders?status=ALL&page=${page}`;
        let res = await this.request(ordersUrl, {}, cookies);
        let updatedCookies = this.mergeCookies(cookies, res.setCookies);

        if (res.statusCode === 302 && res.location) {
            const redirectUrl = res.location.startsWith('http') ? res.location : `${this.baseUrl}${res.location}`;
            res = await this.request(redirectUrl, {}, updatedCookies);
            updatedCookies = this.mergeCookies(updatedCookies, res.setCookies);
        }

        return { body: res.body, cookies: updatedCookies };
    }

    /**
     * Step 4: Parse orders from AVGControl table HTML
     */
    parseOrders(html) {
        const orders = [];
        const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
        let match;

        while ((match = rowRegex.exec(html)) !== null) {
            const rowHtml = match[1];
            if (rowHtml.includes('<th')) continue;

            const order = this.extractOrderFromRowHtml(rowHtml);
            if (order && order.member_id && order.name) {
                orders.push(order);
            }
        }

        return orders;
    }

    /**
     * Exact parser mapped directly to AVGControl table columns
     */
    extractOrderFromRowHtml(rowHtml) {
        // 1. Order Code
        const orderCodeMatch = rowHtml.match(/data-value=["'](ORD-[^"']+)["']/i) || rowHtml.match(/<b>(ORD-[^<]+)<\/b>/i);
        const orderCode = orderCodeMatch ? orderCodeMatch[1].trim() : '';

        // 2. Order Date (matched from ISO date data-value or formatted text)
        let orderDate = '';
        const dateMatch = rowHtml.match(/<td[^>]*data-value=["'](\d{4}-\d{2}-\d{2}[^"']*)["'][^>]*>([\s\S]*?)<\/td>/i);
        if (dateMatch) {
            orderDate = dateMatch[2].replace(/<[^>]+>/g, '').trim() || dateMatch[1].trim();
        } else {
            const fallbackDateMatch = rowHtml.match(/\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\b/i);
            if (fallbackDateMatch) orderDate = fallbackDateMatch[0];
        }

        // 3. Member ID
        let memberId = '';
        const memberIdMatch = rowHtml.match(/<a[^>]*href=["'][^"']*members\?q=([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
        if (memberIdMatch) {
            memberId = memberIdMatch[2].replace(/<[^>]+>/g, '').trim().toUpperCase();
        } else {
            const fallbackMId = rowHtml.match(/AV\d{5,6}/i);
            if (fallbackMId) memberId = fallbackMId[0].toUpperCase();
        }

        // 4. Customer Name (located in the <div> inside the Member cell)
        let customerName = '';
        const nameDivMatch = rowHtml.match(/members\?q=[^>]*>[\s\S]*?<\/a>\s*<div[^>]*>([\s\S]*?)<\/div>/i);
        if (nameDivMatch) {
            customerName = nameDivMatch[1].replace(/<[^>]+>/g, '').trim().toUpperCase();
        }

        // If not found in div, try fallback search
        if (!customerName) {
            const textLines = rowHtml.replace(/<[^>]+>/g, '\n').split('\n').map(l => l.trim()).filter(Boolean);
            const mIdx = textLines.findIndex(l => l === memberId);
            if (mIdx !== -1 && textLines[mIdx + 1] && !textLines[mIdx + 1].includes('ORD-')) {
                customerName = textLines[mIdx + 1].toUpperCase();
            }
        }

        // 5. PV & Amount (from <td class="av-num" data-value="...">)
        const nums = [...rowHtml.matchAll(/<td[^>]*class=["'][^"']*av-num[^"']*["'][^>]*data-value=["']([^"']+)["'][^>]*>([\s\S]*?)<\/td>/gi)];
        let pv = '0';
        let amount = '0';
        if (nums.length >= 2) {
            pv = parseFloat(nums[0][1]).toString();
            amount = parseFloat(nums[1][1]).toString();
        } else if (nums.length === 1) {
            amount = parseFloat(nums[0][1]).toString();
        }

        // 6. Status
        const statusMatch = rowHtml.match(/<select[^>]*name=["']status["'][^>]*>[\s\S]*?<option[^>]*value=["']([^"']+)["'][^>]*selected(?:=["'][^"']*["'])?[^>]*>/i);
        const status = statusMatch ? statusMatch[1].toUpperCase() : 'ALL';

        // 7. Tracking barcode if present
        let tracking = '';
        const trackingInputMatch = rowHtml.match(/<input[^>]*name=["']tracking["'][^>]*value=["']([^"']+)["']/i);
        if (trackingInputMatch) {
            tracking = trackingInputMatch[1].trim().toUpperCase();
        }

        return {
            order_code: orderCode,
            order_date: orderDate || new Date().toLocaleDateString('en-GB'),
            member_id: memberId,
            name: customerName,
            pv: pv || '0',
            amount: amount || '0',
            tracking: tracking || '',
            status: status
        };
    }

    /**
     * Bulk Batch Insert new orders into orders_master
     */
    async insertNewOrders(orders) {
        if (!orders || orders.length === 0) {
            return { added: 0, updatedTracking: 0 };
        }

        let addedCount = 0;
        let trackingCount = 0;
        const toInsert = [];
        const toTrack = [];

        for (const order of orders) {
            if (!order.name || order.name.trim() === '') continue;
            toInsert.push(order);
            addedCount++;

            if (order.tracking && order.tracking.length > 5) {
                toTrack.push(order);
            }
        }

        if (toInsert.length === 0) {
            return { added: 0, updatedTracking: 0 };
        }

        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const chunkSize = 50;
            for (let i = 0; i < toInsert.length; i += chunkSize) {
                const chunk = toInsert.slice(i, i + chunkSize);
                const valueClauses = [];
                const params = [];
                let pIdx = 1;

                chunk.forEach(order => {
                    valueClauses.push(`($${pIdx}, $${pIdx + 1}, $${pIdx + 2}, $${pIdx + 3}, $${pIdx + 4})`);
                    params.push(order.order_date, order.member_id, order.name, order.pv, order.amount);
                    pIdx += 5;
                });

                if (valueClauses.length > 0) {
                    await client.query(`
                        INSERT INTO orders_master (order_date, member_id, name, pv, amount)
                        VALUES ${valueClauses.join(', ')}
                    `, params);
                }
            }

            for (const order of toTrack) {
                const existingTrack = await client.query('SELECT sr_no FROM main_database WHERE UPPER(tracking) = $1', [order.tracking]);
                if (existingTrack.rows.length === 0) {
                    await client.query(`
                        INSERT INTO main_database (member_id, name, order_date, pv, amount, tracking)
                        VALUES ($1, $2, $3, $4, $5, $6)
                    `, [
                        order.member_id,
                        order.name,
                        order.order_date,
                        order.pv,
                        order.amount,
                        order.tracking
                    ]);
                    trackingCount++;
                }
            }

            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }

        return { added: addedCount, updatedTracking: trackingCount };
    }

    /**
     * Master Sync Workflow with Smart Incremental Traversal:
     * - Fetches live orders from AviraGlobal starting with Page 1 (Newest).
     * - In fast mode, if all orders on Page 1 already exist in DB, finishes instantly in seconds!
     * - Inserts only newly discovered orders into DB.
     */
    async executeFullSync(overrideEmail, overridePassword, options = {}) {
        const email = (overrideEmail || process.env.AVG_EMAIL || '').trim();
        const password = (overridePassword || process.env.AVG_PASSWORD || '').trim();
        const forceAllPages = options.forceAllPages || false;
        const maxPages = options.maxPages || 50;

        if (!email || !password) {
            throw new Error("AVGControl Email and Password are required. Please verify your credentials.");
        }

        // 1. Authenticate once
        let currentCookies = await this.login(email, password);

        // Pre-fetch existing order signatures from DB to eliminate redundant scanning
        const existingRes = await db.query('SELECT order_date, member_id, name, pv, amount FROM orders_master');
        const existingSet = new Set(
            existingRes.rows.map(r => 
                `${String(r.order_date || '').trim()}|${String(r.member_id || '').trim().toUpperCase()}|${String(r.name || '').trim().toUpperCase()}|${String(r.pv || '0').trim()}|${String(r.amount || '0').trim()}`
            )
        );
        const hasExistingOrders = existingSet.size > 0;

        // 2. Fetch and parse pages
        let allNewOrders = [];
        let totalScanned = 0;

        for (let p = 1; p <= maxPages; p++) {
            const { body: html, cookies: updatedCookies } = await this.fetchOrdersHtml(currentCookies, p);
            currentCookies = updatedCookies;
            const pageOrders = this.parseOrders(html);

            totalScanned += pageOrders.length;
            console.log(`📥 [AviraGlobal Sync] Page ${p}: Parsed ${pageOrders.length} orders (Total scanned: ${totalScanned})`);

            if (pageOrders.length === 0) {
                break;
            }

            let newOnPage = 0;
            for (const o of pageOrders) {
                const sig = `${String(o.order_date || '').trim()}|${String(o.member_id || '').trim().toUpperCase()}|${String(o.name || '').trim().toUpperCase()}|${String(o.pv || '0').trim()}|${String(o.amount || '0').trim()}`;
                if (!existingSet.has(sig)) {
                    existingSet.add(sig);
                    allNewOrders.push(o);
                    newOnPage++;
                }
            }

            // Fast incremental mode: If DB already has orders and Page 1 (or any page) has 0 new orders,
            // we have reached already-synced orders. Stop early to keep sync fast (~1-2 seconds)!
            if (!forceAllPages && hasExistingOrders) {
                if (newOnPage === 0) {
                    console.log(`⚡ [AviraGlobal Sync] Page ${p} contained only already-synced orders. Database is up to date!`);
                    break;
                }
            }

            // If a page has fewer than 25 orders, it is the last page
            if (pageOrders.length < 25) {
                break;
            }

            // Check if there is a next page
            if (!html.includes(`page=${p + 1}`)) {
                break;
            }
        }

        // 3. Save only new orders to Database
        const stats = await this.insertNewOrders(allNewOrders);

        return {
            success: true,
            total: totalScanned,
            added: stats.added,
            skipped: totalScanned - stats.added,
            updatedTracking: stats.updatedTracking,
            preview: allNewOrders.slice(0, 5)
        };
    }
}

module.exports = new AviraGlobalSyncService();
