const DEFAULT_ATIVUS_BASE_URL = 'https://api.ativushub.com.br';
const DEFAULT_GHOSTSPAY_BASE_URL = 'https://api.ghostspaysv2.com/functions/v1';
const DEFAULT_SUNIZE_BASE_URL = 'https://api.sunize.com.br/v1';
const DEFAULT_ACTIVE_GATEWAY = 'ativushub';
const SUPPORTED_GATEWAYS = new Set(['ativushub', 'ghostspay', 'sunize']);

function toText(value) {
    return String(value || '').trim();
}

function envBoolean(name, fallback = false) {
    const raw = toText(process.env[name]).toLowerCase();
    if (!raw) return fallback;
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function looksLikeBase64Token(value) {
    const text = toText(value);
    if (!text || text.length < 8) return false;
    if (!/^[A-Za-z0-9+/=]+$/.test(text)) return false;
    return text.length % 4 === 0;
}

function removeBasicPrefix(value) {
    const text = toText(value);
    if (!text) return '';
    if (text.toLowerCase().startsWith('basic ')) {
        return text.slice(6).trim();
    }
    return text;
}

function toBase64(value) {
    return Buffer.from(String(value || ''), 'utf8').toString('base64');
}

function normalizeGatewayAlias(value) {
    const raw = toText(value).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!raw) return '';
    const aliases = {
        ativus: 'ativushub',
        ativushub: 'ativushub',
        ghostspay: 'ghostspay',
        ghostpay: 'ghostspay',
        ghosts: 'ghostspay',
        sunize: 'sunize',
        sunizepay: 'sunize'
    };
    return aliases[raw] || raw;
}

function normalizeGatewayId(value) {
    const normalized = normalizeGatewayAlias(value);
    if (SUPPORTED_GATEWAYS.has(normalized)) return normalized;
    return DEFAULT_ACTIVE_GATEWAY;
}

function resolveAtivusApiKeyBase64(raw = '') {
    const cleaned = removeBasicPrefix(raw);
    if (!cleaned) return '';
    if (looksLikeBase64Token(cleaned)) return cleaned;
    return toBase64(cleaned);
}

function buildAtivushubConfig(raw = {}) {
    const envApiKeyBase64 = toText(process.env.ATIVUSHUB_API_KEY_BASE64);
    const envApiKeyRaw = removeBasicPrefix(process.env.ATIVUSHUB_API_KEY);
    const settingsApiKeyBase64 = toText(raw.apiKeyBase64);
    const settingsApiKeyRaw = removeBasicPrefix(raw.apiKey || raw.token);

    const apiKeyBase64 =
        settingsApiKeyBase64 ||
        resolveAtivusApiKeyBase64(settingsApiKeyRaw) ||
        envApiKeyBase64 ||
        resolveAtivusApiKeyBase64(envApiKeyRaw);

    const apiKeyRaw = settingsApiKeyRaw || envApiKeyRaw;

    const webhookToken = toText(raw.webhookToken) || toText(process.env.ATIVUSHUB_WEBHOOK_TOKEN);

    return {
        enabled: raw.enabled !== false,
        baseUrl: toText(raw.baseUrl) || toText(process.env.ATIVUSHUB_BASE_URL) || DEFAULT_ATIVUS_BASE_URL,
        apiKeyBase64,
        apiKey: apiKeyRaw,
        sellerId: toText(raw.sellerId) || toText(process.env.ATIVUSHUB_SELLER_ID),
        postbackUrl: toText(raw.postbackUrl) || toText(process.env.ATIVUSHUB_POSTBACK_URL),
        webhookToken,
        webhookTokenRequired: raw.webhookTokenRequired !== undefined
            ? !!raw.webhookTokenRequired
            : envBoolean('ATIVUSHUB_WEBHOOK_TOKEN_REQUIRED', Boolean(webhookToken)),
        webhookAllowFallback: raw.webhookAllowFallback !== undefined
            ? !!raw.webhookAllowFallback
            : envBoolean('ATIVUSHUB_WEBHOOK_ALLOW_FALLBACK', true),
        timeoutMs: Number(raw.timeoutMs || process.env.ATIVUSHUB_TIMEOUT_MS || 12000)
    };
}

