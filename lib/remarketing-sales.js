function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function isRemarketingSale(sale = {}) {
    const markers = [sale.step, sale.shippingId, sale.shippingName, sale.stepLabel]
        .filter(Boolean)
        .join(' ')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
    return markers.includes('remarketing') || markers.includes('recuperacao');
}

function sentSmsBySession(jobs = []) {
    const bySession = new Map();
    jobs.forEach((job) => {
        const payload = asObject(job?.payload);
        const delivery = asObject(payload.delivery);
        if (delivery.outcome !== 'sent' || delivery.held === true) return;
        const sessionId = String(delivery.sessionId || payload.sessionId || '').trim();
        const sentAt = Date.parse(String(delivery.sentAt || job?.processed_at || ''));
        if (!sessionId || !Number.isFinite(sentAt)) return;
        const sent = {
            at: sentAt,
            txid: String(delivery.txid || payload.txid || '').trim()
        };
        if (!bySession.has(sessionId)) bySession.set(sessionId, []);
        bySession.get(sessionId).push(sent);
    });
    return bySession;
}

function buildRemarketingSalesReport(allSales = [], smsJobs = []) {
    const smsBySession = sentSmsBySession(smsJobs);
    const seenPayments = new Set();
    const sales = [];

    allSales.forEach((entry) => {
        const txid = String(entry?.txid || '').trim();
        if (!txid) return;
        const paymentKey = `${String(entry?.gateway || '').trim()}|${txid}`;
        if (seenPayments.has(paymentKey)) return;

        const paidAt = Date.parse(String(entry?.paidAt || ''));
        const recovery = isRemarketingSale(entry);
        const smsSent = Number.isFinite(paidAt) && (smsBySession.get(String(entry?.sessionId || '').trim()) || []).some((sms) => (
            sms.at <= paidAt && (recovery || (entry?.step === 'front' && sms.txid === txid))
        ));
        if (!recovery && !smsSent) return;
        seenPayments.add(paymentKey);
        sales.push({ ...entry, attribution: smsSent ? 'sms' : 'link' });
    });

    sales.sort((left, right) => (
        (Date.parse(right?.paidAt || right?.createdAt || '') || 0) -
        (Date.parse(left?.paidAt || left?.createdAt || '') || 0)
    ));

    const revenue = sales.reduce((sum, sale) => sum + Number(sale?.amount || 0), 0);
    const smsSales = sales.filter((sale) => sale.attribution === 'sms');
    const smsRevenue = smsSales.reduce((sum, sale) => sum + Number(sale?.amount || 0), 0);
    const customers = new Set(sales.map((sale) => String(sale?.sessionId || '').trim()).filter(Boolean));

    return {
        sales,
        summary: {
            sales: sales.length,
            revenue: Number(revenue.toFixed(2)),
            averageTicket: sales.length ? Number((revenue / sales.length).toFixed(2)) : 0,
            customers: customers.size,
            lastSaleAt: sales[0]?.paidAt || sales[0]?.createdAt || '',
            smsSales: smsSales.length,
            smsRevenue: Number(smsRevenue.toFixed(2))
        }
    };
}

module.exports = { isRemarketingSale, buildRemarketingSalesReport };
