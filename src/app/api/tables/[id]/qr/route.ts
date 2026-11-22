import { NextRequest } from 'next/server';
import QRCode from 'qrcode';
import dbConnect from '@/lib/db';
import Table from '@/models/Table';

export const dynamic = 'force-dynamic';

/**
 * GET /api/tables/[id]/qr?size=300
 * Returns a PNG image of the QR code that points to the customer menu page
 * for this specific table. The PNG can be embedded in an <img> tag and printed.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  await dbConnect();
  const table = await Table.findById(params.id).lean() as { number: number } | null;
  if (!table) return new Response('Table not found', { status: 404 });

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || '';
  const targetUrl = `${baseUrl}/customer?table=${table.number}`;
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
}
