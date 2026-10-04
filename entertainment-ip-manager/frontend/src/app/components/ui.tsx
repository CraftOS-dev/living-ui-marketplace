/**
 * IP Manager primitive layer (the Company OS / Command Center language):
 * - hierarchy from weight and muted grays, not size jumps; one accent used
 *   only for interaction and the current thing;
 * - color otherwise means STATE: green in force, amber attention, red
 *   overdue or refused, blue pending;
 * - every enum renders as a dot + tinted pill; numbers are tabular;
 * - references and office numbers are monospace;
 * - empty states: icon, one headline, one line, one action.
 */
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button, Card, CardContent, Tooltip, cn } from '../../kit/index.ts';
import type { Tone } from '../lib/labels.ts';
import { jurisdictionName } from '../lib/labels.ts';
import { initials } from '../lib/format.ts';
import { enumLabel, t } from '../lib/i18n.ts';
import { toneOf } from '../lib/labels.ts';

export const TONE_TEXT: Record<Tone, string> = {
  good: 'text-emerald-700 dark:text-emerald-400',
  warn: 'text-amber-700 dark:text-amber-400',
  bad: 'text-red-700 dark:text-red-400',
  info: 'text-sky-700 dark:text-sky-400',
  accent: 'text-[var(--agent-app-accent)]',
  neutral: 'text-[var(--agent-app-muted)]',
};

export const TONE_BG: Record<Tone, string> = {
  good: 'bg-emerald-500/10',
  warn: 'bg-amber-500/10',
  bad: 'bg-red-500/10',
  info: 'bg-sky-500/10',
  accent: 'bg-[var(--agent-app-accent)]/10',
  neutral: 'bg-[var(--agent-app-border)]/40',
};

export const TONE_DOT: Record<Tone, string> = {
  good: 'bg-emerald-500',
  warn: 'bg-amber-500',
  bad: 'bg-red-500',
  info: 'bg-sky-500',
  accent: 'bg-[var(--agent-app-accent)]',
  neutral: 'bg-[var(--agent-app-muted)]/60',
};

export const TONE_BAR: Record<Tone, string> = {
  good: 'bg-emerald-500',
  warn: 'bg-amber-500',
  bad: 'bg-red-500',
  info: 'bg-sky-500',
  accent: 'bg-[var(--agent-app-accent)]',
  neutral: 'bg-[var(--agent-app-border)]',
};

export function Dot({ tone, className }: { tone: Tone; className?: string | undefined }): React.JSX.Element {
  return <span aria-hidden className={cn('inline-block size-1.5 shrink-0 rounded-full', TONE_DOT[tone], className)} />;
}

/** Status pill: dot + label on a tinted background. The one way an enum renders. */
export function Pill({
  tone,
  children,
  className,
  title,
}: {
  tone: Tone;
  children: ReactNode;
  className?: string | undefined;
  title?: string | undefined;
}): React.JSX.Element {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap px-2 py-0.5 text-xs font-medium',
        TONE_BG[tone],
        TONE_TEXT[tone],
        className,
      )}
    >
      <Dot tone={tone} />
      {children}
    </span>
  );
}

