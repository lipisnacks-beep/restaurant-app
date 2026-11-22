import { requireChef } from '@/lib/guards';
import ChefPortalClient from '@/components/chef/ChefPortalClient';

export default async function ChefPortalPage() {
  await requireChef();
  return <ChefPortalClient />;
}
