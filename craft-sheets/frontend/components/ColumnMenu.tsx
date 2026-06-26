import { useEffect, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button, Input, Select } from './ui'
import type { Column, ColumnType } from '../types'

interface ColumnMenuProps {
  index: number
  column: Column
  anchor: { x: number; y: number }
  canDelete: boolean
  onRename: (index: number, name: string) => void
  onRetype: (index: number, type: ColumnType) => void
  onDelete: (index: number) => void
  onClose: () => void
}

const TYPE_OPTIONS = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'currency', label: 'Currency' },
]

/** Popover for a single column header: rename, change type, delete. */
export function ColumnMenu({
  index,
  column,
  anchor,
  canDelete,
  onRename,
  onRetype,
  onDelete,
  onClose,
}: ColumnMenuProps) {
  const [name, setName] = useState(column.name)
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

  const commitName = () => {
    const trimmed = name.trim()
    if (trimmed && trimmed !== column.name) onRename(index, trimmed)
  }

  // Keep the popover within the viewport horizontally.
  const left = Math.min(anchor.x, window.innerWidth - 240)

  return (
    <div
      ref={ref}
      role="dialog"
      style={{
        position: 'fixed',
        top: anchor.y,
        left: Math.max(8, left),
        zIndex: 'var(--z-dropdown)' as any,
        width: 224,
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        padding: 'var(--space-3)',
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border-primary)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      <Input
        label="Column name"
        value={name}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commitName()
            onClose()
          }
        }}
      />
      <Select
        label="Type"
        value={column.type}
        options={TYPE_OPTIONS}
        onChange={(e) => onRetype(index, e.target.value as ColumnType)}
      />
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
        Delete column
      </Button>
    </div>
  )
}
