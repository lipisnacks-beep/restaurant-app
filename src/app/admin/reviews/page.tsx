import { requireAdmin } from '@/lib/guards';
import AdminShell from '@/components/admin/AdminShell';
import AdminReviewsClient from '@/components/admin/AdminReviewsClient';

export default async function AdminReviewsPage() {
  await requireAdmin();
  return (
    <AdminShell active="reviews">
      <AdminReviewsClient />
    </AdminShell>
  );
}
