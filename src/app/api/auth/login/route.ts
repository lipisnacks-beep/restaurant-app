import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import User from '@/models/User';
import { signToken, setSessionCookie, getSession, type SessionScope } from '@/lib/auth';
import { fail, unauthorized } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const VALID_SCOPES: Exclude<SessionScope, 'any'>[] = ['admin', 'chef', 'staff'];

/**
 * POST /api/auth/login
 * body: { email, password, scope: 'admin' | 'chef' | 'staff' }
 *
 * Each portal logs in under its own scope so the cookie is written to that
 * portal's dedicated name (rms_admin_session / rms_chef_session /
 * rms_staff_session). That lets a chef and a staff member be signed in at the
 * same time on the same browser without one login clobbering the other.
 */
export async function POST(req: NextRequest) {
  await dbConnect();
  const { email, password, scope = 'any' } = await req.json();
  if (!email || !password) return fail('Email and password are required', 422);

  // The login scope determines which cookie we write. If the caller omits it
  // (e.g. an older client), default by the user's role.
  let resolvedScope: Exclude<SessionScope, 'any'>;
  if (scope === 'any' || !VALID_SCOPES.includes(scope as any)) {
    // Will be set after we load the user.
    resolvedScope = 'admin'; // placeholder; overwritten below
  } else {
    resolvedScope = scope as Exclude<SessionScope, 'any'>;
  }

  const user = await User.findOne({ email: String(email).toLowerCase() }).select('+password');
  if (!user || !user.active) return unauthorized('Invalid credentials');

  const match = await user.comparePassword(password);
  if (!match) return unauthorized('Invalid credentials');

  if (scope === 'any' || !VALID_SCOPES.includes(scope as any)) {
    resolvedScope = user.role as Exclude<SessionScope, 'any'>;
  }

  const token = signToken({
    userId: String(user._id),
    role: user.role,
    name: user.name,
    email: user.email,
    scope: resolvedScope,
  });

  const res = NextResponse.json(
    { user: { id: user._id, name: user.name, email: user.email, role: user.role } },
    { status: 200 },
  );
  setSessionCookie(res, token, resolvedScope);
  return res;
}

export async function GET() {
  const session = await getSession('any');
  if (!session) return unauthorized('Not logged in');
  return NextResponse.json({ user: session });
}
