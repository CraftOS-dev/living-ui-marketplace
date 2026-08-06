/**
 * apiAdapter.ts — client-side fetch shim that lets the UNCHANGED V1
 * (Python/FastAPI) Image Utility frontend run against the V2 PocketBase backend.
 *
 * HOW IT WORKS
 * ------------
 * On import this module sets `window.__CRAFTBOT_BACKEND_URL__` to a sentinel
 * host (`http://living-ui.local`). Every V1 module reads that global at its own
 * eval time and builds request URLs like `${BACKEND_URL}/api/...`, so all their
 * traffic (including the preview `<img>` and download URLs handed to the two
 * patched components) is aimed at the sentinel host.
 *
 * `installApiAdapter()` monkeypatches `window.fetch`:
 *   - Requests to the sentinel host are routed to a local handler returning a
 *     synthetic Response shaped EXACTLY like the V1 FastAPI backend.
 *   - Every other request (real same-origin `/api/collections/*`,
 *     `/api/files/*`) is passed straight through to the captured original fetch.
 *   - Handlers call the captured original fetch with RELATIVE urls.
 *
 * PocketBase has NO server-side compute, so ALL image work happens in the
 * BROWSER via <canvas> (V1 used Pillow): decode + dimensions on upload,
 * crop/resize/format-convert/compress on transform. The backend only STORES the
 * uploaded source image (`images.source` file field) plus metadata and the
 * most-recent output metadata (`last_output`). Edited outputs are regenerated
 * client-side on download from source + the stored transform spec.
 *
 * Record ids are STRINGS in PocketBase (V1 used ints). The V1 frontend uses ids
 * only opaquely (URL interpolation, React keys, `===` equality), never
 * arithmetically, so strings pass through safely as `id`.
 */

const SENTINEL = 'http://living-ui.local'

// Set the sentinel at import time so component/controller modules pick it up.
;(window as unknown as { __CRAFTBOT_BACKEND_URL__?: string }).__CRAFTBOT_BACKEND_URL__ = SENTINEL

const CREATED_AT = '2024-01-01T00:00:00Z'

const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff', '.tif'])
const FORMAT_EXT: Record<string, string> = { PNG: '.png', JPEG: '.jpg', WEBP: '.webp' }
const FORMAT_MIME: Record<string, string> = { PNG: 'image/png', JPEG: 'image/jpeg', WEBP: 'image/webp' }

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PbRecord = Record<string, unknown>
type Dict = Record<string, unknown>

interface CropSpec {
  x: number
  y: number
  width: number
  height: number
}
interface ResizeSpec {
  width?: number | undefined
  height?: number | undefined
  maintain_aspect: boolean
}
interface TransformSpec {
  crop?: CropSpec | undefined
  resize?: ResizeSpec | undefined
  format: string
  quality: number
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

function extOf(filename: string): string {
  const i = filename.lastIndexOf('.')
  return i >= 0 ? filename.slice(i).toLowerCase() : ''
}

function stemOf(filename: string): string {
  const i = filename.lastIndexOf('.')
  return i >= 0 ? filename.slice(0, i) : filename
}

function normalizeFormat(fmt: string): string {
  const f = (fmt || 'PNG').toUpperCase()
  if (f === 'JPG' || f === 'JPEG') return 'JPEG'
  if (f === 'PNG' || f === 'WEBP') return f
  return 'PNG'
}

// Best-effort source format (like Pillow's img.format, then _normalize_format):
// jpeg/png/webp map through; everything else (gif/bmp/tiff/…) → PNG.
function detectFormat(file: File): string {
  const mime = (file.type || '').toLowerCase()
  if (mime === 'image/jpeg') return 'JPEG'
  if (mime === 'image/png') return 'PNG'
  if (mime === 'image/webp') return 'WEBP'
  if (mime) return 'PNG'
  const e = extOf(file.name)
  if (e === '.jpg' || e === '.jpeg') return 'JPEG'
  if (e === '.webp') return 'WEBP'
  return 'PNG'
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
  } catch {
    return []
  }
}

