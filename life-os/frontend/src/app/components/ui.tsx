/**
 * Building blocks of the visual system: cream cards with a leaf and a serif
 * title, pill buttons, chips, area tiles, thin progress bars with a pace
 * mark, rings, a modal, a drawer, a popover, a context menu placed at the
 * pointer, segmented controls, a switch, fields and empty states with a
 * small drawing. Colors come only from --lo-*.
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import * as RadixDialog from '@radix-ui/react-dialog';
import type { LucideIcon } from 'lucide-react';
import { ChevronDown, X } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { Vignette } from './Vignette.tsx';
import type { VignetteKind } from './Vignette.tsx';

/* ------------------------------------------------------------- the leaf */

/** The small leaf before card titles. */
export function Leaf({ size = 16, className }: { size?: number | undefined; className?: string | undefined }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden className={cn('shrink-0', className)}>
      <path d="M13.6 2.2C8.4 2 3.5 4.6 3 9.7c-.1 1.2.2 2.4.8 3.4.9-2.8 2.9-5 5.4-6.4-2 1.7-3.4 3.9-4.1 6.6 1.1.6 2.4.8 3.7.5 4.6-1 5.6-6.4 4.8-11.6Z" fill="var(--lo-moss)" />
      <path d="M5.1 13.4c.9-2.7 2.5-4.9 4.6-6.6" stroke="var(--lo-card)" strokeWidth="0.9" strokeLinecap="round" fill="none" opacity="0.7" />
    </svg>
  );
}

/* ------------------------------------------------------------- surfaces */

export function Card({
  title,
  icon: Icon,
  action,
  extra,
  children,
  className,
  bodyClassName,
  padded = true,
  id,
}: {
  title?: ReactNode | undefined;
  icon?: LucideIcon | undefined;
  action?: { label: string; onClick: () => void } | undefined;
  extra?: ReactNode | undefined;
  children: ReactNode;
  className?: string | undefined;
  bodyClassName?: string | undefined;
  padded?: boolean | undefined;
  id?: string | undefined;
}): React.JSX.Element {
  return (
    <section id={id} className={cn('lo-card flex min-w-0 flex-col @container', className)}>
      {title !== undefined && (
        <header className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-5 pt-4">
          <div className="flex min-w-0 items-center gap-2">
            {Icon !== undefined ? <Icon size={16} className="shrink-0 text-[var(--lo-moss-text)]" aria-hidden /> : <Leaf />}
            <h2 className="serif truncate text-[15px] font-semibold leading-6">{title}</h2>
          </div>
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
            {extra}
            {action !== undefined && (
              <button type="button" onClick={action.onClick} className="rounded-full px-2 py-0.5 text-[13px] font-semibold text-[var(--lo-ink-2)] transition-colors hover:bg-[var(--lo-sunk)] hover:text-[var(--lo-ink)]">
                {action.label}
              </button>
            )}
          </div>
        </header>
      )}
      <div className={cn('min-w-0 flex-1', padded && 'px-5 pb-5 pt-3', bodyClassName)}>{children}</div>
    </section>
  );
}

/** A tile inside a card (stat boxes, notes). */
export function Sunk({ children, className, onClick, title }: { children: ReactNode; className?: string | undefined; onClick?: (() => void) | undefined; title?: string | undefined }): React.JSX.Element {
  if (onClick !== undefined)
    return (
      <button type="button" title={title} onClick={onClick} className={cn('lo-sunk block w-full min-w-0 text-left transition-colors hover:bg-[var(--lo-sunk-hover)]', className)}>
        {children}
      </button>
    );
  return (
    <div title={title} className={cn('lo-sunk min-w-0', className)}>
      {children}
    </div>
  );
}

/* --------------------------------------------------------------- buttons */

