/**
 * Building blocks: compact flat controls (24 to 28px tall, 5px corners,
 * hairline borders), menus, a modal, a confirm dialog, a context menu.
 * Colors come only from --cr-*.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import * as RadixDialog from '@radix-ui/react-dialog';
import type { LucideIcon } from 'lucide-react';
import { Check, ChevronDown, X } from 'lucide-react';
import { cn } from '../../kit/index.ts';

/* --------------------------------------------------------------- buttons */

type BtnVariant = 'primary' | 'accent' | 'light' | 'ghost' | 'danger' | 'soft';

export function Btn({
  variant = 'light',
  icon: Icon,
  loading = false,
  size = 'sm',
  className,
  children,
  type,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant | undefined; icon?: LucideIcon | undefined; loading?: boolean | undefined; size?: 'xs' | 'sm' | 'md' | undefined }): React.JSX.Element {
  return (
    <button
      type={type ?? 'button'}
      disabled={disabled === true || loading}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[5px] font-semibold transition-[background,border-color,color,opacity] disabled:opacity-45',
        size === 'xs' && 'h-6 px-2 text-[11.5px]',
        size === 'sm' && 'h-7 px-2.5 text-[12.5px]',
        size === 'md' && 'h-8 px-3 text-[13px]',
        variant === 'primary' && 'bg-[var(--cr-ink)] text-[var(--cr-card)] hover:opacity-90',
        variant === 'accent' && 'bg-[var(--cr-accent)] text-[var(--cr-on-accent)] hover:opacity-90',
        variant === 'light' && 'border border-[var(--cr-line)] bg-[var(--cr-card)] text-[var(--cr-ink)] hover:bg-[var(--cr-row)]',
        variant === 'soft' && 'bg-[var(--cr-row)] text-[var(--cr-ink)] hover:bg-[var(--cr-row-hover)]',
        variant === 'ghost' && 'text-[var(--cr-ink-2)] hover:bg-[var(--cr-row)] hover:text-[var(--cr-ink)]',
        variant === 'danger' && 'border border-[var(--cr-line)] bg-[var(--cr-card)] text-[var(--cr-neg-text)] hover:bg-[var(--cr-row)]',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={12} /> : Icon !== undefined ? <Icon size={size === 'md' ? 15 : 14} strokeWidth={2} aria-hidden /> : null}
      {children}
    </button>
  );
}

export function IconBtn({
  icon: Icon,
  label,
  size = 26,
  active = false,
  className,
  badge,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; size?: number | undefined; active?: boolean | undefined; badge?: ReactNode | undefined }): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      style={{ width: size, height: size }}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center rounded-[5px] text-[var(--cr-ink-2)] transition-[background,color] hover:bg-[var(--cr-row)] hover:text-[var(--cr-ink)] disabled:opacity-40',
        active && 'bg-[var(--cr-row-hover)] text-[var(--cr-ink)]',
        className,
      )}
      {...rest}
    >
      <Icon size={Math.round(Math.min(17, size * 0.56))} strokeWidth={1.9} aria-hidden />
      {badge}
    </button>
  );
}

export function Spinner({ size = 14, className }: { size?: number | undefined; className?: string | undefined }): React.JSX.Element {
  return <span aria-hidden style={{ width: size, height: size }} className={cn('inline-block shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent', className)} />;
}

