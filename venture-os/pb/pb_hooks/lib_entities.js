/// <reference path="../pb_data/types.d.ts" />
/**
 * The firm's legal entities: the management company (one), funds and SPVs.
 * A fund or SPV carries its LPA terms as validated JSON (lpa):
 *
 *   {
 *     confirmed: false,             // true once a person saved the terms (setup fills defaults)
 *     mgmt_fee_ppm: 20000,          // management fee rate (2%)
 *     fee_basis: 'committed',       // committed | invested | net_invested | nav
 *     step_downs: [{ from_year: 6, fee_ppm: 15000, basis: 'invested' }],   // ascending years
 *     carry_ppm: 200000,            // carried interest (20%)
 *     waterfall: 'european',        // european (whole fund) | american (deal by deal)
 *     hurdle_ppm: 0,                // preferred return (0 = none)
 *     pref_compounding: 'compound', // how the preferred return accrues: compound | simple
 *     catch_up_ppm: 1000000,        // GP share during catch-up (1000000 = full catch-up)
 *     recycling_cap_ppm: 0,         // recyclable share of commitments
 *     recycling_window_years: 0,
 *     gp_commit_ppm: 10000,         // GP commitment share
 *     investment_period_years: 5, term_years: 10, extension_years: 2,
 *     fee_offset_ppm: 1000000       // share of portfolio fees offset against the fee
 *   }
 *
 * Unknown keys are refused naming the allowed ones. settings JSON holds
 * per-entity module settings ({ committee: { vote_scale: [...] } }), merged
 * per module key on save. Fund scope (members.funds) points at fund and
 * SPV ids; lib_auth.scope(ctx) answers it.
 */

const KINDS = ['management', 'fund', 'spv'];
const STATUSES = ['active', 'raising', 'investing', 'harvesting', 'closed'];
const BASES = ['committed', 'invested', 'net_invested', 'nav'];
const WATERFALLS = ['european', 'american'];
const COMPOUNDING = ['compound', 'simple'];

const DEFAULT_LPA = {
  confirmed: false,
  mgmt_fee_ppm: 20000,
  fee_basis: 'committed',
  step_downs: [],
  carry_ppm: 200000,
  waterfall: 'european',
  hurdle_ppm: 0,
  pref_compounding: 'compound',
  catch_up_ppm: 1000000,
  recycling_cap_ppm: 0,
  recycling_window_years: 0,
  gp_commit_ppm: 10000,
  investment_period_years: 5,
  term_years: 10,
  extension_years: 2,
  fee_offset_ppm: 1000000,
};
const SPV_LPA = Object.assign({}, DEFAULT_LPA, { mgmt_fee_ppm: 0, investment_period_years: 1, term_years: 7, extension_years: 0 });

// key: [kind, min, max] (int keys) or [kind, values] (enums)
const LPA_KEYS = {
  confirmed: ['bool'],
  mgmt_fee_ppm: ['int', 0, 100000],
  fee_basis: ['enum', BASES],
  step_downs: ['steps'],
  carry_ppm: ['int', 0, 500000],
  waterfall: ['enum', WATERFALLS],
  hurdle_ppm: ['int', 0, 300000],
  pref_compounding: ['enum', COMPOUNDING],
  catch_up_ppm: ['int', 0, 1000000],
  recycling_cap_ppm: ['int', 0, 1000000],
  recycling_window_years: ['int', 0, 30],
  gp_commit_ppm: ['int', 0, 1000000],
  investment_period_years: ['int', 1, 15],
  term_years: ['int', 1, 30],
  extension_years: ['int', 0, 10],
  fee_offset_ppm: ['int', 0, 1000000],
};

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

