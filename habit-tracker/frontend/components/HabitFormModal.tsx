import { useEffect, useState } from 'react'
import { toast } from 'react-toastify'
import { Trash2 } from 'lucide-react'
import { Modal, Button, Input, Textarea, Select } from './ui'
import type { Category, Habit, HabitType } from '../types'
import type { AppController } from '../AppController'
import { ICON_NAMES, getIcon, HABIT_COLORS } from '../lib/icons'
import { tintColor } from '../lib/dates'

interface HabitFormModalProps {
  open: boolean
  habit: Habit | null
  categories: Category[]
  controller: AppController
  onClose: () => void
}

interface FormState {
  name: string
  description: string
  type: HabitType
  target: string
  unit: string
  color: string
  icon: string
  category_id: number | null
}

const TYPE_OPTIONS = [
  { value: 'binary', label: 'Binary — done / not done' },
  { value: 'count', label: 'Count — increment to a target' },
  { value: 'duration', label: 'Duration — minutes per day' },
  { value: 'negative', label: 'Avoid — habit to break' },
] as const

export function HabitFormModal({ open, habit, categories, controller, onClose }: HabitFormModalProps) {
  const isEdit = !!habit
  const [form, setForm] = useState<FormState>(() => initialForm(habit))
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({})

  useEffect(() => {
    if (open) {
      setForm(initialForm(habit))
      setErrors({})
    }
  }, [open, habit?.id])

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
  }

  const validate = (): boolean => {
    const e: Partial<Record<keyof FormState, string>> = {}
    if (!form.name.trim()) e.name = 'Name is required'
    if (form.type === 'count' || form.type === 'duration') {
      const n = Number(form.target)
      if (!form.target || Number.isNaN(n) || n <= 0) {
        e.target = 'Target must be a positive number'
      }
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const submit = async () => {
    if (!validate()) return
    setBusy(true)
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        type: form.type,
        target:
          form.type === 'count' || form.type === 'duration'
            ? Number(form.target)
            : null,
        unit:
          form.type === 'count' || form.type === 'duration'
            ? form.unit.trim() || (form.type === 'duration' ? 'min' : 'reps')
            : null,
        color: form.color,
        icon: form.icon,
        category_id: form.category_id,
      }
      if (isEdit && habit) {
        await controller.updateHabit(habit.id, payload)
        toast.success('Habit updated')
      } else {
        await controller.createHabit(payload)
        toast.success('Habit created')
      }
      onClose()
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save habit')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!habit) return
    if (!confirm(`Delete "${habit.name}"? This will remove all of its history.`)) return
    setBusy(true)
    try {
      await controller.deleteHabit(habit.id)
      toast.success('Habit deleted')
      onClose()
    } catch (err: any) {
      toast.error(err?.message || 'Failed to delete habit')
    } finally {
      setBusy(false)
    }
  }

  const archive = async () => {
    if (!habit) return
    setBusy(true)
    try {
      await controller.updateHabit(habit.id, { archived: !habit.archived })
      toast.success(habit.archived ? 'Habit unarchived' : 'Habit archived')
      onClose()
    } catch (err: any) {
      toast.error(err?.message || 'Failed to archive habit')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit habit' : 'New habit'}
      size="lg"
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
          <div>
            {isEdit && (
              <Button variant="ghost" size="sm" onClick={archive} disabled={busy}>
                {habit?.archived ? 'Unarchive' : 'Archive'}
              </Button>
            )}
            {isEdit && (
              <Button
                variant="danger"
                size="sm"
                icon={<Trash2 size={13} />}
                onClick={remove}
                disabled={busy}
              >
                Delete
              </Button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submit} loading={busy}>
              {isEdit ? 'Save' : 'Create'}
            </Button>
          </div>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Input
          label="Name"
          autoFocus
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          error={errors.name}
          placeholder="Meditate, Pushups, No soda…"
        />

        <Textarea
          label="Description (optional)"
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          rows={2}
          placeholder="Why this habit matters to you"
        />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          <Select
            label="Type"
            value={form.type}
            onChange={(e) => set('type', e.target.value as HabitType)}
            options={TYPE_OPTIONS as unknown as { value: string; label: string }[]}
          />
          <Select
            label="Category"
            value={form.category_id !== null ? String(form.category_id) : ''}
            onChange={(e) =>
              set('category_id', e.target.value === '' ? null : Number(e.target.value))
            }
            options={[
              { value: '', label: 'Uncategorized' },
              ...categories.map((c) => ({ value: String(c.id), label: c.name })),
            ]}
          />
        </div>

        {(form.type === 'count' || form.type === 'duration') && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            <Input
              label="Target per day"
              type="number"
              min={1}
              value={form.target}
              onChange={(e) => set('target', e.target.value)}
              error={errors.target}
              placeholder={form.type === 'duration' ? '30' : '8'}
            />
            <Input
              label="Unit"
              value={form.unit}
              onChange={(e) => set('unit', e.target.value)}
              placeholder={form.type === 'duration' ? 'min' : 'reps / glasses'}
            />
          </div>
        )}

        <ColorPicker selected={form.color} onChange={(c) => set('color', c)} />

        <IconPicker selected={form.icon} color={form.color} onChange={(i) => set('icon', i)} />
      </div>
    </Modal>
  )
}

function initialForm(habit: Habit | null): FormState {
  if (habit) {
    return {
      name: habit.name,
      description: habit.description || '',
      type: habit.type,
      target: habit.target != null ? String(habit.target) : '',
      unit: habit.unit || '',
      color: habit.color,
      icon: habit.icon,
      category_id: habit.categoryId ?? habit.category_id ?? null,
    }
  }
  return {
    name: '',
    description: '',
    type: 'binary',
    target: '',
    unit: '',
    color: HABIT_COLORS[5],
    icon: 'CheckCircle2',
    category_id: null,
  }
}

// ----------------------------------------------------------- ColorPicker

function ColorPicker({
  selected,
  onChange,
}: {
  selected: string
  onChange: (c: string) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
        Color
      </span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {HABIT_COLORS.map((c) => {
          const active = c === selected
          return (
            <button
              key={c}
              type="button"
              onClick={() => onChange(c)}
              aria-label={`Color ${c}`}
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                border: active ? `2px solid var(--text-primary)` : '2px solid transparent',
                background: c,
                cursor: 'pointer',
                padding: 0,
                transition: 'transform 100ms ease',
                transform: active ? 'scale(1.1)' : 'scale(1)',
              }}
            />
          )
        })}
      </div>
    </div>
  )
}

