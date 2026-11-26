import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * A single dining session: one customer, one table, possibly many orders.
 *
 * Lifecycle:
 *   active  -> customer is seated & ordering (startedAt set)
 *   paid    -> customer paid the bill (endedAt set, table still reserved)
 *   completed -> customer submitted their review (reviewAt set)
 *   closed  -> staff freed the table for the next guest (closedAt set)
 *
 * The occupied time shown in the admin panel is endedAt - startedAt (or
 * now - startedAt while still active).
 */
export type CustomerSessionStatus = 'active' | 'paid' | 'completed' | 'closed';

export interface ICustomerSession extends Document {
  sessionId: string;           // unique token stored in the customer's cookie
  customer: Types.ObjectId;    // ref Customer
  customerName: string;        // denormalised for chef/staff convenience
  mobile: string;              // denormalised
  table: Types.ObjectId;      // ref Table
  tableNumber: number;         // denormalised
  status: CustomerSessionStatus;
  startedAt: Date;
  endedAt?: Date;              // set when the bill is paid
  reviewAt?: Date;             // set when the customer submits a review
  closedAt?: Date;             // set when staff frees the table
  // Aggregate of all orders in this session (updated on payment).
  orderCount: number;
  subtotal: number;
  taxAmount: number;
  serviceChargeAmount: number;
  tip: number;
  total: number;
  /** WhatsApp invoice delivery state (src/lib/whatsapp.ts). Absent until the first attempt. */
  invoiceDelivery?: {
    status: 'sent' | 'optin-needed' | 'failed' | 'not-configured' | 'skipped-no-mobile';
    at: Date;
    error?: string;
    wamid?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const CustomerSessionSchema = new Schema<ICustomerSession>(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    customerName: { type: String, default: '' },
    mobile: { type: String, default: '' },
    table: { type: Schema.Types.ObjectId, ref: 'Table', required: true, index: true },
    tableNumber: { type: Number, required: true },
    status: {
      type: String,
      enum: ['active', 'paid', 'completed', 'closed'],
      default: 'active',
      index: true,
    },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date },
    reviewAt: { type: Date },
    closedAt: { type: Date },
    orderCount: { type: Number, default: 0, min: 0 },
    subtotal: { type: Number, default: 0, min: 0 },
    taxAmount: { type: Number, default: 0, min: 0 },
    serviceChargeAmount: { type: Number, default: 0, min: 0 },
    tip: { type: Number, default: 0, min: 0 },
    total: { type: Number, default: 0, min: 0 },
    /**
     * WhatsApp invoice delivery state (see src/lib/whatsapp.ts). Written by
     * the payment flow / webhook; 'sent' is final and makes every later
     * delivery attempt a no-op so webhook retries can't spam the customer.
     */
    invoiceDelivery: {
      status: {
        type: String,
        enum: ['sent', 'optin-needed', 'failed', 'not-configured', 'skipped-no-mobile'],
      },
      at: { type: Date },
      error: { type: String },
      wamid: { type: String },
    },
  },
  { timestamps: true }
);

export default (mongoose.models.CustomerSession as mongoose.Model<ICustomerSession>) ||
  mongoose.model<ICustomerSession>('CustomerSession', CustomerSessionSchema);
