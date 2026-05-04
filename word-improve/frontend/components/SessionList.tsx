import { useState } from 'react'
import { Plus, MoreHorizontal, Trash2, Pencil, GitMerge, Sparkles, Check } from 'lucide-react'
import { Button } from './ui'
import { useAgentAware } from '../agent/hooks'
import type { AppController } from '../AppController'
import type { SessionSummary } from '../types'

interface SessionListProps {
  controller: AppController
  sessions: SessionSummary[]
  activeId: number | null
  llmAvailable: boolean
  onRequestRename: (id: number, currentTitle: string) => void
}

export function SessionList({
  controller,
  sessions,
  activeId,
  llmAvailable,
  onRequestRename,
}: SessionListProps) {
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null)

  useAgentAware('SessionList', {
    section: 'sidebar',
    sessionsCount: sessions.length,
    activeId,
  })

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this session? This cannot be undone.')) return
    setMenuOpenId(null)
    try {
      await controller.deleteSession(id)
    } catch {
      // controller already wrote the message into state.error which the
      // header Alert renders; nothing else to do here.
    }
  }

  const handleRename = (id: number, currentTitle: string) => {
    setMenuOpenId(null)
    onRequestRename(id, currentTitle)
  }

  return (
    <aside className="sidebar">
      <header className="sidebar__brand">
        <GitMerge size={18} aria-hidden="true" />
        <span className="sidebar__brand-text">Word Improve</span>
      </header>

      <Button
        variant="secondary"
        size="md"
        fullWidth
        icon={<Plus size={14} aria-hidden="true" />}
        onClick={() => controller.startNewSession()}
      >
        New session
      </Button>

      <div className="sidebar__list" role="navigation" aria-label="Sessions">
        {sessions.length === 0 ? (
          <div className="sidebar__empty">
            <p>No sessions yet.</p>
            <p>Click "New session" above to start.</p>
          </div>
        ) : (
          sessions.map((s) => {
            const isActive = s.id === activeId
            const statusLabel =
              s.status === 'compiled'
                ? 'compiled'
                : s.status === 'variants_ready'
                  ? `${s.variantCount} variants ready`
                  : 'draft'
            return (
              <div
                key={s.id}
                className={`session-card ${isActive ? 'session-card--active' : ''}`}
              >
                <button
                  type="button"
                  className="session-card__pick"
                  onClick={() => controller.loadSession(s.id)}
                  aria-current={isActive ? 'true' : undefined}
                  title={s.title}
                >
                  <span className="session-card__title">{s.title || `Session #${s.id}`}</span>
                  <span className="session-card__meta">
                    {s.status === 'compiled' && <Check size={11} aria-hidden="true" />}
                    {statusLabel}
                    <span className="session-card__dot">·</span>
                    <span className="session-card__mode">{s.mode.replace('_', ' ')}</span>
                  </span>
                </button>

                <button
                  type="button"
                  className="session-card__menu-btn"
                  onClick={() => setMenuOpenId(menuOpenId === s.id ? null : s.id)}
                  aria-label="Session menu"
                >
                  <MoreHorizontal size={14} aria-hidden="true" />
                </button>

                {menuOpenId === s.id && (
                  <div className="session-card__menu" role="menu">
                    <button
                      type="button"
                      onClick={() => handleRename(s.id, s.title)}
                      role="menuitem"
                    >
                      <Pencil size={12} aria-hidden="true" /> Rename
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(s.id)}
                      role="menuitem"
                      className="session-card__menu-danger"
                    >
                      <Trash2 size={12} aria-hidden="true" /> Delete
                    </button>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      <footer className="sidebar__footer">
        <span className="llm-status">
          <Sparkles size={11} aria-hidden="true" />
          {llmAvailable ? 'LLM connected' : 'No LLM (stubs)'}
        </span>
      </footer>

      <style>{`
        .sidebar {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
          height: 100%;
          padding: var(--space-2);
          background-color: var(--bg-secondary);
          border-right: 1px solid var(--border-primary);
          overflow: hidden;
        }
        .sidebar__brand {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          padding: var(--space-1);
          color: var(--color-primary);
        }
        .sidebar__brand-text {
          font-size: var(--font-size-base);
          font-weight: var(--font-weight-semibold);
          color: var(--text-primary);
        }
        .sidebar__list {
          flex: 1;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: var(--space-1);
          margin: 0 calc(var(--space-2) * -1);
          padding: 0 var(--space-2);
        }
        .sidebar__empty {
          padding: var(--space-3);
          text-align: center;
          color: var(--text-muted);
          font-size: var(--font-size-xs);
          font-style: italic;
          line-height: var(--line-height-relaxed);
        }
        .session-card {
          position: relative;
          display: flex;
          align-items: stretch;
          gap: var(--space-1);
          background-color: transparent;
          border: 1px solid transparent;
          border-radius: var(--radius-md);
          transition: var(--transition-base);
        }
        .session-card:hover {
          background-color: var(--bg-tertiary);
        }
        .session-card--active {
          background-color: var(--bg-tertiary);
          border-color: var(--border-primary);
          box-shadow: inset 3px 0 0 var(--color-primary);
        }
        .session-card__pick {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: var(--space-1) var(--space-2);
          background: transparent;
          border: none;
          color: var(--text-primary);
          text-align: left;
          font-family: var(--font-sans);
          cursor: pointer;
          min-width: 0;
          border-radius: var(--radius-md);
        }
        .session-card__title {
          font-size: var(--font-size-sm);
          font-weight: var(--font-weight-medium);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .session-card__meta {
          display: inline-flex;
          align-items: center;
          gap: var(--space-1);
          font-size: var(--font-size-xs);
          color: var(--text-secondary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .session-card--active .session-card__meta { color: var(--text-secondary); }
        .session-card__dot { opacity: 0.6; }
        .session-card__mode { text-transform: lowercase; }
        .session-card__menu-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          background: transparent;
          color: var(--text-secondary);
          border: none;
          border-top-right-radius: var(--radius-md);
          border-bottom-right-radius: var(--radius-md);
          cursor: pointer;
          opacity: 0;
          transition: var(--transition-base);
        }
        .session-card:hover .session-card__menu-btn,
        .session-card--active .session-card__menu-btn { opacity: 1; }
        .session-card__menu-btn:hover { color: var(--text-primary); }
        .session-card__menu {
          position: absolute;
          top: calc(100% + var(--space-1));
          right: 0;
          z-index: var(--z-dropdown);
          display: flex;
          flex-direction: column;
          background-color: var(--bg-secondary);
          border: 1px solid var(--border-primary);
          border-radius: var(--radius-md);
          box-shadow: var(--shadow-md);
          min-width: 140px;
          padding: var(--space-1);
        }
        .session-card__menu button {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          padding: var(--space-2);
          background: transparent;
          color: var(--text-primary);
          border: none;
          border-radius: var(--radius-sm);
          cursor: pointer;
          font-family: var(--font-sans);
          font-size: var(--font-size-xs);
          text-align: left;
        }
        .session-card__menu button:hover { background-color: var(--bg-tertiary); }
        .session-card__menu-danger { color: var(--color-error) !important; }
        .sidebar__footer {
          padding: var(--space-2) 0 0;
          border-top: 1px solid var(--border-primary);
          display: flex;
          justify-content: center;
        }
        .llm-status {
          display: inline-flex;
          align-items: center;
          gap: var(--space-1);
          font-size: var(--font-size-xs);
          color: var(--text-muted);
        }
      `}</style>
    </aside>
  )
}
