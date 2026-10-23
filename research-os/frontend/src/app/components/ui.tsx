/**
 * Building blocks of the visual system: flat panels with a hairline border,
 * compact buttons and fields (28px, 6px corners), icon buttons, status
 * badges, chips, segmented controls and tabs, a modal, a confirm dialog, a
 * popover, a context menu placed at the pointer, rings and property rows.
 * Colors come only from --ro-*.
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import * as RadixDialog from '@radix-ui/react-dialog';
import type { LucideIcon } from 'lucide-react';
import { ChevronDown, Sparkles, X } from 'lucide-react';
import { cn } from '../../kit/index.ts';

/* ------------------------------------------------------------- surfaces */

export type PanelTone = 'white' | 'sand' | 'dark';

export function Panel({
  title,
  subtitle,
  actions,
  tone = 'white',
  padded = true,
  className,
  bodyClassName,
  children,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  tone?: PanelTone;
  padded?: boolean;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}): React.JSX.Element {
  const dark = tone === 'dark';
  return (
    <section
      className={cn(
        'ro-rise flex min-w-0 flex-col overflow-hidden rounded-[var(--ro-r-md)] border @container',
        tone === 'white' && 'border-[var(--ro-line)] bg-[var(--ro-card)] text-[var(--ro-ink)]',
        tone === 'sand' && 'ro-on-sand border-transparent bg-[var(--ro-sand)] text-[var(--ro-ink)]',
        dark && 'ro-on-dark border-transparent bg-[var(--ro-dark)] text-[var(--ro-on-dark)]',
        className,
      )}
    >
      {title !== undefined && (
        <header className={cn('flex min-h-10 items-center justify-between gap-3 border-b px-3 py-2', dark ? 'border-[var(--ro-dark-2)]' : tone === 'sand' ? 'border-[var(--ro-track-sand)]' : 'border-[var(--ro-hair)]')}>
          <div className="min-w-0">
            <h2 className="truncate text-[13px] font-bold leading-5">{title}</h2>
            {subtitle !== undefined && <p className={cn('truncate text-[12px] leading-4', dark ? 'text-[var(--ro-on-dark-muted)]' : 'text-[var(--ro-muted)]')}>{subtitle}</p>}
          </div>
          {actions !== undefined && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </header>
      )}
      <div className={cn('min-w-0 flex-1', padded && 'p-3', bodyClassName)}>{children}</div>
    </section>
  );
}

export function PropSection({ title, actions, children, className }: { title: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }): React.JSX.Element {
  return (
    <section className={cn('border-b border-[var(--ro-hair)] px-3 pb-3 pt-2', className)}>
      <div className="flex h-7 items-center justify-between gap-2">
        <h3 className="truncate text-[12px] font-bold text-[var(--ro-ink-2)]">{title}</h3>
        {actions !== undefined && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, icon: Icon }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; icon?: LucideIcon }): React.JSX.Element {
  return (
    <header className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ro-line)] pb-3">
      <div className="flex min-w-0 items-center gap-2.5">
        {Icon !== undefined && (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--ro-r)] bg-[var(--ro-row)] text-[var(--ro-ink-2)]">
            <Icon size={16} />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-[15px] font-bold leading-[22px]">{title}</h1>
          {subtitle !== undefined && <p className="truncate text-[12px] leading-4 text-[var(--ro-muted)]">{subtitle}</p>}
        </div>
      </div>
      {actions !== undefined && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/* --------------------------------------------------------------- buttons */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent' | 'onDark';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: 'h-6 gap-1 px-2 text-[12px]',
  md: 'h-7 gap-1.5 px-2.5 text-[13px]',
  lg: 'h-8 gap-1.5 px-3 text-[13px]',
};

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'border-transparent bg-[var(--ro-primary)] text-white hover:bg-[var(--ro-primary-hover)]',
  secondary: 'border-[var(--ro-line)] bg-[var(--ro-card)] text-[var(--ro-ink)] shadow-[var(--ro-shadow-sm)] hover:bg-[var(--ro-row)]',
  ghost: 'border-transparent bg-transparent text-[var(--ro-ink-2)] hover:bg-[var(--ro-row)] hover:text-[var(--ro-ink)]',
  danger: 'border-[var(--ro-line)] bg-[var(--ro-card)] text-[var(--ro-red-text)] hover:bg-[var(--ro-red)]/10',
  accent: 'border-transparent bg-[var(--ro-accent)] text-[var(--ro-on-accent)] hover:opacity-90',
  onDark: 'border-transparent bg-[var(--ro-dark-2)] text-[var(--ro-on-dark)] hover:opacity-90',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  loading = false,
  className,
  children,
  type,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; icon?: LucideIcon; loading?: boolean; ref?: React.Ref<HTMLButtonElement> }): React.JSX.Element {
  return (
    <button
      type={type ?? 'button'}
      disabled={disabled === true || loading}
      className={cn('inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-[var(--ro-r)] border font-semibold transition-colors disabled:opacity-50', BUTTON_SIZE[size], BUTTON_VARIANT[variant], className)}
      {...rest}
    >
      {loading ? <Spinner size={size === 'sm' ? 11 : 13} /> : Icon !== undefined ? <Icon size={size === 'sm' ? 13 : 14} strokeWidth={2} aria-hidden /> : null}
      {children}
    </button>
  );
}

