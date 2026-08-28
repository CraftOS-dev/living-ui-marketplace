import React, { useState, useMemo } from 'react'
import type { InvoiceReceipt, Subscription } from '../types'
import { ALL_CATEGORIES } from '../types'
import { Card, Badge, Input, Button } from './ui'
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  CreditCard,
  Receipt,
  Search,
  FileText,
  Download,
} from 'lucide-react'

interface MonthlyCostsViewProps {
  invoices: InvoiceReceipt[]
  subscriptions: Subscription[]
  onSelectInvoice: (invoice: InvoiceReceipt) => void
  onOpenAddModal?: () => void
  onNavigateTab: (tab: any) => void
  activeGroupName?: string
  currencySymbol?: string
}

interface MonthData {
  key: string // e.g. '2026-08'
  label: string // e.g. 'August 2026'
  shortLabel: string // e.g. 'Aug 2026'
  shortMonth: string // e.g. 'Aug'
  year: number
  monthNum: number // 1-12
  invoices: InvoiceReceipt[]
  totalSpend: number
  recurringSpend: number
  oneTimeSpend: number
  transactionCount: number
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

const SHORT_MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
]

export const MonthlyCostsView: React.FC<MonthlyCostsViewProps> = ({
  invoices,
  subscriptions = [],
  onSelectInvoice,
  onOpenAddModal: _onOpenAddModal,
  onNavigateTab: _onNavigateTab,
  activeGroupName: _activeGroupName = 'All Workspaces',
  currencySymbol = '$',
}) => {
  // Search & category filter inside selected month
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all')

  const allCategories = useMemo(() => {
    return Array.from(new Set([
      ...ALL_CATEGORIES,
      ...invoices.map((i) => i.category).filter(Boolean),
      ...subscriptions.map((s) => s.category).filter(Boolean),
    ]))
  }, [invoices, subscriptions])

  // 1. Build list of months from available invoices, active subscriptions, and default 6-month window
  const allMonthsData = useMemo<MonthData[]>(() => {
    const monthsMap = new Map<string, InvoiceReceipt[]>()

    // Ensure past 6 months exist in list (March 2026 -> August 2026)
    const currentYear = 2026
    const currentMonthIndex = 7 // August (0-indexed)

    for (let i = 5; i >= 0; i--) {
      let mIdx = currentMonthIndex - i
      let y = currentYear
      if (mIdx < 0) {
        mIdx += 12
        y -= 1
      }
      const key = `${y}-${String(mIdx + 1).padStart(2, '0')}`
      monthsMap.set(key, [])
    }

    // Distribute all actual invoices into their respective months
    invoices.forEach((inv) => {
      let key = `${currentYear}-${String(currentMonthIndex + 1).padStart(2, '0')}`
      if (inv.invoiceDate) {
        try {
          const d = new Date(inv.invoiceDate)
          if (!isNaN(d.getTime())) {
            key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
          }
        } catch {
          // fallback
        }
      }
      if (!monthsMap.has(key)) {
        monthsMap.set(key, [])
      }
      monthsMap.get(key)!.push(inv)
    })

    // Active subscriptions list
    const activeSubs = subscriptions.filter((s) => (s.status || 'active').toLowerCase() === 'active')

    // Sort months descending (latest first)
    const sortedKeys = Array.from(monthsMap.keys()).sort().reverse()

    // For each month, include recurring subscriptions that were active/created in or before that month
    sortedKeys.forEach((key, kIdx) => {
      const monthInvs = monthsMap.get(key) || []
      const parts = key.split('-')
      const targetYear = parseInt(parts[0] || '2026', 10)
      const targetMonth = parseInt(parts[1] || '08', 10)

      activeSubs.forEach((sub) => {
        // Determine start period of subscription
        let subStartYear = 2026
        let subStartMonth = 8
        if (sub.createdAt) {
          try {
            const subDate = new Date(sub.createdAt)
            if (!isNaN(subDate.getTime())) {
              subStartYear = subDate.getFullYear()
              subStartMonth = subDate.getMonth() + 1
            }
          } catch {
            // default
          }
        }

        // Only include subscription if target month is on or after the subscription start month
        const isAfterOrEqualStart = (targetYear > subStartYear) || (targetYear === subStartYear && targetMonth >= subStartMonth)
        if (!isAfterOrEqualStart) {
          return // Subscription did not exist in this past month!
        }

        const hasExisting = monthInvs.some((inv) =>
          (inv.subscriptionId && String(inv.subscriptionId) === String(sub.id)) ||
          ((inv.vendor || '').toLowerCase() === (sub.vendor || sub.name || '').toLowerCase() && inv.paymentType === 'subscription')
        )

        if (!hasExisting) {
          let monthlyAmount = sub.amount
          const freq = (sub.billingFrequency || 'monthly').toLowerCase()
          if (freq === 'yearly') monthlyAmount = sub.amount / 12.0
          else if (freq === 'weekly') monthlyAmount = sub.amount * 4.33
          else if (freq === 'quarterly') monthlyAmount = sub.amount / 3.0

          monthInvs.push({
            id: `SUB-${sub.id}-${kIdx}`,
            vendor: sub.vendor || sub.name,
            amount: Math.round(monthlyAmount * 100) / 100,
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
            createdAt: sub.createdAt || `${key}-01T00:00:00.000Z`,
            updatedAt: sub.updatedAt || `${key}-01T00:00:00.000Z`,
          })
        }
      })

      monthsMap.set(key, monthInvs)
    })

    return sortedKeys.map((key) => {
      const parts = key.split('-')
      const y = parseInt(parts[0] || '2026', 10)
      const mNum = parseInt(parts[1] || '08', 10)
      const mIdx = Math.max(0, Math.min(11, mNum - 1))
      const monthInvs = monthsMap.get(key) || []

      const totalSpend = monthInvs.reduce((sum, inv) => sum + (Number(inv.amount) || 0), 0)
      const recurringSpend = monthInvs
        .filter((inv) => inv.paymentType === 'subscription')
        .reduce((sum, inv) => sum + (Number(inv.amount) || 0), 0)
      const oneTimeSpend = monthInvs
        .filter((inv) => inv.paymentType !== 'subscription')
        .reduce((sum, inv) => sum + (Number(inv.amount) || 0), 0)

      return {
        key,
        label: `${MONTH_NAMES[mIdx] || 'August'} ${y}`,
        shortLabel: `${SHORT_MONTH_NAMES[mIdx] || 'Aug'} ${y}`,
        shortMonth: SHORT_MONTH_NAMES[mIdx] || 'Aug',
        year: y,
        monthNum: mNum,
        invoices: monthInvs,
        totalSpend: Math.round(totalSpend * 100) / 100,
        recurringSpend: Math.round(recurringSpend * 100) / 100,
        oneTimeSpend: Math.round(oneTimeSpend * 100) / 100,
        transactionCount: monthInvs.length,
      }
    })
  }, [invoices, subscriptions])

  const fallbackMonth: MonthData = useMemo(() => ({
    key: '2026-08',
    label: 'August 2026',
    shortLabel: 'Aug 2026',
    shortMonth: 'Aug',
    year: 2026,
    monthNum: 8,
    invoices: [],
    totalSpend: 0,
    recurringSpend: 0,
    oneTimeSpend: 0,
    transactionCount: 0,
  }), [])

  // Selected Month State (defaults to current month: August 2026)
  const defaultMonthKey = allMonthsData[0]?.key || '2026-08'
  const [selectedMonthKey, setSelectedMonthKey] = useState<string>(defaultMonthKey)

  const activeMonth = useMemo(() => {
    return allMonthsData.find((m) => m.key === selectedMonthKey) || allMonthsData[0] || fallbackMonth
  }, [allMonthsData, selectedMonthKey, fallbackMonth])

  // Previous month for MoM comparison
  const prevMonth = useMemo(() => {
    const idx = allMonthsData.findIndex((m) => m.key === selectedMonthKey)
    if (idx !== -1 && idx + 1 < allMonthsData.length) {
      return allMonthsData[idx + 1]
    }
    return null
  }, [allMonthsData, selectedMonthKey])

  // MoM Delta calculation
  const momDelta = prevMonth ? activeMonth.totalSpend - prevMonth.totalSpend : 0
  const momPct = prevMonth && prevMonth.totalSpend > 0 ? (momDelta / prevMonth.totalSpend) * 100 : 0

  // Category breakdown for selected month
  const categoryBreakdown = useMemo(() => {
    const catMap = new Map<string, { total: number; count: number }>()
    activeMonth.invoices.forEach((inv) => {
      const cat = inv.category || 'Other Services'
      const existing = catMap.get(cat) || { total: 0, count: 0 }
      catMap.set(cat, {
        total: existing.total + (Number(inv.amount) || 0),
        count: existing.count + 1,
      })
    })

    return Array.from(catMap.entries())
      .map(([cat, data]) => ({
        category: cat,
        total: Math.round(data.total * 100) / 100,
        count: data.count,
        percentage: activeMonth.totalSpend > 0 ? (data.total / activeMonth.totalSpend) * 100 : 0,
      }))
      .sort((a, b) => b.total - a.total)
  }, [activeMonth])

  // Vendor breakdown for selected month
  const vendorBreakdown = useMemo(() => {
    const vMap = new Map<string, { total: number; count: number }>()
    activeMonth.invoices.forEach((inv) => {
      const v = inv.vendor || 'Unknown'
      const existing = vMap.get(v) || { total: 0, count: 0 }
      vMap.set(v, {
        total: existing.total + (Number(inv.amount) || 0),
        count: existing.count + 1,
      })
    })

    return Array.from(vMap.entries())
      .map(([vendor, data]) => ({
        vendor,
        total: Math.round(data.total * 100) / 100,
        count: data.count,
        percentage: activeMonth.totalSpend > 0 ? (data.total / activeMonth.totalSpend) * 100 : 0,
      }))
      .sort((a, b) => b.total - a.total)
  }, [activeMonth])

  // Filtered invoices inside selected month
  const filteredInvoices = useMemo(() => {
    const q = (searchQuery || '').trim().toLowerCase()
    return activeMonth.invoices.filter((inv) => {
      const matchesCat = selectedCategory === 'all' || inv.category === selectedCategory
      if (!matchesCat) return false
      if (!q) return true

      const vendor = (inv.vendor || '').toLowerCase()
      const purpose = (inv.purpose || '').toLowerCase()
      const invoiceNumber = (inv.invoiceNumber || '').toLowerCase()
      const category = (inv.category || '').toLowerCase()
      const amountStr = String(inv.amount ?? '')
      const currency = (inv.currency || '').toLowerCase()

      return (
        vendor.includes(q) ||
        purpose.includes(q) ||
        invoiceNumber.includes(q) ||
        category.includes(q) ||
        amountStr.includes(q) ||
        currency.includes(q)
      )
    })
  }, [activeMonth, searchQuery, selectedCategory])

  const currentMonthData = useMemo(() => {
    const now = new Date()
    const nowKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    return allMonthsData.find((m) => m.key === nowKey) || allMonthsData[0] || fallbackMonth
  }, [allMonthsData, fallbackMonth])

  const handleDownloadReport = () => {
    const targetMonth = activeMonth || currentMonthData || fallbackMonth
    const monthInvs = targetMonth.invoices || []

    const escapeCsv = (val: any) => {
      const str = String(val ?? '')
      if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`
      }
      return str
    }

    const headers = [
      'Date',
      'Vendor / Service',
      'Purpose / Item',
      'Category',
      'Invoice / Receipt Number',
      `Amount (${currencySymbol})`,
      'Currency',
      'Payment Type',
    ]

    const dataRows = monthInvs.map((inv) => [
      escapeCsv(inv.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString() : 'N/A'),
      escapeCsv(inv.vendor || 'Unknown Vendor'),
      escapeCsv(inv.purpose || '-'),
      escapeCsv(inv.category || 'Other Services'),
      escapeCsv(inv.invoiceNumber || '-'),
      escapeCsv(inv.amount.toFixed(2)),
      escapeCsv(inv.currency || 'USD'),
      escapeCsv(inv.paymentType === 'subscription' ? 'Recurring Subscription' : 'One-Time Bill'),
    ])

    const summarySection = [
      [],
      ['SUMMARY TOTALS', '', '', '', '', '', '', ''],
      ['Total Monthly Cost', '', '', '', '', escapeCsv(targetMonth.totalSpend.toFixed(2)), escapeCsv(currencySymbol), ''],
      ['Recurring Subscriptions', '', '', '', '', escapeCsv(targetMonth.recurringSpend.toFixed(2)), escapeCsv(currencySymbol), ''],
      ['One-Time Bills', '', '', '', '', escapeCsv(targetMonth.oneTimeSpend.toFixed(2)), escapeCsv(currencySymbol), ''],
      ['Total Recorded Transactions', '', '', '', '', escapeCsv(targetMonth.transactionCount), '', ''],
    ]

    const catSection = [
      [],
      ['CATEGORY BREAKDOWN', 'Category Share (%)', 'Total Spent', '', '', '', '', ''],
      ...categoryBreakdown.map((c) => [
        escapeCsv(c.category),
        escapeCsv(`${c.percentage.toFixed(1)}%`),
        escapeCsv(`${currencySymbol}${c.total.toFixed(2)}`),
        '', '', '', '', ''
      ])
    ]

    const allLines = [
      [`Monthly Cost Report - ${targetMonth.label}`],
      [`Generated: ${new Date().toLocaleString()}`],
      [],
      headers,
      ...dataRows,
      ...summarySection,
      ...catSection,
    ]

    const csvContent = allLines.map((row) => row.join(',')).join('\r\n')
    // Add UTF-8 BOM (\uFEFF) for 100% clean Excel and text editor compatibility
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `Monthly_Costs_Report_${targetMonth.key}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
      {/* ------------------------------------------------------------- */}
      {/* HEADER: Title & Description                                   */}
      {/* ------------------------------------------------------------- */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2 className="page-header-title">
              Monthly Cost Explorer
            </h2>
          </div>
          <p className="page-header-subtitle">
            Track monthly costs, recurring fees, and one-time bills.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Button
            variant="secondary"
            size="sm"
            icon={<Download size={14} />}
            onClick={handleDownloadReport}
            title={`Download current month (${currentMonthData?.label || activeMonth.label}) expense report`}
          >
            Download Report
          </Button>
        </div>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* INTERACTIVE MONTH SELECTOR TABS & QUICK TIMELINE               */}
      {/* ------------------------------------------------------------- */}
      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Select Month:
            </span>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              {allMonthsData.length} months available
            </span>
          </div>

          {/* Month Pills */}
          <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
            {allMonthsData.map((m) => {
              const isSelected = m.key === activeMonth.key
              return (
                <button
                  key={m.key}
                  onClick={() => setSelectedMonthKey(m.key)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    padding: '8px 14px',
                    borderRadius: 'var(--radius-md)',
                    border: isSelected ? '1px solid var(--color-primary)' : '1px solid var(--border-primary)',
                    backgroundColor: isSelected ? 'rgba(255, 153, 0, 0.12)' : 'var(--bg-secondary)',
                    color: isSelected ? 'var(--color-primary)' : 'var(--text-primary)',
                    cursor: 'pointer',
                    minWidth: '120px',
                    transition: 'all 0.15s ease',
                    boxShadow: isSelected ? '0 0 10px rgba(255, 153, 0, 0.2)' : 'none',
                  }}
                >
                  <span style={{ fontSize: '0.76rem', fontWeight: isSelected ? 700 : 500, color: isSelected ? 'var(--color-primary)' : 'var(--text-muted)' }}>
                    {m.label}
                  </span>
                  <span style={{ fontSize: '0.96rem', fontWeight: 800, marginTop: '2px', fontVariantNumeric: 'tabular-nums' }}>
                    {currencySymbol}{m.totalSpend.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span style={{ fontSize: '0.70rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {m.transactionCount} bill{m.transactionCount === 1 ? '' : 's'}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </Card>

      {/* ------------------------------------------------------------- */}
      {/* KEY MONTHLY KPIS FOR SELECTED MONTH                           */}
      {/* ------------------------------------------------------------- */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 'var(--space-3)' }}>
        {/* Total Cost Spent */}
        <Card>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                Total Monthly Cost
              </span>
              <DollarSign size={16} color="var(--color-primary)" />
            </div>
            <span style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
              {currencySymbol}{activeMonth.totalSpend.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.74rem', marginTop: '2px' }}>
              {prevMonth ? (
                momDelta >= 0 ? (
                  <span style={{ color: '#ef4444', display: 'flex', alignItems: 'center', gap: '2px', fontWeight: 600 }}>
                    <TrendingUp size={12} /> +{currencySymbol}{momDelta.toFixed(2)} ({momPct > 0 ? `+${momPct.toFixed(1)}%` : '0%'})
                  </span>
                ) : (
                  <span style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: '2px', fontWeight: 600 }}>
                    <TrendingDown size={12} /> -{currencySymbol}{Math.abs(momDelta).toFixed(2)} ({momPct.toFixed(1)}%)
                  </span>
                )
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>Initial month record</span>
              )}
              <span style={{ color: 'var(--text-muted)' }}>vs prev month</span>
            </div>
          </div>
        </Card>

        {/* Recurring Subscriptions Spend */}
        <Card>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                Recurring Subscriptions
              </span>
              <CreditCard size={16} color="#3b82f6" />
            </div>
            <span style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
              {currencySymbol}{activeMonth.recurringSpend.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
              {activeMonth.totalSpend > 0 ? ((activeMonth.recurringSpend / activeMonth.totalSpend) * 100).toFixed(1) : '0'}% of total monthly spend
            </span>
          </div>
        </Card>

        {/* One-Time & Ingestion Invoices */}
        <Card>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                One-Time & Direct Bills
              </span>
              <Receipt size={16} color="#10b981" />
            </div>
            <span style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
              {currencySymbol}{activeMonth.oneTimeSpend.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
              {activeMonth.totalSpend > 0 ? ((activeMonth.oneTimeSpend / activeMonth.totalSpend) * 100).toFixed(1) : '0'}% of total monthly spend
            </span>
          </div>
        </Card>

        {/* Transactions & Avg Cost */}
        <Card>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                Transactions / Bills
              </span>
              <FileText size={16} color="#8b5cf6" />
            </div>
            <span style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
              {activeMonth.transactionCount}
            </span>
            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
              Avg {currencySymbol}
              {activeMonth.transactionCount > 0
                ? (activeMonth.totalSpend / activeMonth.transactionCount).toFixed(2)
                : '0.00'}{' '}
              / bill
            </span>
          </div>
        </Card>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* 2-COLUMN BREAKDOWN: Category Share & Vendor Ranking            */}
      {/* ------------------------------------------------------------- */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--space-3)' }}>
        {/* Category Breakdown for Selected Month */}
        <Card>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Category Spend in {activeMonth.label}
              </h4>
              <Badge variant="default" size="sm">
                {categoryBreakdown.length} Categories
              </Badge>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
              {categoryBreakdown.map((cat, idx) => (
                <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.80rem' }}>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{cat.category}</span>
                    <span style={{ color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                      {currencySymbol}{cat.total.toFixed(2)} ({cat.percentage.toFixed(1)}%)
                    </span>
                  </div>
                  <div style={{ width: '100%', height: '6px', borderRadius: '3px', backgroundColor: 'var(--bg-tertiary)', overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${Math.min(cat.percentage, 100)}%`,
                        height: '100%',
                        borderRadius: '3px',
                        backgroundColor: 'var(--color-primary)',
                      }}
                    />
                  </div>
                </div>
              ))}

              {categoryBreakdown.length === 0 && (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                  No category expenses recorded for this month.
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* Top Vendors for Selected Month */}
        <Card>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Top Vendors in {activeMonth.label}
              </h4>
              <Badge variant="default" size="sm">
                {vendorBreakdown.length} Vendors
              </Badge>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
              {vendorBreakdown.map((v, idx) => (
                <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.80rem' }}>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{v.vendor}</span>
                    <span style={{ color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                      {currencySymbol}{v.total.toFixed(2)} ({v.percentage.toFixed(1)}%)
                    </span>
                  </div>
                  <div style={{ width: '100%', height: '6px', borderRadius: '3px', backgroundColor: 'var(--bg-tertiary)', overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${Math.min(v.percentage, 100)}%`,
                        height: '100%',
                        borderRadius: '3px',
                        backgroundColor: '#3b82f6',
                      }}
                    />
                  </div>
                </div>
              ))}

              {vendorBreakdown.length === 0 && (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                  No vendor expenses recorded for this month.
                </div>
              )}
            </div>
          </div>
        </Card>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* ITEMIZED MONTHLY EXPENSES & INVOICES TABLE                     */}
      {/* ------------------------------------------------------------- */}
      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {/* Table Header & Search Filter */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Itemized Expenses for {activeMonth.label}
              </h3>
              <p style={{ margin: '2px 0 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                All receipts, subscription bills, and one-time charges logged in this month
              </p>
            </div>

            {/* Filter controls */}
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ position: 'relative', width: '180px' }}>
                <Search size={13} style={{ position: 'absolute', left: '10px', top: '10px', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                <Input
                  placeholder="Search bills..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{ paddingLeft: '30px', height: '34px', fontSize: '0.80rem' }}
                />
              </div>

              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                style={{
                  padding: '0 10px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-primary)',
                  fontSize: '0.80rem',
                  height: '34px',
                }}
              >
                <option value="all">All Categories</option>
                {allCategories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Table */}
          <div style={{ overflowX: 'auto', width: '100%' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-primary)', color: 'var(--text-muted)', fontSize: '0.74rem', textTransform: 'uppercase' }}>
                  <th style={{ padding: '8px 12px' }}>Vendor & Service</th>
                  <th style={{ padding: '8px 12px' }}>Category</th>
                  <th style={{ padding: '8px 12px' }}>Invoice #</th>
                  <th style={{ padding: '8px 12px' }}>Date</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>Amount</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center' }}>Receipt PDF</th>
                </tr>
              </thead>
              <tbody>
                {filteredInvoices.map((inv) => {
                  const dtStr = inv.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString() : 'N/A'
                  return (
                    <tr
                      key={inv.id}
                      onClick={() => onSelectInvoice(inv)}
                      style={{
                        borderBottom: '1px solid var(--border-primary)',
                        cursor: 'pointer',
                        transition: 'background-color 0.15s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.03)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent'
                      }}
                    >
                      {/* Vendor */}
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{inv.vendor}</span>
                          {inv.purpose && (
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {inv.purpose}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Category */}
                      <td style={{ padding: '10px 12px' }}>
                        <span
                          style={{
                            padding: '2px 8px',
                            borderRadius: '4px',
                            backgroundColor: 'var(--bg-secondary)',
                            border: '1px solid var(--border-primary)',
                            fontSize: '0.74rem',
                            color: 'var(--text-secondary)',
                          }}
                        >
                          {inv.category}
                        </span>
                      </td>

                      {/* Invoice Number */}
                      <td style={{ padding: '10px 12px', color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.76rem' }}>
                        {inv.invoiceNumber || '-'}
                      </td>

                      {/* Date */}
                      <td style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontSize: '0.76rem' }}>
                        {dtStr}
                      </td>

                      {/* Amount */}
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                        {currencySymbol}{Number(inv.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>

                      {/* Receipt PDF */}
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        {inv.hasPdfAttachment ? (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              backgroundColor: 'rgba(239, 68, 68, 0.12)',
                              color: '#ef4444',
                              fontSize: '0.72rem',
                              fontWeight: 600,
                            }}
                          >
                            <FileText size={12} /> PDF
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}

                {filteredInvoices.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
                      No receipts or invoices recorded for {activeMonth.label}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Card>
    </div>
  )
}
