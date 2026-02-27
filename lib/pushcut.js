const fetchFn = global.fetch
    ? global.fetch.bind(global)
    : (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const { getSettings, defaultSettings } = require('./settings-store');

function asObject(input) {
    return input && typeof input === 'object' && !Array.isArray(input) ? input : {};
}

function canonicalUrlKey(value = '') {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
        const parsed = new URL(raw);
        const protocol = String(parsed.protocol || '').toLowerCase();
        const host = String(parsed.host || '').toLowerCase();
        const pathname = (String(parsed.pathname || '') || '/').replace(/\/+$/, '') || '/';
        const search = String(parsed.search || '');
        return `${protocol}//${host}${pathname}${search}`;
    } catch (_error) {
        return raw;
    }
}

function uniqueUrls(input = []) {
    const seen = new Set();
    const out = [];
    for (const raw of input) {
        const url = String(raw || '').trim();
        if (!url) continue;
        const key = canonicalUrlKey(url);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(url);
    }
    return out;
}

function resolvePushcutUrl(kind, cfg = {}) {
    if (kind === 'pix_created' || kind === 'upsell_pix_created') {
        return uniqueUrls([
            cfg.pixCreatedUrl,
            ...(Array.isArray(cfg.pixCreatedUrls) ? cfg.pixCreatedUrls : []),
            cfg.pixCreatedUrl2
        ])[0] || '';
    }
    if (kind === 'pix_confirmed' || kind === 'upsell_pix_confirmed') {
        return uniqueUrls([
            cfg.pixConfirmedUrl,
            ...(Array.isArray(cfg.pixConfirmedUrls) ? cfg.pixConfirmedUrls : []),
            cfg.pixConfirmedUrl2
        ])[0] || '';
    }
    return '';
}

function formatCurrencyBr(value) {
    const amount = Number(value || 0);
    return amount.toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    });
}

function normalizeAmount(value) {
    if (value === undefined || value === null || value === '') return 0;
    const raw = String(value).trim();
    if (!raw) return 0;
    const normalized = raw.replace(',', '.');
    const amount = Number(normalized);
    if (!Number.isFinite(amount)) return 0;
    const hasDecimalMark = /[.,]/.test(raw);
    if (hasDecimalMark) return Number(amount.toFixed(2));
    if (Number.isInteger(amount) && Math.abs(amount) >= 100) {
        return Number((amount / 100).toFixed(2));
    }
    return Number(amount.toFixed(2));
}

function resolveTrackingText(...values) {
    for (const raw of values) {
        const value = String(raw || '').trim();
        if (value) return value;
    }
    return '';
}

function decodeTrackingValue(value = '') {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
        return decodeURIComponent(raw).replace(/\+/g, ' ').trim();
    } catch (_error) {
        return raw;
    }
}

