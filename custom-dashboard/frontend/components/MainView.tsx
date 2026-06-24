import { useState, useEffect } from 'react'
import { useAgentAware } from '../agent/hooks'
import type { AppController } from '../AppController'
import type { DashboardView } from '../types'
import { DashboardHome } from './DashboardHome'
import { WidgetStoreView } from './WidgetStoreView'
import { ClockFull } from './ClockFull'
import { WeatherFull } from './WeatherFull'
import { CalendarFull } from './CalendarFull'
import { TodoFull } from './TodoFull'
import { NotesFull } from './NotesFull'
import { RemindersFull } from './RemindersFull'
import { BriefingFull } from './BriefingFull'
import { LayoutDashboard, Store, ArrowLeft } from 'lucide-react'
import { Button } from './ui'

interface MainViewProps {
  controller: AppController
}

const WIDGET_LABELS: Record<string, string> = {
  clock: 'Clock',
  weather: 'Weather',
  calendar: 'Calendar',
  todos: 'To-Do List',
  notes: 'Notes',
  reminders: 'Reminders',
  briefing: 'Daily Briefing',
}

export function MainView({ controller }: MainViewProps) {
  const [view, setView] = useState<DashboardView>('home')
  const [appState, setAppState] = useState(controller.getState())

  useEffect(() => {
    return controller.subscribe(setAppState)
  }, [controller])

  useAgentAware('MainView', { currentView: view })

  if (appState.loading && !appState.initialized) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <div style={{ color: 'var(--text-secondary)' }}>Loading…</div>
      </div>
    )
  }

  if (appState.error) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', flexDirection: 'column',
        gap: 'var(--space-4)', padding: 'var(--space-8)',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 48 }}>⚡</div>
        <h2 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-semibold)' as any, margin: 0 }}>
          Backend Unavailable
        </h2>
        <p style={{ color: 'var(--text-secondary)', maxWidth: 400, margin: 0 }}>
          The backend server is not reachable. If you&apos;re testing locally, start it with:
        </p>
        <code style={{
          backgroundColor: 'var(--bg-tertiary)',
          padding: 'var(--space-2) var(--space-4)',
          borderRadius: 'var(--radius-md)',
          fontSize: 'var(--font-size-sm)',
        }}>
          uvicorn main:app --port 3200
        </code>
        <Button variant="primary" onClick={() => controller.refresh()}>
          Retry
        </Button>
      </div>
    )
  }

  const navigate = (v: DashboardView) => setView(v)

  const isWidgetView = view !== 'home' && view !== 'store'
  const widgetLabel = isWidgetView ? WIDGET_LABELS[view] || view : ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* Top navigation bar */}
      <nav style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        padding: 'var(--space-3) var(--space-4)',
        borderBottom: '1px solid var(--border-primary)',
        backgroundColor: 'var(--bg-secondary)',
        position: 'sticky',
        top: 0,
        zIndex: 'var(--z-sticky)' as any,
      }}>
        {isWidgetView ? (
          <>
            <Button variant="ghost" size="sm" icon={<ArrowLeft size={16} />} onClick={() => navigate('home')}>
              Dashboard
            </Button>
            <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)' }}>›</span>
            <span style={{ fontWeight: 'var(--font-weight-semibold)' as any, fontSize: 'var(--font-size-sm)' }}>
              {widgetLabel}
            </span>
          </>
        ) : (
          <>
            <button
              onClick={() => navigate('home')}
              style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                padding: 'var(--space-2) var(--space-3)',
                borderRadius: 'var(--radius-md)',
                border: 'none',
                cursor: 'pointer',
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--font-weight-medium)' as any,
                backgroundColor: view === 'home' ? 'var(--color-primary-subtle)' : 'transparent',
                color: view === 'home' ? 'var(--color-primary)' : 'var(--text-secondary)',
                transition: 'var(--transition-fast)',
              }}
            >
              <LayoutDashboard size={16} />
              Dashboard
            </button>
            <button
              onClick={() => navigate('store')}
              style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                padding: 'var(--space-2) var(--space-3)',
                borderRadius: 'var(--radius-md)',
                border: 'none',
                cursor: 'pointer',
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--font-weight-medium)' as any,
                backgroundColor: view === 'store' ? 'var(--color-primary-subtle)' : 'transparent',
                color: view === 'store' ? 'var(--color-primary)' : 'var(--text-secondary)',
                transition: 'var(--transition-fast)',
              }}
            >
              <Store size={16} />
              Widget Store
            </button>
          </>
        )}
      </nav>

      {/* Main content */}
      <main style={{ flex: 1, padding: 'var(--space-4)', maxWidth: 1400, margin: '0 auto', width: '100%' }}>
        {view === 'home' && <DashboardHome controller={controller} navigate={navigate} />}
        {view === 'store' && <WidgetStoreView controller={controller} />}
        {view === 'clock' && <ClockFull controller={controller} />}
        {view === 'weather' && <WeatherFull controller={controller} />}
        {view === 'calendar' && <CalendarFull controller={controller} />}
        {view === 'todos' && <TodoFull controller={controller} />}
        {view === 'notes' && <NotesFull controller={controller} />}
        {view === 'reminders' && <RemindersFull controller={controller} />}
        {view === 'briefing' && <BriefingFull controller={controller} />}
      </main>
    </div>
  )
}
