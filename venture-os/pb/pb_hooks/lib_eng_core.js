/**
 * Venture OS engines: the shared exact arithmetic every engine uses.
 *
 * Pure: no PocketBase globals, no clock, no I/O. The same file loads in
 * PocketBase's Goja (require(`${__hooks}/lib_eng_core.js`)) and in Node
 * (require('.../lib_eng_core.js')). Formulas, units and vectors are in
 * reference/ENGINES.md.
 *
 * Units (SPEC 6): money is integer minor units (`_minor`), ownership and
 * rates are millionths (`_ppm`), prices, FX rates and multiples are scaled
 * by 10^8 (`_e8`), days are 'YYYY-MM-DD' (`_day`).
 *
 * Inputs: an amount is a whole Number or a string of digits (for values past
 * 2^53). Outputs are Numbers, always safe integers. Products are computed with
 * BigInt (always built with BigInt(x), never with the literal suffix syntax)
 * and rounded half away from zero once, at the end.
 *
 * Errors: a malformed input throws an Error with `status` 400, a snake_case
 * `code` and `extra` (the kernel's fail shape), so an op can answer it as is.
 * Unknown data is never an error: engines return null with a `reason`.
 */

const E6 = 1000000;
const E8 = 100000000;
const DAY_MS = 86400000;

const B0 = BigInt(0);
const B1 = BigInt(1);
const B2 = BigInt(2);
const B10 = BigInt(10);
const BE6 = BigInt(E6);
const BE8 = BigInt(E8);

/** The kernel's error shape: Error with status, code and extra. */
function fail(status, message, code, extra) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  if (extra !== undefined) err.extra = extra;
  return err;
}

function isNil(x) {
  return x === null || x === undefined;
}

/* ------------------------------------------------------------- integers */

/** A whole amount (Number, digit string or BigInt) as BigInt; throws invalid_number. */
function big(x, field) {
  if (typeof x === 'bigint') return x;
  if (typeof x === 'number') {
    if (!Number.isInteger(x)) throw fail(400, field + ' must be a whole number', 'invalid_number', { field: field, value: x });
    if (!Number.isSafeInteger(x)) throw fail(400, field + ' is too large for a Number; pass it as a string of digits', 'out_of_range', { field: field });
    return BigInt(x);
  }
  if (typeof x === 'string') {
    const s = x.trim();
    if (/^-?\d{1,30}$/.test(s)) return BigInt(s);
  }
  throw fail(400, field + ' must be a whole number', 'invalid_number', { field: field, value: x === undefined ? null : x });
}

/** big() that also refuses negatives. */
function bigPos(x, field) {
  const b = big(x, field);
  if (b < B0) throw fail(400, field + ' must not be negative', 'invalid_number', { field: field });
  return b;
}

/** BigInt -> Number; throws out_of_range past 2^53. */
function num(b, field) {
  const n = Number(b);
  if (!Number.isSafeInteger(n)) throw fail(400, (field || 'result') + ' is out of the safe integer range', 'out_of_range', { field: field || 'result' });
  return n;
}

function babs(b) {
  return b < B0 ? -b : b;
}

/** round(n / d) half away from zero, BigInt in and out. */
function divRound(n, d) {
  if (d === B0) throw fail(400, 'division by zero', 'invalid_number', {});
  const neg = (n < B0) !== (d < B0);
  const an = babs(n);
  const ad = babs(d);
  let q = an / ad;
  if ((an - q * ad) * B2 >= ad) q = q + B1;
  return neg ? -q : q;
}

/** floor(n / d), BigInt in and out. */
function divFloor(n, d) {
  if (d === B0) throw fail(400, 'division by zero', 'invalid_number', {});
  let nn = n;
  let dd = d;
  if (dd < B0) {
    nn = -nn;
    dd = -dd;
  }
  let q = nn / dd;
  if (nn < B0 && q * dd !== nn) q = q - B1;
  return q;
}

/** round(a * b / c) half away from zero as a Number. */
function mulDiv(a, b, c) {
  return num(divRound(big(a, 'a') * big(b, 'b'), big(c, 'c')));
}

function bpow10(n) {
  let v = B1;
  for (let i = 0; i < n; i++) v = v * B10;
  return v;
}

