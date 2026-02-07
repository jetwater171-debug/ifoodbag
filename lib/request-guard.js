const crypto = require('crypto');

const SESSION_COOKIE = '__Host-ifb_session';
const SESSION_TTL_SEC = Number(process.env.APP_SESSION_TTL_SEC || 60 * 60 * 3);
const GUARD_SECRET = process.env.APP_GUARD_SECRET || 'change-this-secret-in-production';

function parseList(value) {
    return String(value || '')
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
}

function normalizeHost(rawHost) {
    const host = String(rawHost || '').trim().toLowerCase();
    if (!host) return '';
    return host.split(':')[0];
}

function toBase64Url(input) {
    return Buffer.from(input).toString('base64url');
}

function fromBase64Url(input) {
    return Buffer.from(String(input || ''), 'base64url').toString('utf8');
}

function matchesRule(value, rule) {
    if (!value || !rule) return false;
    const normalizedValue = String(value).toLowerCase();
    const normalizedRule = String(rule).toLowerCase();

    if (normalizedRule.startsWith('*.')) {
        const suffix = normalizedRule.slice(1);
        return normalizedValue.endsWith(suffix);
    }

    return normalizedValue === normalizedRule;
}

function isAllowedHost(host) {
    const allowedHosts = parseList(process.env.APP_ALLOWED_HOSTS);
    if (!host) return false;
    if (allowedHosts.length === 0) return true;
    return allowedHosts.some((rule) => matchesRule(host, normalizeHost(rule)));
}

function isAllowedOrigin(origin, host) {
    if (!origin) return true;

    const allowedOrigins = parseList(process.env.APP_ALLOWED_ORIGINS);
    let originUrl;

    try {
        originUrl = new URL(origin);
    } catch (_error) {
        return false;
    }

    const fullOrigin = `${originUrl.protocol}//${originUrl.host}`.toLowerCase();
    const originHost = normalizeHost(originUrl.host);

    if (allowedOrigins.length > 0) {
        return allowedOrigins.some((rule) => {
            if (rule.startsWith('http://') || rule.startsWith('https://')) {
                return matchesRule(fullOrigin, rule);
            }
            return matchesRule(originHost, normalizeHost(rule));
        });
    }

    return originHost === host;
}

function parseCookies(rawCookie) {
    const out = {};
    String(rawCookie || '')
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .forEach((part) => {
            const idx = part.indexOf('=');
            if (idx <= 0) return;
            const key = decodeURIComponent(part.slice(0, idx));
            const value = decodeURIComponent(part.slice(idx + 1));
            out[key] = value;
        });
    return out;
}

function uaHash(req) {
    const ua = String(req?.headers?.['user-agent'] || '').slice(0, 250);
    return crypto.createHash('sha256').update(ua).digest('hex').slice(0, 32);
}

function sign(input) {
    return crypto.createHmac('sha256', GUARD_SECRET).update(input).digest('base64url');
}

function issueSessionCookie(req, res) {
    const host = normalizeHost(req.headers['x-forwarded-host'] || req.headers.host);
    const payload = {
        h: host,
        ua: uaHash(req),
        t: Date.now()
    };

    const encodedPayload = toBase64Url(JSON.stringify(payload));
    const signature = sign(encodedPayload);
    const token = `${encodedPayload}.${signature}`;

    const secure = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
    const cookie = `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SEC}${secure ? '; Secure' : ''}`;
    res.setHeader('Set-Cookie', cookie);

    return token;
}

function verifySessionToken(req, token) {
    if (!token || typeof token !== 'string' || !token.includes('.')) {
        return false;
    }

    const [encodedPayload, signature] = token.split('.');
    const expected = sign(encodedPayload);

    const receivedBuf = Buffer.from(signature || '', 'utf8');
    const expectedBuf = Buffer.from(expected || '', 'utf8');
    if (receivedBuf.length !== expectedBuf.length) return false;
    if (!crypto.timingSafeEqual(receivedBuf, expectedBuf)) return false;

    let payload;
    try {
        payload = JSON.parse(fromBase64Url(encodedPayload));
    } catch (_error) {
        return false;
    }

    const host = normalizeHost(req.headers['x-forwarded-host'] || req.headers.host);
    if (!payload || payload.h !== host) return false;

    const expectedUa = uaHash(req);
    if (payload.ua !== expectedUa) return false;

    const issuedAt = Number(payload.t || 0);
    if (!issuedAt || Number.isNaN(issuedAt)) return false;

    const maxAgeMs = SESSION_TTL_SEC * 1000;
    if (Date.now() - issuedAt > maxAgeMs) return false;

    return true;
}

function ensureAllowedRequest(req, res, options = {}) {
    const { requireSession = false } = options;

    const host = normalizeHost(req.headers['x-forwarded-host'] || req.headers.host);
    if (!isAllowedHost(host)) {
        res.status(403).json({ error: 'Host não permitido.' });
        return false;
    }

    if (!isAllowedOrigin(req.headers.origin, host)) {
        res.status(403).json({ error: 'Origem não permitida.' });
        return false;
    }

    if (requireSession) {
        const cookies = parseCookies(req.headers.cookie || '');
        const sessionToken = cookies[SESSION_COOKIE] || '';
        if (!verifySessionToken(req, sessionToken)) {
            res.status(401).json({ error: 'Sessão inválida. Recarregue a página.' });
            return false;
        }
    }

    return true;
}

module.exports = {
    ensureAllowedRequest,
    issueSessionCookie
};