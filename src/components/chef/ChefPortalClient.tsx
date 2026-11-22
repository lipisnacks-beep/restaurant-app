'use client';
import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/apiClient';
import { toast } from 'sonner';
import { timeAgo } from '@/lib/utils';
import { ChefHat, Flame, CheckCircle2, Loader2, Clock, LogOut, Bell } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface OrderItem { name: string; quantity: number; note?: string; price: number }
interface Order {
  _id: string; orderNumber: string; tableNumber: number;
  items: OrderItem[]; status: string; createdAt: string; customerName?: string; notes?: string;
}

export default function ChefPortalClient() {
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, ok } = await api<{ orders: Order[] }>('/api/orders?role=chef');
    if (ok && data) {
      // play a soft beep when a new pending order arrives
      if (data.orders.length > orders.length && orders.length >= 0) {
        // No external sound file; use the WebAudio API to beep in the browser.
        try {
          const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain); gain.connect(ctx.destination);
          osc.frequency.value = 880;
          gain.gain.setValueAtTime(0.05, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
          osc.start(); osc.stop(ctx.currentTime + 0.4);
        } catch { /* ignore audio errors */ }
      }
      setOrders(data.orders);
    }
    setLoading(false);
  }, [orders.length]);

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  async function action(o: Order, action: 'start_preparing' | 'mark_ready') {
    setBusy(o._id);
    const { error, ok } = await api(`/api/orders/${o._id}`, { method: 'PATCH', body: JSON.stringify({ action }) });
    setBusy(null);
    if (!ok) { toast.error(error || 'Failed'); return; }
    toast.success(action === 'start_preparing' ? 'Started cooking' : 'Marked ready');
    load();
  }

  const pending = orders.filter((o) => o.status === 'pending');
  const preparing = orders.filter((o) => o.status === 'preparing');

  return (
    <div className="min-h-screen bg-gradient-to-br from-rose-50 to-gray-50">
      <header className="bg-gradient-to-r from-rose-600 to-rose-700 text-white sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ChefHat className="w-6 h-6" />
            <div>
              <h1 className="font-semibold leading-none">Chef Portal</h1>
              <p className="text-xs text-rose-100">Live order kitchen display</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="badge bg-white/20 text-white">
              <Bell className="w-3 h-3 mr-1" /> {pending.length} new
            </span>
            <button onClick={() => { api('/api/auth/logout', { method: 'POST', body: JSON.stringify({ scope: 'chef' }) }); router.push('/'); }} className="btn-ghost text-white hover:bg-white/10">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {loading ? (
          <div className="text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading orders…</div>
        ) : orders.length === 0 ? (
          <div className="card p-12 text-center">
            <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-500 mb-3" />
            <h2 className="text-lg font-semibold text-gray-800">All caught up!</h2>
            <p className="text-sm text-gray-500">No active orders right now. New orders will appear here automatically.</p>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            <section>
              <h2 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                <Clock className="w-4 h-4 text-orange-500" /> New Orders ({pending.length})
              </h2>
              <div className="space-y-3">
                {pending.length === 0 && <p className="text-sm text-gray-400">None.</p>}
                {pending.map((o) => (
                  <OrderCard key={o._id} order={o} accent="border-l-orange-500">
                    <button onClick={() => action(o, 'start_preparing')} disabled={busy === o._id} className="btn-primary w-full">
                      {busy === o._id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Flame className="w-4 h-4" />}
                      Start Cooking
                    </button>
                  </OrderCard>
                ))}
              </div>
            </section>

            <section>
              <h2 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                <Flame className="w-4 h-4 text-rose-500" /> Preparing ({preparing.length})
              </h2>
              <div className="space-y-3">
                {preparing.length === 0 && <p className="text-sm text-gray-400">None.</p>}
                {preparing.map((o) => (
                  <OrderCard key={o._id} order={o} accent="border-l-rose-500">
                    <button onClick={() => action(o, 'mark_ready')} disabled={busy === o._id} className="btn bg-emerald-600 text-white hover:bg-emerald-700 w-full">
                      {busy === o._id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      Mark Ready
                    </button>
                  </OrderCard>
                ))}
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

function OrderCard({ order, accent, children }: { order: Order; accent: string; children: React.ReactNode }) {
  return (
    <div className={`card p-4 border-l-4 ${accent}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-gray-800">{order.orderNumber}</p>
          <p className="text-sm text-gray-600">Table {order.tableNumber}{order.customerName ? ` · ${order.customerName}` : ''}</p>
        </div>
        <span className="text-xs text-gray-400">{timeAgo(order.createdAt)}</span>
      </div>
      <ul className="mt-3 space-y-1.5">
        {order.items.map((i, idx) => (
          <li key={idx} className="text-sm flex items-start gap-2">
            <span className="badge bg-brand-100 text-brand-700 shrink-0">{i.quantity}×</span>
            <div>
              <span className="font-medium text-gray-800">{i.name}</span>
              {i.note && <p className="text-xs text-orange-600">⚠ {i.note}</p>}
            </div>
          </li>
        ))}
      </ul>
      {order.notes && <p className="mt-2 text-xs text-gray-500 italic">Order note: {order.notes}</p>}
      <div className="mt-3">{children}</div>
    </div>
  );
}
