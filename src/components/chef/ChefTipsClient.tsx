'use client';

import TipsDashboard, { type TipsTheme } from '@/components/ui/TipsDashboard';

/**
 * Chef tips page. Thin wrapper around the shared TipsDashboard that injects
 * the chef theme (rose), the chef tips API endpoints and the chef portal
 * back-link. Tips are split 50/50 between the chef (who cooked the order) and
 * the staff (who served it); the chef's earned half is aggregated by
 * /api/chef/tips and shown here identically to the staff view.
 */
const CHEF_THEME: TipsTheme = {
  color: 'rose',
  tipsApi: '/api/chef/tips',
  withdrawApi: '/api/chef/tips/withdraw',
  backHref: '/chef/portal',
  accountHref: '/chef/account',
  subtitle: 'Withdraw tips you earned from cooking orders',
};

export default function ChefTipsClient() {
  return <TipsDashboard theme={CHEF_THEME} />;
}
