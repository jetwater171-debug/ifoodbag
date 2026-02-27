const { ensureAllowedRequest } = require('../../lib/request-guard');
const { requestTransactionStatus: requestAtivushubStatus } = require('../../lib/ativushub-provider');
const { requestTransactionById: requestGhostspayStatus } = require('../../lib/ghostspay-provider');
const { requestTransactionById: requestSunizeStatus } = require('../../lib/sunize-provider');
const {
    requestTransactionById: requestParadiseStatus,
    requestTransactionByReference: requestParadiseByReference
} = require('../../lib/paradise-provider');
const {
    normalizeGatewayId,
    resolveGatewayFromPayload
} = require('../../lib/payment-gateway-config');
const { getPaymentsConfig } = require('../../lib/payments-config-store');
const {
    getAtivusStatus,
    isAtivusPaidStatus,
    isAtivusRefundedStatus,
    isAtivusRefusedStatus,
    mapAtivusStatusToUtmify
} = require('../../lib/ativus-status');
const {
    getGhostspayStatus,
    getGhostspayUpdatedAt,
    isGhostspayPaidStatus,
    isGhostspayRefundedStatus,
    isGhostspayRefusedStatus,
    isGhostspayChargebackStatus,
    mapGhostspayStatusToUtmify
} = require('../../lib/ghostspay-status');
const {
    getSunizeStatus,
    getSunizeUpdatedAt,
    isSunizePaidStatus,
    isSunizeRefundedStatus,
    isSunizeRefusedStatus,
    mapSunizeStatusToUtmify
} = require('../../lib/sunize-status');
const {
    getParadiseStatus,
    getParadiseUpdatedAt,
    isParadisePaidStatus,
    isParadiseRefundedStatus,
    isParadiseChargebackStatus,
    isParadiseRefusedStatus,
    mapParadiseStatusToUtmify
} = require('../../lib/paradise-status');
const {
    getLeadByPixTxid,
    getLeadBySessionId,
    updateLeadByPixTxid,
    updateLeadBySessionId
} = require('../../lib/lead-store');
const { enqueueDispatch, processDispatchQueue } = require('../../lib/dispatch-queue');

function asObject(input) {
    return input && typeof input === 'object' && !Array.isArray(input) ? input : {};
}

function toIsoDate(value) {
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

function normalizeStatus(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/-+/g, '_');
}

function normalizeMoneyToBrl(value) {
    if (value === undefined || value === null || value === '') return 0;
    const raw = String(value).trim();
    if (!raw) return 0;
    const normalized = raw.replace(',', '.');
    const amount = Number(normalized);
    if (!Number.isFinite(amount)) return 0;
    const hasDecimalMark = /[.,]/.test(raw);
    if (hasDecimalMark) return Number(amount.toFixed(2));
    if (Number.isInteger(amount) && Math.abs(amount) >= 100) {
        return Number((amount / 100).toFixed(2));
    }
    return Number(amount.toFixed(2));
}

function pickText(...values) {
    for (const value of values) {
        if (value === undefined || value === null) continue;
        const text = String(value).trim();
        if (text) return text;
    }
    return '';
}

function looksLikePixCopyPaste(value = '') {
    const text = String(value || '').trim();
    if (!text) return false;
    if (text.startsWith('000201') && text.length >= 30) return true;
    return /br\.gov\.bcb\.pix/i.test(text);
}

