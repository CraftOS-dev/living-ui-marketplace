/// <reference path="../pb_data/types.d.ts" />
/**
 * Investment theses (kernel-records, SPEC 4.5 and 7.2): a name, a statement
 * and criteria over the shared fact keys.
 *
 * FACT_KEYS is the fit engine's list (lib_eng_fit.FACT_KEYS, required, never
 * copied): the one vocabulary of thesis criteria and of the facts triage
 * extracts from a deck. FACTS adds what screens need: each key's engine type,
 * label, and for the coded keys the allowed values (stage, round_type,
 * business_model; hq_country and currency are ISO codes).
 *
 * A criterion is the engine's: { key, op, value? | values? | min?, max?,
 * required?, currency? } with op eq | in | gte | lte | between | exists |
 * bool by the key's type (lib_eng_fit.OPS_BY_TYPE); money criteria carry a
 * currency. theses.save checks criteria with lib_eng_fit.validate after
 * this module's own checks (unknown keys named with the closest one, coded
 * values within their lists).
 *
 * fit(app, thesisId, facts) -> { thesis, checks, counts, required } is
 * lib_eng_fit.fit with the firm's exchange rates (lib_fx.rate) for money
 * facts in another currency (no rate: unknown). Facts are { key: { value,
 * grade } } (a plain value is taken as an ungraded fact); a missing fact is
 * unknown, never unmet; there is no total score.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}

let _fit = null;
/** The fit engine (loads in Goja through __hooks and in Node next to this file). */
function E() {
  if (_fit === null) _fit = require((typeof __hooks === 'string' ? __hooks : __dirname) + '/lib_eng_fit.js');
  return _fit;
}

const COMPANY_STAGES = ['idea', 'pre_seed', 'seed', 'series_a', 'series_b', 'series_c', 'growth'];
const ROUND_TYPES = ['pre_seed', 'seed', 'seed_extension', 'series_a', 'series_b', 'series_c', 'series_d_plus', 'bridge', 'other'];
const BUSINESS_MODELS = ['saas', 'marketplace', 'transactional', 'consumer_subscription', 'advertising', 'hardware', 'licensing', 'services', 'other'];

// What screens show for each key (the type comes from the engine).
const LABELS = {
  sector: { label: 'Sector' },
  subsector: { label: 'Subsector' },
  stage: { label: 'Stage', values: COMPANY_STAGES },
  round_type: { label: 'Round', values: ROUND_TYPES },
  raise_minor: { label: 'Raise' },
  pre_money_minor: { label: 'Pre-money' },
  post_money_minor: { label: 'Post-money' },
  currency: { label: 'Currency', code: 'currency' },
  hq_country: { label: 'HQ country', code: 'country' },
  founded_year: { label: 'Founded' },
  team_size: { label: 'Team size' },
  founders: { label: 'Founders' },
  technical_founder: { label: 'Technical founder' },
  prior_exit: { label: 'Prior exit' },
  revenue_minor: { label: 'Revenue' },
  arr_minor: { label: 'ARR' },
  growth_mom_ppm: { label: 'Growth MoM', unit: 'ppm' },
  gross_margin_ppm: { label: 'Gross margin', unit: 'ppm' },
  burn_minor: { label: 'Burn' },
  runway_months: { label: 'Runway', unit: 'months' },
  customers: { label: 'Customers' },
  business_model: { label: 'Model', values: BUSINESS_MODELS },
  product_live: { label: 'Product live' },
  lead_investor: { label: 'Lead investor' },
  use_of_funds: { label: 'Use of funds' },
};

/** { key: { type, label, values?, code?, unit?, ops } } for every fact key, in the engine's order. */
function facts() {
  const out = {};
  for (const k of E().FACT_KEYS) {
    const type = E().FACT_TYPES[k];
    out[k] = Object.assign({ type: type, ops: E().OPS_BY_TYPE[type] }, LABELS[k] || { label: k });
  }
  return out;
}

const MAX_CRITERIA = 30;
const KEYS = ['key', 'op', 'value', 'values', 'min', 'max', 'required', 'currency'];

/* ------------------------------------------------------------ criteria */

function codeValue(util, info, v, where) {
  const s = typeof v === 'string' ? v.trim() : v;
  if (info.values && info.values.indexOf(s) < 0) throw util.fail(400, where + ': "' + v + '" is not one of: ' + info.values.join(', ') + '.', 'invalid_criterion', { allowed: info.values });
  if (info.code === 'country') return L('lib_norm').country(s, where);
  if (info.code === 'currency') return L('lib_norm').currency(s, where);
  return s;
}

/**
 * validateCriteria(raw) -> the clean list: keys and fields named with the
 * closest allowed one, coded values within their lists, then
 * lib_eng_fit.validate (operators by type, operands, money currency).
 */
