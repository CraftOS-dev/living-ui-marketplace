/**
 * Shared pieces for the deal pages (agreements, rights explorer, product
 * approvals): the labels the foundation does not carry, small form fields
 * and typed readers for PocketBase expands.
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import type { RecordModel } from 'pocketbase';
import { cn, getPbClient } from '../../kit/index.ts';
import { d10, fmtDate } from '../lib/format.ts';
import { AGREEMENT_STATUS_TONE, DIRECTION_LABEL } from '../lib/labels.ts';
import type { Tone } from '../lib/labels.ts';
import type { AgreementRec, AvailabilityCell, DimSpec, DimensionRec, DimensionValueRec, GrantRec, RoyaltyReportRec } from '../lib/types.ts';
import { Field, Pill } from './ui.tsx';

export type AgreementStatus = AgreementRec['status'];

export const AGREEMENT_STATUSES: AgreementStatus[] = ['draft', 'negotiating', 'active', 'renewed', 'expired', 'terminated', 'superseded'];

export const AGREEMENT_STATUS_LABEL: Record<AgreementStatus, string> = {
  draft: 'Draft',
  negotiating: 'Negotiating',
  active: 'Active',
  renewed: 'Renewed',
  expired: 'Expired',
  terminated: 'Terminated',
  superseded: 'Superseded',
};

/** Statuses shown by default on the Agreements list. */
export const CURRENT_STATUSES: AgreementStatus[] = ['active', 'negotiating', 'draft'];

/** Statuses that end an agreement: open obligations still ahead are cancelled. */
export const ENDING_STATUSES: AgreementStatus[] = ['terminated', 'expired', 'superseded'];

export const EXCLUSIVITY_LABEL: Record<string, string> = {
  exclusive: 'Exclusive',
  non_exclusive: 'Non-exclusive',
  sole: 'Sole',
  mixed: 'Mixed',
};

export const REPORTING_LABEL: Record<string, string> = {
  none: 'No reporting',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  semiannual: 'Every six months',
  annual: 'Yearly',
};

export const GRANT_KIND_LABEL: Record<GrantRec['kind'], string> = {
  grant: 'Grant',
  holdback: 'Holdback',
  restriction: 'Restriction',
  reservation: 'Reservation',
};

export const GRANT_KIND_HELP: Record<GrantRec['kind'], string> = {
  grant: 'Rights licensed or acquired under this agreement.',
  holdback: 'A period in which we agreed not to exploit or license these rights ourselves.',
  restriction: 'Something we may not do with these rights, for example no sublicensing in a territory.',
  reservation: 'Rights the licensor kept for itself when we acquired the rest.',
};

export const ROYALTY_STATUS_LABEL: Record<RoyaltyReportRec['status'], string> = {
  expected: 'Expected',
  received: 'Received',
  paid: 'Paid',
  disputed: 'Disputed',
  waived: 'Waived',
};

export const ROYALTY_STATUS_TONE: Record<RoyaltyReportRec['status'], Tone> = {
  expected: 'neutral',
  received: 'info',
  paid: 'good',
  disputed: 'bad',
  waived: 'neutral',
};

export const AVAIL_LABEL: Record<AvailabilityCell['status'], string> = {
  available: 'Available',
  partial: 'Partial',
  unavailable: 'Unavailable',
  no_rights: 'No rights',
};

export const AVAIL_TONE: Record<AvailabilityCell['status'], Tone> = {
  available: 'good',
  partial: 'warn',
  unavailable: 'bad',
  no_rights: 'neutral',
};

export function availStatus(s: string): AvailabilityCell['status'] {
  return s === 'available' || s === 'partial' || s === 'unavailable' ? s : 'no_rights';
}

export function directionTone(direction: string): Tone {
  return direction === 'in' ? 'info' : direction === 'out' ? 'accent' : 'neutral';
}

export function DirectionPill({ direction }: { direction: string }): React.JSX.Element {
  return <Pill tone={directionTone(direction)}>{DIRECTION_LABEL[direction] ?? direction}</Pill>;
}

export function AgreementStatusPill({ status }: { status: string }): React.JSX.Element {
  return <Pill tone={AGREEMENT_STATUS_TONE[status] ?? 'neutral'}>{AGREEMENT_STATUS_LABEL[status as AgreementStatus] ?? status}</Pill>;
}

