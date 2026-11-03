/**
 * Small pieces the product page shares between a new product and a saved
 * one: fields bound to local state or saved when you leave them, a table
 * cell edited in place, a chip input (tags, option values, keywords),
 * read-only figures, a two-way choice, labels with help, and the pill that
 * says where a fact came from.
 */
import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ClipboardEvent, KeyboardEvent, ReactNode } from 'react';
import { Info, X } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import type { TaskBrief } from '../lib/types.ts';
import { Pill, Tabs, Tip } from './ui.tsx';
import type { Tone } from './ui.tsx';

export type FieldEvent = ChangeEvent<HTMLInputElement | HTMLTextAreaElement>;

/** What an input or text area needs: its value and handlers. */
export interface Bound {
  value: string;
  onChange: (e: FieldEvent) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
}

/** A field over local state (a product not saved yet). */
export function bindState(value: string, set: (v: string) => void): Bound {
  return { value, onChange: (e) => set(e.target.value) };
}

/**
 * A field that saves itself when you leave it: Enter saves an input, Escape
 * puts the last saved value back. It follows the server while you are not
 * typing in it. `commit` answers false to put the saved value back.
 */
export function useEditable(value: string, commit: (v: string) => Promise<boolean>): Bound {
  const [v, setV] = useState(value);
  const editing = useRef(false);
  const cancelled = useRef(false);
  useEffect(() => {
    if (!editing.current) setV(value);
  }, [value]);
  return {
    value: v,
    onChange: (e) => setV(e.target.value),
    onFocus: () => {
      editing.current = true;
      cancelled.current = false;
    },
    onBlur: () => {
      editing.current = false;
      if (cancelled.current) {
        cancelled.current = false;
        setV(value);
        return;
      }
      if (v === value) return;
      void commit(v).then((ok) => {
        if (!ok) setV(value);
      });
    },
    onKeyDown: (e) => {
      if (e.key === 'Escape') {
        cancelled.current = true;
        e.currentTarget.blur();
      } else if (e.key === 'Enter' && e.currentTarget instanceof HTMLInputElement) {
        e.currentTarget.blur();
      }
    },
  };
}

interface CellLook {
  label: string;
  placeholder?: string;
  numeric?: boolean;
  prefix?: string;
  danger?: boolean;
  className?: string;
  inputClass?: string;
}

/** An input that looks like text until hovered or focused (rows of a list or table). */
export function CellInput({ bound, label, placeholder, numeric = false, prefix, danger = false, className, inputClass }: CellLook & { bound: Bound }): React.JSX.Element {
  return (
    <span className={cn('flex h-8 min-w-0 items-center rounded-[8px] ring-[var(--so-ink)] hover:bg-[var(--so-row-hover)] focus-within:bg-[var(--so-tile)] focus-within:ring-2', className)}>
      {prefix !== undefined && <span className="shrink-0 pl-2 text-[12px] font-semibold text-[var(--so-muted)]">{prefix}</span>}
      <input
        aria-label={label}
        placeholder={placeholder}
        inputMode={numeric ? 'decimal' : 'text'}
        {...bound}
        className={cn('h-full w-full min-w-0 bg-transparent px-2 text-[13px] text-[var(--so-ink)] outline-none', numeric && 'num text-right', danger && 'placeholder:font-semibold placeholder:text-[var(--so-red-text)]', inputClass)}
      />
    </span>
  );
}

/** A cell edited in place and saved when you leave it. */
export function Cell({ value, onSave, ...look }: CellLook & { value: string; onSave: (v: string) => Promise<boolean> }): React.JSX.Element {
  const ed = useEditable(value, onSave);
  return <CellInput bound={ed} {...look} />;
}

/** A small input for table rows and add rows. */
export const smallField = 'h-8 w-full min-w-0 rounded-[8px] bg-[var(--so-tile)] px-2 text-[13px] text-[var(--so-ink)] outline-none ring-[var(--so-ink)] focus-visible:ring-2';
export const badRing = 'ring-2 ring-[var(--so-red)] focus-visible:ring-[var(--so-red)] focus-within:ring-[var(--so-red)]';

