const net = require('net');

const fetchFn = global.fetch
    ? global.fetch.bind(global)
    : (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.SUPABASE_PROJECT_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || '';
const SETTINGS_TABLE = process.env.SUPABASE_SETTINGS_TABLE || 'app_settings';
const BLACKLIST_KEY = 'security_ip_blacklist';
const CACHE_TTL_MS = 10 * 1000;

const CACHE = {
    entries: [],
    fetchedAt: 0
};

function pickHeader(headers, key) {
    const value = headers?.[key];
    if (Array.isArray(value)) return value[0] || '';
    return value || '';
}

function normalizeClientIp(value = '') {
    let text = String(value || '').trim().toLowerCase();
    if (!text) return '';

    if (text.includes(',')) {
        text = text.split(',')[0].trim();
    }
    if (text.startsWith('for=')) {
        text = text.slice(4).trim();
    }
    text = text.replace(/^"+|"+$/g, '').replace(/^\[|\]$/g, '');

    if (text.startsWith('::ffff:')) {
        text = text.slice(7);
    }
    if (text === '::1') {
        text = '127.0.0.1';
    }
    if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(text)) {
        text = text.replace(/:\d+$/, '');
    }

    return net.isIP(text) ? text : '';
}

function extractClientIp(req = {}) {
    const headers = req?.headers || {};
    return normalizeClientIp(
        pickHeader(headers, 'x-forwarded-for') ||
        pickHeader(headers, 'cf-connecting-ip') ||
        pickHeader(headers, 'x-real-ip') ||
        req?.ip ||
        req?.socket?.remoteAddress ||
        ''
    );
}

function toText(value = '', maxLen = 255) {
    const text = String(value || '').trim();
    if (!text) return '';
    return text.length > maxLen ? text.slice(0, maxLen) : text;
}

function toIso(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString();
}

function normalizeBlacklistEntry(entry = {}) {
    const ip = normalizeClientIp(entry.ip);
    if (!ip) return null;

    const snapshot = entry.lead && typeof entry.lead === 'object' ? entry.lead : {};
    return {
        ip,
        reason: toText(entry.reason || 'Bloqueio manual via admin', 240),
        blockedAt: toIso(entry.blockedAt) || new Date().toISOString(),
        sessionId: toText(entry.sessionId || snapshot.sessionId, 120),
        lead: {
            sessionId: toText(snapshot.sessionId || entry.sessionId, 120),
            name: toText(snapshot.name, 180),
            email: toText(snapshot.email, 180),
            cpf: toText(snapshot.cpf, 32),
            phone: toText(snapshot.phone, 40),
            city: toText(snapshot.city, 120),
            state: toText(snapshot.state, 32),
            shippingName: toText(snapshot.shippingName, 180),
            rewardName: toText(snapshot.rewardName, 180),
            txid: toText(snapshot.txid, 160)
        }
    };
}

function normalizeBlacklistEntries(entries = []) {
    const map = new Map();
    (Array.isArray(entries) ? entries : []).forEach((entry) => {
        const normalized = normalizeBlacklistEntry(entry);
        if (!normalized) return;
        map.set(normalized.ip, normalized);
    });

    return Array.from(map.values()).sort((a, b) => {
        const aTime = Date.parse(a.blockedAt || '') || 0;
        const bTime = Date.parse(b.blockedAt || '') || 0;
        return bTime - aTime;
    });
}

function supabaseHeaders() {
    return {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json'
    };
}

