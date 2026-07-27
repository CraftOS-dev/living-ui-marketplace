/**
 * apiAdapter.ts — client-side fetch shim that lets the UNCHANGED V1
 * (Python/FastAPI) Kanban Board frontend run against the V2 PocketBase backend.
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
 *   - Every other request (real same-origin `/api/collections/*` and
 *     `/api/ops/*`) is passed straight through to the captured original fetch,
 *     which hits the PocketBase server that serves the page.
 *   - Handlers themselves call the captured original fetch with RELATIVE urls
 *     so they reach that same PocketBase server.
 *
 * SHAPE SYNTHESIS NOTES (where PocketBase can't reproduce V1 exactly)
 * ------------------------------------------------------------------
 *   - Record ids are STRINGS in PocketBase (V1 used ints). The V1 frontend only
 *     uses ids as opaque keys / URL params / Set members / `===` comparisons, so
 *     strings are safe end-to-end; we never coerce them to numbers.
 *   - Checklist items were their own V1 table (stable int ids). In V2 they live
 *     as a JSON array `[{text,done}]` on the card, with no per-item id. We expose
 *     a synthetic id `"{cardId}_{index}"` so the V1 checklist PUT/DELETE routes
 *     (which carry only an item id) can locate both the owning card and the
 *     array slot. The V1 UI always refetches the card after a checklist edit, so
 *     index churn is invisible.
 *   - `/api/ops/cards/clear-archived` exists on the V2 backend but the V1
 *     frontend never calls it (archiving is done via `PUT /api/cards/{id}`), so
 *     there is no V1 path to route it to.
 */

const SENTINEL = 'http://living-ui.local'

// Set the sentinel at import time so component modules pick it up on eval.
;(window as unknown as { __CRAFTBOT_BACKEND_URL__?: string }).__CRAFTBOT_BACKEND_URL__ = SENTINEL

const CREATED_AT = '2024-01-01T00:00:00Z'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PbRecord = Record<string, unknown>

interface ChecklistEntry {
  text: string
  done: boolean
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
    try { return JSON.parse(init.body) as Record<string, unknown> } catch { return {} }
  }
  return {}
}

const enc = encodeURIComponent

function coerceBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  const s = String(v ?? '').toLowerCase()
  return s === 'true' || s === '1'
}

// Normalise a PocketBase date/autodate string ("YYYY-MM-DD HH:MM:SS.sssZ" or
// ISO) to an ISO-8601 string, or null when empty/invalid.
function toIso(v: unknown): string | null {
  if (v == null || v === '') return null
  try {
    const d = new Date(String(v).replace(' ', 'T'))
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  } catch { return null }
}

// ---------------------------------------------------------------------------
// PocketBase REST helpers (relative urls → PocketBase serving the page)
// ---------------------------------------------------------------------------

async function pbList(collection: string, query = ''): Promise<PbRecord[]> {
  try {
    const res = await originalFetch(`/api/collections/${collection}/records?${query}`)
    if (!res.ok) return []
    const body = (await res.json()) as { items?: PbRecord[] }
    return Array.isArray(body.items) ? body.items : []
  } catch { return [] }
}

async function pbGet(collection: string, id: string, query = ''): Promise<PbRecord | null> {
  try {
    const q = query ? `?${query}` : ''
    const res = await originalFetch(`/api/collections/${collection}/records/${id}${q}`)
    return res.ok ? ((await res.json()) as PbRecord) : null
  } catch { return null }
}

