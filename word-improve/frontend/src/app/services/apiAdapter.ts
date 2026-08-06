/**
 * apiAdapter.ts — client-side fetch shim that lets the UNCHANGED V1
 * (Python/FastAPI) Word Improve frontend run against the V2 PocketBase backend.
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
 *   - Every other request (real same-origin `/api/collections/*`, `/api/ops/*`)
 *     is passed straight through to the captured original fetch.
 *   - Handlers themselves call the captured original fetch with RELATIVE urls
 *     so they reach the PocketBase server serving the page.
 *
 * WHERE THE WORK HAPPENS
 * ----------------------
 * V1 did sentence-splitting, LLM-variant alignment, git-style merge-segment
 * building, compile, and word-level diff on the Python backend. All of that is
 * ported to this file and runs CLIENT-SIDE (see text_utils / _build_segments /
 * word_diff below — faithful ports of backend/text_utils.py + routes.py). The
 * ONLY server-side dependency is the LLM call itself, which must go through the
 * CraftBot bridge; the adapter reaches it via two real PocketBase routes
 * (POST /api/ops/ai/generate, GET /api/ops/integrations/status).
 *
 * A session (input, mode, generated variants, merge segments, compiled output)
 * is ONE `sessions` record; `variants` and `segments` ride along as JSON. Record
 * ids are STRINGS in PocketBase (V1 used ints) — the frontend treats ids
 * opaquely (URL interpolation, React keys, `===`), so strings pass through
 * safely. Segment/variant ids are synthesized as `<sessionId>_s<pos>` /
 * `<sessionId>_v<idx>` (PB ids are [a-z0-9], never contain `_`).
 */

const SENTINEL = 'http://living-ui.local'

// Set the sentinel at import time so component/controller modules pick it up.
;(window as unknown as { __CRAFTBOT_BACKEND_URL__?: string }).__CRAFTBOT_BACKEND_URL__ = SENTINEL

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PbRecord = Record<string, unknown>
type Dict = Record<string, unknown>

