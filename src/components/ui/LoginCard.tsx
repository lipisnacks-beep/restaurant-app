'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, setTabIdentity } from '@/lib/apiClient';
import { toast } from 'sonner';
import { Loader2, LogIn } from 'lucide-react';

interface LoginCardProps {
  /** Where to redirect after a successful login. */
  redirectTo: string;
  /** Panel title shown at the top. */
  title: string;
  /** Accent color class for the icon, e.g. "bg-amber-100 text-amber-700". */
  accent: string;
  /** Pre-fill the email field (convenience). */
  defaultEmail?: string;
  /** Accepted roles for this panel — login is rejected for other roles. */
  allowedRoles: string[];
  /** Which session cookie to write ('admin' | 'chef' | 'staff'). */
  scope: 'admin' | 'chef' | 'staff';
}

export default function LoginCard({ redirectTo, title, accent, defaultEmail = '', allowedRoles, scope }: LoginCardProps) {
  const router = useRouter();
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { data, error, ok } = await api<{ user?: { role: string; name?: string; email?: string; id?: string }; token?: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, scope }),
    });
    setLoading(false);
    if (!ok) {
      toast.error(error || 'Login failed');
      return;
    }
    if (!allowedRoles.includes(data?.user?.role || '')) {
      toast.error(`This account does not have access to the ${title}`);
      // clear only this portal's cookie so other portals stay signed in
      await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({ scope }) });
      return;
    }
    // Store this tab's identity. sessionStorage is per-tab, so a second chef
    // logging in on another tab of the same browser gets their own identity
    // instead of clobbering this one. The matching httpOnly cookie is also
    // set by the server, but the per-tab Bearer token wins on data requests.
    if (data?.token && data?.user) {
      setTabIdentity(data.token, { ...data.user, scope });
    }
    toast.success('Welcome back!');
    router.push(redirectTo);
    router.refresh();
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="w-full max-w-md card p-8">
        <div className={`w-14 h-14 rounded-xl flex items-center justify-center mb-4 ${accent}`}>
          <LogIn className="w-7 h-7" />
        </div>
        <h1 className="text-2xl font-bold text-gray-800">{title}</h1>
        <p className="text-sm text-gray-500 mt-1 mb-6">Sign in to continue</p>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
              placeholder="you@restaurant.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
              placeholder="••••••••"
            />
          </div>
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
            Sign in
          </button>
        </form>

        <p className="text-xs text-gray-400 mt-6">
          Trouble signing in? Ask the restaurant admin to reset your password.
        </p>
      </div>
    </main>
  );
}
