import { useState } from 'react'
import { Plus, Trash2, Edit2, Check, X } from 'lucide-react'
import { Button, Input, Modal } from './ui'
import type { BrainstormSession } from '../types'

interface Props {
  sessions: BrainstormSession[]
  activeSessionId: number | null
  onSelect: (id: number) => void
  onCreate: (title: string, topic: string) => void
  onRename: (id: number, title: string) => void
  onDelete: (id: number) => void
}

export function SessionSidebar({ sessions, activeSessionId, onSelect, onCreate, onRename, onDelete }: Props) {
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newTopic, setNewTopic] = useState('')
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')

  function submitCreate() {
    if (!newTitle.trim() || !newTopic.trim()) return
    onCreate(newTitle.trim(), newTopic.trim())
    setNewTitle('')
    setNewTopic('')
    setCreating(false)
  }

  function startRename(s: BrainstormSession) {
    setRenamingId(s.id)
    setRenameValue(s.title)
  }

  function submitRename(id: number) {
    if (renameValue.trim()) onRename(id, renameValue.trim())
    setRenamingId(null)
  }

  return (
    <aside className="session-sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">Sessions</span>
        <button className="icon-btn" onClick={() => setCreating(true)} title="New session">
          <Plus size={16} />
        </button>
      </div>

      <div className="session-list">
        {sessions.length === 0 && (
          <p className="empty-hint">No sessions yet. Create one to start.</p>
        )}
        {sessions.map(s => (
          <div
            key={s.id}
            className={`session-item ${s.id === activeSessionId ? 'active' : ''}`}
            onClick={() => onSelect(s.id)}
          >
            {renamingId === s.id ? (
              <div className="rename-row" onClick={e => e.stopPropagation()}>
                <input
                  className="rename-input"
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') submitRename(s.id); if (e.key === 'Escape') setRenamingId(null) }}
                  autoFocus
                />
                <button className="icon-btn sm" onClick={() => submitRename(s.id)}><Check size={12} /></button>
                <button className="icon-btn sm" onClick={() => setRenamingId(null)}><X size={12} /></button>
              </div>
            ) : (
              <>
                <div className="session-info">
                  <span className="session-name">{s.title}</span>
                  <span className="session-topic">{s.topic}</span>
                </div>
                <div className="session-actions" onClick={e => e.stopPropagation()}>
                  <button className="icon-btn sm" onClick={() => startRename(s)} title="Rename"><Edit2 size={12} /></button>
                  <button className="icon-btn sm danger" onClick={() => onDelete(s.id)} title="Delete"><Trash2 size={12} /></button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="New Brainstorm Session" size="sm"
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
            <Button onClick={submitCreate} disabled={!newTitle.trim() || !newTopic.trim()}>Create</Button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Input
            label="Session title"
            placeholder="e.g. AI Research"
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') submitCreate() }}
          />
          <Input
            label="Topic to explore"
            placeholder="e.g. Artificial Intelligence"
            value={newTopic}
            onChange={e => setNewTopic(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') submitCreate() }}
          />
        </div>
      </Modal>

      <style>{`
        .session-sidebar {
          width: 220px;
          min-width: 220px;
          background: var(--bg-secondary);
          border-right: 1px solid var(--border-color, rgba(255,255,255,0.08));
          display: flex;
          flex-direction: column;
          height: 100%;
          overflow: hidden;
        }
        .sidebar-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 12px 10px;
          border-bottom: 1px solid var(--border-color, rgba(255,255,255,0.08));
        }
        .sidebar-title { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary); }
        .session-list { flex: 1; overflow-y: auto; padding: 8px 0; }
        .empty-hint { font-size: 12px; color: var(--text-muted); padding: 12px; text-align: center; }
        .session-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          cursor: pointer;
          border-radius: 0;
          gap: 4px;
          transition: background 0.15s;
        }
        .session-item:hover { background: var(--bg-tertiary); }
        .session-item.active { background: color-mix(in srgb, var(--color-primary) 12%, transparent); border-left: 2px solid var(--color-primary); }
        .session-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
        .session-name { font-size: 13px; font-weight: 500; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .session-topic { font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .session-actions { display: flex; gap: 2px; opacity: 0; transition: opacity 0.15s; }
        .session-item:hover .session-actions { opacity: 1; }
        .rename-row { display: flex; align-items: center; gap: 4px; width: 100%; }
        .rename-input {
          flex: 1; background: var(--bg-primary); border: 1px solid var(--color-primary);
          border-radius: var(--radius-sm); padding: 2px 6px; font-size: 12px;
          color: var(--text-primary); outline: none; min-width: 0;
        }
        .icon-btn {
          display: flex; align-items: center; justify-content: center;
          background: transparent; border: none; cursor: pointer; padding: 4px;
          border-radius: var(--radius-sm); color: var(--text-secondary);
          transition: color 0.15s, background 0.15s;
        }
        .icon-btn:hover { color: var(--text-primary); background: var(--bg-tertiary); }
        .icon-btn.sm { padding: 2px; }
        .icon-btn.danger:hover { color: var(--color-error); }
        @media (max-width: 768px) {
          .session-sidebar { width: 100%; min-width: unset; height: auto; border-right: none; border-bottom: 1px solid var(--border-color, rgba(255,255,255,0.08)); }
          .session-list { max-height: 160px; }
        }
      `}</style>
    </aside>
  )
}
