const BASE_URL = process.env.ATIVUSHUB_BASE_URL || 'https://api.ativushub.com.br';
const WEBHOOK_TOKEN = process.env.ATIVUSHUB_WEBHOOK_TOKEN || 'dev';
const REQUEST_TIMEOUT_MS = Number(process.env.ATIVUSHUB_TIMEOUT_MS || 12000);
const SELLER_CACHE_TTL_MS = Number(process.env.ATIVUSHUB_SELLER_CACHE_TTL_MS || 6 * 60 * 60 * 1000);
const STATUS_USER_AGENT =
    process.env.ATIVUSHUB_STATUS_USER_AGENT ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

function looksLikeBase64Token(value) {
    const text = String(value || '').trim();
    if (!text || text.length < 8) return false;
    if (!/^[A-Za-z0-9+/=]+$/.test(text)) return false;
    return text.length % 4 === 0;
}

function resolveApiKeyBase64() {
    const envBase64 = String(process.env.ATIVUSHUB_API_KEY_BASE64 || '').trim();
    if (envBase64) return envBase64;

    const raw = String(process.env.ATIVUSHUB_API_KEY || '').trim();
    if (!raw) return '';

    const normalizedRaw = raw.toLowerCase().startsWith('basic ')
        ? raw.slice(6).trim()
        : raw;

    // If user already pasted a base64 token here, keep it as-is (do not double-encode).
    if (looksLikeBase64Token(normalizedRaw)) return normalizedRaw;
    return Buffer.from(normalizedRaw, 'utf8').toString('base64');
}

const API_KEY_B64 = resolveApiKeyBase64();

const fetchFn = global.fetch
    ? global.fetch.bind(global)
    : (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const authHeaders = {
    Authorization: `Basic ${API_KEY_B64}`,
    'Content-Type': 'application/json'
};

const sellerCache = {
    value: null,
    expiresAt: 0,
    inflight: null
};

function sanitizeDigits(value) {
    return String(value || '').replace(/\D/g, '');
}

function extractIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
        return forwarded.split(',')[0].trim();
    }
    return req.socket?.remoteAddress || '';
}

function pickSellerId(payload) {
    if (!payload || typeof payload !== 'object') return '';
    return (
        payload?.dados_seller?.id_seller ||
        payload?.dados_seller?.idSeller ||
        payload?.dados_seller?.seller_id ||
        payload?.dados_seller?.empresa?.id ||
        payload?.id_seller ||
        payload?.idSeller ||
        ''
    );
}

async function fetchJson(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetchFn(url, {
            ...options,
            signal: controller.signal
        });
        const data = await response.json().catch(() => ({}));
        return { response, data };
    } finally {
        clearTimeout(timeout);
    }
}

function buildAuthHeadersExact() {
    return {
        Authorization: `Basic ${String(API_KEY_B64 || '').trim()}`,
        'Content-Type': 'application/json'
    };
}

function buildAuthHeaderVariants() {
    const token = String(API_KEY_B64 || '').trim();
    const raw = String(process.env.ATIVUSHUB_API_KEY || '').trim();
    const normalizedRaw = raw.toLowerCase().startsWith('basic ')
        ? raw.slice(6).trim()
        : raw;

    const candidates = [
        token ? `Basic ${token}` : '',
        token,
        normalizedRaw ? `Basic ${normalizedRaw}` : '',
        normalizedRaw
    ].filter(Boolean);

    return Array.from(new Set(candidates));
}

async function getTransactionStatusByIdTransaction(idTransaction) {
    const id = String(idTransaction || '').trim();
    if (!id) {
        return {
            response: { ok: false, status: 400 },
            data: { error: 'missing_id_transaction' }
        };
    }
    const endpoint =
        `${BASE_URL}/s1/getTransaction/api/getTransactionStatus.php` +
        `?id_transaction=${encodeURIComponent(id)}`;
    const authVariants = buildAuthHeaderVariants();
    let last = null;

    for (const authorization of authVariants) {
        const result = await fetchJson(endpoint, {
            method: 'GET',
            headers: {
                Authorization: authorization,
                'Content-Type': 'application/json',
                Accept: '*/*',
                'User-Agent': STATUS_USER_AGENT
            }
        });
        last = result;
        const status = Number(result?.response?.status || 0);
        // Stop as soon as we get a valid business response.
        if (result?.response?.ok || status === 404) {
            return result;
        }
        // Keep trying other auth formats only for auth-related failures.
        if (status !== 401 && status !== 403) {
            return result;
        }
    }

    return last || fetchJson(endpoint, {
        method: 'GET',
        headers: buildAuthHeadersExact()
    });
}

async function getSellerId() {
    if (process.env.ATIVUSHUB_SELLER_ID) return process.env.ATIVUSHUB_SELLER_ID;

    const now = Date.now();
    if (sellerCache.value && sellerCache.expiresAt > now) {
        return sellerCache.value;
    }

    if (sellerCache.inflight) {
        return sellerCache.inflight;
    }

    sellerCache.inflight = (async () => {
        const { response, data } = await fetchJson(`${BASE_URL}/s1/getCompany/`, {
            method: 'GET',
            headers: authHeaders
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch seller at AtivusHUB (${response.status}).`);
        }

        const sellerId = pickSellerId(data);
        if (!sellerId) {
            throw new Error('Seller ID not found at AtivusHUB.');
        }

        sellerCache.value = sellerId;
        sellerCache.expiresAt = Date.now() + SELLER_CACHE_TTL_MS;
        return sellerId;
    })();

    try {
        return await sellerCache.inflight;
    } finally {
        sellerCache.inflight = null;
    }
}

function resolvePostbackUrl(req) {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const token = WEBHOOK_TOKEN;
    if (process.env.ATIVUSHUB_POSTBACK_URL) return process.env.ATIVUSHUB_POSTBACK_URL;
    return `https://${host}/api/pix/webhook?token=${token}`;
}

module.exports = {
    BASE_URL,
    WEBHOOK_TOKEN,
    API_KEY_B64,
    fetchFn,
    authHeaders,
    buildAuthHeadersExact,
    sanitizeDigits,
    extractIp,
    fetchJson,
    getTransactionStatusByIdTransaction,
    getSellerId,
    resolvePostbackUrl
};
