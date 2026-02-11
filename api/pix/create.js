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
    requestTransactionById: requestGhostspayStatus,
    resolvePostbackUrl: resolveGhostspayPostbackUrl
} = require('../../lib/ghostspay-provider');
const {
    requestCreateTransaction: requestSunizeCreate
} = require('../../lib/sunize-provider');
const { getSunizeStatus } = require('../../lib/sunize-status');

function resolveGateway(rawBody = {}, payments = {}) {
    const ativushubEnabled = payments?.gateways?.ativushub?.enabled !== false;
    const ghostspayEnabled = payments?.gateways?.ghostspay?.enabled === true;
    const sunizeEnabled = payments?.gateways?.sunize?.enabled === true;
    const requested = normalizeGatewayId(rawBody.gateway || rawBody.paymentGateway || payments.activeGateway);
    if (requested === 'ghostspay') {
        if (ghostspayEnabled) return 'ghostspay';
        if (sunizeEnabled) return 'sunize';
        return 'ativushub';
    }
    if (requested === 'sunize') {
        if (sunizeEnabled) return 'sunize';
        if (ghostspayEnabled) return 'ghostspay';
        return 'ativushub';
    }
    if (!ativushubEnabled && ghostspayEnabled) {
        return 'ghostspay';
    }
    if (!ativushubEnabled && sunizeEnabled) {
        return 'sunize';
    }
    return 'ativushub';
}

function hasGhostspayCredentials(config = {}) {
    return Boolean(
        String(config.basicAuthBase64 || '').trim() ||
        (String(config.secretKey || '').trim() && String(config.companyId || '').trim())
    );
}

function hasSunizeCredentials(config = {}) {
    return Boolean(
        String(config.apiKey || '').trim() &&
        String(config.apiSecret || '').trim()
    );
}

function toE164Phone(value = '') {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('55') && digits.length >= 12) {
        return `+${digits}`;
    }
    return `+55${digits}`;
}

function resolveDocumentType(document = '') {
    const digits = String(document || '').replace(/\D/g, '');
    return digits.length > 11 ? 'CNPJ' : 'CPF';
}

function pickText(...values) {
    for (const value of values) {
        if (value === undefined || value === null) continue;
        const text = String(value).trim();
        if (text) return text;
    }
    return '';
}

function asObject(input) {
    return input && typeof input === 'object' && !Array.isArray(input) ? input : {};
}

function looksLikePixCopyPaste(value = '') {
    const text = String(value || '').trim();
    if (!text) return false;
    if (text.startsWith('000201') && text.length >= 30) return true;
    return /br\.gov\.bcb\.pix/i.test(text);
}

