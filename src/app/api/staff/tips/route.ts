import { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import Order from '@/models/Order';
import User from '@/models/User';
import TipWithdrawal from '@/models/TipWithdrawal';
import { resolveSessionForRoles } from '@/lib/auth';
import { ok, fail, unauthorized } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * GET /api/staff/tips
 *
 * Returns the signed-in staff's complete tips picture, so the Tips page can
 * render a balance card, a date-wise breakdown of earned tips, and a history
 * of past withdrawals.
 *
 * Response shape:
 *   {
 *     summary: { tipsEarned, tipsWithdrawn, available, pendingSince },
 *     byDate: [{ date, orders, tips }],          // oldest -> newest, tips>0 only
 *     withdrawals: [{ _id, amount, from, to, note, status, createdAt }]
 *   }
 *
 * - tipsEarned: cumulative total of tips on orders this staff served that
 *   have been PAID (the customer settled the bill + left a tip). Pulled from
 *   the User doc, which is incremented atomically in the pay action.
 * - tipsWithdrawn: cumulative total the staff has already withdrawn. From
 *   the User doc.
 * - available: tipsEarned - tipsWithdrawn (the balance they can withdraw now).
 * - byDate: an aggregation of paid orders (tip > 0, staffId == me), grouped
 *   by the calendar date of completedAt. Lets the staff pick a specific date
 *   (or range) to withdraw just those days' tips.
 * - withdrawals: their withdrawal ledger, newest first (last 50).
 */
export async function GET(req: NextRequest) {
  const session = await resolveSessionForRoles(req, ['admin', 'staff'], 'staff');
  if (!session) return unauthorized('Your session has expired — please sign in again');

  await dbConnect();

  // 1. Balance from the user doc (the source of truth for earned + withdrawn).
  const staff: any = await User.findById(session.userId).lean();
  if (!staff) return fail('Account not found', 404);
  if (staff.role !== 'staff') return fail('This account is not a staff account', 403);

  const tipsEarned = Number(staff.tipsEarned) || 0;
  const tipsWithdrawn = Number(staff.tipsWithdrawn) || 0;
  const available = Math.max(0, tipsEarned - tipsWithdrawn);

  // 2. Date-wise breakdown of earned tips. We aggregate the paid orders that
  //    carry a tip and were served by THIS staff. Grouping by the date part of
  //    completedAt (the moment the tip was realized) gives a clean daily ledger.
  //    $dateToString normalizes to the staff's local day (Asia/Dhaka) so the
  //    table matches what they expect on their calendar.
  const byDateAgg = await Order.aggregate<{
    _id: string; // YYYY-MM-DD
    orders: number;
    tips: number;
  }>([
    {
      $match: {
        staffId: staff._id,
        tip: { $gt: 0 },
        paymentStatus: 'paid',
        completedAt: { $exists: true, $ne: null },
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$completedAt', timezone: 'Asia/Dhaka' } },
        orders: { $sum: 1 },
        // staff earns the full tip when no chef was assigned, half when a
        // chef was also assigned (the 50/50 tip split). This keeps the daily
        // ledger in sync with User.tipsEarned, which is credited the same way
        // in the pay action.
        tips: {
          $sum: {
            $cond: [
              { $and: [{ $ifNull: ['$chefId', null] }, { $ne: ['$chefId', null] }] },
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

  // 3. Withdrawal history (newest first, last 50). Enough to show a full
  //    ledger without pulling the whole history each poll.
  const withdrawals = await TipWithdrawal.find({ staffId: staff._id })
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
