import dbConnect from '@/lib/db';
import Settings from '@/models/Settings';

export interface BrandSettings {
  restaurantName: string;
  logoUrl: string | null;
}

const DEFAULTS: BrandSettings = { restaurantName: 'Lipi Snacks', logoUrl: null };

// Cache the brand for a short window (5 minutes) so repeated renders don't
// each open a Mongo connection. In dev (next dev) module cache can be wiped on
// hot reload, which is fine — the cache simply rebuilds on the next read.
let cache: { value: BrandSettings; at: number } | null = null;
const TTL_MS = 5 * 60 * 1000;

/**
 * Read the singleton site-wide brand settings (restaurant name + logo URL).
 * Falls back to defaults if no document exists yet (e.g. fresh install).
 *
 * Safe to call from server components and API routes. Returns a plain object
 * (never a mongoose doc) so it can be passed to client components as a prop
 * without leaking the full document prototype.
 */
export async function getSettings(): Promise<BrandSettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  // At build time (static prerender) MONGODB_URI may not be set — return
  // defaults instead of throwing, so pages can still be generated.
  if (!process.env.MONGODB_URI) return DEFAULTS;
  try {
    await dbConnect();
    const doc = (await Settings.findOne({ singleton: true }).lean().exec()) as
      { restaurantName?: string; logoUrl?: string | null } | null;
    const value: BrandSettings = {
      restaurantName: doc?.restaurantName?.trim() || DEFAULTS.restaurantName,
      logoUrl: doc?.logoUrl?.trim() || null,
    };
    cache = { value, at: Date.now() };
    return value;
  } catch {
    // If the DB is unreachable (build time / transient), fall back to defaults
    // so the app still renders instead of throwing a 500.
    return DEFAULTS;
  }
}

/** Invalidate the in-memory cache after an admin updates the settings. */
export function invalidateSettingsCache(): void {
  cache = null;
}