function gcd(a, b) {
  let x = babs(a);
  let y = babs(b);
  while (y !== B0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

/* ------------------------------------------------------------ rationals */
/* Exact fractions {n, d} of BigInt with d > 0, reduced. */

function rat(n, d) {
  let nn = typeof n === 'bigint' ? n : BigInt(n);
  let dd = isNil(d) ? B1 : typeof d === 'bigint' ? d : BigInt(d);
  if (dd === B0) throw fail(400, 'division by zero', 'invalid_number', {});
  if (dd < B0) {
    nn = -nn;
    dd = -dd;
  }
  const g = gcd(nn, dd);
  if (g > B1) {
    nn = nn / g;
    dd = dd / g;
  }
  return { n: nn, d: dd };
}

function radd(x, y) {
  return rat(x.n * y.d + y.n * x.d, x.d * y.d);
}
function rsub(x, y) {
  return rat(x.n * y.d - y.n * x.d, x.d * y.d);
}
function rmul(x, y) {
  return rat(x.n * y.n, x.d * y.d);
}
function rdiv(x, y) {
  if (y.n === B0) throw fail(400, 'division by zero', 'invalid_number', {});
  return rat(x.n * y.d, x.d * y.n);
}
/** -1, 0 or 1. */
function rcmp(x, y) {
  const a = x.n * y.d;
  const b = y.n * x.d;
  return a < b ? -1 : a > b ? 1 : 0;
}
function rmin(x, y) {
  return rcmp(x, y) <= 0 ? x : y;
}
function rfloor(x) {
  return divFloor(x.n, x.d);
}
function rround(x) {
  return divRound(x.n, x.d);
}
function rnum(x) {
  return Number(x.n) / Number(x.d);
}

/* --------------------------------------------------------- allocation */

/**
 * Split `total` (BigInt) over `weights` (BigInt[] >= 0) pro rata, exactly:
 * every line is the floor of its exact share and the leftover units go one
 * each to the largest remainders (ties: larger weight, then earlier line).
 * The lines always sum to `total`. Returns BigInt[].
 */
function largestRemainder(total, weights) {
  let W = B0;
  for (let i = 0; i < weights.length; i++) {
    if (weights[i] < B0) throw fail(400, 'weights must not be negative', 'invalid_number', { index: i });
    W = W + weights[i];
  }
  const out = [];
  if (total === B0) {
    for (let i = 0; i < weights.length; i++) out.push(B0);
    return out;
  }
  if (W === B0) throw fail(400, 'Nothing to allocate over: every weight is zero', 'no_weights', {});
  const neg = total < B0;
  const T = babs(total);
  const rem = [];
  let used = B0;
  for (let i = 0; i < weights.length; i++) {
    const p = T * weights[i];
    const q = p / W;
    out.push(q);
    used = used + q;
    rem.push({ i: i, r: p - q * W, w: weights[i] });
  }
  rem.sort((a, b) => (a.r !== b.r ? (a.r > b.r ? -1 : 1) : a.w !== b.w ? (a.w > b.w ? -1 : 1) : a.i - b.i));
  let left = T - used;
  for (let k = 0; left > B0; k++) {
    out[rem[k].i] = out[rem[k].i] + B1;
    left = left - B1;
  }
  return neg ? out.map((x) => -x) : out;
}

/* ----------------------------------------------------------- currencies */

const ZERO_DECIMALS = ['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'];
const THREE_DECIMALS = ['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND'];

/** Decimal places of a currency's minor unit (ISO 4217). */
function exponent(currency) {
  const c = String(isNil(currency) ? '' : currency).toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) throw fail(400, 'currency must be a 3-letter ISO code', 'invalid_currency', { value: isNil(currency) ? null : currency });
  if (ZERO_DECIMALS.indexOf(c) >= 0) return 0;
  if (THREE_DECIMALS.indexOf(c) >= 0) return 3;
  return 2;
}

/** `minor` of `from` -> minor units of `to` at `rateE8` (to-units per one from-unit, x 10^8). */
function convertMinor(minor, from, to, rateE8) {
  const m = big(minor, 'amount_minor');
  const r = bigPos(rateE8, 'rate_e8');
  if (r === B0) throw fail(400, 'rate_e8 must be positive', 'invalid_number', { field: 'rate_e8' });
  const ef = exponent(from);
  const et = exponent(to);
  return num(divRound(m * r * bpow10(et), bpow10(ef) * BE8), 'amount_minor');
}

/* ----------------------------------------------------------------- days */

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isDay(s) {
  if (typeof s !== 'string') return false;
  const m = DAY_RE.exec(s);
  if (m === null) return false;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(t).toISOString().slice(0, 10) === s;
}

/** 'YYYY-MM-DD' -> whole days since 1970-01-01; throws invalid_day. */
function dayNum(s, field) {
  if (!isDay(s)) throw fail(400, (field || 'day') + ' must be a date YYYY-MM-DD', 'invalid_day', { field: field || 'day', value: isNil(s) ? null : s });
  const m = DAY_RE.exec(s);
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS);
}

