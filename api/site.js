const siteSessionHandler = require('../lib/site-session-handler');
const siteConfigHandler = require('../lib/site-config-handler');

module.exports = async (req, res) => {
    const requestUrl = new URL(req.url || '/', 'http://localhost');
    const handler = requestUrl.searchParams.get('handler');

    if (handler === 'session') {
        return siteSessionHandler(req, res);
    }
    if (handler === 'config') {
        return siteConfigHandler(req, res);
    }

    return res.status(404).json({ error: 'Not found' });
};
