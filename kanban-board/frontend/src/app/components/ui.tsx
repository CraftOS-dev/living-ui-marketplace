/**
 * The app's controls, in CraftBot's language: 32px controls with 8px
 * corners, hairline borders, pill buttons for choices (like the composer's
 * "High" pill), quiet ghost icon buttons, a right-hand sheet and a centred
 * dialog. Menus and popovers are portaled and stay inside the window.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
import { Bot, Check, ChevronDown, Loader2, Menu, X } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { initials } from '../lib/format.ts';
import { useApp } from '../lib/context.tsx';
import type { Assignee } from '../lib/types.ts';

export function errMessage(err: unknown): string {
  const e = err as { message?: string; response?: { message?: string } };
  return e.response?.message ?? e.message ?? 'Something went wrong';
}

/* ---------------------------------------------------------------- buttons */

/** On a phone: opens the sidebar drawer (with a dot when something needs you). Hidden on wider screens. */
export function MenuButton(): React.JSX.Element {
  const app = useApp();
  return (
    <button type="button" aria-label="Open the menu" onClick={() => app.setMenu(true)} className="kb-focus relative -ml-1 flex size-9 shrink-0 items-center justify-center rounded-[var(--kb-radius-sm)] text-[var(--kb-ink)] hover:bg-[var(--kb-main-hover)] md:hidden">
      <Menu size={19} strokeWidth={1.9} aria-hidden />
      {app.needsYou > 0 && <span aria-hidden className="absolute right-1.5 top-1.5 size-2 rounded-full bg-[var(--kb-accent)] ring-2 ring-[var(--kb-main)]" />}
    </button>
  );
}

type Variant = 'primary' | 'default' | 'ghost' | 'danger' | 'pill';

export function Button({
  variant = 'default',
  size = 'md',
  icon: Icon,
  iconRight: IconRight,
  children,
  className,
  busy,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; icon?: LucideIcon | undefined; iconRight?: LucideIcon | undefined; busy?: boolean | undefined; ref?: React.Ref<HTMLButtonElement> }): React.JSX.Element {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled === true || busy === true}
      className={cn(
        'kb-focus inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-colors disabled:cursor-default disabled:opacity-45',
        size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-8 px-3 text-[13px]',
        variant === 'pill' ? 'rounded-full' : 'rounded-[var(--kb-radius-sm)]',
        variant === 'primary' && 'bg-[var(--kb-accent)] text-[var(--kb-accent-ink)] hover:brightness-[1.06] active:brightness-95',
        variant === 'default' && 'border border-[var(--kb-line)] bg-[var(--kb-main)] text-[var(--kb-ink)] hover:bg-[var(--kb-main-hover)]',
        variant === 'pill' && 'border border-[var(--kb-line)] bg-[var(--kb-main)] text-[var(--kb-ink-2)] hover:bg-[var(--kb-main-hover)] hover:text-[var(--kb-ink)]',
        variant === 'ghost' && 'text-[var(--kb-ink-2)] hover:bg-[var(--kb-main-hover)] hover:text-[var(--kb-ink)]',
        variant === 'danger' && 'border border-[var(--kb-line)] bg-[var(--kb-main)] text-[var(--kb-red)] hover:bg-[var(--kb-red-soft)]',
        className,
      )}
    >
      {busy === true ? <Loader2 size={14} className="animate-spin" aria-hidden /> : Icon !== undefined ? <Icon size={size === 'sm' ? 13 : 14} strokeWidth={1.9} aria-hidden /> : null}
      {children}
      {IconRight !== undefined && <IconRight size={13} strokeWidth={1.9} aria-hidden className="opacity-70" />}
    </button>
  );
}

export function IconButton({
  icon: Icon,
  label,
  size = 28,
  active,
  className,
  tone,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; size?: number; active?: boolean | undefined; tone?: 'danger' | undefined; ref?: React.Ref<HTMLButtonElement> }): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      style={{ width: size, height: size }}
      className={cn(
        'kb-focus inline-flex shrink-0 items-center justify-center rounded-[var(--kb-radius-sm)] transition-colors disabled:cursor-default disabled:opacity-40',
        active === true ? 'bg-[var(--kb-active)] text-[var(--kb-ink)]' : tone === 'danger' ? 'text-[var(--kb-muted)] hover:bg-[var(--kb-red-soft)] hover:text-[var(--kb-red)]' : 'text-[var(--kb-muted)] hover:bg-[var(--kb-main-hover)] hover:text-[var(--kb-ink)]',
        className,
      )}
    >
      <Icon size={Math.round(size * 0.55)} strokeWidth={1.8} aria-hidden />
    </button>
  );
}

