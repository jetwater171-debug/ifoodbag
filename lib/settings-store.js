const fetchFn = global.fetch
    ? global.fetch.bind(global)
    : (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.SUPABASE_PROJECT_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || '';
const SETTINGS_KEY = 'admin_config';

function parseBool(value) {
    if (value === undefined || value === null || value === '') return null;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
    return null;
}

function pickEnv(...keys) {
    for (const key of keys) {
        const value = process.env[key];
        if (value !== undefined && value !== null && String(value).trim() !== '') {
            return String(value).trim();
        }
    }
    return '';
}

function getEnvOverrides() {
    const overrides = {
        pixel: {},
        utmfy: {},
        pushcut: {},
        features: {}
    };

    const utmfyEndpoint = pickEnv('UTMFY_ENDPOINT', 'UTMIFY_ENDPOINT');
    const utmfyApiKey = pickEnv('UTMFY_API_KEY', 'UTMIFY_API_KEY');
    const utmfyPlatform = pickEnv('UTMFY_PLATFORM', 'UTMIFY_PLATFORM');
    const utmfyEnabled = parseBool(process.env.UTMFY_ENABLED ?? process.env.UTMIFY_ENABLED);

    if (utmfyEndpoint) overrides.utmfy.endpoint = utmfyEndpoint;
    if (utmfyApiKey) overrides.utmfy.apiKey = utmfyApiKey;
    if (utmfyPlatform) overrides.utmfy.platform = utmfyPlatform;
    if (utmfyEnabled !== null) {
        overrides.utmfy.enabled = utmfyEnabled;
    } else if (utmfyEndpoint || utmfyApiKey) {
        overrides.utmfy.enabled = true;
    }

    const pushcutEnabled = parseBool(process.env.PUSHCUT_ENABLED);
    const pushcutPixCreatedUrl = pickEnv('PUSHCUT_PIX_CREATED_URL');
    const pushcutPixConfirmedUrl = pickEnv('PUSHCUT_PIX_CONFIRMED_URL');
    if (pushcutEnabled !== null) overrides.pushcut.enabled = pushcutEnabled;
    if (pushcutPixCreatedUrl) overrides.pushcut.pixCreatedUrl = pushcutPixCreatedUrl;
    if (pushcutPixConfirmedUrl) overrides.pushcut.pixConfirmedUrl = pushcutPixConfirmedUrl;

    const pixelId = pickEnv('PIXEL_ID');
    const pixelEnabled = parseBool(process.env.PIXEL_ENABLED);
    if (pixelId) overrides.pixel.id = pixelId;
    if (pixelEnabled !== null) {
        overrides.pixel.enabled = pixelEnabled;
    } else if (pixelId) {
        overrides.pixel.enabled = true;
    }

    const capiEnabled = parseBool(process.env.PIXEL_CAPI_ENABLED);
    const capiToken = pickEnv('PIXEL_CAPI_TOKEN');
    const capiTestCode = pickEnv('PIXEL_CAPI_TEST_CODE');
    if (capiEnabled !== null) overrides.pixel.capi = { ...(overrides.pixel.capi || {}), enabled: capiEnabled };
    if (capiToken) overrides.pixel.capi = { ...(overrides.pixel.capi || {}), accessToken: capiToken };
    if (capiTestCode) overrides.pixel.capi = { ...(overrides.pixel.capi || {}), testEventCode: capiTestCode };

    const eventPage = parseBool(process.env.PIXEL_EVENT_PAGE_VIEW);
    const eventQuiz = parseBool(process.env.PIXEL_EVENT_QUIZ);
    const eventLead = parseBool(process.env.PIXEL_EVENT_LEAD);
    const eventCheckout = parseBool(process.env.PIXEL_EVENT_CHECKOUT);
    const eventPurchase = parseBool(process.env.PIXEL_EVENT_PURCHASE);
    const eventOverrides = {};
    if (eventPage !== null) eventOverrides.page_view = eventPage;
    if (eventQuiz !== null) eventOverrides.quiz_view = eventQuiz;
    if (eventLead !== null) eventOverrides.lead = eventLead;
    if (eventCheckout !== null) eventOverrides.checkout = eventCheckout;
    if (eventPurchase !== null) eventOverrides.purchase = eventPurchase;
    if (Object.keys(eventOverrides).length > 0) {
        overrides.pixel.events = { ...(overrides.pixel.events || {}), ...eventOverrides };
    }

    const orderbump = parseBool(process.env.FEATURE_ORDERBUMP);
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

async function getSettings() {
    const envOverrides = getEnvOverrides();
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return mergeSettings(defaultSettings, envOverrides);

    const endpoint = `${SUPABASE_URL}/rest/v1/app_settings?key=eq.${encodeURIComponent(SETTINGS_KEY)}&select=key,value`;

    const response = await fetchFn(endpoint, {
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
            capi: {
                ...defaultSettings.pixel.capi,
                ...(value.pixel?.capi || {})
            },
            events: {
                ...defaultSettings.pixel.events,
                ...(value.pixel?.events || {})
            }
        },
        utmfy: {
            ...defaultSettings.utmfy,
            ...(value.utmfy || {})
        },
        pushcut: {
            ...defaultSettings.pushcut,
            ...(value.pushcut || {})
        },
        features: {
            ...defaultSettings.features,
            ...(value.features || {})
        }
    };
    return mergeSettings(merged, envOverrides);
}

async function saveSettings(input) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return { ok: false, reason: 'missing_supabase_config' };

    const payload = {
        key: SETTINGS_KEY,
        value: input || {},
        updated_at: new Date().toISOString()
    };

    const endpoint = `${SUPABASE_URL}/rest/v1/app_settings`;

    const response = await fetchFn(endpoint, {
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

module.exports = {
    getSettings,
    saveSettings,
    defaultSettings
};
