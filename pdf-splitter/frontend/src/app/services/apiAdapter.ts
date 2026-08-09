/**
 * apiAdapter.ts — client-side fetch shim that lets the UNCHANGED V1
 * (Python/FastAPI) PDF Splitter frontend run against the V2 PocketBase backend.
 *
 * HOW IT WORKS
 * ------------
 * On import this module sets `window.__CRAFTBOT_BACKEND_URL__` to a sentinel
 * host (`http://living-ui.local`). Every V1 module reads that global at its own
 * eval time and builds request URLs like `${BACKEND_URL}/api/...`, so all their
 * traffic (including the `<img>`/download URLs handed to the two patched
 * components) is aimed at the sentinel host.
 *
 * `installApiAdapter()` monkeypatches `window.fetch`:
 *   - Requests to the sentinel host are routed to a local handler that returns
 *     a synthetic Response shaped EXACTLY like the V1 FastAPI backend.
 *   - Every other request (real same-origin `/api/collections/*` and
 *     `/api/files/*`) is passed straight through to the captured original fetch,
 *     which hits the PocketBase server that serves the page.
 *   - Handlers themselves call the captured original fetch with RELATIVE urls
 *     so they reach that same PocketBase server.
 *
 * PocketBase has NO server-side compute, so ALL PDF work happens in the BROWSER:
 *   - page count + thumbnail rendering: pdf.js (pdfjs-dist)
 *   - page extraction (split) + download regeneration: pdf-lib
 *   - zip bundling: jszip
 * The backend only STORES the uploaded source PDF (`pdfs.source` file field) and
 * the split-job history (`split_jobs`). Split OUTPUTS are never persisted — they
 * are regenerated client-side on download from source + stored config, exactly
 * reproducing routes.py's page-group/label/sort logic.
 *
 * SHAPE SYNTHESIS NOTES (where PocketBase can't reproduce V1 exactly)
 * ------------------------------------------------------------------
 *   - Record ids are STRINGS in PocketBase (V1 used ints). The V1 frontend only
 *     uses ids opaquely — URL interpolation, React keys, `===` equality, and the
 *     truthiness guard `if (!activeDocumentId)` (a non-empty PB id is truthy). No
 *     arithmetic / Number() is done on ids, so strings pass through safely as
 *     `id` and `document_id`; we never coerce them to numbers.
 *   - `file_path` (V1 disk path) and `output_dir` (V1 split folder) do not exist
 *     in V2; we synthesize stable strings (`/api/files/...`, `splits/<id>`). The
 *     frontend never parses them.
 *   - Split output files are indexed by their filename-sorted order to match V1's
 *     `sorted(output_dir.glob("*.pdf"))`, computed on the `{label}.pdf` names.
 */

import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { PDFDocument as PDFLibDocument } from 'pdf-lib'
import JSZip from 'jszip'

// pdf.js worker (Vite-friendly: bundler rewrites the ?url import to an asset url)
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const SENTINEL = 'http://living-ui.local'

// Set the sentinel at import time so component modules pick it up on eval.
;(window as unknown as { __CRAFTBOT_BACKEND_URL__?: string }).__CRAFTBOT_BACKEND_URL__ = SENTINEL

const CREATED_AT = '2024-01-01T00:00:00Z'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PbRecord = Record<string, unknown>
type PdfjsDocument = Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>

