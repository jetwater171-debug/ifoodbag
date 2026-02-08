const fetchFn = global.fetch
    ? global.fetch.bind(global)
    : (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.SUPABASE_PROJECT_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || '';
const SUPABASE_LEADS_TABLE = process.env.SUPABASE_LEADS_TABLE || 'leads';

function toText(value, maxLen = 255) {
    const txt = String(value || '').trim();
    if (!txt) return null;
    return txt.length > maxLen ? txt.slice(0, maxLen) : txt;
}

function toDigits(value, maxLen = 32) {
    const txt = String(value || '').replace(/\D/g, '');
    if (!txt) return null;
    return txt.length > maxLen ? txt.slice(0, maxLen) : txt;
}

function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function toBoolean(value) {
    return value === true || value === 'true' || value === 1 || value === '1';
}

function ensureSessionId(input) {
    const provided =
        input?.sessionId ||
        input?.session_id ||
        input?.leadSession ||
        input?.lead_session ||
        null;

    return toText(provided, 80);
}

function hasMeaningfulLeadData(record) {
    return Boolean(
        record.name ||
        record.cpf ||
        record.email ||
        record.phone ||
        record.cep ||
        record.address_line ||
        record.shipping_id ||
        record.pix_txid ||
        record.pix_amount
    );
}

function buildLeadRecord(input = {}, req = null) {
    const nowIso = new Date().toISOString();
    const personal = input.personal && typeof input.personal === 'object' ? input.personal : {};
    const address = input.address && typeof input.address === 'object' ? input.address : {};
    const extra = input.extra && typeof input.extra === 'object' ? input.extra : {};
    const shipping = input.shipping && typeof input.shipping === 'object' ? input.shipping : {};
    const bump = input.bump && typeof input.bump === 'object' ? input.bump : {};
    const pix = input.pix && typeof input.pix === 'object' ? input.pix : {};
    const utm = input.utm && typeof input.utm === 'object' ? input.utm : {};

    const street = toText(address.street || address.streetLine || '', 240);
    const cityLine = toText(address.cityLine || '', 140);
    const city = toText(address.city || cityLine.split('-')[0] || '', 100);
    const state = toText(address.state || cityLine.split('-')[1] || '', 20);

    const forwardedFor = req?.headers?.['x-forwarded-for'];
    const clientIp = typeof forwardedFor === 'string' && forwardedFor
        ? forwardedFor.split(',')[0].trim()
        : req?.socket?.remoteAddress || '';

    return {
        session_id: ensureSessionId(input),
        stage: toText(input.stage, 60),
        last_event: toText(input.event || input.lastEvent, 80),
        name: toText(personal.name, 160),
        cpf: toDigits(personal.cpf, 14),
        email: toText(personal.email, 180),
        phone: toDigits(personal.phoneDigits || personal.phone, 20),
        cep: toDigits(address.cep, 10),
        address_line: toText(street, 240),
        number: toText(extra.number, 40),
        complement: toText(extra.complement, 120),
        neighborhood: toText(address.neighborhood, 120),
        city,
        state,
        reference: toText(extra.reference, 140),
        shipping_id: toText(shipping.id, 40),
        shipping_name: toText(shipping.name, 120),
        shipping_price: toNumber(shipping.price),
        bump_selected: toBoolean(input.bumpSelected ?? bump.selected ?? bump.price),
        bump_price: toNumber(input.bumpPrice ?? bump.price),
        pix_txid: toText(input.pixTxid || pix.idTransaction, 120),
        pix_amount: toNumber(input.pixAmount || pix.amount || input.amount),
        utm_source: toText(utm.utm_source || input.utm_source, 120),
        utm_medium: toText(utm.utm_medium || input.utm_medium, 120),
        utm_campaign: toText(utm.utm_campaign || input.utm_campaign, 120),
        utm_term: toText(utm.utm_term || input.utm_term, 120),
        utm_content: toText(utm.utm_content || input.utm_content, 120),
        gclid: toText(utm.gclid || input.gclid, 120),
        fbclid: toText(utm.fbclid || input.fbclid, 120),
        ttclid: toText(utm.ttclid || input.ttclid, 120),
        referrer: toText(utm.referrer || input.referrer, 240),
        landing_page: toText(utm.landing_page || input.landing_page, 240),
        source_url: toText(input.sourceUrl, 300),
        user_agent: toText(req?.headers?.['user-agent'] || input.userAgent, 300),
        client_ip: toText(clientIp || input.clientIp, 80),
        updated_at: nowIso,
        payload: input
    };
}

async function upsertLead(input = {}, req = null) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return { ok: false, reason: 'missing_supabase_config' };
    }

    const record = buildLeadRecord(input, req);
    if (!record.session_id) {
        return { ok: false, reason: 'missing_session_id' };
    }
    if (!hasMeaningfulLeadData(record)) {
        return { ok: false, reason: 'skipped_no_data' };
    }

    const endpoint = `${SUPABASE_URL}/rest/v1/${SUPABASE_LEADS_TABLE}?on_conflict=session_id`;

    const response = await fetchFn(endpoint, {
        method: 'POST',
        headers: {
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify([record])
    });

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        return {
            ok: false,
            reason: 'supabase_error',
            status: response.status,
            detail
        };
    }

    return { ok: true };
}

module.exports = {
    upsertLead
};
