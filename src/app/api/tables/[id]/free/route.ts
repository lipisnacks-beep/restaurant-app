import { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import Table from '@/models/Table';
import CustomerSession from '@/models/CustomerSession';
import Order from '@/models/Order';
import { resolveSessionForRoles } from '@/lib/auth';
import { ok, fail, unauthorized, forbidden, serverError } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * POST /api/tables/[id]/free
 *   Staff/admin marks a table as free for the next guest.
 *
 *   - Closes the CustomerSession currently bound to the table (status='closed',
 *     closedAt=now, endedAt set if it was missing) so the visit is preserved
 *     for reporting and the occupied-time stops ticking.
 *   - Clears the table's currentSession so it shows as Free in the admin panel.
 *
 * This is intentionally a separate action from "complete order": staff should
 * only free the table once the customers have physically left — regardless of
 * whether the customer paid through the app (session 'paid'/'completed') or
 * settled cash at the counter without touching the pay screen (session still
 * 'active'). The UI confirms before freeing either way.
 *
 * Ownership gate — a non-admin staff may free the table if ANY of:
 *   1. They are the recorded serving staff (table.currentSession.servedByStaffId).
 *   2. No serving staff was recorded (admin-served unrouted order, legacy/seed
 *      order without a `table` ref, or pre-feature data) — any staff may claim
 *      it, otherwise the table could NEVER be freed by staff and would sit
 *      occupied until an admin intervened.
 *   3. They served ANY order in this dining session (Order.sessionId match) —
 *      covers multi-staff tables where the recorded server is only the LAST
 *      person who delivered, and legacy orders whose serve action couldn't
 *      stamp the table.
 * Admin can always force-free.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    // Resolve by allowed role (staff/admin) so a browser signed in as both chef
    // and staff doesn't authenticate the chef here and get rejected.
    const session = await resolveSessionForRoles(req, ['admin', 'staff'], 'staff');
    if (!session) return unauthorized('Your session has expired — please sign in again');
    if (!['admin', 'staff'].includes(session.role)) {
      return forbidden(`Only staff or admin can free a table (your role: ${session.role})`);
    }

    await dbConnect();
    const table = await Table.findById(params.id);
    if (!table) return fail('Table not found', 404);

    const currentSessionId = table.currentSession?.sessionId;
    if (!currentSessionId) {
      return ok({ table, alreadyFree: true, message: 'Table is already free' });
    }

    if (session.role === 'staff') {
      const servedBy = table.currentSession?.servedByStaffId;
      const isRecordedServer = !!servedBy && String(servedBy) === String(session.userId);
      const isUnclaimed = !servedBy;

      let servedInSession = false;
      if (!isRecordedServer && !isUnclaimed) {
        // Rule 3: did THIS staff serve any order for this dining session?
        // (Multi-staff tables, and orders whose serve couldn't stamp the table
        // because the legacy order doc had no `table` reference.)
        servedInSession =
          (await Order.countDocuments({
            sessionId: currentSessionId,
            staffId: session.userId,
            status: { $in: ['served', 'completed'] },
          })) > 0;
      }

      if (!isRecordedServer && !isUnclaimed && !servedInSession) {
        return forbidden(
          'You did not serve this table — only the staff who served it can free it.',
        );
      }
    }

    // Close the dining session record (keep it for history). Set endedAt too
    // if it was never set (a force-free of an unpaid session): otherwise the
    // Sessions panel's occupied-time kept ticking forever for closed sessions
    // with no endedAt.
    const now = new Date();
    await CustomerSession.updateOne(
      { sessionId: currentSessionId, status: { $ne: 'closed' } },
      { $set: { status: 'closed', closedAt: now, endedAt: now } },
    );
    // For sessions already 'closed' but with no endedAt (legacy), backfill it.
    await CustomerSession.updateOne(
      { sessionId: currentSessionId, status: 'closed', endedAt: { $exists: false } },
      { $set: { endedAt: now } },
    );

    // Clear the table's current session so it's free for the next guest.
    table.currentSession = undefined;
    await table.save();

    return ok({ table, freed: true });
  } catch (err) {
    return serverError(err);
  }
}
