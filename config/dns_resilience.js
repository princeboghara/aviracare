/**
 * 🌐 Bulletproof DNS Resilience Layer
 * Fixes macOS / Node.js libuv getaddrinfo ENOTFOUND / EAI_AGAIN issues
 * with AWS Supabase pooler CNAMEs and external APIs by providing
 * automatic IPv4 and fallback public DNS (Google & Cloudflare) resolution.
 */
const dns = require('dns');

if (!global.__DNS_RESILIENCE_INITIALIZED__) {
    global.__DNS_RESILIENCE_INITIALIZED__ = true;

    // Prefer IPv4 first
    try {
        if (dns.setDefaultResultOrder) {
            dns.setDefaultResultOrder('ipv4first');
        }
    } catch (_) {}

    const originalLookup = dns.lookup;
    const fallbackResolver = new dns.Resolver();
    fallbackResolver.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);

    dns.lookup = function (hostname, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = {};
        }

        originalLookup(hostname, options, (err, address, family) => {
            if (err && (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN' || err.code === 'ETIMEDOUT')) {
                // 1. Try local IPv4 resolve
                dns.resolve4(hostname, (rErr, addresses) => {
                    if (!rErr && addresses && addresses.length > 0) {
                        return callback(null, addresses[0], 4);
                    }
                    // 2. Try Google / Cloudflare public DNS resolvers
                    fallbackResolver.resolve4(hostname, (fErr, fAddresses) => {
                        if (!fErr && fAddresses && fAddresses.length > 0) {
                            return callback(null, fAddresses[0], 4);
                        }
                        return callback(err);
                    });
                });
            } else {
                callback(err, address, family);
            }
        });
    };
}

module.exports = dns;
