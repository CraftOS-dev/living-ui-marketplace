/// <reference path="../pb_data/types.d.ts" />
/**
 * Overtime rules per entity (the rules engine is lib_time_rules.js) and
 * overtime pre-approval requests (approval kind overtime), for entities
 * whose rules say overtime should be approved before it is worked.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}
function T() {
  return L('lib_time');
}

function ruleView(app, r) {
  const util = u();
  const rules = L('lib_time_rules');
  const ent = util.byId(app, 'entities', r.getString('entity'));
  return {
    id: r.id,
    entity: r.getString('entity'),
    entity_name: ent ? ent.getString('name') : '',
    name: r.getString('name'),
    country: r.getString('country'),
    rules: util.jsonOf(r, 'rules', []) || [],
    settings: rules.normaliseSettings(util.jsonOf(r, 'settings', {}) || {}),
    caps: util.jsonOf(r, 'caps', {}) || {},
    applies: util.jsonOf(r, 'applies', {}) || {},
    active: r.getBool('active'),
    source: r.getString('source'),
    notes: r.getString('notes'),
    updated: r.getString('updated'),
  };
}

/** Create the country's default rule set for an entity (entity.created, or a reset). */
function seedDefaults(app, ent, source) {
  const util = u();
  const rules = L('lib_time_rules');
  const d = rules.defaultsFor(ent.getString('country'), ent.getString('region'));
  const r = util.newRecord(app, 'overtime_rules');
  r.set('entity', ent.id);
  r.set('name', d.name);
  r.set('country', ent.getString('country'));
  r.set('rules', rules.normaliseRules(d.rules));
  const s = Object.assign({}, d.settings);
  r.set('settings', s);
  r.set('caps', rules.normaliseCaps(d.caps));
  r.set('applies', {});
  r.set('active', true);
  r.set('source', source || 'builtin');
  r.set('notes', util.clip(d.notes || '', 4000));
  app.save(r);
  return r;
}

function ruleRef(app, ref) {
  return u().byIdOrName(app, 'overtime_rules', ref, 'name', 'overtime-rules.list');
}

function rulesList(ctx, p) {
  const util = u();
  const auth = L('lib_auth');
  const ent = util.str(p, 'entity', '');
  const where = ent !== '' ? 'entity = {:e}' : '1=1';
  const bind = ent !== '' ? { e: L('lib_org').entityRef(ctx.app, ent).id } : {};
  return {
    rule_sets: util
      .findMany(ctx.app, 'overtime_rules', where, 'entity,created', 0, bind)
      .filter((r) => auth.inScope(ctx, r.getString('entity')))
      .map((r) => ruleView(ctx.app, r)),
    when: L('lib_time_rules').WHEN,
    settings_default: L('lib_time_rules').SETTINGS_DEFAULT,
    cap_keys: L('lib_time_rules').CAP_KEYS.concat(['year_start']),
  };
}

function rulesDefaults(ctx, p) {
  const util = u();
  const d = L('lib_time_rules').defaultsFor(util.req(p, 'country', 'JP'), util.str(p, 'region', ''));
  return { defaults: d };
}

