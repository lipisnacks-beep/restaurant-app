'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { api } from '@/lib/apiClient';
import { cn } from '@/lib/utils';
import { LogOut, Menu, X, UtensilsCrossed } from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface PanelShellProps {
  title: string;
  nav: NavItem[];
  /** Accent gradient classes for the header. */
  accent: string;
  children: React.ReactNode;
}

export default function PanelShell({ title, nav, accent, children }: PanelShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  async function logout() {
    await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({ scope: 'admin' }) });
    router.push('/');
    router.refresh();
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-gray-50">
      {/* Sidebar (desktop) */}
      <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 border-r bg-white">
        <div className={cn('flex items-center gap-2 px-5 h-16 text-white', accent)}>
          <UtensilsCrossed className="w-6 h-6" />
          <span className="font-semibold">{title}</span>
        </div>
        <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
          {nav.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition',
                  active ? 'bg-brand-50 text-brand-700 font-medium' : 'text-gray-600 hover:bg-gray-100'
                )}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t">
          <button onClick={logout} className="btn-ghost w-full justify-start text-red-600 hover:bg-red-50">
            <LogOut className="w-4 h-4" /> Sign out
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="md:hidden flex items-center justify-between h-14 px-4 border-b bg-white">
        <div className="flex items-center gap-2">
          <button onClick={() => setOpen(true)} className="p-1 -ml-1">
            <Menu className="w-6 h-6" />
          </button>
          <span className="font-semibold">{title}</span>
        </div>
        <button onClick={logout} className="text-red-600">
          <LogOut className="w-5 h-5" />
        </button>
      </header>

      {/* Mobile drawer */}
      {open && (
        <div className="md:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-64 bg-white shadow-xl flex flex-col animate-fade-in">
            <div className="flex items-center justify-between px-4 h-14 border-b">
              <span className="font-semibold">Menu</span>
              <button onClick={() => setOpen(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 px-2 py-3 space-y-1 overflow-y-auto">
              {nav.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + '/');
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 rounded-lg text-sm',
                      active ? 'bg-brand-50 text-brand-700' : 'text-gray-700 hover:bg-gray-100'
                    )}
                  >
                    <item.icon className="w-4 h-4" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 md:ml-64 min-w-0">
        <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full">{children}</div>
      </main>
    </div>
  );
}
