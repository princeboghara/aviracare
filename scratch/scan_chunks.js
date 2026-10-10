async function scanChunks() {
    const res = await fetch('https://wa.crmbot.in/asset-manifest.json');
    const manifest = await res.json();
    const files = Object.values(manifest.files).filter(f => f.endsWith('.chunk.js'));
    console.log(`Scanning ${files.length} chunks...`);

    for (const f of files) {
        const url = `https://wa.crmbot.in${f}`;
        const chunkRes = await fetch(url);
        const text = await chunkRes.text();
        if (text.includes('crmapi') || text.includes('1automations') || text.includes('login') || text.includes('Avira')) {
            console.log(`Found match in chunk: ${f}`);
            const m = text.match(/https?:\/\/[a-zA-Z0-9.-]+\.1automations\.com[^\s"']*/g);
            if (m) console.log('  1automations URLs:', Array.from(new Set(m)));
            
            const apiRoutes = text.match(/["'](\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+)["']/g) || [];
            const filtered = apiRoutes.filter(r => r.includes('login') || r.includes('auth') || r.includes('message'));
            if (filtered.length > 0) {
                console.log('  Routes:', Array.from(new Set(filtered)).slice(0, 5));
            }
        }
    }
}

scanChunks().catch(console.error);
