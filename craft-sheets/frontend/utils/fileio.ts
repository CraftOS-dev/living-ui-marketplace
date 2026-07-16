/**
 * CSV / XLSX import & export, done entirely client-side with SheetJS so the
 * backend stays a clean JSON API. The grid is kept 1:1 with spreadsheet cells
 * (our A1 == file A1) so formula references survive a round-trip.
 */

import * as XLSX from 'xlsx'
import type { Cell, Column, Sheet, SheetInput } from '../types'
import { DEFAULT_COL_WIDTH, colLetter, makeRef } from './grid'

const MAX_COLS = 256
const MAX_ROWS = 5000

/** Build a SheetJS worksheet from our sheet (formulas preserved as `.f`). */
function toWorksheet(sheet: Sheet): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {}
  const nCols = Math.max(sheet.columns.length, 1)
  const nRows = Math.max(sheet.numRows, 1)

  for (const [ref, cell] of Object.entries(sheet.cells)) {
    const raw = cell.raw ?? ''
    if (raw === '') continue
    const value = sheet.values[ref]

    if (raw.startsWith('=')) {
      const f = raw.slice(1)
      if (typeof value === 'number') ws[ref] = { t: 'n', v: value, f }
      else if (typeof value === 'boolean') ws[ref] = { t: 'b', v: value, f }
      else ws[ref] = { t: 's', v: value == null ? '' : String(value), f }
    } else if (typeof value === 'number') {
      ws[ref] = { t: 'n', v: value }
    } else if (typeof value === 'boolean') {
      ws[ref] = { t: 'b', v: value }
    } else {
      ws[ref] = { t: 's', v: raw }
    }
  }

  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: nRows - 1, c: nCols - 1 } })
  ws['!cols'] = sheet.columns.map((c) => ({ wpx: c.width || DEFAULT_COL_WIDTH }))
  return ws
}

function safeName(name: string): string {
  // Excel sheet names: max 31 chars, no []:*?/\
  return (name || 'Sheet').replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Sheet'
}

export function exportSheet(sheet: Sheet, format: 'csv' | 'xlsx'): void {
  const ws = toWorksheet(sheet)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, safeName(sheet.name))
  const base = (sheet.name || 'sheet').replace(/[^\w.-]+/g, '_')
  XLSX.writeFile(wb, `${base}.${format}`, { bookType: format })
}

/** Export every given sheet as one multi-tab workbook. CSV has no multi-tab
 * concept, so this is XLSX-only — CSV export stays single-sheet via {@link exportSheet}. */
export function exportWorkbook(sheets: Sheet[], format: 'xlsx'): void {
  const wb = XLSX.utils.book_new()
  for (const sheet of sheets) {
    XLSX.utils.book_append_sheet(wb, toWorksheet(sheet), safeName(sheet.name))
  }
  XLSX.writeFile(wb, `workbook.${format}`, { bookType: format })
}

/** Parse one SheetJS worksheet into a SheetInput ready for POST /api/sheets. */
function worksheetToSheetInput(ws: XLSX.WorkSheet, name: string): SheetInput {
  const cells: Record<string, Cell> = {}
  let maxCol = 0
  let maxRow = 0

  if (ws && ws['!ref']) {
    const range = XLSX.utils.decode_range(ws['!ref'])
    const endR = Math.min(range.e.r, MAX_ROWS - 1)
    const endC = Math.min(range.e.c, MAX_COLS - 1)
    for (let r = 0; r <= endR; r++) {
      for (let c = 0; c <= endC; c++) {
        const addr = XLSX.utils.encode_cell({ r, c })
        const cell = ws[addr] as XLSX.CellObject | undefined
        if (!cell) continue
        let raw: string
        if (cell.f != null && cell.f !== '') {
          raw = `=${cell.f}`
        } else if (cell.v == null) {
          continue
        } else if (cell.v instanceof Date) {
          raw = cell.v.toISOString().slice(0, 10)
        } else {
          raw = String(cell.v)
        }
        if (raw === '') continue
        // Re-key to our own A1 grid (same coordinates).
        cells[makeRef(c, r)] = { raw }
        maxCol = Math.max(maxCol, c)
        maxRow = Math.max(maxRow, r)
      }
    }
  }

  const numCols = Math.max(maxCol + 1, 1)
  const numRows = Math.max(maxRow + 1, 1)
  const columns: Column[] = Array.from({ length: numCols }, (_, i) => ({
    name: colLetter(i),
    type: 'text',
    width: DEFAULT_COL_WIDTH,
  }))

  return { name, columns, numRows, cells }
}

/**
 * Parse a CSV/XLSX File into one SheetInput per worksheet in the workbook.
 * CSV files always parse as a single-sheet workbook via SheetJS, so this
 * naturally degrades to a 1-element array for CSV — no separate code path.
 */
export async function importWorkbook(file: File): Promise<SheetInput[]> {
  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(buffer, { type: 'array' })
  const baseName = file.name.replace(/\.[^.]+$/, '') || 'Imported'
  const multiple = wb.SheetNames.length > 1

  return wb.SheetNames.map((wsName, i) =>
    worksheetToSheetInput(wb.Sheets[wsName], multiple ? (wsName || `${baseName} ${i + 1}`) : (baseName || wsName || 'Imported'))
  )
}
