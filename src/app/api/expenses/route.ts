import { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import Expense from '@/models/Expense';
import { getSession } from '@/lib/auth';
import { ok, fail, unauthorized, forbidden, serverError } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * GET /api/expenses
 *   Admin-only. Supports filters:
 *     ?from=ISO&to=ISO         -> date range (inclusive)
 *     ?category=rent|...       -> single category
 *     ?q=text                  -> search description/vendor/invoice
 *     ?page=1&limit=50         -> pagination (max 500)
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
        { description: { $regex: q, $options: 'i' } },
        { vendor: { $regex: q, $options: 'i' } },
        { invoiceNumber: { $regex: q, $options: 'i' } },
        { note: { $regex: q, $options: 'i' } },
      ];
    }

    const [items, total, grandAgg] = await Promise.all([
      Expense.find(filter)
        .sort({ date: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('createdBy', 'name email')
        .lean(),
      Expense.countDocuments(filter),
      Expense.aggregate([
        { $match: filter },
        { $group: { _id: null, total: { $sum: '$amount' } } },
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
 * POST /api/expenses  -> admin records a new expense.
 *   body: { date, category, description, amount, paymentMethod, vendor?, invoiceNumber?, note? }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return unauthorized();
    if (session.role !== 'admin') return forbidden();

    await dbConnect();
    const body = await req.json();
    const { date, category, description, amount, paymentMethod, vendor, invoiceNumber, note } = body || {};

    if (!date || !category || !description || amount == null) {
      return fail('date, category, description and amount are required');
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 0) return fail('amount must be a non-negative number');

    const expense = await Expense.create({
      date: new Date(date),
      category,
      description: String(description).trim(),
      amount: amt,
      paymentMethod: paymentMethod || 'cash',
      vendor: vendor || '',
      invoiceNumber: invoiceNumber || '',
      note: note || '',
      createdBy: session.userId,
    });

    return ok({ expense }, { status: 201 });
  } catch (err) {
    return serverError(err);
  }
}
