import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import User from '@/models/User';
import { resolveSessionForRoles, signToken, setSessionCookie } from '@/lib/auth';
import { ok, fail, unauthorized, forbidden } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * Staff self-service account endpoints.
 *
 * GET  /api/staff/account         -> returns the signed-in staff's profile
 * PATCH /api/staff/account        -> updates name/phone and/or changes password
 *
 * Authentication: the caller must hold a staff-scoped session (resolved via
 * the per-tab Bearer token, falling back to the staff cookie — same mechanism
 * as the chef account route). This lets multiple staff be signed in at once,
 * each managing their own account. Email and role are NOT editable here:
 * email change would silently invalidate the JWT `email` claim, and role
 * changes are admin-only via /api/users/[id]. Restricting to name / phone /
 * password keeps each staff member's identity stable and auditable.
 */

/** Minimal public profile shape returned to the client. */
function profile(u: any) {
  return {
    id: String(u._id),
    name: u.name,
    email: u.email,
    phone: u.phone || '',
    role: u.role,
    active: u.active,
    createdAt: u.createdAt,
  };
}

export async function GET(req: NextRequest) {
  const session = await resolveSessionForRoles(req, ['admin', 'staff'], 'staff');
  if (!session) return unauthorized('Your session has expired — please sign in again');

  await dbConnect();
  const user = await User.findById(session.userId);
  if (!user) return fail('Account not found', 404);
  if (user.role !== 'staff') return forbidden('This account is not a staff account');
  return ok({ user: profile(user) });
}

export async function PATCH(req: NextRequest) {
  const session = await resolveSessionForRoles(req, ['admin', 'staff'], 'staff');
  if (!session) return unauthorized('Your session has expired — please sign in again');

  await dbConnect();
  const user = await User.findById(session.userId).select('+password');
  if (!user) return fail('Account not found', 404);
  if (user.role !== 'staff') return forbidden('This account is not a staff account');

  const body = await req.json().catch(() => ({}));
  const { name, phone, currentPassword, newPassword } = body || {};

  const update: Record<string, unknown> = {};
  const responseExtras: Record<string, unknown> = {};

  // --- Profile fields (name, phone) ---
  if (typeof name === 'string') {
    const trimmed = name.trim();
    if (trimmed.length === 0) return fail('Name cannot be empty', 422);
    if (trimmed.length > 60) return fail('Name is too long (max 60 characters)', 422);
    if (trimmed !== user.name) update.name = trimmed;
  }
  if (typeof phone === 'string') {
    const trimmed = phone.trim();
    // Optional field; allow empty. Validate basic shape when provided.
    if (trimmed && !/^[0-9 +\-()]{7,20}$/.test(trimmed)) {
      return fail('Phone number looks invalid (use digits, spaces, +, -, parentheses)', 422);
    }
    if (trimmed !== (user.phone || '')) update.phone = trimmed;
  }

  // --- Password change (requires current password verification) ---
  if (typeof newPassword === 'string' && newPassword.length > 0) {
    if (newPassword.length < 6) return fail('New password must be at least 6 characters', 422);
    if (!currentPassword) return fail('Current password is required to change your password', 422);

    const match = await user.comparePassword(String(currentPassword));
    if (!match) return fail('Current password is incorrect', 422);
    if (newPassword === currentPassword) {
      return fail('New password must be different from the current password', 422);
    }
    update.password = newPassword; // the pre-save hook hashes it
    responseExtras.passwordChanged = true;
  }

  // Apply updates if any.
  if (Object.keys(update).length === 0) {
    return ok({ user: profile(user), ...responseExtras, noop: true });
  }

  // Assign fields and save (so pre-save hash + validation hooks run).
  Object.assign(user, update);
  await user.save();
  await user.reload?.();

  // If the name changed, the JWT `name` claim is now stale. Re-issue the
  // staff-scoped session token so the portal header reflects the new name
  // without forcing a re-login. (Email is immutable here, so the token's
  // other claims stay valid.)
  let res: NextResponse;
  if (update.name) {
    const token = signToken({
      userId: String(user._id),
      role: user.role,
      name: user.name,
      email: user.email,
      scope: 'staff',
    });
    res = NextResponse.json(
      { user: profile(user), ...responseExtras, tokenReissued: true, token },
      { status: 200, headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
    setSessionCookie(res, token, 'staff');
  } else {
    res = NextResponse.json(
      { user: profile(user), ...responseExtras },
      { status: 200, headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  }
  return res;
}
