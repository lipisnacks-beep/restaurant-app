import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import User from '@/models/User';
import { signToken, setSessionCookie, getSession } from '@/lib/auth';
import { fail, unauthorized } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  await dbConnect();
  const { email, password } = await req.json();
  if (!email || !password) return fail('Email and password are required', 422);

  const user = await User.findOne({ email: String(email).toLowerCase() }).select('+password');
  if (!user || !user.active) return unauthorized('Invalid credentials');

  const match = await user.comparePassword(password);
  if (!match) return unauthorized('Invalid credentials');

  const token = signToken({
    userId: String(user._id),
    role: user.role,
    name: user.name,
    email: user.email,
  });

  const res = NextResponse.json({ user: { id: user._id, name: user.name, email: user.email, role: user.role } }, { status: 200 });
  setSessionCookie(res, token);
  return res;
}

export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized('Not logged in');
  return NextResponse.json({ user: session });
}
