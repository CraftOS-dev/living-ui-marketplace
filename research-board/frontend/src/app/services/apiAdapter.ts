/**
 * apiAdapter.ts — client-side fetch shim that lets the UNCHANGED V1
 * (Python/FastAPI) Research Board frontend run against the V2 PocketBase
 * backend.
 *
 * HOW IT WORKS
 * ------------
 * On import this module sets `window.__CRAFTBOT_BACKEND_URL__` to a sentinel
 * host (`http://living-ui.local`). Every V1 module reads that global at its own
 * eval time and builds request URLs like `${BACKEND_URL}/api/...`, so all their
 * API traffic is aimed at the sentinel host.
 *
 * `installApiAdapter()` monkeypatches `window.fetch`:
 *   - Requests to the sentinel host are routed to a local handler returning a
 *     synthetic Response shaped EXACTLY like the V1 FastAPI backend.
 *   - Every other request (real same-origin `/api/collections/*`,
 *     `/api/files/*`) is passed straight through to the captured original fetch.
 *   - Handlers call the captured original fetch with RELATIVE urls.
 *
 * DATA MODEL
 * ----------
 * board_items + connections are plain collection CRUD. Uploaded media is stored
 * in an `uploads` file collection; POST /api/upload returns a filePath that is
 * the SAME-ORIGIN PocketBase file URL (`/api/files/uploads/<recordId>/<name>`).
 * The item stores that as its `url`, and the board renders it via
 * <img>/<video>/<iframe> DIRECTLY — those load same-origin from PocketBase, so
 * media never needs the fetch shim.
 *
 * Record ids are STRINGS in PocketBase (V1 used ints). The frontend uses item
 * and connection ids only opaquely (URL interpolation, React keys, Map keys,
 * `===` equality), never arithmetically, so strings pass through as `id` /
 * `sourceId` / `targetId`.
 */

const SENTINEL = 'http://living-ui.local'

// Set the sentinel at import time so component/controller modules pick it up.
;(window as unknown as { __CRAFTBOT_BACKEND_URL__?: string }).__CRAFTBOT_BACKEND_URL__ = SENTINEL

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

