'use client';
import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/apiClient';
import { toast } from 'sonner';
import {
  ChefHat, ArrowLeft, Loader2, Mail, Phone, ShieldCheck, User as UserIcon,
  KeyRound, CheckCircle2, Calendar, LogOut, Save,
} from 'lucide-react';
import { useRouter } from 'next/navigation';

interface ChefProfile {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  active: boolean;
  createdAt: string;
}

export default function ChefAccountClient() {
  const router = useRouter();
  const [profile, setProfile] = useState<ChefProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Editable profile fields.
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // Password change fields.
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const load = useCallback(async () => {
    const { data, ok, error } = await api<{ user: ChefProfile }>('/api/chef/account');
    if (ok && data) {
      setProfile(data.user);
      setName(data.user.name);
      setPhone(data.user.phone || '');
    } else if (error) {
      toast.error(error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function validateProfile(): string | null {
    if (!name.trim()) return 'Name cannot be empty';
    if (name.trim().length > 60) return 'Name is too long (max 60 characters)';
    if (phone.trim() && !/^[0-9 +\-()]{7,20}$/.test(phone.trim())) {
      return 'Phone number looks invalid (use digits, spaces, +, -, parentheses)';
    }
    return null;
  }

  async function saveProfile() {
    const err = validateProfile();
    if (err) { toast.error(err); return; }
    setSavingProfile(true);
    const { data, error, ok } = await api<{ user: ChefProfile; tokenReissued?: boolean }>('/api/chef/account', {
      method: 'PATCH',
      body: JSON.stringify({ name: name.trim(), phone: phone.trim() }),
    });
    setSavingProfile(false);
    if (!ok || !data) { toast.error(error || 'Failed to save'); return; }
    setProfile(data.user);
    setName(data.user.name);
    setPhone(data.user.phone || '');
    toast.success(data.tokenReissued ? 'Profile saved — session refreshed' : 'Profile saved');
  }

  function validatePassword(): string | null {
    if (!currentPw) return 'Enter your current password';
    if (!newPw) return 'Enter a new password';
    if (newPw.length < 6) return 'New password must be at least 6 characters';
    if (newPw === currentPw) return 'New password must be different from the current password';
    if (newPw !== confirmPw) return 'New password and confirmation do not match';
    return null;
  }

  async function changePassword() {
    const err = validatePassword();
    if (err) { toast.error(err); return; }
    setSavingPw(true);
    const { error, ok } = await api<{ passwordChanged?: boolean }>('/api/chef/account', {
      method: 'PATCH',
      body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
    });
    setSavingPw(false);
    if (!ok) { toast.error(error || 'Failed to change password'); return; }
    toast.success('Password changed — use it next time you sign in');
    setCurrentPw(''); setNewPw(''); setConfirmPw('');
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-rose-50 to-gray-50 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-rose-500" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-rose-50 to-gray-50">
        <Header />
        <main className="max-w-3xl mx-auto px-4 py-6">
          <div className="card p-8 text-center">
            <p className="text-gray-600">Could not load your account. Please sign in again.</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-rose-50 to-gray-50">
      <Header />

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Back link */}
        <button
          onClick={() => router.push('/chef/portal')}
          className="btn-ghost text-gray-600 -ml-2"
        >
          <ArrowLeft className="w-4 h-4" /> Back to orders
        </button>

        {/* Read-only profile summary */}
        <section className="card p-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
              <ChefHat className="w-7 h-7" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-gray-900 truncate">{profile.name}</h1>
              <p className="text-sm text-gray-500 truncate">{profile.email}</p>
              <div className="flex flex-wrap items-center gap-2 mt-1.5">
                <span className="badge bg-rose-100 text-rose-700 capitalize">
                  <ShieldCheck className="w-3 h-3 mr-1" /> {profile.role}
                </span>
                {profile.active ? (
                  <span className="badge bg-emerald-100 text-emerald-700">
                    <CheckCircle2 className="w-3 h-3 mr-1" /> Active
                  </span>
                ) : (
                  <span className="badge bg-gray-200 text-gray-600">Inactive</span>
                )}
              </div>
            </div>
          </div>

          <dl className="mt-5 grid sm:grid-cols-2 gap-3 text-sm">
            <div className="flex items-center gap-2 text-gray-600">
              <Mail className="w-4 h-4 text-gray-400" />
              <span className="truncate">{profile.email}</span>
            </div>
            <div className="flex items-center gap-2 text-gray-600">
              <Phone className="w-4 h-4 text-gray-400" />
              <span>{profile.phone || '— no phone on file —'}</span>
            </div>
            <div className="flex items-center gap-2 text-gray-600">
              <Calendar className="w-4 h-4 text-gray-400" />
              <span>Joined {new Date(profile.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
            </div>
          </dl>

          <p className="mt-4 text-xs text-gray-400 leading-relaxed">
            Email and role are managed by an administrator. To change them, ask your manager.
          </p>
        </section>

        {/* Editable profile fields */}
        <section className="card p-6">
          <h2 className="font-semibold text-gray-800 mb-1 flex items-center gap-2">
            <UserIcon className="w-4 h-4 text-rose-500" /> Profile details
          </h2>
          <p className="text-sm text-gray-500 mb-4">Update your display name and contact number.</p>

          <div className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">Display name</label>
              <input
                id="name" className="input" maxLength={60}
                value={name} onChange={(e) => setName(e.target.value)}
                placeholder="Your name as shown in the kitchen"
              />
            </div>
            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">Phone (optional)</label>
              <input
                id="phone" className="input" inputMode="tel" maxLength={20}
                value={phone} onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. +880 1700 000000"
              />
            </div>
            <div className="flex justify-end">
              <button onClick={saveProfile} disabled={savingProfile} className="btn-primary">
                {savingProfile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save changes
              </button>
            </div>
          </div>
        </section>

        {/* Change password */}
        <section className="card p-6">
          <h2 className="font-semibold text-gray-800 mb-1 flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-rose-500" /> Change password
          </h2>
          <p className="text-sm text-gray-500 mb-4">
            Choose a password you don&apos;t use elsewhere. Minimum 6 characters.
          </p>

          <div className="space-y-4">
            <div>
              <label htmlFor="curPw" className="block text-sm font-medium text-gray-700 mb-1">Current password</label>
              <input
                id="curPw" type={showPw ? 'text' : 'password'} className="input"
                value={currentPw} onChange={(e) => setCurrentPw(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <div>
              <label htmlFor="newPw" className="block text-sm font-medium text-gray-700 mb-1">New password</label>
              <input
                id="newPw" type={showPw ? 'text' : 'password'} className="input"
                value={newPw} onChange={(e) => setNewPw(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div>
              <label htmlFor="confirmPw" className="block text-sm font-medium text-gray-700 mb-1">Confirm new password</label>
              <input
                id="confirmPw" type={showPw ? 'text' : 'password'} className="input"
                value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
                <input type="checkbox" className="rounded" checked={showPw} onChange={(e) => setShowPw(e.target.checked)} />
                Show passwords
              </label>
              <button onClick={changePassword} disabled={savingPw} className="btn-primary">
                {savingPw ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                Update password
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );

  function Header() {
    return (
      <header className="bg-gradient-to-r from-rose-600 to-rose-700 text-white sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ChefHat className="w-6 h-6" />
            <div>
              <h1 className="font-semibold leading-none">Chef Portal</h1>
              <p className="text-xs text-rose-100">Account settings</p>
            </div>
          </div>
          <button
            onClick={() => { api('/api/auth/logout', { method: 'POST', body: JSON.stringify({ scope: 'chef' }) }); router.push('/'); }}
            className="btn-ghost text-white hover:bg-white/10"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>
    );
  }
}
