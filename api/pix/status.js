const { ensureAllowedRequest } = require('../../lib/request-guard');
const { requestTransactionStatus: requestAtivushubStatus } = require('../../lib/ativushub-provider');
const { requestTransactionById: requestGhostspayStatus } = require('../../lib/ghostspay-provider');
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

function mapUtmifyStatusToFrontend(status) {
    const normalized = normalizeStatus(status);
    if (normalized === 'paid') return 'paid';
    if (normalized === 'refunded') return 'refunded';
    if (normalized === 'refused') return 'refused';
    return 'waiting_payment';
}

function mapGatewayStatusToFrontend(gateway, statusRaw) {
    if (gateway === 'ghostspay') {
        return mapUtmifyStatusToFrontend(mapGhostspayStatusToUtmify(statusRaw));
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
    const requested = normalizeGatewayId(body.gateway || body.paymentGateway || body.provider || '');
    if (requested === 'ghostspay' && ghostspayEnabled) {
        return 'ghostspay';
    }
    if (requested === 'ativushub' && !ativushubEnabled && ghostspayEnabled) {
        return 'ghostspay';
    }

    const payload = asObject(leadData?.payload);
    const fromLead = resolveGatewayFromPayload(payload, payments.activeGateway || 'ativushub');
    if (fromLead === 'ghostspay' && ghostspayEnabled) {
        return 'ghostspay';
    }
    if (!ativushubEnabled && ghostspayEnabled) {
        return 'ghostspay';
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

    if (gateway === 'ghostspay') {
        ({ response, data } = await requestGhostspayStatus(gatewayConfig, txid));
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
    } else {
        ({ response, data } = await requestAtivushubStatus(gatewayConfig, txid));
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
        source: gateway
    });
};
