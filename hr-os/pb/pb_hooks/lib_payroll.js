/// <reference path="../pb_data/types.d.ts" />
/**
 * Payroll set-up and the payroll contracts (payroll-core).
 *
 *   settings per entity (proration, net rounding, pay method, who approves
 *   runs, the entity fields the rule packs read), pay schedules and the pay
 *   calendar (periods, cutoffs, pay dates moved off weekends and holidays),
 *   pay components (seeded when an entity is created from its packs'
 *   seed_components plus a basic set), Payroll home.
 *
 * Contract for other modules (SPEC 3.5):
 *   recentPayslips(app, employmentId, n) -> [{ id, period_start, period_end, pay_date, net_minor, currency, status }]
 *   compensationOf(app, employmentId, day) -> { basis, amount_minor, currency, period, pay_schedule } | null
 *
 * Event subscribers (events_payroll.js): entity.created, separation.approved,
 * separation.changed,
 * employment.changed, record.editing; profileFacts.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}

const PRORATION = ['calendar_days', 'working_days', 'fixed_30'];
const NET_ROUNDING = ['none', '0.05', '0.1', '1', '5', '10', '100'];
const PAY_METHODS = ['bank', 'cash', 'cheque'];
const PUBLISH = ['scheduled', 'immediate', 'manual'];
const FREQUENCIES = ['monthly', 'semi_monthly', 'biweekly', 'weekly'];
const PER_YEAR = { monthly: 12, semi_monthly: 24, biweekly: 26, weekly: 52 };
const KINDS = ['earning', 'deduction', 'employer', 'reimbursement', 'info'];
const STAGES = ['pre', 'statutory', 'post'];
const CALCS = ['fixed', 'percent', 'hours', 'days', 'formula', 'input', 'pack'];
/** Tags of the leave paid out on leaving (QA2 N-1): packs read them to treat it apart from salary. */
const EXIT_TAGS = ['exit_leave_payout', 'termination'];

const ROLES = ['basic', 'hourly', 'daily', 'overtime', 'unpaid', 'allowance', 'bonus', 'commission', 'reimbursement', 'advance', 'advance_payout', 'loan', 'arrears', 'encash', 'exit_leave', 'gratuity', 'notice', 'benefit', 'rounding', 'other'];

/** Proration most employers in the country use for a part month (a default a person can change). */
const COUNTRY_PRORATION = { SG: 'working_days', MY: 'calendar_days', IN: 'calendar_days', JP: 'working_days', US: 'working_days', GB: 'calendar_days', AU: 'working_days', CA: 'working_days' };
/** The pay day most employers in the country use for a monthly schedule. */
const COUNTRY_PAY_DAY = { JP: { kind: 'day_of_month', day: 25, adjust: 'before' } };

/**
 * Roles of the built-in packs' seed components (data: the pack builders'
 * component codes). A seed code not listed is 'other'; a person can change
 * the role of any component.
 */
const SEED_ROLE = {
  US_SALARY: 'basic', US_HOURLY: 'hourly', US_OT: 'overtime', US_BONUS: 'bonus', US_COMMISSION: 'commission', US_REIMB: 'reimbursement',
  SG_BASIC: 'basic', SG_ALLOWANCE: 'allowance', SG_OVERTIME: 'overtime', SG_BONUS: 'bonus',
  JP_BASE: 'basic', JP_OVERTIME: 'overtime', JP_ALLOWANCE: 'allowance', JP_COMMUTE: 'allowance', JP_BONUS: 'bonus',
  IN_BASIC: 'basic', IN_DA: 'allowance', IN_HRA: 'allowance', IN_SPECIAL: 'allowance', IN_CONVEYANCE: 'allowance', IN_OVERTIME: 'overtime', IN_BONUS: 'bonus',
  MY_BASIC: 'basic', MY_FIXED_ALLOWANCE: 'allowance', MY_OVERTIME: 'overtime', MY_BONUS: 'bonus',
  GB_SALARY: 'basic', GB_OVERTIME: 'overtime', GB_BONUS: 'bonus', GB_EXPENSES: 'reimbursement',
  AU_SALARY: 'basic', AU_OVERTIME: 'overtime', AU_ALLOWANCE: 'allowance', AU_REIMB: 'reimbursement',
  BASIC: 'basic', OVERTIME: 'overtime', ALLOWANCE: 'allowance', BONUS: 'bonus', REIMB: 'reimbursement',
};

/**
 * The basic set every entity gets (when its packs do not seed a component
 * with that role). `like`: the role whose pack tags the component copies so
 * the packs see it as the right kind of pay.
 */
const BASIC_SET = [
  { code: 'BASIC', name: 'Base salary', kind: 'earning', calc: 'fixed', role: 'basic', like: 'basic', prorate: true, sort: 10 },
  { code: 'HOURLY', name: 'Hourly pay', kind: 'earning', calc: 'hours', role: 'hourly', like: 'basic', sort: 11 },
  { code: 'DAILY', name: 'Daily pay', kind: 'earning', calc: 'days', role: 'daily', like: 'basic', sort: 12 },
  { code: 'OT125', name: 'Overtime 1.25x', kind: 'earning', calc: 'hours', role: 'overtime', like: 'overtime', multiplier: 1.25, sort: 20, always: true },
  { code: 'OT135', name: 'Overtime 1.35x', kind: 'earning', calc: 'hours', role: 'overtime', like: 'overtime', multiplier: 1.35, sort: 21, always: true },
  { code: 'OT150', name: 'Overtime 1.5x', kind: 'earning', calc: 'hours', role: 'overtime', like: 'overtime', multiplier: 1.5, sort: 22, always: true },
  { code: 'OT200', name: 'Overtime 2x', kind: 'earning', calc: 'hours', role: 'overtime', like: 'overtime', multiplier: 2, sort: 23, always: true },
  { code: 'OT300', name: 'Overtime 3x', kind: 'earning', calc: 'hours', role: 'overtime', like: 'overtime', multiplier: 3, sort: 24, always: true },
  { code: 'RD200', name: 'Rest day work 2x', kind: 'earning', calc: 'hours', role: 'overtime', like: 'overtime', multiplier: 2, sort: 25, always: true },
  { code: 'SUN200', name: 'Sunday work 2x', kind: 'earning', calc: 'hours', role: 'overtime', like: 'overtime', multiplier: 2, sort: 26, always: true },
  { code: 'PH200', name: 'Holiday work 2x', kind: 'earning', calc: 'hours', role: 'overtime', like: 'overtime', multiplier: 2, sort: 27, always: true },
  { code: 'PH250', name: 'Holiday work 2.5x', kind: 'earning', calc: 'hours', role: 'overtime', like: 'overtime', multiplier: 2.5, sort: 28, always: true },
  { code: 'NIGHT25', name: 'Night premium 0.25x', kind: 'earning', calc: 'hours', role: 'overtime', like: 'overtime', multiplier: 0.25, sort: 29, always: true },
  { code: 'ALLOWANCE', name: 'Allowance', kind: 'earning', calc: 'fixed', role: 'allowance', like: 'allowance', sort: 30 },
  { code: 'BONUS', name: 'Bonus', kind: 'earning', calc: 'input', role: 'bonus', like: 'bonus', sort: 40 },
  { code: 'COMMISSION', name: 'Commission', kind: 'earning', calc: 'input', role: 'commission', like: 'bonus', sort: 41 },
  { code: 'ARREARS', name: 'Back pay', kind: 'earning', calc: 'input', role: 'arrears', like: 'basic', sort: 45, always: true },
  { code: 'UNPAID', name: 'Unpaid leave', kind: 'earning', calc: 'days', role: 'unpaid', like: 'basic', sort: 50, always: true },
  { code: 'LEAVE_ENCASH', name: 'Leave encashment', kind: 'earning', calc: 'days', role: 'encash', like: 'basic', sort: 55, always: true },
  { code: 'NOTICE_PAY', name: 'Pay in lieu of notice', kind: 'earning', calc: 'input', role: 'notice', like: 'basic', sort: 56, always: true },
  { code: 'GRATUITY', name: 'Gratuity', kind: 'earning', calc: 'input', role: 'gratuity', like: 'bonus', sort: 57, always: true },
  { code: 'REIMB', name: 'Expense reimbursement', kind: 'reimbursement', calc: 'input', role: 'reimbursement', like: '', sort: 80, always: true },
  { code: 'ADVANCE', name: 'Advance paid', kind: 'reimbursement', calc: 'input', role: 'advance_payout', like: '', sort: 81, always: true },
  { code: 'ADV_RECOVERY', name: 'Advance recovery', kind: 'deduction', stage: 'post', calc: 'input', role: 'advance', like: '', sort: 90, always: true },
  { code: 'LOAN_REPAY', name: 'Loan repayment', kind: 'deduction', stage: 'post', calc: 'input', role: 'loan', like: '', sort: 91, always: true },
  { code: 'DEDUCTION', name: 'Other deduction', kind: 'deduction', stage: 'post', calc: 'input', role: 'other', like: '', sort: 95, always: true },
  { code: 'NET_ROUNDING', name: 'Rounding', kind: 'deduction', stage: 'post', calc: 'input', role: 'rounding', like: '', sort: 99, always: true },
];

