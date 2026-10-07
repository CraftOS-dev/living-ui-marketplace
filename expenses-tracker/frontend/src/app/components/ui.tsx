/**
 * Building blocks of the visual system: rounded cards (white, sand, dark),
 * pill buttons and inputs, round icon buttons, status pills, segmented
 * progress, a modal and a confirm dialog. Colors come only from --et-*.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import type { LucideIcon } from 'lucide-react';
import { ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { addMonths, dayLabel, monthLabel, thisMonth, today } from '../lib/dates.ts';

/* ------------------------------------------------------------- surfaces */

export type CardTone = 'white' | 'sand' | 'dark';

export function Card({ tone = 'white', className, children, delay = 0 }: { tone?: CardTone; className?: string; children: ReactNode; delay?: number }): React.JSX.Element {
  return (
    <section
      className={cn(
        'et-rise rounded-[24px] p-5 md:p-6',
        tone === 'white' && 'bg-[var(--et-card)] text-[var(--et-ink)]',
        tone === 'sand' && 'et-on-sand bg-[var(--et-sand)] text-[var(--et-ink)]',
        tone === 'dark' && 'et-on-dark bg-[var(--et-dark)] text-[var(--et-on-dark)]',
        delay > 0 && `et-d${Math.min(5, delay)}`,
        className,
      )}
    >
      {children}
    </section>
  );
}

export function CardHeader({ title, subtitle, action, dark = false }: { title: string; subtitle?: ReactNode; action?: ReactNode; dark?: boolean }): React.JSX.Element {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-[15px] font-bold leading-[22px]">{title}</h2>
        {subtitle !== undefined && <p className={cn('mt-0.5 text-[13px]', dark ? 'text-[var(--et-on-dark-muted)]' : 'text-[var(--et-muted)]')}>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }): React.JSX.Element {
  return (
    <header className="et-rise mb-6 flex flex-wrap items-center justify-between gap-4 md:mb-8">
      <div className="min-w-0">
        <h1 className="text-[26px] font-bold leading-[34px] tracking-[-0.01em]">{title}</h1>
        {subtitle !== undefined && <p className="mt-1 text-[13px] text-[var(--et-muted)]">{subtitle}</p>}
      </div>
      {actions !== undefined && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/* --------------------------------------------------------------- buttons */

type PillVariant = 'dark' | 'light' | 'ghost' | 'danger' | 'accent';

export function PillButton({
  variant = 'dark',
  icon: Icon,
  dot = false,
  loading = false,
  className,
  children,
  type,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: PillVariant; icon?: LucideIcon; dot?: boolean; loading?: boolean }): React.JSX.Element {
  return (
    <button
      type={type ?? 'button'}
      disabled={disabled === true || loading}
      className={cn(
        'inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-[14px] font-semibold transition-[background,transform,opacity] active:scale-[0.98] disabled:opacity-50',
        variant === 'dark' && 'et-on-ink bg-[var(--et-ink)] text-[var(--et-shell)] hover:opacity-90',
        variant === 'light' && 'bg-[var(--et-card)] text-[var(--et-ink)] hover:bg-[var(--et-row)]',
        variant === 'ghost' && 'bg-transparent text-[var(--et-ink-2)] hover:bg-[var(--et-row)] hover:text-[var(--et-ink)]',
        variant === 'danger' && 'bg-[var(--et-card)] text-[var(--et-red-text)] hover:bg-[var(--et-row)]',
        variant === 'accent' && 'bg-[var(--et-accent)] text-[var(--et-on-accent)] hover:opacity-90',
        dot && 'pl-1.5',
        className,
      )}
      {...rest}
    >
      {loading ? (
        <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : dot && Icon !== undefined ? (
        <span className="flex size-8 items-center justify-center rounded-full bg-[var(--et-accent)] text-[var(--et-on-accent)]">
          <Icon size={16} strokeWidth={2.2} aria-hidden />
        </span>
      ) : Icon !== undefined ? (
        <Icon size={16} strokeWidth={2} aria-hidden />
      ) : null}
      {children}
    </button>
  );
}

export function CircleButton({
  icon: Icon,
  label,
  variant = 'light',
  size = 40,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; variant?: 'light' | 'dark' | 'accent' | 'row' | 'onDark'; size?: number }): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      style={{ width: size, height: size }}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full transition-[background,transform,opacity] active:scale-95 disabled:opacity-40',
        variant === 'light' && 'bg-[var(--et-card)] text-[var(--et-ink)] hover:bg-[var(--et-row)]',
        variant === 'row' && 'bg-[var(--et-row)] text-[var(--et-ink)] hover:bg-[var(--et-row-hover)]',
        variant === 'dark' && 'bg-[var(--et-ink)] text-[var(--et-shell)] hover:opacity-90',
        variant === 'accent' && 'bg-[var(--et-accent)] text-[var(--et-on-accent)] hover:opacity-90',
        variant === 'onDark' && 'bg-[var(--et-dark-2)] text-[var(--et-on-dark)] hover:opacity-90',
        className,
      )}
      {...rest}
    >
      <Icon size={Math.round(size * 0.42)} strokeWidth={2} aria-hidden />
    </button>
  );
}

