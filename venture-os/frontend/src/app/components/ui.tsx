/**
 * Venture OS controls: HR OS's instrument language, made lighter (SPEC 13).
 * 32px controls with small corners, hairline borders, one black primary
 * button per page, quiet ghost icons, thin mono numerals, a centred dialog
 * and a sheet docked on the right. Menus and popovers are portaled and stay
 * inside the window. Every module builds its pages from these and the
 * charts in charts.tsx; never fork them. Props: reference/notes/kernel-frontend.md.
 *
 * Words: no text under any title, label or figure (SPEC 2, U1). An
 * explanation goes in a Tip or a Hint.
 */
import { Suspense, createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, ArrowDown, ArrowUp, Bookmark, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, CircleHelp, Columns3, Loader2, Lock, Menu as MenuLines, MoreHorizontal, Move, Search, Sparkle, Trash2, Upload, X } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { op, setPinAsker } from '../lib/api.ts';
import type { PinAsk } from '../lib/api.ts';
import { addDays, dateOf, dayKey, fmtDay, initials, isDay, money, monthName, parseMoney, today } from '../lib/format.ts';
import type { Minor, MoneyOpts } from '../lib/format.ts';
import { act, drop as dropEdit, insert, useOp } from '../lib/live.ts';
import { keep, remember } from '../lib/store.ts';
import { subscribeToasts, toast } from '../lib/toast.ts';
import type { Note } from '../lib/toast.ts';
import { openSource, sourceHref } from '../lib/source.ts';
import type { SourceRef } from '../lib/source.ts';
import type { ChipTone } from '../lib/types.ts';

export { toast };

/* ---------------------------------------------------------------- buttons */

type Variant = 'primary' | 'default' | 'ghost' | 'danger';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant | undefined;
  size?: 'sm' | 'md' | 'lg' | undefined;
  icon?: LucideIcon | undefined;
  iconRight?: LucideIcon | undefined;
  busy?: boolean | undefined;
  /** A key hint shown inside the button ("A"). */
  kbd?: string | undefined;
  ref?: React.Ref<HTMLButtonElement> | undefined;
}

/** One `primary` (black) per page. */
export function Button({ variant = 'default', size = 'md', icon: Icon, iconRight: IconRight, children, className, busy, kbd, ...rest }: ButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled === true || busy === true}
      className={cn(
        'vo-focus vo-tap inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--vo-radius-sm)] font-medium transition-[background-color,color,filter,border-color] duration-150 disabled:cursor-default disabled:opacity-45',
        size === 'sm' ? 'h-7 px-2.5 text-[12px]' : size === 'lg' ? 'h-10 px-4 text-[14px]' : 'h-8 px-3 text-[13px]',
        variant === 'primary' && 'bg-[var(--vo-ink)] text-[var(--vo-on-ink)] hover:brightness-[1.35] dark:hover:brightness-[0.82]',
        variant === 'default' && 'border border-[var(--vo-line)] bg-[var(--vo-raised)] text-[var(--vo-ink)] hover:border-[var(--vo-line-2)] hover:bg-[var(--vo-hover)]',
        variant === 'ghost' && 'text-[var(--vo-ink-2)] hover:bg-[var(--vo-hover)] hover:text-[var(--vo-ink)]',
        variant === 'danger' && 'border border-[var(--vo-line)] bg-[var(--vo-raised)] text-[var(--vo-bad)] hover:border-[var(--vo-bad)] hover:bg-[var(--vo-bad-soft)]',
        className,
      )}
    >
      {busy === true ? <Loader2 size={14} className="animate-spin" aria-hidden /> : Icon !== undefined ? <Icon size={size === 'sm' ? 13 : size === 'lg' ? 16 : 14} strokeWidth={1.9} aria-hidden /> : null}
      {children}
      {IconRight !== undefined && <IconRight size={13} strokeWidth={1.9} aria-hidden className="opacity-70" />}
      {kbd !== undefined && <span aria-hidden className={cn('vo-mono ml-1 hidden rounded-[3px] px-1 text-[10.5px] leading-4 md:inline', variant === 'primary' ? 'bg-[color-mix(in_srgb,var(--vo-on-ink),transparent_80%)]' : 'border border-[var(--vo-line)] text-[var(--vo-muted)]')}>{kbd}</span>}
    </button>
  );
}

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  /** Also the tooltip. */
  label: string;
  size?: number | undefined;
  active?: boolean | undefined;
  tone?: 'danger' | undefined;
  /** It sits on a row that itself takes the hover fill: hover one step darker. */
  onRow?: boolean | undefined;
  ref?: React.Ref<HTMLButtonElement> | undefined;
}

export function IconButton({ icon: Icon, label, size = 30, active, className, tone, onRow, ...rest }: IconButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      style={{ width: size, height: size, ...rest.style }}
      className={cn(
        'vo-focus vo-tap-sq inline-flex shrink-0 items-center justify-center rounded-[var(--vo-radius-sm)] transition-colors duration-150 disabled:cursor-default disabled:opacity-40',
        active === true ? 'bg-[var(--vo-active)] text-[var(--vo-ink)] hover:bg-[var(--vo-active-hover)]' : tone === 'danger' ? 'text-[var(--vo-muted)] hover:bg-[var(--vo-bad-soft)] hover:text-[var(--vo-bad)]' : onRow === true ? 'text-[var(--vo-muted)] hover:bg-[var(--vo-active)] hover:text-[var(--vo-ink)]' : 'text-[var(--vo-muted)] hover:bg-[var(--vo-hover)] hover:text-[var(--vo-ink)]',
        className,
      )}
    >
      <Icon size={Math.round(size * 0.53)} strokeWidth={1.8} aria-hidden />
    </button>
  );
}

/** A quiet text action ("Edit", "Remove"), underlined at rest. */
export function LinkButton({ children, onClick, className, tone, disabled }: { children: ReactNode; onClick: () => void; className?: string | undefined; tone?: 'danger' | undefined; disabled?: boolean | undefined }): React.JSX.Element {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={cn('vo-focus hit vo-link inline-flex items-center gap-1 rounded-[3px] text-[12px] font-medium disabled:opacity-40', tone === 'danger' ? 'text-[var(--vo-bad)]' : 'text-[var(--vo-ink-2)] hover:text-[var(--vo-ink)]', className)}>
      {children}
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }): React.JSX.Element {
  return <kbd className="vo-mono inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-[var(--vo-line)] bg-[var(--vo-raised)] px-1 text-[10.5px] text-[var(--vo-muted)]">{children}</kbd>;
}

export function Spinner({ size = 14, className }: { size?: number | undefined; className?: string | undefined }): React.JSX.Element {
  return <Loader2 size={size} className={cn('animate-spin', className)} aria-hidden />;
}

export function Skeleton({ className }: { className?: string | undefined }): React.JSX.Element {
  return <span aria-hidden className={cn('vo-skel block h-4', className)} />;
}

/* ----------------------------------------------------------------- fields */

export const FIELD =
  'vo-tap w-full rounded-[var(--vo-radius-sm)] border border-[var(--vo-line)] bg-[var(--vo-raised)] text-[var(--vo-ink)] outline-none transition-[border-color,box-shadow] duration-150 focus:border-[var(--vo-ink-2)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--vo-ink),transparent_90%)] disabled:opacity-55 aria-[invalid=true]:border-[var(--vo-bad)]';

export function Input({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { ref?: React.Ref<HTMLInputElement> | undefined }): React.JSX.Element {
  return <input {...rest} className={cn(FIELD, 'h-8 px-2.5 text-[13px]', className)} />;
}

/** A search field with the lens inside. */
export function SearchInput({ value, onChange, placeholder, className, label, autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string | undefined; className?: string | undefined; label?: string | undefined; autoFocus?: boolean | undefined }): React.JSX.Element {
  return (
    <span className={cn('relative inline-flex w-full', className)}>
      <Search size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--vo-muted)]" />
      <input value={value} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? 'Search'} aria-label={label ?? placeholder ?? 'Search'} className={cn(FIELD, 'h-8 pl-8 pr-7 text-[13px]')} />
      {value !== '' && (
        <button type="button" aria-label="Clear" onClick={() => onChange('')} className="vo-focus hit absolute right-1.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-[3px] text-[var(--vo-muted)] hover:bg-[var(--vo-hover)] hover:text-[var(--vo-ink)]">
          <X size={12} aria-hidden />
        </button>
      )}
    </span>
  );
}

/** A textarea that grows with its text. */
export function Textarea({ className, minRows = 2, maxRows = 14, value, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number | undefined; maxRows?: number | undefined; value: string; ref?: React.Ref<HTMLTextAreaElement> | undefined }): React.JSX.Element {
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
      className={cn(FIELD, 'vo-scroll vo-wrap block resize-none px-2.5 py-1.5 text-[13px] leading-5', className)}
    />
  );
}

/** A native select for forms (never in a sidebar; prefer Segmented or ChipPicker for a few choices). */
export function Select({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>): React.JSX.Element {
  return (
    <span className={cn('relative inline-flex w-full', className)}>
      <select {...rest} className={cn(FIELD, 'h-8 appearance-none pl-2.5 pr-8 text-[13px]')}>
        {children}
      </select>
      <ChevronDown size={14} aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--vo-muted)]" />
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
      className="vo-focus vo-tap-sq inline-flex shrink-0 items-center justify-center rounded-full transition-shadow duration-150 hover:shadow-[0_0_0_3px_var(--vo-active)] disabled:opacity-40 disabled:hover:shadow-none"
    >
      <span aria-hidden className={cn('relative inline-flex h-[18px] w-8 items-center rounded-full transition-[background-color] duration-150', checked ? 'bg-[var(--vo-ink)]' : 'bg-[var(--vo-line-2)]')}>
        <span className={cn('absolute size-3.5 rounded-full bg-[var(--vo-raised)] shadow-sm transition-transform duration-200', checked ? 'translate-x-[16px]' : 'translate-x-[2px]')} />
      </span>
    </button>
  );
}

export function Checkbox({ checked, onChange, label, disabled, indeterminate, hideLabel }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean | undefined; indeterminate?: boolean | undefined; hideLabel?: boolean | undefined }): React.JSX.Element {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate === true ? 'mixed' : checked}
      aria-label={hideLabel === true ? label : undefined}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={cn('vo-focus vo-tap group inline-flex shrink-0 items-center gap-2 rounded-[3px] text-[13px] disabled:opacity-40', hideLabel === true && 'justify-center')}
    >
      <span className={cn('flex size-4 items-center justify-center rounded-[4px] border transition-colors duration-150', checked || indeterminate === true ? 'border-[var(--vo-ink)] bg-[var(--vo-ink)] text-[var(--vo-on-ink)]' : 'border-[var(--vo-line-2)] bg-[var(--vo-raised)] group-hover:border-[var(--vo-ink-2)]')}>
        {indeterminate === true ? <span className="h-[1.5px] w-2 bg-current" /> : checked ? <Check size={11} strokeWidth={3} aria-hidden /> : null}
      </span>
      {hideLabel !== true && <span>{label}</span>}
    </button>
  );
}

export interface SegOption<T extends string> {
  value: T;
  label: ReactNode;
  title?: string | undefined;
  icon?: LucideIcon | undefined;
  count?: number | undefined;
}

/** A segmented choice; the selected segment slides. */
export function Segmented<T extends string>({ value, onChange, options, label, size = 'md', className }: { value: T; onChange: (v: T) => void; options: SegOption<T>[]; label: string; size?: 'sm' | 'md' | undefined; className?: string | undefined }): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (el !== null && el !== undefined) setPill({ left: el.offsetLeft, width: el.offsetWidth });
    else setPill(null);
  }, [value, options.length]);
  return (
    <div ref={ref} role="radiogroup" aria-label={label} className={cn('vo-strip relative inline-flex max-w-full shrink-0 items-center self-start rounded-[var(--vo-radius-sm)] border border-[var(--vo-line)] bg-[var(--vo-sunk)] p-0.5', className)}>
      {pill !== null && <span aria-hidden className="absolute bottom-0.5 top-0.5 rounded-[calc(var(--vo-radius-sm)-2px)] bg-[var(--vo-raised)] shadow-[var(--vo-shadow)] transition-[left,width] duration-200 ease-out" style={{ left: pill.left, width: pill.width }} />}
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
            className={cn('vo-focus vo-tap-sq relative z-[1] inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[calc(var(--vo-radius-sm)-2px)] font-medium transition-colors duration-150', size === 'sm' ? 'h-6 px-2 text-[12px]' : 'h-7 px-2.5 text-[13px]', value === o.value ? 'text-[var(--vo-ink)]' : 'text-[var(--vo-muted)] hover:bg-[var(--vo-hover)] hover:text-[var(--vo-ink)]')}
          >
            {Icon !== undefined && <Icon size={13} strokeWidth={1.9} aria-hidden />}
            {o.label}
            {o.count !== undefined && o.count > 0 && <span className="vo-mono vo-num text-[12px] text-[var(--vo-muted)]">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  count?: number | undefined;
  icon?: LucideIcon | undefined;
}

/** Underlined tabs (at most 6 on a record page); the ink bar slides under the chosen one. */
export function Tabs<T extends string>({ value, onChange, tabs, label, className }: { value: T; onChange: (v: T) => void; tabs: TabItem<T>[]; label: string; className?: string | undefined }): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (el !== null && el !== undefined) setBar({ left: el.offsetLeft, width: el.offsetWidth });
    else setBar(null);
  }, [value, tabs.length]);
  return (
    <div ref={ref} role="tablist" aria-label={label} className={cn('vo-strip relative flex shrink-0 items-end gap-5 pb-px shadow-[inset_0_-1px_0_var(--vo-line)]', className)}>
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const on = tab.value === value;
        return (
          <button key={tab.value} type="button" role="tab" aria-selected={on} onClick={() => onChange(tab.value)} className={cn('vo-focus vo-tap-sq relative inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-t-[3px] px-0.5 text-[13px] font-medium transition-colors duration-150', on ? 'text-[var(--vo-ink)]' : 'text-[var(--vo-muted)] hover:text-[var(--vo-ink)]')}>
            {Icon !== undefined && <Icon size={14} strokeWidth={1.8} aria-hidden />}
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && <Count n={tab.count} />}
          </button>
        );
      })}
      {bar !== null && <span aria-hidden className="absolute bottom-0 h-[2px] rounded-full bg-[var(--vo-ink)] transition-[left,width] duration-200 ease-out" style={{ left: bar.left, width: bar.width }} />}
    </div>
  );
}

/**
 * A labelled form row: the label (1 to 3 words) and the control. No help
 * text under it (U1): an explanation goes in `tip` (a ? beside the label).
 * It is a group, not a <label>; every control carries its own aria-label.
 */
