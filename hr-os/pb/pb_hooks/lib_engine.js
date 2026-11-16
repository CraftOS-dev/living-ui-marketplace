/**
 * lib_engine: the deterministic payroll calculation engine.
 *
 *   calculate(input, packs) -> { engine, phase, lines, totals, issues, vars, explain, hash }
 *
 * Payroll (lib_payroll) turns database rows into one input per payslip and
 * stores the answer. The engine runs every rule pack's steps in pack order,
 * emits lines, adds them up and explains each figure: the formula, every
 * value it read and the table rows it used. Nothing here reads the database,
 * the clock or random numbers, so the same input always gives byte-identical
 * output, and output.hash proves it.
 *
 * The engine never throws for one employee: a broken step becomes a blocker
 * issue on the payslip, carrying the pack code and step index.
 *
 * Amounts inside the engine are major units (numbers). Every emitted line is
 * rounded by its step's rule and then to the currency's minor unit, so
 * payroll converts lines to integer minor units exactly.
 *
 * Exports: calculate, yearEnd, preview, completeInput, periodInfo, taxYearOf,
 * basisDay, pickVersions, plan, hash, fingerprint, stableStringify, constants.
 * The language reference for pack authors is reference/ENGINE.md.
 */

const VERSION = '1.0.0';

/** Payroll loads earlier locked payslips this many days back (covers any tax or fiscal year). */
const HISTORY_DAYS = 550;

const KINDS = { earning: true, deduction: true, employer: true, reimbursement: true, info: true };
const DEDUCTION_STAGES = { pre: true, statutory: true, post: true };
const FREQUENCIES = { monthly: true, semi_monthly: true, biweekly: true, weekly: true };
const RUN_KINDS = { regular: true, off_cycle: true, bonus: true, termination: true, correction: true, reimbursement: true };
const DATE_BASES = { pay_date: true, period_end: true, period_start: true };
const FIELD_TYPES = { enum: true, number: true, money: true, boolean: true, text: true, date: true };
const TOTAL_GROUPS = { gross: true, pre: true, statutory: true, post: true, deductions: true, employer: true, reimbursement: true, net: true };

/** Names a formula may read under each root (context is free data; profile and entity come from the packs' fields). */
const RUN_INPUT_KEYS = ['kind', 'period_start', 'period_end', 'pay_date', 'periods_per_year', 'frequency', 'days_in_period', 'working_days_in_period', 'worked_days', 'year_end'];
const RUN_DERIVED_KEYS = ['basis_day', 'tax_year_start', 'tax_year_end', 'period_index', 'periods_remaining', 'first_period_of_year', 'tax_week', 'tax_month', 'periods_paid'];
const EMPLOYEE_KEYS = ['id', 'birth_date', 'age', 'hire_day', 'end_day', 'nationality', 'gender', 'years_of_service'];
const EMPLOYMENT_KEYS = ['id', 'entity_country', 'entity_region', 'work_country', 'work_region', 'fte', 'employment_type'];
const CURRENCY_KEYS = ['code', 'exponent'];
/** Context keys payroll documents and fills when known (others are free data a pack reads with coalesce). */
const CONTEXT_KEYS = ['min_wage_hourly', 'hours_worked'];

function setOf(list) {
  const o = Object.create(null);
  for (let i = 0; i < list.length; i++) o[list[i]] = true;
  return o;
}
const RUN_SET = setOf(RUN_INPUT_KEYS.concat(RUN_DERIVED_KEYS));
const EMPLOYEE_SET = setOf(EMPLOYEE_KEYS);
const EMPLOYMENT_SET = setOf(EMPLOYMENT_KEYS);
const CURRENCY_SET = setOf(CURRENCY_KEYS);

let X = null;
function expr() {
  if (X === null) X = require('./lib_expr.js');
  return X;
}

function has(obj, key) {
  return obj !== null && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key);
}

function isNum(v) {
  return typeof v === 'number' && v === v && v !== Infinity && v !== -Infinity;
}

function textList(v) {
  if (!Array.isArray(v)) return false;
  for (let i = 0; i < v.length; i++) if (typeof v[i] !== 'string') return false;
  return true;
}

// ---------------------------------------------------------------- hashing

/** JSON with object keys sorted at every level, so equal values print equally. */
function stableStringify(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return isNum(v) ? JSON.stringify(v) : 'null';
  if (typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
  if (Array.isArray(v)) {
    let s = '[';
    for (let i = 0; i < v.length; i++) s += (i ? ',' : '') + stableStringify(v[i]);
    return s + ']';
  }
  const keys = Object.keys(v).sort();
  let s = '{';
  let first = true;
  for (let i = 0; i < keys.length; i++) {
    const val = v[keys[i]];
    if (val === undefined || typeof val === 'function') continue;
    s += (first ? '' : ',') + JSON.stringify(keys[i]) + ':' + stableStringify(val);
    first = false;
  }
  return s + '}';
}

/** Two 32-bit FNV-1a passes with different offsets: a 16 hex digit fingerprint (not a security hash). */
function hash(value) {
  const s = typeof value === 'string' ? value : stableStringify(value);
  let h1 = 0x811c9dc5 | 0;
  let h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x01000193) ^ (h2 >>> 15);
  }
  return hex(h1, h2);
}

function hex(h1, h2) {
  const a = (h1 >>> 0).toString(16);
  const b = (h2 >>> 0).toString(16);
  return ('00000000' + a).slice(-8) + ('00000000' + b).slice(-8);
}

/**
 * The output fingerprint. It covers the figures (every line with its code,
 * amount, kind, stage, pack, version, step and tags; the totals; the issues;
 * the vars) token by token, with the hash of each text cached, because a
 * loop over every character of the whole output is slow in Goja. The
 * explanations are derived from the same input and are not hashed.
 */
let textHashes = null;
function textHash(s) {
  if (textHashes === null) textHashes = new Map();
  let h = textHashes.get(s);
  if (h !== undefined) return h;
  let a = 0x811c9dc5 | 0;
  let b = 0x5bd1e995 | 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x01000193) ^ (b >>> 15);
  }
  h = [a, b];
  if (textHashes.size > 50000) textHashes.clear();
  textHashes.set(s, h);
  return h;
}

/** Numbers enter the fingerprint as micro-units split in two 32-bit halves; no value is 0x7fffffff. */
function pushNum(ints, v) {
  if (typeof v !== 'number') {
    ints.push(v === true ? 3 : v === false ? 4 : 0x7fffffff, 0);
    return;
  }
  const n = Math.round(v * 1e6);
  const hi = Math.floor(n / 4294967296);
  ints.push((n - hi * 4294967296) | 0, hi | 0);
}

