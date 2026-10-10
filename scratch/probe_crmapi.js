async function probe() {
    const paths = [
        '/',
        '/api',
        '/api/v1',
        '/api/login',
        '/login',
        '/auth/login',
        '/api/auth/login',
        '/api/user/login',
        '/swagger',
        '/docs',
        '/api-docs',
        '/openapi.json',
        '/health'
    ];

    for (const p of paths) {
        try {
            const url = `https://crmapi.1automations.com${p}`;
            const res = await fetch(url, { method: 'GET' });
            console.log(`GET ${p} -> Status: ${res.status}`);
            if (res.status === 200) {
                const text = await res.text();
                console.log(`   Response: ${text.slice(0, 150)}`);
            }
        } catch (e) {
            console.log(`GET ${p} -> Error: ${e.message}`);
        }
    }
}

probe();
