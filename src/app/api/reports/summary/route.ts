import { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import Order from '@/models/Order';
import Expense from '@/models/Expense';
import Purchase from '@/models/Purchase';
import { getSettings } from '@/lib/settings';
import { getSession } from '@/lib/auth';
import { ok, fail, unauthorized, forbidden } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/** Resolve a {from,to} range (inclusive) from the ?range= preset or ?from=&to=. */
function resolveRange(q: URLSearchParams): { from: Date; to: Date; label: string } {
  const now = new Date();
  const fromQ = q.get('from');
  const toQ = q.get('to');
  if (fromQ && toQ) {
    const from = new Date(fromQ); from.setHours(0, 0, 0, 0);
    const to = new Date(toQ); to.setHours(23, 59, 59, 999);
    return { from, to, label: 'custom' };
  }
  const range = q.get('range') || 'today';
  const from = new Date(now);
  const to = new Date(now);
  to.setHours(23, 59, 59, 999);
  switch (range) {
    case 'yesterday':
      from.setDate(now.getDate() - 1); from.setHours(0, 0, 0, 0);
      return { from, to, label: 'yesterday' };
    case '7d':
      from.setDate(now.getDate() - 6); from.setHours(0, 0, 0, 0);
      return { from, to, label: '7d' };
    case '30d':
      from.setDate(now.getDate() - 29); from.setHours(0, 0, 0, 0);
      return { from, to, label: '30d' };
    case 'month':
      from.setDate(1); from.setHours(0, 0, 0, 0);
      return { from, to, label: 'month' };
    case 'lastmonth': {
      from.setMonth(now.getMonth() - 1, 1); from.setHours(0, 0, 0, 0);
      to.setFullYear(now.getFullYear(), now.getMonth(), 0); to.setHours(23, 59, 59, 999);
      return { from, to, label: 'lastmonth' };
    }
    case 'year':
      from.setMonth(0, 1); from.setHours(0, 0, 0, 0);
      return { from, to, label: 'year' };
    case 'today':
    default:
      from.setHours(0, 0, 0, 0);
      return { from, to, label: 'today' };
  }
}

/**
 * GET /api/reports/summary?range=today|yesterday|7d|30d|month|lastmonth|year
 * GET /api/reports/summary?from=ISO&to=ISO   (custom range)
 *
 * Admin-only. Returns:
 *   - KPIs: orders, grossSales, revenue, tax, serviceCharge, tips, expenses,
 *           purchases, totalCost, profit, margin, avgOrderValue
 *   - series: [{ bucket, label, sales, revenue, expenses, purchases, profit }]
 *       bucketed by day for <=31-day ranges, else by month
 *   - breakdowns: expenseByCategory, purchaseByCategory, revenueByPaymentMethod,
 *                 topItems (name, qty, revenue)
 *   - meta: { from, to, label, currencySymbol }
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== 'admin') return forbidden();

  await dbConnect();
  const q = new URL(req.url).searchParams;
  const { from, to, label } = resolveRange(q);
  const settings = await getSettings();
  const currency = settings.currencySymbol || '₹';

  // Paid orders within the range. "revenue" = money actually collected by the
  // restaurant = subtotal + tax + serviceCharge. Tips are NOT restaurant income
  // — they are a passthrough to the staff and chef who served the order — so
  // they are excluded from revenue (and therefore from profit) and reported
  // separately as `tips`. "grossSales" = subtotal (food value).
  // NOTE: Order.total DOES include the tip (it is what the customer paid at the
  // counter), so we must NOT sum '$total' here or tips would inflate revenue.
  const orderMatch = {
    createdAt: { $gte: from, $lte: to },
    paymentStatus: 'paid',
  };

  const bucketByMonth = (to.getTime() - from.getTime()) > 31 * 86400000;
  const dateBucket = bucketByMonth
    ? { $dateToString: { format: '%Y-%m', date: '$createdAt' } }
    : { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } };

  // Restaurant revenue (excludes tips): subtotal + tax + serviceCharge.
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
      { $group: { _id: dateBucket, purchases: { $sum: '$total' } } },
      { $sort: { _id: 1 } },
    ]),
    Expense.aggregate([
      { $match: { date: { $gte: from, $lte: to } } },
      { $group: { _id: '$category', amount: { $sum: '$amount' } } },
      { $sort: { amount: -1 } },
    ]),
    Purchase.aggregate([
      { $match: { date: { $gte: from, $lte: to } } },
      { $group: { _id: '$category', amount: { $sum: '$total' } } },
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
        label: bucketByMonth ? b : b.slice(5),  // YYYY-MM -> MM-DD
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
      purchaseByCategory: purchaseByCat.map((x) => ({ category: x._id, amount: x.amount })),
      revenueByPaymentMethod: revByPayment.map((x) => ({ method: x._id || 'unknown', revenue: x.revenue, count: x.count })),
      topItems: topItemsAgg.map((x) => ({ name: x._id, qty: x.qty, revenue: x.revenue })),
    },
  });
}