function pushText(ints, v) {
  const h = textHash(v);
  ints.push(h[0], h[1]);
}

const TOTAL_KEYS = ['gross', 'pre', 'statutory', 'post', 'deductions', 'employer', 'reimbursement', 'net', 'employer_cost'];
const SEP = String.fromCharCode(31);

function fingerprint(out) {
  const ints = [];
  pushText(ints, out.engine + SEP + out.phase);
  for (let i = 0; i < out.lines.length; i++) {
    const l = out.lines[i];
    pushText(ints, l.code + SEP + l.kind + SEP + l.stage + SEP + l.source + SEP + l.pack + SEP + l.pack_version + SEP + l.step + SEP + l.phase + SEP + l.payee + SEP + l.filing + SEP + l.name + SEP + l.tags.join(SEP));
    pushNum(ints, l.amount);
    pushNum(ints, l.qty);
    pushNum(ints, l.rate);
    pushNum(ints, l.base);
    pushNum(ints, l.sort);
  }
  ints.push(77, 77);
  for (let i = 0; i < TOTAL_KEYS.length; i++) pushNum(ints, out.totals[TOTAL_KEYS[i]]);
  ints.push(78, 78);
  for (let i = 0; i < out.issues.length; i++) {
    const it = out.issues[i];
    pushText(ints, it.severity + SEP + it.code + SEP + it.message + SEP + (it.pack === undefined ? '' : it.pack) + SEP + (it.step === undefined ? '' : it.step));
  }
  ints.push(79, 79);
  const packs = Object.keys(out.vars);
  for (let i = 0; i < packs.length; i++) {
    const vars = out.vars[packs[i]];
    const names = Object.keys(vars);
    pushText(ints, packs[i] + SEP + names.join(SEP));
    for (let k = 0; k < names.length; k++) {
      const v = vars[names[k]];
      if (typeof v === 'string') pushText(ints, v);
      else pushNum(ints, v);
    }
  }
  // FNV-1a style mixing with shifts and adds only (exact 32-bit arithmetic, no calls).
  let a = 0x811c9dc5 | 0;
  let b = 0x5bd1e995 | 0;
  for (let i = 0; i < ints.length; i++) {
    const v = ints[i];
    a ^= v;
    a = (a + (a << 1) + (a << 4) + (a << 7) + (a << 8) + (a << 24)) | 0;
    b ^= v;
    b = (b + (b << 3) + (b << 11) + (b << 19)) | 0;
    b ^= b >>> 13;
  }
  return hex(a, b);
}

// ---------------------------------------------------------------- dates per pack

/** The day a pack dates this run by: pay_date (default), period_end or period_start. */
function basisDay(pack, run) {
  const b = pack && pack.date_basis ? pack.date_basis : 'pay_date';
  return run[b];
}

/** The pack's tax year that contains day: { start, end } as YYYY-MM-DD. */
function taxYearOf(pack, day) {
  const E = expr();
  const mmdd = pack && pack.tax_year && pack.tax_year.start ? pack.tax_year.start : '01-01';
  const y = +day.slice(0, 4);
  let start = y + '-' + mmdd;
  if (day < start) start = (y - 1) + '-' + mmdd;
  const next = (+start.slice(0, 4) + 1) + '-' + mmdd;
  return { start: start, end: E.addDays(next, -1) };
}

/**
 * Where this run sits in the pack's tax year. period_index is 1 based;
 * periods_remaining counts the periods AFTER this one (0 in the last);
 * tax_week and tax_month are the week (1 = the first 7 days) and month
 * (1 = from the start day to the day before the same day next month) of
 * the basis day, as HMRC numbers them.
 */
function periodInfo(pack, run) {
  const E = expr();
  const day = basisDay(pack, run);
  const ty = taxYearOf(pack, day);
  const days = E.daysBetween(ty.start, day);
  const sd = +ty.start.slice(8, 10);
  let months = (+day.slice(0, 4) - +ty.start.slice(0, 4)) * 12 + (+day.slice(5, 7) - +ty.start.slice(5, 7));
  if (+day.slice(8, 10) < sd) months -= 1;
  const taxWeek = Math.floor(days / 7) + 1;
  const taxMonth = months + 1;
  let index;
  if (run.frequency === 'monthly') index = taxMonth;
  else if (run.frequency === 'semi_monthly') {
    const anchor = E.addMonths(ty.start, months);
    index = months * 2 + (E.daysBetween(anchor, day) >= 15 ? 2 : 1);
  } else if (run.frequency === 'biweekly') index = Math.floor(days / 14) + 1;
  else index = taxWeek;
  return {
    basis_day: day,
    tax_year_start: ty.start,
    tax_year_end: ty.end,
    period_index: index,
    periods_remaining: Math.max(0, run.periods_per_year - index),
    first_period_of_year: index === 1,
    tax_week: taxWeek,
    tax_month: taxMonth
  };
}

/**
 * From candidate pack versions (any number per code), keep for each code the
 * one in force on its basis day for this run, preferring the latest
 * effective_from. Payroll calls it with the active rows of rule_packs.
 */
function pickVersions(candidates, run) {
  const best = Object.create(null);
  const order = [];
  for (let i = 0; i < candidates.length; i++) {
    const p = candidates[i];
    const day = basisDay(p, run);
    if (!day || day < p.effective_from || (p.effective_to && day > p.effective_to)) continue;
    const cur = best[p.code];
    if (cur === undefined) order.push(p.code);
    if (cur === undefined || p.effective_from > cur.effective_from || (p.effective_from === cur.effective_from && String(p.version) > String(cur.version))) best[p.code] = p;
  }
  const out = [];
  for (let i = 0; i < order.length; i++) out.push(best[order[i]]);
  return out;
}

// ---------------------------------------------------------------- plans (compiled packs)

let planCache = null;
function planCacheMap() {
  if (planCache === null) planCache = new WeakMap();
  return planCache;
}

function compileOpt(src, where, problems) {
  if (src === undefined || src === null || src === '') return null;
  if (typeof src !== 'string') { problems.push(where + ' must be a formula (text)'); return null; }
  try {
    return expr().compile(src);
  } catch (err) {
    problems.push(where + ': ' + err.message);
    return null;
  }
}