function dayText(n) {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

function addDays(day, n) {
  return dayText(dayNum(day) + n);
}

/** Calendar days from a to b (b - a). */
function diffDays(a, b) {
  return dayNum(b, 'to_day') - dayNum(a, 'from_day');
}

/** 0 Sunday .. 6 Saturday. */
function weekday(day) {
  return new Date(dayNum(day) * DAY_MS).getUTCDay();
}

function daysInMonth(y, m1) {
  return new Date(Date.UTC(y, m1, 0)).getUTCDate();
}

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

/** Year and month (1..12) of a day. */
function ym(day) {
  dayNum(day);
  return { y: Number(day.slice(0, 4)), m: Number(day.slice(5, 7)) };
}

function monthStart(day) {
  const p = ym(day);
  return p.y + '-' + pad2(p.m) + '-01';
}

function monthEnd(day) {
  const p = ym(day);
  return p.y + '-' + pad2(p.m) + '-' + pad2(daysInMonth(p.y, p.m));
}

/** The last day of the month `n` months after the month of `day` (n may be negative). */
function monthEndAfter(day, n) {
  const p = ym(day);
  const k = p.y * 12 + (p.m - 1) + n;
  const y = Math.floor(k / 12);
  const m = k - y * 12 + 1;
  return y + '-' + pad2(m) + '-' + pad2(daysInMonth(y, m));
}

/** Month index (year * 12 + month - 1) of a day, for month arithmetic. */
function monthIndex(day) {
  const p = ym(day);
  return p.y * 12 + (p.m - 1);
}

/** An instant as UTC milliseconds: a Number, or ISO / PocketBase date text. */
function instant(x, field) {
  if (typeof x === 'number' && isFinite(x)) return x;
  if (typeof x === 'string') {
    const s = x.trim().replace(' ', 'T');
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/.test(s)) {
      const t = Date.parse(s);
      if (isFinite(t)) return t;
    }
  }
  throw fail(400, (field || 'at') + ' must be a date-time like 2026-11-12T09:00:00Z', 'invalid_time', { field: field || 'at', value: isNil(x) ? null : x });
}

function ppmCheck(x, field, allowAbove) {
  if (typeof x !== 'number' || !Number.isInteger(x) || x < 0 || (!allowAbove && x > E6)) {
    throw fail(400, field + ' must be whole millionths from 0 to 1000000', 'invalid_ppm', { field: field, value: isNil(x) ? null : x });
  }
  return x;
}

module.exports = {
  E6: E6,
  E8: E8,
  DAY_MS: DAY_MS,
  B0: B0,
  B1: B1,
  BE6: BE6,
  BE8: BE8,
  fail: fail,
  isNil: isNil,
  big: big,
  bigPos: bigPos,
  num: num,
  babs: babs,
  divRound: divRound,
  divFloor: divFloor,
  mulDiv: mulDiv,
  bpow10: bpow10,
  gcd: gcd,
  rat: rat,
  radd: radd,
  rsub: rsub,
  rmul: rmul,
  rdiv: rdiv,
  rcmp: rcmp,
  rmin: rmin,
  rfloor: rfloor,
  rround: rround,
  rnum: rnum,
  largestRemainder: largestRemainder,
  exponent: exponent,
  convertMinor: convertMinor,
  isDay: isDay,
  dayNum: dayNum,
  dayText: dayText,
  addDays: addDays,
  diffDays: diffDays,
  weekday: weekday,
  daysInMonth: daysInMonth,
  monthStart: monthStart,
  monthEnd: monthEnd,
  monthEndAfter: monthEndAfter,
  monthIndex: monthIndex,
  instant: instant,
  ppmCheck: ppmCheck,
};