async function pbCreate(collection: string, data: Record<string, unknown>): Promise<PbRecord | null> {
  try {
    const res = await originalFetch(`/api/collections/${collection}/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return res.ok ? ((await res.json()) as PbRecord) : null
  } catch { return null }
}

async function pbPatch(collection: string, id: string, data: Record<string, unknown>): Promise<PbRecord | null> {
  try {
    const res = await originalFetch(`/api/collections/${collection}/records/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return res.ok ? ((await res.json()) as PbRecord) : null
  } catch { return null }
}

async function pbDelete(collection: string, id: string): Promise<void> {
  try {
    await originalFetch(`/api/collections/${collection}/records/${id}`, { method: 'DELETE' })
  } catch { /* ignore */ }
}

// Renumber every record in a parent group to 0..n by current position order.
async function renumber(collection: string, parentField: string, parentId: string): Promise<void> {
  const items = await pbList(collection, `filter=${enc(`${parentField}='${parentId}'`)}&sort=position&perPage=500`)
  for (let i = 0; i < items.length; i++) {
    if (Number(items[i].position) !== i) await pbPatch(collection, String(items[i].id), { position: i })
  }
}

// Insert `movingId` at `pos` among its siblings, then renumber the whole group.
async function reorder(
  collection: string, parentField: string, parentId: string, movingId: string, pos: number,
): Promise<void> {
  const siblings = await pbList(
    collection,
    `filter=${enc(`${parentField}='${parentId}' && id!='${movingId}'`)}&sort=position&perPage=500`,
  )
  const ordered: PbRecord[] = siblings.slice()
  const insertAt = Math.min(Math.max(0, pos), ordered.length)
  ordered.splice(insertAt, 0, { id: movingId } as PbRecord)
  for (let i = 0; i < ordered.length; i++) {
    await pbPatch(collection, String(ordered[i].id), { position: i })
  }
}

// ---------------------------------------------------------------------------
// Shape mappers (produce EXACT V1 FastAPI dicts)
// ---------------------------------------------------------------------------

function toLabel(rec: PbRecord): Record<string, unknown> {
  return {
    id: String(rec.id),
    boardId: String(rec.board ?? ''),
    name: String(rec.name ?? ''),
    color: String(rec.color ?? ''),
  }
}

function checklistOf(rec: PbRecord): ChecklistEntry[] {
  const raw = rec.checklist
  if (!Array.isArray(raw)) return []
  return raw.map((it) => ({
    text: String((it as Record<string, unknown>)?.text ?? ''),
    done: Boolean((it as Record<string, unknown>)?.done),
  }))
}

function toCard(rec: PbRecord): Record<string, unknown> {
  const cardId = String(rec.id)
  const expandLabels = (rec.expand as Record<string, unknown> | undefined)?.labels
  const labels = Array.isArray(expandLabels) ? (expandLabels as PbRecord[]).map(toLabel) : []
  const checklist = checklistOf(rec)
  const createdAt = toIso(rec.created) ?? CREATED_AT
  const checklistItems = checklist.map((it, idx) => ({
    id: `${cardId}_${idx}`,
    cardId,
    text: it.text,
    completed: it.done,
    position: idx,
    createdAt,
  }))
  return {
    id: cardId,
    listId: String(rec.list ?? ''),
    title: String(rec.title ?? ''),
    description: rec.description ? String(rec.description) : null,
    priority: String(rec.priority || 'none'),
    dueDate: toIso(rec.due_date),
    position: Number(rec.position ?? 0),
    archived: Boolean(rec.archived),
    labels,
    checklistItems,
    checklistTotal: checklist.length,
    checklistCompleted: checklist.filter((it) => it.done).length,
    createdAt,
    updatedAt: toIso(rec.updated) ?? createdAt,
  }
}

function toList(rec: PbRecord, cards?: Record<string, unknown>[]): Record<string, unknown> {
  const createdAt = toIso(rec.created) ?? CREATED_AT
  const out: Record<string, unknown> = {
    id: String(rec.id),
    boardId: String(rec.board ?? ''),
    title: String(rec.title ?? ''),
    position: Number(rec.position ?? 0),
    createdAt,
    updatedAt: toIso(rec.updated) ?? createdAt,
  }
  if (cards) out.cards = cards
  return out
}

function toBoardBasic(rec: PbRecord): Record<string, unknown> {
  const createdAt = toIso(rec.created) ?? CREATED_AT
  return {
    id: String(rec.id),
    name: String(rec.name ?? ''),
    createdAt,
    updatedAt: toIso(rec.updated) ?? createdAt,
  }
}

// ---------------------------------------------------------------------------
// Board handlers
// ---------------------------------------------------------------------------

async function handleBoardsList(): Promise<Response> {
  const rows = await pbList('boards', 'sort=created&perPage=200')
  return json(rows.map(toBoardBasic))
}

async function handleBoardCreate(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const name = String(body.name ?? 'Untitled')
  const board = await pbCreate('boards', { name })
  if (!board) return json({ detail: 'failed to create board' }, 500)
  const boardId = String(board.id)
  const lists: Record<string, unknown>[] = []
  const titles = ['To Do', 'In Progress', 'Done']
  for (let i = 0; i < titles.length; i++) {
    const lst = await pbCreate('lists', { board: boardId, title: titles[i], position: i })
    if (lst) lists.push(toList(lst, []))
  }
  return json({ ...toBoardBasic(board), lists, labels: [] })
}

async function buildNestedBoard(boardId: string): Promise<Record<string, unknown>> {
  const board = await pbGet('boards', boardId)
  if (!board) return { id: boardId, name: '', createdAt: CREATED_AT, updatedAt: CREATED_AT, lists: [], labels: [] }

  const listRows = await pbList('lists', `filter=${enc(`board='${boardId}'`)}&sort=position&perPage=200`)
  const labelRows = await pbList('labels', `filter=${enc(`board='${boardId}'`)}&perPage=200`)

  let cardRows: PbRecord[] = []
  if (listRows.length > 0) {
    const listClause = listRows.map((l) => `list='${String(l.id)}'`).join(' || ')
    cardRows = await pbList(
      'cards',
      `filter=${enc(`(${listClause}) && archived=false`)}&sort=position&perPage=500&expand=labels`,
    )
  }

  const cardsByList = new Map<string, Record<string, unknown>[]>()
  for (const c of cardRows) {
    const lid = String(c.list ?? '')
    if (!cardsByList.has(lid)) cardsByList.set(lid, [])
    cardsByList.get(lid)!.push(toCard(c))
  }

  const lists = listRows.map((l) => toList(l, cardsByList.get(String(l.id)) ?? []))
  return { ...toBoardBasic(board), lists, labels: labelRows.map(toLabel) }
}

async function handleBoardGet(boardId: string): Promise<Response> {
  return json(await buildNestedBoard(boardId))
}

async function handleBoardUpdate(boardId: string, init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const updated = ('name' in body)
    ? await pbPatch('boards', boardId, { name: String(body.name ?? '') })
    : await pbGet('boards', boardId)
  return json(updated ? toBoardBasic(updated) : { id: boardId, name: '', createdAt: CREATED_AT, updatedAt: CREATED_AT })
}

async function handleBoardLabels(boardId: string): Promise<Response> {
  const rows = await pbList('labels', `filter=${enc(`board='${boardId}'`)}&perPage=200`)
  return json(rows.map(toLabel))
}

// ---------------------------------------------------------------------------
// List handlers
// ---------------------------------------------------------------------------

async function handleListCreate(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const boardId = String(body.board_id ?? '')
  const title = String(body.title ?? '')
  const existing = await pbList('lists', `filter=${enc(`board='${boardId}'`)}&perPage=200`)
  const position = body.position != null ? Number(body.position) : existing.length
  const created = await pbCreate('lists', { board: boardId, title, position })
  if (!created) return json({ detail: 'failed to create list' }, 500)
  return json(toList(created))
}

async function handleListUpdate(listId: string, init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const lst = await pbGet('lists', listId)
  if (!lst) return json({ id: listId, boardId: '', title: '', position: 0, createdAt: CREATED_AT, updatedAt: CREATED_AT })
  if ('title' in body && body.title != null) await pbPatch('lists', listId, { title: String(body.title) })
  if ('position' in body && body.position != null) {
    const pos = parseInt(String(body.position), 10)
    if (!Number.isNaN(pos)) await reorder('lists', 'board', String(lst.board ?? ''), listId, pos)
  }
  const updated = await pbGet('lists', listId)
  return json(toList(updated ?? lst))
}

async function handleListDelete(listId: string): Promise<Response> {
  await pbDelete('lists', listId)
  return json({ status: 'deleted', id: listId })
}

// ---------------------------------------------------------------------------
// Card handlers
// ---------------------------------------------------------------------------

async function handleCardCreate(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const listId = String(body.list_id ?? '')
  const existing = await pbList('cards', `filter=${enc(`list='${listId}'`)}&perPage=500`)
  const created = await pbCreate('cards', {
    list: listId,
    title: String(body.title ?? ''),
    description: body.description == null ? '' : String(body.description),
    priority: String(body.priority || 'none'),
    due_date: body.due_date ? String(body.due_date) : '',
    position: existing.length,
    archived: false,
    labels: [],
    checklist: [],
  })
  if (!created) return json({ detail: 'failed to create card' }, 500)
  return json(toCard(created))
}

async function handleCardGet(cardId: string): Promise<Response> {
  const card = await pbGet('cards', cardId, 'expand=labels')
  if (!card) return json({ detail: 'Card not found' }, 404)
  return json(toCard(card))
}

async function handleCardUpdate(cardId: string, init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const patch: Record<string, unknown> = {}
  if ('title' in body && body.title != null) patch.title = String(body.title)
  if ('description' in body) patch.description = body.description == null ? '' : String(body.description)
  if ('priority' in body && body.priority != null) patch.priority = String(body.priority || 'none')
  if ('due_date' in body) patch.due_date = body.due_date ? String(body.due_date) : ''
  if ('archived' in body) patch.archived = coerceBool(body.archived)
  if (Object.keys(patch).length > 0) await pbPatch('cards', cardId, patch)
  const card = await pbGet('cards', cardId, 'expand=labels')
  if (!card) return json({ detail: 'Card not found' }, 404)
  return json(toCard(card))
}

async function handleCardDelete(cardId: string): Promise<Response> {
  await pbDelete('cards', cardId)
  return json({ status: 'deleted', id: cardId })
}

async function handleCardMove(cardId: string, init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const card = await pbGet('cards', cardId)
  if (!card) return json({ detail: 'Card not found' }, 404)
  const oldList = String(card.list ?? '')
  const targetList = String(body.list_id ?? oldList)
  const pos = Number(body.position ?? 0)

  if (targetList !== oldList) await pbPatch('cards', cardId, { list: targetList })
  await reorder('cards', 'list', targetList, cardId, pos)
  if (targetList !== oldList) await renumber('cards', 'list', oldList)

  const updated = await pbGet('cards', cardId, 'expand=labels')
  return json(toCard(updated ?? card))
}

// ---------------------------------------------------------------------------
// Label handlers
// ---------------------------------------------------------------------------

async function handleLabelCreate(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const created = await pbCreate('labels', {
    board: String(body.board_id ?? ''),
    name: String(body.name ?? ''),
    color: String(body.color ?? ''),
  })
  if (!created) return json({ detail: 'failed to create label' }, 500)
  return json(toLabel(created))
}

async function handleLabelUpdate(labelId: string, init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const patch: Record<string, unknown> = {}
  if ('name' in body && body.name != null) patch.name = String(body.name)
  if ('color' in body && body.color != null) patch.color = String(body.color)
  const updated = Object.keys(patch).length > 0
    ? await pbPatch('labels', labelId, patch)
    : await pbGet('labels', labelId)
  return json(updated ? toLabel(updated) : { id: labelId, boardId: '', name: '', color: '' })
}

async function handleLabelDelete(labelId: string): Promise<Response> {
  await pbDelete('labels', labelId)
  return json({ status: 'deleted', id: labelId })
}

async function handleLabelAssign(cardId: string, labelId: string): Promise<Response> {
  const card = await pbGet('cards', cardId)
  if (card) {
    const labels = Array.isArray(card.labels) ? (card.labels as unknown[]).map(String) : []
    if (!labels.includes(labelId)) {
      labels.push(labelId)
      await pbPatch('cards', cardId, { labels })
    }
  }
  return json({ status: 'assigned', cardId, labelId })
}

async function handleLabelRemove(cardId: string, labelId: string): Promise<Response> {
  const card = await pbGet('cards', cardId)
  if (card) {
    const labels = Array.isArray(card.labels) ? (card.labels as unknown[]).map(String) : []
    const next = labels.filter((l) => l !== labelId)
    if (next.length !== labels.length) await pbPatch('cards', cardId, { labels: next })
  }
  return json({ status: 'removed', cardId, labelId })
}

// ---------------------------------------------------------------------------
// Checklist handlers (stored as a JSON array on the card)
// ---------------------------------------------------------------------------

// item id encodes owning card + array index: "{cardId}_{index}"
function parseChecklistId(itemId: string): { cardId: string; index: number } {
  const cut = itemId.lastIndexOf('_')
  if (cut < 0) return { cardId: itemId, index: -1 }
  return { cardId: itemId.slice(0, cut), index: Number(itemId.slice(cut + 1)) }
}

async function handleChecklistCreate(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const cardId = String(body.card_id ?? '')
  const text = String(body.text ?? '')
  const card = await pbGet('cards', cardId)
  if (!card) return json({ detail: 'Card not found' }, 404)
  const list = checklistOf(card)
  list.push({ text, done: false })
  await pbPatch('cards', cardId, { checklist: list })
  const idx = list.length - 1
  return json({
    id: `${cardId}_${idx}`,
    cardId,
    text,
    completed: false,
    position: idx,
    createdAt: new Date().toISOString(),
  })
}

async function handleChecklistUpdate(itemId: string, init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const { cardId, index } = parseChecklistId(itemId)
  const card = await pbGet('cards', cardId)
  if (!card) return json({ detail: 'Checklist item not found' }, 404)
  const list = checklistOf(card)
  if (index < 0 || index >= list.length) return json({ detail: 'Checklist item not found' }, 404)

  if ('text' in body && body.text != null) list[index].text = String(body.text)
  if ('completed' in body && body.completed != null) list[index].done = coerceBool(body.completed)

  let finalIndex = index
  if ('position' in body && body.position != null) {
    const pos = parseInt(String(body.position), 10)
    if (!Number.isNaN(pos)) {
      const [moved] = list.splice(index, 1)
      finalIndex = Math.min(Math.max(0, pos), list.length)
      list.splice(finalIndex, 0, moved)
    }
  }
  await pbPatch('cards', cardId, { checklist: list })
  const it = list[finalIndex]
  return json({
    id: `${cardId}_${finalIndex}`,
    cardId,
    text: it.text,
    completed: it.done,
    position: finalIndex,
    createdAt: new Date().toISOString(),
  })
}

async function handleChecklistDelete(itemId: string): Promise<Response> {
  const { cardId, index } = parseChecklistId(itemId)
  const card = await pbGet('cards', cardId)
  if (card) {
    const list = checklistOf(card)
    if (index >= 0 && index < list.length) {
      list.splice(index, 1)
      await pbPatch('cards', cardId, { checklist: list })
    }
  }
  return json({ status: 'deleted', id: itemId })
}

// ---------------------------------------------------------------------------
// Search & stats handlers
// ---------------------------------------------------------------------------

async function nonArchivedBoardCards(boardId: string): Promise<PbRecord[]> {
  const listRows = await pbList('lists', `filter=${enc(`board='${boardId}'`)}&sort=position&perPage=200`)
  if (listRows.length === 0) return []
  const listClause = listRows.map((l) => `list='${String(l.id)}'`).join(' || ')
  return pbList('cards', `filter=${enc(`(${listClause}) && archived=false`)}&sort=position&perPage=500&expand=labels`)
}

async function handleSearch(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const boardId = body.board_id != null && String(body.board_id) !== '' ? String(body.board_id) : ''
  if (!boardId) return json([])

  const q = body.q ? String(body.q).toLowerCase() : ''
  const priority = body.priority ? String(body.priority) : ''
  const labelId = body.label_id != null && String(body.label_id) !== '' ? String(body.label_id) : ''
  const dueStatus = body.due_status ? String(body.due_status) : ''
  const now = Date.now()
  const weekAhead = now + 7 * 24 * 60 * 60 * 1000

  let rows = await nonArchivedBoardCards(boardId)

  rows = rows.filter((c) => {
    if (q) {
      const title = String(c.title ?? '').toLowerCase()
      const desc = String(c.description ?? '').toLowerCase()
      if (!title.includes(q) && !desc.includes(q)) return false
    }
    if (priority && String(c.priority || 'none') !== priority) return false
    if (labelId) {
      const labels = Array.isArray(c.labels) ? (c.labels as unknown[]).map(String) : []
      if (!labels.includes(labelId)) return false
    }
    if (dueStatus) {
      const due = toIso(c.due_date)
      const dueMs = due ? Date.parse(due) : null
      if (dueStatus === 'overdue' && !(dueMs != null && dueMs < now)) return false
      if (dueStatus === 'upcoming' && !(dueMs != null && dueMs >= now && dueMs <= weekAhead)) return false
      if (dueStatus === 'no_date' && dueMs != null) return false
    }
    return true
  })

  return json(rows.map(toCard))
}

async function handleStats(init?: RequestInit): Promise<Response> {
  const empty = {
    totalCards: 0, cardsByList: [] as unknown[], cardsByPriority: { none: 0, low: 0, medium: 0, high: 0, urgent: 0 },
    overdueCount: 0, completedChecklistItems: 0, totalChecklistItems: 0,
  }
  const body = readBody(init)
  const boardId = body.board_id != null && String(body.board_id) !== '' ? String(body.board_id) : ''
  if (!boardId) return json(empty)

  const listRows = await pbList('lists', `filter=${enc(`board='${boardId}'`)}&sort=position&perPage=200`)
  const cardRows = await nonArchivedBoardCards(boardId)

  const cardsByList = listRows.map((l) => ({
    listId: String(l.id),
    title: String(l.title ?? ''),
    count: cardRows.filter((c) => String(c.list ?? '') === String(l.id)).length,
  }))

  const cardsByPriority: Record<string, number> = { none: 0, low: 0, medium: 0, high: 0, urgent: 0 }
  const now = Date.now()
  let overdueCount = 0
  let totalChecklistItems = 0
  let completedChecklistItems = 0

  for (const c of cardRows) {
    const p = String(c.priority || 'none')
    if (p in cardsByPriority) cardsByPriority[p] += 1
    const due = toIso(c.due_date)
    if (due && Date.parse(due) < now) overdueCount += 1
    const cl = checklistOf(c)
    totalChecklistItems += cl.length
    completedChecklistItems += cl.filter((it) => it.done).length
  }

  return json({
    totalCards: cardRows.length,
    cardsByList,
    cardsByPriority,
    overdueCount,
    completedChecklistItems,
    totalChecklistItems,
  })
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

  // Health
  if (path === '/health') return json({ status: 'ok' })

  // Generic app state / actions
  if (path === '/api/state') {
    if (method === 'GET') return json(appState)
    if (method === 'DELETE') { appState = {}; return json({ status: 'cleared' }) }
    const body = readBody(init)
    const data = (body.data as Record<string, unknown>) ?? {}
    appState = { ...appState, ...data }
    return json(appState)
  }
  if (path === '/api/state/replace') {
    const body = readBody(init)
    appState = ((body.data as Record<string, unknown>) ?? {})
    return json(appState)
  }
  if (path === '/api/action') {
    const body = readBody(init)
    if (String(body.action ?? '') === 'reset') { appState = {}; return json({ status: 'reset', data: {} }) }
    return json({ status: 'unknown_action', action: body.action ?? null, data: appState })
  }

  // Agent instrumentation no-ops
  if (path === '/api/ui-snapshot') {
    if (method === 'GET') {
      return json({
        htmlStructure: null, visibleText: [], inputValues: {}, componentState: {},
        currentView: null, viewport: {}, timestamp: null, status: 'no_snapshot',
      })
    }
    return json({ ok: true })
  }
  if (path === '/api/ui-screenshot') {
    if (method === 'GET') return json({ imageData: null, width: null, height: null, timestamp: null, status: 'no_screenshot' })
    return json({ ok: true })
  }
  if (path === '/api/logs') return json({ ok: true })

  // Settings (not called by rendered components; kept benign)
  if (path === '/api/settings') {
    if (method === 'GET') return json({})
    return json(readBody(init))
  }

  let m: RegExpMatchArray | null

  // Boards
  if (path === '/api/boards') {
    if (method === 'GET') return handleBoardsList()
    if (method === 'POST') return handleBoardCreate(init)
  }
  if ((m = path.match(/^\/api\/boards\/([^/]+)\/labels$/)) && method === 'GET') {
    return handleBoardLabels(decodeURIComponent(m[1] as string))
  }
  if ((m = path.match(/^\/api\/boards\/([^/]+)$/))) {
    const id = decodeURIComponent(m[1] as string)
    if (method === 'GET') return handleBoardGet(id)
    if (method === 'PUT') return handleBoardUpdate(id, init)
    if (method === 'DELETE') { await pbDelete('boards', id); return json({ status: 'deleted', id }) }
  }

  // Lists
  if (path === '/api/lists' && method === 'POST') return handleListCreate(init)
  if ((m = path.match(/^\/api\/lists\/([^/]+)$/))) {
    const id = decodeURIComponent(m[1] as string)
    if (method === 'PUT') return handleListUpdate(id, init)
    if (method === 'DELETE') return handleListDelete(id)
  }

  // Cards
  if (path === '/api/cards' && method === 'POST') return handleCardCreate(init)
  if ((m = path.match(/^\/api\/cards\/([^/]+)\/move$/)) && method === 'PUT') {
    return handleCardMove(decodeURIComponent(m[1] as string), init)
  }
  if ((m = path.match(/^\/api\/cards\/([^/]+)\/labels\/([^/]+)$/))) {
    const cid = decodeURIComponent(m[1] as string)
    const lid = decodeURIComponent(m[2] as string)
    if (method === 'PUT') return handleLabelAssign(cid, lid)
    if (method === 'DELETE') return handleLabelRemove(cid, lid)
  }
  if ((m = path.match(/^\/api\/cards\/([^/]+)$/))) {
    const id = decodeURIComponent(m[1] as string)
    if (method === 'GET') return handleCardGet(id)
    if (method === 'PUT') return handleCardUpdate(id, init)
    if (method === 'DELETE') return handleCardDelete(id)
  }

  // Labels
  if (path === '/api/labels' && method === 'POST') return handleLabelCreate(init)
  if ((m = path.match(/^\/api\/labels\/([^/]+)$/))) {
    const id = decodeURIComponent(m[1] as string)
    if (method === 'PUT') return handleLabelUpdate(id, init)
    if (method === 'DELETE') return handleLabelDelete(id)
  }

  // Checklist
  if (path === '/api/checklist' && method === 'POST') return handleChecklistCreate(init)
  if ((m = path.match(/^\/api\/checklist\/([^/]+)$/))) {
    const id = decodeURIComponent(m[1] as string)
    if (method === 'PUT') return handleChecklistUpdate(id, init)
    if (method === 'DELETE') return handleChecklistDelete(id)
  }

  // Search & stats
  if (path === '/api/search' && method === 'POST') return handleSearch(init)
  if (path === '/api/stats' && method === 'POST') return handleStats(init)

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
