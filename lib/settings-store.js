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
    updatedAt: 0,
    sourceUpdatedAt: '',
    source: 'default'
};

function cloneDefaultSettings() {
    return JSON.parse(JSON.stringify(defaultSettings));
}

function normalizeSettingsValue(value = {}) {
    const source = value && typeof value === 'object' ? { ...value } : {};
    delete source._meta;
    const valuePixel = source.pixel && typeof source.pixel === 'object' ? source.pixel : {};
    const valueTikTokPixel = source.tiktokPixel && typeof source.tiktokPixel === 'object' ? source.tiktokPixel : {};
    return {
        ...defaultSettings,
        ...source,
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
            ...(source.utmfy || {})
        },
        pushcut: (() => {
            const pushcut = source.pushcut && typeof source.pushcut === 'object' ? source.pushcut : {};
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
        payments: buildPaymentsConfig(source.payments || {}),
        features: {
            ...defaultSettings.features,
            ...(source.features || {})
        }
    };
}

function cacheSettings(value, options = {}) {
    SETTINGS_CACHE.value = normalizeSettingsValue(value);
    SETTINGS_CACHE.updatedAt = Date.now();
    SETTINGS_CACHE.sourceUpdatedAt = String(options.updatedAt || '').trim();
    SETTINGS_CACHE.source = String(options.source || '').trim() || 'runtime';
    return getCachedSettings();
}

function getCachedSettings() {
    if (SETTINGS_CACHE && SETTINGS_CACHE.value) {
        return JSON.parse(JSON.stringify(SETTINGS_CACHE.value));
    }
    return cloneDefaultSettings();
}

function buildFallbackSettingsState(reason, options = {}) {
    if (SETTINGS_CACHE.updatedAt > 0 && SETTINGS_CACHE.value) {
        return {
            ok: true,
            settings: getCachedSettings(),
            source: 'cache',
            stale: true,
            updatedAt: SETTINGS_CACHE.sourceUpdatedAt || null,
            reason
        };
    }

    if (options.strict) {
        return {
            ok: false,
            settings: null,
            source: 'none',
            stale: true,
            updatedAt: null,
            reason
        };
    }

    return {
        ok: true,
        settings: getCachedSettings(),
        source: 'default',
        stale: true,
        updatedAt: null,
        reason
    };
}

async function getSettingsState(options = {}) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return buildFallbackSettingsState('missing_supabase_config', options);
    }

    try {
        const endpoint = `${SUPABASE_URL}/rest/v1/app_settings?key=eq.${encodeURIComponent(SETTINGS_KEY)}&select=key,value,updated_at`;

        const response = await fetchFn(endpoint, {
            headers: {
                apikey: SUPABASE_SERVICE_KEY,
                Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            return buildFallbackSettingsState(`supabase_error_${response.status || 0}`, options);
        }

        const rows = await response.json().catch(() => []);
        if (!Array.isArray(rows) || rows.length === 0) {
            return buildFallbackSettingsState('settings_not_found', options);
        }

        const row = rows[0] || {};
        const normalized = cacheSettings(row.value || {}, {
            updatedAt: row.updated_at,
            source: 'supabase'
        });
        return {
            ok: true,
            settings: normalized,
            source: 'supabase',
            stale: false,
            updatedAt: String(row.updated_at || '').trim() || null,
            reason: ''
        };
    } catch (_error) {
        return buildFallbackSettingsState('supabase_exception', options);
    }
}

async function getSettings(options = {}) {
    const state = await getSettingsState(options);
    if (state?.ok && state.settings) return state.settings;
    return getCachedSettings();
}

async function saveSettings(input) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return { ok: false, reason: 'missing_supabase_config' };
    const normalizedInput = normalizeSettingsValue(input || {});

    const payload = {
        key: SETTINGS_KEY,
        value: normalizedInput,
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

    const rows = await response.json().catch(() => []);
    const updatedAt = String(rows?.[0]?.updated_at || payload.updated_at || '').trim();
    cacheSettings(normalizedInput, { updatedAt, source: 'supabase' });
    return { ok: true, updatedAt };
}

module.exports = {
    getSettings,
    getSettingsState,
    saveSettings,
    defaultSettings
};
