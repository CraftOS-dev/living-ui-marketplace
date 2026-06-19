import { useEffect, useRef, useState } from 'react'
import { Input } from './ui'

interface FormulaBarProps {
  selectedRef: string
  raw: string
  onCommit: (raw: string) => void
}

/**
 * Excel-style formula bar: the name box shows the selected cell reference and
 * the input shows / edits its raw content (a literal or a `=` formula).
 */
export function FormulaBar({ selectedRef, raw, onCommit }: FormulaBarProps) {
  const [draft, setDraft] = useState(raw)
  const inputRef = useRef<HTMLInputElement>(null)

  // Re-sync when the selection or underlying value changes (unless actively typing here).
  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setDraft(raw)
    }
  }, [raw, selectedRef])

  const commit = () => {
    if (draft !== raw) onCommit(draft)
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        padding: 'var(--space-2) var(--space-3)',
        borderBottom: '1px solid var(--border-primary)',
        backgroundColor: 'var(--bg-secondary)',
      }}
    >
      <div
        aria-label="Selected cell"
        style={{
          minWidth: 56,
          padding: '0 var(--space-2)',
          height: 'var(--input-height-md)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--font-size-sm)',
          fontWeight: 'var(--font-weight-semibold)' as any,
          color: 'var(--color-primary)',
          backgroundColor: 'var(--bg-tertiary)',
          border: '1px solid var(--border-primary)',
          borderRadius: 'var(--radius-md)',
        }}
      >
        {selectedRef}
      </div>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          color: 'var(--text-muted)',
          fontSize: 'var(--font-size-base)',
        }}
      >
        fx
      </span>
      <div style={{ flex: 1 }}>
        <Input
          ref={inputRef}
          value={draft}
          placeholder="Enter a value or formula, e.g. =SUM(A1:A10)"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
              inputRef.current?.blur()
            } else if (e.key === 'Escape') {
              setDraft(raw)
              inputRef.current?.blur()
            }
          }}
          style={{ fontFamily: 'var(--font-mono)' }}
        />
      </div>
    </div>
  )
}