function extractPixFieldsForStatus(gateway, payload = {}) {
    const root = asObject(payload);
    const nested = asObject(root.data);
    const transaction = asObject(root.transaction);
    const payment = asObject(root.payment);
    const pix = asObject(
        root.pix ||
        nested.pix ||
        transaction.pix ||
        payment.pix
    );

    const isGhost = gateway === 'ghostspay';
    const isSunize = gateway === 'sunize';
    const isParadise = gateway === 'paradise';
    let paymentCode = '';
    let qrRaw = '';
    let paymentQrUrl = '';

    if (isGhost) {
        paymentCode = pickText(
            pix.qrcodeText,
            pix.qrCodeText,
            pix.copyPaste,
            pix.copy_paste,
            pix.emv,
            pix.payload,
            pix.pixCode,
            pix.pix_code,
            root.paymentCode,
            nested.paymentCode,
            root.copyPaste,
            nested.copyPaste
        );
        qrRaw = pickText(
            pix.qrcode,
            pix.qrCode,
            pix.qrcodeImage,
            pix.qrCodeImage,
            pix.qrcodeBase64,
            pix.qrCodeBase64,
            pix.qr_code_base64,
            pix.image,
            pix.imageBase64,
            root.qrcode,
            nested.qrcode,
            root.qrCode,
            nested.qrCode
        );
        paymentQrUrl = pickText(
            pix.qrcodeUrl,
            pix.qrCodeUrl,
            pix.qrcode_url,
            pix.qr_code_url,
            root.qrcodeUrl,
            nested.qrcodeUrl
        );
    } else if (isSunize) {
        paymentCode = pickText(
            pix.payload,
            pix.copyPaste,
            pix.copy_paste,
            root.pixPayload,
            nested.pixPayload
        );
        qrRaw = pickText(
            pix.qrcode,
            pix.qrCode,
            pix.qr_code,
            pix.qrcodeBase64,
            pix.qrCodeBase64,
            pix.qr_code_base64
        );
        paymentQrUrl = pickText(
            pix.qrcode_url,
            pix.qrCodeUrl,
            pix.qr_code_url
        );
    } else if (isParadise) {
        paymentCode = pickText(
            root.qr_code,
            root.pix_code,
            nested.qr_code,
            nested.pix_code
        );
        qrRaw = pickText(
            root.qr_code_base64,
            root.qrcode_base64,
            root.qrCodeBase64,
            nested.qr_code_base64,
            nested.qrcode_base64,
            nested.qrCodeBase64
        );
    } else {
        paymentCode = pickText(root.paymentCode, root.paymentcode, nested.paymentCode, nested.paymentcode);
        qrRaw = pickText(root.paymentCodeBase64, root.paymentcodebase64, nested.paymentCodeBase64, nested.paymentcodebase64);
        paymentQrUrl = pickText(root.paymentQrUrl, nested.paymentQrUrl);
    }

    if (!paymentCode && looksLikePixCopyPaste(qrRaw)) {
        paymentCode = qrRaw;
        qrRaw = '';
    }

    let paymentCodeBase64 = '';
    if (!paymentQrUrl && qrRaw) {
        if (/^https?:\/\//i.test(qrRaw) || qrRaw.startsWith('data:image')) {
            paymentQrUrl = qrRaw;
        } else {
            paymentCodeBase64 = qrRaw;
        }
    }

    return {
        paymentCode,
        paymentCodeBase64,
        paymentQrUrl
    };
}

function mapUtmifyStatusToFrontend(status) {
    const normalized = normalizeStatus(status);
    if (normalized === 'paid') return 'paid';
    if (normalized === 'refunded') return 'refunded';
    if (normalized === 'refused') return 'refused';
    if (normalized === 'chargedback') return 'refused';
    return 'waiting_payment';
}

function mapGatewayStatusToFrontend(gateway, statusRaw) {
    if (gateway === 'ghostspay') {
        return mapUtmifyStatusToFrontend(mapGhostspayStatusToUtmify(statusRaw));
    }
    if (gateway === 'sunize') {
        return mapUtmifyStatusToFrontend(mapSunizeStatusToUtmify(statusRaw));
    }
    if (gateway === 'paradise') {
        return mapUtmifyStatusToFrontend(mapParadiseStatusToUtmify(statusRaw));
    }
    return mapUtmifyStatusToFrontend(mapAtivusStatusToUtmify(statusRaw));
}

