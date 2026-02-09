const { ensureAllowedRequest } = require('../../lib/request-guard');
const { requireAdmin } = require('../../lib/admin-auth');
const { getSettings, saveSettings, defaultSettings } = require('../../lib/settings-store');

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    if (!ensureAllowedRequest(req, res, { requireSession: false })) {
        return;
    }

    if (req.method === 'GET') {
        if (!requireAdmin(req, res)) return;
        const settings = await getSettings();
        res.status(200).json(settings);
        return;
    }

    if (req.method === 'POST') {
        if (!requireAdmin(req, res)) return;

        let body = {};
        try {
            body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
        } catch (_error) {
            res.status(400).json({ error: 'JSON invalido.' });
            return;
        }

        const payload = {
            ...defaultSettings,
            ...body,
            pixel: {
                ...defaultSettings.pixel,
                ...(body.pixel || {})
            },
            utmfy: {
                ...defaultSettings.utmfy,
                ...(body.utmfy || {})
            },
            features: {
                ...defaultSettings.features,
                ...(body.features || {})
            }
        };

        const result = await saveSettings(payload);
        if (!result.ok) {
            res.status(502).json({ error: 'Falha ao salvar configuracao.' });
            return;
        }

        res.status(200).json({ ok: true });
        return;
    }

    res.status(405).json({ error: 'Method not allowed' });
};
