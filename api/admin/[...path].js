const XLSX = require('xlsx');
const { ensureAllowedRequest } = require('../../lib/request-guard');
const { verifyAdminPassword, issueAdminCookie, verifyAdminCookie, requireAdmin } = require('../../lib/admin-auth');
const { getSettings, getSettingsState, saveSettings, defaultSettings } = require('../../lib/settings-store');
const { invalidatePaymentsConfigCache } = require('../../lib/payments-config-store');
const {
    buildPaymentsConfig,
    mergePaymentSettings,
    resolveGatewayFromPayload
} = require('../../lib/payment-gateway-config');
const { sendUtmfy } = require('../../lib/utmfy');
const { updateLeadByPixTxid, getLeadByPixTxid, updateLeadBySessionId, getLeadBySessionId } = require('../../lib/lead-store');
const { sendPushcut } = require('../../lib/pushcut');
const {
    requestCreateTransaction: requestGhostspayCreate,
    requestTransactionById: requestGhostspayStatus
} = require('../../lib/ghostspay-provider');
const {
    requestCreateTransaction: requestSunizeCreate,
    requestTransactionById: requestSunizeStatus
} = require('../../lib/sunize-provider');
const {
    requestCreateTransaction: requestParadiseCreate,
    requestTransactionById: requestParadiseStatus
} = require('../../lib/paradise-provider');
const {
    requestCreateTransaction: requestAtomopayCreate,
    requestTransactionById: requestAtomopayStatus
} = require('../../lib/atomopay-provider');
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
const {
    getParadiseStatus,
    getParadiseUpdatedAt,
    getParadiseExternalId,
    getParadiseAmount,
    isParadisePaidStatus,
    isParadisePendingStatus,
    isParadiseRefundedStatus,
    isParadiseChargebackStatus,
    isParadiseRefusedStatus,
    mapParadiseStatusToUtmify
} = require('../../lib/paradise-status');
const {
    describeAtomopayPayload,
    getAtomopayStatus,
    getAtomopayUpdatedAt,
    getAtomopayAmount,
    getAtomopayTracking,
    resolveAtomopayPixPayload,
    isAtomopayPaidStatus,
    isAtomopayPendingStatus,
    isAtomopayRefundedStatus,
    isAtomopayRefusedStatus,
    isAtomopayChargebackStatus,
    mapAtomopayStatusToUtmify
} = require('../../lib/atomopay-status');
const { enqueueDispatch, processDispatchQueue } = require('../../lib/dispatch-queue');
const {
    getIpBlacklist,
    addBlockedIp,
    removeBlockedIp,
    findBlockedIp,
    normalizeClientIp
} = require('../../lib/ip-blacklist');