/** A row of mutually exclusive options. */
export function Seg<T extends string>({ value, options, onChange, size = 'sm', className }: { value: T; options: { value: T; label: ReactNode; title?: string | undefined }[]; onChange: (v: T) => void; size?: 'xs' | 'sm' | undefined; className?: string | undefined }): React.JSX.Element {
  return (
    <div role="radiogroup" className={cn('inline-flex shrink-0 items-center gap-px rounded-[5px] bg-[var(--cr-row)] p-px', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-[4px] font-semibold transition-colors',
            size === 'xs' ? 'h-5 min-w-5 px-1.5 text-[11px]' : 'h-6 min-w-6 px-2 text-[12px]',
            o.value === value ? 'bg-[var(--cr-card)] text-[var(--cr-ink)] shadow-[0_0_0_1px_var(--cr-line)]' : 'text-[var(--cr-ink-2)] hover:text-[var(--cr-ink)]',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
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
      className={cn('relative inline-flex h-[18px] w-[30px] shrink-0 items-center rounded-full transition-colors disabled:opacity-40', checked ? 'bg-[var(--cr-ink)]' : 'bg-[var(--cr-line)]')}
    >
      <span className={cn('absolute size-[14px] rounded-full bg-[var(--cr-card)] transition-[left]', checked ? 'left-[14px]' : 'left-[2px]')} />
    </button>
  );
}

/* ---------------------------------------------------------------- inputs */

const field = 'w-full min-w-0 rounded-[5px] border border-[var(--cr-line)] bg-[var(--cr-card)] text-[12.5px] text-[var(--cr-ink)] outline-none transition-colors focus:border-[var(--cr-ink-2)]';
export const input = `h-7 px-2 ${field}`;
export const area = `px-2 py-1.5 leading-[18px] ${field}`;

export function Select({ value, onChange, options, label, className, small = false }: { value: string; onChange: (v: string) => void; options: { value: string; label: string; group?: string | undefined }[]; label: string; className?: string | undefined; small?: boolean | undefined }): React.JSX.Element {
  const groups: { name: string; items: typeof options }[] = [];
  for (const o of options) {
    const g = o.group ?? '';
    let last = groups[groups.length - 1];
    if (last === undefined || last.name !== g) {
      last = { name: g, items: [] };
      groups.push(last);
    }
    last.items.push(o);
  }
  return (
    <div className={cn('relative min-w-0', className)}>
      <select aria-label={label} title={label} value={value} onChange={(e) => onChange(e.target.value)} className={cn(field, small ? 'h-6 pl-1.5 pr-6 text-[12px]' : 'h-7 pl-2 pr-7', 'appearance-none truncate font-semibold')}>
        {groups.map((g, i) =>
          g.name === '' ? (
            g.items.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))
          ) : (
            <optgroup key={g.name + i} label={g.name}>
              {g.items.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ),
        )}
      </select>
      <ChevronDown size={13} aria-hidden className={cn('pointer-events-none absolute top-1/2 -translate-y-1/2 text-[var(--cr-ink-2)]', small ? 'right-1.5' : 'right-2')} />
    </div>
  );
}

/** A labelled control. `group` for content with several controls (no wrapping <label>). */
export function Field({ label, hint, children, className, group = false }: { label: string; hint?: ReactNode | undefined; children: ReactNode; className?: string | undefined; group?: boolean | undefined }): React.JSX.Element {
  const body = (
    <>
      <span className="text-[11.5px] font-semibold text-[var(--cr-ink-2)]">{label}</span>
      {children}
      {hint !== undefined && <span className="text-[11.5px] leading-4 text-[var(--cr-muted)]">{hint}</span>}
    </>
  );
  if (group)
    return (
      <div role="group" aria-label={label} className={cn('flex min-w-0 flex-col gap-1', className)}>
        {body}
      </div>
    );
  return <label className={cn('flex min-w-0 flex-col gap-1', className)}>{body}</label>;
}

/* ---------------------------------------------------------------- display */

export function Empty({ icon: Icon, title, children, action, className }: { icon: LucideIcon; title: string; children?: ReactNode | undefined; action?: ReactNode | undefined; className?: string | undefined }): React.JSX.Element {
  return (
    <div className={cn('flex h-full min-h-0 flex-col items-center justify-center gap-1.5 px-4 py-6 text-center', className)}>
      <Icon size={18} strokeWidth={1.8} className="text-[var(--cr-muted)]" aria-hidden />
      <p className="text-[12.5px] font-semibold text-[var(--cr-ink)]">{title}</p>
      {children !== undefined && <p className="max-w-[260px] text-[12px] leading-[17px] text-[var(--cr-muted)]">{children}</p>}
      {action !== undefined && <div className="mt-1.5">{action}</div>}
    </div>
  );
}

export function Chip({ children, tone: t = 'neutral', className, title }: { children: ReactNode; tone?: 'neutral' | 'pos' | 'neg' | 'accent' | 'ink' | 'warn' | undefined; className?: string | undefined; title?: string | undefined }): React.JSX.Element {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-[18px] shrink-0 items-center gap-1 rounded-[4px] px-1.5 text-[10.5px] font-bold uppercase tracking-[0.03em]',
        t === 'neutral' && 'bg-[var(--cr-row)] text-[var(--cr-ink-2)]',
        t === 'pos' && 'bg-[var(--cr-pos-soft)] text-[var(--cr-pos-text)]',
        t === 'neg' && 'bg-[var(--cr-neg-soft)] text-[var(--cr-neg-text)]',
        t === 'accent' && 'bg-[var(--cr-accent-soft)] text-[var(--cr-accent-text)]',
        t === 'ink' && 'bg-[var(--cr-ink)] text-[var(--cr-card)]',
        t === 'warn' && 'bg-[var(--cr-warn-soft)] text-[var(--cr-warn-text)]',
        className,
      )}
    >
      {children}
    </span>
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
  width = 'md',
  bare = false,
  top = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string | undefined;
  children: ReactNode;
  footer?: ReactNode | undefined;
  width?: 'sm' | 'md' | 'lg' | 'xl' | undefined;
  bare?: boolean | undefined;
  /** Pinned near the top (command palette) instead of centered. */
  top?: boolean | undefined;
}): React.JSX.Element {
  return (
    // Not a modal Radix dialog: a modal one traps focus and blocks pointer
    // events outside it, which would make the pickers and menus inside it
    // (drawn in a portal on <body>) unusable. The overlay and Escape still
    // behave as a modal's; clicks in those popovers do not close it.
    <RadixDialog.Root open={open} modal={false} onOpenChange={(o) => !o && onClose()}>
      <RadixDialog.Portal>
        <div aria-hidden className="cr-fade fixed inset-0 z-[60] bg-black/30" />
        <RadixDialog.Content
          aria-describedby={undefined}
          aria-modal="true"
          onInteractOutside={(e) => {
            const t = e.target as Element | null;
            if (t !== null && typeof t.closest === 'function' && t.closest('[data-cr-popover]') !== null) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (document.querySelector('[data-cr-popover]') !== null) e.preventDefault();
          }}
          className={cn(
            'cr-pop fixed left-1/2 z-[61] flex max-h-[86vh] -translate-x-1/2 flex-col overflow-hidden rounded-[8px] border border-[var(--cr-line)] bg-[var(--cr-card)] text-[var(--cr-ink)] shadow-[0_24px_64px_-24px_rgba(0,0,0,0.5)]',
            top ? 'top-[10vh]' : 'top-1/2 -translate-y-1/2',
            width === 'sm' && 'w-[min(94vw,22rem)]',
            width === 'md' && 'w-[min(94vw,28rem)]',
            width === 'lg' && 'w-[min(94vw,36rem)]',
            width === 'xl' && 'w-[min(96vw,48rem)]',
          )}
        >
          {bare ? (
            <RadixDialog.Title className="sr-only">{title}</RadixDialog.Title>
          ) : (
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--cr-hair)] px-4 py-3">
              <div className="min-w-0">
                <RadixDialog.Title className="text-[14px] font-bold">{title}</RadixDialog.Title>
                {description !== undefined && <p className="mt-0.5 text-[12px] leading-[17px] text-[var(--cr-muted)]">{description}</p>}
              </div>
              <IconBtn icon={X} label="Close" size={24} onClick={onClose} />
            </div>
          )}
          <div className={cn('min-h-0 flex-1 overflow-y-auto', !bare && 'px-4 py-3')}>{children}</div>
          {footer !== undefined && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--cr-hair)] px-4 py-2.5">{footer}</div>}
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
        width="sm"
        onClose={() => settle(false)}
        title={state.title}
        footer={
          <>
            <Btn onClick={() => settle(false)}>Cancel</Btn>
            <Btn variant="primary" autoFocus onClick={() => settle(true)}>
              {state.label}
            </Btn>
          </>
        }
      >
        <p className="text-[12.5px] leading-[18px] text-[var(--cr-ink-2)]">{state.message}</p>
      </Modal>
    ) : null;
  return [el, confirm];
}

