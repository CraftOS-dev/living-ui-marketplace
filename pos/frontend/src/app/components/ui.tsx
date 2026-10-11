/**
 * Building blocks of the visual system: rounded cards (white, sand, dark)
 * with no borders, pill buttons (the main action wears an accent dot), round
 * icon buttons, pill fields, status pills, chips, numbered step cards, a
 * full-screen that grows out of the button that opened it, a modal, a
 * confirm dialog and a popover menu. Colors come only from --ps-*.
 */
import { cloneElement, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import type { LucideIcon } from 'lucide-react';
import { ArrowLeft, Check, ChevronDown, Search, X } from 'lucide-react';
import { cn } from '../../kit/index.ts';

/* ------------------------------------------------------------- surfaces */

export type CardTone = 'white' | 'sand' | 'dark';
export type PanelTone = CardTone;

const TONE: Record<CardTone, string> = {
  white: 'ps-on-card bg-[var(--ps-card)] text-[var(--ps-ink)]',
  sand: 'ps-on-sand bg-[var(--ps-sand)] text-[var(--ps-ink)]',
  dark: 'ps-on-dark bg-[var(--ps-dark)] text-[var(--ps-on-dark)]',
};

/** A standalone screen (lock, setup): the canvas holding one rounded shell. */
export function Stage({ children, className }: { children: ReactNode; className?: string }): React.JSX.Element {
  return (
    <div className="min-h-screen bg-[var(--ps-canvas)] md:p-4">
      <div className={cn('mx-auto flex min-h-screen max-w-[1100px] bg-[var(--ps-shell)] text-[var(--ps-ink)] md:min-h-[calc(100vh-32px)] md:rounded-[36px]', className)}>{children}</div>
    </div>
  );
}

/** A rounded surface. `delay` staggers its entrance (1 to 5). */
export function Card({ tone = 'white', className, children, delay = 0 }: { tone?: CardTone; className?: string; children: ReactNode; delay?: number }): React.JSX.Element {
  return <section className={cn('ps-rise min-w-0 rounded-[24px] p-5 md:p-6', TONE[tone], delay > 0 && `ps-d${Math.min(5, delay)}`, className)}>{children}</section>;
}

export function CardHeader({ title, subtitle, action, className }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; className?: string | undefined }): React.JSX.Element {
  return (
    <div className={cn('mb-4 flex items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-bold leading-[22px]">{title}</h2>
        {subtitle !== undefined && <p className="mt-0.5 text-[13px] text-[var(--ps-muted)]">{subtitle}</p>}
      </div>
      {action !== undefined && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

/** A card with its header in one piece. `padded={false}` lets rows run to the card's edge. */
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
  tone?: CardTone;
  padded?: boolean;
  className?: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <section className={cn('ps-rise flex min-w-0 flex-col rounded-[24px]', TONE[tone], padded ? 'p-5 md:p-6' : 'py-5 md:py-6', className)}>
      {title !== undefined && <CardHeader title={title} subtitle={subtitle} action={actions} className={padded ? undefined : 'px-5 md:px-6'} />}
      <div className="min-w-0 flex-1">{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }): React.JSX.Element {
  return (
    <header className="ps-rise mb-6 flex flex-wrap items-center justify-between gap-4 md:mb-8">
      <div className="min-w-0">
        <h1 className="text-[26px] font-bold leading-[34px] tracking-[-0.01em]">{title}</h1>
        {subtitle !== undefined && <p className="mt-1 text-[13px] text-[var(--ps-muted)]">{subtitle}</p>}
      </div>
      {actions !== undefined && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A round badge holding an icon: a row's lead, a tile's mark, an empty state. */
export function IconBadge({
  icon: Icon,
  size = 40,
  tone = 'row',
  className,
  style,
}: {
  icon: LucideIcon;
  size?: number;
  tone?: 'row' | 'card' | 'solid' | 'accent' | 'dark' | 'none';
  className?: string;
  style?: React.CSSProperties;
}): React.JSX.Element {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, ...style }}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full',
        tone === 'row' && 'bg-[var(--ps-row)] text-[var(--ps-ink)]',
        tone === 'card' && 'bg-[var(--ps-card)] text-[var(--ps-ink)]',
        tone === 'solid' && 'bg-[var(--ps-solid)] text-[var(--ps-on-solid)]',
        tone === 'accent' && 'bg-[var(--ps-dot)] text-[var(--ps-on-dot)]',
        tone === 'dark' && 'bg-[var(--ps-dark-2)] text-[var(--ps-accent)]',
        className,
      )}
    >
      <Icon size={Math.round(size * 0.44)} strokeWidth={1.9} />
    </span>
  );
}

/* --------------------------------------------------------------- buttons */

export type ButtonVariant = 'primary' | 'secondary' | 'light' | 'ghost' | 'danger' | 'accent';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: 'h-9 gap-1.5 px-3.5 text-[13px]',
  md: 'h-11 gap-2 px-5 text-[14px]',
  lg: 'h-14 gap-2.5 px-6 text-[15px]',
};

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  // The main action: an ink pill.
  primary: 'ps-on-ink bg-[var(--ps-ink)] text-[var(--ps-shell)] hover:opacity-90',
  // A quiet pill for cards (it sits on white).
  secondary: 'bg-[var(--ps-row)] text-[var(--ps-ink)] hover:bg-[var(--ps-row-hover)]',
  // A white pill for the shell.
  light: 'bg-[var(--ps-card)] text-[var(--ps-ink)] hover:bg-[var(--ps-row)]',
  ghost: 'bg-transparent text-[var(--ps-ink-2)] hover:bg-[var(--ps-row)] hover:text-[var(--ps-ink)]',
  danger: 'bg-[var(--ps-row)] text-[var(--ps-red-text)] hover:bg-[var(--ps-row-hover)]',
  accent: 'bg-[var(--ps-accent-fill)] text-[var(--ps-on-accent)] hover:opacity-90',
};

