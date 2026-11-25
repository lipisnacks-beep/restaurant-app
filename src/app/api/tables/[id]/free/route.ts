import { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import Table from '@/models/Table';
import CustomerSession from '@/models/CustomerSession';
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
 * only free the table once the customers have physically left. The customer's
 * payment+review may already be done (session status 'completed') or, in rare
 * cases, still pending (admin can force-free).
 *
 * Ownership gate: only the staff who SERVED this table's customers
 * (table.currentSession.servedByStaffId) may free it. The customer's payment
 * flows to whoever physically brought the food, so the free-table action does
 * too. Admin can always force-free. If no servedByStaffId is recorded (e.g.
 * the table was served before this feature shipped), any staff may free it.
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

    // Ownership: a non-admin staff may only free a table THEY served. The table's
    // servedByStaffId is set when the staff serves an order for that session.
    const servedBy = table.currentSession?.servedByStaffId;
    if (
      session.role === 'staff' &&
      servedBy &&
      String(servedBy) !== String(session.userId)
    ) {
      return forbidden(
        'You did not serve this table — only the staff who served it can free it.',
      );
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
