import { requireStaff } from '@/lib/guards';
import StaffAccountClient from '@/components/staff/StaffAccountClient';

export default async function StaffAccountPage() {
  await requireStaff();
  return <StaffAccountClient />;
}
