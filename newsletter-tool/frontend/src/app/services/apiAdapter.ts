/**
 * apiAdapter.ts — client-side fetch shim that lets the UNCHANGED V1
 * (Python/FastAPI) Newsletter Tool frontend run against the V2 PocketBase
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
 *     so they reach that same PocketBase server. Collections are open
 *     (authMode "none"), so no Authorization header is ever sent.
 *
 * SHAPE SYNTHESIS NOTES (where PocketBase can't reproduce V1 exactly)
 * ------------------------------------------------------------------
 *   - Record ids are STRINGS in PocketBase (V1 used ints). The V1 frontend only
 *     uses record ids as opaque keys / URL params / `===` comparisons and never
 *     does arithmetic on them (its Number()/parseInt calls are for block
 *     heights, heading levels and hex colours), so strings pass through safely.
 *   - The V2 schema is far leaner than V1's. Rich campaign/template fields with
 *     no PocketBase column (name, preheader, from/reply, design, targetTags,
 *     targetAll, logical status, …) are stored as a JSON "sidecar" object in the
 *     collection's free-form `body` text field: `{ "__meta": true, ... }`. The
 *     email `blocks` array stays in the real `blocks` json column (both the V2
 *     renderer and the V1 editor read it directly). On read we prefer sidecar
 *     values and fall back to defaults.
 *   - V2 `campaigns.status` is only draft|sent. The logical V1 status
 *     (draft|scheduled|sending|sent|failed|cancelled) lives in the sidecar; the
 *     real column stays "draft" until the send op flips it to "sent". A
 *     scheduled campaign keeps column status "draft" + a `scheduled_at`, so the
 *     V2 minute-cron actually delivers it on time.
 *   - Subscribers store one `name` + a comma-separated `tags` text column. We
 *     join firstName+lastName on write and split on the first space on read;
 *     tags round-trip through the CSV string.
 *   - Sends map to the `campaigns.send` op (audience snapshot, deliver=false =
 *     record only). Open/click/bounce tracking has no V2 equivalent, so those
 *     analytics are reported as 0.
 *   - CSV export: the V1 UI opens `exportSubscribersUrl()` in an <a href> — a
 *     real browser navigation the fetch shim CANNOT intercept. We still route
 *     GET /api/subscribers-export (in case anything fetches it) onto the
 *     subscribers.export op, but the anchor download itself cannot work through
 *     the adapter. See the port notes.
 */

const SENTINEL = 'http://living-ui.local'

// Set the sentinel at import time so component modules pick it up on eval.
;(window as unknown as { __CRAFTBOT_BACKEND_URL__?: string }).__CRAFTBOT_BACKEND_URL__ = SENTINEL

const CREATED_AT = '2024-01-01T00:00:00Z'

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

function textResponse(body: string, contentType: string, extra?: Record<string, string>): Response {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': contentType, ...(extra ?? {}) },
  })
}

function readBody(init?: RequestInit): Dict {
  if (!init || init.body == null) return {}
  if (typeof init.body === 'string') {
    try { return JSON.parse(init.body) as Dict } catch { return {} }
  }
  return {}
}

const enc = encodeURIComponent

