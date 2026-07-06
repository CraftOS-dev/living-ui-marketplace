/**
 * Pure grid helpers: A1-reference math, structural grid mutations, and
 * column-type-aware value formatting. No React, no side effects — every
 * mutation returns a new Sheet so the caller can persist it.
 */

import type { Cell, CellFormat, Column, ColumnType, Sheet } from '../types'

export const DEFAULT_COL_WIDTH = 120
export const MIN_COL_WIDTH = 64
export const DEFAULT_ROW_HEIGHT = 28
export const MIN_ROW_HEIGHT = 20

// --- A1 reference helpers ---------------------------------------------------

export function colLetter(index: number): string {
  let n = index + 1
  let letters = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    letters = String.fromCharCode(65 + rem) + letters
    n = Math.floor((n - 1) / 26)
  }
  return letters
}

export function letterToIndex(letters: string): number {
  let n = 0
  for (const ch of letters.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64)
  }
  return n - 1
}

export function makeRef(col: number, row: number): string {
  return `${colLetter(col)}${row + 1}`
}

export function parseRef(ref: string): { col: number; row: number } | null {
  const m = /^([A-Za-z]+)(\d+)$/.exec(ref)
  if (!m) return null
  return { col: letterToIndex(m[1]), row: parseInt(m[2], 10) - 1 }
}

// --- value formatting -------------------------------------------------------

const currencyFmt = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
})

const numberFmt = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 10,
})

/** Format a backend-evaluated value for display, honoring the column type. */
export function formatValue(
  value: number | string | boolean | undefined,
  type: ColumnType
): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'

  if (typeof value === 'number') {
    if (type === 'currency') return currencyFmt.format(value)
    return numberFmt.format(value)
  }

  // string value
  if (type === 'currency') {
    const n = Number(value)
    if (!Number.isNaN(n) && value.trim() !== '') return currencyFmt.format(n)
  }
  return value
}

/** Resolve what a cell should show: error code, evaluated value, or blank. */
export function displayCell(sheet: Sheet, ref: string): { text: string; isError: boolean } {
  if (sheet.errors[ref]) return { text: sheet.errors[ref], isError: true }
  const { col } = parseRef(ref) ?? { col: 0 }
  const type = sheet.columns[col]?.type ?? 'text'
  return { text: formatValue(sheet.values[ref], type), isError: false }
}

// --- structural mutations (return a new Sheet) ------------------------------

function cloneCells(cells: Record<string, Cell>): Record<string, Cell> {
  const out: Record<string, Cell> = {}
  for (const [k, v] of Object.entries(cells)) out[k] = { ...v, format: v.format ? { ...v.format } : undefined }
  return out
}

export function setCellRaw(sheet: Sheet, ref: string, raw: string): Sheet {
  const cells = cloneCells(sheet.cells)
  if (raw === '') {
    if (cells[ref]?.format && Object.keys(cells[ref].format!).length > 0) {
      cells[ref] = { ...cells[ref], raw: '' }
    } else {
      delete cells[ref]
    }
  } else {
    cells[ref] = { ...(cells[ref] || {}), raw }
  }
  return { ...sheet, cells }
}

export function setCellFormat(sheet: Sheet, ref: string, format: Partial<CellFormat>): Sheet {
  const cells = cloneCells(sheet.cells)
  const existing = cells[ref] || { raw: '' }
  const nextFormat: CellFormat = { ...existing.format, ...format }
  // Drop falsy/empty keys to keep storage tidy.
  Object.keys(nextFormat).forEach((k) => {
    const key = k as keyof CellFormat
    if (nextFormat[key] === null || nextFormat[key] === undefined || nextFormat[key] === false) {
      delete nextFormat[key]
    }
  })
  if (existing.raw === '' && Object.keys(nextFormat).length === 0) {
    delete cells[ref]
  } else {
    cells[ref] = { ...existing, format: Object.keys(nextFormat).length ? nextFormat : undefined }
  }
  return { ...sheet, cells }
}

export function getCellFormat(sheet: Sheet, ref: string): CellFormat {
  return sheet.cells[ref]?.format ?? {}
}

export function addRow(sheet: Sheet): Sheet {
  return { ...sheet, numRows: sheet.numRows + 1 }
}

export function addColumn(sheet: Sheet): Sheet {
  const columns: Column[] = [
    ...sheet.columns,
    { name: colLetter(sheet.columns.length), type: 'text', width: DEFAULT_COL_WIDTH },
  ]
  return { ...sheet, columns }
}

export function renameColumn(sheet: Sheet, index: number, name: string): Sheet {
  const columns = sheet.columns.map((c, i) => (i === index ? { ...c, name } : c))
  return { ...sheet, columns }
}

export function setColumnType(sheet: Sheet, index: number, type: ColumnType): Sheet {
  const columns = sheet.columns.map((c, i) => (i === index ? { ...c, type } : c))
  return { ...sheet, columns }
}

export function setColumnWidth(sheet: Sheet, index: number, width: number): Sheet {
  const w = Math.max(MIN_COL_WIDTH, Math.round(width))
  const columns = sheet.columns.map((c, i) => (i === index ? { ...c, width: w } : c))
  return { ...sheet, columns }
}

export function setRowHeight(sheet: Sheet, rowIndex: number, height: number): Sheet {
  const h = Math.max(MIN_ROW_HEIGHT, Math.round(height))
  const rowHeights = { ...sheet.rowHeights, [String(rowIndex)]: h }
  return { ...sheet, rowHeights }
}

