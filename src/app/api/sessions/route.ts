import { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import CustomerSession from '@/models/CustomerSession';
import { getSession } from '@/lib/auth';
import { ok, fail, unauthorized, forbidden } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sessions?status=active  -> list dining sessions
 *   - status=active : currently seated diners (occupied-time live ticker)
 *   - status=all / omitted : recent sessions (history + occupied time)
 *
 * Returns sessions enriched with the occupied duration in ms so the admin UI
 * can render both live and final occupancy times.
 */
export async function GET(req: NextRequest) {
  const session = await getSession('any');
  if (!session) return unauthorized();
  if (!['admin', 'staff'].includes(session.role)) return forbidden();

  await dbConnect();
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');
  const limit = Math.min(Number(searchParams.get('limit') || '50'), 200);

  const filter: Record<string, unknown> = {};
  if (status && status !== 'all') {
    filter.status = status;
  }

  const sessions = await CustomerSession.find(filter)
    .sort({ startedAt: -1 })
    .limit(limit)
    .lean();

  const now = Date.now();
  const enriched = sessions.map((s: any) => {
    const start = new Date(s.startedAt).getTime();
    const end = s.endedAt ? new Date(s.endedAt).getTime() : now;
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

  // Summary stats for the admin: currently occupied count, avg occupancy today.
  const activeCount = enriched.filter((s) => s.status === 'active' || s.status === 'paid' || s.status === 'completed').length;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todaySessions = await CustomerSession.countDocuments({ startedAt: { $gte: todayStart } });

  return ok({ sessions: enriched, activeCount, todaySessions });
}
