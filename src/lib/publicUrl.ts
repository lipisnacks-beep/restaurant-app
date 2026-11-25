/**
 * Resolve the public base URL used to build QR codes and customer-facing links.
 *
 * Why this exists: the customer scan flow depends on QR codes encoding the
 * production URL. If NEXT_PUBLIC_BASE_URL is unset (or still the dev default
 * "http://localhost:3000") the printed QRs point to localhost — useless in
 * production. Previously the code silently fell back to '' (empty), producing
 * a relative `/customer?table=N` URL that phones can't resolve at all.
 *
 * Behaviour:
 *   - In NODE_ENV !== 'production' (local dev): fall back to
 *     http://localhost:3000 so the dev server works even without the env var.
 *   - In production: if the var is missing or still localhost, THROW with a
 *     clear, actionable message. The route's serverError() turns this into a
 *     503 the admin actually sees, instead of silently shipping broken QRs.
 */
export function getPublicBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_BASE_URL?.trim() || '';
  const isProd = process.env.NODE_ENV === 'production';
  const looksLikeDev = !raw || raw.startsWith('http://localhost') || raw.startsWith('http://127.0.0.1');
  if (isProd && looksLikeDev) {
    throw new Error(
      'NEXT_PUBLIC_BASE_URL is not configured for production. Set it to your deployed URL (e.g. https://your-app.vercel.app) in Vercel → Project Settings → Environment Variables, then redeploy. Without it the table QR codes point to localhost and the customer scan flow is broken.',
    );
  }
  return raw || 'http://localhost:3000';
}

/** Build the customer scan URL for a given table number. */
export function buildTableQrUrl(tableNumber: number): string {
  return `${getPublicBaseUrl()}/customer?table=${tableNumber}`;
}
