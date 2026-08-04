import { useEffect, useRef } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from './ui'

interface RowMenuProps {
  index: number
  anchor: { x: number; y: number }
  canDelete: boolean
  onInsertAbove: (index: number) => void
  onInsertBelow: (index: number) => void
  onDelete: (index: number) => void
  onClose: () => void
}

/** Popover for a single row number: insert above/below, delete. */
export function RowMenu({ index, anchor, canDelete, onInsertAbove, onInsertBelow, onDelete, onClose }: RowMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', esc)
    }
  }, [onClose])

  // Keep the popover within the viewport horizontally.
  const left = Math.min(anchor.x, window.innerWidth - 200)

  return (
    <div
      ref={ref}
      role="dialog"
      style={{
        position: 'fixed',
        top: anchor.y,
        left: Math.max(8, left),
        zIndex: 'var(--z-dropdown)' as any,
        width: 184,
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
        padding: 'var(--space-3)',
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border-primary)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      <Button
        variant="secondary"
        size="sm"
        fullWidth
        onClick={() => { onInsertAbove(index); onClose() }}
      >
        Insert above
      </Button>
      <Button
        variant="secondary"
        size="sm"
        fullWidth
        onClick={() => { onInsertBelow(index); onClose() }}
      >
        Insert below
      </Button>
      <Button
        variant="danger"
        size="sm"
        fullWidth
        icon={<Trash2 size={14} />}
        disabled={!canDelete}
        onClick={() => {
          onDelete(index)
          onClose()
        }}
      >
        Delete row
      </Button>
    </div>
  )
}
