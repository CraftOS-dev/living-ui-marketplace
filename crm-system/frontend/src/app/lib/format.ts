/**
 * Money and date formatting. Amounts travel as integers in minor units of
 * their currency (cents); the exponent comes from the server's currency list.
 */
import type { Currency } from './types.ts';

const CCY = new Map<string, Currency>();
let HOME = 'USD';

export function setCurrencies(list: Currency[], home: string): void {
  CCY.clear();
  for (const c of list) CCY.set(c.code, c);
  HOME = home || 'USD';
}

export function homeCurrency(): string {
  return HOME;
}

export function exponent(code?: string): number {
  return CCY.get(code ?? HOME)?.exponent ?? 2;
}

export function symbol(code?: string): string {
  return CCY.get(code ?? HOME)?.symbol ?? (code ?? HOME) + ' ';
}

export function currencyList(): Currency[] {
  return [...CCY.values()];
}

const grouped = new Map<number, Intl.NumberFormat>();
function nf(d: number): Intl.NumberFormat {
  let f = grouped.get(d);
  if (f === undefined) {
    f = new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    grouped.set(d, f);
  }
  return f;
}

/** 123456 USD -> "1,234.56" (no symbol). */
export function amount(minor: number | null | undefined, code?: string): string {
  if (minor === null || minor === undefined || !isFinite(minor)) return '–';
  const e = exponent(code);
  return nf(e).format(Math.abs(minor) / 10 ** e);
}

/** 123456 USD -> "$1,234.56"; negatives as "−$1,234.56". */
export function money(minor: number | null | undefined, code?: string, opts: { sign?: boolean | undefined; symbol?: boolean | undefined } = {}): string {
  if (minor === null || minor === undefined || !isFinite(minor)) return '–';
  const s = opts.symbol === false ? '' : symbol(code);
  const neg = minor < 0;
  const body = s + amount(minor, code);
  if (neg) return '−' + body;
  if (opts.sign === true && minor > 0) return '+' + body;
  return body;
}

/** Report style: negatives in parentheses, zero as a dash. */
export function acct(minor: number | null | undefined, code?: string): string {
  if (minor === null || minor === undefined || !isFinite(minor)) return '';
  if (minor === 0) return '–';
  return minor < 0 ? '(' + amount(minor, code) + ')' : amount(minor, code);
}

/** Minor units -> decimal text for an input ("1234.50"). */
export function toDecimal(minor: number | null | undefined, code?: string): string {
  if (minor === null || minor === undefined || !isFinite(minor)) return '';
  const e = exponent(code);
  const neg = minor < 0;
  let s = String(Math.abs(Math.round(minor)));
  if (e === 0) return (neg ? '-' : '') + s;
  while (s.length <= e) s = '0' + s;
  return (neg ? '-' : '') + s.slice(0, s.length - e) + '.' + s.slice(s.length - e);
}

/** Decimal text typed by a person -> minor units, or null when it is not a number. */
export function parseMoney(text: string, code?: string): number | null {
  let t = text.trim().replace(/[\s,]/g, '').replace(/^[^\d\-(.]+/, '');
  if (t === '') return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) {
    neg = true;
    t = t.slice(1, -1);
  }
  if (t.startsWith('-')) {
    neg = !neg;
    t = t.slice(1);
  }
  if (!/^\d*(\.\d*)?$/.test(t) || t === '.' || t === '') return null;
  const e = exponent(code);
  const [w = '0', f = ''] = t.split('.');
  const frac = (f + '0'.repeat(e)).slice(0, e);
  let v = Number(w || '0') * 10 ** e + (e > 0 ? Number(frac || '0') : 0);
  if ((f[e] ?? '0') >= '5') v += 1;
  return neg ? -v : v;
}

/** A whole-number amount for big numbers in headers: "$12.4K". */
export function compact(minor: number | null | undefined, code?: string): string {
  if (minor === null || minor === undefined || !isFinite(minor)) return '–';
  const v = Math.abs(minor) / 10 ** exponent(code);
  const s = symbol(code);
  let body: string;
  if (v === 0) return s + '0';
  if (v >= 1e9) body = (v / 1e9).toFixed(1) + 'B';
  else if (v >= 1e6) body = (v / 1e6).toFixed(1) + 'M';
  else if (v >= 1e4) body = (v / 1e3).toFixed(1) + 'K';
  else body = nf(v >= 100 ? 0 : 2).format(v);
  return (minor < 0 ? '−' : '') + s + body;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-09-02" -> "2 Sep 2026" (or "2 Sep" this year with short). */
export function day(s: string | null | undefined, short = false): string {
  if (s === null || s === undefined || s === '') return '–';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m === null) return s;
  const y = m[1] ?? '';
  const mon = MONTHS[Number(m[2]) - 1] ?? '';
  const d = String(Number(m[3]));
  if (short && y === String(new Date().getFullYear())) return `${d} ${mon}`;
  return `${d} ${mon} ${y}`;
}