/** "12 Jan 2026 to 31 Dec 2027", "Perpetual from 12 Jan 2026". */
export function termText(a: Pick<AgreementRec, 'term_start' | 'term_end' | 'perpetual' | 'effective_date'>): string {
  const s = d10(a.term_start) || d10(a.effective_date);
  const e = d10(a.term_end);
  if (a.perpetual) return s !== '' ? `Perpetual from ${fmtDate(s)}` : 'Perpetual';
  if (s !== '' && e !== '') return `${fmtDate(s)} to ${fmtDate(e)}`;
  if (s !== '') return `From ${fmtDate(s)}, no end date set`;
  if (e !== '') return `Until ${fmtDate(e)}`;
  return '';
}

/**
 * The more recent of two copies of a record (by its updated stamp): the
 * realtime copy, or the one a save just returned. A save shows at once even
 * when the realtime event is slow or missed.
 */
export function newest<T extends RecordModel>(a: T | null, b: T | null): T | null {
  if (a === null) return b;
  if (b === null) return a;
  return String(b['updated'] ?? '') > String(a['updated'] ?? '') ? b : a;
}

/** A to-one expand, typed. */
export function expandOne<T>(r: RecordModel, key: string): T | null {
  const v: unknown = r.expand?.[key];
  return v !== null && v !== undefined && typeof v === 'object' && !Array.isArray(v) ? (v as T) : null;
}

/** A to-many expand, typed. */
export function expandMany<T>(r: RecordModel, key: string): T[] {
  const v: unknown = r.expand?.[key];
  return Array.isArray(v) ? (v as T[]) : [];
}

