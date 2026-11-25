import { requireChef } from '@/lib/guards';
import ChefTipsClient from '@/components/chef/ChefTipsClient';

export default async function ChefTipsPage() {
  await requireChef();
  return <ChefTipsClient />;
}
