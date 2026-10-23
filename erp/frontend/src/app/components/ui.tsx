/**
 * Building blocks of the visual system: rounded cards (white, sand, dark),
 * pill buttons and inputs, round icon buttons, status pills, avatars, a
 * modal, a confirm dialog, a popover, a day picker and loading skeletons.
 * Colors come only from --erp-* (lib/themeColors.ts).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import type { LucideIcon } from 'lucide-react';
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, Sparkles, X } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { addMonths, dayLabel, monthLabel, today } from '../lib/dates.ts';
import { initials } from '../lib/format.ts';

export { errMessage } from '../lib/api.ts';

/* ------------------------------------------------------------- surfaces */

export type CardTone = 'white' | 'sand' | 'dark';

export function Card({
  tone = 'white',
  className,
  children,
  delay = 0,
  padded = true,
  id,
}: {
  tone?: CardTone | undefined;
  className?: string | undefined;
  children: ReactNode;
  delay?: number | undefined;
  padded?: boolean | undefined;
  id?: string | undefined;
}): React.JSX.Element {
  return (
    <section
      id={id}
      className={cn(
        // A size container: what a card holds lays out by the card's own width (a narrow side column stacks its tiles).
        '@container erp-rise rounded-[24px]',
        padded && 'p-5 @min-[640px]:p-6',
        tone === 'white' && 'bg-[var(--erp-card)] text-[var(--erp-ink)]',
        tone === 'sand' && 'erp-on-sand bg-[var(--erp-sand)] text-[var(--erp-ink)]',
        tone === 'dark' && 'erp-on-dark bg-[var(--erp-dark)] text-[var(--erp-on-dark)]',
        delay > 0 && `erp-d${Math.min(5, delay)}`,
        className,
      )}
    >
      {children}
    </section>
  );
}

