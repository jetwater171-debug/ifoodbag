const { upsertLead } = require('../../lib/lead-store');
const { ensurePublicAccess } = require('../../lib/public-access');
const { getSettings } = require('../../lib/settings-store');
const { enqueueDispatch, processDispatchQueue } = require('../../lib/dispatch-queue');
const { buildLeadTrackDispatchJobs } = require('../../lib/meta-capi');

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    try {
        if (!await ensurePublicAccess(req, res, { requireSession: true })) {
            return;
        }
    } catch (error) {
        console.error('[lead-track] public access failed', error);
        res.status(202).json({ ok: false, reason: 'public_access_error' });
        return;
    }

    let body = {};
    try {
        body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    } catch (error) {
        res.status(400).json({ ok: false, error: 'Invalid JSON body' });
        return;
    }

    try {
        const result = await upsertLead(body, req).catch((error) => ({
            ok: false,
            reason: 'lead_store_error',
            detail: error?.message || String(error)
        }));
        let shouldProcessQueue = false;
        const settings = await getSettings().catch(() => ({}));
        const jobs = buildLeadTrackDispatchJobs(body, req, settings);
        if (jobs.length) {
            const queueResults = await Promise.all(
                jobs.map((job) => enqueueDispatch(job).catch(() => null))
            );
            shouldProcessQueue = queueResults.some((item) => item?.ok || item?.fallback);
        }

        if (shouldProcessQueue) {
            await processDispatchQueue(6).catch(() => null);
        }

        if (!result.ok) {
            res.status(202).json({
                ok: false,
                reason: result.reason,
                detail: result.detail || '',
                trackingAttempted: jobs.length > 0
            });
            return;
        }

        res.status(200).json({ ok: true });
    } catch (error) {
        console.error('[lead-track] unexpected failure', error);
        res.status(202).json({
            ok: false,
            reason: 'track_internal_error',
            detail: error?.message || String(error)
        });
    }
};
