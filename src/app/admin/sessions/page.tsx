import { requireAdmin } from '@/lib/guards';
import AdminShell from '@/components/admin/AdminShell';
import AdminSessionsClient from '@/components/admin/AdminSessionsClient';

export default async function AdminSessionsPage() {
  await requireAdmin();
  return (
    <AdminShell active="sessions">
      <AdminSessionsClient />
    </AdminShell>
  );
}
