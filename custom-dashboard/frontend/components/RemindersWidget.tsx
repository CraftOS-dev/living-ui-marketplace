import { useState, useEffect, useCallback } from 'react'
import type { AppController } from '../AppController'
import type { WidgetConfig, DashboardView, Reminder } from '../types'
import { Bell, Plus, Pencil, Trash2, Flag, ArrowLeft, CalendarDays, CalendarClock, ListChecks, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Modal, Input, Button } from './ui'
import { toast } from 'react-toastify'

interface RemindersWidgetProps {
  controller: AppController
  config: WidgetConfig
  navigate: (view: DashboardView) => void
}

type Category = 'today' | 'scheduled' | 'all' | 'flagged' | 'urgent' | 'completed'

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function timeRemaining(dueDate: string | null, dueTime: string | null): string {
  if (!dueDate) return 'No due date'
  const due = new Date(`${dueDate}T${dueTime ?? '23:59'}`)
  const now = new Date()
  const diffMs = due.getTime() - now.getTime()
  if (diffMs < 0) return 'Overdue'
  const diffH = Math.floor(diffMs / 3600000)
  if (diffH < 24) return diffH < 1 ? 'Due soon' : `${diffH}h`
  const diffD = Math.floor(diffH / 24)
  return diffD === 1 ? 'Tomorrow' : `In ${diffD} days`
}

function isUrgent(r: Reminder): boolean {
  if (r.completed || !r.dueDate) return false
  const due = new Date(`${r.dueDate}T${r.dueTime ?? '23:59'}`)
  return due.getTime() - Date.now() < 24 * 3600000
}

const CATEGORIES: { id: Category; label: string; icon: React.ReactNode; filter: (r: Reminder, today: string) => boolean }[] = [
  { id: 'today', label: 'Today', icon: <CalendarClock size={12} />, filter: (r, today) => !r.completed && r.dueDate === today },
  { id: 'scheduled', label: 'Sched.', icon: <CalendarDays size={12} />, filter: r => !r.completed && !!r.dueDate },
  { id: 'all', label: 'All', icon: <ListChecks size={12} />, filter: r => !r.completed },
  { id: 'flagged', label: 'Flagged', icon: <Flag size={12} />, filter: r => !r.completed && r.flagged },
  { id: 'urgent', label: 'Urgent', icon: <AlertTriangle size={12} />, filter: r => isUrgent(r) },
  { id: 'completed', label: 'Done', icon: <CheckCircle2 size={12} />, filter: r => r.completed },
]

export function RemindersWidget({ controller, navigate }: RemindersWidgetProps) {
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Reminder | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ title: '', due_date: '' })
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null)

  const load = useCallback(() => {
    return controller.getReminders()
      .then(setReminders)
      .catch(() => {})
  }, [controller])

  useEffect(() => {
    load().finally(() => setLoading(false))
  }, [load])

  function openAdd() {
    setEditing(null)
    setForm({ title: '', due_date: '' })
    setModalOpen(true)
  }

  function openEdit(reminder: Reminder) {
    setEditing(reminder)
    setForm({ title: reminder.title, due_date: reminder.dueDate ?? '' })
    setModalOpen(true)
  }

  const deleteReminder = async (id: number) => {
    try {
      await controller.deleteReminder(id)
      setReminders(prev => prev.filter(r => r.id !== id))
      toast.success('Reminder deleted')
    } catch {
      toast.error('Failed to delete reminder')
    }
  }

  const toggleFlag = async (r: Reminder) => {
    try {
      await controller.updateReminder(r.id, { flagged: !r.flagged })
      setReminders(prev => prev.map(x => x.id === r.id ? { ...x, flagged: !x.flagged } : x))
    } catch {
      toast.error('Failed to update reminder')
    }
  }

  const completeReminder = async (r: Reminder) => {
    try {
      await controller.updateReminder(r.id, { completed: !r.completed })
      setReminders(prev => prev.map(x => x.id === r.id ? { ...x, completed: !x.completed } : x))
    } catch {
      toast.error('Failed to update reminder')
    }
  }

  async function handleSave() {
    if (!form.title.trim()) {
      toast.error('Title is required')
      return
    }
    setSaving(true)
    try {
      if (editing) {
        await controller.updateReminder(editing.id, { title: form.title, due_date: form.due_date || null })
        toast.success('Reminder updated')
      } else {
        await controller.createReminder({ title: form.title, due_date: form.due_date || null })
        toast.success('Reminder added')
      }
      setModalOpen(false)
      await load()
    } catch {
      toast.error(editing ? 'Failed to update reminder' : 'Failed to add reminder')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>Loading…</div>

  const modal = (
    <Modal
      open={modalOpen}
      onClose={() => setModalOpen(false)}
      title={editing ? 'Edit Reminder' : 'Add Reminder'}
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
          placeholder="Call the dentist"
        />
        <Input
          label="Due date"
          type="date"
          value={form.due_date}
          onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
        />
      </div>
    </Modal>
  )

  const today = todayStr()
  const counts = Object.fromEntries(CATEGORIES.map(c => [c.id, reminders.filter(r => c.filter(r, today)).length])) as Record<Category, number>
  const activeCategory = CATEGORIES.find(c => c.id === selectedCategory)
  const displayed = activeCategory ? reminders.filter(r => activeCategory.filter(r, today)) : []

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
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {displayed.length === 0 ? (
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', textAlign: 'center', padding: 'var(--space-2)' }}>No reminders</div>
            ) : displayed.map(r => {
              const remaining = timeRemaining(r.dueDate, r.dueTime)
              const isOverdue = remaining === 'Overdue'
              return (
                <div key={r.id} style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                }}>
                  <button
                    onClick={() => completeReminder(r)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: r.completed ? 'var(--color-success)' : 'var(--text-muted)', display: 'flex', flexShrink: 0 }}
                  >
                    <Bell size={14} style={{ color: r.completed ? 'var(--color-success)' : isOverdue ? 'var(--color-error)' : 'var(--color-primary)' }} />
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 'var(--font-size-sm)', color: r.completed ? 'var(--text-muted)' : 'var(--text-primary)',
                      textDecoration: r.completed ? 'line-through' : 'none',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {r.title}
                    </div>
                    <div style={{ fontSize: 'var(--font-size-xs)', color: isOverdue && !r.completed ? 'var(--color-error)' : 'var(--text-muted)' }}>
                      {r.completed ? 'Done' : remaining}
                    </div>
                  </div>
                  <button
                    onClick={() => toggleFlag(r)}
                    title={r.flagged ? 'Unflag' : 'Flag'}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: r.flagged ? 'var(--color-primary)' : 'var(--text-muted)', display: 'flex', flexShrink: 0 }}
                  >
                    <Flag size={12} fill={r.flagged ? 'currentColor' : 'none'} />
                  </button>
                  <button
                    onClick={() => openEdit(r)}
                    title="Edit reminder"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', flexShrink: 0 }}
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={() => deleteReminder(r.id)}
                    title="Delete reminder"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', flexShrink: 0 }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              )
            })}
          </div>
        </>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', paddingTop: 'var(--space-2)' }}>
        <button
          onClick={() => navigate('reminders')}
          style={{
            fontSize: 'var(--font-size-xs)',
            color: 'var(--color-primary)',
            background: 'none', border: 'none', cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          View all →
        </button>
        <button
          onClick={openAdd}
          title="Quick add reminder"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', display: 'flex', padding: 0 }}
        >
          <Plus size={16} />
        </button>
      </div>
      {modal}
    </div>
  )
}
