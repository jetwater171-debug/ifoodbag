(function () {
    try {
        if (window.__ifbEarlyBackGuardInit) return;
        window.__ifbEarlyBackGuardInit = true;

        var path = String(window.location.pathname || '/');
        if (/^\/admin(\/|$)/i.test(path)) return;
        if (/^\/api(\/|$)/i.test(path)) return;

        var url = path + (window.location.search || '') + (window.location.hash || '');
        var token = String(Date.now()) + '_' + Math.random().toString(36).slice(2, 8);
        var depth = 20;
        var refillAt = 0;

        var normalizePath = function (rawUrl) {
            try {
                var parsed = new URL(String(rawUrl || ''), window.location.origin);
                return parsed.pathname + parsed.search;
            } catch (_error) {
                return String(rawUrl || '').trim();
            }
        };

        var currentPath = function () {
            return window.location.pathname + (window.location.search || '');
        };

        var parseStorageJson = function (key) {
            try {
                var raw = window.localStorage ? window.localStorage.getItem(key) : '';
                if (!raw) return null;
                return JSON.parse(raw);
            } catch (_error) {
                return null;
            }
        };

        var isShippingSelectionComplete = function (shipping) {
            if (!shipping || typeof shipping !== 'object') return false;
            var shippingId = String(shipping.id || '').trim();
            var shippingPrice = Number(shipping.price || 0);
            var selectedAt = Number(shipping.selectedAt || 0);
            if (!shippingId) return false;
            if (!isFinite(shippingPrice) || shippingPrice < 0) return false;
            if (!selectedAt || isNaN(selectedAt)) return false;
            return true;
        };

        var isPixPaidStatus = function (pix) {
            if (!pix || typeof pix !== 'object') return false;
            if (pix.upsellPaid === true || pix.paidAt) return true;
            var status = String(pix.status || pix.statusRaw || pix.status_transaction || '').toLowerCase();
            return /paid|approved|confirm|completed|success|conclu|aprov/.test(status);
        };

        var resolveEarlyBackTarget = function () {
            try {
                if (typeof window.__ifbResolveBackRedirect === 'function') {
                    var resolved = String(window.__ifbResolveBackRedirect() || '').trim();
                    if (resolved) return resolved;
                }
            } catch (_error) {
                // Fall through to checkout fallback.
            }

            try {
                var personal = parseStorageJson('ifoodbag.personal') || {};
                var address = parseStorageJson('ifoodbag.address') || null;
                var shipping = parseStorageJson('ifoodbag.shipping') || null;
                var pix = parseStorageJson('ifoodbag.pix') || null;
                var hasPersonal =
                    !!String(personal.name || '').trim() &&
                    !!String(personal.cpf || '').trim() &&
                    !!String(personal.birth || '').trim() &&
                    !!String(personal.email || '').trim() &&
                    !!String(personal.phone || '').trim();
                var vslCompleted = window.localStorage && window.localStorage.getItem('ifoodbag.vslCompleted') === '1';
                var pixPaid = isPixPaidStatus(pix);
                var pixPending = !!pix && !pixPaid;
                var pathname = String(window.location.pathname || '').toLowerCase();
                var onOrderbump = /\/orderbump(?:\.html)?$/i.test(pathname);

                if (!vslCompleted && hasPersonal && address) return '/processando';
                if (pixPending) return '/pix';
                if (pixPaid) return '/upsell';
                if (onOrderbump && isShippingSelectionComplete(shipping)) {
                    try {
                        if (window.sessionStorage) {
                            window.sessionStorage.setItem('ifoodbag.orderbumpBackAutoPix', '1');
                        }
                    } catch (_error3) {
                        // Ignore session storage restrictions.
                    }
                    return '/pix';
                }
                if (onOrderbump && !isShippingSelectionComplete(shipping)) {
                    return '/checkout?forceFrete=1';
                }
                if (shipping) return '/orderbump';
            } catch (_error2) {
                // Ignore storage parsing issues.
            }

            var params = new URLSearchParams(window.location.search || '');
            params.set('dc', '1');
            var query = params.toString();
            return '/checkout' + (query ? ('?' + query) : '');
        };

        var refill = function (force) {
            var now = Date.now();
            if (!force && (now - refillAt) < 80) return;
            refillAt = now;
            var state = history.state || {};
            var step = Number(state.step || 0);
            if (!force && state.ifbEarly === true && state.token === token && step >= depth) return;
            history.replaceState({ ifbEarly: true, token: token, step: 0 }, '', url);
            for (var i = 1; i <= depth; i += 1) {
                history.pushState({ ifbEarly: true, token: token, step: i }, '', url);
            }
        };

        var runBackRedirect = function () {
            if (window.__ifbAllowUnload) return;
            window.__ifbEarlyBackAttempt = true;
            refill(true);
            if (window.__ifoodBackRedirectInit) return;
            if (window.__ifbEarlyRedirectTimer) return;

            window.__ifbEarlyRedirectTimer = window.setTimeout(function () {
                window.__ifbEarlyRedirectTimer = null;
                if (window.__ifbAllowUnload) return;
                if (window.__ifoodBackRedirectInit) return;

                var target = resolveEarlyBackTarget();
                var targetPath = normalizePath(target);
                if (!targetPath || targetPath === currentPath()) return;

                window.__ifbAllowUnload = true;
                window.location.replace(target);
            }, 220);
        };

        refill(true);

        window.addEventListener('popstate', runBackRedirect);
        window.addEventListener('pageshow', function () {
            if (window.__ifbAllowUnload) return;
            refill(false);
        });
        window.addEventListener('hashchange', function () {
            if (window.__ifbAllowUnload) return;
            refill(true);
        });
        window.addEventListener('focus', function () {
            if (window.__ifbAllowUnload) return;
            refill(false);
        });
        window.addEventListener('visibilitychange', function () {
            if (window.__ifbAllowUnload) return;
            if (document.visibilityState === 'visible') refill(false);
        });
    } catch (_error) {
        // Ignore browser restrictions around History API.
    }
})();
