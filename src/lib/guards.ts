import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';

/** Server-side guard: redirect to /admin/login unless an admin is signed in. */
export async function requireAdmin() {
  const session = await getSession();
  if (!session) redirect('/admin/login');
  if (session.role !== 'admin') redirect('/admin/login');
  return session;
}

/** Server-side guard: redirect to /chef/login unless a chef or admin is signed in. */
export async function requireChef() {
  const session = await getSession();
  if (!session) redirect('/chef/login');
  if (!['chef', 'admin'].includes(session.role)) redirect('/chef/login');
  return session;
}

/** Server-side guard: redirect to /staff/login unless a staff member or admin is signed in. */
export async function requireStaff() {
  const session = await getSession();
  if (!session) redirect('/staff/login');
  if (!['staff', 'admin'].includes(session.role)) redirect('/staff/login');
  return session;
}