interface StructSentence {
  text: string
  from_original: number | null
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

// ===========================================================================
// text_utils.py — faithful TS port
// ===========================================================================

const PARAGRAPH_BREAK = '\n\n'
const PARAGRAPH_SPLIT = /\n\s*\n+/
const SENTENCE_TERMINATORS = /(?<=[.!?])\s+(?=[A-Z"'(\[])/
const ABBREVIATIONS = new Set(['mr', 'mrs', 'ms', 'dr', 'st', 'etc', 'e.g', 'i.e', 'vs', 'fig'])

function splitParagraphs(text: string): string[] {
  if (!text) return []
  return text
    .trim()
    .split(PARAGRAPH_SPLIT)
    .map((p) => p.trim())
    .filter(Boolean)
}

function splitSentences(paragraph: string): string[] {
  if (!paragraph || !paragraph.trim()) return []
  const raw = paragraph.trim().split(SENTENCE_TERMINATORS)
  const sentences: string[] = []
  let buffer = ''
  for (const part of raw) {
    const candidate = buffer ? `${buffer} ${part}`.trim() : part.trim()
    if (!candidate) continue
    const words = candidate.match(/[A-Za-z.]+/g) ?? []
    const last = words.length ? (words[words.length - 1] as string) : ''
    const tail = last.replace(/\.+$/, '').toLowerCase()
    if (ABBREVIATIONS.has(tail)) {
      buffer = candidate
      continue
    }
    sentences.push(candidate)
    buffer = ''
  }
  if (buffer) sentences.push(buffer)
  return sentences.filter(Boolean)
}

function splitSentencesWithBreaks(text: string): { sentences: string[]; breaksAfter: boolean[] } {
  const paragraphs = splitParagraphs(text)
  const sentences: string[] = []
  const breaksAfter: boolean[] = []
  paragraphs.forEach((para, pIdx) => {
    const paraSents = splitSentences(para)
    const lastPara = pIdx === paragraphs.length - 1
    paraSents.forEach((s, j) => {
      sentences.push(s)
      const isLastOfPara = j === paraSents.length - 1
      breaksAfter.push(isLastOfPara && !lastPara)
    })
  })
  return { sentences, breaksAfter }
}

function joinUnits(units: string[]): string {
  const out: string[] = []
  let prevWasBreak = true
  for (const u of units) {
    if (!u) continue
    if (u === PARAGRAPH_BREAK || u === '\n') {
      out.push(u)
      prevWasBreak = true
    } else {
      if (!prevWasBreak) out.push(' ')
      out.push(u)
      prevWasBreak = false
    }
  }
  return out.join('').trim()
}

function tokenizeWords(text: string): string[] {
  return (text || '').match(/\S+|\s+/g) ?? []
}

function isSpace(tok: string): boolean {
  return tok.length > 0 && /^\s+$/.test(tok)
}

interface DiffSeg {
  op: 'equal' | 'insert' | 'delete'
  text: string
}

function wordDiff(original: string, revised: string): DiffSeg[] {
  const aTokens = tokenizeWords(original)
  const bTokens = tokenizeWords(revised)

  const aWordsIdx: number[] = []
  aTokens.forEach((t, i) => {
    if (!isSpace(t)) aWordsIdx.push(i)
  })
  const bWordsIdx: number[] = []
  bTokens.forEach((t, i) => {
    if (!isSpace(t)) bWordsIdx.push(i)
  })
  const aWords = aWordsIdx.map((i) => aTokens[i] as string)
  const bWords = bWordsIdx.map((i) => bTokens[i] as string)

  const n = aWords.length
  const m = bWords.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (aWords[i] === bWords[j]) {
        dp[i]![j] = dp[i + 1]![j + 1]! + 1
      } else {
        dp[i]![j] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
      }
    }
  }

  type Pair = { op: 'equal' | 'delete' | 'insert'; aIdx: number | null; bIdx: number | null }
  const pairs: Pair[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (aWords[i] === bWords[j]) {
      pairs.push({ op: 'equal', aIdx: aWordsIdx[i]!, bIdx: bWordsIdx[j]! })
      i++
      j++
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      pairs.push({ op: 'delete', aIdx: aWordsIdx[i]!, bIdx: null })
      i++
    } else {
      pairs.push({ op: 'insert', aIdx: null, bIdx: bWordsIdx[j]! })
      j++
    }
  }
  while (i < n) {
    pairs.push({ op: 'delete', aIdx: aWordsIdx[i]!, bIdx: null })
    i++
  }
  while (j < m) {
    pairs.push({ op: 'insert', aIdx: null, bIdx: bWordsIdx[j]! })
    j++
  }

  const segments: DiffSeg[] = []
  let aCursor = 0
  let bCursor = 0

  const flushAWhitespaceTo = (target: number): void => {
    while (aCursor < target && isSpace(aTokens[aCursor] as string)) {
      segments.push({ op: 'equal', text: aTokens[aCursor] as string })
      aCursor++
    }
  }
  const flushBWhitespaceTo = (target: number): void => {
    while (bCursor < target && isSpace(bTokens[bCursor] as string)) {
      bCursor++
    }
  }

  for (const p of pairs) {
    if (p.op === 'equal') {
      flushAWhitespaceTo(p.aIdx as number)
      flushBWhitespaceTo(p.bIdx as number)
      segments.push({ op: 'equal', text: aTokens[p.aIdx as number] as string })
      aCursor = (p.aIdx as number) + 1
      bCursor = (p.bIdx as number) + 1
    } else if (p.op === 'delete') {
      flushAWhitespaceTo(p.aIdx as number)
      segments.push({ op: 'delete', text: aTokens[p.aIdx as number] as string })
      aCursor = (p.aIdx as number) + 1
    } else {
      flushBWhitespaceTo(p.bIdx as number)
      const last = segments[segments.length - 1]
      if (!last || !/[ \n\t]$/.test(last.text)) {
        segments.push({ op: 'equal', text: ' ' })
      }
      segments.push({ op: 'insert', text: bTokens[p.bIdx as number] as string })
      bCursor = (p.bIdx as number) + 1
    }
  }

  while (aCursor < aTokens.length) {
    const tok = aTokens[aCursor] as string
    segments.push({ op: isSpace(tok) ? 'equal' : 'delete', text: tok })
    aCursor++
  }
  while (bCursor < bTokens.length) {
    const tok = bTokens[bCursor] as string
    if (isSpace(tok)) {
      const last = segments[segments.length - 1]
      if (!last || last.op !== 'equal') {
        segments.push({ op: 'equal', text: tok })
      } else {
        last.text += tok
      }
    } else {
      segments.push({ op: 'insert', text: tok })
    }
    bCursor++
  }

  const merged: DiffSeg[] = []
  for (const seg of segments) {
    const last = merged[merged.length - 1]
    if (last && last.op === seg.op) {
      last.text += seg.text
    } else {
      merged.push({ op: seg.op, text: seg.text })
    }
  }
  return merged
}

// ===========================================================================
// prompts.py — faithful TS port
// ===========================================================================

const SYSTEM_PROMPT =
  'You are an expert prose editor. You produce multiple distinct, ' +
  'high-quality whole-text rewrites of a passage in a single response. You ' +
  'ALWAYS return valid JSON with no commentary, no markdown fences, and no ' +
  'extra keys.'

function sessionGenerationPrompt(
  mode: string,
  sentences: string[],
  count: number,
  tone: string | null,
  customInstruction: string | null,
  salt: number,
): string {
  let instruction: string
  if (mode === 'improve') {
    instruction =
      'Rewrite the source text to be clearer, more polished, and more ' +
      'engaging while preserving the original meaning and voice. You ' +
      'may reorder sentences if it improves fluency.'
  } else if (mode === 'tone_shift') {
    const toneLabel = (tone || 'Formal').trim() || 'Formal'
    instruction =
      `Rewrite the source text in a ${toneLabel.toLowerCase()} tone while ` +
      `preserving the meaning. Do not invent facts.`
  } else if (mode === 'custom') {
    const ci = (customInstruction || '').trim() || 'Rewrite the source text.'
    instruction =
      'Apply the following user instruction to the source text. ' +
      'Preserve meaning unless the instruction explicitly asks ' +
      `otherwise.\n\nUSER INSTRUCTION: ${ci}`
  } else {
    instruction =
      'Produce alternative phrasings of the source text, preserving ' +
      'meaning and tone.'
  }

  const saltLine = salt
    ? `\nThis is regeneration attempt #${salt}. Produce variants noticeably ` +
      `different from any obvious rewrite the model would emit on the ` +
      `first attempt — vary sentence openings, structure, and word choice ` +
      `across the variants.\n`
    : ''

  let numbered = sentences.map((s, i) => `[${i}] ${s}`).join('\n')
  if (!numbered) numbered = '(empty input)'

  return `${instruction}${saltLine}

You will produce ${count} variants. Each variant is a complete rewrite expressed
as a list of sentences. For each variant sentence, set "from_original" to the
0-based index of the original sentence it expresses, or null when the sentence
is new content not present in the source.

Use from_original to express structural changes:
- Reorder: same indices in different positions.
- Split one original sentence into two: BOTH variant sentences carry the same
  from_original index.
- Merge two original sentences into one: pick the index of the more prominent
  source sentence; do not include the other index.
- Delete an original sentence: omit any variant sentence pointing at it.
- Add new content: from_original = null.

Return EXACTLY this JSON shape (no other keys, no markdown fences):
{
  "title": "<concise 3-6 word title summarising the source>",
  "variants": [
    {
      "sentences": [
        {"text": "<sentence>", "from_original": 0},
        {"text": "<sentence>", "from_original": null}
      ]
    }
  ]
}

The "variants" array must have length ${count}. Each entry's "sentences" array
must contain at least one sentence.

ORIGINAL SENTENCES (numbered 0 to ${Math.max(0, sentences.length - 1)}):
${numbered}
`
}

// ===========================================================================
// LLM helpers (parse + validate + stub) — from routes.py / llm_service.py
// ===========================================================================

function parseJsonResponse(text: string): unknown {
  if (!text) return null
  let cleaned = text.trim()
  if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7)
  else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3)
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3)
  cleaned = cleaned.trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    return null
  }
}

