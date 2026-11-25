'use client';
import { useEffect, useState, useCallback } from 'react';
import { api, getTabToken } from '@/lib/apiClient';
import { formatCurrency, formatDate } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Wallet, Plus, Pencil, Trash2, Loader2, RefreshCw, Search, X,
} from 'lucide-react';
import {
  EXPENSE_CATEGORIES, PAYMENT_METHODS_EXPENSE, type ExpenseItem,
} from '@/lib/reports.types';

interface ListResp {
  items: ExpenseItem[];
  total: number;
  page: number;
  limit: number;
  grandTotal: number;
}

const today = () => new Date().toISOString().slice(0, 10);
const emptyForm = () => ({
  date: today(), category: 'utilities' as string,
  description: '', amount: '', paymentMethod: 'cash' as string,
  vendor: '', invoiceNumber: '', note: '',
});

export default function AdminExpensesClient() {
  const [items, setItems] = useState<ExpenseItem[]>([]);
  const [grandTotal, setGrandTotal] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const limit = 20;

  const [filters, setFilters] = useState({ from: '', to: '', category: '', q: '' });
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    if (filters.category) params.set('category', filters.category);
    if (filters.q) params.set('q', filters.q);
    params.set('page', String(page));
    params.set('limit', String(limit));
    const { data, ok, error, status } = await api<ListResp>(`/api/expenses?${params.toString()}`);
    if (ok && data) {
      setItems(data.items);
      setGrandTotal(data.grandTotal);
      setTotal(data.total);
    } else {
      // Distinguish a real auth/load failure from genuinely empty data, so the
      // page never silently shows "No expenses found" when the real problem is
      // an expired session or a server error.
      setItems([]);
      setGrandTotal(0);
      setTotal(0);
      if (status === 401) {
        toast.error('Your session has expired — please sign in again.');
      } else if (status === 503) {
        toast.error('Database is not configured on the server. Ask an admin to set MONGODB_URI, then reload.');
      } else if (error) {
        toast.error(`Could not load expenses: ${error}`);
      }
    }
    setLoading(false);
  }, [filters, page]);

  useEffect(() => { load(); }, [load]);

  function openAdd() {
    setForm(emptyForm());
    setEditingId(null);
    setShowForm(true);
  }
  function openEdit(it: ExpenseItem) {
    setForm({
      date: new Date(it.date).toISOString().slice(0, 10),
      category: it.category,
      description: it.description,
      amount: String(it.amount),
      paymentMethod: it.paymentMethod,
      vendor: it.vendor || '',
      invoiceNumber: it.invoiceNumber || '',
      note: it.note || '',
    });
    setEditingId(it._id);
    setShowForm(true);
  }

  async function save() {
    if (!form.date || !form.category || !form.description.trim() || !form.amount) {
      toast.error('Date, category, description and amount are required');
      return;
    }
    setSaving(true);
    const body = {
      date: form.date, category: form.category, description: form.description.trim(),
      amount: Number(form.amount), paymentMethod: form.paymentMethod,
      vendor: form.vendor, invoiceNumber: form.invoiceNumber, note: form.note,
    };
    const { ok, error } = editingId
      ? await api(`/api/expenses/${editingId}`, { method: 'PUT', body: JSON.stringify(body) })
      : await api('/api/expenses', { method: 'POST', body: JSON.stringify(body) });
    setSaving(false);
    if (ok) {
      toast.success(editingId ? 'Expense updated' : 'Expense recorded');
      setShowForm(false);
      load();
    } else toast.error(error || 'Save failed');
  }

  async function remove(id: string) {
    const { ok, error } = await api(`/api/expenses/${id}`, { method: 'DELETE' });
    if (ok) { toast.success('Expense deleted'); setConfirmDel(null); load(); }
    else toast.error(error || 'Delete failed');
  }

  async function exportCsv() {
    const params = new URLSearchParams();
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    const token = getTabToken();
    const res = await fetch(`/api/expenses?${params.toString()}&limit=500`, {
      credentials: 'include', headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const data = await res.json();
    const rows = [['Date','Category','Description','Amount','Payment','Vendor','Invoice','Note']];
    (data.items || []).forEach((it: ExpenseItem) => rows.push([
      new Date(it.date).toISOString().slice(0,10), it.category, it.description, String(it.amount),
      it.paymentMethod, it.vendor || '', it.invoiceNumber || '', it.note || '',
    ]));
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `expenses_${today()}.csv`;
    a.click();
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Wallet className="w-6 h-6 text-amber-600" /> Expenses
          </h1>
          <p className="text-sm text-gray-500">Record and track all restaurant/cafe expenses (rent, utilities, salaries, supplies…).</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportCsv} className="btn-secondary text-sm">Export CSV</button>
          <button onClick={openAdd} className="btn-primary text-sm">
            <Plus className="w-4 h-4" /> Add Expense
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card p-4">
          <p className="text-xs text-gray-500">Total (filtered)</p>
          <p className="text-2xl font-bold text-rose-600">{formatCurrency(grandTotal)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500">Records</p>
          <p className="text-2xl font-bold text-gray-800">{total}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500">Current page</p>
          <p className="text-2xl font-bold text-gray-800">{page} / {totalPages}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="block text-xs text-gray-500 mb-1">From</label>
            <input type="date" value={filters.from} onChange={(e) => { setFilters({ ...filters, from: e.target.value }); setPage(1); }} className="input" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">To</label>
            <input type="date" value={filters.to} onChange={(e) => { setFilters({ ...filters, to: e.target.value }); setPage(1); }} className="input" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Category</label>
            <select value={filters.category} onChange={(e) => { setFilters({ ...filters, category: e.target.value }); setPage(1); }} className="input">
              <option value="">All</option>
              {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c} className="capitalize">{c}</option>)}
            </select>
          </div>
          <div className="lg:col-span-2">
            <label className="block text-xs text-gray-500 mb-1">Search</label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-gray-400" />
              <input type="text" placeholder="description, vendor, invoice…" value={filters.q}
                onChange={(e) => { setFilters({ ...filters, q: e.target.value }); setPage(1); }}
                className="input pl-8" />
            </div>
          </div>
        </div>
        {(filters.from || filters.to || filters.category || filters.q) && (
          <button onClick={() => { setFilters({ from: '', to: '', category: '', q: '' }); setPage(1); }}
            className="text-xs text-amber-600 mt-2 flex items-center gap-1"><X className="w-3 h-3" /> Clear filters</button>
        )}
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500 flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No expenses found. Click “Add Expense” to record one.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-gray-600 text-left">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-4 py-2.5 font-medium">Category</th>
                  <th className="px-4 py-2.5 font-medium">Description</th>
                  <th className="px-4 py-2.5 font-medium">Vendor</th>
                  <th className="px-4 py-2.5 font-medium">Pay</th>
                  <th className="px-4 py-2.5 font-medium text-right">Amount</th>
                  <th className="px-4 py-2.5 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((it) => (
                  <tr key={it._id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 whitespace-nowrap">{formatDate(it.date)}</td>
                    <td className="px-4 py-2.5"><span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-xs capitalize">{it.category}</span></td>
                    <td className="px-4 py-2.5">{it.description}</td>
                    <td className="px-4 py-2.5 text-gray-600">{it.vendor || '—'}</td>
                    <td className="px-4 py-2.5 text-gray-600 capitalize">{it.paymentMethod}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-rose-600 whitespace-nowrap">{formatCurrency(it.amount)}</td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <button onClick={() => openEdit(it)} className="p-1.5 text-slate-500 hover:text-amber-600"><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => setConfirmDel(it._id)} className="p-1.5 text-slate-500 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && total > limit && (
          <div className="flex items-center justify-between p-3 border-t border-slate-100 text-sm">
            <span className="text-gray-500">Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}</span>
            <div className="flex gap-1">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="btn-secondary text-xs disabled:opacity-40">Prev</button>
              <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="btn-secondary text-xs disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </div>

      {/* Add/Edit modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="font-bold text-gray-800">{editingId ? 'Edit Expense' : 'Add Expense'}</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Date *</label>
                  <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="input" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Category *</label>
                  <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="input capitalize">
                    {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c} className="capitalize">{c}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Description *</label>
                <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="e.g. November electricity bill" className="input" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Amount *</label>
                  <input type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="input" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Payment Method</label>
                  <select value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })} className="input capitalize">
                    {PAYMENT_METHODS_EXPENSE.map((m) => <option key={m} value={m} className="capitalize">{m}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Vendor</label>
                  <input type="text" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} placeholder="e.g. BSES Yamuna" className="input" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Invoice #</label>
                  <input type="text" value={form.invoiceNumber} onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })} className="input" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Note</label>
                <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={2} className="input" />
              </div>
            </div>
            <div className="flex justify-end gap-2 p-4 border-t">
              <button onClick={() => setShowForm(false)} className="btn-secondary text-sm">Cancel</button>
              <button onClick={save} disabled={saving} className="btn-primary text-sm">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {editingId ? 'Update' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDel && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setConfirmDel(null)}>
          <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-gray-800 mb-2">Delete this expense?</h3>
            <p className="text-sm text-gray-500 mb-4">This action cannot be undone.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDel(null)} className="btn-secondary text-sm">Cancel</button>
              <button onClick={() => remove(confirmDel)} className="btn-primary text-sm bg-rose-600">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
