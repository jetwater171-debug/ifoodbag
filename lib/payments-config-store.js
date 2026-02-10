const { getSettings } = require('./settings-store');
const { buildPaymentsConfig } = require('./payment-gateway-config');

const CACHE_TTL_MS = Number(process.env.PAYMENTS_SETTINGS_CACHE_MS || 10000);

const cache = {
    value: null,
    expiresAt: 0,
    inflight: null
};

function invalidatePaymentsConfigCache() {
    cache.value = null;
    cache.expiresAt = 0;
    cache.inflight = null;
}

async function getPaymentsConfig(options = {}) {
    const force = options && options.force === true;
    const now = Date.now();
    if (!force && cache.value && cache.expiresAt > now) {
        return cache.value;
    }

    if (!force && cache.inflight) {
        return cache.inflight;
    }

    cache.inflight = (async () => {
        const settings = await getSettings().catch(() => ({}));
        const payments = buildPaymentsConfig(settings?.payments || {});
        cache.value = payments;
        cache.expiresAt = Date.now() + CACHE_TTL_MS;
        return payments;
    })();

    try {
        return await cache.inflight;
    } finally {
        cache.inflight = null;
    }
}

module.exports = {
    getPaymentsConfig,
    invalidatePaymentsConfigCache
};
