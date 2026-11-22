import { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import Table from '@/models/Table';
import { getSession } from '@/lib/auth';
import { ok, fail, unauthorized, forbidden } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// GET /api/tables  -> list all tables (public-ish; customer needs table info too)
export async function GET(req: NextRequest) {
  await dbConnect();
  const { searchParams } = new URL(req.url);
  const onlyActive = searchParams.get('active') === 'true';

  const filter: Record<string, unknown> = {};
  if (onlyActive) filter.active = true;

  const tables = await Table.find(filter).sort({ number: 1 }).lean();
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || '';
  const withQr = tables.map((t) => ({
    ...t,
    qrUrl: `${baseUrl}/customer?table=${t.number}`,
  }));
  return ok({ tables: withQr });
}

// POST /api/tables  -> admin adds a table (auto number) or by explicit number
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== 'admin') return forbidden();

  await dbConnect();
  const body = await req.json();
  const { number, name, seats } = body || {};

  let nextNumber: number;
  if (number) {
    const exists = await Table.findOne({ number: Number(number) });
    if (exists) return fail('A table with this number already exists', 409);
    nextNumber = Number(number);
  } else {
    const max = await Table.findOne().sort({ number: -1 }).select('number').lean() as { number: number } | null;
    nextNumber = max ? max.number + 1 : 1;
  }

  const table = await Table.create({
    number: nextNumber,
    name: name || `Table ${nextNumber}`,
    seats: seats ? Number(seats) : 4,
    active: true,
  });

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || '';
  return ok({
    table: { ...table.toObject(), qrUrl: `${baseUrl}/customer?table=${table.number}` },
  });
}