async function readBlacklistRow() {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return { ok: false, reason: 'missing_supabase_config', entries: [] };
    }

    const url = `${SUPABASE_URL}/rest/v1/${SETTINGS_TABLE}?key=eq.${encodeURIComponent(BLACKLIST_KEY)}&select=key,value,updated_at`;
    let response;
    try {
        response = await fetchFn(url, { headers: supabaseHeaders() });
    } catch (error) {
        return {
            ok: false,
            reason: 'network_error',
            detail: error?.message || String(error),
            entries: []
        };
    }
    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        return { ok: false, reason: 'supabase_error', detail, entries: [] };
    }

    const rows = await response.json().catch(() => []);
    const row = Array.isArray(rows) ? rows[0] : null;
    const rawValue = row?.value;
    const rawEntries = Array.isArray(rawValue)
        ? rawValue
        : Array.isArray(rawValue?.entries)
            ? rawValue.entries
            : [];

    return {
        ok: true,
        entries: normalizeBlacklistEntries(rawEntries),
        updatedAt: toIso(row?.updated_at) || ''
    };
}

async function getIpBlacklist(options = {}) {
    const force = options?.force === true;
    if (!force && CACHE.fetchedAt && Date.now() - CACHE.fetchedAt < CACHE_TTL_MS) {
        return { ok: true, entries: CACHE.entries };
    }

    const result = await readBlacklistRow();
    if (!result.ok) {
        if (result.reason === 'missing_supabase_config') {
            CACHE.entries = [];
            CACHE.fetchedAt = Date.now();
            return { ok: true, entries: [] };
        }
        return result;
    }

    CACHE.entries = result.entries || [];
    CACHE.fetchedAt = Date.now();
    return { ok: true, entries: CACHE.entries };
}

async function writeIpBlacklist(entries = []) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return { ok: false, reason: 'missing_supabase_config' };
    }

    const nextEntries = normalizeBlacklistEntries(entries);
    const payload = {
        key: BLACKLIST_KEY,
        value: { entries: nextEntries },
        updated_at: new Date().toISOString()
    };

    const url = `${SUPABASE_URL}/rest/v1/${SETTINGS_TABLE}`;
    let response;
    try {
        response = await fetchFn(url, {
            method: 'POST',
            headers: {
                ...supabaseHeaders(),
                Prefer: 'resolution=merge-duplicates,return=representation'
            },
            body: JSON.stringify([payload])
        });
    } catch (error) {
        return {
            ok: false,
            reason: 'network_error',
            detail: error?.message || String(error)
        };
    }

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        return { ok: false, reason: 'supabase_error', detail };
    }

    CACHE.entries = nextEntries;
    CACHE.fetchedAt = Date.now();
    return { ok: true, entries: nextEntries };
}

async function findBlockedIp(ipOrReq) {
    const ip = typeof ipOrReq === 'object'
        ? extractClientIp(ipOrReq)
        : normalizeClientIp(ipOrReq);

    if (!ip) {
        return { ok: true, blocked: false, ip: '', entry: null };
    }

    const result = await getIpBlacklist();
    if (!result.ok) {
        return { ...result, blocked: false, ip, entry: null };
    }

    const entry = (result.entries || []).find((item) => item.ip === ip) || null;
    return { ok: true, blocked: !!entry, ip, entry };
}

async function addBlockedIp(input = {}) {
    const candidate = normalizeBlacklistEntry(input);
    if (!candidate?.ip) {
        return { ok: false, reason: 'missing_ip' };
    }

    const current = await getIpBlacklist({ force: true });
    if (!current.ok) return current;

    const existing = (current.entries || []).filter((entry) => entry.ip !== candidate.ip);
    return writeIpBlacklist([candidate, ...existing]);
}

async function removeBlockedIp(ip) {
    const normalizedIp = normalizeClientIp(ip);
    if (!normalizedIp) {
        return { ok: false, reason: 'missing_ip' };
    }

    const current = await getIpBlacklist({ force: true });
    if (!current.ok) return current;

    const nextEntries = (current.entries || []).filter((entry) => entry.ip !== normalizedIp);
    return writeIpBlacklist(nextEntries);
}

module.exports = {
    normalizeClientIp,
    extractClientIp,
    getIpBlacklist,
    findBlockedIp,
    addBlockedIp,
    removeBlockedIp
};