export function CardHeader({ title, subtitle, action, dark = false, icon: Icon }: { title: ReactNode; subtitle?: ReactNode | undefined; action?: ReactNode | undefined; dark?: boolean | undefined; icon?: LucideIcon | undefined }): React.JSX.Element {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        {Icon !== undefined && (
          <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full', dark ? 'bg-[var(--erp-dark-2)] text-[var(--erp-accent)]' : 'bg-[var(--erp-row)] text-[var(--erp-ink)]')}>
            <Icon size={16} aria-hidden />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-[15px] font-bold leading-[22px]">{title}</h2>
          {subtitle !== undefined && <div className={cn('mt-0.5 text-[13px]', dark ? 'text-[var(--erp-on-dark-muted)]' : 'text-[var(--erp-muted)]')}>{subtitle}</div>}
        </div>
      </div>
      {action}
    </div>
  );
}

/**
 * A page title with its actions. `back` shows a round back button before the
 * title (detail pages); `eyebrow` is a small line above the title (the kind
 * of record, its state).
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  back,
  eyebrow,
}: {
  title: ReactNode;
  subtitle?: ReactNode | undefined;
  actions?: ReactNode | undefined;
  back?: (() => void) | undefined;
  eyebrow?: ReactNode | undefined;
}): React.JSX.Element {
  return (
    <header className="erp-rise mb-6 flex flex-wrap items-start justify-between gap-4 @min-[640px]:mb-7">
      <div className="flex min-w-0 items-start gap-3">
        {back !== undefined && <CircleButton icon={ArrowLeft} label="Back" variant="light" size={40} onClick={back} className="mt-[-3px] shrink-0" />}
        <div className="min-w-0">
          {eyebrow !== undefined && <div className="mb-1 flex flex-wrap items-center gap-2 text-[12px] font-semibold text-[var(--erp-muted)]">{eyebrow}</div>}
          <h1 className="break-words text-[26px] font-bold leading-[34px] tracking-[-0.01em]">{title}</h1>
          {subtitle !== undefined && <div className="mt-1 text-[13px] text-[var(--erp-muted)]">{subtitle}</div>}
        </div>
      </div>
      {actions !== undefined && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A labelled number: the big figures on cards ("Owed to you 12,400.00"). */
export function Figure({ label, value, sub, tone = 'ink', size = 'lg', onClick }: { label: ReactNode; value: ReactNode; sub?: ReactNode | undefined; tone?: 'ink' | 'red' | 'green' | 'muted' | undefined; size?: 'lg' | 'md' | undefined; onClick?: (() => void) | undefined }): React.JSX.Element {
  const body = (
    <>
      <span className="block text-[12px] font-semibold text-[var(--erp-muted)]">{label}</span>
      <span
        className={cn(
          'num block font-extrabold tracking-[-0.02em]',
          size === 'lg' ? 'text-[26px] leading-8' : 'text-[15px] leading-[22px]',
          tone === 'red' && 'text-[var(--erp-red-text)]',
          tone === 'green' && 'text-[var(--erp-green-text)]',
          tone === 'muted' && 'text-[var(--erp-ink-2)]',
        )}
      >
        {value}
      </span>
      {sub !== undefined && <span className="mt-0.5 block text-[12px] text-[var(--erp-muted)]">{sub}</span>}
    </>
  );
  if (onClick === undefined) return <div className="min-w-0">{body}</div>;
  return (
    <button type="button" onClick={onClick} className="min-w-0 rounded-[14px] text-left transition-transform active:scale-[0.98]">
      {body}
    </button>
  );
}

/** A small tile with a label and a number, on a card (dark or light). */
export function Tile({ label, value, onClick, dark = false, className }: { label: ReactNode; value: ReactNode; onClick?: (() => void) | undefined; dark?: boolean | undefined; className?: string | undefined }): React.JSX.Element {
  const cls = cn('rounded-[18px] p-3 text-left', dark ? 'bg-[var(--erp-dark-2)]' : 'bg-[var(--erp-row)]', onClick !== undefined && 'transition-[transform,background] active:scale-[0.98]', onClick !== undefined && !dark && 'hover:bg-[var(--erp-row-hover)]', className);
  const inner = (
    <>
      <span className={cn('block text-[12px]', dark ? 'text-[var(--erp-on-dark-muted)]' : 'text-[var(--erp-muted)]')}>{label}</span>
      <span className="num block truncate text-[15px] font-bold">{value}</span>
    </>
  );
  if (onClick === undefined) return <div className={cls}>{inner}</div>;
  return (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

/* --------------------------------------------------------------- buttons */

/** `light` is a card-colored pill for the shell; `soft` is its row-colored twin for use on cards. */
export type PillVariant = 'dark' | 'light' | 'soft' | 'ghost' | 'danger' | 'accent';

export function PillButton({
  variant = 'dark',
  icon: Icon,
  dot = false,
  loading = false,
  size = 'md',
  className,
  children,
  type,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: PillVariant | undefined; icon?: LucideIcon | undefined; dot?: boolean | undefined; loading?: boolean | undefined; size?: 'md' | 'sm' | undefined }): React.JSX.Element {
  return (
    <button
      type={type ?? 'button'}
      disabled={disabled === true || loading}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold transition-[background,transform,opacity] active:scale-[0.98] disabled:opacity-50',
        size === 'md' ? 'h-11 px-5 text-[14px]' : 'h-9 px-4 text-[13px]',
        variant === 'dark' && 'erp-on-ink bg-[var(--erp-ink)] text-[var(--erp-shell)] hover:bg-[var(--erp-ink)]/90',
        variant === 'light' && 'bg-[var(--erp-card)] text-[var(--erp-ink)] hover:bg-[var(--erp-row)]',
        variant === 'soft' && 'bg-[var(--erp-row)] text-[var(--erp-ink)] hover:bg-[var(--erp-row-hover)]',
        variant === 'ghost' && 'bg-transparent text-[var(--erp-ink-2)] hover:bg-[var(--erp-row)] hover:text-[var(--erp-ink)]',
        variant === 'danger' && 'bg-[var(--erp-red)]/12 text-[var(--erp-red-text)] hover:bg-[var(--erp-red)]/20',
        variant === 'accent' && 'bg-[var(--erp-accent)] text-[var(--erp-on-accent)] hover:opacity-90',
        dot && Icon !== undefined && (size === 'md' ? 'pl-1.5' : 'pl-1'),
        className,
      )}
      {...rest}
    >
      {loading ? (
        <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : dot && Icon !== undefined ? (
        <span className={cn('flex shrink-0 items-center justify-center rounded-full bg-[var(--erp-accent)] text-[var(--erp-on-accent)]', size === 'md' ? 'size-8' : 'size-7')}>
          <Icon size={size === 'md' ? 16 : 14} strokeWidth={2.2} aria-hidden />
        </span>
      ) : Icon !== undefined ? (
        <Icon size={size === 'md' ? 16 : 14} strokeWidth={2} aria-hidden />
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
  badge,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; variant?: 'light' | 'dark' | 'accent' | 'row' | 'onDark' | 'ghost' | undefined; size?: number | undefined; badge?: number | undefined }): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      style={{ width: size, height: size }}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center rounded-full transition-[background,transform,opacity] active:scale-95 disabled:opacity-40',
        variant === 'light' && 'bg-[var(--erp-card)] text-[var(--erp-ink)] hover:bg-[var(--erp-row)]',
        variant === 'row' && 'bg-[var(--erp-row)] text-[var(--erp-ink)] hover:bg-[var(--erp-row-hover)]',
        variant === 'dark' && 'erp-on-ink bg-[var(--erp-ink)] text-[var(--erp-shell)] hover:opacity-90',
        variant === 'accent' && 'bg-[var(--erp-accent)] text-[var(--erp-on-accent)] hover:opacity-90',
        variant === 'onDark' && 'bg-[var(--erp-dark-2)] text-[var(--erp-on-dark)] hover:opacity-90',
        variant === 'ghost' && 'text-[var(--erp-ink-2)] hover:bg-[var(--erp-row)] hover:text-[var(--erp-ink)]',
        className,
      )}
      {...rest}
    >
      <Icon size={Math.round(size * 0.42)} strokeWidth={2} aria-hidden />
      <CountBadge n={badge} />
    </button>
  );
}

