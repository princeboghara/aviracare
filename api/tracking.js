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
        const orders = result.rows.map(row => ({
            order_date: row.order_date || '',
            tracking: row.tracking || 'Pending Dispatch',
            city: row.city || '',
            state: row.state || '',
            mobile: row.mobile || '',
            tracking_url: row.tracking ? 'https://www.indiapost.gov.in/_layouts/15/dpt.cept.tracking/trackconsignment.aspx' : ''
        }));

        const trackingNo = first.tracking || 'Pending Dispatch';
        const memberName = first.name || 'Valued Member';
        const orderDateStr = first.order_date || '';
        const indiapostUrl = trackingNo && trackingNo !== 'Pending Dispatch'
            ? 'https://www.indiapost.gov.in/_layouts/15/dpt.cept.tracking/trackconsignment.aspx'
            : 'https://www.indiapost.gov.in/';

        const readyMsg = `Hello ${memberName},\n\nYour order dispatch details:\n📦 Member ID: ${first.member_id}\n🚚 Tracking Number: ${trackingNo}\n📅 Order Date: ${orderDateStr}\n\nTrack your parcel on India Post:\n${indiapostUrl}`;

        return res.json({
            success: true,
            tracking: trackingNo,
            consignmentid: trackingNo,
            name: memberName,
            member_id: first.member_id,
            reply_text: readyMsg,
            message: readyMsg,
            data: {
                member_id: first.member_id,
                name: memberName,
                tracking: trackingNo,
                consignmentid: trackingNo,
                order_date: orderDateStr,
                city: first.city || '',
                state: first.state || '',
                tracking_url: indiapostUrl,
                orders: orders
            }
        });
    } catch (err) {
        console.error('Tracking API error:', err);
        return res.status(500).json({ error: 'Server error: ' + err.message });
    }
};
