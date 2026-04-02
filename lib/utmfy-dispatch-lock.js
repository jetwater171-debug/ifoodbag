const fetchFn = global.fetch
    ? global.fetch.bind(global)
    : (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.SUPABASE_PROJECT_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || '';
const SETTINGS_TABLE = process.env.SUPABASE_SETTINGS_TABLE || 'app_settings';
const LOCK_TTL_MS = Number(process.env.UTMFY_SALE_LOCK_TTL_MS || 15 * 60 * 1000);

function nowIso() {
    return new Date().toISOString();
}

function headers() {
    return {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json'
    };
}

function toObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function lockKeyFor(dedupeKey = '') {
    const key = String(dedupeKey || '').trim();
    return key ? `dispatch:utmfy:sale:${key}` : '';
}

function isPaidSaleEvent(eventName = '', payload = {}) {
    const normalizedEvent = String(eventName || '').trim().toLowerCase();
    const normalizedStatus = String(payload?.status || '').trim().toLowerCase();
    return (
        normalizedEvent === 'pix_confirmed' ||
        normalizedEvent === 'upsell_pix_confirmed' ||
        normalizedEvent === 'purchase' ||
        normalizedStatus === 'paid'
    );
}

function buildLockValue({ dedupeKey, eventName, payload }) {
    return {
        channel: 'utmfy',
        type: 'sale',
        status: 'processing',
        dedupeKey: String(dedupeKey || '').trim(),
        eventName: String(eventName || '').trim(),
        orderId: String(payload?.orderId || payload?.txid || '').trim(),
        txid: String(payload?.txid || '').trim(),
        claimedAt: nowIso()
    };
}

async function insertLock(lockKey, value) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${SETTINGS_TABLE}`);
    url.searchParams.set('on_conflict', 'key');

    const response = await fetchFn(url.toString(), {
        method: 'POST',
        headers: {
            ...headers(),
            Prefer: 'resolution=ignore-duplicates,return=representation'
        },
        body: JSON.stringify([
            {
                key: lockKey,
                value,
                updated_at: nowIso()
            }
        ])
    });

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        return { ok: false, reason: 'supabase_error', detail };
    }

    const rows = await response.json().catch(() => []);
    return { ok: true, inserted: Array.isArray(rows) && rows.length > 0 };
}

async function fetchLock(lockKey) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${SETTINGS_TABLE}`);
    url.searchParams.set('key', `eq.${lockKey}`);
    url.searchParams.set('select', 'key,value,updated_at');
    url.searchParams.set('limit', '1');

    const response = await fetchFn(url.toString(), {
        headers: headers()
    });

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        return { ok: false, reason: 'supabase_error', detail };
    }

    const rows = await response.json().catch(() => []);
    return { ok: true, row: Array.isArray(rows) ? (rows[0] || null) : null };
}

async function stealStaleLock(lockKey, previousUpdatedAt, value) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${SETTINGS_TABLE}`);
    url.searchParams.set('key', `eq.${lockKey}`);
    url.searchParams.set('updated_at', `eq.${previousUpdatedAt}`);

    const response = await fetchFn(url.toString(), {
        method: 'PATCH',
        headers: {
            ...headers(),
            Prefer: 'return=representation'
        },
        body: JSON.stringify({
            value,
            updated_at: nowIso()
        })
    });

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        return { ok: false, reason: 'supabase_error', detail };
    }

    const rows = await response.json().catch(() => []);
    return { ok: true, stolen: Array.isArray(rows) && rows.length > 0 };
}

async function markSent(lockKey, currentValue = {}) {
    const value = {
        ...toObject(currentValue),
        status: 'sent',
        sentAt: nowIso()
    };
    const url = `${SUPABASE_URL}/rest/v1/${SETTINGS_TABLE}?key=eq.${encodeURIComponent(lockKey)}`;
    await fetchFn(url, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({
            value,
            updated_at: nowIso()
        })
    }).catch(() => null);
}

async function releaseLock(lockKey) {
    const url = `${SUPABASE_URL}/rest/v1/${SETTINGS_TABLE}?key=eq.${encodeURIComponent(lockKey)}`;
    await fetchFn(url, {
        method: 'DELETE',
        headers: headers()
    }).catch(() => null);
}

async function acquireUtmfySaleLock({ dedupeKey, eventName, payload }) {
    const normalizedDedupeKey = String(dedupeKey || '').trim();
    if (!normalizedDedupeKey || !isPaidSaleEvent(eventName, payload)) {
        return { acquired: true, skipped: true, reason: 'sale_lock_not_needed' };
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return { acquired: true, bestEffort: true, reason: 'missing_supabase_config' };
    }

    const lockKey = lockKeyFor(normalizedDedupeKey);
    const value = buildLockValue({ dedupeKey: normalizedDedupeKey, eventName, payload });
    const inserted = await insertLock(lockKey, value).catch(() => ({ ok: false }));
    if (inserted?.ok && inserted.inserted) {
        return { acquired: true, lockKey, value };
    }

    const existing = await fetchLock(lockKey).catch(() => ({ ok: false, row: null }));
    if (!existing?.ok || !existing.row) {
        return { acquired: true, bestEffort: true, reason: 'sale_lock_lookup_failed' };
    }

    const currentValue = toObject(existing.row.value);
    if (String(currentValue.status || '').trim().toLowerCase() === 'sent') {
        return { acquired: false, deduped: true, reason: 'sale_already_sent', lockKey, value: currentValue };
    }

    const updatedAtMs = Date.parse(String(existing.row.updated_at || '').trim());
    const isStale = Number.isFinite(updatedAtMs) && (Date.now() - updatedAtMs) > LOCK_TTL_MS;
    if (isStale) {
        const stolen = await stealStaleLock(lockKey, existing.row.updated_at, value).catch(() => ({ ok: false, stolen: false }));
        if (stolen?.ok && stolen.stolen) {
            return { acquired: true, lockKey, value };
        }
        return { acquired: false, deduped: true, reason: 'sale_lock_contended', lockKey, value: currentValue };
    }

    return { acquired: false, deduped: true, reason: 'sale_inflight', lockKey, value: currentValue };
}

async function finalizeUtmfySaleLock(lock) {
    if (!lock?.lockKey || lock?.bestEffort) return;
    await markSent(lock.lockKey, lock.value).catch(() => null);
}

async function releaseUtmfySaleLock(lock) {
    if (!lock?.lockKey || lock?.bestEffort) return;
    await releaseLock(lock.lockKey).catch(() => null);
}

module.exports = {
    acquireUtmfySaleLock,
    finalizeUtmfySaleLock,
    releaseUtmfySaleLock,
    isPaidSaleEvent
};