/** A count on a round button or nav entry. */
export function CountBadge({ n, className }: { n: number | undefined; className?: string | undefined }): React.JSX.Element | null {
  if (n === undefined || n <= 0) return null;
  return (
    <span
      className={cn(
        'num absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--erp-accent)] px-1 text-[12px] font-bold leading-none text-[var(--erp-on-accent)] ring-2 ring-[var(--erp-shell)]',
        className,
      )}
    >
      {n > 99 ? '99+' : n}
    </span>
  );
}

export function TextLink({ children, onClick, className, tone = 'ink' }: { children: ReactNode; onClick: () => void; className?: string | undefined; tone?: 'ink' | 'muted' | 'red' | undefined }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 text-left text-[13px] font-semibold underline-offset-4 hover:underline',
        tone === 'ink' && 'text-[var(--erp-ink)]',
        tone === 'muted' && 'text-[var(--erp-muted)] hover:text-[var(--erp-ink)]',
        tone === 'red' && 'text-[var(--erp-red-text)]',
        className,
      )}
    >
      {children}
    </button>
  );
}

/* --------------------------------------------------------------- display */

export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'neutral' | 'dark' | 'accent';

export function StatusPill({ tone, children, pulse = false, size = 'md', className }: { tone: Tone; children: ReactNode; pulse?: boolean | undefined; size?: 'md' | 'sm' | undefined; className?: string | undefined }): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full font-semibold',
        size === 'md' ? 'h-7 px-3 text-[12px]' : 'h-6 px-2.5 text-[12px]',
        tone === 'good' && 'bg-[var(--erp-green)]/12 text-[var(--erp-green-text)]',
        tone === 'warn' && 'bg-[var(--erp-amber)]/25 text-[var(--erp-amber-text)]',
        tone === 'bad' && 'bg-[var(--erp-red)]/15 text-[var(--erp-red-text)]',
        tone === 'info' && 'erp-on-ink bg-[var(--erp-ink)] text-[var(--erp-shell)]',
        tone === 'neutral' && 'bg-[var(--erp-row)] text-[var(--erp-ink-2)]',
        tone === 'dark' && 'bg-[var(--erp-dark-2)] text-[var(--erp-on-dark)]',
        tone === 'accent' && 'bg-[var(--erp-accent-soft)] text-[var(--erp-ink)]',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          tone === 'good' && 'bg-[var(--erp-green)]',
          tone === 'warn' && 'bg-[var(--erp-amber)]',
          tone === 'bad' && 'bg-[var(--erp-red)]',
          tone === 'info' && 'bg-[var(--erp-accent)]',
          tone === 'neutral' && 'bg-[var(--erp-muted)]',
          tone === 'dark' && 'bg-[var(--erp-accent)]',
          tone === 'accent' && 'bg-[var(--erp-ink)]',
          pulse && 'erp-pulse',
        )}
      />
      {children}
    </span>
  );
}

