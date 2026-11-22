import type { Metadata } from 'next';
import './globals.css';
import { Toaster } from 'sonner';

export const metadata: Metadata = {
  title: 'Lipi Snacks — Restaurant Management',
  description: 'Admin, Chef, Staff and Customer panels for restaurant/cafe operations',
};

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
