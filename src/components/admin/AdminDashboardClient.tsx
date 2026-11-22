'use client';
import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/apiClient';
import { formatCurrency } from '@/lib/utils';
import {
  ShoppingCart, Banknote, Coins, Table2, Clock, ChefHat, ConciergeBell, Star,
} from 'lucide-react';

interface Stats {
  todayOrders: number;
  todayRevenue: number;
  todayTips: number;
  activeTables: number;
  totalMenuItems: number;
  pendingOrders: number;
  preparingOrders: number;
  readyOrders: number;
  averageRating: number;
  totalReviews: number;
  topItems: { _id: string; qty: number; revenue: number }[];
}

export default function AdminDashboardClient() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data, ok } = await api<Stats>('/api/stats');
    if (ok && data) setStats(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000); // refresh every 15s
    return () => clearInterval(t);
  }, [load]);

  if (loading && !stats) {
    return <div className="text-gray-500">Loading dashboard…</div>;
  }
  if (!stats) return <div className="text-red-500">Failed to load dashboard.</div>;

  const cards = [
    { label: "Today's Orders", value: stats.todayOrders, icon: ShoppingCart, color: 'bg-sky-100 text-sky-700' },
    { label: "Today's Revenue", value: formatCurrency(stats.todayRevenue), icon: Banknote, color: 'bg-emerald-100 text-emerald-700' },
    { label: "Tips Earned", value: formatCurrency(stats.todayTips), icon: Coins, color: 'bg-amber-100 text-amber-700' },
    { label: 'Active Tables', value: stats.activeTables, icon: Table2, color: 'bg-violet-100 text-violet-700' },
    { label: 'Pending Orders', value: stats.pendingOrders, icon: Clock, color: 'bg-orange-100 text-orange-700' },
    { label: 'Preparing', value: stats.preparingOrders, icon: ChefHat, color: 'bg-rose-100 text-rose-700' },
    { label: 'Ready to Serve', value: stats.readyOrders, icon: ConciergeBell, color: 'bg-teal-100 text-teal-700' },
    { label: 'Avg Rating', value: `${stats.averageRating} ★ (${stats.totalReviews})`, icon: Star, color: 'bg-yellow-100 text-yellow-700' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Dashboard</h1>
        <p className="text-sm text-gray-500">Live overview of today&apos;s restaurant activity · auto-refreshes every 15s</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="card p-4 flex items-center gap-3">
            <div className={`w-11 h-11 rounded-lg flex items-center justify-center ${c.color}`}>
              <c.icon className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-gray-500">{c.label}</p>
              <p className="text-lg font-semibold text-gray-800">{c.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="card p-5">
        <h2 className="font-semibold text-gray-800 mb-3">Top Selling Items (last 30 days)</h2>
        {stats.topItems.length === 0 ? (
          <p className="text-sm text-gray-500">No sales yet.</p>
        ) : (
          <div className="space-y-2">
            {stats.topItems.map((it, i) => (
              <div key={it._id} className="flex items-center justify-between py-2 border-b last:border-0">
                <div className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-full bg-brand-100 text-brand-700 text-xs flex items-center justify-center font-semibold">
                    {i + 1}
                  </span>
                  <span className="font-medium text-gray-800">{it._id}</span>
                </div>
                <div className="text-sm text-gray-600">
                  {it.qty} sold · <span className="font-medium">{formatCurrency(it.revenue)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
