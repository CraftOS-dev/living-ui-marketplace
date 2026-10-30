/**
 * The building blocks, in the reference shapes: white rounded cards on the
 * grey frame, grey tiles inside cards, black pill buttons, round icon
 * buttons and badges, green and red delta chips, status dots, a segmented
 * tab bar whose black pill slides, a right-hand drawer, dialogs, menus,
 * switches, checkboxes and soft inputs. Colors come only from --so-* tokens.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDownRight, ArrowUpRight, Check, ChevronDown, Minus, MoreHorizontal, Search, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { reducedMotion } from '../lib/motion.tsx';
import type { TaskBrief } from '../lib/types.ts';
import { TASK_STATE_LABEL } from '../lib/format.ts';

/* ------------------------------------------------------------- surfaces */

export function Card({ className, children, id, flush = false }: { className?: string; children: ReactNode; id?: string; flush?: boolean }): React.JSX.Element {
  return (
    <section id={id} className={cn('so-rise min-w-0 rounded-[20px] bg-[var(--so-card)] text-[var(--so-ink)]', flush ? '' : 'p-5', className)}>
      {children}
    </section>
  );
}

export function CardHeader({ title, subtitle, action, className }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; className?: string }): React.JSX.Element {
  return (
    <div className={cn('mb-4 flex items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold leading-[22px]">{title}</h2>
        {subtitle !== undefined && subtitle !== '' && <p className="mt-0.5 text-[12px] leading-[18px] text-[var(--so-muted)]">{subtitle}</p>}
      </div>
      {action !== undefined && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

export function Tile({ className, children }: { className?: string; children: ReactNode }): React.JSX.Element {
  return <div className={cn('rounded-[14px] bg-[var(--so-tile)] p-4', className)}>{children}</div>;
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: ReactNode }): React.JSX.Element {
  return (
    <header className="so-rise mb-5 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {back}
        <h1 className="text-[26px] font-semibold leading-[34px] tracking-[-0.02em]">{title}</h1>
        {subtitle !== undefined && <p className="mt-1 text-[13px] text-[var(--so-muted)]">{subtitle}</p>}
      </div>
      {actions !== undefined && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/* --------------------------------------------------------------- buttons */

export type ButtonVariant = 'primary' | 'secondary' | 'tile' | 'ghost' | 'accent' | 'danger';
export type ButtonSize = 'md' | 'sm';

export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', className?: string): string {
  return cn(
    'so-press inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold disabled:cursor-not-allowed disabled:opacity-50',
    size === 'md' ? 'h-10 px-4 text-[14px]' : 'h-8 px-3 text-[13px]',
    variant === 'primary' && 'bg-[var(--so-primary)] text-[var(--so-on-primary)] hover:bg-[var(--so-primary-hover)]',
    variant === 'secondary' && 'bg-[var(--so-card)] text-[var(--so-ink)] shadow-[inset_0_0_0_1px_var(--so-border)] hover:bg-[var(--so-row-hover)]',
    variant === 'tile' && 'bg-[var(--so-tile)] text-[var(--so-ink)] hover:bg-[var(--so-tile-hover)]',
    variant === 'ghost' && 'bg-transparent text-[var(--so-ink-2)] hover:bg-[var(--so-tile)] hover:text-[var(--so-ink)]',
    variant === 'accent' && 'bg-[var(--so-accent)] text-[var(--so-on-accent)] hover:brightness-95',
    variant === 'danger' && 'bg-[var(--so-red)] text-white hover:brightness-95',
    className,
  );
}

export function Button({
  variant = 'primary',
  size = 'md',
  icon: Icon,
  iconRight: IconRight,
  loading = false,
  className,
  children,
  type,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; icon?: LucideIcon; iconRight?: LucideIcon; loading?: boolean }): React.JSX.Element {
  const s = size === 'md' ? 16 : 14;
  return (
    <button type={type ?? 'button'} disabled={disabled === true || loading} className={buttonClass(variant, size, className)} {...rest}>
      {loading ? <span aria-hidden className="so-spin size-4 rounded-full border-2 border-current border-t-transparent" /> : Icon !== undefined ? <Icon size={s} strokeWidth={2} aria-hidden /> : null}
      {children}
      {IconRight !== undefined && <IconRight size={s} strokeWidth={2} aria-hidden />}
    </button>
  );
}

export function LinkButton({ variant = 'primary', size = 'md', icon: Icon, className, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: ButtonVariant; size?: ButtonSize; icon?: LucideIcon }): React.JSX.Element {
  return (
    <a className={buttonClass(variant, size, className)} {...rest}>
      {Icon !== undefined && <Icon size={size === 'md' ? 16 : 14} strokeWidth={2} aria-hidden />}
      {children}
    </a>
  );
}

export function IconButton({
  icon: Icon,
  label,
  variant = 'tile',
  size = 36,
  badge,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; variant?: 'tile' | 'card' | 'primary' | 'ghost'; size?: number; badge?: number }): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      style={{ width: size, height: size }}
      className={cn(
        'hit so-press relative inline-flex shrink-0 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'tile' && 'bg-[var(--so-tile)] text-[var(--so-ink)] hover:bg-[var(--so-tile-hover)]',
        variant === 'card' && 'bg-[var(--so-card)] text-[var(--so-ink)] shadow-[inset_0_0_0_1px_var(--so-border)] hover:bg-[var(--so-row-hover)]',
        variant === 'primary' && 'bg-[var(--so-primary)] text-[var(--so-on-primary)] hover:bg-[var(--so-primary-hover)]',
        variant === 'ghost' && 'text-[var(--so-ink-2)] hover:bg-[var(--so-tile)] hover:text-[var(--so-ink)]',
        className,
      )}
      {...rest}
    >
      <Icon size={Math.round(size * 0.46)} strokeWidth={2} aria-hidden />
      {badge !== undefined && badge > 0 && (
        <span className="num absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--so-red)] px-1 text-[11px] font-bold leading-none text-white ring-2 ring-[var(--so-frame)]">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  );
}

/** A round icon badge, as on the left of KPI tiles and rows. */
export function IconBadge({ icon: Icon, tone = 'tile', size = 36 }: { icon: LucideIcon; tone?: 'tile' | 'card' | 'ink' | 'accent' | 'good' | 'bad' | 'warn' | 'onAccent'; size?: number }): React.JSX.Element {
  return (
    <span
      style={{ width: size, height: size }}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full',
        tone === 'tile' && 'bg-[var(--so-tile)] text-[var(--so-ink)]',
        tone === 'card' && 'bg-[var(--so-card)] text-[var(--so-ink)]',
        tone === 'ink' && 'bg-[var(--so-primary)] text-[var(--so-on-primary)]',
        tone === 'accent' && 'bg-[var(--so-accent-soft)] text-[var(--so-accent-text)]',
        tone === 'good' && 'bg-[var(--so-green-soft)] text-[var(--so-green-text)]',
        tone === 'bad' && 'bg-[var(--so-red-soft)] text-[var(--so-red-text)]',
        tone === 'warn' && 'bg-[var(--so-amber-soft)] text-[var(--so-amber-text)]',
        tone === 'onAccent' && 'bg-white/20 text-white',
      )}
    >
      <Icon size={Math.round(size * 0.46)} strokeWidth={2} aria-hidden />
    </span>
  );
}

/* --------------------------------------------------------------- display */

/** "+2.5%" in green, "-1.5%" in red, as a small round chip. */
export function Delta({ value, invert = false, onAccent = false, suffix = '%' }: { value: number | null | undefined; invert?: boolean; onAccent?: boolean; suffix?: string }): React.JSX.Element | null {
  if (value === null || value === undefined) return null;
  const up = value > 0;
  const flat = value === 0;
  const good = flat ? null : invert ? !up : up;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        'num inline-flex h-6 items-center gap-0.5 rounded-full px-2 text-[12px] font-semibold',
        onAccent ? 'bg-white/20 text-white' : good === null ? 'bg-[var(--so-tile)] text-[var(--so-muted)]' : good ? 'bg-[var(--so-green-soft)] text-[var(--so-green-text)]' : 'bg-[var(--so-red-soft)] text-[var(--so-red-text)]',
      )}
    >
      <Icon size={13} strokeWidth={2.4} aria-hidden />
      {(up ? '+' : '') + (Math.round(value * 10) / 10).toString() + suffix}
    </span>
  );
}

export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'neutral' | 'accent' | 'ink';

const DOT: Record<Tone, string> = {
  good: 'bg-[var(--so-green)]',
  warn: 'bg-[var(--so-amber)]',
  bad: 'bg-[var(--so-red)]',
  info: 'bg-[var(--so-blue)]',
  neutral: 'bg-[var(--so-faint)]',
  accent: 'bg-[var(--so-accent)]',
  ink: 'bg-[var(--so-ink)]',
};

/** A colored dot and a label (no fill), as in a table's Status column. */
export function StatusDot({ tone, children, pulse = false, className }: { tone: Tone; children: ReactNode; pulse?: boolean; className?: string }): React.JSX.Element {
  return (
    <span className={cn('inline-flex items-center gap-2 whitespace-nowrap text-[13px] font-medium text-[var(--so-ink)]', className)}>
      <span aria-hidden className={cn('size-2 shrink-0 rounded-full', DOT[tone], pulse && 'so-breathe')} />
      {children}
    </span>
  );
}

/** A small filled chip. */
export function Pill({ tone = 'neutral', children, icon: Icon, className, title }: { tone?: Tone; children: ReactNode; icon?: LucideIcon; className?: string; title?: string }): React.JSX.Element {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-6 max-w-full items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-[12px] font-semibold',
        tone === 'good' && 'bg-[var(--so-green-soft)] text-[var(--so-green-text)]',
        tone === 'warn' && 'bg-[var(--so-amber-soft)] text-[var(--so-amber-text)]',
        tone === 'bad' && 'bg-[var(--so-red-soft)] text-[var(--so-red-text)]',
        tone === 'info' && 'bg-[var(--so-blue-soft)] text-[var(--so-blue-text)]',
        tone === 'neutral' && 'bg-[var(--so-tile)] text-[var(--so-ink-2)]',
        tone === 'accent' && 'bg-[var(--so-accent-soft)] text-[var(--so-accent-text)]',
        tone === 'ink' && 'bg-[var(--so-primary)] text-[var(--so-on-primary)]',
        className,
      )}
    >
      {Icon !== undefined && <Icon size={12} strokeWidth={2.4} aria-hidden />}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Your AI agent's state on something: asked, working (breathing dot), and the rest. */
