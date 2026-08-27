/**
 * Type definitions for Invoice & Subscription Tracker Living UI V2
 */

export type PaymentType = 'subscription' | 'one_time'
export type BillingFrequency = 'monthly' | 'yearly' | 'weekly' | 'quarterly' | 'none'
export type SubscriptionStatus = 'active' | 'paused' | 'cancelled'

export interface CurrencyOption {
  code: string
  symbol: string
  label: string
}

export const CURRENCY_OPTIONS: CurrencyOption[] = [
  { code: 'USD', symbol: '$', label: 'USD ($) — US Dollar' },
  { code: 'EUR', symbol: '€', label: 'EUR (€) — Euro' },
  { code: 'GBP', symbol: '£', label: 'GBP (£) — British Pound' },
  { code: 'PKR', symbol: 'Rs', label: 'PKR (Rs) — Pakistani Rupee' },
  { code: 'KRW', symbol: '₩', label: 'KRW (₩) — South Korean Won' },
  { code: 'JPY', symbol: '¥', label: 'JPY (¥) — Japanese Yen' },
  { code: 'INR', symbol: '₹', label: 'INR (₹) — Indian Rupee' },
  { code: 'CAD', symbol: 'CA$', label: 'CAD (CA$) — Canadian Dollar' },
  { code: 'AUD', symbol: 'A$', label: 'AUD (A$) — Australian Dollar' },
  { code: 'AED', symbol: 'AED', label: 'AED (د.إ) — UAE Dirham' },
  { code: 'BRL', symbol: 'R$', label: 'BRL (R$) — Brazilian Real' },
  { code: 'CHF', symbol: 'Fr', label: 'CHF (Fr) — Swiss Franc' },
  { code: 'CNY', symbol: '¥', label: 'CNY (¥) — Chinese Yuan' },
  { code: 'NZD', symbol: 'NZ$', label: 'NZD (NZ$) — New Zealand Dollar' },
  { code: 'SAR', symbol: 'SAR', label: 'SAR (﷼) — Saudi Riyal' },
  { code: 'SEK', symbol: 'kr', label: 'SEK (kr) — Swedish Krona' },
  { code: 'SGD', symbol: 'S$', label: 'SGD (S$) — Singapore Dollar' },
  { code: 'TRY', symbol: '₺', label: 'TRY (₺) — Turkish Lira' },
]

export function getCurrencySymbol(currencyCode?: string): string {
  if (!currencyCode) return '$'
  const match = CURRENCY_OPTIONS.find(
    (c) => c.code.toUpperCase() === currencyCode.toUpperCase()
  )
  return match ? match.symbol : currencyCode
}

export const ALL_CATEGORIES: string[] = [
  'Cloud Infrastructure',
  'Software & SaaS',
  'Developer Tools & DevOps',
  'Productivity & AI',
  'Design & Creative',
  'Marketing & Growth',
  'Security & Compliance',
  'Communications & Collaboration',
  'Finance & Operations',
  'Customer Support',
  'Other Services',
]

export interface LineItem {
  description: string
  quantity: number
  unitPrice: number
  total?: number
  amount?: number
}

export interface TrackerGroup {
  id: string | number
  name: string
  description?: string
  color: string
  icon: string
  currency: string
  invoicesCount?: number
  activeSubsCount?: number
  totalSpend?: number
  created?: string
  updated?: string
  createdAt?: string
  updatedAt?: string
}

export interface EmailAccount {
  id: string | number
  emailAddress: string
  provider: string
  status: 'connected' | 'syncing' | 'paused' | 'error'
  lastSyncedAt?: string
  syncIntervalSeconds?: number
  autoDetectEnabled?: boolean
  totalScannedCount?: number
  totalInvoicesFound?: number
  createdAt?: string
}

export interface InvoiceReceipt {
  id: string | number
  vendor: string
  amount: number
  currency: string
  paymentType: PaymentType
  billingFrequency?: BillingFrequency
  category: string
  purpose?: string
  emailSubject?: string
  invoiceDate?: string
  invoiceNumber?: string
  groupId?: string | number | null
  group_id?: string | number | null
  hasPdfAttachment: boolean
  pdfFilename?: string
  pdfTextPreview?: string
  pdfDataBase64?: string
  lineItems: LineItem[]
  notes?: string
  subscriptionId?: string | number | null
  confidenceScore?: number
  isVerified?: boolean
  created?: string
  updated?: string
  createdAt?: string
  updatedAt?: string
}

export interface Subscription {
  id: string | number
  name: string
  vendor: string
  amount: number
  currency: string
  billingFrequency: BillingFrequency
  category: string
  purpose?: string
  status: SubscriptionStatus
  groupId?: string | number | null
  group_id?: string | number | null
  lastBilledDate?: string
  nextRenewalDate?: string
  autoRenew: boolean
  iconName?: string
  created?: string
  updated?: string
  createdAt?: string
  updatedAt?: string
}

export interface ActivityEvent {
  id: string | number
  eventType: string
  title: string
  description?: string
  amount?: number
  currency?: string
  vendor?: string
  groupId?: string | number | null
  created?: string
  createdAt?: string
}

export interface SpendSegment {
  service?: string
  category?: string
  amount: number
  percentage: number
  color: string
}

export interface MonthlySpendBar {
  month: string
  shortMonth: string
  total: number
  computedTotal?: number
  segments: SpendSegment[]
}

export interface DashboardStats {
  totalSpentAllTime: number
  totalSpentMonth: number
  monthToDateSpend: number
  monthlyRecurringBurn: number
  topService: string
  activeSubscriptionsCount: number
  totalInvoicesCount: number
  recurringTotal: number
  onetimeTotal: number
  categoryBreakdown: {
    category: string
    total: number
    count: number
    percentage: number
  }[]
  serviceBreakdown: SpendSegment[]
  monthlySpending: MonthlySpendBar[]
  upcomingRenewals: any[]
  recentActivities?: ActivityEvent[]
  activeGroupName?: string
  activeGroupId?: string | number | null
  activeCurrency?: string
  lastUpdated?: string
}

export interface YearlySummaryItem {
  year: number
  totalSpend: number
  invoiceCount: number
  averageMonthly: number
  topVendor: string
  yoyGrowthPct: number
  quarterlySpend: {
    Q1: number
    Q2: number
    Q3: number
    Q4: number
  }
  categoryBreakdown: Record<string, number>
  vendorBreakdown: Record<string, number>
  monthlyTotals: {
    month: string
    total: number
  }[]
}

export interface YearlyHistoryData {
  allYears: number[]
  yearlySummaries: YearlySummaryItem[]
  grandTotalAllYears: number
  totalInvoicesAllYears: number
}