function compileSteps(pack, list, phase, problems, unit) {
  const out = [];
  if (list === undefined) return out;
  if (!Array.isArray(list)) { problems.push(phase + ' must be a list of steps'); return out; }
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    const where = phase + '[' + i + ']';
    if (!s || typeof s !== 'object') { problems.push(where + ' is not an object'); continue; }
    const st = { index: i, phase: phase, def: s, when: compileOpt(s.when, where + '.when', problems) };
    if (s.var !== undefined) {
      st.type = 'var';
      st.name = String(s.var);
      st.expr = compileOpt(s.expr, where + '.expr', problems);
      st.otherwise = compileOpt(s.else, where + '.else', problems);
      if (st.expr === null) problems.push(where + ' (var ' + st.name + ') needs "expr"');
    } else if (s.code !== undefined) {
      st.type = 'line';
      st.name = String(s.code);
      st.amount = compileOpt(s.amount, where + '.amount', problems);
      st.qty = compileOpt(s.qty, where + '.qty', problems);
      st.rate = compileOpt(s.rate, where + '.rate', problems);
      st.base = compileOpt(s.base, where + '.base', problems);
      if (st.amount === null) problems.push(where + ' (' + st.name + ') needs "amount"');
      if (!KINDS[s.kind]) problems.push(where + ' (' + st.name + ') kind must be earning, deduction, employer, reimbursement or info');
      if (s.kind === 'deduction' && !DEDUCTION_STAGES[s.stage]) problems.push(where + ' (' + st.name + ') deduction stage must be pre, statutory or post');
      st.stage = s.kind === 'deduction' ? s.stage : '';
      st.tags = Array.isArray(s.tags) ? s.tags.slice() : [];
    } else if (s.check !== undefined) {
      st.type = 'check';
      st.name = String(s.issue || '');
      st.check = compileOpt(s.check, where + '.check', problems);
      if (st.check === null) problems.push(where + ' needs "check"');
      if (!s.issue) problems.push(where + ' check needs "issue" (a snake_case issue code)');
      if (s.severity !== 'blocker' && s.severity !== 'warning') problems.push(where + ' check severity must be blocker or warning');
    } else {
      problems.push(where + ' needs "var", "code" or "check"');
      continue;
    }
    if (s.round !== undefined) {
      const r = s.round;
      if (!r || typeof r !== 'object' || !expr().MODES[r.mode] || !(r.step > 0)) problems.push(where + ' round needs { mode: half_up|half_even|half_down|up|down, step: > 0 }');
      else st.round = { mode: r.mode, step: r.step };
    }
    out.push(st);
  }
  return out;
}

/**
 * Compile a pack once: tables indexed, formulas parsed (shared by formula
 * text), steps checked for shape. Cached per pack object, so the 1,000
 * payslips of one pay run parse each pack once.
 */
function plan(pack) {
  const cache = planCacheMap();
  if (pack && typeof pack === 'object') {
    const hit = cache.get(pack);
    if (hit !== undefined) return hit;
  }
  const problems = [];
  const p = { code: '', version: '', order: 0, tables: Object.create(null), steps: [], yearEnd: [], fields: [], problems: problems };
  if (!pack || typeof pack !== 'object') { problems.push('the pack is not an object'); return p; }
  p.code = String(pack.code || '');
  p.version = String(pack.version || '');
  p.order = isNum(pack.order) ? pack.order : 0;
  if (!p.code) problems.push('the pack has no code');
  const tables = pack.tables || {};
  if (typeof tables !== 'object' || Array.isArray(tables)) problems.push('tables must be an object of named tables');
  else {
    const names = Object.keys(tables);
    for (let i = 0; i < names.length; i++) {
      try {
        p.tables[names[i]] = expr().prepareTable(names[i], tables[names[i]]);
      } catch (err) {
        problems.push(err.message);
      }
    }
  }
  if (!Array.isArray(pack.steps) || pack.steps.length === 0) problems.push('the pack needs a non-empty steps list');
  p.steps = compileSteps(pack, pack.steps, 'steps', problems);
  p.yearEnd = compileSteps(pack, pack.year_end_steps, 'year_end_steps', problems);
  p.fields = Array.isArray(pack.profile_fields) ? pack.profile_fields : [];
  cache.set(pack, p);
  return p;
}

// ---------------------------------------------------------------- input

function inputProblems(input) {
  const E = expr();
  const out = [];
  if (!input || typeof input !== 'object') return ['the input is not an object'];
  const run = input.run;
  if (!run || typeof run !== 'object') return ['input.run is missing'];
  if (!RUN_KINDS[run.kind]) out.push('run.kind must be regular, off_cycle, bonus, termination, correction or reimbursement');
  for (const k of ['period_start', 'period_end', 'pay_date']) if (!E.isDay(run[k])) out.push('run.' + k + ' must be a day YYYY-MM-DD');
  if (E.isDay(run.period_start) && E.isDay(run.period_end) && run.period_end < run.period_start) out.push('run.period_end is before run.period_start');
  if (!FREQUENCIES[run.frequency]) out.push('run.frequency must be monthly, semi_monthly, biweekly or weekly');
  if (!isNum(run.periods_per_year) || run.periods_per_year < 1 || Math.floor(run.periods_per_year) !== run.periods_per_year) out.push('run.periods_per_year must be a whole number of 1 or more');
  for (const k of ['days_in_period', 'working_days_in_period', 'worked_days']) if (run[k] !== undefined && run[k] !== null && !(isNum(run[k]) && run[k] >= 0)) out.push('run.' + k + ' must be a number of 0 or more');
  if (run.year_end !== undefined && typeof run.year_end !== 'boolean') out.push('run.year_end must be true or false');
  const cur = input.currency;
  if (!cur || typeof cur.code !== 'string' || !isNum(cur.exponent) || cur.exponent < 0 || cur.exponent > 4 || Math.floor(cur.exponent) !== cur.exponent) out.push('input.currency needs { code, exponent 0 to 4 }');
  if (!Array.isArray(input.lines)) out.push('input.lines must be a list (it may be empty)');
  else {
    for (let i = 0; i < input.lines.length; i++) {
      const l = input.lines[i];
      const at = 'lines[' + i + ']';
      if (!l || typeof l !== 'object') { out.push(at + ' is not an object'); continue; }
      if (typeof l.code !== 'string' || l.code === '') out.push(at + ' needs a code');
      if (!KINDS[l.kind]) out.push(at + ' (' + l.code + ') kind must be earning, deduction, employer, reimbursement or info');
      if (!isNum(l.amount)) out.push(at + ' (' + l.code + ') amount must be a number');
      if (l.kind === 'deduction' && l.stage !== undefined && l.stage !== '' && !DEDUCTION_STAGES[l.stage]) out.push(at + ' (' + l.code + ') stage must be pre, statutory, post or empty');
      if (l.tags !== undefined && !textList(l.tags)) out.push(at + ' (' + l.code + ') tags must be a list of text');
    }
  }
  if (!Array.isArray(input.history)) out.push('input.history must be a list of earlier payslips (it may be empty)');
  else {
    for (let i = 0; i < input.history.length; i++) {
      const h = input.history[i];
      const at = 'history[' + i + ']';
      if (!h || typeof h !== 'object') { out.push(at + ' is not an object'); continue; }
      if (!E.isDay(h.pay_date)) out.push(at + ' needs pay_date');
      if (h.period_start !== undefined && h.period_start !== '' && !E.isDay(h.period_start)) out.push(at + '.period_start must be a day');
      if (h.period_end !== undefined && h.period_end !== '' && !E.isDay(h.period_end)) out.push(at + '.period_end must be a day');
      if (typeof h.kind !== 'string') out.push(at + ' needs kind');
      if (h.by_tag !== undefined && (!h.by_tag || typeof h.by_tag !== 'object' || Array.isArray(h.by_tag))) out.push(at + '.by_tag must be an object of amounts');
      if (h.by_code !== undefined && (!h.by_code || typeof h.by_code !== 'object' || Array.isArray(h.by_code))) out.push(at + '.by_code must be an object of amounts');
    }
  }
  if (!E.isDay(input.history_from)) out.push('input.history_from must be a day (the first day the history is complete from)');
  return out;
}

