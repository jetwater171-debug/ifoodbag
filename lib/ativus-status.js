const pick = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');

function normalizeStatus(statusRaw) {
    return String(statusRaw || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/-+/g, '_');
}

function getAtivusTxid(payload = {}) {
    return String(
        pick(
            payload?.idTransaction,
            payload?.idtransaction,
            payload?.id_transaction,
            payload?.transaction_id,
            payload?.transactionId,
            payload?.txid,
            payload?.data?.idTransaction,
            payload?.data?.idtransaction,
            payload?.data?.id_transaction,
            payload?.data?.transaction_id,
            payload?.data?.transactionId,
            payload?.data?.txid,
            payload?.payment?.idTransaction,
            payload?.payment?.idtransaction,
            payload?.pix?.idTransaction,
            payload?.pix?.txid
        ) || ''
    ).trim();
}

function getAtivusStatus(payload = {}) {
    const candidates = [
        payload?.status_transaction,
        payload?.statusTransaction,
        payload?.transaction_status,
        payload?.situacao,
        payload?.data?.status_transaction,
        payload?.data?.situacao,
        payload?.payment?.status,
        payload?.status,
        payload?.data?.status
    ];

    for (const candidate of candidates) {
        if (candidate === undefined || candidate === null || candidate === '') continue;
        const raw = String(candidate).trim();
        if (!raw) continue;
        if (/^\d+$/.test(raw)) continue;
        return normalizeStatus(raw);
    }
    return '';
}

function isAtivusPaidStatus(statusRaw) {
    const status = normalizeStatus(statusRaw);
    return [
        'paid',
        'paid_out',
        'completed',
        'success',
        'approved',
        'aprovado',
        'confirmado',
        'confirmed'
    ].includes(status);
}

function isAtivusRefundedStatus(statusRaw) {
    const status = normalizeStatus(statusRaw);
    return ['refunded', 'estornado', 'reembolsado'].includes(status);
}

function isAtivusRefusedStatus(statusRaw) {
    const status = normalizeStatus(statusRaw);
    return ['cancelled', 'failed', 'rejected', 'recusado'].includes(status);
}

function isAtivusPendingStatus(statusRaw) {
    const status = normalizeStatus(statusRaw);
    return [
        'pending',
        'waiting_for_approval',
        'aguardando_pagamento',
        'aguardando_aprovacao',
        'retido',
        'med'
    ].includes(status);
}

function mapAtivusStatusToUtmify(statusRaw) {
    if (isAtivusPaidStatus(statusRaw)) return 'paid';
    if (isAtivusRefundedStatus(statusRaw)) return 'refunded';
    if (isAtivusRefusedStatus(statusRaw)) return 'refused';
    if (isAtivusPendingStatus(statusRaw)) return 'waiting_payment';
    return 'waiting_payment';
}

module.exports = {
    normalizeStatus,
    getAtivusTxid,
    getAtivusStatus,
    isAtivusPaidStatus,
    isAtivusPendingStatus,
    isAtivusRefundedStatus,
    isAtivusRefusedStatus,
    mapAtivusStatusToUtmify
};
