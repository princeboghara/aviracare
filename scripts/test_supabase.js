const { Pool } = require('pg');

const connStr = 'postgresql://postgres.knvfduvclncjrtqvafss:R3wf%2FhdRGHFD-xD@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres';

async function testSessionPort() {
    const pool = new Pool({
        connectionString: connStr,
        ssl: { rejectUnauthorized: false }
    });
    try {
        const res = await pool.query('SELECT NOW(), current_database(), current_user;');
        console.log('✅ Port 5432 Session Pooler Works:', res.rows[0]);
    } catch (e) {
        console.log('❌ Port 5432 failed:', e.message);
    } finally {
        await pool.end();
    }
}

testSessionPort();
