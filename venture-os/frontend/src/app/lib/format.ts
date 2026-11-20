/**
 * Numbers, money and days as partners read them. Every figure on screen goes
 * through these helpers (mono, tabular, in components):
 *
 *   money(320000000, 'USD')              "USD 3,200,000.00"
 *   money(320000000, 'USD', { whole })   "USD 3,200,000"
 *   money(320000000, 'USD', { compact }) "USD 3.2M"
 *   money('12345678901234567', 'USD')    BigInt-safe strings from the engines
 *   pct(125000)                          "12.5%"   (_ppm: millionths)
 *   e8(240000000)                        2.4       (_e8: scaled by 10^8)
 *   multiple(240000000)                  "2.4x"    (TVPI, DPI, MOIC as _e8)
 *   compact(3200000)                     "3.2M"
 *   days(12)                             "12 days"
 *   months(6.5)                          "6.5 mo"
 *   fmtDay('2026-11-16')                 "16 Nov 2026" (the firm's style)
 *   relDay('2026-11-14')                 "in 2 days" / "today" / "3 days ago"
 *   ago('2026-11-12 08:02:09.874Z')      "5 min ago"
 *
 * Days are 'YYYY-MM-DD' text in the firm's zone (`_day`) and are never
 * shifted by the browser's zone. Timestamps are PocketBase UTC dates (`_at`)
 * read in the firm's zone. Never toLocaleDateString, never an ISO day on
 * screen. Unknown values (null) format to '' so a caller decides what to show
 * (the `Figure` component shows "Unknown", never a zero).
 */

/* ----------------------------------------------------------------- firm */

let zone: string | undefined;
let style = 'dmy';

/** The session sets the firm's zone and date style. */
export function setFirmFormat(firmZone: string, dateStyle: string): void {
  zone = firmZone !== '' ? firmZone : undefined;
  style = dateStyle !== '' ? dateStyle : 'dmy';
}

/* ---------------------------------------------------------------- money */

const EXPONENT: Record<string, number> = { JPY: 0, KRW: 0, VND: 0, CLP: 0, ISK: 0, UGX: 0, XAF: 0, XOF: 0, PYG: 0, KWD: 3, BHD: 3, OMR: 3, JOD: 3, TND: 3, LYD: 3, IQD: 3 };

/** Digits after the decimal mark that storage keeps for a currency. */
export function exponent(currency: string): number {
  return EXPONENT[currency.toUpperCase()] ?? 2;
}

export type Minor = number | string | bigint;

function toBig(v: Minor): bigint | null {
  try {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') return Number.isFinite(v) ? BigInt(Math.trunc(v)) : null;
    const s = v.trim();
    return /^-?\d+$/.test(s) ? BigInt(s) : null;
  } catch {
    return null;
  }
}

function group(digits: string): string {
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits.charAt(i);
  }
  return out;
}

/** Major units as a number, for charts only (never for stored sums). */
export function toMajor(minor: Minor, currency: string): number {
  const b = toBig(minor);
  if (b === null) return 0;
  return Number(b) / 10 ** exponent(currency);
}

export interface MoneyOpts {
  /** "USD 3.2M" */
  compact?: boolean | undefined;
  /** No decimals ("USD 3,200,000"). */
  whole?: boolean | undefined;
  /** "+USD 12.00" on gains. */
  sign?: boolean | undefined;
  /** Leave the currency code off (a column whose header names it). */
  bare?: boolean | undefined;
}

/** Integer minor units to text, exact for any size (BigInt). '' for null. */
export function money(minor: Minor | null | undefined, currency: string, o: MoneyOpts = {}): string {
  if (minor === null || minor === undefined) return '';
  const b = toBig(minor);
  if (b === null) return '';
  const cur = currency === '' ? '' : currency.toUpperCase();
  const neg = b < 0n;
  const abs = neg ? -b : b;
  let body: string;
  if (o.compact === true) {
    body = compact(Number(abs) / 10 ** exponent(cur || 'USD'));
  } else {
    const e = exponent(cur || 'USD');
    const s = abs.toString().padStart(e + 1, '0');
    const int = e === 0 ? s : s.slice(0, -e);
    const frac = e === 0 ? '' : s.slice(-e);
    body = group(int) + (o.whole === true || frac === '' ? '' : '.' + frac);
  }
  const lead = neg ? '-' : o.sign === true && b > 0n ? '+' : '';
  return lead + (o.bare === true || cur === '' ? body : `${cur} ${body}`);
}

/** Minor units as the major-unit text operations take ("1250.50"). */
export function majorParam(minor: Minor | null | undefined, currency: string): string | undefined {
  if (minor === null || minor === undefined) return undefined;
  const b = toBig(minor);
  if (b === null) return undefined;
  const e = exponent(currency === '' ? 'USD' : currency);
  const neg = b < 0n;
  const s = (neg ? -b : b).toString().padStart(e + 1, '0');
  return (neg ? '-' : '') + (e === 0 ? s : `${s.slice(0, -e)}.${s.slice(-e)}`);
}

