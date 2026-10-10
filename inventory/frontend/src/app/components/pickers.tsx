/**
 * Pickers: find an item (type, or scan with a keyboard scanner) and choose a
 * location from the tree.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, MapPin, PackageSearch, ScanBarcode } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import type { FlatLocation } from '../lib/context.tsx';
import { qty } from '../lib/format.ts';
import { ItemThumb, kindIcon } from '../lib/icons.tsx';
import { useScanner } from '../lib/scanner.ts';
import type { Item } from '../lib/types.ts';
import { SearchBox, StatusBadge } from './controls.tsx';
import { Popover } from './ui.tsx';

/* ------------------------------------------------------------- items */

/**
 * Search items and pick one. A scanned or typed exact code (SKU, barcode)
 * picks its item at once; `onLocationCode` receives scanned location codes.
 */
export function ItemSearch({
  onPick,
  onLocationCode,
  onUnknownCode,
  exclude = [],
  selected = [],
  autoFocus = false,
  scanning = true,
  limit = 8,
  className,
  emptyHint,
}: {
  onPick: (item: Item) => void;
  onLocationCode?: (location: { id: string; name: string; path: string }) => void;
  onUnknownCode?: (code: string) => void;
  exclude?: string[];
  selected?: string[];
  autoFocus?: boolean;
  scanning?: boolean;
  limit?: number;
  className?: string;
  emptyHint?: string;
}): React.JSX.Element {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Item[] | null>(null);
  const [miss, setMiss] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 180);
    return () => clearTimeout(t);
  }, [text]);

  useEffect(() => {
    const mine = ++seq.current;
    api
      .items(q === '' ? { sort: 'updated', desc: true, limit: limit + exclude.length } : { q, limit: limit + exclude.length })
      .then((r) => {
        if (mine === seq.current) setResults(r.items.filter((i) => !exclude.includes(i.id)).slice(0, limit));
      })
      .catch(() => {
        if (mine === seq.current) setResults([]);
      });
    // exclude is compared by content
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, limit, exclude.join(',')]);

  const lookup = async (code: string): Promise<void> => {
    if (code === '') return;
    setMiss(null);
    try {
      const hit = await api.lookup(code);
      if (hit.type === 'item') {
        setText('');
        onPick(hit.item);
      } else if (hit.type === 'location') {
        if (onLocationCode !== undefined) {
          setText('');
          onLocationCode(hit.location);
        } else setMiss(`"${code}" is the location ${hit.location.path}`);
      } else if (onUnknownCode !== undefined) onUnknownCode(code);
      else setMiss(`Nothing has the code "${code}"`);
    } catch {
      /* toasted */
    }
  };

  useScanner((code) => void lookup(code), scanning);

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <SearchBox
        value={text}
        onChange={(v) => {
          setText(v);
          setMiss(null);
        }}
        onEnter={(v) => {
          // An exact code (typed, or scanned into the box) picks at once; otherwise the first result.
          const exact = results?.find((r) => r.sku.toLowerCase() === v.toLowerCase());
          if (exact !== undefined) {
            setText('');
            onPick(exact);
          } else void lookup(v);
        }}
        placeholder="Search by name, SKU or barcode"
        ariaLabel="Search items"
        autoFocus={autoFocus}
        soft
      />
      {miss !== null && <p className="iv-shake px-1 text-[13px] font-semibold text-[var(--iv-red-text)]">{miss}</p>}
      {results === null ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }, (_, i) => (
            <span key={i} className="h-14 animate-pulse rounded-[18px] bg-[var(--iv-row)]" />
          ))}
        </div>
      ) : results.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-[20px] bg-[var(--iv-row)] px-4 py-6 text-center">
          <PackageSearch size={20} className="text-[var(--iv-muted)]" aria-hidden />
          <p className="text-[13px] text-[var(--iv-ink-2)]">{q === '' ? (emptyHint ?? 'No items yet') : `Nothing matches "${q}"`}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {q === '' && <li className="px-1 text-[12px] font-semibold text-[var(--iv-muted)]">Recently changed</li>}
          {results.map((it) => {
            const on = selected.includes(it.id);
            return (
              <li key={it.id}>
                <button
                  type="button"
                  onClick={() => onPick(it)}
                  aria-pressed={selected.length > 0 ? on : undefined}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-[18px] px-2.5 py-2 text-left transition-colors',
                    on ? 'iv-on-ink bg-[var(--iv-ink)] text-[var(--iv-shell)]' : 'bg-[var(--iv-row)] hover:bg-[var(--iv-row-hover)]',
                  )}
                >
                  <ItemThumb photo={it.photo} icon={it.icon} size={40} tone="card" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-bold">{it.name}</span>
                    <span className={cn('block truncate text-[12px]', on ? 'opacity-80' : 'text-[var(--iv-muted)]')}>
                      {it.sku} · {qty(it.on_hand)} {it.unit}
                    </span>
                  </span>
                  {on ? (
                    <span className="flex size-7 items-center justify-center rounded-full bg-[var(--iv-accent)] text-[var(--iv-on-accent)]">
                      <Check size={14} strokeWidth={3} />
                    </span>
                  ) : (
                    it.status !== 'ok' && <StatusBadge status={it.status} />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {scanning && (
        <p className="flex items-center gap-2 px-1 text-[12px] text-[var(--iv-muted)]">
          <ScanBarcode size={14} aria-hidden /> A barcode scanner works here too
        </p>
      )}
    </div>
  );
}

/* --------------------------------------------------------- locations */

/** The locations as an indented list to choose from. */
export function LocationList({
  value,
  onPick,
  only,
  allowNone,
  noneLabel = 'Everywhere',
  className,
}: {
  value: string;
  onPick: (loc: FlatLocation | null) => void;
  only?: string[];
  allowNone?: boolean;
  noneLabel?: string;
  className?: string;
}): React.JSX.Element {
  const { locations } = useApp();
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return locations.filter((l) => (only === undefined || only.includes(l.id)) && (ql === '' || l.path.toLowerCase().includes(ql) || l.code.toLowerCase().includes(ql)));
  }, [locations, q, only]);
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {locations.length > 7 && <SearchBox value={q} onChange={setQ} placeholder="Find a place" ariaLabel="Find a location" soft />}
      <ul className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
        {allowNone === true && q === '' && (
          <li>
            <button
              type="button"
              onClick={() => onPick(null)}
              className={cn('flex w-full items-center gap-3 rounded-full px-3 py-2 text-left text-[14px] font-semibold hover:bg-[var(--iv-row)]', value === '' && 'bg-[var(--iv-row)]')}
            >
              <MapPin size={16} className="text-[var(--iv-muted)]" aria-hidden />
              <span className="flex-1">{noneLabel}</span>
              {value === '' && <Check size={15} aria-hidden />}
            </button>
          </li>
        )}
        {shown.map((l) => {
          const Icon = kindIcon(l.kind);
          const on = l.id === value;
          return (
            <li key={l.id}>
              <button
                type="button"
                onClick={() => onPick(l)}
                title={l.path}
                className={cn('flex w-full items-center gap-3 rounded-full py-2 pr-3 text-left text-[14px] font-semibold hover:bg-[var(--iv-row)]', on && 'bg-[var(--iv-row)]')}
                style={{ paddingLeft: 12 + (q === '' ? l.depth * 16 : 0) }}
              >
                <Icon size={16} className="shrink-0 text-[var(--iv-ink-2)]" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{q === '' ? l.name : l.path}</span>
                <span className="text-[12px] font-medium text-[var(--iv-muted)]">{l.code}</span>
                {on && <Check size={15} aria-hidden />}
              </button>
            </li>
          );
        })}
        {shown.length === 0 && <li className="px-3 py-3 text-[13px] text-[var(--iv-muted)]">No location matches</li>}
      </ul>
    </div>
  );
}

