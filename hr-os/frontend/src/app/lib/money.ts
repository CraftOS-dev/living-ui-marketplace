/**
 * Money on screen. Storage is always integer minor units with the currency
 * code beside it; the exponent decides the decimals (JPY 0, KWD 3, most 2).
 * Display uses Intl with the viewer's locale; input accepts the locale's
 * grouping between thousands and one decimal mark, and never floats.
 *
 * Unambiguous by default ('auto'): the ISO code ("SGD 1,250.00",
 * "JPY 250,000"), and the narrow symbol ("$1,250.00") only when the amount
 * is in the company's reporting currency AND every amount on the screen is
 * in that one currency (SGD and USD would both read "$"). 'code' and
 * 'symbol' force one; 'none' drops the currency.
 *
 *   formatMoney(1234567, 'MYR')                       -> "MYR 12,345.67"
 *   formatMoney(250000, 'JPY')                        -> "JPY 250,000"
 *   formatMoney(125000, 'SGD', { display: 'symbol' }) -> "$1,250.00"
 *   parseMoney('12,345.6', 'MYR')                     -> 1234560
 *   parseMoney('abc', 'MYR')                          -> null
 */

const EXPONENT: Record<string, number> = {
  JPY: 0,
  KRW: 0,
  VND: 0,
  CLP: 0,
  ISK: 0,
  UGX: 0,
  XAF: 0,
  XOF: 0,
  PYG: 0,
  KWD: 3,
  BHD: 3,
  OMR: 3,
  JOD: 3,
  TND: 3,
  LYD: 3,
  IQD: 3,
};

/** Digits after the decimal mark that storage keeps for a currency. */
export function exponent(currency: string): number {
  return EXPONENT[currency.toUpperCase()] ?? 2;
}

/** Digits shown (IDR is stored with 2 but shown with none). */
function shownDigits(currency: string): number {
  if (currency.toUpperCase() === 'IDR') return 0;
  return exponent(currency);
}

/** Major units as a number, for charts only (never for sums that are stored). */
export function toMajor(minor: number, currency: string): number {
  return minor / 10 ** exponent(currency);
}

/* ------------------------------------------------ which currencies are shown */

let reporting = '';
const onScreen = new Map<string, number>();
let screen = 0;
const screenSubs = new Set<() => void>();

function bump(): void {
  screen++;
  for (const fn of screenSubs) fn();
}

/** The company's reporting currency (set by the session when it loads). */
export function setReportingCurrency(currency: string): void {
  const c = currency.toUpperCase();
  if (c === reporting) return;
  reporting = c;
  bump();
}

/** A <Money> on screen says its currency; the returned function takes it back. */
export function showCurrency(currency: string): () => void {
  const c = currency.toUpperCase();
  if (c === '') return () => undefined;
  const n = onScreen.get(c) ?? 0;
  onScreen.set(c, n + 1);
  if (n === 0) bump();
  return () => {
    const m = (onScreen.get(c) ?? 1) - 1;
    if (m <= 0) {
      onScreen.delete(c);
      bump();
    } else onScreen.set(c, m);
  };
}

/** For useSyncExternalStore: changes when the set of shown currencies (or the reporting one) changes. */
export function subscribeCurrencies(fn: () => void): () => void {
  screenSubs.add(fn);
  return () => {
    screenSubs.delete(fn);
  };
}
export function currenciesVersion(): number {
  return screen;
}

/** 'auto': the symbol only for the reporting currency while it is the only one on screen. */
function autoStyle(currency: string): 'symbol' | 'code' {
  const c = currency.toUpperCase();
  if (reporting === '' || c !== reporting) return 'code';
  for (const other of onScreen.keys()) if (other !== c) return 'code';
  return 'symbol';
}

const fmtCache = new Map<string, Intl.NumberFormat>();