function validateStructuredVariants(rawVariants: unknown, sentenceCount: number): StructSentence[][] {
  if (!Array.isArray(rawVariants)) return []
  const out: StructSentence[][] = []
  for (const rawV of rawVariants) {
    if (rawV == null || typeof rawV !== 'object') continue
    const rawSents = (rawV as Dict).sentences
    if (!Array.isArray(rawSents)) continue
    const sents: StructSentence[] = []
    for (const rawS of rawSents) {
      if (rawS == null || typeof rawS !== 'object') continue
      const text = String((rawS as Dict).text ?? '').trim()
      if (!text) continue
      const foRaw = (rawS as Dict).from_original
      let fo: number | null
      if (typeof foRaw === 'number' && Number.isInteger(foRaw) && foRaw >= 0 && foRaw < sentenceCount) {
        fo = foRaw
      } else {
        fo = null
      }
      sents.push({ text, from_original: fo })
    }
    if (sents.length) out.push(sents)
  }
  return out
}

function stubStructuredVariants(sentences: string[], count: number, mode: string): StructSentence[][] {
  const labelByMode: Record<string, string> = {
    improve: 'stub rewrite',
    tone_shift: 'stub tone shift',
    custom: 'stub custom rewrite',
  }
  const label = labelByMode[mode] ?? 'stub variant'
  const note = '(configure CraftBot LLM provider for real output)'
  const variants: StructSentence[][] = []
  for (let i = 0; i < count; i++) {
    const sents: StructSentence[] = []
    sentences.forEach((orig, j) => {
      const text = (orig || '').trim()
      if (!text) return
      sents.push({ text: `${text} [${label} #${i + 1}] ${note}`, from_original: j })
    })
    if (!sents.length) {
      sents.push({ text: `[${label} #${i + 1}] ${note}`, from_original: null })
    }
    variants.push(sents)
  }
  return variants
}

