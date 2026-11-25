import { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import Purchase from '@/models/Purchase';
import { getSession } from '@/lib/auth';
import { ok, fail, unauthorized, forbidden, serverError } from '@/lib/utils';
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

/**
 * Reconcile amountPaid / paymentStatus against a new total so the two never
 * disagree after an edit. Previously editing the items recomputed `total` but
 * left the old `amountPaid` and `paymentStatus` untouched — so a previously
 * "paid" purchase could end up with amountPaid < total, and a previously
 * "partial" payment could exceed the new total.
 */
function reconcilePayment(total: number, amountPaid: number, requestedStatus?: string): { amountPaid: number; paymentStatus: string } {
  let paid = Math.max(0, Math.min(Number(amountPaid) || 0, total));
  let status: string;
  if (requestedStatus && ['paid', 'partial', 'unpaid'].includes(requestedStatus)) {
    status = requestedStatus;
    // If the admin explicitly asked for a status, make amountPaid consistent
    // with it so the data is never self-contradictory.
    if (status === 'paid') paid = total;
    else if (status === 'unpaid') paid = 0;
    // 'partial' keeps the provided amountPaid (clamped to (0, total)).
  } else {
    if (paid >= total && total > 0) status = 'paid';
    else if (paid <= 0) status = 'unpaid';
    else status = 'partial';
  }
  return { amountPaid: paid, paymentStatus: status };
}

// PUT /api/purchases/:id
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const s = await adminSession();
    if (s === null) return unauthorized();
    if (s === 'forbidden') return forbidden();
    if (!Types.ObjectId.isValid(params.id)) return fail('Invalid id', 404);

    await dbConnect();
    const existing = await Purchase.findById(params.id).lean() as any;
    if (!existing) return fail('Purchase not found', 404);

    const body = await req.json();
    const { date, category, supplier, invoiceNumber, items, taxAmount, discount, paymentMethod, paymentStatus, amountPaid, note } = body || {};

    const patch: Record<string, unknown> = {};
    if (date) patch.date = new Date(date);
    if (category) patch.category = category;
    if (supplier != null) patch.supplier = supplier;
    if (invoiceNumber != null) patch.invoiceNumber = invoiceNumber;

    // Always recompute subtotal/total from the (possibly edited) items + tax +
    // discount so the stored total never drifts from the line items.
    const effectiveItems = Array.isArray(items) && items.length ? items : (existing.items as PurchaseItemInput[]);
    const effectiveTax = taxAmount != null ? Number(taxAmount) || 0 : (existing.taxAmount || 0);
    const effectiveDiscount = discount != null ? Number(discount) || 0 : (existing.discount || 0);
    const t = computeTotals(effectiveItems, effectiveTax, effectiveDiscount);
    patch.items = t.itemised;
    patch.subtotal = t.subtotal;
    patch.taxAmount = effectiveTax;
    patch.discount = effectiveDiscount;
    patch.total = t.total;

    // Reconcile payment against the NEW total.
    const effectivePaid = amountPaid != null ? Number(amountPaid) || 0 : (existing.amountPaid || 0);
    const rec = reconcilePayment(t.total, effectivePaid, paymentStatus);
    patch.amountPaid = rec.amountPaid;
    patch.paymentStatus = rec.paymentStatus;

    if (paymentMethod) patch.paymentMethod = paymentMethod;
    if (note != null) patch.note = note;

    const updated = await Purchase.findByIdAndUpdate(params.id, { $set: patch }, { new: true, runValidators: true }).lean();
    if (!updated) return fail('Purchase not found', 404);
    return ok({ purchase: updated });
  } catch (err) {
    return serverError(err);
  }
}

// DELETE /api/purchases/:id
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const s = await adminSession();
    if (s === null) return unauthorized();
    if (s === 'forbidden') return forbidden();
    if (!Types.ObjectId.isValid(params.id)) return fail('Invalid id', 404);

    await dbConnect();
    const deleted = await Purchase.findByIdAndDelete(params.id);
    if (!deleted) return fail('Purchase not found', 404);
    return ok({ deleted: true });
  } catch (err) {
    return serverError(err);
  }
}
