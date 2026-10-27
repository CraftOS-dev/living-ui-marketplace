/**
 * In-app pickers (no native date inputs: they cannot be opened reliably
 * inside the host's frame): a date picker with Today, Tomorrow and a month
 * grid, a picker for records (areas, goals, projects) with search, a time
 * field and a weekday chooser.
 */
import { useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { addDays, addMonths, fmtDay, MONTHS, parseDay, relDay, WD1 } from '../lib/format.ts';
import { Popover } from './ui.tsx';

/** A month grid for picking a day. */
export function MonthGrid({ value, today, onPick, weekStartsOn = 1, marks }: { value: string; today: string; onPick: (d: string) => void; weekStartsOn?: number | undefined; marks?: Record<string, ReactNode> | undefined }): React.JSX.Element {
  const [month, setMonth] = useState((value || today).slice(0, 7) + '-01');
  const cells = useMemo(() => {
    const first = parseDay(month);
    const offset = (first.getDay() - weekStartsOn + 7) % 7;
    const start = addDays(month, -offset);
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [month, weekStartsOn]);
  const m = parseDay(month);
  const heads = Array.from({ length: 7 }, (_, i) => WD1[(i + weekStartsOn) % 7]);
  return (
    <div className="w-[264px] select-none">
      <div className="mb-1 flex items-center justify-between px-1">
        <button type="button" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))} className="flex size-7 items-center justify-center rounded-full text-[var(--lo-ink-2)] hover:bg-[var(--lo-sunk)]">
          <ChevronLeft size={16} />
        </button>
        <span className="serif text-[14px] font-semibold">
          {MONTHS[m.getMonth()]} {m.getFullYear()}
        </span>
        <button type="button" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))} className="flex size-7 items-center justify-center rounded-full text-[var(--lo-ink-2)] hover:bg-[var(--lo-sunk)]">
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {heads.map((h, i) => (
          <span key={i} className="pb-1 text-[12px] font-bold text-[var(--lo-muted)]">
            {h}
          </span>
        ))}
        {cells.map((d) => {
          const out = d.slice(0, 7) !== month.slice(0, 7);
          const sel = d === value;
          const isToday = d === today;
          return (
            <button
              key={d}
              type="button"
              onClick={() => onPick(d)}
              className={cn(
                'relative flex h-8 items-center justify-center rounded-full text-[13px] font-semibold transition-colors',
                sel ? 'bg-[var(--lo-primary)] text-white' : isToday ? 'bg-[var(--lo-moss-soft)] text-[var(--lo-moss-text)]' : 'hover:bg-[var(--lo-sunk)]',
                out && !sel && 'text-[var(--lo-muted)]',
              )}
            >
              {parseDay(d).getDate()}
              {marks?.[d] !== undefined && <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2">{marks[d]}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A date chip that opens a picker: Today, Tomorrow, next week, a day, and clearing it. */
export function DateButton({
  value,
  onChange,
  today,
  placeholder = 'Pick a day',
  icon: Icon = CalendarDays,
  clearable = true,
  extra,
  tone = 'neutral',
  size = 'md',
  label,
}: {
  value: string;
  onChange: (d: string) => void;
  today: string;
  placeholder?: string | undefined;
  icon?: LucideIcon | undefined;
  clearable?: boolean | undefined;
  extra?: ({ label: string; onClick: () => void }[]) | undefined;
  tone?: 'neutral' | 'warn' | undefined;
  size?: 'sm' | 'md' | undefined;
  label?: string | undefined;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement | null>(null);
  const pick = (d: string): void => {
    onChange(d);
    setOpen(false);
  };
  const nextMonday = addDays(today, ((8 - parseDay(today).getDay()) % 7) || 7);
  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={label ?? placeholder}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border font-bold transition-colors',
          size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-8 px-3 text-[13px]',
          value === '' ? 'border-dashed border-[var(--lo-line)] text-[var(--lo-muted)] hover:text-[var(--lo-ink)]' : tone === 'warn' ? 'border-transparent bg-[var(--lo-amber)]/20 text-[var(--lo-amber-text)]' : 'border-transparent bg-[var(--lo-sunk)] text-[var(--lo-ink)] hover:bg-[var(--lo-sunk-hover)]',
        )}
      >
        <Icon size={14} aria-hidden />
        {value === '' ? placeholder : relDay(value, today)}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} className="p-2.5">
        <div className="mb-2 flex flex-wrap gap-1">
          {[
            ['Today', today],
            ['Tomorrow', addDays(today, 1)],
            ['Next week', nextMonday],
          ].map(([l, d]) => (
            <button key={l} type="button" onClick={() => pick(d as string)} className="h-7 rounded-full bg-[var(--lo-sunk)] px-3 text-[12px] font-bold hover:bg-[var(--lo-sunk-hover)]">
              {l}
            </button>
          ))}
          {extra?.map((x) => (
            <button
              key={x.label}
              type="button"
              onClick={() => {
                x.onClick();
                setOpen(false);
              }}
              className="h-7 rounded-full bg-[var(--lo-sunk)] px-3 text-[12px] font-bold hover:bg-[var(--lo-sunk-hover)]"
            >
              {x.label}
            </button>
          ))}
        </div>
        <MonthGrid value={value} today={today} onPick={pick} />
        {clearable && value !== '' && (
          <button type="button" onClick={() => pick('')} className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-full text-[13px] font-bold text-[var(--lo-ink-2)] hover:bg-[var(--lo-sunk)]">
            <X size={14} /> Clear
          </button>
        )}
      </Popover>
    </>
  );
}

export interface PickOption {
  value: string;
  label: string;
  art?: ReactNode | undefined;
  hint?: string | undefined;
}

/** A picker for records (an area, a goal, a project) with search. */
export function RecordPicker({ value, options, onChange, placeholder, emptyLabel = 'None', icon: Icon, label, size = 'md' }: { value: string; options: PickOption[]; onChange: (v: string) => void; placeholder: string; emptyLabel?: string | undefined; icon?: LucideIcon | undefined; label?: string | undefined; size?: 'sm' | 'md' | undefined }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLButtonElement | null>(null);
  const cur = options.find((o) => o.value === value);
  const shown = options.filter((o) => q.trim() === '' || o.label.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={label ?? placeholder}
        onClick={() => setOpen((o) => !o)}
        className={cn('inline-flex max-w-full items-center gap-1.5 rounded-full border font-bold transition-colors', size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-8 px-3 text-[13px]', cur === undefined ? 'border-dashed border-[var(--lo-line)] text-[var(--lo-muted)] hover:text-[var(--lo-ink)]' : 'border-transparent bg-[var(--lo-sunk)] text-[var(--lo-ink)] hover:bg-[var(--lo-sunk-hover)]')}
      >
        {cur?.art !== undefined ? cur.art : Icon !== undefined ? <Icon size={14} aria-hidden /> : null}
        <span className="truncate">{cur?.label ?? placeholder}</span>
        <ChevronDown size={13} aria-hidden className="shrink-0 opacity-70" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} className="w-72">
        {options.length > 7 && <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find" className="mb-1 h-8 w-full rounded-full border border-[var(--lo-line)] bg-[var(--lo-card)] px-3 text-[13px] outline-none focus:border-[var(--lo-accent)]" />}
        <div className="max-h-72 overflow-y-auto">
          <button
            type="button"
            onClick={() => {
              onChange('');
              setOpen(false);
            }}
            className="flex h-9 w-full items-center gap-2 rounded-[var(--lo-r-sm)] px-3 text-left text-[13px] font-semibold text-[var(--lo-muted)] hover:bg-[var(--lo-sunk)]"
          >
            {emptyLabel}
            {value === '' && <Check size={14} className="ml-auto" />}
          </button>
          {shown.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className="flex min-h-9 w-full items-center gap-2 rounded-[var(--lo-r-sm)] px-3 py-1.5 text-left text-[13px] font-semibold hover:bg-[var(--lo-sunk)]"
            >
              {o.art}
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {o.hint !== undefined && <span className="shrink-0 text-[12px] font-semibold text-[var(--lo-muted)]">{o.hint}</span>}
              {o.value === value && <Check size={14} className="shrink-0" />}
            </button>
          ))}
          {shown.length === 0 && <p className="px-3 py-2 text-[13px] text-[var(--lo-muted)]">Nothing found.</p>}
        </div>
      </Popover>
    </>
  );
}

/** HH:MM, typed (24 hours). */
export function TimeField({ value, onChange, label = 'Time', placeholder = '09:00' }: { value: string; onChange: (v: string) => void; label?: string | undefined; placeholder?: string | undefined }): React.JSX.Element {
  const [draft, setDraft] = useState(value);
  const [bad, setBad] = useState(false);
  const commit = (): void => {
    const t = draft.trim();
    if (t === '') {
      setBad(false);
      if (value !== '') onChange('');
      return;
    }
    const m = /^(\d{1,2})[:.]?(\d{2})$/.exec(t);
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) {
      setBad(true);
      return;
    }
    const v = String(Number(m[1])).padStart(2, '0') + ':' + m[2];
    setBad(false);
    setDraft(v);
    if (v !== value) onChange(v);
  };
  return (
    <input
      aria-label={label}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      className={cn('num h-8 w-20 rounded-full border bg-[var(--lo-card)] px-3 text-center text-[13px] font-bold outline-none transition-colors focus:border-[var(--lo-accent)]', bad ? 'border-[var(--lo-red)]' : 'border-[var(--lo-line)]')}
    />
  );
}

/** Weekdays as toggles (0 Sunday to 6). */
export function WeekdayPicker({ value, onChange, weekStartsOn = 1 }: { value: number[]; onChange: (v: number[]) => void; weekStartsOn?: number | undefined }): React.JSX.Element {
  const order = Array.from({ length: 7 }, (_, i) => (i + weekStartsOn) % 7);
  return (
    <div className="inline-flex gap-1">
      {order.map((d) => {
        const on = value.includes(d);
        return (
          <button
            key={d}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== d) : [...value, d].sort())}
            className={cn('flex size-8 items-center justify-center rounded-full text-[12px] font-extrabold transition-colors', on ? 'bg-[var(--lo-primary)] text-white' : 'bg-[var(--lo-sunk)] text-[var(--lo-ink-2)] hover:bg-[var(--lo-sunk-hover)]')}
          >
            {WD1[d]}
          </button>
        );
      })}
    </div>
  );
}

export function todayLocal(): string {
  return fmtDay(new Date());
}
