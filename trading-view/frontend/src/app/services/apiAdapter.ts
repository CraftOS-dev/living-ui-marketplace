/**
 * apiAdapter.ts — client-side fetch shim that lets the UNCHANGED V1
 * (Python/FastAPI) TradingView frontend run against the V2 PocketBase backend.
 *
 * HOW IT WORKS
 * ------------
 * On import this module sets `window.__CRAFTBOT_BACKEND_URL__` to a sentinel
 * host (`http://living-ui.local`). Every V1 component reads that global at its
 * own module-eval time and builds request URLs like `${BACKEND_URL}/api/...`,
 * so all their traffic is aimed at the sentinel host.
 *
 * `installApiAdapter()` monkeypatches `window.fetch`:
 *   - Requests to the sentinel host are routed to a local handler that returns
 *     a synthetic Response shaped EXACTLY like the V1 FastAPI backend.
 *   - Every other request (real same-origin `/api/ops/*` and
 *     `/api/collections/*`) is passed straight through to the captured original
 *     fetch, which hits the PocketBase server that serves the page.
 *   - Handlers themselves call the captured original fetch with RELATIVE urls
 *     so they reach that same PocketBase server.
 *
 * SYNTHESIS NOTES (where live-Yahoo can't reproduce V1 exactly)
 * ------------------------------------------------------------
 *   - `sector` / `marketCap`: Yahoo quote proxy exposes neither. Sector comes
 *     from a static SECTOR_MAP for the known universe; marketCap is null.
 *   - `openPrice`: the quotes op has no session open, so previousClose is used
 *     as the open proxy (StockDetails "Open" row).
 *   - `/api/stocks` & `/api/screener` operate over a fixed ~30-symbol universe
 *     (plus the user's watchlist), not the V1 ~10k NASDAQ universe.
 *   - `4h` candles are aggregated from Yahoo 60m bars (Yahoo has no 4h).
 *   - Alerts are evaluated against live quotes here (V1 evaluated them in a
 *     server tick loop).
 *
 * Quotes are cached in-memory (QUOTE_TTL) so the 3-5s UI polls and multiple
 * panels share Yahoo requests instead of hammering the proxy.
 */

const SENTINEL = 'http://living-ui.local'

// Set the sentinel at import time so component modules pick it up on eval.
;(window as unknown as { __CRAFTBOT_BACKEND_URL__?: string }).__CRAFTBOT_BACKEND_URL__ = SENTINEL

const CREATED_AT = '2024-01-01T00:00:00Z'

// ---------------------------------------------------------------------------
// Static universe + sectors (Yahoo quotes carry no sector/marketCap)
// ---------------------------------------------------------------------------

const SECTOR_MAP: Record<string, string> = {
  AAPL: 'Technology', MSFT: 'Technology', GOOGL: 'Technology', AMZN: 'Consumer',
  NVDA: 'Technology', META: 'Communications', TSLA: 'Consumer', AMD: 'Technology',
  NFLX: 'Communications', INTC: 'Technology', CRM: 'Technology', ORCL: 'Technology',
  ADBE: 'Technology', CSCO: 'Technology',
  JPM: 'Finance', V: 'Finance', MA: 'Finance', BAC: 'Finance', GS: 'Finance',
  JNJ: 'Healthcare', UNH: 'Healthcare', PFE: 'Healthcare', MRK: 'Healthcare',
  WMT: 'Consumer', KO: 'Consumer', MCD: 'Consumer', NKE: 'Consumer',
  COST: 'Consumer', DIS: 'Communications', HD: 'Consumer',
  XOM: 'Energy', CVX: 'Energy',
  T: 'Communications', VZ: 'Communications',
  SPY: 'ETF', QQQ: 'ETF', DIA: 'ETF',
}

const UNIVERSE: string[] = Object.keys(SECTOR_MAP)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Quote {
  symbol: string
  name: string
  price: number
  previousClose: number
  currency?: string
  exchange?: string
  dayHigh?: number | null
  dayLow?: number | null
  volume?: number | null
  fiftyTwoWeekHigh?: number | null
  fiftyTwoWeekLow?: number | null
  error?: string
}

interface RawCandle { t: number; o: number; h: number; l: number; c: number; v: number }

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

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
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

