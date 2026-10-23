/**
 * Lists of records. With room, a table whose columns line up (numbers
 * right-aligned, tabular); when narrow, each record becomes a compact
 * two-line row (title and amount on top, details under). Rows open their
 * record; optional checkboxes select rows for bulk actions; a pager walks
 * long lists.
 *
 * The table decides by the width it has (measured), not by the window: the
 * sidebar, a side panel or a narrow host panel can leave a wide window with a
 * narrow list. Optional columns (`hide`) drop out, the most optional first,
 * until every column gets its minimum width; when even that does not fit,
 * the rows become cards.
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { qty } from '../lib/format.ts';
import { CircleButton, Skeleton } from './ui.tsx';

export interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  /** Numbers and amounts: right-aligned and tabular. */
  align?: 'left' | 'right' | 'center' | undefined;
  /** A CSS grid track, e.g. '120px' or 'minmax(160px, 2fr)'. Default 'minmax(0, 1fr)'. */
  width?: string | undefined;
  /** Hide below this screen width (the phone row shows `mobile` instead). */
  hide?: 'sm' | 'md' | 'lg' | 'xl' | undefined;
  /** Sort by this column (client-side) using this value. */
  sort?: ((row: T) => string | number) | undefined;
}

export interface MobileRow {
  title: ReactNode;
  sub?: ReactNode | undefined;
  right?: ReactNode | undefined;
  rightSub?: ReactNode | undefined;
  lead?: ReactNode | undefined;
}

/** Which optional columns go first when room runs out (xl first, sm last). */
const DROP_ORDER: Record<NonNullable<Column<unknown>['hide']>, number> = { xl: 4, lg: 3, md: 2, sm: 1 };
/** Below this width a list is cards, whatever its columns. */
const CARDS_UNDER = 520;
const GAP = 12;
const PAD = 24;
const CHECK = 36;