export type ButtonVariant = 'primary' | 'soft' | 'ghost' | 'outline' | 'danger' | 'moss' | 'onGrove';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: 'h-7 gap-1.5 px-3 text-[13px]',
  md: 'h-9 gap-2 px-4 text-[14px]',
  lg: 'h-11 gap-2 px-5 text-[15px]',
};

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'border-transparent bg-[var(--lo-primary)] text-white shadow-[var(--lo-shadow-sm)] hover:bg-[var(--lo-primary-hover)]',
  soft: 'border-transparent bg-[var(--lo-sunk)] text-[var(--lo-ink)] hover:bg-[var(--lo-sunk-hover)]',
  ghost: 'border-transparent bg-transparent text-[var(--lo-ink-2)] hover:bg-[var(--lo-sunk)] hover:text-[var(--lo-ink)]',
  outline: 'border-[var(--lo-line)] bg-[var(--lo-card)] text-[var(--lo-ink)] hover:bg-[var(--lo-sunk)]',
  danger: 'border-[var(--lo-line)] bg-[var(--lo-card)] text-[var(--lo-red-text)] hover:bg-[var(--lo-red)]/10',
  moss: 'border-transparent bg-[var(--lo-moss-soft)] text-[var(--lo-moss-text)] hover:brightness-[0.97]',
  onGrove: 'border-transparent bg-[var(--lo-grove-2)] text-[var(--lo-on-grove)] hover:bg-[var(--lo-grove-3)]',
};

export function Button({
  variant = 'soft',
  size = 'md',
  icon: Icon,
  loading = false,
  className,
  children,
  type,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant | undefined; size?: ButtonSize | undefined; icon?: LucideIcon | undefined; loading?: boolean | undefined; ref?: React.Ref<HTMLButtonElement> | undefined }): React.JSX.Element {
  return (
    <button
      type={type ?? 'button'}
      disabled={disabled === true || loading}
      className={cn('inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full border font-bold transition-colors disabled:opacity-50', BUTTON_SIZE[size], BUTTON_VARIANT[variant], className)}
      {...rest}
    >
      {loading ? <Spinner size={size === 'sm' ? 12 : 14} /> : Icon !== undefined ? <Icon size={size === 'sm' ? 14 : 16} strokeWidth={2.1} aria-hidden /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  icon: Icon,
  label,
  variant = 'ghost',
  size = 32,
  active = false,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; variant?: 'ghost' | 'soft' | 'outline' | 'primary' | 'onGrove' | undefined; size?: number | undefined; active?: boolean | undefined; ref?: React.Ref<HTMLButtonElement> | undefined }): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      style={{ width: size, height: size }}
      className={cn(
        'hit-y inline-flex shrink-0 items-center justify-center rounded-full border transition-colors disabled:opacity-40',
        variant === 'ghost' && (active ? 'border-transparent bg-[var(--lo-sunk-hover)] text-[var(--lo-ink)]' : 'border-transparent text-[var(--lo-ink-2)] hover:bg-[var(--lo-sunk)] hover:text-[var(--lo-ink)]'),
        variant === 'soft' && 'border-transparent bg-[var(--lo-sunk)] text-[var(--lo-ink)] hover:bg-[var(--lo-sunk-hover)]',
        variant === 'outline' && 'border-[var(--lo-line)] bg-[var(--lo-card)] text-[var(--lo-ink)] hover:bg-[var(--lo-sunk)]',
        variant === 'primary' && 'border-transparent bg-[var(--lo-primary)] text-white hover:bg-[var(--lo-primary-hover)]',
        variant === 'onGrove' && 'border-transparent text-[var(--lo-on-grove)] hover:bg-[var(--lo-grove-2)]',
        className,
      )}
      {...rest}
    >
      <Icon size={Math.max(13, Math.round(size * 0.5))} strokeWidth={2} aria-hidden />
    </button>
  );
}

export function TextLink({ children, onClick, className }: { children: ReactNode; onClick: () => void; className?: string | undefined }): React.JSX.Element {
  return (
    <button type="button" onClick={onClick} className={cn('inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--lo-ink-2)] underline-offset-4 hover:text-[var(--lo-ink)] hover:underline', className)}>
      {children}
    </button>
  );
}

