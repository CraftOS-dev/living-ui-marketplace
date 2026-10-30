/**
 * Building blocks: compact flat controls (32px tall, 7px corners, real
 * borders), menus, a modal, a confirm dialog, tag and color pickers. Colors
 * come only from --rb-*; almost everything is ink on white.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import type { LucideIcon } from 'lucide-react';
import { Check, ChevronDown, Ellipsis, Plus, X } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { CARD_COLORS, COLOR_NAME, KIND, tint } from '../lib/kinds.ts';
import type { CardColor, Kind } from '../lib/types.ts';

/* --------------------------------------------------------------- buttons */

type ButtonVariant = 'dark' | 'light' | 'soft' | 'ghost' | 'danger' | 'accent';

export function PillButton({
  variant = 'dark',
  icon: Icon,
  dot: _dot = false,
  loading = false,
  size = 'md',
  className,
  children,
  type,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; icon?: LucideIcon; dot?: boolean; loading?: boolean; size?: 'sm' | 'md' }): React.JSX.Element {
  return (
    <button
      type={type ?? 'button'}
      disabled={disabled === true || loading}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[7px] font-semibold transition-[background,border-color,color,opacity] disabled:opacity-45',
        size === 'md' ? 'h-8 px-3 text-[13px]' : 'h-7 px-2.5 text-[12px]',
        variant === 'dark' && 'bg-[var(--rb-ink)] text-[var(--rb-card)] hover:opacity-90',
        variant === 'light' && 'border border-[var(--rb-line)] bg-[var(--rb-card)] text-[var(--rb-ink)] hover:bg-[var(--rb-row)]',
        variant === 'soft' && 'bg-[var(--rb-row)] text-[var(--rb-ink)] hover:bg-[var(--rb-row-hover)]',
        variant === 'ghost' && 'text-[var(--rb-ink-2)] hover:bg-[var(--rb-row)] hover:text-[var(--rb-ink)]',
        variant === 'danger' && 'border border-[var(--rb-line)] bg-[var(--rb-card)] text-[var(--rb-red-text)] hover:bg-[var(--rb-row)]',
        variant === 'accent' && 'bg-[var(--rb-accent)] text-[var(--rb-on-accent)] hover:opacity-90',
        className,
      )}
      {...rest}
    >
      {loading ? <span aria-hidden className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : Icon !== undefined ? <Icon size={size === 'md' ? 15 : 14} strokeWidth={2.1} aria-hidden /> : null}
      {children}
    </button>
  );
}

export function CircleButton({
  icon: Icon,
  label,
  variant = 'ghost',
  size = 32,
  className,
  active = false,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; variant?: 'light' | 'dark' | 'accent' | 'row' | 'onDark' | 'ghost'; size?: number; active?: boolean }): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      style={{ width: size, height: size }}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-[7px] transition-[background,color,opacity] disabled:opacity-40',
        variant === 'light' && 'border border-[var(--rb-line)] bg-[var(--rb-card)] text-[var(--rb-ink)] hover:bg-[var(--rb-row)]',
        (variant === 'row' || variant === 'ghost' || variant === 'onDark') && 'text-[var(--rb-ink-2)] hover:bg-[var(--rb-row)] hover:text-[var(--rb-ink)]',
        variant === 'dark' && 'bg-[var(--rb-ink)] text-[var(--rb-card)] hover:opacity-90',
        variant === 'accent' && 'bg-[var(--rb-accent)] text-[var(--rb-on-accent)] hover:opacity-90',
        active && 'bg-[var(--rb-row-hover)] text-[var(--rb-ink)]',
        className,
      )}
      {...rest}
    >
      <Icon size={Math.round(Math.min(18, size * 0.5))} strokeWidth={2} aria-hidden />
    </button>
  );
}

/* --------------------------------------------------------------- display */

export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'neutral' | 'dark';

export function StatusPill({ tone, children, pulse = false, className }: { tone: Tone; children: ReactNode; pulse?: boolean; className?: string }): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-[7px] border px-2.5 text-[12px] font-semibold',
        tone === 'bad' ? 'border-[var(--rb-red)]/40 bg-[var(--rb-card)] text-[var(--rb-red-text)]' : 'border-[var(--rb-line)] bg-[var(--rb-card)] text-[var(--rb-ink)]',
        className,
      )}
    >
      <span aria-hidden className={cn('size-1.5 rounded-full', tone === 'bad' ? 'bg-[var(--rb-red)]' : tone === 'good' ? 'bg-[var(--rb-green)]' : 'bg-[var(--rb-accent)]', pulse && 'rb-pulse')} />
      {children}
    </span>
  );
}

