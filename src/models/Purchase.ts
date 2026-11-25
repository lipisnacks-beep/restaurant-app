import mongoose, { Schema, Document, Types } from 'mongoose';

export type PurchaseCategory =
  | 'raw-material'   // flour, oil, spices, vegetables, meat
  | 'beverages'      // soft drinks, tea, coffee beans
  | 'packaging'      // boxes, bags, cups, tissues
  | 'equipment'      // one-time kitchen/utensil purchases
  | 'groceries'      // general store supplies
  | 'other';

export type PaymentMethod = 'cash' | 'upi' | 'card' | 'bank' | 'cheque' | 'credit';

export interface PurchaseItem {
  name: string;
  quantity: number;
  unit: string;       // kg, ltr, pcs, box...
  rate: number;       // per-unit price
  amount: number;     // quantity * rate
}

export interface IPurchase extends Document {
  date: Date;                 // the date the purchase was made
  category: PurchaseCategory;
  supplier?: string;          // vendor/supplier name (e.g. "Annapurna Wholesale")
  invoiceNumber?: string;
  items: PurchaseItem[];      // itemised line items
  subtotal: number;           // sum of item.amount
  taxAmount: number;          // GST / VAT added
  discount: number;           // flat discount applied
  total: number;              // subtotal + tax - discount
  paymentMethod: PaymentMethod;
  paymentStatus: 'paid' | 'partial' | 'unpaid';
  amountPaid: number;         // how much has been paid so far (for credit/partial)
  note?: string;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const PurchaseItemSchema = new Schema<PurchaseItem>(
  {
    name: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, default: 'pcs', trim: true },
    rate: { type: Number, required: true, min: 0 },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const PurchaseSchema = new Schema<IPurchase>(
  {
    date: { type: Date, required: true, index: true },
    category: { type: String, enum: ['raw-material','beverages','packaging','equipment','groceries','other'], required: true, index: true },
    supplier: { type: String, default: '', trim: true },
    invoiceNumber: { type: String, default: '', trim: true },
    items: { type: [PurchaseItemSchema], default: [] },
    subtotal: { type: Number, default: 0, min: 0 },
    taxAmount: { type: Number, default: 0, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    total: { type: Number, default: 0, min: 0 },
    paymentMethod: { type: String, enum: ['cash','upi','card','bank','cheque','credit'], default: 'cash' },
    paymentStatus: { type: String, enum: ['paid','partial','unpaid'], default: 'paid' },
    amountPaid: { type: Number, default: 0, min: 0 },
    note: { type: String, default: '', trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

PurchaseSchema.index({ date: 1, category: 1 });
PurchaseSchema.index({ supplier: 1 });

export default mongoose.models.Purchase || mongoose.model<IPurchase>('Purchase', PurchaseSchema);
export const PURCHASE_CATEGORIES: PurchaseCategory[] = [
  'raw-material','beverages','packaging','equipment','groceries','other',
];
export const PURCHASE_PAYMENT_METHODS: PaymentMethod[] = ['cash','upi','card','bank','cheque','credit'];