/** Check LPA terms (a full object); answers a clean copy or throws 400 naming the key. */
function validateLpa(raw) {
  const u = L('lib_util');
  const bad = (msg) => u.fail(400, 'lpa: ' + msg, 'invalid_param', { param: 'lpa' });
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw bad('must be a JSON object');
  u.keysOnly(raw, Object.keys(LPA_KEYS), 'lpa');
  const out = {};
  for (const k of Object.keys(LPA_KEYS)) {
    const rule = LPA_KEYS[k];
    const v = raw[k];
    if (v === undefined) throw bad(k + ' is required');
    if (rule[0] === 'bool') {
      if (typeof v !== 'boolean') throw bad(k + ' must be true or false');
      out[k] = v;
    } else if (rule[0] === 'int') {
      const n = Number(v);
      if (!Number.isInteger(n) || n < rule[1] || n > rule[2]) throw bad(k + ' must be a whole number from ' + rule[1] + ' to ' + rule[2]);
      out[k] = n;
    } else if (rule[0] === 'enum') {
      if (rule[1].indexOf(v) < 0) throw bad(k + ' must be one of: ' + rule[1].join(', '));
      out[k] = v;
    } else if (rule[0] === 'steps') {
      if (!Array.isArray(v)) throw bad('step_downs must be a list');
      if (v.length > 10) throw bad('step_downs takes at most 10 steps');
      let last = 0;
      out[k] = v.map((s, i) => {
        u.keysOnly(s, ['from_year', 'fee_ppm', 'basis'], 'lpa.step_downs[' + i + ']');
        const y = Number(s.from_year);
        const f = Number(s.fee_ppm);
        if (!Number.isInteger(y) || y < 1 || y > 30) throw bad('step_downs[' + i + '].from_year must be a whole number from 1 to 30');
        if (y <= last) throw bad('step_downs must be in increasing from_year order');
        last = y;
        if (!Number.isInteger(f) || f < 0 || f > 100000) throw bad('step_downs[' + i + '].fee_ppm must be a whole number from 0 to 100000');
        const step = { from_year: y, fee_ppm: f };
        if (s.basis !== undefined) {
          if (BASES.indexOf(s.basis) < 0) throw bad('step_downs[' + i + '].basis must be one of: ' + BASES.join(', '));
          step.basis = s.basis;
        }
        return step;
      });
    }
  }
  if (out.recycling_cap_ppm > 0 && out.recycling_window_years === 0) throw bad('recycling_window_years is needed when recycling_cap_ppm is above 0');
  return out;
}

function view(app, r) {
  const u = L('lib_util');
  return {
    id: r.id,
    kind: r.getString('kind'),
    name: r.getString('name'),
    short_name: r.getString('short_name'),
    legal_name: r.getString('legal_name'),
    currency: r.getString('currency'),
    vintage: r.getInt('vintage') || null,
    size_minor: r.getInt('size_minor'),
    target_minor: r.getInt('target_minor'),
    status: r.getString('status'),
    fiscal_year_end: r.getString('fiscal_year_end') || '12-31',
    first_close_day: r.getString('first_close_day'),
    final_close_day: r.getString('final_close_day'),
    lpa: u.jsonOf(r, 'lpa', null),
    settings: u.jsonOf(r, 'settings', {}) || {},
    parent: r.getString('parent'),
    deal: r.getString('deal'),
    notes: r.getString('notes'),
    archived: r.getBool('archived'),
    created: r.getString('created'),
    updated: r.getString('updated'),
  };
}

/** An entity by id, exact name or short name (case-insensitive); 404 with close names. */
function ref(app, refText) {
  const u = L('lib_util');
  const r = String(refText || '').trim();
  if (r === '') throw u.fail(400, 'Give the entity (fund) id or name.', 'missing_param', { param: 'entity' });
  const byId = u.byId(app, 'entities', r);
  if (byId !== null) return byId;
  const rows = u.rows(app, 'SELECT id FROM entities WHERE LOWER(name) = LOWER({:v}) OR (short_name != \'\' AND LOWER(short_name) = LOWER({:v})) LIMIT 2', { id: '' }, { v: r });
  if (rows.length === 1) return app.findRecordById('entities', rows[0].id);
  if (rows.length > 1) throw u.fail(409, 'More than one entity is called "' + r + '". Use the id.', 'ambiguous');
  const close = u.closeNames(app, 'entities', 'name', r);
  throw u.fail(404, 'No fund or entity "' + r + '".' + (close.length > 0 ? ' Did you mean ' + close.map((x) => '"' + x + '"').join(' or ') + '?' : '') + ' Run entities.list.', 'not_found', { ref: r, matches: close });
}

