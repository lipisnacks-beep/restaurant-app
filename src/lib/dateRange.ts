/**
 * Restaurant-local (Asia/Kolkata, UTC+5:30) date-range helpers.
 *
 * Every "today" / "this week" / "this month" / custom-range filter in the API
 * previously used `new Date().setHours(0,0,0,0)` which interprets midnight in
 * the SERVER process timezone — UTC on Vercel. UTC midnight = 05:30 IST, so a
 * restaurant's dinner service (19:00–23:00 IST) was split across two "today"
 * views, and an order placed at 01:00 IST on Nov 25 was counted as Nov 24.
 *
 * These helpers compute the boundaries of the IST calendar day (and week /
 * month) expressed as UTC Date objects, so Mongo queries are correct
 * regardless of the server's timezone.
 */

const IST_OFFSET_MINUTES = 5 * 60 + 30; // +05:30

/** Convert a wall-clock IST date/time to a UTC Date. */
function istDate(year: number, month: number, day: number, hours = 0, minutes = 0, seconds = 0, ms = 0): Date {
  // Date.UTC gives the instant; subtract the IST offset to get the UTC instant
  // that corresponds to that wall-clock time in Kolkata.
  return new Date(Date.UTC(year, month, day, hours, minutes, seconds, ms) - IST_OFFSET_MINUTES * 60 * 1000);
}

/** The current instant, but the IST "now" components. */
function istNow(): { y: number; m: number; d: number; h: number; min: number } {
  // Shift the current UTC instant forward by the IST offset, then read UTC
  // components — those are exactly the IST wall-clock components.
  const shifted = new Date(Date.now() + IST_OFFSET_MINUTES * 60 * 1000);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth(),
    d: shifted.getUTCDate(),
    h: shifted.getUTCHours(),
    min: shifted.getUTCMinutes(),
  };
}

/** Start of the current IST calendar day (00:00 IST) as a UTC Date. */
export function startOfIStDay(): Date {
  const { y, m, d } = istNow();
  return istDate(y, m, d);
}

/** End of the current IST calendar day (23:59:59.999 IST) as a UTC Date. */
export function endOfIStDay(): Date {
  const { y, m, d } = istNow();
  return istDate(y, m, d, 23, 59, 59, 999);
}

/** Start of the current IST week (Monday 00:00 IST) as a UTC Date. */
export function startOfIStWeek(): Date {
  const { y, m, d } = istNow();
  // getUTCDay of the shifted date == IST weekday (0=Sun..6=Sat)
  const shifted = new Date(Date.now() + IST_OFFSET_MINUTES * 60 * 1000);
  const weekday = shifted.getUTCDay(); // 0 Sun .. 6 Sat
  // Days since Monday (treat Sunday as 6 days back)
  const daysSinceMonday = (weekday + 6) % 7;
  const monday = istDate(y, m, d);
  monday.setUTCDate(monday.getUTCDate() - daysSinceMonday);
  return monday;
}

/** Start of the current IST month (1st 00:00 IST) as a UTC Date. */
export function startOfIStMonth(): Date {
  const { y, m } = istNow();
  return istDate(y, m, 1);
}

export type RangePreset = 'today' | 'week' | 'month';

/** Resolve a named preset to { from, to } UTC Date boundaries in IST. */
export function resolvePreset(range: RangePreset): { from: Date; to: Date } {
  switch (range) {
    case 'today':
      return { from: startOfIStDay(), to: endOfIStDay() };
    case 'week':
      return { from: startOfIStWeek(), to: endOfIStDay() };
    case 'month':
      return { from: startOfIStMonth(), to: endOfIStDay() };
    default:
      return { from: startOfIStDay(), to: endOfIStDay() };
  }
}

/**
 * Parse a `YYYY-MM-DD` date string (from an <input type="date">) as the START
 * of that IST calendar day (00:00 IST) → UTC Date.
 *
 * `new Date('2026-11-25')` interprets the string as UTC midnight = 05:30 IST,
 * which excludes the early-morning part of the IST day. This fixes that.
 */
export function parseDateFromInput(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((value || '').trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  return istDate(y, mo, d, 0, 0, 0, 0);
}

/**
 * Parse a `YYYY-MM-DD` date string as the END of that IST calendar day
 * (23:59:59.999 IST) → UTC Date. The previous code used `new Date(value)`
 * (UTC midnight = 05:30 IST), which excluded most of the day.
 */
export function parseDateToInput(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((value || '').trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  return istDate(y, mo, d, 23, 59, 59, 999);
}

/** A label for the range, in IST (so the browser-local conversion doesn't
 *  shift it to the wrong day). Returns "DD/MM/YYYY – DD/MM/YYYY". */
export function formatRangeLabel(from: Date, to: Date): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Kolkata' });
  return `${fmt(from)} – ${fmt(to)}`;
}
