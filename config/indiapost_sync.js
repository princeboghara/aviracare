let puppeteerModule = null;
async function getPuppeteer() {
    if (!puppeteerModule) {
        const mod = await import('puppeteer-core');
        puppeteerModule = mod.default || mod;
    }
    return puppeteerModule;
}
const fs = require('fs');
const db = require('../db');

class IndiaPostSyncBot {
    constructor() {
        this.customerId = process.env.INDIA_POST_CUSTOMER_ID || '1613309268';
        this.password = process.env.INDIA_POST_PASSWORD || 'Dop@1234';
        this.loginUrl = 'https://app.indiapost.gov.in/customer-selfservice/login';
        this.homeUrl = 'https://app.indiapost.gov.in/customer-selfservice/home';
        this.trackUrl = 'https://app.indiapost.gov.in/customer-selfservice/track';

        this.status = {
            isSyncing: false,
            currentStep: 'Idle',
            progressPercent: 0,
            totalArticles: 0,
            syncedArticles: 0,
            updatedRecords: 0,
            accountName: 'AVIRA LIFE CARE BOGHARA',
            customerId: this.customerId,
            walletBalance: '₹1,106.00',
            lastSyncTime: null,
            lastSyncStatus: 'Ready',
            error: null,
            isPaused: false
        };

        this.syncIntervalHours = parseInt(process.env.INDIA_POST_AUTO_SYNC_HOURS, 10) || 6;
        this.timer = null;
        this.findBrowserExecutable();
        this.initAutoScheduler();
    }

    findBrowserExecutable() {
        const candidatePaths = [
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
            'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
        ];

        this.executablePath = candidatePaths.find(p => fs.existsSync(p)) || candidatePaths[0];
    }

    initAutoScheduler() {
        const intervalMs = this.syncIntervalHours * 60 * 60 * 1000;
        this.timer = setInterval(() => {
            if (!this.status.isPaused && !this.status.isSyncing) {
                console.log(`⏰ [India Post Bot] Auto-sync triggered (every ${this.syncIntervalHours}h)...`);
                this.startLiveSync().catch(err => console.error('Auto India Post sync error:', err.message));
            }
        }, intervalMs);
        console.log(`🚀 [India Post Bot] Auto-scheduler initialized. Syncing every ${this.syncIntervalHours} hours.`);
    }

    getStatus() {
        return { ...this.status };
    }

    pauseScheduler() {
        this.status.isPaused = true;
        return { success: true, isPaused: true, message: 'Auto-sync scheduler paused.' };
    }

    resumeScheduler() {
        this.status.isPaused = false;
        return { success: true, isPaused: false, message: 'Auto-sync scheduler resumed.' };
    }

    updateProgress(step, percent, onProgress, extra = {}) {
        this.status.currentStep = step;
        this.status.progressPercent = Math.min(100, Math.max(0, Math.round(percent)));
        Object.assign(this.status, extra);

        if (typeof onProgress === 'function') {
            try {
                onProgress({ ...this.status });
            } catch (e) {}
        }
    }