/* --------------------------------------------------------------- display */

export type Tone = 'neutral' | 'moss' | 'good' | 'warn' | 'bad' | 'accent' | 'agent' | 'ink';

export function Pill({ tone = 'neutral', children, icon: Icon, className, title, onClick }: { tone?: Tone | undefined; children: ReactNode; icon?: LucideIcon | undefined; className?: string | undefined; title?: string | undefined; onClick?: (() => void) | undefined }): React.JSX.Element {
  const cls = cn(
    'inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-[12px] font-bold',
    tone === 'neutral' && 'bg-[var(--lo-sunk)] text-[var(--lo-ink-2)]',
    tone === 'moss' && 'bg-[var(--lo-moss-soft)] text-[var(--lo-moss-text)]',
    tone === 'good' && 'bg-[var(--lo-green)]/14 text-[var(--lo-green-text)]',
    tone === 'warn' && 'bg-[var(--lo-amber)]/20 text-[var(--lo-amber-text)]',
    tone === 'bad' && 'bg-[var(--lo-red)]/12 text-[var(--lo-red-text)]',
    tone === 'accent' && 'bg-[var(--lo-accent-soft)] text-[var(--lo-accent-text)]',
    tone === 'agent' && 'border border-dashed border-[var(--lo-accent)] bg-[var(--lo-accent-soft)] text-[var(--lo-accent-text)]',
    tone === 'ink' && 'bg-[var(--lo-ink)] text-[var(--lo-card)]',
    onClick !== undefined && 'transition-colors hover:brightness-95',
    className,
  );
  const body = (
    <>
      {Icon !== undefined && <Icon size={12} strokeWidth={2.3} aria-hidden />}
      {children}
    </>
  );
  if (onClick !== undefined)
    return (
      <button type="button" title={title} onClick={onClick} className={cls}>
        {body}
      </button>
    );
  return (
    <span title={title} className={cls}>
      {body}
    </span>
  );
}

/** An area's color as a dot. */
export function AreaDot({ kind, size = 8, className }: { kind: string; size?: number | undefined; className?: string | undefined }): React.JSX.Element {
  return <span aria-hidden style={{ width: size, height: size, background: kind !== '' ? `var(--lo-k-${kind})` : 'var(--lo-line)' }} className={cn('inline-block shrink-0 rounded-full', className)} />;
}

/** A small rounded count. */
export function Count({ n, className, tone = 'badge' }: { n: number | undefined; className?: string | undefined; tone?: 'badge' | 'quiet' | undefined }): React.JSX.Element | null {
  if (n === undefined || n <= 0) return null;
  return <span className={cn('num inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[12px] font-extrabold leading-none', tone === 'badge' ? 'bg-[var(--lo-badge)] text-white' : 'bg-[var(--lo-sunk)] text-[var(--lo-ink-2)]', className)}>{n > 99 ? '99+' : n}</span>;
}

/** A thin progress bar, with a mark where it should be by now. */
export function Progress({ value, pace, tone = 'moss', height = 6, className, label, grow = false, color }: { value: number; pace?: number | null | undefined; tone?: 'moss' | 'accent' | 'good' | 'warn' | undefined; height?: number | undefined; className?: string | undefined; label?: string | undefined; grow?: boolean | undefined; color?: string | undefined }): React.JSX.Element {
  const v = Math.max(0, Math.min(1, value));
  const fill = color !== undefined ? color : tone === 'accent' ? 'var(--lo-accent)' : tone === 'good' ? 'var(--lo-green)' : tone === 'warn' ? 'var(--lo-amber)' : 'var(--lo-moss)';
  return (
    <span role="progressbar" aria-label={label} aria-valuenow={Math.round(v * 100)} aria-valuemin={0} aria-valuemax={100} title={label} className={cn('relative block w-full overflow-visible rounded-full bg-[var(--lo-track)]', className)} style={{ height }}>
      <span className={cn('absolute inset-y-0 left-0 rounded-full', grow && 'lo-grow')} style={{ width: `${v * 100}%`, background: fill }} />
      {pace !== undefined && pace !== null && pace > 0 && pace < 1 && <span aria-hidden title="Where it would be on pace today" className="absolute -top-[3px] w-[2px] rounded-full bg-[var(--lo-ink-2)]" style={{ left: `calc(${pace * 100}% - 1px)`, height: height + 6 }} />}
    </span>
  );
}

