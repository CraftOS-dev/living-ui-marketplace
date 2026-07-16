import { useState, useEffect } from 'react'
import type { AppController } from '../AppController'
import type { WidgetConfig } from '../types'
import { Card, Button } from './ui'
import { Clock } from 'lucide-react'
import { toast } from 'react-toastify'

interface ClockFullProps {
  controller: AppController
}

function formatTime(date: Date, use24h: boolean): string {
  if (use24h) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  }
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })
}

function formatDate(date: Date): string {
  return date.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}

export function ClockFull({ controller }: ClockFullProps) {
  const [now, setNow] = useState(new Date())
  const [config, setConfig] = useState<WidgetConfig | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    controller.getWidgetConfigs().then(configs => {
      setConfig(configs.find(c => c.widgetId === 'clock') ?? null)
    }).catch(() => {})
  }, [controller])

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const use24h = config?.widgetSettings?.format === '24h'
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone

  const toggleFormat = async () => {
    if (!config) return
    setSaving(true)
    try {
      const updated = await controller.updateWidgetConfig('clock', {
        widget_settings: { format: use24h ? '12h' : '24h' },
      })
      setConfig(updated)
      toast.success(`Switched to ${use24h ? '12-hour' : '24-hour'} format`)
    } catch {
      toast.error('Failed to save setting')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ maxWidth: 500, margin: '0 auto', paddingTop: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-6)' }}>
        <Clock size={20} style={{ color: 'var(--color-primary)' }} />
        <h2 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-semibold)' as any }}>Clock</h2>
      </div>

      <Card padding="lg" style={{ textAlign: 'center', marginBottom: 'var(--space-4)' }}>
        <div style={{
          fontSize: 'clamp(48px, 10vw, 80px)',
          fontWeight: 'var(--font-weight-bold)' as any,
          color: 'var(--color-primary)',
          letterSpacing: '-0.02em',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1,
          marginBottom: 'var(--space-4)',
        }}>
          {formatTime(now, use24h)}
        </div>
        <div style={{ fontSize: 'var(--font-size-lg)', color: 'var(--text-secondary)', marginBottom: 'var(--space-2)' }}>
          {formatDate(now)}
        </div>
        <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>
          {tz}
        </div>
      </Card>

      <Card padding="md">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 'var(--font-weight-medium)' as any, fontSize: 'var(--font-size-sm)' }}>
              Time format
            </div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
              Currently using {use24h ? '24-hour' : '12-hour'} format
            </div>
          </div>
          <Button variant="secondary" size="sm" loading={saving} onClick={toggleFormat}>
            Switch to {use24h ? '12h' : '24h'}
          </Button>
        </div>
      </Card>
    </div>
  )
}