function resolveGhostspayResponse(data = {}) {
    const root = asObject(data);
    const nested = asObject(root.data);
    const transaction = asObject(root.transaction);
    const payment = asObject(root.payment);
    const pix = asObject(
        root.pix ||
        nested.pix ||
        transaction.pix ||
        payment.pix
    );

    const txid = pickText(
        root.id,
        root.transactionId,
        root.transaction_id,
        root.txid,
        nested.id,
        nested.transactionId,
        nested.transaction_id,
        nested.txid,
        transaction.id,
        payment.id,
        pix.id,
        pix.txid
    );
    let paymentCode = pickText(
        pix.qrcodeText,
        pix.qrCodeText,
        pix.qrcode_text,
        pix.qr_code_text,
        pix.brCode,
        pix.br_code,
        pix.code,
        pix.copyPaste,
        pix.copy_paste,
        pix.emv,
        pix.payload,
        pix.pixCode,
        pix.pix_code,
        root.paymentCode,
        nested.paymentCode,
        root.qrcodeText,
        nested.qrcodeText,
        transaction.qrcodeText,
        payment.qrcodeText,
        root.copyPaste,
        nested.copyPaste
    );
    let qrRaw = pickText(
        pix.qrcode,
        pix.qrCode,
        pix.qrcodeImage,
        pix.qrCodeImage,
        pix.qrcodeBase64,
        pix.qrCodeBase64,
        pix.qr_code_base64,
        pix.image,
        pix.imageBase64,
        pix.base64,
        root.qrcode,
        nested.qrcode,
        root.qrCode,
        nested.qrCode,
        root.qrcodeBase64,
        nested.qrcodeBase64,
        root.qrCodeBase64,
        nested.qrCodeBase64
    );
    const qrUrl = pickText(
        pix.qrcodeUrl,
        pix.qrCodeUrl,
        pix.qrcode_url,
        pix.qr_code_url,
        root.qrcodeUrl,
        nested.qrcodeUrl
    );

    if (!paymentCode && looksLikePixCopyPaste(qrRaw)) {
        paymentCode = qrRaw;
        qrRaw = '';
    }

    let paymentCodeBase64 = '';
    let paymentQrUrl = '';
    if (qrUrl) {
        paymentQrUrl = qrUrl;
    } else if (qrRaw) {
        if (/^https?:\/\//i.test(qrRaw) || qrRaw.startsWith('data:image')) {
            paymentQrUrl = qrRaw;
        } else {
            paymentCodeBase64 = qrRaw;
        }
    }

    const status = pickText(root.status, nested.status, transaction.status, payment.status);
    return { txid, paymentCode, paymentCodeBase64, paymentQrUrl, status };
}

