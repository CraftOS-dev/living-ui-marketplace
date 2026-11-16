/// <reference path="../pb_data/types.d.ts" />
/**
 * Expenses (core): who may see and change a claim, the policy flags of a
 * line, totals, views, and the module's contracts with the kernel and with
 * payroll (SPEC 3.5).
 *
 *   draft -> submitted -> approved -> paid
 *                      -> rejected -> draft (reopened) -> submitted ...
 *   draft | rejected -> cancelled
 *
 * A claim is in the pay currency of the employment's entity. Each line keeps
 * its own amount and currency, the rate of the day and the base amount in
 * the claim currency. Policy flags are computed on every change and shown,
 * never blocking; only missing or impossible data blocks a submission.
 *
 * "Paid" comes only from payroll (markPaid at lock), from a person marking
 * it paid with a reference, or from settling it in full against an advance
 * the employee already received.
 *
 * Contracts (called by payroll, see reference/agent_app/expenses.md):
 *   payInputs(app, employmentId, upToDay, currency, opts)
 *       -> [{ claim, advance, ref, kind, number, component, amount_minor, currency, taxable, name, categories }]
 *   markPaid(app, ids, payrunId)            ids: claim ids, advance ids, or { advance, amount_minor }
 *   unmarkPaid(app, payrunId)                a voided run hands its claims and advances back
 *   advanceRecovery(app, employmentId, upToDay) -> [{ advance, number, amount_minor, currency, name }]
 *   outstanding(app, employmentId)           unpaid claims and advance balances (final settlement)
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}

const STATUSES = ['draft', 'submitted', 'approved', 'rejected', 'paid', 'cancelled'];
const OPEN = ['draft', 'submitted'];
const AGENT_FLAGS = ['possible_duplicate', 'suspected_generated', 'not_a_receipt', 'unclear', 'restricted_item', 'amount_mismatch'];
const BLOCKERS = ['no_amount', 'no_category', 'no_rate', 'future_day', 'no_distance', 'no_mileage_rate'];
// Flags of severity 'wait' (reading, review_reading) also hold a submission, shown as a wait and not as a fault.
const WAITS = ['reading', 'review_reading'];
const READING_FIELDS = ['merchant', 'day', 'amount', 'currency', 'tax', 'category', 'description'];
const TRAVEL_PURPOSES = ['client_visit', 'conference', 'training', 'internal_meeting', 'sales', 'relocation', 'other'];

/* ------------------------------------------------------------ lookups */

function money() {
  return L('lib_money');
}

function fmt(minor, currency) {
  return money().format(minor, currency);
}

/** Entity facts expenses needs: { id, name, currency, country, exponent, weekend }. */
function entityInfo(app, entityId) {
  const util = u();
  const e = util.byId(app, 'entities', entityId);
  if (e === null) throw util.fail(404, 'No entity ' + entityId + '.', 'not_found');
  const countries = L('lib_countries');
  const c = countries.has(e.getString('country')) ? countries.get(e.getString('country')) : null;
  return {
    id: e.id,
    name: e.getString('name'),
    currency: e.getString('currency'),
    country: e.getString('country'),
    exponent: money().exponent(e.getString('currency')),
    weekend: c && Array.isArray(c.weekend) ? c.weekend : [0, 6],
  };
}

function policyRow(app, entityId) {
  return u().findOne(app, 'expense_policies', 'entity = {:e}', { e: entityId });
}

/** The policy of an entity: its stored row, or the defaults for its currency when none was saved yet. */
function policyOf(app, entityId) {
  const ent = entityInfo(app, entityId);
  const r = policyRow(app, entityId);
  const d = L('lib_expenses_seed').policyFor(ent.currency, ent.exponent);
  const pick = (k, get) => (r === null ? d[k] : get(k));
  return {
    entity: ent.id,
    entity_name: ent.name,
    currency: ent.currency,
    stored: r !== null,
    finance_over_minor: pick('finance_over_minor', (k) => r.getInt(k)),
    max_age_days: pick('max_age_days', (k) => r.getInt(k)),
    flag_weekends: pick('flag_weekends', (k) => r.getBool(k)),
    pay_via: pick('pay_via', (k) => r.getString(k) || d[k]),
    advance_pay_via: pick('advance_pay_via', (k) => r.getString(k) || d[k]),
    advance_recover_via: pick('advance_recover_via', (k) => r.getString(k) || d[k]),
    recover_after_days: pick('recover_after_days', (k) => r.getInt(k)),
    note: r === null ? '' : r.getString('note'),
  };
}

function categoryView(rec) {
  if (rec === null) return null;
  const util = u();
  return {
    id: rec.id,
    entity: rec.getString('entity'),
    code: rec.getString('code'),
    name: rec.getString('name'),
    description: rec.getString('description'),
    icon: rec.getString('icon') || 'Receipt',
    kind: rec.getString('kind'),
    limit_minor: rec.getInt('limit_minor'),
    per_day_limit_minor: rec.getInt('per_day_limit_minor'),
    receipt_rule: rec.getString('receipt_rule'),
    receipt_over_minor: rec.getInt('receipt_over_minor'),
    mileage_rate_minor: rec.getFloat('mileage_rate_minor'),
    unit: rec.getString('unit') || 'km',
    taxable: rec.getBool('taxable'),
    component: rec.getString('component') || 'REIMB',
    gl_account: rec.getString('gl_account'),
    sort: rec.getInt('sort'),
    archived: rec.getBool('archived'),
  };
}

/** A category of an entity by id, code or name. */
function categoryRef(app, entityId, ref, allowArchived) {
  const util = u();
  const r = String(ref || '').trim();
  if (r === '') throw util.fail(400, 'Give the category (code, name or id). Run expense-categories.list to see them.', 'missing_param', { param: 'category' });
  let rec = util.byId(app, 'expense_categories', r);
  if (rec !== null && rec.getString('entity') !== entityId) rec = null;
  if (rec === null) rec = util.findOne(app, 'expense_categories', 'entity = {:e} && code = {:c}', { e: entityId, c: r.toLowerCase() });
  if (rec === null) {
    const hits = util.rows(app, 'SELECT id FROM expense_categories WHERE entity = {:e} AND LOWER(name) = LOWER({:n}) LIMIT 2', { id: '' }, { e: entityId, n: r });
    if (hits.length === 1) rec = app.findRecordById('expense_categories', hits[0].id);
  }
  if (rec === null) throw util.fail(404, 'No expense category "' + r + '" in this entity. Run expense-categories.list to see them.', 'not_found', { param: 'category' });
  if (rec.getBool('archived') && !allowArchived) throw util.fail(400, 'The category ' + rec.getString('name') + ' is no longer used. Pick another.', 'invalid_param', { param: 'category' });
  return rec;
}

function byNumberOrId(app, collection, ref, label, listOp) {
  const util = u();
  const r = String(ref || '').trim();
  if (r === '') throw util.fail(400, 'Give the ' + label + ' (number or id).', 'missing_param');
  const rec = util.byId(app, collection, r) || util.findOne(app, collection, 'number = {:n}', { n: r.toUpperCase() });
  if (rec === null) throw util.fail(404, 'No ' + label + ' ' + r + '. Run ' + listOp + ' to see them.', 'not_found', { ref: r });
  return rec;
}

function claimRef(app, ref) {
  return byNumberOrId(app, 'claims', ref, 'claim', 'claims.list');
}

