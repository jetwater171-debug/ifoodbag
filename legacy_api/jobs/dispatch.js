const { processDispatchQueue } = require('../../lib/dispatch-queue');

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'GET' && req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    const secret = process.env.DISPATCH_CRON_TOKEN || '';
    const tokenFromQuery = String(req.query?.token || '');
    const tokenFromHeader = String(req.headers['x-dispatch-token'] || '');
    const isVercelCron = String(req.headers['x-vercel-cron'] || '').trim() === '1';

    if (secret && !isVercelCron && tokenFromQuery !== secret && tokenFromHeader !== secret) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    const limit = Math.min(Math.max(Number(req.query?.limit) || 120, 1), 500);
    const result = await processDispatchQueue(limit);

    if (!result?.ok) {
        res.status(502).json({ error: 'Falha ao processar fila.', detail: result });
        return;
    }

    res.status(200).json({ ok: true, ...result });
};
