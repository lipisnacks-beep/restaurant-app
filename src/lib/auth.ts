import jwt from 'jsonwebtoken';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { Types } from 'mongoose';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret';
const COOKIE_NAME = 'rms_session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export type Role = 'admin' | 'chef' | 'staff';

export interface SessionPayload {
  userId: string;
  role: Role;
  name: string;
  email: string;
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

/** Server-side: read the session from the cookie. */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyToken(token);
}

/** Server-side: set the session cookie on a response (login). */
export function setSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
}

/** Server-side: clear the session cookie (logout). */
export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(COOKIE_NAME, '', { path: '/', maxAge: 0 });
}

/** Read a bearer token from a NextRequest (used by API routes). */
export function getTokenFromRequest(req: NextRequest): string | undefined {
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return req.cookies.get(COOKIE_NAME)?.value;
}

/** For client-side fetch helpers: read the cookie in the browser. */
export const SESSION_COOKIE_NAME = COOKIE_NAME;

export function toObjectId(id: string): Types.ObjectId {
  return new Types.ObjectId(id);
}
