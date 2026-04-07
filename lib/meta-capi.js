const { URL } = require('url');

const bizSdk = require('facebook-nodejs-business-sdk');
const { ParamBuilder } = require('capi-param-builder-nodejs');
const { getSettings } = require('./settings-store');

const AdsPixel = bizSdk.AdsPixel;

function asObject(input) {
    return input && typeof input === 'object' && !Array.isArray(input) ? input : {};
}

function toText(value, maxLen = 400) {
    const text = String(value || '').trim();
    if (!text) return '';
    return text.length > maxLen ? text.slice(0, maxLen) : text;
}

function toDigits(value, maxLen = 32) {
    const text = String(value || '').replace(/\D/g, '');
    if (!text) return '';
    return text.length > maxLen ? text.slice(0, maxLen) : text;
}

function toNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

function sanitizeSessionToken(value = '', maxLen = 48) {
    const clean = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
    if (!clean) return 'session';
    return clean.slice(0, maxLen);
}

function sanitizeEventId(value = '', maxLen = 120) {
    const clean = String(value || '')
        .trim()
        .replace(/\s+/g, '_')
        .replace(/[^a-zA-Z0-9_.:-]/g, '');
    if (!clean) return '';
    return clean.slice(0, maxLen);
}

function buildLeadEventId(sessionId = '') {
    return `lead_${sanitizeSessionToken(sessionId)}`;
}

function buildAddPaymentInfoEventId(sessionId = '') {
    return `api_${sanitizeSessionToken(sessionId)}`;
}

function buildPurchaseEventId(payload = {}) {
    const pix = asObject(payload?.pix);
    const txid = toText(
        payload?.txid ||
        payload?.pixTxid ||
        payload?.purchaseEventId ||
        pix.idTransaction ||
        pix.idtransaction ||
        pix.txid,
        120
    );
    if (txid) return txid;
    const sessionId = toText(payload?.sessionId || payload?.session_id, 80);
    if (sessionId) return sessionId;
    return `purchase_${sanitizeSessionToken(sessionId)}`;
}

function buildInitiateCheckoutEventId(sessionId = '') {
    return `ic_${sanitizeSessionToken(sessionId)}`;
}

function buildViewContentEventId(sessionId = '') {
    return `vc_${sanitizeSessionToken(sessionId)}`;
}

function buildPageViewEventId(sessionId = '', page = '', sourceUrl = '') {
    const pageToken = sanitizeSessionToken(page || parseUrlSafe(sourceUrl)?.pathname || 'page', 24);
    return `pv_${pageToken}_${sanitizeSessionToken(sessionId, 24)}`;
}

function normalizeTrafficPlatform(value = '') {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    if (raw === 'meta' || raw === 'facebook' || raw === 'fb' || raw === 'instagram' || raw === 'ig') return 'meta';
    if (raw === 'tiktok' || raw === 'tt' || raw === 'tik tok' || raw === 'tik_tok') return 'tiktok';
    if (raw.includes('facebook') || raw.includes('instagram') || raw.includes('meta')) return 'meta';
    if (raw.includes('tiktok')) return 'tiktok';
    return '';
}

function inferTrafficPlatform(input = {}) {
    const ttclid = toText(input?.ttclid || input?.utm?.ttclid, 120);
    const fbclid = toText(input?.fbclid || input?.utm?.fbclid, 120);
    const explicit = normalizeTrafficPlatform(input?.ad_platform || input?.utm?.ad_platform || input?.utm_source || input?.utm?.utm_source || '');
    const referrer = toText(input?.referrer || input?.utm?.referrer, 400).toLowerCase();

    if (ttclid) return 'tiktok';
    if (fbclid) return 'meta';
    if (explicit) return explicit;
    if (referrer.includes('tiktok')) return 'tiktok';
    if (referrer.includes('facebook') || referrer.includes('instagram') || referrer.includes('meta')) return 'meta';
    return '';
}

