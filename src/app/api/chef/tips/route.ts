import { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import Order from '@/models/Order';
import User from '@/models/User';
import TipWithdrawal from '@/models/TipWithdrawal';
import { resolveSessionForRoles } from '@/lib/auth';
import { ok, fail, unauthorized } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * GET /api/chef/tips
 *
 * Returns the signed-in chef's complete tips picture, so the Chef Tips page
 * can render a balance card, a date-wise breakdown of earned tips, and a
 * history of past withdrawals. Mirrors /api/staff/tips but filters on chefId.
 *
 * IMPORTANT — tip split: when a customer leaves a tip on an order, it is split
 * equally between the chef (order.chefId, who cooked it) and the staff
 * (order.staffId, who served it). So a chef's earned tip for an order is:
 *   - full Order.tip   if only the chef was assigned (no staff)
 *   - half Order.tip   if both chef + staff were assigned
 *   - 0                if the chef was not assigned to the order
 * The byDate aggregation applies this split per-order so the daily ledger
 * matches the chef's actual credited balance (User.tipsEarned).
 *
 * Response shape:
 *   {
 *     summary: { tipsEarned, tipsWithdrawn, available, pendingSince },
 *     byDate: [{ date, orders, tips }],          // oldest -> newest, tips>0 only
 *     withdrawals: [{ _id, amount, from, to, note, status, createdAt }]
 * }
 */
export async function GET(req: NextRequest) {
  const session = await resolveSessionForRoles(req, ['admin', 'chef'], 'chef');
  if (!session) return unauthorized('Your session has expired — please sign in again');

  await dbConnect();

  // 1. Balance from the user doc (the source of truth for earned + withdrawn).
  const chef: any = await User.findById(session.userId).lean();
  if (!chef) return fail('Account not found', 404);
  if (chef.role !== 'chef') return fail('This account is not a chef account', 403);

  const tipsEarned = Number(chef.tipsEarned) || 0;
  const tipsWithdrawn = Number(chef.tipsWithdrawn) || 0;
  const available = Math.max(0, tipsEarned - tipsWithdrawn);

  // 2. Date-wise breakdown of earned tips. Per-order the chef earns the full
  //    tip when they were the only assignee, or half when staff was also
  //    assigned. We compute the per-order earned share with $cond, then group
  //    by the calendar date of completedAt (when the tip was realized).
  const byDateAgg = await Order.aggregate<{
    _id: string; // YYYY-MM-DD
    orders: number;
    tips: number;
  }>([
    {
      $match: {
        chefId: chef._id,
        tip: { $gt: 0 },
        paymentStatus: 'paid',
        completedAt: { $exists: true, $ne: null },
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$completedAt', timezone: 'Asia/Kolkata' } },
        orders: { $sum: 1 },
        // chef earns full tip when no staff, half when staff also assigned.
        tips: {
          $sum: {
            $cond: [
              { $and: [{ $ifNull: ['$staffId', null] }, { $ne: ['$staffId', null] }] },
              { $divide: ['$tip', 2] },
              '$tip',
            ],
          },
        },
      },
    },
    { $sort: { _id: 1 } }, // oldest date first
  ]);

  const byDate = byDateAgg.map((d) => ({
    date: d._id,
    orders: d.orders,
    tips: Number(d.tips.toFixed(2)),
  }));

  // 3. Withdrawal history (newest first, last 50).
  const withdrawals = await TipWithdrawal.find({ staffId: chef._id })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  // 4. Earliest un-withdrawn earning date (for the "available since" hint).
  const pendingSince = byDate.length > 0 ? byDate[0].date : null;

  return ok({
    summary: {
      tipsEarned: Number(tipsEarned.toFixed(2)),
      tipsWithdrawn: Number(tipsWithdrawn.toFixed(2)),
      available: Number(available.toFixed(2)),
      pendingSince,
    },
    byDate,
    withdrawals: withdrawals.map((w) => ({
      _id: String(w._id),
      amount: Number(w.amount.toFixed(2)),
      from: w.from || null,
      to: w.to || null,
      note: w.note || '',
      status: w.status,
      createdAt: w.createdAt,
    })),
  });
}
