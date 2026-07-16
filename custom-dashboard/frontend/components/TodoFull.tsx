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
import { CheckSquare, GripVertical, Trash2, Plus, ArrowLeft, ListChecks, AlertCircle, Minus, Circle } from 'lucide-react'
import { toast } from 'react-toastify'

interface TodoFullProps {
  controller: AppController
}

type Category = 'high' | 'medium' | 'low' | 'none' | 'completed' | 'all'

const PRIORITY_BADGE: Record<TaskPriority, { label: string; variant: 'default' | 'info' | 'warning' | 'error' }> = {
  none: { label: 'None', variant: 'default' },
  low: { label: 'Low', variant: 'info' },
  medium: { label: 'Medium', variant: 'warning' },
  high: { label: 'High', variant: 'error' },
}

const CATEGORIES: { id: Category; label: string; icon: React.ReactNode; filter: (t: Task) => boolean }[] = [
  { id: 'high', label: 'High Priority', icon: <AlertCircle size={18} />, filter: t => !t.completed && t.priority === 'high' },
  { id: 'medium', label: 'Medium Priority', icon: <Minus size={18} />, filter: t => !t.completed && t.priority === 'medium' },
  { id: 'low', label: 'Low Priority', icon: <Circle size={18} />, filter: t => !t.completed && t.priority === 'low' },
  { id: 'none', label: 'No Priority', icon: <ListChecks size={18} />, filter: t => !t.completed && t.priority === 'none' },
  { id: 'completed', label: 'Completed', icon: <CheckSquare size={18} />, filter: t => t.completed },
  { id: 'all', label: 'All', icon: <ListChecks size={18} />, filter: () => true },
]

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
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null)

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
    if (!over || active.id === over.id || !activeCategory) return
    const displayed = tasks.filter(activeCategory.filter)
    const oldIndex = displayed.findIndex(t => t.id === active.id)
    const newIndex = displayed.findIndex(t => t.id === over.id)
    const reordered = arrayMove(displayed, oldIndex, newIndex)
    const reorderedIds = new Set(reordered.map(t => t.id))
    setTasks(prev => {
      const untouched = prev.filter(t => !reorderedIds.has(t.id))
      return [...untouched, ...reordered]
    })
    await Promise.all(reordered.map((t, i) => controller.updateTask(t.id, { position: i })))
  }

  const counts = Object.fromEntries(CATEGORIES.map(c => [c.id, tasks.filter(c.filter).length])) as Record<Category, number>
  const activeCategory = CATEGORIES.find(c => c.id === selectedCategory)
  const displayed = activeCategory ? tasks.filter(activeCategory.filter) : []

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', paddingTop: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-6)' }}>
        {selectedCategory && (
          <button onClick={() => setSelectedCategory(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', padding: 'var(--space-1)' }}>
            <ArrowLeft size={18} />
          </button>
        )}
        <CheckSquare size={20} style={{ color: 'var(--color-primary)' }} />
        <h2 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-semibold)' as any }}>
          {activeCategory ? activeCategory.label : 'To-Do List'}
        </h2>
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
      ) : !activeCategory ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-3)' }}>
          {CATEGORIES.map(c => (
            <button
              key={c.id}
              onClick={() => setSelectedCategory(c.id)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 'var(--space-3)',
                padding: 'var(--space-4)',
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--border-primary)',
                backgroundColor: 'var(--bg-secondary)',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <div style={{
                width: 36, height: 36, borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--color-primary-subtle)', color: 'var(--color-primary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {c.icon}
              </div>
              <div>
                <div style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--text-primary)' }}>
                  {counts[c.id]}
                </div>
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>{c.label}</div>
              </div>
            </button>
          ))}
        </div>
      ) : displayed.length === 0 ? (
        <EmptyState icon={<CheckSquare size={32} />} message={`No tasks in ${activeCategory.label}`} />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={displayed.map(t => t.id)} strategy={verticalListSortingStrategy}>
            {displayed.map(t => (
              <SortableTaskRow key={t.id} task={t} onComplete={completeTask} onDelete={deleteTask} />
            ))}
          </SortableContext>
        </DndContext>
      )}
    </div>
  )
}
