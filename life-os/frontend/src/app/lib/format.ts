/** Dates, numbers and words for the screens. Numbers always read "1,234". */

const NUMBER_LOCALE = 'en-US';

export function num(n: number, digits = 0): string {
  return n.toLocaleString(NUMBER_LOCALE, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function plural(n: number, one: string, many?: string | undefined): string {
  return num(n) + ' ' + (n === 1 ? one : (many ?? one + 's'));
}

export function pct(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '';
  return Math.round(x * 100) + '%';
}

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WD1 = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** A YYYY-MM-DD as a local date at noon. */
export function parseDay(d: string): Date {
  return new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)), 12);
}

export function fmtDay(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export function addDays(day: string, n: number): string {
  const d = parseDay(day);
  d.setDate(d.getDate() + n);
  return fmtDay(d);
}

export function addMonths(day: string, n: number): string {
  const d = parseDay(day);
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1, 12);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0, 12).getDate();
  t.setDate(Math.min(d.getDate(), last));
  return fmtDay(t);
}

export function between(a: string, b: string): number {
  return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86400000);
}

export function weekday(day: string): number {
  return parseDay(day).getDay();
}

/** "Oct 21" this year, "Oct 21, 2025" otherwise. */
export function shortDay(day: string, today?: string | undefined): string {
  if (day === '') return '';
  const d = parseDay(day);
  const y = today !== undefined ? Number(today.slice(0, 4)) : new Date().getFullYear();
  return MON[d.getMonth()] + ' ' + d.getDate() + (d.getFullYear() !== y ? ', ' + d.getFullYear() : '');
}

/** "Today", "Tomorrow", "Yesterday", "Friday" (this week), else "Oct 21". */
export function relDay(day: string, today: string): string {
  if (day === '') return '';
  const n = between(today, day);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n > 1 && n < 7) return WEEKDAYS[weekday(day)] ?? '';
  return shortDay(day, today);
}

/** relDay inside a sentence: "today", "tomorrow", "yesterday", "Friday", "Oct 21". */
export function inlineDay(day: string, today: string): string {
  const n = day === '' ? NaN : between(today, day);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return relDay(day, today);
}

/** The local calendar day (YYYY-MM-DD) of a stored timestamp. */
export function dayOf(ts: string): string {
  const d = toDate(ts);
  return d === null ? '' : fmtDay(d);
}

/** "Friday, October 23" */
export function longDay(day: string): string {
  const d = parseDay(day);
  return WEEKDAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate();
}

/** "Oct 19 to 25" or "Oct 26 to Nov 1" */
export function rangeLabel(start: string, end: string): string {
  const a = parseDay(start);
  const b = parseDay(end);
  if (a.getMonth() === b.getMonth()) return MON[a.getMonth()] + ' ' + a.getDate() + ' to ' + b.getDate();
  return MON[a.getMonth()] + ' ' + a.getDate() + ' to ' + MON[b.getMonth()] + ' ' + b.getDate();
}

function toDate(ts: string): Date | null {
  if (ts === '') return null;
  const d = new Date(ts.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "just now", "5 min ago", "3 h ago", "yesterday", then the date. */
export function ago(ts: string): string {
  const d = toDate(ts);
  if (d === null) return '';
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  if (s < 172800) return 'yesterday';
  if (s < 7 * 86400) return Math.floor(s / 86400) + ' days ago';
  return shortDay(fmtDay(d));
}

export function clock(ts: string): string {
  const d = toDate(ts);
  if (d === null) return '';
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

/** "Good morning" by the part of the day. */
export function greetingFor(part: string): string {
  if (part === 'morning') return 'Good morning';
  if (part === 'afternoon') return 'Good afternoon';
  if (part === 'evening') return 'Good evening';
  return 'Good evening';
}

export const SEASON_LABEL: Record<string, string> = { spring: 'Spring', summer: 'Summer', autumn: 'Autumn', winter: 'Winter' };

/** A short text, cut with an ellipsis. */
export function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
}

/** "x of y" for numbers that may have decimals. */
export function figure(v: number, unit?: string | undefined): string {
  const s = Number.isInteger(v) ? num(v) : num(v, 1);
  return unit !== undefined && unit !== '' ? s + ' ' + unit : s;
}

export function minutes(m: number): string {
  if (m <= 0) return '';
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h + ' h' + (r > 0 ? ' ' + r + ' min' : '');
}

/** Money from minor units (cents) in the person's currency. */
export function money(minor: number, currency: string, digits: number, opts: { sign?: boolean | undefined; whole?: boolean | undefined } = {}): string {
  const v = minor / Math.pow(10, digits);
  const d = opts.whole === true ? 0 : Math.abs(v) >= 1000 && v % 1 === 0 ? 0 : digits;
  let text: string;
  try {
    text = new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: d, maximumFractionDigits: d }).format(Math.abs(v));
  } catch {
    text = currency + ' ' + Math.abs(v).toFixed(d);
  }
  if (v < 0) return '-' + text;
  return opts.sign === true && v > 0 ? '+' + text : text;
}

/** Minor units as the plain number a person types ("12.50"). */
export function moneyInput(minor: number, digits: number): string {
  if (minor === 0) return '';
  return (minor / Math.pow(10, digits)).toFixed(digits).replace(/\.0+$/, '');
}

/** A time like "13:00" in the person's clock (24 hours). */
export function hourLabel(t: string): string {
  return t.slice(0, 5);
}

export function temp(t: number | null | undefined): string {
  return t === null || t === undefined ? '' : `${Math.round(t)}°`;
}
