/**
 * CRM controls: a searchable picker (and record pickers that search the
 * server as you type), money, date and tag inputs, avatars, relationship
 * strength bars, the mark on values the AI agent wrote, tabs, panel bars,
 * the AI chip and the confidence meter.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Building2, Check as CheckIcon, ChevronDown, Plus, Sparkles, X } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { STRENGTH_LABEL, ago, hue, initials, money, strengthBand } from '../lib/format.ts';
import type { Confidence, Obj, Prov } from '../lib/types.ts';
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
  onQuery,
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
  onQuery?: ((q: string) => void) | undefined;
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
  useEffect(() => onQuery?.(q.trim()), [q, onQuery]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t === '' || onQuery !== undefined) return options;
    const words = t.split(/\s+/);
    return options.filter((o) => {
      const hay = (o.label + ' ' + (o.hint ?? '') + ' ' + (o.search ?? '') + ' ' + (o.group ?? '')).toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [options, q, onQuery]);
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
        className={cn(input, 'flex items-center gap-1.5 text-left', small && 'h-6 text-[12px]', current === undefined && value === '' && 'text-[var(--cr-muted)]', disabled && 'opacity-50', className)}
      >
        <span className="min-w-0 flex-1 truncate">{current !== undefined ? current.label : value !== '' ? value : placeholder}</span>
        <ChevronDown size={13} className="shrink-0 text-[var(--cr-ink-2)]" aria-hidden />
      </button>
      <Popover open={open} onClose={close} anchor={anchor} className="w-[min(92vw,320px)] p-0">
        <div className="border-b border-[var(--cr-hair)] p-1.5">
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
            <button type="button" onClick={() => (onChange(''), close())} className="flex h-7 w-full items-center rounded-[4px] px-2 text-left text-[12.5px] text-[var(--cr-muted)] hover:bg-[var(--cr-row)]">
              None
            </button>
          )}
          {shown.map((o, i) => {
            const head = o.group !== undefined && o.group !== lastGroup ? o.group : null;
            if (o.group !== undefined) lastGroup = o.group;
            return (
              <div key={o.value}>
                {head !== null && <div className="px-2 pb-0.5 pt-1.5 text-[10.5px] font-bold uppercase tracking-[0.05em] text-[var(--cr-muted)]">{head}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  data-i={i}
                  onMouseEnter={() => setHi(i)}
                  onClick={() => pick(i)}
                  className={cn('flex min-h-7 w-full items-center gap-2 rounded-[4px] px-2 py-1 text-left text-[12.5px]', i === hi ? 'bg-[var(--cr-row-hover)]' : '')}
                >
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.hint !== undefined && o.hint !== '' && <span className="shrink-0 truncate text-[11.5px] text-[var(--cr-muted)]">{o.hint}</span>}
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
              className={cn('flex h-7 w-full items-center gap-2 rounded-[4px] px-2 text-left text-[12.5px] font-semibold', hi === shown.length ? 'bg-[var(--cr-row-hover)]' : '')}
            >
              <Plus size={13} /> {create} “{q.trim()}”
            </button>
          )}
          {total === 0 && <p className="px-2 py-3 text-center text-[12px] text-[var(--cr-muted)]">Nothing matches</p>}
        </div>
      </Popover>
    </>
  );
}

/**
 * A picker over people, companies or deals that searches the server as you
 * type. `create` lets a new company name (or an email for people) be used.
 */