async function pbPatch(collection: string, id: string, data: Record<string, unknown>): Promise<void> {
  try {
    await originalFetch(`/api/collections/${collection}/records/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  } catch { /* ignore */ }
}

async function pbDelete(collection: string, id: string): Promise<void> {
  try {
    await originalFetch(`/api/collections/${collection}/records/${id}`, { method: 'DELETE' })
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Yahoo ops helpers (relative urls) + quote cache
// ---------------------------------------------------------------------------

const QUOTE_TTL = 8000 // ms; Yahoo free data is ~15-min delayed, so this is safe
const quoteCache = new Map<string, { quote: Quote | null; ts: number }>()

async function getQuotes(symbols: string[]): Promise<Map<string, Quote>> {
  const wanted = Array.from(new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean)))
  const now = Date.now()
  const stale = wanted.filter((s) => {
    const c = quoteCache.get(s)
    return !c || now - c.ts > QUOTE_TTL
  })

  for (const group of chunk(stale, 30)) {
    try {
      const res = await originalFetch(`/api/ops/quotes?symbols=${encodeURIComponent(group.join(','))}`)
      if (!res.ok) continue
      const body = (await res.json()) as { quotes?: Quote[] }
      for (const q of body.quotes ?? []) {
        if (!q || !q.symbol) continue
        quoteCache.set(q.symbol.toUpperCase(), {
          quote: q.error || q.price == null ? null : q,
          ts: now,
        })
      }
    } catch { /* ignore group */ }
  }

  const out = new Map<string, Quote>()
  for (const s of wanted) {
    const c = quoteCache.get(s)
    if (c && c.quote) out.set(s, c.quote)
  }
  return out
}

async function getQuote(symbol: string): Promise<Quote | null> {
  const m = await getQuotes([symbol])
  return m.get(symbol.toUpperCase()) ?? null
}

// ---------------------------------------------------------------------------
// Shape mappers (V1 field names)
// ---------------------------------------------------------------------------

function toStock(symbol: string, quote: Quote | null, sectorHint?: string): Record<string, unknown> {
  const sym = symbol.toUpperCase()
  return {
    id: sym,
    symbol: sym,
    name: quote?.name ?? sym,
    sector: SECTOR_MAP[sym] ?? sectorHint ?? '',
    marketCap: null,
    exchange: quote?.exchange ?? '',
    createdAt: CREATED_AT,
  }
}

function toStockPrice(symbol: string, quote: Quote): Record<string, unknown> {
  const price = quote.price
  const prev = quote.previousClose != null ? quote.previousClose : price
  const change = price - prev
  const changePct = prev ? (change / prev) * 100 : 0
  return {
    id: 0,
    stockId: symbol.toUpperCase(),
    price,
    // No session-open in the quotes op → previousClose is the open proxy.
    openPrice: prev,
    high: quote.dayHigh != null ? quote.dayHigh : price,
    low: quote.dayLow != null ? quote.dayLow : price,
    prevClose: prev,
    volume: quote.volume != null ? quote.volume : 0,
    change,
    changePct,
    updatedAt: new Date().toISOString(),
  }
}

// Map a V1 timeframe → Yahoo {range, interval, aggregate}. `wide` widens the
// range so ChartWidget's "scroll left / before" paging surfaces older bars.
function mapTimeframe(tf: string, wide: boolean): { range: string; interval: string; aggregate: number } {
  switch (tf) {
    case '1m': return { range: wide ? '5d' : '1d', interval: '1m', aggregate: 1 }
    case '5m': return { range: wide ? '1mo' : '5d', interval: '5m', aggregate: 1 }
    case '15m': return { range: '1mo', interval: '15m', aggregate: 1 }
    case '1h': return { range: wide ? '6mo' : '1mo', interval: '60m', aggregate: 1 }
    case '4h': return { range: wide ? '2y' : '6mo', interval: '60m', aggregate: 4 } // Yahoo has no 4h
    case '1D': return { range: wide ? '5y' : '1y', interval: '1d', aggregate: 1 }
    case '1W': return { range: wide ? '5y' : '2y', interval: '1wk', aggregate: 1 }
    case '1M': return { range: '5y', interval: '1mo', aggregate: 1 }
    default: return { range: wide ? '5y' : '1y', interval: '1d', aggregate: 1 }
  }
}

function aggregateCandles(raw: RawCandle[], group: number): RawCandle[] {
  if (group <= 1) return raw
  const out: RawCandle[] = []
  for (let i = 0; i < raw.length; i += group) {
    const slice = raw.slice(i, i + group)
    const first = slice[0]
    const last = slice[slice.length - 1]
    if (!first || !last) continue
    let h = first.h
    let l = first.l
    let v = 0
    for (const c of slice) {
      if (c.h > h) h = c.h
      if (c.l < l) l = c.l
      v += c.v
    }
    out.push({ t: first.t, o: first.o, h, l, c: last.c, v })
  }
  return out
}

// ---------------------------------------------------------------------------
// Alert mapping / evaluation
// ---------------------------------------------------------------------------

function toAlert(rec: PbRecord): Record<string, unknown> {
  const triggered = Boolean(rec.triggered)
  const triggeredAtRaw = rec.triggered_at
  const triggeredAt = triggeredAtRaw ? String(triggeredAtRaw) : null
  return {
    id: String(rec.id),
    stockId: String(rec.symbol ?? ''),
    targetPrice: Number(rec.price ?? 0),
    condition: String(rec.condition ?? 'above'),
    triggered,
    triggeredAt: triggered ? triggeredAt : null,
    active: !triggered,
    createdAt: rec.created ? String(rec.created) : CREATED_AT,
    symbol: String(rec.symbol ?? ''),
  }
}

// ---------------------------------------------------------------------------
// In-memory app state (V1 stored it in SQLite; UI only needs a stable object)
// ---------------------------------------------------------------------------

let appState: Record<string, unknown> = {}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleStocks(): Promise<Response> {
  const wl = await pbList('watchlist', 'perPage=200')
  const wlSymbols = wl.map((r) => String(r.symbol ?? '').toUpperCase()).filter(Boolean)
  const symbols = Array.from(new Set([...UNIVERSE, ...wlSymbols]))
  const quotes = await getQuotes(symbols)
  const result = symbols.map((sym) => {
    const q = quotes.get(sym) ?? null
    const stock = toStock(sym, q)
    ;(stock as Record<string, unknown>).price = q ? toStockPrice(sym, q) : null
    return stock
  })
  return json(result)
}

async function handleSearch(query: URLSearchParams): Promise<Response> {
  const q = (query.get('q') ?? '').trim()
  if (!q) return json([])
  const res = await originalFetch(`/api/ops/search?q=${encodeURIComponent(q)}`)
  if (!res.ok) return json([])
  const body = (await res.json()) as { results?: Array<{ symbol: string; name: string; exchange: string; type: string }> }
  const out = (body.results ?? []).map((r) => ({
    id: r.symbol,
    symbol: r.symbol,
    name: r.name,
    sector: SECTOR_MAP[r.symbol.toUpperCase()] ?? r.type ?? '',
    marketCap: null,
    exchange: r.exchange ?? '',
    createdAt: CREATED_AT,
  }))
  return json(out)
}

async function handleBulkPrices(): Promise<Response> {
  const wl = await pbList('watchlist', 'perPage=200')
  const wlSymbols = wl.map((r) => String(r.symbol ?? '').toUpperCase()).filter(Boolean)
  const symbols = Array.from(new Set([...wlSymbols, ...UNIVERSE]))
  const quotes = await getQuotes(symbols)
  // V1 (routes.py get_bulk_prices) returns a {symbol: {price, change, changePct}} map.
  const map: Record<string, { price: number; change: number; changePct: number }> = {}
  for (const [sym, q] of quotes) {
    const sp = toStockPrice(sym, q)
    map[sym] = {
      price: sp.price as number,
      change: sp.change as number,
      changePct: sp.changePct as number,
    }
  }
  return json(map)
}

async function handleStockPrice(symbol: string): Promise<Response> {
  const q = await getQuote(symbol)
  if (!q) return json({ detail: `Price data temporarily unavailable for '${symbol}'` }, 503)
  const stock = toStock(symbol, q)
  ;(stock as Record<string, unknown>).price = toStockPrice(symbol, q)
  return json(stock)
}

async function handleCandles(symbol: string, query: URLSearchParams): Promise<Response> {
  const tf = query.get('timeframe') ?? '1D'
  const limit = Math.max(1, Number(query.get('limit') ?? 500) || 500)
  const beforeIso = query.get('before')
  const beforeSec = beforeIso ? Math.floor(Date.parse(beforeIso) / 1000) : null

  const { range, interval, aggregate } = mapTimeframe(tf, beforeSec != null)
  const res = await originalFetch(
    `/api/ops/candles?symbol=${encodeURIComponent(symbol)}&range=${range}&interval=${interval}`,
  )
  if (!res.ok) return json([])
  const body = (await res.json()) as { candles?: RawCandle[] }
  let raw = (body.candles ?? []).slice().sort((a, b) => a.t - b.t)
  raw = aggregateCandles(raw, aggregate)
  if (beforeSec != null) raw = raw.filter((c) => c.t < beforeSec)
  if (raw.length > limit) raw = raw.slice(raw.length - limit)

  const out = raw.map((c) => ({
    id: c.t,
    stockId: symbol.toUpperCase(),
    timeframe: tf,
    timestamp: new Date(c.t * 1000).toISOString(),
    openPrice: c.o,
    high: c.h,
    low: c.l,
    closePrice: c.c,
    volume: c.v,
  }))
  return json(out)
}

async function buildWatchlist(): Promise<Record<string, unknown>[]> {
  const rows = await pbList('watchlist', 'sort=position&perPage=200')
  const symbols = rows.map((r) => String(r.symbol ?? '').toUpperCase()).filter(Boolean)
  const quotes = await getQuotes(symbols)
  return rows.map((r) => {
    const sym = String(r.symbol ?? '').toUpperCase()
    const q = quotes.get(sym) ?? null
    const stock = toStock(sym, q)
    if (r.name) (stock as Record<string, unknown>).name = String(r.name)
    return {
      id: String(r.id),
      stockId: sym,
      sortOrder: Number(r.position ?? 0),
      createdAt: r.created ? String(r.created) : CREATED_AT,
      stock,
      price: q ? toStockPrice(sym, q) : null,
    }
  })
}

async function handleWatchlistAdd(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const symbol = String(body.symbol ?? '').toUpperCase().trim()
  if (!symbol) return json({ detail: 'symbol required' }, 400)
  const existing = await pbList('watchlist', `perPage=1&filter=${encodeURIComponent(`symbol='${symbol}'`)}`)
  if (existing.length > 0) return json({ detail: `'${symbol}' is already in the watchlist` }, 409)
  const q = await getQuote(symbol)
  const all = await pbList('watchlist', 'perPage=200')
  const created = await pbCreate('watchlist', {
    symbol,
    name: q?.name ?? symbol,
    position: all.length,
  })
  if (!created) return json({ detail: 'failed to add' }, 500)
  const stock = toStock(symbol, q)
  return json({
    id: String(created.id),
    stockId: symbol,
    sortOrder: Number(created.position ?? all.length),
    createdAt: created.created ? String(created.created) : CREATED_AT,
    stock,
    price: q ? toStockPrice(symbol, q) : null,
  })
}

async function handleWatchlistReorder(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const items = Array.isArray(body.items) ? (body.items as Array<{ id?: unknown; sortOrder?: unknown }>) : []
  for (const it of items) {
    if (it.id == null) continue
    await pbPatch('watchlist', String(it.id), { position: Number(it.sortOrder ?? 0) })
  }
  return json(await buildWatchlist())
}

async function handleAlertsList(query: URLSearchParams): Promise<Response> {
  const symbol = query.get('symbol')
  const rows = await pbList('alerts', 'perPage=200')
  let mapped = rows.map(toAlert)
  if (symbol) {
    const up = symbol.toUpperCase()
    mapped = mapped.filter((a) => a.symbol === up)
  }
  return json(mapped)
}

async function handleAlertCreate(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const symbol = String(body.symbol ?? '').toUpperCase().trim()
  const condition = String(body.condition ?? '')
  const targetPrice = Number(body.targetPrice ?? 0)
  if (condition !== 'above' && condition !== 'below') {
    return json({ detail: "condition must be 'above' or 'below'" }, 400)
  }
  if (!symbol) return json({ detail: 'symbol required' }, 400)
  const created = await pbCreate('alerts', {
    symbol,
    condition,
    price: targetPrice,
    triggered: false,
  })
  if (!created) return json({ detail: 'failed to create alert' }, 500)
  return json(toAlert(created))
}

// Live-quote evaluation stands in for V1's server tick loop.
async function handleTriggeredAlerts(): Promise<Response> {
  const rows = await pbList('alerts', 'perPage=200')
  const pending = rows.filter((r) => !r.triggered)
  if (pending.length > 0) {
    const symbols = pending.map((r) => String(r.symbol ?? '').toUpperCase())
    const quotes = await getQuotes(symbols)
    const nowIso = new Date().toISOString()
    for (const r of pending) {
      const sym = String(r.symbol ?? '').toUpperCase()
      const q = quotes.get(sym)
      if (!q) continue
      const target = Number(r.price ?? 0)
      const cond = String(r.condition ?? 'above')
      const hit = cond === 'above' ? q.price >= target : q.price <= target
      if (hit) {
        await pbPatch('alerts', String(r.id), { triggered: true, triggered_at: nowIso })
        r.triggered = true
        r.triggered_at = nowIso
      }
    }
  }
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  const triggered = rows
    .filter((r) => r.triggered)
    .filter((r) => {
      const ta = r.triggered_at ? Date.parse(String(r.triggered_at)) : Date.now()
      return Number.isNaN(ta) || ta >= cutoff
    })
    .map(toAlert)
  return json(triggered)
}

async function handleNews(query: URLSearchParams): Promise<Response> {
  const symbol = query.get('symbol')
  const url = symbol ? `/api/ops/news?symbol=${encodeURIComponent(symbol)}` : '/api/ops/news'
  const res = await originalFetch(url)
  if (!res.ok) return json([])
  const body = (await res.json()) as {
    news?: Array<{ title: string; publisher: string; link: string; published: number; tickers: string[] }>
  }
  const out = (body.news ?? []).map((n, i) => ({
    id: i,
    stockSymbol: symbol ? symbol.toUpperCase() : null,
    headline: n.title,
    summary: null,
    source: n.publisher ?? '',
    url: n.link ?? null,
    publishedAt: n.published ? new Date(n.published * 1000).toISOString() : new Date().toISOString(),
    createdAt: new Date().toISOString(),
  }))
  return json(out)
}

async function handleScreener(query: URLSearchParams): Promise<Response> {
  const wl = await pbList('watchlist', 'perPage=200')
  const wlSymbols = wl.map((r) => String(r.symbol ?? '').toUpperCase()).filter(Boolean)
  const symbols = Array.from(new Set([...UNIVERSE, ...wlSymbols]))
  const quotes = await getQuotes(symbols)

  const minPrice = numParam(query, 'min_price')
  const maxPrice = numParam(query, 'max_price')
  const minVol = numParam(query, 'min_volume')
  const maxVol = numParam(query, 'max_volume')
  const minChg = numParam(query, 'min_change_pct')
  const maxChg = numParam(query, 'max_change_pct')
  const sector = query.get('sector')
  const sort = query.get('sort') ?? 'symbol'
  const sortDir = query.get('sort_dir') === 'desc' ? 'desc' : 'asc'

  let rows = symbols
    .map((sym) => {
      const q = quotes.get(sym)
      if (!q) return null
      const stock = toStock(sym, q)
      ;(stock as Record<string, unknown>).price = toStockPrice(sym, q)
      return stock as Record<string, unknown>
    })
    .filter((s): s is Record<string, unknown> => s !== null)

  rows = rows.filter((s) => {
    const p = s.price as Record<string, number>
    if (minPrice != null && p.price < minPrice) return false
    if (maxPrice != null && p.price > maxPrice) return false
    if (minVol != null && p.volume < minVol) return false
    if (maxVol != null && p.volume > maxVol) return false
    if (minChg != null && p.changePct < minChg) return false
    if (maxChg != null && p.changePct > maxChg) return false
    if (sector && s.sector !== sector) return false
    return true
  })

  const dir = sortDir === 'desc' ? -1 : 1
  rows.sort((a, b) => {
    const pa = a.price as Record<string, number>
    const pb = b.price as Record<string, number>
    let av: number | string
    let bv: number | string
    switch (sort) {
      case 'price': av = pa.price; bv = pb.price; break
      case 'changePct': case 'change_pct': av = pa.changePct; bv = pb.changePct; break
      case 'volume': av = pa.volume; bv = pb.volume; break
      case 'name': av = String(a.name); bv = String(b.name); break
      default: av = String(a.symbol); bv = String(b.symbol); break
    }
    if (typeof av === 'string' && typeof bv === 'string') return av < bv ? -dir : av > bv ? dir : 0
    return ((av as number) - (bv as number)) * dir
  })

  return json(rows)
}

function numParam(query: URLSearchParams, key: string): number | null {
  const v = query.get(key)
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

const DEFAULT_LAYOUT = {
  layoutData: {
    lg: [
      { i: 'chart-1', x: 0, y: 0, w: 8, h: 12, minW: 4, minH: 6 },
      { i: 'watchlist', x: 8, y: 0, w: 4, h: 8, minW: 3, minH: 4 },
      { i: 'details', x: 8, y: 8, w: 4, h: 4, minW: 3, minH: 3 },
      { i: 'news', x: 0, y: 12, w: 6, h: 6, minW: 3, minH: 3 },
      { i: 'screener', x: 6, y: 12, w: 6, h: 6, minW: 4, minH: 4 },
    ],
    md: [
      { i: 'chart-1', x: 0, y: 0, w: 6, h: 10, minW: 4, minH: 6 },
      { i: 'watchlist', x: 6, y: 0, w: 4, h: 6, minW: 3, minH: 4 },
      { i: 'details', x: 6, y: 6, w: 4, h: 4, minW: 3, minH: 3 },
      { i: 'news', x: 0, y: 10, w: 5, h: 5, minW: 3, minH: 3 },
      { i: 'screener', x: 5, y: 10, w: 5, h: 5, minW: 4, minH: 4 },
    ],
    sm: [
      { i: 'chart-1', x: 0, y: 0, w: 4, h: 8, minW: 4, minH: 6 },
      { i: 'watchlist', x: 0, y: 8, w: 4, h: 6, minW: 3, minH: 4 },
      { i: 'details', x: 0, y: 14, w: 4, h: 4, minW: 3, minH: 3 },
      { i: 'news', x: 0, y: 18, w: 4, h: 5, minW: 3, minH: 3 },
      { i: 'screener', x: 0, y: 23, w: 4, h: 5, minW: 4, minH: 4 },
    ],
  },
  chartConfig: {
    'chart-1': { symbol: 'AAPL', timeframe: '1D', chartType: 'candlestick', indicators: [] },
  },
}

async function handleLayoutGet(): Promise<Response> {
  const rows = await pbList('prefs', 'perPage=1')
  const row = rows[0]
  const stored = row?.layout as { layoutData?: unknown; chartConfig?: unknown } | undefined
  if (stored && stored.layoutData) {
    return json({ layoutData: stored.layoutData, chartConfig: stored.chartConfig ?? {} })
  }
  return json(DEFAULT_LAYOUT)
}

async function handleLayoutPut(init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const payload = { layoutData: body.layoutData ?? {}, chartConfig: body.chartConfig ?? {} }
  const rows = await pbList('prefs', 'perPage=1')
  const row = rows[0]
  if (row?.id) {
    await pbPatch('prefs', String(row.id), { layout: payload })
  } else {
    await pbCreate('prefs', { layout: payload })
  }
  return json(payload)
}

async function handleDrawingsGet(symbol: string): Promise<Response> {
  const rows = await pbList('drawings', `perPage=200&filter=${encodeURIComponent(`symbol='${symbol.toUpperCase()}'`)}`)
  const out = rows.map((r) => ({
    id: String(r.id),
    stockId: symbol.toUpperCase(),
    timeframe: '',
    toolType: String(r.type ?? 'trendline'),
    drawingData: r.points ?? {},
    color: String(r.color ?? '#2962FF'),
    createdAt: r.created ? String(r.created) : CREATED_AT,
  }))
  return json(out)
}

async function handleDrawingCreate(symbol: string, init?: RequestInit): Promise<Response> {
  const body = readBody(init)
  const created = await pbCreate('drawings', {
    symbol: symbol.toUpperCase(),
    type: body.toolType ?? 'trendline',
    points: body.drawingData ?? {},
    color: body.color ?? '#2962FF',
  })
  if (!created) return json({ detail: 'failed to create drawing' }, 500)
  return json({
    id: String(created.id),
    stockId: symbol.toUpperCase(),
    timeframe: String(body.timeframe ?? ''),
    toolType: String(created.type ?? 'trendline'),
    drawingData: created.points ?? {},
    color: String(created.color ?? '#2962FF'),
    createdAt: created.created ? String(created.created) : CREATED_AT,
  })
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function route(url: URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase()
  const path = url.pathname
  const query = url.searchParams

  // Health
  if (path === '/health') return json({ status: 'ok' })

  // Generic app state / actions
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

  // Stocks
  if (path === '/api/stocks' && method === 'GET') return handleStocks()
  if (path === '/api/stocks/seed' && method === 'POST') return json({ message: 'ok' })
  if (path === '/api/stocks/search' && method === 'GET') return handleSearch(query)
  if (path === '/api/stocks/prices' && method === 'GET') return handleBulkPrices()

  let m: RegExpMatchArray | null
  if ((m = path.match(/^\/api\/stocks\/([^/]+)\/price$/)) && method === 'GET') {
    return handleStockPrice(decodeURIComponent(m[1] as string))
  }
  if ((m = path.match(/^\/api\/stocks\/([^/]+)\/candles$/)) && method === 'GET') {
    return handleCandles(decodeURIComponent(m[1] as string), query)
  }
  if ((m = path.match(/^\/api\/stocks\/([^/]+)\/indicators$/)) && method === 'GET') {
    return json([]) // ChartWidget derives indicators client-side
  }
  if ((m = path.match(/^\/api\/stocks\/([^/]+)\/drawings$/))) {
    const sym = decodeURIComponent(m[1] as string)
    if (method === 'GET') return handleDrawingsGet(sym)
    if (method === 'POST') return handleDrawingCreate(sym, init)
  }
  if ((m = path.match(/^\/api\/drawings\/([^/]+)$/))) {
    const id = decodeURIComponent(m[1] as string)
    if (method === 'PUT') { await pbPatch('drawings', id, drawingPatch(readBody(init))); return json({ status: 'updated', id }) }
    if (method === 'DELETE') { await pbDelete('drawings', id); return json({ status: 'deleted', id }) }
  }

  // Watchlist
  if (path === '/api/watchlist') {
    if (method === 'GET') return json(await buildWatchlist())
    if (method === 'POST') return handleWatchlistAdd(init)
  }
  if (path === '/api/watchlist/reorder' && method === 'PUT') return handleWatchlistReorder(init)
  if ((m = path.match(/^\/api\/watchlist\/([^/]+)$/)) && method === 'DELETE') {
    const id = decodeURIComponent(m[1] as string)
    await pbDelete('watchlist', id)
    return json({ status: 'deleted', id })
  }

  // Alerts
  if (path === '/api/alerts') {
    if (method === 'GET') return handleAlertsList(query)
    if (method === 'POST') return handleAlertCreate(init)
  }
  if (path === '/api/alerts/triggered' && method === 'GET') return handleTriggeredAlerts()
  if ((m = path.match(/^\/api\/alerts\/([^/]+)$/)) && method === 'DELETE') {
    const id = decodeURIComponent(m[1] as string)
    await pbDelete('alerts', id)
    return json({ status: 'deleted', id })
  }

  // Screener / News / Layout
  if (path === '/api/screener' && method === 'GET') return handleScreener(query)
  if (path === '/api/news' && method === 'GET') return handleNews(query)
  if (path === '/api/layout') {
    if (method === 'GET') return handleLayoutGet()
    if (method === 'PUT') return handleLayoutPut(init)
  }

  // Safety net: never throw. Arrays for list-ish paths, object otherwise.
  if (method === 'GET') return json({})
  return json({ ok: true })
}

function drawingPatch(body: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  if (body.drawingData !== undefined) patch.points = body.drawingData
  if (body.color !== undefined) patch.color = body.color
  return patch
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