/**
 * Fill a partial input with defaults for pack vectors and previews: a
 * monthly regular run for the first full month the pack is in force, no
 * lines, no history, and currency from the pack.
 */
function completeInput(partial, pack) {
  const E = expr();
  const p = partial || {};
  const eff = pack && E.isDay(pack.effective_from) ? pack.effective_from : '2026-01-01';
  let start = eff.slice(8, 10) === '01' ? eff : E.addMonths(eff.slice(0, 8) + '01', 1);
  const pr = p.run || {};
  if (E.isDay(pr.period_start)) start = pr.period_start;
  const end = E.addDays(E.addMonths(start.slice(0, 8) + '01', 1), -1);
  const run = {
    kind: 'regular',
    period_start: start,
    period_end: end,
    pay_date: end,
    periods_per_year: 12,
    frequency: 'monthly',
    days_in_period: E.daysBetween(start, end) + 1,
    working_days_in_period: 21,
    worked_days: 21,
    year_end: false
  };
  for (const k of Object.keys(pr)) run[k] = pr[k];
  const code = (p.currency && p.currency.code) || (pack && pack.currency) || 'USD';
  const currency = { code: code, exponent: p.currency && isNum(p.currency.exponent) ? p.currency.exponent : exponentOf(code) };
  return {
    run: run,
    employee: Object.assign({ id: 'vector', birth_date: '1990-01-01', age: null, hire_day: '2020-01-01', end_day: null, nationality: (pack && pack.country) || '', gender: '', years_of_service: null }, p.employee || {}),
    employment: Object.assign({ id: 'vector', entity_country: (pack && pack.country) || '', entity_region: (pack && pack.region) || '', work_country: (pack && pack.country) || '', work_region: (pack && pack.region) || '', fte: 1, employment_type: 'full_time' }, p.employment || {}),
    profile: Object.assign({}, p.profile || {}),
    entity: Object.assign({}, p.entity || {}),
    currency: currency,
    lines: Array.isArray(p.lines) ? p.lines : [],
    history: Array.isArray(p.history) ? p.history : [],
    history_from: E.isDay(p.history_from) ? p.history_from : '1900-01-01',
    context: Object.assign({}, p.context || {})
  };
}

/** Minor-unit exponents for vector and preview defaults (payroll passes lib_money's value). */
function exponentOf(code) {
  const zero = { JPY: 1, KRW: 1, VND: 1, CLP: 1, ISK: 1, UGX: 1, PYG: 1, XAF: 1, XOF: 1, XPF: 1, RWF: 1, KMF: 1, GNF: 1, DJF: 1, VUV: 1 };
  const three = { KWD: 1, BHD: 1, OMR: 1, JOD: 1, TND: 1, LYD: 1, IQD: 1 };
  if (zero[code]) return 0;
  if (three[code]) return 3;
  return 2;
}

// ---------------------------------------------------------------- fields

/** Coerce one field value by its declared type. Returns { ok, value } or { ok: false, why }. */
function coerce(field, raw) {
  const E = expr();
  const t = field.type;
  const missing = raw === undefined || raw === null || (raw === '' && t !== 'text');
  if (missing) return { ok: true, value: null, missing: true };
  if (t === 'number' || t === 'money') {
    const v = typeof raw === 'number' ? raw : typeof raw === 'string' && E.plainNumber(raw.trim()) ? Number(raw.trim()) : NaN;
    if (!isNum(v)) return { ok: false, why: 'is not a number' };
    if (isNum(field.min) && v < field.min) return { ok: false, why: 'is below ' + field.min };
    if (isNum(field.max) && v > field.max) return { ok: false, why: 'is above ' + field.max };
    return { ok: true, value: v };
  }
  if (t === 'boolean') {
    if (raw === true || raw === 'true' || raw === 1) return { ok: true, value: true };
    if (raw === false || raw === 'false' || raw === 0) return { ok: true, value: false };
    return { ok: false, why: 'is not true or false' };
  }
  if (t === 'enum') {
    const v = String(raw);
    const opts = Array.isArray(field.options) ? field.options : [];
    for (let i = 0; i < opts.length; i++) if (String(opts[i].value) === v) return { ok: true, value: v };
    return { ok: false, why: 'is not one of ' + opts.map((o) => o.value).join(', ') };
  }
  if (t === 'date') {
    if (!E.isDay(raw)) return { ok: false, why: 'is not a day YYYY-MM-DD' };
    return { ok: true, value: raw };
  }
  return { ok: true, value: String(raw) };
}

/**
 * Build the profile and entity values every pack in the run declared:
 * the person's (or entity's) value, else the field's default, else no value.
 */
function buildFields(plans, input, issues) {
  const decl = { profile: Object.create(null), entity: Object.create(null) };
  const vals = { profile: Object.create(null), entity: Object.create(null) };
  const bad = Object.create(null);
  for (let pi = 0; pi < plans.length; pi++) {
    const pl = plans[pi];
    for (let i = 0; i < pl.fields.length; i++) {
      const f = pl.fields[i];
      if (!f || typeof f.key !== 'string' || !FIELD_TYPES[f.type]) continue;
      const scope = f.scope === 'entity' ? 'entity' : 'profile';
      const prior = decl[scope][f.key];
      if (prior !== undefined) {
        if (prior.field.type !== f.type) issues.push(issue('blocker', 'field_conflict', 'Packs ' + prior.pack + ' and ' + pl.code + ' declare ' + scope + '.' + f.key + ' with different types', { pack: pl.code, field: f.key }));
        continue;
      }
      decl[scope][f.key] = { pack: pl.code, field: f };
      const source = scope === 'entity' ? input.entity : input.profile;
      const raw = source && has(source, f.key) ? source[f.key] : undefined;
      const c = coerce(f, raw);
      if (!c.ok) {
        issues.push(issue('blocker', scope + '_invalid', (f.label || f.key) + ' ' + c.why, { pack: pl.code, field: f.key, scope: scope }));
        vals[scope][f.key] = null;
        bad[pl.code] = true;
        continue;
      }
      let v = c.value;
      if (c.missing && f.default !== undefined && f.default !== null) {
        const d = coerce(f, f.default);
        v = d.ok ? d.value : null;
      }
      if (v === null && f.required) {
        issues.push(issue('blocker', scope + '_missing', (f.label || f.key) + ' is needed' + (f.form ? ' (' + f.form + ')' : ''), { pack: pl.code, field: f.key, scope: scope }));
        bad[pl.code] = true;
      }
      vals[scope][f.key] = v;
    }
  }
  return { decl: decl, vals: vals, bad: bad };
}