export type IconButtonVariant = 'ghost' | 'secondary' | 'primary' | 'danger' | 'onDark';

export function IconButton({
  icon: Icon,
  label,
  variant = 'ghost',
  size = 28,
  active = false,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; variant?: IconButtonVariant; size?: number; active?: boolean; ref?: React.Ref<HTMLButtonElement> }): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      style={{ width: size, height: size }}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-[var(--ro-r)] border transition-colors disabled:opacity-40',
        variant === 'ghost' && (active ? 'border-transparent bg-[var(--ro-row-hover)] text-[var(--ro-ink)]' : 'border-transparent text-[var(--ro-ink-2)] hover:bg-[var(--ro-row)] hover:text-[var(--ro-ink)]'),
        variant === 'secondary' && 'border-[var(--ro-line)] bg-[var(--ro-card)] text-[var(--ro-ink)] shadow-[var(--ro-shadow-sm)] hover:bg-[var(--ro-row)]',
        variant === 'primary' && 'border-transparent bg-[var(--ro-primary)] text-white hover:bg-[var(--ro-primary-hover)]',
        variant === 'danger' && 'border-transparent text-[var(--ro-muted)] hover:bg-[var(--ro-red)]/10 hover:text-[var(--ro-red-text)]',
        variant === 'onDark' && 'border-transparent bg-[var(--ro-dark-2)] text-[var(--ro-on-dark)] hover:opacity-90',
        className,
      )}
      {...rest}
    >
      <Icon size={Math.max(12, Math.round(size * 0.5))} strokeWidth={2} aria-hidden />
    </button>
  );
}

export function ButtonGroup({ children, label, className }: { children: ReactNode; label?: string; className?: string }): React.JSX.Element {
  return (
    <div role="group" aria-label={label} className={cn('inline-flex shrink-0 items-center gap-0.5 rounded-[var(--ro-r)] border border-[var(--ro-line)] bg-[var(--ro-card)] p-0.5 shadow-[var(--ro-shadow-sm)]', className)}>
      {children}
    </div>
  );
}

export function TextLink({ children, onClick, className, tone = 'ink' }: { children: ReactNode; onClick: () => void; className?: string; tone?: 'ink' | 'muted' | 'red' | 'accent' }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 text-[12px] font-semibold underline-offset-4 hover:underline',
        tone === 'ink' && 'text-[var(--ro-ink-2)] hover:text-[var(--ro-ink)]',
        tone === 'muted' && 'text-[var(--ro-muted)] hover:text-[var(--ro-ink)]',
        tone === 'red' && 'text-[var(--ro-red-text)]',
        tone === 'accent' && 'text-[var(--ro-accent-text)]',
        className,
      )}
    >
      {children}
    </button>
  );
}

/* --------------------------------------------------------------- display */

export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'neutral' | 'dark' | 'agent';

