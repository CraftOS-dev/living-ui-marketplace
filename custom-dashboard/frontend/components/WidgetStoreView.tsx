import { useState, useEffect, useCallback } from 'react'
import type { AppController } from '../AppController'
import type { WidgetConfig, WidgetId } from '../types'
import { Card, Toggle } from './ui'
import { Clock, Cloud, CalendarDays, CheckSquare, FileText, Bell, Sparkles, Box } from 'lucide-react'
import { toast } from 'react-toastify'

interface WidgetStoreViewProps {
  controller: AppController
}

const WIDGET_INFO: Record<WidgetId, { label: string; description: string; icon: React.ReactNode }> = {
  clock:     { label: 'Clock',         description: 'Live clock with date display and 12/24h format toggle.',           icon: <Clock size={20} /> },
  weather:   { label: 'Weather',       description: 'Current temperature, conditions, and 3-day forecast.',             icon: <Cloud size={20} /> },
  calendar:  { label: 'Calendar',      description: 'View and manage upcoming events in a monthly calendar.',            icon: <CalendarDays size={20} /> },
  todos:     { label: 'To-Do List',    description: 'Track tasks with priorities and completion status.',                icon: <CheckSquare size={20} /> },
  notes:     { label: 'Notes',         description: 'Quick notes scratchpad with multi-note support and auto-save.',     icon: <FileText size={20} /> },
  reminders: { label: 'Reminders',     description: 'Set reminders with due dates and track upcoming deadlines.',       icon: <Bell size={20} /> },
  briefing:  { label: 'Daily Briefing',description: 'AI-generated summary of your day: tasks, reminders, and weather.', icon: <Sparkles size={20} /> },
  'slot-1':  { label: 'Slot 1',         description: 'Empty placeholder widget slot.',                                   icon: <Box size={20} /> },
  'slot-2':  { label: 'Slot 2',         description: 'Empty placeholder widget slot.',                                   icon: <Box size={20} /> },
  'slot-3':  { label: 'Slot 3',         description: 'Empty placeholder widget slot.',                                   icon: <Box size={20} /> },
  'slot-4':  { label: 'Slot 4',         description: 'Empty placeholder widget slot.',                                   icon: <Box size={20} /> },
  'slot-5':  { label: 'Slot 5',         description: 'Empty placeholder widget slot.',                                   icon: <Box size={20} /> },
}

export function WidgetStoreView({ controller }: WidgetStoreViewProps) {
  const [configs, setConfigs] = useState<WidgetConfig[]>([])
  const [loading, setLoading] = useState(true)

  const loadConfigs = useCallback(async () => {
    try {
      const all = await controller.getWidgetConfigs()
      setConfigs(all.sort((a, b) => a.position - b.position))
    } catch {
      toast.error('Failed to load widget configurations')
    } finally {
      setLoading(false)
    }
  }, [controller])

  useEffect(() => { loadConfigs() }, [loadConfigs])

  const toggle = async (widgetId: WidgetId, enabled: boolean) => {
    setConfigs(prev => prev.map(c => c.widgetId === widgetId ? { ...c, enabled } : c))
    try {
      await controller.updateWidgetConfig(widgetId, { enabled })
      toast.success(`${WIDGET_INFO[widgetId]?.label ?? widgetId} ${enabled ? 'enabled' : 'disabled'}`)
    } catch {
      toast.error('Failed to update widget')
      loadConfigs()
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 'var(--space-12)' }}>
        <span style={{ color: 'var(--text-muted)' }}>Loading…</span>
      </div>
    )
  }

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <h2 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-semibold)' as any, marginBottom: 'var(--space-1)' }}>
          Widget Store
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)' }}>
          Enable or disable widgets that appear on your dashboard.
        </p>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 'var(--space-4)',
      }}>
        {configs.map(config => {
          const info = WIDGET_INFO[config.widgetId]
          if (!info) return null
          return (
            <Card key={config.widgetId} padding="md" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 'var(--radius-md)',
                  backgroundColor: config.enabled ? 'var(--color-primary-subtle)' : 'var(--bg-tertiary)',
                  color: config.enabled ? 'var(--color-primary)' : 'var(--text-muted)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, transition: 'var(--transition-base)',
                }}>
                  {info.icon}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 'var(--font-weight-semibold)' as any, fontSize: 'var(--font-size-base)', marginBottom: 'var(--space-1)' }}>
                    {info.label}
                  </div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', lineHeight: 'var(--line-height-relaxed)' }}>
                    {info.description}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Toggle
                  checked={config.enabled}
                  onChange={enabled => toggle(config.widgetId, enabled)}
                  label={config.enabled ? 'Enabled' : 'Disabled'}
                />
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
