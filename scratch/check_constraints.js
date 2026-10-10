const { pool } = require('../db');

async function check() {
    const res = await pool.query(`
        SELECT tc.constraint_name, tc.constraint_type 
        FROM information_schema.table_constraints tc 
        WHERE tc.table_name = 'main_database'
    `);
    console.log('Constraints on main_database:', res.rows);
    await pool.end();
}

check().catch(console.error);
