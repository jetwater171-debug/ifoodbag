const { issueSessionCookie } = require('./request-guard');
const { ensurePublicAccess } = require('./public-access');

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'GET' && req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    if (!await ensurePublicAccess(req, res, { requireSession: false })) {
        return;
    }

    issueSessionCookie(req, res);
    res.status(200).json({ ok: true });
};
