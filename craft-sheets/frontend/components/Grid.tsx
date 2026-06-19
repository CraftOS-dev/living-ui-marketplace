import { useEffect, useRef, useState } from 'react'
import type { Sheet } from '../types'
import { colLetter, displayCell, makeRef, parseRef } from '../utils/grid'

interface GridProps {
  sheet: Sheet
  selectedRef: string
  onSelect: (ref: string) => void
  onCommitCell: (ref: string, raw: string) => void
  onOpenColumnMenu: (index: number, anchor: { x: number; y: number }) => void
}

const CELL_H = 28
const ROWNUM_W = 48

/**
 * The scrollable spreadsheet grid. Owns inline-edit state and keyboard
 * navigation; commits raw cell content up to MainView which persists + evaluates.
 */
export function Grid({ sheet, selectedRef, onSelect, onCommitCell, onOpenColumnMenu }: GridProps) {
  const [editingRef, setEditingRef] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HTMLInputElement>(null)

  const cols = sheet.columns.length
  const rows = sheet.numRows

  useEffect(() => {
    if (editingRef && editorRef.current) {
      editorRef.current.focus()
      const len = editorRef.current.value.length
      editorRef.current.setSelectionRange(len, len)
    }
  }, [editingRef])

  const rawOf = (ref: string) => sheet.cells[ref]?.raw ?? ''

  const startEdit = (ref: string, initial?: string) => {
    setDraft(initial !== undefined ? initial : rawOf(ref))
    setEditingRef(ref)
  }

  const commitEdit = (moveTo?: string) => {
    if (editingRef !== null) {
      onCommitCell(editingRef, draft)
    }
    setEditingRef(null)
    setDraft('')
    if (moveTo) {
      onSelect(moveTo)
      containerRef.current?.focus()
    }
  }

  const cancelEdit = () => {
    setEditingRef(null)
    setDraft('')
    containerRef.current?.focus()
  }

  const move = (dCol: number, dRow: number) => {
    const pos = parseRef(selectedRef) ?? { col: 0, row: 0 }
    const col = Math.max(0, Math.min(cols - 1, pos.col + dCol))
    const row = Math.max(0, Math.min(rows - 1, pos.row + dRow))
    onSelect(makeRef(col, row))
  }

  // Select a cell and ensure the grid keeps keyboard focus for navigation/typing.
  const selectAndFocus = (ref: string) => {
    onSelect(ref)
    containerRef.current?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editingRef !== null) return // editor handles its own keys
    const pos = parseRef(selectedRef) ?? { col: 0, row: 0 }

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault(); move(0, -1); break
      case 'ArrowDown':
      case 'Enter':
        e.preventDefault(); move(0, 1); break
      case 'ArrowLeft':
        e.preventDefault(); move(-1, 0); break
      case 'ArrowRight':
        e.preventDefault(); move(1, 0); break
      case 'Tab':
        e.preventDefault(); move(e.shiftKey ? -1 : 1, 0); break
      case 'F2':
        e.preventDefault(); startEdit(selectedRef); break
      case 'Backspace':
      case 'Delete':
        e.preventDefault(); onCommitCell(selectedRef, ''); break
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault()
          startEdit(selectedRef, e.key)
        }
    }
    void pos
  }

  const gridTemplateColumns = `${ROWNUM_W}px ` + sheet.columns.map((c) => `${c.width}px`).join(' ')

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      role="grid"
      aria-label={`${sheet.name} grid`}
      style={{
        flex: 1,
        overflow: 'auto',
        outline: 'none',
        backgroundColor: 'var(--bg-primary)',
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns, width: 'max-content', minWidth: '100%' }}>
        {/* Header row */}
        <HeaderCorner />
        {sheet.columns.map((col, c) => (
          <div
            key={`h-${c}`}
            onClick={(e) => onOpenColumnMenu(c, { x: e.clientX, y: e.clientY })}
            title="Click to rename, change type, or delete"
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 2,
              height: CELL_H,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 4,
              padding: '0 var(--space-2)',
              backgroundColor: 'var(--bg-tertiary)',
              borderBottom: '1px solid var(--border-primary)',
              borderRight: '1px solid var(--border-primary)',
              cursor: 'pointer',
              fontSize: 'var(--font-size-xs)',
              fontWeight: 'var(--font-weight-semibold)' as any,
              color: 'var(--text-secondary)',
              userSelect: 'none',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{col.name}</span>
            <span style={{ color: 'var(--text-muted)', fontWeight: 'var(--font-weight-normal)' as any }}>
              {colLetter(c)}
            </span>
          </div>
        ))}

        {/* Data rows */}
        {Array.from({ length: rows }, (_, r) => (
          <RowCells
            key={`r-${r}`}
            sheet={sheet}
            row={r}
            cols={cols}
            selectedRef={selectedRef}
            editingRef={editingRef}
            draft={draft}
            editorRef={editorRef}
            rawOf={rawOf}
            onSelect={selectAndFocus}
            onStartEdit={startEdit}
            onDraft={setDraft}
            onCommit={commitEdit}
            onCancel={cancelEdit}
          />
        ))}
      </div>
    </div>
  )
}

