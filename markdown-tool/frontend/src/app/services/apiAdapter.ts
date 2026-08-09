/**
 * apiAdapter.ts — client-side fetch shim that lets the UNCHANGED V1
 * (Python/FastAPI) Markdown Editor frontend run against the V2 PocketBase
 * backend.
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
 *     straight through to the captured original fetch, which hits the
 *     PocketBase server that serves the page.
 *   - Handlers themselves call the captured original fetch with RELATIVE urls
 *     so they reach that same PocketBase server.
 *
 * THE WORKSPACE IS A VIRTUAL FILESYSTEM
 * -------------------------------------
 * V1 stored files on disk. V2 has no arbitrary server filesystem, so each file
 * or folder is one `nodes` record (path / parent / name / is_dir / content /
 * modified). The V1 /api/files* endpoints (list / read / write / create /
 * rename / delete / upload) are reproduced here against that collection's plain
 * REST CRUD. The editor session (open tabs, panel layout) is a single
 * `sessions` record. Generic app state is kept in-memory (V1 stored it in
 * SQLite but nothing in the UI depends on it persisting).
 */

const SENTINEL = 'http://living-ui.local'

// Set the sentinel at import time so component/controller modules pick it up.
;(window as unknown as { __CRAFTBOT_BACKEND_URL__?: string }).__CRAFTBOT_BACKEND_URL__ = SENTINEL

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PbRecord = Record<string, unknown>

interface FileItem {
  name: string
  path: string
  is_dir: boolean
  is_markdown: boolean
  modified: number
}

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

function readBody(init?: RequestInit): Record<string, unknown> {
  if (!init || init.body == null) return {}
  if (typeof init.body === 'string') {
    try {
      return JSON.parse(init.body) as Record<string, unknown>
    } catch {
      return {}
    }
  }
  return {}
}

const enc = encodeURIComponent

function asObject(v: unknown): Record<string, unknown> {
  return v != null && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}

function nowSeconds(): number {
  return Date.now() / 1000
}

function parentOf(path: string): string {
  return path.includes('/') ? path.split('/').slice(0, -1).join('/') : ''
}

function nameOf(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] ?? path
}

function isMarkdownName(name: string): boolean {
  return name.toLowerCase().endsWith('.md')
}

// ---------------------------------------------------------------------------
// PocketBase REST helpers (relative urls → PocketBase serving the page)
// ---------------------------------------------------------------------------

