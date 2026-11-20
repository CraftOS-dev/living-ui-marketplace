/**
 * The screens' shared figures: the calendar, the month model (Monthly Costs and
 * the dashboard's Spend Summary), the yearly model (Multi-Year History cards and
 * statements) and the currency rule for totals.
 *
 * - The calendar follows today's date: the month window ends at the current
 *   month, and Multi-Year History covers this year and the three before it.
 * - Totals add only amounts in the shown workspace's currency. The app has no
 *   exchange rates, so amounts in other currencies are grouped per currency and
 *   named beside the totals, never converted or added in.
 *
 * pb/pb_hooks/lib_agent.js holds the server copy the agent operations use:
 * change both together.
 */

import type { InvoiceReceipt, MonthlySpendBar, Subscription, YearlySummaryItem } from '../types'
import { getCurrencySymbol } from '../types'

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

export const SHORT_MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
]

export interface CurrencyTotal {
  currency: string
  total: number
  count: number
}

export const round2 = (x: number): number => Math.round(x * 100) / 100

const codeOf = (currency?: string): string => (currency || 'USD').toUpperCase()

export const monthKey = (year: number, monthNum: number): string => `${year}-${String(monthNum).padStart(2, '0')}`

/** Sum the amounts in the shown currency; group every other currency apart. */
export function splitByCurrency<T extends { amount: number; currency?: string }>(
  rows: T[],
  shown: string
): { counted: T[]; total: number; others: CurrencyTotal[] } {
  const code = codeOf(shown)
  const counted: T[] = []
  const map = new Map<string, CurrencyTotal>()
  let total = 0
  rows.forEach((r) => {
    const c = codeOf(r.currency)
    const amt = Number(r.amount) || 0
    if (c === code) {
      counted.push(r)
      total += amt
      return
    }
    const o = map.get(c) || { currency: c, total: 0, count: 0 }
    o.total += amt
    o.count += 1
    map.set(c, o)
  })
  const others = Array.from(map.values())
    .sort((a, b) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0))
    .map((o) => ({ ...o, total: round2(o.total) }))
  return { counted, total, others }
}

/** "€40.00 EUR · £12.00 GBP" */
export function formatOthers(others: CurrencyTotal[]): string {
  return others
    .map((o) => `${getCurrencySymbol(o.currency)}${o.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${o.currency}`)
    .join(' · ')
}

export const isActiveSubscription = (s: Subscription): boolean => (s.status || 'active').toLowerCase() === 'active'

/** Monthly equivalent: yearly ÷ 12, weekly × 4.33, quarterly ÷ 3, monthly as is. */
export function monthlyEquivalent(s: Subscription): number {
  const freq = (s.billingFrequency || 'monthly').toLowerCase()
  if (freq === 'yearly') return s.amount / 12.0
  if (freq === 'weekly') return s.amount * 4.33
  if (freq === 'quarterly') return s.amount / 3.0
  return s.amount
}

/** What one uncovered subscription adds to Total Money Spent (counted once). */
function spentOnce(s: Subscription): number {
  const freq = (s.billingFrequency || 'monthly').toLowerCase()
  if (freq === 'weekly') return s.amount * 4.33
  return s.amount
}

/** An invoice already covers a subscription. */
export function coversSubscription(inv: InvoiceReceipt, s: Subscription): boolean {
  return Boolean(
    (inv.subscriptionId && String(inv.subscriptionId) === String(s.id)) ||
    ((inv.vendor || '').toLowerCase() === (s.vendor || s.name || '').toLowerCase() && inv.paymentType === 'subscription')
  )
}

/** The month a subscription started (its creation), or the current month. */
function startOf(sub: Subscription, now: Date): { year: number; month: number } {
  if (sub.createdAt) {
    const d = new Date(sub.createdAt)
    if (!isNaN(d.getTime())) return { year: d.getFullYear(), month: d.getMonth() + 1 }
  }
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}

