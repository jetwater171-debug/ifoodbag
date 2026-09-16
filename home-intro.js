(() => {
    'use strict';

    const root = document.documentElement;
    const intro = document.getElementById('home-intro');
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    if (!intro || !root.classList.contains('intro-pending')) {
        intro?.remove();
        return;
    }

    const content = [...document.querySelectorAll('body > .header, body > main, body > .footer')];
    const animations = [];
    let closing = false;
    let exitTimer;
    let imageUrl;
    const imageRequest = new AbortController();
    const ease = 'cubic-bezier(0.22, 1, 0.36, 1)';

    // Native compositor animations avoid downloading/parsing the full Motion runtime.
    const animate = (element, frames, options = {}) => {
        const elements = Array.isArray(element) ? element : [element];
        const running = elements.map(node => {
            const animation = node.animate(frames, {
                duration: (options.duration || .3) * 1000,
                delay: (options.delay || 0) * 1000,
                easing: options.ease || ease,
                fill: 'both'
            });
            animations.push(animation);
            // Cancellation is expected when skipping, hiding, or leaving the page.
            return animation.finished.catch(() => {});
        });
        return Promise.all(running);
    };

    function cleanup() {
        closing = true;
        imageRequest.abort();
        if (imageUrl) { URL.revokeObjectURL(imageUrl); imageUrl = null; }
        clearTimeout(exitTimer);
        clearTimeout(window.homeIntroSafety);
        animations.forEach(animation => animation.cancel());
        root.classList.remove('intro-pending', 'intro-revealing');
        content.forEach(element => {
            element.inert = false;
            element.removeAttribute('data-intro-inert');
        });
        intro.remove();
        document.removeEventListener('keydown', onKey);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        reducedMotion.removeEventListener('change', onMotionChange);
    }

    async function reveal(immediate = false) {
        if (closing) return;
        closing = true;
        clearTimeout(exitTimer);
        if (immediate || reducedMotion.matches || !Element.prototype.animate) {
            cleanup();
            return;
        }
        try {
            root.classList.add('intro-revealing');
            animate(document.querySelector('.header .ifood-logo'), { transform: ['translateX(-12px)', 'translateX(0)'], opacity: [0, 1] }, { duration: .65, delay: .2, ease });
            animate(intro.querySelector('.home-intro__heading'), { opacity: [1, 0], transform: ['translateY(0)', 'translateY(-24px)'] }, { duration: .28 });
            animate(intro.querySelector('.home-intro__art'), { opacity: [1, 0], transform: ['scale(1)', 'scale(.94)'] }, { duration: .26 });
            animate(content, { opacity: [.35, 1], transform: ['translateY(28px)', 'translateY(0)'] }, { duration: .75, delay: .12, ease });
            await animate(intro, { transform: ['translateY(0)', 'translateY(-100%)'] }, { duration: .8, delay: .12, ease });
        } finally {
            cleanup();
        }
    }

    function onKey(event) {
        if (event.key === 'Escape') { event.preventDefault(); reveal(); }
    }
    function onVisibilityChange() { if (document.hidden) { closing = true; cleanup(); } }
    function onMotionChange() { if (reducedMotion.matches) { if (closing) cleanup(); else reveal(true); } }

    if (!Element.prototype.animate || reducedMotion.matches) { cleanup(); return; }
    content.forEach(element => { element.inert = true; element.setAttribute('data-intro-inert', ''); });
    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVisibilityChange);
    reducedMotion.addEventListener('change', onMotionChange);
    window.addEventListener('pagehide', cleanup, { once: true });

    try {
        animate(intro.querySelector('.home-intro__brand'), { opacity: [0, 1], transform: ['translateY(-12px) scale(.96)', 'translateY(0) scale(1)'] }, { duration: .65, ease });
        animate(intro.querySelector('.home-intro__brand img'), { opacity: [0, 1], transform: ['translateX(-20px)', 'translateX(0)'] }, { duration: .85, delay: .12, ease });
        const words = intro.querySelectorAll('.home-intro__line > span');
        // Keep the SVG bytes cached, but create a fresh image timeline on every visit.
        // Reusing an animated SVG URL can reuse its already-finished one-shot playback.
        const image = document.getElementById('intro-groceries');
        image.addEventListener('load', () => {
            if (closing) return;
            // Start the title from the SVG load, not from page initialization.
            words.forEach((word, index) => animate(word, { transform: ['translateY(115%) rotate(5deg)', 'translateY(0) rotate(0deg)'], opacity: [0, 1] }, { duration: .8, delay: .45 + index * .09, ease }));
            exitTimer = setTimeout(() => reveal(), 3350);
        }, { once: true });
        image.addEventListener('error', () => reveal(), { once: true });
        fetch(image.dataset.src, { cache: 'force-cache', signal: imageRequest.signal })
            .then(response => {
                if (!response.ok) throw new Error('Intro image unavailable');
                return response.blob();
            })
            .then(blob => {
                if (closing || !intro.isConnected) return;
                imageUrl = URL.createObjectURL(new Blob([blob], { type: 'image/svg+xml' }));
                image.src = imageUrl;
            })
            .catch(() => { if (!closing) reveal(); });
    } catch (_error) {
        cleanup();
    }
})();
