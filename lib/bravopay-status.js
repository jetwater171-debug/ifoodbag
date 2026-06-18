const pick = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');

function asObject(input) {
    return input && typeof input === 'object' && !Array.isArray(input) ? input : {};
}

function normalizeStatus(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[.:/]+/g, '_')
        .replace(/-+/g, '_')
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function getBravoPayTransaction(payload = {}) {
    const root = asObject(payload);
    const data = asObject(root.data);
    return data.object === 'transaction' || data.id ? data : root;
}

function getBravoPayTxid(payload = {}) {
    const tx = getBravoPayTransaction(payload);
    const root = asObject(payload);
    return String(pick(tx.id, root.transaction_id, root.transactionId, root.txid, root.id) || '').trim();
}

function getBravoPayExternalReference(payload = {}) {
    const tx = getBravoPayTransaction(payload);
    const root = asObject(payload);
    return String(pick(tx.external_reference, tx.externalReference, root.external_reference, root.externalReference) || '').trim();
}

function getBravoPayStatus(payload = {}) {
    const tx = getBravoPayTransaction(payload);
    const root = asObject(payload);
    const eventType = String(root.type || '').trim().toLowerCase();
    if (eventType === 'transaction.paid') return 'paid';
    if (eventType === 'transaction.refunded') return 'refunded';
    if (eventType === 'transaction.chargebacked') return 'chargebacked';
    if (eventType === 'transaction.expired') return 'expired';
    return normalizeStatus(pick(tx.status, root.status, root.raw_status, root.event, root.type));
}

function getBravoPayUpdatedAt(payload = {}) {
    const tx = getBravoPayTransaction(payload);
    const root = asObject(payload);
    return pick(
        tx.paid_at,
        tx.paidAt,
        tx.refunded_at,
        tx.refundedAt,
        tx.updated_at,
        tx.updatedAt,
        tx.created_at,
        tx.createdAt,
        root.created_at,
        root.createdAt
    ) || null;
}

function getBravoPayAmount(payload = {}) {
    const tx = getBravoPayTransaction(payload);
    const raw = pick(tx.amount_cents, tx.amountCents, tx.amount, 0);
    const value = Number(raw);
    if (!Number.isFinite(value)) return 0;
    if (Number.isInteger(value) && Math.abs(value) >= 100) {
        return Number((value / 100).toFixed(2));
    }
    return Number(value.toFixed(2));
}

function getBravoPayFee(payload = {}) {
    const tx = getBravoPayTransaction(payload);
    const raw = pick(tx.fee_cents, tx.feeCents, tx.fee, 0);
    const value = Number(raw);
    if (!Number.isFinite(value)) return 0;
    if (Number.isInteger(value) && Math.abs(value) >= 100) {
        return Number((value / 100).toFixed(2));
    }
    return Number(value.toFixed(2));
}

function getBravoPayNet(payload = {}) {
    const tx = getBravoPayTransaction(payload);
    const raw = pick(tx.net_cents, tx.netCents, tx.net, 0);
    const value = Number(raw);
    if (!Number.isFinite(value)) return 0;
    if (Number.isInteger(value) && Math.abs(value) >= 100) {
        return Number((value / 100).toFixed(2));
    }
    return Number(value.toFixed(2));
}

function getBravoPayTracking(payload = {}) {
    const tx = getBravoPayTransaction(payload);
    return asObject(tx.tracking || tx.utm || payload?.tracking || payload?.utm);
}

function getBravoPayCustomer(payload = {}) {
    const tx = getBravoPayTransaction(payload);
    return asObject(tx.customer || payload?.customer);
}

function resolveBravoPayPixPayload(payload = {}) {
    const tx = getBravoPayTransaction(payload);
    const pix = asObject(tx.pix || payload?.pix);
    return {
        txid: getBravoPayTxid(payload),
        status: getBravoPayStatus(payload),
        amount: getBravoPayAmount(payload),
        paymentCode: String(pick(pix.copy_paste, pix.copyPaste, pix.payload, pix.code) || '').trim(),
        paymentCodeBase64: '',
        paymentQrUrl: String(pick(pix.qr_code, pix.qrCode, pix.qrcode_url, pix.qrCodeUrl) || '').trim(),
        externalId: getBravoPayExternalReference(payload),
        expiresAt: String(pick(pix.expires_at, pix.expiresAt) || '').trim()
    };
}

function isBravoPayPaidStatus(statusRaw) {
    const status = normalizeStatus(statusRaw);
    return status === 'paid' || status === 'transaction_paid';
}

function isBravoPayRefundedStatus(statusRaw) {
    const status = normalizeStatus(statusRaw);
    return status === 'refunded' || status === 'transaction_refunded';
}

function isBravoPayChargebackStatus(statusRaw) {
    const status = normalizeStatus(statusRaw);
    return status === 'chargeback' || status === 'chargebacked' || status === 'transaction_chargebacked';
}

function isBravoPayRefusedStatus(statusRaw) {
    const status = normalizeStatus(statusRaw);
    return ['expired', 'failed', 'canceled', 'cancelled'].includes(status);
}

function isBravoPayPendingStatus(statusRaw) {
    const status = normalizeStatus(statusRaw);
    return ['pending', 'created', 'open', 'processing', 'transaction_created'].includes(status);
}

function mapBravoPayStatusToUtmify(statusRaw) {
    if (isBravoPayPaidStatus(statusRaw)) return 'paid';
    if (isBravoPayRefundedStatus(statusRaw)) return 'refunded';
    if (isBravoPayChargebackStatus(statusRaw)) return 'chargedback';
    if (isBravoPayRefusedStatus(statusRaw)) return 'refused';
    return 'waiting_payment';
}

module.exports = {
    normalizeStatus,
    getBravoPayTransaction,
    getBravoPayTxid,
    getBravoPayExternalReference,
    getBravoPayStatus,
    getBravoPayUpdatedAt,
    getBravoPayAmount,
    getBravoPayFee,
    getBravoPayNet,
    getBravoPayTracking,
    getBravoPayCustomer,
    resolveBravoPayPixPayload,
    isBravoPayPaidStatus,
    isBravoPayRefundedStatus,
    isBravoPayChargebackStatus,
    isBravoPayRefusedStatus,
    isBravoPayPendingStatus,
    mapBravoPayStatusToUtmify
};
