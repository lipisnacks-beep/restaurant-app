import { NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import dbConnect from '@/lib/db';
import Settings from '@/models/Settings';
import { getSettings, invalidateSettingsCache, type DayKey } from '@/lib/settings';
import { uploadImage } from '@/lib/cloudinary';
import { ok, fail, unauthorized, forbidden } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const DAYS: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * GET /api/settings
 *   PUBLIC — returns the full restaurant settings (brand, contact, billing,
 *   hours, payment methods, links). No auth required so customer-facing pages
 *   can render everything without a session.
 */
export async function GET() {
  const settings = await getSettings();
  return ok(settings);
}

/** Parse a number; returns undefined if input isn't a finite number. */
function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Reject strings longer than max (returns trimmed value or pushes an error). */
function boundedStr(v: unknown, max: number, label: string, errors: string[]): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (t.length > max) errors.push(`${label} must be ${max} characters or fewer`);
  return t;
}

/**
 * PUT /api/settings
 *   Admin-only. Updates any subset of the restaurant settings. Only the fields
 *   actually present in the body are written; absent fields are left untouched.
 *
 *   Body (all optional):
 *     restaurantName?: string          1..60 chars
 *     tagline?: string                 <=120 chars
 *     logoDataUri?: string             data:image/... -> uploaded to Cloudinary
 *     logoUrl?: string | null          keep a URL, or null to clear the logo
 *     phone?: string                   <=30 chars
 *     email?: string                   <=120 chars, lowercased
 *     address?: string                 <=300 chars
 *     currencySymbol?: string          <=4 chars
 *     taxRate?: number                 0..100
 *     serviceChargeRate?: number       0..100
 *     hours?: Partial<Record<DayKey, {open,close}>>   HH:MM, '' = closed
 *     paymentMethods?: {cash,upi,card} booleans
 *     upiId?: string                   <=60 chars
 *     googleReviewUrl?: string         <=500 chars
 *     websiteUrl?: string              <=500 chars
 *     instagramUrl?: string            <=500 chars
 *     facebookUrl?: string             <=500 chars
 */
export async function PUT(req: NextRequest) {
  const session = await getSession('admin');
  if (!session) return unauthorized('Your session has expired — please sign in again');
  if (session.role !== 'admin') return forbidden('Only an admin can change site settings');

  const body = await req.json() || {};
  const errors: string[] = [];
  const update: Record<string, unknown> = {};

  // --- Brand ---
  if (body.restaurantName !== undefined) {
    const v = boundedStr(body.restaurantName, 60, 'Restaurant name', errors);
    if (v !== undefined) {
      if (!v) errors.push('Restaurant name cannot be empty');
      else update.restaurantName = v;
    }
  }
  if (body.tagline !== undefined) update.tagline = boundedStr(body.tagline, 120, 'Tagline', errors) ?? '';
  if (body.logoDataUri !== undefined && body.logoDataUri !== null && body.logoDataUri !== '') {
    if (typeof body.logoDataUri !== 'string' || !body.logoDataUri.startsWith('data:image')) {
      errors.push('Logo must be a valid data:image/... data URI');
    } else {
      try {
        update.logoUrl = await uploadImage(body.logoDataUri, 'restaurant/brand');
      } catch (e) {
        errors.push(e instanceof Error ? e.message : 'Logo upload failed');
      }
    }
  } else if (body.logoUrl === null) {
    update.logoUrl = null;
  } else if (typeof body.logoUrl === 'string' && body.logoUrl.trim()) {
    update.logoUrl = body.logoUrl.trim();
  }

  // --- Contact ---
  if (body.phone !== undefined) update.phone = boundedStr(body.phone, 30, 'Phone', errors) ?? '';
  if (body.email !== undefined) {
    const v = boundedStr(body.email, 120, 'Email', errors);
    update.email = v ? v.toLowerCase() : '';
  }
  if (body.address !== undefined) update.address = boundedStr(body.address, 300, 'Address', errors) ?? '';

  // --- Billing policy ---
  if (body.currencySymbol !== undefined) {
    const v = boundedStr(body.currencySymbol, 4, 'Currency symbol', errors);
    if (v !== undefined) {
      if (!v) errors.push('Currency symbol cannot be empty');
      else update.currencySymbol = v;
    }
  }
  if (body.taxRate !== undefined) {
    const n = num(body.taxRate);
    if (n === undefined || n < 0 || n > 100) errors.push('Tax rate must be a number 0–100');
    else update.taxRate = n;
  }
  if (body.serviceChargeRate !== undefined) {
    const n = num(body.serviceChargeRate);
    if (n === undefined || n < 0 || n > 100) errors.push('Service charge must be a number 0–100');
    else update.serviceChargeRate = n;
  }

  // --- Operating hours ---
  if (body.hours !== undefined && typeof body.hours === 'object') {
    const hoursUpdate: Record<string, { open: string; close: string }> = {};
    for (const d of DAYS) {
      const day = (body.hours as Record<string, { open?: string; close?: string }>)[d];
      if (!day) continue;
      const open = typeof day.open === 'string' ? day.open.trim() : '';
      const close = typeof day.close === 'string' ? day.close.trim() : '';
      // '' means closed (allowed); otherwise must be valid HH:MM.
      if (open && !HHMM.test(open)) errors.push(`${d} opening time must be HH:MM`);
      if (close && !HHMM.test(close)) errors.push(`${d} closing time must be HH:MM`);
      hoursUpdate[d] = { open, close };
    }
    if (Object.keys(hoursUpdate).length) update.hours = hoursUpdate;
  }

  // --- Payment methods ---
  if (body.paymentMethods !== undefined && typeof body.paymentMethods === 'object') {
    const pm = body.paymentMethods as { cash?: unknown; upi?: unknown; card?: unknown };
    const atLeastOne = Boolean(pm.cash) || Boolean(pm.upi) || Boolean(pm.card);
    if (!atLeastOne) errors.push('Enable at least one payment method');
    else update.paymentMethods = {
      cash: Boolean(pm.cash),
      upi: Boolean(pm.upi),
      card: Boolean(pm.card),
    };
  }
  if (body.upiId !== undefined) update.upiId = boundedStr(body.upiId, 60, 'UPI ID', errors) ?? '';

  // --- External links ---
  if (body.googleReviewUrl !== undefined) update.googleReviewUrl = boundedStr(body.googleReviewUrl, 500, 'Google review URL', errors) ?? '';
  if (body.websiteUrl !== undefined) update.websiteUrl = boundedStr(body.websiteUrl, 500, 'Website URL', errors) ?? '';
  if (body.instagramUrl !== undefined) update.instagramUrl = boundedStr(body.instagramUrl, 500, 'Instagram URL', errors) ?? '';
  if (body.facebookUrl !== undefined) update.facebookUrl = boundedStr(body.facebookUrl, 500, 'Facebook URL', errors) ?? '';

  if (errors.length) return fail(errors.join(' · '), 422);
  if (!Object.keys(update).length) return fail('No settings fields to update', 422);

  await dbConnect();
  const doc = (await Settings.findOneAndUpdate(
    { singleton: true },
    { $set: { ...update, singleton: true } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean()) as Record<string, unknown> | null;

  invalidateSettingsCache();

  // Return the freshly-normalized full settings (re-reads cache-cleared value).
  const result = await getSettings();
  void doc;
  return ok(result);
}
