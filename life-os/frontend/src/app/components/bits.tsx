/**
 * Small shared controls: a section heading with a drawing, chips, area
 * choice by drawing, a stepper, an add-a-line input that stays open for the
 * next line, and text that edits in place.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Minus, Plus } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { act, patchWhere, reshape } from '../lib/live.ts';
import { useStatus } from '../lib/context.tsx';
import { AREA_KINDS, AREA_NAMES, AreaArt } from './art.tsx';
import type { AreaKind } from './art.tsx';

/** A part of a page: a serif heading (with a small drawing), an action at the right, the content. */
export function Section({ title, art, action, children, className, id }: { title: ReactNode; art?: ReactNode | undefined; action?: ReactNode | undefined; children: ReactNode; className?: string | undefined; id?: string | undefined }): React.JSX.Element {
  return (
    <section id={id} className={cn('min-w-0', className)}>
      <div className="mb-2.5 flex min-h-8 items-center gap-2">
        {art}
        <h2 className="serif min-w-0 flex-1 truncate text-[15px] font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A small choice: text with an optional drawing; filled when chosen. */
export function Chip({ active = false, onClick, children, art, title, className, tone }: { active?: boolean | undefined; onClick?: (() => void) | undefined; children: ReactNode; art?: ReactNode | undefined; title?: string | undefined; className?: string | undefined; tone?: string | undefined }): React.JSX.Element {
  const style = active && tone !== undefined ? { background: `var(--lo-k-${tone}-soft)`, color: `var(--lo-k-${tone}-text)`, borderColor: `var(--lo-k-${tone})` } : undefined;
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      style={style}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--lo-r-sm)] border px-2.5 text-[13px] font-bold transition-colors',
        active ? (tone === undefined ? 'border-[var(--lo-moss)] bg-[var(--lo-moss-soft)] text-[var(--lo-moss-text)]' : '') : 'border-[var(--lo-hair)] bg-[var(--lo-card)] text-[var(--lo-ink-2)] hover:border-[var(--lo-line)] hover:text-[var(--lo-ink)]',
        className,
      )}
    >
      {art}
      {children}
    </button>
  );
}

/** The areas the person has switched on. */
export function useKinds(): AreaKind[] {
  const s = useStatus().data;
  return s?.areas ?? AREA_KINDS;
}

/** Choose an area by its drawing. */
export function AreaChoice({ value, onChange, allowNone = true, kinds, size = 'md' }: { value: string; onChange: (k: AreaKind | '') => void; allowNone?: boolean | undefined; kinds?: AreaKind[] | undefined; size?: 'sm' | 'md' | undefined }): React.JSX.Element {
  const on = useKinds();
  const list = kinds ?? on;
  return (
    <div role="radiogroup" aria-label="Area of life" className="flex flex-wrap gap-1.5">
      {list.map((k) => (
        <Chip key={k} active={value === k} tone={k} onClick={() => onChange(value === k && allowNone ? '' : k)} art={<AreaArt kind={k} size={size === 'sm' ? 18 : 20} />} className={size === 'sm' ? 'h-7 px-2 text-[12px]' : undefined}>
          {AREA_NAMES[k]}
        </Chip>
      ))}
    </div>
  );
}