export function Empty({ icon: Icon, title, children, action, compact = false }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode; dark?: boolean; compact?: boolean }): React.JSX.Element {
  return (
    <div className={cn('flex flex-col items-center px-6 text-center', compact ? 'py-6' : 'py-10')}>
      <span className="mb-3 flex size-10 items-center justify-center rounded-[9px] border border-[var(--rb-line)] text-[var(--rb-ink)]">
        <Icon size={18} strokeWidth={1.9} aria-hidden />
      </span>
      <p className="text-[14px] font-bold">{title}</p>
      {children !== undefined && <div className="mt-1 max-w-sm text-[13px] leading-5 text-[var(--rb-ink-2)]">{children}</div>}
      {action !== undefined && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** A small square holding a card kind's icon (neutral: the icon tells the kind). */
export function KindBadge({ kind, size = 28, className }: { kind: Kind; size?: number; className?: string }): React.JSX.Element {
  const Icon = KIND[kind].icon;
  return (
    <span aria-hidden className={cn('inline-flex shrink-0 items-center justify-center rounded-[7px] border border-[var(--rb-line)] text-[var(--rb-ink)]', className)} style={{ width: size, height: size }}>
      <Icon size={Math.round(size * 0.5)} strokeWidth={2} />
    </span>
  );
}

/** A section label inside panels. */
export function Label({ children, action }: { children: ReactNode; action?: ReactNode }): React.JSX.Element {
  return (
    <div className="mb-1.5 flex min-h-5 items-center justify-between gap-2">
      <span className="text-[12px] font-bold text-[var(--rb-ink-2)]">{children}</span>
      {action}
    </div>
  );
}

/* ---------------------------------------------------------------- inputs */

const field = 'w-full rounded-[7px] border border-[var(--rb-line)] bg-[var(--rb-card)] text-[13px] text-[var(--rb-ink)] outline-none transition-[border-color,box-shadow] focus:border-[var(--rb-ink)] focus:shadow-[0_0_0_1px_var(--rb-ink)]';

export const pillInput = `h-8 px-2.5 ${field}`;
export const softInput = `h-8 px-2.5 ${field}`;
export const softArea = `px-2.5 py-2 leading-5 ${field}`;

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12px] font-bold text-[var(--rb-ink-2)]">{label}</span>
      {children}
      {error ? <span className="text-[12px] font-medium text-[var(--rb-red-text)]">{error}</span> : hint !== undefined ? <span className="text-[12px] text-[var(--rb-muted)]">{hint}</span> : null}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn('relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors', checked ? 'bg-[var(--rb-ink)]' : 'bg-[var(--rb-line)]')}
    >
      <span className={cn('inline-block size-4 rounded-full bg-[var(--rb-card)] shadow-sm transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-0.5')} />
    </button>
  );
}

/** A textarea that grows with its text. */
export function AutoTextarea({
  value,
  onChange,
  className,
  minRows = 3,
  ...rest
}: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'value'> & { value: string; onChange: (v: string) => void; minRows?: number }): React.JSX.Element {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return <textarea ref={ref} rows={minRows} value={value} onChange={(e) => onChange(e.target.value)} className={cn('resize-none', className)} {...rest} />;
}

/** Pick one of the card tints. */
export function Swatches({ value, onChange, size = 20 }: { value: CardColor; onChange: (c: CardColor) => void; size?: number }): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label="Color" className="flex flex-wrap items-center gap-1.5">
      {CARD_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={COLOR_NAME[c]}
          title={COLOR_NAME[c]}
          onClick={() => onChange(c)}
          className={cn('flex items-center justify-center rounded-[6px] border transition-transform hover:scale-110', value === c ? 'border-[var(--rb-ink)] ring-1 ring-[var(--rb-ink)]' : 'border-[var(--rb-line)]')}
          style={{ width: size, height: size, background: c === 'plain' ? 'var(--rb-card)' : tint(c, 'soft') }}
        >
          {value === c && <Check size={11} strokeWidth={3} className="text-[var(--rb-ink)]" aria-hidden />}
        </button>
      ))}
    </div>
  );
}