    async launchBrowser() {
        const puppeteer = await getPuppeteer();
        return await puppeteer.launch({
            executablePath: this.executablePath,
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--window-size=1280,900'
            ]
        });
    }

    async startLiveSync(onProgress) {
        if (this.status.isSyncing) {
            return { success: false, message: 'India Post sync is already running in background.' };
        }

        this.status.isSyncing = true;
        this.status.error = null;
        this.status.lastSyncStatus = 'Running';
        this.status.syncedArticles = 0;
        this.status.updatedRecords = 0;

        let browser = null;

        try {
            // STEP 1: LOAD TRACKING NUMBERS FROM MAIN_DATABASE
            this.updateProgress('Fetching Tracking Numbers from Master Database...', 5, onProgress);
            const dbRes = await db.query(`
                SELECT tracking 
                FROM main_database 
                WHERE tracking ~ '^[A-Z]{2}[0-9]{9}[A-Z]{2}$'
                ORDER BY sr_no DESC
            `);

            const allTrackings = dbRes.rows.map(r => r.tracking.trim()).filter(Boolean);
            this.status.totalArticles = allTrackings.length;

            if (allTrackings.length === 0) {
                this.updateProgress('No valid tracking numbers found in database to track.', 100, onProgress, { isSyncing: false });
                return { success: true, updatedCount: 0, message: 'No consignments to track.' };
            }

            // STEP 2: LAUNCH HEADLESS BROWSER & LOGIN
            this.updateProgress('Initializing Chrome Automation Engine...', 10, onProgress);
            browser = await this.launchBrowser();
            const page = await browser.newPage();
            await page.setViewport({ width: 1280, height: 900 });

            this.updateProgress('Connecting to India Post Customer Self Service...', 18, onProgress);
            await page.goto(this.loginUrl, { waitUntil: 'networkidle2', timeout: 35000 });

            this.updateProgress('Authenticating Customer ID 1613309268...', 25, onProgress);
            await page.waitForSelector('input[autoComplete="username"]', { timeout: 12000 });
            await page.type('input[autoComplete="username"]', this.customerId, { delay: 30 });
            await page.type('input[autoComplete="current-password"]', this.password, { delay: 30 });

            const submitBtn = await page.$('button[type="submit"]');
            if (submitBtn) await submitBtn.click();
            else await page.keyboard.press('Enter');

            this.updateProgress('Verifying Session & Security Handshake...', 35, onProgress);
            try {
                await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 });
            } catch (e) {}

            await new Promise(r => setTimeout(r, 1500));

            // Extract Wallet & Account info
            try {
                const dashInfo = await page.evaluate(() => {
                    const text = document.body ? document.body.innerText : '';
                    let wallet = '₹1,106.00';
                    const walletMatch = text.match(/₹[\d,]+(\.\d{2})?/);
                    if (walletMatch) wallet = walletMatch[0];
                    return { wallet };
                });
                if (dashInfo.wallet) this.status.walletBalance = dashInfo.wallet;
            } catch (e) {}

            // STEP 3: NAVIGATE TO BULK TRACKING (/customer-selfservice/track)
            this.updateProgress('Navigating to India Post Bulk Tracking Portal...', 45, onProgress);
            await page.goto(this.trackUrl, { waitUntil: 'networkidle2', timeout: 30000 });

            // Click "Bulk / upload" button
            await page.evaluate(() => {
                const btns = Array.from(document.querySelectorAll('button'));
                const bulkBtn = btns.find(b => b.innerText.includes('Bulk') || b.innerText.includes('upload'));
                if (bulkBtn) bulkBtn.click();
            });

            await new Promise(r => setTimeout(r, 1500));
            await page.waitForSelector('textarea', { timeout: 12000 });

            // STEP 4: BATCH PROCESS TRACKING NUMBERS IN BATCHES OF 100
            const BATCH_SIZE = 100;
            const batches = [];
            for (let i = 0; i < allTrackings.length; i += BATCH_SIZE) {
                batches.push(allTrackings.slice(i, i + BATCH_SIZE));
            }

            let totalUpdated = 0;
            let totalSynced = 0;

            for (let bIdx = 0; bIdx < batches.length; bIdx++) {
                const batch = batches[bIdx];
                const batchText = batch.join('\n');
                const percentBase = 50 + Math.round((bIdx / batches.length) * 40);

                this.updateProgress(`Submitting Batch ${bIdx + 1}/${batches.length} (${batch.length} Parcels) to Bulk Tracking...`, percentBase, onProgress);

                // Ensure we are in Bulk tab
                await page.evaluate(() => {
                    const btns = Array.from(document.querySelectorAll('button'));
                    const bulkBtn = btns.find(b => b.innerText.includes('Bulk') || b.innerText.includes('upload'));
                    if (bulkBtn) bulkBtn.click();
                });

                await new Promise(r => setTimeout(r, 800));

                // Paste tracking numbers into textarea using React value setter
                await page.evaluate((text) => {
                    const ta = document.querySelector('textarea');
                    if (ta) {
                        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
                        setter.call(ta, text);
                        ta.dispatchEvent(new Event('input', { bubbles: true }));
                        ta.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }, batchText);

                await new Promise(r => setTimeout(r, 1200));

                // Click Track button
                await page.evaluate(() => {
                    const btns = Array.from(document.querySelectorAll('button'));
                    const trackBtn = btns.find(b => b.innerText.toLowerCase().startsWith('track ') && !b.innerText.toLowerCase().includes('bulk'));
                    if (trackBtn) trackBtn.click();
                });

                // Wait for results table to populate
                try {
                    await page.waitForSelector('table tbody tr', { timeout: 25000 });
                } catch (e) {
                    // Fallback sleep if selector wait timed out
                    await new Promise(r => setTimeout(r, 8000));
                }

                // Extract consignment rows from India Post results table
                const batchResults = await page.evaluate(() => {
                    const results = [];
                    const rows = Array.from(document.querySelectorAll('table tbody tr'));
                    for (const tr of rows) {
                        const cells = Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim());
                        if (cells.length >= 4) {
                            const firstCell = cells[0];
                            const trackMatch = firstCell.match(/^[A-Z]{2}\d{9}[A-Z]{2}/);
                            if (trackMatch) {
                                const tracking = trackMatch[0];
                                
                                // Booked Date from first cell (e.g. "Business Parcel · 22 Aug 2026")
                                let bookedDate = '';
                                const dateMatch = firstCell.match(/\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}/i);
                                if (dateMatch) bookedDate = dateMatch[0];

                                const destination = cells[1] && cells[1] !== '—' && cells[1] !== '-' ? cells[1] : '';
                                const latestEvent = cells[2] || '';
                                const rawStatus = cells[3] || 'In Transit';

                                // Extract delivery date if present in latestEvent
                                let deliveryDate = '';
                                if (/delivered/i.test(rawStatus)) {
                                    const eventDateMatch = latestEvent.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}/);
                                    if (eventDateMatch) deliveryDate = eventDateMatch[0];
                                    else if (dateMatch) deliveryDate = dateMatch[0];
                                }

                                results.push({
                                    tracking,
                                    bookedDate,
                                    destination,
                                    latestEvent,
                                    status: rawStatus,
                                    deliveryDate
                                });
                            }
                        }
                    }
                    return results;
                });

                // UPDATE DATABASE RECORDS
                for (const item of batchResults) {
                    let normalizedStatus = item.status;
                    if (/delivered/i.test(normalizedStatus)) normalizedStatus = 'Delivered';
                    else if (/dispatched/i.test(normalizedStatus)) normalizedStatus = 'Item Dispatched';
                    else if (/transit/i.test(normalizedStatus)) normalizedStatus = 'In Transit';

                    const updateRes = await db.query(`
                        UPDATE main_database 
                        SET 
                            delivery_status = $1::VARCHAR,
                            destination = COALESCE(NULLIF($2::VARCHAR, ''), destination),
                            booked_date = COALESCE(NULLIF($3::VARCHAR, ''), booked_date),
                            delivery_date = CASE 
                                WHEN $1::VARCHAR = 'Delivered' THEN COALESCE(NULLIF($4::VARCHAR, ''), delivery_date, TO_CHAR(NOW(), 'DD Mon YYYY')) 
                                ELSE delivery_date 
                            END,
                            last_sync_time = NOW()
                        WHERE UPPER(TRIM(tracking)) = UPPER(TRIM($5::VARCHAR))
                    `, [normalizedStatus, item.destination, item.bookedDate, item.deliveryDate, item.tracking]);

                    if (updateRes.rowCount > 0) {
                        totalUpdated += updateRes.rowCount;
                    }
                }

                totalSynced += batchResults.length;
                this.status.syncedArticles = totalSynced;
                this.status.updatedRecords = totalUpdated;

                // If not last batch, click Clear and small rest
                if (bIdx < batches.length - 1) {
                    await page.evaluate(() => {
                        const btns = Array.from(document.querySelectorAll('button'));
                        const clearBtn = btns.find(b => b.innerText.includes('Clear'));
                        if (clearBtn) clearBtn.click();
                    });
                    await new Promise(r => setTimeout(r, 1500));
                }
            }

            // Ensure last_sync_time is recorded
            await db.query(`UPDATE main_database SET last_sync_time = NOW() WHERE last_sync_time IS NULL`);

            const nowStr = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
            this.status.lastSyncTime = nowStr;
            this.status.updatedRecords = totalUpdated;
            this.status.syncedArticles = totalSynced;
            this.status.lastSyncStatus = 'Completed Successfully';

            this.updateProgress(`Sync Completed! ${totalUpdated} Master Records Updated from Bulk Tracking.`, 100, onProgress, {
                isSyncing: false,
                lastSyncTime: nowStr
            });

            return {
                success: true,
                updatedCount: totalUpdated,
                syncedArticles: totalSynced,
                walletBalance: this.status.walletBalance,
                accountName: this.status.accountName,
                lastSyncTime: nowStr
            };

        } catch (err) {
            console.error('❌ India Post Bulk Sync Error:', err.message);
            this.status.isSyncing = false;
            this.status.error = err.message;
            this.status.lastSyncStatus = 'Failed: ' + err.message;
            this.updateProgress('Sync Failed: ' + err.message, 100, onProgress, { isSyncing: false });
            return { success: false, error: err.message };
        } finally {
            if (browser) {
                try { await browser.close(); } catch(e) {}
            }
        }
    }
}

module.exports = new IndiaPostSyncBot();
