async function checkRoutes() {
    const chunkUrl = 'https://wa.crmbot.in/static/js/5608.f8153c5e.chunk.js';
    const res = await fetch(chunkUrl);
    const text = await res.text();
    console.log("Chunk size:", text.length);

    // Extract all strings starting with /api/
    const matches = text.match(/\/api\/[a-zA-Z0-9_\/-]+/g) || [];
    console.log("Unique /api/ routes:", Array.from(new Set(matches)));
}

checkRoutes().catch(console.error);
