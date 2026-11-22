import { Suspense } from 'react';
import CustomerApp from '@/components/customer/CustomerApp';

export default function CustomerPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-gray-500">Loading…</div>}>
      <CustomerApp />
    </Suspense>
  );
}
