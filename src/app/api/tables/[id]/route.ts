import { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import Table from '@/models/Table';
import { getSession } from '@/lib/auth';
import { ok, fail, unauthorized, forbidden } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// PATCH /api/tables/[id]  -> update name/seats/active (admin)
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== 'admin') return forbidden();

  await dbConnect();
  const body = await req.json();
  const update: Record<string, unknown> = {};
  if (typeof body.name === 'string') update.name = body.name;
  if (typeof body.seats === 'number') update.seats = body.seats;
  if (typeof body.active === 'boolean') update.active = body.active;

  const table = await Table.findByIdAndUpdate(params.id, { $set: update }, { new: true });
  if (!table) return fail('Table not found', 404);

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || '';
  return ok({ table: { ...table.toObject(), qrUrl: `${baseUrl}/customer?table=${table.number}` } });
}

// DELETE /api/tables/[id]  -> remove a table (admin only)
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== 'admin') return forbidden();

  await dbConnect();
  const table = await Table.findByIdAndDelete(params.id);
  if (!table) return fail('Table not found', 404);
  return ok({ deleted: true, number: table.number });
}
