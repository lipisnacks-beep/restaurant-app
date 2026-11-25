'use client';
import { useEffect, useState, useCallback } from 'react';
import { api, getTabToken } from '@/lib/apiClient';
import { formatCurrency, formatDate } from '@/lib/utils';
import { toast } from 'sonner';
import {
  ShoppingCart, Plus, Pencil, Trash2, Loader2, Search, X, ChevronDown, ChevronRight,
} from 'lucide-react';
import {
  PURCHASE_CATEGORIES, PAYMENT_METHODS_PURCHASE, type PurchaseItem, type PurchaseLineItem,
} from '@/lib/reports.types';

interface ListResp {
  items: PurchaseItem[];
  total: number;
  page: number;
  limit: number;
  grandTotal: number;
}

const today = () => new Date().toISOString().slice(0, 10);
const emptyLine = (): PurchaseLineItem => ({ name: '', quantity: 1, unit: 'pcs', rate: 0, amount: 0 });
const emptyForm = () => ({
  date: today(), category: 'raw-material' as string,
  supplier: '', invoiceNumber: '',
  items: [emptyLine()],
  taxAmount: '', discount: '',
  paymentMethod: 'cash' as string, paymentStatus: 'paid' as string,
  amountPaid: '', note: '',
});

export default function AdminPurchasesClient() {
  const [items, setItems] = useState<PurchaseItem[]>([]);
  const [grandTotal, setGrandTotal] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const limit = 20;
  const [expanded, setExpanded] = useState<string | null>(null);

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
    const { data, ok } = await api<ListResp>(`/api/purchases?${params.toString()}`);
    if (ok && data) {
      setItems(data.items);
      setGrandTotal(data.grandTotal);
      setTotal(data.total);
    }
    setLoading(false);
  }, [filters, page]);

  useEffect(() => { load(); }, [load]);

  // recompute line amounts + totals in form
  function recompute(f: typeof form) {
    const items = f.items.map((it) => ({ ...it, amount: (Number(it.quantity) || 0) * (Number(it.rate) || 0) }));
    const subtotal = items.reduce((s, it) => s + it.amount, 0);
    const total = Math.max(0, subtotal + (Number(f.taxAmount) || 0) - (Number(f.discount) || 0));
    return { ...f, items, subtotal, total };
  }
  const computed = recompute(form);

  function openAdd() {
    setForm(emptyForm());
    setEditingId(null);
    setShowForm(true);
  }
  function openEdit(it: PurchaseItem) {
    setForm({
      date: new Date(it.date).toISOString().slice(0, 10),
      category: it.category, supplier: it.supplier || '', invoiceNumber: it.invoiceNumber || '',
      items: it.items.length ? it.items : [emptyLine()],
      taxAmount: String(it.taxAmount || ''), discount: String(it.discount || ''),
      paymentMethod: it.paymentMethod, paymentStatus: it.paymentStatus,
      amountPaid: String(it.amountPaid || ''), note: it.note || '',
    });
    setEditingId(it._id);
    setShowForm(true);
  }

  async function save() {
    const validItems = computed.items.filter((it) => it.name.trim() && it.quantity > 0);
    if (!form.date || !form.category) { toast.error('Date and category are required'); return; }
    if (validItems.length === 0) { toast.error('At least one valid item is required'); return; }
    setSaving(true);
    const body = {
      date: form.date, category: form.category, supplier: form.supplier, invoiceNumber: form.invoiceNumber,
      items: validItems.map((it) => ({ name: it.name, quantity: Number(it.quantity), unit: it.unit, rate: Number(it.rate) })),
      taxAmount: Number(form.taxAmount) || 0, discount: Number(form.discount) || 0,
      paymentMethod: form.paymentMethod, paymentStatus: form.paymentStatus,
      amountPaid: form.amountPaid ? Number(form.amountPaid) : (form.paymentStatus === 'paid' ? computed.total : 0),
      note: form.note,
    };
    const { ok, error } = editingId
      ? await api(`/api/purchases/${editingId}`, { method: 'PUT', body: JSON.stringify(body) })
      : await api('/api/purchases', { method: 'POST', body: JSON.stringify(body) });
    setSaving(false);
    if (ok) {
      toast.success(editingId ? 'Purchase updated' : 'Purchase recorded');
      setShowForm(false);
      load();
    } else toast.error(error || 'Save failed');
  }

  async function remove(id: string) {
    const { ok, error } = await api(`/api/purchases/${id}`, { method: 'DELETE' });
    if (ok) { toast.success('Purchase deleted'); setConfirmDel(null); load(); }
    else toast.error(error || 'Delete failed');
  }

  async function exportCsv() {
    const params = new URLSearchParams();
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    const token = getTabToken();
    const res = await fetch(`/api/purchases?${params.toString()}&limit=500`, {
      credentials: 'include', headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const data = await res.json();
    const rows = [['Date','Category','Supplier','Invoice','Items','Subtotal','Tax','Discount','Total','Payment','Status','Paid']];
    (data.items || []).forEach((it: PurchaseItem) => rows.push([
      new Date(it.date).toISOString().slice(0,10), it.category, it.supplier || '', it.invoiceNumber || '',
      String(it.items.length), String(it.subtotal), String(it.taxAmount), String(it.discount),
      String(it.total), it.paymentMethod, it.paymentStatus, String(it.amountPaid),
    ]));
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `purchases_${today()}.csv`;
    a.click();
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <ShoppingCart className="w-6 h-6 text-amber-600" /> Purchases
          </h1>
          <p className="text-sm text-gray-500">Record inventory &amp; supply purchases with itemised line items, tax and discount.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportCsv} className="btn-secondary text-sm">Export CSV</button>
          <button onClick={openAdd} className="btn-primary text-sm"><Plus className="w-4 h-4" /> Add Purchase</button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card p-4">
          <p className="text-xs text-gray-500">Total (filtered)</p>
          <p className="text-2xl font-bold text-indigo-600">{formatCurrency(grandTotal)}</p>
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
              {PURCHASE_CATEGORIES.map((c) => <option key={c} value={c} className="capitalize">{c}</option>)}
            </select>
          </div>
          <div className="lg:col-span-2">
            <label className="block text-xs text-gray-500 mb-1">Search</label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-gray-400" />
              <input type="text" placeholder="supplier, invoice, item…" value={filters.q}
                onChange={(e) => { setFilters({ ...filters, q: e.target.value }); setPage(1); }} className="input pl-8" />
            </div>
          </div>
        </div>
        {(filters.from || filters.to || filters.category || filters.q) && (
          <button onClick={() => { setFilters({ from: '', to: '', category: '', q: '' }); setPage(1); }}
            className="text-xs text-amber-600 mt-2 flex items-center gap-1"><X className="w-3 h-3" /> Clear filters</button>
        )}
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500 flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No purchases found. Click “Add Purchase” to record one.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-gray-600 text-left">
                <tr>
                  <th className="px-4 py-2.5 font-medium w-8"></th>
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-4 py-2.5 font-medium">Category</th>
                  <th className="px-4 py-2.5 font-medium">Supplier</th>
                  <th className="px-4 py-2.5 font-medium">Items</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium text-right">Total</th>
                  <th className="px-4 py-2.5 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((it) => (
                  <>
                    <tr key={it._id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5">
                        <button onClick={() => setExpanded(expanded === it._id ? null : it._id)} className="text-slate-400">
                          {expanded === it._id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{formatDate(it.date)}</td>
                      <td className="px-4 py-2.5"><span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-xs capitalize">{it.category}</span></td>
                      <td className="px-4 py-2.5">{it.supplier || '—'}</td>
                      <td className="px-4 py-2.5 text-gray-600">{it.items.length}</td>
                      <td className="px-4 py-2.5">
                        <span className={`px-2 py-0.5 rounded text-xs ${it.paymentStatus === 'paid' ? 'bg-green-100 text-green-700' : it.paymentStatus === 'partial' ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>{it.paymentStatus}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold text-indigo-600 whitespace-nowrap">{formatCurrency(it.total)}</td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <button onClick={() => openEdit(it)} className="p-1.5 text-slate-500 hover:text-amber-600"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => setConfirmDel(it._id)} className="p-1.5 text-slate-500 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>
                      </td>
                    </tr>
                    {expanded === it._id && (
                      <tr key={it._id + '-d'} className="bg-slate-50/60">
                        <td colSpan={8} className="px-4 py-3">
                          <div className="ml-4">
                            <table className="w-full text-xs">
                              <thead className="text-gray-500 text-left">
                                <tr><th className="py-1">Item</th><th className="py-1">Qty</th><th className="py-1">Unit</th><th className="py-1 text-right">Rate</th><th className="py-1 text-right">Amount</th></tr>
                              </thead>
                              <tbody>
                                {it.items.map((li, i) => (
                                  <tr key={i} className="border-t border-slate-200">
                                    <td className="py-1">{li.name}</td><td className="py-1">{li.quantity}</td><td className="py-1">{li.unit}</td>
                                    <td className="py-1 text-right">{formatCurrency(li.rate)}</td><td className="py-1 text-right">{formatCurrency(li.amount)}</td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot className="text-gray-600">
                                <tr className="border-t border-slate-200"><td colSpan={4} className="py-1 text-right">Subtotal</td><td className="py-1 text-right">{formatCurrency(it.subtotal)}</td></tr>
                                {it.taxAmount > 0 && <tr><td colSpan={4} className="py-1 text-right">Tax</td><td className="py-1 text-right">{formatCurrency(it.taxAmount)}</td></tr>}
                                {it.discount > 0 && <tr><td colSpan={4} className="py-1 text-right">Discount</td><td className="py-1 text-right">−{formatCurrency(it.discount)}</td></tr>}
                                <tr className="font-semibold"><td colSpan={4} className="py-1 text-right">Total</td><td className="py-1 text-right">{formatCurrency(it.total)}</td></tr>
                                <tr><td colSpan={4} className="py-1 text-right">Paid ({it.paymentMethod})</td><td className="py-1 text-right">{formatCurrency(it.amountPaid)}</td></tr>
                              </tfoot>
                            </table>
                            {it.invoiceNumber && <p className="text-xs text-gray-500 mt-2">Invoice: {it.invoiceNumber}</p>}
                            {it.note && <p className="text-xs text-gray-500 mt-1">Note: {it.note}</p>}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
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

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b sticky top-0 bg-white">
              <h2 className="font-bold text-gray-800">{editingId ? 'Edit Purchase' : 'Add Purchase'}</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Date *</label>
                  <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="input" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Category *</label>
                  <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="input capitalize">
                    {PURCHASE_CATEGORIES.map((c) => <option key={c} value={c} className="capitalize">{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Supplier</label>
                  <input type="text" value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} className="input" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Invoice #</label>
                  <input type="text" value={form.invoiceNumber} onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })} className="input" />
                </div>
              </div>

              {/* Line items */}
              <div className="border border-slate-200 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Items</span>
                  <button onClick={() => setForm({ ...form, items: [...form.items, emptyLine()] })} className="text-xs text-amber-600 flex items-center gap-1"><Plus className="w-3 h-3" /> Add line</button>
                </div>
                <div className="space-y-2">
                  {form.items.map((it, i) => (
                    <div key={i} className="grid grid-cols-12 gap-1.5 items-center">
                      <input type="text" placeholder="Item name" value={it.name}
                        onChange={(e) => { const items = [...form.items]; items[i] = { ...it, name: e.target.value }; setForm({ ...form, items }); }}
                        className="input col-span-5 text-sm" />
                      <input type="number" step="any" placeholder="Qty" value={it.quantity}
                        onChange={(e) => { const items = [...form.items]; items[i] = { ...it, quantity: Number(e.target.value) }; setForm({ ...form, items }); }}
                        className="input col-span-2 text-sm" />
                      <input type="text" placeholder="unit" value={it.unit}
                        onChange={(e) => { const items = [...form.items]; items[i] = { ...it, unit: e.target.value }; setForm({ ...form, items }); }}
                        className="input col-span-2 text-sm" />
                      <input type="number" step="any" placeholder="Rate" value={it.rate}
                        onChange={(e) => { const items = [...form.items]; items[i] = { ...it, rate: Number(e.target.value) }; setForm({ ...form, items }); }}
                        className="input col-span-2 text-sm" />
                      <button onClick={() => setForm({ ...form, items: form.items.filter((_, j) => j !== i) })}
                        className="col-span-1 text-rose-500 hover:text-rose-700 flex justify-center"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Tax</label>
                  <input type="number" step="0.01" value={form.taxAmount} onChange={(e) => setForm({ ...form, taxAmount: e.target.value })} className="input" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Discount</label>
                  <input type="number" step="0.01" value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value })} className="input" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Payment</label>
                  <select value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })} className="input capitalize">
                    {PAYMENT_METHODS_PURCHASE.map((m) => <option key={m} value={m} className="capitalize">{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Status</label>
                  <select value={form.paymentStatus} onChange={(e) => setForm({ ...form, paymentStatus: e.target.value })} className="input capitalize">
                    <option value="paid">paid</option><option value="partial">partial</option><option value="unpaid">unpaid</option>
                  </select>
                </div>
              </div>
              {form.paymentStatus !== 'paid' && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Amount Paid</label>
                  <input type="number" step="0.01" value={form.amountPaid} onChange={(e) => setForm({ ...form, amountPaid: e.target.value })} className="input" />
                </div>
              )}
              <div>
                <label className="block text-xs text-gray-500 mb-1">Note</label>
                <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={2} className="input" />
              </div>

              {/* Totals preview */}
              <div className="bg-slate-50 rounded-lg p-3 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>{formatCurrency(computed.subtotal)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Tax</span><span>{formatCurrency(Number(form.taxAmount) || 0)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Discount</span><span>−{formatCurrency(Number(form.discount) || 0)}</span></div>
                <div className="flex justify-between font-bold text-base border-t border-slate-200 pt-1"><span>Total</span><span>{formatCurrency(computed.total)}</span></div>
              </div>
            </div>
            <div className="flex justify-end gap-2 p-4 border-t sticky bottom-0 bg-white">
              <button onClick={() => setShowForm(false)} className="btn-secondary text-sm">Cancel</button>
              <button onClick={save} disabled={saving} className="btn-primary text-sm">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {editingId ? 'Update' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDel && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setConfirmDel(null)}>
          <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-gray-800 mb-2">Delete this purchase?</h3>
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