function issue(severity, code, message, extra) {
  const o = { severity: severity, code: code, message: message };
  if (extra) for (const k of Object.keys(extra)) o[k] = extra[k];
  return o;
}

// ---------------------------------------------------------------- history

/** The day an earlier payslip counts on for a pack: its date basis day when the history row has it, else its pay date. */
function historyDay(h, pack) {
  const b = pack && pack.date_basis ? pack.date_basis : 'pay_date';
  const d = h[b];
  return typeof d === 'string' && d !== '' ? d : h.pay_date;
}

function addInto(target, src) {
  if (!src) return;
  const keys = Object.keys(src);
  for (let i = 0; i < keys.length; i++) {
    const v = src[keys[i]];
    if (isNum(v)) target[keys[i]] = (target[keys[i]] || 0) + v;
  }
}

/** Year-to-date sums for one pack from the history: all kinds, dated inside the pack's tax year. */
function ytdFor(pack, info, input) {
  const byTag = Object.create(null);
  const byCode = Object.create(null);
  let periodsPaid = 0;
  for (let i = 0; i < input.history.length; i++) {
    const h = input.history[i];
    const d = historyDay(h, pack);
    if (d < info.tax_year_start || d > info.tax_year_end) continue;
    addInto(byTag, h.by_tag);
    addInto(byCode, h.by_code);
    if (h.kind === 'regular') periodsPaid++;
  }
  return { byTag: byTag, byCode: byCode, periodsPaid: periodsPaid };
}

/** The most recent earlier regular payslip in the history (by pay date, then period end, then id). */
function prevRegular(input) {
  let best = null;
  const pay = input.run.pay_date;
  for (let i = 0; i < input.history.length; i++) {
    const h = input.history[i];
    if (h.kind !== 'regular' || h.pay_date > pay) continue;
    if (best === null || h.pay_date > best.pay_date || (h.pay_date === best.pay_date && (String(h.period_end || '') > String(best.period_end || '') || (String(h.period_end || '') === String(best.period_end || '') && String(h.id || '') > String(best.id || ''))))) best = h;
  }
  return best;
}

// ---------------------------------------------------------------- the run

function roundTo(x, step, mode) {
  return expr().roundStep(x, step, mode);
}

function unitOf(input) {
  return 1 / Math.pow(10, input.currency.exponent);
}

/** Running totals: gross, deductions by stage, employer, reimbursement, net. */
function newTotals() {
  return { gross: 0, pre: 0, statutory: 0, post: 0, deductions: 0, employer: 0, reimbursement: 0, info: 0, net: 0 };
}

function addTotal(t, line) {
  const a = line.amount;
  if (line.kind === 'earning') t.gross += a;
  else if (line.kind === 'deduction') {
    if (line.stage === 'pre') t.pre += a;
    else if (line.stage === 'statutory') t.statutory += a;
    else t.post += a;
    t.deductions += a;
  } else if (line.kind === 'employer') t.employer += a;
  else if (line.kind === 'reimbursement') t.reimbursement += a;
  else t.info += a;
  t.net = t.gross - t.deductions + t.reimbursement;
}

