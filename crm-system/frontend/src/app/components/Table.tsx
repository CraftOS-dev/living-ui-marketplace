/**
 * The record table and its filter bar.
 *
 * A dense table (32px rows, sticky header, avatars, relative dates): the
 * checkbox column selects, the name opens the peek (Ctrl/Cmd+click the page),
 * other cells edit in place on click. Headers sort. The filter bar builds
 * the same conditions the AI agent uses ({field, op, value}).
 */
import { useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, Columns3, ListFilter, Plus, X } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { parseMoney, toDecimal } from '../lib/format.ts';
import type { AppState } from '../lib/store.tsx';
import type { AnyRecord, Filter, Obj } from '../lib/types.ts';
import { Check } from './controls.tsx';
import { Display, Editor } from './fields.tsx';
import type { FSpec } from './fields.tsx';
import { Btn, MenuList, Popover, Select, input } from './ui.tsx';

export interface Column<T> {
  key: string;
  label: string;
  width: number;
  sortKey?: string | undefined;
  align?: 'right' | undefined;
  render: (r: T) => ReactNode;
  spec?: FSpec | undefined;
  footer?: ((rows: T[]) => ReactNode) | undefined;
}

export function RecordTable<T extends AnyRecord>({
  object,
  app,
  rows,
  columns,
  selected,
  onSelect,
  activeId,
  onActivate,
  sort,
  dir,
  onSort,
  empty,
}: {
  object: Obj;
  app: AppState;
  rows: T[];
  columns: Column<T>[];
  selected: Set<string>;
  onSelect: (s: Set<string>) => void;
  activeId: string;
  onActivate: (id: string, page: boolean) => void;
  sort: string;
  dir: 'asc' | 'desc';
  onSort: (key: string) => void;
  empty?: ReactNode | undefined;
}): React.JSX.Element {
  const [editing, setEditing] = useState<{ id: string; key: string } | null>(null);
  const all = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const some = !all && rows.some((r) => selected.has(r.id));
  const last = useRef<string>('');
  const hasFooter = columns.some((c) => c.footer !== undefined);
  return (
    <table className="cr-table cr-grid" style={{ minWidth: 40 + columns.reduce((t, c) => t + c.width, 0) }}>
      <colgroup>
        <col style={{ width: 36 }} />
        {columns.map((c) => (
          <col key={c.key} style={{ width: c.width }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          <th className="!pl-3">
            <Check checked={all} indeterminate={some} onChange={(v) => onSelect(v ? new Set(rows.map((r) => r.id)) : new Set())} label="Select all" />
          </th>
          {columns.map((c) => (
            <th key={c.key} className={cn(c.align === 'right' && 'r')}>
              {c.sortKey !== undefined ? (
                <button type="button" onClick={() => onSort(c.sortKey as string)} className={cn('inline-flex items-center gap-1 uppercase hover:text-[var(--cr-ink)]', sort === c.sortKey && 'text-[var(--cr-ink)]')}>
                  {c.label}
                  {sort === c.sortKey && (dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                </button>
              ) : (
                c.label
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const sel = selected.has(r.id);
          return (
            <tr key={r.id} data-sel={sel || r.id === activeId ? 'true' : undefined} data-row={r.id} className={cn(r.id === activeId && 'cr-active')}>
              <td className="!pl-3">
                <Check
                  checked={sel}
                  label="Select"
                  onChange={(v) => {
                    const n = new Set(selected);
                    // Shift-click selects the range from the last clicked row.
                    const ev = window.event as MouseEvent | undefined;
                    if (ev?.shiftKey && last.current !== '') {
                      const a = rows.findIndex((x) => x.id === last.current);
                      const b = rows.findIndex((x) => x.id === r.id);
                      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (rows[i]) n.add(rows[i]!.id);
                    } else if (v) n.add(r.id);
                    else n.delete(r.id);
                    last.current = r.id;
                    onSelect(n);
                  }}
                />
              </td>
              {columns.map((c, ci) => {
                const isEdit = editing !== null && editing.id === r.id && editing.key === c.key;
                return (
                  <td
                    key={c.key}
                    className={cn('max-w-0', c.align === 'right' && 'r', c.spec !== undefined && !isEdit && 'cr-editable', isEdit && 'cr-editing')}
                    onClick={(e) => {
                      if (ci === 0) return onActivate(r.id, e.ctrlKey || e.metaKey);
                      if (c.spec !== undefined && !isEdit) setEditing({ id: r.id, key: c.key });
                      else if (c.spec === undefined) onActivate(r.id, e.ctrlKey || e.metaKey);
                    }}
                  >
                    {isEdit && c.spec !== undefined ? (
                      <div className="cr-cell-editor" onClick={(e) => e.stopPropagation()}>
                        <Editor object={object} rec={r} spec={c.spec} app={app} onDone={() => setEditing(null)} />
                      </div>
                    ) : (
                      <div className={cn('flex min-w-0 items-center gap-1.5', c.align === 'right' && 'justify-end')}>{c.render(r)}</div>
                    )}
                  </td>
                );
              })}
            </tr>
          );
        })}
        {rows.length === 0 && empty !== undefined && (
          <tr>
            <td colSpan={columns.length + 1} className="!h-auto !border-0">
              {empty}
            </td>
          </tr>
        )}
      </tbody>
      {hasFooter && rows.length > 0 && (
        <tfoot>
          <tr>
            <td />
            {columns.map((c) => (
              <td key={c.key} className={cn('text-[11.5px] font-semibold text-[var(--cr-ink-2)]', c.align === 'right' && 'r')}>
                {c.footer?.(rows)}
              </td>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  );
}

/** Default cell for a field spec. */
export function cell<T extends AnyRecord>(app: AppState, spec: FSpec): (r: T) => ReactNode {
  return (r: T) => <Display rec={r} spec={spec} app={app} compact />;
}

/* --------------------------------------------------------------- filters */

export interface FilterField {
  key: string;
  label: string;
  kind: 'text' | 'number' | 'money' | 'date' | 'future' | 'tag' | 'select' | 'list' | 'bool';
  options?: { value: string; label: string }[] | undefined;
}

const OPS: Record<FilterField['kind'], { value: string; label: string }[]> = {
  text: [
    { value: 'contains', label: 'contains' },
    { value: 'is', label: 'is' },
    { value: 'is_not', label: 'is not' },
    { value: 'not_contains', label: 'does not contain' },
    { value: 'starts_with', label: 'starts with' },
    { value: 'empty', label: 'is empty' },
    { value: 'not_empty', label: 'is not empty' },
  ],
  number: [
    { value: 'gte', label: 'at least' },
    { value: 'gt', label: 'more than' },
    { value: 'lte', label: 'at most' },
    { value: 'lt', label: 'less than' },
    { value: 'is', label: 'is' },
  ],
  money: [
    { value: 'gte', label: 'at least' },
    { value: 'lte', label: 'at most' },
  ],
  date: [
    { value: 'within_days', label: 'in the last' },
    { value: 'older_than_days', label: 'more than ... ago' },
    { value: 'before', label: 'before' },
    { value: 'after', label: 'after' },
    { value: 'empty', label: 'is empty' },
    { value: 'not_empty', label: 'is not empty' },
  ],
  future: [
    { value: 'within_days', label: 'in the next' },
    { value: 'before', label: 'before' },
    { value: 'after', label: 'after' },
    { value: 'empty', label: 'is empty' },
    { value: 'not_empty', label: 'is not empty' },
  ],
  tag: [{ value: 'has_tag', label: 'has' }],
  select: [
    { value: 'is', label: 'is' },
    { value: 'is_not', label: 'is not' },
  ],
  list: [
    { value: 'is', label: 'in' },
    { value: 'is_not', label: 'not in' },
  ],
  bool: [{ value: 'is', label: 'is' }],
};

const NO_VALUE = new Set(['empty', 'not_empty']);

function describe(f: Filter, field: FilterField | undefined, home: string): string {
  const op = (field ? OPS[field.kind] : OPS.text).find((o) => o.value === f.op)?.label ?? f.op;
  let v = f.value === undefined ? '' : String(f.value);
  if (field?.kind === 'list' || field?.kind === 'select' || field?.kind === 'bool') v = field.options?.find((o) => o.value === v)?.label ?? v;
  if (field?.kind === 'money') v = toDecimal(Number(v), home);
  if ((f.op === 'within_days' || f.op === 'older_than_days') && v !== '') v = v + ' days';
  return (field?.label ?? f.field) + ' ' + op + (NO_VALUE.has(f.op) ? '' : ' ' + v);
}

function FilterEditor({ fields, initial, home, onDone }: { fields: FilterField[]; initial: Filter | null; home: string; onDone: (f: Filter | null) => void }): React.JSX.Element {
  const [key, setKey] = useState(initial?.field ?? '');
  const field = fields.find((f) => f.key === key);
  const ops = field ? OPS[field.kind] : [];
  const [op, setOp] = useState(initial?.op ?? '');
  const [value, setValue] = useState(initial?.value !== undefined ? (field?.kind === 'money' ? toDecimal(Number(initial.value), home) : String(initial.value)) : '');
  if (field === undefined)
    return (
      <MenuList
        items={fields.map((f) => ({
          label: f.label,
          onClick: () => {
            setKey(f.key);
            const first = OPS[f.kind][0]?.value ?? 'is';
            setOp(first);
            setValue(f.kind === 'date' || f.kind === 'future' ? '30' : f.options?.[0]?.value ?? '');
          },
        }))}
        onPicked={() => undefined}
      />
    );
  const realOp = op || ops[0]?.value || 'is';
  const needs = !NO_VALUE.has(realOp);
  const apply = (): void => {
    let v: unknown = value;
    if (field.kind === 'money') v = parseMoney(value, home) ?? 0;
    else if (field.kind === 'number' || realOp === 'within_days' || realOp === 'older_than_days') v = Number(value || 0);
    onDone({ field: key, op: realOp, value: needs ? v : undefined });
  };
  return (
    <div className="flex w-[280px] flex-col gap-2 p-2">
      <p className="text-[12px] font-bold">{field.label}</p>
      <Select small label="Condition" value={realOp} onChange={setOp} options={ops} />
      {needs &&
        (field.options !== undefined ? (
          <Select small label="Value" value={value} onChange={setValue} options={field.options} />
        ) : (
          <div className="flex items-center gap-1.5">
            <input
              autoFocus
              type={realOp === 'before' || realOp === 'after' ? 'date' : 'text'}
              inputMode={field.kind === 'number' || field.kind === 'money' || realOp.endsWith('_days') ? 'decimal' : undefined}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && apply()}
              className={cn(input, 'h-6 text-[12px]')}
            />
            {realOp.endsWith('_days') && <span className="text-[12px] text-[var(--cr-muted)]">days</span>}
          </div>
        ))}
      <div className="flex justify-end gap-1.5">
        <Btn size="xs" variant="ghost" onClick={() => onDone(null)}>
          Cancel
        </Btn>
        <Btn size="xs" variant="primary" onClick={apply}>
          Apply
        </Btn>
      </div>
    </div>
  );
}

export function FilterBar({ fields, filters, match, home, onChange, onMatch }: { fields: FilterField[]; filters: Filter[]; match: 'all' | 'any'; home: string; onChange: (f: Filter[]) => void; onMatch: (m: 'all' | 'any') => void }): React.JSX.Element {
  const [open, setOpen] = useState<number | 'new' | null>(null);
  const addRef = useRef<HTMLButtonElement | null>(null);
  // One stable anchor object per chip (a new object each render would re-position forever).
  const anchors = useRef(new Map<number, { current: HTMLButtonElement | null }>());
  const anchorOf = (i: number): { current: HTMLButtonElement | null } => {
    let a = anchors.current.get(i);
    if (a === undefined) {
      a = { current: null };
      anchors.current.set(i, a);
    }
    return a;
  };
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      {filters.map((f, i) => {
        const field = fields.find((x) => x.key === f.field);
        return (
          <span key={i} className="inline-flex h-6 items-center rounded-[5px] border border-[var(--cr-line)] bg-[var(--cr-row)] text-[12px]">
            <button
              ref={(el) => {
                anchorOf(i).current = el;
              }}
              type="button"
              onClick={() => setOpen(i)}
              className="max-w-[260px] truncate px-1.5 font-semibold"
            >
              {describe(f, field, home)}
            </button>
            <button type="button" aria-label="Remove filter" onClick={() => onChange(filters.filter((_, j) => j !== i))} className="flex h-full items-center border-l border-[var(--cr-line)] px-1 text-[var(--cr-muted)] hover:text-[var(--cr-ink)]">
              <X size={11} />
            </button>
            <Popover open={open === i} onClose={() => setOpen(null)} anchor={anchorOf(i)} className="p-0">
              <FilterEditor
                fields={fields}
                initial={f}
                home={home}
                onDone={(nf) => {
                  setOpen(null);
                  if (nf) onChange(filters.map((x, j) => (j === i ? nf : x)));
                }}
              />
            </Popover>
            {i < filters.length - 1 && filters.length > 1 && <span className="sr-only">{match}</span>}
          </span>
        );
      })}
      {filters.length > 1 && (
        <button type="button" onClick={() => onMatch(match === 'all' ? 'any' : 'all')} className="h-6 rounded-[5px] px-1.5 text-[11.5px] font-semibold text-[var(--cr-ink-2)] hover:bg-[var(--cr-row)]" title="How the conditions combine">
          match {match}
        </button>
      )}
      <button ref={addRef} type="button" onClick={() => setOpen('new')} className="inline-flex h-6 items-center gap-1 rounded-[5px] px-1.5 text-[12px] font-semibold text-[var(--cr-ink-2)] hover:bg-[var(--cr-row)] hover:text-[var(--cr-ink)]">
        {filters.length === 0 ? <ListFilter size={13} /> : <Plus size={12} />} {filters.length === 0 ? 'Filter' : 'Add'}
      </button>
      <Popover open={open === 'new'} onClose={() => setOpen(null)} anchor={addRef} className={cn('p-1')}>
        <FilterEditor
          fields={fields}
          initial={null}
          home={home}
          onDone={(nf) => {
            setOpen(null);
            if (nf) onChange([...filters, nf]);
          }}
        />
      </Popover>
    </div>
  );
}

/** Choose which columns show. */
export function ColumnChooser({ all, visible, onChange }: { all: { key: string; label: string }[]; visible: string[]; onChange: (v: string[]) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement | null>(null);
  const items = useMemo(
    () =>
      all.slice(1).map((c) => ({
        label: c.label,
        checked: visible.includes(c.key),
        onClick: () => onChange(visible.includes(c.key) ? visible.filter((k) => k !== c.key) : all.filter((x) => visible.includes(x.key) || x.key === c.key).map((x) => x.key)),
      })),
    [all, visible, onChange],
  );
  return (
    <>
      <button ref={ref} type="button" onClick={() => setOpen(!open)} className="inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2 text-[12px] font-semibold text-[var(--cr-ink-2)] hover:bg-[var(--cr-row)]" aria-label="Columns">
        <Columns3 size={13} /> <span className="hidden xl:inline">Columns</span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} align="right" className="w-56">
        <MenuList items={[{ heading: 'Columns' }, ...items]} onPicked={() => undefined} />
      </Popover>
    </>
  );
}
