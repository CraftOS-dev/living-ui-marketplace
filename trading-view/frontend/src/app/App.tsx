/**
 * Trading View — live watchlist, candlestick charts with indicators
 * (SMA20/50, RSI-14), market overview, symbol search, price alerts and
 * per-symbol news. Market data comes from the app's own Yahoo Finance
 * proxy ops; only watchlist + alerts are stored.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RecordModel } from 'pocketbase';
import {
  Badge,
  Button,
  Dialog,
  Input,
  getPbClient,
  toast,
  useCollection,
} from '../kit/index.ts';

interface WatchItem extends RecordModel {
  symbol: string;
  name: string;
  position: number;
}

interface Alert extends RecordModel {
  symbol: string;
  condition: '' | 'above' | 'below';
  price: number;
  triggered: boolean;
  triggered_at: string;
}

interface Quote {
  symbol: string;
  name?: string;
  price?: number;
  previousClose?: number;
  currency?: string;
  exchange?: string;
  dayHigh?: number | null;
  dayLow?: number | null;
  volume?: number | null;
  fiftyTwoWeekHigh?: number | null;
  fiftyTwoWeekLow?: number | null;
  error?: string;
}

interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

interface NewsItem {
  title: string;
  publisher: string;
  link: string;
  published: number;
}

interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
}

interface Drawing extends RecordModel {
  symbol: string;
  type: 'trendline' | 'hline' | '';
  points: { t: number; price: number }[];
  color: string;
}

interface Prefs extends RecordModel {
  range: string;
  sma20: boolean;
  sma50: boolean;
  rsi: boolean;
  ema20: boolean;
  bb: boolean;
  vwap: boolean;
  macd: boolean;
  show_news: boolean;
  layout: string[] | null;
}

const DEFAULT_LAYOUT = ['details', 'chart', 'rsi', 'macd', 'news'] as const;
const WIDGET_LABEL: Record<string, string> = {
  details: 'Details',
  chart: 'Chart',
  rsi: 'RSI',
  macd: 'MACD',
  news: 'News',
};

const INDICES: { symbol: string; label: string }[] = [
  { symbol: '^GSPC', label: 'S&P 500' },
  { symbol: '^DJI', label: 'Dow' },
  { symbol: '^IXIC', label: 'Nasdaq' },
];

const RANGES: { key: string; range: string; interval: string }[] = [
  { key: '1D', range: '1d', interval: '5m' },
  { key: '5D', range: '5d', interval: '30m' },
  { key: '1M', range: '1mo', interval: '1d' },
  { key: '6M', range: '6mo', interval: '1d' },
  { key: '1Y', range: '1y', interval: '1d' },
  { key: '5Y', range: '5y', interval: '1wk' },
];

function fmt(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function changeOf(quote: Quote): { abs: number; pct: number } | null {
  if (quote.price === undefined || quote.previousClose === undefined || quote.previousClose === 0) {
    return null;
  }
  const abs = quote.price - quote.previousClose;
  return { abs, pct: (abs / quote.previousClose) * 100 };
}

function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** MACD(12,26,9): line, signal and histogram series. */
function macd(values: number[]): {
  line: (number | null)[];
  signal: (number | null)[];
  hist: (number | null)[];
} {
  const fast = ema(values, 12);
  const slow = ema(values, 26);
  const line = values.map((_, i) =>
    fast[i] === null || slow[i] === null ? null : fast[i]! - slow[i]!,
  );
  const defined = line.map((v) => v ?? 0);
  const firstIndex = line.findIndex((v) => v !== null);
  const signalRaw = ema(defined.slice(firstIndex === -1 ? 0 : firstIndex), 9);
  const signal: (number | null)[] = new Array(values.length).fill(null);
  for (let i = 0; i < signalRaw.length; i++) {
    signal[i + (firstIndex === -1 ? 0 : firstIndex)] = signalRaw[i] ?? null;
  }
  const hist = line.map((v, i) => (v === null || signal[i] === null ? null : v - signal[i]!));
  return { line, signal, hist };
}