async function pbGet(collection: string, id: string): Promise<PbRecord | null> {
  try {
    const res = await originalFetch(`/api/collections/${collection}/records/${enc(id)}`)
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
// Source-byte cache + last-output blob cache
// ---------------------------------------------------------------------------

const sourceBytesCache = new Map<string, Uint8Array>()
const outputBlobCache = new Map<string, { blob: Blob; filename: string; format: string }>()

async function getSourceBytes(recordId: string): Promise<Uint8Array | null> {
  const cached = sourceBytesCache.get(recordId)
  if (cached) return cached
  const rec = await pbGet('images', recordId)
  if (!rec) return null
  const source = String(rec.source ?? '')
  if (!source) return null
  try {
    const res = await originalFetch(`/api/files/images/${enc(recordId)}/${enc(source)}`)
    if (!res.ok) return null
    const bytes = new Uint8Array(await res.arrayBuffer())
    sourceBytesCache.set(recordId, bytes)
    return bytes
  } catch {
    return null
  }
}

async function decodeBitmap(bytes: Uint8Array): Promise<ImageBitmap> {
  return createImageBitmap(new Blob([bytes as BlobPart]))
}

// ---------------------------------------------------------------------------
// Shape mapper (produce EXACT V1 ImageAsset.to_dict())
// ---------------------------------------------------------------------------

function toAsset(rec: PbRecord): Dict {
  return {
    id: String(rec.id),
    filename: String(rec.filename ?? ''),
    file_size: Number(rec.file_size ?? 0),
    format: String(rec.format ?? 'PNG'),
    width: Number(rec.width ?? 0),
    height: Number(rec.height ?? 0),
    last_output: rec.last_output ?? null,
    uploaded_at: toIso(rec.uploaded) ?? CREATED_AT,
  }
}

// ---------------------------------------------------------------------------
// Canvas transform pipeline — reproduces routes.py _apply_crop/_apply_resize/
// _save_image, all in the browser.
// ---------------------------------------------------------------------------

function computeResize(resize: ResizeSpec | undefined, srcW: number, srcH: number): { w: number; h: number } {
  let targetW = resize?.width && resize.width > 0 ? resize.width : undefined
  let targetH = resize?.height && resize.height > 0 ? resize.height : undefined
  if (!resize || (!targetW && !targetH)) return { w: srcW, h: srcH }

  if (resize.maintain_aspect) {
    if (targetW && !targetH) {
      targetH = Math.max(1, Math.round((srcH * targetW) / srcW))
    } else if (targetH && !targetW) {
      targetW = Math.max(1, Math.round((srcW * targetH) / srcH))
    } else if (targetW && targetH) {
      const ratio = Math.min(targetW / srcW, targetH / srcH)
      targetW = Math.max(1, Math.round(srcW * ratio))
      targetH = Math.max(1, Math.round(srcH * ratio))
    }
  } else {
    targetW = targetW || srcW
    targetH = targetH || srcH
  }
  return { w: targetW ?? srcW, h: targetH ?? srcH }
}

// Render source → output blob for a transform spec. Returns the Response error
// (400) when the crop is out of bounds, matching V1.
async function renderTransform(
  bytes: Uint8Array,
  spec: TransformSpec,
): Promise<{ blob: Blob; width: number; height: number; format: string } | Response> {
  const bitmap = await decodeBitmap(bytes)
  const natW = bitmap.width
  const natH = bitmap.height

  let sx = 0
  let sy = 0
  let sW = natW
  let sH = natH
  if (spec.crop) {
    const c = spec.crop
    if (c.x + c.width > natW || c.y + c.height > natH) {
      bitmap.close()
      return json({ detail: 'Crop region exceeds image bounds' }, 400)
    }
    sx = c.x
    sy = c.y
    sW = c.width
    sH = c.height
  }

  const { w: outW, h: outH } = computeResize(spec.resize, sW, sH)

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, outW)
  canvas.height = Math.max(1, outH)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    return json({ detail: 'Failed to process image' }, 500)
  }
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, sx, sy, sW, sH, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  const outFmt = normalizeFormat(spec.format)
  const mime = FORMAT_MIME[outFmt] ?? 'image/png'
  const quality = outFmt === 'PNG' ? undefined : Math.min(1, Math.max(0.01, spec.quality / 100))

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, quality))
  if (!blob) return json({ detail: 'Failed to encode image' }, 500)
  return { blob, width: canvas.width, height: canvas.height, format: outFmt }
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleUpload(init?: RequestInit): Promise<Response> {
  const body = init?.body
  if (!(body instanceof FormData)) {
    return json({ message: "No file provided. Send an image in the 'file' field." })
  }
  const file = body.get('file')
  if (!(file instanceof File)) {
    return json({ message: "No file provided. Send an image in the 'file' field." })
  }

  const filename = file.name || 'image.png'
  const ext = extOf(filename)
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return json({ detail: 'Unsupported image format' }, 400)
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.length === 0) return json({ detail: 'Empty file' }, 400)

  // Validate + measure by decoding (V1 used Pillow verify()).
  let width = 0
  let height = 0
  try {
    const bitmap = await decodeBitmap(bytes)
    width = bitmap.width
    height = bitmap.height
    bitmap.close()
  } catch (e) {
    return json({ detail: `Invalid image file: ${String((e as Error)?.message ?? e)}` }, 400)
  }
  const fmt = detectFormat(file)

  const form = new FormData()
  form.append('source', file, filename)
  form.append('filename', filename)
  form.append('file_size', String(bytes.length))
  form.append('format', fmt)
  form.append('width', String(width))
  form.append('height', String(height))

  let rec: PbRecord | null = null
  try {
    const res = await originalFetch('/api/collections/images/records', { method: 'POST', body: form })
    rec = res.ok ? ((await res.json()) as PbRecord) : null
  } catch {
    rec = null
  }
  if (!rec) return json({ detail: 'Upload failed' }, 500)

  sourceBytesCache.set(String(rec.id), bytes)
  return json(toAsset(rec))
}

async function handleList(): Promise<Response> {
  const rows = await pbList('images', 'sort=-uploaded&perPage=500')
  return json(rows.map(toAsset))
}

