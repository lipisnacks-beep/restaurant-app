/**
 * Session invoice: data loader, styled cafe/restaurant PDF (pdf-lib), token
 * gate and a WhatsApp-friendly text summary.
 *
 * The invoice covers a whole dining SESSION (all orders at the table) rather
 * than a single order — that is the bill the customer actually settles. It is
 * generated on demand (in-memory, no files on disk) so it works on Vercel's
 * serverless functions, and reuses the exact font strategy proven by
 * /api/reports/export: DejaVu TTFs bundled in public/fonts for the ₹ glyph,
 * with a WinAnsi-safe fallback.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { PDFPage, Color } from 'pdf-lib';
import Order, { OrderItem } from '@/models/Order';
import CustomerSession from '@/models/CustomerSession';
import Table from '@/models/Table';
import User from '@/models/User';
import { getSettings } from '@/lib/settings';
import { getPublicBaseUrl } from '@/lib/publicUrl';

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

export interface InvoiceItem {
  name: string;
  quantity: number;
  price: number;
  note?: string;
  amount: number;
}

export interface InvoiceData {
  sessionId: string;
  invoiceNo: string;
  tableNumber: number;
  customerName: string;
  mobile: string;
  items: InvoiceItem[];
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  serviceChargeRate: number;
  serviceChargeAmount: number;
  tip: number;
  total: number;
  paymentMethod: string;
  serverName: string;
  paidAt: Date;
  restaurant: { name: string; tagline: string; logoUrl: string | null; phone: string; address: string };
  currencySymbol: string;
}

/** Stable unguessable token for the public invoice links (page + PDF). */
export function invoiceToken(sessionId: string): string {
  const secret = process.env.JWT_SECRET || 'rms-invoice-fallback';
  return crypto.createHash('sha256').update(`${sessionId}:${secret}`).digest('hex').slice(0, 32);
}

export function verifyInvoiceToken(sessionId: string, token: string): boolean {
  const expected = invoiceToken(sessionId);
  // Constant-time-ish compare; token is low sensitivity but keep the habit.
  if (token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

export function invoicePageUrl(sessionId: string): string {
  return `${getPublicBaseUrl()}/invoice/${sessionId}?t=${invoiceToken(sessionId)}`;
}

export function invoicePdfUrl(sessionId: string): string {
  return `${getPublicBaseUrl()}/api/invoice/${sessionId}/pdf?t=${invoiceToken(sessionId)}`;
}

function formatDateIST(d: Date): string {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  return ist.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
    timeZone: 'UTC',
  });
}

/** INV-<table>-<yymmdd>-<session suffix> — short, human-readable, unique per session/day. */
function makeInvoiceNo(sessionId: string, tableNumber: number, d: Date): string {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  const ymd = [
    String(ist.getUTCFullYear()).slice(2),
    String(ist.getUTCMonth() + 1).padStart(2, '0'),
    String(ist.getUTCDate()).padStart(2, '0'),
  ].join('');
  const suffix = (sessionId.replace(/[^a-zA-Z0-9]/g, '').slice(-4) || '0000').toUpperCase();
  return `INV-T${tableNumber}-${ymd}-${suffix}`;
}