function formatter(currency: string, style: 'symbol' | 'code' | 'none', compact: boolean): Intl.NumberFormat {
  const key = `${currency}|${style}|${compact ? 1 : 0}`;
  let f = fmtCache.get(key);
  if (f === undefined) {
    const digits = shownDigits(currency);
    try {
      f =
        style === 'none'
          ? new Intl.NumberFormat(undefined, { minimumFractionDigits: compact ? 0 : digits, maximumFractionDigits: compact ? 1 : digits, notation: compact ? 'compact' : 'standard' })
          : new Intl.NumberFormat(undefined, {
              style: 'currency',
              currency,
              currencyDisplay: style === 'code' ? 'code' : 'narrowSymbol',
              minimumFractionDigits: compact ? 0 : digits,
              maximumFractionDigits: compact ? 1 : digits,
              notation: compact ? 'compact' : 'standard',
            });
    } catch {
      f = new Intl.NumberFormat(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    }
    fmtCache.set(key, f);
  }
  return f;
}

export type MoneyDisplay = 'auto' | 'code' | 'symbol' | 'none';

export interface MoneyFormat {
  /** 'auto' (default, see the top), 'code' "MYR 1,200.00", 'symbol' "RM 1,200.00", 'none' "1,200.00". */
  display?: MoneyDisplay | undefined;
  /** "RM 1.2K" for chart axes and tiles. */
  compact?: boolean | undefined;
  /** Show a + on positive values (variances). */
  sign?: boolean | undefined;
}

export function formatMoney(minor: number | null | undefined, currency: string, f: MoneyFormat = {}): string {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return '';
  const cur = currency === '' ? 'USD' : currency;
  const major = minor / 10 ** exponent(cur);
  const want = f.display ?? 'auto';
  const style = currency === '' ? 'none' : want === 'auto' ? autoStyle(cur) : want;
  const text = formatter(cur, style, f.compact === true).format(major);
  return f.sign === true && minor > 0 ? `+${text}` : text;
}

/**
 * A canonical major-unit string from the server or a link ("6500.00", "-12.5",
 * "250000") to minor units, whatever the viewer's locale. Null when it is not
 * one or has more decimals than the currency keeps.
 */
export function minorFromMajor(text: string, currency: string): number | null {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (m === null) return null;
  const e = exponent(currency);
  const frac = (m[3] ?? '').replace(/0+$/, '');
  if (frac.length > e) return null;
  const n = Number((m[2] ?? '0') + frac.padEnd(e, '0'));
  if (!Number.isSafeInteger(n)) return null;
  return m[1] === '-' ? -n : n;
}

/** The locale's decimal and grouping marks. */
function marks(): { decimal: string; group: string } {
  const parts = new Intl.NumberFormat(undefined).formatToParts(12345.6);
  return { decimal: parts.find((p) => p.type === 'decimal')?.value ?? '.', group: parts.find((p) => p.type === 'group')?.value ?? ',' };
}

/**
 * Typed text to minor units. Accepts the locale's grouping only between
 * thousands ("12,345.67"), a leading minus, and at most the currency's
 * decimals. Returns null for anything else.
 */
export function parseMoney(text: string, currency: string): number | null {
  const e = exponent(currency);
  const { decimal, group } = marks();
  let s = text.trim().replace(/\s/g, '');
  if (s === '') return null;
  // Drop a currency symbol or code typed in front or behind.
  s = s.replace(/^[^\d\-.,]+/, '').replace(/[^\d.,]+$/, '');
  let neg = false;
  if (s.startsWith('-')) {
    neg = true;
    s = s.slice(1);
  }
  const dec = decimal === ',' ? ',' : '.';
  const grp = group === '.' ? '.' : group === ',' ? ',' : group;
  let intPart = s;
  let frac = '';
  const di = s.lastIndexOf(dec);
  if (di >= 0) {
    intPart = s.slice(0, di);
    frac = s.slice(di + 1);
  }
  if (intPart.includes(grp)) {
    // Groups of exactly three after the first.
    if (!new RegExp(`^\\d{1,3}(\\${grp}\\d{3})+$`).test(intPart)) return null;
    intPart = intPart.split(grp).join('');
  }
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(frac)) return null;
  if (intPart === '' && frac === '') return null;
  if (frac.length > e) return null;
  const digits = (intPart === '' ? '0' : intPart) + frac.padEnd(e, '0');
  const n = Number(digits);
  if (!Number.isSafeInteger(n)) return null;
  return neg ? -n : n;
}

/** Minor units back to the text a person would type (no symbol, locale marks, no grouping). */
export function moneyInputText(minor: number | null | undefined, currency: string): string {
  if (minor === null || minor === undefined) return '';
  const e = exponent(currency);
  const neg = minor < 0;
  const s = String(Math.abs(Math.trunc(minor))).padStart(e + 1, '0');
  const intPart = e === 0 ? s : s.slice(0, -e);
  const frac = e === 0 ? '' : s.slice(-e);
  const { decimal } = marks();
  return (neg ? '-' : '') + intPart + (frac !== '' ? decimal + frac : '');
}

/** The symbol for a currency in the viewer's locale ("RM", "¥", "S$"). */
export function currencySymbol(currency: string): string {
  try {
    const parts = new Intl.NumberFormat(undefined, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).formatToParts(0);
    return parts.find((p) => p.type === 'currency')?.value ?? currency;
  } catch {
    return currency;
  }
}
