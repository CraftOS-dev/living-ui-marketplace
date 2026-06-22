/**
 * AppController — Craft Sheets data layer.
 *
 * Thin client over the FastAPI backend, which is the source of truth for all
 * sheet data and the formula evaluator. The React view (MainView) holds only
 * ephemeral UI state (selection, editing) and calls these methods.
 */

import type { Sheet, SheetInput, SheetSummary } from './types'

const BACKEND_URL =
  (window as any).__CRAFTBOT_BACKEND_URL__ || 'http://localhost:{{BACKEND_PORT}}'

const LAST_SHEET_KEY = 'craft-sheets:lastSheetId'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const resp = await fetch(`${BACKEND_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!resp.ok) {
    throw new Error(`${options?.method || 'GET'} ${path} failed: ${resp.status} ${resp.statusText}`)
  }
  // DELETE may return a small status object; callers ignore it.
  return resp.json() as Promise<T>
}

export class AppController {
  private backendAvailable = false

  async healthCheck(): Promise<boolean> {
    try {
      const resp = await fetch(`${BACKEND_URL}/health`)
      this.backendAvailable = resp.ok
      return resp.ok
    } catch {
      this.backendAvailable = false
      return false
    }
  }

  isBackendAvailable(): boolean {
    return this.backendAvailable
  }

  async listSheets(): Promise<SheetSummary[]> {
    return request<SheetSummary[]>('/api/sheets')
  }

  async getSheet(id: number): Promise<Sheet> {
    return request<Sheet>(`/api/sheets/${id}`)
  }

  async createSheet(input: SheetInput): Promise<Sheet> {
    return request<Sheet>('/api/sheets', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  /** Persist the full sheet and return it re-evaluated by the backend. */
  async saveSheet(sheet: Sheet): Promise<Sheet> {
    const body = {
      name: sheet.name,
      columns: sheet.columns,
      numRows: sheet.numRows,
      cells: sheet.cells,
    }
    return request<Sheet>(`/api/sheets/${sheet.id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    })
  }

  async deleteSheet(id: number): Promise<void> {
    await request(`/api/sheets/${id}`, { method: 'DELETE' })
  }

  rememberLastSheet(id: number): void {
    try {
      localStorage.setItem(LAST_SHEET_KEY, String(id))
    } catch {
      /* ignore storage errors */
    }
  }

  getLastSheetId(): number | null {
    try {
      const v = localStorage.getItem(LAST_SHEET_KEY)
      return v ? Number(v) : null
    } catch {
      return null
    }
  }
}
