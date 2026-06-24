import { useState, useEffect } from 'react'
import type { AppController } from '../AppController'
import type { Task, TaskPriority } from '../types'
import { Button, Input, Badge, Select, EmptyState } from './ui'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { CheckSquare, GripVertical, Trash2, Plus } from 'lucide-react'
import { toast } from 'react-toastify'

interface TodoFullProps {
  controller: AppController
}

const PRIORITY_BADGE: Record<TaskPriority, { label: string; variant: 'default' | 'info' | 'warning' | 'error' }> = {
  none: { label: 'None', variant: 'default' },
  low: { label: 'Low', variant: 'info' },
  medium: { label: 'Medium', variant: 'warning' },
  high: { label: 'High', variant: 'error' },
}

function SortableTaskRow({ task, onComplete, onDelete }: {
  task: Task
  onComplete: (id: number) => void
  onDelete: (id: number) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  const pb = PRIORITY_BADGE[task.priority]

  return (
    <div ref={setNodeRef} style={{
      ...style,
      display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
      padding: 'var(--space-3)', borderRadius: 'var(--radius-md)',
      backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
      marginBottom: 'var(--space-2)',
    }}>
      <button {...attributes} {...listeners} style={{ cursor: 'grab', background: 'none', border: 'none', color: 'var(--text-muted)', display: 'flex', padding: 2, touchAction: 'none' }}>
        <GripVertical size={14} />
      </button>
      <button
        onClick={() => onComplete(task.id)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: task.completed ? 'var(--color-success)' : 'var(--border-primary)', display: 'flex', flexShrink: 0 }}
        title="Mark complete"
      >
        <CheckSquare size={18} />
      </button>
      <span style={{
        flex: 1,
        fontSize: 'var(--font-size-sm)',
        color: task.completed ? 'var(--text-muted)' : 'var(--text-primary)',
        textDecoration: task.completed ? 'line-through' : 'none',
      }}>
        {task.title}
      </span>
      {task.priority !== 'none' && (
        <Badge variant={pb.variant} size="sm">{pb.label}</Badge>
      )}
      <button onClick={() => onDelete(task.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 'var(--space-1)' }}>
        <Trash2 size={14} />
      </button>
    </div>
  )
}

export function TodoFull({ controller }: TodoFullProps) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [newTitle, setNewTitle] = useState('')
  const [newPriority, setNewPriority] = useState<TaskPriority>('none')
  const [adding, setAdding] = useState(false)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const load = () => {
    controller.getTasks().then(setTasks).catch(() => {}).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [controller])

  const addTask = async () => {
    if (!newTitle.trim()) return
    setAdding(true)
    try {
      const t = await controller.createTask({ title: newTitle.trim(), priority: newPriority })
      setTasks(prev => [...prev, t])
      setNewTitle('')
      setNewPriority('none')
    } catch {
      toast.error('Failed to add task')
    } finally {
      setAdding(false)
    }
  }

  const completeTask = async (id: number) => {
    try {
      const updated = await controller.updateTask(id, { completed: true })
      setTasks(prev => prev.map(t => t.id === id ? updated : t))
    } catch {
      toast.error('Failed to update task')
    }
  }

  const deleteTask = async (id: number) => {
    try {
      await controller.deleteTask(id)
      setTasks(prev => prev.filter(t => t.id !== id))
    } catch {
      toast.error('Failed to delete task')
    }
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = tasks.findIndex(t => t.id === active.id)
    const newIndex = tasks.findIndex(t => t.id === over.id)
    const reordered = arrayMove(tasks, oldIndex, newIndex)
    setTasks(reordered)
    await Promise.all(reordered.map((t, i) => controller.updateTask(t.id, { position: i })))
  }

  const pending = tasks.filter(t => !t.completed)
  const completed = tasks.filter(t => t.completed)

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', paddingTop: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-6)' }}>
        <CheckSquare size={20} style={{ color: 'var(--color-primary)' }} />
        <h2 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-semibold)' as any }}>To-Do List</h2>
      </div>

      {/* Add task */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-6)', alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <Input
            placeholder="New task…"
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addTask()}
          />
        </div>
        <Select
          options={[
            { value: 'none', label: 'Priority' },
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
          ]}
          value={newPriority}
          onChange={e => setNewPriority(e.target.value as TaskPriority)}
          style={{ width: 110 }}
        />
        <Button variant="primary" size="md" icon={<Plus size={16} />} loading={adding} onClick={addTask}>
          Add
        </Button>
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-muted)' }}>Loading…</div>
      ) : tasks.length === 0 ? (
        <EmptyState icon={<CheckSquare size={32} />} message="No tasks yet. Add one above!" />
      ) : (
        <>
          {pending.length > 0 && (
            <>
              <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-semibold)' as any, color: 'var(--text-secondary)', marginBottom: 'var(--space-2)' }}>
                PENDING ({pending.length})
              </div>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={pending.map(t => t.id)} strategy={verticalListSortingStrategy}>
                  {pending.map(t => (
                    <SortableTaskRow key={t.id} task={t} onComplete={completeTask} onDelete={deleteTask} />
                  ))}
                </SortableContext>
              </DndContext>
            </>
          )}

          {completed.length > 0 && (
            <>
              <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-semibold)' as any, color: 'var(--text-muted)', marginBottom: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
                COMPLETED ({completed.length})
              </div>
              {completed.map(t => (
                <div key={t.id} style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                  padding: 'var(--space-3)', borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--bg-tertiary)', marginBottom: 'var(--space-2)',
                }}>
                  <CheckSquare size={18} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', textDecoration: 'line-through' }}>
                    {t.title}
                  </span>
                  <button onClick={() => deleteTask(t.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  )
}
