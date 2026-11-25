/**
 * Pure TypeScript types + defaults for the restaurant settings.
 *
 * IMPORTANT: this module must stay free of any server-only imports (no
 * mongoose, no dbConnect, no @/models/*). Client components (Brand.tsx,
 * CustomerApp.tsx) import from here, so anything pulled in transitively ships
 * to the browser bundle. The server-only `getSettings()` lives in
 * `lib/settings.ts` instead.
 */
export interface HoursDay { open: string; close: string }
export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface RestaurantSettings {
  // Brand
  restaurantName: string;
  tagline: string;
  logoUrl: string | null;
  // Contact
  phone: string;
  email: string;
  address: string;
  // Billing policy
  currencySymbol: string;
  taxRate: number;
  serviceChargeRate: number;
  // Operating hours
  hours: Record<DayKey, HoursDay>;
  // Payment methods
  paymentMethods: { cash: boolean; upi: boolean; card: boolean };
  upiId: string;
  // External links
  googleReviewUrl: string;
  websiteUrl: string;
  instagramUrl: string;
  facebookUrl: string;
}

/** Subset for components that only render the brand mark (logo + name). */
export interface BrandSettings {
  restaurantName: string;
  logoUrl: string | null;
}

export const DEFAULT_HOURS: Record<DayKey, HoursDay> = {
  mon: { open: '09:00', close: '22:00' },
  tue: { open: '09:00', close: '22:00' },
  wed: { open: '09:00', close: '22:00' },
  thu: { open: '09:00', close: '22:00' },
  fri: { open: '09:00', close: '23:00' },
  sat: { open: '09:00', close: '23:00' },
  sun: { open: '10:00', close: '22:00' },
};

export const DEFAULT_SETTINGS: RestaurantSettings = {
  restaurantName: 'Lipi Snacks',
  tagline: 'Restaurant / Cafe Management System',
  logoUrl: null,
  phone: '',
  email: '',
  address: '',
  currencySymbol: '₹',
  taxRate: 0,
  serviceChargeRate: 0,
  hours: DEFAULT_HOURS,
  paymentMethods: { cash: true, upi: true, card: true },
  upiId: '',
  googleReviewUrl: '',
  websiteUrl: '',
  instagramUrl: '',
  facebookUrl: '',
};