const fetchFn = global.fetch
    ? global.fetch.bind(global)
    : (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.SUPABASE_PROJECT_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || '';

const pick = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');
const clamp = (value, min, max) => Math.min(Math.max(Number(value) || 0, min), max);
const SECRET_MASK = '__SECRET_SET__';
const SIMPLE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REWARD_LABELS = {
    bag: 'Bag do iFood',
    bau: 'Bau do iFood',
    kit_entregador: 'Kit Entregador iFood'
};
const FUNNEL_OVERVIEW_STAGES = [
    {
        key: 'home',
        label: 'Home',
        shortLabel: 'Home',
        source: 'page',
        page: 'home',
        description: 'Entrada no funil'
    },
    {
        key: 'quiz',
        label: 'Quiz',
        shortLabel: 'Quiz',
        source: 'page',
        page: 'quiz',
        description: 'Perguntas iniciais'
    },
    {
        key: 'personal',
        label: 'Dados pessoais',
        shortLabel: 'Dados',
        source: 'page',
        page: 'personal',
        description: 'Preenchimento dos dados'
    },
    {
        key: 'cep',
        label: 'Endereco',
        shortLabel: 'Endereco',
        source: 'page',
        page: 'cep',
        description: 'Confirmacao de CEP'
    },
    {
        key: 'checkout',
        label: 'Checkout',
        shortLabel: 'Checkout',
        source: 'page',
        page: 'checkout',
        description: 'Visita ao checkout'
    },
    {
        key: 'frete_selected',
        label: 'Frete selecionado',
        shortLabel: 'Frete',
        source: 'summary',
        field: 'frete',
        description: 'Frete escolhido no checkout'
    },
    {
        key: 'orderbump',
        label: 'Order bump',
        shortLabel: 'Order bump',
        source: 'page',
        page: 'orderbump',
        description: 'Oferta adicional exibida'
    },
    {
        key: 'pix',
        label: 'PIX visualizado',
        shortLabel: 'PIX view',
        source: 'page',
        page: 'pix',
        description: 'Tela de pagamento aberta'
    },
    {
        key: 'pix_generated',
        label: 'PIX gerado',
        shortLabel: 'PIX gerado',
        source: 'summary',
        field: 'pix',
        description: 'Transacao PIX criada'
    },
    {
        key: 'pix_paid',
        label: 'PIX pago',
        shortLabel: 'PIX pago',
        source: 'summary',
        field: 'paid',
        description: 'Pagamento confirmado'
    },
    {
        key: 'upsell_iof',
        label: 'Upsell IOF',
        shortLabel: 'Upsell IOF',
        source: 'page',
        page: 'upsell-iof',
        description: 'Primeira oferta de upsell'
    },
    {
        key: 'upsell_correios',
        label: 'Upsell Correios',
        shortLabel: 'Upsell Correios',
        source: 'page',
        page: 'upsell-correios',
        description: 'Segunda oferta de upsell'
    },
    {
        key: 'upsell',
        label: 'Upsell final',
        shortLabel: 'Upsell final',
        source: 'page',
        page: 'upsell',
        description: 'Terceira oferta de upsell'
    }
];
const LEADS_SELECT_FIELDS = [
    'session_id',
    'name',
    'cpf',
    'email',
    'phone',
    'stage',
    'last_event',
    'cep',
    'address_line',
    'number',
    'complement',
    'neighborhood',
    'city',
    'state',
    'reference',
    'shipping_id',
    'shipping_name',
    'shipping_price',
    'bump_selected',
    'bump_price',
    'pix_txid',
    'pix_amount',
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
    'gclid',
    'fbclid',
    'ttclid',
    'referrer',
    'landing_page',
    'source_url',
    'user_agent',
    'client_ip',
    'payload',
    'updated_at',
    'created_at'
].join(',');
const SALES_INSIGHTS_SELECT_FIELDS = [
    'last_event',
    'city',
    'shipping_id',
    'shipping_name',
    'bump_selected',
    'bump_price',
    'utm_term',
    'pix_amount',
    'user_agent',
    'payload',
    'updated_at',
    'created_at'
].join(',');
const MAX_LEADS_EXPORT_ROWS = 200000;
const LEAD_EXPORT_SEGMENTS = {
    all: {
        key: 'all',
        label: 'Todos os leads',
        sheetName: 'Todos os leads',
        fileSlug: 'todos-os-leads'
    },
    front_unpaid: {
        key: 'front_unpaid',
        label: 'PIX do front gerado e nao pago',
        sheetName: 'Front nao pago',
        fileSlug: 'front-pix-nao-pago'
    },
    upsell_iof_unpaid: {
        key: 'upsell_iof_unpaid',
        label: 'Front pago + upsell IOF gerado e nao pago',
        sheetName: 'Upsell IOF',
        fileSlug: 'upsell-iof-nao-pago'
    },
    upsell_correios_unpaid: {
        key: 'upsell_correios_unpaid',
        label: 'Front + IOF pagos + upsell Correios gerado e nao pago',
        sheetName: 'Upsell Correios',
        fileSlug: 'upsell-correios-nao-pago'
    },
    upsell_final_unpaid: {
        key: 'upsell_final_unpaid',
        label: 'Front + IOF + Correios pagos + ultimo upsell gerado e nao pago',
        sheetName: 'Upsell final',
        fileSlug: 'upsell-final-nao-pago'
    }
};
const LEAD_EXPORT_COLUMNS = [
    { header: 'Sessao', width: 24 },
    { header: 'Nome', width: 28 },
    { header: 'Email', width: 30 },
    { header: 'CPF', width: 16 },
    { header: 'Telefone', width: 18 },
    { header: 'CEP', width: 12 },
    { header: 'Endereco', width: 32 },
    { header: 'Numero', width: 12 },
    { header: 'Complemento', width: 18 },
    { header: 'Bairro', width: 20 },
    { header: 'Cidade', width: 18 },
    { header: 'Estado', width: 12 },
    { header: 'Referencia', width: 20 },
    { header: 'Etapa atual', width: 18 },
    { header: 'Evento atual', width: 22 },
    { header: 'Status do funil', width: 24 },
    { header: 'Jornada atual', width: 22 },
    { header: 'Bucket atual', width: 34 },
    { header: 'Filtro exportado', width: 34 },
    { header: 'PIX gerado', width: 12 },
    { header: 'PIX pago', width: 12 },
    { header: 'PIX estornado', width: 14 },
    { header: 'Gateway', width: 16 },
    { header: 'TXID atual', width: 34 },
    { header: 'Status PIX atual', width: 22 },
    { header: 'Valor total atual', width: 16 },
    { header: 'Frete ID', width: 18 },
    { header: 'Frete selecionado', width: 28 },
    { header: 'Valor frete', width: 14 },
    { header: 'Seguro Bag', width: 12 },
    { header: 'Valor seguro', width: 14 },
    { header: 'Upsell ativo', width: 12 },
    { header: 'Upsell tipo', width: 24 },
    { header: 'Upsell titulo', width: 28 },
    { header: 'Upsell valor', width: 14 },
    { header: 'TXID anterior', width: 34 },
    { header: 'UTM Source', width: 18 },
    { header: 'UTM Medium', width: 18 },
    { header: 'UTM Campaign', width: 24 },
    { header: 'UTM Term', width: 20 },
    { header: 'UTM Content', width: 24 },
    { header: 'FBCLID', width: 26 },
    { header: 'GCLID', width: 26 },
    { header: 'TTCLID', width: 26 },
    { header: 'Referrer', width: 30 },
    { header: 'Landing page', width: 30 },
    { header: 'Source URL', width: 36 },
    { header: 'IP cliente', width: 18 },
    { header: 'User agent', width: 44 },
    { header: 'Horario evento', width: 22 },
    { header: 'Criado em', width: 22 },
    { header: 'Atualizado em', width: 22 },
    { header: 'Payload JSON', width: 64 }
];

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

function firstQueryValue(value) {
    if (Array.isArray(value)) return value[0];
    return value;
}

function parseRangeDateToIso(value, { endOfDay = false } = {}) {
    const raw = String(value || '').trim();
    if (!raw) return null;

    if (SIMPLE_DATE_RE.test(raw)) {
        const suffix = endOfDay ? 'T23:59:59.999Z' : 'T00:00:00.000Z';
        const date = new Date(`${raw}${suffix}`);
        if (Number.isNaN(date.getTime())) return null;
        return date.toISOString();
    }

    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return null;
    if (endOfDay) {
        date.setUTCHours(23, 59, 59, 999);
    } else {
        date.setUTCHours(0, 0, 0, 0);
    }
    return date.toISOString();
}

function parseLeadsDateRange(query = {}) {
    const rawFrom = firstQueryValue(pick(query.from, query.dateFrom, query.startDate));
    const rawTo = firstQueryValue(pick(query.to, query.dateTo, query.endDate));

    const fromIso = rawFrom ? parseRangeDateToIso(rawFrom, { endOfDay: false }) : null;
    const toIso = rawTo ? parseRangeDateToIso(rawTo, { endOfDay: true }) : null;

    if (rawFrom && !fromIso) {
        return { ok: false, error: 'Filtro de data "from" invalido.' };
    }
    if (rawTo && !toIso) {
        return { ok: false, error: 'Filtro de data "to" invalido.' };
    }
    if (fromIso && toIso && Date.parse(fromIso) > Date.parse(toIso)) {
        return { ok: false, error: 'Periodo invalido: "from" maior que "to".' };
    }

    return {
        ok: true,
        fromIso,
        toIso,
        hasRange: Boolean(fromIso || toIso)
    };
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
    const saoPauloNaiveMatch = str.match(
        /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/
    );
    if (saoPauloNaiveMatch) {
        const [, year, month, day, hour, minute, second, fraction = ''] = saoPauloNaiveMatch;
        const milliseconds = Number(String(fraction || '').padEnd(3, '0').slice(0, 3) || 0);
        const utcMs = Date.UTC(
            Number(year),
            Number(month) - 1,
            Number(day),
            Number(hour) + 3,
            Number(minute),
            Number(second),
            milliseconds
        );
        const d = new Date(utcMs);
        return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
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

function isRefundedFromStatus(status) {
    const s = normalizeStatusText(status);
    if (!s) return false;
    return s.includes('refund') || s.includes('estorno');
}

function isRefusedFromStatus(status) {
    const s = normalizeStatusText(status);
    if (!s) return false;
    return (
        s.includes('refus') ||
        s.includes('recus') ||
        s.includes('chargeback') ||
        s.includes('cancel') ||
        s.includes('expired') ||
        s.includes('expir') ||
        s.includes('failed')
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

function pickText(...values) {
    for (const value of values) {
        if (value === undefined || value === null) continue;
        const text = String(value).trim();
        if (text) return text;
    }
    return '';
}

function looksLikePixCopyPaste(value = '') {
    const text = String(value || '').trim();
    if (!text) return false;
    if (text.startsWith('000201') && text.length >= 30) return true;
    return /br\.gov\.bcb\.pix/i.test(text);
}

function resolveAdminClientIp(req) {
    return String(req?.headers?.['x-forwarded-for'] || '')
        .split(',')[0]
        .trim() || String(req?.socket?.remoteAddress || '').trim() || '127.0.0.1';
}

function normalizeGatewayTestSelection(input) {
    const list = Array.isArray(input) ? input : [input];
    const normalized = list
        .map((value) => String(value || '').trim().toLowerCase())
        .filter((value) => value === 'ghostspay' || value === 'sunize' || value === 'paradise' || value === 'atomopay');
    return Array.from(new Set(normalized));
}

function parseGatewayTestAmount(value) {
    const raw = String(value ?? '').trim().replace(',', '.');
    if (!raw) return null;
    const amount = Number(raw);
    if (!Number.isFinite(amount)) return null;
    if (amount < 1) return null;
    if (amount > 100000) return null;
    return Number(amount.toFixed(2));
}

function resolveGhostspayCreateResponse(data = {}) {
    const root = asObject(data);
    const nested = asObject(root.data);
    const transaction = asObject(root.transaction);
    const payment = asObject(root.payment);
    const pix = asObject(root.pix || nested.pix || transaction.pix || payment.pix);
    const txid = pickText(
        root.id,
        root.transactionId,
        root.transaction_id,
        root.txid,
        nested.id,
        nested.transactionId,
        nested.transaction_id,
        nested.txid,
        transaction.id,
        payment.id,
        pix.id,
        pix.txid
    );
    let paymentCode = pickText(
        pix.qrcodeText,
        pix.qrCodeText,
        pix.qrcode_text,
        pix.qr_code_text,
        pix.brCode,
        pix.br_code,
        pix.code,
        pix.copyPaste,
        pix.copy_paste,
        pix.emv,
        pix.payload,
        pix.pixCode,
        pix.pix_code,
        root.paymentCode,
        nested.paymentCode,
        transaction.qrcodeText,
        payment.qrcodeText,
        root.copyPaste,
        nested.copyPaste
    );
    let qrRaw = pickText(
        pix.qrcode,
        pix.qrCode,
        pix.qrcodeImage,
        pix.qrCodeImage,
        pix.qrcodeBase64,
        pix.qrCodeBase64,
        pix.qr_code_base64,
        pix.image,
        pix.imageBase64,
        pix.base64,
        root.qrcode,
        nested.qrcode,
        root.qrCode,
        nested.qrCode,
        root.qrcodeBase64,
        nested.qrcodeBase64,
        root.qrCodeBase64,
        nested.qrCodeBase64
    );
    const qrUrl = pickText(
        pix.qrcodeUrl,
        pix.qrCodeUrl,
        pix.qrcode_url,
        pix.qr_code_url,
        root.qrcodeUrl,
        nested.qrcodeUrl
    );
    if (!paymentCode && looksLikePixCopyPaste(qrRaw)) {
        paymentCode = qrRaw;
        qrRaw = '';
    }
    let paymentCodeBase64 = '';
    let paymentQrUrl = '';
    if (qrUrl) {
        paymentQrUrl = qrUrl;
    } else if (qrRaw) {
        if (/^https?:\/\//i.test(qrRaw) || qrRaw.startsWith('data:image')) {
            paymentQrUrl = qrRaw;
        } else {
            paymentCodeBase64 = qrRaw;
        }
    }
    const status = pickText(root.status, nested.status, transaction.status, payment.status);
    return {
        txid: String(txid || '').trim(),
        paymentCode: String(paymentCode || '').trim(),
        paymentCodeBase64: String(paymentCodeBase64 || '').trim(),
        paymentQrUrl: String(paymentQrUrl || '').trim(),
        status: String(status || '').trim()
    };
}

function resolveSunizeCreateResponse(data = {}) {
    const txid = String(
        data?.id ||
        data?.transaction_id ||
        data?.transactionId ||
        data?.data?.id ||
        ''
    ).trim();
    const paymentCode = String(
        data?.pix?.payload ||
        data?.pix?.copyPaste ||
        data?.pix?.copy_paste ||
        data?.pixPayload ||
        ''
    ).trim();
    const qrRaw = String(
        data?.pix?.qrcode ||
        data?.pix?.qrCode ||
        data?.pix?.qr_code ||
        data?.pix?.qrcodeBase64 ||
        data?.pix?.qrCodeBase64 ||
        data?.pix?.qr_code_base64 ||
        ''
    ).trim();
    const qrUrl = String(
        data?.pix?.qrcode_url ||
        data?.pix?.qrCodeUrl ||
        data?.pix?.qr_code_url ||
        ''
    ).trim();
    const externalId = String(data?.external_id || data?.externalId || '').trim();
    const status = getSunizeStatus(data);
    let paymentCodeBase64 = '';
    let paymentQrUrl = '';
    if (qrUrl) {
        paymentQrUrl = qrUrl;
    } else if (qrRaw) {
        if (/^https?:\/\//i.test(qrRaw) || qrRaw.startsWith('data:image')) {
            paymentQrUrl = qrRaw;
        } else {
            paymentCodeBase64 = qrRaw;
        }
    }
    return {
        txid,
        paymentCode,
        paymentCodeBase64,
        paymentQrUrl,
        status,
        externalId
    };
}

function resolveParadiseCreateResponse(data = {}) {
    const root = asObject(data);
    const nested = asObject(root.data);
    const txid = pickText(
        root.transaction_id,
        root.transactionId,
        nested.transaction_id,
        nested.transactionId,
        root.id,
        nested.id
    );
    const externalId = pickText(
        root.id,
        root.external_id,
        root.externalId,
        root.reference,
        nested.id,
        nested.external_id,
        nested.externalId,
        nested.reference
    );
    const paymentCode = pickText(
        root.qr_code,
        root.pix_code,
        nested.qr_code,
        nested.pix_code
    );
    const qrRaw = pickText(
        root.qr_code_base64,
        root.qrcode_base64,
        root.qrCodeBase64,
        nested.qr_code_base64,
        nested.qrcode_base64,
        nested.qrCodeBase64
    );
    let paymentCodeBase64 = '';
    let paymentQrUrl = '';
    if (qrRaw) {
        if (/^https?:\/\//i.test(qrRaw) || qrRaw.startsWith('data:image')) {
            paymentQrUrl = qrRaw;
        } else {
            paymentCodeBase64 = qrRaw;
        }
    }
    const status = pickText(root.status, nested.status, root.raw_status, nested.raw_status);
    return {
        txid: String(txid || '').trim(),
        paymentCode: String(paymentCode || '').trim(),
        paymentCodeBase64: String(paymentCodeBase64 || '').trim(),
        paymentQrUrl: String(paymentQrUrl || '').trim(),
        status: String(status || '').trim(),
        externalId: String(externalId || '').trim()
    };
}

function resolveAtomopayProductConfig(gatewayConfig = {}, shippingId = '') {
    const normalizedShippingId = String(shippingId || '').trim().toLowerCase();
    if (normalizedShippingId === 'taxa_iof_bag') {
        return {
            offerHash: String(gatewayConfig.iofOfferHash || gatewayConfig.offerHash || '').trim(),
            productHash: String(gatewayConfig.iofProductHash || gatewayConfig.productHash || '').trim(),
            variant: 'iof'
        };
    }
    if (normalizedShippingId === 'taxa_objeto_grande_correios') {
        return {
            offerHash: String(gatewayConfig.correiosOfferHash || gatewayConfig.offerHash || '').trim(),
            productHash: String(gatewayConfig.correiosProductHash || gatewayConfig.productHash || '').trim(),
            variant: 'correios'
        };
    }
    if (normalizedShippingId === 'expresso_1dia') {
        return {
            offerHash: String(gatewayConfig.expressoOfferHash || gatewayConfig.offerHash || '').trim(),
            productHash: String(gatewayConfig.expressoProductHash || gatewayConfig.productHash || '').trim(),
            variant: 'expresso'
        };
    }
    return {
        offerHash: String(gatewayConfig.offerHash || '').trim(),
        productHash: String(gatewayConfig.productHash || '').trim(),
        variant: 'base'
    };
}

function resolveAtomopayCreateResponse(data = {}) {
    const resolved = resolveAtomopayPixPayload(data);
    return {
        txid: String(resolved.txid || '').trim(),
        paymentCode: String(resolved.paymentCode || '').trim(),
        paymentCodeBase64: String(resolved.paymentCodeBase64 || '').trim(),
        paymentQrUrl: String(resolved.paymentQrUrl || '').trim(),
        status: String(resolved.status || '').trim(),
        externalId: ''
    };
}

async function hydrateAtomopayCreateResponse(gatewayConfig = {}, txid = '', attempts = 4) {
    const cleanTxid = String(txid || '').trim();
    if (!cleanTxid) {
        return {
            txid: '',
            paymentCode: '',
            paymentCodeBase64: '',
            paymentQrUrl: '',
            status: '',
            externalId: '',
            debug: {
                attempts: []
            }
        };
    }

    let latest = {
        txid: cleanTxid,
        paymentCode: '',
        paymentCodeBase64: '',
        paymentQrUrl: '',
        status: '',
        externalId: '',
        debug: {
            attempts: []
        }
    };
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const quickStatus = await requestAtomopayStatus({
            ...gatewayConfig,
            timeoutMs: Math.max(1200, Math.min(Number(gatewayConfig.timeoutMs || 12000), attempt === 0 ? 3500 : 5000))
        }, cleanTxid).catch(() => ({ response: { ok: false }, data: {} }));
        const debugAttempt = {
            attempt: attempt + 1,
            statusCode: Number(quickStatus?.response?.status || 0),
            ok: quickStatus?.response?.ok === true,
            shape: describeAtomopayPayload(quickStatus?.data || {})
        };
        latest.debug.attempts.push(debugAttempt);
        if (quickStatus?.response?.ok) {
            latest = {
                ...resolveAtomopayCreateResponse(quickStatus.data || {}),
                debug: latest.debug
            };
            if (latest.paymentCode || latest.paymentCodeBase64 || latest.paymentQrUrl) {
                return latest;
            }
        }
        if (attempt < (attempts - 1)) {
            await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
        }
    }
    return latest;
}

function pickSecretInput(inputValue, existingValue) {
    const current = String(existingValue || '');
    if (inputValue === undefined || inputValue === null) return current;
    const raw = String(inputValue);
    if (raw === SECRET_MASK) return current;
    return raw;
}

function maskSecret(value) {
    const text = String(value || '').trim();
    return text ? SECRET_MASK : '';
}

function sanitizeSettingsForAdmin(settingsData = {}) {
    const source = settingsData && typeof settingsData === 'object' ? settingsData : {};
    const payload = JSON.parse(JSON.stringify(source));
    const safePixel = payload.pixel && typeof payload.pixel === 'object' ? payload.pixel : {};
    const safeTikTokPixel = payload.tiktokPixel && typeof payload.tiktokPixel === 'object' ? payload.tiktokPixel : {};
    payload.pixel = {
        enabled: !!safePixel.enabled,
        id: String(safePixel.id || '').trim(),
        backupId: String(safePixel.backupId || '').trim(),
        capi: {
            enabled: !!safePixel?.capi?.enabled,
            accessToken: maskSecret(safePixel?.capi?.accessToken),
            backupAccessToken: maskSecret(safePixel?.capi?.backupAccessToken),
            testEventCode: String(safePixel?.capi?.testEventCode || '').trim(),
            backupTestEventCode: String(safePixel?.capi?.backupTestEventCode || '').trim()
        },
        events: {
            ...defaultSettings.pixel.events,
            ...asObject(safePixel.events)
        }
    };
    payload.tiktokPixel = {
        enabled: !!safeTikTokPixel.enabled,
        id: String(safeTikTokPixel.id || '').trim(),
        events: {
            ...defaultSettings.tiktokPixel.events,
            ...asObject(safeTikTokPixel.events)
        }
    };
    payload.utmfy = payload.utmfy || {};
    payload.payments = payload.payments || {};
    payload.payments.gateways = payload.payments.gateways || {};
    payload.payments.gateways.ghostspay = payload.payments.gateways.ghostspay || {};
    payload.payments.gateways.sunize = payload.payments.gateways.sunize || {};
    payload.payments.gateways.paradise = payload.payments.gateways.paradise || {};
    payload.payments.gateways.atomopay = payload.payments.gateways.atomopay || {};

    payload.utmfy.apiKey = maskSecret(payload.utmfy.apiKey);

    payload.payments.gateways.ghostspay.secretKey = maskSecret(payload.payments.gateways.ghostspay.secretKey);
    payload.payments.gateways.ghostspay.basicAuthBase64 = '';
    payload.payments.gateways.ghostspay.webhookToken = maskSecret(payload.payments.gateways.ghostspay.webhookToken);
    payload.payments.gateways.sunize.apiKey = maskSecret(payload.payments.gateways.sunize.apiKey);
    payload.payments.gateways.sunize.apiSecret = maskSecret(payload.payments.gateways.sunize.apiSecret);
    payload.payments.gateways.paradise.apiKey = maskSecret(payload.payments.gateways.paradise.apiKey);
    payload.payments.gateways.paradise.productHash = maskSecret(payload.payments.gateways.paradise.productHash);
    payload.payments.gateways.atomopay.apiToken = maskSecret(payload.payments.gateways.atomopay.apiToken);
    payload.payments.gateways.atomopay.offerHash = maskSecret(payload.payments.gateways.atomopay.offerHash);
    payload.payments.gateways.atomopay.productHash = maskSecret(payload.payments.gateways.atomopay.productHash);
    payload.payments.gateways.atomopay.iofOfferHash = maskSecret(payload.payments.gateways.atomopay.iofOfferHash);
    payload.payments.gateways.atomopay.iofProductHash = maskSecret(payload.payments.gateways.atomopay.iofProductHash);
    payload.payments.gateways.atomopay.correiosOfferHash = maskSecret(payload.payments.gateways.atomopay.correiosOfferHash);
    payload.payments.gateways.atomopay.correiosProductHash = maskSecret(payload.payments.gateways.atomopay.correiosProductHash);
    payload.payments.gateways.atomopay.expressoOfferHash = maskSecret(payload.payments.gateways.atomopay.expressoOfferHash);
    payload.payments.gateways.atomopay.expressoProductHash = maskSecret(payload.payments.gateways.atomopay.expressoProductHash);
    payload.payments.gateways.atomopay.webhookToken = maskSecret(payload.payments.gateways.atomopay.webhookToken);

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
    if (eventName === 'pix_refused') {
        return (
            toIsoDate(payload.pixRefusedAt) ||
            toIsoDate(payload.pixStatusChangedAt) ||
            toIsoDate(payload.data_transacao) ||
            toIsoDate(payload.data_registro) ||
            toIsoDate(row?.updated_at)
        );
    }
    if (eventName === 'pix_pending') {
        return (
            toIsoDate(payload.pixCreatedAt) ||
            toIsoDate(payload.createdAt) ||
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
    }, '');
}

function gatewayLabel(gateway) {
    if (gateway === 'atomopay') return 'AtomoPay';
    if (gateway === 'paradise') return 'Paradise';
    if (gateway === 'sunize') return 'Sunize';
    if (gateway === 'ghostspay') return 'GhostsPay';
    return gateway === 'ativushub' ? 'AtivusHUB (legado)' : 'Gateway legado';
}

function gatewayConversionPercent(stats = {}) {
    const pix = Number(stats?.pix || 0);
    const paid = Number(stats?.paid || 0);
    if (!pix) return 0;
    return Math.round((paid / pix) * 100);
}

function normalizeFunnelPage(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '');
}

function oneDecimalPercent(numerator, denominator) {
    const num = Number(numerator || 0);
    const den = Number(denominator || 0);
    if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) {
        return 0;
    }
    return Math.round((num / den) * 1000) / 10;
}

async function fetchPageviewCountsMap(range = {}) {
    const map = new Map();
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return map;

    const fromIso = range?.fromIso || null;
    const toIso = range?.toIso || null;
    const hasRange = Boolean(fromIso || toIso);

    if (!hasRange) {
        const response = await fetchFn(`${SUPABASE_URL}/rest/v1/pageview_counts?select=page,total`, {
            headers: {
                apikey: SUPABASE_SERVICE_KEY,
                Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
                'Content-Type': 'application/json'
            }
        }).catch(() => null);

        if (!response?.ok) {
            return map;
        }

        const rows = await response.json().catch(() => []);
        if (!Array.isArray(rows)) return map;

        rows.forEach((row) => {
            const key = normalizeFunnelPage(row?.page);
            if (!key) return;
            const total = Number(row?.total || 0);
            map.set(key, Number.isFinite(total) && total > 0 ? Math.round(total) : 0);
        });

        return map;
    }

    let offset = 0;
    const pageSize = 5000;

    while (true) {
        const url = new URL(`${SUPABASE_URL}/rest/v1/lead_pageviews`);
        url.searchParams.set('select', 'page');
        url.searchParams.set('order', 'created_at.desc');
        url.searchParams.set('limit', String(pageSize));
        url.searchParams.set('offset', String(offset));
        if (fromIso) url.searchParams.append('created_at', `gte.${fromIso}`);
        if (toIso) url.searchParams.append('created_at', `lte.${toIso}`);

        const response = await fetchFn(url.toString(), {
            headers: {
                apikey: SUPABASE_SERVICE_KEY,
                Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
                'Content-Type': 'application/json'
            }
        }).catch(() => null);

        if (!response?.ok) break;
        const rows = await response.json().catch(() => []);
        if (!Array.isArray(rows) || rows.length === 0) break;

        rows.forEach((row) => {
            const key = normalizeFunnelPage(row?.page);
            if (!key) return;
            map.set(key, Number(map.get(key) || 0) + 1);
        });

        if (rows.length < pageSize) break;
        offset += rows.length;
    }

    return map;
}

function buildNativeFunnel(summary = {}, pageCounts = new Map()) {
    const stagesWithRaw = FUNNEL_OVERVIEW_STAGES.map((stage) => {
        const raw = stage.source === 'page'
            ? Number(pageCounts.get(normalizeFunnelPage(stage.page || stage.key)) || 0)
            : Number(summary?.[stage.field] || 0);
        const countRaw = Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 0;
        return { ...stage, countRaw };
    });

    const firstRaw = Number(stagesWithRaw[0]?.countRaw || 0);
    const fallbackBase = Number(summary?.total || 0);
    const largestRaw = stagesWithRaw.reduce((max, stage) => Math.max(max, Number(stage.countRaw || 0)), 0);
    const base = firstRaw > 0 ? firstRaw : (fallbackBase > 0 ? Math.round(fallbackBase) : largestRaw);

    let prevEffective = base;
    const stages = stagesWithRaw.map((stage, index) => {
        const countRaw = Number(stage.countRaw || 0);
        const countEffective = index === 0 ? countRaw : Math.min(countRaw, prevEffective);
        const directEntries = index === 0 ? 0 : Math.max(0, countRaw - prevEffective);
        const dropCount = index === 0 ? 0 : Math.max(0, prevEffective - countEffective);
        const pctFromBase = oneDecimalPercent(countEffective, base);
        const pctFromPrev = index === 0 ? pctFromBase : oneDecimalPercent(countEffective, prevEffective);
        const dropPct = index === 0 ? 0 : oneDecimalPercent(dropCount, prevEffective);

        prevEffective = countEffective;

        return {
            key: stage.key,
            label: stage.label,
            shortLabel: stage.shortLabel || stage.label,
            description: stage.description || '',
            source: stage.source,
            page: stage.page || null,
            field: stage.field || null,
            countRaw,
            countEffective,
            directEntries,
            pctFromBase,
            pctFromPrev,
            dropCount,
            dropPct
        };
    });

    return {
        base: Number(base || 0),
        totalLeads: Number(summary?.total || 0),
        generatedAt: new Date().toISOString(),
        stages
    };
}

function resolveTrackingText(...values) {
    for (const raw of values) {
        const value = String(raw || '').trim();
        if (value) return value;
    }
    return '-';
}

function decodeTrackingValue(value = '') {
    const raw = String(value || '').trim();
    if (!raw || raw === '-') return '-';
    try {
        return decodeURIComponent(raw).replace(/\+/g, ' ').trim() || '-';
    } catch (_error) {
        return raw;
    }
}

function sanitizeCampaignName(value = '') {
    let text = decodeTrackingValue(value);
    if (!text || text === '-') return '-';

    text = text
        .replace(/^\s*\d{6,}\s*[:|>\-_/]+\s*/i, '')
        .replace(/^\s*(?:campaignid|campanhaid|id)\s*[:#-]?\s*\d{5,}\s*[-:|]\s*/i, '')
        .replace(/\s*[\(\[\{]\s*(?:id[:\s-]*)?\d{5,}\s*[\)\]\}]\s*$/i, '')
        .replace(/\s*(?:\||-|\/|:)\s*(?:id[:\s-]*)?\d{5,}\s*$/i, '')
        .replace(/\s*__\s*(?:id[:\s-]*)?\d{5,}\s*$/i, '')
        .replace(/\s{2,}/g, ' ')
        .trim();

    if (!text || /^\d{5,}$/.test(text)) return '-';
    return text;
}

function sanitizeAdsetName(value = '') {
    let text = prettifyTrafficLabel(value);
    if (!text || text === '-') return '-';

    text = text
        .replace(/^\s*\d{6,}\s*[:|>\-_/]+\s*/i, '')
        .replace(/^\s*(?:adsetid|adset_id|conjuntoid|conjunto_id|id)\s*[:#-]?\s*\d{5,}\s*[-:|]\s*/i, '')
        .replace(/\s*[\(\[\{]\s*(?:id[:\s-]*)?\d{5,}\s*[\)\]\}]\s*$/i, '')
        .replace(/\s*(?:\||-|\/|:)\s*(?:id[:\s-]*)?\d{5,}\s*$/i, '')
        .replace(/\s*__\s*(?:id[:\s-]*)?\d{5,}\s*$/i, '')
        .replace(/\s{2,}/g, ' ')
        .trim();

    if (!text || /^\d{5,}$/.test(text)) return '-';
    return text;
}

function prettifyTrafficLabel(value = '') {
    const text = decodeTrackingValue(value);
    if (!text || text === '-') return '-';
    return text
        .replace(/[_|]+/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function mapLeadReadable(row) {
    const payload = asObject(row?.payload);
    const payloadUtm = asObject(payload?.utm);
    const gateway = resolveLeadGateway(row, payload);
    const isPaid = isLeadPaid(row, payload);
    const isRefunded = isLeadRefunded(row, payload);
    const isRefused = isLeadRefused(row, payload);
    const isUpsell = Boolean(
        payload?.upsell?.enabled === true ||
        String(row?.shipping_id || '').trim().toLowerCase() === 'expresso_1dia' ||
        /adiantamento|prioridade|expresso/i.test(String(row?.shipping_name || ''))
    );
    const statusFunil = isPaid
        ? (isUpsell ? 'upsell_pagamento_confirmado' : 'pagamento_confirmado')
        : isRefunded
            ? 'pix_estornado'
            : isRefused
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
    const utmSource = resolveTrackingText(
        row?.utm_source,
        payloadUtm?.utm_source,
        payload?.utm_source,
        payloadUtm?.src,
        payload?.src
    );
    const utmCampaign = resolveTrackingText(
        row?.utm_campaign,
        payloadUtm?.utm_campaign,
        payload?.utm_campaign,
        payloadUtm?.campaign,
        payload?.campaign,
        payloadUtm?.sck
    );
    const utmTerm = resolveTrackingText(
        row?.utm_term,
        payloadUtm?.utm_term,
        payload?.utm_term,
        payloadUtm?.term,
        payload?.term
    );
    const utmAdset = resolveTrackingText(
        row?.utm_content,
        payloadUtm?.utm_content,
        payload?.utm_content,
        payloadUtm?.content,
        payload?.content,
        payloadUtm?.utm_adset,
        payload?.utm_adset,
        payloadUtm?.adset,
        payload?.adset,
        payloadUtm?.adset_name,
        payload?.adset_name
    );

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
        utm_source: utmSource,
        utm_source_label: prettifyTrafficLabel(utmSource),
        utm_campaign: utmCampaign,
        utm_campaign_name: sanitizeCampaignName(utmCampaign),
        utm_term: utmTerm,
        utm_term_label: prettifyTrafficLabel(utmTerm),
        utm_adset: utmAdset,
        utm_adset_label: sanitizeAdsetName(utmAdset),
        utm_adset_name: sanitizeAdsetName(utmAdset),
        fbclid: row?.fbclid || '-',
        gclid: row?.gclid || '-',
        status_funil: statusFunil,
        is_paid: isPaid,
        updated_at: row?.updated_at || null,
        created_at: row?.created_at || null,
        event_time: resolveEventTime(row, payload)
    };
}

function resolveLeadCurrentPixTxid(row, payload) {
    return String(
        row?.pix_txid ||
        payload?.pixTxid ||
        payload?.pix?.idTransaction ||
        payload?.pix?.idtransaction ||
        payload?.pix?.txid ||
        ''
    ).trim();
}

function resolveLeadPayloadPixTxid(payload) {
    return String(
        payload?.pixTxid ||
        payload?.pix?.idTransaction ||
        payload?.pix?.idtransaction ||
        payload?.pix?.txid ||
        ''
    ).trim();
}

function hasStaleRefusedPixState(row, payload) {
    const rowTxid = String(row?.pix_txid || '').trim();
    const payloadTxid = resolveLeadPayloadPixTxid(payload);
    if (!rowTxid || !payloadTxid || rowTxid === payloadTxid) return false;
    const lastEvent = String(row?.last_event || '').toLowerCase().trim();
    if (lastEvent === 'pix_refused') return true;
    if (toIsoDate(payload?.pixRefusedAt)) return true;
    return (
        isRefusedFromStatus(payload?.pixStatus) ||
        isRefusedFromStatus(payload?.pix?.status) ||
        isRefusedFromStatus(payload?.status) ||
        isRefusedFromStatus(payload?.status_transaction) ||
        isRefusedFromStatus(payload?.situacao)
    );
}

function resolveLeadCurrentPixStatus(row, payload) {
    return String(
        payload?.pixStatus ||
        payload?.pix?.status ||
        payload?.status ||
        payload?.status_transaction ||
        payload?.situacao ||
        row?.last_event ||
        ''
    ).trim();
}

function isLeadRefunded(row, payload) {
    if (String(row?.last_event || '').toLowerCase().trim() === 'pix_refunded') return true;
    if (toIsoDate(payload?.pixRefundedAt)) return true;
    if (toIsoDate(payload?.refundedAt)) return true;
    return (
        isRefundedFromStatus(payload?.pixStatus) ||
        isRefundedFromStatus(payload?.pix?.status) ||
        isRefundedFromStatus(payload?.status) ||
        isRefundedFromStatus(payload?.status_transaction) ||
        isRefundedFromStatus(payload?.situacao)
    );
}

function isLeadRefused(row, payload) {
    if (hasStaleRefusedPixState(row, payload)) return false;
    if (String(row?.last_event || '').toLowerCase().trim() === 'pix_refused') return true;
    if (toIsoDate(payload?.pixRefusedAt)) return true;
    return (
        isRefusedFromStatus(payload?.pixStatus) ||
        isRefusedFromStatus(payload?.pix?.status) ||
        isRefusedFromStatus(payload?.status) ||
        isRefusedFromStatus(payload?.status_transaction) ||
        isRefusedFromStatus(payload?.situacao)
    );
}

function normalizeLeadJourneyToken(value = '') {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function resolveLeadJourneyStep(row, payload) {
    const sourceStage = normalizeLeadJourneyToken(payload?.sourceStage || '');
    const rowStage = normalizeLeadJourneyToken(row?.stage || '');
    const payloadStage = normalizeLeadJourneyToken(payload?.stage || '');
    const page = normalizeLeadJourneyToken(payload?.page || '');
    const shippingId = normalizeLeadJourneyToken(
        row?.shipping_id ||
        payload?.shipping?.id ||
        payload?.shippingId ||
        ''
    );
    const shippingName = normalizeLeadJourneyToken(
        row?.shipping_name ||
        payload?.shipping?.name ||
        payload?.shippingName ||
        ''
    );
    const upsellKind = normalizeLeadJourneyToken(payload?.upsell?.kind || '');
    const upsellTitle = normalizeLeadJourneyToken(payload?.upsell?.title || '');
    const targetAfterPaid = normalizeLeadJourneyToken(payload?.upsell?.targetAfterPaid || '');
    const combined = [shippingId, shippingName, upsellKind, upsellTitle, targetAfterPaid].join('_');

    if (
        sourceStage === 'upsell_iof' ||
        rowStage === 'upsell_iof' ||
        payloadStage === 'upsell_iof' ||
        page === 'upsell_iof' ||
        combined.includes('iof')
    ) {
        return 'upsell_iof';
    }

    if (
        sourceStage === 'upsell_correios' ||
        rowStage === 'upsell_correios' ||
        payloadStage === 'upsell_correios' ||
        page === 'upsell_correios' ||
        /correios|objeto_grande/.test(combined)
    ) {
        return 'upsell_correios';
    }

    if (
        sourceStage === 'upsell' ||
        rowStage === 'upsell' ||
        payloadStage === 'upsell' ||
        page === 'upsell' ||
        shippingId === 'expresso_1dia' ||
        /adiantamento|prioridade|expresso|frete_1dia/.test(combined)
    ) {
        return 'upsell_final';
    }

    return 'front';
}

function leadJourneyLabel(step) {
    if (step === 'upsell_iof') return 'Upsell IOF';
    if (step === 'upsell_correios') return 'Upsell Correios';
    if (step === 'upsell_final') return 'Ultimo upsell';
    return 'Front';
}

function describeLeadPage(page = '') {
    const normalized = String(page || '').trim().toLowerCase();
    const stage = FUNNEL_OVERVIEW_STAGES.find((item) => item?.source === 'page' && item?.page === normalized);
    if (stage) {
        return {
            page: normalized,
            label: stage.label || normalized || '-',
            description: stage.description || 'Pagina registrada'
        };
    }

    return {
        page: normalized,
        label: normalized
            ? normalized
                .replace(/[_-]+/g, ' ')
                .replace(/\b\w/g, (char) => char.toUpperCase())
            : '-',
        description: 'Pagina registrada'
    };
}

function summarizeUserAgent(userAgent = '') {
    const ua = String(userAgent || '').toLowerCase();
    if (!ua) return '-';

    let browser = 'Navegador';
    if (ua.includes('edg/')) browser = 'Edge';
    else if (ua.includes('opr/') || ua.includes('opera')) browser = 'Opera';
    else if (ua.includes('chrome/') && !ua.includes('edg/')) browser = 'Chrome';
    else if (ua.includes('safari/') && !ua.includes('chrome/')) browser = 'Safari';
    else if (ua.includes('firefox/')) browser = 'Firefox';

    let os = 'SO desconhecido';
    if (ua.includes('windows')) os = 'Windows';
    else if (ua.includes('android')) os = 'Android';
    else if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ios')) os = 'iOS';
    else if (ua.includes('mac os x') || ua.includes('macintosh')) os = 'macOS';
    else if (ua.includes('linux')) os = 'Linux';

    let device = 'Desktop';
    if (ua.includes('tablet') || ua.includes('ipad')) device = 'Tablet';
    else if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) device = 'Mobile';

    return `${browser} · ${os} · ${device}`;
}

function normalizeSalesLabel(value = '', fallback = '-') {
    const text = String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!text || text === '-') return fallback;
    return text;
}

function normalizeCityLabel(row, payload = {}) {
    const payloadAddress = asObject(payload?.address);
    const cityLine = String(payloadAddress?.cityLine || '').trim();
    const cityFromLine = cityLine.includes('-') ? cityLine.split('-')[0]?.trim() : cityLine;
    const raw = normalizeSalesLabel(row?.city || payloadAddress?.city || cityFromLine || '', '');
    if (!raw) return '-';
    return raw
        .toLowerCase()
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

function resolveSalesDeviceLabel(userAgent = '', payload = {}) {
    const metadata = asObject(payload?.metadata);
    const ua = String(userAgent || metadata?.user_agent || '')
        .toLowerCase()
        .trim();
    if (!ua) return 'PC';
    if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ios')) return 'iPhone';
    if (ua.includes('android')) return 'Android';
    return 'PC';
}

function accumulateSalesBucket(map, key, label, { amount = 0, upsell = false, orderBump = false } = {}) {
    const safeKey = String(key || '').trim();
    if (!safeKey) return;
    const previous = map.get(safeKey) || {};
    const current = {
        key: safeKey,
        count: 0,
        amount: 0,
        upsellCount: 0,
        orderBumpCount: 0,
        ...previous,
        label: label || previous.label || safeKey
    };
    current.count += 1;
    current.amount = Number((Number(current.amount || 0) + Number(amount || 0)).toFixed(2));
    if (upsell) current.upsellCount += 1;
    if (orderBump) current.orderBumpCount += 1;
    map.set(safeKey, current);
}

function pickSalesMetricLeader(rows, field) {
    return rows.reduce((best, row) => {
        if (!best) return row;
        const rowValue = Number(row?.[field] || 0);
        const bestValue = Number(best?.[field] || 0);
        if (rowValue !== bestValue) return rowValue > bestValue ? row : best;
        if (Number(row?.amount || 0) !== Number(best?.amount || 0)) {
            return Number(row?.amount || 0) > Number(best?.amount || 0) ? row : best;
        }
        if (Number(row?.count || 0) !== Number(best?.count || 0)) {
            return Number(row?.count || 0) > Number(best?.count || 0) ? row : best;
        }
        return String(row?.label || '').localeCompare(String(best?.label || ''), 'pt-BR') < 0 ? row : best;
    }, null);
}

function buildSalesRanking(map, totalPaid = 0, { limit = 10, includeZero = false } = {}) {
    const rows = Array.from(map.values())
        .filter((item) => includeZero || Number(item?.count || 0) > 0)
        .map((item) => ({
            key: String(item?.key || '').trim(),
            label: normalizeSalesLabel(item?.label),
            count: Number(item?.count || 0),
            amount: Number(item?.amount || 0),
            upsellCount: Number(item?.upsellCount || 0),
            orderBumpCount: Number(item?.orderBumpCount || 0),
            avgTicket: Number(item?.count || 0) > 0
                ? Number((Number(item?.amount || 0) / Number(item?.count || 0)).toFixed(2))
                : 0,
            share: totalPaid > 0 ? Math.round((Number(item?.count || 0) / totalPaid) * 1000) / 10 : 0
        }));

    rows.sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        if (b.amount !== a.amount) return b.amount - a.amount;
        return a.label.localeCompare(b.label, 'pt-BR');
    });

    const topUpsell = pickSalesMetricLeader(rows, 'upsellCount');
    const topOrderBump = pickSalesMetricLeader(rows, 'orderBumpCount');
    const topUpsellKey = Number(topUpsell?.upsellCount || 0) > 0 ? String(topUpsell?.key || '') : '';
    const topOrderBumpKey = Number(topOrderBump?.orderBumpCount || 0) > 0 ? String(topOrderBump?.key || '') : '';

    return rows.slice(0, Math.max(1, Number(limit) || 10)).map((row) => ({
        ...row,
        isTopUpsell: !!topUpsellKey && String(row?.key || '') === topUpsellKey,
        isTopOrderBump: !!topOrderBumpKey && String(row?.key || '') === topOrderBumpKey
    }));
}

function resolveLeadRewardInfo(row, payload) {
    const rewardId = String(
        payload?.reward?.id ||
        payload?.rewardId ||
        payload?.reward_id ||
        ''
    ).trim().toLowerCase();

    const rewardName = String(
        payload?.reward?.name ||
        payload?.rewardName ||
        REWARD_LABELS[rewardId] ||
        ''
    ).trim();

    const rawPrice = pick(
        payload?.reward?.checkoutExtraPrice,
        payload?.reward?.extraPrice,
        payload?.rewardExtraPrice
    );
    const rewardPrice = Number(rawPrice);

    return {
        id: rewardId || '',
        name: rewardName || '-',
        price: Number.isFinite(rewardPrice) ? rewardPrice : null
    };
}

function resolveLeadShippingInfo(row, payload) {
    const rawPrice = pick(
        row?.shipping_price,
        payload?.shipping?.price,
        payload?.shippingPrice
    );
    const shippingPrice = Number(rawPrice);

    return {
        id: String(row?.shipping_id || payload?.shipping?.id || payload?.shippingId || '').trim(),
        name: String(row?.shipping_name || payload?.shipping?.name || payload?.shippingName || '').trim() || '-',
        price: Number.isFinite(shippingPrice) ? shippingPrice : null
    };
}

function resolveLeadClientIp(row, payload = {}) {
    return normalizeClientIp(
        row?.client_ip ||
        payload?.metadata?.client_ip ||
        payload?.clientIp ||
        ''
    );
}

function buildBlockedLeadSnapshot(row, payload = {}) {
    const reward = resolveLeadRewardInfo(row, payload);
    return {
        sessionId: String(row?.session_id || '').trim(),
        name: String(row?.name || '').trim(),
        email: String(row?.email || '').trim(),
        cpf: String(row?.cpf || '').trim(),
        phone: String(row?.phone || '').trim(),
        city: String(row?.city || '').trim(),
        state: String(row?.state || '').trim(),
        shippingName: String(row?.shipping_name || payload?.shipping?.name || '').trim(),
        rewardName: String(reward?.name || '').trim(),
        txid: resolveLeadCurrentPixTxid(row, payload)
    };
}

async function fetchLeadPageviews(sessionId) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return { ok: false, reason: 'missing_supabase_config', rows: [] };
    }

    const cleanSession = String(sessionId || '').trim();
    if (!cleanSession) {
        return { ok: false, reason: 'missing_session_id', rows: [] };
    }

    const url = new URL(`${SUPABASE_URL}/rest/v1/lead_pageviews`);
    url.searchParams.set('select', 'session_id,page,created_at');
    url.searchParams.set('session_id', `eq.${cleanSession}`);
    url.searchParams.set('order', 'created_at.asc');

    const response = await fetchFn(url.toString(), {
        headers: {
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        return { ok: false, reason: 'supabase_error', detail, rows: [] };
    }

    const rows = await response.json().catch(() => []);
    return { ok: true, rows: Array.isArray(rows) ? rows : [] };
}

function resolveLeadExportBucket(row, payload) {
    const step = resolveLeadJourneyStep(row, payload);
    const stepLabel = leadJourneyLabel(step);
    const hasPix = Boolean(resolveLeadCurrentPixTxid(row, payload));
    const isPaid = isLeadPaid(row, payload);
    const isRefunded = isLeadRefunded(row, payload);

    if (!hasPix) {
        return {
            key: 'no_pix',
            label: 'Sem PIX gerado',
            step,
            stepLabel,
            hasPix,
            isPaid,
            isRefunded
        };
    }

    if (isRefunded) {
        return {
            key: `${step}_refunded`,
            label: `${stepLabel} estornado`,
            step,
            stepLabel,
            hasPix,
            isPaid,
            isRefunded
        };
    }

    if (isPaid) {
        return {
            key: `${step}_paid`,
            label: `${stepLabel} pago`,
            step,
            stepLabel,
            hasPix,
            isPaid,
            isRefunded
        };
    }

    if (step === 'upsell_iof') {
        return {
            key: LEAD_EXPORT_SEGMENTS.upsell_iof_unpaid.key,
            label: LEAD_EXPORT_SEGMENTS.upsell_iof_unpaid.label,
            step,
            stepLabel,
            hasPix,
            isPaid,
            isRefunded
        };
    }

    if (step === 'upsell_correios') {
        return {
            key: LEAD_EXPORT_SEGMENTS.upsell_correios_unpaid.key,
            label: LEAD_EXPORT_SEGMENTS.upsell_correios_unpaid.label,
            step,
            stepLabel,
            hasPix,
            isPaid,
            isRefunded
        };
    }

    if (step === 'upsell_final') {
        return {
            key: LEAD_EXPORT_SEGMENTS.upsell_final_unpaid.key,
            label: LEAD_EXPORT_SEGMENTS.upsell_final_unpaid.label,
            step,
            stepLabel,
            hasPix,
            isPaid,
            isRefunded
        };
    }

    return {
        key: LEAD_EXPORT_SEGMENTS.front_unpaid.key,
        label: LEAD_EXPORT_SEGMENTS.front_unpaid.label,
        step,
        stepLabel,
        hasPix,
        isPaid,
        isRefunded
    };
}

function resolveLeadExportSegment(segmentKey) {
    return LEAD_EXPORT_SEGMENTS[segmentKey] || LEAD_EXPORT_SEGMENTS.all;
}

function leadMatchesExportSegment(row, payload, segmentKey) {
    if (segmentKey === LEAD_EXPORT_SEGMENTS.all.key) return true;
    return resolveLeadExportBucket(row, payload).key === segmentKey;
}

function applyLeadFiltersToUrl(url, { range = null, query = '', limit = 50, offset = 0, select = LEADS_SELECT_FIELDS } = {}) {
    url.searchParams.set('select', select);
    url.searchParams.set('order', 'updated_at.desc');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));

    if (range?.fromIso) url.searchParams.append('updated_at', `gte.${range.fromIso}`);
    if (range?.toIso) url.searchParams.append('updated_at', `lte.${range.toIso}`);

    if (query) {
        const ilike = `%${String(query).replace(/%/g, '')}%`;
        url.searchParams.set(
            'or',
            `name.ilike.${ilike},email.ilike.${ilike},phone.ilike.${ilike},cpf.ilike.${ilike},utm_source.ilike.${ilike},utm_campaign.ilike.${ilike},utm_term.ilike.${ilike},utm_content.ilike.${ilike}`
        );
    }
}

async function fetchLeadsPage({ range = null, query = '', limit = 50, offset = 0, select = LEADS_SELECT_FIELDS } = {}) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/leads`);
    applyLeadFiltersToUrl(url, { range, query, limit, offset, select });

    const response = await fetchFn(url.toString(), {
        headers: {
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        return { ok: false, detail, status: response.status, rows: [] };
    }

    const rows = await response.json().catch(() => []);
    return {
        ok: true,
        status: response.status,
        rows: Array.isArray(rows) ? rows : []
    };
}

async function fetchAllLeadsForExport({ range = null, query = '', maxRows = MAX_LEADS_EXPORT_ROWS, pageSize = 1000, select = LEADS_SELECT_FIELDS } = {}) {
    const rows = [];
    let offset = 0;
    let truncated = false;

    while (rows.length < maxRows) {
        const take = Math.min(pageSize, maxRows - rows.length);
        const page = await fetchLeadsPage({
            range,
            query,
            limit: take,
            offset,
            select
        });

        if (!page.ok) {
            return {
                ok: false,
                detail: page.detail,
                status: page.status,
                rows,
                truncated
            };
        }

        rows.push(...page.rows);
        const nextOffset = offset + page.rows.length;
        if (page.rows.length < take) {
            break;
        }

        if (rows.length >= maxRows) {
            const probe = await fetchLeadsPage({
                range,
                query,
                limit: 1,
                offset: nextOffset,
                select: 'session_id'
            });
            truncated = probe.ok && probe.rows.length > 0;
            break;
        }

        offset = nextOffset;
    }

    return { ok: true, rows, truncated };
}

function formatLeadExportDate(value) {
    const iso = toIsoDate(value);
    if (!iso) return '';

    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';

    return date.toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo'
    });
}

function formatLeadExportBool(value) {
    return value ? 'sim' : 'nao';
}

function safeLeadExportText(value, maxLen = 32000) {
    const text = value === null || value === undefined ? '' : String(value);
    if (!text) return '';
    if (text.length <= maxLen) return text;
    return `${text.slice(0, Math.max(0, maxLen - 3))}...`;
}

function buildLeadExportRow(row, segment) {
    const payload = asObject(row?.payload);
    const readable = mapLeadReadable(row);
    const bucket = resolveLeadExportBucket(row, payload);
    const currentTxid = resolveLeadCurrentPixTxid(row, payload);
    const currentPixStatus = resolveLeadCurrentPixStatus(row, payload);
    const previousTxid = String(payload?.upsell?.previousTxid || '').trim();
    const address = [row?.address_line, row?.number, row?.neighborhood, row?.city, row?.state]
        .filter(Boolean)
        .join(', ');

    return [
        safeLeadExportText(row?.session_id || ''),
        safeLeadExportText(row?.name || ''),
        safeLeadExportText(row?.email || ''),
        safeLeadExportText(row?.cpf || ''),
        safeLeadExportText(row?.phone || ''),
        safeLeadExportText(row?.cep || ''),
        safeLeadExportText(address),
        safeLeadExportText(row?.number || ''),
        safeLeadExportText(row?.complement || ''),
        safeLeadExportText(row?.neighborhood || ''),
        safeLeadExportText(row?.city || ''),
        safeLeadExportText(row?.state || ''),
        safeLeadExportText(row?.reference || ''),
        safeLeadExportText(row?.stage || ''),
        safeLeadExportText(row?.last_event || ''),
        safeLeadExportText(readable?.status_funil || ''),
        safeLeadExportText(bucket.stepLabel),
        safeLeadExportText(bucket.label),
        safeLeadExportText(segment.label),
        formatLeadExportBool(Boolean(currentTxid)),
        formatLeadExportBool(isLeadPaid(row, payload)),
        formatLeadExportBool(isLeadRefunded(row, payload)),
        safeLeadExportText(readable?.gateway_label || ''),
        safeLeadExportText(currentTxid),
        safeLeadExportText(currentPixStatus),
        Number.isFinite(Number(row?.pix_amount)) ? Number(row.pix_amount) : '',
        safeLeadExportText(row?.shipping_id || ''),
        safeLeadExportText(row?.shipping_name || ''),
        Number.isFinite(Number(row?.shipping_price)) ? Number(row.shipping_price) : '',
        formatLeadExportBool(row?.bump_selected === true),
        Number.isFinite(Number(row?.bump_price)) ? Number(row.bump_price) : '',
        formatLeadExportBool(payload?.upsell?.enabled === true || bucket.step !== 'front'),
        safeLeadExportText(payload?.upsell?.kind || ''),
        safeLeadExportText(payload?.upsell?.title || ''),
        Number.isFinite(Number(payload?.upsell?.price)) ? Number(payload.upsell.price) : '',
        safeLeadExportText(previousTxid),
        safeLeadExportText(row?.utm_source || ''),
        safeLeadExportText(row?.utm_medium || ''),
        safeLeadExportText(row?.utm_campaign || ''),
        safeLeadExportText(row?.utm_term || ''),
        safeLeadExportText(row?.utm_content || ''),
        safeLeadExportText(row?.fbclid || ''),
        safeLeadExportText(row?.gclid || ''),
        safeLeadExportText(row?.ttclid || ''),
        safeLeadExportText(row?.referrer || ''),
        safeLeadExportText(row?.landing_page || ''),
        safeLeadExportText(row?.source_url || ''),
        safeLeadExportText(row?.client_ip || ''),
        safeLeadExportText(row?.user_agent || ''),
        safeLeadExportText(formatLeadExportDate(readable?.event_time || row?.updated_at)),
        safeLeadExportText(formatLeadExportDate(row?.created_at)),
        safeLeadExportText(formatLeadExportDate(row?.updated_at)),
        safeLeadExportText(JSON.stringify(payload))
    ];
}

function buildLeadExportWorkbook(rows, segment) {
    const header = LEAD_EXPORT_COLUMNS.map((column) => column.header);
    const body = rows.map((row) => buildLeadExportRow(row, segment));
    const worksheet = XLSX.utils.aoa_to_sheet([header, ...body]);
    worksheet['!cols'] = LEAD_EXPORT_COLUMNS.map((column) => ({ wch: column.width }));

    const workbook = XLSX.utils.book_new();
    workbook.Props = {
        Title: segment.label,
        Subject: 'Exportacao de leads',
        Author: 'Codex',
        CreatedDate: new Date()
    };
    XLSX.utils.book_append_sheet(workbook, worksheet, String(segment.sheetName || 'Leads').slice(0, 31));

    return XLSX.write(workbook, {
        type: 'buffer',
        bookType: 'xlsx',
        compression: true
    });
}

function resolveReconcileSortAt(row, payload = {}) {
    return (
        toIsoDate(payload?.pixCreatedAt) ||
        toIsoDate(payload?.pix?.created_at) ||
        toIsoDate(payload?.pix?.createdAt) ||
        toIsoDate(payload?.created_at) ||
        toIsoDate(payload?.createdAt) ||
        toIsoDate(row?.updated_at) ||
        toIsoDate(row?.created_at) ||
        null
    );
}

async function listLeadTxidsForReconcile({
    maxTx = 100,
    pageSize = 250,
    scanRows = 1500,
    includeConfirmed = true
} = {}) {
    const entries = [];
    const seen = new Set();
    let offset = 0;
    let scannedRows = 0;

    while (scannedRows < scanRows) {
        const url = new URL(`${SUPABASE_URL}/rest/v1/leads`);
        const limit = Math.min(pageSize, Math.max(1, scanRows - scannedRows));
        url.searchParams.set('select', 'session_id,pix_txid,payload,last_event,updated_at,created_at');
        url.searchParams.set('pix_txid', 'not.is.null');
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
            const payload = asObject(row?.payload);
            const fallbackTxid = String(
                payload?.pixTxid ||
                payload?.pix?.idTransaction ||
                payload?.pix?.idtransaction ||
                payload?.idTransaction ||
                payload?.idtransaction ||
                payload?.id ||
                ''
            ).trim();
            const txid = String(row?.pix_txid || fallbackTxid || '').trim();
            if (!txid || txid === '-') return;

            const gateway = resolveLeadGateway(row, payload);
            const key = `${gateway}:${txid}`;
            if (seen.has(key)) return;
            seen.add(key);
            entries.push({
                txid,
                gateway,
                sessionId: String(row?.session_id || payload?.sessionId || payload?.orderId || '').trim(),
                sortAt: resolveReconcileSortAt(row, payload) || ''
            });
        });

        if (rows.length < limit) {
            break;
        }
        offset += rows.length;
    }

    return {
        ok: true,
        entries: entries
            .sort((a, b) => {
                const diff = Date.parse(b?.sortAt || '') - Date.parse(a?.sortAt || '');
                if (Number.isFinite(diff) && diff !== 0) return diff;
                return String(b?.txid || '').localeCompare(String(a?.txid || ''));
            })
            .slice(0, Math.max(1, Number(maxTx) || 100))
            .map(({ sortAt, ...entry }) => entry),
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
    const range = parseLeadsDateRange(req.query || {});
    if (!range.ok) {
        res.status(400).json({ error: range.error || 'Filtro de data invalido.' });
        return;
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const query = String(req.query.q || '').trim();

    const response = await fetchLeadsPage({
        range,
        query,
        limit,
        offset,
        select: LEADS_SELECT_FIELDS
    });

    if (!response.ok) {
        res.status(502).json({ error: 'Falha ao buscar leads.', detail: response.detail || '' });
        return;
    }

    const rows = response.rows || [];
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
            },
            paradise: {
                gateway: 'paradise',
                label: gatewayLabel('paradise'),
                leads: 0,
                pix: 0,
                paid: 0,
                refunded: 0,
                refused: 0,
                pending: 0
            },
            atomopay: {
                gateway: 'atomopay',
                label: gatewayLabel('atomopay'),
                leads: 0,
                pix: 0,
                paid: 0,
                refunded: 0,
                refused: 0,
                pending: 0
            }
        }
    };

    const maxSummaryRows = clamp(req.query.summaryMax || 50000, 1, 200000);
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
        if (range.fromIso) u.searchParams.append('updated_at', `gte.${range.fromIso}`);
        if (range.toIso) u.searchParams.append('updated_at', `lte.${range.toIso}`);
        if (query) {
            const ilike = `%${query.replace(/%/g, '')}%`;
            u.searchParams.set(
                'or',
                `name.ilike.${ilike},email.ilike.${ilike},phone.ilike.${ilike},cpf.ilike.${ilike},utm_source.ilike.${ilike},utm_campaign.ilike.${ilike},utm_term.ilike.${ilike},utm_content.ilike.${ilike}`
            );
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
                    : mapped.gateway === 'paradise'
                        ? 'paradise'
                        : mapped.gateway === 'atomopay'
                            ? 'atomopay'
                        : '';
            const gatewaySummary = gateway ? summary.gatewayStats[gateway] : null;
            summary.total += 1;
            if (gatewaySummary) gatewaySummary.leads += 1;
            if (String(row?.cep || '').trim() && String(row?.cep || '').trim() !== '-') summary.cep += 1;
            if (String(row?.shipping_name || '').trim() && String(row?.shipping_name || '').trim() !== '-') summary.frete += 1;
            if (String(row?.pix_txid || '').trim() && String(row?.pix_txid || '').trim() !== '-') {
                summary.pix += 1;
                if (gatewaySummary) gatewaySummary.pix += 1;
            }

            const ev = String(mapped?.evento || '').toLowerCase().trim();
            if (mapped?.is_paid || ev === 'pix_confirmed') {
                summary.paid += 1;
                if (gatewaySummary) gatewaySummary.paid += 1;
            } else if (ev === 'pix_refunded') {
                summary.refunded += 1;
                if (gatewaySummary) gatewaySummary.refunded += 1;
            } else if (ev === 'pix_refused') {
                summary.refused += 1;
                if (gatewaySummary) gatewaySummary.refused += 1;
            } else if (ev === 'pix_pending' || ev === 'pix_created') {
                summary.pending += 1;
                if (gatewaySummary) gatewaySummary.pending += 1;
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
    summary.gatewayStats.paradise = {
        gateway: 'paradise',
        label: gatewayLabel('paradise'),
        ...(summary.gatewayStats.paradise || { leads: 0, pix: 0, paid: 0, refunded: 0, refused: 0, pending: 0 })
    };
    summary.gatewayStats.atomopay = {
        gateway: 'atomopay',
        label: gatewayLabel('atomopay'),
        ...(summary.gatewayStats.atomopay || { leads: 0, pix: 0, paid: 0, refunded: 0, refused: 0, pending: 0 })
    };
    summary.gatewayStats.ghostspay.conversion = gatewayConversionPercent(summary.gatewayStats.ghostspay);
    summary.gatewayStats.sunize.conversion = gatewayConversionPercent(summary.gatewayStats.sunize);
    summary.gatewayStats.paradise.conversion = gatewayConversionPercent(summary.gatewayStats.paradise);
    summary.gatewayStats.atomopay.conversion = gatewayConversionPercent(summary.gatewayStats.atomopay);
    summary.range = {
        from: range.fromIso || null,
        to: range.toIso || null,
        timezone: 'UTC'
    };
    const pageCounts = await fetchPageviewCountsMap(range).catch(() => new Map());
    summary.funnel = buildNativeFunnel(summary, pageCounts);

    res.status(200).json({ data, summary });
}

async function getLeadDetail(req, res, sessionIdParam = '') {
    if (req.method !== 'GET') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    if (!requireAdmin(req, res)) return;

    const sessionId = decodeURIComponent(String(sessionIdParam || '').trim());
    if (!sessionId) {
        res.status(400).json({ error: 'Sessao do lead nao informada.' });
        return;
    }

    const leadResult = await getLeadBySessionId(sessionId);
    if (!leadResult?.ok) {
        res.status(502).json({ error: 'Falha ao buscar lead.', detail: leadResult?.detail || '' });
        return;
    }

    const lead = leadResult?.data;
    if (!lead) {
        res.status(404).json({ error: 'Lead nao encontrado.' });
        return;
    }

    const payload = asObject(lead?.payload);
    const readable = mapLeadReadable(lead);
    const reward = resolveLeadRewardInfo(lead, payload);
    const shipping = resolveLeadShippingInfo(lead, payload);
    const clientIp = resolveLeadClientIp(lead, payload);
    const userAgent = String(lead?.user_agent || payload?.metadata?.user_agent || '').trim();
    const pageviewsResult = await fetchLeadPageviews(sessionId);
    const blockedResult = clientIp ? await findBlockedIp(clientIp) : { ok: true, blocked: false, entry: null };

    const pageviews = (pageviewsResult?.rows || []).map((row) => {
        const meta = describeLeadPage(row?.page);
        return {
            page: meta.page,
            label: meta.label,
            description: meta.description,
            createdAt: toIsoDate(row?.created_at) || row?.created_at || null
        };
    });

    const detail = {
        sessionId: String(lead?.session_id || '').trim(),
        readable,
        customer: {
            name: String(lead?.name || '').trim(),
            email: String(lead?.email || '').trim(),
            cpf: String(lead?.cpf || '').trim(),
            phone: String(lead?.phone || '').trim()
        },
        address: {
            cep: String(lead?.cep || '').trim(),
            addressLine: String(lead?.address_line || '').trim(),
            number: String(lead?.number || '').trim(),
            complement: String(lead?.complement || '').trim(),
            neighborhood: String(lead?.neighborhood || '').trim(),
            city: String(lead?.city || '').trim(),
            state: String(lead?.state || '').trim(),
            reference: String(lead?.reference || '').trim()
        },
        tracking: {
            utmSource: String(lead?.utm_source || payload?.utm?.utm_source || payload?.utm_source || '').trim(),
            utmMedium: String(lead?.utm_medium || payload?.utm?.utm_medium || payload?.utm_medium || '').trim(),
            utmCampaign: String(lead?.utm_campaign || payload?.utm?.utm_campaign || payload?.utm_campaign || '').trim(),
            utmTerm: String(lead?.utm_term || payload?.utm?.utm_term || payload?.utm_term || '').trim(),
            utmContent: String(lead?.utm_content || payload?.utm?.utm_content || payload?.utm_content || '').trim(),
            fbclid: String(lead?.fbclid || payload?.utm?.fbclid || payload?.fbclid || '').trim(),
            gclid: String(lead?.gclid || payload?.utm?.gclid || payload?.gclid || '').trim(),
            ttclid: String(lead?.ttclid || payload?.utm?.ttclid || payload?.ttclid || '').trim(),
            referrer: String(lead?.referrer || payload?.utm?.referrer || payload?.referrer || '').trim(),
            landingPage: String(lead?.landing_page || payload?.utm?.landing_page || payload?.landing_page || '').trim(),
            sourceUrl: String(lead?.source_url || payload?.sourceUrl || '').trim()
        },
        device: {
            clientIp,
            userAgent,
            summary: summarizeUserAgent(userAgent)
        },
        payment: {
            gateway: readable?.gateway || '-',
            gatewayLabel: readable?.gateway_label || gatewayLabel(readable?.gateway || ''),
            status: readable?.status_funil || '-',
            event: readable?.evento || '-',
            pixTxid: resolveLeadCurrentPixTxid(lead, payload),
            pixStatusRaw: resolveLeadCurrentPixStatus(lead, payload),
            amount: Number.isFinite(Number(lead?.pix_amount)) ? Number(lead.pix_amount) : null,
            createdAt: toIsoDate(lead?.created_at) || lead?.created_at || null,
            updatedAt: toIsoDate(lead?.updated_at) || lead?.updated_at || null,
            pixCreatedAt: toIsoDate(payload?.pixCreatedAt) || payload?.pixCreatedAt || null,
            pixPaidAt: toIsoDate(payload?.pixPaidAt) || payload?.pixPaidAt || null,
            pixRefundedAt: toIsoDate(payload?.pixRefundedAt) || payload?.pixRefundedAt || null,
            pixRefusedAt: toIsoDate(payload?.pixRefusedAt) || payload?.pixRefusedAt || null
        },
        shipping,
        reward,
        bump: {
            selected: lead?.bump_selected === true,
            price: Number.isFinite(Number(lead?.bump_price)) ? Number(lead.bump_price) : null
        },
        pageviews,
        block: {
            blocked: blockedResult?.blocked === true,
            entry: blockedResult?.entry || null
        },
        payload
    };

    res.status(200).json({ ok: true, data: detail });
}

async function ipBlacklist(req, res) {
    if (!requireAdmin(req, res)) return;

    if (req.method === 'GET') {
        const result = await getIpBlacklist({ force: true });
        if (!result?.ok) {
            res.status(502).json({ error: 'Falha ao buscar blacklist de IP.', detail: result?.detail || '' });
            return;
        }

        res.status(200).json({ ok: true, entries: result.entries || [] });
        return;
    }

    if (req.method === 'POST') {
        let body = {};
        try {
            body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
        } catch (_error) {
            res.status(400).json({ error: 'JSON invalido.' });
            return;
        }

        const sessionId = String(body?.sessionId || '').trim();
        const providedIp = normalizeClientIp(body?.ip || '');
        let lead = null;
        let payload = {};
        let resolvedIp = providedIp;

        if (sessionId) {
            const leadResult = await getLeadBySessionId(sessionId);
            if (!leadResult?.ok) {
                res.status(502).json({ error: 'Falha ao buscar lead para bloqueio.', detail: leadResult?.detail || '' });
                return;
            }
            lead = leadResult?.data || null;
            if (!lead) {
                res.status(404).json({ error: 'Lead nao encontrado para bloqueio.' });
                return;
            }

            payload = asObject(lead?.payload);
            const leadIp = resolveLeadClientIp(lead, payload);
            if (providedIp && leadIp && providedIp !== leadIp) {
                res.status(409).json({ error: 'O IP informado nao corresponde ao IP salvo neste lead.' });
                return;
            }
            resolvedIp = leadIp || providedIp;
        }

        if (!resolvedIp) {
            res.status(400).json({ error: 'Nenhum IP valido foi encontrado para bloqueio.' });
            return;
        }

        const result = await addBlockedIp({
            ip: resolvedIp,
            reason: body?.reason || 'Bloqueio manual via admin',
            sessionId: lead?.session_id || sessionId,
            lead: lead ? buildBlockedLeadSnapshot(lead, payload) : {
                sessionId,
                name: String(body?.name || '').trim(),
                email: String(body?.email || '').trim(),
                cpf: String(body?.cpf || '').trim(),
                phone: String(body?.phone || '').trim()
            }
        });

        if (!result?.ok) {
            res.status(502).json({ error: 'Falha ao bloquear IP.', detail: result?.detail || '' });
            return;
        }

        res.status(200).json({ ok: true, ip: resolvedIp, entries: result.entries || [] });
        return;
    }

    if (req.method === 'DELETE') {
        const ip = normalizeClientIp(req.query?.ip || req.body?.ip || '');
        if (!ip) {
            res.status(400).json({ error: 'IP invalido para remocao.' });
            return;
        }

        const result = await removeBlockedIp(ip);
        if (!result?.ok) {
            res.status(502).json({ error: 'Falha ao remover IP da blacklist.', detail: result?.detail || '' });
            return;
        }

        res.status(200).json({ ok: true, ip, entries: result.entries || [] });
        return;
    }

    res.status(405).json({ error: 'Method not allowed' });
}

async function exportLeads(req, res) {
    if (req.method !== 'GET') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    if (!requireAdmin(req, res)) return;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        res.status(500).json({ error: 'Supabase nao configurado.' });
        return;
    }

    const range = parseLeadsDateRange(req.query || {});
    if (!range.ok) {
        res.status(400).json({ error: range.error || 'Filtro de data invalido.' });
        return;
    }

    const segmentKey = String(firstQueryValue(req.query?.segment) || LEAD_EXPORT_SEGMENTS.all.key).trim();
    const segment = resolveLeadExportSegment(segmentKey);
    if (!LEAD_EXPORT_SEGMENTS[segmentKey] && segmentKey !== LEAD_EXPORT_SEGMENTS.all.key) {
        res.status(400).json({ error: 'Filtro de exportacao invalido.' });
        return;
    }

    const query = String(firstQueryValue(req.query?.q) || '').trim();
    const maxRows = clamp(firstQueryValue(req.query?.max) || MAX_LEADS_EXPORT_ROWS, 1, MAX_LEADS_EXPORT_ROWS);
    const result = await fetchAllLeadsForExport({
        range,
        query,
        maxRows
    });

    if (!result.ok) {
        res.status(502).json({ error: 'Falha ao montar a exportacao.', detail: result.detail || '' });
        return;
    }

    const matches = result.rows.filter((row) => leadMatchesExportSegment(row, asObject(row?.payload), segment.key));
    const workbookBuffer = buildLeadExportWorkbook(matches, segment);
    const fileDate = new Date().toISOString().slice(0, 10);
    const fileName = `leads-${segment.fileSlug}-${fileDate}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('X-Export-Count', String(matches.length));
    res.setHeader('X-Export-Scanned', String(result.rows.length));
    res.setHeader('X-Export-Truncated', result.truncated ? '1' : '0');
    res.status(200).send(workbookBuffer);
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

async function getSalesInsights(req, res) {
    if (req.method !== 'GET') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    if (!requireAdmin(req, res)) return;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        res.status(500).json({ error: 'Supabase nao configurado.' });
        return;
    }

    const range = parseLeadsDateRange(req.query || {});
    if (!range.ok) {
        res.status(400).json({ error: range.error || 'Filtro de data invalido.' });
        return;
    }

    const maxRows = clamp(firstQueryValue(req.query?.max) || 80000, 1, MAX_LEADS_EXPORT_ROWS);
    const result = await fetchAllLeadsForExport({
        range,
        maxRows,
        pageSize: 1000,
        select: SALES_INSIGHTS_SELECT_FIELDS
    });

    if (!result.ok) {
        res.status(502).json({ error: 'Falha ao montar insights de vendas.', detail: result.detail || '' });
        return;
    }

    const positioningMap = new Map();
    const cityMap = new Map();
    const deviceMap = new Map([
        ['iphone', { key: 'iphone', label: 'iPhone', count: 0, amount: 0 }],
        ['android', { key: 'android', label: 'Android', count: 0, amount: 0 }],
        ['pc', { key: 'pc', label: 'PC', count: 0, amount: 0 }]
    ]);

    let totalPaid = 0;
    let totalRevenue = 0;
    let lastSaleAt = null;

    (Array.isArray(result.rows) ? result.rows : []).forEach((row) => {
        const payload = asObject(row?.payload);
        if (!isLeadPaid(row, payload)) return;

        totalPaid += 1;
        const amount = Number.isFinite(Number(row?.pix_amount)) ? Number(row.pix_amount) : 0;
        totalRevenue = Number((totalRevenue + amount).toFixed(2));
        const hasUpsell = Boolean(
            payload?.upsell?.enabled === true ||
            String(row?.shipping_id || '').trim().toLowerCase() === 'expresso_1dia' ||
            /^upsell/.test(String(payload?.sourceStage || '').trim().toLowerCase()) ||
            /^upsell/.test(String(payload?.stage || '').trim().toLowerCase()) ||
            /adiantamento|prioridade|expresso/i.test(String(row?.shipping_name || payload?.shipping?.name || ''))
        );
        const hasOrderBump = Boolean(
            row?.bump_selected === true ||
            Number(row?.bump_price || 0) > 0 ||
            payload?.bump?.selected === true ||
            Number(payload?.bump?.price || 0) > 0
        );

        const mapped = mapLeadReadable(row);
        const positioningLabel = normalizeSalesLabel(mapped?.utm_term_label || mapped?.utm_term || row?.utm_term || '', '');
        if (positioningLabel) {
            const positioningKey = positioningLabel.toLowerCase();
            accumulateSalesBucket(positioningMap, positioningKey, positioningLabel, {
                amount,
                upsell: hasUpsell,
                orderBump: hasOrderBump
            });
        }

        const cityLabel = normalizeCityLabel(row, payload);
        if (cityLabel && cityLabel !== '-') {
            const cityKey = cityLabel.toLowerCase();
            accumulateSalesBucket(cityMap, cityKey, cityLabel, {
                amount,
                upsell: hasUpsell,
                orderBump: hasOrderBump
            });
        }

        const deviceLabel = resolveSalesDeviceLabel(row?.user_agent, payload);
        const deviceKey = deviceLabel.toLowerCase() === 'iphone'
            ? 'iphone'
            : deviceLabel.toLowerCase() === 'android'
                ? 'android'
                : 'pc';
        accumulateSalesBucket(deviceMap, deviceKey, deviceLabel, {
            amount,
            upsell: hasUpsell,
            orderBump: hasOrderBump
        });

        const eventTime = mapped?.event_time || row?.updated_at || row?.created_at || null;
        const currentTs = lastSaleAt ? Date.parse(lastSaleAt) : 0;
        const nextTs = eventTime ? Date.parse(eventTime) : 0;
        if (!lastSaleAt || (nextTs && nextTs > currentTs)) {
            lastSaleAt = eventTime;
        }
    });

    const positionings = buildSalesRanking(positioningMap, totalPaid, { limit: 8 });
    const cities = buildSalesRanking(cityMap, totalPaid, { limit: 10 });
    const devices = buildSalesRanking(deviceMap, totalPaid, { limit: 3, includeZero: true });

    res.status(200).json({
        ok: true,
        summary: {
            totalPaid,
            totalRevenue,
            lastSaleAt,
            scannedRows: Number(result.rows?.length || 0),
            truncated: result.truncated === true,
            range: {
                from: range.fromDate || '',
                to: range.toDate || ''
            },
            topPositioning: positionings[0] || null,
            topCity: cities[0] || null,
            topDevice: totalPaid > 0 ? (devices[0] || null) : null
        },
        data: {
            positionings,
            cities,
            devices
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
    return out.slice(0, 1);
}

function buildPushcutConfig(raw = {}) {
    const createdUrl = normalizePushcutUrls([
        ...(Array.isArray(raw.pixCreatedUrls) ? raw.pixCreatedUrls : []),
        raw.pixCreatedUrl,
        raw.pixCreatedUrl2
    ])[0] || '';
    const confirmedUrl = normalizePushcutUrls([
        ...(Array.isArray(raw.pixConfirmedUrls) ? raw.pixConfirmedUrls : []),
        raw.pixConfirmedUrl,
        raw.pixConfirmedUrl2
    ])[0] || '';

    return {
        ...defaultSettings.pushcut,
        ...raw,
        pixCreatedUrl: createdUrl,
        pixCreatedUrl2: '',
        pixCreatedUrls: createdUrl ? [createdUrl] : [],
        pixConfirmedUrl: confirmedUrl,
        pixConfirmedUrl2: '',
        pixConfirmedUrls: confirmedUrl ? [confirmedUrl] : [],
        templates: {
            ...defaultSettings.pushcut.templates,
            ...(raw.templates || {})
        }
    };
}

async function settings(req, res) {
    if (req.method === 'GET') {
        if (!requireAdmin(req, res)) return;
        const settingsState = await getSettingsState({ strict: true });
        if (!settingsState?.ok || !settingsState?.settings || settingsState.source !== 'supabase') {
            res.status(503).json({ error: 'Falha ao carregar configuracao. Recarregue o painel.' });
            return;
        }
        const sanitized = sanitizeSettingsForAdmin(settingsState.settings);
        sanitized._meta = {
            source: settingsState.source,
            updatedAt: String(settingsState.updatedAt || '').trim(),
            stale: !!settingsState.stale
        };
        res.status(200).json(sanitized);
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

        const currentState = await getSettingsState({ strict: true }).catch(() => ({ ok: false, settings: null, source: 'none' }));
        if (!currentState?.ok || !currentState?.settings || currentState.source !== 'supabase') {
            res.status(503).json({ error: 'Falha ao carregar configuracao atual. Recarregue antes de salvar.' });
            return;
        }
        const baseUpdatedAt = String(body?._meta?.baseUpdatedAt || '').trim();
        const currentUpdatedAt = String(currentState.updatedAt || '').trim();
        if (currentUpdatedAt && (!baseUpdatedAt || baseUpdatedAt !== currentUpdatedAt)) {
            res.status(409).json({ error: 'Configuracao desatualizada. Recarregue o painel antes de salvar.' });
            return;
        }

        const currentSaved = currentState.settings;
        const currentPayments = buildPaymentsConfig(currentSaved?.payments || {});
        const bodyPayments = body?.payments && typeof body.payments === 'object' ? body.payments : {};
        const bodyGateways = bodyPayments.gateways && typeof bodyPayments.gateways === 'object'
            ? bodyPayments.gateways
            : {};
        const bodyGhost = bodyGateways.ghostspay && typeof bodyGateways.ghostspay === 'object'
            ? bodyGateways.ghostspay
            : {};
        const bodySunize = bodyGateways.sunize && typeof bodyGateways.sunize === 'object'
            ? bodyGateways.sunize
            : {};
        const bodyParadise = bodyGateways.paradise && typeof bodyGateways.paradise === 'object'
            ? bodyGateways.paradise
            : {};
        const bodyAtomopay = bodyGateways.atomopay && typeof bodyGateways.atomopay === 'object'
            ? bodyGateways.atomopay
            : {};
        const currentGhostGateway = currentPayments?.gateways?.ghostspay || {};
        const currentSunizeGateway = currentPayments?.gateways?.sunize || {};
        const currentParadiseGateway = currentPayments?.gateways?.paradise || {};
        const currentAtomopayGateway = currentPayments?.gateways?.atomopay || {};
        const mergedPaymentsInput = {
            ...(bodyPayments || {}),
            gateways: {
                ...(bodyGateways || {}),
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
                },
                paradise: {
                    ...bodyParadise,
                    apiKey: pickSecretInput(bodyParadise.apiKey, currentParadiseGateway.apiKey || ''),
                    productHash: pickSecretInput(bodyParadise.productHash, currentParadiseGateway.productHash || ''),
                    webhookTokenRequired: bodyParadise.webhookTokenRequired !== undefined
                        ? !!bodyParadise.webhookTokenRequired
                        : currentParadiseGateway.webhookTokenRequired === true
                },
                atomopay: {
                    ...bodyAtomopay,
                    apiToken: pickSecretInput(bodyAtomopay.apiToken, currentAtomopayGateway.apiToken || ''),
                    offerHash: pickSecretInput(bodyAtomopay.offerHash, currentAtomopayGateway.offerHash || ''),
                    productHash: pickSecretInput(bodyAtomopay.productHash, currentAtomopayGateway.productHash || ''),
                    iofOfferHash: pickSecretInput(bodyAtomopay.iofOfferHash, currentAtomopayGateway.iofOfferHash || ''),
                    iofProductHash: pickSecretInput(bodyAtomopay.iofProductHash, currentAtomopayGateway.iofProductHash || ''),
                    correiosOfferHash: pickSecretInput(bodyAtomopay.correiosOfferHash, currentAtomopayGateway.correiosOfferHash || ''),
                    correiosProductHash: pickSecretInput(bodyAtomopay.correiosProductHash, currentAtomopayGateway.correiosProductHash || ''),
                    expressoOfferHash: pickSecretInput(bodyAtomopay.expressoOfferHash, currentAtomopayGateway.expressoOfferHash || ''),
                    expressoProductHash: pickSecretInput(bodyAtomopay.expressoProductHash, currentAtomopayGateway.expressoProductHash || ''),
                    webhookToken: pickSecretInput(bodyAtomopay.webhookToken, currentAtomopayGateway.webhookToken || ''),
                    webhookTokenRequired: bodyAtomopay.webhookTokenRequired !== undefined
                        ? !!bodyAtomopay.webhookTokenRequired
                        : currentAtomopayGateway.webhookTokenRequired === true
                }
            }
        };

        const hasPixelSection = body.pixel && typeof body.pixel === 'object';
        const hasTikTokPixelSection = body.tiktokPixel && typeof body.tiktokPixel === 'object';
        const hasUtmfySection = body.utmfy && typeof body.utmfy === 'object';
        const hasPushcutSection = body.pushcut && typeof body.pushcut === 'object';
        const hasPaymentsSection = body.payments && typeof body.payments === 'object';
        const hasFeaturesSection = body.features && typeof body.features === 'object';
        const bodyPixel = hasPixelSection ? body.pixel : {};
        const bodyTikTokPixel = hasTikTokPixelSection ? body.tiktokPixel : {};
        const currentUtmfy = currentSaved?.utmfy || {};
        const currentPushcut = currentSaved?.pushcut || {};
        const bodyUtmfy = hasUtmfySection ? body.utmfy : {};
        const bodyPushcut = hasPushcutSection ? body.pushcut : {};

        const payload = {
            ...defaultSettings,
            ...Object.fromEntries(Object.entries(body || {}).filter(([key]) => key !== '_meta')),
            pixel: hasPixelSection
                ? {
                    enabled: !!bodyPixel.enabled,
                    id: String(bodyPixel.id || '').trim(),
                    backupId: String(bodyPixel.backupId || '').trim(),
                    capi: {
                        ...defaultSettings.pixel.capi,
                        ...(currentSaved?.pixel?.capi || {}),
                        ...(bodyPixel?.capi || {}),
                        enabled: !!bodyPixel?.capi?.enabled,
                        accessToken: pickSecretInput(bodyPixel?.capi?.accessToken, currentSaved?.pixel?.capi?.accessToken || ''),
                        backupAccessToken: pickSecretInput(bodyPixel?.capi?.backupAccessToken, currentSaved?.pixel?.capi?.backupAccessToken || ''),
                        testEventCode: String(bodyPixel?.capi?.testEventCode || '').trim(),
                        backupTestEventCode: String(bodyPixel?.capi?.backupTestEventCode || '').trim()
                    },
                    events: {
                        ...defaultSettings.pixel.events,
                        ...(bodyPixel?.events || {})
                    }
                }
                : {
                    ...defaultSettings.pixel,
                    ...(currentSaved?.pixel || {}),
                    capi: {
                        ...defaultSettings.pixel.capi,
                        ...(currentSaved?.pixel?.capi || {})
                    },
                    events: {
                        ...defaultSettings.pixel.events,
                        ...(currentSaved?.pixel?.events || {})
                    }
                },
            tiktokPixel: hasTikTokPixelSection
                ? {
                    enabled: !!bodyTikTokPixel.enabled,
                    id: String(bodyTikTokPixel.id || '').trim(),
                    events: {
                        ...defaultSettings.tiktokPixel.events,
                        ...(bodyTikTokPixel?.events || {})
                    }
                }
                : {
                    ...defaultSettings.tiktokPixel,
                    ...(currentSaved?.tiktokPixel || {}),
                    events: {
                        ...defaultSettings.tiktokPixel.events,
                        ...(currentSaved?.tiktokPixel?.events || {})
                    }
                },
            utmfy: hasUtmfySection
                ? {
                    ...defaultSettings.utmfy,
                    ...currentUtmfy,
                    ...bodyUtmfy,
                    apiKey: pickSecretInput(bodyUtmfy.apiKey, currentUtmfy.apiKey || '')
                }
                : {
                    ...defaultSettings.utmfy,
                    ...currentUtmfy
                },
            pushcut: hasPushcutSection
                ? buildPushcutConfig({
                    ...currentPushcut,
                    ...bodyPushcut
                })
                : buildPushcutConfig(currentPushcut),
            payments: hasPaymentsSection
                ? mergePaymentSettings(currentSaved?.payments || defaultSettings.payments || {}, mergedPaymentsInput)
                : mergePaymentSettings(currentSaved?.payments || defaultSettings.payments || {}, {}),
            features: hasFeaturesSection
                ? {
                    ...defaultSettings.features,
                    ...(currentSaved?.features || {}),
                    ...(body.features || {})
                }
                : {
                    ...defaultSettings.features,
                    ...(currentSaved?.features || {})
                }
        };

        const result = await saveSettings(payload);
        if (!result.ok) {
            res.status(502).json({ error: 'Falha ao salvar configuracao.' });
            return;
        }

        invalidatePaymentsConfigCache();
        res.status(200).json({ ok: true, updatedAt: String(result.updatedAt || '').trim() });
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
        source: 'Meta Ads',
        utm_source: 'meta',
        campaign: 'Campanha Teste',
        utm_campaign: 'Campanha Teste',
        adset: 'Conjunto Teste',
        utm_content: 'Conjunto Teste',
        utm: {
            utm_source: 'meta',
            utm_campaign: 'Campanha Teste',
            utm_content: 'Conjunto Teste'
        },
        shippingName: 'Envio Padrao iFood',
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

async function gatewayTestPix(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    if (!requireAdmin(req, res)) return;

    let body = {};
    try {
        body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    } catch (_error) {
        res.status(400).json({ error: 'JSON invalido.' });
        return;
    }

    const amount = parseGatewayTestAmount(body?.amount);
    if (!amount) {
        res.status(400).json({ error: 'Informe um valor valido a partir de R$ 1,00.' });
        return;
    }

    const gateways = normalizeGatewayTestSelection(body?.gateways);
    if (!gateways.length) {
        res.status(400).json({ error: 'Selecione ao menos um gateway para testar.' });
        return;
    }

    const settingsData = await getSettings().catch(() => ({}));
    const payments = buildPaymentsConfig(settingsData?.payments || {});
    const baseIp = resolveAdminClientIp(req);
    const baseCustomer = {
        name: 'Teste Gateway Admin',
        email: `gateway.test.${Date.now()}@example.com`,
        phoneDigits: '11999999999',
        phoneE164: '+5511999999999',
        document: '52998224725'
    };

    const createOne = async (gateway) => {
        const label = gatewayLabel(gateway);
        const gatewayConfig = payments?.gateways?.[gateway] || {};
        const testKey = `admin-gateway-test-${gateway}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const baseResult = {
            gateway,
            gatewayLabel: label,
            ok: false,
            amount,
            txid: '',
            paymentCode: '',
            paymentCodeBase64: '',
            paymentQrUrl: '',
            statusRaw: '',
            externalId: '',
            detail: ''
        };

        try {
            if (gateway === 'ghostspay') {
                if (!String(gatewayConfig.baseUrl || '').trim() || !String(gatewayConfig.secretKey || gatewayConfig.basicAuthBase64 || '').trim()) {
                    return { ...baseResult, detail: 'Credenciais GhostsPay nao configuradas.' };
                }

                const payload = {
                    customer: {
                        name: baseCustomer.name,
                        email: baseCustomer.email,
                        phone: baseCustomer.phoneDigits,
                        document: {
                            number: baseCustomer.document,
                            type: 'CPF'
                        }
                    },
                    paymentMethod: 'PIX',
                    amount: Math.max(1, Math.round(amount * 100)),
                    items: [
                        {
                            title: 'Teste manual admin',
                            unitPrice: Math.max(1, Math.round(amount * 100)),
                            quantity: 1
                        }
                    ],
                    pix: {
                        expiresInDays: 1
                    },
                    ip: baseIp,
                    description: 'Teste manual de gateway via admin',
                    metadata: {
                        adminTest: true,
                        orderId: testKey
                    }
                };

                let { response, data } = await requestGhostspayCreate(gatewayConfig, payload);
                if (!response?.ok) {
                    return {
                        ...baseResult,
                        detail: data?.error || data?.message || `HTTP ${response?.status || 0}`
                    };
                }
                let parsed = resolveGhostspayCreateResponse(data || {});
                if (parsed.txid && !parsed.paymentCode && !parsed.paymentCodeBase64 && !parsed.paymentQrUrl) {
                    const quickStatus = await requestGhostspayStatus({
                        ...gatewayConfig,
                        timeoutMs: Math.max(1200, Math.min(Number(gatewayConfig.timeoutMs || 12000), 3500))
                    }, parsed.txid).catch(() => ({ response: { ok: false }, data: {} }));
                    if (quickStatus?.response?.ok) {
                        const hydrated = resolveGhostspayCreateResponse(quickStatus.data || {});
                        parsed = {
                            ...parsed,
                            paymentCode: parsed.paymentCode || hydrated.paymentCode,
                            paymentCodeBase64: parsed.paymentCodeBase64 || hydrated.paymentCodeBase64,
                            paymentQrUrl: parsed.paymentQrUrl || hydrated.paymentQrUrl,
                            status: parsed.status || hydrated.status
                        };
                    }
                }

                return {
                    ...baseResult,
                    ok: true,
                    txid: parsed.txid,
                    paymentCode: parsed.paymentCode,
                    paymentCodeBase64: parsed.paymentCodeBase64,
                    paymentQrUrl: parsed.paymentQrUrl,
                    statusRaw: parsed.status || '',
                    externalId: testKey
                };
            }

            if (gateway === 'sunize') {
                if (!String(gatewayConfig.baseUrl || '').trim() || !String(gatewayConfig.apiKey || '').trim() || !String(gatewayConfig.apiSecret || '').trim()) {
                    return { ...baseResult, detail: 'Credenciais Sunize nao configuradas.' };
                }

                const payloadBase = {
                    external_id: testKey,
                    total_amount: Number(amount.toFixed(2)),
                    payment_method: 'PIX',
                    items: [
                        {
                            id: 'admin-gateway-test-1',
                            title: 'Teste manual admin',
                            description: 'Teste manual de gateway via admin',
                            price: Number(amount.toFixed(2)),
                            quantity: 1,
                            is_physical: false
                        }
                    ],
                    ip: baseIp,
                    customer: {
                        name: baseCustomer.name,
                        email: baseCustomer.email,
                        phone: baseCustomer.phoneE164,
                        document_type: 'CPF',
                        document: baseCustomer.document
                    }
                };

                let { response, data } = await requestSunizeCreate(gatewayConfig, payloadBase);
                if ((!response?.ok || data?.hasError === true) && Number(response?.status || 0) === 400) {
                    const noIpPayload = {
                        ...payloadBase
                    };
                    delete noIpPayload.ip;
                    const retry = await requestSunizeCreate(gatewayConfig, noIpPayload);
                    response = retry?.response || response;
                    data = retry?.data || data;
                }
                if (!response?.ok || data?.hasError === true) {
                    return {
                        ...baseResult,
                        detail: data?.error || data?.message || data?.details || `HTTP ${response?.status || 0}`
                    };
                }

                const parsed = resolveSunizeCreateResponse(data || {});
                return {
                    ...baseResult,
                    ok: true,
                    txid: parsed.txid,
                    paymentCode: parsed.paymentCode,
                    paymentCodeBase64: parsed.paymentCodeBase64,
                    paymentQrUrl: parsed.paymentQrUrl,
                    statusRaw: parsed.status || '',
                    externalId: parsed.externalId || testKey
                };
            }

            if (gateway === 'atomopay') {
                const atomopayProduct = resolveAtomopayProductConfig(gatewayConfig, '');
                if (
                    !String(gatewayConfig.baseUrl || '').trim() ||
                    !String(gatewayConfig.apiToken || '').trim() ||
                    !String(atomopayProduct.offerHash || '').trim() ||
                    !String(atomopayProduct.productHash || '').trim()
                ) {
                    return { ...baseResult, detail: 'Credenciais AtomoPay nao configuradas.' };
                }

                const payload = {
                    amount: Math.max(1, Math.round(amount * 100)),
                    offer_hash: atomopayProduct.offerHash,
                    payment_method: 'pix',
                    customer: {
                        name: baseCustomer.name,
                        email: baseCustomer.email,
                        phone_number: baseCustomer.phoneDigits,
                        document: baseCustomer.document
                    },
                    cart: [
                        {
                            product_hash: atomopayProduct.productHash,
                            title: 'Teste manual de gateway via admin',
                            price: Math.max(1, Math.round(amount * 100)),
                            quantity: 1,
                            operation_type: 1,
                            tangible: false
                        }
                    ],
                    expire_in_days: 1,
                    transaction_origin: 'api',
                    tracking: {
                        src: 'admin_gateway_test',
                        utm_source: 'admin_gateway_test',
                        utm_medium: 'dashboard',
                        utm_campaign: testKey
                    }
                };

                let { response, data } = await requestAtomopayCreate(gatewayConfig, payload);
                if (!response?.ok || data?.success === false) {
                    return {
                        ...baseResult,
                        detail: data?.error || data?.message || `HTTP ${response?.status || 0}`
                    };
                }
                let parsed = resolveAtomopayCreateResponse(data || {});
                const createShape = describeAtomopayPayload(data || {});
                let hydratedDebug = null;
                if (parsed.txid && !parsed.paymentCode && !parsed.paymentCodeBase64 && !parsed.paymentQrUrl) {
                    const hydrated = await hydrateAtomopayCreateResponse(gatewayConfig, parsed.txid, 4);
                    hydratedDebug = hydrated.debug || null;
                    parsed = {
                        ...parsed,
                        paymentCode: parsed.paymentCode || hydrated.paymentCode,
                        paymentCodeBase64: parsed.paymentCodeBase64 || hydrated.paymentCodeBase64,
                        paymentQrUrl: parsed.paymentQrUrl || hydrated.paymentQrUrl,
                        status: parsed.status || hydrated.status
                    };
                }
                const missingAtomopayVisual = !parsed.paymentCode && !parsed.paymentCodeBase64 && !parsed.paymentQrUrl;
                if (missingAtomopayVisual) {
                    console.warn('[admin][gateway-test][atomopay] missing pix visual after create', {
                        txid: parsed.txid,
                        statusRaw: parsed.status || '',
                        createShape,
                        hydratedDebug
                    });
                }

                return {
                    ...baseResult,
                    ok: true,
                    txid: parsed.txid,
                    paymentCode: parsed.paymentCode,
                    paymentCodeBase64: parsed.paymentCodeBase64,
                    paymentQrUrl: parsed.paymentQrUrl,
                    statusRaw: parsed.status || '',
                    externalId: '',
                    detail: missingAtomopayVisual
                        ? 'AtomoPay gerou o TXID, mas nao devolveu QR/copia-e-cola. Registrei um resumo sanitizado nos logs do Vercel para depuracao.'
                        : ''
                };
            }

            if (!String(gatewayConfig.baseUrl || '').trim() || !String(gatewayConfig.apiKey || '').trim()) {
                return { ...baseResult, detail: 'Credenciais Paradise nao configuradas.' };
            }

            const payload = {
                amount: Math.max(1, Math.round(amount * 100)),
                description: 'Teste manual de gateway via admin',
                reference: testKey,
                customer: {
                    name: baseCustomer.name,
                    email: baseCustomer.email,
                    document: baseCustomer.document,
                    phone: baseCustomer.phoneDigits
                }
            };
            payload.source = String(gatewayConfig.source || 'api_externa').trim() || 'api_externa';
            if (payload.source !== 'api_externa' && String(gatewayConfig.productHash || '').trim()) {
                payload.productHash = String(gatewayConfig.productHash).trim();
            }

            let { response, data } = await requestParadiseCreate(gatewayConfig, payload);
            if (!response?.ok || data?.success === false || String(data?.status || '').toLowerCase() === 'error') {
                return {
                    ...baseResult,
                    detail: data?.error || data?.message || `HTTP ${response?.status || 0}`
                };
            }
            let parsed = resolveParadiseCreateResponse(data || {});
            if (parsed.txid && !parsed.paymentCode && !parsed.paymentCodeBase64 && !parsed.paymentQrUrl) {
                const quickStatus = await requestParadiseStatus({
                    ...gatewayConfig,
                    timeoutMs: Math.max(1200, Math.min(Number(gatewayConfig.timeoutMs || 12000), 3500))
                }, parsed.txid).catch(() => ({ response: { ok: false }, data: {} }));
                if (quickStatus?.response?.ok) {
                    const hydrated = resolveParadiseCreateResponse(quickStatus.data || {});
                    parsed = {
                        ...parsed,
                        paymentCode: parsed.paymentCode || hydrated.paymentCode,
                        paymentCodeBase64: parsed.paymentCodeBase64 || hydrated.paymentCodeBase64,
                        paymentQrUrl: parsed.paymentQrUrl || hydrated.paymentQrUrl,
                        status: parsed.status || hydrated.status
                    };
                }
            }

            return {
                ...baseResult,
                ok: true,
                txid: parsed.txid,
                paymentCode: parsed.paymentCode,
                paymentCodeBase64: parsed.paymentCodeBase64,
                paymentQrUrl: parsed.paymentQrUrl,
                statusRaw: parsed.status || '',
                externalId: parsed.externalId || testKey
            };
        } catch (error) {
            return {
                ...baseResult,
                detail: error?.message || 'request_error'
            };
        }
    };

    const results = await Promise.all(gateways.map((gateway) => createOne(gateway)));
    res.status(200).json({
        ok: true,
        amount,
        results
    });
}

function classifyReconcileBucket(utmifyStatus = '') {
    const status = String(utmifyStatus || '').trim().toLowerCase();
    if (status === 'paid') return 'confirmed';
    if (status === 'waiting_payment') return 'pending';
    if (status === 'refunded') return 'refunded';
    if (status === 'refused' || status === 'chargedback') return 'refused';
    return 'failed';
}

function reconcileLifecycleRank(eventName) {
    const name = String(eventName || '').trim().toLowerCase();
    if (!name) return 0;
    if (name === 'pix_pending' || name === 'pix_created' || name === 'upsell_pix_created') return 1;
    if (name === 'pix_confirmed' || name === 'upsell_pix_confirmed') return 2;
    if (name === 'pix_refused' || name === 'pix_failed') return 3;
    if (name === 'pix_refunded') return 4;
    return 0;
}

function isReconcileLifecycleRegression(previousEvent, nextEvent) {
    const prevRank = reconcileLifecycleRank(previousEvent);
    const nextRank = reconcileLifecycleRank(nextEvent);
    if (!prevRank || !nextRank) return false;
    return nextRank < prevRank;
}

async function inspectPixTransaction({ txid, rowGateway, sessionHint, payments }) {
    const gateway = rowGateway === 'ghostspay'
        ? 'ghostspay'
        : rowGateway === 'sunize'
            ? 'sunize'
            : rowGateway === 'paradise'
                ? 'paradise'
                : rowGateway === 'atomopay'
                    ? 'atomopay'
                : '';

    if (!gateway) {
        return {
            ok: false,
            txid,
            gateway: rowGateway || 'legacy',
            responseStatus: 0,
            detail: 'unsupported_gateway'
        };
    }

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

    try {
        if (gateway === 'ghostspay') {
            ({ response, data } = await requestGhostspayStatus(payments?.gateways?.ghostspay || {}, txid));
            if (!response?.ok) {
                return {
                    ok: false,
                    txid,
                    gateway,
                    responseStatus: response?.status || 0,
                    detail: data?.error || data?.message || ''
                };
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
                return {
                    ok: false,
                    txid,
                    gateway,
                    responseStatus: response?.status || 0,
                    detail: data?.error || data?.message || ''
                };
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
        } else if (gateway === 'paradise') {
            ({ response, data } = await requestParadiseStatus(payments?.gateways?.paradise || {}, txid));
            if (!response?.ok) {
                return {
                    ok: false,
                    txid,
                    gateway,
                    responseStatus: response?.status || 0,
                    detail: data?.error || data?.message || ''
                };
            }
            status = getParadiseStatus(data);
            utmifyStatus = mapParadiseStatusToUtmify(status);
            isPaid = isParadisePaidStatus(status);
            isRefunded = isParadiseRefundedStatus(status);
            isRefused = isParadiseRefusedStatus(status) || isParadiseChargebackStatus(status);
            isPending = isParadisePendingStatus(status);
            changedAt =
                toIsoDate(getParadiseUpdatedAt(data)) ||
                toIsoDate(data?.timestamp) ||
                toIsoDate(data?.updated_at) ||
                new Date().toISOString();
            sessionIdFallback = String(
                getParadiseExternalId(data) ||
                data?.metadata?.orderId ||
                data?.tracking?.orderId ||
                sessionIdFallback ||
                ''
            ).trim();
            amount = getParadiseAmount(data);
            fee = normalizeAmountPossiblyCents(
                data?.fee ||
                data?.gateway_fee ||
                data?.gatewayFee ||
                data?.data?.fee ||
                data?.data?.gateway_fee ||
                data?.data?.gatewayFee ||
                0
            );
            commission = Math.max(0, Number((amount - fee).toFixed(2)));
        } else if (gateway === 'atomopay') {
            ({ response, data } = await requestAtomopayStatus(payments?.gateways?.atomopay || {}, txid));
            if (!response?.ok) {
                return {
                    ok: false,
                    txid,
                    gateway,
                    responseStatus: response?.status || 0,
                    detail: data?.error || data?.message || ''
                };
            }

            status = getAtomopayStatus(data);
            utmifyStatus = mapAtomopayStatusToUtmify(status);
            isPaid = isAtomopayPaidStatus(status);
            isRefunded = isAtomopayRefundedStatus(status);
            isRefused = isAtomopayRefusedStatus(status) || isAtomopayChargebackStatus(status);
            isPending = isAtomopayPendingStatus(status);
            changedAt =
                toIsoDate(getAtomopayUpdatedAt(data)) ||
                toIsoDate(data?.paid_at) ||
                toIsoDate(data?.data?.paid_at) ||
                new Date().toISOString();
            const tracking = asObject(getAtomopayTracking(data));
            sessionIdFallback = String(
                tracking?.orderId ||
                tracking?.sessionId ||
                tracking?.session_id ||
                sessionIdFallback ||
                ''
            ).trim();
            amount = getAtomopayAmount(data);
            fee = 0;
            commission = amount;
        }
    } catch (_error) {
        return {
            ok: false,
            txid,
            gateway,
            responseStatus: 0,
            detail: 'request_error'
        };
    }

    if (!(isPaid || isRefunded || isRefused || isPending)) {
        return {
            ok: false,
            txid,
            gateway,
            responseStatus: 200,
            detail: `status:${status || 'unknown'}`
        };
    }

    return {
        ok: true,
        txid,
        gateway,
        gatewayLabel: gatewayLabel(gateway),
        statusRaw: status || '',
        utmifyStatus,
        bucket: classifyReconcileBucket(utmifyStatus),
        isPaid,
        isRefunded,
        isRefused,
        isPending,
        changedAt,
        sessionIdFallback,
        amount,
        fee,
        commission,
        transaction: data
    };
}

async function applyPixReconcileEffects(result) {
    const {
        txid,
        gateway,
        statusRaw,
        utmifyStatus,
        isPaid,
        isRefunded,
        isRefused,
        changedAt,
        sessionIdFallback,
        amount,
        fee,
        commission,
        transaction
    } = result || {};

    const lastEvent = isPaid ? 'pix_confirmed' : isRefunded ? 'pix_refunded' : isRefused ? 'pix_refused' : 'pix_pending';
    let lead = await getLeadByPixTxid(txid).catch(() => ({ ok: false, data: null }));
    let leadData = lead?.ok ? lead.data : null;
    if (!leadData && sessionIdFallback) {
        lead = await getLeadBySessionId(sessionIdFallback).catch(() => ({ ok: false, data: null }));
        leadData = lead?.ok ? lead.data : null;
    }
    const previousLastEvent = String(leadData?.last_event || '').trim().toLowerCase();
    if (isReconcileLifecycleRegression(previousLastEvent, lastEvent)) {
        return { ok: true, updatedRows: 0, leadData, skippedRegression: true };
    }

    const payloadPatch = mergeLeadPayload(leadData?.payload, {
        gateway,
        pixGateway: gateway,
        paymentGateway: gateway,
        pixTxid: txid,
        pixStatus: statusRaw || null,
        pixStatusChangedAt: changedAt,
        pixCreatedAt:
            asObject(leadData?.payload).pixCreatedAt ||
            toIsoDate(transaction?.data_registro) ||
            toIsoDate(transaction?.timestamp) ||
            toIsoDate(transaction?.created_at) ||
            toIsoDate(transaction?.createdAt) ||
            toIsoDate(transaction?.updated_at) ||
            toIsoDate(transaction?.data?.created_at) ||
            toIsoDate(transaction?.data?.createdAt) ||
            leadData?.created_at ||
            undefined,
        pixPaidAt: isPaid ? changedAt : undefined,
        pixRefundedAt: isRefunded ? changedAt : undefined,
        pixRefusedAt: isRefused ? changedAt : undefined
    });
    const updateFields = {
        last_event: lastEvent,
        stage: String(leadData?.stage || '').trim() || 'pix',
        payload: payloadPatch
    };
    if (leadData?.updated_at) updateFields.updated_at = leadData.updated_at;

    let up = await updateLeadByPixTxid(txid, updateFields, {
        touchUpdatedAt: false
    }).catch(() => ({ ok: false, count: 0 }));
    if ((!up?.ok || Number(up?.count || 0) === 0) && sessionIdFallback) {
        const bySessionLead = leadData || (await getLeadBySessionId(sessionIdFallback).catch(() => ({ ok: false, data: null })))?.data;
        const bySessionPayload = mergeLeadPayload(bySessionLead?.payload, payloadPatch);
        const bySessionFields = {
            last_event: lastEvent,
            stage: String(bySessionLead?.stage || '').trim() || 'pix',
            payload: bySessionPayload
        };
        if (bySessionLead?.updated_at) bySessionFields.updated_at = bySessionLead.updated_at;
        const bySession = await updateLeadBySessionId(sessionIdFallback, bySessionFields, {
            touchUpdatedAt: false
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
    if (changedRows <= 0) {
        return { ok: true, updatedRows: 0, leadData };
    }

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
        payload: transaction,
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

    if (!isPaid) {
        return { ok: true, updatedRows: changedRows, leadData };
    }

    const pushKind = isUpsell ? 'upsell_pix_confirmed' : 'pix_confirmed';
    await enqueueDispatch({
        channel: 'pushcut',
        kind: pushKind,
        dedupeKey: `pushcut:pix_confirmed:${gateway}:${txid}`,
        payload: {
            txid,
            orderId: txid || leadData?.session_id || sessionIdFallback || '',
            gateway,
            status: statusRaw,
            amount,
            customerName: leadData?.name || '',
            customerEmail: leadData?.email || '',
            cep: leadData?.cep || '',
            shippingName: leadData?.shipping_name || '',
            utm: {
                utm_source: leadData?.utm_source || leadUtm?.utm_source || leadUtm?.src || '',
                utm_medium: leadData?.utm_medium || leadUtm?.utm_medium || '',
                utm_campaign: leadData?.utm_campaign || leadUtm?.utm_campaign || leadUtm?.campaign || leadUtm?.sck || '',
                utm_term: leadData?.utm_term || leadUtm?.utm_term || leadUtm?.term || '',
                utm_content: (
                    leadData?.utm_content ||
                    leadUtm?.utm_content ||
                    leadUtm?.utm_adset ||
                    leadUtm?.adset ||
                    leadUtm?.content ||
                    ''
                )
            },
            source: leadData?.utm_source || leadUtm?.utm_source || leadUtm?.src || '',
            campaign: leadData?.utm_campaign || leadUtm?.utm_campaign || leadUtm?.campaign || leadUtm?.sck || '',
            adset: (
                leadData?.utm_content ||
                leadUtm?.utm_content ||
                leadUtm?.utm_adset ||
                leadUtm?.adset ||
                leadUtm?.content ||
                ''
            ),
            isUpsell
        }
    }).catch(() => null);
    await processDispatchQueue(8).catch(() => null);

    return { ok: true, updatedRows: changedRows, leadData };
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

    let body = {};
    try {
        body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    } catch (_error) {
        res.status(400).json({ error: 'JSON invalido.' });
        return;
    }

    const settingsData = await getSettings().catch(() => ({}));
    const payments = buildPaymentsConfig(settingsData?.payments || {});
    const maxTx = clamp(firstQueryValue(req.query?.maxTx) || body.maxTx || 100, 1, 1000);
    const concurrency = clamp(firstQueryValue(req.query?.concurrency) || body.concurrency || 6, 1, 12);
    const pageSize = clamp(firstQueryValue(req.query?.pageSize) || body.pageSize || 250, 50, 1000);
    const scanRows = clamp(firstQueryValue(req.query?.scanRows) || body.scanRows || Math.max(maxTx * 10, 1000), maxTx, 20000);
    const includeConfirmed = String(firstQueryValue(req.query?.includeConfirmed) || body.includeConfirmed || '1') !== '0';
    const mutate = String(firstQueryValue(req.query?.mutate) || body.mutate || '0') === '1';
    const requestedTxid = String(firstQueryValue(req.query?.txid) || body.txid || '').trim();
    const requestedSessionId = String(firstQueryValue(req.query?.sessionId) || body.sessionId || '').trim();
    let requestedGateway = String(firstQueryValue(req.query?.gateway) || body.gateway || '').trim().toLowerCase();

    const isSingle = Boolean(requestedTxid);
    let txidList = { ok: true, entries: [], scannedRows: 0 };
    if (!isSingle) {
        txidList = await listLeadTxidsForReconcile({ maxTx, pageSize, scanRows, includeConfirmed });
        if (!txidList.ok) {
            res.status(502).json({
                error: 'Falha ao buscar txids no banco.',
                detail: txidList.detail || ''
            });
            return;
        }
    } else if (!requestedGateway) {
        const lead = await getLeadByPixTxid(requestedTxid).catch(() => ({ ok: false, data: null }));
        const payload = asObject(lead?.data?.payload);
        requestedGateway = resolveLeadGateway(lead?.data, payload);
    }

    const candidates = isSingle
        ? [{
            txid: requestedTxid,
            gateway: requestedGateway,
            sessionId: requestedSessionId
        }]
        : (txidList.entries || []);

    let checked = 0;
    let confirmed = 0;
    let pending = 0;
    let refunded = 0;
    let refused = 0;
    let failed = 0;
    let updated = 0;
    const failedDetails = [];
    const items = [];
    const gatewaySummary = {
        ghostspay: { checked: 0, confirmed: 0, pending: 0, refunded: 0, refused: 0, failed: 0 },
        sunize: { checked: 0, confirmed: 0, pending: 0, refunded: 0, refused: 0, failed: 0 },
        paradise: { checked: 0, confirmed: 0, pending: 0, refunded: 0, refused: 0, failed: 0 },
        atomopay: { checked: 0, confirmed: 0, pending: 0, refunded: 0, refused: 0, failed: 0 }
    };

    const runOne = async ({ txid, gateway: rowGateway, sessionId: sessionHint }) => {
        const gateway = rowGateway === 'ghostspay'
            ? 'ghostspay'
            : rowGateway === 'sunize'
                ? 'sunize'
                : rowGateway === 'paradise'
                    ? 'paradise'
                    : rowGateway === 'atomopay'
                        ? 'atomopay'
                    : '';
        checked += 1;
        if (gatewaySummary[gateway]) gatewaySummary[gateway].checked += 1;
        const result = await inspectPixTransaction({
            txid,
            rowGateway: gateway,
            sessionHint,
            payments
        });
        if (!result?.ok) {
            failed += 1;
            if (gatewaySummary[gateway]) gatewaySummary[gateway].failed += 1;
            if (failedDetails.length < 8) {
                failedDetails.push({
                    txid,
                    gateway: gateway || rowGateway || 'legacy',
                    status: result?.responseStatus || 0,
                    detail: result?.detail || 'request_error'
                });
            }
            if (isSingle) items.push({ txid, gateway: gateway || rowGateway || 'legacy', ok: false, statusCode: result?.responseStatus || 0, detail: result?.detail || 'request_error' });
            return;
        }

        if (result.bucket === 'confirmed') {
            confirmed += 1;
            gatewaySummary[gateway].confirmed += 1;
        } else if (result.bucket === 'pending') {
            pending += 1;
            gatewaySummary[gateway].pending += 1;
        } else if (result.bucket === 'refunded') {
            refunded += 1;
            gatewaySummary[gateway].refunded += 1;
        } else if (result.bucket === 'refused') {
            refused += 1;
            gatewaySummary[gateway].refused += 1;
        } else {
            failed += 1;
            gatewaySummary[gateway].failed += 1;
        }

        let updatedRows = 0;
        let skippedRegression = false;
        if (mutate) {
            const syncResult = await applyPixReconcileEffects(result).catch(() => ({ ok: false, updatedRows: 0 }));
            updatedRows = Number(syncResult?.updatedRows || 0);
            skippedRegression = syncResult?.skippedRegression === true;
            updated += updatedRows;
        }

        if (isSingle) {
            items.push({
                ...result,
                updatedRows,
                skippedRegression
            });
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
        refunded,
        refused,
        failed,
        warning: null,
        includeConfirmed,
        mutate,
        updated,
        gatewaySummary,
        failedDetails,
        item: isSingle ? (items[0] || null) : null
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

    if (route.startsWith('leads/') && route !== 'leads/export') {
        const sessionId = route.slice('leads/'.length);
        return getLeadDetail(req, res, sessionId);
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
        case 'leads/export':
            return exportLeads(req, res);
        case 'ip-blacklist':
            return ipBlacklist(req, res);
        case 'pages':
            return getPages(req, res);
        case 'backredirects':
            return getBackredirects(req, res);
        case 'sales-insights':
            return getSalesInsights(req, res);
        case 'utmfy-test':
            return utmfyTest(req, res);
        case 'utmfy-sale':
            return utmfySale(req, res);
        case 'pushcut-test':
            return pushcutTest(req, res);
        case 'gateway-test-pix':
            return gatewayTestPix(req, res);
        case 'pix-reconcile':
            return pixReconcile(req, res);
        case 'dispatch-process':
            return processQueue(req, res);
        default:
            res.status(404).json({ error: 'Not found' });
            return;
    }
};
