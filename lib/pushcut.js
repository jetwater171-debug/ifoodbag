const fetchFn = global.fetch
    ? global.fetch.bind(global)
    : (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const { getSettings } = require('./settings-store');

function resolvePushcutUrl(kind, cfg = {}) {
    if (kind === 'pix_created') return String(cfg.pixCreatedUrl || '').trim();
    if (kind === 'pix_confirmed') return String(cfg.pixConfirmedUrl || '').trim();
    return '';
}

function formatCurrencyBr(value) {
    const amount = Number(value || 0);
    return amount.toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    });
}

function toMap(payload = {}) {
    const amount = Number(payload.amount || 0);
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

function buildMessage(kind, cfg = {}, payload = {}) {
    const map = toMap(payload);
    const templates = cfg.templates || {};

    const fallbackTitle = kind === 'pix_confirmed'
        ? 'PIX pago - {amount}'
        : 'PIX gerado - {amount}';
    const fallbackMessage = kind === 'pix_confirmed'
        ? 'Pagamento confirmado para {name}. Pedido {orderId}.'
        : 'Novo PIX gerado para {name}. Pedido {orderId}.';

    const compatCreatedTitle = cfg.pixCreatedTitle || cfg.createdTitle || '';
    const compatCreatedMessage = cfg.pixCreatedMessage || cfg.createdMessage || '';
    const compatConfirmedTitle = cfg.pixConfirmedTitle || cfg.confirmedTitle || '';
    const compatConfirmedMessage = cfg.pixConfirmedMessage || cfg.confirmedMessage || '';

    const titleTemplate = kind === 'pix_confirmed'
        ? (templates.pixConfirmedTitle || compatConfirmedTitle || fallbackTitle)
        : (templates.pixCreatedTitle || compatCreatedTitle || fallbackTitle);
    const messageTemplate = kind === 'pix_confirmed'
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

    const response = await fetchFn(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        return { ok: false, reason: 'pushcut_error', detail };
    }

    return { ok: true };
}

module.exports = {
    sendPushcut
};
