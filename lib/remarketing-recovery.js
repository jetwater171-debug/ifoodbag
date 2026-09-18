const { normalizePaymentHistoryStatus } = require('./lead-payment-history');

const RECOVERY_DISCOUNT_PERCENT = 20;

function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function pickText(...values) {
    for (const value of values) {
        const text = String(value ?? '').trim();
        if (text) return text;
    }
    return '';
}

function roundMoney(value) {
    const amount = Number(value);
    return Number.isFinite(amount) ? Number(amount.toFixed(2)) : 0;
}

function resolveRecoveryOffer(lead = {}) {
    const payload = asObject(lead?.payload);
    const pix = asObject(payload?.pix);
    const history = Array.isArray(payload?.paymentHistory)
        ? payload.paymentHistory.map(asObject).filter((entry) => pickText(entry?.txid))
        : [];
    const currentTxid = pickText(lead?.pix_txid, payload?.pixTxid, pix?.idTransaction, pix?.txid);
    const currentEntry = history.find((entry) => pickText(entry?.txid) === currentTxid)
        || history.slice().sort((a, b) => {
            const left = Date.parse(pickText(a?.lastStatusAt, a?.createdAt)) || 0;
            const right = Date.parse(pickText(b?.lastStatusAt, b?.createdAt)) || 0;
            return right - left;
        })[0]
        || {};
    const status = normalizePaymentHistoryStatus(pickText(
        currentEntry?.status,
        payload?.pixStatus,
        pix?.status,
        lead?.last_event
    ));
    const hasPaidMarker = Boolean(
        currentEntry?.paidAt ||
        payload?.pixPaidAt ||
        pix?.paidAt ||
        /pix_(?:confirmed|paid)|pagamento_confirmado/i.test(String(lead?.last_event || ''))
    );
    const originalAmount = roundMoney(
        currentEntry?.amount ??
        lead?.pix_amount ??
        payload?.pixAmount ??
        pix?.amount
    );
    const discountPercent = RECOVERY_DISCOUNT_PERCENT;
    const discountedAmount = roundMoney(originalAmount * (1 - discountPercent / 100));
    const reward = asObject(payload?.reward);
    const shipping = asObject(payload?.shipping);
    const upsell = asObject(payload?.upsell);
    const bump = asObject(payload?.bump);
    const personal = asObject(payload?.personal);
    const txid = currentTxid || pickText(currentEntry?.txid);
    const paid = hasPaidMarker || status === 'paid';

    return {
        sessionId: pickText(lead?.session_id, payload?.sessionId, payload?.orderId),
        txid,
        gateway: pickText(currentEntry?.gateway, payload?.gateway, payload?.pixGateway, pix?.gateway),
        status,
        paid,
        canRecover: Boolean(txid && originalAmount > 0 && !paid),
        originalAmount,
        discountedAmount,
        discountPercent,
        customerName: pickText(personal?.name, lead?.name),
        offerName: pickText(
            currentEntry?.upsellTitle,
            upsell?.title,
            currentEntry?.rewardName,
            reward?.name,
            payload?.rewardName,
            currentEntry?.shippingName,
            shipping?.name,
            lead?.shipping_name,
            'Pedido selecionado'
        ),
        createdAt: pickText(currentEntry?.createdAt, payload?.pixCreatedAt, pix?.createdAt, lead?.created_at),
        rewardId: pickText(reward?.id, payload?.rewardId, pix?.rewardId, 'bag'),
        rewardName: pickText(reward?.name, payload?.rewardName, pix?.rewardName),
        shipping,
        bump
    };
}

function resolveRecoveryGrantBasis(lead = {}, offerInput = null) {
    const offer = offerInput || resolveRecoveryOffer(lead);
    const payload = asObject(lead?.payload);
    const remarketing = asObject(payload?.remarketing);
    const isRecoveryCharge = remarketing?.source === 'recovery_page';
    const linkedTxid = isRecoveryCharge ? pickText(remarketing?.previousTxid) : '';
    const linkedOriginalAmount = isRecoveryCharge ? roundMoney(remarketing?.originalAmount) : 0;
    const linkedDiscount = isRecoveryCharge ? Number(remarketing?.discountPercent || 0) : 0;

    if (linkedTxid && linkedOriginalAmount > 0 && linkedDiscount > 0 && linkedDiscount < 100) {
        return {
            txid: linkedTxid,
            originalAmount: linkedOriginalAmount,
            discountPercent: linkedDiscount,
            discountedAmount: roundMoney(linkedOriginalAmount * (1 - linkedDiscount / 100))
        };
    }

    return {
        txid: pickText(offer?.txid),
        originalAmount: roundMoney(offer?.originalAmount),
        discountPercent: Number(offer?.discountPercent || RECOVERY_DISCOUNT_PERCENT),
        discountedAmount: roundMoney(offer?.discountedAmount)
    };
}