/** overtime-rules.save: add or change an entity's rule set (rules, settings, caps, who it applies to). */
function rulesSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rules = L('lib_time_rules');
  const id = util.str(p, 'rule_set', '');
  const rec = id !== '' ? ruleRef(app, id) : util.newRecord(app, 'overtime_rules');
  const before = id !== '' ? ruleView(app, rec) : null;
  if (id === '') {
    const ent = L('lib_org').entityRef(app, util.req(p, 'entity'));
    if (!L('lib_auth').inScope(ctx, ent.id)) throw util.fail(403, 'This entity is outside your scope.', 'not_permitted');
    rec.set('entity', ent.id);
    rec.set('country', ent.getString('country'));
    rec.set('active', true);
    rec.set('source', ctx.isAgent ? 'agent' : 'person');
    rec.set('rules', []);
    rec.set('settings', {});
    rec.set('caps', {});
    rec.set('applies', {});
  } else if (!L('lib_auth').inScope(ctx, rec.getString('entity'))) throw util.fail(403, 'This rule set is outside your entities.', 'not_permitted');
  if (id === '' || util.has(p, 'name')) rec.set('name', util.squash(util.req(p, 'name', 'Hourly staff overtime')).slice(0, 120));
  const raw = util.list(p, 'rules');
  if (raw !== undefined) rec.set('rules', rules.normaliseRules(raw));
  const st = util.obj(p, 'settings');
  if (st !== undefined) {
    const merged = Object.assign({}, util.jsonOf(rec, 'settings', {}) || {}, st);
    rules.normaliseSettings(merged);
    const keep = {};
    for (const k of Object.keys(merged)) if (merged[k] !== null && merged[k] !== '') keep[k] = merged[k];
    rec.set('settings', keep);
  }
  const caps = util.obj(p, 'caps');
  if (caps !== undefined) rec.set('caps', rules.normaliseCaps(caps));
  const ap = util.obj(p, 'applies');
  if (ap !== undefined) {
    util.keysOnly(ap, ['employment_types'], 'applies');
    const types = Array.isArray(ap.employment_types) ? ap.employment_types.map(String) : [];
    for (const c of types) if (util.findOne(app, 'employment_types', 'code = {:c}', { c: c }) === null) throw util.fail(400, 'applies: no employment type with the code ' + c + '. Run employment-types.list.', 'invalid_param');
    rec.set('applies', { employment_types: types });
  }
  if (util.has(p, 'active')) rec.set('active', util.bool(p, 'active', true));
  if (util.has(p, 'notes')) rec.set('notes', util.text(p, 'notes', 4000, ''));
  app.save(rec);
  const after = ruleView(app, rec);
  L('lib_audit').note(ctx, { collection: 'overtime_rules', record: rec.id, summary: (id === '' ? 'Added' : 'Changed') + ' the overtime rules ' + after.name, before: before, after: after });
  return { rule_set: after };
}

function previewRulesSave(ctx, p) {
  const util = u();
  const id = util.str(p, 'rule_set', '');
  const rec = id !== '' ? util.byId(ctx.app, 'overtime_rules', id) : null;
  const cur = rec !== null ? ruleView(ctx.app, rec) : null;
  const fields = [];
  for (const k of ['name', 'rules', 'settings', 'caps', 'applies', 'active']) {
    if (!util.has(p, k)) continue;
    const before = cur ? (typeof cur[k] === 'object' ? JSON.stringify(cur[k]) : String(cur[k])) : '';
    const after = typeof p[k] === 'object' ? JSON.stringify(p[k]) : String(p[k]);
    if (before !== after) fields.push({ name: k, before: before, after: after });
  }
  return { label: (cur ? 'Change the overtime rules ' + cur.name : 'Add overtime rules'), target: rec ? 'overtime_rules:' + rec.id : '', fields: fields, notes: ['Overtime rules change how hours are paid from the next calculation on.'], risk: 'high' };
}

function rulesReset(ctx, p) {
  const util = u();
  const app = ctx.app;
  const ent = L('lib_org').entityRef(app, util.req(p, 'entity'));
  if (!L('lib_auth').inScope(ctx, ent.id)) throw util.fail(403, 'This entity is outside your scope.', 'not_permitted');
  let rec = null;
  app.runInTransaction((tx) => {
    for (const r of util.findMany(tx, 'overtime_rules', 'entity = {:e} && active = true', '', 0, { e: ent.id })) {
      const ap = util.jsonOf(r, 'applies', {}) || {};
      if (Array.isArray(ap.employment_types) && ap.employment_types.length > 0) continue;
      r.set('active', false);
      tx.save(r);
    }
    rec = seedDefaults(tx, tx.findRecordById('entities', ent.id), 'builtin');
  });
  L('lib_audit').note(ctx, { collection: 'overtime_rules', record: rec.id, summary: 'Reset the overtime rules of ' + ent.getString('name') + ' to the ' + ent.getString('country') + ' defaults' });
  return { rule_set: ruleView(app, rec) };
}

function rulesDelete(ctx, p) {
  const util = u();
  const rec = ruleRef(ctx.app, util.req(p, 'rule_set'));
  if (!L('lib_auth').inScope(ctx, rec.getString('entity'))) throw util.fail(403, 'This rule set is outside your entities.', 'not_permitted');
  ctx.app.delete(rec);
  L('lib_audit').note(ctx, { collection: 'overtime_rules', record: rec.id, summary: 'Deleted the overtime rules ' + rec.getString('name') });
  return { deleted: true };
}

