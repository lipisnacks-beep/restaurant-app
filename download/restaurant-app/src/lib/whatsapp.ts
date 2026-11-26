/**
 * WhatsApp invoice delivery via the FREE Meta WhatsApp Cloud API — no paid
 * tools, no third-party gateway.
 *
 * Why Cloud API: it is the only official, free way to PUSH a message to a
 * customer's WhatsApp from a server. Free-form messages are free of charge
 * whenever they are delivered inside an open customer service window (i.e.
 * the customer messaged this business number at least once in the last 24h).
 * This module therefore uses a strict FREE-ONLY policy:
 *   - it NEVER sends paid template messages (no template is configured at
 *     all, so billing for utility templates can never apply);
 *   - after payment it attempts the free-form document send once;
 *   - if Meta rejects it with 131047 ("re-engagement" — no open service
 *     window), the session is flagged 'optin-needed' and the customer's
 *     payment screen shows a one-tap wa.me button whose pre-filled message
 *     opens the free window, after which the webhook delivers the invoice
 *     automatically — still free.
 *
 * WHATSAPP_API_BASE exists for local testing (point it at a mock Graph API).
 */
import CustomerSession from '@/models/CustomerSession';
import { buildInvoiceCaption, invoicePageUrl, invoiceToken, loadSessionInvoice } from '@/lib/invoice';
import { getPublicBaseUrl } from '@/lib/publicUrl';

export interface WhatsAppSendResult {
  ok: boolean;
  wamid?: string;
  errorKind?: 'optin-needed' | 'invalid-number' | 'http-error' | 'unknown';
  errorMsg?: string;
}

export function isWhatsAppConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_TOKEN?.trim() && process.env.WHATSAPP_PHONE_NUMBER_ID?.trim());
}

/** wa.me needs digits only with country code: "+91 98765 43210" -> "919876543210". */
export function normalizeIndianMobile(raw: string): string {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10 && /^[6-9]/.test(d)) d = `91${d}`;
  return d;
}

function apiBase(): string {
  return (process.env.WHATSAPP_API_BASE || 'https://graph.facebook.com').replace(/\/$/, '');
}

/** Business WhatsApp number used for the customer's one-tap opt-in link. */
export function waBusinessNumber(): string {
  const env = process.env.WHATSAPP_BUSINESS_NUMBER?.replace(/\D/g, '');
  return env || '';
}

/** Low-level Cloud API document send. Pure HTTP, serverless-safe. */
export async function sendWhatsAppDocument(
  toE164: string,
  documentUrl: string,
  filename: string,
  caption: string,
): Promise<WhatsAppSendResult> {
  const token = process.env.WHATSAPP_TOKEN?.trim();
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!token || !phoneId) return { ok: false, errorKind: 'http-error', errorMsg: 'WhatsApp not configured' };
  try {
    const res = await fetch(`${apiBase()}/v21.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: toE164,
        type: 'document',
        document: { link: documentUrl, filename, caption },
      }),
    });
    const payload = (await res.json().catch(() => ({}))) as {
      messages?: { id?: string }[];
      error?: { code?: number; message?: string; error_subcode?: number; error_data?: { details?: string } };
    };
    if (res.ok && payload.messages?.[0]?.id) {
      return { ok: true, wamid: payload.messages[0].id };
    }
    const code = payload.error?.code;
    const msg = payload.error?.message || payload.error?.error_data?.details || `HTTP ${res.status}`;
    let kind: WhatsAppSendResult['errorKind'] = 'unknown';
    if (code === 131047) kind = 'optin-needed';
    else if (code === 131026 || code === 131030 || code === 470) kind = 'invalid-number';
    return { ok: false, errorKind: kind, errorMsg: `${code ?? res.status}: ${msg}` };
  } catch (err) {
    return { ok: false, errorKind: 'http-error', errorMsg: err instanceof Error ? err.message : String(err) };
  }
}

export type InvoiceDeliveryStatus = 'sent' | 'optin-needed' | 'failed' | 'not-configured' | 'skipped-no-mobile';

interface DeliveryRecord {
  status: InvoiceDeliveryStatus;
  at: Date;
  error?: string;
  wamid?: string;
}

async function recordDelivery(sessionId: string, record: DeliveryRecord): Promise<void> {
  await CustomerSession.updateOne({ sessionId }, { $set: { invoiceDelivery: record } });
}

/**
 * Deliver the session invoice once. Idempotent: a session already marked
 * 'sent' is never re-sent (webhook retries can't spam the customer).
 * Returns the recorded status; never throws into the payment flow.
 */
export async function deliverSessionInvoice(sessionId: string): Promise<InvoiceDeliveryStatus> {
  const session = await CustomerSession.findOne({ sessionId });
  if (!session) return 'skipped-no-mobile';
  if ((session as unknown as { invoiceDelivery?: DeliveryRecord }).invoiceDelivery?.status === 'sent') {
    return 'sent'; // already delivered
  }
  const mobile = normalizeIndianMobile(session.mobile || '');
  if (!mobile || mobile.length < 10) {
    await recordDelivery(sessionId, { status: 'skipped-no-mobile', at: new Date(), error: 'no/invalid mobile on session' });
    return 'skipped-no-mobile';
  }
  if (!isWhatsAppConfigured()) {
    await recordDelivery(sessionId, { status: 'not-configured', at: new Date(), error: 'WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID not set' });
    return 'not-configured';
  }

  const data = await loadSessionInvoice(sessionId);
  if (!data) {
    await recordDelivery(sessionId, { status: 'skipped-no-mobile', at: new Date(), error: 'no paid orders for session' });
    return 'skipped-no-mobile';
  }

  const caption = buildInvoiceCaption(data, invoicePageUrl(sessionId));
  // Cloud API fetches the document itself from this public URL — the PDF is
  // rendered on demand by the stream route, nothing is stored on disk.
  const pdfLink = `${getPublicBaseUrl()}/api/invoice/${sessionId}/pdf?t=${invoiceToken(sessionId)}`;
  const filename = `${data.invoiceNo}.pdf`;

  const result = await sendWhatsAppDocument(mobile, pdfLink, filename, caption);
  if (result.ok) {
    await recordDelivery(sessionId, { status: 'sent', at: new Date(), wamid: result.wamid });
    return 'sent';
  }
  const status: InvoiceDeliveryStatus = result.errorKind === 'optin-needed' ? 'optin-needed' : 'failed';
  await recordDelivery(sessionId, { status, at: new Date(), error: result.errorMsg });
  console.warn(`[whatsapp] invoice ${data.invoiceNo} -> ${status}: ${result.errorMsg}`);
  return status;
}