/** Keep a fixed-position box inside the window. */
function clampInto(el: HTMLElement): void {
  const r = el.getBoundingClientRect();
  const m = 6;
  let dx = 0;
  let dy = 0;
  if (r.right > window.innerWidth - m) dx = window.innerWidth - m - r.right;
  if (r.left + dx < m) dx = m - r.left;
  if (r.bottom > window.innerHeight - m) dy = window.innerHeight - m - r.bottom;
  if (r.top + dy < m) dy = m - r.top;
  if (dx !== 0 || dy !== 0) el.style.translate = `${Math.round(dx)}px ${Math.round(dy)}px`;
}

/**
 * A small floating panel under its trigger, drawn in a portal so a widget's
 * clipping never cuts it; closes on outside click and Escape. It always
 * stays inside the window: shifted sideways at an edge, opened upward when
 * there is no room below.
 */
export function Popover({
  open,
  onClose,
  anchor,
  children,
  align = 'left',
  className,
}: {
  open: boolean;
  onClose: () => void;
  anchor: React.RefObject<HTMLElement | null>;
  children: ReactNode;
  align?: 'left' | 'right' | undefined;
  className?: string | undefined;
}): React.JSX.Element | null {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number; up: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || anchor.current === null) return;
    const r = anchor.current.getBoundingClientRect();
    setPos({ x: align === 'left' ? r.left : r.right, y: r.bottom + 4, up: r.top - 4 });
  }, [open, anchor, align]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || el === null || pos === null) return;
    el.style.translate = '';
    const r = el.getBoundingClientRect();
    if (r.bottom > window.innerHeight - 6 && pos.up - r.height > 6) el.style.top = `${pos.up - r.height}px`;
    clampInto(el);
  }, [open, pos]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (anchor.current?.contains(t) === true) return;
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
  }, [open, onClose, anchor]);
  if (!open || pos === null) return null;
  return createPortal(
    <div
      ref={ref}
      data-cr-popover=""
      style={{ position: 'fixed', top: pos.y, left: align === 'left' ? pos.x : undefined, right: align === 'right' ? window.innerWidth - pos.x : undefined }}
      className={cn('cr-pop z-[70] max-h-[min(70vh,560px)] overflow-y-auto rounded-[7px] border border-[var(--cr-line)] bg-[var(--cr-card)] p-1 text-[var(--cr-ink)] shadow-[0_12px_32px_-12px_rgba(0,0,0,0.35)]', className)}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}

