import Link from 'next/link';
import { ShieldCheck, ChefHat, ConciergeBell, UtensilsCrossed } from 'lucide-react';

export default function LoginPage() {
  const panels = [
    { href: '/admin/login', title: 'Admin', icon: ShieldCheck, color: 'bg-amber-100 text-amber-700', email: 'admin@restaurant.com' },
    { href: '/chef/login', title: 'Chef', icon: ChefHat, color: 'bg-rose-100 text-rose-700', email: 'chef@restaurant.com' },
    { href: '/staff/login', title: 'Staff', icon: ConciergeBell, color: 'bg-emerald-100 text-emerald-700', email: 'staff@restaurant.com' },
    { href: '/customer', title: 'Customer Menu', icon: UtensilsCrossed, color: 'bg-sky-100 text-sky-700', email: '(scan QR from a table)' },
  ];
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4">
      <h1 className="text-2xl font-bold text-gray-800 mb-2">Sign in</h1>
      <p className="text-sm text-gray-500 mb-6">Choose your panel to continue</p>
      <div className="grid gap-3 sm:grid-cols-2 max-w-lg w-full">
        {panels.map((p) => (
          <Link key={p.href} href={p.href} className="card p-4 flex items-center gap-3 hover:shadow-md transition">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${p.color}`}>
              <p.icon className="w-5 h-5" />
            </div>
            <div>
              <p className="font-semibold text-gray-800">{p.title}</p>
              <p className="text-xs text-gray-500">{p.email}</p>
            </div>
          </Link>
        ))}
      </div>
      <Link href="/" className="text-sm text-gray-500 mt-6 hover:text-gray-700">← Back to home</Link>
    </main>
  );
}
