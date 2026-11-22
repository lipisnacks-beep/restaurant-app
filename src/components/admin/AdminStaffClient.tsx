'use client';
import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/apiClient';
import { toast } from 'sonner';
import { Plus, Trash2, Loader2, X, ChefHat, ConciergeBell, ShieldCheck } from 'lucide-react';

interface User {
  _id: string; name: string; email: string; role: string;
  phone?: string; active: boolean;
}

const ROLE_META: Record<string, { icon: any; color: string; label: string }> = {
  admin: { icon: ShieldCheck, color: 'bg-amber-100 text-amber-700', label: 'Admin' },
  chef: { icon: ChefHat, color: 'bg-rose-100 text-rose-700', label: 'Chef' },
  staff: { icon: ConciergeBell, color: 'bg-emerald-100 text-emerald-700', label: 'Staff' },
};

export default function AdminStaffClient() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'staff', phone: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data, ok } = await api<{ users: User[] }>('/api/users');
    if (ok && data) setUsers(data.users);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function create() {
    if (!form.name || !form.email || !form.password) {
      toast.error('All fields are required'); return;
    }
    setSaving(true);
    const { error, ok } = await api('/api/users', { method: 'POST', body: JSON.stringify(form) });
    setSaving(false);
    if (!ok) { toast.error(error || 'Failed'); return; }
    toast.success('Account created');
    setForm({ name: '', email: '', password: '', role: 'staff', phone: '' });
    setShowForm(false);
    load();
  }

  async function toggle(u: User) {
    const { error, ok } = await api(`/api/users/${u._id}`, {
      method: 'PATCH', body: JSON.stringify({ active: !u.active }),
    });
    if (!ok) { toast.error(error || 'Failed'); return; }
    load();
  }

  async function resetPassword(u: User) {
    const pwd = prompt(`New password for ${u.name} (min 6 chars):`);
    if (!pwd) return;
    const { error, ok } = await api(`/api/users/${u._id}`, {
      method: 'PATCH', body: JSON.stringify({ password: pwd }),
    });
    if (!ok) { toast.error(error || 'Failed'); return; }
    toast.success('Password reset');
  }

  async function remove(u: User) {
    if (!confirm(`Delete account ${u.email}?`)) return;
    const { error, ok } = await api(`/api/users/${u._id}`, { method: 'DELETE' });
    if (!ok) { toast.error(error || 'Failed'); return; }
    toast.success('Deleted');
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Staff &amp; Chef Accounts</h1>
          <p className="text-sm text-gray-500">Create accounts for chefs, service staff and other admins.</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary">
          <Plus className="w-4 h-4" /> Add Account
        </button>
      </div>

      {loading ? (
        <div className="text-gray-500">Loading…</div>
      ) : users.length === 0 ? (
        <div className="card p-8 text-center text-gray-500">No accounts yet.</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {users.map((u) => {
            const meta = ROLE_META[u.role] || ROLE_META.staff;
            return (
              <div key={u._id} className="card p-4">
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${meta.color}`}>
                    <meta.icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-800">{u.name}</p>
                    <p className="text-xs text-gray-500 truncate">{u.email}</p>
                    {u.phone && <p className="text-xs text-gray-400">{u.phone}</p>}
                  </div>
                  <span className={`badge ${u.active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-500'}`}>
                    {u.active ? 'Active' : 'Disabled'}
                  </span>
                </div>
                <div className="mt-3 flex gap-2">
                  <button onClick={() => toggle(u)} className="btn-ghost text-xs">
                    {u.active ? 'Disable' : 'Enable'}
                  </button>
                  <button onClick={() => resetPassword(u)} className="btn-ghost text-xs">Reset password</button>
                  <button onClick={() => remove(u)} className="btn-ghost text-xs text-red-600 ml-auto">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowForm(false)}>
          <div className="card p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-800">New Account</h3>
              <button onClick={() => setShowForm(false)}><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <input className="input" placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input className="input" placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              <input className="input" placeholder="Phone (optional)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              <input className="input" placeholder="Password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="staff">Service Staff</option>
                <option value="chef">Chef</option>
                <option value="admin">Admin</option>
              </select>
              <button onClick={create} disabled={saving} className="btn-primary w-full">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Create account
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
