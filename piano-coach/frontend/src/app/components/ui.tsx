/**
 * The app's controls, in the instrument language: 32px controls with small
 * corners, hairline borders, an ink primary button, quiet ghost icons, a
 * centred dialog and a panel docked on the right. Menus and popovers are
 * portaled and stay inside the window.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
import { Check, ChevronDown, Loader2, Menu, X } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { useApp } from '../lib/context.tsx';

export function errMessage(err: unknown): string {
  const e = err as { message?: string; response?: { message?: string } };
  return e.response?.message ?? e.message ?? 'Something went wrong';
}

/* ---------------------------------------------------------------- buttons */

/** On a phone: opens the sidebar drawer. Hidden on wider screens. */
export function MenuButton(): React.JSX.Element {
  const app = useApp();
  return (
    <button type="button" aria-label="Open the menu" onClick={() => app.setMenu(true)} className="pc-focus relative -ml-1 flex size-9 shrink-0 items-center justify-center rounded-[var(--pc-radius-sm)] text-[var(--pc-ink)] hover:bg-[var(--pc-hover)] md:hidden">
      <Menu size={19} strokeWidth={1.9} aria-hidden />
      {app.unread > 0 && <span aria-hidden className="absolute right-1.5 top-1.5 size-2 rounded-full bg-[var(--pc-coach)] ring-2 ring-[var(--pc-page)]" />}
    </button>
  );
}

type Variant = 'primary' | 'default' | 'ghost' | 'danger' | 'coach';

export function Button({
  variant = 'default',
  size = 'md',
  icon: Icon,
  iconRight: IconRight,
  children,
  className,
  busy,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; icon?: LucideIcon | undefined; iconRight?: LucideIcon | undefined; busy?: boolean | undefined; ref?: React.Ref<HTMLButtonElement> }): React.JSX.Element {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled === true || busy === true}
      className={cn(
        'pc-focus inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--pc-radius-sm)] font-medium transition-[background-color,color,filter,transform] active:translate-y-[0.5px] disabled:cursor-default disabled:opacity-45',
        size === 'sm' ? 'h-7 px-2.5 text-[12px]' : size === 'lg' ? 'h-10 px-4 text-[14px]' : 'h-8 px-3 text-[13px]',
        variant === 'primary' && 'bg-[var(--pc-ink)] text-[var(--pc-page)] hover:brightness-[1.25] dark:hover:brightness-90',
        variant === 'coach' && 'bg-[var(--pc-coach)] text-[var(--pc-coach-ink)] hover:brightness-[1.06]',
        variant === 'default' && 'border border-[var(--pc-line)] bg-[var(--pc-raised)] text-[var(--pc-ink)] hover:bg-[var(--pc-hover)]',
        variant === 'ghost' && 'text-[var(--pc-ink-2)] hover:bg-[var(--pc-hover)] hover:text-[var(--pc-ink)]',
        variant === 'danger' && 'border border-[var(--pc-line)] bg-[var(--pc-raised)] text-[var(--pc-bad)] hover:bg-[var(--pc-bad-soft)]',
        className,
      )}
    >
      {busy === true ? <Loader2 size={14} className="animate-spin" aria-hidden /> : Icon !== undefined ? <Icon size={size === 'sm' ? 13 : size === 'lg' ? 16 : 14} strokeWidth={1.9} aria-hidden /> : null}
      {children}
      {IconRight !== undefined && <IconRight size={13} strokeWidth={1.9} aria-hidden className="opacity-70" />}
    </button>
  );
}

export function IconButton({
  icon: Icon,
  label,
  size = 30,
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
      style={{ width: size, height: size, ...rest.style }}
      className={cn(
        'pc-focus inline-flex shrink-0 items-center justify-center rounded-[var(--pc-radius-sm)] transition-colors disabled:cursor-default disabled:opacity-40',
        active === true ? 'bg-[var(--pc-active)] text-[var(--pc-ink)]' : tone === 'danger' ? 'text-[var(--pc-muted)] hover:bg-[var(--pc-bad-soft)] hover:text-[var(--pc-bad)]' : 'text-[var(--pc-muted)] hover:bg-[var(--pc-hover)] hover:text-[var(--pc-ink)]',
        className,
      )}
    >
      <Icon size={Math.round(size * 0.53)} strokeWidth={1.8} aria-hidden />
    </button>
  );
}