function stubTitle(originalText: string): string {
  const base = (originalText || '').trim()
  const fallback = base.split('\n', 1)[0]!.slice(0, 32).trim() || 'Untitled'
  return `${fallback} (stub)`
}

function variantFullText(variantSents: StructSentence[]): string {
  return variantSents
    .filter((s) => s.text)
    .map((s) => s.text)
    .join(' ')
    .trim()
}

// ===========================================================================
// Segment building — faithful TS port of routes.py _build_segments
// ===========================================================================

interface Choice {
  source: string
  text: string
  note: string | null
}
interface SegmentDict {
  kind: string
  choices: Choice[]
  selection: number | null
  position: number
}

function detectReorderNote(variantSents: StructSentence[], vPos: number, originalIndex: number): string | null {
  let expected = 0
  for (let jj = 0; jj < originalIndex; jj++) {
    if (variantSents.some((s) => s.from_original === jj)) expected++
  }
  let actual = 0
  for (let k = 0; k < vPos; k++) {
    if (typeof variantSents[k]!.from_original === 'number') actual++
  }
  return expected !== actual ? 'reordered' : null
}

function buildSegments(originalText: string, variantsStruct: StructSentence[][]): SegmentDict[] {
  const { sentences, breaksAfter } = splitSentencesWithBreaks(originalText || '')
  const variantCount = variantsStruct.length

  // Pass 1: collect additions keyed by anchor.
  const additionsByAnchor = new Map<number, SegmentDict[]>()
  variantsStruct.forEach((vSents, vIdx) => {
    let lastAnchor = -1
    for (const s of vSents) {
      if (typeof s.from_original === 'number') {
        lastAnchor = s.from_original
        continue
      }
      const text = (s.text || '').trim()
      if (!text) continue
      const list = additionsByAnchor.get(lastAnchor) ?? []
      list.push({
        kind: 'addition',
        choices: [
          { source: 'original', text: '', note: 'skip' },
          { source: `variant_${vIdx}`, text, note: 'added' },
        ],
        selection: 0,
        position: 0,
      })
      additionsByAnchor.set(lastAnchor, list)
    }
  })

  // Pass 2: build aligned segments + breaks + interleaved additions.
  const segments: SegmentDict[] = []
  const emit = (seg: SegmentDict): void => {
    seg.position = segments.length
    segments.push(seg)
  }

  for (const add of additionsByAnchor.get(-1) ?? []) emit(add)

  sentences.forEach((origSentence, iIdx) => {
    const choices: Choice[] = [{ source: 'original', text: origSentence, note: null }]
    variantsStruct.forEach((vSents, vIdx) => {
      const mappedIndices: number[] = []
      vSents.forEach((s, j) => {
        if (s.from_original === iIdx) mappedIndices.push(j)
      })
      if (mappedIndices.length === 0) {
        choices.push({ source: `variant_${vIdx}`, text: '', note: 'removed' })
      } else if (mappedIndices.length === 1) {
        const vPos = mappedIndices[0]!
        const text = vSents[vPos]!.text
        const note = detectReorderNote(vSents, vPos, iIdx)
        choices.push({ source: `variant_${vIdx}`, text, note })
      } else {
        const joined = mappedIndices.map((k) => vSents[k]!.text).join(' ')
        choices.push({ source: `variant_${vIdx}`, text: joined, note: 'split' })
      }
    })

    const nonEmptyTexts = choices.filter((c) => c.text).map((c) => c.text)
    const allHaveText = choices.every((c) => c.text)
    let kind: string
    let defaultSelection: number | null
    if (allHaveText && new Set(nonEmptyTexts).size === 1) {
      kind = 'auto'
      defaultSelection = 0
    } else {
      kind = 'conflict'
      defaultSelection = null
    }

    emit({ kind, choices, selection: defaultSelection, position: 0 })

    for (const add of additionsByAnchor.get(iIdx) ?? []) emit(add)

    if (iIdx < breaksAfter.length && breaksAfter[iIdx]) {
      const brChoices: Choice[] = [{ source: 'original', text: PARAGRAPH_BREAK, note: null }]
      for (let vIdx = 0; vIdx < variantCount; vIdx++) {
        brChoices.push({ source: `variant_${vIdx}`, text: PARAGRAPH_BREAK, note: null })
      }
      emit({ kind: 'auto', choices: brChoices, selection: 0, position: 0 })
    }
  })

  return segments
}

