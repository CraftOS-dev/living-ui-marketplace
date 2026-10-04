/**
 * Generic data table: sortable columns, optional selection, a column
 * picker remembered per table, and CSV export of what is shown. Every list
 * can be filtered, sorted and exported where it is.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, Columns3, Download } from 'lucide-react';
import { Button, cn } from '../../kit/index.ts';
import { downloadText, toCsv } from '../lib/csv.ts';
import { Checkbox } from './ui.tsx';

export interface Col<T> {
  key: string;
  label: string;
  render?: ((r: T) => ReactNode) | undefined;
  /** Value used for sorting and CSV when render is custom. */
  value?: ((r: T) => string | number) | undefined;
  align?: 'left' | 'right' | undefined;
  width?: string | undefined;
  /** Hidden by default (user can show it in the column picker). */
  optional?: boolean | undefined;
  sortable?: boolean | undefined;
}

function load(key: string): string[] | null {
  try {
    const v = localStorage.getItem(`ipm.cols.${key}`);
    return v ? (JSON.parse(v) as string[]) : null;
  } catch {
    return null;
  }
}

export function DataTable<T extends { id: string }>({
  tableId,
  rows,
  columns,
  onRowClick,
  selectable = false,
  selected,
  onSelectedChange,
  empty,
  exportName,
  initialSort,
  toolbar,
  dense = false,
  rowClassName,
}: {
  tableId: string;
  rows: T[];
  columns: Col<T>[];
  onRowClick?: ((r: T) => void) | undefined;
  selectable?: boolean | undefined;
  selected?: Set<string> | undefined;
  onSelectedChange?: ((s: Set<string>) => void) | undefined;
  empty?: ReactNode | undefined;
  exportName?: string | undefined;
  initialSort?: { key: string; dir: 'asc' | 'desc' } | undefined;
  toolbar?: ReactNode | undefined;
  dense?: boolean | undefined;
  rowClassName?: ((r: T) => string) | undefined;
}): React.JSX.Element {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(initialSort ?? null);
  const [visible, setVisible] = useState<string[]>(() => load(tableId) ?? columns.filter((c) => c.optional !== true).map((c) => c.key));
  const [picker, setPicker] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(`ipm.cols.${tableId}`, JSON.stringify(visible));
    } catch {
      /* storage unavailable */
    }
  }, [tableId, visible]);

  const cols = columns.filter((c) => visible.includes(c.key));
  const valueOf = (c: Col<T>, r: T): string | number => {
    if (c.value !== undefined) return c.value(r);
    const v = (r as unknown as Record<string, unknown>)[c.key];
    return typeof v === 'number' ? v : v === null || v === undefined ? '' : String(v);
  };

  const sorted = useMemo(() => {
    if (sort === null) return rows;
    const c = columns.find((x) => x.key === sort.key);
    if (c === undefined) return rows;
    const copy = rows.slice();
    copy.sort((a, b) => {
      const va = valueOf(c, a);
      const vb = valueOf(c, b);
      const empA = va === '' || va === null;
      const empB = vb === '' || vb === null;
      if (empA && !empB) return 1;
      if (empB && !empA) return -1;
      const r = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true });
      return sort.dir === 'asc' ? r : -r;
    });
    return copy;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort, columns]);

  const exportCsv = (): void => {
    const data = sorted.map((r) => {
      const o: Record<string, unknown> = {};
      for (const c of cols) o[c.key] = valueOf(c, r);
      return o;
    });
    downloadText(`${exportName ?? tableId}.csv`, toCsv(cols.map((c) => ({ key: c.key, label: c.label })), data));
  };

  const allSelected = selectable && rows.length > 0 && rows.every((r) => selected?.has(r.id));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--agent-app-border)] px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">{toolbar}</div>
        <div className="relative flex items-center gap-1.5">
          <span className="text-xs tabular-nums text-[var(--agent-app-muted)]">{rows.length} row{rows.length === 1 ? '' : 's'}</span>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setPicker((p) => !p)} aria-label="Choose columns" title="Choose columns">
            <Columns3 size={14} />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={exportCsv} aria-label="Export CSV" title="Export what is shown as CSV">
            <Download size={14} />
          </Button>
          {picker && (
            <div className="absolute right-0 top-8 z-30 w-56 border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-2 shadow-lg">
              {columns.map((c) => (
                <div key={c.key} className="py-0.5">
                  <Checkbox
                    checked={visible.includes(c.key)}
                    label={c.label}
                    onChange={(v) => setVisible((vis) => (v ? columns.filter((x) => vis.includes(x.key) || x.key === c.key).map((x) => x.key) : vis.filter((k) => k !== c.key)))}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {rows.length === 0 ? (
        empty
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-[var(--agent-app-border)] bg-[var(--agent-app-border)]/20">
                {selectable && (
                  <th className="w-8 px-3 py-2">
                    <Checkbox
                      checked={allSelected}
                      indeterminate={!allSelected && rows.some((r) => selected?.has(r.id))}
                      onChange={(v) => onSelectedChange?.(v ? new Set(rows.map((r) => r.id)) : new Set())}
                      ariaLabel="Select all"
                    />
                  </th>
                )}
                {cols.map((c) => {
                  const active = sort?.key === c.key;
                  const canSort = c.sortable !== false;
                  return (
                    <th
                      key={c.key}
                      style={c.width !== undefined ? { width: c.width } : undefined}
                      className={cn(
                        'whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]',
                        c.align === 'right' ? 'text-right' : 'text-left',
                      )}
                    >
                      {canSort ? (
                        <button
                          type="button"
                          className={cn('inline-flex items-center gap-1 uppercase hover:text-[var(--agent-app-text)]', active && 'text-[var(--agent-app-text)]')}
                          onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: 'asc' }))}
                        >
                          {c.label}
                          {active && (sort?.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                        </button>
                      ) : (
                        c.label
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr
                  key={r.id}
                  onClick={onRowClick !== undefined ? () => onRowClick(r) : undefined}
                  className={cn(
                    'border-b border-[var(--agent-app-border)]/60 last:border-0',
                    onRowClick !== undefined && 'cursor-pointer hover:bg-[var(--agent-app-border)]/20',
                    selected?.has(r.id) === true && 'bg-[var(--agent-app-accent)]/5',
                    rowClassName?.(r),
                  )}
                >
                  {selectable && (
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected?.has(r.id) === true}
                        onChange={(v) => {
                          const n = new Set(selected ?? []);
                          if (v) n.add(r.id);
                          else n.delete(r.id);
                          onSelectedChange?.(n);
                        }}
                        ariaLabel="Select row"
                      />
                    </td>
                  )}
                  {cols.map((c) => (
                    <td key={c.key} className={cn('px-3 align-middle', dense ? 'py-1.5' : 'py-2.5', c.align === 'right' ? 'text-right tabular-nums' : 'text-left')}>
                      {c.render !== undefined ? c.render(r) : String(valueOf(c, r))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
