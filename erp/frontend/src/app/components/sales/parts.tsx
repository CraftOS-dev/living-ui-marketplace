/**
 * Small pieces the sales and purchasing screens share: status pills, the
 * words for each document type, links to parties and documents, a date range
 * filter, and the reference lists (taxes, payment terms, currencies) the
 * document editor reads.
 */
import { useMemo, useRef, useState } from 'react';
import { Building2, CalendarRange, Check, Users, X } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { addDays, shortDay, today } from '../../lib/dates.ts';
import { useLive } from '../../lib/live.ts';
import { can } from '../../lib/me.ts';
import { navigate } from '../../lib/router.ts';
import type { DocType } from '../../lib/router.ts';
import type { Me } from '../../lib/types.ts';
import type { CurrencyRow, TaxRow, TermsRow } from '../../lib/types/sales.ts';
import { DateField, Picker, searchParties } from '../pickers.tsx';
import { docSide, docStatus } from '../status.ts';
import { ActorPill, PillButton, Popover, StatusPill } from '../ui.tsx';

/* ---------------------------------------------------------------- words */

export const SHORT_TYPE: Record<DocType, string> = {
  quote: 'Quote',
  sales_order: 'Order',
  delivery: 'Delivery',
  invoice: 'Invoice',
  credit_note: 'Credit note',
  purchase_order: 'Purchase order',
  goods_receipt: 'Receipt',
  bill: 'Bill',
  supplier_credit: 'Credit',
};

/** "invoice" -> "invoice", "sales_order" -> "sales order" (inside sentences). */
export function lowerType(type: DocType): string {
  return type === 'goods_receipt' ? 'goods receipt' : type.replace(/_/g, ' ');
}

/** The party role a document type deals with. */
export function roleOf(type: DocType): 'customer' | 'supplier' {
  return docSide(type) === 'sales' ? 'customer' : 'supplier';
}

/** Types that post to the books (others are confirmed). */
export function postsOf(type: DocType): boolean {
  return type === 'delivery' || type === 'invoice' || type === 'credit_note' || type === 'goods_receipt' || type === 'bill' || type === 'supplier_credit';
}

/** Types whose lines carry prices. */
export function pricedOf(type: DocType): boolean {
  return type !== 'delivery';
}

/** Types whose lines carry tax. */
export function taxedOf(type: DocType): boolean {
  return type !== 'delivery' && type !== 'goods_receipt';
}

/** Money documents with a balance and a due date. */
export function moneyOf(type: DocType): boolean {
  return type === 'invoice' || type === 'credit_note' || type === 'bill' || type === 'supplier_credit';
}

/** Invoices and bills that move stock when their option is on. */
export function movesStockOption(type: DocType): boolean {
  return moneyOf(type);
}

/** May this person work on a document type at `need` (the server's rule: deliveries and receipts also count Inventory)? */
export function canDoc(me: Me, type: DocType, need: 'view' | 'edit' | 'full'): boolean {
  const mods: ('sales' | 'purchasing' | 'inventory')[] =
    type === 'delivery' ? ['sales', 'inventory'] : type === 'goods_receipt' ? ['purchasing', 'inventory'] : docSide(type) === 'sales' ? ['sales'] : ['purchasing'];
  return mods.some((m) => can(me, m, need));
}

/** May this person record a payment in or out? */
export function canPay(me: Me, side: 'sales' | 'purchase'): boolean {
  return can(me, 'banking', 'full') || can(me, side === 'sales' ? 'sales' : 'purchasing', 'full');
}

/* ----------------------------------------------------------------- pills */

export function DocStatusPill({ status, size = 'sm' }: { status: string; size?: 'sm' | 'md' | undefined }): React.JSX.Element {
  const s = docStatus(status);
  return (
    <StatusPill tone={s.tone} size={size}>
      {s.label}
    </StatusPill>
  );
}

/** "Your AI agent" on records it prepared; nothing otherwise. */
export function AgentMark({ actor }: { actor: string }): React.JSX.Element | null {
  return actor === 'agent' ? <ActorPill actor="agent" /> : null;
}

/* ------------------------------------------------------------------ links */

export function openParty(id: string, role?: 'customer' | 'supplier' | undefined): void {
  navigate('party', { id, role });
}

export function openDoc(id: string): void {
  navigate('doc', { id });
}

/** A party name that opens the party (stops the row click under it). */
export function PartyLink({ id, name, role, className }: { id: string; name: string; role?: 'customer' | 'supplier' | undefined; className?: string | undefined }): React.JSX.Element {
  if (id === '') return <span className={className}>{name}</span>;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        openParty(id, role);
      }}
      className={cn('min-w-0 truncate text-left font-semibold underline-offset-4 hover:underline', className)}
    >
      {name}
    </button>
  );
}

