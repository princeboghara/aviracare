const { pool } = require('../db');

const additionalMatches = [
    {
        pendingId: 1528,
        expectedName: 'CHAMPA SINGH RAJPUT',
        tracking: 'CG245524207IN',
        consignmentId: 9 // CN-14926 (14-9-26 Dispatch)
    },
    {
        pendingId: 1508,
        expectedName: 'ANISHA PATEL',
        tracking: 'CG245524215IN',
        consignmentId: 10 // CN-16926 (16-9-26 Dispatch)
    },
    {
        pendingId: 1506,
        expectedName: 'ANJU PRUTHI',
        tracking: 'CG245524357IN',
        consignmentId: 10 // CN-16926 (16-9-26 Dispatch)
    },
    {
        pendingId: 1524,
        expectedName: 'VIKRAM BHAI MAVJIBHAU ZAPDIYA',
        tracking: 'CG245524493IN',
        consignmentId: 10 // CN-16926 (16-9-26 Dispatch)
    },
    {
        pendingId: 1606,
        expectedName: 'SARASWATIBEN VALLABHBHAI GADARA',
        tracking: 'CG245523759IN',
        consignmentId: 5 // CN-7926 (7-9-26 Dispatch)
    },
    {
        pendingId: 1609,
        expectedName: 'SUHANI DEVASE',
        tracking: 'CG245523657IN',
        consignmentId: 5 // CN-7926 (7-9-26 Dispatch)
    },
    {
        pendingId: 1820,
        expectedName: 'VIBHAVARI PALODKAR',
        tracking: 'CG245525922IN',
        consignmentId: 22 // CN-51026 (5-10-26 Dispatch)
    }
];

async function applyAdditionalMatches() {
    console.log("🚀 Applying additional verified matches to Master DB...");

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        let transferred = 0;
        for (const item of additionalMatches) {
            const peRes = await client.query('SELECT * FROM pending_entries WHERE id = $1', [item.pendingId]);
            if (peRes.rows.length === 0) {
                console.warn(`Pending entry ID ${item.pendingId} already removed or not found.`);
                continue;
            }

            const pe = peRes.rows[0];
            const memberId = (pe.member_id || '').trim().toUpperCase();
            const name = (pe.name || item.expectedName).trim().toUpperCase();
            const orderDate = (pe.order_date || '').trim();
            const pv = pe.pv !== null && pe.pv !== undefined ? String(pe.pv) : '0';
            const amount = pe.amount !== null && pe.amount !== undefined ? String(pe.amount) : '0';
            const tracking = item.tracking.trim().toUpperCase();

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
                item.consignmentId
            ]);

            // Remove from pending_entries
            await client.query('DELETE FROM pending_entries WHERE id = $1', [item.pendingId]);
            transferred++;

            console.log(`✅ Transferred: [${memberId}] ${name} -> Master DB (Tracking: ${tracking}, Consignment ID: ${item.consignmentId})`);
        }

        await client.query('COMMIT');
        console.log(`\n🎉 Successfully transferred ${transferred} additional verified parcels to Master DB!`);

        const mainCount = await pool.query('SELECT COUNT(*) as total FROM main_database');
        const pendingCount = await pool.query('SELECT COUNT(*) as total FROM pending_entries');
        console.log(`- Master DB total: ${mainCount.rows[0].total}`);
        console.log(`- Confirm Member (Pending) total: ${pendingCount.rows[0].total}`);

    } catch (e) {
        await client.query('ROLLBACK');
        console.error("Error applying additional matches:", e);
    } finally {
        client.release();
        await pool.end();
    }
}

applyAdditionalMatches().catch(console.error);
