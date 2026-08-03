import { useState, useEffect, useCallback } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { AppController } from '../AppController'
import type { WidgetConfig, DashboardView } from '../types'
import { WidgetCard } from './WidgetCard'
import { ClockWidget } from './ClockWidget'
import { WeatherWidget } from './WeatherWidget'
import { CalendarWidget } from './CalendarWidget'
import { TodoWidget } from './TodoWidget'
import { NotesWidget } from './NotesWidget'
import { RemindersWidget } from './RemindersWidget'
import { BriefingWidget } from './BriefingWidget'
import { CalculatorWidget } from './CalculatorWidget'
import { ContactsWidget } from './ContactsWidget'
import { UnitConverterWidget } from './UnitConverterWidget'
import { TimerWidget } from './TimerWidget'
import { QRCodeWidget } from './QRCodeWidget'
import { EmptyState } from './ui'
import { Clock, Cloud, CalendarDays, CheckSquare, FileText, Bell, Sparkles, Store, Calculator, Users, Ruler, Timer, QrCode } from 'lucide-react'

interface DashboardHomeProps {
  controller: AppController
  navigate: (view: DashboardView) => void
}

const WIDGET_META: Record<string, { label: string; icon: React.ReactNode; component: React.FC<any> }> = {
  clock:     { label: 'Clock',         icon: <Clock size={14} />,       component: ClockWidget },
  weather:   { label: 'Weather',       icon: <Cloud size={14} />,       component: WeatherWidget },
  calendar:  { label: 'Calendar',      icon: <CalendarDays size={14} />, component: CalendarWidget },
  todos:     { label: 'To-Do List',    icon: <CheckSquare size={14} />, component: TodoWidget },
  notes:     { label: 'Notes',         icon: <FileText size={14} />,    component: NotesWidget },
  reminders: { label: 'Reminders',     icon: <Bell size={14} />,        component: RemindersWidget },
  briefing:  { label: 'Daily Briefing',icon: <Sparkles size={14} />,    component: BriefingWidget },
  calculator:{ label: 'Calculator',    icon: <Calculator size={14} />,  component: CalculatorWidget },
  contacts:  { label: 'Contacts',      icon: <Users size={14} />,       component: ContactsWidget },
  converter: { label: 'Unit Converter',icon: <Ruler size={14} />,       component: UnitConverterWidget },
  timer:     { label: 'Timer',         icon: <Timer size={14} />,       component: TimerWidget },
  qrcode:    { label: 'QR Code',       icon: <QrCode size={14} />,      component: QRCodeWidget },
}

interface SortableWidgetProps {
  config: WidgetConfig
  controller: AppController
  navigate: (view: DashboardView) => void
}

function SortableWidget({ config, controller, navigate }: SortableWidgetProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: config.widgetId,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 10 : 1,
  }

  const meta = WIDGET_META[config.widgetId]
  if (!meta) return null

  const WidgetComp = meta.component

  return (
    <div ref={setNodeRef} style={style}>
      <WidgetCard
        title={meta.label}
        icon={meta.icon}
        onExpand={() => navigate(config.widgetId as DashboardView)}
        dragHandleProps={{ ...attributes, ...listeners }}
      >
        <WidgetComp controller={controller} config={config} navigate={navigate} />
      </WidgetCard>
    </div>
  )
}

export function DashboardHome({ controller, navigate }: DashboardHomeProps) {
  const [configs, setConfigs] = useState<WidgetConfig[]>([])
  const [loading, setLoading] = useState(true)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const loadConfigs = useCallback(async () => {
    if (!controller.isBackendAvailable()) {
      setLoading(false)
      return
    }
    try {
      const all = await controller.getWidgetConfigs()
      setConfigs(all.sort((a, b) => a.position - b.position))
    } catch (e) {
      console.error('Failed to load widget configs', e)
    } finally {
      setLoading(false)
    }
  }, [controller])

  useEffect(() => { loadConfigs() }, [loadConfigs])

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = configs.findIndex(c => c.widgetId === active.id)
    const newIndex = configs.findIndex(c => c.widgetId === over.id)
    const reordered = arrayMove(configs, oldIndex, newIndex)
    setConfigs(reordered)

    // Persist new positions
    await Promise.all(
      reordered.map((c, i) => {
        if (c.position !== i) {
          return controller.updateWidgetConfig(c.widgetId, { position: i })
        }
      })
    )
  }

  const enabled = configs.filter(c => c.enabled)

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 'var(--space-12)' }}>
        <span style={{ color: 'var(--text-muted)' }}>Loading widgets…</span>
      </div>
    )
  }

  if (enabled.length === 0) {
    return (
      <EmptyState
        icon={<Store size={48} />}
        title="No widgets enabled"
        message="Head to Settings to enable some widgets for your dashboard."
        action={
          <button
            onClick={() => navigate('store')}
            style={{
              padding: 'var(--space-2) var(--space-4)',
              backgroundColor: 'var(--color-primary)',
              color: 'white',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              fontSize: 'var(--font-size-sm)',
            }}
          >
            Open Settings
          </button>
        }
      />
    )
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={enabled.map(c => c.widgetId)} strategy={rectSortingStrategy}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: 'var(--space-4)',
        }}>
          {enabled.map(config => (
            <SortableWidget
              key={config.widgetId}
              config={config}
              controller={controller}
              navigate={navigate}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
