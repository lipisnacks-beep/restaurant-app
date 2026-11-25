import mongoose, { Schema, Document } from 'mongoose';

/**
 * Singleton site-wide settings: the restaurant/cafe name + logo URL.
 *
 * There is exactly ONE document in this collection (keyed by `singleton: true`).
 * It is read on every public page render (home, customer menu, all portal
 * headers) so the brand is dynamic and editable from the admin Settings tab
 * without redeploying. Defaults to "Lipi Snacks" until an admin changes it.
 */
export interface ISettings extends Document {
  restaurantName: string;
  logoUrl: string | null;
  /** Always true — used only for the unique index that enforces a single doc. */
  singleton?: boolean;
  updatedAt: Date;
  createdAt: Date;
}

const SettingsSchema = new Schema<ISettings>(
  {
    restaurantName: { type: String, required: true, default: 'Lipi Snacks', trim: true },
    logoUrl: { type: String, default: null, trim: true },
    // Enforce a single settings document (singleton).
    singleton: { type: Boolean, default: true, unique: true },
  },
  { timestamps: true }
);

export default mongoose.models.Settings || mongoose.model<ISettings>('Settings', SettingsSchema);