/**
 * A dot button per size: the pill's tighter start padding (the dot sits in
 * the pill's rounded end, the same distance from its top, bottom and start),
 * the dot, and `even`: how much wider the dot's side of the label is than the
 * other side (start padding + dot + gap - end padding). A wide pill gives
 * that much back after the label, so the label is centered in the pill.
 */
const BUTTON_DOT: Record<ButtonSize, { pad: string; dot: string; even: string }> = {
  sm: { pad: 'pl-1', dot: 'size-7', even: 'max-w-[24px]' },
  md: { pad: 'pl-1.5', dot: 'size-8', even: 'max-w-[26px]' },
  lg: { pad: 'pl-2', dot: 'size-10', even: 'max-w-[34px]' },
};

/**
 * A pill button. `dot` puts the icon in an accent circle at the pill's start:
 * the mark of a screen's main action. The dot stays at the start however wide
 * the pill is (never beside the label in the middle); the label is centered
 * in a wide pill and follows the dot in a pill that hugs its label.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  dot = false,
  loading = false,
  className,
  children,
  type,
  disabled,
  ref,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; icon?: LucideIcon; dot?: boolean; loading?: boolean; ref?: React.Ref<HTMLButtonElement> }): React.JSX.Element {
  const dotted = dot && Icon !== undefined;
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      disabled={disabled === true || loading}
      className={cn(
        'ps-press inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full font-semibold disabled:opacity-50',
        BUTTON_SIZE[size],
        BUTTON_VARIANT[variant],
        dotted && BUTTON_DOT[size].pad,
        className,
      )}
      {...rest}
    >
      {dotted ? (
        <>
          {/* While it works the dot holds the spinner, so nothing moves. */}
          <span data-dot className={cn('flex shrink-0 items-center justify-center rounded-full bg-[var(--ps-dot)] text-[var(--ps-on-dot)]', BUTTON_DOT[size].dot)}>
            {loading ? <Spinner size={size === 'sm' ? 13 : 16} /> : <Icon size={size === 'lg' ? 18 : 16} strokeWidth={2.2} aria-hidden />}
          </span>
          {/* The room a wide pill has left over goes around the label: first
              the `even` spacer after it, then equally before and after. A
              pill that hugs its label has none, and the spacers are nothing. */}
          <span className="flex min-w-0 flex-auto items-center">
            <span className="flex-[1_1_0%]" aria-hidden />
            <span data-dot-label className="min-w-0 truncate">
              {children}
            </span>
            <span className="flex-[1_1_0%]" aria-hidden />
            <span className={cn('flex-[1000_1_0%]', BUTTON_DOT[size].even)} aria-hidden />
          </span>
        </>
      ) : (
        <>
          {loading ? <Spinner size={size === 'sm' ? 13 : 16} /> : Icon !== undefined ? <Icon size={size === 'sm' ? 15 : 16} strokeWidth={2} aria-hidden /> : null}
          {children}
        </>
      )}
    </button>
  );
}