/** "Your AI agent" / a person, as a small pill on records and timelines. */
export function ActorPill({ actor, who }: { actor: 'person' | 'agent' | 'system' | string; who?: string | undefined }): React.JSX.Element {
  if (actor === 'agent') {
    return (
      // One line always: in a narrow column it shortens ("Your AI ag...") rather than wrapping over its neighbours.
      <span className="inline-flex h-6 max-w-full items-center gap-1 whitespace-nowrap rounded-full bg-[var(--erp-accent-soft)] px-2.5 text-[12px] font-semibold text-[var(--erp-ink)]">
        <Sparkles size={12} aria-hidden className="shrink-0" /> <span className="truncate">Your AI agent</span>
      </span>
    );
  }
  return (
    <span className="inline-flex h-6 max-w-full items-center whitespace-nowrap rounded-full bg-[var(--erp-row)] px-2.5 text-[12px] font-semibold text-[var(--erp-ink-2)]">
      <span className="truncate">{actor === 'system' ? 'The app' : (who ?? 'Someone')}</span>
    </span>
  );
}

/** A person's initials in a circle (or their photo). */
export function Avatar({ name, photo, size = 36, tone = 'row', agent = false }: { name: string; photo?: string | null | undefined; size?: number | undefined; tone?: 'row' | 'card' | 'ink' | 'accent' | undefined; agent?: boolean | undefined }): React.JSX.Element {
  if (photo !== undefined && photo !== null && photo !== '') {
    return <img src={photo} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-bold',
        tone === 'row' && 'bg-[var(--erp-row)] text-[var(--erp-ink)]',
        tone === 'card' && 'bg-[var(--erp-card)] text-[var(--erp-ink)]',
        tone === 'ink' && 'erp-on-ink bg-[var(--erp-ink)] text-[var(--erp-shell)]',
        tone === 'accent' && 'bg-[var(--erp-accent)] text-[var(--erp-on-accent)]',
      )}
      style={{ width: size, height: size, fontSize: size >= 40 ? 14 : 12 }}
    >
      {agent ? <Sparkles size={Math.round(size * 0.42)} /> : initials(name)}
    </span>
  );
}

