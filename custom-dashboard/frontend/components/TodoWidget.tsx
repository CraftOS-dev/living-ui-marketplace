import { useState, useEffect } from 'react'
import type { AppController } from '../AppController'
import type { WidgetConfig, DashboardView, Task, TaskPriority } from '../types'
import { Plus, Pencil, Trash2, ArrowLeft, AlertCircle, Minus, Circle, ListChecks, CheckSquare } from 'lucide-react'
import { Badge, Modal, Input, Select, Button } from './ui'
import { toast } from 'react-toastify'

interface TodoWidgetProps {
  controller: AppController
  config: WidgetConfig
  navigate: (view: DashboardView) => void
}

type Category = 'high' | 'medium' | 'low' | 'none' | 'completed' | 'all'

const PRIORITY_COLORS: Record<string, string> = {
  high: 'error',
  medium: 'warning',
  low: 'info',
  none: 'default',
}

const PRIORITY_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
]

const CATEGORIES: { id: Category; label: string; icon: React.ReactNode; filter: (t: Task) => boolean }[] = [
  { id: 'high', label: 'High', icon: <AlertCircle size={12} />, filter: t => !t.completed && t.priority === 'high' },
  { id: 'medium', label: 'Medium', icon: <Minus size={12} />, filter: t => !t.completed && t.priority === 'medium' },
  { id: 'low', label: 'Low', icon: <Circle size={12} />, filter: t => !t.completed && t.priority === 'low' },
  { id: 'none', label: 'None', icon: <ListChecks size={12} />, filter: t => !t.completed && t.priority === 'none' },
  { id: 'completed', label: 'Done', icon: <CheckSquare size={12} />, filter: t => t.completed },
  { id: 'all', label: 'All', icon: <ListChecks size={12} />, filter: () => true },
]

export function TodoWidget({ controller, navigate }: TodoWidgetProps) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Task | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<{ title: string; priority: TaskPriority }>({ title: '', priority: 'none' })
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null)

  const load = () => controller.getTasks().then(setTasks).catch(() => {}).finally(() => setLoading(false))

  useEffect(() => { load() }, [controller])

  const toggleTask = async (task: Task) => {
    try {
      const updated = await controller.updateTask(task.id, { completed: !task.completed })
      setTasks(prev => prev.map(t => t.id === task.id ? updated : t))
    } catch {
      toast.error('Failed to update task')
    }
  }

  const deleteTask = async (id: number) => {
    try {
      await controller.deleteTask(id)
      setTasks(prev => prev.filter(t => t.id !== id))
      toast.success('Task deleted')
    } catch {
      toast.error('Failed to delete task')
    }
  }

  function openAdd() {
    setEditing(null)
    setForm({ title: '', priority: 'none' })
    setModalOpen(true)
  }

  function openEdit(task: Task) {
    setEditing(task)
    setForm({ title: task.title, priority: task.priority })
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.title.trim()) {
      toast.error('Title is required')
      return
    }
    setSaving(true)
    try {
      if (editing) {
        await controller.updateTask(editing.id, form)
        toast.success('Task updated')
      } else {
        await controller.createTask(form)
        toast.success('Task added')
      }
      setModalOpen(false)
      await load()
    } catch {
      toast.error(editing ? 'Failed to update task' : 'Failed to add task')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>Loading…</div>

  const modal = (
    <Modal
      open={modalOpen}
      onClose={() => setModalOpen(false)}
      title={editing ? 'Edit Task' : 'Add Task'}
      footer={
        <>
          <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={handleSave}>{editing ? 'Save' : 'Add'}</Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <Input
          label="Title"
          value={form.title}
          onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
          placeholder="Buy groceries"
        />
        <Select
          label="Priority"
          value={form.priority}
          onChange={e => setForm(f => ({ ...f, priority: e.target.value as TaskPriority }))}
          options={PRIORITY_OPTIONS}
        />
      </div>
    </Modal>
  )

  const counts = Object.fromEntries(CATEGORIES.map(c => [c.id, tasks.filter(c.filter).length])) as Record<Category, number>
  const activeCategory = CATEGORIES.find(c => c.id === selectedCategory)
  const displayed = activeCategory ? tasks.filter(activeCategory.filter) : []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      {!activeCategory ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-1)' }}>
          {CATEGORIES.map(c => (
            <button
              key={c.id}
              onClick={() => setSelectedCategory(c.id)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                padding: 'var(--space-2) var(--space-1)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-primary)',
                backgroundColor: 'var(--bg-tertiary)',
                cursor: 'pointer',
              }}
            >
              <div style={{
                width: 20, height: 20, borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--color-primary-subtle)', color: 'var(--color-primary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {c.icon}
              </div>
              <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--text-primary)' }}>
                {counts[c.id]}
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>{c.label}</div>
            </button>
          ))}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', marginBottom: 'var(--space-1)' }}>
            <button onClick={() => setSelectedCategory(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', padding: 2 }}>
              <ArrowLeft size={14} />
            </button>
            <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-semibold)' as any, color: 'var(--text-primary)' }}>
              {activeCategory.label}
            </span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {displayed.length === 0 ? (
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', textAlign: 'center', padding: 'var(--space-2)' }}>No tasks</div>
            ) : displayed.map(task => (
              <div key={task.id} style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                padding: 'var(--space-1) 0',
              }}>
                <button
                  onClick={() => toggleTask(task)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: task.completed ? 'var(--color-success)' : 'var(--text-muted)', display: 'flex', flexShrink: 0 }}
                >
                  <CheckSquare size={16} />
                </button>
                <span style={{
                  flex: 1, fontSize: 'var(--font-size-sm)',
                  color: task.completed ? 'var(--text-muted)' : 'var(--text-primary)',
                  textDecoration: task.completed ? 'line-through' : 'none',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{task.title}</span>
                {task.priority !== 'none' && (
                  <Badge variant={PRIORITY_COLORS[task.priority] as any} size="sm">
                    {task.priority}
                  </Badge>
                )}
                <button
                  onClick={() => openEdit(task)}
                  title="Edit task"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', flexShrink: 0 }}
                >
                  <Pencil size={12} />
                </button>
                <button
                  onClick={() => deleteTask(task.id)}
                  title="Delete task"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', flexShrink: 0 }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', paddingTop: 'var(--space-2)' }}>
        <button
          onClick={() => navigate('todos')}
          style={{
            fontSize: 'var(--font-size-xs)',
            color: 'var(--color-primary)',
            background: 'none', border: 'none', cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          View all tasks →
        </button>
        <button
          onClick={openAdd}
          title="Quick add task"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', display: 'flex', padding: 0 }}
        >
          <Plus size={16} />
        </button>
      </div>
      {modal}
    </div>
  )
}
