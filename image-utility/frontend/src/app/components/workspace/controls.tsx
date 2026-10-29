/**
 * Compact controls for the tool dialogs: a labelled slider with its value
 * (double-click the label to reset), a number field with a unit, colour
 * swatches with a hex field, and a row of chips.
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from '../../../kit/index.ts';
import { inputCls } from '../ui.tsx';

export function SliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  dflt = 0,
  digits = 0,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  dflt?: number;
  digits?: number;
  onChange: (v: number) => void;
}): React.JSX.Element {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (value > 0 && min < 0 ? '+' : '') + value.toFixed(digits);
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex h-5 items-center justify-between gap-2">
        <button type="button" title="Double-click to reset" onDoubleClick={() => onChange(dflt)} className={cn('truncate text-left text-[12px]', value !== dflt ? 'font-semibold text-[var(--iu-ink)]' : 'text-[var(--iu-ink-2)]')}>
          {label}
        </button>
        <span className="flex items-center gap-0.5">
          <input
            aria-label={label}
            value={shown}
            onFocus={(e) => {
              setText(value.toFixed(digits));
              e.target.select();
            }}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => {
              const v = Number((text ?? '').replace('+', ''));
              if (text !== null && Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
              setText(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              e.stopPropagation();
            }}
            className="num editable h-5 w-12 rounded-[var(--iu-r-sm)] border border-transparent bg-transparent px-1 text-right text-[12px] outline-none hover:border-[var(--iu-line)] focus:border-[var(--iu-ink)] focus:bg-[var(--iu-card)]"
          />
          {unit !== '' && <span className="text-[12px] text-[var(--iu-muted)]">{unit}</span>}
        </span>
      </div>
      <input type="range" className="iu-range w-full" aria-label={label + ' slider'} min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} onDoubleClick={() => onChange(dflt)} />
    </div>
  );
}

/** A number field that commits on blur or Enter (typing does not jump around). */
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  unit,
  placeholder,
  className,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  unit?: string;
  placeholder?: string;
  className?: string;
}): React.JSX.Element {
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => setText(value === null ? '' : String(value)), [value]);
  const commit = (): void => {
    const t = text.trim();
    if (t === '') {
      onChange(null);
      return;
    }
    let v = Number(t);
    if (!Number.isFinite(v)) {
      setText(value === null ? '' : String(value));
      return;
    }
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    onChange(v);
  };
  return (
    <label className={cn('flex min-w-0 flex-col gap-0.5', className)}>
      <span className="text-[12px] text-[var(--iu-ink-2)]">{label}</span>
      <span className="relative flex items-center">
        <input
          value={text}
          inputMode="decimal"
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
            e.stopPropagation();
          }}
          className={cn(inputCls, 'num', unit !== undefined && 'pr-8')}
        />
        {unit !== undefined && <span className="pointer-events-none absolute right-2 text-[12px] text-[var(--iu-muted)]">{unit}</span>}
      </span>
    </label>
  );
}

export function ColorField({ label, value, onChange, swatches, allowNone = false }: { label?: string; value: string | null; onChange: (v: string | null) => void; swatches: string[]; allowNone?: boolean }): React.JSX.Element {
  const [hex, setHex] = useState(value ?? '');
  useEffect(() => setHex(value ?? ''), [value]);
  return (
    <div className="flex flex-col gap-1">
      {label !== undefined && <span className="text-[12px] text-[var(--iu-ink-2)]">{label}</span>}
      <div className="flex flex-wrap items-center gap-1">
        {allowNone && (
          <button
            type="button"
            aria-label="None"
            title="None"
            onClick={() => onChange(null)}
            className={cn('relative size-5 overflow-hidden rounded-full border border-[var(--iu-line)] bg-[var(--iu-card)]', value === null && 'ring-2 ring-[var(--iu-ink)] ring-offset-1 ring-offset-[var(--iu-card)]')}
          >
            <span aria-hidden className="absolute left-1/2 top-[-2px] h-6 w-px -translate-x-1/2 rotate-45 bg-[var(--iu-red)]" />
          </button>
        )}
        {swatches.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={c}
            title={c}
            onClick={() => onChange(c)}
            style={{ background: c }}
            className={cn('size-5 rounded-full border border-black/15', value?.toLowerCase() === c.toLowerCase() && 'ring-2 ring-[var(--iu-ink)] ring-offset-1 ring-offset-[var(--iu-card)]')}
          />
        ))}
        <label className="relative ml-0.5 flex size-5 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-[var(--iu-muted)]" title="Any colour">
          <input type="color" aria-label="Any colour" value={/^#[0-9a-f]{6}$/i.test(value ?? '') ? (value as string) : '#ff4f18'} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
          <span aria-hidden className="text-[12px] leading-none text-[var(--iu-muted)]">+</span>
        </label>
        <input
          aria-label="Hex colour"
          value={hex}
          onChange={(e) => setHex(e.target.value)}
          onBlur={() => {
            const h = hex.trim().startsWith('#') ? hex.trim() : '#' + hex.trim();
            if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(h)) onChange(h.toLowerCase());
            else setHex(value ?? '');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            e.stopPropagation();
          }}
          className="mono ml-auto h-6 w-[74px] rounded-[var(--iu-r-sm)] border border-[var(--iu-line)] bg-[var(--iu-card)] px-1.5 outline-none focus:border-[var(--iu-ink)]"
        />
      </div>
    </div>
  );
}

export function Chips<T extends string>({ value, options, onChange, label }: { value: T | null; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-6 rounded-[var(--iu-r-sm)] border px-1.5 text-[12px] font-semibold transition-colors',
            o.value === value ? 'iu-on-ink border-[var(--iu-ink)] bg-[var(--iu-ink)] text-[var(--iu-shell)]' : 'border-[var(--iu-line)] bg-[var(--iu-card)] text-[var(--iu-ink-2)] hover:border-[var(--iu-muted)] hover:text-[var(--iu-ink)]',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A labelled line inside a tool dialog: label on the left, control on the right. */
export function Line({ label, children }: { label: string; children: ReactNode }): React.JSX.Element {
  return (
    <div className="flex min-h-7 items-center justify-between gap-2">
      <span className="text-[12px] text-[var(--iu-ink-2)]">{label}</span>
      <div className="flex min-w-0 items-center gap-1">{children}</div>
    </div>
  );
}

/** A group heading inside a tool dialog. */
export function Group({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }): React.JSX.Element {
  return (
    <section className="flex flex-col gap-1.5 border-t border-[var(--iu-hair)] pt-2 first:border-t-0 first:pt-0">
      <div className="flex h-5 items-center justify-between">
        <h3 className="text-[12px] font-bold text-[var(--iu-ink-2)]">{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  );
}
