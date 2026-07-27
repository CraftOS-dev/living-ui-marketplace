/**
 * apiAdapter.ts — client-side fetch shim that lets the UNCHANGED V1
 * (Python/FastAPI) multi-user Kanban frontend run against the V2 PocketBase
 * backend.
 *
 * HOW IT WORKS
 * ------------
 * On import this module sets `window.__CRAFTBOT_BACKEND_URL__` to a sentinel
 * host (`http://living-ui.local`). Every V1 module (ApiService, AppController,
 * AuthService) reads that global at eval time and builds request URLs like
 * `${BACKEND_URL}/api/...`, so all their traffic is aimed at the sentinel host.
 *
 * `installApiAdapter()` monkeypatches `window.fetch`:
 *   - Requests to the sentinel host are routed to a local handler that returns
 *     a synthetic Response shaped EXACTLY like the V1 FastAPI backend.
 *   - Every other request (real same-origin `/api/collections/*`,
 *     `/api/ops/*`) is passed straight through to the captured original fetch,
 *     which hits the PocketBase server that serves the page.
 *   - Handlers themselves call the captured original fetch with RELATIVE urls
 *     so they reach that same PocketBase server.
 *
 * AUTH
 * ----
 * Login is performed by the V2 platform kit's <LoginGate> (authMode=multi-user).
 * After login the kit persists a PocketBase session in localStorage under
 * `pocketbase_auth` as JSON `{ token, record }`. This adapter RIDES on that
 * session: every PB call it makes (CRUD + auth bridge) sends
 * `Authorization: Bearer <token>` read from that key — the board collections
 * are auth-gated (`@request.auth.id != ""`), so without it every read/write
 * would 403. When no session exists, handlers return empty-but-valid shapes.
 *
 * The V1 AuthService keys off its own `auth_token` localStorage entry (it
 * short-circuits getMe() when absent). On install we mirror the PocketBase
 * token into `auth_token` if missing so AuthService proceeds and reaches us.
 *
 * SYNTHESIS NOTES (where PocketBase can't reproduce V1 exactly)
 * ------------------------------------------------------------
 *   - IDs: V1 used integer PKs; PocketBase uses 15-char string ids. All ids
 *     are surfaced as strings. The UI treats ids as opaque (React keys, Set
 *     membership, equality, URL segments) so this is transparent.
 *   - Checklist items: V1 had a `checklist_items` table with integer ids; V2
 *     stores a per-card JSON array `[{id,text,done}]`. Item-level V1 endpoints
 *     (`/checklist`, `/checklist/{id}`) are translated into mutations of the
 *     owning card's JSON. Synthetic item ids encode the card: `<cardId>__<uid>`.
 *   - Membership/invites: there is NO memberships or invites collection in V2.
 *     All signed-in users are treated as workspace members (role 'member').
 *     Member add/remove and invites are DECORATIVE (non-persistent) so the
 *     MemberList / InviteModal UI stays functional.
 */

const SENTINEL = 'http://living-ui.local'

// Set the sentinel at import time so component modules pick it up on eval.
;(window as unknown as { __CRAFTBOT_BACKEND_URL__?: string }).__CRAFTBOT_BACKEND_URL__ = SENTINEL

const CREATED_AT = '2024-01-01T00:00:00Z'
const enc = encodeURIComponent

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PbRecord = Record<string, unknown>

interface AuthUserShape {
  id: string
  email: string
  username: string
  role: string
  isActive: boolean
  createdAt: string
}

interface ChecklistEntry {
  id?: string
  text?: string
  done?: boolean
  completed?: boolean
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

function nowIso(): string { return new Date().toISOString() }

function genId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function toBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  const s = String(v).toLowerCase()
  return s === 'true' || s === '1'
}

function dateOrNull(v: unknown): string | null {
  if (v == null || v === '') return null
  const t = Date.parse(String(v))
  if (Number.isNaN(t)) return null
  return new Date(t).toISOString()
}

// ---------------------------------------------------------------------------
// Session (PocketBase auth persisted by the platform kit)
// ---------------------------------------------------------------------------

function getSession(): { token: string | null; record: PbRecord | null } {
  try {
    const raw = localStorage.getItem('pocketbase_auth')
    if (!raw) return { token: null, record: null }
    const parsed = JSON.parse(raw) as { token?: string; record?: PbRecord; model?: PbRecord }
    return { token: parsed.token ?? null, record: parsed.record ?? parsed.model ?? null }
  } catch {
    return { token: null, record: null }
  }
}

function authToken(): string | null { return getSession().token }
function currentUserRecord(): PbRecord | null { return getSession().record }

function persistSession(token: string | null, record: PbRecord | null): void {
  try {
    if (token && record) {
      localStorage.setItem('pocketbase_auth', JSON.stringify({ token, record }))
      localStorage.setItem('auth_token', token)
    }
  } catch { /* ignore */ }
}

function updateSessionRecord(record: PbRecord | null): void {
  const { token } = getSession()
  if (token && record) persistSession(token, record)
}

function clearSession(): void {
  try {
    localStorage.removeItem('pocketbase_auth')
    localStorage.removeItem('auth_token')
  } catch { /* ignore */ }
}

