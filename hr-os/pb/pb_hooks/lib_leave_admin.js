/// <reference path="../pb_data/types.d.ts" />
/**
 * Leave administration: leave types, policies (dated versions), policy
 * assignments, the bulk tools (Frappe's leave control panel: assign a policy
 * or grant days to many people at once), locked dates, adjustments, the
 * daily run on demand, and the country defaults a new entity starts with.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}
function lv() {
  return L('lib_leave');
}

const TYPE_BOOLS = ['paid', 'allow_half', 'allow_hours', 'allow_negative', 'counts_holidays', 'counts_weekends', 'statutory', 'encashable', 'payout_on_exit', 'comp_off', 'archived'];
const TYPE_INTS = ['attachment_after_days', 'min_notice_days', 'max_consecutive_days', 'sort'];

/* -------------------------------------------------------------- views */

function policyView(S, r) {
  const util = u();
  const rules = util.jsonOf(r, 'rules', []) || [];
  const hist = (util.jsonOf(r, 'history', []) || []).map((h) => ({ from: h.from || '', by: h.by || '', at: h.at || '', rules: h.rules || [] }));
  const today = util.today(S.app, r.getString('entity') || undefined);
  const assigned = util.rows(S.app, 'SELECT a.employment AS e, a.policy AS p FROM leave_policy_assignments a WHERE a.id = (SELECT b.id FROM leave_policy_assignments b WHERE b.employment = a.employment AND b.effective_from <= {:d} ORDER BY b.effective_from DESC LIMIT 1)', { e: '', p: '' }, { d: today }).filter((x) => x.p === r.id).length;
  const ent = r.getString('entity') !== '' ? util.byId(S.app, 'entities', r.getString('entity')) : null;
  return {
    id: r.id,
    name: r.getString('name'),
    entity: r.getString('entity'),
    entity_name: ent ? ent.getString('name') : '',
    country: r.getString('country'),
    period_start: r.getString('period_start') || '01-01',
    rules: rules,
    versions: hist.map((h) => ({ from: h.from, by: h.by, at: h.at, types: (h.rules || []).length })),
    history: hist,
    note: r.getString('note'),
    builtin: r.getBool('builtin'),
    archived: r.getBool('archived'),
    is_default: ent !== null && ent.getString('default_leave_policy') === r.id,
    people: assigned,
    updated: r.getString('updated'),
  };
}

function blockView(app, r) {
  const util = u();
  const dep = r.getString('department') !== '' ? util.byId(app, 'departments', r.getString('department')) : null;
  const ent = r.getString('entity') !== '' ? util.byId(app, 'entities', r.getString('entity')) : null;
  const allow = util.jsonOf(r, 'allow', []) || [];
  return {
    id: r.id,
    entity: r.getString('entity'),
    entity_name: ent ? ent.getString('name') : '',
    department: r.getString('department'),
    department_name: dep ? dep.getString('name') : '',
    from: r.getString('from'),
    to: r.getString('to'),
    reason: r.getString('reason'),
    types: util.jsonOf(r, 'types', []) || [],
    allow: allow.map((id) => {
      const e = util.byId(app, 'employees', id);
      return { id: id, name: e ? L('lib_people').displayName(e) : '', number: e ? e.getString('number') : '' };
    }),
  };
}

/* ------------------------------------------------------------ seeding */

function setType(rec, t) {
  rec.set('code', t.code);
  rec.set('name', u().clip(t.name, 120));
  rec.set('paid', t.paid !== false);
  rec.set('unit', t.unit === 'hour' ? 'hour' : 'day');
  rec.set('color', L('lib_leave_defaults').COLORS.indexOf(t.color) >= 0 ? t.color : 'ink');
  rec.set('icon', L('lib_leave_defaults').ICONS.indexOf(t.icon) >= 0 ? t.icon : 'calendar-off');
  for (const k of ['allow_half', 'allow_hours', 'allow_negative', 'counts_holidays', 'counts_weekends', 'statutory', 'encashable', 'payout_on_exit', 'comp_off']) rec.set(k, t[k] === true);
  rec.set('max_negative', Number(t.max_negative) || 0);
  for (const k of ['attachment_after_days', 'min_notice_days', 'max_consecutive_days']) rec.set(k, Math.max(0, Math.round(Number(t[k]) || 0)));
  rec.set('gender_specific', t.gender_specific || '');
  rec.set('visibility', t.visibility === 'away' ? 'away' : 'type');
  rec.set('note', u().clip(t.note || '', 2000));
}

/**
 * The country defaults for an entity: its leave types (codes it lacks) and a
 * default policy when it has none; people of the entity without a policy
 * follow it from their first day. Idempotent.
 */
function seedEntity(ctx, entityId) {
  const util = u();
  const app = ctx.app;
  const ent = app.findRecordById('entities', entityId);
  const countries = L('lib_countries');
  const cc = ent.getString('country');
  const data = countries.has(cc) ? countries.get(cc) : null;
  const d = L('lib_leave_defaults').forCountry(cc, ent.getString('region'), data);
  let added = 0;
  d.types.forEach((t, i) => {
    if (util.findOne(app, 'leave_types', 'entity = {:e} && code = {:c}', { e: ent.id, c: t.code }) !== null) return;
    const rec = util.newRecord(app, 'leave_types');
    rec.set('entity', ent.id);
    rec.set('country', cc);
    rec.set('sort', (i + 1) * 10);
    rec.set('source', 'builtin');
    setType(rec, t);
    app.save(rec);
    added++;
  });
  let pol = ent.getString('default_leave_policy') !== '' ? util.byId(app, 'leave_policies', ent.getString('default_leave_policy')) : null;
  let created = false;
  if (pol === null) {
    const rules = d.types.map((t) => Object.assign({ type: t.code }, t.rule || { method: 'none' }));
    pol = util.newRecord(app, 'leave_policies');
    pol.set('name', util.clip(d.policy + ' (' + ent.getString('name') + ')', 120));
    pol.set('entity', ent.id);
    pol.set('country', cc);
    pol.set('period_start', d.period_start);
    pol.set('rules', rules);
    pol.set('history', [{ from: '', rules: rules, by: '', at: util.nowIso() }]);
    pol.set('note', util.clip(d.note || '', 2000));
    pol.set('builtin', true);
    pol.set('archived', false);
    app.save(pol);
    const fresh = app.findRecordById('entities', ent.id);
    fresh.set('default_leave_policy', pol.id);
    app.save(fresh);
    created = true;
  }
  let assigned = 0;
  for (const r of util.rows(app, "SELECT m.id AS id, m.start_day AS s FROM employments m WHERE m.entity = {:e} AND NOT EXISTS (SELECT 1 FROM leave_policy_assignments a WHERE a.employment = m.id)", { id: '', s: '' }, { e: ent.id })) {
    const a = util.newRecord(app, 'leave_policy_assignments');
    a.set('employment', r.id);
    a.set('policy', pol.id);
    a.set('effective_from', r.s);
    a.set('note', 'The entity default, from the first day');
    a.set('by', ctx.memberId || '');
    app.save(a);
    lv().syncEmployment(null, app, r.id);
    assigned++;
  }
  return { entity: ent.id, types_added: added, policy: pol.id, policy_created: created, assigned: assigned };
}