/** The dashboard's KPI figures. */
export function dashboardTotals(invoices: InvoiceReceipt[], subs: Subscription[], shown: string) {
  const active = subs.filter(isActiveSubscription)
  const burn = splitByCurrency(active.map((s) => ({ amount: monthlyEquivalent(s), currency: s.currency })), shown)
  const spentRows = invoices.map((inv) => ({ amount: Number(inv.amount) || 0, currency: inv.currency }))
  active.forEach((s) => {
    if (!invoices.some((inv) => coversSubscription(inv, s))) spentRows.push({ amount: spentOnce(s), currency: s.currency })
  })
  const spent = splitByCurrency(spentRows, shown)
  return {
    monthlyBurn: round2(burn.total > 0 ? burn.total : 0),
    totalSpent: round2(spent.total),
    invoiceSum: round2(splitByCurrency(invoices, shown).total),
    others: spent.others,
    activeCount: active.length,
  }
}

export interface MonthData {
  key: string // e.g. '2026-11'
  label: string // e.g. 'November 2026'
  shortLabel: string // e.g. 'Nov 2026'
  shortMonth: string // e.g. 'Nov'
  year: number
  monthNum: number // 1-12
  invoices: InvoiceReceipt[] // every row of the month, each in its own currency
  counted: InvoiceReceipt[] // the rows in the shown currency, which the totals add
  totalSpend: number
  recurringSpend: number
  oneTimeSpend: number
  transactionCount: number
  others: CurrencyTotal[]
}

/**
 * Monthly Costs: the six months up to the current one plus every month that has
 * an invoice, newest first. Each month also gets an estimated row for every
 * active subscription that had started and that no row of the month covers
 * (checked against the growing list).
 */
export function buildMonths(
  invoices: InvoiceReceipt[],
  subscriptions: Subscription[],
  shown: string,
  now: Date = new Date()
): MonthData[] {
  const monthsMap = new Map<string, InvoiceReceipt[]>()
  const currentKey = monthKey(now.getFullYear(), now.getMonth() + 1)

  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    monthsMap.set(monthKey(d.getFullYear(), d.getMonth() + 1), [])
  }

  invoices.forEach((inv) => {
    let key = currentKey
    if (inv.invoiceDate) {
      const d = new Date(inv.invoiceDate)
      if (!isNaN(d.getTime())) key = monthKey(d.getFullYear(), d.getMonth() + 1)
    }
    if (!monthsMap.has(key)) monthsMap.set(key, [])
    monthsMap.get(key)!.push(inv)
  })

  const activeSubs = subscriptions.filter(isActiveSubscription)
  const sortedKeys = Array.from(monthsMap.keys()).sort().reverse()

  sortedKeys.forEach((key, kIdx) => {
    const monthInvs = monthsMap.get(key) || []
    const [targetYear = now.getFullYear(), targetMonth = now.getMonth() + 1] = key.split('-').map(Number)

    activeSubs.forEach((sub) => {
      const start = startOf(sub, now)
      const isAfterOrEqualStart = targetYear > start.year || (targetYear === start.year && targetMonth >= start.month)
      if (!isAfterOrEqualStart) return
      if (monthInvs.some((inv) => coversSubscription(inv, sub))) return

      monthInvs.push({
        id: `SUB-${sub.id}-${kIdx}`,
        vendor: sub.vendor || sub.name,
        amount: round2(monthlyEquivalent(sub)),
        currency: sub.currency || 'USD',
        paymentType: 'subscription',
        billingFrequency: sub.billingFrequency || 'monthly',
        category: sub.category || 'Software & SaaS',
        purpose: sub.purpose || `${sub.name} (${sub.billingFrequency || 'monthly'} subscription)`,
        invoiceNumber: `SUB-${sub.id}-${key.replace('-', '')}`,
        invoiceDate: `${key}-01T00:00:00.000Z`,
        subscriptionId: sub.id,
        hasPdfAttachment: false,
        lineItems: [],
        confidenceScore: 1.0,
        isVerified: true,
        estimated: true,
        createdAt: sub.createdAt || `${key}-01T00:00:00.000Z`,
        updatedAt: sub.updatedAt || `${key}-01T00:00:00.000Z`,
      })
    })
    monthsMap.set(key, monthInvs)
  })

  const sum = (list: InvoiceReceipt[]) => list.reduce((s, inv) => s + (Number(inv.amount) || 0), 0)
  return sortedKeys.map((key) => {
    const [y = now.getFullYear(), mNum = now.getMonth() + 1] = key.split('-').map(Number)
    const mIdx = Math.max(0, Math.min(11, mNum - 1))
    const items = monthsMap.get(key) || []
    const split = splitByCurrency(items, shown)
    return {
      key,
      label: `${MONTH_NAMES[mIdx]} ${y}`,
      shortLabel: `${SHORT_MONTH_NAMES[mIdx]} ${y}`,
      shortMonth: SHORT_MONTH_NAMES[mIdx] || '',
      year: y,
      monthNum: mNum,
      invoices: items,
      counted: split.counted,
      totalSpend: round2(split.total),
      recurringSpend: round2(sum(split.counted.filter((inv) => inv.paymentType === 'subscription'))),
      oneTimeSpend: round2(sum(split.counted.filter((inv) => inv.paymentType !== 'subscription'))),
      transactionCount: items.length,
      others: split.others,
    }
  })
}