/** "2026-09" -> "September 2026" */
export function monthName(p: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(p);
  if (m === null) return p;
  const full = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${full[Number(m[2]) - 1] ?? ''} ${m[1] ?? ''}`;
}

/** Relative time for a PocketBase timestamp: "3 min ago". */
export function ago(ts: string | null | undefined): string {
  if (ts === null || ts === undefined || ts === '') return '';
  const t = Date.parse(ts.replace(' ', 'T'));
  if (!isFinite(t)) return '';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)} d ago`;
  return day(ts.slice(0, 10));
}

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(s: string, n: number): string {
  const d = new Date(s + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function monthStart(s: string): string {
  return s.slice(0, 8) + '01';
}

export function monthEnd(s: string): string {
  const d = new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)), 0));
  return d.toISOString().slice(0, 10);
}

/** Days from today to a date (negative in the past), or null. */
export function daysFrom(s: string | null | undefined): number | null {
  if (s === null || s === undefined || s === '') return null;
  const d = Date.parse(s.slice(0, 10) + 'T00:00:00Z');
  const t = Date.parse(today() + 'T00:00:00Z');
  if (!isFinite(d)) return null;
  return Math.round((d - t) / 86400000);
}

/** "today", "tomorrow", "in 3 days", "2 days ago", else a date. */
export function relDay(s: string | null | undefined): string {
  const n = daysFrom(s);
  if (n === null) return '–';
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  if (n > 1 && n < 14) return `in ${n} days`;
  if (n < -1 && n > -14) return `${-n} days ago`;
  return day(s, true);
}

/** A moment as "3 d ago" or a date for older ones; empty for none. */
export function since(ts: string | null | undefined): string {
  if (ts === null || ts === undefined || ts === '') return '';
  const t = Date.parse(ts.replace(' ', 'T'));
  if (!isFinite(t)) return '';
  const d = Math.floor((Date.now() - t) / 86400000);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d} d ago`;
  if (d < 365) return `${Math.round(d / 30)} mo ago`;
  return `${(d / 365).toFixed(1)} y ago`;
}

export function initials(name: string): string {
  const parts = name
    .replace(/[^\p{L}\p{N}\s@.]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((x) => x !== '');
  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0] ?? '?').slice(0, 2).toUpperCase();
  return ((parts[0] ?? '').charAt(0) + (parts[parts.length - 1] ?? '').charAt(0)).toUpperCase();
}

/** A stable category color index (1..8) for a name. */
export function hue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return (h % 8) + 1;
}

/** A stage's color token: c1..c8 for open stages, won and lost by meaning. */
export function stageColor(c: string | undefined, kind?: string): string {
  if (kind === 'won' || c === 'won') return 'var(--cr-pos)';
  if (kind === 'lost' || c === 'lost') return 'var(--cr-neg)';
  if (c !== undefined && /^c[1-8]$/.test(c)) return `var(--cr-${c})`;
  return 'var(--cr-ink-2)';
}

export function strengthBand(n: number): 'strong' | 'good' | 'weak' | 'none' {
  return n >= 60 ? 'strong' : n >= 30 ? 'good' : n > 0 ? 'weak' : 'none';
}

export const STRENGTH_LABEL: Record<string, string> = { strong: 'Strong', good: 'Good', weak: 'Weak', none: 'No contact' };

export const IX_LABEL: Record<string, string> = { email: 'Email', call: 'Call', meeting: 'Meeting', message: 'Message' };

export const TASK_KIND_LABEL: Record<string, string> = { todo: 'To do', call: 'Call', email: 'Email', meeting: 'Meeting', follow_up: 'Follow up' };

export const PIPELINE_KIND_LABEL: Record<string, string> = { sales: 'Sales', fundraising: 'Fundraising', hiring: 'Hiring', partnerships: 'Partnerships', other: 'Pipeline' };

export const PROPOSAL_KIND_LABEL: Record<string, string> = {
  update: 'Field change',
  deal_value: 'Deal value',
  stage: 'Stage move',
  close: 'Won / lost',
  merge: 'Merge',
  delete: 'Delete',
  email: 'Email',
};

export const ACTOR_LABEL: Record<string, string> = { user: 'You', agent: 'AI agent', import: 'Import', system: 'System' };