function seedDefaultsOp(ctx, p) {
  const util = u();
  const ent = L('lib_org').entityRef(ctx.app, util.req(p, 'entity'));
  if (!L('lib_auth').inScope(ctx, ent.id)) throw util.fail(403, 'You cannot change ' + ent.getString('name') + '.', 'not_permitted');
  let out = null;
  ctx.app.runInTransaction((tx) => {
    out = seedEntity(L('lib_auth').withApp(ctx, tx), ent.id);
  });
  L('lib_audit').note(ctx, { collection: 'entities', record: ent.id, summary: 'Set up leave for ' + ent.getString('name') + ': ' + out.types_added + ' types' + (out.policy_created ? ', a default policy' : '') + (out.assigned > 0 ? ', ' + out.assigned + ' people on it' : '') });
  return out;
}

/* -------------------------------------------------------------- types */

function typesList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const S = lv().session(app);
  const entRef = util.str(p, 'entity', '');
  const archived = util.bool(p, 'archived', false);
  const out = [];
  let ents = [];
  if (entRef !== '') ents = [L('lib_org').entityRef(app, entRef).id];
  else ents = util.rows(app, 'SELECT id FROM entities WHERE active = TRUE ORDER BY created', { id: '' }).map((r) => r.id);
  ents = ents.filter((e) => L('lib_auth').inScope(ctx, e) || ctx.isAgent);
  for (const e of ents) {
    const ent = app.findRecordById('entities', e);
    for (const t of lv().typesFor(S, e, archived)) {
      const v = lv().typeView(t);
      v.entity_name = t.getString('entity') === '' ? '' : ent.getString('name');
      v.used = util.count(app, 'SELECT COUNT(*) AS n FROM leave_requests WHERE type = {:t}', { t: t.id }) + util.count(app, 'SELECT COUNT(*) AS n FROM leave_ledger WHERE type = {:t}', { t: t.id });
      out.push(v);
    }
  }
  const seen = {};
  return { types: out.filter((t) => (seen[t.id] ? false : (seen[t.id] = true))), icons: L('lib_leave_defaults').ICONS, colors: L('lib_leave_defaults').COLORS };
}

function typesSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const D = L('lib_leave_defaults');
  const ref = util.str(p, 'type', '');
  let rec = null;
  let entityId = '';
  if (ref !== '') {
    rec = util.byId(app, 'leave_types', ref);
    if (rec === null) {
      const ent = util.str(p, 'entity', '') !== '' ? L('lib_org').entityRef(app, util.str(p, 'entity', '')).id : '';
      rec = util.findOne(app, 'leave_types', 'code = {:c} && entity = {:e}', { c: ref, e: ent });
    }
    if (rec === null) throw util.fail(404, 'No leave type ' + ref + '. Run leave.types.', 'not_found');
    entityId = rec.getString('entity');
  } else {
    rec = util.newRecord(app, 'leave_types');
    entityId = util.str(p, 'entity', '') !== '' ? L('lib_org').entityRef(app, util.str(p, 'entity', '')).id : '';
    const code = util.req(p, 'code', 'study').toLowerCase();
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(code)) throw util.fail(400, 'code is lower case letters, digits and _ (e.g. study_leave).', 'invalid_param', { param: 'code' });
    if (util.findOne(app, 'leave_types', 'code = {:c} && entity = {:e}', { c: code, e: entityId }) !== null) throw util.fail(409, 'There is already a leave type ' + code + ' here.', 'duplicate');
    rec.set('code', code);
    rec.set('entity', entityId);
    rec.set('country', entityId !== '' ? app.findRecordById('entities', entityId).getString('country') : '');
    rec.set('unit', 'day');
    rec.set('color', 'rh');
    rec.set('icon', 'calendar-off');
    rec.set('paid', true);
    rec.set('allow_half', true);
    rec.set('visibility', 'type');
    rec.set('source', ctx.isAgent ? 'agent' : 'person');
    rec.set('sort', 500);
  }
  if (entityId !== '' && !L('lib_auth').inScope(ctx, entityId)) throw util.fail(403, 'You cannot change leave types of that entity.', 'not_permitted');
  const before = rec.id ? lv().typeView(rec) : null;
  if (util.has(p, 'name') || !rec.id) {
    const n = util.squash(util.text(p, 'name', 120, ''));
    if (n === '') throw util.fail(400, 'name is required', 'missing_param', { param: 'name' });
    rec.set('name', n);
  }
  if (util.has(p, 'unit')) {
    const unit = util.oneOf(p, 'unit', ['day', 'hour'], 'day');
    if (rec.id && unit !== rec.getString('unit') && util.count(app, 'SELECT COUNT(*) AS n FROM leave_ledger WHERE type = {:t}', { t: rec.id }) > 0) throw util.fail(409, 'This type already has balances in ' + rec.getString('unit') + 's. Make a new type for the other unit.', 'in_use');
    rec.set('unit', unit);
  }
  if (util.has(p, 'color')) rec.set('color', util.oneOf(p, 'color', D.COLORS, 'ink'));
  if (util.has(p, 'icon')) rec.set('icon', util.oneOf(p, 'icon', D.ICONS, 'calendar-off'));
  for (const k of TYPE_BOOLS) if (util.has(p, k)) rec.set(k, util.bool(p, k, false));
  for (const k of TYPE_INTS) if (util.has(p, k)) rec.set(k, util.int(p, k, 0, 0, k === 'sort' ? 100000 : 3650));
  if (util.has(p, 'max_negative')) rec.set('max_negative', util.num(p, 'max_negative', { min: 0, max: 3650 }) || 0);
  if (util.has(p, 'gender_specific')) rec.set('gender_specific', util.text(p, 'gender_specific', 20, ''));
  if (util.has(p, 'visibility')) rec.set('visibility', util.oneOf(p, 'visibility', ['type', 'away'], 'type'));
  if (util.has(p, 'pay_code')) rec.set('pay_code', util.text(p, 'pay_code', 40, ''));
  if (util.has(p, 'note')) rec.set('note', util.text(p, 'note', 2000, ''));
  app.save(rec);
  L('lib_audit').note(ctx, { collection: 'leave_types', record: rec.id, summary: (before ? 'Changed' : 'Added') + ' the leave type ' + rec.getString('name'), before: before, after: lv().typeView(rec) });
  return { type: lv().typeView(rec) };
}