function validateCriteria(raw) {
  const util = u();
  let list = raw;
  if (typeof list === 'string') {
    try {
      list = list.trim() === '' ? [] : JSON.parse(list);
    } catch {
      throw util.fail(400, 'criteria must be a JSON list of {"key","op",...}.', 'invalid_param', { param: 'criteria' });
    }
  }
  if (!Array.isArray(list)) throw util.fail(400, 'criteria must be a JSON list of {"key","op",...}.', 'invalid_param', { param: 'criteria' });
  if (list.length > MAX_CRITERIA) throw util.fail(400, 'At most ' + MAX_CRITERIA + ' criteria.', 'too_many');
  const F = facts();
  const keys = E().FACT_KEYS;
  const prepared = list.map((c, i) => {
    const where = 'Criterion ' + (i + 1);
    if (c === null || typeof c !== 'object' || Array.isArray(c)) throw util.fail(400, where + ' must be an object {"key","op",...}.', 'invalid_criterion', { index: i });
    util.keysOnly(c, KEYS, where);
    const key = String(c.key || '');
    if (F[key] === undefined) {
      const near = util.nearest(key, keys);
      throw util.fail(400, where + ': unknown fact key "' + key + '"' + (near !== '' ? ' (did you mean ' + near + '?)' : '') + '. Keys: ' + keys.join(', ') + '.', 'invalid_criterion', { index: i, allowed: keys });
    }
    const info = F[key];
    const out = Object.assign({}, c);
    if (info.values || info.code) {
      const w = where + ' (' + key + ')';
      if (out.value !== undefined && out.value !== null && out.op === 'eq') out.value = codeValue(util, info, out.value, w);
      if (Array.isArray(out.values)) out.values = out.values.map((v) => codeValue(util, info, v, w));
    }
    if (out.currency !== undefined && out.currency !== null && out.currency !== '') out.currency = L('lib_norm').currency(out.currency, where + ' currency');
    return out;
  });
  const clean = E().validate(prepared);
  const seen = {};
  clean.forEach((c, i) => {
    const sig = JSON.stringify(c);
    if (seen[sig]) throw util.fail(400, 'Criterion ' + (i + 1) + ' repeats an earlier one.', 'invalid_criterion', { index: i });
    seen[sig] = true;
  });
  return clean;
}

/* ----------------------------------------------------------------- fit */

/** Facts in the engine's shape { key: { value, grade } } from a map or a list of { key, value, grade }. */
function factsOf(raw) {
  const out = {};
  const put = (k, v) => {
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && 'value' in v) out[k] = { value: v.value, grade: v.grade };
    else out[k] = { value: v };
  };
  if (Array.isArray(raw)) {
    for (const f of raw) if (f && typeof f === 'object' && typeof f.key === 'string') out[f.key] = { value: f.value, grade: f.grade };
    return out;
  }
  for (const k of Object.keys(raw || {})) put(k, raw[k]);
  return out;
}

/** fit(app, thesisId, facts) -> { thesis: { id, name }, checks: [{ key, label, op, required, status, reason, value }], counts, required }. */
function fit(app, thesisId, factsIn) {
  const util = u();
  const t = thesisRef(app, thesisId);
  const criteria = util.jsonOf(t, 'criteria', []) || [];
  const day = util.today(app);
  const r = E().fit(criteria, factsOf(factsIn), {
    day: day,
    fx: (from, to, d) => {
      const x = L('lib_fx').rate(app, from, to, d || day);
      return x === null || x === undefined ? null : x.rate_e8;
    },
  });
  const F = facts();
  return {
    thesis: { id: t.id, name: t.getString('name') },
    checks: r.checks.map((c) => Object.assign({ label: F[c.key] ? F[c.key].label : c.key }, c)),
    counts: r.counts,
    required: r.required,
  };
}

/* ---------------------------------------------------------------- CRUD */

function thesisRef(app, r0) {
  const util = u();
  const r = String(r0 || '').trim();
  if (r === '') throw util.fail(400, 'thesis is required.', 'missing_param', { param: 'thesis' });
  const t = util.byId(app, 'theses', r);
  if (t !== null) return t;
  const rows = util.rows(app, 'SELECT id FROM theses WHERE LOWER(name) = LOWER({:n}) LIMIT 1', { id: '' }, { n: r });
  if (rows.length === 1) return app.findRecordById('theses', rows[0].id);
  // A thesis named by part of its name ("fintech" for "Fintech infrastructure") when only one fits.
  const part = util.rows(app, "SELECT id, name FROM theses WHERE name LIKE {:q} ESCAPE '\\' LIMIT 5", { id: '', name: '' }, { q: util.like(r) });
  if (part.length === 1 && r.length >= 3) return app.findRecordById('theses', part[0].id);
  if (part.length > 1) throw L('lib_refs').ambiguous('theses', r, part, 'Pass the full name or the id.', { param: 'thesis' });
  throw L('lib_refs').notFound('thesis', r, L('lib_refs').matches(app, 'theses', 'name', r), 'theses.list', { param: 'thesis' });
}

