import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import dbConnect from '@/lib/db';
import Order from '@/models/Order';
import Expense from '@/models/Expense';
import Purchase from '@/models/Purchase';
import { getSettings } from '@/lib/settings';
import { getSession } from '@/lib/auth';
import { fail, unauthorized, forbidden, serverError } from '@/lib/utils';
import { parseDateFromInput, parseDateToInput } from '@/lib/dateRange';

export const dynamic = 'force-dynamic';
// Keep these heavy server-only libs out of the route's module graph until the
// handler actually runs. Importing them at top level pulls pdfkit's font-file
// readFileSync(new URL(...)) into the bundle, which breaks Next's build-time
// page-data collection. They are also listed in serverComponentsExternalPackages
// in next.config.js so the dynamic import resolves to the real package.
export const runtime = 'nodejs';

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** IST-aware range resolver (mirrors reports/summary). The previous code used
 *  the server's process timezone (UTC on Vercel), splitting the restaurant's
 *  dinner service across two days. */
function resolveRange(q: URLSearchParams): { from: Date; to: Date } {
  const fromQ = q.get('from');
  const toQ = q.get('to');
  if (fromQ && toQ) {
    const from = parseDateFromInput(fromQ);
    const to = parseDateToInput(toQ);
    if (from && to) return { from, to };
  }
  const shifted = new Date(Date.now() + IST_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  const d = shifted.getUTCDate();
  const startTodayIST = new Date(Date.UTC(y, m, d) - IST_OFFSET_MS);
  const endTodayIST = new Date(Date.UTC(y, m, d, 23, 59, 59, 999) - IST_OFFSET_MS);
  const range = q.get('range') || 'today';
  switch (range) {
    case 'yesterday':
      return { from: new Date(startTodayIST.getTime() - 86400000), to: new Date(startTodayIST.getTime() - 1) };
    case '7d':
      return { from: new Date(startTodayIST.getTime() - 6 * 86400000), to: endTodayIST };
    case '30d':
      return { from: new Date(startTodayIST.getTime() - 29 * 86400000), to: endTodayIST };
    case 'month':
      return { from: new Date(Date.UTC(y, m, 1) - IST_OFFSET_MS), to: endTodayIST };
    case 'lastmonth': {
      const lastMonthIdx = m === 0 ? 11 : m - 1;
      const lastMonthYear = m === 0 ? y - 1 : y;
      return {
        from: new Date(Date.UTC(lastMonthYear, lastMonthIdx, 1) - IST_OFFSET_MS),
        to: new Date(Date.UTC(y, m, 1) - IST_OFFSET_MS - 1),
      };
    }
    case 'year':
      return { from: new Date(Date.UTC(y, 0, 1) - IST_OFFSET_MS), to: endTodayIST };
    case 'today':
    default:
      return { from: startTodayIST, to: endTodayIST };
  }
}

interface OrderRow {
  date: string; orderNumber: string; tableNumber: number; items: number;
  subtotal: number; tax: number; serviceCharge: number; tip: number; total: number;
  paymentMethod: string; paymentStatus: string;
}
interface ExpenseRow {
  date: string; category: string; description: string; amount: number;
  paymentMethod: string; vendor: string; invoiceNumber: string; note: string;
}
interface PurchaseRow {
  date: string; category: string; supplier: string; invoiceNumber: string;
  items: number; subtotal: number; tax: number; discount: number; total: number;
  paymentMethod: string; paymentStatus: string; amountPaid: number;
}

async function collectData(from: Date, to: Date) {
  const [orders, expenses, purchases] = await Promise.all([
    // Paid, non-cancelled orders (cancel now flips a paid order to 'refunded',
    // but exclude cancelled too to guard against legacy data).
    Order.find({ createdAt: { $gte: from, $lte: to }, paymentStatus: 'paid', status: { $ne: 'cancelled' } })
      .sort({ createdAt: 1 }).lean() as unknown as {
        createdAt: Date; orderNumber: string; tableNumber: number;
        items: { quantity: number }[]; subtotal: number; taxAmount: number;
        serviceChargeAmount: number; tip: number; total: number;
        paymentMethod?: string; paymentStatus: string;
      }[],
    Expense.find({ date: { $gte: from, $lte: to } }).sort({ date: 1 }).lean() as unknown as {
      date: Date; category: string; description: string; amount: number;
      paymentMethod: string; vendor: string; invoiceNumber: string; note: string;
    }[],
    Purchase.find({ date: { $gte: from, $lte: to } }).sort({ date: 1 }).lean() as unknown as {
      date: Date; category: string; supplier: string; invoiceNumber: string;
      items: unknown[]; subtotal: number; taxAmount: number; discount: number; total: number;
      paymentMethod: string; paymentStatus: string; amountPaid: number;
    }[],
  ]);

  // Format row dates in IST (Asia/Kolkata) so a row placed at 23:00 IST isn't
  // attributed to the next UTC calendar day in the export.
  const istDate = (d: Date) =>
    new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

  const orderRows: OrderRow[] = orders.map((o) => ({
    date: istDate(o.createdAt),
    orderNumber: o.orderNumber,
    tableNumber: o.tableNumber,
    items: o.items.reduce((s: number, it) => s + it.quantity, 0),
    subtotal: o.subtotal, tax: o.taxAmount, serviceCharge: o.serviceChargeAmount,
    tip: o.tip, total: o.total,
    paymentMethod: o.paymentMethod || '', paymentStatus: o.paymentStatus,
  }));
  const expenseRows: ExpenseRow[] = expenses.map((e) => ({
    date: istDate(e.date),
    category: e.category, description: e.description, amount: e.amount,
    paymentMethod: e.paymentMethod, vendor: e.vendor, invoiceNumber: e.invoiceNumber, note: e.note,
  }));
  const purchaseRows: PurchaseRow[] = purchases.map((p) => ({
    date: istDate(p.date),
    category: p.category, supplier: p.supplier, invoiceNumber: p.invoiceNumber,
    items: p.items.length, subtotal: p.subtotal, tax: p.taxAmount, discount: p.discount,
    total: p.total, paymentMethod: p.paymentMethod, paymentStatus: p.paymentStatus, amountPaid: p.amountPaid,
  }));

  // Restaurant revenue = subtotal + tax + serviceCharge. Tips are a passthrough
  // to the staff + chef who served the order — NOT restaurant income — so they
  // are excluded from revenue (and therefore from profit) and reported
  // separately. Order.total DOES include the tip (what the customer paid), so
  // we must not sum r.total here.
  const revenue = orderRows.reduce((s, r) => s + r.subtotal + r.tax + r.serviceCharge, 0);
  const grossSales = orderRows.reduce((s, r) => s + r.subtotal, 0);
  const tax = orderRows.reduce((s, r) => s + r.tax, 0);
  const tips = orderRows.reduce((s, r) => s + r.tip, 0);
  const exp = expenseRows.reduce((s, r) => s + r.amount, 0);
  const pur = purchaseRows.reduce((s, r) => s + r.total, 0);
  const totalCost = exp + pur;
  const profit = revenue - totalCost;

  return {
    orderRows, expenseRows, purchaseRows,
    summary: {
      range: `${istDate(from)} to ${istDate(to)}`,
      orders: orderRows.length, grossSales, revenue, tax, tips,
      expenses: exp, purchases: pur, totalCost, profit,
      margin: revenue ? Math.round((profit / revenue) * 1000) / 10 : 0,
      avgOrderValue: orderRows.length ? Math.round((revenue / orderRows.length) * 100) / 100 : 0,
    },
  };
}

function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCSV(data: Awaited<ReturnType<typeof collectData>>): string {
  const lines: string[] = [];
  const s = data.summary;
  lines.push('# Restaurant Financial Report');
  lines.push(`# Range,${s.range}`);
  lines.push(`# Orders,${s.orders},Gross Sales,${s.grossSales},Revenue,${s.revenue}`);
  lines.push(`# Tax,${s.tax},Tips (staff+chef),${s.tips},Service Charge,(included in revenue)`);
  lines.push(`# Expenses,${s.expenses},Purchases,${s.purchases},Total Cost,${s.totalCost}`);
  lines.push(`# Profit,${s.profit},Margin %,${s.margin},Avg Order,${s.avgOrderValue}`);
  lines.push('');
  lines.push('## ORDERS');
  lines.push('Date,Order Number,Table,Items,Subtotal,Tax,Service Charge,Tip,Total,Payment Method,Payment Status');
  for (const r of data.orderRows) {
    lines.push([r.date, r.orderNumber, r.tableNumber, r.items, r.subtotal, r.tax, r.serviceCharge, r.tip, r.total, r.paymentMethod, r.paymentStatus].map(csvEscape).join(','));
  }
  lines.push('');
  lines.push('## EXPENSES');
  lines.push('Date,Category,Description,Amount,Payment Method,Vendor,Invoice,Note');
  for (const r of data.expenseRows) {
    lines.push([r.date, r.category, r.description, r.amount, r.paymentMethod, r.vendor, r.invoiceNumber, r.note].map(csvEscape).join(','));
  }
  lines.push('');
  lines.push('## PURCHASES');
  lines.push('Date,Category,Supplier,Invoice,Items,Subtotal,Tax,Discount,Total,Payment Method,Payment Status,Amount Paid');
  for (const r of data.purchaseRows) {
    lines.push([r.date, r.category, r.supplier, r.invoiceNumber, r.items, r.subtotal, r.tax, r.discount, r.total, r.paymentMethod, r.paymentStatus, r.amountPaid].map(csvEscape).join(','));
  }
  return lines.join('\n');
}

function toXLSX(data: Awaited<ReturnType<typeof collectData>>, XLSX: typeof import('xlsx')): Buffer {
  const wb = XLSX.utils.book_new();
  const s = data.summary;
  const summaryAOA: (string | number)[][] = [
    ['Restaurant Financial Report'],
    ['Range', s.range],
    [],
    ['Metric', 'Value'],
    ['Orders', s.orders],
    ['Gross Sales (food value)', s.grossSales],
    ['Total Revenue (collected, excl. tips)', s.revenue],
    ['Tax Collected', s.tax],
    ['Tips (passthrough to staff + chef)', s.tips],
    ['Expenses', s.expenses],
    ['Purchases', s.purchases],
    ['Total Cost', s.totalCost],
    ['Net Profit', s.profit],
    ['Profit Margin %', s.margin],
    ['Avg Order Value', s.avgOrderValue],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryAOA), 'Summary');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.orderRows as unknown as Record<string, unknown>[]), 'Orders');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.expenseRows as unknown as Record<string, unknown>[]), 'Expenses');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.purchaseRows as unknown as Record<string, unknown>[]), 'Purchases');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}