// Mirror the PocketBase token into V1's `auth_token` so AuthService.getMe()
// (which early-returns when `auth_token` is missing) proceeds to call us.
function syncAuthToken(): void {
  try {
    const t = authToken()
    if (t && !localStorage.getItem('auth_token')) localStorage.setItem('auth_token', t)
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// PocketBase REST helpers (relative urls → PocketBase serving the page).
// All calls carry the Bearer token; the board collections are auth-gated.
// ---------------------------------------------------------------------------

function pbHeaders(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { ...(extra || {}) }
  const t = authToken()
  if (t) h['Authorization'] = `Bearer ${t}`
  return h
}

async function pbList(collection: string, query = ''): Promise<PbRecord[]> {
  try {
    const res = await originalFetch(`/api/collections/${collection}/records?${query}`, { headers: pbHeaders() })
    if (!res.ok) return []
    const body = (await res.json()) as { items?: PbRecord[] }
    return Array.isArray(body.items) ? body.items : []
  } catch { return [] }
}

async function pbCount(collection: string, filterExpr = ''): Promise<number> {
  try {
    const q = `perPage=1${filterExpr ? `&filter=${enc(filterExpr)}` : ''}`
    const res = await originalFetch(`/api/collections/${collection}/records?${q}`, { headers: pbHeaders() })
    if (!res.ok) return 0
    const body = (await res.json()) as { totalItems?: number; items?: unknown[] }
    return Number(body.totalItems ?? (body.items ? body.items.length : 0)) || 0
  } catch { return 0 }
}

async function pbGet(collection: string, id: string): Promise<PbRecord | null> {
  try {
    const res = await originalFetch(`/api/collections/${collection}/records/${id}`, { headers: pbHeaders() })
    return res.ok ? ((await res.json()) as PbRecord) : null
  } catch { return null }
}

async function pbCreate(collection: string, data: Record<string, unknown>): Promise<PbRecord | null> {
  try {
    const res = await originalFetch(`/api/collections/${collection}/records`, {
      method: 'POST',
      headers: pbHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(data),
    })
    return res.ok ? ((await res.json()) as PbRecord) : null
  } catch { return null }
}

async function pbPatch(collection: string, id: string, data: Record<string, unknown>): Promise<PbRecord | null> {
  try {
    const res = await originalFetch(`/api/collections/${collection}/records/${id}`, {
      method: 'PATCH',
      headers: pbHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(data),
    })
    return res.ok ? ((await res.json()) as PbRecord) : null
  } catch { return null }
}

async function pbDelete(collection: string, id: string): Promise<void> {
  try {
    await originalFetch(`/api/collections/${collection}/records/${id}`, { method: 'DELETE', headers: pbHeaders() })
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Shape mappers (V1 field names)
// ---------------------------------------------------------------------------

function emailLocal(email: string): string {
  const at = email.indexOf('@')
  return at > 0 ? email.slice(0, at) : email
}

function toAuthUser(rec: PbRecord | null): AuthUserShape | null {
  if (!rec) return null
  const email = String(rec.email ?? '')
  const username = String(rec.username ?? rec.name ?? emailLocal(email) ?? '')
  return {
    id: String(rec.id ?? ''),
    email,
    username,
    role: 'member',
    isActive: true,
    createdAt: rec.created ? String(rec.created) : CREATED_AT,
  }
}

function toLabel(rec: PbRecord): Record<string, unknown> {
  return {
    id: String(rec.id),
    boardId: String(rec.board ?? ''),
    name: String(rec.name ?? ''),
    color: String(rec.color ?? ''),
  }
}

function toChecklistItem(cardId: string, entry: ChecklistEntry, idx: number, createdAt: string): Record<string, unknown> {
  const uid = entry && entry.id != null ? String(entry.id) : `i${idx}`
  return {
    id: `${cardId}__${uid}`,
    cardId,
    text: String(entry?.text ?? ''),
    completed: Boolean(entry?.done ?? entry?.completed ?? false),
    position: idx,
    createdAt,
  }
}

function toCard(rec: PbRecord, labelMap: Map<string, Record<string, unknown>>): Record<string, unknown> {
  const cardId = String(rec.id)
  const labelIds = Array.isArray(rec.labels) ? (rec.labels as unknown[]).map(String) : []
  const labels = labelIds.map((id) => labelMap.get(id)).filter((l): l is Record<string, unknown> => l != null)
  const rawChecklist: ChecklistEntry[] = Array.isArray(rec.checklist) ? (rec.checklist as ChecklistEntry[]) : []
  const createdAt = rec.created ? String(rec.created) : CREATED_AT
  const checklistItems = rawChecklist.map((it, idx) => toChecklistItem(cardId, it, idx, createdAt))
  const completed = checklistItems.filter((i) => i.completed).length
  const desc = rec.description
  return {
    id: cardId,
    listId: String(rec.list ?? ''),
    title: String(rec.title ?? ''),
    description: desc != null && desc !== '' ? String(desc) : null,
    priority: String(rec.priority || 'none'),
    dueDate: dateOrNull(rec.due_date),
    position: Number(rec.position ?? 0),
    archived: Boolean(rec.archived),
    labels,
    checklistItems,
    checklistTotal: checklistItems.length,
    checklistCompleted: completed,
    createdAt,
    updatedAt: rec.updated ? String(rec.updated) : createdAt,
  }
}

function toList(rec: PbRecord, cards: Record<string, unknown>[]): Record<string, unknown> {
  const createdAt = rec.created ? String(rec.created) : CREATED_AT
  return {
    id: String(rec.id),
    boardId: String(rec.board ?? ''),
    title: String(rec.title ?? ''),
    position: Number(rec.position ?? 0),
    cards,
    createdAt,
    updatedAt: rec.updated ? String(rec.updated) : createdAt,
  }
}

function toBoardShallow(rec: PbRecord): Record<string, unknown> {
  const createdAt = rec.created ? String(rec.created) : CREATED_AT
  return {
    id: String(rec.id),
    name: String(rec.name ?? ''),
    createdAt,
    updatedAt: rec.updated ? String(rec.updated) : createdAt,
  }
}

function toBoardFull(
  rec: PbRecord,
  lists: Record<string, unknown>[],
  labels: Record<string, unknown>[],
): Record<string, unknown> {
  return { ...toBoardShallow(rec), lists, labels }
}

function toMembership(u: PbRecord, resourceType: string, resourceId: string): Record<string, unknown> {
  return {
    id: String(u.id),
    userId: String(u.id),
    resourceType,
    resourceId,
    role: 'member',
    joinedAt: u.created ? String(u.created) : CREATED_AT,
    user: toAuthUser(u),
  }
}

// ---------------------------------------------------------------------------
// Board reconstruction
// ---------------------------------------------------------------------------

async function buildBoardFull(boardId: string): Promise<Record<string, unknown> | null> {
  const board = await pbGet('boards', boardId)
  if (!board) return null
  const labelRows = await pbList('labels', `perPage=200&filter=${enc(`board='${boardId}'`)}`)
  const labels = labelRows.map(toLabel)
  const labelMap = new Map<string, Record<string, unknown>>(labelRows.map((r) => [String(r.id), toLabel(r)]))
  const listRows = await pbList('lists', `perPage=200&sort=position&filter=${enc(`board='${boardId}'`)}`)
  const listIds = listRows.map((r) => String(r.id))
  let cardRows: PbRecord[] = []
  if (listIds.length > 0) {
    const f = listIds.map((id) => `list='${id}'`).join(' || ')
    cardRows = await pbList('cards', `perPage=200&sort=position&filter=${enc(`(${f})`)}`)
  }
  const lists = listRows.map((lr) => {
    const cards = cardRows
      .filter((c) => String(c.list) === String(lr.id) && !c.archived)
      .map((c) => toCard(c, labelMap))
    return toList(lr, cards)
  })
  return toBoardFull(board, lists, labels)
}

async function labelMapForCard(card: PbRecord): Promise<Map<string, Record<string, unknown>>> {
  const ids = Array.isArray(card.labels) ? (card.labels as unknown[]).map(String) : []
  if (ids.length === 0) return new Map()
  const f = ids.map((id) => `id='${id}'`).join(' || ')
  const rows = await pbList('labels', `perPage=200&filter=${enc(`(${f})`)}`)
  return new Map<string, Record<string, unknown>>(rows.map((r) => [String(r.id), toLabel(r)]))
}

// ---------------------------------------------------------------------------
// Board handlers
// ---------------------------------------------------------------------------

async function handleBoardsList(): Promise<Response> {
  const rows = await pbList('boards', 'perPage=200&sort=created')
  return json(rows.map(toBoardShallow))
}

async function handleBoardCreate(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const name = String(body.name ?? '').trim() || 'Untitled Board'
  const board = await pbCreate('boards', { name })
  if (!board) return json({ detail: 'Failed to create board' }, 500)
  const boardId = String(board.id)
  const titles = ['To Do', 'In Progress', 'Done']
  for (let i = 0; i < titles.length; i++) {
    await pbCreate('lists', { board: boardId, title: titles[i], position: i })
  }
  const full = await buildBoardFull(boardId)
  return json(full ?? toBoardFull(board, [], []))
}

async function handleBoardGet(boardId: string): Promise<Response> {
  const full = await buildBoardFull(boardId)
  if (!full) return json({ detail: 'Board not found' }, 404)
  return json(full)
}

async function handleBoardUpdate(boardId: string, init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const board = await pbGet('boards', boardId)
  if (!board) return json({ detail: 'Board not found' }, 404)
  const patched = body.name != null ? await pbPatch('boards', boardId, { name: String(body.name) }) : board
  return json(toBoardShallow(patched ?? board))
}

async function handleBoardDelete(boardId: string): Promise<Response> {
  await pbDelete('boards', boardId) // cascades to lists/labels/cards
  return json({ status: 'deleted', id: boardId })
}

async function handleBoardLabels(boardId: string): Promise<Response> {
  const rows = await pbList('labels', `perPage=200&filter=${enc(`board='${boardId}'`)}`)
  return json(rows.map(toLabel))
}

// ---------------------------------------------------------------------------
// List handlers
// ---------------------------------------------------------------------------

async function handleListCreate(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const boardId = String(body.board_id ?? '')
  if (!boardId) return json({ detail: 'Board not found' }, 404)
  const board = await pbGet('boards', boardId)
  if (!board) return json({ detail: 'Board not found' }, 404)
  const pos = body.position != null ? Number(body.position) : await pbCount('lists', `board='${boardId}'`)
  const created = await pbCreate('lists', { board: boardId, title: String(body.title ?? ''), position: pos })
  if (!created) return json({ detail: 'Failed to create list' }, 500)
  return json(toList(created, []))
}

async function handleListUpdate(listId: string, init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const list = await pbGet('lists', listId)
  if (!list) return json({ detail: 'List not found' }, 404)
  if (body.title != null) await pbPatch('lists', listId, { title: String(body.title) })
  if (body.position != null) {
    const pos = Number.parseInt(String(body.position), 10)
    if (!Number.isNaN(pos)) {
      const boardId = String(list.board ?? '')
      const siblings = (await pbList('lists', `perPage=200&sort=position&filter=${enc(`board='${boardId}'`)}`))
        .filter((l) => String(l.id) !== String(listId))
      const insertAt = Math.min(Math.max(pos, 0), siblings.length)
      siblings.splice(insertAt, 0, { ...list, id: listId })
      for (let i = 0; i < siblings.length; i++) await pbPatch('lists', String(siblings[i]!.id), { position: i })
    }
  }
  const fresh = (await pbGet('lists', listId)) ?? list
  return json(toList(fresh, []))
}

async function handleListDelete(listId: string): Promise<Response> {
  await pbDelete('lists', listId) // cascades to cards
  return json({ status: 'deleted', id: listId })
}

// ---------------------------------------------------------------------------
// Card handlers
// ---------------------------------------------------------------------------

async function handleCardCreate(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const listId = String(body.list_id ?? '')
  if (!listId) return json({ detail: 'List not found' }, 404)
  const list = await pbGet('lists', listId)
  if (!list) return json({ detail: 'List not found' }, 404)
  const pos = await pbCount('cards', `list='${listId}'`)
  const dueRaw = body.due_date
  const created = await pbCreate('cards', {
    list: listId,
    title: String(body.title ?? ''),
    description: body.description != null ? String(body.description) : '',
    priority: String(body.priority || 'none'),
    due_date: dueRaw ? String(dueRaw) : '',
    position: pos,
    archived: false,
    labels: [],
    checklist: [],
  })
  if (!created) return json({ detail: 'Failed to create card' }, 500)
  return json(toCard(created, new Map()))
}

async function handleCardGet(cardId: string): Promise<Response> {
  const card = await pbGet('cards', cardId)
  if (!card) return json({ detail: 'Card not found' }, 404)
  const labelMap = await labelMapForCard(card)
  return json(toCard(card, labelMap))
}

async function handleCardUpdate(cardId: string, init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const card = await pbGet('cards', cardId)
  if (!card) return json({ detail: 'Card not found' }, 404)
  const patch: Record<string, unknown> = {}
  if (body.title != null) patch.title = String(body.title)
  if (body.description !== undefined) patch.description = body.description != null ? String(body.description) : ''
  if (body.priority != null) patch.priority = String(body.priority)
  if (body.due_date !== undefined) patch.due_date = body.due_date ? String(body.due_date) : ''
  if (body.archived !== undefined) patch.archived = toBool(body.archived)
  const patched = Object.keys(patch).length > 0 ? (await pbPatch('cards', cardId, patch)) ?? card : card
  const labelMap = await labelMapForCard(patched)
  return json(toCard(patched, labelMap))
}

async function handleCardDelete(cardId: string): Promise<Response> {
  await pbDelete('cards', cardId)
  return json({ status: 'deleted', id: cardId })
}

async function handleCardMove(cardId: string, init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const targetListId = String(body.list_id ?? '')
  const position = Number(body.position ?? 0)
  const card = await pbGet('cards', cardId)
  if (!card) return json({ detail: 'Card not found' }, 404)
  if (!targetListId) return json({ detail: 'Target list not found' }, 404)
  const oldListId = String(card.list ?? '')

  await pbPatch('cards', cardId, { list: targetListId })

  const targetCards = (await pbList('cards', `perPage=200&sort=position&filter=${enc(`list='${targetListId}'`)}`))
    .filter((c) => String(c.id) !== String(cardId))
  const insertAt = Math.min(Math.max(position, 0), targetCards.length)
  targetCards.splice(insertAt, 0, { ...card, id: cardId })
  for (let i = 0; i < targetCards.length; i++) await pbPatch('cards', String(targetCards[i]!.id), { position: i })

  if (oldListId && oldListId !== targetListId) {
    const oldCards = await pbList('cards', `perPage=200&sort=position&filter=${enc(`list='${oldListId}'`)}`)
    for (let i = 0; i < oldCards.length; i++) await pbPatch('cards', String(oldCards[i]!.id), { position: i })
  }

  const updated = (await pbGet('cards', cardId)) ?? card
  const labelMap = await labelMapForCard(updated)
  return json(toCard(updated, labelMap))
}

// ---------------------------------------------------------------------------
// Label handlers
// ---------------------------------------------------------------------------

async function handleLabelCreate(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const boardId = String(body.board_id ?? '')
  if (!boardId) return json({ detail: 'Board not found' }, 404)
  const board = await pbGet('boards', boardId)
  if (!board) return json({ detail: 'Board not found' }, 404)
  const created = await pbCreate('labels', {
    board: boardId,
    name: String(body.name ?? ''),
    color: String(body.color ?? ''),
  })
  if (!created) return json({ detail: 'Failed to create label' }, 500)
  return json(toLabel(created))
}

async function handleLabelUpdate(labelId: string, init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const label = await pbGet('labels', labelId)
  if (!label) return json({ detail: 'Label not found' }, 404)
  const patch: Record<string, unknown> = {}
  if (body.name != null) patch.name = String(body.name)
  if (body.color != null) patch.color = String(body.color)
  const patched = Object.keys(patch).length > 0 ? (await pbPatch('labels', labelId, patch)) ?? label : label
  return json(toLabel(patched))
}

async function handleLabelDelete(labelId: string): Promise<Response> {
  await pbDelete('labels', labelId)
  return json({ status: 'deleted', id: labelId })
}

async function handleLabelAssign(cardId: string, labelId: string): Promise<Response> {
  const card = await pbGet('cards', cardId)
  if (!card) return json({ detail: 'Card not found' }, 404)
  const label = await pbGet('labels', labelId)
  if (!label) return json({ detail: 'Label not found' }, 404)
  const ids = Array.isArray(card.labels) ? (card.labels as unknown[]).map(String) : []
  if (!ids.includes(labelId)) {
    ids.push(labelId)
    await pbPatch('cards', cardId, { labels: ids })
  }
  return json({ status: 'assigned', cardId, labelId })
}

async function handleLabelRemove(cardId: string, labelId: string): Promise<Response> {
  const card = await pbGet('cards', cardId)
  if (!card) return json({ detail: 'Card not found' }, 404)
  const label = await pbGet('labels', labelId)
  if (!label) return json({ detail: 'Label not found' }, 404)
  const ids = (Array.isArray(card.labels) ? (card.labels as unknown[]).map(String) : []).filter((x) => x !== labelId)
  await pbPatch('cards', cardId, { labels: ids })
  return json({ status: 'removed', cardId, labelId })
}

// ---------------------------------------------------------------------------
// Checklist handlers (V1 item endpoints → card.checklist JSON mutations)
// ---------------------------------------------------------------------------

function parseChecklistToken(token: string): { cardId: string; uid: string } {
  const i = token.indexOf('__')
  if (i < 0) return { cardId: token, uid: '' }
  return { cardId: token.slice(0, i), uid: token.slice(i + 2) }
}

function findChecklistIndex(arr: ChecklistEntry[], uid: string): number {
  let idx = arr.findIndex((it) => it && it.id != null && String(it.id) === uid)
  if (idx < 0) {
    const m = uid.match(/^i(\d+)$/)
    if (m) idx = Number(m[1])
  }
  return idx >= 0 && idx < arr.length ? idx : -1
}

async function handleChecklistCreate(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const cardId = String(body.card_id ?? '')
  const card = await pbGet('cards', cardId)
  if (!card) return json({ detail: 'Card not found' }, 404)
  const arr: ChecklistEntry[] = Array.isArray(card.checklist) ? (card.checklist as ChecklistEntry[]).slice() : []
  const uid = genId()
  arr.push({ id: uid, text: String(body.text ?? ''), done: false })
  await pbPatch('cards', cardId, { checklist: arr })
  const idx = arr.length - 1
  return json(toChecklistItem(cardId, arr[idx]!, idx, card.created ? String(card.created) : CREATED_AT))
}

async function handleChecklistUpdate(token: string, init?: RequestInit): Promise<Response> {
  const { cardId, uid } = parseChecklistToken(token)
  const card = await pbGet('cards', cardId)
  if (!card) return json({ detail: 'Checklist item not found' }, 404)
  const arr: ChecklistEntry[] = Array.isArray(card.checklist) ? (card.checklist as ChecklistEntry[]).slice() : []
  let idx = findChecklistIndex(arr, uid)
  if (idx < 0) return json({ detail: 'Checklist item not found' }, 404)
  const body = readBody(init)
  if (body.text != null) arr[idx] = { ...arr[idx], text: String(body.text) }
  if (body.completed != null) arr[idx] = { ...arr[idx], done: toBool(body.completed) }
  if (body.position != null) {
    const pos = Number.parseInt(String(body.position), 10)
    if (!Number.isNaN(pos)) {
      const [it] = arr.splice(idx, 1)
      if (it) {
        const insertAt = Math.min(Math.max(pos, 0), arr.length)
        arr.splice(insertAt, 0, it)
        idx = insertAt
      }
    }
  }
  await pbPatch('cards', cardId, { checklist: arr })
  return json(toChecklistItem(cardId, arr[idx]!, idx, card.created ? String(card.created) : CREATED_AT))
}

async function handleChecklistDelete(token: string): Promise<Response> {
  const { cardId, uid } = parseChecklistToken(token)
  const card = await pbGet('cards', cardId)
  if (card) {
    const arr: ChecklistEntry[] = Array.isArray(card.checklist) ? (card.checklist as ChecklistEntry[]).slice() : []
    const idx = findChecklistIndex(arr, uid)
    if (idx >= 0) {
      arr.splice(idx, 1)
      await pbPatch('cards', cardId, { checklist: arr })
    }
  }
  return json({ status: 'deleted', id: token })
}

// ---------------------------------------------------------------------------
// Search & stats
// ---------------------------------------------------------------------------

async function handleSearch(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const boardId = String(body.board_id ?? '')
  if (!boardId) return json([])
  const board = await pbGet('boards', boardId)
  if (!board) return json({ detail: 'Board not found' }, 404)

  const labelRows = await pbList('labels', `perPage=200&filter=${enc(`board='${boardId}'`)}`)
  const labelMap = new Map<string, Record<string, unknown>>(labelRows.map((r) => [String(r.id), toLabel(r)]))
  const listRows = await pbList('lists', `perPage=200&filter=${enc(`board='${boardId}'`)}`)
  const listIds = listRows.map((r) => String(r.id))
  let cardRows: PbRecord[] = []
  if (listIds.length > 0) {
    const f = listIds.map((id) => `list='${id}'`).join(' || ')
    cardRows = await pbList('cards', `perPage=200&sort=position&filter=${enc(`(${f})`)}`)
  }
  cardRows = cardRows.filter((c) => !c.archived)

  const q = body.q ? String(body.q).toLowerCase() : ''
  const priority = body.priority ? String(body.priority) : ''
  const labelId = body.label_id != null && body.label_id !== '' ? String(body.label_id) : ''
  const dueStatus = body.due_status ? String(body.due_status) : ''
  const now = Date.now()

  const filtered = cardRows.filter((c) => {
    if (q) {
      const t = String(c.title ?? '').toLowerCase()
      const d = String(c.description ?? '').toLowerCase()
      if (!t.includes(q) && !d.includes(q)) return false
    }
    if (priority && String(c.priority || 'none') !== priority) return false
    if (labelId) {
      const ls = Array.isArray(c.labels) ? (c.labels as unknown[]).map(String) : []
      if (!ls.includes(labelId)) return false
    }
    if (dueStatus) {
      const due = c.due_date ? Date.parse(String(c.due_date)) : NaN
      if (dueStatus === 'overdue') {
        if (Number.isNaN(due) || due >= now) return false
      } else if (dueStatus === 'upcoming') {
        const cut = now + 7 * 86400000
        if (Number.isNaN(due) || due < now || due > cut) return false
      } else if (dueStatus === 'no_date') {
        if (!Number.isNaN(due)) return false
      }
    }
    return true
  })

  filtered.sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
  return json(filtered.map((c) => toCard(c, labelMap)))
}

async function handleStats(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const empty = {
    totalCards: 0, cardsByList: [], cardsByPriority: {},
    overdueCount: 0, completedChecklistItems: 0, totalChecklistItems: 0,
  }
  const boardId = String(body.board_id ?? '')
  if (!boardId) return json(empty)
  const board = await pbGet('boards', boardId)
  if (!board) return json({ detail: 'Board not found' }, 404)

  const listRows = await pbList('lists', `perPage=200&sort=position&filter=${enc(`board='${boardId}'`)}`)
  const listIds = listRows.map((r) => String(r.id))
  let cardRows: PbRecord[] = []
  if (listIds.length > 0) {
    const f = listIds.map((id) => `list='${id}'`).join(' || ')
    cardRows = await pbList('cards', `perPage=200&filter=${enc(`(${f})`)}`)
  }
  cardRows = cardRows.filter((c) => !c.archived)

  const cardsByList = listRows.map((l) => ({
    listId: String(l.id),
    title: String(l.title ?? ''),
    count: cardRows.filter((c) => String(c.list) === String(l.id)).length,
  }))

  const priorityCounts: Record<string, number> = { none: 0, low: 0, medium: 0, high: 0, urgent: 0 }
  for (const c of cardRows) {
    const p = String(c.priority || 'none')
    if (p in priorityCounts) priorityCounts[p] = (priorityCounts[p] ?? 0) + 1
  }

  const now = Date.now()
  const overdue = cardRows.filter((c) => {
    const d = c.due_date ? Date.parse(String(c.due_date)) : NaN
    return !Number.isNaN(d) && d < now
  }).length

  let total = 0
  let completed = 0
  for (const c of cardRows) {
    const cl: ChecklistEntry[] = Array.isArray(c.checklist) ? (c.checklist as ChecklistEntry[]) : []
    total += cl.length
    completed += cl.filter((it) => Boolean(it && (it.done ?? it.completed))).length
  }

  return json({
    totalCards: cardRows.length,
    cardsByList,
    cardsByPriority: priorityCounts,
    overdueCount: overdue,
    completedChecklistItems: completed,
    totalChecklistItems: total,
  })
}

// ---------------------------------------------------------------------------
// Auth bridge (/api/auth/*) — sourced from the pocketbase_auth session
// ---------------------------------------------------------------------------

async function handleAuthMe(): Promise<Response> {
  const rec = currentUserRecord()
  if (!rec) return json({ user: null })
  return json({ user: toAuthUser(rec) })
}

async function handleAuthLogin(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const email = String(body.email ?? '')
  const password = String(body.password ?? '')
  try {
    const res = await originalFetch('/api/collections/users/auth-with-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: email, password }),
    })
    if (!res.ok) {
      const e = (await res.json().catch(() => ({}))) as { message?: string }
      return json({ detail: e.message || 'Invalid email or password' }, 401)
    }
    const data = (await res.json()) as { token: string; record: PbRecord }
    persistSession(data.token, data.record)
    return json({ user: toAuthUser(data.record), token: data.token })
  } catch {
    return json({ detail: 'Login failed' }, 401)
  }
}

async function handleAuthRegister(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const email = String(body.email ?? '')
  const username = String(body.username ?? '')
  const password = String(body.password ?? '')
  try {
    const createRes = await originalFetch('/api/collections/users/records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, passwordConfirm: password, name: username, emailVisibility: true }),
    })
    if (!createRes.ok) {
      const e = (await createRes.json().catch(() => ({}))) as { message?: string }
      return json({ detail: e.message || 'Registration failed' }, 400)
    }
    const authRes = await originalFetch('/api/collections/users/auth-with-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: email, password }),
    })
    if (!authRes.ok) return json({ detail: 'Registration succeeded but auto-login failed' }, 400)
    const data = (await authRes.json()) as { token: string; record: PbRecord }
    persistSession(data.token, data.record)
    return json({ user: toAuthUser(data.record), token: data.token })
  } catch {
    return json({ detail: 'Registration failed' }, 400)
  }
}

async function handleAuthLogout(): Promise<Response> {
  clearSession()
  return json({ message: 'Logged out' })
}

async function handleUpdateProfile(init?: RequestInit): Promise<Response> {
  const rec = currentUserRecord()
  if (!rec) return json({ detail: 'Not authenticated' }, 401)
  const body = readBody(init)
  const patch: Record<string, unknown> = {}
  if (body.email != null && body.email !== '') patch.email = String(body.email)
  if (body.username != null && body.username !== '') patch.name = String(body.username)
  if (Object.keys(patch).length === 0) return json({ user: toAuthUser(rec) })
  const patched = await pbPatch('users', String(rec.id), patch)
  if (!patched) return json({ detail: 'Update failed' }, 400)
  updateSessionRecord(patched)
  return json({ user: toAuthUser(patched) })
}

async function handleChangePassword(init?: RequestInit): Promise<Response> {
  const rec = currentUserRecord()
  if (!rec) return json({ detail: 'Not authenticated' }, 401)
  const body = readBody(init)
  const current = String(body.current_password ?? '')
  const next = String(body.new_password ?? '')
  if (next.length < 6) return json({ detail: 'Password must be at least 6 characters' }, 400)
  try {
    const res = await originalFetch(`/api/collections/users/records/${rec.id}`, {
      method: 'PATCH',
      headers: pbHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ oldPassword: current, password: next, passwordConfirm: next }),
    })
    if (!res.ok) {
      const e = (await res.json().catch(() => ({}))) as { message?: string }
      return json({ detail: e.message || 'Current password is incorrect' }, 400)
    }
    return json({ message: 'Password updated' })
  } catch {
    return json({ detail: 'Password change failed' }, 400)
  }
}

