/**
 * Numbers on screen. Quantities show up to 3 decimals; money shows in the
 * app currency with its own decimals. Every number reads "1,234.50": ","
 * separates thousands and "." is the decimal point, the same point the
 * keypad types, whatever the browser's language. Typed input is normalized
 * to the plain "1234.5" form the operations accept.
 *
 * Values arrive from the operations in ten-thousandths of the currency unit
 * (`value`, `unit_cost_e4`) or as plain text in major units (`unit_cost`).
 */

export const NUMBER_LOCALE = 'en-US';

const ZERO = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
const THREE = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

export function decimalsOf(currency: string): number {
  if (ZERO.has(currency)) return 0;
  if (THREE.has(currency)) return 3;
  return 2;
}

const qtyFormat = new Intl.NumberFormat(NUMBER_LOCALE, { maximumFractionDigits: 3 });
const compactFormat = new Intl.NumberFormat(NUMBER_LOCALE, { notation: 'compact', maximumFractionDigits: 1 });

/** 1234.5 -> "1,234.5". A true minus sign reads better than a hyphen. */
export function qty(n: number): string {
  return qtyFormat.format(n).replace('-', '−');
}

/** 1234.5 with a sign: "+1,234.5" / "−3". */
export function signed(n: number): string {
  return (n > 0 ? '+' : '') + qty(n);
}

/** Big numbers short: 12,400 -> "12.4K". */
export function compact(n: number): string {
  return Math.abs(n) < 10000 ? qty(n) : compactFormat.format(n);
}

const moneyFormats = new Map<string, Intl.NumberFormat>();

function moneyFormat(currency: string, digits: number): Intl.NumberFormat {
  const key = `${currency}:${digits}`;
  let f = moneyFormats.get(key);
  if (f === undefined) {
    try {
      f = new Intl.NumberFormat(NUMBER_LOCALE, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits });
    } catch {
      f = new Intl.NumberFormat(NUMBER_LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    }
    moneyFormats.set(key, f);
  }
  return f;
}

/** A value in ten-thousandths -> "$1,234.50" (compact drops the decimals). */
export function money(e4: number, currency: string, compactView = false): string {
  const d = compactView ? 0 : decimalsOf(currency);
  return moneyFormat(currency, d).format(e4 / 10000).replace('-', '−');
}

/** A unit cost as plain text ("0.034") -> "$0.034"; at least the currency's decimals. */
export function unitCost(text: string, currency: string): string {
  const n = Number(text);
  if (!Number.isFinite(n)) return text;
  const frac = text.includes('.') ? (text.split('.')[1] ?? '').length : 0;
  const d = Math.min(4, Math.max(decimalsOf(currency), frac));
  return moneyFormat(currency, d).format(n);
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

/**
 * What the user typed -> "1234.5" (or null when it is not a number). "." is
 * the decimal point and "," only separates thousands, as on screen.
 */
export function normalizeNumber(text: string, maxDecimals = 3): string | null {
  const s = text
    .trim()
    .replace(/\s/g, '')
    .replace(/^[^\d.,-]+/, '')
    .replace(/[^\d.,]+$/, '');
  if (!/^(\d{1,3}(,\d{3})+|\d*)(\.\d*)?$/.test(s) || s === '' || s === '.') return null;
  const [whole = '', frac = ''] = s.split('.');
  if (frac.length > maxDecimals) return null;
  const intPart = whole.replace(/,/g, '') || '0';
  return frac === '' ? intPart : `${intPart}.${frac}`;
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

/** "1 item" / "3 items". */
export function plural(n: number, one: string, many?: string): string {
  return `${qty(n)} ${n === 1 ? one : (many ?? `${one}s`)}`;
}
