const { WEBHOOK_TOKEN } = require('../../lib/ativus');
const { updateLeadByPixTxid, getLeadByPixTxid } = require('../../lib/lead-store');
const { enqueueDispatch, processDispatchQueue } = require('../../lib/dispatch-queue');
const {
    getAtivusTxid,
    getAtivusStatus,
    isAtivusPaidStatus,
    mapAtivusStatusToUtmify,
    isAtivusRefundedStatus,
    isAtivusRefusedStatus
} = require('../../lib/ativus-status');

module.exports = async (req, res) => {
    const token = req.query?.token;
    if (req.method === 'GET' || req.method === 'HEAD') {
        if (token !== WEBHOOK_TOKEN) {
            res.status(401).json({ status: 'unauthorized' });
            return;
        }
        res.status(200).json({ status: 'ok' });
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).json({ status: 'method_not_allowed' });
        return;
    }
    if (token !== WEBHOOK_TOKEN) {
        res.status(401).json({ status: 'unauthorized' });
        return;
    }

    let body = {};
    try {
        body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    } catch (_error) {
        body = {};
    }

    const txid = getAtivusTxid(body);
    const statusRaw = getAtivusStatus(body);
    const utmifyStatus = mapAtivusStatusToUtmify(statusRaw);
    const isPaid = isAtivusPaidStatus(statusRaw) || body.paid === true || body.isPaid === true;
    const isRefunded = isAtivusRefundedStatus(statusRaw);
    const isRefused = isAtivusRefusedStatus(statusRaw);

    if (txid) {
        const lastEvent = isPaid ? 'pix_confirmed' : isRefunded ? 'pix_refunded' : isRefused ? 'pix_refused' : 'pix_pending';
        await updateLeadByPixTxid(txid, { last_event: lastEvent, stage: 'pix' }).catch(() => ({ ok: false, count: 0 }));
        const lead = await getLeadByPixTxid(txid).catch(() => ({ ok: false, data: null }));
        const leadData = lead?.ok ? lead.data : null;

        const amount = Number(
            body?.amount ||
            body?.valor_bruto ||
            body?.valor_liquido ||
            body?.deposito_liquido ||
            body?.cash_out_liquido ||
            body?.data?.amount ||
            0
        );
        const clientIp = req?.headers?.['x-forwarded-for']
            ? String(req.headers['x-forwarded-for']).split(',')[0].trim()
            : req?.socket?.remoteAddress || '';
        const userAgent = req?.headers?.['user-agent'] || '';
        const leadUtm = leadData?.payload?.utm || {};
        const webhookUtm = {
            utm_source: body?.checkout?.utm_source || body?.utm_source || '',
            utm_medium: body?.checkout?.utm_medium || body?.utm_medium || '',
            utm_campaign: body?.checkout?.utm_campaign || body?.utm_campaign || '',
            utm_term: body?.checkout?.utm_term || body?.utm_term || '',
            utm_content: body?.checkout?.utm_content || body?.utm_content || '',
            src: body?.checkout?.src || body?.src || '',
            sck: body?.checkout?.sck || body?.sck || ''
        };
        const gatewayFee = Number(body?.taxa_deposito || 0) + Number(body?.taxa_adquirente || 0);
        const userCommission = Number(body?.deposito_liquido || body?.valor_liquido || 0);
        const eventName = isPaid ? 'pix_confirmed' : isRefunded ? 'pix_refunded' : isRefused ? 'pix_refused' : 'pix_pending';
        const orderId =
            leadData?.session_id ||
            body?.metadata?.orderId ||
            body?.customer?.externaRef ||
            body?.externalreference ||
            '';

        const personalFromWebhook = {
            name: body?.client_name || body?.clientName || body?.customer?.name || '',
            email: body?.client_email || body?.clientEmail || body?.customer?.email || '',
            cpf: body?.client_document || body?.clientDocument || body?.customer?.cpf || '',
            phoneDigits: body?.client_phone || body?.clientPhone || body?.customer?.phone || ''
        };
        const personalPayload = leadData ? {
            name: leadData.name,
            email: leadData.email,
            cpf: leadData.cpf,
            phoneDigits: leadData.phone
        } : personalFromWebhook;

        await Promise.all([
            enqueueDispatch({
                channel: 'utmfy',
                eventName,
                dedupeKey: `utmfy:status:${txid}:${utmifyStatus}`,
                payload: {
                    event: eventName,
                    orderId,
                    txid,
                    status: utmifyStatus,
                    amount,
                    personal: personalPayload,
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
                    } : webhookUtm,
                    payload: body,
                    client_ip: clientIp,
                    user_agent: userAgent,
                    createdAt: leadData?.created_at,
                    approvedDate: isPaid ? body?.data_registro || body?.data_transacao || null : null,
                    refundedAt: isRefunded ? body?.data_registro || body?.data_transacao || null : null,
                    gatewayFeeInCents: Math.round(gatewayFee * 100),
                    userCommissionInCents: Math.round(userCommission * 100),
                    totalPriceInCents: Math.round(amount * 100)
                }
            }).catch(() => null),
            isPaid ? enqueueDispatch({
                channel: 'pushcut',
                kind: 'pix_confirmed',
                dedupeKey: `pushcut:pix_confirmed:${txid}`,
                payload: { txid, status: statusRaw || 'confirmed', amount }
            }).catch(() => null) : Promise.resolve(),
            isPaid ? enqueueDispatch({
                channel: 'pixel',
                eventName: 'Purchase',
                dedupeKey: `pixel:purchase:${txid}`,
                payload: {
                    amount,
                    client_email: body?.client_email || personalFromWebhook.email,
                    client_document: body?.client_document || personalFromWebhook.cpf,
                    client_ip: clientIp,
                    user_agent: userAgent
                }
            }).catch(() => null) : Promise.resolve()
        ]);
        await processDispatchQueue(10).catch(() => null);
    }

    res.status(200).json({ status: 'success' });
};