export function Badge({ tone, children, pulse = false, className, title }: { tone: Tone; children: ReactNode; pulse?: boolean; className?: string; title?: string }): React.JSX.Element {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[var(--ro-r-sm)] px-1.5 text-[12px] font-semibold',
        tone === 'good' && 'bg-[var(--ro-green)]/12 text-[var(--ro-green-text)]',
        tone === 'warn' && 'bg-[var(--ro-amber)]/20 text-[var(--ro-amber-text)]',
        tone === 'bad' && 'bg-[var(--ro-red)]/12 text-[var(--ro-red-text)]',
        tone === 'info' && 'ro-on-ink bg-[var(--ro-ink)] text-[var(--ro-shell)]',
        tone === 'neutral' && 'bg-[var(--ro-row)] text-[var(--ro-ink-2)]',
        tone === 'dark' && 'bg-[var(--ro-dark-2)] text-[var(--ro-on-dark)]',
        tone === 'agent' && 'border border-dashed border-[var(--ro-accent)] bg-[var(--ro-accent-soft)] text-[var(--ro-ink)]',
        className,
      )}
    >
      {tone === 'agent' ? (
        <Sparkles size={11} className="shrink-0 text-[var(--ro-accent-text)]" aria-hidden />
      ) : (
        <span
          aria-hidden
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            tone === 'good' && 'bg-[var(--ro-green)]',
            tone === 'warn' && 'bg-[var(--ro-amber)]',
            tone === 'bad' && 'bg-[var(--ro-red)]',
            tone === 'info' && 'bg-[var(--ro-accent)]',
            tone === 'neutral' && 'bg-[var(--ro-muted)]',
            tone === 'dark' && 'bg-[var(--ro-accent)]',
            pulse && 'ro-pulse',
          )}
        />
      )}
      {children}
    </span>
  );
}

/** A small rounded count (rail badges, tabs). */
export function Count({ n, className }: { n: number | undefined; className?: string }): React.JSX.Element | null {
  if (n === undefined || n <= 0) return null;
  return <span className={cn('num inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--ro-badge)] px-1 text-[12px] font-bold leading-none text-white', className)}>{n > 999 ? '999+' : n}</span>;
}

/** A one-of-many filter chip with an optional count (compact). */
export function Chip({ on, onClick, children, count, icon: Icon, title }: { on: boolean; onClick: () => void; children: ReactNode; count?: number; icon?: LucideIcon; title?: string }): React.JSX.Element {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      title={title}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--ro-r)] border px-2.5 text-[12px] font-semibold transition-colors',
        on ? 'ro-on-ink border-transparent bg-[var(--ro-ink)] text-[var(--ro-shell)]' : 'border-[var(--ro-line)] bg-[var(--ro-card)] text-[var(--ro-ink-2)] hover:bg-[var(--ro-row)] hover:text-[var(--ro-ink)]',
      )}
    >
      {Icon !== undefined && <Icon size={13} aria-hidden />}
      {children}
      {count !== undefined && <span className={cn('num rounded-[3px] px-1 text-[12px] font-bold', on ? 'bg-[var(--ro-badge)] text-white' : 'bg-[var(--ro-row)] text-[var(--ro-ink-2)]')}>{count}</span>}
    </button>
  );
}

