/// <reference path="../pb_data/types.d.ts" />
/**
 * Money: integer counts of a currency's minor unit (cents), never floats.
 * Each currency's number of decimals comes from ISO 4217 (0 for JPY, 2 for
 * USD, 3 for BHD). Rates and quantities travel as decimal strings; they meet
 * money only in `mul`, which rounds half away from zero once.
 *
 * Tax: computed per line (default) or per document, exclusive or inclusive
 * of the price. Every document stores the tax it computed.
 */

const CURRENCIES = {
  USD: [2, 'US dollar', '$'],
  EUR: [2, 'Euro', '€'],
  GBP: [2, 'Pound sterling', '£'],
  JPY: [0, 'Japanese yen', '¥'],
  CNY: [2, 'Chinese yuan', '¥'],
  HKD: [2, 'Hong Kong dollar', 'HK$'],
  SGD: [2, 'Singapore dollar', 'S$'],
  MYR: [2, 'Malaysian ringgit', 'RM'],
  IDR: [2, 'Indonesian rupiah', 'Rp'],
  THB: [2, 'Thai baht', '฿'],
  PHP: [2, 'Philippine peso', '₱'],
  VND: [0, 'Vietnamese dong', '₫'],
  INR: [2, 'Indian rupee', '₹'],
  KRW: [0, 'South Korean won', '₩'],
  TWD: [2, 'New Taiwan dollar', 'NT$'],
  AUD: [2, 'Australian dollar', 'A$'],
  NZD: [2, 'New Zealand dollar', 'NZ$'],
  CAD: [2, 'Canadian dollar', 'C$'],
  MXN: [2, 'Mexican peso', 'MX$'],
  BRL: [2, 'Brazilian real', 'R$'],
  CHF: [2, 'Swiss franc', 'CHF'],
  SEK: [2, 'Swedish krona', 'kr'],
  NOK: [2, 'Norwegian krone', 'kr'],
  DKK: [2, 'Danish krone', 'kr'],
  PLN: [2, 'Polish zloty', 'zł'],
  CZK: [2, 'Czech koruna', 'Kč'],
  HUF: [2, 'Hungarian forint', 'Ft'],
  TRY: [2, 'Turkish lira', '₺'],
  ZAR: [2, 'South African rand', 'R'],
  AED: [2, 'UAE dirham', 'AED'],
  SAR: [2, 'Saudi riyal', 'SAR'],
  ILS: [2, 'Israeli shekel', '₪'],
  BHD: [3, 'Bahraini dinar', 'BD'],
  KWD: [3, 'Kuwaiti dinar', 'KD'],
  OMR: [3, 'Omani rial', 'OMR'],
  JOD: [3, 'Jordanian dinar', 'JD'],
  NGN: [2, 'Nigerian naira', '₦'],
  KES: [2, 'Kenyan shilling', 'KSh'],
  EGP: [2, 'Egyptian pound', 'E£'],
  CLP: [0, 'Chilean peso', 'CLP$'],
  COP: [2, 'Colombian peso', 'COL$'],
  ARS: [2, 'Argentine peso', 'AR$'],
  PKR: [2, 'Pakistani rupee', '₨'],
  BDT: [2, 'Bangladeshi taka', '৳'],
  LKR: [2, 'Sri Lankan rupee', 'Rs'],
};

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function exponent(code) {
  const c = CURRENCIES[String(code || '').toUpperCase()];
  return c ? c[0] : 2;
}

function known(code) {
  return CURRENCIES[String(code || '').toUpperCase()] !== undefined;
}

function list() {
  return Object.keys(CURRENCIES).map((k) => ({ code: k, name: CURRENCIES[k][1], symbol: CURRENCIES[k][2], exponent: CURRENCIES[k][0] }));
}

/** An integer amount, or a 400 that names the field. */
function int(v, name) {
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  if (!isFinite(n) || Math.floor(n) !== n || Math.abs(n) > 9007199254740991) throw fail(400, (name || 'amount') + ' must be a whole number of minor units (cents), e.g. 1250 for 12.50');
  return n;
}

/**
 * Parse a decimal amount written by a person ("1,234.56", "-12", "(45.00)",
 * "12.5") into minor units of a currency. Exact: never passes through a float.
 */
