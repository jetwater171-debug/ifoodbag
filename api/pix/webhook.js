const {
    updateLeadByPixTxid,
    getLeadByPixTxid,
    updateLeadBySessionId,
    getLeadBySessionId,
    findLeadByIdentity
} = require('../../lib/lead-store');
const { enqueueDispatch, processDispatchQueue } = require('../../lib/dispatch-queue');
const { sendUtmfy } = require('../../lib/utmfy');
const { sendPushcut } = require('../../lib/pushcut');
const {
    normalizeGatewayId
} = require('../../lib/payment-gateway-config');
const { getPaymentsConfig } = require('../../lib/payments-config-store');
const {
    getAtivusTxid,
    getAtivusStatus,
    isAtivusPaidStatus,
    mapAtivusStatusToUtmify,
    isAtivusRefundedStatus,
    isAtivusRefusedStatus
} = require('../../lib/ativus-status');
const {
    getGhostspayTxid,
    getGhostspayStatus,
    getGhostspayAmount,
    getGhostspayUpdatedAt,
    isGhostspayPaidStatus,
    isGhostspayRefundedStatus,
    isGhostspayRefusedStatus,
    isGhostspayChargebackStatus,
    mapGhostspayStatusToUtmify
} = require('../../lib/ghostspay-status');

function normalizeDate(value) {
    if (!value && value !== 0) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
    if (typeof value === 'number') {
        const ms = value > 1e12 ? value : value * 1000;
        const d = new Date(ms);
        return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    const str = String(value || '').trim();
    if (!str) return null;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(str)) {
        const d = new Date(str.replace(' ', 'T'));
        if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    const d = new Date(str);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function asObject(input) {
    return input && typeof input === 'object' && !Array.isArray(input) ? input : {};
}

function mergeLeadPayload(basePayload, patch) {
    return {
        ...asObject(basePayload),
        ...Object.fromEntries(
            Object.entries(asObject(patch)).filter(([, value]) => value !== undefined)
        )
    };
}

function normalizeStatusKey(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_');
}

function normalizeIso(value) {
    return normalizeDate(value) || '';
}

function buildWebhookSignature({ gateway, eventId, txid, orderId, statusRaw, statusChangedAt }) {
    const base = [
        String(gateway || '').trim(),
        String(txid || orderId || '').trim(),
        normalizeStatusKey(statusRaw),
        normalizeIso(statusChangedAt)
    ].join('|');
    const evt = String(eventId || '').trim();
    return evt ? `${gateway}|evt:${evt}` : base;
}

function isDuplicateForLead(leadData, { webhookSignature, statusRaw, statusChangedAt, lastEvent }) {
    if (!leadData || !webhookSignature) return false;
    const payload = asObject(leadData.payload);
    if (String(payload.lastWebhookSignature || '') === webhookSignature) return true;

    const currentStatus = normalizeStatusKey(payload.pixStatus);
    const incomingStatus = normalizeStatusKey(statusRaw);
    const currentChangedAt = normalizeIso(payload.pixStatusChangedAt);
    const incomingChangedAt = normalizeIso(statusChangedAt);
    const currentEvent = String(leadData.last_event || '').trim().toLowerCase();
    const incomingEvent = String(lastEvent || '').trim().toLowerCase();

    return (
        currentStatus &&
        currentStatus === incomingStatus &&
        currentChangedAt &&
        currentChangedAt === incomingChangedAt &&
        currentEvent === incomingEvent
    );
}

function isUpsellLead(leadData) {
    const payload = asObject(leadData?.payload);
    const shippingId = String(leadData?.shipping_id || payload?.shipping?.id || payload?.shippingId || '').trim().toLowerCase();
    const shippingName = String(leadData?.shipping_name || payload?.shipping?.name || payload?.shippingName || '').trim().toLowerCase();
    if (payload?.upsell?.enabled === true || payload?.isUpsell === true) return true;
    if (shippingId === 'expresso_1dia') return true;
    return /adiantamento|prioridade|expresso/.test(shippingName);
}

function looksLikeAtivusWebhook(payload = {}) {
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
}

function looksLikeGhostspayWebhook(payload = {}) {
    const hasEvent = !!String(payload?.id || '').trim();
    const hasObject = !!String(payload?.objectId || payload?.data?.id || '').trim();
    const hasStatus = !!String(payload?.data?.status || payload?.status || '').trim();
    return hasEvent && hasObject && hasStatus;
}

function normalizeMoneyToBrl(value) {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount)) return 0;
    if (Number.isInteger(amount) && Math.abs(amount) >= 1000) {
        return Number((amount / 100).toFixed(2));
    }
    return Number(amount.toFixed(2));
}

