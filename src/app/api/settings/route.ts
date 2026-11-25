import { NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import dbConnect from '@/lib/db';
import Settings from '@/models/Settings';
import { getSettings, invalidateSettingsCache } from '@/lib/settings';
import { uploadImage } from '@/lib/cloudinary';
import { ok, fail, unauthorized, forbidden } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * GET /api/settings
 *   PUBLIC — returns the restaurant name + logo URL for branding on the home
 *   page, customer menu and all portal headers. No auth required so the
 *   customer-facing pages can render the brand before/without a session.
 */
export async function GET() {
  const settings = await getSettings();
  return ok(settings);
}

/**
 * PUT /api/settings
 *   Admin-only. Updates the restaurant name and/or logo.
 *
 *   Body: {
 *     restaurantName?: string,         // new name (1..60 chars)
 *     logoDataUri?: string,            // data:image/... to upload to Cloudinary
 *     logoUrl?: string | null,         // 'https://...' to keep an existing URL,
 *                                      // or null to remove the logo
 *   }
 *
 * Logo resolution rules (in priority order):
 *   1. logoDataUri present  -> upload to Cloudinary, store returned URL.
 *   2. logoUrl === null      -> clear the logo (admin clicked "Remove logo").
 *   3. logoUrl is a string   -> keep that URL as-is (e.g. unchanged).
 *   4. none of the above     -> leave the existing logo untouched.
 */
export async function PUT(req: NextRequest) {
  const session = await getSession('admin');
  if (!session) return unauthorized('Your session has expired — please sign in again');
  if (session.role !== 'admin') return forbidden('Only an admin can change site settings');

  const body = await req.json();
  const { restaurantName, logoDataUri, logoUrl } = body || {};

  // --- validate restaurant name if provided ---
  let nextName: string | undefined;
  if (restaurantName !== undefined) {
    if (typeof restaurantName !== 'string' || restaurantName.trim().length === 0) {
      return fail('Restaurant name cannot be empty', 422);
    }
    if (restaurantName.trim().length > 60) {
      return fail('Restaurant name must be 60 characters or fewer', 422);
    }
    nextName = restaurantName.trim();
  }

  // --- resolve the next logo URL ---
  let nextLogo: string | null | undefined;
  if (logoDataUri !== undefined && logoDataUri !== null && logoDataUri !== '') {
    if (typeof logoDataUri !== 'string' || !logoDataUri.startsWith('data:image')) {
      return fail('Logo must be a valid data:image/... data URI', 422);
    }
    try {
      nextLogo = await uploadImage(logoDataUri, 'restaurant/brand');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Logo upload failed';
      return fail(msg, 500);
    }
  } else if (logoUrl === null) {
    // Explicit removal.
    nextLogo = null;
  } else if (typeof logoUrl === 'string' && logoUrl.trim()) {
    // Keep an existing/explicit URL.
    nextLogo = logoUrl.trim();
  }
  // else: logo fields absent entirely -> leave existing logo untouched.

  await dbConnect();
  // Upsert the singleton settings document.
  const update: Record<string, unknown> = {};
  if (nextName !== undefined) update.restaurantName = nextName;
  if (nextLogo !== undefined) update.logoUrl = nextLogo;

  const doc = (await Settings.findOneAndUpdate(
    { singleton: true },
    { $set: { ...update, singleton: true } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean()) as { restaurantName?: string; logoUrl?: string | null } | null;

  invalidateSettingsCache();

  const result = {
    restaurantName: doc?.restaurantName || 'Lipi Snacks',
    logoUrl: doc?.logoUrl || null,
  };
  return ok(result);
}
