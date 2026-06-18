const crypto = require('node:crypto');
const { toText } = require('./payment-gateway-config');

const fetchFn = global.fetch
    ? global.fetch.bind(global)
    : (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

async function parseResponseData(response) {
    const text = await response.text().catch(() => '');
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch (_error) {
        return { message: text };
    }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetchFn(url, {
            ...options,
            signal: controller.signal
        });
        const data = await parseResponseData(response);
        return { response, data };
    } finally {
        clearTimeout(timeout);
    }
}

function resolveBaseUrl(config = {}) {
    return String(config.baseUrl || '').replace(/\/+$/, '');
}

function buildHeaders(config = {}, extra = {}) {
    const headers = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${toText(config.apiKey)}`
    };
    Object.entries(extra || {}).forEach(([key, value]) => {
        const cleanValue = toText(value);
        if (cleanValue) headers[key] = cleanValue;
    });
    return headers;
}

function retryDelayMs(response, attempt) {
    const retryAfter = Number(response?.headers?.get?.('retry-after') || 0);
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
        return Math.min(5000, Math.round(retryAfter * 1000));
    }
    return 450 * (attempt + 1);
}

async function requestCreateTransaction(config = {}, payload = {}, options = {}) {
    const endpoint = `${resolveBaseUrl(config)}/transactions`;
    const timeoutMs = Number(config.timeoutMs || 12000);
    const idempotencyKey = toText(options.idempotencyKey || payload.external_reference || payload.externalReference);
    const headers = buildHeaders(config, idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {});

    let last = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const result = await fetchWithTimeout(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload || {})
        }, timeoutMs);
        last = result;
        if (result.response?.ok) return result;

        const status = Number(result.response?.status || 0);
        const retryable = status === 408 || status === 429 || status >= 500 || !status;
        if (!retryable || attempt === 2) return result;
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs(result.response, attempt)));
    }

    return last || { response: { ok: false, status: 500 }, data: { error: { code: 'request_failed' } } };
}

async function requestListTransactions(config = {}, filters = {}) {
    const endpoint = new URL(`${resolveBaseUrl(config)}/transactions`);
    const limit = Number(filters.limit || 20);
    if (Number.isFinite(limit) && limit > 0) endpoint.searchParams.set('limit', String(Math.min(100, Math.floor(limit))));
    const cursor = toText(filters.cursor);
    if (cursor) endpoint.searchParams.set('cursor', cursor);
    const status = toText(filters.status).toUpperCase();
    if (status) endpoint.searchParams.set('status', status);
    const method = toText(filters.method).toUpperCase();
    if (method) endpoint.searchParams.set('method', method);

    const timeoutMs = Number(config.timeoutMs || 12000);
    const headers = buildHeaders(config);

    let last = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const result = await fetchWithTimeout(endpoint.toString(), {
            method: 'GET',
            headers
        }, timeoutMs);
        last = result;
        if (result.response?.ok) return result;

        const statusCode = Number(result.response?.status || 0);
        const retryable = statusCode === 408 || statusCode === 429 || statusCode >= 500 || !statusCode;
        if (!retryable || attempt === 2) return result;
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs(result.response, attempt)));
    }

    return last || { response: { ok: false, status: 500 }, data: { error: { code: 'list_failed' } } };
}

async function requestTransactionById(config = {}, transactionId = '') {
    const id = toText(transactionId);
    if (!id) {
        return { response: { ok: false, status: 400 }, data: { error: { code: 'missing_transaction_id' } } };
    }

    const list = await requestListTransactions(config, { limit: 100, method: 'PIX' });
    if (!list?.response?.ok) return list;
    const rows = Array.isArray(list.data?.data) ? list.data.data : [];
    const match = rows.find((item) => String(item?.id || '').trim() === id);
    if (!match) {
        return { response: { ok: false, status: 404 }, data: { error: { code: 'transaction_not_found' } } };
    }
    return { response: { ok: true, status: 200 }, data: match };
}

function verifyWebhookSignature(rawBody = '', signature = '', secret = '') {
    const cleanSignature = toText(signature);
    const cleanSecret = toText(secret);
    if (!cleanSignature || !cleanSecret) return false;
    if (!/^[a-f0-9]{64}$/i.test(cleanSignature)) return false;

    const expected = crypto
        .createHmac('sha256', cleanSecret)
        .update(String(rawBody || ''))
        .digest('hex');

    const expectedBuffer = Buffer.from(expected, 'hex');
    const receivedBuffer = Buffer.from(cleanSignature, 'hex');
    if (expectedBuffer.length !== receivedBuffer.length) return false;
    return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

module.exports = {
    requestCreateTransaction,
    requestListTransactions,
    requestTransactionById,
    verifyWebhookSignature
};
