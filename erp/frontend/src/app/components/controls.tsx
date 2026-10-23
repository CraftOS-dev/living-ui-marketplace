/**
 * Controls on top of the visual system: filter chips with counts, a
 * segmented switch, tabs, a search pill, a quantity stepper, a "more" menu,
 * a progress ring and a progress bar.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Minus, MoreHorizontal, Plus, Search, X } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { normalizeNumber } from '../lib/format.ts';
import { MenuRow, Popover, pillInput } from './ui.tsx';

/* ------------------------------------------------------------ chips */

export interface ChipOption<T extends string> {
  value: T;
  label: string;
  count?: number | undefined;
  icon?: LucideIcon | undefined;
  /** The count is a warning (overdue, failed). */
  alert?: boolean | undefined;
}

/** One-of-many filter as a row of pills; the current one is ink. Scrolls sideways on phones. */
export function Chips<T extends string>({
  value,
  onChange,
  options,
  className,
  ariaLabel,
  onCard = false,
}: {
  value: T;
  onChange: (v: T) => void;
  options: ChipOption<T>[];
  className?: string | undefined;
  ariaLabel: string;
  onCard?: boolean | undefined;
}): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn('erp-strip -mx-1 flex items-center gap-2 relative overflow-x-auto px-1 py-0.5', className)}>
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
              'inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 text-[13px] font-semibold transition-colors',
              on
                ? 'erp-on-ink bg-[var(--erp-ink)] text-[var(--erp-shell)]'
                : onCard
                  ? 'bg-[var(--erp-row)] text-[var(--erp-ink-2)] hover:bg-[var(--erp-row-hover)] hover:text-[var(--erp-ink)]'
                  : 'bg-[var(--erp-card)] text-[var(--erp-ink-2)] hover:bg-[var(--erp-row)] hover:text-[var(--erp-ink)]',
            )}
          >
            {Icon !== undefined && <Icon size={14} aria-hidden />}
            {o.label}
            {o.count !== undefined && (
              <span
                className={cn(
                  'num min-w-5 rounded-full px-1.5 text-center text-[12px] font-bold',
                  o.alert === true && o.count > 0
                    ? 'bg-[var(--erp-red)] text-[var(--erp-on-red)]'
                    : on
                      ? 'bg-[var(--erp-accent)] text-[var(--erp-on-accent)]'
                      : onCard
                        ? 'bg-[var(--erp-card)] text-[var(--erp-ink-2)]'
                        : 'bg-[var(--erp-row)] text-[var(--erp-ink-2)]',
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
  onShell = false,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: LucideIcon | undefined }[];
  ariaLabel: string;
  className?: string | undefined;
  dark?: boolean | undefined;
  onShell?: boolean | undefined;
}): React.JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('inline-flex h-11 max-w-full items-center gap-1 rounded-full p-1', dark ? 'bg-[var(--erp-dark-2)]' : onShell ? 'bg-[var(--erp-card)]' : 'bg-[var(--erp-row)]', className)}
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
              'inline-flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[13px] font-semibold transition-colors @min-[480px]:px-3.5',
              on
                ? dark
                  ? 'bg-[var(--erp-accent)] text-[var(--erp-on-accent)]'
                  : 'erp-on-ink bg-[var(--erp-ink)] text-[var(--erp-shell)]'
                : dark
                  ? 'text-[var(--erp-on-dark-muted)] hover:text-[var(--erp-on-dark)]'
                  : 'text-[var(--erp-ink-2)] hover:text-[var(--erp-ink)]',
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

/** Tabs under a page title: one underline-free pill strip; each tab is its own view. */
export function Tabs<T extends string>({ value, onChange, tabs, ariaLabel, className }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string; count?: number | undefined; icon?: LucideIcon | undefined }[]; ariaLabel: string; className?: string | undefined }): React.JSX.Element {
  return (
    <div role="tablist" aria-label={ariaLabel} className={cn('erp-strip -mx-1 mb-5 flex items-center gap-1 relative overflow-x-auto px-1', className)}>
      {tabs.map((t) => {
        const on = t.value === value;
        const Icon = t.icon;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.value)}
            className={cn(
              'inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 text-[14px] font-semibold transition-colors',
              on ? 'bg-[var(--erp-card)] text-[var(--erp-ink)] shadow-[0_8px_20px_-16px_rgba(29,28,26,0.5)]' : 'text-[var(--erp-ink-2)] hover:bg-[var(--erp-card)]/60 hover:text-[var(--erp-ink)]',
            )}
          >
            {Icon !== undefined && <Icon size={15} aria-hidden />}
            {t.label}
            {t.count !== undefined && t.count > 0 && <span className="num rounded-full bg-[var(--erp-accent)] px-1.5 text-[12px] font-bold text-[var(--erp-on-accent)]">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------ search */

/** A search pill. Enter calls onEnter. Escape clears. Debounce in the caller (useDebounced). */
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
  onEnter?: ((v: string) => void) | undefined;
  placeholder: string;
  ariaLabel: string;
  className?: string | undefined;
  autoFocus?: boolean | undefined;
  soft?: boolean | undefined;
  inputRef?: React.RefObject<HTMLInputElement | null> | undefined;
}): React.JSX.Element {
  return (
    <label className={cn('relative block min-w-0', className)}>
      <Search size={16} aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--erp-muted)]" />
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
        className={cn(pillInput, soft && 'bg-[var(--erp-row)]', 'pl-11 pr-11')}
      />
      {value !== '' && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full hover:bg-[var(--erp-row)]"
        >
          <X size={14} />
        </button>
      )}
    </label>
  );
}

