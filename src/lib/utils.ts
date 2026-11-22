import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge Tailwind classes safely. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Format a number as Indian Rupee. */
export function formatCurrency(amount: number, symbol = '₹'): string {
  const formatted = Number(amount || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return `${symbol}${formatted}`;
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

/** Standard JSON response helpers. */
export function ok(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, { status: 200, ...init });
}

export function fail(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

export function unauthorized(message = 'Unauthorized'): Response {
  return Response.json({ error: message }, { status: 401 });
}

export function forbidden(message = 'Forbidden'): Response {
  return Response.json({ error: message }, { status: 403 });
}