function advanceRef(app, ref) {
  return byNumberOrId(app, 'advances', ref, 'advance', 'advances.list');
}

function travelRef(app, ref) {
  return byNumberOrId(app, 'travel_requests', ref, 'travel request', 'travel.list');
}

function lineRef(app, ref) {
  const util = u();
  const rec = util.byId(app, 'claim_lines', String(ref || '').trim());
  if (rec === null) throw util.fail(404, 'No expense line ' + ref + '. Run claims.get to see the lines of a claim.', 'not_found');
  return rec;
}

function nextNumber(app, key, prefix) {
  return prefix + '-' + String(u().nextNumber(app, key)).padStart(4, '0');
}

/* ------------------------------------------------------------- access */

/** May the caller act for this employment as HR (expenses edit in its entity)? */
function isAdminFor(ctx, entityId, lvl) {
  const auth = L('lib_auth');
  if (ctx.isAgent || ctx.actor === 'system') return true;
  return auth.can(ctx, 'expenses', lvl || 'edit') && auth.inScope(ctx, entityId);
}

function isOwn(ctx, employeeId) {
  return !ctx.isAgent && ctx.employeeId !== '' && ctx.employeeId === employeeId;
}

/**
 * What the caller may do with a record that belongs to an employment:
 * 'admin' (expenses view or more in its entity, your AI agent, the app),
 * 'self', 'team' (a manager of the person), 'approver' (asked to decide it),
 * or 'none'.
 */
function accessOf(ctx, rec) {
  const auth = L('lib_auth');
  if (ctx.isAgent || ctx.actor === 'system') return 'admin';
  if (auth.can(ctx, 'expenses', 'view') && auth.inScope(ctx, rec.getString('entity'))) return 'admin';
  if (isOwn(ctx, rec.getString('employee'))) return 'self';
  if (ctx.teamScope && auth.isManagerOf(ctx, rec.getString('employment'), u().today(ctx.app, rec.getString('entity')))) return 'team';
  const ap = rec.getString('approval');
  if (ap !== '' && ctx.memberId !== '') {
    const a = u().byId(ctx.app, 'approvals', ap);
    if (a !== null) {
      const ids = u().jsonOf(a, 'approvers', []) || [];
      if (ids.indexOf(ctx.memberId) >= 0 || a.getString('decided_by') === ctx.memberId) return 'approver';
      const hist = u().jsonOf(a, 'history', []) || [];
      if (hist.some((h) => h.by === ctx.memberId)) return 'approver';
    }
  }
  return 'none';
}

function needSee(ctx, rec, what) {
  const a = accessOf(ctx, rec);
  if (a === 'none') throw u().fail(403, 'You cannot see this ' + (what || 'claim') + '.', 'not_permitted');
  return a;
}

/** May the caller change a draft of this employment (own, HR with expenses edit, your AI agent)? */
function canWriteFor(ctx, rec) {
  if (ctx.isAgent || ctx.actor === 'system') return true;
  if (isOwn(ctx, rec.getString('employee'))) return true;
  return isAdminFor(ctx, rec.getString('entity'), 'edit');
}

function needWrite(ctx, rec, what) {
  if (!canWriteFor(ctx, rec)) throw u().fail(403, 'Only the person it belongs to (or HR with expenses edit access) can change this ' + (what || 'claim') + '.', 'not_permitted');
}

/**
 * The employment a self-service write is for: --employment when given (the
 * caller's own, or anyone's for HR and your AI agent), else the caller's own
 * primary employment.
 */
function employmentFor(ctx, p) {
  const util = u();
  const app = ctx.app;
  const people = L('lib_people');
  const ref = util.str(p, 'employment', '');
  if (ref !== '') {
    const m = people.employmentRef(app, ref);
    if (!ctx.isAgent && !isOwn(ctx, m.getString('employee')) && !isAdminFor(ctx, m.getString('entity'), 'edit')) throw util.fail(403, 'You can add expenses only for yourself (HR with expenses edit access can add them for anyone).', 'not_permitted');
    return m;
  }
  if (ctx.isAgent) throw util.fail(400, 'Give --employment (the employee number of the person the expense is for).', 'missing_param', { param: 'employment' });
  if (ctx.employeeId === '') throw util.fail(403, 'Your account is not linked to an employee, so there is nobody to add expenses for. Ask an administrator to link it.', 'no_employee');
  const id = people.primaryEmployment(app, ctx.employeeId, util.today(app));
  if (id === '') throw util.fail(403, 'You have no employment to add expenses to.', 'no_employee');
  return app.findRecordById('employments', id);
}

/** Employment ids of the caller's (direct and indirect) reports. */
function teamEmployments(ctx) {
  if (!ctx.teamScope || ctx.employeeId === '') return [];
  return L('lib_people')
    .reportsOf(ctx.app, ctx.employeeId, u().today(ctx.app), true)
    .map((r) => r.employment);
}

/* -------------------------------------------------------------- names */

/** Name lookups cached for one answer (lists show many rows of the same people). */
function names(app) {
  const cache = {};
  const util = u();
  const get = (collection, id, fn) => {
    if (!id) return fn(null);
    const k = collection + ':' + id;
    if (cache[k] === undefined) cache[k] = util.byId(app, collection, id);
    return fn(cache[k]);
  };
  return {
    employee: (id) => get('employees', id, (r) => (r === null ? '' : L('lib_people').displayName(r))),
    employeeNumber: (id) => get('employees', id, (r) => (r === null ? '' : r.getString('number'))),
    entity: (id) => get('entities', id, (r) => (r === null ? '' : r.getString('name'))),
    member: (id) => get('members', id, (r) => (r === null ? '' : r.getString('name'))),
    category: (id) => get('expense_categories', id, (r) => r),
    advance: (id) => get('advances', id, (r) => (r === null ? '' : r.getString('number'))),
    travel: (id) => get('travel_requests', id, (r) => r),
  };
}

/* ------------------------------------------------------------- flags */

function flag(code, severity, message, params, source) {
  return { code: code, severity: severity, message: message, params: params || {}, source: source || 'rule' };
}

const AGENT_FLAG_TEXT = {
  possible_duplicate: 'Your AI agent thinks this may be a duplicate of another expense',
  suspected_generated: 'Your AI agent thinks the receipt image may be generated or altered',
  not_a_receipt: 'Your AI agent could not find a receipt in this file',
  unclear: 'Your AI agent could not read every detail with confidence',
  restricted_item: 'The receipt lists items the policy may not cover (such as alcohol)',
  amount_mismatch: 'The amount typed differs from the receipt total',
};

/**
 * The flags of one line: data blockers, policy warnings and your AI agent's
 * flags. `info`: { claim, category (record or null), policy, entity, today }.
 */