/* ------------------------------------------------------------- access */

/** Throw unless the caller holds `lvl` on payroll for this entity ('' = any of theirs). */
function need(ctx, lvl, entityId, what) {
  const auth = L('lib_auth');
  auth.need(ctx, 'payroll', lvl, what);
  if (entityId && !auth.inScope(ctx, entityId)) throw u().fail(403, 'You cannot work on payroll of this entity.', 'not_permitted');
}

function canPayroll(ctx, lvl, entityId) {
  const auth = L('lib_auth');
  return auth.can(ctx, 'payroll', lvl) && (!entityId || auth.inScope(ctx, entityId));
}

/** Entity ids the caller sees for payroll ([] = all). */
function scopeIds(ctx) {
  return L('lib_auth').scope(ctx);
}

function entityRef(app, ref) {
  return L('lib_org').entityRef(app, ref);
}

/** The entity param, or the only entity the caller has. */
function entityParam(ctx, p, required) {
  const util = u();
  const ref = util.str(p, 'entity', '');
  if (ref !== '') {
    const e = entityRef(ctx.app, ref);
    if (!L('lib_auth').inScope(ctx, e.id)) throw util.fail(403, 'You cannot see this entity.', 'not_permitted');
    return e;
  }
  if (!required) return null;
  const rows = util.findMany(ctx.app, 'entities', 'active = true', 'created').filter((r) => L('lib_auth').inScope(ctx, r.id));
  if (rows.length === 1) return rows[0];
  throw util.fail(400, 'entity is required (' + rows.map((r) => r.getString('name')).join(', ') + ').', 'missing_param', { param: 'entity' });
}

/* -------------------------------------------------------------- packs */

let _packCache = {};

/** A rule_packs row's body as an object, parsed once per runtime per (id, updated). */
function packBody(rec) {
  const key = rec.id + '@' + rec.getString('updated');
  const hit = _packCache[key];
  if (hit !== undefined) return hit;
  const body = u().jsonOf(rec, 'body', null);
  if (Object.keys(_packCache).length > 400) _packCache = {};
  _packCache[key] = body;
  return body;
}

/** For each code: { code, active: [bodies], draft: [bodies], name } from rule_packs. */
function packRows(app, codes) {
  const util = u();
  const out = {};
  if (!codes || codes.length === 0) return out;
  const bind = {};
  const keys = codes.map((c, i) => {
    bind['c' + i] = c;
    return '{:c' + i + '}';
  });
  const rows = util.rows(app, 'SELECT id, code, status, name, version, effective_from FROM rule_packs WHERE code IN (' + keys.join(',') + ') ORDER BY code, effective_from', { id: '', code: '', status: '', name: '', version: '', effective_from: '' }, bind);
  for (const c of codes) out[c] = { code: c, name: c, active: [], draft: [], rows: [] };
  for (const r of rows) {
    const slot = out[r.code];
    slot.name = r.name;
    slot.rows.push({ id: r.id, status: r.status, version: r.version, effective_from: r.effective_from });
    if (r.status === 'active') slot.active.push(packBody(app.findRecordById('rule_packs', r.id)));
    else if (r.status === 'draft' || r.status === 'tested') slot.draft.push(r.id);
  }
  return out;
}

/** The body of a pack code for field definitions: the active version in force on `day`, else the newest active, else the newest draft. */
function latestBody(app, code, day) {
  const util = u();
  if (day) {
    const now = util.findMany(app, 'rule_packs', "code = {:c} && status = 'active' && effective_from <= {:d} && (effective_to = '' || effective_to >= {:d})", '-effective_from', 1, { c: code, d: day });
    if (now.length > 0) return packBody(now[0]);
  }
  const act = util.findMany(app, 'rule_packs', "code = {:c} && status = 'active'", '-effective_from', 1, { c: code });
  if (act.length > 0) return packBody(act[0]);
  const any = util.findMany(app, 'rule_packs', "code = {:c} && status != 'retired'", '-effective_from', 1, { c: code });
  return any.length > 0 ? packBody(any[0]) : null;
}

/** Field definitions of a set of packs: scope 'employee' or 'entity'; the lower order pack wins a shared key. */
function fieldsOf(app, codes, scope, day) {
  const bodies = [];
  const d = day || u().today(app);
  for (const c of codes || []) {
    const b = latestBody(app, c, d);
    if (b !== null) bodies.push(b);
  }
  bodies.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || (a.code < b.code ? -1 : 1));
  const out = [];
  const seen = {};
  for (const b of bodies) {
    for (const f of b.profile_fields || []) {
      const s = f.scope === 'entity' ? 'entity' : 'employee';
      if (s !== scope || seen[f.key]) continue;
      seen[f.key] = true;
      out.push({ pack: b.code, pack_name: b.name || b.code, key: f.key, label: f.label || f.key, type: f.type, options: f.options || [], default: f.default === undefined ? null : f.default, required: f.required === true, help: f.help || '', form: f.form || '', min: f.min === undefined ? null : f.min, max: f.max === undefined ? null : f.max });
    }
  }
  return out;
}

/** Check and coerce field values against definitions (types, options, bounds). Returns the clean object. */
function cleanFields(defs, values, partial) {
  const util = u();
  const byKey = {};
  for (const d of defs) byKey[d.key] = d;
  const out = {};
  for (const k of Object.keys(values || {})) {
    const d = byKey[k];
    if (d === undefined) {
      const near = util.nearest(k, Object.keys(byKey));
      throw util.fail(400, 'Unknown field "' + k + '"' + (near !== '' ? ' (did you mean ' + near + '?)' : '') + '. Fields: ' + Object.keys(byKey).join(', '), 'unknown_field', { field: k });
    }
    let v = values[k];
    if (v === null || v === '' || v === undefined) {
      out[k] = null;
      continue;
    }
    if (d.type === 'number' || d.type === 'money') {
      const n = typeof v === 'number' ? v : Number(String(v).trim());
      if (!Number.isFinite(n)) throw util.fail(400, d.label + ' must be a number.', 'invalid_field', { field: k });
      if (d.min !== null && n < d.min) throw util.fail(400, d.label + ' must be at least ' + d.min + '.', 'invalid_field', { field: k });
      if (d.max !== null && n > d.max) throw util.fail(400, d.label + ' must be at most ' + d.max + '.', 'invalid_field', { field: k });
      v = n;
    } else if (d.type === 'boolean') {
      if (v === true || v === 'true' || v === 1 || v === '1') v = true;
      else if (v === false || v === 'false' || v === 0 || v === '0') v = false;
      else throw util.fail(400, d.label + ' must be true or false.', 'invalid_field', { field: k });
    } else if (d.type === 'enum') {
      v = String(v);
      if (!d.options.some((o) => String(o.value) === v)) throw util.fail(400, d.label + ' must be one of: ' + d.options.map((o) => o.value).join(', '), 'invalid_field', { field: k });
    } else if (d.type === 'date') {
      if (!util.isDay(String(v))) throw util.fail(400, d.label + ' must be a day YYYY-MM-DD.', 'invalid_field', { field: k });
      v = String(v);
    } else v = util.clip(String(v), 400);
    out[k] = v;
  }
  if (!partial) for (const d of defs) if (out[d.key] === undefined) out[d.key] = null;
  return out;
}

/* ------------------------------------------------------------ settings */

function settingsRec(app, entityId) {
  return u().findOne(app, 'payroll_settings', 'entity = {:e}', { e: entityId });
}

/** The entity's payroll settings row, created with country defaults when missing. */
function ensureSettings(app, ent) {
  let rec = settingsRec(app, ent.id);
  if (rec !== null) return rec;
  const util = u();
  const s = L('lib_settings').row(app);
  rec = util.newRecord(app, 'payroll_settings');
  rec.set('entity', ent.id);
  rec.set('proration', COUNTRY_PRORATION[ent.getString('country')] || 'working_days');
  rec.set('net_rounding', 'none');
  rec.set('pay_method', 'bank');
  rec.set('approver_steps', []);
  rec.set('entity_fields', {});
  rec.set('variance_pct', 10);
  rec.set('require_approved_time', false);
  rec.set('require_approved_leave', false);
  rec.set('bank_lead_days', 2);
  rec.set('bank_changed_days', 14);
  rec.set('go_live_day', '');
  rec.set('no_earlier_pay', false);
  rec.set('tax_approval_fields', ['*']);
  rec.set('publish', 'scheduled');
  rec.set('publish_hour', s ? s.getInt('payslip_publish_hour') || 7 : 7);
  rec.set('payslip_show_ytd', true);
  rec.set('payslip_show_leave', true);
  rec.set('email_payslips', true);
  rec.set('warnings_need_ack', true);
  app.save(rec);
  return rec;
}