function isBrowserPixelEnabled(config = {}) {
    return Boolean(config?.enabled && toText(config?.id, 120));
}

function getMetaCapiTargets(config = {}) {
    const capi = asObject(config?.capi);
    if (!capi.enabled) return [];

    const primaryId = toText(config?.id, 120);
    const backupId = toText(config?.backupId, 120);
    const primaryToken = toText(capi?.accessToken, 600);
    const backupToken = toText(capi?.backupAccessToken || capi?.accessToken, 600);
    const primaryTestEventCode = toText(capi?.testEventCode, 120);
    const backupTestEventCode = toText(capi?.backupTestEventCode || capi?.testEventCode, 120);
    const targets = [];

    if (primaryId && primaryToken) {
        targets.push({
            role: 'primary',
            pixelId: primaryId,
            accessToken: primaryToken,
            testEventCode: primaryTestEventCode
        });
    }

    if (backupId && backupId !== primaryId && backupToken) {
        targets.push({
            role: 'backup',
            pixelId: backupId,
            accessToken: backupToken,
            testEventCode: backupTestEventCode
        });
    }

    return targets;
}

function hasMetaCapiTargets(config = {}) {
    return getMetaCapiTargets(config).length > 0;
}

function resolveTrackedPixelProviders(utm = {}, options = {}) {
    const metaPixel = options?.metaConfig || null;
    const tiktokPixel = options?.tiktokConfig || null;
    const hasMeta = isBrowserPixelEnabled(metaPixel);
    const hasTikTok = isBrowserPixelEnabled(tiktokPixel);
    const sourcePlatform = inferTrafficPlatform(utm);

    if (hasMeta && hasTikTok) {
        return {
            sourcePlatform,
            meta: sourcePlatform === 'meta',
            tiktok: sourcePlatform === 'tiktok'
        };
    }

    if (hasMeta) {
        return {
            sourcePlatform,
            meta: sourcePlatform !== 'tiktok',
            tiktok: false
        };
    }

    if (hasTikTok) {
        return {
            sourcePlatform,
            meta: false,
            tiktok: sourcePlatform !== 'meta'
        };
    }

    return {
        sourcePlatform,
        meta: false,
        tiktok: false
    };
}

function shouldSendMetaStandardEvent(metaEventName = '', context = {}, settings = {}) {
    const pixel = asObject(settings?.pixel);
    if (!pixel?.enabled || !toText(pixel?.id, 120) || !hasMetaCapiTargets(pixel)) return false;

    const routing = resolveTrackedPixelProviders(context?.utm || {}, {
        metaConfig: pixel,
        tiktokConfig: asObject(settings?.tiktokPixel)
    });
    const hasResolvedSource = Boolean(toText(routing?.sourcePlatform, 40));

    switch (String(metaEventName || '').trim()) {
        case 'PageView':
            return pixel?.events?.page_view !== false && (routing.meta || !hasResolvedSource);
        case 'ViewContent':
            return pixel?.events?.quiz_view !== false && routing.meta;
        case 'Lead':
            return pixel?.events?.lead !== false && routing.meta;
        case 'InitiateCheckout':
        case 'AddPaymentInfo':
            return pixel?.events?.checkout !== false && routing.meta;
        case 'Purchase':
            return pixel?.events?.purchase !== false && routing.meta;
        default:
            return false;
    }
}

function getRequestMeta(req = null) {
    const forwarded = req?.headers?.['x-forwarded-for'];
    const clientIp = typeof forwarded === 'string' && forwarded
        ? forwarded.split(',')[0].trim()
        : req?.socket?.remoteAddress || '';

    return {
        clientIp: toText(clientIp, 80),
        userAgent: toText(req?.headers?.['user-agent'], 500),
        referrer: toText(req?.headers?.referer || req?.headers?.referrer, 500)
    };
}

