/**
 * apiAdapter.ts — client-side fetch shim that lets the UNCHANGED V1
 * (Python/FastAPI) Habit Tracker frontend run against the V2 PocketBase backend.
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
 *     so they reach that same PocketBase server.
 *
 * SERVER-COMPUTED DATA REPRODUCED CLIENT-SIDE
 * -------------------------------------------
 * V1 computed streaks, completion rate, trend, heatmap cells, per-entry
 * `completed` flags and the dashboard summary on the server (services/streaks.py
 * + models.Habit.is_completed / .intensity). PocketBase only stores the raw
 * `entries` rows, so this adapter reproduces every one of those computations
 * here using the SAME rules as streaks.py. Day boundaries follow the V1
 * convention: entries are keyed by a local-day string (YYYY-MM-DD, matching
 * lib/dates.ts todayIso()) and all arithmetic is done on calendar dates via a
 * UTC ordinal so DST never shifts a day.
 *
 * ID TRANSLATION
 * --------------
 * V1 ids are integers and the V1 frontend coerces some of them with `Number()`
 * (e.g. the category <select> in HabitFormModal does `Number(e.target.value)`).
 * PocketBase ids are 15-char strings, which would become `NaN`. So the adapter
 * keeps a stable session registry mapping each PocketBase id to a synthetic
 * integer and back; the frontend only ever sees integers, and inbound ids
 * (URLs, bodies) are translated back to PocketBase strings.
 *
 * TYPE MAPPING
 * ------------
 * V1 habit types are binary | count | duration | negative. The V2 `habits.type`
 * select only allows binary | quantity (the completion rule). Writes map
 * count/duration → quantity and binary/negative → binary, and store the exact
 * V1 type in `habits.kind`. Reads return `kind` when it agrees with `type`;
 * habits without one map quantity → count and binary → binary.
 */

const SENTINEL = 'http://living-ui.local'

// Set the sentinel at import time so component modules pick it up on eval.
;(window as unknown as { __CRAFTBOT_BACKEND_URL__?: string }).__CRAFTBOT_BACKEND_URL__ = SENTINEL

const CREATED_AT = '2024-01-01T00:00:00Z'
const MS_PER_DAY = 86_400_000

type PbRecord = Record<string, unknown>

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

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
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
// back to the raw value so unknown ids fail gracefully (empty PB result) rather
// than throwing.
function pbId(synth: unknown): string {
  if (synth == null || synth === '') return ''
  const n = Number(synth)
  if (!Number.isNaN(n) && idToPb.has(n)) return idToPb.get(n) as string
  return String(synth)
}

// A PocketBase single-relation field comes back as a string id (or, on some
// versions, a one-element array). Normalise to a plain id string.
function relId(v: unknown): string {
  if (Array.isArray(v)) return v.length ? String(v[0]) : ''
  return v == null ? '' : String(v)
}

// ---------------------------------------------------------------------------
// Habit type mapping (V1 4-type ⇄ V2 2-type + stored kind)
// ---------------------------------------------------------------------------

const HABIT_KINDS = ['binary', 'count', 'duration', 'negative']

function toPbType(v1Type: unknown): string {
  const t = String(v1Type ?? 'binary')
  return t === 'count' || t === 'duration' ? 'quantity' : 'binary'
}

// The exact V1 type, stored in `habits.kind`.
function toKind(v1Type: unknown): string {
  const t = String(v1Type ?? 'binary')
  return HABIT_KINDS.includes(t) ? t : 'binary'
}

// The stored kind when it agrees with the stored type; otherwise (a habit saved
// before `kind` existed, or a record write that changed only `type`) the type's
// default label: quantity → count, binary → binary.
function toV1Type(rec: PbRecord): string {
  const kind = String(rec.kind ?? '')
  const stored = habitNumeric(rec) ? 'quantity' : 'binary'
  if (HABIT_KINDS.includes(kind) && toPbType(kind) === stored) return kind
  return stored === 'quantity' ? 'count' : 'binary'
}

// ---------------------------------------------------------------------------
// Date helpers — calendar-date arithmetic via a UTC ordinal (DST-proof).
// `today` is the LOCAL day, matching lib/dates.ts todayIso() which the frontend
// uses when it writes entries.
// ---------------------------------------------------------------------------