function thesisOut(app, t) {
  const util = u();
  const R = L('lib_records');
  const F = facts();
  const fund = t.getString('fund') !== '' ? util.byId(app, 'entities', t.getString('fund')) : null;
  return {
    id: t.id,
    name: t.getString('name'),
    statement: t.getString('statement'),
    criteria: (util.jsonOf(t, 'criteria', []) || []).map((c) => Object.assign({ label: F[c.key] ? F[c.key].label : c.key }, c)),
    status: t.getString('status'),
    fund: fund ? { id: fund.id, name: fund.getString('name') } : null,
    owner: R.mini(app, 'members', t.getString('owner')),
    sort: t.getInt('sort'),
    prov: util.jsonOf(t, 'prov', {}) || {},
    actor: t.getString('actor'),
    created: t.getString('created'),
    updated: t.getString('updated'),
  };
}

/** The active theses (intake checks every new item against them). */
function active(app) {
  return app.findRecordsByFilter('theses', "status = 'active'", 'sort,name', 0, 0).map((t) => thesisOut(app, t));
}

function opList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const status = util.oneOf(p, 'status', ['active', 'archived', 'all'], 'active');
  const where = [];
  const bind = {};
  if (status !== 'all') {
    where.push('status = {:s}');
    bind.s = status;
  }
  const fund = util.str(p, 'fund', '');
  if (fund !== '') {
    where.push("(fund = {:f} || fund = '')");
    bind.f = fund;
  }
  const rows = app.findRecordsByFilter('theses', where.length > 0 ? where.join(' && ') : '1=1', 'sort,name', 0, 0, bind);
  return { theses: rows.map((t) => thesisOut(app, t)), total: rows.length };
}

function opGet(ctx, p) {
  return { thesis: thesisOut(ctx.app, thesisRef(ctx.app, u().req(p, 'thesis'))) };
}

/** theses.keys: the fact keys with type, label, operators and allowed values (the criteria editor's chips). */
function opKeys() {
  const F = facts();
  return { keys: E().FACT_KEYS.map((k) => Object.assign({ key: k }, F[k])) };
}

/** theses.fit: check facts against one thesis (met, unmet, unknown per criterion). */
function opFit(ctx, p) {
  const util = u();
  const raw = util.obj(p, 'facts');
  if (raw === undefined) throw util.fail(400, 'facts is a JSON object of fact key: value (or {"value","grade"}), e.g. {"sector":"fintech","raise_minor":300000000,"currency":"USD"}.', 'missing_param', { param: 'facts' });
  const keys = E().FACT_KEYS;
  for (const k of Object.keys(raw)) {
    if (keys.indexOf(k) < 0) {
      const near = util.nearest(k, keys);
      throw util.fail(400, 'Unknown fact key "' + k + '"' + (near !== '' ? ' (did you mean ' + near + '?)' : '') + '.', 'unknown_key', { key: k, allowed: keys });
    }
  }
  return fit(ctx.app, util.req(p, 'thesis'), raw);
}

