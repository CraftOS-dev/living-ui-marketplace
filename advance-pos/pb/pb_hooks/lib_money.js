/// <reference path="../pb_data/types.d.ts" />
/**
 * Money: every amount is whole minor units (cents for USD, yen for JPY,
 * fils for BHD). Operations read amounts in major units as text ("4.50")
 * and convert them exactly, digit by digit, never through a float
 * multiplication; answers carry the minor integer and a `*_text` reading.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}

/** Round half away from zero to a whole number (money is never rounded toward even). */
function round(x) {
  if (!isFinite(x)) return 0;
  const a = Math.abs(x);
  // A tiny nudge absorbs binary noise like 2.675 stored as 2.67499999.
  const r = Math.floor(a + 0.5 + 1e-9);
  return x < 0 ? -r : r;
}

/** The store's currency digits (0 to 3). */
function digits(settings) {
  const d = settings.getInt('currency_digits');
  return d >= 0 && d <= 3 ? d : 2;
}

/**
 * A major-unit amount ("4.5", "1,234.56" is refused, 4.5) to minor units.
 * Text is converted digit by digit; a JS number is rounded at the currency's
 * digits first. More decimals than the currency has are refused.
 */
function toMinor(value, d, name) {
  const util = u();
  const label = name || 'amount';
  if (typeof value === 'number') {
    if (!isFinite(value)) throw util.fail(400, label + ' must be a number');
    const scaled = round(value * Math.pow(10, d));
    if (Math.abs(scaled / Math.pow(10, d) - value) > 1e-6) throw util.fail(400, label + ' has more decimals than the currency (' + d + ')');
    return scaled;
  }
  const s = String(value === undefined || value === null ? '' : value).trim();
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(s) || /^(-)?()\.(\d+)$/.exec(s);
  if (m === null) throw util.fail(400, label + ' must be an amount like 4.50 (a "." for decimals, no thousands separators); got "' + s + '"');
  const whole = m[2] === '' ? '0' : m[2];
  let frac = m[3] || '';
  if (frac.length > d) {
    if (/^0*$/.test(frac.slice(d))) frac = frac.slice(0, d);
    else throw util.fail(400, label + ' has more decimals than the currency allows (' + d + '): ' + s);
  }
  while (frac.length < d) frac += '0';
  const n = Number(whole + frac);
  if (!isFinite(n) || n > 9e15) throw util.fail(400, label + ' is too large');
  return m[1] === '-' ? -n : n;
}

/** A money param in major units, as minor units; null when absent. */
function param(p, name, d, opts) {
  const util = u();
  const o = opts || {};
  if (!util.has(p, name) || p[name] === '' || (Array.isArray(p[name]) && p[name][0] === '')) {
    if (o.required) throw util.fail(400, name + ' is required, e.g. ' + name + '=' + (o.example || '4.50'));
    return null;
  }
  const raw = Array.isArray(p[name]) && p[name].length === 1 ? p[name][0] : p[name];
  const v = toMinor(raw, d, name);
  if (o.min !== undefined && v < o.min) throw util.fail(400, name + ' must be at least ' + text(o.min, d));
  if (o.max !== undefined && v > o.max) throw util.fail(400, name + ' must be at most ' + text(o.max, d));
  return v;
}

/** Minor units as a plain major-unit reading: 1234 -> "12.34", -5 -> "-0.05". */
function plain(minor, d) {
  const n = round(Number(minor) || 0);
  const neg = n < 0;
  let s = String(Math.abs(n));
  if (d > 0) {
    while (s.length <= d) s = '0' + s;
    s = s.slice(0, s.length - d) + '.' + s.slice(s.length - d);
  }
  return (neg ? '-' : '') + s;
}

/** Minor units as a person reads them, with the currency code and thousands commas: "USD 1,234.56". */
function text(minor, d, currency) {
  const p = plain(minor, d);
  const neg = p.charAt(0) === '-';
  const body = neg ? p.slice(1) : p;
  const parts = body.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + (currency ? currency + ' ' : '') + parts.join('.');
}

/** The money reader for one store: its digits and currency, bound once. */
function of(settings) {
  const d = digits(settings);
  const cur = settings.getString('currency') || 'USD';
  return {
    digits: d,
    currency: cur,
    param: (p, name, opts) => param(p, name, d, opts),
    toMinor: (v, name) => toMinor(v, d, name),
    text: (minor) => text(minor, d, cur),
    plain: (minor) => plain(minor, d),
    /** One major unit in minor units (100 for USD). */
    unit: Math.pow(10, d),
  };
}

/** Split `total` over `weights` in proportion, largest remainder first, so the parts add up exactly. */
function allocate(total, weights) {
  const n = weights.length;
  const out = new Array(n).fill(0);
  const sum = weights.reduce((a, w) => a + Math.abs(w), 0);
  if (n === 0 || sum === 0 || total === 0) return out;
  const sign = total < 0 ? -1 : 1;
  const t = Math.abs(total);
  const rem = [];
  let given = 0;
  for (let i = 0; i < n; i++) {
    const exact = (t * Math.abs(weights[i])) / sum;
    const base = Math.floor(exact + 1e-9);
    out[i] = base;
    given += base;
    rem.push({ i: i, r: exact - base });
  }
  rem.sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; given < t && k < rem.length; k++, given++) out[rem[k].i] += 1;
  return out.map((x) => sign * x);
}

module.exports = { round: round, digits: digits, toMinor: toMinor, param: param, plain: plain, text: text, of: of, allocate: allocate };
