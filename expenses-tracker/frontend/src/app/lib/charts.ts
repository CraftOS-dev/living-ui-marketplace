/** Turning summaries into chart inputs. */
import type { BarItem } from '../components/charts.tsx';
import type { DonutSlice } from '../components/Donut.tsx';
import { shortDay, today } from './dates.ts';
import { money } from './money.ts';
import { segmentColor } from './palette.ts';
import type { MonthSummary } from './types.ts';

/** The five biggest categories, then everything else as one slice. */
export function slicesOf(s: MonthSummary, currency: string): (DonutSlice & { icon: string; id: string | null })[] {
  const cats = s.categories.filter((c) => c.total_minor > 0);
  const top = cats.slice(0, 5);
  const rest = cats.slice(5);
  const out: (DonutSlice & { icon: string; id: string | null })[] = top.map((c, i) => {
    const col = segmentColor(i, false);
    return {
      key: c.id ?? 'none',
      id: c.id,
      label: c.name,
      value: c.total_minor,
      amount: money(c.total_minor, currency, true),
      share: c.share,
      fill: col.fill,
      text: col.text,
      icon: c.icon,
    };
  });
  if (rest.length > 0) {
    const total = rest.reduce((a, c) => a + c.total_minor, 0);
    const col = segmentColor(0, true);
    out.push({
      key: 'rest',
      id: null,
      label: 'Everything else',
      value: total,
      amount: money(total, currency, true),
      share: s.total_minor > 0 ? Math.round((total / s.total_minor) * 1000) / 10 : 0,
      fill: col.fill,
      text: col.text,
      icon: 'package',
    });
  }
  return out;
}

/** The headline number: no cents once it reaches four digits. */
export function headline(minor: number, currency: string, decimals: number): string {
  return money(minor, currency, minor >= 1000 * 10 ** decimals);
}

/** One bar per day; a pale bar behind shows the daily allowance when a budget is set. */
export function dayBars(s: MonthSummary, currency: string): BarItem[] {
  const t = today();
  const allowance = s.budget !== null ? Math.round(s.budget.amount_minor / s.days_in_month) : undefined;
  const marks = new Set([1, 5, 10, 15, 20, 25, s.days_in_month]);
  return s.daily.map((d) => {
    const n = Number(d.date.slice(8, 10));
    const future = d.date > t;
    const over = allowance !== undefined && d.total_minor > allowance;
    return {
      key: d.date,
      label: marks.has(n) ? String(n) : '',
      value: d.total_minor,
      ...(allowance !== undefined ? { ghost: allowance } : {}),
      tone: future ? 'future' : d.date === t ? 'today' : over ? 'over' : 'normal',
      tip: `${shortDay(d.date)} · ${money(d.total_minor, currency)}`,
    };
  });
}
