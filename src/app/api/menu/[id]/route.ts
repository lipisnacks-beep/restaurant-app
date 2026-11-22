import { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import MenuItem from '@/models/MenuItem';
import { getSession } from '@/lib/auth';
import { ok, fail, unauthorized, forbidden } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// PATCH /api/menu/[id]  -> admin updates a menu item
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== 'admin') return forbidden();

  await dbConnect();
  const body = await req.json();
  const update: Record<string, unknown> = {};
  for (const k of ['name', 'description', 'category', 'image']) {
    if (typeof body[k] === 'string') update[k] = body[k];
  }
  for (const k of ['price', 'prepTime']) {
    if (typeof body[k] === 'number') update[k] = body[k];
  }
  for (const k of ['available', 'veg']) {
    if (typeof body[k] === 'boolean') update[k] = body[k];
  }

  const item = await MenuItem.findByIdAndUpdate(params.id, { $set: update }, { new: true });
  if (!item) return fail('Menu item not found', 404);
  return ok({ item });
}

// DELETE /api/menu/[id]  -> admin deletes a menu item
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== 'admin') return forbidden();

  await dbConnect();
  const item = await MenuItem.findByIdAndDelete(params.id);
  if (!item) return fail('Menu item not found', 404);
  return ok({ deleted: true });
}