/** overtime-rules.try: classify a made-up week with a rule set (nothing saved), to check rules before saving. */
function rulesTry(ctx, p) {
  const util = u();
  const rules = L('lib_time_rules');
  let rs = null;
  if (util.str(p, 'rule_set', '') !== '') rs = ruleView(ctx.app, ruleRef(ctx.app, util.str(p, 'rule_set', '')));
  const list = util.list(p, 'rules');
  const r = list !== undefined ? rules.normaliseRules(list) : rs ? rs.rules : [];
  const settings = rules.normaliseSettings(util.obj(p, 'settings') || (rs ? rs.settings : {}));
  const days = util.list(p, 'days');
  if (days === undefined) throw util.fail(400, 'days is a JSON list [{"day":"2026-11-02","kind":"work","worked":600,"night":0}].', 'missing_param', { param: 'days' });
  const clean = days.map((d, i) => {
    util.keysOnly(d, ['day', 'kind', 'worked', 'night', 'leave'], 'day ' + (i + 1));
    if (!util.isDay(String(d.day))) throw util.fail(400, 'day ' + (i + 1) + ': day is YYYY-MM-DD.', 'invalid_param');
    return { day: String(d.day), kind: ['work', 'rest', 'holiday'].indexOf(d.kind) >= 0 ? d.kind : 'work', worked: Math.max(0, Math.round(Number(d.worked) || 0)), night: Math.max(0, Math.round(Number(d.night) || 0)), leave: Math.max(0, Math.round(Number(d.leave) || 0)) };
  });
  clean.sort((a, b) => (a.day < b.day ? -1 : 1));
  const out = rules.classify(clean, r, { week_start: settings.week_start === null ? 1 : settings.week_start, counts_leave: settings.counts_leave });
  return { days: out };
}

/* ----------------------------------------------------- overtime requests */

function otRequestView(app, r) {
  const util = u();
  const m = util.byId(app, 'employments', r.getString('employment'));
  const e = m ? util.byId(app, 'employees', m.getString('employee')) : null;
  return { id: r.id, employment: r.getString('employment'), name: e ? L('lib_people').displayName(e) : '', number: e ? e.getString('number') : '', day: r.getString('day'), minutes: r.getInt('minutes'), approved_min: r.getInt('approved_min'), reason: r.getString('reason'), status: r.getString('status'), approval: r.getString('approval'), decided_note: r.getString('decided_note'), created: r.getString('created') };
}

/** overtime-requests.add: ask in advance (or just after) to work overtime on a day. */
function otRequestsAdd(ctx, p) {
  const util = u();
  const t = T();
  const app = ctx.app;
  const m = t.selfEmployment(ctx, util.str(p, 'employment', ''));
  const day = util.day(p, 'day', '');
  if (day === '') throw util.fail(400, 'day is required.', 'missing_param', { param: 'day' });
  const minutes = util.int(p, 'minutes', 0, 1, 1440);
  if (!(minutes > 0)) throw util.fail(400, 'minutes is how much overtime, e.g. 120.', 'missing_param', { param: 'minutes' });
  const reason = util.text(p, 'reason', 2000, '');
  if (reason === '') throw util.fail(400, 'Say why in reason.', 'missing_param', { param: 'reason' });
  const R = t.resolver(app);
  if (day < util.dayAdd(R.today(m.id), -7)) throw util.fail(400, 'Overtime is asked for at most a week after the day.', 'invalid_param');
  const rec = util.newRecord(app, 'overtime_requests');
  rec.set('employment', m.id);
  rec.set('day', day);
  rec.set('minutes', minutes);
  rec.set('approved_min', 0);
  rec.set('reason', reason);
  rec.set('status', 'pending');
  rec.set('requester', ctx.memberId || '');
  const emp = app.findRecordById('employees', m.getString('employee'));
  let ap = null;
  app.runInTransaction((tx) => {
    tx.save(rec);
    const plan = t.planOf(t.resolver(tx), m.id, day);
    ap = L('lib_approvals').open(L('lib_auth').withApp(ctx, tx), { kind: 'overtime', ref_collection: 'overtime_requests', ref_id: rec.id, employment: m.id, summary: 'Overtime for ' + L('lib_people').displayName(emp) + ': ' + t.hm(minutes) + ' on ' + L('lib_time_shift').dayLabel(day), facts: [t.fact.days('day', 'Day', day), t.fact.hours('overtime', 'Overtime', minutes)].concat(plan.start !== '' ? [t.fact.text('planned', 'Planned', plan.start + ' to ' + plan.end)] : []), payload: { request: rec.id, day: day, minutes: minutes, reason: reason, planned: plan.start !== '' ? plan.start + ' to ' + plan.end : '', day_kind: plan.kind } });
    const fresh = tx.findRecordById('overtime_requests', rec.id);
    fresh.set('approval', ap.id);
    tx.save(fresh);
  });
  L('lib_audit').note(ctx, { collection: 'overtime_requests', record: rec.id, summary: 'Asked for ' + t.hm(minutes) + ' of overtime on ' + day });
  return { request: otRequestView(app, app.findRecordById('overtime_requests', rec.id)), approval: ap };
}

