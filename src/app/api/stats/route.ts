import { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import Order from '@/models/Order';
import Table from '@/models/Table';
import MenuItem from '@/models/MenuItem';
import Review from '@/models/Review';
import { getSession } from '@/lib/auth';
import { ok, unauthorized, forbidden, serverError } from '@/lib/utils';
import { startOfIStDay, endOfIStDay } from '@/lib/dateRange';

export const dynamic = 'force-dynamic';

// GET /api/stats  -> admin dashboard summary numbers (today, IST)
export async function GET(_req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return unauthorized();
    if (session.role !== 'admin') return forbidden();

    await dbConnect();

    // IST calendar day boundaries (server was previously UTC, which split the
    // restaurant's dinner service across two "today" views).
    const from = startOfIStDay();
    const to = endOfIStDay();

    const [
      todayOrders,
      todayRevenueAgg,
      activeTablesAgg,
      totalMenuItems,
      pendingOrders,
      preparingOrders,
      readyOrders,
      reviewAgg,
      topItems,
    ] = await Promise.all([
      // Today's orders = placed today (any status, so the count reflects the
      // number of bills the kitchen has seen today, not just paid ones).
      Order.countDocuments({ createdAt: { $gte: from, $lte: to } }),
      // Today's REVENUE = subtotal + tax + serviceCharge of PAID, non-cancelled
      // orders placed today. Excludes tip (tip is a passthrough to staff/chef,
      // not restaurant revenue) — matches the Reports page policy. Previously
      // this summed `$total` which INCLUDES the tip, so the dashboard showed
      // a different revenue figure than the Reports page for the same day.
      Order.aggregate([
        {
          $match: {
            createdAt: { $gte: from, $lte: to },
            paymentStatus: 'paid',
            status: { $ne: 'cancelled' },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: { $add: ['$subtotal', '$taxAmount', '$serviceChargeAmount'] } },
            tips: { $sum: '$tip' },
          },
        },
      ]),
      Table.countDocuments({ currentSession: { $exists: true, $ne: null } }),
      MenuItem.countDocuments(),
      Order.countDocuments({ status: 'pending' }),
      Order.countDocuments({ status: 'preparing' }),
      Order.countDocuments({ status: 'ready' }),
      // Average rating over today's reviews (was: all-time, which disagreed
      // with the dashboard's "Today" framing).
      Review.aggregate([
        { $match: { createdAt: { $gte: from, $lte: to } } },
        { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
      ]),
      // Top selling items TODAY, only paid non-cancelled orders. Previously
      // this used a 30-day window with no payment/cancel filter, so cancelled
      // and unpaid orders inflated the "Today's Top Items" list (and it was
      // shown even when today had zero paid orders).
      Order.aggregate([
        {
          $match: {
            createdAt: { $gte: from, $lte: to },
            paymentStatus: 'paid',
            status: { $ne: 'cancelled' },
          },
        },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.name',
            qty: { $sum: '$items.quantity' },
            revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
          },
        },
        { $sort: { qty: -1 } },
        { $limit: 5 },
      ]),
    ]);

    const rev = todayRevenueAgg[0] || { total: 0, tips: 0 };
    const revSummary = reviewAgg[0] || { avg: 0, count: 0 };

    // totalReviews stays all-time (the dashboard card shows "N reviews" as a
    // cumulative count) but the average is today-scoped so the two numbers
    // don't disagree about the window.
    const allTimeReviews = await Review.countDocuments();

    return ok({
      todayOrders,
      todayRevenue: rev.total || 0,
      todayTips: rev.tips || 0,
      activeTables: activeTablesAgg,
      totalMenuItems,
      pendingOrders,
      preparingOrders,
      readyOrders,
      averageRating: Math.round((revSummary.avg || 0) * 10) / 10,
      todayReviews: revSummary.count || 0,
      totalReviews: allTimeReviews,
      topItems,
    });
  } catch (err) {
    return serverError(err);
  }
}
