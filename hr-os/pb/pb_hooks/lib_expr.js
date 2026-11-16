/**
 * lib_expr: the closed expression language of HR OS rule packs.
 *
 * A pack step holds small formulas such as
 *   max(0, table("fit_" + profile.filing_status, annual_wages) / periods())
 * This module turns one formula into a syntax tree (tokenizer plus a Pratt
 * parser), then into a tree of small JavaScript closures that read only from
 * the evaluation environment the engine hands in. There is no eval, no
 * Function constructor, no property access outside the names the language
 * defines, no loops and no clock, so a formula always ends and always gives
 * the same answer for the same input.
 *
 * Pure JavaScript: it runs unchanged in Node (pack tests) and in PocketBase's
 * Goja (pay runs). The tokenizer scans characters instead of using regular
 * expressions because Goja's sticky regex flag does not work.
 *
 * Values are numbers, text, true/false, and "no value" (null) for a declared
 * field nobody filled in. Arithmetic on "no value" is an error, so a pack
 * says what it wants with coalesce(profile.x, 0).
 *
 * Exports: parse, compile, refsOf, FUNCTIONS, ROOTS, LIMITS, MODES,
 * roundStep, snap, prepareTable, bracketValue, bandLookup, mapLookup,
 * isDay, dayNumber, daysBetween, addDays, monthsBetween, ageOn, exprError.
 */

const LIMITS = { length: 4000, depth: 40, args: 64, text: 10000, rows: 20000, cache: 20000 };

/** Roots of dotted names. Single names are the pack's own earlier vars. */
const ROOTS = { run: true, employee: true, employment: true, profile: true, entity: true, context: true, currency: true };

/** Rounding modes. half_up and up go away from zero; down goes toward zero. */
const MODES = { half_up: true, half_even: true, half_down: true, up: true, down: true };

/**
 * Every function of the language: arity, argument names (for messages and
 * the reference), whether arguments are evaluated lazily (only the branch
 * taken), and a one-line description.
 */
const FUNCTIONS = {
  min: { min: 1, max: 64, args: 'a, b, ...', desc: 'smallest of the numbers' },
  max: { min: 1, max: 64, args: 'a, b, ...', desc: 'largest of the numbers' },
  abs: { min: 1, max: 1, args: 'x', desc: 'absolute value' },
  floor: { min: 1, max: 1, args: 'x', desc: 'largest whole number not above x' },
  ceil: { min: 1, max: 1, args: 'x', desc: 'smallest whole number not below x' },
  round: { min: 1, max: 2, args: 'x, dp', desc: 'round to dp decimals (default 0), halves away from zero' },
  round_even: { min: 1, max: 2, args: 'x, dp', desc: 'round to dp decimals, halves to the even digit' },
  round_up: { min: 2, max: 2, args: 'x, step', desc: 'round away from zero to a multiple of step' },
  round_down: { min: 2, max: 2, args: 'x, step', desc: 'round toward zero to a multiple of step' },
  round_to: { min: 2, max: 2, args: 'x, step', desc: 'round to the nearest multiple of step, halves away from zero' },
  round_half_down: { min: 2, max: 2, args: 'x, step', desc: 'round to the nearest multiple of step, halves toward zero' },
  clamp: { min: 3, max: 3, args: 'x, lo, hi', desc: 'x limited to the range lo to hi' },
  if: { min: 3, max: 3, args: 'cond, a, b', lazy: true, desc: 'a when cond is true, else b (only the chosen branch runs)' },
  coalesce: { min: 2, max: 64, args: 'a, b, ...', lazy: true, desc: 'the first argument that has a value' },
  in: { min: 2, max: 64, args: 'x, a, b, ...', desc: 'true when x equals one of the others' },
  sum: { min: 1, max: 1, args: 'tag', desc: 'sum of this payslip\'s lines carrying the tag (input lines and earlier steps)' },
  sum_code: { min: 1, max: 1, args: 'code', desc: 'sum of this payslip\'s lines with the code' },
  line: { min: 1, max: 1, args: 'code', desc: 'the result of an earlier step that emits the code (0 when its condition was false)' },
  ytd: { min: 1, max: 1, args: 'tag', desc: 'year to date before this run, by tag, within this pack\'s tax year' },
  ytd_code: { min: 1, max: 1, args: 'code', desc: 'year to date before this run, by code, within this pack\'s tax year' },
  ytd_since: { min: 2, max: 2, args: 'tag, day', desc: 'sum over earlier payslips of the lines with the tag, dated on or after day (any tax year)' },
  ytd_code_since: { min: 2, max: 2, args: 'code, day', desc: 'sum over earlier payslips of the lines with the code, dated on or after day' },
  prev_regular: { min: 1, max: 1, args: 'tag', desc: 'the tag sum on the most recent earlier regular payslip (0 when none)' },
  prev_regular_code: { min: 1, max: 1, args: 'code', desc: 'the code sum on the most recent earlier regular payslip (0 when none)' },
  has_prev_regular: { min: 0, max: 0, args: '', desc: 'true when the history holds an earlier regular payslip' },
  prev_regular_date: { min: 0, max: 0, args: '', desc: 'the day of the most recent earlier regular payslip, or "" when none' },
  regular_in_month: { min: 2, max: 2, args: 'tag, day', desc: 'sum of the tag over earlier regular payslips dated in the calendar month of day' },
  regular_in_month_code: { min: 2, max: 2, args: 'code, day', desc: 'sum of the code over earlier regular payslips dated in the calendar month of day' },
  regular_count_in_month: { min: 1, max: 1, args: 'day', desc: 'how many earlier regular payslips are dated in the calendar month of day' },
  total: { min: 1, max: 1, args: 'group', desc: 'running total so far: "gross", "pre", "statutory", "post", "deductions", "employer", "reimbursement", "net"' },
  table: { min: 2, max: 2, args: 'name, x', desc: 'progressive brackets table applied to x' },
  band: { min: 2, max: 3, args: 'name, x, column', desc: 'value from the band row that contains x' },
  map: { min: 2, max: 3, args: 'name, key, column', desc: 'value stored under key in a map table' },
  days_between: { min: 2, max: 2, args: 'a, b', desc: 'days from day a to day b (b minus a)' },
  months_between: { min: 2, max: 2, args: 'a, b', desc: 'whole months from day a to day b' },
  add_days: { min: 2, max: 2, args: 'day, n', desc: 'the day n days after day (n may be negative)' },
  add_months: { min: 2, max: 2, args: 'day, n', desc: 'the same day n months later (n may be negative), kept inside the month (01-31 plus 1 month is 02-28)' },
  month_start: { min: 1, max: 1, args: 'day', desc: 'the first day of the month of day' },
  month_end: { min: 1, max: 1, args: 'day', desc: 'the last day of the month of day' },
  day: { min: 1, max: 1, args: 'day', desc: 'the day of the month (1 to 31)' },
  age_on: { min: 1, max: 1, args: 'day', desc: 'the employee\'s age in whole years on day' },
  year: { min: 1, max: 1, args: 'day', desc: 'the year of a day' },
  month: { min: 1, max: 1, args: 'day', desc: 'the month (1 to 12) of a day' },
  periods: { min: 0, max: 0, args: '', desc: 'pay periods per year (run.periods_per_year)' },
  prorate: { min: 1, max: 1, args: 'x', desc: 'x times run.worked_days divided by run.working_days_in_period' },
  len: { min: 1, max: 1, args: 'text', desc: 'number of characters' },
  upper: { min: 1, max: 1, args: 'text', desc: 'text in capitals' },
  lower: { min: 1, max: 1, args: 'text', desc: 'text in small letters' },
  trim: { min: 1, max: 1, args: 'text', desc: 'text without leading and trailing spaces' },
  substr: { min: 2, max: 3, args: 'text, start, count', desc: 'part of the text from start (0 based), count characters (default: to the end)' },
  starts_with: { min: 2, max: 2, args: 'text, prefix', desc: 'true when the text starts with prefix' },
  ends_with: { min: 2, max: 2, args: 'text, suffix', desc: 'true when the text ends with suffix' },
  contains: { min: 2, max: 2, args: 'text, part', desc: 'true when the text contains part' },
  digits: { min: 1, max: 1, args: 'text', desc: 'only the digit characters of the text, in order' },
  is_number: { min: 1, max: 1, args: 'text', desc: 'true when the text is a plain decimal number such as 1257 or -3.5' },
  num: { min: 1, max: 1, args: 'text', desc: 'the number written in the text (error when it is not a plain number)' },
  text: { min: 1, max: 1, args: 'x', desc: 'a number or true/false written as text' }
};

