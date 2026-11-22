import { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import User from '@/models/User';
import { getSession } from '@/lib/auth';
import { ok, fail, unauthorized, forbidden } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// GET /api/users  -> admin lists staff/chef accounts
export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== 'admin') return forbidden();

  await dbConnect();
  const users = await User.find().sort({ role: 1, name: 1 }).lean();
  return ok({ users });
}

// POST /api/users  -> admin creates a new chef/staff/admin account
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== 'admin') return forbidden();

  await dbConnect();
  const body = await req.json();
  const { name, email, password, role, phone } = body || {};
  if (!name || !email || !password || !role) {
    return fail('name, email, password and role are required', 422);
  }
  if (!['admin', 'chef', 'staff'].includes(role)) {
    return fail('role must be admin, chef or staff', 422);
  }
  if (password.length < 6) return fail('password must be at least 6 characters', 422);

  const exists = await User.findOne({ email: String(email).toLowerCase() });
  if (exists) return fail('Email already in use', 409);

  const user = await User.create({
    name,
    email,
    password,
    role,
    phone: phone || '',
    active: true,
  });
  return ok({ user }, { status: 201 });
}