// ===========================================================================
// PocketBase REST helpers (relative urls → PocketBase serving the page)
// ===========================================================================

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

async function pbDelete(collection: string, id: string): Promise<boolean> {
  try {
    const res = await originalFetch(`/api/collections/${collection}/records/${enc(id)}`, {
      method: 'DELETE',
    })
    return res.ok
  } catch {
    return false
  }
}

// ---- Server ops (LLM bridge) ----------------------------------------------

async function opLlmAvailable(): Promise<boolean> {
  try {
    const res = await originalFetch('/api/ops/integrations/status')
    if (!res.ok) return false
    const body = (await res.json()) as { llmAvailable?: boolean }
    return body.llmAvailable === true
  } catch {
    return false
  }
}

async function opGenerate(system: string, prompt: string): Promise<string> {
  try {
    const res = await originalFetch('/api/ops/ai/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system, prompt }),
    })
    if (!res.ok) return ''
    const body = (await res.json()) as { text?: string }
    return String(body.text ?? '')
  } catch {
    return ''
  }
}

// ===========================================================================
// Record ↔ API shape mappers (produce EXACT V1 dicts)
// ===========================================================================

function fallbackTitle(id: string, originalText: string): string {
  const text = (originalText || '').trim()
  if (!text) return `Untitled session #${id}`
  const first = text.split('\n', 1)[0]!.trim()
  return first.length > 48 ? `${first.slice(0, 48)}…` : first
}

function toSummary(rec: PbRecord): Dict {
  const id = String(rec.id)
  const title = String(rec.title ?? '')
  return {
    id,
    title: title || fallbackTitle(id, String(rec.original_text ?? '')),
    mode: String(rec.mode ?? '') || 'improve',
    tone: rec.tone ? String(rec.tone) : null,
    variantCount: Number(rec.variant_count ?? 0) || 3,
    status: String(rec.status ?? '') || 'draft',
    createdAt: toIso(rec.created),
    updatedAt: toIso(rec.updated),
  }
}

function storedVariants(rec: PbRecord): Dict[] {
  const id = String(rec.id)
  const arr = Array.isArray(rec.variants) ? (rec.variants as Dict[]) : []
  return arr.map((v, idx) => ({
    id: `${id}_v${idx}`,
    sessionId: id,
    idx: Number(v.idx ?? idx),
    text: String(v.text ?? ''),
  }))
}

function storedSegments(rec: PbRecord): Dict[] {
  const id = String(rec.id)
  const arr = Array.isArray(rec.segments) ? (rec.segments as Dict[]) : []
  return arr.map((s, pos) => ({
    id: `${id}_s${pos}`,
    sessionId: id,
    position: Number(s.position ?? pos),
    kind: String(s.kind ?? 'conflict'),
    choices: Array.isArray(s.choices) ? s.choices : [],
    selection: s.selection == null ? null : Number(s.selection),
  }))
}

function toDetail(rec: PbRecord): Dict {
  return {
    ...toSummary(rec),
    originalText: String(rec.original_text ?? ''),
    customInstruction: rec.custom_instruction ? String(rec.custom_instruction) : null,
    compiledText: rec.compiled_text ? String(rec.compiled_text) : null,
    variants: storedVariants(rec),
    segments: storedSegments(rec),
  }
}