function nullIfEmpty(v: unknown): string | null {
  const s = v == null ? '' : String(v)
  return s === '' ? null : s
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

async function pbGet(collection: string, id: string): Promise<PbRecord | null> {
  try {
    const res = await originalFetch(`/api/collections/${collection}/records/${enc(id)}`)
    return res.ok ? ((await res.json()) as PbRecord) : null
  } catch {
    return null
  }
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

async function pbDelete(collection: string, id: string): Promise<void> {
  try {
    await originalFetch(`/api/collections/${collection}/records/${enc(id)}`, { method: 'DELETE' })
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Shape mappers (produce EXACT V1 dicts)
// ---------------------------------------------------------------------------

function toItem(rec: PbRecord): Dict {
  return {
    id: String(rec.id),
    type: String(rec.type ?? ''),
    title: String(rec.title ?? ''),
    x: Number(rec.x ?? 0),
    y: Number(rec.y ?? 0),
    content: nullIfEmpty(rec.content),
    url: nullIfEmpty(rec.url),
    filePath: nullIfEmpty(rec.file_path),
    createdAt: toIso(rec.created),
    updatedAt: toIso(rec.updated),
  }
}

function toConnection(rec: PbRecord): Dict {
  return {
    id: String(rec.id),
    sourceId: String(rec.source ?? ''),
    targetId: String(rec.target ?? ''),
    createdAt: toIso(rec.created),
  }
}

// ---------------------------------------------------------------------------
// Board item handlers
// ---------------------------------------------------------------------------

async function handleListItems(url: URL): Promise<Response> {
  const search = (url.searchParams.get('search') ?? '').toLowerCase()
  const type = url.searchParams.get('type') ?? ''

  let rows = await pbListAll('board_items')
  if (type) rows = rows.filter((r) => String(r.type ?? '') === type)
  if (search) rows = rows.filter((r) => String(r.title ?? '').toLowerCase().includes(search))
  // V1: order by created_at desc.
  rows.sort((a, b) => {
    const ca = String(a.created ?? '')
    const cb = String(b.created ?? '')
    return ca < cb ? 1 : ca > cb ? -1 : 0
  })
  return json(rows.map(toItem))
}

async function handleCreateItem(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const rec = await pbCreate('board_items', {
    type: String(body.type ?? ''),
    title: String(body.title ?? ''),
    x: body.x != null ? Number(body.x) : 0,
    y: body.y != null ? Number(body.y) : 0,
    content: body.content == null ? '' : String(body.content),
    url: body.url == null ? '' : String(body.url),
    file_path: '',
  })
  if (!rec) return json({ detail: 'Failed to create item' }, 500)
  return json(toItem(rec))
}

async function handleGetItem(id: string): Promise<Response> {
  const rec = await pbGet('board_items', id)
  if (!rec) return json({ detail: 'Item not found' }, 404)
  return json(toItem(rec))
}

async function handleUpdateItem(id: string, init?: RequestInit): Promise<Response> {
  const rec = await pbGet('board_items', id)
  if (!rec) return json({ detail: 'Item not found' }, 404)

  const body = readBody(init)
  const update: Dict = {}
  if (body.title != null) update.title = String(body.title)
  // x/y: coerce to float, ignore non-numeric (V1 get_x/get_y).
  if (body.x != null) {
    const x = Number(body.x)
    if (Number.isFinite(x)) update.x = x
  }
  if (body.y != null) {
    const y = Number(body.y)
    if (Number.isFinite(y)) update.y = y
  }
  if (body.content != null) update.content = String(body.content)
  if (body.url != null) update.url = String(body.url)
  if (body.file_path != null) update.file_path = String(body.file_path)

  const updated = Object.keys(update).length ? await pbUpdate('board_items', id, update) : rec
  return json(toItem(updated ?? rec))
}

async function handleDeleteItem(id: string): Promise<Response> {
  const rec = await pbGet('board_items', id)
  if (!rec) return json({ detail: 'Item not found' }, 404)
  await pbDelete('board_items', id)
  return json({ status: 'deleted', id })
}

// ---------------------------------------------------------------------------
// Upload → uploads file collection (served same-origin)
// ---------------------------------------------------------------------------

async function handleUpload(init?: RequestInit): Promise<Response> {
  const body = init?.body
  if (!(body instanceof FormData)) {
    return json({ filePath: null, fileName: null, contentType: null, error: 'No file provided' })
  }
  const file = body.get('file')
  if (!(file instanceof File) || !file.name) {
    return json({ filePath: null, fileName: null, contentType: null, error: 'No file provided' })
  }

  const form = new FormData()
  form.append('file', file, file.name)
  form.append('filename', file.name)

  let rec: PbRecord | null = null
  try {
    const res = await originalFetch('/api/collections/uploads/records', { method: 'POST', body: form })
    rec = res.ok ? ((await res.json()) as PbRecord) : null
  } catch {
    rec = null
  }
  if (!rec) return json({ detail: 'File upload failed' }, 500)

  const stored = String(rec.file ?? '')
  const filePath = `/api/files/uploads/${String(rec.id)}/${stored}`
  return json({ filePath, fileName: file.name, contentType: file.type || null })
}

// ---------------------------------------------------------------------------
// Connection handlers
// ---------------------------------------------------------------------------

async function handleListConnections(): Promise<Response> {
  const rows = await pbListAll('connections')
  return json(rows.map(toConnection))
}

async function handleCreateConnection(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const source = String(body.source_id ?? '')
  const target = String(body.target_id ?? '')

  // Dedup: return the existing connection if one already links these two.
  const rows = await pbListAll('connections')
  const existing = rows.find((r) => String(r.source ?? '') === source && String(r.target ?? '') === target)
  if (existing) return json(toConnection(existing))

  const rec = await pbCreate('connections', { source, target })
  if (!rec) return json({ detail: 'Failed to create connection' }, 500)
  return json(toConnection(rec))
}

async function handleDeleteConnection(id: string): Promise<Response> {
  const rec = await pbGet('connections', id)
  if (!rec) return json({ detail: 'Connection not found' }, 404)
  await pbDelete('connections', id)
  return json({ status: 'deleted', id })
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

  // ---- Board items --------------------------------------------------------
  if (path === '/api/items') {
    if (method === 'GET') return handleListItems(url)
    if (method === 'POST') return handleCreateItem(init)
  }
  let m: RegExpMatchArray | null
  if ((m = path.match(/^\/api\/items\/([^/]+)$/))) {
    const id = decodeURIComponent(m[1] as string)
    if (method === 'GET') return handleGetItem(id)
    if (method === 'PUT') return handleUpdateItem(id, init)
    if (method === 'DELETE') return handleDeleteItem(id)
  }

  // ---- Upload -------------------------------------------------------------
  if (path === '/api/upload' && method === 'POST') return handleUpload(init)

  // ---- Connections --------------------------------------------------------
  if (path === '/api/connections') {
    if (method === 'GET') return handleListConnections()
    if (method === 'POST') return handleCreateConnection(init)
  }
  if ((m = path.match(/^\/api\/connections\/([^/]+)$/)) && method === 'DELETE') {
    return handleDeleteConnection(decodeURIComponent(m[1] as string))
  }

  // ---- Generic app state / actions ----------------------------------------
  if (path === '/api/state') {
    if (method === 'GET') return json(appState)
    if (method === 'DELETE') {
      appState = {}
      return json({ status: 'cleared' })
    }
    const body = readBody(init)
    const data = body.data != null && typeof body.data === 'object' ? (body.data as Dict) : {}
    appState = { ...appState, ...data }
    return json(appState)
  }
  if (path === '/api/state/replace') {
    const body = readBody(init)
    appState = body.data != null && typeof body.data === 'object' ? (body.data as Dict) : {}
    return json(appState)
  }
  if (path === '/api/action') {
    const body = readBody(init)
    if (String(body.action ?? '') === 'reset') {
      appState = {}
      return json({ status: 'reset', data: {} })
    }
    return json({ status: 'unknown_action', action: body.action ?? null, data: appState })
  }

  // ---- Agent instrumentation no-ops ---------------------------------------
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
