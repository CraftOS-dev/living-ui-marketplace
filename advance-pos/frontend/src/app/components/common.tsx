/**
 * Small pieces shared by the pages: avatars and color slots, the money
 * field, the date range picker, the search field, stock and sale status
 * badges, and the load-more footer of long lists.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { addDays, dayStart, initials, shortDate, toMinor, ymd } from '../lib/format.ts';
import type { Money } from '../lib/format.ts';
import type { ColorSlot, OrderStatus, ReturnStatus, StockStatus } from '../lib/types.ts';
import { COLOR_SLOTS } from '../lib/types.ts';
import { Badge, Button, Popover, inputCls } from './ui.tsx';

/* ----------------------------------------------------------- color slots */

export function slotOf(color: string | undefined): ColorSlot {
  return (COLOR_SLOTS as string[]).includes(color ?? '') ? (color as ColorSlot) : 'neutral';
}

/** Background and text of a color slot (derived per theme in themeColors.ts). */
export function tile(color: string | undefined): React.CSSProperties {
  const s = slotOf(color);
  return { background: `var(--ps-tile-${s})`, color: `var(--ps-on-tile-${s})` };
}

export function Avatar({ name, color, size = 28, className }: { name: string; color?: string; size?: number; className?: string }): React.JSX.Element {
  return (
    <span aria-hidden style={{ ...tile(color), width: size, height: size, fontSize: size >= 40 ? 15 : 12 }} className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-bold', className)}>
      {initials(name)}
    </span>
  );
}

export function SlotPicker({ value, onChange, label = 'Color' }: { value: string; onChange: (c: ColorSlot) => void; label?: string }): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {COLOR_SLOTS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          title={c[0]?.toUpperCase() + c.slice(1)}
          onClick={() => onChange(c)}
          style={{ background: `var(--ps-tile-${c})` }}
          className={cn('size-7 rounded-full border-2 transition-transform', value === c ? 'border-[var(--ps-ink)]' : 'border-transparent hover:scale-105')}
        >
          <span className="sr-only">{c}</span>
        </button>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- money */

/**
 * A money field: plain major-unit text the operations parse exactly. Shows
 * the currency symbol and refuses text that is not an amount.
 */
export function MoneyField({
  value,
  onChange,
  money,
  label,
  placeholder,
  allowNegative = false,
  autoFocus = false,
  className,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  money: Money;
  label?: string;
  placeholder?: string;
  allowNegative?: boolean;
  autoFocus?: boolean;
  className?: string;
  invalid?: boolean;
}): React.JSX.Element {
  const parsed = value.trim() === '' ? null : toMinor(value, money.digits);
  const bad = invalid === true || (value.trim() !== '' && (parsed === null || (!allowNegative && parsed < 0)));
  return (
    <div className={cn('relative min-w-0', className)}>
      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[12px] font-semibold text-[var(--ps-muted)]">{money.symbol}</span>
      <input
        aria-label={label}
        inputMode="decimal"
        autoFocus={autoFocus}
        value={value}
        placeholder={placeholder ?? money.plain(0)}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={bad}
        style={{ paddingLeft: 8 + money.symbol.length * 8 + 4 }}
        className={cn(inputCls, 'num text-right', bad && 'border-[var(--ps-red)] focus:border-[var(--ps-red)]')}
      />
    </div>
  );
}

/** Whether money field text is a valid amount (empty counts as valid when optional). */
export function moneyOk(text: string, money: Money, opts: { required?: boolean; min?: number; allowNegative?: boolean } = {}): boolean {
  if (text.trim() === '') return opts.required !== true;
  const n = toMinor(text, money.digits);
  if (n === null) return false;
  if (!opts.allowNegative && n < 0) return false;
  if (opts.min !== undefined && n < opts.min) return false;
  return true;
}

/* ---------------------------------------------------------------- search */

export function SearchField({ value, onChange, placeholder, autoFocus = false, className, onEnter, inputRef }: { value: string; onChange: (v: string) => void; placeholder: string; autoFocus?: boolean; className?: string; onEnter?: () => void; inputRef?: React.RefObject<HTMLInputElement | null> }): React.JSX.Element {
  return (
    <div className={cn('relative min-w-0', className)}>
      <Search size={14} aria-hidden className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--ps-muted)]" />
      <input
        ref={inputRef}
        type="search"
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onEnter !== undefined) {
            e.preventDefault();
            onEnter();
          }
          if (e.key === 'Escape' && value !== '') {
            e.stopPropagation();
            onChange('');
          }
        }}
        className={cn(inputCls, 'pl-7 pr-7 [&::-webkit-search-cancel-button]:hidden')}
      />
      {value !== '' && (
        <button type="button" aria-label="Clear search" onClick={() => onChange('')} className="absolute right-1 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-[var(--ps-r-sm)] text-[var(--ps-muted)] hover:bg-[var(--ps-row)] hover:text-[var(--ps-ink)]">
          <X size={13} />
        </button>
      )}
    </div>
  );
}

