import { ok } from '@/lib/utils';
import { waBusinessNumber, isWhatsAppConfigured } from '@/lib/whatsapp';

export const dynamic = 'force-dynamic';

/**
 * GET /api/whatsapp/business-number
 *   PUBLIC — returns the business WhatsApp number (digits only, with country
 *   code) so the customer's Thank You screen can build a wa.me opt-in link.
 *
 *   Response: { number: string, configured: boolean }
 *
 *   The number is safe to expose publicly: it is the number customers are
 *   MEANT to message (it appears on the restaurant's WhatsApp presence
 *   regardless). No tokens or phone-number-ids are ever returned here.
 */
export async function GET() {
  return ok({
    number: waBusinessNumber(),
    configured: isWhatsAppConfigured(),
  });
}