export type IconButtonVariant = 'ghost' | 'secondary' | 'light' | 'primary' | 'accent' | 'danger' | 'onDark';

/** A round icon button. */
export function IconButton({
  icon: Icon,
  label,
  variant = 'ghost',
  size = 40,
  active = false,
  className,
  ref,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; variant?: IconButtonVariant; size?: number; active?: boolean; ref?: React.Ref<HTMLButtonElement> }): React.JSX.Element {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      style={{ width: size, height: size }}
      className={cn(
        'ps-press inline-flex shrink-0 items-center justify-center rounded-full disabled:opacity-40',
        variant === 'ghost' && (active ? 'bg-[var(--ps-row-hover)] text-[var(--ps-ink)]' : 'text-[var(--ps-ink-2)] hover:bg-[var(--ps-row)] hover:text-[var(--ps-ink)]'),
        variant === 'secondary' && 'bg-[var(--ps-row)] text-[var(--ps-ink)] hover:bg-[var(--ps-row-hover)]',
        variant === 'light' && 'bg-[var(--ps-card)] text-[var(--ps-ink)] hover:bg-[var(--ps-row)]',
        variant === 'primary' && 'ps-on-ink bg-[var(--ps-ink)] text-[var(--ps-shell)] hover:opacity-90',
        variant === 'accent' && 'bg-[var(--ps-dot)] text-[var(--ps-on-dot)] hover:opacity-90',
        variant === 'danger' && 'text-[var(--ps-muted)] hover:bg-[var(--ps-red)]/12 hover:text-[var(--ps-red-text)]',
        variant === 'onDark' && 'bg-[var(--ps-dark-2)] text-[var(--ps-on-dark)] hover:opacity-90',
        className,
      )}
      {...rest}
    >
      <Icon size={Math.max(14, Math.round(size * 0.42))} strokeWidth={2} aria-hidden />
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
        tone === 'ink' && 'text-[var(--ps-ink)]',
        tone === 'muted' && 'text-[var(--ps-muted)] hover:text-[var(--ps-ink)]',
        tone === 'red' && 'text-[var(--ps-red-text)]',
        className,
      )}
    >
      {children}
    </button>
  );
}

/* --------------------------------------------------------------- display */

export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'neutral' | 'dark' | 'agent';

/** A status pill: a dot and a few words. */
export function Badge({ tone, children, pulse = false, className }: { tone: Tone; children: ReactNode; pulse?: boolean; className?: string }): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[12px] font-semibold',
        tone === 'good' && 'bg-[var(--ps-green)]/14 text-[var(--ps-green-text)]',
        tone === 'warn' && 'bg-[var(--ps-amber)]/22 text-[var(--ps-amber-text)]',
        tone === 'bad' && 'bg-[var(--ps-red)]/14 text-[var(--ps-red-text)]',
        tone === 'info' && 'ps-on-ink bg-[var(--ps-ink)] text-[var(--ps-shell)]',
        tone === 'neutral' && 'bg-[var(--ps-row)] text-[var(--ps-ink-2)]',
        tone === 'dark' && 'bg-[var(--ps-dark-2)] text-[var(--ps-on-dark)]',
        tone === 'agent' && 'bg-[var(--ps-accent-soft)] text-[var(--ps-accent-text)]',
        className,
      )}
    >
      {tone !== 'agent' && (
        <span
          aria-hidden
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            tone === 'good' && 'bg-[var(--ps-green)]',
            tone === 'warn' && 'bg-[var(--ps-amber)]',
            tone === 'bad' && 'bg-[var(--ps-red)]',
            tone === 'info' && 'bg-[var(--ps-accent)]',
            tone === 'neutral' && 'bg-[var(--ps-muted)]',
            tone === 'dark' && 'bg-[var(--ps-accent)]',
            pulse && 'ps-pulse',
          )}
        />
      )}
      {children}
    </span>
  );
}

