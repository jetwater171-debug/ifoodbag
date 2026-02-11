const { ensureAllowedRequest } = require('../../lib/request-guard');
const { requestTransactionStatus: requestAtivushubStatus } = require('../../lib/ativushub-provider');
const { requestTransactionById: requestGhostspayStatus } = require('../../lib/ghostspay-provider');
const { requestTransactionById: requestSunizeStatus } = require('../../lib/sunize-provider');
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
    getLeadByPixTxid,
    getLeadBySessionId,
    updateLeadByPixTxid,
    updateLeadBySessionId
} = require('../../lib/lead-store');

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
    return mapUtmifyStatusToFrontend(mapAtivusStatusToUtmify(statusRaw));
}

function deriveLeadStatus(leadData) {
    if (!leadData) return { status: 'waiting_payment', statusRaw: '', gateway: 'ativushub' };
    const payload = asObject(leadData.payload);
    const lastEvent = String(leadData.last_event || '').trim().toLowerCase();
    const gateway = resolveGatewayFromPayload(payload, 'ativushub');

    if (lastEvent === 'pix_confirmed' || payload.pixPaidAt) {
        return { status: 'paid', statusRaw: String(payload.pixStatus || 'paid'), gateway };
    }
    if (lastEvent === 'pix_refunded' || payload.pixRefundedAt) {
        return { status: 'refunded', statusRaw: String(payload.pixStatus || 'refunded'), gateway };
    }
    if (lastEvent === 'pix_refused' || payload.pixRefusedAt) {
        return { status: 'refused', statusRaw: String(payload.pixStatus || 'refused'), gateway };
    }
    const statusRaw = String(payload.pixStatus || payload.status || '');
    const mapped = mapGatewayStatusToFrontend(gateway, statusRaw);
    return { status: mapped, statusRaw, gateway };
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
    const requested = normalizeGatewayId(body.gateway || body.paymentGateway || body.provider || '');
    if (requested === 'ghostspay' && ghostspayEnabled) {
        return 'ghostspay';
    }
    if (requested === 'sunize' && sunizeEnabled) {
        return 'sunize';
    }
    if (requested === 'ativushub' && !ativushubEnabled && ghostspayEnabled) {
        return 'ghostspay';
    }
    if (requested === 'ativushub' && !ativushubEnabled && sunizeEnabled) {
        return 'sunize';
    }

    const payload = asObject(leadData?.payload);
    const fromLead = resolveGatewayFromPayload(payload, payments.activeGateway || 'ativushub');
    if (fromLead === 'ghostspay' && ghostspayEnabled) {
        return 'ghostspay';
    }
    if (fromLead === 'sunize' && sunizeEnabled) {
        return 'sunize';
    }
    if (!ativushubEnabled && ghostspayEnabled) {
        return 'ghostspay';
    }
    if (!ativushubEnabled && sunizeEnabled) {
        return 'sunize';
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
    const leadStatus = deriveLeadStatus(leadData);
    const gateway = resolveStatusGateway(body, leadData, payments);
    const gatewayConfig = payments?.gateways?.[gateway] || {};
    const statusGatewayConfig = {
        ...gatewayConfig,
        timeoutMs: Math.max(
            2500,
            Math.min(
                Number(gatewayConfig?.timeoutMs || 12000),
                gateway === 'ghostspay' ? 6500 : 7000
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

    if (leadData || sessionId) {
        const patch = buildPatchFromGatewayStatus(leadData, txid, gateway, statusRaw, nextStatus, changedAtIso);
        let updated = await updateLeadByPixTxid(txid, patch).catch(() => ({ ok: false, count: 0 }));
        if ((!updated?.ok || Number(updated?.count || 0) === 0) && sessionId) {
            updated = await updateLeadBySessionId(sessionId, patch).catch(() => ({ ok: false, count: 0 }));
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
