import { requireAdmin } from '@/lib/guards';
import AdminShell from '@/components/admin/AdminShell';
import AdminOrdersClient from '@/components/admin/AdminOrdersClient';

export default async function AdminOrdersPage() {
  await requireAdmin();
  return (
    <AdminShell active="orders">
      <AdminOrdersClient />
    </AdminShell>
  );
}