export function Field({ label, error, children, className, tip }: { label: ReactNode; error?: string | null | undefined; children: ReactNode; className?: string | undefined; tip?: string | undefined }): React.JSX.Element {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <span id={id} className="flex min-w-0 items-center gap-1.5 text-[12px] font-medium text-[var(--vo-ink-2)]">
        {label}
        {tip !== undefined && <Hint text={tip} />}
      </span>
      {children}
      {error !== undefined && error !== null && error !== '' && (
        <span className="text-[12px] leading-4 text-[var(--vo-bad)]" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

/** A label on the left, a control on the right (settings rows). */
export function Row({ label, children, className, tip }: { label: ReactNode; children: ReactNode; className?: string | undefined; tip?: string | undefined }): React.JSX.Element {
  return (
    <div className={cn('flex min-h-11 items-center justify-between gap-4 py-2', className)}>
      <div className="flex min-w-0 items-center gap-1.5 text-[13px] text-[var(--vo-ink)]">
        <span className="vo-wrap min-w-0">{label}</span>
        {tip !== undefined && <Hint text={tip} />}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

/* ---------------------------------------------------------------- panels */

/**
 * A hairline panel with at most one short title saying plainly what is in it
 * (or none when the content is self-evident), an optional `tip` (the detail,
 * on a small ? beside the title) and an optional aside (one or two small
 * actions). 16px padding; it settles 6px once when the page opens.
 */
export function Panel({ label, aside, children, className, bodyClass, flush, bare, tip, divided }: { label?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string | undefined; bodyClass?: string | undefined; flush?: boolean | undefined; bare?: boolean | undefined; tip?: string | undefined; divided?: boolean | undefined }): React.JSX.Element {
  const head = label !== undefined || (aside !== undefined && aside !== null);
  // `divided` (Fix 4): a full-width hairline under the title row, the body starts 12px below it.
  const line = divided === true && head && bare !== true;
  return (
    <section className={cn('vo-in flex min-w-0 flex-col', bare === true ? '' : 'vo-panel', className)}>
      {head && (
        <header className={cn('flex min-h-10 shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 pt-3', bare === true ? 'px-0' : 'px-4', line && 'border-b border-[var(--vo-line)] pb-2.5')}>
          {label !== undefined && (
            <h2 className="vo-wrap flex min-w-0 flex-1 items-center gap-1.5 text-[13px] font-semibold leading-5 text-[var(--vo-ink)]">
              <span className="min-w-0">{label}</span>
              {tip !== undefined && <Hint text={tip} />}
            </h2>
          )}
          {aside !== undefined && aside !== null && <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1.5">{aside}</div>}
        </header>
      )}
      <div className={cn('min-h-0 flex-1', flush === true ? '' : bare === true ? (head ? 'pt-3' : '') : head ? (line ? 'px-4 pb-4 pt-3' : 'px-4 pb-4 pt-2') : 'p-4', bodyClass)}>{children}</div>
    </section>
  );
}

/** Empty: one icon, at most four words, one button (U2). */
export function Empty({ icon: Icon, title, action, className }: { icon: LucideIcon; title: string; action?: ReactNode; className?: string | undefined }): React.JSX.Element {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 px-6 py-10 text-center', className)}>
      <span className="flex size-10 items-center justify-center rounded-full border border-[var(--vo-line)] bg-[var(--vo-raised)] text-[var(--vo-muted)]">
        <Icon size={18} strokeWidth={1.8} aria-hidden />
      </span>
      <div className="text-[14px] font-medium text-[var(--vo-ink-2)]">{title}</div>
      {action !== undefined && <div className="flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}

/** A view that could not load: one short line and the action that fixes it. */
export function LoadError({ message, onRetry, className }: { message: string; onRetry?: (() => void) | undefined; className?: string | undefined }): React.JSX.Element {
  return (
    <div role="alert" className={cn('flex flex-col items-center justify-center gap-3 px-6 py-10 text-center', className)}>
      <AlertTriangle size={18} aria-hidden className="text-[var(--vo-bad)]" />
      <div className="vo-wrap max-w-sm text-[13px] text-[var(--vo-ink-2)]">{message}</div>
      {onRetry !== undefined && <Button onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function Count({ n, tone = 'neutral' }: { n: number; tone?: 'neutral' | 'agent' | 'bad' | undefined }): React.JSX.Element | null {
  if (n <= 0) return null;
  return <span className={cn('vo-num vo-mono inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10.5px] font-semibold', tone === 'agent' ? 'bg-[var(--vo-agent)] text-[var(--vo-agent-ink)]' : tone === 'bad' ? 'bg-[var(--vo-bad)] text-[var(--vo-page)]' : 'bg-[var(--vo-active)] text-[var(--vo-ink-2)]')}>{n > 99 ? '99+' : n}</span>;
}

export type Tone = 'neutral' | 'a' | 'b' | 'bad' | 'warn' | 'good' | 'agent' | 'faint';

const DOT: Record<Tone, string> = {
  neutral: 'bg-[var(--vo-ink-2)]',
  a: 'bg-[var(--vo-a)]',
  b: 'bg-[var(--vo-b)]',
  bad: 'bg-[var(--vo-bad)]',
  warn: 'bg-[var(--vo-warn)]',
  good: 'bg-[var(--vo-good)]',
  agent: 'bg-[var(--vo-agent)]',
  faint: 'bg-[var(--vo-line-2)]',
};

export const TEXT: Record<Tone, string> = {
  neutral: 'text-[var(--vo-ink-2)]',
  a: 'text-[var(--vo-a)]',
  b: 'text-[var(--vo-b)]',
  bad: 'text-[var(--vo-bad)]',
  warn: 'text-[var(--vo-warn)]',
  good: 'text-[var(--vo-good)]',
  agent: 'text-[var(--vo-ink)]',
  faint: 'text-[var(--vo-muted)]',
};

/** A status as a dot and a word ("Paid", "Overdue"). `pulse` is the one breathing dot. */
export function StatusDot({ tone, label, pulse, className, title }: { tone: Tone; label?: ReactNode; pulse?: boolean | undefined; className?: string | undefined; title?: string | undefined }): React.JSX.Element {
  return (
    <span title={title} className={cn('inline-flex min-w-0 items-center gap-1.5 text-[12px]', TEXT[tone], className)}>
      <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', DOT[tone], pulse === true && 'vo-pulse')} />
      {label !== undefined && <span className="truncate">{label}</span>}
    </span>
  );
}

const TAG: Record<Tone, string> = {
  neutral: 'border-[var(--vo-line)] bg-[var(--vo-raised)] text-[var(--vo-ink-2)]',
  faint: 'border-[var(--vo-line)] bg-transparent text-[var(--vo-muted)]',
  agent: 'border-[var(--vo-ink)] bg-transparent text-[var(--vo-ink)]',
  a: 'border-transparent bg-[var(--vo-a-soft)] text-[var(--vo-a)]',
  b: 'border-transparent bg-[var(--vo-b-soft)] text-[var(--vo-b)]',
  bad: 'border-transparent bg-[var(--vo-bad-soft)] text-[var(--vo-bad)]',
  warn: 'border-transparent bg-[var(--vo-warn-soft)] text-[var(--vo-warn)]',
  good: 'border-transparent bg-[var(--vo-good-soft)] text-[var(--vo-good)]',
};

/** A small chip ("Seed", "Overdue"). Tones carry meaning only; `agent` is an ink outline with the Sparkle, never solid. */
export function Tag({ children, tone = 'neutral', className, title, icon }: { children: ReactNode; tone?: Tone | undefined; className?: string | undefined; title?: string | undefined; icon?: LucideIcon | undefined }): React.JSX.Element {
  const Icon = icon ?? (tone === 'agent' ? Sparkle : undefined);
  return (
    <span title={title} className={cn('inline-flex h-[22px] shrink-0 items-center gap-1 whitespace-nowrap rounded-[4px] border px-1.5 text-[12px] font-medium', TAG[tone], className)}>
      {Icon !== undefined && <Icon size={12} strokeWidth={2} aria-hidden />}
      {children}
    </span>
  );
}

/** A NextItem chip tone as a Tag tone. */
export function chipTone(t: ChipTone | undefined): Tone {
  return t === 'good' ? 'good' : t === 'warn' ? 'warn' : t === 'bad' ? 'bad' : t === 'agent' ? 'agent' : 'neutral';
}

/** An inline note in a form or panel: what blocks or warns, one short line. */
export function Notice({ tone = 'neutral', children, action, className }: { tone?: 'neutral' | 'bad' | 'warn' | 'good' | 'agent' | undefined; children: ReactNode; action?: ReactNode; className?: string | undefined }): React.JSX.Element {
  return (
    <div role={tone === 'bad' ? 'alert' : undefined} className={cn('vo-wrap flex items-center gap-2 rounded-[var(--vo-radius-sm)] border-l-2 px-3 py-2 text-[13px] leading-[18px]', tone === 'bad' ? 'border-[var(--vo-bad)] bg-[var(--vo-bad-soft)]' : tone === 'warn' ? 'border-[var(--vo-warn)] bg-[var(--vo-warn-soft)]' : tone === 'good' ? 'border-[var(--vo-good)] bg-[var(--vo-good-soft)]' : tone === 'agent' ? 'border-[var(--vo-agent)] bg-[var(--vo-agent-soft)]' : 'border-[var(--vo-line-2)] bg-[var(--vo-sunk)]', 'text-[var(--vo-ink)]', className)}>
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

/* --------------------------------------------------------------- tooltips */

/** A dark bubble above an element (Tip, Hint and charts use it). */
export function Bubble({ anchor, open, children }: { anchor: RefObject<HTMLElement | null>; open: boolean; children: ReactNode }): React.JSX.Element | null {
  const panel = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const a = anchor.current;
    const p = panel.current;
    if (a === null || p === null) return;
    const r = a.getBoundingClientRect();
    let left = r.left + r.width / 2 - p.offsetWidth / 2;
    left = Math.min(Math.max(8, left), window.innerWidth - p.offsetWidth - 8);
    let top = r.top - p.offsetHeight - 6;
    if (top < 8) top = r.bottom + 6;
    setPos({ left, top });
  }, [open, anchor]);
  if (!open) return null;
  return createPortal(
    <div ref={panel} role="tooltip" style={{ position: 'fixed', left: pos?.left ?? -9999, top: pos?.top ?? -9999, zIndex: 90 }} className="vo-wrap pointer-events-none max-w-[280px] rounded-[4px] bg-[var(--vo-ink)] px-2.5 py-1.5 text-[12px] leading-[17px] text-[var(--vo-on-ink)] shadow-[var(--vo-shadow-lg)]">
      {children}
    </div>,
    document.body,
  );
}

/** Wrap a label in a tooltip: the explanation lives here, never under the label (U1). */
export function Tip({ text, children, className }: { text: ReactNode; children: ReactNode; className?: string | undefined }): React.JSX.Element {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <span ref={ref} tabIndex={0} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} className={cn('vo-focus cursor-help rounded-[2px] decoration-[var(--vo-line-2)] decoration-dotted underline-offset-4 hover:underline', className)}>
        {children}
      </span>
      <Bubble anchor={ref} open={open}>
        {text}
      </Bubble>
    </>
  );
}

/** A small "?" with a definition (hover, focus or tap). */
export function Hint({ text, className }: { text: string; className?: string | undefined }): React.JSX.Element {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={text}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={cn('vo-focus hit inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[var(--vo-muted)] transition-colors duration-150 hover:text-[var(--vo-ink)]', className)}
      >
        <CircleHelp size={13} strokeWidth={1.8} aria-hidden />
      </button>
      <Bubble anchor={ref} open={open}>
        {text}
      </Bubble>
    </>
  );
}

/* --------------------------------------------------------------- overlays */

/** A floating panel anchored to an element; closes on outside click or Esc. */
export function Popover({ anchor, open, onClose, children, className, align = 'start', side = 'bottom', width, label }: { anchor: RefObject<HTMLElement | null>; open: boolean; onClose: () => void; children: ReactNode; className?: string | undefined; align?: 'start' | 'end' | undefined; side?: 'bottom' | 'top' | 'right' | undefined; width?: number | undefined; label?: string | undefined }): React.JSX.Element | null {
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
      const tg = e.target as Node;
      if (panel.current?.contains(tg) || anchor.current?.contains(tg)) return;
      const inner = (tg as HTMLElement).closest?.('[data-vo-popover]');
      if (inner !== null && inner !== undefined && inner !== panel.current) return;
      onClose();
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const ro = new ResizeObserver(place);
    if (panel.current !== null) ro.observe(panel.current);
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('resize', place);
    return () => {
      ro.disconnect();
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', place);
    };
  }, [open, onClose, anchor, place]);
  if (!open) return null;
  return createPortal(
    <div
      ref={panel}
      data-vo-popover=""
      role="dialog"
      aria-label={label}
      style={{ position: 'fixed', left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: width !== undefined ? `min(${width}px, calc(100vw - 16px))` : undefined, zIndex: 80 }}
      className={cn('vo-fade vo-scroll max-h-[min(460px,80vh)] overflow-y-auto rounded-[var(--vo-radius)] border border-[var(--vo-line)] bg-[var(--vo-raised)] p-1 text-[var(--vo-ink)] shadow-[var(--vo-shadow-lg)]', className)}
    >
      {children}
    </div>,
    document.body,
  );
}

export function MenuItem({ icon: Icon, children, onClick, danger, selected, hint, disabled }: { icon?: LucideIcon | undefined; children: ReactNode; onClick: () => void; danger?: boolean | undefined; selected?: boolean | undefined; hint?: ReactNode; disabled?: boolean | undefined }): React.JSX.Element {
  return (
    <button type="button" role="menuitem" disabled={disabled} onClick={onClick} className={cn('vo-focus vo-tap flex min-h-8 w-full items-center gap-2 rounded-[var(--vo-radius-sm)] px-2 py-1 text-left text-[13px] transition-colors duration-150 disabled:opacity-40', danger === true ? 'text-[var(--vo-bad)] hover:bg-[var(--vo-bad-soft)]' : 'text-[var(--vo-ink)] hover:bg-[var(--vo-hover)]')}>
      {Icon !== undefined && <Icon size={14} strokeWidth={1.8} aria-hidden className={danger === true ? '' : 'text-[var(--vo-muted)]'} />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint !== undefined && <span className="vo-mono shrink-0 text-[12px] text-[var(--vo-muted)]">{hint}</span>}
      {selected === true && <Check size={14} aria-hidden className="shrink-0 text-[var(--vo-ink)]" />}
    </button>
  );
}

export function MenuSep(): React.JSX.Element {
  return <div className="my-1 h-px bg-[var(--vo-hair)]" />;
}

export function MenuLabel({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="vo-label px-2 pb-1 pt-2">{children}</div>;
}

/** An icon button that opens a menu ("More"). */
export function Menu({ icon = MoreHorizontal, label, children, align = 'end', width = 220, trigger, onRow }: { icon?: LucideIcon | undefined; label: string; children: (close: () => void) => ReactNode; align?: 'start' | 'end' | undefined; width?: number | undefined; trigger?: 'icon' | 'button' | undefined; onRow?: boolean | undefined }): React.JSX.Element {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      {trigger === 'button' ? (
        <Button ref={ref} iconRight={ChevronDown} onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>
          {label}
        </Button>
      ) : (
        <IconButton ref={ref} icon={icon} label={label} active={open} onRow={onRow} onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open} />
      )}
      <Popover anchor={ref} open={open} onClose={close} align={align} width={width} label={label}>
        <div role="menu">{children(close)}</div>
      </Popover>
    </>
  );
}

function useEscape(open: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && document.querySelector('[data-vo-popover]') === null) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open, onClose]);
}

/** A centred dialog: a title, the body, a footer (Cancel and the one main action). */
export function Dialog({ open, onClose, title, children, footer, width = 480 }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: number | undefined }): React.JSX.Element | null {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="vo-scrim fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto px-3 pb-10 pt-[8vh] sm:px-4" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} className="vo-fade w-full rounded-[calc(var(--vo-radius)*1.5)] border border-[var(--vo-line)] bg-[var(--vo-raised)] text-[var(--vo-ink)] shadow-[var(--vo-shadow-lg)]" style={{ maxWidth: width }}>
        <div className="flex items-center gap-2 px-5 pb-1 pt-4">
          <h2 className="vo-wrap min-w-0 flex-1 text-[15px] font-semibold leading-6">{title}</h2>
          <IconButton icon={X} label="Close" onClick={onClose} size={28} />
        </div>
        <div className="px-5 pb-5 pt-2">{children}</div>
        {footer !== undefined && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--vo-hair)] px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** A panel docked to the right edge (a record, a brief, the agent panel). */
