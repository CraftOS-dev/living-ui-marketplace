/**
 * Charts drawn with plain elements in the theme's colors: columns over
 * time (hours or days, hover for the exact value) and horizontal bars for
 * shares (payment methods, categories).
 */
import { useState } from 'react';
import { cn } from '../../kit/index.ts';

export interface Column {
  key: string;
  label: string;
  value: number;
  note?: string | undefined;
}

/** Columns with a label under every few; the hovered one shows its value. */
export function Columns({ data, format, height = 160, every = 1, empty = 'Nothing in these days' }: { data: Column[]; format: (n: number) => string; height?: number; every?: number; empty?: string }): React.JSX.Element {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  if (data.every((d) => d.value === 0)) return <p className="py-10 text-center text-[12px] text-[var(--ps-muted)]">{empty}</p>;
  const shown = hover !== null ? data[hover] : undefined;
  return (
    <div>
      <div className="mb-2 flex h-5 items-baseline gap-2 text-[12px]">
        {shown !== undefined ? (
          <>
            <span className="font-semibold">{shown.label}</span>
            <span className="num font-bold">{format(shown.value)}</span>
            {shown.note !== undefined && <span className="text-[var(--ps-muted)]">{shown.note}</span>}
          </>
        ) : (
          <span className="text-[var(--ps-muted)]">Highest {format(max)}</span>
        )}
      </div>
      <div className="flex items-end gap-[3px]" style={{ height }} onMouseLeave={() => setHover(null)}>
        {data.map((d, i) => (
          <button
            key={d.key}
            type="button"
            aria-label={d.label + ': ' + format(d.value)}
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onClick={() => setHover(i)}
            className="group flex h-full min-w-0 flex-1 items-end"
          >
            <span
              className={cn('block w-full rounded-t-[3px] transition-colors', hover === i ? 'bg-[var(--ps-accent)]' : d.value > 0 ? 'bg-[var(--ps-ink)]' : 'bg-[var(--ps-line)]')}
              style={{ height: d.value > 0 ? Math.max(2, (d.value / max) * height) : 2 }}
            />
          </button>
        ))}
      </div>
      <div className="mt-1 flex gap-[3px]">
        {data.map((d, i) => (
          <span key={d.key} className="min-w-0 flex-1 truncate text-center text-[12px] leading-4 text-[var(--ps-muted)]">
            {i % every === 0 ? d.label : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Horizontal bars: each row's share of the largest. */
export function Bars({ rows, format }: { rows: { key: string; label: string; value: number; note?: string | undefined }[]; format: (n: number) => string }): React.JSX.Element {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  if (rows.length === 0) return <p className="py-6 text-center text-[12px] text-[var(--ps-muted)]">Nothing in these days</p>;
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-[12px]">
            <span className="min-w-0 truncate font-semibold">{r.label}</span>
            <span className="num shrink-0">
              <span className="font-bold">{format(r.value)}</span>
              {r.note !== undefined && <span className="ml-1.5 text-[var(--ps-muted)]">{r.note}</span>}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--ps-row)]">
            <div className="h-full rounded-full bg-[var(--ps-ink)]" style={{ width: (Math.abs(r.value) / max) * 100 + '%' }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
