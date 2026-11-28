import { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import { resolveCustomerSessionId } from '@/lib/auth';
import { ok, fail } from '@/lib/utils';
import { invoicePageUrl } from '@/lib/invoice';

export const dynamic = 'force-dynamic';

/**
 * GET /api/invoice/my-url
 *   Returns the customer's own invoice page URL (with a freshly-minted signed
 *   token) for the current dining session. Used by the Thank You screen's
 *   "View invoice online" link so the customer doesn't need the token client-
 *   side (JWT_SECRET never leaves the server).
 *
 *   Auth: the customer's session cookie (resolveCustomerSessionId). No
 *   admin/staff token is accepted — a customer can only ever mint their own
 *   invoice link.
 *
 *   Response: { url: string }   (e.g. https://app.vercel.app/invoice/<sid>?t=<hex>)
 */
export async function GET(req: NextRequest) {
  // Resolve the session cookie BEFORE touching the database: an anonymous
  // request (no cookie) should get a clean 401 even if MONGODB_URI is not
  // configured, rather than a 500 from dbConnect. Only paying customers
  // (who have a session cookie) should incur a DB round-trip.
  const custSessionId = await resolveCustomerSessionId(req);
  if (!custSessionId) return fail('No active dining session', 401);
  await dbConnect();
  // invoicePageUrl already builds the full public URL + signed token.
  return ok({ url: invoicePageUrl(custSessionId) });
}
