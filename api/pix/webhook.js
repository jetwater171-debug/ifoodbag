const { WEBHOOK_TOKEN } = require('../../lib/ativus');
const { updateLeadByPixTxid, getLeadByPixTxid, updateLeadBySessionId, getLeadBySessionId, findLeadByIdentity } = require('../../lib/lead-store');
const { enqueueDispatch, processDispatchQueue } = require('../../lib/dispatch-queue');
const { sendUtmfy } = require('../../lib/utmfy');
const {
    getAtivusTxid,
    getAtivusStatus,
    isAtivusPaidStatus,
    mapAtivusStatusToUtmify,
    isAtivusRefundedStatus,
    isAtivusRefusedStatus
} = require('../../lib/ativus-status');

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).json({ status: 'method_not_allowed' });
        return;
    }

    let body = {};
    try {
        body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    } catch (_error) {
        body = {};
    }

    const looksLikeAtivusWebhook = (payload) => {
        const hasTx = !!String(
            payload?.idtransaction ||
            payload?.idTransaction ||
            payload?.id_transaction ||
            payload?.externalreference ||
            payload?.external_reference ||
            payload?.txid ||
            ''
        ).trim();
        const hasStatus = !!String(payload?.status || payload?.situacao || payload?.status_transaction || '').trim();
        const hasActor =
            !!String(payload?.client_name || payload?.client_document || payload?.client_email || '').trim() ||
            !!String(payload?.beneficiaryname || payload?.beneficiarydocument || payload?.pixkey || '').trim();
        return hasTx && hasStatus && hasActor;
    };

    const token = String(req.query?.token || '').trim();
    const headerToken = String(req.headers?.['x-webhook-token'] || '').trim();
    const fallbackAllowed = String(process.env.ATIVUSHUB_WEBHOOK_ALLOW_FALLBACK || 'true').toLowerCase() === 'true';
    const tokenOk = (token && token === WEBHOOK_TOKEN) || (headerToken && headerToken === WEBHOOK_TOKEN);
    if (!tokenOk && !(fallbackAllowed && looksLikeAtivusWebhook(body))) {
        res.status(401).json({ status: 'unauthorized' });
        return;
    }

    const txid = getAtivusTxid(body);
    const statusRaw = getAtivusStatus(body);
    const utmifyStatus = mapAtivusStatusToUtmify(statusRaw);
    const isPaid = isAtivusPaidStatus(statusRaw) || body.paid === true || body.isPaid === true;
    const isRefunded = isAtivusRefundedStatus(statusRaw);
    const isRefused = isAtivusRefusedStatus(statusRaw);

    const amount = Number(body?.amount || body?.deposito_liquido || body?.valor_bruto || body?.cash_out_liquido || 0);
    const clientIp = req?.headers?.['x-forwarded-for']
        ? String(req.headers['x-forwarded-for']).split(',')[0].trim()
        : req?.socket?.remoteAddress || '';
    const userAgent = req?.headers?.['user-agent'] || '';
    const gatewayFee = Number(body?.taxa_deposito || 0) + Number(body?.taxa_adquirente || 0);
    const userCommission = Number(body?.deposito_liquido || body?.valor_liquido || 0);

    const sessionOrderId = String(
        body?.externalreference ||
        body?.external_reference ||
        body?.metadata?.orderId ||
        body?.orderId ||
        ''
    ).trim();

    let leadData = null;
    if (txid) {
        const lastEvent = isPaid ? 'pix_confirmed' : isRefunded ? 'pix_refunded' : isRefused ? 'pix_refused' : 'pix_pending';
        const upByTx = await updateLeadByPixTxid(txid, { last_event: lastEvent, stage: 'pix' }).catch(() => ({ ok: false, count: 0 }));
        if ((!upByTx?.ok || Number(upByTx?.count || 0) === 0) && sessionOrderId) {
            await updateLeadBySessionId(sessionOrderId, { last_event: lastEvent, stage: 'pix' }).catch(() => ({ ok: false, count: 0 }));
        }
        const lead = await getLeadByPixTxid(txid).catch(() => ({ ok: false, data: null }));
        leadData = lead?.ok ? lead.data : null;
        if (!leadData && sessionOrderId) {
            const bySession = await getLeadBySessionId(sessionOrderId).catch(() => ({ ok: false, data: null }));
            leadData = bySession?.ok ? bySession.data : null;
        }
    } else if (sessionOrderId) {
        const lastEvent = isPaid ? 'pix_confirmed' : isRefunded ? 'pix_refunded' : isRefused ? 'pix_refused' : 'pix_pending';
        await updateLeadBySessionId(sessionOrderId, { last_event: lastEvent, stage: 'pix' }).catch(() => ({ ok: false, count: 0 }));
        const bySession = await getLeadBySessionId(sessionOrderId).catch(() => ({ ok: false, data: null }));
        leadData = bySession?.ok ? bySession.data : null;
    }

    if (!leadData) {
        const byIdentity = await findLeadByIdentity({
            cpf: body?.client_document || body?.documento || '',
            email: body?.client_email || body?.email || '',
            phone: body?.client_phone || body?.telefone || ''
        }).catch(() => ({ ok: false, data: null }));
        if (byIdentity?.ok && byIdentity?.data) {
            leadData = byIdentity.data;
            const lastEvent = isPaid ? 'pix_confirmed' : isRefunded ? 'pix_refunded' : isRefused ? 'pix_refused' : 'pix_pending';
            await updateLeadBySessionId(leadData.session_id, { last_event: lastEvent, stage: 'pix' }).catch(() => ({ ok: false, count: 0 }));
        }
    }

    const leadUtm = leadData?.payload?.utm || {};
    const orderId =
        String(
            leadData?.session_id ||
            sessionOrderId ||
            body?.metadata?.orderId ||
            body?.orderId ||
            txid ||
            ''
        ).trim();

    const eventName = isPaid ? 'pix_confirmed' : isRefunded ? 'pix_refunded' : isRefused ? 'pix_failed' : 'pix_created';
    const dedupeBase = txid || orderId || 'unknown';

    if (orderId || txid) {
        const utmPayload = {
            event: 'pix_status',
            orderId,
            txid,
            status: utmifyStatus,
            amount,
            personal: leadData ? {
                name: leadData.name,
                email: leadData.email,
                cpf: leadData.cpf,
                phoneDigits: leadData.phone
            } : {
                name: body?.client_name || body?.nome || '',
                email: body?.client_email || body?.email || '',
                cpf: body?.client_document || body?.documento || '',
                phoneDigits: body?.client_phone || body?.telefone || ''
            },
            address: leadData ? {
                street: leadData.address_line,
                neighborhood: leadData.neighborhood,
                city: leadData.city,
                state: leadData.state,
                cep: leadData.cep
            } : null,
            shipping: leadData ? {
                id: leadData.shipping_id,
                name: leadData.shipping_name,
                price: leadData.shipping_price
            } : null,
            bump: leadData && leadData.bump_selected ? {
                title: 'Seguro Bag',
                price: leadData.bump_price
            } : null,
            utm: leadData ? {
                utm_source: leadData.utm_source,
                utm_medium: leadData.utm_medium,
                utm_campaign: leadData.utm_campaign,
                utm_term: leadData.utm_term,
                utm_content: leadData.utm_content,
                gclid: leadData.gclid,
                fbclid: leadData.fbclid,
                ttclid: leadData.ttclid,
                src: leadUtm.src,
                sck: leadUtm.sck
            } : {
                ...(body?.checkout || {}),
                ...(body?.utm || {})
            },
            payload: body,
            client_ip: clientIp,
            user_agent: userAgent,
            createdAt: leadData?.created_at || body?.data_registro || body?.data_transacao || Date.now(),
            approvedDate: isPaid ? (body?.data_registro || body?.data_transacao || Date.now()) : null,
            refundedAt: isRefunded ? (body?.data_registro || body?.data_transacao || Date.now()) : null,
            gatewayFeeInCents: Math.round(gatewayFee * 100),
            userCommissionInCents: Math.round(userCommission * 100),
            totalPriceInCents: Math.round(amount * 100)
        };

        const utmJob = {
            channel: 'utmfy',
            eventName,
            dedupeKey: `utmfy:status:${dedupeBase}:${utmifyStatus}`,
            payload: utmPayload
        };

        // Immediate delivery improves reliability on serverless lifecycles.
        const utmImmediate = await sendUtmfy(eventName, utmPayload).catch((error) => ({
            ok: false,
            reason: error?.message || 'utmfy_immediate_error'
        }));
        if (!utmImmediate?.ok) {
            await enqueueDispatch(utmJob).catch(() => null);
            await processDispatchQueue(10).catch(() => null);
        }
    }

    if (isPaid && txid) {
        enqueueDispatch({
            channel: 'pushcut',
            kind: 'pix_confirmed',
            dedupeKey: `pushcut:pix_confirmed:${txid}`,
            payload: { txid, status: statusRaw || 'confirmed', amount }
        }).then(() => processDispatchQueue(10)).catch(() => null);

        enqueueDispatch({
            channel: 'pixel',
            eventName: 'Purchase',
            dedupeKey: `pixel:purchase:${txid}`,
            payload: {
                amount,
                client_email: body?.client_email || leadData?.email,
                client_document: body?.client_document || leadData?.cpf,
                client_ip: clientIp,
                user_agent: userAgent
            }
        }).then(() => processDispatchQueue(10)).catch(() => null);
    }

    res.status(200).json({ status: 'success' });
};
