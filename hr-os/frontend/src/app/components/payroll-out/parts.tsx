/**
 * Small parts shared by the payroll-out pages: status dots for filings,
 * runs, bank files and packs, the due day in words, an entity chooser for
 * pages that need one entity, and a quiet bar chart drawn from data.
 */
import { ChevronRight } from 'lucide-react';
import { useMemo } from 'react';
import { EntityPicker, Money, StatusDot, Tag } from '../ui.tsx';
import type { Tone } from '../ui.tsx';
import { useMe } from '../../lib/auth.tsx';
import { fmtDay, fmtRange, monthName } from '../../lib/format.ts';
import { exponent } from '../../lib/money.ts';
import { t, tn } from '../../lib/i18n.ts';
import { useUi } from '../../lib/store.tsx';

export const FILING_TONE: Record<string, Tone> = { todo: 'neutral', prepared: 'lh', submitted: 'rh', accepted: 'good', rejected: 'bad', not_needed: 'faint', amend: 'warn' };
export const RUN_TONE: Record<string, Tone> = { locked: 'rh', paid: 'good', void: 'faint', approved: 'lh', calculated: 'neutral', draft: 'faint' };
export const FILE_TONE: Record<string, Tone> = { exported: 'lh', uploaded: 'good', superseded: 'faint', void: 'faint' };
export const PACK_TONE: Record<string, Tone> = { active: 'good', tested: 'lh', draft: 'warn', retired: 'faint' };

export function FilingStatus({ status }: { status: string }): React.JSX.Element {
  return <StatusDot tone={FILING_TONE[status] ?? 'neutral'} label={t('po.filing.status.' + status)} />;
}

export function RunStatus({ status }: { status: string }): React.JSX.Element {
  return <StatusDot tone={RUN_TONE[status] ?? 'neutral'} label={t('po.run.status.' + status)} />;
}

export function FileStatus({ status }: { status: string }): React.JSX.Element {
  return <StatusDot tone={FILE_TONE[status] ?? 'neutral'} label={t('po.file.status.' + status)} />;
}

export function PackStatus({ status }: { status: string }): React.JSX.Element {
  return <StatusDot tone={PACK_TONE[status] ?? 'neutral'} label={t('po.pack.status.' + status)} />;
}

/** "in 3 days", "today", "5 days late" (red), or "set a due day" when the rule has none. */
export function DueText({ day, daysLeft, open }: { day: string; daysLeft: number | null; open: boolean }): React.JSX.Element {
  if (day === '') return <span className="text-[var(--hr-warn)]">{t('po.due.none')}</span>;
  const when = fmtDay(day, { year: 'auto' });
  if (!open || daysLeft === null) return <span className="hr-mono hr-num text-[var(--hr-muted)]">{when}</span>;
  if (daysLeft < 0)
    return (
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="hr-mono hr-num">{when}</span>
        <span className="text-[12px] text-[var(--hr-bad)]">{tn('po.due.late', -daysLeft)}</span>
      </span>
    );
  return (
    <span className="flex min-w-0 flex-col leading-tight">
      <span className="hr-mono hr-num">{when}</span>
      <span className={`text-[12px] ${daysLeft <= 7 ? 'text-[var(--hr-warn)]' : 'text-[var(--hr-muted)]'}`}>{daysLeft === 0 ? t('po.due.today') : tn('po.due.in', daysLeft)}</span>
    </span>
  );
}

/** The official layout or "check with your bank". */
export function FormatTag({ official }: { official: boolean }): React.JSX.Element {
  return <Tag tone={official ? 'good' : 'warn'}>{official ? t('po.format.official') : t('po.format.check_bank')}</Tag>;
}

/** The entity a page works on: the shell's chosen entity, else the one picked here. */
export function useEntity(picked: string): { id: string; name: string; currency: string; country: string } | null {
  const me = useMe();
  const { entity } = useUi();
  return useMemo(() => {
    const id = picked !== '' ? picked : entity !== '' ? entity : me.entities[0]?.id ?? '';
    const e = me.entities.find((x) => x.id === id) ?? me.entities[0];
    return e ? { id: e.id, name: e.name, currency: e.currency, country: e.country } : null;
  }, [picked, entity, me.entities]);
}

