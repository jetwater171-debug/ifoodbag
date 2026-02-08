const { ensureAllowedRequest } = require('../../lib/request-guard');
const { verifyAdminCookie } = require('../../lib/admin-auth');

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'GET') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    if (!ensureAllowedRequest(req, res, { requireSession: false })) {
        return;
    }

    if (!verifyAdminCookie(req)) {
        res.status(401).json({ ok: false });
        return;
    }

    res.status(200).json({ ok: true });
};