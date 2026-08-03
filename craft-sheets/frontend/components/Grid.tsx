import { useEffect, useMemo, useRef, useState } from 'react'
import type { CellFormat, Sheet } from '../types'
import {
  colLetter,
  displayCell,
  makeRef,
  parseRef,
  type CellRect,
  DEFAULT_ROW_HEIGHT,
  MIN_COL_WIDTH,
  MIN_ROW_HEIGHT,
} from '../utils/grid'

type SelectionBounds = CellRect
type Rect = CellRect

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
  onOpenRowMenu: (index: number, anchor: { x: number; y: number }) => void
  onResizeColumn: (index: number, width: number) => void
  onResizeRow: (row: number, height: number) => void
  onPaste: (values: string[][]) => void
  onRichPaste: (cells: { raw: string; format: CellFormat | null }[][]) => void
  onToggleBold: () => void
  onToggleItalic: () => void
  onToggleUnderline: () => void
  onUndo: () => void
  onRedo: () => void
  onClearSelection: () => void
  onAutofill: (source: Rect, target: Rect) => void
  onOpenFind: () => void
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
  onOpenRowMenu,
  onResizeColumn,
  onResizeRow,
  onPaste,
  onRichPaste,
  onToggleBold,
  onToggleItalic,
  onToggleUnderline,
  onUndo,
  onRedo,
  onClearSelection,
  onAutofill,
  onOpenFind,
}: GridProps) {
  const [editingRef, setEditingRef] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HTMLInputElement>(null)
  const isDragging = useRef(false)

  const cols = sheet.columns.length
  const rows = sheet.numRows

  const rowHeight = (r: number) => sheet.rowHeights?.[String(r)] ?? DEFAULT_ROW_HEIGHT

  // Column/row header-edge resize (separate from the cell-range `isDragging` above).
  const resizeDrag = useRef<{
    type: 'col' | 'row'
    index: number
    startCoord: number
    startSize: number
  } | null>(null)
  const [liveSize, setLiveSize] = useState<{ type: 'col' | 'row'; index: number; size: number } | null>(null)
  // Mirrors `liveSize` for the mouseup listener below, which is attached once
  // (not re-attached per pixel of drag) and would otherwise close over a
  // stale `liveSize` from when the effect last ran.
  const liveSizeRef = useRef(liveSize)
  liveSizeRef.current = liveSize

  const startColResize = (index: number, clientX: number) => {
    resizeDrag.current = { type: 'col', index, startCoord: clientX, startSize: sheet.columns[index].width }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }
  const startRowResize = (index: number, clientY: number) => {
    resizeDrag.current = { type: 'row', index, startCoord: clientY, startSize: rowHeight(index) }
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
  }

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = resizeDrag.current
      if (!d) return
      const coord = d.type === 'col' ? e.clientX : e.clientY
      const delta = coord - d.startCoord
      const min = d.type === 'col' ? MIN_COL_WIDTH : MIN_ROW_HEIGHT
      const next = Math.max(min, Math.round(d.startSize + delta))
      setLiveSize({ type: d.type, index: d.index, size: next })
    }
    const onUp = () => {
      const d = resizeDrag.current
      if (d) {
        const finalSize =
          liveSizeRef.current && liveSizeRef.current.type === d.type && liveSizeRef.current.index === d.index
            ? liveSizeRef.current.size
            : d.startSize
        if (d.type === 'col') onResizeColumn(d.index, finalSize)
        else onResizeRow(d.index, finalSize)
      }
      resizeDrag.current = null
      setLiveSize(null)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onResizeColumn, onResizeRow])

  const effectiveColWidth = (c: number) =>
    liveSize && liveSize.type === 'col' && liveSize.index === c ? liveSize.size : sheet.columns[c].width
  const effectiveRowHeight = (r: number) =>
    liveSize && liveSize.type === 'row' && liveSize.index === r ? liveSize.size : rowHeight(r)

  const frozenRows = sheet.frozenRows ?? 0
  const frozenCols = sheet.frozenCols ?? 0

  // Cumulative pixel offsets for freeze-panes sticky positioning — precomputed
  // as arrays (not recomputed per cell) since rows can number in the thousands.
  const colOffsets = useMemo(() => {
    const arr: number[] = [ROWNUM_W]
    for (let c = 0; c < cols; c++) arr.push(arr[c] + effectiveColWidth(c))
    return arr
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cols, sheet.columns, liveSize])

  const rowOffsets = useMemo(() => {
    const arr: number[] = [CELL_H]
    for (let r = 0; r < rows; r++) arr.push(arr[r] + effectiveRowHeight(r))
    return arr
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sheet.rowHeights, liveSize])

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

  // Fill-drag (autofill handle): separate from the cell-range `isDragging`
  // above — dragging the fill handle extends a fill rectangle away from the
  // current selection rather than moving the selection anchor.
  const isFillDragging = useRef(false)
  const fillSourceRef = useRef<SelectionBounds | null>(null)
  const [fillPreview, setFillPreview] = useState<SelectionBounds | null>(null)
  // Mirrors `fillPreview` for the mouseup listener below, for the same
  // stale-closure reason `liveSizeRef` mirrors `liveSize`.
  const fillPreviewRef = useRef(fillPreview)
  fillPreviewRef.current = fillPreview

  const startFillDrag = () => {
    const source = selBounds ?? (() => {
      const pos = parseRef(selectedRef)
      return pos ? { minCol: pos.col, maxCol: pos.col, minRow: pos.row, maxRow: pos.row } : null
    })()
    if (!source) return
    fillSourceRef.current = source
    isFillDragging.current = true
  }

  const handleFillHover = (ref: string) => {
    const source = fillSourceRef.current
    const pos = parseRef(ref)
    if (!source || !pos) return
    const dRight = pos.col - source.maxCol
    const dDown = pos.row - source.maxRow
    if (dDown > 0 && dDown >= dRight) {
      setFillPreview({ minCol: source.minCol, maxCol: source.maxCol, minRow: source.minRow, maxRow: pos.row })
    } else if (dRight > 0) {
      setFillPreview({ minCol: source.minCol, maxCol: pos.col, minRow: source.minRow, maxRow: source.maxRow })
    } else {
      setFillPreview(null)
    }
  }

  // Release drag when the mouse button is released anywhere in the window
  useEffect(() => {
    const up = () => {
      isDragging.current = false
      if (isFillDragging.current) {
        const source = fillSourceRef.current
        const preview = fillPreviewRef.current
        if (source && preview) onAutofill(source, preview)
        isFillDragging.current = false
        fillSourceRef.current = null
        setFillPreview(null)
      }
    }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onAutofill])

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
    if (e.shiftKey) {
      onSelectionEnd(ref === selectedRef ? null : ref)
      containerRef.current?.focus()
      return
    }
    isDragging.current = true
    onSelect(ref) // MainView's handleSelect clears selectionEnd + ctrlSelectedRefs
    containerRef.current?.focus()
  }

  const handleCellHover = (ref: string) => {
    if (isFillDragging.current) {
      handleFillHover(ref)
      return
    }
    if (!isDragging.current) return
    // Return to single-cell when mouse moves back to anchor
    onSelectionEnd(ref === selectedRef ? null : ref)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editingRef !== null) return
    const pos = parseRef(selectedRef) ?? { col: 0, row: 0 }
    const endPos = selectionEnd ? (parseRef(selectionEnd) ?? pos) : pos

    // Redo chords: Ctrl+Shift+Z or Ctrl+Y
    if ((e.ctrlKey || e.metaKey) && ((e.shiftKey && (e.key === 'z' || e.key === 'Z')) || e.key === 'y' || e.key === 'Y')) {
      e.preventDefault(); onRedo(); return
    }

    // Ctrl hotkeys
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
      if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); onUndo(); return }
      if (e.key === 'b' || e.key === 'B') { e.preventDefault(); onToggleBold(); return }
      if (e.key === 'i' || e.key === 'I') { e.preventDefault(); onToggleItalic(); return }
      if (e.key === 'u' || e.key === 'U') { e.preventDefault(); onToggleUnderline(); return }
      if (e.key === 'f' || e.key === 'F') { e.preventDefault(); onOpenFind(); return }
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

  const handleCopy = (e: React.ClipboardEvent) => {
    if (editingRef !== null) return
    e.preventDefault()

    let minRow: number, maxRow: number, minCol: number, maxCol: number

    if (selBounds) {
      minRow = selBounds.minRow; maxRow = selBounds.maxRow
      minCol = selBounds.minCol; maxCol = selBounds.maxCol
    } else if (ctrlSelectedRefs.size > 0) {
      const positions = [...ctrlSelectedRefs]
        .map((r) => parseRef(r))
        .filter(Boolean) as { col: number; row: number }[]
      if (positions.length === 0) return
      minRow = Math.min(...positions.map((p) => p.row)); maxRow = Math.max(...positions.map((p) => p.row))
      minCol = Math.min(...positions.map((p) => p.col)); maxCol = Math.max(...positions.map((p) => p.col))
    } else {
      const cell = sheet.cells[selectedRef]
      e.clipboardData.setData('text/plain', rawOf(selectedRef))
      e.clipboardData.setData('application/x-craft-sheets',
        JSON.stringify([[{ raw: cell?.raw ?? '', format: cell?.format ?? null }]]))
      return
    }

    const textRows: string[][] = []
    const richRows: { raw: string; format: CellFormat | null }[][] = []
    for (let r = minRow; r <= maxRow; r++) {
      const textRow: string[] = []
      const richRow: { raw: string; format: CellFormat | null }[] = []
      for (let c = minCol; c <= maxCol; c++) {
        const ref = makeRef(c, r)
        const cell = sheet.cells[ref]
        textRow.push(rawOf(ref))
        richRow.push({ raw: cell?.raw ?? '', format: cell?.format ?? null })
      }
      textRows.push(textRow)
      richRows.push(richRow)
    }
    e.clipboardData.setData('text/plain', textRows.map((r) => r.join('\t')).join('\n'))
    e.clipboardData.setData('application/x-craft-sheets', JSON.stringify(richRows))
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    if (editingRef !== null) return
    e.preventDefault()
    const rich = e.clipboardData.getData('application/x-craft-sheets')
    if (rich) {
      try {
        onRichPaste(JSON.parse(rich) as { raw: string; format: CellFormat | null }[][])
        return
      } catch { /* fall through to text */ }
    }
    const text = e.clipboardData.getData('text/plain')
    if (!text) return
    const rows2d = text.split(/\r?\n/).map((row) => row.split('\t'))
    while (rows2d.length > 0 && rows2d[rows2d.length - 1].every((v) => v === '')) rows2d.pop()
    if (rows2d.length > 0) onPaste(rows2d)
  }

  const gridTemplateColumns = `${ROWNUM_W}px ` + sheet.columns.map((_, c) => `${effectiveColWidth(c)}px`).join(' ')
  const gridTemplateRows = `${CELL_H}px ` + Array.from({ length: rows }, (_, r) => `${effectiveRowHeight(r)}px`).join(' ')

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onCopy={handleCopy}
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
      <div style={{ display: 'grid', gridTemplateColumns, gridTemplateRows, width: 'max-content', minWidth: '100%' }}>
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
              ...(c < frozenCols ? { left: colOffsets[c] } : {}),
              zIndex: c < frozenCols ? 26 : 20,
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
            <div
              role="separator"
              aria-orientation="vertical"
              title="Drag to resize column"
              onMouseDown={(e) => {
                e.stopPropagation()
                startColResize(c, e.clientX)
              }}
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                right: -3,
                top: 0,
                bottom: 0,
                width: 6,
                cursor: 'col-resize',
                zIndex: 25,
              }}
            />
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
            frozenRows={frozenRows}
            frozenCols={frozenCols}
            colOffsets={colOffsets}
            rowOffsets={rowOffsets}
            fillPreview={fillPreview}
            onFillMouseDown={startFillDrag}
            onCellMouseDown={handleCellMouseDown}
            onCellHover={handleCellHover}
            onStartEdit={startEdit}
            onDraft={setDraft}
            onCommit={commitEdit}
            onCancel={cancelEdit}
            onRowHandleDown={(clientY) => startRowResize(r, clientY)}
            onOpenRowMenu={(anchor) => onOpenRowMenu(r, anchor)}
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
        zIndex: 30,
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
  fillPreview: SelectionBounds | null
  onFillMouseDown: () => void
  onCellMouseDown: (ref: string, e: React.MouseEvent) => void
  onCellHover: (ref: string) => void
  onStartEdit: (ref: string, initial?: string) => void
  onDraft: (v: string) => void
  onCommit: (moveTo?: string) => void
  onCancel: () => void
  onRowHandleDown: (clientY: number) => void
  onOpenRowMenu: (anchor: { x: number; y: number }) => void
  frozenRows: number
  frozenCols: number
  colOffsets: number[]
  rowOffsets: number[]
}

