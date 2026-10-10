const { pool } = require('../db');

async function moveMatchedToMaster() {
    console.log("🚀 Starting transfer of matched pending parcels to Master Database (main_database)...");

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Fetch all matched pending entries
        const { rows: matchedEntries } = await client.query(`
            SELECT * FROM pending_entries 
            WHERE consignment_id IS NOT NULL 
              AND tracking IS NOT NULL 
              AND tracking != ''
            ORDER BY id ASC
        `);

        console.log(`📋 Found ${matchedEntries.length} matched pending entries ready for Master DB.`);

        let insertedCount = 0;
        let updatedCount = 0;
        let deletedCount = 0;

        for (const pe of matchedEntries) {
            const memberId = (pe.member_id || '').trim().toUpperCase();
            const name = (pe.name || '').trim().toUpperCase();
            const orderDate = (pe.order_date || '').trim();
            const pv = pe.pv !== null && pe.pv !== undefined ? String(pe.pv) : '0';
            const amount = pe.amount !== null && pe.amount !== undefined ? String(pe.amount) : '0';
            const tracking = pe.tracking.trim().toUpperCase();
            const consignmentId = pe.consignment_id || null;

            // Check if tracking already exists in main_database
            const exist = await client.query('SELECT sr_no FROM main_database WHERE UPPER(tracking) = $1', [tracking]);

            if (exist.rows.length === 0) {
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
                insertedCount++;
            } else {
                await client.query(`
                    UPDATE main_database
                    SET member_id = $1, name = $2, order_date = $3, pv = $4, amount = $5, consignment_id = $6
                    WHERE sr_no = $7
                `, [
                    memberId,
                    name,
                    orderDate,
                    pv,
                    amount,
                    consignmentId,
                    exist.rows[0].sr_no
                ]);
                updatedCount++;
            }

            // Remove from pending_entries
            await client.query('DELETE FROM pending_entries WHERE id = $1', [pe.id]);
            deletedCount++;
        }

        await client.query('COMMIT');

        console.log(`🎉 SUCCESS!`);
        console.log(`- New records inserted into Master DB: ${insertedCount}`);
        console.log(`- Existing records updated in Master DB: ${updatedCount}`);
        console.log(`- Removed from Pending Entries: ${deletedCount}`);

        // Check new totals
        const mainCount = await pool.query('SELECT COUNT(*) as total FROM main_database');
        const pendingCount = await pool.query('SELECT COUNT(*) as total FROM pending_entries');

        console.log(`\n📊 DATABASE STATUS AFTER TRANSFER:`);
        console.log(`- Total records in Master Database (main_database): ${mainCount.rows[0].total}`);
        console.log(`- Total records remaining in Confirm Member (pending_entries): ${pendingCount.rows[0].total}`);

    } catch (err) {
        await client.query('ROLLBACK');
        console.error("❌ Failed to transfer matched entries to Master DB:", err);
        throw err;
    } finally {
        client.release();
        await pool.end();
    }
}

moveMatchedToMaster().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
});
