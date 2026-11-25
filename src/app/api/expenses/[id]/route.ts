import { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import Expense from '@/models/Expense';
import { getSession } from '@/lib/auth';
import { ok, fail, unauthorized, forbidden } from '@/lib/utils';
import { Types } from 'mongoose';

export const dynamic = 'force-dynamic';

async function adminSession() {
  const session = await getSession();
  if (!session) return null;
  if (session.role !== 'admin') return 'forbidden';
  return session;
}

// PUT /api/expenses/:id  -> update an expense
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const s = await adminSession();
  if (s === null) return unauthorized();
  if (s === 'forbidden') return forbidden();
  if (!Types.ObjectId.isValid(params.id)) return fail('Invalid id', 404);

  await dbConnect();
  const body = await req.json();
  const { date, category, description, amount, paymentMethod, vendor, invoiceNumber, note } = body || {};

  const patch: Record<string, unknown> = {};
  if (date) patch.date = new Date(date);
  if (category) patch.category = category;
  if (description != null) patch.description = String(description).trim();
  if (amount != null) {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 0) return fail('amount must be a non-negative number');
    patch.amount = amt;
  }
  if (paymentMethod) patch.paymentMethod = paymentMethod;
  if (vendor != null) patch.vendor = vendor;
  if (invoiceNumber != null) patch.invoiceNumber = invoiceNumber;
  if (note != null) patch.note = note;

  const updated = await Expense.findByIdAndUpdate(params.id, { $set: patch }, { new: true, runValidators: true }).lean();
  if (!updated) return fail('Expense not found', 404);
  return ok({ expense: updated });
}

// DELETE /api/expenses/:id  -> delete an expense
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const s = await adminSession();
  if (s === null) return unauthorized();
  if (s === 'forbidden') return forbidden();
  if (!Types.ObjectId.isValid(params.id)) return fail('Invalid id', 404);

  await dbConnect();
  const deleted = await Expense.findByIdAndDelete(params.id);
  if (!deleted) return fail('Expense not found', 404);
  return ok({ deleted: true });
}
