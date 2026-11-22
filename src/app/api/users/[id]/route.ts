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

  // Load the document and use .save() so the pre-save hash hook fires when
  // the password is changed. findByIdAndUpdate bypasses mongoose middleware,
  // which would store the password in plaintext and break all logins.
  const user = await User.findById(params.id);
  if (!user) return fail('User not found', 404);

  if (typeof body.name === 'string') {
    const trimmed = body.name.trim();
    if (trimmed.length === 0) return fail('Name cannot be empty', 422);
    user.name = trimmed;
  }
  if (typeof body.phone === 'string') user.phone = body.phone.trim();
  if (typeof body.active === 'boolean') user.active = body.active;
  if (typeof body.password === 'string' && body.password.length >= 6) {
    user.password = body.password; // pre-save hook hashes it on .save()
  } else if (typeof body.password === 'string' && body.password.length > 0 && body.password.length < 6) {
    return fail('Password must be at least 6 characters', 422);
  }

  await user.save();
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
