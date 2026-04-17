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
        .replace(/-+/g, '_');
}

function getAtomopayTxid(payload = {}) {
    const root = asObject(payload);
    const nested = asObject(root.data);
    const transaction = asObject(root.transaction || nested.transaction);
    const payment = asObject(root.payment || nested.payment);
    const pix = asObject(root.pix || nested.pix || transaction.pix || payment.pix);
    return String(
        pick(
            root.transaction_hash,
            root.transactionHash,
            root.hash,
            root.id,
            nested.transaction_hash,
            nested.transactionHash,
            nested.hash,
            nested.id,
            transaction.transaction_hash,
            transaction.transactionHash,
            transaction.hash,
            transaction.id,
            payment.transaction_hash,
            payment.transactionHash,
            payment.hash,
            payment.id,
            pix.transaction_hash,
            pix.transactionHash,
            pix.hash,
            pix.id
        ) || ''
    ).trim();
}

function getAtomopayStatus(payload = {}) {
    const root = asObject(payload);
    const nested = asObject(root.data);
    const transaction = asObject(root.transaction || nested.transaction);
    const payment = asObject(root.payment || nested.payment);
    const pix = asObject(root.pix || nested.pix || transaction.pix || payment.pix);
    return normalizeStatus(
        pick(
            root.status,
            nested.status,
            root.raw_status,
            nested.raw_status,
            transaction.status,
            payment.status,
            pix.status
        )
    );
}

function getAtomopayUpdatedAt(payload = {}) {
    const root = asObject(payload);
    const nested = asObject(root.data);
    const transaction = asObject(root.transaction || nested.transaction);
    const payment = asObject(root.payment || nested.payment);
    return pick(
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
    return normalizeStatus(statusRaw) === 'paid';
}

function isAtomopayRefundedStatus(statusRaw) {
    const status = normalizeStatus(statusRaw);
    return status === 'refunded' || status === 'refund';
}

function isAtomopayRefusedStatus(statusRaw) {
    const status = normalizeStatus(statusRaw);
    return ['canceled', 'cancelled', 'expired', 'failed', 'refused', 'declined', 'antifraud'].includes(status);
}

function isAtomopayPendingStatus(statusRaw) {
    const status = normalizeStatus(statusRaw);
    return ['pending', 'processing', 'prossessing', 'created', 'waiting_payment', 'awaiting_payment', 'authorized', 'gerado'].includes(status);
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
