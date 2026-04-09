const { ensurePublicAccess } = require('../../lib/public-access');
const { getSettingsState } = require('../../lib/settings-store');

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'GET') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    if (!await ensurePublicAccess(req, res, { requireSession: false })) {
        return;
    }

    const settingsState = await getSettingsState({ strict: true });
    if (!settingsState?.ok || !settingsState?.settings) {
        res.status(503).json({ error: 'config_unavailable' });
        return;
    }

    const settings = settingsState.settings;
    const pixel = settings.pixel || {};
    const tiktokPixel = settings.tiktokPixel || {};
    const features = settings.features || {};

    res.status(200).json({
        pixel: {
            enabled: !!pixel.enabled,
            id: pixel.id || '',
            backupId: pixel.backupId || '',
            events: pixel.events || {}
        },
        tiktokPixel: {
            enabled: !!tiktokPixel.enabled,
            id: tiktokPixel.id || '',
            events: tiktokPixel.events || {}
        },
        features
    });
};