async function pbListAll(collection: string, query = ''): Promise<PbRecord[]> {
  const all: PbRecord[] = []
  let page = 1
  // Paginate until we've pulled every record (workspaces are small).
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

async function pbCreate(collection: string, data: Record<string, unknown>): Promise<PbRecord | null> {
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

async function pbUpdate(
  collection: string,
  id: string,
  data: Record<string, unknown>,
): Promise<PbRecord | null> {
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
// Node (virtual filesystem) helpers
// ---------------------------------------------------------------------------

async function allNodes(): Promise<PbRecord[]> {
  return pbListAll('nodes')
}

function nodePath(rec: PbRecord): string {
  return String(rec.path ?? '')
}

function findByPath(nodes: PbRecord[], path: string): PbRecord | undefined {
  return nodes.find((n) => nodePath(n) === path)
}

function toFileItem(rec: PbRecord): FileItem {
  const path = nodePath(rec)
  const isDir = Boolean(rec.is_dir)
  const name = String(rec.name ?? nameOf(path))
  return {
    name,
    path,
    is_dir: isDir,
    is_markdown: !isDir && isMarkdownName(name),
    modified: Number(rec.modified ?? 0),
  }
}

// Create any missing ancestor DIRECTORY nodes for a given directory path.
// e.g. ensureDirs("a/b") creates "a" and "a/b" as dir nodes if absent.
async function ensureDirs(dirPath: string, nodes: PbRecord[]): Promise<void> {
  if (!dirPath) return
  const segments = dirPath.split('/').filter(Boolean)
  let prefix = ''
  for (const seg of segments) {
    prefix = prefix ? `${prefix}/${seg}` : seg
    if (!findByPath(nodes, prefix)) {
      const created = await pbCreate('nodes', {
        path: prefix,
        parent: parentOf(prefix),
        name: seg,
        is_dir: true,
        content: '',
        modified: nowSeconds(),
      })
      if (created) nodes.push(created)
    }
  }
}

// ---------------------------------------------------------------------------
// File handlers (reproduce V1 routes.py exactly)
// ---------------------------------------------------------------------------

async function handleListFiles(path: string): Promise<Response> {
  const nodes = await allNodes()
  const items = nodes
    .filter((n) => String(n.parent ?? '') === path)
    .map(toFileItem)
  // V1: directories first, then case-insensitive name.
  items.sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1
    const an = a.name.toLowerCase()
    const bn = b.name.toLowerCase()
    return an < bn ? -1 : an > bn ? 1 : 0
  })
  return json(items)
}

async function handleReadFile(path: string): Promise<Response> {
  const nodes = await allNodes()
  const rec = findByPath(nodes, path)
  if (!rec) return json({ detail: 'File not found' }, 404)
  if (rec.is_dir) return json({ detail: 'Path is not a file' }, 400)
  return json({
    path,
    name: String(rec.name ?? nameOf(path)),
    content: String(rec.content ?? ''),
    modified: Number(rec.modified ?? 0),
  })
}

async function handleWriteFile(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const path = String(body.path ?? '')
  const content = String(body.content ?? '')
  if (!path) return json({ detail: 'path required' }, 400)

  const nodes = await allNodes()
  const existing = findByPath(nodes, path)
  if (existing && !existing.is_dir) {
    await pbUpdate('nodes', String(existing.id), { content, modified: nowSeconds() })
  } else if (!existing) {
    // V1 write creates parent dirs + the file when absent.
    await ensureDirs(parentOf(path), nodes)
    await pbCreate('nodes', {
      path,
      parent: parentOf(path),
      name: nameOf(path),
      is_dir: false,
      content,
      modified: nowSeconds(),
    })
  }
  return json({ status: 'saved', path })
}

async function handleCreateItem(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const path = String(body.path ?? '')
  const type = body.type === 'directory' ? 'directory' : 'file'
  if (!path) return json({ detail: 'path required' }, 400)

  const nodes = await allNodes()
  if (findByPath(nodes, path)) return json({ detail: 'Already exists' }, 409)

  await ensureDirs(parentOf(path), nodes)
  await pbCreate('nodes', {
    path,
    parent: parentOf(path),
    name: nameOf(path),
    is_dir: type === 'directory',
    content: '',
    modified: nowSeconds(),
  })
  return json({ status: 'created', path, type })
}

async function handleRenameItem(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const oldPath = String(body.old_path ?? '')
  const newPath = String(body.new_path ?? '')
  if (!oldPath || !newPath) return json({ detail: 'old_path and new_path required' }, 400)

  const nodes = await allNodes()
  const src = findByPath(nodes, oldPath)
  if (!src) return json({ detail: 'Source not found' }, 404)
  if (findByPath(nodes, newPath)) return json({ detail: 'Destination already exists' }, 409)

  await ensureDirs(parentOf(newPath), nodes)

  // Move the node itself plus (for a directory) every descendant, rewriting the
  // old path prefix to the new one. Mirrors src.rename(dst) on a subtree.
  const prefix = `${oldPath}/`
  const affected = nodes.filter(
    (n) => nodePath(n) === oldPath || nodePath(n).startsWith(prefix),
  )
  for (const n of affected) {
    const p = nodePath(n)
    const nextPath = p === oldPath ? newPath : newPath + p.slice(oldPath.length)
    await pbUpdate('nodes', String(n.id), {
      path: nextPath,
      parent: parentOf(nextPath),
      name: nameOf(nextPath),
    })
  }
  return json({ status: 'renamed', old_path: oldPath, new_path: newPath })
}

async function handleDeleteItem(path: string): Promise<Response> {
  if (!path) return json({ detail: 'path query parameter required' }, 400)
  const nodes = await allNodes()
  const target = findByPath(nodes, path)
  if (!target) return json({ status: 'not_found', path })

  const prefix = `${path}/`
  const affected = nodes.filter((n) => nodePath(n) === path || nodePath(n).startsWith(prefix))
  for (const n of affected) {
    await pbDelete('nodes', String(n.id))
  }
  return json({ status: 'deleted', path })
}

async function handleUpload(init?: RequestInit): Promise<Response> {
  const body = init?.body
  if (!(body instanceof FormData)) {
    return json({ detail: 'No files provided' }, 400)
  }

  const files = body.getAll('files').filter((f): f is File => f instanceof File)
  const relPaths = body.getAll('relative_paths').map((v) => String(v))
  const parentPath = String(body.get('parent_path') ?? '')
  const overwrite = String(body.get('overwrite') ?? 'false') === 'true'

  if (files.length === 0) return json({ detail: 'No files provided' }, 400)
  if (files.length !== relPaths.length) {
    return json({ detail: 'files and relative_paths length mismatch' }, 400)
  }

  // Resolve full workspace paths.
  const resolved: { fullRel: string; file: File }[] = []
  for (let i = 0; i < files.length; i++) {
    const rel = (relPaths[i] ?? '').trim()
    if (!rel) return json({ detail: 'Empty relative path' }, 400)
    const fullRel = parentPath ? `${parentPath.replace(/\/+$/, '')}/${rel}` : rel
    resolved.push({ fullRel, file: files[i] as File })
  }

  const nodes = await allNodes()

  if (!overwrite) {
    const conflicts = resolved
      .filter((r) => findByPath(nodes, r.fullRel))
      .map((r) => r.fullRel)
    if (conflicts.length > 0) return json({ detail: { conflicts } }, 409)
  }

  const written: string[] = []
  for (const { fullRel, file } of resolved) {
    const content = await file.text()
    await ensureDirs(parentOf(fullRel), nodes)
    const existing = findByPath(nodes, fullRel)
    if (existing && !existing.is_dir) {
      await pbUpdate('nodes', String(existing.id), { content, modified: nowSeconds() })
    } else if (!existing) {
      const created = await pbCreate('nodes', {
        path: fullRel,
        parent: parentOf(fullRel),
        name: nameOf(fullRel),
        is_dir: false,
        content,
        modified: nowSeconds(),
      })
      if (created) nodes.push(created)
    }
    written.push(fullRel)
  }
  return json({ status: 'uploaded', written })
}

// ---------------------------------------------------------------------------
// Editor session (single `sessions` record)
// ---------------------------------------------------------------------------

const SESSION_DEFAULTS = {
  open_tabs: [] as unknown[],
  active_tab: '',
  folder_panel_width: 240,
  preview_panel_width: 380,
  folder_visible: true,
  preview_visible: true,
  expanded_dirs: [] as unknown[],
}

let sessionPromise: Promise<PbRecord | null> | null = null

async function resolveSessionRecord(): Promise<PbRecord | null> {
  const rows = await pbListAll('sessions')
  const first = rows[0]
  if (first) return first
  return pbCreate('sessions', { ...SESSION_DEFAULTS })
}

function ensureSessionRecord(): Promise<PbRecord | null> {
  // Memoized + serialized so concurrent callers (React StrictMode, restore +
  // debounced saves) never create duplicate session rows.
  if (!sessionPromise) sessionPromise = resolveSessionRecord()
  return sessionPromise
}

function toSessionDict(rec: PbRecord): Record<string, unknown> {
  return {
    openTabs: Array.isArray(rec.open_tabs) ? rec.open_tabs : [],
    activeTab: rec.active_tab ? String(rec.active_tab) : null,
    folderPanelWidth: Number(rec.folder_panel_width ?? 240) || 240,
    previewPanelWidth: Number(rec.preview_panel_width ?? 380) || 380,
    folderVisible: rec.folder_visible !== false,
    previewVisible: rec.preview_visible !== false,
    expandedDirs: Array.isArray(rec.expanded_dirs) ? rec.expanded_dirs : [],
    updatedAt: rec.updated ? String(rec.updated) : null,
  }
}

async function handleGetSession(): Promise<Response> {
  const rec = await ensureSessionRecord()
  if (!rec) return json(toSessionDict({ ...SESSION_DEFAULTS }))
  return json(toSessionDict(rec))
}

async function handlePutSession(init?: RequestInit): Promise<Response> {
  const patch = readBody(init)
  const rec = await ensureSessionRecord()
  if (!rec) return json(toSessionDict({ ...SESSION_DEFAULTS }))

  const update: Record<string, unknown> = {}
  if ('openTabs' in patch) update.open_tabs = patch.openTabs
  if ('activeTab' in patch) update.active_tab = patch.activeTab == null ? '' : String(patch.activeTab)
  if ('folderPanelWidth' in patch) update.folder_panel_width = patch.folderPanelWidth
  if ('previewPanelWidth' in patch) update.preview_panel_width = patch.previewPanelWidth
  if ('folderVisible' in patch) update.folder_visible = patch.folderVisible
  if ('previewVisible' in patch) update.preview_visible = patch.previewVisible
  if ('expandedDirs' in patch) update.expanded_dirs = patch.expandedDirs

  let next: PbRecord | null = rec
  if (Object.keys(update).length > 0) {
    next = await pbUpdate('sessions', String(rec.id), update)
    if (next) sessionPromise = Promise.resolve(next)
  }
  return json(toSessionDict(next ?? rec))
}

// ---------------------------------------------------------------------------
// In-memory app state (V1 stored it in SQLite; UI only needs a stable object)
// ---------------------------------------------------------------------------

let appState: Record<string, unknown> = {}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function route(url: URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase()
  const path = url.pathname
  const params = url.searchParams

  // Health
  if (path === '/health') return json({ status: 'ok' })

  // Generic app state / actions
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
    if (String(body.action ?? '') === 'reset') {
      appState = {}
      return json({ status: 'reset', data: {} })
    }
    return json({ status: 'unknown_action', action: body.action ?? null, data: appState })
  }

  // Agent instrumentation no-ops (must return valid 200 shapes on the load path)
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

  // ---- Workspace file ops -------------------------------------------------
  if (path === '/api/files' && method === 'GET') {
    return handleListFiles(params.get('path') ?? '')
  }
  if (path === '/api/files/read' && method === 'GET') {
    return handleReadFile(params.get('path') ?? '')
  }
  if (path === '/api/files/write' && method === 'PUT') return handleWriteFile(init)
  if (path === '/api/files/create' && method === 'POST') return handleCreateItem(init)
  if (path === '/api/files/upload' && method === 'POST') return handleUpload(init)
  if (path === '/api/files/rename' && method === 'PUT') return handleRenameItem(init)
  if (path === '/api/files/delete' && method === 'DELETE') {
    return handleDeleteItem(params.get('path') ?? '')
  }

  // ---- Editor session -----------------------------------------------------
  if (path === '/api/session') {
    if (method === 'GET') return handleGetSession()
    if (method === 'PUT') return handlePutSession(init)
  }

  // Safety net: never throw. Array for list-ish paths, object otherwise.
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
      // Merge method/body from a Request object when one was passed.
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