function normalizeUnixTime(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        if (value > 1000000000000) return Math.floor(value / 1000);
        if (value > 0) return Math.floor(value);
    }

    const asNumber = Number(value);
    if (Number.isFinite(asNumber) && asNumber > 0) {
        if (asNumber > 1000000000000) return Math.floor(asNumber / 1000);
        return Math.floor(asNumber);
    }

    const parsed = new Date(value || '').getTime();
    if (Number.isFinite(parsed) && parsed > 0) {
        return Math.floor(parsed / 1000);
    }

    return Math.floor(Date.now() / 1000);
}

function createJobPayload(metaEventName = '', eventId = '', context = {}, req = null) {
    const utm = asObject(context?.utm);
    const requestMeta = getRequestMeta(req);

    return {
        eventName: metaEventName,
        eventId,
        eventTime: normalizeUnixTime(context?.eventTime),
        sessionId: toText(context?.sessionId || context?.session_id, 80),
        page: toText(context?.page, 80),
        stage: toText(context?.stage, 80),
        sourceUrl: toText(context?.sourceUrl, 500),
        referrer: toText(context?.referrer || utm?.referrer || requestMeta.referrer, 500),
        utm,
        fbclid: toText(context?.fbclid || utm?.fbclid, 120),
        fbp: toText(context?.fbp, 220),
        fbc: toText(context?.fbc, 240),
        personal: asObject(context?.personal),
        address: asObject(context?.address),
        extra: asObject(context?.extra),
        shipping: asObject(context?.shipping),
        reward: asObject(context?.reward),
        upsell: asObject(context?.upsell),
        bump: asObject(context?.bump),
        pix: asObject(context?.pix),
        amount: toNumber(context?.amount),
        orderId: toText(context?.orderId, 120),
        gateway: toText(context?.gateway, 80),
        isUpsell: context?.isUpsell === true,
        clientIp: toText(context?.clientIp || requestMeta.clientIp, 80),
        userAgent: toText(context?.userAgent || requestMeta.userAgent, 500)
    };
}

function buildDispatchJobs(targets = [], metaEventName = '', eventId = '', context = {}, options = {}) {
    if (!Array.isArray(targets) || !targets.length || !metaEventName || !eventId) return [];
    const scheduledAt = toText(options?.scheduledAt, 80);

    return targets.map((target) => ({
        channel: 'pixel',
        eventName: metaEventName,
        dedupeKey: `pixel:${target.pixelId}:${metaEventName}:${eventId}`,
        ...(scheduledAt ? { scheduledAt } : {}),
        payload: {
            ...createJobPayload(metaEventName, eventId, context, options?.req || null),
            targetPixelId: target.pixelId,
            targetRole: target.role
        }
    }));
}

function buildLeadTrackDispatchJobs(body = {}, req = null, settings = {}) {
    const source = asObject(body);
    const sessionId = toText(source?.sessionId || source?.session_id, 80);
    const eventName = toText(source?.event, 80);
    if (!eventName || !sessionId) return [];

    let metaEventName = '';
    let eventId = '';

    if (eventName === 'personal_submitted') {
        metaEventName = 'Lead';
        eventId = sanitizeEventId(source?.eventId) || buildLeadEventId(sessionId);
    } else if (eventName === 'checkout_view') {
        metaEventName = 'AddPaymentInfo';
        eventId = sanitizeEventId(source?.addPaymentInfoEventId || source?.eventId) || buildAddPaymentInfoEventId(sessionId);
    } else if (eventName === 'pix_view') {
        metaEventName = 'InitiateCheckout';
        eventId = sanitizeEventId(source?.initiateCheckoutEventId || source?.eventId) || buildInitiateCheckoutEventId(sessionId);
    } else if (eventName === 'processing_view') {
        metaEventName = 'ViewContent';
        eventId = sanitizeEventId(source?.viewContentEventId || source?.eventId) || buildViewContentEventId(sessionId);
    }

    if (!metaEventName || !eventId || !shouldSendMetaStandardEvent(metaEventName, source, settings)) {
        return [];
    }

    const targets = getMetaCapiTargets(settings?.pixel);
    return buildDispatchJobs(targets, metaEventName, eventId, source, { req });
}

