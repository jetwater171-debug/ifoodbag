const fetchFn = global.fetch
    ? global.fetch.bind(global)
    : (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const { getSettings } = require('./settings-store');

async function sendUtmfy(eventName, payload) {
    const settings = await getSettings();
    const cfg = settings.utmfy || {};

    if (!cfg.enabled || !cfg.endpoint) {
        return { ok: false, reason: 'disabled' };
    }

    const headers = {
        'Content-Type': 'application/json'
    };
    if (cfg.apiKey) {
        headers.Authorization = `Bearer ${cfg.apiKey}`;
    }

    const response = await fetchFn(cfg.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ event: eventName, payload })
    });

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        return { ok: false, reason: 'utmfy_error', detail };
    }

    return { ok: true };
}

module.exports = {
    sendUtmfy
};
