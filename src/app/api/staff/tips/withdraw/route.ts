import { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import User from '@/models/User';
import TipWithdrawal from '@/models/TipWithdrawal';
import { resolveSessionForRoles } from '@/lib/auth';
import { ok, fail, unauthorized } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * POST /api/staff/tips/withdraw
 * body: { amount?, from?, to?, note? }
 *
 * Staff withdraws tips. Two modes:
 *   1. Full balance: omit `amount` (or set null) -> withdraws the entire
 *      available balance at the instant of the call.
 *   2. Specific amount: pass `amount` (must be > 0 and <= available). This is
 *      the common case when the staff picks a date range and withdraws just
 *      those days' tips.
 *
 * `from` / `to` are optional YYYY-MM-DD strings that label which dates this
 * payout covers (purely informational — recorded on the TipWithdrawal doc so
 * the ledger shows what the payout was for). They do NOT restrict which tips
 * are debited; the available balance is one pooled number.
 *
 * Race safety: we do NOT read the balance and then write. Instead we use a
 * findOneAndUpdate with a guard expression that atomically increments
 * tipsWithdrawn only if it stays <= tipsEarned. If two staff tabs withdraw at
 * the same instant, MongoDB's document-level locking ensures exactly one of
 * them sees the updated balance and the other is rejected with "insufficient
 * balance" — the balance can never go negative.
 *
 * On success we create a TipWithdrawal record (the ledger entry) and return
 * the new available balance + the withdrawal record.
 */
export async function POST(req: NextRequest) {
  const session = await resolveSessionForRoles(req, ['admin', 'staff'], 'staff');
  if (!session) return unauthorized('Your session has expired — please sign in again');

  const body = await req.json().catch(() => ({}));
  const { amount: amountRaw, from, to, note } = body || {};

  await dbConnect();

  // Validate the date-range labels if provided (informational only).
  let fromDate: Date | null = null;
  let toDate: Date | null = null;
  if (from) {
    const d = new Date(String(from));
    if (isNaN(d.getTime())) return fail('Invalid "from" date (use YYYY-MM-DD)', 422);
    fromDate = d;
  }
  if (to) {
    const d = new Date(String(to));
    if (isNaN(d.getTime())) return fail('Invalid "to" date (use YYYY-MM-DD)', 422);
    toDate = d;
  }
  if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
    return fail('"from" date cannot be after "to" date', 422);
  }
  if (note && String(note).length > 280) {
    return fail('Note is too long (max 280 characters)', 422);
  }

  // Resolve the staff + current balance.
  const staff: any = await User.findById(session.userId).lean();
  if (!staff) return fail('Account not found', 404);
  if (staff.role !== 'staff') return fail('This account is not a staff account', 403);

  const tipsEarned = Number(staff.tipsEarned) || 0;
  const tipsWithdrawn = Number(staff.tipsWithdrawn) || 0;
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
  // tipsWithdrawn + amount <= tipsEarned. This is the race-safe core — two
  // concurrent withdrawals cannot both succeed and push the balance negative.
  const updated: any = await User.findOneAndUpdate(
    {
      _id: staff._id,
      // $expr guard: (tipsWithdrawn + amount) <= tipsEarned
      $expr: { $lte: [{ $add: [{ $ifNull: ['$tipsWithdrawn', 0] }, amount] }, '$tipsEarned'] },
    },
    { $inc: { tipsWithdrawn: amount } },
    { new: true },
  ).lean();

  if (!updated) {
    // The guard rejected it — either the balance changed under us, or the
    // amount now exceeds available. Re-read and report the real reason.
    const fresh: any = await User.findById(staff._id).lean();
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

  // Record the ledger entry. If this insert fails (rare), we've already
  // debited the balance — log the discrepancy but don't roll back the
  // withdrawal, because the staff already has the money. The ledger is
  // informational; the User.tipsWithdrawn total is the source of truth.
  let withdrawal: any = null;
  try {
    withdrawal = await TipWithdrawal.create({
      staffId: staff._id,
      amount,
      from: fromDate,
      to: toDate,
      note: note ? String(note) : '',
      status: 'completed',
    });
  } catch (e) {
    // Non-fatal: the balance was debited correctly. Surface a soft warning.
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
