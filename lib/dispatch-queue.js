const fetchFn = global.fetch
    ? global.fetch.bind(global)
    : (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const { sendUtmfy } = require('./utmfy');
const { sendPushcut } = require('./pushcut');
const { sendPixelServerEvent } = require('./pixel-capi');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.SUPABASE_PROJECT_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || '';
const TABLE = process.env.SUPABASE_DISPATCH_TABLE || 'event_dispatch_queue';
const MAX_ATTEMPTS = Number(process.env.DISPATCH_MAX_ATTEMPTS || 6);
const STUCK_AFTER_MIN = Number(process.env.DISPATCH_STUCK_AFTER_MIN || 10);
const PROCESS_CONCURRENCY = Number(process.env.DISPATCH_CONCURRENCY || 6);
const IMMEDIATE_DEDUPE_TTL_MS = Number(process.env.DISPATCH_IMMEDIATE_DEDUPE_TTL_MS || 10 * 60 * 1000);
const IMMEDIATE_DEDUPE_CACHE = globalThis.__ifbImmediateDispatchDedupe || new Map();
if (!globalThis.__ifbImmediateDispatchDedupe) {
    globalThis.__ifbImmediateDispatchDedupe = IMMEDIATE_DEDUPE_CACHE;
}

function nowIso() {
    return new Date().toISOString();
}

function cleanupImmediateDedupeCache() {
    const now = Date.now();
    for (const [key, expiresAt] of IMMEDIATE_DEDUPE_CACHE.entries()) {
        if (!expiresAt || expiresAt <= now) {
            IMMEDIATE_DEDUPE_CACHE.delete(key);
        }
    }
}

function wasRecentlyDispatched(dedupeKey) {
    const key = String(dedupeKey || '').trim();
    if (!key) return false;
    cleanupImmediateDedupeCache();
    const expiresAt = Number(IMMEDIATE_DEDUPE_CACHE.get(key) || 0);
    return expiresAt > Date.now();
}

function markDispatchedNow(dedupeKey) {
    const key = String(dedupeKey || '').trim();
    if (!key) return;
    cleanupImmediateDedupeCache();
    IMMEDIATE_DEDUPE_CACHE.set(key, Date.now() + IMMEDIATE_DEDUPE_TTL_MS);
}

function supabaseHeaders() {
    return {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json'
    };
}

function backoffMs(attempts) {
    const base = 2000;
    const pow = Math.min(Math.max(Number(attempts) || 1, 1), 6);
    return base * 2 ** (pow - 1);
}

async function dispatchNow(job) {
    const channel = String(job?.channel || '').trim();
    if (!channel) return { ok: false, reason: 'invalid_channel' };

    if (channel === 'utmfy') {
        return sendUtmfy(job.eventName, job.payload || {});
    }
    if (channel === 'pushcut') {
        return sendPushcut(job.kind, job.payload || {});
    }
    if (channel === 'pixel') {
        return sendPixelServerEvent(job.eventName, job.payload || null, null);
    }

    return { ok: false, reason: 'unsupported_channel' };
}

async function enqueueDispatch(job) {
    const dedupeKey = job?.dedupeKey ? String(job.dedupeKey).trim() : '';

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        if (dedupeKey && wasRecentlyDispatched(dedupeKey)) {
            return { ok: true, deduped: true, fallback: 'immediate_no_supabase_deduped' };
        }
        const immediate = await dispatchNow(job).catch((error) => ({ ok: false, reason: error?.message || 'dispatch_error' }));
        if (immediate?.ok && dedupeKey) {
            markDispatchedNow(dedupeKey);
        }
        return { ...immediate, fallback: 'immediate_no_supabase' };
    }

    const payload = {
        channel: String(job?.channel || ''),
        event_name: String(job?.eventName || ''),
        kind: String(job?.kind || ''),
        payload: job?.payload || {},
        dedupe_key: job?.dedupeKey ? String(job.dedupeKey) : null,
        status: 'pending',
        attempts: 0,
        scheduled_at: job?.scheduledAt || nowIso(),
        created_at: nowIso(),
        updated_at: nowIso()
    };

    const url = new URL(`${SUPABASE_URL}/rest/v1/${TABLE}`);
    if (payload.dedupe_key) {
        url.searchParams.set('on_conflict', 'dedupe_key');
    }

    const response = await fetchFn(url.toString(), {
        method: 'POST',
        headers: {
            ...supabaseHeaders(),
            Prefer: `resolution=${payload.dedupe_key ? 'ignore-duplicates' : 'merge-duplicates'},return=representation`
        },
        body: JSON.stringify([payload])
    });

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        if (payload.dedupe_key && wasRecentlyDispatched(payload.dedupe_key)) {
            return {
                ok: true,
                deduped: true,
                fallback: 'immediate_queue_error_deduped',
                queue_error: detail || ''
            };
        }
        const immediate = await dispatchNow(job).catch((error) => ({ ok: false, reason: error?.message || 'dispatch_error' }));
        if (immediate?.ok && payload.dedupe_key) {
            markDispatchedNow(payload.dedupe_key);
        }
        return {
            ...immediate,
            fallback: 'immediate_queue_error',
            queue_error: detail || ''
        };
    }

    const rows = await response.json().catch(() => []);
    return { ok: true, queued: Array.isArray(rows) && rows.length > 0 };
}

