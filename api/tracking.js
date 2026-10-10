const db = require('../db');

module.exports = async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const rawId = req.query.id || req.query.track || req.query.trackingid || req.body?.track || req.body?.trackingid || req.body?.id || '';
        const cleanRaw = String(rawId).replace(/[\s\-_]/g, '').trim().toUpperCase();

        if (!cleanRaw) {
            return res.status(400).json({ error: 'Please provide a valid Member ID or Tracking Number' });
        }

        // Generate smart search variants (e.g. 726340, AV726340)
        let withAv = cleanRaw;
        let withoutAv = cleanRaw;
        if (cleanRaw.startsWith('AV')) {
            withoutAv = cleanRaw.substring(2);
        } else if (/^\d+$/.test(cleanRaw)) {
            withAv = 'AV' + cleanRaw;
        }

        const querySql = `
            SELECT m.sr_no, m.member_id, m.name, m.order_date, m.pv, m.amount, m.tracking,
                   c.mobile, c.city, c.state, c.pincode
            FROM main_database m
            LEFT JOIN consignment_parcels c ON (m.tracking IS NOT NULL AND m.tracking != '' AND m.tracking = c.tracking)
            WHERE UPPER(TRIM(m.member_id)) IN ($1, $2)
               OR UPPER(TRIM(m.tracking)) IN ($1, $2)
               OR (c.mobile IS NOT NULL AND TRIM(c.mobile) IN ($1, $2))
            ORDER BY m.sr_no DESC
        `;

        const result = await db.query(querySql, [withAv, withoutAv]);

        if (!result.rows || result.rows.length === 0) {
            return res.status(404).json({ error: 'No tracking data found for this member' });
        }

        const first = result.rows[0];
        const memberName = first.name || 'Valued Member';

        // Deduplicate and group unique parcels (by tracking and order_date)
        const uniqueOrders = [];
        const seen = new Set();
        for (const row of result.rows) {
            const tr = (row.tracking || '').trim().toUpperCase();
            const od = (row.order_date || '').trim();
            const key = `${tr}_${od}`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueOrders.push({
                    order_date: od || 'Recent',
                    tracking: tr || 'Pending Dispatch',
                    city: row.city || '',
                    state: row.state || '',
                    mobile: row.mobile || '',
                    tracking_url: tr && tr !== 'Pending Dispatch' ? 'https://www.indiapost.gov.in/_layouts/15/dpt.cept.tracking/trackconsignment.aspx' : ''
                });
            }
        }

        const latestOrder = uniqueOrders[0];
        const trackingNo = latestOrder.tracking;
        const allTrackingsStr = uniqueOrders.map(o => o.tracking).join(', ');

        // Format parcel list text
        let parcelDetailsText = '';
        let readyMsg = '';
        const indiapostUrl = 'https://www.indiapost.gov.in/_layouts/15/dpt.cept.tracking/trackconsignment.aspx';

        const pvVal = first.pv || '0';
        const amountVal = first.amount || '0';

        if (uniqueOrders.length === 1) {
            parcelDetailsText = `🚚 Tracking Number (Tap to Copy):\n\`${latestOrder.tracking}\`\n📅 Order Date: ${latestOrder.order_date}`;
            readyMsg = `Hello ${memberName},\n\nYour Parcel has been dispatched Successfully! 📦\n\n🆔 Member ID: ${first.member_id}\n💎 PV: ${pvVal}\n💰 Amount: ₹${amountVal}\n\n${parcelDetailsText}\n\nYou can track your parcel using the India Post tracking portal:\n${indiapostUrl}\n\nIf you need any assistance, Please feel free to contact us.\nThank you,\n\n*AviraCare Team*`;
        } else {
            parcelDetailsText = uniqueOrders.map((o, idx) => {
                return `📦 Parcel ${idx + 1} (Tap to Copy):\n🚚 \`${o.tracking}\`\n📅 Date: ${o.order_date}`;
            }).join('\n\n');

            readyMsg = `Hello ${memberName},\n\nWe found ${uniqueOrders.length} parcels for your account: 📦\n\n🆔 Member ID: ${first.member_id}\n💎 PV: ${pvVal}\n💰 Amount: ₹${amountVal}\n\n${parcelDetailsText}\n\nYou can track your parcels using the India Post tracking portal:\n${indiapostUrl}\n\nIf you need any assistance, Please feel free to contact us.\nThank you,\n\n*AviraCare Team*`;
        }

        return res.json({
            success: true,
            count: uniqueOrders.length,
            tracking: trackingNo,
            consignmentid: trackingNo,
            all_trackings: allTrackingsStr,
            parcel_info: parcelDetailsText,
            name: memberName,
            member_id: first.member_id,
            pv: pvVal,
            amount: amountVal,
            reply_text: readyMsg,
            message: readyMsg,
            data: {
                count: uniqueOrders.length,
                member_id: first.member_id,
                name: memberName,
                pv: pvVal,
                amount: amountVal,
                tracking: trackingNo,
                consignmentid: trackingNo,
                all_trackings: allTrackingsStr,
                parcel_info: parcelDetailsText,
                order_date: latestOrder.order_date,
                city: latestOrder.city || '',
                state: latestOrder.state || '',
                tracking_url: indiapostUrl,
                orders: uniqueOrders
            }
        });
    } catch (err) {
        console.error('Tracking API error:', err);
        return res.status(500).json({ error: 'Server error: ' + err.message });
    }
};
