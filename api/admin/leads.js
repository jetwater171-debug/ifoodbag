const { ensureAllowedRequest } = require('../../lib/request-guard');
const { requireAdmin } = require('../../lib/admin-auth');

const fetchFn = global.fetch
    ? global.fetch.bind(global)
    : (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.SUPABASE_PROJECT_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || '';

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'GET') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    if (!ensureAllowedRequest(req, res, { requireSession: false })) {
        return;
    }
    if (!requireAdmin(req, res)) return;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        res.status(500).json({ error: 'Supabase nao configurado.' });
        return;
    }

    const url = new URL(`${SUPABASE_URL}/rest/v1/leads_readable`);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const query = String(req.query.q || '').trim();

    url.searchParams.set('select', '*');
    url.searchParams.set('order', 'updated_at.desc');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));

    if (query) {
        const ilike = `%${query.replace(/%/g, '')}%`;
        url.searchParams.set('or', `nome.ilike.${ilike},email.ilike.${ilike},telefone.ilike.${ilike},cpf.ilike.${ilike}`);
    }

    const response = await fetchFn(url.toString(), {
        headers: {
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        res.status(502).json({ error: 'Falha ao buscar leads.', detail });
        return;
    }

    const data = await response.json().catch(() => []);
    res.status(200).json({ data });
};