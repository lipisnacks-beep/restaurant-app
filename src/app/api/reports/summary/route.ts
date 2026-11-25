import { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import Order from '@/models/Order';
import Expense from '@/models/Expense';
import Purchase from '@/models/Purchase';
import { getSettings } from '@/lib/settings';
import { getSession } from '@/lib/auth';
import { ok, unauthorized, forbidden, serverError } from '@/lib/utils';
import {
  resolvePreset,
  parseDateFromInput,
  parseDateToInput,
} from '@/lib/dateRange';

export const dynamic = 'force-dynamic';

function resolveRangeToday(q: URLSearchParams): { from: Date; to: Date; label: string } {
  const preset = resolvePreset('today');
  return { from: preset.from, to: preset.to, label: 'today' };
}

/**
 * GET /api/reports/summary?range=today|yesterday|7d|30d|month|lastmonth|year
 * GET /api/reports/summary?from=YYYY-MM-DD&to=YYYY-MM-DD   (custom range, IST)
 *
 * Admin-only. Returns:
 *   - KPIs: orders, grossSales, revenue, tax, serviceCharge, tips, expenses,
 *           purchases, purchasesPaid, totalCost, profit, margin, avgOrderValue
 *   - series: [{ bucket, label, sales, revenue, expenses, purchases, profit }]
 *       bucketed by day for <=31-day ranges, else by month
 *   - breakdowns: expenseByCategory, purchaseByCategory, revenueByPaymentMethod,
 *                 topItems (name, qty, revenue)
 *   - meta: { from, to, label, currencySymbol, rangeLabel }
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return unauthorized();
    if (session.role !== 'admin') return forbidden();

    await dbConnect();
    const q = new URL(req.url).searchParams;
    const range = q.get('range') || 'today';
    // Resolve the range in IST.
    let rangeData: { from: Date; to: Date; label: string };
    if (q.get('from') && q.get('to')) {
      const from = parseDateFromInput(q.get('from')!);
      const to = parseDateToInput(q.get('to')!);
      if (from && to) rangeData = { from, to, label: 'custom' };
      else rangeData = resolveRangeToday(q);
    } else if (range === 'today') {
      rangeData = resolveRangeToday(q);
    } else {
      // Use the preset-based resolver for the other named ranges.
      rangeData = resolveNamedRange(range);
    }
    const { from, to, label } = rangeData;
    const settings = await getSettings();
    const currency = settings.currencySymbol || '₹';

    // Paid, non-cancelled orders within the range. "revenue" = money actually
    // collected by the restaurant = subtotal + tax + serviceCharge. Tips are
    // NOT restaurant income — they are a passthrough to the staff and chef who
    // served the order — so they are excluded from revenue (and therefore from
    // profit) and reported separately as `tips`. "grossSales" = subtotal.
    // Cancelled orders are excluded even if paymentStatus was 'paid' (a cancel
    // now flips a paid order to 'refunded', but guard against legacy data).
    const orderMatch = {
      createdAt: { $gte: from, $lte: to },
      paymentStatus: 'paid',
      status: { $ne: 'cancelled' },
    };

    const bucketByMonth = (to.getTime() - from.getTime()) > 31 * 86400000;
    // Bucket by IST calendar day/month so the series aligns with the IST
    // range filter (previously UTC bucketing shifted late-evening IST orders
    // into the next day's bucket).
    const dateBucket = bucketByMonth
      ? { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: 'Asia/Kolkata' } }
      : { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Kolkata' } };

    const revenueExpr = { $add: ['$subtotal', '$taxAmount', '$serviceChargeAmount'] };

    const [orderKpis, expenseKpis, purchaseKpis, orderSeries, expenseSeries, purchaseSeries,
      expenseByCat, purchaseByCat, revByPayment, topItemsAgg] = await Promise.all([
      Order.aggregate([
        { $match: orderMatch },
        { $group: {
          _id: null,
          orders: { $sum: 1 },
          grossSales: { $sum: '$subtotal' },
          revenue: { $sum: revenueExpr },
          tax: { $sum: '$taxAmount' },
          serviceCharge: { $sum: '$serviceChargeAmount' },
          tips: { $sum: '$tip' },
        } },
      ]),
      Expense.aggregate([
        { $match: { date: { $gte: from, $lte: to } } },
        { $group: { _id: null, expenses: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      Purchase.aggregate([
        { $match: { date: { $gte: from, $lte: to } } },
        { $group: { _id: null, purchases: { $sum: '$total' }, paid: { $sum: '$amountPaid' }, count: { $sum: 1 } } },
      ]),
      Order.aggregate([
        { $match: orderMatch },
        { $group: {
          _id: dateBucket,
          sales: { $sum: '$subtotal' },
          revenue: { $sum: revenueExpr },
          tips: { $sum: '$tip' },
          orders: { $sum: 1 },
        } },
        { $sort: { _id: 1 } },
      ]),
      Expense.aggregate([
        { $match: { date: { $gte: from, $lte: to } } },
        { $group: { _id: dateBucket, expenses: { $sum: '$amount' } } },
        { $sort: { _id: 1 } },
      ]),
      Purchase.aggregate([
        { $match: { date: { $gte: from, $lte: to } } },
        { $group: { _id: dateBucket, purchases: { $sum: '$total' }, paid: { $sum: '$amountPaid' } } },
        { $sort: { _id: 1 } },
      ]),
      Expense.aggregate([
        { $match: { date: { $gte: from, $lte: to } } },
        { $group: { _id: '$category', amount: { $sum: '$amount' } } },
        { $sort: { amount: -1 } },
      ]),
      Purchase.aggregate([
        { $match: { date: { $gte: from, $lte: to } } },
        { $group: { _id: '$category', amount: { $sum: '$total' }, paid: { $sum: '$amountPaid' } } },
        { $sort: { amount: -1 } },
      ]),
      Order.aggregate([
        { $match: orderMatch },
        { $group: { _id: '$paymentMethod', revenue: { $sum: revenueExpr }, count: { $sum: 1 } } },
        { $sort: { revenue: -1 } },
      ]),
      Order.aggregate([
        { $match: orderMatch },
        { $unwind: '$items' },
        { $group: {
          _id: '$items.name',
          qty: { $sum: '$items.quantity' },
          revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
        } },
        { $sort: { qty: -1 } },
        { $limit: 10 },
      ]),
    ]);

    const o = orderKpis[0] || { orders: 0, grossSales: 0, revenue: 0, tax: 0, serviceCharge: 0, tips: 0 };
    const e = expenseKpis[0] || { expenses: 0, count: 0 };
    const p = purchaseKpis[0] || { purchases: 0, paid: 0, count: 0 };
    // totalCost uses the FULL purchase total (accrual basis: the stock was
    // received in this period). purchasesPaid is also returned so the UI can
    // show the cash actually paid (credit/partial purchases), which previously
    // was computed but never displayed.
    const totalCost = (e.expenses || 0) + (p.purchases || 0);
    const profit = (o.revenue || 0) - totalCost;
    const margin = o.revenue ? Math.round((profit / o.revenue) * 1000) / 10 : 0;
    const avgOrderValue = o.orders ? Math.round((o.revenue / o.orders) * 100) / 100 : 0;

    // Merge the three series into one timeline keyed by bucket.
    const seriesMap = new Map<string, { bucket: string; label: string; sales: number; revenue: number; expenses: number; purchases: number; profit: number }>();
    const ensure = (b: string) => {
      if (!seriesMap.has(b)) {
        seriesMap.set(b, {
          bucket: b,
          label: bucketByMonth ? b : b.slice(5),
          sales: 0, revenue: 0, expenses: 0, purchases: 0, profit: 0,
        });
      }
      return seriesMap.get(b)!;
    };
    for (const s of orderSeries) { const r = ensure(s._id); r.sales = s.sales; r.revenue = s.revenue; }
    for (const s of expenseSeries) { const r = ensure(s._id); r.expenses = s.expenses; }
    for (const s of purchaseSeries) { const r = ensure(s._id); r.purchases = s.purchases; }
    const series = [...seriesMap.values()]
      .sort((a, b) => a.bucket.localeCompare(b.bucket))
      .map((r) => ({ ...r, profit: r.revenue - r.expenses - r.purchases }));

    return ok({
      meta: { from: from.toISOString(), to: to.toISOString(), label, currency, bucketBy: bucketByMonth ? 'month' : 'day' },
      kpis: {
        orders: o.orders || 0,
        grossSales: o.grossSales || 0,
        revenue: o.revenue || 0,
        tax: o.tax || 0,
        serviceCharge: o.serviceCharge || 0,
        tips: o.tips || 0,
        expenses: e.expenses || 0,
        expenseCount: e.count || 0,
        purchases: p.purchases || 0,
        purchaseCount: p.count || 0,
        purchasesPaid: p.paid || 0,
        totalCost,
        profit,
        margin,
        avgOrderValue,
      },
      series,
      breakdowns: {
        expenseByCategory: expenseByCat.map((x) => ({ category: x._id, amount: x.amount })),
        purchaseByCategory: purchaseByCat.map((x) => ({ category: x._id, amount: x.amount, paid: x.paid })),
        revenueByPaymentMethod: revByPayment.map((x) => ({ method: x._id || 'unknown', revenue: x.revenue, count: x.count })),
        topItems: topItemsAgg.map((x) => ({ name: x._id, qty: x.qty, revenue: x.revenue })),
      },
    });
  } catch (err) {
    return serverError(err);
  }
}

/** Resolve the named ranges (non-today) in IST. */
function resolveNamedRange(range: string): { from: Date; to: Date; label: string } {
  const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
  const shifted = new Date(Date.now() + IST_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  const d = shifted.getUTCDate();
  const endTodayIST = new Date(Date.UTC(y, m, d, 23, 59, 59, 999) - IST_OFFSET_MS);
  const startTodayIST = new Date(Date.UTC(y, m, d) - IST_OFFSET_MS);
  switch (range) {
    case 'yesterday':
      return {
        from: new Date(startTodayIST.getTime() - 86400000),
        to: new Date(startTodayIST.getTime() - 1),
        label: 'yesterday',
      };
    case '7d':
      return { from: new Date(startTodayIST.getTime() - 6 * 86400000), to: endTodayIST, label: '7d' };
    case '30d':
      return { from: new Date(startTodayIST.getTime() - 29 * 86400000), to: endTodayIST, label: '30d' };
    case 'month':
      return { from: new Date(Date.UTC(y, m, 1) - IST_OFFSET_MS), to: endTodayIST, label: 'month' };
    case 'lastmonth': {
      const lastMonthIdx = m === 0 ? 11 : m - 1;
      const lastMonthYear = m === 0 ? y - 1 : y;
      return {
        from: new Date(Date.UTC(lastMonthYear, lastMonthIdx, 1) - IST_OFFSET_MS),
        to: new Date(Date.UTC(y, m, 1) - IST_OFFSET_MS - 1),
        label: 'lastmonth',
      };
    }
    case 'year':
      return { from: new Date(Date.UTC(y, 0, 1) - IST_OFFSET_MS), to: endTodayIST, label: 'year' };
    default:
      return { from: startTodayIST, to: endTodayIST, label: 'today' };
  }
}