/** Load everything needed to render the session invoice. Returns null when the session has no paid orders. */
export async function loadSessionInvoice(sessionId: string): Promise<InvoiceData | null> {
  const [session, orders, settings] = await Promise.all([
    CustomerSession.findOne({ sessionId }),
    Order.find({ sessionId }).sort({ createdAt: 1 }),
    getSettings(),
  ]);
  const paidOrders = orders.filter((o) => o.paymentStatus === 'paid');
  if (paidOrders.length === 0) return null;

  // Item lines: preserve order + merge same-name items across orders.
  const byName = new Map<string, InvoiceItem>();
  for (const o of paidOrders) {
    for (const raw of (o.items || []) as OrderItem[]) {
      const existing = byName.get(raw.name);
      if (existing) {
        existing.quantity += raw.quantity;
        existing.amount += raw.quantity * raw.price;
      } else {
        byName.set(raw.name, {
          name: raw.name,
          quantity: raw.quantity,
          price: raw.price,
          note: raw.note || undefined,
          amount: raw.quantity * raw.price,
        });
      }
    }
  }

  // The server recorded on the table session (free-table ownership stamp).
  let serverName = '';
  const table = session ? await Table.findById(session.table) : null;
  const servedById = table?.currentSession?.servedByStaffId;
  if (servedById) {
    const server = await User.findById(servedById).select('name');
    if (server) serverName = server.name;
  }

  const methods = Array.from(new Set(paidOrders.map((o) => o.paymentMethod).filter(Boolean)));
  const lastPaidAt = paidOrders
    .map((o) => (o.completedAt || o.updatedAt || o.createdAt) as Date)
    .sort((a, b) => b.getTime() - a.getTime())[0] || new Date();

  const s = session || ({} as Record<string, unknown>);
  return {
    sessionId,
    invoiceNo: makeInvoiceNo(sessionId, (session?.tableNumber as number) || (orders[0]?.tableNumber as number) || 0, lastPaidAt),
    tableNumber: (session?.tableNumber as number) || (orders[0]?.tableNumber as number) || 0,
    customerName: (s.customerName as string) || (orders[0]?.customerName as string) || 'Guest',
    mobile: (s.mobile as string) || '',
    items: Array.from(byName.values()),
    subtotal: Number(s.subtotal) || paidOrders.reduce((sum, o) => sum + (o.subtotal || 0), 0),
    taxRate: (orders[0]?.taxRate as number) ?? Number(settings.taxRate),
    taxAmount: Number(s.taxAmount) || paidOrders.reduce((sum, o) => sum + (o.taxAmount || 0), 0),
    serviceChargeRate: (orders[0]?.serviceChargeRate as number) ?? Number(settings.serviceChargeRate),
    serviceChargeAmount: Number(s.serviceChargeAmount) || paidOrders.reduce((sum, o) => sum + (o.serviceChargeAmount || 0), 0),
    tip: Number(s.tip) || paidOrders.reduce((sum, o) => sum + (o.tip || 0), 0),
    total: Number(s.total) || paidOrders.reduce((sum, o) => sum + (o.grandTotal || o.total || 0), 0),
    paymentMethod: methods.length ? methods.join(' + ').toUpperCase() : 'PAID',
    serverName,
    paidAt: lastPaidAt,
    restaurant: {
      name: settings.restaurantName || 'Restaurant',
      tagline: settings.tagline || '',
      logoUrl: (settings as unknown as { logoUrl?: string | null }).logoUrl || null,
      phone: settings.phone || '',
      address: settings.address || '',
    },
    currencySymbol: settings.currencySymbol || '₹',
  };
}

/* ------------------------------- helpers ------------------------------- */

