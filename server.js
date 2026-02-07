const express = require('express');
const path = require('path');
const fs = require('fs');
const { upsertLead } = require('./lib/lead-store');
const { ensureAllowedRequest, issueSessionCookie } = require('./lib/request-guard');

const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
}

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.ATIVUSHUB_BASE_URL || 'https://api.ativushub.com.br';
const WEBHOOK_TOKEN = process.env.ATIVUSHUB_WEBHOOK_TOKEN || 'dev';

const API_KEY_B64 =
    process.env.ATIVUSHUB_API_KEY_BASE64 ||
    (process.env.ATIVUSHUB_API_KEY
        ? Buffer.from(process.env.ATIVUSHUB_API_KEY, 'utf8').toString('base64')
        : '');

const fetchFn = global.fetch
    ? global.fetch.bind(global)
    : (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const authHeaders = {
    Authorization: `Basic ${API_KEY_B64}`,
    'Content-Type': 'application/json'
};

let cachedSellerId = null;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));

app.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

function sanitizeDigits(value) {
    return String(value || '').replace(/\D/g, '');
}

function pickSellerId(payload) {
    if (!payload || typeof payload !== 'object') return '';
    return (
        payload?.dados_seller?.id_seller ||
        payload?.dados_seller?.idSeller ||
        payload?.dados_seller?.seller_id ||
        payload?.dados_seller?.empresa?.id ||
        payload?.id_seller ||
        payload?.idSeller ||
        ''
    );
}

async function getSellerId() {
    if (process.env.ATIVUSHUB_SELLER_ID) return process.env.ATIVUSHUB_SELLER_ID;
    if (cachedSellerId) return cachedSellerId;

    const response = await fetchFn(`${BASE_URL}/s1/getCompany/`, {
        method: 'GET',
        headers: authHeaders
    });
    const data = await response.json().catch(() => ({}));
    const sellerId = pickSellerId(data);
    if (!sellerId) {
        throw new Error('ID do seller não encontrado na AtivusHUB.');
    }
    cachedSellerId = sellerId;
    return sellerId;
}

function extractIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
        return forwarded.split(',')[0].trim();
    }
    return req.socket?.remoteAddress || '';
}

app.post('/api/pix/create', async (req, res) => {
    if (!ensureAllowedRequest(req, res, { requireSession: true })) {
        return;
    }

    try {
        if (!API_KEY_B64) {
            return res.status(500).json({ error: 'API Key não configurada.' });
        }

        const { amount, personal = {}, address = {}, extra = {}, shipping = {} } = req.body || {};
        const value = Number(amount);

        if (!value || value <= 0) {
            return res.status(400).json({ error: 'Valor do frete inválido.' });
        }

        const name = String(personal.name || '').trim();
        const cpf = sanitizeDigits(personal.cpf || '');
        const email = String(personal.email || '').trim();
        const phone = sanitizeDigits(personal.phoneDigits || personal.phone || '');

        if (!name || !cpf || !email || !phone) {
            return res.status(400).json({ error: 'Dados pessoais incompletos.' });
        }

        const street = String(address.street || '').trim() || String(address.streetLine || '').split(',')[0]?.trim() || '';
        const neighborhood =
            String(address.neighborhood || '').trim() ||
            String(address.streetLine || '').split(',')[1]?.trim() ||
            '';
        const city = String(address.city || '').trim() || String(address.cityLine || '').split('-')[0]?.trim() || '';
        const state = String(address.state || '').trim() || String(address.cityLine || '').split('-')[1]?.trim() || '';
        const zipCode = sanitizeDigits(address.cep || '');

        const streetNumber = extra?.noNumber ? 'S/N' : String(extra?.number || '').trim() || 'S/N';
        const complement = extra?.noComplement ? 'Sem complemento' : String(extra?.complement || '').trim() || 'Sem complemento';

        const sellerId = await getSellerId();
        const postbackUrl =
            process.env.ATIVUSHUB_POSTBACK_URL ||
            `http://localhost:${PORT}/api/pix/webhook?token=${WEBHOOK_TOKEN}`;

        const payload = {
            amount: Number(value.toFixed(2)),
            id_seller: sellerId,
            customer: {
                name,
                email,
                cpf,
                phone,
                address: {
                    street,
                    streetNumber,
                    complement,
                    zipCode,
                    neighborhood,
                    city,
                    state,
                    country: 'br'
                }
            },
            items: [
                {
                    title: 'Frete Bag do iFood',
                    quantity: 1,
                    unitPrice: Number(value.toFixed(2)),
                    tangible: false
                }
            ],
            postbackUrl,
            ip: extractIp(req),
            metadata: {
                shippingId: shipping?.id || '',
                shippingName: shipping?.name || '',
                cep: zipCode,
                reference: extra?.reference || ''
            },
            pix: {
                expiresInDays: 2
            }
        };

        const response = await fetchFn(`${BASE_URL}/v1/gateway/api/`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify(payload)
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            return res.status(response.status).json({
                error: 'Falha ao gerar o PIX.',
                detail: data
            });
        }

        upsertLead({
            ...(req.body || {}),
            event: 'pix_created',
            stage: 'pix',
            pixTxid: data.idTransaction || data.idtransaction || '',
            pixAmount: Number(value.toFixed(2))
        }, req).catch(() => null);

        return res.json({
            idTransaction: data.idTransaction || data.idtransaction,
            paymentCode: data.paymentCode || data.paymentcode,
            paymentCodeBase64: data.paymentCodeBase64 || data.paymentcodebase64,
            status: data.status_transaction || data.status || '',
            amount: Number(value.toFixed(2))
        });
    } catch (error) {
        return res.status(500).json({
            error: 'Erro ao gerar o PIX.',
            detail: error.message || String(error)
        });
    }
});

app.post('/api/lead/track', async (req, res) => {
    if (!ensureAllowedRequest(req, res, { requireSession: true })) {
        return;
    }

    try {
        const result = await upsertLead(req.body || {}, req);
        if (!result.ok && (result.reason === 'missing_supabase_config' || result.reason === 'skipped_no_data')) {
            return res.status(202).json({ ok: false, reason: result.reason });
        }
        if (!result.ok) {
            return res.status(502).json({ ok: false, reason: result.reason, detail: result.detail || '' });
        }
        return res.json({ ok: true });
    } catch (error) {
        return res.status(500).json({ ok: false, error: error.message || String(error) });
    }
});

app.get('/api/site/session', (req, res) => {
    if (!ensureAllowedRequest(req, res, { requireSession: false })) {
        return;
    }
    issueSessionCookie(req, res);
    return res.json({ ok: true });
});

app.post('/api/pix/webhook', (req, res) => {
    const token = req.query.token;
    if (token !== WEBHOOK_TOKEN) {
        return res.status(401).json({ status: 'unauthorized' });
    }
    return res.json({ status: 'success' });
});

app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
});

app.listen(PORT, () => {
    console.log(`Servidor ativo em http://localhost:${PORT}`);
});
