import { requireStaff } from '@/lib/guards';
import StaffTipsClient from '@/components/staff/StaffTipsClient';

export default async function StaffTipsPage() {
  await requireStaff();
  return <StaffTipsClient />;
}
