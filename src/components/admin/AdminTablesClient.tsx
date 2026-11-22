'use client';
import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/apiClient';
import { toast } from 'sonner';
import { formatCurrency, timeAgo } from '@/lib/utils';
import { Plus, Trash2, QrCode, Download, Loader2, Users } from 'lucide-react';

interface TableItem {
  _id: string;
  number: number;
  name: string;
  seats: number;
  active: boolean;
  currentSession?: { sessionId: string; startedAt: string; customerName?: string } | null;
  qrUrl: string;
}

export default function AdminTablesClient() {
  const [tables, setTables] = useState<TableItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [qrTable, setQrTable] = useState<TableItem | null>(null);

  const load = useCallback(async () => {
    const { data, ok } = await api<{ tables: TableItem[] }>('/api/tables');
    if (ok && data) setTables(data.tables);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addTable() {
    setAdding(true);
    const { data, error, ok } = await api<{ table: TableItem }>('/api/tables', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    setAdding(false);
    if (!ok) { toast.error(error || 'Failed'); return; }
    toast.success(`Created ${data!.table.name}`);
    load();
  }

  async function removeTable(t: TableItem) {
    if (!confirm(`Delete ${t.name}? Existing orders are kept but the table number can be reused.`)) return;
    const { error, ok } = await api(`/api/tables/${t._id}`, { method: 'DELETE' });
    if (!ok) { toast.error(error || 'Failed'); return; }
    toast.success(`Deleted ${t.name}`);
    load();
  }

  async function toggleActive(t: TableItem) {
    const { error, ok } = await api(`/api/tables/${t._id}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: !t.active }),
    });
    if (!ok) { toast.error(error || 'Failed'); return; }
    load();
  }

  function downloadQr(t: TableItem) {
    const a = document.createElement('a');
    a.href = `/api/tables/${t._id}/qr?size=600`;
    a.download = `table-${t.number}-qr.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Tables &amp; QR Codes</h1>
          <p className="text-sm text-gray-500">Print the QR for each table — customers scan it to open the menu.</p>
        </div>
        <button onClick={addTable} disabled={adding} className="btn-primary">
          {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Add Table
        </button>
      </div>

      {loading ? (
        <div className="text-gray-500">Loading…</div>
      ) : tables.length === 0 ? (
        <div className="card p-8 text-center text-gray-500">
          No tables yet. Click <strong>Add Table</strong> to create your first one.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tables.map((t) => (
            <div key={t._id} className="card p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-gray-800">{t.name}</h3>
                  <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                    <Users className="w-3 h-3" /> {t.seats} seats
                  </p>
                </div>
                <span className={`badge ${t.active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                  {t.active ? 'Active' : 'Inactive'}
                </span>
              </div>

              {t.currentSession?.sessionId ? (
                <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 p-2 text-xs text-amber-800">
                  <p className="font-medium">Currently occupied</p>
                  <p className="opacity-80">
                    {t.currentSession.customerName ? `${t.currentSession.customerName} · ` : ''}
                    since {timeAgo(t.currentSession.startedAt)}
                  </p>
                </div>
              ) : (
                <p className="mt-3 text-xs text-gray-400">Free</p>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => setQrTable(t)} className="btn-secondary text-xs">
                  <QrCode className="w-3.5 h-3.5" /> View QR
                </button>
                <button onClick={() => downloadQr(t)} className="btn-secondary text-xs">
                  <Download className="w-3.5 h-3.5" /> PNG
                </button>
                <button onClick={() => toggleActive(t)} className="btn-ghost text-xs">
                  {t.active ? 'Disable' : 'Enable'}
                </button>
                <button onClick={() => removeTable(t)} className="btn-ghost text-xs text-red-600">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {qrTable && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setQrTable(null)}>
          <div className="card p-6 max-w-xs w-full text-center" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-800">{qrTable.name}</h3>
            <p className="text-xs text-gray-500 mb-3">Scan to open the menu</p>
            <img
              src={`/api/tables/${qrTable._id}/qr?size=400`}
              alt={`QR for ${qrTable.name}`}
              className="mx-auto w-56 h-56"
            />
            <p className="text-xs text-gray-400 mt-3 break-all">{qrTable.qrUrl}</p>
            <button onClick={() => downloadQr(qrTable)} className="btn-primary w-full mt-3">
              <Download className="w-4 h-4" /> Download PNG
            </button>
            <button onClick={() => setQrTable(null)} className="btn-ghost w-full mt-2">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