/** An error with a machine code: expr_syntax, expr_name, expr_type, expr_math, expr_limit, expr_table. */
function exprError(code, message, pos) {
  const err = new Error(message);
  err.code = code;
  if (pos !== undefined) err.pos = pos;
  return err;
}

function has(obj, key) {
  return obj !== null && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key);
}

function forbiddenKey(k) {
  return k === '__proto__' || k === 'prototype' || k === 'constructor';
}

// ---------------------------------------------------------------- numbers

/** Remove binary noise: keep 15 significant digits (0.1 + 0.2 becomes 0.3). */
function snap(x) {
  if (x === 0 || x !== x || x === Infinity || x === -Infinity) return x === 0 ? 0 : x;
  return +x.toPrecision(15);
}

/** Decimals written in a positive step such as 0.01 (2) or 10 (0). */
function decimalsOf(step) {
  if (step >= 1 && Math.floor(step) === step) return 0;
  const s = String(step);
  const e = s.indexOf('e-');
  if (e >= 0) {
    const mant = s.slice(0, e);
    const dot = mant.indexOf('.');
    return Number(s.slice(e + 2)) + (dot >= 0 ? mant.length - dot - 1 : 0);
  }
  const dot = s.indexOf('.');
  return dot >= 0 ? s.length - dot - 1 : 0;
}

/**
 * Round x to a multiple of step with a mode. Decimal-safe for money:
 * 1.005 rounds to 1.01 at step 0.01, 2.5 to 3 (half_up) or 2 (half_even).
 */
function roundStep(x, step, mode) {
  if (typeof x !== 'number' || x !== x || x === Infinity || x === -Infinity) throw exprError('expr_math', 'cannot round ' + String(x));
  if (!(step > 0) || step === Infinity) throw exprError('expr_math', 'rounding step must be a positive number, got ' + String(step));
  const q = snap(x / step);
  const sign = q < 0 ? -1 : 1;
  const a = Math.abs(q);
  const f = Math.floor(a);
  const frac = a - f;
  let r;
  if (mode === 'half_up') r = frac >= 0.5 ? f + 1 : f;
  else if (mode === 'half_down') r = frac > 0.5 ? f + 1 : f;
  else if (mode === 'half_even') r = frac > 0.5 ? f + 1 : frac < 0.5 ? f : f % 2 === 0 ? f : f + 1;
  else if (mode === 'up') r = frac > 0 ? f + 1 : f;
  else if (mode === 'down') r = f;
  else throw exprError('expr_math', 'unknown rounding mode "' + String(mode) + '" (use half_up, half_even, half_down, up or down)');
  if (r === 0) return 0;
  const info = stepInfo(step);
  if (info.d === 0) return sign * r * step;
  if (info.inv > 0) return (sign * r) / info.inv;
  return +(sign * r * step).toFixed(info.d);
}

/** Per step value: its decimals, and 1/step when that is a whole number (0.01 gives 100). Cached: steps repeat. */
const stepCache = new Map();
function stepInfo(step) {
  let info = stepCache.get(step);
  if (info !== undefined) return info;
  const d = Math.min(decimalsOf(step), 20);
  const inv = Math.round(1 / step);
  info = { d: d, inv: d > 0 && Math.abs(inv * step - 1) < 1e-12 ? inv : 0 };
  if (stepCache.size > 1000) stepCache.clear();
  stepCache.set(step, info);
  return info;
}

// ---------------------------------------------------------------- days