async function fetchPending(limit = 50) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${TABLE}`);
    url.searchParams.set('select', 'id,channel,event_name,kind,payload,status,attempts,scheduled_at');
    url.searchParams.set('status', 'eq.pending');
    url.searchParams.set('scheduled_at', `lte.${nowIso()}`);
    url.searchParams.set('order', 'scheduled_at.asc');
    url.searchParams.set('limit', String(limit));

    const response = await fetchFn(url.toString(), { headers: supabaseHeaders() });
    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        return { ok: false, reason: 'supabase_error', detail };
    }
    const rows = await response.json().catch(() => []);
    return { ok: true, rows: Array.isArray(rows) ? rows : [] };
}

async function recoverStuckProcessing() {
    const cutoff = new Date(Date.now() - STUCK_AFTER_MIN * 60 * 1000).toISOString();
    const endpoint = `${SUPABASE_URL}/rest/v1/${TABLE}?status=eq.processing&updated_at=lt.${encodeURIComponent(cutoff)}`;
    await fetchFn(endpoint, {
        method: 'PATCH',
        headers: supabaseHeaders(),
        body: JSON.stringify({
            status: 'pending',
            updated_at: nowIso(),
            last_error: `recovered_stuck_after_${STUCK_AFTER_MIN}m`
        })
    }).catch(() => null);
}

async function claim(row) {
    const attempts = Number(row?.attempts || 0) + 1;
    const endpoint = `${SUPABASE_URL}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(row.id)}&status=eq.pending`;
    const response = await fetchFn(endpoint, {
        method: 'PATCH',
        headers: {
            ...supabaseHeaders(),
            Prefer: 'return=representation'
        },
        body: JSON.stringify({
            status: 'processing',
            attempts,
            updated_at: nowIso()
        })
    });
    if (!response.ok) return null;
    const rows = await response.json().catch(() => []);
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function complete(id) {
    const endpoint = `${SUPABASE_URL}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(id)}`;
    await fetchFn(endpoint, {
        method: 'PATCH',
        headers: supabaseHeaders(),
        body: JSON.stringify({
            status: 'done',
            processed_at: nowIso(),
            updated_at: nowIso(),
            last_error: null
        })
    }).catch(() => null);
}

async function fail(id, attempts, reason) {
    const finalFail = attempts >= MAX_ATTEMPTS;
    const scheduledAt = finalFail
        ? nowIso()
        : new Date(Date.now() + backoffMs(attempts)).toISOString();
    const endpoint = `${SUPABASE_URL}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(id)}`;
    await fetchFn(endpoint, {
        method: 'PATCH',
        headers: supabaseHeaders(),
        body: JSON.stringify({
            status: finalFail ? 'failed' : 'pending',
            last_error: String(reason || '').slice(0, 800),
            scheduled_at: scheduledAt,
            updated_at: nowIso()
        })
    }).catch(() => null);
}

async function processDispatchQueue(limit = 50) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return { ok: true, skipped: true, reason: 'missing_supabase_config', processed: 0, succeeded: 0, failed: 0, remaining: 0 };
    }

    await recoverStuckProcessing();
    const pending = await fetchPending(limit);
    if (!pending.ok) {
        const detail = String(pending?.detail || '');
        // If queue table/migration is not present yet, do not break admin flows.
        if (detail.toLowerCase().includes('event_dispatch_queue') || detail.toLowerCase().includes('relation')) {
            return { ok: true, skipped: true, reason: 'queue_table_not_ready', processed: 0, succeeded: 0, failed: 0, remaining: 0 };
        }
        return pending;
    }

    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    const runOne = async (row) => {
        const claimed = await claim(row);
        if (!claimed) return;
        processed += 1;

        const result = await dispatchNow({
            channel: claimed.channel,
            eventName: claimed.event_name,
            kind: claimed.kind,
            payload: claimed.payload || {}
        }).catch((error) => ({ ok: false, reason: error?.message || 'dispatch_error' }));

        if (result?.ok) {
            succeeded += 1;
            await complete(claimed.id);
        } else {
            failed += 1;
            await fail(claimed.id, Number(claimed.attempts || 1), result?.detail || result?.reason || 'dispatch_error');
        }
    };

    const concurrency = Math.min(Math.max(PROCESS_CONCURRENCY, 1), 20);
    for (let i = 0; i < pending.rows.length; i += concurrency) {
        const chunk = pending.rows.slice(i, i + concurrency);
        await Promise.all(chunk.map((row) => runOne(row)));
    }

    return { ok: true, processed, succeeded, failed, remaining: Math.max(0, pending.rows.length - processed) };
}

module.exports = {
    enqueueDispatch,
    dispatchNow,
    processDispatchQueue
};