function pad(n: number): string { return String(n).padStart(2, '0') }

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function ord(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Math.floor(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / MS_PER_DAY)
}

function isoFromOrd(n: number): string {
  const dt = new Date(n * MS_PER_DAY)
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000
}

// ---------------------------------------------------------------------------
// PocketBase REST helpers (relative urls → PocketBase serving the page)
// ---------------------------------------------------------------------------

// A read that failed: the router answers its status and message, so a backend
// that is down (503) or refuses never passes for an empty list or "not found".
class PbError extends Error {
  status: number
  constructor(failure: { status: number; message: string }) {
    super(failure.message)
    this.status = failure.status
  }
}

const UNREACHABLE = 'Could not reach the backend.'

// GET a PocketBase url; a refusal or no answer at all throws a PbError.
async function pbRead(url: string): Promise<Response> {
  let res: Response
  try {
    res = await originalFetch(url)
  } catch {
    throw new PbError({ status: 503, message: UNREACHABLE })
  }
  if (!res.ok) throw new PbError(await pbFailure(res))
  return res
}

async function pbList(collection: string, query = ''): Promise<PbRecord[]> {
  const res = await pbRead(`/api/collections/${collection}/records?${query}`)
  const body = (await res.json()) as { items?: PbRecord[] }
  return Array.isArray(body.items) ? body.items : []
}

// Page through a collection so large date ranges (a year of entries × habits)
// are never truncated by the 500-per-page cap. A failed read throws (the router
// answers it with an error status) instead of passing for an empty collection,
// so the app's "Failed to load" alert and toasts can show.
async function pbListAll(collection: string, extra = ''): Promise<PbRecord[]> {
  const out: PbRecord[] = []
  let page = 1
  for (;;) {
    const res = await pbRead(
      `/api/collections/${collection}/records?perPage=500&page=${page}${extra ? `&${extra}` : ''}`,
    )
    const body = (await res.json()) as { items?: PbRecord[]; totalPages?: number }
    const items = Array.isArray(body.items) ? body.items : []
    out.push(...items)
    if (items.length === 0 || page >= (body.totalPages ?? 1)) break
    page += 1
  }
  return out
}

// One record, or null only when PocketBase answers 404; any other failure throws.
async function pbGetOne(collection: string, id: string): Promise<PbRecord | null> {
  if (!id) return null
  try {
    const res = await pbRead(`/api/collections/${collection}/records/${encodeURIComponent(id)}`)
    return (await res.json()) as PbRecord
  } catch (err) {
    if (err instanceof PbError && err.status === 404) return null
    throw err
  }
}

