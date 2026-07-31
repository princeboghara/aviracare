const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

pool.connect((err, client, release) => {
    if (err) return console.error('❌ PostgreSQL કનેક્શનમાં ભૂલ છે:', err.stack);
    console.log('✅ PostgreSQL Connected');
    release();
});

module.exports = { query: (text, params) => pool.query(text, params) };