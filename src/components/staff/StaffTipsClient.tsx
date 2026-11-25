'use client';

import TipsDashboard, { type TipsTheme } from '@/components/ui/TipsDashboard';

/**
 * Staff tips page. Thin wrapper around the shared TipsDashboard that injects
 * the staff theme (emerald), the staff tips API endpoints and the staff
 * portal back-link. The dashboard logic (balance card, date-wise breakdown,
 * withdrawal form + history) lives once in TipsDashboard and is reused by the
 * chef portal.
 */
const STAFF_THEME: TipsTheme = {
  color: 'emerald',
  tipsApi: '/api/staff/tips',
  withdrawApi: '/api/staff/tips/withdraw',
  backHref: '/staff/portal',
  accountHref: '/staff/account',
  subtitle: 'Withdraw tips you earned from serving orders',
};

export default function StaffTipsClient() {
  return <TipsDashboard theme={STAFF_THEME} />;
}