export function TextLink({ children, onClick, className, tone = 'ink' }: { children: ReactNode; onClick: () => void; className?: string; tone?: 'ink' | 'muted' | 'red' }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 text-[13px] font-semibold underline-offset-4 hover:underline',
        tone === 'ink' && 'text-[var(--et-ink)]',
        tone === 'muted' && 'text-[var(--et-muted)] hover:text-[var(--et-ink)]',
        tone === 'red' && 'text-[var(--et-red-text)]',
        className,
      )}
    >
      {children}
    </button>
  );
}

/* --------------------------------------------------------------- display */

export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'neutral' | 'dark';

export function StatusPill({ tone, children, pulse = false }: { tone: Tone; children: ReactNode; pulse?: boolean }): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[12px] font-semibold',
        tone === 'good' && 'bg-[var(--et-green)]/12 text-[var(--et-green-text)]',
        tone === 'warn' && 'bg-[var(--et-accent)]/30 text-[var(--et-ink)]',
        tone === 'bad' && 'bg-[var(--et-red)]/15 text-[var(--et-red-text)]',
        tone === 'info' && 'et-on-ink bg-[var(--et-ink)] text-[var(--et-shell)]',
        tone === 'neutral' && 'bg-[var(--et-row)] text-[var(--et-ink-2)]',
        tone === 'dark' && 'bg-[var(--et-dark-2)] text-[var(--et-on-dark)]',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'size-1.5 rounded-full',
          tone === 'good' && 'bg-[var(--et-green)]',
          tone === 'warn' && 'bg-[var(--et-ink)]',
          tone === 'bad' && 'bg-[var(--et-red)]',
          tone === 'info' && 'bg-[var(--et-accent)]',
          tone === 'neutral' && 'bg-[var(--et-muted)]',
          tone === 'dark' && 'bg-[var(--et-accent)]',
          pulse && 'et-pulse',
        )}
      />
      {children}
    </span>
  );
}

/** Segmented progress: N small bars, the used share in the accent (red when over). */
export function Segments({ value, max, count = 10, className }: { value: number; max: number; count?: number; className?: string }): React.JSX.Element {
  const ratio = max > 0 ? value / max : 0;
  const filled = Math.min(count, Math.round(ratio * count));
  const over = ratio > 1;
  return (
    <span className={cn('inline-flex items-center gap-[3px]', className)} aria-label={`${Math.round(ratio * 100)}% used`}>
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className={cn('h-3 w-1.5 rounded-full', i < filled ? (over ? 'bg-[var(--et-red)]' : 'bg-[var(--et-accent)]') : 'bg-[var(--et-line)]')}
        />
      ))}
    </span>
  );
}