function HeaderCorner() {
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        left: 0,
        zIndex: 3,
        height: CELL_H,
        backgroundColor: 'var(--bg-tertiary)',
        borderBottom: '1px solid var(--border-primary)',
        borderRight: '1px solid var(--border-primary)',
      }}
    />
  )
}

interface RowCellsProps {
  sheet: Sheet
  row: number
  cols: number
  selectedRef: string
  editingRef: string | null
  draft: string
  editorRef: React.RefObject<HTMLInputElement>
  rawOf: (ref: string) => string
  onSelect: (ref: string) => void
  onStartEdit: (ref: string, initial?: string) => void
  onDraft: (v: string) => void
  onCommit: (moveTo?: string) => void
  onCancel: () => void
}

function RowCells(props: RowCellsProps) {
  const { sheet, row, cols, selectedRef, editingRef } = props

  return (
    <>
      {/* Row number */}
      <div
        style={{
          position: 'sticky',
          left: 0,
          zIndex: 1,
          height: CELL_H,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'var(--bg-tertiary)',
          borderBottom: '1px solid var(--border-primary)',
          borderRight: '1px solid var(--border-primary)',
          fontSize: 'var(--font-size-xs)',
          color: 'var(--text-muted)',
          userSelect: 'none',
        }}
      >
        {row + 1}
      </div>

      {Array.from({ length: cols }, (_, c) => {
        const ref = makeRef(c, row)
        const selected = ref === selectedRef
        const editing = ref === editingRef
        const fmt = sheet.cells[ref]?.format
        const colType = sheet.columns[c]?.type ?? 'text'
        const defaultAlign = colType === 'number' || colType === 'currency' ? 'right' : 'left'
        const align = fmt?.align ?? defaultAlign
        const { text, isError } = displayCell(sheet, ref)

        return (
          <div
            key={ref}
            role="gridcell"
            onMouseDown={() => props.onSelect(ref)}
            onDoubleClick={() => props.onStartEdit(ref)}
            style={{
              position: 'relative',
              height: CELL_H,
              padding: '0 6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent:
                align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start',
              borderBottom: '1px solid var(--border-secondary)',
              borderRight: '1px solid var(--border-secondary)',
              backgroundColor: fmt?.bg || 'var(--bg-primary)',
              boxShadow: selected ? 'inset 0 0 0 2px var(--color-primary)' : undefined,
              cursor: 'cell',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              fontSize: 'var(--font-size-sm)',
              fontWeight: fmt?.bold ? ('var(--font-weight-bold)' as any) : undefined,
              color: isError ? 'var(--color-error)' : fmt?.bg ? '#1a1a1a' : 'var(--text-primary)',
            }}
          >
            {editing ? (
              <input
                ref={props.editorRef}
                value={props.draft}
                onChange={(e) => props.onDraft(e.target.value)}
                onBlur={() => props.onCommit()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    props.onCommit(makeRef(c, Math.min(sheet.numRows - 1, row + 1)))
                  } else if (e.key === 'Tab') {
                    e.preventDefault()
                    props.onCommit(makeRef(Math.min(cols - 1, c + 1), row))
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    props.onCancel()
                  }
                }}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  border: '2px solid var(--color-primary)',
                  borderRadius: 0,
                  padding: '0 5px',
                  margin: 0,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--font-size-sm)',
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  outline: 'none',
                  zIndex: 4,
                }}
              />
            ) : (
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{text}</span>
            )}
          </div>
        )
      })}
    </>
  )
}