/**
 * Typed money ("3,200,000", "3.2m", "1.5k", "12500.50") to minor units, or
 * null. Accepts one decimal mark (the currency's digits at most) and k, m, b.
 */
export function parseMoney(text: string, currency: string): number | null {
  const e = exponent(currency === '' ? 'USD' : currency);
  let s = text.trim().toLowerCase().replace(/[\s,]/g, '');
  s = s.replace(/^[a-z$£€¥]+/, '');
  if (s === '') return null;
  let mult = 1;
  const suffix = s.charAt(s.length - 1);
  if (suffix === 'k' || suffix === 'm' || suffix === 'b') {
    mult = suffix === 'k' ? 1e3 : suffix === 'm' ? 1e6 : 1e9;
    s = s.slice(0, -1);
  }
  const m = /^(-?)(\d*)(?:\.(\d+))?$/.exec(s);
  if (m === null || ((m[2] ?? '') === '' && (m[3] ?? '') === '')) return null;
  const frac = m[3] ?? '';
  if (mult === 1 && frac.length > e) return null;
  const value = Number(`${m[2] === '' ? '0' : m[2]}.${frac === '' ? '0' : frac}`) * mult;
  const minor = Math.round(value * 10 ** e);
  if (!Number.isSafeInteger(minor)) return null;
  return m[1] === '-' ? -minor : minor;
}

/** Minor units back to the text a person would type. */
export function moneyInputText(minor: number | null | undefined, currency: string): string {
  if (minor === null || minor === undefined) return '';
  return money(minor, currency, { bare: true });
}

/* ---------------------------------------------------------------- numbers */

/** "3.2M", "850K", "1.4B", "12" */
export function compact(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  const fix = (v: number): string => {
    const t = v.toFixed(digits);
    return t.includes('.') ? t.replace(/\.?0+$/, '') : t;
  };
  if (a >= 1e12) return sign + fix(a / 1e12) + 'T';
  if (a >= 1e9) return sign + fix(a / 1e9) + 'B';
  if (a >= 1e6) return sign + fix(a / 1e6) + 'M';
  if (a >= 1e3) return sign + fix(a / 1e3) + 'K';
  return sign + fix(a);
}

/** A plain number with grouping ("12,450"; at most `digits` decimals). */
export function num(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  const neg = n < 0;
  const fixed = Math.abs(n).toFixed(digits);
  const [i = '0', f = ''] = fixed.split('.');
  const trimmed = f.replace(/0+$/, '');
  return (neg ? '-' : '') + group(i) + (trimmed !== '' ? '.' + trimmed : '');
}

/** Millionths as a percent: 125000 -> "12.5%". */
export function pct(ppm: number | null | undefined, digits = 1, o: { sign?: boolean | undefined } = {}): string {
  if (ppm === null || ppm === undefined || !Number.isFinite(ppm)) return '';
  const v = ppm / 10000;
  const t = num(v, digits);
  return (o.sign === true && v > 0 ? '+' : '') + t + '%';
}

/** A plain ratio as a percent: 0.62 -> "62%". */
export function ratioPct(r: number | null | undefined, digits = 0): string {
  if (r === null || r === undefined || !Number.isFinite(r)) return '';
  return num(r * 100, digits) + '%';
}

/** A value scaled by 10^8 as a number (prices per share, FX rates, multiples). */
export function e8(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n / 1e8 : null;
}

/** A multiple stored as _e8: 240000000 -> "2.4x". */
export function multiple(v: number | string | null | undefined, digits = 2): string {
  const n = e8(v);
  if (n === null) return '';
  const t = n.toFixed(digits).replace(/\.?0+$/, '');
  return (t === '' || t === '-0' ? '0' : t) + 'x';
}

export function plural(n: number, one: string, other?: string): string {
  return `${num(n)} ${Math.abs(n) === 1 ? one : (other ?? one + 's')}`;
}

/** "12 days", "1 day" */
export function days(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  return plural(Math.round(n * 10) / 10, 'day');
}

/** Runway and similar: "6.5 mo" */
export function months(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  return `${num(n, digits)} mo`;
}

