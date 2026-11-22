import { requireAdmin } from '@/lib/guards';
import AdminShell from '@/components/admin/AdminShell';
import AdminStaffClient from '@/components/admin/AdminStaffClient';

export default async function AdminStaffPage() {
  await requireAdmin();
  return (
    <AdminShell active="staff">
      <AdminStaffClient />
    </AdminShell>
  );
}