export function Empty({ icon: Icon, title, children, action, dark = false, compact = false }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode; dark?: boolean; compact?: boolean }): React.JSX.Element {
  return (
    <div className={cn('flex flex-col items-center px-6 text-center', compact ? 'py-6' : 'py-10')}>
      <IconBadge icon={Icon} size={compact ? 48 : 56} tone={dark ? 'dark' : 'row'} className="mb-4" />
      <p className="text-[15px] font-bold">{title}</p>
      {children !== undefined && <div className={cn('mt-1 max-w-sm text-[13px] leading-5', dark ? 'text-[var(--ps-on-dark-muted)]' : 'text-[var(--ps-muted)]')}>{children}</div>}
      {action !== undefined && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** A level against its limit: a soft track with the filled share. */
export function LevelBar({ ratio, tone = 'ink', className }: { ratio: number; tone?: 'ink' | 'accent' | 'warn' | 'bad'; className?: string }): React.JSX.Element {
  const share = Math.max(0, Math.min(1, ratio));
  return (
    <span className={cn('block h-2 w-full overflow-hidden rounded-full bg-[var(--ps-track)]', className)} aria-hidden>
      <span
        style={{ width: `${share * 100}%` }}
        className={cn('block h-full rounded-full', tone === 'ink' && 'bg-[var(--ps-ink)]', tone === 'accent' && 'bg-[var(--ps-accent)]', tone === 'warn' && 'bg-[var(--ps-amber)]', tone === 'bad' && 'bg-[var(--ps-red)]')}
      />
    </span>
  );
}

/* ---------------------------------------------------------------- inputs */

/** A pill field for cards and dialogs (it sits on white). */
export const inputCls =
  'h-11 w-full min-w-0 rounded-full bg-[var(--ps-row)] px-5 text-[14px] text-[var(--ps-ink)] outline-none ring-[var(--ps-ink)] transition-shadow focus-visible:ring-2';

/** A white pill field for the shell (search and filters above a page). */
export const pillInput =
  'h-11 w-full min-w-0 rounded-full bg-[var(--ps-card)] px-5 text-[14px] text-[var(--ps-ink)] outline-none ring-[var(--ps-ink)] transition-shadow focus-visible:ring-2';

export const textareaCls =
  'w-full resize-y rounded-[18px] bg-[var(--ps-row)] px-5 py-3 text-[14px] leading-5 text-[var(--ps-ink)] outline-none ring-[var(--ps-ink)] transition-shadow focus-visible:ring-2';

/** A row inside a card: a soft rounded block that answers to the pointer. */
export const rowCls = 'rounded-[18px] bg-[var(--ps-row)] transition-colors';

export function Select({
  value,
  onChange,
  options,
  label,
  ariaLabel,
  className,
  tone = 'soft',
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label?: string;
  ariaLabel?: string;
  className?: string;
  /** `card` for the shell (a white pill), `soft` inside cards. */
  tone?: 'soft' | 'card';
}): React.JSX.Element {
  const select = (
    <div className={cn('relative min-w-0', className)}>
      <select aria-label={ariaLabel ?? label} value={value} onChange={(e) => onChange(e.target.value)} className={cn(tone === 'card' ? pillInput : inputCls, 'appearance-none truncate pr-11 font-medium')}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={16} aria-hidden className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[var(--ps-muted)]" />
    </div>
  );
  if (label === undefined) return select;
  return (
    <label className="flex min-w-0 flex-col gap-2">
      <span className="px-1 text-[13px] font-semibold text-[var(--ps-ink-2)]">{label}</span>
      {select}
    </label>
  );
}

const LABELLABLE = ['input', 'textarea', 'select'];

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode }): React.JSX.Element {
  const id = useId();
  // The label names a native control directly (unless it is named already);
  // other content becomes a group with this label.
  const native = isValidElement<{ 'aria-label'?: string }>(children) && typeof children.type === 'string' && LABELLABLE.includes(children.type);
  const unnamed = native && children.props['aria-label'] === undefined;
  return (
    <div className="flex min-w-0 flex-col gap-2" role={native ? undefined : 'group'} aria-labelledby={native ? undefined : id}>
      <span id={id} className="px-1 text-[13px] font-semibold text-[var(--ps-ink-2)]">
        {label}
      </span>
      {unnamed ? cloneElement(children, { 'aria-labelledby': id } as Record<string, string>) : children}
      {error ? <span className="px-1 text-[12px] font-medium text-[var(--ps-red-text)]">{error}</span> : hint !== undefined ? <span className="px-1 text-[12px] leading-4 text-[var(--ps-muted)]">{hint}</span> : null}
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
      className={cn('ps-on-ink relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors', checked ? 'bg-[var(--ps-ink)]' : 'bg-[var(--ps-track)]')}
    >
      <span className={cn('inline-block size-5 rounded-full shadow-sm transition-transform', checked ? 'translate-x-6 bg-[var(--ps-accent)]' : 'translate-x-1 bg-[var(--ps-card)]')} />
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
        <RadixDialog.Overlay className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px]" />
        <RadixDialog.Content
          className={cn(
            'ps-pop fixed left-1/2 top-1/2 z-[61] flex max-h-[92vh] w-[min(94vw,30rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-[28px] bg-[var(--ps-shell)] text-[var(--ps-ink)] shadow-2xl',
            wide && 'w-[min(94vw,40rem)]',
            xl && 'w-[min(94vw,56rem)]',
          )}
        >
          <div className="flex items-start justify-between gap-3 px-6 pb-4 pt-6">
            <div className="min-w-0">
              <RadixDialog.Title className="text-[15px] font-bold leading-[22px]">{title}</RadixDialog.Title>
              <RadixDialog.Description className={description !== undefined ? 'mt-1 text-[13px] text-[var(--ps-muted)]' : 'sr-only'}>{description ?? title}</RadixDialog.Description>
            </div>
            <IconButton icon={X} label="Close" variant="light" size={36} onClick={onClose} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">{children}</div>
          {footer !== undefined && <div className="flex flex-wrap justify-end gap-2 px-6 pb-6">{footer}</div>}
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
            <Button variant="light" onClick={() => settle(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => settle(true)}>
              {state.label}
            </Button>
          </>
        }
      >
        <p className="text-[14px] text-[var(--ps-ink-2)]">{state.message}</p>
      </Modal>
    ) : null;
  return [el, confirm];
}

