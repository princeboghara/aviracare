async function analyze() {
    try {
        console.log("Fetching wa.crmbot.in js bundle...");
        const res = await fetch('https://wa.crmbot.in/static/js/main.f7f8df58.js');
        const code = await res.text();
        console.log("JS bundle size:", code.length);

        // Find API endpoints and base URLs
        const urls = code.match(/https?:\/\/[a-zA-Z0-9.-]+[a-zA-Z0-9]/g) || [];
        console.log("Distinct base URLs:", Array.from(new Set(urls)));

        // Find routes with crmapi or automations or api
        const endpoints = [];
        const regex = /["'](\/[a-zA-Z0-9_\/-]+)["']/g;
        let m;
        while ((m = regex.exec(code)) !== null) {
            const path = m[1];
            if (path.includes('login') || path.includes('auth') || path.includes('message') || path.includes('send') || path.includes('template') || path.includes('campaign') || path.includes('contact') || path.includes('user')) {
                endpoints.push(path);
            }
        }
        console.log("Relevant endpoints:", Array.from(new Set(endpoints)));

    } catch (e) {
        console.error("Error:", e);
    }
}

analyze();
