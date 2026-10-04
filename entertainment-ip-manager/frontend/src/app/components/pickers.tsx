/**
 * Pickers: people, records (searchable), offices and countries, the
 * catalogue lists (franchise, title, character, talent) from app context,
 * and hierarchical rights-dimension values with include and exclude.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Search, X } from 'lucide-react';
import type { RecordModel } from 'pocketbase';
import { Select, cn, getPbClient } from '../../kit/index.ts';
import { useApp } from '../lib/context.tsx';
import { useLiveReload } from '../lib/live.ts';
import { isJa, t } from '../lib/i18n.ts';
import { OFFICES, jurisdictionName } from '../lib/labels.ts';
import type { DimensionValueRec, PartyRec } from '../lib/records.ts';
import type { DimSpec } from '../lib/shapes.ts';
import { JurChip } from './ui.tsx';

/** Internal people who can own work (external portal accounts excluded). */
export function UserSelect({
  value,
  onChange,
  label,
  placeholder,
  includeExternal = false,
}: {
  value: string;
  onChange: (id: string) => void;
  label?: string | undefined;
  placeholder?: string | undefined;
  includeExternal?: boolean | undefined;
}): React.JSX.Element {
  const { users } = useApp();
  const external = new Set(['licensee', 'committee_member', 'reviewer']);
  const opts = users
    .filter((u) => (includeExternal || !external.has(u.role)) && u.role !== 'viewer')
    .map((u) => ({ value: u.id, label: u.name || u.email }));
  return <Select label={label} value={value} placeholder={placeholder ?? t('Nobody')} options={opts} onChange={(e) => onChange(e.target.value)} />;
}

const COUNTRY_CODES = ['JP', 'US', 'CN', 'KR', 'TW', 'EM', 'WO', 'HK', 'MO', 'SG', 'TH', 'VN', 'ID', 'MY', 'PH', 'IN', 'AU', 'NZ', 'CA', 'MX', 'BR', 'GB', 'DE', 'FR', 'IT', 'ES', 'RU', 'SA', 'AE'];

/** Office or country select; the organization's offices first. */
export function JurisdictionSelect({
  value,
  onChange,
  label,
  placeholder,
  officesOnly = false,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string | undefined;
  placeholder?: string | undefined;
  officesOnly?: boolean | undefined;
}): React.JSX.Element {
  const { jurisdictions } = useApp();
  const first = jurisdictions.map((c) => c.toUpperCase());
  const pool = officesOnly ? [...OFFICES] : COUNTRY_CODES;
  const codes = [...first.filter((c) => pool.includes(c)), ...pool.filter((c) => !first.includes(c))];
  if (value !== '' && !codes.includes(value)) codes.push(value);
  const options = codes.map((c) => ({ value: c, label: `${c} · ${jurisdictionName(c)}` }));
  return <Select label={label} value={value} placeholder={placeholder ?? t('Choose')} options={options} onChange={(e) => onChange(e.target.value)} />;
}

