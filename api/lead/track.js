const { upsertLead } = require('../../lib/lead-store');
const { ensureAllowedRequest } = require('../../lib/request-guard');
const { enqueueDispatch, processDispatchQueue } = require('../../lib/dispatch-queue');
const { sendUtmfy } = require('../../lib/utmfy');

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    if (!ensureAllowedRequest(req, res, { requireSession: true })) {
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

        if (fullPayload.event === 'checkout_submit') {
            const orderId = String(fullPayload.sessionId || '').trim();
            const createdAt = body.createdAt || body.pixCreatedAt || new Date().toISOString();
            if (orderId) {
                const shippingAmount = Number(fullPayload?.shipping?.price || 0);
                const bumpPriceRaw = Number(fullPayload?.bump?.price || 0);
                const bumpSelected = fullPayload?.bump?.selected === true && bumpPriceRaw > 0;
                const safeBump = bumpSelected
                    ? {
                        ...fullPayload.bump,
                        selected: true,
                        price: bumpPriceRaw
                    }
                    : {
                        selected: false,
                        price: 0,
                        title: 'Seguro Bag'
                    };
                const postedAmount = Number(fullPayload.amount);
                const normalizedAmount = Number.isFinite(postedAmount) && postedAmount > 0
                    ? postedAmount
                    : Number((Math.max(0, shippingAmount) + (bumpSelected ? bumpPriceRaw : 0)).toFixed(2));
                const checkoutPayload = {
                    ...fullPayload,
                    orderId,
                    amount: normalizedAmount,
                    bump: safeBump,
                    createdAt,
                    status: 'waiting_payment'
                };
                const utmImmediate = await sendUtmfy('checkout', checkoutPayload).catch((error) => ({
                    ok: false,
                    reason: error?.message || 'utmfy_immediate_error'
                }));

                if (!utmImmediate?.ok) {
                    await enqueueDispatch({
                        channel: 'utmfy',
                        eventName: 'checkout',
                        dedupeKey: `utmfy:checkout:${orderId}:waiting_payment`,
                        payload: checkoutPayload
                    }).catch(() => null);
                    await processDispatchQueue(12).catch(() => null);
                }
            }
        }

        const result = await upsertLead(body, req);

        if (!result.ok && (result.reason === 'missing_supabase_config' || result.reason === 'skipped_no_data')) {
            res.status(202).json({ ok: false, reason: result.reason });
            return;
        }

        if (!result.ok) {
            res.status(502).json({ ok: false, reason: result.reason, detail: result.detail || '' });
            return;
        }

        res.status(200).json({ ok: true });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message || String(error) });
    }
};
