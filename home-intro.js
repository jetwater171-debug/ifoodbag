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
    const previousFocus = document.activeElement;
    const skip = intro.querySelector('button');
    const ease = [0.22, 1, 0.36, 1];

    const animate = (element, frames, options) => {
        const animation = window.Motion.animate(element, frames, options);
        animations.push(animation);
        return animation;
    };

    function cleanup() {
        clearTimeout(exitTimer);
        clearTimeout(window.homeIntroSafety);
        animations.forEach(animation => animation.cancel());
        root.classList.remove('intro-pending', 'intro-revealing');
        content.forEach(element => {
            element.inert = false;
            element.removeAttribute('data-intro-inert');
        });
        const restoreFocus = document.activeElement === skip;
        intro.remove();
        document.removeEventListener('keydown', onKey);
        reducedMotion.removeEventListener('change', onMotionChange);
        if (restoreFocus) {
            const target = previousFocus !== document.body ? previousFocus : document.getElementById('btn-start');
            target?.focus({ preventScroll: true });
        }
    }

    async function reveal(immediate = false) {
        if (closing) return;
        closing = true;
        clearTimeout(exitTimer);
        if (immediate || reducedMotion.matches || !window.Motion) {
            cleanup();
            return;
        }
        try {
            root.classList.add('intro-revealing');
            animate(intro.querySelector('.home-intro__heading'), { opacity: [1, 0], y: [0, -24] }, { duration: .28 });
            animate(intro.querySelector('.home-intro__art'), { opacity: [1, 0], scale: [1, .94] }, { duration: .26 });
            animate(intro.querySelector('.home-intro__bottom'), { opacity: [1, 0] }, { duration: .18 });
            animate(content, { opacity: [.35, 1], y: [28, 0] }, { duration: .75, delay: .22, ease });
            await animate(intro, { y: ['0%', '-100%'], borderBottomLeftRadius: ['0%', '12%'], borderBottomRightRadius: ['0%', '12%'] }, { duration: .8, delay: .12, ease });
        } finally {
            cleanup();
        }
    }

    function onKey(event) {
        if (event.key === 'Escape') { event.preventDefault(); reveal(); }
        if (event.key === 'Tab') { event.preventDefault(); skip.focus(); }
    }
    function onMotionChange() { if (reducedMotion.matches) { if (closing) cleanup(); else reveal(true); } }

    if (!window.Motion || reducedMotion.matches) { cleanup(); return; }
    content.forEach(element => { element.inert = true; element.setAttribute('data-intro-inert', ''); });
    skip.addEventListener('click', () => reveal());
    document.addEventListener('keydown', onKey);
    reducedMotion.addEventListener('change', onMotionChange);
    window.addEventListener('pagehide', cleanup, { once: true });

    try {
        animate(intro.querySelector('.home-intro__eyebrow'), { opacity: [0, .75], y: [8, 0] }, { duration: .55, delay: .08, ease });
        const words = intro.querySelectorAll('.home-intro__line > span');
        words.forEach((word, index) => animate(word, { y: ['115%', '0%'], rotate: [5, 0], opacity: [0, 1] }, { duration: .75, delay: .14 + index * .075, ease }));
        animate(intro.querySelector('.home-intro__track span'), { scaleX: [0, 1] }, { duration: 3.2, ease: 'linear' });
        // The supplied SVG plays once, then holds its final logo during the reveal.
        const image = document.getElementById('intro-groceries');
        const schedule = () => { if (!closing) exitTimer = setTimeout(() => reveal(), 3350); };
        if (image.complete) schedule();
        else {
            image.addEventListener('load', schedule, { once: true });
            image.addEventListener('error', () => reveal(), { once: true });
        }
    } catch (_error) {
        cleanup();
    }
})();
