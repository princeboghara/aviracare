const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

async function restoreDatabase() {
    console.log('🚀 Starting Complete Database Restore to Supabase...');
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    const client = await pool.connect();
    try {
        const schemaPath = path.join(__dirname, '..', 'backups', 'schema.sql');
        const dataPath = path.join(__dirname, '..', 'backups', 'backup_data.sql');

        if (!fs.existsSync(schemaPath) || !fs.existsSync(dataPath)) {
            throw new Error('Backup files not found in /backups folder.');
        }

        // 1. Create Tables
        console.log('1️⃣ Creating tables & schema in Supabase...');
        const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
        await client.query(schemaSql);
        console.log('   ✅ Tables created successfully!');

        // 2. Import Data
        console.log('2️⃣ Importing all data rows...');
        const dataSql = fs.readFileSync(dataPath, 'utf-8');
        await client.query(dataSql);
        console.log('   ✅ All data rows imported successfully!');

        // 3. Reset Sequences for auto-increment IDs
        console.log('3️⃣ Updating sequence values...');
        const tablesWithSerial = [
            { table: 'main_database', col: 'sr_no' },
            { table: 'orders_master', col: 'id' },
            { table: 'pending_entries', col: 'id' },
            { table: 'pincodes', col: 'id' },
            { table: 'query_tickets', col: 'id' },
            { table: 'bill_history', col: 'id' },
            { table: 'box_presets', col: 'id' },
            { table: 'combo_presets', col: 'id' },
            { table: 'avira_products', col: 'id' }
        ];

        for (const item of tablesWithSerial) {
            try {
                await client.query(`
                    SELECT setval(
                        pg_get_serial_sequence('${item.table}', '${item.col}'), 
                        COALESCE((SELECT MAX("${item.col}") FROM "${item.table}"), 1)
                    );
                `);
            } catch (seqErr) {
                // ignore if table empty or no sequence
            }
        }
        console.log('   ✅ Sequences updated!');

        // 4. Create Indexes
        console.log('4️⃣ Creating performance indexes...');
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
        for (const idx of indexes) {
            await client.query(idx);
        }
        console.log('   ✅ Indexes verified and built!');

        // 5. Verification summary
        console.log('\n📊 VERIFICATION SUMMARY:');
        const checkRes = await client.query(`
            SELECT tablename 
            FROM pg_tables 
            WHERE schemaname = 'public' 
            ORDER BY tablename;
        `);

        for (const row of checkRes.rows) {
            const countRes = await client.query(`SELECT COUNT(*) FROM "${row.tablename}"`);
            console.log(`   📌 ${row.tablename.padEnd(20)} : ${countRes.rows[0].count} rows`);
        }

        console.log('\n🎉🎉🎉 DATABASE RESTORE COMPLETED 100% TO SUPABASE! 🎉🎉🎉');
    } catch (err) {
        console.error('❌ Restore error:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

restoreDatabase();
