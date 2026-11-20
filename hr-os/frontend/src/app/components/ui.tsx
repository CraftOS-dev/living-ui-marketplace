/**
 * HR OS controls, in the instrument language of Piano Coach: 32px controls
 * with small corners, hairline borders, an ink primary button, quiet ghost
 * icons, mono readout labels and thin mono numerals, a centred dialog and a
 * sheet docked on the right. Menus and popovers are portaled and stay inside
 * the window. Every module builds its pages from these; do not add a second
 * design system. The props of each component are documented in
 * reference/notes/kernel-frontend.md.
 */
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, ArrowDown, ArrowUp, Building2, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, CircleHelp, Loader2, Lock, Menu as MenuLines, MoreHorizontal, Pencil, Search, Sparkle, X } from 'lucide-react';
import { cn, getPbClient } from '../../kit/index.ts';
import { op, setPinAsker } from '../lib/api.ts';
import { useSession } from '../lib/auth.tsx';
import type { PinAsk } from '../lib/api.ts';
import type { ProfileFact } from '../lib/contract.ts';
import type { EntityRef } from '../lib/types.ts';
import { addDays, dateOf, dateOrder, dayKey, fmtDay, fmtRange, initials, isDay, monthName, startOfMonth } from '../lib/format.ts';
import { t } from '../lib/i18n.ts';
import { currenciesVersion, exponent, formatMoney, moneyInputText, parseMoney, showCurrency, subscribeCurrencies } from '../lib/money.ts';
import type { MoneyDisplay, MoneyFormat } from '../lib/money.ts';
import { useUi } from '../lib/store.tsx';
import { subscribeToasts, toast } from '../lib/toast.ts';
import type { Note } from '../lib/toast.ts';

export { toast };

/* ---------------------------------------------------------------- buttons */

type Variant = 'primary' | 'default' | 'ghost' | 'danger' | 'agent';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant | undefined;
  size?: 'sm' | 'md' | 'lg' | undefined;
  icon?: LucideIcon | undefined;
  iconRight?: LucideIcon | undefined;
  busy?: boolean | undefined;
  ref?: React.Ref<HTMLButtonElement> | undefined;
}

export function Button({ variant = 'default', size = 'md', icon: Icon, iconRight: IconRight, children, className, busy, ...rest }: ButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled === true || busy === true}
      className={cn(
        'hr-focus hr-tap inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--hr-radius-sm)] font-medium transition-[background-color,color,filter,border-color] active:translate-y-[0.5px] disabled:cursor-default disabled:opacity-45',
        size === 'sm' ? 'h-7 px-2.5 text-[12px]' : size === 'lg' ? 'h-10 px-4 text-[14px]' : 'h-8 px-3 text-[13px]',
        (variant === 'primary' || variant === 'agent') && 'bg-[var(--hr-ink)] text-[var(--hr-on-ink)] hover:brightness-[1.3] dark:hover:brightness-[0.86]',
        variant === 'default' && 'border border-[var(--hr-line)] bg-[var(--hr-raised)] text-[var(--hr-ink)] hover:border-[var(--hr-line-2)] hover:bg-[var(--hr-hover)]',
        variant === 'ghost' && 'text-[var(--hr-ink-2)] hover:bg-[var(--hr-hover)] hover:text-[var(--hr-ink)]',
        variant === 'danger' && 'border border-[var(--hr-line)] bg-[var(--hr-raised)] text-[var(--hr-bad)] hover:border-[var(--hr-bad)] hover:bg-[var(--hr-bad-soft)]',
        className,
      )}
    >
      {busy === true ? <Loader2 size={14} className="animate-spin" aria-hidden /> : Icon !== undefined ? <Icon size={size === 'sm' ? 13 : size === 'lg' ? 16 : 14} strokeWidth={1.9} aria-hidden /> : null}
      {children}
      {IconRight !== undefined && <IconRight size={13} strokeWidth={1.9} aria-hidden className="opacity-70" />}
    </button>
  );
}

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;
  size?: number | undefined;
  active?: boolean | undefined;
  tone?: 'danger' | undefined;
  /** It sits on a row that itself takes the hover fill: hover one step darker so it still shows. */
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
        'hr-focus hr-tap-sq inline-flex shrink-0 items-center justify-center rounded-[var(--hr-radius-sm)] transition-colors disabled:cursor-default disabled:opacity-40',
        active === true ? 'bg-[var(--hr-active)] text-[var(--hr-ink)]' : tone === 'danger' ? 'text-[var(--hr-muted)] hover:bg-[var(--hr-bad-soft)] hover:text-[var(--hr-bad)]' : onRow === true ? 'text-[var(--hr-muted)] hover:bg-[var(--hr-active)] hover:text-[var(--hr-ink)]' : 'text-[var(--hr-muted)] hover:bg-[var(--hr-hover)] hover:text-[var(--hr-ink)]',
        className,
      )}
    >
      <Icon size={Math.round(size * 0.53)} strokeWidth={1.8} aria-hidden />
    </button>
  );
}

/** A text link styled as a quiet action ("Edit", "View all"): underlined at rest, so it reads as one. */
export function LinkButton({ children, onClick, className, tone, disabled }: { children: ReactNode; onClick: () => void; className?: string | undefined; tone?: 'danger' | undefined; disabled?: boolean | undefined }): React.JSX.Element {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={cn('hr-focus hit hr-link inline-flex items-center gap-1 rounded-[3px] text-[12px] font-medium disabled:opacity-40', tone === 'danger' ? 'text-[var(--hr-bad)]' : 'text-[var(--hr-ink-2)] hover:text-[var(--hr-ink)]', className)}>
      {children}
    </button>
  );
}

/**
 * The trailing cue on a row that opens something (a chevron) or edits it (a
 * pencil), in muted ink at rest and ink on the row's hover (give the row
 * `group`). Rows that open or edit carry it, so they read as clickable before
 * the pointer reaches them.
 */
export function RowCue({ edit, className }: { edit?: boolean | undefined; className?: string | undefined }): React.JSX.Element {
  const Icon = edit === true ? Pencil : ChevronRight;
  return <Icon size={14} strokeWidth={1.8} aria-hidden className={cn('shrink-0 text-[var(--hr-muted)] transition-colors group-hover:text-[var(--hr-ink)]', className)} />;
}

/* ----------------------------------------------------------------- fields */

export const FIELD =
  'hr-tap w-full rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] bg-[var(--hr-raised)] text-[var(--hr-ink)] outline-none transition-[border-color,box-shadow] focus:border-[var(--hr-ink-2)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--hr-ink),transparent_90%)] disabled:opacity-55 aria-[invalid=true]:border-[var(--hr-bad)]';

export function Input({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { ref?: React.Ref<HTMLInputElement> | undefined }): React.JSX.Element {
  return <input {...rest} className={cn(FIELD, 'h-8 px-2.5 text-[13px]', className)} />;
}

/** A search field with the lens inside. */
export function SearchInput({ value, onChange, placeholder, className, label, autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string | undefined; className?: string | undefined; label?: string | undefined; autoFocus?: boolean | undefined }): React.JSX.Element {
  return (
    <span className={cn('relative inline-flex w-full', className)}>
      <Search size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--hr-muted)]" />
      <input value={value} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? t('ui.search')} aria-label={label ?? placeholder ?? t('ui.search')} className={cn(FIELD, 'h-8 pl-8 pr-7 text-[13px]')} />
      {value !== '' && (
        <button type="button" aria-label={t('ui.clear')} onClick={() => onChange('')} className="hr-focus hit absolute right-1.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-[3px] text-[var(--hr-muted)] hover:bg-[var(--hr-hover)] hover:text-[var(--hr-ink)]">
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
      className={cn(FIELD, 'hr-scroll hr-wrap block resize-none px-2.5 py-1.5 text-[13px] leading-5', className)}
    />
  );
}

/** A native select for forms (never in a sidebar). */
export function Select({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>): React.JSX.Element {
  return (
    <span className={cn('relative inline-flex w-full', className)}>
      <select {...rest} className={cn(FIELD, 'h-8 appearance-none pl-2.5 pr-8 text-[13px]')}>
        {children}
      </select>
      <ChevronDown size={14} aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--hr-muted)]" />
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
      className="hr-focus hr-tap-sq inline-flex shrink-0 items-center justify-center rounded-full transition-shadow hover:shadow-[0_0_0_3px_var(--hr-active)] disabled:opacity-40 disabled:hover:shadow-none"
    >
      {/* The track is the switch you see; the button around it is the 40 x 40 touch area on touch screens. */}
      <span aria-hidden className={cn('relative inline-flex h-[18px] w-8 items-center rounded-full transition-[background-color]', checked ? 'bg-[var(--hr-ink)]' : 'bg-[var(--hr-line-2)]')}>
        <span className={cn('absolute size-3.5 rounded-full bg-[var(--hr-raised)] shadow-sm transition-transform duration-200', checked ? 'translate-x-[16px]' : 'translate-x-[2px]')} />
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
      className={cn('hr-focus hr-tap inline-flex shrink-0 items-center gap-2 rounded-[3px] text-[13px] disabled:opacity-40', hideLabel === true && 'justify-center')}
    >
      <span className={cn('flex size-4 items-center justify-center rounded-[4px] border transition-colors', checked || indeterminate === true ? 'border-[var(--hr-ink)] bg-[var(--hr-ink)] text-[var(--hr-on-ink)]' : 'border-[var(--hr-line-2)] bg-[var(--hr-raised)]')}>
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
    <div ref={ref} role="radiogroup" aria-label={label} className={cn('hr-strip relative inline-flex max-w-full shrink-0 items-center self-start rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] bg-[var(--hr-sunk)] p-0.5', className)}>
      {pill !== null && <span aria-hidden className="absolute bottom-0.5 top-0.5 rounded-[calc(var(--hr-radius-sm)-2px)] bg-[var(--hr-raised)] shadow-[var(--hr-shadow)] transition-[left,width] duration-200 ease-out" style={{ left: pill.left, width: pill.width }} />}
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
            className={cn('hr-focus hr-tap-sq relative z-[1] inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[calc(var(--hr-radius-sm)-2px)] font-medium transition-colors', size === 'sm' ? 'h-6 px-2 text-[12px]' : 'h-7 px-2.5 text-[13px]', value === o.value ? 'text-[var(--hr-ink)]' : 'text-[var(--hr-muted)] hover:bg-[var(--hr-hover)] hover:text-[var(--hr-ink)]')}
          >
            {Icon !== undefined && <Icon size={13} strokeWidth={1.9} aria-hidden />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export interface TabDef<T extends string> {
  value: T;
  label: ReactNode;
  count?: number | undefined;
  icon?: LucideIcon | undefined;
}

/**
 * Underlined tabs; the ink bar slides under the chosen one. The strip scrolls
 * sideways only when the tabs do not fit, with no scrollbar showing; its
 * hairline is an inset line (not a border) so the bar sits on it inside the box.
 */
export function Tabs<T extends string>({ value, onChange, tabs, label, className }: { value: T; onChange: (v: T) => void; tabs: TabDef<T>[]; label: string; className?: string | undefined }): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (el !== null && el !== undefined) {
      setBar({ left: el.offsetLeft, width: el.offsetWidth });
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [value, tabs.length]);
  return (
    <div ref={ref} role="tablist" aria-label={label} className={cn('hr-strip relative flex shrink-0 items-end gap-4 pb-px shadow-[inset_0_-1px_0_var(--hr-line)]', className)}>
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const on = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(tab.value)}
            className={cn('hr-focus hr-tap-sq relative inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-t-[3px] px-0.5 text-[13px] font-medium transition-colors', on ? 'text-[var(--hr-ink)]' : 'text-[var(--hr-muted)] hover:text-[var(--hr-ink)]')}
          >
            {Icon !== undefined && <Icon size={14} strokeWidth={1.8} aria-hidden />}
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && <Count n={tab.count} />}
          </button>
        );
      })}
      {bar !== null && <span aria-hidden className="absolute bottom-0 h-[2px] rounded-full bg-[var(--hr-ink)] transition-[left,width] duration-200 ease-out" style={{ left: bar.left, width: bar.width }} />}
    </div>
  );
}