export function RecordPicker({
  object,
  value,
  valueLabel,
  onChange,
  label,
  placeholder,
  create,
  className,
  small,
  clearable = true,
}: {
  object: Obj;
  value: string;
  valueLabel?: string | undefined;
  onChange: (id: string, label: string, created?: boolean) => void;
  label: string;
  placeholder?: string | undefined;
  create?: string | undefined;
  className?: string | undefined;
  small?: boolean | undefined;
  clearable?: boolean | undefined;
}): React.JSX.Element {
  const [q, setQ] = useState('');
  const [options, setOptions] = useState<PickOption[]>([]);
  const seq = useRef(0);
  useEffect(() => {
    const mine = ++seq.current;
    const t = setTimeout(
      () => {
        const load = object === 'people' ? api.people({ q, limit: 30, sort: 'last_interaction', dir: 'desc' }).then((r) => r.people.map((p) => ({ value: p.id, label: p.name, hint: p.company_name || p.email }))) : object === 'companies' ? api.companies({ q, limit: 30 }).then((r) => r.companies.map((c) => ({ value: c.id, label: c.name, hint: c.domain }))) : api.deals({ q, limit: 30, status: 'open' }).then((r) => r.deals.map((d) => ({ value: d.id, label: d.name, hint: d.company_name || d.stage_name })));
        load.then((o) => mine === seq.current && setOptions(o)).catch(() => undefined);
      },
      q === '' ? 0 : 180,
    );
    return () => clearTimeout(t);
  }, [q, object]);
  const opts = useMemo(() => (value !== '' && !options.some((o) => o.value === value) ? [{ value, label: valueLabel ?? value }, ...options] : options), [options, value, valueLabel]);
  return (
    <Picker
      value={value}
      onChange={(v, created) => onChange(v, created ? v : (opts.find((o) => o.value === v)?.label ?? v), created)}
      options={opts}
      label={label}
      placeholder={placeholder ?? label}
      create={create}
      className={className}
      small={small}
      clearable={clearable}
      onQuery={setQ}
    />
  );
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
      className={cn('inline-flex size-[15px] shrink-0 items-center justify-center rounded-[4px] border transition-colors', checked || indeterminate ? 'border-[var(--cr-ink)] bg-[var(--cr-ink)] text-[var(--cr-card)]' : 'border-[var(--cr-line)] bg-[var(--cr-card)] hover:border-[var(--cr-ink-2)]')}
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
    <span className={cn('num whitespace-nowrap', bold && 'font-bold', tone === 'in' && v > 0 && 'text-[var(--cr-pos-text)]', tone === 'neg' && v < 0 && 'text-[var(--cr-neg-text)]', className)}>
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
          className={cn('relative flex h-full shrink-0 items-center gap-1.5 whitespace-nowrap text-[12.5px] font-semibold transition-colors', t.value === value ? 'text-[var(--cr-ink)]' : 'text-[var(--cr-muted)] hover:text-[var(--cr-ink)]')}
        >
          {t.label}
          {t.count !== undefined && t.count > 0 && <span className="num rounded-[4px] bg-[var(--cr-row-hover)] px-1 text-[10.5px] font-bold text-[var(--cr-ink-2)]">{t.count > 999 ? '999+' : t.count}</span>}
          {t.value === value && <span aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] rounded-t bg-[var(--cr-ink)]" />}
        </button>
      ))}
    </div>
  );
}

/** A panel's header row. */
export function Bar({ children, className }: { children: ReactNode; className?: string | undefined }): React.JSX.Element {
  return <div className={cn('flex h-10 shrink-0 items-center gap-2 border-b border-[var(--cr-line)] px-3', className)}>{children}</div>;
}

export function BarTitle({ icon: Icon, children, sub }: { icon?: LucideIcon | undefined; children: ReactNode; sub?: ReactNode | undefined }): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {Icon !== undefined && <Icon size={15} strokeWidth={2} className="shrink-0 text-[var(--cr-ink-2)]" aria-hidden />}
      <span className="truncate text-[13px] font-bold">{children}</span>
      {sub !== undefined && <span className="truncate text-[12px] text-[var(--cr-muted)]">{sub}</span>}
    </div>
  );
}

