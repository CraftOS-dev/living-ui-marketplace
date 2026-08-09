/**
 * apiAdapter.ts — client-side fetch shim that lets the UNCHANGED V1
 * (Python/FastAPI) Craft Sheets frontend run against the V2 PocketBase backend.
 *
 * HOW IT WORKS
 * ------------
 * On import this module sets `window.__CRAFTBOT_BACKEND_URL__` to a sentinel
 * host (`http://living-ui.local`). Every V1 module reads that global at its own
 * eval time and builds request URLs like `${BACKEND_URL}/api/...`, so all their
 * traffic is aimed at the sentinel host.
 *
 * `installApiAdapter()` monkeypatches `window.fetch`:
 *   - Requests to the sentinel host are routed to a local handler that returns
 *     a synthetic Response shaped EXACTLY like the V1 FastAPI backend.
 *   - Every other request (real same-origin `/api/collections/*`) is passed
 *     straight through to the captured original fetch (the PocketBase server).
 *   - Handlers call the captured original fetch with RELATIVE urls.
 *
 * WHERE THE WORK HAPPENS
 * ----------------------
 * V1 evaluated formulas on the Python backend (formula.py) and returned
 * `values` + `errors` on every sheet read/write. That engine is ported to
 * ./formula.ts and runs CLIENT-SIDE here — every /api/sheets response attaches
 * a fresh evaluation. CSV/XLSX import & export were already client-side
 * (SheetJS in utils/fileio.ts) and are untouched.
 *
 * A sheet is ONE `sheets` record. PocketBase record ids are strings, but the V1
 * frontend treats sheet ids as NUMBERS (localStorage `Number()` round-trip,
 * `===` matching), so each record carries an incrementing integer `sid` that is
 * exposed as `id`; the adapter translates sid ⇄ record id on every request.
 */

import { evaluateSheet, columnLetter } from './formula'

const SENTINEL = 'http://living-ui.local'

// Set the sentinel at import time so component/controller modules pick it up.
;(window as unknown as { __CRAFTBOT_BACKEND_URL__?: string }).__CRAFTBOT_BACKEND_URL__ = SENTINEL

const DEFAULT_NUM_COLS = 12
const DEFAULT_NUM_ROWS = 30

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PbRecord = Record<string, unknown>
type Dict = Record<string, unknown>

// ---------------------------------------------------------------------------
// Captured original fetch
// ---------------------------------------------------------------------------

let originalFetch: typeof window.fetch = window.fetch.bind(window)
let installed = false

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function readBody(init?: RequestInit): Dict {
  if (!init || init.body == null) return {}
  if (typeof init.body === 'string') {
    try {
      return JSON.parse(init.body) as Dict
    } catch {
      return {}
    }
  }
  return {}
}

const enc = encodeURIComponent

function toIso(v: unknown): string | null {
  if (v == null || v === '') return null
  try {
    const d = new Date(String(v).replace(' ', 'T'))
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  } catch {
    return null
  }
}

function asObject(v: unknown): Dict {
  return v != null && typeof v === 'object' ? (v as Dict) : {}
}

function defaultColumns(count = DEFAULT_NUM_COLS): Dict[] {
  return Array.from({ length: count }, (_, i) => ({ name: columnLetter(i), type: 'text', width: 120 }))
}

// ---------------------------------------------------------------------------
// PocketBase REST helpers (relative urls → PocketBase serving the page)
// ---------------------------------------------------------------------------

async function pbListAll(collection: string, query = ''): Promise<PbRecord[]> {
  const all: PbRecord[] = []
  let page = 1
  for (;;) {
    const sep = query ? '&' : ''
    let body: { items?: PbRecord[]; totalPages?: number } = {}
    try {
      const res = await originalFetch(
        `/api/collections/${collection}/records?perPage=500&page=${page}${sep}${query}`,
      )
      if (!res.ok) break
      body = (await res.json()) as { items?: PbRecord[]; totalPages?: number }
    } catch {
      break
    }
    if (Array.isArray(body.items)) all.push(...body.items)
    const totalPages = Number(body.totalPages ?? 1)
    if (!Number.isFinite(totalPages) || page >= totalPages) break
    page += 1
  }
  return all
}

