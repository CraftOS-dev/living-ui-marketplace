/**
 * Choosing records and typing values:
 *  - Picker: a search field with a list under it (keyboard friendly), for
 *    any record an operation can search. PartyPicker, ItemPicker,
 *    AccountPicker, BankPicker, EmployeePicker, ProjectPicker,
 *    WarehousePicker, TaxPicker and MemberPicker are ready-made.
 *  - DateField and MonthField: a pill that opens a calendar.
 *  - MoneyInput and NumberInput: typed numbers, normalized to "1234.5".
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Building2, CalendarDays, Check, ChevronDown, Landmark, Package, Plus, Search, User, X } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { dayLabel, monthLabel, today } from '../lib/dates.ts';
import { normalizeNumber, symbolOf } from '../lib/format.ts';
import { useDebounced } from './controls.tsx';
import { DayPicker, Popover, cellInput, softInput } from './ui.tsx';

/* ------------------------------------------------------------- generic */

export interface Option {
  id: string;
  label: string;
  sub?: string | undefined;
  right?: string | undefined;
  /** What the operation receives (an id, a code, a SKU). Default `id`. */
  value?: string | undefined;
  icon?: LucideIcon | undefined;
  data?: unknown | undefined;
}

/**
 * A field that shows the chosen record and, when pressed, a search box with
 * matches under it. `search` is called with the typed text (debounced).
 * `onCreate` adds a "Create ..." row for what was typed.
 */
