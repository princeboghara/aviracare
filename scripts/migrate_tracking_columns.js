const db = require('../db');

async function migrate() {
    try {
        console.log('🔄 Checking and adding tracking columns to main_database...');
        await db.query(`
            ALTER TABLE main_database 
            ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(100) DEFAULT 'Pending',
            ADD COLUMN IF NOT EXISTS destination VARCHAR(255),
            ADD COLUMN IF NOT EXISTS booked_date VARCHAR(100),
            ADD COLUMN IF NOT EXISTS delivery_date VARCHAR(100),
            ADD COLUMN IF NOT EXISTS last_sync_time TIMESTAMP;
        `);
        console.log('✅ Columns added or verified successfully');

        await db.query(`
            CREATE INDEX IF NOT EXISTS idx_main_db_tracking ON main_database(tracking);
            CREATE INDEX IF NOT EXISTS idx_main_db_delivery_status ON main_database(delivery_status);
        `);
        console.log('✅ Indexes verified successfully');
        process.exit(0);
    } catch (err) {
        console.error('❌ Migration failed:', err.message);
        process.exit(1);
    }
}

migrate();
