/**
 * Building blocks of the visual system: flat panels with a hairline border,
 * compact buttons and fields (28px, 6px corners), icon buttons, status
 * badges, segmented controls and tabs, a modal, a confirm dialog, a menu
 * popover and property rows. Colors come only from --cw-*.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import type { LucideIcon } from 'lucide-react';
import { ChevronDown, X } from 'lucide-react';
import { cn } from '../../kit/index.ts';

/* ------------------------------------------------------------- surfaces */

export type PanelTone = 'white' | 'sand' | 'dark';

/** A flat surface with an optional header bar (title, subtitle, actions). */
export function Panel({
  title,
  subtitle,
  actions,
  tone = 'white',
  padded = true,
  className,
  children,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  tone?: PanelTone;
  padded?: boolean;
  className?: string;
  children: ReactNode;
}): React.JSX.Element {
  const dark = tone === 'dark';
  return (
    <section
      className={cn(
        'cw-rise flex min-w-0 flex-col overflow-hidden rounded-[var(--cw-r-md)] border',
        tone === 'white' && 'border-[var(--cw-line)] bg-[var(--cw-card)] text-[var(--cw-ink)]',
        tone === 'sand' && 'cw-on-sand border-transparent bg-[var(--cw-sand)] text-[var(--cw-ink)]',
        dark && 'cw-on-dark border-transparent bg-[var(--cw-dark)] text-[var(--cw-on-dark)]',
        className,
      )}
    >
      {title !== undefined && (
        <header className={cn('flex min-h-10 items-center justify-between gap-3 border-b px-3 py-2', dark ? 'border-[var(--cw-dark-2)]' : tone === 'sand' ? 'border-[var(--cw-track-sand)]' : 'border-[var(--cw-hair)]')}>
          <div className="min-w-0">
            <h2 className="truncate text-[13px] font-bold leading-5">{title}</h2>
            {subtitle !== undefined && <p className={cn('text-[12px] leading-4', dark ? 'text-[var(--cw-on-dark-muted)]' : 'text-[var(--cw-muted)]')}>{subtitle}</p>}
          </div>
          {actions !== undefined && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </header>
      )}
      <div className={cn('min-w-0 flex-1', padded && 'p-3')}>{children}</div>
    </section>
  );
}

/** A titled group of rows inside a docked panel, split from the next by a hairline. */
export function PropSection({ title, actions, children, className }: { title: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }): React.JSX.Element {
  return (
    <section className={cn('border-b border-[var(--cw-hair)] px-3 pb-3 pt-2', className)}>
      <div className="flex h-7 items-center justify-between gap-2">
        <h3 className="truncate text-[12px] font-bold text-[var(--cw-ink-2)]">{title}</h3>
        {actions !== undefined && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }): React.JSX.Element {
  return (
    <header className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--cw-line)] pb-3">
      <div className="min-w-0">
        <h1 className="text-[15px] font-bold leading-[22px]">{title}</h1>
        {subtitle !== undefined && <p className="text-[12px] leading-4 text-[var(--cw-muted)]">{subtitle}</p>}
      </div>
      {actions !== undefined && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/* --------------------------------------------------------------- buttons */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: 'h-6 gap-1 px-2 text-[12px]',
  md: 'h-7 gap-1.5 px-2.5 text-[13px]',
  lg: 'h-8 gap-1.5 px-3 text-[13px]',
};

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'cw-on-ink border-transparent bg-[var(--cw-ink)] text-[var(--cw-shell)] hover:bg-[var(--cw-ink)]/90 [&>svg]:text-[var(--cw-accent)]',
  secondary: 'border-[var(--cw-line)] bg-[var(--cw-card)] text-[var(--cw-ink)] shadow-[var(--cw-shadow-sm)] hover:bg-[var(--cw-row)]',
  ghost: 'border-transparent bg-transparent text-[var(--cw-ink-2)] hover:bg-[var(--cw-row)] hover:text-[var(--cw-ink)]',
  danger: 'border-[var(--cw-line)] bg-[var(--cw-card)] text-[var(--cw-red-text)] hover:bg-[var(--cw-red)]/10',
  accent: 'border-transparent bg-[var(--cw-accent)] text-[var(--cw-on-accent)] hover:opacity-90',
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
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; icon?: LucideIcon; loading?: boolean }): React.JSX.Element {
  return (
    <button
      type={type ?? 'button'}
      disabled={disabled === true || loading}
      className={cn(
        'inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-[var(--cw-r)] border font-semibold transition-colors disabled:opacity-50',
        BUTTON_SIZE[size],
        BUTTON_VARIANT[variant],
        className,
      )}
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
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; variant?: IconButtonVariant; size?: number; active?: boolean }): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      style={{ width: size, height: size }}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-[var(--cw-r)] border transition-colors disabled:opacity-40',
        variant === 'ghost' && (active ? 'border-transparent bg-[var(--cw-row-hover)] text-[var(--cw-ink)]' : 'border-transparent text-[var(--cw-ink-2)] hover:bg-[var(--cw-row)] hover:text-[var(--cw-ink)]'),
        variant === 'secondary' && 'border-[var(--cw-line)] bg-[var(--cw-card)] text-[var(--cw-ink)] shadow-[var(--cw-shadow-sm)] hover:bg-[var(--cw-row)]',
        variant === 'primary' && 'cw-on-ink border-transparent bg-[var(--cw-ink)] text-[var(--cw-shell)] hover:bg-[var(--cw-ink)]/90',
        variant === 'danger' && 'border-transparent text-[var(--cw-muted)] hover:bg-[var(--cw-red)]/10 hover:text-[var(--cw-red-text)]',
        variant === 'onDark' && 'border-transparent bg-[var(--cw-dark-2)] text-[var(--cw-on-dark)] hover:opacity-90',
        className,
      )}
      {...rest}
    >
      <Icon size={Math.max(12, Math.round(size * 0.5))} strokeWidth={2} aria-hidden />
    </button>
  );
}

