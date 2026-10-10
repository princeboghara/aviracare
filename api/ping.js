module.exports = (req, res) => {
    res.json({
        pong: true,
        hasDbUrl: Boolean(process.env.DATABASE_URL),
        dbHost: process.env.DATABASE_URL ? process.env.DATABASE_URL.split('@')[1]?.split('/')[0] : null,
        nodeVersion: process.version
    });
};