/** The narrowest a column may get: its fixed width, its minmax floor, or a floor for a flexible column. */
function minOf(width: string | undefined, first: boolean): number {
  const w = (width ?? '').trim();
  const px = /^(\d+(?:\.\d+)?)px$/.exec(w);
  if (px !== null) return Number(px[1]);
  const floor = /^minmax\(\s*(\d+(?:\.\d+)?)px\s*,/.exec(w);
  if (floor !== null && Number(floor[1]) > 0) return Number(floor[1]);
  return first ? 150 : 100;
}

/** The track for a column; a flexible one never shrinks below its floor (so a header cannot spill onto its neighbour). */
function trackOf(width: string | undefined, first: boolean): string {
  const w = (width ?? 'minmax(0, 1fr)').trim();
  const zero = /^minmax\(\s*0(?:px)?\s*,\s*(.+)\)$/.exec(w);
  return zero !== null ? `minmax(${minOf(undefined, first)}px, ${zero[1]})` : w;
}

/** The element's own content width, measured before paint and on every resize. */
function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    setW(el.clientWidth);
    const watch = new ResizeObserver(() => setW(el.clientWidth));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  return [ref, w];
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  onOpen,
  mobile,
  loading = false,
  empty,
  selected,
  onSelect,
  footer,
  rowTone,
  dense = false,
  ariaLabel,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onOpen?: ((row: T) => void) | undefined;
  mobile: (row: T) => MobileRow;
  loading?: boolean | undefined;
  empty?: ReactNode | undefined;
  selected?: Set<string> | undefined;
  onSelect?: ((keys: Set<string>) => void) | undefined;
  footer?: ReactNode | undefined;
  /** A row that needs attention (overdue) or is done with (void). */
  rowTone?: (row: T) => 'alert' | 'muted' | undefined;
  dense?: boolean | undefined;
  ariaLabel: string;
}): React.JSX.Element {
  const [box, width] = useWidth();
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  // The columns that fit: drop optional ones (most optional, then rightmost) until all have their minimum.
  const room = width - PAD - (onSelect !== undefined ? CHECK + GAP : 0);
  const shown = [...columns];
  const need = (cols: Column<T>[]): number => cols.reduce((s, c, i) => s + minOf(c.width, i === 0), 0) + GAP * Math.max(0, cols.length - 1);
  while (need(shown) > room) {
    let drop = -1;
    shown.forEach((c, i) => {
      if (c.hide === undefined) return;
      if (drop < 0 || DROP_ORDER[c.hide] >= DROP_ORDER[shown[drop]?.hide ?? 'sm']) drop = i;
    });
    if (drop < 0) break;
    shown.splice(drop, 1);
  }
  const phone = width > 0 && (width < CARDS_UNDER || need(shown) > room);
  const template = [onSelect !== undefined ? `${CHECK}px` : null, ...shown.map((c, i) => trackOf(c.width, i === 0))].filter((x) => x !== null).join(' ');
  const sorted = useMemo(() => {
    if (sort === null) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (col?.sort === undefined) return rows;
    const by = col.sort;
    return [...rows].sort((a, b) => {
      const x = by(a);
      const y = by(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [rows, sort, columns]);
  const allKeys = rows.map(rowKey);
  const allOn = selected !== undefined && allKeys.length > 0 && allKeys.every((k) => selected.has(k));
  const toggle = (k: string): void => {
    if (selected === undefined || onSelect === undefined) return;
    const next = new Set(selected);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    onSelect(next);
  };
  // Measured before the first paint; until then only the box is drawn.
  // The box's width comes from its slot, never from the rows it draws (it measures itself to choose them).
  return <div ref={box} className="min-w-0 [contain:inline-size]">{width === 0 ? null : body()}</div>;

  function body(): React.JSX.Element {
  if (loading && rows.length === 0) {
    return (
      <div className="flex flex-col gap-2" aria-label="Loading">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className={dense ? 'h-10' : 'h-14'} />
        ))}
      </div>
    );
  }
  if (rows.length === 0) return <>{empty}</>;

  if (phone) {
    return (
      <div role="list" aria-label={ariaLabel} className="flex flex-col gap-1.5">
        {sorted.map((r) => {
          const m = mobile(r);
          const k = rowKey(r);
          const tone = rowTone?.(r);
          return (
            <div key={k} role="listitem" className={cn('flex items-center gap-3 rounded-[18px] px-3 py-2.5', tone === 'alert' ? 'bg-[var(--erp-red)]/8' : 'bg-[var(--erp-row)]')}>
              {onSelect !== undefined && <input type="checkbox" checked={selected?.has(k) ?? false} onChange={() => toggle(k)} aria-label="Select" className="size-4 shrink-0 accent-[var(--erp-ink)]" />}
              <button type="button" disabled={onOpen === undefined} onClick={() => onOpen?.(r)} className={cn('flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default', tone === 'muted' && 'text-[var(--erp-muted)]')}>
                {m.lead}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-bold">{m.title}</span>
                  {m.sub !== undefined && <span className="block truncate text-[12px] text-[var(--erp-muted)]">{m.sub}</span>}
                </span>
                {(m.right !== undefined || m.rightSub !== undefined) && (
                  <span className="shrink-0 text-right">
                    {m.right !== undefined && <span className="num block text-[14px] font-bold">{m.right}</span>}
                    {m.rightSub !== undefined && <span className="block text-[12px] text-[var(--erp-muted)]">{m.rightSub}</span>}
                  </span>
                )}
              </button>
            </div>
          );
        })}
        {footer}
      </div>
    );
  }

  return (
    <div role="table" aria-label={ariaLabel} className="flex flex-col">
      <div role="row" className="grid items-center gap-3 px-3 pb-2" style={{ gridTemplateColumns: template }}>
        {onSelect !== undefined && (
          <input
            type="checkbox"
            checked={allOn}
            onChange={() => onSelect?.(allOn ? new Set() : new Set(allKeys))}
            aria-label="Select all"
            className="size-4 accent-[var(--erp-ink)]"
          />
        )}
        {shown.map((c) => {
          const on = sort?.key === c.key;
          const content = (
            <>
              {c.label}
              {on && (sort?.dir === 1 ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden />)}
            </>
          );
          return (
            <div key={c.key} role="columnheader" className={cn('flex min-w-0 text-[12px] font-semibold text-[var(--erp-muted)]', c.align === 'right' && 'justify-end', c.align === 'center' && 'justify-center')}>
              {c.sort !== undefined ? (
                <button type="button" onClick={() => setSort(on && sort?.dir === -1 ? null : { key: c.key, dir: on ? -1 : 1 })} className="inline-flex min-w-0 items-center gap-1 hover:text-[var(--erp-ink)]">
                  <span className="truncate">{c.label}</span>
                  {on && (sort?.dir === 1 ? <ArrowUp size={12} aria-hidden className="shrink-0" /> : <ArrowDown size={12} aria-hidden className="shrink-0" />)}
                </button>
              ) : (
                <span className="truncate">{content}</span>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-col gap-1">
        {sorted.map((r) => {
          const k = rowKey(r);
          const tone = rowTone?.(r);
          const on = selected?.has(k) ?? false;
          return (
            <div
              key={k}
              role="row"
              data-href={onOpen !== undefined ? '1' : undefined}
              tabIndex={onOpen !== undefined ? 0 : undefined}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('button, a, input, select, textarea, label') !== null) return;
                onOpen?.(r);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.target === e.currentTarget) onOpen?.(r);
              }}
              className={cn(
                'grid items-center gap-3 rounded-[14px] px-3 outline-none ring-[var(--erp-ink)] transition-colors focus-visible:ring-2',
                dense ? 'min-h-10 py-1.5' : 'min-h-[52px] py-2',
                onOpen !== undefined && 'hover:bg-[var(--erp-row)]',
                on && 'bg-[var(--erp-row-hover)]',
                tone === 'alert' && !on && 'bg-[var(--erp-red)]/6',
                tone === 'muted' && 'text-[var(--erp-muted)]',
              )}
              style={{ gridTemplateColumns: template }}
            >
              {onSelect !== undefined && <input type="checkbox" checked={on} onChange={() => toggle(k)} aria-label="Select" className="size-4 accent-[var(--erp-ink)]" />}
              {shown.map((c) => (
                <div key={c.key} role="cell" className={cn('flex min-w-0 items-center text-[14px]', c.align === 'right' && 'num justify-end text-right', c.align === 'center' && 'justify-center')}>
                  {c.render(r)}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {footer}
    </div>
  );
  }
}

/** A totals row under a table: label left, figures right, aligned to the table's grid. */
export function TotalsRow({ cells }: { cells: { label: ReactNode; value: ReactNode }[] }): React.JSX.Element {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-end gap-x-8 gap-y-2 border-t border-[var(--erp-line)] px-3 pt-3">
      {cells.map((c, i) => (
        <div key={i} className="flex items-baseline gap-2">
          <span className="text-[12px] font-semibold text-[var(--erp-muted)]">{c.label}</span>
          <span className="num text-[15px] font-bold">{c.value}</span>
        </div>
      ))}
    </div>
  );
}

/** "1 to 50 of 230" with previous and next. */
export function Pager({ offset, limit, total, onChange }: { offset: number; limit: number; total: number; onChange: (offset: number) => void }): React.JSX.Element | null {
  if (total <= limit && offset === 0) return null;
  const end = Math.min(total, offset + limit);
  return (
    <div className="mt-4 flex items-center justify-end gap-2">
      <span className="num text-[13px] text-[var(--erp-muted)]">
        {qty(total === 0 ? 0 : offset + 1)} to {qty(end)} of {qty(total)}
      </span>
      <CircleButton icon={ChevronLeft} label="Previous page" variant="row" size={36} disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))} />
      <CircleButton icon={ChevronRight} label="Next page" variant="row" size={36} disabled={end >= total} onClick={() => onChange(offset + limit)} />
    </div>
  );
}

/** A bar of bulk actions that appears while rows are selected. */
export function SelectionBar({ count, onClear, children }: { count: number; onClear: () => void; children: ReactNode }): React.JSX.Element | null {
  if (count === 0) return null;
  return (
    <div className="erp-pop erp-on-ink fixed inset-x-4 bottom-24 z-40 mx-auto flex max-w-xl flex-wrap items-center gap-2 rounded-[22px] bg-[var(--erp-ink)] px-4 py-3 text-[var(--erp-shell)] shadow-[var(--erp-pop-shadow)] md:bottom-6">
      <span className="num text-[14px] font-bold">{count} selected</span>
      <button type="button" onClick={onClear} className="rounded-full px-3 py-1.5 text-[13px] font-semibold hover:bg-[var(--erp-shell)]/10">
        Clear
      </button>
      <span className="flex-1" />
      {children}
    </div>
  );
}
