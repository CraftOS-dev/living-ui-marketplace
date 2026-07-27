/**
 * apiAdapter.ts — client-side fetch shim that lets the UNCHANGED V1
 * (Python/FastAPI) Brainstorm Graph frontend run against the V2 PocketBase
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
 *   - Every other request (real same-origin `/api/collections/*`,
 *     `/api/ops/*`) is passed straight through to the captured original fetch,
 *     which hits the PocketBase server that serves the page.
 *   - Handlers themselves call the captured original fetch with RELATIVE urls
 *     so they reach that same PocketBase server. authMode is "none": no
 *     Authorization header is sent (collections are open).
 *
 * SHAPE SYNTHESIS NOTES (where PocketBase can't reproduce V1 exactly)
 * ------------------------------------------------------------------
 *   - Record ids are STRINGS in PocketBase, but the V1 frontend treats node/
 *     session ids as NUMBERS (SummaryView sorts with `a.id - b.id`, MainView
 *     builds the explore "start from" dropdown with `Number(node.id)`). We keep
 *     a synthetic integer <-> PocketBase string id registry so every id handed
 *     to the untouched UI is a stable integer and every id it hands back is
 *     mapped to the owning PocketBase record.
 *   - `nodeType` (V1: question | answer | idea) vs `kind` (V2 select:
 *     idea | question | insight | task). V1 "answer" has no PB slot, so it is
 *     stored as "insight" and read back as "answer"; "task" reads back as
 *     "idea". question/idea pass through.
 *   - `depth` is NOT a V2 column — it is recomputed by walking the parent chain.
 *   - `createdBy` (user | agent) is NOT a V2 column. Nodes created through the
 *     AI ops are remembered in-memory as "agent"; everything else is "user".
 *     This resets on reload (best-effort parity for the Bot/User badge).
 *   - `x`/`y` canvas positions: V2 stores them but AI-op-created nodes and the
 *     seed land at 0/0. We reproduce V1's `_child_positions` collision layout so
 *     the graph renders as a tree, and persist computed positions back to PB so
 *     they stay stable across reloads / drags.
 *   - AI ops (`nodes.suggest`, `nodes.answer`, `sessions.explore`,
 *     `sessions.summarize`) return only content strings, not node records, so we
 *     diff the session's node set before/after each op to recover what was
 *     created and re-shape it as V1 node dicts. On 503 / failure every AI handler
 *     degrades to a valid empty-but-shaped 200 result instead of throwing.
 *   - `sessions.summarize` only yields a summary string; V1's `themes`/`insights`
 *     are returned empty. `sessions.outline` has no V1 caller and is unused.
 */

const SENTINEL = 'http://living-ui.local'

// Set the sentinel at import time so component modules pick it up on eval.
;(window as unknown as { __CRAFTBOT_BACKEND_URL__?: string }).__CRAFTBOT_BACKEND_URL__ = SENTINEL

const CREATED_AT = '2024-01-01T00:00:00Z'

// V1 layout constants (routes.py) — reproduced verbatim.
const CANVAS_CENTER_X = 1500.0
const CANVAS_CENTER_Y = 400.0
const CHILD_Y_OFFSET = 220.0
const CHILD_X_SPACING = 280.0
const CARD_W = 260.0
const CARD_H = 160.0

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PbRecord = Record<string, unknown>

interface RawItem {
  pb: string
  parentPb: string
  content: string
  kind: string
  storedX: number
  storedY: number
  created: unknown
  updated: unknown
}