function settingsView(app, rec, ent) {
  const util = u();
  return {
    id: rec.id,
    entity: ent.id,
    entity_name: ent.getString('name'),
    country: ent.getString('country'),
    currency: ent.getString('currency'),
    proration: rec.getString('proration'),
    net_rounding: rec.getString('net_rounding'),
    pay_method: rec.getString('pay_method'),
    approver_steps: util.jsonOf(rec, 'approver_steps', []) || [],
    entity_fields: util.jsonOf(rec, 'entity_fields', {}) || {},
    variance_pct: rec.getFloat('variance_pct'),
    require_approved_time: rec.getBool('require_approved_time'),
    require_approved_leave: rec.getBool('require_approved_leave'),
    bank_lead_days: rec.getInt('bank_lead_days'),
    bank_changed_days: rec.getInt('bank_changed_days'),
    go_live_day: rec.getString('go_live_day'),
    no_earlier_pay: rec.getBool('no_earlier_pay'),
    tax_approval_fields: util.jsonOf(rec, 'tax_approval_fields', ['*']) || ['*'],
    publish: rec.getString('publish'),
    publish_hour: rec.getInt('publish_hour'),
    payslip_show_ytd: rec.getBool('payslip_show_ytd'),
    payslip_show_leave: rec.getBool('payslip_show_leave'),
    email_payslips: rec.getBool('email_payslips'),
    warnings_need_ack: rec.getBool('warnings_need_ack'),
    note: rec.getString('note'),
  };
}

/** Employer fields the latest calculated run of an entity read with no value (its entity_field_missing warnings). */
function flaggedEntityFields(app, entityId) {
  const util = u();
  const out = {};
  const run = util.findMany(app, 'payruns', "entity = {:e} && status != 'void' && status != 'draft'", '-calculated_at', 1, { e: entityId });
  if (run.length === 0) return out;
  for (const r of util.rows(app, "SELECT issues FROM payslips WHERE payrun = {:r} AND issues LIKE '%entity_field_missing%' LIMIT 50", { issues: '' }, { r: run[0].id })) {
    let list = [];
    try {
      list = JSON.parse(r.issues || '[]') || [];
    } catch (e) {
      list = [];
    }
    for (const i of list) if (i.code === 'entity_field_missing' && i.field) out[i.field] = true;
  }
  return out;
}

/**
 * Payroll has not been told when HR OS starts paying an entity with people:
 * no first pay day in HR OS, no confirmation that nobody was paid earlier this
 * tax year and no regular run locked yet (the setup guide and Payroll home ask).
 */
function startsUnknown(app, ent, settings) {
  const util = u();
  if (settings.go_live_day !== '' || settings.no_earlier_pay) return false;
  if (util.count(app, "SELECT COUNT(*) AS n FROM employments WHERE entity = {:e} AND status != 'ended'", { e: ent.id }) === 0) return false;
  return util.count(app, "SELECT COUNT(*) AS n FROM payruns WHERE entity = {:e} AND kind = 'regular' AND status IN ('locked', 'paid')", { e: ent.id }) === 0;
}

/** payroll.settings: an entity's payroll settings with the entity fields its packs declare. */
function settingsGet(ctx, p) {
  const app = ctx.app;
  const ent = entityParam(ctx, p, true);
  need(ctx, 'view', ent.id);
  const rec = ensureSettings(app, ent);
  const codes = u().jsonOf(ent, 'packs', []) || [];
  const defs = fieldsOf(app, codes, 'entity');
  const v = settingsView(app, rec, ent);
  const flagged = flaggedEntityFields(app, ent.id);
  const unset = (d) => (v.entity_fields[d.key] === undefined || v.entity_fields[d.key] === null || v.entity_fields[d.key] === '') && (d.default === null || d.default === undefined);
  const missing = defs.filter((d) => unset(d) && (d.required || flagged[d.key] === true)).map((d) => d.key);
  return { settings: v, entity_fields: defs, missing_fields: missing, packs: codes, choices: { proration: PRORATION, net_rounding: NET_ROUNDING, pay_method: PAY_METHODS, publish: PUBLISH, step_types: L('lib_approvals').STEP_TYPES } };
}

/** payroll.settings-save: change an entity's payroll settings (and the pay run approval flow). */
function settingsSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const ent = entityParam(ctx, p, true);
  need(ctx, 'full', ent.id, 'change payroll settings');
  const rec = ensureSettings(app, ent);
  const before = settingsView(app, rec, ent);
  if (util.has(p, 'proration')) rec.set('proration', util.oneOf(p, 'proration', PRORATION, before.proration));
  if (util.has(p, 'net_rounding')) rec.set('net_rounding', util.oneOf(p, 'net_rounding', NET_ROUNDING, before.net_rounding));
  if (util.has(p, 'pay_method')) rec.set('pay_method', util.oneOf(p, 'pay_method', PAY_METHODS, before.pay_method));
  if (util.has(p, 'publish')) rec.set('publish', util.oneOf(p, 'publish', PUBLISH, before.publish));
  if (util.has(p, 'publish_hour')) rec.set('publish_hour', util.int(p, 'publish_hour', 7, 0, 23));
  if (util.has(p, 'variance_pct')) rec.set('variance_pct', util.num(p, 'variance_pct', { min: 0, max: 1000 }));
  if (util.has(p, 'bank_lead_days')) rec.set('bank_lead_days', util.int(p, 'bank_lead_days', 2, 0, 30));
  if (util.has(p, 'bank_changed_days')) rec.set('bank_changed_days', util.int(p, 'bank_changed_days', 14, 0, 90));
  if (util.has(p, 'go_live_day')) rec.set('go_live_day', util.day(p, 'go_live_day', ''));
  for (const k of ['require_approved_time', 'require_approved_leave', 'payslip_show_ytd', 'payslip_show_leave', 'email_payslips', 'warnings_need_ack']) if (util.has(p, k)) rec.set(k, util.bool(p, k, false));
  if (util.has(p, 'note')) rec.set('note', util.text(p, 'note', 2000, ''));
  if (util.has(p, 'tax_approval_fields')) {
    const list = (util.list(p, 'tax_approval_fields') || []).map(String);
    rec.set('tax_approval_fields', list);
  }
  if (util.has(p, 'entity_fields')) {
    const defs = fieldsOf(app, util.jsonOf(ent, 'packs', []) || [], 'entity');
    const merged = Object.assign({}, util.jsonOf(rec, 'entity_fields', {}) || {}, cleanFields(defs, util.obj(p, 'entity_fields') || {}, true));
    for (const k of Object.keys(merged)) if (merged[k] === null) delete merged[k];
    rec.set('entity_fields', merged);
  }
  let steps = null;
  if (util.has(p, 'approver_steps')) {
    const raw = util.list(p, 'approver_steps') || [];
    if (raw.length > 6) throw util.fail(400, 'At most 6 approval steps.', 'invalid_param');
    steps = raw.map((s, i) => {
      util.keysOnly(s, ['type', 'role', 'member'], 'step ' + (i + 1));
      if (L('lib_approvals').STEP_TYPES.indexOf(s.type) < 0) throw util.fail(400, 'step ' + (i + 1) + ': type is one of ' + L('lib_approvals').STEP_TYPES.join(', '), 'invalid_param');
      if (s.type === 'role') {
        if (L('lib_auth').roleByCode(app, String(s.role || '')) === null) throw util.fail(400, 'step ' + (i + 1) + ': unknown role ' + s.role, 'invalid_param');
        return { type: 'role', role: String(s.role) };
      }
      if (s.type === 'member') return { type: 'member', member: L('lib_auth').memberRef(app, String(s.member || '')).id };
      return { type: s.type };
    });
    rec.set('approver_steps', steps);
  }
  app.runInTransaction((tx) => {
    tx.save(rec);
    if (steps !== null) {
      // The pay run approval flow of this entity lives in approval_flows (kind payrun).
      let flow = u().findOne(tx, 'approval_flows', "kind = 'payrun' && entity = {:e} && department = ''", { e: ent.id });
      if (steps.length === 0) {
        if (flow !== null) tx.delete(flow);
      } else {
        if (flow === null) {
          flow = u().newRecord(tx, 'approval_flows');
          flow.set('kind', 'payrun');
          flow.set('entity', ent.id);
          flow.set('department', '');
          flow.set('auto', {});
          flow.set('active', true);
        }
        flow.set('steps', steps);
        flow.set('note', 'Set in payroll settings');
        tx.save(flow);
      }
    }
  });
  const after = settingsView(app, rec, ent);
  L('lib_audit').note(ctx, { collection: 'payroll_settings', record: rec.id, summary: 'Changed payroll settings of ' + ent.getString('name'), before: before, after: after });
  return settingsGet(ctx, { entity: ent.id });
}

