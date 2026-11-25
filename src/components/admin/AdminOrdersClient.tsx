'use client';
import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/apiClient';
import { toast } from 'sonner';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Loader2, RefreshCw } from 'lucide-react';

interface OrderItem { name: string; price: number; quantity: number; note?: string }
interface Order {
  _id: string; orderNumber: string; tableNumber: number;
  items: OrderItem[]; subtotal: number; taxAmount: number;
  serviceChargeAmount: number; tip: number; total: number;
  status: string; paymentMethod?: string; paymentStatus: string;
  customerName?: string; createdAt: string; rating?: number;
}

const STATUSES = ['pending', 'preparing', 'ready', 'served', 'completed', 'cancelled'];
const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-orange-100 text-orange-700',
  preparing: 'bg-rose-100 text-rose-700',
  ready: 'bg-teal-100 text-teal-700',
  served: 'bg-sky-100 text-sky-700',
  completed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-gray-200 text-gray-600',
};

export default function AdminOrdersClient() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('');

  const load = useCallback(async () => {
    // Always send role=admin so the server applies the IST "today" window even
    // when a status filter is also set. Previously a status chip bypassed the
    // date filter and returned ALL-TIME orders under a "Today's orders" header.
    const url = `/api/orders?role=admin&limit=200${filter ? `&status=${filter}` : ''}`;
    const { data, ok } = await api<{ orders: Order[] }>(url);
    if (ok && data) setOrders(data.orders);
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(load, 10000); return () => clearInterval(t); }, [load]);

  async function cancel(o: Order) {
    if (!confirm(`Cancel ${o.orderNumber}?`)) return;
    const { error, ok } = await api(`/api/orders/${o._id}`, {
      method: 'PATCH', body: JSON.stringify({ action: 'cancel' }),
    });
    if (!ok) { toast.error(error || 'Failed'); return; }
    toast.success('Order cancelled');
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Orders</h1>
          <p className="text-sm text-gray-500">Today&apos;s orders across all tables · auto-refresh 10s</p>
        </div>
        <button onClick={load} className="btn-secondary text-sm">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setFilter('')} className={`badge cursor-pointer px-3 py-1 ${filter === '' ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-700'}`}>All</button>
        {STATUSES.map((s) => (
          <button key={s} onClick={() => setFilter(s)} className={`badge cursor-pointer px-3 py-1 capitalize ${filter === s ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-700'}`}>{s}</button>
        ))}
      </div>

      {loading ? (
        <div className="text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : orders.length === 0 ? (
        <div className="card p-8 text-center text-gray-500">No orders found.</div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-left p-3">Order</th>
                  <th className="text-left p-3">Table</th>
                  <th className="text-left p-3">Items</th>
                  <th className="text-right p-3">Total</th>
                  <th className="text-left p-3">Payment</th>
                  <th className="text-left p-3">Status</th>
                  <th className="text-left p-3">Time</th>
                  <th className="text-right p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o._id} className="border-t hover:bg-gray-50">
                    <td className="p-3">
                      <p className="font-medium text-gray-800">{o.orderNumber}</p>
                      {o.customerName && <p className="text-xs text-gray-500">{o.customerName}</p>}
                    </td>
                    <td className="p-3">{o.tableNumber != null ? `T${o.tableNumber}` : '—'}</td>
                    <td className="p-3">
                      <div className="text-xs text-gray-600">
                        {o.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}
                      </div>
                    </td>
                    <td className="p-3 text-right">
                      <p className="font-medium">{formatCurrency(o.total)}</p>
                      {o.tip > 0 && <p className="text-xs text-amber-600">+{formatCurrency(o.tip)} tip</p>}
                    </td>
                    <td className="p-3">
                      {o.paymentStatus === 'paid' ? (
                        // Show the payment METHOD (cash/upi/card) when known;
                        // fall back to '—' rather than the misleading 'paid'
                        // (which is the status, not a method).
                        <span className="badge bg-emerald-100 text-emerald-700 capitalize">{o.paymentMethod || '—'}</span>
                      ) : o.paymentStatus === 'refunded' ? (
                        <span className="badge bg-red-100 text-red-700 capitalize">refunded</span>
                      ) : (
                        <span className="badge bg-gray-100 text-gray-500 capitalize">{o.paymentStatus}</span>
                      )}
                    </td>
                    <td className="p-3">
                      <span className={`badge capitalize ${STATUS_COLORS[o.status] || 'bg-gray-100 text-gray-600'}`}>{o.status}</span>
                      {o.rating && <p className="text-xs text-amber-600 mt-1">{o.rating}★</p>}
                    </td>
                    <td className="p-3 text-xs text-gray-500 whitespace-nowrap">{formatDate(o.createdAt)}</td>
                    <td className="p-3 text-right">
                      {o.status === 'pending' && (
                        <button onClick={() => cancel(o)} className="btn-ghost text-xs text-red-600">Cancel</button>
                      )}
                    </td>
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
