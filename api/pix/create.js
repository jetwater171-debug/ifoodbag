const {
    API_KEY_B64,
    BASE_URL,
    fetchJson,
    authHeaders,
    sanitizeDigits,
    extractIp,
    getSellerId,
    resolvePostbackUrl
} = require('../../lib/ativus');
const { upsertLead } = require('../../lib/lead-store');
const { ensureAllowedRequest } = require('../../lib/request-guard');
const { enqueueDispatch, processDispatchQueue } = require('../../lib/dispatch-queue');

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    if (!ensureAllowedRequest(req, res, { requireSession: true })) {
        return;
    }

    try {
        if (!API_KEY_B64) {
            return res.status(500).json({ error: 'API Key nao configurada.' });
        }

        let rawBody = {};
        try {
            rawBody = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
        } catch (error) {
            return res.status(400).json({ error: 'JSON invalido no corpo da requisicao.' });
        }

        const { amount, personal = {}, address = {}, extra = {}, shipping = {}, bump } = rawBody;
        const value = Number(amount);

        if (!value || value <= 0) {
            return res.status(400).json({ error: 'Valor do frete invalido.' });
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
        const postbackUrl = resolvePostbackUrl(req);

        const shippingPrice = Number(shipping?.price || 0);
        const bumpPrice = bump?.price ? Number(bump.price) : 0;

        const items = [
            {
                title: 'Frete Bag do iFood',
                quantity: 1,
                unitPrice: Number(shippingPrice.toFixed(2)),
                tangible: false
            }
        ];

        if (bumpPrice > 0) {
            items.push({
                title: bump.title || 'Seguro Bag',
                quantity: 1,
                unitPrice: Number(bumpPrice.toFixed(2)),
                tangible: false
            });
        }

        const totalAmount = Number((shippingPrice + bumpPrice).toFixed(2));
        const orderId = rawBody.sessionId || `order_${Date.now()}`;
        const payload = {
            amount: totalAmount,
            id_seller: sellerId,
            customer: {
                name,
                email,
                cpf,
                phone,
                externaRef: orderId,
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
            checkout: {
                utm_source: rawBody?.utm?.utm_source || '',
                utm_medium: rawBody?.utm?.utm_medium || '',
                utm_campaign: rawBody?.utm?.utm_campaign || '',
                utm_term: rawBody?.utm?.utm_term || '',
                utm_content: rawBody?.utm?.utm_content || '',
                src: rawBody?.utm?.src || '',
                sck: rawBody?.utm?.sck || ''
            },
            items,
            postbackUrl,
            ip: extractIp(req),
            metadata: {
                orderId,
                shippingId: shipping?.id || '',
                shippingName: shipping?.name || '',
                cep: zipCode,
                reference: extra?.reference || '',
                bumpSelected: !!(bump && bump.price),
                bumpPrice: bump?.price || 0
            },
            pix: {
                expiresInDays: 2
            }
        };

        const requestPix = async (attempt) => {
            const { response, data } = await fetchJson(`${BASE_URL}/v1/gateway/api/`, {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify(payload)
            });
            if (response.ok) return { response, data };

            const retryableStatus = [408, 429, 500, 502, 503, 504];
            if (attempt < 1 && retryableStatus.includes(response.status)) {
                console.warn('[pix] retrying request', { status: response.status, attempt: attempt + 1 });
                await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
                return requestPix(attempt + 1);
            }

            return { response, data };
        };

        let response;
        let data;
        try {
            ({ response, data } = await requestPix(0));
        } catch (error) {
            console.error('[pix] request failed', { message: error.message || String(error) });
            return res.status(504).json({ error: 'Falha ao gerar o PIX. Tente novamente.' });
        }

        if (!response.ok) {
            console.error('[pix] request error', { status: response.status, detail: data?.message || '' });
            return res.status(response.status).json({
                error: 'Falha ao gerar o PIX.',
                detail: data
            });
        }

        // Do not block checkout flow on database write.
        upsertLead({
            ...(rawBody || {}),
            event: 'pix_created',
            stage: 'pix',
            pixTxid: data.idTransaction || data.idtransaction || '',
            pixAmount: totalAmount
        }, req).catch(() => null);

        const txid = data.idTransaction || data.idtransaction || '';
        enqueueDispatch({
            channel: 'utmfy',
            eventName: 'pix_created',
            dedupeKey: txid ? `utmfy:pix_created:${txid}` : null,
            payload: {
                orderId,
                amount: totalAmount,
                sessionId: rawBody.sessionId || '',
                personal,
                shipping,
                bump,
                utm: rawBody.utm || {},
                txid,
                createdAt: Date.now(),
                status: 'waiting_payment'
            }
        }).then(() => processDispatchQueue(8)).catch(() => null);

        enqueueDispatch({
            channel: 'pushcut',
            kind: 'pix_created',
            dedupeKey: txid ? `pushcut:pix_created:${txid}` : null,
            payload: {
                txid,
                amount: totalAmount,
                shippingName: shipping?.name || '',
                cep: zipCode
            }
        }).then(() => processDispatchQueue(8)).catch(() => null);

        return res.status(200).json({
            idTransaction: txid,
            paymentCode: data.paymentCode || data.paymentcode,
            paymentCodeBase64: data.paymentCodeBase64 || data.paymentcodebase64,
            status: data.status_transaction || data.status || '',
            amount: totalAmount
        });
    } catch (error) {
        console.error('[pix] unexpected error', { message: error.message || String(error) });
        return res.status(500).json({
            error: 'Erro ao gerar o PIX.',
            detail: error.message || String(error)
        });
    }
};
