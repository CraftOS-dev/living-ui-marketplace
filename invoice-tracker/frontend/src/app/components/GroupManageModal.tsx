import React, { useState } from 'react'
import type { TrackerGroup } from '../types'
import { CURRENCY_OPTIONS } from '../types'
import { Modal, Button, Input } from './ui'
import {
  Trash2,
  Info,
  Pencil,
  Check,
  X,
} from 'lucide-react'

interface GroupManageModalProps {
  isOpen: boolean
  onClose: () => void
  groups: TrackerGroup[]
  activeGroupId?: string | number | null
  onSelectGroup: (id: string | number) => void
  onCreateGroup: (data: {
    name: string
    description?: string
    color?: string
    icon?: string
    currency?: string
    template_type?: string
  }) => Promise<void>
  onUpdateGroup?: (id: string | number, data: {
    name?: string
    description?: string
    color?: string
    icon?: string
    currency?: string
  }) => Promise<void>
  onDeleteGroup: (id: string | number) => Promise<void>
}

const COLOR_PRESETS = [
  { name: 'Amber AWS', value: '#FF9900' },
  { name: 'Emerald AI', value: '#00A67E' },
  { name: 'Indigo Stripe', value: '#635BFF' },
  { name: 'Blue Horizon', value: '#3B82F6' },
  { name: 'Violet Cyber', value: '#8B5CF6' },
  { name: 'Rose Red', value: '#EF4444' },
]

