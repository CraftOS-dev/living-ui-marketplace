/** Days are plain 'YYYY-MM-DD' strings in the user's local calendar. */

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function toDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function today(): string {
  return toDay(new Date());
}

export function thisMonth(): string {
  return today().slice(0, 7);
}

function parse(day: string): Date {
  return new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
}

export function addDays(day: string, n: number): string {
  const d = parse(day);
  d.setDate(d.getDate() + n);
  return toDay(d);
}

export function addMonths(month: string, n: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${pad(mm + 1)}`;
}

/** "Today", "Yesterday", or "Mon, Oct 5" (with the year when it is not this year). */
export function dayLabel(day: string): string {
  const t = today();
  if (day === t) return 'Today';
  if (day === addDays(t, -1)) return 'Yesterday';
  const d = parse(day);
  const sameYear = day.slice(0, 4) === t.slice(0, 4);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

export function shortDay(day: string): string {
  return parse(day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** "October 2026" (or "October" for this year when short). */
export function monthLabel(month: string, short = false): string {
  const d = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1);
  const sameYear = month.slice(0, 4) === today().slice(0, 4);
  return d.toLocaleDateString(undefined, short && sameYear ? { month: 'long' } : { month: 'long', year: 'numeric' });
}

export function monthShort(month: string): string {
  const d = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1);
  return d.toLocaleDateString(undefined, { month: 'short' });
}

/** "3 min ago" style for timestamps from PocketBase ('2026-10-07 01:59:15.344Z'). */
export function ago(ts: string): string {
  const t = Date.parse(ts.replace(' ', 'T'));
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return dayLabel(toDay(new Date(t)));
}