/** May ctx see this entity? The management company always; funds and SPVs in scope (an SPV also through its parent fund). */
function canSee(ctx, r) {
  const auth = L('lib_auth');
  if (r.getString('kind') === 'management') return true;
  if (auth.inScope(ctx, r.id)) return true;
  return r.getString('kind') === 'spv' && r.getString('parent') !== '' && auth.inScope(ctx, r.getString('parent'));
}

/** Entities ctx may see, as views (opts.kinds, opts.include_archived). */
function visible(ctx, opts) {
  const u = L('lib_util');
  const o = opts || {};
  const kinds = o.kinds || KINDS;
  return u
    .findMany(ctx.app, 'entities', o.include_archived ? '1=1' : 'archived = false', 'created', 0)
    .filter((r) => kinds.indexOf(r.getString('kind')) >= 0 && canSee(ctx, r))
    .map((r) => view(ctx.app, r));
}

function currencyOf(v) {
  const c = String(v || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) throw L('lib_util').fail(400, 'currency is a three-letter code such as USD.', 'invalid_param', { param: 'currency' });
  return c;
}

/** Create an entity from plain values (setup and entities.save). Answers the view. */
function create(ctx, o) {
  const u = L('lib_util');
  const app = ctx.app;
  const kind = String(o.kind || '');
  if (KINDS.indexOf(kind) < 0) throw u.fail(400, 'kind must be one of: ' + KINDS.join(', '), 'invalid_param', { param: 'kind' });
  if (kind === 'management' && u.count(app, "SELECT COUNT(*) AS n FROM entities WHERE kind = 'management'") > 0) throw u.fail(409, 'There is already a management company.', 'duplicate');
  const name = u.squash(String(o.name || ''));
  if (name === '' || name.length > 160) throw u.fail(400, 'name is required (at most 160 characters).', 'missing_param', { param: 'name' });
  if (u.count(app, 'SELECT COUNT(*) AS n FROM entities WHERE LOWER(name) = LOWER({:n})', { n: name }) > 0) throw u.fail(409, 'There is already an entity called ' + name + '.', 'duplicate');
  const r = u.newRecord(app, 'entities');
  r.set('kind', kind);
  r.set('name', name);
  r.set('short_name', u.clip(o.short_name || '', 40));
  r.set('legal_name', u.clip(o.legal_name || '', 200));
  r.set('currency', currencyOf(o.currency || L('lib_settings').row(app).getString('base_currency') || 'USD'));
  r.set('vintage', o.vintage || 0);
  r.set('size_minor', o.size_minor || 0);
  r.set('target_minor', o.target_minor || 0);
  r.set('status', STATUSES.indexOf(o.status) >= 0 ? o.status : kind === 'fund' ? 'investing' : 'active');
  r.set('fiscal_year_end', o.fiscal_year_end || '12-31');
  r.set('lpa', kind === 'management' ? null : validateLpa(Object.assign({}, kind === 'spv' ? SPV_LPA : DEFAULT_LPA, o.lpa || {})));
  r.set('settings', o.settings || {});
  r.set('parent', o.parent || '');
  r.set('deal', u.clip(o.deal || '', 30));
  r.set('archived', false);
  r.set('actor', ctx.isAgent ? 'agent' : ctx.actor === 'person' ? 'person' : 'system');
  r.set('member', ctx.memberId || '');
  app.save(r);
  return view(app, r);
}

/* ------------------------------------------------------------------- ops */