export function TaskBadge({ task, className }: { task: TaskBrief | null | undefined; className?: string }): React.JSX.Element | null {
  if (!task) return null;
  const working = task.state === 'working';
  const open = task.state === 'queued' || task.state === 'asked' || working;
  return (
    <span title={task.label} className={cn('inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[12px] font-semibold', open ? 'bg-[var(--so-accent-soft)] text-[var(--so-accent-text)]' : task.state === 'failed' ? 'bg-[var(--so-red-soft)] text-[var(--so-red-text)]' : 'bg-[var(--so-tile)] text-[var(--so-ink-2)]', className)}>
      <span aria-hidden className={cn('size-1.5 rounded-full', open ? 'bg-[var(--so-accent)]' : task.state === 'failed' ? 'bg-[var(--so-red)]' : 'bg-[var(--so-faint)]', working && 'so-breathe')} />
      {open ? (working ? 'Your AI agent is on it' : 'Your AI agent: ' + TASK_STATE_LABEL[task.state]?.toLowerCase()) : TASK_STATE_LABEL[task.state]}
    </span>
  );
}

export function Avatar({ name, size = 36, className }: { name: string; size?: number; className?: string }): React.JSX.Element {
  const initials = name
    .split(/\s+/)
    .map((x) => x.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((x) => x !== '')
    .slice(0, 2)
    .map((x) => x.charAt(0).toUpperCase())
    .join('');
  return (
    <span style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }} className={cn('inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--so-primary)] font-semibold text-[var(--so-on-primary)]', className)}>
      {initials || '?'}
    </span>
  );
}

