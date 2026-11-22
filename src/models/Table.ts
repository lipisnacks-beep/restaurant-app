import mongoose, { Schema, Document } from 'mongoose';

export interface ITable extends Document {
  number: number;
  name: string;
  seats: number;
  active: boolean;
  // Current dining session reference (if a customer is seated and ordering).
  currentSession?: {
    sessionId: string;
    startedAt: Date;
    customerName?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const TableSchema = new Schema<ITable>(
  {
    number: { type: Number, required: true, unique: true, min: 1 },
    name: { type: String, required: true, trim: true },
    seats: { type: Number, default: 4, min: 1, max: 20 },
    active: { type: Boolean, default: true },
    currentSession: {
      sessionId: { type: String, default: '' },
      startedAt: { type: Date },
      customerName: { type: String, default: '' },
    },
  },
  { timestamps: true }
);

export default mongoose.models.Table || mongoose.model<ITable>('Table', TableSchema);
