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
    if (!await ensurePublicAccess(req, res, { requireSession: true })) {
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
        const forwarded = req.headers['x-forwarded-for'];
        const clientIp = typeof forwarded === 'string' && forwarded
            ? forwarded.split(',')[0].trim()
            : req.socket?.remoteAddress || '';

        const fullPayload = {
            event: body.event || 'lead_event',
            stage: body.stage || '',
            page: body.page || '',
            sessionId: body.sessionId || body.session_id || '',
            sourceUrl: body.sourceUrl || '',
            utm: body.utm || {},
            personal: body.personal || {},
            address: body.address || {},
            extra: body.extra || {},
            shipping: body.shipping || {},
            bump: body.bump || {},
            pix: body.pix || {},
            amount: body.amount,
            metadata: {
                received_at: new Date().toISOString(),
                user_agent: req.headers['user-agent'] || '',
                referrer: req.headers['referer'] || '',
                client_ip: clientIp
            },
            raw: body
        };

        const result = await upsertLead(body, req);

        if (!result.ok && (result.reason === 'missing_supabase_config' || result.reason === 'skipped_no_data')) {
            res.status(202).json({ ok: false, reason: result.reason });
            return;
        }

        if (!result.ok) {
            res.status(502).json({ ok: false, reason: result.reason, detail: result.detail || '' });
            return;
        }

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

        res.status(200).json({ ok: true });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message || String(error) });
    }
};
