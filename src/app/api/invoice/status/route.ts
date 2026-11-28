/**
 * GET /api/invoice/status?sessionId=…
 *
 * Powers the customer thank-you screen's invoice card: WhatsApp delivery
 * state + ready-made links (view page, PDF, one-tap opt-in to the business
 * number, self-save fallback). All WhatsApp delivery is free of charge —
 * see src/lib/whatsapp.ts for the free-only policy.
 */
import { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import CustomerSession from '@/models/CustomerSession';
import { getSettings } from '@/lib/settings';
import { buildInvoiceCaption, invoicePageUrl, invoicePdfUrl, loadSessionInvoice } from '@/lib/invoice';
import { isWhatsAppConfigured, normalizeIndianMobile, waBusinessNumber } from '@/lib/whatsapp';
import { ok, fail, serverError } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sessionId = req.nextUrl.searchParams.get('sessionId') || '';
    if (!sessionId) return fail('sessionId is required', 422);
    await dbConnect();
    const session = await CustomerSession.findOne({ sessionId });
    if (!session) return fail('Session not found', 404);

    const settings = await getSettings();
    const configured = isWhatsAppConfigured();
    const delivery = (session as unknown as { invoiceDelivery?: { status?: string; at?: Date; error?: string } }).invoiceDelivery;
    const pageUrl = invoicePageUrl(sessionId);
    const pdfUrl = invoicePdfUrl(sessionId);

    // One-tap opt-in: opens the customer's WhatsApp on the business number
    // with a pre-filled message. Sending it opens the free 24h service
    // window; the webhook then delivers the invoice automatically.
    let waOptinUrl: string | null = null;
    const business = waBusinessNumber();
    if (business) {
      const text = `Hi ${settings.restaurantName}! I just paid my bill at Table ${session.tableNumber}. Please send my invoice to this WhatsApp number.`;
      waOptinUrl = `https://wa.me/${business}?text=${encodeURIComponent(text)}`;
    }

    // Self-save fallback (when the Cloud API is not configured): opens a chat
    // with the customer's own number containing the bill summary + link.
    let waSelfUrl: string | null = null;
    const myMobile = normalizeIndianMobile(session.mobile || '');
    if (myMobile) {
      const data = await loadSessionInvoice(sessionId);
      if (data) {
        waSelfUrl = `https://wa.me/${myMobile}?text=${encodeURIComponent(buildInvoiceCaption(data, pageUrl))}`;
      }
    }

    return ok({
      configured,
      delivery: delivery || null,
      invoiceNo: null,
      tableNumber: session.tableNumber,
      invoicePageUrl: pageUrl,
      pdfUrl,
      waOptinUrl,
      waSelfUrl,
      restaurantName: settings.restaurantName,
    });
  } catch (err) {
    return serverError(err);
  }
}
