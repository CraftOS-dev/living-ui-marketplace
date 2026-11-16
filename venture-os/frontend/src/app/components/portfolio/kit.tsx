/**
 * Small portfolio parts built on the kernel's components (never forks):
 * value text per metric unit, the runway meter, the reporting dot, a
 * multi-select chip row, and a source snippet with its quote marked.
 */
import { cn } from '../../../kit/index.ts';
import { StatusDot } from '../ui.tsx';
import type { Tone } from '../ui.tsx';
import { Meter } from '../charts.tsx';
import { compact, money, months, num, pct, toMajor } from '../../lib/format.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'Oct' from '2026-10-31'. */
export function monthShort(day: string): string {
  return day.length >= 7 ? (MONTHS[Number(day.slice(5, 7)) - 1] ?? '') : '';
}

/** A short period label for chart axes and rows: 'Oct', 'Jan 26' (January carries the year), 'Q3 26', 'FY 2026'. */
export function periodShort(day: string, monthsCovered = 1): string {
  if (day.length < 7) return '';
  const y = day.slice(2, 4);
  if (monthsCovered === 3) return 'Q' + Math.ceil(Number(day.slice(5, 7)) / 3) + ' ' + y;
  if (monthsCovered === 12) return 'FY ' + day.slice(0, 4);
  const m = monthShort(day);
  return day.slice(5, 7) === '01' ? m + ' ' + y : m;
}

/** 'Oct 2026'. */
export function periodLong(day: string): string {
  return day.length >= 7 ? monthShort(day) + ' ' + day.slice(0, 4) : '';
}

/** A stored KPI value as people read it (money compact, percent, count). */
export function valueText(unit: string, value: number | null | undefined, currency: string): string {
  if (value === null || value === undefined) return '';
  if (unit === 'money') return money(value, currency, { compact: true });
  if (unit === 'percent') return pct(value, 1);
  if (unit === 'months') return months(value);
  return num(value);
}

/** A stored value as a chart number (major units for money, percent for ppm). */
export function chartValue(unit: string, value: number | null | undefined, currency: string): number | null {
  if (value === null || value === undefined) return null;
  if (unit === 'money') return toMajor(value, currency || 'USD');
  if (unit === 'percent') return value / 10000;
  return value;
}

/** Tooltip formatter for a chart of a unit. */
export function chartFormat(unit: string, currency: string): (v: number) => string {
  if (unit === 'money') return (v) => (currency !== '' ? currency + ' ' : '') + compact(v);
  if (unit === 'percent') return (v) => num(v, 1) + '%';
  return (v) => num(v);
}

/** Runway as a bar with the threshold mark (months; unknown is "Unknown", never 0). */
export function RunwayMeter({ value, mark = 6, className }: { value: number | null; mark?: number | undefined; className?: string | undefined }): React.JSX.Element {
  const tone = value === null ? 'ink' : value < mark ? 'bad' : value < mark * 2 ? 'warn' : 'ink';
  return <Meter value={value} max={24} tone={tone} marks={[{ value: mark, label: mark + ' months', tone: 'bad' }]} format={(v) => (v >= 24 ? '24+ mo' : months(v))} label={undefined} className={className} />;
}

const REPORT: Record<string, { tone: Tone; label: string }> = {
  none: { tone: 'faint', label: 'None' },
  requested: { tone: 'neutral', label: 'Requested' },
  received: { tone: 'a', label: 'Received' },
  staged: { tone: 'warn', label: 'Staged' },
  verified: { tone: 'good', label: 'Verified' },
  dismissed: { tone: 'faint', label: 'None' },
};

/** The reporting state of a company as a dot with its word. */
export function ReportDot({ state }: { state: string }): React.JSX.Element {
  const r = REPORT[state] ?? { tone: 'faint' as Tone, label: 'None' };
  return <StatusDot tone={r.tone} label={r.label} />;
}

/** The source of a value: the text around it with the quote marked. */
export function Snip({ before, quote, after, className }: { before: string; quote: string; after: string; className?: string | undefined }): React.JSX.Element {
  return (
    <p className={cn('vo-wrap min-w-0 text-[13px] leading-5 text-[var(--vo-muted)]', className)}>
      {before}
      <mark className="rounded-[3px] bg-[var(--vo-a-soft)] px-0.5 text-[var(--vo-ink)]">{quote}</mark>
      {after}
    </p>
  );
}

/** ppm growth as "+8.5%" (empty when unknown). */
export function growthText(ppm: number | null | undefined): string {
  if (ppm === null || ppm === undefined) return '';
  return pct(ppm, 1, { sign: true });
}
