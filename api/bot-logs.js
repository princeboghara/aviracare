const db = require('../db');
const { getBotLogs } = require('../services/botLogger.service');

module.exports = async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        if (req.method === 'DELETE') {
            await db.query('TRUNCATE TABLE bot_logs');
            return res.json({ success: true, msg: 'All bot logs cleared successfully!' });
        }

        const { limit, since_id, search, status } = req.query;
        const result = await getBotLogs({ limit, since_id, search, status });
        return res.json({ success: true, ...result });
    } catch (err) {
        console.error('Bot Logs API Error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
};
