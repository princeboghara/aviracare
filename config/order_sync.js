/**
 * 🌐 AviraCare Live Order Sync Bot
 * Supports:
 * 1. Sync New Orders (keeps existing records, pulls only new ones)
 * 2. Wipe & Sync All (deletes existing records, re-syncs entire catalog from Avira)
 * 3. Real-time step progress streaming for live UI progress bars and logs.
 * Note: Never imports or touches tracking numbers from Avira Global.
 */

const db = require('../db');
const pool = db.pool || db;
const logger = require('./logger');

class AviraOrderSyncBot {
    constructor() {
        this.baseUrl = (process.env.AVG_BASE_URL || 'https://aviraglobal.in').replace(/\/+$/, '');
        this.email = process.env.AVG_EMAIL || 'admin@aviralifecare.com';
        this.password = process.env.AVG_PASSWORD || 'Avira@Admin2026';
        this.syncIntervalMinutes = parseInt(process.env.AVG_AUTO_SYNC_MINUTES || '5', 10);
        
        this.cachedCookies = null;
        this.cookieExpiry = null;
        this.isSyncing = false;
        this.isAutoSyncEnabled = true;
        this.intervalHandle = null;

        this.lastSyncStatus = {
            lastRun: null,
            success: true,
            mode: 'idle',
            message: 'Ready',
            newOrdersAdded: 0,
            totalOrdersInDb: 0,
            error: null
        };
    }

