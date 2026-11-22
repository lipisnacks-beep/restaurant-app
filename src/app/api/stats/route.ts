import { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import Order from '@/models/Order';
import Table from '@/models/Table';
import MenuItem from '@/models/MenuItem';
import Review from '@/models/Review';
import { getSession } from '@/lib/auth';
import { ok, unauthorized, forbidden } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// GET /api/stats  -> admin dashboard summary numbers
export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== 'admin') return forbidden();

  await dbConnect();

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [
    todayOrders,
    todayRevenueAgg,
    activeTablesAgg,
    totalMenuItems,
    pendingOrders,
    preparingOrders,
    readyOrders,
    reviewAgg,
  ] = await Promise.all([
    Order.countDocuments({ createdAt: { $gte: startOfDay } }),
    Order.aggregate([
      { $match: { createdAt: { $gte: startOfDay }, paymentStatus: 'paid' } },
      { $group: { _id: null, total: { $sum: '$total' }, tips: { $sum: '$tip' } } },
    ]),
    Table.countDocuments({ currentSession: { $exists: true, $ne: null } }),
    MenuItem.countDocuments(),
    Order.countDocuments({ status: 'pending' }),
    Order.countDocuments({ status: 'preparing' }),
    Order.countDocuments({ status: 'ready' }),
    Review.aggregate([
      { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]),
  ]);

  const rev = todayRevenueAgg[0] || { total: 0, tips: 0 };
  const revSummary = reviewAgg[0] || { avg: 0, count: 0 };

  // Top selling items (last 30 days)
  const topItems = await Order.aggregate([
    { $match: { createdAt: { $gte: new Date(Date.now() - 30 * 86400000) } } },
    { $unwind: '$items' },
    { $group: { _id: '$items.name', qty: { $sum: '$items.quantity' }, revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } } } },
    { $sort: { qty: -1 } },
    { $limit: 5 },
  ]);

  return ok({
    todayOrders,
    todayRevenue: rev.total,
    todayTips: rev.tips,
    activeTables: activeTablesAgg,
    totalMenuItems,
    pendingOrders,
    preparingOrders,
    readyOrders,
    averageRating: Math.round((revSummary.avg || 0) * 10) / 10,
    totalReviews: revSummary.count,
    topItems,
  });
}
