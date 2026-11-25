import { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import Order from '@/models/Order';
import MenuItem from '@/models/MenuItem';
import Table from '@/models/Table';
import CustomerSession from '@/models/CustomerSession';
import { resolveCustomerSessionId, resolveSessionForRoles } from '@/lib/auth';
import { ok, fail, unauthorized, generateOrderNumber, serverError } from '@/lib/utils';
import { assignPendingOrdersToChefs, touchChefPresence } from '@/lib/chefDispatch';
import { assignReadyOrdersToStaff, touchStaffPresence } from '@/lib/staffDispatch';
import { startOfIStDay, endOfIStDay } from '@/lib/dateRange';
import { Types } from 'mongoose';

export const dynamic = 'force-dynamic';

/**
 * GET /api/orders?status=preparing&role=chef
 *  - chef  : the dispatch engine routes each NEW order to ONE available chef
 *            (least-loaded, round-robin tiebreak) — NOT broadcast to all.
 *            A chef therefore sees ONLY the orders routed to them: pending
 *            orders with chefId==me (to accept & start cooking) plus their
 *            own preparing orders. Polling also touches the chef's presence
 *            heartbeat and triggers a dispatch sweep so any order that
 *            arrived while no chef was present gets routed now that this
 *            chef is online.
 *  - staff : default returns { ready, served }
 *  - admin : all today's orders (IST day; a status filter narrows but does
 *            NOT widen the date window — previously a status chip bypassed
 *            the today filter and returned all-time orders).
 *  - customer?sessionId=... : only that session's orders
 *  - customer?table=...&unpaid=true : unpaid orders for a table
 */
export async function GET(req: NextRequest) {
  try {
    await dbConnect();
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const sessionId = searchParams.get('sessionId');
    const role = searchParams.get('role');
    const tableNumber = searchParams.get('table');
    const unpaidOnly = searchParams.get('unpaid') === 'true';
    const limit = Math.min(Number(searchParams.get('limit') || '100'), 300);

    const filter: Record<string, unknown> = {};
    let adminTodayWindow = false;

    if (role === 'chef') {
      // Resolve the calling chef, touch their presence heartbeat, and run a
      // dispatch sweep. The sweep routes any unassigned pending orders to an
      // available chef (possibly this one) — so when a chef opens their portal
      // they immediately pick up orders that were waiting for someone to come
      // online. This chef then sees ONLY orders routed to them:
      //   - pending + chefId==me  (assigned to me, awaiting my "accept & cook")
      //   - preparing + chefId==me (I'm already cooking these)
      const session = await resolveSessionForRoles(req, ['admin', 'chef'], 'chef');
      if (session && session.role === 'chef') {
        await touchChefPresence(session.userId);
        await assignPendingOrdersToChefs();
        const me = new Types.ObjectId(session.userId);
        filter.$or = [
          { status: 'pending', chefId: me },
          { status: 'preparing', chefId: me },
        ];
      } else if (session && session.role === 'admin') {
        // Admin peeking at the chef queue: both queues.
        filter.status = { $in: ['pending', 'preparing'] };
      } else {
        // SECURITY: previously this branch leaked the full pending+preparing
        // queue to ANY caller (including unauthenticated). Now reject.
        return unauthorized();
      }
    } else if (role === 'staff') {
      // The staff dispatch engine routes each ready order to ONE available
      // staff member (least-loaded, round-robin tiebreak) — NOT broadcast to
      // all. A staff member therefore sees ONLY orders routed to them:
      //   1. ready orders with staffId == me (routed to me, to accept & serve)
      //   2. served orders with staffId == me (I delivered these, awaiting
      //      payment — and any tip will be credited to me)
      const session = await resolveSessionForRoles(req, ['admin', 'staff'], 'staff');
      if (session && session.role === 'staff') {
        await touchStaffPresence(session.userId);
        await assignReadyOrdersToStaff();
        const me = new Types.ObjectId(session.userId);
        filter.$or = [
          { status: 'ready', staffId: me },
          { status: 'served', staffId: me },
        ];
      } else if (session && session.role === 'admin') {
        filter.status = { $in: ['ready', 'served'] };
      } else {
        // SECURITY: previously leaked the full ready+served queue. Now reject.
        return unauthorized();
      }
    } else if (role === 'admin' && !sessionId) {
      // Admin "today's orders" view — IST calendar day. A status filter narrows
      // within the window but does NOT remove the date filter (the old code's
      // if/else-if made status and the admin-today window mutually exclusive,
      // so clicking a status chip returned all-time orders).
      adminTodayWindow = true;
    }

    if (adminTodayWindow) {
      filter.createdAt = { $gte: startOfIStDay(), $lte: endOfIStDay() };
    }
    if (status) {
      filter.status = status.split(',').filter(Boolean);
    }
    if (sessionId) filter.sessionId = sessionId;
    if (unpaidOnly) filter.paymentStatus = 'unpaid';
    if (tableNumber) filter.tableNumber = Number(tableNumber);

    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return ok({ orders });
  } catch (err) {
    return serverError(err);
  }
}

/**
 * POST /api/orders  -> customer places an order from a table
 * Body: {
 *   tableNumber, sessionId, customerName?, items: [{ menuItem, quantity, note? }],
 *   taxRate?, serviceChargeRate?, notes?
 * }
 *
 * The customer's dining session is resolved from the rms_customer_session
 * cookie (set at QR-scan registration). The order is linked to both the
 * Customer and the CustomerSession so multiple orders in one sitting can be
 * billed together.
 */
export async function POST(req: NextRequest) {
  try {
    await dbConnect();
    const body = await req.json();
    const { tableNumber, sessionId, customerName, items, taxRate = 0, serviceChargeRate = 0, notes } = body || {};

    if (!tableNumber || !sessionId || !Array.isArray(items) || items.length === 0) {
      return fail('tableNumber, sessionId and items[] are required', 422);
    }

    const table = await Table.findOne({ number: Number(tableNumber), active: true });
    if (!table) return fail('Invalid or inactive table', 404);

    // Resolve the customer dining session from the cookie.
    const customerSessionId = await resolveCustomerSessionId(req);
    let custSession: any = null;
    if (customerSessionId) {
      custSession = await CustomerSession.findOne({ sessionId: customerSessionId });
      if (custSession && (custSession.status === 'paid' || custSession.status === 'completed' || custSession.status === 'closed')) {
        return fail('Your dining session has ended. Please ask staff for assistance.', 422);
      }
      // SECURITY: the order's sessionId is taken from the cookie-resolved
      // session, NOT the client-supplied body value. Previously a customer
      // could pass another table's sessionId and inject orders onto that
      // table's bill. Now the cookie is the source of truth.
      if (custSession && custSession.sessionId !== sessionId) {
        return fail('Session mismatch. Please rescan the table QR.', 422);
      }
    }

    // Validate every menu item and compute subtotal from server-side prices (never trust client price).
    const ids = items.map((i: { menuItem: string }) => new Types.ObjectId(i.menuItem));
    const menuItems = await MenuItem.find({ _id: { $in: ids } }).lean();
    const menuMap = new Map(menuItems.map((m) => [String(m._id), m]));

    let subtotal = 0;
    const orderItems = [];
    for (const it of items) {
      const m = menuMap.get(String(it.menuItem));
      if (!m) return fail(`Menu item not found: ${it.menuItem}`, 404);
      if (!m.available) return fail(`Item not available: ${m.name}`, 422);
      const qty = Math.max(1, Math.floor(Number(it.quantity) || 0));
      subtotal += m.price * qty;
      orderItems.push({
        menuItem: m._id,
        name: m.name,
        price: m.price,
        quantity: qty,
        note: it.note || '',
      });
    }

    const taxAmount = Math.round(subtotal * (Number(taxRate) / 100));
    const serviceChargeAmount = Math.round(subtotal * (Number(serviceChargeRate) / 100));
    const total = subtotal + taxAmount + serviceChargeAmount;

    const order = await Order.create({
      orderNumber: generateOrderNumber(),
      table: table._id,
      tableNumber: table.number,
      sessionId,
      customer: custSession?.customer || undefined,
      customerMobile: custSession?.mobile || '',
      items: orderItems,
      subtotal,
      taxRate: Number(taxRate),
      taxAmount,
      serviceChargeRate: Number(serviceChargeRate),
      serviceChargeAmount,
      tip: 0,
      total,
      status: 'pending',
      paymentStatus: 'unpaid',
      customerName: customerName || custSession?.customerName || '',
      notes: notes || '',
    });

    // Mark the table as having an active dining session.
    if (!table.currentSession?.sessionId) {
      table.currentSession = {
        sessionId,
        startedAt: custSession?.startedAt || new Date(),
        customerName: customerName || custSession?.customerName || '',
        customerMobile: custSession?.mobile || '',
        sessionStatus: 'active',
      };
      await table.save();
    }

    // Bump the session's order count.
    if (custSession) {
      await CustomerSession.updateOne(
        { _id: custSession._id },
        { $inc: { orderCount: 1 } },
      );
    }

    // Smart dispatch: route this order to ONE available chef immediately (not
    // broadcast to all). If no chef is currently available, the dispatch engine
    // stamps an estimatedChefAssignBy ETA so the customer sees a TAT countdown
    // instead of a bare "pending". We re-fetch the order after the sweep so the
    // response the customer gets already reflects whether a chef has it.
    await assignPendingOrdersToChefs();
    const routed = await Order.findById(order._id).lean();

    return ok({ order: routed || order }, { status: 201 });
  } catch (err) {
    return serverError(err);
  }
}