/** Multi-select of office codes as toggle chips. */
export function JurisdictionChips({ value, onChange, options }: { value: string[]; onChange: (v: string[]) => void; options: readonly string[] }): React.JSX.Element {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((c) => {
        const on = value.includes(c);
        return (
          <button
            key={c}
            type="button"
            title={jurisdictionName(c)}
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== c) : [...value, c])}
            className={cn(
              'flex items-center gap-1.5 border px-2 py-1 text-xs',
              on ? 'border-[var(--agent-app-accent)] bg-[var(--agent-app-accent)]/10 text-[var(--agent-app-accent)]' : 'border-[var(--agent-app-border)] text-[var(--agent-app-text)]/80 hover:bg-[var(--agent-app-border)]/30',
            )}
          >
            <span className="font-mono font-semibold">{c}</span>
            <span className="hidden sm:inline">{jurisdictionName(c)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Select over the catalogue lists already loaded in app context (no extra requests). */
export function CatalogSelect({
  kind,
  value,
  onChange,
  label,
  placeholder,
  filter,
}: {
  kind: 'franchise' | 'work' | 'character' | 'talent';
  value: string;
  onChange: (id: string) => void;
  label?: string | undefined;
  placeholder?: string | undefined;
  filter?: ((id: string) => boolean) | undefined;
}): React.JSX.Element {
  const { franchises, titles, characters, talents } = useApp();
  const rows: { value: string; label: string }[] =
    kind === 'franchise'
      ? franchises.map((x) => ({ value: x.id, label: x.name }))
      : kind === 'work'
        ? titles.map((x) => ({ value: x.id, label: x.title }))
        : kind === 'character'
          ? characters.map((x) => ({ value: x.id, label: x.name }))
          : talents.map((x) => ({ value: x.id, label: x.stage_name }));
  const options = filter === undefined ? rows : rows.filter((r) => filter(r.value) || r.value === value);
  return <Select label={label} value={value} placeholder={placeholder ?? t('None')} options={options} onChange={(e) => onChange(e.target.value)} />;
}

/**
 * Searchable single-record picker over a collection. `labelOf` renders a
 * record; `searchFields` are matched with PocketBase's ~ operator.
 */
export function RecordPicker<T extends RecordModel>({
  collection,
  value,
  onChange,
  labelOf,
  searchFields,
  filter,
  placeholder,
  label,
  allowClear = true,
}: {
  collection: string;
  value: string;
  onChange: (id: string, record: T | null) => void;
  labelOf: (r: T) => string;
  searchFields: string[];
  filter?: string | undefined;
  placeholder?: string | undefined;
  label?: string | undefined;
  allowClear?: boolean | undefined;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [items, setItems] = useState<T[]>([]);
  const [current, setCurrent] = useState<T | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!value) {
      setCurrent(null);
      return;
    }
    let cancelled = false;
    getPbClient()
      .call((p) => p.collection(collection).getOne<T>(value), { silent: true })
      .then((r) => {
        if (!cancelled) setCurrent(r);
      })
      .catch(() => {
        if (!cancelled) setCurrent(null);
      });
    return () => {
      cancelled = true;
    };
  }, [collection, value]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const parts: string[] = [];
      if (term.trim() !== '') {
        const esc = term.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        parts.push(`(${searchFields.map((f) => `${f} ~ "${esc}"`).join(' || ')})`);
      }
      if (filter !== undefined && filter !== '') parts.push(`(${filter})`);
      getPbClient()
        .call((p) => p.collection(collection).getList<T>(1, 30, { filter: parts.join(' && '), sort: '-updated' }), { silent: true })
        .then((r) => {
          if (!cancelled) setItems(r.items);
        })
        .catch(() => {
          if (!cancelled) setItems([]);
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, term, collection, filter, searchFields]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent): void => {
      if (boxRef.current !== null && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="flex min-w-0 flex-col gap-1.5" ref={boxRef}>
      {label !== undefined && <span className="text-[13px] font-medium">{label}</span>}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex h-9 w-full items-center justify-between gap-2 border border-[var(--agent-app-border)] bg-[var(--agent-app-surface-2)] px-3 text-left text-sm"
        >
          <span className={cn('truncate', current === null && 'text-[var(--agent-app-muted)]')}>{current !== null ? labelOf(current) : value ? t('Loading') : t('None')}</span>
          <span className="flex items-center gap-1">
            {allowClear && value !== '' && (
              <span
                role="button"
                tabIndex={0}
                aria-label={t('Clear')}
                className="text-[var(--agent-app-muted)] hover:text-[var(--agent-app-text)]"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange('', null);
                }}
              >
                <X size={14} />
              </span>
            )}
            <ChevronDown size={14} className="text-[var(--agent-app-muted)]" />
          </span>
        </button>
        {open && (
          <div className="absolute left-0 right-0 top-10 z-50 border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] shadow-lg">
            <div className="flex items-center gap-2 border-b border-[var(--agent-app-border)] px-2">
              <Search size={13} className="text-[var(--agent-app-muted)]" />
              <input autoFocus className="h-8 w-full bg-transparent text-sm outline-none" placeholder={placeholder ?? t('Search')} value={term} onChange={(e) => setTerm(e.target.value)} />
            </div>
            <div className="max-h-64 overflow-y-auto">
              {items.length === 0 ? (
                <div className="px-3 py-3 text-xs text-[var(--agent-app-muted)]">{t('No matches')}</div>
              ) : (
                items.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className={cn('block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-[var(--agent-app-border)]/30', r.id === value && 'bg-[var(--agent-app-accent)]/10')}
                    onClick={() => {
                      onChange(r.id, r);
                      setOpen(false);
                      setTerm('');
                    }}
                  >
                    {labelOf(r)}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Multi-record picker shown as removable chips. */
export function MultiRecordPicker<T extends RecordModel>({
  collection,
  value,
  onChange,
  labelOf,
  searchFields,
  filter,
  placeholder,
  label,
}: {
  collection: string;
  value: string[];
  onChange: (ids: string[]) => void;
  labelOf: (r: T) => string;
  searchFields: string[];
  filter?: string | undefined;
  placeholder?: string | undefined;
  label?: string | undefined;
}): React.JSX.Element {
  const [labels, setLabels] = useState<Record<string, string>>({});
  // A renamed record (by anyone, including an agent) relabels its chip.
  useLiveReload([collection], () => setLabels({}), value.length > 0);
  useEffect(() => {
    const missing = value.filter((id) => labels[id] === undefined);
    if (!missing.length) return;
    let cancelled = false;
    getPbClient()
      .call((p) => p.collection(collection).getFullList<T>({ filter: missing.map((id) => `id = "${id}"`).join(' || ') }), { silent: true })
      .then((rows) => {
        if (cancelled) return;
        setLabels((l) => {
          const n = { ...l };
          for (const r of rows) n[r.id] = labelOf(r);
          return n;
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [value, collection, labels, labelOf]);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {label !== undefined && <span className="text-[13px] font-medium">{label}</span>}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => (
            <span key={id} className="inline-flex max-w-full items-center gap-1 border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-2 py-0.5 text-xs">
              <span className="truncate">{labels[id] ?? '...'}</span>
              <button type="button" aria-label={t('Remove')} onClick={() => onChange(value.filter((x) => x !== id))} className="text-[var(--agent-app-muted)] hover:text-red-600">
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <RecordPicker<T>
        collection={collection}
        value=""
        allowClear={false}
        onChange={(id, r) => {
          if (id && !value.includes(id)) {
            if (r !== null) setLabels((l) => ({ ...l, [id]: labelOf(r) }));
            onChange([...value, id]);
          }
        }}
        labelOf={labelOf}
        searchFields={searchFields}
        filter={filter}
        placeholder={placeholder ?? t('Add')}
      />
    </div>
  );
}

/** A person or company (parties). */
export function PartyPicker({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: string;
  onChange: (id: string, record: PartyRec | null) => void;
  label?: string | undefined;
  placeholder?: string | undefined;
}): React.JSX.Element {
  return <RecordPicker<PartyRec> collection="parties" value={value} onChange={onChange} labelOf={(p) => p.name} searchFields={['name', 'name_kana', 'aliases', 'organization']} label={label} placeholder={placeholder} />;
}

/* ------------------------------------------------------------------ */
/* Dimension picker: tree with include / exclude                       */
/* ------------------------------------------------------------------ */

function childrenMap(values: DimensionValueRec[]): Map<string, DimensionValueRec[]> {
  const m = new Map<string, DimensionValueRec[]>();
  for (const v of values) {
    const k = v.parent_code || '';
    const arr = m.get(k) ?? [];
    arr.push(v);
    m.set(k, arr);
  }
  return m;
}

function dimName(v: DimensionValueRec): string {
  return isJa() ? v.label_ja || v.label : v.label;
}

export function dimSpecLabel(values: DimensionValueRec[], spec: DimSpec | undefined): string {
  const lab = (c: string): string => {
    const v = values.find((x) => x.code === c);
    return v === undefined ? c : dimName(v);
  };
  const inc = spec?.include ?? [];
  const exc = spec?.exclude ?? [];
  if (inc.length === 0 && exc.length === 0) return t('All');
  let s = inc.length ? inc.map(lab).join(isJa() ? '、' : ', ') : t('All');
  if (exc.length) s += t(' excl. {list}', { list: exc.map(lab).join(isJa() ? '、' : ', ') });
  return s;
}

export function DimensionPicker({
  dimension,
  value,
  onChange,
  label,
  allowExclude = true,
}: {
  dimension: string;
  value: DimSpec;
  onChange: (v: DimSpec) => void;
  label?: string | undefined;
  allowExclude?: boolean | undefined;
}): React.JSX.Element {
  const { dimValues } = useApp();
  const values = useMemo(() => dimValues.filter((v) => v.dimension === dimension), [dimValues, dimension]);
  const kids = useMemo(() => childrenMap(values), [values]);
  const roots = kids.get('') ?? [];
  const [openNodes, setOpenNodes] = useState<Set<string>>(() => new Set(roots.map((r) => r.code)));
  const [term, setTerm] = useState('');
  const include = value.include ?? [];
  const exclude = value.exclude ?? [];

  const cycle = (code: string): void => {
    // none -> include -> exclude -> none
    if (include.includes(code)) {
      onChange({ include: include.filter((c) => c !== code), exclude: allowExclude ? [...exclude, code] : exclude });
    } else if (exclude.includes(code)) {
      onChange({ include, exclude: exclude.filter((c) => c !== code) });
    } else {
      onChange({ include: [...include, code], exclude });
    }
  };

  const matches = (v: DimensionValueRec): boolean => {
    const q = term.trim().toLowerCase();
    return q === '' || v.label.toLowerCase().includes(q) || (v.label_ja ?? '').includes(term.trim()) || v.code.toLowerCase() === q;
  };

  const render = (v: DimensionValueRec, depth: number): React.JSX.Element | null => {
    const ch = kids.get(v.code) ?? [];
    const visibleKids = ch.map((c) => render(c, depth + 1)).filter((x) => x !== null);
    if (!matches(v) && visibleKids.length === 0) return null;
    const isOpen = openNodes.has(v.code) || term.trim() !== '';
    const state = include.includes(v.code) ? 'in' : exclude.includes(v.code) ? 'ex' : '';
    return (
      <div key={v.code}>
        <div className="flex items-center gap-1 py-0.5" style={{ paddingLeft: depth * 14 }}>
          {ch.length > 0 ? (
            <button
              type="button"
              className="text-[var(--agent-app-muted)]"
              aria-label={isOpen ? t('Collapse') : t('Expand')}
              onClick={() =>
                setOpenNodes((s) => {
                  const n = new Set(s);
                  if (n.has(v.code)) n.delete(v.code);
                  else n.add(v.code);
                  return n;
                })
              }
            >
              {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
          ) : (
            <span className="w-[13px]" />
          )}
          <button
            type="button"
            onClick={() => cycle(v.code)}
            className={cn(
              'flex min-w-0 items-center gap-1.5 px-1.5 py-0.5 text-left text-[12.5px]',
              state === 'in' && 'bg-emerald-500/10 font-medium text-emerald-700 dark:text-emerald-400',
              state === 'ex' && 'bg-red-500/10 text-red-700 line-through dark:text-red-400',
              state === '' && 'hover:bg-[var(--agent-app-border)]/30',
            )}
            title={state === 'in' ? t('Included (click to exclude)') : state === 'ex' ? t('Excluded (click to clear)') : t('Click to include')}
          >
            {dimension === 'territory' && v.code.length === 2 && <JurChip code={v.code} />}
            <span className="truncate">{dimName(v)}</span>
          </button>
        </div>
        {isOpen && visibleKids}
      </div>
    );
  };

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {label !== undefined && (
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[13px] font-medium">{label}</span>
          <span className="truncate text-xs text-[var(--agent-app-muted)]">{dimSpecLabel(values, value)}</span>
        </div>
      )}
      <div className="border border-[var(--agent-app-border)]">
        <div className="flex items-center gap-2 border-b border-[var(--agent-app-border)] px-2">
          <Search size={13} className="text-[var(--agent-app-muted)]" />
          <input className="h-8 w-full bg-transparent text-sm outline-none" placeholder={t('Filter')} value={term} onChange={(e) => setTerm(e.target.value)} />
          {(include.length > 0 || exclude.length > 0) && (
            <button type="button" className="shrink-0 text-xs text-[var(--agent-app-muted)] hover:underline" onClick={() => onChange({ include: [], exclude: [] })}>
              {t('Clear')}
            </button>
          )}
        </div>
        <div className="max-h-60 overflow-y-auto px-1 py-1">{roots.map((r) => render(r, 0))}</div>
      </div>
      <p className="text-[11px] text-[var(--agent-app-muted)]">
        {allowExclude ? t('Click once to include, twice to exclude. Nothing selected means all.') : t('Click to include. Nothing selected means all.')}
      </p>
    </div>
  );
}
