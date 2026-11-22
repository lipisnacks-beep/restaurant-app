import { NextRequest, NextResponse } from 'next/server';
import { clearSessionCookie, type SessionScope } from '@/lib/auth';
import { fail } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/logout
 * body: { scope: 'admin' | 'chef' | 'staff' }  (optional)
 *
 * Clears only the requested portal's session cookie, so logging out of the
 * chef panel does not also log the user out of the staff panel. When no scope
 * is given, clears all portal cookies (legacy behaviour).
 */
export async function POST(req: NextRequest) {
  let scope: SessionScope | undefined;
  try {
    const body = await req.json();
    scope = body?.scope;
  } catch {
    /* no body is fine */
  }

  const res = NextResponse.json({ ok: true }, { status: 200 });
  if (scope && scope !== 'any') {
    clearSessionCookie(res, scope as Exclude<SessionScope, 'any'>);
  } else {
    clearSessionCookie(res, 'admin');
    clearSessionCookie(res, 'chef');
    clearSessionCookie(res, 'staff');
  }
  return res;
}

export async function GET() {
  const res = NextResponse.json({ ok: true }, { status: 200 });
  clearSessionCookie(res, 'admin');
  clearSessionCookie(res, 'chef');
  clearSessionCookie(res, 'staff');
  return res;
}
