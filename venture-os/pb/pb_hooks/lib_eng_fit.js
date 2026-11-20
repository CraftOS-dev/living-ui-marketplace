/**
 * Thesis fit (REPORT Table 33; tri-state like the YC app's lib_checks.js).
 *
 * Each criterion of a thesis is met, unmet or unknown from the deal's facts.
 * Unknown never reads as no: a fact that is missing, null or graded
 * `unknown` makes its criterion unknown, required or not. There is no total
 * score; the summary only counts and gives the required criteria's state:
 *   unmet   when any required criterion is unmet,
 *   unknown when none is unmet and any required one is unknown,
 *   met     otherwise.
 *
 * Facts: { [key]: { value, grade } } over the fact keys of SPEC 7.2. A fact
 * recorded as empty ('' or []) is known to be empty; a missing key or null
 * value is unknown.
 *
 * Operators: eq, in, gte, lte, between, exists, bool.
 * Money criteria carry their currency; a fact in another currency converts
 * through opts.fx(from, to, day) -> rate_e8 | null, else the criterion is
 * unknown (reason no_rate).
 *
 * Pure: no PocketBase globals.
 */

let _c = null;
function C() {
  if (_c === null) _c = require((typeof __hooks === 'string' ? __hooks : __dirname) + '/lib_eng_core.js');
  return _c;
}

/** The fact vocabulary (SPEC 7.2) and each key's value type. */
const FACT_TYPES = {
  sector: 'text',
  subsector: 'text',
  stage: 'text',
  round_type: 'text',
  raise_minor: 'money',
  pre_money_minor: 'money',
  post_money_minor: 'money',
  currency: 'text',
  hq_country: 'text',
  founded_year: 'int',
  team_size: 'int',
  founders: 'int',
  technical_founder: 'bool',
  prior_exit: 'bool',
  revenue_minor: 'money',
  arr_minor: 'money',
  growth_mom_ppm: 'int',
  gross_margin_ppm: 'int',
  burn_minor: 'money',
  runway_months: 'num',
  customers: 'int',
  business_model: 'text',
  product_live: 'bool',
  lead_investor: 'text',
  use_of_funds: 'text',
};
const FACT_KEYS = Object.keys(FACT_TYPES);
const OPS = ['eq', 'in', 'gte', 'lte', 'between', 'exists', 'bool'];
const OPS_BY_TYPE = {
  text: ['eq', 'in', 'exists'],
  money: ['eq', 'gte', 'lte', 'between', 'exists'],
  int: ['eq', 'in', 'gte', 'lte', 'between', 'exists'],
  num: ['eq', 'gte', 'lte', 'between', 'exists'],
  bool: ['bool', 'exists'],
};

function isNumber(v, type) {
  if (typeof v !== 'number' || !isFinite(v)) return false;
  return type === 'num' ? true : Number.isInteger(v);
}

function operandOk(type, v) {
  if (type === 'text') return typeof v === 'string' && v !== '';
  if (type === 'bool') return typeof v === 'boolean';
  return isNumber(v, type);
}

/**
 * Validate one criterion against the fact vocabulary; throws invalid_criterion.
 * criterion: { key, op, value?, values?, min?, max?, required?, currency? (money) }
 * -> the normalized criterion.
 */
function checkCriterion(cr, index) {
  const c = C();
  const where = 'criteria[' + index + ']';
  const bad = (msg) => c.fail(400, where + ': ' + msg, 'invalid_criterion', { index: index, key: cr && !c.isNil(cr.key) ? cr.key : null });
  if (c.isNil(cr) || typeof cr !== 'object') throw bad('a criterion is an object');
  const type = FACT_TYPES[cr.key];
  if (type === undefined) throw bad('key must be one of ' + FACT_KEYS.join(', '));
  if (OPS.indexOf(cr.op) < 0) throw bad('op must be one of ' + OPS.join(', '));
  if (OPS_BY_TYPE[type].indexOf(cr.op) < 0) throw bad(cr.key + ' takes ' + OPS_BY_TYPE[type].join(', '));
  const out = { key: cr.key, op: cr.op, required: cr.required === true };
  if (cr.op === 'eq') {
    if (!operandOk(type, cr.value)) throw bad('eq needs a value of type ' + type);
    out.value = cr.value;
  } else if (cr.op === 'in') {
    if (!Array.isArray(cr.values) || cr.values.length === 0 || cr.values.length > 200 || !cr.values.every((v) => operandOk(type, v))) throw bad('in needs values: a list of 1 to 200 ' + type + ' values');
    out.values = cr.values.slice();
  } else if (cr.op === 'gte' || cr.op === 'lte') {
    if (!operandOk(type, cr.value)) throw bad(cr.op + ' needs a number value');
    out.value = cr.value;
  } else if (cr.op === 'between') {
    if (!operandOk(type, cr.min) || !operandOk(type, cr.max) || cr.min > cr.max) throw bad('between needs min <= max');
    out.min = cr.min;
    out.max = cr.max;
  } else if (cr.op === 'bool') {
    if (typeof cr.value !== 'boolean') throw bad('bool needs value true or false');
    out.value = cr.value;
  }
  if (type === 'money' && cr.op !== 'exists') {
    c.exponent(cr.currency);
    out.currency = String(cr.currency).toUpperCase();
  }
  return out;
}