export function Picker({
  value,
  onChange,
  search,
  placeholder,
  ariaLabel,
  icon: Icon = Search,
  onCreate,
  createLabel = 'Create',
  clearable = false,
  size = 'md',
  disabled = false,
  className,
  autoOpen = false,
}: {
  value: Option | null;
  onChange: (o: Option | null) => void;
  search: (q: string) => Promise<Option[]>;
  placeholder: string;
  ariaLabel: string;
  icon?: LucideIcon | undefined;
  onCreate?: ((text: string) => void) | undefined;
  createLabel?: string | undefined;
  clearable?: boolean | undefined;
  size?: 'md' | 'cell' | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
  autoOpen?: boolean | undefined;
}): React.JSX.Element {
  const [open, setOpen] = useState(autoOpen);
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 180);
  const [items, setItems] = useState<Option[]>([]);
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState(0);
  const box = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const listId = useId();
  const searchRef = useRef(search);
  searchRef.current = search;

  // The text the shown results belong to, and an Enter pressed before they caught up.
  const [itemsFor, setItemsFor] = useState<string | null>(null);
  const enterPending = useRef(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setBusy(true);
    searchRef
      .current(dq)
      .then((r) => {
        if (!live) return;
        setItems(r);
        setItemsFor(dq);
        setCursor(0);
      })
      .catch(() => {
        if (live) setItems([]);
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [dq, open]);

  useEffect(() => {
    if (!enterPending.current || itemsFor !== q) return;
    enterPending.current = false;
    const it = items[0];
    if (it !== undefined) pick(it);
    else if (onCreate !== undefined && q.trim() !== '') {
      setOpen(false);
      onCreate(q.trim());
    }
    // Only when the results for the typed text arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsFor, items]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent): void => {
      if (box.current !== null && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    setTimeout(() => input.current?.focus(), 0);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const pick = (o: Option): void => {
    onChange(o);
    setOpen(false);
    setQ('');
  };
  const canCreate = onCreate !== undefined && q.trim() !== '';
  const total = items.length + (canCreate ? 1 : 0);

  const base = size === 'cell' ? cellInput : softInput;
  return (
    <div ref={box} className={cn('relative min-w-0', className)}>
      {!open ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          aria-label={ariaLabel}
          className={cn(base, 'flex items-center gap-2 text-left', size === 'cell' ? 'pr-2' : 'pr-3')}
        >
          {value !== null && value.icon !== undefined ? <value.icon size={15} className="shrink-0 text-[var(--erp-ink-2)]" aria-hidden /> : null}
          <span className={cn('min-w-0 flex-1 truncate', value === null && 'text-[var(--erp-muted)]')}>{value?.label ?? placeholder}</span>
          {value !== null && value.sub !== undefined && size !== 'cell' && <span className="hidden max-w-[40%] shrink-0 truncate text-[12px] text-[var(--erp-muted)] @min-[480px]:inline">{value.sub}</span>}
          {clearable && value !== null && !disabled ? (
            <span
              role="button"
              tabIndex={0}
              aria-label={`Clear ${ariaLabel}`}
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.stopPropagation();
                  onChange(null);
                }
              }}
              className="flex size-6 shrink-0 items-center justify-center rounded-full hover:bg-[var(--erp-row-hover)]"
            >
              <X size={13} />
            </span>
          ) : (
            !disabled && <ChevronDown size={15} className="shrink-0 text-[var(--erp-muted)]" aria-hidden />
          )}
        </button>
      ) : (
        <div className="relative">
          <Icon size={15} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--erp-muted)]" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-label={ariaLabel}
            placeholder={value?.label ?? placeholder}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setOpen(false);
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setCursor((c) => Math.min(total - 1, c + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setCursor((c) => Math.max(0, c - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                // Results still on their way for what was typed: act when they land.
                if (itemsFor !== q) {
                  enterPending.current = true;
                  return;
                }
                const it = items[cursor];
                if (it !== undefined) pick(it);
                else if (canCreate) {
                  setOpen(false);
                  onCreate?.(q.trim());
                }
              } else if (e.key === 'Tab') setOpen(false);
            }}
            className={cn(base, 'pl-9 ring-2')}
          />
        </div>
      )}
      {open && (
        <div id={listId} role="listbox" className="erp-pop erp-on-card absolute left-0 top-[calc(100%+6px)] z-50 max-h-72 w-full min-w-[260px] overflow-y-auto rounded-[18px] bg-[var(--erp-card)] p-1.5 shadow-[var(--erp-pop-shadow)]">
          {busy && items.length === 0 && <p className="px-3 py-2.5 text-[13px] text-[var(--erp-muted)]">Searching</p>}
          {!busy && items.length === 0 && !canCreate && <p className="px-3 py-2.5 text-[13px] text-[var(--erp-muted)]">{q === '' ? 'Nothing here yet' : 'No matches'}</p>}
          {items.map((o, i) => {
            const OIcon = o.icon;
            return (
              <button
                key={o.id}
                type="button"
                role="option"
                aria-selected={value?.id === o.id}
                onMouseEnter={() => setCursor(i)}
                onClick={() => pick(o)}
                className={cn('flex w-full items-center gap-3 rounded-[12px] px-3 py-2 text-left', cursor === i && 'bg-[var(--erp-row)]')}
              >
                {OIcon !== undefined && <OIcon size={15} className="shrink-0 text-[var(--erp-ink-2)]" aria-hidden />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold">{o.label}</span>
                  {o.sub !== undefined && o.sub !== '' && <span className="block truncate text-[12px] text-[var(--erp-muted)]">{o.sub}</span>}
                </span>
                {o.right !== undefined && <span className="num shrink-0 text-[12px] font-semibold text-[var(--erp-ink-2)]">{o.right}</span>}
                {value?.id === o.id && <Check size={15} className="shrink-0" aria-hidden />}
              </button>
            );
          })}
          {canCreate && (
            <button
              type="button"
              onMouseEnter={() => setCursor(items.length)}
              onClick={() => {
                setOpen(false);
                onCreate?.(q.trim());
              }}
              className={cn('flex w-full items-center gap-3 rounded-[12px] px-3 py-2 text-left text-[14px] font-semibold', cursor === items.length && 'bg-[var(--erp-row)]')}
            >
              <span className="flex size-6 items-center justify-center rounded-full bg-[var(--erp-accent)] text-[var(--erp-on-accent)]">
                <Plus size={13} strokeWidth={2.6} />
              </span>
              {createLabel} "{q.trim()}"
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------- ready-made */

interface PartyRow {
  id: string;
  name: string;
  code: string;
  email: string;
  currency: string;
  is_customer: boolean;
  is_supplier: boolean;
  receivable: number;
  payable: number;
}

export function partyOption(p: { id: string; name: string; code?: string | undefined; email?: string | undefined }): Option {
  return { id: p.id, label: p.name, sub: [p.code, p.email].filter((x) => x !== undefined && x !== '').join(' · '), icon: Building2, value: p.id };
}

export function searchParties(role: 'customer' | 'supplier' | '' = ''): (q: string) => Promise<Option[]> {
  return async (q) => {
    const r = await op<{ parties: PartyRow[] }>('parties.list', { q, role: role === '' ? undefined : role, limit: 30 }, { quiet: true });
    return r.parties.map((p) => ({ ...partyOption(p), data: p }));
  };
}

export function PartyPicker(props: { value: Option | null; onChange: (o: Option | null) => void; role?: 'customer' | 'supplier' | '' | undefined; placeholder?: string | undefined; onCreate?: ((name: string) => void) | undefined; disabled?: boolean | undefined; clearable?: boolean | undefined; className?: string | undefined }): React.JSX.Element {
  const role = props.role ?? '';
  const search = useMemo(() => searchParties(role), [role]);
  return (
    <Picker
      value={props.value}
      onChange={props.onChange}
      search={search}
      icon={Building2}
      placeholder={props.placeholder ?? (role === 'supplier' ? 'Choose a supplier' : role === 'customer' ? 'Choose a customer' : 'Choose a customer or supplier')}
      ariaLabel={role === 'supplier' ? 'Supplier' : role === 'customer' ? 'Customer' : 'Customer or supplier'}
      onCreate={props.onCreate}
      createLabel={role === 'supplier' ? 'New supplier' : 'New customer'}
      disabled={props.disabled}
      clearable={props.clearable}
      className={props.className}
    />
  );
}

interface ItemRow {
  id: string;
  name: string;
  sku: string;
  kind: string;
  unit: string;
  on_hand: number;
  sale_price: string;
  purchase_price: string;
  fractional: boolean;
}

export function itemOption(i: { id: string; name: string; sku: string; kind?: string | undefined; unit?: string | undefined; on_hand?: number | undefined }): Option {
  const stock = i.kind === 'stock' && i.on_hand !== undefined ? `${i.on_hand} ${i.unit ?? ''} on hand` : i.kind === 'service' ? 'Service' : '';
  return { id: i.id, label: i.name, sub: [i.sku, stock].filter((x) => x !== '').join(' · '), icon: Package, value: i.id };
}

export function searchItems(kind = ''): (q: string) => Promise<Option[]> {
  return async (q) => {
    const r = await op<{ items: ItemRow[] }>('items.list', { q, kind: kind === '' ? undefined : kind, limit: 30 }, { quiet: true });
    return r.items.map((i) => ({ ...itemOption(i), data: i }));
  };
}

export function ItemPicker(props: { value: Option | null; onChange: (o: Option | null) => void; kind?: string | undefined; placeholder?: string | undefined; onCreate?: ((name: string) => void) | undefined; size?: 'md' | 'cell' | undefined; disabled?: boolean | undefined; clearable?: boolean | undefined; className?: string | undefined }): React.JSX.Element {
  const kind = props.kind ?? '';
  const search = useMemo(() => searchItems(kind), [kind]);
  return (
    <Picker
      value={props.value}
      onChange={props.onChange}
      search={search}
      icon={Package}
      placeholder={props.placeholder ?? 'Choose an item'}
      ariaLabel="Item"
      onCreate={props.onCreate}
      createLabel="New item"
      size={props.size}
      disabled={props.disabled}
      clearable={props.clearable}
      className={props.className}
    />
  );
}

interface AccountRow {
  id: string;
  code: string;
  name: string;
  type: string;
  subtype: string;
  control: boolean;
  archived: boolean;
}

export function accountOption(a: { id: string; code: string; name: string; type?: string | undefined }): Option {
  return { id: a.id, label: `${a.code} ${a.name}`, sub: a.type !== undefined ? a.type[0]?.toUpperCase() + a.type.slice(1) : undefined, value: a.id };
}

export function searchAccounts(types: string[] = [], postable = false): (q: string) => Promise<Option[]> {
  return async (q) => {
    const r = await op<{ accounts: AccountRow[] }>('accounts.list', { q, balances: false }, { quiet: true });
    return r.accounts.filter((a) => (types.length === 0 || types.includes(a.type)) && (!postable || !a.control)).slice(0, 60).map((a) => ({ ...accountOption(a), data: a }));
  };
}

export function AccountPicker(props: { value: Option | null; onChange: (o: Option | null) => void; types?: string[] | undefined; postable?: boolean | undefined; placeholder?: string | undefined; size?: 'md' | 'cell' | undefined; disabled?: boolean | undefined; clearable?: boolean | undefined; className?: string | undefined }): React.JSX.Element {
  const key = (props.types ?? []).join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const search = useMemo(() => searchAccounts(props.types ?? [], props.postable ?? false), [key, props.postable]);
  return <Picker value={props.value} onChange={props.onChange} search={search} placeholder={props.placeholder ?? 'Choose an account'} ariaLabel="Account" size={props.size} disabled={props.disabled} clearable={props.clearable} className={props.className} />;
}

interface BankRow {
  id: string;
  name: string;
  kind: string;
  currency: string;
  balance: number;
  archived: boolean;
}

export function BankPicker(props: { value: Option | null; onChange: (o: Option | null) => void; currency?: string | undefined; placeholder?: string | undefined; disabled?: boolean | undefined; clearable?: boolean | undefined; className?: string | undefined }): React.JSX.Element {
  const cur = props.currency ?? '';
  const search = useMemo(
    () => async (q: string) => {
      const r = await op<{ banks: BankRow[] }>('banks.list', {}, { quiet: true });
      return r.banks
        .filter((b) => !b.archived && (cur === '' || b.currency === cur) && (q === '' || b.name.toLowerCase().includes(q.toLowerCase())))
        .map((b) => ({ id: b.id, label: b.name, sub: `${b.kind === 'cash' ? 'Cash' : b.kind === 'card' ? 'Card' : 'Bank'} · ${b.currency}`, icon: Landmark, value: b.id, data: b }));
    },
    [cur],
  );
  return <Picker value={props.value} onChange={props.onChange} search={search} icon={Landmark} placeholder={props.placeholder ?? 'Choose a bank account'} ariaLabel="Bank account" disabled={props.disabled} clearable={props.clearable} className={props.className} />;
}

interface EmployeeRow {
  id: string;
  name: string;
  number: string;
  job_title: string;
}

export function EmployeePicker(props: { value: Option | null; onChange: (o: Option | null) => void; placeholder?: string | undefined; disabled?: boolean | undefined; clearable?: boolean | undefined; className?: string | undefined; size?: 'md' | 'cell' | undefined }): React.JSX.Element {
  const search = useMemo(
    () => async (q: string) => {
      const r = await op<{ employees: EmployeeRow[] }>('employees.list', { q, limit: 30 }, { quiet: true });
      return r.employees.map((e) => ({ id: e.id, label: e.name, sub: [e.number, e.job_title].filter((x) => x !== '').join(' · '), icon: User, value: e.id, data: e }));
    },
    [],
  );
  return <Picker value={props.value} onChange={props.onChange} search={search} icon={User} placeholder={props.placeholder ?? 'Choose a person'} ariaLabel="Employee" disabled={props.disabled} clearable={props.clearable} className={props.className} size={props.size} />;
}

interface ProjectRow {
  id: string;
  name: string;
  code: string;
  customer: { name: string } | null;
}

export function ProjectPicker(props: { value: Option | null; onChange: (o: Option | null) => void; placeholder?: string | undefined; disabled?: boolean | undefined; clearable?: boolean | undefined; className?: string | undefined; size?: 'md' | 'cell' | undefined }): React.JSX.Element {
  const search = useMemo(
    () => async (q: string) => {
      const r = await op<{ projects: ProjectRow[] }>('projects.list', { q, limit: 30 }, { quiet: true });
      return r.projects.map((p) => ({ id: p.id, label: p.name, sub: [p.code, p.customer?.name ?? ''].filter((x) => x !== '').join(' · '), value: p.id, data: p }));
    },
    [],
  );
  return <Picker value={props.value} onChange={props.onChange} search={search} placeholder={props.placeholder ?? 'Choose a project'} ariaLabel="Project" disabled={props.disabled} clearable={props.clearable ?? true} className={props.className} size={props.size} />;
}

interface WarehouseRow {
  id: string;
  name: string;
  code: string;
  archived: boolean;
}

export function WarehousePicker(props: { value: Option | null; onChange: (o: Option | null) => void; placeholder?: string | undefined; disabled?: boolean | undefined; clearable?: boolean | undefined; className?: string | undefined; size?: 'md' | 'cell' | undefined }): React.JSX.Element {
  const search = useMemo(
    () => async (q: string) => {
      const r = await op<{ warehouses: WarehouseRow[] }>('warehouses.list', {}, { quiet: true });
      return r.warehouses
        .filter((w) => !w.archived && (q === '' || `${w.code} ${w.name}`.toLowerCase().includes(q.toLowerCase())))
        .map((w) => ({ id: w.id, label: w.name, sub: w.code, value: w.id, data: w }));
    },
    [],
  );
  return <Picker value={props.value} onChange={props.onChange} search={search} placeholder={props.placeholder ?? 'Choose a warehouse'} ariaLabel="Warehouse" disabled={props.disabled} clearable={props.clearable} className={props.className} size={props.size} />;
}

interface TaxRow {
  id: string;
  code: string;
  name: string;
  rate: string;
  scope: string;
  archived: boolean;
}

export function TaxPicker(props: { value: Option | null; onChange: (o: Option | null) => void; scope?: 'sales' | 'purchase' | undefined; disabled?: boolean | undefined; size?: 'md' | 'cell' | undefined; className?: string | undefined }): React.JSX.Element {
  const scope = props.scope;
  const search = useMemo(
    () => async (q: string) => {
      const r = await op<{ taxes: TaxRow[] }>('taxes.list', {}, { quiet: true });
      const rows = r.taxes
        .filter((t) => !t.archived && (scope === undefined || t.scope === 'both' || t.scope === scope) && (q === '' || `${t.code} ${t.name}`.toLowerCase().includes(q.toLowerCase())))
        .map((t) => ({ id: t.id, label: t.name, sub: t.code, right: `${t.rate}%`, value: t.code, data: t }));
      return [{ id: 'none', label: 'No tax', value: 'none' }, ...rows];
    },
    [scope],
  );
  return <Picker value={props.value} onChange={props.onChange} search={search} placeholder="Tax" ariaLabel="Tax" disabled={props.disabled} size={props.size} className={props.className} />;
}

interface MemberRow {
  id: string;
  name: string;
  email: string;
  status: string;
}

export function MemberPicker(props: { value: Option | null; onChange: (o: Option | null) => void; placeholder?: string | undefined; disabled?: boolean | undefined; clearable?: boolean | undefined; className?: string | undefined }): React.JSX.Element {
  const search = useMemo(
    () => async (q: string) => {
      const r = await op<{ members: MemberRow[] }>('members.list', { q, status: 'active', limit: 30 }, { quiet: true });
      return r.members.map((m) => ({ id: m.id, label: m.name, sub: m.email, icon: User, value: m.id, data: m }));
    },
    [],
  );
  return <Picker value={props.value} onChange={props.onChange} search={search} icon={User} placeholder={props.placeholder ?? 'Choose a teammate'} ariaLabel="Teammate" disabled={props.disabled} clearable={props.clearable} className={props.className} />;
}

/* --------------------------------------------------------------- dates */

/** A day as a pill that opens a calendar. Empty when `optional` and cleared. */
export function DateField({
  value,
  onChange,
  ariaLabel,
  optional = false,
  placeholder = 'Choose a day',
  min,
  max,
  size = 'md',
  disabled = false,
  align = 'left',
  className,
}: {
  value: string;
  onChange: (day: string) => void;
  ariaLabel: string;
  optional?: boolean | undefined;
  placeholder?: string | undefined;
  min?: string | undefined;
  max?: string | undefined;
  size?: 'md' | 'cell' | undefined;
  disabled?: boolean | undefined;
  align?: 'left' | 'right' | undefined;
  className?: string | undefined;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement | null>(null);
  return (
    <div className={cn('relative min-w-0', className)}>
      <button
        ref={btn}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        className={cn(size === 'cell' ? cellInput : softInput, 'flex items-center gap-2 text-left', size === 'cell' ? 'pr-2' : 'pr-3')}
      >
        <CalendarDays size={15} aria-hidden className="shrink-0 text-[var(--erp-ink-2)]" />
        <span className={cn('min-w-0 flex-1 truncate', value === '' && 'text-[var(--erp-muted)]')}>{value === '' ? placeholder : dayLabel(value)}</span>
        {optional && value !== '' && !disabled && (
          <span
            role="button"
            tabIndex={0}
            aria-label={`Clear ${ariaLabel}`}
            onClick={(e) => {
              e.stopPropagation();
              onChange('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.stopPropagation();
                onChange('');
              }
            }}
            className="flex size-6 shrink-0 items-center justify-center rounded-full hover:bg-[var(--erp-row-hover)]"
          >
            <X size={13} />
          </span>
        )}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} keep={btn} align={align}>
        <DayPicker
          value={value === '' ? today() : value}
          min={min}
          max={max}
          onPick={(d) => {
            onChange(d);
            setOpen(false);
          }}
        />
      </Popover>
    </div>
  );
}

/** A month (YYYY-MM) with previous and next. */
export function MonthField({ value, onChange, ariaLabel, max }: { value: string; onChange: (m: string) => void; ariaLabel: string; max?: string | undefined }): React.JSX.Element {
  return (
    <div className="inline-flex h-11 items-center gap-1 rounded-full bg-[var(--erp-card)] p-1" role="group" aria-label={ariaLabel}>
      <button type="button" aria-label="Previous month" onClick={() => onChange(shiftMonth(value, -1))} className="flex size-9 items-center justify-center rounded-full hover:bg-[var(--erp-row)]">
        <ChevronDown size={16} className="rotate-90" />
      </button>
      <span className="min-w-[8.5rem] text-center text-[14px] font-bold">{monthLabel(value)}</span>
      <button type="button" aria-label="Next month" disabled={max !== undefined && value >= max} onClick={() => onChange(shiftMonth(value, 1))} className="flex size-9 items-center justify-center rounded-full hover:bg-[var(--erp-row)] disabled:opacity-30">
        <ChevronDown size={16} className="-rotate-90" />
      </button>
    </div>
  );
}

function shiftMonth(m: string, n: number): string {
  const y = Number(m.slice(0, 4));
  const mm = Number(m.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(mm / 12);
  const r = ((mm % 12) + 12) % 12;
  return `${yy}-${String(r + 1).padStart(2, '0')}`;
}

/* ------------------------------------------------------------- numbers */

/**
 * A typed amount in `currency` (major units, "1234.50"). Shows the symbol in
 * front; accepts "1,234.5"; hands back the plain text, or '' when cleared.
 */
export function MoneyInput({
  value,
  onChange,
  currency,
  ariaLabel,
  size = 'md',
  allowNegative = false,
  disabled = false,
  placeholder = '0.00',
  className,
  autoFocus = false,
  decimals = 2,
}: {
  value: string;
  onChange: (v: string) => void;
  currency: string;
  ariaLabel: string;
  size?: 'md' | 'cell' | undefined;
  allowNegative?: boolean | undefined;
  disabled?: boolean | undefined;
  placeholder?: string | undefined;
  className?: string | undefined;
  autoFocus?: boolean | undefined;
  decimals?: number | undefined;
}): React.JSX.Element {
  const [text, setText] = useState(value);
  const [bad, setBad] = useState(false);
  useEffect(() => setText(value), [value]);
  const sym = symbolOf(currency);
  const commit = (t: string): void => {
    if (t.trim() === '') {
      setBad(false);
      onChange('');
      return;
    }
    const n = normalizeNumber(t, decimals, allowNegative);
    if (n === null) {
      setBad(true);
      return;
    }
    setBad(false);
    setText(n);
    onChange(n);
  };
  return (
    <label className={cn('relative block min-w-0', className)}>
      <span aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[13px] font-semibold text-[var(--erp-muted)]">
        {sym}
      </span>
      <input
        value={text}
        disabled={disabled}
        autoFocus={autoFocus}
        inputMode="decimal"
        aria-label={ariaLabel}
        aria-invalid={bad}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          setBad(false);
        }}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
        }}
        className={cn(size === 'cell' ? cellInput : softInput, 'num text-right', sym.length > 1 ? 'pl-12' : 'pl-8', bad && 'ring-2 ring-[var(--erp-red)]')}
      />
    </label>
  );
}

/** A typed plain number (quantity, hours, percent). */
export function NumberInput({
  value,
  onChange,
  ariaLabel,
  decimals = 3,
  size = 'md',
  suffix,
  disabled = false,
  allowNegative = false,
  placeholder = '0',
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  decimals?: number | undefined;
  size?: 'md' | 'cell' | undefined;
  suffix?: ReactNode | undefined;
  disabled?: boolean | undefined;
  allowNegative?: boolean | undefined;
  placeholder?: string | undefined;
  className?: string | undefined;
}): React.JSX.Element {
  const [text, setText] = useState(value);
  const [bad, setBad] = useState(false);
  useEffect(() => setText(value), [value]);
  const commit = (t: string): void => {
    if (t.trim() === '') {
      setBad(false);
      onChange('');
      return;
    }
    const n = normalizeNumber(t, decimals, allowNegative);
    if (n === null) {
      setBad(true);
      return;
    }
    setBad(false);
    setText(n);
    onChange(n);
  };
  return (
    <label className={cn('relative block min-w-0', className)}>
      <input
        value={text}
        disabled={disabled}
        inputMode="decimal"
        aria-label={ariaLabel}
        aria-invalid={bad}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          setBad(false);
        }}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
        }}
        className={cn(size === 'cell' ? cellInput : softInput, 'num text-right', suffix !== undefined && 'pr-12', bad && 'ring-2 ring-[var(--erp-red)]')}
      />
      {suffix !== undefined && <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[12px] font-semibold text-[var(--erp-muted)]">{suffix}</span>}
    </label>
  );
}
