async function findSendMethods() {
    const res = await fetch('https://wa.crmbot.in/asset-manifest.json');
    const manifest = await res.json();
    const files = Object.values(manifest.files).filter(f => f.endsWith('.chunk.js'));

    for (const f of files) {
        const chunkRes = await fetch(`https://wa.crmbot.in${f}`);
        const text = await chunkRes.text();
        const matches = text.match(/\/api\/[a-zA-Z0-9_\/-]*(?:message|send|template|broadcast|chat)[a-zA-Z0-9_\/-]*/gi) || [];
        if (matches.length > 0) {
            console.log(`Chunk ${f}:`, Array.from(new Set(matches)));
        }
    }
}

findSendMethods().catch(console.error);
