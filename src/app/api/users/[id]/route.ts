import { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import User from '@/models/User';
import { getSession } from '@/lib/auth';
import { ok, fail, unauthorized, forbidden } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// PATCH /api/users/[id]  -> admin updates name/phone/active/reset password
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== 'admin') return forbidden();

  await dbConnect();
  const body = await req.json();
  const update: Record<string, unknown> = {};
  if (typeof body.name === 'string') update.name = body.name;
  if (typeof body.phone === 'string') update.phone = body.phone;
  if (typeof body.active === 'boolean') update.active = body.active;
  if (typeof body.password === 'string' && body.password.length >= 6) {
    update.password = body.password; // pre-save hook hashes it
  }

  const user = await User.findByIdAndUpdate(params.id, { $set: update }, { new: true });
  if (!user) return fail('User not found', 404);
  return ok({ user });
}

// DELETE /api/users/[id]  -> admin deletes an account
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== 'admin') return forbidden();

  if (session.userId === params.id) return fail('You cannot delete your own account', 422);

  await dbConnect();
  const user = await User.findByIdAndDelete(params.id);
  if (!user) return fail('User not found', 404);
  return ok({ deleted: true });
}