function buildPageViewDispatchJobs(body = {}, req = null, settings = {}) {
    const source = asObject(body);
    const sessionId = toText(source?.sessionId || source?.session_id, 80);
    const page = toText(source?.page, 80);
    if (!sessionId || !page) return [];

    if (!shouldSendMetaStandardEvent('PageView', source, settings)) {
        return [];
    }

    const eventId = sanitizeEventId(source?.pageViewEventId || source?.eventId)
        || buildPageViewEventId(sessionId, page, source?.sourceUrl);
    const targets = getMetaCapiTargets(settings?.pixel);
    return buildDispatchJobs(targets, 'PageView', eventId, source, { req });
}

function buildLeadDerivedFields(leadData = {}) {
    const payload = asObject(leadData?.payload);
    const personal = {
        ...asObject(payload?.personal)
    };
    if (!personal.name && leadData?.name) personal.name = leadData.name;
    if (!personal.email && leadData?.email) personal.email = leadData.email;
    if (!personal.cpf && leadData?.cpf) personal.cpf = leadData.cpf;
    if (!personal.phone && leadData?.phone) personal.phone = leadData.phone;
    if (!personal.phoneDigits && leadData?.phone) personal.phoneDigits = leadData.phone;

    const address = {
        ...asObject(payload?.address)
    };
    if (!address.cep && leadData?.cep) address.cep = leadData.cep;
    if (!address.street && leadData?.address_line) address.street = leadData.address_line;
    if (!address.neighborhood && leadData?.neighborhood) address.neighborhood = leadData.neighborhood;
    if (!address.city && leadData?.city) address.city = leadData.city;
    if (!address.state && leadData?.state) address.state = leadData.state;
    if (!address.country) address.country = 'br';

    const extra = {
        ...asObject(payload?.extra)
    };
    if (!extra.number && leadData?.number) extra.number = leadData.number;
    if (!extra.complement && leadData?.complement) extra.complement = leadData.complement;
    if (!extra.reference && leadData?.reference) extra.reference = leadData.reference;

    const shipping = {
        ...asObject(payload?.shipping)
    };
    if (!shipping.id && leadData?.shipping_id) shipping.id = leadData.shipping_id;
    if (!shipping.name && leadData?.shipping_name) shipping.name = leadData.shipping_name;
    if (shipping.price === undefined && leadData?.shipping_price !== undefined) {
        shipping.price = leadData.shipping_price;
    }

    const bump = {
        ...asObject(payload?.bump)
    };
    if (bump.selected === undefined) bump.selected = leadData?.bump_selected === true;
    if (bump.price === undefined && leadData?.bump_price !== undefined) bump.price = leadData.bump_price;

    const pix = {
        ...asObject(payload?.pix)
    };
    if (!pix.idTransaction && leadData?.pix_txid) pix.idTransaction = leadData.pix_txid;
    if (pix.amount === undefined && leadData?.pix_amount !== undefined) pix.amount = leadData.pix_amount;

    const utm = {
        ...asObject(payload?.utm)
    };
    if (!utm.utm_source && leadData?.utm_source) utm.utm_source = leadData.utm_source;
    if (!utm.utm_medium && leadData?.utm_medium) utm.utm_medium = leadData.utm_medium;
    if (!utm.utm_campaign && leadData?.utm_campaign) utm.utm_campaign = leadData.utm_campaign;
    if (!utm.utm_term && leadData?.utm_term) utm.utm_term = leadData.utm_term;
    if (!utm.utm_content && leadData?.utm_content) utm.utm_content = leadData.utm_content;
    if (!utm.fbclid && leadData?.fbclid) utm.fbclid = leadData.fbclid;
    if (!utm.gclid && leadData?.gclid) utm.gclid = leadData.gclid;
    if (!utm.ttclid && leadData?.ttclid) utm.ttclid = leadData.ttclid;
    if (!utm.referrer && leadData?.referrer) utm.referrer = leadData.referrer;

    return {
        payload,
        personal,
        address,
        extra,
        shipping,
        bump,
        pix,
        utm
    };
}

