const crypto = require('crypto');
const { getSettings } = require('../../lib/settings-store');

const fetchFn = (...args) => global.fetch
    ? global.fetch(...args)
    : import('node-fetch').then(({ default: fetch }) => fetch(...args));

function safeEqual(received, expected) {
    const left = Buffer.from(String(received || ''), 'utf8');
    const right = Buffer.from(String(expected || ''), 'utf8');
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function bearerToken(req) {
    const header = String(req.headers?.authorization || '').trim();
    return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
}

function callbackItems(body) {
    if (Array.isArray(body)) return body;
    if (Array.isArray(body?.events)) return body.events;
    if (Array.isArray(body?.messages)) return body.messages;
    if (Array.isArray(body?.data)) return body.data;
    return body && typeof body === 'object' ? [body] : [];
}

function eventName(item = {}) {
    const type = String(item.event || item.type || item.event_type || '').toLowerCase();
    if (type.includes('response') || type.includes('reply') || type.includes('mo')) return 'mo';
    if (item.delivery || item.entrega || item.status || item.entrega_voz) return 'dlr';
    return 'callback';
}

async function persistEvents(items) {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.SUPABASE_PROJECT_URL || '';
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || '';
    const table = process.env.SUPABASE_DISPATCH_TABLE || 'event_dispatch_queue';
    if (!supabaseUrl || !serviceKey || !items.length) return false;

    const createdAt = new Date().toISOString();
    const rows = items.map((item) => {
        const payload = item && typeof item === 'object' ? item : { value: item };
        const digest = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 32);
        return {
            channel: 'smsmais_webhook',
            event_name: eventName(payload),
            kind: 'callback',
            payload,
            dedupe_key: `smsmais:webhook:${digest}`,
            status: 'done',
            attempts: 1,
            scheduled_at: createdAt,
            processed_at: createdAt,
            created_at: createdAt,
            updated_at: createdAt,
            last_error: null
        };
    });

    const url = new URL(`${supabaseUrl}/rest/v1/${table}`);
    url.searchParams.set('on_conflict', 'dedupe_key');
    const response = await fetchFn(url.toString(), {
        method: 'POST',
        headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
            Prefer: 'resolution=ignore-duplicates,return=minimal'
        },
        body: JSON.stringify(rows)
    });
    return response.ok;
}

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    const settings = await getSettings().catch(() => ({}));
    const config = settings?.smsmais || {};
    const expectedToken = String(config.webhookToken || '').trim();
    if (expectedToken && !safeEqual(bearerToken(req), expectedToken)) {
        res.status(401).json({ error: 'Webhook nao autorizado.' });
        return;
    }

    let body = {};
    try {
        body = typeof req.body === 'string'
            ? JSON.parse(req.body || '{}')
            : (req.body || {});
    } catch (_error) {
        res.status(400).json({ error: 'JSON invalido.' });
        return;
    }
    const items = callbackItems(body).slice(0, 1000);
    const stored = await persistEvents(items).catch(() => false);

    res.status(200).json({ ok: true, received: items.length, stored });
};

module.exports._internals = { callbackItems, eventName, bearerToken, safeEqual };