/** A pill showing the chosen location; opens the list. */
export function LocationSelect({
  value,
  onChange,
  placeholder = 'Choose a location',
  allowNone = false,
  noneLabel = 'Everywhere',
  only,
  className,
  soft = false,
  ariaLabel = 'Location',
  align = 'left',
}: {
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  allowNone?: boolean;
  noneLabel?: string;
  only?: string[];
  className?: string;
  soft?: boolean;
  ariaLabel?: string;
  align?: 'left' | 'right';
}): React.JSX.Element {
  const { locationById } = useApp();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement | null>(null);
  const loc = value !== '' ? locationById.get(value) : undefined;
  const Icon = kindIcon(loc?.kind);
  return (
    <div className={cn('relative', className)}>
      <button
        ref={btn}
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex h-11 w-full items-center gap-2.5 rounded-full px-4 text-left text-[14px] font-medium outline-none ring-[var(--iv-ink)] transition-shadow focus-visible:ring-2',
          soft ? 'bg-[var(--iv-row)]' : 'bg-[var(--iv-card)]',
        )}
      >
        <Icon size={16} className="shrink-0 text-[var(--iv-ink-2)]" aria-hidden />
        <span className={cn('min-w-0 flex-1 truncate', loc === undefined && value === '' && !allowNone && 'text-[var(--iv-muted)]')}>
          {loc !== undefined ? loc.path : allowNone ? noneLabel : placeholder}
        </span>
        <ChevronDown size={16} className="shrink-0 text-[var(--iv-muted)]" aria-hidden />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} keep={btn} align={align} className="w-[min(320px,calc(100vw-48px))]">
        <LocationList
          value={value}
          allowNone={allowNone}
          noneLabel={noneLabel}
          {...(only !== undefined ? { only } : {})}
          onPick={(l) => {
            onChange(l === null ? '' : l.id);
            setOpen(false);
          }}
        />
      </Popover>
    </div>
  );
}