/** Spend Summary: one bar per month for the six months up to the current one
 *  (oldest first), each the Monthly Costs month split by vendor. */
export function spendSummaryBars(
  invoices: InvoiceReceipt[],
  subscriptions: Subscription[],
  shown: string,
  now: Date = new Date()
): MonthlySpendBar[] {
  const months = buildMonths(invoices, subscriptions, shown, now)
  const bars: MonthlySpendBar[] = []
  for (let b = 5; b >= 0; b--) {
    const d = new Date(now.getFullYear(), now.getMonth() - b, 1)
    const m = months.find((x) => x.key === monthKey(d.getFullYear(), d.getMonth() + 1))
    if (!m) continue
    const vendorMap: Record<string, number> = {}
    m.counted.forEach((inv) => {
      const v = inv.vendor || 'Other Services'
      vendorMap[v] = (vendorMap[v] || 0) + (Number(inv.amount) || 0)
    })
    const segments = Object.entries(vendorMap)
      .sort((a, b2) => b2[1] - a[1])
      .map(([service, amt]) => ({
        service,
        category: service,
        amount: round2(amt),
        percentage: m.totalSpend > 0 ? Math.round((amt / m.totalSpend) * 1000) / 10 : 0,
        color: '#FF4F18',
      }))
    bars.push({ month: m.label, shortMonth: m.shortMonth, total: m.totalSpend, computedTotal: m.totalSpend, segments })
  }
  return bars
}

export interface YearlyModel {
  years: number[]
  statements: InvoiceReceipt[]
  summaries: YearlySummaryItem[]
  others: CurrencyTotal[]
}

/**
 * Multi-Year History: this year and the three before it. The statements are the
 * invoices plus one year-to-date estimate per active subscription and year from
 * its start (checked against the growing list); the year cards, quarters and
 * categories are added up from those same statements.
 */