function deriveLeadStatus(leadData, expectedTxid = '') {
    if (!leadData) return { status: 'waiting_payment', statusRaw: '', gateway: 'ativushub' };
    const payload = asObject(leadData.payload);
    const lastEvent = String(leadData.last_event || '').trim().toLowerCase();
    const gateway = resolveGatewayFromPayload(payload, 'ativushub');
    const requestedTxid = String(expectedTxid || '').trim();
    const payloadTxid = pickText(
        leadData?.pix_txid,
        payload?.pixTxid,
        payload?.pix?.idTransaction,
        payload?.pix?.txid
    );
    const txidMatches = !requestedTxid
        ? true
        : Boolean(payloadTxid) && requestedTxid === payloadTxid;

    if (txidMatches && (lastEvent === 'pix_confirmed' || payload.pixPaidAt)) {
        return { status: 'paid', statusRaw: String(payload.pixStatus || 'paid'), gateway };
    }
    if (txidMatches && (lastEvent === 'pix_refunded' || payload.pixRefundedAt)) {
        return { status: 'refunded', statusRaw: String(payload.pixStatus || 'refunded'), gateway };
    }
    if (txidMatches && (lastEvent === 'pix_refused' || payload.pixRefusedAt)) {
        return { status: 'refused', statusRaw: String(payload.pixStatus || 'refused'), gateway };
    }
    if (!txidMatches) {
        return { status: 'waiting_payment', statusRaw: '', gateway };
    }
    const statusRaw = String(payload.pixStatus || payload.status || '');
    const mapped = mapGatewayStatusToFrontend(gateway, statusRaw);
    return { status: mapped, statusRaw, gateway };
}

function isUpsellLead(leadData) {
    const payload = asObject(leadData?.payload);
    const shippingId = String(leadData?.shipping_id || payload?.shipping?.id || payload?.shippingId || '').trim().toLowerCase();
    const shippingName = String(leadData?.shipping_name || payload?.shipping?.name || payload?.shippingName || '').trim().toLowerCase();
    if (payload?.upsell?.enabled === true || payload?.isUpsell === true) return true;
    if (shippingId === 'expresso_1dia' || shippingId === 'taxa_iof_bag' || shippingId === 'taxa_objeto_grande_correios') return true;
    return /adiantamento|prioridade|expresso|iof|correios|objeto_grande|objeto grande/.test(shippingName);
}

function buildPatchFromGatewayStatus(leadData, txid, gateway, statusRaw, nextStatus, changedAtIso) {
    const payload = asObject(leadData?.payload);
    return {
        last_event:
            nextStatus === 'paid'
                ? 'pix_confirmed'
                : nextStatus === 'refunded'
                    ? 'pix_refunded'
                    : nextStatus === 'refused'
                        ? 'pix_refused'
                        : payload?.last_event || 'pix_pending',
        stage: 'pix',
        payload: {
            ...payload,
            gateway,
            pixGateway: gateway,
            paymentGateway: gateway,
            pixTxid: txid || payload.pixTxid || undefined,
            pixStatus: statusRaw || payload.pixStatus || null,
            pixStatusChangedAt: changedAtIso,
            pixPaidAt: nextStatus === 'paid' ? (payload.pixPaidAt || changedAtIso) : payload.pixPaidAt || undefined,
            pixRefundedAt: nextStatus === 'refunded' ? (payload.pixRefundedAt || changedAtIso) : payload.pixRefundedAt || undefined,
            pixRefusedAt: nextStatus === 'refused' ? (payload.pixRefusedAt || changedAtIso) : payload.pixRefusedAt || undefined
        }
    };
}

