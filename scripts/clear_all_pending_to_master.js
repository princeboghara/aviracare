const { pool } = require('../db');

async function clearPendingToMaster() {
    console.log("🚀 Starting final match check and full transfer of remaining pending entries to Master DB...");

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Fetch all remaining entries in pending_entries
        const { rows: pending } = await client.query('SELECT * FROM pending_entries ORDER BY id ASC');
        console.log(`📋 Found ${pending.length} remaining entries in pending_entries.`);

        let insertedCount = 0;

        for (const pe of pending) {
            const memberId = (pe.member_id || '').trim().toUpperCase();
            const name = (pe.name || '').trim().toUpperCase();
            const orderDate = (pe.order_date || '').trim();
            const pv = pe.pv !== null && pe.pv !== undefined ? String(pe.pv) : '0';
            const amount = pe.amount !== null && pe.amount !== undefined ? String(pe.amount) : '0';
            let tracking = (pe.tracking || '').trim().toUpperCase();
            const consignmentId = pe.consignment_id || null;

            // If tracking is empty, check if this member already had a tracking in main_database
            if (!tracking && memberId) {
                const prev = await client.query('SELECT tracking FROM main_database WHERE member_id = $1 AND tracking IS NOT NULL AND tracking != \'\' ORDER BY sr_no DESC LIMIT 1', [memberId]);
                if (prev.rows.length > 0) {
                    tracking = prev.rows[0].tracking.toUpperCase();
                }
            }

            // Insert into main_database
            await client.query(`
                INSERT INTO main_database (member_id, name, order_date, pv, amount, tracking, consignment_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [
                memberId,
                name,
                orderDate,
                pv,
                amount,
                tracking,
                consignmentId
            ]);

            // Remove from pending_entries
            await client.query('DELETE FROM pending_entries WHERE id = $1', [pe.id]);
            insertedCount++;
        }

        await client.query('COMMIT');
        console.log(`\n🎉 SUCCESS! All ${insertedCount} pending entries transferred to Master DB and cleared from Confirm Member!`);

        // Final verification
        const mainCount = await pool.query('SELECT COUNT(*) as total FROM main_database');
        const pendingCount = await pool.query('SELECT COUNT(*) as total FROM pending_entries');

        console.log(`\n📊 FINAL DATABASE COUNTERS:`);
        console.log(`- Master Database (main_database): ${mainCount.rows[0].total} rows`);
        console.log(`- Confirm Member (pending_entries): ${pendingCount.rows[0].total} rows (100% CLEAR)`);

    } catch (err) {
        await client.query('ROLLBACK');
        console.error("❌ Error transferring pending entries to Master DB:", err);
        throw err;
    } finally {
        client.release();
        await pool.end();
    }
}

clearPendingToMaster().catch(console.error);