/** Delete a row (0-based), shifting cells below it up by one. */
export function deleteRow(sheet: Sheet, rowIndex: number): Sheet {
  if (sheet.numRows <= 1) return sheet
  const cells: Record<string, Cell> = {}
  for (const [ref, cell] of Object.entries(sheet.cells)) {
    const pos = parseRef(ref)
    if (!pos) continue
    if (pos.row === rowIndex) continue // removed
    const newRow = pos.row > rowIndex ? pos.row - 1 : pos.row
    cells[makeRef(pos.col, newRow)] = cell
  }
  const rowHeights: Record<string, number> = {}
  for (const [key, h] of Object.entries(sheet.rowHeights || {})) {
    const idx = Number(key)
    if (idx === rowIndex) continue
    const newIdx = idx > rowIndex ? idx - 1 : idx
    rowHeights[String(newIdx)] = h
  }
  return { ...sheet, cells, rowHeights, numRows: sheet.numRows - 1 }
}

// --- multi-cell selection helpers -------------------------------------------

/** All A1 refs in the rectangular range defined by two corner refs. */
export function getSelectionRefs(anchor: string, end: string): string[] {
  const a = parseRef(anchor)
  const b = parseRef(end)
  if (!a || !b) return [anchor]
  const minCol = Math.min(a.col, b.col)
  const maxCol = Math.max(a.col, b.col)
  const minRow = Math.min(a.row, b.row)
  const maxRow = Math.max(a.row, b.row)
  const refs: string[] = []
  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      refs.push(makeRef(c, r))
    }
  }
  return refs
}

/** Apply a format patch to every ref in the list. */
export function setRangeFormat(sheet: Sheet, refs: string[], format: Partial<CellFormat>): Sheet {
  let next = sheet
  for (const ref of refs) {
    next = setCellFormat(next, ref, format)
  }
  return next
}

// --- paste from clipboard ----------------------------------------------------

/**
 * Paste a 2-D array of tab-separated values starting at startRef.
 * Automatically expands numRows / columns when the paste exceeds the grid.
 */
export function pasteRange(sheet: Sheet, startRef: string, values: string[][]): Sheet {
  const start = parseRef(startRef)
  if (!start || values.length === 0) return sheet

  const pasteRows = values.length
  const pasteCols = Math.max(...values.map((r) => r.length), 0)

  let next: Sheet = { ...sheet }

  const neededRows = start.row + pasteRows
  if (neededRows > next.numRows) {
    next = { ...next, numRows: neededRows }
  }

  const neededCols = start.col + pasteCols
  if (neededCols > next.columns.length) {
    const newCols: Column[] = [...next.columns]
    while (newCols.length < neededCols) {
      newCols.push({ name: colLetter(newCols.length), type: 'text', width: DEFAULT_COL_WIDTH })
    }
    next = { ...next, columns: newCols }
  }

  // Clone cells then apply paste values
  const cells: Record<string, Cell> = {}
  for (const [k, v] of Object.entries(next.cells)) {
    cells[k] = { ...v, format: v.format ? { ...v.format } : undefined }
  }
  for (let r = 0; r < values.length; r++) {
    for (let c = 0; c < values[r].length; c++) {
      const ref = makeRef(start.col + c, start.row + r)
      const val = values[r][c]
      const existing = cells[ref] || { raw: '' }
      cells[ref] = { ...existing, raw: val }
    }
  }

  return { ...next, cells }
}

/** Paste a 2-D array of full cell objects (raw + format) starting at startRef. */
export function pasteRangeFull(
  sheet: Sheet,
  startRef: string,
  cells: ({ raw: string; format: CellFormat | null })[][]
): Sheet {
  const start = parseRef(startRef)
  if (!start || cells.length === 0) return sheet
  const pasteRows = cells.length
  const pasteCols = Math.max(...cells.map((r) => r.length), 0)
  let next: Sheet = { ...sheet }
  const neededRows = start.row + pasteRows
  if (neededRows > next.numRows) next = { ...next, numRows: neededRows }
  const neededCols = start.col + pasteCols
  if (neededCols > next.columns.length) {
    const newCols: Column[] = [...next.columns]
    while (newCols.length < neededCols)
      newCols.push({ name: colLetter(newCols.length), type: 'text', width: DEFAULT_COL_WIDTH })
    next = { ...next, columns: newCols }
  }
  const cloned: Record<string, Cell> = {}
  for (const [k, v] of Object.entries(next.cells))
    cloned[k] = { ...v, format: v.format ? { ...v.format } : undefined }
  for (let r = 0; r < cells.length; r++) {
    for (let c = 0; c < cells[r].length; c++) {
      const ref = makeRef(start.col + c, start.row + r)
      const src = cells[r][c]
      const fmt = src.format ? { ...src.format } : undefined
      if (src.raw === '' && !fmt) { delete cloned[ref] }
      else { cloned[ref] = { raw: src.raw, format: fmt } }
    }
  }
  return { ...next, cells: cloned }
}

/** Delete a column (0-based), shifting columns/cells to its right left by one. */
export function deleteColumn(sheet: Sheet, colIndex: number): Sheet {
  if (sheet.columns.length <= 1) return sheet
  const columns = sheet.columns.filter((_, i) => i !== colIndex)
  const cells: Record<string, Cell> = {}
  for (const [ref, cell] of Object.entries(sheet.cells)) {
    const pos = parseRef(ref)
    if (!pos) continue
    if (pos.col === colIndex) continue // removed
    const newCol = pos.col > colIndex ? pos.col - 1 : pos.col
    cells[makeRef(newCol, pos.row)] = cell
  }
  return { ...sheet, columns, cells }
}
