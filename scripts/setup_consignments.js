const db = require('../db');

async function run() {
    console.log("🔄 Starting Consignment Setup...");

    // 1. Ensure indexes
    try {
        await db.query(`CREATE INDEX IF NOT EXISTS idx_pending_entries_consignment ON pending_entries (consignment_id);`);
        await db.query(`CREATE INDEX IF NOT EXISTS idx_consignments_status ON consignments (status);`);
        await db.query(`CREATE INDEX IF NOT EXISTS idx_consignment_parcels_consignment ON consignment_parcels (consignment_id);`);
        console.log("✅ Indexes ensured.");
    } catch (e) {
        console.warn("Index notice:", e.message);
    }

    // 2. Check pending entries without consignment
    const unassigned = await db.query('SELECT COUNT(*) FROM pending_entries WHERE consignment_id IS NULL');
    const count = parseInt(unassigned.rows[0].count, 10);
    console.log(`📋 Found ${count} unassigned pending entries.`);

    if (count > 0) {
        let cid;
        const check = await db.query('SELECT id FROM consignments WHERE consignment_no = $1', ['CN-18926']);
        if (check.rows.length === 0) {
            const ins = await db.query(`
                INSERT INTO consignments (consignment_no, title, dispatch_date, status, notes)
                VALUES ('CN-18926', '18-9-26 Dispatch', '18 Sept 2026', 'ACTIVE', 'Manual dispatch batch pending member confirmation')
                RETURNING id
            `);
            cid = ins.rows[0].id;
            console.log(`✨ Created consignment CN-18926 with ID: ${cid}`);
        } else {
            cid = check.rows[0].id;
            console.log(`📌 Using existing consignment ID: ${cid}`);
        }

        // Link pending entries
        const upd = await db.query('UPDATE pending_entries SET consignment_id = $1 WHERE consignment_id IS NULL RETURNING id', [cid]);
        console.log(`✅ Updated ${upd.rows.length} pending entries with consignment_id = ${cid}`);

        // Sync into consignment_parcels
        const pendingList = await db.query('SELECT * FROM pending_entries WHERE consignment_id = $1', [cid]);
        let synced = 0;
        for (const p of pendingList.rows) {
            const tr = (p.tracking || '').trim().toUpperCase();
            if (!tr) continue;
            const exist = await db.query('SELECT id FROM consignment_parcels WHERE consignment_id = $1 AND UPPER(tracking) = $2', [cid, tr]);
            if (exist.rows.length === 0) {
                await db.query(`
                    INSERT INTO consignment_parcels (consignment_id, tracking, weight, length, breadth, height, name, mobile, pincode, city, state, address)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                `, [cid, tr, p.weight, p.length, p.breadth, p.height, p.name, p.mobile, p.pincode, p.city, p.state, p.address]);
                synced++;
            }
        }
        console.log(`📦 Synced ${synced} parcels into consignment_parcels history table.`);
    }

    console.log("🎉 Consignment setup complete!");
    process.exit(0);
}

run().catch(err => {
    console.error("❌ Setup error:", err);
    process.exit(1);
});
