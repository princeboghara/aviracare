const db = require('../db');

// Ensure table exists
let tableEnsured = false;
async function ensureBotLogsTable() {
    if (tableEnsured) return;
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS bot_logs (
                id BIGSERIAL PRIMARY KEY,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                endpoint VARCHAR(100) DEFAULT '/api/tracking',
                method VARCHAR(10) DEFAULT 'GET',
                client_ip VARCHAR(100),
                user_agent TEXT,
                searched_id VARCHAR(100),
                request_params JSONB,
                status_code INTEGER DEFAULT 200,
                success BOOLEAN DEFAULT true,
                member_id VARCHAR(100),
                member_name VARCHAR(255),
                parcels_count INTEGER DEFAULT 0,
                tracking_numbers TEXT,
                reply_message TEXT,
                response_payload JSONB,
                response_time_ms INTEGER DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_bot_logs_created_at ON bot_logs (created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_bot_logs_searched_id ON bot_logs ((UPPER(searched_id)));
        `);
        tableEnsured = true;
    } catch (err) {
        console.warn('⚠️ bot_logs table ensure warning:', err.message);
    }
}

// Log incoming request and outgoing response asynchronously
async function logBotInteraction({
    endpoint = '/api/tracking',
    method = 'GET',
    client_ip = '',
    user_agent = '',
    searched_id = '',
    request_params = {},
    status_code = 200,
    success = true,
    member_id = '',
    member_name = '',
    parcels_count = 0,
    tracking_numbers = '',
    reply_message = '',
    response_payload = null,
    response_time_ms = 0
}) {
    try {
        await ensureBotLogsTable();

        const cleanIp = (client_ip || '').split(',')[0].trim().substring(0, 95);
        const cleanUa = (user_agent || '').substring(0, 500);
        const cleanSearched = (searched_id || '').substring(0, 95);
        const cleanMemberId = (member_id || '').substring(0, 95);
        const cleanMemberName = (member_name || '').substring(0, 250);
        const cleanTracking = (tracking_numbers || '').substring(0, 1000);

        const reqJson = JSON.stringify(request_params || {});
        let resJson = null;
        if (response_payload) {
            try {
                resJson = JSON.stringify(response_payload);
            } catch (e) {
                resJson = null;
            }
        }

        await db.query(`
            INSERT INTO bot_logs (
                endpoint, method, client_ip, user_agent, searched_id, request_params,
                status_code, success, member_id, member_name, parcels_count,
                tracking_numbers, reply_message, response_payload, response_time_ms
            ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15)
        `, [
            endpoint,
            method,
            cleanIp,
            cleanUa,
            cleanSearched,
            reqJson,
            status_code,
            success,
            cleanMemberId,
            cleanMemberName,
            parcels_count,
            cleanTracking,
            reply_message,
            resJson,
            response_time_ms
        ]);
    } catch (err) {
        console.error('⚠️ Failed to save bot log:', err.message);
    }
}

// Fetch logs with filters & pagination
async function getBotLogs({ limit = 50, since_id = 0, search = '', status = 'all' } = {}) {
    await ensureBotLogsTable();

    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (since_id && Number(since_id) > 0) {
        conditions.push(`id > $${paramIdx++}`);
        params.push(Number(since_id));
    }

    if (search && search.trim()) {
        const s = `%${search.trim().toUpperCase()}%`;
        conditions.push(`(
            UPPER(searched_id) LIKE $${paramIdx} OR
            UPPER(member_id) LIKE $${paramIdx} OR
            UPPER(member_name) LIKE $${paramIdx} OR
            UPPER(tracking_numbers) LIKE $${paramIdx}
        )`);
        params.push(s);
        paramIdx++;
    }

    if (status === 'success') {
        conditions.push(`success = true`);
    } else if (status === 'not_found') {
        conditions.push(`status_code = 404`);
    } else if (status === 'error') {
        conditions.push(`(success = false OR status_code >= 400)`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);

    const querySql = `
        SELECT id, created_at, endpoint, method, client_ip, user_agent, searched_id,
               request_params, status_code, success, member_id, member_name,
               parcels_count, tracking_numbers, reply_message, response_payload, response_time_ms
        FROM bot_logs
        ${whereClause}
        ORDER BY id DESC
        LIMIT ${safeLimit}
    `;

    const result = await db.query(querySql, params);

    // Get live quick stats
    const statsResult = await db.query(`
        SELECT 
            COUNT(*) as total_count,
            COUNT(*) FILTER (WHERE success = true) as success_count,
            COUNT(*) FILTER (WHERE status_code = 404) as not_found_count,
            COUNT(*) FILTER (WHERE status_code >= 500) as error_count,
            COALESCE(ROUND(AVG(response_time_ms)), 0) as avg_latency_ms
        FROM bot_logs
        WHERE created_at >= CURRENT_DATE
    `);

    const stats = statsResult.rows[0] || {
        total_count: 0,
        success_count: 0,
        not_found_count: 0,
        error_count: 0,
        avg_latency_ms: 0
    };

    return {
        logs: result.rows,
        stats
    };
}

module.exports = {
    ensureBotLogsTable,
    logBotInteraction,
    getBotLogs
};
