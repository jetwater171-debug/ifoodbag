const { sanitizeDigits, extractIp } = require('../../lib/ativus');
const { upsertLead, getLeadBySessionId } = require('../../lib/lead-store');
const { ensureAllowedRequest } = require('../../lib/request-guard');
const { enqueueDispatch, processDispatchQueue } = require('../../lib/dispatch-queue');
const { normalizeGatewayId } = require('../../lib/payment-gateway-config');
const { getPaymentsConfig } = require('../../lib/payments-config-store');
const {
    requestCreateTransaction: requestAtivushubCreate,
    requestTransactionStatus: requestAtivushubStatus,
    getSellerId: getAtivushubSellerId,
    resolvePostbackUrl: resolveAtivushubPostbackUrl
} = require('../../lib/ativushub-provider');
const {
    requestCreateTransaction: requestGhostspayCreate,
    requestTransactionById: requestGhostspayStatus,
    resolvePostbackUrl: resolveGhostspayPostbackUrl
} = require('../../lib/ghostspay-provider');
const {
    requestCreateTransaction: requestSunizeCreate,
    requestTransactionById: requestSunizeStatus
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

function toBrlAmount(value) {
    if (value === undefined || value === null || value === '') return 0;
    const raw = String(value).trim();
    if (!raw) return 0;
    const normalized = raw.replace(',', '.');
    const num = Number(normalized);
    if (!Number.isFinite(num)) return 0;
    const hasDecimalMark = /[.,]/.test(raw);
    if (hasDecimalMark) return Number(num.toFixed(2));
    if (Number.isInteger(num) && Math.abs(num) >= 100) {
        return Number((num / 100).toFixed(2));
    }
    return Number(num.toFixed(2));
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

function resolveAtivushubStatusResponse(data = {}) {
    const root = asObject(data);
    const nested = asObject(root.data);

    const txid = pickText(
        root.idTransaction,
        root.idtransaction,
        nested.idTransaction,
        nested.idtransaction
    );
    const paymentCode = pickText(
        root.paymentCode,
        root.paymentcode,
        nested.paymentCode,
        nested.paymentcode
    );
    const qrRaw = pickText(
        root.paymentCodeBase64,
        root.paymentcodebase64,
        nested.paymentCodeBase64,
        nested.paymentcodebase64
    );
    let paymentQrUrl = pickText(
        root.paymentQrUrl,
        nested.paymentQrUrl,
        root.qrcodeUrl,
        nested.qrcodeUrl
    );
    let paymentCodeBase64 = '';
    if (!paymentQrUrl && qrRaw) {
        if (/^https?:\/\//i.test(qrRaw) || qrRaw.startsWith('data:image')) {
            paymentQrUrl = qrRaw;
        } else {
            paymentCodeBase64 = qrRaw;
        }
    }

    const status = pickText(
        root.status_transaction,
        root.status,
        nested.status_transaction,
        nested.status
    );
    return { txid, paymentCode, paymentCodeBase64, paymentQrUrl, status, externalId: '' };
}

function normalizeStatus(value = '') {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/-+/g, '_');
}

function isTerminalPixStatus(value = '') {
    const status = normalizeStatus(value);
    if (!status) return false;
    return (
        status === 'paid' ||
        status === 'pix_confirmed' ||
        status === 'approved' ||
        status === 'completed' ||
        status === 'success' ||
        status === 'refunded' ||
        status === 'pix_refunded' ||
        status === 'refused' ||
        status === 'pix_refused' ||
        status === 'failed' ||
        status === 'cancelled' ||
        status === 'canceled' ||
        status === 'expired' ||
        status === 'chargeback' ||
        status === 'chargedback'
    );
}

const PIX_CREATE_INFLIGHT = globalThis.__ifbPixCreateInflightMap || new Map();
if (!globalThis.__ifbPixCreateInflightMap) {
    globalThis.__ifbPixCreateInflightMap = PIX_CREATE_INFLIGHT;
}
const PIX_CREATE_INFLIGHT_TTL_MS = 25000;

function buildPixCreateInflightKey({ sessionId, gateway, shippingId, totalAmount, upsellEnabled }) {
    const cleanSession = String(sessionId || '').trim();
    if (!cleanSession) return '';
    return [
        cleanSession,
        String(normalizeGatewayId(gateway) || 'ativushub'),
        String(shippingId || '').trim(),
        Number(totalAmount || 0).toFixed(2),
        upsellEnabled ? 'upsell' : 'base'
    ].join('|');
}

function getPixCreateInflight(key) {
    if (!key) return null;
    const entry = PIX_CREATE_INFLIGHT.get(key);
    if (!entry) return null;
    if (Number(entry.expiresAt || 0) <= Date.now()) {
        PIX_CREATE_INFLIGHT.delete(key);
        return null;
    }
    return entry;
}

function beginPixCreateInflight(key) {
    if (!key) return null;
    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
    });
    const entry = {
        key,
        promise,
        resolve: resolvePromise,
        reject: rejectPromise,
        expiresAt: Date.now() + PIX_CREATE_INFLIGHT_TTL_MS
    };
    PIX_CREATE_INFLIGHT.set(key, entry);
    return entry;
}