export interface MenuItem {
  label: string;
  icon?: LucideIcon | undefined;
  onClick: () => void;
  danger?: boolean | undefined;
  hint?: string | undefined;
  disabled?: boolean | undefined;
  checked?: boolean | undefined;
  swatch?: string | undefined;
}

export type MenuEntry = MenuItem | 'divider' | { heading: string };

export function MenuList({ items, onPicked }: { items: MenuEntry[]; onPicked: () => void }): React.JSX.Element {
  return (
    <div role="menu" className="flex min-w-[180px] flex-col">
      {items.map((it, i) => {
        if (it === 'divider') return <span key={`d${i}`} className="mx-1 my-1 h-px bg-[var(--cr-hair)]" />;
        if ('heading' in it)
          return (
            <span key={`h${i}`} className="px-2 pb-0.5 pt-1.5 text-[10.5px] font-bold uppercase tracking-[0.05em] text-[var(--cr-muted)]">
              {it.heading}
            </span>
          );
        const Icon = it.icon;
        return (
          <button
            key={it.label + i}
            type="button"
            role="menuitem"
            disabled={it.disabled === true}
            onClick={() => {
              onPicked();
              it.onClick();
            }}
            className={cn('flex h-7 w-full items-center gap-2 rounded-[4px] px-2 text-left text-[12.5px] font-medium transition-colors hover:bg-[var(--cr-row)] disabled:opacity-40', it.danger === true ? 'text-[var(--cr-neg-text)]' : 'text-[var(--cr-ink)]')}
          >
            {it.swatch !== undefined ? (
              <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: it.swatch }} />
            ) : Icon !== undefined ? (
              <Icon size={14} className={it.danger === true ? '' : 'text-[var(--cr-ink-2)]'} aria-hidden />
            ) : it.checked !== undefined ? (
              <span className="inline-flex size-3.5 shrink-0 items-center justify-center">{it.checked && <Check size={13} strokeWidth={2.4} />}</span>
            ) : null}
            <span className="min-w-0 flex-1 truncate">{it.label}</span>
            {it.checked === true && (Icon !== undefined || it.swatch !== undefined) && <Check size={13} strokeWidth={2.4} className="text-[var(--cr-ink)]" />}
            {it.hint !== undefined && <kbd className="font-[inherit] text-[11px] font-semibold text-[var(--cr-muted)]">{it.hint}</kbd>}
          </button>
        );
      })}
    </div>
  );
}

/** A trigger button with a menu. */
export function Menu({ items, trigger, align = 'right', className }: { items: MenuEntry[]; trigger: (open: boolean, toggle: () => void) => ReactNode; align?: 'left' | 'right' | undefined; className?: string | undefined }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  return (
    <span ref={ref} className={cn('relative inline-flex', className)}>
      {trigger(open, () => setOpen((o) => !o))}
      <Popover open={open} onClose={close} anchor={ref} align={align}>
        <MenuList items={items} onPicked={close} />
      </Popover>
    </span>
  );
}

/** A menu at the mouse (right click). */
export function ContextMenu({ at, items, onClose }: { at: { x: number; y: number } | null; items: MenuEntry[]; onClose: () => void }): React.JSX.Element | null {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (at !== null && ref.current !== null) {
      ref.current.style.translate = '';
      clampInto(ref.current);
    }
  }, [at]);
  useEffect(() => {
    if (at === null) return;
    const onDoc = (e: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const t = setTimeout(() => {
      document.addEventListener('mousedown', onDoc);
      document.addEventListener('contextmenu', onDoc);
    }, 0);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onClose);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('contextmenu', onDoc);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onClose);
    };
  }, [at, onClose]);
  if (at === null) return null;
  return createPortal(
    <div ref={ref} data-cr-popover="" style={{ position: 'fixed', left: at.x, top: at.y }} className="cr-pop z-[75] rounded-[7px] border border-[var(--cr-line)] bg-[var(--cr-card)] p-1 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.35)]" onContextMenu={(e) => e.preventDefault()}>
      <MenuList items={items} onPicked={onClose} />
    </div>,
    document.body,
  );
}

/** Kbd hint. */
export function Kbd({ children }: { children: ReactNode }): React.JSX.Element {
  return <kbd className="inline-flex h-[18px] items-center rounded-[4px] border border-[var(--cr-line)] px-1 font-[inherit] text-[10.5px] font-semibold text-[var(--cr-muted)]">{children}</kbd>;
}
