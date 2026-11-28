/**
 * GET /api/invoice/[sessionId]/pdf?t=<token>
 *
 * Streams the session's invoice PDF (rendered in memory with pdf-lib). This
 * public, token-gated URL doubles as the media source the WhatsApp Cloud API
 * fetches when it delivers the invoice as a document message.
 *
 * Token scheme: sha256(sessionId + JWT_SECRET) truncated — unguessable yet
 * requires no extra storage; the same scheme protects the invoice web page.
 */
import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import { buildInvoicePdf, loadSessionInvoice, verifyInvoiceToken } from '@/lib/invoice';
import { serverError, fail } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: { sessionId: string } }) {
  try {
    const token = req.nextUrl.searchParams.get('t') || '';
    const sessionId = params.sessionId;
    if (!sessionId || !verifyInvoiceToken(sessionId, token)) {
      return fail('Invalid invoice link', 403);
    }
    await dbConnect();
    const data = await loadSessionInvoice(sessionId);
    if (!data) return fail('No paid orders found for this session', 404);

    const bytes = await buildInvoicePdf(data);
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        // inline so both browsers (preview) and the WhatsApp Cloud API
        // (document fetch) accept it without a download hop
        'Content-Disposition': `inline; filename="${data.invoiceNo}.pdf"`,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (err) {
    return serverError(err);
  }
}
