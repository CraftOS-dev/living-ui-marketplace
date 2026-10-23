/**
 * The header of a document being written: dates, payment terms, reference
 * and notes (always in view), and the advanced options one step away
 * (currency and rate, prices with tax, warehouse, stock, project,
 * department). Shared by the new-document flow and a draft's page.
 */
import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { addDays, dayPhrase } from '../../lib/dates.ts';
import { useLive } from '../../lib/live.ts';
import type { DocType } from '../../lib/router.ts';
import type { DocDetail, TermsRow } from '../../lib/types/sales.ts';
import { DateField, NumberInput, ProjectPicker, WarehousePicker } from '../pickers.tsx';
import type { Option } from '../pickers.tsx';
import { Field, PillSelect, Toggle, softArea, softInput } from '../ui.tsx';
import { dueFrom, moneyOf } from './parts.tsx';
import type { RefData } from './parts.tsx';

export interface DocHead {
  date: string;
  /** Set by the person; '' follows the payment terms. */
  due_date: string;
  valid_until: string;
  expected_date: string;
  /** Payment terms id; '' is the party's (or the company's). */
  terms: string;
  reference: string;
  notes: string;
  internal_note: string;
  /** '' is the party's currency (or the base). */
  currency: string;
  fx_rate: string;
  prices_include_tax: boolean;
  warehouse: Option | null;
  moves_stock: boolean;
  project: Option | null;
  department: string;
}

export function blankHead(date: string, inclusive: boolean): DocHead {
  return { date, due_date: '', valid_until: '', expected_date: '', terms: '', reference: '', notes: '', internal_note: '', currency: '', fx_rate: '', prices_include_tax: inclusive, warehouse: null, moves_stock: true, project: null, department: '' };
}

export function headFromDoc(d: DocDetail): DocHead {
  return {
    date: d.date,
    due_date: d.due_date,
    valid_until: d.valid_until,
    expected_date: d.expected_date,
    terms: d.terms?.id ?? '',
    reference: d.reference,
    notes: d.notes,
    internal_note: d.internal_note,
    currency: d.currency,
    fx_rate: d.fx_rate,
    prices_include_tax: d.prices_include_tax,
    warehouse: d.warehouse !== null ? { id: d.warehouse.id, label: d.warehouse.name, sub: d.warehouse.code, value: d.warehouse.id } : null,
    moves_stock: d.moves_stock,
    project: d.project !== null ? { id: d.project.id, label: d.project.name, sub: d.project.code, value: d.project.id } : null,
    department: d.department?.id ?? '',
  };
}

/** Which header fields a type has. */
export function fieldsOf(type: DocType): { due: boolean; valid: boolean; expected: boolean; terms: boolean; warehouse: boolean } {
  const order = type === 'sales_order' || type === 'purchase_order';
  return {
    due: moneyOf(type),
    valid: type === 'quote',
    expected: order,
    terms: moneyOf(type) || order,
    warehouse: type !== 'quote',
  };
}

/** The terms a document follows: its own, else the party's (or the company's). */
export function termsOf(head: DocHead, refs: RefData | null, fallback: TermsRow | null): TermsRow | null {
  if (head.terms !== '') return refs?.terms.find((t) => t.id === head.terms) ?? null;
  return fallback;
}

/** The header as operation params: everything set for a new document, only what changed for a saved one. */
export function headParams(type: DocType, head: DocHead, base: string, initial: DocHead | null): Record<string, string | boolean> {
  const f = fieldsOf(type);
  const all: Record<string, string | boolean> = {
    date: head.date,
    reference: head.reference.trim(),
    notes: head.notes.trim(),
    internal_note: head.internal_note.trim(),
    prices_include_tax: head.prices_include_tax,
    project: head.project?.id ?? '',
    department: head.department,
  };
  if (f.due) all['due_date'] = head.due_date;
  if (f.valid) all['valid_until'] = head.valid_until;
  if (f.expected) all['expected_date'] = head.expected_date;
  if (f.terms) all['terms'] = head.terms;
  if (f.warehouse) all['warehouse'] = head.warehouse?.id ?? '';
  if (moneyOf(type)) all['moves_stock'] = head.moves_stock;
  if (head.currency !== '') {
    all['currency'] = head.currency;
    if (head.currency !== base && head.fx_rate.trim() !== '') all['fx_rate'] = head.fx_rate.trim();
  }
  if (initial === null) {
    // A new document: leave empty fields to the server's defaults.
    const out: Record<string, string | boolean> = {};
    for (const [k, v] of Object.entries(all)) if (v !== '') out[k] = v;
    return out;
  }
  const before = headParams(type, initial, base, null);
  const out: Record<string, string | boolean> = {};
  for (const [k, v] of Object.entries(all)) {
    const was = before[k] ?? '';
    if (v !== was) out[k] = v;
  }
  // A changed currency always takes its rate along.
  if (out['currency'] !== undefined && all['fx_rate'] !== undefined) out['fx_rate'] = all['fx_rate'];
  return out;
}

