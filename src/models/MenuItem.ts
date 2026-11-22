import mongoose, { Schema, Document } from 'mongoose';

export interface IMenuItem extends Document {
  name: string;
  description: string;
  category: string;
  price: number;
  image: string; // Cloudinary secure URL
  available: boolean;
  veg: boolean;
  prepTime: number; // minutes
  createdAt: Date;
  updatedAt: Date;
}

const MenuItemSchema = new Schema<IMenuItem>(
  {
    name: { type: String, required: true, trim: true, index: 'text' },
    description: { type: String, default: '' },
    category: { type: String, required: true, index: true },
    price: { type: Number, required: true, min: 0 },
    image: { type: String, default: '' },
    available: { type: Boolean, default: true },
    veg: { type: Boolean, default: true },
    prepTime: { type: Number, default: 15, min: 1 },
  },
  { timestamps: true }
);

export default mongoose.models.MenuItem || mongoose.model<IMenuItem>('MenuItem', MenuItemSchema);