// ===========================================================================
// Generation core (routes.py _generate_session_payload, minus the LLM cache)
// ===========================================================================

async function generatePayload(
  originalText: string,
  mode: string,
  tone: string | null,
  customInstruction: string | null,
  count: number,
  salt: number,
): Promise<{ title: string; variants: StructSentence[][] }> {
  const { sentences } = splitSentencesWithBreaks(originalText || '')

  let title = ''
  let variants: StructSentence[][] = []

  const available = await opLlmAvailable()
  if (available) {
    const prompt = sessionGenerationPrompt(mode, sentences, count, tone, customInstruction, salt)
    const raw = await opGenerate(SYSTEM_PROMPT, prompt)
    const parsed = raw ? parseJsonResponse(raw) : null
    if (parsed != null && typeof parsed === 'object') {
      title = String((parsed as Dict).title ?? '').trim()
      variants = validateStructuredVariants((parsed as Dict).variants, sentences.length)
    }
  }

  if (!title) title = stubTitle(originalText)
  if (variants.length < count) {
    const stub = stubStructuredVariants(sentences, count, mode)
    variants = variants.concat(stub).slice(0, count)
  } else {
    variants = variants.slice(0, count)
  }
  return { title, variants }
}

// Apply a fresh generation to a session record (shared by generate/regenerate).
async function applyGeneration(rec: PbRecord, salt: number): Promise<PbRecord | null> {
  const originalText = String(rec.original_text ?? '')
  const mode = String(rec.mode ?? '') || 'improve'
  const tone = rec.tone ? String(rec.tone) : null
  const customInstruction = rec.custom_instruction ? String(rec.custom_instruction) : null
  const count = Number(rec.variant_count ?? 0) || 3

  const payload = await generatePayload(originalText, mode, tone, customInstruction, count, salt)
  const variants = payload.variants.map((vSents, i) => ({ idx: i, text: variantFullText(vSents) }))
  const segments = buildSegments(originalText, payload.variants)

  const update: Dict = {
    variants,
    segments,
    status: 'variants_ready',
  }
  // Only set the auto title when the session doesn't already have one.
  if (payload.title && !String(rec.title ?? '')) {
    update.title = payload.title.slice(0, 255)
  }
  return pbUpdate('sessions', String(rec.id), update)
}

// ===========================================================================
// Route handlers
// ===========================================================================

async function handleListSessions(): Promise<Response> {
  const rows = await pbList('sessions', 'sort=-updated&perPage=500')
  return json(rows.map(toSummary))
}

async function handleCreateSession(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const rec = await pbCreate('sessions', {
    title: body.title == null ? '' : String(body.title),
    original_text: String(body.original_text ?? ''),
    mode: String(body.mode ?? '') || 'improve',
    tone: body.tone == null ? '' : String(body.tone),
    custom_instruction: body.custom_instruction == null ? '' : String(body.custom_instruction),
    variant_count: Number(body.variant_count ?? 3) || 3,
    status: 'draft',
    variants: [],
    segments: [],
  })
  if (!rec) return json({ detail: 'Failed to create session' }, 500)
  return json(toDetail(rec))
}

async function handleGetSession(id: string): Promise<Response> {
  const rec = await pbGet('sessions', id)
  if (!rec) return json({ detail: 'Session not found' }, 404)
  return json(toDetail(rec))
}

async function handleDeleteSession(id: string): Promise<Response> {
  const rec = await pbGet('sessions', id)
  if (!rec) return json({ status: 'not_found', id })
  await pbDelete('sessions', id)
  return json({ status: 'deleted', id })
}

async function handleRenameSession(id: string, init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const rec = await pbGet('sessions', id)
  if (!rec) return json({ status: 'not_found', id })
  const title = String(body.title ?? '').trim() || String(rec.title ?? '')
  const updated = await pbUpdate('sessions', id, { title })
  return json({ status: 'ok', session: toSummary(updated ?? rec) })
}

async function handleGenerate(id: string, salt: number): Promise<Response> {
  const rec = await pbGet('sessions', id)
  const llmAvailable = await opLlmAvailable()
  if (!rec) return json({ status: 'not_found', id, llmAvailable })
  if (salt > 0) {
    // regenerate clears any previous compiled output.
    await pbUpdate('sessions', id, { compiled_text: '' })
  }
  const fresh = await pbGet('sessions', id)
  const updated = await applyGeneration(fresh ?? rec, salt)
  return json({
    status: 'ok',
    llmAvailable,
    session: toDetail(updated ?? rec),
  })
}