/* ------------------------------------------------------------- reference */

export interface RefData {
  taxes: TaxRow[];
  terms: TermsRow[];
  currencies: CurrencyRow[];
  base: string;
}

let refsCache: RefData | null = null;

/** Taxes, payment terms and currencies (live: changes in Settings show at once). */
export function useRefData(): RefData | null {
  const live = useLive(
    async () => {
      const [t, p, c] = await Promise.all([
        op<{ taxes: TaxRow[] }>('taxes.list', {}, { quiet: true }),
        op<{ terms: TermsRow[] }>('terms.list', {}, { quiet: true }),
        op<{ base: string; currencies: CurrencyRow[] }>('currencies.list', {}, { quiet: true }).catch(() => ({ base: '', currencies: [] as CurrencyRow[] })),
      ]);
      refsCache = { taxes: t.taxes, terms: p.terms, currencies: c.currencies, base: c.base };
      return refsCache;
    },
    ['taxes', 'payment_terms', 'currencies'],
    [],
  );
  return live.data ?? refsCache;
}

/** Company settings the documents read (name, address, tax number, footers, quote validity). */
export interface CompanySettings {
  company_name: string;
  legal_name: string;
  address: string;
  email: string;
  phone: string;
  tax_id: string;
  invoice_footer: string;
  quote_terms: string;
  quote_validity_days: number;
  prices_include_tax: boolean;
}

let settingsCache: CompanySettings | null = null;

/** The company settings, remembered between pages (and reloaded when Settings change). */
export function useCompanySettings(): CompanySettings | null {
  const live = useLive(
    () =>
      op<CompanySettings>('settings.get', {}, { quiet: true })
        .then((s) => {
          settingsCache = s;
          return s;
        })
        .catch(() => settingsCache),
    ['settings'],
    [],
  );
  return live.data ?? settingsCache;
}

/** "Oct 28", with the year when it is not this year ("Oct 28, 2025"). */
export function listDay(day: string): string {
  if (day === '') return '';
  return day.slice(0, 4) === today().slice(0, 4) ? shortDay(day) : `${shortDay(day)}, ${day.slice(0, 4)}`;
}

/** The due date payment terms give for a document date. */
export function dueFrom(date: string, terms: TermsRow | null | undefined): string {
  if (terms === null || terms === undefined || date === '') return date;
  if (terms.end_of_month) {
    const y = Number(date.slice(0, 4));
    const m = Number(date.slice(5, 7)); // next month, 1-based index of the month after
    const last = new Date(y, m + 1, 0);
    return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
  }
  return addDays(date, terms.days);
}

/* ----------------------------------------------------------------- aging */

/** The aging buckets in state colors: green not yet due, amber, then deepening red. */
export const AGING: { key: 'current' | 'd30' | 'd60' | 'd90' | 'over90'; label: string; short: string; fill: string; text: string }[] = [
  { key: 'current', label: 'Not due yet', short: 'Not due', fill: 'var(--erp-green)', text: 'var(--erp-on-green)' },
  { key: 'd30', label: '1 to 30 days late', short: '1-30', fill: 'var(--erp-amber)', text: 'var(--erp-on-amber)' },
  { key: 'd60', label: '31 to 60 days late', short: '31-60', fill: 'color-mix(in srgb, var(--erp-amber) 45%, var(--erp-red))', text: 'var(--erp-on-red)' },
  { key: 'd90', label: '61 to 90 days late', short: '61-90', fill: 'var(--erp-red)', text: 'var(--erp-on-red)' },
  { key: 'over90', label: 'Over 90 days late', short: '90+', fill: 'color-mix(in srgb, var(--erp-red) 70%, var(--erp-ink))', text: 'var(--erp-on-red)' },
];

/** Which bucket a number of days past due falls in. */
export function bucketOf(daysLate: number): 'current' | 'd30' | 'd60' | 'd90' | 'over90' {
  if (daysLate <= 0) return 'current';
  if (daysLate <= 30) return 'd30';
  if (daysLate <= 60) return 'd60';
  if (daysLate <= 90) return 'd90';
  return 'over90';
}

/* ----------------------------------------------------------- party filter */