const REF_LABEL: Partial<Record<DocType, string>> = {
  quote: 'Customer reference',
  sales_order: 'Customer PO number',
  invoice: 'Customer PO number',
  credit_note: 'Customer reference',
  delivery: 'Customer reference',
  purchase_order: 'Supplier reference',
  goods_receipt: 'Delivery note number',
  bill: 'Supplier invoice number',
  supplier_credit: 'Supplier credit number',
};

/** Dates, terms, reference and notes. */
export function HeadFields({
  type,
  head,
  setHead,
  refs,
  partyTerms,
  validityDays,
  disabled = false,
}: {
  type: DocType;
  head: DocHead;
  setHead: Dispatch<SetStateAction<DocHead>>;
  refs: RefData | null;
  partyTerms: TermsRow | null;
  validityDays: number;
  disabled?: boolean | undefined;
}): React.JSX.Element {
  const f = fieldsOf(type);
  const terms = termsOf(head, refs, partyTerms);
  const autoDue = dueFrom(head.date, terms);
  const autoValid = head.date !== '' ? addDays(head.date, validityDays) : '';
  const set = (patch: Partial<DocHead>): void => setHead((h) => ({ ...h, ...patch }));
  return (
    <div className="grid grid-cols-1 gap-4 @min-[480px]:grid-cols-2">
      <Field label="Date">
        <DateField value={head.date} onChange={(d) => set({ date: d })} ariaLabel="Date" disabled={disabled} />
      </Field>
      {f.due && (
        <Field label="Due date" hint={head.due_date === '' && terms !== null ? `${terms.name} from the date` : undefined}>
          <DateField value={head.due_date !== '' ? head.due_date : autoDue} onChange={(d) => set({ due_date: d })} ariaLabel="Due date" min={head.date} disabled={disabled} />
        </Field>
      )}
      {f.valid && (
        <Field label="Valid until">
          <DateField value={head.valid_until !== '' ? head.valid_until : autoValid} onChange={(d) => set({ valid_until: d })} ariaLabel="Valid until" min={head.date} disabled={disabled} />
        </Field>
      )}
      {f.expected && (
        <Field label={type === 'sales_order' ? 'Delivery expected' : 'Arrival expected'} optional>
          <DateField value={head.expected_date} onChange={(d) => set({ expected_date: d })} ariaLabel="Expected" optional placeholder="Not set" min={head.date} disabled={disabled} />
        </Field>
      )}
      {f.terms && (
        <PillSelect
          soft
          label="Payment terms"
          value={head.terms}
          disabled={disabled}
          onChange={(v) => set({ terms: v, due_date: '' })}
          options={[{ value: '', label: partyTerms !== null ? `${partyTerms.name} (their usual)` : 'Company default' }, ...(refs?.terms ?? []).map((t) => ({ value: t.id, label: t.name }))]}
        />
      )}
      <Field label={REF_LABEL[type] ?? 'Reference'} optional>
        <input value={head.reference} onChange={(e) => set({ reference: e.target.value })} maxLength={120} aria-label={REF_LABEL[type] ?? 'Reference'} className={softInput} disabled={disabled} />
      </Field>
      <Field label={type === 'purchase_order' || type === 'bill' || type === 'supplier_credit' || type === 'goods_receipt' ? 'Notes for the supplier' : 'Notes for the customer'} optional className="@min-[480px]:col-span-2" hint="Printed on the document">
        <textarea value={head.notes} onChange={(e) => set({ notes: e.target.value })} maxLength={4000} rows={2} aria-label="Notes on the document" className={cn(softArea, 'min-h-[64px]')} disabled={disabled} />
      </Field>
      <Field label="Internal note" optional className="@min-[480px]:col-span-2" hint="Only your team sees this">
        <textarea value={head.internal_note} onChange={(e) => set({ internal_note: e.target.value })} maxLength={4000} rows={2} aria-label="Internal note" className={cn(softArea, 'min-h-[64px]')} disabled={disabled} />
      </Field>
      {head.due_date !== '' && head.due_date !== autoDue && f.due && !disabled && (
        <button type="button" onClick={() => set({ due_date: '' })} className="justify-self-start text-[12px] font-semibold text-[var(--erp-ink-2)] underline-offset-4 hover:underline @min-[480px]:col-span-2">
          Due {dayPhrase(autoDue)} by the terms instead
        </button>
      )}
    </div>
  );
}

interface Department {
  id: string;
  name: string;
  archived: boolean;
}