/** A menu row inside a Popover. */
export const menuItem =
  'flex min-h-10 w-full items-center gap-3 rounded-full px-3 py-2 text-left text-[14px] font-semibold text-[var(--ps-ink)] hover:bg-[var(--ps-row)] [&>svg]:shrink-0 [&>svg]:text-[var(--ps-ink-2)]';

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
        'ps-pop ps-on-card absolute top-[calc(100%+8px)] z-40 rounded-[20px] bg-[var(--ps-card)] p-2 text-[var(--ps-ink)] shadow-[0_20px_50px_-20px_rgba(29,28,26,0.45)]',
        align === 'left' ? 'left-0' : 'right-0',
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ---------------------------------------------------- the growing screen */

export interface Origin {
  x: number;
  y: number;
}

/** The middle of what was pressed (the screen's middle without one). */
export function originOf(el: Element | null): Origin {
  if (el === null) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function reveal(el: HTMLElement, o: Origin, open: boolean): Animation {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return el.animate([{ opacity: open ? 0 : 1 }, { opacity: open ? 1 : 0 }], { duration: 160, fill: 'both' });
  }
  const r = Math.hypot(Math.max(o.x, window.innerWidth - o.x), Math.max(o.y, window.innerHeight - o.y)) + 24;
  const small = `circle(24px at ${o.x}px ${o.y}px)`;
  const big = `circle(${r}px at ${o.x}px ${o.y}px)`;
  return el.animate([{ clipPath: open ? small : big }, { clipPath: open ? big : small }], {
    duration: open ? 480 : 340,
    easing: open ? 'cubic-bezier(0.65, 0, 0.35, 1)' : 'cubic-bezier(0.55, 0, 0.75, 0.2)',
    fill: 'both',
  });
}

/**
 * A full screen that grows out of the button that opened it (a circular
 * reveal from `origin`) and shrinks back into it when closed. The children
 * get `close`, which plays the way back and then calls `onClosed`.
 */
export function RevealScreen({
  origin,
  label,
  onClosed,
  children,
  className,
}: {
  origin: Origin;
  label: string;
  onClosed: () => void;
  children: (close: () => void) => ReactNode;
  className?: string;
}): React.JSX.Element {
  const root = useRef<HTMLDivElement | null>(null);
  const closing = useRef(false);
  useLayoutEffect(() => {
    if (root.current !== null) reveal(root.current, origin, true);
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = before;
    };
  }, [origin]);
  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    if (root.current === null) {
      onClosed();
      return;
    }
    reveal(root.current, origin, false).onfinish = onClosed;
  }, [origin, onClosed]);
  return (
    <div ref={root} role="dialog" aria-modal="true" aria-label={label} className={cn('fixed inset-0 z-50 overflow-y-auto bg-[var(--ps-shell)] text-[var(--ps-ink)]', className)}>
      {children(close)}
    </div>
  );
}

