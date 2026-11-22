import LoginCard from '@/components/ui/LoginCard';

export default function ChefLoginPage() {
  return (
    <LoginCard
      title="Chef Panel"
      accent="bg-rose-100 text-rose-700"
      defaultEmail="chef@restaurant.com"
      allowedRoles={['chef', 'admin']}
      scope="chef"
      redirectTo="/chef/portal"
    />
  );
}