/** The advanced options behind a toggle. `open` also shows each line's description and account. */
export function MoreOptions({
  type,
  head,
  setHead,
  refs,
  partyCurrency,
  open,
  onToggle,
  disabled = false,
}: {
  type: DocType;
  head: DocHead;
  setHead: Dispatch<SetStateAction<DocHead>>;
  refs: RefData | null;
  partyCurrency: string;
  open: boolean;
  onToggle: () => void;
  disabled?: boolean | undefined;
}): React.JSX.Element {
  const [deptsWanted, setDeptsWanted] = useState(false);
  const depts = useLive(
    () => (open || deptsWanted ? op<{ departments: Department[] }>('departments.list', {}, { quiet: true }).catch(() => ({ departments: [] as Department[] })) : Promise.resolve({ departments: [] as Department[] })),
    ['departments'],
    [open || deptsWanted],
  );
  const f = fieldsOf(type);
  const base = refs?.base ?? '';
  const cur = head.currency !== '' ? head.currency : partyCurrency !== '' ? partyCurrency : base;
  const set = (patch: Partial<DocHead>): void => setHead((h) => ({ ...h, ...patch }));
  const rateOf = (code: string): string => refs?.currencies.find((c) => c.code === code)?.rate ?? '';
  const currencies = (refs?.currencies ?? []).filter((c) => !c.archived || c.code === cur);
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setDeptsWanted(true);
          onToggle();
        }}
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-full px-1 py-1 text-[13px] font-semibold text-[var(--erp-ink-2)] hover:text-[var(--erp-ink)]"
      >
        <SlidersHorizontal size={14} aria-hidden />
        More options
        <span className="hidden font-medium text-[var(--erp-muted)] @min-[480px]:inline">currency, tax, stock, project, accounts</span>
        <ChevronDown size={14} aria-hidden className={cn('transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="erp-pop mt-4 grid grid-cols-1 gap-4 @min-[480px]:grid-cols-2">
          <PillSelect
            soft
            label="Currency"
            value={cur}
            disabled={disabled}
            onChange={(v) => set({ currency: v, fx_rate: v === base ? '' : rateOf(v) })}
            options={(currencies.length > 0 ? currencies.map((c) => c.code) : [cur]).map((c) => ({ value: c, label: c === base ? `${c} (base)` : c }))}
          />
          {cur !== base && cur !== '' ? (
            <Field label={`Rate: ${base} for one ${cur}`} hint="From Settings, Currencies, unless you change it">
              <NumberInput value={head.fx_rate !== '' ? head.fx_rate : rateOf(cur)} onChange={(v) => set({ fx_rate: v, currency: cur })} ariaLabel="Exchange rate" decimals={8} disabled={disabled} />
            </Field>
          ) : (
            <span className="hidden @min-[480px]:block" />
          )}
          <div className="flex items-center justify-between gap-4 rounded-[18px] bg-[var(--erp-row)] px-4 py-3">
            <span className="min-w-0">
              <span className="block text-[14px] font-semibold">Prices include tax</span>
              <span className="block text-[12px] text-[var(--erp-muted)]">Tax is worked out of the unit prices</span>
            </span>
            <Toggle checked={head.prices_include_tax} onChange={(v) => set({ prices_include_tax: v })} label="Prices include tax" disabled={disabled} />
          </div>
          {moneyOf(type) && (
            <div className="flex items-center justify-between gap-4 rounded-[18px] bg-[var(--erp-row)] px-4 py-3">
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold">{type === 'invoice' || type === 'supplier_credit' ? 'Stock goes out' : 'Stock comes in'}</span>
                <span className="block text-[12px] text-[var(--erp-muted)]">{type === 'invoice' ? 'Off when a delivery already sent it' : type === 'bill' ? 'Off when a goods receipt already took it in' : 'Off for a price allowance only'}</span>
              </span>
              <Toggle checked={head.moves_stock} onChange={(v) => set({ moves_stock: v })} label="Moves stock" disabled={disabled} />
            </div>
          )}
          {f.warehouse && (
            <Field label="Warehouse">
              <WarehousePicker value={head.warehouse} onChange={(o) => set({ warehouse: o })} placeholder="The default warehouse" clearable disabled={disabled} />
            </Field>
          )}
          <Field label="Project" optional>
            <ProjectPicker value={head.project} onChange={(o) => set({ project: o })} disabled={disabled} />
          </Field>
          <PillSelect
            soft
            label="Department"
            value={head.department}
            disabled={disabled}
            onChange={(v) => set({ department: v })}
            options={[{ value: '', label: 'None' }, ...(depts.data?.departments ?? []).filter((d) => !d.archived || d.id === head.department).map((d) => ({ value: d.id, label: d.name }))]}
          />
        </div>
      )}
    </div>
  );
}