function resolveRecoveryOfferForGrant(lead = {}, grant = {}) {
    const offer = resolveRecoveryOffer(lead);
    const basis = resolveRecoveryGrantBasis(lead, offer);
    const matchesGrant =
        pickText(basis?.txid) === pickText(grant?.txid) &&
        Math.abs(Number(basis?.originalAmount || 0) - Number(grant?.originalAmount || 0)) <= 0.01 &&
        Math.abs(Number(basis?.discountPercent || 0) - Number(grant?.discountPercent || 0)) <= 0.01;

    if (!matchesGrant) return null;
    return {
        ...offer,
        originalTxid: basis.txid,
        originalAmount: basis.originalAmount,
        discountPercent: basis.discountPercent,
        discountedAmount: basis.discountedAmount,
        canRecover: Boolean(offer?.txid && !offer?.paid)
    };
}

function buildRecoveryCreateBody(lead = {}, offer = {}, recoveryToken = '', recoveryProof = '') {
    const payload = asObject(lead?.payload);
    const personal = asObject(payload?.personal);
    const address = asObject(payload?.address);
    const extra = asObject(payload?.extra);
    const shipping = asObject(payload?.shipping);
    const reward = asObject(payload?.reward);
    const bump = asObject(payload?.bump);

    return {
        sessionId: offer?.sessionId,
        amount: offer?.originalAmount,
        personal: {
            ...personal,
            name: pickText(personal?.name, lead?.name),
            cpf: pickText(personal?.cpf, lead?.cpf),
            email: pickText(personal?.email, lead?.email),
            phone: pickText(personal?.phone, personal?.phoneDigits, lead?.phone)
        },
        address: {
            ...address,
            cep: pickText(address?.cep, lead?.cep),
            street: pickText(address?.street, lead?.address_line),
            neighborhood: pickText(address?.neighborhood, lead?.neighborhood),
            city: pickText(address?.city, lead?.city),
            state: pickText(address?.state, lead?.state)
        },
        extra: {
            ...extra,
            number: pickText(extra?.number, lead?.number),
            complement: pickText(extra?.complement, lead?.complement),
            reference: pickText(extra?.reference, lead?.reference)
        },
        shipping: {
            ...shipping,
            id: pickText(shipping?.id, lead?.shipping_id, 'remarketing_recovery'),
            name: pickText(shipping?.name, lead?.shipping_name, 'Pedido pendente'),
            price: offer?.originalAmount
        },
        reward: {
            ...reward,
            id: pickText(reward?.id, payload?.rewardId, offer?.rewardId, 'bag'),
            name: pickText(reward?.name, payload?.rewardName, offer?.rewardName)
        },
        bump,
        utm: asObject(payload?.utm),
        sourceStage: 'remarketing_recovery',
        recoveryToken,
        recoveryProof,
        remarketing: {
            source: 'recovery_page',
            discountPercent: offer?.discountPercent,
            originalAmount: offer?.originalAmount,
            discountedAmount: offer?.discountedAmount,
            previousTxid: offer?.originalTxid || offer?.txid
        }
    };
}

function toPublicRecoveryOffer(offer = {}) {
    const firstName = pickText(offer?.customerName).split(/\s+/)[0] || '';
    return {
        status: offer?.paid ? 'paid' : offer?.status,
        paid: offer?.paid === true,
        canRecover: offer?.canRecover === true,
        customerFirstName: firstName,
        offerName: pickText(offer?.offerName, 'Pedido selecionado'),
        originalAmount: roundMoney(offer?.originalAmount),
        discountedAmount: roundMoney(offer?.discountedAmount),
        discountPercent: Number(offer?.discountPercent || RECOVERY_DISCOUNT_PERCENT),
        createdAt: pickText(offer?.createdAt)
    };
}

module.exports = {
    RECOVERY_DISCOUNT_PERCENT,
    resolveRecoveryOffer,
    resolveRecoveryGrantBasis,
    resolveRecoveryOfferForGrant,
    buildRecoveryCreateBody,
    toPublicRecoveryOffer
};
