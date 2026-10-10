const { pool } = require('../db');

async function test() {
    const pe = await pool.query('SELECT id, member_id, name, order_date, pv, amount FROM pending_entries ORDER BY id ASC');
    console.log(`Remaining in pending: ${pe.rows.length}`);

    const memIds = pe.rows.map(r => r.member_id).filter(Boolean);
    const prev = await pool.query('SELECT member_id, name, tracking, order_date FROM main_database WHERE member_id = ANY($1::text[])', [memIds]);
    console.log(`Found ${prev.rows.length} previous records in main_database for these members.`);
    console.table(prev.rows.slice(0, 20));

    await pool.end();
}

test().catch(console.error);