function flagsFor(app, line, info) {
  const util = u();
  const out = [];
  const cur = info.claim.getString('currency');
  const cat = info.category;
  const amount = line.getInt('amount_minor');
  const base = line.getInt('base_minor');
  const day = line.getString('day');
  const mileage = cat !== null && cat.getString('kind') === 'mileage';
  const reading = util.jsonOf(line, 'agent_read', {}) || {};
  const rs0 = line.getString('receipt_status');
  const pendingRead = amount <= 0 && (rs0 === 'waiting' || rs0 === 'reading' || reading.state === 'proposed');
  if (cat === null && !pendingRead) out.push(flag('no_category', 'blocker', 'Pick a category'));
  if (mileage) {
    if (!(line.getFloat('distance') > 0)) out.push(flag('no_distance', 'blocker', 'Enter the distance'));
    else if (!(line.getFloat('rate_minor') > 0)) out.push(flag('no_mileage_rate', 'blocker', 'The mileage rate of ' + cat.getString('name') + ' is not set'));
  } else if (amount <= 0) {
    const rs = line.getString('receipt_status');
    if (rs === 'waiting' || rs === 'reading') out.push(flag('reading', 'wait', 'Your AI agent is reading the receipt; type the amount to send it now'));
    else if (reading.state === 'proposed') out.push(flag('review_reading', 'wait', "Use or dismiss your AI agent's reading of the receipt"));
    else out.push(flag('no_amount', 'blocker', 'Enter the amount'));
  }
  if (amount > 0 && line.getString('currency') !== cur && !(line.getFloat('fx_rate') > 0)) out.push(flag('no_rate', 'blocker', 'No exchange rate from ' + line.getString('currency') + ' to ' + cur + ' for ' + day + '; type the rate', { from: line.getString('currency'), to: cur }));
  if (util.isDay(day) && day > info.today) out.push(flag('future_day', 'blocker', 'The day is in the future'));
  if (cat !== null && base > 0) {
    const lim = cat.getInt('limit_minor');
    if (lim > 0 && base > lim) out.push(flag('over_limit', 'warning', 'Over the limit of ' + fmt(lim, cur) + ' per expense for ' + cat.getString('name'), { limit_minor: lim, currency: cur }));
    const perDay = cat.getInt('per_day_limit_minor');
    if (perDay > 0) {
      const r = util.one(
        app,
        "SELECT CAST(COALESCE(SUM(l.base_minor), 0) AS INTEGER) AS n FROM claim_lines l JOIN claims c ON c.id = l.claim WHERE l.employee = {:e} AND l.day = {:d} AND l.category = {:cat} AND l.status = 'included' AND c.status NOT IN ('cancelled', 'rejected') AND c.currency = {:cur}",
        { n: 0 },
        { e: line.getString('employee'), d: day, cat: cat.id, cur: cur },
      );
      const sum = r === null ? 0 : r.n;
      if (sum > perDay) out.push(flag('over_day_limit', 'warning', fmt(sum, cur) + ' of ' + cat.getString('name') + ' on ' + day + ', over the limit of ' + fmt(perDay, cur) + ' a day', { limit_minor: perDay, total_minor: sum, currency: cur }));
    }
    const rule = cat.getString('receipt_rule');
    const hasReceipt = line.getString('receipt') !== '';
    if (!mileage && !hasReceipt && (rule === 'always' || (rule === 'over' && base >= cat.getInt('receipt_over_minor')))) out.push(flag('missing_receipt', 'warning', rule === 'always' ? 'A receipt is needed for ' + cat.getString('name') : 'A receipt is needed from ' + fmt(cat.getInt('receipt_over_minor'), cur), { over_minor: rule === 'over' ? cat.getInt('receipt_over_minor') : 0, currency: cur }));
  }
  if (util.isDay(day)) {
    if (info.policy.flag_weekends && info.entity.weekend.indexOf(util.weekday(day)) >= 0) out.push(flag('weekend', 'warning', 'Spent on a weekend'));
    const maxAge = info.policy.max_age_days;
    if (maxAge > 0 && util.daysBetween(day, info.today) > maxAge) out.push(flag('old', 'warning', 'More than ' + maxAge + ' days old', { days: maxAge }));
    if (amount > 0) {
      const merchant = util.squash(line.getString('merchant')).toLowerCase();
      const dup = util.one(
        app,
        "SELECT l.id AS id, c.number AS number FROM claim_lines l JOIN claims c ON c.id = l.claim WHERE l.employee = {:e} AND l.day = {:d} AND l.id != {:id} AND l.status = 'included' AND c.status NOT IN ('cancelled', 'rejected') AND l.amount_minor = {:a} AND l.currency = {:cur} AND ((LOWER(TRIM(l.merchant)) = {:m} AND {:m} != '') OR ({:m} = '' AND TRIM(l.merchant) = '' AND l.category = {:cat})) LIMIT 1",
        { id: '', number: '' },
        { e: line.getString('employee'), d: day, id: line.id || '-', a: amount, cur: line.getString('currency'), m: merchant, cat: cat !== null ? cat.id : '-' },
      );
      if (dup !== null) out.push(flag('duplicate', 'warning', 'Same merchant, amount and day as an expense on ' + dup.number, { line: dup.id, claim_number: dup.number }));
    }
  }
  for (const af of util.jsonOf(line, 'agent_flags', []) || []) {
    if (af.cleared) continue;
    out.push(flag(af.code, 'warning', AGENT_FLAG_TEXT[af.code] || af.code, { note: af.note || '' }, 'agent'));
  }
  return out;
}

function lineInfo(app, claim, cache) {
  const c = cache || {};
  const ent = claim.getString('entity');
  if (c['e:' + ent] === undefined) c['e:' + ent] = entityInfo(app, ent);
  if (c['p:' + ent] === undefined) c['p:' + ent] = policyOf(app, ent);
  if (c['t:' + ent] === undefined) c['t:' + ent] = u().today(app, ent);
  return { claim: claim, entity: c['e:' + ent], policy: c['p:' + ent], today: c['t:' + ent], cache: c };
}

/** Recompute and store the flags of one line. */
function reflag(app, line, claim, cache) {
  const info = lineInfo(app, claim, cache);
  const cid = line.getString('category');
  if (info.cache['c:' + cid] === undefined) info.cache['c:' + cid] = cid !== '' ? u().byId(app, 'expense_categories', cid) : null;
  info.category = info.cache['c:' + cid];
  const flags = flagsFor(app, line, info);
  line.set('flags', flags);
  line.set('flag_count', flags.length);
  app.save(line);
  return flags;
}

/** Recompute the flags of every open line of an employee on these days (day limits and duplicates span claims). */
function refreshDays(app, employeeId, days) {
  const util = u();
  const seen = {};
  const cache = {};
  const claims = {};
  for (const d of days) {
    if (!util.isDay(d) || seen[d]) continue;
    seen[d] = true;
    const rows = util.rows(app, "SELECT l.id AS id, l.claim AS claim FROM claim_lines l JOIN claims c ON c.id = l.claim WHERE l.employee = {:e} AND l.day = {:d} AND c.status IN ('draft', 'submitted')", { id: '', claim: '' }, { e: employeeId, d: d });
    for (const r of rows) {
      if (claims[r.claim] === undefined) claims[r.claim] = app.findRecordById('claims', r.claim);
      reflag(app, app.findRecordById('claim_lines', r.id), claims[r.claim], cache);
    }
  }
  for (const id of Object.keys(claims)) refreshClaim(app, app.findRecordById('claims', id));
}

