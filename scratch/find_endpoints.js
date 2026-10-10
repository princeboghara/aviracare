async function findEndpoints() {
    const res = await fetch('https://wa.crmbot.in/static/js/main.f7f8df58.js');
    const text = await res.text();
    
    // Look for axios baseURL or http request calls
    const matches = text.match(/(?:baseURL|url|post|get|put|delete)\s*[:(]\s*["'`]([^"'`]+)["'`]/gi) || [];
    console.log("Matches:", Array.from(new Set(matches)).slice(0, 40));

    // Look for any domain or API mentions
    const words = text.match(/[a-zA-Z0-9.-]+\.com/gi) || [];
    console.log("Domains:", Array.from(new Set(words)));
}

findEndpoints();
