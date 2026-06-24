import { useState, useEffect } from 'react'
import type { AppController } from '../AppController'
import type { WidgetConfig, DashboardView, Note } from '../types'
import { FileText, Pin } from 'lucide-react'
import { EmptyState } from './ui'

interface NotesWidgetProps {
  controller: AppController
  config: WidgetConfig
  navigate: (view: DashboardView) => void
}

export function NotesWidget({ controller, navigate }: NotesWidgetProps) {
  const [note, setNote] = useState<Note | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    controller.getNotes()
      .then(notes => setNote(notes[0] ?? null))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [controller])

  if (loading) return <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>Loading…</div>

  if (!note) {
    return (
      <EmptyState
        icon={<FileText size={24} />}
        message="No notes yet"
        action={
          <button
            onClick={() => navigate('notes')}
            style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Create note
          </button>
        }
      />
    )
  }

  const preview = note.content ? note.content.slice(0, 120) + (note.content.length > 120 ? '…' : '') : '(empty)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', marginBottom: 'var(--space-2)' }}>
          {note.pinned && <Pin size={12} style={{ color: 'var(--color-primary)' }} />}
          <span style={{
            fontWeight: 'var(--font-weight-semibold)' as any,
            fontSize: 'var(--font-size-sm)',
            color: 'var(--text-primary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {note.title}
          </span>
        </div>
        <div style={{
          fontSize: 'var(--font-size-sm)',
          color: 'var(--text-secondary)',
          lineHeight: 'var(--line-height-relaxed)',
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        } as any}>
          {preview}
        </div>
      </div>
      <button
        onClick={() => navigate('notes')}
        style={{
          marginTop: 'auto',
          padding: 'var(--space-2) 0 0 0',
          fontSize: 'var(--font-size-xs)',
          color: 'var(--color-primary)',
          background: 'none', border: 'none', cursor: 'pointer',
        }}
      >
        Open notes →
      </button>
    </div>
  )
}