function typesDelete(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rec = util.byId(app, 'leave_types', util.req(p, 'type'));
  if (rec === null) throw util.fail(404, 'No such leave type.', 'not_found');
  const used = util.count(app, 'SELECT COUNT(*) AS n FROM leave_requests WHERE type = {:t}', { t: rec.id }) + util.count(app, 'SELECT COUNT(*) AS n FROM leave_ledger WHERE type = {:t}', { t: rec.id }) + util.count(app, 'SELECT COUNT(*) AS n FROM leave_comp_offs WHERE type = {:t}', { t: rec.id }) + util.count(app, 'SELECT COUNT(*) AS n FROM leave_encash_requests WHERE type = {:t}', { t: rec.id });
  if (used > 0) throw util.fail(409, 'This type has requests or balances. Archive it instead (leave.types-save --archived true).', 'in_use');
  app.delete(rec);
  L('lib_audit').note(ctx, { collection: 'leave_types', record: rec.id, summary: 'Deleted the leave type ' + rec.getString('name') });
  return { deleted: true };
}

/* ----------------------------------------------------------- policies */

function num0(v, name, where, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw u().fail(400, where + ': ' + name + ' must be a number from ' + min + ' to ' + max + '.', 'invalid_param');
  return n;
}

/** Validate a rules list: one rule per type code of the entity's types. */
function readRules(app, entityId, raw) {
  const util = u();
  const M = lv().METHODS;
  const S = lv().session(app);
  const codes = lv()
    .typesFor(S, entityId, true)
    .map((t) => t.getString('code'));
  if (!Array.isArray(raw)) throw util.fail(400, 'rules must be a JSON list of rules, one per leave type.', 'invalid_param', { param: 'rules' });
  const seen = {};
  return raw.map((r0, i) => {
    const where = 'rule ' + (i + 1);
    util.keysOnly(r0, lv().RULE_KEYS, where);
    const r = {};
    r.type = String(r0.type || '');
    if (codes.indexOf(r.type) < 0) throw util.fail(400, where + ': unknown leave type "' + r.type + '". Types: ' + codes.join(', '), 'invalid_param');
    if (seen[r.type]) throw util.fail(400, where + ': ' + r.type + ' has two rules.', 'invalid_param');
    seen[r.type] = true;
    r.method = String(r0.method || 'none');
    if (M.indexOf(r.method) < 0) throw util.fail(400, where + ': method is one of ' + M.join(', '), 'invalid_param');
    const opt = (k, fn) => {
      if (r0[k] !== undefined && r0[k] !== null && r0[k] !== '') r[k] = fn(r0[k]);
    };
    const oneOf = (vals) => (v) => {
      if (vals.indexOf(String(v)) < 0) throw util.fail(400, where + ': value "' + v + '" must be one of ' + vals.join(', '), 'invalid_param');
      return String(v);
    };
    opt('amount', (v) => num0(v, 'amount', where, 0, 3650));
    opt('tenure', (v) => {
      if (!Array.isArray(v) || v.length === 0 || v.length > 60) throw util.fail(400, where + ': tenure is a list of {after, amount}.', 'invalid_param');
      return v
        .map((x, j) => {
          util.keysOnly(x, ['after', 'amount'], where + ' tenure ' + (j + 1));
          return { after: num0(x.after, 'after', where, 0, 600), amount: num0(x.amount, 'amount', where, 0, 3650) };
        })
        .sort((a, b) => a.after - b.after);
    });
    opt('tenure_unit', oneOf(['years', 'months']));
    opt('tenure_at', oneOf(['period_start', 'anniversary']));
    opt('eligible_after_months', (v) => num0(v, 'eligible_after_months', where, 0, 120));
    opt('proration', oneOf(['join', 'none']));
    opt('rounding', oneOf(['half', 'whole', 'none']));
    opt('accrual_day', oneOf(['start', 'end', 'daily']));
    opt('per_hours', (v) => {
      util.keysOnly(v, ['per', 'earn'], where + ' per_hours');
      return { per: num0(v.per, 'per_hours.per', where, 1, 1000), earn: num0(v.earn, 'per_hours.earn', where, 0.01, 100) };
    });
    opt('max_balance', (v) => num0(v, 'max_balance', where, 0, 3650));
    opt('expiry', oneOf(['period', 'grant']));
    opt('carryover_max', (v) => num0(v, 'carryover_max', where, -1, 3650));
    opt('carryover_expiry_months', (v) => num0(v, 'carryover_expiry_months', where, 0, 120));
    opt('grant_expiry_months', (v) => num0(v, 'grant_expiry_months', where, 0, 240));
    opt('scale', oneOf(['none', 'fte', 'days_per_week']));
    opt('scale_cap', (v) => num0(v, 'scale_cap', where, 0, 3650));
    opt('deduct_holidays', (v) => v === true || v === 'true');
    opt('includes', (v) => {
      if (!Array.isArray(v)) throw util.fail(400, where + ': includes is a list of type codes.', 'invalid_param');
      for (const c of v) if (codes.indexOf(String(c)) < 0 || String(c) === r.type) throw util.fail(400, where + ': includes names an unknown type ' + c + '.', 'invalid_param');
      return v.map(String);
    });
    opt('encash_max', (v) => num0(v, 'encash_max', where, 0, 3650));
    opt('max_hours_per_year', (v) => num0(v, 'max_hours_per_year', where, 0, 8760));
    opt('first_after_months', (v) => num0(v, 'first_after_months', where, 0, 24));
    opt('obligation', (v) => v === true || v === 'true');
    opt('note', (v) => util.clip(String(v), 600));
    if ((r.method === 'fixed' || r.method === 'monthly_accrual') && r.amount === undefined && !(r.method === 'monthly_accrual' && r.tenure)) throw util.fail(400, where + ': ' + r.method + ' needs amount (days or hours a leave year).', 'invalid_param');
    if (r.method === 'tenure_table' && !r.tenure) throw util.fail(400, where + ': tenure_table needs tenure, e.g. [{"after":0,"amount":7},{"after":1,"amount":8}].', 'invalid_param');
    if (r.method === 'per_hours_worked' && !r.per_hours) r.per_hours = { per: 30, earn: 1 };
    if (r.method === 'statutory_jp') {
      r.expiry = 'grant';
      if (r.grant_expiry_months === undefined) r.grant_expiry_months = 24;
    }
    return r;
  });
}