/** payroll.fields: the pack field definitions of an entity (entity scope) or an employment (employee scope). */
function fieldsOp(ctx, p) {
  const util = u();
  const app = ctx.app;
  const empRef = util.str(p, 'employment', '');
  if (empRef !== '') {
    const m = L('lib_people').employmentRef(app, empRef);
    L('lib_people').needSee(ctx, m);
    const tax = L('lib_people').rowOn(app, 'tax_profiles', m.id, util.day(p, 'as_of', util.today(app, m.getString('entity'))));
    const ent = app.findRecordById('entities', m.getString('entity'));
    const codes = tax !== null && (util.jsonOf(tax, 'packs', []) || []).length > 0 ? util.jsonOf(tax, 'packs', []) : util.jsonOf(ent, 'packs', []) || [];
    return { scope: 'employee', packs: codes, fields: fieldsOf(app, codes, 'employee') };
  }
  const ent = entityParam(ctx, p, true);
  const codes = util.jsonOf(ent, 'packs', []) || [];
  return { scope: util.oneOf(p, 'scope', ['employee', 'entity'], 'entity'), packs: codes, fields: fieldsOf(app, codes, util.oneOf(p, 'scope', ['employee', 'entity'], 'entity')) };
}

/* ------------------------------------------------------- pay schedules */

function scheduleView(app, r) {
  const util = u();
  const ent = util.byId(app, 'entities', r.getString('entity'));
  return {
    id: r.id,
    entity: r.getString('entity'),
    entity_name: ent ? ent.getString('name') : '',
    name: r.getString('name'),
    frequency: r.getString('frequency'),
    period_anchor: r.getString('period_anchor'),
    pay_day_rule: util.jsonOf(r, 'pay_day_rule', {}) || {},
    cutoff_days: r.getInt('cutoff_days'),
    currency: r.getString('currency') || (ent ? ent.getString('currency') : ''),
    active: r.getBool('active'),
    reminder_days: util.jsonOf(r, 'reminder_days', [3, 1, 0]) || [],
    note: r.getString('note'),
    is_default: ent ? ent.getString('default_pay_schedule') === r.id : false,
    people: countOnSchedule(app, r),
  };
}

/** People whose pay record (as of today) names this schedule, or the entity default when it names none. */
function countOnSchedule(app, r) {
  const util = u();
  const ent = util.byId(app, 'entities', r.getString('entity'));
  if (ent === null) return 0;
  const today = util.today(app, ent.id);
  const isDefault = ent.getString('default_pay_schedule') === r.id;
  const rows = util.rows(
    app,
    "SELECT m.id AS id, COALESCE((SELECT p.pay_schedule FROM pay_records p WHERE p.employment = m.id AND p.effective_from <= {:d} ORDER BY p.effective_from DESC LIMIT 1), '') AS sch FROM employments m WHERE m.entity = {:e} AND (m.end_day = '' OR m.end_day >= {:d})",
    { id: '', sch: '' },
    { e: ent.id, d: today },
  );
  return rows.filter((x) => x.sch === r.id || (x.sch === '' && isDefault)).length;
}

function readPayDayRule(p, freq, current) {
  const util = u();
  const raw = util.obj(p, 'pay_day_rule');
  if (raw === undefined) return current;
  util.keysOnly(raw, ['kind', 'day', 'offset_days', 'adjust'], 'pay_day_rule');
  const kind = String(raw.kind || 'period_end');
  if (['period_end', 'day_of_month', 'after_end'].indexOf(kind) < 0) throw util.fail(400, 'pay_day_rule.kind is period_end, day_of_month or after_end.', 'invalid_param');
  if (kind === 'day_of_month' && freq !== 'monthly') throw util.fail(400, 'A day of the month pay day needs a monthly schedule.', 'invalid_param');
  const out = { kind: kind, adjust: ['before', 'after', 'none'].indexOf(String(raw.adjust || 'before')) >= 0 ? String(raw.adjust || 'before') : 'before' };
  if (kind === 'day_of_month') {
    const d = Number(raw.day);
    if (!Number.isInteger(d) || d < 1 || d > 31) throw util.fail(400, 'pay_day_rule.day is 1 to 31.', 'invalid_param');
    out.day = d;
  }
  if (kind === 'after_end' || kind === 'period_end') {
    const o = Number(raw.offset_days || 0);
    if (!Number.isInteger(o) || o < 0 || o > 45) throw util.fail(400, 'pay_day_rule.offset_days is 0 to 45.', 'invalid_param');
    out.offset_days = o;
  }
  return out;
}

function schedulesList(ctx, p) {
  const util = u();
  need(ctx, 'view');
  const ent = entityParam(ctx, p, false);
  const rows = util.findMany(ctx.app, 'pay_schedules', ent ? 'entity = {:e}' : '1=1', 'name', 0, { e: ent ? ent.id : '' }).filter((r) => L('lib_auth').inScope(ctx, r.getString('entity')));
  const all = util.bool(p, 'all', false);
  return { schedules: rows.filter((r) => all || r.getBool('active')).map((r) => Object.assign(scheduleView(ctx.app, r), { next: nextPeriod(ctx.app, r) })) };
}

function schedulesSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const id = util.str(p, 'schedule', '');
  let rec;
  let ent;
  if (id !== '') {
    rec = util.byId(app, 'pay_schedules', id);
    if (rec === null) throw util.fail(404, 'No pay schedule ' + id + '. Run pay-schedules.list.', 'not_found');
    ent = app.findRecordById('entities', rec.getString('entity'));
  } else {
    ent = entityParam(ctx, p, true);
    rec = util.newRecord(app, 'pay_schedules');
    rec.set('entity', ent.id);
    rec.set('active', true);
    rec.set('reminders', {});
  }
  need(ctx, 'full', ent.id, 'change pay schedules');
  const before = id !== '' ? scheduleView(app, rec) : null;
  if (id !== '' && (util.has(p, 'frequency') || util.has(p, 'period_anchor'))) {
    const used = util.count(app, "SELECT COUNT(*) AS n FROM payruns WHERE schedule = {:s} AND status != 'void'", { s: rec.id });
    if (used > 0 && ((util.has(p, 'frequency') && util.str(p, 'frequency', '') !== rec.getString('frequency')) || (util.has(p, 'period_anchor') && util.str(p, 'period_anchor', '') !== rec.getString('period_anchor')))) throw util.fail(409, 'This schedule has pay runs; its frequency and periods cannot change. Make a new schedule and move people to it.', 'in_use');
  }
  if (id === '' || util.has(p, 'name')) {
    const n = util.squash(util.text(p, 'name', 120, ''));
    if (n === '') throw util.fail(400, 'name is required, e.g. --name "Monthly"', 'missing_param', { param: 'name' });
    rec.set('name', n);
  }
  const freq = util.has(p, 'frequency') || id === '' ? util.oneOf(p, 'frequency', FREQUENCIES, 'monthly') : rec.getString('frequency');
  rec.set('frequency', freq);
  if (id === '' || util.has(p, 'period_anchor')) {
    const today = util.today(app, ent.id);
    let anchor = util.day(p, 'period_anchor', '');
    if (anchor === '') anchor = freq === 'monthly' || freq === 'semi_monthly' ? today.slice(0, 8) + '01' : mondayOf(today);
    if (freq === 'semi_monthly' && anchor.slice(8) !== '01') throw util.fail(400, 'A semi-monthly schedule runs from the 1st and the 16th: period_anchor must be a 1st.', 'invalid_param');
    if (freq === 'monthly' && Number(anchor.slice(8)) > 28) throw util.fail(400, 'A monthly period starts on day 1 to 28.', 'invalid_param');
    rec.set('period_anchor', anchor);
  }
  const rule = readPayDayRule(p, freq, util.jsonOf(rec, 'pay_day_rule', null) || COUNTRY_PAY_DAY[ent.getString('country')] || { kind: 'period_end', offset_days: 0, adjust: 'before' });
  if (rule.kind === 'day_of_month' && freq !== 'monthly') throw util.fail(400, 'A day of the month pay day needs a monthly schedule.', 'invalid_param');
  rec.set('pay_day_rule', rule);
  if (util.has(p, 'cutoff_days') || id === '') rec.set('cutoff_days', util.int(p, 'cutoff_days', 5, 0, 60));
  if (util.has(p, 'reminder_days') || id === '') {
    const list = util.has(p, 'reminder_days') ? (util.list(p, 'reminder_days') || []).map(Number) : [3, 1, 0];
    for (const d of list) if (!Number.isInteger(d) || d < 0 || d > 30) throw util.fail(400, 'reminder_days are whole days 0 to 30.', 'invalid_param');
    rec.set('reminder_days', list);
  }
  rec.set('currency', ent.getString('currency'));
  if (util.has(p, 'active')) rec.set('active', util.bool(p, 'active', true));
  if (util.has(p, 'note')) rec.set('note', util.text(p, 'note', 1000, ''));
  app.runInTransaction((tx) => {
    tx.save(rec);
    const e2 = tx.findRecordById('entities', ent.id);
    if (util.bool(p, 'default', false) || e2.getString('default_pay_schedule') === '') {
      e2.set('default_pay_schedule', rec.id);
      tx.save(e2);
    }
  });
  const after = scheduleView(app, app.findRecordById('pay_schedules', rec.id));
  L('lib_audit').note(ctx, { collection: 'pay_schedules', record: rec.id, summary: (id === '' ? 'Added' : 'Changed') + ' the pay schedule ' + after.name + ' of ' + ent.getString('name'), before: before, after: after });
  return { schedule: Object.assign(after, { next: nextPeriod(app, app.findRecordById('pay_schedules', rec.id)) }) };
}

