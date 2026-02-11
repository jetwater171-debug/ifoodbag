const pick = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');

function normalizeStatus(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/-+/g, '_');
}

function getGhostspayTxid(payload = {}) {
    return String(
        pick(
            payload?.id,
            payload?.objectId,
            payload?.transactionId,
            payload?.transaction_id,
            payload?.txid,
            payload?.data?.id,
            payload?.data?.transactionId,
            payload?.data?.transaction_id,
            payload?.data?.txid,
            payload?.transaction?.id,
            payload?.payment?.id
        ) || ''
    ).trim();
}

function getGhostspayStatus(payload = {}) {
    const raw = pick(
        payload?.status,
        payload?.data?.status,
        payload?.transaction?.status,
        payload?.payment?.status
    );
    return normalizeStatus(raw);
}

function getGhostspayUpdatedAt(payload = {}) {
    return pick(
        payload?.updatedAt,
        payload?.data?.updatedAt,
        payload?.paidAt,
        payload?.data?.paidAt,
        payload?.createdAt,
        payload?.data?.createdAt
    ) || null;
}

function getGhostspayAmount(payload = {}) {
    const rawValue = pick(
        payload?.amount,
        payload?.data?.amount,
        payload?.transaction?.amount,
        0
    );
    const rawText = String(rawValue ?? '').trim();
    if (!rawText) return 0;
    const normalized = rawText.replace(',', '.');
    const amountRaw = Number(normalized);
    if (!Number.isFinite(amountRaw)) return 0;
    const hasDecimalMark = /[.,]/.test(rawText);
    if (hasDecimalMark) return Number(amountRaw.toFixed(2));
    // GhostsPay usually reports amount in cents, but keep small integer values as BRL fallback.
    if (Number.isInteger(amountRaw) && Math.abs(amountRaw) >= 100) {
        return Number((amountRaw / 100).toFixed(2));
    }
    return Number(amountRaw.toFixed(2));
}

function isGhostspayPaidStatus(statusRaw) {
    const status = normalizeStatus(statusRaw);
    return status === 'paid' || status === 'authorized';
}

function isGhostspayRefundedStatus(statusRaw) {
    return normalizeStatus(statusRaw) === 'refunded';
}

function isGhostspayChargebackStatus(statusRaw) {
    const status = normalizeStatus(statusRaw);
    return status === 'chargedback' || status === 'in_protest';
}

function isGhostspayRefusedStatus(statusRaw) {
    const status = normalizeStatus(statusRaw);
    return [
        'refused',
        'failed',
        'expired',
        'canceled',
        'cancelled'
    ].includes(status);
}

function isGhostspayPendingStatus(statusRaw) {
    const status = normalizeStatus(statusRaw);
    return ['waiting_payment', 'pending', 'in_analisys'].includes(status);
}

function mapGhostspayStatusToUtmify(statusRaw) {
    if (isGhostspayPaidStatus(statusRaw)) return 'paid';
    if (isGhostspayRefundedStatus(statusRaw)) return 'refunded';
    if (isGhostspayChargebackStatus(statusRaw)) return 'refused';
    if (isGhostspayRefusedStatus(statusRaw)) return 'refused';
    if (isGhostspayPendingStatus(statusRaw)) return 'waiting_payment';
    return 'waiting_payment';
}

module.exports = {
    normalizeStatus,
    getGhostspayTxid,
    getGhostspayStatus,
    getGhostspayUpdatedAt,
    getGhostspayAmount,
    isGhostspayPaidStatus,
    isGhostspayRefundedStatus,
    isGhostspayChargebackStatus,
    isGhostspayRefusedStatus,
    isGhostspayPendingStatus,
    mapGhostspayStatusToUtmify
};
