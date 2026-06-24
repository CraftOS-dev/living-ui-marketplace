import { useState, useEffect } from 'react'
import type { AppController } from '../AppController'
import type { WidgetConfig, DashboardView } from '../types'

interface ClockWidgetProps {
  controller: AppController
  config: WidgetConfig
  navigate: (view: DashboardView) => void
}

function formatTime(date: Date, use24h: boolean): string {
  if (use24h) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  }
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })
}

function formatDate(date: Date): string {
  return date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
}

export function ClockWidget({ config }: ClockWidgetProps) {
  const [now, setNow] = useState(new Date())
  const use24h = config.widgetSettings?.format === '24h'

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div style={{ textAlign: 'center', paddingTop: 'var(--space-2)' }}>
      <div style={{
        fontSize: 'clamp(28px, 5vw, 40px)',
        fontWeight: 'var(--font-weight-bold)' as any,
        color: 'var(--color-primary)',
        letterSpacing: '-0.02em',
        fontVariantNumeric: 'tabular-nums',
        lineHeight: 1.1,
      }}>
        {formatTime(now, use24h)}
      </div>
      <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginTop: 'var(--space-2)' }}>
        {formatDate(now)}
      </div>
      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>
        {Intl.DateTimeFormat().resolvedOptions().timeZone}
      </div>
    </div>
  )
}
