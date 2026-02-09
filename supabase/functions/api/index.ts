// Supabase Edge Function: api (routes /api/*)
const textEncoder = new TextEncoder();

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || Deno.env.get('SUPABASE_PROJECT_URL') || '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE') || '';
const SETTINGS_KEY = 'admin_config';
const ATIVUS_BASE_URL = Deno.env.get('ATIVUSHUB_BASE_URL') || 'https://api.ativushub.com.br';
const ATIVUS_WEBHOOK_TOKEN = Deno.env.get('ATIVUSHUB_WEBHOOK_TOKEN') || 'dev';

const ADMIN_COOKIE = 'ifb_admin';
const ADMIN_COOKIE_LEGACY = '__Host-ifb_admin';
const ADMIN_TTL_SEC = Number(Deno.env.get('APP_ADMIN_TTL_SEC') || 60 * 60 * 8);
const GUARD_SECRET = Deno.env.get('APP_GUARD_SECRET') || 'change-this-secret-in-production';
const ADMIN_PASSWORD_FALLBACK = (Deno.env.get('APP_ADMIN_PASSWORD_FALLBACK') || 'Leo12345!').trim();

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  });
}

function corsHeaders(origin = '*') {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Max-Age': '86400'
  };
}

function base64UrlEncode(bytes) {
  const bin = String.fromCharCode(...bytes);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(str.length + (4 - (str.length % 4 || 4)), '=');
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmacSign(input, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, textEncoder.encode(input));
  return base64UrlEncode(new Uint8Array(sig));
}

async function sha256Hex(value) {
  const data = await crypto.subtle.digest('SHA-256', textEncoder.encode(String(value || '').trim().toLowerCase()));
  return Array.from(new Uint8Array(data)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function parseCookies(rawCookie) {
  const out = {};
  String(rawCookie || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const idx = part.indexOf('=');
      if (idx <= 0) return;
      const key = decodeURIComponent(part.slice(0, idx));
      const value = decodeURIComponent(part.slice(idx + 1));
      out[key] = value;
    });
  return out;
}

function getAdminPassword() {
  return (
    Deno.env.get('APP_ADMIN_PASSWORD') ||
    Deno.env.get('ADMIN_PASSWORD') ||
    Deno.env.get('ADMIN_PASS') ||
    ADMIN_PASSWORD_FALLBACK ||
    ''
  ).trim();
}

async function issueAdminCookie(req) {
  const payload = { t: Date.now() };
  const encodedPayload = base64UrlEncode(textEncoder.encode(JSON.stringify(payload)));
  const signature = await hmacSign(encodedPayload, GUARD_SECRET);
  const token = `${encodedPayload}.${signature}`;
  const proto = req?.headers?.get('x-forwarded-proto') || new URL(req?.url || 'http://localhost').protocol.replace(':', '');
  const secure = proto === 'https';
  const cookie = `${ADMIN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ADMIN_TTL_SEC}${secure ? '; Secure' : ''}`;
  return { token, cookie };
}

async function verifyAdminCookie(req) {
  const cookies = parseCookies(req.headers.get('cookie') || '');
  const token = cookies[ADMIN_COOKIE] || cookies[ADMIN_COOKIE_LEGACY] || '';
  if (!token || !token.includes('.')) return false;
  const [encodedPayload, signature] = token.split('.');
  const expected = await hmacSign(encodedPayload, GUARD_SECRET);
  if (signature.length !== expected.length) return false;
  if (signature !== expected) return false;
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedPayload)));
  } catch (_error) {
    return false;
  }
  const issuedAt = Number(payload.t || 0);
  if (!issuedAt || Number.isNaN(issuedAt)) return false;
  if (Date.now() - issuedAt > ADMIN_TTL_SEC * 1000) return false;
  return true;
}

function toText(value, maxLen = 255) {
  const txt = String(value || '').trim();
  if (!txt) return null;
  return txt.length > maxLen ? txt.slice(0, maxLen) : txt;
}

