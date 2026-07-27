/**
 * apiAdapter.ts — client-side fetch shim that lets the UNCHANGED V1
 * (Python/FastAPI) multi-user CRM frontend run against the V2 PocketBase
 * backend.
 *
 * HOW IT WORKS
 * ------------
 * On import this module sets `window.__CRAFTBOT_BACKEND_URL__` to a sentinel
 * host (`http://living-ui.local`). Every V1 module (api.ts, AuthService) reads
 * that global at eval time and builds request URLs like `${BACKEND_URL}/api/...`,
 * so all their traffic is aimed at the sentinel host.
 *
 * `installApiAdapter()` monkeypatches `window.fetch`:
 *   - Requests to the sentinel host are routed to a local handler that returns
 *     a synthetic Response shaped EXACTLY like the V1 FastAPI backend.
 *   - Every other request (real same-origin `/api/collections/*`, `/api/ops/*`,
 *     `/api/files/*`) is passed straight through to the captured original fetch,
 *     which hits the PocketBase server that serves the page.
 *   - Handlers themselves call the captured original fetch with RELATIVE urls so
 *     they reach that same PocketBase server.
 *
 * AUTH
 * ----
 * Login is performed by the V2 platform kit's <LoginGate> (authMode=multi-user).
 * After login the kit persists a PocketBase session in localStorage under
 * `pocketbase_auth` as JSON `{ token, record }`. This adapter RIDES on that
 * session: every PB call it makes sends `Authorization: Bearer <token>` read
 * from that key — all CRM collections are auth-gated (`@request.auth.id != ""`),
 * so without it every read/write would 403. The V1 AuthService keys off its own
 * `auth_token` localStorage entry (it short-circuits getMe() when absent); on
 * install we mirror the PocketBase token into `auth_token` so it proceeds.
 *
 * ID BRIDGE (critical)
 * --------------------
 * The V1 frontend types every id as `number` and Number()-coerces ids out of
 * hash-route segments and dnd payloads (e.g. `Number(route.parts[2])`,
 * `Number(active.id)`). PocketBase ids are 15-char strings, so surfacing them
 * raw would break routing, board drag, and Set membership. We therefore keep a
 * bidirectional int<->pbId map (persisted in localStorage `crm_id_map`) and hand
 * the UI stable integer ids, translating back to PB string ids on every call.
 *
 * SYNTHESIS NOTES (where PocketBase can't reproduce V1 exactly)
 * ------------------------------------------------------------
 *   - Main deal pipeline: V1 modelled it as a RecordList of deals. PB has no
 *     backing `lists` row for it — deals carry a direct `stage` relation and the
 *     pipeline stages are `stages` rows with an empty `list`. We expose a single
 *     VIRTUAL list ("Sales Pipeline", id = MAIN_PIPELINE) so the sidebar,
 *     board, reports and record memberships stay coherent; its entries are
 *     synthesised from deals grouped by `deals.stage`.
 *   - Deal status (open|won|lost): PB has no status field. It is derived from
 *     the deal's stage name (won/lost) and set by moving the deal's stage.
 *   - Slim schema gaps: person.linkedin/location/description,
 *     company.size/location/annualRevenue/linkedin/description, deal.owner/
 *     currency, note.title/pinned, task.description, activity actor/extra, and
 *     lastInteractionAt have no PB column and round-trip as defaults.
 *   - Tags use per-record PB relation arrays (no record_tags table); members/
 *     invites and AI-run audit are decorative (no backing collection).
 */

const SENTINEL = 'http://living-ui.local'

// Set the sentinel at import time so component modules pick it up on eval.
;(window as unknown as { __CRAFTBOT_BACKEND_URL__?: string }).__CRAFTBOT_BACKEND_URL__ = SENTINEL

const CREATED_AT = '2024-01-01T00:00:00Z'
const enc = encodeURIComponent

// Virtual list id (a PB-shaped sentinel) representing the main deal pipeline.
const MAIN_PIPELINE = 'mainpipeline000'

type PbRecord = Record<string, unknown>
type RecordType = 'person' | 'company' | 'deal'