async function handleAuthUsers(): Promise<Response> {
  const rows = await pbList('users', 'perPage=200&sort=created')
  return json({ users: rows.map(toAuthUser) })
}

async function handleMembersList(resourceType: string, resourceId: string): Promise<Response> {
  const rows = await pbList('users', 'perPage=200&sort=created')
  return json({ members: rows.map((u) => toMembership(u, resourceType, resourceId)) })
}

function handleMemberAdd(resourceType: string, resourceId: string, init?: RequestInit): Response {
  const body = readBody(init)
  // Decorative: registration is open and membership is not separately stored.
  return json({
    membership: {
      id: String(body.user_id ?? genId()),
      userId: String(body.user_id ?? ''),
      resourceType,
      resourceId,
      role: String(body.role ?? 'member'),
      joinedAt: nowIso(),
      user: null,
    },
  })
}

function handleMemberRemove(): Response {
  // Decorative no-op — no memberships table to remove from.
  return json({ message: 'Member removed' })
}

function handleInviteCreate(init?: RequestInit): Response {
  const body = readBody(init)
  const code = genId()
  // Decorative: no invites collection exists; the code is non-persistent.
  return json({
    invite: {
      id: code,
      code,
      resourceType: String(body.resource_type ?? 'board'),
      resourceId: String(body.resource_id ?? ''),
      defaultRole: String(body.default_role ?? 'member'),
      isActive: true,
      maxUses: body.max_uses != null ? Number(body.max_uses) : null,
      useCount: 0,
      createdAt: nowIso(),
    },
  })
}