export function Empty({ icon: Icon, title, children, action, dark = false, compact = false }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode; dark?: boolean; compact?: boolean }): React.JSX.Element {
  return (
    <div className={cn('flex flex-col items-center px-4 text-center', compact ? 'py-5' : 'py-10')}>
      <span className={cn('mb-2 flex size-9 items-center justify-center rounded-[var(--ro-r-md)]', dark ? 'bg-[var(--ro-dark-2)] text-[var(--ro-accent)]' : 'bg-[var(--ro-row)] text-[var(--ro-ink-2)]')}>
        <Icon size={17} strokeWidth={1.9} aria-hidden />
      </span>
      <p className="text-[13px] font-bold">{title}</p>
      {children !== undefined && <div className={cn('mt-0.5 max-w-sm text-[12px] leading-4', dark ? 'text-[var(--ro-on-dark-muted)]' : 'text-[var(--ro-muted)]')}>{children}</div>}
      {action !== undefined && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** A line of shimmer while something loads. */
export function Skeleton({ className }: { className?: string }): React.JSX.Element {
  return <span aria-hidden className={cn('ro-skeleton block h-3', className)} />;
}

export function LoadError({ message, onRetry }: { message: string; onRetry?: () => void }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[var(--ro-r)] border border-[var(--ro-red)]/30 bg-[var(--ro-red)]/8 px-3 py-2 text-[12px] text-[var(--ro-red-text)]">
      <span>This did not load: {message}</span>
      {onRetry !== undefined && <TextLink tone="red" onClick={onRetry}>Try again</TextLink>}
    </div>
  );
}

/* ---------------------------------------------------------------- inputs */

export const inputCls =
  'h-7 w-full min-w-0 rounded-[var(--ro-r)] border border-[var(--ro-line)] bg-[var(--ro-card)] px-2 text-[13px] text-[var(--ro-ink)] outline-none transition-colors hover:border-[var(--ro-muted)] focus:border-[var(--ro-ink)]';

export const textareaCls =
  'w-full resize-y rounded-[var(--ro-r)] border border-[var(--ro-line)] bg-[var(--ro-card)] px-2 py-1.5 text-[13px] leading-[18px] text-[var(--ro-ink)] outline-none transition-colors hover:border-[var(--ro-muted)] focus:border-[var(--ro-ink)]';

export function Select({ value, onChange, options, label, ariaLabel, className }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; label?: string; ariaLabel?: string; className?: string }): React.JSX.Element {
  const select = (
    <div className={cn('relative min-w-0', className)}>
      <select aria-label={ariaLabel ?? label} value={value} onChange={(e) => onChange(e.target.value)} className={cn(inputCls, 'appearance-none truncate pr-7')}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={14} aria-hidden className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--ro-muted)]" />
    </div>
  );
  if (label === undefined) return select;
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[12px] font-semibold text-[var(--ro-ink-2)]">{label}</span>
      {select}
    </label>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode }): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[12px] font-semibold text-[var(--ro-ink-2)]">{label}</span>
      {children}
      {error ? <span className="text-[12px] font-medium text-[var(--ro-red-text)]">{error}</span> : hint !== undefined ? <span className="text-[12px] leading-4 text-[var(--ro-muted)]">{hint}</span> : null}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }): React.JSX.Element {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} title={label} onClick={() => onChange(!checked)} className={cn('ro-on-ink relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors', checked ? 'bg-[var(--ro-ink)]' : 'bg-[var(--ro-track)]')}>
      <span className={cn('inline-block size-3 rounded-full shadow-sm transition-transform', checked ? 'translate-x-3.5 bg-[var(--ro-accent)]' : 'translate-x-0.5 bg-[var(--ro-card)]')} />
    </button>
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
  xl = false,
  icon: Icon,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string | undefined;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  xl?: boolean;
  icon?: LucideIcon;
}): React.JSX.Element {
  return (
    <RadixDialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-[60] bg-black/35" />
        <RadixDialog.Content
          className={cn(
            'ro-pop fixed left-1/2 top-1/2 z-[61] flex max-h-[88vh] w-[min(94vw,28rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[var(--ro-r-lg)] border border-[var(--ro-line)] bg-[var(--ro-shell)] text-[var(--ro-ink)] shadow-[var(--ro-shadow)] @container',
            wide && 'w-[min(94vw,40rem)]',
            xl && 'w-[min(96vw,60rem)]',
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-[var(--ro-line)] px-4 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              {Icon !== undefined && (
                <span className="flex size-7 shrink-0 items-center justify-center rounded-[var(--ro-r)] bg-[var(--ro-row)] text-[var(--ro-ink-2)]">
                  <Icon size={15} />
                </span>
              )}
              <div className="min-w-0">
                <RadixDialog.Title className="text-[14px] font-bold leading-5">{title}</RadixDialog.Title>
                <RadixDialog.Description className={description !== undefined ? 'mt-0.5 text-[12px] leading-4 text-[var(--ro-muted)]' : 'sr-only'}>{description ?? title}</RadixDialog.Description>
              </div>
            </div>
            <IconButton icon={X} label="Close" onClick={onClose} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
          {footer !== undefined && <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--ro-line)] px-4 py-2.5">{footer}</div>}
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
            <Button onClick={() => settle(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => settle(true)} autoFocus>
              {state.label}
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-[var(--ro-ink-2)]">{state.message}</p>
      </Modal>
    ) : null;
  return [el, confirm];
}

export const menuItem =
  'flex h-7 w-full items-center gap-2 rounded-[var(--ro-r-sm)] px-2 text-left text-[13px] font-medium text-[var(--ro-ink)] hover:bg-[var(--ro-row)] disabled:opacity-40 disabled:hover:bg-transparent [&>svg]:shrink-0 [&>svg]:text-[var(--ro-ink-2)]';

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
  anchor?: React.RefObject<HTMLElement | null>;
  at?: { x: number; y: number } | null;
  align?: 'left' | 'right';
  side?: 'bottom' | 'top' | 'right';
  className?: string;
  keep?: React.RefObject<HTMLElement | null>;
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
          top = side === 'top' ? r.top - h - 4 : r.bottom + 4;
        }
      }
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      if (top + h > window.innerHeight - 8) top = Math.max(8, (at ? at.y : top) - h - (at ? 4 : 0));
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
      className={cn('ro-pop ro-on-card z-[80] rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)] p-1 text-[var(--ro-ink)] shadow-[var(--ro-shadow)]', className)}
    >
      {children}
    </div>,
    host,
  );
}