/** Number from a form string; empty or invalid is 0. */
export function num(s: string): number {
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** Form string for a stored number; 0 shows as empty. */
export function numStr(n: number | null | undefined): string {
  return n === null || n === undefined || n === 0 ? '' : String(n);
}

/** Enabled rights dimensions in their configured order. */
export function enabledDims(dimensions: DimensionRec[]): DimensionRec[] {
  return dimensions.filter((d) => d.enabled).slice().sort((a, b) => a.order - b.order);
}

/** Drop dimensions with nothing chosen (nothing chosen means all). */
export function cleanDims(dims: Record<string, DimSpec>): Record<string, DimSpec> {
  const out: Record<string, DimSpec> = {};
  for (const [k, v] of Object.entries(dims)) {
    const include = v.include ?? [];
    const exclude = v.exclude ?? [];
    if (include.length === 0 && exclude.length === 0) continue;
    out[k] = { include, exclude };
  }
  return out;
}

/**
 * Plain phrase for one dimension spec: top-level values read as "all"
 * (so "Worldwide excl. Japan" becomes "worldwide excl. Japan").
 * Returns '' when the spec covers everything.
 */
export function specPhrase(values: DimensionValueRec[], spec: DimSpec | undefined): { values: string; excluded: string } {
  const lab = (c: string): string => values.find((v) => v.code === c)?.label ?? c;
  const roots = new Set(values.filter((v) => v.parent_code === '').map((v) => v.code));
  const inc = (spec?.include ?? []).filter((c) => !roots.has(c)).map(lab);
  const exc = (spec?.exclude ?? []).map(lab);
  return { values: inc.join(', '), excluded: exc.join(', ') };
}

export const dateInputClass =
  'h-9 w-full border border-[var(--agent-app-border)] bg-[var(--agent-app-surface-2)] px-2 text-sm disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--agent-app-ring)]';

export function DateField({
  label,
  value,
  onChange,
  help,
  error,
  required = false,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (day: string) => void;
  help?: ReactNode | undefined;
  error?: string | undefined;
  required?: boolean | undefined;
  disabled?: boolean | undefined;
}): React.JSX.Element {
  const id = useId();
  return (
    <Field label={label} help={help} error={error} required={required} htmlFor={id}>
      <input
        id={id}
        type="date"
        className={cn(dateInputClass, error !== undefined && error !== '' && 'border-red-500')}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  help,
  error,
  suffix,
  min = 0,
  step,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  help?: ReactNode | undefined;
  error?: string | undefined;
  suffix?: string | undefined;
  min?: number | undefined;
  step?: number | string | undefined;
  placeholder?: string | undefined;
}): React.JSX.Element {
  const id = useId();
  return (
    <Field label={label} help={help} error={error} htmlFor={id}>
      <div className="relative">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={min}
          step={step ?? 'any'}
          placeholder={placeholder}
          className={cn(dateInputClass, 'tabular-nums', suffix !== undefined && 'pr-12')}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {suffix !== undefined && (
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-[var(--agent-app-muted)]">{suffix}</span>
        )}
      </div>
    </Field>
  );
}

/** Small uppercase heading for a form section. */
export function FormSection({ title, help, children }: { title: string; help?: ReactNode | undefined; children: ReactNode }): React.JSX.Element {
  return (
    <section className="flex flex-col gap-3 border-t border-[var(--agent-app-border)] pt-4 first:border-t-0 first:pt-0">
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{title}</h3>
        {help !== undefined && <p className="mt-0.5 text-xs leading-relaxed text-[var(--agent-app-muted)]">{help}</p>}
      </div>
      {children}
    </section>
  );
}

/** "Grant", "royalty_due" style keys as readable words. */
export function humanKey(k: string): string {
  const s = k.replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Toolbar filter over a collection: like a record picker, but empty reads
 * as "All ..." (a filter that is off), not "None".
 */
export function RecordFilter<T extends RecordModel>({
  collection,
  value,
  onChange,
  labelOf,
  searchFields,
  filter,
  allLabel,
  ariaLabel,
}: {
  collection: string;
  value: string;
  onChange: (id: string) => void;
  labelOf: (r: T) => string;
  searchFields: readonly string[];
  filter?: string | undefined;
  allLabel: string;
  ariaLabel: string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [items, setItems] = useState<T[]>([]);
  const [current, setCurrent] = useState<T | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const fieldsKey = searchFields.join(',');

  useEffect(() => {
    if (value === '') {
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
    const t = setTimeout(() => {
      const parts: string[] = [];
      const q = term.trim();
      if (q !== '') {
        const esc = q.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        parts.push(`(${fieldsKey.split(',').map((f) => `${f} ~ "${esc}"`).join(' || ')})`);
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
      clearTimeout(t);
    };
  }, [open, term, collection, filter, fieldsKey]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent): void => {
      if (boxRef.current !== null && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const active = value !== '';
  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex h-9 w-full items-center justify-between gap-2 border px-3 text-left text-sm',
          active ? 'border-[var(--agent-app-accent)]/60 bg-[var(--agent-app-accent)]/5' : 'border-[var(--agent-app-border)] bg-[var(--agent-app-surface-2)]',
        )}
      >
        <span className={cn('truncate', !active && 'text-[var(--agent-app-text)]/80')}>{active ? (current !== null ? labelOf(current) : 'Loading...') : allLabel}</span>
        <span className="flex shrink-0 items-center gap-1">
          {active && (
            <span
              role="button"
              tabIndex={0}
              aria-label={`Clear ${ariaLabel.toLowerCase()}`}
              className="text-[var(--agent-app-muted)] hover:text-[var(--agent-app-text)]"
              onClick={(e) => {
                e.stopPropagation();
                onChange('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  onChange('');
                }
              }}
            >
              <X size={14} />
            </span>
          )}
          <ChevronDown size={14} className="text-[var(--agent-app-muted)]" />
        </span>
      </button>
      {open && (
        <div className="absolute left-0 top-10 z-40 w-full min-w-[16rem] border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] shadow-lg">
          <div className="flex items-center gap-2 border-b border-[var(--agent-app-border)] px-2">
            <Search size={13} className="text-[var(--agent-app-muted)]" aria-hidden />
            <input autoFocus aria-label={`Search ${ariaLabel.toLowerCase()}`} className="h-8 w-full bg-transparent text-sm outline-none" placeholder="Search..." value={term} onChange={(e) => setTerm(e.target.value)} />
          </div>
          <div className="max-h-64 overflow-y-auto">
            <button
              type="button"
              className={cn('block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-[var(--agent-app-border)]/30', !active && 'bg-[var(--agent-app-accent)]/10')}
              onClick={() => {
                onChange('');
                setOpen(false);
                setTerm('');
              }}
            >
              {allLabel}
            </button>
            {items.length === 0 ? (
              <div className="px-3 py-3 text-xs text-[var(--agent-app-muted)]">{term.trim() !== '' ? 'No matches' : 'Nothing to choose yet'}</div>
            ) : (
              items.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={cn('block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-[var(--agent-app-border)]/30', r.id === value && 'bg-[var(--agent-app-accent)]/10')}
                  onClick={() => {
                    onChange(r.id);
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
  );
}