/** Bollinger Bands (20, 2σ). */
function bollinger(
  values: number[],
  period = 20,
  mult = 2,
): { upper: (number | null)[]; middle: (number | null)[]; lower: (number | null)[] } {
  const upper: (number | null)[] = new Array(values.length).fill(null);
  const middle: (number | null)[] = new Array(values.length).fill(null);
  const lower: (number | null)[] = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const window = values.slice(i - period + 1, i + 1);
    const mean = window.reduce((a, b) => a + b, 0) / period;
    const variance = window.reduce((sum, v) => sum + (v - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    middle[i] = mean;
    upper[i] = mean + mult * sd;
    lower[i] = mean - mult * sd;
  }
  return { upper, middle, lower };
}

/** Session-agnostic cumulative VWAP over the loaded candles. */
function vwap(candles: Candle[]): (number | null)[] {
  let pv = 0;
  let vol = 0;
  return candles.map((candle) => {
    const typical = (candle.h + candle.l + candle.c) / 3;
    pv += typical * candle.v;
    vol += candle.v;
    return vol === 0 ? null : pv / vol;
  });
}

function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i]! - values[i - 1]!;
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i]! - values[i - 1]!;
    gain = (gain * (period - 1) + Math.max(0, diff)) / period;
    loss = (loss * (period - 1) + Math.max(0, -diff)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function App(): React.JSX.Element {
  const { records: watchlist } = useCollection<WatchItem>('watchlist', { sort: 'position' });
  const { records: alerts } = useCollection<Alert>('alerts', { sort: '-created' });
  const { records: prefsRows } = useCollection<Prefs>('prefs', {});
  const prefs = prefsRows[0];
  const [quotes, setQuotes] = useState<Map<string, Quote>>(new Map());
  const [selected, setSelected] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [screenerOpen, setScreenerOpen] = useState(false);
  const alertsRef = useRef(alerts);
  alertsRef.current = alerts;

  const symbol = selected ?? watchlist[0]?.symbol ?? null;

  const refreshQuotes = useCallback(async (): Promise<void> => {
    const symbols = [
      ...new Set([...watchlist.map((w) => w.symbol), ...INDICES.map((i) => i.symbol)]),
    ];
    if (symbols.length === 0) return;
    try {
      const res = await fetch(`/api/ops/quotes?symbols=${encodeURIComponent(symbols.join(','))}`);
      if (!res.ok) return;
      const data = (await res.json()) as { quotes: Quote[] };
      const map = new Map(data.quotes.map((q) => [q.symbol, q]));
      setQuotes(map);

      // Check pending price alerts against the fresh quotes.
      for (const alert of alertsRef.current) {
        if (alert.triggered) continue;
        const price = map.get(alert.symbol)?.price;
        if (price === undefined) continue;
        const hit =
          (alert.condition === 'above' && price >= alert.price) ||
          (alert.condition === 'below' && price <= alert.price);
        if (hit) {
          toast.success(`⏰ ${alert.symbol} is ${alert.condition} ${fmt(alert.price)}`);
          try {
            await getPbClient().call((pb) =>
              pb.collection('alerts').update(alert.id, {
                triggered: true,
                triggered_at: new Date().toISOString(),
              }),
            );
          } catch {
            /* surfaced by shell */
          }
        }
      }
    } catch {
      /* transient network failures: keep last quotes */
    }
  }, [watchlist]);

  useEffect(() => {
    void refreshQuotes();
    const timer = setInterval(() => void refreshQuotes(), 60_000);
    return () => clearInterval(timer);
  }, [refreshQuotes]);

  const removeSymbol = async (item: WatchItem): Promise<void> => {
    try {
      await getPbClient().call((pb) => pb.collection('watchlist').delete(item.id));
      if (selected === item.symbol) setSelected(null);
    } catch {
      /* surfaced by shell */
    }
  };

  return (
    <div className="flex h-screen flex-col">
      <MarketStrip
        quotes={quotes}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenScreener={() => setScreenerOpen(true)}
      />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-r">
          <div className="border-b">
            {watchlist.map((item) => {
              const quote = quotes.get(item.symbol);
              const change = quote !== undefined ? changeOf(quote) : null;
              const active = item.symbol === symbol;
              return (
                <div
                  key={item.id}
                  onClick={() => setSelected(item.symbol)}
                  className={`group flex cursor-pointer items-center gap-2 border-b px-3 py-2 text-sm ${active ? 'bg-black/5 dark:bg-white/10' : ''}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{item.symbol}</p>
                    <p className="truncate text-xs opacity-60">{item.name}</p>
                  </div>
                  <div className="text-right">
                    <p className="tabular-nums">
                      {quote?.price !== undefined ? fmt(quote.price) : '…'}
                    </p>
                    {change !== null && (
                      <p
                        className={`text-xs tabular-nums ${change.abs >= 0 ? 'text-green-600' : 'text-red-500'}`}
                      >
                        {change.abs >= 0 ? '+' : ''}
                        {change.pct.toFixed(2)}%
                      </p>
                    )}
                    {quote?.error !== undefined && <p className="text-xs text-red-500">no data</p>}
                  </div>
                  <button
                    type="button"
                    className="opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      void removeSymbol(item);
                    }}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
            {watchlist.length === 0 && (
              <p className="p-4 text-sm opacity-60">Watchlist is empty — search to add symbols.</p>
            )}
          </div>
          <AlertsSection alerts={alerts} watchlist={watchlist} quotes={quotes} />
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto p-4">
          {symbol === null ? (
            <p className="text-sm opacity-60">Select a symbol.</p>
          ) : (
            <ChartPanel key={symbol} symbol={symbol} quote={quotes.get(symbol)} prefs={prefs} />
          )}
        </main>
      </div>

      {searchOpen && (
        <SearchModal
          watchlist={watchlist}
          onAdded={(added) => setSelected(added)}
          onClose={() => setSearchOpen(false)}
        />
      )}
      {screenerOpen && (
        <ScreenerDialog
          watchlist={watchlist}
          quotes={quotes}
          onSelect={(sym) => {
            setSelected(sym);
            setScreenerOpen(false);
          }}
          onClose={() => setScreenerOpen(false)}
        />
      )}
    </div>
  );
}

function ScreenerDialog({
  watchlist,
  quotes,
  onSelect,
  onClose,
}: {
  watchlist: WatchItem[];
  quotes: Map<string, Quote>;
  onSelect: (symbol: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [minChange, setMinChange] = useState('');
  const [minVolume, setMinVolume] = useState('');

  const rows = watchlist
    .map((item) => {
      const quote = quotes.get(item.symbol);
      const change = quote !== undefined ? changeOf(quote) : null;
      return { item, quote, change };
    })
    .filter(({ quote, change }) => {
      if (quote?.price === undefined) return false;
      if (minPrice !== '' && quote.price < Number(minPrice)) return false;
      if (maxPrice !== '' && quote.price > Number(maxPrice)) return false;
      if (minChange !== '' && (change === null || Math.abs(change.pct) < Number(minChange))) {
        return false;
      }
      if (minVolume !== '' && (quote.volume === null || quote.volume === undefined || quote.volume < Number(minVolume))) {
        return false;
      }
      return true;
    });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Screener"
      description="Filter your watchlist by live quote data."
      className="max-w-2xl"
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Input className="w-24" type="number" value={minPrice} placeholder="Min $" onChange={(e) => setMinPrice(e.target.value)} />
          <Input className="w-24" type="number" value={maxPrice} placeholder="Max $" onChange={(e) => setMaxPrice(e.target.value)} />
          <Input className="w-28" type="number" value={minChange} placeholder="Min |Δ%|" onChange={(e) => setMinChange(e.target.value)} />
          <Input className="w-32" type="number" value={minVolume} placeholder="Min volume" onChange={(e) => setMinVolume(e.target.value)} />
        </div>
        <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {rows.map(({ item, quote, change }) => (
            <button
              key={item.id}
              type="button"
              className="flex items-center gap-3 rounded-md border p-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
              onClick={() => onSelect(item.symbol)}
            >
              <span className="w-16 font-medium">{item.symbol}</span>
              <span className="flex-1 truncate opacity-60">{item.name}</span>
              <span className="tabular-nums">{fmt(quote?.price)}</span>
              {change !== null && (
                <span className={`w-16 text-right text-xs tabular-nums ${change.abs >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                  {change.abs >= 0 ? '+' : ''}
                  {change.pct.toFixed(2)}%
                </span>
              )}
              <span className="w-24 text-right text-xs tabular-nums opacity-60">
                {quote?.volume?.toLocaleString() ?? '—'}
              </span>
            </button>
          ))}
          {rows.length === 0 && <p className="text-sm opacity-60">No matches.</p>}
        </div>
      </div>
    </Dialog>
  );
}

function MarketStrip({
  quotes,
  onOpenSearch,
  onOpenScreener,
}: {
  quotes: Map<string, Quote>;
  onOpenSearch: () => void;
  onOpenScreener: () => void;
}): React.JSX.Element {
  return (
    <header className="flex items-center gap-4 border-b px-4 py-2">
      <h1 className="text-base font-semibold">Trading View</h1>
      <div className="flex items-center gap-4 overflow-x-auto text-sm">
        {INDICES.map(({ symbol, label }) => {
          const quote = quotes.get(symbol);
          const change = quote !== undefined ? changeOf(quote) : null;
          return (
            <span key={symbol} className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="opacity-60">{label}</span>
              <span className="tabular-nums">{quote?.price !== undefined ? fmt(quote.price) : '…'}</span>
              {change !== null && (
                <span
                  className={`text-xs tabular-nums ${change.abs >= 0 ? 'text-green-600' : 'text-red-500'}`}
                >
                  {change.abs >= 0 ? '▲' : '▼'}
                  {Math.abs(change.pct).toFixed(2)}%
                </span>
              )}
            </span>
          );
        })}
      </div>
      <span className="ml-auto flex gap-2">
        <Button variant="outline" size="sm" onClick={onOpenScreener}>
          📊 Screener
        </Button>
        <Button variant="outline" size="sm" onClick={onOpenSearch}>
          🔍 Search symbols
        </Button>
      </span>
    </header>
  );
}

function SearchModal({
  watchlist,
  onAdded,
  onClose,
}: {
  watchlist: WatchItem[];
  onAdded: (symbol: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed === '') {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      void (async () => {
        setBusy(true);
        try {
          const res = await fetch(`/api/ops/search?q=${encodeURIComponent(trimmed)}`);
          const data = (await res.json()) as { results?: SearchResult[] };
          setResults(data.results ?? []);
        } catch {
          setResults([]);
        } finally {
          setBusy(false);
        }
      })();
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const add = async (result: SearchResult): Promise<void> => {
    if (watchlist.some((w) => w.symbol === result.symbol)) {
      toast.error(`${result.symbol} is already on the watchlist`);
      return;
    }
    try {
      const position = Math.max(0, ...watchlist.map((w) => w.position + 1));
      await getPbClient().call((pb) =>
        pb.collection('watchlist').create({ symbol: result.symbol, name: result.name, position }),
      );
      toast.success(`${result.symbol} added`);
      onAdded(result.symbol);
      onClose();
    } catch {
      /* surfaced by shell */
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Search symbols"
    >
      <div className="flex flex-col gap-2">
        <Input
          value={query}
          placeholder="Company name or ticker (e.g. apple, NVDA)…"
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {busy && <p className="text-xs opacity-60">Searching…</p>}
          {results.map((result) => (
            <div
              key={result.symbol}
              className="flex items-center gap-2 rounded-md border p-2 text-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {result.symbol}{' '}
                  <span className="text-xs font-normal opacity-60">{result.exchange}</span>
                </p>
                <p className="truncate text-xs opacity-60">{result.name}</p>
              </div>
              <Button size="sm" onClick={() => void add(result)}>
                Add
              </Button>
            </div>
          ))}
          {!busy && query.trim() !== '' && results.length === 0 && (
            <p className="text-xs opacity-60">No matches.</p>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function AlertsSection({
  alerts,
  watchlist,
  quotes,
}: {
  alerts: Alert[];
  watchlist: WatchItem[];
  quotes: Map<string, Quote>;
}): React.JSX.Element {
  const [symbol, setSymbol] = useState('');
  const [condition, setCondition] = useState<'above' | 'below'>('above');
  const [price, setPrice] = useState('');

  const add = async (): Promise<void> => {
    const sym = (symbol || watchlist[0]?.symbol || '').toUpperCase();
    const target = Number(price);
    if (sym === '' || !(target > 0)) return;
    try {
      await getPbClient().call((pb) =>
        pb.collection('alerts').create({ symbol: sym, condition, price: target, triggered: false }),
      );
      setPrice('');
      toast.success(`Alert set: ${sym} ${condition} ${fmt(target)}`);
    } catch {
      /* surfaced by shell */
    }
  };

  const remove = async (alert: Alert): Promise<void> => {
    try {
      await getPbClient().call((pb) => pb.collection('alerts').delete(alert.id));
    } catch {
      /* surfaced by shell */
    }
  };

  return (
    <div className="p-3 text-sm">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-60">Price alerts</p>
      <div className="mb-2 flex items-center gap-1">
        <select
          className="w-20 rounded-md border bg-transparent px-1 py-1 text-xs"
          value={symbol || watchlist[0]?.symbol || ''}
          onChange={(e) => setSymbol(e.target.value)}
        >
          {watchlist.map((w) => (
            <option key={w.id} value={w.symbol}>
              {w.symbol}
            </option>
          ))}
        </select>
        <select
          className="rounded-md border bg-transparent px-1 py-1 text-xs"
          value={condition}
          onChange={(e) => setCondition(e.target.value === 'below' ? 'below' : 'above')}
        >
          <option value="above">≥</option>
          <option value="below">≤</option>
        </select>
        <Input
          className="h-7 w-20 text-xs"
          type="number"
          value={price}
          placeholder="price"
          onChange={(e) => setPrice(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add();
          }}
        />
        <Button size="sm" variant="outline" onClick={() => void add()}>
          Set
        </Button>
      </div>
      <div className="flex flex-col gap-1">
        {alerts.map((alert) => {
          const current = quotes.get(alert.symbol)?.price;
          return (
            <div key={alert.id} className="group flex items-center gap-2 text-xs">
              {alert.triggered ? <span>✅</span> : <span>⏳</span>}
              <span className="font-medium">{alert.symbol}</span>
              <span className="opacity-70">
                {alert.condition === 'above' ? '≥' : '≤'} {fmt(alert.price)}
              </span>
              {alert.triggered ? (
                <span className="opacity-50">
                  {alert.triggered_at !== '' && new Date(alert.triggered_at).toLocaleString()}
                </span>
              ) : (
                current !== undefined && <span className="opacity-50">now {fmt(current)}</span>
              )}
              <button
                type="button"
                className="ml-auto opacity-0 transition-opacity group-hover:opacity-50 hover:!opacity-100"
                onClick={() => void remove(alert)}
              >
                ✕
              </button>
            </div>
          );
        })}
        {alerts.length === 0 && <p className="text-xs opacity-50">No alerts set.</p>}
      </div>
    </div>
  );
}

function ChartPanel({
  symbol,
  quote,
  prefs,
}: {
  symbol: string;
  quote: Quote | undefined;
  prefs: Prefs | undefined;
}): React.JSX.Element {
  const [rangeKey, setRangeKey] = useState('6M');
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<Candle | null>(null);
  const [showSma20, setShowSma20] = useState(true);
  const [showSma50, setShowSma50] = useState(false);
  const [showRsi, setShowRsi] = useState(false);
  const [showEma20, setShowEma20] = useState(false);
  const [showBb, setShowBb] = useState(false);
  const [showVwap, setShowVwap] = useState(false);
  const [showMacd, setShowMacd] = useState(false);
  const [showNews, setShowNews] = useState(true);
  const [layout, setLayout] = useState<string[]>([...DEFAULT_LAYOUT]);
  const [arranging, setArranging] = useState(false);
  const prefsApplied = useRef(false);

  // Apply persisted layout preferences once, when they arrive.
  useEffect(() => {
    if (prefs === undefined || prefsApplied.current) return;
    prefsApplied.current = true;
    if (RANGES.some((r) => r.key === prefs.range)) setRangeKey(prefs.range);
    setShowSma20(prefs.sma20);
    setShowSma50(prefs.sma50);
    setShowRsi(prefs.rsi);
    setShowEma20(prefs.ema20);
    setShowBb(prefs.bb);
    setShowVwap(prefs.vwap);
    setShowMacd(prefs.macd);
    setShowNews(prefs.show_news);
    if (Array.isArray(prefs.layout) && prefs.layout.length > 0) setLayout(prefs.layout);
  }, [prefs]);

  const savePref = (
    patch: Partial<
      Pick<
        Prefs,
        'range' | 'sma20' | 'sma50' | 'rsi' | 'ema20' | 'bb' | 'vwap' | 'macd' | 'show_news' | 'layout'
      >
    >,
  ): void => {
    if (prefs === undefined) return;
    void getPbClient().call((pb) => pb.collection('prefs').update(prefs.id, patch));
  };

  // Chart drawings for this symbol (data coordinates: t + price).
  const { records: drawings } = useCollection<Drawing>('drawings', {
    filter: `symbol = "${symbol}"`,
    sort: 'created',
  });
  const [drawMode, setDrawMode] = useState<'off' | 'trendline' | 'hline'>('off');
  const [pendingPoint, setPendingPoint] = useState<{ t: number; price: number } | null>(null);

  const onChartClick = (t: number, price: number): void => {
    if (drawMode === 'off') return;
    if (drawMode === 'hline') {
      void getPbClient().call((pb) =>
        pb.collection('drawings').create({
          symbol,
          type: 'hline',
          points: [{ t, price }],
          color: '#f59e0b',
        }),
      );
      setDrawMode('off');
      return;
    }
    if (pendingPoint === null) {
      setPendingPoint({ t, price });
      return;
    }
    void getPbClient().call((pb) =>
      pb.collection('drawings').create({
        symbol,
        type: 'trendline',
        points: [pendingPoint, { t, price }],
        color: '#8b5cf6',
      }),
    );
    setPendingPoint(null);
    setDrawMode('off');
  };

  const moveWidget = (key: string, delta: number): void => {
    const ordered = layout.filter((k) =>
      DEFAULT_LAYOUT.includes(k as (typeof DEFAULT_LAYOUT)[number]),
    );
    const index = ordered.indexOf(key);
    const target = index + delta;
    if (index === -1 || target < 0 || target >= ordered.length) return;
    const next = [...ordered];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item!);
    setLayout(next);
    savePref({ layout: next });
  };

  const clearDrawings = async (): Promise<void> => {
    try {
      for (const drawing of drawings) {
        await getPbClient().call((pb) => pb.collection('drawings').delete(drawing.id));
      }
      toast.success('Drawings cleared');
    } catch {
      /* surfaced by shell */
    }
  };

  const preset = RANGES.find((r) => r.key === rangeKey) ?? RANGES[3]!;

  useEffect(() => {
    let cancelled = false;
    setCandles(null);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(
          `/api/ops/candles?symbol=${encodeURIComponent(symbol)}&range=${preset.range}&interval=${preset.interval}`,
        );
        const data = (await res.json()) as { candles?: Candle[]; error?: string };
        if (cancelled) return;
        if (!res.ok || data.candles === undefined) {
          setError(data.error ?? `Failed to load candles (${res.status})`);
          return;
        }
        setCandles(data.candles);
      } catch {
        if (!cancelled) setError('Network error while loading candles');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [symbol, preset.range, preset.interval]);

  const change = quote !== undefined ? changeOf(quote) : null;

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-2xl font-semibold">{symbol}</h2>
        <span className="text-2xl tabular-nums">
          {fmt(quote?.price)} {quote?.currency ?? ''}
        </span>
        {change !== null && (
          <Badge variant={change.abs >= 0 ? 'default' : 'destructive'}>
            {change.abs >= 0 ? '▲' : '▼'} {change.abs >= 0 ? '+' : ''}
            {change.abs.toFixed(2)} ({change.pct.toFixed(2)}%)
          </Badge>
        )}
        {quote?.name !== undefined && <span className="text-sm opacity-60">{quote.name}</span>}
      </header>


      <div className="flex flex-wrap items-center gap-1">
        {RANGES.map((r) => (
          <Button
            key={r.key}
            size="sm"
            variant={r.key === rangeKey ? 'default' : 'outline'}
            onClick={() => {
              setRangeKey(r.key);
              savePref({ range: r.key });
            }}
          >
            {r.key}
          </Button>
        ))}
        <span className="mx-2 opacity-30">|</span>
        <Button
          size="sm"
          variant={showSma20 ? 'default' : 'outline'}
          onClick={() => {
            setShowSma20(!showSma20);
            savePref({ sma20: !showSma20 });
          }}
        >
          SMA20
        </Button>
        <Button
          size="sm"
          variant={showSma50 ? 'default' : 'outline'}
          onClick={() => {
            setShowSma50(!showSma50);
            savePref({ sma50: !showSma50 });
          }}
        >
          SMA50
        </Button>
        <Button
          size="sm"
          variant={showRsi ? 'default' : 'outline'}
          onClick={() => {
            setShowRsi(!showRsi);
            savePref({ rsi: !showRsi });
          }}
        >
          RSI
        </Button>
        <Button
          size="sm"
          variant={showEma20 ? 'default' : 'outline'}
          onClick={() => {
            setShowEma20(!showEma20);
            savePref({ ema20: !showEma20 });
          }}
        >
          EMA20
        </Button>
        <Button
          size="sm"
          variant={showBb ? 'default' : 'outline'}
          onClick={() => {
            setShowBb(!showBb);
            savePref({ bb: !showBb });
          }}
        >
          BB
        </Button>
        <Button
          size="sm"
          variant={showVwap ? 'default' : 'outline'}
          onClick={() => {
            setShowVwap(!showVwap);
            savePref({ vwap: !showVwap });
          }}
        >
          VWAP
        </Button>
        <Button
          size="sm"
          variant={showMacd ? 'default' : 'outline'}
          onClick={() => {
            setShowMacd(!showMacd);
            savePref({ macd: !showMacd });
          }}
        >
          MACD
        </Button>
        <span className="mx-2 opacity-30">|</span>
        <Button
          size="sm"
          variant={drawMode === 'trendline' ? 'default' : 'outline'}
          onClick={() => {
            setDrawMode(drawMode === 'trendline' ? 'off' : 'trendline');
            setPendingPoint(null);
          }}
        >
          ✏️ Trend
        </Button>
        <Button
          size="sm"
          variant={drawMode === 'hline' ? 'default' : 'outline'}
          onClick={() => {
            setDrawMode(drawMode === 'hline' ? 'off' : 'hline');
            setPendingPoint(null);
          }}
        >
          ― Level
        </Button>
        {drawings.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => void clearDrawings()}>
            Clear ({drawings.length})
          </Button>
        )}
        <Button
          size="sm"
          variant={showNews ? 'default' : 'outline'}
          onClick={() => {
            setShowNews(!showNews);
            savePref({ show_news: !showNews });
          }}
        >
          News
        </Button>
        <Button
          size="sm"
          variant={arranging ? 'default' : 'outline'}
          onClick={() => setArranging(!arranging)}
        >
          ⇅ Arrange
        </Button>
      </div>
      {drawMode !== 'off' && (
        <p className="text-xs opacity-70">
          {drawMode === 'hline'
            ? 'Click the chart to place a horizontal level.'
            : pendingPoint === null
              ? 'Click the chart to place the first trendline point.'
              : 'Click again to place the second point.'}
        </p>
      )}

      <div className="h-6 text-xs tabular-nums opacity-70">
        {hovered !== null && (
          <>
            {new Date(hovered.t * 1000).toLocaleString()} · O {fmt(hovered.o)} · H {fmt(hovered.h)}{' '}
            · L {fmt(hovered.l)} · C {fmt(hovered.c)} · Vol {hovered.v.toLocaleString()}
          </>
        )}
      </div>

      {/* Widgets render in the user's saved order (V1's dashboard layout). */}
      {layout
        .filter((key) => DEFAULT_LAYOUT.includes(key as (typeof DEFAULT_LAYOUT)[number]))
        .map((key, index, ordered) => {
          const controls = arranging ? (
            <span className="flex items-center gap-1 text-xs opacity-60">
              <span className="uppercase tracking-wide">{WIDGET_LABEL[key]}</span>
              <button
                type="button"
                className="px-1 hover:opacity-100"
                onClick={() => moveWidget(key, -1)}
                disabled={index === 0}
              >
                ↑
              </button>
              <button
                type="button"
                className="px-1 hover:opacity-100"
                onClick={() => moveWidget(key, 1)}
                disabled={index === ordered.length - 1}
              >
                ↓
              </button>
            </span>
          ) : null;

          let body: React.ReactNode = null;
          if (key === 'details') {
            body =
              quote !== undefined && quote.error === undefined ? (
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs opacity-70">
                  <span>
                    Day <span className="tabular-nums">{fmt(quote.dayLow)} – {fmt(quote.dayHigh)}</span>
                  </span>
                  <span>
                    52w{' '}
                    <span className="tabular-nums">
                      {fmt(quote.fiftyTwoWeekLow)} – {fmt(quote.fiftyTwoWeekHigh)}
                    </span>
                  </span>
                  <span>
                    Vol <span className="tabular-nums">{quote.volume?.toLocaleString() ?? '—'}</span>
                  </span>
                  {quote.exchange !== undefined && quote.exchange !== '' && (
                    <span>{quote.exchange}</span>
                  )}
                </div>
              ) : null;
          } else if (key === 'chart') {
            body =
              error !== null ? (
                <p className="text-sm text-red-500">{error}</p>
              ) : candles === null ? (
                <p className="text-sm opacity-60">Loading candles…</p>
              ) : candles.length === 0 ? (
                <p className="text-sm opacity-60">No data for this range.</p>
              ) : (
                <CandleChart
                  candles={candles}
                  showSma20={showSma20}
                  showSma50={showSma50}
                  showEma20={showEma20}
                  showBb={showBb}
                  showVwap={showVwap}
                  drawings={drawings}
                  pendingPoint={pendingPoint}
                  drawing={drawMode !== 'off'}
                  onChartClick={onChartClick}
                  onHover={setHovered}
                />
              );
          } else if (key === 'rsi') {
            body = showRsi && candles !== null && candles.length > 0 ? <RsiChart candles={candles} /> : null;
          } else if (key === 'macd') {
            body =
              showMacd && candles !== null && candles.length > 0 ? <MacdChart candles={candles} /> : null;
          } else if (key === 'news') {
            body = showNews ? <NewsPanel symbol={symbol} /> : null;
          }

          if (body === null && controls === null) return null;
          return (
            <section key={key} className={arranging ? 'rounded-md border border-dashed p-2' : ''}>
              {controls}
              {body}
            </section>
          );
        })}
    </div>
  );
}

const W = 960;
const H = 380;
const PAD = { top: 10, right: 64, bottom: 26, left: 8 };

function CandleChart({
  candles,
  showSma20,
  showSma50,
  showEma20,
  showBb,
  showVwap,
  drawings,
  pendingPoint,
  drawing,
  onChartClick,
  onHover,
}: {
  candles: Candle[];
  showSma20: boolean;
  showSma50: boolean;
  showEma20: boolean;
  showBb: boolean;
  showVwap: boolean;
  drawings: Drawing[];
  pendingPoint: { t: number; price: number } | null;
  drawing: boolean;
  onChartClick: (t: number, price: number) => void;
  onHover: (candle: Candle | null) => void;
}): React.JSX.Element {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const { min, max } = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const candle of candles) {
      if (candle.l < lo) lo = candle.l;
      if (candle.h > hi) hi = candle.h;
    }
    const pad = (hi - lo) * 0.05 || hi * 0.01 || 1;
    return { min: lo - pad, max: hi + pad };
  }, [candles]);

  const closes = useMemo(() => candles.map((c) => c.c), [candles]);
  const sma20 = useMemo(() => (showSma20 ? sma(closes, 20) : null), [closes, showSma20]);
  const sma50 = useMemo(() => (showSma50 ? sma(closes, 50) : null), [closes, showSma50]);
  const ema20 = useMemo(() => (showEma20 ? ema(closes, 20) : null), [closes, showEma20]);
  const bands = useMemo(() => (showBb ? bollinger(closes, 20, 2) : null), [closes, showBb]);
  const vwapLine = useMemo(() => (showVwap ? vwap(candles) : null), [candles, showVwap]);

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const step = innerW / candles.length;
  const bodyW = Math.max(1, Math.min(14, step * 0.65));
  const y = (value: number): number => PAD.top + ((max - value) / (max - min)) * innerH;
  const x = (i: number): number => PAD.left + i * step + step / 2;

  const line = (values: (number | null)[]): string =>
    values
      .map((value, i) => (value === null ? null : `${x(i)},${y(value)}`))
      .filter((p): p is string => p !== null)
      .join(' ');

  const gridValues = Array.from({ length: 5 }, (_, i) => min + ((max - min) * i) / 4);
  const labelEvery = Math.max(1, Math.ceil(candles.length / 6));

  // Data-coordinate helpers for drawings (t → nearest candle x, price → y).
  const xOfT = (t: number): number => {
    let best = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < candles.length; i++) {
      const diff = Math.abs(candles[i]!.t - t);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = i;
      }
    }
    return x(best);
  };

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={`w-full ${drawing ? 'cursor-crosshair' : ''}`}
      preserveAspectRatio="none"
      onClick={(e) => {
        if (!drawing) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const px = ((e.clientX - rect.left) / rect.width) * W;
        const py = ((e.clientY - rect.top) / rect.height) * H;
        const index = Math.min(candles.length - 1, Math.max(0, Math.floor((px - PAD.left) / step)));
        const price = max - ((py - PAD.top) / innerH) * (max - min);
        onChartClick(candles[index]?.t ?? 0, Number(price.toFixed(4)));
      }}
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const px = ((e.clientX - rect.left) / rect.width) * W;
        const index = Math.min(candles.length - 1, Math.max(0, Math.floor((px - PAD.left) / step)));
        setHoverIndex(index);
        onHover(candles[index] ?? null);
      }}
      onMouseLeave={() => {
        setHoverIndex(null);
        onHover(null);
      }}
    >
      {drawings.map((d) => {
        const color = d.color || '#8b5cf6';
        if (d.type === 'hline' && d.points[0] !== undefined) {
          const yy = y(d.points[0].price);
          return (
            <g key={d.id}>
              <line x1={PAD.left} x2={W - PAD.right} y1={yy} y2={yy} stroke={color} strokeWidth={1.5} strokeDasharray="6 3" />
              <text x={PAD.left + 4} y={yy - 4} fontSize={10} fill={color}>
                {d.points[0].price.toFixed(2)}
              </text>
            </g>
          );
        }
        if (d.type === 'trendline' && d.points.length >= 2) {
          const [a, b] = [d.points[0]!, d.points[1]!];
          return (
            <line
              key={d.id}
              x1={xOfT(a.t)}
              y1={y(a.price)}
              x2={xOfT(b.t)}
              y2={y(b.price)}
              stroke={color}
              strokeWidth={1.5}
            />
          );
        }
        return null;
      })}
      {pendingPoint !== null && (
        <circle cx={xOfT(pendingPoint.t)} cy={y(pendingPoint.price)} r={4} fill="#8b5cf6" />
      )}
      {gridValues.map((value) => (
        <g key={value}>
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(value)}
            y2={y(value)}
            stroke="currentColor"
            strokeOpacity={0.12}
          />
          <text x={W - PAD.right + 6} y={y(value) + 4} fontSize={11} fill="currentColor" fillOpacity={0.6}>
            {value.toFixed(2)}
          </text>
        </g>
      ))}

      {candles.map((candle, i) => {
        const up = candle.c >= candle.o;
        const color = up ? '#16a34a' : '#dc2626';
        const top = y(Math.max(candle.o, candle.c));
        const bottom = y(Math.min(candle.o, candle.c));
        return (
          <g key={candle.t}>
            <line x1={x(i)} x2={x(i)} y1={y(candle.h)} y2={y(candle.l)} stroke={color} strokeWidth={1} />
            <rect
              x={x(i) - bodyW / 2}
              y={top}
              width={bodyW}
              height={Math.max(1, bottom - top)}
              fill={color}
              fillOpacity={up ? 0.85 : 1}
            />
          </g>
        );
      })}

      {sma20 !== null && (
        <polyline points={line(sma20)} fill="none" stroke="#3b82f6" strokeWidth={1.5} />
      )}
      {sma50 !== null && (
        <polyline points={line(sma50)} fill="none" stroke="#f59e0b" strokeWidth={1.5} />
      )}
      {ema20 !== null && (
        <polyline points={line(ema20)} fill="none" stroke="#06b6d4" strokeWidth={1.5} />
      )}
      {vwapLine !== null && (
        <polyline
          points={line(vwapLine)}
          fill="none"
          stroke="#ec4899"
          strokeWidth={1.5}
          strokeDasharray="5 3"
        />
      )}
      {bands !== null && (
        <>
          <polyline points={line(bands.upper)} fill="none" stroke="#94a3b8" strokeWidth={1} />
          <polyline points={line(bands.middle)} fill="none" stroke="#94a3b8" strokeWidth={1} strokeDasharray="3 3" />
          <polyline points={line(bands.lower)} fill="none" stroke="#94a3b8" strokeWidth={1} />
        </>
      )}

      {candles.map((candle, i) =>
        i % labelEvery === 0 ? (
          <text
            key={`label-${candle.t}`}
            x={x(i)}
            y={H - 8}
            fontSize={11}
            textAnchor="middle"
            fill="currentColor"
            fillOpacity={0.6}
          >
            {new Date(candle.t * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </text>
        ) : null,
      )}

      {hoverIndex !== null && (
        <line
          x1={x(hoverIndex)}
          x2={x(hoverIndex)}
          y1={PAD.top}
          y2={H - PAD.bottom}
          stroke="currentColor"
          strokeOpacity={0.35}
          strokeDasharray="3 3"
        />
      )}
    </svg>
  );
}

