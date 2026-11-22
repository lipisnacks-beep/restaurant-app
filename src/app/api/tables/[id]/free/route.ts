import { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import Table from '@/models/Table';
import CustomerSession from '@/models/CustomerSession';
import { resolveSession } from '@/lib/auth';
import { ok, fail, unauthorized, forbidden } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * POST /api/tables/[id]/free
 *   Staff/admin marks a table as free for the next guest.
 *
 *   - Closes the CustomerSession currently bound to the table (status='closed',
 *     closedAt=now) so the visit is preserved for reporting.
 *   - Clears the table's currentSession so it shows as Free in the admin panel.
 *
 * This is intentionally a separate action from "complete order": staff should
 * only free the table once the customers have physically left. The customer's
 * payment+review may already be done (session status 'completed') or, in rare
 * cases, still pending (admin can force-free).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await resolveSession(req, 'any');
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

  // Close the dining session record (keep it for history).
  await CustomerSession.updateOne(
    { sessionId: currentSessionId, status: { $ne: 'closed' } },
    { $set: { status: 'closed', closedAt: new Date() } },
  );

  // Clear the table's current session so it's free for the next guest.
  table.currentSession = undefined;
  await table.save();

  return ok({ table, freed: true });
}
