/**
 * Symbol search: a dialog near the top with live results from Yahoo Finance
 * and Binance, each with its quote. Arrow keys move, Enter picks; the typed
 * text itself is accepted as a ticker when nothing matches.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Search } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { price, short } from '../lib/format.ts';
import { useQuotes } from '../lib/live.ts';
import type { SearchResult } from '../lib/types.ts';
import { Change, Modal, Spinner } from './ui.tsx';

const SUGGESTED: SearchResult[] = [
  { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', type: 'Equity', provider: 'yahoo' },
  { symbol: 'NVDA', name: 'NVIDIA Corporation', exchange: 'NASDAQ', type: 'Equity', provider: 'yahoo' },
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF', exchange: 'NYSE Arca', type: 'ETF', provider: 'yahoo' },
  { symbol: '^GSPC', name: 'S&P 500', exchange: 'Index', type: 'Index', provider: 'yahoo' },
  { symbol: 'EURUSD=X', name: 'EUR / USD', exchange: 'FX', type: 'Currency', provider: 'yahoo' },
  { symbol: 'GC=F', name: 'Gold futures', exchange: 'COMEX', type: 'Futures', provider: 'yahoo' },
  { symbol: 'BINANCE:BTCUSDT', name: 'BTC / USDT', exchange: 'Binance', type: 'Crypto', provider: 'binance' },
  { symbol: 'BINANCE:ETHUSDT', name: 'ETH / USDT', exchange: 'Binance', type: 'Crypto', provider: 'binance' },
];

export function SymbolResults({ query, onPick, active, setActive, onResults, limit = 12 }: { query: string; onPick: (s: string) => void; active: number; setActive: (i: number) => void; onResults?: (r: SearchResult[]) => void; limit?: number }): React.JSX.Element {
  const [results, setResults] = useState<SearchResult[]>(SUGGESTED);
  const [loading, setLoading] = useState(false);
  const onResultsRef = useRef(onResults);
  onResultsRef.current = onResults;
  useEffect(() => {
    const q = query.trim();
    if (q === '') {
      setResults(SUGGESTED);
      onResultsRef.current?.(SUGGESTED);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      api
        .search(q, 12)
        .then((r) => {
          if (cancelled) return;
          setResults(r.results);
          onResultsRef.current?.(r.results);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);
  const quotes = useQuotes(results.slice(0, 10).map((r) => r.symbol));
  return (
    <div role="listbox" className="flex flex-col">
      {loading && results.length === 0 && (
        <div className="flex items-center gap-2 px-3 py-3 text-[12px] text-[var(--tv-muted)]">
          <Spinner size={12} /> Searching
        </div>
      )}
      {!loading && results.length === 0 && <div className="px-3 py-3 text-[12px] text-[var(--tv-muted)]">Nothing found. Press Enter to open "{query.trim().toUpperCase()}" as a ticker.</div>}
      {results.slice(0, limit).map((r, i) => {
        const q = quotes[r.symbol];
        return (
          <button
            key={r.symbol}
            type="button"
            role="option"
            aria-selected={i === active}
            onMouseEnter={() => setActive(i)}
            onClick={() => onPick(r.symbol)}
            className={cn('grid h-9 w-full grid-cols-[minmax(84px,auto)_1fr_auto_64px] items-center gap-3 px-3 text-left', i === active && 'bg-[var(--tv-row)]')}
          >
            <span className="truncate text-[12.5px] font-bold">{short(r.symbol)}</span>
            <span className="min-w-0 truncate text-[12px] text-[var(--tv-ink-2)]">
              {r.name}
              <span className="ml-2 text-[11px] text-[var(--tv-muted)]">
                {r.exchange}
                {r.type !== '' ? ' · ' + r.type : ''}
              </span>
            </span>
            <span className="num text-right text-[12px] font-semibold">{q?.price !== undefined && q.price !== null ? price(q.price, q.price_hint) : ''}</span>
            <span className="text-right text-[12px]">{q !== undefined ? <Change value={q.change_pct} /> : ''}</span>
          </button>
        );
      })}
    </div>
  );
}

/** `const [el, open] = useSymbolSearch()`; render el; `open('A', pick, 'Compare with')`. */
export function useSymbolSearch(): [ReactNode, (initial: string, onPick: (s: string) => void, title?: string) => void] {
  const [state, setState] = useState<{ q: string; onPick: (s: string) => void; title: string } | null>(null);
  const [active, setActive] = useState(0);
  const results = useRef<SearchResult[]>(SUGGESTED);
  const open = useCallback((initial: string, onPick: (s: string) => void, title = 'Symbol search') => {
    setActive(0);
    setState({ q: initial, onPick, title });
  }, []);
  const close = (): void => setState(null);
  const pick = (s: string): void => {
    const cb = state?.onPick;
    close();
    cb?.(s);
  };
  const el =
    state === null ? null : (
      <Modal open top bare width="lg" title={state.title} onClose={close}>
        <div className="flex items-center gap-2 border-b border-[var(--tv-hair)] px-3">
          <Search size={15} className="text-[var(--tv-muted)]" aria-hidden />
          <input
            autoFocus
            value={state.q}
            onChange={(e) => {
              setActive(0);
              setState({ ...state, q: e.target.value });
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, results.current.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                const r = results.current[active];
                if (r !== undefined && state.q.trim() !== '') pick(r.symbol);
                else if (state.q.trim() !== '') pick(state.q.trim().toUpperCase());
                else if (r !== undefined) pick(r.symbol);
              }
            }}
            placeholder={state.title + ': ticker, company, coin'}
            aria-label={state.title}
            className="h-11 min-w-0 flex-1 bg-transparent text-[14px] font-semibold outline-none"
          />
          <span className="text-[11px] font-semibold text-[var(--tv-muted)]">Stocks, ETFs, indices, FX, futures, crypto</span>
        </div>
        <div className="max-h-[60vh] overflow-y-auto py-1">
          <SymbolResults query={state.q} onPick={pick} active={active} setActive={setActive} onResults={(r) => (results.current = r)} />
        </div>
      </Modal>
    );
  return [el, open];
}
