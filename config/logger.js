/**
 * 📜 AviraCare Unified High-Performance Log Monitor
 * Tracks:
 * 1. system - Core software, server boot, database, and API activities.
 * 2. whatsapp_crm - WhatsApp CRM Chatbot tracking queries & member lookups.
 * 3. aviraglobal - AviraGlobal order sync bot background operations & imports.
 */

const db = require('../db');
const pool = db.pool || db;

class Logger {
    constructor() {
        this.maxMemoryLogsPerCategory = 500;
        this.logs = {
            system: [],
            whatsapp_crm: [],
            aviraglobal: []
        };
        this.tableInitialized = false;

        // Auto initialize database table asynchronously
        this.initDbTable().catch(e => console.warn('Logger DB notice:', e.message));

        // Initial system log
        this.system('INFO', 'System Logger Engine initialized with high-performance in-memory ring-buffer.');
    }

    async initDbTable() {
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS system_logs (
                    id BIGSERIAL PRIMARY KEY,
                    category VARCHAR(50) NOT NULL,
                    level VARCHAR(20) NOT NULL,
                    message TEXT NOT NULL,
                    meta JSONB DEFAULT '{}'::jsonb,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_system_logs_cat_id ON system_logs (category, id DESC);
                CREATE INDEX IF NOT EXISTS idx_system_logs_created ON system_logs (created_at DESC);
            `);
            this.tableInitialized = true;

            // Load last 100 logs per category into memory ring-buffer
            for (const cat of ['system', 'whatsapp_crm', 'aviraglobal']) {
                const res = await pool.query(
                    'SELECT id, category, level, message, meta, created_at FROM system_logs WHERE category = $1 ORDER BY id DESC LIMIT 100',
                    [cat]
                ).catch(() => ({ rows: [] }));

                if (res.rows.length > 0) {
                    this.logs[cat] = res.rows.map(r => ({
                        id: r.id.toString(),
                        category: r.category,
                        level: r.level,
                        message: r.message,
                        meta: r.meta || {},
                        timestamp: new Date(r.created_at).toISOString()
                    }));
                }
            }
        } catch (err) {
            console.warn('⚠️ Logger table initialization warning:', err.message);
        }
    }

    log(category, level, message, meta = {}) {
        const cat = this.logs[category] ? category : 'system';
        const entry = {
            id: Date.now() + '-' + Math.floor(Math.random() * 1000),
            category: cat,
            level: (level || 'INFO').toUpperCase(),
            message: String(message),
            meta: typeof meta === 'object' && meta !== null ? meta : { detail: String(meta) },
            timestamp: new Date().toISOString()
        };

        // Prepend to in-memory list (latest first)
        this.logs[cat].unshift(entry);
        if (this.logs[cat].length > this.maxMemoryLogsPerCategory) {
            this.logs[cat].pop();
        }

        // Asynchronously persist to database (non-blocking)
        if (this.tableInitialized) {
            pool.query(
                'INSERT INTO system_logs (category, level, message, meta, created_at) VALUES ($1, $2, $3, $4, NOW())',
                [cat, entry.level, entry.message, JSON.stringify(entry.meta)]
            ).catch(err => {
                // quiet fail to prevent crashing
            });
        }

        return entry;
    }

    system(level, message, meta = {}) {
        return this.log('system', level, message, meta);
    }

    whatsapp(level, message, meta = {}) {
        return this.log('whatsapp_crm', level, message, meta);
    }

    aviraglobal(level, message, meta = {}) {
        return this.log('aviraglobal', level, message, meta);
    }

    getLogs(category = 'system', filter = {}) {
        const cat = this.logs[category] ? category : 'system';
        let list = [...this.logs[cat]];

        const { level, search, limit = 100 } = filter;

        if (level && level !== 'ALL') {
            list = list.filter(l => l.level === level.toUpperCase());
        }

        if (search) {
            const q = search.toLowerCase().trim();
            list = list.filter(l => {
                const msg = l.message.toLowerCase();
                const metaStr = JSON.stringify(l.meta).toLowerCase();
                return msg.includes(q) || metaStr.includes(q);
            });
        }

        return list.slice(0, Math.min(parseInt(limit, 10) || 100, 500));
    }

    getStats() {
        const stats = {};
        for (const cat of ['system', 'whatsapp_crm', 'aviraglobal']) {
            const list = this.logs[cat] || [];
            stats[cat] = {
                total: list.length,
                errors: list.filter(l => l.level === 'ERROR').length,
                warnings: list.filter(l => l.level === 'WARN').length,
                success: list.filter(l => l.level === 'SUCCESS').length,
                lastEntry: list[0] ? list[0].timestamp : null
            };
        }
        return stats;
    }

    async clearLogs(category) {
        const cat = this.logs[category] ? category : 'system';
        this.logs[cat] = [];
        if (this.tableInitialized) {
            await pool.query('DELETE FROM system_logs WHERE category = $1', [cat]).catch(() => {});
        }
        this.log(cat, 'INFO', `Audit logs cleared for category [${cat}].`);
        return { success: true, category: cat };
    }
}

module.exports = new Logger();
