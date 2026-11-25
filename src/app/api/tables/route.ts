import { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import Table from '@/models/Table';
import CustomerSession from '@/models/CustomerSession';
import { getSession } from '@/lib/auth';
import { ok, fail, unauthorized, forbidden, serverError } from '@/lib/utils';
import { buildTableQrUrl } from '@/lib/publicUrl';

export const dynamic = 'force-dynamic';

// GET /api/tables  -> list all tables (public-ish; customer needs table info too)
export async function GET(req: NextRequest) {
  try {
    await dbConnect();
    const { searchParams } = new URL(req.url);
    const onlyActive = searchParams.get('active') === 'true';

    const filter: Record<string, unknown> = {};
    if (onlyActive) filter.active = true;

    const tables = await Table.find(filter).sort({ number: 1 }).lean();

    // Join the LIVE CustomerSession.status for occupied tables so the badge
    // reflects the source of truth, not the denormalized table.currentSession
    // snapshot (which can drift if the session is updated out of band).
    const occupiedSessionIds = tables
      .map((t: any) => t.currentSession?.sessionId)
      .filter(Boolean) as string[];
    const liveSessions = occupiedSessionIds.length
      ? await CustomerSession.find({ sessionId: { $in: occupiedSessionIds } })
          .select('sessionId status')
          .lean()
      : [];
    const liveStatusBySession = new Map(liveSessions.map((s: any) => [s.sessionId, s.status]));

    const withQr = tables.map((t: any) => {
      const cs = t.currentSession;
      const liveStatus = cs?.sessionId ? liveStatusBySession.get(cs.sessionId) : undefined;
      return {
        ...t,
        qrUrl: buildTableQrUrl(t.number),
        currentSession: cs
          ? { ...cs, sessionStatus: liveStatus ?? cs.sessionStatus ?? 'active' }
          : undefined,
      };
    });
    return ok({ tables: withQr });
  } catch (err) {
    return serverError(err);
  }
}

// POST /api/tables  -> admin adds a table (auto number) or by explicit number
export async function POST(req: NextRequest) {
  try {
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

    return ok({
      table: { ...table.toObject(), qrUrl: buildTableQrUrl(table.number) },
    });
  } catch (err) {
    return serverError(err);
  }
}
