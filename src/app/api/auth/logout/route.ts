import { NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST() {
  const res = NextResponse.json({ ok: true }, { status: 200 });
  clearSessionCookie(res);
  return res;
}

export async function GET() {
  const res = NextResponse.json({ ok: true }, { status: 200 });
  clearSessionCookie(res);
  return res;
}
