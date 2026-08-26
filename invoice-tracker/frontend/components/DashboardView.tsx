import React, { useState } from 'react'
import type { DashboardStats, InvoiceReceipt, Subscription, MonthlySpendBar, ActivityEvent } from '../types'
import { Card, Button } from './ui'
import {
  DollarSign,
  Flame,
  CreditCard,
  FileCheck2,
  ArrowRight,
  Maximize2,
  Minimize2,
  Activity,
} from 'lucide-react'

interface Props {
  stats: DashboardStats | null
  invoices: InvoiceReceipt[]
  subscriptions: Subscription[]
  activities?: ActivityEvent[]
  onSelectInvoice?: (inv: InvoiceReceipt) => void
  onOpenSyncModal?: () => void
  onNavigateTab: (tab: 'dashboard' | 'subscriptions' | 'invoices' | 'monthly-costs' | 'feed' | 'yearly-history') => void
  onSimulateQuick?: (preset: string) => void
  livePulseActive?: boolean
  currencySymbol?: string
}

function formatYAxisTick(val: number): string {
  if (val === 0) return '0'
  if (val >= 1_000_000) {
    const v = val / 1_000_000
    return v % 1 === 0 ? `${v}M` : `${Number(v.toFixed(1))}M`
  }
  if (val >= 10_000) {
    const v = val / 1_000
    return v % 1 === 0 ? `${v}k` : `${Number(v.toFixed(1))}k`
  }
  if (val >= 1_000) {
    const v = val / 1_000
    if (v % 1 === 0) return `${v}k`
    return `${Number(v.toFixed(2))}k`
  }
  return val.toLocaleString()
}

