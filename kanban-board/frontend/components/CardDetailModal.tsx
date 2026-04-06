import { useState } from 'react'
import type { AppController } from '../AppController'
import type { Card, Label, Priority, ChecklistItem } from '../types'
import { Modal, Button } from './ui'
import { toast } from 'react-toastify'

const PRIORITY_OPTIONS: { value: Priority; label: string; color: string }[] = [
  { value: 'none', label: 'None', color: 'var(--text-secondary)' },
  { value: 'low', label: 'Low', color: '#22C55E' },
  { value: 'medium', label: 'Medium', color: '#EAB308' },
  { value: 'high', label: 'High', color: '#FF4F18' },
  { value: 'urgent', label: 'Urgent', color: '#EF4444' },
]

interface CardDetailModalProps {
  controller: AppController
  card: Card
  boardLabels: Label[]
  onClose: () => void
  onUpdate: () => void
}

export function CardDetailModal({ controller, card, boardLabels, onClose, onUpdate }: CardDetailModalProps) {
  const [title, setTitle] = useState(card.title)
  const [description, setDescription] = useState(card.description || '')
  const [priority, setPriority] = useState<Priority>(card.priority)
  const [dueDate, setDueDate] = useState(card.dueDate ? card.dueDate.split('T')[0] : '')
  const [saving, setSaving] = useState(false)
  const [newChecklistText, setNewChecklistText] = useState('')
  const [showLabelPicker, setShowLabelPicker] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const cardLabelIds = new Set(card.labels.map(l => l.id))

  const handleSave = async () => {
    if (!title.trim()) { toast.error('Title is required'); return }
    setSaving(true)
    try {
      await controller.updateCard(card.id, {
        title: title.trim(),
        description: description || null,
        priority,
        due_date: dueDate ? new Date(dueDate).toISOString() : '',
      })
      toast.success('Card updated')
      onUpdate()
    } catch {
      toast.error('Failed to update card')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    try {
      await controller.deleteCard(card.id)
      toast.success('Card deleted')
      onClose()
      onUpdate()
    } catch {
      toast.error('Failed to delete card')
    }
  }

  const handleArchive = async () => {
    try {
      await controller.updateCard(card.id, { archived: !card.archived })
      toast.success(card.archived ? 'Card restored' : 'Card archived')
      onClose()
      onUpdate()
    } catch {
      toast.error('Failed to archive card')
    }
  }

  const toggleLabel = async (labelId: number) => {
    try {
      if (cardLabelIds.has(labelId)) {
        await controller.removeLabel(card.id, labelId)
      } else {
        await controller.assignLabel(card.id, labelId)
      }
      onUpdate()
    } catch {
      toast.error('Failed to update labels')
    }
  }

  const handleAddChecklist = async () => {
    if (!newChecklistText.trim()) return
    try {
      await controller.createChecklistItem(card.id, newChecklistText.trim())
      setNewChecklistText('')
      onUpdate()
    } catch {
      toast.error('Failed to add checklist item')
    }
  }

  const handleToggleChecklist = async (item: ChecklistItem) => {
    try {
      await controller.updateChecklistItem(item.id, { completed: !item.completed })
      onUpdate()
    } catch {
      toast.error('Failed to update checklist')
    }
  }

  const handleDeleteChecklist = async (itemId: number) => {
    try {
      await controller.deleteChecklistItem(itemId)
      onUpdate()
    } catch {
      toast.error('Failed to delete checklist item')
    }
  }

  const checklistProgress = card.checklistTotal > 0
    ? Math.round((card.checklistCompleted / card.checklistTotal) * 100)
    : 0

  return (
    <Modal open={true} onClose={onClose} title="Card Details" size="lg">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {/* Title */}
        <div>
          <label style={{ display: 'block', fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginBottom: 'var(--space-1)', fontWeight: 600 }}>Title</label>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            style={{
              width: '100%', background: 'var(--bg-primary)', border: '1px solid var(--border-primary)',
              borderRadius: 'var(--radius-md)', padding: 'var(--space-2) var(--space-3)',
              color: 'var(--text-primary)', fontSize: 'var(--font-size-base)', fontWeight: 600,
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Description */}
        <div>
          <label style={{ display: 'block', fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginBottom: 'var(--space-1)', fontWeight: 600 }}>Description</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={4}
            placeholder="Add a more detailed description..."
            style={{
              width: '100%', background: 'var(--bg-primary)', border: '1px solid var(--border-primary)',
              borderRadius: 'var(--radius-md)', padding: 'var(--space-2) var(--space-3)',
              color: 'var(--text-primary)', fontSize: 'var(--font-size-sm)', resize: 'vertical',
              fontFamily: 'inherit', boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Priority & Due Date row */}
        <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label style={{ display: 'block', fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginBottom: 'var(--space-1)', fontWeight: 600 }}>Priority</label>
            <div style={{ display: 'flex', gap: 'var(--space-1)', flexWrap: 'wrap' }}>
              {PRIORITY_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setPriority(opt.value)}
                  style={{
                    padding: '4px 10px', borderRadius: 'var(--radius-sm)',
                    border: priority === opt.value ? `2px solid ${opt.color}` : '1px solid var(--border-primary)',
                    background: priority === opt.value ? `${opt.color}22` : 'var(--bg-primary)',
                    color: priority === opt.value ? opt.color : 'var(--text-secondary)',
                    cursor: 'pointer', fontSize: 'var(--font-size-xs)', fontWeight: 500,
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ minWidth: 160 }}>
            <label style={{ display: 'block', fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginBottom: 'var(--space-1)', fontWeight: 600 }}>Due Date</label>
            <input
              type="date"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
              style={{
                background: 'var(--bg-primary)', border: '1px solid var(--border-primary)',
                borderRadius: 'var(--radius-md)', padding: 'var(--space-1) var(--space-2)',
                color: 'var(--text-primary)', fontSize: 'var(--font-size-sm)',
              }}
            />
            {dueDate && (
              <button onClick={() => setDueDate('')} style={{
                marginLeft: 'var(--space-1)', background: 'none', border: 'none',
                color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 11,
              }}>Clear</button>
            )}
          </div>
        </div>

        {/* Labels */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
            <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', fontWeight: 600 }}>Labels</label>
            <Button variant="ghost" size="sm" onClick={() => setShowLabelPicker(!showLabelPicker)}>
              {showLabelPicker ? 'Done' : 'Edit'}
            </Button>
          </div>
          {showLabelPicker ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              {boardLabels.length === 0 && (
                <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-xs)' }}>
                  No labels. Create labels from the sidebar.
                </span>
              )}
              {boardLabels.map(label => (
                <button
                  key={label.id}
                  onClick={() => toggleLabel(label.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                    padding: 'var(--space-1) var(--space-2)', borderRadius: 'var(--radius-sm)',
                    border: cardLabelIds.has(label.id) ? '2px solid var(--color-primary)' : '1px solid var(--border-primary)',
                    background: 'var(--bg-primary)', cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <span style={{ width: 16, height: 16, borderRadius: 3, background: label.color, flexShrink: 0 }} />
                  <span style={{ color: 'var(--text-primary)', fontSize: 'var(--font-size-sm)', flex: 1 }}>{label.name}</span>
                  {cardLabelIds.has(label.id) && <span style={{ color: 'var(--color-primary)', fontWeight: 700 }}>&#10003;</span>}
                </button>
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 'var(--space-1)', flexWrap: 'wrap' }}>
              {card.labels.length === 0 && (
                <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-xs)' }}>No labels</span>
              )}
              {card.labels.map(label => (
                <span key={label.id} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '2px 8px', borderRadius: 'var(--radius-sm)',
                  background: `${label.color}33`, color: label.color,
                  fontSize: 'var(--font-size-xs)', fontWeight: 600,
                }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: label.color }} />
                  {label.name}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Checklist */}
        <div>
          <label style={{ display: 'block', fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginBottom: 'var(--space-2)', fontWeight: 600 }}>
            Checklist {card.checklistTotal > 0 && `(${card.checklistCompleted}/${card.checklistTotal})`}
          </label>
          {card.checklistTotal > 0 && (
            <div style={{
              height: 6, background: 'var(--bg-tertiary)', borderRadius: 3,
              marginBottom: 'var(--space-2)', overflow: 'hidden',
            }}>
              <div style={{
                height: '100%', width: `${checklistProgress}%`,
                background: checklistProgress === 100 ? '#22C55E' : 'var(--color-primary)',
                borderRadius: 3, transition: 'width 0.3s ease',
              }} />
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {card.checklistItems.map(item => (
              <div key={item.id} style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                padding: 'var(--space-1)', borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-primary)',
              }}>
                <input
                  type="checkbox"
                  checked={item.completed}
                  onChange={() => handleToggleChecklist(item)}
                  style={{ cursor: 'pointer', width: 16, height: 16, accentColor: 'var(--color-primary)' }}
                />
                <span style={{
                  flex: 1, fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)',
                  textDecoration: item.completed ? 'line-through' : 'none',
                  opacity: item.completed ? 0.6 : 1,
                }}>
                  {item.text}
                </span>
                <button onClick={() => handleDeleteChecklist(item.id)} style={{
                  background: 'none', border: 'none', color: 'var(--text-secondary)',
                  cursor: 'pointer', fontSize: 14, padding: '0 4px', opacity: 0.5,
                }}
                  onMouseOver={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = 'var(--color-error)' }}
                  onMouseOut={e => { e.currentTarget.style.opacity = '0.5'; e.currentTarget.style.color = 'var(--text-secondary)' }}
                >&#10005;</button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
            <input
              value={newChecklistText}
              onChange={e => setNewChecklistText(e.target.value)}
              placeholder="Add checklist item..."
              onKeyDown={e => { if (e.key === 'Enter') handleAddChecklist() }}
              style={{
                flex: 1, background: 'var(--bg-primary)', border: '1px solid var(--border-primary)',
                borderRadius: 'var(--radius-md)', padding: 'var(--space-1) var(--space-2)',
                color: 'var(--text-primary)', fontSize: 'var(--font-size-sm)',
              }}
            />
            <Button variant="secondary" size="sm" onClick={handleAddChecklist}>Add</Button>
          </div>
        </div>

        {/* Actions */}
        <div style={{
          display: 'flex', gap: 'var(--space-2)', justifyContent: 'space-between',
          paddingTop: 'var(--space-3)', borderTop: '1px solid var(--border-primary)',
          flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <Button variant="ghost" size="sm" onClick={handleArchive}>
              {card.archived ? 'Restore' : 'Archive'}
            </Button>
            {confirmDelete ? (
              <div style={{ display: 'flex', gap: 'var(--space-1)', alignItems: 'center' }}>
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-error)' }}>Sure?</span>
                <Button variant="danger" size="sm" onClick={handleDelete}>Yes, Delete</Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>No</Button>
              </div>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>Delete</Button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleSave} loading={saving}>Save</Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
