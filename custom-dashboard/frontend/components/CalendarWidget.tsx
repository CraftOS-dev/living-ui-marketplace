import { useState, useEffect } from 'react'
import type { AppController } from '../AppController'
import type { WidgetConfig, DashboardView, CalendarEvent } from '../types'
import { CalendarDays } from 'lucide-react'
import { EmptyState } from './ui'

interface CalendarWidgetProps {
  controller: AppController
  config: WidgetConfig
  navigate: (view: DashboardView) => void
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function CalendarWidget({ controller, navigate }: CalendarWidgetProps) {
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const t = today()
    controller.getCalendarEvents()
      .then(all => {
        const upcoming = all
          .filter(e => e.eventDate >= t)
          .slice(0, 3)
        setEvents(upcoming)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [controller])

  if (loading) return <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>Loading…</div>

  const t = today()
  const todayLabel = new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })

  if (events.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>
          {todayLabel}
        </div>
        <EmptyState
          icon={<CalendarDays size={24} />}
          message="No upcoming events"
          action={
            <button
              onClick={() => navigate('calendar')}
              style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              Add event
            </button>
          }
        />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>
        {todayLabel}
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {events.map(event => (
          <div key={event.id} style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 'var(--space-2)',
            padding: 'var(--space-2)',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--bg-tertiary)',
          }}>
            <div style={{
              width: 3, height: 36, borderRadius: 2,
              backgroundColor: event.color ?? 'var(--color-primary)',
              flexShrink: 0,
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)' as any,
                color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {event.title}
              </div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
                {event.eventDate === t ? 'Today' : event.eventDate}
                {event.startTime ? ` · ${event.startTime}` : ''}
              </div>
            </div>
          </div>
        ))}
      </div>
      <button
        onClick={() => navigate('calendar')}
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
