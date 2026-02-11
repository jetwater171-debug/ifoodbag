const fetchFn = global.fetch
    ? global.fetch.bind(global)
    : (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const { getSettings } = require('./settings-store');

function uniqueUrls(input = []) {
    const seen = new Set();
    const out = [];
    for (const raw of input) {
        const url = String(raw || '').trim();
        if (!url || seen.has(url)) continue;
        seen.add(url);
        out.push(url);
    }
    return out;
}

function resolvePushcutUrls(kind, cfg = {}) {
    if (kind === 'pix_created' || kind === 'upsell_pix_created') {
        return uniqueUrls([
            ...(Array.isArray(cfg.pixCreatedUrls) ? cfg.pixCreatedUrls : []),
            cfg.pixCreatedUrl,
            cfg.pixCreatedUrl2
        ]).slice(0, 2);
    }
    if (kind === 'pix_confirmed' || kind === 'upsell_pix_confirmed') {
        return uniqueUrls([
            ...(Array.isArray(cfg.pixConfirmedUrls) ? cfg.pixConfirmedUrls : []),
            cfg.pixConfirmedUrl,
            cfg.pixConfirmedUrl2
        ]).slice(0, 2);
    }
    return [];
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

function toMap(payload = {}) {
    const amount = normalizeAmount(payload.amount || 0);
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
        pedido: String(payload.orderId || payload.sessionId || '')
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
    const settings = await getSettings();
    const cfg = settings.pushcut || {};
    const enabled = cfg.enabled !== false;

    if (!enabled) {
        return { ok: false, reason: 'disabled' };
    }

    const urls = resolvePushcutUrls(kind, cfg);
    if (!urls.length) {
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

    const results = await Promise.all(urls.map(async (url) => {
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
                return { ok: false, url, reason: 'pushcut_error', detail };
            }

            return { ok: true, url };
        } catch (error) {
            return { ok: false, url, reason: 'request_error', detail: error?.message || String(error) };
        }
    }));

    const succeeded = results.filter((item) => item.ok).length;
    const failed = results.length - succeeded;
    if (!succeeded) {
        return {
            ok: false,
            reason: 'pushcut_error',
            results
        };
    }

    return {
        ok: true,
        partial: failed > 0,
        sent: succeeded,
        total: results.length,
        results
    };
}

module.exports = {
    sendPushcut
};