export function Empty({ icon: Icon, title, children, action, className }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode; className?: string }): React.JSX.Element {
  return (
    <div className={cn('flex flex-col items-center px-6 py-10 text-center', className)}>
      <span className="mb-4 flex size-12 items-center justify-center rounded-full bg-[var(--so-tile)] text-[var(--so-ink)]">
        <Icon size={20} strokeWidth={1.8} aria-hidden />
      </span>
      <p className="text-[15px] font-semibold">{title}</p>
      {children !== undefined && <div className="mt-1 max-w-sm text-[13px] leading-5 text-[var(--so-muted)]">{children}</div>}
      {action !== undefined && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }): React.JSX.Element {
  return <div aria-hidden className={cn('rounded-[12px] bg-[var(--so-tile)]', className)} />;
}

/** A bar with a hatched track (the reference's spending-limit bar). */
export function Meter({ value, max, tone = 'accent', className }: { value: number; max: number; tone?: 'accent' | 'good' | 'ink' | 'bad'; className?: string }): React.JSX.Element {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div className={cn('so-hatch relative h-2.5 w-full overflow-hidden rounded-full', className)} role="meter" aria-valuenow={value} aria-valuemax={max}>
      <div
        className={cn('absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out', tone === 'accent' && 'bg-[var(--so-accent)]', tone === 'good' && 'bg-[var(--so-green)]', tone === 'ink' && 'bg-[var(--so-ink)]', tone === 'bad' && 'bg-[var(--so-red)]')}
        style={{ width: ratio * 100 + '%' }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ tabs */

export interface TabItem<K extends string> {
  key: K;
  label: string;
  count?: number | undefined;
  alert?: boolean | undefined;
}

/**
 * A segmented bar: the current tab is a black pill that slides between tabs.
 * `fit` shares the full width between the tabs (nothing scrolls; counts show
 * only when above 0).
 */
export function Tabs<K extends string>({ items, value, onChange, className, size = 'md', fit = false }: { items: TabItem<K>[]; value: K; onChange: (k: K) => void; className?: string; size?: 'md' | 'sm'; fit?: boolean }): React.JSX.Element {
  const bar = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const first = useRef(true);
  useLayoutEffect(() => {
    const b = bar.current;
    const p = pill.current;
    if (!b || !p) return;
    const el = b.querySelector<HTMLElement>('[data-on="1"]');
    if (!el) {
      p.style.opacity = '0';
      return;
    }
    p.style.opacity = '1';
    p.style.transition = first.current || reducedMotion() ? 'none' : 'transform 300ms cubic-bezier(0.22, 1, 0.36, 1), width 300ms cubic-bezier(0.22, 1, 0.36, 1)';
    p.style.width = el.offsetWidth + 'px';
    p.style.transform = 'translateX(' + el.offsetLeft + 'px)';
    first.current = false;
  }, [value, items]);
  return (
    <div ref={bar} role="tablist" className={cn('so-noscroll relative max-w-full items-center gap-0.5 rounded-full bg-[var(--so-card)] p-1', fit ? 'flex w-full overflow-hidden' : 'inline-flex overflow-x-auto', className)}>
      <span ref={pill} aria-hidden className="absolute left-0 top-1 bottom-1 rounded-full bg-[var(--so-primary)]" />
      {items.map((t) => {
        const on = t.key === value;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={on}
            data-on={on ? '1' : '0'}
            onClick={() => onChange(t.key)}
            className={cn(
              'relative z-[1] inline-flex items-center gap-1.5 rounded-full font-semibold transition-colors duration-200',
              fit ? 'flex-auto justify-center whitespace-nowrap px-1.5' : 'shrink-0',
              size === 'md' ? 'h-9 text-[14px]' : 'h-7 text-[13px]',
              !fit && (size === 'md' ? 'px-4' : 'px-3'),
              on ? 'text-[var(--so-on-primary)]' : 'text-[var(--so-ink-2)] hover:bg-[var(--so-tile)] hover:text-[var(--so-ink)]',
            )}
          >
            <span>{t.label}</span>
            {t.count !== undefined && (!fit || t.count > 0) && (
              <span
                className={cn(
                  'num rounded-full text-[11px] leading-[18px]',
                  fit ? 'min-w-[18px] px-1' : 'px-1.5',
                  on ? 'bg-white/20 text-[var(--so-on-primary)]' : t.alert ? 'bg-[var(--so-red)] text-white' : fit ? 'text-[var(--so-muted)]' : 'bg-[var(--so-tile)] text-[var(--so-muted)]',
                )}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Small pills (1d 7d 30d): the chosen one is black. */
export function Segmented<K extends string>({ items, value, onChange, className }: { items: { key: K; label: string }[]; value: K; onChange: (k: K) => void; className?: string }): React.JSX.Element {
  return (
    <div role="radiogroup" className={cn('inline-flex items-center gap-1', className)}>
      {items.map((t) => (
        <button
          key={t.key}
          type="button"
          role="radio"
          aria-checked={t.key === value}
          onClick={() => onChange(t.key)}
          className={cn('so-press h-8 rounded-full px-3 text-[12px] font-semibold', t.key === value ? 'bg-[var(--so-primary)] text-[var(--so-on-primary)]' : 'text-[var(--so-muted)] hover:bg-[var(--so-tile)] hover:text-[var(--so-ink)]')}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- inputs */

export const fieldClass = 'h-10 w-full rounded-[12px] bg-[var(--so-tile)] px-3.5 text-[14px] text-[var(--so-ink)] outline-none ring-[var(--so-ink)] transition-shadow focus-visible:ring-2 disabled:opacity-60';
export const areaClass = 'block w-full resize-y rounded-[12px] bg-[var(--so-tile)] px-3.5 py-2.5 text-[14px] leading-[22px] text-[var(--so-ink)] outline-none ring-[var(--so-ink)] transition-shadow focus-visible:ring-2';

export function Field({ label, hint, children, className, error }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string; error?: string }): React.JSX.Element {
  return (
    <label className={cn('block min-w-0', className)}>
      <span className="mb-1.5 flex items-center justify-between gap-2 text-[12px] font-semibold text-[var(--so-ink-2)]">
        <span>{label}</span>
        {hint !== undefined && <span className="font-medium text-[var(--so-muted)]">{hint}</span>}
      </span>
      {children}
      {error !== undefined && error !== '' && <span className="mt-1 block text-[12px] font-medium text-[var(--so-red-text)]">{error}</span>}
    </label>
  );
}

export function TextInput({ className, prefix, ...rest }: InputHTMLAttributes<HTMLInputElement> & { prefix?: ReactNode }): React.JSX.Element {
  if (prefix === undefined) return <input className={cn(fieldClass, className)} {...rest} />;
  return (
    <span className={cn('flex h-10 items-center rounded-[12px] bg-[var(--so-tile)] ring-[var(--so-ink)] focus-within:ring-2', className)}>
      <span className="pl-3.5 pr-1 text-[13px] font-semibold text-[var(--so-muted)]">{prefix}</span>
      <input className="h-full min-w-0 flex-1 bg-transparent pr-3.5 text-[14px] text-[var(--so-ink)] outline-none" {...rest} />
    </span>
  );
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>): React.JSX.Element {
  return <textarea className={cn(areaClass, className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>): React.JSX.Element {
  return (
    <span className={cn('relative block', className)}>
      <select className={cn(fieldClass, 'appearance-none pr-9')} {...rest}>
        {children}
      </select>
      <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--so-muted)]" aria-hidden />
    </span>
  );
}

/** A search field as a white pill (on the frame) or a grey one (on a card). */
export function SearchField({ value, onChange, placeholder = 'Search', onCard = true, className, autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; onCard?: boolean; className?: string; autoFocus?: boolean }): React.JSX.Element {
  return (
    <span className={cn('flex h-10 min-w-0 items-center gap-2 rounded-full px-3.5 ring-[var(--so-ink)] focus-within:ring-2', onCard ? 'bg-[var(--so-tile)]' : 'bg-[var(--so-card)] shadow-[inset_0_0_0_1px_var(--so-border)]', className)}>
      <Search size={16} className="shrink-0 text-[var(--so-muted)]" aria-hidden />
      <input autoFocus={autoFocus} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-[var(--so-ink)] outline-none" />
      {value !== '' && (
        <button type="button" aria-label="Clear" onClick={() => onChange('')} className="hit rounded-full p-0.5 text-[var(--so-muted)] hover:bg-[var(--so-tile-hover)] hover:text-[var(--so-ink)]">
          <X size={14} />
        </button>
      )}
    </span>
  );
}

export function Checkbox({ checked, onChange, label, indeterminate = false, className }: { checked: boolean; onChange: (v: boolean) => void; label: string; indeterminate?: boolean; className?: string }): React.JSX.Element {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={cn('hit inline-flex size-[18px] shrink-0 items-center justify-center rounded-[5px] transition-colors', checked || indeterminate ? 'bg-[var(--so-primary)] text-[var(--so-on-primary)]' : 'bg-[var(--so-card)] shadow-[inset_0_0_0_1.5px_var(--so-faint)] hover:shadow-[inset_0_0_0_1.5px_var(--so-ink)]', className)}
    >
      {indeterminate ? <Minus size={12} strokeWidth={3} /> : checked ? <Check size={12} strokeWidth={3} /> : null}
    </button>
  );
}

/** On/off switch. Changes at once; the server catches up. */
export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void | Promise<unknown>; label: string; disabled?: boolean | undefined }): React.JSX.Element {
  const [on, setOn] = useState(checked);
  useEffect(() => setOn(checked), [checked]);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        const v = !on;
        setOn(v);
        void Promise.resolve(onChange(v)).catch(() => setOn(!v));
      }}
      className={cn('hit relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors disabled:opacity-50', on ? 'bg-[var(--so-primary)]' : 'bg-[var(--so-border)]')}
    >
      <span className={cn('inline-block size-[18px] rounded-full bg-[var(--so-card)] shadow-sm transition-transform duration-200 ease-out', on ? 'translate-x-[19px]' : 'translate-x-[3px]')} />
    </button>
  );
}

/* --------------------------------------------------------------- overlays */

function useEscape(on: boolean, close: () => void): void {
  useEffect(() => {
    if (!on) return;
    const k = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [on, close]);
}

/** A panel that slides in from the right over the page. */
export function Drawer({ open, onClose, title, subtitle, actions, children, width = 640, footer }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; width?: number; footer?: ReactNode }): React.JSX.Element | null {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="so-portal fixed inset-0 z-50 flex justify-end bg-[var(--so-overlay)]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside role="dialog" aria-modal="true" style={{ width: 'min(100vw, ' + width + 'px)' }} className="so-drawer flex h-full flex-col bg-[var(--so-frame)] text-[var(--so-ink)] shadow-[0_0_60px_-20px_var(--so-shadow)] sm:m-2 sm:h-[calc(100%-16px)] sm:rounded-[24px]">
        <header className="flex items-start justify-between gap-3 px-5 pb-3 pt-5">
          <div className="min-w-0">
            <div className="text-[15px] font-semibold leading-[22px]">{title}</div>
            {subtitle !== undefined && <div className="mt-0.5 text-[12px] text-[var(--so-muted)]">{subtitle}</div>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            <IconButton icon={X} label="Close" variant="card" size={34} onClick={onClose} />
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
        {footer !== undefined && <footer className="border-t border-[var(--so-line)] px-5 py-3">{footer}</footer>}
      </aside>
    </div>,
    document.body,
  );
}

export function Dialog({ open, onClose, title, subtitle, children, footer, width = 520 }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }): React.JSX.Element | null {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="so-portal fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-[var(--so-overlay)] p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" style={{ width: 'min(94vw, ' + width + 'px)' }} className="so-zoom flex max-h-[calc(100vh-32px)] flex-col rounded-[24px] bg-[var(--so-card)] text-[var(--so-ink)] shadow-2xl">
        <div className="flex items-start justify-between gap-3 px-6 pb-2 pt-5">
          <div className="min-w-0">
            <p className="text-[15px] font-semibold leading-[22px]">{title}</p>
            {subtitle !== undefined && <p className="mt-0.5 text-[12px] text-[var(--so-muted)]">{subtitle}</p>}
          </div>
          <IconButton icon={X} label="Close" size={32} onClick={onClose} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-3">{children}</div>
        {footer !== undefined && <div className="flex flex-wrap justify-end gap-2 px-6 pb-5 pt-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/** A small menu under a button (the kebab on a row). */
export function Menu({ items, label = 'More', icon = MoreHorizontal, variant = 'ghost', size = 32, trigger }: { items: MenuItem[]; label?: string; icon?: LucideIcon; variant?: 'tile' | 'card' | 'ghost'; size?: number; trigger?: ReactNode }): React.JSX.Element {
  const [pos, setPos] = useState<{ x: number; y: number; up: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setPos(null), []);
  useEscape(pos !== null, close);
  useEffect(() => {
    if (pos === null) return;
    const away = (): void => setPos(null);
    window.addEventListener('scroll', away, true);
    window.addEventListener('resize', away);
    return () => {
      window.removeEventListener('scroll', away, true);
      window.removeEventListener('resize', away);
    };
  }, [pos]);
  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={pos !== null}
        style={trigger === undefined ? { width: size, height: size } : { height: size }}
        onClick={(e) => {
          e.stopPropagation();
          const r = btn.current?.getBoundingClientRect();
          if (!r) return;
          const up = r.bottom + 40 * items.length + 16 > window.innerHeight;
          setPos({ x: Math.min(r.right, window.innerWidth - 8), y: up ? r.top - 6 : r.bottom + 6, up });
        }}
        className={cn('hit inline-flex shrink-0 items-center justify-center rounded-full text-[var(--so-ink-2)]', trigger !== undefined && 'gap-1.5 pl-1 pr-2.5', variant === 'ghost' && 'hover:bg-[var(--so-tile)] hover:text-[var(--so-ink)]', variant === 'tile' && 'bg-[var(--so-tile)] hover:bg-[var(--so-tile-hover)]', variant === 'card' && 'bg-[var(--so-card)] shadow-[inset_0_0_0_1px_var(--so-border)] hover:bg-[var(--so-row-hover)]')}
      >
        {trigger !== undefined
          ? trigger
          : (() => {
              const I = icon;
              return <I size={Math.round(size * 0.5)} strokeWidth={2} aria-hidden />;
            })()}
      </button>
      {pos !== null &&
        createPortal(
          <div className="so-portal fixed inset-0 z-[70]" onMouseDown={() => setPos(null)}>
            <div
              role="menu"
              onMouseDown={(e) => e.stopPropagation()}
              className="so-drop absolute min-w-[200px] rounded-[16px] bg-[var(--so-card)] p-1.5 text-[var(--so-ink)] shadow-[0_18px_50px_-12px_var(--so-shadow)] ring-1 ring-[var(--so-border)]"
              style={{ right: window.innerWidth - pos.x, top: pos.up ? undefined : pos.y, bottom: pos.up ? window.innerHeight - pos.y : undefined }}
            >
              {items.map((it) => {
                const I = it.icon;
                return (
                  <button
                    key={it.label}
                    type="button"
                    role="menuitem"
                    disabled={it.disabled}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPos(null);
                      it.onSelect();
                    }}
                    className={cn('flex h-9 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-left text-[13px] font-medium disabled:opacity-40', it.danger ? 'text-[var(--so-red-text)] hover:bg-[var(--so-red-soft)]' : 'hover:bg-[var(--so-tile)]')}
                  >
                    {I !== undefined && <I size={15} strokeWidth={2} aria-hidden />}
                    {it.label}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/* --------------------------------------------------------------- tooltip */

/** Help on hover or focus. */
export function Tip({ text, children, className }: { text: string; children: ReactNode; className?: string }): React.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null);
  if (text === '') return <span className={className}>{children}</span>;
  const show = (): void => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const below = r.top < 80;
    setPos({ x: Math.min(Math.max(8, r.left), window.innerWidth - 290), y: below ? r.bottom + 8 : r.top - 8, below });
  };
  return (
    <span ref={ref} className={cn('inline-flex', className)} onMouseEnter={show} onMouseLeave={() => setPos(null)} onFocus={show} onBlur={() => setPos(null)}>
      {children}
      {pos !== null &&
        createPortal(
          <span role="tooltip" className="so-portal pointer-events-none fixed z-[80] max-w-[280px]" style={{ left: pos.x, top: pos.y, transform: pos.below ? 'none' : 'translateY(-100%)' }}>
            <span className="block rounded-[12px] bg-[var(--so-tooltip)] px-3 py-2 text-[12px] font-medium leading-[18px] text-[var(--so-on-tooltip)] shadow-[0_18px_40px_-18px_var(--so-shadow)]">{text}</span>
          </span>,
          document.body,
        )}
    </span>
  );
}

/* ---------------------------------------------------------------- confirm */

interface Ask {
  title: string;
  body?: string | undefined;
  yes: string;
  no: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
}

let host: ((a: Ask | null) => void) | null = null;

/** Ask before something that cannot be undone. Resolves true on yes. */
export function confirmAsk(title: string, body: string | undefined, yes: string, opts: { danger?: boolean; no?: string } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    if (host === null) {
      resolve(false);
      return;
    }
    host({ title, body, yes, no: opts.no ?? 'Cancel', danger: opts.danger === true, resolve });
  });
}

export function ConfirmHost(): React.JSX.Element | null {
  const [ask, setAsk] = useState<Ask | null>(null);
  const yesRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    host = setAsk;
    return () => {
      host = null;
    };
  }, []);
  useEffect(() => {
    if (ask === null) return;
    yesRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        ask.resolve(false);
        setAsk(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ask]);
  if (ask === null) return null;
  const done = (ok: boolean): void => {
    ask.resolve(ok);
    setAsk(null);
  };
  return createPortal(
    <div className="so-portal fixed inset-0 z-[90] grid place-items-center bg-[var(--so-overlay)] p-4" onMouseDown={(e) => e.target === e.currentTarget && done(false)}>
      <div role="alertdialog" aria-modal="true" aria-label={ask.title} className="so-zoom w-[min(94vw,28rem)] rounded-[24px] bg-[var(--so-card)] p-6 text-[var(--so-ink)] shadow-2xl">
        <p className="text-[15px] font-semibold">{ask.title}</p>
        {ask.body !== undefined && <p className="mt-1 text-[13px] leading-5 text-[var(--so-muted)]">{ask.body}</p>}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button variant="tile" onClick={() => done(false)}>
            {ask.no}
          </Button>
          <button ref={yesRef} type="button" className={buttonClass(ask.danger ? 'danger' : 'primary')} onClick={() => done(true)}>
            {ask.yes}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ---------------------------------------------------------------- tables */

/** Column header cell. */
export function Th({ children, className, align = 'left' }: { children?: ReactNode; className?: string; align?: 'left' | 'right' | 'center' }): React.JSX.Element {
  return <th className={cn('h-10 whitespace-nowrap px-3 text-[12px] font-semibold text-[var(--so-muted)]', align === 'right' && 'text-right', align === 'center' && 'text-center', className)}>{children}</th>;
}

export function Td({ children, className, align = 'left' }: { children?: ReactNode; className?: string; align?: 'left' | 'right' | 'center' }): React.JSX.Element {
  return <td className={cn('h-[52px] px-3 text-[13px]', align === 'right' && 'num text-right', align === 'center' && 'text-center', className)}>{children}</td>;
}

/** A clickable table row; `on` keeps the selected look. */
export function Tr({ children, onClick, on = false, className }: { children: ReactNode; onClick?: () => void; on?: boolean; className?: string }): React.JSX.Element {
  return (
    <tr onClick={onClick} className={cn('border-t border-[var(--so-line)] transition-colors', onClick !== undefined && 'cursor-pointer hover:bg-[var(--so-row-hover)]', on && 'bg-[var(--so-row-hover)]', className)}>
      {children}
    </tr>
  );
}

/**
 * Phones get a list in place of a table: one row per record, the facts that
 * matter stacked. Pair it with a table marked `hidden sm:table`, or for a
 * table too wide for a tablet, `wide` and `hidden lg:table`.
 */
export function PhoneList({ children, label, wide = false }: { children: ReactNode; label?: string; wide?: boolean }): React.JSX.Element {
  return (
    <ul aria-label={label} className={wide ? 'lg:hidden' : 'sm:hidden'}>
      {children}
    </ul>
  );
}

export function PhoneRow({ children, onClick, on = false, lead, end }: { children: ReactNode; onClick?: () => void; on?: boolean; lead?: ReactNode; end?: ReactNode }): React.JSX.Element {
  return (
    <li
      onClick={onClick}
      className={cn(
        'flex items-start gap-3 border-t border-[var(--so-line)] px-3 py-3 transition-colors first:border-t-0',
        onClick !== undefined && 'cursor-pointer hover:bg-[var(--so-row-hover)]',
        on && 'bg-[var(--so-row-hover)]',
      )}
    >
      {lead}
      <div className="min-w-0 flex-1">{children}</div>
      {end}
    </li>
  );
}

/** Stops a tap on a control inside a row from also opening the row. */
export function NoRowTap({ children, className }: { children: ReactNode; className?: string }): React.JSX.Element {
  return (
    <span className={cn('shrink-0', className)} onClick={(e) => e.stopPropagation()}>
      {children}
    </span>
  );
}

/** A card holding a table that scrolls sideways on narrow screens. */
export function TableCard({ children, head, className, foot }: { children: ReactNode; head?: ReactNode; className?: string; foot?: ReactNode }): React.JSX.Element {
  return (
    <Card flush className={cn('overflow-hidden', className)}>
      {head !== undefined && <div className="px-5 pt-4">{head}</div>}
      <div className="relative overflow-x-auto px-2 pb-2">{children}</div>
      {foot !== undefined && <div className="border-t border-[var(--so-line)] px-5 py-3">{foot}</div>}
    </Card>
  );
}