/** A ring (habit avatars, small progress). */
export function Ring({ value, size = 44, stroke = 4, color = 'var(--lo-moss)', track = 'var(--lo-track)', children, label }: { value: number; size?: number | undefined; stroke?: number | undefined; color?: string | undefined; track?: string | undefined; children?: ReactNode | undefined; label?: string | undefined }): React.JSX.Element {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }} title={label} aria-label={label}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        {v > 0 && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeDasharray={c} strokeDashoffset={c * (1 - v)} strokeLinecap="round" style={{ transition: 'stroke-dashoffset 420ms ease' }} />}
      </svg>
      {children !== undefined && <span className="relative flex items-center justify-center">{children}</span>}
    </span>
  );
}

/** 1 to 5 as dots (energy, mood): click to set, click the same to clear. */
export function ScaleDots({ value, onChange, label, size = 'md', words }: { value: number; onChange?: ((v: number) => void) | undefined; label: string; size?: 'sm' | 'md' | undefined; words?: string[] | undefined }): React.JSX.Element {
  const d = size === 'sm' ? 'size-3' : 'size-4';
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex items-center gap-1.5">
      {[1, 2, 3, 4, 5].map((n) => {
        const on = n <= value;
        const word = words?.[n - 1];
        return onChange !== undefined ? (
          <button key={n} type="button" role="radio" aria-checked={value === n} title={word !== undefined ? `${n}: ${word}` : String(n)} onClick={() => onChange(value === n ? 0 : n)} className={cn('rounded-full border-2 transition-colors', d, on ? 'border-[var(--lo-moss)] bg-[var(--lo-moss)]' : 'border-[var(--lo-line)] bg-transparent hover:border-[var(--lo-moss)]')} />
        ) : (
          <span key={n} aria-hidden className={cn('rounded-full border-2', d, on ? 'border-[var(--lo-moss)] bg-[var(--lo-moss)]' : 'border-[var(--lo-line)]')} />
        );
      })}
    </div>
  );
}

export function Empty({ kind = 'sprout', title, children, action, compact = false }: { kind?: VignetteKind | undefined; title: string; children?: ReactNode | undefined; action?: ReactNode | undefined; compact?: boolean | undefined }): React.JSX.Element {
  return (
    <div className={cn('flex flex-col items-center px-4 text-center', compact ? 'py-4' : 'py-9')}>
      <Vignette kind={kind} size={compact ? 64 : 92} />
      <p className="serif mt-2 text-[15px] font-semibold">{title}</p>
      {children !== undefined && <div className="mt-1 max-w-sm text-[13px] leading-5 text-[var(--lo-muted)]">{children}</div>}
      {action !== undefined && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string | undefined }): React.JSX.Element {
  return <span aria-hidden className={cn('lo-skeleton block h-3.5', className)} />;
}

export function LoadError({ message, onRetry }: { message: string; onRetry?: (() => void) | undefined }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[var(--lo-r)] bg-[var(--lo-red)]/10 px-4 py-3 text-[13px] text-[var(--lo-red-text)]">
      <span>This did not load: {message}</span>
      {onRetry !== undefined && (
        <button type="button" onClick={onRetry} className="font-bold underline-offset-4 hover:underline">
          Try again
        </button>
      )}
    </div>
  );
}

export function Spinner({ size = 16, className }: { size?: number | undefined; className?: string | undefined }): React.JSX.Element {
  return <span aria-label="Working" style={{ width: size, height: size }} className={cn('inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent', className)} />;
}