/** Totals, counts and the flag summary of a claim (saved). */
function refreshClaim(app, claim) {
  const util = u();
  const lines = util.findMany(app, 'claim_lines', 'claim = {:c}', 'sort,created', 0, { c: claim.id });
  let total = 0;
  let included = 0;
  let warnings = 0;
  let blockers = 0;
  let waits = 0;
  const codes = {};
  for (const l of lines) {
    if (l.getString('status') === 'included') {
      included += l.getInt('base_minor');
      for (const f of util.jsonOf(l, 'flags', []) || []) {
        if (f.severity === 'blocker') blockers++;
        else if (f.severity === 'wait') waits++;
        else warnings++;
        codes[f.code] = (codes[f.code] || 0) + 1;
      }
    }
    total += l.getInt('base_minor');
  }
  claim.set('total_minor', included);
  if (claim.getString('status') === 'draft' || claim.getString('status') === 'submitted') claim.set('approved_minor', 0);
  claim.set('line_count', lines.length);
  claim.set('flag_count', warnings + blockers);
  claim.set('flags', { warnings: warnings, blockers: blockers, waits: waits, codes: codes, claimed_minor: total });
  app.save(claim);
  return claim;
}

/* -------------------------------------------------------------- views */

function lineView(app, rec, nm) {
  const util = u();
  const n = nm || names(app);
  const cat = n.category(rec.getString('category'));
  const receipt = rec.getString('receipt');
  const rej = rec.getString('rejected_by');
  return {
    id: rec.id,
    claim: rec.getString('claim'),
    day: rec.getString('day'),
    category: rec.getString('category'),
    category_code: cat ? cat.getString('code') : '',
    category_name: cat ? cat.getString('name') : '',
    category_icon: cat ? cat.getString('icon') || 'Receipt' : 'Receipt',
    kind: cat ? cat.getString('kind') : 'standard',
    merchant: rec.getString('merchant'),
    description: rec.getString('description'),
    attendees: rec.getString('attendees'),
    amount_minor: rec.getInt('amount_minor'),
    currency: rec.getString('currency'),
    fx_rate: rec.getFloat('fx_rate'),
    fx_day: rec.getString('fx_day'),
    fx_source: rec.getString('fx_source'),
    base_minor: rec.getInt('base_minor'),
    tax_minor: rec.getInt('tax_minor'),
    receipt: receipt !== '',
    receipt_kind: receipt === '' ? '' : /\.pdf$/i.test(receipt) ? 'pdf' : 'image',
    receipt_status: rec.getString('receipt_status'),
    distance: rec.getFloat('distance'),
    unit: rec.getString('unit'),
    rate_minor: rec.getFloat('rate_minor'),
    flags: util.jsonOf(rec, 'flags', []) || [],
    flag_count: rec.getInt('flag_count'),
    reason: rec.getString('reason'),
    agent_read: util.jsonOf(rec, 'agent_read', null),
    agent_flags: util.jsonOf(rec, 'agent_flags', []) || [],
    edited: util.jsonOf(rec, 'edited', []) || [],
    status: rec.getString('status'),
    reject_reason: rec.getString('reject_reason'),
    rejected_by_name: rej !== '' ? n.member(rej) : '',
    sort: rec.getInt('sort'),
    created: rec.getString('created'),
    updated: rec.getString('updated'),
  };
}

function claimView(app, rec, nm) {
  const util = u();
  const n = nm || names(app);
  const cur = rec.getString('currency');
  const trv = rec.getString('travel') !== '' ? n.travel(rec.getString('travel')) : null;
  const approved = rec.getInt('approved_minor');
  const applied = rec.getInt('advance_applied_minor');
  const status = rec.getString('status');
  return {
    id: rec.id,
    number: rec.getString('number'),
    title: rec.getString('title'),
    label: rec.getString('title') || rec.getString('number'),
    employment: rec.getString('employment'),
    employee: rec.getString('employee'),
    employee_name: n.employee(rec.getString('employee')),
    employee_number: n.employeeNumber(rec.getString('employee')),
    entity: rec.getString('entity'),
    entity_name: n.entity(rec.getString('entity')),
    currency: cur,
    total_minor: rec.getInt('total_minor'),
    approved_minor: approved,
    advance_applied_minor: applied,
    payable_minor: status === 'approved' || status === 'paid' ? Math.max(0, approved - applied) : Math.max(0, rec.getInt('total_minor')),
    status: status,
    pay_via: rec.getString('pay_via'),
    payrun: rec.getString('payrun'),
    paid_via: rec.getString('paid_via'),
    paid_reference: rec.getString('paid_reference'),
    paid_at: rec.getString('paid_at'),
    paid_day: rec.getString('paid_day'),
    paid_by_name: n.member(rec.getString('paid_by')),
    advance: rec.getString('advance'),
    advance_number: n.advance(rec.getString('advance')),
    travel: rec.getString('travel'),
    travel_number: trv ? trv.getString('number') : '',
    travel_label: trv ? travelLabel(trv) : '',
    approval: rec.getString('approval'),
    submitted_at: rec.getString('submitted_at'),
    decided_at: rec.getString('decided_at'),
    approved_day: rec.getString('approved_day'),
    decided_note: rec.getString('decided_note'),
    flags: util.jsonOf(rec, 'flags', {}) || {},
    flag_count: rec.getInt('flag_count'),
    line_count: rec.getInt('line_count'),
    note: rec.getString('note'),
    created_by: rec.getString('created_by'),
    created_by_name: rec.getString('actor') === 'agent' ? 'Your AI agent' : n.member(rec.getString('created_by')),
    actor: rec.getString('actor'),
    agent: L('lib_agent').view(rec, 'receipt_review'),
    created: rec.getString('created'),
    updated: rec.getString('updated'),
  };
}

function travelLabel(rec) {
  const util = u();
  const dests = util.jsonOf(rec, 'destinations', []) || [];
  const where = dests
    .map((d) => d.city || d.country || '')
    .filter((x) => x !== '')
    .join(', ');
  return where !== '' ? where : rec.getString('purpose').replace(/_/g, ' ');
}

function advanceView(app, rec, nm) {
  const n = nm || names(app);
  const trv = rec.getString('travel') !== '' ? n.travel(rec.getString('travel')) : null;
  return {
    id: rec.id,
    number: rec.getString('number'),
    employment: rec.getString('employment'),
    employee: rec.getString('employee'),
    employee_name: n.employee(rec.getString('employee')),
    employee_number: n.employeeNumber(rec.getString('employee')),
    entity: rec.getString('entity'),
    entity_name: n.entity(rec.getString('entity')),
    travel: rec.getString('travel'),
    travel_number: trv ? trv.getString('number') : '',
    travel_label: trv ? travelLabel(trv) : '',
    purpose: rec.getString('purpose'),
    currency: rec.getString('currency'),
    amount_minor: rec.getInt('amount_minor'),
    balance_minor: rec.getInt('balance_minor'),
    settled_minor: rec.getString('status') === 'paid' || rec.getString('status') === 'settled' ? rec.getInt('amount_minor') - rec.getInt('balance_minor') : 0,
    status: rec.getString('status'),
    approval: rec.getString('approval'),
    pay_via: rec.getString('pay_via'),
    recover_via: rec.getString('recover_via'),
    recover_from: rec.getString('recover_from'),
    needed_by: rec.getString('needed_by'),
    approved_day: rec.getString('approved_day'),
    decided_at: rec.getString('decided_at'),
    decided_note: rec.getString('decided_note'),
    paid_at: rec.getString('paid_at'),
    paid_day: rec.getString('paid_day'),
    paid_reference: rec.getString('paid_reference'),
    paid_by_name: n.member(rec.getString('paid_by')),
    payrun: rec.getString('payrun'),
    requested_by_name: rec.getString('actor') === 'agent' ? 'Your AI agent' : n.member(rec.getString('requested_by')),
    note: rec.getString('note'),
    created: rec.getString('created'),
    updated: rec.getString('updated'),
  };
}