function toDigits(value, maxLen = 32) {
  const txt = String(value || '').replace(/\D/g, '');
  if (!txt) return null;
  return txt.length > maxLen ? txt.slice(0, maxLen) : txt;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function nowIso() {
  return new Date().toISOString();
}

function toIsoUtc(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mi = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

const defaultSettings = {
  pixel: {
    enabled: false,
    id: '',
    capi: {
      enabled: false,
      accessToken: '',
      testEventCode: ''
    },
    events: {
      page_view: true,
      quiz_view: true,
      lead: true,
      purchase: true,
      checkout: true
    }
  },
  utmfy: {
    enabled: false,
    endpoint: 'https://api.utmify.com.br/api-credentials/orders',
    apiKey: '',
    platform: 'IfoodBag'
  },
  pushcut: {
    enabled: false,
    pixCreatedUrl: '',
    pixConfirmedUrl: ''
  },
  features: {
    orderbump: true
  }
};

function parseBool(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return null;
}

function pickEnv(...keys) {
  for (const key of keys) {
    const value = Deno.env.get(key);
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
}

function getEnvOverrides() {
  const overrides = { pixel: {}, utmfy: {}, pushcut: {}, features: {} };

  const utmfyEndpoint = pickEnv('UTMFY_ENDPOINT', 'UTMIFY_ENDPOINT');
  const utmfyApiKey = pickEnv('UTMFY_API_KEY', 'UTMIFY_API_KEY');
  const utmfyPlatform = pickEnv('UTMFY_PLATFORM', 'UTMIFY_PLATFORM');
  const utmfyEnabled = parseBool(Deno.env.get('UTMFY_ENABLED') ?? Deno.env.get('UTMIFY_ENABLED'));
  if (utmfyEndpoint) overrides.utmfy.endpoint = utmfyEndpoint;
  if (utmfyApiKey) overrides.utmfy.apiKey = utmfyApiKey;
  if (utmfyPlatform) overrides.utmfy.platform = utmfyPlatform;
  if (utmfyEnabled !== null) overrides.utmfy.enabled = utmfyEnabled;
  else if (utmfyEndpoint || utmfyApiKey) overrides.utmfy.enabled = true;

  const pushcutEnabled = parseBool(Deno.env.get('PUSHCUT_ENABLED'));
  const pushcutPixCreatedUrl = pickEnv('PUSHCUT_PIX_CREATED_URL');
  const pushcutPixConfirmedUrl = pickEnv('PUSHCUT_PIX_CONFIRMED_URL');
  if (pushcutEnabled !== null) overrides.pushcut.enabled = pushcutEnabled;
  if (pushcutPixCreatedUrl) overrides.pushcut.pixCreatedUrl = pushcutPixCreatedUrl;
  if (pushcutPixConfirmedUrl) overrides.pushcut.pixConfirmedUrl = pushcutPixConfirmedUrl;

  const pixelId = pickEnv('PIXEL_ID');
  const pixelEnabled = parseBool(Deno.env.get('PIXEL_ENABLED'));
  if (pixelId) overrides.pixel.id = pixelId;
  if (pixelEnabled !== null) overrides.pixel.enabled = pixelEnabled;
  else if (pixelId) overrides.pixel.enabled = true;

  const capiEnabled = parseBool(Deno.env.get('PIXEL_CAPI_ENABLED'));
  const capiToken = pickEnv('PIXEL_CAPI_TOKEN');
  const capiTestCode = pickEnv('PIXEL_CAPI_TEST_CODE');
  if (capiEnabled !== null) overrides.pixel.capi = { ...(overrides.pixel.capi || {}), enabled: capiEnabled };
  if (capiToken) overrides.pixel.capi = { ...(overrides.pixel.capi || {}), accessToken: capiToken };
  if (capiTestCode) overrides.pixel.capi = { ...(overrides.pixel.capi || {}), testEventCode: capiTestCode };

  const eventPage = parseBool(Deno.env.get('PIXEL_EVENT_PAGE_VIEW'));
  const eventQuiz = parseBool(Deno.env.get('PIXEL_EVENT_QUIZ'));
  const eventLead = parseBool(Deno.env.get('PIXEL_EVENT_LEAD'));
  const eventCheckout = parseBool(Deno.env.get('PIXEL_EVENT_CHECKOUT'));
  const eventPurchase = parseBool(Deno.env.get('PIXEL_EVENT_PURCHASE'));
  const eventOverrides = {};
  if (eventPage !== null) eventOverrides.page_view = eventPage;
  if (eventQuiz !== null) eventOverrides.quiz_view = eventQuiz;
  if (eventLead !== null) eventOverrides.lead = eventLead;
  if (eventCheckout !== null) eventOverrides.checkout = eventCheckout;
  if (eventPurchase !== null) eventOverrides.purchase = eventPurchase;
  if (Object.keys(eventOverrides).length > 0) overrides.pixel.events = { ...(overrides.pixel.events || {}), ...eventOverrides };

  const orderbump = parseBool(Deno.env.get('FEATURE_ORDERBUMP'));
  if (orderbump !== null) overrides.features.orderbump = orderbump;

  return overrides;
}

function mergeSettings(base, overrides) {
  if (!overrides) return base;
  return {
    ...base,
    pixel: {
      ...base.pixel,
      ...(overrides.pixel || {}),
      capi: {
        ...base.pixel.capi,
        ...(overrides.pixel?.capi || {})
      },
      events: {
        ...base.pixel.events,
        ...(overrides.pixel?.events || {})
      }
    },
    utmfy: {
      ...base.utmfy,
      ...(overrides.utmfy || {})
    },
    pushcut: {
      ...base.pushcut,
      ...(overrides.pushcut || {})
    },
    features: {
      ...base.features,
      ...(overrides.features || {})
    }
  };
}

async function getSettings() {
  const envOverrides = getEnvOverrides();
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return mergeSettings(defaultSettings, envOverrides);

  const endpoint = `${SUPABASE_URL}/rest/v1/app_settings?key=eq.${encodeURIComponent(SETTINGS_KEY)}&select=key,value`;
  const response = await fetch(endpoint, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) return mergeSettings(defaultSettings, envOverrides);
  const rows = await response.json().catch(() => []);
  if (!Array.isArray(rows) || rows.length === 0) return mergeSettings(defaultSettings, envOverrides);
  const value = rows[0]?.value || {};
  const merged = {
    ...defaultSettings,
    ...value,
    pixel: {
      ...defaultSettings.pixel,
      ...(value.pixel || {}),
      capi: { ...defaultSettings.pixel.capi, ...(value.pixel?.capi || {}) },
      events: { ...defaultSettings.pixel.events, ...(value.pixel?.events || {}) }
    },
    utmfy: { ...defaultSettings.utmfy, ...(value.utmfy || {}) },
    pushcut: { ...defaultSettings.pushcut, ...(value.pushcut || {}) },
    features: { ...defaultSettings.features, ...(value.features || {}) }
  };

  return mergeSettings(merged, envOverrides);
}

async function saveSettings(input) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return { ok: false, reason: 'missing_supabase_config' };

  const payload = {
    key: SETTINGS_KEY,
    value: input || {},
    updated_at: nowIso()
  };

  const endpoint = `${SUPABASE_URL}/rest/v1/app_settings`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation'
    },
    body: JSON.stringify([payload])
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return { ok: false, reason: 'supabase_error', detail };
  }
  return { ok: true };
}

function buildLeadRecord(input = {}, req = null) {
  const personal = input.personal && typeof input.personal === 'object' ? input.personal : {};
  const address = input.address && typeof input.address === 'object' ? input.address : {};
  const extra = input.extra && typeof input.extra === 'object' ? input.extra : {};
  const shipping = input.shipping && typeof input.shipping === 'object' ? input.shipping : {};
  const bump = input.bump && typeof input.bump === 'object' ? input.bump : {};
  const pix = input.pix && typeof input.pix === 'object' ? input.pix : {};
  const utm = input.utm && typeof input.utm === 'object' ? input.utm : {};

  const street = toText(address.street || address.streetLine || '', 240);
  const cityLine = toText(address.cityLine || '', 140);
  const city = toText(address.city || cityLine?.split('-')[0] || '', 100);
  const state = toText(address.state || cityLine?.split('-')[1] || '', 20);

  const forwardedFor = req?.headers?.get('x-forwarded-for');
  const clientIp = forwardedFor ? forwardedFor.split(',')[0].trim() : '';

  return {
    session_id: toText(input.sessionId || input.session_id || input.leadSession || input.lead_session, 80),
    stage: toText(input.stage, 60),
    last_event: toText(input.event || input.lastEvent, 80),
    name: toText(personal.name, 160),
    cpf: toDigits(personal.cpf, 14),
    email: toText(personal.email, 180),
    phone: toDigits(personal.phoneDigits || personal.phone, 20),
    cep: toDigits(address.cep, 10),
    address_line: toText(street, 240),
    number: toText(extra.number, 40),
    complement: toText(extra.complement, 120),
    neighborhood: toText(address.neighborhood, 120),
    city,
    state,
    reference: toText(extra.reference, 140),
    shipping_id: toText(shipping.id, 40),
    shipping_name: toText(shipping.name, 120),
    shipping_price: toNumber(shipping.price),
    bump_selected: toBoolean(input.bumpSelected ?? bump.selected ?? bump.price),
    bump_price: toNumber(input.bumpPrice ?? bump.price),
    pix_txid: toText(input.pixTxid || pix.idTransaction, 120),
    pix_amount: toNumber(input.pixAmount || pix.amount || input.amount),
    utm_source: toText(utm.utm_source || input.utm_source, 120),
    utm_medium: toText(utm.utm_medium || input.utm_medium, 120),
    utm_campaign: toText(utm.utm_campaign || input.utm_campaign, 120),
    utm_term: toText(utm.utm_term || input.utm_term, 120),
    utm_content: toText(utm.utm_content || input.utm_content, 120),
    gclid: toText(utm.gclid || input.gclid, 120),
    fbclid: toText(utm.fbclid || input.fbclid, 120),
    ttclid: toText(utm.ttclid || input.ttclid, 120),
    referrer: toText(utm.referrer || input.referrer, 240),
    landing_page: toText(utm.landing_page || input.landing_page, 240),
    source_url: toText(input.sourceUrl, 300),
    user_agent: toText(req?.headers?.get('user-agent') || input.userAgent, 300),
    client_ip: toText(clientIp || input.clientIp, 80),
    updated_at: nowIso(),
    payload: input
  };
}

