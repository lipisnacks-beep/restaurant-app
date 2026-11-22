export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // The login page renders without a session; every other admin page calls
  // `requireAdmin()` (see src/lib/guards.ts) to enforce role-based access.
  return <>{children}</>;
}
