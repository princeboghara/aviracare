const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: parseInt(process.env.DB_POOL_MAX || '20', 10),
    min: 1,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 30000,
    keepAlive: true
});

// 🛡️ Prevent crashes on unexpected idle connection loss
pool.on('error', (err) => {
    console.error('⚠️ PostgreSQL Pool Unexpected Client Error:', err.message);
});

pool.connect((err, client, release) => {
    if (err) return console.error('❌ PostgreSQL કનેક્શનમાં ભૂલ છે:', err.stack);
    console.log('✅ PostgreSQL Connected (Pool Active)');
    release();
});

// ⚡ Automatic Index Initialization for Lightning Fast Performance Under Load
async function initIndexes() {
    const indexes = [
        `CREATE INDEX IF NOT EXISTS idx_main_db_member_id_upper ON main_database ((UPPER(member_id)));`,
        `CREATE INDEX IF NOT EXISTS idx_main_db_name_upper ON main_database ((UPPER(name)));`,
        `CREATE INDEX IF NOT EXISTS idx_main_db_tracking ON main_database ((UPPER(tracking)));`,
        `CREATE INDEX IF NOT EXISTS idx_main_db_sr_no ON main_database (sr_no DESC);`,
        `CREATE INDEX IF NOT EXISTS idx_pending_entries_tracking_upper ON pending_entries ((UPPER(tracking)));`,
        `CREATE INDEX IF NOT EXISTS idx_orders_master_member_id ON orders_master ((UPPER(member_id)));`,
        `CREATE INDEX IF NOT EXISTS idx_orders_master_name ON orders_master (name);`,
        `CREATE INDEX IF NOT EXISTS idx_query_tickets_member_id ON query_tickets ((UPPER(member_id)));`,
        `CREATE INDEX IF NOT EXISTS idx_query_tickets_status ON query_tickets (status);`,
        `CREATE INDEX IF NOT EXISTS idx_content_pdf_category ON content_pdf (category);`,
        `CREATE INDEX IF NOT EXISTS idx_pincodes_pincode ON pincodes (pincode);`
    ];

    try {
        for (const sql of indexes) {
            await pool.query(sql);
        }
        console.log('🚀 Database Indexes Verified & Optimized Successfully!');
    } catch (err) {
        console.warn('⚠️ Database indexing notice:', err.message);
    }
}

// ℹ️ Helper to get active database provider details
function getDbInfo() {
    try {
        const urlStr = process.env.DATABASE_URL || '';
        const url = new URL(urlStr);
        let provider = 'PostgreSQL';
        let badgeBg = 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
        let dotColor = 'bg-emerald-500';
        let icon = 'fa-solid fa-bolt text-emerald-500';
        let label = 'Supabase Cloud (PostgreSQL)';

        if (url.host.includes('supabase')) {
            provider = 'Supabase PostgreSQL';
            label = 'Supabase Cloud (PostgreSQL)';
            badgeBg = 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
            dotColor = 'bg-emerald-500';
            icon = 'fa-solid fa-bolt text-emerald-500';
        } else if (url.host.includes('neon.tech')) {
            provider = 'Neon PostgreSQL';
            label = 'Neon Tech (PostgreSQL)';
            badgeBg = 'bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800';
            dotColor = 'bg-sky-500';
            icon = 'fa-solid fa-cube text-sky-500';
        } else if (url.host.includes('localhost') || url.host.includes('127.0.0.1')) {
            provider = 'Localhost PostgreSQL';
            label = 'Local Machine (PostgreSQL)';
            badgeBg = 'bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800';
            dotColor = 'bg-purple-500';
            icon = 'fa-solid fa-laptop-code text-purple-500';
        } else if (url.host.includes('aiven')) {
            provider = 'Aiven PostgreSQL';
            label = 'Aiven Cloud (PostgreSQL)';
            badgeBg = 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800';
            dotColor = 'bg-amber-500';
            icon = 'fa-solid fa-cloud text-amber-500';
        }

        let hostClean = url.hostname;
        if (url.username && url.username.includes('.')) {
            hostClean = `${url.hostname} (${url.username.split('.')[1] || url.username})`;
        }

        return {
            provider,
            label,
            host: hostClean,
            rawHost: url.hostname,
            database: url.pathname.replace('/', '') || 'postgres',
            port: url.port || '5432',
            badgeBg,
            dotColor,
            icon,
            status: 'Connected (Live)'
        };
    } catch (e) {
        return {
            provider: 'PostgreSQL',
            label: 'PostgreSQL Database',
            host: 'Live Database',
            rawHost: 'postgres',
            database: 'postgres',
            port: '5432',
            badgeBg: 'bg-emerald-50 text-emerald-700 border-emerald-200',
            dotColor: 'bg-emerald-500',
            icon: 'fa-solid fa-database text-emerald-500',
            status: 'Connected (Live)'
        };
    }
}

module.exports = { 
    pool,
    query: (text, params) => pool.query(text, params),
    initIndexes,
    getDbInfo
};