function policiesList(ctx, p) {
  const util = u();
  const S = lv().session(ctx.app);
  const entRef = util.str(p, 'entity', '');
  const where = [util.bool(p, 'archived', false) ? '1=1' : 'archived = false'];
  const bind = {};
  if (entRef !== '') {
    where.push("(entity = {:e} || entity = '')");
    bind.e = L('lib_org').entityRef(ctx.app, entRef).id;
  }
  const rows = util.findMany(ctx.app, 'leave_policies', where.join(' && '), 'name', 0, bind).filter((r) => r.getString('entity') === '' || L('lib_auth').inScope(ctx, r.getString('entity')) || ctx.isAgent);
  return { policies: rows.map((r) => policyView(S, r)), methods: lv().METHODS };
}

function policyRef(app, ref) {
  return u().byIdOrName(app, 'leave_policies', ref, 'name', 'leave.policies');
}

function policyGet(ctx, p) {
  const S = lv().session(ctx.app);
  return { policy: policyView(S, policyRef(ctx.app, u().req(p, 'policy'))) };
}

function policySave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const ref = util.str(p, 'policy', '');
  const rec = ref !== '' ? policyRef(app, ref) : util.newRecord(app, 'leave_policies');
  const S = lv().session(app);
  const before = rec.id ? policyView(S, rec) : null;
  if (!rec.id) {
    const entRef = util.str(p, 'entity', '');
    const ent = entRef !== '' ? L('lib_org').entityRef(app, entRef) : null;
    rec.set('entity', ent ? ent.id : '');
    rec.set('country', ent ? ent.getString('country') : '');
    rec.set('period_start', '01-01');
    rec.set('builtin', false);
    rec.set('archived', false);
    rec.set('history', []);
    rec.set('rules', []);
  }
  const entityId = rec.getString('entity');
  if (entityId !== '' && !L('lib_auth').inScope(ctx, entityId)) throw util.fail(403, 'You cannot change leave policies of that entity.', 'not_permitted');
  if (util.has(p, 'name') || !rec.id) {
    const n = util.squash(util.text(p, 'name', 120, ''));
    if (n === '') throw util.fail(400, 'name is required', 'missing_param', { param: 'name' });
    const dup = util.rows(app, 'SELECT id FROM leave_policies WHERE LOWER(name) = LOWER({:n}) AND id != {:x}', { id: '' }, { n: n, x: rec.id || '' });
    if (dup.length > 0) throw util.fail(409, 'There is already a policy called ' + n + '.', 'duplicate');
    rec.set('name', n);
  }
  if (util.has(p, 'period_start')) {
    const ps = util.str(p, 'period_start', '01-01');
    if (!/^(0[1-9]|1[0-2])-(0[1-9]|1\d|2[0-8])$/.test(ps)) throw util.fail(400, 'period_start is MM-DD (day 1 to 28), e.g. 04-01.', 'invalid_param', { param: 'period_start' });
    if (rec.id && ps !== rec.getString('period_start') && util.count(app, 'SELECT COUNT(*) AS n FROM leave_ledger l JOIN leave_policy_assignments a ON a.employment = l.employment WHERE a.policy = {:p}', { p: rec.id }) > 0) throw util.fail(409, 'People already have balances on this policy. Make a new policy with the other leave year and assign it from a day.', 'in_use');
    rec.set('period_start', ps);
  }
  let from = '';
  if (util.has(p, 'rules')) {
    const rules = readRules(app, entityId, util.list(p, 'rules'));
    const hist = util.jsonOf(rec, 'history', []) || [];
    if (!rec.id || hist.length === 0) from = '';
    else {
      const today = util.today(app, entityId || undefined);
      from = util.day(p, 'effective_from', lv().periodOf(rec.getString('period_start') || '01-01', today).start);
    }
    const kept = hist.filter((h) => from !== '' && String(h.from || '') < from);
    kept.push({ from: kept.length === 0 ? '' : from, rules: rules, by: ctx.memberId || (ctx.isAgent ? 'agent' : ''), at: util.nowIso() });
    rec.set('history', kept);
    rec.set('rules', rules);
  } else if (!rec.id) throw util.fail(400, 'rules is required for a new policy, e.g. [{"type":"annual","method":"fixed","amount":20}]', 'missing_param', { param: 'rules' });
  if (util.has(p, 'note')) rec.set('note', util.text(p, 'note', 2000, ''));
  if (util.has(p, 'archived')) {
    const arch = util.bool(p, 'archived', false);
    if (arch && entityId !== '' && app.findRecordById('entities', entityId).getString('default_leave_policy') === rec.id) throw util.fail(409, 'This is the default policy of its entity. Make another policy the default first.', 'in_use');
    rec.set('archived', arch);
  }
  let synced = 0;
  app.runInTransaction((tx) => {
    tx.save(rec);
    if (util.bool(p, 'make_default', false)) {
      if (entityId === '') throw util.fail(400, 'Only a policy of one entity can be its default.', 'invalid_param');
      const ent = tx.findRecordById('entities', entityId);
      ent.set('default_leave_policy', rec.id);
      tx.save(ent);
    }
    for (const r of util.rows(tx, 'SELECT DISTINCT employment FROM leave_policy_assignments WHERE policy = {:p}', { employment: '' }, { p: rec.id })) synced += lv().syncEmployment(null, tx, r.employment);
  });
  const view = policyView(lv().session(app), app.findRecordById('leave_policies', rec.id));
  L('lib_audit').note(ctx, { collection: 'leave_policies', record: rec.id, summary: (before ? 'Changed' : 'Added') + ' the leave policy ' + rec.getString('name') + (util.has(p, 'rules') && from !== '' ? ' (rules from ' + from + ')' : ''), before: before ? { rules: before.rules, period_start: before.period_start } : undefined, after: { rules: view.rules, period_start: view.period_start } });
  return { policy: view, rows_written: synced, rules_from: from };
}

