const { Pool } = require('pg');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

async function dumpSchema() {
    const pool = new Pool({ 
        connectionString: process.env.DATABASE_URL, 
        ssl: { rejectUnauthorized: false } 
    });
    const client = await pool.connect();
    try {
        const tablesRes = await client.query(`
            SELECT tablename 
            FROM pg_tables 
            WHERE schemaname = 'public'
            ORDER BY tablename;
        `);
        const tables = tablesRes.rows.map(r => r.tablename);

        let ddl = `-- AviraCare Database Schema DDL\n-- Generated on: ${new Date().toISOString()}\n\n`;

        for (const t of tables) {
            const cols = await client.query(`
                SELECT column_name, data_type, udt_name, character_maximum_length, is_nullable, column_default
                FROM information_schema.columns
                WHERE table_name = $1 AND table_schema = 'public'
                ORDER BY ordinal_position;
            `, [t]);

            let colDefs = cols.rows.map(c => {
                let type = c.udt_name.toUpperCase();
                if (type === 'VARCHAR' && c.character_maximum_length) {
                    type = `VARCHAR(${c.character_maximum_length})`;
                } else if (type === 'INT4') {
                    type = 'INTEGER';
                } else if (type === 'INT8') {
                    type = 'BIGINT';
                } else if (type === 'INT2') {
                    type = 'SMALLINT';
                } else if (type === 'FLOAT8') {
                    type = 'DOUBLE PRECISION';
                } else if (type === 'BOOL') {
                    type = 'BOOLEAN';
                } else if (type === 'JSONB' || type === 'JSON') {
                    type = 'JSONB';
                }

                // If column has sequence default like nextval(...)
                if (c.column_default && c.column_default.includes('nextval')) {
                    if (type === 'INTEGER') type = 'SERIAL';
                    else if (type === 'BIGINT') type = 'BIGSERIAL';
                }

                let str = `  "${c.column_name}" ${type}`;
                if (c.column_default && !c.column_default.includes('nextval')) {
                    str += ` DEFAULT ${c.column_default}`;
                }
                if (c.is_nullable === 'NO' && !type.includes('SERIAL')) {
                    str += ' NOT NULL';
                }
                return str;
            }).join(',\n');

            ddl += `CREATE TABLE IF NOT EXISTS "${t}" (\n${colDefs}\n);\n\n`;
        }

        const backupDir = path.join(__dirname, '..', 'backups');
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }

        fs.writeFileSync(path.join(backupDir, 'schema.sql'), ddl, 'utf-8');
        console.log('✅ Schema exported to backups/schema.sql');
    } catch (err) {
        console.error('❌ Schema export error:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

dumpSchema();
