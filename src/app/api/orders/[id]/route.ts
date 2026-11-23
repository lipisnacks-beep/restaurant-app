import { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import Order from '@/models/Order';
import User from '@/models/User';
import Table from '@/models/Table';
import CustomerSession from '@/models/CustomerSession';
import { resolveSessionForRoles, resolveCustomerSessionId } from '@/lib/auth';
import { ok, fail, unauthorized, forbidden } from '@/lib/utils';
import { assignPendingOrdersToChefs } from '@/lib/chefDispatch';
import { assignReadyOrdersToStaff } from '@/lib/staffDispatch';

export const dynamic = 'force-dynamic';

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
 *
 * Auth note: each action resolves the session with an explicit role allow-list
 * (and a preferred role matching the portal that owns the action). This matters
 * because a single browser can hold several scoped session cookies at once
 * (e.g. someone signed in as both chef and staff). The generic 'any' resolver
 * returns the first cookie in declaration order, so without the role filter a
 * staff-portal action could authenticate as chef and be rejected.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const { action } = body || {};

  await dbConnect();
  const order = await Order.findById(params.id);
  if (!order) return fail('Order not found', 404);

  switch (action) {
    case 'start_preparing': {
      const session = await resolveSessionForRoles(req, ['admin', 'chef'], 'chef');
      if (!session) return unauthorized('Your session has expired — please sign in again');
      if (!['admin', 'chef'].includes(session.role)) {
        return forbidden(`Only chef or admin can start cooking (your role: ${session.role})`);
      }
      if (order.status !== 'pending') {
        // The most likely cause of a non-pending order here is a race:
        // another chef accepted the order a moment ago. Give a clear,
        // actionable message so the loser's UI can stop ringing.
        const claimed = order.status === 'preparing'
          ? ' — another chef just accepted it'
          : '';
        return fail(`Order is already ${order.status}${claimed}`, 422);
      }
      // Ownership: the dispatch engine routed this order to a SPECIFIC chef.
      // Only that chef (or an admin) may accept & start cooking it — this is
      // what stops two chefs from grabbing the same order and keeps the
      // customer's "your chef is X" assignment accurate. An order with no
      // chefId (no chef was available when it was placed) can be accepted by
      // any chef as a fallback so it never gets stuck.
      if (
        order.chefId &&
        session.role === 'chef' &&
        String(order.chefId) !== String(session.userId)
      ) {
        return fail('This order was routed to another chef', 422);
      }
      order.status = 'preparing';
      order.preparingAt = new Date();
      if (session.role === 'chef') order.chefId = session.userId as any;
      await order.save();
      return ok({ order });
    }
    case 'mark_ready': {
      const session = await resolveSessionForRoles(req, ['admin', 'chef'], 'chef');
      if (!session) return unauthorized('Your session has expired — please sign in again');
      if (!['admin', 'chef'].includes(session.role)) {
        return forbidden(`Only chef or admin can mark an order ready (your role: ${session.role})`);
      }
      if (order.status !== 'preparing') return fail(`Order is ${order.status}, not preparing — cannot mark ready`, 422);
      order.status = 'ready';
      order.readyAt = new Date();
      await order.save();
      // This chef just freed up a slot — route any waiting orders to an
      // available chef (possibly this one) so the backlog clears promptly.
      await assignPendingOrdersToChefs();
      // The order is now ready to serve — route it to ONE available staff
      // member (least-loaded, round-robin) instead of broadcasting to all.
      // If no staff is available, the engine stamps an ETA so the customer
      // sees a TAT countdown.
      await assignReadyOrdersToStaff();
      // Re-fetch so the response reflects the staff routing (staffId etc.).
      const refreshed = await Order.findById(order._id).lean();
      return ok({ order: refreshed || order });
    }
    case 'accept': {
      // Staff confirms a ready order routed to them by the dispatch engine so
      // they are responsible for serving it. With smart dispatch, each ready
      // order is routed to ONE staff member — only that staff (or an admin)
      // may accept it. This is the staff-side mirror of the chef's ownership
      // check on 'start_preparing'.
      const session = await resolveSessionForRoles(req, ['admin', 'staff'], 'staff');
      if (!session) return unauthorized('Your session has expired — please sign in again');
      if (!['admin', 'staff'].includes(session.role)) {
        return forbidden(`Only staff or admin can accept an order (your role: ${session.role})`);
      }
      if (order.status !== 'ready') {
        const claimed = order.status === 'served'
          ? ' — another staff already served it'
          : '';
        return fail(`Order is ${order.status}${claimed}`, 422);
      }

      // If this staff already accepted it, treat as a no-op success (idempotent
      // re-accept, e.g. they refreshed the tab).
      if (order.staffId && String(order.staffId) === String(session.userId)) {
        return ok({ order, alreadyMine: true });
      }

      // Ownership: the dispatch engine routed this order to a SPECIFIC staff.
      // Only that staff (or an admin) may accept it — this stops two staff
      // from grabbing the same order and keeps the customer's "your server is
      // X" assignment accurate. An order with no staffId (no staff was
      // available when it became ready) can be accepted by any staff as a
      // fallback so it never gets stuck.
      if (
        order.staffId &&
        session.role === 'staff' &&
        String(order.staffId) !== String(session.userId)
      ) {
        return fail('This order was routed to another staff member', 422);
      }

      // Atomic claim: only flip if status is still 'ready' AND no staff has
      // claimed it yet (or this staff is the routed owner claiming a fallback).
      const claimed = await Order.findOneAndUpdate(
        { _id: order._id, status: 'ready', staffId: { $exists: false } },
        {
          $set: {
            staffId: session.userId as any,
            acceptedAt: new Date(),
          },
        },
        { new: true },
      );
      if (!claimed) {
        // Either someone else beat us, or this staff IS the routed owner and
        // the order already had staffId set (the ownership check above passed
        // because staffId == me). In the latter case just return the order.
        if (order.staffId && String(order.staffId) === String(session.userId)) {
          return ok({ order, alreadyMine: true });
        }
        const fresh = await Order.findById(order._id);
        const who = fresh?.staffId ? ' — another staff just accepted it' : '';
        return fail(`Order is already ${fresh?.status || 'claimed'}${who}`, 422);
      }
      return ok({ order: claimed });
    }
    case 'serve': {
      const session = await resolveSessionForRoles(req, ['admin', 'staff'], 'staff');
      if (!session) return unauthorized('Your session has expired — please sign in again');
      if (!['admin', 'staff'].includes(session.role)) {
        return forbidden(`Only staff or admin can serve an order (your role: ${session.role})`);
      }
      if (order.status !== 'ready') return fail(`Order is ${order.status}, not ready — cannot serve`, 422);
      // If the order was already accepted by a DIFFERENT staff member, only
      // that staff (or an admin) may serve it — prevents two staff from both
      // delivering the same order.
      if (
        order.staffId &&
        session.role === 'staff' &&
        String(order.staffId) !== String(session.userId)
      ) {
        return fail('Another staff member has already accepted this order', 422);
      }
      order.status = 'served';
      order.servedAt = new Date();
      if (session.role === 'staff') order.staffId = session.userId as any;
      await order.save();
      // This staff just freed up a serving slot — route any waiting ready
      // orders to an available staff (possibly this one).
      await assignReadyOrdersToStaff();
      return ok({ order });
    }
    case 'complete': {
      const session = await resolveSessionForRoles(req, ['admin', 'staff'], 'staff');
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
      const session = await resolveSessionForRoles(req, ['admin']);
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
      // Customer pays the bill (cash / upi / card). Aggregates ALL unpaid
      // served/ready orders in this dining session (the order id in the URL is
      // just the anchor that tells us which session to settle). Optionally a tip.
      const { paymentMethod, tip = 0 } = body;
      if (!['cash', 'upi', 'card'].includes(paymentMethod)) return fail('Invalid payment method', 422);

      // Collect every unpaid order that belongs to the same session and is at
      // least ready/served. Still-preparing orders are excluded (the customer
      // should wait or pay them in a follow-up).
      const sessionOrders = await Order.find({
        sessionId: order.sessionId,
        paymentStatus: 'unpaid',
        status: { $in: ['served', 'ready'] },
      });

      if (sessionOrders.length === 0) {
        return fail('No payable orders yet — wait for your food to be served', 422);
      }

      const tipAmount = Math.max(0, Number(tip) || 0);
      let subtotalSum = 0, taxSum = 0, serviceSum = 0;
      for (const o of sessionOrders) {
        subtotalSum += o.subtotal;
        taxSum += o.taxAmount;
        serviceSum += o.serviceChargeAmount;
        o.paymentMethod = paymentMethod;
        o.paymentStatus = 'paid';
        o.tip = 0;
        o.total = o.subtotal + o.taxAmount + o.serviceChargeAmount;
        o.status = 'completed';
        o.completedAt = new Date();
        await o.save();
      }

      // Attach the tip to the anchor order so it shows in the bill/receipt.
      order.tip = tipAmount;
      order.total = order.subtotal + order.taxAmount + order.serviceChargeAmount + tipAmount;
      await order.save();

      // Allocate the tip to the staff who served the anchor order. The
      // dispatch engine routed this ready order to a specific staff member;
      // when the customer tips, that tip belongs to the staff who physically
      // brought the food to the table (order.staffId). We credit their
      // cumulative tipsEarned so it persists across sessions and shows in
      // their portal total. (Admin with no assigned staff: tip is not
      // credited to anyone — there's no staff who served it.)
      if (tipAmount > 0 && order.staffId) {
        await User.updateOne(
          { _id: order.staffId },
          { $inc: { tipsEarned: tipAmount } },
        ).exec();
      }

      const grandTotal = subtotalSum + taxSum + serviceSum + tipAmount;

      // Mark the CustomerSession as paid + endedAt.
      const custSessionId = await resolveCustomerSessionId(req);
      let custSession: any = null;
      if (custSessionId) {
        custSession = await CustomerSession.findOne({ sessionId: custSessionId });
        if (custSession) {
          custSession.status = 'paid';
          custSession.endedAt = new Date();
          custSession.orderCount = sessionOrders.length;
          custSession.subtotal = subtotalSum;
          custSession.taxAmount = taxSum;
          custSession.serviceChargeAmount = serviceSum;
          custSession.tip = tipAmount;
          custSession.total = grandTotal;
          await custSession.save();

          // Mark the table session status as 'paid' (still occupied until review/staff frees it).
          await Table.updateOne(
            { _id: order.table },
            { $set: { 'currentSession.sessionStatus': 'paid' } },
          );
        }
      }

      // If no other unpaid orders remain for this table session, the table is
      // ready to be freed by staff after the review. (We do NOT auto-free here;
      // staff confirms the table is physically cleared.)
      const remaining = await Order.countDocuments({
        table: order.table,
        sessionId: order.sessionId,
        paymentStatus: 'unpaid',
      });

      return ok({
        order,
        paidOrders: sessionOrders.map((o) => o._id),
        session: custSession ? {
          status: custSession.status,
          endedAt: custSession.endedAt,
          total: custSession.total,
          tip: custSession.tip,
          orderCount: custSession.orderCount,
        } : null,
        remainingUnpaid: remaining,
        grandTotal,
        subtotal: subtotalSum,
        taxAmount: taxSum,
        serviceChargeAmount: serviceSum,
        tip: tipAmount,
      });
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
