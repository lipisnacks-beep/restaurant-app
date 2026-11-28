/**
 * WhatsApp Cloud API webhook — GET verification + POST inbound messages.
 *
 * The FREE delivery flow: when a customer sends ANY message to the business
 * WhatsApp number (e.g. via the one-tap button on the payment screen), Meta
 * opens a free 24h customer service window and calls this webhook. We match
 * the sender's mobile number to their latest fully-paid dining session and
 * deliver the invoice PDF as a free-form document message — never a paid
 * template.
 *
 * Setup (see docs/WHATSAPP_INVOICE_SETUP.md):
 *   Callback URL:  https://<your-domain>/api/whatsapp/webhook
 *   Verify token:  value of WHATSAPP_VERIFY_TOKEN
 *   Subscribe to the "messages" field.
 */
import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import Order from '@/models/Order';
import CustomerSession from '@/models/CustomerSession';
import { deliverSessionInvoice, normalizeIndianMobile } from '@/lib/whatsapp';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface InboundMessage {
  from?: string;
  id?: string;
  type?: string;
  text?: { body?: string };
}

interface WebhookBody {
  entry?: {
    changes?: {
      value?: {
        messages?: InboundMessage[];
        statuses?: unknown[];
      };
    }[];
  }[];
}

/** Meta webhook verification handshake (hub.challenge echo). */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const mode = sp.get('hub.mode');
  const token = sp.get('hub.verify_token');
  const challenge = sp.get('hub.challenge') || '';
  if (mode === 'subscribe' && token && token === (process.env.WHATSAPP_VERIFY_TOKEN || '')) {
    return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
  return new NextResponse('Forbidden', { status: 403 });
}

/** Always 200 quickly — Meta retries non-200s aggressively. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as WebhookBody;
    const messages: InboundMessage[] = [];
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.value?.messages?.length) messages.push(...change.value.messages);
      }
    }

    for (const msg of messages) {
      if (!msg.from) continue;
      const mobile = normalizeIndianMobile(msg.from);
      if (mobile.length < 10) continue;
      try {
        await dbConnect();
        // Latest fully-paid session for this mobile whose invoice was not
        // delivered yet. deliverSessionInvoice is idempotent ('sent' is
        // final), so duplicate webhook deliveries are harmless.
        const candidates = await CustomerSession.find({
          status: { $in: ['paid', 'completed', 'closed'] },
        })
          .sort({ updatedAt: -1 })
          .limit(50)
          .lean();
        const match = candidates.find(
          (s) =>
            normalizeIndianMobile((s as { mobile?: string }).mobile || '') === mobile &&
            (s as unknown as { invoiceDelivery?: { status?: string } }).invoiceDelivery?.status !== 'sent',
        );
        if (!match) continue;
        const unpaid = await Order.countDocuments({ sessionId: match.sessionId, paymentStatus: 'unpaid' });
        if (unpaid > 0) continue; // only deliver when the whole session is settled
        await deliverSessionInvoice(match.sessionId);
      } catch (err) {
        console.error('[whatsapp-webhook] delivery failed:', err);
      }
    }
    return NextResponse.json({ received: true });
  } catch {
    // Even malformed payloads must 200 (Meta retries errors).
    return NextResponse.json({ received: true });
  }
}
