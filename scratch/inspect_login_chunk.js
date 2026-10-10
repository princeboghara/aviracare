async function inspectLoginChunk() {
    const res = await fetch('https://wa.crmbot.in/static/js/1343.25b111a0.chunk.js');
    const text = await res.text();
    console.log("Size:", text.length);

    // Look for URLs or API paths
    const apis = text.match(/https?:\/\/[a-zA-Z0-9.-]+\.com[^\s"']*/g) || [];
    console.log("APIs:", Array.from(new Set(apis)));

    // Look for routes
    const routes = text.match(/\/api\/[a-zA-Z0-9_\/-]+/g) || [];
    console.log("Routes:", Array.from(new Set(routes)));

    // Look for strings around master-login
    const idx = text.indexOf('master-login');
    if (idx !== -1) {
        console.log("Context around master-login:\n", text.slice(Math.max(0, idx - 200), idx + 200));
    }
}

inspectLoginChunk().catch(console.error);
