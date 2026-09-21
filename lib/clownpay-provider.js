const { toText } = require('./payment-gateway-config');

// Persist account scope with the local ID; provider IDs can overlap across accounts.
const SUBACCOUNT_PREFIX = 'clownsub:';
const isSubaccountTransaction = id => toText(id).startsWith(SUBACCOUNT_PREFIX);
function forAccount(config, subaccount) {
    if (!subaccount) return { ...config, account: 'main' };
    if (!toText(config.subaccountApiKey)) throw new Error('clownpay_subaccount_key_missing');
    return { ...config, apiKey: config.subaccountApiKey, account: 'subaccount' };
}
function resolveCreateConfig(config, payments, upsellEnabled) {
    return { ...config, account: payments.activeGateway === 'clownpay' && upsellEnabled && toText(config.subaccountApiKey) ? 'subaccount' : 'main' };
}

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

async function requestCreateTransaction(config = {}, payload = {}) {
    const subaccount = config.account === 'subaccount';
    const result = await request(forAccount(config, subaccount), 'transaction', subaccount
        ? { ...payload, source: 'api_externa', productHash: undefined, orderbump: undefined }
        : payload);
    if (subaccount && result.response.ok && result.data.transaction_id) {
        result.data.transaction_id = SUBACCOUNT_PREFIX + result.data.transaction_id;
    }
    return result;
}
const requestTransactionById = (config = {}, id = '') => request(
    forAccount(config, isSubaccountTransaction(id)),
    `query?action=get_transaction&id=${encodeURIComponent(isSubaccountTransaction(id) ? id.slice(SUBACCOUNT_PREFIX.length) : id)}`
);
const requestTransactionByReference = (config = {}, reference = '') => request(forAccount(config, config.account === 'subaccount'), `query?action=list_transactions&external_id=${encodeURIComponent(reference)}`);

function resolvePostbackUrl(req, config = {}) {
    const host = req.headers?.['x-forwarded-host'] || req.headers?.host || 'localhost:3000';
    const protocol = req.headers?.['x-forwarded-proto'] === 'http' ? 'http' : 'https';
    const url = new URL(config.postbackUrl || `${protocol}://${host}/api/pix/webhook`);
    url.searchParams.set('gateway', 'clownpay');
    url.searchParams.set('account', config.account === 'subaccount' ? 'subaccount' : 'main');
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
    return { ...row, transaction_id: (config.account === 'subaccount' ? SUBACCOUNT_PREFIX : '') + String(row.id), external_id: reference };
}

module.exports = { requestCreateTransaction, requestTransactionById, requestTransactionByReference, resolvePostbackUrl, verifyWebhook, resolveCreateConfig, isSubaccountTransaction };
