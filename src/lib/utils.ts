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
