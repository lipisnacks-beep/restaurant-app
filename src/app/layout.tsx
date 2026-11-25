import type { Metadata } from 'next';
import './globals.css';
import { Toaster } from 'sonner';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

// Dynamic metadata: the browser tab title reflects the current restaurant name
// (editable from Admin → Settings) instead of a hardcoded string.
export async function generateMetadata(): Promise<Metadata> {
  const brand = await getSettings();
  return {
    title: `${brand.restaurantName} — Restaurant Management`,
    description: 'Admin, Chef, Staff and Customer panels for restaurant/cafe operations',
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        {children}
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
