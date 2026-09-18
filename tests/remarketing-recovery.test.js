const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const previousSecret = process.env.REMARKETING_TOKEN_SECRET;

before(() => {
    process.env.REMARKETING_TOKEN_SECRET = 'remarketing-test-secret-with-enough-entropy';
});

after(() => {
    if (previousSecret === undefined) delete process.env.REMARKETING_TOKEN_SECRET;
    else process.env.REMARKETING_TOKEN_SECRET = previousSecret;
});

const {
    issueRecoveryToken,
    verifyRecoveryToken,
    issueRecoveryProof,
    verifyRecoveryProof
} = require('../lib/remarketing-token');
const {
    resolveRecoveryOffer,
    resolveRecoveryGrantBasis,
    resolveRecoveryOfferForGrant,
    buildRecoveryCreateBody,
    toPublicRecoveryOffer
} = require('../lib/remarketing-recovery');

function pendingLead() {
    return {
        session_id: 'lead-session-1',
        name: 'Lucas Moraes',
        cpf: '12345678901',
        email: 'lucas@example.com',
        phone: '11999999999',
        pix_txid: 'pix-old-1',
        pix_amount: 122.8,
        last_event: 'pix_created',
        payload: {
            gateway: 'clownpay',
            personal: {
                name: 'Lucas Moraes',
                cpf: '12345678901',
                email: 'lucas@example.com',
                phone: '11999999999'
            },
            address: {
                cep: '01001000',
                street: 'Praca da Se',
                neighborhood: 'Se',
                city: 'Sao Paulo',
                state: 'SP'
            },
            extra: { number: '10' },
            shipping: { id: 'shipping-standard', name: 'Entrega do kit', price: 19.9 },
            reward: { id: 'kit', name: 'Kit Entregador iFood' },
            pixStatus: 'waiting_payment',
            paymentHistory: [{
                txid: 'pix-old-1',
                gateway: 'clownpay',
                status: 'pending',
                amount: 122.8,
                rewardName: 'Kit Entregador iFood',
                createdAt: '2026-09-18T12:00:00.000Z'
            }]
        }
    };
}

test('recovery token is encrypted, validates and rejects tampering', () => {
    const token = issueRecoveryToken({
        sessionId: 'lead-session-1',
        txid: 'pix-old-1',
        originalAmount: 122.8,
        discountPercent: 20
    });
    const grant = verifyRecoveryToken(token);

    assert.ok(token.startsWith('v1.'));
    assert.equal(token.includes('lead-session-1'), false);
    assert.equal(grant.sessionId, 'lead-session-1');
    assert.equal(grant.txid, 'pix-old-1');
    assert.equal(grant.originalAmount, 122.8);
    assert.equal(grant.discountPercent, 20);
    assert.equal(verifyRecoveryToken(`${token.slice(0, -1)}x`), null);
    const proof = issueRecoveryProof(token);
    assert.equal(verifyRecoveryProof(token, proof), true);
    assert.equal(verifyRecoveryProof(token, `${proof.slice(0, -1)}x`), false);
});

test('pending lead receives a real 20 percent recovery offer', () => {
    const offer = resolveRecoveryOffer(pendingLead());

    assert.equal(offer.canRecover, true);
    assert.equal(offer.paid, false);
    assert.equal(offer.originalAmount, 122.8);
    assert.equal(offer.discountedAmount, 98.24);
    assert.equal(offer.offerName, 'Kit Entregador iFood');

    const publicOffer = toPublicRecoveryOffer(offer);
    assert.equal(publicOffer.customerFirstName, 'Lucas');
    assert.equal('txid' in publicOffer, false);
    assert.equal('sessionId' in publicOffer, false);
});

test('paid lead cannot generate a recovery offer', () => {
    const lead = pendingLead();
    lead.last_event = 'pix_confirmed';
    lead.payload.pixStatus = 'paid';
    lead.payload.paymentHistory[0].status = 'paid';
    lead.payload.paymentHistory[0].paidAt = '2026-09-18T12:05:00.000Z';

    const offer = resolveRecoveryOffer(lead);
    assert.equal(offer.paid, true);
    assert.equal(offer.canRecover, false);
});

test('PIX recreation body comes from stored lead data and carries the signed grant', () => {
    const lead = pendingLead();
    const offer = resolveRecoveryOffer(lead);
    const body = buildRecoveryCreateBody(lead, offer, 'signed-token', 'server-proof');

    assert.equal(body.sessionId, 'lead-session-1');
    assert.equal(body.personal.cpf, '12345678901');
    assert.equal(body.address.cep, '01001000');
    assert.equal(body.reward.id, 'kit');
    assert.equal(body.recoveryToken, 'signed-token');
    assert.equal(body.recoveryProof, 'server-proof');
    assert.equal(body.remarketing.discountPercent, 20);
    assert.equal(body.remarketing.discountedAmount, 98.24);
});

test('reloading after recovery keeps the original 20 percent offer without stacking discounts', () => {
    const lead = pendingLead();
    lead.pix_txid = 'pix-recovery-1';
    lead.pix_amount = 98.24;
    lead.payload.pixStatus = 'waiting_payment';
    lead.payload.remarketing = {
        source: 'recovery_page',
        previousTxid: 'pix-old-1',
        originalAmount: 122.8,
        discountedAmount: 98.24,
        discountPercent: 20
    };
    lead.payload.paymentHistory.push({
        txid: 'pix-recovery-1',
        gateway: 'clownpay',
        status: 'pending',
        amount: 98.24,
        rewardName: 'Kit Entregador iFood',
        createdAt: '2026-09-18T12:10:00.000Z'
    });

    const currentOffer = resolveRecoveryOffer(lead);
    const basis = resolveRecoveryGrantBasis(lead, currentOffer);
    const linkedOffer = resolveRecoveryOfferForGrant(lead, {
        txid: 'pix-old-1',
        originalAmount: 122.8,
        discountPercent: 20
    });

    assert.equal(basis.txid, 'pix-old-1');
    assert.equal(basis.originalAmount, 122.8);
    assert.equal(linkedOffer.txid, 'pix-recovery-1');
    assert.equal(linkedOffer.originalAmount, 122.8);
    assert.equal(linkedOffer.discountedAmount, 98.24);
});
