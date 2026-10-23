/// <reference path="../pb_data/types.d.ts" />
/**
 * Money arithmetic, exact.
 *
 * - Amounts are integers of a currency's minor unit (cents for USD, yen for
 *   JPY, fils for KWD).
 * - Unit prices and costs are integers of ten-thousandths of the major unit
 *   ("e4": 0.034 is 340), so a screw keeps its price.
 * - Exchange rates are integers of 1e-8 ("e8"): how many base units one unit
 *   of the document currency is worth. A base-currency document has 1e8.
 * - Tax rates and discounts are basis points (600 is 6%).
 * - Quantities are numbers with at most 3 decimals.
 *
 * Text is parsed on the string, never through a float. Products that can
 * pass 2^53 are computed with BigInt and rounded half away from zero.
 */

const ZERO = ['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'];
const THREE = ['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND'];
const E8 = 100000000;

/** Decimal places of a currency's minor unit. */
function exp(currency) {
  const c = String(currency || '').toUpperCase();
  if (ZERO.indexOf(c) >= 0) return 0;
  if (THREE.indexOf(c) >= 0) return 3;
  return 2;
}

function pow10(n) {
  let v = 1;
  for (let i = 0; i < n; i++) v *= 10;
  return v;
}

function bpow10(n) {
  let v = BigInt(1);
  for (let i = 0; i < n; i++) v = v * BigInt(10);
  return v;
}

/** round(a * b / c) half away from zero, exact, for integers (Number or BigInt). */
function mulDiv(a, b, c) {
  const A = BigInt(a);
  const B = BigInt(b);
  const C = BigInt(c);
  if (C === BigInt(0)) throw new Error('division by zero');
  let num = A * B;
  let den = C;
  if (den < BigInt(0)) {
    num = -num;
    den = -den;
  }
  const neg = num < BigInt(0);
  const abs = neg ? -num : num;
  let q = abs / den;
  const r = abs - q * den;
  if (r * BigInt(2) >= den) q = q + BigInt(1);
  return Number(neg ? -q : q);
}

/**
 * Parse plain decimal text into an integer scaled by `places` decimals.
 * Accepts "1234", "1234.5", ".5", "1,234.50" (commas only between thousands),
 * an optional leading currency sign or code, and a leading minus when
 * `allowNegative`. Extra decimals are rounded half up. Returns null when the
 * text is not such a number.
 */
function parseScaled(text, places, allowNegative) {
  let s = String(text === undefined || text === null ? '' : text).trim();
  if (s === '') return null;
  let neg = false;
  if (s.charAt(0) === '-' || s.charAt(0) === '−') {
    neg = true;
    s = s.slice(1).trim();
  }
  // A leading currency sign or code: "$12", "RM 12", "USD12".
  s = s.replace(/^[^\d.,-]+/, '').trim();
  if (s.charAt(0) === '-') {
    neg = !neg;
    s = s.slice(1);
  }
  if (neg && !allowNegative) return null;
  if (!/^(\d{1,3}(,\d{3})+|\d+|)(\.\d*)?$/.test(s) || s === '' || s === '.') return null;
  const parts = s.replace(/,/g, '').split('.');
  const whole = parts[0] === '' ? '0' : parts[0];
  let frac = parts.length > 1 ? parts[1] : '';
  let roundUp = false;
  if (frac.length > places) {
    roundUp = Number(frac.charAt(places)) >= 5;
    frac = frac.slice(0, places);
  }
  while (frac.length < places) frac += '0';
  let n = Number(whole + frac);
  if (roundUp) n += 1;
  if (!Number.isSafeInteger(n)) return null;
  return neg ? -n : n;
}

/** Integer scaled by `places` -> plain text with at least `minPlaces` decimals ("1234.5"). */
function scaledText(n, places, minPlaces) {
  const neg = n < 0;
  let digits = String(Math.abs(Math.round(n)));
  while (digits.length <= places) digits = '0' + digits;
  const whole = places > 0 ? digits.slice(0, digits.length - places) : digits;
  let frac = places > 0 ? digits.slice(digits.length - places) : '';
  const keep = Math.max(0, Math.min(places, minPlaces === undefined ? places : minPlaces));
  while (frac.length > keep && frac.charAt(frac.length - 1) === '0') frac = frac.slice(0, -1);
  return (neg ? '-' : '') + whole + (frac !== '' ? '.' + frac : '');
}

/* ------------------------------------------------------------ amounts */

/** A currency code written in front of an amount ("EUR 450"), upper case, or "". */
function codeOf(text) {
  const m = /^[-\u2212]?\s*([A-Za-z]{3})(?=\s*[-\u2212]?[\d.,])/.exec(String(text === undefined || text === null ? '' : text).trim());
  return m === null ? '' : m[1].toUpperCase();
}

/**
 * "1,234.50" in `currency` -> minor units, or null. Stricter than the other
 * scales: an amount never has more decimals than its currency (12.505 is not
 * an amount in SGD, it is a typo), and a currency code written in front must
 * be this currency's ("EUR 450" is not 450 SGD). Signs like "$" are fine.
 */
function toMinor(text, currency, allowNegative) {
  const s = String(text === undefined || text === null ? '' : text).trim();
  const code = codeOf(s);
  if (code !== '' && code !== String(currency).toUpperCase()) return null;
  const dec = /\.(\d+)$/.exec(s);
  if (dec !== null && dec[1].length > exp(currency)) return null;
  return parseScaled(s, exp(currency), allowNegative === true);
}

/** Minor units -> "1234.50" (always the currency's decimals). */
function minorText(minor, currency) {
  const e = exp(currency);
  return scaledText(minor, e, e);
}

/** Thousands grouping by hand (Goja mishandles the lookahead regex). */
function group(digits) {
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits.charAt(i);
  }
  return out;
}