async function handleGet(id: string): Promise<Response> {
  const rec = await pbGet('images', id)
  if (!rec) return json({ detail: 'Image not found' }, 404)
  return json(toAsset(rec))
}

async function handleDelete(id: string): Promise<Response> {
  const rec = await pbGet('images', id)
  if (!rec) return json({ detail: 'Image not found' }, 404)
  await pbDelete('images', id)
  sourceBytesCache.delete(id)
  outputBlobCache.delete(id)
  return json({ status: 'deleted', id })
}

async function handlePreview(id: string): Promise<Response> {
  const rec = await pbGet('images', id)
  if (!rec) return json({ detail: 'Image not found' }, 404)
  const bytes = await getSourceBytes(id)
  if (!bytes) return json({ detail: 'Image file missing on disk' }, 404)
  const mime = FORMAT_MIME[String(rec.format ?? '')] ?? 'application/octet-stream'
  return new Response(new Blob([bytes as BlobPart], { type: mime }), {
    status: 200,
    headers: { 'Content-Type': mime },
  })
}

async function handleTransform(id: string, init?: RequestInit): Promise<Response> {
  const rec = await pbGet('images', id)
  if (!rec) return json({ detail: 'Image not found' }, 404)

  const bytes = await getSourceBytes(id)
  if (!bytes) return json({ detail: 'Source image missing on disk' }, 404)

  const raw = readBody(init)
  const spec: TransformSpec = {
    crop: raw.crop as CropSpec | undefined,
    resize: raw.resize as ResizeSpec | undefined,
    format: normalizeFormat(String(raw.format ?? 'PNG')),
    quality: Number(raw.quality ?? 85),
  }

  const rendered = await renderTransform(bytes, spec)
  if (rendered instanceof Response) return rendered

  const outFmt = rendered.format
  const stem = stemOf(String(rec.filename ?? 'image'))
  const outName = `${stem}_edited${FORMAT_EXT[outFmt] ?? '.png'}`
  const outSize = rendered.blob.size

  // original_size = the PREVIOUS output size if any, else the source size (V1).
  const prevOutput = (rec.last_output ?? null) as Dict | null
  const originalSize = prevOutput && prevOutput.size != null ? Number(prevOutput.size) : Number(rec.file_size ?? 0)
  const pctSmaller = originalSize ? Math.round((1 - outSize / originalSize) * 1000) / 10 : 0

  const outputMeta: Dict = {
    path: `outputs/${id}/${outName}`,
    filename: outName,
    size: outSize,
    format: outFmt,
    width: rendered.width,
    height: rendered.height,
  }
  // Persist the spec alongside the meta so download can regenerate after reload.
  const stored: Dict = { ...outputMeta, spec }
  await pbUpdate('images', id, { last_output: stored })
  outputBlobCache.set(id, { blob: rendered.blob, filename: outName, format: outFmt })

  return json({ image_id: id, output: outputMeta, percent_smaller: pctSmaller })
}

async function handleDownload(id: string): Promise<Response> {
  const rec = await pbGet('images', id)
  if (!rec) return json({ detail: 'Image not found' }, 404)
  const lastOutput = (rec.last_output ?? null) as Dict | null
  if (!lastOutput) {
    return json({ detail: 'No processed output available. Run transform first.' }, 404)
  }

  const format = String(lastOutput.format ?? 'PNG')
  const filename = String(lastOutput.filename ?? 'image.png')
  const mime = FORMAT_MIME[format] ?? 'application/octet-stream'

  // Prefer the freshly-rendered blob; regenerate from source + spec after reload.
  let blob = outputBlobCache.get(id)?.blob
  if (!blob) {
    const bytes = await getSourceBytes(id)
    if (!bytes) return json({ detail: 'Output file missing on disk' }, 404)
    const spec = lastOutput.spec as TransformSpec | undefined
    if (!spec) return json({ detail: 'Output file missing on disk' }, 404)
    const rendered = await renderTransform(bytes, spec)
    if (rendered instanceof Response) return rendered
    blob = rendered.blob
    outputBlobCache.set(id, { blob, filename, format })
  }

  return new Response(blob, {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
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

  // ---- Images -------------------------------------------------------------
  if (path === '/api/images/upload' && method === 'POST') return handleUpload(init)
  if (path === '/api/images' && method === 'GET') return handleList()

  let m: RegExpMatchArray | null
  if ((m = path.match(/^\/api\/images\/([^/]+)\/preview$/)) && method === 'GET') {
    return handlePreview(decodeURIComponent(m[1] as string))
  }
  if ((m = path.match(/^\/api\/images\/([^/]+)\/transform$/)) && method === 'POST') {
    return handleTransform(decodeURIComponent(m[1] as string), init)
  }
  if ((m = path.match(/^\/api\/images\/([^/]+)\/download$/)) && method === 'GET') {
    return handleDownload(decodeURIComponent(m[1] as string))
  }
  if ((m = path.match(/^\/api\/images\/([^/]+)$/))) {
    const id = decodeURIComponent(m[1] as string)
    if (method === 'GET') return handleGet(id)
    if (method === 'DELETE') return handleDelete(id)
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
