/**
 * Money on screen. Amounts arrive as integer minor units (amount_minor) and
 * are shown with the home currency's own symbol and decimals. Numbers always
 * read "1,234.50": "," separates thousands and "." is the decimal point, the
 * same point the keypad types, whatever the browser's language. Typed input
 * is normalized to the plain "1234.50" form the operations accept.
 */

/** Number layout for every amount on screen: "," for thousands, "." for decimals. */
export const NUMBER_LOCALE = 'en-US';

const ZERO = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
const THREE = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

export function decimalsOf(currency: string): number {
  if (ZERO.has(currency)) return 0;
  if (THREE.has(currency)) return 3;
  return 2;
}

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: string, compact: boolean): Intl.NumberFormat {
  const key = currency + (compact ? ':c' : '');
  let f = formatters.get(key);
  if (f === undefined) {
    const d = decimalsOf(currency);
    try {
      f = new Intl.NumberFormat(NUMBER_LOCALE, {
        style: 'currency',
        currency,
        minimumFractionDigits: compact ? 0 : d,
        maximumFractionDigits: compact ? 0 : d,
      });
    } catch {
      f = new Intl.NumberFormat(NUMBER_LOCALE, { minimumFractionDigits: d, maximumFractionDigits: d });
    }
    formatters.set(key, f);
  }
  return f;
}

/** 123450 USD -> "$1,234.50". compact drops the decimals. */
export function money(minor: number, currency: string, compact = false): string {
  const d = decimalsOf(currency);
  const s = formatter(currency, compact).format(minor / 10 ** d);
  // A true minus sign reads better than a hyphen next to digits.
  return s.replace('-', '−');
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
 * What the user typed -> "1234.50" (or null when it is not an amount).
 * "." is the decimal point and "," only separates thousands, as on screen:
 * "1,234.50", "1234.5", ".5" and "$12" are amounts; "12,50" (a comma that is
 * not between thousands) is not, so it is never misread.
 */
export function normalizeAmount(text: string, decimals: number): string | null {
  const s = text
    .trim()
    .replace(/\s/g, '')
    .replace(/^[^\d.,]+/, '')
    .replace(/[^\d.,]+$/, '');
  if (!/^(\d{1,3}(,\d{3})+|\d*)(\.\d*)?$/.test(s)) return null;
  const [whole = '', frac = ''] = s.split('.');
  const intPart = whole.replace(/,/g, '') || '0';
  if (frac.length > decimals) return null;
  const value = frac === '' ? intPart : `${intPart}.${frac}`;
  return Number(value) > 0 ? value : null;
}

/** Minor units -> "1,234.50" for an amount field (normalizeAmount reads it back). */
export function fieldAmount(minor: number, currency: string): string {
  const d = decimalsOf(currency);
  return new Intl.NumberFormat(NUMBER_LOCALE, { minimumFractionDigits: d, maximumFractionDigits: d }).format(minor / 10 ** d);
}

/** Minor units -> the plain "1234.50" form (for editing an existing amount). */
export function plainAmount(minor: number, currency: string): string {
  const d = decimalsOf(currency);
  if (d === 0) return String(minor);
  const s = String(Math.abs(minor)).padStart(d + 1, '0');
  return `${s.slice(0, s.length - d)}.${s.slice(s.length - d)}`;
}

/** The common currencies offered in Settings (any ISO code is accepted by the app). */
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
