const test = require('node:test');
const assert = require('node:assert/strict');

const { callbackItems, eventName, bearerToken, safeEqual } = require('../api/smsmais/webhook')._internals;

test('normaliza callbacks DLR e MO enviados em lote', () => {
    const dlr = { delivery: 'Delivered', externalid: 'pedido-1' };
    const mo = { event: 'reply', message: 'SIM', externalid: 'pedido-2' };
    assert.deepEqual(callbackItems({ events: [dlr, mo] }), [dlr, mo]);
    assert.equal(eventName(dlr), 'dlr');
    assert.equal(eventName(mo), 'mo');
});

test('valida o Bearer Token do webhook sem comparacao insegura', () => {
    assert.equal(bearerToken({ headers: { authorization: 'Bearer segredo' } }), 'segredo');
    assert.equal(safeEqual('segredo', 'segredo'), true);
    assert.equal(safeEqual('errado', 'segredo'), false);
});
