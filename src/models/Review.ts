import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IReview extends Document {
  // Link to a specific order (so we know who and when), or a general visit.
  order?: Types.ObjectId;
  session?: Types.ObjectId;     // ref CustomerSession — the dining visit being reviewed
  tableNumber?: number;
  customer?: Types.ObjectId;   // ref Customer
  customerName: string;
  mobile?: string;
  rating: number;          // 1..5 overall
  foodRating: number;      // 1..5
  serviceRating: number;   // 1..5
  ambianceRating: number;  // 1..5
  comment: string;
  // Indicates the customer was shown / used the Google review link.
  postedToGoogle: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ReviewSchema = new Schema<IReview>(
  {
    order: { type: Schema.Types.ObjectId, ref: 'Order' },
    session: { type: Schema.Types.ObjectId, ref: 'CustomerSession', index: true },
    tableNumber: { type: Number },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', index: true },
    customerName: { type: String, default: 'Anonymous', trim: true },
    mobile: { type: String, default: '' },
    rating: { type: Number, required: true, min: 1, max: 5 },
    foodRating: { type: Number, default: 0, min: 0, max: 5 },
    serviceRating: { type: Number, default: 0, min: 0, max: 5 },
    ambianceRating: { type: Number, default: 0, min: 0, max: 5 },
    comment: { type: String, default: '' },
    postedToGoogle: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.models.Review || mongoose.model<IReview>('Review', ReviewSchema);