/**
 * A labelled form row. It is a group, not a <label>: a label element would
 * forward clicks to the first button inside composite controls (Segmented,
 * Picker). Every control inside carries its own aria-label.
 */
export function Field({ label, hint, error, children, className, optional, help }: { label: ReactNode; hint?: ReactNode; error?: string | null | undefined; children: ReactNode; className?: string | undefined; optional?: boolean | undefined; help?: string | undefined }): React.JSX.Element {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <span id={id} className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] font-medium text-[var(--hr-ink-2)]">
        {label}
        {optional === true && <span className="font-normal text-[var(--hr-muted)]">{t('ui.optional')}</span>}
        {help !== undefined && <Hint text={help} />}
      </span>
      {children}
      {error !== undefined && error !== null && error !== '' ? (
        <span className="text-[12px] leading-4 text-[var(--hr-bad)]" role="alert">
          {error}
        </span>
      ) : (
        hint !== undefined && <span className="text-[12px] leading-4 text-[var(--hr-muted)]">{hint}</span>
      )}
    </div>
  );
}

/** A label on the left, a control on the right. */
export function Row({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string | undefined }): React.JSX.Element {
  return (
    <div className={cn('flex min-h-11 items-center justify-between gap-4 py-2', className)}>
      <div className="min-w-0">
        <div className="text-[13px] text-[var(--hr-ink)]">{label}</div>
        {hint !== undefined && <div className="mt-0.5 text-[12px] leading-4 text-[var(--hr-muted)]">{hint}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

/** A read-only fact: a small label over its value ("START  4 Nov 2026"). */
export function Fact({ label, children, mono, className }: { label: ReactNode; children: ReactNode; mono?: boolean | undefined; className?: string | undefined }): React.JSX.Element {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="hr-label truncate">{label}</div>
      <div className={cn('hr-wrap mt-1 text-[13px] text-[var(--hr-ink)]', mono === true && 'hr-mono hr-num')}>{children}</div>
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }): React.JSX.Element {
  return <kbd className="hr-mono inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-[var(--hr-line)] bg-[var(--hr-raised)] px-1 text-[10.5px] text-[var(--hr-muted)]">{children}</kbd>;
}

export function Spinner({ size = 14, className }: { size?: number | undefined; className?: string | undefined }): React.JSX.Element {
  return <Loader2 size={size} className={cn('animate-spin', className)} aria-hidden />;
}

/** A centred spinner for a loading page or panel. */
export function Loading({ className }: { className?: string | undefined }): React.JSX.Element {
  return (
    <div className={cn('flex min-h-[30vh] items-center justify-center text-[var(--hr-muted)]', className)} role="status" aria-label={t('ui.loading')}>
      <Spinner size={18} />
    </div>
  );
}

export function Skeleton({ className }: { className?: string | undefined }): React.JSX.Element {
  return <span aria-hidden className={cn('hr-skel block h-4', className)} />;
}

/** A panel with an instrument-style label: "01  PAY RUN". */
export function Panel({ index, label, aside, children, className, bodyClass, flush }: { index?: string | undefined; label?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string | undefined; bodyClass?: string | undefined; flush?: boolean | undefined }): React.JSX.Element {
  return (
    <section className={cn('hr-panel hr-in flex min-w-0 flex-col', className)}>
      {(label !== undefined || aside !== undefined) && (
        // One header height for every panel (44px), so labels line up across a row and an action sits inside the
        // corner: centred on the label, 10px under the top edge and on the body's 14px side padding.
        <header className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 px-3.5 pb-1.5 pt-2.5 [@media(pointer:coarse)]:pb-1 [@media(pointer:coarse)]:pt-2">
          {index !== undefined && <span className="hr-label !text-[var(--hr-faint)]">{index}</span>}
          {label !== undefined && <span className="hr-label hr-wrap min-w-[min(100%,120px)] flex-1">{label}</span>}
          {/* The actions go under the label when the header is too narrow for both (a phone), never across the border. */}
          {aside !== undefined && aside !== null && <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1.5">{aside}</div>}
        </header>
      )}
      <div className={cn('min-h-0 flex-1', flush === true ? '' : 'px-3.5 pb-3.5', bodyClass)}>{children}</div>
    </section>
  );
}

export function Empty({ icon: Icon, title, children, action, className }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode; className?: string | undefined }): React.JSX.Element {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-6 py-10 text-center', className)}>
      <span className="flex size-10 items-center justify-center rounded-full border border-[var(--hr-line)] bg-[var(--hr-raised)] text-[var(--hr-muted)]">
        <Icon size={18} strokeWidth={1.8} aria-hidden />
      </span>
      <div className="text-[14px] font-semibold">{title}</div>
      {children !== undefined && <div className="hr-wrap max-w-sm text-[13px] leading-5 text-[var(--hr-muted)]">{children}</div>}
      {action !== undefined && <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}

/** A page or panel that could not load: the reason and a retry. */
export function LoadError({ message, onRetry, className }: { message: string; onRetry?: (() => void) | undefined; className?: string | undefined }): React.JSX.Element {
  return (
    <Empty icon={AlertTriangle} title={t('ui.could_not_load')} className={className} action={onRetry !== undefined ? <Button onClick={onRetry}>{t('ui.try_again')}</Button> : undefined}>
      {message}
    </Empty>
  );
}

export function Count({ n, tone = 'neutral' }: { n: number; tone?: 'neutral' | 'agent' | 'bad' | undefined }): React.JSX.Element | null {
  if (n <= 0) return null;
  return (
    <span className={cn('hr-num hr-mono inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10.5px] font-semibold', tone === 'agent' ? 'bg-[var(--hr-agent)] text-[var(--hr-agent-ink)]' : tone === 'bad' ? 'bg-[var(--hr-bad)] text-[var(--hr-page)]' : 'bg-[var(--hr-active)] text-[var(--hr-ink-2)]')}>
      {n > 99 ? '99+' : n}
    </span>
  );
}

export type Tone = 'neutral' | 'rh' | 'lh' | 'bad' | 'warn' | 'good' | 'agent' | 'faint';

const DOT: Record<Tone, string> = {
  neutral: 'bg-[var(--hr-ink-2)]',
  rh: 'bg-[var(--hr-rh)]',
  lh: 'bg-[var(--hr-lh)]',
  bad: 'bg-[var(--hr-bad)]',
  warn: 'bg-[var(--hr-warn)]',
  good: 'bg-[var(--hr-good)]',
  agent: 'bg-[var(--hr-agent)]',
  faint: 'bg-[var(--hr-line-2)]',
};

const TEXT: Record<Tone, string> = {
  neutral: 'text-[var(--hr-ink-2)]',
  rh: 'text-[var(--hr-rh)]',
  lh: 'text-[var(--hr-lh)]',
  bad: 'text-[var(--hr-bad)]',
  warn: 'text-[var(--hr-warn)]',
  good: 'text-[var(--hr-good)]',
  agent: 'text-[var(--hr-ink)]',
  faint: 'text-[var(--hr-muted)]',
};

/** A status as a dot and a word ("Active", "On leave", "Blocked"). */
export function StatusDot({ tone, label, pulse, className }: { tone: Tone; label?: ReactNode; pulse?: boolean | undefined; className?: string | undefined }): React.JSX.Element {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5 text-[12px]', TEXT[tone], className)}>
      <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', DOT[tone], pulse === true && 'hr-pulse')} />
      {label !== undefined && <span className="truncate">{label}</span>}
    </span>
  );
}

const TAG: Record<Tone, string> = {
  neutral: 'border-[var(--hr-line)] bg-[var(--hr-raised)] !text-[var(--hr-ink-2)]',
  faint: 'border-[var(--hr-line)] bg-transparent !text-[var(--hr-muted)]',
  agent: 'border-[var(--hr-ink)] bg-[var(--hr-ink)] !text-[var(--hr-on-ink)]',
  rh: 'border-transparent bg-[var(--hr-rh-soft)] !text-[var(--hr-rh)]',
  lh: 'border-transparent bg-[var(--hr-lh-soft)] !text-[var(--hr-lh)]',
  bad: 'border-transparent bg-[var(--hr-bad-soft)] !text-[var(--hr-bad)]',
  warn: 'border-transparent bg-[var(--hr-warn-soft)] !text-[var(--hr-warn)]',
  good: 'border-transparent bg-[var(--hr-good-soft)] !text-[var(--hr-good)]',
};

/** A small mono tag ("DRAFT", "LOCKED", "JP"). */
export function Tag({ children, tone = 'neutral', className, title }: { children: ReactNode; tone?: Tone | undefined; className?: string | undefined; title?: string | undefined }): React.JSX.Element {
  return (
    <span
      title={title}
      className={cn(
        // Never cut and never squeezed: a row that runs out of room wraps the tag to the next line instead.
        'hr-label inline-flex h-[18px] shrink-0 items-center whitespace-nowrap rounded-[3px] border px-1.5',
        TAG[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** An inline note in a form or panel: what blocks, warns or helps. */
export function Notice({ tone = 'neutral', children, action, className }: { tone?: 'neutral' | 'bad' | 'warn' | 'good' | 'agent' | undefined; children: ReactNode; action?: ReactNode; className?: string | undefined }): React.JSX.Element {
  return (
    <div
      role={tone === 'bad' ? 'alert' : undefined}
      className={cn(
        'hr-wrap flex items-start gap-2 rounded-[var(--hr-radius-sm)] border-l-2 px-3 py-2 text-[13px] leading-[18px]',
        tone === 'bad' ? 'border-[var(--hr-bad)] bg-[var(--hr-bad-soft)] text-[var(--hr-ink)]' : tone === 'warn' ? 'border-[var(--hr-warn)] bg-[var(--hr-warn-soft)] text-[var(--hr-ink)]' : tone === 'good' ? 'border-[var(--hr-good)] bg-[var(--hr-good-soft)] text-[var(--hr-ink)]' : tone === 'agent' ? 'border-[var(--hr-agent)] bg-[var(--hr-agent-soft)] text-[var(--hr-ink)]' : 'border-[var(--hr-line-2)] bg-[var(--hr-sunk)] text-[var(--hr-ink-2)]',
        className,
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

/* ---------------------------------------------------------------- tooltip */

/** A short definition behind a "?" (hover, focus or tap). */
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
        className={cn('hr-focus hit inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[var(--hr-muted)] hover:text-[var(--hr-ink)]', className)}
      >
        <CircleHelp size={13} strokeWidth={1.8} aria-hidden />
      </button>
      <Tip anchor={ref} open={open}>
        {text}
      </Tip>
    </>
  );
}

/** A dark bubble above an element (used by Hint and charts). */
export function Tip({ anchor, open, children }: { anchor: RefObject<HTMLElement | null>; open: boolean; children: ReactNode }): React.JSX.Element | null {
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
    <div ref={panel} role="tooltip" style={{ position: 'fixed', left: pos?.left ?? -9999, top: pos?.top ?? -9999, zIndex: 90 }} className="hr-wrap pointer-events-none max-w-[280px] rounded-[4px] bg-[var(--hr-ink)] px-2.5 py-1.5 text-[12px] leading-[17px] text-[var(--hr-on-ink)] shadow-[var(--hr-shadow-lg)]">
      {children}
    </div>,
    document.body,
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
  label,
}: {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string | undefined;
  align?: 'start' | 'end' | undefined;
  side?: 'bottom' | 'top' | 'right' | undefined;
  width?: number | undefined;
  label?: string | undefined;
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
      const tg = e.target as Node;
      if (panel.current?.contains(tg) || anchor.current?.contains(tg)) return;
      // A click inside a popover opened from this one (a day picker in a menu) is not outside.
      if ((tg as HTMLElement).closest?.('[data-hr-popover]') !== null && (tg as HTMLElement).closest?.('[data-hr-popover]') !== panel.current) return;
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
      data-hr-popover=""
      role="dialog"
      aria-label={label}
      style={{ position: 'fixed', left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: width !== undefined ? `min(${width}px, calc(100vw - 16px))` : undefined, zIndex: 80 }}
      className={cn('hr-fade hr-scroll max-h-[min(460px,80vh)] overflow-y-auto rounded-[var(--hr-radius)] border border-[var(--hr-line)] bg-[var(--hr-raised)] p-1 text-[var(--hr-ink)] shadow-[var(--hr-shadow-lg)]', className)}
    >
      {children}
    </div>,
    document.body,
  );
}

export function MenuItem({ icon: Icon, children, onClick, danger, selected, hint, disabled }: { icon?: LucideIcon | undefined; children: ReactNode; onClick: () => void; danger?: boolean | undefined; selected?: boolean | undefined; hint?: ReactNode; disabled?: boolean | undefined }): React.JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn('hr-focus hr-tap flex min-h-8 w-full items-center gap-2 rounded-[var(--hr-radius-sm)] px-2 py-1 text-left text-[13px] transition-colors disabled:opacity-40', danger === true ? 'text-[var(--hr-bad)] hover:bg-[var(--hr-bad-soft)]' : 'text-[var(--hr-ink)] hover:bg-[var(--hr-hover)]')}
    >
      {Icon !== undefined && <Icon size={14} strokeWidth={1.8} aria-hidden className={danger === true ? '' : 'text-[var(--hr-muted)]'} />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint !== undefined && <span className="shrink-0 text-[12px] text-[var(--hr-muted)]">{hint}</span>}
      {selected === true && <Check size={14} aria-hidden className="shrink-0 text-[var(--hr-ink)]" />}
    </button>
  );
}

export function MenuSep(): React.JSX.Element {
  return <div className="my-1 h-px bg-[var(--hr-hair)]" />;
}

export function MenuLabel({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="hr-label px-2 pb-1 pt-2">{children}</div>;
}

/** An IconButton that opens a menu of MenuItems. */
export function Menu({ icon, label, children, align = 'end', width = 220 }: { icon: LucideIcon; label: string; children: (close: () => void) => ReactNode; align?: 'start' | 'end' | undefined; width?: number | undefined }): React.JSX.Element {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <IconButton ref={ref} icon={icon} label={label} active={open} onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open} />
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
      if (e.key === 'Escape' && document.querySelector('[data-hr-popover]') === null) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open, onClose]);
}

/** A centred modal dialog: heading, body, a footer for Cancel and the main action. */
export function Dialog({ open, onClose, title, children, footer, width = 480, meta }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: number | undefined; meta?: ReactNode }): React.JSX.Element | null {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="hr-scrim fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto px-3 pb-10 pt-[8vh] sm:px-4" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} className="hr-dialog w-full rounded-[calc(var(--hr-radius)*1.5)] border border-[var(--hr-line)] bg-[var(--hr-raised)] text-[var(--hr-ink)] shadow-[var(--hr-shadow-lg)]" style={{ maxWidth: width }}>
        <div className="flex items-start gap-2 px-5 pb-1 pt-4">
          <div className="min-w-0 flex-1">
            <h2 className="hr-wrap text-[15px] font-semibold leading-6">{title}</h2>
            {meta !== undefined && <div className="hr-label mt-0.5 truncate">{meta}</div>}
          </div>
          <IconButton icon={X} label={t('ui.close')} onClick={onClose} size={28} />
        </div>
        <div className="px-5 pb-4 pt-2">{children}</div>
        {footer !== undefined && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--hr-hair)] px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** A panel docked to the right edge, for a record's details. */
export function Sheet({ open, onClose, children, width = 480, label }: { open: boolean; onClose: () => void; children: ReactNode; width?: number | undefined; label: string }): React.JSX.Element | null {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="hr-fade fixed inset-0 z-[60]" onPointerDown={(e) => e.target === e.currentTarget && onClose()} style={{ background: 'color-mix(in srgb, var(--hr-overlay), transparent 45%)' }}>
      <aside role="dialog" aria-modal="true" aria-label={label} className="hr-sheet absolute bottom-0 right-0 top-0 flex w-full flex-col border-l border-[var(--hr-line)] bg-[var(--hr-page)] text-[var(--hr-ink)] shadow-[var(--hr-shadow-lg)]" style={{ maxWidth: width }}>
        {children}
      </aside>
    </div>,
    document.body,
  );
}

