/**
 * Trading View — live watchlist and candlestick charts.
 * Market data comes from the app's own Yahoo Finance proxy ops
 * (/api/ops/quotes, /api/ops/candles); only the watchlist is stored.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RecordModel } from 'pocketbase';
import {
  Badge,
  Button,
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

interface Quote {
  symbol: string;
  name?: string;
  price?: number;
  previousClose?: number;
  currency?: string;
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

const RANGES: { key: string; label: string; range: string; interval: string }[] = [
  { key: '1D', label: '1D', range: '1d', interval: '5m' },
  { key: '5D', label: '5D', range: '5d', interval: '30m' },
  { key: '1M', label: '1M', range: '1mo', interval: '1d' },
  { key: '6M', label: '6M', range: '6mo', interval: '1d' },
  { key: '1Y', label: '1Y', range: '1y', interval: '1d' },
  { key: '5Y', label: '5Y', range: '5y', interval: '1wk' },
];

function fmtPrice(value: number | undefined, currency: string | undefined): string {
  if (value === undefined) return '—';
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })} ${currency ?? ''}`.trim();
}

function changeOf(quote: Quote): { abs: number; pct: number } | null {
  if (quote.price === undefined || quote.previousClose === undefined || quote.previousClose === 0) {
    return null;
  }
  const abs = quote.price - quote.previousClose;
  return { abs, pct: (abs / quote.previousClose) * 100 };
}

export function App(): React.JSX.Element {
  const { records: watchlist } = useCollection<WatchItem>('watchlist', { sort: 'position' });
  const [quotes, setQuotes] = useState<Map<string, Quote>>(new Map());
  const [selected, setSelected] = useState<string | null>(null);
  const [newSymbol, setNewSymbol] = useState('');

  const symbol = selected ?? watchlist[0]?.symbol ?? null;

  const refreshQuotes = useCallback(async (): Promise<void> => {
    if (watchlist.length === 0) return;
    try {
      const symbols = watchlist.map((w) => w.symbol).join(',');
      const res = await fetch(`/api/ops/quotes?symbols=${encodeURIComponent(symbols)}`);
      if (!res.ok) return;
      const data = (await res.json()) as { quotes: Quote[] };
      setQuotes(new Map(data.quotes.map((q) => [q.symbol, q])));
    } catch {
      /* transient network failures: keep last quotes */
    }
  }, [watchlist]);

  useEffect(() => {
    void refreshQuotes();
    const timer = setInterval(() => void refreshQuotes(), 60_000);
    return () => clearInterval(timer);
  }, [refreshQuotes]);

  const addSymbol = async (): Promise<void> => {
    const sym = newSymbol.trim().toUpperCase();
    if (sym === '') return;
    if (watchlist.some((w) => w.symbol === sym)) {
      toast.error(`${sym} is already on the watchlist`);
      return;
    }
    try {
      const res = await fetch(`/api/ops/quotes?symbols=${encodeURIComponent(sym)}`);
      const data = (await res.json()) as { quotes?: Quote[] };
      const quote = data.quotes?.[0];
      if (quote === undefined || quote.error !== undefined || quote.price === undefined) {
        toast.error(`No market data for "${sym}"`);
        return;
      }
      const position = Math.max(0, ...watchlist.map((w) => w.position + 1));
      await getPbClient().call((pb) =>
        pb.collection('watchlist').create({ symbol: sym, name: quote.name ?? sym, position }),
      );
      setQuotes((prev) => new Map(prev).set(sym, quote));
      setSelected(sym);
      setNewSymbol('');
      toast.success(`${sym} added`);
    } catch {
      /* surfaced by shell */
    }
  };

  const removeSymbol = async (item: WatchItem): Promise<void> => {
    try {
      await getPbClient().call((pb) => pb.collection('watchlist').delete(item.id));
      if (selected === item.symbol) setSelected(null);
    } catch {
      /* surfaced by shell */
    }
  };

  return (
    <div className="flex h-screen">
      <aside className="flex w-72 shrink-0 flex-col border-r">
        <div className="border-b px-3 py-3">
          <h1 className="mb-2 text-lg font-semibold">Trading View</h1>
          <Input
            value={newSymbol}
            placeholder="+ Add symbol (e.g. AMZN)"
            onChange={(e) => setNewSymbol(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addSymbol();
            }}
          />
        </div>
        <div className="flex-1 overflow-y-auto">
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
                  <p className="tabular-nums">{quote?.price !== undefined ? quote.price.toFixed(2) : '…'}</p>
                  {change !== null && (
                    <p className={`text-xs tabular-nums ${change.abs >= 0 ? 'text-green-600' : 'text-red-500'}`}>
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
            <p className="p-4 text-sm opacity-60">Add a symbol to get started.</p>
          )}
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-4">
        {symbol === null ? (
          <p className="text-sm opacity-60">Select a symbol.</p>
        ) : (
          <ChartPanel key={symbol} symbol={symbol} quote={quotes.get(symbol)} />
        )}
      </main>
    </div>
  );
}