function buildPurchaseDispatchJobs(input = {}, settings = {}) {
    const source = asObject(input);
    const leadData = asObject(source?.leadData);
    const {
        payload,
        personal,
        address,
        extra,
        shipping,
        bump,
        pix,
        utm
    } = buildLeadDerivedFields(leadData);

    const sessionId = toText(source?.sessionId || leadData?.session_id || payload?.sessionId, 80);
    const txid = toText(
        source?.txid ||
        leadData?.pix_txid ||
        payload?.pixTxid ||
        pix?.idTransaction ||
        pix?.txid,
        120
    );
    const eventId = sanitizeEventId(source?.purchaseEventId || payload?.purchaseEventId)
        || buildPurchaseEventId({ txid, pix: { idTransaction: txid }, sessionId });

    const context = {
        sessionId,
        stage: toText(source?.stage || leadData?.stage || payload?.stage || 'pix', 80),
        page: toText(source?.page || payload?.page || 'pix', 80),
        sourceUrl: toText(source?.sourceUrl || leadData?.source_url || payload?.sourceUrl, 500),
        referrer: toText(source?.referrer || leadData?.referrer || payload?.utm?.referrer, 500),
        utm,
        fbclid: toText(source?.fbclid || payload?.fbclid || leadData?.fbclid, 120),
        fbp: toText(source?.fbp || payload?.fbp, 220),
        fbc: toText(source?.fbc || payload?.fbc, 240),
        personal,
        address,
        extra,
        shipping,
        reward: asObject(source?.reward || payload?.reward),
        upsell: asObject(source?.upsell || payload?.upsell),
        bump,
        pix: {
            ...pix,
            ...(txid ? { idTransaction: txid, txid } : {})
        },
        amount: toNumber(source?.amount ?? leadData?.pix_amount ?? payload?.pixAmount ?? payload?.amount),
        orderId: toText(source?.orderId || payload?.orderId || sessionId || txid, 120),
        gateway: toText(source?.gateway || payload?.gateway || payload?.pixGateway || leadData?.payment_gateway, 80),
        isUpsell: source?.isUpsell === true || payload?.isUpsell === true,
        eventTime: source?.eventTime || source?.statusChangedAt || payload?.pixPaidAt,
        clientIp: toText(source?.clientIp || leadData?.client_ip, 80),
        userAgent: toText(source?.userAgent || leadData?.user_agent, 500)
    };

    if (!eventId || !shouldSendMetaStandardEvent('Purchase', context, settings)) {
        return [];
    }

    const targets = getMetaCapiTargets(settings?.pixel);
    const delayMs = Math.max(Number(source?.delayMs) || 0, 0);
    const scheduledAt = delayMs > 0 ? new Date(Date.now() + delayMs).toISOString() : '';
    return buildDispatchJobs(targets, 'Purchase', eventId, context, { scheduledAt });
}

function parseUrlSafe(value = '') {
    const text = toText(value, 1000);
    if (!text) return null;
    try {
        return new URL(text);
    } catch (_error) {
        return null;
    }
}

function splitName(fullName = '') {
    const clean = toText(fullName, 180);
    if (!clean) return { firstName: '', lastName: '' };
    const parts = clean.split(/\s+/).filter(Boolean);
    if (!parts.length) return { firstName: '', lastName: '' };
    return {
        firstName: parts[0] || '',
        lastName: parts.slice(1).join(' ')
    };
}