/** theses.save: create (no --thesis) or change a thesis; criteria checked as validateCriteria says. */
function opSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const ref = util.str(p, 'thesis', '');
  const t0 = ref !== '' ? thesisRef(app, ref) : null;
  if (t0 === null && util.str(p, 'name', '') === '') throw util.fail(400, 'A new thesis needs --name.', 'missing_param', { param: 'name' });
  const criteria = util.has(p, 'criteria') ? validateCriteria(p.criteria) : undefined;
  const name = util.has(p, 'name') ? util.squash(util.text(p, 'name', 160, '')) : undefined;
  if (name === '') throw util.fail(400, 'name cannot be empty.', 'invalid_param', { param: 'name' });
  if (name !== undefined) {
    const dup = util.rows(app, 'SELECT id FROM theses WHERE LOWER(name) = LOWER({:n}) AND id != {:x}', { id: '' }, { n: name, x: t0 ? t0.id : '' });
    if (dup.length > 0) throw util.fail(409, 'There is already a thesis called ' + name + '.', 'duplicate', { id: dup[0].id });
  }
  const status = util.oneOf(p, 'status', ['active', 'archived'], '');
  let fund;
  if (util.has(p, 'fund')) {
    const fr = util.str(p, 'fund', '');
    if (fr === '') fund = '';
    else {
      const f = util.byId(app, 'entities', fr) || util.findOne(app, 'entities', 'name = {:n}', { n: fr });
      if (f === null || (f.getString('kind') !== 'fund' && f.getString('kind') !== 'spv')) throw util.fail(404, 'No fund "' + fr + '".', 'not_found', { param: 'fund' });
      fund = f.id;
    }
  }
  const ownerRef = util.str(p, 'owner', '');
  const owner = util.has(p, 'owner') ? (ownerRef === '' ? '' : L('lib_auth').memberRef(app, ownerRef === 'me' ? ctx.memberId : ownerRef).id) : undefined;
  const R = L('lib_records');
  let id = '';
  R.inRun(ctx, 'theses.save', (t) => {
    const rec = t0 !== null ? t.findRecordById('theses', t0.id) : util.newRecord(t, 'theses');
    const prov = util.jsonOf(rec, 'prov', {}) || {};
    const set = (k, v) => {
      rec.set(k, v);
      prov[k] = R.provEntry(ctx, util.str(p, 'source_ref', ''));
    };
    if (name !== undefined) set('name', name);
    if (util.has(p, 'statement')) set('statement', util.text(p, 'statement', 4000, ''));
    if (criteria !== undefined) set('criteria', criteria);
    else if (t0 === null) rec.set('criteria', []);
    if (status !== '') rec.set('status', status);
    else if (t0 === null) rec.set('status', 'active');
    if (fund !== undefined) rec.set('fund', fund);
    if (owner !== undefined) rec.set('owner', owner);
    else if (t0 === null && ctx.actor === 'person') rec.set('owner', ctx.memberId);
    if (util.has(p, 'sort')) rec.set('sort', util.int(p, 'sort', 0, 0, 10000));
    rec.set('prov', prov);
    R.stampWritten(ctx, rec);
    t.save(rec);
    id = rec.id;
    return { summary: (t0 === null ? 'Added the thesis ' : 'Changed the thesis ') + rec.getString('name'), type: 'theses', id: rec.id };
  });
  return { thesis: thesisOut(app, app.findRecordById('theses', id)) };
}

function previewSave(ctx, params) {
  const app = ctx.app;
  const t = params.thesis ? thesisRef(app, params.thesis) : null;
  const P = L('lib_proposals');
  const LABELS = { name: 'Name', statement: 'Statement', criteria: 'Criteria', status: 'Status', fund: 'Fund', owner: 'Owner' };
  const nameIn = (collection, v) => {
    if (v === '' || v === null || v === undefined) return '';
    const r = u().byId(app, collection, String(v));
    return r !== null ? r.getString('name') : String(v);
  };
  const crit = (v) => {
    const list = typeof v === 'string' ? (v.trim() === '' ? [] : JSON.parse(v)) : v || [];
    return (Array.isArray(list) ? list : []).map((c) => (c && typeof c === 'object' ? [c.key, c.op, c.value === undefined ? '' : JSON.stringify(c.value)].filter((x) => x !== undefined && x !== '').join(' ') : String(c)));
  };
  const fields = [];
  for (const k of ['name', 'statement', 'criteria', 'status', 'fund', 'owner']) {
    if (params[k] === undefined) continue;
    let ln;
    if (k === 'criteria') ln = P.line(LABELS[k], t === null ? [] : crit(u().jsonOf(t, 'criteria', []) || []), crit(params[k]), 'list', k);
    else if (k === 'fund') ln = P.line(LABELS[k], t === null ? '' : nameIn('entities', t.getString('fund')), nameIn('entities', params[k]), 'text', k);
    else if (k === 'owner') ln = P.line(LABELS[k], t === null ? '' : nameIn('members', t.getString('owner')), nameIn('members', params[k]), 'text', k);
    else ln = P.line(LABELS[k], t === null ? '' : t.getString(k), params[k], 'text', k);
    if (ln !== null) fields.push(ln);
  }
  return { label: P.titleOf(t === null ? String(params.name || 'New thesis') : t.getString('name'), fields), target: t === null ? '' : 'theses:' + t.id, fields: fields, notes: [], risk: 'low' };
}

const api = {
  COMPANY_STAGES: COMPANY_STAGES,
  ROUND_TYPES: ROUND_TYPES,
  BUSINESS_MODELS: BUSINESS_MODELS,
  facts: facts,
  validateCriteria: validateCriteria,
  fit: fit,
  active: active,
  thesisRef: thesisRef,
  thesisOut: thesisOut,
  opList: opList,
  opGet: opGet,
  opKeys: opKeys,
  opFit: opFit,
  opSave: opSave,
  previewSave: previewSave,
};
// FACT_KEYS and FACT_TYPES are the fit engine's own lists (read when first used).
Object.defineProperty(api, 'FACT_KEYS', { enumerable: true, get: () => E().FACT_KEYS });
Object.defineProperty(api, 'FACT_TYPES', { enumerable: true, get: () => E().FACT_TYPES });
module.exports = api;
