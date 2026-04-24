function asObject(input) {
    return input && typeof input === 'object' && !Array.isArray(input) ? input : {};
}

function asArray(input) {
    return Array.isArray(input) ? input : [];
}

function pickText(...values) {
    for (const value of values) {
        if (value === undefined || value === null) continue;
        const text = String(value).trim();
        if (text) return text;
    }
    return '';
}

function normalizeMoney(value) {
    const amount = Number(value);
    return Number.isFinite(amount) ? Number(amount.toFixed(2)) : null;
}

function normalizeIso(value) {
    if (!value && value !== 0) return '';
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function normalizeStep(value = '') {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return 'front';
    if (raw === 'upsell-iof' || raw === 'upsell_iof') return 'upsell_iof';
    if (raw === 'upsell-correios' || raw === 'upsell_correios') return 'upsell_correios';
    if (raw === 'upsell-final' || raw === 'upsell_final') return 'upsell_final';
    return raw;
}

function normalizeStepFromContext({
    step = '',
    shipping = null,
    upsell = null,
    payload = null
} = {}) {
    const explicit = normalizeStep(step);
    if (explicit && explicit !== 'front') return explicit;

    const sourceStage = normalizeStep(pickText(upsell?.sourceStage, payload?.sourceStage, payload?.stage));
    if (sourceStage && sourceStage !== 'front' && sourceStage !== 'upsell') return sourceStage;

    const shippingId = String(shipping?.id || payload?.shipping?.id || payload?.shippingId || '').trim().toLowerCase();
    const shippingName = String(shipping?.name || payload?.shipping?.name || payload?.shippingName || '').trim().toLowerCase();
    const upsellKind = String(upsell?.kind || payload?.upsell?.kind || '').trim().toLowerCase();
    const upsellTitle = String(upsell?.title || payload?.upsell?.title || '').trim().toLowerCase();
    const combined = [shippingId, shippingName, upsellKind, upsellTitle].join(' ');

    if (sourceStage === 'upsell') return 'upsell_final';
    if (combined.includes('iof')) return 'upsell_iof';
    if (combined.includes('correios') || combined.includes('objeto_grande')) return 'upsell_correios';
    if (combined.includes('expresso') || combined.includes('prioridade') || combined.includes('adiantamento') || combined.includes('frete_1dia')) return 'upsell_final';
    return 'front';
}

function normalizeStatus(value = '') {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return 'pending';
    if (/refund|estorn|reembols/.test(raw)) return 'refunded';
    if (/refus|recus|fail|cancel|expire|chargeback|declin|reject/.test(raw)) return 'refused';
    if (/(^|[_ -])(paid|pago|approved|aprovado|authorized|confirmado|confirmed|completed|success)([_ -]|$)/.test(raw)) return 'paid';
    return 'pending';
}

function buildPaymentHistoryEntry({
    txid = '',
    gateway = '',
    status = '',
    amount = null,
    createdAt = '',
    changedAt = '',
    step = '',
    shipping = null,
    reward = null,
    upsell = null,
    bump = null,
    payload = null
} = {}) {
    const cleanTxid = String(txid || '').trim();
    if (!cleanTxid) return null;

    const normalizedStep = normalizeStepFromContext({ step, shipping, upsell, payload });
    const normalizedStatus = normalizeStatus(status);
    const createdIso = normalizeIso(createdAt || changedAt);
    const changedIso = normalizeIso(changedAt || createdAt);
    const amountValue = normalizeMoney(amount);
    const bumpSelected = bump?.selected === true && Number(bump?.price || 0) > 0;

    return {
        txid: cleanTxid,
        gateway: String(gateway || '').trim(),
        step: normalizedStep,
        status: normalizedStatus,
        amount: amountValue,
        createdAt: createdIso || '',
        lastStatusAt: changedIso || createdIso || '',
        paidAt: normalizedStatus === 'paid' ? (changedIso || createdIso || '') : '',
        refundedAt: normalizedStatus === 'refunded' ? (changedIso || '') : '',
        refusedAt: normalizedStatus === 'refused' ? (changedIso || '') : '',
        rewardName: pickText(reward?.name, payload?.reward?.name, payload?.rewardName),
        shippingName: pickText(shipping?.name, payload?.shipping?.name, payload?.shippingName),
        shippingId: pickText(shipping?.id, payload?.shipping?.id, payload?.shippingId),
        upsellTitle: pickText(upsell?.title, payload?.upsell?.title),
        bumpSelected,
        bumpTitle: bumpSelected ? pickText(bump?.title, payload?.bump?.title, 'Seguro Bag') : '',
        bumpPrice: bumpSelected ? normalizeMoney(bump?.price) : 0,
        previousTxid: pickText(upsell?.previousTxid, payload?.upsell?.previousTxid)
    };
}

function mergePaymentHistory(basePayload = {}, entryInput = {}) {
    const payload = asObject(basePayload);
    const entry = buildPaymentHistoryEntry({ ...entryInput, payload });
    if (!entry) return payload;

    const history = asArray(payload.paymentHistory)
        .map((item) => asObject(item))
        .filter((item) => String(item.txid || '').trim());
    const next = [...history];
    const index = next.findIndex((item) => String(item.txid || '').trim() === entry.txid);

    if (index >= 0) {
        const current = asObject(next[index]);
        next[index] = {
            ...current,
            ...entry,
            createdAt: pickText(current.createdAt, entry.createdAt),
            paidAt: pickText(current.paidAt, entry.paidAt),
            refundedAt: pickText(current.refundedAt, entry.refundedAt),
            refusedAt: pickText(current.refusedAt, entry.refusedAt),
            lastStatusAt: pickText(entry.lastStatusAt, current.lastStatusAt),
            rewardName: pickText(entry.rewardName, current.rewardName),
            shippingName: pickText(entry.shippingName, current.shippingName),
            shippingId: pickText(entry.shippingId, current.shippingId),
            upsellTitle: pickText(entry.upsellTitle, current.upsellTitle),
            bumpSelected: entry.bumpSelected === true || current.bumpSelected === true,
            bumpTitle: pickText(entry.bumpTitle, current.bumpTitle),
            bumpPrice: normalizeMoney(entry.bumpPrice ?? current.bumpPrice) || 0,
            previousTxid: pickText(entry.previousTxid, current.previousTxid)
        };
    } else {
        next.push(entry);
    }

    next.sort((a, b) => {
        const left = Date.parse(String(a.createdAt || a.lastStatusAt || '')) || 0;
        const right = Date.parse(String(b.createdAt || b.lastStatusAt || '')) || 0;
        return left - right;
    });

    return {
        ...payload,
        paymentHistory: next
    };
}

module.exports = {
    buildPaymentHistoryEntry,
    mergePaymentHistory,
    normalizePaymentHistoryStatus: normalizeStatus,
    normalizePaymentHistoryStep: normalizeStepFromContext
};