/* -------------------------------------------------------- context menus */

export interface MenuEntry {
  label: string;
  icon?: LucideIcon;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
  divider?: boolean;
}

interface MenuState {
  x: number;
  y: number;
  items: MenuEntry[];
}

const MenuCtx = createContext<(e: { clientX: number; clientY: number; preventDefault: () => void }, items: MenuEntry[]) => void>(() => undefined);

/** One context menu for the whole app: `const open = useContextMenu(); onContextMenu={(e) => open(e, items)}`. */
export function MenuProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [state, setState] = useState<MenuState | null>(null);
  const open = useCallback((e: { clientX: number; clientY: number; preventDefault: () => void }, items: MenuEntry[]) => {
    e.preventDefault();
    setState({ x: e.clientX, y: e.clientY, items: items });
  }, []);
  return (
    <MenuCtx.Provider value={open}>
      {children}
      <Popover open={state !== null} onClose={() => setState(null)} at={state ? { x: state.x, y: state.y } : null} className="w-56">
        {state?.items.map((it, i) =>
          it.divider ? (
            <div key={i} className="my-1 h-px bg-[var(--ro-hair)]" />
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
              className={cn(menuItem, it.danger && 'text-[var(--ro-red-text)] [&>svg]:text-[var(--ro-red-text)]')}
            >
              {it.icon !== undefined && <it.icon size={14} />}
              <span className="min-w-0 flex-1 truncate">{it.label}</span>
              {it.hint !== undefined && <Kbd>{it.hint}</Kbd>}
            </button>
          ),
        )}
      </Popover>
    </MenuCtx.Provider>
  );
}

export function useContextMenu(): (e: { clientX: number; clientY: number; preventDefault: () => void }, items: MenuEntry[]) => void {
  return useContext(MenuCtx);
}

/* ------------------------------------------------------------- extras */