/** Debounce a value (search boxes). */
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/* ------------------------------------------------------------ date range */

export interface Range {
  from: string;
  to: string;
}

type Preset = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'last_month' | 'year';

const PRESETS: { id: Preset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: 'month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'year', label: 'This year' },
];

export function presetRange(p: Preset): Range {
  const today = dayStart(new Date());
  switch (p) {
    case 'yesterday':
      return { from: ymd(addDays(today, -1)), to: ymd(addDays(today, -1)) };
    case '7d':
      return { from: ymd(addDays(today, -6)), to: ymd(today) };
    case '30d':
      return { from: ymd(addDays(today, -29)), to: ymd(today) };
    case 'month':
      return { from: ymd(new Date(today.getFullYear(), today.getMonth(), 1)), to: ymd(today) };
    case 'last_month':
      return { from: ymd(new Date(today.getFullYear(), today.getMonth() - 1, 1)), to: ymd(new Date(today.getFullYear(), today.getMonth(), 0)) };
    case 'year':
      return { from: ymd(new Date(today.getFullYear(), 0, 1)), to: ymd(today) };
    default:
      return { from: ymd(today), to: ymd(today) };
  }
}

function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function rangeLabel(r: Range): string {
  for (const p of PRESETS) {
    const x = presetRange(p.id);
    if (x.from === r.from && x.to === r.to) return p.label;
  }
  return r.from === r.to ? shortDate(parseYmd(r.from)) : shortDate(parseYmd(r.from)) + ' to ' + shortDate(parseYmd(r.to));
}

/** Move a range by its own length (the arrows beside the picker). */
export function shiftRange(r: Range, dir: -1 | 1): Range {
  const a = parseYmd(r.from);
  const b = parseYmd(r.to);
  const days = Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
  return { from: ymd(addDays(a, dir * days)), to: ymd(addDays(b, dir * days)) };
}

export function DateRange({ value, onChange }: { value: Range; onChange: (r: Range) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(value.from);
  const [to, setTo] = useState(value.to);
  const btn = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    setFrom(value.from);
    setTo(value.to);
  }, [value.from, value.to]);
  const future = parseYmd(value.to).getTime() >= dayStart(new Date()).getTime();
  return (
    <div className="relative inline-flex items-center gap-1">
      <button type="button" aria-label="Earlier" title="Earlier" onClick={() => onChange(shiftRange(value, -1))} className="flex size-7 items-center justify-center rounded-[var(--ps-r)] border border-[var(--ps-line)] bg-[var(--ps-card)] text-[var(--ps-ink-2)] hover:bg-[var(--ps-row)]">
        <ChevronLeft size={14} />
      </button>
      <button ref={btn} type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="inline-flex h-7 items-center gap-1.5 rounded-[var(--ps-r)] border border-[var(--ps-line)] bg-[var(--ps-card)] px-2.5 text-[13px] font-semibold hover:bg-[var(--ps-row)]">
        <CalendarDays size={14} className="text-[var(--ps-ink-2)]" />
        {rangeLabel(value)}
      </button>
      <button type="button" aria-label="Later" title="Later" disabled={future} onClick={() => onChange(shiftRange(value, 1))} className="flex size-7 items-center justify-center rounded-[var(--ps-r)] border border-[var(--ps-line)] bg-[var(--ps-card)] text-[var(--ps-ink-2)] hover:bg-[var(--ps-row)] disabled:opacity-40">
        <ChevronRight size={14} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} keep={btn} className="left-8 w-64 p-2">
        <div className="grid grid-cols-2 gap-1">
          {PRESETS.map((p) => {
            const x = presetRange(p.id);
            const on = x.from === value.from && x.to === value.to;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  onChange(x);
                  setOpen(false);
                }}
                className={cn('h-7 rounded-[var(--ps-r-sm)] px-2 text-left text-[12px] font-semibold', on ? 'bg-[var(--ps-ink)] text-[var(--ps-shell)]' : 'hover:bg-[var(--ps-row)]')}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 border-t border-[var(--ps-hair)] pt-2">
          <label className="flex flex-col gap-1 text-[12px] font-semibold text-[var(--ps-ink-2)]">
            From
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-semibold text-[var(--ps-ink-2)]">
            To
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={inputCls} />
          </label>
        </div>
        <Button
          variant="primary"
          size="md"
          className="mt-2 w-full"
          disabled={from === '' || to === '' || from > to}
          onClick={() => {
            onChange({ from, to });
            setOpen(false);
          }}
        >
          Show these days
        </Button>
      </Popover>
    </div>
  );
}