function evaluate(input, packs, phase) {
  const E = expr();
  const issues = [];
  const out = { engine: VERSION, phase: phase, lines: [], totals: null, issues: issues, vars: {}, explain: { packs: [], vars: {} }, hash: '' };

  const bad = inputProblems(input);
  if (bad.length > 0) {
    for (let i = 0; i < bad.length; i++) issues.push(issue('blocker', 'input_invalid', bad[i]));
    return finish(out, newTotals(), input && input.currency && isNum(input.currency.exponent) ? input.currency.exponent : 2);
  }
  const exp = input.currency.exponent;
  const unit = unitOf(input);
  const run = input.run;
  const yearEndRun = phase === 'year_end' || run.year_end === true;

  // Order packs and compile them.
  let list = [];
  const seen = Object.create(null);
  for (let i = 0; i < (packs || []).length; i++) {
    const pk = packs[i];
    const pl = plan(pk);
    if (pl.code && seen[pl.code]) { issues.push(issue('blocker', 'pack_duplicate', 'Pack ' + pl.code + ' is given twice', { pack: pl.code })); continue; }
    if (pl.code) seen[pl.code] = true;
    list.push({ pack: pk, plan: pl });
  }
  if (phase === 'year_end') {
    // A year-end run keeps the packs with year_end_steps and the packs they require.
    const keep = Object.create(null);
    const byCode = Object.create(null);
    for (let i = 0; i < list.length; i++) byCode[list[i].plan.code] = list[i];
    const walk = function (it) {
      if (keep[it.plan.code] === true) return;
      keep[it.plan.code] = true;
      const req = Array.isArray(it.pack.requires) ? it.pack.requires : [];
      for (let r = 0; r < req.length; r++) if (byCode[req[r]] !== undefined) walk(byCode[req[r]]);
    };
    for (let i = 0; i < list.length; i++) if (list[i].plan.yearEnd.length > 0) walk(list[i]);
    list = list.filter((it) => keep[it.plan.code] === true);
  }
  list.sort((a, b) => (a.plan.order !== b.plan.order ? a.plan.order - b.plan.order : a.plan.code < b.plan.code ? -1 : a.plan.code > b.plan.code ? 1 : 0));

  const active = [];
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    const pl = it.plan;
    if (pl.problems.length > 0) {
      issues.push(issue('blocker', 'pack_invalid', 'Pack ' + (pl.code || '(no code)') + ' cannot run: ' + pl.problems.slice(0, 3).join('; '), { pack: pl.code, version: pl.version, problems: pl.problems.slice() }));
      continue;
    }
    const req = Array.isArray(it.pack.requires) ? it.pack.requires : [];
    let missing = '';
    for (let r = 0; r < req.length; r++) if (!seen[req[r]]) missing = req[r];
    if (missing) {
      issues.push(issue('blocker', 'pack_missing', 'Pack ' + pl.code + ' needs pack ' + missing + ' in the same calculation', { pack: pl.code, requires: missing }));
      continue;
    }
    const day = basisDay(it.pack, run);
    if (day < it.pack.effective_from || (it.pack.effective_to && day > it.pack.effective_to)) {
      issues.push(issue('blocker', 'pack_not_in_force', 'Pack ' + pl.code + ' ' + pl.version + ' is in force ' + it.pack.effective_from + ' to ' + (it.pack.effective_to || 'open') + ', not on ' + day, { pack: pl.code, version: pl.version, day: day }));
      continue;
    }
    active.push(it);
  }

  const fields = buildFields(active.map((it) => it.plan), input, issues);

  // Payslip state shared by all packs.
  const lines = [];
  const totals = newTotals();
  const tagSum = Object.create(null);
  const codeSum = Object.create(null);
  const lineVal = Object.create(null);
  const laterCodes = Object.create(null);
  for (let i = 0; i < active.length; i++) {
    const steps = active[i].plan.steps.concat(yearEndRun ? active[i].plan.yearEnd : []);
    for (let s = 0; s < steps.length; s++) if (steps[s].type === 'line') laterCodes[steps[s].name] = active[i].plan.code;
  }

  function emit(line) {
    lines.push(line);
    addTotal(totals, line);
    codeSum[line.code] = (codeSum[line.code] || 0) + line.amount;
    for (let i = 0; i < line.tags.length; i++) tagSum[line.tags[i]] = (tagSum[line.tags[i]] || 0) + line.amount;
  }

  const inputCodes = Object.create(null);
  for (let i = 0; i < input.lines.length; i++) {
    const l = input.lines[i];
    inputCodes[l.code] = true;
    const line = {
      code: l.code,
      name: typeof l.name === 'string' && l.name ? l.name : l.code,
      kind: l.kind,
      stage: l.kind === 'deduction' ? (DEDUCTION_STAGES[l.stage] ? l.stage : 'post') : '',
      amount: roundTo(l.amount, unit, 'half_up'),
      qty: isNum(l.qty) ? l.qty : null,
      rate: isNum(l.rate) ? l.rate : null,
      base: isNum(l.base) ? l.base : null,
      tags: Array.isArray(l.tags) ? l.tags.slice() : [],
      source: 'input',
      pack: '',
      pack_version: '',
      step: -1,
      phase: '',
      sort: isNum(l.sort) ? l.sort : i,
      payee: '',
      filing: '',
      explain: { source: 'input' }
    };
    if (l.ref !== undefined) line.ref = l.ref;
    if (l.component !== undefined) line.component = l.component;
    emit(line);
  }

  const prev = prevRegular(input);
  const ytdCache = Object.create(null);
  const employee = input.employee || {};
  const employment = input.employment || {};
  const context = input.context || {};

  for (let pi = 0; pi < active.length; pi++) {
    const pack = active[pi].pack;
    const pl = active[pi].plan;
    const info = periodInfo(pack, run);
    const ytdKey = (pack.date_basis || 'pay_date') + '|' + info.tax_year_start;
    let ytd = ytdCache[ytdKey];
    if (ytd === undefined) { ytd = ytdFor(pack, info, input); ytdCache[ytdKey] = ytd; }
    info.periods_paid = ytd.periodsPaid;
    const runView = Object.create(null);
    for (let k = 0; k < RUN_INPUT_KEYS.length; k++) {
      const key = RUN_INPUT_KEYS[k];
      runView[key] = run[key] === undefined ? (key === 'year_end' ? yearEndRun : null) : run[key];
    }
    if (phase === 'year_end') runView.year_end = true;
    for (let k = 0; k < RUN_DERIVED_KEYS.length; k++) runView[RUN_DERIVED_KEYS[k]] = info[RUN_DERIVED_KEYS[k]];

    if (info.tax_year_start < input.history_from && E.isDay(employee.hire_day) && input.history_from > employee.hire_day) {
      issues.push(issue('blocker', 'history_short', 'The payslip history starts ' + input.history_from + ', after the start of the ' + pl.code + ' tax year ' + info.tax_year_start, { pack: pl.code }));
    }

    out.explain.packs.push({ code: pl.code, version: pl.version, order: pl.order, basis_day: info.basis_day, tax_year_start: info.tax_year_start, tax_year_end: info.tax_year_end, period_index: info.period_index, periods_remaining: info.periods_remaining, periods_paid: info.periods_paid, skipped: fields.bad[pl.code] === true });
    // A pack whose own fields are missing or invalid does not run: the field issue says what to fix.
    if (fields.bad[pl.code] === true) {
      const steps0 = pl.steps.concat(yearEndRun ? pl.yearEnd : []);
      for (let s = 0; s < steps0.length; s++) if (steps0[s].type === 'line') lineVal[steps0[s].name] = 0;
      continue;
    }
    const vars = Object.create(null);
    const varsExplain = {};
    const varsOut = {};

    let reads = [];
    let used = null;
    function note(name, value) {
      for (let i = 0; i < reads.length; i++) if (reads[i].name === name) return;
      reads.push({ name: name, value: value === undefined ? null : value });
    }

    const env = {
      name: function (path, text) {
        let v;
        if (path.length === 1) {
          const k = path[0];
          if (vars[k] === undefined) {
            throw E.exprError('expr_name', 'unknown name ' + k + ' (not a var set by an earlier step of pack ' + pl.code + ')');
          }
          v = vars[k];
        } else {
          const root = path[0];
          const key = path[1];
          if (root === 'context') {
            let o = context;
            for (let i = 1; i < path.length; i++) {
              o = o !== null && typeof o === 'object' && !Array.isArray(o) && has(o, path[i]) ? o[path[i]] : null;
            }
            if (o !== null && typeof o === 'object') throw E.exprError('expr_type', text + ' is a group of values, not one value');
            v = o === undefined ? null : o;
          } else {
            if (path.length !== 2) throw E.exprError('expr_name', 'unknown name ' + text);
            if (root === 'run') {
              if (RUN_SET[key] !== true) throw E.exprError('expr_name', 'unknown name ' + text + ' (run has ' + RUN_INPUT_KEYS.concat(RUN_DERIVED_KEYS).join(', ') + ')');
              v = runView[key];
            } else if (root === 'employee') {
              if (EMPLOYEE_SET[key] !== true) throw E.exprError('expr_name', 'unknown name ' + text + ' (employee has ' + EMPLOYEE_KEYS.join(', ') + ')');
              v = has(employee, key) ? employee[key] : null;
            } else if (root === 'employment') {
              if (EMPLOYMENT_SET[key] !== true) throw E.exprError('expr_name', 'unknown name ' + text + ' (employment has ' + EMPLOYMENT_KEYS.join(', ') + ')');
              v = has(employment, key) ? employment[key] : null;
            } else if (root === 'currency') {
              if (CURRENCY_SET[key] !== true) throw E.exprError('expr_name', 'unknown name ' + text + ' (currency has code, exponent)');
              v = input.currency[key];
            } else {
              if (fields.decl[root][key] === undefined) throw E.exprError('expr_name', 'unknown name ' + text + ' (no pack in this calculation declares the ' + (root === 'entity' ? 'entity' : 'profile') + ' field ' + key + ')');
              v = fields.vals[root][key];
            }
            if (v === undefined) v = null;
          }
        }
        note(text, v);
        return v;
      },
      sum: function (tag) { const v = E.snap(tagSum[tag] || 0); note('sum("' + tag + '")', v); return v; },
      sumCode: function (code) { const v = E.snap(codeSum[code] || 0); note('sum_code("' + code + '")', v); return v; },
      line: function (code) {
        if (lineVal[code] === undefined) {
          if (laterCodes[code] !== undefined) throw E.exprError('expr_name', 'line("' + code + '") is computed later (pack ' + laterCodes[code] + '); steps run in pack order');
          if (inputCodes[code]) throw E.exprError('expr_name', 'line("' + code + '") is an input line; read it with sum_code("' + code + '")');
          throw E.exprError('expr_name', 'line("' + code + '"): no step in this calculation emits ' + code);
        }
        const v = lineVal[code];
        note('line("' + code + '")', v);
        return v;
      },
      ytd: function (tag) { const v = E.snap(ytd.byTag[tag] || 0); note('ytd("' + tag + '")', v); return v; },
      ytdCode: function (code) { const v = E.snap(ytd.byCode[code] || 0); note('ytd_code("' + code + '")', v); return v; },
      since: function (key, day, isCode) {
        if (day < input.history_from && E.isDay(employee.hire_day) && input.history_from > employee.hire_day) {
          throw E.exprError('history_short', (isCode ? 'ytd_code_since' : 'ytd_since') + '("' + key + '", "' + day + '") reaches before the payslip history, which starts ' + input.history_from);
        }
        let sum = 0;
        for (let i = 0; i < input.history.length; i++) {
          const h = input.history[i];
          if (historyDay(h, pack) < day) continue;
          const m = isCode ? h.by_code : h.by_tag;
          if (m && isNum(m[key])) sum += m[key];
        }
        const v = E.snap(sum);
        note((isCode ? 'ytd_code_since("' : 'ytd_since("') + key + '", "' + day + '")', v);
        return v;
      },
      prev: function (key, isCode) {
        const m = prev === null ? null : isCode ? prev.by_code : prev.by_tag;
        const v = m && isNum(m[key]) ? E.snap(m[key]) : 0;
        note((isCode ? 'prev_regular_code("' : 'prev_regular("') + key + '")', v);
        return v;
      },
      inMonth: function (key, day, what) {
        const ym = day.slice(0, 7);
        let sum = 0;
        for (let i = 0; i < input.history.length; i++) {
          const h = input.history[i];
          if (h.kind !== 'regular' || historyDay(h, pack).slice(0, 7) !== ym) continue;
          if (what === 'count') { sum += 1; continue; }
          const m = what === 'code' ? h.by_code : h.by_tag;
          if (m && isNum(m[key])) sum += m[key];
        }
        const v = E.snap(sum);
        note(what === 'count' ? 'regular_count_in_month("' + day + '")' : (what === 'code' ? 'regular_in_month_code("' : 'regular_in_month("') + key + '", "' + day + '")', v);
        return v;
      },
      prevDate: function () {
        const v = prev === null ? '' : prev.pay_date;
        note('prev_regular_date()', v);
        return v;
      },
      total: function (group) {
        if (TOTAL_GROUPS[group] !== true) throw E.exprError('expr_name', 'total("' + group + '"): use gross, pre, statutory, post, deductions, employer, reimbursement or net');
        const v = roundTo(totals[group], unit, 'half_up');
        note('total("' + group + '")', v);
        return v;
      },
      table: function (name, type) {
        const t = pl.tables[name];
        if (t === undefined) throw E.exprError('expr_table', 'pack ' + pl.code + ' has no table "' + name + '"');
        if (t.type !== type) throw E.exprError('expr_table', 'table "' + name + '" is a ' + t.type + ' table, not ' + type);
        return t;
      },
      used: function (u) { if (used === null) used = []; used.push(u); },
      birthDate: function () { note('employee.birth_date', employee.birth_date === undefined ? null : employee.birth_date); return employee.birth_date; }
    };

    const steps = yearEndRun ? pl.steps.concat(pl.yearEnd) : pl.steps;
    for (let si = 0; si < steps.length; si++) {
      const st = steps[si];
      const def = st.def;
      let field = 'when';
      reads = [];
      used = null;
      try {
        let on = true;
        if (st.when !== null) {
          const w = st.when.run(env);
          if (typeof w !== 'boolean') throw E.exprError('expr_type', 'when must give true or false, got ' + (w === null ? 'no value' : String(w)));
          on = w;
        }
        if (st.type === 'var') {
          let v;
          field = on ? 'expr' : 'else';
          if (on) v = st.expr.run(env);
          else v = st.otherwise !== null ? st.otherwise.run(env) : 0;
          if (v === null || v === undefined) throw E.exprError('expr_type', 'var ' + st.name + ' has no value (use coalesce to give one)');
          if (st.round && typeof v === 'number') v = roundTo(v, st.round.step, st.round.mode);
          vars[st.name] = v;
          varsOut[st.name] = v;
          const ex = { expr: on ? def.expr : def.else === undefined ? '0' : def.else, value: v, reads: reads };
          if (def.when !== undefined) ex.when = def.when;
          if (used !== null) ex.tables = used;
          if (def.explain) ex.note = def.explain;
          varsExplain[st.name] = ex;
          continue;
        }
        if (st.type === 'check') {
          if (!on) continue;
          field = 'check';
          const ok = st.check.run(env);
          if (typeof ok !== 'boolean') throw E.exprError('expr_type', 'check must give true or false');
          if (!ok) issues.push(issue(def.severity, def.issue, def.message || def.issue, { pack: pl.code, version: pl.version, step: st.index, phase: st.phase, reads: reads }));
          continue;
        }
        // a line step
        if (!on) {
          lineVal[st.name] = 0;
          continue;
        }
        if (lineVal[st.name] !== undefined || inputCodes[st.name]) throw E.exprError('expr_name', 'the code ' + st.name + ' is already on this payslip');
        field = 'amount';
        const amount = st.amount.run(env);
        if (typeof amount !== 'number') throw E.exprError('expr_type', 'amount must be a number, got ' + (amount === null ? 'no value' : JSON.stringify(amount)));
        const amountReads = reads;
        const r = st.round || { mode: 'half_up', step: unit };
        let value = roundTo(amount, r.step, r.mode);
        if (r.step !== unit) value = roundTo(value, unit, 'half_up');
        let qty = null, rate = null, base = null;
        if (st.qty !== null) { field = 'qty'; qty = st.qty.run(env); if (typeof qty !== 'number') throw E.exprError('expr_type', 'qty must be a number'); }
        if (st.rate !== null) { field = 'rate'; rate = st.rate.run(env); if (typeof rate !== 'number') throw E.exprError('expr_type', 'rate must be a number'); }
        if (st.base !== null) { field = 'base'; base = st.base.run(env); if (typeof base !== 'number') throw E.exprError('expr_type', 'base must be a number'); base = roundTo(base, unit, 'half_up'); }
        lineVal[st.name] = value;
        if (value === 0 && def.keep_zero !== true) continue;
        const ex = { expr: def.amount, value: E.snap(amount), rounded: { mode: r.mode, step: r.step }, reads: amountReads };
        if (def.when !== undefined) ex.when = def.when;
        if (used !== null) ex.tables = used;
        if (def.explain) ex.note = def.explain;
        emit({
          code: st.name,
          name: typeof def.name === 'string' && def.name ? def.name : st.name,
          kind: def.kind,
          stage: st.stage,
          amount: value,
          qty: qty === null ? null : E.snap(qty),
          rate: rate === null ? null : E.snap(rate),
          base: base,
          tags: st.tags.slice(),
          source: 'pack',
          pack: pl.code,
          pack_version: pl.version,
          step: st.index,
          phase: st.phase === 'steps' ? '' : 'year_end',
          sort: pl.order * 1000 + (st.phase === 'steps' ? 0 : 500) + st.index,
          payee: typeof def.payee === 'string' ? def.payee : '',
          filing: typeof def.filing === 'string' ? def.filing : '',
          explain: ex
        });
      } catch (err) {
        issues.push(issue('blocker', 'step_error', 'Pack ' + pl.code + ' ' + st.phase + '[' + st.index + '] (' + st.name + ') ' + field + ': ' + (err && err.message ? err.message : String(err)), {
          pack: pl.code,
          version: pl.version,
          step: st.index,
          phase: st.phase,
          name: st.name,
          field: field,
          error: err && err.code ? err.code : 'internal'
        }));
        break;
      }
    }
    out.vars[pl.code] = varsOut;
    out.explain.vars[pl.code] = varsExplain;
  }

  out.lines = lines;

  // Checks on the whole payslip.
  const t = finalTotals(totals, exp);
  if (t.net < 0) issues.push(issue('blocker', 'negative_net', 'Net pay is negative (' + t.net + ')', { net: t.net }));
  if (t.gross === 0 && run.kind !== 'reimbursement' && phase !== 'year_end') issues.push(issue('warning', 'zero_gross', 'Gross pay is zero'));
  // Minimum wage applies to ordinary pay for hours worked: regular runs with known hours only
  // (never bonus, off-cycle, termination, correction or reimbursement runs).
  const hours = context.hours_worked;
  if (run.kind === 'regular' && isNum(hours) && hours > 0) {
    let ref = isNum(context.min_wage_hourly) ? context.min_wage_hourly : 0;
    let source = isNum(context.min_wage_hourly) ? 'context' : '';
    for (let i = 0; i < active.length; i++) {
      const mw = active[i].pack.min_wage;
      if (mw && isNum(mw.hourly) && mw.hourly > ref) { ref = mw.hourly; source = active[i].plan.code; }
    }
    if (ref > 0) {
      const rate = E.snap(t.gross / hours);
      if (rate < ref) issues.push(issue('warning', 'below_min_wage', 'Gross pay per hour ' + roundTo(rate, 0.01, 'half_up') + ' is below the minimum wage reference ' + ref + ' (' + source + ')', { rate: roundTo(rate, 0.0001, 'half_up'), minimum: ref, source: source }));
    }
  }
  return finish(out, totals, exp);
}