/** A pill that filters a list to one party: "All customers", or the party's name with a clear button. */
export function PartyFilterButton({ role, id, name, onChange }: { role: 'customer' | 'supplier'; id: string; name: string; onChange: (id: string) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  const search = useMemo(() => searchParties(role), [role]);
  if (id !== '') {
    return (
      <span className="erp-on-ink inline-flex h-11 max-w-full items-center gap-1 rounded-full bg-[var(--erp-ink)] pl-4 pr-1 text-[14px] font-semibold text-[var(--erp-shell)]">
        <span className="min-w-0 truncate">{name !== '' ? name : role === 'customer' ? 'One customer' : 'One supplier'}</span>
        <button type="button" onClick={() => onChange('')} aria-label="Show every party" className="flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-[var(--erp-shell)]/15">
          <X size={14} aria-hidden />
        </button>
      </span>
    );
  }
  return (
    <div ref={box} className="relative">
      <PillButton variant="light" icon={role === 'customer' ? Users : Building2} onClick={() => setOpen((o) => !o)} aria-expanded={open} className="w-full @min-[480px]:w-auto">
        {role === 'customer' ? 'All customers' : 'All suppliers'}
      </PillButton>
      <Popover open={open} onClose={() => setOpen(false)} keep={box} align="right" className="w-[320px] max-w-[calc(100vw-32px)]">
        <div className="p-1">
          <Picker
            value={null}
            search={search}
            icon={role === 'customer' ? Users : Building2}
            placeholder={role === 'customer' ? 'Search customers' : 'Search suppliers'}
            ariaLabel={role === 'customer' ? 'Customer' : 'Supplier'}
            autoOpen
            onChange={(o) => {
              if (o !== null) {
                onChange(o.id);
                setOpen(false);
              }
            }}
          />
        </div>
      </Popover>
    </div>
  );
}

/* ------------------------------------------------------------ date range */

export interface Range {
  from: string;
  to: string;
}

function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

function monthEnd(day: string): string {
  const d = new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function presets(): { key: string; label: string; range: Range }[] {
  const t = today();
  const lastMonth = addDays(monthStart(t), -1);
  const q = Math.floor((Number(t.slice(5, 7)) - 1) / 3) * 3 + 1;
  const qStart = `${t.slice(0, 4)}-${String(q).padStart(2, '0')}-01`;
  return [
    { key: 'all', label: 'Any date', range: { from: '', to: '' } },
    { key: 'month', label: 'This month', range: { from: monthStart(t), to: monthEnd(t) } },
    { key: 'last', label: 'Last month', range: { from: monthStart(lastMonth), to: monthEnd(lastMonth) } },
    { key: 'quarter', label: 'This quarter', range: { from: qStart, to: t } },
    { key: '90', label: 'Last 90 days', range: { from: addDays(t, -89), to: t } },
    { key: 'year', label: 'This year', range: { from: `${t.slice(0, 4)}-01-01`, to: `${t.slice(0, 4)}-12-31` } },
  ];
}

export function rangeLabel(r: Range): string {
  if (r.from === '' && r.to === '') return 'Any date';
  const p = presets().find((x) => x.range.from === r.from && x.range.to === r.to);
  if (p !== undefined) return p.label;
  if (r.from !== '' && r.to !== '') return `${shortDay(r.from)} to ${shortDay(r.to)}`;
  if (r.from !== '') return `From ${shortDay(r.from)}`;
  return `Until ${shortDay(r.to)}`;
}

/** A pill that opens date presets and a custom from and to. */
export function DateRangeButton({ value, onChange, onCard = false }: { value: Range; onChange: (r: Range) => void; onCard?: boolean | undefined }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLDivElement | null>(null);
  const set = value.from !== '' || value.to !== '';
  return (
    <div ref={btn} className="relative">
      <PillButton variant={set ? 'dark' : onCard ? 'soft' : 'light'} icon={CalendarRange} onClick={() => setOpen((o) => !o)} aria-expanded={open} className="w-full @min-[480px]:w-auto">
        {rangeLabel(value)}
      </PillButton>
      <Popover open={open} onClose={() => setOpen(false)} keep={btn} align="right" className="w-[300px] max-w-[calc(100vw-32px)]">
        <div role="menu" className="flex flex-col">
          {presets().map((p) => {
            const on = p.range.from === value.from && p.range.to === value.to;
            return (
              <button
                key={p.key}
                type="button"
                role="menuitemradio"
                aria-checked={on}
                onClick={() => {
                  onChange(p.range);
                  setOpen(false);
                }}
                className={cn('flex items-center gap-3 rounded-[14px] px-3 py-2.5 text-left text-[14px] font-semibold hover:bg-[var(--erp-row)]', on && 'bg-[var(--erp-row)]')}
              >
                <span className="flex-1">{p.label}</span>
                {on && <Check size={15} aria-hidden />}
              </button>
            );
          })}
          <div className="mt-2 grid grid-cols-2 gap-2 border-t border-[var(--erp-line)] px-1 pt-3">
            <DateField value={value.from} onChange={(d) => onChange({ from: d, to: value.to })} ariaLabel="From" placeholder="From" optional size="cell" />
            <DateField value={value.to} onChange={(d) => onChange({ from: value.from, to: d })} ariaLabel="To" placeholder="To" optional size="cell" align="right" />
          </div>
        </div>
      </Popover>
    </div>
  );
}
