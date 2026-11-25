import Link from 'next/link';
import { ShieldCheck, ChefHat, ConciergeBell, QrCode } from 'lucide-react';
import Brand from '@/components/ui/Brand';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const brand = await getSettings();
  const panels = [
    { href: '/admin/login', title: 'Admin Panel', desc: 'Manage tables, menu, staff, orders & reviews', icon: ShieldCheck, color: 'bg-amber-100 text-amber-700' },
    { href: '/chef/login', title: 'Chef Panel', desc: 'Live order queue — cook & mark ready', icon: ChefHat, color: 'bg-rose-100 text-rose-700' },
    { href: '/staff/login', title: 'Staff Panel', desc: 'Delivery queue — serve tables, see tips', icon: ConciergeBell, color: 'bg-emerald-100 text-emerald-700' },
    { href: '/customer', title: 'Customer Menu', desc: 'Scan QR — view menu, order, pay & rate', icon: QrCode, color: 'bg-sky-100 text-sky-700' },
  ];

  return (
    <main className="min-h-screen flex flex-col">
      <header className="bg-gradient-to-r from-brand-600 to-brand-700 text-white">
        <div className="max-w-5xl mx-auto px-4 py-12 flex items-center gap-3">
          <Brand iconSize="w-10 h-10" nameClassName="text-3xl font-bold leading-tight" onColor brand={brand} />
        </div>
        <div className="max-w-5xl mx-auto px-4 -mt-8">
          <p className="text-brand-100">Restaurant / Cafe Management System</p>
        </div>
      </header>

      <section className="max-w-5xl mx-auto w-full px-4 py-10">
        <h2 className="text-xl font-semibold text-gray-800 mb-1">Choose your panel</h2>
        <p className="text-gray-500 mb-6 text-sm">
          Customers scan the QR code on their table to reach the menu directly. Staff and managers
          log in below.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {panels.map((p) => (
            <Link
              key={p.href}
              href={p.href}
              className="card p-5 hover:shadow-md hover:-translate-y-0.5 transition flex flex-col gap-3"
            >
              <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${p.color}`}>
                <p.icon className="w-6 h-6" />
              </div>
              <h3 className="font-semibold text-gray-800">{p.title}</h3>
              <p className="text-sm text-gray-500">{p.desc}</p>
            </Link>
          ))}
        </div>

        <div className="mt-10 card p-6 bg-gradient-to-br from-gray-50 to-white">
          <h3 className="font-semibold mb-2">How it works</h3>
          <ol className="text-sm text-gray-600 space-y-1 list-decimal list-inside">
            <li>Admin creates tables and generates printable QR codes for each.</li>
            <li>Customer scans the QR, browses the menu with images, and places an order.</li>
            <li>The order appears instantly in the Chef panel.</li>
            <li>Chef marks it ready — it shows up in the Staff delivery queue.</li>
            <li>Staff serves the table; customer pays (cash / UPI / card) and leaves a tip + rating.</li>
            <li>The customer is redirected to Google Reviews to share their experience.</li>
          </ol>
        </div>
      </section>

      <footer className="mt-auto border-t py-6 text-center text-xs text-gray-400">
        © {new Date().getFullYear()} {brand.restaurantName} · Built with Next.js, MongoDB &amp; Cloudinary
      </footer>
    </main>
  );
}