function resolveStatusGateway(body = {}, leadData = null, payments = {}) {
    const ativushubEnabled = payments?.gateways?.ativushub?.enabled !== false;
    const ghostspayEnabled = payments?.gateways?.ghostspay?.enabled === true;
    const sunizeEnabled = payments?.gateways?.sunize?.enabled === true;
    const paradiseEnabled = payments?.gateways?.paradise?.enabled === true;
    const requested = normalizeGatewayId(body.gateway || body.paymentGateway || body.provider || '');
    if (requested === 'ghostspay' && ghostspayEnabled) {
        return 'ghostspay';
    }
    if (requested === 'sunize' && sunizeEnabled) {
        return 'sunize';
    }
    if (requested === 'paradise' && paradiseEnabled) {
        return 'paradise';
    }
    if (requested === 'ativushub' && !ativushubEnabled && ghostspayEnabled) {
        return 'ghostspay';
    }
    if (requested === 'ativushub' && !ativushubEnabled && sunizeEnabled) {
        return 'sunize';
    }
    if (requested === 'ativushub' && !ativushubEnabled && paradiseEnabled) {
        return 'paradise';
    }

    const payload = asObject(leadData?.payload);
    const fromLead = resolveGatewayFromPayload(payload, payments.activeGateway || 'ativushub');
    if (fromLead === 'ghostspay' && ghostspayEnabled) {
        return 'ghostspay';
    }
    if (fromLead === 'sunize' && sunizeEnabled) {
        return 'sunize';
    }
    if (fromLead === 'paradise' && paradiseEnabled) {
        return 'paradise';
    }
    if (!ativushubEnabled && ghostspayEnabled) {
        return 'ghostspay';
    }
    if (!ativushubEnabled && sunizeEnabled) {
        return 'sunize';
    }
    if (!ativushubEnabled && paradiseEnabled) {
        return 'paradise';
    }
    return 'ativushub';
}

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
    } catch (_error) {
        res.status(400).json({ error: 'Invalid JSON body.' });
        return;
    }

    const txid = String(
        body?.txid ||
        body?.transaction_id ||
        body?.transactionId ||
        body?.idTransaction ||
        body?.idtransaction ||
        body?.id_transaction ||
        ''
    ).trim();
    const sessionId = String(body?.sessionId || '').trim();
    if (!txid && !sessionId) {
        res.status(400).json({ error: 'txid ou sessionId obrigatorio.' });
        return;
    }

    let leadData = null;
    if (txid) {
        const byTxid = await getLeadByPixTxid(txid).catch(() => ({ ok: false, data: null }));
        leadData = byTxid?.ok ? byTxid.data : null;
    }
    if (!leadData && sessionId) {
        const bySession = await getLeadBySessionId(sessionId).catch(() => ({ ok: false, data: null }));
        leadData = bySession?.ok ? bySession.data : null;
    }

    const payments = await getPaymentsConfig();
    const leadStatus = deriveLeadStatus(leadData, txid);
    const gateway = resolveStatusGateway(body, leadData, payments);
    const gatewayConfig = payments?.gateways?.[gateway] || {};
    const statusGatewayConfig = {
        ...gatewayConfig,
        timeoutMs: Math.max(
            2500,
            Math.min(
                Number(gatewayConfig?.timeoutMs || 12000),
                gateway === 'ghostspay'
                    ? 6500
                    : gateway === 'paradise'
                        ? 7000
                        : 7000
            )
        )
    };

    if (leadStatus.status === 'paid') {
        res.status(200).json({
            ok: true,
            status: 'paid',
            statusRaw: leadStatus.statusRaw || 'paid',
            source: 'database',
            gateway: leadStatus.gateway || gateway,
            txid: txid || String(leadData?.pix_txid || '').trim()
        });
        return;
    }

    if (!txid) {
        res.status(200).json({
            ok: true,
            status: leadStatus.status,
            statusRaw: leadStatus.statusRaw || '',
            source: 'database',
            gateway: leadStatus.gateway || gateway,
            txid: ''
        });
        return;
    }

    let response;
    let data;
    let statusRaw = '';
    let changedAtIso = new Date().toISOString();
    let nextStatus = leadStatus.status || 'waiting_payment';
    let paymentCode = '';
    let paymentCodeBase64 = '';
    let paymentQrUrl = '';

    if (gateway === 'ghostspay') {
        ({ response, data } = await requestGhostspayStatus(statusGatewayConfig, txid));
        if (!response?.ok) {
            const status = Number(response?.status || 0);
            res.status(status === 404 ? 200 : 502).json({
                ok: status === 404,
                status: leadStatus.status || 'waiting_payment',
                statusRaw: leadStatus.statusRaw || '',
                txid,
                gateway,
                source: 'database_fallback',
                detail: data?.error || data?.message || ''
            });
            return;
        }

        statusRaw = getGhostspayStatus(data);
        const mapped = mapGhostspayStatusToUtmify(statusRaw);
        nextStatus = isGhostspayPaidStatus(statusRaw)
            ? 'paid'
            : isGhostspayRefundedStatus(statusRaw)
                ? 'refunded'
                : (isGhostspayRefusedStatus(statusRaw) || isGhostspayChargebackStatus(statusRaw))
                    ? 'refused'
                    : mapUtmifyStatusToFrontend(mapped);
        changedAtIso =
            toIsoDate(getGhostspayUpdatedAt(data)) ||
            toIsoDate(data?.paidAt) ||
            toIsoDate(data?.data?.paidAt) ||
            new Date().toISOString();
        ({ paymentCode, paymentCodeBase64, paymentQrUrl } = extractPixFieldsForStatus(gateway, data));
    } else if (gateway === 'sunize') {
        ({ response, data } = await requestSunizeStatus(statusGatewayConfig, txid));
        if (!response?.ok) {
            const status = Number(response?.status || 0);
            res.status(status === 404 ? 200 : 502).json({
                ok: status === 404,
                status: leadStatus.status || 'waiting_payment',
                statusRaw: leadStatus.statusRaw || '',
                txid,
                gateway,
                source: 'database_fallback',
                detail: data?.error || data?.message || ''
            });
            return;
        }

        statusRaw = getSunizeStatus(data);
        const mapped = mapSunizeStatusToUtmify(statusRaw);
        nextStatus = isSunizePaidStatus(statusRaw)
            ? 'paid'
            : isSunizeRefundedStatus(statusRaw)
                ? 'refunded'
                : isSunizeRefusedStatus(statusRaw)
                    ? 'refused'
                    : mapUtmifyStatusToFrontend(mapped);
        changedAtIso =
            toIsoDate(getSunizeUpdatedAt(data)) ||
            toIsoDate(data?.paid_at) ||
            toIsoDate(data?.paidAt) ||
            new Date().toISOString();
        ({ paymentCode, paymentCodeBase64, paymentQrUrl } = extractPixFieldsForStatus(gateway, data));
    } else if (gateway === 'paradise') {
        ({ response, data } = await requestParadiseStatus(statusGatewayConfig, txid));
        if (!response?.ok) {
            const status = Number(response?.status || 0);
            const leadPayload = asObject(leadData?.payload);
            const externalRef = String(
                leadPayload?.pixExternalId ||
                leadPayload?.pix?.externalId ||
                ''
            ).trim();
            if (status === 404 && externalRef) {
                const byRef = await requestParadiseByReference(statusGatewayConfig, externalRef).catch(() => null);
                if (byRef?.response?.ok) {
                    response = byRef.response;
                    data = Array.isArray(byRef.data) ? (byRef.data[0] || {}) : (byRef.data || {});
                }
            }
            if (!response?.ok) {
                res.status(status === 404 ? 200 : 502).json({
                    ok: status === 404,
                    status: leadStatus.status || 'waiting_payment',
                    statusRaw: leadStatus.statusRaw || '',
                    txid,
                    gateway,
                    source: 'database_fallback',
                    detail: data?.error || data?.message || ''
                });
                return;
            }
        }
        if (Array.isArray(data)) {
            data = data[0] || {};
        }

        statusRaw = getParadiseStatus(data);
        const mapped = mapParadiseStatusToUtmify(statusRaw);
        nextStatus = isParadisePaidStatus(statusRaw)
            ? 'paid'
            : isParadiseRefundedStatus(statusRaw)
                ? 'refunded'
                : (isParadiseRefusedStatus(statusRaw) || isParadiseChargebackStatus(statusRaw))
                    ? 'refused'
                    : mapUtmifyStatusToFrontend(mapped);
        changedAtIso =
            toIsoDate(getParadiseUpdatedAt(data)) ||
            toIsoDate(data?.timestamp) ||
            toIsoDate(data?.updated_at) ||
            new Date().toISOString();
        ({ paymentCode, paymentCodeBase64, paymentQrUrl } = extractPixFieldsForStatus(gateway, data));
    } else {
        ({ response, data } = await requestAtivushubStatus(statusGatewayConfig, txid));
        if (!response?.ok) {
            const blockedByAtivus = Number(response?.status || 0) === 403;
            res.status(blockedByAtivus ? 200 : 502).json({
                ok: blockedByAtivus,
                status: leadStatus.status || 'waiting_payment',
                statusRaw: leadStatus.statusRaw || '',
                txid,
                gateway,
                source: 'database_fallback',
                blockedByAtivus,
                detail: data?.error || data?.message || ''
            });
            return;
        }

        statusRaw = getAtivusStatus(data);
        const mapped = mapAtivusStatusToUtmify(statusRaw);
        nextStatus = isAtivusPaidStatus(statusRaw)
            ? 'paid'
            : isAtivusRefundedStatus(statusRaw)
                ? 'refunded'
                : isAtivusRefusedStatus(statusRaw)
                    ? 'refused'
                    : mapUtmifyStatusToFrontend(mapped);
        changedAtIso =
            toIsoDate(data?.data_transacao) ||
            toIsoDate(data?.data_registro) ||
            toIsoDate(data?.dt_atualizacao) ||
            new Date().toISOString();
        ({ paymentCode, paymentCodeBase64, paymentQrUrl } = extractPixFieldsForStatus(gateway, data));
    }

    let leadUpdated = false;
    if (leadData || sessionId) {
        const patch = buildPatchFromGatewayStatus(leadData, txid, gateway, statusRaw, nextStatus, changedAtIso);
        let updated = await updateLeadByPixTxid(txid, patch).catch(() => ({ ok: false, count: 0 }));
        if ((!updated?.ok || Number(updated?.count || 0) === 0) && sessionId) {
            updated = await updateLeadBySessionId(sessionId, patch).catch(() => ({ ok: false, count: 0 }));
        }
        leadUpdated = Boolean(updated?.ok) && Number(updated?.count || 0) > 0;
    }

    const terminalStatus = nextStatus === 'paid' || nextStatus === 'refunded' || nextStatus === 'refused';
    const shouldDispatchTerminalFallback = terminalStatus && leadStatus.status !== nextStatus;

    if (shouldDispatchTerminalFallback) {
        let latestLead = leadData;
        if (!latestLead || leadUpdated) {
            const refreshedByTxid = await getLeadByPixTxid(txid).catch(() => ({ ok: false, data: null }));
            latestLead = refreshedByTxid?.ok ? refreshedByTxid.data : null;
            if (!latestLead && sessionId) {
                const refreshedBySession = await getLeadBySessionId(sessionId).catch(() => ({ ok: false, data: null }));
                latestLead = refreshedBySession?.ok ? refreshedBySession.data : null;
            }
        }

        const latestPayload = asObject(latestLead?.payload);
        const leadUtm = asObject(latestPayload?.utm);
        const latestLeadTxid = String(
            latestLead?.pix_txid ||
            latestPayload?.pixTxid ||
            latestPayload?.pix?.idTransaction ||
            latestPayload?.pix?.idtransaction ||
            ''
        ).trim();
        const leadMatchesTxid = !txid || (latestLeadTxid && latestLeadTxid === txid);
        const amountFromLead = leadMatchesTxid
            ? normalizeMoneyToBrl(
                latestPayload?.pixAmount ||
                latestLead?.pix_amount ||
                latestPayload?.pix?.amount ||
                0
            )
            : 0;
        const amountFromGateway = normalizeMoneyToBrl(
            data?.amount ||
            data?.amount_in_reais ||
            data?.amountInReais ||
            data?.data?.amount ||
            data?.data?.amount_in_reais ||
            data?.data?.amountInReais ||
            data?.total_amount ||
            data?.totalAmount ||
            data?.valor_bruto ||
            data?.deposito_liquido ||
            0
        );
        const fallbackLeadAmount = leadMatchesTxid
            ? normalizeMoneyToBrl(
                Number(latestLead?.shipping_price || 0) + Number(latestLead?.bump_price || 0)
            )
            : 0;
        const eventAmount = amountFromGateway > 0
            ? amountFromGateway
            : amountFromLead > 0
                ? amountFromLead
                : fallbackLeadAmount;
        const upsellEvent = isUpsellLead(latestLead);
        const utmifyStatus = nextStatus === 'paid'
            ? 'paid'
            : nextStatus === 'refunded'
                ? 'refunded'
                : 'refused';
        const eventName = nextStatus === 'paid'
            ? (upsellEvent ? 'upsell_pix_confirmed' : 'pix_confirmed')
            : nextStatus === 'refunded'
                ? 'pix_refunded'
                : 'pix_failed';
        const orderId = String(
            latestLead?.session_id ||
            sessionId ||
            latestPayload?.orderId ||
            latestPayload?.sessionId ||
            txid ||
            ''
        ).trim();
        const dedupeBase = txid || orderId || 'unknown';
        let gatewayFee = 0;
        if (gateway === 'ghostspay') {
            gatewayFee = normalizeMoneyToBrl(
                data?.gatewayFee ||
                data?.fee ||
                data?.data?.gatewayFee ||
                data?.data?.fee ||
                0
            );
        } else if (gateway === 'paradise') {
            gatewayFee = normalizeMoneyToBrl(
                data?.fee ||
                data?.gateway_fee ||
                data?.gatewayFee ||
                data?.data?.fee ||
                data?.data?.gateway_fee ||
                data?.data?.gatewayFee ||
                0
            );
        } else if (gateway === 'ativushub') {
            gatewayFee = normalizeMoneyToBrl(data?.taxa_deposito || 0) + normalizeMoneyToBrl(data?.taxa_adquirente || 0);
        }
        const userCommission = Math.max(
            0,
            normalizeMoneyToBrl(
                data?.deposito_liquido ||
                data?.valor_liquido ||
                latestPayload?.userCommission ||
                (eventAmount - gatewayFee)
            )
        );

        const utmPayload = {
            event: 'pix_status',
            orderId: txid || orderId,
            txid,
            gateway,
            status: utmifyStatus,
            amount: eventAmount,
            personal: latestLead ? {
                name: latestLead.name,
                email: latestLead.email,
                cpf: latestLead.cpf,
                phoneDigits: latestLead.phone
            } : null,
            address: latestLead ? {
                street: latestLead.address_line,
                neighborhood: latestLead.neighborhood,
                city: latestLead.city,
                state: latestLead.state,
                cep: latestLead.cep
            } : null,
            shipping: latestLead ? {
                id: latestLead.shipping_id,
                name: latestLead.shipping_name,
                price: latestLead.shipping_price
            } : null,
            bump: latestLead && latestLead.bump_selected ? {
                title: 'Seguro Bag',
                price: latestLead.bump_price
            } : null,
            upsell: upsellEvent ? {
                enabled: true,
                kind: latestPayload?.upsell?.kind || 'frete_1dia',
                title: latestPayload?.upsell?.title || latestLead?.shipping_name || 'Prioridade de envio',
                price: Number(latestPayload?.upsell?.price || latestLead?.shipping_price || eventAmount || 0)
            } : null,
            utm: latestLead ? {
                utm_source: latestLead.utm_source,
                utm_medium: latestLead.utm_medium,
                utm_campaign: latestLead.utm_campaign,
                utm_term: latestLead.utm_term,
                utm_content: latestLead.utm_content,
                gclid: latestLead.gclid,
                fbclid: latestLead.fbclid,
                ttclid: latestLead.ttclid,
                src: leadUtm.src,
                sck: leadUtm.sck
            } : leadUtm,
            payload: data,
            client_ip: req?.headers?.['x-forwarded-for']
                ? String(req.headers['x-forwarded-for']).split(',')[0].trim()
                : req?.socket?.remoteAddress || '',
            user_agent: req?.headers?.['user-agent'] || '',
            createdAt: latestPayload?.pixCreatedAt || latestLead?.created_at || changedAtIso,
            approvedDate: nextStatus === 'paid' ? (latestPayload?.pixPaidAt || changedAtIso) : null,
            refundedAt: nextStatus === 'refunded' ? (latestPayload?.pixRefundedAt || changedAtIso) : null,
            gatewayFeeInCents: Math.round(Number(gatewayFee || 0) * 100),
            userCommissionInCents: Math.round(Number(userCommission || 0) * 100),
            totalPriceInCents: Math.round(Number(eventAmount || 0) * 100)
        };

        let shouldProcessQueue = false;

        const utmQueued = await enqueueDispatch({
            channel: 'utmfy',
            eventName,
            dedupeKey: `utmfy:status:${gateway}:${dedupeBase}:${upsellEvent ? 'upsell' : 'base'}:${utmifyStatus}`,
            payload: utmPayload
        }).catch(() => null);
        if (utmQueued?.ok || utmQueued?.fallback) {
            shouldProcessQueue = true;
        }

        if (nextStatus === 'paid') {
            const pushKind = upsellEvent ? 'upsell_pix_confirmed' : 'pix_confirmed';
            const pushQueued = await enqueueDispatch({
                channel: 'pushcut',
                kind: pushKind,
                dedupeKey: `pushcut:pix_confirmed:${gateway}:${txid}`,
                payload: {
                    txid,
                    orderId: txid || orderId,
                    status: statusRaw || 'confirmed',
                    amount: eventAmount,
                    gateway,
                    customerName: latestLead?.name || '',
                    customerEmail: latestLead?.email || '',
                    cep: latestLead?.cep || '',
                    shippingName: latestLead?.shipping_name || '',
                    utm: {
                        utm_source: latestLead?.utm_source || leadUtm?.utm_source || leadUtm?.src || '',
                        utm_medium: latestLead?.utm_medium || leadUtm?.utm_medium || '',
                        utm_campaign: latestLead?.utm_campaign || leadUtm?.utm_campaign || leadUtm?.campaign || leadUtm?.sck || '',
                        utm_term: latestLead?.utm_term || leadUtm?.utm_term || leadUtm?.term || '',
                        utm_content: (
                            latestLead?.utm_content ||
                            leadUtm?.utm_content ||
                            leadUtm?.utm_adset ||
                            leadUtm?.adset ||
                            leadUtm?.content ||
                            ''
                        )
                    },
                    source: latestLead?.utm_source || leadUtm?.utm_source || leadUtm?.src || '',
                    campaign: latestLead?.utm_campaign || leadUtm?.utm_campaign || leadUtm?.campaign || leadUtm?.sck || '',
                    adset: (
                        latestLead?.utm_content ||
                        leadUtm?.utm_content ||
                        leadUtm?.utm_adset ||
                        leadUtm?.adset ||
                        leadUtm?.content ||
                        ''
                    ),
                    isUpsell: upsellEvent
                }
            }).catch(() => null);
            if (pushQueued?.ok || pushQueued?.fallback) {
                shouldProcessQueue = true;
            }
        }

        if (shouldProcessQueue) {
            await processDispatchQueue(10).catch(() => null);
        }
    }

    res.status(200).json({
        ok: true,
        status: nextStatus,
        statusRaw,
        txid,
        gateway,
        changedAt: changedAtIso,
        source: gateway,
        paymentCode,
        paymentCodeBase64,
        paymentQrUrl
    });
};