function handleInviteAccept(code: string): Response {
  const rec = currentUserRecord()
  // Decorative: accepting always "succeeds" since all signed-in users are members.
  return json({
    membership: {
      id: `${rec ? String(rec.id) : 'anon'}:${code}`,
      userId: rec ? String(rec.id) : '',
      resourceType: 'board',
      resourceId: '',
      role: 'member',
      joinedAt: nowIso(),
      user: toAuthUser(rec),
    },
    message: 'Joined',
  })
}

// ---------------------------------------------------------------------------
// Generic in-memory app state (V1 stored it in SQLite; UI just needs a stable object)
// ---------------------------------------------------------------------------

let appState: Record<string, unknown> = {}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function route(url: URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase()
  const path = url.pathname
  let m: RegExpMatchArray | null

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
    appState = (body.data as Record<string, unknown>) ?? {}
    return json(appState)
  }
  if (path === '/api/action') return json({ status: 'unknown_action' })

  // Agent instrumentation no-ops
  if (path === '/api/ui-snapshot') {
    if (method === 'GET') {
      return json({
        htmlStructure: null, visibleText: [], inputValues: {}, componentState: {},
        currentView: null, viewport: {}, timestamp: null, status: 'no_snapshot',
      })
    }
    return json({ status: 'ok' })
  }
  if (path === '/api/ui-screenshot') {
    if (method === 'GET') return json({ imageData: null, width: null, height: null, timestamp: null, status: 'no_screenshot' })
    return json({ status: 'updated', timestamp: nowIso() })
  }
  if (path === '/api/logs') return json({ ok: true })
  if (path === '/api/settings') {
    if (method === 'GET') return json({})
    return json(readBody(init))
  }

  // ── Auth bridge ──────────────────────────────────────────────────────────
  if (path === '/api/auth/me') {
    if (method === 'GET') return handleAuthMe()
    if (method === 'PUT') return handleUpdateProfile(init)
  }
  if (path === '/api/auth/me/password' && method === 'PUT') return handleChangePassword(init)
  if (path === '/api/auth/login' && method === 'POST') return handleAuthLogin(init)
  if (path === '/api/auth/register' && method === 'POST') return handleAuthRegister(init)
  if (path === '/api/auth/logout' && method === 'POST') return handleAuthLogout()
  if (path === '/api/auth/users' && method === 'GET') return handleAuthUsers()

  if ((m = path.match(/^\/api\/auth\/members\/([^/]+)\/([^/]+)\/([^/]+)$/)) && method === 'DELETE') {
    return handleMemberRemove()
  }
  if ((m = path.match(/^\/api\/auth\/members\/([^/]+)\/([^/]+)$/))) {
    const type = decodeURIComponent(m[1] as string)
    const id = decodeURIComponent(m[2] as string)
    if (method === 'GET') return handleMembersList(type, id)
    if (method === 'POST') return handleMemberAdd(type, id, init)
  }
  if (path === '/api/auth/invites' && method === 'POST') return handleInviteCreate(init)
  if ((m = path.match(/^\/api\/auth\/invites\/([^/]+)\/accept$/)) && method === 'POST') {
    return handleInviteAccept(decodeURIComponent(m[1] as string))
  }

  // ── Boards ───────────────────────────────────────────────────────────────
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
    if (method === 'DELETE') return handleBoardDelete(id)
  }

  // ── Lists ────────────────────────────────────────────────────────────────
  if (path === '/api/lists' && method === 'POST') return handleListCreate(init)
  if ((m = path.match(/^\/api\/lists\/([^/]+)$/))) {
    const id = decodeURIComponent(m[1] as string)
    if (method === 'PUT') return handleListUpdate(id, init)
    if (method === 'DELETE') return handleListDelete(id)
  }

  // ── Cards ────────────────────────────────────────────────────────────────
  if (path === '/api/cards' && method === 'POST') return handleCardCreate(init)
  if (path === '/api/cards/clear-archived' && method === 'POST') {
    // Safety: not called by the shipped V1 UI, mapped to the PB custom op.
    try {
      const res = await originalFetch('/api/ops/cards/clear-archived', { method: 'POST', headers: pbHeaders() })
      const body = res.ok ? await res.json().catch(() => ({})) : {}
      return json({ status: 'cleared', ...(body as Record<string, unknown>) })
    } catch { return json({ status: 'cleared', cleared: 0 }) }
  }
  if ((m = path.match(/^\/api\/cards\/([^/]+)\/move$/)) && method === 'PUT') {
    return handleCardMove(decodeURIComponent(m[1] as string), init)
  }
  if ((m = path.match(/^\/api\/cards\/([^/]+)\/labels\/([^/]+)$/))) {
    const cardId = decodeURIComponent(m[1] as string)
    const labelId = decodeURIComponent(m[2] as string)
    if (method === 'PUT') return handleLabelAssign(cardId, labelId)
    if (method === 'DELETE') return handleLabelRemove(cardId, labelId)
  }
  if ((m = path.match(/^\/api\/cards\/([^/]+)$/))) {
    const id = decodeURIComponent(m[1] as string)
    if (method === 'GET') return handleCardGet(id)
    if (method === 'PUT') return handleCardUpdate(id, init)
    if (method === 'DELETE') return handleCardDelete(id)
  }

  // ── Labels ───────────────────────────────────────────────────────────────
  if (path === '/api/labels' && method === 'POST') return handleLabelCreate(init)
  if ((m = path.match(/^\/api\/labels\/([^/]+)$/))) {
    const id = decodeURIComponent(m[1] as string)
    if (method === 'PUT') return handleLabelUpdate(id, init)
    if (method === 'DELETE') return handleLabelDelete(id)
  }

  // ── Checklist ────────────────────────────────────────────────────────────
  if (path === '/api/checklist' && method === 'POST') return handleChecklistCreate(init)
  if ((m = path.match(/^\/api\/checklist\/([^/]+)$/))) {
    const id = decodeURIComponent(m[1] as string)
    if (method === 'PUT') return handleChecklistUpdate(id, init)
    if (method === 'DELETE') return handleChecklistDelete(id)
  }

  // ── Search & stats ─────────────────────────────────────────────────────────
  if (path === '/api/search' && method === 'POST') return handleSearch(init)
  if (path === '/api/stats' && method === 'POST') return handleStats(init)

  // Safety net: never throw. Arrays for list-ish paths, object otherwise.
  if (method === 'GET') return json({})
  return json({ ok: true })
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function installApiAdapter(): void {
  if (installed) return
  installed = true
  originalFetch = window.fetch.bind(window)
  syncAuthToken()

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