function travelView(app, rec, nm) {
  const util = u();
  const n = nm || names(app);
  return {
    id: rec.id,
    number: rec.getString('number'),
    label: travelLabel(rec),
    employment: rec.getString('employment'),
    employee: rec.getString('employee'),
    employee_name: n.employee(rec.getString('employee')),
    employee_number: n.employeeNumber(rec.getString('employee')),
    entity: rec.getString('entity'),
    entity_name: n.entity(rec.getString('entity')),
    purpose: rec.getString('purpose'),
    details: rec.getString('details'),
    from_day: rec.getString('from_day'),
    to_day: rec.getString('to_day'),
    days: util.isDay(rec.getString('from_day')) && util.isDay(rec.getString('to_day')) ? util.daysBetween(rec.getString('from_day'), rec.getString('to_day')) + 1 : 0,
    destinations: util.jsonOf(rec, 'destinations', []) || [],
    itinerary: util.jsonOf(rec, 'itinerary', []) || [],
    costs: util.jsonOf(rec, 'costs', []) || [],
    estimate_minor: rec.getInt('estimate_minor'),
    currency: rec.getString('currency'),
    status: rec.getString('status'),
    approval: rec.getString('approval'),
    submitted_at: rec.getString('submitted_at'),
    decided_at: rec.getString('decided_at'),
    decided_note: rec.getString('decided_note'),
    created_by_name: rec.getString('actor') === 'agent' ? 'Your AI agent' : n.member(rec.getString('created_by')),
    actor: rec.getString('actor'),
    created: rec.getString('created'),
    updated: rec.getString('updated'),
  };
}

/* ------------------------------------------------------------ seeding */

/** Add the standard categories an entity lacks and its policy row; returns the codes added. */
function seedEntity(app, entityId) {
  const util = u();
  const ent = entityInfo(app, entityId);
  const added = [];
  for (const c of L('lib_expenses_seed').categoriesFor(ent.country, ent.currency, ent.exponent)) {
    if (util.findOne(app, 'expense_categories', 'entity = {:e} && code = {:c}', { e: ent.id, c: c.code }) !== null) continue;
    const r = util.newRecord(app, 'expense_categories');
    r.set('entity', ent.id);
    for (const k of Object.keys(c)) r.set(k, c[k]);
    r.set('archived', false);
    app.save(r);
    added.push(c.code);
  }
  if (policyRow(app, ent.id) === null) {
    const d = L('lib_expenses_seed').policyFor(ent.currency, ent.exponent);
    const r = util.newRecord(app, 'expense_policies');
    r.set('entity', ent.id);
    for (const k of Object.keys(d)) r.set(k, d[k]);
    app.save(r);
  }
  return added;
}

/** entity.created: the standard categories and the policy of the new entity. */
function onEntityCreated(ctx, payload) {
  const added = seedEntity(ctx.app, payload.entity);
  return { categories: added.length };
}

/* ---------------------------------------------------------- approvals */

/** Apply outstanding advances to an approved claim (its linked advance first, then advances settled by claims, oldest first). */
function settleAgainstAdvances(app, claim, actorCtx) {
  const util = u();
  let left = Math.max(0, claim.getInt('approved_minor') - claim.getInt('advance_applied_minor'));
  if (left <= 0) return 0;
  const pool = util.findMany(app, 'advances', "employment = {:m} && status = 'paid' && balance_minor > 0 && currency = {:c}", 'paid_day,created', 0, { m: claim.getString('employment'), c: claim.getString('currency') });
  const linked = claim.getString('advance');
  pool.sort((a, b) => (a.id === linked ? -1 : b.id === linked ? 1 : 0));
  let applied = 0;
  const day = util.today(app, claim.getString('entity'));
  for (const adv of pool) {
    if (left <= 0) break;
    if (adv.id !== linked && adv.getString('recover_via') !== 'claim') continue;
    const take = Math.min(left, adv.getInt('balance_minor'));
    if (take <= 0) continue;
    const s = util.newRecord(app, 'advance_settlements');
    s.set('advance', adv.id);
    s.set('claim', claim.id);
    s.set('kind', 'claim');
    s.set('amount_minor', take);
    s.set('day', day);
    s.set('note', 'Settled against ' + claim.getString('number'));
    s.set('by', actorCtx && actorCtx.memberId ? actorCtx.memberId : '');
    s.set('actor', actorCtx && actorCtx.isAgent ? 'agent' : actorCtx && actorCtx.actor === 'person' ? 'person' : 'system');
    app.save(s);
    adv.set('balance_minor', adv.getInt('balance_minor') - take);
    if (adv.getInt('balance_minor') === 0) adv.set('status', 'settled');
    app.save(adv);
    left -= take;
    applied += take;
  }
  if (applied > 0) {
    claim.set('advance_applied_minor', claim.getInt('advance_applied_minor') + applied);
    app.save(claim);
  }
  return applied;
}

function notifyEmployee(app, employeeId, n) {
  return L('lib_notify').toEmployee(app, employeeId, n);
}

