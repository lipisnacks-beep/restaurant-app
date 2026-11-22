import { requireStaff } from '@/lib/guards';
import StaffPortalClient from '@/components/staff/StaffPortalClient';

export default async function StaffPortalPage() {
  await requireStaff();
  return <StaffPortalClient />;
}
