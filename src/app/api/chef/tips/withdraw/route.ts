import { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import User from '@/models/User';
import TipWithdrawal from '@/models/TipWithdrawal';
import { resolveSessionForRoles } from '@/lib/auth';
import { ok, fail, unauthorized, serverError } from '@/lib/utils';
import { parseDateFromInput, parseDateToInput } from '@/lib/dateRange';

export const dynamic = 'force-dynamic';

/**
 * POST /api/chef/tips/withdraw
 * body: { amount?, from?, to?, note? }
 *
 * Chef withdraws tips they earned (from the 50/50 split on orders they cooked).
 * Mirrors /api/staff/tips/withdraw with chef-scoped auth. Two modes:
 *   1. Full balance: omit `amount` -> withdraws the entire available balance.
 *   2. Specific amount: pass `amount` (> 0 and <= available).
 *
 * `from` / `to` are optional YYYY-MM-DD labels recorded on the TipWithdrawal
 * ledger entry; they do NOT restrict which tips are debited.
 *
 * Race safety: findOneAndUpdate with a $expr guard atomically increments
 * tipsWithdrawn only if it stays <= tipsEarned, so concurrent withdrawals can
 * never push the balance negative.
 */
export async function POST(req: NextRequest) {
  const session = await resolveSessionForRoles(req, ['admin', 'chef'], 'chef');
  if (!session) return unauthorized('Your session has expired — please sign in again');

  const body = await req.json().catch(() => ({}));
  const { amount: amountRaw, from, to, note } = body || {};

  await dbConnect();

  // Validate the date-range labels if provided (informational only).
  let fromDate: Date | null = null;
  let toDate: Date | null = null;
  if (from) {
    const d = parseDateFromInput(String(from));
    if (!d) return fail('Invalid "from" date (use YYYY-MM-DD)', 422);
    fromDate = d;
  }
  if (to) {
    const d = parseDateToInput(String(to));
    if (!d) return fail('Invalid "to" date (use YYYY-MM-DD)', 422);
    toDate = d;
  }
  if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
    return fail('"from" date cannot be after "to" date', 422);
  }
  if (note && String(note).length > 280) {
    return fail('Note is too long (max 280 characters)', 422);
  }

  // Resolve the chef + current balance.
  const chef: any = await User.findById(session.userId).lean();
  if (!chef) return fail('Account not found', 404);
  if (chef.role !== 'chef') return fail('This account is not a chef account', 403);

  const tipsEarned = Number(chef.tipsEarned) || 0;
  const tipsWithdrawn = Number(chef.tipsWithdrawn) || 0;
  const available = Math.max(0, tipsEarned - tipsWithdrawn);
  if (available <= 0) {
    return fail('You have no tips available to withdraw', 422);
  }

  // Determine the withdrawal amount.
  let amount: number;
  if (amountRaw === null || amountRaw === undefined || amountRaw === '') {
    // Withdraw the full available balance.
    amount = available;
  } else {
    amount = Number(amountRaw);
    if (!isFinite(amount) || amount <= 0) {
      return fail('Amount must be a positive number', 422);
    }
    if (amount > available) {
      return fail(
        `Cannot withdraw ${amount.toFixed(2)} — your available balance is ${available.toFixed(2)}`,
        422,
      );
    }
  }
  // Round to 2 decimals (currency).
  amount = Math.round(amount * 100) / 100;
  if (amount <= 0) {
    return fail('Withdrawal amount must be greater than zero', 422);
  }

  // Atomic guard: increment tipsWithdrawn by `amount` ONLY if doing so keeps
  // tipsWithdrawn + amount <= tipsEarned.
  const updated: any = await User.findOneAndUpdate(
    {
      _id: chef._id,
      $expr: { $lte: [{ $add: [{ $ifNull: ['$tipsWithdrawn', 0] }, amount] }, '$tipsEarned'] },
    },
    { $inc: { tipsWithdrawn: amount } },
    { new: true },
  ).lean();

  if (!updated) {
    const fresh: any = await User.findById(chef._id).lean();
    const freshAvail = Math.max(
      0,
      (Number(fresh?.tipsEarned) || 0) - (Number(fresh?.tipsWithdrawn) || 0),
    );
    return fail(
      freshAvail > 0
        ? `Withdrawal failed — available balance changed. You can withdraw up to ${freshAvail.toFixed(2)}.`
        : 'Withdrawal failed — no tips available at this moment.',
      422,
    );
  }

  // Record the ledger entry (TipWithdrawal.staffId is reused for chefs too —
  // it is simply "the user who withdrew"; see the TipWithdrawal model comment).
  let withdrawal: any = null;
  try {
    withdrawal = await TipWithdrawal.create({
      staffId: chef._id,
      amount,
      from: fromDate,
      to: toDate,
      note: note ? String(note) : '',
      status: 'completed',
    });
  } catch (e) {
    console.error('TipWithdrawal ledger insert failed (balance already debited):', e);
  }

  const newAvailable = Math.max(
    0,
    (Number(updated.tipsEarned) || 0) - (Number(updated.tipsWithdrawn) || 0),
  );

  return ok({
    withdrawal: withdrawal
      ? {
          _id: String(withdrawal._id),
          amount: Number(withdrawal.amount.toFixed(2)),
          from: withdrawal.from || null,
          to: withdrawal.to || null,
          note: withdrawal.note || '',
          status: withdrawal.status,
          createdAt: withdrawal.createdAt,
        }
      : null,
    summary: {
      tipsEarned: Number((Number(updated.tipsEarned) || 0).toFixed(2)),
      tipsWithdrawn: Number((Number(updated.tipsWithdrawn) || 0).toFixed(2)),
      available: Number(newAvailable.toFixed(2)),
    },
  });
}