function mondayOf(d) {
  const wd = u().weekday(d);
  return u().dayAdd(d, wd === 0 ? -6 : 1 - wd);
}

/* --------------------------------------------------------- the calendar */

/** The period of a schedule that contains `day`: { start, end }. */
function periodContaining(sched, day) {
  const util = u();
  const freq = sched.frequency;
  const anchor = sched.period_anchor;
  if (freq === 'semi_monthly') {
    const d = Number(day.slice(8));
    return d <= 15 ? { start: day.slice(0, 8) + '01', end: day.slice(0, 8) + '15' } : { start: day.slice(0, 8) + '16', end: util.monthEnd(day) };
  }
  if (freq === 'monthly') {
    const ad = Number(anchor.slice(8));
    let start = day.slice(0, 8) + util.pad(ad);
    if (start > day) start = util.addMonths(start, -1);
    const end = util.dayAdd(util.addMonths(start, 1), -1);
    return { start: start, end: end };
  }
  const len = freq === 'biweekly' ? 14 : 7;
  const diff = util.daysBetween(anchor, day);
  const k = Math.floor(diff / len);
  const start = util.dayAdd(anchor, k * len);
  return { start: start, end: util.dayAdd(start, len - 1) };
}

function nextPeriodAfter(sched, period) {
  return periodContaining(sched, u().dayAdd(period.end, 1));
}

/** Week rows of the entity's default work schedule (days with no rows are weekly days off). */
function entityWeek(app, ent) {
  const util = u();
  const r = util.byId(app, 'work_schedules', ent.getString('default_schedule'));
  return r ? util.jsonOf(r, 'week', []) || [] : [];
}

function isWorkDay(app, ent, week, day, holCache) {
  const util = u();
  const wd = util.weekday(day);
  const works = week.length === 0 ? wd !== 0 && wd !== 6 : week.some((r) => Number(r.dow) === wd);
  if (!works) return { ok: false, why: 'weekend' };
  const cal = ent.getString('default_calendar');
  if (cal !== '') {
    const key = cal + day;
    if (holCache[key] === undefined) holCache[key] = L('lib_calendar').isHoliday(app, cal, day);
    const h = holCache[key];
    if (h !== null && !h.half) return { ok: false, why: h.name };
  }
  return { ok: true, why: '' };
}

/** The pay date of a period by the schedule's rule, moved off days off: { pay_date, planned, moved, reason }. */
function payDateOf(app, ent, sched, period, holCache) {
  const util = u();
  const rule = sched.pay_day_rule || { kind: 'period_end' };
  let planned = period.end;
  if (rule.kind === 'day_of_month' && sched.frequency === 'monthly') {
    const last = Number(util.monthEnd(period.end).slice(8));
    planned = period.end.slice(0, 8) + util.pad(Math.min(Number(rule.day) || 25, last));
  } else if (rule.kind === 'after_end' || rule.kind === 'period_end') planned = util.dayAdd(period.end, Number(rule.offset_days) || 0);
  const week = entityWeek(app, ent);
  const adjust = rule.adjust || 'before';
  let d = planned;
  let reason = '';
  if (adjust !== 'none') {
    for (let i = 0; i < 14; i++) {
      const w = isWorkDay(app, ent, week, d, holCache);
      if (w.ok) break;
      if (reason === '') reason = w.why;
      d = util.dayAdd(d, adjust === 'after' ? 1 : -1);
    }
  }
  return { pay_date: d, planned: planned, moved: d !== planned, reason: d !== planned ? reason : '' };
}

function schedObj(r) {
  const util = u();
  return { id: r.id, entity: r.getString('entity'), frequency: r.getString('frequency'), period_anchor: r.getString('period_anchor'), pay_day_rule: util.jsonOf(r, 'pay_day_rule', {}) || {}, cutoff_days: r.getInt('cutoff_days'), name: r.getString('name') };
}

/** A period with its pay date and input cutoff. */
function periodInfo(app, ent, schedRec, period, holCache) {
  const util = u();
  const s = schedObj(schedRec);
  const pd = payDateOf(app, ent, s, period, holCache || {});
  return { period_start: period.start, period_end: period.end, pay_date: pd.pay_date, planned_pay_date: pd.planned, pay_date_moved: pd.moved, moved_because: pd.reason, cutoff_day: util.dayAdd(pd.pay_date, -s.cutoff_days) };
}

/** Periods per year: 12, 24, 26 or 52, or 27 and 53 in a calendar year with that many pay dates. */
function periodsPerYear(app, ent, schedRec, payDate) {
  const s = schedObj(schedRec);
  const base = PER_YEAR[s.frequency] || 12;
  if (s.frequency !== 'biweekly' && s.frequency !== 'weekly') return base;
  const year = payDate.slice(0, 4);
  let per = periodContaining(s, year + '-01-01');
  let n = 0;
  const hol = {};
  per = periodContaining(s, u().dayAdd(year + '-01-01', -20));
  for (let i = 0; i < 60; i++) {
    const pd = payDateOf(app, ent, s, per, hol).pay_date;
    if (pd.slice(0, 4) === year) n++;
    if (pd.slice(0, 4) > year) break;
    per = nextPeriodAfter(s, per);
  }
  return n > base ? n : base;
}

/** The next period that has no locked or paid regular run, with its run when one is open. */
function nextPeriod(app, schedRec) {
  const util = u();
  const ent = app.findRecordById('entities', schedRec.getString('entity'));
  const s = schedObj(schedRec);
  const last = util.one(app, "SELECT period_start, period_end, status, id FROM payruns WHERE schedule = {:s} AND kind = 'regular' AND status != 'void' ORDER BY period_start DESC LIMIT 1", { period_start: '', period_end: '', status: '', id: '' }, { s: schedRec.id });
  let period;
  let run = null;
  if (last === null) period = periodContaining(s, util.today(app, ent.id));
  else if (last.status === 'locked' || last.status === 'paid') period = nextPeriodAfter(s, { start: last.period_start, end: last.period_end });
  else {
    period = { start: last.period_start, end: last.period_end };
    run = app.findRecordById('payruns', last.id);
  }
  const info = periodInfo(app, ent, schedRec, period, {});
  const today = util.today(app, ent.id);
  return Object.assign(info, { days_to_pay: util.daysBetween(today, info.pay_date), days_to_cutoff: util.daysBetween(today, info.cutoff_day), run: run === null ? null : { id: run.id, number: run.getString('number'), status: run.getString('status') } });
}

/** pay-schedules.calendar: the periods of a schedule in a year, with pay dates, cutoffs and runs. */
function calendarOp(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rec = util.byId(app, 'pay_schedules', util.req(p, 'schedule'));
  if (rec === null) throw util.fail(404, 'No pay schedule. Run pay-schedules.list.', 'not_found');
  need(ctx, 'view', rec.getString('entity'));
  const ent = app.findRecordById('entities', rec.getString('entity'));
  const year = util.str(p, 'year', '') || util.today(app, ent.id).slice(0, 4);
  if (!/^\d{4}$/.test(year)) throw util.fail(400, 'year is four digits, e.g. 2026', 'invalid_param');
  const s = schedObj(rec);
  const runs = {};
  for (const r of util.findMany(app, 'payruns', "schedule = {:s} && kind = 'regular' && status != 'void'", 'period_start', 0, { s: rec.id })) runs[r.getString('period_start')] = { id: r.id, number: r.getString('number'), status: r.getString('status'), net_minor: r.getInt('net_minor') };
  const out = [];
  const hol = {};
  let per = periodContaining(s, year + '-01-01');
  for (let i = 0; i < 60 && per.start.slice(0, 4) <= year; i++) {
    const info = periodInfo(app, ent, rec, per, hol);
    if (info.pay_date.slice(0, 4) === year || per.start.slice(0, 4) === year) out.push(Object.assign(info, { run: runs[per.start] || null }));
    per = nextPeriodAfter(s, per);
  }
  return { schedule: scheduleView(app, rec), year: year, periods: out, today: util.today(app, ent.id) };
}

/* ---------------------------------------------------------- components */

function componentView(app, r) {
  const util = u();
  return {
    id: r.id,
    code: r.getString('code'),
    name: r.getString('name'),
    entity: r.getString('entity'),
    country: r.getString('country'),
    kind: r.getString('kind'),
    stage: r.getString('stage'),
    calc: r.getString('calc'),
    amount_minor: r.getInt('amount_minor'),
    percent: r.getFloat('percent'),
    base: r.getString('base'),
    formula: r.getString('formula'),
    multiplier: r.getFloat('multiplier'),
    tags: util.jsonOf(r, 'tags', []) || [],
    taxable: r.getBool('taxable'),
    recurring: r.getBool('recurring'),
    prorate: r.getBool('prorate'),
    gl_account: r.getString('gl_account'),
    liability_account: r.getString('liability_account'),
    payslip_group: r.getString('payslip_group'),
    sort: r.getInt('sort'),
    role: r.getString('role'),
    pack: r.getString('pack'),
    source: r.getString('source'),
    archived: r.getBool('archived'),
    note: r.getString('note'),
  };
}