/** The header of a growing screen: back, title, what to do, and its own actions. */
export function ScreenHeader({
  title,
  subtitle,
  onBack,
  actions,
  backLabel = 'Back',
  backDisabled = false,
}: {
  title: string;
  subtitle?: ReactNode;
  onBack: () => void;
  actions?: ReactNode;
  backLabel?: string;
  backDisabled?: boolean;
}): React.JSX.Element {
  return (
    <header className="ps-rise ps-d1 mb-6 flex items-center gap-4">
      <IconButton icon={ArrowLeft} label={backLabel} variant="light" size={44} onClick={onBack} disabled={backDisabled} />
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[26px] font-bold leading-[34px] tracking-[-0.01em]">{title}</h1>
        {subtitle !== undefined && <p className="truncate text-[13px] text-[var(--ps-muted)]">{subtitle}</p>}
      </div>
      {actions !== undefined && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div>}
    </header>
  );
}

export type StepState = 'todo' | 'current' | 'done';

/** One numbered step of a screen: the next step to do is ink, finished ones show a check. */
export function Step({
  n,
  state,
  title,
  hint,
  action,
  delay = 0,
  className,
  children,
}: {
  n: number;
  state: StepState;
  title: string;
  hint?: string;
  action?: ReactNode;
  delay?: number;
  className?: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <section className={cn('ps-rise ps-on-card flex min-w-0 flex-col rounded-[28px] bg-[var(--ps-card)] p-5', delay > 0 && `ps-d${Math.min(5, delay)}`, className)} aria-label={`Step ${n}: ${title}`}>
      <div className="mb-4 flex items-center gap-3">
        <span
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold transition-colors',
            state === 'todo' && 'bg-[var(--ps-row)] text-[var(--ps-ink-2)]',
            state === 'current' && 'ps-on-ink bg-[var(--ps-ink)] text-[var(--ps-shell)]',
            state === 'done' && 'bg-[var(--ps-solid)] text-[var(--ps-on-solid)]',
          )}
        >
          {state === 'done' ? <Check size={14} strokeWidth={3} aria-label="Done" /> : n}
        </span>
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-bold">{title}</h2>
        {action ?? (hint !== undefined ? <span className="text-[12px] font-semibold text-[var(--ps-muted)]">{hint}</span> : null)}
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------- choosers */

