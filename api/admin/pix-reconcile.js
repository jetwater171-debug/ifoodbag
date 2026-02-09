const {
    BASE_URL,
    fetchJson,
    authHeaders
} = require('../../lib/ativus');
const { ensureAllowedRequest } = require('../../lib/request-guard');
const { requireAdmin } = require('../../lib/admin-auth');
const { updateLeadByPixTxid } = require('../../lib/lead-store');
const { sendUtmfy } = require('../../lib/utmfy');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.SUPABASE_PROJECT_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || '';

const pick = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');

const isPaidStatus = (statusRaw) => {
    const normalized = String(statusRaw || '').toLowerCase();
    return /paid|approved|confirm|completed|success|conclu|aprov/.test(normalized);
};

async function fetchPendingTxids(limit) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return { ok: false, reason: 'missing_supabase_config' };
    }

    const url = new URL(`${SUPABASE_URL}/rest/v1/leads`);
    url.searchParams.set('select', 'pix_txid,last_event,updated_at');
    url.searchParams.set('pix_txid', 'not.is.null');
    url.searchParams.set('or', '(last_event.is.null,last_event.neq.pix_confirmed)');
    url.searchParams.set('order', 'updated_at.desc');
    url.searchParams.set('limit', String(limit));

    const response = await fetch(url.toString(), {
        headers: {
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        return { ok: false, reason: 'supabase_error', detail };
    }

    const data = await response.json().catch(() => []);
    return { ok: true, data };
}

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    if (!ensureAllowedRequest(req, res, { requireSession: false })) {
        return;
    }

    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    if (!requireAdmin(req, res)) return;

    const limit = Math.min(Math.max(Number(req.query?.limit) || 20, 1), 100);
    const pending = await fetchPendingTxids(limit);
    if (!pending.ok) {
        res.status(502).json({ error: 'Falha ao buscar pendentes.', detail: pending.detail || pending.reason });
        return;
    }

    const rows = pending.data || [];
    let checked = 0;
    let confirmed = 0;
    let stillPending = 0;
    let failed = 0;

    for (const row of rows) {
        const txid = String(row.pix_txid || '').trim();
        if (!txid) continue;
        checked += 1;
        try {
            const { response, data } = await fetchJson(
                `${BASE_URL}/s1/getTransaction/api/getTransactionStatus.php?id_transaction=${encodeURIComponent(txid)}`,
                { method: 'GET', headers: authHeaders }
            );

            if (!response.ok) {
                failed += 1;
                continue;
            }

            const status = pick(
                data?.status,
                data?.status_transaction,
                data?.situacao,
                data?.transaction_status,
                data?.data?.status
            );

            if (isPaidStatus(status)) {
                confirmed += 1;
                updateLeadByPixTxid(txid, { last_event: 'pix_confirmed', stage: 'pix' }).catch(() => null);
                sendUtmfy('pix_confirmed', {
                    event: 'pix_confirmed',
                    txid,
                    status: String(status || '').toLowerCase(),
                    payload: data
                }).catch(() => null);
            } else {
                stillPending += 1;
            }
        } catch (_error) {
            failed += 1;
        }
    }

    res.status(200).json({ ok: true, checked, confirmed, pending: stillPending, failed });
};