function policyDelete(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rec = policyRef(app, util.req(p, 'policy'));
  if (util.count(app, 'SELECT COUNT(*) AS n FROM leave_policy_assignments WHERE policy = {:p}', { p: rec.id }) > 0) throw util.fail(409, 'People follow this policy. Archive it instead, or assign them another one first.', 'in_use');
  if (util.count(app, 'SELECT COUNT(*) AS n FROM entities WHERE default_leave_policy = {:p}', { p: rec.id }) > 0) throw util.fail(409, 'This is the default policy of an entity.', 'in_use');
  app.delete(rec);
  L('lib_audit').note(ctx, { collection: 'leave_policies', record: rec.id, summary: 'Deleted the leave policy ' + rec.getString('name') });
  return { deleted: true };
}

/* -------------------------------------------------------- assignments */

function assignmentView(app, r) {
  const util = u();
  const pol = util.byId(app, 'leave_policies', r.getString('policy'));
  const emp = util.byId(app, 'employments', r.getString('employment'));
  const person = emp ? lv().personOf(app, emp) : null;
  return { id: r.id, employment: r.getString('employment'), employee: person ? person.id : '', number: person ? person.number : '', name: person ? person.name : '', policy: r.getString('policy'), policy_name: pol ? pol.getString('name') : '', effective_from: r.getString('effective_from'), note: r.getString('note'), created: r.getString('created') };
}

function assignmentsList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const empRef = util.str(p, 'employment', '');
  if (empRef !== '') {
    const emp = L('lib_people').employmentRef(app, empRef);
    lv().needSee(ctx, emp);
    return { assignments: util.findMany(app, 'leave_policy_assignments', 'employment = {:e}', 'effective_from', 0, { e: emp.id }).map((r) => assignmentView(app, r)) };
  }
  const polRef = util.req(p, 'policy');
  const pol = policyRef(app, polRef);
  const pg = util.page(p, 100, 1000);
  return { assignments: util.findMany(app, 'leave_policy_assignments', 'policy = {:p}', '-effective_from', pg.limit, { p: pol.id }).map((r) => assignmentView(app, r)) };
}

function writeAssignment(ctx, tx, emp, pol, from, note) {
  const util = u();
  if (pol.getString('entity') !== '' && pol.getString('entity') !== emp.getString('entity')) throw util.fail(400, 'The policy ' + pol.getString('name') + ' belongs to another entity.', 'invalid_param');
  if (pol.getBool('archived')) throw util.fail(409, 'The policy ' + pol.getString('name') + ' is archived.', 'invalid');
  const day = from < emp.getString('start_day') ? emp.getString('start_day') : from;
  let r = util.findOne(tx, 'leave_policy_assignments', 'employment = {:e} && effective_from = {:d}', { e: emp.id, d: day });
  const before = r ? r.getString('policy') : '';
  if (r === null) {
    r = util.newRecord(tx, 'leave_policy_assignments');
    r.set('employment', emp.id);
    r.set('effective_from', day);
  }
  r.set('policy', pol.id);
  r.set('note', util.clip(note || '', 600));
  r.set('by', ctx.memberId || '');
  tx.save(r);
  return { id: r.id, day: day, changed: before !== pol.id };
}

function assign(ctx, p) {
  const util = u();
  const app = ctx.app;
  const emp = L('lib_people').employmentRef(app, util.req(p, 'employment'));
  const a = lv().access(ctx, emp);
  if (!(a === 'edit' || a === 'full' || ctx.isAgent)) throw util.fail(403, 'You cannot change leave policies of this person.', 'not_permitted');
  const pol = policyRef(app, util.req(p, 'policy'));
  const from = util.day(p, 'effective_from', util.today(app, emp.getString('entity')));
  let res = null;
  let rows = 0;
  app.runInTransaction((tx) => {
    res = writeAssignment(ctx, tx, emp, pol, from, util.text(p, 'note', 600, ''));
    rows = lv().syncEmployment(null, tx, emp.id);
  });
  const person = lv().personOf(app, emp);
  L('lib_audit').note(ctx, { collection: 'leave_policy_assignments', record: res.id, summary: person.name + ' follows ' + pol.getString('name') + ' from ' + res.day });
  return { assignment: assignmentView(app, app.findRecordById('leave_policy_assignments', res.id)), rows_written: rows };
}