function sanitizeCampaignName(value = '') {
    let text = decodeTrackingValue(value);
    if (!text) return '';

    text = text
        .replace(/^\s*\d{6,}\s*[:|>\-_/]+\s*/i, '')
        .replace(/^\s*(?:campaignid|campanhaid|id)\s*[:#-]?\s*\d{5,}\s*[-:|]\s*/i, '')
        .replace(/\s*[\(\[\{]\s*(?:id[:\s-]*)?\d{5,}\s*[\)\]\}]\s*$/i, '')
        .replace(/\s*(?:\||-|\/|:)\s*(?:id[:\s-]*)?\d{5,}\s*$/i, '')
        .replace(/\s*__\s*(?:id[:\s-]*)?\d{5,}\s*$/i, '')
        .replace(/\s{2,}/g, ' ')
        .trim();

    if (!text || /^\d{5,}$/.test(text)) return '';
    return text;
}

function sanitizeAdsetName(value = '') {
    let text = prettifyTrafficLabel(value);
    if (!text) return '';

    text = text
        .replace(/^\s*\d{6,}\s*[:|>\-_/]+\s*/i, '')
        .replace(/^\s*(?:adsetid|adset_id|conjuntoid|conjunto_id|id)\s*[:#-]?\s*\d{5,}\s*[-:|]\s*/i, '')
        .replace(/\s*[\(\[\{]\s*(?:id[:\s-]*)?\d{5,}\s*[\)\]\}]\s*$/i, '')
        .replace(/\s*(?:\||-|\/|:)\s*(?:id[:\s-]*)?\d{5,}\s*$/i, '')
        .replace(/\s*__\s*(?:id[:\s-]*)?\d{5,}\s*$/i, '')
        .replace(/\s{2,}/g, ' ')
        .trim();

    if (!text || /^\d{5,}$/.test(text)) return '';
    return text;
}

function prettifyTrafficLabel(value = '') {
    const text = decodeTrackingValue(value);
    if (!text) return '';
    return text
        .replace(/[_|]+/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function resolveCampaign(payload = {}) {
    const utm = asObject(payload.utm);
    const rawCampaign = resolveTrackingText(
        payload.campaign,
        payload.campaign_name,
        payload.utm_campaign,
        utm.utm_campaign,
        utm.campaign,
        utm.sck
    );
    return sanitizeCampaignName(rawCampaign);
}

function resolveAdset(payload = {}) {
    const utm = asObject(payload.utm);
    const rawAdset = resolveTrackingText(
        payload.adset,
        payload.adset_name,
        payload.utm_adset,
        payload.utm_content,
        utm.utm_adset,
        utm.adset,
        utm.adset_name,
        utm.utm_content,
        utm.content
    );
    return sanitizeAdsetName(rawAdset);
}

function resolveSource(payload = {}) {
    const utm = asObject(payload.utm);
    const rawSource = resolveTrackingText(
        payload.source,
        payload.utm_source,
        utm.utm_source,
        utm.src
    );
    return prettifyTrafficLabel(rawSource);
}

function toMap(payload = {}) {
    const amount = normalizeAmount(payload.amount || 0);
    const campaign = resolveCampaign(payload);
    const adset = resolveAdset(payload);
    const source = resolveSource(payload);
    return {
        event: String(payload.event || ''),
        txid: String(payload.txid || ''),
        orderId: String(payload.orderId || payload.sessionId || ''),
        amount: formatCurrencyBr(amount),
        amountRaw: String(amount || 0),
        valor: formatCurrencyBr(amount),
        valorRaw: String(amount || 0),
        status: String(payload.status || ''),
        shippingName: String(payload.shippingName || ''),
        cep: String(payload.cep || ''),
        name: String(payload.customerName || payload.name || ''),
        nome: String(payload.customerName || payload.name || ''),
        email: String(payload.customerEmail || payload.email || ''),
        pedido: String(payload.orderId || payload.sessionId || ''),
        campaign,
        campaignName: campaign,
        campanha: campaign,
        adset,
        adsetName: adset,
        conjunto: adset,
        source,
        utmSource: source,
        fonte: source
    };
}

function applyTemplate(template, data = {}) {
    const source = String(template || '');
    if (!source) return '';
    return source.replace(/\{\{?\s*([a-zA-Z0-9_]+)\s*\}?\}/g, (_full, key) => {
        const value = data[key];
        return value === undefined || value === null ? '' : String(value);
    });
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 9000) {
    const controller = new AbortController();
    const timeoutRef = setTimeout(() => controller.abort(), Math.max(1200, Number(timeoutMs || 0) || 9000));
    try {
        return await fetchFn(url, {
            ...options,
            signal: controller.signal
        });
    } finally {
        clearTimeout(timeoutRef);
    }
}

function buildMessage(kind, cfg = {}, payload = {}) {
    const map = toMap(payload);
    const templates = cfg.templates || {};

    const isConfirm = kind === 'pix_confirmed' || kind === 'upsell_pix_confirmed';
    const isUpsell = kind === 'upsell_pix_created' || kind === 'upsell_pix_confirmed';
    const fallbackTitle = isConfirm
        ? (isUpsell ? 'UPSSELL pago - {amount}' : 'PIX pago - {amount}')
        : (isUpsell ? 'UPSSELL gerado - {amount}' : 'PIX gerado - {amount}');
    const fallbackMessage = isConfirm
        ? (isUpsell
            ? 'Upsell confirmado para {name}. Pedido {orderId}.'
            : 'Pagamento confirmado para {name}. Pedido {orderId}.')
        : (isUpsell
            ? 'Novo PIX de upsell para {name}. Pedido {orderId}.'
            : 'Novo PIX gerado para {name}. Pedido {orderId}.');

    const compatCreatedTitle = cfg.pixCreatedTitle || cfg.createdTitle || '';
    const compatCreatedMessage = cfg.pixCreatedMessage || cfg.createdMessage || '';
    const compatConfirmedTitle = cfg.pixConfirmedTitle || cfg.confirmedTitle || '';
    const compatConfirmedMessage = cfg.pixConfirmedMessage || cfg.confirmedMessage || '';

    const titleTemplate = isConfirm
        ? (templates.pixConfirmedTitle || compatConfirmedTitle || fallbackTitle)
        : (templates.pixCreatedTitle || compatCreatedTitle || fallbackTitle);
    const messageTemplate = isConfirm
        ? (templates.pixConfirmedMessage || compatConfirmedMessage || fallbackMessage)
        : (templates.pixCreatedMessage || compatCreatedMessage || fallbackMessage);

    return {
        title: applyTemplate(titleTemplate, map),
        message: applyTemplate(messageTemplate, map)
    };
}

async function sendPushcut(kind, payload = {}) {
    const settings = await getSettings().catch(() => defaultSettings);
    const cfg = settings.pushcut || {};
    const enabled = cfg.enabled !== false;

    if (!enabled) {
        return { ok: false, reason: 'disabled' };
    }

    const url = resolvePushcutUrl(kind, cfg);
    if (!url) {
        return { ok: false, reason: 'missing_url' };
    }

    const msg = buildMessage(kind, cfg, payload);
    const body = {
        event: kind,
        title: msg.title,
        text: msg.message,
        message: msg.message,
        payload
    };
    const timeoutMs = Number(cfg.timeoutMs || process.env.PUSHCUT_TIMEOUT_MS || 9000);

    try {
        const response = await fetchWithTimeout(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        }, timeoutMs);

        if (!response.ok) {
            const detail = await response.text().catch(() => '');
            return {
                ok: false,
                reason: 'pushcut_error',
                sent: 0,
                total: 1,
                results: [{ ok: false, url, reason: 'pushcut_error', detail }]
            };
        }

        return {
            ok: true,
            partial: false,
            sent: 1,
            total: 1,
            results: [{ ok: true, url }]
        };
    } catch (error) {
        return {
            ok: false,
            reason: 'request_error',
            sent: 0,
            total: 1,
            results: [{ ok: false, url, reason: 'request_error', detail: error?.message || String(error) }]
        };
    }
}

module.exports = {
    sendPushcut
};