function list(ctx, p) {
  const u = L('lib_util');
  const kind = u.oneOf(p, 'kind', KINDS, '');
  const rows = visible(ctx, { kinds: kind !== '' ? [kind] : KINDS, include_archived: u.bool(p, 'include_archived', false) });
  return { entities: rows, total: rows.length, kinds: KINDS, statuses: STATUSES };
}

function need(ctx, refText) {
  const r = ref(ctx.app, refText);
  if (!canSee(ctx, r)) throw L('lib_util').fail(404, 'No fund or entity "' + refText + '" you can see.', 'not_found');
  return r;
}

function get(ctx, p) {
  const u = L('lib_util');
  const r = need(ctx, u.req(p, 'entity'));
  return { entity: view(ctx.app, r), lpa_keys: Object.keys(LPA_KEYS), lpa_defaults: r.getString('kind') === 'spv' ? SPV_LPA : DEFAULT_LPA };
}

/**
 * entities.save: create (no --entity) or change an entity. --lpa is merged
 * into the current terms (or the defaults) and checked whole; a person
 * saving terms marks them confirmed unless they pass confirmed false.
 */
function save(ctx, p) {
  const u = L('lib_util');
  const app = ctx.app;
  const refText = u.str(p, 'entity', '');
  const cur = refText !== '' ? need(ctx, refText) : null;
  const kind = cur !== null ? cur.getString('kind') : u.oneOf(p, 'kind', KINDS, '');
  if (kind === '') throw u.fail(400, 'kind is required for a new entity: ' + KINDS.join(', '), 'missing_param', { param: 'kind' });
  if (cur !== null && u.has(p, 'kind') && u.str(p, 'kind', '') !== kind) throw u.fail(409, 'The kind of an entity does not change.', 'invalid_param', { param: 'kind' });
  const currency = u.has(p, 'currency') ? currencyOf(u.str(p, 'currency', '')) : cur !== null ? cur.getString('currency') : L('lib_settings').row(app).getString('base_currency') || 'USD';
  let lpaIn;
  if (u.has(p, 'lpa')) {
    lpaIn = u.obj(p, 'lpa');
    u.keysOnly(lpaIn, Object.keys(LPA_KEYS), 'lpa');
  }
  let parent;
  if (u.has(p, 'parent')) {
    const pr = u.str(p, 'parent', '');
    parent = pr === '' ? '' : ref(app, pr).id;
  }
  const values = {
    name: u.has(p, 'name') ? u.squash(u.text(p, 'name', 160, '')) : undefined,
    short_name: u.has(p, 'short_name') ? u.text(p, 'short_name', 40, '') : undefined,
    legal_name: u.has(p, 'legal_name') ? u.text(p, 'legal_name', 200, '') : undefined,
    vintage: u.has(p, 'vintage') ? u.int(p, 'vintage', 0, 1980, 2200) : undefined,
    size_minor: u.has(p, 'size') ? u.money(p, 'size', currency, {}) || 0 : undefined,
    target_minor: u.has(p, 'target') ? u.money(p, 'target', currency, {}) || 0 : undefined,
    status: u.has(p, 'status') ? u.oneOf(p, 'status', STATUSES, '') : undefined,
    fiscal_year_end: u.has(p, 'fiscal_year_end') ? u.str(p, 'fiscal_year_end', '') : undefined,
    first_close_day: u.has(p, 'first_close_day') ? u.day(p, 'first_close_day', '') : undefined,
    final_close_day: u.has(p, 'final_close_day') ? u.day(p, 'final_close_day', '') : undefined,
    deal: u.has(p, 'deal') ? u.text(p, 'deal', 30, '') : undefined,
    notes: u.has(p, 'notes') ? u.text(p, 'notes', 4000, '') : undefined,
  };
  if (values.fiscal_year_end !== undefined && values.fiscal_year_end !== '' && !/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(values.fiscal_year_end)) throw u.fail(400, 'fiscal_year_end is MM-DD, e.g. 12-31', 'invalid_param', { param: 'fiscal_year_end' });
  if (cur === null) {
    const lpa = kind === 'management' ? undefined : Object.assign({}, lpaIn || {});
    if (lpa !== undefined && lpaIn !== undefined && lpa.confirmed === undefined && !ctx.isAgent) lpa.confirmed = true;
    const v = create(ctx, Object.assign({}, values, { kind: kind, currency: currency, lpa: lpa, parent: parent, settings: u.has(p, 'settings') ? u.obj(p, 'settings') : {} }));
    L('lib_audit').note(ctx, { collection: 'entities', record: v.id, summary: 'Added ' + v.kind + ' ' + v.name, after: v });
    L('lib_events').emit(ctx, 'entity.created', { entity: v.id, kind: v.kind });
    return { entity: v };
  }
  const before = view(app, cur);
  if (values.name !== undefined) {
    if (values.name === '') throw u.fail(400, 'name cannot be empty', 'invalid_param', { param: 'name' });
    if (u.count(app, 'SELECT COUNT(*) AS n FROM entities WHERE LOWER(name) = LOWER({:n}) AND id != {:id}', { n: values.name, id: cur.id }) > 0) throw u.fail(409, 'There is already an entity called ' + values.name + '.', 'duplicate');
  }
  for (const k of Object.keys(values)) if (values[k] !== undefined) cur.set(k, values[k]);
  if (u.has(p, 'currency')) cur.set('currency', currency);
  if (parent !== undefined) {
    if (parent === cur.id) throw u.fail(400, 'An entity cannot be its own parent.', 'invalid_param', { param: 'parent' });
    cur.set('parent', parent);
  }
  if (lpaIn !== undefined) {
    if (kind === 'management') throw u.fail(400, 'The management company has no LPA terms.', 'invalid_param', { param: 'lpa' });
    const merged = Object.assign({}, kind === 'spv' ? SPV_LPA : DEFAULT_LPA, u.jsonOf(cur, 'lpa', {}) || {}, lpaIn);
    if (lpaIn.confirmed === undefined) merged.confirmed = !ctx.isAgent;
    cur.set('lpa', validateLpa(merged));
  }
  if (u.has(p, 'settings')) {
    const s = u.obj(p, 'settings');
    const curS = u.jsonOf(cur, 'settings', {}) || {};
    for (const k of Object.keys(s)) {
      if (s[k] === null) delete curS[k];
      else if (typeof s[k] !== 'object' || Array.isArray(s[k])) throw u.fail(400, 'settings.' + k + ' must be an object (per module) or null', 'invalid_param', { param: 'settings' });
      else curS[k] = Object.assign({}, curS[k] || {}, s[k]);
    }
    cur.set('settings', curS);
  }
  app.save(cur);
  const after = view(app, cur);
  L('lib_audit').note(ctx, { collection: 'entities', record: cur.id, summary: 'Changed ' + after.kind + ' ' + after.name, before: before, after: after });
  L('lib_events').emit(ctx, 'entity.updated', { entity: cur.id, kind: after.kind });
  return { entity: after };
}

function archive(ctx, p) {
  const u = L('lib_util');
  const r = need(ctx, u.req(p, 'entity'));
  if (r.getString('kind') === 'management') throw u.fail(409, 'The management company stays.', 'invalid');
  const on = u.bool(p, 'archived', true);
  r.set('archived', on);
  ctx.app.save(r);
  L('lib_audit').note(ctx, { collection: 'entities', record: r.id, summary: (on ? 'Archived ' : 'Restored ') + r.getString('name') });
  return { entity: view(ctx.app, r) };
}

module.exports = { KINDS: KINDS, STATUSES: STATUSES, LPA_KEYS: LPA_KEYS, DEFAULT_LPA: DEFAULT_LPA, SPV_LPA: SPV_LPA, validateLpa: validateLpa, view: view, ref: ref, canSee: canSee, visible: visible, create: create, list: list, get: get, save: save, archive: archive };
