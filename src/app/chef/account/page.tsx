import { requireChef } from '@/lib/guards';
import ChefAccountClient from '@/components/chef/ChefAccountClient';

export default async function ChefAccountPage() {
  await requireChef();
  return <ChefAccountClient />;
}