/** Small uppercase tag (source, kind) without a dot. */
export function Tag({ children, className, title }: { children: ReactNode; className?: string | undefined; title?: string | undefined }): React.JSX.Element {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center whitespace-nowrap border border-[var(--agent-app-border)] px-1.5 text-[10px] font-semibold uppercase leading-4 tracking-wider text-[var(--agent-app-muted)]',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Office / country code chip (WIPO ST.3). */
export function JurChip({ code, className }: { code: string; className?: string | undefined }): React.JSX.Element {
  const c = (code || '').toUpperCase();
  return (
    <span
      title={jurisdictionName(c)}
      className={cn(
        'inline-flex h-[18px] min-w-[26px] items-center justify-center border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-1 font-mono text-[10.5px] font-semibold text-[var(--agent-app-text)]/80',
        className,
      )}
    >
      {c || '--'}
    </span>
  );
}

/** Reference text: monospace, struck through when the right is dead. */
export function Ref({ children, dead = false, className }: { children: ReactNode; dead?: boolean | undefined; className?: string | undefined }): React.JSX.Element {
  return (
    <span className={cn('font-mono text-[12px] text-[var(--agent-app-text)]/75', dead && 'line-through opacity-60', className)}>
      {children}
    </span>
  );
}

const CHIP_HUES = [
  'bg-orange-500/15 text-orange-700 dark:text-orange-400',
  'bg-sky-500/15 text-sky-700 dark:text-sky-400',
  'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  'bg-violet-500/15 text-violet-700 dark:text-violet-400',
  'bg-rose-500/15 text-rose-700 dark:text-rose-400',
  'bg-teal-500/15 text-teal-700 dark:text-teal-400',
  'bg-amber-500/15 text-amber-700 dark:text-amber-500',
];

export function IdentityChip({
  name,
  size = 'md',
  square = false,
  className,
  title,
}: {
  name: string;
  size?: 'xs' | 'sm' | 'md' | undefined;
  square?: boolean | undefined;
  className?: string | undefined;
  title?: string | undefined;
}): React.JSX.Element {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const hue = CHIP_HUES[Math.abs(hash) % CHIP_HUES.length];
  return (
    <span
      aria-hidden={title === undefined}
      title={title}
      className={cn(
        'flex shrink-0 select-none items-center justify-center font-semibold',
        size === 'xs' ? 'size-[18px] text-[8.5px]' : size === 'sm' ? 'size-5 text-[9px]' : 'size-7 text-[11px]',
        square ? '' : 'rounded-full',
        hue,
        className,
      )}
    >
      {initials(name || '?')}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Page scaffolding                                                    */
/* ------------------------------------------------------------------ */

export function PageHeader({
  title,
  meta,
  subtitle,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  meta?: string | undefined;
  subtitle?: ReactNode | undefined;
  actions?: ReactNode | undefined;
  eyebrow?: ReactNode | undefined;
}): React.JSX.Element {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {eyebrow !== undefined && (
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{eyebrow}</div>
        )}
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {meta !== undefined && <span className="text-sm tabular-nums text-[var(--agent-app-muted)]">{meta}</span>}
        </div>
        {subtitle !== undefined && (
          <div className="mt-1 max-w-2xl text-[13px] leading-relaxed text-[var(--agent-app-muted)]">{subtitle}</div>
        )}
      </div>
      {actions !== undefined && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Section({
  title,
  meta,
  actions,
  children,
  className,
  flush = false,
  id,
}: {
  title: ReactNode;
  meta?: string | undefined;
  actions?: ReactNode | undefined;
  children: ReactNode;
  className?: string | undefined;
  flush?: boolean | undefined;
  id?: string | undefined;
}): React.JSX.Element {
  return (
    <Card className={cn('overflow-hidden', className)} id={id}>
      <div className="flex min-h-10 items-center justify-between gap-3 border-b border-[var(--agent-app-border)] px-4 py-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="truncate text-[13px] font-semibold">{title}</h2>
          {meta !== undefined && <span className="text-xs tabular-nums text-[var(--agent-app-muted)]">{meta}</span>}
        </div>
        {actions !== undefined && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      </div>
      <CardContent className={flush ? 'p-0' : 'p-4'}>{children}</CardContent>
    </Card>
  );
}

export function GroupHeader({
  label,
  count,
  right,
  tone,
}: {
  label: string;
  count?: number | undefined;
  right?: ReactNode | undefined;
  tone?: Tone | undefined;
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between border-b border-[var(--agent-app-border)]/70 bg-[var(--agent-app-border)]/25 px-4 py-1.5">
      <span
        className={cn(
          'flex items-baseline gap-2 text-[11px] font-semibold uppercase tracking-wider',
          tone !== undefined ? TONE_TEXT[tone] : 'text-[var(--agent-app-muted)]',
        )}
      >
        {label}
        {count !== undefined && <span className="font-normal tabular-nums">{count}</span>}
      </span>
      {right}
    </div>
  );
}

export function ListRow({
  leading,
  primary,
  secondary,
  trailing,
  hoverActions,
  onClick,
  className,
  selected = false,
}: {
  leading?: ReactNode | undefined;
  primary: ReactNode;
  secondary?: ReactNode | undefined;
  trailing?: ReactNode | undefined;
  hoverActions?: ReactNode | undefined;
  onClick?: (() => void) | undefined;
  className?: string | undefined;
  selected?: boolean | undefined;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'group flex min-h-11 items-center gap-3 border-b border-[var(--agent-app-border)]/70 px-4 py-2 transition-colors last:border-0',
        onClick !== undefined && 'cursor-pointer hover:bg-[var(--agent-app-border)]/20',
        selected && 'bg-[var(--agent-app-accent)]/5',
        className,
      )}
      onClick={onClick}
      role={onClick !== undefined ? 'button' : undefined}
      tabIndex={onClick !== undefined ? 0 : undefined}
      onKeyDown={
        onClick !== undefined
          ? (e) => {
              if (e.key === 'Enter') onClick();
            }
          : undefined
      }
    >
      {leading}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{primary}</div>
        {secondary !== undefined && <div className="truncate text-xs text-[var(--agent-app-muted)]">{secondary}</div>}
      </div>
      {trailing !== undefined && <div className="flex shrink-0 items-center gap-3">{trailing}</div>}
      {hoverActions !== undefined && (
        <div
          className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          {hoverActions}
        </div>
      )}
    </div>
  );
}

export function StatTile({
  label,
  value,
  sub,
  tone,
  onClick,
  big = false,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode | undefined;
  tone?: Tone | undefined;
  onClick?: (() => void) | undefined;
  big?: boolean | undefined;
}): React.JSX.Element {
  const inner = (
    <CardContent className="px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--agent-app-muted)]">{label}</p>
      <p
        className={cn(
          'mt-1 whitespace-nowrap font-semibold tabular-nums tracking-tight',
          big ? 'text-[26px] leading-8' : 'text-xl leading-7',
          tone !== undefined ? TONE_TEXT[tone] : undefined,
        )}
      >
        {value}
      </p>
      {sub !== undefined && <div className="mt-0.5 text-xs text-[var(--agent-app-muted)]">{sub}</div>}
    </CardContent>
  );
  if (onClick === undefined) return <Card>{inner}</Card>;
  return (
    <Card className="transition-colors hover:border-[var(--agent-app-accent)]/50">
      <button type="button" onClick={onClick} className="w-full text-left">
        {inner}
      </button>
    </Card>
  );
}

export function EmptyHint({
  icon: Icon,
  title,
  message,
  action,
  compact = false,
}: {
  icon?: LucideIcon | undefined;
  title: string;
  message?: ReactNode | undefined;
  action?: ReactNode | undefined;
  compact?: boolean | undefined;
}): React.JSX.Element {
  return (
    <div className={cn('flex flex-col items-center gap-2 px-6 text-center', compact ? 'py-8' : 'py-14')}>
      {Icon !== undefined && (
        <span className="mb-1 flex size-10 items-center justify-center bg-[var(--agent-app-border)]/30 text-[var(--agent-app-muted)]">
          <Icon size={18} aria-hidden />
        </span>
      )}
      <p className="text-sm font-semibold">{title}</p>
      {message !== undefined && <div className="max-w-sm text-[13px] leading-relaxed text-[var(--agent-app-muted)]">{message}</div>}
      {action !== undefined && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Loading({ label }: { label?: string | undefined }): React.JSX.Element {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--agent-app-muted)]">
      <Loader2 size={16} className="animate-spin" aria-hidden />
      {label ?? t('Loading')}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: (() => void) | undefined }): React.JSX.Element {
  return (
    <div className="flex items-start gap-3 border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-700 dark:text-red-300">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{message}</div>
      {onRetry !== undefined && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          {t('Try again')}
        </Button>
      )}
    </div>
  );
}

export function Notice({ tone = 'info', children, icon: Icon }: { tone?: Tone | undefined; children: ReactNode; icon?: LucideIcon | undefined }): React.JSX.Element {
  return (
    <div className={cn('flex items-start gap-2.5 border px-3 py-2.5 text-[13px] leading-relaxed', TONE_BG[tone], 'border-[var(--agent-app-border)]')}>
      {Icon !== undefined && <Icon size={15} className={cn('mt-0.5 shrink-0', TONE_TEXT[tone])} aria-hidden />}
      <div className="min-w-0 flex-1 text-[var(--agent-app-text)]/90">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Facts and fields                                                    */
/* ------------------------------------------------------------------ */

/** A label/value fact; `inid` shows the WIPO INID code (e.g. 21, 22, 111). */
export function Fact({
  label,
  value,
  inid,
  mono = false,
  className,
}: {
  label: string;
  value: ReactNode;
  inid?: string | undefined;
  mono?: boolean | undefined;
  className?: string | undefined;
}): React.JSX.Element {
  const empty = value === '' || value === null || value === undefined;
  return (
    <div className={cn('min-w-0', className)}>
      <div className="flex items-baseline gap-1 text-[11px] text-[var(--agent-app-muted)]">
        {inid !== undefined && (
          <Tooltip content={`WIPO INID code (${inid})`}>
            <span className="font-mono text-[10px] text-[var(--agent-app-accent)]">({inid})</span>
          </Tooltip>
        )}
        {label}
      </div>
      <div className={cn('mt-0.5 truncate text-[13px]', mono && 'font-mono text-[12.5px]', empty && 'text-[var(--agent-app-muted)]')}>
        {empty ? '-' : value}
      </div>
    </div>
  );
}

export function FactGrid({ children, cols = 3 }: { children: ReactNode; cols?: 2 | 3 | 4 | undefined }): React.JSX.Element {
  return (
    <div
      className={cn(
        'grid gap-x-6 gap-y-4',
        cols === 2 ? 'grid-cols-1 sm:grid-cols-2' : cols === 4 ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-2 lg:grid-cols-3',
      )}
    >
      {children}
    </div>
  );
}

/** Form row: label, control, help. */
export function Field({
  label,
  children,
  help,
  error,
  required = false,
  htmlFor,
}: {
  label: string;
  children: ReactNode;
  help?: ReactNode | undefined;
  error?: string | undefined;
  required?: boolean | undefined;
  htmlFor?: string | undefined;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[13px] font-medium">
        {label}
        {required && <span className="ml-0.5 text-red-600">*</span>}
      </label>
      {children}
      {error !== undefined && error !== '' ? (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : help !== undefined ? (
        <p className="text-xs leading-relaxed text-[var(--agent-app-muted)]">{help}</p>
      ) : null}
    </div>
  );
}

/** Segmented control for 2 to 6 options. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
  ariaLabel,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: ReactNode; tone?: Tone | undefined; title?: string | undefined }>;
  onChange: (v: T) => void;
  size?: 'sm' | 'md' | undefined;
  ariaLabel?: string | undefined;
}): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)]">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              'border-r border-[var(--agent-app-border)] font-medium transition-colors last:border-r-0',
              size === 'sm' ? 'px-2 py-0.5 text-[11.5px]' : 'px-3 py-1 text-[12.5px]',
              on
                ? o.tone !== undefined
                  ? cn(TONE_BG[o.tone], TONE_TEXT[o.tone], 'font-semibold')
                  : 'bg-[var(--agent-app-accent)] text-[var(--agent-app-accent-contrast)]'
                : 'text-[var(--agent-app-text)]/75 hover:bg-[var(--agent-app-border)]/30',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  disabled = false,
  indeterminate = false,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode | undefined;
  disabled?: boolean | undefined;
  indeterminate?: boolean | undefined;
  ariaLabel?: string | undefined;
}): React.JSX.Element {
  return (
    <label className={cn('inline-flex items-center gap-2 text-[13px]', disabled && 'opacity-50')} onClick={(e) => e.stopPropagation()}>
      <input
        type="checkbox"
        className="size-3.5 accent-[var(--agent-app-accent)]"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        ref={(el) => {
          if (el !== null) el.indeterminate = indeterminate && !checked;
        }}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

export function Kbd({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <kbd className="border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-1 font-mono text-[10px] text-[var(--agent-app-muted)]">
      {children}
    </kbd>
  );
}

export function Toolbar({ children, className }: { children: ReactNode; className?: string | undefined }): React.JSX.Element {
  return <div className={cn('mb-4 flex flex-wrap items-center gap-2', className)}>{children}</div>;
}

/** Plain text area of long content with preserved line breaks. */
export function Prose({ children, className }: { children: ReactNode; className?: string | undefined }): React.JSX.Element {
  return <div className={cn('whitespace-pre-wrap text-[13px] leading-relaxed', className)}>{children}</div>;
}

/** A select value as a status pill: tone from labels.toneOf, label from enums (translated). */
export function EnumPill({ field, value, className }: { field: string; value: string | null | undefined; className?: string | undefined }): React.JSX.Element | null {
  if (value === null || value === undefined || value === '') return null;
  return (
    <Pill tone={toneOf(field, value)} className={className}>
      {enumLabel(field, value)}
    </Pill>
  );
}
