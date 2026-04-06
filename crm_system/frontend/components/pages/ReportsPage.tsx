import { useState, useEffect, useCallback } from 'react'
import { Card, Select, Tabs, TabList, Tab, TabPanel } from '../ui'
import type { AppController } from '../../AppController'
import type { AppState } from '../../types'

interface ReportsPageProps {
  controller: AppController
  state: AppState
}

interface SalesMetrics {
  wonDeals: number
  lostDeals: number
  wonValue: number
  lostValue: number
  avgDealSize: number
  totalRevenue: number
  revenueByMonth: { month: string; value: number }[]
}

interface ActivityMetrics {
  byType: Record<string, number>
  total: number
  completed: number
  completionRate: number
}

interface ConversionMetrics {
  stages: { name: string; count: number; color: string }[]
}

export function ReportsPage({ controller }: ReportsPageProps) {
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<string | null>(null)
  const [salesMetrics, setSalesMetrics] = useState<SalesMetrics | null>(null)
  const [activityMetrics, setActivityMetrics] = useState<ActivityMetrics | null>(null)
  const [conversionMetrics, setConversionMetrics] = useState<ConversionMetrics | null>(null)
  const [dateRange, setDateRange] = useState('all')

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }, [])

  const loadReports = useCallback(async () => {
    setLoading(true)
    try {
      // Load deals for sales metrics
      const dealsRes = await controller.fetchDeals({ perPage: 500 })
      const deals = dealsRes.items || []

      const wonDeals = deals.filter((d) => d.status === 'won')
      const lostDeals = deals.filter((d) => d.status === 'lost')
      const wonValue = wonDeals.reduce((s, d) => s + (d.value || 0), 0)
      const lostValue = lostDeals.reduce((s, d) => s + (d.value || 0), 0)
      const avgDealSize = wonDeals.length > 0 ? wonValue / wonDeals.length : 0

      // Group revenue by month
      const monthMap: Record<string, number> = {}
      for (const d of wonDeals) {
        const date = d.actualCloseDate || d.createdAt
        if (!date) continue
        const m = date.substring(0, 7)
        monthMap[m] = (monthMap[m] || 0) + (d.value || 0)
      }
      const revenueByMonth = Object.entries(monthMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-6)
        .map(([month, value]) => ({ month, value }))

      setSalesMetrics({
        wonDeals: wonDeals.length,
        lostDeals: lostDeals.length,
        wonValue,
        lostValue,
        avgDealSize,
        totalRevenue: wonValue,
        revenueByMonth,
      })

      // Load activities for activity metrics
      const activitiesRes = await controller.fetchActivities({ perPage: 500 })
      const activities = activitiesRes.items || []
      const byType: Record<string, number> = {}
      let completed = 0
      for (const a of activities) {
        byType[a.activityType] = (byType[a.activityType] || 0) + 1
        if (a.isCompleted) completed++
      }
      setActivityMetrics({
        byType,
        total: activities.length,
        completed,
        completionRate: activities.length > 0 ? Math.round((completed / activities.length) * 100) : 0,
      })

      // Load stages for conversion funnel
      const stages = await controller.fetchStages()
      const stageData = (stages || [])
        .sort((a, b) => a.position - b.position)
        .map((s) => ({
          name: s.name,
          count: s.dealCount || 0,
          color: s.color || 'var(--color-primary)',
        }))
      setConversionMetrics({ stages: stageData })
    } catch {
      showToast('Failed to load reports')
    } finally {
      setLoading(false)
    }
  }, [controller, showToast])

  useEffect(() => {
    loadReports()
  }, [loadReports])

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v)

  if (loading) {
    return (
      <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-secondary)' }}>
        Loading reports...
      </div>
    )
  }

  const maxRevenue = salesMetrics
    ? Math.max(...salesMetrics.revenueByMonth.map((r) => r.value), 1)
    : 1

  const maxTypeCount = activityMetrics
    ? Math.max(...Object.values(activityMetrics.byType), 1)
    : 1

  const maxStageCount = conversionMetrics
    ? Math.max(...conversionMetrics.stages.map((s) => s.count), 1)
    : 1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {toast && (
        <div
          style={{
            position: 'fixed',
            top: 16,
            right: 16,
            padding: 'var(--space-3) var(--space-4)',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-primary)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-lg)',
            zIndex: 9999,
            fontSize: 'var(--font-size-sm)',
            color: 'var(--text-primary)',
          }}
        >
          {toast}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0, fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any }}>
          Reports
        </h1>
        <div style={{ width: 180 }}>
          <Select
            options={[
              { value: 'all', label: 'All Time' },
              { value: '30d', label: 'Last 30 Days' },
              { value: '90d', label: 'Last 90 Days' },
              { value: '1y', label: 'Last Year' },
            ]}
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
          />
        </div>
      </div>

      <Tabs defaultTab="sales">
        <TabList>
          <Tab id="sales">Sales</Tab>
          <Tab id="activity">Activity</Tab>
          <Tab id="conversion">Conversion</Tab>
        </TabList>

        {/* SALES TAB */}
        <TabPanel id="sales">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {/* Metrics Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-3)' }}>
              {[
                { label: 'Won Deals', value: String(salesMetrics?.wonDeals || 0), color: 'var(--color-success)' },
                { label: 'Lost Deals', value: String(salesMetrics?.lostDeals || 0), color: 'var(--color-error)' },
                { label: 'Avg Deal Size', value: formatCurrency(salesMetrics?.avgDealSize || 0), color: 'var(--color-info)' },
                { label: 'Total Revenue', value: formatCurrency(salesMetrics?.totalRevenue || 0), color: 'var(--color-primary)' },
              ].map((m) => (
                <Card key={m.label}>
                  <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--space-1)' }}>
                    {m.label}
                  </div>
                  <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: m.color }}>
                    {m.value}
                  </div>
                </Card>
              ))}
            </div>

            {/* Revenue Bar Chart */}
            <Card>
              <h3 style={{ margin: 0, marginBottom: 'var(--space-4)', fontSize: 'var(--font-size-base)', fontWeight: 'var(--font-weight-semibold)' as any }}>
                Revenue by Month
              </h3>
              {salesMetrics && salesMetrics.revenueByMonth.length > 0 ? (
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-2)', height: 200 }}>
                  {salesMetrics.revenueByMonth.map((r) => (
                    <div
                      key={r.month}
                      style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-1)' }}
                    >
                      <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
                        {formatCurrency(r.value)}
                      </span>
                      <div
                        style={{
                          width: '100%',
                          maxWidth: 60,
                          height: `${Math.max((r.value / maxRevenue) * 160, 4)}px`,
                          backgroundColor: 'var(--color-primary)',
                          borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0',
                          transition: 'height 0.3s ease',
                        }}
                      />
                      <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
                        {r.month}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)' }}>
                  No revenue data available.
                </div>
              )}
            </Card>
          </div>
        </TabPanel>

        {/* ACTIVITY TAB */}
        <TabPanel id="activity">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-3)' }}>
              <Card>
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>Total Activities</div>
                <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-primary)' }}>
                  {activityMetrics?.total || 0}
                </div>
              </Card>
              <Card>
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>Completed</div>
                <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-success)' }}>
                  {activityMetrics?.completed || 0}
                </div>
              </Card>
              <Card>
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>Completion Rate</div>
                <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-info)' }}>
                  {activityMetrics?.completionRate || 0}%
                </div>
              </Card>
            </div>

            {/* Activities by Type Bar Chart */}
            <Card>
              <h3 style={{ margin: 0, marginBottom: 'var(--space-4)', fontSize: 'var(--font-size-base)', fontWeight: 'var(--font-weight-semibold)' as any }}>
                Activities by Type
              </h3>
              {activityMetrics && Object.keys(activityMetrics.byType).length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  {Object.entries(activityMetrics.byType).map(([type, count]) => {
                    const colors: Record<string, string> = {
                      call: 'var(--color-info)',
                      email: 'var(--color-primary)',
                      meeting: 'var(--color-warning)',
                      task: 'var(--color-success)',
                    }
                    return (
                      <div key={type}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-1)' }}>
                          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)', textTransform: 'capitalize' }}>
                            {type}
                          </span>
                          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
                            {count}
                          </span>
                        </div>
                        <div
                          style={{
                            height: 8,
                            backgroundColor: 'var(--bg-tertiary)',
                            borderRadius: 'var(--radius-full)',
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              height: '100%',
                              width: `${(count / maxTypeCount) * 100}%`,
                              backgroundColor: colors[type] || 'var(--color-primary)',
                              borderRadius: 'var(--radius-full)',
                              transition: 'width 0.3s ease',
                            }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)' }}>
                  No activity data available.
                </div>
              )}
            </Card>
          </div>
        </TabPanel>

        {/* CONVERSION TAB */}
        <TabPanel id="conversion">
          <Card>
            <h3 style={{ margin: 0, marginBottom: 'var(--space-4)', fontSize: 'var(--font-size-base)', fontWeight: 'var(--font-weight-semibold)' as any }}>
              Conversion Funnel
            </h3>
            {conversionMetrics && conversionMetrics.stages.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-2)' }}>
                {conversionMetrics.stages.map((stage) => {
                  const widthPct = maxStageCount > 0
                    ? Math.max(20, (stage.count / maxStageCount) * 100)
                    : 100
                  return (
                    <div
                      key={stage.name}
                      style={{
                        width: `${widthPct}%`,
                        padding: 'var(--space-3) var(--space-4)',
                        backgroundColor: stage.color || 'var(--color-primary)',
                        borderRadius: 'var(--radius-md)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        transition: 'width 0.3s ease',
                        minWidth: 200,
                      }}
                    >
                      <span style={{ color: 'var(--color-white)', fontWeight: 'var(--font-weight-medium)' as any, fontSize: 'var(--font-size-sm)' }}>
                        {stage.name}
                      </span>
                      <span style={{ color: 'var(--color-white)', fontWeight: 'var(--font-weight-bold)' as any, fontSize: 'var(--font-size-base)' }}>
                        {stage.count}
                      </span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)' }}>
                No pipeline stages configured.
              </div>
            )}
          </Card>
        </TabPanel>
      </Tabs>
    </div>
  )
}
