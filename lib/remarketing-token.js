const crypto = require('crypto');

const DEFAULT_TTL_SEC = Number(process.env.REMARKETING_LINK_TTL_SEC || 60 * 60 * 24 * 7);

function getTokenKey() {
    const secret = String(process.env.REMARKETING_TOKEN_SECRET || process.env.APP_GUARD_SECRET || '').trim();
    if (!secret) throw new Error('missing_remarketing_token_secret');
    return crypto.createHash('sha256').update(secret).digest();
}

function issueRecoveryToken({ sessionId = '', txid = '', originalAmount = 0, discountPercent = 20, ttlSec = DEFAULT_TTL_SEC } = {}) {
    const cleanSessionId = String(sessionId || '').trim();
    const cleanTxid = String(txid || '').trim();
    const amount = Number(originalAmount);
    const discount = Number(discountPercent);
    if (!cleanSessionId || !cleanTxid || !Number.isFinite(amount) || amount <= 0) {
        throw new Error('invalid_recovery_token_payload');
    }
    if (!Number.isFinite(discount) || discount <= 0 || discount >= 100) {
        throw new Error('invalid_recovery_discount');
    }

    const now = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({
        sid: cleanSessionId,
        txid: cleanTxid,
        amount: Number(amount.toFixed(2)),
        discount: Number(discount.toFixed(2)),
        iat: now,
        exp: now + Math.max(300, Number(ttlSec || DEFAULT_TTL_SEC))
    });
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', getTokenKey(), iv);
    const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv.toString('base64url'), encrypted.toString('base64url'), tag.toString('base64url')].join('.');
}

function verifyRecoveryToken(token = '') {
    try {
        const [version, ivText, encryptedText, tagText] = String(token || '').trim().split('.');
        if (version !== 'v1' || !ivText || !encryptedText || !tagText) return null;
        const iv = Buffer.from(ivText, 'base64url');
        const encrypted = Buffer.from(encryptedText, 'base64url');
        const tag = Buffer.from(tagText, 'base64url');
        if (
            iv.toString('base64url') !== ivText ||
            encrypted.toString('base64url') !== encryptedText ||
            tag.toString('base64url') !== tagText
        ) return null;
        const decipher = crypto.createDecipheriv('aes-256-gcm', getTokenKey(), iv);
        decipher.setAuthTag(tag);
        const decrypted = Buffer.concat([
            decipher.update(encrypted),
            decipher.final()
        ]).toString('utf8');
        const payload = JSON.parse(decrypted);
        const now = Math.floor(Date.now() / 1000);
        const sessionId = String(payload?.sid || '').trim();
        const txid = String(payload?.txid || '').trim();
        const originalAmount = Number(payload?.amount);
        const discountPercent = Number(payload?.discount);
        const expiresAt = Number(payload?.exp || 0);
        if (!sessionId || !txid || !Number.isFinite(originalAmount) || originalAmount <= 0) return null;
        if (!Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent >= 100) return null;
        if (!expiresAt || expiresAt <= now) return null;
        return {
            sessionId,
            txid,
            originalAmount: Number(originalAmount.toFixed(2)),
            discountPercent: Number(discountPercent.toFixed(2)),
            issuedAt: Number(payload?.iat || 0),
            expiresAt
        };
    } catch (_error) {
        return null;
    }
}

function issueRecoveryProof(token = '') {
    const cleanToken = String(token || '').trim();
    if (!cleanToken) throw new Error('missing_recovery_token');
    return crypto.createHmac('sha256', getTokenKey()).update(`recovery-create:${cleanToken}`).digest('base64url');
}

function verifyRecoveryProof(token = '', proof = '') {
    try {
        const expected = Buffer.from(issueRecoveryProof(token));
        const received = Buffer.from(String(proof || '').trim());
        return expected.length === received.length && crypto.timingSafeEqual(expected, received);
    } catch (_error) {
        return false;
    }
}

module.exports = {
    DEFAULT_TTL_SEC,
    issueRecoveryToken,
    verifyRecoveryToken,
    issueRecoveryProof,
    verifyRecoveryProof
};