export function Empty({ icon: Icon, title, children, action, dark = false, compact = false }: { icon: LucideIcon; title: string; children?: ReactNode | undefined; action?: ReactNode | undefined; dark?: boolean | undefined; compact?: boolean | undefined }): React.JSX.Element {
  return (
    <div className={cn('flex flex-col items-center text-center', compact ? 'px-4 py-6' : 'px-6 py-10')}>
      <span className={cn('mb-4 flex size-14 items-center justify-center rounded-full', dark ? 'bg-[var(--erp-dark-2)] text-[var(--erp-accent)]' : 'bg-[var(--erp-row)] text-[var(--erp-ink)]')}>
        <Icon size={22} strokeWidth={1.8} aria-hidden />
      </span>
      <p className="text-[15px] font-bold">{title}</p>
      {children !== undefined && <div className={cn('mt-1 max-w-sm text-[13px] leading-5', dark ? 'text-[var(--erp-on-dark-muted)]' : 'text-[var(--erp-muted)]')}>{children}</div>}
      {action !== undefined && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

/** Grey shapes where content is loading (no spinner jumping around). */
export function Skeleton({ className, rounded = 'rounded-[18px]' }: { className?: string | undefined; rounded?: string | undefined }): React.JSX.Element {
  return <span aria-hidden className={cn('erp-skeleton block', rounded, className)} />;
}

/** A page-sized loading state. */
export function PageSkeleton({ rows = 6 }: { rows?: number | undefined }): React.JSX.Element {
  return (
    <div aria-label="Loading" className="flex flex-col gap-5">
      <Skeleton className="h-9 w-64" rounded="rounded-full" />
      <div className="grid grid-cols-1 gap-5 @min-[640px]:grid-cols-3">
        <Skeleton className="h-28" rounded="rounded-[24px]" />
        <Skeleton className="h-28" rounded="rounded-[24px]" />
        <Skeleton className="h-28" rounded="rounded-[24px]" />
      </div>
      <div className="flex flex-col gap-2 rounded-[24px] bg-[var(--erp-card)] p-5">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    </div>
  );
}

/** A load that failed: what happened and a way to try again. */
export function LoadError({ message, onRetry }: { message: string; onRetry?: (() => void) | undefined }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[24px] bg-[var(--erp-card)] px-6 py-10 text-center">
      <p className="text-[15px] font-bold">This did not load</p>
      <p className="max-w-md text-[13px] text-[var(--erp-muted)]">{message}</p>
      {onRetry !== undefined && (
        <PillButton variant="soft" onClick={onRetry}>
          Try again
        </PillButton>
      )}
    </div>
  );
}

/** A short warning or note inside a card or form. */
export function Notice({ tone = 'neutral', icon: Icon, children, action }: { tone?: 'neutral' | 'warn' | 'bad' | 'good' | 'agent' | undefined; icon?: LucideIcon | undefined; children: ReactNode; action?: ReactNode | undefined }): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-[18px] px-4 py-3 text-[13px]',
        tone === 'neutral' && 'bg-[var(--erp-row)] text-[var(--erp-ink-2)]',
        tone === 'warn' && 'bg-[var(--erp-amber)]/20 text-[var(--erp-amber-text)]',
        tone === 'bad' && 'bg-[var(--erp-red)]/12 text-[var(--erp-red-text)]',
        tone === 'good' && 'bg-[var(--erp-green)]/12 text-[var(--erp-green-text)]',
        tone === 'agent' && 'bg-[var(--erp-accent-soft)] text-[var(--erp-ink)]',
      )}
    >
      {Icon !== undefined && <Icon size={16} className="mt-0.5 shrink-0" aria-hidden />}
      <div className="min-w-0 flex-1 leading-5">{children}</div>
      {action !== undefined && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------- inputs */

export const pillInput =
  'h-11 w-full rounded-full bg-[var(--erp-card)] px-5 text-[14px] text-[var(--erp-ink)] outline-none ring-[var(--erp-ink)] transition-shadow focus-visible:ring-2 disabled:opacity-60';

export const softInput =
  'h-11 w-full rounded-full bg-[var(--erp-row)] px-5 text-[14px] text-[var(--erp-ink)] outline-none ring-[var(--erp-ink)] transition-shadow focus-visible:ring-2 disabled:opacity-60';

/** Multi-line text on a card. */
export const softArea =
  'min-h-[88px] w-full resize-y rounded-[18px] bg-[var(--erp-row)] px-4 py-3 text-[14px] leading-5 text-[var(--erp-ink)] outline-none ring-[var(--erp-ink)] transition-shadow focus-visible:ring-2';

/** A field inside a dense grid (document lines, timesheets, journals). */
export const cellInput =
  'h-10 w-full min-w-0 rounded-[12px] bg-[var(--erp-row)] px-3 text-[14px] text-[var(--erp-ink)] outline-none ring-[var(--erp-ink)] transition-shadow focus-visible:ring-2 disabled:bg-transparent disabled:opacity-80';

export function PillSelect({
  value,
  onChange,
  options,
  label,
  ariaLabel,
  soft = false,
  className,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label?: string | undefined;
  ariaLabel?: string | undefined;
  soft?: boolean | undefined;
  className?: string | undefined;
  disabled?: boolean | undefined;
}): React.JSX.Element {
  const select = (
    <div className={cn('relative', className)}>
      <select
        aria-label={ariaLabel ?? label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={cn(soft ? softInput : pillInput, 'appearance-none pr-11 font-medium')}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={16} aria-hidden className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[var(--erp-muted)]" />
    </div>
  );
  if (label === undefined) return select;
  return (
    <label className="flex flex-col gap-2">
      <span className="px-1 text-[13px] font-semibold text-[var(--erp-ink-2)]">{label}</span>
      {select}
    </label>
  );
}

export function Field({ label, hint, error, children, className, optional = false }: { label: string; hint?: ReactNode | undefined; error?: string | null | undefined; children: ReactNode; className?: string | undefined; optional?: boolean | undefined }): React.JSX.Element {
  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      <span className="px-1 text-[13px] font-semibold text-[var(--erp-ink-2)]">
        {label}
        {optional && <span className="font-medium text-[var(--erp-muted)]"> (optional)</span>}
      </span>
      {children}
      {error !== undefined && error !== null && error !== '' ? (
        <span className="px-1 text-[12px] font-medium text-[var(--erp-red-text)]">{error}</span>
      ) : hint !== undefined ? (
        <span className="px-1 text-[12px] text-[var(--erp-muted)]">{hint}</span>
      ) : null}
    </div>
  );
}

/** On/off switch: ink track with an accent knob when on. */
export function Toggle({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean | undefined }): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn('erp-on-ink relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50', checked ? 'bg-[var(--erp-ink)]' : 'bg-[var(--erp-track)]')}
    >
      <span className={cn('inline-block size-5 rounded-full shadow-sm transition-transform', checked ? 'translate-x-6 bg-[var(--erp-accent)]' : 'translate-x-1 bg-[var(--erp-card)]')} />
    </button>
  );
}

