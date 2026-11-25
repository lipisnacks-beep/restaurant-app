'use client';
import { useEffect, useState, useCallback } from 'react';
import { api, getTabToken } from '@/lib/apiClient';
import { formatCurrency } from '@/lib/utils';
import { toast } from 'sonner';
import {
  BarChart3, Loader2, TrendingUp, TrendingDown, Wallet, ShoppingCart,
  Receipt, Banknote, Coins, FileSpreadsheet, FileText, FileType2, Calendar,
} from 'lucide-react';
import { LineChart, DonutChart } from '@/components/ui/Charts';
import {
  RANGE_PRESETS, type RangePreset, type ReportSummary,
} from '@/lib/reports.types';

export default function AdminReportsClient() {
  const [data, setData] = useState<ReportSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<string | null>(null);
  const [range, setRange] = useState<RangePreset>('30d');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [useCustom, setUseCustom] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (useCustom && custom.from && custom.to) {
      params.set('from', custom.from);
      params.set('to', custom.to);
    } else {
      params.set('range', range);
    }
    const { data: d, ok, error } = await api<ReportSummary>(`/api/reports/summary?${params.toString()}`);
    if (ok && d) setData(d);
    else toast.error(error || 'Failed to load report');
    setLoading(false);
  }, [range, useCustom, custom]);

  useEffect(() => { load(); }, [load]);

  async function exportReport(format: 'xlsx' | 'csv' | 'pdf') {
    setExporting(format);
    const params = new URLSearchParams();
    if (useCustom && custom.from && custom.to) {
      params.set('from', custom.from);
      params.set('to', custom.to);
    } else {
      params.set('range', range);
    }
    params.set('format', format);
    const token = getTabToken();
    try {
      const res = await fetch(`/api/reports/export?${params.toString()}`, {
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) { toast.error('Export failed'); return; }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const cd = res.headers.get('content-disposition') || '';
      const m = cd.match(/filename="?([^"]+)"?/);
      a.download = m ? m[1] : `restaurant_report.${format}`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`Exported as ${format.toUpperCase()}`);
    } catch (e) {
      toast.error('Export failed');
    } finally {
      setExporting(null);
    }
  }

  const k = data?.kpis;
  const m = data?.meta;
  const cur = m?.currency || '₹';
  const profitPositive = (k?.profit || 0) >= 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-amber-600" /> Reports &amp; Analytics
          </h1>
          <p className="text-sm text-gray-500">Sales, revenue, expenses, purchases and profit — daily, monthly, yearly or any custom range.</p>
        </div>
      </div>

      {/* Range selector */}
      <div className="card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex items-center gap-1 text-sm text-gray-500">
            <Calendar className="w-4 h-4" /> Period:
          </div>
          {!useCustom ? (
            <div className="flex flex-wrap gap-1">
              {RANGE_PRESETS.map((p) => (
                <button key={p.value} onClick={() => setRange(p.value)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
                    range === p.value ? 'bg-amber-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}>
                  {p.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">From</label>
                <input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} className="input text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">To</label>
                <input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} className="input text-sm" />
              </div>
              <button onClick={load} className="btn-primary text-sm">Apply</button>
            </div>
          )}
          <button onClick={() => setUseCustom(!useCustom)}
            className={`ml-auto text-xs px-3 py-1.5 rounded-md ${useCustom ? 'bg-slate-100 text-slate-600' : 'bg-amber-100 text-amber-700'}`}>
            {useCustom ? 'Use presets' : 'Custom range'}
          </button>
          <div className="flex gap-1 ml-auto sm:ml-0">
            <button onClick={() => exportReport('xlsx')} disabled={!!exporting} className="btn-secondary text-xs flex items-center gap-1">
              {exporting === 'xlsx' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5" />} Excel
            </button>
            <button onClick={() => exportReport('csv')} disabled={!!exporting} className="btn-secondary text-xs flex items-center gap-1">
              {exporting === 'csv' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileType2 className="w-3.5 h-3.5" />} CSV
            </button>
            <button onClick={() => exportReport('pdf')} disabled={!!exporting} className="btn-secondary text-xs flex items-center gap-1">
              {exporting === 'pdf' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />} PDF
            </button>
          </div>
        </div>
        {m && (
          <p className="text-xs text-gray-400 mt-2">
            Showing data for {new Date(m.from).toLocaleDateString('en-IN')} – {new Date(m.to).toLocaleDateString('en-IN')}
            {m.bucketBy === 'month' ? ' (grouped by month)' : ' (grouped by day)'}
          </p>
        )}
      </div>

      {loading || !k ? (
        <div className="card p-12 text-center text-gray-500 flex items-center justify-center gap-2">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading report…
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Total Revenue" value={formatCurrency(k.revenue, cur)} icon={<Banknote className="w-5 h-5" />} color="emerald" sub={`${k.orders} orders`} />
            <KpiCard label="Gross Sales" value={formatCurrency(k.grossSales, cur)} icon={<Receipt className="w-5 h-5" />} color="blue" sub={`Avg ${formatCurrency(k.avgOrderValue, cur)}/order`} />
            <KpiCard label="Total Expenses" value={formatCurrency(k.expenses, cur)} icon={<Wallet className="w-5 h-5" />} color="rose" sub={`${k.expenseCount} entries`} />
            <KpiCard label="Total Purchases" value={formatCurrency(k.purchases, cur)} icon={<ShoppingCart className="w-5 h-5" />} color="indigo" sub={`${k.purchaseCount} entries`} />
            <KpiCard label="Net Profit" value={formatCurrency(k.profit, cur)} icon={profitPositive ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />} color={profitPositive ? 'green' : 'red'} sub={`${k.margin}% margin`} />
            <KpiCard label="Total Cost" value={formatCurrency(k.totalCost, cur)} icon={<Coins className="w-5 h-5" />} color="amber" sub="Expenses + Purchases" />
            <KpiCard label="Tax Collected" value={formatCurrency(k.tax, cur)} icon={<Receipt className="w-5 h-5" />} color="slate" sub="from paid orders" />
            <KpiCard label="Tips" value={formatCurrency(k.tips, cur)} icon={<Coins className="w-5 h-5" />} color="amber" sub="passthrough to staff + chef" />
          </div>

          {/* Trend chart */}
          <div className="card p-4">
            <h2 className="font-semibold text-gray-800 mb-3">Revenue, Expenses &amp; Profit Trend</h2>
            {data.series.length === 0 ? (
              <p className="text-sm text-gray-400 py-8 text-center">No data in this range.</p>
            ) : (
              <LineChart
                labels={data.series.map((s) => s.label)}
                currency={cur}
                series={[
                  { label: 'Revenue', color: '#10b981', values: data.series.map((s) => s.revenue) },
                  { label: 'Expenses', color: '#ef4444', values: data.series.map((s) => s.expenses) },
                  { label: 'Purchases', color: '#6366f1', values: data.series.map((s) => s.purchases) },
                  { label: 'Profit', color: '#f59e0b', values: data.series.map((s) => s.profit) },
                ]}
              />
            )}
          </div>

          {/* Breakdowns */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card p-4">
              <h2 className="font-semibold text-gray-800 mb-3">Expenses by Category</h2>
              <DonutChart
                currency={cur}
                centerLabel="Expenses"
                slices={data.breakdowns.expenseByCategory.map((x) => ({ label: x.category, value: x.amount }))}
              />
            </div>
            <div className="card p-4">
              <h2 className="font-semibold text-gray-800 mb-3">Purchases by Category</h2>
              <DonutChart
                currency={cur}
                centerLabel="Purchases"
                slices={data.breakdowns.purchaseByCategory.map((x) => ({ label: x.category, value: x.amount }))}
              />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Payment method */}
            <div className="card p-4">
              <h2 className="font-semibold text-gray-800 mb-3">Revenue by Payment Method</h2>
              {data.breakdowns.revenueByPaymentMethod.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">No paid orders in this range.</p>
              ) : (
                <div className="space-y-2">
                  {data.breakdowns.revenueByPaymentMethod.map((p) => {
                    const max = Math.max(...data.breakdowns.revenueByPaymentMethod.map((x) => x.revenue), 1);
                    return (
                      <div key={p.method}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="capitalize text-slate-700">{p.method || 'unknown'}</span>
                          <span className="text-slate-500">{formatCurrency(p.revenue, cur)} · {p.count} orders</span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-amber-500 rounded-full" style={{ width: `${(p.revenue / max) * 100}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Top items */}
            <div className="card p-4">
              <h2 className="font-semibold text-gray-800 mb-3">Top Selling Items</h2>
              {data.breakdowns.topItems.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">No items sold in this range.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-gray-500 text-left">
                      <tr><th className="py-1.5">#</th><th className="py-1.5">Item</th><th className="py-1.5 text-right">Qty</th><th className="py-1.5 text-right">Revenue</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.breakdowns.topItems.map((it, i) => (
                        <tr key={i}>
                          <td className="py-1.5 text-gray-400">{i + 1}</td>
                          <td className="py-1.5 text-slate-700">{it.name}</td>
                          <td className="py-1.5 text-right text-slate-600">{it.qty}</td>
                          <td className="py-1.5 text-right font-medium text-emerald-600">{formatCurrency(it.revenue, cur)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({ label, value, icon, color, sub }: {
  label: string; value: string; icon: React.ReactNode; color: string; sub?: string;
}) {
  const colors: Record<string, string> = {
    emerald: 'text-emerald-600 bg-emerald-50', blue: 'text-blue-600 bg-blue-50',
    rose: 'text-rose-600 bg-rose-50', indigo: 'text-indigo-600 bg-indigo-50',
    green: 'text-green-600 bg-green-50', red: 'text-red-600 bg-red-50',
    amber: 'text-amber-600 bg-amber-50', slate: 'text-slate-600 bg-slate-100',
  };
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-gray-500">{label}</p>
          <p className="text-xl font-bold text-gray-800 mt-1 break-words">{value}</p>
          {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
        </div>
        <div className={`p-2 rounded-lg ${colors[color] || colors.slate}`}>{icon}</div>
      </div>
    </div>
  );
}