export function Sheet({ open, onClose, children, width = 480, label }: { open: boolean; onClose: () => void; children: ReactNode; width?: number | undefined; label: string }): React.JSX.Element | null {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="vo-fade fixed inset-0 z-[60]" onPointerDown={(e) => e.target === e.currentTarget && onClose()} style={{ background: 'color-mix(in srgb, var(--vo-overlay), transparent 45%)' }}>
      <aside role="dialog" aria-modal="true" aria-label={label} className="absolute bottom-0 right-0 top-0 flex w-full flex-col border-l border-[var(--vo-line)] bg-[var(--vo-page)] text-[var(--vo-ink)] shadow-[var(--vo-shadow-lg)]" style={{ maxWidth: width }}>
        {children}
      </aside>
    </div>,
    document.body,
  );
}

/** The head of a Sheet: the title and close (and up to two actions). */
export function SheetHeader({ title, onClose, actions }: { title: ReactNode; onClose: () => void; actions?: ReactNode }): React.JSX.Element {
  return (
    <header className="flex min-h-14 shrink-0 items-center gap-2 border-b border-[var(--vo-line)] px-4 py-2">
      <h2 className="vo-wrap min-w-0 flex-1 text-[15px] font-semibold leading-5">{title}</h2>
      {actions}
      <IconButton icon={X} label="Close" onClick={onClose} />
    </header>
  );
}

/* ---------------------------------------------------------------- confirm */

interface ConfirmState {
  text?: ReactNode;
  title: string;
  ok: string;
  tone: 'danger' | 'primary';
  pin?: boolean | undefined;
  resolve: (v: boolean, pin?: string) => void;
}

function ConfirmDialog({ state, close }: { state: ConfirmState; close: (v: boolean, pin?: string) => void }): React.JSX.Element {
  const [pin, setPin] = useState('');
  const [wrong, setWrong] = useState<string | null>(null);
  const needPin = state.pin === true;
  const tryPin = async (v: string): Promise<void> => {
    const bad = await checkPin(v);
    if (bad === null) {
      close(true, v);
      return;
    }
    setPin('');
    setWrong(bad.left !== undefined ? `Wrong PIN. ${bad.left} left.` : (bad.text ?? 'Wrong PIN.'));
  };
  return (
    <Dialog
      open
      onClose={() => close(false)}
      title={state.title}
      width={400}
      footer={
        <>
          <Button onClick={() => close(false)}>Cancel</Button>
          <Button variant="primary" className={state.tone === 'danger' ? '!bg-[var(--vo-bad)] !text-[var(--vo-page)]' : ''} onClick={() => (needPin ? void tryPin(pin) : close(true))} autoFocus={!needPin} disabled={needPin && pin.length !== 6}>
            {state.ok}
          </Button>
        </>
      }
    >
      {state.text !== undefined && <div className="vo-wrap text-[13px] leading-5 text-[var(--vo-ink-2)]">{state.text}</div>}
      {needPin && (
        <div className="mt-2 flex flex-col items-center gap-2">
          <PinBoxes value={pin} onChange={(v) => (setPin(v), setWrong(null))} onDone={(v) => void tryPin(v)} autoFocus label="Approval PIN" invalid={wrong !== null && pin === ''} />
          {wrong !== null && (
            <span className="text-[12px] text-[var(--vo-bad)]" role="alert">
              {wrong}
            </span>
          )}
        </div>
      )}
    </Dialog>
  );
}

let confirmHost: ((s: Omit<ConfirmState, 'resolve'>) => Promise<{ ok: boolean; pin: string }>) | null = null;

/** Ask before what cannot be undone: `if (await confirmAsk('Remove Maya?', 'Remove')) ...` */
export function confirmAsk(title: string, ok = 'Remove', tone: 'danger' | 'primary' = 'danger', text?: ReactNode): Promise<boolean> {
  if (confirmHost === null) return Promise.resolve(window.confirm(title));
  return confirmHost({ text, title, ok, tone }).then((r) => r.ok);
}

/**
 * Ask before a `confirm` operation and take the PIN in the same dialog:
 * resolves the PIN, or null when cancelled. Pass it as the op's `pin`.
 */
export function confirmPin(title: string, ok: string, tone: 'danger' | 'primary' = 'primary', text?: ReactNode): Promise<string | null> {
  if (confirmHost === null) return Promise.resolve(null);
  return confirmHost({ text, title, ok, tone, pin: true }).then((r) => (r.ok && r.pin.length === 6 ? r.pin : null));
}

export function ConfirmHost(): React.JSX.Element | null {
  const [state, setState] = useState<ConfirmState | null>(null);
  useEffect(() => {
    confirmHost = (s) => new Promise<{ ok: boolean; pin: string }>((resolve) => setState({ ...s, resolve: (ok, pin) => resolve({ ok, pin: pin ?? '' }) }));
    return () => {
      confirmHost = null;
    };
  }, []);
  if (state === null) return null;
  return (
    <ConfirmDialog
      state={state}
      close={(v, pin) => {
        state.resolve(v, pin);
        setState(null);
      }}
    />
  );
}

/* -------------------------------------------------------------------- PIN */

