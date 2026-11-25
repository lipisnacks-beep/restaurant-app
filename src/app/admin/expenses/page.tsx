import { requireAdmin } from '@/lib/guards';
import AdminShell from '@/components/admin/AdminShell';
import AdminExpensesClient from '@/components/admin/AdminExpensesClient';

export default async function AdminExpensesPage() {
  await requireAdmin();
  return (
    <AdminShell active="expenses">
      <AdminExpensesClient />
    </AdminShell>
  );
}
