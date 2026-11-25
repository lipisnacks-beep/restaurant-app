import mongoose, { Schema, Document } from 'mongoose';

export type ExpenseCategory =
  | 'rent'        // shop rent / lease
  | 'utilities'   // electricity, water, gas, internet
  | 'salaries'    // staff & chef wages
  | 'maintenance' // repairs, equipment service
  | 'marketing'   // ads, flyers, banners
  | 'supplies'    // cleaning, disposables, small consumables
  | 'transport'   // delivery fuel, vehicle upkeep
  | 'miscellaneous';

export type PaymentMethod = 'cash' | 'upi' | 'card' | 'bank' | 'cheque';

export interface IExpense extends Document {
  date: Date;                 // the date the expense was incurred
  category: ExpenseCategory;
  description: string;        // free-text label e.g. "November electricity bill"
  amount: number;             // total amount in the restaurant's currency
  paymentMethod: PaymentMethod;
  vendor?: string;            // who was paid (e.g. "BSES Yamuna")
  invoiceNumber?: string;     // optional bill/invoice reference
  note?: string;
  createdBy: mongoose.Types.ObjectId;  // admin who recorded it
  createdAt: Date;
  updatedAt: Date;
}

const ExpenseSchema = new Schema<IExpense>(
  {
    date: { type: Date, required: true, index: true },
    category: { type: String, enum: ['rent','utilities','salaries','maintenance','marketing','supplies','transport','miscellaneous'], required: true, index: true },
    description: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    paymentMethod: { type: String, enum: ['cash','upi','card','bank','cheque'], default: 'cash' },
    vendor: { type: String, default: '', trim: true },
    invoiceNumber: { type: String, default: '', trim: true },
    note: { type: String, default: '', trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

// Fast filter by date-range + category, used heavily by reports.
ExpenseSchema.index({ date: 1, category: 1 });

export default mongoose.models.Expense || mongoose.model<IExpense>('Expense', ExpenseSchema);
export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'rent','utilities','salaries','maintenance','marketing','supplies','transport','miscellaneous',
];
export const EXPENSE_PAYMENT_METHODS: PaymentMethod[] = ['cash','upi','card','bank','cheque'];
