import { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import Order from '@/models/Order';
import Table from '@/models/Table';
import { getSession, getTokenFromRequest, verifyToken } from '@/lib/auth';
import { ok, fail, unauthorized, forbidden } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * Resolve the session, falling back to the bearer/cookie token on the request
 * itself if next/headers' cookies() doesn't expose it (can happen in some
 * Vercel serverless invocations). Never throws.
 */
async function resolveSession(req: NextRequest) {
  const direct = await getSession();
  if (direct) return direct;
  const token = getTokenFromRequest(req);
  if (token) return verifyToken(token);
  return null;
}

// GET /api/orders/[id]
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  await dbConnect();
  const order = await Order.findById(params.id).lean();
  if (!order) return fail('Order not found', 404);
  return ok({ order });
}

/**
 * PATCH /api/orders/[id]
 *  body: { action: 'start_preparing' | 'mark_ready' | 'serve' | 'complete' | 'cancel' }
 *        or  { action: 'pay', paymentMethod, tip }  (customer, marks paid + completed)
 *        or  { action: 'rate', rating, foodRating, serviceRating, ambianceRating, comment }
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await resolveSession(req);
  const body = await req.json();
  const { action } = body || {};

  await dbConnect();
  const order = await Order.findById(params.id);
  if (!order) return fail('Order not found', 404);

  switch (action) {
    case 'start_preparing': {
      if (!session) return unauthorized('Your session has expired — please sign in again');
      if (!['admin', 'chef'].includes(session.role)) {
        return forbidden(`Only chef or admin can start cooking (your role: ${session.role})`);
      }
      if (order.status !== 'pending') return fail(`Order is already ${order.status}`, 422);
      order.status = 'preparing';
      order.preparingAt = new Date();
      if (session.role === 'chef') order.chefId = session.userId as any;
      await order.save();
      return ok({ order });
    }
    case 'mark_ready': {
      if (!session) return unauthorized('Your session has expired — please sign in again');
      if (!['admin', 'chef'].includes(session.role)) {
        return forbidden(`Only chef or admin can mark an order ready (your role: ${session.role})`);
      }
      if (order.status !== 'preparing') return fail(`Order is ${order.status}, not preparing — cannot mark ready`, 422);
      order.status = 'ready';
      order.readyAt = new Date();
      await order.save();
      return ok({ order });
    }
    case 'serve': {
      if (!session) return unauthorized('Your session has expired — please sign in again');
      if (!['admin', 'staff'].includes(session.role)) {
        return forbidden(`Only staff or admin can serve an order (your role: ${session.role})`);
      }
      if (order.status !== 'ready') return fail(`Order is ${order.status}, not ready`, 422);
      order.status = 'served';
      order.servedAt = new Date();
      if (session.role === 'staff') order.staffId = session.userId as any;
      await order.save();
      return ok({ order });
    }
    case 'complete': {
      // Mark as completed (after payment) and free the table session if no other unpaid orders.
      if (!session) return unauthorized('Your session has expired — please sign in again');
      if (!['admin', 'staff'].includes(session.role)) {
        return forbidden(`Only staff or admin can complete an order (your role: ${session.role})`);
      }
      if (!['served', 'ready'].includes(order.status)) return fail('Order cannot be completed from this state', 422);
      order.status = 'completed';
      order.completedAt = new Date();
      await order.save();
      return ok({ order });
    }
    case 'cancel': {
      if (!session) return unauthorized('Your session has expired — please sign in again');
      if (session.role !== 'admin') {
        return forbidden(`Only admin can cancel an order (your role: ${session.role})`);
      }
      order.status = 'cancelled';
      order.cancelledAt = new Date();
      await order.save();
      return ok({ order });
    }
    case 'pay': {
      // Customer pays the bill (cash / upi / card). Optionally adds a tip.
      const { paymentMethod, tip = 0 } = body;
      if (!['cash', 'upi', 'card'].includes(paymentMethod)) return fail('Invalid payment method', 422);
      if (!['served', 'ready'].includes(order.status)) {
        return fail('Pay only after the order is served/ready', 422);
      }
      order.paymentMethod = paymentMethod;
      order.paymentStatus = 'paid';
      order.tip = Math.max(0, Number(tip) || 0);
      order.total = order.subtotal + order.taxAmount + order.serviceChargeAmount + order.tip;
      order.status = 'completed';
      order.completedAt = new Date();
      await order.save();

      // If no other unpaid orders for this table session, free the table.
      const remaining = await Order.countDocuments({
        table: order.table,
        sessionId: order.sessionId,
        _id: { $ne: order._id },
        paymentStatus: 'unpaid',
      });
      if (remaining === 0) {
        await Table.updateOne({ _id: order.table }, { $unset: { currentSession: '' } });
      }
      return ok({ order });
    }
    case 'rate': {
      // Customer rates the food/service after payment.
      const { rating, foodRating = 0, serviceRating = 0, ambianceRating = 0, comment = '' } = body;
      const r = Number(rating);
      if (!r || r < 1 || r > 5) return fail('rating must be 1-5', 422);
      order.rating = r;
      // Stash the breakdown on the order; the dedicated Review collection is also written
      // by /api/reviews so the admin dashboard can aggregate them.
      (order as any).foodRating = Number(foodRating);
      (order as any).serviceRating = Number(serviceRating);
      (order as any).ambianceRating = Number(ambianceRating);
      (order as any).comment = String(comment);
      await order.save();
      return ok({ order });
    }
    default:
      return fail('Unknown action', 422);
  }
}
