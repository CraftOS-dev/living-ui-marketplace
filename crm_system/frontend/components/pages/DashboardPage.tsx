import { useEffect, useState, useCallback } from 'react'
import { Card, Badge, Button, EmptyState } from '../ui'
import type { AppController } from '../../AppController'
import type { AppState, Activity, PipelineStage } from '../../types'

interface DashboardPageProps {
  controller: AppController
}

// ============================================================================
// Metric Card
// ============================================================================

function MetricCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <Card style={{ flex: 1, minWidth: 180 }}>
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            fontSize: '2rem',
            fontWeight: 700,
            color,
            lineHeight: 1.2,
            marginBottom: 'var(--space-2)',
          }}
        >
          {value}
        </div>
        <div
          style={{
            fontSize: 'var(--font-size-sm)',
            color: 'var(--text-secondary)',
            fontWeight: 500,
          }}
        >
          {label}
        </div>
      </div>
    </Card>
  )
}

// ============================================================================
// Pipeline Bar Chart
// ============================================================================

function PipelineChart({ stages }: { stages: PipelineStage[] }) {
  if (!stages || stages.length === 0) {
    return <EmptyState message="No pipeline stages configured" />
  }

  const maxDeals = Math.max(...stages.map((s) => s.dealCount), 1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {stages.map((stage) => {
        const barWidth = Math.max((stage.dealCount / maxDeals) * 100, 4)
        const barColor = stage.color || 'var(--color-primary)'
        return (
          <div key={stage.id}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: 'var(--space-1)',
                fontSize: 'var(--font-size-sm)',
              }}
            >
              <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{stage.name}</span>
              <span style={{ color: 'var(--text-muted)' }}>
                {stage.dealCount} deals &middot; ${stage.totalValue.toLocaleString()}
              </span>
            </div>
            <div
              style={{
                height: 24,
                backgroundColor: 'var(--bg-primary)',
                borderRadius: 'var(--radius-md)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${barWidth}%`,
                  height: '100%',
                  backgroundColor: barColor,
                  borderRadius: 'var(--radius-md)',
                  transition: 'width 0.4s ease',
                  display: 'flex',
                  alignItems: 'center',
                  paddingLeft: 'var(--space-2)',
                }}
              >
                {stage.dealCount > 0 && (
                  <span style={{ fontSize: 11, color: '#fff', fontWeight: 600 }}>
                    {stage.dealCount}
                  </span>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ============================================================================
// Activity Item
// ============================================================================

function ActivityItem({ activity }: { activity: Activity }) {
  const badgeVariant = (type: string) => {
    const map: Record<string, 'info' | 'primary' | 'success' | 'warning' | 'default'> = {
      call: 'info',
      email: 'primary',
      meeting: 'success',
      task: 'warning',
      note: 'info',
    }
    return map[type] || 'default'
  }

  const dateStr = activity.createdAt
    ? new Date(activity.createdAt).toLocaleDateString()
    : ''

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 'var(--space-2) 0',
        borderBottom: '1px solid var(--border-primary)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flex: 1 }}>
        <Badge variant={badgeVariant(activity.activityType)} size="sm">
          {activity.activityType}
        </Badge>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>
            {activity.subject}
          </div>
          {activity.description && (
            <div
              style={{
                fontSize: 'var(--font-size-xs)',
                color: 'var(--text-muted)',
                marginTop: 2,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: 300,
              }}
            >
              {activity.description}
            </div>
          )}
        </div>
      </div>
      <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
        {dateStr}
      </span>
    </div>
  )
}

// ============================================================================
// Dashboard Page
// ============================================================================

export function DashboardPage({ controller }: DashboardPageProps) {
  const [state, setState] = useState<AppState>(controller.getState())
  const [recentActivities, setRecentActivities] = useState<Activity[]>([])
  const [pipeline, setPipeline] = useState<PipelineStage[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = controller.subscribe(setState)
    return unsub
  }, [controller])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      await controller.fetchDashboardSummary()

      const [activitiesRes, pipelineRes] = await Promise.all([
        controller.fetchActivities({ perPage: 10, sortBy: 'created_at', sortDir: 'desc' }),
        controller.fetchPipeline(),
      ])

      setRecentActivities(activitiesRes.items)
      setPipeline(pipelineRes)
    } catch (err) {
      console.error('[DashboardPage] Failed to load data:', err)
    } finally {
      setLoading(false)
    }
  }, [controller])

  useEffect(() => {
    loadData()
  }, [loadData])

  const summary = state.dashboardSummary

  if (loading && !summary) {
    return (
      <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading dashboard...
      </div>
    )
  }

  const conversionStr = summary ? `${(summary.conversionRate * 100).toFixed(1)}%` : '0%'

  return (
    <div style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--font-size-xl)', color: 'var(--text-primary)' }}>
          Dashboard
        </h2>
        <Button variant="secondary" size="sm" onClick={loadData} loading={loading}>
          Refresh
        </Button>
      </div>

      {/* Metric Cards Row */}
      <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        <MetricCard
          label="Total Contacts"
          value={summary ? summary.totalContacts.toLocaleString() : '0'}
          color="var(--color-primary)"
        />
        <MetricCard
          label="Open Deals"
          value={summary ? summary.openDeals.toLocaleString() : '0'}
          color="var(--color-info)"
        />
        <MetricCard
          label="Pipeline Value"
          value={summary ? `$${summary.pipelineValue.toLocaleString()}` : '$0'}
          color="var(--color-success)"
        />
        <MetricCard
          label="Conversion Rate"
          value={conversionStr}
          color="var(--color-warning)"
        />
      </div>

      {/* Pipeline Summary */}
      <Card>
        <h3
          style={{
            margin: 0,
            marginBottom: 'var(--space-4)',
            fontSize: 'var(--font-size-base)',
            color: 'var(--text-primary)',
            fontWeight: 600,
          }}
        >
          Pipeline Summary
        </h3>
        <PipelineChart stages={pipeline} />
      </Card>

      {/* Recent Activities */}
      <Card>
        <h3
          style={{
            margin: 0,
            marginBottom: 'var(--space-3)',
            fontSize: 'var(--font-size-base)',
            color: 'var(--text-primary)',
            fontWeight: 600,
          }}
        >
          Recent Activities
        </h3>
        {recentActivities.length === 0 ? (
          <EmptyState message="No recent activities" />
        ) : (
          <div>
            {recentActivities.map((a) => (
              <ActivityItem key={a.id} activity={a} />
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
