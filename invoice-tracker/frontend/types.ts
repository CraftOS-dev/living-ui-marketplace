/**
 * Type definitions for Invoice & Subscription Tracker Living UI
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
  // Major Global & Key Currencies
  { code: 'USD', symbol: '$', label: 'USD ($) — US Dollar' },
  { code: 'EUR', symbol: '€', label: 'EUR (€) — Euro' },
  { code: 'GBP', symbol: '£', label: 'GBP (£) — British Pound' },
  { code: 'PKR', symbol: 'Rs', label: 'PKR (Rs) — Pakistani Rupee' },
  { code: 'KRW', symbol: '₩', label: 'KRW (₩) — South Korean Won' },
  { code: 'JPY', symbol: '¥', label: 'JPY (¥) — Japanese Yen' },
  { code: 'INR', symbol: '₹', label: 'INR (₹) — Indian Rupee' },
  { code: 'CAD', symbol: 'CA$', label: 'CAD (CA$) — Canadian Dollar' },
  { code: 'AUD', symbol: 'A$', label: 'AUD (A$) — Australian Dollar' },
  
  // Additional International Currencies (Alphabetical)
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
  total: number
}

export interface TrackerGroup {
  id: number
  name: string
  description?: string
  color: string
  icon: string
  currency: string
  invoicesCount?: number
  activeSubsCount?: number
  totalSpend?: number
  createdAt: string
  updatedAt: string
}

export interface EmailAccount {
  id: number
  emailAddress: string
  provider: string
  status: 'connected' | 'syncing' | 'paused' | 'error'
  lastSyncedAt: string
  syncIntervalSeconds: number
  autoDetectEnabled: boolean
  totalScannedCount: number
  totalInvoicesFound: number
  createdAt: string
}

export interface InvoiceReceipt {
  id: number
  vendor: string
  amount: number
  currency: string
  paymentType: PaymentType
  billingFrequency: BillingFrequency
  category: string
  purpose: string
  invoiceDate: string
  invoiceNumber: string
  emailSender?: string
  emailSubject?: string
  emailSnippet?: string
  rawEmailBody?: string
  emailAccountId?: number
  groupId?: number
  subscriptionId?: number
  notes?: string
  recipientEmail?: string
  hasPdfAttachment: boolean
  pdfFilename?: string
  pdfTextPreview?: string
  pdfDataBase64?: string
  lineItems: LineItem[]
  confidenceScore: number
  isVerified: boolean
  createdAt: string
  updatedAt: string
}

export interface Subscription {
  id: number
  name: string
  vendor: string
  amount: number
  currency: string
  billingFrequency: BillingFrequency
  category: string
  purpose: string
  status: SubscriptionStatus
  emailAccountId?: number
  groupId?: number
  recipientEmail?: string
  lastBilledDate: string
  nextRenewalDate: string
  autoRenew: boolean
  latestInvoiceId?: number
  totalSpentToDate: number
  iconName?: string
  createdAt: string
  updatedAt: string
}

export interface CategoryBreakdown {
  category: string
  total: number
  count: number
  percentage: number
}

export interface UpcomingRenewal {
  id: number
  name: string
  vendor: string
  amount: number
  currency: string
  billingFrequency: BillingFrequency
  category: string
  purpose: string
  nextRenewalDate: string
  daysLeft: number
  iconName?: string
  status: SubscriptionStatus
}

export interface ActivityEvent {
  id: number
  eventType: string
  title: string
  description: string
  amount?: number
  currency?: string
  vendor?: string
  emailAccountId?: number
  groupId?: number
  createdAt: string
}

export interface MonthlySpendSegment {
  service?: string
  category: string
  amount: number
  color: string
  percentage: number
}

export interface MonthlySpendBar {
  month: string
  shortMonth: string
  total: number
  computedTotal?: number
  segments: MonthlySpendSegment[]
}

export interface ServiceBreakdownItem {
  service: string
  amount: number
  percentage: number
  color: string
}

export interface DashboardStats {
  totalSpentAllTime: number
  totalSpentMonth: number
  lastMonthSpend?: number
  monthToDateSpend?: number
  forecastSpend?: number
  lastMonthLabel?: string
  currentMonthLabel?: string
  taxAmount?: number
  serviceBreakdown?: ServiceBreakdownItem[]
  monthlyRecurringBurn: number
  annualRecurringBurn?: number
  activeSubscriptionsCount: number
  totalInvoicesCount: number
  categoryBreakdown: CategoryBreakdown[]
  recurringTotal: number
  onetimeTotal: number
  upcomingRenewals: UpcomingRenewal[]
  monthlySpending?: MonthlySpendBar[]
  recentActivities?: ActivityEvent[]
  activeGroupName?: string
  emailAccount?: EmailAccount
  emailAccounts?: EmailAccount[]
  activeEmailAccountId?: number
  activeEmailAddress?: string
}

export interface YearlyQuarterSpend {
  Q1: number
  Q2: number
  Q3: number
  Q4: number
}

export interface YearlySummaryItem {
  year: number
  totalSpend: number
  invoiceCount: number
  averageMonthly: number
  topVendor: string
  yoyGrowthPct: number
  quarterlySpend: YearlyQuarterSpend
  categoryBreakdown: Record<string, number>
  vendorBreakdown: Record<string, number>
  monthlyTotals: { month: string; total: number }[]
}

export interface YearlyHistoryData {
  allYears: number[]
  yearlySummaries: YearlySummaryItem[]
  grandTotalAllYears: number
  totalInvoicesAllYears: number
}

export interface AppState {
  currentTab: 'dashboard' | 'subscriptions' | 'invoices' | 'monthly-costs' | 'feed' | 'yearly-history'
  searchQuery: string
  selectedCategory: string
  selectedPaymentType: string
  selectedInvoice: InvoiceReceipt | null
  activeGroupId?: number | null
  activeGroupName?: string
  activeEmailAccountId?: number | null
  isSyncModalOpen: boolean
  isAddInvoiceModalOpen: boolean
  isAddSubscriptionModalOpen: boolean
  isAddGroupModalOpen: boolean
  isSimulating: boolean
  autoSyncActive: boolean
}