function buildParamBuilder(payload = {}) {
    const parsedUrl = parseUrlSafe(payload?.sourceUrl);
    const host = parsedUrl?.host || '';
    const builder = host ? new ParamBuilder([host]) : new ParamBuilder();
    const queries = {};
    const fbclid = toText(payload?.fbclid || payload?.utm?.fbclid, 120) || toText(parsedUrl?.searchParams?.get('fbclid'), 120);
    if (fbclid) queries.fbclid = fbclid;

    const cookies = {};
    if (toText(payload?.fbp, 220)) cookies._fbp = toText(payload.fbp, 220);
    if (toText(payload?.fbc, 240)) cookies._fbc = toText(payload.fbc, 240);

    builder.processRequest(
        host || '',
        queries,
        cookies,
        toText(payload?.referrer || payload?.utm?.referrer, 500) || null,
        toText(payload?.clientIp, 80) || null,
        toText(payload?.clientIp, 80) || null
    );

    return builder;
}

function buildUserDataPayload(payload = {}, builder) {
    const userData = {};
    const personal = asObject(payload?.personal);
    const address = asObject(payload?.address);
    const { firstName, lastName } = splitName(personal?.name);

    const setField = (key, value) => {
        if (!value) return;
        userData[key] = value;
    };

    setField('client_ip_address', toText(builder?.getClientIpAddress(), 80));
    setField('client_user_agent', toText(payload?.userAgent, 500));
    setField('fbp', toText(builder?.getFbp(), 220));
    setField('fbc', toText(builder?.getFbc(), 240));

    setField('em', builder?.getNormalizedAndHashedPII(toText(personal?.email, 180), 'email'));
    setField('ph', builder?.getNormalizedAndHashedPII(toDigits(personal?.phoneDigits || personal?.phone, 20), 'phone'));
    setField('fn', builder?.getNormalizedAndHashedPII(firstName, 'first_name'));
    setField('ln', builder?.getNormalizedAndHashedPII(lastName, 'last_name'));
    setField('ct', builder?.getNormalizedAndHashedPII(toText(address?.city, 120), 'city'));
    setField('st', builder?.getNormalizedAndHashedPII(toText(address?.state, 32), 'state'));
    setField('zp', builder?.getNormalizedAndHashedPII(toDigits(address?.cep || address?.zip, 12), 'zip_code'));
    setField('country', builder?.getNormalizedAndHashedPII(toText(address?.country || 'br', 8), 'country'));
    setField(
        'external_id',
        builder?.getNormalizedAndHashedPII(
            toText(payload?.sessionId || payload?.orderId, 120),
            'external_id'
        )
    );

    return Object.keys(userData).length ? userData : null;
}

function buildPixelValueData(payload = {}) {
    const explicitValue = toNumber(payload?.amount);
    const shippingValue = toNumber(payload?.shipping?.price) || 0;
    const bumpValue = toNumber(payload?.bump?.price) || 0;
    const rewardValue = toNumber(
        payload?.reward?.checkoutExtraPrice ||
        payload?.reward?.extraPrice ||
        payload?.pix?.rewardExtraPrice
    ) || 0;
    const totalValue = explicitValue && explicitValue > 0
        ? explicitValue
        : Number((shippingValue + bumpValue + rewardValue).toFixed(2));
    const contentName = payload?.isUpsell
        ? toText(payload?.upsell?.title || payload?.shipping?.name || payload?.reward?.name, 160)
        : toText(payload?.reward?.name || payload?.shipping?.name || payload?.upsell?.title, 160);

    return {
        totalValue,
        contentName,
        contentCategory: payload?.isUpsell ? 'upsell' : 'checkout'
    };
}

