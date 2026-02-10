const { sanitizeDigits, extractIp } = require('../../lib/ativus');
const { upsertLead } = require('../../lib/lead-store');
const { ensureAllowedRequest } = require('../../lib/request-guard');
const { enqueueDispatch, processDispatchQueue } = require('../../lib/dispatch-queue');
const { sendUtmfy } = require('../../lib/utmfy');
const { sendPushcut } = require('../../lib/pushcut');
const { normalizeGatewayId } = require('../../lib/payment-gateway-config');
const { getPaymentsConfig } = require('../../lib/payments-config-store');
const {
    requestCreateTransaction: requestAtivushubCreate,
    getSellerId: getAtivushubSellerId,
    resolvePostbackUrl: resolveAtivushubPostbackUrl
} = require('../../lib/ativushub-provider');
const {
    requestCreateTransaction: requestGhostspayCreate,
    resolvePostbackUrl: resolveGhostspayPostbackUrl
} = require('../../lib/ghostspay-provider');

function resolveGateway(rawBody = {}, payments = {}) {
    const ativushubEnabled = payments?.gateways?.ativushub?.enabled !== false;
    const ghostspayEnabled = payments?.gateways?.ghostspay?.enabled === true;
    const requested = normalizeGatewayId(rawBody.gateway || rawBody.paymentGateway || payments.activeGateway);
    if (requested === 'ghostspay') {
        return ghostspayEnabled ? 'ghostspay' : 'ativushub';
    }
    if (!ativushubEnabled && ghostspayEnabled) {
        return 'ghostspay';
    }
    return 'ativushub';
}

function hasGhostspayCredentials(config = {}) {
    return Boolean(
        String(config.basicAuthBase64 || '').trim() ||
        (String(config.secretKey || '').trim() && String(config.companyId || '').trim())
    );
}