/* --------------------------------------------------------------- badges */

export function StockBadge({ status, stock, unit }: { status: StockStatus; stock?: number; unit?: string }): React.JSX.Element | null {
  if (status === 'untracked') return null;
  const n = stock !== undefined ? String(Math.round(stock * 1000) / 1000) + (unit ? ' ' + unit : '') : '';
  if (status === 'out') return <Badge tone="bad">{stock !== undefined && stock < 0 ? n : 'Out of stock'}</Badge>;
  if (status === 'low') return <Badge tone="warn">{n !== '' ? n + ' left' : 'Low'}</Badge>;
  return <Badge tone="neutral">{n !== '' ? n + ' in stock' : 'In stock'}</Badge>;
}

export function OrderBadge({ status, returnStatus }: { status: OrderStatus; returnStatus?: ReturnStatus }): React.JSX.Element {
  if (status === 'void') return <Badge tone="neutral">Voided</Badge>;
  if (status === 'open') return <Badge tone="warn">Open</Badge>;
  if (returnStatus === 'full') return <Badge tone="bad">Returned</Badge>;
  if (returnStatus === 'partial') return <Badge tone="warn">Part returned</Badge>;
  return <Badge tone="good">Paid</Badge>;
}

/* ----------------------------------------------------------------- lists */

export function LoadMore({ more, onMore, loading }: { more: boolean; onMore: () => void; loading?: boolean }): React.JSX.Element | null {
  if (!more) return null;
  return (
    <div className="flex justify-center border-t border-[var(--ps-hair)] py-2">
      <Button size="sm" variant="ghost" loading={loading} onClick={onMore}>
        Show more
      </Button>
    </div>
  );
}

/** A number in the header of a page section: a label, a big value and a note. */
export function Kpi({ label, value, note, tone = 'white', className }: { label: string; value: ReactNode; note?: ReactNode; tone?: 'white' | 'sand' | 'dark'; className?: string }): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col justify-between rounded-[var(--ps-r-md)] border px-3 py-2.5',
        tone === 'white' && 'border-[var(--ps-line)] bg-[var(--ps-card)]',
        tone === 'sand' && 'ps-on-sand border-transparent bg-[var(--ps-sand)]',
        tone === 'dark' && 'ps-on-dark border-transparent bg-[var(--ps-dark)] text-[var(--ps-on-dark)]',
        className,
      )}
    >
      <span className={cn('truncate text-[12px] font-semibold', tone === 'dark' ? 'text-[var(--ps-on-dark-muted)]' : 'text-[var(--ps-muted)]')}>{label}</span>
      <span className="num mt-1 truncate text-[26px] font-bold leading-8 tracking-tight">{value}</span>
      {note !== undefined && <span className={cn('mt-0.5 truncate text-[12px]', tone === 'dark' ? 'text-[var(--ps-on-dark-muted)]' : 'text-[var(--ps-muted)]')}>{note}</span>}
    </div>
  );
}

/** A change against the previous period: "+12%" in green, "-8%" in red. */
export function Delta({ now, before }: { now: number; before: number }): React.JSX.Element | null {
  if (before === 0) return null;
  const pct = ((now - before) / Math.abs(before)) * 100;
  const up = pct >= 0;
  return <span className={cn('num font-semibold', up ? 'text-[var(--ps-green-text)]' : 'text-[var(--ps-red-text)]')}>{(up ? '+' : '−') + Math.abs(Math.round(pct)) + '%'}</span>;
}