function buildGhostspayConfig(raw = {}) {
    const settingsBasic = removeBasicPrefix(raw.basicAuth || raw.apiKeyBase64 || raw.token);
    const envBasic = removeBasicPrefix(process.env.GHOSTSPAY_BASIC_AUTH || process.env.GHOSTSPAY_API_KEY_BASE64 || '');
    const secretKey = toText(raw.secretKey) || toText(process.env.GHOSTSPAY_SECRET_KEY);
    const companyId = toText(raw.companyId) || toText(process.env.GHOSTSPAY_COMPANY_ID);
    const basicAuthBase64 = settingsBasic || envBasic;

    const webhookToken = toText(raw.webhookToken) || toText(process.env.GHOSTSPAY_WEBHOOK_TOKEN);

    return {
        enabled: raw.enabled === true || envBoolean('GHOSTSPAY_ENABLED', false),
        baseUrl: toText(raw.baseUrl) || toText(process.env.GHOSTSPAY_BASE_URL) || DEFAULT_GHOSTSPAY_BASE_URL,
        basicAuthBase64,
        secretKey,
        companyId,
        postbackUrl: toText(raw.postbackUrl) || toText(process.env.GHOSTSPAY_POSTBACK_URL),
        webhookToken,
        webhookTokenRequired: raw.webhookTokenRequired !== undefined
            ? !!raw.webhookTokenRequired
            : envBoolean('GHOSTSPAY_WEBHOOK_TOKEN_REQUIRED', false),
        timeoutMs: Number(raw.timeoutMs || process.env.GHOSTSPAY_TIMEOUT_MS || 12000)
    };
}

function buildSunizeConfig(raw = {}) {
    const webhookToken = toText(raw.webhookToken) || toText(process.env.SUNIZE_WEBHOOK_TOKEN);
    return {
        enabled: raw.enabled === true || envBoolean('SUNIZE_ENABLED', false),
        baseUrl: toText(raw.baseUrl) || toText(process.env.SUNIZE_BASE_URL) || DEFAULT_SUNIZE_BASE_URL,
        apiKey:
            toText(raw.apiKey) ||
            toText(raw.xApiKey) ||
            toText(process.env.SUNIZE_API_KEY),
        apiSecret:
            toText(raw.apiSecret) ||
            toText(raw.xApiSecret) ||
            toText(process.env.SUNIZE_API_SECRET),
        postbackUrl: toText(raw.postbackUrl) || toText(process.env.SUNIZE_POSTBACK_URL),
        webhookToken,
        webhookTokenRequired: raw.webhookTokenRequired !== undefined
            ? !!raw.webhookTokenRequired
            : envBoolean('SUNIZE_WEBHOOK_TOKEN_REQUIRED', false),
        timeoutMs: Number(raw.timeoutMs || process.env.SUNIZE_TIMEOUT_MS || 12000)
    };
}

function buildPaymentsConfig(raw = {}) {
    const gatewaysRaw = raw && typeof raw === 'object' ? (raw.gateways || {}) : {};
    const ativushub = buildAtivushubConfig(gatewaysRaw.ativushub || raw.ativushub || {});
    const ghostspay = buildGhostspayConfig(gatewaysRaw.ghostspay || raw.ghostspay || {});
    const sunize = buildSunizeConfig(gatewaysRaw.sunize || raw.sunize || {});

    let activeGateway = normalizeGatewayId(raw.activeGateway || process.env.PAYMENTS_ACTIVE_GATEWAY || DEFAULT_ACTIVE_GATEWAY);
    const enabledByGateway = {
        ativushub: ativushub.enabled !== false,
        ghostspay: ghostspay.enabled === true,
        sunize: sunize.enabled === true
    };
    if (!enabledByGateway[activeGateway]) {
        activeGateway =
            (['ativushub', 'ghostspay', 'sunize'].find((gatewayId) => enabledByGateway[gatewayId])) ||
            DEFAULT_ACTIVE_GATEWAY;
    }

    return {
        activeGateway,
        gateways: {
            ativushub,
            ghostspay,
            sunize
        }
    };
}

function resolveGatewayFromPayload(payload = {}, fallback = DEFAULT_ACTIVE_GATEWAY) {
    const p = payload && typeof payload === 'object' ? payload : {};
    const candidates = [
        p.gateway,
        p.provider,
        p.pixGateway,
        p.paymentGateway,
        p.pix?.gateway,
        p.metadata?.gateway,
        p.payload?.gateway,
        p.payload?.pixGateway
    ];
    for (const candidate of candidates) {
        const raw = toText(candidate).toLowerCase();
        if (!raw) continue;
        const normalized = normalizeGatewayId(raw);
        if (SUPPORTED_GATEWAYS.has(normalized)) return normalized;
    }
    return normalizeGatewayId(fallback);
}

function mergePaymentSettings(base = {}, incoming = {}) {
    const merged = {
        ...base,
        ...incoming
    };
    return buildPaymentsConfig(merged);
}

module.exports = {
    DEFAULT_ACTIVE_GATEWAY,
    DEFAULT_ATIVUS_BASE_URL,
    DEFAULT_GHOSTSPAY_BASE_URL,
    DEFAULT_SUNIZE_BASE_URL,
    SUPPORTED_GATEWAYS,
    toText,
    envBoolean,
    looksLikeBase64Token,
    removeBasicPrefix,
    toBase64,
    normalizeGatewayId,
    resolveAtivusApiKeyBase64,
    buildAtivushubConfig,
    buildGhostspayConfig,
    buildSunizeConfig,
    buildPaymentsConfig,
    mergePaymentSettings,
    resolveGatewayFromPayload
};