/** A row of joined icon buttons (undo and redo, view tools). */
export function ButtonGroup({ children, label, className }: { children: ReactNode; label?: string; className?: string }): React.JSX.Element {
  return (
    <div role="group" aria-label={label} className={cn('inline-flex shrink-0 items-center gap-0.5 rounded-[var(--cw-r)] border border-[var(--cw-line)] bg-[var(--cw-card)] p-0.5 shadow-[var(--cw-shadow-sm)]', className)}>
      {children}
    </div>
  );
}

export function TextLink({ children, onClick, className, tone = 'ink' }: { children: ReactNode; onClick: () => void; className?: string; tone?: 'ink' | 'muted' | 'red' }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 text-[12px] font-semibold underline-offset-4 hover:underline',
        tone === 'ink' && 'text-[var(--cw-ink-2)] hover:text-[var(--cw-ink)]',
        tone === 'muted' && 'text-[var(--cw-muted)] hover:text-[var(--cw-ink)]',
        tone === 'red' && 'text-[var(--cw-red-text)]',
        className,
      )}
    >
      {children}
    </button>
  );
}

/* --------------------------------------------------------------- display */

export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'neutral' | 'dark';

export function Badge({ tone, children, pulse = false, className }: { tone: Tone; children: ReactNode; pulse?: boolean; className?: string }): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[var(--cw-r-sm)] px-1.5 text-[12px] font-semibold',
        tone === 'good' && 'bg-[var(--cw-green)]/12 text-[var(--cw-green-text)]',
        tone === 'warn' && 'bg-[var(--cw-amber)]/20 text-[var(--cw-amber-text)]',
        tone === 'bad' && 'bg-[var(--cw-red)]/12 text-[var(--cw-red-text)]',
        tone === 'info' && 'cw-on-ink bg-[var(--cw-ink)] text-[var(--cw-shell)]',
        tone === 'neutral' && 'bg-[var(--cw-row)] text-[var(--cw-ink-2)]',
        tone === 'dark' && 'bg-[var(--cw-dark-2)] text-[var(--cw-on-dark)]',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          tone === 'good' && 'bg-[var(--cw-green)]',
          tone === 'warn' && 'bg-[var(--cw-amber)]',
          tone === 'bad' && 'bg-[var(--cw-red)]',
          tone === 'info' && 'bg-[var(--cw-accent)]',
          tone === 'neutral' && 'bg-[var(--cw-muted)]',
          tone === 'dark' && 'bg-[var(--cw-accent)]',
          pulse && 'cw-pulse',
        )}
      />
      {children}
    </span>
  );
}

