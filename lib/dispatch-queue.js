const fetchFn = global.fetch
    ? global.fetch.bind(global)
    : (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const { sendUtmfy } = require('./utmfy');
const { sendPushcut } = require('./pushcut');
const { getLeadByPixTxid, getLeadBySessionId } = require('./lead-store');
const { dispatchMetaCapiJob } = require('./meta-capi');
const { dispatchSmsMaisJob } = require('./smsmais');
const { getSettings } = require('./settings-store');
const {
    REMARKETING_SMS_KIND,
    buildRemarketingSmsJob,
    leadHasAnyPaidPayment,
    normalizeBaseUrl,
    prepareRemarketingSms,
    checkLivePaymentPaid,
    normalizeDelayMinutes
} = require('./remarketing-sms');
const { resolveRecoveryOffer } = require('./remarketing-recovery');
const {
    acquireUtmfySaleLock,
    finalizeUtmfySaleLock,
    releaseUtmfySaleLock
} = require('./utmfy-dispatch-lock');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.SUPABASE_PROJECT_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || '';
const TABLE = process.env.SUPABASE_DISPATCH_TABLE || 'event_dispatch_queue';
const MAX_ATTEMPTS = Number(process.env.DISPATCH_MAX_ATTEMPTS || 6);
const STUCK_AFTER_MIN = Number(process.env.DISPATCH_STUCK_AFTER_MIN || 10);
const PROCESS_CONCURRENCY = Number(process.env.DISPATCH_CONCURRENCY || 6);
const IMMEDIATE_DEDUPE_TTL_MS = Number(process.env.DISPATCH_IMMEDIATE_DEDUPE_TTL_MS || 10 * 60 * 1000);
const REMARKETING_SCAN_LIMIT = Math.min(Math.max(Number(process.env.REMARKETING_SCAN_LIMIT || 5000), 50), 10000);
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

function asObject(input) {
    return input && typeof input === 'object' && !Array.isArray(input) ? input : {};
}

function isTerminalLeadState(leadData, expectedTxid = '') {
    if (!leadData) return false;
    const payload = asObject(leadData.payload);
    const leadTxid = String(
        leadData?.pix_txid ||
        payload?.pixTxid ||
        payload?.pix?.idTransaction ||
        payload?.pix?.txid ||
        ''
    ).trim();
    const targetTxid = String(expectedTxid || '').trim();
    if (targetTxid) {
        if (!leadTxid) return false;
        if (leadTxid !== targetTxid) return false;
    }
    const lastEvent = String(leadData.last_event || '').trim().toLowerCase();
    if (lastEvent === 'pix_confirmed' || lastEvent === 'pix_refunded' || lastEvent === 'pix_refused') return true;
    return Boolean(payload.pixPaidAt || payload.pixRefundedAt || payload.pixRefusedAt);
}

function isWaitingUtmEvent(job = {}) {
    const eventName = String(job?.eventName || '').trim().toLowerCase();
    if (eventName === 'pix_created' || eventName === 'upsell_pix_created' || eventName === 'checkout') {
        return true;
    }
    if (eventName === 'pix_status') {
        const status = String(job?.payload?.status || '').trim().toLowerCase();
        return status === 'waiting_payment' || status === 'pending';
    }
    return false;
}

async function shouldSkipStaleWaitingUtm(job = {}) {
    if (String(job?.channel || '').trim() !== 'utmfy') return false;
    if (!isWaitingUtmEvent(job)) return false;

    const payload = asObject(job?.payload);
    const txid = String(payload.txid || payload.pixTxid || '').trim();
    const sessionId = String(payload.sessionId || '').trim();
    const orderId = String(payload.orderId || '').trim();

    let lead = null;
    if (txid) {
        const byTxid = await getLeadByPixTxid(txid).catch(() => ({ ok: false, data: null }));
        lead = byTxid?.ok ? byTxid.data : null;
    }
    if (!lead && sessionId) {
        const bySession = await getLeadBySessionId(sessionId).catch(() => ({ ok: false, data: null }));
        lead = bySession?.ok ? bySession.data : null;
    }
    if (!lead && orderId && !txid) {
        // Legacy jobs can use orderId as session id.
        const byOrderAsSession = await getLeadBySessionId(orderId).catch(() => ({ ok: false, data: null }));
        lead = byOrderAsSession?.ok ? byOrderAsSession.data : null;
    }

    return isTerminalLeadState(lead, txid);
}

async function dispatchRemarketingSms(job = {}) {
    const payload = asObject(job?.payload);
    const sessionId = String(payload.sessionId || '').trim();
    const txid = String(payload.txid || '').trim();
    let lead = null;
    if (sessionId) {
        const bySession = await getLeadBySessionId(sessionId).catch(() => ({ ok: false, data: null }));
        lead = bySession?.ok ? bySession.data : null;
    }
    if (!lead && txid) {
        const byTxid = await getLeadByPixTxid(txid).catch(() => ({ ok: false, data: null }));
        lead = byTxid?.ok ? byTxid.data : null;
    }
    const source = String(payload.source || 'automatic').trim().toLowerCase();
    const historyBase = {
        source,
        sessionId,
        txid,
        requestedAt: String(payload.requestedAt || '').trim()
    };
    if (!lead) {
        return {
            ok: true,
            skipped: true,
            reason: 'remarketing_lead_not_found',
            history: { ...historyBase, outcome: 'skipped', reason: 'remarketing_lead_not_found' }
        };
    }
    const currentOffer = resolveRecoveryOffer(lead);
    if (txid && String(currentOffer?.txid || '') !== txid) {
        return {
            ok: true,
            skipped: true,
            reason: 'remarketing_payment_replaced',
            history: { ...historyBase, outcome: 'skipped', reason: 'remarketing_payment_replaced' }
        };
    }

    const settings = await getSettings().catch(() => ({}));
    const smsConfig = {
        ...asObject(settings?.smsmais),
        ...(source === 'manual' ? { remarketingEnabled: true } : {}),
        ...(payload.messageTemplate ? { remarketingMessage: String(payload.messageTemplate) } : {})
    };
    const prepared = prepareRemarketingSms({
        lead,
        smsConfig,
        baseUrl: payload.baseUrl
    });
    const preparedHistory = {
        ...historyBase,
        leadName: String(prepared?.variables?.nome || lead?.name || '').trim(),
        phone: String(prepared?.payload?.to || lead?.phone || '').replace(/\D/g, ''),
        message: String(prepared?.payload?.message || '').trim(),
        amount: Number(prepared?.offer?.originalAmount || lead?.pix_amount || 0),
        discountedAmount: Number(prepared?.offer?.discountedAmount || 0)
    };
    if (!prepared?.ok || prepared?.skipped) {
        return {
            ...prepared,
            history: {
                ...preparedHistory,
                outcome: prepared?.skipped ? 'skipped' : 'failed',
                reason: prepared?.reason || 'remarketing_prepare_failed'
            }
        };
    }

    const livePayment = await checkLivePaymentPaid(lead).catch((error) => ({
        ok: false,
        reason: error?.message || 'payment_status_check_failed'
    }));
    if (!livePayment?.ok) {
        const reason = livePayment?.reason || 'payment_status_check_failed';
        return { ok: false, reason, history: { ...preparedHistory, outcome: 'failed', reason } };
    }
    if (livePayment.paid) {
        return {
            ok: true,
            skipped: true,
            reason: 'payment_confirmed_before_sms',
            history: { ...preparedHistory, outcome: 'skipped', reason: 'payment_confirmed_before_sms' }
        };
    }
    if (!livePayment.pending) {
        return {
            ok: true,
            skipped: true,
            reason: 'payment_no_longer_pending',
            history: { ...preparedHistory, outcome: 'skipped', reason: 'payment_no_longer_pending' }
        };
    }

    const sent = await dispatchSmsMaisJob('sms', prepared.payload || {});
    return {
        ...sent,
        history: {
            ...preparedHistory,
            outcome: sent?.ok ? 'sent' : 'failed',
            reason: sent?.ok ? '' : String(sent?.reason || 'smsmais_send_failed'),
            sentAt: sent?.ok ? nowIso() : '',
            externalId: String(sent?.externalId || prepared?.payload?.externalId || ''),
            providerStatus: String(sent?.result?.status || ''),
            providerMessageId: sent?.result?.id ?? null,
            held: sent?.held === true
        }
    };
}

async function fetchRemarketingCandidates(delayMinutes) {
    const cutoff = new Date(Date.now() - normalizeDelayMinutes(delayMinutes) * 60 * 1000).toISOString();
    const url = new URL(`${SUPABASE_URL}/rest/v1/leads`);
    url.searchParams.set('select', '*');
    url.searchParams.set('pix_txid', 'not.is.null');
    url.searchParams.set('phone', 'not.is.null');
    url.searchParams.set('updated_at', `lte.${cutoff}`);
    url.searchParams.set('order', 'updated_at.desc');
    url.searchParams.set('limit', String(REMARKETING_SCAN_LIMIT));
    const response = await fetchFn(url.toString(), { headers: supabaseHeaders() });
    if (!response.ok) {
        return { ok: false, reason: 'remarketing_candidates_query_failed' };
    }
    const rows = await response.json().catch(() => []);
    return { ok: true, rows: Array.isArray(rows) ? rows : [] };
}

async function reconcileRemarketingSmsJobs() {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return { ok: true, skipped: true, reason: 'missing_supabase_config', scanned: 0, queued: 0 };
    }
    const settings = await getSettings().catch(() => ({}));
    const smsConfig = asObject(settings?.smsmais);
    if (smsConfig.enabled !== true || smsConfig.remarketingEnabled !== true) {
        return { ok: true, skipped: true, reason: 'remarketing_disabled', scanned: 0, queued: 0 };
    }
    const delayMinutes = normalizeDelayMinutes(smsConfig.remarketingDelayMinutes);
    const candidates = await fetchRemarketingCandidates(delayMinutes);
    if (!candidates.ok) return candidates;
    const baseUrl = normalizeBaseUrl(process.env.APP_PUBLIC_URL || 'https://ifoodparceiros.vercel.app');
    const jobs = candidates.rows.map((lead) => {
        if (leadHasAnyPaidPayment(lead)) return null;
        const offer = resolveRecoveryOffer(lead);
        if (!offer?.canRecover || offer.status !== 'pending' || !offer?.sessionId || !offer?.txid || !offer?.createdAt) return null;
        const dueAt = Date.parse(offer.createdAt) + delayMinutes * 60 * 1000;
        if (!Number.isFinite(dueAt) || dueAt > Date.now()) return null;
        return buildRemarketingSmsJob({
            sessionId: offer.sessionId,
            txid: offer.txid,
            createdAt: offer.createdAt,
            baseUrl,
            delayMinutes
        });
    }).filter(Boolean);
    if (!jobs.length) {
        return { ok: true, scanned: candidates.rows.length, eligible: 0, queued: 0 };
    }
    const createdAt = nowIso();
    const rows = jobs.map((job) => ({
        channel: job.channel,
        event_name: job.eventName,
        kind: job.kind,
        payload: { ...asObject(job.payload), source: 'automatic' },
        dedupe_key: job.dedupeKey,
        status: 'pending',
        attempts: 0,
        scheduled_at: job.scheduledAt,
        created_at: createdAt,
        updated_at: createdAt
    }));
    const url = new URL(`${SUPABASE_URL}/rest/v1/${TABLE}`);
    url.searchParams.set('on_conflict', 'dedupe_key');
    const response = await fetchFn(url.toString(), {
        method: 'POST',
        headers: {
            ...supabaseHeaders(),
            Prefer: 'resolution=ignore-duplicates,return=representation'
        },
        body: JSON.stringify(rows)
    });
    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        return { ok: false, reason: 'remarketing_queue_failed', detail };
    }
    const inserted = await response.json().catch(() => []);
    return {
        ok: true,
        scanned: candidates.rows.length,
        eligible: jobs.length,
        queued: Array.isArray(inserted) ? inserted.length : 0
    };
}

