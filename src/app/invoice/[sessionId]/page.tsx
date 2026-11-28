/**
 * /invoice/[sessionId]?t=<token>
 *
 * The customer-facing web copy of the session invoice — same cafe styling as
 * the PDF (espresso header, cream body, amber total) but mobile-first so it
 * reads perfectly in the WhatsApp in-app browser. Token-gated with the same
 * sha256 scheme as the PDF route.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import dbConnect from '@/lib/db';
import CustomerSession from '@/models/CustomerSession';
import { amountInWords, invoicePdfUrl, loadSessionInvoice, verifyInvoiceToken } from '@/lib/invoice';

export const dynamic = 'force-dynamic';

const inr = (n: number) => (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formatDateIST(d: Date): string {
  const ist = new Date(d.getTime() + (5 * 60 + 30) * 60 * 1000);
  return ist.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
    timeZone: 'UTC',
  });
}

export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: { sessionId: string };
  searchParams: { t?: string };
}) {
  const token = searchParams.t || '';
  const sessionId = params.sessionId;
  if (!sessionId || !verifyInvoiceToken(sessionId, token)) notFound();

  await dbConnect();
  const data = await loadSessionInvoice(sessionId);
  if (!data) notFound();
  const session = await CustomerSession.findOne({ sessionId }).lean();
  const sentToWhatsApp =
    (session as unknown as { invoiceDelivery?: { status?: string } } | null)?.invoiceDelivery?.status === 'sent';

  const sym = data.currencySymbol || '₹';
  const fmt = (n: number) => `${sym}${inr(n)}`;

  return (
    <div className="min-h-screen bg-stone-100 py-6 px-3 font-sans">
      <div className="mx-auto w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl">
        {/* Header */}
        <div className="bg-[#532311] px-5 pb-5 pt-6 text-white">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-extrabold tracking-wide uppercase">{data.restaurant.name}</h1>
              <p className="mt-0.5 text-[11px] text-amber-200">{data.restaurant.tagline || 'Restaurant & Cafe'}</p>
              <p className="mt-2 text-[10px] font-bold tracking-widest text-amber-400">TAX INVOICE</p>
            </div>
            {data.restaurant.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.restaurant.logoUrl} alt="logo" className="h-12 w-auto max-w-[110px] rounded bg-white/90 object-contain p-1" />
            ) : null}
          </div>
          <div className="mt-3 flex items-end justify-between text-[12px] text-amber-100">
            <span>#{data.invoiceNo}</span>
            <span>{formatDateIST(data.paidAt)}</span>
          </div>
        </div>
        <div className="h-1 bg-amber-600" />

        {/* Meta */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 bg-[#FFFBEB] px-5 py-4 text-sm">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-wider text-stone-400">Guest</p>
            <p className="font-semibold text-stone-800">{data.customerName || 'Guest'}</p>
          </div>
          <div>
            <p className="text-[9px] font-bold uppercase tracking-wider text-stone-400">Table</p>
            <p className="font-semibold text-stone-800">Table {data.tableNumber}</p>
          </div>
          <div>
            <p className="text-[9px] font-bold uppercase tracking-wider text-stone-400">Mobile</p>
            <p className="text-stone-700">{data.mobile ? `+91 ${data.mobile.slice(-10)}` : '—'}</p>
          </div>
          <div>
            <p className="text-[9px] font-bold uppercase tracking-wider text-stone-400">Served by</p>
            <p className="text-stone-700">{data.serverName || '—'}</p>
          </div>
        </div>

        {/* Items */}
        <div className="px-5 pt-4">
          <div className="flex items-center justify-between border-b border-stone-200 pb-2 text-[10px] font-bold uppercase tracking-wider text-stone-400">
            <span>Item</span>
            <span className="flex gap-6">
              <span className="w-8 text-right">Qty</span>
              <span className="w-16 text-right">Rate</span>
              <span className="w-16 text-right">Amount</span>
            </span>
          </div>
          <ul className="divide-y divide-dashed divide-stone-200">
            {data.items.map((it, i) => (
              <li key={i} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-stone-800">{it.name}</p>
                  {it.note ? <p className="text-xs italic text-stone-400">“{it.note}”</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-6 text-sm">
                  <span className="w-8 text-right text-stone-600">{it.quantity}</span>
                  <span className="w-16 text-right text-stone-600">{fmt(it.price)}</span>
                  <span className="w-16 text-right font-semibold text-stone-800">{fmt(it.amount)}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Totals */}
        <div className="mx-5 mt-2 border-t border-stone-300 px-1 pt-3">
          <div className="space-y-1.5 text-sm text-stone-700">
            <div className="flex justify-between"><span>Subtotal</span><span>{fmt(data.subtotal)}</span></div>
            {data.taxAmount > 0 ? <div className="flex justify-between"><span>GST ({Number(data.taxRate) || 0}%)</span><span>{fmt(data.taxAmount)}</span></div> : null}
            {data.serviceChargeAmount > 0 ? <div className="flex justify-between"><span>Service charge ({Number(data.serviceChargeRate) || 0}%)</span><span>{fmt(data.serviceChargeAmount)}</span></div> : null}
            {data.tip > 0 ? <div className="flex justify-between"><span>Tip</span><span>{fmt(data.tip)}</span></div> : null}
          </div>
          <div className="mt-3 flex items-center justify-between rounded-lg bg-amber-600 px-4 py-3 text-white">
            <span className="text-sm font-bold tracking-wide">TOTAL</span>
            <span className="text-lg font-extrabold">{fmt(data.total)}</span>
          </div>
          <p className="mt-2 text-[10px] text-stone-400">Amount in words: {amountInWords(data.total)}</p>
        </div>

        {/* Footer */}
        <div className="mt-5 border-t border-dashed border-stone-300 px-5 pb-6 pt-4 text-center">
          <p className="text-sm font-bold text-[#532311]">Thank you for dining with us!</p>
          {data.restaurant.address || data.restaurant.phone ? (
            <p className="mt-1 text-[11px] text-stone-400">
              {[data.restaurant.address, data.restaurant.phone ? `Ph: ${data.restaurant.phone}` : ''].filter(Boolean).join('  •  ')}
            </p>
          ) : null}
          <div className="mt-4 flex flex-col gap-2">
            <Link
              href={invoicePdfUrl(sessionId)}
              target="_blank"
              className="w-full rounded-lg bg-[#532311] px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-[#6b2d15]"
            >
              Download PDF invoice
            </Link>
            {sentToWhatsApp ? (
              <p className="text-[11px] font-medium text-emerald-600">✓ Sent to your WhatsApp ({data.mobile ? `+91 ${data.mobile.slice(-10)}` : 'registered number'})</p>
            ) : null}
          </div>
          <p className="mt-3 text-[10px] text-stone-300">#{data.invoiceNo} • Generated {formatDateIST(new Date())}</p>
        </div>
      </div>
    </div>
  );
}