function hasMeaningfulLeadData(record) {
  return Boolean(
    record.name ||
    record.cpf ||
    record.email ||
    record.phone ||
    record.cep ||
    record.address_line ||
    record.shipping_id ||
    record.pix_txid ||
    record.pix_amount
  );
}

async function upsertLead(input = {}, req = null) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return { ok: false, reason: 'missing_supabase_config' };
  const record = buildLeadRecord(input, req);
  if (!record.session_id) return { ok: false, reason: 'missing_session_id' };
  if (!hasMeaningfulLeadData(record)) return { ok: false, reason: 'skipped_no_data' };

  const endpoint = `${SUPABASE_URL}/rest/v1/leads?on_conflict=session_id`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify([record])
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return { ok: false, reason: 'supabase_error', status: response.status, detail };
  }
  return { ok: true };
}

async function updateLeadByPixTxid(txid, fields = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return { ok: false, reason: 'missing_supabase_config' };
  const cleanTxid = String(txid || '').trim();
  if (!cleanTxid) return { ok: false, reason: 'missing_txid' };
  const payload = { ...fields, updated_at: nowIso() };
  const endpoint = `${SUPABASE_URL}/rest/v1/leads?pix_txid=eq.${encodeURIComponent(cleanTxid)}`;
  const response = await fetch(endpoint, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return { ok: false, reason: 'supabase_error', status: response.status, detail };
  }

  const data = await response.json().catch(() => []);
  return { ok: true, count: Array.isArray(data) ? data.length : 0 };
}

async function getLeadByPixTxid(txid) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return { ok: false, reason: 'missing_supabase_config' };
  const cleanTxid = String(txid || '').trim();
  if (!cleanTxid) return { ok: false, reason: 'missing_txid' };
  const endpoint = `${SUPABASE_URL}/rest/v1/leads?pix_txid=eq.${encodeURIComponent(cleanTxid)}&select=*`;
  const response = await fetch(endpoint, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return { ok: false, reason: 'supabase_error', status: response.status, detail };
  }
  const data = await response.json().catch(() => []);
  return { ok: true, data: Array.isArray(data) ? data[0] : null };
}

function normalizePage(value) {
  const page = String(value || '').trim().toLowerCase();
  if (!page) return '';
  return page.replace(/[^a-z0-9_-]/g, '');
}

async function upsertPageview(sessionId, page) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return { ok: false, reason: 'missing_supabase_config' };
  const session = String(sessionId || '').trim();
  const pageName = normalizePage(page);
  if (!session || !pageName) return { ok: false, reason: 'missing_data' };

  const endpoint = `${SUPABASE_URL}/rest/v1/lead_pageviews`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=minimal'
    },
    body: JSON.stringify([{ session_id: session, page: pageName }])
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return { ok: false, reason: 'supabase_error', detail };
  }
  return { ok: true };
}

function pickText(value) {
  const text = String(value || '').trim();
  return text ? text : '';
}

function toNullable(value) {
  const text = String(value || '').trim();
  return text ? text : null;
}

function toIntCents(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100);
}

function splitName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { name: '' };
  return { name: parts.join(' ') };
}

function resolveOrderStatus(eventName, payload) {
  if (payload?.status) return String(payload.status).toLowerCase();
  if (eventName === 'pix_confirmed' || eventName === 'purchase') return 'paid';
  if (eventName === 'pix_created' || eventName === 'checkout') return 'waiting_payment';
  if (eventName === 'pix_refunded') return 'refunded';
  if (eventName === 'pix_failed' || eventName === 'pix_refused') return 'refused';
  return 'waiting_payment';
}

function resolveCommission(payload, totalPriceInCents) {
  if (payload?.commission && typeof payload.commission === 'object') {
    const commission = payload.commission || {};
    return {
      totalPriceInCents: Number(commission.totalPriceInCents ?? totalPriceInCents) || totalPriceInCents,
      gatewayFeeInCents: Number(commission.gatewayFeeInCents ?? 0) || 0,
      userCommissionInCents: Number(commission.userCommissionInCents ?? totalPriceInCents) || totalPriceInCents,
      currency: commission.currency || 'BRL'
    };
  }

  const feeFromPayload =
    Number(payload.gatewayFeeInCents) ||
    toIntCents(payload.gatewayFee || payload.taxa_deposito || 0) + toIntCents(payload.taxa_adquirente || 0);

  const userFromPayload =
    Number(payload.userCommissionInCents) ||
    toIntCents(payload.userCommission || payload.deposito_liquido || payload.valor_liquido || 0);

  let gatewayFeeInCents = Number.isFinite(feeFromPayload) ? feeFromPayload : 0;
  let userCommissionInCents = Number.isFinite(userFromPayload) ? userFromPayload : 0;

  if (!userCommissionInCents || userCommissionInCents <= 0) {
    userCommissionInCents = Math.max(0, totalPriceInCents - gatewayFeeInCents);
  }
  if (!gatewayFeeInCents || gatewayFeeInCents < 0) gatewayFeeInCents = 0;
  if (!userCommissionInCents || userCommissionInCents <= 0) userCommissionInCents = totalPriceInCents;

  return {
    totalPriceInCents,
    gatewayFeeInCents,
    userCommissionInCents,
    currency: payload.currency || 'BRL'
  };
}

