/**
 * Inventory-specific controls on top of the visual system: filter chips with
 * counts, a segmented switch, a search pill, a quantity stepper, the stock
 * level bar, item status pills, a small menu and a progress ring.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Minus, MoreHorizontal, Plus, Search, X } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { normalizeNumber } from '../lib/format.ts';
import type { Status } from '../lib/types.ts';
import { Popover, StatusPill, pillInput } from './ui.tsx';
import type { Tone } from './ui.tsx';

/* ------------------------------------------------------------ chips */

export interface ChipOption<T extends string> {
  value: T;
  label: string;
  count?: number;
  icon?: LucideIcon;
}

/** One-of-many filter as a row of pills; the current one is ink. */
export function Chips<T extends string>({
  value,
  onChange,
  options,
  className,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: ChipOption<T>[];
  className?: string;
  ariaLabel: string;
}): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn('flex flex-wrap items-center gap-2', className)}>
      {options.map((o) => {
        const on = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex h-9 items-center gap-2 rounded-full px-4 text-[13px] font-semibold transition-colors',
              on ? 'iv-on-ink bg-[var(--iv-ink)] text-[var(--iv-shell)]' : 'bg-[var(--iv-card)] text-[var(--iv-ink-2)] hover:bg-[var(--iv-row)] hover:text-[var(--iv-ink)]',
            )}
          >
            {Icon !== undefined && <Icon size={14} aria-hidden />}
            {o.label}
            {o.count !== undefined && (
              <span
                className={cn(
                  'num min-w-5 rounded-full px-1.5 text-center text-[12px] font-bold',
                  on ? 'bg-[var(--iv-accent)] text-[var(--iv-on-accent)]' : 'bg-[var(--iv-row)] text-[var(--iv-ink-2)]',
                )}
              >
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** A two-to-five way switch in one pill (on cards). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  className,
  dark = false,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: LucideIcon }[];
  ariaLabel: string;
  className?: string;
  dark?: boolean;
}): React.JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('inline-flex h-11 items-center gap-1 rounded-full p-1', dark ? 'bg-[var(--iv-dark-2)]' : 'bg-[var(--iv-row)]', className)}
    >
      {options.map((o) => {
        const on = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[13px] font-semibold transition-colors sm:px-3.5',
              on
                ? dark
                  ? 'bg-[var(--iv-accent)] text-[var(--iv-on-accent)]'
                  : 'iv-on-ink bg-[var(--iv-ink)] text-[var(--iv-shell)]'
                : dark
                  ? 'text-[var(--iv-on-dark-muted)] hover:text-[var(--iv-on-dark)]'
                  : 'text-[var(--iv-ink-2)] hover:text-[var(--iv-ink)]',
            )}
          >
            {Icon !== undefined && <Icon size={15} aria-hidden className="hidden shrink-0 min-[400px]:block" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------ search */

/** A search pill. Enter calls onEnter (e.g. a scanned code typed into it). */
export function SearchBox({
  value,
  onChange,
  onEnter,
  placeholder,
  ariaLabel,
  className,
  autoFocus = false,
  soft = false,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  onEnter?: (v: string) => void;
  placeholder: string;
  ariaLabel: string;
  className?: string;
  autoFocus?: boolean;
  soft?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}): React.JSX.Element {
  return (
    <label className={cn('relative block min-w-0', className)}>
      <Search size={16} aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--iv-muted)]" />
      <input
        ref={inputRef}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onEnter !== undefined) {
            e.preventDefault();
            onEnter(value.trim());
          }
          if (e.key === 'Escape' && value !== '') {
            e.stopPropagation();
            onChange('');
          }
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={cn(pillInput, soft && 'bg-[var(--iv-row)]', 'pl-11 pr-11')}
      />
      {value !== '' && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full hover:bg-[var(--iv-row)]"
        >
          <X size={14} />
        </button>
      )}
    </label>
  );
}

/* ----------------------------------------------------------- stepper */

/**
 * A quantity with minus and plus around a typed field. The field accepts
 * "1,234.5"; whole-unit items step and accept whole numbers only.
 */
export function Stepper({
  value,
  onChange,
  fractional = false,
  min = 0,
  ariaLabel,
  size = 'md',
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  fractional?: boolean;
  min?: number;
  ariaLabel: string;
  size?: 'sm' | 'md';
  className?: string;
}): React.JSX.Element {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const n = Number(value) || 0;
  const step = (d: number): void => {
    const next = Math.max(min, Math.round((n + d) * 1000) / 1000);
    onChange(String(next));
  };
  const commit = (t: string): void => {
    const norm = normalizeNumber(t, fractional ? 3 : 0);
    if (norm === null || Number(norm) < min) {
      setText(value);
      return;
    }
    onChange(norm);
  };
  const h = size === 'sm' ? 'h-9' : 'h-11';
  const btn = size === 'sm' ? 'size-7' : 'size-9';
  return (
    <div className={cn('inline-flex items-center gap-1 rounded-full bg-[var(--iv-row)] p-1', h, className)}>
      <button type="button" aria-label={`Less ${ariaLabel}`} disabled={n <= min} onClick={() => step(-1)} className={cn('flex shrink-0 items-center justify-center rounded-full bg-[var(--iv-card)] transition-transform active:scale-90 disabled:opacity-40', btn)}>
        <Minus size={14} strokeWidth={2.4} />
      </button>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit((e.target as HTMLInputElement).value);
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            step(1);
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            step(-1);
          }
        }}
        inputMode={fractional ? 'decimal' : 'numeric'}
        aria-label={ariaLabel}
        className={cn('num w-14 min-w-0 bg-transparent text-center font-bold outline-none', size === 'sm' ? 'text-[13px]' : 'text-[14px]')}
      />
      <button type="button" aria-label={`More ${ariaLabel}`} onClick={() => step(1)} className={cn('flex shrink-0 items-center justify-center rounded-full bg-[var(--iv-card)] transition-transform active:scale-90', btn)}>
        <Plus size={14} strokeWidth={2.4} />
      </button>
    </div>
  );
}

