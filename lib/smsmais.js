const fetchFn = (...args) => global.fetch
    ? global.fetch(...args)
    : import('node-fetch').then(({ default: fetch }) => fetch(...args));

const { getSettings, defaultSettings } = require('./settings-store');

const DEFAULT_SMS_ENDPOINT = 'https://smsmais.com/api/enviar_sms.php';
const DEFAULT_BATCH_ENDPOINT = 'https://smsmais.com/send';
const DEFAULT_STATUS_ENDPOINT = 'https://smsmais.com/status';
const DEFAULT_BALANCE_ENDPOINT = 'https://smsmais.com/saldo';

function normalizeBrazilPhone(value = '') {
    let digits = String(value || '').replace(/\D/g, '');
    if (digits.startsWith('0')) digits = digits.replace(/^0+/, '');
    if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
    if (!/^55\d{10,11}$/.test(digits)) return '';
    return digits;
}

function normalizeEndpoint(value, fallback) {
    const raw = String(value || fallback || '').trim();
    try {
        const parsed = new URL(raw);
        const host = String(parsed.hostname || '').toLowerCase();
        const trustedHost = host === 'smsmais.com' || host.endsWith('.smsmais.com') || host.endsWith('.smsmais.com.br');
        if (parsed.protocol !== 'https:' || !trustedHost) return '';
        return parsed.toString();
    } catch (_error) {
        return '';
    }
}

function normalizeExternalId(value = '') {
    return String(value || '')
        .trim()
        .replace(/[^a-zA-Z0-9_.:-]/g, '-')
        .slice(0, 120) || `ifb-${Date.now()}`;
}

function normalizeText(value = '', maxLength = 480) {
    return String(value || '')
        .replace(/[\r\n]+/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
        .slice(0, maxLength);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
    const controller = new AbortController();
    const timeoutRef = setTimeout(() => controller.abort(), Math.max(1500, Number(timeoutMs) || 12000));
    try {
        return await fetchFn(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timeoutRef);
    }
}

async function readResponse(response) {
    const raw = await response.text().catch(() => '');
    if (!raw) return {};
    try {
        return JSON.parse(raw);
    } catch (_error) {
        return { raw };
    }
}

function publicResult(data = {}) {
    if (Array.isArray(data)) {
        return data.map((item) => publicResult(item));
    }
    const source = data && typeof data === 'object' ? data : {};
    return {
        id: source.id ?? source.message_id ?? null,
        campaignId: source.campanha_id ?? source.campaign_id ?? null,
        externalId: source.externalId ?? source.externalid ?? source.ext_id ?? null,
        status: String(source.status || source.delivery || source.entrega || '').trim() || null,
        success: source.sucesso !== false && source.success !== false
    };
}

async function resolveConfig(configOverride) {
    if (configOverride && typeof configOverride === 'object') return configOverride;
    const settings = await getSettings().catch(() => defaultSettings);
    return settings?.smsmais || defaultSettings.smsmais || {};
}

function validateCommon(config, phone) {
    if (config?.enabled === false) return { ok: false, reason: 'disabled' };
    const token = String(config?.token || '').trim();
    if (!token) return { ok: false, reason: 'missing_token' };
    const to = normalizeBrazilPhone(phone);
    if (!to) return { ok: false, reason: 'invalid_phone' };
    return { ok: true, token, to };
}

async function sendSmsMaisSms(payload = {}, configOverride = null) {
    const config = await resolveConfig(configOverride);
    const common = validateCommon(config, payload.to || payload.phone || payload.dest);
    if (!common.ok) return common;

    const endpoint = normalizeEndpoint(config.endpoint, DEFAULT_SMS_ENDPOINT);
    if (!endpoint) return { ok: false, reason: 'invalid_endpoint' };
    const message = normalizeText(payload.message || payload.text || config.testMessage, 160);
    if (!message) return { ok: false, reason: 'missing_message' };

    const extId = normalizeExternalId(payload.externalId || payload.ext_id || payload.id);
    const body = {
        to: common.to,
        message,
        tipo: 'sms',
        ext_id: extId
    };

    try {
        const response = await fetchWithTimeout(endpoint, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${common.token}`,
                'Content-Type': 'application/json',
                Accept: 'application/json'
            },
            body: JSON.stringify(body)
        }, config.timeoutMs);
        const data = await readResponse(response);
        const status = String(data?.status || '').trim().toLowerCase();
        const accepted = response.ok && data?.sucesso !== false && data?.success !== false;
        if (!accepted) {
            return {
                ok: false,
                reason: status || `smsmais_http_${response.status}`,
                statusCode: response.status,
                result: publicResult(data)
            };
        }
        return {
            ok: true,
            held: status === 'held_no_balance',
            channel: 'sms',
            to: common.to,
            externalId: extId,
            result: publicResult(data)
        };
    } catch (error) {
        return {
            ok: false,
            reason: error?.name === 'AbortError' ? 'timeout' : 'request_error',
            detail: error?.message || String(error)
        };
    }
}

async function sendSmsMaisVoice(payload = {}, configOverride = null) {
    const config = await resolveConfig(configOverride);
    const common = validateCommon(config, payload.to || payload.phone || payload.dest);
    if (!common.ok) return common;

    const endpoint = normalizeEndpoint(config.batchEndpoint, DEFAULT_BATCH_ENDPOINT);
    if (!endpoint) return { ok: false, reason: 'invalid_batch_endpoint' };
    const audio = String(payload.audio || payload.audioUrl || config.voiceAudioUrl || '').trim();
    try {
        const audioUrl = new URL(audio);
        if (audioUrl.protocol !== 'https:' && audioUrl.protocol !== 'http:') {
            return { ok: false, reason: 'invalid_audio_url' };
        }
    } catch (_error) {
        return { ok: false, reason: 'invalid_audio_url' };
    }

    const message = normalizeText(payload.message || payload.text || config.voiceMessage || 'Torpedo de voz', 160);
    const extId = normalizeExternalId(payload.externalId || payload.ext_id || payload.id);
    const item = {
        id: extId,
        destinations: [{ to: common.to }],
        msg: message,
        audio
    };
    const schedule = String(payload.schedule || '').trim();
    if (schedule) item.schedule = schedule;

    try {
        const response = await fetchWithTimeout(endpoint, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${common.token}`,
                'Content-Type': 'application/json',
                Accept: 'application/json'
            },
            body: JSON.stringify({ messages: [item] })
        }, config.timeoutMs);
        const data = await readResponse(response);
        const rejected = data?.sucesso === false || data?.success === false;
        if (!response.ok || rejected) {
            return {
                ok: false,
                reason: `smsmais_http_${response.status}`,
                statusCode: response.status,
                result: publicResult(data)
            };
        }
        return {
            ok: true,
            channel: 'voice',
            to: common.to,
            externalId: extId,
            result: publicResult(data)
        };
    } catch (error) {
        return {
            ok: false,
            reason: error?.name === 'AbortError' ? 'timeout' : 'request_error',
            detail: error?.message || String(error)
        };
    }
}

