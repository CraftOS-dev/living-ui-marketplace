/**
 * Showing money, quantities and times. Money arrives as whole minor units
 * and goes back to the operations as plain major-unit text ("4.50"), which
 * the server parses digit by digit: no floating point on the way.
 */

export interface Money {
  currency: string;
  digits: number;
  /** With the currency: "$4.50", "¥450", "4,50 €" (the browser's locale). */
  fmt: (minor: number) => string;
  /** Signed, for changes: "+$4.50", "−$4.50". */
  signed: (minor: number) => string;
  /** Plain major units for the operations and fields: "4.50", "-4.50", "450". */
  plain: (minor: number) => string;
  /** The currency symbol alone ("$", "€", "¥"). */
  symbol: string;
  /** The smallest unit as minor units (1). */
  unit: number;
}

const cache = new Map<string, Money>();

function formatter(currency: string, digits: number): Intl.NumberFormat {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits });
  } catch {
    // A code the browser does not know (a made-up or retired one): number plus code.
    return new Intl.NumberFormat(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
}

export function money(currency: string, digits: number): Money {
  const key = currency + ':' + digits;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const f = formatter(currency, digits);
  const known = f.resolvedOptions().style === 'currency';
  const scale = 10 ** digits;
  const fmt = (minor: number): string => {
    // No "-$0.00": a zero is a zero whatever its sign.
    const text = f.format(minor === 0 ? 0 : minor / scale);
    return known ? text : text + ' ' + currency;
  };
  let symbol = currency;
  if (known) {
    const part = f.formatToParts(1).find((p) => p.type === 'currency');
    if (part !== undefined) symbol = part.value;
  }
  const out: Money = {
    currency,
    digits,
    fmt,
    signed: (minor) => (minor > 0 ? '+' + fmt(minor) : minor < 0 ? '−' + fmt(-minor) : fmt(0)),
    plain: (minor) => plain(minor, digits),
    symbol,
    unit: 1,
  };
  cache.set(key, out);
  return out;
}

/** Minor units as plain major-unit text, exact (no floating point). */
export function plain(minor: number, digits: number): string {
  const neg = minor < 0;
  const s = String(Math.abs(Math.round(minor)));
  if (digits === 0) return (neg ? '-' : '') + s;
  const padded = s.padStart(digits + 1, '0');
  return (neg ? '-' : '') + padded.slice(0, -digits) + '.' + padded.slice(-digits);
}

/** Major-unit text typed by a person ("4.5", "4,50", "1 200.00") to minor units, or null when it is not an amount. */
export function toMinor(text: string, digits: number): number | null {
  const t = text.trim().replace(/[\s ']/g, '');
  if (t === '') return null;
  const m = /^(-)?(\d*)(?:[.,](\d*))?$/.exec(t);
  if (m === null) return null;
  const whole = m[2] ?? '';
  const frac = m[3] ?? '';
  if (whole === '' && frac === '') return null;
  if (frac.length > digits) return null;
  const n = Number(whole === '' ? '0' : whole) * 10 ** digits + Number(frac.padEnd(digits, '0') || '0');
  return m[1] === '-' ? -n : n;
}

/** A quantity: whole numbers plain, weights to 3 decimals without trailing zeros. */
export function qty(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 1000) / 1000);
}

export function percent(n: number): string {
  return (Math.round(n * 100) / 100).toString() + '%';
}

/* ------------------------------------------------------------------ dates */

/** A PocketBase date ("2026-10-10 01:00:41.152Z") or ISO text as a Date, or null. */
export function toDate(s: string | null | undefined): Date | null {
  if (s === null || s === undefined || s === '') return null;
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const shortDateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

export function time(s: string | Date | null | undefined): string {
  const d = s instanceof Date ? s : toDate(s);
  return d === null ? '' : timeFmt.format(d);
}

export function date(s: string | Date | null | undefined): string {
  const d = s instanceof Date ? s : toDate(s);
  return d === null ? '' : dateFmt.format(d);
}

export function shortDate(s: string | Date | null | undefined): string {
  const d = s instanceof Date ? s : toDate(s);
  return d === null ? '' : shortDateFmt.format(d);
}

export function longDay(d: Date): string {
  return weekdayFmt.format(d);
}

/** "Today 14:05", "Yesterday 09:12", "3 Oct 14:05", or with the year when not this year. */
export function when(s: string | null | undefined): string {
  const d = toDate(s);
  if (d === null) return '';
  const now = new Date();
  const days = Math.round((dayStart(now).getTime() - dayStart(d).getTime()) / 86400000);
  if (days === 0) return 'Today ' + timeFmt.format(d);
  if (days === 1) return 'Yesterday ' + timeFmt.format(d);
  if (d.getFullYear() === now.getFullYear()) return shortDateFmt.format(d) + ', ' + timeFmt.format(d);
  return dateFmt.format(d) + ', ' + timeFmt.format(d);
}

/** "just now", "4 min ago", "2 h ago", then the date. */
export function ago(s: string | null | undefined): string {
  const d = toDate(s);
  if (d === null) return '';
  const sec = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (sec < 45) return 'just now';
  if (sec < 3600) return Math.round(sec / 60) + ' min ago';
  if (sec < 86400) return Math.round(sec / 3600) + ' h ago';
  return when(s);
}

export function dayStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** A local calendar day as the operations take it: "2026-10-10". */
export function ymd(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Minutes as "7 h 25 min". */
export function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return m + ' min';
  return h + ' h' + (m > 0 ? ' ' + m + ' min' : '');
}

/** Two letters for a product tile without a picture: "Flat white" -> "FW", "Mug" -> "MU". */
export function abbreviation(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => w !== '');
  if (words.length === 0) return '';
  if (words.length === 1) return (words[0] ?? '').slice(0, 2).toUpperCase();
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase();
}

/** Initials for an avatar: "Sam Lee" -> "SL". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter((x) => x !== '');
  if (parts.length === 0) return '?';
  const a = parts[0]?.[0] ?? '';
  const b = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : (parts[0]?.[1] ?? '');
  return (a + b).toUpperCase();
}

export function plural(n: number, one: string, many?: string): string {
  return qty(n) + ' ' + (n === 1 ? one : (many ?? one + 's'));
}