export function Kbd({ children, className }: { children: ReactNode; className?: string | undefined }): React.JSX.Element {
  return <kbd className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-current/25 px-1 font-sans text-[12px] font-bold leading-none opacity-75', className)}>{children}</kbd>;
}

/* ---------------------------------------------------------------- inputs */

export const inputCls =
  'h-9 w-full min-w-0 rounded-[var(--lo-r-sm)] border border-[var(--lo-line)] bg-[var(--lo-card)] px-3 text-[14px] text-[var(--lo-ink)] outline-none transition-colors placeholder:text-[var(--lo-muted)] hover:border-[var(--lo-ink-2)] focus:border-[var(--lo-accent)]';

export const textareaCls =
  'w-full resize-none rounded-[var(--lo-r-sm)] border border-[var(--lo-line)] bg-[var(--lo-card)] px-3 py-2 text-[14px] leading-5 text-[var(--lo-ink)] outline-none transition-colors placeholder:text-[var(--lo-muted)] hover:border-[var(--lo-ink-2)] focus:border-[var(--lo-accent)]';

export function Select({ value, onChange, options, label, ariaLabel, className }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; label?: string | undefined; ariaLabel?: string | undefined; className?: string | undefined }): React.JSX.Element {
  const select = (
    <div className={cn('relative min-w-0', className)}>
      <select aria-label={ariaLabel ?? label} value={value} onChange={(e) => onChange(e.target.value)} className={cn(inputCls, 'appearance-none truncate pr-9')}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={15} aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--lo-muted)]" />
    </div>
  );
  if (label === undefined) return select;
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[13px] font-bold text-[var(--lo-ink-2)]">{label}</span>
      {select}
    </label>
  );
}

export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode | undefined; error?: string | null | undefined; children: ReactNode; className?: string | undefined }): React.JSX.Element {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <span className="text-[13px] font-bold text-[var(--lo-ink-2)]">{label}</span>
      {children}
      {error ? <span className="text-[12px] font-semibold text-[var(--lo-red-text)]">{error}</span> : hint !== undefined ? <span className="text-[12px] leading-4 text-[var(--lo-muted)]">{hint}</span> : null}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }): React.JSX.Element {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} title={label} onClick={() => onChange(!checked)} className={cn('relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors', checked ? 'bg-[var(--lo-primary)]' : 'bg-[var(--lo-track)]')}>
      <span className={cn('inline-block size-[18px] rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[19px]' : 'translate-x-[3px]')} />
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label, size = 'md', className }: { value: T; options: { value: T; label: string; icon?: LucideIcon | undefined; title?: string | undefined }[]; onChange: (v: T) => void; label: string; size?: 'sm' | 'md' | undefined; className?: string | undefined }): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-full bg-[var(--lo-sunk)] p-1', className)}>
      {options.map((o) => {
        const on = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            title={o.title ?? o.label}
            onClick={() => onChange(o.value)}
            className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 font-bold transition-colors', size === 'sm' ? 'h-6 text-[12px]' : 'h-7 text-[13px]', on ? 'bg-[var(--lo-card)] text-[var(--lo-ink)] shadow-[var(--lo-shadow-sm)]' : 'text-[var(--lo-ink-2)] hover:text-[var(--lo-ink)]')}
          >
            {Icon !== undefined && <Icon size={14} aria-hidden />}
            {o.label}
          </button>
        );
      })}
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
  width = 520,
  icon: Icon,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string | undefined;
  children: ReactNode;
  footer?: ReactNode | undefined;
  width?: number | undefined;
  icon?: LucideIcon | undefined;
}): React.JSX.Element {
  return (
    <RadixDialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="lo-dim fixed inset-0 z-[60] bg-[rgb(30_22_12/0.38)]" />
        <RadixDialog.Content
          style={{ width: `min(94vw, ${width}px)` }}
          className="lo-dialog fixed left-1/2 top-1/2 z-[61] flex max-h-[90vh] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[var(--lo-r-xl)] border border-[var(--lo-hair)] bg-[var(--lo-card)] text-[var(--lo-ink)] shadow-[var(--lo-shadow-lg)] @container"
        >
          <div className="flex items-start justify-between gap-3 px-6 pb-2 pt-5">
            <div className="flex min-w-0 items-center gap-3">
              {Icon !== undefined && (
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--lo-moss-soft)] text-[var(--lo-moss-text)]">
                  <Icon size={17} />
                </span>
              )}
              <div className="min-w-0">
                <RadixDialog.Title className="serif text-[15px] font-semibold leading-6">{title}</RadixDialog.Title>
                <RadixDialog.Description className={description !== undefined ? 'mt-0.5 text-[13px] leading-5 text-[var(--lo-muted)]' : 'sr-only'}>{description ?? title}</RadixDialog.Description>
              </div>
            </div>
            <IconButton icon={X} label="Close" onClick={onClose} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-3">{children}</div>
          {footer !== undefined && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--lo-hair)] px-6 py-4">{footer}</div>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/** A right-side panel (task and record details). */
