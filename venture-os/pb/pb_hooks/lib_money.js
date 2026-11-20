/// <reference path="../pb_data/types.d.ts" />
/**
 * Money, exact. Amounts are integers of a currency's minor unit (cents for
 * USD, yen for JPY, fils for KWD). Text is parsed on the string, never
 * through a float; products that can pass 2^53 use BigInt and round half
 * away from zero. Pure JavaScript: Node (tests, the engine) loads it too.
 */

const ZERO = ['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'];
const THREE = ['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND'];
// Currencies stored with 2 decimals but shown without them (no coins in use).
const SHOWN_ZERO = ['IDR'];

/** Decimal places of a currency's minor unit. */
function exponent(currency) {
  const c = String(currency || '').toUpperCase();
  if (ZERO.indexOf(c) >= 0) return 0;
  if (THREE.indexOf(c) >= 0) return 3;
  return 2;
}

/** Decimal places people see (IDR: 0). */
function shown(currency) {
  const c = String(currency || '').toUpperCase();
  if (SHOWN_ZERO.indexOf(c) >= 0) return 0;
  return exponent(c);
}

function pow10(n) {
  let v = 1;
  for (let i = 0; i < n; i++) v *= 10;
  return v;
}

/** round(a * b / c) half away from zero, exact for integers. */
function mulDiv(a, b, c) {
  const A = BigInt(a);
  const B = BigInt(b);
  let C = BigInt(c);
  if (C === BigInt(0)) throw new Error('division by zero');
  let n = A * B;
  if (C < BigInt(0)) {
    n = -n;
    C = -C;
  }
  const neg = n < BigInt(0);
  const abs = neg ? -n : n;
  let q = abs / C;
  if ((abs - q * C) * BigInt(2) >= C) q = q + BigInt(1);
  return Number(neg ? -q : q);
}

/** Plain decimal text -> integer scaled by `places` (null when not such a number). Commas only between thousands. */
function parseScaled(textValue, places, allowNegative) {
  let s = String(textValue === undefined || textValue === null ? '' : textValue).trim();
  if (s === '') return null;
  let neg = false;
  if (s.charAt(0) === '-' || s.charAt(0) === '−') {
    neg = true;
    s = s.slice(1).trim();
  }
  s = s.replace(/^[^\d.,-]+/, '').trim();
  if (neg && !allowNegative) return null;
  if (!/^(\d{1,3}(,\d{3})+|\d+|)(\.\d*)?$/.test(s) || s === '' || s === '.') return null;
  const parts = s.replace(/,/g, '').split('.');
  const whole = parts[0] === '' ? '0' : parts[0];
  let frac = parts.length > 1 ? parts[1] : '';
  let up = false;
  if (frac.length > places) {
    up = Number(frac.charAt(places)) >= 5;
    frac = frac.slice(0, places);
  }
  while (frac.length < places) frac += '0';
  let n = Number(whole + frac);
  if (up) n += 1;
  if (!Number.isSafeInteger(n)) return null;
  return neg ? -n : n;
}

/** A currency code written in front of an amount ("EUR 450"), or "". */
function codeOf(textValue) {
  const m = /^[-−]?\s*([A-Za-z]{3})\s*[-−]?[\d.,]/.exec(String(textValue === undefined || textValue === null ? '' : textValue).trim());
  return m === null ? '' : m[1].toUpperCase();
}

/**
 * "1,234.50" in `currency` -> minor units, or null. An amount never has more
 * decimals than its currency, and a code written in front must be this one.
 */
function toMinor(textValue, currency, allowNegative) {
  const s = String(textValue === undefined || textValue === null ? '' : textValue).trim();
  const code = codeOf(s);
  if (code !== '' && code !== String(currency).toUpperCase()) return null;
  const dec = /\.(\d+)$/.exec(s);
  if (dec !== null && dec[1].length > exponent(currency)) return null;
  return parseScaled(s, exponent(currency), allowNegative === true);
}

/** Minor units -> major-unit text "1234.50" (the currency's decimals). */
function fromMinor(minor, currency) {
  const e = exponent(currency);
  const neg = minor < 0;
  let digits = String(Math.abs(Math.round(minor)));
  while (digits.length <= e) digits = '0' + digits;
  const whole = e > 0 ? digits.slice(0, digits.length - e) : digits;
  const frac = e > 0 ? digits.slice(digits.length - e) : '';
  return (neg ? '-' : '') + whole + (frac !== '' ? '.' + frac : '');
}

/** Minor units -> a major-unit number (for the engine and charts; never stored). */
function toMajor(minor, currency) {
  return Number(fromMinor(minor, currency));
}

/** Major-unit number -> minor units, rounded half away from zero at the currency's exponent. */
function majorToMinor(major, currency) {
  const e = exponent(currency);
  const scaled = Number(major) * pow10(e);
  const sign = scaled < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(scaled) + 1e-9);
}

function group(digits) {
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits.charAt(i);
  }
  return out;
}