/* ----------------------------------------------------------------- fields */

export function Input({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { ref?: React.Ref<HTMLInputElement> }): React.JSX.Element {
  return <input {...rest} className={cn('kb-field h-8 w-full px-2.5 text-[13px]', className)} />;
}

/** A textarea that grows with its text. */
export function Textarea({ className, minRows = 2, value, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number; value: string; ref?: React.Ref<HTMLTextAreaElement> }): React.JSX.Element {
  const inner = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = inner.current;
    if (el === null) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight + 2, minRows * 20 + 14)}px`;
  }, [value, minRows]);
  const { ref, ...others } = rest as { ref?: React.Ref<HTMLTextAreaElement> } & typeof rest;
  return (
    <textarea
      {...others}
      value={value}
      ref={(el) => {
        inner.current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref && typeof ref === 'object') (ref as React.RefObject<HTMLTextAreaElement | null>).current = el;
      }}
      rows={minRows}
      className={cn('kb-field kb-scroll block w-full resize-none px-2.5 py-1.5 text-[13px] leading-5', className)}
    />
  );
}

export function Select({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>): React.JSX.Element {
  return (
    <span className={cn('relative inline-flex w-full', className)}>
      <select {...rest} className="kb-field h-8 w-full appearance-none pl-2.5 pr-7 text-[13px]">
        {children}
      </select>
      <ChevronDown size={14} aria-hidden className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--kb-muted)]" />
    </span>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean | undefined }): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn('kb-focus relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full transition-colors disabled:opacity-40', checked ? 'bg-[var(--kb-accent)]' : 'bg-[var(--kb-line)]')}
    >
      <span className={cn('absolute size-3.5 rounded-full bg-white shadow-sm transition-transform', checked ? 'translate-x-[16px]' : 'translate-x-[2px]')} />
    </button>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label, size = 'md' }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; title?: string }[]; label: string; size?: 'sm' | 'md' }): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex max-w-full shrink-0 items-center gap-0.5 rounded-[var(--kb-radius-sm)] bg-[var(--kb-card)] p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            'kb-focus inline-flex items-center gap-1 whitespace-nowrap rounded-[calc(var(--kb-radius-sm)-2px)] font-medium transition-colors',
            size === 'sm' ? 'h-6 px-2 text-[12px]' : 'h-7 px-2.5 text-[12.5px]',
            value === o.value ? 'bg-[var(--kb-main)] text-[var(--kb-ink)] shadow-[var(--kb-shadow)]' : 'text-[var(--kb-muted)] hover:text-[var(--kb-ink)]',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }): React.JSX.Element {
  return (
    <label className={cn('flex flex-col gap-1.5', className)}>
      <span className="text-[12px] font-medium text-[var(--kb-ink-2)]">{label}</span>
      {children}
      {hint !== undefined && <span className="text-[12px] leading-4 text-[var(--kb-muted)]">{hint}</span>}
    </label>
  );
}

/** A label on the left, a control on the right. */
export function Row({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <div className="min-w-0">
        <div className="text-[13px] text-[var(--kb-ink)]">{label}</div>
        {hint !== undefined && <div className="mt-0.5 text-[12px] leading-4 text-[var(--kb-muted)]">{hint}</div>}
      </div>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }): React.JSX.Element {
  return <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-[var(--kb-line)] bg-[var(--kb-card)] px-1 font-sans text-[11px] text-[var(--kb-muted)]">{children}</kbd>;
}

export function Spinner({ size = 14, className }: { size?: number; className?: string }): React.JSX.Element {
  return <Loader2 size={size} className={cn('animate-spin', className)} aria-hidden />;
}

/* --------------------------------------------------------------- avatars */

/** The agent: one mark everywhere, a rounded square with the bot glyph (you are a circle). */
export function AgentAvatar({ size = 22, ring, paused }: { size?: number; ring?: boolean; paused?: boolean }): React.JSX.Element {
  return (
    <span
      title={paused === true ? 'Agent (paused)' : 'Agent'}
      className={cn('kb-tone kb-tone-orange relative inline-flex shrink-0 items-center justify-center', ring === true && 'ring-2 ring-[var(--kb-main)]', paused === true && 'opacity-60 grayscale')}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.3) }}
    >
      <Bot size={Math.round(size * 0.62)} strokeWidth={2} aria-hidden />
    </span>
  );
}

export function YouAvatar({ name, size = 22 }: { name: string; size?: number }): React.JSX.Element {
  return (
    <span title={name || 'You'} className="inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--kb-ink)] font-semibold text-[var(--kb-main)]" style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.42)) }}>
      {initials(name || 'You').slice(0, size < 20 ? 1 : 2)}
    </span>
  );
}

export function AssigneeAvatar({ assignee, you, size = 20 }: { assignee: Assignee; you: string; size?: number }): React.JSX.Element | null {
  if (assignee === 'you') return <YouAvatar name={you} size={size} />;
  if (assignee === 'agent') return <AgentAvatar size={size} />;
  return null;
}

/* ------------------------------------------------------------------ chips */

export type ChipTone = 'neutral' | 'green' | 'amber' | 'red' | 'blue' | 'violet' | 'accent';

export function Chip({ tone = 'neutral', icon: Icon, children, className, title, pulse }: { tone?: ChipTone; icon?: LucideIcon | undefined; children?: ReactNode; className?: string; title?: string | undefined; pulse?: boolean }): React.JSX.Element {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-5 max-w-full shrink-0 items-center gap-1 rounded-full px-1.5 text-[11.5px] font-medium',
        tone === 'neutral' && 'bg-[var(--kb-card)] text-[var(--kb-ink-2)] ring-1 ring-inset ring-[var(--kb-hair)]',
        tone === 'green' && 'bg-[var(--kb-green-soft)] text-[var(--kb-green)]',
        tone === 'amber' && 'bg-[var(--kb-amber-soft)] text-[var(--kb-amber)]',
        tone === 'red' && 'bg-[var(--kb-red-soft)] text-[var(--kb-red)]',
        tone === 'blue' && 'bg-[var(--kb-blue-soft)] text-[var(--kb-blue)]',
        tone === 'violet' && 'bg-[var(--kb-violet-soft)] text-[var(--kb-violet)]',
        tone === 'accent' && 'bg-[var(--kb-accent-soft)] text-[var(--kb-accent-text)]',
        className,
      )}
    >
      {pulse === true ? <span aria-hidden className="kb-pulse size-1.5 shrink-0 rounded-full bg-current" /> : Icon !== undefined ? <Icon size={11} strokeWidth={2.2} aria-hidden className="shrink-0" /> : null}
      {children !== undefined && <span className="truncate">{children}</span>}
    </span>
  );
}

export function Count({ n, tone = 'neutral' }: { n: number; tone?: 'neutral' | 'accent' }): React.JSX.Element | null {
  if (n <= 0) return null;
  return <span className={cn('kb-num inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-semibold', tone === 'accent' ? 'bg-[var(--kb-accent)] text-[var(--kb-accent-ink)]' : 'bg-[var(--kb-active)] text-[var(--kb-ink-2)]')}>{n > 99 ? '99+' : n}</span>;
}

export function Empty({ icon: Icon, title, children, action, className }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode; className?: string }): React.JSX.Element {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-6 py-10 text-center', className)}>
      <span className="flex size-10 items-center justify-center rounded-full bg-[var(--kb-card)] text-[var(--kb-muted)]">
        <Icon size={18} strokeWidth={1.8} aria-hidden />
      </span>
      <div className="text-[14px] font-semibold">{title}</div>
      {children !== undefined && <div className="max-w-sm text-[13px] leading-5 text-[var(--kb-muted)]">{children}</div>}
      {action !== undefined && <div className="mt-2">{action}</div>}
    </div>
  );
}

/* --------------------------------------------------------------- overlays */

/** A floating panel anchored to an element; closes on outside click or Esc. */
export function Popover({
  anchor,
  open,
  onClose,
  children,
  className,
  align = 'start',
  side = 'bottom',
  width,
}: {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  align?: 'start' | 'end';
  side?: 'bottom' | 'right';
  width?: number;
}): React.JSX.Element | null {
  const panel = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const place = useCallback(() => {
    const a = anchor.current;
    const p = panel.current;
    if (a === null || p === null) return;
    const r = a.getBoundingClientRect();
    const w = p.offsetWidth;
    const h = p.offsetHeight;
    let left = side === 'right' ? r.right + 6 : align === 'end' ? r.right - w : r.left;
    let top = side === 'right' ? r.top : r.bottom + 4;
    if (top + h > window.innerHeight - 8) top = Math.max(8, side === 'right' ? window.innerHeight - h - 8 : r.top - h - 4);
    left = Math.min(Math.max(8, left), window.innerWidth - w - 8);
    setPos({ left, top });
  }, [anchor, align, side]);
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    place();
  }, [open, place]);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent): void => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || anchor.current?.contains(t)) return;
      if ((t as HTMLElement).closest?.('[data-kb-popover]')) return;
      onClose();
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', place);
    };
  }, [open, onClose, anchor, place]);
  if (!open) return null;
  return createPortal(
    <div
      ref={panel}
      data-kb-popover=""
      style={{ position: 'fixed', left: pos?.left ?? -9999, top: pos?.top ?? -9999, width, zIndex: 80 }}
      className={cn('kb-in kb-scroll max-h-[min(420px,80vh)] overflow-y-auto rounded-[var(--kb-radius)] border border-[var(--kb-line)] bg-[var(--kb-main)] p-1 shadow-[var(--kb-shadow-lg)]', className)}
    >
      {children}
    </div>,
    document.body,
  );
}

export function MenuItem({ icon: Icon, children, onClick, danger, selected, hint, disabled }: { icon?: LucideIcon | undefined; children: ReactNode; onClick: () => void; danger?: boolean; selected?: boolean; hint?: ReactNode; disabled?: boolean }): React.JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn('kb-focus flex h-8 w-full items-center gap-2 rounded-[var(--kb-radius-sm)] px-2 text-left text-[13px] transition-colors disabled:opacity-40', danger === true ? 'text-[var(--kb-red)] hover:bg-[var(--kb-red-soft)]' : 'text-[var(--kb-ink)] hover:bg-[var(--kb-main-hover)]')}
    >
      {Icon !== undefined && <Icon size={14} strokeWidth={1.8} aria-hidden className={danger === true ? '' : 'text-[var(--kb-muted)]'} />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint !== undefined && <span className="shrink-0 text-[12px] text-[var(--kb-muted)]">{hint}</span>}
      {selected === true && <Check size={14} aria-hidden className="shrink-0 text-[var(--kb-ink)]" />}
    </button>
  );
}

export function MenuLabel({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--kb-muted)]">{children}</div>;
}

export function MenuSep(): React.JSX.Element {
  return <div className="my-1 h-px bg-[var(--kb-hair)]" />;
}

function useEscape(open: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && document.querySelector('[data-kb-popover]') === null) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open, onClose]);
}

/** A centred modal dialog. */
export function Dialog({ open, onClose, title, children, footer, width = 480 }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }): React.JSX.Element | null {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="kb-scrim fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto px-4 pb-10 pt-[12vh]" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} className="kb-in w-full rounded-[var(--kb-radius-lg)] border border-[var(--kb-line)] bg-[var(--kb-main)] shadow-[var(--kb-shadow-lg)]" style={{ maxWidth: width }}>
        <div className="flex items-center gap-2 px-5 pb-1 pt-4">
          <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{title}</h2>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </div>
        <div className="px-5 pb-4 pt-2">{children}</div>
        {footer !== undefined && <div className="flex items-center justify-end gap-2 border-t border-[var(--kb-hair)] px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** A panel docked to the right edge (settings, a column's contract). */
export function Sheet({ open, onClose, title, subtitle, children, width = 440, actions, label }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; width?: number; actions?: ReactNode; label?: string }): React.JSX.Element | null {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[60]" onPointerDown={(e) => e.target === e.currentTarget && onClose()} style={{ background: 'var(--kb-overlay)' }}>
      <aside role="dialog" aria-modal="true" aria-label={label ?? (typeof title === 'string' ? title : undefined)} className="kb-slide absolute bottom-0 right-0 top-0 flex w-full flex-col border-l border-[var(--kb-line)] bg-[var(--kb-main)] shadow-[var(--kb-shadow-lg)]" style={{ maxWidth: width }}>
        <header className="flex shrink-0 items-start gap-2 border-b border-[var(--kb-hair)] px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[15px] font-semibold">{title}</h2>
            {subtitle !== undefined && <div className="mt-0.5 text-[12px] text-[var(--kb-muted)]">{subtitle}</div>}
          </div>
          {actions}
          <IconButton icon={X} label="Close" onClick={onClose} />
        </header>
        <div className="kb-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}

export function Section({ title, children, aside, className }: { title: ReactNode; children: ReactNode; aside?: ReactNode; className?: string }): React.JSX.Element {
  return (
    <section className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-center gap-2">
        <h3 className="flex-1 text-[12px] font-semibold uppercase tracking-wide text-[var(--kb-muted)]">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Ask before something that cannot be undone. */
export function useConfirm(): [React.JSX.Element | null, (text: string, title: string, ok?: string) => Promise<boolean>] {
  const [state, setState] = useState<{ text: string; title: string; ok: string; resolve: (v: boolean) => void } | null>(null);
  const ask = useCallback((text: string, title: string, ok = 'Delete') => new Promise<boolean>((resolve) => setState({ text, title, ok, resolve })), []);
  const close = (v: boolean): void => {
    state?.resolve(v);
    setState(null);
  };
  const el =
    state === null ? null : (
      <Dialog
        open
        onClose={() => close(false)}
        title={state.title}
        width={420}
        footer={
          <>
            <Button onClick={() => close(false)}>Cancel</Button>
            <Button variant="primary" className="!bg-[var(--kb-red)]" onClick={() => close(true)} autoFocus>
              {state.ok}
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-5 text-[var(--kb-ink-2)]">{state.text}</p>
      </Dialog>
    );
  return [el, ask];
}

export function Tabs<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; className?: string }): React.JSX.Element {
  return (
    <div role="tablist" className={cn('flex h-9 shrink-0 items-stretch gap-4 border-b border-[var(--kb-hair)]', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn('kb-focus relative inline-flex items-center gap-1.5 text-[13px] font-medium transition-colors', value === o.value ? 'text-[var(--kb-ink)]' : 'text-[var(--kb-muted)] hover:text-[var(--kb-ink)]')}
        >
          {o.label}
          {value === o.value && <span aria-hidden className="absolute -bottom-px left-0 right-0 h-[2px] rounded-full bg-[var(--kb-ink)]" />}
        </button>
      ))}
    </div>
  );
}

/** Text that saves when you leave the field (or press Enter on one line). */
export function EditableText({ value, onSave, placeholder, className, multiline, minRows = 2, label }: { value: string; onSave: (v: string) => void; placeholder?: string; className?: string; multiline?: boolean; minRows?: number; label: string }): React.JSX.Element {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  const commit = (): void => {
    focused.current = false;
    if (draft !== value) onSave(draft);
  };
  if (multiline === true) {
    return (
      <Textarea
        aria-label={label}
        value={draft}
        minRows={minRows}
        placeholder={placeholder}
        onFocus={() => (focused.current = true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setDraft(value);
            (e.target as HTMLTextAreaElement).blur();
          }
        }}
        className={className}
      />
    );
  }
  return (
    <input
      aria-label={label}
      value={draft}
      placeholder={placeholder}
      onFocus={() => (focused.current = true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setDraft(value);
          focused.current = false;
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={cn('kb-field h-8 w-full px-2.5 text-[13px]', className)}
    />
  );
}

/** Tags typed as text: comma or Enter adds one. */
export function TagInput({ value, onChange, placeholder, label }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; label: string }): React.JSX.Element {
  const [text, setText] = useState('');
  const add = (): void => {
    const t = text.trim().toLowerCase().replace(/,+$/, '');
    if (t !== '' && !value.includes(t)) onChange([...value, t]);
    setText('');
  };
  return (
    <div className="kb-field flex min-h-8 flex-wrap items-center gap-1 px-1.5 py-1">
      {value.map((t) => (
        <span key={t} className="inline-flex h-6 items-center gap-1 rounded-full bg-[var(--kb-card)] pl-2 pr-1 text-[12px] ring-1 ring-inset ring-[var(--kb-hair)]">
          {t}
          <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(value.filter((x) => x !== t))} className="flex size-4 items-center justify-center rounded-full text-[var(--kb-muted)] hover:bg-[var(--kb-active)] hover:text-[var(--kb-ink)]">
            <X size={11} aria-hidden />
          </button>
        </span>
      ))}
      <input
        aria-label={label}
        value={text}
        placeholder={value.length === 0 ? placeholder : ''}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add();
          } else if (e.key === 'Backspace' && text === '' && value.length > 0) onChange(value.slice(0, -1));
        }}
        onBlur={add}
        className="h-6 min-w-[80px] flex-1 bg-transparent px-1 text-[13px] outline-none placeholder:text-[var(--kb-faint)]"
      />
    </div>
  );
}