function parse(text, code, name) {
  const e = exponent(code);
  let s = String(text === undefined || text === null ? '' : text).trim();
  if (s === '') throw fail(400, (name || 'amount') + ' is required');
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/[\s,'_]/g, '').replace(/^[^\d\-+.]+/, '');
  if (s.charAt(0) === '-') {
    neg = !neg;
    s = s.slice(1);
  } else if (s.charAt(0) === '+') s = s.slice(1);
  if (s.slice(-1) === '-') {
    neg = !neg;
    s = s.slice(0, -1);
  }
  if (!/^\d*(\.\d*)?$/.test(s) || s === '' || s === '.') throw fail(400, (name || 'amount') + ' must be a number like 1234.56 (got "' + text + '")');
  const parts = s.split('.');
  const whole = parts[0] || '0';
  let frac = parts[1] || '';
  // Round half away from zero on the first digit past the currency's precision.
  let roundUp = false;
  if (frac.length > e) {
    roundUp = Number(frac.charAt(e)) >= 5;
    frac = frac.slice(0, e);
  }
  while (frac.length < e) frac += '0';
  let n = Number(whole) * Math.pow(10, e) + (e > 0 ? Number(frac) : 0);
  if (roundUp) n += 1;
  if (!isFinite(n) || n > 9007199254740991) throw fail(400, (name || 'amount') + ' is too large');
  return neg ? -n : n;
}

/**
 * An amount from an operation param. Amounts are always written as decimals
 * in the currency ("12.50", 12.5, "-3"), from the UI and from the agent alike.
 */
function amount(v, code, name) {
  if (typeof v === 'number' && !isFinite(v)) throw fail(400, (name || 'amount') + ' must be a number');
  return parse(typeof v === 'number' ? String(v) : v, code, name);
}

/** "1234.56" from 123456 cents. */
function toDecimal(minor, code) {
  const e = exponent(code);
  const neg = minor < 0;
  let s = String(Math.abs(Math.round(minor)));
  if (e === 0) return (neg ? '-' : '') + s;
  while (s.length <= e) s = '0' + s;
  return (neg ? '-' : '') + s.slice(0, s.length - e) + '.' + s.slice(s.length - e);
}

/** "$1,234.56" */
function format(minor, code) {
  const c = CURRENCIES[String(code || '').toUpperCase()];
  const dec = toDecimal(Math.abs(minor), code);
  const parts = dec.split('.');
  // Thousands separators by hand (the hooks' regexp engine doubles them with a lookahead).
  let head = parts[0];
  let groups = '';
  while (head.length > 3) {
    groups = ',' + head.slice(head.length - 3) + groups;
    head = head.slice(0, head.length - 3);
  }
  const whole = head + groups;
  const body = whole + (parts[1] !== undefined ? '.' + parts[1] : '');
  return (minor < 0 ? '-' : '') + (c ? c[2] : String(code || '') + ' ') + body;
}

/** Round half away from zero. */
function round(x) {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

/** A decimal string (rate, quantity, percent) checked and normalized. */
function decimal(v, name, dflt) {
  if (v === undefined || v === null || String(v).trim() === '') {
    if (dflt !== undefined) return dflt;
    throw fail(400, name + ' is required');
  }
  const s = String(v).trim().replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw fail(400, name + ' must be a decimal number like 1.25 (got "' + v + '")');
  return s.replace(/^(-?)0+(\d)/, '$1$2');
}

/** minor × decimal string, rounded once. */
function mul(minor, dec) {
  return round(minor * Number(dec));
}

/** Convert an amount between currencies with a rate "home per unit". */
function toHome(minor, code, homeCode, rate) {
  if (String(code) === String(homeCode)) return minor;
  const shift = Math.pow(10, exponent(homeCode) - exponent(code));
  return round(minor * Number(rate) * shift);
}

/**
 * Tax on a base amount at a percent rate.
 *   exclusive: tax = base × r/100
 *   inclusive: the base includes tax; tax = base × r/(100+r)
 */
function tax(base, ratePct, inclusive) {
  const r = Number(ratePct || '0');
  if (!r) return 0;
  if (inclusive) return round((base * r) / (100 + r));
  return round((base * r) / 100);
}

/**
 * Split `total` across weights (proportional allocation that sums exactly,
 * remainder to the largest parts).
 */
function split(total, weights) {
  const sum = weights.reduce((a, b) => a + Math.abs(b), 0);
  if (sum === 0) return weights.map((_, i) => (i === 0 ? total : 0));
  const raw = weights.map((w) => (total * Math.abs(w)) / sum);
  const out = raw.map((x) => (x < 0 ? Math.ceil(x) : Math.floor(x)));
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((x, i) => [Math.abs(x - out[i]), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; rest !== 0 && k < order.length * 2; k++) {
    const i = order[k % order.length][1];
    const step = rest > 0 ? 1 : -1;
    out[i] += step;
    rest -= step;
  }
  return out;
}

module.exports = {
  CURRENCIES: CURRENCIES,
  fail: fail,
  exponent: exponent,
  known: known,
  list: list,
  int: int,
  parse: parse,
  amount: amount,
  toDecimal: toDecimal,
  format: format,
  round: round,
  decimal: decimal,
  mul: mul,
  toHome: toHome,
  tax: tax,
  split: split,
};