/** A small amount input with the currency sign in front. */
export function SmallAmount({ sign, invalid = false, className, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { sign: string; invalid?: boolean }): React.JSX.Element {
  return (
    <span className={cn('flex h-8 min-w-0 items-center rounded-[8px] bg-[var(--so-tile)] ring-[var(--so-ink)] focus-within:ring-2', invalid && badRing, className)}>
      <span className="shrink-0 pl-2 text-[12px] font-semibold text-[var(--so-muted)]">{sign}</span>
      <input inputMode="decimal" aria-invalid={invalid || undefined} {...rest} className="num h-full w-full min-w-0 bg-transparent px-2 text-right text-[13px] text-[var(--so-ink)] outline-none" />
    </span>
  );
}

/* ------------------------------------------------------------- chip input */

/**
 * Values as chips: Enter or a comma adds what you typed, the x on a chip
 * removes it, Backspace in the empty box removes the last one, and pasting
 * a comma list adds each. The same value (any case) is kept once.
 */
export function ChipInput({
  values,
  onChange,
  label,
  placeholder,
  max = 40,
  invalid = false,
  className,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  label: string;
  placeholder?: string;
  max?: number;
  invalid?: boolean;
  className?: string;
}): React.JSX.Element {
  const [text, setText] = useState('');
  const own = useRef<HTMLInputElement>(null);

  const addAll = (raw: string[]): void => {
    const next = [...values];
    for (const r of raw) {
      const v = r.trim();
      if (v === '' || next.length >= max || next.some((x) => x.toLowerCase() === v.toLowerCase())) continue;
      next.push(v.slice(0, 80));
    }
    if (next.length !== values.length) onChange(next);
  };
  const commit = (): void => {
    if (text.trim() !== '') addAll(text.split(','));
    setText('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && text === '' && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>): void => {
    const t = e.clipboardData.getData('text');
    if (!t.includes(',') && !t.includes('\n')) return;
    e.preventDefault();
    addAll(t.split(/[,\n]/));
  };

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
          own.current?.focus();
        }
      }}
      className={cn('flex min-h-10 cursor-text flex-wrap items-center gap-1.5 rounded-[12px] bg-[var(--so-tile)] p-1.5 ring-[var(--so-ink)] focus-within:ring-2', invalid && badRing, className)}
    >
      {values.map((v) => (
        <span key={v} className="inline-flex h-7 max-w-full items-center gap-1 rounded-full bg-[var(--so-card)] pl-2.5 pr-1 text-[12px] font-semibold text-[var(--so-ink)]">
          <span className="truncate">{v}</span>
          <button type="button" aria-label={'Remove ' + v} onClick={() => onChange(values.filter((x) => x !== v))} className="hit flex size-5 shrink-0 items-center justify-center rounded-full text-[var(--so-muted)] hover:bg-[var(--so-tile-hover)] hover:text-[var(--so-ink)]">
            <X size={12} aria-hidden />
          </button>
        </span>
      ))}
      <input
        ref={own}
        aria-label={label}
        aria-invalid={invalid || undefined}
        placeholder={values.length === 0 ? placeholder : 'Add'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        onPaste={onPaste}
        onBlur={commit}
        disabled={values.length >= max}
        className="h-7 min-w-[96px] flex-1 bg-transparent px-1.5 text-[14px] text-[var(--so-ink)] outline-none disabled:hidden"
      />
    </div>
  );
}

/* ---------------------------------------------------------------- labels */

/** A label with its help in a tooltip (an i you can hover or tab to). */
export function HelpLabel({ label, tip }: { label: string; tip: string }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <Tip text={tip}>
        <span tabIndex={0} aria-label={tip} className="inline-flex size-4 items-center justify-center rounded-full text-[var(--so-faint)] outline-none hover:text-[var(--so-ink)] focus-visible:text-[var(--so-ink)] focus-visible:ring-2 focus-visible:ring-[var(--so-ink)]">
          <Info size={13} strokeWidth={2} aria-hidden />
        </span>
      </Tip>
    </span>
  );
}

/** A label over something that is not a text input (a choice, chips, a figure). */
export function Labeled({ label, hint, children, className, error }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string | undefined; error?: string | undefined }): React.JSX.Element {
  return (
    <div className={cn('min-w-0', className)}>
      <span className="mb-1.5 flex items-center justify-between gap-2 text-[12px] font-semibold text-[var(--so-ink-2)]">
        <span>{label}</span>
        {hint !== undefined && <span className="font-medium text-[var(--so-muted)]">{hint}</span>}
      </span>
      {children}
      {error !== undefined && error !== '' && <span className="mt-1 block text-[12px] font-medium text-[var(--so-red-text)]">{error}</span>}
    </div>
  );
}

/** A worked-out figure next to inputs: the same height, outlined instead of filled. */
export function FigureBox({ label, children, className, tone = 'ink' }: { label: ReactNode; children: ReactNode; className?: string; tone?: 'ink' | 'muted' | 'bad' | 'warn' }): React.JSX.Element {
  return (
    <Labeled label={label} className={className}>
      <div
        className={cn(
          'num flex h-10 min-w-0 items-center rounded-[12px] px-3.5 text-[14px] font-semibold shadow-[inset_0_0_0_1px_var(--so-border)]',
          tone === 'muted' && 'font-medium text-[var(--so-muted)]',
          tone === 'bad' && 'text-[var(--so-red-text)]',
          tone === 'warn' && 'text-[var(--so-amber-text)]',
        )}
      >
        <span className="truncate">{children}</span>
      </div>
    </Labeled>
  );
}

/** Two or three choices in a grey bar; the chosen one is a black pill that slides. */
export function Choice<K extends string>({ items, value, onChange }: { items: { key: K; label: string }[]; value: K; onChange: (k: K) => void }): React.JSX.Element {
  return <Tabs fit size="sm" items={items} value={value} onChange={onChange} className="bg-[var(--so-tile)]" />;
}

/* ------------------------------------------------------------------ facts */

export const FACT_SOURCE: Record<string, { label: string; tone: Tone }> = {
  you: { label: 'You', tone: 'neutral' },
  agent: { label: 'Your AI agent', tone: 'accent' },
  photo: { label: 'Photo', tone: 'info' },
  supplier: { label: 'Supplier', tone: 'neutral' },
  web: { label: 'Web', tone: 'neutral' },
  import: { label: 'Import', tone: 'neutral' },
};

export function SourcePill({ source, className }: { source: string; className?: string }): React.JSX.Element {
  const s = FACT_SOURCE[source] ?? { label: source, tone: 'neutral' as Tone };
  return (
    <Tip text={'Source: ' + s.label} {...(className !== undefined ? { className } : {})}>
      <Pill tone={s.tone} className="max-w-[120px]">
        {s.label}
      </Pill>
    </Tip>
  );
}

/* ---------------------------------------------------------------- helpers */

export function chars(s: string): number {
  return Array.from(s).length;
}

export function isOpenTask(t: TaskBrief | null | undefined): t is TaskBrief {
  return t !== null && t !== undefined && (t.state === 'queued' || t.state === 'asked' || t.state === 'working');
}

/** A typed whole number: undefined when blank, null when it is not one (or below 0). */
export function parseCount(s: string): number | null | undefined {
  const t = s.trim().split(',').join('');
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 ? n : null;
}