/** A labelled switch row (settings, options in forms). */
export function ToggleRow({ title, text, checked, onChange, disabled = false }: { title: string; text?: ReactNode | undefined; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean | undefined }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 rounded-[18px] bg-[var(--erp-row)] px-4 py-3">
      <div className="min-w-0">
        <p className="text-[14px] font-semibold">{title}</p>
        {text !== undefined && <p className="text-[12px] text-[var(--erp-muted)]">{text}</p>}
      </div>
      <Toggle checked={checked} onChange={onChange} label={title} disabled={disabled} />
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
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode | undefined;
  children: ReactNode;
  footer?: ReactNode | undefined;
  size?: 'md' | 'lg' | 'xl' | undefined;
}): React.JSX.Element {
  return (
    <RadixDialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px]" />
        <RadixDialog.Content
          className={cn(
            '@container erp-pop fixed left-1/2 top-1/2 z-[61] flex max-h-[92vh] -translate-x-1/2 -translate-y-1/2 flex-col rounded-[28px] bg-[var(--erp-shell)] text-[var(--erp-ink)] shadow-2xl',
            size === 'md' && 'w-[min(94vw,30rem)]',
            size === 'lg' && 'w-[min(94vw,42rem)]',
            size === 'xl' && 'w-[min(94vw,60rem)]',
          )}
        >
          <div className="flex items-start justify-between gap-3 px-6 pb-4 pt-6">
            <div className="min-w-0">
              <RadixDialog.Title className="text-[15px] font-bold">{title}</RadixDialog.Title>
              {description !== undefined ? (
                <RadixDialog.Description asChild>
                  <div className="mt-1 text-[13px] text-[var(--erp-muted)]">{description}</div>
                </RadixDialog.Description>
              ) : (
                <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
              )}
            </div>
            <CircleButton icon={X} label="Close" variant="row" size={36} onClick={onClose} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">{children}</div>
          {footer !== undefined && <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--erp-line)] px-6 py-4">{footer}</div>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

