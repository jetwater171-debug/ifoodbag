const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const {
    normalizeBrazilPhone,
    normalizeEndpoint,
    sendSmsMaisSms,
    sendSmsMaisVoice,
    getSmsMaisBalance
} = require('../lib/smsmais');

const originalFetch = global.fetch;
after(() => { global.fetch = originalFetch; });

function mockFetch(data, status = 200) {
    const calls = [];
    global.fetch = async (url, options) => {
        calls.push({ url: String(url), options });
        return new Response(JSON.stringify(data), { status });
    };
    return calls;
}

const baseConfig = {
    enabled: true,
    endpoint: 'https://smsmais.com/api/enviar_sms.php',
    batchEndpoint: 'https://smsmais.com/send',
    balanceEndpoint: 'https://smsmais.com/saldo',
    token: 'test-only-token',
    timeoutMs: 3000
};

test('normaliza celulares brasileiros e rejeita numeros invalidos', () => {
    assert.equal(normalizeBrazilPhone('(11) 99999-8888'), '5511999998888');
    assert.equal(normalizeBrazilPhone('+55 31 98765-4321'), '5531987654321');
    assert.equal(normalizeBrazilPhone('123'), '');
});

test('aceita apenas endpoints HTTPS oficiais da SMSMais', () => {
    assert.equal(normalizeEndpoint('https://smsmais.com/api/send.php', ''), 'https://smsmais.com/api/send.php');
    assert.equal(normalizeEndpoint('https://api.smsmais.com.br/v1/sms/send', ''), 'https://api.smsmais.com.br/v1/sms/send');
    assert.equal(normalizeEndpoint('http://smsmais.com/api/send.php', ''), '');
    assert.equal(normalizeEndpoint('https://example.com/send', ''), '');
});

test('envia SMS individual com Bearer Token e identificador externo', async () => {
    const calls = mockFetch({ sucesso: true, id: 123, status: 'queued' });
    const result = await sendSmsMaisSms({
        to: '(11) 99999-8888',
        message: 'Teste de integracao',
        externalId: 'pedido 123'
    }, baseConfig);

    assert.equal(result.ok, true);
    assert.equal(result.to, '5511999998888');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, baseConfig.endpoint);
    assert.equal(calls[0].options.headers.Authorization, 'Bearer test-only-token');
    assert.deepEqual(JSON.parse(calls[0].options.body), {
        to: '5511999998888',
        message: 'Teste de integracao',
        tipo: 'sms',
        ext_id: 'pedido-123'
    });
});

test('considera held_no_balance aceito para evitar envio duplicado', async () => {
    mockFetch({ sucesso: true, id: 124, status: 'held_no_balance' });
    const result = await sendSmsMaisSms({ to: '11999998888', message: 'Teste' }, baseConfig);
    assert.equal(result.ok, true);
    assert.equal(result.held, true);
});

test('envia torpedo de voz pelo endpoint em lote com URL publica', async () => {
    const calls = mockFetch([{ id: 88, status: 'queued' }]);
    const result = await sendSmsMaisVoice({
        to: '31987654321',
        message: 'Teste de voz',
        audioUrl: 'https://cdn.example.com/audio.mp3',
        externalId: 'voz-1'
    }, baseConfig);

    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, baseConfig.batchEndpoint);
    assert.deepEqual(JSON.parse(calls[0].options.body), {
        messages: [{
            id: 'voz-1',
            destinations: [{ to: '5531987654321' }],
            msg: 'Teste de voz',
            audio: 'https://cdn.example.com/audio.mp3'
        }]
    });
});

test('falha antes da rede quando token ou audio nao foram configurados', async () => {
    let calls = 0;
    global.fetch = async () => { calls += 1; throw new Error('nao deveria chamar'); };
    const noToken = await sendSmsMaisSms({ to: '11999998888', message: 'Teste' }, { ...baseConfig, token: '' });
    const noAudio = await sendSmsMaisVoice({ to: '11999998888', message: 'Teste' }, baseConfig);
    assert.equal(noToken.reason, 'missing_token');
    assert.equal(noAudio.reason, 'invalid_audio_url');
    assert.equal(calls, 0);
});

test('consulta saldo usando Bearer Token sem expor a credencial', async () => {
    const calls = mockFetch({ success: true, data: { saldo: 16.56, sms_equivalente: 207, voz_equivalente: 207 } });
    const result = await getSmsMaisBalance(baseConfig);
    assert.equal(result.ok, true);
    assert.equal(result.data.data.saldo, 16.56);
    assert.equal(calls[0].url, baseConfig.balanceEndpoint);
    assert.equal(calls[0].options.headers.Authorization, 'Bearer test-only-token');
});
