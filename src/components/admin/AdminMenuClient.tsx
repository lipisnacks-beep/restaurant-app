'use client';
import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/apiClient';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/utils';
import { useSettings } from '@/components/ui/Brand';
import { Plus, Pencil, Trash2, Loader2, Upload, X, Leaf } from 'lucide-react';

interface MenuItem {
  _id: string;
  name: string;
  description: string;
  category: string;
  price: number;
  image: string;
  available: boolean;
  veg: boolean;
  prepTime: number;
}

const EMPTY = {
  name: '', description: '', category: 'Main', price: 0, image: '',
  available: true, veg: true, prepTime: 15,
};

export default function AdminMenuClient() {
  const { currencySymbol } = useSettings();
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [form, setForm] = useState<typeof EMPTY>({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    const { data, ok } = await api<{ items: MenuItem[] }>('/api/menu');
    if (ok && data) setItems(data.items);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function openNew() {
    setEditing(null);
    setForm({ ...EMPTY });
  }
  function openEdit(it: MenuItem) {
    setEditing(it);
    setForm({
      name: it.name, description: it.description, category: it.category,
      price: it.price, image: it.image, available: it.available, veg: it.veg, prepTime: it.prepTime,
    });
  }

  async function onUploadImage(file: File) {
    setUploading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUri = reader.result as string;
      const { data, error, ok } = await api<{ url: string }>('/api/upload', {
        method: 'POST',
        body: JSON.stringify({ dataUri, folder: 'menu' }),
      });
      setUploading(false);
      if (!ok) { toast.error(error || 'Upload failed'); return; }
      setForm((f) => ({ ...f, image: data!.url }));
      toast.success('Image uploaded');
    };
    reader.readAsDataURL(file);
  }

  async function save() {
    if (!form.name || !form.category || form.price <= 0) {
      toast.error('Name, category and price are required');
      return;
    }
    setSaving(true);
    const url = editing ? `/api/menu/${editing._id}` : '/api/menu';
    const method = editing ? 'PATCH' : 'POST';
    const { data, error, ok } = await api<{ item: MenuItem }>(url, {
      method, body: JSON.stringify(form),
    });
    setSaving(false);
    if (!ok) { toast.error(error || 'Save failed'); return; }
    toast.success(editing ? 'Updated' : 'Added');
    setEditing(null);
    setForm({ ...EMPTY });
    load();
  }

  async function remove(it: MenuItem) {
    if (!confirm(`Delete "${it.name}"?`)) return;
    const { error, ok } = await api(`/api/menu/${it._id}`, { method: 'DELETE' });
    if (!ok) { toast.error(error || 'Failed'); return; }
    toast.success('Deleted');
    load();
  }

  async function toggleAvailable(it: MenuItem) {
    const { error, ok } = await api(`/api/menu/${it._id}`, {
      method: 'PATCH', body: JSON.stringify({ available: !it.available }),
    });
    if (!ok) { toast.error(error || 'Failed'); return; }
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Menu Management</h1>
          <p className="text-sm text-gray-500">Add dishes, upload images to Cloudinary, toggle availability.</p>
        </div>
        <button onClick={openNew} className="btn-primary">
          <Plus className="w-4 h-4" /> Add Item
        </button>
      </div>

      {loading ? (
        <div className="text-gray-500">Loading…</div>
      ) : items.length === 0 ? (
        <div className="card p-8 text-center text-gray-500">
          No menu items yet. Click <strong>Add Item</strong>.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => (
            <div key={it._id} className="card overflow-hidden flex flex-col">
              <div className="relative aspect-[4/3] bg-gray-100">
                {it.image ? (
                  <img src={it.image} alt={it.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">No image</div>
                )}
                <span className={`badge absolute top-2 right-2 ${it.available ? 'bg-emerald-500 text-white' : 'bg-gray-500 text-white'}`}>
                  {it.available ? 'Available' : 'Hidden'}
                </span>
                {it.veg && (
                  <span className="badge absolute top-2 left-2 bg-white text-green-700 border border-green-300">
                    <Leaf className="w-3 h-3 mr-1" /> Veg
                  </span>
                )}
              </div>
              <div className="p-3 flex-1 flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-gray-800">{it.name}</h3>
                  <span className="font-semibold text-brand-700">{formatCurrency(it.price)}</span>
                </div>
                <p className="text-xs text-gray-500 mt-1 line-clamp-2">{it.description || '—'}</p>
                <p className="text-xs text-gray-400 mt-1">{it.category} · {it.prepTime} min</p>
                <div className="mt-3 flex gap-2">
                  <button onClick={() => openEdit(it)} className="btn-secondary text-xs">
                    <Pencil className="w-3.5 h-3.5" /> Edit
                  </button>
                  <button onClick={() => toggleAvailable(it)} className="btn-ghost text-xs">
                    {it.available ? 'Hide' : 'Show'}
                  </button>
                  <button onClick={() => remove(it)} className="btn-ghost text-xs text-red-600 ml-auto">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {(editing || form.name !== '') && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => { setEditing(null); setForm({ ...EMPTY }); }}>
          <div className="card p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-800">{editing ? 'Edit Item' : 'New Menu Item'}</h3>
              <button onClick={() => { setEditing(null); setForm({ ...EMPTY }); }}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                  <input className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} list="cats" />
                  <datalist id="cats">
                    <option>Starters</option><option>Main</option><option>Rice</option>
                    <option>Breads</option><option>Beverages</option><option>Desserts</option>
                    <option>Snacks</option><option>Combos</option>
                  </datalist>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Price ({currencySymbol})</label>
                  <input type="number" min={0} className="input" value={form.price}
                    onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea className="input" rows={2} value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Prep time (min)</label>
                  <input type="number" min={1} className="input" value={form.prepTime}
                    onChange={(e) => setForm({ ...form, prepTime: Number(e.target.value) })} />
                </div>
                <div className="flex items-end gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={form.available} onChange={(e) => setForm({ ...form, available: e.target.checked })} />
                    Available
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={form.veg} onChange={(e) => setForm({ ...form, veg: e.target.checked })} />
                    Veg
                  </label>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Image</label>
                <div className="flex items-center gap-3">
                  {form.image && <img src={form.image} alt="" className="w-20 h-20 object-cover rounded-lg border" />}
                  <label className="btn-secondary cursor-pointer">
                    {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    Upload
                    <input type="file" accept="image/*" className="hidden"
                      onChange={(e) => e.target.files?.[0] && onUploadImage(e.target.files[0])} />
                  </label>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => { setEditing(null); setForm({ ...EMPTY }); }} className="btn-ghost">Cancel</button>
                <button onClick={save} disabled={saving} className="btn-primary">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {editing ? 'Save changes' : 'Add item'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
