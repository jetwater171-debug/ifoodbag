const crypto = require('crypto');

const ADMIN_COOKIE = '__Host-ifb_admin';
const ADMIN_TTL_SEC = Number(process.env.APP_ADMIN_TTL_SEC || 60 * 60 * 8);
const GUARD_SECRET = process.env.APP_GUARD_SECRET || 'change-this-secret-in-production';
const ADMIN_PASSWORD_FALLBACK = (process.env.APP_ADMIN_PASSWORD_FALLBACK || 'Leo12345!').trim();

function getAdminPassword() {
    return (
        process.env.APP_ADMIN_PASSWORD ||
        process.env.ADMIN_PASSWORD ||
        process.env.ADMIN_PASS ||
        ADMIN_PASSWORD_FALLBACK ||
        ''
    ).trim();
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

function toBase64Url(input) {
    return Buffer.from(input).toString('base64url');
}

function fromBase64Url(input) {
    return Buffer.from(String(input || ''), 'base64url').toString('utf8');
}

function sign(input) {
    return crypto.createHmac('sha256', GUARD_SECRET).update(input).digest('base64url');
}

function verifyAdminPassword(password) {
    const adminPassword = getAdminPassword();
    if (!adminPassword) return false;
    const a = Buffer.from(String(password || '').trim(), 'utf8');
    const b = Buffer.from(String(adminPassword || ''), 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

function issueAdminCookie(res) {
    const payload = { t: Date.now() };
    const encodedPayload = toBase64Url(JSON.stringify(payload));
    const signature = sign(encodedPayload);
    const token = `${encodedPayload}.${signature}`;

    const secure = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
    const cookie = `${ADMIN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ADMIN_TTL_SEC}${secure ? '; Secure' : ''}`;
    res.setHeader('Set-Cookie', cookie);
    return token;
}

function clearAdminCookie(res) {
    res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

function verifyAdminCookie(req) {
    const cookies = parseCookies(req.headers.cookie || '');
    const token = cookies[ADMIN_COOKIE] || '';
    if (!token || !token.includes('.')) return false;

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

    const issuedAt = Number(payload.t || 0);
    if (!issuedAt || Number.isNaN(issuedAt)) return false;
    if (Date.now() - issuedAt > ADMIN_TTL_SEC * 1000) return false;

    return true;
}

function requireAdmin(req, res) {
    if (!verifyAdminCookie(req)) {
        res.status(401).json({ error: 'Nao autorizado.' });
        return false;
    }
    return true;
}

module.exports = {
    verifyAdminPassword,
    issueAdminCookie,
    clearAdminCookie,
    verifyAdminCookie,
    requireAdmin
};
