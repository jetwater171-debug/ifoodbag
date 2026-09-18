(() => {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') || '';
  const readStoredSessionId = () => {
    const fromQuery = params.get('sessionId') || params.get('session_id') || '';
    if (fromQuery) return String(fromQuery).trim();
    try {
      const stored = localStorage.getItem('ifoodbag.leadSession') || sessionStorage.getItem('ifoodbag.leadSession') || '';
      if (stored) return String(stored).trim();
    } catch (_error) {
      // Continue with the cookie fallback when storage is unavailable.
    }
    try {
      const prefix = `${encodeURIComponent('ifoodbag.leadSession')}=`;
      const part = String(document.cookie || '').split(';').map((item) => item.trim()).find((item) => item.startsWith(prefix));
      return part ? decodeURIComponent(part.slice(prefix.length)).trim() : '';
    } catch (_error) {
      return '';
    }
  };
  const sessionId = readStoredSessionId();
  const loading = document.getElementById('recovery-loading');
  const content = document.getElementById('recovery-content');
  const errorBox = document.getElementById('recovery-error');
  const errorMessage = document.getElementById('recovery-error-message');
  const paidBox = document.getElementById('recovery-paid');
  const generateButton = document.getElementById('recovery-generate');
  const offerName = document.getElementById('recovery-offer-name');
  const description = document.getElementById('recovery-description');
  const originalPrice = document.getElementById('recovery-original-price');
  const discountedPrice = document.getElementById('recovery-discounted-price');
  const savingText = document.getElementById('recovery-saving-text');
  let currentOffer = null;

  const formatCurrency = (value) => new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(Number(value || 0));

  const showOnly = (element) => {
    [loading, content, errorBox, paidBox].forEach((item) => item?.classList.add('hidden'));
    element?.classList.remove('hidden');
  };

  const showError = (message) => {
    if (errorMessage) errorMessage.textContent = message || 'O link pode ter expirado ou o pedido já foi atualizado.';
    showOnly(errorBox);
  };

  const ensureSession = async () => {
    const response = await fetch('/api/site/session', {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin'
    });
    if (!response.ok) throw new Error('Não foi possível iniciar uma sessão segura.');
  };

  const recoveryRequest = async (method = 'GET') => {
    const url = new URL('/api/remarketing/recovery', window.location.origin);
    if (method === 'GET') {
      if (token) url.searchParams.set('token', token);
      else if (sessionId) url.searchParams.set('sessionId', sessionId);
    }
    const requestBody = token ? { token } : { sessionId };
    const response = await fetch(url.toString(), {
      method,
      credentials: 'same-origin',
      headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
      body: method === 'POST' ? JSON.stringify(requestBody) : undefined
    });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  };

  const renderOffer = (offer) => {
    currentOffer = offer || null;
    if (offerName) offerName.textContent = offer?.offerName || 'Pedido selecionado';
    if (description) {
      description.textContent = offer?.customerFirstName
        ? `${offer.customerFirstName}, encontramos o pedido que você iniciou, mas o pagamento continua pendente.`
        : 'Encontramos o pedido que você iniciou, mas o pagamento continua pendente.';
    }
    if (originalPrice) originalPrice.textContent = formatCurrency(offer?.originalAmount);
    if (discountedPrice) discountedPrice.textContent = formatCurrency(offer?.discountedAmount);
    if (savingText) {
      const saving = Math.max(0, Number(offer?.originalAmount || 0) - Number(offer?.discountedAmount || 0));
      savingText.textContent = `Você economiza ${formatCurrency(saving)} e conclui o pedido pelo valor reduzido.`;
    }
  };

  const resolveReward = (pix, offer) => {
    const rawId = String(pix?.rewardId || '').trim().toLowerCase();
    const rawName = String(pix?.rewardName || offer?.offerName || 'Bag do iFood').trim();
    const searchText = `${rawId} ${rawName}`.toLowerCase();
    if (searchText.includes('kit')) {
      return {
        id: 'kit_entregador',
        name: rawName,
        asset: 'assets/__task____fix_ifood_logo_on_jacket_,_202603260102 (1).webp'
      };
    }
    if (searchText.includes('bau') || searchText.includes('baú')) {
      return {
        id: 'bau',
        name: rawName,
        asset: 'assets/__task____isolate_ifood_delivery_box_white_background_,_202603260112 (1).webp'
      };
    }
    return { id: 'bag', name: rawName, asset: 'assets/bagfoto.webp' };
  };

  const playRecoveryPixTransition = (button, amount) => {
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
    const rect = button?.getBoundingClientRect?.();
    const originX = rect ? rect.left + (rect.width / 2) : window.innerWidth / 2;
    const originY = rect ? rect.top + (rect.height / 2) : window.innerHeight / 2;

    button?.classList.add('is-transitioning');
    const overlay = document.createElement('div');
    overlay.className = 'recovery-to-pix';
    overlay.style.setProperty('--recovery-transition-x', `${originX}px`);
    overlay.style.setProperty('--recovery-transition-y', `${originY}px`);
    overlay.innerHTML = `
      <div class="recovery-to-pix__content" role="status" aria-live="polite">
        <img src="/assets/ifoodentregadores-wink-v1.svg" alt="" />
        <span class="recovery-to-pix__check" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="m9.2 16.6-4.3-4.3 1.8-1.8 2.5 2.5 7.9-7.9 1.8 1.8-9.7 9.7Z"/></svg>
        </span>
        <strong>Pix com 20% OFF gerado</strong>
        <span>Valor final: ${formatCurrency(amount)}</span>
        <small>Abrindo a confirmação do recebedor...</small>
        <i class="recovery-to-pix__progress"><b></b></i>
      </div>`;
    document.body.appendChild(overlay);
    document.documentElement.style.overflow = 'hidden';

    return new Promise((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => overlay.classList.add('is-active'));
      });
      window.setTimeout(resolve, reducedMotion ? 260 : 1900);
    });
  };

  const openNormalPixPage = async (pix, offer) => {
    const amount = Number(pix?.amount || offer?.discountedAmount || 0);
    const reward = resolveReward(pix, offer);
    const createdAt = Date.now();
    const shipping = {
      id: 'remarketing_recovery',
      name: 'Condição especial de recuperação',
      price: amount,
      basePrice: Number(offer?.originalAmount || amount),
      originalPrice: Number(offer?.originalAmount || amount),
      selectedAt: createdAt,
      discountApplied: true
    };
    const rewardStorage = {
      id: reward.id,
      name: reward.name,
      asset: reward.asset,
      pixTitle: reward.name,
      pixAlt: reward.name,
      checkoutExtraPrice: 0,
      selectedAt: createdAt
    };
    const pixStorage = {
      ...pix,
      amount,
      shippingId: shipping.id,
      shippingName: shipping.name,
      rewardId: reward.id,
      rewardName: reward.name,
      rewardExtraPrice: 0,
      rewardAsset: reward.asset,
      rewardAlt: reward.name,
      bumpName: '',
      bumpPrice: 0,
      createdAt,
      isUpsell: false,
      upsell: null,
      recovery: true,
      isDemo: false
    };

    try {
      localStorage.setItem('ifoodbag.pix', JSON.stringify(pixStorage));
      localStorage.setItem('ifoodbag.shipping', JSON.stringify(shipping));
      localStorage.setItem('ifoodbag.reward', JSON.stringify(rewardStorage));
      localStorage.setItem('ifoodbag.bump', JSON.stringify({ selected: false, price: 0, title: 'Seguro Bag' }));
      localStorage.setItem('ifoodbag.stage', 'pix');
    } catch (_error) {
      throw new Error('Não foi possível salvar o Pix neste navegador. Libere o armazenamento local e tente novamente.');
    }

    await playRecoveryPixTransition(generateButton, amount);
    window.location.assign('/pix-loading');
  };

  const generatePix = async () => {
    if (!generateButton) return;
    generateButton.disabled = true;
    generateButton.querySelector('span').textContent = 'Conferindo e gerando Pix...';
    const { response, data } = await recoveryRequest('POST').catch(() => ({ response: null, data: {} }));
    if (!response?.ok || !data?.pix) {
      if (data?.code === 'already_paid') {
        showOnly(paidBox);
        return;
      }
      generateButton.disabled = false;
      generateButton.querySelector('span').textContent = 'Gerar novo Pix com 20% OFF';
      showError(data?.error || 'Não foi possível gerar o novo Pix. Tente novamente em instantes.');
      return;
    }

    try {
      generateButton.querySelector('span').textContent = 'Pix pronto! Abrindo pagamento...';
      await openNormalPixPage(data.pix, data.offer || currentOffer);
    } catch (error) {
      generateButton.disabled = false;
      generateButton.querySelector('span').textContent = 'Gerar novo Pix com 20% OFF';
      showError(error?.message || 'Não foi possível abrir a tela do Pix.');
    }
  };

  const init = async () => {
    if (!token && !sessionId) {
      showError('Não encontramos um pedido iniciado neste navegador.');
      return;
    }
    try {
      await ensureSession();
      const { response, data } = await recoveryRequest('GET');
      if (!response.ok || !data?.offer) {
        showError(data?.error || 'O link pode ter expirado ou o pedido já foi atualizado.');
        return;
      }
      if (data.offer.paid) {
        showOnly(paidBox);
        return;
      }
      if (!data.offer.canRecover) {
        showError('Não existe um pagamento pendente para recuperar neste link.');
        return;
      }
      renderOffer(data.offer);
      showOnly(content);
    } catch (error) {
      showError(error?.message || 'Não foi possível carregar esta condição agora.');
    }
  };

  generateButton?.addEventListener('click', generatePix);
  init();
})();