function finishPixCreateInflight(key, entry, result, error) {
    if (!key || !entry) return;
    const current = PIX_CREATE_INFLIGHT.get(key);
    if (current === entry) {
        PIX_CREATE_INFLIGHT.delete(key);
    }
    if (error) {
        try {
            entry.reject(error);
        } catch (_error) {
            // Ignore duplicate rejects.
        }
        return;
    }
    try {
        entry.resolve(result);
    } catch (_error) {
        // Ignore duplicate resolves.
    }
}

async function hydratePixVisualByGateway(gateway, gatewayConfig, txid) {
    if (!txid) {
        return { paymentCode: '', paymentCodeBase64: '', paymentQrUrl: '', status: '', externalId: '' };
    }

    if (gateway === 'ghostspay') {
        const quickConfig = {
            ...gatewayConfig,
            timeoutMs: Math.max(1200, Math.min(Number(gatewayConfig?.timeoutMs || 12000), 3500))
        };
        const { response, data } = await requestGhostspayStatus(quickConfig, txid).catch(() => ({
            response: { ok: false },
            data: {}
        }));
        if (response?.ok) return resolveGhostspayResponse(data || {});
        return { paymentCode: '', paymentCodeBase64: '', paymentQrUrl: '', status: '', externalId: '' };
    }

    if (gateway === 'sunize') {
        const quickConfig = {
            ...gatewayConfig,
            timeoutMs: Math.max(1200, Math.min(Number(gatewayConfig?.timeoutMs || 12000), 3500))
        };
        const { response, data } = await requestSunizeStatus(quickConfig, txid).catch(() => ({
            response: { ok: false },
            data: {}
        }));
        if (response?.ok) return resolveSunizeResponse(data || {});
        return { paymentCode: '', paymentCodeBase64: '', paymentQrUrl: '', status: '', externalId: '' };
    }

    const quickConfig = {
        ...gatewayConfig,
        timeoutMs: Math.max(1200, Math.min(Number(gatewayConfig?.timeoutMs || 12000), 3500))
    };
    const { response, data } = await requestAtivushubStatus(quickConfig, txid).catch(() => ({
        response: { ok: false },
        data: {}
    }));
    if (response?.ok) return resolveAtivushubStatusResponse(data || {});
    return { paymentCode: '', paymentCodeBase64: '', paymentQrUrl: '', status: '', externalId: '' };
}