/* ------------------------------------------------------------------- days */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function isDay(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/** A 'YYYY-MM-DD' day as a local Date at noon (never shifted by zones). */
export function dateOf(day: string): Date {
  const [y = 1970, m = 1, d = 1] = day.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

/** A Date's (local) day key, 'YYYY-MM-DD'. */
export function dayKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function ms(ts: string): number {
  const n = Date.parse(ts.includes('T') ? ts : ts.replace(' ', 'T'));
  return Number.isNaN(n) ? 0 : n;
}

const zoneFmt = new Map<string, Intl.DateTimeFormat>();
function partsIn(n: number): { day: string; hh: number; mm: number } {
  const z = zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  let f = zoneFmt.get(z);
  if (f === undefined) {
    try {
      f = new Intl.DateTimeFormat('en-CA', { timeZone: z, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    } catch {
      f = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    }
    zoneFmt.set(z, f);
  }
  const p = f.formatToParts(new Date(n));
  const g = (k: string): string => p.find((x) => x.type === k)?.value ?? '';
  return { day: `${g('year')}-${g('month')}-${g('day')}`, hh: Number(g('hour')), mm: Number(g('minute')) };
}

/** Today in the firm's zone. */
export function today(): string {
  return partsIn(Date.now()).day;
}

/** The firm-zone day of a timestamp (a day comes back as it is). */
export function dayOf(v: string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '';
  if (isDay(v)) return v;
  const n = ms(v);
  return n === 0 ? '' : partsIn(n).day;
}

export function addDays(day: string, n: number): string {
  const d = dateOf(day);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((dateOf(b).getTime() - dateOf(a).getTime()) / 86400000);
}

export function monthName(m: number): string {
  return MONTHS[(m - 1 + 12) % 12] ?? '';
}

export function weekday(day: string): string {
  return WEEKDAYS[dateOf(day).getDay()] ?? '';
}

/**
 * A day in the firm's style: dmy "16 Nov 2026", mdy "Nov 16, 2026",
 * ymd "2026/11/16", iso "2026-11-16". `year: 'auto'` drops this year's.
 */
export function fmtDay(v: string | null | undefined, o: { year?: 'auto' | 'always' | 'never' | undefined; weekday?: boolean | undefined } = {}): string {
  const day = dayOf(v);
  if (day === '') return '';
  const [y = '', m = '', d = ''] = day.split('-');
  const showYear = o.year === 'always' || (o.year !== 'never' && (o.year === undefined || y !== today().slice(0, 4)));
  const wd = o.weekday === true ? weekday(day) + ' ' : '';
  const mon = monthName(Number(m));
  const dd = String(Number(d));
  if (style === 'iso') return wd + (showYear ? day : `${m}-${d}`);
  if (style === 'ymd') return wd + (showYear ? `${y}/${m}/${d}` : `${m}/${d}`);
  if (style === 'mdy') return wd + `${mon} ${dd}` + (showYear ? `, ${y}` : '');
  return wd + `${dd} ${mon}` + (showYear ? ` ${y}` : '');
}

/** "Nov 2026" / "2026/11" */
export function fmtMonth(v: string): string {
  const day = dayOf(v.length === 7 ? v + '-01' : v);
  if (day === '') return '';
  const [y = '', m = ''] = day.split('-');
  if (style === 'iso' || style === 'ymd') return `${y}${style === 'iso' ? '-' : '/'}${m}`;
  return `${monthName(Number(m))} ${y}`;
}

/** A quarter label from a day: "Q4 2026". */
export function fmtQuarter(v: string): string {
  const day = dayOf(v);
  if (day === '') return '';
  return `Q${Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1} ${day.slice(0, 4)}`;
}

export function fmtRange(from: string, to: string): string {
  if (from === '' || to === '') return fmtDay(from || to);
  if (from === to) return fmtDay(from);
  return `${fmtDay(from, { year: from.slice(0, 4) === to.slice(0, 4) ? 'never' : undefined })} to ${fmtDay(to)}`;
}

/** The time of a timestamp in the firm's zone: "14:05" (12 h for month-first styles). */
export function time(ts: string | null | undefined): string {
  if (ts === null || ts === undefined || ts === '') return '';
  const n = ms(ts);
  if (n === 0) return '';
  const { hh, mm } = partsIn(n);
  if (style === 'mdy') return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function fmtDateTime(ts: string | null | undefined): string {
  if (ts === null || ts === undefined || ts === '') return '';
  return `${fmtDay(ts, { year: 'auto' })} ${time(ts)}`;
}

/** "today", "tomorrow", "in 3 days", "yesterday", "3 days ago" */
export function relDay(v: string | null | undefined): string {
  const day = dayOf(v);
  if (day === '') return '';
  const n = daysBetween(today(), day);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  if (n > 0) return n < 60 ? `in ${n} days` : fmtDay(day);
  return -n < 60 ? `${-n} days ago` : fmtDay(day);
}

/** "now", "5 min ago", "3 h ago", "2 days ago", then the day. */
export function ago(ts: string | null | undefined): string {
  if (ts === null || ts === undefined || ts === '') return '';
  const n = ms(ts);
  if (n === 0) return '';
  const s = Math.max(0, (Date.now() - n) / 1000);
  if (s < 50) return 'now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 7) return Math.round(s / 86400) === 1 ? '1 day ago' : `${Math.round(s / 86400)} days ago`;
  return fmtDay(ts, { year: 'auto' });
}

/* ------------------------------------------------------------------ names */

/** Two letters for a letter avatar ("Acme Robotics" -> "AR", "maya" -> "MA"). */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => w !== '');
  if (words.length === 0) return '?';
  if (words.length === 1) return (words[0] ?? '').slice(0, 2).toUpperCase();
  return ((words[0] ?? '').charAt(0) + (words[words.length - 1] ?? '').charAt(0)).toUpperCase();
}

/** "pass_draft" -> "Pass draft" */
export function humanize(code: string): string {
  const s = code.replace(/[_-]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
