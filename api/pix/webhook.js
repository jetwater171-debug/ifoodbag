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
    if (req.method !== 'POST') {
        res.status(405).json({ status: 'method_not_allowed' });
        return;
    }
    const token = req.query?.token;
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
        const update = await updateLeadByPixTxid(txid, { last_event: lastEvent, stage: 'pix' }).catch(() => ({ ok: false, count: 0 }));
        const lead = await getLeadByPixTxid(txid).catch(() => ({ ok: false, data: null }));
        const leadData = lead?.ok ? lead.data : null;
        if (update?.ok && Number(update.count || 0) > 0) {
            const amount = Number(body?.amount || body?.deposito_liquido || body?.cash_out_liquido || 0);
            const clientIp = req?.headers?.['x-forwarded-for']
                ? String(req.headers['x-forwarded-for']).split(',')[0].trim()
                : req?.socket?.remoteAddress || '';
            const userAgent = req?.headers?.['user-agent'] || '';
            const leadUtm = leadData?.payload?.utm || {};
            const gatewayFee = Number(body?.taxa_deposito || 0) + Number(body?.taxa_adquirente || 0);
            const userCommission = Number(body?.deposito_liquido || body?.valor_liquido || 0);

            enqueueDispatch({
                channel: 'utmfy',
                eventName: 'pix_status',
                dedupeKey: `utmfy:status:${txid}:${utmifyStatus}`,
                payload: {
                event: 'pix_status',
                orderId: leadData?.session_id || '',
                txid,
                status: utmifyStatus,
                amount,
                personal: leadData ? {
                    name: leadData.name,
                    email: leadData.email,
                    cpf: leadData.cpf,
                    phoneDigits: leadData.phone
                } : null,
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
                } : leadUtm,
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
            }).then(() => processDispatchQueue(10)).catch(() => null);

            if (isPaid) {
                enqueueDispatch({
                    channel: 'pushcut',
                    kind: 'pix_confirmed',
                    dedupeKey: `pushcut:pix_confirmed:${txid}`,
                    payload: { txid, status: statusRaw || 'confirmed', amount }
                }).then(() => processDispatchQueue(10)).catch(() => null);
            }

            if (isPaid) {
                enqueueDispatch({
                    channel: 'pixel',
                    eventName: 'Purchase',
                    dedupeKey: `pixel:purchase:${txid}`,
                    payload: {
                        amount,
                        client_email: body?.client_email,
                        client_document: body?.client_document,
                        client_ip: clientIp,
                        user_agent: userAgent
                    }
                }).then(() => processDispatchQueue(10)).catch(() => null);
            }
        }
    }

    res.status(200).json({ status: 'success' });
};