/** A number with minus and plus. */
export function Stepper({ value, onChange, step = 1, min = 0, max = 100000, format, label, size = 'md' }: { value: number; onChange: (v: number) => void; step?: number | undefined; min?: number | undefined; max?: number | undefined; format?: ((v: number) => ReactNode) | undefined; label: string; size?: 'sm' | 'md' | undefined }): React.JSX.Element {
  const b = size === 'sm' ? 'size-7' : 'size-8';
  return (
    <div className="inline-flex items-center gap-1" role="group" aria-label={label}>
      <button type="button" aria-label={'Less ' + label} disabled={value <= min} onClick={() => onChange(Math.max(min, Math.round((value - step) * 100) / 100))} className={cn('flex items-center justify-center rounded-[var(--lo-r-sm)] bg-[var(--lo-sunk)] text-[var(--lo-ink-2)] hover:bg-[var(--lo-sunk-hover)] disabled:opacity-40', b)}>
        <Minus size={14} strokeWidth={2.6} />
      </button>
      <span className="num min-w-12 text-center text-[15px] font-extrabold">{format !== undefined ? format(value) : value}</span>
      <button type="button" aria-label={'More ' + label} disabled={value >= max} onClick={() => onChange(Math.min(max, Math.round((value + step) * 100) / 100))} className={cn('flex items-center justify-center rounded-[var(--lo-r-sm)] bg-[var(--lo-sunk)] text-[var(--lo-ink-2)] hover:bg-[var(--lo-sunk-hover)] disabled:opacity-40', b)}>
        <Plus size={14} strokeWidth={2.6} />
      </button>
    </div>
  );
}

/**
 * A line to add things to a list: type, Enter, and it stays ready for the
 * next one. The plus on the left says what it is for.
 */
/** Switch a part of life on or off: every list of parts (the sidebar, My life, Settings) moves at once. */
export async function switchArea(kind: string, enabled: boolean): Promise<boolean> {
  const lists = reshape((root) => {
    if (typeof root !== 'object' || root === null) return root;
    const r = root as Record<string, unknown>;
    const a = r.areas;
    if (!Array.isArray(a) || !a.every((x) => typeof x === 'string')) return root;
    const kinds = a as string[];
    return { ...r, areas: enabled ? (kinds.includes(kind) ? kinds : [...kinds, kind]) : kinds.filter((k) => k !== kind) };
  });
  const r = await act([patchWhere((o) => o.kind === kind && typeof o.enabled === 'boolean', () => ({ enabled })), lists], () => op('areas.set', { area: kind, enabled }), ['areas', 'settings']);
  return r !== undefined;
}

export function AddLine({ placeholder, onAdd, className, autoFocus = false, tone, big = false, ariaLabel }: { placeholder: string; onAdd: (text: string) => Promise<unknown> | void; className?: string | undefined; autoFocus?: boolean | undefined; tone?: string | undefined; big?: boolean | undefined; ariaLabel?: string | undefined }): React.JSX.Element {
  const [text, setText] = useState('');
  const busy = false;
  const ref = useRef<HTMLInputElement | null>(null);
  const add = async (): Promise<void> => {
    const t = text.trim();
    if (t === '') return;
    setText('');
    ref.current?.focus();
    // What was added already shows; the words come back only if the server refused it.
    if ((await onAdd(t)) === false) setText(t);
  };
  return (
    <div
      className={cn(
        'group flex items-center gap-2 rounded-[var(--lo-r)] border border-dashed bg-[var(--lo-card)] transition-colors focus-within:border-solid focus-within:shadow-[var(--lo-shadow-sm)]',
        big ? 'h-12 px-3' : 'h-10 px-2.5',
        'border-[var(--lo-line)] focus-within:border-[var(--lo-accent)]',
        className,
      )}
      onClick={() => ref.current?.focus()}
    >
      <span style={tone !== undefined ? { background: kindColor(tone, 'soft'), color: kindColor(tone, 'text') } : undefined} className={cn('flex shrink-0 items-center justify-center rounded-[var(--lo-r-sm)] bg-[var(--lo-primary)] text-white', big ? 'size-7' : 'size-6')}>
        <Plus size={big ? 17 : 15} strokeWidth={3} />
      </span>
      <input
        ref={ref}
        autoFocus={autoFocus}
        value={text}
        aria-label={ariaLabel ?? placeholder}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void add();
          }
          if (e.key === 'Escape') setText('');
        }}
        className={cn('min-w-0 flex-1 bg-transparent font-semibold outline-none placeholder:font-semibold placeholder:text-[var(--lo-muted)]', big ? 'text-[15px]' : 'text-[14px]')}
      />
      {text.trim() !== '' && (
        <button type="button" onClick={() => void add()} className="h-7 shrink-0 rounded-[var(--lo-r-sm)] bg-[var(--lo-primary)] px-3 text-[12px] font-extrabold text-white hover:bg-[var(--lo-primary-hover)]">
          Add
        </button>
      )}
    </div>
  );
}