function extractGatewayEvent(gateway, body = {}) {
    if (gateway === 'ghostspay') {
        const txid = getGhostspayTxid(body);
        const statusRaw = getGhostspayStatus(body);
        const utmifyStatus = mapGhostspayStatusToUtmify(statusRaw);
        const isPaid = isGhostspayPaidStatus(statusRaw);
        const isRefunded = isGhostspayRefundedStatus(statusRaw);
        const isRefused = isGhostspayRefusedStatus(statusRaw) || isGhostspayChargebackStatus(statusRaw);
        const amount = getGhostspayAmount(body);
        const metadata = asObject(body?.data?.metadata);
        const customer = asObject(body?.data?.customer);
        const document = asObject(customer?.document);
        const sessionOrderId = String(
            metadata?.orderId ||
            metadata?.externalreference ||
            body?.data?.externalreference ||
            body?.data?.external_reference ||
            body?.objectId ||
            ''
        ).trim();
        const statusChangedAt =
            normalizeDate(getGhostspayUpdatedAt(body)) ||
            normalizeDate(body?.data?.paidAt) ||
            normalizeDate(body?.data?.updatedAt) ||
            new Date().toISOString();
        const pixCreatedAtFromGateway =
            normalizeDate(body?.data?.createdAt) ||
            normalizeDate(body?.createdAt) ||
            null;
        const lastEvent = isPaid ? 'pix_confirmed' : isRefunded ? 'pix_refunded' : isRefused ? 'pix_refused' : 'pix_pending';
        const gatewayFee = normalizeMoneyToBrl(body?.data?.gatewayFee || body?.data?.fee || 0);
        const userCommission = Math.max(0, Number((amount - gatewayFee).toFixed(2)));

        return {
            gateway,
            txid,
            statusRaw,
            utmifyStatus,
            isPaid,
            isRefunded,
            isRefused,
            amount,
            gatewayFee,
            userCommission,
            sessionOrderId,
            statusChangedAt,
            pixCreatedAtFromGateway,
            lastEvent,
            webhookEventId: String(body?.id || '').trim(),
            fallbackIdentity: {
                cpf: String(document?.number || '').trim(),
                email: String(customer?.email || '').trim(),
                phone: String(customer?.phone || '').trim()
            },
            fallbackPersonal: {
                name: String(customer?.name || '').trim(),
                email: String(customer?.email || '').trim(),
                cpf: String(document?.number || '').trim(),
                phone: String(customer?.phone || '').trim()
            },
            fallbackAddress: {
                street: '',
                neighborhood: '',
                city: '',
                state: '',
                cep: ''
            },
            fallbackUtm: {
                utm_source: String(metadata?.utm_source || '').trim(),
                utm_medium: String(metadata?.utm_medium || '').trim(),
                utm_campaign: String(metadata?.utm_campaign || '').trim(),
                utm_term: String(metadata?.utm_term || '').trim(),
                utm_content: String(metadata?.utm_content || '').trim(),
                src: String(metadata?.src || '').trim(),
                sck: String(metadata?.sck || '').trim(),
                fbclid: String(metadata?.fbclid || '').trim(),
                gclid: String(metadata?.gclid || '').trim(),
                ttclid: String(metadata?.ttclid || '').trim()
            }
        };
    }

    const txid = getAtivusTxid(body);
    const statusRaw = getAtivusStatus(body);
    const utmifyStatus = mapAtivusStatusToUtmify(statusRaw);
    const isPaid = isAtivusPaidStatus(statusRaw) || body.paid === true || body.isPaid === true;
    const isRefunded = isAtivusRefundedStatus(statusRaw);
    const isRefused = isAtivusRefusedStatus(statusRaw);
    const amount = Number(body?.amount || body?.deposito_liquido || body?.valor_bruto || body?.cash_out_liquido || 0);
    const gatewayFee = Number(body?.taxa_deposito || 0) + Number(body?.taxa_adquirente || 0);
    const userCommission = Number(body?.deposito_liquido || body?.valor_liquido || 0);
    const sessionOrderId = String(
        body?.externalreference ||
        body?.external_reference ||
        body?.metadata?.orderId ||
        body?.orderId ||
        ''
    ).trim();
    const statusChangedAt =
        normalizeDate(body?.data_transacao) ||
        normalizeDate(body?.data_registro) ||
        normalizeDate(body?.dt_atualizacao) ||
        new Date().toISOString();
    const pixCreatedAtFromGateway =
        normalizeDate(body?.data_registro) ||
        normalizeDate(body?.data_transacao) ||
        null;
    const lastEvent = isPaid ? 'pix_confirmed' : isRefunded ? 'pix_refunded' : isRefused ? 'pix_refused' : 'pix_pending';

    return {
        gateway,
        txid,
        statusRaw,
        utmifyStatus,
        isPaid,
        isRefunded,
        isRefused,
        amount,
        gatewayFee,
        userCommission,
        sessionOrderId,
        statusChangedAt,
        pixCreatedAtFromGateway,
        lastEvent,
        webhookEventId: '',
        fallbackIdentity: {
            cpf: String(body?.client_document || body?.documento || '').trim(),
            email: String(body?.client_email || body?.email || '').trim(),
            phone: String(body?.client_phone || body?.telefone || '').trim()
        },
        fallbackPersonal: {
            name: String(body?.client_name || body?.nome || '').trim(),
            email: String(body?.client_email || body?.email || '').trim(),
            cpf: String(body?.client_document || body?.documento || '').trim(),
            phone: String(body?.client_phone || body?.telefone || '').trim()
        },
        fallbackAddress: {
            street: '',
            neighborhood: '',
            city: '',
            state: '',
            cep: ''
        },
        fallbackUtm: {
            ...(asObject(body?.checkout) || {}),
            ...(asObject(body?.utm) || {})
        }
    };
}

