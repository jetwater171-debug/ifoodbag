const fetchFn = global.fetch
    ? global.fetch.bind(global)
    : (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.SUPABASE_PROJECT_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || '';

function normalizePage(value) {
    const page = String(value || '').trim().toLowerCase();
    if (!page) return '';
    return page.replace(/[^a-z0-9_-]/g, '');
}

async function upsertPageview(sessionId, page) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return { ok: false, reason: 'missing_supabase_config' };
    }

    const session = String(sessionId || '').trim();
    const pageName = normalizePage(page);
    if (!session || !pageName) {
        return { ok: false, reason: 'missing_data' };
    }

    const endpoint = `${SUPABASE_URL}/rest/v1/lead_pageviews`;
    let response;
    try {
        response = await fetchFn(endpoint, {
            method: 'POST',
            headers: {
                apikey: SUPABASE_SERVICE_KEY,
                Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
                'Content-Type': 'application/json',
                Prefer: 'resolution=ignore-duplicates,return=minimal'
            },
            body: JSON.stringify([{ session_id: session, page: pageName }])
        });
    } catch (error) {
        return {
            ok: false,
            reason: 'network_error',
            detail: error?.message || String(error)
        };
    }

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        return { ok: false, reason: 'supabase_error', detail };
    }

    return { ok: true };
}

module.exports = {
    upsertPageview
};
