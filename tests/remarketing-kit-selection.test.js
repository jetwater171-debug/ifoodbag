const test = require('node:test');
const assert = require('node:assert/strict');

const { remarketingLeadForAdmin, isKitRemarketingLead } = require('../lib/admin-api-handler')._internals;

function kitLead(status = 'waiting_payment') {
    return {
        session_id: 'kit-lead-1',
        name: 'Cliente Kit',
        phone: '11999998888',
        pix_txid: 'kit-pix-1',
        pix_amount: 79.9,
        last_event: status === 'paid' ? 'pix_confirmed' : 'pix_created',
        payload: {
            gateway: 'ghostspay',
            pixStatus: status,
            pixCreatedAt: '2026-09-19T12:00:00.000Z',
            reward: { id: 'kit_entregador', name: 'Kit Entregador iFood' },
            paymentHistory: [{
                txid: 'kit-pix-1', gateway: 'ghostspay', status,
                amount: 79.9, createdAt: '2026-09-19T12:00:00.000Z'
            }]
        }
    };
}

test('pending generated kit is selectable and preserves its Pix date', () => {
    const lead = remarketingLeadForAdmin(kitLead());
    assert.equal(lead.rewardId, 'kit_entregador');
    assert.equal(isKitRemarketingLead(lead), true);
    assert.equal(lead.sessionId, 'kit-lead-1');
    assert.equal(lead.createdAt, '2026-09-19T12:00:00.000Z');
});

test('paid kit is never eligible for bulk selection', () => {
    assert.equal(remarketingLeadForAdmin(kitLead('paid')), null);
    assert.equal(isKitRemarketingLead(null), false);
});

test('other generated Pix cannot enter the kit-only batch', () => {
    const lead = kitLead();
    lead.payload.reward.id = 'bag';
    assert.equal(isKitRemarketingLead(remarketingLeadForAdmin(lead)), false);
});
