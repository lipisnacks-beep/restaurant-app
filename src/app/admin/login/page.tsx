import LoginCard from '@/components/ui/LoginCard';

export default function AdminLoginPage() {
  return (
    <LoginCard
      title="Admin Panel"
      accent="bg-amber-100 text-amber-700"
      defaultEmail="admin@restaurant.com"
      allowedRoles={['admin']}
      scope="admin"
      redirectTo="/admin/dashboard"
    />
  );
}