function isDay(s) {
  if (typeof s !== 'string' || s.length !== 10 || s.charCodeAt(4) !== 45 || s.charCodeAt(7) !== 45) return false;
  for (let i = 0; i < 10; i++) {
    if (i === 4 || i === 7) continue;
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  const y = +s.slice(0, 4);
  const m = +s.slice(5, 7);
  const d = +s.slice(8, 10);
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}

function daysInMonth(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

function needDay(s, what) {
  if (!isDay(s)) throw exprError('expr_type', what + ' needs a day written YYYY-MM-DD, got ' + show(s));
  return s;
}

/** Days since 1970-01-01 (UTC calendar, no time zones involved). */
function dayNumber(s) {
  needDay(s, 'a date');
  return Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000);
}

function fromDayNumber(n) {
  const dt = new Date(n * 86400000);
  const y = dt.getUTCFullYear();
  const m = dt.getUTCMonth() + 1;
  const d = dt.getUTCDate();
  return (y < 1000 ? ('000' + y).slice(-4) : String(y)) + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
}

function daysBetween(a, b) {
  return dayNumber(b) - dayNumber(a);
}

function addDays(s, n) {
  return fromDayNumber(dayNumber(s) + n);
}

/** The same day n months later, kept inside the target month (2026-01-31 plus 1 is 2026-02-28). */
function addMonths(s, n) {
  needDay(s, 'add_months');
  const y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12 + 1;
  if (ny < 1 || ny > 9999) throw exprError('expr_math', 'add_months() leaves the years 1 to 9999');
  const nd = Math.min(d, daysInMonth(ny, nm));
  return ('000' + ny).slice(-4) + '-' + (nm < 10 ? '0' : '') + nm + '-' + (nd < 10 ? '0' : '') + nd;
}

/** Whole months from a to b: 2026-01-15 to 2026-02-14 is 0, to 2026-02-15 is 1; a month end to the next month end (01-31 to 02-28) is 1. */
function monthsBetween(a, b) {
  needDay(a, 'months_between');
  needDay(b, 'months_between');
  if (b < a) return -monthsBetween(b, a);
  const y1 = +a.slice(0, 4), m1 = +a.slice(5, 7), d1 = +a.slice(8, 10);
  const y2 = +b.slice(0, 4), m2 = +b.slice(5, 7), d2 = +b.slice(8, 10);
  let n = (y2 - y1) * 12 + (m2 - m1);
  if (d2 < d1 && d2 < daysInMonth(y2, m2)) n -= 1;
  return n;
}

/** Age in whole years on a day. A 29 February birthday counts from 1 March in other years. */
function ageOn(birth, day) {
  needDay(birth, 'age_on (employee.birth_date)');
  needDay(day, 'age_on');
  const y1 = +birth.slice(0, 4), m1 = +birth.slice(5, 7), d1 = +birth.slice(8, 10);
  const y2 = +day.slice(0, 4), m2 = +day.slice(5, 7), d2 = +day.slice(8, 10);
  let age = y2 - y1;
  if (m2 < m1 || (m2 === m1 && d2 < d1)) age -= 1;
  return age;
}

// ---------------------------------------------------------------- tables

function num(v, what) {
  if (typeof v !== 'number' || v !== v || v === Infinity || v === -Infinity) throw exprError('expr_table', what + ' must be a number, got ' + show(v));
  return v;
}

/**
 * Check and index a table once per pack. Throws expr_table with a plain
 * message when the shape is wrong. Shapes:
 *   brackets: rows [{ over, rate }] (segments add up), or every row with
 *             base (base + (x - over) * rate), or every row with less
 *             (x * rate - less). A row applies to amounts strictly over `over`.
 *   bands:    rows [{ from | over, to | under, value | values: { col: v } }]
 *             from/to include the bound, over/under exclude it; a missing
 *             lower bound on the first row or upper bound on the last row is open.
 *   map:      rows { key: number | text | { col: v } }, optional default.
 */
function prepareTable(name, t) {
  if (!t || typeof t !== 'object') throw exprError('expr_table', 'table "' + name + '" is not an object');
  const type = t.type;
  if (type === 'brackets') {
    if (!Array.isArray(t.rows) || t.rows.length === 0) throw exprError('expr_table', 'table "' + name + '" needs at least one row');
    if (t.rows.length > LIMITS.rows) throw exprError('expr_limit', 'table "' + name + '" has more than ' + LIMITS.rows + ' rows');
    let withBase = 0, withLess = 0;
    const rows = [];
    const first = t.rows[0];
    const inclusive = !!first && typeof first === 'object' && first.from !== undefined;
    const lowKey = inclusive ? 'from' : 'over';
    for (let i = 0; i < t.rows.length; i++) {
      const r = t.rows[i];
      const at = 'table "' + name + '" row ' + (i + 1);
      if (!r || typeof r !== 'object') throw exprError('expr_table', at + ' is not an object');
      if (r.from !== undefined && r.over !== undefined) throw exprError('expr_table', at + ' has both "from" and "over"');
      if (r[lowKey] === undefined) throw exprError('expr_table', at + ' needs "' + lowKey + '" like the first row (one form per table: "over" = strictly over, "from" = at least)');
      const over = num(r[lowKey], at + ' ' + lowKey);
      const rate = num(r.rate, at + ' rate');
      if (i > 0 && !(over > rows[i - 1].over)) throw exprError('expr_table', at + ': "' + lowKey + '" must be larger than the row before');
      const row = { over: over, rate: rate };
      if (r.base !== undefined) { row.base = num(r.base, at + ' base'); withBase++; }
      if (r.less !== undefined) { row.less = num(r.less, at + ' less'); withLess++; }
      rows.push(row);
    }
    let method = 'sum';
    if (withBase > 0 && withLess > 0) throw exprError('expr_table', 'table "' + name + '" mixes "base" and "less" rows; use one form');
    if (withBase > 0) { if (withBase !== rows.length) throw exprError('expr_table', 'table "' + name + '": every row needs "base" when one row has it'); method = 'base'; }
    if (withLess > 0) { if (withLess !== rows.length) throw exprError('expr_table', 'table "' + name + '": every row needs "less" when one row has it'); method = 'less'; }
    return { name: name, type: 'brackets', method: method, inclusive: inclusive, rows: rows };
  }
  if (type === 'bands') {
    if (!Array.isArray(t.rows) || t.rows.length === 0) throw exprError('expr_table', 'table "' + name + '" needs at least one row');
    if (t.rows.length > LIMITS.rows) throw exprError('expr_limit', 'table "' + name + '" has more than ' + LIMITS.rows + ' rows');
    const rows = [];
    for (let i = 0; i < t.rows.length; i++) {
      const r = t.rows[i];
      const at = 'table "' + name + '" row ' + (i + 1);
      if (!r || typeof r !== 'object') throw exprError('expr_table', at + ' is not an object');
      if (r.from !== undefined && r.over !== undefined) throw exprError('expr_table', at + ' has both "from" and "over"');
      if (r.to !== undefined && r.under !== undefined) throw exprError('expr_table', at + ' has both "to" and "under"');
      const row = { lo: -Infinity, loInc: true, hi: Infinity, hiInc: true, index: i };
      if (r.from !== undefined && r.from !== null) { row.lo = num(r.from, at + ' from'); row.loInc = true; }
      else if (r.over !== undefined && r.over !== null) { row.lo = num(r.over, at + ' over'); row.loInc = false; }
      else if (i > 0) throw exprError('expr_table', at + ' needs "from" or "over" (only the first row may be open below)');
      if (r.to !== undefined && r.to !== null) { row.hi = num(r.to, at + ' to'); row.hiInc = true; }
      else if (r.under !== undefined && r.under !== null) { row.hi = num(r.under, at + ' under'); row.hiInc = false; }
      else if (i < t.rows.length - 1) throw exprError('expr_table', at + ' needs "to" or "under" (only the last row may be open above)');
      if (row.hi < row.lo || (row.hi === row.lo && !(row.loInc && row.hiInc))) throw exprError('expr_table', at + ' is empty (its upper bound is below its lower bound)');
      if (r.values !== undefined) {
        if (!r.values || typeof r.values !== 'object' || Array.isArray(r.values)) throw exprError('expr_table', at + ' "values" must be an object of columns');
        row.values = r.values;
      }
      if (r.value !== undefined) row.value = r.value;
      if (row.values === undefined && row.value === undefined) throw exprError('expr_table', at + ' needs "value" or "values"');
      if (i > 0) {
        const p = rows[i - 1];
        if (row.lo < p.hi || (row.lo === p.hi && row.loInc && p.hiInc)) throw exprError('expr_table', at + ' overlaps the row before (rows must go up without overlapping)');
      }
      rows.push(row);
    }
    return { name: name, type: 'bands', rows: rows };
  }
  if (type === 'map') {
    if (!t.rows || typeof t.rows !== 'object' || Array.isArray(t.rows)) throw exprError('expr_table', 'map table "' + name + '" needs "rows" as an object of keys');
    if (Object.keys(t.rows).length > LIMITS.rows) throw exprError('expr_limit', 'table "' + name + '" has more than ' + LIMITS.rows + ' rows');
    return { name: name, type: 'map', rows: t.rows, hasDefault: t.default !== undefined, def: t.default };
  }
  throw exprError('expr_table', 'table "' + name + '" has unknown type ' + show(type) + ' (use brackets, bands or map)');
}

/** Progressive brackets. Returns { value, rows: [{ over, rate, ... , part }] } for the explanation. */
function bracketValue(t, x) {
  x = snap(x);
  const rows = t.rows;
  if (t.method === 'sum') {
    let total = 0;
    const used = [];
    for (let i = 0; i < rows.length; i++) {
      const lo = rows[i].over;
      if (!(x > lo)) break;
      const hi = i + 1 < rows.length ? rows[i + 1].over : Infinity;
      const part = (Math.min(x, hi) - lo) * rows[i].rate;
      total += part;
      const u = {};
      u[t.inclusive ? 'from' : 'over'] = lo;
      u.rate = rows[i].rate;
      u.part = snap(part);
      used.push(u);
    }
    return { value: snap(total), rows: used };
  }
  let k = -1;
  for (let i = 0; i < rows.length; i++) {
    if (x > rows[i].over || (t.inclusive && x === rows[i].over)) k = i;
    else break;
  }
  if (k < 0) return { value: 0, rows: [] };
  const r = rows[k];
  const used = {};
  used[t.inclusive ? 'from' : 'over'] = r.over;
  used.rate = r.rate;
  if (t.method === 'base') {
    used.base = r.base;
    return { value: snap(r.base + (x - r.over) * r.rate), rows: [used] };
  }
  used.less = r.less;
  return { value: snap(x * r.rate - r.less), rows: [used] };
}

function bandAdmits(row, x) {
  return x > row.lo || (x === row.lo && row.loInc);
}

/** The band row containing x, or an expr_table error naming the gap. */
function bandLookup(t, x) {
  x = snap(x);
  const rows = t.rows;
  let lo = 0, hi = rows.length - 1, k = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bandAdmits(rows[mid], x)) { k = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (k >= 0) {
    const r = rows[k];
    if (x < r.hi || (x === r.hi && r.hiInc)) return r;
  }
  throw exprError('expr_table', 'no row of band table "' + t.name + '" contains ' + String(x));
}

function bandValue(t, x, column) {
  const r = bandLookup(t, x);
  let v;
  if (column === undefined) {
    if (r.value === undefined) throw exprError('expr_table', 'band table "' + t.name + '" row ' + (r.index + 1) + ' has columns; give a column name');
    v = r.value;
  } else {
    if (!r.values || !has(r.values, column)) throw exprError('expr_table', 'band table "' + t.name + '" row ' + (r.index + 1) + ' has no column "' + column + '"');
    v = r.values[column];
  }
  if (typeof v !== 'number' && typeof v !== 'string' && typeof v !== 'boolean') throw exprError('expr_table', 'band table "' + t.name + '" row ' + (r.index + 1) + ' column holds no number or text');
  return { value: v, row: r };
}

function mapKey(key) {
  if (typeof key === 'string') return key;
  if (typeof key === 'number') return String(snap(key));
  if (typeof key === 'boolean') return key ? 'true' : 'false';
  throw exprError('expr_type', 'map key has no value');
}

function mapLookup(t, key, column) {
  const k = mapKey(key);
  let v;
  let usedDefault = false;
  if (!forbiddenKey(k) && has(t.rows, k)) v = t.rows[k];
  else if (t.hasDefault) { v = t.def; usedDefault = true; }
  else throw exprError('expr_table', 'map table "' + t.name + '" has no key "' + k + '"');
  if (column !== undefined) {
    if (!v || typeof v !== 'object' || forbiddenKey(column) || !has(v, column)) throw exprError('expr_table', 'map table "' + t.name + '" key "' + k + '" has no column "' + column + '"');
    v = v[column];
  }
  if (typeof v !== 'number' && typeof v !== 'string' && typeof v !== 'boolean') {
    throw exprError('expr_table', 'map table "' + t.name + '" key "' + k + '" holds ' + (v && typeof v === 'object' ? 'columns; give a column name' : 'no number or text'));
  }
  return { value: v, key: k, isDefault: usedDefault };
}

// ---------------------------------------------------------------- tokenizer

function isIdStart(c) {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
}
function isIdPart(c) {
  return isIdStart(c) || (c >= 48 && c <= 57);
}
function isDigit(c) {
  return c >= 48 && c <= 57;
}

const TWO = { '==': true, '!=': true, '<=': true, '>=': true, '&&': true, '||': true };
const ONE = { '!': true, '<': true, '>': true, '+': true, '-': true, '*': true, '/': true, '%': true, '?': true, ':': true, '(': true, ')': true, ',': true };

function tokenize(src) {
  const toks = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src.charCodeAt(i);
    if (c === 32 || c === 9 || c === 10 || c === 13) { i++; continue; }
    const start = i;
    if (isDigit(c) || (c === 46 && i + 1 < n && isDigit(src.charCodeAt(i + 1)))) {
      while (i < n && isDigit(src.charCodeAt(i))) i++;
      if (i < n && src.charCodeAt(i) === 46) {
        i++;
        if (!(i < n && isDigit(src.charCodeAt(i)))) throw exprError('expr_syntax', 'a number needs digits after the point', start);
        while (i < n && isDigit(src.charCodeAt(i))) i++;
      }
      if (i < n && (src.charCodeAt(i) === 101 || src.charCodeAt(i) === 69)) {
        let j = i + 1;
        if (j < n && (src.charCodeAt(j) === 43 || src.charCodeAt(j) === 45)) j++;
        if (!(j < n && isDigit(src.charCodeAt(j)))) throw exprError('expr_syntax', 'a number exponent needs digits', start);
        while (j < n && isDigit(src.charCodeAt(j))) j++;
        i = j;
      }
      if (i < n && (isIdStart(src.charCodeAt(i)) || src.charCodeAt(i) === 46)) throw exprError('expr_syntax', 'unexpected character after the number ' + src.slice(start, i), i);
      toks.push({ t: 'num', v: Number(src.slice(start, i)), s: start, e: i });
      continue;
    }
    if (c === 34) {
      i++;
      let out = '';
      let closed = false;
      while (i < n) {
        const d = src.charCodeAt(i);
        if (d === 34) { i++; closed = true; break; }
        if (d === 10 || d === 13) break;
        if (d === 92) {
          const e = src.charAt(i + 1);
          if (e === '"' || e === '\\' || e === '/') { out += e; i += 2; continue; }
          if (e === 'n') { out += '\n'; i += 2; continue; }
          if (e === 't') { out += '\t'; i += 2; continue; }
          if (e === 'u') {
            const hex = src.slice(i + 2, i + 6);
            let ok = hex.length === 4;
            for (let k = 0; ok && k < 4; k++) {
              const h = hex.charCodeAt(k);
              ok = isDigit(h) || (h >= 65 && h <= 70) || (h >= 97 && h <= 102);
            }
            if (!ok) throw exprError('expr_syntax', 'bad \\u escape in text', i);
            out += String.fromCharCode(parseInt(hex, 16));
            i += 6;
            continue;
          }
          throw exprError('expr_syntax', 'unknown escape \\' + e + ' in text', i);
        }
        out += src.charAt(i);
        i++;
      }
      if (!closed) throw exprError('expr_syntax', 'text started with " is not closed', start);
      toks.push({ t: 'str', v: out, s: start, e: i });
      continue;
    }
    if (c === 39) throw exprError('expr_syntax', 'write text in double quotes ("like this")', i);
    if (isIdStart(c)) {
      const path = [];
      for (;;) {
        const ps = i;
        while (i < n && isIdPart(src.charCodeAt(i))) i++;
        path.push(src.slice(ps, i));
        if (i + 1 < n && src.charCodeAt(i) === 46 && isIdStart(src.charCodeAt(i + 1))) { i++; continue; }
        break;
      }
      if (i < n && src.charCodeAt(i) === 46) throw exprError('expr_syntax', 'a name cannot end with a point', i);
      toks.push({ t: 'name', path: path, text: path.join('.'), s: start, e: i });
      continue;
    }
    const two = src.slice(i, i + 2);
    if (TWO[two] === true) { toks.push({ t: 'op', v: two, s: i, e: i + 2 }); i += 2; continue; }
    const one = src.charAt(i);
    if (ONE[one] === true) { toks.push({ t: 'op', v: one, s: i, e: i + 1 }); i++; continue; }
    if (one === '=') throw exprError('expr_syntax', 'use == to compare', i);
    if (one === '&') throw exprError('expr_syntax', 'use && for "and"', i);
    if (one === '|') throw exprError('expr_syntax', 'use || for "or"', i);
    if (one === '[' || one === ']' || one === '{' || one === '}') throw exprError('expr_syntax', 'brackets ' + one + ' are not part of the language', i);
    throw exprError('expr_syntax', 'unexpected character ' + JSON.stringify(one), i);
  }
  toks.push({ t: 'eof', s: n, e: n });
  return toks;
}