export function Empty({ icon: Icon, title, children, action, dark = false }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode; dark?: boolean }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <span className={cn('mb-4 flex size-14 items-center justify-center rounded-full', dark ? 'bg-[var(--et-dark-2)] text-[var(--et-accent)]' : 'bg-[var(--et-row)] text-[var(--et-ink)]')}>
        <Icon size={22} strokeWidth={1.8} aria-hidden />
      </span>
      <p className="text-[15px] font-bold">{title}</p>
      {children !== undefined && <div className={cn('mt-1 max-w-sm text-[13px] leading-5', dark ? 'text-[var(--et-on-dark-muted)]' : 'text-[var(--et-muted)]')}>{children}</div>}
      {action !== undefined && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------- inputs */

export const pillInput =
  'h-11 w-full rounded-full bg-[var(--et-card)] px-5 text-[14px] text-[var(--et-ink)] outline-none ring-[var(--et-ink)] transition-shadow focus-visible:ring-2';

export const softInput =
  'h-11 w-full rounded-full bg-[var(--et-row)] px-5 text-[14px] text-[var(--et-ink)] outline-none ring-[var(--et-ink)] transition-shadow focus-visible:ring-2';

export function PillSelect({
  value,
  onChange,
  options,
  label,
  ariaLabel,
  soft = false,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label?: string;
  ariaLabel?: string;
  soft?: boolean;
  className?: string;
}): React.JSX.Element {
  const select = (
    <div className={cn('relative', className)}>
      <select
        aria-label={ariaLabel ?? label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(soft ? softInput : pillInput, 'appearance-none pr-11 font-medium')}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={16} aria-hidden className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[var(--et-muted)]" />
    </div>
  );
  if (label === undefined) return select;
  return (
    <label className="flex flex-col gap-2">
      <span className="px-1 text-[13px] font-semibold text-[var(--et-ink-2)]">{label}</span>
      {select}
    </label>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <span className="px-1 text-[13px] font-semibold text-[var(--et-ink-2)]">{label}</span>
      {children}
      {error ? <span className="px-1 text-[12px] font-medium text-[var(--et-red-text)]">{error}</span> : hint !== undefined ? <span className="px-1 text-[12px] text-[var(--et-muted)]">{hint}</span> : null}
    </div>
  );
}

/** On/off switch: ink track with an accent knob when on. */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn('et-on-ink relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors', checked ? 'bg-[var(--et-ink)]' : 'bg-[var(--et-line)]')}
    >
      <span className={cn('inline-block size-5 rounded-full shadow-sm transition-transform', checked ? 'translate-x-6 bg-[var(--et-accent)]' : 'translate-x-1 bg-[var(--et-card)]')} />
    </button>
  );
}

/** ‹ October 2026 › as one pill. */
export function MonthSwitcher({ month, onChange, dark = false }: { month: string; onChange: (m: string) => void; dark?: boolean }): React.JSX.Element {
  const btn = cn(
    'flex size-9 items-center justify-center rounded-full transition-colors disabled:opacity-30',
    dark ? 'text-[var(--et-on-dark)] hover:bg-[var(--et-dark-2)]' : 'text-[var(--et-ink)] hover:bg-[var(--et-row)]',
  );
  return (
    <div className={cn('flex h-11 items-center gap-1 rounded-full px-1', dark ? 'bg-[var(--et-dark-2)]' : 'bg-[var(--et-card)]')}>
      <button type="button" className={btn} onClick={() => onChange(addMonths(month, -1))} aria-label="Previous month">
        <ChevronLeft size={16} />
      </button>
      <span className="min-w-[8.5rem] text-center text-[14px] font-semibold">{monthLabel(month)}</span>
      <button type="button" className={btn} onClick={() => onChange(addMonths(month, 1))} aria-label="Next month" disabled={month >= thisMonth()}>
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- overlays */

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}): React.JSX.Element {
  return (
    <RadixDialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px]" />
        <RadixDialog.Content
          className={cn(
            'et-pop fixed left-1/2 top-1/2 z-[61] max-h-[90vh] w-[min(94vw,30rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[28px] bg-[var(--et-shell)] p-6 text-[var(--et-ink)] shadow-2xl',
            wide && 'w-[min(94vw,40rem)]',
          )}
        >
          <div className="mb-5 flex items-start justify-between gap-3">
            <div>
              <RadixDialog.Title className="text-[15px] font-bold">{title}</RadixDialog.Title>
              <RadixDialog.Description className={description !== undefined ? 'mt-1 text-[13px] text-[var(--et-muted)]' : 'sr-only'}>{description ?? title}</RadixDialog.Description>
            </div>
            <CircleButton icon={X} label="Close" variant="row" size={36} onClick={onClose} />
          </div>
          {children}
          {footer !== undefined && <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/** `const [el, confirm] = useConfirm()`; render el once; `await confirm(...)`. */
export function useConfirm(): [ReactNode, (message: string, title: string, confirmLabel?: string) => Promise<boolean>] {
  const [state, setState] = useState<{ message: string; title: string; label: string } | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const confirm = useCallback(
    (message: string, title: string, confirmLabel = 'Delete') =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setState({ message, title, label: confirmLabel });
      }),
    [],
  );
  const settle = (ok: boolean): void => {
    resolver.current?.(ok);
    setState(null);
  };
  const el =
    state !== null ? (
      <Modal
        open
        onClose={() => settle(false)}
        title={state.title}
        footer={
          <>
            <PillButton variant="light" onClick={() => settle(false)}>
              Cancel
            </PillButton>
            <PillButton variant="dark" onClick={() => settle(true)}>
              {state.label}
            </PillButton>
          </>
        }
      >
        <p className="text-[14px] text-[var(--et-ink-2)]">{state.message}</p>
      </Modal>
    ) : null;
  return [el, confirm];
}

