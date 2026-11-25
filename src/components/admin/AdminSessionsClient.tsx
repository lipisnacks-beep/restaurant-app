'use client';
import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/apiClient';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Clock, Users, TrendingUp, Calendar, Loader2 } from 'lucide-react';

interface SessionItem {
  _id: string;
  sessionId: string;
  customerName: string;
  mobile: string;
  tableNumber: number;
  status: 'active' | 'paid' | 'completed' | 'closed';
  startedAt: string;
  endedAt?: string | null;
  reviewAt?: string | null;
  closedAt?: string | null;
  orderCount: number;
  subtotal: number;
  taxAmount: number;
  serviceChargeAmount: number;
  tip: number;
  total: number;
  occupiedMs: number;
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-amber-100 text-amber-700',
  paid: 'bg-sky-100 text-sky-700',
  completed: 'bg-emerald-100 text-emerald-700',
  closed: 'bg-gray-100 text-gray-500',
};

export default function AdminSessionsClient() {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all');
  // Server-side aggregates over ALL matching sessions (not the page-limited
  // list), so the cards are accurate even with >100 sessions.
  const [stats, setStats] = useState({
    activeCount: 0,
    todaySessions: 0,
    sessionRevenue: 0,
    sessionTips: 0,
    finishedCount: 0,
    avgOccupiedMs: 0,
  });

  const load = useCallback(async () => {
    // "Finished" maps to the server's multi-status {paid,completed,closed}
    // query so paid/completed sessions (functionally finished) show up —
    // previously the client sent status='closed' and excluded them.
    const status = filter === 'all' ? 'all' : filter === 'active' ? 'active' : 'finished';
    const { data, ok } = await api<{
      sessions: SessionItem[];
      activeCount: number;
      todaySessions: number;
      sessionRevenue: number;
      sessionTips: number;
      finishedCount: number;
      avgOccupiedMs: number;
    }>(`/api/sessions?status=${status}&limit=100`);
    if (ok && data) {
      setSessions(data.sessions);
      setStats({
        activeCount: data.activeCount,
        todaySessions: data.todaySessions,
        sessionRevenue: data.sessionRevenue || 0,
        sessionTips: data.sessionTips || 0,
        finishedCount: data.finishedCount || 0,
        avgOccupiedMs: data.avgOccupiedMs || 0,
      });
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  // Average occupied time + revenue/tips come from the server aggregates (over
  // ALL finished sessions, not just the page-limited list).
  const avgOccupiedMs = stats.avgOccupiedMs;
  const totalRevenue = stats.sessionRevenue;
  const totalTips = stats.sessionTips;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Customer Dining Sessions</h1>
        <p className="text-sm text-gray-500">Occupied-time history &amp; live status for every dining session.</p>
      </div>

      {/* Stats cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Clock} label="Currently Occupied" value={String(stats.activeCount)} accent="bg-amber-100 text-amber-700" />
        <StatCard icon={Calendar} label="Today's Sessions" value={String(stats.todaySessions)} accent="bg-sky-100 text-sky-700" />
        <StatCard icon={Users} label="Avg Occupied Time" value={formatDuration(avgOccupiedMs)} accent="bg-emerald-100 text-emerald-700" />
        <StatCard icon={TrendingUp} label="Session Revenue" value={formatCurrency(totalRevenue)} accent="bg-purple-100 text-purple-700" sub={`+${formatCurrency(totalTips)} tips`} />
      </div>

      {/* Filter */}
      <div className="flex gap-2">
        {(['all', 'active', 'completed'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`badge px-3 py-1.5 cursor-pointer ${filter === f ? 'bg-brand-600 text-white' : 'bg-white text-gray-700 border'}`}>
            {f === 'all' ? 'All sessions' : f === 'active' ? 'Currently dining' : 'Finished'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : sessions.length === 0 ? (
        <div className="card p-8 text-center text-gray-500">No sessions yet.</div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Customer</th>
                  <th className="text-left px-4 py-3 font-medium">Table</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Started</th>
                  <th className="text-left px-4 py-3 font-medium">Occupied</th>
                  <th className="text-right px-4 py-3 font-medium">Orders</th>
                  <th className="text-right px-4 py-3 font-medium">Total</th>
                  <th className="text-right px-4 py-3 font-medium">Tip</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {sessions.map((s) => (
                  <tr key={s._id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-800">{s.customerName || 'Guest'}</div>
                      <div className="text-xs text-gray-400">{s.mobile || '—'}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">#{s.tableNumber}</td>
                    <td className="px-4 py-3">
                      <span className={`badge text-[10px] ${STATUS_BADGE[s.status]}`}>{s.status}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">
                      {formatDate(s.startedAt)}
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-700">
                      {formatDuration(s.occupiedMs)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">{s.orderCount}</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-800">{formatCurrency(s.total)}</td>
                    <td className="px-4 py-3 text-right text-emerald-600">{s.tip > 0 ? formatCurrency(s.tip) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, accent, sub }: {
  icon: React.ComponentType<{ className?: string }>; label: string; value: string;
  accent: string; sub?: string;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${accent}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <p className="text-xs text-gray-500">{label}</p>
          <p className="text-lg font-bold text-gray-800">{value}</p>
          {sub && <p className="text-xs text-emerald-600">{sub}</p>}
        </div>
      </div>
    </div>
  );
}