// ---------------------------------------------------------------- parser

const BP = { '?': 10, '||': 20, '&&': 30, '==': 40, '!=': 40, '<': 50, '<=': 50, '>': 50, '>=': 50, '+': 60, '-': 60, '*': 70, '/': 70, '%': 70 };
const UNARY_BP = 80;

/** Parse a formula into a syntax tree. Throws expr_syntax or expr_limit with a position. */
function parse(src) {
  if (typeof src !== 'string') throw exprError('expr_syntax', 'a formula must be text');
  if (src.length > LIMITS.length) throw exprError('expr_limit', 'formula longer than ' + LIMITS.length + ' characters');
  if (src.trim() === '') throw exprError('expr_syntax', 'empty formula');
  const toks = tokenize(src);
  let p = 0;
  let depth = 0;

  function peek() { return toks[p]; }
  function next() { return toks[p++]; }
  function isOp(tok, v) { return tok.t === 'op' && tok.v === v; }
  function expect(v) {
    const tok = next();
    if (!isOp(tok, v)) throw exprError('expr_syntax', 'expected "' + v + '" ' + where(tok), tok.s);
    return tok;
  }
  function where(tok) {
    return tok.t === 'eof' ? 'at the end' : 'at ' + JSON.stringify(src.slice(tok.s, tok.e)) + ' (position ' + (tok.s + 1) + ')';
  }

  function expr(rbp) {
    if (++depth > LIMITS.depth) throw exprError('expr_limit', 'formula nested deeper than ' + LIMITS.depth + ' levels', peek().s);
    let left = nud(next());
    for (;;) {
      const tok = peek();
      if (tok.t !== 'op') break;
      const bp = BP[tok.v];
      if (bp === undefined || bp <= rbp) break;
      next();
      left = led(tok, left);
    }
    depth--;
    return left;
  }

  function nud(tok) {
    if (tok.t === 'num') return { t: 'num', v: tok.v, s: tok.s, e: tok.e };
    if (tok.t === 'str') return { t: 'str', v: tok.v, s: tok.s, e: tok.e };
    if (tok.t === 'name') {
      if (tok.path.length === 1 && (tok.text === 'true' || tok.text === 'false')) return { t: 'bool', v: tok.text === 'true', s: tok.s, e: tok.e };
      if (isOp(peek(), '(')) {
        if (tok.path.length !== 1) throw exprError('expr_syntax', 'unknown function ' + tok.text, tok.s);
        const name = tok.text;
        if (!has(FUNCTIONS, name)) throw exprError('expr_syntax', 'unknown function ' + name + '()', tok.s);
        next();
        const args = [];
        if (!isOp(peek(), ')')) {
          for (;;) {
            if (args.length >= LIMITS.args) throw exprError('expr_limit', 'more than ' + LIMITS.args + ' arguments', peek().s);
            args.push(expr(0));
            if (isOp(peek(), ',')) { next(); continue; }
            break;
          }
        }
        const close = expect(')');
        const f = FUNCTIONS[name];
        if (args.length < f.min || args.length > f.max) {
          const want = f.min === f.max ? String(f.min) : f.max >= 64 ? f.min + ' or more' : f.min + ' to ' + f.max;
          throw exprError('expr_syntax', name + '(' + f.args + ') takes ' + want + ' argument' + (want === '1' ? '' : 's') + ', got ' + args.length, tok.s);
        }
        return { t: 'call', fn: name, args: args, s: tok.s, e: close.e };
      }
      for (let i = 0; i < tok.path.length; i++) {
        if (forbiddenKey(tok.path[i])) throw exprError('expr_name', 'the name ' + tok.text + ' is not allowed', tok.s);
      }
      if (tok.path.length > 1 && !has(ROOTS, tok.path[0])) {
        throw exprError('expr_name', 'unknown name ' + tok.text + ' (dotted names start with run, employee, employment, profile, entity, context or currency)', tok.s);
      }
      if (tok.path.length === 1 && has(ROOTS, tok.text)) throw exprError('expr_name', tok.text + ' is a group of fields; name one, such as ' + tok.text + '.x', tok.s);
      return { t: 'name', path: tok.path, text: tok.text, s: tok.s, e: tok.e };
    }
    if (tok.t === 'op') {
      if (tok.v === '(') {
        const inner = expr(0);
        const close = expect(')');
        return { t: 'group', a: inner, s: tok.s, e: close.e };
      }
      if (tok.v === '!') {
        const a = expr(UNARY_BP);
        return { t: 'not', a: a, s: tok.s, e: a.e };
      }
      if (tok.v === '-') {
        const a = expr(UNARY_BP);
        if (a.t === 'num') return { t: 'num', v: -a.v, s: tok.s, e: a.e };
        return { t: 'neg', a: a, s: tok.s, e: a.e };
      }
      if (tok.v === '+') throw exprError('expr_syntax', 'a leading + is not needed', tok.s);
    }
    if (tok.t === 'eof') throw exprError('expr_syntax', 'the formula ends too early', tok.s);
    throw exprError('expr_syntax', 'unexpected ' + JSON.stringify(src.slice(tok.s, tok.e)) + ' at position ' + (tok.s + 1), tok.s);
  }

  function led(tok, left) {
    const op = tok.v;
    if (op === '?') {
      const a = expr(0);
      expect(':');
      const b = expr(BP['?'] - 1);
      return { t: 'cond', c: left, a: a, b: b, s: left.s, e: b.e };
    }
    const right = expr(BP[op]);
    if (BP[op] === 40 || BP[op] === 50) {
      const nx = peek();
      if (nx.t === 'op' && BP[nx.v] === BP[op]) throw exprError('expr_syntax', 'comparisons cannot be chained; join them with &&', nx.s);
    }
    if (op === '&&') return { t: 'and', a: left, b: right, s: left.s, e: right.e };
    if (op === '||') return { t: 'or', a: left, b: right, s: left.s, e: right.e };
    return { t: 'bin', op: op, a: left, b: right, s: left.s, e: right.e };
  }

  const tree = expr(0);
  const rest = peek();
  if (rest.t !== 'eof') {
    if (isOp(rest, ':')) throw exprError('expr_syntax', '":" without a "?" before it', rest.s);
    throw exprError('expr_syntax', 'unexpected ' + JSON.stringify(src.slice(rest.s, rest.e)) + ' at position ' + (rest.s + 1) + ' (missing operator?)', rest.s);
  }
  return tree;
}