function resolveGhostspayResponse(data = {}) {
    const pix = data?.pix || {};
    const txid = String(
        data?.id ||
        data?.transactionId ||
        data?.transaction_id ||
        data?.data?.id ||
        data?.data?.transactionId ||
        ''
    ).trim();
    const paymentCode = String(
        pix?.qrcodeText ||
        pix?.qrCodeText ||
        pix?.copyPaste ||
        pix?.emv ||
        data?.paymentCode ||
        ''
    ).trim();
    const qrRaw = String(
        pix?.qrcode ||
        pix?.qrCode ||
        pix?.qrcodeImage ||
        pix?.qrCodeImage ||
        ''
    ).trim();

    let paymentCodeBase64 = '';
    let paymentQrUrl = '';
    if (qrRaw) {
        if (/^https?:\/\//i.test(qrRaw) || qrRaw.startsWith('data:image')) {
            paymentQrUrl = qrRaw;
        } else {
            paymentCodeBase64 = qrRaw;
        }
    }

    const status = String(data?.status || data?.data?.status || '').trim();
    return { txid, paymentCode, paymentCodeBase64, paymentQrUrl, status };
}

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
        let rawBody = {};
        try {
            rawBody = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
        } catch (_error) {
            return res.status(400).json({ error: 'JSON invalido no corpo da requisicao.' });
        }

        const payments = await getPaymentsConfig();
        const gateway = resolveGateway(rawBody, payments);
        const gatewayConfig = payments?.gateways?.[gateway] || {};

        const { amount, personal = {}, address = {}, extra = {}, shipping = {}, bump, upsell = null } = rawBody;
        const value = Number(amount);
        const upsellEnabled = Boolean(upsell && upsell.enabled);
        const sourceUrl = String(rawBody?.sourceUrl || '').trim();
        const fbclid = String(rawBody?.fbclid || rawBody?.utm?.fbclid || '').trim();
        const fbp = String(rawBody?.fbp || '').trim();
        const fbc = String(rawBody?.fbc || '').trim() || (fbclid ? `fb.1.${Date.now()}.${fbclid}` : '');

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

        const shippingPrice = Number(shipping?.price || 0);
        const bumpPrice = bump?.price ? Number(bump.price) : 0;
        const totalAmount = Number((shippingPrice + bumpPrice).toFixed(2));
        const orderId = rawBody.sessionId || `order_${Date.now()}`;

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

        let response;
        let data;
        let txid = '';
        let paymentCode = '';
        let paymentCodeBase64 = '';
        let paymentQrUrl = '';
        let statusRaw = '';

        if (gateway === 'ghostspay') {
            if (!hasGhostspayCredentials(gatewayConfig)) {
                return res.status(500).json({ error: 'Credenciais GhostsPay nao configuradas.' });
            }

            const ghostItems = items.map((item) => ({
                title: item.title,
                quantity: Number(item.quantity || 1),
                unitPrice: Math.max(1, Math.round(Number(item.unitPrice || 0) * 100))
            }));
            const ghostPayload = {
                customer: {
                    name,
                    email,
                    phone,
                    document: {
                        number: cpf,
                        type: 'CPF'
                    }
                },
                paymentMethod: 'PIX',
                amount: Math.max(1, Math.round(totalAmount * 100)),
                items: ghostItems,
                pix: {
                    expiresInDays: 2
                },
                postbackUrl: resolveGhostspayPostbackUrl(req, gatewayConfig),
                ip: extractIp(req),
                description: upsellEnabled ? 'Pedido iFood Bag - Upsell' : 'Pedido iFood Bag',
                metadata: {
                    gateway: 'ghostspay',
                    orderId,
                    shippingId: shipping?.id || '',
                    shippingName: shipping?.name || '',
                    cep: zipCode,
                    reference: extra?.reference || '',
                    bumpSelected: !!(bump && bump.price),
                    bumpPrice: bump?.price || 0,
                    upsellEnabled,
                    upsellKind: upsellEnabled ? String(upsell?.kind || 'frete_1dia') : '',
                    upsellTitle: upsellEnabled ? String(upsell?.title || 'Prioridade de envio') : '',
                    upsellPrice: upsellEnabled ? Number(upsell?.price || 0) : 0,
                    previousTxid: upsellEnabled ? String(upsell?.previousTxid || '') : '',
                    utm_source: rawBody?.utm?.utm_source || '',
                    utm_medium: rawBody?.utm?.utm_medium || '',
                    utm_campaign: rawBody?.utm?.utm_campaign || '',
                    utm_term: rawBody?.utm?.utm_term || '',
                    utm_content: rawBody?.utm?.utm_content || '',
                    src: rawBody?.utm?.src || '',
                    sck: rawBody?.utm?.sck || ''
                }
            };

            ({ response, data } = await requestGhostspayCreate(gatewayConfig, ghostPayload));
            if (!response?.ok) {
                return res.status(response?.status || 502).json({
                    error: 'Falha ao gerar o PIX.',
                    detail: data
                });
            }

            const ghostData = resolveGhostspayResponse(data);
            txid = ghostData.txid;
            paymentCode = ghostData.paymentCode;
            paymentCodeBase64 = ghostData.paymentCodeBase64;
            paymentQrUrl = ghostData.paymentQrUrl;
            statusRaw = ghostData.status;
        } else {
            if (!String(gatewayConfig.apiKeyBase64 || '').trim()) {
                return res.status(500).json({ error: 'API Key da AtivusHUB nao configurada.' });
            }

            const sellerId = await getAtivushubSellerId(gatewayConfig);
            const ativusPayload = {
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
                postbackUrl: resolveAtivushubPostbackUrl(req, gatewayConfig),
                ip: extractIp(req),
                metadata: {
                    gateway: 'ativushub',
                    orderId,
                    shippingId: shipping?.id || '',
                    shippingName: shipping?.name || '',
                    cep: zipCode,
                    reference: extra?.reference || '',
                    bumpSelected: !!(bump && bump.price),
                    bumpPrice: bump?.price || 0,
                    upsellEnabled,
                    upsellKind: upsellEnabled ? String(upsell?.kind || 'frete_1dia') : '',
                    upsellTitle: upsellEnabled ? String(upsell?.title || 'Prioridade de envio') : '',
                    upsellPrice: upsellEnabled ? Number(upsell?.price || 0) : 0,
                    previousTxid: upsellEnabled ? String(upsell?.previousTxid || '') : ''
                },
                pix: {
                    expiresInDays: 2
                }
            };

            ({ response, data } = await requestAtivushubCreate(gatewayConfig, ativusPayload));
            if (!response?.ok) {
                return res.status(response?.status || 502).json({
                    error: 'Falha ao gerar o PIX.',
                    detail: data
                });
            }

            txid = String(data?.idTransaction || data?.idtransaction || '').trim();
            paymentCode = String(data?.paymentCode || data?.paymentcode || '').trim();
            paymentCodeBase64 = String(data?.paymentCodeBase64 || data?.paymentcodebase64 || '').trim();
            statusRaw = String(data?.status_transaction || data?.status || '').trim();
        }

        if (!txid) {
            return res.status(502).json({
                error: 'Gateway retornou PIX sem identificador de transacao.',
                detail: data
            });
        }

        const pixCreatedAt = new Date().toISOString();

        upsertLead({
            ...(rawBody || {}),
            gateway,
            pixGateway: gateway,
            paymentGateway: gateway,
            event: upsellEnabled ? 'upsell_pix_created' : 'pix_created',
            stage: upsellEnabled ? 'upsell' : 'pix',
            pixTxid: txid,
            pixAmount: totalAmount,
            pixCreatedAt,
            pixStatusChangedAt: pixCreatedAt,
            pixStatus: statusRaw || 'waiting_payment',
            upsell: upsellEnabled ? {
                enabled: true,
                kind: String(upsell?.kind || 'frete_1dia'),
                title: String(upsell?.title || 'Prioridade de envio'),
                price: Number(upsell?.price || totalAmount),
                previousTxid: String(upsell?.previousTxid || '')
            } : null
        }, req).catch(() => null);

        const utmOrderId = txid || orderId;
        const responsePayload = {
            idTransaction: txid,
            paymentCode,
            paymentCodeBase64,
            paymentQrUrl,
            status: statusRaw || '',
            amount: totalAmount,
            gateway
        };
        res.status(200).json(responsePayload);

        // Side effects run asynchronously to keep PIX generation fast for the buyer.
        (async () => {
            const utmJob = {
                channel: 'utmfy',
                eventName: upsellEnabled ? 'upsell_pix_created' : 'pix_created',
                dedupeKey: txid ? `utmfy:pix_created:${txid}` : null,
                payload: {
                    orderId: utmOrderId,
                    amount: totalAmount,
                    sessionId: rawBody.sessionId || '',
                    personal,
                    shipping,
                    bump,
                    utm: rawBody.utm || {},
                    txid,
                    gateway,
                    createdAt: pixCreatedAt,
                    status: 'waiting_payment',
                    upsell: upsellEnabled ? {
                        enabled: true,
                        kind: String(upsell?.kind || 'frete_1dia'),
                        title: String(upsell?.title || 'Prioridade de envio'),
                        price: Number(upsell?.price || totalAmount)
                    } : null
                }
            };

            const utmImmediate = await sendUtmfy(utmJob.eventName, utmJob.payload).catch((error) => ({
                ok: false,
                reason: error?.message || 'utmfy_immediate_error'
            }));
            if (!utmImmediate?.ok) {
                await enqueueDispatch(utmJob).catch(() => null);
                await processDispatchQueue(8).catch(() => null);
            }

            const pushPayload = {
                txid,
                orderId: utmOrderId,
                amount: totalAmount,
                customerName: name,
                customerEmail: email,
                shippingName: shipping?.name || '',
                cep: zipCode,
                gateway,
                isUpsell: upsellEnabled
            };
            const pushKind = upsellEnabled ? 'upsell_pix_created' : 'pix_created';
            const pushImmediate = await sendPushcut(pushKind, pushPayload).catch(() => ({ ok: false }));
            if (!pushImmediate?.ok) {
                await enqueueDispatch({
                    channel: 'pushcut',
                    kind: pushKind,
                    dedupeKey: txid ? `pushcut:pix_created:${txid}` : null,
                    payload: pushPayload
                }).catch(() => null);
                await processDispatchQueue(8).catch(() => null);
            }

            await enqueueDispatch({
                channel: 'pixel',
                eventName: 'AddPaymentInfo',
                dedupeKey: txid ? `pixel:add_payment_info:${txid}` : null,
                payload: {
                    amount: totalAmount,
                    orderId: utmOrderId,
                    shippingName: shipping?.name || '',
                    gateway,
                    isUpsell: upsellEnabled,
                    client_email: email,
                    client_document: cpf,
                    source_url: sourceUrl,
                    fbclid,
                    fbp,
                    fbc
                }
            }).catch(() => null);
            await processDispatchQueue(8).catch(() => null);
        })().catch((error) => {
            console.error('[pix] side effect error', { message: error?.message || String(error) });
        });

        return;
    } catch (error) {
        console.error('[pix] unexpected error', { message: error.message || String(error) });
        return res.status(500).json({
            error: 'Erro ao gerar o PIX.',
            detail: error.message || String(error)
        });
    }
};