/** The approval subscriber of the kinds claim, advance and travel (SPEC 3.4). */
function onDecision(ctx, approval, decision, note) {
  const util = u();
  const app = ctx.app;
  const kind = approval.kind;
  const coll = kind === 'claim' ? 'claims' : kind === 'advance' ? 'advances' : 'travel_requests';
  const rec = util.byId(app, coll, approval.ref_id);
  if (rec === null) return { missing: approval.ref_id };
  const now = util.nowIso();
  const today = util.today(app, rec.getString('entity'));
  const requesterIsEmployee = (() => {
    const e = util.byId(app, 'employees', rec.getString('employee'));
    return e !== null && e.getString('member') !== '' && e.getString('member') === approval.requester;
  })();
  if (kind === 'claim') {
    if (rec.getString('status') !== 'submitted') return { skipped: rec.getString('status') };
    if (decision === 'approved') {
      const r = util.one(app, "SELECT CAST(COALESCE(SUM(base_minor), 0) AS INTEGER) AS n FROM claim_lines WHERE claim = {:c} AND status = 'included'", { n: 0 }, { c: rec.id });
      const approved = r === null ? 0 : r.n;
      if (approved <= 0) throw util.fail(409, 'Every expense on this claim was rejected; reject the claim instead.', 'nothing_to_approve');
      rec.set('status', 'approved');
      rec.set('approved_minor', approved);
      rec.set('approved_day', today);
      rec.set('decided_at', now);
      rec.set('decided_note', util.clip(note || '', 2000));
      app.save(rec);
      const applied = settleAgainstAdvances(app, rec, ctx);
      if (applied > 0 && rec.getInt('approved_minor') - rec.getInt('advance_applied_minor') <= 0) {
        rec.set('status', 'paid');
        rec.set('paid_via', 'advance');
        rec.set('paid_at', now);
        rec.set('paid_day', today);
        rec.set('paid_reference', 'Settled against an advance');
        app.save(rec);
      }
      if (!requesterIsEmployee) notifyEmployee(app, rec.getString('employee'), { kind: 'expenses', title: 'Approved: expense claim ' + rec.getString('number'), body: fmt(rec.getInt('approved_minor'), rec.getString('currency')) + (note ? '. ' + note : ''), link: '#/expenses/claims/' + rec.id, facts: [{ type: 'state', key: 'status', value: rec.getString('status') }, { type: 'money', key: 'approved', label: 'Approved', amount_minor: rec.getInt('approved_minor'), currency: rec.getString('currency') }].concat(note ? [{ type: 'text', key: 'note', label: 'Note', value: note }] : []) });
    } else if (decision === 'rejected') {
      rec.set('status', 'rejected');
      rec.set('decided_at', now);
      rec.set('decided_note', util.clip(note || '', 2000));
      app.save(rec);
      if (!requesterIsEmployee) notifyEmployee(app, rec.getString('employee'), { kind: 'expenses', title: 'Not approved: expense claim ' + rec.getString('number'), body: note || '', link: '#/expenses/claims/' + rec.id, facts: [{ type: 'state', key: 'status', value: 'rejected' }].concat(approval.facts || []).concat(note ? [{ type: 'text', key: 'note', label: 'Note', value: note }] : []) });
    } else {
      rec.set('status', 'draft');
      rec.set('submitted_at', '');
      app.save(rec);
    }
    return { claim: rec.id, status: rec.getString('status') };
  }
  if (kind === 'advance') {
    if (rec.getString('status') !== 'requested') return { skipped: rec.getString('status') };
    if (decision === 'approved') {
      rec.set('status', 'approved');
      rec.set('approved_day', today);
    } else rec.set('status', decision === 'rejected' ? 'rejected' : 'cancelled');
    rec.set('decided_at', now);
    rec.set('decided_note', util.clip(note || '', 2000));
    app.save(rec);
    if (!requesterIsEmployee && decision !== 'cancelled') notifyEmployee(app, rec.getString('employee'), { kind: 'expenses', title: (decision === 'approved' ? 'Approved: advance ' : 'Not approved: advance ') + rec.getString('number'), body: note || '', link: '#/expenses/advances/' + rec.id, facts: [{ type: 'state', key: 'status', value: decision }, { type: 'money', key: 'amount', label: 'Advance', amount_minor: rec.getInt('amount_minor'), currency: rec.getString('currency') }].concat(note ? [{ type: 'text', key: 'note', label: 'Note', value: note }] : []) });
    return { advance: rec.id, status: rec.getString('status') };
  }
  if (rec.getString('status') !== 'requested') return { skipped: rec.getString('status') };
  if (decision === 'cancelled') {
    rec.set('status', 'draft');
    rec.set('submitted_at', '');
  } else {
    rec.set('status', decision === 'approved' ? 'approved' : 'rejected');
    rec.set('decided_at', now);
    rec.set('decided_note', util.clip(note || '', 2000));
  }
  app.save(rec);
  if (!requesterIsEmployee && decision !== 'cancelled') notifyEmployee(app, rec.getString('employee'), { kind: 'expenses', title: (decision === 'approved' ? 'Approved: trip ' : 'Not approved: trip ') + rec.getString('number'), body: note || '', link: '#/expenses/travel/' + rec.id, facts: [{ type: 'state', key: 'status', value: decision }].concat(approval.facts || []).concat(note ? [{ type: 'text', key: 'note', label: 'Note', value: note }] : []) });
  return { travel: rec.id, status: rec.getString('status') };
}

/**
 * After an approval opened: claims at or above the entity's finance amount
 * get a finance step after the flow's steps (unless the flow has one).
 */
function addFinanceStep(app, approvalView, amountMinor, policy) {
  if (approvalView.status !== 'pending') return false;
  if (!(policy.finance_over_minor > 0) || amountMinor < policy.finance_over_minor) return false;
  const steps = approvalView.steps || [];
  if (steps.some((s) => s.type === 'role' && s.role === 'finance')) return false;
  if (L('lib_auth').roleByCode(app, 'finance') === null) return false;
  const r = app.findRecordById('approvals', approvalView.id);
  steps.push({ type: 'role', role: 'finance' });
  r.set('steps', steps);
  app.save(r);
  return true;
}

/* ------------------------------------------------------------ profile */

/** Facts for the profile and Home: open claims, awaiting reimbursement, advance balance. */
function profileFacts(ctx, employmentId) {
  const util = u();
  const app = ctx.app;
  const m = util.byId(app, 'employments', employmentId);
  if (m === null) return [];
  const probe = { getString: (k) => (k === 'employment' ? m.id : k === 'approval' ? '' : m.getString(k)) };
  if (accessOf(ctx, probe) === 'none') return [];
  const cur = entityInfo(app, m.getString('entity')).currency;
  const open = util.count(app, "SELECT COUNT(*) AS n FROM claims WHERE employment = {:m} AND status IN ('draft', 'submitted') AND line_count > 0", { m: m.id });
  const waiting = util.one(app, "SELECT CAST(COALESCE(SUM(approved_minor - advance_applied_minor), 0) AS INTEGER) AS n FROM claims WHERE employment = {:m} AND status = 'approved' AND currency = {:c}", { n: 0 }, { m: m.id, c: cur });
  const adv = util.one(app, "SELECT CAST(COALESCE(SUM(balance_minor), 0) AS INTEGER) AS n FROM advances WHERE employment = {:m} AND status = 'paid' AND currency = {:c}", { n: 0 }, { m: m.id, c: cur });
  // Typed facts: money travels as minor units with its currency (the screen formats it and Hide pay blanks it).
  const facts = [
    { key: 'open_claims', label: 'Open expense claims', value: open, kind: 'count', tone: 'neutral', link: '#/expenses' },
    { key: 'awaiting_reimbursement', label: 'Awaiting reimbursement', value: waiting === null ? 0 : waiting.n, currency: cur, kind: 'money', tone: 'neutral', link: '#/expenses' },
  ];
  if (adv !== null && adv.n > 0) facts.push({ key: 'advance_to_settle', label: 'Advance to settle', value: adv.n, currency: cur, kind: 'money', tone: 'warn', link: '#/expenses' });
  return facts;
}

/* ---------------------------------------------------------- contracts */

/**
 * Approved claims (and advances paid out through payroll) an employment is
 * owed up to a day, for a pay run (SPEC 3.5). opts.via: 'payroll' (default,
 * a regular run) | 'bank' (a separate reimbursement run) | 'any'.
 */
