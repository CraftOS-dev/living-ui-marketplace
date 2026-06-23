import { useState } from 'react'
import { Settings, Sparkles } from 'lucide-react'
import { Badge, EmptyState } from './ui'
import { EmailCard } from './EmailCard'
import { InsightCard } from './InsightCard'
import { ColumnSettingsModal } from './ColumnSettingsModal'
import type { Column, Email, InsightSummary } from '../types'

interface EmailColumnProps {
  column: Column
  emails: Email[]
  insight: InsightSummary | null
  loadingEmails: boolean
  loadingInsights: boolean
  onUpdateColumn: (id: number, updates: Partial<Pick<Column, 'title' | 'query' | 'icon' | 'aiInstructions' | 'aiEnabled'>>) => Promise<void>
  onToggleInsights: (columnId: number, enabled: boolean) => void
  onGenerateInsights: (columnId: number) => void
}

export function EmailColumn({
  column,
  emails,
  insight,
  loadingEmails,
  loadingInsights,
  onUpdateColumn,
  onToggleInsights,
  onGenerateInsights,
}: EmailColumnProps) {
  const [settingsOpen, setSettingsOpen] = useState(false)

  const handleSave = async (updates: Parameters<typeof onUpdateColumn>[1]) => {
    await onUpdateColumn(column.id, updates)
  }

  const handleAiToggle = () => {
    const next = !column.aiEnabled
    onToggleInsights(column.id, next)
    if (next) {
      onGenerateInsights(column.id)
    }
  }

  return (
    <div className="email-column">
      {/* Column header */}
      <div className="ec-header">
        <div className="ec-title-row">
          <span className="ec-icon" aria-hidden="true">{column.icon}</span>
          <h3 className="ec-title">{column.title}</h3>
          {column.unreadCount > 0 && (
            <Badge variant="info" size="sm">{column.unreadCount}</Badge>
          )}
        </div>
        <div className="ec-actions">
          <button
            type="button"
            className={`ec-action-btn${column.aiEnabled ? ' ec-action-btn--active' : ''}`}
            onClick={handleAiToggle}
            title={column.aiEnabled ? 'Disable AI Insights' : 'Enable AI Insights'}
            aria-pressed={column.aiEnabled}
          >
            <Sparkles size={14} />
          </button>
          {!column.isGeneral && (
            <button
              type="button"
              className="ec-action-btn"
              onClick={() => setSettingsOpen(true)}
              title="Column settings"
            >
              <Settings size={14} />
            </button>
          )}
        </div>
      </div>

      {/* AI Insights */}
      {column.aiEnabled && (
        <div className="ec-insight-wrap">
          <InsightCard insight={insight} loading={loadingInsights} />
        </div>
      )}

      {/* Email list */}
      <div className="ec-list">
        {loadingEmails ? (
          <div className="ec-loading">
            <span className="ec-spinner" aria-label="Loading" />
            <span>Loading emails…</span>
          </div>
        ) : emails.length === 0 ? (
          <EmptyState
            title="No emails"
            message={`No emails match "${column.query || 'this query'}"`}
          />
        ) : (
          emails.map((email) => (
            <EmailCard key={email.id} email={email} />
          ))
        )}
      </div>

      {/* Settings modal */}
      {settingsOpen && (
        <ColumnSettingsModal
          column={column}
          onSave={handleSave}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      <style>{`
        .email-column {
          display: flex;
          flex-direction: column;
          width: 280px;
          min-width: 260px;
          max-width: 320px;
          flex-shrink: 0;
          background: var(--bg-secondary);
          border-radius: var(--radius-lg);
          border: 1px solid var(--border-primary);
          overflow: hidden;
          height: 100%;
        }

        .ec-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: var(--space-3) var(--space-4);
          border-bottom: 1px solid var(--border-primary);
          background: var(--bg-tertiary);
          gap: var(--space-2);
        }

        .ec-title-row {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          min-width: 0;
        }

        .ec-icon {
          font-size: 16px;
          flex-shrink: 0;
        }

        .ec-title {
          font-size: var(--font-size-sm);
          font-weight: var(--font-weight-semibold);
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .ec-actions {
          display: flex;
          align-items: center;
          gap: var(--space-1);
          flex-shrink: 0;
        }

        .ec-action-btn {
          width: 28px;
          height: 28px;
          border-radius: var(--radius-md);
          border: none;
          background: transparent;
          color: var(--text-muted);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background var(--transition-base), color var(--transition-base);
        }

        .ec-action-btn:hover {
          background: var(--bg-primary);
          color: var(--text-primary);
        }

        .ec-action-btn--active {
          color: var(--color-accent);
        }

        .ec-action-btn--active:hover {
          color: var(--color-accent);
        }

        .ec-list {
          flex: 1;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
          padding: var(--space-3);
        }

        .ec-loading {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          color: var(--text-muted);
          font-size: var(--font-size-sm);
          padding: var(--space-4) 0;
          justify-content: center;
        }

        .ec-spinner {
          width: 16px;
          height: 16px;
          border: 2px solid var(--border-primary);
          border-top-color: var(--color-accent);
          border-radius: var(--radius-full);
          animation: spin 0.8s linear infinite;
          display: inline-block;
        }

        .ec-insight-wrap {
          padding: var(--space-3) var(--space-3) 0;
          flex-shrink: 0;
        }
      `}</style>
    </div>
  )
}