async function dispatchNow(job) {
    const channel = String(job?.channel || '').trim();
    if (!channel) return { ok: false, reason: 'invalid_channel' };

    if (channel === 'utmfy') {
        const skip = await shouldSkipStaleWaitingUtm(job).catch(() => false);
        if (skip) {
            return { ok: true, skipped: true, reason: 'stale_waiting_after_terminal' };
        }
        const saleLock = await acquireUtmfySaleLock({
            dedupeKey: job?.dedupeKey,
            eventName: job?.eventName,
            payload: job?.payload || {}
        }).catch(() => ({ acquired: true, bestEffort: true, reason: 'sale_lock_error' }));

        if (!saleLock?.acquired) {
            if (saleLock?.reason === 'sale_already_sent') {
                return { ok: true, skipped: true, reason: saleLock.reason };
            }
            return { ok: false, reason: saleLock?.reason || 'utmfy_sale_inflight' };
        }

        const result = await sendUtmfy(job.eventName, job.payload || {}).catch(async (error) => {
            await releaseUtmfySaleLock(saleLock).catch(() => null);
            return { ok: false, reason: error?.message || 'dispatch_error' };
        });

        if (result?.ok) {
            await finalizeUtmfySaleLock(saleLock).catch(() => null);
            return result;
        }

        await releaseUtmfySaleLock(saleLock).catch(() => null);
        return result;
    }
    if (channel === 'pushcut') {
        return sendPushcut(job.kind, job.payload || {});
    }
    if (channel === 'pixel') {
        return dispatchMetaCapiJob(job.payload || {});
    }
    if (channel === 'smsmais') {
        if (String(job.kind || job.eventName || '').trim().toLowerCase() === REMARKETING_SMS_KIND) {
            return dispatchRemarketingSms(job);
        }
        return dispatchSmsMaisJob(job.kind || job.eventName, job.payload || {});
    }

    return { ok: false, reason: 'unsupported_channel' };
}