const inr = (n: number) => (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`;
}

/** Indian numbering: crore / lakh / thousand / hundred — "Rupees Twelve Thousand Three Hundred Forty-Five Only". */
export function amountInWords(amount: number): string {
  const n = Math.floor(Math.abs(amount));
  if (n === 0) return 'Zero Rupees Only';
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const hundred = Math.floor((n % 1000) / 100);
  const rest = n % 100;
  if (crore) parts.push(`${twoDigitsOrMore(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (hundred) parts.push(`${ONES[hundred]} Hundred`);
  if (rest) parts.push(twoDigits(rest));
  return `${parts.join(' ')} Rupees Only`;
}
function twoDigitsOrMore(n: number): string {
  return n >= 100 ? amountInWords(n).replace(' Rupees Only', '') : twoDigits(n);
}

/* ------------------------------ PDF builder ---------------------------- */

// Cafe palette (warm espresso + amber accents on cream).
const C_ESPRESSO = { red: 0.325, green: 0.137, blue: 0.067 };   // #532311
const C_AMBER = { red: 0.851, green: 0.467, blue: 0.039 };      // #D97706
const C_CREAM = { red: 1.0, green: 0.984, blue: 0.922 };        // #FFFBEB
const C_DARK = { red: 0.16, green: 0.145, blue: 0.125 };        // #292520
const C_GRAY = { red: 0.47, green: 0.44, blue: 0.42 };          // muted stone
const C_LIGHTLINE = { red: 0.88, green: 0.85, blue: 0.82 };
const C_WHITE = { red: 1, green: 1, blue: 1 };

type RGB = Color; // pdf-lib Color (rgb() outputs; avoids hand-shaping the discriminated union)
type PDFFont = { widthOfTextAtSize: (t: string, s: number) => number; heightAtSize: (s: number) => number };

interface PdfCtx {
  doc: import('pdf-lib').PDFDocument;
  page: PDFPage;
  font: PDFFont & { embedFont?: unknown };
  fontBold: PDFFont;
  W: number;
  M: number;
  H: number;
}

function text(ctx: PdfCtx, str: string, x: number, y: number, size: number, font: PDFFont, color: RGB, align: 'left' | 'right' | 'center' = 'left', maxW?: number): number {
  let s = str;
  if (maxW) {
    while (s.length > 1 && font.widthOfTextAtSize(s, size) > maxW) s = s.slice(0, -2) + '…';
  }
  let drawX = x;
  if (align === 'right') drawX = x - font.widthOfTextAtSize(s, size);
  if (align === 'center') drawX = x - font.widthOfTextAtSize(s, size) / 2;
  ctx.page.drawText(s, { x: drawX, y, size, font: font as never, color });
  return font.widthOfTextAtSize(s, size);
}

function wrapLines(str: string, font: PDFFont, size: number, maxW: number): string[] {
  const words = str.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= maxW) cur = next;
    else { if (cur) lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

function dashedLine(ctx: PdfCtx, y: number, x1: number, x2: number, color: RGB): void {
  const dash = 3, gap = 3;
  for (let x = x1; x < x2; x += dash + gap) {
    ctx.page.drawLine({
      start: { x, y },
      end: { x: Math.min(x + dash, x2), y },
      thickness: 0.8,
      color,
    });
  }
}

/** Attempt to embed the brand logo (Cloudinary JPEG/PNG). Returns its height, 0 when unavailable. */
async function embedLogo(ctx: PdfCtx, logoUrl: string | null | undefined): Promise<number> {
  if (!logoUrl) return 0;
  try {
    const res = await fetch(logoUrl, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return 0;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const logoY = ctx.H - 14 - 44; // top-right inside the header band
    const drawAt = (img: { width: number; height: number }) => {
      const w = Math.min((img.width / img.height) * 44, 110);
      ctx.page.drawImage(img as never, { x: ctx.W - ctx.M - w - 10, y: logoY, width: w, height: 44 });
    };
    if (bytes[0] === 0x89 && bytes[1] === 0x50) {
      const img = await ctx.doc.embedPng(bytes);
      drawAt(img);
      return 44;
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      const img = await ctx.doc.embedJpg(bytes);
      drawAt(img);
      return 44;
    }
  } catch {
    /* logo is decorative — never fail the invoice over it */
  }
  return 0;
}

/** Build the styled invoice PDF fully in memory. */
export async function buildInvoicePdf(data: InvoiceData): Promise<Uint8Array> {
  const pdfLib = (await import('pdf-lib')) as typeof import('pdf-lib');
  const fontkit = (await import('@pdf-lib/fontkit')).default;
  const { PDFDocument, StandardFonts, rgb } = pdfLib;
  const sym = data.currencySymbol || '₹';
  let pdfCurrency = sym;

  const doc = await PDFDocument.create();
  // Custom-font embedding (DejaVu for the ₹ glyph) requires a fontkit instance.
  doc.registerFontkit(fontkit);
  let font: PDFFont;
  let fontBold: PDFFont;
  try {
    const regularBytes = fs.readFileSync(path.join(process.cwd(), 'public', 'fonts', 'DejaVuSans.ttf'));
    const boldBytes = fs.readFileSync(path.join(process.cwd(), 'public', 'fonts', 'DejaVuSans-Bold.ttf'));
    font = await doc.embedFont(regularBytes, { subset: true });
    fontBold = await doc.embedFont(boldBytes, { subset: true });
  } catch {
    // Fallback: WinAnsi-safe standard fonts + ASCII currency label.
    font = await doc.embedFont(StandardFonts.Helvetica);
    fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
    pdfCurrency = sym === '₹' ? 'INR ' : sym;
  }

  const fmt = (n: number) => `${pdfCurrency}${inr(n)}`;
  const W = 420;
  const M = 26;
  const itemsH = data.items.reduce((h, it) => h + (it.note ? 44 : 30), 0);
  const wordsLines = wrapLines(`Amount in words: ${amountInWords(data.total)}`, font, 7.5, W - 2 * M - 8).length;
  const H = Math.max(640, 168 + 92 + itemsH + 148 + 74 + wordsLines * 10);
  const page = doc.addPage([W, H]);
  const ctx: PdfCtx = { doc, page, font, fontBold, W, M, H };
  const dark = rgb(C_DARK.red, C_DARK.green, C_DARK.blue);
  const gray = rgb(C_GRAY.red, C_GRAY.green, C_GRAY.blue);
  const white = rgb(1, 1, 1);
  const amber = rgb(C_AMBER.red, C_AMBER.green, C_AMBER.blue);
  const espresso = rgb(C_ESPRESSO.red, C_ESPRESSO.green, C_ESPRESSO.blue);

  /* Header band */
  const headerH = 92;
  page.drawRectangle({ x: 0, y: H - headerH, width: W, height: headerH, color: espresso });
  page.drawRectangle({ x: 0, y: H - headerH - 4, width: W, height: 4, color: amber });
  const nameSize = data.restaurant.name.length > 22 ? 17 : 21;
  text(ctx, data.restaurant.name.toUpperCase(), M + 14, H - 44, nameSize, fontBold, white);
  text(ctx, (data.restaurant.tagline || 'Restaurant & Cafe').slice(0, 60), M + 14, H - 58, 7.5, font, rgb(0.99, 0.9, 0.6));
  text(ctx, 'TAX INVOICE', M + 14, H - 78, 9, fontBold, rgb(0.98, 0.8, 0.45));
  await embedLogo(ctx, data.restaurant.logoUrl);
  text(ctx, `#${data.invoiceNo}`, W - M - 14, H - 44, 10.5, fontBold, white, 'right');
  text(ctx, formatDateIST(data.paidAt), W - M - 14, H - 58, 8, font, rgb(0.99, 0.9, 0.6), 'right');
  text(ctx, data.paymentMethod, W - M - 14, H - 78, 8.5, fontBold, rgb(0.98, 0.8, 0.45), 'right');

  /* Meta card */
  let y = H - headerH - 24;
  page.drawRectangle({ x: M, y: y - 46, width: W - 2 * M, height: 58, color: rgb(C_CREAM.red, C_CREAM.green, C_CREAM.blue), borderColor: rgb(0.93, 0.88, 0.8), borderWidth: 1 });
  const col2 = W / 2 + 8;
  text(ctx, 'GUEST', M + 14, y, 6.5, fontBold, gray);
  text(ctx, data.customerName || 'Guest', M + 14, y - 12, 10, fontBold, dark, 'left', col2 - M - 30);
  text(ctx, 'TABLE', col2, y, 6.5, fontBold, gray);
  text(ctx, `Table ${data.tableNumber}`, col2, y - 12, 10, fontBold, dark);
  text(ctx, 'MOBILE', M + 14, y - 30, 6.5, fontBold, gray);
  text(ctx, data.mobile ? `+91 ${data.mobile.slice(-10)}` : '—', M + 14, y - 42, 10, font, dark);
  text(ctx, 'SERVED BY', col2, y - 30, 6.5, fontBold, gray);
  text(ctx, data.serverName || '—', col2, y - 42, 10, font, dark);

  /* Items */
  y -= 66;
  page.drawRectangle({ x: M, y: y - 3, width: W - 2 * M, height: 16, color: rgb(0.96, 0.94, 0.9) });
  text(ctx, 'ITEM', M + 14, y + 2, 7.5, fontBold, gray);
  text(ctx, 'QTY', W - M - 118, y + 2, 7.5, fontBold, gray, 'right');
  text(ctx, 'RATE', W - M - 78, y + 2, 7.5, fontBold, gray, 'right');
  text(ctx, 'AMOUNT', W - M - 14, y + 2, 7.5, fontBold, gray, 'right');
  y -= 20;

  const nameW = W - 2 * M - 150;
  for (const it of data.items) {
    const lines = wrapLines(it.name, font, 9.5, nameW);
    for (const ln of lines.slice(0, 2)) {
      text(ctx, ln, M + 14, y, 9.5, font, dark, 'left', nameW);
      y -= 12;
    }
    if (it.note) {
      text(ctx, `“${it.note.slice(0, 48)}”`, M + 14, y, 7, font, gray);
      y -= 11;
    }
    text(ctx, String(it.quantity), W - M - 118, y + 12, 9, font, dark, 'right');
    text(ctx, fmt(it.price), W - M - 78, y + 12, 9, font, dark, 'right');
    text(ctx, fmt(it.amount), W - M - 14, y + 12, 9.5, fontBold, dark, 'right');
    y -= 8;
    dashedLine(ctx, y + 2, M + 12, W - M - 12, rgb(C_LIGHTLINE.red, C_LIGHTLINE.green, C_LIGHTLINE.blue));
    y -= 10;
  }

  /* Totals */
  y -= 6;
  const tx = W - M - 14;
  const row = (label: string, value: string, size = 9, bold = false, color: RGB = dark) => {
    text(ctx, label, tx - 90, y, size, bold ? fontBold : font, color, 'left', 78);
    text(ctx, value, tx, y, size, bold ? fontBold : font, color, 'right');
    y -= 15;
  };
  row('Subtotal', fmt(data.subtotal));
  if (data.taxAmount > 0) row(`GST (${Number(data.taxRate) || 0}%)`, fmt(data.taxAmount));
  if (data.serviceChargeAmount > 0) row(`Service (${Number(data.serviceChargeRate) || 0}%)`, fmt(data.serviceChargeAmount));
  if (data.tip > 0) row('Tip', fmt(data.tip));
  y -= 14; // clear the last row's cap height before the TOTAL band
  page.drawRectangle({ x: tx - 170, y: y - 8, width: 170, height: 28, color: amber });
  text(ctx, 'TOTAL', tx - 156, y + 1, 12, fontBold, white);
  text(ctx, fmt(data.total), tx - 14, y, 13.5, fontBold, white, 'right');
  y -= 22;
  for (const ln of wrapLines(`Amount in words: ${amountInWords(data.total)}`, font, 7.5, W - 2 * M - 8)) {
    text(ctx, ln, M + 12, y, 7.5, font, gray);
    y -= 10;
  }

  /* Footer */
  y -= 6;
  dashedLine(ctx, y, M, W - M, gray);
  y -= 18;
  text(ctx, 'Thank you for dining with us!', W / 2, y, 11, fontBold, espresso, 'center');
  y -= 14;
  const contactBits = [data.restaurant.address, data.restaurant.phone ? `Ph: ${data.restaurant.phone}` : ''].filter(Boolean).join('  •  ');
  for (const ln of wrapLines(contactBits || data.restaurant.name, font, 7.5, W - 2 * M)) {
    text(ctx, ln, W / 2, y, 7.5, font, gray, 'center');
    y -= 10;
  }
  y -= 4;
  text(ctx, `${data.invoiceNo}  •  Generated ${formatDateIST(new Date())}`, W / 2, y, 6.5, font, gray, 'center');
  y -= 11;
  text(ctx, invoicePageUrl(data.sessionId), W / 2, y, 6.5, font, gray, 'center');

  return await doc.save();
}

/* --------------------------- WhatsApp summary --------------------------- */

/** Compact WhatsApp-flavoured bill summary (bold via *…*). Kept well under the caption limit. */
export function buildInvoiceCaption(data: InvoiceData, pageUrl: string, googleReviewUrl?: string): string {
  const fmt = (n: number) => `${data.currencySymbol}${inr(n)}`;
  const lines: string[] = [];
  lines.push(`*${data.restaurant.name}*`);
  lines.push(`Invoice #${data.invoiceNo}  •  Table ${data.tableNumber}`);
  lines.push(formatDateIST(data.paidAt));
  lines.push('──────────────');
  const shown = data.items.slice(0, 12);
  for (const it of shown) {
    lines.push(`${it.quantity} × ${it.name} — ${fmt(it.amount)}`);
  }
  if (data.items.length > shown.length) lines.push(`… +${data.items.length - shown.length} more item(s)`);
  lines.push('──────────────');
  if (data.taxAmount > 0) lines.push(`GST (${Number(data.taxRate) || 0}%): ${fmt(data.taxAmount)}`);
  if (data.serviceChargeAmount > 0) lines.push(`Service (${Number(data.serviceChargeRate) || 0}%): ${fmt(data.serviceChargeAmount)}`);
  if (data.tip > 0) lines.push(`Tip: ${fmt(data.tip)}`);
  lines.push(`*TOTAL PAID: ${fmt(data.total)}* (${data.paymentMethod})`);
  lines.push('');
  lines.push(`View / download invoice: ${pageUrl}`);
  if (googleReviewUrl) lines.push(`Loved it? Review us: ${googleReviewUrl}`);
  lines.push('Thank you for dining with us!');
  return lines.join('\n').slice(0, 950);
}
