# WhatsApp Invoice Delivery — Free Setup Guide

Send every customer an attractive, restaurant-styled **PDF invoice on WhatsApp**
automatically after they complete payment. **100% free tools only** — no Twilio,
no paid gateways, no template billing.

## How it stays free

The app uses the **official Meta WhatsApp Cloud API** (free to create, no card
required for the test number) with a strict **free-only policy**:

| Rule | Effect |
| --- | --- |
| Only **free-form messages** are ever sent (no template messages are configured at all) | Meta cannot bill you for utility templates — there are none |
| Invoices are delivered inside a **customer service window** (customer messaged the business number in the last 24h) | Free-form messages inside that window are **₹0** |
| If Meta rejects the send because no window is open (`131047`), the payment screen shows a **one-tap opt-in button** (`wa.me` deep link) | The customer's tap + send opens the free window; the webhook then delivers the invoice automatically within seconds — still ₹0 |

So the typical flow costs nothing per message. Meta's only paid product
(template messages) is never used.

## One-time setup (≈10 minutes)

1. **Create the Meta app**
   - Go to <https://developers.facebook.com> → **My Apps → Create App**.
   - App type: **Business**. Name it (e.g. "Lipi Snacks Invoices").
   - In the app dashboard, **Add product → WhatsApp**.
2. **Get the credentials** (WhatsApp → API Setup):
   - **Access token** → `WHATSAPP_TOKEN` (the temporary token works immediately;
     a permanent one comes later via a System User — same dashboard, free).
   - **Phone number ID** → `WHATSAPP_PHONE_NUMBER_ID`.
   - **Test number**: free forever, can message **up to 5 verified recipient
     numbers** (add each recipient's mobile + OTP under "To"). Perfect for
     testing and for a very small restaurant.
   - To reach **all customers**, click **Add phone number** and register your
     restaurant's real number (free; Meta may ask for business verification).
     Put that number in `WHATSAPP_BUSINESS_NUMBER`.
3. **Configure the webhook** (WhatsApp → Configuration):
   - Callback URL: `https://<your-domain>/api/whatsapp/webhook`
   - Verify token: any random string → `WHATSAPP_VERIFY_TOKEN` (same value in
     `.env` and in Meta's form).
   - Click **Verify and save** (the app's GET handler echoes `hub.challenge`),
     then **Subscribe** to the **messages** field.
4. **Set environment variables** (locally in `.env`, on Vercel in
   Project Settings → Environment Variables) and redeploy:

   ```env
   WHATSAPP_TOKEN=EAAG...your-access-token
   WHATSAPP_PHONE_NUMBER_ID=123456789012345
   WHATSAPP_BUSINESS_NUMBER=919876543210
   WHATSAPP_VERIFY_TOKEN=some-long-random-string
   ```

## What the customer experiences

1. Customer scans the table QR, orders, pays (cash / UPI / card).
2. The moment the **last order of the session is paid**:
   - **Window already open** (they messaged the business number before, or the
     app config is live): the styled PDF invoice arrives on their WhatsApp
     within seconds. The thank-you screen shows "Invoice sent to your
     WhatsApp".
   - **No window yet**: the thank-you screen shows a green
     **"Open WhatsApp & Send"** button. One tap opens their WhatsApp with a
     pre-filled *"Hi … please send my invoice to this number"* — they press
     Send, the webhook fires, and the PDF lands in the chat. The screen flips
     to "sent" automatically.
   - **Cloud API not configured yet**: everything still works — the screen
     shows **View invoice**, **Download PDF** and a **Save to my WhatsApp**
     self-share button. Zero cost, zero setup.
3. Every invoice also has a permanent, unguessable web copy at
   `/invoice/<session>?t=<token>` (mobile-first, same cafe styling) linked
   from the PDF caption and the thank-you card.

## The invoice itself

Rendered on demand in memory (`pdf-lib`, no disk writes — works on Vercel
serverless):

- Espresso header band with the restaurant name/tagline from **Admin →
  Settings** (logo is embedded automatically when set), invoice number, date,
  payment method.
- Guest / table / mobile / "Served by" block.
- Itemised bill (merged across all orders of the seating) with notes.
- Subtotal, GST %, service charge %, tip, highlighted **TOTAL**, and the
  amount in Indian-numbering words ("Rupees Twelve Thousand … Only").
- Footer: thank-you note, address/phone, and the online invoice link.

The ₹ glyph renders correctly via the bundled DejaVu fonts in `public/fonts`
(same mechanism as the existing reports export).

## Local testing without Meta

Point the client at the bundled mock Graph API:

```bash
# terminal 1: mock (returns success, or 131047 for numbers ending in "47")
WHATSAPP_API_BASE=http://localhost:3220 \
WHATSAPP_TOKEN=dummy WHATSAPP_PHONE_NUMBER_ID=111 \
WHATSAPP_BUSINESS_NUMBER=910000000001 WHATSAPP_VERIFY_TOKEN=verify-me \
npx tsx scripts/whatsapp_mock.ts

# terminal 2: app
npm run dev
```

Pay an order → `invoiceDelivery.status` on the session becomes `sent`
(mock wamid) or `optin-needed` (use a customer mobile ending in `47`), the
thank-you card reflects it, and `GET /api/whatsapp/webhook?...verify` echoes
the challenge.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Status `optin-needed` | Normal when the customer never messaged the business number — the one-tap button resolves it |
| Status `failed: 401` | Access token expired (temporary tokens last 24h) — mint a System User token |
| Status `failed: 131030` | The recipient number has no WhatsApp account / wrong country code |
| Webhook never fires | Webhook not subscribed to `messages`, wrong verify token, or the URL isn't publicly reachable (localhost won't work — use the Vercel domain or ngrok for local testing) |
| Test number sends nothing after 5 recipients | Free test-number cap — verify the recipient under API Setup → "To", or register a real number |
