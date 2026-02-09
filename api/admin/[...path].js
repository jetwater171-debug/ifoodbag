const { ensureAllowedRequest } = require('../../lib/request-guard');
const { verifyAdminPassword, issueAdminCookie, verifyAdminCookie, requireAdmin } = require('../../lib/admin-auth');
const { getSettings, saveSettings, defaultSettings } = require('../../lib/settings-store');
const { sendUtmfy } = require('../../lib/utmfy');
const { updateLeadByPixTxid } = require('../../lib/lead-store');
const { BASE_URL, fetchJson, authHeaders } = require('../../lib/ativus');

const fetchFn = global.fetch
    ? global.fetch.bind(global)
    : (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.SUPABASE_PROJECT_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || '';

const pick = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');
const isPaidStatus = (statusRaw) => /paid|approved|confirm|completed|success|conclu|aprov/.test(String(statusRaw || '').toLowerCase());

async function getLeads(req, res) {
    if (req.method !== 'GET') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    if (!requireAdmin(req, res)) return;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        res.status(500).json({ error: 'Supabase nao configurado.' });
        return;
    }

    const url = new URL(`${SUPABASE_URL}/rest/v1/leads_readable`);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const query = String(req.query.q || '').trim();

    url.searchParams.set('select', '*');
    url.searchParams.set('order', 'updated_at.desc');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));

    if (query) {
        const ilike = `%${query.replace(/%/g, '')}%`;
        url.searchParams.set('or', `nome.ilike.${ilike},email.ilike.${ilike},telefone.ilike.${ilike},cpf.ilike.${ilike}`);
    }

    const response = await fetchFn(url.toString(), {
        headers: {
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        res.status(502).json({ error: 'Falha ao buscar leads.', detail });
        return;
    }

    const data = await response.json().catch(() => []);
    res.status(200).json({ data });
}

async function getPages(req, res) {
    if (req.method !== 'GET') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    if (!requireAdmin(req, res)) return;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        res.status(500).json({ error: 'Supabase nao configurado.' });
        return;
    }

    const response = await fetchFn(`${SUPABASE_URL}/rest/v1/pageview_counts?select=*`, {
        headers: {
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        res.status(502).json({ error: 'Falha ao buscar paginas.', detail });
        return;
    }

    const data = await response.json().catch(() => []);
    res.json({ data });
}

async function login(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    let body = {};
    try {
        body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    } catch (_error) {
        res.status(400).json({ error: 'JSON invalido.' });
        return;
    }

    if (!verifyAdminPassword(body.password || '')) {
        res.status(401).json({ error: 'Senha invalida.' });
        return;
    }

    issueAdminCookie(res);
    res.status(200).json({ ok: true });
}

async function me(req, res) {
    if (req.method !== 'GET') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    if (!verifyAdminCookie(req)) {
        res.status(401).json({ ok: false });
        return;
    }
    res.status(200).json({ ok: true });
}

async function settings(req, res) {
    if (req.method === 'GET') {
        if (!requireAdmin(req, res)) return;
        const settingsData = await getSettings();
        res.status(200).json(settingsData);
        return;
    }

    if (req.method === 'POST') {
        if (!requireAdmin(req, res)) return;

        let body = {};
        try {
            body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
        } catch (_error) {
            res.status(400).json({ error: 'JSON invalido.' });
            return;
        }

        const payload = {
            ...defaultSettings,
            ...body,
            pixel: {
                ...defaultSettings.pixel,
                ...(body.pixel || {})
            },
            utmfy: {
                ...defaultSettings.utmfy,
                ...(body.utmfy || {})
            },
            features: {
                ...defaultSettings.features,
                ...(body.features || {})
            }
        };

        const result = await saveSettings(payload);
        if (!result.ok) {
            res.status(502).json({ error: 'Falha ao salvar configuracao.' });
            return;
        }

        res.status(200).json({ ok: true });
        return;
    }

    res.status(405).json({ error: 'Method not allowed' });
}

async function utmfyTest(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    if (!requireAdmin(req, res)) return;

    const result = await sendUtmfy('admin_test', {
        source: 'admin',
        timestamp: new Date().toISOString()
    });

    if (!result.ok) {
        res.status(400).json({ error: 'Falha ao enviar evento.', detail: result });
        return;
    }

    res.status(200).json({ ok: true });
}

async function utmfySale(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    if (!requireAdmin(req, res)) return;

    const amount = 56.1;
    const payload = {
        event: 'purchase',
        amount,
        currency: 'BRL',
        order_id: `manual-${Date.now()}`,
        source: 'admin_manual',
        created_at: new Date().toISOString()
    };

    const result = await sendUtmfy('purchase', payload);

    if (!result.ok) {
        res.status(400).json({ error: 'Falha ao enviar venda.', detail: result });
        return;
    }

    res.status(200).json({ ok: true, amount });
}

async function pixReconcile(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    if (!requireAdmin(req, res)) return;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        res.status(500).json({ error: 'Supabase nao configurado.' });
        return;
    }

    const limit = Math.min(Math.max(Number(req.query?.limit) || 20, 1), 100);
    const url = new URL(`${SUPABASE_URL}/rest/v1/leads`);
    url.searchParams.set('select', 'pix_txid,last_event,updated_at');
    url.searchParams.set('pix_txid', 'not.is.null');
    url.searchParams.set('or', '(last_event.is.null,last_event.neq.pix_confirmed)');
    url.searchParams.set('order', 'updated_at.desc');
    url.searchParams.set('limit', String(limit));

    const pendingRes = await fetchFn(url.toString(), {
        headers: {
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json'
        }
    });

    if (!pendingRes.ok) {
        const detail = await pendingRes.text().catch(() => '');
        res.status(502).json({ error: 'Falha ao buscar pendentes.', detail });
        return;
    }

    const rows = await pendingRes.json().catch(() => []);

    let checked = 0;
    let confirmed = 0;
    let pending = 0;
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
                pending += 1;
            }
        } catch (_error) {
            failed += 1;
        }
    }

    res.status(200).json({ ok: true, checked, confirmed, pending, failed });
}

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    if (!ensureAllowedRequest(req, res, { requireSession: false })) {
        return;
    }

    let route = '';
    if (req.query && (typeof req.query.path !== 'undefined' || typeof req.query.route !== 'undefined')) {
        const rawPath = typeof req.query.path !== 'undefined' ? req.query.path : req.query.route;
        const pathParts = Array.isArray(rawPath) ? rawPath : [rawPath].filter(Boolean);
        route = pathParts.join('/');
    }
    if (!route && req.url) {
        try {
            const url = new URL(req.url, 'http://localhost');
            const prefix = '/api/admin/';
            const idx = url.pathname.indexOf(prefix);
            if (idx >= 0) {
                route = url.pathname.slice(idx + prefix.length);
            }
        } catch (_error) {
            route = '';
        }
    }
    route = String(route || '').replace(/^\/+|\/+$/g, '');
    if (!route && req.method === 'POST' && req.body && typeof req.body === 'object' && 'password' in req.body) {
        route = 'login';
    }

    switch (route) {
        case 'login':
            return login(req, res);
        case 'me':
            return me(req, res);
        case 'settings':
            return settings(req, res);
        case 'leads':
            return getLeads(req, res);
        case 'pages':
            return getPages(req, res);
        case 'utmfy-test':
            return utmfyTest(req, res);
        case 'utmfy-sale':
            return utmfySale(req, res);
        case 'pix-reconcile':
            return pixReconcile(req, res);
        default:
            res.status(404).json({ error: 'Not found' });
            return;
    }
};
