const { ensureAllowedRequest } = require('../../lib/request-guard');
const { verifyAdminPassword, issueAdminCookie, verifyAdminCookie, requireAdmin } = require('../../lib/admin-auth');
const { getSettings, saveSettings, defaultSettings } = require('../../lib/settings-store');
const { invalidatePaymentsConfigCache } = require('../../lib/payments-config-store');
const {
    buildPaymentsConfig,
    mergePaymentSettings,
    resolveGatewayFromPayload
} = require('../../lib/payment-gateway-config');
const { sendUtmfy } = require('../../lib/utmfy');
const { updateLeadByPixTxid, getLeadByPixTxid, updateLeadBySessionId, getLeadBySessionId } = require('../../lib/lead-store');
const { sendPushcut } = require('../../lib/pushcut');
const { requestTransactionStatus: requestAtivushubStatus } = require('../../lib/ativushub-provider');
const { requestTransactionById: requestGhostspayStatus } = require('../../lib/ghostspay-provider');
const { requestTransactionById: requestSunizeStatus } = require('../../lib/sunize-provider');
const {
    getAtivusStatus,
    isAtivusPaidStatus,
    isAtivusPendingStatus,
    isAtivusRefundedStatus,
    isAtivusRefusedStatus,
    mapAtivusStatusToUtmify
} = require('../../lib/ativus-status');
const {
    getGhostspayStatus,
    getGhostspayUpdatedAt,
    getGhostspayAmount,
    isGhostspayPaidStatus,
    isGhostspayPendingStatus,
    isGhostspayRefundedStatus,
    isGhostspayRefusedStatus,
    isGhostspayChargebackStatus,
    mapGhostspayStatusToUtmify
} = require('../../lib/ghostspay-status');
const {
    getSunizeStatus,
    getSunizeUpdatedAt,
    getSunizeAmount,
    isSunizePaidStatus,
    isSunizePendingStatus,
    isSunizeRefundedStatus,
    isSunizeRefusedStatus,
    mapSunizeStatusToUtmify
} = require('../../lib/sunize-status');
const { enqueueDispatch, processDispatchQueue } = require('../../lib/dispatch-queue');

