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

module.exports = { 
    pool,
    query: (text, params) => pool.query(text, params),
    initIndexes
};