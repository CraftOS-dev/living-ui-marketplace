import React, { useEffect, useState } from 'react'
import {
  Calendar,
  TrendingUp,
  Receipt,
  DollarSign,
  Search,
  ChevronRight,
} from 'lucide-react'
import { Card, Button, Badge } from './ui'
import { ApiService } from '../services'
import type { InvoiceReceipt, Subscription, YearlyHistoryData, YearlySummaryItem } from '../types'
import { ALL_CATEGORIES } from '../types'

interface YearlyHistoryViewProps {
  invoices: InvoiceReceipt[]
  subscriptions?: Subscription[]
  onSelectInvoice: (invoice: InvoiceReceipt) => void
  onNavigateTab?: (tab: any) => void
  activeAccountId?: number | null
  currencySymbol?: string
}

const YEAR_COLORS: Record<number, string> = {
  2026: '#3b82f6',
  2025: '#10b981',
  2024: '#8b5cf6',
  2023: '#f59e0b',
}

export const YearlyHistoryView: React.FC<YearlyHistoryViewProps> = ({
  invoices,
  subscriptions = [],
  onSelectInvoice,
  onNavigateTab: _onNavigateTab,
  activeAccountId,
  currencySymbol = '$',
}) => {
  const [historyData, setHistoryData] = useState<YearlyHistoryData | null>(null)
  const [selectedYear, setSelectedYear] = useState<number | 'all'>('all')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [currentPage, setCurrentPage] = useState<number>(1)
  const pageSize = 10

  useEffect(() => {
    let isMounted = true
    const fetchHistory = async () => {
      try {
        const data = await ApiService.getYearlyHistory(activeAccountId)
        if (isMounted) setHistoryData(data)
      } catch (err) {
        console.error('Failed to load yearly history:', err)
      }
    }

    fetchHistory()
    return () => {
      isMounted = false
    }
  }, [activeAccountId])

  // Combine actual invoices and active recurring subscriptions across tracked years
  const allYearlyInvoices = React.useMemo<InvoiceReceipt[]>(() => {
    const list: InvoiceReceipt[] = [...invoices]
    const activeSubs = (subscriptions || []).filter((s) => (s.status || 'active').toLowerCase() === 'active')

    const currentYear = 2026
    const currentMonth = 8 // August

    const years = [2026, 2025, 2024, 2023]
    years.forEach((yr) => {
      activeSubs.forEach((sub, sIdx) => {
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

        if (yr < subStartYear) {
          return // Subscription did not exist in this prior year!
        }

        const hasExisting = list.some((inv) => {
          const invYear = inv.invoiceDate ? new Date(inv.invoiceDate).getFullYear() : 2026
          return (
            invYear === yr &&
            ((inv.subscriptionId && inv.subscriptionId === sub.id) ||
             ((inv.vendor || '').toLowerCase() === (sub.vendor || sub.name || '').toLowerCase() && inv.paymentType === 'subscription'))
          )
        })

        if (!hasExisting) {
          // Calculate strictly what was spent up till now (no future projections)
          let elapsedMonths = 1
          if (yr === currentYear) {
            const startM = subStartYear === currentYear ? subStartMonth : 1
            elapsedMonths = Math.max(1, currentMonth - startM + 1)
          } else if (yr < currentYear) {
            const startM = subStartYear === yr ? subStartMonth : 1
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
            amount: Math.round(spentUpToNow * 100) / 100,
            currency: sub.currency || 'USD',
            paymentType: 'subscription',
            billingFrequency: sub.billingFrequency || 'monthly',
            category: sub.category || 'Software & SaaS',
            purpose: sub.purpose || `${sub.name} (${sub.billingFrequency || 'monthly'} subscription — YTD spent)`,
            invoiceNumber: `SUB-${sub.id}-${yr}`,
            invoiceDate: `${yr}-${String(subStartMonth).padStart(2, '0')}-01T00:00:00.000Z`,
            subscriptionId: sub.id,
            hasPdfAttachment: false,
            lineItems: [],
            confidenceScore: 1.0,
            isVerified: true,
            createdAt: sub.createdAt || `${yr}-01-15T00:00:00.000Z`,
            updatedAt: sub.updatedAt || `${yr}-01-15T00:00:00.000Z`,
          })
        }
      })
    })

    return list
  }, [invoices, subscriptions])

  const computedFromInvoices = React.useMemo<YearlySummaryItem[]>(() => {
    const years = [2026, 2025, 2024, 2023]
    return years.map((y) => {
      const yearInvs = allYearlyInvoices.filter((inv) => {
        if (!inv.invoiceDate) return y === 2026
        const d = new Date(inv.invoiceDate)
        return d.getFullYear() === y
      })
      const total = yearInvs.reduce((sum, inv) => sum + (Number(inv.amount) || 0), 0)
      const vMap: Record<string, number> = {}
      const cMap: Record<string, number> = {}
      const qMap = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 }
      const monthsMap: Record<string, number> = {
        Jan: 0, Feb: 0, Mar: 0, Apr: 0, May: 0, Jun: 0,
        Jul: 0, Aug: 0, Sep: 0, Oct: 0, Nov: 0, Dec: 0
      }

      yearInvs.forEach((inv) => {
        const v = inv.vendor || 'Other'
        vMap[v] = (vMap[v] || 0) + inv.amount
        const c = inv.category || 'Other'
        cMap[c] = (cMap[c] || 0) + inv.amount
        if (inv.invoiceDate) {
          const d = new Date(inv.invoiceDate)
          const m = d.getMonth()
          const mNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
          monthsMap[mNames[m]] = (monthsMap[mNames[m]] || 0) + inv.amount
          if (m < 3) qMap.Q1 += inv.amount
          else if (m < 6) qMap.Q2 += inv.amount
          else if (m < 9) qMap.Q3 += inv.amount
          else qMap.Q4 += inv.amount
        }
      })

      const topV = Object.entries(vMap).sort((a, b) => b[1] - a[1])[0]?.[0] || 'None'

      return {
        year: y,
        totalSpend: Math.round(total * 100) / 100,
        invoiceCount: yearInvs.length,
        averageMonthly: Math.round((total / 12) * 100) / 100,
        topVendor: topV,
        yoyGrowthPct: 0.0,
        quarterlySpend: qMap,
        categoryBreakdown: cMap,
        vendorBreakdown: vMap,
        monthlyTotals: Object.entries(monthsMap).map(([m, t]) => ({ month: m, total: t }))
      }
    })
  }, [allYearlyInvoices])

  const activeSummaries = (historyData?.yearlySummaries && historyData.yearlySummaries.length > 0)
    ? historyData.yearlySummaries
    : computedFromInvoices

  const grandTotal = activeSummaries.reduce((sum, s) => sum + s.totalSpend, 0)
  const totalInvoicesCount = activeSummaries.reduce((sum, s) => sum + s.invoiceCount, 0)
  const maxYearSpend = Math.max(...activeSummaries.map((s) => s.totalSpend), 100)

  const currentSummary = typeof selectedYear === 'number'
    ? activeSummaries.find((s) => s.year === selectedYear) || activeSummaries[0]
    : null

  const categories = Array.from(
    new Set([...ALL_CATEGORIES, ...allYearlyInvoices.map((inv) => inv.category).filter(Boolean)])
  )

  const filteredInvoices = React.useMemo(() => {
    const q = (searchQuery || '').trim().toLowerCase()
    return allYearlyInvoices.filter((inv) => {
      if (typeof selectedYear === 'number' && inv.invoiceDate) {
        try {
          const invYear = new Date(inv.invoiceDate).getFullYear()
          if (invYear !== selectedYear) return false
        } catch {
          // ignore
        }
      }

      if (selectedCategory !== 'all' && inv.category !== selectedCategory) {
        return false
      }

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
  }, [invoices, selectedYear, selectedCategory, searchQuery])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
      {/* Top Header & Navigation Breadcrumb */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 'var(--space-3)',
          paddingBottom: 'var(--space-3)',
          borderBottom: '1px solid var(--border-primary)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h2 className="page-header-title">
                Annual Spending History
              </h2>
            </div>
            <p className="page-header-subtitle">
              Annual spending, quarterly trends, and past bills.
            </p>
          </div>
        </div>
      </div>

      {/* 4 Multi-Year Overview KPI Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 'var(--space-4)',
        }}
      >
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                Cumulative Multi-Year Spend
              </div>
              <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '4px', fontVariantNumeric: 'tabular-nums' }}>
                {currencySymbol}{grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                color: '#3b82f6',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <DollarSign size={20} />
            </div>
          </div>
          <div style={{ marginTop: 'var(--space-2)', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            Across <strong>{activeSummaries.length} tracked years</strong> of records
          </div>
        </Card>

        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                {activeSummaries[0]?.year || 2026} Year-to-Date
              </div>
              <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#3b82f6', marginTop: '4px', fontVariantNumeric: 'tabular-nums' }}>
                {currencySymbol}{(activeSummaries[0]?.totalSpend || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                color: '#3b82f6',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Calendar size={20} />
            </div>
          </div>
          <div style={{ marginTop: 'var(--space-2)', fontSize: '0.78rem', color: (activeSummaries[0]?.yoyGrowthPct || 0) >= 0 ? '#10b981' : '#ef4444', fontWeight: 600 }}>
            {(activeSummaries[0]?.yoyGrowthPct || 0) > 0 ? `+${activeSummaries[0]?.yoyGrowthPct}% YoY` : `${activeSummaries[0]?.yoyGrowthPct || 0}% YoY`}
          </div>
        </Card>

        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                {activeSummaries[1]?.year || 2025} Full-Year Spend
              </div>
              <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#10b981', marginTop: '4px', fontVariantNumeric: 'tabular-nums' }}>
                {currencySymbol}{(activeSummaries[1]?.totalSpend || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                color: '#10b981',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <TrendingUp size={20} />
            </div>
          </div>
          <div style={{ marginTop: 'var(--space-2)', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            {activeSummaries[1]?.invoiceCount || 0} archived statements cataloged
          </div>
        </Card>

        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                Total Preserved Receipts
              </div>
              <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '4px', fontVariantNumeric: 'tabular-nums' }}>
                {totalInvoicesCount}
              </div>
            </div>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'rgba(139, 92, 246, 0.1)',
                color: '#8b5cf6',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Receipt size={20} />
            </div>
          </div>
          <div style={{ marginTop: 'var(--space-2)', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            {totalInvoicesCount} invoices preserved in database
          </div>
        </Card>
      </div>

      {/* Interactive Year Selector Tabs */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          padding: '6px',
          backgroundColor: 'var(--bg-secondary)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-primary)',
          overflowX: 'auto',
        }}
      >
        <button
          onClick={() => setSelectedYear('all')}
          style={{
            padding: '8px 16px',
            borderRadius: 'var(--radius-sm)',
            border: 'none',
            backgroundColor: selectedYear === 'all' ? 'var(--color-primary)' : 'transparent',
            color: selectedYear === 'all' ? '#ffffff' : 'var(--text-secondary)',
            fontWeight: 700,
            fontSize: '0.85rem',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            whiteSpace: 'nowrap',
          }}
        >
          All Years Overview
        </button>

        {activeSummaries.map((summary) => (
          <button
            key={summary.year}
            onClick={() => setSelectedYear(summary.year)}
            style={{
              padding: '8px 16px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              backgroundColor: selectedYear === summary.year ? YEAR_COLORS[summary.year] || 'var(--color-primary)' : 'transparent',
              color: selectedYear === summary.year ? '#ffffff' : 'var(--text-secondary)',
              fontWeight: 700,
              fontSize: '0.85rem',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              whiteSpace: 'nowrap',
            }}
          >
            <span>{summary.year}</span>
            <span
              style={{
                fontSize: '0.72rem',
                opacity: 0.85,
                backgroundColor: 'rgba(0,0,0,0.2)',
                padding: '2px 6px',
                borderRadius: '10px',
              }}
            >
              {summary.totalSpend >= 1000
                ? `${currencySymbol}${(summary.totalSpend / 1000).toFixed(1)}k`
                : `${currencySymbol}${summary.totalSpend.toFixed(0)}`}
            </span>
          </button>
        ))}
      </div>

      {/* All-Years Comparison Visual Chart */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Year-over-Year Spend Trajectory
            </h3>
          </div>
        </div>

        {/* Multi-Year Stacked Bars */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
          {activeSummaries.map((summary) => {
            const barHeightPct = (summary.totalSpend / maxYearSpend) * 100
            const isSelected = selectedYear === summary.year || selectedYear === 'all'
            const barColor = YEAR_COLORS[summary.year] || '#3b82f6'

            return (
              <div
                key={summary.year}
                onClick={() => setSelectedYear(summary.year)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  padding: '16px',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: isSelected ? 'var(--bg-secondary)' : 'rgba(255,255,255,0.02)',
                  border: isSelected ? `2px solid ${barColor}` : '1px solid var(--border-primary)',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <span style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                    {summary.year}
                  </span>
                  {summary.yoyGrowthPct > 0 && (
                    <Badge variant="success" size="sm">
                      +{summary.yoyGrowthPct}% YoY
                    </Badge>
                  )}
                </div>

                <div style={{ fontSize: '1.45rem', fontWeight: 800, color: barColor, marginBottom: '6px' }}>
                  {currencySymbol}{summary.totalSpend.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>

                {/* Progress Bar */}
                <div
                  style={{
                    height: '8px',
                    width: '100%',
                    backgroundColor: 'rgba(255,255,255,0.08)',
                    borderRadius: '4px',
                    overflow: 'hidden',
                    marginBottom: '12px',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${barHeightPct}%`,
                      backgroundColor: barColor,
                      borderRadius: '4px',
                      transition: 'width 0.6s ease',
                    }}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  <span>{summary.invoiceCount} Invoices</span>
                  <span>Avg: {currencySymbol}{summary.averageMonthly.toFixed(0)}/mo</span>
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      {/* Selected Year Detailed Quarterly Breakdown */}
      {currentSummary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--space-4)' }}>
          {/* Quarterly Spend Cards */}
          <Card>
            <h3 style={{ margin: '0 0 14px 0', fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {currentSummary.year} Quarterly Distribution
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
              {(['Q1', 'Q2', 'Q3', 'Q4'] as const).map((q) => {
                const qAmt = currentSummary.quarterlySpend[q] || 0
                const qPct = currentSummary.totalSpend > 0 ? (qAmt / currentSummary.totalSpend) * 100 : 0

                return (
                  <div
                    key={q}
                    style={{
                      padding: '12px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--bg-secondary)',
                      border: '1px solid var(--border-primary)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                        {q}
                      </span>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        {qPct.toFixed(1)}%
                      </span>
                    </div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                      {currencySymbol}{qAmt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>

          {/* Top Categories for Selected Year */}
          <Card>
            <h3 style={{ margin: '0 0 14px 0', fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {currentSummary.year} Spend by Category
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {Object.entries(currentSummary.categoryBreakdown).map(([cat, amt]) => {
                const pct = currentSummary.totalSpend > 0 ? (amt / currentSummary.totalSpend) * 100 : 0
                return (
                  <div key={cat}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '3px' }}>
                      <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{cat}</span>
                      <span style={{ color: 'var(--text-muted)' }}>{currencySymbol}{amt.toLocaleString()} ({pct.toFixed(1)}%)</span>
                    </div>
                    <div style={{ height: '6px', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, backgroundColor: 'var(--color-primary)', borderRadius: '3px' }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>
        </div>
      )}

      {/* Historical Invoices Ledger for Selected Year */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {selectedYear === 'all' ? 'All Historical Invoices Archive' : `${selectedYear} Invoices & Receipts Ledger`}
            </h3>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {filteredInvoices.length} statements found
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Search vendor or purpose..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                style={{
                  padding: '6px 10px 6px 30px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-primary)',
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  fontSize: '0.82rem',
                  outline: 'none',
                  width: '200px',
                }}
              />
            </div>

            {/* Category Filter Dropdown */}
            <select
              value={selectedCategory}
              onChange={(e) => {
                setSelectedCategory(e.target.value)
                setCurrentPage(1)
              }}
              style={{
                padding: '6px 12px',
                backgroundColor: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-primary)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.82rem',
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              <option value="all">All Categories</option>
              {categories.map((c) => (
                <option key={c} value={c} style={{ backgroundColor: '#18181B', color: '#fff' }}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Invoice Records Table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-primary)', color: 'var(--text-muted)' }}>
                <th style={{ padding: '10px' }}>Date</th>
                <th style={{ padding: '10px' }}>Vendor & Purpose</th>
                <th style={{ padding: '10px' }}>Category</th>
                <th style={{ padding: '10px', textAlign: 'right' }}>Amount</th>
                <th style={{ padding: '10px', textAlign: 'center' }}>Details</th>
              </tr>
            </thead>
            <tbody>
              {filteredInvoices.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((inv) => (
                <tr
                  key={inv.id}
                  onClick={() => onSelectInvoice(inv)}
                  style={{
                    borderBottom: '1px solid var(--border-primary)',
                    cursor: 'pointer',
                    transition: 'background-color 0.15s ease',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.03)')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <td style={{ padding: '10px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    {inv.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString() : 'N/A'}
                  </td>
                  <td style={{ padding: '10px' }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{inv.vendor}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{inv.purpose || inv.invoiceNumber}</div>
                  </td>
                  <td style={{ padding: '10px' }}>
                    <Badge variant="default" size="sm">{inv.category}</Badge>
                  </td>
                  <td style={{ padding: '10px', textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                    {currencySymbol}{inv.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td style={{ padding: '10px', textAlign: 'center' }}>
                    <ChevronRight size={16} style={{ color: 'var(--text-muted)' }} />
                  </td>
                </tr>
              ))}

              {filteredInvoices.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: '36px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    No invoices or receipts recorded for {selectedYear === 'all' ? 'any year' : selectedYear}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* 10 Invoices Per Page Pagination Controls */}
        {filteredInvoices.length > 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingTop: '16px',
              marginTop: '12px',
              borderTop: '1px solid var(--border-primary)',
              flexWrap: 'wrap',
              gap: '10px',
            }}
          >
            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              Showing <strong>{(currentPage - 1) * pageSize + 1}</strong> to{' '}
              <strong>{Math.min(currentPage * pageSize, filteredInvoices.length)}</strong> of{' '}
              <strong>{filteredInvoices.length}</strong> invoices
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                style={{ fontSize: '0.78rem', height: '30px', padding: '0 12px' }}
              >
                Previous
              </Button>

              <span style={{ fontSize: '0.82rem', color: 'var(--text-primary)', fontWeight: 600, padding: '0 4px' }}>
                Page {currentPage} of {Math.max(1, Math.ceil(filteredInvoices.length / pageSize))}
              </span>

              <Button
                variant="secondary"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.min(Math.ceil(filteredInvoices.length / pageSize), p + 1))}
                disabled={currentPage >= Math.ceil(filteredInvoices.length / pageSize)}
                style={{ fontSize: '0.78rem', height: '30px', padding: '0 12px' }}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
