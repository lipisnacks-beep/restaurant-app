'use client';
import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/apiClient';
import { toast } from 'sonner';
import { timeAgo, formatCurrency } from '@/lib/utils';
import { ConciergeBell, CheckCircle2, Loader2, LogOut, Bell, Coins, Table2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface OrderItem { name: string; quantity: number; price: number; note?: string }
interface Order {
  _id: string; orderNumber: string; tableNumber: number;
  items: OrderItem[]; status: string; createdAt: string; readyAt?: string;
  servedAt?: string; customerName?: string; tip?: number; total?: number; paymentStatus?: string;
}
interface OccupiedTable {
  _id: string; number: number; name: string;
  currentSession?: {
    sessionId: string; startedAt: string; customerName?: string;
    customerMobile?: string; sessionStatus?: 'active' | 'paid' | 'completed' | 'closed';
  } | null;
}

export default function StaffPortalClient() {
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [tables, setTables] = useState<OccupiedTable[]>([]);
  const [tipsToday, setTipsToday] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [ordersRes, tablesRes] = await Promise.all([
      api<{ orders: Order[] }>('/api/orders?role=staff&limit=50'),
      api<{ tables: OccupiedTable[] }>('/api/tables'),
    ]);
    if (ordersRes.ok && ordersRes.data) {
      setOrders(ordersRes.data.orders);
      const todayTips = ordersRes.data.orders
        .filter((o) => o.tip && o.tip > 0)
        .reduce((s, o) => s + (o.tip || 0), 0);
      setTipsToday(todayTips);
    }
    if (tablesRes.ok && tablesRes.data) {
      // Tables that are occupied (have a currentSession).
      setTables(tablesRes.data.tables.filter((t) => t.currentSession?.sessionId));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  async function action(o: Order, action: 'serve' | 'complete') {
    setBusy(o._id);
    const { error, ok } = await api(`/api/orders/${o._id}`, { method: 'PATCH', body: JSON.stringify({ action }) });
    setBusy(null);
    if (!ok) { toast.error(error || 'Failed'); return; }
    toast.success(action === 'serve' ? 'Marked as served' : 'Order completed');
    load();
  }

  async function freeTable(t: OccupiedTable) {
    const status = t.currentSession?.sessionStatus;
    const confirmMsg = status === 'completed'
      ? `Free Table ${t.number}? The customer has finished dining.`
      : `Free Table ${t.number}? The customer's session is still '${status}'. Only do this if they have left.`;
    if (!confirm(confirmMsg)) return;
    setBusy(t._id);
    const { error, ok } = await api(`/api/tables/${t._id}/free`, { method: 'POST' });
    setBusy(null);
    if (!ok) { toast.error(error || 'Failed'); return; }
    toast.success(`Table ${t.number} is now free for the next guest`);
    load();
  }

  const ready = orders.filter((o) => o.status === 'ready');
  const served = orders.filter((o) => o.status === 'served');
  // Tables ready to be freed (customer review done = sessionStatus 'completed').
  const tablesToFree = tables.filter((t) => t.currentSession?.sessionStatus === 'completed');
  const tablesOccupied = tables.filter((t) => t.currentSession?.sessionStatus !== 'completed');

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-gray-50">
      <header className="bg-gradient-to-r from-emerald-600 to-emerald-700 text-white sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ConciergeBell className="w-6 h-6" />
            <div>
              <h1 className="font-semibold leading-none">Staff Portal</h1>
              <p className="text-xs text-emerald-100">Service &amp; delivery queue</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="badge bg-white/20 text-white">
              <Bell className="w-3 h-3 mr-1" /> {ready.length} ready
            </span>
            <span className="badge bg-amber-400/30 text-amber-50">
              <Coins className="w-3 h-3 mr-1" /> {formatCurrency(tipsToday)} tips
            </span>
            <button onClick={() => { api('/api/auth/logout', { method: 'POST', body: JSON.stringify({ scope: 'staff' }) }); router.push('/'); }} className="btn-ghost text-white hover:bg-white/10">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {loading ? (
          <div className="text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
        ) : (
          <div className="space-y-8">
            {/* Ready to serve */}
            <section>
              <h2 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                <Bell className="w-4 h-4 text-teal-500" /> Ready to Serve ({ready.length})
              </h2>
              <div className="grid gap-3 lg:grid-cols-2">
                {ready.length === 0 && <p className="text-sm text-gray-400">None.</p>}
                {ready.map((o) => (
                  <DeliveryCard key={o._id} order={o} accent="border-l-teal-500">
                    <button onClick={() => action(o, 'serve')} disabled={busy === o._id} className="btn bg-emerald-600 text-white hover:bg-emerald-700 w-full">
                      {busy === o._id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      Mark Served
                    </button>
                  </DeliveryCard>
                ))}
              </div>
            </section>

            {/* Awaiting payment */}
            <section>
              <h2 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                <ConciergeBell className="w-4 h-4 text-sky-500" /> Awaiting Payment ({served.length})
              </h2>
              <div className="grid gap-3 lg:grid-cols-2">
                {served.length === 0 && <p className="text-sm text-gray-400">None.</p>}
                {served.map((o) => (
                  <DeliveryCard key={o._id} order={o} accent="border-l-sky-500">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">Bill: <strong className="text-gray-800">{formatCurrency(o.total || 0)}</strong></span>
                      <span className={`badge ${o.paymentStatus === 'paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        {o.paymentStatus || 'unpaid'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      The customer pays from their phone (cash / UPI / card). Once paid, tap Complete.
                    </p>
                    <button onClick={() => action(o, 'complete')} disabled={busy === o._id} className="btn-secondary w-full mt-2">
                      {busy === o._id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      Complete Order
                    </button>
                  </DeliveryCard>
                ))}
              </div>
            </section>

            {/* Tables to free (customer review done) */}
            {tablesToFree.length > 0 && (
              <section>
                <h2 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                  <Table2 className="w-4 h-4 text-emerald-500" /> Ready to Free ({tablesToFree.length})
                </h2>
                <p className="text-xs text-gray-500 mb-3">
                  These customers have paid &amp; reviewed. Confirm the table is clear, then free it for the next guest.
                </p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {tablesToFree.map((t) => (
                    <TableCard key={t._id} table={t} busy={busy === t._id} onFree={() => freeTable(t)} highlight />
                  ))}
                </div>
              </section>
            )}

            {/* Occupied tables */}
            {tablesOccupied.length > 0 && (
              <section>
                <h2 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                  <Table2 className="w-4 h-4 text-amber-500" /> Occupied Tables ({tablesOccupied.length})
                </h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {tablesOccupied.map((t) => (
                    <TableCard key={t._id} table={t} busy={busy === t._id} onFree={() => freeTable(t)} />
                  ))}
                </div>
              </section>
            )}

            {orders.length === 0 && tables.length === 0 && (
              <div className="card p-12 text-center">
                <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-500 mb-3" />
                <h2 className="text-lg font-semibold text-gray-800">Nothing to deliver</h2>
                <p className="text-sm text-gray-500">Orders the chef marks ready will appear here automatically.</p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function TableCard({ table, busy, onFree, highlight }: {
  table: OccupiedTable; busy: boolean; onFree: () => void; highlight?: boolean;
}) {
  const cs = table.currentSession;
  const status = cs?.sessionStatus || 'active';
  const statusLabel = { active: 'Dining', paid: 'Paid — pending review', completed: 'Ready to free', closed: 'Closed' }[status] || status;
  return (
    <div className={`card p-4 border-l-4 ${highlight ? 'border-l-emerald-500' : 'border-l-amber-400'}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="font-semibold text-gray-800">{table.name}</p>
          <p className="text-xs text-gray-500">{cs?.customerName || 'Guest'}</p>
        </div>
        <span className={`badge text-[10px] ${
          status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
          status === 'paid' ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-700'
        }`}>
          {statusLabel}
        </span>
      </div>
      <p className="text-xs text-gray-400 mt-2">
        Seated {cs?.startedAt ? timeAgo(cs.startedAt) : '—'}
      </p>
      <button onClick={onFree} disabled={busy} className={`w-full mt-3 ${highlight ? 'btn bg-emerald-600 text-white hover:bg-emerald-700' : 'btn-secondary'}`}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
        Free Table
      </button>
    </div>
  );
}

function DeliveryCard({ order, accent, children }: { order: Order; accent: string; children: React.ReactNode }) {
  return (
    <div className={`card p-4 border-l-4 ${accent}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-gray-800">{order.orderNumber}</p>
          <p className="text-sm text-gray-600">Table {order.tableNumber}{order.customerName ? ` · ${order.customerName}` : ''}</p>
        </div>
        <span className="text-xs text-gray-400">{timeAgo(order.readyAt || order.createdAt)}</span>
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
      <div className="mt-3">{children}</div>
    </div>
  );
}