const TYPE_TO_COLLECTION: Record<RecordType, string> = {
  person: 'people',
  company: 'companies',
  deal: 'deals',
}
const COLLECTION_TO_TYPE: Record<string, RecordType> = {
  people: 'person',
  companies: 'company',
  deals: 'deal',
}
const TYPE_TITLES: Record<RecordType, string> = { person: 'People', company: 'Companies', deal: 'Deals' }

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
function genId(): string { return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}` }

function toBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  const s = String(v).toLowerCase()
  return s === 'true' || s === '1'
}

function toNum(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

const PASTEL = [
  '#7c9ce8', '#8fbf8f', '#d9a662', '#c98bc9', '#6fbfbf',
  '#e08e8e', '#a3a3e0', '#b5a642', '#7fb3d9', '#c4967a',
]
function pickColor(seed: string): string {
  const s = seed || 'x'
  let sum = 0
  for (let i = 0; i < s.length; i++) sum += s.charCodeAt(i)
  return PASTEL[sum % PASTEL.length]!
}

function slugify(name: string): string {
  const t = (name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
  const s = t.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase()
  return s || 'field'
}

function splitName(name: string): { first: string; last: string } {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { first: '', last: '' }
  return { first: parts[0]!, last: parts.slice(1).join(' ') }
}

function stageFlags(name: string): { isWon: boolean; isLost: boolean } {
  const n = (name || '').toLowerCase()
  return { isWon: n.includes('won'), isLost: n.includes('lost') }
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
function syncAuthToken(): void {
  try {
    const t = authToken()
    if (t && !localStorage.getItem('auth_token')) localStorage.setItem('auth_token', t)
  } catch { /* ignore */ }
}
function currentUsername(): string {
  const rec = currentUserRecord()
  if (!rec) return ''
  return String(rec.username ?? rec.name ?? rec.email ?? '')
}

// ---------------------------------------------------------------------------
// Integer <-> PocketBase id bridge
// ---------------------------------------------------------------------------

const intToPb = new Map<number, string>()
const pbToInt = new Map<string, number>()
let idCounter = 1000

function loadIdMap(): void {
  try {
    const raw = localStorage.getItem('crm_id_map')
    if (!raw) return
    const parsed = JSON.parse(raw) as { c?: number; m?: Record<string, number> }
    idCounter = typeof parsed.c === 'number' ? parsed.c : 1000
    for (const [pb, i] of Object.entries(parsed.m || {})) {
      intToPb.set(i, pb)
      pbToInt.set(pb, i)
    }
  } catch { /* ignore */ }
}
function saveIdMap(): void {
  try {
    const m: Record<string, number> = {}
    for (const [pb, i] of pbToInt) m[pb] = i
    localStorage.setItem('crm_id_map', JSON.stringify({ c: idCounter, m }))
  } catch { /* ignore */ }
}
/** Map a PB string id (or synthetic token) to a stable integer. */
function iid(pbId: string): number {
  const existing = pbToInt.get(pbId)
  if (existing !== undefined) return existing
  const next = ++idCounter
  intToPb.set(next, pbId)
  pbToInt.set(pbId, next)
  saveIdMap()
  return next
}
/** Reverse a UI integer (or numeric string) back to a PB string id. */
function pid(intId: unknown): string | null {
  if (intId == null) return null
  const n = Number(intId)
  if (!Number.isFinite(n)) return typeof intId === 'string' ? intId : null
  return intToPb.get(n) ?? null
}

// ---------------------------------------------------------------------------
// PocketBase REST helpers (relative urls → PocketBase serving the page)
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

async function pbDeleteWhere(collection: string, filter: string): Promise<void> {
  const rows = await pbList(collection, `perPage=200&filter=${enc(filter)}`)
  for (const r of rows) await pbDelete(collection, String(r.id))
}

async function opPost(path: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  try {
    const res = await originalFetch(path, {
      method: 'POST',
      headers: pbHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    return { ok: res.ok, status: res.status, data }
  } catch { return { ok: false, status: 0, data: {} } }
}

async function opGet(path: string): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  try {
    const res = await originalFetch(path, { headers: pbHeaders() })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    return { ok: res.ok, status: res.status, data }
  } catch { return { ok: false, status: 0, data: {} } }
}

// ---------------------------------------------------------------------------
// Reference-data caches (per request tick these are cheap; small collections)
// ---------------------------------------------------------------------------

async function loadTagMap(): Promise<Map<string, PbRecord>> {
  const rows = await pbList('tags', 'perPage=200&sort=name')
  return new Map(rows.map((r) => [String(r.id), r]))
}
function tagDict(rec: PbRecord): Record<string, unknown> {
  return { id: iid(String(rec.id)), name: String(rec.name ?? ''), color: String(rec.color ?? '#8b8b94') }
}
function tagDicts(ids: unknown, tagMap: Map<string, PbRecord>): Record<string, unknown>[] {
  const list = Array.isArray(ids) ? (ids as unknown[]).map(String) : []
  return list.map((id) => tagMap.get(id)).filter((t): t is PbRecord => t != null).map(tagDict)
}

async function loadCompanyMap(): Promise<Map<string, PbRecord>> {
  const rows = await pbList('companies', 'perPage=200')
  return new Map(rows.map((r) => [String(r.id), r]))
}

// entity attributes → { pbId: {slug,name,realType,options} } and slug lookup
interface AttrMeta { pbId: string; slug: string; name: string; realType: string; options: unknown[] }
async function loadAttributes(entity: string): Promise<AttrMeta[]> {
  const rows = await pbList('attributes', `perPage=200&sort=created&filter=${enc(`entity='${entity}'`)}`)
  return rows.map((r) => {
    let realType = String(r.type ?? 'text')
    let options: unknown[] = []
    try {
      const parsed = JSON.parse(String(r.options ?? '')) as { t?: string; o?: unknown[] }
      if (parsed && typeof parsed === 'object') {
        if (parsed.t) realType = String(parsed.t)
        if (Array.isArray(parsed.o)) options = parsed.o
      }
    } catch { /* options was not JSON */ }
    return { pbId: String(r.id), slug: slugify(String(r.name ?? '')), name: String(r.name ?? ''), realType, options }
  })
}

async function valuesForRecords(entity: string, pbIds: string[]): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>()
  if (pbIds.length === 0) return out
  const attrs = await loadAttributes(entity)
  if (attrs.length === 0) return out
  const attrById = new Map(attrs.map((a) => [a.pbId, a]))
  const rows = await pbList('attribute_values', 'perPage=200')
  for (const row of rows) {
    const recId = String(row.record_id ?? '')
    if (!pbIds.includes(recId)) continue
    const attr = attrById.get(String(row.attribute ?? ''))
    if (!attr) continue
    let value: unknown = row.value
    try { value = JSON.parse(String(row.value ?? '')) } catch { value = row.value }
    const bucket = out.get(recId) ?? {}
    bucket[attr.slug] = value
    out.set(recId, bucket)
  }
  return out
}

// ---------------------------------------------------------------------------
// Record shape mappers (V1 to_dict payloads)
// ---------------------------------------------------------------------------

function personRow(rec: PbRecord): Record<string, unknown> {
  const name = String(rec.name ?? '') || 'Unnamed person'
  const { first, last } = splitName(name)
  const email = String(rec.email ?? '')
  const phone = String(rec.phone ?? '')
  return {
    id: iid(String(rec.id)),
    recordType: 'person',
    name,
    firstName: first,
    lastName: last,
    emails: email ? [email] : [],
    phones: phone ? [phone] : [],
    jobTitle: String(rec.title ?? ''),
    companyId: rec.company ? iid(String(rec.company)) : null,
    linkedin: '',
    location: '',
    avatarColor: pickColor(name),
    description: '',
    lastInteractionAt: null,
    createdAt: rec.created ? String(rec.created) : CREATED_AT,
    updatedAt: rec.updated ? String(rec.updated) : CREATED_AT,
  }
}

function companyRow(rec: PbRecord): Record<string, unknown> {
  const name = String(rec.name ?? '') || String(rec.domain ?? '') || 'Unnamed company'
  return {
    id: iid(String(rec.id)),
    recordType: 'company',
    name,
    domain: String(rec.domain ?? ''),
    industry: String(rec.industry ?? ''),
    size: '',
    location: '',
    annualRevenue: null,
    linkedin: '',
    avatarColor: pickColor(name),
    description: '',
    lastInteractionAt: null,
    createdAt: rec.created ? String(rec.created) : CREATED_AT,
    updatedAt: rec.updated ? String(rec.updated) : CREATED_AT,
  }
}

function dealRow(rec: PbRecord, stageById: Map<string, PbRecord>): Record<string, unknown> {
  const name = String(rec.name ?? '') || 'Unnamed deal'
  const stage = rec.stage ? stageById.get(String(rec.stage)) : undefined
  const flags = stageFlags(stage ? String(stage.name ?? '') : '')
  const status = flags.isWon ? 'won' : flags.isLost ? 'lost' : 'open'
  const persons = Array.isArray(rec.person) ? (rec.person as unknown[]).map(String) : []
  return {
    id: iid(String(rec.id)),
    recordType: 'deal',
    name,
    value: toNum(rec.value, 0),
    currency: 'USD',
    companyId: rec.company ? iid(String(rec.company)) : null,
    primaryPersonId: persons[0] ? iid(persons[0]) : null,
    owner: '',
    status,
    expectedCloseDate: rec.close_date ? String(rec.close_date) : '',
    closedAt: status === 'won' || status === 'lost' ? (rec.updated ? String(rec.updated) : null) : null,
    lastInteractionAt: null,
    createdAt: rec.created ? String(rec.created) : CREATED_AT,
    updatedAt: rec.updated ? String(rec.updated) : CREATED_AT,
  }
}

function recordBrief(rec: PbRecord | null, type: RecordType, stageById?: Map<string, PbRecord>): Record<string, unknown> | null {
  if (!rec) return null
  if (type === 'person') {
    const name = String(rec.name ?? '') || 'Unnamed person'
    return { id: iid(String(rec.id)), recordType: 'person', name, avatarColor: pickColor(name), email: String(rec.email ?? '') }
  }
  if (type === 'company') {
    const name = String(rec.name ?? '') || String(rec.domain ?? '') || 'Unnamed company'
    return { id: iid(String(rec.id)), recordType: 'company', name, avatarColor: pickColor(name), domain: String(rec.domain ?? '') }
  }
  const name = String(rec.name ?? '') || 'Unnamed deal'
  const stage = stageById && rec.stage ? stageById.get(String(rec.stage)) : undefined
  const flags = stageFlags(stage ? String(stage.name ?? '') : '')
  return {
    id: iid(String(rec.id)), recordType: 'deal', name, avatarColor: pickColor(name),
    value: toNum(rec.value, 0), currency: 'USD', status: flags.isWon ? 'won' : flags.isLost ? 'lost' : 'open',
  }
}

function mapRow(rec: PbRecord, type: RecordType, stageById: Map<string, PbRecord>): Record<string, unknown> {
  if (type === 'person') return personRow(rec)
  if (type === 'company') return companyRow(rec)
  return dealRow(rec, stageById)
}

// ---------------------------------------------------------------------------
// Stage / list mappers
// ---------------------------------------------------------------------------

function stageDict(rec: PbRecord, listIntId: number): Record<string, unknown> {
  const name = String(rec.name ?? '')
  const flags = stageFlags(name)
  return {
    id: iid(String(rec.id)),
    listId: listIntId,
    name,
    color: String(rec.color ?? '#8b8b94'),
    position: toNum(rec.order, 0),
    isWon: flags.isWon,
    isLost: flags.isLost,
    probability: null,
  }
}

function virtualListInfo(entryCount: number, stages?: Record<string, unknown>[]): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: iid(MAIN_PIPELINE),
    name: 'Sales Pipeline',
    icon: 'kanban',
    color: '',
    parentObject: 'deal',
    description: 'All deals by pipeline stage',
    position: -1,
    createdAt: CREATED_AT,
    entryCount,
  }
  if (stages) base.stages = stages
  return base
}

function listInfo(rec: PbRecord, stages: Record<string, unknown>[], entryCount: number): Record<string, unknown> {
  const entity = String(rec.entity ?? 'deals')
  return {
    id: iid(String(rec.id)),
    name: String(rec.name ?? ''),
    icon: entity === 'deals' ? 'kanban' : 'list',
    color: '',
    parentObject: COLLECTION_TO_TYPE[entity] ?? 'deal',
    description: String(rec.description ?? ''),
    position: 0,
    createdAt: rec.created ? String(rec.created) : CREATED_AT,
    stages,
    entryCount,
  }
}

/** Main pipeline stages = stages with an empty `list` relation, ordered. */
async function loadStages(): Promise<PbRecord[]> {
  return pbList('stages', 'perPage=200&sort=order')
}
function mainStagesOf(all: PbRecord[]): PbRecord[] {
  return all.filter((s) => !s.list || String(s.list) === '').sort((a, b) => toNum(a.order) - toNum(b.order))
}
function listStagesOf(all: PbRecord[], pbListId: string): PbRecord[] {
  return all.filter((s) => String(s.list ?? '') === pbListId).sort((a, b) => toNum(a.order) - toNum(b.order))
}

// ---------------------------------------------------------------------------
// Activity logging (mirror V1 log_activity so timeline/reports have content)
// ---------------------------------------------------------------------------

async function writeActivity(type: RecordType, pbRecordId: string, kind: string, text: string): Promise<void> {
  const data: Record<string, unknown> = { kind, body: text || kind }
  data[type] = pbRecordId
  await pbCreate('activities', data)
}

// ---------------------------------------------------------------------------
// Serialize a full record row (system fields + attributes + tags + company)
// ---------------------------------------------------------------------------

async function serializeRows(
  recs: PbRecord[],
  type: RecordType,
  stageById: Map<string, PbRecord>,
): Promise<Record<string, unknown>[]> {
  const tagMap = await loadTagMap()
  const companyMap = type === 'person' || type === 'deal' ? await loadCompanyMap() : new Map<string, PbRecord>()
  const entity = TYPE_TO_COLLECTION[type]
  const valMap = await valuesForRecords(entity, recs.map((r) => String(r.id)))
  return recs.map((rec) => {
    const row = mapRow(rec, type, stageById)
    row.attributes = valMap.get(String(rec.id)) ?? {}
    row.tags = tagDicts(rec.tags, tagMap)
    const companyId = rec.company ? String(rec.company) : ''
    if (companyId) {
      const company = companyMap.get(companyId)
      row.company = company ? recordBrief(company, 'company') : null
    }
    return row
  })
}

// ---------------------------------------------------------------------------
// Query (records table)
// ---------------------------------------------------------------------------

function filterMatch(row: Record<string, unknown>, flt: Record<string, unknown>): boolean {
  const field = String(flt.field ?? '')
  const operator = String(flt.operator ?? 'eq')
  const expected = flt.value
  const attrs = (row.attributes as Record<string, unknown>) ?? {}
  const actual = field in row ? row[field] : attrs[field]
  if (operator === 'is_empty') return actual == null || actual === '' || (Array.isArray(actual) && actual.length === 0)
  if (operator === 'not_empty') return !(actual == null || actual === '' || (Array.isArray(actual) && actual.length === 0))
  if (actual == null) return false
  if (operator === 'eq') {
    if (typeof actual === 'number') return actual === Number(expected)
    return String(actual).toLowerCase() === String(expected).toLowerCase()
  }
  if (operator === 'neq') return !filterMatch(row, { ...flt, operator: 'eq' })
  if (operator === 'contains') {
    if (Array.isArray(actual)) return actual.some((i) => String(i).toLowerCase().includes(String(expected).toLowerCase()))
    return String(actual).toLowerCase().includes(String(expected).toLowerCase())
  }
  if (operator === 'not_contains') return !filterMatch(row, { ...flt, operator: 'contains' })
  if (operator === 'has') return Array.isArray(actual) ? actual.map(String).includes(String(expected)) : actual === expected
  const an = Number(actual)
  const en = Number(expected)
  const numeric = Number.isFinite(an) && Number.isFinite(en)
  if (operator === 'gt' || operator === 'after') return numeric ? an > en : String(actual) > String(expected)
  if (operator === 'lt' || operator === 'before') return numeric ? an < en : String(actual) < String(expected)
  if (operator === 'gte') return numeric ? an >= en : String(actual) >= String(expected)
  if (operator === 'lte') return numeric ? an <= en : String(actual) <= String(expected)
  return false
}

function searchHaystack(row: Record<string, unknown>, type: RecordType): string {
  const parts: unknown[] = [row.name]
  if (type === 'person') parts.push(...(row.emails as unknown[] ?? []), row.jobTitle, row.location)
  else if (type === 'company') parts.push(row.domain, row.industry, row.location)
  else parts.push(row.owner, row.status)
  return parts.map((p) => String(p ?? '')).join(' ').toLowerCase()
}

async function runQuery(type: RecordType, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const allStages = await loadStages()
  const stageById = new Map(allStages.map((s) => [String(s.id), s]))
  const collection = TYPE_TO_COLLECTION[type]

  const listId = body.list_id != null ? Number(body.list_id) : null
  const pbListId = listId != null ? pid(listId) : null
  let recs: PbRecord[]
  let entryByRecord = new Map<string, PbRecord>()

  if (pbListId === MAIN_PIPELINE) {
    recs = await pbList(collection, 'perPage=200')
  } else if (pbListId) {
    const entries = await pbList('list_entries', `perPage=200&filter=${enc(`list='${pbListId}'`)}`)
    entryByRecord = new Map(entries.map((e) => [String(e.record_id), e]))
    const ids = entries.map((e) => String(e.record_id))
    recs = []
    for (const id of ids) {
      const r = await pbGet(collection, id)
      if (r) recs.push(r)
    }
  } else {
    recs = await pbList(collection, 'perPage=200')
  }

  let rows = await serializeRows(recs, type, stageById)

  // Attach entry + stage for list rows
  if (pbListId === MAIN_PIPELINE) {
    const mainStages = mainStagesOf(allStages)
    const mainStageIntByPb = new Map(mainStages.map((s) => [String(s.id), stageDict(s, iid(MAIN_PIPELINE))]))
    rows = rows.map((row, i) => {
      const rec = recs[i]!
      const stagePb = rec.stage ? String(rec.stage) : ''
      const entryId = iid(`mpentry:${String(rec.id)}`)
      row.entry = {
        id: entryId, listId: iid(MAIN_PIPELINE), recordType: 'deal', recordId: row.id,
        stageId: stagePb && mainStageIntByPb.has(stagePb) ? iid(stagePb) : null,
        position: i, stageEnteredAt: row.updatedAt, createdAt: row.createdAt,
      }
      row.stage = stagePb ? mainStageIntByPb.get(stagePb) ?? null : null
      return row
    })
  } else if (pbListId && entryByRecord.size > 0) {
    const listStages = listStagesOf(allStages, pbListId)
    const listStageDict = new Map(listStages.map((s) => [String(s.id), stageDict(s, iid(pbListId))]))
    rows = rows.map((row, i) => {
      const rec = recs[i]!
      const entry = entryByRecord.get(String(rec.id))
      if (entry) {
        const stagePb = entry.stage ? String(entry.stage) : ''
        row.entry = {
          id: iid(String(entry.id)), listId: iid(pbListId), recordType: type, recordId: row.id,
          stageId: stagePb ? iid(stagePb) : null, position: toNum(entry.position),
          stageEnteredAt: entry.created ? String(entry.created) : row.createdAt,
          createdAt: entry.created ? String(entry.created) : row.createdAt,
        }
        row.stage = stagePb ? listStageDict.get(stagePb) ?? null : null
      }
      return row
    })
  }

  // Search
  const search = String(body.search ?? '').trim().toLowerCase()
  if (search) rows = rows.filter((r) => searchHaystack(r, type).includes(search))

  // Filters
  const filters = Array.isArray(body.filters) ? (body.filters as Record<string, unknown>[]) : []
  for (const flt of filters) rows = rows.filter((r) => filterMatch(r, flt))

  // Sorts
  const sorts = Array.isArray(body.sorts) && body.sorts.length > 0
    ? (body.sorts as Record<string, unknown>[])
    : [{ field: 'createdAt', dir: 'desc' }]
  for (const sort of [...sorts].reverse()) {
    const field = String(sort.field ?? 'createdAt')
    const reverse = String(sort.dir ?? 'asc') === 'desc'
    rows.sort((a, b) => {
      const av = field in a ? a[field] : ((a.attributes as Record<string, unknown>) ?? {})[field]
      const bv = field in b ? b[field] : ((b.attributes as Record<string, unknown>) ?? {})[field]
      const aEmpty = av == null || av === '' || (Array.isArray(av) && av.length === 0)
      const bEmpty = bv == null || bv === '' || (Array.isArray(bv) && bv.length === 0)
      if (aEmpty && bEmpty) return 0
      if (aEmpty) return 1
      if (bEmpty) return -1
      let cmp: number
      if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv
      else cmp = String(Array.isArray(av) ? av[0] : av).toLowerCase() < String(Array.isArray(bv) ? bv[0] : bv).toLowerCase() ? -1 : 1
      return reverse ? -cmp : cmp
    })
  }

  const total = rows.length
  const page = Math.max(1, toNum(body.page, 1))
  const pageSize = Math.min(200, Math.max(1, toNum(body.page_size, 50)))
  const start = (page - 1) * pageSize
  return { items: rows.slice(start, start + pageSize), total, page, pageSize }
}
// ---------------------------------------------------------------------------
// Records CRUD
// ---------------------------------------------------------------------------

async function findDuplicates(type: RecordType, email = '', domain = '', name = '', excludePb = ''): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  if (type === 'person' && email) {
    const rows = await pbList('people', `perPage=50&filter=${enc(`email~'${email.replace(/'/g, "")}'`)}`)
    for (const r of rows) if (String(r.id) !== excludePb && String(r.email ?? '').toLowerCase() === email.toLowerCase()) {
      const b = recordBrief(r, 'person'); if (b) out.push(b)
    }
  } else if (type === 'company' && domain) {
    const rows = await pbList('companies', `perPage=50&filter=${enc(`domain~'${domain.replace(/'/g, "")}'`)}`)
    for (const r of rows) if (String(r.id) !== excludePb && String(r.domain ?? '').toLowerCase() === domain.toLowerCase()) {
      const b = recordBrief(r, 'company'); if (b) out.push(b)
    }
  } else if (name) {
    const collection = TYPE_TO_COLLECTION[type]
    const rows = await pbList(collection, `perPage=5&filter=${enc(`name~'${name.replace(/'/g, "")}'`)}`)
    for (const r of rows) if (String(r.id) !== excludePb) { const b = recordBrief(r, type); if (b) out.push(b) }
  }
  return out
}

async function firstMainStagePb(): Promise<string | null> {
  const stages = mainStagesOf(await loadStages())
  return stages[0] ? String(stages[0].id) : null
}

async function handleRecordCreate(type: RecordType, init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const collection = TYPE_TO_COLLECTION[type]
  let data: Record<string, unknown> = {}

  if (type === 'person') {
    const emails = Array.isArray(body.emails) ? (body.emails as unknown[]).map(String) : []
    const phones = Array.isArray(body.phones) ? (body.phones as unknown[]).map(String) : []
    const first = String(body.first_name ?? '')
    const last = String(body.last_name ?? '')
    const name = `${first} ${last}`.trim() || emails[0] || 'Unnamed person'
    data = { name, email: emails[0] ?? '', phone: phones[0] ?? '', title: String(body.job_title ?? '') }
    const cpb = body.company_id != null ? pid(body.company_id) : null
    if (cpb) data.company = cpb
  } else if (type === 'company') {
    data = { name: String(body.name ?? '') || 'Unnamed company', domain: String(body.domain ?? ''), industry: String(body.industry ?? '') }
  } else {
    const stagePb = body.stage_id != null ? pid(body.stage_id) : null
    data = {
      name: String(body.name ?? '') || 'Unnamed deal',
      value: toNum(body.value, 0),
      stage: stagePb ?? (await firstMainStagePb()),
      close_date: String(body.expected_close_date ?? ''),
    }
    const cpb = body.company_id != null ? pid(body.company_id) : null
    if (cpb) data.company = cpb
    const ppb = body.primary_person_id != null ? pid(body.primary_person_id) : null
    if (ppb) data.person = [ppb]
  }

  const created = await pbCreate(collection, data)
  if (!created) return json({ detail: `Failed to create ${type}` }, 400)
  const createdPb = String(created.id)

  // Optional list placement (real user lists only; main pipeline needs no entry)
  const listId = body.list_id != null ? Number(body.list_id) : null
  const pbListId = listId != null ? pid(listId) : null
  if (pbListId && pbListId !== MAIN_PIPELINE) {
    const allStages = await loadStages()
    let stagePb = body.stage_id != null ? pid(body.stage_id) : null
    if (!stagePb) { const ls = listStagesOf(allStages, pbListId); stagePb = ls[0] ? String(ls[0].id) : null }
    const data2: Record<string, unknown> = { list: pbListId, record_id: createdPb, position: 0 }
    if (stagePb) data2.stage = stagePb
    await pbCreate('list_entries', data2)
  }

  await writeActivity(type, createdPb, 'created', `${String(created.name ?? '')} created`)

  const allStages = await loadStages()
  const stageById = new Map(allStages.map((s) => [String(s.id), s]))
  const rows = await serializeRows([created], type, stageById)
  const row = rows[0]!
  const email = type === 'person' ? String(created.email ?? '') : ''
  row.duplicates = await findDuplicates(type, email, String(body.domain ?? ''), '', createdPb)
  return json(row)
}

async function handleRecordQuery(type: RecordType, init?: RequestInit): Promise<Response> {
  return json(await runQuery(type, readBody(init)))
}

async function handleRecordGet(type: RecordType, intId: number): Promise<Response> {
  const pbId = pid(intId)
  const collection = TYPE_TO_COLLECTION[type]
  if (!pbId) return json({ status: 'not_found', record: null })
  const rec = await pbGet(collection, pbId)
  if (!rec) return json({ status: 'not_found', record: null })

  const allStages = await loadStages()
  const stageById = new Map(allStages.map((s) => [String(s.id), s]))
  const rows = await serializeRows([rec], type, stageById)
  const row = rows[0]!

  // Memberships: real list_entries + (for deals) the main pipeline
  const memberships: Record<string, unknown>[] = []
  const entries = await pbList('list_entries', `perPage=200&filter=${enc(`record_id='${pbId}'`)}`)
  for (const entry of entries) {
    const listPb = String(entry.list ?? '')
    const listRec = await pbGet('lists', listPb)
    if (!listRec) continue
    const listStages = listStagesOf(allStages, listPb)
    const stageDicts = listStages.map((s) => stageDict(s, iid(listPb)))
    const stagePb = entry.stage ? String(entry.stage) : ''
    memberships.push({
      entry: {
        id: iid(String(entry.id)), listId: iid(listPb), recordType: type, recordId: intId,
        stageId: stagePb ? iid(stagePb) : null, position: toNum(entry.position),
        stageEnteredAt: entry.created ? String(entry.created) : CREATED_AT,
        createdAt: entry.created ? String(entry.created) : CREATED_AT,
      },
      list: listInfo(listRec, stageDicts, 0),
      stage: stagePb ? stageDicts.find((s) => s.id === iid(stagePb)) ?? null : null,
    })
  }
  if (type === 'deal') {
    const mainStages = mainStagesOf(allStages)
    const mainDicts = mainStages.map((s) => stageDict(s, iid(MAIN_PIPELINE)))
    const stagePb = rec.stage ? String(rec.stage) : ''
    memberships.push({
      entry: {
        id: iid(`mpentry:${pbId}`), listId: iid(MAIN_PIPELINE), recordType: 'deal', recordId: intId,
        stageId: stagePb ? iid(stagePb) : null, position: 0,
        stageEnteredAt: row.updatedAt, createdAt: row.createdAt,
      },
      list: virtualListInfo(0, mainDicts),
      stage: stagePb ? mainDicts.find((s) => s.id === iid(stagePb)) ?? null : null,
    })
  }

  // Related records
  const related: { people: unknown[]; companies: unknown[]; deals: unknown[] } = { people: [], companies: [], deals: [] }
  if (type === 'person') {
    if (rec.company) { const c = await pbGet('companies', String(rec.company)); const b = recordBrief(c, 'company'); if (b) related.companies.push(b) }
    const deals = await pbList('deals', `perPage=200&filter=${enc(`person~'${pbId}'`)}`)
    related.deals = deals.map((d) => recordBrief(d, 'deal', stageById)).filter(Boolean) as Record<string, unknown>[]
  } else if (type === 'company') {
    const people = await pbList('people', `perPage=200&filter=${enc(`company='${pbId}'`)}`)
    related.people = people.map((p) => recordBrief(p, 'person')).filter(Boolean) as Record<string, unknown>[]
    const deals = await pbList('deals', `perPage=200&filter=${enc(`company='${pbId}'`)}`)
    related.deals = deals.map((d) => recordBrief(d, 'deal', stageById)).filter(Boolean) as Record<string, unknown>[]
  } else {
    if (rec.company) { const c = await pbGet('companies', String(rec.company)); const b = recordBrief(c, 'company'); if (b) related.companies.push(b) }
    const personIds = Array.isArray(rec.person) ? (rec.person as unknown[]).map(String) : []
    for (const pidStr of personIds) { const p = await pbGet('people', pidStr); const b = recordBrief(p, 'person'); if (b) related.people.push(b) }
  }

  row.memberships = memberships
  row.related = related
  return json({ status: 'ok', record: row })
}

async function handleRecordUpdate(type: RecordType, intId: number, init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const pbId = pid(intId)
  const collection = TYPE_TO_COLLECTION[type]
  if (!pbId) return json({ status: 'not_found', resource: type })
  const rec = await pbGet(collection, pbId)
  if (!rec) return json({ status: 'not_found', resource: type })

  const patch: Record<string, unknown> = {}
  const changed: string[] = []
  if (type === 'person') {
    if (body.first_name != null || body.last_name != null) {
      const cur = splitName(String(rec.name ?? ''))
      const first = body.first_name != null ? String(body.first_name) : cur.first
      const last = body.last_name != null ? String(body.last_name) : cur.last
      patch.name = `${first} ${last}`.trim() || 'Unnamed person'; changed.push('name')
    }
    if (Array.isArray(body.emails)) { patch.email = String((body.emails as unknown[])[0] ?? ''); changed.push('emails') }
    if (Array.isArray(body.phones)) { patch.phone = String((body.phones as unknown[])[0] ?? ''); changed.push('phones') }
    if (body.job_title != null) { patch.title = String(body.job_title); changed.push('job_title') }
    if (body.company_id !== undefined) { patch.company = body.company_id != null ? pid(body.company_id) ?? '' : ''; changed.push('company_id') }
  } else if (type === 'company') {
    if (body.name != null) { patch.name = String(body.name); changed.push('name') }
    if (body.domain != null) { patch.domain = String(body.domain); changed.push('domain') }
    if (body.industry != null) { patch.industry = String(body.industry); changed.push('industry') }
  } else {
    if (body.name != null) { patch.name = String(body.name); changed.push('name') }
    if (body.value != null) { patch.value = toNum(body.value, 0); changed.push('value') }
    if (body.expected_close_date != null) { patch.close_date = String(body.expected_close_date); changed.push('expected_close_date') }
    if (body.company_id !== undefined) { patch.company = body.company_id != null ? pid(body.company_id) ?? '' : ''; changed.push('company_id') }
    if (body.primary_person_id !== undefined) {
      const existing = Array.isArray(rec.person) ? (rec.person as unknown[]).map(String) : []
      const ppb = body.primary_person_id != null ? pid(body.primary_person_id) : null
      patch.person = ppb ? [ppb, ...existing.filter((x) => x !== ppb)] : existing
      changed.push('primary_person_id')
    }
    if (body.status != null && ['open', 'won', 'lost'].includes(String(body.status))) {
      const allStages = mainStagesOf(await loadStages())
      const target = String(body.status)
      let stagePb: string | null = null
      if (target === 'won') stagePb = (allStages.find((s) => stageFlags(String(s.name ?? '')).isWon) ?? null)?.id as string ?? null
      else if (target === 'lost') stagePb = (allStages.find((s) => stageFlags(String(s.name ?? '')).isLost) ?? null)?.id as string ?? null
      else stagePb = (allStages.find((s) => { const f = stageFlags(String(s.name ?? '')); return !f.isWon && !f.isLost }) ?? null)?.id as string ?? null
      if (stagePb) { patch.stage = stagePb; changed.push('status'); await writeActivity('deal', pbId, 'stage_change', `Moved to ${String((await pbGet('stages', stagePb))?.name ?? '')}`) }
    }
  }

  if (Object.keys(patch).length > 0) {
    const updated = await pbPatch(collection, pbId, patch)
    if (updated) Object.assign(rec, updated)
    for (const f of changed) if (f !== 'status') await writeActivity(type, pbId, 'field_change', `${f} updated`)
  }

  // Custom attribute writes
  if (body.attributes && typeof body.attributes === 'object') {
    const attrs = await loadAttributes(collection)
    const bySlug = new Map(attrs.map((a) => [a.slug, a]))
    for (const [slug, value] of Object.entries(body.attributes as Record<string, unknown>)) {
      const attr = bySlug.get(slug)
      if (!attr) continue
      await upsertAttributeValue(attr.pbId, pbId, value)
    }
  }

  const fresh = (await pbGet(collection, pbId)) ?? rec
  const allStages = await loadStages()
  const stageById = new Map(allStages.map((s) => [String(s.id), s]))
  const rows = await serializeRows([fresh], type, stageById)
  return json(rows[0]!)
}

async function handleRecordDelete(type: RecordType, intId: number): Promise<Response> {
  const pbId = pid(intId)
  const collection = TYPE_TO_COLLECTION[type]
  if (!pbId) return json({ status: 'not_found', resource: type })
  // PB cascades notes/tasks/activities/attachments (relation cascadeDelete);
  // clean up text-keyed satellites ourselves.
  await pbDeleteWhere('list_entries', `record_id='${pbId}'`)
  await pbDeleteWhere('attribute_values', `record_id='${pbId}'`)
  await pbDelete(collection, pbId)
  return json({ status: 'deleted', id: intId })
}

async function upsertAttributeValue(attrPb: string, recordPb: string, value: unknown): Promise<PbRecord | null> {
  const stored = typeof value === 'string' ? value : JSON.stringify(value)
  const existing = await pbList('attribute_values', `perPage=1&filter=${enc(`attribute='${attrPb}' && record_id='${recordPb}'`)}`)
  if (existing[0]) return pbPatch('attribute_values', String(existing[0].id), { value: stored })
  return pbCreate('attribute_values', { attribute: attrPb, record_id: recordPb, value: stored })
}

async function handleLinkDealPerson(dealIntId: number, init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const dealPb = pid(dealIntId)
  const personPb = body.person_id != null ? pid(body.person_id) : null
  if (!dealPb || !personPb) return json({ status: 'noop' })
  const deal = await pbGet('deals', dealPb)
  if (!deal) return json({ status: 'noop' })
  const existing = Array.isArray(deal.person) ? (deal.person as unknown[]).map(String) : []
  if (!existing.includes(personPb)) { existing.push(personPb); await pbPatch('deals', dealPb, { person: existing }) }
  return json({ id: iid(`dp:${dealPb}:${personPb}`), dealId: dealIntId, personId: iid(personPb) })
}

async function handleUnlinkDealPerson(dealIntId: number, personIntId: number): Promise<Response> {
  const dealPb = pid(dealIntId)
  const personPb = pid(personIntId)
  if (!dealPb || !personPb) return json({ status: 'not_found', resource: 'link' })
  const deal = await pbGet('deals', dealPb)
  if (deal) {
    const existing = (Array.isArray(deal.person) ? (deal.person as unknown[]).map(String) : []).filter((x) => x !== personPb)
    await pbPatch('deals', dealPb, { person: existing })
  }
  return json({ status: 'deleted' })
}

async function handleCheckDuplicates(type: RecordType, query: URLSearchParams): Promise<Response> {
  const dups = await findDuplicates(type, query.get('email') ?? '', query.get('domain') ?? '', query.get('name') ?? '')
  return json({ duplicates: dups })
}

async function handleSearch(query: URLSearchParams): Promise<Response> {
  const term = (query.get('q') ?? '').trim().toLowerCase()
  const limit = Math.min(25, Math.max(1, toNum(query.get('limit'), 8)))
  const results: Record<string, unknown[]> = { people: [], companies: [], deals: [] }
  if (!term) return json(results)
  const allStages = await loadStages()
  const stageById = new Map(allStages.map((s) => [String(s.id), s]))
  for (const [key, type] of [['people', 'person'], ['companies', 'company'], ['deals', 'deal']] as const) {
    const recs = await pbList(TYPE_TO_COLLECTION[type], 'perPage=200')
    const rows = recs.map((r) => ({ rec: r, row: mapRow(r, type, stageById) }))
    const matched = rows.filter(({ row }) => searchHaystack(row, type).includes(term))
    matched.sort((a, b) => {
      const an = String(a.row.name).toLowerCase(); const bn = String(b.row.name).toLowerCase()
      const as = an.startsWith(term) ? 0 : an.includes(term) ? 1 : 2
      const bs = bn.startsWith(term) ? 0 : bn.includes(term) ? 1 : 2
      return as - bs || (an < bn ? -1 : 1)
    })
    results[key] = matched.slice(0, limit).map(({ rec }) => recordBrief(rec, type, stageById)).filter(Boolean) as Record<string, unknown>[]
  }
  return json(results)
}

// ---------------------------------------------------------------------------
// Lists / stages / entries / board
// ---------------------------------------------------------------------------

async function buildListsAll(): Promise<Record<string, unknown>[]> {
  const allStages = await loadStages()
  const out: Record<string, unknown>[] = []

  // Virtual main pipeline first
  const mainStages = mainStagesOf(allStages).map((s) => stageDict(s, iid(MAIN_PIPELINE)))
  const dealCount = (await pbList('deals', 'perPage=200&fields=id')).length
  out.push(virtualListInfo(dealCount, mainStages))

  // Real PB lists
  const lists = await pbList('lists', 'perPage=200&sort=created')
  for (const l of lists) {
    const pbListId = String(l.id)
    const stageDicts = listStagesOf(allStages, pbListId).map((s) => stageDict(s, iid(pbListId)))
    const entryCount = (await pbList('list_entries', `perPage=200&filter=${enc(`list='${pbListId}'`)}`)).length
    out.push(listInfo(l, stageDicts, entryCount))
  }
  return out
}

async function handleListsAll(): Promise<Response> { return json(await buildListsAll()) }

async function handleListGet(intId: number): Promise<Response> {
  const pbId = pid(intId)
  const allStages = await loadStages()
  if (pbId === MAIN_PIPELINE) {
    const mainStages = mainStagesOf(allStages).map((s) => stageDict(s, iid(MAIN_PIPELINE)))
    const dealCount = (await pbList('deals', 'perPage=200&fields=id')).length
    return json(virtualListInfo(dealCount, mainStages))
  }
  if (!pbId) return json({ status: 'not_found' })
  const l = await pbGet('lists', pbId)
  if (!l) return json({ status: 'not_found' })
  const stageDicts = listStagesOf(allStages, pbId).map((s) => stageDict(s, iid(pbId)))
  const entryCount = (await pbList('list_entries', `perPage=200&filter=${enc(`list='${pbId}'`)}`)).length
  return json(listInfo(l, stageDicts, entryCount))
}

const LIST_DEFAULT_STAGES: Array<[string, string]> = [
  ['Lead', '#7c9ce8'], ['Contacted', '#6fbfbf'], ['Qualified', '#8fbf8f'],
  ['Demo', '#b5a642'], ['Proposal', '#d9a662'], ['Negotiation', '#c98bc9'],
  ['Won', '#4caf7d'], ['Lost', '#e08e8e'],
]

async function handleListCreate(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const parent = String(body.parent_object ?? 'deal') as RecordType
  const entity = TYPE_TO_COLLECTION[parent] ?? 'deals'
  const created = await pbCreate('lists', {
    name: String(body.name ?? 'New list').trim() || 'New list',
    entity,
    description: String(body.description ?? ''),
  })
  if (!created) return json({ detail: 'Failed to create list' }, 400)
  const pbListId = String(created.id)
  if (body.with_default_stages !== false) {
    const rows = parent === 'deal'
      ? LIST_DEFAULT_STAGES
      : [['New', '#7c9ce8'], ['Contacted', '#6fbfbf'], ['Engaged', '#8fbf8f'], ['Active', '#4caf7d']] as Array<[string, string]>
    for (let i = 0; i < rows.length; i++) {
      await pbCreate('stages', { name: rows[i]![0], color: rows[i]![1], order: i, list: pbListId })
    }
  }
  const allStages = await loadStages()
  const stageDicts = listStagesOf(allStages, pbListId).map((s) => stageDict(s, iid(pbListId)))
  return json(listInfo(created, stageDicts, 0))
}

async function handleListUpdate(intId: number, init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const pbId = pid(intId)
  if (!pbId || pbId === MAIN_PIPELINE) return json({ status: 'not_found', resource: 'list' })
  const patch: Record<string, unknown> = {}
  if (body.name != null) patch.name = String(body.name)
  if (body.description != null) patch.description = String(body.description)
  const updated = Object.keys(patch).length ? await pbPatch('lists', pbId, patch) : await pbGet('lists', pbId)
  if (!updated) return json({ status: 'not_found', resource: 'list' })
  const allStages = await loadStages()
  const stageDicts = listStagesOf(allStages, pbId).map((s) => stageDict(s, iid(pbId)))
  const entryCount = (await pbList('list_entries', `perPage=200&filter=${enc(`list='${pbId}'`)}`)).length
  return json(listInfo(updated, stageDicts, entryCount))
}

async function handleListDelete(intId: number): Promise<Response> {
  const pbId = pid(intId)
  if (!pbId || pbId === MAIN_PIPELINE) return json({ status: 'not_found', resource: 'list' })
  await pbDeleteWhere('stages', `list='${pbId}'`)
  await pbDelete('lists', pbId) // cascades list_entries
  return json({ status: 'deleted', id: intId })
}

async function buildBoard(intId: number): Promise<Record<string, unknown>> {
  const pbId = pid(intId)
  const allStages = await loadStages()
  const stageById = new Map(allStages.map((s) => [String(s.id), s]))

  if (pbId === MAIN_PIPELINE) {
    const mainStages = mainStagesOf(allStages)
    const deals = await pbList('deals', 'perPage=200')
    const companyMap = await loadCompanyMap()
    const byStage = new Map<string, Record<string, unknown>[]>()
    for (const d of deals) {
      const brief = recordBrief(d, 'deal', stageById) as Record<string, unknown>
      brief.companyId = d.company ? iid(String(d.company)) : null
      brief.expectedCloseDate = d.close_date ? String(d.close_date) : ''
      const card: Record<string, unknown> = {
        entry: { id: iid(`mpentry:${String(d.id)}`), listId: intId, recordType: 'deal', recordId: iid(String(d.id)), stageId: d.stage ? iid(String(d.stage)) : null, position: 0, stageEnteredAt: d.updated ?? CREATED_AT, createdAt: d.created ?? CREATED_AT },
        record: brief,
        daysInStage: Math.max(0, Math.floor((Date.now() - Date.parse(String(d.updated ?? d.created ?? nowIso()))) / 86400000)),
      }
      if (d.company) { const c = companyMap.get(String(d.company)); if (c) card.company = recordBrief(c, 'company') }
      const key = d.stage ? String(d.stage) : ''
      const arr = byStage.get(key) ?? []; arr.push(card); byStage.set(key, arr)
    }
    const columns = mainStages.map((s) => {
      const cards = byStage.get(String(s.id)) ?? []
      return { stage: stageDict(s, intId), cards, count: cards.length, totalValue: cards.reduce((sum, c) => sum + toNum((c.record as Record<string, unknown>).value), 0) }
    })
    return { status: 'ok', list: virtualListInfo(deals.length), columns, unstaged: byStage.get('') ?? [] }
  }

  if (!pbId) return { status: 'not_found', list: null, columns: [], unstaged: [] }
  const listRec = await pbGet('lists', pbId)
  if (!listRec) return { status: 'not_found', list: null, columns: [] }
  const type = COLLECTION_TO_TYPE[String(listRec.entity ?? 'deals')] ?? 'deal'
  const listStages = listStagesOf(allStages, pbId)
  const entries = await pbList('list_entries', `perPage=200&sort=position&filter=${enc(`list='${pbId}'`)}`)
  const companyMap = await loadCompanyMap()
  const byStage = new Map<string, Record<string, unknown>[]>()
  for (const entry of entries) {
    const rec = await pbGet(TYPE_TO_COLLECTION[type], String(entry.record_id))
    if (!rec) continue
    const brief = recordBrief(rec, type, stageById) as Record<string, unknown>
    if (type === 'deal') {
      brief.companyId = rec.company ? iid(String(rec.company)) : null
      brief.expectedCloseDate = rec.close_date ? String(rec.close_date) : ''
    }
    const card: Record<string, unknown> = {
      entry: { id: iid(String(entry.id)), listId: intId, recordType: type, recordId: iid(String(rec.id)), stageId: entry.stage ? iid(String(entry.stage)) : null, position: toNum(entry.position), stageEnteredAt: entry.created ?? CREATED_AT, createdAt: entry.created ?? CREATED_AT },
      record: brief,
      daysInStage: Math.max(0, Math.floor((Date.now() - Date.parse(String(entry.created ?? nowIso()))) / 86400000)),
    }
    if (type === 'deal' && rec.company) { const c = companyMap.get(String(rec.company)); if (c) card.company = recordBrief(c, 'company') }
    const key = entry.stage ? String(entry.stage) : ''
    const arr = byStage.get(key) ?? []; arr.push(card); byStage.set(key, arr)
  }
  const columns = listStages.map((s) => {
    const cards = byStage.get(String(s.id)) ?? []
    return { stage: stageDict(s, intId), cards, count: cards.length, totalValue: cards.reduce((sum, c) => sum + toNum((c.record as Record<string, unknown>).value), 0) }
  })
  const stageDicts = listStages.map((s) => stageDict(s, intId))
  return { status: 'ok', list: listInfo(listRec, stageDicts, entries.length), columns, unstaged: byStage.get('') ?? [] }
}

async function handleBoard(intId: number): Promise<Response> { return json(await buildBoard(intId)) }

async function handleStageCreate(listIntId: number, init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const pbId = pid(listIntId)
  const allStages = await loadStages()
  const listRelation = pbId === MAIN_PIPELINE ? '' : (pbId ?? '')
  const count = pbId === MAIN_PIPELINE ? mainStagesOf(allStages).length : listStagesOf(allStages, pbId ?? '').length
  const name = String(body.name ?? 'New stage').trim() || 'New stage'
  const data: Record<string, unknown> = { name, color: String(body.color ?? '') || pickColor(name), order: count }
  if (listRelation) data.list = listRelation
  const created = await pbCreate('stages', data)
  if (!created) return json({ detail: 'Failed to create stage' }, 400)
  return json(stageDict(created, listIntId))
}

async function handleStageUpdate(stageIntId: number, init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const pbId = pid(stageIntId)
  if (!pbId) return json({ status: 'not_found', resource: 'stage' })
  const patch: Record<string, unknown> = {}
  // is_won/is_lost are encoded in the stage NAME (PB has no flag columns).
  if (body.name != null) patch.name = String(body.name)
  if (body.color != null) patch.color = String(body.color)
  if (body.position != null) patch.order = toNum(body.position)
  const existing = await pbGet('stages', pbId)
  if (!existing) return json({ status: 'not_found', resource: 'stage' })
  const listIntId = existing.list ? iid(String(existing.list)) : iid(MAIN_PIPELINE)
  const updated = Object.keys(patch).length ? (await pbPatch('stages', pbId, patch)) ?? existing : existing
  return json(stageDict(updated, listIntId))
}

async function handleStageDelete(stageIntId: number): Promise<Response> {
  const pbId = pid(stageIntId)
  if (!pbId) return json({ status: 'not_found', resource: 'stage' })
  const stage = await pbGet('stages', pbId)
  if (!stage) return json({ status: 'not_found', resource: 'stage' })
  const allStages = await loadStages()
  const siblings = (stage.list ? listStagesOf(allStages, String(stage.list)) : mainStagesOf(allStages)).filter((s) => String(s.id) !== pbId)
  const fallback = siblings[0] ? String(siblings[0].id) : null
  // Reassign entries / deals that referenced the deleted stage to the fallback.
  if (stage.list) {
    const entries = await pbList('list_entries', `perPage=200&filter=${enc(`stage='${pbId}'`)}`)
    for (const e of entries) await pbPatch('list_entries', String(e.id), { stage: fallback ?? '' })
  } else {
    const deals = await pbList('deals', `perPage=200&filter=${enc(`stage='${pbId}'`)}`)
    for (const d of deals) if (fallback) await pbPatch('deals', String(d.id), { stage: fallback })
  }
  await pbDelete('stages', pbId)
  return json({ status: 'deleted', id: stageIntId })
}

async function handleStagesReorder(listIntId: number, init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const ids = Array.isArray(body.stage_ids) ? (body.stage_ids as unknown[]) : []
  for (let i = 0; i < ids.length; i++) {
    const stagePb = pid(ids[i])
    if (stagePb) await pbPatch('stages', stagePb, { order: i })
  }
  return json({ status: 'ok' })
}

async function handleEntryAdd(listIntId: number, init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const pbListId = pid(listIntId)
  const recordPb = body.record_id != null ? pid(body.record_id) : null
  if (!recordPb) return json({ status: 'noop' })
  if (pbListId === MAIN_PIPELINE) {
    // "Adding" a deal to the pipeline just sets its stage.
    const stagePb = body.stage_id != null ? pid(body.stage_id) : await firstMainStagePb()
    if (stagePb) await pbPatch('deals', recordPb, { stage: stagePb })
    return json({ id: iid(`mpentry:${recordPb}`), listId: listIntId, recordType: 'deal', recordId: iid(recordPb), stageId: stagePb ? iid(stagePb) : null, position: 0, stageEnteredAt: nowIso(), createdAt: nowIso() })
  }
  if (!pbListId) return json({ status: 'not_found', resource: 'list' })
  const listRec = await pbGet('lists', pbListId)
  const type = listRec ? COLLECTION_TO_TYPE[String(listRec.entity ?? 'deals')] ?? 'deal' : 'deal'
  const existing = await pbList('list_entries', `perPage=1&filter=${enc(`list='${pbListId}' && record_id='${recordPb}'`)}`)
  if (existing[0]) {
    const e = existing[0]
    return json({ id: iid(String(e.id)), listId: listIntId, recordType: type, recordId: iid(recordPb), stageId: e.stage ? iid(String(e.stage)) : null, position: toNum(e.position), stageEnteredAt: e.created ?? CREATED_AT, createdAt: e.created ?? CREATED_AT })
  }
  const allStages = await loadStages()
  let stagePb = body.stage_id != null ? pid(body.stage_id) : null
  if (!stagePb) { const ls = listStagesOf(allStages, pbListId); stagePb = ls[0] ? String(ls[0].id) : null }
  const count = (await pbList('list_entries', `perPage=200&filter=${enc(`list='${pbListId}'`)}`)).length
  const data: Record<string, unknown> = { list: pbListId, record_id: recordPb, position: count }
  if (stagePb) data.stage = stagePb
  const created = await pbCreate('list_entries', data)
  if (!created) return json({ status: 'noop' })
  await writeActivity(type, recordPb, 'list_added', `Added to ${String(listRec?.name ?? 'list')}`)
  return json({ id: iid(String(created.id)), listId: listIntId, recordType: type, recordId: iid(recordPb), stageId: stagePb ? iid(stagePb) : null, position: count, stageEnteredAt: created.created ?? CREATED_AT, createdAt: created.created ?? CREATED_AT })
}

async function handleEntryRemove(entryIntId: number): Promise<Response> {
  const pbId = pid(entryIntId)
  if (pbId && !pbId.startsWith('mpentry:')) await pbDelete('list_entries', pbId)
  return json({ status: 'deleted', id: entryIntId })
}

async function handleEntryMove(entryIntId: number, init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const token = pid(entryIntId)
  if (!token) return json({ status: 'not_found', resource: 'entry' })
  const stagePb = body.stage_id != null ? pid(body.stage_id) : null

  if (token.startsWith('mpentry:')) {
    const dealPb = token.slice('mpentry:'.length)
    if (stagePb) {
      await pbPatch('deals', dealPb, { stage: stagePb })
      const stage = await pbGet('stages', stagePb)
      await writeActivity('deal', dealPb, 'stage_change', `Moved to ${String(stage?.name ?? '')}`)
    }
    const stagePbForDeal = stagePb ?? String((await pbGet('deals', dealPb))?.stage ?? '')
    return json({ id: entryIntId, listId: iid(MAIN_PIPELINE), recordType: 'deal', recordId: iid(dealPb), stageId: stagePbForDeal ? iid(stagePbForDeal) : null, position: toNum(body.position), stageEnteredAt: nowIso(), createdAt: CREATED_AT })
  }

  const entry = await pbGet('list_entries', token)
  if (!entry) return json({ status: 'not_found', resource: 'entry' })
  const patch: Record<string, unknown> = {}
  if (body.position != null) patch.position = toNum(body.position)
  if (stagePb != null && stagePb !== String(entry.stage ?? '')) {
    patch.stage = stagePb
    const stage = await pbGet('stages', stagePb)
    await writeActivity(COLLECTION_TO_TYPE[String((await pbGet('lists', String(entry.list)))?.entity ?? 'deals')] ?? 'deal', String(entry.record_id), 'stage_change', `Moved to ${String(stage?.name ?? '')}`)
  }
  const updated = Object.keys(patch).length ? (await pbPatch('list_entries', token, patch)) ?? entry : entry
  return json({ id: entryIntId, listId: iid(String(updated.list ?? '')), recordType: COLLECTION_TO_TYPE[String((await pbGet('lists', String(updated.list)))?.entity ?? 'deals')] ?? 'deal', recordId: iid(String(updated.record_id)), stageId: updated.stage ? iid(String(updated.stage)) : null, position: toNum(updated.position), stageEnteredAt: updated.created ?? CREATED_AT, createdAt: updated.created ?? CREATED_AT })
}
// ---------------------------------------------------------------------------
// Attributes (custom fields, EAV)
// ---------------------------------------------------------------------------

const PB_ATTR_TYPES = new Set(['text', 'number', 'select'])
function clampAttrType(t: string): string {
  if (PB_ATTR_TYPES.has(t)) return t
  if (['number', 'currency', 'rating'].includes(t)) return 'number'
  if (['select', 'multiselect', 'status'].includes(t)) return 'select'
  return 'text'
}
function normalizeOptions(options: unknown): unknown[] {
  if (!Array.isArray(options)) return []
  return options.map((o, i) => {
    const opt = (o ?? {}) as Record<string, unknown>
    const label = String(opt.label ?? opt.id ?? `Option ${i + 1}`)
    return { id: String(opt.id ?? slugify(label)), label, color: String(opt.color ?? pickColor(label)) }
  })
}
function attributeDict(rec: PbRecord, meta: AttrMeta, position: number): Record<string, unknown> {
  return {
    id: iid(String(rec.id)),
    objectType: COLLECTION_TO_TYPE[String(rec.entity ?? '')] ?? null,
    listId: null,
    name: meta.name,
    slug: meta.slug,
    type: meta.realType,
    options: meta.options,
    isSystem: false,
    aiPrompt: '',
    position,
    createdAt: rec.created ? String(rec.created) : CREATED_AT,
  }
}

async function handleAttributesList(query: URLSearchParams): Promise<Response> {
  // list-scoped custom attributes are unsupported by the PB schema → empty.
  if (query.get('list_id')) return json([])
  const objectType = query.get('object_type') ?? ''
  if (!objectType) return json([])
  const entity = TYPE_TO_COLLECTION[objectType as RecordType]
  if (!entity) return json([])
  const rows = await pbList('attributes', `perPage=200&sort=created&filter=${enc(`entity='${entity}'`)}`)
  const metas = await loadAttributes(entity)
  const byId = new Map(metas.map((m) => [m.pbId, m]))
  return json(rows.map((r, i) => attributeDict(r, byId.get(String(r.id))!, i)))
}

async function handleAttributeCreate(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  if (body.list_id) return json({ detail: 'List-scoped attributes are not supported' }, 400)
  const objectType = String(body.object_type ?? 'person') as RecordType
  const entity = TYPE_TO_COLLECTION[objectType] ?? 'people'
  const name = String(body.name ?? 'New field').trim() || 'New field'
  const realType = String(body.type ?? 'text')
  const options = normalizeOptions(body.options)
  const created = await pbCreate('attributes', {
    entity,
    name,
    type: clampAttrType(realType),
    options: JSON.stringify({ t: realType, o: options }),
  })
  if (!created) return json({ detail: 'Failed to create attribute' }, 400)
  return json(attributeDict(created, { pbId: String(created.id), slug: slugify(name), name, realType, options }, 0))
}

async function handleAttributeUpdate(intId: number, init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const pbId = pid(intId)
  if (!pbId) return json({ status: 'not_found', resource: 'attribute' })
  const existing = await pbGet('attributes', pbId)
  if (!existing) return json({ status: 'not_found', resource: 'attribute' })
  let realType = String(existing.type ?? 'text')
  let options: unknown[] = []
  try { const p = JSON.parse(String(existing.options ?? '')) as { t?: string; o?: unknown[] }; realType = p.t ?? realType; options = Array.isArray(p.o) ? p.o : [] } catch { /* */ }
  const patch: Record<string, unknown> = {}
  if (body.name != null && String(body.name).trim()) patch.name = String(body.name).trim()
  if (body.type != null) { realType = String(body.type); patch.type = clampAttrType(realType) }
  if (body.options != null) options = normalizeOptions(body.options)
  patch.options = JSON.stringify({ t: realType, o: options })
  const updated = (await pbPatch('attributes', pbId, patch)) ?? existing
  const name = String(updated.name ?? '')
  return json(attributeDict(updated, { pbId, slug: slugify(name), name, realType, options }, toNum(body.position, 0)))
}

async function handleAttributeDelete(intId: number): Promise<Response> {
  const pbId = pid(intId)
  if (!pbId) return json({ status: 'not_found', resource: 'attribute' })
  await pbDeleteWhere('attribute_values', `attribute='${pbId}'`)
  await pbDelete('attributes', pbId)
  return json({ status: 'deleted', id: intId })
}

async function handleWriteValue(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const attrPb = body.attribute_id != null ? pid(body.attribute_id) : null
  const recordPb = body.record_id != null ? pid(body.record_id) : null
  if (!attrPb || !recordPb) return json({ status: 'noop' })
  const row = await upsertAttributeValue(attrPb, recordPb, body.value)
  const type = (String(body.record_type ?? 'person')) as RecordType
  await writeActivity(type, recordPb, 'field_change', 'Field updated')
  if (!row) return json({ status: 'noop' })
  return json({ id: iid(String(row.id)), attributeId: iid(attrPb), recordType: type, recordId: iid(recordPb), listEntryId: 0, value: body.value })
}

// ---------------------------------------------------------------------------
// Saved views (object-scoped persist in PB; list-scoped synthesised)
// ---------------------------------------------------------------------------

function viewFromConfig(rec: PbRecord): Record<string, unknown> {
  let cfg: Record<string, unknown> = {}
  try { cfg = JSON.parse(String(rec.config ?? '')) as Record<string, unknown> } catch { /* */ }
  return {
    id: iid(String(rec.id)),
    objectType: COLLECTION_TO_TYPE[String(rec.kind ?? '')] ?? null,
    listId: null,
    name: String(rec.name ?? ''),
    layout: String(cfg.layout ?? 'table'),
    filters: Array.isArray(cfg.filters) ? cfg.filters : [],
    sorts: Array.isArray(cfg.sorts) ? cfg.sorts : [],
    visibleColumns: Array.isArray(cfg.visibleColumns) ? cfg.visibleColumns : [],
    groupBy: String(cfg.groupBy ?? ''),
    isDefault: Boolean(cfg.isDefault),
    position: toNum(cfg.position, 0),
    createdAt: rec.created ? String(rec.created) : CREATED_AT,
  }
}

function syntheticListViews(listIntId: number): Record<string, unknown>[] {
  const board: Record<string, unknown> = {
    id: iid(`view:list:${listIntId}:board`), objectType: null, listId: listIntId, name: 'Board',
    layout: 'kanban', filters: [], sorts: [], visibleColumns: [], groupBy: '', isDefault: true, position: 0, createdAt: CREATED_AT,
  }
  const table: Record<string, unknown> = {
    id: iid(`view:list:${listIntId}:table`), objectType: null, listId: listIntId, name: 'All entries',
    layout: 'table', filters: [], sorts: [], visibleColumns: [], groupBy: '', isDefault: false, position: 1, createdAt: CREATED_AT,
  }
  return [board, table]
}

async function handleViewsList(query: URLSearchParams): Promise<Response> {
  const listId = query.get('list_id')
  if (listId) return json(syntheticListViews(Number(listId)))
  const objectType = query.get('object_type') ?? ''
  if (!objectType) return json([])
  const kind = TYPE_TO_COLLECTION[objectType as RecordType]
  if (!kind) return json([])
  let rows = await pbList('saved_views', `perPage=200&sort=created&filter=${enc(`kind='${kind}'`)}`)
  if (rows.length === 0) {
    const created = await pbCreate('saved_views', {
      name: `All ${TYPE_TITLES[objectType as RecordType]}`, kind,
      config: JSON.stringify({ layout: 'table', filters: [], sorts: [], visibleColumns: [], groupBy: '', isDefault: true, position: 0 }),
    })
    if (created) rows = [created]
  }
  return json(rows.map(viewFromConfig))
}

async function handleViewCreate(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const config = {
    layout: String(body.layout ?? 'table'),
    filters: Array.isArray(body.filters) ? body.filters : [],
    sorts: Array.isArray(body.sorts) ? body.sorts : [],
    visibleColumns: Array.isArray(body.visible_columns) ? body.visible_columns : [],
    groupBy: String(body.group_by ?? ''),
    isDefault: false,
    position: 0,
  }
  if (body.list_id) {
    // list-scoped: PB has no list column on saved_views → decorative echo.
    return json({ id: iid(`view:list:${Number(body.list_id)}:${genId()}`), objectType: null, listId: Number(body.list_id), name: String(body.name ?? 'New view'), ...config, createdAt: nowIso() })
  }
  const kind = TYPE_TO_COLLECTION[String(body.object_type ?? 'person') as RecordType] ?? 'people'
  const created = await pbCreate('saved_views', { name: String(body.name ?? 'New view').trim() || 'New view', kind, config: JSON.stringify(config) })
  if (!created) return json({ detail: 'Failed to create view' }, 400)
  return json(viewFromConfig(created))
}

async function handleViewUpdate(intId: number, init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const pbId = pid(intId)
  if (!pbId || pbId.startsWith('view:')) {
    // synthetic list view — decorative
    return json({ id: intId, objectType: null, listId: null, name: String(body.name ?? 'View'), layout: String(body.layout ?? 'table'), filters: body.filters ?? [], sorts: body.sorts ?? [], visibleColumns: body.visible_columns ?? [], groupBy: String(body.group_by ?? ''), isDefault: Boolean(body.is_default), position: toNum(body.position), createdAt: CREATED_AT })
  }
  const existing = await pbGet('saved_views', pbId)
  if (!existing) return json({ status: 'not_found', resource: 'view' })
  let cfg: Record<string, unknown> = {}
  try { cfg = JSON.parse(String(existing.config ?? '')) as Record<string, unknown> } catch { /* */ }
  if (body.layout != null) cfg.layout = String(body.layout)
  if (body.filters != null) cfg.filters = body.filters
  if (body.sorts != null) cfg.sorts = body.sorts
  if (body.visible_columns != null) cfg.visibleColumns = body.visible_columns
  if (body.group_by != null) cfg.groupBy = String(body.group_by)
  if (body.is_default != null) cfg.isDefault = toBool(body.is_default)
  if (body.position != null) cfg.position = toNum(body.position)
  const patch: Record<string, unknown> = { config: JSON.stringify(cfg) }
  if (body.name != null) patch.name = String(body.name)
  const updated = (await pbPatch('saved_views', pbId, patch)) ?? existing
  return json(viewFromConfig(updated))
}

async function handleViewDelete(intId: number): Promise<Response> {
  const pbId = pid(intId)
  if (pbId && !pbId.startsWith('view:')) await pbDelete('saved_views', pbId)
  return json({ status: 'deleted', id: intId })
}

// ---------------------------------------------------------------------------
// Timeline (activities) + notes
// ---------------------------------------------------------------------------

function relationField(type: RecordType): 'person' | 'company' | 'deal' { return type }

function activityDict(rec: PbRecord): Record<string, unknown> {
  const type: RecordType = rec.person ? 'person' : rec.company ? 'company' : 'deal'
  const recPb = rec.person ?? rec.company ?? rec.deal
  const full = String(rec.body ?? '')
  const nl = full.indexOf('\n')
  const title = nl >= 0 ? full.slice(0, nl) : full
  const body = nl >= 0 ? full.slice(nl + 1) : ''
  return {
    id: iid(String(rec.id)),
    recordType: type,
    recordId: recPb ? iid(String(recPb)) : 0,
    type: String(rec.kind ?? 'other'),
    title,
    body,
    actor: '',
    occurredAt: rec.created ? String(rec.created) : CREATED_AT,
    extra: {},
  }
}

async function activitiesFor(type: RecordType, pbId: string, kinds: string[]): Promise<PbRecord[]> {
  let filter = `${relationField(type)}='${pbId}'`
  if (kinds.length > 0) filter += ` && (${kinds.map((k) => `kind='${k}'`).join(' || ')})`
  return pbList('activities', `perPage=200&sort=-created&filter=${enc(filter)}`)
}

async function handleTimelineGet(type: RecordType, intId: number, query: URLSearchParams): Promise<Response> {
  const pbId = pid(intId)
  if (!pbId) return json({ items: [], total: 0, page: 1, pageSize: 50 })
  const kinds = (query.get('type_filter') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const rows = await activitiesFor(type, pbId, kinds)
  const page = Math.max(1, toNum(query.get('page'), 1))
  const pageSize = Math.min(200, Math.max(1, toNum(query.get('page_size'), 50)))
  const start = (page - 1) * pageSize
  return json({ items: rows.slice(start, start + pageSize).map(activityDict), total: rows.length, page, pageSize })
}

async function handleActivityLog(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const type = String(body.record_type ?? 'person') as RecordType
  const pbId = body.record_id != null ? pid(body.record_id) : null
  if (!pbId) return json({ status: 'noop' })
  const kind = String(body.type ?? 'other')
  const titles: Record<string, string> = { call: 'Call logged', meeting: 'Meeting logged', email: 'Email logged', note: 'Note', other: 'Activity logged' }
  const title = String(body.title ?? '').trim() || titles[kind] || 'Activity logged'
  const bodyText = String(body.body ?? '')
  const data: Record<string, unknown> = { kind, body: bodyText ? `${title}\n${bodyText}` : title }
  data[relationField(type)] = pbId
  const created = await pbCreate('activities', data)
  return json(created ? activityDict(created) : { status: 'noop' })
}

async function handleActivityDelete(intId: number): Promise<Response> {
  const pbId = pid(intId)
  if (pbId) await pbDelete('activities', pbId)
  return json({ status: 'deleted', id: intId })
}

function noteDict(rec: PbRecord): Record<string, unknown> {
  const type: RecordType = rec.person ? 'person' : rec.company ? 'company' : 'deal'
  const recPb = rec.person ?? rec.company ?? rec.deal
  return {
    id: iid(String(rec.id)),
    recordType: type,
    recordId: recPb ? iid(String(recPb)) : 0,
    title: '',
    content: String(rec.body ?? ''),
    pinned: false,
    createdBy: '',
    createdAt: rec.created ? String(rec.created) : CREATED_AT,
    updatedAt: rec.created ? String(rec.created) : CREATED_AT,
  }
}

async function handleNotesList(type: RecordType, intId: number): Promise<Response> {
  const pbId = pid(intId)
  if (!pbId) return json([])
  const rows = await pbList('notes', `perPage=200&sort=-created&filter=${enc(`${relationField(type)}='${pbId}'`)}`)
  return json(rows.map(noteDict))
}

async function handleNoteCreate(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const type = String(body.record_type ?? 'person') as RecordType
  const pbId = body.record_id != null ? pid(body.record_id) : null
  if (!pbId) return json({ status: 'noop' })
  const content = String(body.content ?? '')
  const data: Record<string, unknown> = { body: content }
  data[relationField(type)] = pbId
  const created = await pbCreate('notes', data)
  if (!created) return json({ status: 'noop' })
  const preview = (String(body.title ?? '') || content).replace(/\n/g, ' ').slice(0, 280)
  await writeActivity(type, pbId, 'note_created', preview || 'Note added')
  return json(noteDict(created))
}

async function handleNoteUpdate(intId: number, init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const pbId = pid(intId)
  if (!pbId) return json({ status: 'not_found', resource: 'note' })
  const patch: Record<string, unknown> = {}
  if (body.content != null) patch.body = String(body.content)
  const updated = Object.keys(patch).length ? await pbPatch('notes', pbId, patch) : await pbGet('notes', pbId)
  if (!updated) return json({ status: 'not_found', resource: 'note' })
  return json(noteDict(updated))
}

async function handleNoteDelete(intId: number): Promise<Response> {
  const pbId = pid(intId)
  if (pbId) await pbDelete('notes', pbId)
  return json({ status: 'deleted', id: intId })
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

function taskRelation(rec: PbRecord): { type: RecordType | null; pb: string | null } {
  if (rec.deal) return { type: 'deal', pb: String(rec.deal) }
  if (rec.person) return { type: 'person', pb: String(rec.person) }
  return { type: null, pb: null }
}

async function taskDict(rec: PbRecord, stageById: Map<string, PbRecord>, briefCache: Map<string, Record<string, unknown> | null>): Promise<Record<string, unknown>> {
  const rel = taskRelation(rec)
  const done = toBool(rec.done)
  let brief: Record<string, unknown> | null = null
  if (rel.type && rel.pb) {
    const key = `${rel.type}:${rel.pb}`
    if (briefCache.has(key)) brief = briefCache.get(key) ?? null
    else { const r = await pbGet(TYPE_TO_COLLECTION[rel.type], rel.pb); brief = recordBrief(r, rel.type, stageById); briefCache.set(key, brief) }
  }
  return {
    id: iid(String(rec.id)),
    title: String(rec.title ?? ''),
    description: '',
    dueDate: String(rec.due ?? ''),
    completedAt: done ? (rec.updated ? String(rec.updated) : nowIso()) : null,
    completed: done,
    recordType: rel.type,
    recordId: rel.pb ? iid(rel.pb) : null,
    createdBy: '',
    createdAt: rec.created ? String(rec.created) : CREATED_AT,
    updatedAt: rec.updated ? String(rec.updated) : CREATED_AT,
    record: brief,
  }
}

async function handleTasksList(query: URLSearchParams): Promise<Response> {
  const type = query.get('record_type') as RecordType | null
  const recordId = query.get('record_id')
  let filter = ''
  if (type && recordId) { const pbId = pid(recordId); if (pbId) filter = `${relationField(type)}='${pbId}'` }
  const rows = await pbList('tasks', `perPage=200&sort=due${filter ? `&filter=${enc(filter)}` : ''}`)
  const allStages = await loadStages()
  const stageById = new Map(allStages.map((s) => [String(s.id), s]))
  const briefCache = new Map<string, Record<string, unknown> | null>()
  const out: Record<string, unknown>[] = []
  for (const r of rows) out.push(await taskDict(r, stageById, briefCache))
  return json(out)
}

async function handleMyWork(): Promise<Response> {
  const today = new Date().toISOString().slice(0, 10)
  const weekOut = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
  const allStages = await loadStages()
  const stageById = new Map(allStages.map((s) => [String(s.id), s]))
  const briefCache = new Map<string, Record<string, unknown> | null>()
  const openRows = await pbList('tasks', `perPage=200&sort=due&filter=${enc('done=false')}`)
  const buckets: Record<string, Record<string, unknown>[]> = { overdue: [], today: [], upcoming: [], someday: [] }
  for (const r of openRows) {
    const t = await taskDict(r, stageById, briefCache)
    const due = String(t.dueDate)
    if (!due) buckets.someday!.push(t)
    else if (due < today) buckets.overdue!.push(t)
    else if (due === today) buckets.today!.push(t)
    else buckets.upcoming!.push(t)
  }
  const completedRows = await pbList('tasks', `perPage=10&sort=-updated&filter=${enc('done=true')}`)
  const completed: Record<string, unknown>[] = []
  for (const r of completedRows) completed.push(await taskDict(r, stageById, briefCache))
  return json({
    ...buckets,
    completed,
    counts: {
      overdue: buckets.overdue!.length,
      today: buckets.today!.length,
      upcoming: buckets.upcoming!.filter((t) => String(t.dueDate || '') <= weekOut).length,
      open: openRows.length,
    },
  })
}

async function handleTaskCreate(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const data: Record<string, unknown> = {
    title: String(body.title ?? 'New task').trim() || 'New task',
    due: String(body.due_date ?? ''),
    done: false,
  }
  const type = body.record_type ? (String(body.record_type) as RecordType) : null
  const pbId = body.record_id != null ? pid(body.record_id) : null
  if (type && pbId && (type === 'deal' || type === 'person')) data[type] = pbId
  const created = await pbCreate('tasks', data)
  if (!created) return json({ status: 'noop' })
  if (type && pbId) await writeActivity(type, pbId, 'task_created', `Task: ${String(created.title ?? '')}`)
  const allStages = await loadStages()
  const stageById = new Map(allStages.map((s) => [String(s.id), s]))
  return json(await taskDict(created, stageById, new Map()))
}

async function handleTaskUpdate(intId: number, init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const pbId = pid(intId)
  if (!pbId) return json({ status: 'not_found', resource: 'task' })
  const existing = await pbGet('tasks', pbId)
  if (!existing) return json({ status: 'not_found', resource: 'task' })
  const patch: Record<string, unknown> = {}
  if (body.title != null) patch.title = String(body.title)
  if (body.due_date != null) patch.due = String(body.due_date)
  if (body.record_type !== undefined || body.record_id !== undefined) {
    const type = body.record_type ? (String(body.record_type) as RecordType) : null
    const rp = body.record_id != null ? pid(body.record_id) : null
    patch.deal = ''; patch.person = ''
    if (type === 'deal' && rp) patch.deal = rp
    if (type === 'person' && rp) patch.person = rp
  }
  const wasDone = toBool(existing.done)
  if (body.completed != null) {
    patch.done = toBool(body.completed)
    if (toBool(body.completed) && !wasDone) {
      const rel = taskRelation(existing)
      if (rel.type && rel.pb) await writeActivity(rel.type, rel.pb, 'task_completed', `Completed: ${String(existing.title ?? '')}`)
    }
  }
  const updated = (await pbPatch('tasks', pbId, patch)) ?? existing
  const allStages = await loadStages()
  const stageById = new Map(allStages.map((s) => [String(s.id), s]))
  return json(await taskDict(updated, stageById, new Map()))
}

async function handleTaskDelete(intId: number): Promise<Response> {
  const pbId = pid(intId)
  if (pbId) await pbDelete('tasks', pbId)
  return json({ status: 'deleted', id: intId })
}

// ---------------------------------------------------------------------------
// Tags (per-record PB relation arrays; no record_tags table)
// ---------------------------------------------------------------------------

async function handleTagsList(): Promise<Response> {
  const rows = await pbList('tags', 'perPage=200&sort=name')
  return json(rows.map(tagDict))
}

async function handleTagCreate(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const name = String(body.name ?? 'New tag').trim() || 'New tag'
  const existing = await pbList('tags', `perPage=1&filter=${enc(`name~'${name.replace(/'/g, "")}'`)}`)
  const dup = existing.find((t) => String(t.name ?? '').toLowerCase() === name.toLowerCase())
  if (dup) return json(tagDict(dup))
  const created = await pbCreate('tags', { name, color: String(body.color ?? '') || pickColor(name) })
  if (!created) return json({ detail: 'Failed to create tag' }, 400)
  return json(tagDict(created))
}

async function handleTagUpdate(intId: number, init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const pbId = pid(intId)
  if (!pbId) return json({ status: 'not_found', resource: 'tag' })
  const patch: Record<string, unknown> = {}
  if (body.name != null && String(body.name).trim()) patch.name = String(body.name).trim()
  if (body.color != null) patch.color = String(body.color)
  const updated = Object.keys(patch).length ? await pbPatch('tags', pbId, patch) : await pbGet('tags', pbId)
  if (!updated) return json({ status: 'not_found', resource: 'tag' })
  return json(tagDict(updated))
}

async function handleTagDelete(intId: number): Promise<Response> {
  const pbId = pid(intId)
  if (pbId) await pbDelete('tags', pbId) // PB removes the id from record.tags arrays
  return json({ status: 'deleted', id: intId })
}

async function handleTagAssign(tagIntId: number, init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const tagPb = pid(tagIntId)
  const type = String(body.record_type ?? 'person') as RecordType
  const recordPb = body.record_id != null ? pid(body.record_id) : null
  if (!tagPb || !recordPb) return json({ status: 'noop' })
  const rec = await pbGet(TYPE_TO_COLLECTION[type], recordPb)
  if (!rec) return json({ status: 'noop' })
  const tags = (Array.isArray(rec.tags) ? (rec.tags as unknown[]).map(String) : [])
  if (!tags.includes(tagPb)) { tags.push(tagPb); await pbPatch(TYPE_TO_COLLECTION[type], recordPb, { tags }) }
  return json({ id: iid(`rt:${tagPb}:${recordPb}`), tagId: tagIntId, recordType: type, recordId: iid(recordPb) })
}

async function handleTagUnassign(tagIntId: number, type: RecordType, recordIntId: number): Promise<Response> {
  const tagPb = pid(tagIntId)
  const recordPb = pid(recordIntId)
  if (!tagPb || !recordPb) return json({ status: 'not_found', resource: 'tag assignment' })
  const rec = await pbGet(TYPE_TO_COLLECTION[type], recordPb)
  if (rec) {
    const tags = (Array.isArray(rec.tags) ? (rec.tags as unknown[]).map(String) : []).filter((x) => x !== tagPb)
    await pbPatch(TYPE_TO_COLLECTION[type], recordPb, { tags })
  }
  return json({ status: 'deleted' })
}

// ---------------------------------------------------------------------------
// Files (attachments) — multipart upload + PB file download
// ---------------------------------------------------------------------------

function attachmentDict(rec: PbRecord, size?: number): Record<string, unknown> {
  const type: RecordType = rec.person ? 'person' : rec.company ? 'company' : 'deal'
  const recPb = rec.person ?? rec.company ?? rec.deal
  return {
    id: iid(String(rec.id)),
    recordType: type,
    recordId: recPb ? iid(String(recPb)) : 0,
    fileName: String(rec.name ?? rec.file ?? ''),
    size: size ?? 0,
    mime: '',
    createdBy: '',
    createdAt: rec.created ? String(rec.created) : CREATED_AT,
  }
}

async function handleFilesList(type: RecordType, intId: number): Promise<Response> {
  const pbId = pid(intId)
  if (!pbId) return json([])
  const rows = await pbList('attachments', `perPage=200&sort=-created&filter=${enc(`${relationField(type)}='${pbId}'`)}`)
  return json(rows.map((r) => attachmentDict(r)))
}

function b64ToBytes(b64: string): Uint8Array {
  try {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return bytes
  } catch { return new Uint8Array() }
}

async function handleFileUpload(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const type = String(body.record_type ?? 'person') as RecordType
  const pbId = body.record_id != null ? pid(body.record_id) : null
  const fileName = String(body.file_name ?? 'file.txt')
  const bytes = b64ToBytes(String(body.data_base64 ?? ''))
  const form = new FormData()
  form.append('file', new Blob([bytes as BlobPart]), fileName)
  form.append('name', fileName)
  if (pbId) form.append(relationField(type), pbId)
  try {
    // No Content-Type header → browser sets the multipart boundary.
    const res = await originalFetch('/api/collections/attachments/records', { method: 'POST', headers: pbHeaders(), body: form })
    if (!res.ok) return json({ detail: 'Upload failed' }, 400)
    const created = (await res.json()) as PbRecord
    return json(attachmentDict(created, bytes.length))
  } catch { return json({ detail: 'Upload failed' }, 400) }
}

async function handleFileDelete(intId: number): Promise<Response> {
  const pbId = pid(intId)
  if (pbId) await pbDelete('attachments', pbId)
  return json({ status: 'deleted', id: intId })
}

async function handleFileDownload(intId: number): Promise<Response> {
  const pbId = pid(intId)
  if (!pbId) return json({ status: 'not_found' })
  const rec = await pbGet('attachments', pbId)
  if (!rec || !rec.file) return json({ status: 'file_missing' })
  const fileName = String(rec.file)
  // attachments is auth-gated → mint a short-lived file token.
  let token = ''
  try {
    const tRes = await originalFetch('/api/files/token', { method: 'POST', headers: pbHeaders() })
    if (tRes.ok) token = String(((await tRes.json()) as { token?: string }).token ?? '')
  } catch { /* ignore */ }
  const url = `/api/files/attachments/${pbId}/${enc(fileName)}${token ? `?token=${token}` : ''}`
  try {
    const res = await originalFetch(url, { headers: pbHeaders() })
    if (!res.ok) return json({ status: 'file_missing' })
    const blob = await res.blob()
    return new Response(blob, { status: 200, headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/octet-stream' } })
  } catch { return json({ status: 'file_missing' }) }
}

// ---------------------------------------------------------------------------
// Reports / dashboard (aggregated client-side from PB deals/stages/activities)
// ---------------------------------------------------------------------------

function monthBounds(offset: number): { start: Date; end: Date; key: string; label: string } {
  const today = new Date()
  let year = today.getFullYear()
  let month = today.getMonth() - offset
  while (month < 0) { month += 12; year -= 1 }
  const start = new Date(year, month, 1)
  const end = new Date(month === 11 ? year + 1 : year, month === 11 ? 0 : month + 1, 1)
  return { start, end, key: `${year}-${String(month + 1).padStart(2, '0')}`, label: start.toLocaleString('en-US', { month: 'short' }) }
}

interface DealAgg { rec: PbRecord; stagePb: string; stageName: string; value: number; status: string; updatedMs: number }
async function loadDealAggs(): Promise<{ aggs: DealAgg[]; mainStages: PbRecord[]; allStages: PbRecord[] }> {
  const allStages = await loadStages()
  const mainStages = mainStagesOf(allStages)
  const stageById = new Map(allStages.map((s) => [String(s.id), s]))
  const deals = await pbList('deals', 'perPage=200')
  const aggs = deals.map((d) => {
    const stagePb = d.stage ? String(d.stage) : ''
    const stage = stageById.get(stagePb)
    const name = stage ? String(stage.name ?? '') : ''
    const f = stageFlags(name)
    return { rec: d, stagePb, stageName: name, value: toNum(d.value), status: f.isWon ? 'won' : f.isLost ? 'lost' : 'open', updatedMs: Date.parse(String(d.updated ?? d.created ?? nowIso())) }
  })
  return { aggs, mainStages, allStages }
}

function pipelinePayload(aggs: DealAgg[], mainStages: PbRecord[]): Record<string, unknown> {
  const stages = mainStages.map((s) => {
    const inStage = aggs.filter((a) => a.stagePb === String(s.id))
    return { stage: stageDict(s, iid(MAIN_PIPELINE)), count: inStage.length, value: inStage.reduce((sum, a) => sum + a.value, 0) }
  })
  let totalValue = 0; let openCount = 0
  for (const s of stages) {
    const st = s.stage as Record<string, unknown>
    if (!st.isWon && !st.isLost) { totalValue += toNum(s.value); openCount += toNum(s.count) }
  }
  return { list: virtualListInfo(aggs.length), stages, totalValue, openCount }
}

async function handleDashboard(): Promise<Response> {
  const { aggs, mainStages } = await loadDealAggs()
  const people = await pbList('people', 'perPage=200&fields=id')
  const companies = await pbList('companies', 'perPage=200&fields=id')
  const tasks = await pbList('tasks', 'perPage=200')
  const openTasks = tasks.filter((t) => !toBool(t.done))
  const notes = await pbList('notes', 'perPage=1&fields=id')

  const allStages2 = await loadStages()
  const stageById = new Map(allStages2.map((s) => [String(s.id), s]))
  const briefCache = new Map<string, Record<string, unknown> | null>()
  const today = new Date().toISOString().slice(0, 10)
  const dueToday: Record<string, unknown>[] = []
  const overdue: Record<string, unknown>[] = []
  for (const t of openTasks) {
    const due = String(t.due ?? '')
    if (!due) continue
    const dict = await taskDict(t, stageById, briefCache)
    if (due === today && dueToday.length < 8) dueToday.push(dict)
    else if (due < today && overdue.length < 8) overdue.push(dict)
  }

  function wonBetween(offset: number): { count: number; value: number } {
    const { start, end } = monthBounds(offset)
    const won = aggs.filter((a) => a.status === 'won' && a.updatedMs >= start.getTime() && a.updatedMs < end.getTime())
    return { count: won.length, value: won.reduce((s, a) => s + a.value, 0) }
  }

  const activityRows = await pbList('activities', 'perPage=15&sort=-created')
  const recentActivity: Record<string, unknown>[] = []
  for (const a of activityRows) {
    const dict = activityDict(a)
    const t = dict.recordType as RecordType
    const rp = a.person ?? a.company ?? a.deal
    if (rp) { const r = await pbGet(TYPE_TO_COLLECTION[t], String(rp)); const b = recordBrief(r, t, stageById); if (b) { dict.record = b; recentActivity.push(dict) } }
  }

  const reconnect = (await pbList('people', 'perPage=6&sort=created')).map((p) => {
    const b = recordBrief(p, 'person') as Record<string, unknown>
    b.lastInteractionAt = null
    return b
  })

  const hasDealMoved = (await pbList('activities', `perPage=1&filter=${enc("kind='stage_change'")}`)).length > 0
  const state = appState as Record<string, unknown>

  return json({
    counts: { people: people.length, companies: companies.length, deals: aggs.length, openTasks: openTasks.length },
    pipeline: pipelinePayload(aggs, mainStages),
    wonThisMonth: wonBetween(0),
    wonLastMonth: wonBetween(1),
    tasksDueToday: dueToday,
    tasksOverdue: overdue,
    recentActivity,
    reconnect,
    checklist: {
      dismissed: Boolean(state.checklistDismissed),
      steps: { hasRecords: people.length > 0 || companies.length > 0, hasDealMoved, hasNote: notes.length > 0, hasTask: tasks.length > 0 },
    },
    seeded: Boolean(state.demoSeeded),
  })
}

async function handleFunnel(): Promise<Response> {
  const { aggs, mainStages } = await loadDealAggs()
  const ordered = mainStages.filter((s) => !stageFlags(String(s.name ?? '')).isLost)
  const posOf = new Map(ordered.map((s, i) => [String(s.id), i]))
  const reached = new Array(ordered.length).fill(0)
  const valueAt = new Array(ordered.length).fill(0)
  for (const a of aggs) {
    const idx = posOf.get(a.stagePb)
    if (idx === undefined) continue
    for (let i = 0; i <= idx; i++) reached[i] += 1
    valueAt[idx] += a.value
  }
  const base = reached[0] || 0
  const stages = ordered.map((s, i) => ({
    stage: stageDict(s, iid(MAIN_PIPELINE)),
    reached: reached[i],
    currentValue: valueAt[i],
    conversion: base ? Math.round((reached[i] / base) * 1000) / 10 : 0,
  }))
  const lostIds = new Set(mainStages.filter((s) => stageFlags(String(s.name ?? '')).isLost).map((s) => String(s.id)))
  const lostCount = aggs.filter((a) => lostIds.has(a.stagePb)).length
  return json({ list: virtualListInfo(aggs.length), stages, lostCount, maxIndex: Math.max(0, ordered.length - 1) })
}

async function handleWinRate(query: URLSearchParams): Promise<Response> {
  const months = Math.min(24, Math.max(1, toNum(query.get('months'), 6)))
  const { aggs } = await loadDealAggs()
  const rows: Record<string, unknown>[] = []
  for (let offset = months - 1; offset >= 0; offset--) {
    const { start, end, key, label } = monthBounds(offset)
    const closed = aggs.filter((a) => (a.status === 'won' || a.status === 'lost') && a.updatedMs >= start.getTime() && a.updatedMs < end.getTime())
    const won = closed.filter((a) => a.status === 'won')
    const lost = closed.filter((a) => a.status === 'lost')
    const wonValue = won.reduce((s, a) => s + a.value, 0)
    rows.push({
      month: key, label, won: won.length, lost: lost.length,
      winRate: closed.length ? Math.round((won.length / closed.length) * 1000) / 10 : null,
      wonValue, avgDealSize: won.length ? Math.round((wonValue / won.length) * 100) / 100 : 0,
    })
  }
  const allClosed = aggs.filter((a) => a.status === 'won' || a.status === 'lost')
  const allWon = allClosed.filter((a) => a.status === 'won')
  const totalWon = allWon.reduce((s, a) => s + a.value, 0)
  return json({
    months: rows,
    overall: {
      winRate: allClosed.length ? Math.round((allWon.length / allClosed.length) * 1000) / 10 : null,
      avgDealSize: allWon.length ? Math.round((totalWon / allWon.length) * 100) / 100 : 0,
      totalWonValue: totalWon,
    },
  })
}

async function handleVelocity(): Promise<Response> {
  const { aggs, mainStages } = await loadDealAggs()
  const now = Date.now()
  const stages = mainStages.map((s) => {
    const inStage = aggs.filter((a) => a.stagePb === String(s.id))
    const days = inStage.map((a) => Math.max(0, (now - a.updatedMs) / 86400000))
    return { stage: stageDict(s, iid(MAIN_PIPELINE)), avgDays: days.length ? Math.round((days.reduce((x, y) => x + y, 0) / days.length) * 10) / 10 : 0, samples: days.length }
  })
  return json({ list: virtualListInfo(aggs.length), stages })
}

async function handleActivityVolume(query: URLSearchParams): Promise<Response> {
  const weeks = Math.min(26, Math.max(1, toNum(query.get('weeks'), 8)))
  const groupMap: Record<string, string> = {
    email: 'emails', note_created: 'notes', note: 'notes', task_created: 'tasks', task_completed: 'tasks',
    call: 'meetings', meeting: 'meetings', stage_change: 'changes', field_change: 'changes', created: 'changes', list_added: 'changes',
  }
  const activities = await pbList('activities', 'perPage=200&sort=-created')
  const today = new Date()
  const dow = (today.getDay() + 6) % 7 // Monday=0
  const startOfWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() - dow)
  const rows: Record<string, unknown>[] = []
  for (let offset = weeks - 1; offset >= 0; offset--) {
    const ws = new Date(startOfWeek.getTime() - offset * 7 * 86400000)
    const we = new Date(ws.getTime() + 7 * 86400000)
    const inWeek = activities.filter((a) => { const t = Date.parse(String(a.created ?? '')); return t >= ws.getTime() && t < we.getTime() })
    const counts = { emails: 0, notes: 0, tasks: 0, meetings: 0, changes: 0 }
    for (const a of inWeek) { const g = groupMap[String(a.kind ?? '')] ?? 'changes'; counts[g as keyof typeof counts] += 1 }
    rows.push({ week: ws.toISOString().slice(0, 10), label: ws.toLocaleString('en-US', { month: 'short', day: '2-digit' }), total: inWeek.length, ...counts })
  }
  return json({ weeks: rows })
}

function csvEscape(v: unknown): string {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
function csvRows(rows: unknown[][]): string { return rows.map((r) => r.map(csvEscape).join(',')).join('\r\n') + '\r\n' }
function csvResponse(text: string): Response { return new Response(text, { status: 200, headers: { 'Content-Type': 'text/csv' } }) }

async function handleReportExport(query: URLSearchParams): Promise<Response> {
  const report = query.get('report') ?? 'funnel'
  if (report === 'win-rate') {
    const data = (await (await handleWinRate(query)).json()) as { months: Record<string, unknown>[] }
    const rows: unknown[][] = [['Month', 'Won', 'Lost', 'Win rate %', 'Won value', 'Avg deal size']]
    for (const m of data.months) rows.push([m.month, m.won, m.lost, m.winRate, m.wonValue, m.avgDealSize])
    return csvResponse(csvRows(rows))
  }
  if (report === 'velocity') {
    const data = (await (await handleVelocity()).json()) as { stages: Array<{ stage: Record<string, unknown>; avgDays: unknown; samples: unknown }> }
    const rows: unknown[][] = [['Stage', 'Avg days', 'Samples']]
    for (const s of data.stages) rows.push([s.stage.name, s.avgDays, s.samples])
    return csvResponse(csvRows(rows))
  }
  if (report === 'activity-volume') {
    const data = (await (await handleActivityVolume(query)).json()) as { weeks: Record<string, unknown>[] }
    const rows: unknown[][] = [['Week', 'Total', 'Emails', 'Notes', 'Tasks', 'Meetings', 'Changes']]
    for (const w of data.weeks) rows.push([w.week, w.total, w.emails, w.notes, w.tasks, w.meetings, w.changes])
    return csvResponse(csvRows(rows))
  }
  const data = (await (await handleFunnel()).json()) as { stages: Array<{ stage: Record<string, unknown>; reached: unknown; conversion: unknown; currentValue: unknown }> }
  const rows: unknown[][] = [['Stage', 'Reached', 'Conversion %', 'Current value']]
  for (const s of data.stages) rows.push([s.stage.name, s.reached, s.conversion, s.currentValue])
  return csvResponse(csvRows(rows))
}

// ---------------------------------------------------------------------------
// CSV import / export (records)
// ---------------------------------------------------------------------------

const IMPORT_FIELDS: Record<RecordType, string[]> = {
  person: ['first_name', 'last_name', 'email', 'phone', 'job_title', 'company', 'location', 'linkedin', 'description'],
  company: ['name', 'domain', 'industry', 'size', 'location', 'annual_revenue', 'linkedin', 'description'],
  deal: ['name', 'value', 'currency', 'status', 'expected_close_date', 'company', 'owner', 'description'],
}

function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines: string[][] = []
  let field = ''; let row: string[] = []; let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (inQuotes) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false }
      else field += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n') { row.push(field); lines.push(row); row = []; field = '' }
    else if (ch === '\r') { /* skip */ }
    else field += ch
  }
  if (field.length > 0 || row.length > 0) { row.push(field); lines.push(row) }
  const headerRow = lines.shift() ?? []
  const headers = headerRow.map((h) => h.trim())
  const rows = lines.filter((l) => l.some((c) => c.trim() !== '')).map((l) => {
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = (l[i] ?? '').trim() })
    return obj
  })
  return { headers, rows }
}

async function handleImportFields(query: URLSearchParams): Promise<Response> {
  const type = (query.get('record_type') ?? 'person') as RecordType
  return json({ fields: IMPORT_FIELDS[type] ?? IMPORT_FIELDS.person })
}

async function handleImportCsv(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const type = String(body.record_type ?? 'person') as RecordType
  const text = String(body.csv_text ?? '').trim()
  if (!text) return json({ created: 0, skipped: 0, errors: [], message: 'No CSV content provided' })
  const { headers, rows } = parseCsv(text)
  let mapping = (body.mapping && typeof body.mapping === 'object') ? { ...(body.mapping as Record<string, string>) } : {}
  if (Object.keys(mapping).length === 0) {
    const known = new Set(IMPORT_FIELDS[type] ?? [])
    for (const h of headers) { const k = h.toLowerCase().replace(/\s+/g, '_'); if (known.has(k)) mapping[h] = k }
  }
  const dedupe = body.dedupe !== false

  const companyByName = new Map<string, string>()
  for (const c of await pbList('companies', 'perPage=200')) companyByName.set(String(c.name ?? '').toLowerCase(), String(c.id))
  const existingEmails = new Set<string>()
  const existingDomains = new Set<string>()
  if (type === 'person') for (const p of await pbList('people', 'perPage=200')) { const e = String(p.email ?? '').toLowerCase(); if (e) existingEmails.add(e) }
  if (type === 'company') for (const c of await pbList('companies', 'perPage=200')) { const d = String(c.domain ?? '').toLowerCase(); if (d) existingDomains.add(d) }

  let created = 0; let skipped = 0; const errors: string[] = []
  const firstMain = type === 'deal' ? await firstMainStagePb() : null
  const createdIds: string[] = []

  for (let ln = 0; ln < rows.length; ln++) {
    const raw = rows[ln]!
    const data: Record<string, string> = {}
    for (const [col, field] of Object.entries(mapping)) if (raw[col] != null) data[field] = String(raw[col]).trim()
    if (!Object.values(data).some((v) => v)) { skipped++; continue }
    try {
      let rec: PbRecord | null = null
      if (type === 'person') {
        const email = (data.email ?? '').toLowerCase()
        if (dedupe && email && existingEmails.has(email)) { skipped++; continue }
        let companyPb: string | undefined
        const cname = (data.company ?? '').toLowerCase()
        if (cname) {
          companyPb = companyByName.get(cname)
          if (!companyPb) { const c = await pbCreate('companies', { name: data.company }); if (c) { companyPb = String(c.id); companyByName.set(cname, companyPb) } }
        }
        const name = `${data.first_name ?? ''} ${data.last_name ?? ''}`.trim() || data.email || 'Unnamed person'
        const create: Record<string, unknown> = { name, email: data.email ?? '', phone: data.phone ?? '', title: data.job_title ?? '' }
        if (companyPb) create.company = companyPb
        rec = await pbCreate('people', create)
        if (email) existingEmails.add(email)
      } else if (type === 'company') {
        const domain = (data.domain ?? '').toLowerCase()
        if (dedupe && domain && existingDomains.has(domain)) { skipped++; continue }
        rec = await pbCreate('companies', { name: data.name ?? '', domain: data.domain ?? '', industry: data.industry ?? '' })
        if (domain) existingDomains.add(domain)
      } else {
        const cname = (data.company ?? '').toLowerCase()
        const create: Record<string, unknown> = { name: data.name ?? '', value: toNum(data.value, 0), close_date: data.expected_close_date ?? '' }
        if (firstMain) create.stage = firstMain
        if (cname && companyByName.get(cname)) create.company = companyByName.get(cname)
        rec = await pbCreate('deals', create)
      }
      if (rec) { created++; createdIds.push(String(rec.id)); await writeActivity(type, String(rec.id), 'created', `${String(rec.name ?? '')} imported from CSV`) }
      else { skipped++ }
    } catch (e) { errors.push(`Row ${ln + 2}: ${String(e)}`); skipped++ }
  }

  // Optional list placement
  const listId = body.list_id != null ? Number(body.list_id) : null
  const pbListId = listId != null ? pid(listId) : null
  if (pbListId && pbListId !== MAIN_PIPELINE && createdIds.length > 0) {
    const ls = listStagesOf(await loadStages(), pbListId)
    const stagePb = ls[0] ? String(ls[0].id) : null
    for (let i = 0; i < createdIds.length; i++) {
      const d: Record<string, unknown> = { list: pbListId, record_id: createdIds[i]!, position: i }
      if (stagePb) d.stage = stagePb
      await pbCreate('list_entries', d)
    }
  }
  return json({ created, skipped, errors: errors.slice(0, 20), message: `Imported ${created} ${type}(s), skipped ${skipped}` })
}

async function handleExportCsv(query: URLSearchParams): Promise<Response> {
  const type = (query.get('record_type') ?? 'person') as RecordType
  const listId = query.get('list_id')
  const idsParam = query.get('ids')
  const allStages = await loadStages()
  const stageById = new Map(allStages.map((s) => [String(s.id), s]))
  const companyMap = await loadCompanyMap()

  let recs: PbRecord[]
  const pbListId = listId ? pid(Number(listId)) : null
  if (pbListId && pbListId !== MAIN_PIPELINE) {
    const entries = await pbList('list_entries', `perPage=200&filter=${enc(`list='${pbListId}'`)}`)
    recs = []
    for (const e of entries) { const r = await pbGet(TYPE_TO_COLLECTION[type], String(e.record_id)); if (r) recs.push(r) }
  } else {
    recs = await pbList(TYPE_TO_COLLECTION[type], 'perPage=200')
  }
  if (idsParam) {
    const wanted = new Set(idsParam.split(',').map((x) => pid(x.trim())).filter(Boolean) as string[])
    recs = recs.filter((r) => wanted.has(String(r.id)))
  }

  const attrs = await loadAttributes(TYPE_TO_COLLECTION[type])
  const valMap = await valuesForRecords(TYPE_TO_COLLECTION[type], recs.map((r) => String(r.id)))
  const rows: unknown[][] = []

  if (type === 'person') {
    rows.push(['first_name', 'last_name', 'email', 'phone', 'job_title', 'company', 'location', 'linkedin', 'description', ...attrs.map((a) => a.slug)])
    for (const r of recs) {
      const { first, last } = splitName(String(r.name ?? ''))
      const company = r.company ? companyMap.get(String(r.company)) : undefined
      const vals = valMap.get(String(r.id)) ?? {}
      rows.push([first, last, r.email ?? '', r.phone ?? '', r.title ?? '', company ? String(company.name ?? '') : '', '', '', '', ...attrs.map((a) => vals[a.slug] ?? '')])
    }
  } else if (type === 'company') {
    rows.push(['name', 'domain', 'industry', 'size', 'location', 'annual_revenue', 'linkedin', 'description', ...attrs.map((a) => a.slug)])
    for (const r of recs) { const vals = valMap.get(String(r.id)) ?? {}; rows.push([r.name ?? '', r.domain ?? '', r.industry ?? '', '', '', '', '', '', ...attrs.map((a) => vals[a.slug] ?? '')]) }
  } else {
    rows.push(['name', 'value', 'currency', 'status', 'expected_close_date', 'company', 'owner', 'description', ...attrs.map((a) => a.slug)])
    for (const r of recs) {
      const stage = r.stage ? stageById.get(String(r.stage)) : undefined
      const f = stageFlags(stage ? String(stage.name ?? '') : '')
      const company = r.company ? companyMap.get(String(r.company)) : undefined
      const vals = valMap.get(String(r.id)) ?? {}
      rows.push([r.name ?? '', toNum(r.value), 'USD', f.isWon ? 'won' : f.isLost ? 'lost' : 'open', r.close_date ?? '', company ? String(company.name ?? '') : '', '', '', ...attrs.map((a) => vals[a.slug] ?? '')])
    }
  }
  return csvResponse(csvRows(rows))
}

async function handleSeedDemo(): Promise<Response> {
  appState = { ...appState, demoSeeded: true }
  const people = (await pbList('people', 'perPage=1&fields=id')).length
  return json({ status: 'seeded', people, companies: 0, deals: 0 })
}
async function handleSeedClear(): Promise<Response> {
  for (const c of ['attribute_values', 'list_entries', 'attachments', 'emails', 'notes', 'activities', 'tasks', 'deals', 'people', 'companies']) {
    const rows = await pbList(c, 'perPage=200&fields=id')
    for (const r of rows) await pbDelete(c, String(r.id))
  }
  appState = { ...appState, demoSeeded: false }
  return json({ status: 'cleared' })
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

function renderTemplate(text: string, vars: Record<string, unknown>): string {
  return String(text ?? '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k: string) => (vars[k] != null ? String(vars[k]) : `{{${k}}}`))
}

function emailLogFromPb(rec: PbRecord, recordType: RecordType | null, recordId: number | null): Record<string, unknown> {
  const status = String(rec.status ?? 'logged')
  return {
    id: iid(String(rec.id)),
    personId: rec.person ? iid(String(rec.person)) : null,
    recordType,
    recordId,
    direction: status === 'logged' ? 'logged' : 'outbound',
    to: String(rec.to ?? ''),
    from: '',
    subject: String(rec.subject ?? ''),
    body: String(rec.body ?? ''),
    status: status === 'sent' ? 'sent' : status === 'failed' ? 'failed' : 'logged',
    error: String(rec.detail ?? ''),
    createdBy: '',
    sentAt: rec.created ? String(rec.created) : CREATED_AT,
  }
}

function emptyConfig(configured: boolean): Record<string, unknown> {
  return { host: '', port: 587, username: '', password: '', fromEmail: '', fromName: '', useTls: true, configured }
}

async function handleEmailSend(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  let subject = String(body.subject ?? '')
  let content = String(body.body ?? '')
  const type = body.record_type ? (String(body.record_type) as RecordType) : null
  const recordIntId = body.record_id != null ? Number(body.record_id) : null
  const personPb = body.person_id != null ? pid(body.person_id) : null

  if (body.template_id != null) {
    const tplPb = pid(body.template_id)
    if (tplPb) { const tpl = await pbGet('email_templates', tplPb); if (tpl) { subject = subject || String(tpl.subject ?? ''); content = content || String(tpl.body ?? '') } }
  }
  // Template variables from the linked person / deal
  const vars: Record<string, unknown> = {}
  const personForVars = personPb ?? (type === 'person' && recordIntId ? pid(recordIntId) : null)
  if (personForVars) { const p = await pbGet('people', personForVars); if (p) { const { first, last } = splitName(String(p.name ?? '')); vars.first_name = first; vars.last_name = last; vars.name = String(p.name ?? ''); vars.job_title = String(p.title ?? '') } }
  subject = renderTemplate(subject, vars)
  content = renderTemplate(content, vars)

  let to = String(body.to ?? '')
  if (!to && personForVars) { const p = await pbGet('people', personForVars); if (p && p.email) to = String(p.email) }

  const res = await opPost('/api/ops/emails/send', { to, subject, body: content, person_id: personForVars ?? '' })
  const status = String((res.data.status as string) ?? (res.ok ? 'logged' : 'failed'))
  const ok = status === 'sent'
  const notConfigured = status === 'logged'
  // Read back the row the op just wrote to build the V1 EmailLog.
  const rows = await pbList('emails', 'perPage=1&sort=-created')
  const logRec = rows[0]
  const log = logRec ? emailLogFromPb(logRec, type, recordIntId) : {
    id: iid(genId()), personId: personForVars ? iid(personForVars) : null, recordType: type, recordId: recordIntId,
    direction: 'outbound', to, from: '', subject, body: content, status, error: String(res.data.detail ?? ''), createdBy: '', sentAt: nowIso(),
  }
  if (ok && type && recordIntId != null) { const rp = pid(recordIntId); if (rp) await writeActivity(type, rp, 'email', `Email sent: ${subject || '(no subject)'}`) }
  return json({ ok, status, error: String(res.data.detail ?? ''), notConfigured, log })
}

async function handleEmailLogManual(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const type = body.record_type ? (String(body.record_type) as RecordType) : null
  const recordIntId = body.record_id != null ? Number(body.record_id) : null
  const personPb = body.person_id != null ? pid(body.person_id) : (type === 'person' && recordIntId ? pid(recordIntId) : null)
  const data: Record<string, unknown> = { to: String(body.to ?? '') || 'unknown@example.com', subject: String(body.subject ?? '') || '(no subject)', body: String(body.body ?? ''), status: 'logged', detail: '' }
  if (personPb) data.person = personPb
  const created = await pbCreate('emails', data)
  if (type && recordIntId != null) { const rp = pid(recordIntId); if (rp) await writeActivity(type, rp, 'email', `Email logged: ${String(body.subject ?? '') || '(no subject)'}`) }
  return json(created ? emailLogFromPb(created, type, recordIntId) : { status: 'noop' })
}

async function handleEmailLogs(query: URLSearchParams): Promise<Response> {
  const type = query.get('record_type') as RecordType | null
  const recordId = query.get('record_id')
  // emails only carry a `person` relation → non-person records have no logs.
  if (type === 'person' && recordId) {
    const pbId = pid(recordId)
    if (pbId) {
      const rows = await pbList('emails', `perPage=200&sort=-created&filter=${enc(`person='${pbId}'`)}`)
      return json({ items: rows.map((r) => emailLogFromPb(r, 'person', Number(recordId))), total: rows.length })
    }
  }
  return json({ items: [], total: 0 })
}

function templateDict(rec: PbRecord): Record<string, unknown> {
  return { id: iid(String(rec.id)), name: String(rec.name ?? ''), subject: String(rec.subject ?? ''), body: String(rec.body ?? ''), createdAt: rec.created ? String(rec.created) : CREATED_AT, updatedAt: rec.created ? String(rec.created) : CREATED_AT }
}
async function handleTemplatesList(): Promise<Response> {
  const rows = await pbList('email_templates', 'perPage=200&sort=name')
  return json(rows.map(templateDict))
}
async function handleTemplateCreate(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const created = await pbCreate('email_templates', { name: String(body.name ?? 'New template').trim() || 'New template', subject: String(body.subject ?? ''), body: String(body.body ?? '') })
  if (!created) return json({ detail: 'Failed to create template' }, 400)
  return json(templateDict(created))
}
async function handleTemplateUpdate(intId: number, init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const pbId = pid(intId)
  if (!pbId) return json({ status: 'not_found', resource: 'template' })
  const patch: Record<string, unknown> = {}
  if (body.name != null) patch.name = String(body.name)
  if (body.subject != null) patch.subject = String(body.subject)
  if (body.body != null) patch.body = String(body.body)
  const updated = Object.keys(patch).length ? await pbPatch('email_templates', pbId, patch) : await pbGet('email_templates', pbId)
  if (!updated) return json({ status: 'not_found', resource: 'template' })
  return json(templateDict(updated))
}
async function handleTemplateDelete(intId: number): Promise<Response> {
  const pbId = pid(intId)
  if (pbId) await pbDelete('email_templates', pbId)
  return json({ status: 'deleted', id: intId })
}

// ---------------------------------------------------------------------------
// AI (routed onto the PB /api/ops/* LLM bridge)
// ---------------------------------------------------------------------------

function parseJsonReply(text: string): Record<string, unknown> | null {
  const t = String(text ?? '').trim()
  try { return JSON.parse(t) as Record<string, unknown> } catch { /* */ }
  const m = t.match(/\{[\s\S]*\}/)
  if (m) { try { return JSON.parse(m[0]) as Record<string, unknown> } catch { /* */ } }
  return null
}

async function handleAiStatus(): Promise<Response> {
  // No cheap availability probe exists; assume the CraftBot LLM bridge is
  // present (individual calls degrade honestly to configured:false on 503).
  return json({ configured: true, model: 'CraftBot AI' })
}

async function handleAiSummary(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const type = String(body.record_type ?? 'person') as RecordType
  const pbId = body.record_id != null ? pid(body.record_id) : null
  if (!pbId) return json({ configured: true, ok: false, error: 'Record not found' })
  const kind = TYPE_TO_COLLECTION[type]
  const res = await opPost('/api/ops/records/summarize', { kind, id: pbId })
  if (res.status === 503) return json({ configured: false, message: 'No LLM provider is configured in CraftBot. Connect one in CraftBot settings to enable AI features.' })
  const summary = String(res.data.summary ?? '')
  if (!res.ok || !summary) return json({ configured: true, ok: false, error: String(res.data.error ?? 'The LLM request failed. Try again.') })
  let note: Record<string, unknown> | null = null
  if (body.save_as_note) {
    const data: Record<string, unknown> = { body: summary }
    data[relationField(type)] = pbId
    const created = await pbCreate('notes', data)
    if (created) note = noteDict(created)
  }
  return json({ configured: true, ok: true, summary, note })
}

async function handleAiChat(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const question = String(body.question ?? '').trim()
  if (!question) return json({ configured: true, ok: false, error: 'Ask a question about your CRM.' })
  const res = await opPost('/api/ops/ai/chat', { message: question, history: [] })
  if (res.status === 503) return json({ configured: false, message: 'No LLM provider is configured in CraftBot. Connect one in CraftBot settings to enable AI features.' })
  const reply = String(res.data.reply ?? '')
  if (!res.ok || !reply) return json({ configured: true, ok: false, error: String(res.data.error ?? 'The LLM request failed. Try again.') })
  return json({ configured: true, ok: true, answer: reply, records: [] })
}

async function handleAiEmailDraft(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const tone = String(body.tone ?? 'professional')
  const instruction = String(body.instruction ?? 'Write a helpful follow-up email.')
  const parts: string[] = []
  const type = body.record_type ? (String(body.record_type) as RecordType) : null
  const pbId = body.record_id != null ? pid(body.record_id) : null
  if (type && pbId) { const r = await pbGet(TYPE_TO_COLLECTION[type], pbId); if (r) parts.push(`Recipient: ${String(r.name ?? '')}${r.email ? ` <${String(r.email)}>` : ''}`) }
  if (body.current_draft) parts.push(`Current draft to refine:\n${String(body.current_draft)}`)
  if (body.subject) parts.push(`Current subject: ${String(body.subject)}`)
  parts.push(`Instruction: ${instruction}`)
  const message = `Draft a CRM email. Tone: ${tone}. Respond ONLY with JSON {"subject": string, "body": string}. No placeholders like [Name].\n\n${parts.join('\n\n')}`
  const res = await opPost('/api/ops/ai/chat', { message, history: [] })
  if (res.status === 503) return json({ configured: false, message: 'No LLM provider is configured in CraftBot. Connect one in CraftBot settings to enable AI features.' })
  const reply = String(res.data.reply ?? '')
  if (!res.ok || !reply) return json({ configured: true, ok: false, error: String(res.data.error ?? 'The LLM request failed. Try again.') })
  const parsed = parseJsonReply(reply)
  const subject = parsed && typeof parsed.subject === 'string' ? parsed.subject : String(body.subject ?? 'Follow-up')
  const content = parsed && typeof parsed.body === 'string' ? parsed.body : reply
  return json({ configured: true, ok: true, subject, body: content })
}

async function handleAiScore(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const type = String(body.record_type ?? 'person') as RecordType
  const ids = Array.isArray(body.record_ids) ? (body.record_ids as unknown[]) : []
  if (body.record_id != null) ids.push(body.record_id)
  const pbIds = Array.from(new Set(ids.map((i) => pid(i)).filter(Boolean) as string[])).slice(0, 20)
  if (pbIds.length === 0) return json({ configured: true, ok: false, error: 'No records provided' })

  const allStages = await loadStages()
  const stageById = new Map(allStages.map((s) => [String(s.id), s]))
  // Ensure an 'AI Lead Score' attribute exists (number).
  let attrPb: string | null = null
  const attrs = await pbList('attributes', `perPage=50&filter=${enc(`entity='${TYPE_TO_COLLECTION[type]}'`)}`)
  const found = attrs.find((a) => slugify(String(a.name ?? '')) === 'ai_lead_score')
  if (found) attrPb = String(found.id)
  else { const c = await pbCreate('attributes', { entity: TYPE_TO_COLLECTION[type], name: 'AI Lead Score', type: 'number', options: JSON.stringify({ t: 'number', o: [] }) }); if (c) attrPb = String(c.id) }

  const results: Record<string, unknown>[] = []
  let sawUnavailable = false
  for (const pbId of pbIds) {
    const rec = await pbGet(TYPE_TO_COLLECTION[type], pbId)
    if (!rec) continue
    const message = `Score this CRM ${type} 0-100 for how promising it is to pursue now. Respond ONLY with JSON {"score": number, "reasoning": string}.\n\n${JSON.stringify(rec)}`
    const res = await opPost('/api/ops/ai/chat', { message, history: [] })
    if (res.status === 503) { sawUnavailable = true; break }
    const parsed = parseJsonReply(String(res.data.reply ?? ''))
    const rawScore = parsed && typeof parsed.score === 'number' ? parsed.score : null
    if (rawScore == null) continue
    const score = Math.max(0, Math.min(100, Math.round(rawScore)))
    if (attrPb) await upsertAttributeValue(attrPb, pbId, score)
    results.push({ recordId: iid(pbId), record: recordBrief(rec, type, stageById), score, reasoning: parsed && typeof parsed.reasoning === 'string' ? parsed.reasoning : '' })
  }
  if (sawUnavailable && results.length === 0) return json({ configured: false, message: 'No LLM provider is configured in CraftBot. Connect one in CraftBot settings to enable AI features.' })
  return json({ configured: true, ok: true, results, attributeSlug: 'ai_lead_score' })
}

async function handleAiRuns(): Promise<Response> {
  // No AiRun collection in V2 — audit history is decorative/empty.
  return json([])
}
// ---------------------------------------------------------------------------
// Auth bridge (/api/auth/*) — sourced from the pocketbase_auth session
// ---------------------------------------------------------------------------

function emailLocal(email: string): string { const at = email.indexOf('@'); return at > 0 ? email.slice(0, at) : email }

function toAuthUser(rec: PbRecord | null): Record<string, unknown> | null {
  if (!rec) return null
  const email = String(rec.email ?? '')
  const username = String(rec.username ?? rec.name ?? emailLocal(email))
  return {
    id: iid(String(rec.id ?? '')),
    email,
    username,
    role: 'member',
    isActive: true,
    createdAt: rec.created ? String(rec.created) : CREATED_AT,
  }
}

function membershipDict(u: PbRecord, resourceType: string, resourceId: number): Record<string, unknown> {
  return {
    id: iid(String(u.id)),
    userId: iid(String(u.id)),
    resourceType,
    resourceId,
    role: 'member',
    joinedAt: u.created ? String(u.created) : CREATED_AT,
    user: toAuthUser(u),
  }
}

async function handleAuthMe(): Promise<Response> {
  const rec = currentUserRecord()
  return json({ user: toAuthUser(rec) })
}

async function handleAuthLogin(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  try {
    const res = await originalFetch('/api/collections/users/auth-with-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: String(body.email ?? ''), password: String(body.password ?? '') }),
    })
    if (!res.ok) { const e = (await res.json().catch(() => ({}))) as { message?: string }; return json({ detail: e.message || 'Invalid email or password' }, 401) }
    const data = (await res.json()) as { token: string; record: PbRecord }
    persistSession(data.token, data.record)
    return json({ user: toAuthUser(data.record), token: data.token })
  } catch { return json({ detail: 'Login failed' }, 401) }
}

async function handleAuthRegister(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const email = String(body.email ?? ''); const username = String(body.username ?? ''); const password = String(body.password ?? '')
  try {
    const createRes = await originalFetch('/api/collections/users/records', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, passwordConfirm: password, name: username, emailVisibility: true }),
    })
    if (!createRes.ok) { const e = (await createRes.json().catch(() => ({}))) as { message?: string }; return json({ detail: e.message || 'Registration failed' }, 400) }
    const authRes = await originalFetch('/api/collections/users/auth-with-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: email, password }),
    })
    if (!authRes.ok) return json({ detail: 'Registration succeeded but auto-login failed' }, 400)
    const data = (await authRes.json()) as { token: string; record: PbRecord }
    persistSession(data.token, data.record)
    return json({ user: toAuthUser(data.record), token: data.token })
  } catch { return json({ detail: 'Registration failed' }, 400) }
}

async function handleAuthLogout(): Promise<Response> { clearSession(); return json({ message: 'Logged out' }) }

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
  const next = String(body.new_password ?? '')
  if (next.length < 6) return json({ detail: 'Password must be at least 6 characters' }, 400)
  try {
    const res = await originalFetch(`/api/collections/users/records/${rec.id}`, {
      method: 'PATCH', headers: pbHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ oldPassword: String(body.current_password ?? ''), password: next, passwordConfirm: next }),
    })
    if (!res.ok) { const e = (await res.json().catch(() => ({}))) as { message?: string }; return json({ detail: e.message || 'Current password is incorrect' }, 400) }
    return json({ message: 'Password updated' })
  } catch { return json({ detail: 'Password change failed' }, 400) }
}

async function handleAuthUsers(): Promise<Response> {
  const rows = await pbList('users', 'perPage=200&sort=created')
  return json({ users: rows.map(toAuthUser) })
}

async function handleMembersList(resourceType: string, resourceId: number): Promise<Response> {
  const rows = await pbList('users', 'perPage=200&sort=created')
  return json({ members: rows.map((u) => membershipDict(u, resourceType, resourceId)) })
}

function handleMemberAdd(resourceType: string, resourceId: number, init?: RequestInit): Response {
  const body = readBody(init)
  // Decorative: registration is open; membership is not separately stored.
  return json({ membership: { id: iid(genId()), userId: body.user_id != null ? Number(body.user_id) : 0, resourceType, resourceId, role: String(body.role ?? 'member'), joinedAt: nowIso(), user: null } })
}
function handleMemberRemove(): Response { return json({ message: 'Member removed' }) }
function handleInviteCreate(init?: RequestInit): Response {
  const body = readBody(init)
  const code = genId()
  return json({ invite: { id: iid(code), code, resourceType: String(body.resource_type ?? 'board'), resourceId: body.resource_id != null ? Number(body.resource_id) : 0, defaultRole: String(body.default_role ?? 'member'), isActive: true, maxUses: body.max_uses != null ? Number(body.max_uses) : null, useCount: 0, createdAt: nowIso() } })
}
function handleInviteAccept(code: string): Response {
  const rec = currentUserRecord()
  return json({ membership: { id: iid(`${rec ? String(rec.id) : 'anon'}:${code}`), userId: rec ? iid(String(rec.id)) : 0, resourceType: 'board', resourceId: 0, role: 'member', joinedAt: nowIso(), user: toAuthUser(rec) }, message: 'Joined' })
}

// ---------------------------------------------------------------------------
// Generic in-memory app state (V1 stored it in SQLite; UI needs a stable object)
// ---------------------------------------------------------------------------

let appState: Record<string, unknown> = {}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

function asType(s: string): RecordType {
  return s === 'company' || s === 'deal' ? s : 'person'
}

async function route(url: URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase()
  const path = url.pathname
  const query = url.searchParams
  let m: RegExpMatchArray | null

  // ── Health / agent instrumentation no-ops ─────────────────────────────────
  if (path === '/health') return json({ status: 'ok' })
  if (path === '/api/state') {
    if (method === 'GET') return json(appState)
    if (method === 'DELETE') { appState = {}; return json({ status: 'cleared' }) }
    const body = readBody(init)
    const data = (body.data as Record<string, unknown>) ?? {}
    appState = { ...appState, ...data }
    return json(appState)
  }
  if (path === '/api/state/replace') { const body = readBody(init); appState = (body.data as Record<string, unknown>) ?? {}; return json(appState) }
  if (path === '/api/action') return json({ status: 'unknown_action' })
  if (path === '/api/ui-snapshot') {
    if (method === 'GET') return json({ htmlStructure: null, visibleText: [], inputValues: {}, componentState: {}, currentView: null, viewport: {}, timestamp: null, status: 'no_snapshot' })
    return json({ status: 'ok' })
  }
  if (path === '/api/ui-screenshot') {
    if (method === 'GET') return json({ imageData: null, width: null, height: null, timestamp: null, status: 'no_screenshot' })
    return json({ status: 'updated', timestamp: nowIso() })
  }
  if (path === '/api/logs') return json({ ok: true })
  if (path === '/api/settings') { if (method === 'GET') return json({}); return json(readBody(init)) }

  // ── Auth bridge ───────────────────────────────────────────────────────────
  if (path === '/api/auth/me') { if (method === 'GET') return handleAuthMe(); if (method === 'PUT') return handleUpdateProfile(init) }
  if (path === '/api/auth/me/password' && method === 'PUT') return handleChangePassword(init)
  if (path === '/api/auth/login' && method === 'POST') return handleAuthLogin(init)
  if (path === '/api/auth/register' && method === 'POST') return handleAuthRegister(init)
  if (path === '/api/auth/logout' && method === 'POST') return handleAuthLogout()
  if (path === '/api/auth/users' && method === 'GET') return handleAuthUsers()
  if ((m = path.match(/^\/api\/auth\/members\/([^/]+)\/([^/]+)\/([^/]+)$/)) && method === 'DELETE') return handleMemberRemove()
  if ((m = path.match(/^\/api\/auth\/members\/([^/]+)\/([^/]+)$/))) {
    const type = decodeURIComponent(m[1]!); const id = Number(decodeURIComponent(m[2]!))
    if (method === 'GET') return handleMembersList(type, id)
    if (method === 'POST') return handleMemberAdd(type, id, init)
  }
  if (path === '/api/auth/invites' && method === 'POST') return handleInviteCreate(init)
  if ((m = path.match(/^\/api\/auth\/invites\/([^/]+)\/accept$/)) && method === 'POST') return handleInviteAccept(decodeURIComponent(m[1]!))

  // ── Search ────────────────────────────────────────────────────────────────
  if (path === '/api/search' && method === 'GET') return handleSearch(query)

  // ── Records ───────────────────────────────────────────────────────────────
  if ((m = path.match(/^\/api\/records\/([^/]+)\/query$/)) && method === 'POST') return handleRecordQuery(asType(m[1]!), init)
  if ((m = path.match(/^\/api\/records\/([^/]+)\/check-duplicates$/)) && method === 'GET') return handleCheckDuplicates(asType(m[1]!), query)
  if ((m = path.match(/^\/api\/records\/([^/]+)\/(\d+)$/))) {
    const type = asType(m[1]!); const id = Number(m[2])
    if (method === 'GET') return handleRecordGet(type, id)
    if (method === 'PUT') return handleRecordUpdate(type, id, init)
    if (method === 'DELETE') return handleRecordDelete(type, id)
  }
  if ((m = path.match(/^\/api\/records\/([^/]+)$/))) {
    const type = asType(m[1]!)
    if (method === 'POST') return handleRecordCreate(type, init)
    if (method === 'GET') return handleRecordQuery(type, init)
  }
  if ((m = path.match(/^\/api\/deals\/(\d+)\/people\/(\d+)$/)) && method === 'DELETE') return handleUnlinkDealPerson(Number(m[1]), Number(m[2]))
  if ((m = path.match(/^\/api\/deals\/(\d+)\/people$/)) && method === 'POST') return handleLinkDealPerson(Number(m[1]), init)

  // ── Attributes ────────────────────────────────────────────────────────────
  if (path === '/api/attributes') { if (method === 'GET') return handleAttributesList(query); if (method === 'POST') return handleAttributeCreate(init) }
  if ((m = path.match(/^\/api\/attributes\/(\d+)$/))) { const id = Number(m[1]); if (method === 'PUT') return handleAttributeUpdate(id, init); if (method === 'DELETE') return handleAttributeDelete(id) }
  if (path === '/api/attribute-values' && method === 'POST') return handleWriteValue(init)

  // ── Lists / stages / entries ──────────────────────────────────────────────
  if (path === '/api/lists') { if (method === 'GET') return handleListsAll(); if (method === 'POST') return handleListCreate(init) }
  if ((m = path.match(/^\/api\/lists\/(\d+)\/board$/)) && method === 'GET') return handleBoard(Number(m[1]))
  if ((m = path.match(/^\/api\/lists\/(\d+)\/stages-reorder$/)) && method === 'PUT') return handleStagesReorder(Number(m[1]), init)
  if ((m = path.match(/^\/api\/lists\/(\d+)\/stages$/)) && method === 'POST') return handleStageCreate(Number(m[1]), init)
  if ((m = path.match(/^\/api\/lists\/(\d+)\/entries\/(\d+)$/)) && method === 'DELETE') return handleEntryRemove(Number(m[2]))
  if ((m = path.match(/^\/api\/lists\/(\d+)\/entries$/)) && method === 'POST') return handleEntryAdd(Number(m[1]), init)
  if ((m = path.match(/^\/api\/lists\/(\d+)$/))) { const id = Number(m[1]); if (method === 'GET') return handleListGet(id); if (method === 'PUT') return handleListUpdate(id, init); if (method === 'DELETE') return handleListDelete(id) }
  if ((m = path.match(/^\/api\/entries\/(\d+)\/move$/)) && method === 'PUT') return handleEntryMove(Number(m[1]), init)
  if ((m = path.match(/^\/api\/stages\/(\d+)$/))) { const id = Number(m[1]); if (method === 'PUT') return handleStageUpdate(id, init); if (method === 'DELETE') return handleStageDelete(id) }

  // ── Views ─────────────────────────────────────────────────────────────────
  if (path === '/api/views') { if (method === 'GET') return handleViewsList(query); if (method === 'POST') return handleViewCreate(init) }
  if ((m = path.match(/^\/api\/views\/(\d+)$/))) { const id = Number(m[1]); if (method === 'PUT') return handleViewUpdate(id, init); if (method === 'DELETE') return handleViewDelete(id) }

  // ── Timeline / notes ──────────────────────────────────────────────────────
  if ((m = path.match(/^\/api\/timeline\/([^/]+)\/(\d+)$/)) && method === 'GET') return handleTimelineGet(asType(m[1]!), Number(m[2]), query)
  if (path === '/api/activities' && method === 'POST') return handleActivityLog(init)
  if ((m = path.match(/^\/api\/activities\/(\d+)$/)) && method === 'DELETE') return handleActivityDelete(Number(m[1]))
  if ((m = path.match(/^\/api\/notes\/([^/]+)\/(\d+)$/)) && method === 'GET') return handleNotesList(asType(m[1]!), Number(m[2]))
  if (path === '/api/notes' && method === 'POST') return handleNoteCreate(init)
  if ((m = path.match(/^\/api\/notes\/(\d+)$/))) { const id = Number(m[1]); if (method === 'PUT') return handleNoteUpdate(id, init); if (method === 'DELETE') return handleNoteDelete(id) }

  // ── Tasks ─────────────────────────────────────────────────────────────────
  if (path === '/api/tasks/my-work' && method === 'GET') return handleMyWork()
  if (path === '/api/tasks') { if (method === 'GET') return handleTasksList(query); if (method === 'POST') return handleTaskCreate(init) }
  if ((m = path.match(/^\/api\/tasks\/(\d+)$/))) { const id = Number(m[1]); if (method === 'PUT') return handleTaskUpdate(id, init); if (method === 'DELETE') return handleTaskDelete(id) }

  // ── Email ─────────────────────────────────────────────────────────────────
  if (path === '/api/email/config') { if (method === 'GET') return json(emptyConfig(false)); if (method === 'PUT') { const b = readBody(init); return json({ ...emptyConfig(Boolean(b.host && b.from_email)) }) } }
  if (path === '/api/email/config/test' && method === 'POST') return json({ ok: false, error: 'Email is delivered via the CraftBot Gmail integration; SMTP test is not applicable.', notConfigured: true })
  if (path === '/api/email/send' && method === 'POST') return handleEmailSend(init)
  if (path === '/api/email/log' && method === 'POST') return handleEmailLogManual(init)
  if (path === '/api/email/logs' && method === 'GET') return handleEmailLogs(query)
  if (path === '/api/email/templates') { if (method === 'GET') return handleTemplatesList(); if (method === 'POST') return handleTemplateCreate(init) }
  if ((m = path.match(/^\/api\/email\/templates\/(\d+)$/))) { const id = Number(m[1]); if (method === 'PUT') return handleTemplateUpdate(id, init); if (method === 'DELETE') return handleTemplateDelete(id) }

  // ── Tags ──────────────────────────────────────────────────────────────────
  if (path === '/api/tags') { if (method === 'GET') return handleTagsList(); if (method === 'POST') return handleTagCreate(init) }
  if ((m = path.match(/^\/api\/tags\/(\d+)\/records\/([^/]+)\/(\d+)$/)) && method === 'DELETE') return handleTagUnassign(Number(m[1]), asType(m[2]!), Number(m[3]))
  if ((m = path.match(/^\/api\/tags\/(\d+)\/records$/)) && method === 'POST') return handleTagAssign(Number(m[1]), init)
  if ((m = path.match(/^\/api\/tags\/(\d+)$/))) { const id = Number(m[1]); if (method === 'PUT') return handleTagUpdate(id, init); if (method === 'DELETE') return handleTagDelete(id) }

  // ── Files ─────────────────────────────────────────────────────────────────
  if ((m = path.match(/^\/api\/files\/download\/(\d+)$/)) && method === 'GET') return handleFileDownload(Number(m[1]))
  if ((m = path.match(/^\/api\/files\/([^/]+)\/(\d+)$/)) && method === 'GET') return handleFilesList(asType(m[1]!), Number(m[2]))
  if (path === '/api/files' && method === 'POST') return handleFileUpload(init)
  if ((m = path.match(/^\/api\/files\/(\d+)$/)) && method === 'DELETE') return handleFileDelete(Number(m[1]))

  // ── Reports ───────────────────────────────────────────────────────────────
  if (path === '/api/dashboard' && method === 'GET') return handleDashboard()
  if (path === '/api/reports/funnel' && method === 'GET') return handleFunnel()
  if (path === '/api/reports/win-rate' && method === 'GET') return handleWinRate(query)
  if (path === '/api/reports/velocity' && method === 'GET') return handleVelocity()
  if (path === '/api/reports/activity-volume' && method === 'GET') return handleActivityVolume(query)
  if (path === '/api/reports/export' && method === 'GET') return handleReportExport(query)

  // ── AI ────────────────────────────────────────────────────────────────────
  if (path === '/api/ai/status' && method === 'GET') return handleAiStatus()
  if (path === '/api/ai/summary' && method === 'POST') return handleAiSummary(init)
  if (path === '/api/ai/email-draft' && method === 'POST') return handleAiEmailDraft(init)
  if (path === '/api/ai/score' && method === 'POST') return handleAiScore(init)
  if (path === '/api/ai/chat' && method === 'POST') return handleAiChat(init)
  if (path === '/api/ai/runs' && method === 'GET') return handleAiRuns()

  // ── Data IO ───────────────────────────────────────────────────────────────
  if (path === '/api/import/csv' && method === 'POST') return handleImportCsv(init)
  if (path === '/api/import/fields' && method === 'GET') return handleImportFields(query)
  if (path === '/api/export/csv' && method === 'GET') return handleExportCsv(query)
  if (path === '/api/seed/demo' && method === 'POST') return handleSeedDemo()
  if (path === '/api/seed/clear' && method === 'POST') return handleSeedClear()

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
  loadIdMap()
  iid(MAIN_PIPELINE) // reserve a stable int for the virtual pipeline list
  syncAuthToken()

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let urlStr: string
    if (typeof input === 'string') urlStr = input
    else if (input instanceof URL) urlStr = input.href
    else urlStr = input.url

    if (urlStr.startsWith(SENTINEL)) {
      let effInit = init
      if (!effInit && typeof input !== 'string' && !(input instanceof URL)) effInit = { method: input.method }
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
