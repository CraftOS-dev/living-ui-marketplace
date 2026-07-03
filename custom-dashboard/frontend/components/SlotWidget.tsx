import type { AppController } from '../AppController'
import type { WidgetConfig, DashboardView } from '../types'
import { Box } from 'lucide-react'

interface SlotWidgetProps {
  controller: AppController
  config: WidgetConfig
  navigate: (view: DashboardView) => void
}

export function SlotWidget({ config }: SlotWidgetProps) {
  const num = config.widgetId.split('-')[1]
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100%', gap: 'var(--space-2)', color: 'var(--text-muted)',
    }}>
      <Box size={28} style={{ opacity: 0.4 }} />
      <span style={{ fontSize: 'var(--font-size-sm)', opacity: 0.6 }}>Empty Slot {num}</span>
    </div>
  )
}

interface SlotFullProps {
  controller: AppController
  slotId: string
}

export function SlotFull({ slotId }: SlotFullProps) {
  const num = slotId.split('-')[1]
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '60vh', gap: 'var(--space-4)', color: 'var(--text-muted)',
    }}>
      <Box size={48} style={{ opacity: 0.3 }} />
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-semibold)' as any, marginBottom: 'var(--space-1)' }}>
          Slot {num}
        </div>
        <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>
          Empty placeholder widget
        </div>
      </div>
    </div>
  )
}
