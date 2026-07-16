import { useState, useEffect } from 'react'
import type { AppController } from '../AppController'
import type { Reminder, ReminderCreate } from '../types'
import { Button, Input, Badge, Modal, EmptyState } from './ui'
import { Bell, Plus, Trash2, Check, Flag, ArrowLeft, CalendarDays, CalendarClock, ListChecks, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { toast } from 'react-toastify'

interface RemindersFullProps {
  controller: AppController
}

type Category = 'today' | 'scheduled' | 'all' | 'flagged' | 'urgent' | 'completed'

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function timeRemaining(dueDate: string | null, dueTime: string | null): { label: string; overdue: boolean } {
  if (!dueDate) return { label: 'No due date', overdue: false }
  const due = new Date(`${dueDate}T${dueTime ?? '23:59'}`)
  const now = new Date()
  const diffMs = due.getTime() - now.getTime()
  if (diffMs < 0) return { label: 'Overdue', overdue: true }
  const diffH = Math.floor(diffMs / 3600000)
  if (diffH < 1) return { label: 'Due soon', overdue: false }
  if (diffH < 24) return { label: `${diffH}h remaining`, overdue: false }
  const diffD = Math.floor(diffH / 24)
  return { label: diffD === 1 ? 'Tomorrow' : `In ${diffD} days`, overdue: false }
}

function isUrgent(r: Reminder): boolean {
  if (r.completed || !r.dueDate) return false
  const due = new Date(`${r.dueDate}T${r.dueTime ?? '23:59'}`)
  return due.getTime() - Date.now() < 24 * 3600000
}

const CATEGORIES: { id: Category; label: string; icon: React.ReactNode; filter: (r: Reminder, today: string) => boolean }[] = [
  { id: 'today', label: 'Today', icon: <CalendarClock size={18} />, filter: (r, today) => !r.completed && r.dueDate === today },
  { id: 'scheduled', label: 'Scheduled', icon: <CalendarDays size={18} />, filter: r => !r.completed && !!r.dueDate },
  { id: 'all', label: 'All', icon: <ListChecks size={18} />, filter: r => !r.completed },
  { id: 'flagged', label: 'Flagged', icon: <Flag size={18} />, filter: r => !r.completed && r.flagged },
  { id: 'urgent', label: 'Urgent', icon: <AlertTriangle size={18} />, filter: r => isUrgent(r) },
  { id: 'completed', label: 'Completed', icon: <CheckCircle2 size={18} />, filter: r => r.completed },
]

interface AddModalProps {
  open: boolean
  onClose: () => void
  onSave: (data: ReminderCreate) => Promise<void>
}

function AddModal({ open, onClose, onSave }: AddModalProps) {
  const [form, setForm] = useState<ReminderCreate>({ title: '', due_date: '', due_time: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setForm({ title: '', due_date: '', due_time: '' })
  }, [open])

  const submit = async () => {
    if (!form.title.trim()) return
    setSaving(true)
    try {
      await onSave({ ...form, due_date: form.due_date || null, due_time: form.due_time || null })
      onClose()
    } catch {
      toast.error('Failed to save reminder')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New Reminder" size="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" loading={saving} onClick={submit}>Save</Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <Input label="Title *" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
        <Input label="Due date" type="date" value={form.due_date ?? ''} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
        <Input label="Due time" type="time" value={form.due_time ?? ''} onChange={e => setForm(f => ({ ...f, due_time: e.target.value }))} />
      </div>
    </Modal>
  )
}

export function RemindersFull({ controller }: RemindersFullProps) {
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null)

  const load = () => {
    controller.getReminders().then(rs => {
      const sorted = [...rs].sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return 0
        if (!a.dueDate) return 1
        if (!b.dueDate) return -1
        const da = `${a.dueDate}T${a.dueTime ?? '23:59'}`
        const db = `${b.dueDate}T${b.dueTime ?? '23:59'}`
        return da < db ? -1 : 1
      })
      setReminders(sorted)
    }).catch(() => {}).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [controller])

  const createReminder = async (data: ReminderCreate) => {
    await controller.createReminder(data)
    load()
    toast.success('Reminder created')
  }

  const completeReminder = async (id: number) => {
    try {
      await controller.updateReminder(id, { completed: true })
      setReminders(prev => prev.map(r => r.id === id ? { ...r, completed: true } : r))
    } catch {
      toast.error('Failed to update reminder')
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

  const deleteReminder = async (id: number) => {
    try {
      await controller.deleteReminder(id)
      setReminders(prev => prev.filter(r => r.id !== id))
    } catch {
      toast.error('Failed to delete reminder')
    }
  }

  const today = todayStr()
  const counts = Object.fromEntries(CATEGORIES.map(c => [c.id, reminders.filter(r => c.filter(r, today)).length])) as Record<Category, number>
  const activeCategory = CATEGORIES.find(c => c.id === selectedCategory)
  const displayed = activeCategory ? reminders.filter(r => activeCategory.filter(r, today)) : []

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', paddingTop: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          {selectedCategory && (
            <button onClick={() => setSelectedCategory(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', padding: 'var(--space-1)' }}>
              <ArrowLeft size={18} />
            </button>
          )}
          <Bell size={20} style={{ color: 'var(--color-primary)' }} />
          <h2 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-semibold)' as any }}>
            {activeCategory ? activeCategory.label : 'Reminders'}
          </h2>
        </div>
        <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setModalOpen(true)}>
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
        <EmptyState icon={<Bell size={32} />} message={`No ${activeCategory.label.toLowerCase()} reminders`} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {displayed.map(r => {
            const { label, overdue } = timeRemaining(r.dueDate, r.dueTime)
            return (
              <div key={r.id} style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                padding: 'var(--space-3) var(--space-4)',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--bg-secondary)',
                border: `1px solid ${overdue ? 'var(--color-error)' : 'var(--border-primary)'}`,
              }}>
                <Bell size={16} style={{ color: overdue ? 'var(--color-error)' : 'var(--color-primary)', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 'var(--font-weight-medium)' as any,
                    color: r.completed ? 'var(--text-muted)' : 'var(--text-primary)',
                    textDecoration: r.completed ? 'line-through' : 'none',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {r.title}
                  </div>
                  {r.dueDate && (
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
                      {new Date(`${r.dueDate}T${r.dueTime ?? '12:00'}`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                      {r.dueTime ? ` at ${r.dueTime}` : ''}
                    </div>
                  )}
                </div>
                <Badge variant={overdue ? 'error' : r.completed ? 'success' : 'default'} size="sm">
                  {r.completed ? 'Done' : label}
                </Badge>
                <button onClick={() => toggleFlag(r)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: r.flagged ? 'var(--color-primary)' : 'var(--text-muted)', display: 'flex' }} title={r.flagged ? 'Unflag' : 'Flag'}>
                  <Flag size={16} fill={r.flagged ? 'currentColor' : 'none'} />
                </button>
                {!r.completed && (
                  <button onClick={() => completeReminder(r.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-success)', display: 'flex' }} title="Mark done">
                    <Check size={16} />
                  </button>
                )}
                <button onClick={() => deleteReminder(r.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }} title="Delete">
                  <Trash2 size={14} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      <AddModal open={modalOpen} onClose={() => setModalOpen(false)} onSave={createReminder} />
    </div>
  )
}