export function Segmented<T extends string>({ value, options, onChange, label, size = 'md', className }: { value: T; options: { value: T; label: string; icon?: LucideIcon; title?: string }[]; onChange: (v: T) => void; label: string; size?: 'sm' | 'md'; className?: string }): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-[var(--ro-r)] border border-[var(--ro-line)] bg-[var(--ro-row)] p-0.5', className)}>
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
            className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-[var(--ro-r-sm)] px-2 font-semibold transition-colors', size === 'sm' ? 'h-5 text-[12px]' : 'h-6 text-[12px]', on ? 'bg-[var(--ro-card)] text-[var(--ro-ink)] shadow-[var(--ro-shadow-sm)]' : 'text-[var(--ro-ink-2)] hover:text-[var(--ro-ink)]')}
          >
            {Icon !== undefined && <Icon size={13} aria-hidden />}
            {o.label !== '' && <span className={Icon !== undefined ? 'hidden @min-[420px]:inline' : undefined}>{o.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Tabs<T extends string>({ value, options, onChange, label, className }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string; className?: string }): React.JSX.Element {
  return (
    <div role="tablist" aria-label={label} className={cn('flex h-9 shrink-0 items-stretch gap-3 overflow-x-auto border-b border-[var(--ro-line)] px-3', className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" role="tab" aria-selected={on} onClick={() => onChange(o.value)} className={cn('-mb-px inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 text-[12px] font-semibold transition-colors', on ? 'border-[var(--ro-ink)] text-[var(--ro-ink)]' : 'border-transparent text-[var(--ro-muted)] hover:text-[var(--ro-ink)]')}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Spinner({ size = 16, className }: { size?: number; className?: string }): React.JSX.Element {
  return <span aria-label="Working" style={{ width: size, height: size }} className={cn('inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent', className)} />;
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }): React.JSX.Element {
  return <kbd className={cn('inline-flex h-4 min-w-4 items-center justify-center rounded-[3px] border border-current/25 px-1 font-sans text-[12px] font-semibold leading-none opacity-70', className)}>{children}</kbd>;
}

export function Stat({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }): React.JSX.Element {
  return (
    <div className="flex min-h-6 items-center justify-between gap-3">
      <span className="truncate text-[12px] text-[var(--ro-muted)]">{label}</span>
      <span className={cn('num truncate text-right text-[12px] font-semibold', mono && 'mono')}>{value}</span>
    </div>
  );
}

/** A big number with a label (summary tiles). */
export function Metric({ label, value, sub, onClick }: { label: string; value: ReactNode; sub?: ReactNode; onClick?: () => void }): React.JSX.Element {
  const body = (
    <>
      <span className="text-[12px] text-[var(--ro-muted)]">{label}</span>
      <span className="num text-[26px] font-bold leading-8 tracking-tight">{value}</span>
      {sub !== undefined && <span className="truncate text-[12px] text-[var(--ro-muted)]">{sub}</span>}
    </>
  );
  const cls = 'flex min-w-0 flex-col rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)] px-3 py-2.5 text-left';
  return onClick !== undefined ? (
    <button type="button" onClick={onClick} className={cn(cls, 'transition-colors hover:bg-[var(--ro-row)]')}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** A progress ring (reading progress, counts). */
export function ProgressRing({ value, size = 28, stroke = 3, label, children }: { value: number; size?: number; stroke?: number; label?: string; children?: ReactNode }): React.JSX.Element {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }} title={label} aria-label={label}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--ro-track)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--ro-accent)" strokeWidth={stroke} strokeDasharray={c} strokeDashoffset={c * (1 - v)} strokeLinecap="round" />
      </svg>
      {children !== undefined && <span className="absolute inset-0 flex items-center justify-center text-[12px] font-bold">{children}</span>}
    </span>
  );
}

/** A thin balance bar: supporting and opposing evidence (and proposed). */
export function BalanceBar({ supports, opposes, proposed = 0, className }: { supports: number; opposes: number; proposed?: number; className?: string }): React.JSX.Element {
  const total = supports + opposes + proposed;
  if (total === 0) return <span className={cn('block h-1.5 rounded-full bg-[var(--ro-track)]', className)} title="No evidence yet" />;
  return (
    <span className={cn('flex h-1.5 overflow-hidden rounded-full bg-[var(--ro-track)]', className)} title={`${supports} supporting, ${opposes} opposing${proposed > 0 ? `, ${proposed} proposed` : ''}`}>
      <span style={{ width: `${(100 * supports) / total}%` }} className="bg-[var(--ro-rel-supports)]" />
      {/* Waiting for you: striped and neutral, so it never reads as for or against. */}
      <span style={{ width: `${(100 * proposed) / total}%`, background: 'repeating-linear-gradient(135deg, var(--ro-ink-2) 0 2px, transparent 2px 4px)' }} className="opacity-45" />
      <span style={{ width: `${(100 * opposes) / total}%` }} className="bg-[var(--ro-rel-opposes)]" />
    </span>
  );
}

/** A right-side drawer for details on narrow screens. */
export function Drawer({ open, onClose, title, children, width = 380 }: { open: boolean; onClose: () => void; title: string; children: ReactNode; width?: number }): React.JSX.Element {
  return (
    <RadixDialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-[60] bg-black/25" />
        <RadixDialog.Content style={{ width: `min(94vw, ${width}px)` }} className="fixed bottom-0 right-0 top-0 z-[61] flex flex-col border-l border-[var(--ro-line)] bg-[var(--ro-card)] text-[var(--ro-ink)] shadow-[var(--ro-shadow)] @container">
          <div className="flex h-11 items-center justify-between gap-2 border-b border-[var(--ro-line)] px-3">
            <RadixDialog.Title className="truncate text-[13px] font-bold">{title}</RadixDialog.Title>
            <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
            <IconButton icon={X} label="Close" onClick={onClose} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