function str(v: unknown): string {
  return v == null ? '' : String(v)
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function coerceBool(v: unknown, fallback = false): boolean {
  if (typeof v === 'boolean') return v
  if (v == null) return fallback
  const s = String(v).toLowerCase()
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

function esc(s: unknown): string {
  return str(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
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

async function pbCreate(collection: string, data: Dict): Promise<PbRecord | null> {
  try {
    const res = await originalFetch(`/api/collections/${collection}/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return res.ok ? ((await res.json()) as PbRecord) : null
  } catch { return null }
}

async function pbPatch(collection: string, id: string, data: Dict): Promise<PbRecord | null> {
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

async function opPost(path: string, data: Dict): Promise<{ ok: boolean; body: Dict }> {
  try {
    const res = await originalFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    let body: Dict = {}
    try { body = (await res.json()) as Dict } catch { /* ignore */ }
    return { ok: res.ok, body }
  } catch { return { ok: false, body: {} } }
}

async function opGet(path: string): Promise<{ ok: boolean; body: Dict }> {
  try {
    const res = await originalFetch(path)
    let body: Dict = {}
    try { body = (await res.json()) as Dict } catch { /* ignore */ }
    return { ok: res.ok, body }
  } catch { return { ok: false, body: {} } }
}

// ---------------------------------------------------------------------------
// Sidecar helpers — rich V1 fields stashed as JSON in the PB `body` column.
// ---------------------------------------------------------------------------

function parseSidecar(body: unknown): Dict | null {
  const s = str(body).trim()
  if (!s.startsWith('{')) return null
  try {
    const obj = JSON.parse(s) as Dict
    return obj && obj.__meta === true ? obj : null
  } catch { return null }
}

function blocksOf(rec: PbRecord): Dict[] {
  const raw = rec.blocks
  if (Array.isArray(raw)) return raw.filter((b): b is Dict => !!b && typeof b === 'object')
  return []
}

// When a record has no structured blocks but carries plain text in `body`
// (e.g. the seeded template), surface that text as a single text block so the
// V1 editor is not empty.
function effectiveBlocks(rec: PbRecord, sidecar: Dict | null): Dict[] {
  const blocks = blocksOf(rec)
  if (blocks.length > 0) return blocks
  if (!sidecar) {
    const body = str(rec.body).trim()
    if (body) return [{ type: 'text', text: body }]
  }
  return []
}

function splitName(full: string): { firstName: string | null; lastName: string | null } {
  const s = full.trim()
  if (!s) return { firstName: null, lastName: null }
  const i = s.indexOf(' ')
  if (i < 0) return { firstName: s, lastName: null }
  return { firstName: s.slice(0, i), lastName: s.slice(i + 1).trim() || null }
}

function joinName(first: unknown, last: unknown): string {
  return [str(first).trim(), str(last).trim()].filter(Boolean).join(' ')
}

function tagsToArray(v: unknown): string[] {
  return str(v)
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
}

function tagsToCsv(v: unknown): string {
  if (Array.isArray(v)) return v.map((t) => str(t).trim()).filter(Boolean).join(', ')
  return str(v)
}

// ---------------------------------------------------------------------------
// Shape mappers → EXACT V1 FastAPI dicts
// ---------------------------------------------------------------------------

function toSubscriber(rec: PbRecord): Dict {
  const { firstName, lastName } = splitName(str(rec.name))
  const status = str(rec.status) || 'subscribed'
  const created = toIso(rec.created)
  return {
    id: str(rec.id),
    email: str(rec.email),
    firstName,
    lastName,
    status,
    tags: tagsToArray(rec.tags),
    bounceReason: null,
    unsubscribeToken: `unsub_${str(rec.id)}`,
    source: 'manual',
    createdAt: created,
    updatedAt: toIso(rec.updated) ?? created,
  }
}

function toTemplate(rec: PbRecord): Dict {
  const sidecar = parseSidecar(rec.body)
  const created = toIso(rec.created)
  return {
    id: str(rec.id),
    name: str(rec.name),
    subject: str(rec.subject),
    preheader: sidecar ? str(sidecar.preheader) : '',
    blocks: effectiveBlocks(rec, sidecar),
    design: (sidecar && typeof sidecar.design === 'object' && sidecar.design) ? sidecar.design : {},
    category: sidecar ? (str(sidecar.category) || 'custom') : 'custom',
    isBuiltin: false,
    icon: sidecar ? (str(sidecar.icon) || 'FiMail') : 'FiMail',
    usageCount: sidecar ? num(sidecar.usageCount) : 0,
    createdAt: created,
    updatedAt: toIso(rec.updated) ?? created,
  }
}

// Effective logical status of a campaign given its PB row + sidecar.
function campaignStatus(rec: PbRecord, sidecar: Dict | null): string {
  if (str(rec.status) === 'sent') return 'sent'
  const s = sidecar ? str(sidecar.status) : ''
  return s || 'draft'
}

function toCampaignSummary(rec: PbRecord): Dict {
  const sidecar = parseSidecar(rec.body)
  const created = toIso(rec.created)
  const recipients = num(rec.recipients_count)
  const status = campaignStatus(rec, sidecar)
  const sentCount = status === 'sent' ? recipients : 0
  return {
    id: str(rec.id),
    name: sidecar ? (str(sidecar.name) || str(rec.subject) || 'Untitled campaign') : (str(rec.subject) || 'Untitled campaign'),
    subject: sidecar && sidecar.subject !== undefined ? str(sidecar.subject) : str(rec.subject),
    preheader: sidecar ? str(sidecar.preheader) : '',
    fromName: sidecar && str(sidecar.fromName) ? str(sidecar.fromName) : null,
    fromEmail: sidecar && str(sidecar.fromEmail) ? str(sidecar.fromEmail) : null,
    replyTo: sidecar && str(sidecar.replyTo) ? str(sidecar.replyTo) : null,
    status,
    targetTags: sidecar && Array.isArray(sidecar.targetTags) ? sidecar.targetTags : [],
    targetAll: sidecar ? coerceBool(sidecar.targetAll, true) : true,
    scheduledAt: toIso(rec.scheduled_at),
    sentAt: toIso(rec.sent_at),
    totalRecipients: recipients,
    sentCount,
    failedCount: 0,
    opensUnique: 0,
    clicksUnique: 0,
    unsubscribes: 0,
    errorMessage: sidecar && str(sidecar.errorMessage) ? str(sidecar.errorMessage) : null,
    createdAt: created,
    updatedAt: toIso(rec.updated) ?? created,
  }
}

function toCampaignDetail(rec: PbRecord): Dict {
  const sidecar = parseSidecar(rec.body)
  const summary = toCampaignSummary(rec)
  summary.blocks = effectiveBlocks(rec, sidecar)
  summary.design = (sidecar && typeof sidecar.design === 'object' && sidecar.design) ? sidecar.design : {}
  return summary
}

function toRecipient(rec: PbRecord): Dict {
  return {
    id: str(rec.id),
    campaignId: str(rec.campaign),
    subscriberId: null,
    email: str(rec.email),
    name: str(rec.name) || null,
    status: str(rec.status) || 'logged',
    sentAt: toIso(rec.created),
    openedAt: null,
    clickedAt: null,
    errorMessage: str(rec.detail) || null,
  }
}

// ---------------------------------------------------------------------------
// Sidecar build helpers for campaign/template writes
// ---------------------------------------------------------------------------

function buildCampaignSidecar(prev: Dict | null, incoming: Dict): { sidecar: Dict; subjectField: string } {
  const s: Dict = { __meta: true, ...(prev ?? {}) }
  const apply = (key: string, val: unknown) => { if (val !== undefined) s[key] = val }

  if ('name' in incoming) apply('name', str(incoming.name))
  if ('subject' in incoming) apply('subject', str(incoming.subject))
  if ('preheader' in incoming) apply('preheader', str(incoming.preheader))
  if ('from_name' in incoming) apply('fromName', str(incoming.from_name))
  if ('from_email' in incoming) apply('fromEmail', str(incoming.from_email))
  if ('reply_to' in incoming) apply('replyTo', str(incoming.reply_to))
  if ('design' in incoming) apply('design', incoming.design ?? {})
  if ('target_tags' in incoming) {
    apply('targetTags', Array.isArray(incoming.target_tags)
      ? (incoming.target_tags as unknown[]).map((t) => str(t).trim()).filter(Boolean)
      : [])
  }
  if ('target_all' in incoming) apply('targetAll', coerceBool(incoming.target_all, true))
  if ('status' in incoming) apply('status', str(incoming.status))
  if ('errorMessage' in incoming) apply('errorMessage', incoming.errorMessage)

  // PB `subject` column is required (non-empty). Use the real subject, falling
  // back to the campaign name, then a placeholder.
  const subjectField = str(s.subject) || str(s.name) || '(no subject)'
  return { sidecar: s, subjectField }
}

function buildTemplateSidecar(prev: Dict | null, incoming: Dict): Dict {
  const s: Dict = { __meta: true, ...(prev ?? {}) }
  const apply = (key: string, val: unknown) => { if (val !== undefined) s[key] = val }
  if ('preheader' in incoming) apply('preheader', str(incoming.preheader))
  if ('design' in incoming) apply('design', incoming.design ?? {})
  if ('category' in incoming) apply('category', str(incoming.category) || 'custom')
  if ('icon' in incoming) apply('icon', str(incoming.icon) || 'FiMail')
  if ('usageCount' in incoming) apply('usageCount', num(incoming.usageCount))
  return s
}

// ===========================================================================
// Subscribers
// ===========================================================================

async function handleSubscribersList(url: URL): Promise<Response> {
  const status = url.searchParams.get('status') ?? ''
  const tag = (url.searchParams.get('tag') ?? '').toLowerCase()
  const search = (url.searchParams.get('search') ?? '').toLowerCase()

  const filter = status ? `filter=${enc(`status='${status}'`)}&` : ''
  let rows = await pbList('subscribers', `${filter}sort=-created&perPage=500`)

  if (search) {
    rows = rows.filter((r) => {
      const hay = `${str(r.email)} ${str(r.name)}`.toLowerCase()
      return hay.includes(search)
    })
  }
  if (tag) {
    rows = rows.filter((r) => tagsToArray(r.tags).some((t) => t.toLowerCase() === tag))
  }
  return json(rows.map(toSubscriber))
}

async function handleSubscriberCreate(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const email = str(body.email).trim().toLowerCase()
  if (!email || !email.includes('@')) return json({ detail: 'A valid email is required' }, 422)

  const existing = await pbList('subscribers', `filter=${enc(`email='${email}'`)}&perPage=1`)
  const found = existing[0]
  if (found) {
    const patch: Dict = {}
    const name = joinName(body.first_name, body.last_name)
    if (name) patch.name = name
    if (body.tags !== undefined) {
      const merged = Array.from(new Set([...tagsToArray(found.tags), ...tagsToArray(tagsToCsv(body.tags))]))
      patch.tags = merged.join(', ')
    }
    if (body.status !== undefined) patch.status = str(body.status) === 'subscribed' ? 'subscribed' : 'unsubscribed'
    const updated = Object.keys(patch).length > 0 ? await pbPatch('subscribers', str(found.id), patch) : found
    return json(toSubscriber(updated ?? found))
  }

  const created = await pbCreate('subscribers', {
    email,
    name: joinName(body.first_name, body.last_name),
    status: str(body.status || 'subscribed') === 'subscribed' ? 'subscribed' : 'unsubscribed',
    tags: tagsToCsv(body.tags),
  })
  if (!created) return json({ detail: 'failed to create subscriber' }, 500)
  return json(toSubscriber(created))
}

async function handleSubscriberGet(id: string): Promise<Response> {
  const rec = await pbGet('subscribers', id)
  if (!rec) return json({ detail: 'Subscriber not found' }, 404)
  return json(toSubscriber(rec))
}

async function handleSubscriberUpdate(id: string, init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const rec = await pbGet('subscribers', id)
  if (!rec) return json({ status: 'not_found', id })
  const patch: Dict = {}
  if (body.email !== undefined) patch.email = str(body.email).trim().toLowerCase()
  if (body.first_name !== undefined || body.last_name !== undefined) {
    const cur = splitName(str(rec.name))
    const first = body.first_name !== undefined ? body.first_name : cur.firstName
    const last = body.last_name !== undefined ? body.last_name : cur.lastName
    patch.name = joinName(first, last)
  }
  if (body.tags !== undefined) patch.tags = tagsToCsv(body.tags)
  if (body.status !== undefined) patch.status = str(body.status) === 'subscribed' ? 'subscribed' : 'unsubscribed'
  const updated = Object.keys(patch).length > 0 ? await pbPatch('subscribers', id, patch) : rec
  return json(toSubscriber(updated ?? rec))
}

async function handleSubscriberDelete(id: string): Promise<Response> {
  await pbDelete('subscribers', id)
  return json({ status: 'deleted', id })
}

async function handleSubscribersImport(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const content = str(body.csv_content).trim()
  const applyTags = tagsToArray(tagsToCsv(body.tags))
  let inserted = 0, updated = 0, skipped = 0
  const errors: string[] = []
  if (!content) return json({ inserted: 0, updated: 0, skipped: 0, errors: ['empty input'] })

  const seen = new Set<string>()
  const rows = content.split(/\r?\n/)
  // Snapshot existing subscribers once to detect insert-vs-update.
  const existingRows = await pbList('subscribers', 'perPage=500&fields=id,email,name,tags')
  const byEmail = new Map<string, PbRecord>()
  for (const r of existingRows) byEmail.set(str(r.email).toLowerCase(), r)

  for (const line of rows) {
    const cells = line.split(',')
    const firstCell = str(cells[0]).trim()
    if (!firstCell || firstCell.startsWith('#')) continue
    if (!firstCell.includes('@')) { skipped += 1; continue }
    const email = firstCell.toLowerCase()
    if (seen.has(email)) continue
    seen.add(email)
    const firstName = cells.length > 1 ? str(cells[1]).trim() : ''
    const lastName = cells.length > 2 ? str(cells[2]).trim() : ''

    const existing = byEmail.get(email)
    if (existing) {
      const patch: Dict = {}
      const name = joinName(firstName, lastName)
      if (name) patch.name = name
      if (applyTags.length > 0) {
        patch.tags = Array.from(new Set([...tagsToArray(existing.tags), ...applyTags])).join(', ')
      }
      if (Object.keys(patch).length > 0) await pbPatch('subscribers', str(existing.id), patch)
      updated += 1
    } else {
      const created = await pbCreate('subscribers', {
        email,
        name: joinName(firstName, lastName),
        status: 'subscribed',
        tags: applyTags.join(', '),
      })
      if (created) byEmail.set(email, created)
      inserted += 1
    }
  }
  return json({ inserted, updated, skipped, errors })
}

async function handleSubscribersExport(): Promise<Response> {
  // Routed for completeness; the V1 UI actually opens this as an <a href>
  // navigation which the fetch shim cannot intercept (see port notes).
  const { ok, body } = await opGet('/api/ops/subscribers/export')
  if (ok && typeof body.csv === 'string') {
    return textResponse(body.csv, 'text/csv', { 'Content-Disposition': 'attachment; filename=subscribers.csv' })
  }
  // Fallback: build CSV directly from the collection.
  const rows = await pbList('subscribers', 'sort=created&perPage=500')
  const lines = ['email,first_name,last_name,status,tags,created_at']
  for (const r of rows) {
    const { firstName, lastName } = splitName(str(r.name))
    lines.push([
      str(r.email), str(firstName ?? ''), str(lastName ?? ''),
      str(r.status), tagsToArray(r.tags).join(';'), toIso(r.created) ?? '',
    ].join(','))
  }
  return textResponse(lines.join('\n'), 'text/csv', { 'Content-Disposition': 'attachment; filename=subscribers.csv' })
}

async function handleTags(): Promise<Response> {
  const rows = await pbList('subscribers', 'perPage=500&fields=tags')
  const counts = new Map<string, number>()
  for (const r of rows) {
    for (const t of tagsToArray(r.tags)) counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  const out = Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => (b.count - a.count) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
  return json(out)
}

// ===========================================================================
// Templates
// ===========================================================================

async function handleTemplatesList(): Promise<Response> {
  const rows = await pbList('templates', 'sort=-updated&perPage=200')
  return json(rows.map(toTemplate))
}

async function handleTemplateCreate(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const sidecar = buildTemplateSidecar(null, {
    preheader: body.preheader, design: body.design, category: body.category, icon: body.icon, usageCount: 0,
  })
  const created = await pbCreate('templates', {
    name: str(body.name).trim() || 'Untitled template',
    subject: str(body.subject),
    blocks: Array.isArray(body.blocks) ? body.blocks : [],
    body: JSON.stringify(sidecar),
  })
  if (!created) return json({ detail: 'failed to create template' }, 500)
  return json(toTemplate(created))
}

async function handleTemplateGet(id: string): Promise<Response> {
  const rec = await pbGet('templates', id)
  if (!rec) return json({ detail: 'Template not found' }, 404)
  return json(toTemplate(rec))
}

async function handleTemplateUpdate(id: string, init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const rec = await pbGet('templates', id)
  if (!rec) return json({ status: 'not_found', id })
  const sidecar = buildTemplateSidecar(parseSidecar(rec.body), {
    preheader: body.preheader, design: body.design, category: body.category, icon: body.icon,
  })
  const patch: Dict = { body: JSON.stringify(sidecar) }
  if (body.name !== undefined) patch.name = str(body.name).trim() || str(rec.name)
  if (body.subject !== undefined) patch.subject = str(body.subject)
  if (body.blocks !== undefined) patch.blocks = Array.isArray(body.blocks) ? body.blocks : []
  const updated = await pbPatch('templates', id, patch)
  return json(toTemplate(updated ?? rec))
}

async function handleTemplateDelete(id: string): Promise<Response> {
  await pbDelete('templates', id)
  return json({ status: 'deleted', id })
}

// ===========================================================================
// Campaigns
// ===========================================================================

async function handleCampaignsList(url: URL): Promise<Response> {
  const rows = await pbList('campaigns', 'sort=-updated&perPage=200')
  let out = rows.map(toCampaignSummary)
  const status = url.searchParams.get('status')
  if (status) out = out.filter((c) => c.status === status)
  return json(out)
}

async function handleCampaignCreate(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  let blocks = Array.isArray(body.blocks) ? (body.blocks as Dict[]) : []
  let subject = str(body.subject)
  let preheader = str(body.preheader)
  let design = (body.design && typeof body.design === 'object') ? body.design as Dict : {}

  const templateId = body.template_id != null && str(body.template_id) !== '' ? str(body.template_id) : ''
  if (templateId) {
    const tpl = await pbGet('templates', templateId)
    if (tpl) {
      const tplSidecar = parseSidecar(tpl.body)
      if (blocks.length === 0) blocks = effectiveBlocks(tpl, tplSidecar)
      if (!subject) subject = str(tpl.subject)
      if (!preheader && tplSidecar) preheader = str(tplSidecar.preheader)
      if (Object.keys(design).length === 0 && tplSidecar && typeof tplSidecar.design === 'object' && tplSidecar.design) {
        design = tplSidecar.design as Dict
      }
      // bump usageCount
      const bumped = buildTemplateSidecar(tplSidecar, { usageCount: (tplSidecar ? num(tplSidecar.usageCount) : 0) + 1 })
      await pbPatch('templates', templateId, { body: JSON.stringify(bumped) })
    }
  }

  const { sidecar, subjectField } = buildCampaignSidecar(null, {
    name: str(body.name).trim() || 'Untitled campaign',
    subject,
    preheader,
    from_name: body.from_name,
    from_email: body.from_email,
    reply_to: body.reply_to,
    design,
    target_tags: body.target_tags,
    target_all: body.target_all === undefined ? true : body.target_all,
    status: 'draft',
  })
  const created = await pbCreate('campaigns', {
    subject: subjectField,
    body: JSON.stringify(sidecar),
    blocks,
    status: 'draft',
    recipients_count: 0,
    delivered_count: 0,
    deliver: false,
  })
  if (!created) return json({ detail: 'failed to create campaign' }, 500)
  return json(toCampaignDetail(created))
}

async function handleCampaignGet(id: string): Promise<Response> {
  const rec = await pbGet('campaigns', id)
  if (!rec) return json({ detail: 'Campaign not found' }, 404)
  return json(toCampaignDetail(rec))
}

async function handleCampaignUpdate(id: string, init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const rec = await pbGet('campaigns', id)
  if (!rec) return json({ status: 'not_found', id })
  const { sidecar, subjectField } = buildCampaignSidecar(parseSidecar(rec.body), body)
  const patch: Dict = { body: JSON.stringify(sidecar), subject: subjectField }
  if (body.blocks !== undefined) patch.blocks = Array.isArray(body.blocks) ? body.blocks : []
  // If the frontend explicitly sets a terminal status via update, mirror only
  // draft/sent to the real column; everything else stays in the sidecar.
  if (body.status !== undefined) {
    const s = str(body.status)
    if (s === 'sent' || s === 'draft') patch.status = s
  }
  const updated = await pbPatch('campaigns', id, patch)
  return json(toCampaignDetail(updated ?? rec))
}

async function handleCampaignDelete(id: string): Promise<Response> {
  await pbDelete('campaigns', id)
  return json({ status: 'deleted', id })
}

async function handleCampaignDuplicate(id: string): Promise<Response> {
  const rec = await pbGet('campaigns', id)
  if (!rec) return json({ status: 'not_found', id })
  const prev = parseSidecar(rec.body)
  const { sidecar, subjectField } = buildCampaignSidecar(null, {
    name: `${prev ? str(prev.name) : str(rec.subject)} (copy)`,
    subject: prev && prev.subject !== undefined ? str(prev.subject) : str(rec.subject),
    preheader: prev ? str(prev.preheader) : '',
    from_name: prev ? prev.fromName : '',
    from_email: prev ? prev.fromEmail : '',
    reply_to: prev ? prev.replyTo : '',
    design: prev ? prev.design : {},
    target_tags: prev && Array.isArray(prev.targetTags) ? prev.targetTags : [],
    target_all: prev ? coerceBool(prev.targetAll, true) : true,
    status: 'draft',
  })
  const created = await pbCreate('campaigns', {
    subject: subjectField,
    body: JSON.stringify(sidecar),
    blocks: blocksOf(rec),
    status: 'draft',
    recipients_count: 0,
    delivered_count: 0,
    deliver: false,
  })
  if (!created) return json({ status: 'error', id })
  return json(toCampaignDetail(created))
}

async function handleCampaignSend(id: string): Promise<Response> {
  const rec = await pbGet('campaigns', id)
  if (!rec) return json({ status: 'not_found', id })
  if (campaignStatus(rec, parseSidecar(rec.body)) === 'sending') {
    return json({ status: 'already_sending', id })
  }
  // deliver=false → record the audience snapshot only (matches the V2 design;
  // real Gmail delivery is opt-in and unavailable outside CraftBot).
  const { ok, body } = await opPost('/api/ops/campaigns/send', { campaign_id: id, deliver: false })
  // Ensure the logical sidecar status reflects "sent" too.
  const fresh = await pbGet('campaigns', id)
  if (fresh && str(fresh.status) === 'sent') {
    const sc = buildCampaignSidecar(parseSidecar(fresh.body), { status: 'sent', errorMessage: null }).sidecar
    const patched = await pbPatch('campaigns', id, { body: JSON.stringify(sc) })
    const detail = toCampaignDetail(patched ?? fresh)
    return json({ campaign: detail, result: ok ? body : { error: str(body.error) } })
  }
  const detail = toCampaignDetail(fresh ?? rec)
  return json({ campaign: detail, result: ok ? body : { error: str(body.error) || 'send failed' } })
}

async function handleCampaignSchedule(id: string, init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const rec = await pbGet('campaigns', id)
  if (!rec) return json({ status: 'not_found', id })
  const raw = str(body.scheduled_at)
  const d = new Date(raw)
  const whenIso = Number.isNaN(d.getTime()) ? new Date(Date.now() + 3600_000).toISOString() : d.toISOString()
  const sc = buildCampaignSidecar(parseSidecar(rec.body), { status: 'scheduled', errorMessage: null }).sidecar
  // Keep the PB column status "draft" so the V2 minute-cron delivers it.
  const updated = await pbPatch('campaigns', id, {
    scheduled_at: whenIso,
    status: 'draft',
    body: JSON.stringify(sc),
  })
  return json(toCampaignDetail(updated ?? rec))
}

async function handleCampaignCancel(id: string): Promise<Response> {
  const rec = await pbGet('campaigns', id)
  if (!rec) return json({ status: 'not_found', id })
  const status = campaignStatus(rec, parseSidecar(rec.body))
  if (status !== 'scheduled' && status !== 'draft') {
    return json({ status, id, note: 'Only scheduled or draft campaigns can be cancelled' })
  }
  const sc = buildCampaignSidecar(parseSidecar(rec.body), { status: 'cancelled' }).sidecar
  const updated = await pbPatch('campaigns', id, { scheduled_at: '', status: 'draft', body: JSON.stringify(sc) })
  return json(toCampaignDetail(updated ?? rec))
}

async function handleCampaignRecipients(id: string): Promise<Response> {
  const rows = await pbList('campaign_recipients', `filter=${enc(`campaign='${id}'`)}&sort=created&perPage=500`)
  return json(rows.map(toRecipient))
}

async function handleCampaignPreview(id: string): Promise<Response> {
  const rec = await pbGet('campaigns', id)
  if (!rec) return json({ status: 'not_found', id, html: '', text: '' })
  const sidecar = parseSidecar(rec.body)
  const subject = sidecar && sidecar.subject !== undefined ? str(sidecar.subject) : str(rec.subject)
  const name = sidecar ? str(sidecar.name) : ''
  const preheader = sidecar ? str(sidecar.preheader) : ''
  const design = (sidecar && typeof sidecar.design === 'object' && sidecar.design) ? sidecar.design as Dict : {}
  const blocks = effectiveBlocks(rec, sidecar)

  // Sample subscriber for placeholder substitution.
  const sample = (await pbList('subscribers', `filter=${enc(`status='subscribed'`)}&sort=created&perPage=1`))[0]
  const sampleName = sample ? splitName(str(sample.name)) : { firstName: 'Friend', lastName: '' }
  const context = {
    firstName: esc((sampleName.firstName || 'there')),
    lastName: esc(sampleName.lastName || ''),
    email: esc(sample ? str(sample.email) : 'preview@example.com'),
    unsubscribeUrl: '#preview-unsubscribe',
  }
  const identity = (await pbList('settings', 'perPage=1'))[0]
  const rendered = renderEmail({
    subject: subject || name,
    preheader,
    blocks,
    context,
    design,
    organizationName: '',
    organizationAddress: '',
  })
  return json({ status: 'ok', subject: subject || name, preheader, html: rendered.html, text: rendered.text })
}

// ===========================================================================
// AI generation → ai.draft op (with stub fallback)
// ===========================================================================

function stubEmail(prompt: string, tone: string): Dict {
  const base = (prompt || 'your latest update').trim().replace(/\.+$/, '')
  const short = (base || 'your latest update').slice(0, 60)
  return {
    subject: `${short.slice(0, 60)} — a quick note`,
    preheader: 'Configure the CraftBot LLM provider to get AI-generated copy.',
    blocks: [
      { type: 'heading', text: short.slice(0, 80), level: 1 },
      { type: 'text', text: `Hi {firstName}, here's a draft about ${short.slice(0, 120)}.` },
      { type: 'text', text: `This is a stub draft. Connect a Claude, OpenAI, or other LLM provider in CraftBot's settings to get real AI generation in a ${tone.toLowerCase()} tone.` },
      { type: 'button', label: 'Read more', url: 'https://example.com' },
      { type: 'text', text: 'Thanks for reading.\n— The team' },
    ],
  }
}

function bodyToBlocks(subject: string, bodyText: string, includeCta: boolean): Dict[] {
  const blocks: Dict[] = []
  if (subject.trim()) blocks.push({ type: 'heading', text: subject.trim(), level: 1 })
  const paras = bodyText.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  const list = paras.length > 0 ? paras : (bodyText.trim() ? [bodyText.trim()] : [])
  for (const p of list) blocks.push({ type: 'text', text: p })
  if (includeCta) blocks.push({ type: 'button', label: 'Learn more', url: 'https://example.com' })
  return blocks
}

async function handleGenerate(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const prompt = str(body.prompt).trim() || 'Send a short update to our subscribers.'
  const tone = str(body.tone) || 'friendly'
  const audience = str(body.audience).trim()
  const includeCta = body.include_cta === undefined ? true : coerceBool(body.include_cta, true)
  const topic = audience ? `${prompt}\nAudience: ${audience}` : prompt

  const { ok, body: res } = await opPost('/api/ops/ai/draft', { topic, tone })
  if (ok && typeof res.body === 'string') {
    const subject = str(res.subject) || prompt.slice(0, 70)
    const blocks = bodyToBlocks(subject, str(res.body), includeCta)
    return json({ status: 'ok', llmAvailable: true, subject: subject.slice(0, 255), preheader: '', blocks })
  }
  const stub = stubEmail(prompt, tone)
  return json({ status: 'stub', llmAvailable: false, ...stub })
}

// ===========================================================================
// Sender identity / integrations / settings
// ===========================================================================

// In-memory overlay for identity fields the V2 `settings` collection has no
// column for, so the Settings form round-trips within a session.
let identityOverlay: Dict = {}
let subscribeKey = ''

function randomKey(n = 20): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < n; i++) out += chars.charAt(Math.floor(Math.random() * chars.length))
  return out
}

async function getSettingsRecord(): Promise<PbRecord | null> {
  // `settings` declares only sender_name, sender_email and `updated`
  // (1700000000_init_newsletter.js) — it has NO `created` field, so
  // sort=created made PocketBase answer 400 on every first load. It is a
  // singleton read with perPage=1, so sort by the field that exists.
  const rows = await pbList('settings', 'perPage=1&sort=updated')
  if (rows[0]) return rows[0]
  return pbCreate('settings', { sender_name: '', sender_email: '' })
}

function toIdentity(rec: PbRecord | null): Dict {
  if (!subscribeKey) subscribeKey = randomKey(20)
  return {
    id: rec ? str(rec.id) : '1',
    fromName: str(rec?.sender_name),
    fromEmail: str(rec?.sender_email),
    replyTo: str(identityOverlay.replyTo),
    organizationName: str(identityOverlay.organizationName),
    organizationAddress: str(identityOverlay.organizationAddress),
    trackingBaseUrl: str(identityOverlay.trackingBaseUrl),
    subscribeKey,
    updatedAt: rec ? (toIso(rec.updated) ?? null) : null,
  }
}

async function handleSenderIdentityGet(): Promise<Response> {
  return json(toIdentity(await getSettingsRecord()))
}

async function handleSenderIdentityUpdate(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const rec = await getSettingsRecord()
  const patch: Dict = {}
  if (body.from_name !== undefined) patch.sender_name = str(body.from_name).trim()
  if (body.from_email !== undefined) patch.sender_email = str(body.from_email).trim()
  // Non-persisted fields kept in the session overlay.
  if (body.reply_to !== undefined) identityOverlay.replyTo = str(body.reply_to).trim()
  if (body.organization_name !== undefined) identityOverlay.organizationName = str(body.organization_name).trim()
  if (body.organization_address !== undefined) identityOverlay.organizationAddress = str(body.organization_address).trim()
  if (body.tracking_base_url !== undefined) identityOverlay.trackingBaseUrl = str(body.tracking_base_url).trim().replace(/\/+$/, '')
  const updated = (rec && Object.keys(patch).length > 0) ? await pbPatch('settings', str(rec.id), patch) : rec
  return json(toIdentity(updated ?? rec))
}

async function handleRotateSubscribeKey(): Promise<Response> {
  subscribeKey = randomKey(20)
  return json(toIdentity(await getSettingsRecord()))
}

async function handleIntegrations(): Promise<Response> {
  // The browser can't see CRAFTBOT_BRIDGE_URL/TOKEN itself, but the
  // PocketBase hook runs server-side and can check them directly.
  const { ok, body } = await opGet('/api/ops/integrations/status')
  const llmConnected = ok && !!(body.llm as Dict | undefined)?.connected
  return json({ llm: { connected: llmConnected }, gmail: { bridge: false, connected: false } })
}

// ===========================================================================
// Dashboard / analytics
// ===========================================================================

async function computeOverview(campaigns: Dict[], subs: PbRecord[]): Promise<Dict> {
  const total = subs.length
  const active = subs.filter((s) => str(s.status) === 'subscribed').length
  const unsub = subs.filter((s) => str(s.status) === 'unsubscribed').length
  const bounced = 0

  const now = Date.now()
  const cutoff = now - 30 * 24 * 3600_000
  const newLast30 = subs.filter((s) => {
    const c = toIso(s.created)
    return c ? Date.parse(c) >= cutoff : false
  }).length

  const sent = campaigns.filter((c) => c.status === 'sent')
  const emailsDelivered = sent.reduce((acc, c) => acc + num(c.sentCount), 0)
  const scheduled = campaigns.filter((c) => c.status === 'scheduled').length
  const drafts = campaigns.filter((c) => c.status === 'draft').length

  const last7 = now - 6 * 24 * 3600_000
  const byDay: Record<string, number> = {}
  for (const c of sent) {
    const sentAt = str(c.sentAt)
    if (!sentAt) continue
    const ms = Date.parse(sentAt)
    if (Number.isNaN(ms) || ms < last7) continue
    const key = new Date(ms).toISOString().slice(0, 10)
    byDay[key] = (byDay[key] ?? 0) + num(c.sentCount)
  }

  return {
    subscribers: { total, active, unsubscribed: unsub, bounced, newLast30Days: newLast30 },
    campaigns: {
      totalSent: sent.length,
      scheduled,
      drafts,
      emailsDelivered,
      uniqueOpens: 0,
      uniqueClicks: 0,
      openRate: 0,
      clickRate: 0,
      sendsByDay: byDay,
    },
  }
}

async function handleAnalyticsOverview(): Promise<Response> {
  const campaigns = (await pbList('campaigns', 'perPage=200')).map(toCampaignSummary)
  const subs = await pbList('subscribers', 'perPage=500')
  return json(await computeOverview(campaigns, subs))
}

async function handleAnalyticsRecent(): Promise<Response> {
  const campaigns = (await pbList('campaigns', 'sort=-sent_at&perPage=200')).map(toCampaignSummary)
  const recent = campaigns.filter((c) => c.status === 'sent' || c.status === 'sending').slice(0, 10)
  return json(recent)
}

async function handleDashboard(): Promise<Response> {
  const rows = await pbList('campaigns', 'perPage=200')
  const campaigns = rows.map(toCampaignSummary)
  const subs = await pbList('subscribers', 'perPage=500')
  const overview = await computeOverview(campaigns, subs)
  const recent = campaigns
    .filter((c) => c.status === 'sent' || c.status === 'sending')
    .sort((a, b) => Date.parse(str(b.sentAt) || '0') - Date.parse(str(a.sentAt) || '0'))
    .slice(0, 10)
  const upcoming = campaigns
    .filter((c) => c.status === 'scheduled')
    .sort((a, b) => Date.parse(str(a.scheduledAt) || '0') - Date.parse(str(b.scheduledAt) || '0'))
    .slice(0, 5)
  return json({ overview, recentCampaigns: recent, upcomingCampaigns: upcoming })
}

// ===========================================================================
// Email renderer (port of email_renderer.render_email)
// ===========================================================================

const FONT_FAMILIES: Record<string, string> = {
  system: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
  serif: "Georgia,'Times New Roman',Times,serif",
  mono: "'JetBrains Mono','Fira Code',Consolas,monospace",
}
const TEXT_SIZE_PX: Record<string, number> = { small: 14, normal: 16, large: 18 }
const IMAGE_WIDTH_VAL: Record<string, string> = { small: '240px', medium: '400px', full: '100%' }

function safeColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const v = value.trim()
  if (v.startsWith('#') && (v.length === 4 || v.length === 7) && /^#[0-9a-fA-F]+$/.test(v)) return v
  const m = v.match(/rgb\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)/)
  if (m) {
    const r = Math.max(0, Math.min(255, parseInt(m[1] as string, 10)))
    const g = Math.max(0, Math.min(255, parseInt(m[2] as string, 10)))
    const b = Math.max(0, Math.min(255, parseInt(m[3] as string, 10)))
    const hex = (x: number) => x.toString(16).padStart(2, '0').toUpperCase()
    return `#${hex(r)}${hex(g)}${hex(b)}`
  }
  return fallback
}

function designColor(design: Dict, key: string, fallback: string): string {
  return safeColor(design[key], fallback)
}

function designFont(design: Dict): string {
  const fam = design.fontFamily
  if (typeof fam === 'string' && fam in FONT_FAMILIES) return FONT_FAMILIES[fam] as string
  return FONT_FAMILIES.system as string
}

function substitute(text: string, ctx: Record<string, string>): string {
  let out = text || ''
  for (const [k, v] of Object.entries(ctx)) out = out.split(`{${k}}`).join(v || '')
  return out
}

function alignOf(value: unknown, fallback = 'left'): string {
  const v = typeof value === 'string' ? value.toLowerCase() : ''
  return (v === 'left' || v === 'center' || v === 'right') ? v : fallback
}

function renderBlock(block: Dict, ctx: Record<string, string>, design: Dict): string {
  const bt = (str(block.type) || 'text').toLowerCase()
  if (bt === 'heading') {
    const level = Math.max(1, Math.min(num(block.level, 1), 3))
    const text = substitute(str(block.text), ctx)
    const size = level === 1 ? '28px' : level === 2 ? '22px' : '18px'
    const align = alignOf(block.align)
    const color = safeColor(block.color, designColor(design, 'headingColor', '#171717'))
    return `<h${level} style="margin:0 0 16px 0;font-size:${size};line-height:1.3;font-weight:700;color:${color};text-align:${align};">${text}</h${level}>`
  }
  if (bt === 'text') {
    const text = substitute(str(block.text), ctx)
    const sizeKey = (typeof block.size === 'string' && block.size in TEXT_SIZE_PX) ? block.size : 'normal'
    const fontPx = TEXT_SIZE_PX[sizeKey as string]
    const align = alignOf(block.align)
    const color = safeColor(block.color, designColor(design, 'textColor', '#262626'))
    const bodyText = text.replace(/\n/g, '<br>')
    if (!bodyText.trim()) return '<p style="margin:0 0 16px 0;">&nbsp;</p>'
    return `<p style="margin:0 0 16px 0;font-size:${fontPx}px;line-height:1.6;color:${color};text-align:${align};">${bodyText}</p>`
  }
  if (bt === 'image') {
    const url = str(block.url)
    if (!url || !(url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:image/'))) return ''
    const align = alignOf(block.align, 'center')
    const widthKey = (typeof block.width === 'string' && block.width in IMAGE_WIDTH_VAL) ? block.width : 'full'
    const widthCss = IMAGE_WIDTH_VAL[widthKey as string]
    return `<div style="margin:0 0 16px 0;text-align:${align};"><img src="${esc(url)}" alt="${esc(block.alt)}" style="max-width:100%;width:${widthCss};height:auto;border-radius:8px;display:inline-block;" /></div>`
  }
  if (bt === 'button') {
    const label = esc(substitute(str(block.label) || 'Click here', ctx))
    let url = str(block.url) || '#'
    if (!(url.startsWith('http://') || url.startsWith('https://') || url.startsWith('mailto:') || url.startsWith('{'))) url = '#'
    const align = alignOf(block.align, 'center')
    const bg = safeColor(block.backgroundColor, designColor(design, 'buttonBg', '#FF4F18'))
    const fg = safeColor(block.textColor, designColor(design, 'buttonTextColor', '#FFFFFF'))
    return `<div style="margin:24px 0;text-align:${align};"><a href="${esc(url)}" style="display:inline-block;background:${bg};color:${fg};padding:12px 28px;border-radius:8px;font-size:16px;font-weight:600;text-decoration:none;">${label}</a></div>`
  }
  if (bt === 'divider') {
    const color = safeColor(block.color, '#EAEAEA')
    return `<hr style="border:none;border-top:1px solid ${color};margin:24px 0;" />`
  }
  if (bt === 'spacer') {
    const height = Math.max(4, Math.min(num(block.height, 16), 128))
    return `<div style="height:${height}px;line-height:1px;">&nbsp;</div>`
  }
  if (bt === 'html') return substitute(str(block.html), ctx)
  return ''
}

function renderBlocksText(blocks: Dict[], ctx: Record<string, string>): string {
  const out: string[] = []
  const strip = (s: string) => s.replace(/(<br\s*\/?>)/gi, '\n').replace(/<[^>]+>/g, '')
  for (const block of blocks) {
    const bt = (str(block.type) || 'text').toLowerCase()
    if (bt === 'heading') { out.push(strip(substitute(str(block.text), ctx)).toUpperCase(), '') }
    else if (bt === 'text') { out.push(strip(substitute(str(block.text), ctx)), '') }
    else if (bt === 'button') { out.push(`${substitute(str(block.label) || 'Click here', ctx)}: ${str(block.url)}`, '') }
    else if (bt === 'image') { out.push(`[${str(block.alt) || 'image'}]`, '') }
    else if (bt === 'divider') { out.push('---', '') }
    else if (bt === 'html') { out.push(substitute(str(block.html).replace(/<[^>]+>/g, ''), ctx), '') }
  }
  return out.join('\n').trim()
}

function renderEmail(opts: {
  subject: string
  preheader: string
  blocks: Dict[]
  context: Record<string, string>
  design: Dict
  organizationName: string
  organizationAddress: string
}): { html: string; text: string } {
  const design = opts.design || {}
  const emailBg = designColor(design, 'emailBg', '#F5F5F5')
  const cardBg = designColor(design, 'cardBg', '#FFFFFF')
  const textColor = designColor(design, 'textColor', '#262626')
  const fontFamily = designFont(design)

  const body = (opts.blocks || []).map((b) => renderBlock(b || {}, opts.context, design)).filter(Boolean).join('')
  const orgName = opts.organizationName
  const orgAddr = opts.organizationAddress
  const orgLine = (orgName || orgAddr)
    ? `<div style="margin-bottom:6px;">${esc(orgName)}${orgName && orgAddr ? ' · ' : ''}${esc(orgAddr)}</div>`
    : ''
  const footer = `${orgLine}<div>Created by Newsletter Tool livingUI</div>`

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${esc(opts.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${emailBg};font-family:${fontFamily};color:${textColor};">
<div style="display:none;font-size:1px;color:${emailBg};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${esc(substitute(opts.preheader || '', opts.context))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${emailBg};padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:${cardBg};border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.04);">
<tr><td style="padding:32px 32px 8px 32px;">
${body || '<p style="margin:0;">(Empty email)</p>'}
</td></tr>
<tr><td style="padding:24px 32px 32px 32px;border-top:1px solid #EAEAEA;font-size:12px;color:#737373;line-height:1.5;">
${footer}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`

  let text = renderBlocksText(opts.blocks || [], opts.context)
  text += (orgName || orgAddr) ? `\n\n---\n${(orgName + ' · ' + orgAddr).replace(/^ ·|·\s*$/g, '').trim()}\n` : '\n\n---\n'
  text += 'Created by Newsletter Tool livingUI\n'
  return { html, text }
}

// ---------------------------------------------------------------------------
// In-memory app state (agent instrumentation)
// ---------------------------------------------------------------------------

let appState: Dict = {}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function route(url: URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase()
  const path = url.pathname

  // Health
  if (path === '/health') return json({ status: 'ok' })

  // Agent state / actions
  if (path === '/api/state') {
    if (method === 'GET') return json(appState)
    if (method === 'DELETE') { appState = {}; return json({ status: 'cleared' }) }
    const b = readBody(init)
    appState = { ...appState, ...((b.data as Dict) ?? {}) }
    return json(appState)
  }
  if (path === '/api/state/replace') {
    const b = readBody(init)
    appState = ((b.data as Dict) ?? {})
    return json(appState)
  }
  if (path === '/api/action') {
    const b = readBody(init)
    const action = str(b.action)
    const payload = (b.payload as Dict) ?? {}
    if (action === 'send_campaign') {
      const cid = str(payload.campaign_id || payload.id)
      if (!cid) return json({ status: 'error', error: 'campaign_id is required' })
      return handleCampaignSend(cid)
    }
    if (action === 'schedule_campaign') {
      const cid = str(payload.campaign_id || payload.id)
      const when = str(payload.scheduled_at)
      if (!cid || !when) return json({ status: 'error', error: 'campaign_id and scheduled_at are required' })
      return handleCampaignSchedule(cid, { body: JSON.stringify({ scheduled_at: when }) })
    }
    if (action === 'refresh') return json({ status: 'ok' })
    return json({ status: 'unknown_action', action })
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

  // ----- Subscribers (specific paths before /{id}) -------------------------
  if (path === '/api/subscribers' && method === 'GET') return handleSubscribersList(url)
  if (path === '/api/subscribers' && method === 'POST') return handleSubscriberCreate(init)
  if (path === '/api/subscribers/import' && method === 'POST') return handleSubscribersImport(init)
  if (path === '/api/subscribers-export' && method === 'GET') return handleSubscribersExport()
  if (path === '/api/tags' && method === 'GET') return handleTags()
  if ((m = path.match(/^\/api\/subscribers\/([^/]+)$/))) {
    const id = decodeURIComponent(m[1] as string)
    if (method === 'GET') return handleSubscriberGet(id)
    if (method === 'PUT') return handleSubscriberUpdate(id, init)
    if (method === 'DELETE') return handleSubscriberDelete(id)
  }

  // ----- Templates ----------------------------------------------------------
  if (path === '/api/templates' && method === 'GET') return handleTemplatesList()
  if (path === '/api/templates' && method === 'POST') return handleTemplateCreate(init)
  if ((m = path.match(/^\/api\/templates\/([^/]+)$/))) {
    const id = decodeURIComponent(m[1] as string)
    if (method === 'GET') return handleTemplateGet(id)
    if (method === 'PUT') return handleTemplateUpdate(id, init)
    if (method === 'DELETE') return handleTemplateDelete(id)
  }

  // ----- Campaigns (specific sub-paths before /{id}) -----------------------
  if (path === '/api/campaigns' && method === 'GET') return handleCampaignsList(url)
  if (path === '/api/campaigns' && method === 'POST') return handleCampaignCreate(init)
  if (path === '/api/campaigns/generate' && method === 'POST') return handleGenerate(init)
  if ((m = path.match(/^\/api\/campaigns\/([^/]+)\/duplicate$/)) && method === 'POST') {
    return handleCampaignDuplicate(decodeURIComponent(m[1] as string))
  }
  if ((m = path.match(/^\/api\/campaigns\/([^/]+)\/send$/)) && method === 'POST') {
    return handleCampaignSend(decodeURIComponent(m[1] as string))
  }
  if ((m = path.match(/^\/api\/campaigns\/([^/]+)\/schedule$/)) && method === 'POST') {
    return handleCampaignSchedule(decodeURIComponent(m[1] as string), init)
  }
  if ((m = path.match(/^\/api\/campaigns\/([^/]+)\/cancel$/)) && method === 'POST') {
    return handleCampaignCancel(decodeURIComponent(m[1] as string))
  }
  if ((m = path.match(/^\/api\/campaigns\/([^/]+)\/recipients$/)) && method === 'GET') {
    return handleCampaignRecipients(decodeURIComponent(m[1] as string))
  }
  if ((m = path.match(/^\/api\/campaigns\/([^/]+)\/preview$/)) && method === 'GET') {
    return handleCampaignPreview(decodeURIComponent(m[1] as string))
  }
  if ((m = path.match(/^\/api\/campaigns\/([^/]+)$/))) {
    const id = decodeURIComponent(m[1] as string)
    if (method === 'GET') return handleCampaignGet(id)
    if (method === 'PUT') return handleCampaignUpdate(id, init)
    if (method === 'DELETE') return handleCampaignDelete(id)
  }

  // ----- Sender identity / integrations ------------------------------------
  if (path === '/api/sender-identity' && method === 'GET') return handleSenderIdentityGet()
  if (path === '/api/sender-identity' && method === 'PUT') return handleSenderIdentityUpdate(init)
  if (path === '/api/sender-identity/rotate-subscribe-key' && method === 'POST') return handleRotateSubscribeKey()
  if (path === '/api/integrations' && method === 'GET') return handleIntegrations()

  // ----- Dashboard / analytics ---------------------------------------------
  if (path === '/api/dashboard' && method === 'GET') return handleDashboard()
  if (path === '/api/analytics/overview' && method === 'GET') return handleAnalyticsOverview()
  if (path === '/api/analytics/recent-campaigns' && method === 'GET') return handleAnalyticsRecent()

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
      let effInit = init
      if (!effInit && typeof input !== 'string' && !(input instanceof URL)) {
        effInit = { method: input.method }
      }
      try {
        const u = new URL(urlStr)
        return await route(u, effInit)
      } catch (err) {
        console.error('[apiAdapter] handler error:', err)
        return json({}, 200)
      }
    }
    return originalFetch(input as RequestInfo, init)
  }
}
