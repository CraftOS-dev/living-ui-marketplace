import { useState, useEffect } from 'react'
import type { AppController } from '../AppController'
import type { Reminder, ReminderCreate } from '../types'
import { Button, Input, Badge, Modal, EmptyState } from './ui'
import { Bell, Plus, Trash2, Check } from 'lucide-react'
import { toast } from 'react-toastify'

interface RemindersFullProps {
  controller: AppController
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
  const [showCompleted, setShowCompleted] = useState(false)

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

  const deleteReminder = async (id: number) => {
    try {
      await controller.deleteReminder(id)
      setReminders(prev => prev.filter(r => r.id !== id))
    } catch {
      toast.error('Failed to delete reminder')
    }
  }

  const pending = reminders.filter(r => !r.completed)
  const completed = reminders.filter(r => r.completed)
  const displayed = showCompleted ? completed : pending

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', paddingTop: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Bell size={20} style={{ color: 'var(--color-primary)' }} />
          <h2 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-semibold)' as any }}>Reminders</h2>
        </div>
        <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setModalOpen(true)}>
          Add
        </Button>
      </div>

      {/* Toggle pending/completed */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        <button
          onClick={() => setShowCompleted(false)}
          style={{
            padding: 'var(--space-1) var(--space-3)',
            borderRadius: 'var(--radius-full)',
            border: 'none', cursor: 'pointer', fontSize: 'var(--font-size-sm)',
            backgroundColor: !showCompleted ? 'var(--color-primary)' : 'var(--bg-tertiary)',
            color: !showCompleted ? 'white' : 'var(--text-secondary)',
          }}
        >
          Pending ({pending.length})
        </button>
        <button
          onClick={() => setShowCompleted(true)}
          style={{
            padding: 'var(--space-1) var(--space-3)',
            borderRadius: 'var(--radius-full)',
            border: 'none', cursor: 'pointer', fontSize: 'var(--font-size-sm)',
            backgroundColor: showCompleted ? 'var(--color-primary)' : 'var(--bg-tertiary)',
            color: showCompleted ? 'white' : 'var(--text-secondary)',
          }}
        >
          Done ({completed.length})
        </button>
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-muted)' }}>Loading…</div>
      ) : displayed.length === 0 ? (
        <EmptyState
          icon={<Bell size={32} />}
          message={showCompleted ? 'No completed reminders' : 'No pending reminders'}
          action={!showCompleted ? (
            <Button size="sm" icon={<Plus size={14} />} onClick={() => setModalOpen(true)}>Add reminder</Button>
          ) : undefined}
        />
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
