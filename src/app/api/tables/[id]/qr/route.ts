import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import dbConnect from '@/lib/db';
import Table from '@/models/Table';
import { buildTableQrUrl } from '@/lib/publicUrl';
import { serverError } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * GET /api/tables/[id]/qr?size=300
 * Returns a PNG image of the QR code that points to the customer menu page
 * for this specific table. The PNG can be embedded in an <img> tag and printed.
 *
 * Uses buildTableQrUrl, which THROWS in production if NEXT_PUBLIC_BASE_URL is
 * missing or still localhost — so a misconfigured deploy fails loudly with a
 * clear 503 instead of silently printing QRs that point to localhost.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await dbConnect();
    const table = await Table.findById(params.id).lean() as { number: number } | null;
    if (!table) return new Response('Table not found', { status: 404 });

    const targetUrl = buildTableQrUrl(table.number);
    const size = Number(new URL(req.url).searchParams.get('size') || '300');

    const png = await QRCode.toBuffer(targetUrl, {
      type: 'png',
      margin: 2,
      width: size,
      color: { dark: '#1f2937', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    });

    return new Response(png, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    // serverError returns JSON; for an image endpoint return a plain 503 so
    // the <img> fails clearly while the API logs the actionable message.
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error('[qr] error:', msg);
    return new NextResponse(`QR generation failed: ${msg}`, { status: 503 });
  }
}
