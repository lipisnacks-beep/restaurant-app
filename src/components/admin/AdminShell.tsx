'use client';
import PanelShell, { NavItem } from '@/components/ui/PanelShell';
import { LayoutDashboard, Table2, UtensilsCrossed, Receipt, Users, Star, Clock, Settings } from 'lucide-react';

const nav: NavItem[] = [
  { href: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/tables', label: 'Tables & QR', icon: Table2 },
  { href: '/admin/menu', label: 'Menu', icon: UtensilsCrossed },
  { href: '/admin/orders', label: 'Orders', icon: Receipt },
  { href: '/admin/sessions', label: 'Sessions', icon: Clock },
  { href: '/admin/staff', label: 'Staff & Chef', icon: Users },
  { href: '/admin/reviews', label: 'Reviews', icon: Star },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
];

export default function AdminShell({ active, children }: { active: string; children: React.ReactNode }) {
  return (
    <PanelShell title="Admin Panel" accent="bg-gradient-to-r from-amber-500 to-amber-700" nav={nav}>
      {children}
    </PanelShell>
  );
}