/** The head of a Sheet: title, a mono meta line and a close button. */
export function SheetHeader({ title, meta, onClose, actions }: { title: ReactNode; meta?: ReactNode; onClose: () => void; actions?: ReactNode }): React.JSX.Element {
  return (
    <header className="flex min-h-14 shrink-0 items-center gap-2 border-b border-[var(--hr-line)] px-4 py-2">
      <div className="min-w-0 flex-1">
        <h2 className="hr-wrap text-[15px] font-semibold leading-5">{title}</h2>
        {meta !== undefined && <div className="hr-label mt-0.5 truncate">{meta}</div>}
      </div>
      {actions}
      <IconButton icon={X} label={t('ui.close')} onClick={onClose} />
    </header>
  );
}

/* ---------------------------------------------------------------- confirm */

interface ConfirmState {
  text: ReactNode;
  title: string;
  ok: string;
  tone: 'danger' | 'primary';
  /** Ask the approval PIN inside this same dialog (confirmPin). */
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
    setWrong(bad.left !== undefined ? t('pin.wrong_left', { n: bad.left }) : (bad.text ?? t('pin.wrong')));
  };
  return (
    <Dialog
      open
      onClose={() => close(false)}
      title={state.title}
      width={420}
      footer={
        <>
          <Button onClick={() => close(false)}>{t('ui.cancel')}</Button>
          <Button variant="primary" className={state.tone === 'danger' ? '!bg-[var(--hr-bad)] !text-[var(--hr-page)]' : ''} onClick={() => (needPin ? void tryPin(pin) : close(true))} autoFocus={!needPin} disabled={needPin && pin.length !== 6}>
            {state.ok}
          </Button>
        </>
      }
    >
      <div className="hr-wrap text-[13px] leading-5 text-[var(--hr-ink-2)]">{state.text}</div>
      {needPin && (
        <div className="mt-4 flex flex-col items-center gap-2">
          <span className="text-[12px] text-[var(--hr-muted)]">{t('pin.label')}</span>
          <PinBoxes value={pin} onChange={(v) => (setPin(v), setWrong(null))} onDone={(v) => void tryPin(v)} autoFocus label={t('pin.label')} invalid={wrong !== null && pin === ''} />
          {wrong !== null && (
            <span className="text-[12px] text-[var(--hr-bad)]" role="alert">
              {wrong}
            </span>
          )}
        </div>
      )}
    </Dialog>
  );
}

/** Ask before something that cannot be undone (render the element, call the function). */
export function useConfirm(): [React.JSX.Element | null, (text: ReactNode, title: string, ok?: string, tone?: 'danger' | 'primary') => Promise<boolean>] {
  const [state, setState] = useState<ConfirmState | null>(null);
  const ask = useCallback((text: ReactNode, title: string, ok = t('ui.remove'), tone: 'danger' | 'primary' = 'danger') => new Promise<boolean>((resolve) => setState({ text, title, ok, tone, resolve })), []);
  const close = (v: boolean): void => {
    state?.resolve(v);
    setState(null);
  };
  return [state === null ? null : <ConfirmDialog state={state} close={close} />, ask];
}

let confirmHost: ((s: Omit<ConfirmState, 'resolve'>) => Promise<{ ok: boolean; pin: string }>) | null = null;
/** The same question from anywhere (the host is mounted once in App). */
export function confirmAsk(text: ReactNode, title: string, ok = t('ui.remove'), tone: 'danger' | 'primary' = 'danger'): Promise<boolean> {
  if (confirmHost === null) return Promise.resolve(window.confirm(title));
  return confirmHost({ text, title, ok, tone }).then((r) => r.ok);
}

/**
 * Ask before a `confirm` operation and take the approval PIN in the same
 * dialog (one dialog, one button): resolves the PIN, or null when cancelled.
 * Pass it as the op's `pin` param so op() does not ask again.
 *   const pin = await confirmPin(t('pay.lock_text'), t('pay.lock'), t('pay.lock_ok'), 'primary');
 *   if (pin !== null) await op('payruns.lock', { payrun, pin });
 */