async function handleCompile(id: string): Promise<Response> {
  const rec = await pbGet('sessions', id)
  if (!rec) return json({ status: 'not_found', id, compiled: '', diff: [] })

  const segs = storedSegments(rec).slice().sort((a, b) => Number(a.position) - Number(b.position))
  const units: string[] = []
  for (const seg of segs) {
    const choices = Array.isArray(seg.choices) ? (seg.choices as Choice[]) : []
    let sel = seg.selection == null ? null : Number(seg.selection)
    if (sel == null || sel < 0 || sel >= choices.length) sel = 0
    const text = choices.length ? String(choices[sel]?.text ?? '') : ''
    if (text) units.push(text)
  }
  const compiled = joinUnits(units)

  const updated = await pbUpdate('sessions', id, { compiled_text: compiled, status: 'compiled' })
  const diff = wordDiff(String(rec.original_text ?? ''), compiled)
  return json({
    status: 'ok',
    compiled,
    diff,
    session: toDetail(updated ?? rec),
  })
}

async function handleSelectSegment(segmentId: string, init?: RequestInit): Promise<Response> {
  const match = /^(.+)_s(\d+)$/.exec(segmentId)
  if (!match) return json({ status: 'not_found', id: segmentId })
  const sessionId = match[1]!
  const position = Number(match[2]!)

  const rec = await pbGet('sessions', sessionId)
  if (!rec) return json({ status: 'not_found', id: segmentId })
  const rawSegs = Array.isArray(rec.segments) ? (rec.segments as Dict[]) : []
  if (position < 0 || position >= rawSegs.length) return json({ status: 'not_found', id: segmentId })

  const body = readBody(init)
  const rawSel = body.selection
  const seg = rawSegs[position] as Dict
  const choices = Array.isArray(seg.choices) ? seg.choices : []
  if (rawSel != null) {
    const sel = Number(rawSel)
    seg.selection = sel >= 0 && sel < choices.length ? sel : null
  } else {
    seg.selection = null
  }

  const updated = await pbUpdate('sessions', sessionId, { segments: rawSegs })
  const segOut = storedSegments(updated ?? rec)[position]
  return json({ status: 'ok', segment: segOut })
}

// ---------------------------------------------------------------------------
// In-memory app state (V1 stored it in SQLite; UI never depends on persistence)
// ---------------------------------------------------------------------------

let appState: Dict = {}

// ===========================================================================
// Router
// ===========================================================================

async function route(url: URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase()
  const path = url.pathname

  if (path === '/health') return json({ status: 'ok' })

  // LLM availability banner.
  if (path === '/api/llm-status' && method === 'GET') {
    return json({ llmAvailable: await opLlmAvailable() })
  }

  // Sessions collection.
  if (path === '/api/sessions') {
    if (method === 'GET') return handleListSessions()
    if (method === 'POST') return handleCreateSession(init)
  }

  let m: RegExpMatchArray | null
  if ((m = path.match(/^\/api\/sessions\/([^/]+)\/generate$/)) && method === 'POST') {
    return handleGenerate(decodeURIComponent(m[1] as string), 0)
  }
  if ((m = path.match(/^\/api\/sessions\/([^/]+)\/regenerate$/)) && method === 'POST') {
    return handleGenerate(decodeURIComponent(m[1] as string), (Date.now() % 997) + 1)
  }
  if ((m = path.match(/^\/api\/sessions\/([^/]+)\/compile$/)) && method === 'POST') {
    return handleCompile(decodeURIComponent(m[1] as string))
  }
  if ((m = path.match(/^\/api\/sessions\/([^/]+)\/title$/)) && method === 'PUT') {
    return handleRenameSession(decodeURIComponent(m[1] as string), init)
  }
  if ((m = path.match(/^\/api\/sessions\/([^/]+)$/))) {
    const id = decodeURIComponent(m[1] as string)
    if (method === 'GET') return handleGetSession(id)
    if (method === 'DELETE') return handleDeleteSession(id)
  }
  if ((m = path.match(/^\/api\/segments\/([^/]+)\/select$/)) && method === 'PUT') {
    return handleSelectSegment(decodeURIComponent(m[1] as string), init)
  }

  // Generic app state / actions.
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

  // Agent instrumentation no-ops.
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

// ===========================================================================
// Public API
// ===========================================================================

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
