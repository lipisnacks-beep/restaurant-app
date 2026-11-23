import mongoose, { Schema, Document, Types } from 'mongoose';

export type OrderStatus =
  | 'pending'      // just placed, waiting for chef to accept/start
  | 'preparing'    // chef started cooking
  | 'ready'        // chef finished, waiting for staff to deliver
  | 'served'       // staff delivered to the table
  | 'completed'    // customer paid and left
  | 'cancelled';

export type PaymentMethod = 'cash' | 'upi' | 'card';
export type PaymentStatus = 'unpaid' | 'paid' | 'refunded';

export interface OrderItem {
  menuItem: Types.ObjectId;
  name: string;
  price: number;
  quantity: number;
  note?: string;
}

export interface IOrder extends Document {
  orderNumber: string;
  table: Types.ObjectId;
  tableNumber: number;
  sessionId: string;          // groups multiple orders from one seating
  customer?: Types.ObjectId;  // ref Customer (the diner who placed this order)
  customerMobile?: string;    // denormalised for lookups
  items: OrderItem[];
  subtotal: number;
  taxRate: number;            // percentage, e.g. 5
  taxAmount: number;
  serviceChargeRate: number;  // percentage, e.g. 10
  serviceChargeAmount: number;
  tip: number;
  total: number;
  status: OrderStatus;
  paymentMethod?: PaymentMethod;
  paymentStatus: PaymentStatus;
  customerName?: string;
  notes?: string;
  chefId?: Types.ObjectId;
  staffId?: Types.ObjectId;   // staff who accepted/delivered
  rating?: number;             // 1..5, set by customer
  createdAt: Date;
  updatedAt: Date;
  placedAt: Date;
  preparingAt?: Date;
  readyAt?: Date;
  acceptedAt?: Date;           // when a staff accepted the ready order
  assignedAt?: Date;           // when the dispatch engine routed this order to a chef
  estimatedChefAssignBy?: Date; // ETA shown to the customer while no chef is available
  staffAssignedAt?: Date;        // when the dispatch engine routed this ready order to a staff
  estimatedStaffAssignBy?: Date; // ETA shown to the customer while no staff is available to serve
  servedAt?: Date;
  completedAt?: Date;
  cancelledAt?: Date;
}

const OrderItemSchema = new Schema<OrderItem>(
  {
    menuItem: { type: Schema.Types.ObjectId, ref: 'MenuItem', required: true },
    name: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    note: { type: String, default: '' },
  },
  { _id: false }
);

const OrderSchema = new Schema<IOrder>(
  {
    orderNumber: { type: String, required: true, unique: true, index: true },
    table: { type: Schema.Types.ObjectId, ref: 'Table', required: true, index: true },
    tableNumber: { type: Number, required: true },
    sessionId: { type: String, required: true, index: true },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', index: true },
    customerMobile: { type: String, default: '' },
    items: { type: [OrderItemSchema], default: [] },
    subtotal: { type: Number, default: 0, min: 0 },
    taxRate: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    serviceChargeRate: { type: Number, default: 0 },
    serviceChargeAmount: { type: Number, default: 0 },
    tip: { type: Number, default: 0, min: 0 },
    total: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ['pending', 'preparing', 'ready', 'served', 'completed', 'cancelled'],
      default: 'pending',
      index: true,
    },
    paymentMethod: { type: String, enum: ['cash', 'upi', 'card'] },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'paid', 'refunded'],
      default: 'unpaid',
      index: true,
    },
    customerName: { type: String, default: '' },
    notes: { type: String, default: '' },
    chefId: { type: Schema.Types.ObjectId, ref: 'User' },
    staffId: { type: Schema.Types.ObjectId, ref: 'User' },
    rating: { type: Number, min: 1, max: 5 },
    placedAt: { type: Date, default: Date.now },
    preparingAt: { type: Date },
    readyAt: { type: Date },
    acceptedAt: { type: Date },
    assignedAt: { type: Date, index: true },
    estimatedChefAssignBy: { type: Date },
    staffAssignedAt: { type: Date, index: true },
    estimatedStaffAssignBy: { type: Date },
    servedAt: { type: Date },
    completedAt: { type: Date },
    cancelledAt: { type: Date },
  },
  { timestamps: true }
);

export default mongoose.models.Order || mongoose.model<IOrder>('Order', OrderSchema);