function resolveWebhookGateway(query = {}, body = {}, payments = {}) {
    const requested = normalizeGatewayId(query.gateway || query.provider || body.gateway || body.provider);
    if (requested === 'ghostspay' && payments?.gateways?.ghostspay?.enabled) return 'ghostspay';
    if (looksLikeGhostspayWebhook(body) && payments?.gateways?.ghostspay?.enabled) return 'ghostspay';
    if (looksLikeAtivusWebhook(body)) return 'ativushub';
    return normalizeGatewayId(payments.activeGateway || 'ativushub');
}

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

    const payments = await getPaymentsConfig();
    const gateway = resolveWebhookGateway(req.query || {}, body, payments);
    const gatewayConfig = payments?.gateways?.[gateway] || {};

    const token = String(req.query?.token || '').trim();
    const headerToken = String(req.headers?.['x-webhook-token'] || '').trim();
    const expectedToken = String(gatewayConfig.webhookToken || '').trim();
    const fallbackAllowed = gateway === 'ativushub' && gatewayConfig.webhookAllowFallback === true;
    const tokenOk = expectedToken
        ? ((token && token === expectedToken) || (headerToken && headerToken === expectedToken))
        : true;
    if (!tokenOk && !(fallbackAllowed && looksLikeAtivusWebhook(body))) {
        res.status(401).json({ status: 'unauthorized' });
        return;
    }

    const evt = extractGatewayEvent(gateway, body);
    const txid = evt.txid;
    const statusRaw = evt.statusRaw;
    const utmifyStatus = evt.utmifyStatus;
    const isPaid = evt.isPaid;
    const isRefunded = evt.isRefunded;
    const isRefused = evt.isRefused;
    const amount = evt.amount;
    const gatewayFee = evt.gatewayFee;
    const userCommission = evt.userCommission;
    const sessionOrderId = evt.sessionOrderId;
    const statusChangedAt = evt.statusChangedAt;
    const pixCreatedAtFromGateway = evt.pixCreatedAtFromGateway;
    const lastEvent = evt.lastEvent;
    const webhookSignature = buildWebhookSignature({
        gateway,
        eventId: evt.webhookEventId,
        txid,
        orderId: sessionOrderId,
        statusRaw,
        statusChangedAt
    });

    let previousLastEvent = '';
    let previousEventCaptured = false;
    const rememberPreviousEvent = (lead) => {
        if (previousEventCaptured || !lead) return;
        previousEventCaptured = true;
        previousLastEvent = String(lead.last_event || '').trim().toLowerCase();
    };

    let leadData = null;
    if (txid) {
        const lead = await getLeadByPixTxid(txid).catch(() => ({ ok: false, data: null }));
        leadData = lead?.ok ? lead.data : null;
        if (!leadData && sessionOrderId) {
            const bySessionBefore = await getLeadBySessionId(sessionOrderId).catch(() => ({ ok: false, data: null }));
            leadData = bySessionBefore?.ok ? bySessionBefore.data : null;
        }
        rememberPreviousEvent(leadData);

        if (isDuplicateForLead(leadData, { webhookSignature, statusRaw, statusChangedAt, lastEvent })) {
            res.status(200).json({ status: 'duplicate_ignored' });
            return;
        }

        const payloadPatch = mergeLeadPayload(leadData?.payload, {
            gateway,
            pixGateway: gateway,
            paymentGateway: gateway,
            pixTxid: txid,
            pixStatus: statusRaw || null,
            pixStatusChangedAt: statusChangedAt,
            pixCreatedAt: asObject(leadData?.payload).pixCreatedAt || pixCreatedAtFromGateway || leadData?.created_at || undefined,
            pixPaidAt: isPaid ? statusChangedAt : undefined,
            pixRefundedAt: isRefunded ? statusChangedAt : undefined,
            pixRefusedAt: isRefused ? statusChangedAt : undefined,
            lastWebhookSignature: webhookSignature || undefined
        });
        const upByTx = await updateLeadByPixTxid(txid, {
            last_event: lastEvent,
            stage: 'pix',
            payload: payloadPatch
        }).catch(() => ({ ok: false, count: 0 }));
        if ((!upByTx?.ok || Number(upByTx?.count || 0) === 0) && sessionOrderId) {
            const bySessionBefore = leadData || (await getLeadBySessionId(sessionOrderId).catch(() => ({ ok: false, data: null })))?.data;
            const sessionPayloadPatch = mergeLeadPayload(bySessionBefore?.payload, {
                gateway,
                pixGateway: gateway,
                paymentGateway: gateway,
                pixTxid: txid,
                pixStatus: statusRaw || null,
                pixStatusChangedAt: statusChangedAt,
                pixCreatedAt: asObject(bySessionBefore?.payload).pixCreatedAt || pixCreatedAtFromGateway || bySessionBefore?.created_at || undefined,
                pixPaidAt: isPaid ? statusChangedAt : undefined,
                pixRefundedAt: isRefunded ? statusChangedAt : undefined,
                pixRefusedAt: isRefused ? statusChangedAt : undefined,
                lastWebhookSignature: webhookSignature || undefined
            });
            await updateLeadBySessionId(sessionOrderId, {
                last_event: lastEvent,
                stage: 'pix',
                payload: sessionPayloadPatch
            }).catch(() => ({ ok: false, count: 0 }));
        }
        const refreshed = await getLeadByPixTxid(txid).catch(() => ({ ok: false, data: null }));
        leadData = refreshed?.ok ? refreshed.data : null;
        if (!leadData && sessionOrderId) {
            const bySessionAfter = await getLeadBySessionId(sessionOrderId).catch(() => ({ ok: false, data: null }));
            leadData = bySessionAfter?.ok ? bySessionAfter.data : null;
        }
        rememberPreviousEvent(leadData);
    } else if (sessionOrderId) {
        const bySessionBefore = await getLeadBySessionId(sessionOrderId).catch(() => ({ ok: false, data: null }));
        const leadBefore = bySessionBefore?.ok ? bySessionBefore.data : null;
        rememberPreviousEvent(leadBefore);
        if (isDuplicateForLead(leadBefore, { webhookSignature, statusRaw, statusChangedAt, lastEvent })) {
            res.status(200).json({ status: 'duplicate_ignored' });
            return;
        }
        const payloadPatch = mergeLeadPayload(leadBefore?.payload, {
            gateway,
            pixGateway: gateway,
            paymentGateway: gateway,
            pixStatus: statusRaw || null,
            pixStatusChangedAt: statusChangedAt,
            pixCreatedAt: asObject(leadBefore?.payload).pixCreatedAt || pixCreatedAtFromGateway || leadBefore?.created_at || undefined,
            pixPaidAt: isPaid ? statusChangedAt : undefined,
            pixRefundedAt: isRefunded ? statusChangedAt : undefined,
            pixRefusedAt: isRefused ? statusChangedAt : undefined,
            lastWebhookSignature: webhookSignature || undefined
        });
        await updateLeadBySessionId(sessionOrderId, {
            last_event: lastEvent,
            stage: 'pix',
            payload: payloadPatch
        }).catch(() => ({ ok: false, count: 0 }));
        const bySession = await getLeadBySessionId(sessionOrderId).catch(() => ({ ok: false, data: null }));
        leadData = bySession?.ok ? bySession.data : null;
        rememberPreviousEvent(leadData);
    }

    if (!leadData) {
        const byIdentity = await findLeadByIdentity(evt.fallbackIdentity || {}).catch(() => ({ ok: false, data: null }));
        if (byIdentity?.ok && byIdentity?.data) {
            leadData = byIdentity.data;
            rememberPreviousEvent(leadData);
            if (isDuplicateForLead(leadData, { webhookSignature, statusRaw, statusChangedAt, lastEvent })) {
                res.status(200).json({ status: 'duplicate_ignored' });
                return;
            }
            const payloadPatch = mergeLeadPayload(leadData?.payload, {
                gateway,
                pixGateway: gateway,
                paymentGateway: gateway,
                pixTxid: txid || asObject(leadData?.payload).pixTxid || undefined,
                pixStatus: statusRaw || null,
                pixStatusChangedAt: statusChangedAt,
                pixCreatedAt: asObject(leadData?.payload).pixCreatedAt || pixCreatedAtFromGateway || leadData?.created_at || undefined,
                pixPaidAt: isPaid ? statusChangedAt : undefined,
                pixRefundedAt: isRefunded ? statusChangedAt : undefined,
                pixRefusedAt: isRefused ? statusChangedAt : undefined,
                lastWebhookSignature: webhookSignature || undefined
            });
            await updateLeadBySessionId(leadData.session_id, {
                last_event: lastEvent,
                stage: 'pix',
                payload: payloadPatch
            }).catch(() => ({ ok: false, count: 0 }));
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

    const upsellEvent = isUpsellLead(leadData);
    const eventName = isPaid
        ? (upsellEvent ? 'upsell_pix_confirmed' : 'pix_confirmed')
        : isRefunded
            ? 'pix_refunded'
            : isRefused
                ? 'pix_failed'
                : (upsellEvent ? 'upsell_pix_created' : 'pix_created');
    const dedupeBase = txid || orderId || 'unknown';
    const shouldSendUtmStatus = Boolean(orderId || txid) && previousLastEvent !== lastEvent;
    const shouldTriggerPaidSideEffects = Boolean(isPaid && txid) && previousLastEvent !== 'pix_confirmed';

    if (shouldSendUtmStatus) {
        const utmPayload = {
            event: 'pix_status',
            orderId: txid || orderId,
            txid,
            gateway,
            status: utmifyStatus,
            amount,
            personal: leadData ? {
                name: leadData.name,
                email: leadData.email,
                cpf: leadData.cpf,
                phoneDigits: leadData.phone
            } : evt.fallbackPersonal,
            address: leadData ? {
                street: leadData.address_line,
                neighborhood: leadData.neighborhood,
                city: leadData.city,
                state: leadData.state,
                cep: leadData.cep
            } : evt.fallbackAddress,
            shipping: leadData ? {
                id: leadData.shipping_id,
                name: leadData.shipping_name,
                price: leadData.shipping_price
            } : null,
            bump: leadData && leadData.bump_selected ? {
                title: 'Seguro Bag',
                price: leadData.bump_price
            } : null,
            upsell: upsellEvent ? {
                enabled: true,
                kind: asObject(leadData?.payload).upsell?.kind || 'frete_1dia',
                title: asObject(leadData?.payload).upsell?.title || leadData?.shipping_name || 'Prioridade de envio',
                price: Number(asObject(leadData?.payload).upsell?.price || leadData?.shipping_price || amount || 0)
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
            } : evt.fallbackUtm,
            payload: body,
            client_ip: req?.headers?.['x-forwarded-for']
                ? String(req.headers['x-forwarded-for']).split(',')[0].trim()
                : req?.socket?.remoteAddress || '',
            user_agent: req?.headers?.['user-agent'] || '',
            createdAt: leadData?.payload?.pixCreatedAt || leadData?.created_at || pixCreatedAtFromGateway || statusChangedAt,
            approvedDate: isPaid ? (leadData?.payload?.pixPaidAt || statusChangedAt) : null,
            refundedAt: isRefunded ? (leadData?.payload?.pixRefundedAt || statusChangedAt) : null,
            gatewayFeeInCents: Math.round(Number(gatewayFee || 0) * 100),
            userCommissionInCents: Math.round(Number(userCommission || 0) * 100),
            totalPriceInCents: Math.round(Number(amount || 0) * 100)
        };

        const utmJob = {
            channel: 'utmfy',
            eventName,
            dedupeKey: `utmfy:status:${gateway}:${dedupeBase}:${upsellEvent ? 'upsell' : 'base'}:${utmifyStatus}`,
            payload: utmPayload
        };

        const utmImmediate = await sendUtmfy(eventName, utmPayload).catch((error) => ({
            ok: false,
            reason: error?.message || 'utmfy_immediate_error'
        }));
        if (!utmImmediate?.ok) {
            await enqueueDispatch(utmJob).catch(() => null);
            await processDispatchQueue(10).catch(() => null);
        }
    }

    if (shouldTriggerPaidSideEffects) {
        const orderIdForPush = String(
            leadData?.session_id ||
            sessionOrderId ||
            body?.metadata?.orderId ||
            body?.orderId ||
            ''
        ).trim();
        const pushPayload = {
            txid,
            orderId: txid || orderIdForPush,
            status: statusRaw || 'confirmed',
            amount,
            gateway,
            customerName: leadData?.name || evt.fallbackPersonal?.name || '',
            customerEmail: leadData?.email || evt.fallbackPersonal?.email || '',
            cep: leadData?.cep || '',
            shippingName: leadData?.shipping_name || '',
            isUpsell: upsellEvent
        };
        const pushKind = upsellEvent ? 'upsell_pix_confirmed' : 'pix_confirmed';
        const pushImmediate = await sendPushcut(pushKind, pushPayload).catch(() => ({ ok: false }));
        if (!pushImmediate?.ok) {
            await enqueueDispatch({
                channel: 'pushcut',
                kind: pushKind,
                dedupeKey: `pushcut:pix_confirmed:${gateway}:${txid}`,
                payload: pushPayload
            }).catch(() => null);
            await processDispatchQueue(10).catch(() => null);
        }

        const leadPayload = asObject(leadData?.payload);
        const fbclid = String(leadData?.fbclid || leadPayload?.fbclid || leadUtm?.fbclid || '').trim();
        const fbp = String(leadPayload?.fbp || '').trim();
        const fbc = String(leadPayload?.fbc || '').trim() || (fbclid ? `fb.1.${Date.now()}.${fbclid}` : '');
        await enqueueDispatch({
            channel: 'pixel',
            eventName: 'Purchase',
            dedupeKey: `pixel:purchase:${gateway}:${txid}`,
            payload: {
                amount,
                orderId: txid || orderIdForPush,
                gateway,
                shippingName: leadData?.shipping_name || '',
                isUpsell: upsellEvent,
                client_email: evt.fallbackPersonal?.email || leadData?.email,
                client_document: evt.fallbackPersonal?.cpf || leadData?.cpf,
                client_ip: req?.headers?.['x-forwarded-for']
                    ? String(req.headers['x-forwarded-for']).split(',')[0].trim()
                    : req?.socket?.remoteAddress || '',
                user_agent: req?.headers?.['user-agent'] || '',
                source_url: leadData?.source_url || leadPayload?.sourceUrl || '',
                fbclid,
                fbp,
                fbc
            }
        }).catch(() => null);
        await processDispatchQueue(10).catch(() => null);
    }

    res.status(200).json({ status: 'success', gateway });
};