function buildUtmfyOrder(eventName, payload = {}, cfg = {}) {
  const personal = payload.personal || {};
  const address = payload.address || {};
  const shipping = payload.shipping || {};
  const bump = payload.bump || {};
  const utm = payload.utm || {};
  const tracking = payload.trackingParameters || {};

  const orderId =
    pickText(payload.orderId) ||
    pickText(payload.txid) ||
    pickText(payload.pixTxid) ||
    pickText(payload.sessionId) ||
    `order_${Date.now()}`;

  const status = resolveOrderStatus(eventName, payload);
  const createdAt = toIsoUtc(payload.createdAt || payload.pixCreatedAt || payload.data_registro || payload.data_transacao || Date.now());
  const approvedDate = status === 'paid' ? toIsoUtc(payload.approvedDate || payload.approvedAt || Date.now()) : null;
  const refundedAt = status === 'refunded' ? toIsoUtc(payload.refundedAt || payload.refunded_at || payload.data_estorno || Date.now()) : null;

  const shippingPrice = Number(shipping.price || 0);
  const bumpPrice = Number(bump.price || 0);
  const totalAmount = Number(payload.amount || payload.pixAmount || (shippingPrice + bumpPrice) || 0);
  const totalPriceInCents = toIntCents(totalAmount);

  const customerName = splitName(personal.name || payload.client_name || payload.customer?.name || '').name;
  const customerEmail = pickText(personal.email || payload.client_email || payload.customer?.email);
  const customerPhone = pickText(personal.phoneDigits || personal.phone || payload.client_phone || payload.customer?.phone);
  const customerDoc = pickText(personal.cpf || payload.client_document || payload.customer?.cpf);

  const products = [];
  if (shippingPrice > 0) {
    products.push({
      id: shipping.id || 'frete',
      name: shipping.name || 'Frete Bag iFood',
      planId: null,
      planName: null,
      quantity: 1,
      priceInCents: toIntCents(shippingPrice)
    });
  }
  if (bumpPrice > 0) {
    products.push({
      id: 'seguro_bag',
      name: bump.title || 'Seguro Bag',
      planId: null,
      planName: null,
      quantity: 1,
      priceInCents: toIntCents(bumpPrice)
    });
  }
  if (products.length === 0) {
    products.push({
      id: 'frete',
      name: 'Frete Bag iFood',
      planId: null,
      planName: null,
      quantity: 1,
      priceInCents: totalPriceInCents
    });
  }

  return {
    orderId,
    platform: cfg.platform || 'IfoodBag',
    paymentMethod: 'pix',
    status,
    createdAt,
    approvedDate,
    refundedAt,
    customer: {
      name: customerName,
      email: customerEmail,
      phone: customerPhone || null,
      document: customerDoc || null,
      country: 'BR',
      ip: pickText(payload.client_ip || payload.ip || payload.metadata?.client_ip)
    },
    products,
    trackingParameters: {
      src: toNullable(tracking.src || utm.src),
      sck: toNullable(tracking.sck || utm.sck),
      utm_source: toNullable(tracking.utm_source || utm.utm_source),
      utm_campaign: toNullable(tracking.utm_campaign || utm.utm_campaign),
      utm_medium: toNullable(tracking.utm_medium || utm.utm_medium),
      utm_content: toNullable(tracking.utm_content || utm.utm_content),
      utm_term: toNullable(tracking.utm_term || utm.utm_term)
    },
    commission: resolveCommission(payload, totalPriceInCents),
    isTest: payload.isTest === true
  };
}

async function sendUtmfy(eventName, payload) {
  const settings = await getSettings();
  const cfg = settings.utmfy || {};
  if (!cfg.enabled || !cfg.endpoint) return { ok: false, reason: 'disabled' };

  const endpoint = String(cfg.endpoint || '').trim();
  const body = buildUtmfyOrder(eventName, payload || {}, cfg);

  const headers = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers['x-api-token'] = cfg.apiKey;

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
  } catch (error) {
    return { ok: false, reason: 'request_error', detail: error?.message || String(error) };
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return { ok: false, reason: 'utmfy_error', detail };
  }
  return { ok: true };
}

async function sendPushcut(kind, payload = {}) {
  const settings = await getSettings();
  const cfg = settings.pushcut || {};
  const enabled = cfg.enabled !== false;
  if (!enabled) return { ok: false, reason: 'disabled' };

  let url = '';
  if (kind === 'pix_created') url = String(cfg.pixCreatedUrl || '').trim();
  if (kind === 'pix_confirmed') url = String(cfg.pixConfirmedUrl || '').trim();
  if (!url) return { ok: false, reason: 'missing_url' };

  const body = {
    event: kind,
    title: kind === 'pix_confirmed' ? 'Venda confirmada' : 'PIX gerado',
    message: kind === 'pix_confirmed' ? 'Pagamento confirmado via PIX.' : 'Novo PIX gerado no checkout.',
    payload
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return { ok: false, reason: 'pushcut_error', detail };
  }
  return { ok: true };
}

async function sendPixelServerEvent(eventName, payload = {}, req = null) {
  const settings = await getSettings();
  const pixel = settings.pixel || {};
  const capi = pixel.capi || {};
  const events = pixel.events || {};

  if (!pixel.enabled || !pixel.id || !capi.enabled || !capi.accessToken || events.purchase === false) {
    return { ok: false, reason: 'disabled' };
  }

  const email = payload?.personal?.email || payload?.client_email || payload?.clientEmail || '';
  const phone = payload?.personal?.phone || payload?.phone || '';
  const cpf = payload?.personal?.cpf || payload?.client_document || '';
  const amount = Number(payload?.amount || payload?.pixAmount || payload?.valor || 0);

  const userData = {};
  if (email) userData.em = [await sha256Hex(email)];
  if (phone) userData.ph = [await sha256Hex(String(phone).replace(/\D/g, ''))];
  if (cpf) userData.external_id = [await sha256Hex(String(cpf).replace(/\D/g, ''))];

  const forwarded = req?.headers?.get('x-forwarded-for');
  const clientIp = forwarded ? forwarded.split(',')[0].trim() : payload?.client_ip || '';
  if (clientIp) userData.client_ip_address = clientIp;
  const userAgent = req?.headers?.get('user-agent') || payload?.user_agent || '';
  if (userAgent) userData.client_user_agent = userAgent;

  const eventData = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    action_source: 'website',
    user_data: userData,
    custom_data: {
      currency: 'BRL',
      value: Number.isFinite(amount) ? amount : 0
    }
  };

  const endpoint = `https://graph.facebook.com/v20.0/${encodeURIComponent(pixel.id)}/events?access_token=${encodeURIComponent(capi.accessToken)}`;
  const body = { data: [eventData] };
  if (capi.testEventCode) body.test_event_code = String(capi.testEventCode).trim();

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return { ok: false, reason: 'pixel_capi_error', detail };
  }

  return { ok: true };
}

function getApiKeyB64() {
  const base = Deno.env.get('ATIVUSHUB_API_KEY_BASE64');
  if (base) return base;
  const raw = Deno.env.get('ATIVUSHUB_API_KEY') || '';
  if (!raw) return '';
  return btoa(raw);
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

let cachedSellerId = null;
async function getSellerId() {
  const envSeller = Deno.env.get('ATIVUSHUB_SELLER_ID');
  if (envSeller) return envSeller;
  if (cachedSellerId) return cachedSellerId;
  const apiKey = getApiKeyB64();
  if (!apiKey) throw new Error('API Key nao configurada.');

  const response = await fetch(`${ATIVUS_BASE_URL}/s1/getCompany/`, {
    method: 'GET',
    headers: { Authorization: `Basic ${apiKey}`, 'Content-Type': 'application/json' }
  });
  const data = await response.json().catch(() => ({}));
  const sellerId = pickSellerId(data);
  if (!sellerId) throw new Error('ID do seller nao encontrado na AtivusHUB.');
  cachedSellerId = sellerId;
  return sellerId;
}

function sanitizeDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function extractIp(req) {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded && forwarded.length > 0) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') || req.headers.get('cf-connecting-ip') || '';
}

function resolvePublicBaseUrl(req) {
  const envBase = pickEnv('APP_PUBLIC_URL', 'PUBLIC_BASE_URL', 'APP_BASE_URL', 'SITE_URL');
  if (envBase) return envBase.replace(/\/+$/, '');

  const origin = req.headers.get('origin');
  if (origin && origin.startsWith('http')) return origin.replace(/\/+$/, '');

  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  if (host) return `${proto}://${host}`;

  return new URL(req.url).origin;
}

