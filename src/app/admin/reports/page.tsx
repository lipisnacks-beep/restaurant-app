import { requireAdmin } from '@/lib/guards';
import AdminShell from '@/components/admin/AdminShell';
import AdminReportsClient from '@/components/admin/AdminReportsClient';

export default async function AdminReportsPage() {
  await requireAdmin();
  return (
    <AdminShell active="reports">
      <AdminReportsClient />
    </AdminShell>
  );
}