/** A label over a value, for header strips. */
export function Stat({ icon: Icon, label, children, tone = 'none', onClick, active = false }: { icon?: LucideIcon | undefined; label: string; children: ReactNode; tone?: 'none' | 'neg' | 'pos' | 'warn' | 'accent' | undefined; onClick?: (() => void) | undefined; active?: boolean | undefined }): React.JSX.Element {
  const body = (
    <>
      <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-[var(--cr-muted)]">
        {Icon !== undefined && <Icon size={12} strokeWidth={2.2} className="shrink-0" />}
        <span className="truncate">{label}</span>
      </span>
      <span className={cn('num text-[15px] font-bold leading-5', tone === 'neg' && 'text-[var(--cr-neg-text)]', tone === 'pos' && 'text-[var(--cr-pos-text)]', tone === 'warn' && 'text-[var(--cr-warn-text)]', tone === 'accent' && 'text-[var(--cr-accent-text)]')}>{children}</span>
    </>
  );
  if (onClick === undefined) return <div className="flex min-w-0 flex-col gap-0.5 px-3 py-2">{body}</div>;
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={cn('flex min-w-0 flex-col gap-0.5 px-3 py-2 text-left transition-colors hover:bg-[var(--cr-row)]', active && 'bg-[var(--cr-row-hover)]')}>
      {body}
    </button>
  );
}

/** What the AI agent proposed or did. */
export function AiChip({ title, children = 'AI' }: { title?: string | undefined; children?: ReactNode | undefined }): React.JSX.Element {
  return (
    <span title={title} className="inline-flex h-[18px] shrink-0 items-center gap-1 rounded-[4px] bg-[var(--cr-accent-soft)] px-1.5 text-[10.5px] font-bold text-[var(--cr-accent-text)]">
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
        <span key={i} style={{ height: 3 + i * 2 }} className={cn('w-[3px] rounded-[1px]', i <= n ? (value === 'low' ? 'bg-[var(--cr-warn)]' : 'bg-[var(--cr-ink-2)]') : 'bg-[var(--cr-line)]')} />
      ))}
    </span>
  );
}

/** A thin bar of a share (0..1). */
export function ShareBar({ value, tone = 'ink' }: { value: number; tone?: 'ink' | 'accent' | 'neg' | 'pos' | undefined }): React.JSX.Element {
  return (
    <span className="relative inline-block h-[5px] w-full overflow-hidden rounded-full bg-[var(--cr-row-hover)]">
      <span
        className={cn('absolute inset-y-0 left-0 rounded-full', tone === 'ink' && 'bg-[var(--cr-ink-2)]', tone === 'accent' && 'bg-[var(--cr-accent)]', tone === 'neg' && 'bg-[var(--cr-neg)]', tone === 'pos' && 'bg-[var(--cr-pos)]')}
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
      />
    </span>
  );
}

/** A key/value row in an inspector. */
export function KV({ k, children, className }: { k: string; children: ReactNode; className?: string | undefined }): React.JSX.Element {
  return (
    <div className={cn('flex min-h-7 items-start gap-3 py-1', className)}>
      <span className="w-[96px] shrink-0 pt-px text-[12px] text-[var(--cr-muted)]">{k}</span>
      <span className="min-w-0 flex-1 text-[12.5px]">{children}</span>
    </div>
  );
}

/** A small uppercase heading inside a panel. */
export function Heading({ children, action }: { children: ReactNode; action?: ReactNode | undefined }): React.JSX.Element {
  return (
    <div className="flex h-7 items-center justify-between gap-2">
      <span className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-[var(--cr-muted)]">{children}</span>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------ people */

/** A round avatar with initials on a muted category tint. */
export function Avatar({ name, size = 22, square = false, className }: { name: string; size?: number | undefined; square?: boolean | undefined; className?: string | undefined }): React.JSX.Element {
  const h = hue(name || '?');
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.4)), background: `color-mix(in oklab, var(--cr-c${h}) 22%, var(--cr-card))`, color: `color-mix(in oklab, var(--cr-c${h}) 70%, var(--cr-ink))` }}
      className={cn('inline-flex shrink-0 select-none items-center justify-center font-bold leading-none', square ? 'rounded-[5px]' : 'rounded-full', className)}
    >
      {initials(name || '?')}
    </span>
  );
}