/* ----------------------------------------------------------------- fields */

const FIELD = 'w-full rounded-[var(--pc-radius-sm)] border border-[var(--pc-line)] bg-[var(--pc-raised)] text-[var(--pc-ink)] outline-none transition-[border-color,box-shadow] placeholder:text-[var(--pc-faint)] focus:border-[var(--pc-ink-2)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--pc-ink),transparent_90%)]';

export function Input({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { ref?: React.Ref<HTMLInputElement> }): React.JSX.Element {
  return <input {...rest} className={cn(FIELD, 'h-8 px-2.5 text-[13px]', className)} />;
}

/** A textarea that grows with its text. */
export function Textarea({ className, minRows = 2, maxRows = 14, value, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number; maxRows?: number; value: string; ref?: React.Ref<HTMLTextAreaElement> }): React.JSX.Element {
  const inner = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = inner.current;
    if (el === null) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(maxRows * 20 + 14, Math.max(el.scrollHeight + 2, minRows * 20 + 14))}px`;
  }, [value, minRows, maxRows]);
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
      className={cn(FIELD, 'pc-scroll block resize-none px-2.5 py-1.5 text-[13px] leading-5', className)}
    />
  );
}

export function Select({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>): React.JSX.Element {
  return (
    <span className={cn('relative inline-flex w-full', className)}>
      <select {...rest} className={cn(FIELD, 'h-8 appearance-none pl-2.5 pr-7 text-[13px]')}>
        {children}
      </select>
      <ChevronDown size={14} aria-hidden className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--pc-muted)]" />
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
      className={cn('pc-focus relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full transition-colors disabled:opacity-40', checked ? 'bg-[var(--pc-ink)]' : 'bg-[var(--pc-line-2)]')}
    >
      <span className={cn('absolute size-3.5 rounded-full bg-[var(--pc-raised)] shadow-sm transition-transform duration-200', checked ? 'translate-x-[16px]' : 'translate-x-[2px]')} />
    </button>
  );
}

/** A segmented choice; the selected segment slides. */
export function Segmented<T extends string>({ value, onChange, options, label, size = 'md', className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; title?: string; icon?: LucideIcon }[]; label: string; size?: 'sm' | 'md'; className?: string }): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (el !== null && el !== undefined) setPill({ left: el.offsetLeft, width: el.offsetWidth });
  }, [value, options.length]);
  return (
    <div ref={ref} role="radiogroup" aria-label={label} className={cn('relative inline-flex max-w-full shrink-0 items-center rounded-[var(--pc-radius-sm)] border border-[var(--pc-line)] bg-[var(--pc-sunk)] p-0.5', className)}>
      {pill !== null && <span aria-hidden className="absolute bottom-0.5 top-0.5 rounded-[calc(var(--pc-radius-sm)-2px)] bg-[var(--pc-raised)] shadow-[var(--pc-shadow)] transition-[left,width] duration-200 ease-out" style={{ left: pill.left, width: pill.width }} />}
      {options.map((o) => {
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn('pc-focus relative z-[1] inline-flex items-center gap-1.5 whitespace-nowrap font-medium transition-colors', size === 'sm' ? 'h-6 px-2 text-[12px]' : 'h-7 px-2.5 text-[12.5px]', value === o.value ? 'text-[var(--pc-ink)]' : 'text-[var(--pc-muted)] hover:text-[var(--pc-ink)]')}
          >
            {Icon !== undefined && <Icon size={13} strokeWidth={1.9} aria-hidden />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }): React.JSX.Element {
  return (
    <label className={cn('flex flex-col gap-1.5', className)}>
      <span className="text-[12px] font-medium text-[var(--pc-ink-2)]">{label}</span>
      {children}
      {hint !== undefined && <span className="text-[12px] leading-4 text-[var(--pc-muted)]">{hint}</span>}
    </label>
  );
}

/** A label on the left, a control on the right. */
export function Row({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="min-w-0">
        <div className="text-[13px] text-[var(--pc-ink)]">{label}</div>
        {hint !== undefined && <div className="mt-0.5 text-[12px] leading-4 text-[var(--pc-muted)]">{hint}</div>}
      </div>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }): React.JSX.Element {
  return <kbd className="pc-mono inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-[var(--pc-line)] bg-[var(--pc-raised)] px-1 text-[10.5px] text-[var(--pc-muted)]">{children}</kbd>;
}

export function Spinner({ size = 14, className }: { size?: number; className?: string }): React.JSX.Element {
  return <Loader2 size={size} className={cn('animate-spin', className)} aria-hidden />;
}

/** A panel with an instrument-style label: "01  PLAN". */
export function Panel({ index, label, aside, children, className, bodyClass }: { index?: string | undefined; label?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string | undefined; bodyClass?: string | undefined }): React.JSX.Element {
  return (
    <section className={cn('pc-panel flex min-w-0 flex-col', className)}>
      {(label !== undefined || aside !== undefined) && (
        <header className="flex h-9 shrink-0 items-center gap-2 px-3.5">
          {index !== undefined && <span className="pc-label text-[var(--pc-faint)]">{index}</span>}
          {label !== undefined && <span className="pc-label min-w-0 flex-1 truncate">{label}</span>}
          {aside}
        </header>
      )}
      <div className={cn('min-h-0 flex-1 px-3.5 pb-3.5', bodyClass)}>{children}</div>
    </section>
  );
}

export function Empty({ icon: Icon, title, children, action, className }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode; className?: string }): React.JSX.Element {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-6 py-10 text-center', className)}>
      <span className="flex size-10 items-center justify-center rounded-full border border-[var(--pc-line)] bg-[var(--pc-raised)] text-[var(--pc-muted)]">
        <Icon size={18} strokeWidth={1.8} aria-hidden />
      </span>
      <div className="text-[14px] font-semibold">{title}</div>
      {children !== undefined && <div className="max-w-sm text-[13px] leading-5 text-[var(--pc-muted)]">{children}</div>}
      {action !== undefined && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Count({ n, tone = 'neutral' }: { n: number; tone?: 'neutral' | 'coach' }): React.JSX.Element | null {
  if (n <= 0) return null;
  return <span className={cn('pc-num pc-mono inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10.5px] font-semibold', tone === 'coach' ? 'bg-[var(--pc-coach)] text-[var(--pc-coach-ink)]' : 'bg-[var(--pc-active)] text-[var(--pc-ink-2)]')}>{n > 99 ? '99+' : n}</span>;
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
  side?: 'bottom' | 'top' | 'right';
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
    let top = side === 'right' ? r.top : side === 'top' ? r.top - h - 6 : r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, side === 'right' ? window.innerHeight - h - 8 : r.top - h - 6);
    if (top < 8) top = Math.min(window.innerHeight - h - 8, r.bottom + 6);
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
      data-pc-popover=""
      style={{ position: 'fixed', left: pos?.left ?? -9999, top: pos?.top ?? -9999, width, zIndex: 80 }}
      className={cn('pc-in pc-scroll max-h-[min(440px,80vh)] overflow-y-auto rounded-[var(--pc-radius)] border border-[var(--pc-line)] bg-[var(--pc-raised)] p-1 shadow-[var(--pc-shadow-lg)]', className)}
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
      className={cn('pc-focus flex h-8 w-full items-center gap-2 rounded-[var(--pc-radius-sm)] px-2 text-left text-[13px] transition-colors disabled:opacity-40', danger === true ? 'text-[var(--pc-bad)] hover:bg-[var(--pc-bad-soft)]' : 'text-[var(--pc-ink)] hover:bg-[var(--pc-hover)]')}
    >
      {Icon !== undefined && <Icon size={14} strokeWidth={1.8} aria-hidden className={danger === true ? '' : 'text-[var(--pc-muted)]'} />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint !== undefined && <span className="shrink-0 text-[12px] text-[var(--pc-muted)]">{hint}</span>}
      {selected === true && <Check size={14} aria-hidden className="shrink-0 text-[var(--pc-ink)]" />}
    </button>
  );
}

export function MenuSep(): React.JSX.Element {
  return <div className="my-1 h-px bg-[var(--pc-hair)]" />;
}

function useEscape(open: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && document.querySelector('[data-pc-popover]') === null) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open, onClose]);
}

/** A centred modal dialog: heading, body, a footer for Cancel and the main action. */
export function Dialog({ open, onClose, title, children, footer, width = 480 }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }): React.JSX.Element | null {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="pc-scrim fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto px-4 pb-10 pt-[9vh]" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} className="pc-dialog w-full rounded-[calc(var(--pc-radius)*1.5)] border border-[var(--pc-line)] bg-[var(--pc-raised)] shadow-[var(--pc-shadow-lg)]" style={{ maxWidth: width }}>
        <div className="flex items-center gap-2 px-5 pb-1 pt-4">
          <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{title}</h2>
          <IconButton icon={X} label="Close" onClick={onClose} size={28} />
        </div>
        <div className="px-5 pb-4 pt-2">{children}</div>
        {footer !== undefined && <div className="flex items-center justify-end gap-2 border-t border-[var(--pc-hair)] px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** A panel docked to the right edge. */
export function Sheet({ open, onClose, children, width = 460, label }: { open: boolean; onClose: () => void; children: ReactNode; width?: number; label: string }): React.JSX.Element | null {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="pc-fade fixed inset-0 z-[60]" onPointerDown={(e) => e.target === e.currentTarget && onClose()} style={{ background: 'color-mix(in srgb, var(--pc-overlay), transparent 45%)' }}>
      <aside role="dialog" aria-modal="true" aria-label={label} className="pc-sheet absolute bottom-0 right-0 top-0 flex w-full flex-col border-l border-[var(--pc-line)] bg-[var(--pc-page)] shadow-[var(--pc-shadow-lg)]" style={{ maxWidth: width }}>
        {children}
      </aside>
    </div>,
    document.body,
  );
}

/** Ask before something that cannot be undone. */
export function useConfirm(): [React.JSX.Element | null, (text: string, title: string, ok?: string) => Promise<boolean>] {
  const [state, setState] = useState<{ text: string; title: string; ok: string; resolve: (v: boolean) => void } | null>(null);
  const ask = useCallback((text: string, title: string, ok = 'Remove') => new Promise<boolean>((resolve) => setState({ text, title, ok, resolve })), []);
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
            <Button variant="primary" className="!bg-[var(--pc-bad)] !text-white" onClick={() => close(true)} autoFocus>
              {state.ok}
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-5 text-[var(--pc-ink-2)]">{state.text}</p>
      </Dialog>
    );
  return [el, ask];
}

/** The four stages as four dots, filled up to the stage. */
export function StageDots({ stage, size = 6 }: { stage: 'new' | 'learning' | 'steady' | 'mastered'; size?: number }): React.JSX.Element {
  const n = ['new', 'learning', 'steady', 'mastered'].indexOf(stage);
  return (
    <span className="inline-flex items-center gap-[3px]" title={stage}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={cn('rounded-full transition-colors duration-300', i <= n ? 'bg-[var(--pc-ink)]' : 'bg-[var(--pc-line-2)]')} style={{ width: size, height: size }} />
      ))}
    </span>
  );
}

/** Shared hook: page header with a phone menu button, a big title and actions. */
export function PageHeader({ title, meta, children }: { title: ReactNode; meta?: ReactNode; children?: ReactNode }): React.JSX.Element {
  return (
    <header className="flex min-h-[64px] shrink-0 flex-wrap items-center gap-x-3 gap-y-2 px-5 pt-4 md:px-7">
      <MenuButton />
      <div className="flex min-w-0 flex-1 items-baseline gap-3">
        <h1 className="truncate text-[22px] font-semibold tracking-[-0.02em]">{title}</h1>
        {meta !== undefined && <span className="pc-label hidden truncate sm:inline">{meta}</span>}
      </div>
      {children}
    </header>
  );
}