function RsiChart({ candles }: { candles: Candle[] }): React.JSX.Element {
  const RH = 110;
  const values = useMemo(() => rsi(candles.map((c) => c.c), 14), [candles]);
  const innerW = W - PAD.left - PAD.right;
  const step = innerW / candles.length;
  const x = (i: number): number => PAD.left + i * step + step / 2;
  const y = (value: number): number => 8 + ((100 - value) / 100) * (RH - 24);

  const points = values
    .map((value, i) => (value === null ? null : `${x(i)},${y(value)}`))
    .filter((p): p is string => p !== null)
    .join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${RH}`} className="w-full" preserveAspectRatio="none">
      {[70, 30].map((level) => (
        <g key={level}>
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(level)}
            y2={y(level)}
            stroke="currentColor"
            strokeOpacity={0.2}
            strokeDasharray="4 4"
          />
          <text x={W - PAD.right + 6} y={y(level) + 4} fontSize={10} fill="currentColor" fillOpacity={0.6}>
            {level}
          </text>
        </g>
      ))}
      <polyline points={points} fill="none" stroke="#8b5cf6" strokeWidth={1.5} />
      <text x={PAD.left} y={12} fontSize={10} fill="currentColor" fillOpacity={0.6}>
        RSI 14
      </text>
    </svg>
  );
}

function MacdChart({ candles }: { candles: Candle[] }): React.JSX.Element {
  const MH = 120;
  const { line, signal, hist } = useMemo(() => macd(candles.map((c) => c.c)), [candles]);
  const innerW = W - PAD.left - PAD.right;
  const step = innerW / candles.length;
  const x = (i: number): number => PAD.left + i * step + step / 2;

  const values = [...line, ...signal, ...hist].filter((v): v is number => v !== null);
  const bound = Math.max(0.0001, ...values.map((v) => Math.abs(v)));
  const y = (v: number): number => MH / 2 - (v / bound) * (MH / 2 - 12);

  const points = (series: (number | null)[]): string =>
    series
      .map((v, i) => (v === null ? null : `${x(i)},${y(v)}`))
      .filter((p): p is string => p !== null)
      .join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${MH}`} className="w-full" preserveAspectRatio="none" style={{ maxHeight: 130 }}>
      <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} stroke="currentColor" strokeOpacity={0.2} />
      {hist.map((v, i) =>
        v === null ? null : (
          <rect
            key={candles[i]?.t ?? i}
            x={x(i) - Math.max(1, step * 0.3)}
            y={Math.min(y(0), y(v))}
            width={Math.max(1, step * 0.6)}
            height={Math.max(1, Math.abs(y(v) - y(0)))}
            fill={v >= 0 ? '#16a34a' : '#dc2626'}
            fillOpacity={0.6}
          />
        ),
      )}
      <polyline points={points(line)} fill="none" stroke="#3b82f6" strokeWidth={1.5} />
      <polyline points={points(signal)} fill="none" stroke="#f59e0b" strokeWidth={1.5} />
      <text x={PAD.left} y={12} fontSize={10} fill="currentColor" fillOpacity={0.6}>
        MACD 12/26/9
      </text>
    </svg>
  );
}

function NewsPanel({ symbol }: { symbol: string }): React.JSX.Element {
  const [news, setNews] = useState<NewsItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setNews(null);
    void (async () => {
      try {
        const res = await fetch(`/api/ops/news?symbol=${encodeURIComponent(symbol)}`);
        const data = (await res.json()) as { news?: NewsItem[] };
        if (!cancelled) setNews(data.news ?? []);
      } catch {
        if (!cancelled) setNews([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold opacity-70">News</h3>
      {news === null ? (
        <p className="text-xs opacity-60">Loading news…</p>
      ) : news.length === 0 ? (
        <p className="text-xs opacity-60">No recent headlines.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {news.map((item) => (
            <a
              key={item.link || item.title}
              href={item.link}
              target="_blank"
              rel="noreferrer"
              className="text-sm hover:underline"
            >
              {item.title}{' '}
              <span className="text-xs opacity-50">
                {item.publisher}
                {item.published > 0 && ` · ${new Date(item.published * 1000).toLocaleDateString()}`}
              </span>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
