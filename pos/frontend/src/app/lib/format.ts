/**
 * Numbers, money and times on screen. Money arrives from the operations as
 * integers of minor units (cents, sen, yen) with the currency's decimals;
 * every amount reads "1,234.50" ("," for thousands, "." for decimals),
 * whatever the browser's language, the same way the keypad types it.
 */

export const NUMBER_LOCALE = 'en-US';

const formats = new Map<string, Intl.NumberFormat>();

function moneyFormat(currency: string, digits: number): Intl.NumberFormat {
  const key = `${currency}:${digits}`;
  let f = formats.get(key);
  if (f === undefined) {
    try {
      f = new Intl.NumberFormat(NUMBER_LOCALE, { style: 'currency', currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: digits, maximumFractionDigits: digits });
    } catch {
      f = new Intl.NumberFormat(NUMBER_LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    }
    formats.set(key, f);
  }
  return f;
}

const plainFormats = new Map<number, Intl.NumberFormat>();

function plainFormat(digits: number): Intl.NumberFormat {
  let f = plainFormats.get(digits);
  if (f === undefined) {
    f = new Intl.NumberFormat(NUMBER_LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    plainFormats.set(digits, f);
  }
  return f;
}

/** Minor units -> "$4.50" / "RM4.50" / "¥874". A true minus sign reads better than a hyphen. */
export function money(minor: number, currency: string, exp: number): string {
  return moneyFormat(currency, exp)
    .format(minor / 10 ** exp)
    .replace('-', '−');
}

/** Minor units -> "4.50" (grouped, no symbol). */
export function amount(minor: number, exp: number): string {
  return plainFormat(exp)
    .format(minor / 10 ** exp)
    .replace('-', '−');
}

/** Minor units -> "1234.5" plain text for an input field or an operation param. */
export function majorText(minor: number, exp: number): string {
  if (exp === 0) return String(minor);
  const neg = minor < 0;
  let digits = String(Math.abs(Math.round(minor)));
  while (digits.length <= exp) digits = `0${digits}`;
  return `${neg ? '-' : ''}${digits.slice(0, digits.length - exp)}.${digits.slice(digits.length - exp)}`;
}

/** The currency's symbol on its own ("$", "RM", "¥"). */
export function symbolOf(currency: string): string {
  try {
    const part = new Intl.NumberFormat(NUMBER_LOCALE, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
      .formatToParts(0)
      .find((p) => p.type === 'currency');
    return part?.value ?? currency;
  } catch {
    return currency;
  }
}

/**
 * What the user typed -> minor units, or null when it is not an amount. "."
 * is the decimal point and "," only separates thousands; no more decimals
 * than the currency has.
 */
export function parseMoney(text: string, exp: number, allowNegative = false): number | null {
  let s = text.trim().replace(/\s/g, '');
  let neg = false;
  if (s.startsWith('-') || s.startsWith('−')) {
    neg = true;
    s = s.slice(1);
  }
  s = s.replace(/^[^\d.]+/, '');
  if (s === '' || s === '.' || !/^(\d{1,3}(,\d{3})+|\d+)?(\.\d*)?$/.test(s)) return null;
  const [whole = '', frac = ''] = s.replace(/,/g, '').split('.');
  if (frac.length > exp) return null;
  const n = Number((whole === '' ? '0' : whole) + frac.padEnd(exp, '0'));
  if (!Number.isSafeInteger(n)) return null;
  if (neg && !allowNegative) return null;
  return neg ? -n : n;
}

/** Basis points -> "12.5%". */
export function percent(bp: number): string {
  const v = bp / 100;
  return `${Number.isInteger(v) ? v : v.toFixed(2).replace(/0$/, '')}%`;
}

/** "12.5" -> 1250 basis points, or null. */
export function parsePercent(text: string): number | null {
  const s = text.trim().replace(/%$/, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [w = '0', f = ''] = s.split('.');
  const bp = Number(w) * 100 + Number(f.padEnd(2, '0'));
  return bp <= 10000 ? bp : null;
}

const qtyFormat = new Intl.NumberFormat(NUMBER_LOCALE, { maximumFractionDigits: 3 });

export function qty(n: number): string {
  return qtyFormat.format(n).replace('-', '−');
}

/** "1 item" / "3 items". */
export function plural(n: number, one: string, many?: string): string {
  return `${qty(n)} ${n === 1 ? one : (many ?? `${one}s`)}`;
}

/* ----------------------------------------------------------------- times */

/** A PocketBase timestamp ("2026-10-07 01:59:15.344Z") as a Date. */
export function parseTs(ts: string): Date | null {
  if (ts === '') return null;
  const t = Date.parse(ts.replace(' ', 'T'));
  return Number.isNaN(t) ? null : new Date(t);
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** "14:05". */
export function time(ts: string): string {
  const d = parseTs(ts);
  return d === null ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "2026-10-10". */
export function dayOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function today(): string {
  return dayOf(new Date());
}

export function addDays(day: string, n: number): string {
  const d = new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
  d.setDate(d.getDate() + n);
  return dayOf(d);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Fri 10 Oct" for a YYYY-MM-DD day ("Today", "Yesterday" when close). */
export function dayLabel(day: string, todayDay: string = today()): string {
  if (day === todayDay) return 'Today';
  if (day === addDays(todayDay, -1)) return 'Yesterday';
  const d = new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
  const sameYear = day.slice(0, 4) === todayDay.slice(0, 4);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}${sameYear ? '' : ` ${d.getFullYear()}`}`;
}

/** "10 Oct 2026, 14:05". */
export function dateTime(ts: string): string {
  const d = parseTs(ts);
  if (d === null) return '';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Whole minutes since a timestamp. */
export function minutesSince(ts: string, now: number = Date.now()): number {
  const d = parseTs(ts);
  return d === null ? 0 : Math.max(0, Math.floor((now - d.getTime()) / 60000));
}

/** "now", "4 min", "1 h 5 min". */
export function ago(ts: string, now: number = Date.now()): string {
  const m = minutesSince(ts, now);
  if (m < 1) return 'now';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h${m % 60 > 0 ? ` ${m % 60} min` : ''}`;
}

export const ORDER_TYPE_LABEL: Record<string, string> = { dine_in: 'Dine in', takeaway: 'Takeaway', delivery: 'Delivery' };
export const ROLE_LABEL: Record<string, string> = { owner: 'Owner', manager: 'Manager', cashier: 'Cashier' };
