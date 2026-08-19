const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function backupDatabase() {
    console.log('📦 Starting Full Database Backup...');
    const client = await pool.connect();
    try {
        const tablesRes = await client.query(`
            SELECT tablename 
            FROM pg_tables 
            WHERE schemaname = 'public'
            ORDER BY tablename;
        `);

        const tables = tablesRes.rows.map(r => r.tablename);
        console.log(`📋 Found ${tables.length} tables:`, tables);

        const fullBackup = {
            timestamp: new Date().toISOString(),
            tables: {}
        };

        let sqlDump = `-- AviraCare Database Backup\n-- Generated on: ${new Date().toISOString()}\n\n`;

        for (const table of tables) {
            // 1. Get columns definition
            const colRes = await client.query(`
                SELECT column_name, data_type, is_nullable, column_default
                FROM information_schema.columns 
                WHERE table_schema = 'public' AND table_name = $1
                ORDER BY ordinal_position;
            `, [table]);

            // 2. Get table rows
            const dataRes = await client.query(`SELECT * FROM "${table}"`);
            
            fullBackup.tables[table] = {
                columns: colRes.rows,
                rowCount: dataRes.rowCount,
                rows: dataRes.rows
            };

            console.log(`  ✅ Table '${table}': ${dataRes.rowCount} rows exported`);

            // Generate SQL statements
            sqlDump += `-- Table: ${table} (${dataRes.rowCount} rows)\n`;
            for (const row of dataRes.rows) {
                const keys = Object.keys(row);
                if (keys.length === 0) continue;
                const cols = keys.map(k => `"${k}"`).join(', ');
                const vals = keys.map(k => {
                    const v = row[k];
                    if (v === null || v === undefined) return 'NULL';
                    if (typeof v === 'number' || typeof v === 'boolean') return v;
                    if (v instanceof Date) return `'${v.toISOString()}'`;
                    if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
                    return `'${String(v).replace(/'/g, "''")}'`;
                }).join(', ');
                sqlDump += `INSERT INTO "${table}" (${cols}) VALUES (${vals}) ON CONFLICT DO NOTHING;\n`;
            }
            sqlDump += `\n`;
        }

        const backupDir = path.join(__dirname, '..', 'backups');
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }

        const jsonFile = path.join(backupDir, `backup_${Date.now()}.json`);
        const sqlFile = path.join(backupDir, `backup_data.sql`);

        fs.writeFileSync(jsonFile, JSON.stringify(fullBackup, null, 2), 'utf-8');
        fs.writeFileSync(sqlFile, sqlDump, 'utf-8');

        console.log('\n🎉 Backup Complete Successfully!');
        console.log(`📁 JSON Backup: ${jsonFile}`);
        console.log(`📁 SQL Data: ${sqlFile}`);

    } catch (err) {
        console.error('❌ Backup failed:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

backupDatabase();
