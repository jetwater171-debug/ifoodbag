const { removeBasicPrefix, toBase64, toText } = require('./payment-gateway-config');

const fetchFn = global.fetch
    ? global.fetch.bind(global)
    : (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const authCache = new Map();

function normalizeBasicCandidates(config = {}) {
    const explicit = removeBasicPrefix(config.basicAuthBase64 || config.apiKeyBase64 || '');
    if (explicit) {
        return [`Basic ${explicit}`, explicit];
    }
    const secretKey = toText(config.secretKey);
    const companyId = toText(config.companyId);
    const secretWithCompany = secretKey && companyId ? toBase64(`${secretKey}:${companyId}`) : '';
    const secretLegacy = secretKey ? toBase64(`${secretKey}:`) : '';

    const tokens = [explicit, secretWithCompany, secretLegacy].filter(Boolean);
    const candidates = tokens.flatMap((token) => [`Basic ${token}`, token]);
    return Array.from(new Set(candidates));
}

function authCacheKey(config = {}) {
    return [
        toText(config.baseUrl),
        removeBasicPrefix(config.basicAuthBase64 || config.apiKeyBase64 || ''),
        toText(config.secretKey),
        toText(config.companyId)
    ].join('|');
}

function prioritizeAuthVariants(config = {}) {
    const variants = normalizeBasicCandidates(config);
    const key = authCacheKey(config);
    const cached = authCache.get(key);
    if (!cached) return { key, variants };
    const index = variants.indexOf(cached);
    if (index <= 0) return { key, variants };
    const reordered = [variants[index], ...variants.slice(0, index), ...variants.slice(index + 1)];
    return { key, variants: reordered };
}

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

function resolveHostAndProtocol(req) {
    const host = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || 'localhost:3000').trim();
    const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || '').trim().toLowerCase();
    const protocol = forwardedProto === 'http' || forwardedProto === 'https' ? forwardedProto : 'https';
    return { host, protocol };
}

function resolvePostbackUrl(req, config = {}) {
    if (toText(config.postbackUrl)) return toText(config.postbackUrl);
    const { host, protocol } = resolveHostAndProtocol(req);
    const token = toText(config.webhookToken);
    const params = new URLSearchParams();
    params.set('gateway', 'ghostspay');
    if (token) params.set('token', token);
    return `${protocol}://${host}/api/pix/webhook?${params.toString()}`;
}

async function requestCreateTransaction(config = {}, payload = {}) {
    const baseUrl = String(config.baseUrl || '').replace(/\/+$/, '');
    const endpoint = `${baseUrl}/transactions`;
    const timeoutMs = Number(config.timeoutMs || 12000);
    const { key, variants: authVariants } = prioritizeAuthVariants(config);
    let last = null;

    for (const authorization of authVariants) {
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const result = await fetchWithTimeout(endpoint, {
                method: 'POST',
                headers: {
                    Authorization: authorization,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload || {})
            }, timeoutMs);
            last = result;

            if (result.response?.ok) {
                authCache.set(key, authorization);
                return result;
            }

            const status = Number(result.response?.status || 0);
            const retryable = status === 408 || status === 429 || status >= 500;
            if (retryable && attempt === 0) {
                await new Promise((resolve) => setTimeout(resolve, 500));
                continue;
            }
            if (status === 401 || status === 403) break;
            return result;
        }
    }

    return last || { response: { ok: false, status: 500 }, data: { error: 'request_failed' } };
}

async function requestTransactionById(config = {}, transactionId = '') {
    const txid = String(transactionId || '').trim();
    if (!txid) {
        return { response: { ok: false, status: 400 }, data: { error: 'missing_transaction_id' } };
    }
    const baseUrl = String(config.baseUrl || '').replace(/\/+$/, '');
    const endpoint = `${baseUrl}/transactions/${encodeURIComponent(txid)}`;
    const timeoutMs = Number(config.timeoutMs || 12000);
    const { key, variants: authVariants } = prioritizeAuthVariants(config);
    let last = null;

    for (const authorization of authVariants) {
        const result = await fetchWithTimeout(endpoint, {
            method: 'GET',
            headers: {
                Authorization: authorization,
                'Content-Type': 'application/json'
            }
        }, timeoutMs);
        last = result;
        const status = Number(result.response?.status || 0);
        if (result.response?.ok || status === 404) {
            authCache.set(key, authorization);
            return result;
        }
        if (status !== 401 && status !== 403) return result;
    }

    return last || { response: { ok: false, status: 500 }, data: { error: 'status_failed' } };
}

module.exports = {
    normalizeBasicCandidates,
    requestCreateTransaction,
    requestTransactionById,
    resolvePostbackUrl
};
