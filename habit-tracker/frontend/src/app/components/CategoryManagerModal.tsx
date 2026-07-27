import { useState } from 'react'
import { toast } from 'react-toastify'
import { Plus, Trash2, Check, X, Pencil } from 'lucide-react'
import { Modal, Button } from './ui'
import type { Category } from '../types'
import type { AppController } from '../AppController'
import { HABIT_COLORS } from '../lib/icons'

interface CategoryManagerModalProps {
  open: boolean
  onClose: () => void
  categories: Category[]
  controller: AppController
}

export function CategoryManagerModal({
  open,
  onClose,
  categories,
  controller,
}: CategoryManagerModalProps) {
  const [name, setName] = useState('')
  const [color, setColor] = useState(HABIT_COLORS[6])
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')
  const [busy, setBusy] = useState(false)

  const create = async () => {
    if (!name.trim()) return
    setBusy(true)
    try {
      await controller.createCategory({ name: name.trim(), color })
      setName('')
      toast.success('Category created')
    } catch (err: any) {
      toast.error(err?.message || 'Failed to create category')
    } finally {
      setBusy(false)
    }
  }

  const startEdit = (c: Category) => {
    setEditingId(c.id)
    setEditName(c.name)
    setEditColor(c.color)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditName('')
    setEditColor('')
  }

  const saveEdit = async (id: number) => {
    if (!editName.trim()) return
    setBusy(true)
    try {
      await controller.updateCategory(id, { name: editName.trim(), color: editColor })
      cancelEdit()
      toast.success('Category updated')
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update category')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (c: Category) => {
    if (!confirm(`Delete category "${c.name}"? Habits in it will become uncategorized.`))
      return
    setBusy(true)
    try {
      await controller.deleteCategory(c.id)
      toast.success('Category deleted')
    } catch (err: any) {
      toast.error(err?.message || 'Failed to delete category')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Categories"
      size="md"
      footer={
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Done
        </Button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* New-category form */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SectionLabel>New category</SectionLabel>

          <FormRow label="Name">
            <input
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') create()
              }}
              placeholder="Health, Mindfulness, Work…"
              style={fieldStyle}
            />
          </FormRow>

          <FormRow label="Color">
            <ColorPalette value={color} onChange={setColor} />
          </FormRow>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              size="sm"
              icon={<Plus size={13} />}
              onClick={create}
              disabled={busy || !name.trim()}
            >
              Add category
            </Button>
          </div>
        </section>

        <hr
          style={{
            border: 'none',
            height: 1,
            background: 'var(--border-primary)',
            margin: 0,
          }}
        />

        {/* Existing categories list */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <SectionLabel>
            {categories.length === 0 ? 'No categories yet' : `${categories.length} categor${categories.length === 1 ? 'y' : 'ies'}`}
          </SectionLabel>

          {categories.length === 0 ? (
            <p
              style={{
                margin: 0,
                fontSize: 12,
                color: 'var(--text-muted)',
                lineHeight: 1.5,
              }}
            >
              Group your habits to filter the list quickly. Pick a category color
              to give the chip in the top bar a distinctive look.
            </p>
          ) : (
            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                maxHeight: 320,
                overflowY: 'auto',
              }}
            >
              {categories.map((c) =>
                editingId === c.id ? (
                  <li
                    key={c.id}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      padding: '6px 0',
                    }}
                  >
                    <FormRow label="Name">
                      <input
                        autoFocus
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveEdit(c.id)
                          if (e.key === 'Escape') cancelEdit()
                        }}
                        style={fieldStyle}
                      />
                    </FormRow>
                    <FormRow label="Color">
                      <ColorPalette value={editColor} onChange={setEditColor} />
                    </FormRow>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                      <Button size="sm" variant="ghost" onClick={cancelEdit} icon={<X size={12} />}>
                        Cancel
                      </Button>
                      <Button size="sm" onClick={() => saveEdit(c.id)} icon={<Check size={12} />}>
                        Save
                      </Button>
                    </div>
                  </li>
                ) : (
                  <li key={c.id}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 10px',
                        borderRadius: 6,
                        border: '1px solid transparent',
                      }}
                    >
                      <span
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: '50%',
                          background: c.color,
                          flexShrink: 0,
                        }}
                      />
                      <span
                        style={{
                          flex: 1,
                          fontSize: 13,
                          color: 'var(--text-primary)',
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {c.name}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Pencil size={12} />}
                        onClick={() => startEdit(c)}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Trash2 size={12} />}
                        onClick={() => remove(c)}
                      >
                        Delete
                      </Button>
                    </div>
                  </li>
                )
              )}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  )
}

// --------------------------------------------------------- helpers

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 10,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--text-muted)',
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  )
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: 'var(--text-secondary)',
        }}
      >
        {label}
      </span>
      {children}
    </div>
  )
}

const fieldStyle: React.CSSProperties = {
  width: '100%',
  height: 32,
  padding: '0 10px',
  borderRadius: 4,
  border: '1px solid var(--border-primary)',
  background: 'var(--bg-primary)',
  color: 'var(--text-primary)',
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
}

function ColorPalette({
  value,
  onChange,
}: {
  value: string
  onChange: (c: string) => void
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
      }}
    >
      {HABIT_COLORS.map((c) => {
        const active = c === value
        return (
          <button
            key={c}
            type="button"
            aria-label={`Color ${c}`}
            onClick={() => onChange(c)}
            style={{
              width: 18,
              height: 18,
              borderRadius: '50%',
              border: active ? '2px solid var(--text-primary)' : '2px solid transparent',
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
  )
}
