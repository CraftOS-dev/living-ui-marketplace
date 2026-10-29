/**
 * Bookkeeping controls: searchable pickers for accounts, contacts and tax
 * codes, money and date inputs, money display, tabs, panel bars, the AI
 * chip and the confidence meter.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Check as CheckIcon, ChevronDown, Plus, Sparkles } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { ACCOUNT_TYPE_LABEL, money } from '../lib/format.ts';
import { useApp } from '../lib/store.tsx';
import type { Account, Confidence } from '../lib/types.ts';
import { Popover, input } from './ui.tsx';

/* ---------------------------------------------------------------- picker */

export interface PickOption {
  value: string;
  label: string;
  hint?: string | undefined;
  group?: string | undefined;
  search?: string | undefined;
}

/**
 * A searchable picker: a button showing the choice; a popover with a search
 * box and a keyboard-driven list. `create` lets a new name be typed.
 */
export function Picker({
  value,
  onChange,
  options,
  placeholder = 'Choose',
  label,
  create,
  className,
  small = false,
  clearable = false,
  autoOpen = false,
  disabled = false,
}: {
  value: string;
  onChange: (v: string, created?: boolean) => void;
  options: PickOption[];
  placeholder?: string | undefined;
  label: string;
  create?: string | undefined;
  className?: string | undefined;
  small?: boolean | undefined;
  clearable?: boolean | undefined;
  autoOpen?: boolean | undefined;
  disabled?: boolean | undefined;
}): React.JSX.Element {
  const [open, setOpen] = useState(autoOpen);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const anchor = useRef<HTMLButtonElement | null>(null);
  const list = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => {
    setOpen(false);
    setQ('');
  }, []);
  const current = options.find((o) => o.value === value);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t === '') return options;
    const words = t.split(/\s+/);
    return options.filter((o) => {
      const hay = (o.label + ' ' + (o.hint ?? '') + ' ' + (o.search ?? '') + ' ' + (o.group ?? '')).toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [options, q]);
  const canCreate = create !== undefined && q.trim() !== '' && !options.some((o) => o.label.toLowerCase() === q.trim().toLowerCase());
  const total = shown.length + (canCreate ? 1 : 0);
  useEffect(() => setHi(0), [q]);
  useEffect(() => {
    const el = list.current?.querySelector<HTMLElement>(`[data-i="${hi}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [hi]);
  const pick = (i: number): void => {
    if (i < shown.length) {
      const o = shown[i];
      if (o !== undefined) onChange(o.value);
    } else if (canCreate) onChange(q.trim(), true);
    close();
  };
  let lastGroup = '';
  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-label={label}
        title={current !== undefined ? current.label + (current.hint ? ' · ' + current.hint : '') : label}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(input, 'flex items-center gap-1.5 text-left', small && 'h-6 text-[12px]', current === undefined && value === '' && 'text-[var(--lf-muted)]', disabled && 'opacity-50', className)}
      >
        <span className="min-w-0 flex-1 truncate">{current !== undefined ? current.label : value !== '' ? value : placeholder}</span>
        <ChevronDown size={13} className="shrink-0 text-[var(--lf-ink-2)]" aria-hidden />
      </button>
      <Popover open={open} onClose={close} anchor={anchor} className="w-[min(92vw,320px)] p-0">
        <div className="border-b border-[var(--lf-hair)] p-1.5">
          <input
            autoFocus
            value={q}
            placeholder={create !== undefined ? 'Search or type a new name' : 'Search'}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHi((h) => Math.min(total - 1, h + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHi((h) => Math.max(0, h - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                if (total > 0) pick(hi);
              }
            }}
            className={cn(input, 'h-7')}
          />
        </div>
        <div ref={list} role="listbox" className="max-h-[300px] overflow-y-auto p-1">
          {clearable && value !== '' && (
            <button type="button" onClick={() => (onChange(''), close())} className="flex h-7 w-full items-center rounded-[4px] px-2 text-left text-[12.5px] text-[var(--lf-muted)] hover:bg-[var(--lf-row)]">
              None
            </button>
          )}
          {shown.map((o, i) => {
            const head = o.group !== undefined && o.group !== lastGroup ? o.group : null;
            if (o.group !== undefined) lastGroup = o.group;
            return (
              <div key={o.value}>
                {head !== null && <div className="px-2 pb-0.5 pt-1.5 text-[10.5px] font-bold uppercase tracking-[0.05em] text-[var(--lf-muted)]">{head}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  data-i={i}
                  onMouseEnter={() => setHi(i)}
                  onClick={() => pick(i)}
                  className={cn('flex min-h-7 w-full items-center gap-2 rounded-[4px] px-2 py-1 text-left text-[12.5px]', i === hi ? 'bg-[var(--lf-row-hover)]' : '')}
                >
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.hint !== undefined && o.hint !== '' && <span className="shrink-0 truncate text-[11.5px] text-[var(--lf-muted)]">{o.hint}</span>}
                  {o.value === value && <CheckIcon size={13} strokeWidth={2.4} className="shrink-0" />}
                </button>
              </div>
            );
          })}
          {canCreate && (
            <button
              type="button"
              data-i={shown.length}
              onMouseEnter={() => setHi(shown.length)}
              onClick={() => pick(shown.length)}
              className={cn('flex h-7 w-full items-center gap-2 rounded-[4px] px-2 text-left text-[12.5px] font-semibold', hi === shown.length ? 'bg-[var(--lf-row-hover)]' : '')}
            >
              <Plus size={13} /> {create} “{q.trim()}”
            </button>
          )}
          {total === 0 && <p className="px-2 py-3 text-center text-[12px] text-[var(--lf-muted)]">Nothing matches</p>}
        </div>
      </Popover>
    </>
  );
}

const TYPE_ORDER = ['expense', 'income', 'asset', 'liability', 'equity'];

/** Accounts as picker options, grouped by type. */
export function accountOptions(accounts: Account[], filter?: (a: Account) => boolean, order: string[] = TYPE_ORDER): PickOption[] {
  return accounts
    .filter((a) => !a.archived && (filter === undefined || filter(a)))
    .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || (a.code < b.code ? -1 : 1))
    .map((a) => ({ value: a.id, label: a.name, hint: a.code, group: ACCOUNT_TYPE_LABEL[a.type] ?? a.type, search: a.description }));
}

export const isCash = (a: Account): boolean => a.subtype === 'bank' || a.subtype === 'cash' || a.subtype === 'card';
export const isCategory = (a: Account): boolean => (a.type === 'income' || a.type === 'expense') && a.system !== 'rounding';
/** Accounts a person may post to by hand (not receivables, payables, retained earnings). */
export const isPostable = (a: Account): boolean => a.system !== 'ar' && a.system !== 'ap' && a.system !== 'retained';

export function AccountPicker({ value, onChange, filter, label = 'Account', placeholder = 'Account', className, small, autoOpen, clearable, order }: { value: string; onChange: (v: string) => void; filter?: ((a: Account) => boolean) | undefined; label?: string | undefined; placeholder?: string | undefined; className?: string | undefined; small?: boolean | undefined; autoOpen?: boolean | undefined; clearable?: boolean | undefined; order?: string[] | undefined }): React.JSX.Element {
  const app = useApp();
  const options = useMemo(() => accountOptions(app.accounts, filter, order), [app.accounts, filter, order]);
  return <Picker value={value} onChange={onChange} options={options} label={label} placeholder={placeholder} className={className} small={small} autoOpen={autoOpen} clearable={clearable} />;
}

export function ContactPicker({ value, onChange, kind, label = 'Contact', placeholder = 'Contact', className, small }: { value: string; onChange: (v: string, created?: boolean) => void; kind?: 'customer' | 'vendor' | undefined; label?: string | undefined; placeholder?: string | undefined; className?: string | undefined; small?: boolean | undefined }): React.JSX.Element {
  const app = useApp();
  const options = useMemo(
    () =>
      app.contacts
        .filter((c) => kind === undefined || c.kind === kind || c.kind === 'both' || c.kind === 'other')
        .map((c) => ({ value: c.id, label: c.name, hint: c.email, search: c.aliases.join(' ') })),
    [app.contacts, kind],
  );
  return <Picker value={value} onChange={onChange} options={options} label={label} placeholder={placeholder} create="Add" className={className} small={small} clearable />;
}

export function TaxPicker({ value, onChange, scope, className, small }: { value: string; onChange: (v: string) => void; scope?: 'sales' | 'purchases' | undefined; className?: string | undefined; small?: boolean | undefined }): React.JSX.Element {
  const app = useApp();
  const options = useMemo(
    () =>
      app.taxCodes
        .filter((t) => scope === undefined || t.scope === 'both' || t.scope === scope)
        .map((t) => ({ value: t.id, label: t.code, hint: t.rate + '%', search: t.name + ' ' + t.description })),
    [app.taxCodes, scope],
  );
  return <Picker value={value} onChange={onChange} options={options} label="Tax code" placeholder="No tax" className={className} small={small} clearable />;
}

/* ---------------------------------------------------------------- inputs */

export function MoneyInput({ value, onChange, placeholder = '0.00', className, autoFocus, label, onEnter }: { value: string; onChange: (v: string) => void; placeholder?: string | undefined; className?: string | undefined; autoFocus?: boolean | undefined; label?: string | undefined; onEnter?: (() => void) | undefined }): React.JSX.Element {
  return (
    <input
      inputMode="decimal"
      aria-label={label}
      autoFocus={autoFocus}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value.replace(/[^\d.,\-()]/g, ''))}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && onEnter !== undefined) onEnter();
      }}
      className={cn(input, 'num text-right', className)}
    />
  );
}

export function DateInput({ value, onChange, className, label }: { value: string; onChange: (v: string) => void; className?: string | undefined; label?: string | undefined }): React.JSX.Element {
  return <input type="date" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={cn(input, 'num', className)} />;
}

export function Check({ checked, onChange, label, indeterminate = false }: { checked: boolean; onChange: (v: boolean) => void; label: string; indeterminate?: boolean | undefined }): React.JSX.Element {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={cn('inline-flex size-[15px] shrink-0 items-center justify-center rounded-[4px] border transition-colors', checked || indeterminate ? 'border-[var(--lf-ink)] bg-[var(--lf-ink)] text-[var(--lf-card)]' : 'border-[var(--lf-line)] bg-[var(--lf-card)] hover:border-[var(--lf-ink-2)]')}
    >
      {checked && <CheckIcon size={11} strokeWidth={3} />}
      {!checked && indeterminate && <span className="h-[2px] w-[7px] rounded bg-current" />}
    </button>
  );
}

/* --------------------------------------------------------------- display */

/** An amount: tabular, right aligned by the caller; money in can be marked green. */
export function Money({ value, currency, tone = 'none', sign = false, className, bold = false }: { value: number | null | undefined; currency?: string | undefined; tone?: 'none' | 'in' | 'neg' | undefined; sign?: boolean | undefined; className?: string | undefined; bold?: boolean | undefined }): React.JSX.Element {
  const v = value ?? 0;
  return (
    <span className={cn('num whitespace-nowrap', bold && 'font-bold', tone === 'in' && v > 0 && 'text-[var(--lf-pos-text)]', tone === 'neg' && v < 0 && 'text-[var(--lf-neg-text)]', className)}>
      {money(value, currency, { sign })}
    </span>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs, className }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string; count?: number | undefined }[]; className?: string | undefined }): React.JSX.Element {
  return (
    <div role="tablist" className={cn('flex min-w-0 items-stretch gap-3 overflow-x-auto', className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={t.value === value}
          onClick={() => onChange(t.value)}
          className={cn('relative flex h-full shrink-0 items-center gap-1.5 whitespace-nowrap text-[12.5px] font-semibold transition-colors', t.value === value ? 'text-[var(--lf-ink)]' : 'text-[var(--lf-muted)] hover:text-[var(--lf-ink)]')}
        >
          {t.label}
          {t.count !== undefined && t.count > 0 && <span className="num rounded-[4px] bg-[var(--lf-row-hover)] px-1 text-[10.5px] font-bold text-[var(--lf-ink-2)]">{t.count > 999 ? '999+' : t.count}</span>}
          {t.value === value && <span aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] rounded-t bg-[var(--lf-ink)]" />}
        </button>
      ))}
    </div>
  );
}

/** A panel's header row. */
export function Bar({ children, className }: { children: ReactNode; className?: string | undefined }): React.JSX.Element {
  return <div className={cn('flex h-10 shrink-0 items-center gap-2 border-b border-[var(--lf-line)] px-3', className)}>{children}</div>;
}

export function BarTitle({ icon: Icon, children, sub }: { icon?: LucideIcon | undefined; children: ReactNode; sub?: ReactNode | undefined }): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {Icon !== undefined && <Icon size={15} strokeWidth={2} className="shrink-0 text-[var(--lf-ink-2)]" aria-hidden />}
      <span className="truncate text-[13px] font-bold">{children}</span>
      {sub !== undefined && <span className="truncate text-[12px] text-[var(--lf-muted)]">{sub}</span>}
    </div>
  );
}

/** A label over a value, for header strips. */
export function Stat({ icon: Icon, label, children, tone = 'none', onClick, active = false }: { icon?: LucideIcon | undefined; label: string; children: ReactNode; tone?: 'none' | 'neg' | 'pos' | 'warn' | 'accent' | undefined; onClick?: (() => void) | undefined; active?: boolean | undefined }): React.JSX.Element {
  const body = (
    <>
      <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-[var(--lf-muted)]">
        {Icon !== undefined && <Icon size={12} strokeWidth={2.2} className="shrink-0" />}
        <span className="truncate">{label}</span>
      </span>
      <span className={cn('num text-[15px] font-bold leading-5', tone === 'neg' && 'text-[var(--lf-neg-text)]', tone === 'pos' && 'text-[var(--lf-pos-text)]', tone === 'warn' && 'text-[var(--lf-warn-text)]', tone === 'accent' && 'text-[var(--lf-accent-text)]')}>{children}</span>
    </>
  );
  if (onClick === undefined) return <div className="flex min-w-0 flex-col gap-0.5 px-3 py-2">{body}</div>;
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={cn('flex min-w-0 flex-col gap-0.5 px-3 py-2 text-left transition-colors hover:bg-[var(--lf-row)]', active && 'bg-[var(--lf-row-hover)]')}>
      {body}
    </button>
  );
}

/** What the AI agent proposed or did. */
export function AiChip({ title, children = 'AI' }: { title?: string | undefined; children?: ReactNode | undefined }): React.JSX.Element {
  return (
    <span title={title} className="inline-flex h-[18px] shrink-0 items-center gap-1 rounded-[4px] bg-[var(--lf-accent-soft)] px-1.5 text-[10.5px] font-bold text-[var(--lf-accent-text)]">
      <Sparkles size={10} strokeWidth={2.4} aria-hidden />
      {children}
    </span>
  );
}

/** Confidence as three bars (high, medium, low). */
export function Confidence({ value }: { value: Confidence | '' | undefined }): React.JSX.Element | null {
  if (value === undefined || value === '') return null;
  const n = value === 'high' ? 3 : value === 'medium' ? 2 : 1;
  return (
    <span title={value + ' confidence'} aria-label={value + ' confidence'} className="inline-flex shrink-0 items-end gap-[2px]">
      {[1, 2, 3].map((i) => (
        <span key={i} style={{ height: 3 + i * 2 }} className={cn('w-[3px] rounded-[1px]', i <= n ? (value === 'low' ? 'bg-[var(--lf-warn)]' : 'bg-[var(--lf-ink-2)]') : 'bg-[var(--lf-line)]')} />
      ))}
    </span>
  );
}

/** A thin bar of a share (0..1). */
export function ShareBar({ value, tone = 'ink' }: { value: number; tone?: 'ink' | 'accent' | 'neg' | 'pos' | undefined }): React.JSX.Element {
  return (
    <span className="relative inline-block h-[5px] w-full overflow-hidden rounded-full bg-[var(--lf-row-hover)]">
      <span
        className={cn('absolute inset-y-0 left-0 rounded-full', tone === 'ink' && 'bg-[var(--lf-ink-2)]', tone === 'accent' && 'bg-[var(--lf-accent)]', tone === 'neg' && 'bg-[var(--lf-neg)]', tone === 'pos' && 'bg-[var(--lf-pos)]')}
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
      />
    </span>
  );
}

/** A key/value row in an inspector. */
export function KV({ k, children, className }: { k: string; children: ReactNode; className?: string | undefined }): React.JSX.Element {
  return (
    <div className={cn('flex min-h-7 items-start gap-3 py-1', className)}>
      <span className="w-[96px] shrink-0 pt-px text-[12px] text-[var(--lf-muted)]">{k}</span>
      <span className="min-w-0 flex-1 text-[12.5px]">{children}</span>
    </div>
  );
}

/** A small uppercase heading inside a panel. */
export function Heading({ children, action }: { children: ReactNode; action?: ReactNode | undefined }): React.JSX.Element {
  return (
    <div className="flex h-7 items-center justify-between gap-2">
      <span className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-[var(--lf-muted)]">{children}</span>
      {action}
    </div>
  );
}
