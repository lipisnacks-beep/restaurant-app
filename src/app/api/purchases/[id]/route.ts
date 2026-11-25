import { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import Purchase from '@/models/Purchase';
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

interface PurchaseItemInput {
  name: string;
  quantity: number;
  unit: string;
  rate: number;
}

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

// PUT /api/purchases/:id
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const s = await adminSession();
  if (s === null) return unauthorized();
  if (s === 'forbidden') return forbidden();
  if (!Types.ObjectId.isValid(params.id)) return fail('Invalid id', 404);

  await dbConnect();
  const body = await req.json();
  const { date, category, supplier, invoiceNumber, items, taxAmount, discount, paymentMethod, paymentStatus, amountPaid, note } = body || {};

  const patch: Record<string, unknown> = {};
  if (date) patch.date = new Date(date);
  if (category) patch.category = category;
  if (supplier != null) patch.supplier = supplier;
  if (invoiceNumber != null) patch.invoiceNumber = invoiceNumber;
  if (Array.isArray(items) && items.length) {
    const t = computeTotals(items, Number(taxAmount) || 0, Number(discount) || 0);
    patch.items = t.itemised;
    patch.subtotal = t.subtotal;
    patch.total = t.total;
    if (taxAmount != null) patch.taxAmount = Number(taxAmount) || 0;
    if (discount != null) patch.discount = Number(discount) || 0;
  } else {
    if (taxAmount != null || discount != null) {
      // recompute total from existing items
      const existing = await Purchase.findById(params.id).lean() as unknown as { items: PurchaseItemInput[]; taxAmount: number; discount: number } | null;
      if (existing) {
        const t = computeTotals(existing.items, Number(taxAmount ?? existing.taxAmount), Number(discount ?? existing.discount));
        patch.subtotal = t.subtotal;
        patch.total = t.total;
        if (taxAmount != null) patch.taxAmount = Number(taxAmount) || 0;
        if (discount != null) patch.discount = Number(discount) || 0;
      }
    }
  }
  if (paymentMethod) patch.paymentMethod = paymentMethod;
  if (paymentStatus) patch.paymentStatus = paymentStatus;
  if (amountPaid != null) patch.amountPaid = Number(amountPaid) || 0;
  if (note != null) patch.note = note;

  const updated = await Purchase.findByIdAndUpdate(params.id, { $set: patch }, { new: true, runValidators: true }).lean();
  if (!updated) return fail('Purchase not found', 404);
  return ok({ purchase: updated });
}

// DELETE /api/purchases/:id
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const s = await adminSession();
  if (s === null) return unauthorized();
  if (s === 'forbidden') return forbidden();
  if (!Types.ObjectId.isValid(params.id)) return fail('Invalid id', 404);

  await dbConnect();
  const deleted = await Purchase.findByIdAndDelete(params.id);
  if (!deleted) return fail('Purchase not found', 404);
  return ok({ deleted: true });
}
