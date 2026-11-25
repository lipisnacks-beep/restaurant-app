import { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import Purchase from '@/models/Purchase';
import { getSession } from '@/lib/auth';
import { ok, fail, unauthorized, forbidden, serverError } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface PurchaseItemInput {
  name: string;
  quantity: number;
  unit: string;
  rate: number;
}

/** Recompute subtotal/total from item lines + tax/discount so totals are never stale. */
function computeTotals(items: PurchaseItemInput[], taxAmount: number, discount: number) {
  const subtotal = items.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.rate) || 0), 0);
  const total = Math.max(0, subtotal + (Number(taxAmount) || 0) - (Number(discount) || 0));
  const itemised = items.map((it) => ({
    name: String(it.name || '').trim(),
    quantity: Number(it.quantity) || 0,
    unit: String(it.unit || 'pcs').trim(),
    rate: Number(it.rate) || 0,
    amount: (Number(it.quantity) || 0) * (Number(it.rate) || 0),
  }));
  return { subtotal, total, itemised };
}

/**
 * GET /api/purchases
 *   Admin-only. Filters: ?from=&to=&category=&q=&page=&limit=
 *   Returns { items, total, page, limit, grandTotal }
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return unauthorized();
    if (session.role !== 'admin') return forbidden();

    await dbConnect();
    const { searchParams } = new URL(req.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const category = searchParams.get('category');
    const q = searchParams.get('q')?.trim();
    const page = Math.max(1, Number(searchParams.get('page') || '1'));
    const limit = Math.min(500, Math.max(1, Number(searchParams.get('limit') || '50')));

    const filter: Record<string, unknown> = {};
    if (from || to) {
      const d: Record<string, Date> = {};
      if (from) d.$gte = new Date(from);
      if (to) d.$lte = new Date(to);
      filter.date = d;
    }
    if (category) filter.category = category;
    if (q) {
      filter.$or = [
        { supplier: { $regex: q, $options: 'i' } },
        { invoiceNumber: { $regex: q, $options: 'i' } },
        { note: { $regex: q, $options: 'i' } },
        { 'items.name': { $regex: q, $options: 'i' } },
      ];
    }

    const [items, total, grandAgg] = await Promise.all([
      Purchase.find(filter)
        .sort({ date: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('createdBy', 'name email')
        .lean(),
      Purchase.countDocuments(filter),
      Purchase.aggregate([
        { $match: filter },
        { $group: { _id: null, total: { $sum: '$total' } } },
      ]),
    ]);

    return ok({
      items,
      total,
      page,
      limit,
      grandTotal: grandAgg[0]?.total || 0,
    });
  } catch (err) {
    return serverError(err);
  }
}

/**
 * POST /api/purchases  -> admin records a new purchase.
 *   body: { date, category, supplier?, invoiceNumber?, items[], taxAmount?, discount?, paymentMethod?, paymentStatus?, amountPaid?, note? }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return unauthorized();
    if (session.role !== 'admin') return forbidden();

    await dbConnect();
    const body = await req.json();
    const { date, category, supplier, invoiceNumber, items, taxAmount, discount, paymentMethod, paymentStatus, amountPaid, note } = body || {};

    if (!date || !category) return fail('date and category are required');
    if (!Array.isArray(items) || items.length === 0) return fail('At least one purchase item is required');

    const { subtotal, total, itemised } = computeTotals(items, Number(taxAmount) || 0, Number(discount) || 0);
    const paid = Number(amountPaid) || (paymentStatus === 'paid' ? total : 0);

    const purchase = await Purchase.create({
      date: new Date(date),
      category,
      supplier: supplier || '',
      invoiceNumber: invoiceNumber || '',
      items: itemised,
      subtotal,
      taxAmount: Number(taxAmount) || 0,
      discount: Number(discount) || 0,
      total,
      paymentMethod: paymentMethod || 'cash',
      paymentStatus: paymentStatus || (paid >= total ? 'paid' : 'unpaid'),
      amountPaid: paid,
      note: note || '',
      createdBy: session.userId,
    });

    return ok({ purchase }, { status: 201 });
  } catch (err) {
    return serverError(err);
  }
}
