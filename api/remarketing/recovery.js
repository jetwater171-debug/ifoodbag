const { ensurePublicAccess } = require('../../lib/public-access');
const { getLeadBySessionId } = require('../../lib/lead-store');
const { issueRecoveryToken, verifyRecoveryToken, issueRecoveryProof } = require('../../lib/remarketing-token');
const {
    resolveRecoveryOfferForGrant,
    resolveRecoverySessionGrant,
    buildRecoveryCreateBody,
    toPublicRecoveryOffer
} = require('../../lib/remarketing-recovery');
const pixStatusHandler = require('../pix/status');
const pixCreateHandler = require('../pix/create');

function firstQueryValue(value) {
    return Array.isArray(value) ? value[0] : value;
}

function readToken(req) {
    return String(firstQueryValue(req?.query?.token) || req?.body?.token || '').trim();
}

function readSessionId(req) {
    return String(
        firstQueryValue(req?.query?.sessionId) ||
        firstQueryValue(req?.query?.session_id) ||
        req?.body?.sessionId ||
        req?.body?.session_id ||
        ''
    ).trim();
}

async function invokeHandler(handler, req, body) {
    let responseBody = null;
    const headers = {};
    const innerRes = {
        statusCode: 200,
        headersSent: false,
        setHeader(name, value) {
            headers[String(name || '').toLowerCase()] = value;
            return this;
        },
        getHeader(name) {
            return headers[String(name || '').toLowerCase()];
        },
        status(code) {
            this.statusCode = Number(code || 200);
            return this;
        },
        json(value) {
            responseBody = value;
            this.headersSent = true;
            return this;
        },
        send(value) {
            responseBody = value;
            this.headersSent = true;
            return this;
        },
        end(value) {
            responseBody = value;
            this.headersSent = true;
            return this;
        }
    };
    const innerReq = {
        ...req,
        method: 'POST',
        body,
        query: {},
        headers: { ...(req?.headers || {}) }
    };
    await handler(innerReq, innerRes);
    return {
        statusCode: Number(innerRes.statusCode || 200),
        body: responseBody,
        headers
    };
}

async function loadRecoveryLead(grant) {
    const result = await getLeadBySessionId(grant?.sessionId).catch(() => ({ ok: false, data: null }));
    if (!result?.ok || !result?.data) return null;
    return result.data;
}

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'GET' && req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    if (!await ensurePublicAccess(req, res, { requireSession: true })) return;

    const token = readToken(req);
    const requestedSessionId = readSessionId(req);
    const usesMountedLink = Boolean(token);
    let grant = usesMountedLink
        ? verifyRecoveryToken(token)
        : (requestedSessionId ? { sessionId: requestedSessionId } : null);
    if (!grant) {
        res.status(401).json({ error: 'Link de recuperacao invalido ou expirado.', code: 'invalid_recovery_link' });
        return;
    }

    let lead = await loadRecoveryLead(grant);
    if (!lead) {
        res.status(404).json({ error: 'Pedido nao encontrado.', code: 'recovery_not_found' });
        return;
    }

    if (!usesMountedLink) {
        grant = resolveRecoverySessionGrant(lead, requestedSessionId);
    }
    let offer = grant ? resolveRecoveryOfferForGrant(lead, grant) : null;
    if (!offer) {
        res.status(409).json({ error: 'Este link nao corresponde mais ao pagamento atual.', code: 'recovery_offer_changed' });
        return;
    }

    if (req.method === 'GET') {
        res.status(200).json({ ok: true, offer: toPublicRecoveryOffer(offer) });
        return;
    }

    if (offer.paid) {
        res.status(409).json({ error: 'Este pagamento ja foi confirmado.', code: 'already_paid', offer: toPublicRecoveryOffer(offer) });
        return;
    }
    if (!offer.canRecover) {
        res.status(409).json({ error: 'Nao existe pagamento pendente para recuperar.', code: 'no_pending_payment' });
        return;
    }

    const statusResult = await invokeHandler(pixStatusHandler, req, {
        txid: offer.txid,
        sessionId: offer.sessionId,
        gateway: offer.gateway
    });
    if (statusResult.statusCode >= 400 || statusResult?.body?.ok === false) {
        res.status(503).json({
            error: 'Nao foi possivel confirmar o status do pagamento agora. Tente novamente em instantes.',
            code: 'status_check_failed'
        });
        return;
    }
    if (String(statusResult?.body?.status || '').toLowerCase() === 'paid') {
        res.status(409).json({ error: 'Este pagamento ja foi confirmado.', code: 'already_paid' });
        return;
    }

    lead = await loadRecoveryLead(grant);
    if (!usesMountedLink) {
        grant = resolveRecoverySessionGrant(lead || {}, requestedSessionId);
    }
    offer = resolveRecoveryOfferForGrant(lead || {}, grant);
    if (!offer) {
        res.status(409).json({
            error: 'Este link nao corresponde mais ao pagamento atual.',
            code: 'recovery_offer_changed'
        });
        return;
    }
    if (offer.paid) {
        res.status(409).json({ error: 'Este pagamento ja foi confirmado.', code: 'already_paid' });
        return;
    }
    if (!offer.canRecover) {
        res.status(409).json({ error: 'Nao existe pagamento pendente para recuperar.', code: 'no_pending_payment' });
        return;
    }

    let recoveryToken = token;
    if (!recoveryToken) {
        try {
            recoveryToken = issueRecoveryToken(grant);
        } catch (_error) {
            res.status(503).json({
                error: 'Nao foi possivel preparar a recuperacao deste pedido.',
                code: 'recovery_authorization_unavailable'
            });
            return;
        }
    }
    const createBody = buildRecoveryCreateBody(
        lead,
        offer,
        recoveryToken,
        issueRecoveryProof(recoveryToken)
    );
    const createResult = await invokeHandler(pixCreateHandler, req, createBody);
    if (createResult.statusCode >= 400 || !createResult?.body?.idTransaction) {
        res.status(createResult.statusCode >= 400 ? createResult.statusCode : 502).json({
            error: createResult?.body?.error || 'Nao foi possivel gerar o novo Pix.',
            code: 'recovery_pix_create_failed'
        });
        return;
    }

    res.status(200).json({
        ok: true,
        offer: toPublicRecoveryOffer(offer),
        pix: {
            idTransaction: String(createResult.body.idTransaction || '').trim(),
            paymentCode: String(createResult.body.paymentCode || '').trim(),
            paymentCodeBase64: String(createResult.body.paymentCodeBase64 || '').trim(),
            paymentQrUrl: String(createResult.body.paymentQrUrl || '').trim(),
            amount: Number(createResult.body.amount || offer.discountedAmount),
            status: String(createResult.body.status || 'waiting_payment').trim(),
            gateway: String(createResult.body.gateway || offer.gateway || '').trim(),
            rewardId: String(createResult.body.rewardId || offer.rewardId || 'bag').trim(),
            rewardName: String(createResult.body.rewardName || offer.rewardName || offer.offerName || 'Pedido selecionado').trim()
        }
    });
};