function assignmentDelete(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = util.byId(app, 'leave_policy_assignments', util.req(p, 'assignment'));
  if (r === null) throw util.fail(404, 'No such assignment.', 'not_found');
  const emp = app.findRecordById('employments', r.getString('employment'));
  if (!L('lib_auth').inScope(ctx, emp.getString('entity'))) throw util.fail(403, 'Not in your entities.', 'not_permitted');
  const v = assignmentView(app, r);
  app.runInTransaction((tx) => {
    tx.delete(tx.findRecordById('leave_policy_assignments', r.id));
    lv().syncEmployment(null, tx, emp.id);
  });
  L('lib_audit').note(ctx, { collection: 'leave_policy_assignments', record: r.id, summary: 'Removed ' + v.policy_name + ' from ' + v.effective_from + ' for ' + v.name, before: v });
  return { deleted: true };
}

/** Employments a bulk tool applies to: an explicit list, or filters (entity, department, location, employment type) as of a day. */
function matching(ctx, p, day) {
  const util = u();
  const app = ctx.app;
  const people = L('lib_people');
  const list = util.list(p, 'employments');
  let ids = [];
  if (list !== undefined && list.length > 0) ids = list.map((r) => people.employmentRef(app, String(r)).id);
  else {
    const entRef = util.str(p, 'entity', '');
    const ent = entRef !== '' ? L('lib_org').entityRef(app, entRef).id : '';
    ids = people.activeEmployments(app, { entity: ent || undefined, from: day, to: day }).map((x) => x.id);
    const dep = util.str(p, 'department', '') !== '' ? L('lib_org').kindRef(app, 'department', util.str(p, 'department', '')).id : '';
    const loc = util.str(p, 'location', '') !== '' ? L('lib_org').kindRef(app, 'location', util.str(p, 'location', '')).id : '';
    const et = util.str(p, 'employment_type', '') !== '' ? L('lib_org').kindRef(app, 'employment_type', util.str(p, 'employment_type', '')).id : '';
    if (dep !== '' || loc !== '' || et !== '') {
      ids = ids.filter((id) => {
        const j = people.rowOn(app, 'job_records', id, day);
        if (j === null) return false;
        return (dep === '' || j.getString('department') === dep) && (loc === '' || j.getString('location') === loc) && (et === '' || j.getString('employment_type') === et);
      });
    }
  }
  const auth = L('lib_auth');
  return ids
    .map((id) => app.findRecordById('employments', id))
    .filter((m) => {
      if (!auth.inScope(ctx, m.getString('entity'))) throw util.fail(403, 'Some of these people are in an entity you cannot change.', 'not_permitted');
      return true;
    });
}

function assignBulk(ctx, p) {
  const util = u();
  const app = ctx.app;
  const pol = policyRef(app, util.req(p, 'policy'));
  const from = util.day(p, 'effective_from', util.today(app, pol.getString('entity') || undefined));
  const dry = util.bool(p, 'dry_run', false);
  const onlyUnassigned = util.bool(p, 'only_unassigned', false);
  let emps = matching(ctx, p, from);
  if (pol.getString('entity') !== '') emps = emps.filter((m) => m.getString('entity') === pol.getString('entity'));
  if (onlyUnassigned) emps = emps.filter((m) => util.findOne(app, 'leave_policy_assignments', 'employment = {:e}', { e: m.id }) === null);
  const people = emps.map((m) => {
    const cur = lv().segmentOn(lv().session(app), m, from);
    const person = lv().personOf(app, m);
    return { employment: m.id, number: person.number, name: person.name, current_policy: cur && cur.policy ? cur.policy.name : '' };
  });
  if (dry) return { dry_run: true, policy: pol.getString('name'), effective_from: from, people: people, count: people.length };
  let rows = 0;
  app.runInTransaction((tx) => {
    for (const m of emps) {
      writeAssignment(ctx, tx, m, pol, from, util.text(p, 'note', 600, 'Bulk assignment'));
      rows += lv().syncEmployment(null, tx, m.id);
    }
  });
  L('lib_audit').note(ctx, { collection: 'leave_policies', record: pol.id, summary: emps.length + ' people follow ' + pol.getString('name') + ' from ' + from });
  return { dry_run: false, policy: pol.getString('name'), effective_from: from, people: people, count: people.length, rows_written: rows };
}

/** Write one adjustment-like row (inside the caller's transaction). */
function writeRow(ctx, tx, empId, typeId, day, amount, kind, ref, note, expires) {
  const util = u();
  const r = util.newRecord(tx, 'leave_ledger');
  r.set('employment', empId);
  r.set('type', typeId);
  r.set('day', day);
  r.set('amount', lv().r2(amount));
  r.set('kind', kind);
  r.set('key', '');
  r.set('expires', expires || '');
  r.set('ref', ref || '');
  r.set('note', util.clip(note || '', 600));
  r.set('actor', ctx.isAgent ? 'agent' : ctx.actor === 'person' ? 'person' : 'system');
  r.set('member', ctx.memberId || '');
  tx.save(r);
  return r;
}

