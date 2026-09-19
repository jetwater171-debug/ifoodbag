const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRemarketingSalesReport } = require('../lib/remarketing-sales');
const { extractGatewaySalesEntries } = require('../lib/admin-api-handler')._internals;

const sentSms = (sessionId, txid, sentAt, held = false) => ({
    processed_at: sentAt,
    payload: { sessionId, txid, delivery: { outcome: 'sent', sentAt, held } }
});
const sale = (txid, step, paidAt, amount = 40) => ({
    gateway: 'ghostspay', sessionId: 'lead-1', txid, step, amount, paidAt
});

test('paid recovery Pix appears in remarketing even without SMS', () => {
    const report = buildRemarketingSalesReport([
        { ...sale('recovery-1', 'front', '2026-09-19T12:00:00Z'), shippingId: 'remarketing_recovery' }
    ], []);
    assert.equal(report.summary.sales, 1);
    assert.equal(report.summary.smsSales, 0);
    assert.equal(report.sales[0].attribution, 'link');
});

test('sale after sent SMS counts as SMS revenue, including original Pix', () => {
    const report = buildRemarketingSalesReport([
        sale('original-1', 'front', '2026-09-19T12:15:00Z', 69.9),
        { ...sale('recovery-2', 'remarketing_recovery', '2026-09-19T12:20:00Z', 49.9) }
    ], [sentSms('lead-1', 'original-1', '2026-09-19T12:10:00Z')]);
    assert.equal(report.summary.smsSales, 2);
    assert.equal(report.summary.smsRevenue, 119.8);
    assert.equal(report.summary.revenue, 119.8);
});

test('SMS not sent, held for balance or sent after payment does not claim revenue', () => {
    const report = buildRemarketingSalesReport([
        sale('original-1', 'front', '2026-09-19T12:00:00Z'),
        { ...sale('recovery-1', 'remarketing_recovery', '2026-09-19T12:00:00Z') }
    ], [
        sentSms('lead-1', 'original-1', '2026-09-19T12:10:00Z'),
        sentSms('lead-1', 'original-1', '2026-09-19T11:00:00Z', true)
    ]);
    assert.equal(report.summary.sales, 1);
    assert.equal(report.summary.smsSales, 0);
});

test('paid current Pix is recovered when stale payment history still says pending', () => {
    const entries = extractGatewaySalesEntries({
        session_id: 'lead-1',
        pix_txid: 'recovery-1',
        pix_amount: 49.9,
        shipping_id: 'remarketing_recovery',
        last_event: 'pix_confirmed',
        payload: {
            pixGateway: 'ghostspay',
            pixPaidAt: '2026-09-19T12:00:00Z',
            paymentHistory: [{
                txid: 'recovery-1', gateway: 'ghostspay', step: 'front',
                status: 'pending', amount: 49.9
            }]
        }
    });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].txid, 'recovery-1');
    assert.equal(entries[0].shippingId, 'remarketing_recovery');
});

test('an older front sale is not relabeled by a newer recovery Pix', () => {
    const entries = extractGatewaySalesEntries({
        session_id: 'lead-1',
        pix_txid: 'recovery-pending',
        shipping_id: 'remarketing_recovery',
        payload: {
            pixGateway: 'ghostspay',
            paymentHistory: [{
                txid: 'front-paid', gateway: 'ghostspay', step: 'front',
                status: 'paid', amount: 70, paidAt: '2026-09-19T11:00:00Z'
            }]
        }
    });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].shippingId, '');
    assert.equal(buildRemarketingSalesReport(entries, []).summary.sales, 0);
});
