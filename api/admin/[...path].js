const { ensureAllowedRequest } = require('../../lib/request-guard');
const { verifyAdminPassword, issueAdminCookie, verifyAdminCookie, requireAdmin } = require('../../lib/admin-auth');
const { getSettings, saveSettings, defaultSettings } = require('../../lib/settings-store');
const { sendUtmfy } = require('../../lib/utmfy');
const { updateLeadByPixTxid, getLeadByPixTxid } = require('../../lib/lead-store');
const { sendPushcut } = require('../../lib/pushcut');
const { BASE_URL, fetchJson, authHeaders } = require('../../lib/ativus');
const {
    getAtivusStatus,
    isAtivusPaidStatus,
    isAtivusPendingStatus,
    isAtivusRefundedStatus,
    isAtivusRefusedStatus,
    mapAtivusStatusToUtmify
} = require('../../lib/ativus-status');
const { enqueueDispatch, processDispatchQueue } = require('../../lib/dispatch-queue');

const fetchFn = global.fetch
    ? global.fetch.bind(global)
    : (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.SUPABASE_PROJECT_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || '';

const pick = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');
const clamp = (value, min, max) => Math.min(Math.max(Number(value) || 0, min), max);

async function listLeadTxidsForReconcile({ maxTx = 2000, pageSize = 500 } = {}) {
    const txids = [];
    let offset = 0;

    while (txids.length < maxTx) {
        const url = new URL(`${SUPABASE_URL}/rest/v1/leads`);
        const limit = Math.min(pageSize, maxTx - txids.length);
        url.searchParams.set('select', 'pix_txid,last_event,updated_at');
        url.searchParams.set('pix_txid', 'not.is.null');
        url.searchParams.set('or', '(last_event.is.null,last_event.neq.pix_confirmed)');
        url.searchParams.set('order', 'updated_at.desc');
        url.searchParams.set('limit', String(limit));
        url.searchParams.set('offset', String(offset));

        const response = await fetchFn(url.toString(), {
            headers: {
                apikey: SUPABASE_SERVICE_KEY,
                Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const detail = await response.text().catch(() => '');
            return { ok: false, detail };
        }

        const rows = await response.json().catch(() => []);
        if (!Array.isArray(rows) || rows.length === 0) {
            break;
        }

        rows.forEach((row) => {
            const txid = String(row?.pix_txid || '').trim();
            if (txid) txids.push(txid);
        });

        if (rows.length < limit) {
            break;
        }
        offset += rows.length;
    }

    return {
        ok: true,
        txids: Array.from(new Set(txids))
    };
}

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
                ...(body.pixel || {}),
                capi: {
                    ...defaultSettings.pixel.capi,
                    ...(body.pixel?.capi || {})
                },
                events: {
                    ...defaultSettings.pixel.events,
                    ...(body.pixel?.events || {})
                }
            },
            utmfy: {
                ...defaultSettings.utmfy,
                ...(body.utmfy || {})
            },
            pushcut: {
                ...defaultSettings.pushcut,
                ...(body.pushcut || {})
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

    const result = await sendUtmfy('pix_created', {
        source: 'admin_test',
        sessionId: `admin-${Date.now()}`,
        amount: 19.9,
        personal: {
            name: 'Teste Admin',
            email: 'teste@local.dev'
        },
        shipping: {
            name: 'Envio Padrao iFood',
            price: 19.9
        },
        utm: {
            utm_source: 'admin_test',
            utm_medium: 'dashboard',
            utm_campaign: 'utmfy_test'
        }
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
        amount,
        sessionId: `manual-${Date.now()}`,
        personal: {
            name: 'Compra Manual',
            email: 'manual@local.dev'
        },
        shipping: {
            name: 'Envio Padrao iFood',
            price: amount
        },
        utm: {
            utm_source: 'admin_manual',
            utm_medium: 'dashboard',
            utm_campaign: 'manual_sale'
        }
    };

    const result = await sendUtmfy('pix_confirmed', payload);

    if (!result.ok) {
        res.status(400).json({ error: 'Falha ao enviar venda.', detail: result });
        return;
    }

    res.status(200).json({ ok: true, amount });
}

async function pushcutTest(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    if (!requireAdmin(req, res)) return;

    const cfg = (await getSettings())?.pushcut || {};
    if (cfg.enabled === false) {
        res.status(400).json({ ok: false, error: 'Pushcut desativado.' });
        return;
    }
    if (!String(cfg.pixCreatedUrl || '').trim() && !String(cfg.pixConfirmedUrl || '').trim()) {
        res.status(400).json({ ok: false, error: 'Configure ao menos uma URL de Pushcut.' });
        return;
    }

    const txid = `pushcut-test-${Date.now()}`;
    const basePayload = {
        txid,
        amount: 56.1,
        source: 'admin_test',
        created_at: new Date().toISOString()
    };

    const createdResult = await sendPushcut('pix_created', {
        ...basePayload,
        status: 'pending'
    }).catch((error) => ({ ok: false, reason: error?.message || 'request_error' }));

    const confirmedResult = await sendPushcut('pix_confirmed', {
        ...basePayload,
        status: 'paid'
    }).catch((error) => ({ ok: false, reason: error?.message || 'request_error' }));

    const ok = !!createdResult?.ok || !!confirmedResult?.ok;
    if (!ok) {
        res.status(400).json({
            ok: false,
            error: 'Falha ao enviar testes Pushcut.',
            results: {
                pix_created: createdResult,
                pix_confirmed: confirmedResult
            }
        });
        return;
    }

    res.status(200).json({
        ok: true,
        results: {
            pix_created: createdResult,
            pix_confirmed: confirmedResult
        }
    });
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

    const maxTx = clamp(req.query?.maxTx || 2000, 1, 20000);
    const concurrency = clamp(req.query?.concurrency || 6, 1, 12);
    const pageSize = clamp(req.query?.pageSize || 500, 50, 1000);
    const txidList = await listLeadTxidsForReconcile({ maxTx, pageSize });
    if (!txidList.ok) {
        res.status(502).json({
            error: 'Falha ao buscar txids no banco.',
            detail: txidList.detail || ''
        });
        return;
    }
    const uniqueTxids = txidList.txids;

    let checked = 0;
    let confirmed = 0;
    let pending = 0;
    let failed = 0;
    let updated = 0;
    let failedDetails = [];

    const runOne = async (txid) => {
        checked += 1;
        try {
            const { response, data } = await fetchJson(
                `${BASE_URL}/s1/getTransaction/api/getTransactionStatus.php?id_transaction=${encodeURIComponent(txid)}`,
                { method: 'GET', headers: authHeaders }
            );
            if (!response.ok) {
                failed += 1;
                if (failedDetails.length < 8) {
                    failedDetails.push({
                        txid,
                        status: response.status,
                        detail: data?.error || data?.message || ''
                    });
                }
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
                    const amount = Number(
                        data?.amount ||
                        data?.valor_bruto ||
                        data?.valor_liquido ||
                        data?.data?.amount ||
                        0
                    );
                    const gatewayFee = Number(data?.taxa_deposito || 0) + Number(data?.taxa_adquirente || 0);
                    const userCommission = Number(data?.deposito_liquido || data?.valor_liquido || 0);
                    enqueueDispatch({
                        channel: 'utmfy',
                        eventName: 'pix_status',
                        dedupeKey: `utmfy:status:${txid}:${utmifyStatus}`,
                        payload: {
                            event: 'pix_status',
                            orderId: leadData?.session_id || '',
                            txid,
                            status: utmifyStatus,
                            amount,
                            personal: leadData ? {
                                name: leadData.name,
                                email: leadData.email,
                                cpf: leadData.cpf,
                                phoneDigits: leadData.phone
                            } : null,
                            address: leadData ? {
                                street: leadData.address_line,
                                neighborhood: leadData.neighborhood,
                                city: leadData.city,
                                state: leadData.state,
                                cep: leadData.cep
                            } : null,
                            shipping: leadData ? {
                                id: leadData.shipping_id,
                                name: leadData.shipping_name,
                                price: leadData.shipping_price
                            } : null,
                            bump: leadData && leadData.bump_selected ? {
                                title: 'Seguro Bag',
                                price: leadData.bump_price
                            } : null,
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
                        }
                    }).then(() => processDispatchQueue(8)).catch(() => null);

                    enqueueDispatch({
                        channel: 'pushcut',
                        kind: 'pix_confirmed',
                        dedupeKey: `pushcut:pix_confirmed:${txid}`,
                        payload: { txid, status, amount }
                    }).then(() => processDispatchQueue(8)).catch(() => null);

                    if (isPaid) {
                        const forwarded = req?.headers?.['x-forwarded-for'];
                        const clientIp = typeof forwarded === 'string' && forwarded
                            ? forwarded.split(',')[0].trim()
                            : req?.socket?.remoteAddress || '';
                        const userAgent = req?.headers?.['user-agent'] || '';
                        enqueueDispatch({
                            channel: 'pixel',
                            eventName: 'Purchase',
                            dedupeKey: `pixel:purchase:${txid}`,
                            payload: { amount, client_ip: clientIp, user_agent: userAgent }
                        }).then(() => processDispatchQueue(8)).catch(() => null);
                    }
                }
            } else {
                failed += 1;
                if (failedDetails.length < 8) {
                    failedDetails.push({ txid, status: 200, detail: `status:${status || 'unknown'}` });
                }
            }
        } catch (_error) {
            failed += 1;
            if (failedDetails.length < 8) {
                failedDetails.push({ txid, status: 0, detail: 'request_error' });
            }
        }
    };

    for (let i = 0; i < uniqueTxids.length; i += concurrency) {
        const chunk = uniqueTxids.slice(i, i + concurrency);
        // Processa em paralelo controlado para reduzir tempo total sem sobrecarregar a API.
        await Promise.all(chunk.map((txid) => runOne(txid)));
    }

    res.status(200).json({
        ok: true,
        source: 'ativushub',
        candidates: uniqueTxids.length,
        checked,
        confirmed,
        pending,
        failed,
        updated,
        failedDetails
    });
}

async function processQueue(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    if (!requireAdmin(req, res)) return;

    const limit = clamp(req.query?.limit || 80, 1, 300);
    const result = await processDispatchQueue(limit);
    if (!result?.ok) {
        res.status(502).json({ error: 'Falha ao processar fila.', detail: result });
        return;
    }
    res.status(200).json({ ok: true, ...result });
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
        case 'pushcut-test':
            return pushcutTest(req, res);
        case 'pix-reconcile':
            return pixReconcile(req, res);
        case 'dispatch-process':
            return processQueue(req, res);
        default:
            res.status(404).json({ error: 'Not found' });
            return;
    }
};
