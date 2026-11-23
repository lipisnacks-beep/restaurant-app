'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { api } from '@/lib/apiClient';
import { toast } from 'sonner';
import {
  ConciergeBell, ArrowLeft, Loader2, Coins, Wallet, Calendar, Download,
  CheckCircle2, TrendingUp, Banknote, ChevronRight, Info,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { formatCurrency } from '@/lib/utils';
import Link from 'next/link';

interface TipsSummary {
  tipsEarned: number;
  tipsWithdrawn: number;
  available: number;
  pendingSince: string | null;
}
interface TipByDate {
  date: string;   // YYYY-MM-DD
  orders: number;
  tips: number;
}
interface Withdrawal {
  _id: string;
  amount: number;
  from: string | null;
  to: string | null;
  note: string;
  status: 'completed' | 'pending';
  createdAt: string;
}
interface TipsData {
  summary: TipsSummary;
  byDate: TipByDate[];
  withdrawals: Withdrawal[];
}

/** Pretty-print a YYYY-MM-DD date as e.g. "Mon, 23 Nov 2026". */
function prettyDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}
/** Just the YYYY-MM-DD portion of an ISO datetime (for the withdrawal history). */
function dayOf(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

export default function StaffTipsClient() {
  const router = useRouter();
  const [data, setData] = useState<TipsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Withdrawal form state.
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [note, setNote] = useState('');
  const [selectedAmount, setSelectedAmount] = useState<number>(0); // computed from selected dates
  const [customAmount, setCustomAmount] = useState<string>(''); // optional override

  const load = useCallback(async () => {
    const { data, error, ok } = await api<TipsData>('/api/staff/tips');
    if (ok && data) {
      setData(data);
    } else if (error) {
      toast.error(error);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Compute the tips total for the selected date range, so the staff sees the
  // exact amount they're about to withdraw before confirming.
  const rangeTips = useMemo(() => {
    if (!data) return { amount: 0, orders: 0, dates: 0 };
    const inRange = data.byDate.filter((d) => {
      if (fromDate && d.date < fromDate) return false;
      if (toDate && d.date > toDate) return false;
      return true;
    });
    return {
      amount: inRange.reduce((s, d) => s + d.tips, 0),
      orders: inRange.reduce((s, d) => s + d.orders, 0),
      dates: inRange.length,
    };
  }, [data, fromDate, toDate]);

  // The amount we'll actually withdraw:
  //  - if the staff typed a custom amount, use that (validated against available)
  //  - otherwise use the computed range total
  //  - if no range selected, withdraw the full available balance
  const withdrawAmount = useMemo(() => {
    if (!data) return 0;
    const available = data.summary.available;
    if (customAmount.trim() !== '') {
      const n = Number(customAmount);
      if (!isFinite(n) || n <= 0) return 0;
      return Math.min(n, available);
    }
    if (fromDate || toDate) return Math.min(rangeTips.amount, available);
    return available; // full balance
  }, [data, customAmount, fromDate, toDate, rangeTips]);

  const hasRange = Boolean(fromDate || toDate);
  const nothingAvailable = (data?.summary.available ?? 0) <= 0;

  async function withdraw() {
    if (!data) return;
    if (busy) return;
    const available = data.summary.available;
    if (available <= 0) { toast.error('You have no tips available to withdraw'); return; }
    if (withdrawAmount <= 0) {
      toast.error(hasRange ? 'No tips found in the selected date range' : 'Enter a valid amount');
      return;
    }
    // Confirm: this is a real money movement.
    const rangeLabel = hasRange
      ? (fromDate && toDate ? `for ${prettyDate(fromDate)} to ${prettyDate(toDate)}`
         : fromDate ? `since ${prettyDate(fromDate)}`
         : `up to ${prettyDate(toDate)}`)
      : 'your full available balance';
    if (!confirm(`Withdraw ${formatCurrency(withdrawAmount)} ${rangeLabel}?\n\nThis cannot be undone.`)) return;

    setBusy(true);
    const body: Record<string, unknown> = {};
    // If the staff picked a range OR typed a custom amount, send amount.
    // Otherwise omit it so the server withdraws the full balance (atomic).
    if (customAmount.trim() !== '' || hasRange) body.amount = withdrawAmount;
    if (fromDate) body.from = fromDate;
    if (toDate) body.to = toDate;
    if (note.trim()) body.note = note.trim();

    const { data: res, error, ok } = await api<{ withdrawal: Withdrawal | null; summary: TipsSummary }>('/api/staff/tips/withdraw', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!ok || !res) { toast.error(error || 'Withdrawal failed'); return; }
    toast.success(`Withdrew ${formatCurrency(res.withdrawal?.amount ?? withdrawAmount)} to your account`);
    // Reset form + reload to reflect the new balance + history.
    setFromDate(''); setToDate(''); setNote(''); setCustomAmount('');
    load();
  }

  // Quick-select a single date from the breakdown table.
  function pickDate(d: string) {
    setFromDate(d); setToDate(d); setCustomAmount('');
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-gray-50 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-gray-50">
        <Header />
        <main className="max-w-4xl mx-auto px-4 py-6">
          <div className="card p-8 text-center">
            <p className="text-gray-600">Could not load your tips. Please sign in again.</p>
          </div>
        </main>
      </div>
    );
  }

  const { summary, byDate, withdrawals } = data;

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-gray-50">
      <Header />

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Back link */}
        <button onClick={() => router.push('/staff/portal')} className="btn-ghost text-gray-600 -ml-2">
          <ArrowLeft className="w-4 h-4" /> Back to orders
        </button>

        {/* Balance summary card */}
        <section className="card overflow-hidden">
          <div className="bg-gradient-to-r from-emerald-600 to-emerald-700 text-white p-6">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="text-emerald-100 text-sm flex items-center gap-1.5">
                  <Wallet className="w-4 h-4" /> Available to withdraw
                </p>
                <p className="text-4xl font-bold mt-1">{formatCurrency(summary.available)}</p>
                {summary.pendingSince && (
                  <p className="text-xs text-emerald-100 mt-1">
                    Earning since {prettyDate(summary.pendingSince)}
                  </p>
                )}
              </div>
              <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center">
                <Coins className="w-7 h-7" />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 divide-x divide-gray-100">
            <div className="p-4 text-center">
              <p className="text-xs text-gray-500 flex items-center justify-center gap-1">
                <TrendingUp className="w-3 h-3" /> Total earned
              </p>
              <p className="text-lg font-semibold text-emerald-600 mt-0.5">{formatCurrency(summary.tipsEarned)}</p>
            </div>
            <div className="p-4 text-center">
              <p className="text-xs text-gray-500 flex items-center justify-center gap-1">
                <Banknote className="w-3 h-3" /> Total withdrawn
              </p>
              <p className="text-lg font-semibold text-gray-700 mt-0.5">{formatCurrency(summary.tipsWithdrawn)}</p>
            </div>
          </div>
        </section>

        {/* Withdrawal form */}
        <section className="card p-6">
          <h2 className="font-semibold text-gray-800 mb-1 flex items-center gap-2">
            <Download className="w-4 h-4 text-emerald-500" /> Withdraw tips
          </h2>
          <p className="text-sm text-gray-500 mb-4">
            Pick a date range to withdraw just those days&apos; tips, or leave the dates empty to withdraw your full available balance.
          </p>

          <div className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="from" className="block text-sm font-medium text-gray-700 mb-1">From date</label>
                <input
                  id="from" type="date" className="input"
                  value={fromDate} onChange={(e) => setFromDate(e.target.value)}
                  max={toDate || undefined}
                />
              </div>
              <div>
                <label htmlFor="to" className="block text-sm font-medium text-gray-700 mb-1">To date</label>
                <input
                  id="to" type="date" className="input"
                  value={toDate} onChange={(e) => setToDate(e.target.value)}
                  min={fromDate || undefined}
                />
              </div>
            </div>

            {hasRange && (
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm">
                <p className="text-emerald-800 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  {rangeTips.dates > 0
                    ? <>Selected: <strong>{rangeTips.dates}</strong> day(s), <strong>{rangeTips.orders}</strong> order(s) = <strong>{formatCurrency(rangeTips.amount)}</strong> in tips</>
                    : <>No tips found in the selected date range</>}
                </p>
              </div>
            )}

            <div>
              <label htmlFor="amount" className="block text-sm font-medium text-gray-700 mb-1">
                Amount to withdraw <span className="text-gray-400 font-normal">(optional — defaults to {formatCurrency(summary.available)})</span>
              </label>
              <input
                id="amount" type="number" inputMode="decimal" step="0.01" min="0" max={summary.available}
                className="input" placeholder={hasRange ? String(rangeTips.amount) : String(summary.available)}
                value={customAmount} onChange={(e) => setCustomAmount(e.target.value)}
              />
              <p className="text-xs text-gray-400 mt-1">
                Leave blank to withdraw {hasRange ? 'the selected range total' : 'your full balance'}.
              </p>
            </div>

            <div>
              <label htmlFor="note" className="block text-sm font-medium text-gray-700 mb-1">Note <span className="text-gray-400 font-normal">(optional)</span></label>
              <input
                id="note" className="input" maxLength={280}
                value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Cash payout at counter, transfer to bKash"
              />
            </div>

            {/* Final amount + withdraw button */}
            <div className="flex items-center justify-between gap-3 pt-2 border-t border-gray-100">
              <div>
                <p className="text-xs text-gray-500">You will withdraw</p>
                <p className="text-2xl font-bold text-gray-900">{formatCurrency(withdrawAmount)}</p>
              </div>
              <button
                onClick={withdraw}
                disabled={busy || withdrawAmount <= 0}
                className="btn bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                {busy ? 'Processing…' : 'Withdraw tips'}
              </button>
            </div>
            {nothingAvailable && (
              <p className="text-xs text-amber-600 flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5" /> You have no tips available to withdraw right now.
              </p>
            )}
          </div>
        </section>

        {/* Date-wise tips breakdown */}
        <section className="card p-6">
          <h2 className="font-semibold text-gray-800 mb-1 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-emerald-500" /> Tips by date
          </h2>
          <p className="text-sm text-gray-500 mb-4">
            Each day you earned tips from orders you served. Tap a row to withdraw that day&apos;s tips.
          </p>
          {byDate.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">No tips earned yet. Serve orders and they will appear here once customers pay.</p>
          ) : (
            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                    <th className="px-2 py-2 font-medium">Date</th>
                    <th className="px-2 py-2 font-medium text-right">Orders</th>
                    <th className="px-2 py-2 font-medium text-right">Tips earned</th>
                    <th className="px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {byDate.map((d) => (
                    <tr key={d.date} className="border-b border-gray-50 hover:bg-emerald-50/50">
                      <td className="px-2 py-2.5 text-gray-700">{prettyDate(d.date)}</td>
                      <td className="px-2 py-2.5 text-right text-gray-500">{d.orders}</td>
                      <td className="px-2 py-2.5 text-right font-semibold text-emerald-600">{formatCurrency(d.tips)}</td>
                      <td className="px-2 py-2.5 text-right">
                        <button
                          onClick={() => pickDate(d.date)}
                          className="text-xs text-emerald-600 hover:text-emerald-700 font-medium inline-flex items-center gap-0.5"
                        >
                          Withdraw <ChevronRight className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50/60 font-semibold">
                    <td className="px-2 py-2.5 text-gray-700">Total earned</td>
                    <td className="px-2 py-2.5 text-right text-gray-500">{byDate.reduce((s, d) => s + d.orders, 0)}</td>
                    <td className="px-2 py-2.5 text-right text-emerald-700">{formatCurrency(byDate.reduce((s, d) => s + d.tips, 0))}</td>
                    <td className="px-2 py-2.5"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>

        {/* Withdrawal history */}
        <section className="card p-6">
          <h2 className="font-semibold text-gray-800 mb-1 flex items-center gap-2">
            <Banknote className="w-4 h-4 text-emerald-500" /> Withdrawal history
          </h2>
          <p className="text-sm text-gray-500 mb-4">Every payout you have made, newest first.</p>
          {withdrawals.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">No withdrawals yet. Your first payout will appear here.</p>
          ) : (
            <div className="space-y-3">
              {withdrawals.map((w) => (
                <div key={w._id} className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-800">{formatCurrency(w.amount)}</p>
                    <p className="text-xs text-gray-500">
                      {w.from && w.to ? `${prettyDate(w.from)} – ${prettyDate(w.to)}`
                       : w.from ? `Since ${prettyDate(w.from)}`
                       : w.to ? `Up to ${prettyDate(w.to)}`
                       : 'Full balance'}
                      {' · '}
                      {prettyDate(dayOf(w.createdAt))}
                    </p>
                    {w.note && <p className="text-xs text-gray-400 mt-0.5 italic truncate">&ldquo;{w.note}&rdquo;</p>}
                  </div>
                  <span className={`badge shrink-0 ${w.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                    {w.status === 'completed' ? <CheckCircle2 className="w-3 h-3 mr-1" /> : <Loader2 className="w-3 h-3 mr-1" />}
                    {w.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function Header() {
  return (
    <header className="bg-gradient-to-r from-emerald-600 to-emerald-700 text-white sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Coins className="w-6 h-6" />
          <div>
            <h1 className="font-semibold leading-none">My Tips</h1>
            <p className="text-xs text-emerald-100">Withdraw tips you earned from serving orders</p>
          </div>
        </div>
        <Link href="/staff/account" className="btn-ghost text-white hover:bg-white/10 p-2" title="Account settings">
          <ConciergeBell className="w-5 h-5" />
        </Link>
      </div>
    </header>
  );
}