async function enqueueDispatch(job) {
    const dedupeKey = job?.dedupeKey ? String(job.dedupeKey).trim() : '';
    if (dedupeKey && wasRecentlyDispatched(dedupeKey)) {
        return { ok: true, deduped: true, reason: 'immediate_dedupe_cache' };
    }

    const scheduledAtMs = Date.parse(String(job?.scheduledAt || ''));
    const isFutureJob = Number.isFinite(scheduledAtMs) && scheduledAtMs > Date.now() + 1000;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        if (isFutureJob) {
            return { ok: false, reason: 'scheduled_queue_unavailable' };
        }
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
        if (isFutureJob) {
            return {
                ok: false,
                reason: 'scheduled_queue_error',
                queue_error: detail || ''
            };
        }
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
    if (payload.dedupe_key) {
        markDispatchedNow(payload.dedupe_key);
    }
    return { ok: true, queued: Array.isArray(rows) && rows.length > 0 };
}

async function fetchPending(limit = 50) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${TABLE}`);
    url.searchParams.set('select', 'id,channel,event_name,kind,payload,dedupe_key,status,attempts,scheduled_at');
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

async function complete(id, result = null, currentPayload = {}) {
    const history = asObject(result?.history);
    const nextPayload = Object.keys(history).length
        ? {
            ...asObject(currentPayload),
            delivery: {
                ...asObject(asObject(currentPayload)?.delivery),
                ...history
            }
        }
        : null;
    const endpoint = `${SUPABASE_URL}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(id)}`;
    await fetchFn(endpoint, {
        method: 'PATCH',
        headers: supabaseHeaders(),
        body: JSON.stringify({
            status: 'done',
            processed_at: nowIso(),
            updated_at: nowIso(),
            last_error: null,
            ...(nextPayload ? { payload: nextPayload } : {})
        })
    }).catch(() => null);
}

async function enqueueManualRemarketingSms(job) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return { ok: false, reason: 'scheduled_queue_unavailable' };
    }
    const dedupeKey = String(job?.dedupeKey || '').trim();
    if (job?.kind !== REMARKETING_SMS_KIND || !dedupeKey.startsWith('smsmais:remarketing:')) {
        return { ok: false, reason: 'invalid_remarketing_job' };
    }
    const url = new URL(`${SUPABASE_URL}/rest/v1/${TABLE}`);
    url.searchParams.set('on_conflict', 'dedupe_key');
    const scheduledAt = nowIso();
    const response = await fetchFn(url.toString(), {
        method: 'POST',
        headers: { ...supabaseHeaders(), Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify([{
            channel: 'smsmais',
            event_name: REMARKETING_SMS_KIND,
            kind: REMARKETING_SMS_KIND,
            payload: asObject(job.payload),
            dedupe_key: dedupeKey,
            status: 'pending',
            attempts: 0,
            scheduled_at: scheduledAt,
            created_at: scheduledAt,
            updated_at: scheduledAt
        }])
    });
    if (!response.ok) return { ok: false, reason: 'remarketing_queue_error' };

    const lookup = new URL(`${SUPABASE_URL}/rest/v1/${TABLE}`);
    lookup.searchParams.set('select', 'id,status');
    lookup.searchParams.set('dedupe_key', `eq.${dedupeKey}`);
    lookup.searchParams.set('limit', '1');
    const found = await fetchFn(lookup.toString(), { headers: supabaseHeaders() });
    if (!found.ok) return { ok: false, reason: 'remarketing_queue_lookup_error' };
    const rows = await found.json().catch(() => []);
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return { ok: false, reason: 'remarketing_queue_not_found' };
    if (row.status !== 'pending') return { ok: true, queued: false, reason: 'already_processed' };

    const endpoint = `${SUPABASE_URL}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(row.id)}&status=eq.pending`;
    const promoted = await fetchFn(endpoint, {
        method: 'PATCH',
        headers: { ...supabaseHeaders(), Prefer: 'return=representation' },
        body: JSON.stringify({
            payload: asObject(job.payload),
            scheduled_at: scheduledAt,
            updated_at: scheduledAt
        })
    });
    if (!promoted.ok) return { ok: false, reason: 'remarketing_queue_promote_error' };
    const promotedRows = await promoted.json().catch(() => []);
    return {
        ok: true,
        queued: Array.isArray(promotedRows) && promotedRows.length > 0,
        reason: 'manual_send_scheduled'
    };
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

async function processDispatchQueue(limit = 50, options = {}) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return { ok: true, skipped: true, reason: 'missing_supabase_config', processed: 0, succeeded: 0, failed: 0, remaining: 0 };
    }

    const remarketing = options?.reconcileRemarketing === true
        ? await reconcileRemarketingSmsJobs().catch((error) => ({
            ok: false,
            reason: error?.message || 'remarketing_reconcile_failed'
        }))
        : null;
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
            dedupeKey: claimed.dedupe_key,
            payload: claimed.payload || {}
        }).catch((error) => ({ ok: false, reason: error?.message || 'dispatch_error' }));

        if (result?.ok) {
            succeeded += 1;
            await complete(claimed.id, result, claimed.payload || {});
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

    return {
        ok: true,
        processed,
        succeeded,
        failed,
        remaining: Math.max(0, pending.rows.length - processed),
        remarketing
    };
}

module.exports = {
    enqueueDispatch,
    enqueueManualRemarketingSms,
    dispatchNow,
    processDispatchQueue,
    reconcileRemarketingSmsJobs,
    _internals: {
        dispatchRemarketingSms
    }
};
