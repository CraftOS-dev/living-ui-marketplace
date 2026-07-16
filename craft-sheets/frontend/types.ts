/**
 * Craft Sheets model types — mirror the backend JSON shapes.
 */

export type ColumnType = 'text' | 'number' | 'date' | 'currency'

export type CellAlign = 'left' | 'center' | 'right'

export interface CellFormat {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  color?: string
  align?: CellAlign
  bg?: string | null
}

export interface Cell {
  raw: string
  format?: CellFormat
}

export interface Column {
  name: string
  type: ColumnType
  width: number
}

/** A full sheet as returned by GET/POST/PUT /api/sheets/{id}. */
export interface Sheet {
  id: number
  name: string
  columns: Column[]
  numRows: number
  /** Sparse map of row index (as string) -> px height. Missing = default height. */
  rowHeights: Record<string, number>
  cells: Record<string, Cell>
  /** Number of leading rows/columns pinned while scrolling (0 = none). */
  frozenRows: number
  frozenCols: number
  position: number
  createdAt?: string
  updatedAt?: string
  /** Backend-evaluated display values (number | string | boolean) per cell. */
  values: Record<string, number | string | boolean>
  /** Per-cell error codes, e.g. "#DIV/0!". */
  errors: Record<string, string>
}

/** Lightweight sheet info for the tab bar (GET /api/sheets). */
export interface SheetSummary {
  id: number
  name: string
  numCols: number
  numRows: number
  position: number
  updatedAt?: string
}

/** Shape used when creating/importing a sheet. */
export interface SheetInput {
  name: string
  columns?: Column[]
  numRows?: number
  cells?: Record<string, Cell>
}

// App-level UI state (kept minimal; backend owns the data).
export interface AppState {
  initialized: boolean
  loading: boolean
  error: string | null
  [key: string]: unknown
}
