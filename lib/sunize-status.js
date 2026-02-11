const pick = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');

function normalizeStatus(value) {
    return String(value || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '_')
        .replace(/-+/g, '_');
}

function getSunizeTxid(payload = {}) {
    return String(
        pick(
            payload?.id,
            payload?.transaction_id,
            payload?.transactionId,
            payload?.txid,
            payload?.data?.id,
            payload?.data?.transaction_id,
            payload?.data?.transactionId,
            payload?.data?.txid
        ) || ''
    ).trim();
}

function getSunizeExternalId(payload = {}) {
    return String(
        pick(
            payload?.external_id,
            payload?.externalId,
            payload?.data?.external_id,
            payload?.data?.externalId
        ) || ''
    ).trim();
}

function getSunizeStatus(payload = {}) {
    const raw = pick(
        payload?.status,
        payload?.data?.status,
        payload?.transaction?.status,
        payload?.payment?.status
    );
    return normalizeStatus(raw);
}

function getSunizeUpdatedAt(payload = {}) {
    return pick(
        payload?.updated_at,
        payload?.updatedAt,
        payload?.data?.updated_at,
        payload?.data?.updatedAt,
        payload?.paid_at,
        payload?.paidAt,
        payload?.data?.paid_at,
        payload?.data?.paidAt,
        payload?.created_at,
        payload?.createdAt,
        payload?.data?.created_at,
        payload?.data?.createdAt
    ) || null;
}

function getSunizeAmount(payload = {}) {
    const rawValue = pick(
        payload?.total_amount,
        payload?.totalAmount,
        payload?.amount,
        payload?.total_value,
        payload?.totalValue,
        payload?.data?.total_amount,
        payload?.data?.totalAmount,
        payload?.data?.amount,
        0
    );
    if (rawValue === undefined || rawValue === null || rawValue === '') return 0;
    const rawText = String(rawValue).trim();
    if (!rawText) return 0;
    const normalized = rawText.replace(',', '.');
    const amountRaw = Number(normalized);
    if (!Number.isFinite(amountRaw)) return 0;
    const hasDecimalMark = /[.,]/.test(rawText);
    if (hasDecimalMark) return Number(amountRaw.toFixed(2));
    if (Number.isInteger(amountRaw) && Math.abs(amountRaw) >= 100) {
        return Number((amountRaw / 100).toFixed(2));
    }
    return Number(amountRaw.toFixed(2));
}

function isSunizePaidStatus(statusRaw) {
    return normalizeStatus(statusRaw) === 'AUTHORIZED';
}

function isSunizeRefundedStatus(statusRaw) {
    return normalizeStatus(statusRaw) === 'CHARGEBACK';
}

function isSunizeRefusedStatus(statusRaw) {
    return normalizeStatus(statusRaw) === 'FAILED';
}

function isSunizePendingStatus(statusRaw) {
    const status = normalizeStatus(statusRaw);
    return status === 'PENDING' || status === 'IN_DISPUTE';
}

function mapSunizeStatusToUtmify(statusRaw) {
    if (isSunizePaidStatus(statusRaw)) return 'paid';
    if (isSunizeRefundedStatus(statusRaw)) return 'chargedback';
    if (isSunizeRefusedStatus(statusRaw)) return 'refused';
    if (isSunizePendingStatus(statusRaw)) return 'waiting_payment';
    return 'waiting_payment';
}

module.exports = {
    normalizeStatus,
    getSunizeTxid,
    getSunizeExternalId,
    getSunizeStatus,
    getSunizeUpdatedAt,
    getSunizeAmount,
    isSunizePaidStatus,
    isSunizeRefundedStatus,
    isSunizeRefusedStatus,
    isSunizePendingStatus,
    mapSunizeStatusToUtmify
};
