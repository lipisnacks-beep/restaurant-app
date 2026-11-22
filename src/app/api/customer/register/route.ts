import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import Customer from '@/models/Customer';
import CustomerSession from '@/models/CustomerSession';
import Table from '@/models/Table';
import {
  setCustomerSessionCookie,
  clearCustomerSessionCookie,
  generateCustomerSessionId,
  getCustomerSessionId,
} from '@/lib/auth';
import { ok, fail } from '@/lib/utils';

/** Like ok() but returns a NextResponse so we can attach cookies. */
function okRes(data: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, { status: 200, ...init });
}

export const dynamic = 'force-dynamic';

/**
 * Indian mobile validation: 10 digits starting with 6-9. We store digits only.
 */
function normaliseMobile(raw: string): string {
  return (raw || '').replace(/\D/g, '');
}
function isValidMobile(mobile: string): boolean {
  return /^[6-9]\d{9}$/.test(mobile);
}

/**
 * POST /api/customer/register
 *   body: { name, mobile, tableNumber }
 *
 * Called when a customer scans the table QR. Upserts the Customer by mobile
 * (so a returning guest doesn't get a duplicate), opens a CustomerSession for
 * this table+visit, marks the table occupied, and sets the
 * rms_customer_session cookie.
 *
 * If the table is already occupied by a DIFFERENT session, we refuse — that
 * table should be freed by staff first. If the same customer re-scans, we
 * return their existing active session (idempotent).
 */
export async function POST(req: NextRequest) {
  await dbConnect();
  const body = await req.json();
  const { name, mobile, tableNumber } = body || {};

  const cleanName = String(name || '').trim();
  const cleanMobile = normaliseMobile(String(mobile || ''));
  const tNum = Number(tableNumber);

  if (!cleanName) return fail('Name is required', 422);
  if (!isValidMobile(cleanMobile)) {
    return fail('Please enter a valid 10-digit Indian mobile number', 422);
  }
  if (!tNum || tNum < 1) return fail('Table number is required', 422);

  const table = await Table.findOne({ number: tNum, active: true });
  if (!table) return fail('This table is not active — please ask a staff member', 404);

  // Idempotent re-scan: if this browser already has a customer session cookie
  // for this table, return it.
  const existingCookieId = await getCustomerSessionId();
  if (existingCookieId) {
    const existing = await CustomerSession.findOne({ sessionId: existingCookieId });
    if (existing && existing.tableNumber === tNum && existing.status === 'active') {
      const cust = await Customer.findById(existing.customer).lean();
      const res = okRes({
        session: serializeSession(existing),
        customer: cust ? { _id: cust._id, name: cust.name, mobile: cust.mobile } : null,
        resumed: true,
      });
      setCustomerSessionCookie(res, existing.sessionId);
      return res;
    }
  }

  // Refuse if the table is currently occupied by a different active diner.
  if (table.currentSession?.sessionId) {
    const occ = await CustomerSession.findOne({ sessionId: table.currentSession.sessionId });
    if (occ && occ.status === 'active') {
      const sameMobile = occ.mobile === cleanMobile;
      if (!sameMobile) {
        return fail('This table is currently occupied. Please ask staff to free it or seat you elsewhere.', 409);
      }
      // Same customer re-scanning on the same table: resume their session.
      const cust = await Customer.findById(occ.customer).lean();
      const res = okRes({
        session: serializeSession(occ),
        customer: cust ? { _id: cust._id, name: cust.name, mobile: cust.mobile } : null,
        resumed: true,
      });
      setCustomerSessionCookie(res, occ.sessionId);
      return res;
    }
  }

  // Upsert the customer (returning guests don't get duplicated).
  const customer = await Customer.findOneAndUpdate(
    { mobile: cleanMobile },
    { $set: { name: cleanName, lastVisitAt: new Date() }, $inc: { visits: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const sessionId = generateCustomerSessionId();
  const session = await CustomerSession.create({
    sessionId,
    customer: customer._id,
    customerName: customer.name,
    mobile: customer.mobile,
    table: table._id,
    tableNumber: table.number,
    status: 'active',
    startedAt: new Date(),
    orderCount: 0,
    subtotal: 0, taxAmount: 0, serviceChargeAmount: 0, tip: 0, total: 0,
  });

  // Mark the table as occupied.
  table.currentSession = {
    sessionId,
    startedAt: session.startedAt,
    customerName: customer.name,
    customerMobile: customer.mobile,
    sessionStatus: 'active',
  };
  await table.save();

  const res = okRes({
    session: serializeSession(session),
    customer: { _id: customer._id, name: customer.name, mobile: customer.mobile },
    resumed: false,
  });
  setCustomerSessionCookie(res, sessionId);
  return res;
}

/**
 * GET /api/customer/me  -> returns the current customer's session + unpaid
 * orders, or null if no session cookie. Used by the customer app on load.
 */
export async function GET() {
  await dbConnect();
  const sessionId = await getCustomerSessionId();
  if (!sessionId) return ok({ session: null, customer: null });
  const session = await CustomerSession.findOne({ sessionId }).lean();
  if (!session) {
    const res = okRes({ session: null, customer: null });
    clearCustomerSessionCookie(res);
    return res;
  }
  const customer = await Customer.findById(session.customer).lean();
  return ok({
    session: serializeSession(session),
    customer: customer ? { _id: customer._id, name: customer.name, mobile: customer.mobile } : null,
  });
}

function serializeSession(s: any) {
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
    orderCount: s.orderCount,
    total: s.total,
    tip: s.tip,
  };
}