/* -------------------------------------------------------- stock level */

/**
 * On hand against the item's levels: the bar fills to the quantity, a tick
 * marks the reorder point. Out and low wear their state colors.
 */
export function LevelBar({
  onHand,
  min,
  max,
  status,
  className,
  dark = false,
}: {
  onHand: number;
  min: number;
  max: number;
  status: Status;
  className?: string;
  dark?: boolean;
}): React.JSX.Element {
  const top = Math.max(max > 0 ? max : 0, min > 0 ? min * 2 : 0, onHand, 1);
  const fill = Math.max(0, Math.min(1, onHand / top));
  const tick = min > 0 ? Math.min(1, min / top) : null;
  return (
    <span className={cn('relative block h-2 w-full overflow-visible rounded-full', dark ? 'bg-[var(--iv-dark-2)]' : 'bg-[var(--iv-line)]', className)} aria-hidden>
      <span
        className={cn(
          'absolute inset-y-0 left-0 rounded-full transition-[width] duration-500',
          status === 'out' && 'bg-[var(--iv-red)]',
          status === 'low' && 'bg-[var(--iv-amber)]',
          (status === 'ok' || status === 'archived') && (dark ? 'bg-[var(--iv-on-dark)]' : 'bg-[var(--iv-ink)]'),
          status === 'over' && (dark ? 'bg-[var(--iv-on-dark-muted)]' : 'bg-[var(--iv-ink-2)]'),
        )}
        style={{ width: `${Math.max(fill * 100, onHand > 0 ? 4 : 0)}%` }}
      />
      {tick !== null && (
        <span
          className={cn('absolute -top-1 h-4 w-[3px] -translate-x-1/2 rounded-full', dark ? 'bg-[var(--iv-on-dark)]' : 'bg-[var(--iv-ink)]')}
          style={{ left: `${tick * 100}%` }}
          title="Reorder point"
        />
      )}
    </span>
  );
}

export const STATUS_LABEL: Record<Status, string> = {
  ok: 'In stock',
  low: 'Low',
  out: 'Out of stock',
  over: 'Overstocked',
  archived: 'Archived',
};

export const STATUS_TONE: Record<Status, Tone> = {
  ok: 'good',
  low: 'warn',
  out: 'bad',
  over: 'neutral',
  archived: 'neutral',
};

export function StatusBadge({ status }: { status: Status }): React.JSX.Element {
  return <StatusPill tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</StatusPill>;
}

/* --------------------------------------------------------------- menu */

export interface MenuItem {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  danger?: boolean;
  hidden?: boolean;
}

/** A round "more" button with a small menu. */
export function Menu({ items, label = 'More actions', variant = 'light', size = 40 }: { items: MenuItem[]; label?: string; variant?: 'light' | 'row'; size?: number }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement | null>(null);
  const shown = items.filter((i) => i.hidden !== true);
  return (
    <div className="relative">
      <button
        ref={btn}
        type="button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{ width: size, height: size }}
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-full transition-colors',
          'text-[var(--iv-ink)]',
          variant === 'light' ? 'bg-[var(--iv-card)] hover:bg-[var(--iv-row)]' : 'bg-[var(--iv-row)] hover:bg-[var(--iv-row-hover)]',
        )}
      >
        <MoreHorizontal size={18} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} align="right" keep={btn} className="w-60">
        {shown.map((it) => {
          const Icon = it.icon;
          return (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
              className={cn(
                'flex w-full items-center gap-3 rounded-full px-3 py-2.5 text-left text-[14px] font-semibold hover:bg-[var(--iv-row)]',
                it.danger === true && 'text-[var(--iv-red-text)]',
              )}
            >
              <Icon size={16} aria-hidden />
              {it.label}
            </button>
          );
        })}
      </Popover>
    </div>
  );
}

/* --------------------------------------------------------------- ring */

/** A small progress ring with its number in the middle. */
export function ProgressRing({ value, size = 56, children, dark = false }: { value: number; size?: number; children?: ReactNode; dark?: boolean }): React.JSX.Element {
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, value));
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={dark ? 'var(--iv-dark-2)' : 'var(--iv-line)'} strokeWidth={6} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--iv-accent)"
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={`${c * p} ${c}`}
          className="transition-[stroke-dasharray] duration-500"
        />
      </svg>
      <span className="num absolute text-[12px] font-bold">{children ?? `${Math.round(p * 100)}%`}</span>
    </span>
  );
}
