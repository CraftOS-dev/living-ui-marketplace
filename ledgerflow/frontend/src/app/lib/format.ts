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

export const ACCOUNT_TYPE_LABEL: Record<string, string> = { asset: 'Assets', liability: 'Liabilities', equity: 'Equity', income: 'Income', expense: 'Expenses' };

export const SUBTYPE_LABEL: Record<string, string> = {
  bank: 'Bank',
  cash: 'Cash',
  card: 'Credit card',
  receivable: 'Receivables',
  payable: 'Payables',
  tax: 'Tax',
  loan: 'Loan',
  current_asset: 'Current asset',
  fixed_asset: 'Fixed asset',
  contra_asset: 'Contra asset',
  investment: 'Investment',
  clearing: 'Clearing',
  current_liability: 'Current liability',
  equity: 'Equity',
  retained: 'Retained earnings',
  opening: 'Opening balances',
  income: 'Income',
  other_income: 'Other income',
  expense: 'Expense',
  cogs: 'Cost of sales',
  other_expense: 'Other expense',
};

export const METHOD_LABEL: Record<string, string> = {
  match: 'Match',
  document: 'Pays document',
  transfer: 'Transfer',
  rule: 'Rule',
  memory: 'Like before',
  agent: 'AI',
  manual: 'Manual',
  recurring: 'Recurring',
};

export const DOC_LABEL: Record<string, string> = { invoice: 'Invoice', bill: 'Bill', credit_note: 'Credit note', vendor_credit: 'Vendor credit' };

export const KIND_LABEL: Record<string, string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
  journal: 'Journal',
  invoice: 'Invoice',
  bill: 'Bill',
  credit_note: 'Credit note',
  vendor_credit: 'Vendor credit',
  payment: 'Payment',
  opening: 'Opening',
  adjustment: 'Adjustment',
  reconciliation: 'Reconciliation',
  fx: 'Currency',
  writeoff: 'Write-off',
  reversal: 'Reversal',
};

export function bytes(n: number): string {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}