function RowCells(props: RowCellsProps) {
  const { sheet, row, cols, selectedRef, editingRef, selBounds, ctrlSelectedRefs, frozenRows, frozenCols, colOffsets, rowOffsets, fillPreview } = props
  const rowFrozen = row < frozenRows

  return (
    <>
      {/* Row number */}
      <div
        onClick={(e) => props.onOpenRowMenu({ x: e.clientX, y: e.clientY })}
        title="Click to insert or delete this row"
        style={{
          position: 'sticky',
          left: 0,
          ...(rowFrozen ? { top: rowOffsets[row] } : {}),
          zIndex: rowFrozen ? 26 : 10,
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'var(--bg-tertiary)',
          borderBottom: '1px solid var(--border-primary)',
          borderRight: '1px solid var(--border-primary)',
          fontSize: 'var(--font-size-xs)',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        {row + 1}
        <div
          role="separator"
          aria-orientation="horizontal"
          title="Drag to resize row"
          onMouseDown={(e) => {
            e.stopPropagation()
            props.onRowHandleDown(e.clientY)
          }}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: -3,
            height: 6,
            cursor: 'row-resize',
            zIndex: 25,
          }}
        />
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

        const isFillHandleCell = selBounds
          ? c === selBounds.maxCol && row === selBounds.maxRow
          : ref === selectedRef
        const inFillPreview =
          fillPreview != null &&
          c >= fillPreview.minCol &&
          c <= fillPreview.maxCol &&
          row >= fillPreview.minRow &&
          row <= fillPreview.maxRow &&
          !inRange

        const colFrozen = c < frozenCols
        const cellFrozen = rowFrozen || colFrozen

        return (
          <div
            key={ref}
            role="gridcell"
            data-ref={ref}
            onMouseDown={(e) => props.onCellMouseDown(ref, e)}
            onMouseEnter={() => props.onCellHover(ref)}
            onDoubleClick={() => props.onStartEdit(ref)}
            style={{
              position: cellFrozen ? 'sticky' : 'relative',
              ...(rowFrozen ? { top: rowOffsets[row] } : {}),
              ...(colFrozen ? { left: colOffsets[c] } : {}),
              zIndex: rowFrozen && colFrozen ? 15 : cellFrozen ? 5 : undefined,
              height: '100%',
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
              color: isError ? 'var(--color-error)' : (fmt?.color ?? (fmt?.bg ? '#1a1a1a' : 'var(--text-primary)')),
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
            {inFillPreview && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  boxShadow: 'inset 0 0 0 1px var(--text-secondary)',
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
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', position: 'relative' }}>
                {text}
              </span>
            )}
            {isFillHandleCell && !editing && (
              <div
                title="Drag to fill"
                onMouseDown={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  props.onFillMouseDown()
                }}
                style={{
                  position: 'absolute',
                  right: -4,
                  bottom: -4,
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  backgroundColor: 'var(--color-primary)',
                  border: '1px solid var(--bg-primary)',
                  cursor: 'crosshair',
                  zIndex: 6,
                }}
              />
            )}
          </div>
        )
      })}
    </>
  )
}
