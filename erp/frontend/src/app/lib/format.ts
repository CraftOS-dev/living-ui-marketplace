/**
 * Numbers on screen.
 *
 * Money arrives from the operations as whole minor units (cents) of a stated
 * currency: 65400 in SGD is 654.00. Prices and unit costs arrive as plain
 * text in major units ("8.50", "0.0345"). Quantities are plain numbers.
 *
 * Every number reads "1,234.50": "," separates thousands and "." is the
 * decimal point, the same point the keypad types, whatever the browser's
 * language. Typed input is normalized to the plain "1234.5" form the
 * operations accept.
 */

export const NUMBER_LOCALE = 'en-US';

const ZERO = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
const THREE = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

export function decimalsOf(currency: string): number {
  if (ZERO.has(currency)) return 0;
  if (THREE.has(currency)) return 3;
  return 2;
}

const MINUS = '−';

const qtyFormat = new Intl.NumberFormat(NUMBER_LOCALE, { maximumFractionDigits: 3 });
const compactFormat = new Intl.NumberFormat(NUMBER_LOCALE, { notation: 'compact', maximumFractionDigits: 1 });

/** 1234.5 -> "1,234.5". A true minus sign reads better than a hyphen. */
export function qty(n: number): string {
  return qtyFormat.format(n).replace('-', MINUS);
}

/** 1234.5 with a sign: "+1,234.5" / "-3". */
export function signed(n: number): string {
  return (n > 0 ? '+' : '') + qty(n);
}

/** Big numbers short: 12,400 -> "12.4K". */
export function compact(n: number): string {
  return Math.abs(n) < 10000 ? qty(n) : compactFormat.format(n).replace('-', MINUS);
}

const moneyFormats = new Map<string, Intl.NumberFormat>();

function moneyFormat(currency: string, digits: number, symbol: boolean): Intl.NumberFormat {
  const key = `${currency}:${digits}:${symbol ? 1 : 0}`;
  let f = moneyFormats.get(key);
  if (f === undefined) {
    try {
      f = symbol
        ? new Intl.NumberFormat(NUMBER_LOCALE, { style: 'currency', currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: digits, maximumFractionDigits: digits })
        : new Intl.NumberFormat(NUMBER_LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    } catch {
      f = new Intl.NumberFormat(NUMBER_LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    }
    moneyFormats.set(key, f);
  }
  return f;
}

/** Minor units -> "$1,234.50". `compactView` drops the decimals ("$1,235"); `short` shortens big sums ("$12.4K"). */
export function money(minor: number, currency: string, view: 'full' | 'compact' | 'short' = 'full'): string {
  const d = decimalsOf(currency);
  const major = minor / 10 ** d;
  if (view === 'short' && Math.abs(major) >= 10000) {
    const sym = symbolOf(currency);
    return `${major < 0 ? MINUS : ''}${sym}${compactFormat.format(Math.abs(major))}`;
  }
  return moneyFormat(currency, view === 'full' ? d : 0, true).format(major).replace('-', MINUS);
}

/** Minor units -> "1,234.50" without a symbol (tables where the column names the currency). */
export function amount(minor: number, currency: string): string {
  const d = decimalsOf(currency);
  return moneyFormat(currency, d, false).format(minor / 10 ** d).replace('-', MINUS);
}

/** Minor units -> the plain text an input holds ("1234.5" -> "1234.50"). */
export function minorToText(minor: number, currency: string): string {
  const d = decimalsOf(currency);
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 10 ** d);
  const frac = d > 0 ? String(abs % 10 ** d).padStart(d, '0') : '';
  return `${neg ? '-' : ''}${whole}${d > 0 ? `.${frac}` : ''}`;
}

/** A price as text ("0.0345") -> "$0.0345"; at least the currency's decimals. */
export function price(text: string, currency: string): string {
  const n = Number(text);
  if (!Number.isFinite(n)) return text;
  const frac = text.includes('.') ? (text.split('.')[1] ?? '').replace(/0+$/, '').length : 0;
  const d = Math.min(4, Math.max(decimalsOf(currency), frac));
  return moneyFormat(currency, d, true).format(n).replace('-', MINUS);
}

/** The currency's symbol on its own ("$", "¥", "€"). */
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

/** Basis points -> "9%" / "12.5%". */
export function bp(n: number): string {
  return `${qtyFormat.format(n / 100)}%`;
}

/** A share 0..1 -> "42%". */
export function pct(share: number, digits = 0): string {
  return `${(share * 100).toFixed(digits)}%`;
}

/**
 * What the user typed -> "1234.5" (or null when it is not a number). "." is
 * the decimal point and "," only separates thousands, as on screen. A leading
 * minus is kept when `allowNegative`.
 */
export function normalizeNumber(text: string, maxDecimals = 3, allowNegative = false): string | null {
  let s = text.trim().replace(/\s/g, '').replace(MINUS, '-');
  let neg = false;
  if (s.startsWith('-')) {
    if (!allowNegative) return null;
    neg = true;
    s = s.slice(1);
  }
  s = s.replace(/^[^\d.,]+/, '').replace(/[^\d.,]+$/, '');
  if (!/^(\d{1,3}(,\d{3})+|\d*)(\.\d*)?$/.test(s) || s === '' || s === '.') return null;
  const [whole = '', frac = ''] = s.split('.');
  if (frac.length > maxDecimals) return null;
  const intPart = whole.replace(/,/g, '') || '0';
  const out = frac === '' ? intPart : `${intPart}.${frac}`;
  return neg && Number(out) !== 0 ? `-${out}` : out;
}

/** A number for an input field: plain, no grouping ("1234.5"). */
export function plain(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

export const CURRENCIES: string[] = [
  'USD', 'EUR', 'GBP', 'JPY', 'CNY', 'HKD', 'TWD', 'KRW', 'SGD', 'MYR', 'THB', 'IDR', 'PHP', 'VND', 'INR',
  'AUD', 'NZD', 'CAD', 'MXN', 'BRL', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'TRY', 'ZAR', 'AED',
  'SAR', 'ILS',
];

export function currencyName(code: string): string {
  try {
    return new Intl.DisplayNames(undefined, { type: 'currency' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** "1 invoice" / "3 invoices". */
export function plural(n: number, one: string, many?: string): string {
  return `${qty(n)} ${n === 1 ? one : (many ?? `${one}s`)}`;
}

/** Initials for an avatar: "Olivia Owner" -> "OO". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter((p) => p !== '');
  if (parts.length === 0) return '?';
  const a = parts[0]?.[0] ?? '';
  const b = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : (parts[0]?.[1] ?? '');
  return (a + b).toUpperCase();
}

/** Hours as "7.5 h" / "45 min". */
export function hours(h: number): string {
  if (h > 0 && h < 1) return `${Math.round(h * 60)} min`;
  return `${qty(Math.round(h * 100) / 100)} h`;
}
