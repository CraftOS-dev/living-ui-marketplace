import { useEffect, useMemo, useRef, useState } from 'react'
import type { Sheet } from '../types'
import { colLetter, displayCell, makeRef, parseRef } from '../utils/grid'

interface SelectionBounds {
  minCol: number
  maxCol: number
  minRow: number
  maxRow: number
}

interface GridProps {
  sheet: Sheet
  selectedRef: string
  selectionEnd: string | null
  ctrlSelectedRefs: Set<string>
  onSelect: (ref: string) => void
  onSelectionEnd: (end: string | null) => void
  onCtrlSelect: (ref: string) => void
  onCommitCell: (ref: string, raw: string) => void
  onOpenColumnMenu: (index: number, anchor: { x: number; y: number }) => void
  onPaste: (values: string[][]) => void
  onToggleBold: () => void
  onToggleItalic: () => void
  onToggleUnderline: () => void
  onUndo: () => void
  onClearSelection: () => void
}

const CELL_H = 28
const ROWNUM_W = 48

/**
 * The scrollable spreadsheet grid. Owns inline-edit state and keyboard
 * navigation; commits raw cell content up to MainView which persists + evaluates.
 */
export function Grid({
  sheet,
  selectedRef,
  selectionEnd,
  ctrlSelectedRefs,
  onSelect,
  onSelectionEnd,
  onCtrlSelect,
  onCommitCell,
  onOpenColumnMenu,
  onPaste,
  onToggleBold,
  onToggleItalic,
  onToggleUnderline,
  onUndo,
  onClearSelection,
}: GridProps) {
  const [editingRef, setEditingRef] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HTMLInputElement>(null)
  const isDragging = useRef(false)

  const cols = sheet.columns.length
  const rows = sheet.numRows

  // Rectangular bounds of the current selection range (null = single cell)
  const selBounds = useMemo<SelectionBounds | null>(() => {
    if (!selectionEnd) return null
    const a = parseRef(selectedRef)
    const b = parseRef(selectionEnd)
    if (!a || !b) return null
    return {
      minCol: Math.min(a.col, b.col),
      maxCol: Math.max(a.col, b.col),
      minRow: Math.min(a.row, b.row),
      maxRow: Math.max(a.row, b.row),
    }
  }, [selectedRef, selectionEnd])

  useEffect(() => {
    if (editingRef && editorRef.current) {
      editorRef.current.focus()
      const len = editorRef.current.value.length
      editorRef.current.setSelectionRange(len, len)
    }
  }, [editingRef])

  // Release drag when the mouse button is released anywhere in the window
  useEffect(() => {
    const up = () => { isDragging.current = false }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])

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

  const handleCellMouseDown = (ref: string, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      onCtrlSelect(ref)
      containerRef.current?.focus()
      return
    }
    isDragging.current = true
    onSelect(ref) // MainView's handleSelect clears selectionEnd + ctrlSelectedRefs
    containerRef.current?.focus()
  }

  const handleCellHover = (ref: string) => {
    if (!isDragging.current) return
    // Return to single-cell when mouse moves back to anchor
    onSelectionEnd(ref === selectedRef ? null : ref)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editingRef !== null) return
    const pos = parseRef(selectedRef) ?? { col: 0, row: 0 }
    const endPos = selectionEnd ? (parseRef(selectionEnd) ?? pos) : pos

    // Ctrl hotkeys
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
      if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); onUndo(); return }
      if (e.key === 'b' || e.key === 'B') { e.preventDefault(); onToggleBold(); return }
      if (e.key === 'i' || e.key === 'I') { e.preventDefault(); onToggleItalic(); return }
      if (e.key === 'u' || e.key === 'U') { e.preventDefault(); onToggleUnderline(); return }
    }

    // Shift+Arrow: extend selection end, keep anchor fixed
    if (e.shiftKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault()
      let { col: ec, row: er } = endPos
      if (e.key === 'ArrowUp') er = Math.max(0, er - 1)
      else if (e.key === 'ArrowDown') er = Math.min(rows - 1, er + 1)
      else if (e.key === 'ArrowLeft') ec = Math.max(0, ec - 1)
      else if (e.key === 'ArrowRight') ec = Math.min(cols - 1, ec + 1)
      const newEnd = makeRef(ec, er)
      onSelectionEnd(newEnd === selectedRef ? null : newEnd)
      return
    }

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
        e.preventDefault(); onClearSelection(); break
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault()
          startEdit(selectedRef, e.key)
        }
    }
    void pos
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    if (editingRef !== null) return // let the cell input handle its own paste
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    if (!text) return
    const rows2d = text.split(/\r?\n/).map((row) => row.split('\t'))
    // Strip trailing empty row that Excel/Sheets appends
    while (rows2d.length > 0 && rows2d[rows2d.length - 1].every((v) => v === '')) {
      rows2d.pop()
    }
    if (rows2d.length > 0) onPaste(rows2d)
  }

  const gridTemplateColumns = `${ROWNUM_W}px ` + sheet.columns.map((c) => `${c.width}px`).join(' ')

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPaste={handlePaste}
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
            selBounds={selBounds}
            ctrlSelectedRefs={ctrlSelectedRefs}
            rawOf={rawOf}
            onCellMouseDown={handleCellMouseDown}
            onCellHover={handleCellHover}
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
  selBounds: SelectionBounds | null
  ctrlSelectedRefs: Set<string>
  rawOf: (ref: string) => string
  onCellMouseDown: (ref: string, e: React.MouseEvent) => void
  onCellHover: (ref: string) => void
  onStartEdit: (ref: string, initial?: string) => void
  onDraft: (v: string) => void
  onCommit: (moveTo?: string) => void
  onCancel: () => void
}

function RowCells(props: RowCellsProps) {
  const { sheet, row, cols, selectedRef, editingRef, selBounds, ctrlSelectedRefs } = props

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
        const inRange =
          (selBounds != null &&
            c >= selBounds.minCol &&
            c <= selBounds.maxCol &&
            row >= selBounds.minRow &&
            row <= selBounds.maxRow) ||
          ctrlSelectedRefs.has(ref)

        return (
          <div
            key={ref}
            role="gridcell"
            onMouseDown={(e) => props.onCellMouseDown(ref, e)}
            onMouseEnter={() => props.onCellHover(ref)}
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
              fontStyle: fmt?.italic ? 'italic' : undefined,
              textDecoration: fmt?.underline ? 'underline' : undefined,
              color: isError ? 'var(--color-error)' : fmt?.bg ? '#1a1a1a' : 'var(--text-primary)',
              userSelect: 'none',
            }}
          >
            {/* Range highlight overlay — rendered before text so text sits on top */}
            {inRange && !selected && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  backgroundColor: 'rgba(59, 130, 246, 0.15)',
                  boxShadow: 'inset 0 0 0 1px rgba(59, 130, 246, 0.4)',
                  pointerEvents: 'none',
                }}
              />
            )}
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
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', position: 'relative', zIndex: 2 }}>
                {text}
              </span>
            )}
          </div>
        )
      })}
    </>
  )
}
