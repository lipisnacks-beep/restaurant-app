import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge Tailwind classes safely. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Runtime currency symbol override. Set once by the customer app from the
 * admin-configured Settings (currencySymbol) so every formatCurrency() call —
 * including those inside sub-components that don't receive settings as a prop —
 * uses the right symbol without threading it through every call site.
 *
 * Falls back to '₹' until set. Server-side renders (admin/staff/chef portals
 * that call formatCurrency) keep the default unless they also call setCurrency.
 */
let runtimeCurrencySymbol = '₹';
export function setCurrencySymbol(symbol: string): void {
  const s = (symbol || '').trim();
  if (s) runtimeCurrencySymbol = s;
}

/** Format a number as currency. Uses the runtime symbol override (set from
 *  Settings) unless an explicit symbol is passed. */
export function formatCurrency(amount: number, symbol?: string): string {
  const sym = symbol ?? runtimeCurrencySymbol;
  const formatted = Number(amount || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return `${sym}${formatted}`;
}

/** Format an ISO date string to a short readable form. */
export function formatDate(iso: string | Date): string {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Relative "x minutes ago" string. */
export function timeAgo(iso: string | Date): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/** Generate a short human-friendly order number, e.g. "ORD-7F3A9K". */
export function generateOrderNumber(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `ORD-${code}`;
}

/** Standard JSON response helpers.
 *
 * All responses are sent with `Cache-Control: no-store, max-age=0` so the
 * browser never serves a stale cached copy on the next poll. Without this,
 * GETs like /api/orders?role=chef are heuristically cached on mobile
 * browsers (Safari/Chrome) and the chef portal keeps showing orders that
 * were already accepted by another chef until the cache entry expires. */
export function ok(data: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set('Cache-Control', 'no-store, max-age=0');
  return Response.json(data, { status: 200, ...init, headers });
}

export function fail(message: string, status = 400): Response {
  return Response.json(
    { error: message },
    { status, headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}

export function unauthorized(message = 'Unauthorized'): Response {
  return Response.json(
    { error: message },
    { status: 401, headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}

export function forbidden(message = 'Forbidden'): Response {
  return Response.json(
    { error: message },
    { status: 403, headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}

/**
 * Handler for an unexpected exception inside an API route.
 *
 * Without this, a thrown error (e.g. the DB not being configured, or a
 * transient connection failure) becomes a bare HTTP 500 with an EMPTY body,
 * which the client surfaces as the cryptic "Request failed (500)". Here we
 * turn it into a real JSON error so the UI can show something actionable.
 *
 * A database problem — either not configured, or unreachable (Atlas IP
 * allowlist, wrong credentials, network outage) — is reported as 503
 * (service unavailable) with an actionable message, so it is distinguishable
 * from a genuine server bug (500). Internal details are hidden in production
 * for non-DB errors, but DB errors always carry their actionable hint
 * because the fix is on the user's side (env var / Atlas allowlist).
 */
export function serverError(err: unknown): Response {
  const msg = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : '';
  const notConfigured = /MONGODB_URI is not configured/i.test(msg);
  // DbConnectionError is thrown by dbConnect() for any connection failure
  // (bad host, blocked IP, wrong creds, timeout). Mongoose also throws
  // MongooseError / MongoServerSelectionError / MongoNetworkError for the
  // same class of problem when a query runs before the connection is open.
  const connectionFailure =
    name === 'DbConnectionError' ||
    /MongooseError|MongoServerSelectionError|MongoNetworkError|MongoServerError|querySrv ENOTFOUND|timed out|ECONNREFUSED|ENOTFOUND/i.test(msg);
  const isDb = notConfigured || connectionFailure;
  const status = isDb ? 503 : 500;
  const safe = (() => {
    if (process.env.NODE_ENV !== 'production') return msg;
    if (notConfigured) return 'Database is not configured. Set MONGODB_URI in the server environment.';
    if (connectionFailure) {
      return 'Could not connect to the database. If this is a serverless deploy (Vercel), add its egress IP to your MongoDB Atlas Network Access allowlist (or 0.0.0.0/0 for testing) and verify MONGODB_URI credentials, then reload.';
    }
    return 'Internal server error';
  })();
  // eslint-disable-next-line no-console
  console.error('[api] server error:', msg);
  return Response.json(
    { error: safe },
    { status, headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