// ----------------------------------------------------------- IconPicker

function IconPicker({
  selected,
  color,
  onChange,
}: {
  selected: string
  color: string
  onChange: (i: string) => void
}) {
  const [search, setSearch] = useState('')
  const filtered = ICON_NAMES.filter((n) =>
    !search ? true : n.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
          Icon
        </span>
        <input
          type="search"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search icons"
          style={{
            height: 24,
            padding: '0 8px',
            borderRadius: 4,
            border: '1px solid var(--border-primary)',
            background: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            fontSize: 12,
            fontFamily: 'inherit',
            width: 140,
            outline: 'none',
          }}
        />
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(34px, 1fr))',
          gap: 4,
          maxHeight: 160,
          overflowY: 'auto',
          padding: 4,
          border: '1px solid var(--border-primary)',
          borderRadius: 6,
          background: 'var(--bg-secondary)',
        }}
      >
        {filtered.map((name) => {
          const Icon = getIcon(name)
          const active = name === selected
          return (
            <button
              key={name}
              type="button"
              title={name}
              onClick={() => onChange(name)}
              style={{
                width: 34,
                height: 34,
                borderRadius: 5,
                background: active ? tintColor(color, 0.18) : 'transparent',
                border: active ? `1px solid ${color}` : '1px solid transparent',
                color: active ? color : 'var(--text-secondary)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
              }}
            >
              <Icon size={16} />
            </button>
          )
        })}
        {filtered.length === 0 && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', padding: 8 }}>
            No icons match "{search}".
          </span>
        )}
      </div>
    </div>
  )
}
