import { useState, useEffect } from 'react'
import type { AppController } from '../AppController'
import type { WidgetConfig, DashboardView, Task } from '../types'
import { CheckSquare, Circle } from 'lucide-react'
import { Badge, EmptyState } from './ui'
import { toast } from 'react-toastify'

interface TodoWidgetProps {
  controller: AppController
  config: WidgetConfig
  navigate: (view: DashboardView) => void
}

const PRIORITY_COLORS: Record<string, string> = {
  high: 'error',
  medium: 'warning',
  low: 'info',
  none: 'default',
}

export function TodoWidget({ controller, navigate }: TodoWidgetProps) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)

  const load = () => controller.getTasks().then(t => {
    setTasks(t.filter(x => !x.completed).slice(0, 5))
  }).catch(() => {}).finally(() => setLoading(false))

  useEffect(() => { load() }, [controller])

  const toggleTask = async (task: Task) => {
    try {
      await controller.updateTask(task.id, { completed: !task.completed })
      setTasks(prev => prev.filter(t => t.id !== task.id))
    } catch {
      toast.error('Failed to update task')
    }
  }

  if (loading) return <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>Loading…</div>

  if (tasks.length === 0) {
    return (
      <EmptyState
        icon={<CheckSquare size={24} />}
        message="No pending tasks"
        action={
          <button
            onClick={() => navigate('todos')}
            style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Add task
          </button>
        }
      />
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        {tasks.map(task => (
          <div key={task.id} style={{
            display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            padding: 'var(--space-1) 0',
          }}>
            <button
              onClick={() => toggleTask(task)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-muted)', display: 'flex', flexShrink: 0 }}
            >
              <Circle size={16} />
            </button>
            <span style={{
              flex: 1, fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{task.title}</span>
            {task.priority !== 'none' && (
              <Badge variant={PRIORITY_COLORS[task.priority] as any} size="sm">
                {task.priority}
              </Badge>
            )}
          </div>
        ))}
      </div>
      <button
        onClick={() => navigate('todos')}
        style={{
          marginTop: 'auto',
          paddingTop: 'var(--space-2)',
          fontSize: 'var(--font-size-xs)',
          color: 'var(--color-primary)',
          background: 'none', border: 'none', cursor: 'pointer',
          textAlign: 'left', padding: 0,
        }}
      >
        View all tasks →
      </button>
    </div>
  )
}