function payInputs(app, employmentId, upToDay, currency, opts) {
  const util = u();
  const via = opts && opts.via ? String(opts.via) : 'payroll';
  const want = currency ? String(currency).toUpperCase() : '';
  const out = [];
  const where = "employment = {:m} && status = 'approved' && approved_day != '' && approved_day <= {:d}" + (via === 'any' ? '' : ' && pay_via = {:v}');
  const convert = (minor, from, item) => {
    if (want === '' || want === from) return Object.assign(item, { amount_minor: minor, currency: from });
    const to = L('lib_fx').convert(app, minor, from, want, upToDay);
    if (to === null) return Object.assign(item, { amount_minor: minor, currency: from, issue: { code: 'no_rate', severity: 'blocker', message: 'No exchange rate from ' + from + ' to ' + want + ' on or before ' + upToDay + '; set one with fx.set.' } });
    return Object.assign(item, { amount_minor: to, currency: want, original_minor: minor, original_currency: from });
  };
  for (const c of util.findMany(app, 'claims', where, 'approved_day,created', 0, { m: employmentId, d: upToDay, v: via })) {
    const payable = c.getInt('approved_minor') - c.getInt('advance_applied_minor');
    if (payable <= 0) continue;
    const groups = {};
    const order = [];
    for (const r of util.rows(
      app,
      "SELECT COALESCE(k.component, '') AS component, COALESCE(k.taxable, FALSE) AS taxable, COALESCE(k.code, '') AS code, COALESCE(k.gl_account, '') AS gl, CAST(COALESCE(SUM(l.base_minor), 0) AS INTEGER) AS n FROM claim_lines l LEFT JOIN expense_categories k ON k.id = l.category WHERE l.claim = {:c} AND l.status = 'included' GROUP BY k.component, k.taxable, k.code, k.gl_account ORDER BY k.code",
      { component: '', taxable: false, code: '', gl: '', n: 0 },
      { c: c.id },
    )) {
      const comp = r.component || 'REIMB';
      const key = comp + '|' + (r.taxable ? '1' : '0');
      if (groups[key] === undefined) {
        groups[key] = { component: comp, taxable: r.taxable === true, amount: 0, categories: [] };
        order.push(key);
      }
      groups[key].amount += r.n;
      groups[key].categories.push({ code: r.code, gl_account: r.gl, amount_minor: r.n });
    }
    const amounts = order.map((k) => groups[k].amount);
    const gross = amounts.reduce((a, b) => a + b, 0);
    const parts = gross === payable ? amounts : money().allocate(payable, amounts);
    order.forEach((k, i) => {
      if (parts[i] <= 0) return;
      out.push(convert(parts[i], c.getString('currency'), { claim: c.id, advance: '', ref: c.id, kind: 'claim', number: c.getString('number'), component: groups[k].component, taxable: groups[k].taxable, name: 'Expenses ' + c.getString('number'), categories: groups[k].categories, pay_via: c.getString('pay_via') }));
    });
  }
  if (via !== 'bank') {
    for (const a of util.findMany(app, 'advances', "employment = {:m} && status = 'approved' && pay_via = 'payroll' && approved_day != '' && approved_day <= {:d}", 'approved_day,created', 0, { m: employmentId, d: upToDay })) {
      if (a.getInt('amount_minor') <= 0) continue;
      out.push(convert(a.getInt('amount_minor'), a.getString('currency'), { claim: '', advance: a.id, ref: a.id, kind: 'advance', number: a.getString('number'), component: 'ADVANCE', taxable: false, name: 'Advance ' + a.getString('number'), categories: [], pay_via: 'payroll' }));
    }
  }
  return out;
}

/**
 * Payroll locked a run that paid these (SPEC 3.5): claim ids pay their
 * claims; advance ids pay out an approved advance or, for an advance
 * already paid, record its recovery (the full balance, or { advance,
 * amount_minor } for part of it). Runs on the caller's handle (payroll's
 * lock transaction). Returns what changed and what was skipped.
 */
function markPaid(app, ids, payrunId) {
  const util = u();
  const now = util.nowIso();
  const out = { claims: 0, advances_paid: 0, recovered: 0, skipped: [] };
  const run = String(payrunId || '');
  // Paid on the run's pay day (people are paid then, not on the lock day).
  const runRec = run !== '' ? util.byId(app, 'payruns', run) : null;
  const payDay = runRec !== null && util.isDay(runRec.getString('pay_date')) ? runRec.getString('pay_date') : '';
  for (const raw of ids || []) {
    const obj = raw !== null && typeof raw === 'object' ? raw : null;
    const ref = obj ? String(obj.advance || obj.claim || obj.ref || '') : String(raw || '');
    if (ref === '') continue;
    const c = util.byId(app, 'claims', ref);
    if (c !== null) {
      if (c.getString('status') === 'paid' && c.getString('payrun') === run) continue;
      if (c.getString('status') !== 'approved') {
        out.skipped.push({ id: ref, reason: 'claim is ' + c.getString('status') });
        continue;
      }
      c.set('status', 'paid');
      c.set('paid_via', 'payroll');
      c.set('payrun', run);
      c.set('paid_at', now);
      c.set('paid_day', payDay !== '' ? payDay : util.today(app, c.getString('entity')));
      c.set('paid_reference', runRec !== null && runRec.getString('number') !== '' ? runRec.getString('number') : run !== '' ? 'Pay run ' + run : 'Pay run');
      app.save(c);
      notifyEmployee(app, c.getString('employee'), { kind: 'expenses', title: 'Paid with your pay: expense claim ' + c.getString('number'), body: fmt(c.getInt('approved_minor') - c.getInt('advance_applied_minor'), c.getString('currency')), link: '#/expenses/claims/' + c.id, email: false, facts: [{ type: 'state', key: 'status', value: 'paid' }, { type: 'money', key: 'paid', label: 'Paid', amount_minor: c.getInt('approved_minor') - c.getInt('advance_applied_minor'), currency: c.getString('currency') }, { type: 'day', key: 'paid_day', label: 'Pay day', value: c.getString('paid_day') }] });
      out.claims++;
      continue;
    }
    const a = util.byId(app, 'advances', ref);
    if (a === null) {
      out.skipped.push({ id: ref, reason: 'not a claim or an advance' });
      continue;
    }
    if (a.getString('status') === 'approved' && a.getString('pay_via') === 'payroll') {
      a.set('status', 'paid');
      a.set('balance_minor', a.getInt('amount_minor'));
      a.set('payrun', run);
      a.set('paid_at', now);
      a.set('paid_day', payDay !== '' ? payDay : util.today(app, a.getString('entity')));
      a.set('paid_reference', runRec !== null && runRec.getString('number') !== '' ? runRec.getString('number') : run !== '' ? 'Pay run ' + run : 'Pay run');
      app.save(a);
      out.advances_paid++;
      continue;
    }
    if (a.getString('status') === 'paid' && a.getInt('balance_minor') > 0) {
      if (run !== '' && util.findOne(app, 'advance_settlements', "advance = {:a} && kind = 'payroll' && payrun = {:r}", { a: a.id, r: run }) !== null) continue;
      const want = obj && obj.amount_minor !== undefined ? Math.round(Number(obj.amount_minor) || 0) : a.getInt('balance_minor');
      const take = Math.max(0, Math.min(want, a.getInt('balance_minor')));
      if (take <= 0) continue;
      const s = util.newRecord(app, 'advance_settlements');
      s.set('advance', a.id);
      s.set('kind', 'payroll');
      s.set('amount_minor', take);
      s.set('day', payDay !== '' ? payDay : util.today(app, a.getString('entity')));
      s.set('payrun', run);
      s.set('note', 'Recovered through payroll');
      s.set('actor', 'system');
      app.save(s);
      a.set('balance_minor', a.getInt('balance_minor') - take);
      if (a.getInt('balance_minor') === 0) a.set('status', 'settled');
      app.save(a);
      out.recovered++;
      continue;
    }
    out.skipped.push({ id: ref, reason: 'advance is ' + a.getString('status') });
  }
  return out;
}

