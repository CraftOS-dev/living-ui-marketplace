import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { SheetSummary } from '../types'

interface SheetTabsProps {
  sheets: SheetSummary[]
  activeId: number | null
  onSelect: (id: number) => void
  onAdd: () => void
  onRename: (id: number, name: string) => void
  onDelete: (id: number) => void
}

/** Excel-style tab strip along the bottom: switch / add / rename / delete sheets. */
export function SheetTabs({ sheets, activeId, onSelect, onAdd, onRename, onDelete }: SheetTabsProps) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState('')

  const startRename = (s: SheetSummary) => {
    setDraft(s.name)
    setEditingId(s.id)
  }

  const commitRename = (id: number) => {
    const trimmed = draft.trim()
    if (trimmed) onRename(id, trimmed)
    setEditingId(null)
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: 2,
        padding: '0 var(--space-2)',
        borderTop: '1px solid var(--border-primary)',
        backgroundColor: 'var(--bg-secondary)',
        overflowX: 'auto',
        minHeight: 36,
      }}
    >
      {sheets.map((s) => {
        const active = s.id === activeId
        return (
          <div
            key={s.id}
            onMouseDown={() => !editingId && onSelect(s.id)}
            onDoubleClick={() => startRename(s)}
            title="Double-click to rename"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-1)',
              padding: '0 var(--space-2)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              borderTop: active ? '2px solid var(--color-primary)' : '2px solid transparent',
              backgroundColor: active ? 'var(--bg-primary)' : 'transparent',
              color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontSize: 'var(--font-size-sm)',
              fontWeight: active
                ? ('var(--font-weight-semibold)' as any)
                : ('var(--font-weight-normal)' as any),
            }}
          >
            {editingId === s.id ? (
              <input
                value={draft}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => commitRename(s.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename(s.id)
                  if (e.key === 'Escape') setEditingId(null)
                }}
                style={{
                  width: 96,
                  height: 24,
                  border: '1px solid var(--color-primary)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '0 4px',
                  fontSize: 'var(--font-size-sm)',
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  outline: 'none',
                }}
              />
            ) : (
              <>
                <span>{s.name}</span>
                <button
                  title="Delete sheet"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(s.id)
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--text-muted)',
                    padding: 2,
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  <X size={12} />
                </button>
              </>
            )}
          </div>
        )
      })}

      <button
        title="Add sheet"
        onClick={onAdd}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '0 var(--space-2)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--color-primary)',
          fontSize: 'var(--font-size-sm)',
          fontWeight: 'var(--font-weight-medium)' as any,
        }}
      >
        <Plus size={14} /> Sheet
      </button>
    </div>
  )
}