/** Six boxes for a six-digit PIN; submits itself on the sixth digit. */
export function PinBoxes({ value, onChange, onDone, autoFocus, label, invalid, align = 'center' }: { value: string; onChange: (v: string) => void; onDone?: ((v: string) => void) | undefined; autoFocus?: boolean | undefined; label: string; invalid?: boolean | undefined; align?: 'center' | 'start' | undefined }): React.JSX.Element {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (autoFocus === true) ref.current?.focus();
  }, [autoFocus]);
  return (
    <div className={cn('relative', align === 'start' && 'self-start')} onClick={() => ref.current?.focus()}>
      <input
        ref={ref}
        value={value}
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-label={label}
        aria-invalid={invalid === true}
        maxLength={6}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, '').slice(0, 6);
          onChange(v);
          if (v.length === 6) onDone?.(v);
        }}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
      <div aria-hidden className={cn('flex gap-2', align === 'start' ? 'justify-start' : 'justify-center')}>
        {Array.from({ length: 6 }, (_, i) => {
          const filled = i < value.length;
          const cur = i === value.length;
          return (
            <span key={i} className={cn('flex h-11 w-9 items-center justify-center rounded-[var(--vo-radius-sm)] border bg-[var(--vo-raised)] transition-colors duration-150', invalid === true ? 'border-[var(--vo-bad)]' : cur ? 'border-[var(--vo-ink)]' : 'border-[var(--vo-line)]')}>
              {filled && <span className="size-2 rounded-full bg-[var(--vo-ink)]" />}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** The approval PIN dialog (asked by every confirm operation through lib/api.ts). */
export function PinDialog({ open, ask, onDone, onCancel }: { open: boolean; ask: PinAsk; onDone: (pin: string) => void; onCancel: () => void }): React.JSX.Element | null {
  const [pin, setPin] = useState('');
  useEffect(() => {
    if (open) setPin('');
  }, [open, ask]);
  if (!open) return null;
  return (
    <Dialog open onClose={onCancel} title={ask.title ?? 'Approval PIN'} width={360}>
      <div className="flex flex-col items-center gap-4 pb-1 pt-2 text-center">
        <span className="flex size-10 items-center justify-center rounded-full border border-[var(--vo-line)] bg-[var(--vo-sunk)] text-[var(--vo-ink-2)]">
          <Lock size={17} aria-hidden />
        </span>
        <PinBoxes value={pin} onChange={setPin} onDone={(v) => onDone(v)} autoFocus label="Approval PIN" invalid={ask.wrong === true && pin === ''} />
        {ask.wrong === true && (
          <p className="text-[12px] text-[var(--vo-bad)]" role="alert">
            {ask.left !== undefined ? `Wrong PIN. ${ask.left} left.` : (ask.text ?? 'Wrong PIN.')}
          </p>
        )}
        <div className="flex w-full justify-end gap-2 pt-1">
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" disabled={pin.length !== 6} onClick={() => onDone(pin)}>
            Confirm
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** Check a PIN without doing anything (pin.verify answers 200 { ok: false } on a wrong PIN). Null when right. */
export async function checkPin(pin: string): Promise<{ wrong: boolean; left?: number | undefined; text?: string | undefined } | null> {
  try {
    const r = await op<{ ok: boolean; code?: string; attempts_left?: number; message?: string }>('pin.verify', { pin }, { quiet: true });
    if (r.ok) return null;
    if (r.code === 'wrong_pin') return { wrong: true, left: r.attempts_left };
    return { wrong: true, text: r.message };
  } catch {
    return null;
  }
}

/** Mounted once in App: answers op({ pin }) calls with the PIN dialog (each PIN is checked first). */
export function PinHost(): React.JSX.Element | null {
  const [state, setState] = useState<{ ask: PinAsk; resolve: (v: string | null) => void } | null>(null);
  useEffect(() => {
    setPinAsker((ask) => new Promise<string | null>((resolve) => setState({ ask, resolve })));
    return () => setPinAsker(null);
  }, []);
  if (state === null) return null;
  return (
    <PinDialog
      open
      ask={state.ask}
      onDone={(pin) => {
        void checkPin(pin).then((bad) => {
          if (bad === null) {
            state.resolve(pin);
            setState(null);
            return;
          }
          setState({ ...state, ask: { ...state.ask, wrong: true, left: bad.left, text: bad.text } });
        });
      }}
      onCancel={() => {
        state.resolve(null);
        setState(null);
      }}
    />
  );
}

/* ----------------------------------------------------------------- toasts */

/** The toast host (undo and errors only). */
export function Toasts(): React.JSX.Element {
  const [list, setList] = useState<Note[]>([]);
  useEffect(() => subscribeToasts(setList), []);
  return createPortal(
    <div className="pointer-events-none fixed bottom-[calc(76px+env(safe-area-inset-bottom))] left-1/2 z-[95] grid w-max max-w-[calc(100vw-24px)] -translate-x-1/2 gap-2 md:bottom-6" role="status" aria-live="polite">
      {list.map((n) => (
        <div key={n.id} className={cn('vo-fade vo-wrap pointer-events-auto flex items-center gap-3 rounded-[var(--vo-radius)] px-3.5 py-2.5 text-[13px] font-medium shadow-[var(--vo-shadow-lg)]', n.kind === 'error' ? 'bg-[var(--vo-bad)] text-[var(--vo-page)]' : 'bg-[var(--vo-ink)] text-[var(--vo-on-ink)]')}>
          {n.kind === 'error' && <AlertTriangle size={14} aria-hidden className="shrink-0" />}
          <span className="min-w-0">{n.text}</span>
          {n.action !== undefined && (
            <button
              type="button"
              onClick={() => {
                n.action?.run();
                toast.dismiss(n.id);
              }}
              className="vo-focus shrink-0 rounded-[3px] px-1 font-semibold underline underline-offset-4 transition-opacity duration-150 hover:opacity-80"
            >
              {n.action.label}
            </button>
          )}
          <button type="button" aria-label="Close" onClick={() => toast.dismiss(n.id)} className="vo-focus hit -mr-1 flex size-5 shrink-0 items-center justify-center rounded-[3px] opacity-70 transition-opacity duration-150 hover:opacity-100">
            <X size={12} aria-hidden />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ money */

/** An amount: mono, tabular, exact for any size. `tone="auto"` reds a negative. */
export function Money({ minor, currency, className, tone, ...o }: { minor: Minor | null | undefined; currency: string; className?: string | undefined; tone?: 'auto' | undefined } & MoneyOpts): React.JSX.Element {
  const neg = minor !== null && minor !== undefined && String(minor).trim().startsWith('-');
  return <span className={cn('vo-mono vo-num whitespace-nowrap', tone === 'auto' && neg && 'text-[var(--vo-bad)]', className)}>{money(minor, currency, o)}</span>;
}

/** A money field: the person types "3.2m", "1,500,000" or "250k"; the value stays integer minor units. */
export function MoneyInput({ value, onChange, currency, className, placeholder, label, autoFocus, invalid }: { value: number | null; onChange: (v: number | null) => void; currency: string; className?: string | undefined; placeholder?: string | undefined; label?: string | undefined; autoFocus?: boolean | undefined; invalid?: boolean | undefined }): React.JSX.Element {
  const [text, setText] = useState(() => (value === null ? '' : money(value, currency, { bare: true, whole: value % 100 === 0 })));
  const [bad, setBad] = useState(false);
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(value === null ? '' : money(value, currency, { bare: true, whole: value % 100 === 0 }));
    }
  }, [value, currency]);
  return (
    <span className={cn('relative inline-flex w-full', className)}>
      <span className="vo-mono pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] text-[var(--vo-muted)]">{currency}</span>
      <input
        value={text}
        inputMode="decimal"
        autoFocus={autoFocus}
        aria-label={label}
        aria-invalid={bad || invalid === true}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          const v = e.target.value.trim() === '' ? null : parseMoney(e.target.value, currency);
          setBad(e.target.value.trim() !== '' && v === null);
          last.current = v;
          onChange(v);
        }}
        className={cn(FIELD, 'vo-mono vo-num h-8 pl-12 pr-2.5 text-right text-[13px]')}
      />
    </span>
  );
}

/* ------------------------------------------------------------------- days */

function monthGrid(month: string, weekStart: number): string[] {
  const first = dateOf(month.slice(0, 8) + '01');
  const offset = (first.getDay() - weekStart + 7) % 7;
  const start = addDays(dayKey(first), -offset);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** A typed day: ISO, or numbers in day-first order (14/05/2026). */
export function parseTypedDay(text: string): string | null {
  const s = text.trim();
  if (isDay(s)) return s;
  const m = /^(\d{1,4})[./\-\s](\d{1,2})[./\-\s](\d{1,4})$/.exec(s);
  if (m === null) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = Number(m[3]);
  const [y, mo, d] = (m[1] ?? '').length === 4 ? [a, b, c] : [c < 100 ? 2000 + c : c, b, a];
  const key = `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isDay(key) && dayKey(dateOf(key)) === key ? key : null;
}

function MonthView({ month, onMonth, isSel, onPick, min, max }: { month: string; onMonth: (m: string) => void; isSel: (d: string) => boolean; onPick: (d: string) => void; min?: string | undefined; max?: string | undefined }): React.JSX.Element {
  const days = monthGrid(month, 1);
  const m = dateOf(month);
  const now = today();
  const heads = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const shift = (n: number): void => onMonth(dayKey(new Date(m.getFullYear(), m.getMonth() + n, 1, 12)));
  return (
    <div className="w-[252px] p-2">
      <div className="mb-1 flex items-center gap-1">
        <IconButton icon={ChevronLeft} label="Previous month" size={28} onClick={() => shift(-1)} />
        <div className="flex-1 text-center text-[13px] font-semibold">
          {monthName(m.getMonth() + 1)} <span className="vo-mono vo-num font-normal">{m.getFullYear()}</span>
        </div>
        <IconButton icon={ChevronRight} label="Next month" size={28} onClick={() => shift(1)} />
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {heads.map((h, i) => (
          <span key={i} className="flex h-6 items-center justify-center text-[12px] text-[var(--vo-muted)]">
            {h}
          </span>
        ))}
        {days.map((d) => {
          const other = d.slice(0, 7) !== month.slice(0, 7);
          const off = (min !== undefined && min !== '' && d < min) || (max !== undefined && max !== '' && d > max);
          const sel = isSel(d);
          return (
            <button
              key={d}
              type="button"
              disabled={off}
              onClick={() => onPick(d)}
              aria-label={fmtDay(d, { year: 'always', weekday: true })}
              aria-pressed={sel}
              className={cn('vo-focus vo-mono vo-num flex h-8 items-center justify-center rounded-[var(--vo-radius-sm)] text-[12px] transition-colors duration-150 disabled:cursor-default disabled:opacity-30', sel ? 'bg-[var(--vo-ink)] font-semibold text-[var(--vo-on-ink)]' : other ? 'text-[var(--vo-muted)] hover:bg-[var(--vo-hover)]' : 'text-[var(--vo-ink)] hover:bg-[var(--vo-hover)]', d === now && !sel && 'ring-1 ring-inset ring-[var(--vo-line-2)]')}
            >
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A day field: a button with the day that opens a month, with typed entry on top. Never a native date input. */
export function DayPicker({ value, onChange, placeholder, min, max, label, className, clearable, invalid, disabled }: { value: string; onChange: (day: string) => void; placeholder?: string | undefined; min?: string | undefined; max?: string | undefined; label: string; className?: string | undefined; clearable?: boolean | undefined; invalid?: boolean | undefined; disabled?: boolean | undefined }): React.JSX.Element {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(value !== '' ? value : today());
  const [typed, setTyped] = useState('');
  useEffect(() => {
    if (open) {
      setMonth(value !== '' ? value : today());
      setTyped('');
    }
  }, [open, value]);
  const pick = (d: string): void => {
    onChange(d);
    setOpen(false);
  };
  const typedDay = typed === '' ? null : parseTypedDay(typed);
  return (
    <>
      <button ref={ref} type="button" disabled={disabled} aria-label={value !== '' ? `${label}: ${fmtDay(value, { year: 'always' })}` : label} aria-invalid={invalid === true} onClick={() => setOpen((v) => !v)} className={cn(FIELD, 'flex h-8 items-center gap-2 px-2.5 text-left text-[13px] hover:border-[var(--vo-line-2)]', className)}>
        <span className="flex w-full min-w-0 items-center gap-2">
          <span className={cn('vo-mono min-w-0 flex-1 truncate', value === '' && 'font-sans text-[var(--vo-muted)]')}>{value !== '' ? fmtDay(value, { year: 'always' }) : (placeholder ?? 'Pick a day')}</span>
          <ChevronsUpDown size={13} aria-hidden className="shrink-0 text-[var(--vo-muted)]" />
        </span>
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} label={label} className="p-0">
        <div className="border-b border-[var(--vo-hair)] p-2">
          <Input
            value={typed}
            autoFocus
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && typedDay !== null) {
                e.preventDefault();
                pick(typedDay);
              }
            }}
            placeholder="Type a day"
            aria-label="Type a day"
            aria-invalid={typed !== '' && typedDay === null}
          />
        </div>
        <MonthView month={month} onMonth={setMonth} isSel={(d) => d === value} onPick={pick} min={min} max={max} />
        <div className="flex items-center justify-between gap-2 border-t border-[var(--vo-hair)] px-2 py-1.5">
          <LinkButton onClick={() => pick(today())}>Today</LinkButton>
          {clearable === true && value !== '' && <LinkButton onClick={() => pick('')}>Clear</LinkButton>}
        </div>
      </Popover>
    </>
  );
}

/* ----------------------------------------------------------------- people */

/** A letter avatar: round for people, rounded square for companies and funds. Never a drawn logo. */
export function Avatar({ name, size = 28, square, agent }: { name: string; size?: number | undefined; square?: boolean | undefined; agent?: boolean | undefined }): React.JSX.Element {
  return (
    <span aria-hidden className={cn('vo-mono flex shrink-0 select-none items-center justify-center font-medium', square === true ? 'rounded-[6px]' : 'rounded-full', agent === true ? 'bg-[var(--vo-agent)] text-[var(--vo-agent-ink)]' : 'border border-[var(--vo-line)] bg-[var(--vo-sunk)] text-[var(--vo-ink-2)]')} style={{ width: size, height: size, fontSize: size <= 22 ? 10.5 : size <= 34 ? 12 : size <= 46 ? 14 : size <= 64 ? 15 : 26 }}>
      {initials(name)}
    </span>
  );
}

/** A person or company: the letter avatar and the name (one line). */
export function PersonChip({ name, size = 24, href: link, onClick, className, square }: { name: string; size?: number | undefined; href?: string | undefined; onClick?: (() => void) | undefined; className?: string | undefined; square?: boolean | undefined }): React.JSX.Element {
  const inner = (
    <>
      <Avatar name={name} size={size} square={square} />
      <span className={cn('vo-wrap min-w-0 text-[13px] font-medium', link !== undefined && 'vo-link')}>{name}</span>
    </>
  );
  const cls = cn('inline-flex min-w-0 items-center gap-2 text-left', className);
  // A chip that opens something: a hover fill of its own and a 40px touch area (hit).
  const act = 'vo-focus hit -mx-1 rounded-[var(--vo-radius-sm)] px-1 transition-colors duration-150 hover:bg-[var(--vo-active)]';
  if (link !== undefined)
    return (
      <a href={link} onClick={(e) => e.stopPropagation()} className={cn(cls, act)}>
        {inner}
      </a>
    );
  if (onClick !== undefined)
    return (
      <button type="button" onClick={onClick} className={cn(cls, act)}>
        {inner}
      </button>
    );
  return <span className={cls}>{inner}</span>;
}

export interface PickItem {
  value: string;
  label: string;
  sub?: string | undefined;
  icon?: LucideIcon | undefined;
  /** Show a letter avatar (people round, companies square). */
  avatar?: 'person' | 'company' | undefined;
}

/** Choose one of many (a person, a company): a field-styled button opening a searchable list. */
export function Picker({ value, onChange, items, label, placeholder, className, onSearch, clearable, invalid, disabled }: { value: string; onChange: (v: string, item: PickItem | null) => void; items: PickItem[]; label: string; placeholder?: string | undefined; className?: string | undefined; onSearch?: ((q: string) => void) | undefined; clearable?: boolean | undefined; invalid?: boolean | undefined; disabled?: boolean | undefined }): React.JSX.Element {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [at, setAt] = useState(0);
  const cur = items.find((i) => i.value === value) ?? null;
  const shown = useMemo(() => {
    if (onSearch !== undefined || q.trim() === '') return items;
    const n = q.trim().toLowerCase();
    return items.filter((i) => `${i.label} ${i.sub ?? ''}`.toLowerCase().includes(n));
  }, [items, q, onSearch]);
  useEffect(() => {
    if (!open) setQ('');
    setAt(0);
  }, [open]);
  const choose = (i: PickItem | null): void => {
    onChange(i?.value ?? '', i);
    setOpen(false);
  };
  return (
    <>
      <button ref={ref} type="button" disabled={disabled} aria-label={cur !== null ? `${label}: ${cur.label}` : label} aria-invalid={invalid === true} onClick={() => setOpen((v) => !v)} className={cn(FIELD, 'flex h-8 items-center gap-2 px-2.5 text-left text-[13px] hover:border-[var(--vo-line-2)]', className)}>
        {cur?.avatar !== undefined && <Avatar name={cur.label} size={18} square={cur.avatar === 'company'} />}
        <span className={cn('min-w-0 flex-1 truncate', cur === null && 'text-[var(--vo-muted)]')}>{cur?.label ?? placeholder ?? 'Choose'}</span>
        <ChevronsUpDown size={13} aria-hidden className="shrink-0 text-[var(--vo-muted)]" />
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} width={Math.max(260, ref.current?.offsetWidth ?? 0)} label={label} className="flex flex-col p-0">
        <div className="border-b border-[var(--vo-hair)] p-1.5">
          <SearchInput
            value={q}
            autoFocus
            onChange={(v) => {
              setQ(v);
              setAt(0);
              onSearch?.(v);
            }}
            label={label}
          />
        </div>
        <div
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          className="vo-scroll max-h-[280px] overflow-y-auto p-1"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setAt((i) => Math.min(shown.length - 1, i + 1));
            else if (e.key === 'ArrowUp') setAt((i) => Math.max(0, i - 1));
            else if (e.key === 'Enter') choose(shown[at] ?? null);
          }}
        >
          {clearable === true && value !== '' && (
            <button type="button" role="option" aria-selected={false} onClick={() => choose(null)} className="vo-focus flex h-8 w-full items-center gap-2 rounded-[var(--vo-radius-sm)] px-2 text-left text-[13px] text-[var(--vo-muted)] hover:bg-[var(--vo-hover)]">
              None
            </button>
          )}
          {shown.length === 0 && <div className="px-2 py-4 text-center text-[12px] text-[var(--vo-muted)]">Nothing found</div>}
          {shown.slice(0, 200).map((i, idx) => {
            const Icon = i.icon;
            return (
              <button key={i.value} type="button" role="option" aria-selected={i.value === value} onMouseEnter={() => setAt(idx)} onClick={() => choose(i)} className={cn('vo-focus flex min-h-8 w-full items-center gap-2 rounded-[var(--vo-radius-sm)] px-2 py-1 text-left text-[13px]', idx === at ? 'bg-[var(--vo-hover)]' : '')}>
                {i.avatar !== undefined ? <Avatar name={i.label} size={20} square={i.avatar === 'company'} /> : Icon !== undefined ? <Icon size={14} aria-hidden className="text-[var(--vo-muted)]" /> : null}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{i.label}</span>
                  {i.sub !== undefined && i.sub !== '' && <span className="block truncate text-[12px] text-[var(--vo-muted)]">{i.sub}</span>}
                </span>
                {i.value === value && <Check size={14} aria-hidden />}
              </button>
            );
          })}
        </div>
      </Popover>
    </>
  );
}

/* --------------------------------------------------------------- readouts */

export interface Figure {
  label: string;
  value: ReactNode;
  /** The label's tooltip (what the figure means). */
  tip?: string | undefined;
  tone?: Tone | undefined;
}

/** A value that is not known reads "Unknown", never zero (SPEC 8). */
export function Unknown(): React.JSX.Element {
  return <span className="font-sans text-[15px] text-[var(--vo-muted)]">Unknown</span>;
}

/** One big readout: a 12px label above, the 26px mono figure, nothing below. */
export function StatTile({ label, value, tip, tone, className, onClick, bare }: Figure & { className?: string | undefined; onClick?: (() => void) | undefined; bare?: boolean | undefined }): React.JSX.Element {
  const body = (
    <>
      <div className="flex min-w-0 items-center gap-1 text-[12px] text-[var(--vo-muted)]">{tip !== undefined ? <Tip text={tip}>{label}</Tip> : <span className="truncate">{label}</span>}</div>
      <div className={cn('mt-1 truncate text-[26px] leading-8', typeof value === 'string' && !/\d/.test(value) ? 'font-normal tracking-[-0.01em]' : 'vo-mono vo-num font-light tracking-tight', tone !== undefined && TEXT[tone])}>{value === null || value === undefined || value === '' ? <Unknown /> : value}</div>
    </>
  );
  const frame = bare === true ? 'min-w-0' : 'vo-panel vo-in min-w-0 px-5 py-4';
  if (onClick !== undefined)
    return (
      <button type="button" onClick={onClick} className={cn(frame, 'vo-focus text-left transition-colors duration-150 hover:bg-[var(--vo-hover)]', className)}>
        {body}
      </button>
    );
  return <div className={cn(frame, className)}>{body}</div>;
}

/**
 * A strip of big mono figures, each with a 12px label above (Raise, Valuation...). No panel by default. Only the
 * known figures show (an unknown one, null or '', is left out, never a row of "Unknown"); nothing when none is known.
 */
export function FigureStrip({ items, className, panel }: { items: Figure[]; className?: string | undefined; panel?: boolean | undefined }): React.JSX.Element | null {
  const known = items.filter((it) => it.value !== null && it.value !== undefined && it.value !== '');
  if (known.length === 0) return null;
  return (
    <div className={cn('grid min-w-0 grid-cols-2 gap-x-8 gap-y-4 sm:flex sm:flex-wrap sm:gap-x-12', panel === true && 'vo-panel vo-in px-4 py-4', className)}>
      {known.map((it) => (
        <StatTile key={it.label} {...it} bare />
      ))}
    </div>
  );
}

/** A read-only fact: a small label over its value (record headers, cards). */
export function Fact({ label, children, mono, className, tip }: { label: string; children: ReactNode; mono?: boolean | undefined; className?: string | undefined; tip?: string | undefined }): React.JSX.Element {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="truncate text-[12px] text-[var(--vo-muted)]">{tip !== undefined ? <Tip text={tip}>{label}</Tip> : label}</div>
      <div className={cn('vo-wrap mt-0.5 text-[13px] text-[var(--vo-ink)]', mono === true && 'vo-mono vo-num')}>{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------- processes */

/**
 * Work in progress as a picture (U5): at most 5 dots with 1-word labels on
 * a line; done dots filled, the current one breathes, later ones hollow.
 * `at` is the current index; at >= labels.length means all done.
 */
export function StepTrack({ labels, at, className, compact }: { labels: string[]; at: number; className?: string | undefined; compact?: boolean | undefined }): React.JSX.Element {
  const shown = labels.slice(0, 5);
  const n = shown.length;
  return (
    <ol aria-label="Progress" className={cn('flex min-w-0 items-start', className)}>
      {shown.map((l, i) => {
        const done = i < at;
        const cur = i === at;
        const last = i === n - 1;
        return (
          <li key={l + i} aria-current={cur ? 'step' : undefined} className={cn('flex min-w-0 flex-col gap-1', last ? 'shrink-0 items-end' : 'flex-1')}>
            <div className="flex w-full items-center">
              <span aria-hidden className={cn('relative z-[1] shrink-0 rounded-full border-[1.5px]', compact === true ? 'size-2' : 'size-2.5', done ? 'border-[var(--vo-ink)] bg-[var(--vo-ink)]' : cur ? 'vo-pulse border-[var(--vo-ink)] bg-[var(--vo-ink)]' : 'border-[var(--vo-line-2)] bg-[var(--vo-raised)]')} />
              {!last && <span aria-hidden className={cn('h-px flex-1', done ? 'bg-[var(--vo-ink-2)]' : 'bg-[var(--vo-line)]')} />}
            </div>
            {compact !== true && <span className={cn('whitespace-nowrap text-[12px]', last ? '-mr-1 text-right' : '-ml-1 pr-2', cur ? 'font-medium text-[var(--vo-ink)]' : done ? 'text-[var(--vo-ink-2)]' : 'text-[var(--vo-muted)]')}>{l}</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** A deal's place: stage dots on a line, current filled; click a stage to move (when `onMove`). */
export function StageTrack({ stages, current, onMove, stalled, className }: { stages: { key: string; label: string }[]; current: string; onMove?: ((key: string) => void) | undefined; stalled?: boolean | undefined; className?: string | undefined }): React.JSX.Element {
  const idx = Math.max(0, stages.findIndex((s) => s.key === current));
  return (
    <ol aria-label="Stage" className={cn('vo-strip flex min-w-0 items-start', className)}>
      {stages.map((s, i) => {
        const done = i < idx;
        const cur = i === idx;
        const dot = <span aria-hidden className={cn('shrink-0 rounded-full border-[1.5px] transition-colors duration-150', cur ? cn('size-3', stalled === true ? 'border-[var(--vo-warn)] bg-[var(--vo-warn)]' : 'border-[var(--vo-ink)] bg-[var(--vo-ink)]') : done ? 'size-2.5 border-[var(--vo-ink-2)] bg-[var(--vo-ink-2)]' : 'size-2.5 border-[var(--vo-line-2)] bg-[var(--vo-raised)]')} />;
        return (
          <li key={s.key} className="flex min-w-[64px] flex-1 flex-col gap-1 last:flex-none">
            <div className="flex h-3 items-center">
              {onMove !== undefined && !cur ? (
                <button type="button" title={`Move to ${s.label}`} aria-label={`Move to ${s.label}`} onClick={() => onMove(s.key)} className="vo-focus hit group flex size-4 items-center justify-center rounded-full hover:bg-[var(--vo-hover)]">
                  {dot}
                </button>
              ) : (
                <span className="flex size-4 items-center justify-center">{dot}</span>
              )}
              {i < stages.length - 1 && <span aria-hidden className={cn('h-px flex-1', done || cur ? 'bg-[var(--vo-ink-2)]' : 'bg-[var(--vo-line)]')} />}
            </div>
            <span className={cn('truncate pr-2 text-[12px]', cur ? 'font-medium text-[var(--vo-ink)]' : 'text-[var(--vo-muted)]')}>{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

export type Grade = 'artifact' | 'founder_reported' | 'public' | 'unverifiable' | 'unknown';
const GRADE: Record<Grade, { label: string; cls: string }> = {
  artifact: { label: 'From a document', cls: 'border-[var(--vo-ink)] bg-[var(--vo-ink)]' },
  founder_reported: { label: 'Founder reported', cls: 'border-[var(--vo-ink-2)] bg-[linear-gradient(90deg,var(--vo-ink-2)_50%,transparent_50%)]' },
  public: { label: 'Public source', cls: 'border-[var(--vo-a)] bg-[var(--vo-a)]' },
  unverifiable: { label: 'Unverifiable', cls: 'border-[var(--vo-warn)] bg-transparent' },
  unknown: { label: 'Unknown', cls: 'border-dashed border-[var(--vo-muted)] bg-transparent' },
};

/** How a fact is known, as one dot (the word is its tooltip). */
export function GradeDot({ grade, className }: { grade: Grade; className?: string | undefined }): React.JSX.Element {
  const g = GRADE[grade] ?? GRADE.unknown;
  return <span role="img" aria-label={g.label} title={g.label} className={cn('inline-block size-2 shrink-0 rounded-full border-[1.5px]', g.cls, className)} />;
}

export type Check3 = 'met' | 'unmet' | 'unknown';

/** A thesis check as a chip: met, unmet, or unknown (unknown never reads as no). */
export function CheckChip({ state, label, title }: { state: Check3; label: string; title?: string | undefined }): React.JSX.Element {
  return (
    <span title={title ?? (state === 'met' ? 'Met' : state === 'unmet' ? 'Not met' : 'Unknown')} className={cn('inline-flex h-[22px] shrink-0 items-center gap-1 whitespace-nowrap rounded-[4px] border px-1.5 text-[12px] font-medium', state === 'met' ? 'border-transparent bg-[var(--vo-good-soft)] text-[var(--vo-good)]' : state === 'unmet' ? 'border-transparent bg-[var(--vo-bad-soft)] text-[var(--vo-bad)]' : 'border-dashed border-[var(--vo-line-2)] text-[var(--vo-muted)]')}>
      {state === 'met' ? <Check size={12} strokeWidth={2.4} aria-hidden /> : state === 'unmet' ? <X size={12} strokeWidth={2.4} aria-hidden /> : <CircleHelp size={12} strokeWidth={2} aria-hidden />}
      {label}
    </span>
  );
}

/** Your AI agent: a small black square with the Sparkle (white on dark in dark mode). */
export function AgentMark({ size = 28, working }: { size?: number | undefined; working?: boolean | 'waiting' | undefined }): React.JSX.Element {
  return (
    <span className="relative inline-flex shrink-0" role="img" aria-label="Your AI agent">
      <span className="flex items-center justify-center bg-[var(--vo-agent)] text-[var(--vo-agent-ink)]" style={{ width: size, height: size, borderRadius: Math.min(8, size * 0.28) }}>
        <Sparkle size={Math.round(size * 0.56)} strokeWidth={2} aria-hidden />
      </span>
      {working !== undefined && working !== false && <span aria-hidden className={cn('absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-[var(--vo-side)]', working === true ? 'vo-pulse bg-[var(--vo-good)]' : 'bg-[var(--vo-line-2)]')} />}
    </span>
  );
}

/** "Prepared by your AI agent": a small Sparkle in an ink outline beside agent content (never solid). */
export function AgentTag({ className }: { className?: string | undefined }): React.JSX.Element {
  return (
    <span title="Prepared by your AI agent" aria-label="Prepared by your AI agent" role="img" className={cn('inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-[var(--vo-ink)] text-[var(--vo-ink)]', className)}>
      <Sparkle size={10} strokeWidth={2.2} aria-hidden />
    </span>
  );
}

/**
 * A citation: a small mono chip ("p.4") whose tooltip is the quote. With
 * `source` ({ file, page, anchor?, quote? }) it opens the one shared reader
 * at the quote (a click opens it over the page; the link is #/source for a
 * new tab). `href` is for a public URL; `onOpen` for anything else.
 */
export function Citation({ label, quote, href: link, onOpen, source }: { label: string; quote?: string | undefined; href?: string | undefined; onOpen?: (() => void) | undefined; source?: SourceRef | undefined }): React.JSX.Element {
  const ref = useRef<HTMLAnchorElement & HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const cls = 'vo-focus vo-mono hit inline-flex h-[18px] shrink-0 items-center rounded-[3px] border border-[var(--vo-line)] bg-[var(--vo-raised)] px-1 align-[1px] text-[10.5px] text-[var(--vo-ink-2)] transition-colors duration-150 hover:border-[var(--vo-ink-2)] hover:bg-[var(--vo-hover)] hover:text-[var(--vo-ink)]';
  const hover = { onMouseEnter: () => setOpen(true), onMouseLeave: () => setOpen(false), onFocus: () => setOpen(true), onBlur: () => setOpen(false) };
  const tip = quote ?? source?.quote;
  return (
    <>
      {source !== undefined ? (
        <a
          ref={ref}
          href={sourceHref(source)}
          onClick={(e) => {
            if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
            e.preventDefault();
            e.stopPropagation();
            openSource(source);
          }}
          className={cls}
          {...hover}
        >
          {label}
        </a>
      ) : link !== undefined ? (
        <a ref={ref} href={link} target={/^https?:/.test(link) ? '_blank' : undefined} rel="noreferrer" className={cls} {...hover}>
          {label}
        </a>
      ) : (
        <button ref={ref} type="button" onClick={onOpen} className={cls} {...hover}>
          {label}
        </button>
      )}
      {tip !== undefined && tip !== '' && (
        <Bubble anchor={ref} open={open}>
          {tip}
        </Bubble>
      )}
    </>
  );
}

export interface ChipOption<T extends string> {
  value: T;
  label: string;
}

interface ChipPickerBase<T extends string> {
  options: ChipOption<T>[];
  label: string;
  /** Keys 1 to 9 pick (toggle with `multiple`). */
  keys?: boolean | undefined;
  className?: string | undefined;
}

/**
 * Chips for a few choices (pass reasons, vote, alert level, criteria):
 *   one:  <ChipPicker label="Reason" options={...} value={reason} onChange={setReason} />
 *   many: <ChipPicker multiple label="Sections" options={...} value={picked} onChange={setPicked} />
 * Keys 1 to 9 pick (or toggle) when `keys`. The same family as Segmented:
 * chips sit sunk, a chosen one is raised with an ink outline and a check,
 * never solid black (the page's primary button is its one black element).
 */
export function ChipPicker<T extends string>(props: (ChipPickerBase<T> & { multiple?: false | undefined; value: T | ''; onChange: (v: T) => void }) | (ChipPickerBase<T> & { multiple: true; value: T[]; onChange: (v: T[]) => void })): React.JSX.Element {
  const { options, label, keys, className } = props;
  const isOn = (v: T): boolean => (props.multiple === true ? props.value.includes(v) : props.value === v);
  const pick = (v: T): void => {
    if (props.multiple === true) props.onChange(props.value.includes(v) ? props.value.filter((x) => x !== v) : [...props.value, v]);
    else props.onChange(v);
  };
  const pickRef = useRef(pick);
  pickRef.current = pick;
  useEffect(() => {
    if (keys !== true) return;
    const k = (e: KeyboardEvent): void => {
      const tg = e.target as HTMLElement;
      if (tg.closest('input, textarea, [contenteditable="true"]') !== null) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= options.length) {
        e.preventDefault();
        const o = options[n - 1];
        if (o !== undefined) pickRef.current(o.value);
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [keys, options]);
  const many = props.multiple === true;
  return (
    <div role={many ? 'group' : 'radiogroup'} aria-label={label} className={cn('flex flex-wrap gap-1.5', className)}>
      {options.map((o, i) => {
        const on = isOn(o.value);
        return (
          <button
            key={o.value}
            type="button"
            role={many ? 'checkbox' : 'radio'}
            aria-checked={on}
            onClick={() => pick(o.value)}
            className={cn('vo-focus vo-tap inline-flex h-8 items-center gap-1.5 rounded-[var(--vo-radius-sm)] border px-3 text-[13px] font-medium transition-[background-color,border-color,color] duration-150', on ? 'border-[var(--vo-ink)] bg-[var(--vo-raised)] text-[var(--vo-ink)] shadow-[var(--vo-shadow)] hover:bg-[var(--vo-hover)]' : 'border-[var(--vo-line)] bg-[var(--vo-sunk)] text-[var(--vo-ink-2)] hover:border-[var(--vo-line-2)] hover:bg-[var(--vo-hover)] hover:text-[var(--vo-ink)]')}
          >
            {keys === true && i < 9 && <span aria-hidden className="vo-mono hidden text-[10.5px] text-[var(--vo-muted)] md:inline">{i + 1}</span>}
            {on && <Check size={13} strokeWidth={2.2} aria-hidden />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------------- board */

export interface BoardColumn<T> {
  key: string;
  label: string;
  items: T[];
}

/** Where a card is being dragged to: the target column and its index there (counted without the card). */
interface BoardSlot {
  id: string;
  to: string;
  index: number;
  h: number;
}

/** A move the Board shows before `columns` catches up (see `onMove`). */
interface BoardPending {
  id: string;
  to: string;
  index: number;
  at: number;
  /** onMove answered a Promise that has not settled yet. */
  waiting: boolean;
  /** The Promise settled: the next `columns` change is the truth. */
  settled: boolean;
}

interface BoardDrag<T> {
  id: string;
  from: string;
  fromIndex: number;
  item: T;
  w: number;
  h: number;
  dx: number;
  dy: number;
  x: number;
  y: number;
  slot: BoardSlot | null;
  raf: number;
}

const BOARD_GAP = 6;
const BOARD_EDGE = 44;
const BOARD_HOLD_MS = 8000;

function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * A stage board (Fix 3): columns that fill the page height and scroll
 * inside, cards sorted within a column and moved between columns. Dragging
 * (mouse or pen) lifts the card under the pointer with a soft shadow; a
 * dashed placeholder shows exactly where it will land and the other cards
 * make room. Every card also has a Move menu (keyboard and touch) and
 * Alt+Arrow keys. `onMove(cardId, toColumnKey, toIndex)`: toIndex is the
 * card's index in the target column after the move (0 = top).
 */
export function Board<T>({
  columns,
  itemKey,
  renderCard,
  onMove,
  stalled,
  onOpen,
  label,
  className,
  sortable = true,
  fill = true,
  cardLabel,
}: {
  columns: BoardColumn<T>[];
  itemKey: (t: T) => string;
  renderCard: (t: T) => ReactNode;
  onMove?: ((cardId: string, toColumnKey: string, toIndex: number) => void | Promise<unknown>) | undefined;
  stalled?: ((t: T) => boolean) | undefined;
  onOpen?: ((t: T) => void) | undefined;
  label: string;
  className?: string | undefined;
  /** Cards can be reordered inside a column (default true). */
  sortable?: boolean | undefined;
  /** The board runs to the bottom of the viewport and each column scrolls inside (default true). */
  fill?: boolean | undefined;
  /** The card's name in the Move menu (default: its key). */
  cardLabel?: ((t: T) => string) | undefined;
}): React.JSX.Element {
  const root = useRef<HTMLDivElement | null>(null);
  const track = useRef<HTMLDivElement | null>(null);
  const colEls = useRef(new Map<string, HTMLElement>());
  const listEls = useRef(new Map<string, HTMLElement>());
  const cardEls = useRef(new Map<string, HTMLElement>());
  const ghost = useRef<HTMLDivElement | null>(null);
  const [slot, setSlot] = useState<BoardSlot | null>(null);
  const [pending, setPending] = useState<BoardPending | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const focusAfter = useRef('');
  const drag = useRef<BoardDrag<T> | null>(null);
  const press = useRef<{ id: string; x: number; y: number; pointer: number } | null>(null);
  const swallowClick = useRef(false);
  const canMove = onMove !== undefined;

  // Where each card sits: the props, with a move not yet confirmed laid over them.
  const view = useMemo(() => {
    const cols = columns.map((c) => ({ key: c.key, label: c.label, items: c.items.slice() }));
    if (pending !== null) {
      let card: T | undefined;
      for (const c of cols) {
        const i = c.items.findIndex((t) => itemKey(t) === pending.id);
        if (i >= 0) card = c.items.splice(i, 1)[0];
      }
      const to = cols.find((c) => c.key === pending.to);
      if (card !== undefined && to !== undefined) to.items.splice(Math.min(pending.index, to.items.length), 0, card);
    }
    return cols;
  }, [columns, pending, itemKey]);

  // The pending move ends once the props show it, its Promise failed or settled and the props changed, or after a while.
  const seen = useRef(columns);
  useEffect(() => {
    if (seen.current === columns) return;
    seen.current = columns;
    setPending((p) => {
      if (p === null) return p;
      const col = columns.find((c) => c.items.some((t) => itemKey(t) === p.id));
      if (col === undefined) return null;
      const idx = col.items.findIndex((t) => itemKey(t) === p.id);
      if (col.key === p.to && (idx === p.index || !sortable)) return null;
      return p.settled ? null : p;
    });
  }, [columns, itemKey, sortable]);
  useEffect(() => {
    if (pending === null || pending.waiting) return;
    const at = pending.at;
    const t = window.setTimeout(() => setPending((p) => (p !== null && p.at === at ? null : p)), BOARD_HOLD_MS);
    return () => window.clearTimeout(t);
  }, [pending]);

  const commit = useCallback(
    (id: string, to: string, index: number): void => {
      if (onMove === undefined) return;
      const at = Date.now();
      let answer: void | Promise<unknown>;
      try {
        answer = onMove(id, to, index);
      } catch {
        return;
      }
      const waiting = answer instanceof Promise;
      setPending({ id, to, index, at, waiting, settled: false });
      if (answer instanceof Promise)
        answer.then(
          () => setPending((p) => (p !== null && p.at === at ? { ...p, waiting: false, settled: true } : p)),
          () => setPending((p) => (p !== null && p.at === at ? null : p)),
        );
    },
    [onMove],
  );

  // Fill: from the board's top to the bottom of the page's scroller, less the page's bottom padding.
  useLayoutEffect(() => {
    if (!fill) {
      setHeight(null);
      return;
    }
    const el = root.current;
    if (el === null) return;
    const measure = (): void => {
      const main = el.closest('#vo-main');
      const body = el.closest('[data-vo-body]');
      const pad = body !== null ? parseFloat(getComputedStyle(body).paddingBottom) || 0 : 16;
      const mainTop = main !== null ? main.getBoundingClientRect().top : 0;
      const top = el.getBoundingClientRect().top - mainTop + (main !== null ? main.scrollTop : 0);
      const viewH = main !== null ? main.clientHeight : window.innerHeight;
      setHeight(Math.max(320, Math.floor(viewH - top - pad)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    const main = el.closest('#vo-main');
    if (main !== null) ro.observe(main);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [fill]);

  // The other cards make room: each one slides from where it was (150 ms; none with reduced motion).
  const tops = useRef(new Map<string, { col: string; top: number }>());
  useLayoutEffect(() => {
    const next = new Map<string, { col: string; top: number }>();
    const still = reducedMotion();
    for (const c of view)
      for (const t of c.items) {
        const id = itemKey(t);
        const el = cardEls.current.get(id);
        if (el === undefined) continue;
        const top = el.offsetTop;
        next.set(id, { col: c.key, top });
        const was = tops.current.get(id);
        if (still || was === undefined || was.col !== c.key || was.top === top || (slot === null && pending === null)) continue;
        el.style.transition = 'none';
        el.style.transform = `translateY(${was.top - top}px)`;
        void el.offsetHeight;
        el.style.transition = 'transform 150ms cubic-bezier(0.2, 0.7, 0.2, 1)';
        el.style.transform = '';
      }
    tops.current = next;
    if (focusAfter.current !== '') {
      cardEls.current.get(focusAfter.current)?.focus();
      focusAfter.current = '';
    }
  });

  /** The column and index under a pointer (client coordinates); the last one when outside every column. */
  const slotAt = (x: number, d: BoardDrag<T>, y: number): BoardSlot | null => {
    let key = '';
    let best = Infinity;
    for (const c of view) {
      const el = colEls.current.get(c.key);
      if (el === undefined) continue;
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right) {
        key = c.key;
        break;
      }
      const dist = Math.min(Math.abs(x - r.left), Math.abs(x - r.right));
      if (dist < best && dist < 48) {
        best = dist;
        key = c.key;
      }
    }
    if (key === '') return d.slot;
    const list = listEls.current.get(key);
    const col = view.find((c) => c.key === key);
    if (list === undefined || col === undefined) return d.slot;
    if (!sortable && key === d.from) return { id: d.id, to: key, index: d.fromIndex, h: d.h };
    // The pointer against each card's middle as the cards stand now (the placeholder included): stable, no jitter.
    const lr = list.getBoundingClientRect();
    const yIn = y - lr.top + list.scrollTop;
    const others = col.items.filter((t) => itemKey(t) !== d.id);
    let index = 0;
    others.forEach((t, i) => {
      const el = cardEls.current.get(itemKey(t));
      if (el === undefined) return;
      if (el.offsetTop + el.offsetHeight / 2 < yIn) index = i + 1;
    });
    return { id: d.id, to: key, index, h: d.h };
  };

  const placeGhost = (): void => {
    const d = drag.current;
    const g = ghost.current;
    if (d === null || g === null) return;
    g.style.transform = `translate(${Math.round(d.x - d.dx)}px, ${Math.round(d.y - d.dy)}px)`;
  };

  const retarget = (): void => {
    const d = drag.current;
    if (d === null) return;
    const s = slotAt(d.x, d, d.y);
    if (s !== null && (d.slot === null || s.to !== d.slot.to || s.index !== d.slot.index)) {
      d.slot = s;
      setSlot(s);
    }
  };

  // Columns and the board scroll by themselves near their edges while a card is dragged.
  const tick = (): void => {
    const d = drag.current;
    if (d === null) return;
    let moved = false;
    const b = track.current;
    if (b !== null) {
      const r = b.getBoundingClientRect();
      const left = d.x - r.left;
      const right = r.right - d.x;
      if (left < BOARD_EDGE && b.scrollLeft > 0) {
        b.scrollLeft -= Math.ceil((BOARD_EDGE - Math.max(0, left)) / 4);
        moved = true;
      } else if (right < BOARD_EDGE && b.scrollLeft < b.scrollWidth - b.clientWidth) {
        b.scrollLeft += Math.ceil((BOARD_EDGE - Math.max(0, right)) / 4);
        moved = true;
      }
    }
    const list = d.slot !== null ? listEls.current.get(d.slot.to) : undefined;
    if (list !== undefined) {
      const r = list.getBoundingClientRect();
      const top = d.y - r.top;
      const bottom = r.bottom - d.y;
      if (d.x >= r.left && d.x <= r.right) {
        if (top < BOARD_EDGE && list.scrollTop > 0) {
          list.scrollTop -= Math.ceil((BOARD_EDGE - Math.max(0, top)) / 4);
          moved = true;
        } else if (bottom < BOARD_EDGE && list.scrollTop < list.scrollHeight - list.clientHeight) {
          list.scrollTop += Math.ceil((BOARD_EDGE - Math.max(0, bottom)) / 4);
          moved = true;
        }
      }
    }
    if (moved) retarget();
    d.raf = requestAnimationFrame(tick);
  };

  const endDrag = (drop: boolean): void => {
    const d = drag.current;
    drag.current = null;
    document.body.style.removeProperty('user-select');
    document.body.style.removeProperty('cursor');
    if (d === null) return;
    cancelAnimationFrame(d.raf);
    setSlot(null);
    if (!drop || d.slot === null) return;
    const s = d.slot;
    if (s.to === d.from && (s.index === d.fromIndex || !sortable)) return;
    commit(d.id, s.to, s.index);
  };

  useEffect(() => {
    const move = (e: PointerEvent): void => {
      const p = press.current;
      if (drag.current === null && p !== null && e.pointerId === p.pointer) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 5) return;
        // Lift the card: it follows the pointer, a placeholder holds its place.
        const el = cardEls.current.get(p.id);
        const col = view.find((c) => c.items.some((t) => itemKey(t) === p.id));
        press.current = null;
        if (el === undefined || col === undefined) return;
        const r = el.getBoundingClientRect();
        const fromIndex = col.items.findIndex((t) => itemKey(t) === p.id);
        const item = col.items[fromIndex];
        if (item === undefined) return;
        const start: BoardSlot = { id: p.id, to: col.key, index: fromIndex, h: r.height };
        drag.current = { id: p.id, from: col.key, fromIndex, item, w: r.width, h: r.height, dx: p.x - r.left, dy: p.y - r.top, x: e.clientX, y: e.clientY, slot: start, raf: 0 };
        swallowClick.current = true;
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'grabbing';
        setSlot(start);
        drag.current.raf = requestAnimationFrame(tick);
        return;
      }
      const d = drag.current;
      if (d === null) return;
      e.preventDefault();
      d.x = e.clientX;
      d.y = e.clientY;
      placeGhost();
      retarget();
    };
    const up = (): void => {
      press.current = null;
      if (drag.current !== null) endDrag(true);
      // The click that follows a drop (or a drag cancelled with Escape) never opens the card; the next one does.
      if (swallowClick.current)
        window.setTimeout(() => {
          swallowClick.current = false;
        }, 0);
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && drag.current !== null) {
        e.stopPropagation();
        endDrag(false);
      }
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('keydown', key, true);
    };
  });
  useLayoutEffect(placeGhost, [slot]);
  useEffect(
    () => () => {
      if (drag.current !== null) cancelAnimationFrame(drag.current.raf);
      document.body.style.removeProperty('user-select');
      document.body.style.removeProperty('cursor');
    },
    [],
  );

  const name = (t: T): string => (cardLabel !== undefined ? cardLabel(t) : itemKey(t));
  const moveBy = (id: string, colIndex: number, index: number, dCol: number, dIndex: number): void => {
    const target = view[colIndex + dCol];
    if (target === undefined) return;
    if (dCol === 0) {
      if (!sortable) return;
      const to = index + dIndex;
      if (to < 0 || to >= target.items.length) return;
      focusAfter.current = id;
      commit(id, target.key, to);
      return;
    }
    focusAfter.current = id;
    commit(id, target.key, sortable ? Math.min(index, target.items.length) : 0);
  };

  const dragging = slot !== null ? slot.id : '';
  const dragItem = slot !== null ? drag.current?.item : undefined;
  const placeholder = (h: number): React.JSX.Element => <div key="__slot" aria-hidden data-vo-board-slot="" className="shrink-0 rounded-[var(--vo-radius-sm)] border border-dashed border-[var(--vo-line-2)] bg-[var(--vo-hover)] shadow-[inset_0_1px_3px_rgb(0_0_0/0.08)]" style={{ height: h }} />;
  return (
    <div ref={root} className={cn('min-w-0', className)} style={height !== null ? { height } : undefined}>
      <div ref={track} data-vo-board-track="" role="list" aria-label={label} className={cn('vo-scroll flex min-w-0 gap-3 overflow-x-auto', height !== null ? 'h-full pb-1' : 'pb-2')}>
        {view.map((c, ci) => {
          const over = slot !== null && slot.to === c.key;
          const shown = c.items.filter((t) => itemKey(t) !== dragging);
          const count = shown.length + (over ? 1 : 0);
          const others = view.filter((x) => x.key !== c.key);
          const cards: ReactNode[] = [];
          shown.forEach((t, i) => {
            if (over && slot.index === i) cards.push(placeholder(slot.h));
            const id = itemKey(t);
            const stall = stalled?.(t) === true;
            const idx = c.items.findIndex((x) => itemKey(x) === id);
            cards.push(
              <div
                key={id}
                ref={(el) => {
                  if (el === null) cardEls.current.delete(id);
                  else cardEls.current.set(id, el);
                }}
                role={onOpen !== undefined ? 'button' : undefined}
                tabIndex={onOpen !== undefined || canMove ? 0 : undefined}
                aria-label={cardLabel !== undefined ? name(t) : undefined}
                data-vo-board-card={id}
                onPointerDown={(e) => {
                  if (!canMove || e.button !== 0 || e.pointerType === 'touch') return;
                  if ((e.target as HTMLElement).closest('button, input, textarea, select, [contenteditable="true"], [data-vo-nodrag]') !== null) return;
                  press.current = { id, x: e.clientX, y: e.clientY, pointer: e.pointerId };
                }}
                onClickCapture={(e) => {
                  if (!swallowClick.current) return;
                  swallowClick.current = false;
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={onOpen !== undefined ? () => onOpen(t) : undefined}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === 'Enter' && onOpen !== undefined) {
                    e.preventDefault();
                    onOpen(t);
                    return;
                  }
                  if (!canMove || !e.altKey) return;
                  const dir = e.key === 'ArrowUp' ? [0, -1] : e.key === 'ArrowDown' ? [0, 1] : e.key === 'ArrowLeft' ? [-1, 0] : e.key === 'ArrowRight' ? [1, 0] : null;
                  if (dir === null) return;
                  e.preventDefault();
                  moveBy(id, ci, idx, dir[0] ?? 0, dir[1] ?? 0);
                }}
                className={cn(
                  'vo-focus vo-wrap vo-board-card group relative shrink-0 rounded-[var(--vo-radius-sm)] border border-[var(--vo-line)] bg-[var(--vo-raised)] px-3 py-2 text-[13px] transition-colors duration-150',
                  (onOpen !== undefined || canMove) && 'cursor-pointer hover:border-[var(--vo-line-2)] hover:bg-[var(--vo-hover)]',
                  stall && 'border-l-2 border-l-[var(--vo-warn)]',
                )}
              >
                {renderCard(t)}
                {canMove && slot === null && (others.length > 0 || (sortable && c.items.length > 1)) && (
                  <span
                    className="hover-only absolute right-1 top-1 rounded-[var(--vo-radius-sm)] bg-[var(--vo-hover)] opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100 group-focus-visible:opacity-100 has-[[aria-expanded=true]]:opacity-100"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <Menu icon={Move} label={`Move ${name(t)}`} width={220} onRow>
                      {(close) => (
                        <>
                          {sortable && idx > 0 && (
                            <MenuItem icon={ArrowUp} hint="Alt Up" onClick={() => (close(), moveBy(id, ci, idx, 0, -1))}>
                              Move up
                            </MenuItem>
                          )}
                          {sortable && idx < c.items.length - 1 && (
                            <MenuItem icon={ArrowDown} hint="Alt Down" onClick={() => (close(), moveBy(id, ci, idx, 0, 1))}>
                              Move down
                            </MenuItem>
                          )}
                          {sortable && c.items.length > 1 && others.length > 0 && <MenuSep />}
                          {others.length > 0 && <MenuLabel>Move to</MenuLabel>}
                          {others.map((o) => (
                            <MenuItem
                              key={o.key}
                              onClick={() => {
                                close();
                                focusAfter.current = id;
                                commit(id, o.key, 0);
                              }}
                            >
                              {o.label}
                            </MenuItem>
                          ))}
                        </>
                      )}
                    </Menu>
                  </span>
                )}
              </div>,
            );
          });
          if (over && slot.index >= shown.length) cards.push(placeholder(slot.h));
          return (
            <section
              key={c.key}
              ref={(el) => {
                if (el === null) colEls.current.delete(c.key);
                else colEls.current.set(c.key, el);
              }}
              role="listitem"
              aria-label={c.label}
              className={cn('flex w-[264px] shrink-0 flex-col rounded-[var(--vo-radius)] border transition-colors duration-150', height !== null && 'min-h-0', over ? 'border-[var(--vo-line-2)] bg-[var(--vo-hover)]' : 'border-transparent bg-[var(--vo-sunk)]')}
            >
              <header className="flex h-9 shrink-0 items-center gap-2 px-3">
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{c.label}</span>
                <span className="vo-mono vo-num text-[12px] text-[var(--vo-muted)]" title={`${count} in ${c.label}`}>
                  {count}
                </span>
              </header>
              <div
                ref={(el) => {
                  if (el === null) listEls.current.delete(c.key);
                  else listEls.current.set(c.key, el);
                }}
                className={cn('vo-scroll relative flex min-h-12 flex-col px-2 pb-2', height !== null && 'min-h-0 flex-1 overflow-y-auto')}
                style={{ gap: BOARD_GAP }}
              >
                {cards}
              </div>
            </section>
          );
        })}
      </div>
      {dragItem !== undefined &&
        createPortal(
          <div ref={ghost} data-vo-board-ghost="" aria-hidden className="pointer-events-none fixed left-0 top-0 z-[95]" style={{ width: drag.current?.w ?? 0 }}>
            <div className="vo-wrap relative rounded-[var(--vo-radius-sm)] border border-[var(--vo-line-2)] bg-[var(--vo-raised)] px-3 py-2 text-[13px] text-[var(--vo-ink)] shadow-[var(--vo-shadow-lg)]">{renderCard(dragItem)}</div>
          </div>,
          document.body,
        )}
    </div>
  );
}

/* --------------------------------------------------------------- the page */

/** The shell's tools at the right of the page header (search, Next, notifications) and the phone menu. */
const ToolsCtx = createContext<{ tools: ReactNode; openMenu: (() => void) | null }>({ tools: null, openMenu: null });
export const HeaderToolsProvider = ToolsCtx.Provider;

function actionCount(children: ReactNode): number {
  let n = 0;
  const walk = (c: ReactNode): void => {
    if (c === null || c === undefined || c === false || c === true || c === '') return;
    if (Array.isArray(c)) {
      for (const x of c) walk(x);
      return;
    }
    const el = c as { type?: unknown; props?: { children?: ReactNode } };
    if (el.type === Symbol.for('react.fragment')) {
      walk(el.props?.children);
      return;
    }
    n++;
  };
  walk(children);
  return n;
}

/**
 * The top bar of every page (SPEC 3): the title (15px semibold, nothing
 * under or beside it), the page's actions on the right (one black primary),
 * then the shell's search, Next count and notifications. On a phone, more
 * than one action folds behind "More".
 */
export function PageHeader({ title, children, back, backOnPhone }: { title: ReactNode; children?: ReactNode; back?: string | undefined; backOnPhone?: boolean | undefined }): React.JSX.Element {
  const { tools, openMenu } = useContext(ToolsCtx);
  const n = actionCount(children);
  return (
    <header data-vo-chrome="" className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-[var(--vo-hair)] bg-[var(--vo-page)] px-3 md:px-6">
      {openMenu !== null && <IconButton icon={MenuLines} label="Menu" onClick={openMenu} className="-ml-1 md:hidden" size={34} />}
      {back !== undefined && (
        <a href={back} aria-label="Back" title="Back" className={cn(backOnPhone === true && 'md:hidden', 'vo-focus vo-tap-sq -ml-1 flex size-8 shrink-0 items-center justify-center rounded-[var(--vo-radius-sm)] text-[var(--vo-ink-2)] transition-colors duration-150 hover:bg-[var(--vo-hover)] hover:text-[var(--vo-ink)]')}>
          <ChevronLeft size={18} aria-hidden />
        </a>
      )}
      <h1 className="vo-wrap min-w-0 flex-1 truncate text-[15px] font-semibold leading-5 tracking-[-0.01em]">{title}</h1>
      {n > 0 && <HeaderActions many={n > 1}>{children}</HeaderActions>}
      {tools !== null && <div className="flex shrink-0 items-center gap-0.5 border-l border-[var(--vo-hair)] pl-2">{tools}</div>}
    </header>
  );
}

function HeaderActions({ children, many }: { children: ReactNode; many: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent): void => {
      const tg = e.target as HTMLElement;
      if (box.current?.contains(tg) || tg.closest?.('[data-vo-popover]') !== null) return;
      setOpen(false);
    };
    window.addEventListener('pointerdown', down, true);
    return () => window.removeEventListener('pointerdown', down, true);
  }, [open]);
  if (!many) return <div className="flex shrink-0 items-center gap-2">{children}</div>;
  return (
    <div ref={box} className="relative flex min-w-0 shrink-0 items-center">
      <IconButton icon={MoreHorizontal} label="More" active={open} onClick={() => setOpen((v) => !v)} aria-expanded={open} className="md:hidden" />
      <div
        onClickCapture={(e) => {
          const tg = e.target as HTMLElement;
          if (tg.closest('button, a') !== null && tg.closest('[aria-haspopup]') === null) window.setTimeout(() => setOpen(false), 0);
        }}
        className={cn('md:flex md:items-center md:gap-2', open ? 'max-md:absolute max-md:right-0 max-md:top-full max-md:z-40 max-md:mt-1.5 max-md:flex max-md:w-max max-md:min-w-[200px] max-md:flex-col max-md:items-stretch max-md:gap-1.5 max-md:rounded-[var(--vo-radius)] max-md:border max-md:border-[var(--vo-line)] max-md:bg-[var(--vo-raised)] max-md:p-1.5 max-md:shadow-[var(--vo-shadow-lg)]' : 'max-md:hidden')}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * The page body with the standard gutters: 12px between blocks (--vo-gap; a module's own gap-5 and gap-6
 * grids inside follow it, theme.css), 16px on top, 20px at the sides and bottom (16px sides and room for the
 * bottom bar on phones).
 */
export function PageBody({ children, className, wide }: { children: ReactNode; className?: string | undefined; wide?: boolean | undefined }): React.JSX.Element {
  return <div data-vo-body="" className={cn('mx-auto flex w-full flex-col gap-3 px-4 pb-24 pt-4 md:px-5 md:pb-5', wide === true ? '' : 'max-w-[1440px]', className)}>{children}</div>;
}

/* ------------------------------------------------------------------ table */

export interface Column<R> {
  key: string;
  label: ReactNode;
  /** CSS grid track: 'minmax(180px,2fr)' or '120px'. Default 'minmax(0,1fr)'. */
  width?: string | undefined;
  align?: 'left' | 'right' | 'center' | undefined;
  /** Mono tabular figures (right-align numbers). */
  mono?: boolean | undefined;
  sort?: ((r: R) => string | number) | undefined;
  render: (r: R) => ReactNode;
  /** Hidden until the column picker shows it. */
  optional?: boolean | undefined;
  /** Cannot be hidden (the name column). */
  fixed?: boolean | undefined;
  /** On phones: 'title', 'sub' (default), 'end' or 'hide'. */
  phone?: 'title' | 'sub' | 'end' | 'hide' | undefined;
}

/** A saved view as views.list answers it (config holds the table's and the page's state). */
export interface SavedView {
  id: string;
  name: string;
  config: Record<string, unknown>;
  shared?: boolean | undefined;
  mine?: boolean | undefined;
}

export interface DataTableProps<R> {
  columns: Column<R>[];
  rows: R[];
  rowKey: (r: R) => string;
  onRowClick?: ((r: R) => void) | undefined;
  rowHref?: ((r: R) => string) | undefined;
  selectable?: boolean | undefined;
  selected?: Set<string> | undefined;
  onSelect?: ((next: Set<string>) => void) | undefined;
  selectionBar?: ((ids: string[], clear: () => void) => ReactNode) | undefined;
  empty?: ReactNode;
  onMore?: (() => void) | undefined;
  hasMore?: boolean | undefined;
  loadingMore?: boolean | undefined;
  initialSort?: { key: string; dir: 'asc' | 'desc' } | undefined;
  stickyTop?: number | undefined;
  label: string;
  className?: string | undefined;
  /** Remembers the visible columns per browser and saves named views (views.* ops) under this scope. */
  viewScope?: string | undefined;
  /** The page's own view state (filters) saved with a view and given back when one is applied. */
  viewState?: Record<string, unknown> | undefined;
  onApplyView?: ((state: Record<string, unknown>) => void) | undefined;
  /** Rows leaving fold away (their keys). */
  leaving?: Set<string> | undefined;
  foot?: ReactNode;
}

function blank(v: ReactNode): boolean {
  return v === null || v === undefined || v === false || v === true || v === '' || (Array.isArray(v) && v.every(blank));
}

/**
 * A table: 36px rows carrying data, a sticky header, sortable columns, a
 * column picker and saved views in one menu, selection with a bar, scroll
 * pagination (never "Show more"). Below 768px it becomes stacked rows.
 */
export function DataTable<R>({ columns, rows, rowKey, onRowClick, rowHref, selectable, selected, onSelect, selectionBar, empty, onMore, hasMore, loadingMore, initialSort, stickyTop = 56, label, className, viewScope, viewState, onApplyView, leaving, foot }: DataTableProps<R>): React.JSX.Element {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(initialSort ?? null);
  const [hidden, setHidden] = useState<string[]>(() => (viewScope !== undefined ? remember<string[] | null>(`cols.${viewScope}`, null) : null) ?? columns.filter((c) => c.optional === true).map((c) => c.key));
  const sentinel = useRef<HTMLDivElement | null>(null);
  const cols = columns.filter((c) => !hidden.includes(c.key));
  const sorted = useMemo(() => {
    if (sort === null) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (col?.sort === undefined) return rows;
    const f = col.sort;
    return [...rows].sort((a, b) => {
      const x = f(a);
      const y = f(b);
      const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
      return sort.dir === 'asc' ? r : -r;
    });
  }, [rows, sort, columns]);
  useEffect(() => {
    const el = sentinel.current;
    if (el === null || onMore === undefined || hasMore !== true) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && loadingMore !== true) onMore();
    }, { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [onMore, hasMore, loadingMore, rows.length]);
  const setCols = (next: string[]): void => {
    setHidden(next);
    if (viewScope !== undefined) keep(`cols.${viewScope}`, next);
  };

  const sel = selected ?? new Set<string>();
  const ids = sorted.map(rowKey);
  const allOn = ids.length > 0 && ids.every((id) => sel.has(id));
  const someOn = ids.some((id) => sel.has(id));
  const toggle = (id: string): void => {
    const next = new Set(sel);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelect?.(next);
  };
  const opens = onRowClick !== undefined || rowHref !== undefined;
  const tracks = (selectable === true ? '36px ' : '') + cols.map((c) => c.width ?? 'minmax(0,1fr)').join(' ') + (viewScope !== undefined ? ' 32px' : opens ? ' 16px' : '');
  const titleCol = columns.find((c) => c.phone === 'title') ?? columns[0];
  const endCol = columns.find((c) => c.phone === 'end');
  const subCols = cols.filter((c) => c !== titleCol && c !== endCol && c.phone !== 'hide');

  if (rows.length === 0 && empty !== undefined) return <div className={className}>{empty}</div>;

  return (
    <div className={cn('min-w-0', className)} role="table" aria-label={label}>
      <div className="hidden md:block">
        <div role="row" className="sticky z-10 grid h-8 items-center border-b border-[var(--vo-line)] bg-[var(--vo-panel)] px-2" style={{ top: stickyTop, gridTemplateColumns: tracks }}>
          {selectable === true && (
            <span className="flex items-center justify-center" role="columnheader">
              <Checkbox checked={allOn} indeterminate={!allOn && someOn} onChange={(v) => onSelect?.(v ? new Set([...sel, ...ids]) : new Set([...sel].filter((x) => !ids.includes(x))))} label="Select all" hideLabel />
            </span>
          )}
          {cols.map((c) => {
            const on = sort?.key === c.key;
            const content = (
              <>
                <span className="truncate">{c.label}</span>
                {on && (sort?.dir === 'asc' ? <ArrowUp size={11} aria-hidden /> : <ArrowDown size={11} aria-hidden />)}
              </>
            );
            return (
              <span key={c.key} role="columnheader" aria-sort={on ? (sort?.dir === 'asc' ? 'ascending' : 'descending') : undefined} className={cn('flex min-w-0 items-center px-2 text-[12px] font-medium text-[var(--vo-muted)]', c.align === 'right' || c.mono === true ? 'justify-end text-right' : c.align === 'center' ? 'justify-center' : '')}>
                {c.sort !== undefined ? (
                  <button type="button" onClick={() => setSort(on ? { key: c.key, dir: sort?.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: c.mono === true ? 'desc' : 'asc' })} className={cn('vo-focus -mx-1 inline-flex min-w-0 items-center gap-1 rounded-[3px] px-1 py-0.5 transition-colors duration-150 hover:bg-[var(--vo-hover)] hover:text-[var(--vo-ink)]', on && 'text-[var(--vo-ink)]')}>
                    {content}
                  </button>
                ) : (
                  content
                )}
              </span>
            );
          })}
          {viewScope !== undefined ? <ViewsMenu scope={viewScope} columns={columns} hidden={hidden} setHidden={setCols} sort={sort} setSort={setSort} state={viewState} onApply={onApplyView} /> : opens ? <span aria-hidden /> : null}
        </div>
        {sorted.map((r) => {
          const id = rowKey(r);
          const on = sel.has(id);
          const cells = (
            <>
              {selectable === true && (
                <span className="flex items-center justify-center" role="cell">
                  <Checkbox checked={on} onChange={() => toggle(id)} label="Select" hideLabel />
                </span>
              )}
              {cols.map((c) => (
                <span key={c.key} role="cell" className={cn('flex min-w-0 items-center px-2 text-[13px]', c.align === 'right' || c.mono === true ? 'justify-end text-right' : c.align === 'center' ? 'justify-center' : '', c.mono === true && 'vo-mono vo-num')}>
                  <span className="min-w-0 truncate">{c.render(r)}</span>
                </span>
              ))}
              {(viewScope !== undefined || opens) && <span aria-hidden />}
            </>
          );
          const cls = cn('vo-tap group grid h-9 items-center border-b border-[var(--vo-hair)] px-2 transition-colors duration-150 last:border-b-0', opens && 'cursor-pointer hover:bg-[var(--vo-hover)]', on && 'bg-[var(--vo-active)] hover:bg-[var(--vo-active-hover)]');
          const row =
            rowHref !== undefined ? (
              <a role="row" href={rowHref(r)} className={cn(cls, 'vo-focus')} style={{ gridTemplateColumns: tracks }}>
                {cells}
              </a>
            ) : (
              <div role="row" tabIndex={opens ? 0 : undefined} onClick={() => onRowClick?.(r)} onKeyDown={(e) => e.key === 'Enter' && onRowClick?.(r)} className={cn(cls, opens && 'vo-focus')} style={{ gridTemplateColumns: tracks }}>
                {cells}
              </div>
            );
          return (
            <div key={id} className="vo-fold" data-gone={leaving?.has(id) === true}>
              <div>{row}</div>
            </div>
          );
        })}
        {foot !== undefined && <div className="border-t border-[var(--vo-line)] bg-[var(--vo-sunk)] px-2">{foot}</div>}
      </div>
      <PhoneList label={label}>
        {sorted.map((r) => {
          const id = rowKey(r);
          const subs = subCols.map((c) => ({ c, v: c.render(r) })).filter((x) => !blank(x.v));
          return (
            <PhoneRow key={id} href={rowHref?.(r)} onClick={onRowClick !== undefined ? () => onRowClick(r) : undefined} on={sel.has(id)} end={endCol !== undefined ? <span className={cn('text-[13px]', endCol.mono === true && 'vo-mono vo-num')}>{endCol.render(r)}</span> : undefined}>
              <div className="vo-wrap text-[14px] font-medium">{titleCol?.render(r)}</div>
              {subs.length > 0 && (
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-[var(--vo-muted)]">
                  {subs.map(({ c, v }) => (
                    <span key={c.key} className={cn('min-w-0 max-w-full truncate', c.mono === true && 'vo-mono vo-num')}>
                      {v}
                    </span>
                  ))}
                </div>
              )}
            </PhoneRow>
          );
        })}
      </PhoneList>
      {hasMore === true && (
        <div ref={sentinel} className="flex h-12 items-center justify-center text-[var(--vo-muted)]">
          {loadingMore === true && <Spinner />}
        </div>
      )}
      {selectable === true && sel.size > 0 && selectionBar !== undefined && (
        <div className="vo-fade fixed bottom-[calc(72px+env(safe-area-inset-bottom))] left-1/2 z-40 flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-2 rounded-[var(--vo-radius)] border border-[var(--vo-line)] bg-[var(--vo-raised)] py-1.5 pl-3 pr-1.5 shadow-[var(--vo-shadow-lg)] md:bottom-6">
          <span className="vo-mono vo-num shrink-0 whitespace-nowrap text-[12px]">{sel.size}</span>
          <span className="h-5 w-px bg-[var(--vo-hair)]" />
          {selectionBar([...sel], () => onSelect?.(new Set()))}
          <IconButton icon={X} label="Clear selection" onClick={() => onSelect?.(new Set())} size={28} />
        </div>
      )}
    </div>
  );
}

/** The table's one menu: show or hide columns, and the person's saved views (views.list, views.save, views.delete). */
function ViewsMenu<R>({ scope, columns, hidden, setHidden, sort, setSort, state, onApply }: { scope: string; columns: Column<R>[]; hidden: string[]; setHidden: (h: string[]) => void; sort: { key: string; dir: 'asc' | 'desc' } | null; setSort: (s: { key: string; dir: 'asc' | 'desc' } | null) => void; state?: Record<string, unknown> | undefined; onApply?: ((s: Record<string, unknown>) => void) | undefined }): React.JSX.Element {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const views = useOp<{ views: SavedView[] }>('views.list', { page: scope }, ['saved_views'], { name: `views.${scope}`, skip: !open });
  const apply = (v: SavedView): void => {
    const st = v.config;
    if (Array.isArray(st['hidden'])) setHidden(st['hidden'] as string[]);
    const s = st['sort'] as { key: string; dir: 'asc' | 'desc' } | null | undefined;
    setSort(s ?? null);
    onApply?.((st['page'] as Record<string, unknown> | undefined) ?? {});
    setOpen(false);
  };
  const save = async (): Promise<void> => {
    const n = name.trim();
    if (n === '') return;
    const draft = { id: `tmp_${Date.now()}`, name: n, config: { hidden, sort, page: state ?? {} } };
    await act([insert('views', draft)], () => op('views.save', { page: scope, name: n, config: draft.config }), ['saved_views']);
    setNaming(false);
    setName('');
  };
  return (
    <>
      <IconButton ref={ref} icon={Columns3} label="Columns and views" size={26} active={open} onClick={() => setOpen((v) => !v)} aria-haspopup="menu" />
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} align="end" width={240} label="Columns and views">
        <MenuLabel>Columns</MenuLabel>
        {columns
          .filter((c) => c.fixed !== true)
          .map((c) => (
            <MenuItem key={c.key} selected={!hidden.includes(c.key)} onClick={() => setHidden(hidden.includes(c.key) ? hidden.filter((x) => x !== c.key) : [...hidden, c.key])}>
              {typeof c.label === 'string' && c.label !== '' ? c.label : c.key}
            </MenuItem>
          ))}
        <MenuSep />
        <MenuLabel>Views</MenuLabel>
        {(views.data?.views ?? []).filter((v) => v.mine !== false).map((v) => (
          <div key={v.id} className="group flex items-center">
            <div className="min-w-0 flex-1">
              <MenuItem icon={Bookmark} onClick={() => apply(v)}>
                {v.name}
              </MenuItem>
            </div>
            <IconButton icon={Trash2} label="Delete view" size={26} tone="danger" className="hover-only opacity-0 group-hover:opacity-100" onClick={() => void act([dropEdit(v.id)], () => op('views.delete', { view: v.id }), ['saved_views'])} />
          </div>
        ))}
        {naming ? (
          <div className="flex items-center gap-1 p-1">
            <Input value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} placeholder="View name" aria-label="View name" className="h-7" />
            <Button size="sm" variant="primary" onClick={() => void save()} disabled={name.trim() === ''}>
              Save
            </Button>
          </div>
        ) : (
          <MenuItem onClick={() => setNaming(true)}>Save this view</MenuItem>
        )}
      </Popover>
    </>
  );
}

/** Stacked rows for phones (Store OS PhoneList): shown below 768px only. */
export function PhoneList({ children, label }: { children: ReactNode; label?: string | undefined }): React.JSX.Element {
  return (
    <ul aria-label={label} className="md:hidden">
      {children}
    </ul>
  );
}

export function PhoneRow({ children, onClick, href: link, on, lead, end }: { children: ReactNode; onClick?: (() => void) | undefined; href?: string | undefined; on?: boolean | undefined; lead?: ReactNode; end?: ReactNode }): React.JSX.Element {
  const cls = cn('flex min-h-14 items-center gap-3 border-b border-[var(--vo-hair)] px-4 py-2.5 transition-colors duration-150', (onClick !== undefined || link !== undefined) && 'cursor-pointer hover:bg-[var(--vo-hover)]', on === true && 'bg-[var(--vo-active)]');
  const inner = (
    <>
      {lead}
      <div className="min-w-0 flex-1">{children}</div>
      {end}
    </>
  );
  return (
    <li>
      {link !== undefined ? (
        <a href={link} className={cn(cls, 'vo-focus')}>
          {inner}
        </a>
      ) : (
        <div onClick={onClick} className={cls}>
          {inner}
        </div>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ files */

/** A drop zone with a button (one short label). */
export function FileDrop({ onFiles, accept, label, multiple, className, children }: { onFiles: (files: File[]) => void; accept?: string | undefined; label: string; multiple?: boolean | undefined; className?: string | undefined; children?: ReactNode }): React.JSX.Element {
  const ref = useRef<HTMLInputElement | null>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      data-vo-drop=""
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) onFiles(multiple === true ? files : files.slice(0, 1));
      }}
      className={cn('flex flex-col items-center justify-center gap-3 rounded-[var(--vo-radius)] border border-dashed px-4 py-6 text-center transition-colors duration-150', over ? 'border-[var(--vo-ink-2)] bg-[var(--vo-hover)]' : 'border-[var(--vo-line-2)]', className)}
    >
      {children}
      <Button icon={Upload} onClick={() => ref.current?.click()}>
        {label}
      </Button>
      <input
        ref={ref}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length > 0) onFiles(files);
        }}
      />
    </div>
  );
}

/**
 * A titled block inside a card, panel or sheet: its title row (the short mono label at the top left, an optional
 * `aside` at the right of the same row: one small action, a count or the source, e.g. "Source: email"; an optional
 * `tip` on a ? beside the title), then its content. Put consecutive sections in <Sections> and each one is separated
 * from the next by a full-width hairline divider (Fix 4, the owner's divider rule).
 */
export function Section({ title, aside, children, className, tip }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string | undefined; tip?: string | undefined }): React.JSX.Element {
  const head = (title !== undefined && title !== null && title !== '') || (aside !== undefined && aside !== null && aside !== false);
  return (
    <section className={cn('min-w-0', className)} data-vo-section="">
      {head && (
        <div className="mb-2 flex min-h-7 min-w-0 items-center gap-2">
          <h3 className="vo-label flex min-w-0 flex-1 items-center gap-1.5">
            <span className="min-w-0 truncate">{title}</span>
            {tip !== undefined && <Hint text={tip} />}
          </h3>
          {aside !== undefined && aside !== null && aside !== false && <div className="ml-auto flex min-w-0 shrink-0 items-center justify-end gap-1.5 text-[12px] leading-4 text-[var(--vo-muted)]">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * Sections stacked in a card (Fix 4): each child (a <Section>, or any block) is separated from the next by a
 * full-width hairline divider, so a person sees at once which content belongs to which section.
 *
 *   pad="card"   the card's own body: each section keeps 16px top and bottom and the card's side padding (20px,
 *                24px from md), and the dividers run edge to edge (put it directly in a card with no padding);
 *   pad="flush"  inside a body that already has side padding: 16px above and below, the dividers span the content;
 *   pad="tight"  a dense stack (a column of figures): 10px above and below, no side padding.
 */
export function Sections({ children, className, pad = 'card', label }: { children: ReactNode; className?: string | undefined; pad?: 'card' | 'flush' | 'tight' | undefined; label?: string | undefined }): React.JSX.Element {
  return (
    <div className={cn('vo-sections flex min-w-0 flex-col', className)} data-pad={pad} aria-label={label} role={label !== undefined ? 'group' : undefined}>
      {children}
    </div>
  );
}

/** A heading inside a page (a Settings section, a tab): the title (15px) and its actions on the right, nothing under it. */
export function SubHeader({ title, children, className }: { title: ReactNode; children?: ReactNode; className?: string | undefined }): React.JSX.Element {
  return (
    <div className={cn('flex min-h-9 flex-wrap items-center gap-2', className)}>
      <h2 className="vo-wrap min-w-0 flex-1 text-[15px] font-semibold leading-5">{title}</h2>
      {children !== undefined && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/** The fields beyond the first three, behind "More" (U6). */
export function More({ children, label = 'More', defaultOpen, className }: { children: ReactNode; label?: string | undefined; defaultOpen?: boolean | undefined; className?: string | undefined }): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen === true);
  return (
    <div className={cn('flex min-w-0 flex-col gap-4', className)}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="vo-focus vo-tap -ml-1 inline-flex h-7 items-center gap-1 self-start rounded-[var(--vo-radius-sm)] px-1 text-[12px] font-medium text-[var(--vo-ink-2)] transition-colors duration-150 hover:bg-[var(--vo-hover)] hover:text-[var(--vo-ink)]">
        {open ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
        {label}
      </button>
      {open && children}
    </div>
  );
}

/** A percent field; the value is millionths (_ppm): "2" means 20000, "0.5" means 5000. */
export function PctInput({ value, onChange, label, className, disabled }: { value: number | null; onChange: (ppm: number | null) => void; label: string; className?: string | undefined; disabled?: boolean | undefined }): React.JSX.Element {
  const show = (v: number | null): string => (v === null ? '' : String(Math.round(v / 100) / 100));
  const [text, setText] = useState(show(value));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(show(value));
    }
  }, [value]);
  const bad = text.trim() !== '' && !/^\d+(\.\d{1,4})?$/.test(text.trim());
  return (
    <span className={cn('relative inline-flex w-28', className)}>
      <input
        value={text}
        disabled={disabled}
        inputMode="decimal"
        aria-label={label}
        aria-invalid={bad}
        onChange={(e) => {
          setText(e.target.value);
          const t = e.target.value.trim();
          const v = t === '' ? null : /^\d+(\.\d{1,4})?$/.test(t) ? Math.round(Number(t) * 10000) : null;
          last.current = v;
          onChange(v);
        }}
        className={cn(FIELD, 'vo-mono vo-num h-8 pl-2.5 pr-7 text-right text-[13px]')}
      />
      <span className="vo-mono pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] text-[var(--vo-muted)]">%</span>
    </span>
  );
}

/** Around a part whose code loads on demand (a lazyPage tab or panel): a quiet placeholder while it comes. */
export function LazyBoundary({ children, className }: { children: ReactNode; className?: string | undefined }): React.JSX.Element {
  return <Suspense fallback={<Skeleton className={cn('h-24 w-full', className)} />}>{children}</Suspense>;
}