interface Resolved {
  pb: string
  parentPb: string
  content: string
  kind: string
  x: number
  y: number
  depth: number
  created: unknown
  updated: unknown
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

// Normalise a PocketBase date/autodate string to ISO-8601, or null when empty.
function toIso(v: unknown): string | null {
  if (v == null || v === '') return null
  try {
    const d = new Date(String(v).replace(' ', 'T'))
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  } catch { return null }
}

// A PocketBase single-relation field comes back as a string id (or, on some
// versions, a one-element array). Normalise to a plain id string.
function relId(v: unknown): string {
  if (Array.isArray(v)) return v.length ? String(v[0]) : ''
  return v == null ? '' : String(v)
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// ---------------------------------------------------------------------------
// Synthetic integer <-> PocketBase string id registry (stable per session)
// ---------------------------------------------------------------------------

const idToPb = new Map<number, string>()
const pbToId = new Map<string, number>()
let idSeq = 0

// Map a PocketBase id → a stable synthetic integer (assigned on first sight).
function synthId(pbIdValue: unknown): number {
  const key = String(pbIdValue ?? '')
  if (!key) return 0
  let n = pbToId.get(key)
  if (n === undefined) {
    n = ++idSeq
    pbToId.set(key, n)
    idToPb.set(n, key)
  }
  return n
}

// Map a synthetic integer (or its string form) back to a PocketBase id. Falls
// back to the raw value so unknown ids fail gracefully (empty PB result).
function pbId(synth: unknown): string {
  if (synth == null || synth === '') return ''
  const n = Number(synth)
  if (!Number.isNaN(n) && idToPb.has(n)) return idToPb.get(n) as string
  return String(synth)
}

// AI-op-created nodes remembered as "agent" for the createdBy badge.
const agentPbIds = new Set<string>()

// ---------------------------------------------------------------------------
// nodeType (V1) <-> kind (V2 select) mapping
// ---------------------------------------------------------------------------

function toPbKind(nodeType: unknown): string {
  switch (String(nodeType ?? '')) {
    case 'answer': return 'insight'
    case 'question': return 'question'
    case 'idea': return 'idea'
    default: return 'idea'
  }
}

function toV1Type(kind: unknown): string {
  switch (String(kind ?? '')) {
    case 'insight': return 'answer'
    case 'question': return 'question'
    case 'idea': return 'idea'
    case 'task': return 'idea'
    default: return 'idea'
  }
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

// POST a custom op; returns ok + parsed body (null on any failure / non-2xx).
async function pbOp(path: string, body: Record<string, unknown>): Promise<{ ok: boolean; data: Record<string, unknown> | null }> {
  try {
    const res = await originalFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = res.ok ? ((await res.json()) as Record<string, unknown>) : null
    return { ok: res.ok, data }
  } catch { return { ok: false, data: null } }
}

// ---------------------------------------------------------------------------
// V1 tree math (_collides / _child_positions from routes.py)
// ---------------------------------------------------------------------------

function collides(x: number, y: number, existing: Array<[number, number]>): boolean {
  for (const pair of existing) {
    if (Math.abs(x - pair[0]) < CARD_W && Math.abs(y - pair[1]) < CARD_H) return true
  }
  return false
}

function childPositions(
  parentX: number, parentY: number, existingCount: number, newCount: number,
  allPositions: Array<[number, number]>,
): Array<[number, number]> {
  const total = existingCount + newCount
  const yBase = parentY + CHILD_Y_OFFSET
  const results: Array<[number, number]> = []
  const used: Array<[number, number]> = allPositions.slice()
  for (let i = 0; i < newCount; i++) {
    const idx = existingCount + i
    const offset = (idx - (total - 1) / 2) * CHILD_X_SPACING
    const x = parentX + offset
    let y = yBase
    let attempts = 0
    while (collides(x, y, used) && attempts < 8) { y += CHILD_Y_OFFSET; attempts += 1 }
    results.push([x, y])
    used.push([x, y])
  }
  return results
}

// ---------------------------------------------------------------------------
// Node resolution: fetch a session's nodes, assign synth ids in creation
// order, compute depth (parent walk) and effective x/y (V1 layout for any node
// still at 0/0).
// ---------------------------------------------------------------------------

async function resolveNodes(pbSessionId: string): Promise<Resolved[]> {
  const rows = await pbList('nodes', `filter=${enc(`session='${pbSessionId}'`)}&sort=created&perPage=500`)
  const items: RawItem[] = rows.map((r) => {
    const pb = String(r.id)
    synthId(pb) // register in creation order so synth ids sort like V1 int ids
    return {
      pb,
      parentPb: relId(r.parent),
      content: String(r.content ?? ''),
      kind: String(r.kind || 'idea'),
      storedX: num(r.x),
      storedY: num(r.y),
      created: r.created,
      updated: r.updated,
    }
  })

  const ids = new Set(items.map((i) => i.pb))
  const childrenOf = new Map<string, RawItem[]>()
  const roots: RawItem[] = []
  for (const it of items) {
    if (it.parentPb && ids.has(it.parentPb)) {
      const arr = childrenOf.get(it.parentPb)
      if (arr) arr.push(it)
      else childrenOf.set(it.parentPb, [it])
    } else {
      roots.push(it)
    }
  }

  const depthMap = new Map<string, number>()
  const posMap = new Map<string, { x: number; y: number }>()
  const used: Array<[number, number]> = []
  for (const it of items) {
    if (it.storedX !== 0 || it.storedY !== 0) used.push([it.storedX, it.storedY])
  }

  const queue: RawItem[] = []
  let rootAuto = 0
  for (const r of roots) {
    depthMap.set(r.pb, 0)
    let x: number
    let y: number
    if (r.storedX !== 0 || r.storedY !== 0) {
      x = r.storedX; y = r.storedY
    } else {
      x = CANVAS_CENTER_X + rootAuto * CHILD_X_SPACING
      y = CANVAS_CENTER_Y
      rootAuto += 1
      used.push([x, y])
    }
    posMap.set(r.pb, { x, y })
    queue.push(r)
  }

  while (queue.length > 0) {
    const parent = queue.shift()!
    const pPos = posMap.get(parent.pb) ?? { x: CANVAS_CENTER_X, y: CANVAS_CENTER_Y }
    const pDepth = depthMap.get(parent.pb) ?? 0
    const kids = childrenOf.get(parent.pb) ?? []
    const placed = kids.filter((k) => k.storedX !== 0 || k.storedY !== 0)
    const unplaced = kids.filter((k) => k.storedX === 0 && k.storedY === 0)
    for (const k of placed) posMap.set(k.pb, { x: k.storedX, y: k.storedY })
    const positions = childPositions(pPos.x, pPos.y, placed.length, unplaced.length, used)
    for (let i = 0; i < unplaced.length; i++) {
      const p = positions[i]!
      posMap.set(unplaced[i]!.pb, { x: p[0], y: p[1] })
      used.push([p[0], p[1]])
    }
    for (const k of kids) { depthMap.set(k.pb, pDepth + 1); queue.push(k) }
  }

  return items.map((it) => {
    const pos = posMap.get(it.pb) ?? { x: it.storedX, y: it.storedY }
    return {
      pb: it.pb,
      parentPb: it.parentPb,
      content: it.content,
      kind: it.kind,
      x: pos.x,
      y: pos.y,
      depth: depthMap.get(it.pb) ?? 0,
      created: it.created,
      updated: it.updated,
    }
  })
}

// ---------------------------------------------------------------------------
// Shape mappers (produce EXACT V1 FastAPI dicts)
// ---------------------------------------------------------------------------

function sessionDict(rec: PbRecord): Record<string, unknown> {
  return {
    id: synthId(rec.id),
    title: String(rec.title ?? ''),
    topic: String(rec.topic ?? ''),
    createdAt: toIso(rec.created) ?? CREATED_AT,
    updatedAt: toIso(rec.updated) ?? CREATED_AT,
  }
}

function nodeDict(r: Resolved, pbSessionId: string): Record<string, unknown> {
  return {
    id: synthId(r.pb),
    sessionId: synthId(pbSessionId),
    parentId: r.parentPb ? synthId(r.parentPb) : null,
    content: r.content,
    nodeType: toV1Type(r.kind),
    createdBy: agentPbIds.has(r.pb) ? 'agent' : 'user',
    x: r.x,
    y: r.y,
    depth: r.depth,
    createdAt: toIso(r.created) ?? CREATED_AT,
    updatedAt: toIso(r.updated) ?? CREATED_AT,
  }
}

// A minimal node dict built directly from a freshly created record (used where
// re-resolving the whole session is unnecessary).
function rawNodeDict(
  rec: PbRecord, pbSessionId: string, parentPb: string,
  nodeType: string, createdBy: string, x: number, y: number, depth: number,
): Record<string, unknown> {
  return {
    id: synthId(rec.id),
    sessionId: synthId(pbSessionId),
    parentId: parentPb ? synthId(parentPb) : null,
    content: String(rec.content ?? ''),
    nodeType,
    createdBy,
    x,
    y,
    depth,
    createdAt: toIso(rec.created) ?? CREATED_AT,
    updatedAt: toIso(rec.updated) ?? CREATED_AT,
  }
}

// ---------------------------------------------------------------------------
// Session handlers
// ---------------------------------------------------------------------------

async function handleSessionsList(): Promise<Response> {
  const rows = await pbList('sessions', 'sort=-updated&perPage=500')
  return json(rows.map(sessionDict))
}

async function handleSessionCreate(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const title = String(body.title ?? 'Untitled')
  const topic = String(body.topic ?? '')
  const session = await pbCreate('sessions', { title, topic })
  if (!session) return json({ detail: 'failed to create session' }, 500)
  const pbSessionId = String(session.id)
  const root = await pbCreate('nodes', {
    session: pbSessionId,
    content: topic,
    kind: 'idea',
    x: CANVAS_CENTER_X,
    y: CANVAS_CENTER_Y,
  })
  const rootNode = root
    ? rawNodeDict(root, pbSessionId, '', 'idea', 'user', CANVAS_CENTER_X, CANVAS_CENTER_Y, 0)
    : null
  return json({ session: sessionDict(session), rootNode })
}

async function handleSessionUpdate(synthSessionId: string, init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const pbSessionId = pbId(synthSessionId)
  const patch: Record<string, unknown> = {}
  if ('title' in body && body.title != null) patch.title = String(body.title)
  const updated = Object.keys(patch).length > 0
    ? await pbPatch('sessions', pbSessionId, patch)
    : await pbGet('sessions', pbSessionId)
  if (!updated) return json({ status: 'not_found' })
  return json(sessionDict(updated))
}

async function handleSessionDelete(synthSessionId: string): Promise<Response> {
  await pbDelete('sessions', pbId(synthSessionId))
  return json({ status: 'deleted' })
}

async function handleSessionNodes(synthSessionId: string): Promise<Response> {
  const resolved = await resolveNodes(pbId(synthSessionId))
  const pbSessionId = pbId(synthSessionId)
  return json(resolved.map((r) => nodeDict(r, pbSessionId)))
}

async function handleSessionSummary(synthSessionId: string): Promise<Response> {
  const pbSessionId = pbId(synthSessionId)
  const sid = synthId(pbSessionId)
  const rows = await pbList('nodes', `filter=${enc(`session='${pbSessionId}'`)}&perPage=1`)
  if (rows.length === 0) {
    return json({ status: 'ok', sessionId: sid, summary: 'No ideas explored yet.', themes: [], insights: [] })
  }
  const { ok, data } = await pbOp('/api/ops/sessions/summarize', { session_id: pbSessionId })
  const summary = ok && data ? String(data.summary ?? '') : ''
  return json({ status: 'ok', sessionId: sid, summary, themes: [], insights: [] })
}

// ---------------------------------------------------------------------------
// Node handlers
// ---------------------------------------------------------------------------

async function handleNodeCreate(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const pbSessionId = pbId(body.sessionId)
  const parentPb = body.parentId != null ? pbId(body.parentId) : ''
  const content = String(body.content ?? '')
  const nodeType = String(body.nodeType ?? 'question')

  let x = CANVAS_CENTER_X
  let y = CANVAS_CENTER_Y
  let depth = 0
  if (parentPb) {
    const resolved = await resolveNodes(pbSessionId)
    const parent = resolved.find((r) => r.pb === parentPb)
    if (parent) {
      const existingCount = resolved.filter((r) => r.parentPb === parentPb).length
      const allPositions = resolved.map((r) => [r.x, r.y] as [number, number])
      const positions = childPositions(parent.x, parent.y, existingCount, 1, allPositions)
      const p = positions[0]!
      x = p[0]; y = p[1]
      depth = parent.depth + 1
    }
  }

  const data: Record<string, unknown> = {
    session: pbSessionId,
    content,
    kind: toPbKind(nodeType),
    x,
    y,
  }
  if (parentPb) data.parent = parentPb
  const created = await pbCreate('nodes', data)
  if (!created) return json({ detail: 'failed to create node' }, 500)
  return json(rawNodeDict(created, pbSessionId, parentPb, toV1Type(toPbKind(nodeType)), 'user', x, y, depth))
}

async function handleNodeUpdate(synthNodeId: string, init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const pbNodeId = pbId(synthNodeId)
  const existing = await pbGet('nodes', pbNodeId)
  if (!existing) return json({ status: 'not_found' })

  const patch: Record<string, unknown> = {}
  if ('content' in body && body.content != null) patch.content = String(body.content)
  if ('nodeType' in body && body.nodeType != null) patch.kind = toPbKind(body.nodeType)
  if ('x' in body && body.x != null) patch.x = num(body.x)
  if ('y' in body && body.y != null) patch.y = num(body.y)
  if (Object.keys(patch).length > 0) await pbPatch('nodes', pbNodeId, patch)

  const pbSessionId = relId(existing.session)
  const resolved = await resolveNodes(pbSessionId)
  const target = resolved.find((r) => r.pb === pbNodeId)
  if (!target) return json({ status: 'not_found' })
  return json(nodeDict(target, pbSessionId))
}

async function handleNodeDelete(synthNodeId: string): Promise<Response> {
  // PocketBase cascades the subtree via the parent relation's cascadeDelete.
  await pbDelete('nodes', pbId(synthNodeId))
  return json({ status: 'deleted' })
}

// ---------------------------------------------------------------------------
// AI handlers (route V1 agent endpoints onto V2 ops)
// ---------------------------------------------------------------------------

async function sessionNodeIdSet(pbSessionId: string): Promise<Set<string>> {
  const rows = await pbList('nodes', `filter=${enc(`session='${pbSessionId}'`)}&sort=created&perPage=500`)
  return new Set(rows.map((r) => String(r.id)))
}

async function handleNodeExpand(synthNodeId: string): Promise<Response> {
  const pbNodeId = pbId(synthNodeId)
  const node = await pbGet('nodes', pbNodeId)
  if (!node) return json({ status: 'not_found' })
  const pbSessionId = relId(node.session)
  const sid = synthId(pbNodeId)

  const before = await sessionNodeIdSet(pbSessionId)
  const { ok } = await pbOp('/api/ops/nodes/suggest', { node_id: pbNodeId })
  if (!ok) return json({ status: 'ok', nodeId: sid, newNodes: [] })

  const resolved = await resolveNodes(pbSessionId)
  const fresh = resolved.filter((r) => !before.has(r.pb) && r.parentPb === pbNodeId)
  const newNodes: Record<string, unknown>[] = []
  for (const r of fresh) {
    agentPbIds.add(r.pb)
    // V1 expand creates answerable "question" children; persist that + position.
    await pbPatch('nodes', r.pb, { kind: 'question', x: r.x, y: r.y })
    newNodes.push({ ...nodeDict(r, pbSessionId), nodeType: 'question' })
  }
  return json({ status: 'ok', nodeId: sid, newNodes })
}

async function handleNodeAnswer(synthNodeId: string): Promise<Response> {
  const pbNodeId = pbId(synthNodeId)
  const node = await pbGet('nodes', pbNodeId)
  if (!node) return json({ status: 'not_found' })
  if (toV1Type(node.kind) !== 'question') {
    return json({ status: 'error', message: 'Only question nodes can be answered' })
  }
  const pbSessionId = relId(node.session)
  const sid = synthId(pbNodeId)

  const before = await sessionNodeIdSet(pbSessionId)
  const { ok } = await pbOp('/api/ops/nodes/answer', { node_id: pbNodeId })
  if (!ok) return json({ status: 'ok', nodeId: sid, node: null })

  const resolved = await resolveNodes(pbSessionId)
  const fresh = resolved.filter((r) => !before.has(r.pb) && r.parentPb === pbNodeId)
  const answer = fresh[0]
  if (!answer) return json({ status: 'ok', nodeId: sid, node: null })
  agentPbIds.add(answer.pb)
  await pbPatch('nodes', answer.pb, { x: answer.x, y: answer.y })
  return json({ status: 'ok', nodeId: sid, node: nodeDict(answer, pbSessionId) })
}

async function handleSessionExplore(synthSessionId: string, init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const strategy = String(body.strategy ?? 'bfs')
  const effort = Math.max(1, Math.min(6, num(body.effort) || 1))
  const pbSessionId = pbId(synthSessionId)

  const emptyResult = {
    status: 'ok', action: 'none', message: 'Nothing left to explore',
    strategy, effort, stepsRun: 0, steps: [] as unknown[], newNodes: [] as unknown[], node: null,
  }

  const before = await sessionNodeIdSet(pbSessionId)
  const { ok } = await pbOp('/api/ops/sessions/explore', { session_id: pbSessionId })
  if (!ok) return json(emptyResult)

  const resolved = await resolveNodes(pbSessionId)
  const fresh = resolved.filter((r) => !before.has(r.pb))
  const newNodes: Record<string, unknown>[] = []
  for (const r of fresh) {
    agentPbIds.add(r.pb)
    await pbPatch('nodes', r.pb, { x: r.x, y: r.y })
    newNodes.push(nodeDict(r, pbSessionId))
  }
  if (newNodes.length === 0) return json(emptyResult)

  // The V2 explore op attaches new angles under the first root node.
  const firstFresh = fresh[0]!
  const targetNodeId = firstFresh.parentPb ? synthId(firstFresh.parentPb) : synthId(firstFresh.pb)
  const reason = 'Expanding into new sub-questions'
  return json({
    status: 'ok',
    action: 'expand',
    targetNodeId,
    reason,
    node: null,
    newNodes,
    strategy,
    effort,
    stepsRun: newNodes.length,
    steps: [{ action: 'expand', targetNodeId, reason }],
  })
}

// ---------------------------------------------------------------------------
// In-memory app state (agent-instrumentation only; UI never reads it)
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

  // Generic app state / actions (agent instrumentation)
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
    return json({ status: 'unknown_action', action: body.action ?? null })
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
  if (path === '/api/settings') {
    if (method === 'GET') return json({})
    return json(readBody(init))
  }

  let m: RegExpMatchArray | null

  // Sessions
  if (path === '/api/sessions') {
    if (method === 'GET') return handleSessionsList()
    if (method === 'POST') return handleSessionCreate(init)
  }
  if ((m = path.match(/^\/api\/sessions\/([^/]+)\/nodes$/)) && method === 'GET') {
    return handleSessionNodes(decodeURIComponent(m[1] as string))
  }
  if ((m = path.match(/^\/api\/sessions\/([^/]+)\/summary$/)) && method === 'GET') {
    return handleSessionSummary(decodeURIComponent(m[1] as string))
  }
  if ((m = path.match(/^\/api\/sessions\/([^/]+)\/explore$/)) && method === 'POST') {
    return handleSessionExplore(decodeURIComponent(m[1] as string), init)
  }
  if ((m = path.match(/^\/api\/sessions\/([^/]+)$/))) {
    const id = decodeURIComponent(m[1] as string)
    if (method === 'PUT') return handleSessionUpdate(id, init)
    if (method === 'DELETE') return handleSessionDelete(id)
  }

  // Nodes
  if (path === '/api/nodes' && method === 'POST') return handleNodeCreate(init)
  if ((m = path.match(/^\/api\/nodes\/([^/]+)\/expand$/)) && method === 'POST') {
    return handleNodeExpand(decodeURIComponent(m[1] as string))
  }
  if ((m = path.match(/^\/api\/nodes\/([^/]+)\/answer$/)) && method === 'POST') {
    return handleNodeAnswer(decodeURIComponent(m[1] as string))
  }
  if ((m = path.match(/^\/api\/nodes\/([^/]+)$/))) {
    const id = decodeURIComponent(m[1] as string)
    if (method === 'PUT') return handleNodeUpdate(id, init)
    if (method === 'DELETE') return handleNodeDelete(id)
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