export function Drawer({ open, onClose, title, children, width = 440, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; width?: number | undefined; footer?: ReactNode | undefined }): React.JSX.Element {
  return (
    <RadixDialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="lo-dim fixed inset-0 z-[60] bg-[rgb(30_22_12/0.22)]" />
        <RadixDialog.Content style={{ width: `min(96vw, ${width}px)` }} className="lo-drawer fixed bottom-0 right-0 top-0 z-[61] flex flex-col border-l border-[var(--lo-hair)] bg-[var(--lo-card)] text-[var(--lo-ink)] shadow-[var(--lo-shadow-lg)] @container">
          <div className="flex h-14 items-center justify-between gap-2 border-b border-[var(--lo-hair)] px-5">
            <RadixDialog.Title className="serif truncate text-[15px] font-semibold">{title}</RadixDialog.Title>
            <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
            <IconButton icon={X} label="Close" onClick={onClose} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          {footer !== undefined && <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--lo-hair)] px-5 py-3">{footer}</div>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/** `const [el, confirm] = useConfirm()`; render el once; `await confirm(...)`. */
export function useConfirm(): [ReactNode, (message: string, title: string, confirmLabel?: string | undefined) => Promise<boolean>] {
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
        width={440}
        footer={
          <>
            <Button variant="ghost" onClick={() => settle(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => settle(true)} autoFocus>
              {state.label}
            </Button>
          </>
        }
      >
        <p className="pb-2 text-[14px] leading-6 text-[var(--lo-ink-2)]">{state.message}</p>
      </Modal>
    ) : null;
  return [el, confirm];
}

export const menuItem =
  'flex h-9 w-full items-center gap-2.5 rounded-[var(--lo-r-sm)] px-3 text-left text-[14px] font-semibold text-[var(--lo-ink)] hover:bg-[var(--lo-sunk)] disabled:opacity-40 disabled:hover:bg-transparent [&>svg]:shrink-0 [&>svg]:text-[var(--lo-ink-2)]';

/**
 * A floating panel under its anchor (or at a point), drawn in the page's top
 * layer so scroll areas never clip it; closes on outside click and Escape.
 */
export function Popover({
  open,
  onClose,
  children,
  anchor,
  at,
  align = 'left',
  side = 'bottom',
  className,
  keep,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  anchor?: React.RefObject<HTMLElement | null> | undefined;
  at?: { x: number; y: number } | null | undefined;
  align?: 'left' | 'right' | undefined;
  side?: 'bottom' | 'top' | 'right' | undefined;
  className?: string | undefined;
  keep?: React.RefObject<HTMLElement | null> | undefined;
}): React.JSX.Element | null {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = (): void => {
      const el = ref.current;
      if (el === null) return;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      let left = 0;
      let top = 0;
      if (at) {
        left = at.x;
        top = at.y;
      } else if (anchor?.current) {
        const r = anchor.current.getBoundingClientRect();
        if (side === 'right') {
          left = r.right + 6;
          top = r.top;
        } else {
          left = align === 'left' ? r.left : r.right - w;
          top = side === 'top' ? r.top - h - 6 : r.bottom + 6;
        }
      }
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      if (top + h > window.innerHeight - 8) top = Math.max(8, (at ? at.y : anchor?.current ? anchor.current.getBoundingClientRect().top : top) - h - 6);
      top = Math.max(8, top);
      setPos({ left, top });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, anchor, at, align, side]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (keep?.current?.contains(t) === true) return;
      if (anchor?.current?.contains(t) === true && at === undefined) return;
      if (ref.current !== null && !ref.current.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const t = setTimeout(() => document.addEventListener('mousedown', onDoc), 0);
    document.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose, keep, anchor, at]);
  if (!open) return null;
  const host = (anchor?.current?.closest('[role="dialog"]') as HTMLElement | null) ?? document.body;
  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{ position: 'fixed', left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
      className={cn('lo-pop z-[80] rounded-[var(--lo-r-lg)] border border-[var(--lo-hair)] bg-[var(--lo-card)] p-1.5 text-[var(--lo-ink)] shadow-[var(--lo-shadow-lg)]', className)}
    >
      {children}
    </div>,
    host,
  );
}

