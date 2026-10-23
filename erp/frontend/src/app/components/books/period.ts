/**
 * Report periods: the presets people pick ("This month", "Last year") as
 * from/to days, the fiscal year honoured, and a short label for a range.
 */
import { addDays, addMonths, monthLabel, shortDay, today } from '../../lib/dates.ts';

export type Preset = 'this_month' | 'last_month' | 'this_quarter' | 'last_quarter' | 'this_year' | 'last_year' | 'custom';

export const PRESETS: { value: Preset; label: string }[] = [
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'this_quarter', label: 'This quarter' },
  { value: 'this_year', label: 'This year' },
  { value: 'last_year', label: 'Last year' },
  { value: 'custom', label: 'Custom' },
];

function monthEnd(month: string): string {
  return addDays(`${addMonths(month, 1)}-01`, -1);
}

/** First month (YYYY-MM) of the fiscal year holding `day`. */
export function fiscalStartMonth(day: string, fiscalStart: number): string {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  const fm = fiscalStart >= 1 && fiscalStart <= 12 ? fiscalStart : 1;
  const year = m >= fm ? y : y - 1;
  return `${year}-${String(fm).padStart(2, '0')}`;
}

export function rangeOf(preset: Preset, fiscalStart: number): { from: string; to: string } {
  const t = today();
  const m = t.slice(0, 7);
  switch (preset) {
    case 'last_month': {
      const lm = addMonths(m, -1);
      return { from: `${lm}-01`, to: monthEnd(lm) };
    }
    case 'this_quarter': {
      const q = Math.floor((Number(m.slice(5, 7)) - 1) / 3) * 3 + 1;
      const start = `${m.slice(0, 4)}-${String(q).padStart(2, '0')}`;
      return { from: `${start}-01`, to: t };
    }
    case 'last_quarter': {
      const q = Math.floor((Number(m.slice(5, 7)) - 1) / 3) * 3 + 1;
      const start = addMonths(`${m.slice(0, 4)}-${String(q).padStart(2, '0')}`, -3);
      return { from: `${start}-01`, to: monthEnd(addMonths(start, 2)) };
    }
    case 'this_year': {
      const fs = fiscalStartMonth(t, fiscalStart);
      return { from: `${fs}-01`, to: t };
    }
    case 'last_year': {
      const fs = addMonths(fiscalStartMonth(t, fiscalStart), -12);
      return { from: `${fs}-01`, to: monthEnd(addMonths(fs, 11)) };
    }
    case 'this_month':
    case 'custom':
    default:
      return { from: `${m}-01`, to: t };
  }
}

/** "Oct 1 to Oct 20, 2026", "October 2026", "Jan 1 to Dec 31, 2025". */
export function rangeLabel(from: string, to: string): string {
  if (from.slice(0, 7) === to.slice(0, 7) && from.endsWith('-01') && (to === monthEnd(to.slice(0, 7)) || to === today())) {
    return monthLabel(from.slice(0, 7));
  }
  const y = to.slice(0, 4);
  const sameYear = from.slice(0, 4) === y;
  return `${shortDay(from)}${sameYear ? '' : `, ${from.slice(0, 4)}`} to ${shortDay(to)}, ${y}`;
}

/** Which preset a range matches (custom when none). */
export function presetOf(from: string, to: string, fiscalStart: number): Preset {
  for (const p of PRESETS) {
    if (p.value === 'custom') continue;
    const r = rangeOf(p.value, fiscalStart);
    if (r.from === from && r.to === to) return p.value;
  }
  return 'custom';
}

/** "2026-10" -> "Oct". */
export function monthShort(month: string): string {
  const d = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1);
  return d.toLocaleDateString(undefined, { month: 'short' });
}
