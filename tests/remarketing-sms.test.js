const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
    buildRemarketingUrl,
    renderRemarketingMessage,
    leadHasAnyPaidPayment,
    buildRemarketingSmsJob,
    prepareRemarketingSms,
    checkLivePaymentPaid
} = require('../lib/remarketing-sms');

function pendingLead() {
    return {
        session_id: 'session-remarketing-1',
        name: 'Lucas Moraes',
        phone: '11999998888',
        pix_txid: 'pix-pending-1',
        pix_amount: 100,
        last_event: 'pix_created',
        payload: {
            sessionId: 'session-remarketing-1',
            gateway: 'clownpay',
            pixStatus: 'waiting_payment',
            personal: { name: 'Lucas Moraes', phone: '11999998888' },
            paymentHistory: [{
                txid: 'pix-pending-1',
                gateway: 'clownpay',
                status: 'pending',
                amount: 100
            }]
        }
    };
}

test('remarketing SMS link carries the lead session id', () => {
    const link = buildRemarketingUrl('https://ifoodparceiros.vercel.app/path', 'session 123');
    assert.equal(link, 'https://ifoodparceiros.vercel.app/remarketing?sessionId=session%20123');
});

test('message keeps the complete recovery link inside the SMS limit', () => {
    const link = buildRemarketingUrl('https://ifoodparceiros.vercel.app', '12345678-1234-1234-1234-123456789012');
    const message = renderRemarketingMessage(
        'Oi {nome}, esta mensagem pode ser muito longa mas o link nunca pode ser cortado porque o lead precisa abrir em outro navegador. {link}',
        { name: 'Lucas Moraes', link }
    );

    assert.ok(message.length <= 160);
    assert.ok(message.endsWith(link));
    assert.match(message, /^Oi Lucas/);
});

test('Pix schedules one deduplicated SMS ten minutes later', () => {
    const job = buildRemarketingSmsJob({
        sessionId: 'session-remarketing-1',
        txid: 'pix-pending-1',
        createdAt: '2026-09-18T15:00:00.000Z',
        baseUrl: 'https://ifoodparceiros.vercel.app',
        delayMinutes: 10
    });

    assert.equal(job.kind, 'remarketing_payment_pending');
    assert.equal(job.dedupeKey, 'smsmais:remarketing:session-remarketing-1:pix-pending-1');
    assert.equal(job.scheduledAt, '2026-09-18T15:10:00.000Z');
    assert.equal(job.payload.sessionId, 'session-remarketing-1');
});

test('pending lead receives the admin message and a mounted recovery link', () => {
    const result = prepareRemarketingSms({
        lead: pendingLead(),
        baseUrl: 'https://ifoodparceiros.vercel.app',
        smsConfig: {
            remarketingEnabled: true,
            remarketingMessage: 'Oi {nome}, finalize por aqui: {link}'
        }
    });

    assert.equal(result.ok, true);
    assert.equal(result.skipped, undefined);
    assert.equal(result.payload.to, '11999998888');
    assert.match(result.payload.message, /Oi Lucas/);
    assert.match(result.payload.message, /sessionId=session-remarketing-1$/);
});

test('any confirmed payment suppresses the automatic SMS', () => {
    const lead = pendingLead();
    lead.payload.paymentHistory.unshift({
        txid: 'pix-paid-before',
        status: 'paid',
        amount: 80,
        paidAt: '2026-09-18T15:05:00.000Z'
    });

    assert.equal(leadHasAnyPaidPayment(lead), true);
    const result = prepareRemarketingSms({
        lead,
        baseUrl: 'https://ifoodparceiros.vercel.app',
        smsConfig: { remarketingEnabled: true, remarketingMessage: 'Volte: {link}' }
    });
    assert.equal(result.ok, true);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'lead_already_paid');
});

test('worker checks the payment gateway again before sending', async () => {
    const lead = pendingLead();
    lead.payload.gateway = 'ghostspay';
    lead.payload.paymentHistory[0].gateway = 'ghostspay';
    const payments = { gateways: { ghostspay: { enabled: true, timeoutMs: 3000 } } };

    const paid = await checkLivePaymentPaid(lead, payments, {
        ghostspay: async () => ({ response: { ok: true }, data: { status: 'paid' } })
    });
    const pending = await checkLivePaymentPaid(lead, payments, {
        ghostspay: async () => ({ response: { ok: true }, data: { status: 'waiting_payment' } })
    });

    assert.equal(paid.ok, true);
    assert.equal(paid.paid, true);
    assert.equal(pending.ok, true);
    assert.equal(pending.paid, false);
    assert.equal(pending.pending, true);
});

test('terminal or unknown gateway status never sends an SMS', async () => {
    const lead = pendingLead();
    lead.payload.gateway = 'ghostspay';
    lead.payload.paymentHistory[0].gateway = 'ghostspay';
    const payments = { gateways: { ghostspay: { enabled: true } } };
    const refused = await checkLivePaymentPaid(lead, payments, {
        ghostspay: async () => ({ response: { ok: true }, data: { status: 'refused' } })
    });
    const unknown = await checkLivePaymentPaid(lead, payments, {
        ghostspay: async () => ({ response: { ok: true }, data: {} })
    });
    assert.equal(refused.ok, true);
    assert.equal(refused.pending, false);
    assert.equal(unknown.ok, false);
});

test('admin variables include original value, discounted value and lead identity', () => {
    const result = prepareRemarketingSms({
        lead: pendingLead(),
        baseUrl: 'https://ifoodparceiros.vercel.app',
        smsConfig: {
            remarketingEnabled: true,
            remarketingMessage: '{primeiro_nome}: {preco} / {preco_com_desconto} / {desconto} {link}'
        }
    });
    assert.equal(result.variables.primeiro_nome, 'Lucas');
    assert.equal(result.variables.preco, 'R$ 100,00');
    assert.equal(result.variables.preco_com_desconto, 'R$ 80,00');
    assert.equal(result.variables.desconto, '20%');
    assert.match(result.payload.message, /Lucas: R\$ 100,00 \/ R\$ 80,00 \/ 20%/);
});