/* -------------------------------------------------------- context menus */

export interface MenuEntry {
  label: string;
  icon?: LucideIcon | undefined;
  onClick?: (() => void) | undefined;
  danger?: boolean | undefined;
  disabled?: boolean | undefined;
  hint?: string | undefined;
  divider?: boolean | undefined;
}

interface MenuState {
  x: number;
  y: number;
  items: MenuEntry[];
}

type OpenMenu = (e: { clientX: number; clientY: number; preventDefault: () => void }, items: MenuEntry[]) => void;

const MenuCtx = createContext<OpenMenu>(() => undefined);

/** One context menu for the whole app: `const open = useContextMenu(); onContextMenu={(e) => open(e, items)}`. */
export function MenuProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [state, setState] = useState<MenuState | null>(null);
  const open = useCallback<OpenMenu>((e, items) => {
    e.preventDefault();
    setState({ x: e.clientX, y: e.clientY, items: items });
  }, []);
  return (
    <MenuCtx.Provider value={open}>
      {children}
      <Popover open={state !== null} onClose={() => setState(null)} at={state ? { x: state.x, y: state.y } : null} className="w-60">
        {state?.items.map((it, i) =>
          it.divider ? (
            <div key={i} className="my-1 h-px bg-[var(--lo-hair)]" />
          ) : (
            <button
              key={i}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              onClick={() => {
                setState(null);
                it.onClick?.();
              }}
              className={cn(menuItem, it.danger && 'text-[var(--lo-red-text)] [&>svg]:text-[var(--lo-red-text)]')}
            >
              {it.icon !== undefined && <it.icon size={15} />}
              <span className="min-w-0 flex-1 truncate">{it.label}</span>
              {it.hint !== undefined && <Kbd>{it.hint}</Kbd>}
            </button>
          ),
        )}
      </Popover>
    </MenuCtx.Provider>
  );
}

export function useContextMenu(): OpenMenu {
  return useContext(MenuCtx);
}

/** A "⋯"-style menu button that opens the same menu under itself. */
export function MenuButton({ items, label = 'More', icon, size = 32 }: { items: MenuEntry[]; label?: string | undefined; icon: LucideIcon; size?: number | undefined }): React.JSX.Element {
  const open = useContextMenu();
  const ref = useRef<HTMLButtonElement | null>(null);
  return (
    <IconButton
      ref={ref}
      icon={icon}
      label={label}
      size={size}
      onClick={() => {
        const r = ref.current?.getBoundingClientRect();
        if (r) open({ clientX: Math.max(8, r.right - 240), clientY: r.bottom + 4, preventDefault: () => undefined }, items);
      }}
    />
  );
}
