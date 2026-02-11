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

        var resolveEarlyBackTarget = function () {
            try {
                if (typeof window.__ifbResolveBackRedirect === 'function') {
                    var resolved = String(window.__ifbResolveBackRedirect() || '').trim();
                    if (resolved) return resolved;
                }
            } catch (_error) {
                // Fall through to checkout fallback.
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

            var target = resolveEarlyBackTarget();
            var targetPath = normalizePath(target);
            if (!targetPath || targetPath === currentPath()) return;

            window.__ifbAllowUnload = true;
            window.location.replace(target);
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