/** Names and calls a tree reads, for the pack checker. */
function refsOf(tree) {
  const names = [];
  const calls = [];
  (function walk(n) {
    if (!n) return;
    if (n.t === 'name') names.push(n);
    else if (n.t === 'call') { calls.push(n); for (let i = 0; i < n.args.length; i++) walk(n.args[i]); }
    else if (n.t === 'bin' || n.t === 'and' || n.t === 'or') { walk(n.a); walk(n.b); }
    else if (n.t === 'cond') { walk(n.c); walk(n.a); walk(n.b); }
    else if (n.t === 'not' || n.t === 'neg' || n.t === 'group') walk(n.a);
  })(tree);
  return { names: names, calls: calls };
}

// ---------------------------------------------------------------- evaluation

function show(v) {
  if (v === null || v === undefined) return 'no value';
  if (typeof v === 'string') return 'text ' + JSON.stringify(v.length > 40 ? v.slice(0, 40) + '...' : v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

function finite(v, src, n) {
  if (v !== v || v === Infinity || v === -Infinity) throw exprError('expr_math', 'not a finite number in ' + snippet(src, n), n.s);
  return v;
}

function snippet(src, n) {
  const s = src.slice(n.s, n.e);
  return JSON.stringify(s.length > 60 ? s.slice(0, 60) + '...' : s);
}

function needNum(v, src, n, what) {
  if (typeof v === 'number') return v;
  if (v === null || v === undefined) throw exprError('expr_type', what + ' needs a number but ' + snippet(src, n) + ' has no value (use coalesce to give one)', n.s);
  throw exprError('expr_type', what + ' needs a number but ' + snippet(src, n) + ' is ' + show(v), n.s);
}

function needBool(v, src, n, what) {
  if (typeof v === 'boolean') return v;
  if (v === null || v === undefined) throw exprError('expr_type', what + ' needs true or false but ' + snippet(src, n) + ' has no value', n.s);
  throw exprError('expr_type', what + ' needs true or false but ' + snippet(src, n) + ' is ' + show(v) + ' (compare it, for example x > 0)', n.s);
}

function needText(v, src, n, what) {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) throw exprError('expr_type', what + ' needs text but ' + snippet(src, n) + ' has no value', n.s);
  throw exprError('expr_type', what + ' needs text but ' + snippet(src, n) + ' is ' + show(v), n.s);
}

function needInt(v, src, n, what) {
  needNum(v, src, n, what);
  if (Math.floor(v) !== v) throw exprError('expr_type', what + ' needs a whole number but ' + snippet(src, n) + ' is ' + String(v), n.s);
  return v;
}

function equal(x, y, src, n) {
  if (x === null || x === undefined || y === null || y === undefined) return (x === null || x === undefined) && (y === null || y === undefined);
  if (typeof x !== typeof y) throw exprError('expr_type', 'compares ' + show(x) + ' with ' + show(y) + ' in ' + snippet(src, n) + ' (different kinds of value)', n.s);
  if (typeof x === 'number') return snap(x) === snap(y);
  return x === y;
}

function order(x, y, src, n) {
  if (typeof x === 'number' && typeof y === 'number') { const a = snap(x), b = snap(y); return a < b ? -1 : a > b ? 1 : 0; }
  if (typeof x === 'string' && typeof y === 'string') return x < y ? -1 : x > y ? 1 : 0;
  throw exprError('expr_type', 'cannot order ' + show(x) + ' and ' + show(y) + ' in ' + snippet(src, n) + ' (compare two numbers or two texts)', n.s);
}

function build(n, src) {
  switch (n.t) {
    case 'num':
    case 'str':
    case 'bool': {
      const v = n.v;
      return function () { return v; };
    }
    case 'group':
      return build(n.a, src);
    case 'name': {
      const path = n.path;
      const text = n.text;
      return function (env) { return env.name(path, text); };
    }
    case 'neg': {
      const a = build(n.a, src);
      return function (env) { const v = needNum(a(env), src, n.a, 'minus'); return v === 0 ? 0 : -v; };
    }
    case 'not': {
      const a = build(n.a, src);
      return function (env) { return !needBool(a(env), src, n.a, '!'); };
    }
    case 'and': {
      const a = build(n.a, src), b = build(n.b, src);
      return function (env) { return needBool(a(env), src, n.a, '&&') ? needBool(b(env), src, n.b, '&&') : false; };
    }
    case 'or': {
      const a = build(n.a, src), b = build(n.b, src);
      return function (env) { return needBool(a(env), src, n.a, '||') ? true : needBool(b(env), src, n.b, '||'); };
    }
    case 'cond': {
      const c = build(n.c, src), a = build(n.a, src), b = build(n.b, src);
      return function (env) { return needBool(c(env), src, n.c, '? :') ? a(env) : b(env); };
    }
    case 'bin':
      return buildBin(n, src);
    case 'call':
      return buildCall(n, src);
  }
  throw exprError('expr_syntax', 'unknown node ' + n.t);
}

function buildBin(n, src) {
  const a = build(n.a, src), b = build(n.b, src);
  const na = n.a, nb = n.b;
  switch (n.op) {
    case '+':
      return function (env) {
        const x = a(env), y = b(env);
        if (typeof x === 'number' && typeof y === 'number') return finite(x + y, src, n);
        if ((typeof x === 'string' && (typeof y === 'string' || typeof y === 'number')) || (typeof y === 'string' && typeof x === 'number')) {
          const s = (typeof x === 'number' ? String(snap(x)) : x) + (typeof y === 'number' ? String(snap(y)) : y);
          if (s.length > LIMITS.text) throw exprError('expr_limit', 'text longer than ' + LIMITS.text + ' characters', n.s);
          return s;
        }
        if (typeof x !== 'number' && typeof x !== 'string') needNum(x, src, na, '+');
        needNum(y, src, nb, '+');
        return 0;
      };
    case '-':
      return function (env) { return finite(needNum(a(env), src, na, '-') - needNum(b(env), src, nb, '-'), src, n); };
    case '*':
      return function (env) { return finite(needNum(a(env), src, na, '*') * needNum(b(env), src, nb, '*'), src, n); };
    case '/':
      return function (env) {
        const x = needNum(a(env), src, na, '/');
        const y = needNum(b(env), src, nb, '/');
        if (y === 0) throw exprError('expr_math', 'division by zero in ' + snippet(src, n), n.s);
        return finite(x / y, src, n);
      };
    case '%':
      return function (env) {
        const x = needNum(a(env), src, na, '%');
        const y = needNum(b(env), src, nb, '%');
        if (y === 0) throw exprError('expr_math', 'remainder by zero in ' + snippet(src, n), n.s);
        return finite(x % y, src, n);
      };
    case '<': return function (env) { return order(a(env), b(env), src, n) < 0; };
    case '<=': return function (env) { return order(a(env), b(env), src, n) <= 0; };
    case '>': return function (env) { return order(a(env), b(env), src, n) > 0; };
    case '>=': return function (env) { return order(a(env), b(env), src, n) >= 0; };
    case '==': return function (env) { return equal(a(env), b(env), src, n); };
    case '!=': return function (env) { return !equal(a(env), b(env), src, n); };
  }
  throw exprError('expr_syntax', 'unknown operator ' + n.op, n.s);
}

function buildCall(n, src) {
  const name = n.fn;
  const an = n.args;
  const args = [];
  for (let i = 0; i < an.length; i++) args.push(build(an[i], src));
  const A = function (env, i) { return args[i](env); };
  const N = function (env, i, what) { return needNum(args[i](env), src, an[i], what || name + '()'); };
  const T = function (env, i, what) { return needText(args[i](env), src, an[i], what || name + '()'); };
  const fin = function (v) { return finite(v, src, n); };
  switch (name) {
    case 'if':
      return function (env) { return needBool(A(env, 0), src, an[0], 'if()') ? A(env, 1) : A(env, 2); };
    case 'coalesce':
      return function (env) {
        for (let i = 0; i < args.length; i++) {
          const v = A(env, i);
          if (v !== null && v !== undefined) return v;
        }
        return null;
      };
    case 'min':
    case 'max': {
      const isMin = name === 'min';
      return function (env) {
        let best = N(env, 0);
        for (let i = 1; i < args.length; i++) {
          const v = N(env, i);
          if (isMin ? v < best : v > best) best = v;
        }
        return best;
      };
    }
    case 'abs': return function (env) { return Math.abs(N(env, 0)); };
    case 'floor': return function (env) { return Math.floor(snap(N(env, 0))); };
    case 'ceil': return function (env) { const v = Math.ceil(snap(N(env, 0))); return v === 0 ? 0 : v; };
    case 'round':
    case 'round_even': {
      const mode = name === 'round' ? 'half_up' : 'half_even';
      return function (env) {
        const x = N(env, 0);
        const dp = args.length > 1 ? needInt(A(env, 1), src, an[1], name + '() decimals') : 0;
        if (dp < -12 || dp > 12) throw exprError('expr_math', name + '() decimals must be between -12 and 12', an[1].s);
        return roundStep(x, dp >= 0 ? 1 / Math.pow(10, dp) : Math.pow(10, -dp), mode);
      };
    }
    case 'round_up':
    case 'round_down':
    case 'round_to':
    case 'round_half_down': {
      const mode = name === 'round_up' ? 'up' : name === 'round_down' ? 'down' : name === 'round_to' ? 'half_up' : 'half_down';
      return function (env) {
        const x = N(env, 0);
        const step = N(env, 1, name + '() step');
        if (!(step > 0)) throw exprError('expr_math', name + '() step must be above 0 in ' + snippet(src, n), n.s);
        return roundStep(x, step, mode);
      };
    }
    case 'clamp':
      return function (env) {
        const x = N(env, 0), lo = N(env, 1), hi = N(env, 2);
        if (lo > hi) throw exprError('expr_math', 'clamp() low end ' + lo + ' is above the high end ' + hi, n.s);
        return x < lo ? lo : x > hi ? hi : x;
      };
    case 'in':
      return function (env) {
        const x = A(env, 0);
        for (let i = 1; i < args.length; i++) if (equal(x, A(env, i), src, n)) return true;
        return false;
      };
    case 'sum': return function (env) { return env.sum(T(env, 0, 'sum() tag')); };
    case 'sum_code': return function (env) { return env.sumCode(T(env, 0, 'sum_code() code')); };
    case 'line': return function (env) { return env.line(T(env, 0, 'line() code')); };
    case 'ytd': return function (env) { return env.ytd(T(env, 0, 'ytd() tag')); };
    case 'ytd_code': return function (env) { return env.ytdCode(T(env, 0, 'ytd_code() code')); };
    case 'total': return function (env) { return env.total(T(env, 0, 'total() group')); };
    case 'ytd_since': return function (env) { return env.since(T(env, 0, 'ytd_since() tag'), needDay(T(env, 1, 'ytd_since() day'), 'ytd_since()'), false); };
    case 'ytd_code_since': return function (env) { return env.since(T(env, 0, 'ytd_code_since() code'), needDay(T(env, 1, 'ytd_code_since() day'), 'ytd_code_since()'), true); };
    case 'prev_regular': return function (env) { return env.prev(T(env, 0, 'prev_regular() tag'), false); };
    case 'prev_regular_code': return function (env) { return env.prev(T(env, 0, 'prev_regular_code() code'), true); };
    case 'has_prev_regular': return function (env) { return env.prevDate() !== ''; };
    case 'prev_regular_date': return function (env) { return env.prevDate(); };
    case 'regular_in_month': return function (env) { return env.inMonth(T(env, 0, 'regular_in_month() tag'), needDay(T(env, 1, 'regular_in_month() day'), 'regular_in_month()'), 'tag'); };
    case 'regular_in_month_code': return function (env) { return env.inMonth(T(env, 0, 'regular_in_month_code() code'), needDay(T(env, 1, 'regular_in_month_code() day'), 'regular_in_month_code()'), 'code'); };
    case 'regular_count_in_month': return function (env) { return env.inMonth('', needDay(T(env, 0, 'regular_count_in_month() day'), 'regular_count_in_month()'), 'count'); };
    case 'table':
      return function (env) {
        const tname = T(env, 0, 'table() name');
        const x = N(env, 1, 'table() amount');
        const t = env.table(tname, 'brackets');
        const r = bracketValue(t, x);
        env.used({ fn: 'table', table: tname, x: snap(x), value: r.value, rows: r.rows });
        return r.value;
      };
    case 'band':
      return function (env) {
        const tname = T(env, 0, 'band() name');
        const x = N(env, 1, 'band() amount');
        const col = args.length > 2 ? T(env, 2, 'band() column') : undefined;
        const t = env.table(tname, 'bands');
        const r = bandValue(t, x, col);
        const row = { row: r.row.index + 1 };
        if (r.row.lo !== -Infinity) row[r.row.loInc ? 'from' : 'over'] = r.row.lo;
        if (r.row.hi !== Infinity) row[r.row.hiInc ? 'to' : 'under'] = r.row.hi;
        const use = { fn: 'band', table: tname, x: snap(x), value: r.value, row: row };
        if (col !== undefined) use.column = col;
        env.used(use);
        return r.value;
      };
    case 'map':
      return function (env) {
        const tname = T(env, 0, 'map() name');
        const key = A(env, 1);
        if (key === null || key === undefined) throw exprError('expr_type', 'map() key ' + snippet(src, an[1]) + ' has no value', an[1].s);
        const col = args.length > 2 ? T(env, 2, 'map() column') : undefined;
        const t = env.table(tname, 'map');
        const r = mapLookup(t, key, col);
        const use = { fn: 'map', table: tname, key: r.key, value: r.value };
        if (col !== undefined) use.column = col;
        if (r.isDefault) use.default = true;
        env.used(use);
        return r.value;
      };
    case 'days_between': return function (env) { return daysBetween(T(env, 0, 'days_between()'), T(env, 1, 'days_between()')); };
    case 'months_between': return function (env) { return monthsBetween(T(env, 0, 'months_between()'), T(env, 1, 'months_between()')); };
    case 'add_days': return function (env) { return addDays(needDay(T(env, 0, 'add_days()'), 'add_days()'), needInt(A(env, 1), src, an[1], 'add_days() days')); };
    case 'age_on': return function (env) { return ageOn(env.birthDate(), T(env, 0, 'age_on()')); };
    case 'add_months': return function (env) { return addMonths(needDay(T(env, 0, 'add_months()'), 'add_months()'), needInt(A(env, 1), src, an[1], 'add_months() months')); };
    case 'month_start': return function (env) { return needDay(T(env, 0, 'month_start()'), 'month_start()').slice(0, 8) + '01'; };
    case 'month_end':
      return function (env) {
        const d = needDay(T(env, 0, 'month_end()'), 'month_end()');
        const last = daysInMonth(+d.slice(0, 4), +d.slice(5, 7));
        return d.slice(0, 8) + String(last);
      };
    case 'day': return function (env) { return +needDay(T(env, 0, 'day()'), 'day()').slice(8, 10); };
    case 'year': return function (env) { return +needDay(T(env, 0, 'year()'), 'year()').slice(0, 4); };
    case 'month': return function (env) { return +needDay(T(env, 0, 'month()'), 'month()').slice(5, 7); };
    case 'periods': return function (env) { return env.name(['run', 'periods_per_year'], 'run.periods_per_year'); };
    case 'prorate':
      return function (env) {
        const x = N(env, 0);
        const worked = env.name(['run', 'worked_days'], 'run.worked_days');
        const days = env.name(['run', 'working_days_in_period'], 'run.working_days_in_period');
        if (typeof worked !== 'number' || typeof days !== 'number') throw exprError('expr_type', 'prorate() needs run.worked_days and run.working_days_in_period', n.s);
        if (days === 0) throw exprError('expr_math', 'prorate() with run.working_days_in_period = 0 (division by zero)', n.s);
        return fin((x * worked) / days);
      };
    case 'len': return function (env) { return T(env, 0).length; };
    case 'upper': return function (env) { return T(env, 0).toUpperCase(); };
    case 'lower': return function (env) { return T(env, 0).toLowerCase(); };
    case 'trim': return function (env) { return T(env, 0).trim(); };
    case 'substr':
      return function (env) {
        const s = T(env, 0);
        const start = needInt(A(env, 1), src, an[1], 'substr() start');
        if (start < 0) throw exprError('expr_math', 'substr() start must be 0 or more', an[1].s);
        if (args.length < 3) return s.slice(start);
        const count = needInt(A(env, 2), src, an[2], 'substr() count');
        if (count < 0) throw exprError('expr_math', 'substr() count must be 0 or more', an[2].s);
        return s.slice(start, start + count);
      };
    case 'starts_with': return function (env) { const s = T(env, 0), p = T(env, 1); return s.slice(0, p.length) === p; };
    case 'ends_with': return function (env) { const s = T(env, 0), p = T(env, 1); return p.length === 0 || s.slice(-p.length) === p; };
    case 'contains': return function (env) { return T(env, 0).indexOf(T(env, 1)) >= 0; };
    case 'digits':
      return function (env) {
        const s = T(env, 0);
        let out = '';
        for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c >= 48 && c <= 57) out += s.charAt(i); }
        return out;
      };
    case 'is_number': return function (env) { const v = A(env, 0); return typeof v === 'string' && plainNumber(v); };
    case 'num':
      return function (env) {
        const v = A(env, 0);
        if (typeof v === 'number') return v;
        const s = needText(v, src, an[0], 'num()');
        if (!plainNumber(s)) throw exprError('expr_type', 'num() needs a plain number but got ' + show(s), n.s);
        return Number(s);
      };
    case 'text':
      return function (env) {
        const v = A(env, 0);
        if (typeof v === 'number') return String(snap(v));
        if (typeof v === 'boolean') return v ? 'true' : 'false';
        if (typeof v === 'string') return v;
        throw exprError('expr_type', 'text() of ' + snippet(src, an[0]) + ' which has no value', n.s);
      };
  }
  throw exprError('expr_syntax', 'unknown function ' + name + '()', n.s);
}