interface PageGroup {
  label: string
  indices: number[] // 0-indexed page numbers
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

// Normalise a PocketBase date/autodate string ("YYYY-MM-DD HH:MM:SS.sssZ" or
// ISO) to an ISO-8601 string, or null when empty/invalid.
function toIso(v: unknown): string | null {
  if (v == null || v === '') return null
  try {
    const d = new Date(String(v).replace(' ', 'T'))
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  } catch { return null }
}

function asObject(v: unknown): Record<string, unknown> {
  return v != null && typeof v === 'object' ? (v as Record<string, unknown>) : {}
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
    const res = await originalFetch(`/api/collections/${collection}/records/${enc(id)}${q}`)
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

async function pbDelete(collection: string, id: string): Promise<void> {
  try {
    await originalFetch(`/api/collections/${collection}/records/${enc(id)}`, { method: 'DELETE' })
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Source-byte + parsed-document caches (avoid re-fetching / re-parsing the PDF)
// ---------------------------------------------------------------------------

// We OWN these Uint8Arrays; callers must hand a `.slice()` copy to any consumer
// (pdf.js / pdf-lib) that may detach the buffer.
const sourceBytesCache = new Map<string, Uint8Array>()
const pdfjsDocCache = new Map<string, Promise<PdfjsDocument | null>>()

function clearCaches(recordId: string): void {
  sourceBytesCache.delete(recordId)
  const doc = pdfjsDocCache.get(recordId)
  pdfjsDocCache.delete(recordId)
  if (doc) void doc.then((d) => { try { d?.destroy() } catch { /* ignore */ } }).catch(() => {})
}

async function getSourceBytes(recordId: string): Promise<Uint8Array | null> {
  const cached = sourceBytesCache.get(recordId)
  if (cached) return cached
  const rec = await pbGet('pdfs', recordId)
  if (!rec) return null
  const source = String(rec.source ?? '')
  if (!source) return null
  try {
    const res = await originalFetch(`/api/files/pdfs/${enc(recordId)}/${enc(source)}`)
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    const bytes = new Uint8Array(buf)
    sourceBytesCache.set(recordId, bytes)
    return bytes
  } catch { return null }
}

function getPdfjsDoc(recordId: string): Promise<PdfjsDocument | null> {
  const cached = pdfjsDocCache.get(recordId)
  if (cached) return cached
  const p = (async (): Promise<PdfjsDocument | null> => {
    const bytes = await getSourceBytes(recordId)
    if (!bytes) return null
    try {
      return await pdfjsLib.getDocument({ data: bytes.slice() }).promise
    } catch { return null }
  })()
  pdfjsDocCache.set(recordId, p)
  return p
}

// ---------------------------------------------------------------------------
// Shape mappers (produce EXACT V1 FastAPI dicts)
// ---------------------------------------------------------------------------

function toPDFDocument(rec: PbRecord): Record<string, unknown> {
  const id = String(rec.id)
  const source = String(rec.source ?? '')
  return {
    id,
    filename: String(rec.filename ?? ''),
    file_path: `/api/files/pdfs/${id}/${source}`,
    file_size: Number(rec.file_size ?? 0),
    page_count: Number(rec.page_count ?? 0),
    uploaded_at: toIso(rec.created) ?? CREATED_AT,
  }
}

function toSplitJob(rec: PbRecord): Record<string, unknown> {
  const id = String(rec.id)
  return {
    id,
    document_id: String(rec.document ?? ''),
    split_type: String(rec.split_type ?? ''),
    split_config: rec.split_config ?? {},
    output_dir: `splits/${id}`,
    file_count: Number(rec.file_count ?? 0),
    created_at: toIso(rec.created) ?? CREATED_AT,
  }
}

// ---------------------------------------------------------------------------
// Page-group logic — reproduces routes.py split_pdf() EXACTLY.
// ---------------------------------------------------------------------------

function buildPageGroups(splitType: string, config: Record<string, unknown>, total: number): PageGroup[] {
  const groups: PageGroup[] = []

  if (splitType === 'pages') {
    const pages = Array.isArray(config.pages) ? (config.pages as unknown[]) : []
    for (const raw of pages) {
      const p = Number(raw)
      if (Number.isInteger(p) && p >= 1 && p <= total) {
        groups.push({ label: `page_${p}`, indices: [p - 1] })
      }
    }
  } else if (splitType === 'ranges') {
    const ranges = Array.isArray(config.ranges) ? (config.ranges as unknown[]) : []
    for (const raw of ranges) {
      if (!Array.isArray(raw) || raw.length < 2) continue
      let start = Number(raw[0])
      let end = Number(raw[1])
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue
      start = Math.max(1, start)
      end = Math.min(total, end)
      if (start <= end) {
        const indices: number[] = []
        for (let i = start - 1; i < end; i++) indices.push(i)
        groups.push({ label: `pages_${start}-${end}`, indices })
      }
    }
  } else if (splitType === 'every_n') {
    let n = Number(config.n)
    if (!Number.isFinite(n) || n < 1) n = 1
    n = Math.floor(n)
    for (let i = 0; i < total; i += n) {
      const endPage = Math.min(i + n, total)
      const indices: number[] = []
      for (let j = i; j < endPage; j++) indices.push(j)
      groups.push({ label: `pages_${i + 1}-${endPage}`, indices })
    }
  }

  return groups
}

// Filename-sorted view matching V1's sorted(output_dir.glob("*.pdf")).
function sortedFiles(groups: PageGroup[]): { name: string; indices: number[] }[] {
  return groups
    .map((g) => ({ name: `${g.label}.pdf`, indices: g.indices }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

async function buildPdfBlob(srcDoc: PDFLibDocument, indices: number[]): Promise<Blob> {
  const out = await PDFLibDocument.create()
  const copied = await out.copyPages(srcDoc, indices)
  for (const p of copied) out.addPage(p)
  const outBytes = await out.save()
  return new Blob([outBytes as BlobPart], { type: 'application/pdf' })
}

// ---------------------------------------------------------------------------
// PDF handlers
// ---------------------------------------------------------------------------

async function handleUpload(init?: RequestInit): Promise<Response> {
  const body = init?.body
  if (!(body instanceof FormData)) {
    return json({ message: "No file provided. Send a PDF file in the 'file' field." })
  }
  const file = body.get('file')
  if (!(file instanceof File)) {
    return json({ message: "No file provided. Send a PDF file in the 'file' field." })
  }
  if (!file.name || !file.name.toLowerCase().endsWith('.pdf')) {
    return json({ detail: 'Only PDF files are allowed' }, 400)
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  // Validate magic bytes "%PDF"
  if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
    return json({ detail: 'Invalid PDF file' }, 400)
  }

  let pageCount = 0
  try {
    const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise
    pageCount = doc.numPages
    try { doc.destroy() } catch { /* ignore */ }
  } catch (e) {
    return json({ detail: `Failed to process PDF: ${String((e as Error)?.message ?? e)}` }, 400)
  }

  // Create the pdfs record via multipart (the source is a file field).
  const form = new FormData()
  form.append('source', file, file.name)
  form.append('filename', file.name)
  form.append('file_size', String(bytes.length))
  form.append('page_count', String(pageCount))

  let rec: PbRecord | null = null
  try {
    const res = await originalFetch('/api/collections/pdfs/records', { method: 'POST', body: form })
    rec = res.ok ? ((await res.json()) as PbRecord) : null
  } catch { rec = null }
  if (!rec) return json({ detail: 'Upload failed' }, 500)

  // Seed cache so the immediate thumbnail render doesn't re-download.
  sourceBytesCache.set(String(rec.id), bytes)
  return json(toPDFDocument(rec))
}

async function handlePdfsList(): Promise<Response> {
  const rows = await pbList('pdfs', 'sort=-created&perPage=500')
  return json(rows.map(toPDFDocument))
}

async function handlePdfGet(id: string): Promise<Response> {
  const rec = await pbGet('pdfs', id)
  if (!rec) return json({ detail: 'PDF not found' }, 404)
  return json(toPDFDocument(rec))
}

async function handlePdfDelete(id: string): Promise<Response> {
  const rec = await pbGet('pdfs', id)
  if (!rec) return json({ detail: 'PDF not found' }, 404)
  await pbDelete('pdfs', id) // split_jobs cascade on the backend
  clearCaches(id)
  return json({ status: 'deleted', id })
}

async function handleThumbnail(id: string, pageNum: number): Promise<Response> {
  const doc = await getPdfjsDoc(id)
  if (!doc) return json({ detail: 'PDF not found' }, 404)
  if (!Number.isInteger(pageNum) || pageNum < 1 || pageNum > doc.numPages) {
    return json({ detail: `Page ${pageNum} out of range (1-${doc.numPages})` }, 400)
  }
  try {
    const page = await doc.getPage(pageNum)
    const viewport = page.getViewport({ scale: 1.5 }) // matches fitz.Matrix(1.5, 1.5)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.ceil(viewport.width))
    canvas.height = Math.max(1, Math.ceil(viewport.height))
    const ctx = canvas.getContext('2d')
    if (!ctx) return json({ detail: 'Failed to generate thumbnail' }, 500)
    await page.render({ canvasContext: ctx, viewport }).promise
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) return json({ detail: 'Failed to generate thumbnail' }, 500)
    return new Response(blob, { status: 200, headers: { 'Content-Type': 'image/png' } })
  } catch (e) {
    return json({ detail: `Failed to generate thumbnail: ${String((e as Error)?.message ?? e)}` }, 500)
  }
}

async function handleThumbnailList(id: string): Promise<Response> {
  const rec = await pbGet('pdfs', id)
  if (!rec) return json({ detail: 'PDF not found' }, 404)
  const pageCount = Number(rec.page_count ?? 0)
  const thumbnails: { page: number; url: string }[] = []
  for (let i = 1; i <= pageCount; i++) {
    thumbnails.push({ page: i, url: `/api/pdfs/${id}/thumbnails/${i}` })
  }
  return json({ pdf_id: id, page_count: pageCount, thumbnails })
}

async function handleSplit(pdfId: string, init?: RequestInit): Promise<Response> {
  const rec = await pbGet('pdfs', pdfId)
  if (!rec) return json({ detail: 'PDF not found' }, 404)

  const reqBody = readBody(init)
  const splitType = String(reqBody.split_type ?? '')
  const config = asObject(reqBody.config)

  const bytes = await getSourceBytes(pdfId)
  if (!bytes) return json({ detail: 'Failed to open PDF' }, 500)
  let srcDoc: PDFLibDocument
  try {
    srcDoc = await PDFLibDocument.load(bytes.slice())
  } catch (e) {
    return json({ detail: `Failed to open PDF: ${String((e as Error)?.message ?? e)}` }, 500)
  }

  const total = srcDoc.getPageCount()
  const groups = buildPageGroups(splitType, config, total)
  if (groups.length === 0) return json({ detail: 'No valid pages to split' }, 400)

  // files[] is in page-group iteration order (as V1 builds output_files); pages
  // are 1-indexed. Output PDFs are NOT persisted — regenerated on download.
  const files = groups.map((g) => ({ filename: `${g.label}.pdf`, pages: g.indices.map((i) => i + 1) }))

  const created = await pbCreate('split_jobs', {
    document: pdfId,
    split_type: splitType,
    split_config: config,
    file_count: files.length,
  })
  if (!created) return json({ detail: 'Failed to create split job' }, 500)

  const result = toSplitJob(created)
  result.files = files
  return json(result)
}

async function handleSplitsList(): Promise<Response> {
  const rows = await pbList('split_jobs', 'sort=-created&perPage=500')
  return json(rows.map(toSplitJob))
}

async function handlePdfSplits(pdfId: string): Promise<Response> {
  const rec = await pbGet('pdfs', pdfId)
  if (!rec) return json({ detail: 'PDF not found' }, 404)
  const rows = await pbList('split_jobs', `filter=${enc(`document='${pdfId}'`)}&sort=-created&perPage=500`)
  return json(rows.map(toSplitJob))
}

// Load a split job + its source and return the filename-sorted page groups.
async function loadSplitContext(
  splitId: string,
): Promise<{ srcDoc: PDFLibDocument; sorted: { name: string; indices: number[] }[] } | Response> {
  const job = await pbGet('split_jobs', splitId)
  if (!job) return json({ detail: 'Split job not found' }, 404)
  const docId = String(job.document ?? '')
  const splitType = String(job.split_type ?? '')
  const config = asObject(job.split_config)

  const bytes = await getSourceBytes(docId)
  if (!bytes) return json({ detail: 'Split output not found' }, 404)
  let srcDoc: PDFLibDocument
  try {
    srcDoc = await PDFLibDocument.load(bytes.slice())
  } catch (e) {
    return json({ detail: `Failed to open PDF: ${String((e as Error)?.message ?? e)}` }, 500)
  }
  const groups = buildPageGroups(splitType, config, srcDoc.getPageCount())
  return { srcDoc, sorted: sortedFiles(groups) }
}

async function handleDownloadFile(splitId: string, fileIndex: number): Promise<Response> {
  const ctx = await loadSplitContext(splitId)
  if (ctx instanceof Response) return ctx
  const { srcDoc, sorted } = ctx
  if (!Number.isInteger(fileIndex) || fileIndex < 0 || fileIndex >= sorted.length) {
    return json({ detail: 'File index out of range' }, 404)
  }
  const target = sorted[fileIndex]!
  try {
    const blob = await buildPdfBlob(srcDoc, target.indices)
    return new Response(blob, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${target.name}"`,
      },
    })
  } catch (e) {
    return json({ detail: `Failed to build file: ${String((e as Error)?.message ?? e)}` }, 500)
  }
}

async function handleDownloadZip(splitId: string): Promise<Response> {
  const ctx = await loadSplitContext(splitId)
  if (ctx instanceof Response) return ctx
  const { srcDoc, sorted } = ctx
  if (sorted.length === 0) return json({ detail: 'No split files found' }, 404)
  try {
    const zip = new JSZip()
    for (const f of sorted) {
      const out = await PDFLibDocument.create()
      const copied = await out.copyPages(srcDoc, f.indices)
      for (const p of copied) out.addPage(p)
      const outBytes = await out.save()
      zip.file(f.name, outBytes)
    }
    const blob = await zip.generateAsync({ type: 'blob' })
    return new Response(blob, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="split_output.zip"',
      },
    })
  } catch (e) {
    return json({ detail: `Failed to build zip: ${String((e as Error)?.message ?? e)}` }, 500)
  }
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
    const data = asObject(body.data)
    appState = { ...appState, ...data }
    return json(appState)
  }
  if (path === '/api/state/replace') {
    const body = readBody(init)
    appState = asObject(body.data)
    return json(appState)
  }
  if (path === '/api/action') {
    const body = readBody(init)
    if (String(body.action ?? '') === 'reset') { appState = {}; return json({ status: 'reset', data: {} }) }
    return json({ status: 'unknown_action', action: body.action ?? null, data: appState })
  }

  // Agent instrumentation no-ops (must return valid 200 shapes on the load path)
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

  // ---- PDF upload / list --------------------------------------------------
  if (path === '/api/pdfs/upload' && method === 'POST') return handleUpload(init)
  if (path === '/api/pdfs' && method === 'GET') return handlePdfsList()

  // ---- Thumbnails ---------------------------------------------------------
  if ((m = path.match(/^\/api\/pdfs\/([^/]+)\/thumbnails\/([^/]+)$/)) && method === 'GET') {
    return handleThumbnail(decodeURIComponent(m[1] as string), Number(decodeURIComponent(m[2] as string)))
  }
  if ((m = path.match(/^\/api\/pdfs\/([^/]+)\/thumbnails$/)) && method === 'GET') {
    return handleThumbnailList(decodeURIComponent(m[1] as string))
  }

  // ---- Split / per-document splits ----------------------------------------
  if ((m = path.match(/^\/api\/pdfs\/([^/]+)\/split$/)) && method === 'POST') {
    return handleSplit(decodeURIComponent(m[1] as string), init)
  }
  if ((m = path.match(/^\/api\/pdfs\/([^/]+)\/splits$/)) && method === 'GET') {
    return handlePdfSplits(decodeURIComponent(m[1] as string))
  }

  // ---- PDF get / delete ---------------------------------------------------
  if ((m = path.match(/^\/api\/pdfs\/([^/]+)$/))) {
    const id = decodeURIComponent(m[1] as string)
    if (method === 'GET') return handlePdfGet(id)
    if (method === 'DELETE') return handlePdfDelete(id)
  }

  // ---- Splits list / downloads --------------------------------------------
  if (path === '/api/splits' && method === 'GET') return handleSplitsList()
  if ((m = path.match(/^\/api\/splits\/([^/]+)\/download\/([^/]+)$/)) && method === 'GET') {
    return handleDownloadFile(decodeURIComponent(m[1] as string), Number(decodeURIComponent(m[2] as string)))
  }
  if ((m = path.match(/^\/api\/splits\/([^/]+)\/download-zip$/)) && method === 'GET') {
    return handleDownloadZip(decodeURIComponent(m[1] as string))
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