function ChartPanel({ symbol, quote }: { symbol: string; quote: Quote | undefined }): React.JSX.Element {
  const [rangeKey, setRangeKey] = useState('6M');
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<Candle | null>(null);

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
    <div className="flex h-full flex-col gap-3">
      <header className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-2xl font-semibold">{symbol}</h2>
        <span className="text-2xl tabular-nums">{fmtPrice(quote?.price, quote?.currency)}</span>
        {change !== null && (
          <Badge variant={change.abs >= 0 ? 'default' : 'destructive'}>
            {change.abs >= 0 ? '▲' : '▼'} {change.abs >= 0 ? '+' : ''}
            {change.abs.toFixed(2)} ({change.pct.toFixed(2)}%)
          </Badge>
        )}
        {quote?.name !== undefined && <span className="text-sm opacity-60">{quote.name}</span>}
      </header>

      <div className="flex gap-1">
        {RANGES.map((r) => (
          <Button
            key={r.key}
            size="sm"
            variant={r.key === rangeKey ? 'default' : 'outline'}
            onClick={() => setRangeKey(r.key)}
          >
            {r.label}
          </Button>
        ))}
      </div>

      <div className="h-8 text-xs tabular-nums opacity-70">
        {hovered !== null && (
          <>
            {new Date(hovered.t * 1000).toLocaleString()} · O {hovered.o.toFixed(2)} · H{' '}
            {hovered.h.toFixed(2)} · L {hovered.l.toFixed(2)} · C {hovered.c.toFixed(2)} · Vol{' '}
            {hovered.v.toLocaleString()}
          </>
        )}
      </div>

      <div className="min-h-0 flex-1">
        {error !== null ? (
          <p className="text-sm text-red-500">{error}</p>
        ) : candles === null ? (
          <p className="text-sm opacity-60">Loading candles…</p>
        ) : candles.length === 0 ? (
          <p className="text-sm opacity-60">No data for this range.</p>
        ) : (
          <CandleChart candles={candles} onHover={setHovered} />
        )}
      </div>
    </div>
  );
}

const W = 960;
const H = 420;
const PAD = { top: 10, right: 64, bottom: 26, left: 8 };

function CandleChart({
  candles,
  onHover,
}: {
  candles: Candle[];
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

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const step = innerW / candles.length;
  const bodyW = Math.max(1, Math.min(14, step * 0.65));
  const y = (value: number): number => PAD.top + ((max - value) / (max - min)) * innerH;
  const x = (i: number): number => PAD.left + i * step + step / 2;

  const gridLines = 4;
  const gridValues = Array.from(
    { length: gridLines + 1 },
    (_, i) => min + ((max - min) * i) / gridLines,
  );

  const labelEvery = Math.max(1, Math.ceil(candles.length / 6));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-full w-full"
      preserveAspectRatio="none"
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const px = ((e.clientX - rect.left) / rect.width) * W;
        const index = Math.min(
          candles.length - 1,
          Math.max(0, Math.floor((px - PAD.left) / step)),
        );
        setHoverIndex(index);
        onHover(candles[index] ?? null);
      }}
      onMouseLeave={() => {
        setHoverIndex(null);
        onHover(null);
      }}
    >
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
          <text
            x={W - PAD.right + 6}
            y={y(value) + 4}
            fontSize={11}
            fill="currentColor"
            fillOpacity={0.6}
          >
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
            {new Date(candle.t * 1000).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
            })}
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
