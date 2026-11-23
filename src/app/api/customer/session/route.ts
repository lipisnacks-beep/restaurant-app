import { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import CustomerSession from '@/models/CustomerSession';
import Order from '@/models/Order';
import User from '@/models/User';
import { resolveCustomerSessionId } from '@/lib/auth';
import { ok, fail } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * GET /api/customer/session
 *   Returns the current customer's dining session + all its orders, split into
 *   payable (served/ready + unpaid) and pending (still in the kitchen). The
 *   customer app uses this to render the aggregated bill before payment and to
 *   let the customer order more items mid-meal.
 *
 * Each order also carries the name of the chef the dispatch engine routed it
 * to (chefName) so the customer can see "Chef X is preparing your order", and
 * an estimatedChefAssignBy ETA shown as a TAT countdown while no chef has
 * picked the order up yet.
 */
export async function GET(req: NextRequest) {
  await dbConnect();
  const custSessionId = await resolveCustomerSessionId(req);
  if (!custSessionId) return fail('No active dining session', 401);

  const session = await CustomerSession.findOne({ sessionId: custSessionId }).lean();
  if (!session) return fail('Session not found', 404);

  const orders = await Order.find({ sessionId: session.sessionId })
    .populate('chefId', 'name')
    .sort({ createdAt: 1 })
    .lean();

  const payable = orders.filter(
    (o) => o.paymentStatus === 'unpaid' && ['served', 'ready'].includes(o.status),
  );
  const pending = orders.filter(
    (o) => o.paymentStatus === 'unpaid' && ['pending', 'preparing'].includes(o.status),
  );
  const paid = orders.filter((o) => o.paymentStatus === 'paid');

  // Aggregated bill for the payable orders.
  const subtotal = payable.reduce((s, o) => s + o.subtotal, 0);
  const taxAmount = payable.reduce((s, o) => s + o.taxAmount, 0);
  const serviceChargeAmount = payable.reduce((s, o) => s + o.serviceChargeAmount, 0);

  return ok({
    session: {
      _id: String(session._id),
      sessionId: session.sessionId,
      customerName: session.customerName,
      mobile: session.mobile,
      tableNumber: session.tableNumber,
      status: session.status,
      startedAt: session.startedAt,
      endedAt: session.endedAt || null,
      orderCount: session.orderCount,
      total: session.total,
      tip: session.tip,
    },
    orders: orders.map(serializeOrder),
    payable: payable.map(serializeOrder),
    pending: pending.map(serializeOrder),
    paid: paid.map(serializeOrder),
    bill: {
      subtotal,
      taxAmount,
      serviceChargeAmount,
      payableOrderCount: payable.length,
    },
  });
}

function serializeOrder(o: any) {
  const chef: any = o.chefId;
  return {
    _id: String(o._id),
    orderNumber: o.orderNumber,
    tableNumber: o.tableNumber,
    items: o.items,
    subtotal: o.subtotal,
    taxAmount: o.taxAmount,
    serviceChargeAmount: o.serviceChargeAmount,
    tip: o.tip,
    total: o.total,
    status: o.status,
    paymentStatus: o.paymentStatus,
    paymentMethod: o.paymentMethod || null,
    customerName: o.customerName || '',
    createdAt: o.createdAt,
    placedAt: o.placedAt,
    assignedAt: o.assignedAt || null,
    estimatedChefAssignBy: o.estimatedChefAssignBy || null,
    chefId: chef ? String(chef._id) : null,
    chefName: chef ? chef.name : null,
    servedAt: o.servedAt || null,
    completedAt: o.completedAt || null,
  };
}
