const crypto = require('crypto');

const fetchFn = global.fetch
    ? global.fetch.bind(global)
    : (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const { getSettings } = require('./settings-store');

function sha256(value) {
    return crypto.createHash('sha256').update(String(value || '').trim().toLowerCase()).digest('hex');
}

function sanitizeDigits(value) {
    return String(value || '').replace(/\D/g, '');
}

async function sendPixelServerEvent(eventName, payload = {}, req = null) {
    const settings = await getSettings();
    const pixel = settings.pixel || {};
    const capi = pixel.capi || {};
    const events = pixel.events || {};

    if (!pixel.enabled || !pixel.id || !capi.enabled || !capi.accessToken || events.purchase === false) {
        return { ok: false, reason: 'disabled' };
    }

    const email = payload?.personal?.email || payload?.client_email || payload?.clientEmail || '';
    const phone = payload?.personal?.phone || payload?.phone || '';
    const cpf = payload?.personal?.cpf || payload?.client_document || '';
    const amount = Number(payload?.amount || payload?.pixAmount || payload?.valor || 0);

    const userData = {};
    if (email) userData.em = [sha256(email)];
    if (phone) userData.ph = [sha256(sanitizeDigits(phone))];
    if (cpf) userData.external_id = [sha256(sanitizeDigits(cpf))];

    const forwarded = req?.headers?.['x-forwarded-for'];
    const clientIp = typeof forwarded === 'string' && forwarded
        ? forwarded.split(',')[0].trim()
        : req?.socket?.remoteAddress || '';

    if (clientIp) userData.client_ip_address = clientIp;
    if (req?.headers?.['user-agent']) userData.client_user_agent = req.headers['user-agent'];

    const eventData = {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        action_source: 'website',
        user_data: userData,
        custom_data: {
            currency: 'BRL',
            value: Number.isFinite(amount) ? amount : 0
        }
    };

    const endpoint = `https://graph.facebook.com/v20.0/${encodeURIComponent(pixel.id)}/events?access_token=${encodeURIComponent(capi.accessToken)}`;
    const body = {
        data: [eventData]
    };
    if (capi.testEventCode) {
        body.test_event_code = String(capi.testEventCode).trim();
    }

    const response = await fetchFn(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        return { ok: false, reason: 'pixel_capi_error', detail };
    }

    return { ok: true };
}

module.exports = {
    sendPixelServerEvent
};