/**
 * Map common Unicode currency symbols to an ASCII-safe label, used only as a
 * fallback when the bundled Unicode TTF can't be embedded (so the PDF still
 * renders instead of crashing on pdf-lib's WinAnsi-only StandardFonts). When
 * the Unicode font IS embedded (the normal path), the original symbol is used
 * unchanged.
 */
function sanitizeCurrency(symbol: string): string {
  const map: Record<string, string> = { '\u20b9': 'INR ', '$': '$', '\u20ac': 'EUR ', '\u00a3': 'GBP ', '\u00a5': 'JPY ', '\u09f3': 'BDT ' };
  const s = (symbol || '').trim();
  if (!s) return '';
  if (map[s]) return map[s];
  // Any char outside Latin-1 -> replace with '?' to stay WinAnsi-safe.
  return s.replace(/[^\x00-\xff]/g, '?');
}

function toPDF(data: Awaited<ReturnType<typeof collectData>>, restaurantName: string, currency: string, pdfLib: typeof import('pdf-lib')): Promise<Buffer> {
  const { PDFDocument, StandardFonts, rgb } = pdfLib;
  const s = data.summary;
  const PAGE_W = 595.28, PAGE_H = 841.89; // A4 in points
  const MARGIN = 40;

  return (async () => {
    const doc = await PDFDocument.create();
    // pdf-lib's StandardFonts only encode WinAnsi/Latin-1, so they cannot
    // render Unicode currency symbols like ₹ (U+20B9), ৳, ¥. We embed DejaVu
    // Sans (bundled in public/fonts) which covers those glyphs. If the TTF
    // can't be read for any reason, we fall back to Helvetica and sanitize the
    // currency symbol to an ASCII-safe form so the PDF still renders.
    let font: Awaited<ReturnType<typeof doc.embedFont>>;
    let fontBold: Awaited<ReturnType<typeof doc.embedFont>>;
    let pdfCurrency = currency;
    try {
      const regularBytes = fs.readFileSync(path.join(process.cwd(), 'public', 'fonts', 'DejaVuSans.ttf'));
      const boldBytes = fs.readFileSync(path.join(process.cwd(), 'public', 'fonts', 'DejaVuSans-Bold.ttf'));
      font = await doc.embedFont(regularBytes, { subset: true });
      fontBold = await doc.embedFont(boldBytes, { subset: true });
    } catch {
      // Fallback: standard fonts + ASCII-sanitized currency symbol.
      font = await doc.embedFont(StandardFonts.Helvetica);
      fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
      pdfCurrency = sanitizeCurrency(currency);
    }
    const fmtPdf = (n: number) => `${pdfCurrency}${(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const gray = rgb(0.39, 0.45, 0.55);
    const dark = rgb(0.06, 0.09, 0.16);
    const slate = rgb(0.97, 0.98, 0.99);
    const slateB = rgb(0.88, 0.91, 0.94);
    const headerBg = rgb(0.12, 0.16, 0.23);
    const white = rgb(1, 1, 1);
    const profitColor = s.profit >= 0 ? rgb(0.09, 0.64, 0.29) : rgb(0.86, 0.15, 0.15);

    let page = doc.addPage([PAGE_W, PAGE_H]);
    let y = PAGE_H - MARGIN;

    const drawText = (text: string, x: number, size: number, f: typeof font, color = dark, maxWidth?: number) => {
      page.drawText(text, { x, y, size, font: f, color, maxWidth: maxWidth ?? PAGE_W - MARGIN - x });
    };

    // Title block
    page.drawText(restaurantName, { x: PAGE_W / 2 - fontBold.widthOfTextAtSize(restaurantName, 20) / 2, y, size: 20, font: fontBold, color: dark });
    y -= 24;
    const sub = 'Financial Report';
    page.drawText(sub, { x: PAGE_W / 2 - font.widthOfTextAtSize(sub, 13) / 2, y, size: 13, font, color: gray });
    y -= 18;
    const rng = `Range: ${s.range}`;
    page.drawText(rng, { x: PAGE_W / 2 - font.widthOfTextAtSize(rng, 10) / 2, y, size: 10, font, color: gray });
    y -= 28;

    // KPI grid (3 cols)
    const kpis: [string, string, typeof dark][] = [
      ['Orders', String(s.orders), dark],
      ['Gross Sales', fmtPdf(s.grossSales), dark],
      ['Total Revenue (excl. tips)', fmtPdf(s.revenue), dark],
      ['Tax Collected', fmtPdf(s.tax), dark],
      ['Tips (staff + chef)', fmtPdf(s.tips), dark],
      ['Expenses', fmtPdf(s.expenses), dark],
      ['Purchases', fmtPdf(s.purchases), dark],
      ['Total Cost', fmtPdf(s.totalCost), dark],
      ['Net Profit', fmtPdf(s.profit), profitColor],
      ['Profit Margin', `${s.margin}%`, dark],
      ['Avg Order Value', fmtPdf(s.avgOrderValue), dark],
    ];
    const colW = (PAGE_W - 2 * MARGIN) / 3;
    const cellH = 38;
    kpis.forEach((kpi, i) => {
      const col = i % 3, row = Math.floor(i / 3);
      const x = MARGIN + col * colW, cy = y - row * cellH;
      page.drawRectangle({ x, y: cy - cellH + 4, width: colW - 8, height: cellH - 4, color: slate, borderColor: slateB, borderWidth: 0.5 });
      page.drawText(kpi[0], { x: x + 6, y: cy - 12, size: 8, font, color: gray });
      page.drawText(kpi[1], { x: x + 6, y: cy - 26, size: 11, font: fontBold, color: kpi[2] });
    });
    y -= Math.ceil(kpis.length / 3) * cellH + 24;

    // Table helper
    const drawTable = (title: string, headers: string[], rows: string[][], colWidths: number[]) => {
      if (y < MARGIN + 60) { page = doc.addPage([PAGE_W, PAGE_H]); y = PAGE_H - MARGIN; }
      page.drawText(title, { x: MARGIN, y, size: 12, font: fontBold, color: dark });
      y -= 18;
      if (rows.length === 0) {
        page.drawText('No records in this range.', { x: MARGIN, y, size: 9, font, color: gray });
        y -= 16;
        return;
      }
      const rowH = 16;
      const tableW = colWidths.reduce((a, b) => a + b, 0);
      // header
      page.drawRectangle({ x: MARGIN, y: y - rowH, width: tableW, height: rowH, color: headerBg });
      let x = MARGIN;
      headers.forEach((h, i) => { page.drawText(h, { x: x + 3, y: y - rowH + 5, size: 8, font: fontBold, color: white }); x += colWidths[i]; });
      y -= rowH;
      const maxRows = Math.min(rows.length, 30);
      for (let r = 0; r < maxRows; r++) {
        if (y - rowH < MARGIN) { page = doc.addPage([PAGE_W, PAGE_H]); y = PAGE_H - MARGIN; }
        if (r % 2) page.drawRectangle({ x: MARGIN, y: y - rowH, width: tableW, height: rowH, color: slate });
        x = MARGIN;
        rows[r].forEach((cell, i) => {
          let txt = cell;
          const maxW = colWidths[i] - 6;
          while (font.widthOfTextAtSize(txt, 8) > maxW && txt.length > 3) txt = txt.slice(0, -2) + '…';
          page.drawText(txt, { x: x + 3, y: y - rowH + 5, size: 8, font, color: dark });
          x += colWidths[i];
        });
        y -= rowH;
      }
      if (rows.length > maxRows) {
        page.drawText(`... and ${rows.length - maxRows} more rows (see Excel/CSV for full data).`, { x: MARGIN, y: y - 10, size: 8, font, color: gray });
        y -= 14;
      }
      y -= 14;
    };

    const orderRows = data.orderRows.slice(0, 30).map((r) => [r.date, r.orderNumber, String(r.tableNumber), String(r.items), fmtPdf(r.subtotal), fmtPdf(r.total), r.paymentMethod]);
    drawTable('Orders', ['Date', 'Order #', 'Table', 'Items', 'Subtotal', 'Total', 'Pay'], orderRows, [65, 75, 40, 40, 70, 70, 50]);

    const expRows = data.expenseRows.slice(0, 30).map((r) => [r.date, r.category, r.description.slice(0, 30), fmtPdf(r.amount), r.paymentMethod]);
    drawTable('Expenses', ['Date', 'Category', 'Description', 'Amount', 'Pay'], expRows, [65, 80, 130, 70, 50]);

    const purRows = data.purchaseRows.slice(0, 30).map((r) => [r.date, r.category, (r.supplier || '').slice(0, 25), String(r.items), fmtPdf(r.subtotal), fmtPdf(r.total), r.paymentStatus]);
    drawTable('Purchases', ['Date', 'Category', 'Supplier', 'Items', 'Subtotal', 'Total', 'Status'], purRows, [65, 75, 110, 40, 70, 70, 50]);

    const bytes = await doc.save();
    return Buffer.from(bytes);
  })();
}

/**
 * GET /api/reports/export?format=xlsx|csv|pdf&range=today|...&from=&to=
 *   Admin-only. Streams the file download.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return unauthorized();
    if (session.role !== 'admin') return forbidden();

    const q = new URL(req.url).searchParams;
    const format = (q.get('format') || 'xlsx').toLowerCase();
    if (!['xlsx', 'csv', 'pdf'].includes(format)) return fail('Invalid format. Use xlsx, csv or pdf.');

    await dbConnect();
    const { from, to } = resolveRange(q);
    const settings = await getSettings();
    const data = await collectData(from, to);
    // Filename stamp in IST so it matches the data window.
    const istStamp = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
    const stamp = `${istStamp(from)}_to_${istStamp(to)}`;
    const name = `restaurant_report_${stamp}`;

    if (format === 'csv') {
      return new NextResponse(toCSV(data), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${name}.csv"`,
        },
      });
    }
    if (format === 'xlsx') {
      const XLSX = await import('xlsx');
      const buf = toXLSX(data, XLSX);
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${name}.xlsx"`,
        },
      });
    }
    // pdf
    const pdfLib = await import('pdf-lib');
    const buf = await toPDF(data, settings.restaurantName, settings.currencySymbol || '₹', pdfLib);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${name}.pdf"`,
      },
    });
  } catch (err) {
    return serverError(err);
  }
}