/** A locked run was voided before payment: its claims and advances go back to waiting for the replacement run. */
function unmarkPaid(app, payrunId) {
  const util = u();
  const run = String(payrunId || '');
  const out = { claims: 0, advances: 0, recoveries: 0, skipped: [] };
  if (run === '') return out;
  for (const c of util.findMany(app, 'claims', "payrun = {:r} && status = 'paid' && paid_via = 'payroll'", '', 0, { r: run })) {
    c.set('status', 'approved');
    c.set('payrun', '');
    c.set('paid_via', '');
    c.set('paid_at', '');
    c.set('paid_day', '');
    c.set('paid_reference', '');
    app.save(c);
    out.claims++;
  }
  for (const s of util.findMany(app, 'advance_settlements', "payrun = {:r} && kind = 'payroll'", '', 0, { r: run })) {
    const a = util.byId(app, 'advances', s.getString('advance'));
    if (a !== null) {
      a.set('balance_minor', a.getInt('balance_minor') + s.getInt('amount_minor'));
      a.set('status', 'paid');
      app.save(a);
    }
    app.delete(s);
    out.recoveries++;
  }
  for (const a of util.findMany(app, 'advances', "payrun = {:r} && pay_via = 'payroll' && (status = 'paid' || status = 'settled')", '', 0, { r: run })) {
    if (util.findOne(app, 'advance_settlements', 'advance = {:a}', { a: a.id }) !== null) {
      out.skipped.push({ id: a.id, reason: 'already partly settled; correct it by hand' });
      continue;
    }
    a.set('status', 'approved');
    a.set('balance_minor', 0);
    a.set('payrun', '');
    a.set('paid_at', '');
    a.set('paid_day', '');
    a.set('paid_reference', '');
    app.save(a);
    out.advances++;
  }
  return out;
}

/**
 * Advance balances payroll should recover from an employment up to a day
 * (SPEC 3.5): advances recovered through payroll once their recovery day
 * came, and every advance balance of a leaver whose last day has come.
 */
function advanceRecovery(app, employmentId, upToDay) {
  const util = u();
  const m = util.byId(app, 'employments', employmentId);
  if (m === null) return [];
  const leaving = m.getString('end_day') !== '' && m.getString('end_day') <= upToDay;
  const out = [];
  for (const a of util.findMany(app, 'advances', "employment = {:m} && status = 'paid' && balance_minor > 0", 'paid_day,created', 0, { m: employmentId })) {
    const due = a.getString('recover_via') === 'payroll' && (a.getString('recover_from') === '' || a.getString('recover_from') <= upToDay);
    if (!due && !leaving) continue;
    out.push({ advance: a.id, number: a.getString('number'), amount_minor: a.getInt('balance_minor'), currency: a.getString('currency'), purpose: a.getString('purpose'), name: 'Advance ' + a.getString('number') + ' recovery', reason: due ? 'due' : 'leaving' });
  }
  return out;
}

/** What an employment is still owed and owes (final settlement): unpaid approved claims, open claims, advance balances. */
function outstanding(app, employmentId) {
  const util = u();
  const sum = (sql) => {
    const r = util.one(app, sql, { n: 0 }, { m: employmentId });
    return r === null ? 0 : r.n;
  };
  return {
    approved_unpaid_minor: sum("SELECT CAST(COALESCE(SUM(approved_minor - advance_applied_minor), 0) AS INTEGER) AS n FROM claims WHERE employment = {:m} AND status = 'approved'"),
    open_claims: util.count(app, "SELECT COUNT(*) AS n FROM claims WHERE employment = {:m} AND status IN ('draft', 'submitted') AND line_count > 0", { m: employmentId }),
    advance_balance_minor: sum("SELECT CAST(COALESCE(SUM(balance_minor), 0) AS INTEGER) AS n FROM advances WHERE employment = {:m} AND status = 'paid'"),
    advances_unpaid: util.count(app, "SELECT COUNT(*) AS n FROM advances WHERE employment = {:m} AND status IN ('requested', 'approved')", { m: employmentId }),
  };
}

/* --------------------------------------------------------------- cron */

/** Mondays: remind people of expenses left in drafts for a week, and finance of approved claims paid by bank still unpaid. */
function cronReminders(app) {
  const util = u();
  const weekAgo = util.dayAdd(util.today(app), -7);
  let people = 0;
  for (const r of util.rows(app, "SELECT DISTINCT c.employee AS employee FROM claims c WHERE c.status = 'draft' AND c.line_count > 0 AND c.created < {:t}", { employee: '' }, { t: weekAgo + ' 00:00:00.000Z' })) {
    if (notifyEmployee(app, r.employee, { kind: 'expenses', title: 'You have expenses to submit', body: '', link: '#/expenses', email: false }).length > 0) people++;
  }
  const unpaid = util.count(app, "SELECT COUNT(*) AS n FROM claims WHERE status = 'approved' AND pay_via = 'bank' AND approved_day != '' AND approved_day <= {:d}", { d: weekAgo });
  if (unpaid > 0) L('lib_notify').toRole(app, 'finance', { kind: 'expenses', title: unpaid + ' approved expense claim' + (unpaid === 1 ? '' : 's') + ' to pay by bank', body: '', link: '#/expenses/claims?status=approved', email: false, facts: [{ type: 'number', key: 'claims', label: 'To pay by bank', value: unpaid, unit: unpaid === 1 ? 'claim' : 'claims' }] });
  return { people: people, unpaid_bank: unpaid };
}

/**
 * Ask your AI agent to read the receipts waiting on a claim (receipt_review,
 * one fire per claim: while that ask is open, a new receipt joins it). A
 * cooldown never fails adding an expense: the ask is sent a moment later.
 */
function askRead(ctx, claim) {
  return L('lib_agent').ask(ctx, claim, 'receipt_review', { defer: true });
}

/** No receipt left waiting or being read on the claim: its receipt_review ask is closed. */
function settleReceipts(app, claimId, outcome) {
  const util = u();
  const claim = util.byId(app, 'claims', claimId);
  if (claim === null) return false;
  if (util.count(app, "SELECT COUNT(*) AS n FROM claim_lines WHERE claim = {:c} AND receipt_status IN ('waiting', 'reading')", { c: claimId }) > 0) return false;
  return L('lib_agent').end(app, claim, 'receipt_review', outcome || 'done');
}

module.exports = {
  STATUSES: STATUSES,
  OPEN: OPEN,
  AGENT_FLAGS: AGENT_FLAGS,
  BLOCKERS: BLOCKERS,
  WAITS: WAITS,
  READING_FIELDS: READING_FIELDS,
  TRAVEL_PURPOSES: TRAVEL_PURPOSES,
  fmt: fmt,
  entityInfo: entityInfo,
  policyRow: policyRow,
  policyOf: policyOf,
  categoryView: categoryView,
  categoryRef: categoryRef,
  claimRef: claimRef,
  advanceRef: advanceRef,
  travelRef: travelRef,
  lineRef: lineRef,
  nextNumber: nextNumber,
  isAdminFor: isAdminFor,
  isOwn: isOwn,
  accessOf: accessOf,
  needSee: needSee,
  canWriteFor: canWriteFor,
  needWrite: needWrite,
  employmentFor: employmentFor,
  teamEmployments: teamEmployments,
  names: names,
  flagsFor: flagsFor,
  reflag: reflag,
  refreshDays: refreshDays,
  refreshClaim: refreshClaim,
  lineView: lineView,
  claimView: claimView,
  advanceView: advanceView,
  travelView: travelView,
  travelLabel: travelLabel,
  seedEntity: seedEntity,
  onEntityCreated: onEntityCreated,
  settleAgainstAdvances: settleAgainstAdvances,
  onDecision: onDecision,
  addFinanceStep: addFinanceStep,
  profileFacts: profileFacts,
  payInputs: payInputs,
  markPaid: markPaid,
  unmarkPaid: unmarkPaid,
  advanceRecovery: advanceRecovery,
  outstanding: outstanding,
  cronReminders: cronReminders,
  askRead: askRead,
  settleReceipts: settleReceipts,
};
