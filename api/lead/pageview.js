const { ensurePublicAccess } = require('../../lib/public-access');
const { upsertPageview } = require('../../lib/pageviews-store');
const { enqueueDispatch, processDispatchQueue } = require('../../lib/dispatch-queue');
const { getSettings } = require('../../lib/settings-store');
const { buildPageViewDispatchJobs } = require('../../lib/meta-capi');

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    if (!await ensurePublicAccess(req, res, { requireSession: true })) {
        return;
    }

    let body = {};
    try {
        body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    } catch (_error) {
        res.status(400).json({ ok: false, error: 'JSON invalido.' });
        return;
    }

    const result = await upsertPageview(body.sessionId, body.page);
    if (!result.ok && result.reason === 'missing_supabase_config') {
        res.status(202).json({ ok: false, reason: result.reason });
        return;
    }
    if (!result.ok) {
        res.status(502).json({ ok: false, reason: result.reason, detail: result.detail || '' });
        return;
    }

    let shouldProcessQueue = false;
    const settings = await getSettings().catch(() => ({}));
    const jobs = buildPageViewDispatchJobs(body, req, settings);
    if (jobs.length) {
        const results = await Promise.all(
            jobs.map((job) => enqueueDispatch(job).catch(() => null))
        );
        shouldProcessQueue = results.some((item) => item?.ok || item?.fallback);
    }

    if (shouldProcessQueue) {
        await processDispatchQueue(6).catch(() => null);
    }

    res.status(200).json({ ok: true });
};
