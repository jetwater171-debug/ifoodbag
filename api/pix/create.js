const {
    API_KEY_B64,
    BASE_URL,
    fetchFn,
    authHeaders,
    sanitizeDigits,
    extractIp,
    getSellerId,
    resolvePostbackUrl
} = require('../../lib/ativus');

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    try {
        if (!API_KEY_B64) {
            return res.status(500).json({ error: 'API Key não configurada.' });
        }

        const rawBody = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
        const { amount, personal = {}, address = {}, extra = {}, shipping = {}, bump } = rawBody;
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
        const payload = {
            amount: totalAmount,
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
            items,
            postbackUrl,
            ip: extractIp(req),
            metadata: {
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

        return res.status(200).json({
            idTransaction: data.idTransaction || data.idtransaction,
            paymentCode: data.paymentCode || data.paymentcode,
            paymentCodeBase64: data.paymentCodeBase64 || data.paymentcodebase64,
            status: data.status_transaction || data.status || '',
            amount: totalAmount
        });
    } catch (error) {
        return res.status(500).json({
            error: 'Erro ao gerar o PIX.',
            detail: error.message || String(error)
        });
    }
};
