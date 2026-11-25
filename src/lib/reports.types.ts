/**
 * Shared types for the admin financial reports feature.
 * Pure TypeScript — safe to import from both client and server code.
 */

export type RangePreset = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'lastmonth' | 'year';

export interface ReportMeta {
  from: string;   // ISO
  to: string;     // ISO
  label: string;
  currency: string;
  bucketBy: 'day' | 'month';
}

export interface ReportKpis {
  orders: number;
  grossSales: number;
  revenue: number;
  tax: number;
  serviceCharge: number;
  tips: number;
  expenses: number;
  expenseCount: number;
  purchases: number;
  purchaseCount: number;
  purchasesPaid: number;
  totalCost: number;
  profit: number;
  margin: number;       // percent, 1 decimal
  avgOrderValue: number;
}

export interface ReportSeriesPoint {
  bucket: string;
  label: string;
  sales: number;
  revenue: number;
  expenses: number;
  purchases: number;
  profit: number;
}

export interface ReportBreakdowns {
  expenseByCategory: { category: string; amount: number }[];
  purchaseByCategory: { category: string; amount: number }[];
  revenueByPaymentMethod: { method: string; revenue: number; count: number }[];
  topItems: { name: string; qty: number; revenue: number }[];
}

export interface ReportSummary {
  meta: ReportMeta;
  kpis: ReportKpis;
  series: ReportSeriesPoint[];
  breakdowns: ReportBreakdowns;
}

export interface ExpenseItem {
  _id: string;
  date: string;
  category: string;
  description: string;
  amount: number;
  paymentMethod: string;
  vendor?: string;
  invoiceNumber?: string;
  note?: string;
  createdBy?: { name: string; email: string } | null;
  createdAt: string;
}

export interface PurchaseLineItem {
  name: string;
  quantity: number;
  unit: string;
  rate: number;
  amount: number;
}

export interface PurchaseItem {
  _id: string;
  date: string;
  category: string;
  supplier?: string;
  invoiceNumber?: string;
  items: PurchaseLineItem[];
  subtotal: number;
  taxAmount: number;
  discount: number;
  total: number;
  paymentMethod: string;
  paymentStatus: string;
  amountPaid: number;
  note?: string;
  createdBy?: { name: string; email: string } | null;
  createdAt: string;
}

export const EXPENSE_CATEGORIES = [
  'rent','utilities','salaries','maintenance','marketing','supplies','transport','miscellaneous',
] as const;

export const PURCHASE_CATEGORIES = [
  'raw-material','beverages','packaging','equipment','groceries','other',
] as const;

export const PAYMENT_METHODS_EXPENSE = ['cash','upi','card','bank','cheque'] as const;
export const PAYMENT_METHODS_PURCHASE = ['cash','upi','card','bank','cheque','credit'] as const;

export const RANGE_PRESETS: { value: RangePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'month', label: 'This month' },
  { value: 'lastmonth', label: 'Last month' },
  { value: 'year', label: 'This year' },
];