export const GroupManageModal: React.FC<GroupManageModalProps> = ({
  isOpen,
  onClose,
  groups,
  activeGroupId,
  onSelectGroup,
  onCreateGroup,
  onUpdateGroup,
  onDeleteGroup,
}) => {
  const [activeTab, setActiveTab] = useState<'switch' | 'create'>('switch')
  
  // Create Form State
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState('#FF9900')
  const [currency, setCurrency] = useState('USD')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Edit Mode State
  const [editingGroupId, setEditingGroupId] = useState<string | number | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editColor, setEditColor] = useState('#FF9900')
  const [editCurrency, setEditCurrency] = useState('USD')
  const [isEditingSubmitting, setIsEditingSubmitting] = useState(false)

  const startEditing = (g: TrackerGroup) => {
    setEditingGroupId(g.id)
    setEditName(g.name)
    setEditDescription(g.description || '')
    setEditColor(g.color || '#FF9900')
    setEditCurrency(g.currency || 'USD')
    setError(null)
  }

  const cancelEditing = () => {
    setEditingGroupId(null)
    setEditName('')
    setEditDescription('')
    setError(null)
  }

  const handleSaveEdit = async (id: string | number) => {
    if (!editName.trim()) {
      setError('Workspace name cannot be empty.')
      return
    }
    if (!onUpdateGroup) return
    setError(null)
    setIsEditingSubmitting(true)
    try {
      await onUpdateGroup(id, {
        name: editName.trim(),
        description: editDescription.trim(),
        color: editColor,
        currency: editCurrency,
      })
      setEditingGroupId(null)
    } catch (err: any) {
      setError(err.message || 'Failed to update workspace name')
    } finally {
      setIsEditingSubmitting(false)
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Please enter a group / workspace name.')
      return
    }
    setError(null)
    setIsSubmitting(true)
    try {
      await onCreateGroup({
        name: name.trim(),
        description: description.trim(),
        color,
        currency,
      })
      setName('')
      setDescription('')
      setActiveTab('switch')
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to create group')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async (id: string | number, gName: string) => {
    if (groups.length <= 1) {
      alert('You must have at least one workspace group.')
      return
    }
    if (confirm(`Are you sure you want to delete workspace "${gName}" and all its invoices and subscriptions?`)) {
      try {
        await onDeleteGroup(id)
      } catch (err: any) {
        alert(err.message || 'Failed to delete group')
      }
    }
  }

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Manage & Edit Workspaces"
      size="md"
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {activeTab === 'create' && (
            <Button variant="primary" onClick={handleCreate} disabled={isSubmitting}>
              {isSubmitting ? 'Creating...' : 'Create Workspace'}
            </Button>
          )}
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {/* Modal Tab Switcher */}
        <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border-primary)', paddingBottom: '8px' }}>
          <button
            type="button"
            onClick={() => {
              setActiveTab('switch')
              cancelEditing()
            }}
            style={{
              padding: '6px 14px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.84rem',
              fontWeight: 600,
              cursor: 'pointer',
              border: 'none',
              backgroundColor: activeTab === 'switch' ? 'var(--color-primary)' : 'transparent',
              color: activeTab === 'switch' ? '#fff' : 'var(--text-secondary)',
            }}
          >
            All Workspaces ({groups.length})
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('create')
              cancelEditing()
            }}
            style={{
              padding: '6px 14px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.84rem',
              fontWeight: 600,
              cursor: 'pointer',
              border: 'none',
              backgroundColor: activeTab === 'create' ? 'var(--color-primary)' : 'transparent',
              color: activeTab === 'create' ? '#fff' : 'var(--text-secondary)',
            }}
          >
            + Create New Workspace
          </button>
        </div>

        {error && (
          <div
            style={{
              padding: '8px 12px',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 'var(--radius-sm)',
              color: '#ef4444',
              fontSize: '0.82rem',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Info size={14} />
            {error}
          </div>
        )}

        {activeTab === 'switch' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '420px', overflowY: 'auto' }}>
            {groups.map((g) => {
              const isActive = g.id === activeGroupId
              const isEditing = editingGroupId === g.id

              if (isEditing) {
                return (
                  <div
                    key={g.id}
                    style={{
                      padding: '12px 14px',
                      borderRadius: 'var(--radius-md)',
                      backgroundColor: 'var(--bg-secondary)',
                      border: '1px solid var(--color-primary)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.86rem', fontWeight: 700, color: 'var(--color-primary)' }}>
                      <Pencil size={14} />
                      <span>Edit Workspace Name & Details</span>
                    </div>

                    <Input
                      label="Workspace Name"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="e.g. Engineering & Cloud Stack"
                      required
                    />

                    <Input
                      label="Description (Optional)"
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      placeholder="e.g. AWS, database & compute infrastructure"
                    />

                    <div>
                      <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        Theme Color Accent
                      </label>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {COLOR_PRESETS.map((preset) => (
                          <button
                            key={preset.value}
                            type="button"
                            onClick={() => setEditColor(preset.value)}
                            title={preset.name}
                            style={{
                              width: '24px',
                              height: '24px',
                              borderRadius: '50%',
                              backgroundColor: preset.value,
                              border: editColor === preset.value ? '2px solid #fff' : '1px solid var(--border-primary)',
                              cursor: 'pointer',
                              outline: editColor === preset.value ? '2px solid var(--color-primary)' : 'none',
                            }}
                          />
                        ))}
                      </div>
                    </div>

                    <div>
                      <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        Default Currency
                      </label>
                      <select
                        value={editCurrency}
                        onChange={(e) => setEditCurrency(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '8px 12px',
                          backgroundColor: 'var(--bg-primary)',
                          color: 'var(--text-primary)',
                          border: '1px solid var(--border-primary)',
                          borderRadius: 'var(--radius-md)',
                          fontSize: '0.85rem',
                        }}
                      >
                        {CURRENCY_OPTIONS.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<X size={13} />}
                        onClick={cancelEditing}
                        disabled={isEditingSubmitting}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        icon={<Check size={13} />}
                        onClick={() => handleSaveEdit(g.id)}
                        disabled={isEditingSubmitting}
                      >
                        {isEditingSubmitting ? 'Saving...' : 'Save Changes'}
                      </Button>
                    </div>
                  </div>
                )
              }

              return (
                <div
                  key={g.id}
                  style={{
                    padding: '10px 14px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: isActive ? 'rgba(255, 79, 24, 0.08)' : 'var(--bg-secondary)',
                    border: `1px solid ${isActive ? 'var(--color-primary)' : 'var(--border-primary)'}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                  }}
                >
                  <div
                    onClick={() => {
                      onSelectGroup(g.id)
                      onClose()
                    }}
                    style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, cursor: 'pointer' }}
                  >
                    <span
                      style={{
                        width: '12px',
                        height: '12px',
                        borderRadius: '50%',
                        backgroundColor: g.color || '#FF9900',
                        display: 'inline-block',
                        flexShrink: 0,
                      }}
                    />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                        {g.name} {isActive && <span style={{ color: 'var(--color-primary)', fontSize: '0.75rem', fontWeight: 700 }}>&bull; ACTIVE</span>}
                      </div>
                      {g.description && (
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                          {g.description}
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<Pencil size={12} />}
                      onClick={(e) => {
                        e.stopPropagation()
                        startEditing(g)
                      }}
                      title="Edit workspace name and settings"
                      style={{ fontSize: '0.76rem', height: '28px', padding: '0 8px' }}
                    >
                      Edit
                    </Button>
                    <Button
                      variant={isActive ? 'primary' : 'secondary'}
                      size="sm"
                      onClick={() => {
                        onSelectGroup(g.id)
                        onClose()
                      }}
                      style={{ fontSize: '0.76rem', height: '28px', padding: '0 10px' }}
                    >
                      {isActive ? 'Current' : 'Select'}
                    </Button>
                    <button
                      type="button"
                      onClick={() => handleDelete(g.id, g.name)}
                      title="Delete workspace"
                      style={{
                        padding: '5px',
                        backgroundColor: 'transparent',
                        border: 'none',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        borderRadius: '4px',
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <Input
              label="Workspace Group Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Marketing & Creative"
              required
            />

            <Input
              label="Description (Optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Ad campaigns, design tools & video editing"
            />

            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Theme Color Accent
              </label>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {COLOR_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => setColor(preset.value)}
                    title={preset.name}
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      backgroundColor: preset.value,
                      border: color === preset.value ? '2px solid #fff' : '1px solid var(--border-primary)',
                      cursor: 'pointer',
                      outline: color === preset.value ? '2px solid var(--color-primary)' : 'none',
                    }}
                  />
                ))}
              </div>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Default Currency
              </label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-primary)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '0.85rem',
                }}
              >
                {CURRENCY_OPTIONS.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </form>
        )}
      </div>
    </Modal>
  )
}