/** A row of mutually exclusive choices in one pill (a mode, a view). */
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
    <div role="radiogroup" aria-label={label} className={cn('inline-flex max-w-full flex-wrap items-center gap-1 rounded-[22px] bg-[var(--ps-row)] p-1', className)}>
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
              'ps-press inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-semibold',
              size === 'sm' ? 'h-8 px-3 text-[12px]' : 'h-9 px-3.5 text-[13px]',
              on ? 'ps-on-ink bg-[var(--ps-ink)] text-[var(--ps-shell)]' : 'text-[var(--ps-ink-2)] hover:text-[var(--ps-ink)]',
            )}
          >
            {Icon !== undefined && <Icon size={15} aria-hidden />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** A page's views as pills on the shell. */
export function Tabs<T extends string>({ value, options, onChange, label, className }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string; className?: string }): React.JSX.Element {
  return (
    <div role="tablist" aria-label={label} className={cn('ps-no-scrollbar flex shrink-0 items-center gap-2 overflow-x-auto', className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className={cn(
              'ps-press inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 text-[13px] font-semibold',
              on ? 'ps-on-ink bg-[var(--ps-ink)] text-[var(--ps-shell)]' : 'bg-[var(--ps-card)] text-[var(--ps-ink)] hover:bg-[var(--ps-row)]',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** The small count a pill or a tab carries. */
export function Count({ n, on = false }: { n: number; on?: boolean }): React.JSX.Element {
  return (
    <span className={cn('num inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[12px] font-bold leading-none', on ? 'bg-[var(--ps-accent-fill)] text-[var(--ps-on-accent)]' : 'bg-[var(--ps-row)] text-[var(--ps-ink-2)]')}>
      {n > 999 ? '999+' : n}
    </span>
  );
}

/** A filter chip with an optional count. `soft` for chips inside a card. */
export function Chip({
  active,
  onClick,
  children,
  count,
  soft = false,
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  count?: number | undefined;
  soft?: boolean;
  className?: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        'ps-press inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 text-[13px] font-semibold',
        active ? 'ps-on-ink bg-[var(--ps-ink)] text-[var(--ps-shell)]' : soft ? 'bg-[var(--ps-row)] text-[var(--ps-ink)] hover:bg-[var(--ps-row-hover)]' : 'bg-[var(--ps-card)] text-[var(--ps-ink)] hover:bg-[var(--ps-row)]',
        count !== undefined && 'pr-2.5',
        className,
      )}
    >
      {children}
      {count !== undefined && (
        <span
          className={cn(
            'num inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[12px] font-bold leading-none',
            active ? 'bg-[var(--ps-accent-fill)] text-[var(--ps-on-accent)]' : soft ? 'bg-[var(--ps-card)] text-[var(--ps-ink-2)]' : 'bg-[var(--ps-row)] text-[var(--ps-ink-2)]',
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export function Spinner({ size = 16, className }: { size?: number; className?: string }): React.JSX.Element {
  return <span aria-label="Working" style={{ width: size, height: size }} className={cn('inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent', className)} />;
}

/** A search pill with its icon and a clear button. `tone="card"` on the shell. */
export function SearchField({
  value,
  onChange,
  placeholder,
  label,
  className,
  autoFocus = false,
  onEnter,
  inputRef,
  size = 'md',
  tone = 'soft',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
  className?: string;
  autoFocus?: boolean;
  onEnter?: (v: string) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  size?: 'md' | 'lg';
  tone?: 'soft' | 'card';
}): React.JSX.Element {
  return (
    <div className={cn('relative min-w-0', className)}>
      <Search size={16} aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--ps-muted)]" />
      <input
        ref={inputRef}
        type="search"
        aria-label={label}
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onEnter !== undefined) {
            e.preventDefault();
            onEnter(e.currentTarget.value);
          }
          if (e.key === 'Escape' && value !== '') {
            e.stopPropagation();
            onChange('');
          }
        }}
        className={cn(tone === 'card' ? pillInput : inputCls, 'pl-11 pr-11', size === 'lg' && 'h-12')}
      />
      {value !== '' && (
        <button
          type="button"
          aria-label="Clear the search"
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-[var(--ps-muted)] hover:bg-[var(--ps-row-hover)] hover:text-[var(--ps-ink)]"
        >
          <X size={14} aria-hidden />
        </button>
      )}
    </div>
  );
}

/** A person's initials on their color. */
export function Avatar({ name, color, size = 40, className }: { name: string; color: number; size?: number; className?: string }): React.JSX.Element {
  const initials = name
    .split(/\s+/)
    .filter((w) => w !== '')
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
  const slot = color >= 1 && color <= 8 ? color : 0;
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, background: `var(--ps-cat-${slot}-soft)`, color: `var(--ps-cat-${slot}-text)`, fontSize: size >= 56 ? 15 : size >= 40 ? 13 : 12 }}
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-bold', className)}
    >
      {initials || '?'}
    </span>
  );
}

/** A labelled one-line text field. */
export function TextField({
  label,
  value,
  onChange,
  placeholder,
  error,
  hint,
  type = 'text',
  autoFocus = false,
  inputMode,
  maxLength,
  onEnter,
  tone = 'soft',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string | null;
  hint?: ReactNode;
  type?: 'text' | 'email' | 'tel' | 'url';
  autoFocus?: boolean;
  inputMode?: 'text' | 'decimal' | 'numeric' | 'email' | 'tel';
  maxLength?: number;
  onEnter?: () => void;
  /** `card` when the field sits on the shell or straight on a dialog. */
  tone?: 'soft' | 'card';
}): React.JSX.Element {
  return (
    <Field label={label} error={error ?? null} hint={hint}>
      <input
        type={type}
        aria-label={label}
        value={value}
        autoFocus={autoFocus}
        inputMode={inputMode}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onEnter !== undefined) {
            e.preventDefault();
            onEnter();
          }
        }}
        className={cn(tone === 'card' ? pillInput : inputCls, error ? 'ring-2 ring-[var(--ps-red)]' : '')}
      />
    </Field>
  );
}
