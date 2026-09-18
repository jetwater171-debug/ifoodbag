const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const config = require('../lib/payment-gateway-config');
const provider = require('../lib/clownpay-provider');
const shared = require('../lib/paradise-provider');

function internals(file, names) {
    const filename = path.resolve(__dirname, '..', file);
    const mod = new Module(filename, module);
    mod.filename = filename;
    mod.paths = Module._nodeModulePaths(path.dirname(filename));
    mod._compile(fs.readFileSync(filename, 'utf8') + `\nmodule.exports.test = { ${names} };`, filename);
    return mod.exports.test;
}

const admin = internals('lib/admin-api-handler.js', 'sanitizeSettingsForAdmin, normalizeGatewayTestSelection, inspectPixTransaction');
const create = internals('api/pix/create.js', 'resolveGatewayCandidates, resolveParadiseResponse, normalizeParadiseCreateStatus');
const status = internals('api/pix/status.js', 'mapGatewayStatusToFrontend, resolveStatusGateway');
const webhook = internals('api/pix/webhook.js', 'extractGatewayEvent');
const originalFetch = global.fetch;
after(() => { global.fetch = originalFetch; });
const clown = config.buildClownPayConfig({ enabled: true, apiKey: 'test-only-key' });
function mock(data, code = 200) {
    const calls = [];
    global.fetch = async (url, options) => {
        calls.push({ url, options });
        return new Response(JSON.stringify(data), { status: code });
    };
    return calls;
}

test('ClownPay can be primary, participates in fallback and retains its own config', () => {
    const payments = config.buildPaymentsConfig({ activeGateway: 'clownpay', gateways: { clownpay: clown, paradise: { enabled: true, apiKey: 'other-key' } } });
    assert.equal(payments.activeGateway, 'clownpay');
    assert.equal(payments.gatewayOrder[0], 'clownpay');
    assert.equal(create.resolveGatewayCandidates({}, payments)[0], 'clownpay');
    assert.equal(payments.gateways.clownpay.baseUrl, 'https://app.clownspay.com');
    assert.equal(payments.gateways.clownpay.source, 'api_externa');
    assert.equal(payments.gateways.paradise.apiKey, 'other-key');
    assert.deepEqual(admin.normalizeGatewayTestSelection(['clownpay', 'invalid']), ['clownpay']);
});

test('admin masks ClownPay secrets', () => {
    const value = admin.sanitizeSettingsForAdmin({ payments: { gateways: { clownpay: clown } } });
    assert.notEqual(value.payments.gateways.clownpay.apiKey, clown.apiKey);
});

test('creation uses documented endpoint, API key, centavos and source; success is pending', async () => {
    const calls = mock({ status: 'success', transaction_id: 238, id: 'ORDER-1', qr_code: '000201', qr_code_base64: 'data:image/png;base64,AA==' });
    const result = await shared.requestCreateTransaction(clown, { amount: 1000, reference: 'ORDER-1', source: 'api_externa' });
    assert.equal(calls[0].url, 'https://app.clownspay.com/api/v1/transaction');
    assert.equal(calls[0].options.headers['X-API-Key'], 'test-only-key');
    assert.equal(JSON.parse(calls[0].options.body).amount, 1000);
    const parsed = create.resolveParadiseResponse(result.data);
    assert.equal(parsed.txid, '238');
    assert.equal(parsed.externalId, 'ORDER-1');
    assert.equal(parsed.paymentCode, '000201');
    assert.equal(create.normalizeParadiseCreateStatus(parsed.status), 'waiting_payment');
});

test('creation does not retry server failures or transport errors', async () => {
    const calls = mock({ error: 'unavailable' }, 500);
    await shared.requestCreateTransaction(clown, { amount: 1000 });
    assert.equal(calls.length, 1);
    let attempts = 0;
    global.fetch = async () => { attempts++; throw new Error('network'); };
    await assert.rejects(shared.requestCreateTransaction(clown, { amount: 1000 }));
    assert.equal(attempts, 1);
});

test('query and callback use ClownPay routes and identifiers', async () => {
    const calls = mock({ id: 238, status: 'pending' });
    await shared.requestTransactionById(clown, '238');
    await shared.requestTransactionByReference(clown, 'ORDER & 1');
    assert.match(calls[0].url, /query\?action=get_transaction&id=238$/);
    assert.match(calls[1].url, /external_id=ORDER%20%26%201$/);
    const url = new URL(shared.resolvePostbackUrl({ headers: { host: 'shop.example' } }, clown));
    assert.equal(url.searchParams.get('gateway'), 'clownpay');
});

test('webhook trusts authenticated status and canonical ID, never the claimed approval', async () => {
    mock([{ id: 238, external_id: 'ORDER-1', amount: 50, status: 'pending' }]);
    const verified = await provider.verifyWebhook(clown, { transaction_id: 'PUBLIC-ID', external_id: 'ORDER-1', status: 'approved', amount: 999999 });
    const event = webhook.extractGatewayEvent('clownpay', verified);
    assert.equal(event.txid, '238');
    assert.equal(event.isPaid, false);
    assert.equal(event.amount, 0.5);
    assert.equal(event.gateway, 'clownpay');
});

test('webhook rejects missing, mismatched and ambiguous references and API failures', async () => {
    await assert.rejects(provider.verifyWebhook(clown, {}));
    for (const rows of [[], [{ id: 1, external_id: 'OTHER' }], [{ id: 1, external_id: 'ORDER' }, { id: 2, external_id: 'ORDER' }]]) {
        mock(rows);
        await assert.rejects(provider.verifyWebhook(clown, { external_id: 'ORDER' }));
    }
    mock({ error: 'unauthorized' }, 401);
    await assert.rejects(provider.verifyWebhook(clown, { external_id: 'ORDER' }));
});

test('status and reconciliation keep ClownPay identity and confirmed amount', async () => {
    assert.equal(status.resolveStatusGateway({}, { payload: { gateway: 'clownpay' } }, {}), 'clownpay');
    for (const [input, expected] of [['approved', 'paid'], ['pending', 'waiting_payment'], ['processing', 'waiting_payment'], ['refunded', 'refunded'], ['failed', 'refused']]) {
        assert.equal(status.mapGatewayStatusToFrontend('clownpay', input), expected);
    }
    mock({ id: 238, external_id: 'ORDER', amount: 1000, status: 'approved' });
    const result = await admin.inspectPixTransaction({ txid: '238', rowGateway: 'clownpay', payments: { gateways: { clownpay: clown } } });
    assert.equal(result.gateway, 'clownpay');
    assert.equal(result.isPaid, true);
    assert.equal(result.amount, 10);
});