/** The component of an entity by code (the entity's own first, then a company-wide one), or null. */
function componentByCode(app, entityId, code) {
  const util = u();
  return util.findOne(app, 'pay_components', 'entity = {:e} && code = {:c}', { e: entityId, c: code }) || util.findOne(app, 'pay_components', "entity = '' && code = {:c}", { c: code });
}

/** The entity's (not archived) component with a role, lowest sort first, or null. */
function componentByRole(app, entityId, role) {
  const util = u();
  const r = util.findMany(app, 'pay_components', 'entity = {:e} && role = {:r} && archived = false', 'sort,code', 1, { e: entityId, r: role });
  if (r.length > 0) return r[0];
  const g = util.findMany(app, 'pay_components', "entity = '' && role = {:r} && archived = false", 'sort,code', 1, { r: role });
  return g.length > 0 ? g[0] : null;
}

function componentRef(app, entityId, ref) {
  const util = u();
  const r = String(ref || '').trim();
  if (r === '') throw util.fail(400, 'Give the component code or id.', 'missing_param', { param: 'component' });
  const byId = util.byId(app, 'pay_components', r);
  if (byId !== null) return byId;
  const rec = componentByCode(app, entityId, r.toUpperCase());
  if (rec === null) throw util.fail(404, 'No pay component ' + r + '. Run components.list.', 'not_found', { ref: r });
  return rec;
}

/**
 * Seed an entity's components: every seed component of its packs (newest
 * version of each code) with the pack's tags, then the basic set for the
 * roles the packs leave out (tags copied from the pack component of the
 * same role). Existing codes are kept. Returns the number added.
 */
function seedComponents(app, ent) {
  const util = u();
  const codes = util.jsonOf(ent, 'packs', []) || [];
  const bodies = [];
  for (const c of codes) {
    const b = latestBody(app, c);
    if (b !== null) bodies.push(b);
  }
  bodies.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || (a.code < b.code ? -1 : 1));
  const have = {};
  for (const r of util.findMany(app, 'pay_components', 'entity = {:e}', '', 0, { e: ent.id })) have[r.getString('code')] = r;
  const roleTags = {};
  const roleHave = {};
  let added = 0;
  const add = (o) => {
    if (have[o.code]) {
      const role = have[o.code].getString('role');
      if (role !== '' && roleTags[role] === undefined) roleTags[role] = util.jsonOf(have[o.code], 'tags', []) || [];
      if (role !== '') roleHave[role] = true;
      return;
    }
    const r = util.newRecord(app, 'pay_components');
    r.set('code', o.code);
    r.set('name', util.clip(o.name || o.code, 120));
    r.set('entity', ent.id);
    r.set('country', ent.getString('country'));
    r.set('kind', o.kind);
    r.set('stage', o.kind === 'deduction' ? o.stage || 'post' : '');
    r.set('calc', CALCS.indexOf(o.calc) >= 0 ? o.calc : 'input');
    r.set('amount_minor', 0);
    r.set('percent', 0);
    r.set('base', o.base || '');
    r.set('formula', '');
    r.set('multiplier', o.multiplier || 0);
    r.set('tags', o.tags || []);
    r.set('taxable', (o.tags || []).length > 0);
    r.set('recurring', o.calc === 'fixed' || o.calc === 'percent');
    r.set('prorate', o.prorate === true || o.role === 'basic' || o.role === 'allowance');
    r.set('payslip_group', '');
    r.set('sort', Number(o.sort) || 50);
    r.set('role', o.role || 'other');
    r.set('pack', o.pack || '');
    r.set('source', o.pack ? 'pack' : 'builtin');
    r.set('archived', false);
    app.save(r);
    have[o.code] = r;
    if (o.role && roleTags[o.role] === undefined) roleTags[o.role] = o.tags || [];
    if (o.role) roleHave[o.role] = true;
    added++;
  };
  for (const b of bodies) {
    for (const sc of b.seed_components || []) {
      if (!sc || typeof sc.code !== 'string' || sc.code === 'LEAVE_EXIT') continue;
      if (KINDS.indexOf(sc.kind) < 0) continue;
      add({ code: sc.code, name: sc.name, kind: sc.kind, stage: sc.stage, calc: sc.calc, tags: Array.isArray(sc.tags) ? sc.tags : [], sort: sc.sort, role: SEED_ROLE[sc.code] || 'other', pack: b.code });
    }
  }
  for (const c of BASIC_SET) {
    if (!c.always && roleHave[c.role]) continue;
    const tags = c.like ? roleTags[c.like] || roleTags.basic || [] : [];
    add({ code: c.code, name: c.name, kind: c.kind, stage: c.stage, calc: c.calc, tags: tags.slice(), sort: c.sort, role: c.role, multiplier: c.multiplier, prorate: c.prorate });
  }
  if (syncExitComponent(app, ent, '')) added++;
  return added;
}

/**
 * LEAVE_EXIT's tags come from the packs (QA2 N-1): exit_leave_payout and
 * termination, plus the tags of the LEAVE_EXIT seed entry of every pack the
 * entity has enabled (the version in force on `day`, else the latest), so a
 * pack decides how unused leave paid on leaving is treated. Creates the
 * component when it is missing; writes the tags when they differ. Called when
 * components are seeded and when a run is calculated, so a pack switched on,
 * off or updated takes effect on the next calculation.
 */
function syncExitComponent(app, ent, day) {
  const util = u();
  const tags = EXIT_TAGS.slice();
  let name = 'Unused leave paid on leaving';
  let pack = '';
  for (const code of util.jsonOf(ent, 'packs', []) || []) {
    const b = latestBody(app, code, day || '');
    for (const sc of (b && b.seed_components) || []) {
      if (!sc || sc.code !== 'LEAVE_EXIT') continue;
      for (const t of Array.isArray(sc.tags) ? sc.tags : []) if (tags.indexOf(t) < 0) tags.push(t);
      if (sc.name) name = String(sc.name);
      if (pack === '') pack = code;
    }
  }
  let r = util.findOne(app, 'pay_components', "entity = {:e} && code = 'LEAVE_EXIT'", { e: ent.id });
  if (r === null) {
    r = util.newRecord(app, 'pay_components');
    r.set('code', 'LEAVE_EXIT');
    r.set('name', name);
    r.set('entity', ent.id);
    r.set('country', ent.getString('country'));
    r.set('kind', 'earning');
    r.set('stage', '');
    r.set('calc', 'days');
    r.set('amount_minor', 0);
    r.set('percent', 0);
    r.set('base', '');
    r.set('formula', '');
    r.set('multiplier', 0);
    r.set('taxable', true);
    r.set('recurring', false);
    r.set('prorate', false);
    r.set('payslip_group', '');
    r.set('sort', 56);
    r.set('role', 'exit_leave');
    r.set('archived', false);
  } else {
    const now = util.jsonOf(r, 'tags', []) || [];
    if (now.length === tags.length && tags.every((t) => now.indexOf(t) >= 0) && r.getString('pack') === pack) return false;
  }
  r.set('tags', tags);
  r.set('pack', pack);
  r.set('source', pack !== '' ? 'pack' : 'builtin');
  app.save(r);
  return true;
}

function componentsList(ctx, p) {
  const util = u();
  need(ctx, 'view');
  const ent = entityParam(ctx, p, false);
  const archived = util.bool(p, 'archived', false);
  const where = [ent ? "(entity = {:e} || entity = '')" : '1=1'];
  if (!archived) where.push('archived = false');
  const kind = util.str(p, 'kind', '');
  if (kind !== '') {
    where.push('kind = {:k}');
  }
  const rows = util.findMany(ctx.app, 'pay_components', where.join(' && '), 'sort,code', 0, { e: ent ? ent.id : '', k: kind }).filter((r) => r.getString('entity') === '' || L('lib_auth').inScope(ctx, r.getString('entity')));
  return { components: rows.map((r) => componentView(ctx.app, r)), choices: { kind: KINDS, stage: STAGES, calc: CALCS, role: ROLES } };
}

function componentsSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const id = util.str(p, 'component', '');
  let rec;
  let entId;
  if (id !== '') {
    rec = util.byId(app, 'pay_components', id);
    if (rec === null) throw util.fail(404, 'No pay component ' + id + '.', 'not_found');
    entId = rec.getString('entity');
  } else {
    const ent = entityParam(ctx, p, true);
    entId = ent.id;
    rec = util.newRecord(app, 'pay_components');
    rec.set('entity', ent.id);
    rec.set('country', ent.getString('country'));
    rec.set('source', ctx.isAgent ? 'agent' : 'person');
    rec.set('archived', false);
  }
  need(ctx, 'full', entId, 'change pay components');
  const before = id !== '' ? componentView(app, rec) : null;
  if (id === '' || util.has(p, 'code')) {
    const code = util.str(p, 'code', '').toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{0,39}$/.test(code)) throw util.fail(400, 'code is capitals, digits and _ (starting with a letter), e.g. MEAL_ALLOWANCE.', 'invalid_param', { param: 'code' });
    if (id !== '' && code !== rec.getString('code') && util.count(app, 'SELECT COUNT(*) AS n FROM payslip_lines WHERE component = {:c}', { c: rec.id }) > 0) throw util.fail(409, 'This component is on payslips; its code cannot change. Archive it and add a new one.', 'in_use');
    const dup = util.findOne(app, 'pay_components', 'entity = {:e} && code = {:c} && id != {:x}', { e: entId, c: code, x: rec.id || '' });
    if (dup !== null) throw util.fail(409, 'There is already a component ' + code + '.', 'duplicate');
    rec.set('code', code);
  }
  if (id === '' || util.has(p, 'name')) {
    const n = util.squash(util.text(p, 'name', 120, ''));
    if (n === '') throw util.fail(400, 'name is required', 'missing_param', { param: 'name' });
    rec.set('name', n);
  }
  if (id === '' || util.has(p, 'kind')) rec.set('kind', util.oneOf(p, 'kind', KINDS, rec.getString('kind') || 'earning'));
  if (rec.getString('kind') === 'deduction') rec.set('stage', util.oneOf(p, 'stage', STAGES, rec.getString('stage') || 'post'));
  else rec.set('stage', '');
  if (id === '' || util.has(p, 'calc')) rec.set('calc', util.oneOf(p, 'calc', CALCS, rec.getString('calc') || 'input'));
  const cur = app.findRecordById('entities', entId).getString('currency');
  if (util.has(p, 'amount')) rec.set('amount_minor', util.money(p, 'amount', cur, { allowNegative: false }) || 0);
  if (util.has(p, 'percent')) rec.set('percent', util.num(p, 'percent', { min: -1000, max: 1000 }) || 0);
  if (util.has(p, 'base')) {
    const b = util.str(p, 'base', '');
    if (b !== '' && b !== 'basic' && b !== 'gross' && !/^tag:[a-z0-9_]+$/.test(b)) throw util.fail(400, 'base is basic, gross or tag:<tag>, e.g. tag:us_fit_wages', 'invalid_param', { param: 'base' });
    rec.set('base', b);
  }
  if (util.has(p, 'formula')) {
    const f = util.text(p, 'formula', 2000, '');
    if (f !== '') {
      try {
        L('lib_expr').compile(f);
      } catch (err) {
        throw util.fail(400, 'formula does not parse: ' + err.message, 'invalid_param', { param: 'formula' });
      }
    }
    rec.set('formula', f);
  }
  if (util.has(p, 'multiplier')) rec.set('multiplier', util.num(p, 'multiplier', { min: 0, max: 100 }) || 0);
  if (util.has(p, 'tags')) {
    const tags = (util.list(p, 'tags') || []).map(String);
    for (const t of tags) if (!/^[a-z0-9_]{1,60}$/.test(t)) throw util.fail(400, 'tags are lower case words with _ (the pack tags, e.g. us_fit_wages).', 'invalid_param', { param: 'tags' });
    rec.set('tags', tags);
  } else if (id === '') rec.set('tags', []);
  for (const k of ['taxable', 'recurring', 'prorate', 'archived']) if (util.has(p, k)) rec.set(k, util.bool(p, k, false));
  if (util.has(p, 'role')) rec.set('role', util.oneOf(p, 'role', ROLES, 'other'));
  else if (id === '') rec.set('role', 'other');
  for (const k of ['gl_account', 'liability_account', 'payslip_group']) if (util.has(p, k)) rec.set(k, util.text(p, k, 60, ''));
  if (util.has(p, 'sort')) rec.set('sort', util.int(p, 'sort', 50, 0, 10000));
  else if (id === '') rec.set('sort', 60);
  if (util.has(p, 'note')) rec.set('note', util.text(p, 'note', 1000, ''));
  app.save(rec);
  const after = componentView(app, rec);
  L('lib_audit').note(ctx, { collection: 'pay_components', record: rec.id, summary: (id === '' ? 'Added' : 'Changed') + ' the pay component ' + after.code, before: before, after: after });
  return { component: after };
}

function componentsSeed(ctx, p) {
  const ent = entityParam(ctx, p, true);
  need(ctx, 'full', ent.id, 'add pay components');
  let n = 0;
  ctx.app.runInTransaction((tx) => {
    n = seedComponents(tx, tx.findRecordById('entities', ent.id));
  });
  L('lib_audit').note(ctx, { collection: 'pay_components', summary: 'Added ' + n + ' default pay components to ' + ent.getString('name') });
  return { added: n, components: componentsList(ctx, { entity: ent.id }).components };
}

/* ------------------------------------------------ contracts and events */

function recentPayslips(app, employmentId, n) {
  const util = u();
  return util
    .rows(
      app,
      "SELECT s.id AS id, s.period_start AS period_start, s.period_end AS period_end, s.pay_date AS pay_date, s.net_minor AS net_minor, s.currency AS currency, s.status AS status FROM payslips s JOIN payruns r ON r.id = s.payrun WHERE s.employment = {:e} AND s.status IN ('locked', 'published') AND r.status IN ('locked', 'paid') ORDER BY s.pay_date DESC, s.created DESC LIMIT {:n}",
      { id: '', period_start: '', period_end: '', pay_date: '', net_minor: 0, currency: '', status: '' },
      { e: employmentId, n: Math.max(1, Math.min(100, Number(n) || 3)) },
    )
    .map((r) => ({ id: r.id, period_start: r.period_start, period_end: r.period_end, pay_date: r.pay_date, net_minor: r.net_minor, currency: r.currency, status: r.status }));
}

function compensationOf(app, employmentId, day) {
  const util = u();
  const m = util.byId(app, 'employments', employmentId);
  if (m === null) return null;
  const d = day || util.today(app, m.getString('entity'));
  const rec = L('lib_people').rowOn(app, 'pay_records', employmentId, d);
  if (rec === null) return null;
  const ent = app.findRecordById('entities', m.getString('entity'));
  return { basis: rec.getString('basis'), amount_minor: rec.getInt('amount_minor'), currency: rec.getString('currency') || ent.getString('currency'), period: rec.getString('per'), pay_schedule: rec.getString('pay_schedule') || ent.getString('default_pay_schedule') };
}

/** The schedule an employment is paid on, on `day` (its pay record's, else the entity default). */
function scheduleOfEmployment(app, employmentId, day) {
  const c = compensationOf(app, employmentId, day);
  if (c !== null && c.pay_schedule) return c.pay_schedule;
  const m = u().byId(app, 'employments', employmentId);
  return m ? app.findRecordById('entities', m.getString('entity')).getString('default_pay_schedule') : '';
}

/** entity.created: payroll settings, the default monthly schedule and the components. */
function onEntityCreated(ctx, payload) {
  const util = u();
  const app = ctx.app;
  const run = (tx) => {
    const ent = tx.findRecordById('entities', payload.entity);
    ensureSettings(tx, ent);
    if (ent.getString('default_pay_schedule') === '' && util.count(tx, 'SELECT COUNT(*) AS n FROM pay_schedules WHERE entity = {:e}', { e: ent.id }) === 0) {
      const s = util.newRecord(tx, 'pay_schedules');
      s.set('entity', ent.id);
      s.set('name', 'Monthly');
      s.set('frequency', 'monthly');
      s.set('period_anchor', util.today(tx, ent.id).slice(0, 8) + '01');
      s.set('pay_day_rule', COUNTRY_PAY_DAY[ent.getString('country')] || { kind: 'period_end', offset_days: 0, adjust: 'before' });
      s.set('cutoff_days', 5);
      s.set('currency', ent.getString('currency'));
      s.set('active', true);
      s.set('reminder_days', [3, 1, 0]);
      s.set('reminders', {});
      tx.save(s);
      ent.set('default_pay_schedule', s.id);
      tx.save(ent);
    }
    seedComponents(tx, tx.findRecordById('entities', ent.id));
  };
  if (app.isTransactional()) run(app);
  else app.runInTransaction((tx) => run(tx));
  return { ok: true };
}

/** separation.approved: a draft termination run for the final pay (nothing official changes). */
function onSeparation(ctx, payload) {
  return L('lib_payroll_runs').draftTermination(ctx, payload.employment, payload.last_day, payload.separation || '');
}

/** separation.changed: the final pay run not locked yet follows the new last day. */
function onSeparationChanged(ctx, payload) {
  return L('lib_payroll_runs').moveTermination(ctx, payload.employment, payload.last_day, payload.separation || '');
}

/** record.editing: refuse an in-place Edit of a job, pay or tax record a locked pay run used. */
function onRecordEditing(ctx, payload) {
  const util = u();
  const app = ctx.app;
  if (['pay_records', 'job_records', 'tax_profiles'].indexOf(payload.collection) < 0) return null;
  const next = util.findMany(app, payload.collection, 'employment = {:e} && effective_from > {:d}', 'effective_from', 1, { e: payload.employment, d: payload.effective_from });
  const until = next.length > 0 ? util.dayAdd(next[0].getString('effective_from'), -1) : '9999-12-31';
  const used = util.one(
    app,
    "SELECT r.number AS number, s.period_start AS period_start, s.period_end AS period_end FROM payslips s JOIN payruns r ON r.id = s.payrun WHERE s.employment = {:e} AND s.status IN ('locked', 'published') AND s.period_end >= {:f} AND s.period_start <= {:t} ORDER BY s.period_start LIMIT 1",
    { number: '', period_start: '', period_end: '' },
    { e: payload.employment, f: payload.effective_from, t: until },
  );
  if (used === null) return null;
  return { block: 'The locked pay run ' + used.number + ' (' + used.period_start + ' to ' + used.period_end + ') used this record.' };
}