async function authenticatedGet(endpoint, config, params = {}) {
    const token = String(config?.token || '').trim();
    if (!token) return { ok: false, reason: 'missing_token' };
    const url = normalizeEndpoint(endpoint, '');
    if (!url) return { ok: false, reason: 'invalid_endpoint' };
    const requestUrl = new URL(url);
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && String(value).trim()) {
            requestUrl.searchParams.set(key, String(value).trim());
        }
    });
    try {
        const response = await fetchWithTimeout(requestUrl.toString(), {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/json'
            }
        }, config.timeoutMs);
        const data = await readResponse(response);
        if (!response.ok || data?.success === false || data?.sucesso === false) {
            return { ok: false, reason: `smsmais_http_${response.status}`, statusCode: response.status };
        }
        return { ok: true, data };
    } catch (error) {
        return {
            ok: false,
            reason: error?.name === 'AbortError' ? 'timeout' : 'request_error',
            detail: error?.message || String(error)
        };
    }
}

async function getSmsMaisBalance(configOverride = null) {
    const config = await resolveConfig(configOverride);
    return authenticatedGet(config.balanceEndpoint || DEFAULT_BALANCE_ENDPOINT, config);
}

async function getSmsMaisStatus({ externalId = '', uid = '' } = {}, configOverride = null) {
    const config = await resolveConfig(configOverride);
    if (!String(externalId || '').trim() && !String(uid || '').trim()) {
        return { ok: false, reason: 'missing_message_id' };
    }
    return authenticatedGet(config.statusEndpoint || DEFAULT_STATUS_ENDPOINT, config, {
        ext_id: externalId,
        uid
    });
}

async function dispatchSmsMaisJob(kind, payload = {}) {
    const normalizedKind = String(kind || payload.kind || '').trim().toLowerCase();
    if (normalizedKind === 'voice' || normalizedKind === 'torpedo_voz' || normalizedKind === 'torpedo-voz') {
        return sendSmsMaisVoice(payload);
    }
    return sendSmsMaisSms(payload);
}

module.exports = {
    DEFAULT_SMS_ENDPOINT,
    DEFAULT_BATCH_ENDPOINT,
    DEFAULT_STATUS_ENDPOINT,
    DEFAULT_BALANCE_ENDPOINT,
    normalizeBrazilPhone,
    normalizeEndpoint,
    sendSmsMaisSms,
    sendSmsMaisVoice,
    getSmsMaisBalance,
    getSmsMaisStatus,
    dispatchSmsMaisJob
};
