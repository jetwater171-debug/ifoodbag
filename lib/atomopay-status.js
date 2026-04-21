const pick = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');

function asObject(input) {
    return input && typeof input === 'object' && !Array.isArray(input) ? input : {};
}

function looksLikePixCopyPaste(value = '') {
    const text = String(value || '').trim();
    if (!text) return false;
    if (text.startsWith('000201') && text.length >= 30) return true;
    return /br\.gov\.bcb\.pix/i.test(text);
}

function looksLikeImageUrl(value = '') {
    const text = String(value || '').trim();
    if (!/^https?:\/\//i.test(text)) return false;
    return /(?:qr|qrcode|pix|image|imagem)/i.test(text) || /\.(?:png|jpe?g|gif|webp|svg)(?:[?#].*)?$/i.test(text);
}

function looksLikeBase64Image(value = '') {
    const text = String(value || '').trim();
    if (!text || /\s/.test(text) || text.length < 80) return false;
    return /^(?:iVBOR|\/9j\/|R0lGOD|UklGR|PHN2Zy)/.test(text);
}

function collectStringCandidates(input, state = { items: [], visited: new Set() }, path = '', depth = 0) {
    if (input === null || input === undefined) return state.items;
    if (state.items.length >= 240 || depth > 8) return state.items;

    if (typeof input === 'string') {
        const text = input.trim();
        if (text) {
            state.items.push({ path, value: text });
        }
        return state.items;
    }

    if (typeof input !== 'object') return state.items;
    if (state.visited.has(input)) return state.items;
    state.visited.add(input);

    if (Array.isArray(input)) {
        input.slice(0, 16).forEach((value, index) => {
            const nextPath = path ? `${path}[${index}]` : `[${index}]`;
            collectStringCandidates(value, state, nextPath, depth + 1);
        });
        return state.items;
    }

    Object.entries(input).slice(0, 40).forEach(([key, value]) => {
        const nextPath = path ? `${path}.${key}` : key;
        collectStringCandidates(value, state, nextPath, depth + 1);
    });
    return state.items;
}

function scorePixCodeCandidate(candidate = {}) {
    const path = String(candidate.path || '').toLowerCase();
    const text = String(candidate.value || '').trim();
    if (!text) return Number.NEGATIVE_INFINITY;
    let score = 0;
    if (looksLikePixCopyPaste(text)) score += 140;
    if (/(?:^|\.)(?:pix_code|pixcode|br_code|payload|copy|copy_paste|copypaste|code|emv)(?:$|[.\[])/.test(path)) score += 55;
    if (/pix|qr/.test(path)) score += 12;
    if (looksLikeImageUrl(text) || text.startsWith('data:image') || looksLikeBase64Image(text)) score -= 150;
    if (text.length < 24) score -= 40;
    return score;
}

function scoreQrCandidate(candidate = {}) {
    const path = String(candidate.path || '').toLowerCase();
    const text = String(candidate.value || '').trim();
    if (!text) return Number.NEGATIVE_INFINITY;
    let score = 0;
    if (text.startsWith('data:image')) score += 150;
    if (looksLikeImageUrl(text)) score += 135;
    if (looksLikeBase64Image(text)) score += 125;
    if (/(?:^|\.)(?:qr_code|qrcode|qr|image|imagem)(?:$|[.\[])/.test(path)) score += 55;
    if (/pix/.test(path)) score += 12;
    if (looksLikePixCopyPaste(text)) score -= 150;
    if (text.length < 32) score -= 40;
    return score;
}

function pickBestCandidate(candidates = [], scorer, minimumScore = 60) {
    let best = null;
    let bestScore = minimumScore;
    for (const candidate of candidates) {
        const score = Number(scorer(candidate));
        if (score >= bestScore) {
            best = candidate;
            bestScore = score;
        }
    }
    return best;
}

function hasStatusToken(status = '', tokens = []) {
    const normalized = normalizeStatus(status);
    if (!normalized) return false;
    return tokens.some((token) => {
        const cleanToken = normalizeStatus(token);
        if (!cleanToken) return false;
        return normalized === cleanToken || normalized.startsWith(`${cleanToken}_`) || normalized.endsWith(`_${cleanToken}`);
    });
}

function scoreTxidCandidate(candidate = {}) {
    const path = String(candidate.path || '').toLowerCase();
    const text = String(candidate.value || '').trim();
    if (!text || text.length < 4 || text.length > 160) return Number.NEGATIVE_INFINITY;
    if (/customer|document|email|phone|utm|campaign|source|content|term|token|secret/i.test(path)) {
        return Number.NEGATIVE_INFINITY;
    }
    let score = 0;
    if (/(?:transaction_hash|transactionhash|hash)(?:$|[.\[])/.test(path)) score += 120;
    if (/(?:transaction_id|transactionid|id_transaction|idtransaction)(?:$|[.\[])/.test(path)) score += 110;
    if (/(?:transaction|payment|pix|charge|order).*(?:^|\.)(?:id|uuid|reference)(?:$|[.\[])/.test(path)) score += 70;
    if (/(?:^|\.)(?:id|uuid|reference)(?:$|[.\[])/.test(path)) score += 25;
    if (/^[a-z0-9_-]{6,80}$/i.test(text)) score += 15;
    return score;
}

function scoreStatusCandidate(candidate = {}) {
    const path = String(candidate.path || '').toLowerCase();
    const text = String(candidate.value || '').trim();
    if (!text || text.length > 120) return Number.NEGATIVE_INFINITY;
    let score = 0;
    if (/(?:^|\.)(?:status|raw_status|payment_status|transaction_status|status_transaction)(?:$|[.\[])/.test(path)) score += 95;
    if (/(?:^|\.)(?:event|event_type|type|webhook_type)(?:$|[.\[])/.test(path)) score += 45;
    if (
        isAtomopayPaidStatus(text) ||
        isAtomopayRefundedStatus(text) ||
        isAtomopayRefusedStatus(text) ||
        isAtomopayChargebackStatus(text) ||
        isAtomopayPendingStatus(text)
    ) {
        score += 35;
    }
    return score;
}

function classifyCandidate(value = '') {
    const text = String(value || '').trim();
    if (!text) return 'empty';
    if (looksLikePixCopyPaste(text)) return 'pix_code';
    if (text.startsWith('data:image')) return 'qr_data_url';
    if (looksLikeImageUrl(text)) return 'qr_url';
    if (looksLikeBase64Image(text)) return 'qr_base64';
    return 'text';
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

function getAtomopayTxid(payload = {}) {
    const root = asObject(payload);
    const nested = asObject(root.data);
    const transaction = asObject(root.transaction || nested.transaction);
    const payment = asObject(root.payment || nested.payment);
    const pix = asObject(root.pix || nested.pix || transaction.pix || payment.pix);
    const resource = asObject(root.resource || nested.resource || root.object || nested.object);
    const order = asObject(root.order || nested.order || transaction.order || payment.order || resource.order);
    const charge = asObject(root.charge || nested.charge || transaction.charge || payment.charge || resource.charge);
    const candidate = pickBestCandidate(collectStringCandidates(payload), scoreTxidCandidate, 85);
    return String(
        pick(
            root.transaction_hash,
            root.transactionHash,
            root.transaction_id,
            root.transactionId,
            root.id_transaction,
            root.idTransaction,
            root.hash,
            root.id,
            root.reference,
            nested.transaction_hash,
            nested.transactionHash,
            nested.transaction_id,
            nested.transactionId,
            nested.id_transaction,
            nested.idTransaction,
            nested.hash,
            nested.id,
            nested.reference,
            transaction.transaction_hash,
            transaction.transactionHash,
            transaction.transaction_id,
            transaction.transactionId,
            transaction.id_transaction,
            transaction.idTransaction,
            transaction.hash,
            transaction.id,
            transaction.reference,
            payment.transaction_hash,
            payment.transactionHash,
            payment.transaction_id,
            payment.transactionId,
            payment.id_transaction,
            payment.idTransaction,
            payment.hash,
            payment.id,
            payment.reference,
            pix.transaction_hash,
            pix.transactionHash,
            pix.transaction_id,
            pix.transactionId,
            pix.id_transaction,
            pix.idTransaction,
            pix.hash,
            pix.id,
            pix.reference,
            resource.transaction_hash,
            resource.transactionHash,
            resource.transaction_id,
            resource.transactionId,
            resource.hash,
            resource.id,
            resource.reference,
            order.transaction_hash,
            order.transactionHash,
            order.transaction_id,
            order.transactionId,
            order.hash,
            order.id,
            order.reference,
            charge.transaction_hash,
            charge.transactionHash,
            charge.transaction_id,
            charge.transactionId,
            charge.hash,
            charge.id,
            charge.reference,
            candidate?.value
        ) || ''
    ).trim();
}

function getAtomopayStatus(payload = {}) {
    const root = asObject(payload);
    const nested = asObject(root.data);
    const transaction = asObject(root.transaction || nested.transaction);
    const payment = asObject(root.payment || nested.payment);
    const pix = asObject(root.pix || nested.pix || transaction.pix || payment.pix);
    const resource = asObject(root.resource || nested.resource || root.object || nested.object);
    const order = asObject(root.order || nested.order || transaction.order || payment.order || resource.order);
    const charge = asObject(root.charge || nested.charge || transaction.charge || payment.charge || resource.charge);
    const candidate = pickBestCandidate(collectStringCandidates(payload), scoreStatusCandidate, 90);
    return normalizeStatus(
        pick(
            nested.status,
            nested.raw_status,
            nested.payment_status,
            nested.paymentStatus,
            nested.transaction_status,
            nested.transactionStatus,
            nested.status_transaction,
            nested.statusTransaction,
            nested.event,
            nested.event_type,
            nested.eventType,
            nested.webhook_type,
            nested.webhookType,
            nested.type,
            transaction.status,
            transaction.raw_status,
            transaction.payment_status,
            transaction.paymentStatus,
            transaction.transaction_status,
            transaction.transactionStatus,
            transaction.status_transaction,
            transaction.statusTransaction,
            payment.status,
            payment.raw_status,
            payment.payment_status,
            payment.paymentStatus,
            payment.transaction_status,
            payment.transactionStatus,
            payment.status_transaction,
            payment.statusTransaction,
            pix.status,
            pix.raw_status,
            resource.status,
            resource.raw_status,
            resource.payment_status,
            resource.paymentStatus,
            resource.transaction_status,
            resource.transactionStatus,
            order.status,
            order.raw_status,
            charge.status,
            charge.raw_status,
            root.status,
            root.raw_status,
            root.payment_status,
            root.paymentStatus,
            root.transaction_status,
            root.transactionStatus,
            root.status_transaction,
            root.statusTransaction,
            root.event,
            root.event_type,
            root.eventType,
            root.webhook_type,
            root.webhookType,
            root.type,
            candidate?.value,
            hasAtomopayPaidMarker(payload) ? 'paid' : ''
        )
    );
}

function getAtomopayPaidAt(payload = {}) {
    const root = asObject(payload);
    const nested = asObject(root.data);
    const transaction = asObject(root.transaction || nested.transaction);
    const payment = asObject(root.payment || nested.payment);
    const resource = asObject(root.resource || nested.resource || root.object || nested.object);
    const order = asObject(root.order || nested.order || transaction.order || payment.order || resource.order);
    const charge = asObject(root.charge || nested.charge || transaction.charge || payment.charge || resource.charge);
    return pick(
        root.paid_at,
        root.paidAt,
        root.approved_at,
        root.approvedAt,
        root.confirmed_at,
        root.confirmedAt,
        root.completed_at,
        root.completedAt,
        nested.paid_at,
        nested.paidAt,
        nested.approved_at,
        nested.approvedAt,
        nested.confirmed_at,
        nested.confirmedAt,
        nested.completed_at,
        nested.completedAt,
        transaction.paid_at,
        transaction.paidAt,
        transaction.approved_at,
        transaction.approvedAt,
        transaction.confirmed_at,
        transaction.confirmedAt,
        transaction.completed_at,
        transaction.completedAt,
        payment.paid_at,
        payment.paidAt,
        payment.approved_at,
        payment.approvedAt,
        payment.confirmed_at,
        payment.confirmedAt,
        payment.completed_at,
        payment.completedAt,
        resource.paid_at,
        resource.paidAt,
        resource.approved_at,
        resource.approvedAt,
        resource.confirmed_at,
        resource.confirmedAt,
        resource.completed_at,
        resource.completedAt,
        order.paid_at,
        order.paidAt,
        charge.paid_at,
        charge.paidAt
    ) || null;
}

function hasAtomopayPaidMarker(payload = {}) {
    const root = asObject(payload);
    const nested = asObject(root.data);
    const transaction = asObject(root.transaction || nested.transaction);
    const payment = asObject(root.payment || nested.payment);
    const resource = asObject(root.resource || nested.resource || root.object || nested.object);
    const paidAt = String(getAtomopayPaidAt(payload) || '').trim();
    if (paidAt && !/^0{4}-0{2}-0{2}/.test(paidAt)) return true;
    return [
        root.paid,
        root.is_paid,
        root.isPaid,
        nested.paid,
        nested.is_paid,
        nested.isPaid,
        transaction.paid,
        transaction.is_paid,
        transaction.isPaid,
        payment.paid,
        payment.is_paid,
        payment.isPaid,
        resource.paid,
        resource.is_paid,
        resource.isPaid
    ].some((value) => value === true || value === 1 || String(value || '').trim().toLowerCase() === 'true');
}

function getAtomopayUpdatedAt(payload = {}) {
    const root = asObject(payload);
    const nested = asObject(root.data);
    const transaction = asObject(root.transaction || nested.transaction);
    const payment = asObject(root.payment || nested.payment);
    return pick(
        getAtomopayPaidAt(payload),
        root.paid_at,
        root.paidAt,
        nested.paid_at,
        nested.paidAt,
        root.refunded_at,
        root.refundedAt,
        nested.refunded_at,
        nested.refundedAt,
        root.canceled_at,
        root.canceledAt,
        nested.canceled_at,
        nested.canceledAt,
        root.updated_at,
        root.updatedAt,
        nested.updated_at,
        nested.updatedAt,
        root.expires_at,
        root.expiresAt,
        nested.expires_at,
        nested.expiresAt,
        root.created_at,
        root.createdAt,
        nested.created_at,
        nested.createdAt,
        transaction.paid_at,
        transaction.paidAt,
        transaction.updated_at,
        transaction.updatedAt,
        transaction.created_at,
        transaction.createdAt,
        payment.paid_at,
        payment.paidAt,
        payment.updated_at,
        payment.updatedAt,
        payment.created_at,
        payment.createdAt
    ) || null;
}

function getAtomopayAmount(payload = {}) {
    const root = asObject(payload);
    const nested = asObject(root.data);
    const transaction = asObject(root.transaction || nested.transaction);
    const payment = asObject(root.payment || nested.payment);
    const rawValue = pick(
        root.amount,
        root.total_amount,
        nested.amount,
        nested.total_amount,
        transaction.amount,
        transaction.total_amount,
        payment.amount,
        payment.total_amount,
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

function getAtomopayTracking(payload = {}) {
    const root = asObject(payload);
    const nested = asObject(root.data);
    const transaction = asObject(root.transaction || nested.transaction);
    const payment = asObject(root.payment || nested.payment);
    return asObject(nested.tracking || root.tracking || transaction.tracking || payment.tracking);
}

function getAtomopayCustomer(payload = {}) {
    const root = asObject(payload);
    const nested = asObject(root.data);
    const transaction = asObject(root.transaction || nested.transaction);
    const payment = asObject(root.payment || nested.payment);
    return asObject(nested.customer || root.customer || transaction.customer || payment.customer);
}

function resolveAtomopayPixPayload(payload = {}) {
    const root = asObject(payload);
    const nested = asObject(root.data);
    const transaction = asObject(root.transaction || nested.transaction);
    const payment = asObject(root.payment || nested.payment);
    const pix = asObject(root.pix || nested.pix || transaction.pix || payment.pix);
    const qrRaw = String(
        pick(
            root.qr_code,
            root.qrCode,
            root.qrcode,
            nested.qr_code,
            nested.qrCode,
            nested.qrcode,
            transaction.qr_code,
            transaction.qrCode,
            transaction.qrcode,
            payment.qr_code,
            payment.qrCode,
            payment.qrcode,
            pix.qr_code,
            pix.qrCode,
            pix.qrcode,
            pix.qr_code_base64,
            pix.qrCodeBase64,
            pix.qrcodeBase64,
            pix.image,
            pix.imageBase64
        ) || ''
    ).trim();
    const paymentCode = String(
        pick(
            root.pix_code,
            root.pixCode,
            root.br_code,
            root.payload,
            nested.pix_code,
            nested.pixCode,
            nested.br_code,
            nested.payload,
            transaction.pix_code,
            transaction.pixCode,
            transaction.br_code,
            transaction.payload,
            payment.pix_code,
            payment.pixCode,
            payment.br_code,
            payment.payload,
            pix.pix_code,
            pix.pixCode,
            pix.br_code,
            pix.payload,
            pix.copyPaste,
            pix.copy_paste,
            pix.code
        ) || ''
    ).trim();

    const stringCandidates = collectStringCandidates(payload);
    const pixCodeCandidate = !paymentCode ? pickBestCandidate(stringCandidates, scorePixCodeCandidate) : null;
    const qrCandidate = !qrRaw ? pickBestCandidate(stringCandidates, scoreQrCandidate) : null;
    let resolvedPaymentCode = paymentCode || String(pixCodeCandidate?.value || '').trim();
    let resolvedQrRaw = qrRaw || String(qrCandidate?.value || '').trim();
    if (!resolvedPaymentCode && looksLikePixCopyPaste(resolvedQrRaw)) {
        resolvedPaymentCode = resolvedQrRaw;
        resolvedQrRaw = '';
    }

    let paymentCodeBase64 = '';
    let paymentQrUrl = '';
    if (resolvedQrRaw) {
        if (/^https?:\/\//i.test(resolvedQrRaw) || resolvedQrRaw.startsWith('data:image')) {
            paymentQrUrl = resolvedQrRaw;
        } else {
            paymentCodeBase64 = resolvedQrRaw;
        }
    }

    return {
        txid: getAtomopayTxid(payload),
        status: getAtomopayStatus(payload),
        amount: getAtomopayAmount(payload),
        paymentCode: resolvedPaymentCode,
        paymentCodeBase64,
        paymentQrUrl
    };
}

function describeAtomopayPayload(payload = {}) {
    const root = asObject(payload);
    const nested = asObject(root.data);
    const transaction = asObject(root.transaction || nested.transaction);
    const payment = asObject(root.payment || nested.payment);
    const pix = asObject(root.pix || nested.pix || transaction.pix || payment.pix);
    const hints = collectStringCandidates(payload)
        .filter(({ path }) => /status|hash|tx|transaction|pix|qr|code|payload|image/i.test(String(path || '')))
        .slice(0, 20)
        .map(({ path, value }) => ({
            path,
            kind: classifyCandidate(value),
            length: String(value || '').trim().length
        }));
    return {
        txid: getAtomopayTxid(payload),
        status: getAtomopayStatus(payload),
        rootKeys: Object.keys(root).slice(0, 20),
        dataKeys: Object.keys(nested).slice(0, 20),
        transactionKeys: Object.keys(transaction).slice(0, 20),
        paymentKeys: Object.keys(payment).slice(0, 20),
        pixKeys: Object.keys(pix).slice(0, 20),
        hints
    };
}

function isAtomopayPaidStatus(statusRaw) {
    const status = normalizeStatus(statusRaw);
    if (!status) return false;
    if ([
        'paid',
        'approved',
        'approve',
        'confirmed',
        'complete',
        'completed',
        'settled',
        'liquidated',
        'received',
        'payment_paid',
        'payment_approved',
        'transaction_paid',
        'transaction_approved',
        'pix_paid',
        'pix_approved',
        'pago',
        'aprovado',
        'confirmado',
        'concluido',
        'concluida',
        'liquidado'
    ].includes(status)) {
        return true;
    }
    return hasStatusToken(status, ['paid', 'approved', 'confirmed', 'completed', 'pago', 'aprovado', 'confirmado', 'concluido']);
}

function isAtomopayRefundedStatus(statusRaw) {
    const status = normalizeStatus(statusRaw);
    return [
        'refunded',
        'refund',
        'refund_requested',
        'refund_pending',
        'reversed',
        'reversal',
        'estornado',
        'reembolsado'
    ].includes(status) || hasStatusToken(status, ['refunded', 'refund', 'reversed', 'estornado', 'reembolsado']);
}

function isAtomopayRefusedStatus(statusRaw) {
    const status = normalizeStatus(statusRaw);
    return [
        'canceled',
        'cancelled',
        'expired',
        'failed',
        'failure',
        'error',
        'refused',
        'declined',
        'denied',
        'rejected',
        'antifraud',
        'cancelado',
        'expirado',
        'falhou',
        'recusado',
        'negado',
        'rejeitado'
    ].includes(status) || hasStatusToken(status, ['canceled', 'cancelled', 'expired', 'failed', 'refused', 'declined', 'denied', 'rejected', 'cancelado', 'expirado', 'recusado']);
}

function isAtomopayPendingStatus(statusRaw) {
    const status = normalizeStatus(statusRaw);
    return [
        'pending',
        'processing',
        'prossessing',
        'created',
        'generated',
        'waiting',
        'waiting_payment',
        'awaiting_payment',
        'authorized',
        'open',
        'opened',
        'active',
        'gerado',
        'aguardando',
        'aguardando_pagamento'
    ].includes(status) || hasStatusToken(status, ['pending', 'processing', 'created', 'generated', 'waiting_payment', 'awaiting_payment', 'aguardando']);
}

function isAtomopayChargebackStatus(statusRaw) {
    const status = normalizeStatus(statusRaw);
    return ['chargedback', 'chargeback', 'charge_back'].includes(status);
}

function mapAtomopayStatusToUtmify(statusRaw) {
    if (isAtomopayPaidStatus(statusRaw)) return 'paid';
    if (isAtomopayRefundedStatus(statusRaw)) return 'refunded';
    if (isAtomopayChargebackStatus(statusRaw)) return 'chargedback';
    if (isAtomopayRefusedStatus(statusRaw)) return 'refused';
    if (isAtomopayPendingStatus(statusRaw)) return 'waiting_payment';
    return 'waiting_payment';
}

module.exports = {
    normalizeStatus,
    describeAtomopayPayload,
    getAtomopayTxid,
    getAtomopayStatus,
    getAtomopayPaidAt,
    hasAtomopayPaidMarker,
    getAtomopayUpdatedAt,
    getAtomopayAmount,
    getAtomopayTracking,
    getAtomopayCustomer,
    resolveAtomopayPixPayload,
    looksLikePixCopyPaste,
    isAtomopayPaidStatus,
    isAtomopayRefundedStatus,
    isAtomopayRefusedStatus,
    isAtomopayPendingStatus,
    isAtomopayChargebackStatus,
    mapAtomopayStatusToUtmify
};
