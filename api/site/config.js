const { ensureAllowedRequest } = require('../../lib/request-guard');
const { getSettings } = require('../../lib/settings-store');

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'GET') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    if (!ensureAllowedRequest(req, res, { requireSession: false })) {
        return;
    }

    const settings = await getSettings();
    const pixel = settings.pixel || {};
    const features = settings.features || {};

    res.status(200).json({
        pixel: {
            enabled: !!pixel.enabled,
            id: pixel.id || '',
            events: pixel.events || {}
        },
        features
    });
};