async function pbCreate(collection: string, data: Dict): Promise<PbRecord | null> {
  try {
    const res = await originalFetch(`/api/collections/${collection}/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return res.ok ? ((await res.json()) as PbRecord) : null
  } catch {
    return null
  }
}

async function pbUpdate(collection: string, id: string, data: Dict): Promise<PbRecord | null> {
  try {
    const res = await originalFetch(`/api/collections/${collection}/records/${enc(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return res.ok ? ((await res.json()) as PbRecord) : null
  } catch {
    return null
  }
}

async function pbDelete(collection: string, id: string): Promise<boolean> {
  try {
    const res = await originalFetch(`/api/collections/${collection}/records/${enc(id)}`, {
      method: 'DELETE',
    })
    return res.ok
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Sheet helpers (sid ⇄ record)
// ---------------------------------------------------------------------------

async function allSheets(): Promise<PbRecord[]> {
  return pbListAll('sheets')
}

function bySid(rows: PbRecord[], sid: number): PbRecord | undefined {
  return rows.find((r) => Number(r.sid) === sid)
}

function nextSid(rows: PbRecord[]): number {
  let max = 0
  for (const r of rows) {
    const s = Number(r.sid)
    if (Number.isFinite(s) && s > max) max = s
  }
  return max + 1
}

// Sheet.to_dict() — with the exposed integer id.
function toDict(rec: PbRecord): Dict {
  return {
    id: Number(rec.sid),
    name: String(rec.name ?? ''),
    columns: Array.isArray(rec.columns) ? rec.columns : [],
    numRows: rec.num_rows == null ? 0 : Number(rec.num_rows),
    cells: asObject(rec.cells),
    rowHeights: asObject(rec.row_heights),
    frozenRows: Number(rec.frozen_rows ?? 0) || 0,
    frozenCols: Number(rec.frozen_cols ?? 0) || 0,
    position: Number(rec.position ?? 0) || 0,
    createdAt: toIso(rec.created),
    updatedAt: toIso(rec.updated),
  }
}

// sheet_with_values() — to_dict + client-side formula evaluation.
function withValues(rec: PbRecord): Dict {
  const data = toDict(rec)
  const evaluated = evaluateSheet(
    data.columns as Dict[],
    Number(data.numRows),
    data.cells as Record<string, unknown>,
  )
  data.values = evaluated.values
  data.errors = evaluated.errors
  return data
}

// Sheet.summary() — for the tab bar.
function toSummary(rec: PbRecord): Dict {
  const cols = Array.isArray(rec.columns) ? (rec.columns as unknown[]) : []
  return {
    id: Number(rec.sid),
    name: String(rec.name ?? ''),
    numCols: cols.length,
    numRows: rec.num_rows == null ? 0 : Number(rec.num_rows),
    position: Number(rec.position ?? 0) || 0,
    updatedAt: toIso(rec.updated),
  }
}

// ---------------------------------------------------------------------------
// Sheet route handlers (reproduce V1 routes.py)
// ---------------------------------------------------------------------------

async function handleListSheets(): Promise<Response> {
  const rows = await allSheets()
  rows.sort((a, b) => {
    const pa = Number(a.position ?? 0)
    const pb = Number(b.position ?? 0)
    if (pa !== pb) return pa - pb
    return Number(a.sid) - Number(b.sid)
  })
  return json(rows.map(toSummary))
}

async function handleCreateSheet(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const rows = await allSheets()

  const columns = (Array.isArray(body.columns) && body.columns.length ? (body.columns as Dict[]) : defaultColumns())
  const numRowsRaw = Number(body.numRows)
  const numRows = Number.isFinite(numRowsRaw) && numRowsRaw > 0 ? numRowsRaw : DEFAULT_NUM_ROWS

  const rec = await pbCreate('sheets', {
    sid: nextSid(rows),
    name: String(body.name ?? '') || 'Sheet 1',
    columns,
    num_rows: numRows,
    cells: asObject(body.cells),
    row_heights: asObject(body.rowHeights),
    frozen_rows: Number(body.frozenRows ?? 0) || 0,
    frozen_cols: Number(body.frozenCols ?? 0) || 0,
    position: rows.length,
  })
  if (!rec) return json({ detail: 'Failed to create sheet' }, 500)
  return json(withValues(rec))
}

async function handleGetSheet(sid: number): Promise<Response> {
  const rows = await allSheets()
  const rec = bySid(rows, sid)
  if (!rec) return json({ detail: 'Sheet not found' }, 404)
  return json(withValues(rec))
}

async function handleUpdateSheet(sid: number, init?: RequestInit): Promise<Response> {
  const rows = await allSheets()
  const rec = bySid(rows, sid)
  if (!rec) return json({ detail: 'Sheet not found' }, 404)

  const body = readBody(init)
  const columns = (Array.isArray(body.columns) && body.columns.length ? (body.columns as Dict[]) : defaultColumns())
  const numRowsRaw = Number(body.numRows)
  const numRows = Number.isFinite(numRowsRaw) && numRowsRaw > 0 ? numRowsRaw : DEFAULT_NUM_ROWS

  const updated = await pbUpdate('sheets', String(rec.id), {
    name: String(body.name ?? '') || String(rec.name ?? ''),
    columns,
    num_rows: numRows,
    cells: asObject(body.cells),
    row_heights: asObject(body.rowHeights),
    frozen_rows: Number(body.frozenRows ?? 0) || 0,
    frozen_cols: Number(body.frozenCols ?? 0) || 0,
  })
  return json(withValues(updated ?? rec))
}

async function handleDeleteSheet(sid: number): Promise<Response> {
  const rows = await allSheets()
  const rec = bySid(rows, sid)
  if (!rec) return json({ status: 'not_found', id: String(sid) })
  await pbDelete('sheets', String(rec.id))
  return json({ status: 'deleted', id: String(sid) })
}

// ---------------------------------------------------------------------------
// In-memory app state (V1 stored it in SQLite; UI never depends on persistence)
// ---------------------------------------------------------------------------

let appState: Dict = {}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function route(url: URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase()
  const path = url.pathname

  if (path === '/health') return json({ status: 'ok' })

  // Sheets collection.
  if (path === '/api/sheets') {
    if (method === 'GET') return handleListSheets()
    if (method === 'POST') return handleCreateSheet(init)
  }
  let m: RegExpMatchArray | null
  if ((m = path.match(/^\/api\/sheets\/([^/]+)$/))) {
    const sid = Number(decodeURIComponent(m[1] as string))
    if (!Number.isFinite(sid)) return json({ detail: 'Sheet not found' }, 404)
    if (method === 'GET') return handleGetSheet(sid)
    if (method === 'PUT') return handleUpdateSheet(sid, init)
    if (method === 'DELETE') return handleDeleteSheet(sid)
  }

  // Generic app state / actions.
  if (path === '/api/state') {
    if (method === 'GET') return json(appState)
    if (method === 'DELETE') {
      appState = {}
      return json({ status: 'cleared' })
    }
    const body = readBody(init)
    appState = { ...appState, ...asObject(body.data) }
    return json(appState)
  }
  if (path === '/api/state/replace') {
    appState = asObject(readBody(init).data)
    return json(appState)
  }
  if (path === '/api/action') {
    const body = readBody(init)
    const action = String(body.action ?? '')
    const payload = asObject(body.payload)
    if (action === 'reset') {
      appState = {}
      return json({ status: 'reset', data: {} })
    }
    if (action === 'increment') {
      const key = String(payload.key ?? 'counter')
      appState[key] = Number(appState[key] ?? 0) + 1
      return json({ status: 'incremented', data: appState })
    }
    if (action === 'decrement') {
      const key = String(payload.key ?? 'counter')
      appState[key] = Number(appState[key] ?? 0) - 1
      return json({ status: 'decremented', data: appState })
    }
    return json({ status: 'unknown_action', action: body.action ?? null, data: appState })
  }

  // Agent instrumentation no-ops.
  if (path === '/api/ui-snapshot') {
    if (method === 'GET') {
      return json({
        htmlStructure: null,
        visibleText: [],
        inputValues: {},
        componentState: {},
        currentView: null,
        viewport: {},
        timestamp: null,
        status: 'no_snapshot',
      })
    }
    return json({ ok: true })
  }
  if (path === '/api/ui-screenshot') {
    if (method === 'GET') {
      return json({ imageData: null, width: null, height: null, timestamp: null, status: 'no_screenshot' })
    }
    return json({ ok: true })
  }
  if (path === '/api/logs') return json({ ok: true })
  if (path === '/api/settings') {
    if (method === 'GET') return json({})
    return json(readBody(init))
  }

  // Safety net: never throw.
  if (method === 'GET') return json([])
  return json({ ok: true })
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function installApiAdapter(): void {
  if (installed) return
  installed = true
  originalFetch = window.fetch.bind(window)

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let urlStr: string
    if (typeof input === 'string') urlStr = input
    else if (input instanceof URL) urlStr = input.href
    else urlStr = input.url

    if (urlStr.startsWith(SENTINEL)) {
      let effInit = init
      if (!effInit && typeof input !== 'string' && !(input instanceof URL)) {
        effInit = { method: input.method }
      }
      try {
        const url = new URL(urlStr)
        return await route(url, effInit)
      } catch (err) {
        console.error('[apiAdapter] handler error:', err)
        return json({}, 200)
      }
    }
    return originalFetch(input as RequestInfo, init)
  }
}