function resolvePostbackUrl(req) {
  const envUrl = pickEnv('ATIVUSHUB_POSTBACK_URL', 'ATIVUS_POSTBACK_URL');
  if (envUrl) return envUrl;
  const base = resolvePublicBaseUrl(req);
  return `${base}/api/pix/webhook?token=${ATIVUS_WEBHOOK_TOKEN}`;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function getAtivusStatus(data) {
  return String(
    data?.status ||
      data?.status_transaction ||
      data?.situacao ||
      data?.transaction_status ||
      data?.data?.status ||
      data?.data?.status_transaction ||
      ''
  ).trim();
}

function mapAtivusStatusToUtmify(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (!normalized) return 'waiting_payment';
  if (['paid', 'paid_out', 'approved', 'completed', 'success', 'concluido', 'concluida'].some((s) => normalized.includes(s))) {
    return 'paid';
  }
  if (['cancelled', 'canceled', 'failed', 'rejected', 'refused'].some((s) => normalized.includes(s))) {
    return 'refused';
  }
  if (['refunded', 'chargeback'].some((s) => normalized.includes(s))) {
    return 'refunded';
  }
  if (['retido', 'med', 'pending', 'waiting', 'analysis'].some((s) => normalized.includes(s))) {
    return 'waiting_payment';
  }
  return 'waiting_payment';
}

function isAtivusPaidStatus(status) {
  return mapAtivusStatusToUtmify(status) === 'paid';
}

function isAtivusRefundedStatus(status) {
  return mapAtivusStatusToUtmify(status) === 'refunded';
}

function isAtivusRefusedStatus(status) {
  return mapAtivusStatusToUtmify(status) === 'refused';
}

function isAtivusPendingStatus(status) {
  return mapAtivusStatusToUtmify(status) === 'waiting_payment';
}

async function parseJsonBody(req) {
  if (req.bodyUsed) return {};
  const text = await req.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_error) {
    return { __invalid_json: true };
  }
}
Deno.serve(async (req) => {
  const origin = req.headers.get('origin') || '*';
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  const url = new URL(req.url);
  const segments = url.pathname.split('/').filter(Boolean);
  const apiIndex = segments.indexOf('api');
  const route = apiIndex >= 0 ? segments.slice(apiIndex + 1).join('/') : segments.slice(1).join('/');
  const method = req.method.toUpperCase();

  if (route === 'site/session' && method === 'GET') {
    return jsonResponse({ ok: true }, 200, corsHeaders(origin));
  }

  if (route === 'site/config' && method === 'GET') {
    const settings = await getSettings();
    const pixel = settings.pixel || {};
    const features = settings.features || {};
    return jsonResponse({
      pixel: {
        enabled: !!pixel.enabled,
        id: pixel.id || '',
        events: pixel.events || {}
      },
      features
    }, 200, corsHeaders(origin));
  }

  if (route === 'lead/track' && method === 'POST') {
    const body = await parseJsonBody(req);
    if (body.__invalid_json) return jsonResponse({ ok: false, error: 'JSON invalido.' }, 400, corsHeaders(origin));
    const result = await upsertLead(body, req);
    if (!result.ok && (result.reason === 'missing_supabase_config' || result.reason === 'skipped_no_data')) {
      return jsonResponse({ ok: false, reason: result.reason }, 202, corsHeaders(origin));
    }
    if (!result.ok) return jsonResponse({ ok: false, reason: result.reason, detail: result.detail || '' }, 502, corsHeaders(origin));
    return jsonResponse({ ok: true }, 200, corsHeaders(origin));
  }

  if (route === 'lead/pageview' && method === 'POST') {
    const body = await parseJsonBody(req);
    if (body.__invalid_json) return jsonResponse({ ok: false, error: 'JSON invalido.' }, 400, corsHeaders(origin));
    const result = await upsertPageview(body?.sessionId, body?.page);
    if (!result.ok && result.reason === 'missing_supabase_config') {
      return jsonResponse({ ok: false, reason: result.reason }, 202, corsHeaders(origin));
    }
    if (!result.ok) return jsonResponse({ ok: false, reason: result.reason, detail: result.detail || '' }, 502, corsHeaders(origin));
    return jsonResponse({ ok: true }, 200, corsHeaders(origin));
  }

  if (route === 'pix/create' && method === 'POST') {
    const body = await parseJsonBody(req);
    if (body.__invalid_json) return jsonResponse({ error: 'JSON invalido no corpo da requisicao.' }, 400, corsHeaders(origin));

    const apiKeyB64 = getApiKeyB64();
    if (!apiKeyB64) return jsonResponse({ error: 'API Key nao configurada.' }, 500, corsHeaders(origin));

    const { personal = {}, address = {}, extra = {}, shipping = {}, bump } = body || {};
    const shippingPrice = Number(shipping?.price || 0);
    const bumpPrice = bump?.price ? Number(bump.price) : 0;
    const totalAmount = Number((shippingPrice + bumpPrice).toFixed(2));
    if (!totalAmount || totalAmount <= 0) return jsonResponse({ error: 'Valor do frete invalido.' }, 400, corsHeaders(origin));

    const name = String(personal.name || '').trim();
    const cpf = sanitizeDigits(personal.cpf || '');
    const email = String(personal.email || '').trim();
    const phone = sanitizeDigits(personal.phoneDigits || personal.phone || '');
    if (!name || !cpf || !email || !phone) return jsonResponse({ error: 'Dados pessoais incompletos.' }, 400, corsHeaders(origin));

    const street = String(address.street || '').trim() || String(address.streetLine || '').split(',')[0]?.trim() || '';
    const neighborhood = String(address.neighborhood || '').trim() || String(address.streetLine || '').split(',')[1]?.trim() || '';
    const city = String(address.city || '').trim() || String(address.cityLine || '').split('-')[0]?.trim() || '';
    const state = String(address.state || '').trim() || String(address.cityLine || '').split('-')[1]?.trim() || '';
    const zipCode = sanitizeDigits(address.cep || '');

    const streetNumber = extra?.noNumber ? 'S/N' : String(extra?.number || '').trim() || 'S/N';
    const complement = extra?.noComplement ? 'Sem complemento' : String(extra?.complement || '').trim() || 'Sem complemento';

    let sellerId;
    try {
      sellerId = await getSellerId();
    } catch (error) {
      return jsonResponse({ error: error?.message || 'Falha ao obter seller.' }, 500, corsHeaders(origin));
    }

    const orderId = body.sessionId || `order_${Date.now()}`;
    const postbackUrl = resolvePostbackUrl(req);
    const allowInsecure =
      parseBool(Deno.env.get('ATIVUSHUB_ALLOW_HTTP')) ||
      postbackUrl.includes('localhost') ||
      postbackUrl.includes('127.0.0.1');
    if (!postbackUrl.startsWith('https://') && !allowInsecure) {
      return jsonResponse({ error: 'postbackUrl precisa usar HTTPS. Configure ATIVUSHUB_POSTBACK_URL.' }, 400, corsHeaders(origin));
    }

    const items = [
      { title: 'Frete Bag do iFood', quantity: 1, unitPrice: Number(shippingPrice.toFixed(2)), tangible: false }
    ];
    if (bumpPrice > 0) {
      items.push({ title: bump?.title || 'Seguro Bag', quantity: 1, unitPrice: Number(bumpPrice.toFixed(2)), tangible: false });
    }

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
        utm_source: body?.utm?.utm_source || '',
        utm_medium: body?.utm?.utm_medium || '',
        utm_campaign: body?.utm?.utm_campaign || '',
        utm_term: body?.utm?.utm_term || '',
        utm_content: body?.utm?.utm_content || '',
        src: body?.utm?.src || '',
        sck: body?.utm?.sck || ''
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
      pix: { expiresInDays: 2 }
    };

    const { response, data } = await fetchJson(`${ATIVUS_BASE_URL}/v1/gateway/api/`, {
      method: 'POST',
      headers: { Authorization: `Basic ${apiKeyB64}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) return jsonResponse({ error: 'Falha ao gerar o PIX.', detail: data }, response.status, corsHeaders(origin));

    const txid = data.idTransaction || data.idtransaction || '';
    await upsertLead({
      ...(body || {}),
      event: 'pix_created',
      stage: 'pix',
      pixTxid: txid,
      pixAmount: totalAmount
    }, req).catch(() => null);

    await sendUtmfy('pix_created', {
      orderId,
      amount: totalAmount,
      sessionId: body.sessionId || '',
      personal,
      shipping,
      bump,
      utm: body.utm || {},
      txid,
      createdAt: Date.now(),
      status: 'waiting_payment'
    }).catch(() => null);

    await sendPushcut('pix_created', { txid, amount: totalAmount, shippingName: shipping?.name || '', cep: zipCode }).catch(() => null);

    return jsonResponse({
      idTransaction: txid,
      paymentCode: data.paymentCode || data.paymentcode,
      paymentCodeBase64: data.paymentCodeBase64 || data.paymentcodebase64,
      status: data.status_transaction || data.status || '',
      amount: totalAmount
    }, 200, corsHeaders(origin));
  }

  if (route === 'pix/webhook' && method === 'POST') {
    const token = url.searchParams.get('token');
    if (token !== ATIVUS_WEBHOOK_TOKEN) return jsonResponse({ status: 'unauthorized' }, 401, corsHeaders(origin));

    const body = await parseJsonBody(req);
    if (body.__invalid_json) return jsonResponse({ error: 'JSON invalido.' }, 400, corsHeaders(origin));

    const txid =
      body.idTransaction || body.idtransaction || body.transaction_id || body.transactionId || body.txid ||
      body?.data?.idTransaction || body?.data?.idtransaction || body?.data?.transaction_id || body?.data?.transactionId || body?.data?.txid ||
      body?.payment?.idTransaction || body?.payment?.idtransaction || body?.pix?.idTransaction || body?.pix?.txid || '';

    const status = getAtivusStatus(body).toLowerCase();
    const utmifyStatus = mapAtivusStatusToUtmify(status);

    if (txid) {
      const lastEvent = isAtivusPaidStatus(status)
        ? 'pix_confirmed'
        : isAtivusRefundedStatus(status)
        ? 'pix_refunded'
        : isAtivusRefusedStatus(status)
        ? 'pix_refused'
        : 'pix_pending';

      await updateLeadByPixTxid(txid, { last_event: lastEvent, stage: 'pix' }).catch(() => null);
      const lead = await getLeadByPixTxid(txid).catch(() => ({ ok: false, data: null }));
      const leadData = lead?.ok ? lead.data : null;
      const leadUtm = leadData?.payload?.utm || {};

      const amount = Number(body?.amount || body?.valor_bruto || body?.valor_liquido || body?.data?.amount || leadData?.pix_amount || 0);
      const gatewayFee = Number(body?.taxa_deposito || 0) + Number(body?.taxa_adquirente || 0);
      const userCommission = Number(body?.deposito_liquido || body?.valor_liquido || 0);
      const eventName = lastEvent === 'pix_confirmed' ? 'pix_confirmed' : lastEvent === 'pix_refunded' ? 'pix_refunded' : lastEvent === 'pix_refused' ? 'pix_refused' : 'pix_pending';

      await sendUtmfy(eventName, {
        event: eventName,
        orderId: leadData?.session_id || leadData?.payload?.sessionId || '',
        txid,
        status: utmifyStatus,
        amount,
        personal: leadData ? { name: leadData.name, email: leadData.email, cpf: leadData.cpf, phoneDigits: leadData.phone } : null,
        address: leadData ? { street: leadData.address_line, neighborhood: leadData.neighborhood, city: leadData.city, state: leadData.state, cep: leadData.cep } : null,
        shipping: leadData ? { id: leadData.shipping_id, name: leadData.shipping_name, price: leadData.shipping_price } : null,
        bump: leadData && leadData.bump_selected ? { title: 'Seguro Bag', price: leadData.bump_price } : null,
        utm: leadData ? {
          utm_source: leadData.utm_source,
          utm_medium: leadData.utm_medium,
          utm_campaign: leadData.utm_campaign,
          utm_term: leadData.utm_term,
          utm_content: leadData.utm_content,
          gclid: leadData.gclid,
          fbclid: leadData.fbclid,
          ttclid: leadData.ttclid,
          src: leadUtm.src,
          sck: leadUtm.sck
        } : leadUtm,
        payload: body,
        createdAt: leadData?.created_at,
        approvedDate: isAtivusPaidStatus(status) ? body?.data_transacao || body?.data_registro || null : null,
        refundedAt: isAtivusRefundedStatus(status) ? body?.data_transacao || body?.data_registro || null : null,
        gatewayFeeInCents: Math.round(gatewayFee * 100),
        userCommissionInCents: Math.round(userCommission * 100),
        totalPriceInCents: Math.round(amount * 100)
      }).catch(() => null);

      if (isAtivusPaidStatus(status)) {
        await sendPushcut('pix_confirmed', { txid, status, amount }).catch(() => null);
        await sendPixelServerEvent('Purchase', {
          amount,
          personal: leadData ? { email: leadData.email, cpf: leadData.cpf, phone: leadData.phone } : null,
          client_ip: extractIp(req),
          user_agent: req.headers.get('user-agent') || ''
        }, req).catch(() => null);
      }
    }

    return jsonResponse({ status: 'success' }, 200, corsHeaders(origin));
  }

  if (route === 'admin/login' && method === 'POST') {
    const body = await parseJsonBody(req);
    if (body.__invalid_json) return jsonResponse({ error: 'JSON invalido.' }, 400, corsHeaders(origin));
    const password = String(body.password || '').trim();
    if (!password || password !== getAdminPassword()) return jsonResponse({ error: 'Senha invalida.' }, 401, corsHeaders(origin));
    const { cookie } = await issueAdminCookie(req);
    return jsonResponse({ ok: true }, 200, { ...corsHeaders(origin), 'Set-Cookie': cookie });
  }

  if (route === 'admin/me' && method === 'GET') {
    const ok = await verifyAdminCookie(req);
    if (!ok) return jsonResponse({ ok: false }, 401, corsHeaders(origin));
    return jsonResponse({ ok: true }, 200, corsHeaders(origin));
  }

  if (route === 'admin/settings') {
    const ok = await verifyAdminCookie(req);
    if (!ok) return jsonResponse({ error: 'Nao autorizado.' }, 401, corsHeaders(origin));
    if (method === 'GET') {
      const settings = await getSettings();
      return jsonResponse(settings, 200, corsHeaders(origin));
    }
    if (method === 'POST') {
      const body = await parseJsonBody(req);
      if (body.__invalid_json) return jsonResponse({ error: 'JSON invalido.' }, 400, corsHeaders(origin));
      const payload = {
        ...defaultSettings,
        ...body,
        pixel: {
          ...defaultSettings.pixel,
          ...(body.pixel || {}),
          capi: { ...defaultSettings.pixel.capi, ...(body.pixel?.capi || {}) },
          events: { ...defaultSettings.pixel.events, ...(body.pixel?.events || {}) }
        },
        utmfy: { ...defaultSettings.utmfy, ...(body.utmfy || {}) },
        pushcut: { ...defaultSettings.pushcut, ...(body.pushcut || {}) },
        features: { ...defaultSettings.features, ...(body.features || {}) }
      };
      const result = await saveSettings(payload);
      if (!result.ok) return jsonResponse({ error: 'Falha ao salvar configuracao.' }, 502, corsHeaders(origin));
      return jsonResponse({ ok: true }, 200, corsHeaders(origin));
    }
    return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders(origin));
  }

  if (route === 'admin/leads' && method === 'GET') {
    const ok = await verifyAdminCookie(req);
    if (!ok) return jsonResponse({ error: 'Nao autorizado.' }, 401, corsHeaders(origin));
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return jsonResponse({ error: 'Supabase nao configurado.' }, 500, corsHeaders(origin));

    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 50), 1), 200);
    const offset = Math.max(Number(url.searchParams.get('offset') || 0), 0);
    const query = String(url.searchParams.get('q') || '').trim();

    const endpoint = new URL(`${SUPABASE_URL}/rest/v1/leads_readable`);
    endpoint.searchParams.set('select', '*');
    endpoint.searchParams.set('order', 'updated_at.desc');
    endpoint.searchParams.set('limit', String(limit));
    endpoint.searchParams.set('offset', String(offset));
    if (query) {
      const ilike = `%${query.replace(/%/g, '')}%`;
      endpoint.searchParams.set('or', `nome.ilike.${ilike},email.ilike.${ilike},telefone.ilike.${ilike},cpf.ilike.${ilike}`);
    }

    const response = await fetch(endpoint.toString(), {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return jsonResponse({ error: 'Falha ao buscar leads.', detail }, 502, corsHeaders(origin));
    }
    const data = await response.json().catch(() => []);
    return jsonResponse({ data }, 200, corsHeaders(origin));
  }

  if (route === 'admin/pages' && method === 'GET') {
    const ok = await verifyAdminCookie(req);
    if (!ok) return jsonResponse({ error: 'Nao autorizado.' }, 401, corsHeaders(origin));
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return jsonResponse({ error: 'Supabase nao configurado.' }, 500, corsHeaders(origin));

    const response = await fetch(`${SUPABASE_URL}/rest/v1/pageview_counts?select=*`, {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return jsonResponse({ error: 'Falha ao buscar paginas.', detail }, 502, corsHeaders(origin));
    }
    const data = await response.json().catch(() => []);
    return jsonResponse({ data }, 200, corsHeaders(origin));
  }

  if (route === 'admin/utmfy-test' && method === 'POST') {
    const ok = await verifyAdminCookie(req);
    if (!ok) return jsonResponse({ error: 'Nao autorizado.' }, 401, corsHeaders(origin));

    const result = await sendUtmfy('pix_created', {
      source: 'admin_test',
      sessionId: `admin-${Date.now()}`,
      amount: 19.9,
      personal: { name: 'Teste Admin', email: 'teste@local.dev' },
      shipping: { name: 'Envio Padrao iFood', price: 19.9 },
      utm: { utm_source: 'admin_test', utm_medium: 'dashboard', utm_campaign: 'utmfy_test' }
    });
    if (!result.ok) return jsonResponse({ error: 'Falha ao enviar evento.', detail: result }, 400, corsHeaders(origin));
    return jsonResponse({ ok: true }, 200, corsHeaders(origin));
  }

  if (route === 'admin/utmfy-sale' && method === 'POST') {
    const ok = await verifyAdminCookie(req);
    if (!ok) return jsonResponse({ error: 'Nao autorizado.' }, 401, corsHeaders(origin));

    const amount = 56.1;
    const result = await sendUtmfy('pix_confirmed', {
      amount,
      sessionId: `manual-${Date.now()}`,
      personal: { name: 'Compra Manual', email: 'manual@local.dev' },
      shipping: { name: 'Envio Padrao iFood', price: amount },
      utm: { utm_source: 'admin_manual', utm_medium: 'dashboard', utm_campaign: 'manual_sale' }
    });

    if (!result.ok) return jsonResponse({ error: 'Falha ao enviar venda.', detail: result }, 400, corsHeaders(origin));
    return jsonResponse({ ok: true, amount }, 200, corsHeaders(origin));
  }

  if (route === 'admin/pushcut-test' && method === 'POST') {
    const ok = await verifyAdminCookie(req);
    if (!ok) return jsonResponse({ error: 'Nao autorizado.' }, 401, corsHeaders(origin));

    const cfg = (await getSettings())?.pushcut || {};
    if (cfg.enabled === false) return jsonResponse({ ok: false, error: 'Pushcut desativado.' }, 400, corsHeaders(origin));
    if (!String(cfg.pixCreatedUrl || '').trim() && !String(cfg.pixConfirmedUrl || '').trim()) {
      return jsonResponse({ ok: false, error: 'Configure ao menos uma URL de Pushcut.' }, 400, corsHeaders(origin));
    }

    const txid = `pushcut-test-${Date.now()}`;
    const basePayload = { txid, amount: 56.1, source: 'admin_test', created_at: nowIso() };

    const createdResult = await sendPushcut('pix_created', { ...basePayload, status: 'pending' }).catch((error) => ({ ok: false, reason: error?.message || 'request_error' }));
    const confirmedResult = await sendPushcut('pix_confirmed', { ...basePayload, status: 'paid' }).catch((error) => ({ ok: false, reason: error?.message || 'request_error' }));

    const okResult = !!createdResult?.ok || !!confirmedResult?.ok;
    if (!okResult) {
      return jsonResponse({
        ok: false,
        error: 'Falha ao enviar testes Pushcut.',
        results: { pix_created: createdResult, pix_confirmed: confirmedResult }
      }, 400, corsHeaders(origin));
    }

    return jsonResponse({ ok: true, results: { pix_created: createdResult, pix_confirmed: confirmedResult } }, 200, corsHeaders(origin));
  }

  if (route === 'admin/dispatch-process' && method === 'POST') {
    const ok = await verifyAdminCookie(req);
    if (!ok) return jsonResponse({ error: 'Nao autorizado.' }, 401, corsHeaders(origin));
    return jsonResponse({ ok: true, skipped: true, reason: 'dispatch_queue_disabled' }, 200, corsHeaders(origin));
  }

  if (route === 'admin/pix-reconcile' && method === 'POST') {
    const ok = await verifyAdminCookie(req);
    if (!ok) return jsonResponse({ error: 'Nao autorizado.' }, 401, corsHeaders(origin));
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return jsonResponse({ error: 'Supabase nao configurado.' }, 500, corsHeaders(origin));

    const maxTx = Math.min(Math.max(Number(url.searchParams.get('maxTx') || 2000), 1), 20000);
    const pageSize = Math.min(Math.max(Number(url.searchParams.get('pageSize') || 500), 50), 1000);
    const concurrency = Math.min(Math.max(Number(url.searchParams.get('concurrency') || 6), 1), 12);

    const txids = [];
    let offset = 0;
    while (txids.length < maxTx) {
      const endpoint = new URL(`${SUPABASE_URL}/rest/v1/leads`);
      const limit = Math.min(pageSize, maxTx - txids.length);
      endpoint.searchParams.set('select', 'pix_txid,last_event,updated_at');
      endpoint.searchParams.set('pix_txid', 'not.is.null');
      endpoint.searchParams.set('or', '(last_event.is.null,last_event.neq.pix_confirmed)');
      endpoint.searchParams.set('order', 'updated_at.desc');
      endpoint.searchParams.set('limit', String(limit));
      endpoint.searchParams.set('offset', String(offset));

      const response = await fetch(endpoint.toString(), {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        return jsonResponse({ error: 'Falha ao buscar txids no banco.', detail }, 502, corsHeaders(origin));
      }
      const rows = await response.json().catch(() => []);
      if (!Array.isArray(rows) || rows.length === 0) break;
      rows.forEach((row) => {
        const txid = String(row?.pix_txid || '').trim();
        if (txid) txids.push(txid);
      });
      if (rows.length < limit) break;
      offset += rows.length;
    }

    const uniqueTxids = Array.from(new Set(txids));
    let checked = 0;
    let confirmed = 0;
    let pending = 0;
    let failed = 0;
    let updated = 0;
    const failedDetails = [];

    const apiKeyB64 = getApiKeyB64();
    if (!apiKeyB64) return jsonResponse({ error: 'API Key nao configurada.' }, 500, corsHeaders(origin));

    const runOne = async (txid) => {
      checked += 1;
      try {
        const { response, data } = await fetchJson(
          `${ATIVUS_BASE_URL}/s1/getTransaction/api/getTransactionStatus.php?id_transaction=${encodeURIComponent(txid)}`,
          { method: 'GET', headers: { Authorization: `Basic ${apiKeyB64}`, 'Content-Type': 'application/json' } }
        );
        if (!response.ok) {
          failed += 1;
          if (failedDetails.length < 8) failedDetails.push({ txid, status: response.status, detail: data?.error || data?.message || '' });
          return;
        }
        const status = getAtivusStatus(data);
        const utmifyStatus = mapAtivusStatusToUtmify(status);
        const isPaid = isAtivusPaidStatus(status);
        const isRefunded = isAtivusRefundedStatus(status);
        const isRefused = isAtivusRefusedStatus(status);

        if (isPaid || isRefunded || isRefused || isAtivusPendingStatus(status)) {
          if (utmifyStatus === 'paid') confirmed += 1;
          else if (utmifyStatus === 'waiting_payment') pending += 1;
          else failed += 1;

          const lastEvent = isPaid ? 'pix_confirmed' : isRefunded ? 'pix_refunded' : isRefused ? 'pix_refused' : 'pix_pending';
          const up = await updateLeadByPixTxid(txid, { last_event: lastEvent, stage: 'pix' }).catch(() => ({ ok: false }));
          const lead = await getLeadByPixTxid(txid).catch(() => ({ ok: false, data: null }));
          const leadData = lead?.ok ? lead.data : null;
          const leadUtm = leadData?.payload?.utm || {};
          const changedRows = up?.ok ? Number(up?.count || 0) : 0;

          if (changedRows > 0) {
            updated += changedRows;
            const amount = Number(data?.amount || data?.valor_bruto || data?.valor_liquido || data?.data?.amount || 0);
            const gatewayFee = Number(data?.taxa_deposito || 0) + Number(data?.taxa_adquirente || 0);
            const userCommission = Number(data?.deposito_liquido || data?.valor_liquido || 0);
            const eventName = isPaid ? 'pix_confirmed' : isRefunded ? 'pix_refunded' : isRefused ? 'pix_refused' : 'pix_pending';

            await sendUtmfy(eventName, {
              event: eventName,
              orderId: leadData?.session_id || '',
              txid,
              status: utmifyStatus,
              amount,
              personal: leadData ? { name: leadData.name, email: leadData.email, cpf: leadData.cpf, phoneDigits: leadData.phone } : null,
              address: leadData ? { street: leadData.address_line, neighborhood: leadData.neighborhood, city: leadData.city, state: leadData.state, cep: leadData.cep } : null,
              shipping: leadData ? { id: leadData.shipping_id, name: leadData.shipping_name, price: leadData.shipping_price } : null,
              bump: leadData && leadData.bump_selected ? { title: 'Seguro Bag', price: leadData.bump_price } : null,
              utm: leadData ? {
                utm_source: leadData.utm_source,
                utm_medium: leadData.utm_medium,
                utm_campaign: leadData.utm_campaign,
                utm_term: leadData.utm_term,
                utm_content: leadData.utm_content,
                gclid: leadData.gclid,
                fbclid: leadData.fbclid,
                ttclid: leadData.ttclid,
                src: leadUtm.src,
                sck: leadUtm.sck
              } : leadUtm,
              payload: data,
              createdAt: leadData?.created_at,
              approvedDate: isPaid ? data?.data_transacao || data?.data_registro || null : null,
              refundedAt: isRefunded ? data?.data_transacao || data?.data_registro || null : null,
              gatewayFeeInCents: Math.round(gatewayFee * 100),
              userCommissionInCents: Math.round(userCommission * 100),
              totalPriceInCents: Math.round(amount * 100)
            }).catch(() => null);

            if (isPaid) {
              await sendPushcut('pix_confirmed', { txid, status, amount }).catch(() => null);
              await sendPixelServerEvent('Purchase', {
                amount,
                personal: leadData ? { email: leadData.email, cpf: leadData.cpf, phone: leadData.phone } : null,
                client_ip: extractIp(req),
                user_agent: req.headers.get('user-agent') || ''
              }, req).catch(() => null);
            }
          }
        } else {
          failed += 1;
          if (failedDetails.length < 8) failedDetails.push({ txid, status: 200, detail: `status:${status || 'unknown'}` });
        }
      } catch (_error) {
        failed += 1;
        if (failedDetails.length < 8) failedDetails.push({ txid, status: 0, detail: 'request_error' });
      }
    };

    for (let i = 0; i < uniqueTxids.length; i += concurrency) {
      const chunk = uniqueTxids.slice(i, i + concurrency);
      await Promise.all(chunk.map((txid) => runOne(txid)));
    }

    return jsonResponse({
      ok: true,
      source: 'ativushub',
      candidates: uniqueTxids.length,
      checked,
      confirmed,
      pending,
      failed,
      updated,
      failedDetails
    }, 200, corsHeaders(origin));
  }

  return jsonResponse({ error: 'Not found' }, 404, corsHeaders(origin));
});