async function findReusablePixBySession({
    sessionId,
    gateway,
    gatewayConfig,
    totalAmount,
    shippingId,
    upsellEnabled
}) {
    const cleanSession = String(sessionId || '').trim();
    if (!cleanSession) return null;

    const bySession = await getLeadBySessionId(cleanSession).catch(() => ({ ok: false, data: null }));
    const lead = bySession?.ok ? bySession.data : null;
    if (!lead) return null;

    const payload = asObject(lead.payload);
    const storedGateway = normalizeGatewayId(
        payload.gateway ||
        payload.pixGateway ||
        payload.paymentGateway ||
        lead.gateway ||
        gateway
    );
    if (storedGateway !== gateway) return null;

    const txid = pickText(
        lead.pix_txid,
        payload.pixTxid,
        payload.pix?.idTransaction,
        payload.pix?.txid
    );
    if (!txid) return null;

    const lastEvent = String(lead.last_event || '').trim().toLowerCase();
    const statusRaw = pickText(
        payload.pixStatus,
        payload.pix?.status,
        payload.pix?.statusRaw,
        lastEvent
    );
    if (
        payload.pixPaidAt ||
        payload.pixRefundedAt ||
        payload.pixRefusedAt ||
        lastEvent === 'pix_confirmed' ||
        lastEvent === 'pix_refunded' ||
        lastEvent === 'pix_refused' ||
        isTerminalPixStatus(statusRaw)
    ) {
        return null;
    }

    const createdAtRaw = pickText(
        payload.pixCreatedAt,
        payload.pix?.createdAt,
        lead.updated_at,
        lead.created_at
    );
    const createdAtMs = Date.parse(createdAtRaw);
    if (Number.isFinite(createdAtMs) && (Date.now() - createdAtMs) > (20 * 60 * 1000)) {
        return null;
    }

    const storedAmount = Number(payload.pixAmount || lead.pix_amount || payload.pix?.amount || 0);
    if (storedAmount > 0 && totalAmount > 0 && Math.abs(storedAmount - totalAmount) > 0.01) {
        return null;
    }

    const storedShippingId = pickText(payload.shipping?.id, payload.shippingId, lead.shipping_id);
    if (shippingId && storedShippingId && String(shippingId) !== String(storedShippingId)) {
        return null;
    }

    const storedUpsell = Boolean(payload?.upsell?.enabled || payload?.isUpsell);
    if (storedUpsell !== Boolean(upsellEnabled)) return null;

    let paymentCode = pickText(payload?.pix?.paymentCode, payload.paymentCode);
    let paymentCodeBase64 = pickText(payload?.pix?.paymentCodeBase64, payload.paymentCodeBase64);
    let paymentQrUrl = pickText(payload?.pix?.paymentQrUrl, payload.paymentQrUrl);
    let externalId = pickText(payload.pixExternalId, payload?.pix?.externalId);
    let status = statusRaw;

    if (!paymentCode && !paymentCodeBase64 && !paymentQrUrl) {
        const hydrated = await hydratePixVisualByGateway(gateway, gatewayConfig, txid);
        paymentCode = pickText(paymentCode, hydrated.paymentCode);
        paymentCodeBase64 = pickText(paymentCodeBase64, hydrated.paymentCodeBase64);
        paymentQrUrl = pickText(paymentQrUrl, hydrated.paymentQrUrl);
        externalId = pickText(externalId, hydrated.externalId);
        status = pickText(status, hydrated.status);
    }

    return {
        idTransaction: txid,
        paymentCode,
        paymentCodeBase64,
        paymentQrUrl,
        status: status || 'waiting_payment',
        amount: totalAmount > 0 ? totalAmount : storedAmount,
        gateway,
        externalId,
        reused: true
    };
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
        const value = toBrlAmount(amount);
        const upsellEnabled = Boolean(upsell && upsell.enabled);
        const sourceUrl = String(rawBody?.sourceUrl || '').trim();
        const fbclid = String(rawBody?.fbclid || rawBody?.utm?.fbclid || '').trim();
        const fbp = String(rawBody?.fbp || '').trim();
        const fbc = String(rawBody?.fbc || '').trim() || (fbclid ? `fb.1.${Date.now()}.${fbclid}` : '');

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

        let shippingPrice = toBrlAmount(shipping?.price || 0);
        let bumpPrice = bump?.price ? toBrlAmount(bump.price) : 0;
        if (bump?.selected === false) bumpPrice = 0;
        let totalAmount = Number((shippingPrice + bumpPrice).toFixed(2));
        if (totalAmount <= 0 && value > 0) {
            totalAmount = Number(value.toFixed(2));
            if (shippingPrice <= 0) {
                shippingPrice = Number(Math.max(0, totalAmount - bumpPrice).toFixed(2));
            }
        }
        if (!totalAmount || totalAmount <= 0) {
            return res.status(400).json({ error: 'Valor do frete invalido.' });
        }
        const normalizedShipping = {
            ...(shipping || {}),
            id: String(shipping?.id || '').trim() || 'frete',
            name: String(shipping?.name || '').trim() || 'Frete Bag iFood',
            price: shippingPrice,
            basePrice: toBrlAmount(shipping?.basePrice || shipping?.originalPrice || shippingPrice),
            originalPrice: toBrlAmount(shipping?.originalPrice || shipping?.basePrice || shippingPrice)
        };
        const normalizedBump = {
            selected: bumpPrice > 0,
            title: String(bump?.title || 'Seguro Bag').trim() || 'Seguro Bag',
            price: bumpPrice
        };
        const orderId = rawBody.sessionId || `order_${Date.now()}`;
        const pixCreateInflightKey = buildPixCreateInflightKey({
            sessionId: rawBody.sessionId,
            gateway,
            shippingId: String(normalizedShipping?.id || '').trim(),
            totalAmount,
            upsellEnabled
        });
        const existingCreateInflight = getPixCreateInflight(pixCreateInflightKey);
        if (existingCreateInflight) {
            const inflightResult = await existingCreateInflight.promise.catch(() => null);
            if (inflightResult?.payload) {
                return res.status(200).json(inflightResult.payload);
            }
        }

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

        const reusable = await findReusablePixBySession({
            sessionId: rawBody.sessionId,
            gateway,
            gatewayConfig,
            totalAmount,
            shippingId: String(normalizedShipping?.id || '').trim(),
            upsellEnabled
        });
        if (reusable) {
            return res.status(200).json(reusable);
        }

        const createInflightEntry = beginPixCreateInflight(pixCreateInflightKey);
        let createInflightResult = null;
        let createInflightError = null;

        try {
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
                    createInflightError = new Error('ghostspay_missing_credentials');
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
                    shippingId: normalizedShipping?.id || '',
                    shippingName: normalizedShipping?.name || '',
                    cep: zipCode,
                    reference: extra?.reference || '',
                    bumpSelected: normalizedBump.selected,
                    bumpPrice: normalizedBump.price,
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
                    createInflightError = new Error('ghostspay_create_failed');
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
                        650,
                        Math.min(Number(gatewayConfig.timeoutMs || 12000), 900)
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
                    createInflightError = new Error('sunize_missing_credentials');
                    return res.status(500).json({ error: 'Credenciais Sunize nao configuradas.' });
                }

            const documentType = resolveDocumentType(cpf);
            const phoneE164 = toE164Phone(phone);
            const externalIdBase = upsellEnabled ? `${orderId}-upsell` : orderId;
            externalId = `${externalIdBase}-${Date.now()}`;

            const sunizeItems = items.map((item, index) => ({
                id: `${normalizedShipping?.id || 'item'}-${index + 1}`,
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
                    createInflightError = new Error('sunize_create_failed');
                    return res.status(response?.status || 502).json({
                        error: 'Falha ao gerar o PIX.',
                        detail: data
                    });
                }
                if (data?.hasError === true) {
                    createInflightError = new Error('sunize_create_error');
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
                    createInflightError = new Error('ativushub_missing_credentials');
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
                    shippingId: normalizedShipping?.id || '',
                    shippingName: normalizedShipping?.name || '',
                    cep: zipCode,
                    reference: extra?.reference || '',
                    bumpSelected: normalizedBump.selected,
                    bumpPrice: normalizedBump.price,
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
                    createInflightError = new Error('ativushub_create_failed');
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
                createInflightError = new Error('missing_txid');
                return res.status(502).json({
                    error: 'Gateway retornou PIX sem identificador de transacao.',
                    detail: data
                });
            }

            const pixCreatedAt = new Date().toISOString();

            await upsertLead({
            ...(rawBody || {}),
            shipping: normalizedShipping,
            bump: normalizedBump,
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
            paymentCode: paymentCode || undefined,
            paymentCodeBase64: paymentCodeBase64 || undefined,
            paymentQrUrl: paymentQrUrl || undefined,
            pix: {
                ...asObject(rawBody?.pix),
                idTransaction: txid,
                paymentCode,
                paymentCodeBase64,
                paymentQrUrl,
                status: statusRaw || 'waiting_payment',
                gateway,
                amount: totalAmount,
                createdAt: pixCreatedAt,
                externalId: externalId || undefined
            },
            upsell: upsellEnabled ? {
                enabled: true,
                kind: String(upsell?.kind || 'frete_1dia'),
                title: String(upsell?.title || 'Prioridade de envio'),
                price: Number(upsell?.price || totalAmount),
                previousTxid: String(upsell?.previousTxid || '')
            } : null
            }, req).catch(() => null);

            const utmOrderId = orderId;
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
            createInflightResult = responsePayload;
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
                        shipping: normalizedShipping,
                        bump: normalizedBump.selected ? normalizedBump : null,
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
                    shippingName: normalizedShipping?.name || '',
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
                        shippingName: normalizedShipping?.name || '',
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

                let shouldProcessQueue = false;

                const utmQueued = await enqueueDispatch(utmJob).catch(() => null);
                if (utmQueued?.ok || utmQueued?.fallback) {
                    shouldProcessQueue = true;
                }

                const pushQueued = await enqueueDispatch(pushJob).catch(() => null);
                if (pushQueued?.ok || pushQueued?.fallback) {
                    shouldProcessQueue = true;
                }

                const pixelQueued = await enqueueDispatch(pixelJob).catch(() => null);
                if (pixelQueued?.ok || pixelQueued?.fallback) {
                    shouldProcessQueue = true;
                }

                if (shouldProcessQueue) {
                    await processDispatchQueue(12).catch(() => null);
                }
            })().catch((error) => {
                console.error('[pix] side effect error', { message: error?.message || String(error) });
            });

            return;
        } finally {
            if (createInflightEntry) {
                if (createInflightResult) {
                    finishPixCreateInflight(pixCreateInflightKey, createInflightEntry, {
                        ok: true,
                        payload: createInflightResult
                    });
                } else {
                    finishPixCreateInflight(
                        pixCreateInflightKey,
                        createInflightEntry,
                        null,
                        createInflightError || new Error('pix_create_not_completed')
                    );
                }
            }
        }
    } catch (error) {
        console.error('[pix] unexpected error', { message: error.message || String(error) });
        return res.status(500).json({
            error: 'Erro ao gerar o PIX.',
            detail: error.message || String(error)
        });
    }
};
