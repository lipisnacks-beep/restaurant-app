import dbConnect from '@/lib/db';
import Settings from '@/models/Settings';
// Re-export the pure TS types + defaults so existing imports
// (`from '@/lib/settings'`) keep working. Client components should import the
// types/defaults from '@/lib/settings.types' directly to avoid pulling
// mongoose/dbConnect into the browser bundle.
export {
  DEFAULT_SETTINGS,
  DEFAULT_HOURS,
  type RestaurantSettings,
  type BrandSettings,
  type HoursDay,
  type DayKey,
} from '@/lib/settings.types';
import {
  DEFAULT_SETTINGS,
  DEFAULT_HOURS,
  type RestaurantSettings,
  type DayKey,
  type HoursDay,
} from '@/lib/settings.types';

// Cache the settings for a short window (5 minutes) so repeated renders don't
// each open a Mongo connection. In dev (next dev) module cache can be wiped on
// hot reload, which is fine — the cache simply rebuilds on the next read.
let cache: { value: RestaurantSettings; at: number } | null = null;
const TTL_MS = 5 * 60 * 1000;

function normalize(raw: Partial<RestaurantSettings> | null): RestaurantSettings {
  if (!raw) return { ...DEFAULT_SETTINGS, hours: { ...DEFAULT_HOURS } };
  const hours: Record<DayKey, HoursDay> = { ...DEFAULT_HOURS };
  (Object.keys(DEFAULT_HOURS) as DayKey[]).forEach((d) => {
    const h = raw.hours?.[d];
    if (h) hours[d] = { open: h.open || '', close: h.close || '' };
  });
  return {
    restaurantName: raw.restaurantName?.trim() || DEFAULT_SETTINGS.restaurantName,
    tagline: raw.tagline ?? DEFAULT_SETTINGS.tagline,
    logoUrl: raw.logoUrl?.trim() || null,
    phone: raw.phone ?? '',
    email: raw.email ?? '',
    address: raw.address ?? '',
    currencySymbol: raw.currencySymbol?.trim() || DEFAULT_SETTINGS.currencySymbol,
    taxRate: typeof raw.taxRate === 'number' ? raw.taxRate : DEFAULT_SETTINGS.taxRate,
    serviceChargeRate: typeof raw.serviceChargeRate === 'number' ? raw.serviceChargeRate : DEFAULT_SETTINGS.serviceChargeRate,
    hours,
    paymentMethods: {
      cash: raw.paymentMethods?.cash ?? true,
      upi: raw.paymentMethods?.upi ?? true,
      card: raw.paymentMethods?.card ?? true,
    },
    upiId: raw.upiId ?? '',
    googleReviewUrl: raw.googleReviewUrl ?? '',
    websiteUrl: raw.websiteUrl ?? '',
    instagramUrl: raw.instagramUrl ?? '',
    facebookUrl: raw.facebookUrl ?? '',
  };
}

/**
 * Read the singleton site-wide restaurant settings. Falls back to defaults if
 * no document exists yet (e.g. fresh install).
 *
 * SERVER-ONLY. Safe to call from server components and API routes. Returns a
 * plain object (never a mongoose doc) so it can be passed to client components
 * as a prop without leaking the full document prototype.
 */
export async function getSettings(): Promise<RestaurantSettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  // At build time (static prerender) MONGODB_URI may not be set — return
  // defaults instead of throwing, so pages can still be generated.
  if (!process.env.MONGODB_URI) return { ...DEFAULT_SETTINGS, hours: { ...DEFAULT_HOURS } };
  try {
    await dbConnect();
    const doc = (await Settings.findOne({ singleton: true }).lean().exec()) as
      Partial<RestaurantSettings> | null;
    const value = normalize(doc);
    cache = { value, at: Date.now() };
    return value;
  } catch {
    // If the DB is unreachable (build time / transient), fall back to defaults
    // so the app still renders instead of throwing a 500.
    return { ...DEFAULT_SETTINGS, hours: { ...DEFAULT_HOURS } };
  }
}

/** Invalidate the in-memory cache after an admin updates the settings. */
export function invalidateSettingsCache(): void {
  cache = null;
}
