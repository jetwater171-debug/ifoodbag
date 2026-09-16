const { toText } = require('./payment-gateway-config');

async function request(config, path, payload) {
    const base = toText(config.baseUrl) || 'https://app.clownspay.com';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(config.timeoutMs) || 12000);
    try {
        // Creation has no documented idempotency support: never retry a POST.
        const response = await fetch(`${base.replace(/\/+$/, '')}/api/v1/${path}`, {
            method: payload ? 'POST' : 'GET',
            headers: { 'X-API-Key': toText(config.apiKey), 'Content-Type': 'application/json' },
            ...(payload ? { body: JSON.stringify(payload) } : {}),
            signal: controller.signal
        });
        const data = await response.json().catch(() => ({ error: 'invalid_gateway_response' }));
        return { response, data };
    } finally {
        clearTimeout(timer);
    }
}

const requestCreateTransaction = (config = {}, payload = {}) => request(config, 'transaction', payload);
const requestTransactionById = (config = {}, id = '') => request(config, `query?action=get_transaction&id=${encodeURIComponent(id)}`);
const requestTransactionByReference = (config = {}, reference = '') => request(config, `query?action=list_transactions&external_id=${encodeURIComponent(reference)}`);

function resolvePostbackUrl(req, config = {}) {
    const host = req.headers?.['x-forwarded-host'] || req.headers?.host || 'localhost:3000';
    const protocol = req.headers?.['x-forwarded-proto'] === 'http' ? 'http' : 'https';
    const url = new URL(config.postbackUrl || `${protocol}://${host}/api/pix/webhook`);
    url.searchParams.set('gateway', 'clownpay');
    if (config.webhookToken) url.searchParams.set('token', config.webhookToken);
    return url.toString();
}

// Webhooks expose a public ID different from the creation ID. Resolve the
// canonical ID and authoritative status through the authenticated reference query.
async function verifyWebhook(config, body) {
    const reference = toText(body.external_id || body.store_reference);
    if (!reference) throw new Error('missing_reference');
    const { response, data } = await requestTransactionByReference(config, reference);
    if (!response.ok || !Array.isArray(data)) throw new Error('verification_unavailable');
    const matches = data.filter(row => toText(row.external_id) === reference);
    if (matches.length !== 1) throw new Error('ambiguous_transaction');
    const row = matches[0];
    if (!row.id || !row.status || !Number.isInteger(Number(row.amount)) || Number(row.amount) <= 0) throw new Error('invalid_transaction');
    return { ...row, transaction_id: String(row.id), external_id: reference };
}

module.exports = { requestCreateTransaction, requestTransactionById, requestTransactionByReference, resolvePostbackUrl, verifyWebhook };