/** Validate a whole criteria list (thesis save); throws invalid_criterion. */
function validate(criteria) {
  if (!Array.isArray(criteria)) throw C().fail(400, 'criteria must be a list', 'invalid_criterion', {});
  if (criteria.length > 60) throw C().fail(400, 'A thesis has at most 60 criteria', 'invalid_criterion', {});
  return criteria.map((cr, i) => checkCriterion(cr, i));
}

/** The known value of a fact, or undefined when unknown. */
function factValue(facts, key) {
  const f = facts[key];
  if (C().isNil(f) || typeof f !== 'object' || Array.isArray(f)) return undefined;
  if (f.grade === 'unknown') return undefined;
  if (C().isNil(f.value)) return undefined;
  return f.value;
}

function isEmpty(v) {
  return v === '' || (Array.isArray(v) && v.length === 0);
}

function textEq(a, b) {
  return String(a).toLowerCase() === String(b).toLowerCase();
}

/** One criterion -> { key, op, required, status, reason, value }. */
function evalOne(cr, facts, opts) {
  const c = C();
  const type = FACT_TYPES[cr.key];
  const res = (status, reason, value) => ({ key: cr.key, op: cr.op, required: cr.required, status: status, reason: reason, value: value === undefined ? null : value });
  let v = factValue(facts, cr.key);
  if (v === undefined) return res('unknown', 'missing', null);
  if (cr.op === 'exists') return isEmpty(v) ? res('unmet', 'empty', v) : res('met', null, v);
  if (isEmpty(v)) return res('unmet', 'empty', v);

  if (type === 'bool') {
    if (typeof v !== 'boolean') return res('unknown', 'bad_value', v);
    return v === cr.value ? res('met', null, v) : res('unmet', null, v);
  }
  if (type === 'text') {
    const list = Array.isArray(v) ? v : [v];
    if (!list.every((x) => typeof x === 'string')) return res('unknown', 'bad_value', v);
    const wanted = cr.op === 'eq' ? [cr.value] : cr.values;
    const hit = list.some((x) => wanted.some((w) => textEq(x, w)));
    return hit ? res('met', null, v) : res('unmet', null, v);
  }
  // Numbers (int, num, money).
  if (!isNumber(v, type === 'num' ? 'num' : 'int')) return res('unknown', 'bad_value', v);
  if (type === 'money') {
    const fc = factValue(facts, 'currency');
    if (fc === undefined || typeof fc !== 'string' || !/^[A-Za-z]{3}$/.test(fc)) return res('unknown', 'currency_unknown', v);
    const from = fc.toUpperCase();
    if (from !== cr.currency) {
      const rate = opts && typeof opts.fx === 'function' ? opts.fx(from, cr.currency, opts.day || null) : null;
      if (c.isNil(rate)) return res('unknown', 'no_rate', v);
      v = c.convertMinor(v, from, cr.currency, rate);
    }
  }
  let ok;
  if (cr.op === 'eq') ok = v === cr.value;
  else if (cr.op === 'in') ok = cr.values.indexOf(v) >= 0;
  else if (cr.op === 'gte') ok = v >= cr.value;
  else if (cr.op === 'lte') ok = v <= cr.value;
  else ok = v >= cr.min && v <= cr.max;
  return ok ? res('met', null, v) : res('unmet', null, v);
}

/**
 * Fit of facts against criteria.
 * -> { checks: [{ key, op, required, status: met|unmet|unknown, reason, value }],
 *      counts: { met, unmet, unknown },
 *      required: { met, unmet, unknown, state: met|unmet|unknown } }
 * No total score, by design.
 */
function fit(criteria, facts, opts) {
  const list = validate(criteria);
  const f = facts && typeof facts === 'object' ? facts : {};
  const checks = list.map((cr) => evalOne(cr, f, opts || {}));
  const counts = { met: 0, unmet: 0, unknown: 0 };
  const req = { met: 0, unmet: 0, unknown: 0, state: 'met' };
  for (const ch of checks) {
    counts[ch.status]++;
    if (ch.required) req[ch.status]++;
  }
  req.state = req.unmet > 0 ? 'unmet' : req.unknown > 0 ? 'unknown' : 'met';
  return { checks: checks, counts: counts, required: req };
}

module.exports = {
  FACT_TYPES: FACT_TYPES,
  FACT_KEYS: FACT_KEYS,
  OPS: OPS,
  OPS_BY_TYPE: OPS_BY_TYPE,
  validate: validate,
  fit: fit,
};