// A create that keeps PocketBase's answer, like pbPatchResult.
async function pbCreateResult(
  collection: string,
  data: Record<string, unknown>,
): Promise<{ rec: PbRecord } | { status: number; message: string }> {
  let res: Response
  try {
    res = await originalFetch(`/api/collections/${collection}/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  } catch {
    return { status: 503, message: 'Could not reach the backend; the change was not saved.' }
  }
  if (res.ok) return { rec: (await res.json()) as PbRecord }
  return pbFailure(res)
}

// A PATCH that keeps PocketBase's answer: the saved record, or the real status
// with a message that says what happened (a missing record, the field a
// validation rule refused, or no answer at all).
async function pbPatchResult(
  collection: string,
  id: string,
  data: Record<string, unknown>,
): Promise<{ rec: PbRecord } | { status: number; message: string }> {
  let res: Response
  try {
    res = await originalFetch(`/api/collections/${collection}/records/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  } catch {
    return { status: 503, message: 'Could not reach the backend; the change was not saved.' }
  }
  if (res.ok) return { rec: (await res.json()) as PbRecord }
  return pbFailure(res)
}

// A DELETE that keeps PocketBase's answer, like pbPatchResult.
async function pbDeleteResult(
  collection: string,
  id: string,
): Promise<{ ok: true } | { status: number; message: string }> {
  let res: Response
  try {
    res = await originalFetch(`/api/collections/${collection}/records/${encodeURIComponent(id)}`, { method: 'DELETE' })
  } catch {
    return { status: 503, message: 'Could not reach the backend; nothing was deleted.' }
  }
  if (res.ok) return { ok: true }
  return pbFailure(res)
}

// PocketBase's refusal: its status and what it said.
async function pbFailure(res: Response): Promise<{ status: number; message: string }> {
  let body: { message?: unknown; data?: Record<string, { message?: unknown }> } = {}
  try { body = await res.json() } catch { /* not JSON */ }
  // Validation errors name each refused field ("name: Cannot be blank.").
  const fields = Object.entries(body.data ?? {})
    .filter(([, v]) => v && typeof v === 'object' && v.message)
    .map(([k, v]) => `${k}: ${String(v.message)}`)
  const message = fields.length > 0 ? fields.join(' ') : String(body.message ?? '') || `Request failed (${res.status})`
  return { status: res.status, message }
}

function filterQuery(expr: string, extra = ''): string {
  return `perPage=500&filter=${encodeURIComponent(expr)}${extra ? `&${extra}` : ''}`
}

// ---------------------------------------------------------------------------
// Completion / intensity — mirror models.Habit.is_completed / .intensity.
// Depends only on the PB type (binary vs quantity), which is never lossy.
// ---------------------------------------------------------------------------

function habitNumeric(rec: PbRecord): boolean {
  return String(rec.type ?? 'binary') === 'quantity'
}

function habitTarget(rec: PbRecord): number {
  const t = rec.target
  return t == null || t === '' ? 0 : Number(t)
}

function isCompleted(rec: PbRecord, value: number): boolean {
  if (!habitNumeric(rec)) return (value || 0) > 0
  const target = habitTarget(rec)
  if (target <= 0) return (value || 0) > 0
  return (value || 0) >= target
}

function intensity(rec: PbRecord, value: number): number {
  if (value == null || value <= 0) return 0
  if (!habitNumeric(rec)) return 1
  const target = habitTarget(rec)
  if (target <= 0) return value > 0 ? 1 : 0
  const ratio = value / target
  return ratio >= 1 ? 1 : round4(ratio)
}

// ---------------------------------------------------------------------------
// Streak / stats / heatmap — mirror services/streaks.py exactly.
// `norms` is the habit's entries reduced to { day, value }.
// ---------------------------------------------------------------------------

interface Norm { day: string; value: number }

function normsOf(entryRecs: PbRecord[]): Norm[] {
  return entryRecs.map((r) => ({ day: String(r.day ?? ''), value: Number(r.value ?? 0) }))
}

function completedDays(rec: PbRecord, norms: Norm[]): Set<string> {
  const s = new Set<string>()
  for (const n of norms) if (n.day && isCompleted(rec, n.value)) s.add(n.day)
  return s
}

function currentStreak(rec: PbRecord, norms: Norm[], today: string): number {
  const completed = completedDays(rec, norms)
  if (completed.size === 0) return 0
  const t0 = ord(today)
  let anchor: number
  if (completed.has(today)) anchor = t0
  else if (completed.has(isoFromOrd(t0 - 1))) anchor = t0 - 1
  else return 0
  let streak = 0
  let cursor = anchor
  while (completed.has(isoFromOrd(cursor))) {
    streak += 1
    cursor -= 1
  }
  return streak
}

function bestStreak(rec: PbRecord, norms: Norm[]): number {
  const ords = Array.from(completedDays(rec, norms)).map(ord).sort((a, b) => a - b)
  if (ords.length === 0) return 0
  let best = 1
  let run = 1
  for (let i = 1; i < ords.length; i += 1) {
    if (ords[i]! - ords[i - 1]! === 1) {
      run += 1
      if (run > best) best = run
    } else {
      run = 1
    }
  }
  return best
}

function completionRate(rec: PbRecord, norms: Norm[], window: number, today: string): number {
  if (window <= 0) return 0
  const t0 = ord(today)
  const start = t0 - (window - 1)
  const completed = completedDays(rec, norms)
  let n = 0
  for (const day of completed) {
    const o = ord(day)
    if (o >= start && o <= t0) n += 1
  }
  return round4(n / window)
}

function trend(rec: PbRecord, norms: Norm[], window: number, today: string): Record<string, unknown>[] {
  const t0 = ord(today)
  const byDay = new Map<string, number>()
  for (const n of norms) byDay.set(n.day, n.value)
  const out: Record<string, unknown>[] = []
  for (let n = window - 1; n >= 0; n -= 1) {
    const day = isoFromOrd(t0 - n)
    const value = byDay.get(day) ?? 0
    out.push({ date: day, value, completed: isCompleted(rec, value), intensity: intensity(rec, value) })
  }
  return out
}

function totalCompletions(rec: PbRecord, norms: Norm[]): number {
  let n = 0
  for (const nm of norms) if (isCompleted(rec, nm.value)) n += 1
  return n
}

function buildStats(rec: PbRecord, norms: Norm[], window: number, today: string): Record<string, unknown> {
  return {
    currentStreak: currentStreak(rec, norms, today),
    bestStreak: bestStreak(rec, norms),
    completionRate: completionRate(rec, norms, window, today),
    trend: trend(rec, norms, window, today),
    totalCompletions: totalCompletions(rec, norms),
  }
}

// ---------------------------------------------------------------------------
// Shape mappers (V1 field names)
// ---------------------------------------------------------------------------

function toCategory(rec: PbRecord): Record<string, unknown> {
  return {
    id: synthId(rec.id),
    name: String(rec.name ?? ''),
    color: String(rec.color ?? '#737373'),
    order: Number(rec.order ?? 0),
    createdAt: rec.created ? String(rec.created) : CREATED_AT,
    updatedAt: rec.updated ? String(rec.updated) : CREATED_AT,
  }
}

function toEntry(rec: PbRecord, habit: PbRecord | null): Record<string, unknown> {
  const value = Number(rec.value ?? 0)
  return {
    id: synthId(rec.id),
    habitId: synthId(relId(rec.habit)),
    date: String(rec.day ?? ''),
    value,
    note: rec.note ? String(rec.note) : null,
    completed: habit ? isCompleted(habit, value) : value > 0,
    createdAt: rec.created ? String(rec.created) : CREATED_AT,
    updatedAt: rec.updated ? String(rec.updated) : CREATED_AT,
  }
}

// Base habit serialization — mirrors models.Habit.to_dict().
function toHabitBase(rec: PbRecord): Record<string, unknown> {
  const target = rec.target == null || rec.target === '' || Number(rec.target) === 0 ? null : Number(rec.target)
  const catRaw = relId(rec.category)
  const categoryId = catRaw ? synthId(catRaw) : null
  return {
    id: synthId(rec.id),
    name: String(rec.name ?? ''),
    description: rec.description ? String(rec.description) : null,
    type: toV1Type(rec),
    target,
    unit: rec.unit ? String(rec.unit) : null,
    color: String(rec.color ?? '#737373'),
    icon: String(rec.icon ?? 'Circle'),
    category_id: categoryId,
    categoryId,
    order: Number(rec.order ?? 0),
    archived: Boolean(rec.archived),
    createdAt: rec.created ? String(rec.created) : CREATED_AT,
    updatedAt: rec.updated ? String(rec.updated) : CREATED_AT,
  }
}

// List/detail serialization — mirrors routes._habit_with_today():
// base + todayEntry + currentStreak + embedded category.
function toHabitWithToday(
  rec: PbRecord,
  entryRecs: PbRecord[],
  catById: Map<string, PbRecord>,
  today: string,
): Record<string, unknown> {
  const base = toHabitBase(rec)
  const todayRec = entryRecs.find((e) => String(e.day ?? '') === today) ?? null
  base.todayEntry = todayRec ? toEntry(todayRec, rec) : null
  base.currentStreak = currentStreak(rec, normsOf(entryRecs), today)
  const catRaw = relId(rec.category)
  const catRec = catRaw ? catById.get(catRaw) : undefined
  base.category = catRec ? toCategory(catRec) : null
  return base
}

// ---------------------------------------------------------------------------
// In-memory app state (V1 stored it in SQLite; UI only needs a stable object)
// ---------------------------------------------------------------------------

let appState: Record<string, unknown> = {}

// ---------------------------------------------------------------------------
// Handlers — Categories
// ---------------------------------------------------------------------------

async function handleCategoriesList(): Promise<Response> {
  const rows = await pbListAll('categories', 'sort=order,created')
  return json(rows.map(toCategory))
}

async function handleCategoryCreate(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const name = String(body.name ?? '').trim()
  if (!name) return json({ detail: 'name required' }, 400)
  const count = (await pbListAll('categories', 'fields=id')).length
  const res = await pbCreateResult('categories', {
    name,
    color: String(body.color ?? '#737373'),
    order: count,
  })
  if (!('rec' in res)) return json({ detail: res.message }, res.status)
  return json(toCategory(res.rec))
}

async function handleCategoryUpdate(id: string, init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const patch: Record<string, unknown> = {}
  if (body.name !== undefined) patch.name = body.name
  if (body.color !== undefined) patch.color = body.color
  if (body.order !== undefined) patch.order = Number(body.order)
  const res = await pbPatchResult('categories', id, patch)
  if (!('rec' in res)) return json({ detail: res.status === 404 ? 'Category not found' : res.message }, res.status)
  return json(toCategory(res.rec))
}

async function handleCategoryDelete(id: string, synth: string): Promise<Response> {
  // PocketBase clears the (cascadeDelete:false) relation on referencing habits
  // automatically, matching V1's "set category_id NULL" behavior.
  const res = await pbDeleteResult('categories', id)
  if (!('ok' in res)) return json({ detail: res.status === 404 ? 'Category not found' : res.message }, res.status)
  return json({ status: 'deleted', id: synth })
}

// ---------------------------------------------------------------------------
// Handlers — Habits
// ---------------------------------------------------------------------------

async function loadHabitContext(): Promise<{ catById: Map<string, PbRecord>; entriesByHabit: Map<string, PbRecord[]> }> {
  const [cats, entries] = await Promise.all([pbListAll('categories'), pbListAll('entries')])
  const catById = new Map<string, PbRecord>()
  for (const c of cats) catById.set(String(c.id), c)
  const entriesByHabit = new Map<string, PbRecord[]>()
  for (const e of entries) {
    const h = relId(e.habit)
    if (!h) continue
    const arr = entriesByHabit.get(h)
    if (arr) arr.push(e)
    else entriesByHabit.set(h, [e])
  }
  return { catById, entriesByHabit }
}

function sortHabits(rows: PbRecord[]): PbRecord[] {
  return rows.slice().sort((a, b) => {
    const d = Number(a.order ?? 0) - Number(b.order ?? 0)
    if (d !== 0) return d
    return String(a.created ?? '').localeCompare(String(b.created ?? ''))
  })
}

async function handleHabitsList(query: URLSearchParams): Promise<Response> {
  const includeArchived = query.get('include_archived') === 'true'
  const [rows, ctx] = await Promise.all([pbListAll('habits'), loadHabitContext()])
  const today = todayIso()
  const filtered = includeArchived ? rows : rows.filter((r) => r.archived !== true)
  const out = sortHabits(filtered).map((rec) =>
    toHabitWithToday(rec, ctx.entriesByHabit.get(String(rec.id)) ?? [], ctx.catById, today),
  )
  return json(out)
}

async function handleHabitCreate(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const name = String(body.name ?? '').trim()
  if (!name) return json({ detail: 'name required' }, 400)
  const count = (await pbListAll('habits', 'fields=id')).length
  const v1Type = String(body.type ?? 'binary')
  const data: Record<string, unknown> = {
    name,
    description: body.description ?? '',
    type: toPbType(v1Type),
    kind: toKind(v1Type),
    unit: body.unit ?? '',
    color: String(body.color ?? '#737373'),
    icon: String(body.icon ?? 'Circle'),
    order: count,
    archived: false,
  }
  if (body.target != null && body.target !== '') data.target = Number(body.target)
  const catPb = body.category_id != null ? pbId(body.category_id) : ''
  if (catPb) data.category = catPb
  const res = await pbCreateResult('habits', data)
  if (!('rec' in res)) return json({ detail: res.message }, res.status)
  return json(toHabitBase(res.rec))
}

async function handleHabitGet(id: string): Promise<Response> {
  const rec = await pbGetOne('habits', id)
  if (!rec) return json({ detail: 'Habit not found' }, 404)
  const [cats, entryRecs] = await Promise.all([
    pbListAll('categories'),
    pbListAll('entries', filterQuery(`habit = "${id}"`)),
  ])
  const catById = new Map<string, PbRecord>()
  for (const c of cats) catById.set(String(c.id), c)
  const today = todayIso()
  const base = toHabitWithToday(rec, entryRecs, catById, today)
  Object.assign(base, buildStats(rec, normsOf(entryRecs), 30, today))
  return json(base)
}

async function handleHabitUpdate(id: string, init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const patch: Record<string, unknown> = {}
  if (body.name !== undefined) patch.name = body.name
  if (body.description !== undefined) patch.description = body.description ?? ''
  if (body.type !== undefined) {
    patch.type = toPbType(body.type)
    patch.kind = toKind(body.type)
  }
  if (body.target !== undefined) patch.target = body.target == null || body.target === '' ? 0 : Number(body.target)
  if (body.unit !== undefined) patch.unit = body.unit ?? ''
  if (body.color !== undefined) patch.color = body.color
  if (body.icon !== undefined) patch.icon = body.icon
  if (body.category_id !== undefined) patch.category = body.category_id == null ? '' : pbId(body.category_id)
  if (body.archived !== undefined) patch.archived = Boolean(body.archived)
  if (body.order !== undefined) patch.order = Number(body.order)
  const res = await pbPatchResult('habits', id, patch)
  if (!('rec' in res)) return json({ detail: res.status === 404 ? 'Habit not found' : res.message }, res.status)
  return json(toHabitBase(res.rec))
}

async function handleHabitDelete(id: string, synth: string): Promise<Response> {
  const res = await pbDeleteResult('habits', id) // entries cascade-delete in PB
  if (!('ok' in res)) return json({ detail: res.status === 404 ? 'Habit not found' : res.message }, res.status)
  return json({ status: 'deleted', id: synth })
}

async function handleHabitsReorder(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const ids = Array.isArray(body.habitIds) ? (body.habitIds as unknown[]) : []
  let index = 0
  for (const raw of ids) {
    const pid = pbId(raw)
    if (pid) {
      // A refused PATCH stops the reorder and says why; the controller re-reads the list.
      const res = await pbPatchResult('habits', pid, { order: index })
      if (!('rec' in res)) return json({ detail: res.status === 404 ? 'Habit not found' : res.message }, res.status)
    }
    index += 1
  }
  return json({ status: 'reordered', count: ids.length })
}

// ---------------------------------------------------------------------------
// Handlers — Entries
// ---------------------------------------------------------------------------

async function handleEntriesList(id: string): Promise<Response> {
  const rec = await pbGetOne('habits', id)
  if (!rec) return json({ detail: 'Habit not found' }, 404)
  const rows = await pbListAll('entries', filterQuery(`habit = "${id}"`))
  const sorted = rows.slice().sort((a, b) => String(a.day ?? '').localeCompare(String(b.day ?? '')))
  return json(sorted.map((e) => toEntry(e, rec)))
}

async function handleEntryUpsert(id: string, init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const day = String(body.date ?? '').trim()
  if (!day) return json({ detail: 'date required' }, 400)
  const rec = await pbGetOne('habits', id)
  if (!rec) return json({ detail: 'Habit not found' }, 404)
  const existing = await pbList('entries', filterQuery(`habit = "${id}" && day = "${day}"`))
  if (existing.length === 0) {
    const res = await pbCreateResult('entries', {
      habit: id,
      day,
      value: body.value != null ? Number(body.value) : 0,
      note: body.note != null ? String(body.note) : '',
    })
    if (!('rec' in res)) return json({ detail: res.message }, res.status)
    return json(toEntry(res.rec, rec))
  }
  const patch: Record<string, unknown> = {}
  if (body.value != null) patch.value = Number(body.value)
  if (body.note != null) patch.note = String(body.note)
  const res = await pbPatchResult('entries', String(existing[0]!.id), patch)
  if (!('rec' in res)) return json({ detail: res.status === 404 ? 'Entry not found' : res.message }, res.status)
  return json(toEntry(res.rec, rec))
}

async function handleEntryDelete(id: string, query: URLSearchParams): Promise<Response> {
  const day = (query.get('date') ?? '').trim() || todayIso()
  const existing = await pbList('entries', filterQuery(`habit = "${id}" && day = "${day}"`))
  if (existing.length === 0) return json({ status: 'not_found', date: day })
  const res = await pbDeleteResult('entries', String(existing[0]!.id))
  // Already gone (a 404) is the same answer as no entry; any other refusal says why.
  if (!('ok' in res)) {
    if (res.status === 404) return json({ status: 'not_found', date: day })
    return json({ detail: res.message }, res.status)
  }
  return json({ status: 'deleted', date: day })
}

// ---------------------------------------------------------------------------
// Handlers — Stats / heatmap / dashboard
// ---------------------------------------------------------------------------

async function handleHabitStats(id: string, query: URLSearchParams): Promise<Response> {
  const rec = await pbGetOne('habits', id)
  if (!rec) return json({ detail: 'Habit not found' }, 404)
  const window = clamp(Number(query.get('window') ?? 30) || 30, 1, 365)
  const rows = await pbListAll('entries', filterQuery(`habit = "${id}"`))
  return json(buildStats(rec, normsOf(rows), window, todayIso()))
}

async function handleHabitHeatmap(id: string, query: URLSearchParams): Promise<Response> {
  const rec = await pbGetOne('habits', id)
  if (!rec) return json({ detail: 'Habit not found' }, 404)
  const days = clamp(Number(query.get('days') ?? 365) || 365, 7, 730)
  const rows = await pbListAll('entries', filterQuery(`habit = "${id}"`))
  const byDay = new Map<string, PbRecord>()
  for (const r of rows) byDay.set(String(r.day ?? ''), r)
  const today = todayIso()
  const t0 = ord(today)
  const cells: Record<string, unknown>[] = []
  for (let n = days - 1; n >= 0; n -= 1) {
    const day = isoFromOrd(t0 - n)
    const e = byDay.get(day)
    const value = e ? Number(e.value ?? 0) : 0
    cells.push({
      date: day,
      value,
      completed: isCompleted(rec, value),
      intensity: intensity(rec, value),
      note: e && e.note ? String(e.note) : null,
    })
  }
  return json({ habitId: synthId(rec.id), color: String(rec.color ?? '#737373'), days, cells })
}

async function handleDashboard(): Promise<Response> {
  const [habits, entries] = await Promise.all([pbListAll('habits'), pbListAll('entries')])
  const active = habits.filter((h) => h.archived !== true)
  if (active.length === 0) {
    return json({ todayCompleted: 0, todayTotal: 0, weeklyRate: 0, activeStreaks: 0 })
  }
  const entriesByHabit = new Map<string, PbRecord[]>()
  for (const e of entries) {
    const h = relId(e.habit)
    if (!h) continue
    const arr = entriesByHabit.get(h)
    if (arr) arr.push(e)
    else entriesByHabit.set(h, [e])
  }
  const today = todayIso()
  const t0 = ord(today)
  let todayCompleted = 0
  let weekCompleted = 0
  let activeStreaks = 0
  const weekSlots = 7 * active.length
  for (const h of active) {
    const recs = entriesByHabit.get(String(h.id)) ?? []
    const byDay = new Map<string, number>()
    for (const r of recs) byDay.set(String(r.day ?? ''), Number(r.value ?? 0))
    if (byDay.has(today) && isCompleted(h, byDay.get(today) as number)) todayCompleted += 1
    for (let n = 0; n < 7; n += 1) {
      const day = isoFromOrd(t0 - n)
      if (byDay.has(day) && isCompleted(h, byDay.get(day) as number)) weekCompleted += 1
    }
    if (currentStreak(h, normsOf(recs), today) >= 7) activeStreaks += 1
  }
  return json({
    todayCompleted,
    todayTotal: active.length,
    weeklyRate: weekSlots ? round4(weekCompleted / weekSlots) : 0,
    activeStreaks,
  })
}

// Defensive: not called by the V1 UI, but wired to the V2 clear-entries op.
async function handleClearEntries(id: string): Promise<Response> {
  try {
    const res = await originalFetch('/api/ops/habits/clear-entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ habit_id: id }),
    })
    if (res.ok) return json(await res.json())
  } catch { /* fall through to manual delete */ }
  const rows = await pbListAll('entries', filterQuery(`habit = "${id}"`))
  let cleared = 0
  for (const r of rows) {
    const res = await pbDeleteResult('entries', String(r.id))
    // An entry already gone (404) is cleared; any other refusal stops and says how far it got.
    if (!('ok' in res) && res.status !== 404) {
      return json({ detail: `${res.message} (${cleared} of ${rows.length} entries cleared)`, cleared }, res.status)
    }
    cleared += 1
  }
  return json({ cleared })
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function route(url: URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase()
  const path = url.pathname
  const query = url.searchParams

  // Health: whether PocketBase, the real backend, answers (the app shows
  // "Backend unavailable" when it does not).
  if (path === '/health') {
    try {
      const res = await originalFetch('/api/health')
      if (res.ok) return json({ status: 'ok' })
    } catch { /* unreachable */ }
    return json({ status: 'unavailable' }, 503)
  }

  // Generic app state / actions (agent instrumentation — kept benign)
  if (path === '/api/state') {
    if (method === 'GET') return json(appState)
    if (method === 'DELETE') { appState = {}; return json({ status: 'cleared' }) }
    const body = readBody(init)
    const data = (body.data as Record<string, unknown>) ?? {}
    appState = { ...appState, ...data }
    return json({ ok: true })
  }
  if (path === '/api/state/replace') {
    const body = readBody(init)
    appState = ((body.data as Record<string, unknown>) ?? {})
    return json({ ok: true })
  }
  if (path === '/api/action') return json({ ok: true })

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

  // Categories
  if (path === '/api/categories') {
    if (method === 'GET') return handleCategoriesList()
    if (method === 'POST') return handleCategoryCreate(init)
  }

  let m: RegExpMatchArray | null

  if ((m = path.match(/^\/api\/categories\/([^/]+)$/))) {
    const synth = decodeURIComponent(m[1] as string)
    const id = pbId(synth)
    if (method === 'PUT') return handleCategoryUpdate(id, init)
    if (method === 'DELETE') return handleCategoryDelete(id, synth)
  }

  // Habits — collection routes first
  if (path === '/api/habits') {
    if (method === 'GET') return handleHabitsList(query)
    if (method === 'POST') return handleHabitCreate(init)
  }
  if (path === '/api/habits/reorder' && method === 'POST') return handleHabitsReorder(init)

  // Habits — item + nested routes (specific suffixes before the bare id route)
  if ((m = path.match(/^\/api\/habits\/([^/]+)\/entries$/)) && method === 'GET') {
    return handleEntriesList(pbId(decodeURIComponent(m[1] as string)))
  }
  if ((m = path.match(/^\/api\/habits\/([^/]+)\/entry$/))) {
    const id = pbId(decodeURIComponent(m[1] as string))
    if (method === 'PUT') return handleEntryUpsert(id, init)
    if (method === 'DELETE') return handleEntryDelete(id, query)
  }
  if ((m = path.match(/^\/api\/habits\/([^/]+)\/stats$/)) && method === 'GET') {
    return handleHabitStats(pbId(decodeURIComponent(m[1] as string)), query)
  }
  if ((m = path.match(/^\/api\/habits\/([^/]+)\/heatmap$/)) && method === 'GET') {
    return handleHabitHeatmap(pbId(decodeURIComponent(m[1] as string)), query)
  }
  if ((m = path.match(/^\/api\/habits\/([^/]+)\/clear-entries$/)) && method === 'POST') {
    return handleClearEntries(pbId(decodeURIComponent(m[1] as string)))
  }
  if ((m = path.match(/^\/api\/habits\/([^/]+)$/))) {
    const synth = decodeURIComponent(m[1] as string)
    const id = pbId(synth)
    if (method === 'GET') return handleHabitGet(id)
    if (method === 'PUT') return handleHabitUpdate(id, init)
    if (method === 'DELETE') return handleHabitDelete(id, synth)
  }

  // Dashboard
  if (path === '/api/dashboard' && method === 'GET') return handleDashboard()

  // Safety net: never throw. Arrays for list-ish paths, object otherwise.
  if (method === 'GET') {
    if (/\/(habits|categories|entries)$/.test(path)) return json([])
    return json({})
  }
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
        // A failed PocketBase read: answer its status (503 when the backend
        // does not answer) so the caller's error path (alert, toast) runs,
        // never an empty success.
        console.error('[apiAdapter] handler error:', err)
        const status = err instanceof PbError ? err.status : 502
        return json({ detail: err instanceof Error ? err.message : 'request failed' }, status)
      }
    }
    return originalFetch(input as RequestInfo, init)
  }
}
