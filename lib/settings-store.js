const fetchFn = global.fetch
    ? global.fetch.bind(global)
    : (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { buildPaymentsConfig } = require('./payment-gateway-config');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.SUPABASE_PROJECT_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || '';
const SETTINGS_KEY = 'admin_config';

function envBoolean(name, fallback = false) {
    const raw = String(process.env[name] ?? '').trim().toLowerCase();
    if (!raw) return fallback;
    return ['1', 'true', 'yes', 'on'].includes(raw);
}

function buildDefaultBrowserPixelSettings(options = {}) {
    const { allowBackupId = false } = options;
    const settings = {
        enabled: false,
        id: '',
        capi: {
            enabled: false,
            accessToken: '',
            backupAccessToken: '',
            testEventCode: '',
            backupTestEventCode: ''
        },
        events: {
            page_view: true,
            quiz_view: true,
            lead: true,
            purchase: true,
            checkout: true
        }
    };
    if (allowBackupId) {
        settings.backupId = '';
    }
    return settings;
}

const defaultSettings = {
    pixel: buildDefaultBrowserPixelSettings({ allowBackupId: true }),
    tiktokPixel: buildDefaultBrowserPixelSettings(),
    utmfy: {
        enabled: envBoolean('UTMFY_ENABLED', false),
        endpoint: String(process.env.UTMFY_ENDPOINT || 'https://api.utmify.com.br/api-credentials/orders').trim(),
        apiKey: String(process.env.UTMFY_API_KEY || '').trim(),
        platform: String(process.env.UTMFY_PLATFORM || 'IfoodBag').trim() || 'IfoodBag'
    },
    pushcut: {
        enabled: false,
        pixCreatedUrl: '',
        pixCreatedUrl2: '',
        pixCreatedUrls: [],
        pixConfirmedUrl: '',
        pixConfirmedUrl2: '',
        pixConfirmedUrls: [],
        templates: {
            pixCreatedTitle: 'PIX gerado - {amount}',
            pixCreatedMessage: 'Novo PIX gerado para {name}. Pedido {orderId}.',
            pixConfirmedTitle: 'PIX pago - {amount}',
            pixConfirmedMessage: 'Pagamento confirmado para {name}. Pedido {orderId}.'
        }
    },
    payments: buildPaymentsConfig({}),
    features: {
        orderbump: true
    }
};

const SETTINGS_CACHE = {
    value: defaultSettings,
    updatedAt: 0
};

function cloneDefaultSettings() {
    return JSON.parse(JSON.stringify(defaultSettings));
}

function cacheSettings(value) {
    SETTINGS_CACHE.value = value;
    SETTINGS_CACHE.updatedAt = Date.now();
    return value;
}

function getCachedSettings() {
    if (SETTINGS_CACHE && SETTINGS_CACHE.value) {
        return SETTINGS_CACHE.value;
    }
    return cloneDefaultSettings();
}

async function getSettings() {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return getCachedSettings();

    try {
        const endpoint = `${SUPABASE_URL}/rest/v1/app_settings?key=eq.${encodeURIComponent(SETTINGS_KEY)}&select=key,value`;

        const response = await fetchFn(endpoint, {
            headers: {
                apikey: SUPABASE_SERVICE_KEY,
                Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            return getCachedSettings();
        }

        const rows = await response.json().catch(() => []);
        if (!Array.isArray(rows) || rows.length === 0) {
            return getCachedSettings();
        }

        const value = rows[0]?.value || {};
        const valuePixel = value.pixel && typeof value.pixel === 'object' ? value.pixel : {};
        const valueTikTokPixel = value.tiktokPixel && typeof value.tiktokPixel === 'object' ? value.tiktokPixel : {};
        return cacheSettings({
            ...defaultSettings,
            ...value,
            pixel: {
                enabled: !!valuePixel.enabled,
                id: String(valuePixel.id || '').trim(),
                backupId: String(valuePixel.backupId || '').trim(),
                capi: {
                    enabled: !!valuePixel?.capi?.enabled,
                    accessToken: String(valuePixel?.capi?.accessToken || '').trim(),
                    backupAccessToken: String(valuePixel?.capi?.backupAccessToken || '').trim(),
                    testEventCode: String(valuePixel?.capi?.testEventCode || '').trim(),
                    backupTestEventCode: String(valuePixel?.capi?.backupTestEventCode || '').trim()
                },
                events: {
                    ...defaultSettings.pixel.events,
                    ...(valuePixel.events || {})
                }
            },
            tiktokPixel: {
                enabled: !!valueTikTokPixel.enabled,
                id: String(valueTikTokPixel.id || '').trim(),
                events: {
                    ...defaultSettings.tiktokPixel.events,
                    ...(valueTikTokPixel.events || {})
                }
            },
            utmfy: {
                ...defaultSettings.utmfy,
                ...(value.utmfy || {})
            },
            pushcut: (() => {
                const pushcut = value.pushcut && typeof value.pushcut === 'object' ? value.pushcut : {};
                const createdUrl = [
                    ...(Array.isArray(pushcut.pixCreatedUrls) ? pushcut.pixCreatedUrls : []),
                    pushcut.pixCreatedUrl,
                    pushcut.pixCreatedUrl2
                ]
                    .map((item) => String(item || '').trim())
                    .find(Boolean) || '';
                const confirmedUrl = [
                    ...(Array.isArray(pushcut.pixConfirmedUrls) ? pushcut.pixConfirmedUrls : []),
                    pushcut.pixConfirmedUrl,
                    pushcut.pixConfirmedUrl2
                ]
                    .map((item) => String(item || '').trim())
                    .find(Boolean) || '';
                return {
                    ...defaultSettings.pushcut,
                    ...pushcut,
                    pixCreatedUrl: createdUrl,
                    pixCreatedUrl2: '',
                    pixCreatedUrls: createdUrl ? [createdUrl] : [],
                    pixConfirmedUrl: confirmedUrl,
                    pixConfirmedUrl2: '',
                    pixConfirmedUrls: confirmedUrl ? [confirmedUrl] : [],
                    templates: {
                        ...defaultSettings.pushcut.templates,
                        ...(pushcut.templates || {})
                    }
                };
            })(),
            payments: buildPaymentsConfig(value.payments || {}),
            features: {
                ...defaultSettings.features,
                ...(value.features || {})
            }
        });
    } catch (_error) {
        return getCachedSettings();
    }
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