function buildCustomDataForEvent(payload = {}) {
    const eventName = toText(payload?.eventName, 80);
    const { totalValue, contentName, contentCategory } = buildPixelValueData(payload);
    const customData = {};

    const setField = (key, value) => {
        if (value === null || value === undefined || value === '') return;
        customData[key] = value;
    };

    if (eventName === 'ViewContent') {
        setField('content_name', 'processando');
    }

    if (eventName === 'InitiateCheckout' || eventName === 'AddPaymentInfo' || eventName === 'Purchase') {
        if (totalValue > 0) setField('value', totalValue);
        setField('currency', 'BRL');
    }

    if (eventName === 'Purchase') {
        if (contentName) setField('content_name', contentName);
        if (contentCategory) setField('content_category', contentCategory);
        const orderId = toText(
            payload?.pix?.idTransaction ||
            payload?.pix?.txid ||
            payload?.orderId,
            120
        );
        if (orderId) setField('order_id', orderId);
    }

    const shippingId = toText(payload?.shipping?.id, 120);
    if (shippingId && ['InitiateCheckout', 'AddPaymentInfo', 'Purchase'].includes(eventName)) {
        setField('content_ids', [shippingId]);
        setField('content_type', 'product');
        setField('contents', [{ id: shippingId, quantity: 1 }]);
    }

    return Object.keys(customData).length ? customData : null;
}

function resolveTargetForPayload(settings = {}, payload = {}) {
    const targets = getMetaCapiTargets(settings?.pixel);
    if (!targets.length) return null;
    const targetPixelId = toText(payload?.targetPixelId, 120);
    const targetRole = toText(payload?.targetRole, 40);
    return targets.find((item) => item.pixelId === targetPixelId)
        || targets.find((item) => item.role === targetRole)
        || null;
}

function formatMetaError(error) {
    const pieces = [
        error?.message,
        error?.response?.data?.error?.message,
        error?.response?.data?.error_user_msg
    ]
        .map((item) => toText(item, 240))
        .filter(Boolean);
    return pieces.join(' | ') || 'meta_capi_dispatch_failed';
}

async function dispatchMetaCapiJob(payload = {}) {
    const settings = await getSettings().catch(() => ({}));
    const target = resolveTargetForPayload(settings, payload);
    if (!target || !target.pixelId || !target.accessToken) {
        return { ok: true, skipped: true, reason: 'meta_capi_target_not_configured' };
    }

    const eventName = toText(payload?.eventName, 80);
    const eventId = sanitizeEventId(payload?.eventId);
    if (!eventName || !eventId) {
        return { ok: false, reason: 'invalid_meta_capi_payload' };
    }

    const builder = buildParamBuilder(payload);
    const userData = buildUserDataPayload(payload, builder);
    const customData = buildCustomDataForEvent(payload);
    const sourceUrl = toText(payload?.sourceUrl, 500);
    const eventPayload = {
        event_name: eventName,
        event_time: normalizeUnixTime(payload?.eventTime),
        event_id: eventId,
        action_source: 'website'
    };
    if (sourceUrl) eventPayload.event_source_url = sourceUrl;
    if (userData) eventPayload.user_data = userData;
    if (customData) eventPayload.custom_data = customData;

    bizSdk.FacebookAdsApi.init(target.accessToken);
    const params = {
        data: [eventPayload]
    };
    if (target.testEventCode) {
        params.test_event_code = target.testEventCode;
    }

    try {
        await (new AdsPixel(target.pixelId)).createEvent([], params);
        return { ok: true };
    } catch (error) {
        return {
            ok: false,
            reason: formatMetaError(error)
        };
    }
}

module.exports = {
    buildAddPaymentInfoEventId,
    buildInitiateCheckoutEventId,
    buildLeadTrackDispatchJobs,
    buildLeadEventId,
    buildPageViewDispatchJobs,
    buildPageViewEventId,
    buildPurchaseDispatchJobs,
    buildPurchaseEventId,
    buildViewContentEventId,
    dispatchMetaCapiJob,
    getMetaCapiTargets,
    hasMetaCapiTargets,
    inferTrafficPlatform,
    normalizeTrafficPlatform,
    resolveTrackedPixelProviders,
    sanitizeEventId,
    sanitizeSessionToken,
    shouldSendMetaStandardEvent
};