    /**
     * 🔐 Authenticates with Avira Admin portal and caches session cookies
     */
    async getAuthenticatedCookies(forceFresh = false, onProgress = null) {
        if (!forceFresh && this.cachedCookies && this.cookieExpiry && Date.now() < this.cookieExpiry) {
            return this.cachedCookies;
        }

        if (onProgress) {
            onProgress({ step: 'auth', message: 'Connecting to https://aviraglobal.in/AVGControl...', percent: 5 });
        }

        const loginUrl = `${this.baseUrl}/AVGControl`;

        // Step 1: GET Login Page for CSRF token & initial cookies
        const getRes = await fetch(loginUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
            }
        });

        if (!getRes.ok) {
            throw new Error(`Failed to reach Avira login page: HTTP ${getRes.status}`);
        }

        const html = await getRes.text();
        const tokenMatch = html.match(/name="__RequestVerificationToken"\s+type="hidden"\s+value="([^"]+)"/);
        if (!tokenMatch) {
            throw new Error('Verification token not found on Avira login page.');
        }

        const token = tokenMatch[1];
        const rawCookies = getRes.headers.getSetCookie ? getRes.headers.getSetCookie() : [];
        let cookieJar = {};
        for (const c of rawCookies) {
            const parts = c.split(';')[0].split('=');
            cookieJar[parts[0].trim()] = parts.slice(1).join('=');
        }

        if (onProgress) {
            onProgress({ step: 'auth', message: 'Authenticating administrator credentials...', percent: 10 });
        }

        // Step 2: POST Credentials
        const formParams = new URLSearchParams();
        formParams.append('__RequestVerificationToken', token);
        formParams.append('Email', this.email);
        formParams.append('Password', this.password);
        formParams.append('RememberMe', 'true');
        formParams.append('ReturnUrl', '');

        const postRes = await fetch(loginUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Cookie': Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; '),
                'Origin': this.baseUrl,
                'Referer': loginUrl,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
            },
            body: formParams.toString(),
            redirect: 'manual'
        });

        const postCookies = postRes.headers.getSetCookie ? postRes.headers.getSetCookie() : [];
        for (const c of postCookies) {
            const parts = c.split(';')[0].split('=');
            cookieJar[parts[0].trim()] = parts.slice(1).join('=');
        }

        if (!cookieJar['Avira.Admin']) {
            throw new Error('Authentication failed. Please verify AVG_EMAIL and AVG_PASSWORD.');
        }

        this.cachedCookies = Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ');
        this.cookieExpiry = Date.now() + (4 * 60 * 60 * 1000); // 4 hours session validity

        if (onProgress) {
            onProgress({ step: 'auth_success', message: 'Session authenticated successfully!', percent: 15 });
        }

        return this.cachedCookies;
    }

    /**
     * 📥 Fetches ALL orders HTML in a single request using size=all
     * Target: https://aviraglobal.in/AVGControl/orders?status=ALL&size=all
     */
    async fetchAllOrdersHtml(onProgress = null) {
        let cookies = await this.getAuthenticatedCookies(false, onProgress);
        const url = `${this.baseUrl}/AVGControl/orders?status=ALL&size=all`;

        let res = await fetch(url, {
            headers: {
                'Cookie': cookies,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
            }
        });

        // Auto-refresh session if expired
        if (res.status === 401 || res.status === 302) {
            cookies = await this.getAuthenticatedCookies(true, onProgress);
            res = await fetch(url, {
                headers: {
                    'Cookie': cookies,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
                }
            });
        }

        if (!res.ok) {
            throw new Error(`Failed to fetch orders from size=all: HTTP ${res.status}`);
        }

        return await res.text();
    }

    /**
     * 📥 Fetches HTML of a specific orders page (Fallback)
     */
    async fetchOrdersPageHtml(pageNumber = 1, onProgress = null) {
        let cookies = await this.getAuthenticatedCookies(false, onProgress);
        const url = `${this.baseUrl}/AVGControl/orders?status=ALL&page=${pageNumber}`;

        let res = await fetch(url, {
            headers: {
                'Cookie': cookies,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
            }
        });

        if (res.status === 401 || res.status === 302) {
            cookies = await this.getAuthenticatedCookies(true, onProgress);
            res = await fetch(url, {
                headers: {
                    'Cookie': cookies,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
                }
            });
        }

        if (!res.ok) {
            throw new Error(`Failed to fetch orders page ${pageNumber}: HTTP ${res.status}`);
        }

        return await res.text();
    }

    /**
     * 🧩 Parses table rows into structured order objects (Excludes Tracking Number!)
     */
    parseOrdersFromHtml(html) {
        const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
        const parsedOrders = [];

        for (const row of rows) {
            if (row.includes('<th') || !row.includes('ORD-')) continue;

            try {
                // 1. Order Number
                const ordMatch = row.match(/data-value="(ORD-[0-9]+)"/i) || row.match(/<b>(ORD-[0-9]+)<\/b>/i);
                const orderNo = ordMatch ? ordMatch[1].trim() : null;
                if (!orderNo) continue;

                // 2. Order Date (e.g. 23 Oct 2026)
                const dateMatch = row.match(/<td data-value="[0-9-:\s]+">([^<]+)<\/td>/i);
                let orderDate = dateMatch ? dateMatch[1].trim() : '';
                if (!orderDate) {
                    const fallbackDate = row.match(/data-value="([0-9]{4}-[0-9]{2}-[0-9]{2}\s+[0-9]{2}:[0-9]{2})"/i);
                    orderDate = fallbackDate ? fallbackDate[1].trim() : '';
                }

                // 3. Member ID
                const memberMatch = row.match(/members\?q=([A-Za-z0-9]+)/i);
                const memberId = memberMatch ? memberMatch[1].trim().toUpperCase() : '';

                // 4. Customer Name
                const nameMatch = row.match(/<div style="font-size:\.8rem;color:var\(--av-muted\)">([^<]+)<\/div>/i);
                let name = nameMatch ? nameMatch[1].trim() : '';
                name = name.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x27;/g, "'");

                // 5. Total PV and Amount
                const numRegex = /<td class="av-num" data-value="([^"]+)">/gi;
                let numMatch;
                const numValues = [];
                while ((numMatch = numRegex.exec(row)) !== null) {
                    numValues.push(numMatch[1].trim());
                }

                const pv = numValues[0] || '0';
                const amount = numValues[1] || '0';

                // 🛡️ Date Filter: Only retain orders on or after 1 September 2026 (skip older orders)
                const parsedDate = new Date(orderDate).getTime();
                const minSyncDate = new Date(2026, 8, 1, 0, 0, 0).getTime();
                if (!isNaN(parsedDate) && parsedDate < minSyncDate) {
                    continue;
                }

                // Notice: Tracking number is completely ignored and excluded per protocol!
                parsedOrders.push({
                    order_no: orderNo,
                    order_date: orderDate,
                    member_id: memberId,
                    name: name,
                    pv: pv,
                    amount: amount
                });
            } catch (err) {
                console.warn('⚠️ Error parsing order row:', err.message);
            }
        }

        return parsedOrders;
    }

    /**
     * 🔢 Detects total pages available from Page 1 HTML
     */
    extractTotalPages(html) {
        const pageMatches = html.match(/page=(\d+)/g) || [];
        const pageNumbers = pageMatches.map(m => parseInt(m.replace('page=', ''), 10)).filter(n => !isNaN(n));
        return pageNumbers.length > 0 ? Math.max(...pageNumbers) : 1;
    }

    /**
     * 🛡️ Snapshot & Load Tracking Vault Map
     * Preserves all assigned tracking numbers permanently so wipe/resync NEVER loses them.
     */
    async getTrackingVaultMap() {
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS order_trackings (
                    order_no VARCHAR(100) PRIMARY KEY,
                    tracking_no VARCHAR(100) NOT NULL DEFAULT '',
                    member_id VARCHAR(100),
                    delivery_status VARCHAR(50) DEFAULT 'Pending',
                    destination VARCHAR(100),
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);

            // Snapshot from orders_master
            await pool.query(`
                INSERT INTO order_trackings (order_no, tracking_no, member_id, updated_at)
                SELECT order_no, tracking_no, member_id, NOW()
                FROM orders_master
                WHERE order_no IS NOT NULL AND tracking_no IS NOT NULL AND TRIM(tracking_no) != ''
                ON CONFLICT (order_no) DO UPDATE
                SET tracking_no = EXCLUDED.tracking_no, member_id = EXCLUDED.member_id, updated_at = NOW();
            `);

            // Snapshot from main_database
            await pool.query(`
                INSERT INTO order_trackings (order_no, tracking_no, member_id, updated_at)
                SELECT order_no, tracking, member_id, NOW()
                FROM main_database
                WHERE order_no IS NOT NULL AND tracking IS NOT NULL AND TRIM(tracking) != ''
                ON CONFLICT (order_no) DO UPDATE
                SET tracking_no = EXCLUDED.tracking_no, member_id = EXCLUDED.member_id, updated_at = NOW();
            `);

            // Snapshot from consignment_parcels
            await pool.query(`
                INSERT INTO order_trackings (order_no, tracking_no, member_id, updated_at)
                SELECT order_no, tracking, member_id, NOW()
                FROM consignment_parcels
                WHERE order_no IS NOT NULL AND tracking IS NOT NULL AND TRIM(tracking) != ''
                ON CONFLICT (order_no) DO UPDATE
                SET tracking_no = EXCLUDED.tracking_no, member_id = EXCLUDED.member_id, updated_at = NOW();
            `);
        } catch (e) {
            console.warn('⚠️ Tracking vault snapshot notice:', e.message);
        }

        const vaultRes = await pool.query("SELECT order_no, tracking_no FROM order_trackings WHERE tracking_no IS NOT NULL AND TRIM(tracking_no) != ''");
        const map = new Map();
        for (const row of vaultRes.rows) {
            if (row.order_no) {
                map.set(row.order_no.toUpperCase().trim(), (row.tracking_no || '').toUpperCase().trim());
            }
        }
        return map;
    }

    /**
     * ⚡ OPTION 1: Sync New Orders
     * Fetches all orders via size=all, detects brand new orders, batch inserts only new ones.
     */
    async syncNewOrders(onProgress = null) {
        if (this.isSyncing) {
            const msg = 'Another sync process is already running. Please wait a moment.';
            if (onProgress) onProgress({ step: 'error', message: msg, error: msg });
            return { success: false, message: msg };
        }

        this.isSyncing = true;
        let totalNewAdded = 0;

        try {
            if (onProgress) {
                onProgress({ step: 'start', mode: 'new', message: 'Connecting to https://aviraglobal.in/AVGControl/orders?status=ALL&size=all...', percent: 10 });
            }

            // Fetch all orders using size=all in 1 lightning-fast request
            const html = await this.fetchAllOrdersHtml(onProgress);
            if (onProgress) {
                onProgress({ step: 'parsing', message: 'Received live catalog. Parsing orders...', percent: 40 });
            }

            const liveOrders = this.parseOrdersFromHtml(html);
            if (onProgress) {
                onProgress({ step: 'checking', message: `Parsed ${liveOrders.length} orders from Avira. Checking for new records...`, percent: 60 });
            }

            // Get existing order_no set from database
            const existingRes = await pool.query('SELECT order_no FROM orders_master WHERE order_no IS NOT NULL');
            const existingOrderNos = new Set(existingRes.rows.map(r => r.order_no));

            // Find new orders that are not in database yet
            const newOrdersToInsert = liveOrders.filter(o => o.order_no && !existingOrderNos.has(o.order_no));

            if (newOrdersToInsert.length > 0) {
                if (onProgress) {
                    onProgress({ step: 'inserting', message: `Found ${newOrdersToInsert.length} new orders! Saving into database...`, percent: 80 });
                }

                // Load tracking vault lookup map
                const trackingMap = await this.getTrackingVaultMap();

                // Batch insert new orders in chunks of 50
                const CHUNK_SIZE = 50;
                for (let i = 0; i < newOrdersToInsert.length; i += CHUNK_SIZE) {
                    const chunk = newOrdersToInsert.slice(i, i + CHUNK_SIZE);
                    const values = [];
                    const valueStrings = chunk.map((order, idx) => {
                        const offset = idx * 7;
                        const preservedTracking = trackingMap.get((order.order_no || '').toUpperCase().trim()) || '';
                        values.push(order.order_no, order.order_date, order.member_id, order.name, order.pv, order.amount, preservedTracking);
                        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`;
                    });

                    // 1. Insert into orders_master with preserved tracking
                    await pool.query(`
                        INSERT INTO orders_master (order_no, order_date, member_id, name, pv, amount, tracking_no)
                        VALUES ${valueStrings.join(', ')}
                        ON CONFLICT (order_no) DO UPDATE
                        SET tracking_no = CASE WHEN EXCLUDED.tracking_no != '' THEN EXCLUDED.tracking_no ELSE orders_master.tracking_no END
                    `, values);

                    // 2. Directly mirror into main_database (bypassing Confirm Member)
                    await pool.query(`
                        INSERT INTO main_database (order_no, order_date, member_id, name, pv, amount, tracking, delivery_status)
                        VALUES ${chunk.map((_, idx) => {
                            const offset = idx * 7;
                            return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, 'Pending')`;
                        }).join(', ')}
                        ON CONFLICT (order_no) DO UPDATE
                        SET tracking = CASE WHEN EXCLUDED.tracking != '' THEN EXCLUDED.tracking ELSE main_database.tracking END
                    `, values);

                    totalNewAdded += chunk.length;
                }
            }

            const totalInDbRes = await pool.query('SELECT count(*) FROM orders_master');
            const totalInDb = parseInt(totalInDbRes.rows[0].count, 10);

            this.lastSyncStatus = {
                lastRun: new Date(),
                success: true,
                mode: 'new',
                message: totalNewAdded > 0 
                    ? `Sync Complete! Added ${totalNewAdded} new orders. Total in DB: ${totalInDb}.`
                    : `System is already up to date! All ${totalInDb} orders are in sync.`,
                newOrdersAdded: totalNewAdded,
                totalOrdersInDb: totalInDb,
                error: null
            };

            logger.aviraglobal(
                'SUCCESS', 
                totalNewAdded > 0 
                    ? `Incremental Check: Successfully imported ${totalNewAdded} new orders. Total in DB: ${totalInDb}.` 
                    : `Incremental Check: Catalog is 100% up to date. (${totalInDb} orders in DB).`,
                { newOrdersAdded: totalNewAdded, totalOrdersInDb: totalInDb, mode: 'new' }
            );

            if (onProgress) {
                onProgress({
                    step: 'done',
                    mode: 'new',
                    message: totalNewAdded > 0 
                        ? `Sync complete! Successfully added ${totalNewAdded} new orders. Total records: ${totalInDb}.`
                        : `System is completely up to date! All ${totalInDb} orders are in sync.`,
                    totalNewAdded,
                    newOrdersAdded: totalNewAdded,
                    totalInDb,
                    percent: 100
                });
            }

            return this.lastSyncStatus;

        } catch (err) {
            console.error('❌ [Sync New Orders Error]:', err.message);
            logger.aviraglobal('ERROR', `Incremental Sync Failed: ${err.message}`, { error: err.message, mode: 'new' });
            this.lastSyncStatus = {
                lastRun: new Date(),
                success: false,
                mode: 'new',
                message: err.message,
                newOrdersAdded: totalNewAdded,
                totalOrdersInDb: 0,
                error: err.message
            };
            if (onProgress) {
                onProgress({ step: 'error', message: err.message, error: err.message, percent: 100 });
            }
            return this.lastSyncStatus;
        } finally {
            this.isSyncing = false;
        }
    }

    /**
     * 🧹 OPTION 2: Wipe and Sync All
     * Clears all old orders from orders_master, pulls entire catalog via size=all in 1 single shot.
     */
    async wipeAndSyncAll(onProgress = null) {
        if (this.isSyncing) {
            const msg = 'Another sync process is already running. Please wait a moment.';
            if (onProgress) onProgress({ step: 'error', message: msg, error: msg });
            return { success: false, message: msg };
        }

        this.isSyncing = true;
        let totalNewAdded = 0;

        try {
            if (onProgress) {
                onProgress({ step: 'start', mode: 'wipe_all', message: 'Initiating Full Wipe & Fresh Sync from size=all...', percent: 5 });
            }

            // Step 1: Snapshot and preserve all tracking numbers in Vault
            if (onProgress) {
                onProgress({ step: 'snapshot', message: 'Preserving tracking numbers in Tracking Vault...', percent: 8 });
            }
            const trackingMap = await this.getTrackingVaultMap();

            // Step 2: Wipe existing orders immediately
            if (onProgress) {
                onProgress({ step: 'wipe', message: 'Wiping old records from Orders Master & Master Database...', percent: 16 });
            }
            await pool.query('DELETE FROM orders_master');
            await pool.query('TRUNCATE TABLE main_database RESTART IDENTITY');

            // Step 3: Fetch all orders from size=all in 1 single request
            if (onProgress) {
                onProgress({ step: 'fetching', message: 'Fetching entire catalog from https://aviraglobal.in/AVGControl/orders?status=ALL&size=all...', percent: 35 });
            }
            const html = await this.fetchAllOrdersHtml(onProgress);

            if (onProgress) {
                onProgress({ step: 'parsing', message: 'Parsing all orders...', percent: 60 });
            }
            const allOrders = this.parseOrdersFromHtml(html);

            if (onProgress) {
                onProgress({ step: 'inserting', message: `Parsed ${allOrders.length} orders! Restoring orders with preserved tracking numbers...`, percent: 75 });
            }

            // Step 4: Fast Batch insert in chunks of 100 with preserved tracking numbers!
            const CHUNK_SIZE = 100;
            for (let i = 0; i < allOrders.length; i += CHUNK_SIZE) {
                const chunk = allOrders.slice(i, i + CHUNK_SIZE);
                const values = [];
                const valueStrings = chunk.map((order, idx) => {
                    const offset = idx * 7;
                    const preservedTracking = trackingMap.get((order.order_no || '').toUpperCase().trim()) || '';
                    values.push(order.order_no, order.order_date, order.member_id, order.name, order.pv, order.amount, preservedTracking);
                    return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`;
                });

                // 1. Insert into orders_master with preserved tracking
                await pool.query(`
                    INSERT INTO orders_master (order_no, order_date, member_id, name, pv, amount, tracking_no)
                    VALUES ${valueStrings.join(', ')}
                    ON CONFLICT (order_no) DO UPDATE
                    SET tracking_no = CASE WHEN EXCLUDED.tracking_no != '' THEN EXCLUDED.tracking_no ELSE orders_master.tracking_no END
                `, values);

                // 2. Directly mirror into main_database with preserved tracking
                await pool.query(`
                    INSERT INTO main_database (order_no, order_date, member_id, name, pv, amount, tracking, delivery_status)
                    VALUES ${chunk.map((_, idx) => {
                        const offset = idx * 7;
                        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, 'Pending')`;
                    }).join(', ')}
                    ON CONFLICT (order_no) DO UPDATE
                    SET tracking = CASE WHEN EXCLUDED.tracking != '' THEN EXCLUDED.tracking ELSE main_database.tracking END
                `, values);

                totalNewAdded += chunk.length;
                const progressPct = Math.min(96, Math.round(75 + (totalNewAdded / allOrders.length) * 21));
                if (onProgress) {
                    onProgress({
                        step: 'inserting',
                        message: `Saved ${totalNewAdded}/${allOrders.length} orders into database...`,
                        totalNewAdded,
                        percent: progressPct
                    });
                }
            }

            const totalInDbRes = await pool.query('SELECT count(*) FROM orders_master');
            const totalInDb = parseInt(totalInDbRes.rows[0].count, 10);

            this.lastSyncStatus = {
                lastRun: new Date(),
                success: true,
                mode: 'wipe_all',
                message: `Wipe & Sync Complete! Successfully imported all ${totalNewAdded} orders in 1 shot.`,
                newOrdersAdded: totalNewAdded,
                totalOrdersInDb: totalInDb,
                error: null
            };

            logger.aviraglobal(
                'SUCCESS', 
                `Wipe & Sync All Complete: Successfully imported all ${totalNewAdded} orders in 1 shot. Total in DB: ${totalInDb}.`,
                { totalOrdersInDb: totalInDb, totalNewAdded, mode: 'wipe_all' }
            );

            if (onProgress) {
                onProgress({
                    step: 'done',
                    mode: 'wipe_all',
                    message: `Complete! All ${totalInDb} orders successfully imported from size=all in 1 shot!`,
                    newOrdersAdded: totalNewAdded,
                    totalNewAdded,
                    totalInDb,
                    percent: 100
                });
            }

            return this.lastSyncStatus;

        } catch (err) {
            console.error('❌ [Wipe & Sync All Error]:', err.message);
            logger.aviraglobal('ERROR', `Wipe & Sync All Failed: ${err.message}`, { error: err.message, mode: 'wipe_all' });
            this.lastSyncStatus = {
                lastRun: new Date(),
                success: false,
                mode: 'wipe_all',
                message: err.message,
                newOrdersAdded: totalNewAdded,
                totalOrdersInDb: 0,
                error: err.message
            };
            if (onProgress) {
                onProgress({ step: 'error', message: err.message, error: err.message, percent: 100 });
            }
            return this.lastSyncStatus;
        } finally {
            this.isSyncing = false;
        }
    }

    /**
     * 💾 Loads persisted bot configuration from database on boot
     */
    async loadSettingsFromDb() {
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS bot_settings (
                    key VARCHAR(50) PRIMARY KEY,
                    value TEXT,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);
            const res = await pool.query("SELECT key, value FROM bot_settings WHERE key IN ('sync_interval_minutes', 'is_auto_sync_enabled')");
            res.rows.forEach(r => {
                if (r.key === 'sync_interval_minutes') {
                    const parsed = parseInt(r.value, 10);
                    if (!isNaN(parsed) && parsed >= 1 && parsed <= 1440) {
                        this.syncIntervalMinutes = parsed;
                    }
                }
                if (r.key === 'is_auto_sync_enabled') {
                    this.isAutoSyncEnabled = (r.value === 'true' || r.value === '1');
                }
            });
        } catch (e) {
            console.warn('⚠️ Could not load bot_settings from DB:', e.message);
        }
    }

    /**
     * 🔄 Restarts the interval timer with current syncIntervalMinutes
     */
    restartIntervalTimer() {
        if (this.intervalHandle) {
            clearInterval(this.intervalHandle);
            this.intervalHandle = null;
        }

        const intervalMs = Math.max(1, this.syncIntervalMinutes) * 60 * 1000;
        this.intervalHandle = setInterval(() => {
            if (!this.isAutoSyncEnabled) {
                console.log(`⏸️ [Avira Sync Bot] ${this.syncIntervalMinutes}m timer fired but auto-sync is PAUSED. Skipping.`);
                return;
            }
            this.syncNewOrders().catch(e => console.warn('Background sync notice:', e.message));
        }, intervalMs);
    }

    /**
     * ⏱️ Customizes the sync interval in minutes and restarts the background timer
     */
    async setIntervalMinutes(minutes) {
        const parsed = parseInt(minutes, 10);
        if (isNaN(parsed) || parsed < 1 || parsed > 1440) {
            throw new Error('Sync interval must be between 1 and 1440 minutes.');
        }
        this.syncIntervalMinutes = parsed;
        this.restartIntervalTimer();

        try {
            await pool.query(`
                INSERT INTO bot_settings (key, value, updated_at) 
                VALUES ('sync_interval_minutes', $1, NOW())
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
            `, [parsed.toString()]);
        } catch (e) {
            console.warn('Could not persist interval to DB:', e.message);
        }

        logger.aviraglobal('INFO', `Timer interval updated to every ${this.syncIntervalMinutes} minutes.`, { intervalMinutes: this.syncIntervalMinutes });

        return { 
            success: true, 
            syncIntervalMinutes: this.syncIntervalMinutes, 
            isAutoSyncEnabled: this.isAutoSyncEnabled,
            message: `Sync interval successfully updated to every ${this.syncIntervalMinutes} minutes.` 
        };
    }

    /**
     * 🎛️ Explicitly sets the bot start/stop (active/paused) state
     */
    async setBotState(enabled) {
        this.isAutoSyncEnabled = Boolean(enabled);
        console.log(`🎛️ [Avira Sync Bot] Auto-sync state set to: ${this.isAutoSyncEnabled ? `ACTIVE (${this.syncIntervalMinutes}m)` : 'PAUSED'}`);
        
        try {
            await pool.query(`
                INSERT INTO bot_settings (key, value, updated_at) 
                VALUES ('is_auto_sync_enabled', $1, NOW())
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
            `, [this.isAutoSyncEnabled.toString()]);
        } catch (e) {}

        logger.aviraglobal('INFO', `Bot daemon state changed to: ${this.isAutoSyncEnabled ? `ACTIVE (${this.syncIntervalMinutes}m)` : 'PAUSED'}.`, { isAutoSyncEnabled: this.isAutoSyncEnabled, intervalMinutes: this.syncIntervalMinutes });

        return { 
            success: true,
            isAutoSyncEnabled: this.isAutoSyncEnabled, 
            syncIntervalMinutes: this.syncIntervalMinutes,
            message: this.isAutoSyncEnabled ? `Auto-sync is now Active (every ${this.syncIntervalMinutes} mins)` : 'Auto-sync has been Paused'
        };
    }

    /**
     * ⏸️ Pauses background auto-sync
     */
    async pauseAutoSync() {
        return this.setBotState(false);
    }

    /**
     * ▶️ Resumes background auto-sync
     */
    async resumeAutoSync() {
        return this.setBotState(true);
    }

    /**
     * 🔄 Toggles background auto-sync on/off
     */
    async toggleAutoSync() {
        return this.setBotState(!this.isAutoSyncEnabled);
    }

    /**
     * 📊 Returns current sync status
     */
    async getStatus() {
        const totalInDb = await pool.query('SELECT count(*) FROM orders_master').catch(() => ({ rows: [{ count: 0 }] }));
        return {
            ...this.lastSyncStatus,
            isAutoSyncEnabled: this.isAutoSyncEnabled,
            totalOrdersInDb: parseInt(totalInDb.rows[0].count, 10),
            syncIntervalMinutes: this.syncIntervalMinutes,
            baseUrl: this.baseUrl,
            email: this.email,
            isSyncing: this.isSyncing
        };
    }

    /**
     * ⏱️ Starts the automated background timer bot (syncs new orders quietly)
     */
    async startBackgroundBot() {
        await this.loadSettingsFromDb();

        if (this.intervalHandle) {
            clearInterval(this.intervalHandle);
        }

        const intervalMs = Math.max(1, this.syncIntervalMinutes) * 60 * 1000;
        console.log(`🚀 [Avira Sync Bot] Initialized. Auto-checking every ${this.syncIntervalMinutes} minutes (Active: ${this.isAutoSyncEnabled}).`);

        // Initial background check after 10 seconds of server boot
        setTimeout(() => {
            if (!this.isAutoSyncEnabled) return;
            this.syncNewOrders().catch(e => console.warn('Background sync notice:', e.message));
        }, 10000);

        // Recurring interval
        this.intervalHandle = setInterval(() => {
            if (!this.isAutoSyncEnabled) {
                console.log(`⏸️ [Avira Sync Bot] ${this.syncIntervalMinutes}-minute timer fired but auto-sync is PAUSED. Skipping.`);
                return;
            }
            this.syncNewOrders().catch(e => console.warn('Background sync notice:', e.message));
        }, intervalMs);
    }
}

module.exports = new AviraOrderSyncBot();