export const DashboardView: React.FC<Props> = ({
  stats,
  invoices,
  subscriptions,
  activities = [],
  onSelectInvoice,
  onNavigateTab,
  livePulseActive,
  currencySymbol = '$',
}) => {
  void onSelectInvoice
  const [hoveredMonth, setHoveredMonth] = useState<MonthlySpendBar | null>(null)
  const [isGraphExpanded, setIsGraphExpanded] = useState<boolean>(false)
  const [hoveredSeg, setHoveredSeg] = useState<{ month: string; service?: string; category?: string; amount: number; color: string; percentage: number } | null>(null)

  // 1. Subscription burn calculated strictly from active subscriptions
  const activeSubsList = subscriptions.filter((s) => (s.status || 'active').toLowerCase() === 'active')
  const calculatedSubsMonthlyBurn = activeSubsList.reduce((sum, s) => {
    const freq = (s.billingFrequency || 'monthly').toLowerCase()
    if (freq === 'yearly') return sum + (s.amount / 12.0)
    if (freq === 'weekly') return sum + (s.amount * 4.33)
    if (freq === 'quarterly') return sum + (s.amount / 3.0)
    return sum + s.amount
  }, 0)

  const effectiveMonthlyBurn = calculatedSubsMonthlyBurn > 0
    ? calculatedSubsMonthlyBurn
    : (stats?.monthlyRecurringBurn && stats.monthlyRecurringBurn > 0 ? stats.monthlyRecurringBurn : 0)

  // 2. Multi-year total money spent from history (invoices + subscriptions spent up to now)
  const calculatedInvoicesSum = invoices.reduce((sum, inv) => sum + (Number(inv.amount) || 0), 0)
  const calculatedSubsSpentTotal = activeSubsList.reduce((sum, s) => {
    const hasInv = invoices.some((inv) =>
      (inv.subscriptionId && inv.subscriptionId === s.id) ||
      ((inv.vendor || '').toLowerCase() === (s.vendor || s.name || '').toLowerCase() && inv.paymentType === 'subscription')
    )
    if (hasInv) return sum

    let elapsedMonths = 1
    const freq = (s.billingFrequency || 'monthly').toLowerCase()
    if (freq === 'yearly') return sum + s.amount
    if (freq === 'weekly') return sum + (s.amount * 4.33 * elapsedMonths)
    if (freq === 'quarterly') return sum + s.amount
    return sum + (s.amount * elapsedMonths)
  }, 0)

  const calculatedTotalSpent = calculatedInvoicesSum + calculatedSubsSpentTotal
  const effectiveTotalSpent = (stats?.totalSpentAllTime !== undefined && stats.totalSpentAllTime !== null && stats.totalSpentAllTime >= calculatedTotalSpent)
    ? stats.totalSpentAllTime
    : calculatedTotalSpent

  const effectiveActiveSubsCount = activeSubsList.length > 0
    ? activeSubsList.length
    : (stats?.activeSubscriptionsCount !== undefined ? stats.activeSubscriptionsCount : 0)

  const effectiveTotalInvoices = invoices.length > 0
    ? invoices.length
    : (stats?.totalInvoicesCount !== undefined ? stats.totalInvoicesCount : 0)

  // 3. Distinct Color Palette & Deterministic Hash Generator
  const DISTINCT_PALETTE = [
    '#FF9900', '#00A67E', '#635BFF', '#3B82F6', '#F24E1E',
    '#7952DE', '#1A73E8', '#8B5CF6', '#D97706', '#EC407A',
    '#10B981', '#3ECF8E', '#06B6D4', '#F59E0B', '#8E24AA',
    '#43A047', '#EF4444', '#00ACC1', '#5E6AD2', '#E11D48',
    '#2563EB', '#D946EF', '#14B8A6', '#F97316', '#64748B',
    '#84CC16', '#A855F7', '#EA580C', '#0284C7', '#4F46E5',
    '#059669', '#7C3AED', '#DB2777', '#0891B2', '#CA8A04',
    '#9333EA', '#16A34A', '#C026D3', '#EAB308', '#FF5722'
  ]

  const SERVICE_COLORS: Record<string, string> = {
    'AWS': '#FF9900',
    'Amazon Web Services': '#FF9900',
    'Amazon RDS': '#43A047',
    'Amazon ElastiCache': '#FB8C00',
    'Amazon DynamoDB': '#8E24AA',
    'Other Services': '#EC407A',
    'OpenAI': '#00A67E',
    'Cursor AI': '#3B82F6',
    'Anthropic': '#D97706',
    'Midjourney': '#8B5CF6',
    'GitHub': '#7952DE',
    'Google Workspace': '#1A73E8',
    'Google': '#1A73E8',
    'Figma': '#F24E1E',
    'Stripe': '#635BFF',
    'Vercel': '#000000',
    'Supabase': '#3ECF8E',
    'Notion': '#2F3437',
    'Linear': '#5E6AD2',
    'Slack': '#E01E5A',
    'Datadog': '#632CA6',
  }

  const getServiceColor = (name: string, index: number): string => {
    if (SERVICE_COLORS[name]) return SERVICE_COLORS[name]
    let hash = 0
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash)
    }
    return DISTINCT_PALETTE[(Math.abs(hash) + index) % DISTINCT_PALETTE.length]
  }

  // 4. Extract Spend Summary monthly bars strictly from account data
  const rawMonthlySpending: MonthlySpendBar[] = (stats?.monthlySpending && stats.monthlySpending.length > 0)
    ? stats.monthlySpending
    : [
        { month: 'March 2026', shortMonth: 'Mar', total: 0, segments: [] },
        { month: 'April 2026', shortMonth: 'Apr', total: 0, segments: [] },
        { month: 'May 2026', shortMonth: 'May', total: 0, segments: [] },
        { month: 'June 2026', shortMonth: 'Jun', total: 0, segments: [] },
        { month: 'July 2026', shortMonth: 'Jul', total: 0, segments: [] },
        { month: 'August 2026', shortMonth: 'Aug', total: effectiveMonthlyBurn, segments: [] },
      ]

  // Assign colors to all services in segments
  const unifiedColorMap: Record<string, string> = { ...SERVICE_COLORS }
  let colorIdx = Object.keys(SERVICE_COLORS).length

  rawMonthlySpending.forEach((m) => {
    (m.segments || []).forEach((seg) => {
      const sName = seg.service || seg.category || 'Other Services'
      if (!unifiedColorMap[sName]) {
        unifiedColorMap[sName] = seg.color || getServiceColor(sName, colorIdx++)
      }
    })
  })

  // 5. Compute the single source of truth for monthly bars
  const monthlyBarsWithComputedTotals: MonthlySpendBar[] = rawMonthlySpending.map((m) => {
    const formattedSegments = (m.segments || []).map((seg) => {
      const sName = seg.service || seg.category || 'Other Services'
      return {
        ...seg,
        service: sName,
        category: seg.category || sName,
        color: unifiedColorMap[sName] || seg.color || getServiceColor(sName, 0),
        amount: Number(seg.amount) || 0,
      }
    })

    const segSum = formattedSegments.length > 0
      ? formattedSegments.reduce((sum, s) => sum + s.amount, 0)
      : Number(m.total) || 0

    return {
      ...m,
      segments: formattedSegments,
      total: Math.round(segSum * 100) / 100,
      computedTotal: Math.round(segSum * 100) / 100,
    }
  })

  // 6. Current Month Bar is the latest month from Spend Summary (August 2026)
  const currentMonthBar = monthlyBarsWithComputedTotals[monthlyBarsWithComputedTotals.length - 1]

  // 7. ACTIVE INSPECTED MONTH (Taken strictly from Spend Summary)
  const activeBarMonth = hoveredMonth !== null
    ? (monthlyBarsWithComputedTotals.find((m) => m.month === hoveredMonth.month) || hoveredMonth)
    : currentMonthBar

  // 8. SPEND BY SERVICE & VENDOR IS TAKEN 100% DIRECTLY FROM THE ACTIVE BAR'S SEGMENTS IN SPEND SUMMARY!
  const activeServiceList = activeBarMonth?.segments || []
  const activeMonthTotal = activeServiceList.reduce((sum, item) => sum + (Number(item.amount) || 0), 0) || (activeBarMonth ? (activeBarMonth.computedTotal || activeBarMonth.total) : 0)

  // Dynamic Auto-Scaling for monthly bars (grows and shrinks dynamically)
  const maxBarVal = Math.max(...monthlyBarsWithComputedTotals.map(m => m.computedTotal || m.total), 100)
  let step = 1000
  if (maxBarVal <= 500) step = 100
  else if (maxBarVal <= 1500) step = 250
  else if (maxBarVal <= 3000) step = 500
  else if (maxBarVal <= 6000) step = 1000
  else if (maxBarVal <= 12000) step = 2000
  else if (maxBarVal <= 25000) step = 5000
  else if (maxBarVal <= 50000) step = 10000
  else step = 20000

  const yAxisMax = Math.max(Math.ceil(maxBarVal / step) * step, step * 5)
  const tickStep = yAxisMax / 5
  const yTicks = [
    yAxisMax,
    Math.round(yAxisMax - tickStep),
    Math.round(yAxisMax - (tickStep * 2)),
    Math.round(yAxisMax - (tickStep * 3)),
    Math.round(yAxisMax - (tickStep * 4)),
    0
  ]
  const chartPlotHeight = isGraphExpanded ? 340 : 230
  const chartContainerHeight = isGraphExpanded ? 420 : 310


  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', width: '100%', maxWidth: '100%', boxSizing: 'border-box', minWidth: 0 }}>

      {/* 4 Top KPI Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
          gap: 'var(--space-4)',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        {/* Card 1: Total Spend (Per Year History) */}
        <Card>
          <div
            onClick={() => onNavigateTab('yearly-history')}
            style={{ cursor: 'pointer' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span className="kpi-label">
                    Total Money Spent
                  </span>
                  <span
                    style={{
                      fontSize: '0.68rem',
                      padding: '1px 6px',
                      borderRadius: '4px',
                      backgroundColor: 'rgba(59, 130, 246, 0.12)',
                      color: '#3b82f6',
                      fontWeight: 700,
                    }}
                  >
                    YEARLY
                  </span>
                </div>
                <div className="kpi-value">
                  {currencySymbol}{effectiveTotalSpent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'rgba(59, 130, 246, 0.1)',
                  color: '#3b82f6',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <DollarSign size={22} />
              </div>
            </div>
            <div style={{ marginTop: 'var(--space-2)', fontSize: '0.80rem', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
              <span>📅 View All Yearly Archives &rarr;</span>
            </div>
          </div>
        </Card>

        {/* Card 2: Monthly Burn Rate */}
        <Card>
          <div
            onClick={() => onNavigateTab('subscriptions')}
            style={{ cursor: 'pointer' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div className="kpi-label">
                  Monthly Subscription Burn
                </div>
                <div className="kpi-value" style={{ color: 'var(--color-primary)' }}>
                  {currencySymbol}{effectiveMonthlyBurn.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-muted)' }}>/mo</span>
                </div>
              </div>
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  color: '#ef4444',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Flame size={22} />
              </div>
            </div>
            <div style={{ marginTop: 'var(--space-2)', fontSize: '0.80rem', color: 'var(--text-secondary)' }}>
              Annual run rate: <strong>{currencySymbol}{(effectiveMonthlyBurn * 12).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/yr</strong>
            </div>
          </div>
        </Card>

        {/* Card 3: Active Subscriptions */}
        <Card>
          <div
            onClick={() => onNavigateTab('subscriptions')}
            style={{ cursor: 'pointer' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div className="kpi-label">
                  Active Subscriptions
                </div>
                <div className="kpi-value">
                  {effectiveActiveSubsCount}
                </div>
              </div>
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'rgba(168, 85, 247, 0.1)',
                  color: '#a855f7',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <CreditCard size={22} />
              </div>
            </div>
            <div style={{ marginTop: 'var(--space-2)', fontSize: '0.80rem', color: 'var(--text-secondary)' }}>
              Across active software & service subscriptions
            </div>
          </div>
        </Card>

        {/* Card 4: Invoices & Receipts Extracted */}
        <Card>
          <div
            onClick={() => onNavigateTab('invoices')}
            style={{ cursor: 'pointer' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div className="kpi-label">
                  Invoices & Receipts
                </div>
                <div className="kpi-value">
                  {effectiveTotalInvoices}
                </div>
              </div>
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'rgba(16, 185, 129, 0.1)',
                  color: '#10b981',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <FileCheck2 size={22} />
              </div>
            </div>
            <div style={{ marginTop: 'var(--space-2)', fontSize: '0.80rem', color: 'var(--text-secondary)' }}>
              100% cataloged and reconciled records
            </div>
          </div>
        </Card>
      </div>

      {/* ========================================================================= */}
      {/* SPEND SUMMARY & SPEND BY SERVICE & VENDOR                                 */}
      {/* ========================================================================= */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))',
          gap: 'var(--space-4)',
          width: '100%',
          boxSizing: 'border-box',
          minWidth: 0,
        }}
      >
        {/* ------------------------------------------------------------- */}
        {/* LEFT CARD: SPEND SUMMARY (1 BAR PER MONTH)                     */}
        {/* ------------------------------------------------------------- */}
        <Card style={{ height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' }}>
            <div>
              {/* Card Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <h3 style={{ margin: 0, fontSize: '1.08rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Spend Summary
                </h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={isGraphExpanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                    onClick={() => setIsGraphExpanded(!isGraphExpanded)}
                    title={isGraphExpanded ? 'Shrink Graph View' : 'Grow / Expand Graph View'}
                    style={{ fontSize: '0.78rem', height: '28px', padding: '0 10px', borderRadius: '4px' }}
                  >
                    {isGraphExpanded ? 'Shrink' : 'Grow'}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onNavigateTab('invoices')}
                    style={{ fontSize: '0.78rem', height: '28px', padding: '0 12px', borderRadius: '4px' }}
                  >
                    Cost Explorer
                  </Button>
                </div>
              </div>

              {/* Current MTD Balance Heading */}
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: '4px', marginBottom: '2px' }}>
                Month-to-date for {currentMonthBar.month}
              </div>
              <div style={{ fontSize: '2.3rem', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: '24px' }}>
                {currencySymbol}{(currentMonthBar.computedTotal ?? currentMonthBar.total ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>

            {/* 1 Stacked Multi-Colored Bar Per Month Chart with Spacious Y-Axis Alignment */}
            <div
              onMouseLeave={() => {
                setHoveredMonth(null)
                setHoveredSeg(null)
              }}
              style={{
                position: 'relative',
                height: `${chartContainerHeight}px`,
                width: '100%',
                marginTop: 'auto',
                boxSizing: 'border-box',
                transition: 'height 0.3s ease',
              }}
            >
              {/* Horizontal Gridlines & Y-Axis Labels */}
              <div
                style={{
                  position: 'absolute',
                  top: '20px',
                  left: 0,
                  right: 0,
                  height: `${chartPlotHeight}px`,
                  transition: 'height 0.3s ease',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  pointerEvents: 'none',
                }}
              >
                {yTicks.map((tick, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', width: '100%', height: 0 }}>
                    <span
                      style={{
                        width: '52px',
                        fontSize: '0.74rem',
                        fontWeight: 500,
                        color: 'var(--text-muted)',
                        textAlign: 'right',
                        paddingRight: '12px',
                        fontVariantNumeric: 'tabular-nums',
                        transform: 'translateY(-50%)',
                        lineHeight: 1,
                      }}
                    >
                      {currencySymbol}{formatYAxisTick(tick)}
                    </span>
                    <div
                      style={{
                        flex: 1,
                        borderBottom: idx === yTicks.length - 1 ? '1px solid rgba(255, 255, 255, 0.25)' : '1px solid var(--border-primary)',
                        opacity: idx === yTicks.length - 1 ? 1 : 0.65,
                      }}
                    />
                  </div>
                ))}
              </div>

              {/* Monthly Bars Container - Aligned Exactly with $0 baseline & Y-axis grid */}
              <div
                onMouseLeave={() => {
                  setHoveredMonth(null)
                  setHoveredSeg(null)
                }}
                style={{
                  position: 'absolute',
                  top: '20px',
                  left: '56px',
                  right: '12px',
                  height: `${chartPlotHeight}px`,
                  transition: 'height 0.3s ease',
                  display: 'flex',
                  alignItems: 'flex-end',
                  justifyContent: 'space-around',
                  paddingLeft: '6px',
                  paddingRight: '6px',
                }}
              >
                {monthlyBarsWithComputedTotals.map((monthItem) => {
                  const computedTotal = monthItem.computedTotal || monthItem.total
                  const barHeight = Math.max(Math.min((computedTotal / yAxisMax) * chartPlotHeight, chartPlotHeight), 4)
                  const isCurrentMonth = currentMonthBar ? monthItem.month === currentMonthBar.month : false
                  const isHovered = hoveredMonth ? hoveredMonth.month === monthItem.month : isCurrentMonth

                  return (
                    <div
                      key={monthItem.month}
                      onMouseEnter={() => {
                        setHoveredMonth(monthItem)
                      }}
                      onClick={() => {
                        setHoveredMonth(monthItem)
                      }}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'flex-end',
                        height: '100%',
                        flex: 1,
                        maxWidth: '64px',
                        position: 'relative',
                        cursor: 'pointer',
                      }}
                    >
                      {/* Floating Tooltip when hovering any segment */}
                      {Boolean(hoveredSeg && hoveredSeg.month === monthItem.month) && hoveredSeg && (
                        <div
                          style={{
                            position: 'absolute',
                            bottom: `${barHeight + 28}px`,
                            left: '50%',
                            transform: 'translateX(-50%)',
                            zIndex: 100,
                            backgroundColor: 'rgba(15, 23, 42, 0.96)',
                            color: '#fff',
                            padding: '5px 9px',
                            borderRadius: '4px',
                            border: '1px solid var(--border-primary)',
                            boxShadow: '0 4px 14px rgba(0, 0, 0, 0.45)',
                            fontSize: '0.72rem',
                            whiteSpace: 'nowrap',
                            pointerEvents: 'none',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                          }}
                        >
                          <span style={{ width: '8px', height: '8px', borderRadius: '2px', backgroundColor: hoveredSeg.color, display: 'inline-block' }} />
                          <span><strong>{hoveredSeg.service}</strong>: {currencySymbol}{hoveredSeg.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({hoveredSeg.percentage.toFixed(1)}%)</span>
                        </div>
                      )}

                      {/* Calculated Total Dollar Amount on top of single bar */}
                      <div
                        style={{
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          color: isHovered ? 'var(--color-primary)' : 'var(--text-primary)',
                          marginBottom: '6px',
                          whiteSpace: 'nowrap',
                          transition: 'color 0.15s ease',
                          fontVariantNumeric: 'tabular-nums',
                          pointerEvents: 'none',
                        }}
                      >
                        {currencySymbol}{computedTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>

                      {/* Single Multi-Colored Stacked Bar */}
                      <div
                        style={{
                          width: '42px',
                          height: `${barHeight}px`,
                          borderRadius: '3px 3px 0 0',
                          overflow: 'hidden',
                          display: 'flex',
                          flexDirection: 'column-reverse',
                          backgroundColor: 'rgba(255, 255, 255, 0.05)',
                          border: isHovered ? '1px solid var(--color-primary)' : '1px solid rgba(255, 255, 255, 0.15)',
                          boxShadow: isHovered ? '0 0 14px rgba(255, 79, 24, 0.4)' : 'none',
                          filter: isHovered ? 'brightness(1.12)' : 'none',
                          transition: 'border 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease, height 0.3s ease',
                        }}
                      >
                        {monthItem.segments.map((seg, sIdx) => {
                          const segPct = computedTotal > 0 ? (seg.amount / computedTotal) * 100 : 0
                          const sName = seg.service || seg.category || 'Other Services'
                          const sColor = unifiedColorMap[sName] || seg.color
                          const isThisSegHovered = hoveredSeg?.month === monthItem.month && hoveredSeg?.service === sName

                          return (
                            <div
                              key={sIdx}
                              onMouseEnter={(e) => {
                                e.stopPropagation()
                                if (hoveredSeg?.service !== sName || hoveredSeg?.month !== monthItem.month) {
                                  setHoveredSeg({
                                    month: monthItem.month,
                                    service: sName,
                                    amount: seg.amount,
                                    color: sColor,
                                    percentage: seg.percentage || segPct,
                                  })
                                }
                              }}
                              title={`${sName}: ${currencySymbol}${seg.amount.toFixed(2)} (${(seg.percentage || segPct).toFixed(1)}%) - ${monthItem.month}`}
                              style={{
                                width: '100%',
                                height: `${segPct}%`,
                                backgroundColor: sColor,
                                transition: 'filter 0.15s ease',
                                filter: isThisSegHovered ? 'brightness(1.35) drop-shadow(0 0 2px rgba(255,255,255,0.5))' : 'none',
                              }}
                            />
                          )
                        })}
                      </div>

                      {/* Month Label below the $0 baseline */}
                      <div
                        style={{
                          position: 'absolute',
                          top: '100%',
                          marginTop: '8px',
                          textAlign: 'center',
                          fontSize: '0.74rem',
                          fontWeight: isHovered ? 700 : 500,
                          color: isHovered ? 'var(--color-primary)' : 'var(--text-secondary)',
                          whiteSpace: 'nowrap',
                          pointerEvents: 'none',
                          transition: 'color 0.15s ease',
                        }}
                      >
                        {monthItem.shortMonth}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </Card>

        {/* ------------------------------------------------------------- */}
        {/* RIGHT CARD: SPEND BY SERVICE & VENDOR (DERIVED FROM SUMMARY)   */}
        {/* ------------------------------------------------------------- */}
        <Card style={{ height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' }}>
            <div>
              {/* Card Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <h3 style={{ margin: 0, fontSize: '1.08rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Spend by Service & Vendor
                  </h3>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onNavigateTab('invoices')}
                  style={{ fontSize: '0.78rem', height: '28px', padding: '0 12px', borderRadius: '4px' }}
                >
                  Bill Details
                </Button>
              </div>

              {/* Donut Chart with Spacious Center & Zero Overlap */}
              {(() => {
                const donutRadius = 60
                const donutCircumference = 2 * Math.PI * donutRadius
                const validItems = activeServiceList.filter((item) => (Number(item.amount) || 0) > 0)
                const donutTotal = validItems.reduce((acc, item) => acc + (Number(item.amount) || 0), 0) || activeMonthTotal
                const centerLabel = donutTotal >= 10000
                  ? `${currencySymbol}${(donutTotal / 1000).toFixed(1)}k`
                  : `${currencySymbol}${Math.round(donutTotal).toLocaleString()}`

                // Calculate exact dynamic percentages so sum is 100.0% with zero gaps
                let runningPct = 0
                const slices = validItems.map((item) => {
                  const exactPct = donutTotal > 0 ? (Number(item.amount) / donutTotal) * 100 : 0
                  const strokeDash = (exactPct / 100) * donutCircumference
                  const strokeOffset = -(runningPct / 100) * donutCircumference
                  runningPct += exactPct
                  return {
                    ...item,
                    exactPct,
                    strokeDash,
                    strokeOffset,
                  }
                })

                return (
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', margin: '4px 0 12px 0' }}>
                    <svg width="160" height="160" viewBox="0 0 160 160" style={{ transform: 'rotate(-90deg)', overflow: 'visible' }}>
                      {/* Background Neutral Track Ring */}
                      <circle
                        cx="80"
                        cy="80"
                        r={donutRadius}
                        fill="transparent"
                        stroke="rgba(255, 255, 255, 0.08)"
                        strokeWidth="15"
                      />

                      {/* Donut Colored Slices - Mathematically continuous 100% full circle */}
                      {slices.map((slice, i) => (
                        <circle
                          key={i}
                          cx="80"
                          cy="80"
                          r={donutRadius}
                          fill="transparent"
                          stroke={slice.color}
                          strokeWidth="15"
                          strokeDasharray={`${slice.strokeDash} ${Math.max(0, donutCircumference - slice.strokeDash)}`}
                          strokeDashoffset={slice.strokeOffset}
                          style={{
                            transition: 'stroke-dasharray 0.3s ease, stroke-dashoffset 0.3s ease',
                            strokeLinecap: 'butt',
                          }}
                        />
                      ))}

                      {/* Centered Total Text */}
                      <g transform="rotate(90 80 80)">
                        <text
                          x="80"
                          y="75"
                          textAnchor="middle"
                          dominantBaseline="central"
                          style={{
                            fontSize: '1.20rem',
                            fontWeight: 800,
                            fill: 'var(--text-primary)',
                            fontFamily: 'inherit',
                            letterSpacing: '-0.02em',
                          }}
                        >
                          {centerLabel}
                        </text>
                        <text
                          x="80"
                          y="92"
                          textAnchor="middle"
                          dominantBaseline="central"
                          style={{
                            fontSize: '0.62rem',
                            fontWeight: 700,
                            fill: 'var(--text-muted)',
                            fontFamily: 'inherit',
                            textTransform: 'uppercase',
                            letterSpacing: '0.06em',
                          }}
                        >
                          Total Spend
                        </text>
                      </g>
                    </svg>
                  </div>
                )
              })()}
            </div>

            {/* Service Breakdown Rows Table with Locked Height & Smooth Scrollbar */}
            {(() => {
              const validItems = activeServiceList.filter((item) => (Number(item.amount) || 0) > 0)
              const tableTotal = validItems.reduce((acc, item) => acc + (Number(item.amount) || 0), 0) || activeMonthTotal

              return (
                <div style={{ display: 'flex', flexDirection: 'column', width: '100%', marginTop: 'auto' }}>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      height: isGraphExpanded ? '280px' : '170px',
                      overflowY: 'auto',
                      paddingRight: '6px',
                      boxSizing: 'border-box',
                    }}
                  >
                    {validItems.map((item, idx) => {
                      const rowPct = tableTotal > 0 ? (Number(item.amount) / tableTotal) * 100 : 0
                      return (
                        <div
                          key={idx}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '7px 0',
                            borderBottom: '1px solid var(--border-primary)',
                            fontSize: '0.82rem',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span
                              style={{
                                width: '12px',
                                height: '12px',
                                borderRadius: '3px',
                                backgroundColor: item.color,
                                display: 'inline-block',
                                flexShrink: 0,
                              }}
                            />
                            <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                              {item.service}
                            </span>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <span
                              style={{
                                fontSize: '0.74rem',
                                color: 'var(--text-muted)',
                                fontVariantNumeric: 'tabular-nums',
                                backgroundColor: 'var(--bg-secondary)',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                border: '1px solid var(--border-primary)',
                              }}
                            >
                              {rowPct.toFixed(1)}%
                            </span>
                            <span
                              style={{
                                fontWeight: 600,
                                color: 'var(--text-primary)',
                                fontVariantNumeric: 'tabular-nums',
                                minWidth: '75px',
                                textAlign: 'right',
                              }}
                            >
                              {currencySymbol}{Number(item.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                        </div>
                      )
                    })}

                    {validItems.length === 0 && (
                      <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.84rem' }}>
                        No vendor items found for this period.
                      </div>
                    )}
                  </div>

                  {/* Total Row */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 0 2px 0',
                      borderTop: '1px solid var(--border-primary)',
                      fontSize: '0.92rem',
                      fontWeight: 700,
                      color: 'var(--text-primary)',
                    }}
                  >
                    <span>Total Spend</span>
                    <span style={{ color: 'var(--color-primary)', fontVariantNumeric: 'tabular-nums' }}>
                      {currencySymbol}{tableTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              )
            })()}
          </div>
        </Card>
      </div>

      {/* ========================================================================= */}
      {/* LIVE INGESTION FEED STREAM (COMES BEFORE MONTHLY COSTS)                    */}
      {/* ========================================================================= */}
      {(() => {
        const effectiveActivities = (activities && activities.length > 0)
          ? activities
          : (stats?.recentActivities || [])

        return (
          <Card>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Activity size={18} color={livePulseActive ? '#10b981' : 'var(--color-primary)'} />
                    {livePulseActive && (
                      <span
                        style={{
                          position: 'absolute',
                          top: '-2px',
                          right: '-2px',
                          width: '6px',
                          height: '6px',
                          borderRadius: '50%',
                          backgroundColor: '#10b981',
                          animation: 'pulse 1.5s infinite',
                        }}
                      />
                    )}
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <h3 style={{ margin: 0, fontSize: '1.02rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                        Live Ingestion Feed
                      </h3>
                      <span
                        style={{
                          fontSize: '0.68rem',
                          fontWeight: 700,
                          color: livePulseActive ? '#10b981' : '#3b82f6',
                          backgroundColor: livePulseActive ? 'rgba(16, 185, 129, 0.12)' : 'rgba(59, 130, 246, 0.12)',
                          padding: '2px 6px',
                          borderRadius: '10px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: livePulseActive ? '#10b981' : '#3b82f6' }} />
                        LIVE
                      </span>
                    </div>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      Recent scans, emails, and bill activity.
                    </span>
                  </div>
                </div>

                <Button
                  variant="secondary"
                  size="sm"
                  icon={<ArrowRight size={14} />}
                  iconPosition="right"
                  onClick={() => onNavigateTab('feed')}
                >
                  Open Full Feed ({effectiveActivities.length})
                </Button>
              </div>

              {/* Activity items stream */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '10px' }}>
                {effectiveActivities.slice(0, 3).map((act) => (
                  <div
                    key={act.id}
                    onClick={() => onNavigateTab('feed')}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '10px',
                      padding: '10px 12px',
                      backgroundColor: 'var(--bg-secondary)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-primary)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'var(--color-primary)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'var(--border-primary)'
                    }}
                  >
                    <div
                      style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '6px',
                        backgroundColor: (act.eventType && (act.eventType.includes('ingest') || act.eventType.includes('email')))
                          ? 'rgba(16, 185, 129, 0.15)'
                          : 'rgba(59, 130, 246, 0.15)',
                        color: (act.eventType && (act.eventType.includes('ingest') || act.eventType.includes('email'))) ? '#10b981' : '#3b82f6',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        flexShrink: 0,
                        marginTop: '2px',
                      }}
                    >
                      <Activity size={14} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {act.title}
                        </span>
                        {act.amount !== undefined && act.amount !== null && (
                          <span style={{ fontWeight: 700, fontSize: '0.80rem', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                            {currencySymbol}{Number(act.amount).toFixed(2)}
                          </span>
                        )}
                      </div>
                      <p style={{ margin: '2px 0 0 0', fontSize: '0.74rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {act.description}
                      </p>
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '3px', display: 'block' }}>
                        {act.createdAt ? `${new Date(act.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • ${new Date(act.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : 'Just now'}
                      </span>
                    </div>
                  </div>
                ))}

                {effectiveActivities.length === 0 && (
                  <div style={{ gridColumn: '1 / -1', padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px dashed var(--border-primary)' }}>
                    No recent activity yet. New bills and scans will appear here.
                  </div>
                )}
              </div>
            </div>
          </Card>
        )
      })()}
    </div>
  )
}