/** Minor units -> "USD 1,234.50" for messages and the agent. */
function fmt(minor, currency) {
  const t = minorText(minor, currency);
  const neg = t.charAt(0) === '-';
  const body = neg ? t.slice(1) : t;
  const parts = body.split('.');
  return (neg ? '-' : '') + currency + ' ' + group(parts[0]) + (parts.length > 1 ? '.' + parts[1] : '');
}

/* ------------------------------------------------------- prices (e4) */

function toE4(text, allowNegative) {
  return parseScaled(text, 4, allowNegative === true);
}

/** e4 -> plain text with at least the currency's decimals ("0.034", "12.50"). */
function e4Text(e4, currency) {
  return scaledText(e4, 4, currency === undefined ? 2 : exp(currency));
}

/** e4 price -> minor units of the currency (rounded). */
function e4ToMinor(e4, currency) {
  return mulDiv(e4, pow10(exp(currency)), 10000);
}

/** minor units -> e4 price. */
function minorToE4(minor, currency) {
  return mulDiv(minor, 10000, pow10(exp(currency)));
}

/* ------------------------------------------------------- rates (e8) */

function toE8(text) {
  const n = parseScaled(text, 8, false);
  return n === null || n <= 0 ? null : n;
}

function e8Text(e8) {
  return scaledText(e8, 8, 0);
}

/**
 * An amount in `fromCur` minor units -> `toCur` minor units at `fxE8`
 * (to-units per one from-unit).
 */
function convert(minor, fromCur, toCur, fxE8) {
  if (fromCur === toCur && fxE8 === E8) return minor;
  // minor / 10^ef * fx / 1e8 * 10^et
  const ef = exp(fromCur);
  const et = exp(toCur);
  return mulDivBig(BigInt(minor) * BigInt(fxE8) * bpow10(et), bpow10(ef) * BigInt(E8));
}

/** round(n / d) half away from zero for BigInts; returns Number. */
function mulDivBig(n, d) {
  const neg = (n < BigInt(0)) !== (d < BigInt(0));
  const an = n < BigInt(0) ? -n : n;
  const ad = d < BigInt(0) ? -d : d;
  let q = an / ad;
  if ((an - q * ad) * BigInt(2) >= ad) q = q + BigInt(1);
  return Number(neg ? -q : q);
}

/* -------------------------------------------------------- quantities */

/** A quantity (number, <= 3 decimals) as integer thousandths. */
function milli(qty) {
  return Math.round(Number(qty) * 1000);
}

function q3(x) {
  return Math.round(Number(x) * 1000) / 1000;
}

/**
 * One document line, exactly: qty x unit price (e4) less discount (bp), with
 * tax at `rateBp`, in the document currency's minor units.
 *
 * inclusive: the price includes tax; the net is backed out of the gross.
 * Returns { gross, discount, net, tax, total } (gross and discount before tax).
 */
function line(qty, priceE4, discountBp, rateBp, inclusive, currency) {
  const e = exp(currency);
  const den = BigInt(1000) * bpow10(4 - e) * BigInt(10000);
  const q = BigInt(milli(qty));
  const p = BigInt(priceE4);
  const d = BigInt(discountBp || 0);
  const gross = mulDivBig(q * p * BigInt(10000), den);
  const afterDiscount = mulDivBig(q * p * (BigInt(10000) - d), den);
  const discount = gross - afterDiscount;
  const rate = rateBp || 0;
  let net;
  let tax;
  if (inclusive) {
    net = rate > 0 ? mulDiv(afterDiscount, 10000, 10000 + rate) : afterDiscount;
    tax = afterDiscount - net;
  } else {
    net = afterDiscount;
    tax = rate > 0 ? mulDiv(net, rate, 10000) : 0;
  }
  return { gross: gross, discount: discount, net: net, tax: tax, total: net + tax };
}

/** Stock value of `qty` at a unit cost in e4, in base minor units. */
function stockValue(qty, costE4, currency) {
  const e = exp(currency);
  return mulDivBig(BigInt(milli(qty)) * BigInt(costE4), BigInt(1000) * bpow10(4 - e));
}

/** Unit cost (e4) of `value` minor units over `qty`. */
function unitCostE4(value, qty, currency) {
  const m = milli(qty);
  if (m === 0) return 0;
  const e = exp(currency);
  return Math.max(0, mulDivBig(BigInt(value) * BigInt(1000) * bpow10(4 - e), BigInt(m)));
}

/** Share of `value` for `part` of `whole` quantity (exact proportion, rounded). */
function share(value, part, whole) {
  const w = milli(whole);
  if (w === 0) return 0;
  return mulDivBig(BigInt(value) * BigInt(milli(part)), BigInt(w));
}

/** Basis points from percent text ("6", "6.5", "0.25"); null when invalid. */
function percentToBp(text) {
  const n = parseScaled(text, 2, false);
  if (n === null) return null;
  return n;
}

function bpText(bp) {
  return scaledText(bp, 2, 0);
}

module.exports = {
  codeOf: codeOf,
  E8: E8,
  exp: exp,
  pow10: pow10,
  mulDiv: mulDiv,
  parseScaled: parseScaled,
  scaledText: scaledText,
  toMinor: toMinor,
  minorText: minorText,
  group: group,
  fmt: fmt,
  toE4: toE4,
  e4Text: e4Text,
  e4ToMinor: e4ToMinor,
  minorToE4: minorToE4,
  toE8: toE8,
  e8Text: e8Text,
  convert: convert,
  milli: milli,
  q3: q3,
  line: line,
  stockValue: stockValue,
  unitCostE4: unitCostE4,
  share: share,
  percentToBp: percentToBp,
  bpText: bpText,
};
