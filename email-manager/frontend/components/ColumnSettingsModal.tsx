import { useState } from 'react'
import { Modal, Button, Input, Textarea, Toggle } from './ui'
import type { Column } from '../types'

interface ColumnSettingsModalProps {
  column: Column
  onSave: (updates: Partial<Pick<Column, 'title' | 'query' | 'icon' | 'aiInstructions' | 'aiEnabled'>>) => Promise<void>
  onClose: () => void
}

const ICON_OPTIONS = ['📧', '🐙', '💼', '🎓', '💳', '🔔', '👥', '📰', '⭐', '🚀', '📁', '🏠', '💬', '🛒', '🎯']

export function ColumnSettingsModal({ column, onSave, onClose }: ColumnSettingsModalProps) {
  const [title, setTitle] = useState(column.title)
  const [query, setQuery] = useState(column.query)
  const [icon, setIcon] = useState(column.icon)
  const [aiInstructions, setAiInstructions] = useState(column.aiInstructions)
  const [aiEnabled, setAiEnabled] = useState(column.aiEnabled)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = async () => {
    if (!title.trim()) {
      setError('Title is required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave({ title: title.trim(), query, icon, aiInstructions, aiEnabled })
      onClose()
    } catch {
      setError('Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit "${column.title}"`}
      size="md"
    >
      <div className="csm-body">
        <div className="csm-field">
          <label className="csm-label">Column Title</label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. GitHub"
          />
        </div>

        {!column.isGeneral && (
          <div className="csm-field">
            <label className="csm-label">Gmail Search Query</label>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. from:notifications@github.com"
              className="csm-mono"
            />
            <p className="csm-hint">
              Supports all Gmail search operators:{' '}
              <code>from:</code>, <code>to:</code>, <code>subject:</code>,{' '}
              <code>label:</code>, <code>is:unread</code>, <code>newer_than:7d</code>, etc.
            </p>
          </div>
        )}

        <div className="csm-field">
          <label className="csm-label">Icon</label>
          <div className="csm-icon-grid">
            {ICON_OPTIONS.map((opt) => (
              <button
                key={opt}
                type="button"
                className={`csm-icon-btn${icon === opt ? ' csm-icon-btn--active' : ''}`}
                onClick={() => setIcon(opt)}
                title={opt}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>

        <div className="csm-field">
          <div className="csm-toggle-row">
            <label className="csm-label csm-label--inline">AI Insights</label>
            <Toggle
              checked={aiEnabled}
              onChange={(checked) => setAiEnabled(checked)}
            />
          </div>
          <p className="csm-hint">
            When enabled, CraftBot generates a summary at the top of this column.
          </p>
        </div>

        {aiEnabled && (
          <div className="csm-field">
            <label className="csm-label">AI Instructions</label>
            <Textarea
              value={aiInstructions}
              onChange={(e) => setAiInstructions(e.target.value)}
              placeholder="e.g. Only notify me if I am directly mentioned or requested as a reviewer."
              rows={3}
            />
          </div>
        )}

        {error && <p className="csm-error">{error}</p>}

        <div className="csm-actions">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </div>

      <style>{`
        .csm-body {
          display: flex;
          flex-direction: column;
          gap: var(--space-4);
          padding: var(--space-2) 0;
        }

        .csm-field {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
        }

        .csm-label {
          font-size: var(--font-size-sm);
          font-weight: var(--font-weight-medium);
          color: var(--text-secondary);
        }

        .csm-label--inline {
          margin-bottom: 0;
        }

        .csm-toggle-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .csm-hint {
          font-size: var(--font-size-xs);
          color: var(--text-muted);
          line-height: var(--line-height-relaxed);
        }

        .csm-hint code {
          font-family: var(--font-mono);
          background: var(--bg-tertiary);
          padding: 1px 4px;
          border-radius: var(--radius-sm);
          color: var(--color-accent);
        }

        .csm-mono input {
          font-family: var(--font-mono);
          font-size: var(--font-size-sm);
        }

        .csm-icon-grid {
          display: flex;
          flex-wrap: wrap;
          gap: var(--space-2);
        }

        .csm-icon-btn {
          width: 36px;
          height: 36px;
          font-size: 18px;
          border-radius: var(--radius-md);
          border: 2px solid var(--border-primary);
          background: var(--bg-secondary);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: border-color var(--transition-base), background var(--transition-base);
        }

        .csm-icon-btn:hover {
          border-color: var(--color-accent);
          background: var(--bg-tertiary);
        }

        .csm-icon-btn--active {
          border-color: var(--color-accent);
          background: var(--color-accent-light);
        }

        .csm-error {
          font-size: var(--font-size-sm);
          color: var(--color-error);
        }

        .csm-actions {
          display: flex;
          justify-content: flex-end;
          gap: var(--space-3);
          padding-top: var(--space-2);
          border-top: 1px solid var(--border-primary);
        }
      `}</style>
    </Modal>
  )
}