function resolveSunizeResponse(data = {}) {
    const txid = String(
        data?.id ||
        data?.transaction_id ||
        data?.transactionId ||
        data?.data?.id ||
        ''
    ).trim();
    const paymentCode = String(
        data?.pix?.payload ||
        data?.pix?.copyPaste ||
        data?.pix?.copy_paste ||
        data?.pixPayload ||
        ''
    ).trim();
    const qrRaw = String(
        data?.pix?.qrcode ||
        data?.pix?.qrCode ||
        data?.pix?.qr_code ||
        data?.pix?.qrcodeBase64 ||
        data?.pix?.qrCodeBase64 ||
        data?.pix?.qr_code_base64 ||
        ''
    ).trim();
    const qrUrl = String(
        data?.pix?.qrcode_url ||
        data?.pix?.qrCodeUrl ||
        data?.pix?.qr_code_url ||
        ''
    ).trim();
    const externalId = String(data?.external_id || data?.externalId || '').trim();
    const status = getSunizeStatus(data);

    let paymentCodeBase64 = '';
    let paymentQrUrl = '';
    if (qrUrl) {
        paymentQrUrl = qrUrl;
    } else if (qrRaw) {
        if (/^https?:\/\//i.test(qrRaw) || qrRaw.startsWith('data:image')) {
            paymentQrUrl = qrRaw;
        } else {
            paymentCodeBase64 = qrRaw;
        }
    }

    return { txid, paymentCode, paymentCodeBase64, paymentQrUrl, status, externalId };
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
        let externalId = '';

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

            // Some GhostsPay accounts return PIX details asynchronously; hydrate quickly by txid.
            if (txid && !paymentCode && !paymentCodeBase64 && !paymentQrUrl) {
                const quickStatusTimeout = Math.max(
                    1200,
                    Math.min(Number(gatewayConfig.timeoutMs || 12000), 2200)
                );
                const quickConfig = {
                    ...gatewayConfig,
                    timeoutMs: quickStatusTimeout
                };
                const quickStatus = await requestGhostspayStatus(quickConfig, txid).catch(() => ({
                    response: { ok: false },
                    data: {}
                }));
                if (quickStatus?.response?.ok) {
                    const fromStatus = resolveGhostspayResponse(quickStatus.data || {});
                    paymentCode = paymentCode || fromStatus.paymentCode;
                    paymentCodeBase64 = paymentCodeBase64 || fromStatus.paymentCodeBase64;
                    paymentQrUrl = paymentQrUrl || fromStatus.paymentQrUrl;
                    statusRaw = statusRaw || fromStatus.status;
                }
            }
        } else if (gateway === 'sunize') {
            if (!hasSunizeCredentials(gatewayConfig)) {
                return res.status(500).json({ error: 'Credenciais Sunize nao configuradas.' });
            }

            const documentType = resolveDocumentType(cpf);
            const phoneE164 = toE164Phone(phone);
            const externalIdBase = upsellEnabled ? `${orderId}-upsell` : orderId;
            externalId = `${externalIdBase}-${Date.now()}`;

            const sunizeItems = items.map((item, index) => ({
                id: `${shipping?.id || 'item'}-${index + 1}`,
                title: String(item.title || 'Item'),
                description: String(item.title || 'Item'),
                price: Number(Number(item.unitPrice || 0).toFixed(2)),
                quantity: Number(item.quantity || 1),
                is_physical: false
            }));

            const sunizePayload = {
                external_id: externalId,
                total_amount: Number(totalAmount.toFixed(2)),
                payment_method: 'PIX',
                items: sunizeItems,
                ip: extractIp(req),
                customer: {
                    name,
                    email,
                    phone: phoneE164,
                    document_type: documentType,
                    document: cpf
                }
            };

            ({ response, data } = await requestSunizeCreate(gatewayConfig, sunizePayload));
            if (!response?.ok) {
                return res.status(response?.status || 502).json({
                    error: 'Falha ao gerar o PIX.',
                    detail: data
                });
            }
            if (data?.hasError === true) {
                return res.status(502).json({
                    error: 'Falha ao gerar o PIX.',
                    detail: data
                });
            }

            const sunizeData = resolveSunizeResponse(data);
            txid = sunizeData.txid;
            paymentCode = sunizeData.paymentCode;
            paymentCodeBase64 = sunizeData.paymentCodeBase64;
            paymentQrUrl = sunizeData.paymentQrUrl;
            statusRaw = sunizeData.status;
            externalId = sunizeData.externalId || externalId;
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
            pixExternalId: externalId || undefined,
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
            gateway,
            externalId
        };
        res.status(200).json(responsePayload);

        // Side effects run asynchronously to keep PIX generation fast for the buyer.
        (async () => {
            const withTimeout = async (promise, timeoutMs, fallbackValue) => {
                let timeoutRef = null;
                try {
                    return await Promise.race([
                        Promise.resolve(promise),
                        new Promise((resolve) => {
                            timeoutRef = setTimeout(() => resolve(fallbackValue), timeoutMs);
                        })
                    ]);
                } finally {
                    if (timeoutRef) clearTimeout(timeoutRef);
                }
            };

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
            const pushJob = {
                channel: 'pushcut',
                kind: pushKind,
                dedupeKey: txid ? `pushcut:pix_created:${gateway}:${txid}` : null,
                payload: pushPayload
            };
            const pixelJob = {
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
            };

            const [utmImmediate, pushImmediate] = await Promise.all([
                withTimeout(
                    sendUtmfy(utmJob.eventName, utmJob.payload).catch((error) => ({
                        ok: false,
                        reason: error?.message || 'utmfy_immediate_error'
                    })),
                    6000,
                    { ok: false, reason: 'utmfy_timeout' }
                ),
                withTimeout(
                    sendPushcut(pushKind, pushPayload).catch(() => ({ ok: false, reason: 'pushcut_immediate_error' })),
                    6000,
                    { ok: false, reason: 'pushcut_timeout' }
                )
            ]);

            let shouldProcessQueue = false;

            if (!utmImmediate?.ok) {
                await enqueueDispatch(utmJob).catch(() => null);
                shouldProcessQueue = true;
            }

            if (!pushImmediate?.ok) {
                await enqueueDispatch(pushJob).catch(() => null);
                shouldProcessQueue = true;
            }

            await enqueueDispatch(pixelJob).catch(() => null);
            shouldProcessQueue = true;

            if (shouldProcessQueue) {
                await withTimeout(processDispatchQueue(8).catch(() => null), 6000, null);
            }
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