/**
 * A small floating panel under its trigger; closes on outside click and
 * Escape. `keep` is the trigger: pressing it toggles instead of closing and
 * reopening. Escape stops here, so a screen behind keeps its own Escape.
 */
export function Popover({
  open,
  onClose,
  children,
  align = 'left',
  className,
  keep,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  align?: 'left' | 'right';
  className?: string;
  keep?: React.RefObject<HTMLElement | null>;
}): React.JSX.Element | null {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (keep?.current?.contains(t) === true) return;
      if (ref.current !== null && !ref.current.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const t = setTimeout(() => document.addEventListener('mousedown', onDoc), 0);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, keep]);
  if (!open) return null;
  return (
    <div
      ref={ref}
      className={cn(
        'et-pop et-on-card absolute top-[calc(100%+8px)] z-40 rounded-[20px] bg-[var(--et-card)] p-2 text-[var(--et-ink)] shadow-[0_20px_50px_-20px_rgba(29,28,26,0.45)]',
        align === 'left' ? 'left-0' : 'right-0',
        className,
      )}
    >
      {children}
    </div>
  );
}

const WEEK = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** A month of days to pick one from (weeks start on Monday). */
export function DayPicker({ value, onPick }: { value: string; onPick: (day: string) => void }): React.JSX.Element {
  const [month, setMonth] = useState(value.slice(0, 7));
  const t = today();
  const [y = 0, m = 1] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const lead = (first.getDay() + 6) % 7;
  const count = new Date(y, m, 0).getDate();
  const days = Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <CircleButton icon={ChevronLeft} label="Previous month" variant="row" size={32} onClick={() => setMonth(addMonths(month, -1))} />
        <span className="text-[14px] font-bold">{monthLabel(month)}</span>
        <CircleButton icon={ChevronRight} label="Next month" variant="row" size={32} onClick={() => setMonth(addMonths(month, 1))} />
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEK.map((w, i) => (
          <span key={i} className="py-1 text-[12px] font-semibold text-[var(--et-muted)]">
            {w}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`b${i}`} />
        ))}
        {days.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => onPick(d)}
            aria-label={dayLabel(d)}
            aria-pressed={d === value}
            className={cn(
              'num flex aspect-square w-full items-center justify-center rounded-full text-[13px] font-semibold transition-colors',
              d === value ? 'bg-[var(--et-ink)] text-[var(--et-shell)]' : 'hover:bg-[var(--et-row)]',
              d === t && d !== value && 'ring-1 ring-inset ring-[var(--et-ink)]',
            )}
          >
            {Number(d.slice(8, 10))}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The message an op error carries (PocketBase shape { message }). */
export function errMessage(err: unknown): string {
  const e = err as { message?: string; response?: { message?: string } };
  return e.response?.message ?? e.message ?? 'Something went wrong';
}
