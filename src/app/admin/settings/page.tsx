import { requireAdmin } from '@/lib/guards';
import AdminShell from '@/components/admin/AdminShell';
import AdminSettingsClient from '@/components/admin/AdminSettingsClient';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export default async function AdminSettingsPage() {
  await requireAdmin();
  const settings = await getSettings();
  return (
    <AdminShell active="settings">
      <AdminSettingsClient initialSettings={settings} />
    </AdminShell>
  );
}