/** A panel's aside link, as every module draws it: mono caps, no underline, ink on hover, a 40 px touch area. */
export function AsideLink({ href, children }: { href: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <a href={href} className="hr-focus hr-label hit inline-flex h-6 shrink-0 items-center gap-0.5 rounded-[3px] hover:!text-[var(--hr-ink)]">
      {children}
      <ChevronRight size={12} strokeWidth={2} aria-hidden />
    </a>
  );
}

export function EntityChooser({ value, onChange }: { value: string; onChange: (id: string) => void }): React.JSX.Element | null {
  const me = useMe();
  if (me.entities.length <= 1) return null;
  return <EntityPicker value={value} onChange={onChange} label={t('po.entity')} className="h-10 w-[240px] max-w-full md:h-8" />;
}

/**
 * A quiet bar chart: one series in the primary colour, mono labels, the
 * value on hover. Values are minor units of one currency.
 */
export function Bars({ data, currency, height = 120, label }: { data: { key: string; label: string; value: number }[]; currency: string; height?: number; label: string }): React.JSX.Element | null {
  if (data.length === 0) return null;
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div role="img" aria-label={label} className="min-w-0">
      <div className="flex items-end gap-1.5" style={{ height }}>
        {data.map((d) => (
          <div key={d.key} className="group flex min-w-0 flex-1 flex-col items-center justify-end" style={{ height }}>
            <Money minor={d.value} currency={currency} format={{ compact: true }} className="mb-1 hidden text-[12px] text-[var(--hr-muted)] group-hover:block" />
            <div className="w-full max-w-[48px] rounded-t-[3px] bg-[var(--hr-rh)] opacity-80 transition-opacity duration-150 group-hover:opacity-100" style={{ height: Math.max(2, Math.round((d.value / max) * (height - 18))) }} />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {data.map((d) => (
          <span key={d.key} className="hr-label min-w-0 flex-1 truncate text-center">
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** A filing period in words: "October 2026" for calendar months, the run number for per pay date rows, else the dates. */
export function periodLabel(f: { frequency: string; period: string; period_start: string; period_end: string }): string {
  if (f.frequency === 'per_pay_date' || f.frequency === 'per_bonus' || f.frequency === 'annual') return f.period;
  const s = f.period_start;
  const e = f.period_end;
  const calendarMonth = f.frequency === 'monthly' && s.slice(8, 10) === '01' && s.slice(0, 7) === e.slice(0, 7);
  if (calendarMonth) return monthName(Number(s.slice(5, 7))) + ' ' + s.slice(0, 4);
  return fmtRange(s, e);
}

/** "Jan 1 to Nov 4, 2026": a range of days with its year. */
export function rangeWithYear(from: string, to: string): string {
  if (from.slice(0, 4) === to.slice(0, 4)) return t('format.range', { from: fmtDay(from, { year: 'never' }), to: fmtDay(to, { year: 'always' }) });
  return t('format.range', { from: fmtDay(from, { year: 'always' }), to: fmtDay(to, { year: 'always' }) });
}

/** Rows of a table as CSV text (major units for money columns already formatted by the caller). */
export function csvOf(rows: (string | number)[][]): string {
  const cell = (v: string | number): string => {
    let s = String(v);
    if (/^[=+\-@]/.test(s) && !/^-?\d/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** Minor units as a plain major-unit number text for CSV ("1234.50"). */
export function majorText(minor: number, currency: string): string {
  const e = exponent(currency === '' ? 'USD' : currency);
  const neg = minor < 0;
  const s = String(Math.abs(Math.trunc(minor))).padStart(e + 1, '0');
  return (neg ? '-' : '') + (e === 0 ? s : s.slice(0, -e) + '.' + s.slice(-e));
}
