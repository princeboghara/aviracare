async function findLogin() {
    const res = await fetch('https://wa.crmbot.in/asset-manifest.json');
    const manifest = await res.json();
    const files = Object.values(manifest.files).filter(f => f.endsWith('.chunk.js'));

    for (const f of files) {
        const chunkRes = await fetch(`https://wa.crmbot.in${f}`);
        const text = await chunkRes.text();
        const matches = text.match(/\/api\/[a-zA-Z0-9_\/-]*login[a-zA-Z0-9_\/-]*/gi) || [];
        if (matches.length > 0) {
            console.log(`Chunk ${f}:`, Array.from(new Set(matches)));
        }
        const authMatches = text.match(/\/api\/[a-zA-Z0-9_\/-]*auth[a-zA-Z0-9_\/-]*/gi) || [];
        if (authMatches.length > 0) {
            console.log(`Auth Chunk ${f}:`, Array.from(new Set(authMatches)));
        }
    }
}

findLogin().catch(console.error);