export function Empty({ icon: Icon, title, children, action, dark = false, compact = false }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode; dark?: boolean; compact?: boolean }): React.JSX.Element {
  return (
    <div className={cn('flex flex-col items-center px-4 text-center', compact ? 'py-5' : 'py-10')}>
      <span className={cn('mb-2 flex size-8 items-center justify-center rounded-[var(--cw-r)]', dark ? 'bg-[var(--cw-dark-2)] text-[var(--cw-accent)]' : 'bg-[var(--cw-row)] text-[var(--cw-ink-2)]')}>
        <Icon size={16} strokeWidth={1.9} aria-hidden />
      </span>
      <p className="text-[13px] font-bold">{title}</p>
      {children !== undefined && <div className={cn('mt-0.5 max-w-sm text-[12px] leading-4', dark ? 'text-[var(--cw-on-dark-muted)]' : 'text-[var(--cw-muted)]')}>{children}</div>}
      {action !== undefined && <div className="mt-3">{action}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------- inputs */

/** A one-line field: 28px, hairline border, ink border on focus. */
export const inputCls =
  'h-7 w-full min-w-0 rounded-[var(--cw-r)] border border-[var(--cw-line)] bg-[var(--cw-card)] px-2 text-[13px] text-[var(--cw-ink)] outline-none transition-colors hover:border-[var(--cw-muted)] focus:border-[var(--cw-ink)]';

export const textareaCls =
  'w-full resize-y rounded-[var(--cw-r)] border border-[var(--cw-line)] bg-[var(--cw-card)] px-2 py-1.5 text-[13px] leading-[18px] text-[var(--cw-ink)] outline-none transition-colors hover:border-[var(--cw-muted)] focus:border-[var(--cw-ink)]';

export function Select({
  value,
  onChange,
  options,
  label,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label?: string;
  ariaLabel?: string;
  className?: string;
}): React.JSX.Element {
  const select = (
    <div className={cn('relative min-w-0', className)}>
      <select aria-label={ariaLabel ?? label} value={value} onChange={(e) => onChange(e.target.value)} className={cn(inputCls, 'appearance-none truncate pr-7')}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={14} aria-hidden className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--cw-muted)]" />
    </div>
  );
  if (label === undefined) return select;
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[12px] font-semibold text-[var(--cw-ink-2)]">{label}</span>
      {select}
    </label>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode }): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[12px] font-semibold text-[var(--cw-ink-2)]">{label}</span>
      {children}
      {error ? <span className="text-[12px] font-medium text-[var(--cw-red-text)]">{error}</span> : hint !== undefined ? <span className="text-[12px] leading-4 text-[var(--cw-muted)]">{hint}</span> : null}
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
      className={cn('cw-on-ink relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors', checked ? 'bg-[var(--cw-ink)]' : 'bg-[var(--cw-track)]')}
    >
      <span className={cn('inline-block size-3 rounded-full shadow-sm transition-transform', checked ? 'translate-x-3.5 bg-[var(--cw-accent)]' : 'translate-x-0.5 bg-[var(--cw-card)]')} />
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
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string | undefined;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  xl?: boolean;
}): React.JSX.Element {
  return (
    <RadixDialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-[60] bg-black/35" />
        <RadixDialog.Content
          className={cn(
            'cw-pop fixed left-1/2 top-1/2 z-[61] flex max-h-[88vh] w-[min(94vw,28rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[var(--cw-r-lg)] border border-[var(--cw-line)] bg-[var(--cw-shell)] text-[var(--cw-ink)] shadow-[var(--cw-shadow)]',
            wide && 'w-[min(94vw,38rem)]',
            xl && 'w-[min(94vw,54rem)]',
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-[var(--cw-line)] px-4 py-3">
            <div className="min-w-0">
              <RadixDialog.Title className="text-[14px] font-bold leading-5">{title}</RadixDialog.Title>
              <RadixDialog.Description className={description !== undefined ? 'mt-0.5 text-[12px] leading-4 text-[var(--cw-muted)]' : 'sr-only'}>{description ?? title}</RadixDialog.Description>
            </div>
            <IconButton icon={X} label="Close" onClick={onClose} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
          {footer !== undefined && <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--cw-line)] px-4 py-2.5">{footer}</div>}
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
            <Button variant="primary" onClick={() => settle(true)}>
              {state.label}
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-[var(--cw-ink-2)]">{state.message}</p>
      </Modal>
    ) : null;
  return [el, confirm];
}

/** A menu row inside a Popover. */
export const menuItem = 'flex h-7 w-full items-center gap-2 rounded-[var(--cw-r-sm)] px-2 text-left text-[13px] font-medium text-[var(--cw-ink)] hover:bg-[var(--cw-row)] [&>svg]:shrink-0 [&>svg]:text-[var(--cw-ink-2)]';

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
      role="menu"
      className={cn(
        'cw-pop cw-on-card absolute top-[calc(100%+4px)] z-40 rounded-[var(--cw-r-md)] border border-[var(--cw-line)] bg-[var(--cw-card)] p-1 text-[var(--cw-ink)] shadow-[var(--cw-shadow)]',
        align === 'left' ? 'left-0' : 'right-0',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** The message an op error carries (PocketBase shape { message }). */
export function errMessage(err: unknown): string {
  const e = err as { message?: string; response?: { message?: string } };
  return e.response?.message ?? e.message ?? 'Something went wrong';
}

/* ------------------------------------------------------------- extras */

/** A row of mutually exclusive choices (a filter, a mode). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = 'md',
  className,
}: {
  value: T;
  options: { value: T; label: string; icon?: LucideIcon }[];
  onChange: (v: T) => void;
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-[var(--cw-r)] border border-[var(--cw-line)] bg-[var(--cw-row)] p-0.5', className)}>
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
              'inline-flex items-center gap-1 whitespace-nowrap rounded-[var(--cw-r-sm)] px-2 font-semibold transition-colors',
              size === 'sm' ? 'h-5 text-[12px]' : 'h-6 text-[12px]',
              on ? 'bg-[var(--cw-card)] text-[var(--cw-ink)] shadow-[var(--cw-shadow-sm)]' : 'text-[var(--cw-ink-2)] hover:text-[var(--cw-ink)]',
            )}
          >
            {Icon !== undefined && <Icon size={13} aria-hidden />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Underlined tabs for a panel's views. */
export function Tabs<T extends string>({ value, options, onChange, label, className }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string; className?: string }): React.JSX.Element {
  return (
    <div role="tablist" aria-label={label} className={cn('flex h-9 shrink-0 items-stretch gap-3 border-b border-[var(--cw-line)] px-3', className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className={cn('-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 text-[12px] font-semibold transition-colors', on ? 'border-[var(--cw-ink)] text-[var(--cw-ink)]' : 'border-transparent text-[var(--cw-muted)] hover:text-[var(--cw-ink)]')}
          >
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

/** A small key cap for keyboard hints. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }): React.JSX.Element {
  return <kbd className={cn('inline-flex h-4 min-w-4 items-center justify-center rounded-[3px] border border-current/25 px-1 font-sans text-[12px] font-semibold leading-none opacity-70', className)}>{children}</kbd>;
}

/** Label and value on one 24px line, for property lists. */
export function Stat({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }): React.JSX.Element {
  return (
    <div className="flex min-h-6 items-center justify-between gap-3">
      <span className="truncate text-[12px] text-[var(--cw-muted)]">{label}</span>
      <span className={cn('num text-right text-[12px] font-semibold', mono && 'mono')}>{value}</span>
    </div>
  );
}