/** A company mark: a square tile with initials (no external logos). */
export function CompanyMark({ name, size = 22 }: { name: string; size?: number | undefined }): React.JSX.Element {
  if (name === '')
    return (
      <span style={{ width: size, height: size }} className="inline-flex shrink-0 items-center justify-center rounded-[5px] bg-[var(--cr-row-hover)] text-[var(--cr-muted)]">
        <Building2 size={Math.round(size * 0.55)} />
      </span>
    );
  return <Avatar name={name} size={size} square />;
}

/** Relationship strength as three bars (strong, good, weak). */
export function StrengthBars({ value, showLabel = false }: { value: number; showLabel?: boolean | undefined }): React.JSX.Element {
  const band = strengthBand(value);
  const n = band === 'strong' ? 3 : band === 'good' ? 2 : band === 'weak' ? 1 : 0;
  const color = band === 'strong' ? 'var(--cr-pos)' : band === 'good' ? 'var(--cr-c1)' : 'var(--cr-warn)';
  return (
    <span title={STRENGTH_LABEL[band] + ' relationship (' + value + '/100)'} className="inline-flex items-center gap-1.5">
      <span className="inline-flex items-end gap-[2px]" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span key={i} style={{ height: 3 + i * 3, background: i <= n ? color : 'var(--cr-line)' }} className="w-[3px] rounded-[1px]" />
        ))}
      </span>
      {showLabel && <span className="text-[11.5px] text-[var(--cr-ink-2)]">{STRENGTH_LABEL[band]}</span>}
    </span>
  );
}

/** The mark on a value the AI agent wrote: hover tells when, in which run, from which source. */
export function ProvMark({ prov }: { prov: Prov | undefined }): React.JSX.Element | null {
  if (prov === undefined || prov.by !== 'agent') return null;
  return (
    <span title={'Written by your AI agent ' + ago(prov.at) + (prov.source ? ' from ' + prov.source : '') + (prov.run ? ' (run ' + prov.run.slice(-5) + ')' : '')} className="inline-flex shrink-0 items-center text-[var(--cr-accent-text)]">
      <Sparkles size={11} strokeWidth={2.4} aria-label="Written by your AI agent" />
    </span>
  );
}

/** Tags as removable chips with an input to add one. */
export function TagsInput({ value, onChange, placeholder = 'Add a tag' }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string | undefined }): React.JSX.Element {
  const [t, setT] = useState('');
  const add = (): void => {
    const v = t.trim();
    if (v !== '' && !value.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...value, v]);
    setT('');
  };
  return (
    <div className={cn(input, 'flex h-auto min-h-7 flex-wrap items-center gap-1 py-1')}>
      {value.map((x) => (
        <span key={x} className="inline-flex h-5 items-center gap-1 rounded-[4px] bg-[var(--cr-row-hover)] pl-1.5 pr-0.5 text-[11.5px] font-semibold">
          {x}
          <button type="button" aria-label={'Remove ' + x} onClick={() => onChange(value.filter((y) => y !== x))} className="rounded-[3px] p-px text-[var(--cr-muted)] hover:text-[var(--cr-ink)]">
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        value={t}
        onChange={(e) => setT(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add();
          } else if (e.key === 'Backspace' && t === '' && value.length > 0) onChange(value.slice(0, -1));
        }}
        onBlur={add}
        placeholder={value.length === 0 ? placeholder : ''}
        className="min-w-[80px] flex-1 bg-transparent text-[12.5px] outline-none"
      />
    </div>
  );
}

/** A tag chip. */
export function Tag({ children }: { children: ReactNode }): React.JSX.Element {
  return <span className="inline-flex h-[18px] shrink-0 items-center rounded-[4px] border border-[var(--cr-line)] px-1.5 text-[11px] font-semibold text-[var(--cr-ink-2)]">{children}</span>;
}

/** A small colored dot (stage, list). */
export function Dot({ color, size = 8 }: { color: string; size?: number | undefined }): React.JSX.Element {
  return <span aria-hidden style={{ width: size, height: size, background: color }} className="inline-block shrink-0 rounded-full" />;
}