/** Minor units -> "USD 1,234.50" for messages and your AI agent. */
function format(minor, currency) {
  const t = fromMinor(minor, currency);
  const neg = t.charAt(0) === '-';
  const body = neg ? t.slice(1) : t;
  const parts = body.split('.');
  let frac = parts.length > 1 ? parts[1] : '';
  if (shown(currency) === 0) frac = '';
  return (neg ? '-' : '') + String(currency).toUpperCase() + ' ' + group(parts[0]) + (frac !== '' ? '.' + frac : '');
}

/**
 * Round a fractional minor amount to whole minor units.
 * mode: half_up (away from zero, default), half_even, up (away from zero), down (toward zero).
 */
function round(minorFloat, mode) {
  const x = Number(minorFloat);
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const m = mode || 'half_up';
  const eps = 1e-9 * Math.max(1, a);
  if (m === 'down') return sign * Math.floor(a + eps);
  if (m === 'up') return sign * Math.ceil(a - eps);
  const fl = Math.floor(a);
  const diff = a - fl;
  if (m === 'half_even') {
    if (Math.abs(diff - 0.5) <= eps) return sign * (fl % 2 === 0 ? fl : fl + 1);
    return sign * (diff > 0.5 ? fl + 1 : fl);
  }
  return sign * (diff + eps >= 0.5 ? fl + 1 : fl);
}

/** Sum of minor amounts (integers). */
function add() {
  let t = 0;
  for (let i = 0; i < arguments.length; i++) {
    const v = arguments[i];
    if (Array.isArray(v)) for (const x of v) t += Math.round(Number(x) || 0);
    else t += Math.round(Number(v) || 0);
  }
  return t;
}

/** minor x rate (a decimal number or decimal text such as "0.062"), rounded with `mode` (half_up). */
function mul(minor, rate, mode) {
  const r = String(rate);
  if (/^-?\d+(\.\d+)?$/.test(r)) {
    const neg = r.charAt(0) === '-';
    const body = neg ? r.slice(1) : r;
    const parts = body.split('.');
    const places = parts.length > 1 ? parts[1].length : 0;
    const scaled = Number(parts[0] + (parts[1] || ''));
    if (Number.isSafeInteger(scaled) && places <= 12 && (mode === undefined || mode === 'half_up')) return (neg ? -1 : 1) * mulDiv(minor, scaled, pow10(places));
  }
  return round(Number(minor) * Number(rate), mode);
}

/**
 * Split `minor` into parts proportional to `parts` (numbers), exactly: the
 * pieces sum to `minor`; leftover units go to the largest remainders.
 */
function allocate(minor, parts) {
  const ws = parts.map((p) => Math.max(0, Number(p) || 0));
  const total = ws.reduce((a, b) => a + b, 0);
  if (total === 0) return ws.map(() => 0);
  const sign = minor < 0 ? -1 : 1;
  const amount = Math.abs(Math.round(minor));
  const out = [];
  const rem = [];
  let used = 0;
  ws.forEach((w, i) => {
    const exact = (amount * w) / total;
    const fl = Math.floor(exact);
    out.push(fl);
    rem.push({ i: i, r: exact - fl });
    used += fl;
  });
  rem.sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; k < amount - used; k++) out[rem[k % rem.length].i] += 1;
  return out.map((x) => sign * x);
}

/** minor x ppm / 1,000,000, exact, half away from zero. */
function mulPpm(minor, ppm) {
  return mulDiv(Math.round(Number(minor)), Math.round(Number(ppm)), 1000000);
}

/** A value scaled by 10^8 as plain decimal text (151.2345 for 15123450000). */
function e8Text(v) {
  const n = Math.round(Number(v));
  const neg = n < 0;
  let d = String(Math.abs(n));
  while (d.length <= 8) d = '0' + d;
  let frac = d.slice(d.length - 8).replace(/0+$/, '');
  return (neg ? '-' : '') + d.slice(0, d.length - 8) + (frac !== '' ? '.' + frac : '');
}

/** Millionths as percent text (25000 -> "2.5"). */
function ppmText(v) {
  const n = Math.round(Number(v));
  const neg = n < 0;
  let d = String(Math.abs(n));
  while (d.length <= 4) d = '0' + d;
  const frac = d.slice(d.length - 4).replace(/0+$/, '');
  return (neg ? '-' : '') + d.slice(0, d.length - 4) + (frac !== '' ? '.' + frac : '');
}

module.exports = {
  mulPpm: mulPpm,
  e8Text: e8Text,
  ppmText: ppmText,
  ZERO: ZERO,
  THREE: THREE,
  exponent: exponent,
  shown: shown,
  pow10: pow10,
  mulDiv: mulDiv,
  parseScaled: parseScaled,
  codeOf: codeOf,
  toMinor: toMinor,
  fromMinor: fromMinor,
  toMajor: toMajor,
  majorToMinor: majorToMinor,
  group: group,
  format: format,
  round: round,
  add: add,
  mul: mul,
  allocate: allocate,
};
