import jwt from 'jsonwebtoken';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { Types } from 'mongoose';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export type Role = 'admin' | 'chef' | 'staff';

/**
 * Each portal gets its own session cookie so a chef and a staff member (and an
 * admin) can all be signed in at the same time on the same browser without one
 * login overwriting the other.
 *
 *   admin -> rms_admin_session   (role: admin)
 *   chef  -> rms_chef_session    (role: chef, or admin acting as chef)
 *   staff -> rms_staff_session   (role: staff, or admin acting as staff)
 *
 * `any` resolves whichever scoped cookie is present (used by shared API routes
 * that accept any authenticated staff member), and also falls back to the
 * legacy shared `rms_session` cookie so already-issued tokens keep working
 * until those users re-sign-in.
 */
export type SessionScope = 'admin' | 'chef' | 'staff' | 'any';

const SCOPE_COOKIE: Record<Exclude<SessionScope, 'any'>, string> = {
  admin: 'rms_admin_session',
  chef: 'rms_chef_session',
  staff: 'rms_staff_session',
};

/** Legacy shared cookie (pre-scoped auth). Still read as a fallback. */
export const SESSION_COOKIE_NAME = 'rms_session';

export interface SessionPayload {
  userId: string;
  role: Role;
  name: string;
  email: string;
  scope?: SessionScope; // present on newly-issued tokens
}

export function signToken(payload: SessionPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as SessionPayload;
  } catch {
    return null;
  }
}

function cookieNameForScope(scope: Exclude<SessionScope, 'any'>): string {
  return SCOPE_COOKIE[scope];
}

/** Does this role belong to this portal's scope? (admin can act as chef/staff.) */
function roleMatchesScope(role: Role, scope: Exclude<SessionScope, 'any'>): boolean {
  if (scope === 'admin') return role === 'admin';
  if (scope === 'chef') return role === 'chef' || role === 'admin';
  if (scope === 'staff') return role === 'staff' || role === 'admin';
  return false;
}

/**
 * Server-side: read the session from the cookie for a specific scope.
 *
 * - `scope='any'`: returns the first valid session found across all scoped
 *   cookies, falling back to the legacy shared cookie.
 * - `scope='admin'|'chef'|'staff'`: returns the session from that portal's
 *   cookie; if absent, accepts the legacy `rms_session` cookie only when its
 *   role matches the scope (so a stale shared cookie can't grant the wrong
 *   portal access).
 */
export async function getSession(scope: SessionScope = 'any'): Promise<SessionPayload | null> {
  const store = await cookies();

  if (scope === 'any') {
    for (const name of Object.values(SCOPE_COOKIE)) {
      const token = store.get(name)?.value;
      if (token) {
        const s = verifyToken(token);
        if (s) return s;
      }
    }
    const legacy = store.get(SESSION_COOKIE_NAME)?.value;
    return legacy ? verifyToken(legacy) : null;
  }

  const token = store.get(cookieNameForScope(scope))?.value;
  if (token) return verifyToken(token);

  const legacy = store.get(SESSION_COOKIE_NAME)?.value;
  if (legacy) {
    const s = verifyToken(legacy);
    if (s && roleMatchesScope(s.role, scope)) return s;
  }
  return null;
}

/** Server-side: set the scoped session cookie on a response (login). */
export function setSessionCookie(
  res: NextResponse,
  token: string,
  scope: Exclude<SessionScope, 'any'>,
): void {
  res.cookies.set(cookieNameForScope(scope), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
}

/** Server-side: clear the scoped session cookie (logout). */
export function clearSessionCookie(res: NextResponse, scope: Exclude<SessionScope, 'any'>): void {
  res.cookies.set(cookieNameForScope(scope), '', { path: '/', maxAge: 0 });
}

/**
 * Read a bearer token from a NextRequest (used by API routes as a fallback when
 * the next/headers `cookies()` API doesn't expose the cookie in some Vercel
 * serverless invocations). Checks the Authorization header, then the scoped
 * cookie (or every scoped cookie + the legacy cookie when scope='any').
 */
export function getTokenFromRequest(req: NextRequest, scope: SessionScope = 'any'): string | undefined {
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  if (scope === 'any') {
    for (const name of Object.values(SCOPE_COOKIE)) {
      const v = req.cookies.get(name)?.value;
      if (v) return v;
    }
    return req.cookies.get(SESSION_COOKIE_NAME)?.value;
  }

  const scoped = req.cookies.get(cookieNameForScope(scope))?.value;
  if (scoped) return scoped;
  return req.cookies.get(SESSION_COOKIE_NAME)?.value;
}

/**
 * Resolve a session from a request, trying the next/headers `cookies()` API
 * first, then reading the cookie directly off the request. Validates the role
 * matches the scope when a specific scope is requested.
 */
export async function resolveSession(
  req: NextRequest,
  scope: SessionScope = 'any',
): Promise<SessionPayload | null> {
  const direct = await getSession(scope);
  if (direct) return direct;
  const token = getTokenFromRequest(req, scope);
  if (token) {
    const s = verifyToken(token);
    if (s && (scope === 'any' || roleMatchesScope(s.role, scope))) return s;
  }
  return null;
}

export function toObjectId(id: string): Types.ObjectId {
  return new Types.ObjectId(id);
}

/* ------------------------------------------------------------------ *
 * Customer dining session (a totally separate, lightweight cookie so *
 * a diner's session never collides with staff/chef/admin sessions). *
 * ------------------------------------------------------------------ */

/** Cookie name holding the customer's dining-session id (opaque token). */
export const CUSTOMER_SESSION_COOKIE = 'rms_customer_session';
const CUSTOMER_COOKIE_MAX_AGE = 60 * 60 * 8; // 8h — covers any reasonable meal

export interface CustomerCookiePayload {
  sessionId: string;
  customerId: string;
  tableNumber: number;
}

/** Server-side: set the customer dining-session cookie on a response. */
export function setCustomerSessionCookie(res: NextResponse, sessionId: string): void {
  res.cookies.set(CUSTOMER_SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: CUSTOMER_COOKIE_MAX_AGE,
  });
}

/** Server-side: read the customer dining-session id from the cookie. */
export async function getCustomerSessionId(): Promise<string | null> {
  const store = await cookies();
  return store.get(CUSTOMER_SESSION_COOKIE)?.value || null;
}

/** Read the customer session id directly off a NextRequest (fallback). */
export function getCustomerSessionIdFromRequest(req: NextRequest): string | undefined {
  return req.cookies.get(CUSTOMER_SESSION_COOKIE)?.value;
}

/** Resolve the customer session id, trying next/headers then the request. */
export async function resolveCustomerSessionId(req: NextRequest): Promise<string | null> {
  const direct = await getCustomerSessionId();
  if (direct) return direct;
  return getCustomerSessionIdFromRequest(req) || null;
}

/** Server-side: clear the customer dining-session cookie (end of meal). */
export function clearCustomerSessionCookie(res: NextResponse): void {
  res.cookies.set(CUSTOMER_SESSION_COOKIE, '', { path: '/', maxAge: 0 });
}

/** Generate an opaque, URL-safe session token for a dining session. */
export function generateCustomerSessionId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `cs-${time}-${random}`;
}
