import { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import CustomerSession from '@/models/CustomerSession';
import { getSession } from '@/lib/auth';
import { ok, fail, unauthorized, forbidden, serverError } from '@/lib/utils';
import { startOfIStDay, endOfIStDay } from '@/lib/dateRange';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sessions?status=active|finished|all  -> list dining sessions
 *   - status=active    : currently seated diners (status === 'active')
 *   - status=finished  : paid / completed / closed (functionally done dining)
 *   - status=all / omitted : recent sessions (history + occupied time)
 *
 * Also returns summary aggregates computed SERVER-SIDE over ALL matching
 * sessions (not just the page-limited list), so the admin's "Session Revenue"
 * / "Avg Occupied Time" / counts are accurate even when there are more
 * sessions than the page limit. The previous code computed these from the
 * page-limited array, under-reporting whenever sessions exceeded the limit.
 *
 * "today" is the IST calendar day (the server was previously UTC, which split
 * the restaurant's dinner service across two days).
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getSession('any');
    if (!session) return unauthorized();
    if (!['admin', 'staff'].includes(session.role)) return forbidden();

    await dbConnect();
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const limit = Math.min(Number(searchParams.get('limit') || '50'), 200);

    const filter: Record<string, unknown> = {};
    if (status && status !== 'all') {
      if (status === 'finished') {
        // "Finished" means functionally done dining: paid, completed, or
        // closed. Previously the client sent status='closed' which silently
        // excluded 'paid' and 'completed' sessions from the Finished view.
        filter.status = { $in: ['paid', 'completed', 'closed'] };
      } else {
        filter.status = status;
      }
    }

    const sessions = await CustomerSession.find(filter)
      .sort({ startedAt: -1 })
      .limit(limit)
      .lean();

    const now = Date.now();
    const enriched = sessions.map((s: any) => {
      const start = new Date(s.startedAt).getTime();
      // For a closed session that never got an endedAt (force-freed without
      // payment), fall back to closedAt so the duration stops ticking instead
      // of growing forever. For an active session, use now.
      const endRef = s.endedAt || s.closedAt;
      const end = endRef ? new Date(endRef).getTime() : now;
      const occupiedMs = Math.max(0, end - start);
      return {
        _id: String(s._id),
        sessionId: s.sessionId,
        customerName: s.customerName,
        mobile: s.mobile,
        tableNumber: s.tableNumber,
        status: s.status,
        startedAt: s.startedAt,
        endedAt: s.endedAt || null,
        reviewAt: s.reviewAt || null,
        closedAt: s.closedAt || null,
        orderCount: s.orderCount,
        subtotal: s.subtotal,
        taxAmount: s.taxAmount,
        serviceChargeAmount: s.serviceChargeAmount,
        tip: s.tip,
        total: s.total,
        occupiedMs,
      };
    });

    // ---- Server-side aggregates over ALL matching sessions (no page cap) ----
    // "Currently occupied" = only status === 'active' (paid/completed are
    // functionally done, even if the table hasn't been freed yet).
    const activeCount = await CustomerSession.countDocuments({ status: 'active' });

    // Today's sessions = started today (IST).
    const todayFrom = startOfIStDay();
    const todayTo = endOfIStDay();
    const todaySessions = await CustomerSession.countDocuments({
      startedAt: { $gte: todayFrom, $lte: todayTo },
    });

    // Session revenue + tips + avg occupied time over ALL closed/paid/completed
    // sessions matching the list filter (so the cards match the visible list's
    // scope, not just the latest 100).
    const finishedFilter = filter.status ? filter : { status: { $in: ['paid', 'completed', 'closed'] } };
    const agg: any[] = await CustomerSession.aggregate([
      { $match: finishedFilter },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$total' },
          totalTips: { $sum: '$tip' },
          count: { $sum: 1 },
          // average occupied time in ms over sessions that have a real end
          avgOccupiedMs: {
            $avg: {
              $cond: [
                { $ne: ['$endedAt', null] },
                { $max: [0, { $subtract: ['$endedAt', '$startedAt'] }] },
                null,
              ],
            },
          },
        },
      },
    ]);
    const a = agg[0] || { totalRevenue: 0, totalTips: 0, count: 0, avgOccupiedMs: 0 };

    return ok({
      sessions: enriched,
      activeCount,
      todaySessions,
      // Aggregates over the full matching set (not the page-limited slice).
      sessionRevenue: a.totalRevenue || 0,
      sessionTips: a.totalTips || 0,
      finishedCount: a.count || 0,
      avgOccupiedMs: Math.round(a.avgOccupiedMs || 0),
    });
  } catch (err) {
    return serverError(err);
  }
}
