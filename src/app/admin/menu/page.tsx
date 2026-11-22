import { requireAdmin } from '@/lib/guards';
import AdminShell from '@/components/admin/AdminShell';
import AdminMenuClient from '@/components/admin/AdminMenuClient';

export default async function AdminMenuPage() {
  await requireAdmin();
  return (
    <AdminShell active="menu">
      <AdminMenuClient />
    </AdminShell>
  );
}
