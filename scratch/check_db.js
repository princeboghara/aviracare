const { pool } = require('../db.js');

async function check() {
    try {
        const pCols = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'pending_entries'");
        console.log('pending_entries columns:', pCols.rows.map(r => r.column_name));
        
        const cCols = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'consignments'");
        console.log('consignments columns:', cCols.rows.map(r => r.column_name));
        
        const pendingCount = await pool.query('SELECT COUNT(*) FROM pending_entries');
        console.log('Total pending entries:', pendingCount.rows[0].count);
        
        const samplePending = await pool.query('SELECT * FROM pending_entries LIMIT 5');
        console.log('Sample pending entries:', samplePending.rows);

        const nullConsignmentCount = await pool.query('SELECT COUNT(*) FROM pending_entries WHERE consignment_id IS NULL');
        console.log('Pending with null consignment_id:', nullConsignmentCount.rows[0].count);
        
        const consignments = await pool.query('SELECT * FROM consignments');
        console.log('Existing consignments count:', consignments.rows.length);
        console.log('Existing consignments:', consignments.rows);
    } catch(err) {
        console.error(err);
    } finally {
        pool.end();
    }
}
check();