const fetchFn = global.fetch
    ? global.fetch.bind(global)
    : (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.SUPABASE_PROJECT_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || '';

const pick = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');
const clamp = (value, min, max) => Math.min(Math.max(Number(value) || 0, min), max);
const SECRET_MASK = '__SECRET_SET__';

function asObject(input) {
    if (!input) return {};
    if (typeof input === 'object' && !Array.isArray(input)) return input;
    if (typeof input === 'string') {
        try {
            const parsed = JSON.parse(input);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (_error) {
            return {};
        }
    }
    return {};
}

function toIsoDate(value) {
    if (!value && value !== 0) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
    if (typeof value === 'number') {
        const ms = value > 1e12 ? value : value * 1000;
        const d = new Date(ms);
        return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    const str = String(value || '').trim();
    if (!str) return null;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(str)) {
        const d = new Date(str.replace(' ', 'T'));
        if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    const d = new Date(str);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function mergeLeadPayload(basePayload, patch) {
    return {
        ...asObject(basePayload),
        ...Object.fromEntries(
            Object.entries(asObject(patch)).filter(([, value]) => value !== undefined)
        )
    };
}

function normalizeStatusText(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9_ -]/g, '')
        .trim();
}

function isPaidFromStatus(status) {
    const s = normalizeStatusText(status);
    if (!s) return false;
    if (s.includes('aguardando') || s.includes('waiting') || s.includes('pending')) return false;
    if (s.includes('refund') || s.includes('estorno')) return false;
    if (s.includes('cancel') || s.includes('failed') || s.includes('recus')) return false;
    return (
        s.includes('paid') ||
        s.includes('pago') ||
        s.includes('authoriz') ||
        s.includes('approved') ||
        s.includes('aprovad') ||
        s.includes('completed') ||
        s.includes('confirm')
    );
}

function normalizeAmountPossiblyCents(value) {
    if (value === undefined || value === null || value === '') return 0;
    const raw = String(value).trim();
    if (!raw) return 0;
    const normalized = raw.replace(',', '.');
    const amount = Number(normalized);
    if (!Number.isFinite(amount)) return 0;
    const hasDecimalMark = /[.,]/.test(raw);
    if (hasDecimalMark) return Number(amount.toFixed(2));
    if (Number.isInteger(amount) && Math.abs(amount) >= 100) {
        return Number((amount / 100).toFixed(2));
    }
    return Number(amount.toFixed(2));
}

function pickSecretInput(inputValue, existingValue) {
    const raw = inputValue === undefined || inputValue === null ? '' : String(inputValue);
    if (raw === SECRET_MASK) return String(existingValue || '');
    return raw;
}

function maskSecret(value) {
    const text = String(value || '').trim();
    return text ? SECRET_MASK : '';
}

function sanitizeSettingsForAdmin(settingsData = {}) {
    const source = settingsData && typeof settingsData === 'object' ? settingsData : {};
    const payload = JSON.parse(JSON.stringify(source));
    payload.pixel = payload.pixel || {};
    payload.pixel.capi = payload.pixel.capi || {};
    payload.utmfy = payload.utmfy || {};
    payload.payments = payload.payments || {};
    payload.payments.gateways = payload.payments.gateways || {};
    payload.payments.gateways.ativushub = payload.payments.gateways.ativushub || {};
    payload.payments.gateways.ghostspay = payload.payments.gateways.ghostspay || {};
    payload.payments.gateways.sunize = payload.payments.gateways.sunize || {};

    payload.pixel.capi.accessToken = maskSecret(payload.pixel.capi.accessToken);
    payload.utmfy.apiKey = maskSecret(payload.utmfy.apiKey);

    payload.payments.gateways.ativushub.apiKey = maskSecret(
        payload.payments.gateways.ativushub.apiKey || payload.payments.gateways.ativushub.apiKeyBase64
    );
    payload.payments.gateways.ativushub.apiKeyBase64 = '';
    payload.payments.gateways.ativushub.webhookToken = maskSecret(payload.payments.gateways.ativushub.webhookToken);

    payload.payments.gateways.ghostspay.secretKey = maskSecret(payload.payments.gateways.ghostspay.secretKey);
    payload.payments.gateways.ghostspay.basicAuthBase64 = '';
    payload.payments.gateways.ghostspay.webhookToken = maskSecret(payload.payments.gateways.ghostspay.webhookToken);
    payload.payments.gateways.sunize.apiKey = maskSecret(payload.payments.gateways.sunize.apiKey);
    payload.payments.gateways.sunize.apiSecret = maskSecret(payload.payments.gateways.sunize.apiSecret);

    return payload;
}

function isLeadPaid(row, payload) {
    if (String(row?.last_event || '').toLowerCase().trim() === 'pix_confirmed') return true;
    if (toIsoDate(payload?.pixPaidAt)) return true;
    if (toIsoDate(payload?.approvedDate)) return true;
    if (isPaidFromStatus(payload?.pixStatus)) return true;
    if (isPaidFromStatus(payload?.status)) return true;
    if (isPaidFromStatus(payload?.status_transaction)) return true;
    if (isPaidFromStatus(payload?.situacao)) return true;
    if (isPaidFromStatus(payload?.payload?.status)) return true;
    if (isPaidFromStatus(payload?.payload?.situacao)) return true;
    return false;
}

function resolveEventTime(row, payload) {
    if (isLeadPaid(row, payload)) {
        return (
            toIsoDate(payload.pixPaidAt) ||
            toIsoDate(payload.approvedDate) ||
            toIsoDate(payload.data_transacao) ||
            toIsoDate(payload.pixStatusChangedAt) ||
            toIsoDate(row?.updated_at)
        );
    }

    const eventName = String(row?.last_event || '').toLowerCase().trim();
    if (eventName === 'pix_confirmed') {
        return (
            toIsoDate(payload.pixPaidAt) ||
            toIsoDate(payload.approvedDate) ||
            toIsoDate(payload.data_transacao) ||
            toIsoDate(payload.pixStatusChangedAt) ||
            toIsoDate(row?.updated_at)
        );
    }
    if (eventName === 'pix_refunded') {
        return (
            toIsoDate(payload.pixRefundedAt) ||
            toIsoDate(payload.refundedAt) ||
            toIsoDate(payload.data_transacao) ||
            toIsoDate(payload.pixStatusChangedAt) ||
            toIsoDate(row?.updated_at)
        );
    }
    if (eventName === 'pix_refused' || eventName === 'pix_pending') {
        return (
            toIsoDate(payload.pixStatusChangedAt) ||
            toIsoDate(payload.data_transacao) ||
            toIsoDate(payload.data_registro) ||
            toIsoDate(row?.updated_at)
        );
    }
    if (eventName === 'pix_created') {
        return (
            toIsoDate(payload.pixCreatedAt) ||
            toIsoDate(payload.createdAt) ||
            toIsoDate(row?.created_at) ||
            toIsoDate(row?.updated_at)
        );
    }
    return (
        toIsoDate(payload.pixStatusChangedAt) ||
        toIsoDate(payload.pixCreatedAt) ||
        toIsoDate(row?.updated_at) ||
        toIsoDate(row?.created_at)
    );
}

function resolveLeadGateway(row, payload) {
    return resolveGatewayFromPayload({
        ...asObject(payload),
        gateway: row?.gateway,
        provider: row?.provider
    }, 'ativushub');
}

function gatewayLabel(gateway) {
    if (gateway === 'sunize') return 'Sunize';
    return gateway === 'ghostspay' ? 'GhostsPay' : 'AtivusHUB';
}

function gatewayConversionPercent(stats = {}) {
    const pix = Number(stats?.pix || 0);
    const paid = Number(stats?.paid || 0);
    if (!pix) return 0;
    return Math.round((paid / pix) * 100);
}

function mapLeadReadable(row) {
    const payload = asObject(row?.payload);
    const gateway = resolveLeadGateway(row, payload);
    const isPaid = isLeadPaid(row, payload);
    const isUpsell = Boolean(
        payload?.upsell?.enabled === true ||
        String(row?.shipping_id || '').trim().toLowerCase() === 'expresso_1dia' ||
        /adiantamento|prioridade|expresso/i.test(String(row?.shipping_name || ''))
    );
    const statusFunil = isPaid
        ? (isUpsell ? 'upsell_pagamento_confirmado' : 'pagamento_confirmado')
        : row?.last_event === 'pix_refunded'
            ? 'pix_estornado'
            : row?.last_event === 'pix_refused'
                ? 'pix_recusado'
                : row?.pix_txid
                    ? 'pix_gerado'
                    : row?.shipping_id
                        ? 'frete_selecionado'
                        : row?.cep
                            ? 'cep_confirmado'
                            : row?.email || row?.phone
                                ? 'dados_pessoais'
                                : 'inicio';
    const evento = isPaid ? 'pix_confirmed' : (row?.last_event || '-');

    return {
        session_id: row?.session_id || '',
        nome: row?.name || '-',
        cpf: row?.cpf || '-',
        email: row?.email || '-',
        telefone: row?.phone || '-',
        etapa: row?.stage || '-',
        evento,
        cep: row?.cep || '-',
        endereco: [row?.address_line, row?.number, row?.neighborhood, row?.city, row?.state]
            .filter(Boolean)
            .join(', '),
        frete: row?.shipping_name || '-',
        valor_frete: row?.shipping_price ?? null,
        seguro_bag: row?.bump_selected ? 'sim' : 'nao',
        valor_seguro: row?.bump_price ?? null,
        pix_txid: row?.pix_txid || '-',
        valor_total: row?.pix_amount ?? null,
        is_upsell: isUpsell,
        gateway,
        gateway_label: gatewayLabel(gateway),
        utm_source: row?.utm_source || '-',
        utm_campaign: row?.utm_campaign || '-',
        fbclid: row?.fbclid || '-',
        gclid: row?.gclid || '-',
        status_funil: statusFunil,
        is_paid: isPaid,
        updated_at: row?.updated_at || null,
        created_at: row?.created_at || null,
        event_time: resolveEventTime(row, payload)
    };
}

async function listLeadTxidsForReconcile({ maxTx = 50000, pageSize = 500, includeConfirmed = true } = {}) {
    const entries = [];
    const seen = new Set();
    let offset = 0;
    let scannedRows = 0;

    while (entries.length < maxTx) {
        const url = new URL(`${SUPABASE_URL}/rest/v1/leads`);
        const limit = Math.min(pageSize, maxTx - entries.length);
        url.searchParams.set('select', 'session_id,pix_txid,payload,last_event,updated_at');
        if (!includeConfirmed) {
            url.searchParams.set('or', '(last_event.is.null,last_event.neq.pix_confirmed)');
        }
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
        scannedRows += rows.length;

        rows.forEach((row) => {
            const fallbackTxid = String(
                row?.payload?.pixTxid ||
                row?.payload?.pix?.idTransaction ||
                row?.payload?.pix?.idtransaction ||
                row?.payload?.idTransaction ||
                row?.payload?.idtransaction ||
                row?.payload?.id ||
                ''
            ).trim();
            const txid = String(row?.pix_txid || fallbackTxid || '').trim();
            if (!txid || txid === '-') return;

            const payload = asObject(row?.payload);
            const gateway = resolveLeadGateway(row, payload);
            const key = `${gateway}:${txid}`;
            if (seen.has(key)) return;
            seen.add(key);
            entries.push({
                txid,
                gateway,
                sessionId: String(row?.session_id || payload?.sessionId || payload?.orderId || '').trim()
            });
        });

        if (rows.length < limit) {
            break;
        }
        offset += rows.length;
    }

    return {
        ok: true,
        entries,
        scannedRows
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

    const url = new URL(`${SUPABASE_URL}/rest/v1/leads`);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const query = String(req.query.q || '').trim();

    url.searchParams.set('select', 'session_id,name,cpf,email,phone,stage,last_event,cep,address_line,number,neighborhood,city,state,shipping_name,shipping_price,bump_selected,bump_price,pix_txid,pix_amount,utm_source,utm_campaign,fbclid,gclid,payload,updated_at,created_at');
    url.searchParams.set('order', 'updated_at.desc');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));

    if (query) {
        const ilike = `%${query.replace(/%/g, '')}%`;
        url.searchParams.set('or', `name.ilike.${ilike},email.ilike.${ilike},phone.ilike.${ilike},cpf.ilike.${ilike}`);
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

    const rows = await response.json().catch(() => []);
    const data = Array.isArray(rows) ? rows.map(mapLeadReadable) : [];

    const withSummary = String(req.query.summary || '0') === '1';
    if (!withSummary) {
        res.status(200).json({ data });
        return;
    }

    const summary = {
        total: 0,
        cep: 0,
        frete: 0,
        pix: 0,
        paid: 0,
        refunded: 0,
        refused: 0,
        pending: 0,
        lastUpdated: null,
        gatewayStats: {
            ativushub: {
                gateway: 'ativushub',
                label: gatewayLabel('ativushub'),
                leads: 0,
                pix: 0,
                paid: 0,
                refunded: 0,
                refused: 0,
                pending: 0
            },
            ghostspay: {
                gateway: 'ghostspay',
                label: gatewayLabel('ghostspay'),
                leads: 0,
                pix: 0,
                paid: 0,
                refunded: 0,
                refused: 0,
                pending: 0
            },
            sunize: {
                gateway: 'sunize',
                label: gatewayLabel('sunize'),
                leads: 0,
                pix: 0,
                paid: 0,
                refunded: 0,
                refused: 0,
                pending: 0
            }
        }
    };

    const maxSummaryRows = clamp(req.query.summaryMax || 20000, 1, 50000);
    const pageSize = 1000;
    let summaryOffset = 0;
    let done = false;

    while (!done && summaryOffset < maxSummaryRows) {
        const u = new URL(`${SUPABASE_URL}/rest/v1/leads`);
        const take = Math.min(pageSize, maxSummaryRows - summaryOffset);
        u.searchParams.set('select', 'cep,shipping_name,pix_txid,last_event,updated_at,created_at,payload');
        u.searchParams.set('order', 'updated_at.desc');
        u.searchParams.set('limit', String(take));
        u.searchParams.set('offset', String(summaryOffset));
        if (query) {
            const ilike = `%${query.replace(/%/g, '')}%`;
            u.searchParams.set('or', `name.ilike.${ilike},email.ilike.${ilike},phone.ilike.${ilike},cpf.ilike.${ilike}`);
        }

        const r = await fetchFn(u.toString(), {
            headers: {
                apikey: SUPABASE_SERVICE_KEY,
                Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        if (!r.ok) break;
        const rows = await r.json().catch(() => []);
        if (!Array.isArray(rows) || rows.length === 0) break;

        rows.forEach((row) => {
            const mapped = mapLeadReadable(row);
            const gateway = mapped.gateway === 'ghostspay'
                ? 'ghostspay'
                : mapped.gateway === 'sunize'
                    ? 'sunize'
                    : 'ativushub';
            const gatewaySummary = summary.gatewayStats[gateway];
            summary.total += 1;
            gatewaySummary.leads += 1;
            if (String(row?.cep || '').trim() && String(row?.cep || '').trim() !== '-') summary.cep += 1;
            if (String(row?.shipping_name || '').trim() && String(row?.shipping_name || '').trim() !== '-') summary.frete += 1;
            if (String(row?.pix_txid || '').trim() && String(row?.pix_txid || '').trim() !== '-') {
                summary.pix += 1;
                gatewaySummary.pix += 1;
            }

            const ev = String(mapped?.evento || '').toLowerCase().trim();
            if (mapped?.is_paid || ev === 'pix_confirmed') {
                summary.paid += 1;
                gatewaySummary.paid += 1;
            } else if (ev === 'pix_refunded') {
                summary.refunded += 1;
                gatewaySummary.refunded += 1;
            } else if (ev === 'pix_refused') {
                summary.refused += 1;
                gatewaySummary.refused += 1;
            } else if (ev === 'pix_pending' || ev === 'pix_created') {
                summary.pending += 1;
                gatewaySummary.pending += 1;
            }

            const eventTime = mapped?.event_time || row?.updated_at || null;
            const currentTs = summary.lastUpdated ? Date.parse(summary.lastUpdated) : 0;
            const rowTs = eventTime ? Date.parse(eventTime) : 0;
            if (!summary.lastUpdated || (rowTs && rowTs > currentTs)) {
                summary.lastUpdated = eventTime;
            }
        });

        summaryOffset += rows.length;
        done = rows.length < take;
    }

    summary.gatewayStats = summary.gatewayStats || {};
    summary.gatewayStats.ativushub = {
        gateway: 'ativushub',
        label: gatewayLabel('ativushub'),
        ...(summary.gatewayStats.ativushub || { leads: 0, pix: 0, paid: 0, refunded: 0, refused: 0, pending: 0 })
    };
    summary.gatewayStats.ghostspay = {
        gateway: 'ghostspay',
        label: gatewayLabel('ghostspay'),
        ...(summary.gatewayStats.ghostspay || { leads: 0, pix: 0, paid: 0, refunded: 0, refused: 0, pending: 0 })
    };
    summary.gatewayStats.sunize = {
        gateway: 'sunize',
        label: gatewayLabel('sunize'),
        ...(summary.gatewayStats.sunize || { leads: 0, pix: 0, paid: 0, refunded: 0, refused: 0, pending: 0 })
    };
    summary.gatewayStats.ativushub.conversion = gatewayConversionPercent(summary.gatewayStats.ativushub);
    summary.gatewayStats.ghostspay.conversion = gatewayConversionPercent(summary.gatewayStats.ghostspay);
    summary.gatewayStats.sunize.conversion = gatewayConversionPercent(summary.gatewayStats.sunize);

    res.status(200).json({ data, summary });
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

async function getBackredirects(req, res) {
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
        res.status(502).json({ error: 'Falha ao buscar dados de backredirect.', detail });
        return;
    }

    const rows = await response.json().catch(() => []);
    const totalsByPage = new Map(
        (Array.isArray(rows) ? rows : []).map((row) => [
            String(row?.page || '').trim().toLowerCase(),
            Number(row?.total) || 0
        ])
    );

    const prefix = 'backredirect_';
    const data = [];
    totalsByPage.forEach((backTotal, pageKey) => {
        if (!pageKey.startsWith(prefix)) return;
        const page = pageKey.slice(prefix.length);
        if (!page) return;
        const pageViews = Number(totalsByPage.get(page) || 0);
        const rate = pageViews > 0
            ? Math.round((Number(backTotal || 0) / pageViews) * 1000) / 10
            : 0;
        data.push({
            page,
            backTotal: Number(backTotal || 0),
            pageViews,
            rate
        });
    });

    data.sort((a, b) => {
        if (b.backTotal !== a.backTotal) return b.backTotal - a.backTotal;
        if (b.rate !== a.rate) return b.rate - a.rate;
        return a.page.localeCompare(b.page);
    });

    const totalBack = data.reduce((sum, row) => sum + Number(row.backTotal || 0), 0);
    const totalViews = data.reduce((sum, row) => sum + Number(row.pageViews || 0), 0);
    const avgRate = totalViews > 0 ? Math.round((totalBack / totalViews) * 1000) / 10 : 0;

    res.json({
        data,
        summary: {
            totalBack,
            totalViews,
            avgRate
        }
    });
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

function normalizePushcutUrls(urls = []) {
    const seen = new Set();
    const out = [];
    for (const raw of urls) {
        const url = String(raw || '').trim();
        if (!url || seen.has(url)) continue;
        seen.add(url);
        out.push(url);
    }
    return out.slice(0, 2);
}

function buildPushcutConfig(raw = {}) {
    const createdUrls = normalizePushcutUrls([
        ...(Array.isArray(raw.pixCreatedUrls) ? raw.pixCreatedUrls : []),
        raw.pixCreatedUrl,
        raw.pixCreatedUrl2
    ]);
    const confirmedUrls = normalizePushcutUrls([
        ...(Array.isArray(raw.pixConfirmedUrls) ? raw.pixConfirmedUrls : []),
        raw.pixConfirmedUrl,
        raw.pixConfirmedUrl2
    ]);

    return {
        ...defaultSettings.pushcut,
        ...raw,
        pixCreatedUrl: createdUrls[0] || '',
        pixCreatedUrl2: createdUrls[1] || '',
        pixCreatedUrls: createdUrls,
        pixConfirmedUrl: confirmedUrls[0] || '',
        pixConfirmedUrl2: confirmedUrls[1] || '',
        pixConfirmedUrls: confirmedUrls,
        templates: {
            ...defaultSettings.pushcut.templates,
            ...(raw.templates || {})
        }
    };
}

async function settings(req, res) {
    if (req.method === 'GET') {
        if (!requireAdmin(req, res)) return;
        const settingsData = await getSettings();
        res.status(200).json(sanitizeSettingsForAdmin(settingsData));
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

        const currentSaved = await getSettings().catch(() => ({}));
        const currentPayments = buildPaymentsConfig(currentSaved?.payments || {});
        const bodyPayments = body?.payments && typeof body.payments === 'object' ? body.payments : {};
        const bodyGateways = bodyPayments.gateways && typeof bodyPayments.gateways === 'object'
            ? bodyPayments.gateways
            : {};
        const bodyAtivus = bodyGateways.ativushub && typeof bodyGateways.ativushub === 'object'
            ? bodyGateways.ativushub
            : {};
        const bodyGhost = bodyGateways.ghostspay && typeof bodyGateways.ghostspay === 'object'
            ? bodyGateways.ghostspay
            : {};
        const bodySunize = bodyGateways.sunize && typeof bodyGateways.sunize === 'object'
            ? bodyGateways.sunize
            : {};
        const currentAtivusGateway = currentPayments?.gateways?.ativushub || {};
        const currentGhostGateway = currentPayments?.gateways?.ghostspay || {};
        const currentSunizeGateway = currentPayments?.gateways?.sunize || {};
        const mergedPaymentsInput = {
            ...(bodyPayments || {}),
            gateways: {
                ...(bodyGateways || {}),
                ativushub: {
                    ...bodyAtivus,
                    apiKey: pickSecretInput(bodyAtivus.apiKey, currentAtivusGateway.apiKey || currentAtivusGateway.apiKeyBase64 || ''),
                    apiKeyBase64: pickSecretInput(bodyAtivus.apiKeyBase64, currentAtivusGateway.apiKeyBase64 || ''),
                    webhookToken: pickSecretInput(bodyAtivus.webhookToken, currentAtivusGateway.webhookToken || ''),
                    webhookTokenRequired: bodyAtivus.webhookTokenRequired !== undefined
                        ? !!bodyAtivus.webhookTokenRequired
                        : currentAtivusGateway.webhookTokenRequired !== false
                },
                ghostspay: {
                    ...bodyGhost,
                    secretKey: pickSecretInput(bodyGhost.secretKey, currentGhostGateway.secretKey || ''),
                    basicAuthBase64: pickSecretInput(bodyGhost.basicAuthBase64, currentGhostGateway.basicAuthBase64 || ''),
                    webhookToken: pickSecretInput(bodyGhost.webhookToken, currentGhostGateway.webhookToken || ''),
                    webhookTokenRequired: bodyGhost.webhookTokenRequired !== undefined
                        ? !!bodyGhost.webhookTokenRequired
                        : currentGhostGateway.webhookTokenRequired === true
                },
                sunize: {
                    ...bodySunize,
                    apiKey: pickSecretInput(bodySunize.apiKey, currentSunizeGateway.apiKey || ''),
                    apiSecret: pickSecretInput(bodySunize.apiSecret, currentSunizeGateway.apiSecret || ''),
                    webhookTokenRequired: bodySunize.webhookTokenRequired !== undefined
                        ? !!bodySunize.webhookTokenRequired
                        : currentSunizeGateway.webhookTokenRequired === true
                }
            }
        };

        const bodyPixel = body.pixel && typeof body.pixel === 'object' ? body.pixel : {};
        const bodyPixelCapi = bodyPixel.capi && typeof bodyPixel.capi === 'object' ? bodyPixel.capi : {};
        const currentPixel = currentSaved?.pixel || {};
        const currentPixelCapi = currentPixel.capi || {};
        const currentUtmfy = currentSaved?.utmfy || {};
        const currentPushcut = currentSaved?.pushcut || {};
        const bodyUtmfy = body.utmfy && typeof body.utmfy === 'object' ? body.utmfy : {};
        const bodyPushcut = body.pushcut && typeof body.pushcut === 'object' ? body.pushcut : {};

        const payload = {
            ...defaultSettings,
            ...body,
            pixel: {
                ...defaultSettings.pixel,
                ...bodyPixel,
                capi: {
                    ...defaultSettings.pixel.capi,
                    ...bodyPixelCapi,
                    accessToken: pickSecretInput(bodyPixelCapi.accessToken, currentPixelCapi.accessToken || '')
                },
                events: {
                    ...defaultSettings.pixel.events,
                    ...(bodyPixel?.events || {})
                }
            },
            utmfy: {
                ...defaultSettings.utmfy,
                ...bodyUtmfy,
                apiKey: pickSecretInput(bodyUtmfy.apiKey, currentUtmfy.apiKey || '')
            },
            pushcut: buildPushcutConfig({
                ...currentPushcut,
                ...bodyPushcut
            }),
            payments: mergePaymentSettings(currentSaved?.payments || defaultSettings.payments || {}, mergedPaymentsInput),
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

        invalidatePaymentsConfigCache();
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
    const hasCreated = normalizePushcutUrls([
        ...(Array.isArray(cfg.pixCreatedUrls) ? cfg.pixCreatedUrls : []),
        cfg.pixCreatedUrl,
        cfg.pixCreatedUrl2
    ]).length > 0;
    const hasConfirmed = normalizePushcutUrls([
        ...(Array.isArray(cfg.pixConfirmedUrls) ? cfg.pixConfirmedUrls : []),
        cfg.pixConfirmedUrl,
        cfg.pixConfirmedUrl2
    ]).length > 0;
    if (!hasCreated && !hasConfirmed) {
        res.status(400).json({ ok: false, error: 'Configure ao menos uma URL de Pushcut.' });
        return;
    }

    const txid = `pushcut-test-${Date.now()}`;
    const basePayload = {
        txid,
        orderId: `order-${Date.now()}`,
        amount: 56.1,
        name: 'Lead Teste',
        customerName: 'Lead Teste',
        customerEmail: 'lead.teste@ifoodbag.app',
        cep: '08717630',
        shippingName: 'Envio Padrao iFood',
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

    const settingsData = await getSettings().catch(() => ({}));
    const payments = buildPaymentsConfig(settingsData?.payments || {});
    const maxTx = clamp(req.query?.maxTx || 50000, 1, 200000);
    const concurrency = clamp(req.query?.concurrency || 6, 1, 12);
    const pageSize = clamp(req.query?.pageSize || 500, 50, 1000);
    const includeConfirmed = String(req.query?.includeConfirmed || '1') !== '0';
    const txidList = await listLeadTxidsForReconcile({ maxTx, pageSize, includeConfirmed });
    if (!txidList.ok) {
        res.status(502).json({
            error: 'Falha ao buscar txids no banco.',
            detail: txidList.detail || ''
        });
        return;
    }
    const candidates = txidList.entries || [];

    let checked = 0;
    let confirmed = 0;
    let pending = 0;
    let failed = 0;
    let updated = 0;
    const failedDetails = [];
    let blockedByAtivus = 0;
    const gatewaySummary = {
        ativushub: { checked: 0, confirmed: 0, pending: 0, failed: 0 },
        ghostspay: { checked: 0, confirmed: 0, pending: 0, failed: 0 },
        sunize: { checked: 0, confirmed: 0, pending: 0, failed: 0 }
    };

    const runOne = async ({ txid, gateway: rowGateway, sessionId: sessionHint }) => {
        const gateway = rowGateway === 'ghostspay'
            ? 'ghostspay'
            : rowGateway === 'sunize'
                ? 'sunize'
                : 'ativushub';
        checked += 1;
        gatewaySummary[gateway].checked += 1;
        try {
            let response;
            let data;
            let status = '';
            let utmifyStatus = 'waiting_payment';
            let isPaid = false;
            let isRefunded = false;
            let isRefused = false;
            let isPending = false;
            let changedAt = new Date().toISOString();
            let sessionIdFallback = sessionHint || '';
            let amount = 0;
            let fee = 0;
            let commission = 0;

            if (gateway === 'ghostspay') {
                ({ response, data } = await requestGhostspayStatus(payments?.gateways?.ghostspay || {}, txid));
                if (!response?.ok) {
                    failed += 1;
                    gatewaySummary[gateway].failed += 1;
                    if (failedDetails.length < 8) {
                        failedDetails.push({
                            txid,
                            gateway,
                            status: response?.status || 0,
                            detail: data?.error || data?.message || ''
                        });
                    }
                    return;
                }

                status = getGhostspayStatus(data);
                utmifyStatus = mapGhostspayStatusToUtmify(status);
                isPaid = isGhostspayPaidStatus(status);
                isRefunded = isGhostspayRefundedStatus(status);
                isRefused = isGhostspayRefusedStatus(status) || isGhostspayChargebackStatus(status);
                isPending = isGhostspayPendingStatus(status);
                changedAt =
                    toIsoDate(getGhostspayUpdatedAt(data)) ||
                    toIsoDate(data?.paidAt) ||
                    toIsoDate(data?.data?.paidAt) ||
                    new Date().toISOString();
                sessionIdFallback = String(
                    data?.metadata?.orderId ||
                    data?.data?.metadata?.orderId ||
                    data?.externalreference ||
                    data?.external_reference ||
                    sessionIdFallback ||
                    ''
                ).trim();
                amount = getGhostspayAmount(data);
                fee = normalizeAmountPossiblyCents(
                    data?.gatewayFee ||
                    data?.fee ||
                    data?.data?.gatewayFee ||
                    data?.data?.fee ||
                    0
                );
                commission = Math.max(0, Number((amount - fee).toFixed(2)));
            } else if (gateway === 'sunize') {
                ({ response, data } = await requestSunizeStatus(payments?.gateways?.sunize || {}, txid));
                if (!response?.ok) {
                    failed += 1;
                    gatewaySummary[gateway].failed += 1;
                    if (failedDetails.length < 8) {
                        failedDetails.push({
                            txid,
                            gateway,
                            status: response?.status || 0,
                            detail: data?.error || data?.message || ''
                        });
                    }
                    return;
                }

                status = getSunizeStatus(data);
                utmifyStatus = mapSunizeStatusToUtmify(status);
                isPaid = isSunizePaidStatus(status);
                isRefunded = isSunizeRefundedStatus(status);
                isRefused = isSunizeRefusedStatus(status);
                isPending = isSunizePendingStatus(status);
                changedAt =
                    toIsoDate(getSunizeUpdatedAt(data)) ||
                    toIsoDate(data?.paid_at) ||
                    toIsoDate(data?.paidAt) ||
                    new Date().toISOString();
                sessionIdFallback = String(
                    data?.external_id ||
                    data?.externalId ||
                    data?.metadata?.orderId ||
                    sessionIdFallback ||
                    ''
                ).trim();
                amount = getSunizeAmount(data);
                fee = 0;
                commission = amount;
            } else {
                ({ response, data } = await requestAtivushubStatus(payments?.gateways?.ativushub || {}, txid));
                if (!response?.ok) {
                    failed += 1;
                    gatewaySummary[gateway].failed += 1;
                    if (response?.status === 403) blockedByAtivus += 1;
                    if (failedDetails.length < 8) {
                        failedDetails.push({
                            txid,
                            gateway,
                            status: response?.status || 0,
                            detail: data?.error || data?.message || ''
                        });
                    }
                    return;
                }

                status = getAtivusStatus(data);
                utmifyStatus = mapAtivusStatusToUtmify(status);
                isPaid = isAtivusPaidStatus(status);
                isRefunded = isAtivusRefundedStatus(status);
                isRefused = isAtivusRefusedStatus(status);
                isPending = isAtivusPendingStatus(status);
                changedAt =
                    toIsoDate(data?.data_transacao) ||
                    toIsoDate(data?.data_registro) ||
                    new Date().toISOString();
                sessionIdFallback = String(
                    data?.externalreference ||
                    data?.external_reference ||
                    data?.metadata?.orderId ||
                    data?.orderId ||
                    sessionIdFallback ||
                    ''
                ).trim();
                amount = normalizeAmountPossiblyCents(
                    data?.amount ||
                    data?.valor_bruto ||
                    data?.valor_liquido ||
                    data?.data?.amount ||
                    0
                );
                fee = normalizeAmountPossiblyCents(data?.taxa_deposito || 0) +
                    normalizeAmountPossiblyCents(data?.taxa_adquirente || 0);
                commission = normalizeAmountPossiblyCents(data?.deposito_liquido || data?.valor_liquido || 0);
            }

            if (!(isPaid || isRefunded || isRefused || isPending)) {
                failed += 1;
                gatewaySummary[gateway].failed += 1;
                if (failedDetails.length < 8) {
                    failedDetails.push({ txid, gateway, status: 200, detail: `status:${status || 'unknown'}` });
                }
                return;
            }

            if (utmifyStatus === 'paid') {
                confirmed += 1;
                gatewaySummary[gateway].confirmed += 1;
            } else if (utmifyStatus === 'waiting_payment') {
                pending += 1;
                gatewaySummary[gateway].pending += 1;
            } else {
                failed += 1;
                gatewaySummary[gateway].failed += 1;
            }

            const lastEvent = isPaid ? 'pix_confirmed' : isRefunded ? 'pix_refunded' : isRefused ? 'pix_refused' : 'pix_pending';
            let lead = await getLeadByPixTxid(txid).catch(() => ({ ok: false, data: null }));
            let leadData = lead?.ok ? lead.data : null;
            if (!leadData && sessionIdFallback) {
                lead = await getLeadBySessionId(sessionIdFallback).catch(() => ({ ok: false, data: null }));
                leadData = lead?.ok ? lead.data : null;
            }
            const payloadPatch = mergeLeadPayload(leadData?.payload, {
                gateway,
                pixGateway: gateway,
                paymentGateway: gateway,
                pixTxid: txid,
                pixStatus: status || null,
                pixStatusChangedAt: changedAt,
                pixCreatedAt:
                    asObject(leadData?.payload).pixCreatedAt ||
                    toIsoDate(data?.data_registro) ||
                    toIsoDate(data?.created_at) ||
                    toIsoDate(data?.createdAt) ||
                    toIsoDate(data?.data?.created_at) ||
                    toIsoDate(data?.data?.createdAt) ||
                    leadData?.created_at ||
                    undefined,
                pixPaidAt: isPaid ? changedAt : undefined,
                pixRefundedAt: isRefunded ? changedAt : undefined,
                pixRefusedAt: isRefused ? changedAt : undefined
            });
            let up = await updateLeadByPixTxid(txid, {
                last_event: lastEvent,
                stage: 'pix',
                payload: payloadPatch
            }).catch(() => ({ ok: false, count: 0 }));
            if ((!up?.ok || Number(up?.count || 0) === 0) && sessionIdFallback) {
                const bySessionLead = leadData || (await getLeadBySessionId(sessionIdFallback).catch(() => ({ ok: false, data: null })))?.data;
                const bySessionPayload = mergeLeadPayload(bySessionLead?.payload, payloadPatch);
                const bySession = await updateLeadBySessionId(sessionIdFallback, {
                    last_event: lastEvent,
                    stage: 'pix',
                    payload: bySessionPayload
                }).catch(() => ({ ok: false, count: 0 }));
                if (bySession?.ok) up = bySession;
            }

            lead = await getLeadByPixTxid(txid).catch(() => ({ ok: false, data: null }));
            leadData = lead?.ok ? lead.data : null;
            if (!leadData && sessionIdFallback) {
                lead = await getLeadBySessionId(sessionIdFallback).catch(() => ({ ok: false, data: null }));
                leadData = lead?.ok ? lead.data : null;
            }
            const leadUtm = leadData?.payload?.utm || {};
            const isUpsell = Boolean(
                leadData?.payload?.upsell?.enabled === true ||
                String(leadData?.shipping_id || '').trim().toLowerCase() === 'expresso_1dia' ||
                /adiantamento|prioridade|expresso/i.test(String(leadData?.shipping_name || ''))
            );
            const changedRows = up?.ok ? Number(up?.count || 0) : 0;
            if (changedRows <= 0) return;

            updated += changedRows;

            const utmPayload = {
                event: 'pix_status',
                orderId: txid || leadData?.session_id || sessionIdFallback || '',
                txid,
                gateway,
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
                upsell: isUpsell ? {
                    enabled: true,
                    kind: leadData?.payload?.upsell?.kind || 'frete_1dia',
                    title: leadData?.payload?.upsell?.title || leadData?.shipping_name || 'Prioridade de envio',
                    price: Number(leadData?.payload?.upsell?.price || leadData?.shipping_price || amount || 0)
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
                createdAt: leadData?.payload?.pixCreatedAt || leadData?.created_at,
                approvedDate: isPaid ? (leadData?.payload?.pixPaidAt || changedAt || null) : null,
                refundedAt: isRefunded ? (leadData?.payload?.pixRefundedAt || changedAt || null) : null,
                gatewayFeeInCents: Math.round(Number(fee || 0) * 100),
                userCommissionInCents: Math.round(Number(commission || 0) * 100),
                totalPriceInCents: Math.round(Number(amount || 0) * 100)
            };

            const utmEventName = isUpsell && isPaid ? 'upsell_pix_confirmed' : 'pix_status';
            const utmImmediate = await sendUtmfy(utmEventName, utmPayload).catch(() => ({ ok: false }));
            if (!utmImmediate?.ok) {
                await enqueueDispatch({
                    channel: 'utmfy',
                    eventName: utmEventName,
                    dedupeKey: `utmfy:status:${gateway}:${txid}:${isUpsell ? 'upsell' : 'base'}:${utmifyStatus}`,
                    payload: utmPayload
                }).catch(() => null);
                await processDispatchQueue(8).catch(() => null);
            }

            if (!isPaid) return;

            const pushKind = isUpsell ? 'upsell_pix_confirmed' : 'pix_confirmed';
            await enqueueDispatch({
                channel: 'pushcut',
                kind: pushKind,
                dedupeKey: `pushcut:pix_confirmed:${gateway}:${txid}`,
                payload: {
                    txid,
                    orderId: txid || leadData?.session_id || sessionIdFallback || '',
                    gateway,
                    status,
                    amount,
                    customerName: leadData?.name || '',
                    customerEmail: leadData?.email || '',
                    cep: leadData?.cep || '',
                    shippingName: leadData?.shipping_name || '',
                    isUpsell
                }
            }).catch(() => null);
            await processDispatchQueue(8).catch(() => null);

            const forwarded = req?.headers?.['x-forwarded-for'];
            const clientIp = typeof forwarded === 'string' && forwarded
                ? forwarded.split(',')[0].trim()
                : req?.socket?.remoteAddress || '';
            const userAgent = req?.headers?.['user-agent'] || '';
            const leadPayload = asObject(leadData?.payload);
            const fbclid = String(leadData?.fbclid || leadPayload?.fbclid || leadUtm?.fbclid || '').trim();
            const fbp = String(leadPayload?.fbp || '').trim();
            const fbc = String(leadPayload?.fbc || '').trim() || (fbclid ? `fb.1.${Date.now()}.${fbclid}` : '');
            await enqueueDispatch({
                channel: 'pixel',
                eventName: 'Purchase',
                dedupeKey: `pixel:purchase:${gateway}:${txid}`,
                payload: {
                    amount,
                    orderId: txid || leadData?.session_id || sessionIdFallback || '',
                    gateway,
                    shippingName: leadData?.shipping_name || '',
                    isUpsell,
                    client_email: leadData?.email || '',
                    client_document: leadData?.cpf || '',
                    client_ip: clientIp,
                    user_agent: userAgent,
                    source_url: leadData?.source_url || leadPayload?.sourceUrl || '',
                    fbclid,
                    fbp,
                    fbc
                }
            }).catch(() => null);
            await processDispatchQueue(8).catch(() => null);
        } catch (_error) {
            failed += 1;
            gatewaySummary[gateway].failed += 1;
            if (failedDetails.length < 8) {
                failedDetails.push({ txid, gateway, status: 0, detail: 'request_error' });
            }
        }
    };

    for (let i = 0; i < candidates.length; i += concurrency) {
        const chunk = candidates.slice(i, i + concurrency);
        await Promise.all(chunk.map((entry) => runOne(entry)));
    }

    res.status(200).json({
        ok: true,
        source: 'multi_gateway',
        scannedRows: Number(txidList.scannedRows || 0),
        candidates: candidates.length,
        checked,
        confirmed,
        pending,
        failed,
        blockedByAtivus,
        warning: blockedByAtivus > 0
            ? 'A consulta de status na Ativus foi bloqueada (403). Habilite este endpoint no suporte Ativus para reconciliacao retroativa.'
            : null,
        includeConfirmed,
        updated,
        gatewaySummary,
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
        case 'backredirects':
            return getBackredirects(req, res);
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
