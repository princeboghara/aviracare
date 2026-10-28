/**
 * 👥 AviraCare Customer & Member Sync Bot
 * Auto-syncs member directory from:
 * https://aviraglobal.in/AVGControl/members?size=all
 * Fields extracted: name, member_id, mobile, email
 * Frequency: Every 30 minutes & manual on-demand trigger.
 */

const db = require('../db');
const pool = db.pool || db;
const orderSyncBot = require('./order_sync');

class CustomerSyncBot {
    constructor() {
        this.baseUrl = (process.env.AVG_BASE_URL || 'https://aviraglobal.in').replace(/\/+$/, '');
        this.syncIntervalMinutes = 30; // Auto-sync every 30 minutes
        this.isSyncing = false;
        this.intervalHandle = null;

        this.lastSyncStatus = {
            lastRun: null,
            success: true,
            totalMembersInDb: 0,
            syncedCount: 0,
            message: 'Ready',
            error: null
        };
    }

    /**
     * 🚀 Initializes the automatic 30-minute background sync
     */
    initAutoScheduler() {
        if (this.intervalHandle) clearInterval(this.intervalHandle);

        console.log(`🚀 [Customer Sync Bot] Auto-scheduler initialized. Syncing every ${this.syncIntervalMinutes} minutes.`);

        // Non-blocking initial sync after server boot (delayed 10s to let server stabilize)
        setTimeout(() => {
            this.syncMembers().catch(err => console.warn('⚠️ Initial Customer Sync notice:', err.message));
        }, 10000);

        // Recurring schedule every 30 minutes
        this.intervalHandle = setInterval(() => {
            console.log('⏰ [Customer Sync Bot] Triggering scheduled 30-minute member directory sync...');
            this.syncMembers().catch(err => console.error('❌ Scheduled Customer Sync error:', err.message));
        }, this.syncIntervalMinutes * 60 * 1000);
    }

    /**
     * 📥 Fetches members page HTML using authenticated cookies
     */
    async fetchMembersHtml() {
        const cookies = await orderSyncBot.getAuthenticatedCookies();
        const url = `${this.baseUrl}/AVGControl/members?size=all`;

        let res = await fetch(url, {
            headers: {
                'Cookie': cookies,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
            }
        });

        if (res.status === 401 || res.status === 302) {
            const freshCookies = await orderSyncBot.getAuthenticatedCookies(true);
            res = await fetch(url, {
                headers: {
                    'Cookie': freshCookies,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
                }
            });
        }

        if (!res.ok) {
            throw new Error(`Failed to fetch members directory: HTTP ${res.status}`);
        }

        return await res.text();
    }

    /**
     * 🧩 Parses members HTML into clean structured records
     */
    parseMembersHtml(html) {
        const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
        const parsedMembers = [];

        for (const row of rows) {
            if (row.includes('<th') || !row.includes('/AVGControl/members/')) continue;

            try {
                // 1. Member Name: <b>...</b>
                const nameMatch = row.match(/<b>([^<]+)<\/b>/i);
                let name = nameMatch ? nameMatch[1].trim() : '';
                name = name.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x27;/g, "'");

                // 2. Member ID: class="av-openpanel" or href="/AVGControl/members/.../open"
                const memberMatch = row.match(/class="av-openpanel"[^>]*>([A-Za-z0-9]+)<\/a>/i) || 
                                    row.match(/href="\/AVGControl\/members\/[0-9]+\/open"[^>]*>([A-Za-z0-9]+)<\/a>/i) ||
                                    row.match(/data-value="[^"]*\s+([A-Za-z0-9]+)"/i);
                const memberId = memberMatch ? memberMatch[1].trim().toUpperCase() : '';

                // 3. Mobile Number: 10-digit number
                const mobileMatch = row.match(/([0-9]{10})/);
                const mobile = mobileMatch ? mobileMatch[1].trim() : '';

                // 4. Email / Gmail
                const emailMatch = row.match(/<div style="color:var\(--av-muted\);[^"]*">([^<]+)<\/div>/i) ||
                                   row.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
                let email = emailMatch ? emailMatch[1].trim() : '';

                if (memberId && (name || mobile)) {
                    parsedMembers.push({
                        memberId,
                        name: name || memberId,
                        mobile,
                        email
                    });
                }
            } catch (err) {
                // Continue parsing other rows
            }
        }

        return parsedMembers;
    }

    /**
     * 🔄 Executes Full Synchronization and bulk upserts into Postgres
     */
    async syncMembers() {
        if (this.isSyncing) {
            return { success: false, message: 'Sync already in progress.', isSyncing: true };
        }

        this.isSyncing = true;
        const startTime = Date.now();

        try {
            console.log('🔄 [Customer Sync Bot] Fetching member directory from https://aviraglobal.in/AVGControl/members?size=all...');
            const html = await this.fetchMembersHtml();
            const members = this.parseMembersHtml(html);

            console.log(`📦 [Customer Sync Bot] Parsed ${members.length} members. Upserting into PostgreSQL database...`);

            if (members.length === 0) {
                throw new Error('No members found in remote response.');
            }

            // Batch upsert to database in chunks of 250
            const batchSize = 250;
            let totalUpserted = 0;

            for (let i = 0; i < members.length; i += batchSize) {
                const chunk = members.slice(i, i + batchSize);
                
                const values = [];
                const placeholders = [];
                let pIdx = 1;

                for (const m of chunk) {
                    placeholders.push(`($${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++})`);
                    values.push(m.memberId, m.name, m.mobile, m.email);
                }

                const queryText = `
                    INSERT INTO customers (member_id, name, mobile, email)
                    VALUES ${placeholders.join(', ')}
                    ON CONFLICT (member_id) DO UPDATE SET
                        name = EXCLUDED.name,
                        mobile = CASE WHEN EXCLUDED.mobile != '' THEN EXCLUDED.mobile ELSE customers.mobile END,
                        email = CASE WHEN EXCLUDED.email != '' THEN EXCLUDED.email ELSE customers.email END,
                        updated_at = CURRENT_TIMESTAMP
                `;

                await pool.query(queryText, values);
                totalUpserted += chunk.length;
            }

            const countRes = await pool.query('SELECT COUNT(*) FROM customers');
            const totalInDb = parseInt(countRes.rows[0].count, 10);

            const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`✅ [Customer Sync Bot] Synced ${totalUpserted} members in ${durationSec}s. Total in DB: ${totalInDb}`);

            this.lastSyncStatus = {
                lastRun: new Date().toISOString(),
                success: true,
                totalMembersInDb: totalInDb,
                syncedCount: totalUpserted,
                message: `Successfully synchronized ${totalUpserted} members (${durationSec}s)`,
                error: null
            };

            return {
                success: true,
                syncedCount: totalUpserted,
                totalMembersInDb: totalInDb,
                duration: `${durationSec}s`
            };

        } catch (err) {
            console.error('❌ [Customer Sync Bot] Sync Error:', err.message);
            this.lastSyncStatus = {
                lastRun: new Date().toISOString(),
                success: false,
                totalMembersInDb: 0,
                syncedCount: 0,
                message: 'Failed to sync members',
                error: err.message
            };
            throw err;
        } finally {
            this.isSyncing = false;
        }
    }
}

const customerSyncBot = new CustomerSyncBot();
module.exports = customerSyncBot;
