import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * A real customer identified by mobile number. We upsert by mobile on every QR
 * scan so a returning guest doesn't get a duplicate record, and we keep a count
 * of how many dining sessions they've had at this restaurant.
 */
export interface ICustomer extends Document {
  name: string;
  mobile: string;        // unique, indexed — 10-digit Indian mobile by convention
  visits: number;        // number of dining sessions
  lastVisitAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CustomerSchema = new Schema<ICustomer>(
  {
    name: { type: String, required: true, trim: true },
    mobile: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      // Normalise to digits only; the API layer also validates length.
      set: (v: string) => (v || '').replace(/\D/g, ''),
    },
    visits: { type: Number, default: 0, min: 0 },
    lastVisitAt: { type: Date },
  },
  { timestamps: true }
);

export default (mongoose.models.Customer as mongoose.Model<ICustomer>) ||
  mongoose.model<ICustomer>('Customer', CustomerSchema);