function grantBulk(ctx, p) {
  const util = u();
  const app = ctx.app;
  const day = util.day(p, 'day', util.today(app));
  const amount = util.num(p, 'amount', { min: -365, max: 365 });
  if (amount === null || amount === 0) throw util.fail(400, 'amount is required (days or hours to add; negative to take away).', 'missing_param', { param: 'amount' });
  const reason = util.squash(util.text(p, 'reason', 600, ''));
  if (reason === '') throw util.fail(400, 'reason is required (people see it in their balance).', 'missing_param', { param: 'reason' });
  const expires = util.day(p, 'expires', '');
  if (expires !== '' && expires <= day) throw util.fail(400, 'expires must be after day.', 'invalid_param');
  const code = util.req(p, 'type', 'annual');
  const dry = util.bool(p, 'dry_run', false);
  const S = lv().session(app);
  const emps = matching(ctx, p, day);
  const plan = [];
  for (const m of emps) {
    let t = null;
    try {
      t = lv().typeRef(S, m.getString('entity'), code);
    } catch {
      t = null;
    }
    const person = lv().personOf(app, m);
    plan.push({ employment: m.id, number: person.number, name: person.name, type: t ? t.id : '', ok: t !== null, note: t ? '' : 'No leave type ' + code + ' in their entity' });
  }
  if (dry) return { dry_run: true, people: plan, count: plan.filter((x) => x.ok).length };
  const ref = 'bulk:' + util.token(10);
  let n = 0;
  app.runInTransaction((tx) => {
    for (const x of plan) {
      if (!x.ok) continue;
      writeRow(ctx, tx, x.employment, x.type, day, amount, amount > 0 ? 'grant' : 'adjust', ref, reason, amount > 0 ? expires : '');
      n++;
    }
  });
  L('lib_audit').note(ctx, { collection: 'leave_ledger', record: ref, summary: (amount > 0 ? 'Granted ' : 'Took away ') + Math.abs(amount) + ' of ' + code + ' for ' + n + ' people on ' + day + ': ' + reason });
  return { dry_run: false, people: plan, count: n, ref: ref };
}

function adjust(ctx, p) {
  const util = u();
  const app = ctx.app;
  const emp = L('lib_people').employmentRef(app, util.req(p, 'employment'));
  const a = lv().access(ctx, emp);
  if (!(a === 'edit' || a === 'full' || ctx.isAgent)) throw util.fail(403, 'You cannot adjust this person\'s leave (needs edit access to Leave).', 'not_permitted');
  const S = lv().session(app);
  const t = lv().typeRef(S, emp.getString('entity'), util.req(p, 'type', 'annual'));
  const amount = util.num(p, 'amount', { min: -3650, max: 3650 });
  if (amount === null || amount === 0) throw util.fail(400, 'amount is required: days (or hours) to add, negative to take away.', 'missing_param', { param: 'amount' });
  const reason = util.squash(util.text(p, 'reason', 600, ''));
  if (reason === '') throw util.fail(400, 'reason is required (the person sees it in their balance).', 'missing_param', { param: 'reason' });
  const day = util.day(p, 'day', util.today(app, emp.getString('entity')));
  if (day < emp.getString('start_day')) throw util.fail(400, 'day is before the first day of the employment (' + emp.getString('start_day') + ').', 'invalid_param');
  const expires = util.day(p, 'expires', '');
  if (expires !== '' && (expires <= day || amount < 0)) throw util.fail(400, 'expires is for days added, after day.', 'invalid_param');
  const before = lv().balanceInfo(S, emp, t, day, {});
  let rec = null;
  app.runInTransaction((tx) => {
    rec = writeRow(ctx, tx, emp.id, t.id, day, amount, 'adjust', util.str(p, 'ref', ''), reason, expires);
    lv().syncEmployment(null, tx, emp.id);
  });
  const after = lv().balanceInfo(lv().session(app), emp, t, day, {});
  const person = lv().personOf(app, emp);
  L('lib_audit').note(ctx, { collection: 'leave_ledger', record: rec.id, summary: 'Adjusted ' + t.getString('name') + ' of ' + person.name + ' by ' + (amount > 0 ? '+' : '') + amount + ' ' + t.getString('unit') + 's: ' + reason, before: { balance: before.balance }, after: { balance: after.balance } });
  return { row: rec.id, balance: after };
}

/** Proposal preview of an adjustment: the balance before and after. */
function previewAdjust(ctx, p) {
  const util = u();
  const app = ctx.app;
  const emp = L('lib_people').employmentRef(app, util.req(p, 'employment'));
  const S = lv().session(app);
  const t = lv().typeRef(S, emp.getString('entity'), util.req(p, 'type', 'annual'));
  const day = util.day(p, 'day', util.today(app, emp.getString('entity')));
  const b = lv().balanceInfo(S, emp, t, day, {});
  const amount = Number(p.amount) || 0;
  const person = lv().personOf(app, emp);
  return { label: 'Adjust ' + t.getString('name') + ' of ' + person.name + ' by ' + (amount > 0 ? '+' : '') + amount + ' ' + t.getString('unit') + 's', target: 'employments:' + emp.id, fields: [{ name: 'balance on ' + day, before: b.balance === null ? '' : b.balance, after: b.balance === null ? '' : lv().r2(b.balance + amount) }], notes: [String(p.reason || '')], risk: Math.abs(amount) > 5 ? 'high' : 'medium' };
}

/* -------------------------------------------------------------- blocks */

function blocksList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const from = util.day(p, 'from', util.dayAdd(util.today(app), -31));
  const to = util.day(p, 'to', util.dayAdd(from, 800));
  const rows = util.findMany(app, 'leave_blocks', 'to >= {:f} && from <= {:t}', 'from', 0, { f: from, t: to });
  return { blocks: rows.filter((r) => r.getString('entity') === '' || L('lib_auth').inScope(ctx, r.getString('entity')) || ctx.isAgent).map((r) => blockView(app, r)) };
}

function blockSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const ref = util.str(p, 'block', '');
  const rec = ref !== '' ? util.byId(app, 'leave_blocks', ref) : util.newRecord(app, 'leave_blocks');
  if (rec === null) throw util.fail(404, 'No such locked period.', 'not_found');
  const before = rec.id ? blockView(app, rec) : null;
  if (util.has(p, 'entity') || !rec.id) rec.set('entity', util.str(p, 'entity', '') !== '' ? L('lib_org').entityRef(app, util.str(p, 'entity', '')).id : '');
  if (rec.getString('entity') !== '' && !L('lib_auth').inScope(ctx, rec.getString('entity'))) throw util.fail(403, 'Not in your entities.', 'not_permitted');
  if (util.has(p, 'department')) rec.set('department', util.str(p, 'department', '') !== '' ? L('lib_org').kindRef(app, 'department', util.str(p, 'department', '')).id : '');
  if (util.has(p, 'from') || !rec.id) rec.set('from', util.day(p, 'from', '') || (() => { throw util.fail(400, 'from is required', 'missing_param', { param: 'from' }); })());
  if (util.has(p, 'to') || !rec.id) rec.set('to', util.day(p, 'to', '') || rec.getString('from'));
  if (rec.getString('to') < rec.getString('from')) throw util.fail(400, 'to is before from.', 'invalid_param');
  if (util.has(p, 'reason') || !rec.id) {
    const r = util.squash(util.text(p, 'reason', 300, ''));
    if (r === '') throw util.fail(400, 'reason is required (people see it), e.g. Year-end close.', 'missing_param', { param: 'reason' });
    rec.set('reason', r);
  }
  if (util.has(p, 'allow')) rec.set('allow', (util.list(p, 'allow') || []).map((x) => L('lib_people').employeeRef(app, String(x)).id));
  else if (!rec.id) rec.set('allow', []);
  if (util.has(p, 'types')) rec.set('types', (util.list(p, 'types') || []).map(String));
  else if (!rec.id) rec.set('types', []);
  rec.set('created_by', rec.getString('created_by') || ctx.memberId || '');
  app.save(rec);
  L('lib_audit').note(ctx, { collection: 'leave_blocks', record: rec.id, summary: (before ? 'Changed' : 'Locked') + ' leave from ' + rec.getString('from') + ' to ' + rec.getString('to') + ': ' + rec.getString('reason'), before: before, after: blockView(app, rec) });
  return { block: blockView(app, rec) };
}

function blockDelete(ctx, p) {
  const util = u();
  const rec = util.byId(ctx.app, 'leave_blocks', util.req(p, 'block'));
  if (rec === null) throw util.fail(404, 'No such locked period.', 'not_found');
  ctx.app.delete(rec);
  L('lib_audit').note(ctx, { collection: 'leave_blocks', record: rec.id, summary: 'Unlocked leave from ' + rec.getString('from') + ' to ' + rec.getString('to') });
  return { deleted: true };
}

/** Blocks that cover [from, to] for an employment (its entity and department on `from`), minus those it is allowed through. */
function blocksFor(app, empRec, from, to, typeCode) {
  const util = u();
  const job = L('lib_people').rowOn(app, 'job_records', empRec.id, from);
  const dep = job !== null ? job.getString('department') : '';
  const out = [];
  for (const r of util.findMany(app, 'leave_blocks', 'to >= {:f} && from <= {:t}', 'from', 0, { f: from, t: to })) {
    if (r.getString('entity') !== '' && r.getString('entity') !== empRec.getString('entity')) continue;
    if (r.getString('department') !== '' && r.getString('department') !== dep) continue;
    const types = util.jsonOf(r, 'types', []) || [];
    if (types.length > 0 && typeCode && types.indexOf(typeCode) < 0) continue;
    const allow = util.jsonOf(r, 'allow', []) || [];
    if (allow.indexOf(empRec.getString('employee')) >= 0) continue;
    out.push({ id: r.id, from: r.getString('from'), to: r.getString('to'), reason: r.getString('reason') });
  }
  return out;
}

/* ---------------------------------------------------------------- run */

function syncOp(ctx, p) {
  const util = u();
  const app = ctx.app;
  const empRef = util.str(p, 'employment', '');
  if (empRef !== '') {
    const emp = L('lib_people').employmentRef(app, empRef);
    lv().needSee(ctx, emp);
    const n = lv().syncNow(app, emp.id);
    L('lib_audit').note(ctx, { collection: 'leave_ledger', record: emp.id, summary: 'Brought the leave balances of ' + lv().personOf(app, emp).name + ' up to date (' + n + ' rows)' });
    return { rows: n };
  }
  const entRef = util.str(p, 'entity', '');
  const ents = entRef !== '' ? [L('lib_org').entityRef(app, entRef).id] : util.rows(app, 'SELECT id FROM entities WHERE active = TRUE', { id: '' }).map((r) => r.id);
  const out = [];
  for (const e of ents) if (L('lib_auth').inScope(ctx, e) || ctx.isAgent) out.push(lv().runEntity(app, e, true));
  L('lib_audit').note(ctx, { collection: 'leave_sync', record: '', summary: 'Ran the daily leave run now for ' + out.length + ' entities' });
  return { runs: out };
}

function syncLog(ctx, p) {
  const util = u();
  const rows = util.findMany(ctx.app, 'leave_sync', '1=1', '-day', util.int(p, 'limit', 30, 1, 200));
  return { runs: rows.map((r) => ({ id: r.id, entity: r.getString('entity'), day: r.getString('day'), employments: r.getInt('employments'), rows: r.getInt('rows'), errors: r.getInt('errors'), ms: r.getInt('ms'), note: r.getString('note'), at: r.getString('updated') })) };
}

module.exports = {
  policyView: policyView,
  blockView: blockView,
  seedEntity: seedEntity,
  seedDefaultsOp: seedDefaultsOp,
  typesList: typesList,
  typesSave: typesSave,
  typesDelete: typesDelete,
  readRules: readRules,
  policiesList: policiesList,
  policyRef: policyRef,
  policyGet: policyGet,
  policySave: policySave,
  policyDelete: policyDelete,
  assignmentsList: assignmentsList,
  assign: assign,
  assignmentDelete: assignmentDelete,
  assignBulk: assignBulk,
  matching: matching,
  writeRow: writeRow,
  grantBulk: grantBulk,
  adjust: adjust,
  previewAdjust: previewAdjust,
  blocksList: blocksList,
  blockSave: blockSave,
  blockDelete: blockDelete,
  blocksFor: blocksFor,
  syncOp: syncOp,
  syncLog: syncLog,
};
