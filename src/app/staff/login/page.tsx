import LoginCard from '@/components/ui/LoginCard';

export default function StaffLoginPage() {
  return (
    <LoginCard
      title="Staff Panel"
      accent="bg-emerald-100 text-emerald-700"
      defaultEmail="staff@restaurant.com"
      allowedRoles={['staff', 'admin']}
      redirectTo="/staff/portal"
    />
  );
}
