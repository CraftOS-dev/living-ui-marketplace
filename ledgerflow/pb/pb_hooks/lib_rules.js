/// <reference path="../pb_data/types.d.ts" />
/**
 * Categorization rules: ordered, first match wins.
 *
 *   conditions [{ field, op, value, value2? }]
 *     field  payee | description | amount | direction | account
 *     op     contains | not_contains | equals | starts_with | ends_with |
 *            regex | gt | gte | lt | lte | between
 *     (amount compares the absolute value, written as a decimal: "12.50";
 *      direction is "in" or "out"; account is the bank account's id or code)
 *   match    all | any
 *   actions  { account, contact, tax_code, payee, memo, tags, splits:
 *              [{ account, percent }] }
 *   auto_post  post matching lines without review (the person's choice)
 *
 * Rules written by the AI agent start as `proposed` and apply only after the
 * person turns them on.
 */

const FIELDS = ['payee', 'description', 'amount', 'direction', 'account'];
const OPS = ['contains', 'not_contains', 'equals', 'starts_with', 'ends_with', 'regex', 'gt', 'gte', 'lt', 'lte', 'between'];

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** Validate and normalize conditions and actions (resolving names to ids). */
function clean(app, conditions, actions) {
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const money = require(`${__hooks}/lib_money.js`);
  if (!Array.isArray(conditions) || conditions.length === 0) throw fail(400, 'conditions must be a list like [{"field":"payee","op":"contains","value":"Starbucks"}]');
  if (conditions.length > 8) throw fail(400, 'At most 8 conditions per rule');
  const conds = conditions.map((c) => {
    if (!c || FIELDS.indexOf(c.field) < 0) throw fail(400, 'condition field must be one of: ' + FIELDS.join(', '));
    if (OPS.indexOf(c.op) < 0) throw fail(400, 'condition op must be one of: ' + OPS.join(', '));
    const out = { field: c.field, op: c.op, value: String(c.value === undefined || c.value === null ? '' : c.value).trim() };
    if (out.value === '') throw fail(400, 'Each condition needs a value');
    if (c.field === 'amount') {
      money.parse(out.value, 'USD', 'amount');
      if (c.op === 'between') {
        out.value2 = String(c.value2 === undefined ? '' : c.value2).trim();
        money.parse(out.value2, 'USD', 'value2');
      }
    }
    if (c.op === 'regex') {
      try {
        new RegExp(out.value, 'i');
      } catch {
        throw fail(400, 'The pattern "' + out.value + '" is not a valid regular expression');
      }
    }
    if (c.field === 'direction' && out.value !== 'in' && out.value !== 'out') throw fail(400, 'direction is "in" or "out"');
    if (c.field === 'account') out.value = ledger.account(app, out.value).id;
    return out;
  });
  const a = actions || {};
  const out = {};
  if (a.account) out.account = ledger.account(app, a.account).id;
  if (a.contact) out.contact = String(a.contact).slice(0, 160);
  if (a.tax_code) out.tax_code = ledger.taxCode(app, a.tax_code).id;
  if (a.payee) out.payee = String(a.payee).slice(0, 160);
  if (a.memo) out.memo = String(a.memo).slice(0, 300);
  if (Array.isArray(a.tags) && a.tags.length > 0) out.tags = a.tags.map((t) => String(t).slice(0, 40)).slice(0, 10);
  if (Array.isArray(a.splits) && a.splits.length > 0) {
    let total = 0;
    out.splits = a.splits.map((s) => {
      const pct = Number(s.percent);
      if (!(pct > 0)) throw fail(400, 'Each split needs a percent above 0');
      total += pct;
      return { account: ledger.account(app, s.account).id, percent: String(pct) };
    });
    if (Math.abs(total - 100) > 0.001) throw fail(400, 'Split percents must add up to 100 (they add up to ' + total + ')');
  }
  if (!out.account && !out.splits && !out.contact && !out.payee) throw fail(400, 'A rule needs at least one action: account, splits, contact or payee');
  return { conditions: conds, actions: out };
}

function textTest(op, hay, needle) {
  const h = String(hay || '').toLowerCase();
  const n = String(needle || '').toLowerCase();
  switch (op) {
    case 'contains':
      return h.indexOf(n) >= 0;
    case 'not_contains':
      return h.indexOf(n) < 0;
    case 'equals':
      return h === n;
    case 'starts_with':
      return h.indexOf(n) === 0;
    case 'ends_with':
      return h.length >= n.length && h.slice(h.length - n.length) === n;
    case 'regex':
      try {
        return new RegExp(needle, 'i').test(String(hay || ''));
      } catch {
        return false;
      }
    default:
      return false;
  }
}

/** Does a condition hold for a statement line ({payee, description, amount, account, currency})? */
function test(c, line) {
  const money = require(`${__hooks}/lib_money.js`);
  if (c.field === 'direction') return (line.amount >= 0 ? 'in' : 'out') === c.value;
  if (c.field === 'account') return line.account === c.value;
  if (c.field === 'amount') {
    const v = Math.abs(line.amount);
    const a = money.parse(c.value, line.currency, 'value');
    if (c.op === 'equals') return v === a;
    if (c.op === 'gt') return v > a;
    if (c.op === 'gte') return v >= a;
    if (c.op === 'lt') return v < a;
    if (c.op === 'lte') return v <= a;
    if (c.op === 'between') {
      const b = money.parse(c.value2, line.currency, 'value2');
      return v >= Math.min(a, b) && v <= Math.max(a, b);
    }
    return false;
  }
  return textTest(c.op, c.field === 'payee' ? line.payee : line.description, c.value);
}

function matches(rule, line) {
  const conds = rule.conditions || [];
  if (conds.length === 0) return false;
  if (rule.match === 'any') return conds.some((c) => test(c, line));
  return conds.every((c) => test(c, line));
}

function serialize(rec) {
  const u = require(`${__hooks}/lib_util.js`);
  return {
    id: rec.id,
    name: rec.getString('name'),
    sort: rec.getInt('sort'),
    status: rec.getString('status') || 'active',
    match: rec.getString('match') || 'all',
    conditions: u.json(rec, 'conditions', []) || [],
    actions: u.json(rec, 'actions', {}) || {},
    auto_post: rec.getBool('auto_post'),
    one_time: rec.getBool('one_time'),
    hits: rec.getInt('hits'),
    last_hit: rec.getString('last_hit'),
    added_by: rec.getString('added_by') || 'user',
    run: rec.getString('run'),
    note: rec.getString('note'),
    created: rec.getString('created'),
  };
}

/** Active rules in order. */
function active(app) {
  return app.findRecordsByFilter('rules', "status = 'active'", 'sort,created', 0, 0).map(serialize);
}

/** The first active rule matching a line, or null. */
function first(rules, line) {
  for (const r of rules) if (matches(r, line)) return r;
  return null;
}

function mustGet(app, id) {
  const u = require(`${__hooks}/lib_util.js`);
  const rec = u.byId(app, 'rules', id);
  if (!rec) throw fail(404, 'No rule ' + id + '; see rules.list');
  return rec;
}

module.exports = { FIELDS: FIELDS, OPS: OPS, clean: clean, test: test, matches: matches, serialize: serialize, active: active, first: first, mustGet: mustGet };