/** 1257, -3.5, +2 and 0.25 are plain numbers; 1e3, 1,000 and "" are not. */
function plainNumber(s) {
  let i = 0;
  const n = s.length;
  if (i < n && (s.charCodeAt(i) === 43 || s.charCodeAt(i) === 45)) i++;
  const d0 = i;
  while (i < n && isDigit(s.charCodeAt(i))) i++;
  if (i === d0) return false;
  if (i < n && s.charCodeAt(i) === 46) {
    i++;
    const f0 = i;
    while (i < n && isDigit(s.charCodeAt(i))) i++;
    if (i === f0) return false;
  }
  return i === n;
}

const cache = new Map();

/**
 * Parse and build a formula once; later calls with the same text reuse it.
 * Returns { src, tree, run(env) }. Throws expr_syntax / expr_limit / expr_name.
 */
function compile(src) {
  const hit = cache.get(src);
  if (hit !== undefined) return hit;
  const tree = parse(src);
  const fn = build(tree, src);
  const out = { src: src, tree: tree, run: fn };
  if (cache.size >= LIMITS.cache) cache.clear();
  cache.set(src, out);
  return out;
}

module.exports = { parse: parse, compile: compile, refsOf: refsOf, FUNCTIONS: FUNCTIONS, ROOTS: ROOTS, LIMITS: LIMITS, MODES: MODES, roundStep: roundStep, snap: snap, decimalsOf: decimalsOf, prepareTable: prepareTable, bracketValue: bracketValue, bandLookup: bandLookup, bandValue: bandValue, mapLookup: mapLookup, isDay: isDay, dayNumber: dayNumber, daysBetween: daysBetween, addDays: addDays, addMonths: addMonths, monthsBetween: monthsBetween, ageOn: ageOn, daysInMonth: daysInMonth, plainNumber: plainNumber, exprError: exprError };
