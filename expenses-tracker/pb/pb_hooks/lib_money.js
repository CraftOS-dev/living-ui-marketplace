/// <reference path="../pb_data/types.d.ts" />
/**
 * Money as integers of the currency's minor unit (ISO 4217 exponent).
 *
 * Parsing is done on the decimal STRING, never through a float, so "0.10"
 * plus "0.20" is exactly 30 cents. The CLI contract is strict: digits with
 * an optional "." decimal point and no grouping ("1234.50"); the UI
 * normalizes what the user typed before sending.
 */

// Currencies whose minor unit is not 1/100 (ISO 4217). Everything else: 2.
const EXPONENT = {
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0, PYG: 0,
  RWF: 0, UGX: 0, UYI: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
};

function exponent(code) {
  const c = String(code || '').toUpperCase();
  return Object.prototype.hasOwnProperty.call(EXPONENT, c) ? EXPONENT[c] : 2;
}

function isCurrency(code) {
  return typeof code === 'string' && /^[A-Z]{3}$/.test(code);
}

/**
 * "12.5" -> 1250 (exp 2). Returns null for anything that is not a plain
 * non-negative decimal. Extra fraction digits round half up.
 */
function toMinor(text, exp) {
  const s = String(text).trim();
  if (!/^\d+(\.\d+)?$/.test(s) && !/^\.\d+$/.test(s)) return null;
  const parts = s.split('.');
  const whole = parts[0] === '' ? '0' : parts[0];
  let frac = parts.length > 1 ? parts[1] : '';
  let roundUp = false;
  if (frac.length > exp) {
    roundUp = Number(frac.charAt(exp)) >= 5;
    frac = frac.slice(0, exp);
  }
  while (frac.length < exp) frac += '0';
  let n = Number(whole + frac);
  if (roundUp) n += 1;
  if (!Number.isSafeInteger(n)) return null;
  return n;
}

/** 1250 (exp 2) -> "12.50"; plain, no grouping (what the CLI reads back). */
function toMajor(minor, exp) {
  const neg = minor < 0;
  const abs = String(Math.abs(Math.round(minor)));
  if (exp === 0) return (neg ? '-' : '') + abs;
  const padded = abs.length <= exp ? '0'.repeat(exp - abs.length + 1) + abs : abs;
  const whole = padded.slice(0, padded.length - exp);
  const frac = padded.slice(padded.length - exp);
  return (neg ? '-' : '') + whole + '.' + frac;
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

/** 123450 USD -> "USD 1,234.50" (for human-readable op messages). */
function format(minor, code) {
  const major = toMajor(minor, exponent(code));
  const neg = major.charAt(0) === '-';
  const body = neg ? major.slice(1) : major;
  const parts = body.split('.');
  return code + ' ' + (neg ? '-' : '') + group(parts[0]) + (parts.length > 1 ? '.' + parts[1] : '');
}

/** Read an amount param into minor units of `code`, or throw a 400 naming it. */
function amountParam(p, name, code, required) {
  const u = require(`${__hooks}/lib_util.js`);
  const raw = u.str(p, name, '');
  if (raw === '') {
    if (required) throw u.fail(400, name + ' is required, e.g. ' + name + '=12.50');
    return null;
  }
  const minor = toMinor(raw, exponent(code));
  if (minor === null) {
    throw u.fail(
      400,
      name + ' must be a plain positive number with "." as the decimal point and no thousands separators, e.g. 1234.50 (got "' + raw + '")',
    );
  }
  return minor;
}

module.exports = {
  exponent: exponent,
  isCurrency: isCurrency,
  toMinor: toMinor,
  toMajor: toMajor,
  format: format,
  amountParam: amountParam,
};
