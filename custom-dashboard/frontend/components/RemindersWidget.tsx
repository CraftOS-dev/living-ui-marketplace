import { useState, useEffect } from 'react'
import type { AppController } from '../AppController'
import type { WidgetConfig, DashboardView, Reminder } from '../types'
import { Bell } from 'lucide-react'
import { EmptyState } from './ui'

interface RemindersWidgetProps {
  controller: AppController
  config: WidgetConfig
  navigate: (view: DashboardView) => void
}

function timeRemaining(dueDate: string | null, dueTime: string | null): string {
  if (!dueDate) return 'No due date'
  const due = new Date(`${dueDate}T${dueTime ?? '23:59'}`)
  const now = new Date()
  const diffMs = due.getTime() - now.getTime()
  if (diffMs < 0) return 'Overdue'
  const diffH = Math.floor(diffMs / 3600000)
  if (diffH < 24) return diffH < 1 ? 'Due soon' : `${diffH}h`
  const diffD = Math.floor(diffH / 24)
  return diffD === 1 ? 'Tomorrow' : `In ${diffD} days`
}

export function RemindersWidget({ controller, navigate }: RemindersWidgetProps) {
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    controller.getReminders(true)
      .then(r => setReminders(r.slice(0, 3)))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [controller])

  if (loading) return <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>Loading…</div>

  if (reminders.length === 0) {
    return (
      <EmptyState
        icon={<Bell size={24} />}
        message="No upcoming reminders"
        action={
          <button
            onClick={() => navigate('reminders')}
            style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Add reminder
          </button>
        }
      />
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {reminders.map(r => {
          const remaining = timeRemaining(r.dueDate, r.dueTime)
          const isOverdue = remaining === 'Overdue'
          return (
            <div key={r.id} style={{
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            }}>
              <Bell size={14} style={{ color: isOverdue ? 'var(--color-error)' : 'var(--color-primary)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {r.title}
                </div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: isOverdue ? 'var(--color-error)' : 'var(--text-muted)' }}>
                  {remaining}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <button
        onClick={() => navigate('reminders')}
        style={{
          marginTop: 'auto',
          padding: 'var(--space-2) 0 0 0',
          fontSize: 'var(--font-size-xs)',
          color: 'var(--color-primary)',
          background: 'none', border: 'none', cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        View all →
      </button>
    </div>
  )
}