interface ConfirmState {
  message: ReactNode;
  title: string;
  label: string;
  danger: boolean;
}

/** `const [el, confirm] = useConfirm()`; render el once; `if (await confirm(...))`. */
export function useConfirm(): [ReactNode, (message: ReactNode, title: string, confirmLabel?: string, danger?: boolean) => Promise<boolean>] {
  const [state, setState] = useState<ConfirmState | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const confirm = useCallback(
    (message: ReactNode, title: string, confirmLabel = 'Delete', danger = true) =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setState({ message, title, label: confirmLabel, danger });
      }),
    [],
  );
  const settle = (ok: boolean): void => {
    resolver.current?.(ok);
    resolver.current = null;
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
            <PillButton variant="soft" onClick={() => settle(false)}>
              Cancel
            </PillButton>
            <PillButton variant={state.danger ? 'danger' : 'dark'} onClick={() => settle(true)}>
              {state.label}
            </PillButton>
          </>
        }
      >
        <div className="text-[14px] leading-6 text-[var(--erp-ink-2)]">{state.message}</div>
      </Modal>
    ) : null;
  return [el, confirm];
}

/**
 * A small floating panel under its trigger (or beside it: `side="right"`);
 * closes on outside click and Escape. `keep` is the trigger: pressing it
 * toggles instead of closing and reopening. Escape stops here, so a screen
 * behind keeps its own Escape.
 *
 * The panel is drawn in the page's top layer (inside the open dialog, when
 * the trigger is in one), placed from the trigger's box: scroll areas, frozen
 * table columns and the sidebar never clip or cover it. It flips above the
 * trigger when there is no room below and stays inside the window. The
 * trigger's wrapper (the panel's parent in the code) is the anchor.
 */
export function Popover({
  open,
  onClose,
  children,
  align = 'left',
  className,
  keep,
  up = false,
  side = 'below',
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  align?: 'left' | 'right' | undefined;
  className?: string | undefined;
  keep?: React.RefObject<HTMLElement | null> | undefined;
  up?: boolean | undefined;
  side?: 'below' | 'right' | undefined;
}): React.JSX.Element | null {
  const ref = useRef<HTMLDivElement | null>(null);
  const marker = useRef<HTMLSpanElement | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
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
        return;
      }
      // Tab from the trigger goes into the panel, as if it still sat right after it.
      const anchor = marker.current?.parentElement;
      if (e.key === 'Tab' && !e.shiftKey && anchor?.contains(document.activeElement) === true && ref.current !== null) {
        const first = ref.current.querySelector<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])');
        if (first !== null) {
          e.preventDefault();
          first.focus();
        }
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
  // Where the panel lives: the open dialog around the trigger (its focus and clicks stay there), else the page.
  useLayoutEffect(() => {
    if (!open) {
      setHost(null);
      setPos(null);
      return;
    }
    setHost(marker.current?.parentElement?.closest<HTMLElement>('[role="dialog"]') ?? document.body);
  }, [open]);
  useLayoutEffect(() => {
    if (!open || host === null) return;
    const place = (): void => {
      const anchor = marker.current?.parentElement;
      const panel = ref.current;
      if (anchor === null || anchor === undefined || panel === null) return;
      const a = anchor.getBoundingClientRect();
      const w = panel.offsetWidth;
      const h = panel.offsetHeight;
      const edge = 8;
      let left: number;
      let top: number;
      if (side === 'right') {
        left = a.right + 10;
        top = a.top;
      } else {
        left = align === 'left' ? a.left : a.right - w;
        const below = a.bottom + 8;
        const above = a.top - 8 - h;
        const fitsBelow = below + h <= window.innerHeight - edge;
        const fitsAbove = above >= edge;
        top = up ? (fitsAbove || !fitsBelow ? above : below) : fitsBelow || !fitsAbove ? below : above;
      }
      left = Math.max(edge, Math.min(left, window.innerWidth - edge - w));
      top = Math.max(edge, Math.min(top, window.innerHeight - edge - h));
      // A fixed panel inside a transformed dialog is placed against the dialog, not the window.
      const origin = host !== document.body && getComputedStyle(host).transform !== 'none' ? host.getBoundingClientRect() : null;
      setPos({ left: left - (origin?.left ?? 0), top: top - (origin?.top ?? 0) });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    const watch = new ResizeObserver(place);
    if (ref.current !== null) watch.observe(ref.current);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      watch.disconnect();
    };
  }, [open, host, align, up, side]);
  if (!open) return null;
  return (
    <>
      <span ref={marker} hidden />
      {host !== null &&
        createPortal(
          <div
            ref={ref}
            // Placed before the browser paints (layout effect), so the first frame is never seen; it stays focusable for autoFocus.
            style={{ position: 'fixed', left: pos?.left ?? 0, top: pos?.top ?? 0 }}
            className={cn('erp-pop erp-on-card z-[70] rounded-[20px] bg-[var(--erp-card)] p-2 text-[var(--erp-ink)] shadow-[var(--erp-pop-shadow)]', className)}
          >
            {children}
          </div>,
          host,
        )}
    </>
  );
}