function otRequestsList(ctx, p) {
  const util = u();
  const t = T();
  const app = ctx.app;
  const which = util.oneOf(p, 'view', ['mine', 'team'], 'mine');
  let ids = [];
  if (which === 'mine') {
    if (ctx.employeeId === '') return { requests: [] };
    ids = util.rows(app, 'SELECT id FROM employments WHERE employee = {:e}', { id: '' }, { e: ctx.employeeId }).map((r) => r.id);
  } else {
    const today = util.today(app);
    ids = t.roster(ctx, util.dayAdd(today, -90), util.dayAdd(today, 60), { entity: util.str(p, 'entity', '') }).map((r) => r.employment);
  }
  if (ids.length === 0) return { requests: [] };
  const bind = {};
  const keys = '(' + ids.map((id, i) => ((bind['e' + i] = id), '{:e' + i + '}')).join(',') + ')';
  const st = util.oneOf(p, 'status', ['pending', 'approved', 'rejected', 'cancelled', 'all'], 'all');
  return { requests: util.rows(app, 'SELECT id FROM overtime_requests WHERE employment IN ' + keys + (st !== 'all' ? ' AND status = {:s}' : '') + ' ORDER BY day DESC LIMIT 300', { id: '' }, Object.assign(bind, { s: st })).map((x) => otRequestView(app, app.findRecordById('overtime_requests', x.id))) };
}

function otRequestsCancel(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rec = util.byId(app, 'overtime_requests', util.req(p, 'request'));
  if (rec === null) throw util.fail(404, 'No such request.', 'not_found');
  const m = app.findRecordById('employments', rec.getString('employment'));
  if (!(ctx.employeeId !== '' && m.getString('employee') === ctx.employeeId) && !L('lib_auth').can(ctx, 'time', 'full')) throw util.fail(403, 'Only the person who asked (or HR) can cancel this request.', 'not_permitted');
  if (rec.getString('status') !== 'pending') return { request: otRequestView(app, rec) };
  if (rec.getString('approval') !== '') L('lib_approvals').cancel(ctx, rec.getString('approval'), util.text(p, 'note', 500, ''));
  L('lib_audit').note(ctx, { collection: 'overtime_requests', record: rec.id, summary: 'Cancelled an overtime request' });
  return { request: otRequestView(app, app.findRecordById('overtime_requests', rec.id)) };
}

/** Approval subscriber (kind overtime). */
function onDecision(ctx, approval, decision, note) {
  const util = u();
  const app = ctx.app;
  const rec = util.byId(app, 'overtime_requests', approval.ref_id);
  if (rec === null) return null;
  rec.set('status', decision === 'approved' ? 'approved' : decision === 'rejected' ? 'rejected' : 'cancelled');
  rec.set('approved_min', decision === 'approved' ? rec.getInt('minutes') : 0);
  rec.set('decided_note', util.clip(note || '', 2000));
  app.save(rec);
  return { status: rec.getString('status') };
}

module.exports = {
  ruleView: ruleView,
  seedDefaults: seedDefaults,
  rulesList: rulesList,
  rulesDefaults: rulesDefaults,
  rulesSave: rulesSave,
  previewRulesSave: previewRulesSave,
  rulesReset: rulesReset,
  rulesDelete: rulesDelete,
  rulesTry: rulesTry,
  otRequestView: otRequestView,
  otRequestsAdd: otRequestsAdd,
  otRequestsList: otRequestsList,
  otRequestsCancel: otRequestsCancel,
  onDecision: onDecision,
};
