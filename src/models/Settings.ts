import mongoose, { Schema, Document } from 'mongoose';

/**
 * Singleton site-wide settings: everything the admin can tune for the
 * restaurant/cafe from the Settings tab — brand (name + logo), contact
 * details, billing policy (tax + service charge + currency), operating hours,
 * accepted payment methods, social/external links and operational defaults.
 *
 * There is exactly ONE document in this collection (keyed by `singleton: true`).
 * It is read on every public page render via getSettings() (cached server-side)
 * so the whole app is driven by these values without redeploying.
 */
export interface ISettings extends Document {
  // --- Brand ---
  restaurantName: string;
  tagline: string;            // short subtitle shown under the name (home header, customer welcome)
  logoUrl: string | null;

  // --- Contact ---
  phone: string;
  email: string;
  address: string;

  // --- Billing policy ---
  currencySymbol: string;     // e.g. "₹", "$", "€"
  taxRate: number;             // percent applied to subtotal, e.g. 5 = 5%
  serviceChargeRate: number;   // percent applied to subtotal, e.g. 10 = 10%

  // --- Operating hours (daily, 24h "HH:MM" strings; empty opening = closed) ---
  hours: {
    mon: { open: string; close: string };
    tue: { open: string; close: string };
    wed: { open: string; close: string };
    thu: { open: string; close: string };
    fri: { open: string; close: string };
    sat: { open: string; close: string };
    sun: { open: string; close: string };
  };

  // --- Payment methods accepted at this restaurant (drives the customer PayView) ---
  paymentMethods: {
    cash: boolean;
    upi: boolean;
    card: boolean;
  };
  upiId: string;               // shown to the customer when UPI is selected

  // --- External links ---
  googleReviewUrl: string;     // customer is redirected here after dining
  websiteUrl: string;
  instagramUrl: string;
  facebookUrl: string;

  /** Always true — used only for the unique index that enforces a single doc. */
  singleton?: boolean;
  updatedAt: Date;
  createdAt: Date;
}

const HoursDaySchema = new Schema(
  { open: { type: String, default: '' }, close: { type: String, default: '' } },
  { _id: false }
);

const SettingsSchema = new Schema<ISettings>(
  {
    // --- Brand ---
    restaurantName: { type: String, required: true, default: 'Lipi Snacks', trim: true, maxlength: 60 },
    tagline: { type: String, default: 'Restaurant / Cafe Management System', trim: true, maxlength: 120 },
    logoUrl: { type: String, default: null, trim: true },

    // --- Contact ---
    phone: { type: String, default: '', trim: true, maxlength: 30 },
    email: { type: String, default: '', trim: true, lowercase: true, maxlength: 120 },
    address: { type: String, default: '', trim: true, maxlength: 300 },

    // --- Billing policy ---
    currencySymbol: { type: String, default: '₹', trim: true, maxlength: 4 },
    taxRate: { type: Number, default: 0, min: 0, max: 100 },
    serviceChargeRate: { type: Number, default: 0, min: 0, max: 100 },

    // --- Operating hours ---
    hours: {
      type: new Schema(
        {
          mon: { type: HoursDaySchema, default: () => ({ open: '09:00', close: '22:00' }) },
          tue: { type: HoursDaySchema, default: () => ({ open: '09:00', close: '22:00' }) },
          wed: { type: HoursDaySchema, default: () => ({ open: '09:00', close: '22:00' }) },
          thu: { type: HoursDaySchema, default: () => ({ open: '09:00', close: '22:00' }) },
          fri: { type: HoursDaySchema, default: () => ({ open: '09:00', close: '23:00' }) },
          sat: { type: HoursDaySchema, default: () => ({ open: '09:00', close: '23:00' }) },
          sun: { type: HoursDaySchema, default: () => ({ open: '10:00', close: '22:00' }) },
        },
        { _id: false }
      ),
      default: () => ({}),
    },

    // --- Payment methods ---
    paymentMethods: {
      type: new Schema(
        {
          cash: { type: Boolean, default: true },
          upi: { type: Boolean, default: true },
          card: { type: Boolean, default: true },
        },
        { _id: false }
      ),
      default: () => ({ cash: true, upi: true, card: true }),
    },
    upiId: { type: String, default: '', trim: true, maxlength: 60 },

    // --- External links ---
    googleReviewUrl: { type: String, default: '', trim: true, maxlength: 500 },
    websiteUrl: { type: String, default: '', trim: true, maxlength: 500 },
    instagramUrl: { type: String, default: '', trim: true, maxlength: 500 },
    facebookUrl: { type: String, default: '', trim: true, maxlength: 500 },

    // Enforce a single settings document (singleton).
    singleton: { type: Boolean, default: true, unique: true },
  },
  { timestamps: true }
);

export default mongoose.models.Settings || mongoose.model<ISettings>('Settings', SettingsSchema);
