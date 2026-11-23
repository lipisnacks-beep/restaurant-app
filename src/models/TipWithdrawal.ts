import mongoose, { Schema, Document } from 'mongoose';

/**
 * TipWithdrawal — a record of a staff member withdrawing tips they earned.
 *
 * Each withdrawal captures:
 *   - staffId: which staff withdrew (ref User, role staff)
 *   - amount: how much was withdrawn (currency units, e.g. BDT)
 *   - from / to: the date range of tips this withdrawal covers (so the staff
 *     can see which days' tips were paid out together). Either can be null if
 *     the staff withdrew their full balance without specifying a range.
 *   - note: optional free-text note (e.g. "Cash payout at counter").
 *   - status: 'completed' (default) — the money left the system. Reserved
 *     'pending' for a future approval flow (admin sign-off) but not used yet.
 *
 * The staff's available balance is computed as tipsEarned - tipsWithdrawn
 * (both cumulative totals on the User doc). Each withdrawal atomically
 * creates this record AND increments tipsWithdrawn, so the balance can never
 * go negative even under concurrent withdrawal attempts.
 */
export interface ITipWithdrawal extends Document {
  staffId: mongoose.Types.ObjectId;
  amount: number;
  from?: Date | null;     // start of the date range this withdrawal covers
  to?: Date | null;       // end (inclusive) of the date range
  note?: string;
  status: 'completed' | 'pending';
  createdAt: Date;
  updatedAt: Date;
}

const TipWithdrawalSchema = new Schema<ITipWithdrawal>(
  {
    staffId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amount: { type: Number, required: true, min: 0.01 },
    from: { type: Date, default: null },
    to: { type: Date, default: null },
    note: { type: String, default: '', trim: true, maxlength: 280 },
    status: { type: String, enum: ['completed', 'pending'], default: 'completed', index: true },
  },
  { timestamps: true }
);

// Common query: list a staff's withdrawals newest-first.
TipWithdrawalSchema.index({ staffId: 1, createdAt: -1 });

export default (mongoose.models.TipWithdrawal as mongoose.Model<ITipWithdrawal>) ||
  mongoose.model<ITipWithdrawal>('TipWithdrawal', TipWithdrawalSchema);
