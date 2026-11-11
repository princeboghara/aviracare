const db = require('../db');

/**
 * 📊 Avira Care Executive Dashboard Analytics Service
 * Computes daily dispatch stats (today, yesterday, daily trends),
 * destination state distribution, and consignment summaries.
 */
async function getDashboardAnalytics() {
    try {
        // 1. Fetch Consignments & Parcel Counts grouped by dispatch date
        const consignmentsRes = await db.query(`
            SELECT 
                c.id,
                c.consignment_no,
                c.title,
                c.dispatch_date,
                c.created_at,
                COUNT(cp.id) as parcels_count
            FROM consignments c
            LEFT JOIN consignment_parcels cp ON cp.consignment_id = c.id
            GROUP BY c.id, c.consignment_no, c.title, c.dispatch_date, c.created_at
            ORDER BY c.created_at DESC
        `);

        // 2. Fetch State-Wise Distribution of Dispatched Parcels
        const statesRes = await db.query(`
            SELECT 
                UPPER(TRIM(COALESCE(cp.state, pin.state))) as state_name,
                COUNT(*) as count
            FROM consignment_parcels cp
            LEFT JOIN pincodes pin ON pin.pincode = cp.pincode
            WHERE COALESCE(cp.state, pin.state) IS NOT NULL AND TRIM(COALESCE(cp.state, pin.state)) != ''
            GROUP BY UPPER(TRIM(COALESCE(cp.state, pin.state)))
            ORDER BY count DESC
        `);

        // 3. Fetch Overall Platform Totals
        const totalsRes = await db.query(`
            SELECT 
                (SELECT COUNT(*) FROM consignment_parcels) as total_dispatched,
                (SELECT COUNT(*) FROM consignments) as total_consignments,
                (SELECT COUNT(*) FROM orders_master) as total_orders,
                (SELECT COUNT(*) FROM orders_master WHERE UPPER(tracking_no) LIKE '%SHOP%') as total_shop_pickup
        `);

        // Reference dates for Today and Yesterday in 'DD Mon YYYY' format
        const now = new Date();
        const todayStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        
        const yesterdayDate = new Date(now);
        yesterdayDate.setDate(now.getDate() - 1);
        const yesterdayStr = yesterdayDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

        let todayCount = 0;
        let yesterdayCount = 0;
        const timelineMap = new Map();

        consignmentsRes.rows.forEach(row => {
            const dStr = (row.dispatch_date || '').trim();
            const count = parseInt(row.parcels_count || '0', 10);

            // Compare formatted date string
            if (dStr.toLowerCase() === todayStr.toLowerCase()) {
                todayCount += count;
            } else if (dStr.toLowerCase() === yesterdayStr.toLowerCase()) {
                yesterdayCount += count;
            }

            if (timelineMap.has(dStr)) {
                const existing = timelineMap.get(dStr);
                existing.count += count;
                if (row.consignment_no && !existing.consignments.includes(row.consignment_no)) {
                    existing.consignments.push(row.consignment_no);
                }
            } else {
                timelineMap.set(dStr, {
                    date: dStr,
                    createdDate: row.created_at,
                    count: count,
                    consignments: row.consignment_no ? [row.consignment_no] : []
                });
            }
        });

        // Sort Daily Trend chronologically
        const dailyTrend = Array.from(timelineMap.values()).sort((a, b) => {
            const timeA = new Date(a.date).getTime() || new Date(a.createdDate).getTime() || 0;
            const timeB = new Date(b.date).getTime() || new Date(b.createdDate).getTime() || 0;
            return timeA - timeB;
        });

        const totalDispatched = parseInt(totalsRes.rows[0].total_dispatched || '0', 10);
        const totalConsignments = parseInt(totalsRes.rows[0].total_consignments || '0', 10);
        const totalOrders = parseInt(totalsRes.rows[0].total_orders || '0', 10);
        const totalShopPickup = parseInt(totalsRes.rows[0].total_shop_pickup || '0', 10);

        const stateDistribution = statesRes.rows.map(r => {
            const cnt = parseInt(r.count, 10);
            const pct = totalDispatched > 0 ? ((cnt / totalDispatched) * 100).toFixed(1) : '0';
            return {
                state: r.state_name,
                count: cnt,
                percentage: parseFloat(pct)
            };
        });

        const recentConsignments = consignmentsRes.rows.slice(0, 5).map(c => ({
            id: c.id,
            consignment_no: c.consignment_no,
            title: c.title,
            dispatch_date: c.dispatch_date,
            parcels_count: parseInt(c.parcels_count || '0', 10)
        }));

        return {
            success: true,
            today: {
                dateStr: todayStr,
                count: todayCount
            },
            yesterday: {
                dateStr: yesterdayStr,
                count: yesterdayCount
            },
            totals: {
                totalDispatched,
                totalConsignments,
                totalOrders,
                totalShopPickup,
                totalStates: stateDistribution.length
            },
            dailyTrend,
            stateDistribution,
            recentConsignments
        };
    } catch (err) {
        console.error("Dashboard Analytics Error:", err);
        return {
            success: false,
            error: err.message,
            today: { dateStr: '', count: 0 },
            yesterday: { dateStr: '', count: 0 },
            totals: { totalDispatched: 0, totalConsignments: 0, totalOrders: 0, totalShopPickup: 0, totalStates: 0 },
            dailyTrend: [],
            stateDistribution: [],
            recentConsignments: []
        };
    }
}

module.exports = {
    getDashboardAnalytics
};

