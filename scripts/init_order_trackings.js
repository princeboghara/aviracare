const db = require('../db');

async function initOrderTrackings() {
    console.log('📦 Initializing order_trackings table...');

    await db.query(`
        CREATE TABLE IF NOT EXISTS order_trackings (
            order_no VARCHAR(100) PRIMARY KEY,
            tracking_no VARCHAR(100) NOT NULL DEFAULT '',
            member_id VARCHAR(100),
            delivery_status VARCHAR(50) DEFAULT 'Pending',
            destination VARCHAR(100),
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_order_trackings_tracking ON order_trackings (tracking_no);
        CREATE INDEX IF NOT EXISTS idx_order_trackings_member ON order_trackings (member_id);
    `);

    // Populate from orders_master
    await db.query(`
        INSERT INTO order_trackings (order_no, tracking_no, member_id, updated_at)
        SELECT order_no, tracking_no, member_id, NOW()
        FROM orders_master
        WHERE order_no IS NOT NULL AND tracking_no IS NOT NULL AND TRIM(tracking_no) != ''
        ON CONFLICT (order_no) DO UPDATE
        SET tracking_no = EXCLUDED.tracking_no, member_id = EXCLUDED.member_id, updated_at = NOW();
    `);

    // Populate from consignment_parcels
    await db.query(`
        INSERT INTO order_trackings (order_no, tracking_no, member_id, updated_at)
        SELECT order_no, tracking, member_id, NOW()
        FROM consignment_parcels
        WHERE order_no IS NOT NULL AND tracking IS NOT NULL AND TRIM(tracking) != ''
        ON CONFLICT (order_no) DO UPDATE
        SET tracking_no = EXCLUDED.tracking_no, member_id = EXCLUDED.member_id, updated_at = NOW();
    `);

    // Populate from main_database
    await db.query(`
        INSERT INTO order_trackings (order_no, tracking_no, member_id, updated_at)
        SELECT order_no, tracking, member_id, NOW()
        FROM main_database
        WHERE order_no IS NOT NULL AND tracking IS NOT NULL AND TRIM(tracking) != ''
        ON CONFLICT (order_no) DO UPDATE
        SET tracking_no = EXCLUDED.tracking_no, member_id = EXCLUDED.member_id, updated_at = NOW();
    `);

    const countRes = await db.query('SELECT count(*) FROM order_trackings');
    console.log(`✅ order_trackings table ready! Total preserved tracking rows: ${countRes.rows[0].count}`);

    const sample = await db.query('SELECT * FROM order_trackings ORDER BY updated_at DESC LIMIT 10');
    console.log('Sample rows:', sample.rows);
}

if (require.main === module) {
    initOrderTrackings()
        .then(() => process.exit(0))
        .catch(err => {
            console.error('❌ Error initializing order_trackings:', err);
            process.exit(1);
        });
}

module.exports = { initOrderTrackings };
