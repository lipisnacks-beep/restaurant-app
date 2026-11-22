import { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import Order from '@/models/Order';
import MenuItem from '@/models/MenuItem';
import Table from '@/models/Table';
import CustomerSession from '@/models/CustomerSession';
import { resolveCustomerSessionId } from '@/lib/auth';
import { ok, fail, generateOrderNumber } from '@/lib/utils';
import { Types } from 'mongoose';

export const dynamic = 'force-dynamic';

/**
 * GET /api/orders?status=preparing&role=chef
 *  - chef  : default returns { pending, preparing }
 *  - staff : default returns { ready, served }
 *  - admin : all today's orders
 *  - customer?sessionId=... : only that session's orders
 *  - customer?table=...&unpaid=true : unpaid orders for a table
 */
export async function GET(req: NextRequest) {
  await dbConnect();
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');
  const sessionId = searchParams.get('sessionId');
  const role = searchParams.get('role');
  const tableNumber = searchParams.get('table');
  const unpaidOnly = searchParams.get('unpaid') === 'true';
  const limit = Math.min(Number(searchParams.get('limit') || '100'), 300);

  const filter: Record<string, unknown> = {};
  if (status) {
    filter.status = status.split(',').filter(Boolean);
  } else if (role === 'chef') {
    filter.status = { $in: ['pending', 'preparing'] };
  } else if (role === 'staff') {
    filter.status = { $in: ['ready', 'served'] };
  } else if (role === 'admin' && !sessionId) {
    // today's orders for the admin dashboard
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    filter.createdAt = { $gte: start };
  }
  if (sessionId) filter.sessionId = sessionId;
  if (unpaidOnly) filter.paymentStatus = 'unpaid';
  if (tableNumber) filter.tableNumber = Number(tableNumber);

  const orders = await Order.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return ok({ orders });
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

  return ok({ order }, { status: 201 });
}
