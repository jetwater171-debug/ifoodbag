const { ensureAllowedRequest, issueSessionCookie } = require('../../lib/request-guard');

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'GET' && req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    if (!ensureAllowedRequest(req, res, { requireSession: false })) {
        return;
    }

    issueSessionCookie(req, res);
    res.status(200).json({ ok: true });
};