/** Tags as chips with a field to add more (Enter or comma adds; Backspace on empty removes the last). */
export function TagEditor({ tags, onChange, suggestions = [], placeholder = 'Add a tag' }: { tags: string[]; onChange: (t: string[]) => void; suggestions?: string[]; placeholder?: string }): React.JSX.Element {
  const [text, setText] = useState('');
  const has = (t: string): boolean => tags.some((x) => x.toLowerCase() === t.toLowerCase());
  const add = (raw: string): void => {
    const parts = raw
      .split(',')
      .map((x) => x.replace(/^#+/, '').replace(/\s+/g, ' ').trim().slice(0, 32))
      .filter((x) => x !== '' && !has(x));
    if (parts.length > 0) onChange([...tags, ...parts].slice(0, 20));
    setText('');
  };
  const q = text.trim().toLowerCase();
  const offer = q === '' ? [] : suggestions.filter((s) => s.toLowerCase().includes(q) && !has(s)).slice(0, 5);
  return (
    <div className="relative">
      <div className="flex min-h-8 flex-wrap items-center gap-1 rounded-[7px] border border-[var(--rb-line)] bg-[var(--rb-card)] px-1 py-1 focus-within:border-[var(--rb-ink)] focus-within:shadow-[0_0_0_1px_var(--rb-ink)]">
        {tags.map((t) => (
          <span key={t} className="inline-flex h-6 items-center gap-0.5 rounded-[5px] bg-[var(--rb-row-hover)] pl-2 pr-0.5 text-[12px] font-semibold">
            #{t}
            <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))} className="flex size-5 items-center justify-center rounded-[4px] text-[var(--rb-ink-2)] hover:bg-[var(--rb-line)] hover:text-[var(--rb-ink)]">
              <X size={11} strokeWidth={2.6} />
            </button>
          </span>
        ))}
        <input
          value={text}
          onChange={(e) => (e.target.value.endsWith(',') ? add(e.target.value) : setText(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(text);
            } else if (e.key === 'Backspace' && text === '' && tags.length > 0) onChange(tags.slice(0, -1));
          }}
          onBlur={() => text.trim() !== '' && add(text)}
          placeholder={tags.length === 0 ? placeholder : ''}
          aria-label="Add a tag"
          className="h-6 min-w-[6rem] flex-1 bg-transparent px-1.5 text-[13px] outline-none placeholder:text-[var(--rb-muted)]"
        />
      </div>
      {offer.length > 0 && (
        <div className="rb-pop absolute left-0 top-[calc(100%+4px)] z-30 flex w-56 flex-col rounded-[9px] border border-[var(--rb-line)] bg-[var(--rb-card)] p-1 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.35)]">
          {offer.map((s) => (
            <button key={s} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => add(s)} className="flex items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-[13px] font-semibold hover:bg-[var(--rb-row)]">
              <Plus size={13} className="text-[var(--rb-ink-2)]" /> #{s}
            </button>
          ))}
        </div>
      )}
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
  width = 'md',
  bare = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string | undefined;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'md' | 'lg' | 'xl';
  /** No header row: the content draws its own (the title stays for screen readers). */
  bare?: boolean;
}): React.JSX.Element {
  return (
    <RadixDialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="rb-fade fixed inset-0 z-[60] bg-black/35" />
        <RadixDialog.Content
          className={cn(
            'rb-pop fixed left-1/2 top-1/2 z-[61] max-h-[90vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[12px] border border-[var(--rb-line)] bg-[var(--rb-card)] text-[var(--rb-ink)] shadow-[0_24px_64px_-24px_rgba(0,0,0,0.5)]',
            bare ? 'p-0' : 'p-5',
            width === 'md' && 'w-[min(94vw,28rem)]',
            width === 'lg' && 'w-[min(94vw,38rem)]',
            width === 'xl' && 'w-[min(96vw,60rem)]',
          )}
        >
          {bare ? (
            <>
              <RadixDialog.Title className="sr-only">{title}</RadixDialog.Title>
              <RadixDialog.Description className="sr-only">{description ?? title}</RadixDialog.Description>
            </>
          ) : (
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <RadixDialog.Title className="text-[15px] font-bold">{title}</RadixDialog.Title>
                <RadixDialog.Description className={description !== undefined ? 'mt-1 text-[13px] leading-5 text-[var(--rb-ink-2)]' : 'sr-only'}>{description ?? title}</RadixDialog.Description>
              </div>
              <CircleButton icon={X} label="Close" size={28} onClick={onClose} />
            </div>
          )}
          {children}
          {footer !== undefined && <div className={cn('mt-5 flex flex-wrap justify-end gap-2', bare && 'px-5 pb-5')}>{footer}</div>}
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
            <PillButton variant="light" onClick={() => settle(false)}>
              Cancel
            </PillButton>
            <PillButton variant="dark" autoFocus onClick={() => settle(true)}>
              {state.label}
            </PillButton>
          </>
        }
      >
        <p className="text-[13px] leading-5 text-[var(--rb-ink-2)]">{state.message}</p>
      </Modal>
    ) : null;
  return [el, confirm];
}