/** employment.changed (pay): a back-dated pay change into a locked period asks payroll for back pay. */
function onEmploymentChanged(ctx, payload) {
  if (!payload || payload.kind !== 'pay') return null;
  return L('lib_payroll_items').suggestBackpay(ctx, payload.employment, payload.effective_from);
}

/** Facts for the profile and Home: next pay day, last net pay (when the viewer may see pay). */
function profileFacts(ctx, employmentId) {
  const util = u();
  const app = ctx.app;
  const m = util.byId(app, 'employments', employmentId);
  if (m === null) return [];
  const facts = [];
  const schId = scheduleOfEmployment(app, employmentId, util.today(app, m.getString('entity')));
  const sch = util.byId(app, 'pay_schedules', schId);
  if (sch !== null) {
    const n = nextPeriod(app, sch);
    facts.push({ key: 'next_pay_day', label: 'Next pay day', value: n.pay_date, kind: 'date', link: '' });
  }
  if (L('lib_people').canSeePay(ctx, m)) {
    const last = recentPayslips(app, employmentId, 1)[0];
    if (last) facts.push({ key: 'last_net', label: 'Last net pay', value: last.net_minor, currency: last.currency, kind: 'money', link: '#/payroll/payslip/' + last.id });
    const c = compensationOf(app, employmentId, util.today(app, m.getString('entity')));
    // The period goes in the label (the kernel shows the amount only).
    const PER = { year: 'Yearly pay', month: 'Monthly pay', week: 'Weekly pay', day: 'Daily rate', hour: 'Hourly rate' };
    if (c !== null) facts.push({ key: 'pay', label: PER[c.period] || 'Pay', value: c.amount_minor, currency: c.currency, kind: 'money', link: '' });
  }
  return facts;
}

/* ----------------------------------------------------------------- home */

/** payroll.home: next run per schedule, runs in progress, blockers, this year's totals and a monthly chart. */
function home(ctx, p) {
  const util = u();
  const app = ctx.app;
  need(ctx, 'view');
  const ent = entityParam(ctx, p, false);
  const ents = util.findMany(app, 'entities', ent ? 'id = {:e}' : 'active = true', 'created', 0, { e: ent ? ent.id : '' }).filter((r) => L('lib_auth').inScope(ctx, r.id));
  const schedules = [];
  const inProgress = [];
  const totals = [];
  for (const e of ents) {
    for (const s of util.findMany(app, 'pay_schedules', 'entity = {:e} && active = true', 'name', 0, { e: e.id })) {
      schedules.push(Object.assign({ schedule: s.id, name: s.getString('name'), frequency: s.getString('frequency'), entity: e.id, entity_name: e.getString('name'), currency: e.getString('currency'), people: countOnSchedule(app, s) }, nextPeriod(app, s)));
    }
    for (const r of util.findMany(app, 'payruns', "entity = {:e} && (status = 'draft' || status = 'calculating' || status = 'calculated' || status = 'approved' || status = 'locked')", 'pay_date', 0, { e: e.id })) inProgress.push(L('lib_payroll_runs').runSummary(app, r));
    const year = util.today(app, e.id).slice(0, 4);
    const t = util.one(
      app,
      "SELECT CAST(COALESCE(SUM(gross_minor), 0) AS INTEGER) AS gross, CAST(COALESCE(SUM(net_minor), 0) AS INTEGER) AS net, CAST(COALESCE(SUM(employer_minor), 0) AS INTEGER) AS employer, CAST(COALESCE(SUM(deductions_minor), 0) AS INTEGER) AS deductions, COUNT(*) AS runs FROM payruns WHERE entity = {:e} AND status IN ('locked', 'paid') AND substr(pay_date, 1, 4) = {:y}",
      { gross: 0, net: 0, employer: 0, deductions: 0, runs: 0 },
      { e: e.id, y: year },
    );
    const months = util.rows(
      app,
      "SELECT substr(pay_date, 1, 7) AS month, CAST(COALESCE(SUM(gross_minor), 0) AS INTEGER) AS gross, CAST(COALESCE(SUM(net_minor), 0) AS INTEGER) AS net, CAST(COALESCE(SUM(employer_minor), 0) AS INTEGER) AS employer FROM payruns WHERE entity = {:e} AND status IN ('locked', 'paid') AND substr(pay_date, 1, 4) = {:y} GROUP BY substr(pay_date, 1, 7) ORDER BY month",
      { month: '', gross: 0, net: 0, employer: 0 },
      { e: e.id, y: year },
    );
    totals.push({ entity: e.id, entity_name: e.getString('name'), currency: e.getString('currency'), year: year, gross_minor: t ? t.gross : 0, net_minor: t ? t.net : 0, employer_minor: t ? t.employer : 0, deductions_minor: t ? t.deductions : 0, runs: t ? t.runs : 0, months: months.map((x) => ({ month: x.month, gross_minor: x.gross, net_minor: x.net, employer_minor: x.employer })) });
  }
  schedules.sort((a, b) => (a.pay_date < b.pay_date ? -1 : a.pay_date > b.pay_date ? 1 : 0));
  const blockers = [];
  for (const r of inProgress) if (r.blockers > 0) blockers.push({ payrun: r.id, number: r.number, entity_name: r.entity_name, blockers: r.blockers, link: '#/payroll/runs/' + r.id + '?tab=issues' });
  const setup = [];
  for (const e of ents) {
    const st = settingsGet(Object.assign({}, ctx), { entity: e.id });
    if (st.missing_fields.length > 0) setup.push({ entity: e.id, entity_name: e.getString('name'), code: 'entity_fields_missing', fields: st.missing_fields, link: '#/payroll/settings?entity=' + e.id });
    if (util.count(app, 'SELECT COUNT(*) AS n FROM pay_schedules WHERE entity = {:e} AND active = TRUE', { e: e.id }) === 0) setup.push({ entity: e.id, entity_name: e.getString('name'), code: 'no_schedule', link: '#/payroll/schedules' });
    if (startsUnknown(app, e, st.settings)) setup.push({ entity: e.id, entity_name: e.getString('name'), code: 'go_live_missing', link: '#/payroll/openings?entity=' + e.id });
  }
  const pending = util.count(app, "SELECT COUNT(*) AS n FROM approvals WHERE status = 'pending' AND kind IN ('pay_change', 'loan', 'tax_declaration', 'payrun')");
  return { schedules: schedules, in_progress: inProgress, blockers: blockers, totals: totals, setup: setup, pending_approvals: pending, next: schedules.length > 0 ? schedules[0] : null };
}

module.exports = {
  PRORATION: PRORATION,
  PER_YEAR: PER_YEAR,
  KINDS: KINDS,
  STAGES: STAGES,
  CALCS: CALCS,
  ROLES: ROLES,
  BASIC_SET: BASIC_SET,
  SEED_ROLE: SEED_ROLE,
  need: need,
  canPayroll: canPayroll,
  scopeIds: scopeIds,
  entityParam: entityParam,
  packBody: packBody,
  packRows: packRows,
  latestBody: latestBody,
  fieldsOf: fieldsOf,
  cleanFields: cleanFields,
  ensureSettings: ensureSettings,
  startsUnknown: startsUnknown,
  settingsRec: settingsRec,
  settingsView: settingsView,
  settingsGet: settingsGet,
  settingsSave: settingsSave,
  fieldsOp: fieldsOp,
  scheduleView: scheduleView,
  syncExitComponent: syncExitComponent,
  countOnSchedule: countOnSchedule,
  schedulesList: schedulesList,
  schedulesSave: schedulesSave,
  periodContaining: periodContaining,
  nextPeriodAfter: nextPeriodAfter,
  payDateOf: payDateOf,
  periodInfo: periodInfo,
  periodsPerYear: periodsPerYear,
  nextPeriod: nextPeriod,
  schedObj: schedObj,
  entityWeek: entityWeek,
  calendarOp: calendarOp,
  componentView: componentView,
  componentByCode: componentByCode,
  componentByRole: componentByRole,
  componentRef: componentRef,
  seedComponents: seedComponents,
  componentsList: componentsList,
  componentsSave: componentsSave,
  componentsSeed: componentsSeed,
  recentPayslips: recentPayslips,
  compensationOf: compensationOf,
  scheduleOfEmployment: scheduleOfEmployment,
  onEntityCreated: onEntityCreated,
  onSeparation: onSeparation,
  onSeparationChanged: onSeparationChanged,
  onRecordEditing: onRecordEditing,
  onEmploymentChanged: onEmploymentChanged,
  profileFacts: profileFacts,
  home: home,
};