/** One row of a menu in a popover. */
export function MenuRow({ icon: Icon, label, onClick, danger = false, hint, active = false }: { icon?: LucideIcon | undefined; label: ReactNode; onClick: () => void; danger?: boolean | undefined; hint?: ReactNode | undefined; active?: boolean | undefined }): React.JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn('flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-left text-[14px] font-semibold hover:bg-[var(--erp-row)]', danger && 'text-[var(--erp-red-text)]', active && 'bg-[var(--erp-row)]')}
    >
      {Icon !== undefined && <Icon size={16} aria-hidden className="shrink-0" />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint !== undefined && <span className="shrink-0 text-[12px] font-medium text-[var(--erp-muted)]">{hint}</span>}
    </button>
  );
}

const WEEK = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** A month of days to pick one from (weeks start on Monday). */
export function DayPicker({ value, onPick, min, max }: { value: string; onPick: (day: string) => void; min?: string | undefined; max?: string | undefined }): React.JSX.Element {
  const [month, setMonth] = useState((value !== '' ? value : today()).slice(0, 7));
  const t = today();
  const [y = 0, m = 1] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const lead = (first.getDay() + 6) % 7;
  const count = new Date(y, m, 0).getDate();
  const days = Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
  return (
    <div className="w-[272px] p-1">
      <div className="mb-2 flex items-center justify-between gap-2">
        <CircleButton icon={ChevronLeft} label="Previous month" variant="row" size={32} onClick={() => setMonth(addMonths(month, -1))} />
        <span className="text-[14px] font-bold">{monthLabel(month)}</span>
        <CircleButton icon={ChevronRight} label="Next month" variant="row" size={32} onClick={() => setMonth(addMonths(month, 1))} />
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEK.map((w, i) => (
          <span key={i} className="py-1 text-[12px] font-semibold text-[var(--erp-muted)]">
            {w}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`b${i}`} />
        ))}
        {days.map((d) => {
          const off = (min !== undefined && d < min) || (max !== undefined && d > max);
          return (
            <button
              key={d}
              type="button"
              disabled={off}
              onClick={() => onPick(d)}
              aria-label={dayLabel(d)}
              aria-pressed={d === value}
              className={cn(
                'num flex aspect-square w-full items-center justify-center rounded-full text-[13px] font-semibold transition-colors disabled:opacity-30',
                d === value ? 'erp-on-ink bg-[var(--erp-ink)] text-[var(--erp-shell)]' : 'hover:bg-[var(--erp-row)]',
                d === t && d !== value && 'ring-1 ring-inset ring-[var(--erp-ink)]',
              )}
            >
              {Number(d.slice(8, 10))}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between gap-2">
        <button type="button" onClick={() => onPick(t)} className="rounded-full px-3 py-1.5 text-[12px] font-bold hover:bg-[var(--erp-row)]">
          Today
        </button>
      </div>
    </div>
  );
}
