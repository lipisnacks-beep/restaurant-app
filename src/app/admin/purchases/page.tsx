import { requireAdmin } from '@/lib/guards';
import AdminShell from '@/components/admin/AdminShell';
import AdminPurchasesClient from '@/components/admin/AdminPurchasesClient';

export default async function AdminPurchasesPage() {
  await requireAdmin();
  return (
    <AdminShell active="purchases">
      <AdminPurchasesClient />
    </AdminShell>
  );
}
