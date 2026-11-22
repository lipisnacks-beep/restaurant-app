import { requireAdmin } from '@/lib/guards';
import AdminShell from '@/components/admin/AdminShell';
import AdminDashboardClient from '@/components/admin/AdminDashboardClient';

export default async function AdminDashboardPage() {
  await requireAdmin();
  return (
    <AdminShell active="dashboard">
      <AdminDashboardClient />
    </AdminShell>
  );
}