/**
 * A small floating panel under its trigger; closes on outside click and
 * Escape. `keep` is the trigger: pressing it toggles instead of closing and
 * reopening. Escape stops here, so a screen behind keeps its own Escape.
 * It always stays inside the window: shifted sideways when it would cross
 * an edge, and opened upward when there is no room below.
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
    document.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose, keep]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || el === null) return;
    el.style.translate = '';
    el.style.top = '';
    el.style.bottom = '';
    const r = el.getBoundingClientRect();
    const m = 8;
    let dx = 0;
    if (r.right > window.innerWidth - m) dx = window.innerWidth - m - r.right;
    if (r.left + dx < m) dx = m - r.left;
    if (dx !== 0) el.style.translate = `${Math.round(dx)}px 0`;
    const trigger = el.parentElement?.getBoundingClientRect();
    if (r.bottom > window.innerHeight - m && trigger !== undefined && trigger.top - r.height - 4 > m) {
      el.style.top = 'auto';
      el.style.bottom = 'calc(100% + 4px)';
    }
  }, [open]);
  if (!open) return null;
  return (
    <div
      ref={ref}
      className={cn(
        'rb-pop absolute top-[calc(100%+4px)] z-40 rounded-[10px] border border-[var(--rb-line)] bg-[var(--rb-card)] p-1 text-[var(--rb-ink)] shadow-[0_12px_32px_-12px_rgba(0,0,0,0.35)]',
        align === 'left' ? 'left-0' : 'right-0',
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface MenuItem {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  danger?: boolean;
  hint?: string;
  disabled?: boolean;
}

/** A list of actions inside a Popover. */
export function MenuList({ items, onPicked }: { items: (MenuItem | 'divider')[]; onPicked: () => void }): React.JSX.Element {
  return (
    <div role="menu" className="flex flex-col">
      {items.map((it, i) => {
        if (it === 'divider') return <span key={`d${i}`} className="mx-1 my-1 h-px bg-[var(--rb-line)]" />;
        const Icon = it.icon;
        return (
          <button
            key={it.label}
            type="button"
            role="menuitem"
            disabled={it.disabled === true}
            onClick={() => {
              onPicked();
              it.onClick();
            }}
            className={cn('flex w-full items-center gap-2.5 rounded-[6px] px-2.5 py-1.5 text-left text-[13px] font-medium transition-colors hover:bg-[var(--rb-row)] disabled:opacity-40', it.danger === true ? 'text-[var(--rb-red-text)]' : 'text-[var(--rb-ink)]')}
          >
            <Icon size={15} className={it.danger === true ? '' : 'text-[var(--rb-ink-2)]'} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{it.label}</span>
            {it.hint !== undefined && <kbd className="font-[inherit] text-[11px] font-semibold text-[var(--rb-muted)]">{it.hint}</kbd>}
          </button>
        );
      })}
    </div>
  );
}

/** A "more" trigger with a menu. */
export function MoreMenu({ items, label = 'More', size = 32, align = 'right' }: { items: (MenuItem | 'divider')[]; label?: string; variant?: string; size?: number; align?: 'left' | 'right' }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  return (
    <div ref={ref} className="relative" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <CircleButton icon={Ellipsis} label={label} size={size} active={open} onClick={() => setOpen((o) => !o)} aria-expanded={open} />
      <Popover open={open} onClose={() => setOpen(false)} align={align} keep={ref} className="w-56">
        <MenuList items={items} onPicked={() => setOpen(false)} />
      </Popover>
    </div>
  );
}

/** A select drawn like the other fields. */
export function PillSelect({ value, onChange, options, ariaLabel, className }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; ariaLabel: string; className?: string }): React.JSX.Element {
  return (
    <div className={cn('relative', className)}>
      <select aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} className={cn(pillInput, 'appearance-none pr-8 font-medium')}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={14} aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--rb-ink-2)]" />
    </div>
  );
}