/** Text that is shown as text and edits in place; saves on Enter or when it loses focus. */
export function InlineText({ value, onSave, placeholder, className, multiline = false, ariaLabel, maxLength }: { value: string; onSave: (v: string) => Promise<unknown> | void; placeholder: string; className?: string | undefined; multiline?: boolean | undefined; ariaLabel?: string | undefined; maxLength?: number | undefined }): React.JSX.Element {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  const commit = (): void => {
    focused.current = false;
    const v = multiline ? draft : draft.trim();
    if (v !== value && (multiline || v !== '')) void onSave(v);
    else if (!multiline && v === '') setDraft(value);
  };
  const cls = cn('editable w-full rounded-[var(--lo-r-sm)] bg-transparent outline-none transition-colors placeholder:text-[var(--lo-muted)] hover:bg-[var(--lo-sunk)] focus:bg-[var(--lo-card)] focus:shadow-[0_0_0_2px_var(--lo-accent)]', className);
  if (multiline)
    return (
      <textarea
        value={draft}
        aria-label={ariaLabel ?? placeholder}
        placeholder={placeholder}
        maxLength={maxLength}
        onFocus={() => (focused.current = true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        className={cn('lo-autosize min-h-16 resize-none px-2 py-1.5', cls)}
      />
    );
  return (
    <input
      value={draft}
      aria-label={ariaLabel ?? placeholder}
      placeholder={placeholder}
      maxLength={maxLength}
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
      className={cn('px-2 py-1', cls)}
    />
  );
}

/** A soft colored band in an area's color (behind a page's top, a card's edge). */
export function kindColor(kind: string, part: '' | 'soft' | 'text' = ''): string {
  if (kind === '') return part === 'text' ? 'var(--lo-ink-2)' : part === 'soft' ? 'var(--lo-sunk)' : 'var(--lo-line)';
  return `var(--lo-k-${kind}${part === '' ? '' : '-' + part})`;
}

/** A round check that pops when ticked. */
export function CheckButton({ done, onClick, kind = '', size = 22, label }: { done: boolean; onClick: (e: React.MouseEvent) => void; kind?: string | undefined; size?: number | undefined; label: string }): React.JSX.Element {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      style={{ width: size, height: size, borderColor: done ? 'var(--lo-moss)' : kind !== '' ? kindColor(kind) : 'var(--lo-line)' }}
      className={cn('hit flex shrink-0 items-center justify-center rounded-full border-2 transition-colors', done ? 'lo-check-pop bg-[var(--lo-moss)] text-white' : 'bg-[var(--lo-card)] hover:bg-[var(--lo-moss-soft)]')}
    >
      {done && (
        <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 12 12" aria-hidden>
          <path d="M2.5 6.5l2.4 2.4 4.6-5.2" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

/** A thin bar for small amounts (a checklist, a budget). */
export function Meter({ value, color = 'var(--lo-moss)', height = 6, className, label }: { value: number; color?: string | undefined; height?: number | undefined; className?: string | undefined; label?: string | undefined }): React.JSX.Element {
  const v = Math.max(0, Math.min(1, value));
  return (
    <span role="progressbar" aria-label={label} aria-valuenow={Math.round(v * 100)} aria-valuemin={0} aria-valuemax={100} title={label} className={cn('block overflow-hidden rounded-full bg-[var(--lo-track)]', className)} style={{ height }}>
      <span className="block h-full rounded-full transition-[width] duration-500" style={{ width: `${v * 100}%`, background: color }} />
    </span>
  );
}
