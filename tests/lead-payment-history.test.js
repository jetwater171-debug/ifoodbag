const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildPaymentHistoryEntry,
    normalizePaymentHistoryStep
} = require('../lib/lead-payment-history');

test('recovery Pix is permanently identified as a remarketing payment', () => {
    const entry = buildPaymentHistoryEntry({
        txid: 'pix-recovery-1',
        status: 'waiting_payment',
        amount: 79.9,
        shipping: {
            id: 'remarketing_recovery',
            name: 'Condicao especial de recuperacao'
        }
    });

    assert.equal(entry.step, 'remarketing_recovery');
    assert.equal(entry.shippingId, 'remarketing_recovery');
});

test('explicit recovery stage remains remarketing after payment reconciliation', () => {
    assert.equal(normalizePaymentHistoryStep({
        payload: { sourceStage: 'remarketing_recovery' }
    }), 'remarketing_recovery');
});
