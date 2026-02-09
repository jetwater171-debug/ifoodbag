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
    pixelConfig: 'ifoodbag.pixelConfig'
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
    toastTimeout: null
};

const dom = {};
const pathMemo = {};

document.addEventListener('DOMContentLoaded', () => {
    cacheCommonDom();
    captureUtmParams();
    ensureApiSession().catch(() => null);
    initMarketing().catch(() => null);
    initStockCounter();

    const page = document.body.dataset.page || '';
    if (page && page !== 'admin') {
        trackPageView(page);
    }
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
        case 'admin':
            initAdmin();
            break;
        default:
            break;
    }
});

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
    if (!requirePersonal()) return;
    if (!requireAddress()) return;

    setStage('checkout');
    trackLead('checkout_view', { stage: 'checkout' });
    const personal = loadPersonal();
    let address = loadAddress();
    let shipping = loadShipping();

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
        checkoutCep.addEventListener('input', () => maskCep(checkoutCep));
    }

    let cepLookupTimer = null;
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
    let cachedSelectedId = 'padrao';

    const isExtraValid = () => {
        const numberOk = !!(noNumber?.checked || (addrNumber?.value || '').trim().length);
        const complementOk = !!(noComplement?.checked || (addrComplement?.value || '').trim().length);
        return numberOk && complementOk;
    };

    const renderOptions = (options, selectedId) => {
        if (!freightOptions) return;
        freightOptions.innerHTML = '';
        options.forEach((opt) => {
            const label = document.createElement('label');
            label.className = 'freight-option';
            if (opt.id === selectedId) label.classList.add('freight-option--active');
            label.innerHTML = `
                <input type="radio" name="shipping" value="${opt.id}" ${opt.id === selectedId ? 'checked' : ''}>
                <div class="freight-option__main">
                    <div class="freight-option__title">${opt.name}</div>
                    <div class="freight-option__eta">${opt.eta}</div>
                </div>
                <div class="freight-option__price">${formatCurrency(opt.price)}</div>
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

    const selectShipping = (opt, options) => {
        saveShipping(opt);
        cachedSelectedId = opt.id;
        shipping = opt;
        trackLead('frete_selected', { stage: 'checkout', shipping: opt });
        if (shippingTotal) {
            shippingTotal.querySelector('strong').textContent = formatCurrency(opt.price);
            setHidden(shippingTotal, false);
        }
        if (btnFinish) {
            btnFinish.classList.remove('hidden');
        }
        const labels = freightOptions?.querySelectorAll('.freight-option') || [];
        labels.forEach((label) => {
            label.classList.toggle('freight-option--active', label.querySelector('input')?.value === opt.id);
        });
    };

    const clearShippingSelection = () => {
        localStorage.removeItem(STORAGE_KEYS.shipping);
        cachedSelectedId = 'padrao';
        if (freightOptions) freightOptions.innerHTML = '';
        setHidden(freightOptions, true);
        setHidden(freightHint, true);
        setHidden(shippingTotal, true);
        if (btnFinish) btnFinish.classList.add('hidden');
    };

    const calcShipping = () => {
        const rawCep = (checkoutCep?.value || '').replace(/\D/g, '');
        if (rawCep.length !== 8) {
            showToast('Digite um CEP válido para calcular o frete.', 'error');
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
        if (btnFinish) btnFinish.classList.add('hidden');

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
                setHidden(summaryBlock, true);
                if (btnCalcFreight) btnCalcFreight.classList.add('hidden');
                setHidden(freightForm, false);
                hydrateExtraAddress();
                bindExtraAddress();

                const options = buildShippingOptions(rawCep);
                cachedOptions = options;
                cachedSelectedId = 'padrao';
                if (freightOptions) freightOptions.innerHTML = '';

                const elapsed = Date.now() - startTime;
                const remaining = Math.max(0, minDelay - elapsed);
                setTimeout(() => {
                    setHidden(freightLoading, true);
                    setHidden(freightLoading, true);
                    if (btnCalcFreight) {
                        btnCalcFreight.disabled = false;
                    }
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
                }, remaining);
            });
    };

    btnCalcFreight?.addEventListener('click', calcShipping);

    btnVerifyFreight?.addEventListener('click', () => {
        setHidden(freightForm, true);
        setHidden(summaryBlock, false);
        showFreightSelection();
        trackLead('frete_options_shown', { stage: 'checkout' });
        if (cachedOptions) {
            const defaultOpt = cachedOptions.find((opt) => opt.id === 'padrao');
            if (defaultOpt) selectShipping(defaultOpt, cachedOptions);
        }
    });

    if (shipping && freightOptions) {
        cachedOptions = buildShippingOptions((checkoutCep?.value || '').replace(/\D/g, ''));
        cachedSelectedId = shipping.id;
        setHidden(summaryBlock, false);
        setHidden(freightForm, true);
        showFreightSelection();
        if (shippingTotal) {
            shippingTotal.querySelector('strong').textContent = formatCurrency(shipping.price);
            setHidden(shippingTotal, false);
        }
        if (btnFinish) btnFinish.classList.remove('hidden');
    }

    if (!shipping) {
        hydrateExtraAddress();
        bindExtraAddress();
    }

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

        if (storedShipping && freightOptions) {
            cachedOptions = buildShippingOptions((storedAddress.cep || '').replace(/\D/g, ''));
            cachedSelectedId = storedShipping.id;
            setHidden(freightForm, true);
            setHidden(summaryBlock, false);
            showFreightSelection();
            if (shippingTotal) {
                shippingTotal.querySelector('strong').textContent = formatCurrency(storedShipping.price);
                setHidden(shippingTotal, false);
            }
            if (btnFinish) btnFinish.classList.remove('hidden');
            if (btnCalcFreight) btnCalcFreight.classList.add('hidden');
            return;
        }

        setHidden(summaryBlock, false);
        setHidden(freightForm, true);
        if (cachedOptions) {
            const defaultOpt = cachedOptions.find((opt) => opt.id === 'padrao');
            if (defaultOpt) selectShipping(defaultOpt, cachedOptions);
            showFreightSelection();
        }
        if (btnCalcFreight) btnCalcFreight.classList.add('hidden');
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
            return;
        }
        trackLead('checkout_submit', { stage: 'checkout', shipping });
        btnFinish.disabled = true;
        isOrderBumpEnabled()
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
                    btnFinish.disabled = false;
                });
            })
            .catch(() => {
                setStage('orderbump');
                redirect('orderbump.html');
            });
    });
}

function initOrderBump() {
    if (!requirePersonal()) return;
    if (!requireAddress()) return;

    const shipping = loadShipping();
    if (!shipping) {
        setStage('checkout');
        redirect('checkout.html');
        return;
    }

    setStage('orderbump');
    trackLead('orderbump_view', { stage: 'orderbump', shipping });
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

function initPix() {
    const pix = loadPix();
    const shipping = loadShipping();
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

    if (pixQr && pix.paymentCodeBase64) {
        const base64 = pix.paymentCodeBase64;
        pixQr.src = base64.startsWith('data:image') ? base64 : `data:image/png;base64,${base64}`;
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
    btnCopyIcon?.addEventListener('click', () => handleCopy(btnCopy));

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
    const pixelEventLead = document.getElementById('pixel-event-lead');
    const pixelEventPurchase = document.getElementById('pixel-event-purchase');

    const utmfyEnabled = document.getElementById('utmfy-enabled');
    const utmfyEndpoint = document.getElementById('utmfy-endpoint');
    const utmfyApi = document.getElementById('utmfy-api');

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
    const funnelPix = document.getElementById('funnel-pix');
    const funnelFrete = document.getElementById('funnel-frete');
    const funnelCep = document.getElementById('funnel-cep');
    const funnelPixValue = document.getElementById('funnel-pix-value');
    const funnelFreteValue = document.getElementById('funnel-frete-value');
    const funnelCepValue = document.getElementById('funnel-cep-value');
    const navItems = document.querySelectorAll('.admin-nav-item');
    const pagesGrid = document.getElementById('pages-grid');
    const pagesInsights = document.getElementById('pages-insights');
    const adminPage = document.body.getAttribute('data-admin') || '';
    const testPixelBtn = document.getElementById('admin-test-pixel');
    const testPixelStatus = document.getElementById('admin-test-pixel-status');
    const testUtmfyBtn = document.getElementById('admin-test-utmfy');
    const testUtmfyStatus = document.getElementById('admin-test-utmfy-status');
    const saleUtmfyBtn = document.getElementById('admin-sale-utmfy');
    const saleUtmfyStatus = document.getElementById('admin-sale-utmfy-status');
    const featureOrderbump = document.getElementById('feature-orderbump');

    let offset = 0;
    const limit = 50;
    let loadingLeads = false;
    const metrics = {
        total: 0,
        pix: 0,
        frete: 0,
        cep: 0,
        lastUpdated: ''
    };
    let currentSettings = null;

    const hasPixelForm = !!(pixelEnabled || pixelId || pixelEventPage || pixelEventLead || pixelEventPurchase);
    const hasUtmfyForm = !!(utmfyEnabled || utmfyEndpoint || utmfyApi);
    const hasFeatureForm = !!featureOrderbump;
    const wantsLeads = !!(leadsBody || metricTotal || metricPix || metricFrete || metricCep);
    const wantsPages = !!pagesGrid;

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
            if (pixelEventLead) pixelEventLead.checked = data.pixel?.events?.lead !== false;
            if (pixelEventPurchase) pixelEventPurchase.checked = data.pixel?.events?.purchase !== false;
        }

        if (hasUtmfyForm) {
            if (utmfyEnabled) utmfyEnabled.checked = !!data.utmfy?.enabled;
            if (utmfyEndpoint) utmfyEndpoint.value = data.utmfy?.endpoint || '';
            if (utmfyApi) utmfyApi.value = data.utmfy?.apiKey || '';
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
                    lead: pixelEventLead?.checked !== false,
                    purchase: pixelEventPurchase?.checked !== false
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

    const renderLeads = (rows, append = false) => {
        if (!leadsBody) return;
        if (!append) leadsBody.innerHTML = '';

        rows.forEach((row) => {
            const tr = document.createElement('tr');
            const isPaid = String(row.evento || '') === 'pix_confirmed';
            const statusLabel = isPaid ? 'pagamento_confirmado' : (row.status_funil || '-');
            tr.innerHTML = `
                <td>${row.nome || '-'}</td>
                <td>${row.email || '-'}</td>
                <td>${row.telefone || '-'}</td>
                <td>${row.utm_source || '-'}</td>
                <td>${row.etapa || '-'}</td>
                <td><span class="status-pill ${isPaid ? 'status-pill--paid' : 'status-pill--neutral'}">${statusLabel}</span></td>
                <td>${row.frete || '-'}</td>
                <td>${row.valor_total ? formatCurrency(row.valor_total) : '-'}</td>
                <td>${row.updated_at ? new Date(row.updated_at).toLocaleString('pt-BR') : '-'}</td>
            `;
            leadsBody.appendChild(tr);
        });

        if (leadsCount) leadsCount.textContent = String(offset + rows.length);
    };

    const updateMetrics = (rows, reset = false) => {
        if (reset) {
            metrics.total = 0;
            metrics.pix = 0;
            metrics.frete = 0;
            metrics.cep = 0;
            metrics.lastUpdated = '';
        }

        metrics.total += rows.length;
        rows.forEach((row) => {
            const cep = String(row.cep || '').trim();
            const frete = String(row.frete || '').trim();
            const pixTxid = String(row.pix_txid || '').trim();

            if (pixTxid && pixTxid !== '-') metrics.pix += 1;
            if (frete && frete !== '-') metrics.frete += 1;
            if (cep && cep !== '-') metrics.cep += 1;
            if (!metrics.lastUpdated && row.updated_at) metrics.lastUpdated = row.updated_at;
        });

        if (metricTotal) metricTotal.textContent = String(metrics.total);
        if (metricPix) metricPix.textContent = String(metrics.pix);
        if (metricFrete) metricFrete.textContent = String(metrics.frete);
        if (metricCep) metricCep.textContent = String(metrics.cep);
        if (metricUpdated) {
            metricUpdated.textContent = metrics.lastUpdated
                ? new Date(metrics.lastUpdated).toLocaleString('pt-BR')
                : '-';
        }
        if (metricBase) metricBase.textContent = `Base: ${metrics.total}`;

        const total = metrics.total || 0;
        const pctPix = total ? Math.round((metrics.pix / total) * 100) : 0;
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
    };

    const loadLeads = async ({ reset = false } = {}) => {
        if (loadingLeads) return;
        loadingLeads = true;
        if (reset) offset = 0;

        const query = leadsSearch?.value.trim() || '';
        const url = new URL('/api/admin/leads', window.location.origin);
        url.searchParams.set('limit', String(limit));
        url.searchParams.set('offset', String(offset));
        if (query) url.searchParams.set('q', query);

        const res = await adminFetch(url.toString());
        if (res.ok) {
            const data = await res.json();
            const rows = data.data || [];
            renderLeads(rows, !reset);
            updateMetrics(rows, reset);
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
                leadsReconcileStatus.textContent = detail?.error || 'Falha ao reconciliar.';
            }
            showToast('Falha ao reconciliar PIX.', 'error');
            leadsReconcile.disabled = false;
            return;
        }
        const data = await res.json().catch(() => ({}));
        if (leadsReconcileStatus) {
            leadsReconcileStatus.textContent = `Checados ${data.checked || 0}, confirmados ${data.confirmed || 0}.`;
        }
        showToast('Reconciliacao finalizada.', 'success');
        leadsReconcile.disabled = false;
        loadLeads({ reset: true });
    };

    const loadPageCounts = async () => {
        if (!pagesGrid) return;
        const res = await adminFetch('/api/admin/pages');
        if (!res.ok) return;
        const data = await res.json();
        const rows = data.data || [];
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
            const order = ['home', 'quiz', 'personal', 'cep', 'processing', 'success', 'checkout', 'orderbump', 'pix'];
            const pageMeta = {
                home: { label: 'index.html', desc: 'Pagina inicial (entrada do funil)' },
                quiz: { label: 'quiz.html', desc: 'Perguntas de qualificacao' },
                personal: { label: 'dados.html', desc: 'Coleta de dados pessoais' },
                cep: { label: 'endereco.html', desc: 'Consulta e confirmacao de CEP' },
                processing: { label: 'processando.html', desc: 'Video + verificacao de elegibilidade' },
                success: { label: 'sucesso.html', desc: 'Aprovado e chamada para resgate' },
                checkout: { label: 'checkout.html', desc: 'Endereco e selecao de frete' },
                orderbump: { label: 'orderbump.html', desc: 'Oferta do Seguro Bag' },
                pix: { label: 'pix.html', desc: 'Pagamento via PIX' }
            };
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
                const meta = pageMeta[page] || { label: page, desc: 'Etapa do funil' };
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

    loginBtn?.addEventListener('click', async () => {
        if (loginError) loginError.classList.add('hidden');
        const password = passwordInput?.value || '';
        const res = await adminFetch('/api/admin/login', {
            method: 'POST',
            body: JSON.stringify({ password })
        });
        if (!res.ok) {
            if (loginError) {
                loginError.textContent = 'Senha invalida.';
                loginError.classList.remove('hidden');
            }
            return;
        }
        setLoginVisible(false);
        if (hasPixelForm || hasUtmfyForm) await loadSettings();
        if (wantsLeads) await loadLeads({ reset: true });
        if (wantsPages) await loadPageCounts();
    });

    saveBtn?.addEventListener('click', saveSettings);
    leadsRefresh?.addEventListener('click', () => loadLeads({ reset: true }));
    leadsMore?.addEventListener('click', () => loadLeads({ reset: false }));
    leadsSearch?.addEventListener('change', () => loadLeads({ reset: true }));
    leadsReconcile?.addEventListener('click', reconcilePix);
    testPixelBtn?.addEventListener('click', runPixelTest);
    testUtmfyBtn?.addEventListener('click', runUtmfyTest);
    saleUtmfyBtn?.addEventListener('click', runUtmfySale);

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

    checkAuth().then((ok) => {
        if (ok) {
            setLoginVisible(false);
            if (hasPixelForm || hasUtmfyForm) loadSettings();
            if (wantsLeads) loadLeads({ reset: true });
            if (wantsPages) loadPageCounts();
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
    trackLead('quiz_answer', { stage: 'quiz' });

    setTimeout(() => {
        if (option.next === 'personal_step') {
            trackLead('quiz_complete', { stage: 'quiz' });
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

function buildShippingOptions(rawCep) {
    return [
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

async function createPixCharge(shipping, bumpPrice) {
    await ensureApiSession(true);

    const extraCharge = Number(bumpPrice || 0);
    const amount = Number((shipping.price + extraCharge).toFixed(2));
    const payload = {
        sessionId: getLeadSessionId(),
        amount,
        stage: 'pix',
        event: 'pix_create_requested',
        sourceUrl: window.location.href,
        utm: getUtmData(),
        shipping,
        bump: extraCharge > 0 ? { title: 'Seguro Bag', price: extraCharge } : null,
        personal: loadPersonal(),
        address: loadAddress(),
        extra: loadAddressExtra()
    };

    const res = await fetch('/api/pix/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const message = data?.error || 'Falha ao gerar o PIX. Tente novamente em instantes.';
        trackLead('pix_create_failed', {
            stage: 'orderbump',
            shipping,
            bump: payload.bump,
            amount
        });
        throw new Error(message);
    }
    savePix({
        ...data,
        amount,
        shippingName: shipping.name,
        bumpName: extraCharge > 0 ? 'Seguro Bag' : '',
        bumpPrice: extraCharge,
        createdAt: Date.now()
    });
    setStage('pix');
    trackLead('pix_created_front', {
        stage: 'pix',
        shipping,
        bump: payload.bump,
        pix: data,
        amount
    });
    redirect('pix.html');
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
    if (!pixelId || window.fbq) return;
    /* eslint-disable */
    !function(f,b,e,v,n,t,s){
        if(f.fbq)return;n=f.fbq=function(){n.callMethod?
        n.callMethod.apply(n,arguments):n.queue.push(arguments)};
        if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
        n.queue=[];t=b.createElement(e);t.async=!0;
        t.src=v;s=b.getElementsByTagName(e)[0];
        s.parentNode.insertBefore(t,s)
    }(window, document,'script','https://connect.facebook.net/en_US/fbevents.js');
    fbq('init', pixelId);
    /* eslint-enable */
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

function firePixelEvent(eventName, data = {}) {
    if (!window.fbq) return;
    try {
        window.fbq('track', eventName, data);
    } catch (_error) {}
}

function normalizePixelName(name) {
    return String(name || '')
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function firePixelCustom(eventName, data = {}) {
    if (!window.fbq) return;
    const safe = normalizePixelName(eventName);
    if (!safe) return;
    try {
        window.fbq('trackCustom', safe, data);
    } catch (_error) {}
}

function maybeTrackPixel(eventName, payload = {}) {
    const pixel = state.pixelConfig;
    if (!pixel || !pixel.enabled || !pixel.id) return;

    const amount = Number(payload.amount || payload.pix?.amount || payload.pixAmount || 0);
    const shipping = payload.shipping || {};

    if (eventName === 'personal_submitted' && pixel.events?.lead !== false) {
        firePixelEvent('Lead');
        firePixelEvent('CompleteRegistration');
    }

    if (eventName === 'checkout_view') {
        firePixelEvent('InitiateCheckout', { currency: 'BRL' });
    }

    if (eventName === 'frete_selected') {
        firePixelEvent('AddPaymentInfo', {
            value: Number(shipping.price || 0),
            currency: 'BRL'
        });
    }

    if (eventName === 'orderbump_accepted') {
        firePixelEvent('AddToCart', {
            value: Number(payload.bump?.price || payload.bumpPrice || 0),
            currency: 'BRL'
        });
    }

    if (eventName === 'pix_created_front' && pixel.events?.purchase !== false) {
        firePixelEvent('Purchase', {
            value: Number(amount || 0),
            currency: 'BRL'
        });
    }

    firePixelCustom(eventName, {
        value: Number(amount || 0),
        currency: 'BRL',
        stage: payload.stage || ''
    });
}

function trackLead(eventName, extra = {}) {
    ensureApiSession().catch(() => null);

    const payload = {
        sessionId: getLeadSessionId(),
        event: eventName,
        stage: extra.stage || getStage() || '',
        page: document.body.dataset.page || '',
        sourceUrl: window.location.href,
        utm: getUtmData(),
        personal: extra.personal || loadPersonal() || {},
        address: extra.address || loadAddress() || {},
        extra: extra.extra || loadAddressExtra() || {},
        shipping: extra.shipping || loadShipping() || {},
        bump: extra.bump || loadBump() || {},
        pix: extra.pix || loadPix() || {},
        amount: Number.isFinite(Number(extra.amount)) ? Number(extra.amount) : undefined
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
    sessionStorage.removeItem(STORAGE_KEYS.stock);
    sessionStorage.removeItem(STORAGE_KEYS.returnTo);
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

function requirePersonal() {
    const personal = loadPersonal();
    if (!personal || !personal.name || !personal.cpf || !personal.birth || !personal.email || !personal.phone) {
        redirect('dados.html');
        return false;
    }
    return true;
}

function requireAddress() {
    if (!loadAddress()) {
        redirect('endereco.html');
        return false;
    }
    return true;
}

function redirect(url) {
    const clean = (url || '').replace(/\.html(?=$|\?)/, '');
    if (clean === 'index') {
        window.location.href = '/';
        return;
    }
    window.location.href = clean || url;
}