export function buildYearly(
  invoices: InvoiceReceipt[],
  subscriptions: Subscription[],
  shown: string,
  now: Date = new Date()
): YearlyModel {
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1
  const years = [currentYear, currentYear - 1, currentYear - 2, currentYear - 3]
  const yearOf = (inv: InvoiceReceipt) => (inv.invoiceDate ? new Date(inv.invoiceDate).getFullYear() : currentYear)

  const list: InvoiceReceipt[] = [...invoices]
  const activeSubs = subscriptions.filter(isActiveSubscription)
  years.forEach((yr) => {
    activeSubs.forEach((sub, sIdx) => {
      const start = startOf(sub, now)
      if (yr < start.year) return
      if (list.some((inv) => yearOf(inv) === yr && coversSubscription(inv, sub))) return

      // What was spent up to now (no future projections)
      let elapsedMonths = 1
      if (yr === currentYear) {
        const startM = start.year === currentYear ? start.month : 1
        elapsedMonths = Math.max(1, currentMonth - startM + 1)
      } else if (yr < currentYear) {
        const startM = start.year === yr ? start.month : 1
        elapsedMonths = Math.max(1, 12 - startM + 1)
      }
      let spentUpToNow = sub.amount * elapsedMonths
      const freq = (sub.billingFrequency || 'monthly').toLowerCase()
      if (freq === 'yearly') spentUpToNow = sub.amount
      else if (freq === 'weekly') spentUpToNow = sub.amount * 4.33 * elapsedMonths
      else if (freq === 'quarterly') spentUpToNow = sub.amount * Math.max(1, Math.ceil(elapsedMonths / 3))

      list.push({
        id: 200000 + yr * 1000 + sIdx,
        vendor: sub.vendor || sub.name,
        amount: round2(spentUpToNow),
        currency: sub.currency || 'USD',
        paymentType: 'subscription',
        billingFrequency: sub.billingFrequency || 'monthly',
        category: sub.category || 'Software & SaaS',
        purpose: sub.purpose || `${sub.name} (${sub.billingFrequency || 'monthly'} subscription — YTD spent)`,
        invoiceNumber: `SUB-${sub.id}-${yr}`,
        invoiceDate: `${yr}-${String(start.month).padStart(2, '0')}-01T00:00:00.000Z`,
        subscriptionId: sub.id,
        hasPdfAttachment: false,
        lineItems: [],
        confidenceScore: 1.0,
        isVerified: true,
        estimated: true,
        createdAt: sub.createdAt || `${yr}-01-15T00:00:00.000Z`,
        updatedAt: sub.updatedAt || `${yr}-01-15T00:00:00.000Z`,
      })
    })
  })

  const summaries: YearlySummaryItem[] = years.map((y) => {
    const yearRows = list.filter((inv) => (inv.invoiceDate ? new Date(inv.invoiceDate).getFullYear() === y : y === currentYear))
    const counted = splitByCurrency(yearRows, shown).counted
    let total = 0
    const vMap: Record<string, number> = {}
    const cMap: Record<string, number> = {}
    const qMap = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 }
    const monthTotals = SHORT_MONTH_NAMES.map(() => 0)
    counted.forEach((inv) => {
      const amt = Number(inv.amount) || 0
      total += amt
      const v = inv.vendor || 'Other'
      vMap[v] = (vMap[v] || 0) + amt
      const c = inv.category || 'Other'
      cMap[c] = (cMap[c] || 0) + amt
      if (inv.invoiceDate) {
        const m = new Date(inv.invoiceDate).getMonth()
        if (m >= 0 && m < 12) monthTotals[m] = (monthTotals[m] || 0) + amt
        if (m < 3) qMap.Q1 += amt
        else if (m < 6) qMap.Q2 += amt
        else if (m < 9) qMap.Q3 += amt
        else qMap.Q4 += amt
      }
    })
    return {
      year: y,
      totalSpend: round2(total),
      invoiceCount: yearRows.filter((inv) => !inv.estimated).length,
      averageMonthly: round2(total / 12),
      topVendor: Object.entries(vMap).sort((a, b) => b[1] - a[1])[0]?.[0] || 'None',
      yoyGrowthPct: 0.0,
      quarterlySpend: qMap,
      categoryBreakdown: cMap,
      vendorBreakdown: vMap,
      monthlyTotals: SHORT_MONTH_NAMES.map((month, i) => ({ month, total: round2(monthTotals[i] || 0) })),
    }
  })

  const tracked = list.filter((inv) => years.includes(yearOf(inv)))
  return { years, statements: list, summaries, others: splitByCurrency(tracked, shown).others }
}
