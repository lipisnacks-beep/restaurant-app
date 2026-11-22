import { requireAdmin } from '@/lib/guards';
import AdminShell from '@/components/admin/AdminShell';
import AdminTablesClient from '@/components/admin/AdminTablesClient';

export default async function AdminTablesPage() {
  await requireAdmin();
  return (
    <AdminShell active="tables">
      <AdminTablesClient />
    </AdminShell>
  );
}