function finalTotals(t, exp) {
  const unit = 1 / Math.pow(10, exp);
  const o = {};
  const keys = ['gross', 'pre', 'statutory', 'post', 'deductions', 'employer', 'reimbursement', 'net'];
  for (let i = 0; i < keys.length; i++) o[keys[i]] = roundTo(t[keys[i]], unit, 'half_up');
  o.employer_cost = roundTo(t.gross + t.employer + t.reimbursement, unit, 'half_up');
  return o;
}

function finish(out, totals, exp) {
  out.totals = finalTotals(totals, exp);
  out.hash = fingerprint(out);
  return out;
}

/** One payslip: every pack's steps (and year_end_steps when run.year_end is true). */
function calculate(input, packs) {
  return evaluate(input, packs, 'steps');
}

/** A year-end run: only packs with year_end_steps run, steps then year_end_steps, run.year_end forced true. */
function yearEnd(input, packs) {
  return evaluate(input, packs, 'year_end');
}

/** One pack on a partial input (defaults as for vectors); others are packs it requires. */
function preview(pack, input, others) {
  return calculate(completeInput(input, pack), [pack].concat(others || []));
}

const constants = {
  VERSION: VERSION,
  HISTORY_DAYS: HISTORY_DAYS,
  KINDS: Object.keys(KINDS),
  DEDUCTION_STAGES: Object.keys(DEDUCTION_STAGES),
  FREQUENCIES: Object.keys(FREQUENCIES),
  RUN_KINDS: Object.keys(RUN_KINDS),
  DATE_BASES: Object.keys(DATE_BASES),
  FIELD_TYPES: Object.keys(FIELD_TYPES),
  TOTAL_GROUPS: Object.keys(TOTAL_GROUPS),
  RUN_INPUT_KEYS: RUN_INPUT_KEYS,
  RUN_DERIVED_KEYS: RUN_DERIVED_KEYS,
  EMPLOYEE_KEYS: EMPLOYEE_KEYS,
  EMPLOYMENT_KEYS: EMPLOYMENT_KEYS,
  CURRENCY_KEYS: CURRENCY_KEYS,
  CONTEXT_KEYS: CONTEXT_KEYS
};

module.exports = { calculate: calculate, yearEnd: yearEnd, preview: preview, completeInput: completeInput, periodInfo: periodInfo, taxYearOf: taxYearOf, basisDay: basisDay, pickVersions: pickVersions, plan: plan, hash: hash, fingerprint: fingerprint, stableStringify: stableStringify, exponentOf: exponentOf, constants: constants };