export function confirmPin(text: ReactNode, title: string, ok: string, tone: 'danger' | 'primary' = 'primary'): Promise<string | null> {
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
            <span key={i} className={cn('flex h-11 w-9 items-center justify-center rounded-[var(--hr-radius-sm)] border bg-[var(--hr-raised)] transition-colors', invalid === true ? 'border-[var(--hr-bad)]' : cur ? 'border-[var(--hr-ink)]' : 'border-[var(--hr-line)]')}>
              {filled && <span className="size-2 rounded-full bg-[var(--hr-ink)]" />}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** The approval PIN dialog: asked by every `confirm` operation (lib/api.ts op({ pin })). */
export function PinDialog({ open, ask, onDone, onCancel }: { open: boolean; ask: PinAsk; onDone: (pin: string) => void; onCancel: () => void }): React.JSX.Element | null {
  const [pin, setPin] = useState('');
  useEffect(() => {
    if (open) setPin('');
  }, [open, ask]);
  if (!open) return null;
  return (
    <Dialog open onClose={onCancel} title={ask.title ?? t('pin.title')} width={380}>
      <div className="flex flex-col items-center gap-4 pb-1 pt-1 text-center">
        <span className="flex size-10 items-center justify-center rounded-full border border-[var(--hr-line)] bg-[var(--hr-sunk)] text-[var(--hr-ink-2)]">
          <Lock size={17} aria-hidden />
        </span>
        <p className="hr-wrap text-[13px] leading-5 text-[var(--hr-ink-2)]">{ask.text ?? t('pin.text')}</p>
        <PinBoxes value={pin} onChange={setPin} onDone={(v) => onDone(v)} autoFocus label={t('pin.label')} invalid={ask.wrong === true && pin === ''} />
        {ask.wrong === true && (
          <p className="text-[12px] text-[var(--hr-bad)]" role="alert">
            {ask.left !== undefined ? t('pin.wrong_left', { n: ask.left }) : t('pin.wrong')}
          </p>
        )}
        <div className="flex w-full justify-end gap-2 pt-1">
          <Button onClick={onCancel}>{t('ui.cancel')}</Button>
          <Button variant="primary" disabled={pin.length !== 6} onClick={() => onDone(pin)}>
            {t('pin.confirm')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * Check a PIN without doing anything (pin.verify answers 200 with ok false
 * on a wrong PIN, so the browser logs no error). Null when it is right, else
 * what to tell the person. A failed check of another kind lets the
 * operation itself answer.
 */
export async function checkPin(pin: string): Promise<{ wrong: boolean; left?: number | undefined; text?: string | undefined } | null> {
  try {
    const r = await op<{ ok: boolean; code?: string; attempts_left?: number; minutes?: number; message?: string }>('pin.verify', { pin }, { quiet: true });
    if (r.ok) return null;
    if (r.code === 'wrong_pin') return { wrong: true, left: r.attempts_left };
    return { wrong: true, text: r.message };
  } catch {
    return null;
  }
}

/** Mounted once in App: answers op({ pin }) calls with the PIN dialog (each PIN is checked before the operation is sent). */
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
          setState({ ...state, ask: { ...state.ask, wrong: true, left: bad.left, text: bad.text ?? state.ask.text } });
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

export function Toasts(): React.JSX.Element {
  const [list, setList] = useState<Note[]>([]);
  useEffect(() => subscribeToasts(setList), []);
  return createPortal(
    <div className="pointer-events-none fixed bottom-[calc(76px+env(safe-area-inset-bottom))] left-1/2 z-[95] grid w-max max-w-[calc(100vw-24px)] -translate-x-1/2 gap-2 md:bottom-6" role="status" aria-live="polite">
      {list.map((n) => (
        <div key={n.id} className={cn('hr-up hr-wrap pointer-events-auto flex items-center gap-3 rounded-[var(--hr-radius)] px-3.5 py-2.5 text-[13px] font-medium shadow-[var(--hr-shadow-lg)]', n.kind === 'error' ? 'bg-[var(--hr-bad)] text-[var(--hr-page)]' : 'bg-[var(--hr-ink)] text-[var(--hr-on-ink)]')}>
          {n.kind === 'success' && <Check size={14} aria-hidden className="shrink-0" />}
          {n.kind === 'error' && <AlertTriangle size={14} aria-hidden className="shrink-0" />}
          <span className="min-w-0">{n.text}</span>
          {n.action !== undefined && (
            <button
              type="button"
              onClick={() => {
                n.action?.run();
                toast.dismiss(n.id);
              }}
              className="hr-focus shrink-0 rounded-[3px] px-1 font-semibold underline underline-offset-4 hover:no-underline"
            >
              {n.action.label}
            </button>
          )}
          <button type="button" aria-label={t('ui.close')} onClick={() => toast.dismiss(n.id)} className="hr-focus hit -mr-1 flex size-5 shrink-0 items-center justify-center rounded-[3px] opacity-70 hover:opacity-100">
            <X size={12} aria-hidden />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ facts */

/** One module fact (lib/contract.ts ProfileFact) as the kernel shows it: typed values are formatted, never printed raw. */
export function FactValue({ fact, entity, className }: { fact: ProfileFact; entity?: string | undefined; className?: string | undefined }): React.JSX.Element {
  const v = fact.value;
  const n = typeof v === 'number' ? v : Number(v);
  let body: ReactNode;
  if (fact.kind === 'money') body = <Money minor={Number.isFinite(n) ? n : null} currency={fact.currency ?? ''} />;
  else if (fact.kind === 'date') body = <span className="hr-mono">{typeof v === 'string' && v !== '' ? fmtDay(v, { year: 'auto', entity }) : t('ui.none')}</span>;
  else if (fact.kind === 'count') body = <span className="hr-mono hr-num">{Number.isFinite(n) ? n.toLocaleString('en') : String(v)}</span>;
  else if (fact.kind === 'days') body = <span className="hr-num">{Number.isFinite(n) ? t(Math.abs(n) === 1 ? 'fact.days.one' : 'fact.days.other', { n: n.toLocaleString('en', { maximumFractionDigits: 2 }) }) : String(v)}</span>;
  else if (fact.kind === 'hours') body = <span className="hr-num">{Number.isFinite(n) ? t('fact.hours', { n: n.toLocaleString('en', { maximumFractionDigits: 2 }) }) : String(v)}</span>;
  else body = String(v);
  const tone = fact.tone === 'good' ? 'text-[var(--hr-good)]' : fact.tone === 'warn' ? 'text-[var(--hr-warn)]' : fact.tone === 'bad' ? 'text-[var(--hr-bad)]' : '';
  return <span className={cn(tone, className)}>{body}</span>;
}

/**
 * The structured facts the server sends with approvals, notifications and
 * search results (lib_util.facts): days, ranges, money, states, numbers and
 * text, each with an optional key and label. The screen formats them; the
 * plain summary stays for the CLI.
 */
export interface ItemFact {
  type: 'day' | 'range' | 'money' | 'state' | 'number' | 'text';
  key?: string | undefined;
  label?: string | undefined;
  value?: string | number | undefined;
  from?: string | undefined;
  to?: string | undefined;
  amount_minor?: number | undefined;
  currency?: string | undefined;
  unit?: string | undefined;
}

function itemFactValue(f: ItemFact, entity: string | undefined): ReactNode {
  if (f.type === 'day') return <span className="hr-mono">{fmtDay(String(f.value ?? ''), { entity })}</span>;
  if (f.type === 'range') return <span className="hr-mono">{fmtRange(f.from ?? '', f.to ?? '', { entity })}</span>;
  if (f.type === 'money') return <Money minor={typeof f.amount_minor === 'number' ? f.amount_minor : null} currency={f.currency ?? ''} />;
  if (f.type === 'state') {
    const v = String(f.value ?? '').replace(/[_-]+/g, ' ');
    return v.charAt(0).toUpperCase() + v.slice(1);
  }
  if (f.type === 'number') {
    const n = Number(f.value);
    const text = Number.isFinite(n) ? n.toLocaleString('en', { maximumFractionDigits: 2 }) : String(f.value ?? '');
    return <span className="hr-num">{f.unit !== undefined && f.unit !== '' ? `${text} ${f.unit}` : text}</span>;
  }
  return String(f.value ?? '');
}

/**
 * Server facts in a line. `labelled` puts each label (muted) before its
 * value; otherwise the values stand with a dot between them (search
 * results). `skip` leaves out facts by key (the person when a chip shows them).
 */
export function ItemFacts({ facts, entity, labelled, skip, className }: { facts: ItemFact[]; entity?: string | undefined; labelled?: boolean | undefined; skip?: string[] | undefined; className?: string | undefined }): React.JSX.Element | null {
  const shown = facts.filter((f) => f.key === undefined || skip === undefined || !skip.includes(f.key));
  if (shown.length === 0) return null;
  if (labelled === true)
    return (
      <span className={cn('flex flex-wrap items-baseline gap-x-4 gap-y-1', className)}>
        {shown.map((f, i) => (
          <span key={f.key ?? i} className="inline-flex min-w-0 items-baseline gap-1.5">
            {f.label !== undefined && f.label !== '' && <span className="text-[var(--hr-muted)]">{f.label}</span>}
            <span className="hr-wrap min-w-0 text-[var(--hr-ink)]">{itemFactValue(f, entity)}</span>
          </span>
        ))}
      </span>
    );
  return (
    <span className={cn('block truncate', className)}>
      {shown.map((f, i) => (
        <span key={f.key ?? i}>
          {i > 0 && <span aria-hidden className="mx-1.5 text-[var(--hr-faint)]">{'\u00b7'}</span>}
          {itemFactValue(f, entity)}
        </span>
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ money */

/** What a hidden figure shows: the same few dots for every amount, so nothing leaks its size. */
export const PAY_MASK = '\u2022\u2022\u2022\u2022\u2022\u2022';

/** A money figure: mono, tabular, right-aligned where it sits; blank behind "Hide pay". */
/**
 * An amount, unambiguous by default: `display` 'auto' shows the ISO code
 * ("SGD 1,250.00", "JPY 250,000") and the symbol only for the company's
 * reporting currency while every amount on screen is in it; 'code' and
 * 'symbol' force one. Decimals follow the currency (JPY 0, KWD 3).
 */
export function Money({ minor, currency, className, format, display, always, tone }: { minor: number | null | undefined; currency: string; className?: string | undefined; format?: MoneyFormat | undefined; display?: Exclude<MoneyDisplay, 'none'> | undefined; always?: boolean | undefined; tone?: 'auto' | undefined }): React.JSX.Element {
  const { hidePay } = useUi();
  // Say which currency is on screen (before paint), and follow the others.
  useLayoutEffect(() => showCurrency(currency), [currency]);
  useSyncExternalStore(subscribeCurrencies, currenciesVersion);
  const hidden = hidePay && always !== true;
  // Behind "Hide pay" the figure is not in the page at all (copy, screen readers): a fixed mask.
  const text = hidden ? (minor === null || minor === undefined ? '' : PAY_MASK) : formatMoney(minor, currency, { ...format, display: display ?? format?.display ?? 'auto' });
  return (
    <span className={cn('hr-mono hr-num whitespace-nowrap', hidden && 'hr-hidden-pay', tone === 'auto' && !hidden && (minor ?? 0) < 0 && 'text-[var(--hr-bad)]', className)} aria-label={hidden ? t('ui.pay_hidden') : undefined} title={hidden ? t('ui.pay_hidden') : undefined}>
      {text}
    </span>
  );
}

/**
 * A money field: the person types in their own way ("12,500.50"), the value
 * stays integer minor units. `onChange(null)` when the text is not a number.
 */
export function MoneyInput({ value, onChange, currency, className, placeholder, label, autoFocus, invalid }: { value: number | null; onChange: (v: number | null) => void; currency: string; className?: string | undefined; placeholder?: string | undefined; label?: string | undefined; autoFocus?: boolean | undefined; invalid?: boolean | undefined }): React.JSX.Element {
  const [text, setText] = useState(() => moneyInputText(value, currency));
  const [bad, setBad] = useState(false);
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(moneyInputText(value, currency));
    }
  }, [value, currency]);
  return (
    <span className={cn('relative inline-flex w-full', className)}>
      <span className="hr-mono pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] text-[var(--hr-muted)]">{currency}</span>
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
          const isBad = e.target.value.trim() !== '' && v === null;
          setBad(isBad);
          last.current = v;
          onChange(v);
        }}
        className={cn(FIELD, 'hr-mono hr-num h-8 pl-12 pr-2.5 text-right text-[13px]')}
      />
    </span>
  );
}

/** Minor units as the major-unit text operations take ("1250.50"): money params are major units. */
export function majorParam(minor: number | null | undefined, currency: string): string | undefined {
  if (minor === null || minor === undefined) return undefined;
  const e = exponent(currency === '' ? 'USD' : currency);
  const neg = minor < 0;
  const s = String(Math.abs(Math.trunc(minor))).padStart(e + 1, '0');
  return (neg ? '-' : '') + (e === 0 ? s : `${s.slice(0, -e)}.${s.slice(-e)}`);
}

/* ------------------------------------------------------------------- days */

function monthGrid(month: string, weekStart: number): string[] {
  const first = dateOf(startOfMonth(month));
  const offset = (first.getDay() - weekStart + 7) % 7;
  const start = addDays(dayKey(first), -offset);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** Read a typed day: ISO, or the locale's numeric order (14/05/1990, 05/14/1990, 1990/05/14). */
export function parseTypedDay(text: string): string | null {
  const s = text.trim();
  if (isDay(s)) return s;
  const m = /^(\d{1,4})[./\-\s](\d{1,2})[./\-\s](\d{1,4})$/.exec(s);
  if (m === null) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = Number(m[3]);
  let y: number;
  let mo: number;
  let d: number;
  if ((m[1] ?? '').length === 4) {
    y = a;
    mo = b;
    d = c;
  } else {
    // Typed in the app's date style (month first only in month-first styles).
    y = c < 100 ? 2000 + c : c;
    if (dateOrder().order === 'mdy') {
      mo = a;
      d = b;
    } else {
      d = a;
      mo = b;
    }
  }
  const key = `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isDay(key) && dayKey(dateOf(key)) === key ? key : null;
}

function localeWeekStart(): number {
  try {
    const info = (new Intl.Locale(navigator.language) as unknown as { weekInfo?: { firstDay: number }; getWeekInfo?: () => { firstDay: number } });
    const w = info.getWeekInfo?.() ?? info.weekInfo;
    if (w !== undefined) return w.firstDay % 7;
  } catch {
    /* older engines */
  }
  return 1;
}

function MonthView({ month, onMonth, isSel, inRange, onPick, onHover, weekStart, min, max, today }: { month: string; onMonth: (m: string) => void; isSel: (d: string) => boolean; inRange?: ((d: string) => boolean) | undefined; onPick: (d: string) => void; onHover?: ((d: string) => void) | undefined; weekStart: number; min?: string | undefined; max?: string | undefined; today: string }): React.JSX.Element {
  const days = monthGrid(month, weekStart);
  const m = dateOf(month);
  const heads = days.slice(0, 7).map((d) => dateOf(d).toLocaleDateString('en', { weekday: 'narrow' }));
  const shift = (n: number): void => {
    const d = new Date(m.getFullYear(), m.getMonth() + n, 1);
    onMonth(dayKey(d));
  };
  return (
    <div className="w-[252px] p-2">
      <div className="mb-1 flex items-center gap-1">
        <IconButton icon={ChevronLeft} label={t('ui.prev_month')} size={28} onClick={() => shift(-1)} />
        <div className="flex-1 text-center text-[13px] font-semibold">
          {monthName(m.getMonth() + 1)} <span className="hr-mono hr-num font-normal">{m.getFullYear()}</span>
        </div>
        <IconButton icon={ChevronRight} label={t('ui.next_month')} size={28} onClick={() => shift(1)} />
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {heads.map((h, i) => (
          <span key={i} className="hr-label flex h-6 items-center justify-center">
            {h}
          </span>
        ))}
        {days.map((d) => {
          const other = d.slice(0, 7) !== month.slice(0, 7);
          const off = (min !== undefined && min !== '' && d < min) || (max !== undefined && max !== '' && d > max);
          const sel = isSel(d);
          const mid = inRange?.(d) === true;
          return (
            <button
              key={d}
              type="button"
              disabled={off}
              onClick={() => onPick(d)}
              onMouseEnter={() => onHover?.(d)}
              aria-label={fmtDay(d, { year: 'always', weekday: true })}
              aria-pressed={sel}
              className={cn(
                'hr-focus hr-mono hr-num flex h-8 items-center justify-center rounded-[var(--hr-radius-sm)] text-[12px] transition-colors disabled:cursor-default disabled:opacity-30',
                sel ? 'bg-[var(--hr-ink)] font-semibold text-[var(--hr-on-ink)]' : mid ? 'bg-[var(--hr-active)] text-[var(--hr-ink)]' : other ? 'text-[var(--hr-faint)] hover:bg-[var(--hr-hover)]' : 'text-[var(--hr-ink)] hover:bg-[var(--hr-hover)]',
                d === today && !sel && 'ring-1 ring-inset ring-[var(--hr-line-2)]',
              )}
            >
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A day field: a button showing the day that opens a month calendar, with a
 * typed entry on top (birth dates are typed, never scrolled). Never a hidden
 * native date input (the frame's native picker does not open).
 */
export function DayPicker({ value, onChange, placeholder, min, max, label, className, clearable, weekStart, invalid, disabled }: { value: string; onChange: (day: string) => void; placeholder?: string | undefined; min?: string | undefined; max?: string | undefined; label: string; className?: string | undefined; clearable?: boolean | undefined; weekStart?: number | undefined; invalid?: boolean | undefined; disabled?: boolean | undefined }): React.JSX.Element {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(value !== '' ? value : dayKey());
  const [typed, setTyped] = useState('');
  const today = dayKey();
  const ws = weekStart ?? localeWeekStart();
  useEffect(() => {
    if (open) {
      setMonth(value !== '' ? value : today);
      setTyped('');
    }
  }, [open, value, today]);
  const pick = (d: string): void => {
    onChange(d);
    setOpen(false);
  };
  const typedDay = typed === '' ? null : parseTypedDay(typed);
  return (
    <>
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        aria-label={value !== '' ? `${label}: ${fmtDay(value, { year: 'always' })}` : label}
        aria-invalid={invalid === true}
        onClick={() => setOpen((v) => !v)}
        className={cn(FIELD, 'flex h-8 items-center gap-2 px-2.5 text-left text-[13px] hover:border-[var(--hr-line-2)]', className)}
      >
        {/* An inner row, so a page's display class on the button (block, inline-block) never wraps the chevron under the day. */}
        <span className="flex w-full min-w-0 items-center gap-2">
          <span className={cn('min-w-0 flex-1 truncate', value === '' && 'text-[var(--hr-muted)]')}>{value !== '' ? fmtDay(value, { year: 'always' }) : (placeholder ?? t('ui.pick_day'))}</span>
          <ChevronsUpDown size={13} aria-hidden className="shrink-0 text-[var(--hr-muted)]" />
        </span>
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} label={label} className="p-0">
        <div className="border-b border-[var(--hr-hair)] p-2">
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
            placeholder={t('ui.type_day')}
            aria-label={t('ui.type_day')}
            aria-invalid={typed !== '' && typedDay === null}
          />
          {typed !== '' && (
            <div className="mt-1 flex items-center justify-between gap-2 px-0.5 text-[12px]">
              <span className={typedDay === null ? 'text-[var(--hr-bad)]' : 'text-[var(--hr-muted)]'}>{typedDay === null ? t('ui.not_a_day') : fmtDay(typedDay, { year: 'always', weekday: true })}</span>
              {typedDay !== null && (
                <LinkButton onClick={() => pick(typedDay)}>
                  {t('ui.use')}
                </LinkButton>
              )}
            </div>
          )}
        </div>
        <MonthView month={month} onMonth={setMonth} isSel={(d) => d === value} onPick={pick} weekStart={ws} min={min} max={max} today={today} />
        <div className="flex items-center justify-between gap-2 border-t border-[var(--hr-hair)] px-2 py-1.5">
          <LinkButton onClick={() => pick(today)}>{t('format.today')}</LinkButton>
          {clearable === true && value !== '' && <LinkButton onClick={() => pick('')}>{t('ui.clear')}</LinkButton>}
        </div>
      </Popover>
    </>
  );
}

export interface RangePreset {
  label: string;
  from: string;
  to: string;
}

/** A range of days in one control: the first click sets the start, the second the end. */
export function DateRange({ from, to, onChange, label, presets, className, weekStart }: { from: string; to: string; onChange: (from: string, to: string) => void; label: string; presets?: RangePreset[] | undefined; className?: string | undefined; weekStart?: number | undefined }): React.JSX.Element {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(from !== '' ? from : dayKey());
  const [start, setStart] = useState<string | null>(null);
  const [hover, setHover] = useState('');
  const today = dayKey();
  const ws = weekStart ?? localeWeekStart();
  useEffect(() => {
    if (open) {
      setMonth(from !== '' ? from : today);
      setStart(null);
    }
  }, [open, from, today]);
  const lo = start ?? from;
  const hi = start !== null ? hover : to;
  const a = lo !== '' && hi !== '' && hi < lo ? hi : lo;
  const b = lo !== '' && hi !== '' && hi < lo ? lo : hi;
  return (
    <>
      <button ref={ref} type="button" aria-label={label} onClick={() => setOpen((v) => !v)} className={cn(FIELD, 'flex h-8 items-center gap-2 px-2.5 text-left text-[13px] hover:border-[var(--hr-line-2)]', className)}>
        <span className="flex w-full min-w-0 items-center gap-2">
          <span className={cn('min-w-0 flex-1 truncate', from === '' && 'text-[var(--hr-muted)]')}>{from !== '' ? fmtRange(from, to) : t('ui.pick_range')}</span>
          <ChevronsUpDown size={13} aria-hidden className="shrink-0 text-[var(--hr-muted)]" />
        </span>
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} label={label} className="p-0">
        <div className="flex flex-col sm:flex-row">
          {presets !== undefined && presets.length > 0 && (
            <div className="flex flex-row flex-wrap gap-0.5 border-b border-[var(--hr-hair)] p-1.5 sm:w-[140px] sm:flex-col sm:border-b-0 sm:border-r">
              {presets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    onChange(p.from, p.to);
                    setOpen(false);
                  }}
                  className={cn('hr-focus hr-tap h-7 rounded-[var(--hr-radius-sm)] px-2 text-left text-[13px] hover:bg-[var(--hr-hover)]', p.from === from && p.to === to && 'bg-[var(--hr-active)] font-semibold')}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
          <div onMouseLeave={() => setHover('')}>
            <MonthView
              month={month}
              onMonth={setMonth}
              weekStart={ws}
              today={today}
              isSel={(d) => d === a || d === b}
              inRange={(d) => a !== '' && b !== '' && d > a && d < b}
              onHover={(d) => start !== null && setHover(d)}
              onPick={(d) => {
                if (start === null) {
                  setStart(d);
                  setHover(d);
                  return;
                }
                const x = d < start ? d : start;
                const y = d < start ? start : d;
                onChange(x, y);
                setOpen(false);
              }}
            />
            {start !== null && <div className="px-3 pb-2 text-[12px] text-[var(--hr-muted)]">{t('ui.pick_end')}</div>}
          </div>
        </div>
      </Popover>
    </>
  );
}

/* ----------------------------------------------------------------- people */

/** A photo or initials in a circle. */
export function Avatar({ name, photo, size = 28, agent }: { name: string; photo?: string | null | undefined; size?: number | undefined; agent?: boolean | undefined }): React.JSX.Element {
  const [broken, setBroken] = useState(false);
  if (photo !== undefined && photo !== null && photo !== '' && !broken) {
    return <img src={photo} alt="" onError={() => setBroken(true)} className="shrink-0 rounded-full border border-[var(--hr-hair)] object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span aria-hidden className={cn('hr-mono flex shrink-0 select-none items-center justify-center rounded-full font-medium', agent === true ? 'bg-[var(--hr-agent)] text-[var(--hr-agent-ink)]' : 'border border-[var(--hr-line)] bg-[var(--hr-sunk)] text-[var(--hr-ink-2)]')} style={{ width: size, height: size, fontSize: size <= 22 ? 10.5 : size <= 34 ? 12 : size <= 46 ? 14 : size <= 64 ? 15 : 26 }}>
      {initials(name)}
    </span>
  );
}

/** A person: photo or initials, the name in the right order, a muted line under it. */
export function PersonChip({ name, photo, sub, size = 28, href: link, onClick, className, strong }: { name: string; photo?: string | null | undefined; sub?: ReactNode; size?: number | undefined; href?: string | undefined; onClick?: (() => void) | undefined; className?: string | undefined; strong?: boolean | undefined }): React.JSX.Element {
  const inner = (
    <>
      <Avatar name={name} photo={photo} size={size} />
      <span className="min-w-0 flex-1 leading-tight">
        <span className={cn('hr-wrap block text-[13px]', strong !== false && 'font-medium', link !== undefined && 'hr-link')}>{name}</span>
        {sub !== undefined && sub !== '' && <span className="block truncate text-[12px] text-[var(--hr-muted)]">{sub}</span>}
      </span>
    </>
  );
  const cls = cn('flex min-w-0 items-center gap-2.5 text-left', className);
  if (link !== undefined)
    return (
      <a href={link} onClick={(e) => e.stopPropagation()} className={cn(cls, 'hr-focus rounded-[var(--hr-radius-sm)]')}>
        {inner}
      </a>
    );
  if (onClick !== undefined)
    return (
      <button type="button" onClick={onClick} className={cn(cls, 'hr-focus rounded-[var(--hr-radius-sm)]')}>
        {inner}
      </button>
    );
  return <span className={cls}>{inner}</span>;
}

export interface PickItem {
  value: string;
  label: string;
  sub?: string | undefined;
  photo?: string | null | undefined;
  icon?: LucideIcon | undefined;
  person?: boolean | undefined;
}

/**
 * Choose one of many (a person, a department, a manager): a field-styled
 * button opening a searchable list. For forms; never in a sidebar.
 */
export function Picker({ value, onChange, items, label, placeholder, className, onSearch, clearable, footer, invalid, disabled }: { value: string; onChange: (v: string, item: PickItem | null) => void; items: PickItem[]; label: string; placeholder?: string | undefined; className?: string | undefined; onSearch?: ((q: string) => void) | undefined; clearable?: boolean | undefined; footer?: ((close: () => void) => ReactNode) | undefined; invalid?: boolean | undefined; disabled?: boolean | undefined }): React.JSX.Element {
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
  const close = useCallback(() => setOpen(false), []);
  const choose = (i: PickItem | null): void => {
    onChange(i?.value ?? '', i);
    setOpen(false);
  };
  return (
    <>
      <button ref={ref} type="button" disabled={disabled} aria-label={cur !== null ? `${label}: ${cur.label}` : label} aria-invalid={invalid === true} onClick={() => setOpen((v) => !v)} className={cn(FIELD, 'flex h-8 items-center gap-2 px-2.5 text-left text-[13px] hover:border-[var(--hr-line-2)]', className)}>
        {cur?.person === true && <Avatar name={cur.label} photo={cur.photo} size={18} />}
        <span className={cn('min-w-0 flex-1 truncate', cur === null && 'text-[var(--hr-muted)]')}>{cur?.label ?? placeholder ?? t('ui.choose')}</span>
        <ChevronsUpDown size={13} aria-hidden className="shrink-0 text-[var(--hr-muted)]" />
      </button>
      <Popover anchor={ref} open={open} onClose={close} width={Math.max(260, ref.current?.offsetWidth ?? 0)} label={label} className="flex flex-col p-0">
        <div className="border-b border-[var(--hr-hair)] p-1.5">
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
          className="hr-scroll max-h-[280px] overflow-y-auto p-1"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setAt((i) => Math.min(shown.length - 1, i + 1));
            else if (e.key === 'ArrowUp') setAt((i) => Math.max(0, i - 1));
            else if (e.key === 'Enter') choose(shown[at] ?? null);
          }}
        >
          {clearable === true && value !== '' && (
            <button type="button" role="option" aria-selected={false} onClick={() => choose(null)} className="hr-focus flex h-8 w-full items-center gap-2 rounded-[var(--hr-radius-sm)] px-2 text-left text-[13px] text-[var(--hr-muted)] hover:bg-[var(--hr-hover)]">
              {t('ui.none')}
            </button>
          )}
          {shown.length === 0 && <div className="px-2 py-4 text-center text-[12px] text-[var(--hr-muted)]">{t('ui.nothing_found')}</div>}
          {shown.slice(0, 200).map((i, idx) => {
            const Icon = i.icon;
            return (
              <button
                key={i.value}
                type="button"
                role="option"
                aria-selected={i.value === value}
                onMouseEnter={() => setAt(idx)}
                onClick={() => choose(i)}
                className={cn('hr-focus flex min-h-8 w-full items-center gap-2 rounded-[var(--hr-radius-sm)] px-2 py-1 text-left text-[13px]', idx === at ? 'bg-[var(--hr-hover)]' : '')}
              >
                {i.person === true ? <Avatar name={i.label} photo={i.photo} size={20} /> : Icon !== undefined ? <Icon size={14} aria-hidden className="text-[var(--hr-muted)]" /> : null}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{i.label}</span>
                  {i.sub !== undefined && i.sub !== '' && <span className="block truncate text-[12px] text-[var(--hr-muted)]">{i.sub}</span>}
                </span>
                {i.value === value && <Check size={14} aria-hidden />}
              </button>
            );
          })}
        </div>
        {footer !== undefined && <div className="border-t border-[var(--hr-hair)] p-1">{footer(close)}</div>}
      </Popover>
    </>
  );
}

/* -------------------------------------------------------------- readouts */

/** One big mono readout with its label ("HEADCOUNT  42"). */
/**
 * The one entity control for pages and forms (the sidebar's switch in field
 * form): a button with the entity's name and country, a list to choose from.
 * `all` adds "All entities" (value ''). Never a select or a row of codes.
 */
export function EntityPicker({ value, onChange, label, all, className, entities }: { value: string; onChange: (id: string) => void; label: string; all?: boolean | undefined; className?: string | undefined; entities?: Pick<EntityRef, 'id' | 'name' | 'country'>[] | undefined }): React.JSX.Element {
  const s = useSession();
  const list: (Pick<EntityRef, 'id' | 'name' | 'country'> & { currency?: string | undefined })[] = entities ?? s.me?.entities ?? [];
  const ref = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const cur = list.find((e) => e.id === value) ?? null;
  const text = cur !== null ? `${cur.name} \u00b7 ${cur.country}` : all === true ? t('shell.all_entities', { n: list.length }) : t('ui.choose');
  return (
    <>
      <button ref={ref} type="button" aria-label={`${label}: ${text}`} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((v) => !v)} className={cn(FIELD, 'flex h-8 items-center gap-2 px-2.5 text-left text-[13px] hover:border-[var(--hr-line-2)]', className)}>
        <Building2 size={14} aria-hidden className="shrink-0 text-[var(--hr-muted)]" />
        <span className={cn('min-w-0 flex-1 truncate', cur === null && all !== true && 'text-[var(--hr-muted)]')}>{text}</span>
        <ChevronsUpDown size={13} aria-hidden className="shrink-0 text-[var(--hr-muted)]" />
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} width={Math.max(260, ref.current?.offsetWidth ?? 0)} label={label}>
        <div role="listbox" aria-label={label}>
          {all === true && (
            <MenuItem selected={value === ''} onClick={() => (onChange(''), setOpen(false))}>
              {t('shell.all_entities', { n: list.length })}
            </MenuItem>
          )}
          {list.map((e) => (
            <MenuItem key={e.id} selected={e.id === value} hint={e.currency !== undefined && e.currency !== '' ? `${e.country} \u00b7 ${e.currency}` : e.country} onClick={() => (onChange(e.id), setOpen(false))}>
              {e.name}
            </MenuItem>
          ))}
        </div>
      </Popover>
    </>
  );
}

export function StatTile({ label, value, sub, index, tone, className, onClick }: { label: ReactNode; value: ReactNode; sub?: ReactNode; index?: string | undefined; tone?: Tone | undefined; className?: string | undefined; onClick?: (() => void) | undefined }): React.JSX.Element {
  const body = (
    <>
      <div className="hr-label truncate">
        {index !== undefined && <span className="mr-2 !text-[var(--hr-faint)]">{index}</span>}
        {label}
      </div>
      <div className="mt-1.5 flex min-w-0 items-baseline gap-2">
        <span className={cn('hr-mono hr-num truncate text-[26px] font-light leading-none tracking-tight', tone !== undefined && TEXT[tone])}>{value}</span>
        {/* The words after the figure ("days", "this month") in the text face: mono spaces them out. */}
        {sub !== undefined && <span className="hr-num truncate text-[12px] text-[var(--hr-muted)]">{sub}</span>}
      </div>
    </>
  );
  if (onClick !== undefined)
    return (
      <button type="button" onClick={onClick} className={cn('hr-panel hr-in hr-focus min-w-0 px-3.5 py-3 text-left transition-colors hover:border-[var(--hr-line-2)] hover:bg-[var(--hr-hover)]', className)}>
        {body}
      </button>
    );
  return <div className={cn('hr-panel hr-in min-w-0 px-3.5 py-3', className)}>{body}</div>;
}

export interface StepDef {
  key: string;
  label: string;
}

/** Numbered steps (setup, hire, pay run); the ink bar slides under the current one. */
export function Stepper({ steps, current, onStep, done, className }: { steps: StepDef[]; current: string; onStep?: ((key: string) => void) | undefined; done?: string[] | undefined; className?: string | undefined }): React.JSX.Element {
  const idx = Math.max(0, steps.findIndex((s) => s.key === current));
  return (
    <ol className={cn('hr-strip flex min-w-0 items-center gap-1', className)} aria-label={t('ui.steps')}>
      {steps.map((s, i) => {
        const isDone = done?.includes(s.key) === true || i < idx;
        const on = i === idx;
        const can = onStep !== undefined && (isDone || i <= idx);
        return (
          <li key={s.key} className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              disabled={!can}
              onClick={() => onStep?.(s.key)}
              aria-current={on ? 'step' : undefined}
              className={cn('hr-focus flex h-8 items-center gap-2 rounded-[var(--hr-radius-sm)] px-2 text-[13px] transition-colors disabled:cursor-default', can && !on && 'hover:bg-[var(--hr-hover)]', on ? 'font-semibold text-[var(--hr-ink)]' : isDone ? 'text-[var(--hr-ink-2)]' : 'text-[var(--hr-muted)]')}
            >
              <span className={cn('hr-mono flex size-5 items-center justify-center rounded-full border text-[10.5px]', on ? 'border-[var(--hr-ink)] bg-[var(--hr-ink)] text-[var(--hr-on-ink)]' : isDone ? 'border-[var(--hr-ink-2)] text-[var(--hr-ink-2)]' : 'border-[var(--hr-line-2)]')}>{isDone && !on ? <Check size={11} strokeWidth={2.6} aria-hidden /> : i + 1}</span>
              {s.label}
            </button>
            {i < steps.length - 1 && <span aria-hidden className={cn('h-px w-5', i < idx ? 'bg-[var(--hr-ink-2)]' : 'bg-[var(--hr-line)]')} />}
          </li>
        );
      })}
    </ol>
  );
}

export interface TimelineItem {
  id: string;
  /** The effective day. */
  day: string;
  title: ReactNode;
  /** 'past' | 'current' | 'scheduled' (future-dated). */
  state: 'past' | 'current' | 'scheduled';
  lines?: { label: ReactNode; before?: ReactNode; after: ReactNode }[] | undefined;
  meta?: ReactNode;
  actions?: ReactNode;
  agent?: boolean | undefined;
}

/** Effective-dated history: scheduled changes on top, the current row filled, the past below. */
export function Timeline({ items, empty }: { items: TimelineItem[]; empty?: ReactNode }): React.JSX.Element {
  if (items.length === 0) return <>{empty ?? null}</>;
  return (
    <ol className="relative flex flex-col">
      {items.map((it, i) => (
        <li key={it.id} className="hr-in relative flex gap-3 pb-4 last:pb-0">
          {i < items.length - 1 && <span aria-hidden className={cn('absolute left-[5px] top-4 bottom-0 w-px', it.state === 'scheduled' ? 'border-l border-dashed border-[var(--hr-line-2)]' : 'bg-[var(--hr-line)]')} />}
          <span aria-hidden className={cn('relative mt-1.5 size-[11px] shrink-0 rounded-full border-2', it.state === 'current' ? 'border-[var(--hr-ink)] bg-[var(--hr-ink)]' : it.state === 'scheduled' ? 'border-[var(--hr-rh)] bg-[var(--hr-page)]' : 'border-[var(--hr-line-2)] bg-[var(--hr-page)]')} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="hr-mono hr-num text-[12px] text-[var(--hr-ink-2)]">{fmtDay(it.day, { year: 'always' })}</span>
              {it.state === 'scheduled' && <Tag tone="rh">{t('timeline.scheduled')}</Tag>}
              {it.state === 'current' && <Tag>{t('timeline.current')}</Tag>}
              {it.agent === true && <Tag tone="agent">{t('ui.agent_short')}</Tag>}
              <span className="flex-1" />
              {it.actions}
            </div>
            <div className="hr-wrap mt-0.5 text-[13px] font-medium">{it.title}</div>
            {it.lines !== undefined && it.lines.length > 0 && (
              <dl className="mt-1.5 grid grid-cols-[minmax(90px,auto)_1fr] gap-x-3 gap-y-1 text-[12px]">
                {it.lines.map((l, j) => (
                  <div key={j} className="contents">
                    <dt className="text-[var(--hr-muted)]">{l.label}</dt>
                    <dd className="hr-wrap min-w-0">
                      {l.before !== undefined && l.before !== null && l.before !== '' && (
                        <>
                          <span className="text-[var(--hr-muted)] line-through decoration-[var(--hr-line-2)]">{l.before}</span>
                          <span className="mx-1.5 text-[var(--hr-faint)]">{'>'}</span>
                        </>
                      )}
                      {l.after}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {it.meta !== undefined && <div className="mt-1 text-[12px] text-[var(--hr-muted)]">{it.meta}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/* --------------------------------------------------------------- the page */

/** Opens the phone drawer (set by the shell). */
const MenuCtx = createContext<(() => void) | null>(null);
export const MenuProvider = MenuCtx.Provider;

/** How many separate actions a header holds (fragments opened up). */
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
 * The page header, as Piano Coach's: an open strip, the title large (26px)
 * with the mono meta on its baseline, the actions on the right. On a phone
 * (under 768px) the first row holds the menu, back, "More" (every page
 * action) and the shell's tools (search, Hide pay, notifications); the title
 * has the whole width on its own line below (it wraps to two lines, never
 * cut to a few letters), with the meta under it. `back` shows an arrow.
 */
export function PageHeader({ title, meta, children, back, sticky }: { title: ReactNode; meta?: ReactNode; children?: ReactNode; back?: string | undefined; sticky?: boolean | undefined }): React.JSX.Element {
  const openMenu = useContext(MenuCtx);
  const n = actionCount(children);
  return (
    <header className={cn('flex shrink-0 flex-wrap items-center gap-x-1 bg-[var(--hr-page)] px-4 pb-3 md:min-h-[72px] md:flex-nowrap md:gap-x-3 md:px-6 md:pb-2 md:pt-4', sticky === true && 'sticky top-0 z-20')}>
      {openMenu !== null && <IconButton icon={MenuLines} label={t('shell.menu')} onClick={openMenu} className="-ml-1.5 md:hidden" size={36} />}
      {back !== undefined && (
        <a href={back} aria-label={t('ui.back')} title={t('ui.back')} className="hr-focus hr-tap-sq -ml-1 flex size-8 shrink-0 items-center justify-center rounded-[var(--hr-radius-sm)] text-[var(--hr-ink-2)] hover:bg-[var(--hr-hover)] hover:text-[var(--hr-ink)]">
          <ChevronLeft size={18} aria-hidden />
        </a>
      )}
      <div className="order-last min-w-0 basis-full md:order-none md:flex md:min-w-0 md:flex-1 md:basis-auto md:items-baseline md:gap-3">
        <h1 className="hr-wrap text-[26px] font-semibold leading-8 tracking-[-0.02em] max-md:line-clamp-2 md:min-w-0 md:truncate">{title}</h1>
        {meta !== undefined && meta !== '' && <div className="hr-label mt-1 min-w-0 truncate md:mt-0 md:shrink-[3]">{meta}</div>}
      </div>
      <span aria-hidden className="h-14 flex-1 md:hidden" />
      {n > 0 && <HeaderActions>{children}</HeaderActions>}
      <HeaderTools />
    </header>
  );
}

/** The header's actions: in a row from 768px, behind one "More" button on a phone (one live copy, CSS switches it). */
function HeaderActions({ children }: { children: ReactNode }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent): void => {
      const tg = e.target as HTMLElement;
      if (box.current?.contains(tg) || tg.closest?.('[data-hr-popover]') !== null) return;
      setOpen(false);
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <div ref={box} className="relative flex min-w-0 shrink-0 items-center md:shrink">
      <IconButton icon={MoreHorizontal} label={t('ui.more')} active={open} onClick={() => setOpen((v) => !v)} aria-expanded={open} className="md:hidden" />
      <div
        onClickCapture={(e) => {
          // An action that opens its own menu keeps this one open; any other closes it.
          const tg = e.target as HTMLElement;
          if (tg.closest('button, a') !== null && tg.closest('[aria-haspopup]') === null) window.setTimeout(() => setOpen(false), 0);
        }}
        className={cn(
          'md:flex md:min-w-0 md:flex-wrap md:items-center md:justify-end md:gap-2',
          open
            ? 'hr-head-more max-md:absolute max-md:right-0 max-md:top-full max-md:z-40 max-md:mt-1.5 max-md:flex max-md:w-max max-md:min-w-[220px] max-md:max-w-[calc(100vw-24px)] max-md:flex-col max-md:items-stretch max-md:gap-1.5 max-md:rounded-[var(--hr-radius)] max-md:border max-md:border-[var(--hr-line)] max-md:bg-[var(--hr-raised)] max-md:p-1.5 max-md:shadow-[var(--hr-shadow-lg)]'
            : 'max-md:hidden',
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** The shell's tools at the right end of every page header (search, hide pay, notifications). */
const ToolsCtx = createContext<ReactNode>(null);
export const HeaderToolsProvider = ToolsCtx.Provider;
function HeaderTools(): React.JSX.Element | null {
  const tools = useContext(ToolsCtx);
  if (tools === null) return null;
  return <div className="flex shrink-0 items-center gap-0.5 border-l border-[var(--hr-hair)] pl-2">{tools}</div>;
}

/** The scrolling body of a page with the standard gutters. */
export function PageBody({ children, className, wide }: { children: ReactNode; className?: string | undefined; wide?: boolean | undefined }): React.JSX.Element {
  return <div className={cn('mx-auto w-full px-4 pb-24 pt-4 md:px-6 md:pb-10', wide === true ? '' : 'max-w-[1440px]', className)}>{children}</div>;
}

/* ------------------------------------------------------------------ table */

export interface Column<R> {
  key: string;
  label: ReactNode;
  /** CSS grid track, e.g. 'minmax(180px,2fr)' or '120px'. Default '1fr'. */
  width?: string | undefined;
  align?: 'left' | 'right' | 'center' | undefined;
  /** Mono tabular figures (numbers, money, codes). */
  mono?: boolean | undefined;
  /** Value to sort by; the column header becomes a sort button. */
  sort?: ((r: R) => string | number) | undefined;
  render: (r: R) => ReactNode;
  /** Hidden below this width on desktop layouts. */
  hideBelow?: 'lg' | 'xl' | undefined;
  /** On phones: 'title' (first line), 'sub' (second line), 'end' (right side) or 'hide'. Default 'sub'. */
  phone?: 'title' | 'sub' | 'end' | 'hide' | undefined;
}

export interface DataTableProps<R> {
  columns: Column<R>[];
  rows: R[];
  rowKey: (r: R) => string;
  onRowClick?: ((r: R) => void) | undefined;
  /** Row link instead of a click (middle-click opens a tab). */
  rowHref?: ((r: R) => string) | undefined;
  selectable?: boolean | undefined;
  selected?: Set<string> | undefined;
  onSelect?: ((next: Set<string>) => void) | undefined;
  /** The bar shown while rows are selected (bulk actions). */
  selectionBar?: ((ids: string[], clear: () => void) => ReactNode) | undefined;
  empty?: ReactNode;
  /** Scroll pagination: called when the end comes into view and `hasMore`. */
  onMore?: (() => void) | undefined;
  hasMore?: boolean | undefined;
  loadingMore?: boolean | undefined;
  initialSort?: { key: string; dir: 'asc' | 'desc' } | undefined;
  /** Sticky header offset (px) when the page has a sticky bar above. */
  stickyTop?: number | undefined;
  label: string;
  className?: string | undefined;
  rowClass?: ((r: R) => string) | undefined;
  /** Footer row (totals). */
  foot?: ReactNode;
}

/** Nothing to show (a cell that rendered no value). */
function blank(v: ReactNode): boolean {
  return v === null || v === undefined || v === false || v === true || v === '' || (Array.isArray(v) && v.every(blank));
}

/**
 * A stacked row's second line on a phone: the present values with a dot
 * between them. Empty cells are left out, and a dot never starts a wrapped
 * line (every value carries its dot on the left; the box clips the dot of
 * whatever lands first on a line).
 */
function PhoneSub<R>({ cols, row }: { cols: Column<R>[]; row: R }): React.JSX.Element | null {
  const cells = cols.map((c) => ({ c, v: c.render(row) })).filter((x) => !blank(x.v));
  if (cells.length === 0) return null;
  return (
    <div className="mt-0.5 overflow-hidden text-[12px] text-[var(--hr-muted)]">
      <div className="-ml-[13px] flex flex-wrap items-center gap-y-0.5">
        {cells.map(({ c, v }) => (
          <span key={c.key} className={cn('relative min-w-0 max-w-full truncate pl-[13px]', c.mono === true && 'hr-mono hr-num')}>
            <span aria-hidden className="absolute left-[4px] top-0 text-[var(--hr-faint)]">
              {'·'}
            </span>
            {v}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * A table: 40px rows (about 52px with a second line), the first and last
 * columns on the panel's 16px inset, rows that open end in a chevron, a sticky header, sortable columns,
 * selectable rows with a selection bar, mono right-aligned figures, scroll
 * pagination. Below 768px it becomes stacked rows (title, a muted line, the
 * end value).
 */
export function DataTable<R>({ columns, rows, rowKey, onRowClick, rowHref, selectable, selected, onSelect, selectionBar, empty, onMore, hasMore, loadingMore, initialSort, stickyTop = 0, label, className, rowClass, foot }: DataTableProps<R>): React.JSX.Element {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(initialSort ?? null);
  const sentinel = useRef<HTMLDivElement | null>(null);
  const sorted = useMemo(() => {
    if (sort === null) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (col?.sort === undefined) return rows;
    const f = col.sort;
    const out = [...rows].sort((a, b) => {
      const x = f(a);
      const y = f(b);
      const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
      return sort.dir === 'asc' ? r : -r;
    });
    return out;
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
  const hiddenCls = (c: Column<R>): string => (c.hideBelow === 'lg' ? 'hidden lg:flex' : c.hideBelow === 'xl' ? 'hidden xl:flex' : 'flex');
  // Rows that open something end in a chevron column (the same track on every row and the header).
  const opens = onRowClick !== undefined || rowHref !== undefined;
  const tracks = (selectable === true ? '36px ' : '') + columns.map((c) => c.width ?? 'minmax(0,1fr)').join(' ') + (opens ? ' 24px' : '');
  const visibleTracks = (w: 'base' | 'lg' | 'xl'): string =>
    (selectable === true ? '36px ' : '') +
    columns
      .filter((c) => c.hideBelow === undefined || (w === 'lg' && c.hideBelow === 'lg') || w === 'xl')
      .map((c) => c.width ?? 'minmax(0,1fr)')
      .join(' ') +
    (opens ? ' 24px' : '');
  const gridId = useId().replace(/:/g, '');
  const titleCol = columns.find((c) => c.phone === 'title') ?? columns[0];
  const endCol = columns.find((c) => c.phone === 'end');
  const subCols = columns.filter((c) => c !== titleCol && c !== endCol && c.phone !== 'hide');

  if (rows.length === 0 && empty !== undefined) return <div className={className}>{empty}</div>;

  return (
    <div className={cn('min-w-0', className)} role="table" aria-label={label}>
      <style>{`.g${gridId}{grid-template-columns:${visibleTracks('base')}}@media (min-width:1024px){.g${gridId}{grid-template-columns:${visibleTracks('lg')}}}@media (min-width:1280px){.g${gridId}{grid-template-columns:${tracks}}}`}</style>
      {/* desktop */}
      <div className="hidden md:block">
        <div role="row" className={cn(`g${gridId}`, 'sticky z-10 grid h-8 items-center border-b border-[var(--hr-line)] bg-[var(--hr-panel)] px-1')} style={{ top: stickyTop }}>
          {selectable === true && (
            <span className="flex items-center justify-center" role="columnheader">
              <Checkbox checked={allOn} indeterminate={!allOn && someOn} onChange={(v) => onSelect?.(v ? new Set([...sel, ...ids]) : new Set([...sel].filter((x) => !ids.includes(x))))} label={t('table.select_all')} hideLabel />
            </span>
          )}
          {columns.map((c) => {
            const on = sort?.key === c.key;
            const content = (
              <>
                <span className="truncate">{c.label}</span>
                {on && (sort?.dir === 'asc' ? <ArrowUp size={11} aria-hidden /> : <ArrowDown size={11} aria-hidden />)}
              </>
            );
            return (
              <span key={c.key} role="columnheader" aria-sort={on ? (sort?.dir === 'asc' ? 'ascending' : 'descending') : undefined} className={cn(hiddenCls(c), 'hr-label min-w-0 items-center px-3', c.align === 'right' ? 'justify-end text-right' : c.align === 'center' ? 'justify-center' : '')}>
                {c.sort !== undefined ? (
                  <button type="button" onClick={() => setSort(on ? { key: c.key, dir: sort?.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: c.align === 'right' ? 'desc' : 'asc' })} className={cn('hr-focus -mx-1 inline-flex min-w-0 items-center gap-1 rounded-[3px] px-1 py-0.5 uppercase transition-colors hover:bg-[var(--hr-hover)] hover:text-[var(--hr-ink)]', on && 'text-[var(--hr-ink)]')}>
                    {content}
                  </button>
                ) : (
                  content
                )}
              </span>
            );
          })}
          {opens && <span aria-hidden />}
        </div>
        {sorted.map((r) => {
          const id = rowKey(r);
          const on = sel.has(id);
          const clickable = onRowClick !== undefined || rowHref !== undefined;
          const cells = (
            <>
              {selectable === true && (
                <span className="flex items-center justify-center" role="cell">
                  <Checkbox checked={on} onChange={() => toggle(id)} label={t('table.select_row')} hideLabel />
                </span>
              )}
              {columns.map((c) => (
                <span key={c.key} role="cell" className={cn(hiddenCls(c), 'min-w-0 items-center px-3 text-[13px]', c.align === 'right' ? 'justify-end text-right' : c.align === 'center' ? 'justify-center' : '', c.mono === true && 'hr-mono hr-num text-[13px]')}>
                  <span className="min-w-0 truncate">{c.render(r)}</span>
                </span>
              ))}
              {opens && <RowCue className="justify-self-start" />}
            </>
          );
          const cls = cn(`g${gridId}`, 'hr-table-row hr-tap group grid min-h-10 items-center border-b border-[var(--hr-hair)] px-1 py-2.5 last:border-b-0', clickable && 'cursor-pointer hover:bg-[var(--hr-hover)]', on && 'bg-[var(--hr-active)] hover:bg-[var(--hr-active)]', rowClass?.(r));
          if (rowHref !== undefined)
            return (
              <a key={id} role="row" href={rowHref(r)} className={cn(cls, 'hr-focus')}>
                {cells}
              </a>
            );
          return (
            <div key={id} role="row" tabIndex={clickable ? 0 : undefined} onClick={() => onRowClick?.(r)} onKeyDown={(e) => e.key === 'Enter' && onRowClick?.(r)} className={cn(cls, clickable && 'hr-focus')}>
              {cells}
            </div>
          );
        })}
        {foot !== undefined && <div className="border-t border-[var(--hr-line)] bg-[var(--hr-sunk)] px-1">{foot}</div>}
      </div>
      {/* phone */}
      <ul className="md:hidden" aria-label={label}>
        {sorted.map((r) => {
          const id = rowKey(r);
          const on = sel.has(id);
          const clickable = onRowClick !== undefined || rowHref !== undefined;
          const inner = (
            <>
              {selectable === true && (
                <span className="pt-0.5" onClick={(e) => e.stopPropagation()}>
                  <Checkbox checked={on} onChange={() => toggle(id)} label={t('table.select_row')} hideLabel />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="hr-wrap text-[14px] font-medium">{titleCol?.render(r)}</div>
                {subCols.length > 0 && <PhoneSub cols={subCols} row={r} />}
              </div>
              {endCol !== undefined && <div className={cn('shrink-0 text-right text-[13px]', endCol.mono === true && 'hr-mono hr-num')}>{endCol.render(r)}</div>}
              {clickable && <RowCue className="self-center" />}
            </>
          );
          const cls = cn('group flex min-h-14 items-start gap-3 border-b border-[var(--hr-hair)] px-4 py-3 last:border-b-0', clickable && 'cursor-pointer hover:bg-[var(--hr-hover)]', on && 'bg-[var(--hr-active)]');
          return (
            <li key={id}>
              {rowHref !== undefined ? (
                <a href={rowHref(r)} className={cn(cls, 'hr-focus')}>
                  {inner}
                </a>
              ) : (
                <div onClick={() => onRowClick?.(r)} className={cls}>
                  {inner}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {hasMore === true && (
        <div ref={sentinel} className="flex h-12 items-center justify-center text-[var(--hr-muted)]">
          {loadingMore === true && <Spinner />}
        </div>
      )}
      {selectable === true && sel.size > 0 && selectionBar !== undefined && (
        <div className="hr-up fixed bottom-[calc(72px+env(safe-area-inset-bottom))] left-1/2 z-40 flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-2 rounded-[var(--hr-radius)] border border-[var(--hr-line)] bg-[var(--hr-raised)] py-1.5 pl-3 pr-1.5 shadow-[var(--hr-shadow-lg)] md:bottom-6">
          <span className="hr-num shrink-0 whitespace-nowrap text-[12px]">{t('table.selected', { n: sel.size })}</span>
          <span className="h-5 w-px bg-[var(--hr-hair)]" />
          {selectionBar([...sel], () => onSelect?.(new Set()))}
          <IconButton icon={X} label={t('table.clear_selection')} onClick={() => onSelect?.(new Set())} size={28} />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- logo */

/**
 * The company logo (settings.logo, public), always an <img>, never inline
 * SVG. `light` and `dark` are the stored files ('' = none) and version the
 * URL; with both, the theme picks one, with one, it shows in both themes.
 */
export function CompanyLogo({ light, dark, height, alt, className, print }: { light: string; dark: string; height: number; alt: string; className?: string | undefined; print?: boolean | undefined }): React.JSX.Element | null {
  if (light === '' && dark === '') return null;
  const src = (forDark: boolean): string => {
    const q = new URLSearchParams({ v: forDark ? dark || light : light || dark });
    if (forDark) q.set('dark', 'true');
    return getPbClient().pb.buildURL('/api/ops/settings/logo') + '?' + q.toString();
  };
  const cls = cn('block w-auto max-w-[180px] shrink-0 object-contain object-left', className);
  // Paper is white: a printed document takes the light logo.
  if (print === true || dark === '' || light === '') return <img src={src(print !== true && light === '')} alt={alt} style={{ height }} className={cls} />;
  return (
    <>
      <img src={src(false)} alt={alt} style={{ height }} className={cn(cls, 'dark:hidden')} />
      <img src={src(true)} alt={alt} style={{ height }} className={cn(cls, 'hidden dark:block')} />
    </>
  );
}

/* ------------------------------------------------------------------ files */

/** A drop zone and file button. */
export function FileDrop({ onFiles, accept, label, multiple, className, children }: { onFiles: (files: File[]) => void; accept?: string | undefined; label: string; multiple?: boolean | undefined; className?: string | undefined; children?: ReactNode }): React.JSX.Element {
  const ref = useRef<HTMLInputElement | null>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) onFiles(multiple === true ? files : files.slice(0, 1));
      }}
      className={cn('flex flex-col items-center justify-center gap-2 rounded-[var(--hr-radius)] border border-dashed px-4 py-6 text-center transition-colors', over ? 'border-[var(--hr-ink-2)] bg-[var(--hr-hover)]' : 'border-[var(--hr-line-2)]', className)}
    >
      {children}
      <Button onClick={() => ref.current?.click()}>{label}</Button>
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

/* ------------------------------------------------------------------- misc */

/** A row of key facts separated by thin rules (profile header, run header). */
export function FactStrip({ items, className }: { items: { label: ReactNode; value: ReactNode; mono?: boolean | undefined }[]; className?: string | undefined }): React.JSX.Element {
  return (
    <div className={cn('grid grid-cols-2 gap-x-6 gap-y-3 sm:flex sm:flex-wrap sm:gap-x-8', className)}>
      {items.map((it, i) => (
        <Fact key={i} label={it.label} mono={it.mono}>
          {it.value}
        </Fact>
      ))}
    </div>
  );
}

/** A labelled section inside a panel or sheet. */
export function Section({ title, aside, children, className }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string | undefined }): React.JSX.Element {
  return (
    <section className={cn('min-w-0', className)}>
      <div className="mb-2 flex items-center gap-2 border-b border-[var(--hr-hair)] pb-1.5">
        <span className="hr-label min-w-0 flex-1 truncate">{title}</span>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** "Your AI agent" as a small black square with the star. */
export function AgentMark({ size = 28, working }: { size?: number | undefined; working?: boolean | 'waiting' | undefined }): React.JSX.Element {
  return (
    <span className="relative inline-flex shrink-0">
      <span className="flex items-center justify-center rounded-[8px] bg-[var(--hr-agent)] text-[var(--hr-agent-ink)]" style={{ width: size, height: size, borderRadius: Math.min(8, size * 0.28) }}>
        <Sparkle size={Math.round(size * 0.56)} strokeWidth={2} aria-hidden />
      </span>
      {working !== undefined && working !== false && <span aria-hidden className={cn('absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-[var(--hr-panel)]', working === true ? 'hr-pulse bg-[var(--hr-good)]' : 'bg-[var(--hr-warn)]')} />}
    </span>
  );
}