/** A value that settles `ms` after the last change (search boxes). */
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/* ----------------------------------------------------------- stepper */

/** A quantity with minus and plus around a typed field. */
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
  fractional?: boolean | undefined;
  min?: number | undefined;
  ariaLabel: string;
  size?: 'sm' | 'md' | undefined;
  className?: string | undefined;
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
    <div className={cn('inline-flex items-center gap-1 rounded-full bg-[var(--erp-row)] p-1', h, className)}>
      <button type="button" aria-label={`Less ${ariaLabel}`} disabled={n <= min} onClick={() => step(-1)} className={cn('flex shrink-0 items-center justify-center rounded-full bg-[var(--erp-card)] transition-transform active:scale-90 disabled:opacity-40', btn)}>
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
      <button type="button" aria-label={`More ${ariaLabel}`} onClick={() => step(1)} className={cn('flex shrink-0 items-center justify-center rounded-full bg-[var(--erp-card)] transition-transform active:scale-90', btn)}>
        <Plus size={14} strokeWidth={2.4} />
      </button>
    </div>
  );
}

/* --------------------------------------------------------------- menu */

export interface MenuItem {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  danger?: boolean | undefined;
  hidden?: boolean | undefined;
  hint?: string | undefined;
}

/** A round "more" button with a small menu. */
export function Menu({ items, label = 'More actions', variant = 'light', size = 40, up = false }: { items: MenuItem[]; label?: string | undefined; variant?: 'light' | 'row' | undefined; size?: number | undefined; up?: boolean | undefined }): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement | null>(null);
  const shown = items.filter((i) => i.hidden !== true);
  if (shown.length === 0) return null;
  return (
    <div className="relative">
      <button
        ref={btn}
        type="button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
        style={{ width: size, height: size }}
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-full text-[var(--erp-ink)] transition-colors',
          variant === 'light' ? 'bg-[var(--erp-card)] hover:bg-[var(--erp-row)]' : 'bg-[var(--erp-row)] hover:bg-[var(--erp-row-hover)]',
        )}
      >
        <MoreHorizontal size={18} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} align="right" keep={btn} up={up} className="w-64">
        <div role="menu">
          {shown.map((it) => (
            <MenuRow
              key={it.label}
              icon={it.icon}
              label={it.label}
              danger={it.danger}
              hint={it.hint}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
            />
          ))}
        </div>
      </Popover>
    </div>
  );
}

/* ---------------------------------------------------------- progress */

/** A small progress ring with its number in the middle. */
export function ProgressRing({ value, size = 56, children, dark = false, tone = 'accent' }: { value: number; size?: number | undefined; children?: ReactNode | undefined; dark?: boolean | undefined; tone?: 'accent' | 'red' | 'green' | 'amber' | undefined }): React.JSX.Element {
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, value));
  const stroke = tone === 'red' ? 'var(--erp-red)' : tone === 'green' ? 'var(--erp-green)' : tone === 'amber' ? 'var(--erp-amber)' : 'var(--erp-accent)';
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={dark ? 'var(--erp-dark-2)' : 'var(--erp-line)'} strokeWidth={6} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={stroke} strokeWidth={6} strokeLinecap="round" strokeDasharray={`${c * p} ${c}`} className="transition-[stroke-dasharray] duration-500" />
      </svg>
      <span className="num absolute text-[12px] font-bold">{children ?? `${Math.round(p * 100)}%`}</span>
    </span>
  );
}

/** A thin bar filled to `value` (0..1); over 1 shows red. */
export function ProgressBar({ value, className, dark = false, tone }: { value: number; className?: string | undefined; dark?: boolean | undefined; tone?: 'ink' | 'accent' | 'red' | 'green' | 'amber' | undefined }): React.JSX.Element {
  const over = value > 1;
  const t = tone ?? (over ? 'red' : 'ink');
  return (
    <span className={cn('block h-2 overflow-hidden rounded-full', dark ? 'bg-[var(--erp-dark-2)]' : 'bg-[var(--erp-line)]', className)} aria-hidden>
      <span
        className={cn(
          'erp-grow-x block h-full rounded-full',
          t === 'ink' && (dark ? 'bg-[var(--erp-on-dark)]' : 'bg-[var(--erp-ink)]'),
          t === 'accent' && 'bg-[var(--erp-accent)]',
          t === 'red' && 'bg-[var(--erp-red)]',
          t === 'green' && 'bg-[var(--erp-green)]',
          t === 'amber' && 'bg-[var(--erp-amber)]',
        )}
        style={{ width: `${Math.max(value > 0 ? 3 : 0, Math.min(1, value) * 100)}%` }}
      />
    </span>
  );
}
