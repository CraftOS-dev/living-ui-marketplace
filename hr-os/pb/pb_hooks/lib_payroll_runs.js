/// <reference path="../pb_data/types.d.ts" />
/**
 * Pay runs (payroll-core): create, calculate in chunks with progress, the
 * pre-flight issues and their acknowledgement, run-over-run variance,
 * approval (kind payrun), lock with the approval PIN, publication of
 * payslips, void and replace before payment, correction runs after payment,
 * salary holds, notes and your AI agent's review jobs.
 *
 *   draft -> calculating -> calculated -> (approval) approved -> locked -> paid
 *   void: a locked run withdrawn before payment, replaced by a linked draft.
 *
 * A locked, paid or void run never changes: every write here checks the
 * status first (assertOpen), and nothing unlocks a run.
 *
 * For payroll-out: markPaid(ctx, runId, { paid_at, note }) and
 * payoutItems(app, runId). Events emitted: payrun.locked { payrun },
 * payrun.voided { payrun, replaced_by }, payrun.paid { payrun, paid_at }.
 * At lock: lib_time.lockDays (days up to the input cutoff), lib_expenses.markPaid (claim and advance ids,
 * { advance, amount_minor } for recoveries) and lib_leave.markEncashPaid for
 * what the run paid; at void lib_time.unlockDays and lib_expenses.unmarkPaid.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}

const RUN_KINDS = ['regular', 'off_cycle', 'bonus', 'termination', 'correction', 'reimbursement'];
const OPEN = ['draft', 'calculating', 'calculated', 'approved'];
const CHUNK = 20;
const BUDGET_MS = 20000;
const LEASE_MS = 60000;
const ACK_REASONS = ['reviewed_ok', 'expected_change', 'will_correct_next_run', 'other'];

/* -------------------------------------------------------------- views */

function memberName(app, id) {
  if (!id) return '';
  const m = u().byId(app, 'members', id);
  return m ? m.getString('name') : '';
}

function issueCounts(app, runId) {
  const util = u();
  let blockers = 0;
  let warnings = 0;
  for (const r of util.rows(app, 'SELECT issues FROM payslips WHERE payrun = {:r}', { issues: '' }, { r: runId })) {
    let list = [];
    try {
      list = JSON.parse(r.issues || '[]') || [];
    } catch (e) {
      list = [];
    }
    for (const i of list) {
      if (i.severity === 'blocker') blockers++;
      else warnings++;
    }
  }
  return { blockers: blockers, warnings: warnings };
}

/**
 * What the run pays out: net of everyone not held (net above zero), plus held
 * pay released into this run; the held pay kept back. Net minus held (plus
 * releases) is the bank file total.
 */
function payoutTotals(app, r) {
  const util = u();
  const s = util.one(app, "SELECT COUNT(*) AS n, CAST(COALESCE(SUM(net_minor), 0) AS INTEGER) AS t FROM payslips WHERE payrun = {:r} AND held = TRUE AND status != 'void'", { n: 0, t: 0 }, { r: r.id });
  const rel = util.one(app, "SELECT CAST(COALESCE(SUM(amount_minor), 0) AS INTEGER) AS amt, COUNT(*) AS n FROM salary_holds WHERE released_payrun = {:r} AND release_via = 'payrun' AND status = 'released'", { amt: 0, n: 0 }, { r: r.id });
  return { held_minor: s.t, held_count: s.n, released_minor: rel.amt, released_count: rel.n, to_pay_minor: r.getInt('net_minor') - s.t + rel.amt, to_pay_count: r.getInt('employee_count') - s.n + rel.n };
}

function runSummary(app, r) {
  const util = u();
  const ent = util.byId(app, 'entities', r.getString('entity'));
  const sch = r.getString('schedule') !== '' ? util.byId(app, 'pay_schedules', r.getString('schedule')) : null;
  const iss = util.jsonOf(r, 'issues', {}) || {};
  const po = payoutTotals(app, r);
  return {
    id: r.id,
    number: r.getString('number'),
    label: r.getString('label'),
    kind: r.getString('kind'),
    status: r.getString('status'),
    entity: r.getString('entity'),
    entity_name: ent ? ent.getString('name') : '',
    country: ent ? ent.getString('country') : '',
    schedule: r.getString('schedule'),
    schedule_name: sch ? sch.getString('name') : '',
    period_start: r.getString('period_start'),
    period_end: r.getString('period_end'),
    pay_date: r.getString('pay_date'),
    cutoff_day: r.getString('cutoff_day'),
    currency: r.getString('currency'),
    employee_count: r.getInt('employee_count'),
    gross_minor: r.getInt('gross_minor'),
    deductions_minor: r.getInt('deductions_minor'),
    employer_minor: r.getInt('employer_minor'),
    reimbursement_minor: r.getInt('reimbursement_minor'),
    net_minor: r.getInt('net_minor'),
    held_minor: po.held_minor,
    held_count: po.held_count,
    released_minor: po.released_minor,
    released_count: po.released_count,
    to_pay_minor: po.to_pay_minor,
    to_pay_count: po.to_pay_count,
    blockers: iss.blockers || 0,
    warnings: iss.warnings || 0,
    unacknowledged: iss.unacknowledged || 0,
    approval: r.getString('approval'),
    corrects: r.getString('corrects'),
    replaces: r.getString('replaces'),
    replaced_by: r.getString('replaced_by'),
    progress: util.jsonOf(r, 'progress', {}) || {},
    locked_at: r.getString('locked_at'),
    paid_at: r.getString('paid_at'),
    publish_at: r.getString('publish_at'),
    published_at: r.getString('published_at'),
    calculated_at: r.getString('calculated_at'),
    created: r.getString('created'),
  };
}

function runView(app, r) {
  const util = u();
  const v = runSummary(app, r);
  v.note = r.getString('note');
  v.scope = util.jsonOf(r, 'scope', {}) || {};
  delete v.scope.todo;
  v.options = util.jsonOf(r, 'options', {}) || {};
  v.issues_summary = util.jsonOf(r, 'issues', {}) || {};
  v.variance_summary = util.jsonOf(r, 'variance', {}) || {};
  v.acknowledged = util.jsonOf(r, 'acknowledged', {}) || {};
  v.hash = r.getString('hash');
  v.input_hash = r.getString('input_hash');
  v.locked_by = r.getString('locked_by');
  v.locked_by_name = memberName(app, r.getString('locked_by'));
  v.paid_by_name = memberName(app, r.getString('paid_by'));
  v.void_reason = r.getString('void_reason');
  v.voided_at = r.getString('voided_at');
  v.voided_by_name = memberName(app, r.getString('voided_by'));
  v.created_by_name = r.getString('created_actor') === 'agent' ? 'Your AI agent' : memberName(app, r.getString('created_by'));
  v.calc_ms = r.getInt('calc_ms');
  v.version = r.getInt('version');
  v.year_end = r.getBool('year_end');
  v.steps = stepsOf(v);
  if (r.getString('approval') !== '') {
    const a = util.byId(app, 'approvals', r.getString('approval'));
    v.approval_status = a ? a.getString('status') : '';
    v.approval_view = a ? L('lib_approvals').view(app, a) : null;
  }
  const rel = (id) => {
    const x = id ? util.byId(app, 'payruns', id) : null;
    return x ? { id: x.id, number: x.getString('number'), status: x.getString('status') } : null;
  };
  v.corrects_run = rel(r.getString('corrects'));
  v.replaces_run = rel(r.getString('replaces'));
  v.replaced_by_run = rel(r.getString('replaced_by'));
  v.agent = L('lib_agent').view(r, 'payrun_review');
  return v;
}

/** The state stepper: Draft, Calculated, Approved, Locked, Paid. */
function stepsOf(v) {
  const order = ['draft', 'calculated', 'approved', 'locked', 'paid'];
  const st = v.status === 'calculating' ? 'draft' : v.status;
  const at = order.indexOf(st);
  return order.map((k, i) => ({ key: k, done: v.status !== 'void' && at >= i, current: st === k }));
}

function runRef(app, ref) {
  const util = u();
  const r = String(ref || '').trim();
  if (r === '') throw util.fail(400, 'Give the pay run id or number (PR-0001).', 'missing_param', { param: 'payrun' });
  const rec = util.byId(app, 'payruns', r) || util.findOne(app, 'payruns', 'number = {:n}', { n: r.toUpperCase() });
  if (rec === null) throw util.fail(404, 'No pay run ' + r + '. Run payruns.list.', 'not_found');
  return rec;
}

function needRun(ctx, rec, lvl, what) {
  L('lib_payroll').need(ctx, lvl, rec.getString('entity'), what);
}

/** Refuse a change to a run that is not open (locked, paid and void runs never change). */
function assertOpen(rec, what) {
  const st = rec.getString('status');
  if (OPEN.indexOf(st) < 0) throw u().fail(409, 'Pay run ' + rec.getString('number') + ' is ' + st + ' and can never change' + (what ? ' (' + what + ')' : '') + '. ' + (st === 'locked' ? 'Before payment, void and replace it; after payment, make a correction run.' : st === 'paid' ? 'Make a correction run.' : ''), 'run_locked', { status: st });
}

/* --------------------------------------------------------------- lists */

function list(ctx, p) {
  const util = u();
  const pr = L('lib_payroll');
  pr.need(ctx, 'view');
  const ent = pr.entityParam(ctx, p, false);
  const where = [];
  const bind = {};
  if (ent) {
    where.push('entity = {:e}');
    bind.e = ent.id;
  }
  const status = util.str(p, 'status', 'all');
  if (status === 'open') where.push("(status = 'draft' || status = 'calculating' || status = 'calculated' || status = 'approved')");
  else if (status !== 'all' && status !== '') {
    where.push('status = {:s}');
    bind.s = status;
  }
  const kind = util.str(p, 'kind', '');
  if (kind !== '') {
    where.push('kind = {:k}');
    bind.k = kind;
  }
  const sch = util.str(p, 'schedule', '');
  if (sch !== '') {
    where.push('schedule = {:sc}');
    bind.sc = sch;
  }
  const year = util.str(p, 'year', '');
  if (year !== '') {
    where.push('pay_date >= {:y1} && pay_date <= {:y2}');
    bind.y1 = year + '-01-01';
    bind.y2 = year + '-12-31';
  }
  const pg = util.page(p, 50, 200);
  const rows = util.findMany(ctx.app, 'payruns', where.length ? where.join(' && ') : '1=1', '-pay_date,-created', 0, bind).filter((r) => L('lib_auth').inScope(ctx, r.getString('entity')));
  return { payruns: rows.slice(pg.offset, pg.offset + pg.limit).map((r) => runSummary(ctx.app, r)), total: rows.length };
}

/** Payslip rows of a run for the Employees tab (paged, the biggest change first on request). */
function slipRows(app, runRec, p) {
  const util = u();
  const rows = util.rows(
    app,
    "SELECT s.id AS id, s.employment AS employment, s.employee AS employee, s.gross_minor AS gross, s.deductions_minor AS ded, s.employer_minor AS er, s.reimbursement_minor AS reimb, s.net_minor AS net, s.status AS status, s.issues AS issues, s.variance AS variance, s.held AS held, s.pay_method AS pay_method, e.number AS number, e.legal_name AS legal_name, e.preferred_name AS preferred_name, e.family_name AS family_name, e.given_name AS given_name, e.name_order AS name_order FROM payslips s JOIN employees e ON e.id = s.employee WHERE s.payrun = {:r} ORDER BY e.number",
    { id: '', employment: '', employee: '', gross: 0, ded: 0, er: 0, reimb: 0, net: 0, status: '', issues: '', variance: '', held: false, pay_method: '', number: '', legal_name: '', preferred_name: '', family_name: '', given_name: '', name_order: '' },
    { r: runRec.id },
  );
  const people = L('lib_people');
  const out = rows.map((r) => {
    let iss = [];
    let vr = {};
    try {
      iss = JSON.parse(r.issues || '[]') || [];
    } catch (e) {
      iss = [];
    }
    try {
      vr = JSON.parse(r.variance || '{}') || {};
    } catch (e) {
      vr = {};
    }
    const job = people.rowOn(app, 'job_records', r.employment, runRec.getString('period_end'));
    return {
      id: r.id,
      employment: r.employment,
      employee: r.employee,
      number: r.number,
      name: people.displayName({ preferred_name: r.preferred_name, family_name: r.family_name, given_name: r.given_name, name_order: r.name_order, legal_name: r.legal_name }),
      title: job ? job.getString('title') : '',
      gross_minor: r.gross,
      deductions_minor: r.ded,
      employer_minor: r.er,
      reimbursement_minor: r.reimb,
      net_minor: r.net,
      status: r.status,
      held: r.held,
      pay_method: r.pay_method,
      blockers: iss.filter((i) => i.severity === 'blocker').length,
      warnings: iss.filter((i) => i.severity !== 'blocker').length,
      variance: vr,
    };
  });
  const q = util.str(p, 'q', '').toLowerCase();
  let f = q === '' ? out : out.filter((x) => x.name.toLowerCase().indexOf(q) >= 0 || x.number.toLowerCase().indexOf(q) >= 0);
  const only = util.str(p, 'only', '');
  if (only === 'issues') f = f.filter((x) => x.blockers + x.warnings > 0);
  else if (only === 'blockers') f = f.filter((x) => x.blockers > 0);
  else if (only === 'held') f = f.filter((x) => x.held);
  const sort = util.str(p, 'sort', 'number');
  if (sort === 'change') f.sort((a, b) => Math.abs(b.variance.delta_net_minor || 0) - Math.abs(a.variance.delta_net_minor || 0));
  else if (sort === 'net') f.sort((a, b) => b.net_minor - a.net_minor);
  else if (sort === 'name') f.sort((a, b) => (a.name < b.name ? -1 : 1));
  return f;
}

function get(ctx, p) {
  const util = u();
  const rec = runRef(ctx.app, util.req(p, 'payrun'));
  needRun(ctx, rec, 'view');
  const pg = util.page(p, 100, 500);
  const rows = slipRows(ctx.app, rec, p);
  const v = runView(ctx.app, rec);
  const notes = util.count(ctx.app, 'SELECT COUNT(*) AS n FROM payrun_notes WHERE payrun = {:r} AND resolved = FALSE', { r: rec.id });
  const auth = L('lib_auth');
  v.can = {
    calculate: !ctx.isAgent && auth.can(ctx, 'payroll', 'edit') && OPEN.indexOf(v.status) >= 0,
    submit: auth.can(ctx, 'payroll', 'edit') && v.status === 'calculated' && v.blockers === 0 && (v.approval === '' || v.approval_status !== 'pending'),
    lock: !ctx.isAgent && auth.can(ctx, 'payroll', 'full') && v.status === 'approved',
    void: !ctx.isAgent && auth.can(ctx, 'payroll', 'full') && v.status === 'locked',
    publish: !ctx.isAgent && auth.can(ctx, 'payroll', 'full') && (v.status === 'locked' || v.status === 'paid') && v.published_at === '',
    correct: auth.can(ctx, 'payroll', 'edit') && v.status === 'paid',
    delete: !ctx.isAgent && auth.can(ctx, 'payroll', 'full') && (v.status === 'draft' || v.status === 'calculated'),
  };
  return { payrun: v, payslips: rows.slice(pg.offset, pg.offset + pg.limit), total: rows.length, open_notes: notes };
}

/** payruns.next: for each schedule the next due period and its open run (what "Run payroll" opens). */
function nextOp(ctx, p) {
  const util = u();
  const pr = L('lib_payroll');
  pr.need(ctx, 'view');
  const ent = pr.entityParam(ctx, p, false);
  const out = [];
  for (const s of util.findMany(ctx.app, 'pay_schedules', ent ? 'entity = {:e} && active = true' : 'active = true', 'name', 0, { e: ent ? ent.id : '' })) {
    if (!L('lib_auth').inScope(ctx, s.getString('entity'))) continue;
    const e = ctx.app.findRecordById('entities', s.getString('entity'));
    const np = pr.nextPeriod(ctx.app, s);
    // What the run will include: people on the schedule and open pay inputs of the period.
    const inputs = util.count(ctx.app, "SELECT COUNT(*) AS n FROM pay_inputs i JOIN employments m ON m.id = i.employment WHERE m.entity = {:e} AND i.status = 'open' AND i.period_start <= {:pe} AND i.period_end >= {:ps} AND (i.payrun = '' OR i.payrun = {:r})", { e: e.id, ps: np.period_start, pe: np.period_end, r: np.run ? np.run.id : '' });
    out.push(Object.assign({ schedule: s.id, name: s.getString('name'), entity: e.id, entity_name: e.getString('name'), currency: e.getString('currency'), people: pr.countOnSchedule(ctx.app, s), open_inputs: inputs }, np));
  }
  out.sort((a, b) => (a.pay_date < b.pay_date ? -1 : a.pay_date > b.pay_date ? 1 : 0));
  return { next: out, first: out.length > 0 ? out[0] : null };
}

/* -------------------------------------------------------------- create */

function newRun(app, o) {
  const util = u();
  const r = util.newRecord(app, 'payruns');
  r.set('entity', o.entity.id);
  r.set('schedule', o.schedule ? o.schedule.id : '');
  r.set('kind', o.kind);
  r.set('number', 'PR-' + String(util.nextNumber(app, 'payrun')).padStart(4, '0'));
  r.set('label', util.clip(o.label || '', 160));
  r.set('period_start', o.period_start);
  r.set('period_end', o.period_end);
  r.set('pay_date', o.pay_date);
  r.set('cutoff_day', o.cutoff_day || '');
  r.set('status', 'draft');
  r.set('currency', o.entity.getString('currency'));
  r.set('employee_count', 0);
  for (const k of ['gross_minor', 'deductions_minor', 'employer_minor', 'reimbursement_minor', 'net_minor']) r.set(k, 0);
  r.set('issues', {});
  r.set('variance', {});
  r.set('scope', o.scope || {});
  r.set('options', o.options || {});
  r.set('acknowledged', {});
  r.set('progress', {});
  r.set('version', 0);
  r.set('note', util.clip(o.note || '', 4000));
  r.set('corrects', o.corrects || '');
  r.set('replaces', o.replaces || '');
  r.set('year_end', o.year_end === true);
  r.set('created_by', o.ctx && o.ctx.memberId ? o.ctx.memberId : '');
  r.set('created_actor', o.ctx ? (o.ctx.isAgent ? 'agent' : o.ctx.actor === 'person' ? 'person' : 'system') : 'system');
  app.save(r);
  return r;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A run's name in words: "November 2026", "Bonus November 2026", "November 2026, 1 to 15" for a part of a month. */
function labelOf(kind, period, schedName) {
  const names = { regular: '', off_cycle: 'Off-cycle', bonus: 'Bonus', termination: 'Final pay', correction: 'Correction', reimbursement: 'Reimbursements' };
  const util = u();
  const s = period.start;
  const e = period.end || period.start;
  const month = MONTHS[Number(s.slice(5, 7)) - 1] + ' ' + s.slice(0, 4);
  const whole = s.slice(8, 10) === '01' && e === util.monthEnd(s);
  const part = whole ? '' : ', ' + Number(s.slice(8, 10)) + ' to ' + (e.slice(0, 7) === s.slice(0, 7) ? '' : MONTHS[Number(e.slice(5, 7)) - 1] + ' ') + Number(e.slice(8, 10));
  return (names[kind] ? names[kind] + ' ' : '') + month + part + (schedName ? ' (' + schedName + ')' : '');
}

/** payruns.create: the next regular run of a schedule (one click), or an off-cycle, bonus, final pay, correction or reimbursement run. */
function create(ctx, p) {
  const util = u();
  const app = ctx.app;
  const pr = L('lib_payroll');
  const kind = util.oneOf(p, 'kind', RUN_KINDS, 'regular');
  let sched = null;
  let ent = null;
  const schRef = util.str(p, 'schedule', '');
  if (schRef !== '') {
    sched = util.byId(app, 'pay_schedules', schRef);
    if (sched === null) throw util.fail(404, 'No pay schedule ' + schRef + '. Run pay-schedules.list.', 'not_found');
    ent = app.findRecordById('entities', sched.getString('entity'));
  } else {
    ent = pr.entityParam(ctx, p, kind !== 'correction' && kind !== 'termination');
  }
  let empIds = (util.list(p, 'employments') || []).map(String);
  if (kind === 'termination' && empIds.length === 0 && util.str(p, 'employment', '') !== '') empIds = [util.str(p, 'employment', '')];
  empIds = empIds.map((ref) => L('lib_people').employmentRef(app, ref).id);
  if (ent === null && empIds.length > 0) ent = app.findRecordById('entities', app.findRecordById('employments', empIds[0]).getString('entity'));
  let corrects = null;
  if (kind === 'correction') {
    corrects = runRef(app, util.req(p, 'corrects', 'PR-0001'));
    if (corrects.getString('status') !== 'paid') throw util.fail(409, 'A correction run corrects a paid run. ' + corrects.getString('number') + ' is ' + corrects.getString('status') + (corrects.getString('status') === 'locked' ? ': void and replace it instead.' : '.'), 'not_paid');
    ent = app.findRecordById('entities', corrects.getString('entity'));
    if (sched === null && corrects.getString('schedule') !== '') sched = util.byId(app, 'pay_schedules', corrects.getString('schedule'));
  }
  if (ent === null) throw util.fail(400, 'entity is required.', 'missing_param', { param: 'entity' });
  pr.need(ctx, 'edit', ent.id, 'start pay runs');
  for (const id of empIds) if (app.findRecordById('employments', id).getString('entity') !== ent.id) throw util.fail(400, 'Every person in a run belongs to ' + ent.getString('name') + '.', 'invalid_param', { param: 'employments' });
  if (sched === null && (kind === 'regular' || kind === 'termination')) {
    const sid = kind === 'termination' && empIds.length > 0 ? pr.scheduleOfEmployment(app, empIds[0], util.today(app, ent.id)) : ent.getString('default_pay_schedule');
    sched = util.byId(app, 'pay_schedules', sid);
    if (sched === null) throw util.fail(409, ent.getString('name') + ' has no pay schedule yet. Add one in Payroll, Schedules.', 'no_schedule');
  }
  let period;
  let info;
  const hol = {};
  if (kind === 'regular') {
    const given = util.day(p, 'period_start', '');
    if (given !== '') {
      period = pr.periodContaining(pr.schedObj(sched), given);
      if (period.start !== given) throw util.fail(400, given + ' is not the first day of a ' + sched.getString('name') + ' period (that period starts ' + period.start + ').', 'invalid_param', { param: 'period_start' });
    } else {
      const n = pr.nextPeriod(app, sched);
      if (n.run !== null) return { payrun: runView(app, app.findRecordById('payruns', n.run.id)), existing: true };
      period = { start: n.period_start, end: n.period_end };
    }
    const dup = util.findOne(app, 'payruns', "schedule = {:s} && kind = 'regular' && period_start = {:p} && status != 'void'", { s: sched.id, p: period.start });
    if (dup !== null) return { payrun: runView(app, dup), existing: true };
    info = pr.periodInfo(app, ent, sched, period, hol);
  } else if (kind === 'termination') {
    if (empIds.length !== 1) throw util.fail(400, 'A final pay run is for one person: give --employment.', 'missing_param', { param: 'employment' });
    const m = app.findRecordById('employments', empIds[0]);
    const last = util.day(p, 'last_day', m.getString('end_day'));
    if (last === '') throw util.fail(409, 'The employment has no last day yet. Approve the separation (or set the last day) first.', 'no_last_day');
    period = pr.periodContaining(pr.schedObj(sched), last);
    info = pr.periodInfo(app, ent, sched, period, hol);
    info.pay_date = util.day(p, 'pay_date', last > util.today(app, ent.id) ? last : util.today(app, ent.id));
    const open = util.findOne(app, 'payruns', "kind = 'termination' && status != 'void' && period_start = {:p} && scope ~ {:m}", { p: period.start, m: m.id });
    if (open !== null) return { payrun: runView(app, open), existing: true };
  } else if (kind === 'correction') {
    period = { start: corrects.getString('period_start'), end: corrects.getString('period_end') };
    info = { period_start: period.start, period_end: period.end, pay_date: util.day(p, 'pay_date', util.today(app, ent.id)), cutoff_day: '' };
    const inRun = util.rows(app, "SELECT employment FROM payslips WHERE payrun = {:r} AND status IN ('locked', 'published')", { employment: '' }, { r: corrects.id }).map((x) => x.employment);
    if (empIds.length === 0) throw util.fail(400, 'Choose who the correction is for (--employments ["E0001"]).', 'missing_param', { param: 'employments' });
    for (const id of empIds) if (inRun.indexOf(id) < 0) throw util.fail(400, 'Only people paid in ' + corrects.getString('number') + ' can be corrected.', 'invalid_param');
  } else {
    const today = util.today(app, ent.id);
    const ps = util.day(p, 'period_start', '');
    const pe = util.day(p, 'period_end', '');
    if (sched !== null && ps === '') {
      period = pr.periodContaining(pr.schedObj(sched), today);
    } else period = { start: ps || today.slice(0, 8) + '01', end: pe || util.monthEnd(ps || today) };
    if (period.end < period.start) throw util.fail(400, 'period_end is before period_start.', 'invalid_param');
    info = { period_start: period.start, period_end: period.end, pay_date: util.day(p, 'pay_date', today), cutoff_day: '' };
    if (kind !== 'reimbursement' && empIds.length === 0 && !util.bool(p, 'all', false)) throw util.fail(400, 'Choose who is paid (--employments ["E0001","E0002"]) or --all true.', 'missing_param', { param: 'employments' });
  }
  if (util.day(p, 'pay_date', '') !== '' && kind === 'regular') info.pay_date = util.day(p, 'pay_date', '');
  const options = util.obj(p, 'options') || {};
  util.keysOnly(options, ['jp_bonus_over_6_months', 'final_items_only'], 'options');
  let rec = null;
  app.runInTransaction((tx) => {
    rec = newRun(tx, {
      ctx: ctx,
      entity: ent,
      schedule: sched,
      kind: kind,
      label: util.text(p, 'label', 160, '') || labelOf(kind, period, sched && util.count(app, 'SELECT COUNT(*) AS n FROM pay_schedules WHERE entity = {:e} AND active = TRUE', { e: ent.id }) > 1 ? sched.getString('name') : ''),
      period_start: info.period_start,
      period_end: info.period_end,
      pay_date: info.pay_date,
      cutoff_day: info.cutoff_day || '',
      scope: { employments: empIds, all: util.bool(p, 'all', false), excluded: [] },
      options: options,
      note: util.text(p, 'note', 4000, ''),
      corrects: corrects ? corrects.id : '',
      year_end: util.bool(p, 'year_end', false),
    });
  });
  L('lib_audit').note(ctx, { collection: 'payruns', record: rec.id, summary: 'Started pay run ' + rec.getString('number') + ' (' + rec.getString('label') + ', pay day ' + rec.getString('pay_date') + ')' });
  return { payrun: runView(app, app.findRecordById('payruns', rec.id)), existing: false };
}

/** separation.approved: a draft final pay run for the leaver (changes nothing official). */
function draftTermination(ctx, employmentId, lastDay, separationId) {
  const util = u();
  const app = ctx.app;
  const m = util.byId(app, 'employments', employmentId);
  if (m === null) return null;
  const ent = app.findRecordById('entities', m.getString('entity'));
  const pr = L('lib_payroll');
  const sched = util.byId(app, 'pay_schedules', pr.scheduleOfEmployment(app, m.id, lastDay || util.today(app, ent.id)));
  if (sched === null || !util.isDay(lastDay || '')) return null;
  const period = pr.periodContaining(pr.schedObj(sched), lastDay);
  const open = util.findOne(app, 'payruns', "kind = 'termination' && status != 'void' && period_start = {:p} && scope ~ {:m}", { p: period.start, m: m.id });
  if (open !== null) return { payrun: open.id, existing: true };
  const rec = newRun(app, {
    ctx: ctx,
    entity: ent,
    schedule: sched,
    kind: 'termination',
    label: labelOf('termination', period, '') + ' ' + L('lib_people').displayName(app.findRecordById('employees', m.getString('employee'))),
    period_start: period.start,
    period_end: period.end,
    pay_date: lastDay,
    scope: { employments: [m.id], all: false, excluded: [], separation: separationId || '' },
    options: {},
    note: 'Opened when the separation was approved.',
  });
  L('lib_notify').toRole(app, 'payroll_admin', { kind: 'payroll', title: 'Final pay to prepare: ' + rec.getString('label'), body: '', link: '#/payroll/runs/' + rec.id, facts: [{ type: 'day', key: 'last_day', label: 'Last day', value: lastDay }, { type: 'range', key: 'period', label: 'Period', from: period.start, to: period.end }] });
  return { payrun: rec.id, existing: false };
}

/**
 * separation.changed: the last day of an approved separation moved. A final
 * pay run not locked yet moves to the new last day (its period, pay date and
 * label; back to draft); after lock nothing changes and payroll is told; with
 * no final pay run, one is drafted.
 */
function moveTermination(ctx, employmentId, lastDay, separationId) {
  const util = u();
  const app = ctx.app;
  const m = util.byId(app, 'employments', employmentId);
  if (m === null || !util.isDay(lastDay || '')) return null;
  const pr = L('lib_payroll');
  const runs = util.findMany(app, 'payruns', "kind = 'termination' && status != 'void' && scope ~ {:m}", '-created', 0, { m: m.id }).filter((r) => {
    const sc = util.jsonOf(r, 'scope', {}) || {};
    return (sc.employments || []).indexOf(m.id) >= 0 && (separationId === '' || sc.separation === separationId || (sc.separation || '') === '');
  });
  if (runs.length === 0) return draftTermination(ctx, employmentId, lastDay, separationId);
  const rec = runs[0];
  const who = L('lib_people').displayName(app.findRecordById('employees', m.getString('employee')));
  if (['locked', 'paid'].indexOf(rec.getString('status')) >= 0) {
    addNote(app, rec, m.id, { actor: 'system', kind: 'flag', severity: 'warning', code: 'last_day_moved', body: 'The last day of ' + who + ' moved to ' + lastDay + ' after this final pay run was locked. Pay what changed with a correction or another final pay run.' });
    L('lib_notify').toRole(app, 'payroll_admin', { kind: 'payroll', title: 'Last day moved after final pay: ' + who, body: 'New last day ' + lastDay + '; ' + rec.getString('number') + ' is ' + rec.getString('status') + '.', link: '#/payroll/runs/' + rec.id, facts: [{ type: 'day', key: 'last_day', label: 'New last day', value: lastDay }, { type: 'state', key: 'status', label: 'Final pay run', value: rec.getString('status') }, { type: 'text', key: 'payrun', label: 'Pay run', value: rec.getString('number') }] });
    return { payrun: rec.id, moved: false };
  }
  const sched = util.byId(app, 'pay_schedules', rec.getString('schedule') || pr.scheduleOfEmployment(app, m.id, lastDay));
  if (sched === null) return { payrun: rec.id, moved: false };
  const period = pr.periodContaining(pr.schedObj(sched), lastDay);
  if (rec.getString('approval') !== '') cancelApproval(app, ctx, rec, 'The last day moved to ' + lastDay + '.');
  rec.set('period_start', period.start);
  rec.set('period_end', period.end);
  rec.set('pay_date', lastDay);
  rec.set('label', labelOf('termination', period, '') + ' ' + who);
  rec.set('status', 'draft');
  app.save(rec);
  addNote(app, rec, null, { actor: 'system', kind: 'flag', severity: 'warning', code: 'last_day_moved', body: 'The last day moved to ' + lastDay + ': the run now pays ' + period.start + ' to ' + period.end + ' on ' + lastDay + '. Calculate it again.' });
  return { payrun: rec.id, moved: true };
}

/** The employments a run pays (its scope, or for a regular run everyone on the schedule in the period). */
function employmentsOf(app, rec) {
  const util = u();
  const pr = L('lib_payroll');
  const scope = util.jsonOf(rec, 'scope', {}) || {};
  const excluded = (scope.excluded || []).map((x) => (typeof x === 'string' ? x : x.employment));
  const kind = rec.getString('kind');
  const ps = rec.getString('period_start');
  const pe = rec.getString('period_end');
  if (kind === 'regular' || ((kind === 'reimbursement' || kind === 'bonus' || kind === 'off_cycle') && (scope.employments || []).length === 0)) {
    const all = L('lib_people').activeEmployments(app, { entity: rec.getString('entity'), from: ps, to: pe });
    const finals = util
      .rows(app, "SELECT scope FROM payruns WHERE entity = {:e} AND kind = 'termination' AND status != 'void' AND period_start = {:p}", { scope: '' }, { e: rec.getString('entity'), p: ps })
      .reduce((acc, r) => {
        try {
          return acc.concat((JSON.parse(r.scope || '{}') || {}).employments || []);
        } catch (e) {
          return acc;
        }
      }, []);
    return all
      .filter((m) => excluded.indexOf(m.id) < 0 && (kind !== 'regular' || finals.indexOf(m.id) < 0))
      .filter((m) => {
        if (kind !== 'regular' || rec.getString('schedule') === '') return true;
        const day = m.end_day !== '' && m.end_day < pe ? m.end_day : pe;
        return pr.scheduleOfEmployment(app, m.id, day < m.start_day ? m.start_day : day) === rec.getString('schedule');
      })
      .map((m) => m.id);
  }
  return (scope.employments || []).filter((id) => excluded.indexOf(id) < 0);
}

/* ----------------------------------------------------------- calculate */

/** Run calculation chunks until done or the time budget is spent; returns { done, progress }. */
function work(app, rec0, budgetMs, actorCtx) {
  const util = u();
  const calc = L('lib_payroll_calc');
  const started = Date.now();
  let rec = app.findRecordById('payruns', rec0.id);
  for (;;) {
    const scope = util.jsonOf(rec, 'scope', {}) || {};
    const todo = scope.todo || [];
    const prog = util.jsonOf(rec, 'progress', {}) || {};
    if (todo.length === 0) break;
    const chunk = todo.slice(0, CHUNK);
    const errors = prog.errors || [];
    app.runInTransaction((tx) => {
      const r = tx.findRecordById('payruns', rec.id);
      const rc = calc.runContext(tx, r);
      calc.prefetch(tx, rc, chunk);
      for (const id of chunk) {
        try {
          const res = calc.calcOne(tx, rc, id);
          if (res === null) util.exec(tx, 'DELETE FROM payslips WHERE payrun = {:r} AND employment = {:e}', { r: r.id, e: id });
        } catch (err) {
          console.error('[hr] payroll calculation of ' + id + ' failed:', err);
          errors.push({ employment: id, error: String((err && err.message) || err).slice(0, 300) });
        }
      }
      const sc = util.jsonOf(r, 'scope', {}) || {};
      sc.todo = (sc.todo || []).slice(chunk.length);
      r.set('scope', sc);
      const pg = util.jsonOf(r, 'progress', {}) || {};
      pg.done = (pg.done || 0) + chunk.length;
      pg.errors = errors.slice(0, 50);
      pg.lease_until = new Date(Date.now() + LEASE_MS).toISOString();
      pg.updated = util.nowIso();
      r.set('progress', pg);
      tx.save(r);
    });
    L('lib_bus').touch('payruns');
    L('lib_bus').flush(app);
    rec = app.findRecordById('payruns', rec.id);
    if (Date.now() - started > budgetMs) break;
  }
  const scope = util.jsonOf(rec, 'scope', {}) || {};
  if ((scope.todo || []).length === 0) {
    finish(app, rec, actorCtx);
    rec = app.findRecordById('payruns', rec.id);
    return { done: true, progress: util.jsonOf(rec, 'progress', {}) || {} };
  }
  return { done: false, progress: util.jsonOf(rec, 'progress', {}) || {} };
}

/** Totals, issue counts and the variance summary once every payslip is calculated. */
function finish(app, rec0, actorCtx) {
  const util = u();
  app.runInTransaction((tx) => {
    const rec = tx.findRecordById('payruns', rec0.id);
    const t = util.one(
      tx,
      'SELECT COUNT(*) AS n, CAST(COALESCE(SUM(gross_minor), 0) AS INTEGER) AS gross, CAST(COALESCE(SUM(deductions_minor), 0) AS INTEGER) AS ded, CAST(COALESCE(SUM(employer_minor), 0) AS INTEGER) AS er, CAST(COALESCE(SUM(reimbursement_minor), 0) AS INTEGER) AS reimb, CAST(COALESCE(SUM(net_minor), 0) AS INTEGER) AS net FROM payslips WHERE payrun = {:r}',
      { n: 0, gross: 0, ded: 0, er: 0, reimb: 0, net: 0 },
      { r: rec.id },
    );
    rec.set('employee_count', t.n);
    rec.set('gross_minor', t.gross);
    rec.set('deductions_minor', t.ded);
    rec.set('employer_minor', t.er);
    rec.set('reimbursement_minor', t.reimb);
    rec.set('net_minor', t.net);
    rec.set('issues', issueSummary(tx, rec));
    rec.set('variance', varianceSummary(tx, rec));
    const pg = util.jsonOf(rec, 'progress', {}) || {};
    pg.finished = util.nowIso();
    pg.lease_until = '';
    rec.set('progress', pg);
    rec.set('calc_ms', pg.started_ms ? Date.now() - pg.started_ms : 0);
    rec.set('calculated_at', util.nowIso());
    rec.set('status', 'calculated');
    tx.save(rec);
  });
  L('lib_bus').touch('payruns');
}

/** Issues about paying out (not the calculation): they stop blocking while the person's pay is held. */
const PAYOUT_CODES = { bank_missing: true, bank_currency_mismatch: true, bank_changed_recently: true };

function slipIssues(app, runId) {
  const util = u();
  const out = [];
  for (const r of util.rows(app, 'SELECT s.id AS id, s.employment AS employment, s.issues AS issues, s.held AS held, e.number AS number, e.legal_name AS legal_name, e.preferred_name AS preferred_name FROM payslips s JOIN employees e ON e.id = s.employee WHERE s.payrun = {:r} ORDER BY e.number', { id: '', employment: '', issues: '', held: false, number: '', legal_name: '', preferred_name: '' }, { r: runId })) {
    let list = [];
    try {
      list = JSON.parse(r.issues || '[]') || [];
    } catch (e) {
      list = [];
    }
    for (const i of list) {
      const o = Object.assign({}, i, { payslip: r.id, employment: r.employment, number: r.number, name: r.preferred_name || r.legal_name });
      // Held pay is not paid out with this run: a missing or new bank account waits for the release.
      if (r.held && PAYOUT_CODES[i.code]) o.severity = 'held';
      out.push(o);
    }
  }
  return out;
}

/**
 * Opening balances missing (QA3): each person's payslip keeps its own blocker
 * (`opening_balances_missing`), the run shows them as ONE blocker for the
 * entity with the people in it, first in the list.
 */
function foldOpenings(list) {
  const mine = list.filter((i) => i.code === 'opening_balances_missing');
  if (mine.length === 0) return list;
  const first = mine[0];
  const days = mine.map((i) => i.day || '').filter((d) => d !== '').sort();
  const one = {
    severity: 'blocker',
    code: 'opening_balances_missing',
    message: mine.length + (mine.length === 1 ? ' person was' : ' people were') + ' employed before HR OS this tax year. Add what was paid to them so far (opening balances), or confirm that nobody was paid earlier this tax year.',
    entity: first.entity || '',
    payrun: first.payrun || '',
    from: first.from || '',
    day: days.length > 0 ? days[0] : '',
    n: mine.length,
    people: mine.map((i) => ({ employment: i.employment, number: i.number, name: i.name })),
    fix: first.fix,
  };
  return [one].concat(list.filter((i) => i.code !== 'opening_balances_missing'));
}

function ackKey(i) {
  return (i.employment || '') + ':' + i.code + (i.field ? ':' + i.field : '');
}

function issueSummary(app, rec) {
  const util = u();
  const all = foldOpenings(slipIssues(app, rec.id));
  const ack = util.jsonOf(rec, 'acknowledged', {}) || {};
  const byCode = {};
  let blockers = 0;
  let warnings = 0;
  let unack = 0;
  for (const i of all) {
    if (i.severity === 'held') continue;
    if (i.severity === 'blocker') blockers++;
    else {
      warnings++;
      if (!ack[ackKey(i)]) unack++;
    }
    const k = i.code;
    if (byCode[k] === undefined) byCode[k] = { code: k, severity: i.severity, count: 0 };
    byCode[k].count++;
  }
  return { blockers: blockers, warnings: warnings, unacknowledged: unack, by_code: Object.keys(byCode).map((k) => byCode[k]) };
}

/** The previous regular run of the same schedule (locked or paid, earlier period). */
function previousRun(app, rec) {
  const util = u();
  if (rec.getString('schedule') === '') return null;
  const r = util.findMany(app, 'payruns', "schedule = {:s} && kind = 'regular' && (status = 'locked' || status = 'paid') && period_start < {:p}", '-period_start', 1, { s: rec.getString('schedule'), p: rec.getString('period_start') });
  return r.length > 0 ? r[0] : null;
}

function varianceSummary(app, rec) {
  const prev = previousRun(app, rec);
  if (prev === null) return { previous: null };
  return {
    previous: { id: prev.id, number: prev.getString('number'), pay_date: prev.getString('pay_date') },
    gross_minor: rec.getInt('gross_minor') - prev.getInt('gross_minor'),
    net_minor: rec.getInt('net_minor') - prev.getInt('net_minor'),
    employer_minor: rec.getInt('employer_minor') - prev.getInt('employer_minor'),
    deductions_minor: rec.getInt('deductions_minor') - prev.getInt('deductions_minor'),
    headcount: rec.getInt('employee_count') - prev.getInt('employee_count'),
  };
}

/** payruns.calculate: calculate (or recalculate) a run in chunks; progress shows live; call again with --continue to go on. */
function calculate(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rec = runRef(app, util.req(p, 'payrun'));
  needRun(ctx, rec, 'edit', 'calculate pay runs');
  assertOpen(rec, 'calculate');
  const prog = util.jsonOf(rec, 'progress', {}) || {};
  if (rec.getString('status') === 'calculating') {
    const lease = Date.parse(prog.lease_until || '');
    if (!Number.isNaN(lease) && lease > Date.now() && !util.bool(p, 'continue', false)) return { payrun: runView(app, rec), done: false, progress: prog, busy: true };
  } else {
    const only = (util.list(p, 'employments') || []).map((ref) => L('lib_people').employmentRef(app, String(ref)).id);
    app.runInTransaction((tx) => {
      const r = tx.findRecordById('payruns', rec.id);
      L('lib_payroll').syncExitComponent(tx, tx.findRecordById('entities', r.getString('entity')), r.getString('pay_date'));
      const ids = employmentsOf(tx, r);
      const todo = only.length > 0 ? only.filter((x) => ids.indexOf(x) >= 0) : ids;
      // People no longer in the run lose their draft payslips.
      const keep = {};
      for (const id of ids) keep[id] = true;
      for (const s of util.findMany(tx, 'payslips', 'payrun = {:r}', '', 0, { r: r.id })) if (!keep[s.getString('employment')]) tx.delete(s);
      if (r.getString('approval') !== '') cancelApproval(tx, ctx, r, 'The run was recalculated.');
      const sc = util.jsonOf(r, 'scope', {}) || {};
      sc.todo = todo;
      r.set('scope', sc);
      r.set('status', 'calculating');
      r.set('version', r.getInt('version') + 1);
      r.set('progress', { total: todo.length, done: 0, errors: [], started: util.nowIso(), started_ms: Date.now(), lease_until: new Date(Date.now() + LEASE_MS).toISOString(), version: r.getInt('version') });
      tx.save(r);
    });
  }
  const res = work(app, rec, BUDGET_MS, ctx);
  const fresh = app.findRecordById('payruns', rec.id);
  L('lib_audit').note(ctx, { collection: 'payruns', record: rec.id, summary: (res.done ? 'Calculated' : 'Calculating') + ' pay run ' + fresh.getString('number') + ' (' + (res.progress.done || 0) + ' of ' + (res.progress.total || 0) + ' payslips)' });
  return { payrun: runView(app, fresh), done: res.done, progress: res.progress };
}

/** Cron (every minute): go on with a calculation whose worker stopped (its lease ran out). */
function cronContinue(app) {
  const util = u();
  for (const r of util.findMany(app, 'payruns', "status = 'calculating'", 'created', 5)) {
    const prog = util.jsonOf(r, 'progress', {}) || {};
    const lease = Date.parse(prog.lease_until || '');
    if (!Number.isNaN(lease) && lease > Date.now()) continue;
    try {
      work(app, r, 40000, L('lib_auth').systemCtx(app));
    } catch (err) {
      console.error('[hr] payroll calculation (cron) failed:', err);
    }
  }
}

/* ----------------------------------------------------- issues, variance */

function issuesOp(ctx, p) {
  const util = u();
  const rec = runRef(ctx.app, util.req(p, 'payrun'));
  needRun(ctx, rec, 'view');
  const ack = util.jsonOf(rec, 'acknowledged', {}) || {};
  const emp = util.str(p, 'employment', '');
  const raw = slipIssues(ctx.app, rec.id);
  let all = (emp !== '' ? raw : foldOpenings(raw)).map((i) => Object.assign(i, { key: ackKey(i), acknowledged: ack[ackKey(i)] || null }));
  const sev = util.str(p, 'severity', '');
  if (sev !== '') all = all.filter((i) => i.severity === sev);
  if (emp !== '') all = all.filter((i) => i.employment === emp);
  const rank = { blocker: 0, warning: 1, held: 2 };
  all.sort((a, b) => (a.severity === b.severity ? ((a.number || '') < (b.number || '') ? -1 : 1) : (rank[a.severity] || 1) - (rank[b.severity] || 1)));
  return { payrun: rec.id, issues: all, summary: issueSummary(ctx.app, rec) };
}

function acknowledge(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rec = runRef(app, util.req(p, 'payrun'));
  needRun(ctx, rec, 'edit', 'acknowledge warnings');
  assertOpen(rec, 'acknowledge');
  const reason = util.oneOf(p, 'reason', ACK_REASONS, '');
  if (reason === '') throw util.fail(400, 'reason is one of: ' + ACK_REASONS.join(', '), 'missing_param', { param: 'reason' });
  const note = util.text(p, 'note', 1000, '');
  if (reason === 'other' && note === '') throw util.fail(400, 'Say why in --note when the reason is other.', 'missing_param', { param: 'note' });
  const keys = util.list(p, 'keys');
  const all = slipIssues(app, rec.id).filter((i) => i.severity === 'warning');
  const pick = keys === undefined || keys.length === 0 ? all : all.filter((i) => keys.indexOf(ackKey(i)) >= 0);
  const ack = util.jsonOf(rec, 'acknowledged', {}) || {};
  for (const i of pick) ack[ackKey(i)] = { by: ctx.memberId, by_name: ctx.name, at: util.nowIso(), reason: reason, note: note };
  rec.set('acknowledged', ack);
  rec.set('issues', issueSummary(app, rec));
  app.save(rec);
  L('lib_audit').note(ctx, { collection: 'payruns', record: rec.id, summary: 'Acknowledged ' + pick.length + ' warning' + (pick.length === 1 ? '' : 's') + ' on ' + rec.getString('number') + ' (' + reason.replace(/_/g, ' ') + ')' });
  return { acknowledged: pick.length, summary: issueSummary(app, app.findRecordById('payruns', rec.id)) };
}

/** payruns.variance: run over run by employee and by component, the biggest changes first, with reasons. */
function varianceOp(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rec = runRef(app, util.req(p, 'payrun'));
  needRun(ctx, rec, 'view');
  const prev = previousRun(app, rec);
  const byEmp = slipRows(app, rec, {})
    .map((r) => ({ payslip: r.id, employment: r.employment, number: r.number, name: r.name, net_minor: r.net_minor, gross_minor: r.gross_minor, prev_net_minor: r.variance.prev_net_minor || 0, delta_net_minor: r.variance.delta_net_minor || 0, delta_gross_minor: r.variance.delta_gross_minor || 0, pct: r.variance.pct === undefined ? null : r.variance.pct, reasons: r.variance.reasons || [] }))
    .sort((a, b) => Math.abs(b.delta_net_minor) - Math.abs(a.delta_net_minor));
  const sums = (runId) =>
    util.rows(app, 'SELECT code, kind, stage, MAX(name) AS name, CAST(COALESCE(SUM(amount_minor), 0) AS INTEGER) AS amt FROM payslip_lines WHERE payrun = {:r} GROUP BY code, kind, stage', { code: '', kind: '', stage: '', name: '', amt: 0 }, { r: runId });
  const now = {};
  for (const r of sums(rec.id)) now[r.code + '|' + r.kind] = r;
  const before = {};
  if (prev !== null) for (const r of sums(prev.id)) before[r.code + '|' + r.kind] = r;
  const keys = Object.keys(now).concat(Object.keys(before).filter((k) => now[k] === undefined));
  const all = keys.map((k) => {
    const a = now[k];
    const b = before[k];
    const x = a || b;
    return { code: x.code, name: x.name, kind: x.kind, stage: x.stage, this_minor: a ? a.amt : 0, prev_minor: b ? b.amt : 0, delta_minor: (a ? a.amt : 0) - (b ? b.amt : 0), added: !b, removed: !a };
  });
  const kindOrder = { earning: 0, deduction: 1, reimbursement: 2, employer: 3, info: 4 };
  all.sort((a, b) => (kindOrder[a.kind] - kindOrder[b.kind]) || (a.stage < b.stage ? -1 : a.stage > b.stage ? 1 : 0) || (a.code < b.code ? -1 : 1));
  const byComp = keys
    .map((k) => {
      const a = now[k];
      const b = before[k];
      const x = a || b;
      return { code: x.code, name: x.name, kind: x.kind, stage: x.stage, this_minor: a ? a.amt : 0, prev_minor: b ? b.amt : 0, delta_minor: (a ? a.amt : 0) - (b ? b.amt : 0), added: !b, removed: !a };
    })
    .filter((x) => x.delta_minor !== 0 || x.added || x.removed)
    .sort((a, b) => Math.abs(b.delta_minor) - Math.abs(a.delta_minor));
  const tot = (r) => (r ? { gross_minor: r.getInt('gross_minor'), deductions_minor: r.getInt('deductions_minor'), employer_minor: r.getInt('employer_minor'), net_minor: r.getInt('net_minor'), headcount: r.getInt('employee_count') } : null);
  const thresholdPct = L('lib_payroll').settingsView(app, L('lib_payroll').ensureSettings(app, app.findRecordById('entities', rec.getString('entity'))), app.findRecordById('entities', rec.getString('entity'))).variance_pct;
  return { payrun: rec.id, previous: prev ? { id: prev.id, number: prev.getString('number'), pay_date: prev.getString('pay_date'), label: prev.getString('label') } : null, totals: { this: tot(rec), prev: tot(prev) }, by_employee: byEmp, by_component: byComp, components: all, threshold_pct: thresholdPct };
}

/* ------------------------------------------------------------ approval */

function cancelApproval(app, ctx, rec, why) {
  const util = u();
  const a = util.byId(app, 'approvals', rec.getString('approval'));
  if (a !== null && a.getString('status') === 'pending') L('lib_approvals').cancel(L('lib_auth').systemCtx(app), a.id, why);
  rec.set('approval', '');
}

/** payruns.submit: ask for approval (the run's entity flow). Blockers stop it; warnings need an acknowledgement first. */
function submit(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rec = runRef(app, util.req(p, 'payrun'));
  needRun(ctx, rec, 'edit', 'send pay runs for approval');
  if (rec.getString('status') !== 'calculated') throw util.fail(409, 'Calculate the run first (it is ' + rec.getString('status') + ').', 'not_calculated');
  const sum = issueSummary(app, rec);
  if (sum.blockers > 0) throw util.fail(409, sum.blockers + ' blocker' + (sum.blockers === 1 ? '' : 's') + ' must be fixed first (payruns.issues).', 'blockers', { blockers: sum.blockers });
  const ent = app.findRecordById('entities', rec.getString('entity'));
  const st = L('lib_payroll').settingsView(app, L('lib_payroll').ensureSettings(app, ent), ent);
  if (st.warnings_need_ack && sum.unacknowledged > 0) throw util.fail(409, sum.unacknowledged + ' warning' + (sum.unacknowledged === 1 ? '' : 's') + ' need an acknowledgement with a reason (payruns.acknowledge).', 'unacknowledged', { warnings: sum.unacknowledged });
  if (rec.getInt('employee_count') === 0) throw util.fail(409, 'The run pays nobody.', 'empty_run');
  if (rec.getString('approval') !== '') {
    const a0 = util.byId(app, 'approvals', rec.getString('approval'));
    if (a0 !== null && a0.getString('status') === 'pending') return { payrun: runView(app, rec), approval: L('lib_approvals').view(app, a0), existing: true };
  }
  let approval = null;
  app.runInTransaction((tx) => {
    const t = L('lib_auth').withApp(ctx, tx);
    const r = tx.findRecordById('payruns', rec.id);
    const po = payoutTotals(tx, r);
    const cur = r.getString('currency');
    const facts = [
      { type: 'text', key: 'payrun', label: 'Pay run', value: r.getString('label') !== '' ? r.getString('label') : r.getString('number') },
      { type: 'range', key: 'period', label: 'Period', from: r.getString('period_start'), to: r.getString('period_end') },
      { type: 'money', key: 'to_pay', label: 'Net to pay', amount_minor: po.to_pay_minor, currency: cur },
      { type: 'number', key: 'people', label: 'People paid', value: po.to_pay_count, unit: po.to_pay_count === 1 ? 'person' : 'people' },
    ];
    if (po.held_count > 0) {
      facts.push({ type: 'money', key: 'held', label: 'Held, not paid with this run', amount_minor: po.held_minor, currency: cur });
      facts.push({ type: 'number', key: 'held_people', label: 'People held', value: po.held_count, unit: po.held_count === 1 ? 'person' : 'people' });
    }
    if (po.released_count > 0) facts.push({ type: 'money', key: 'released', label: 'Held pay released into it', amount_minor: po.released_minor, currency: cur });
    facts.push({ type: 'day', key: 'pay_day', label: 'Pay day', value: r.getString('pay_date') });
    approval = L('lib_approvals').open(t, {
      kind: 'payrun',
      ref_collection: 'payruns',
      ref_id: r.id,
      entity: r.getString('entity'),
      summary: 'Pay run ' + r.getString('label') + ' (' + r.getString('number') + '): ' + po.to_pay_count + (po.to_pay_count === 1 ? ' person' : ' people') + ' paid' + (po.held_count > 0 ? ', ' + po.held_count + ' held' : ''),
      amount_minor: po.to_pay_minor,
      currency: cur,
      facts: facts,
      payload: { payrun: r.id, number: r.getString('number'), label: r.getString('label'), version: r.getInt('version'), employee_count: r.getInt('employee_count'), gross_minor: r.getInt('gross_minor'), employer_minor: r.getInt('employer_minor'), net_minor: r.getInt('net_minor'), to_pay_minor: po.to_pay_minor, to_pay_count: po.to_pay_count, held_minor: po.held_minor, held_count: po.held_count, released_minor: po.released_minor, pay_date: r.getString('pay_date'), warnings: sum.warnings },
      due: r.getString('cutoff_day'),
    });
    const r2 = tx.findRecordById('payruns', rec.id);
    if (r2.getString('status') === 'calculated') {
      r2.set('approval', approval.id);
      tx.save(r2);
    }
    t.audited = true;
    L('lib_audit').write(t, { op: 'payruns.submit', collection: 'payruns', record: rec.id, summary: 'Sent pay run ' + r.getString('number') + ' for approval' });
  });
  ctx.audited = true;
  return { payrun: runView(app, app.findRecordById('payruns', rec.id)), approval: approval };
}

/** Approval subscriber (kind payrun): approved -> the run is approved (only the version that was sent). */
function onPayrunDecision(ctx, approval, decision, note) {
  const util = u();
  const app = ctx.app;
  const rec = util.byId(app, 'payruns', approval.ref_id);
  if (rec === null) return;
  if (decision === 'approved') {
    if (rec.getString('status') !== 'calculated' || rec.getInt('version') !== Number(approval.payload.version)) throw util.fail(409, 'The pay run changed after it was sent for approval. Send it again.', 'stale');
    rec.set('status', 'approved');
    rec.set('approval', approval.id);
    app.save(rec);
    addNote(app, rec, null, { actor: 'person', member: ctx.memberId, kind: 'note', body: 'Approved by ' + (ctx.name || 'an approver') + (note ? ': ' + note : '') + '.' });
  } else {
    if (rec.getString('approval') === approval.id) rec.set('approval', '');
    app.save(rec);
    if (decision === 'rejected') addNote(app, rec, null, { actor: 'person', member: ctx.memberId, kind: 'flag', severity: 'warning', code: 'approval_rejected', body: 'Not approved by ' + (ctx.name || 'an approver') + (note ? ': ' + note : '') + '.' });
  }
}

/** payruns.reopen: back to draft (cancels a pending approval); results stay until recalculated. */
function reopen(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rec = runRef(app, util.req(p, 'payrun'));
  needRun(ctx, rec, 'edit', 'reopen pay runs');
  assertOpen(rec, 'reopen');
  app.runInTransaction((tx) => {
    const r = tx.findRecordById('payruns', rec.id);
    if (r.getString('approval') !== '') cancelApproval(tx, ctx, r, util.text(p, 'note', 1000, '') || 'Reopened for changes.');
    r.set('status', 'draft');
    tx.save(r);
  });
  L('lib_audit').note(ctx, { collection: 'payruns', record: rec.id, summary: 'Reopened pay run ' + rec.getString('number') + ' for changes' });
  return { payrun: runView(app, app.findRecordById('payruns', rec.id)) };
}

/**
 * A lock or void changes the year to date of the run's people: their other
 * calculated or approved runs go back to draft (their history is stale).
 */
function staleOthers(app, ctx, runRec, why) {
  const util = u();
  for (const x of util.rows(app, "SELECT DISTINCT o.id AS id FROM payruns o JOIN payslips s ON s.payrun = o.id WHERE o.id != {:r} AND o.status IN ('calculated', 'approved') AND s.employment IN (SELECT employment FROM payslips WHERE payrun = {:r})", { id: '' }, { r: runRec.id })) {
    const rec = app.findRecordById('payruns', x.id);
    if (rec.getString('approval') !== '') cancelApproval(app, ctx, rec, why);
    rec.set('status', 'draft');
    app.save(rec);
    addNote(app, rec, null, { actor: 'system', kind: 'flag', severity: 'warning', code: 'history_changed', body: why + ' Calculate this run again.' });
  }
}

/** A change to someone's pay inputs sends their open runs (or only `runId`, for an input of that run) back to draft (results are stale). */
function staleFor(app, ctx, employmentId, why, runId) {
  const util = u();
  for (const r of util.rows(app, "SELECT DISTINCT r.id AS id FROM payruns r JOIN payslips s ON s.payrun = r.id WHERE s.employment = {:e} AND r.status IN ('calculated', 'approved') AND ({:only} = '' OR r.id = {:only})", { id: '' }, { e: employmentId, only: runId || '' })) {
    const rec = app.findRecordById('payruns', r.id);
    if (rec.getString('approval') !== '') cancelApproval(app, ctx, rec, why);
    rec.set('status', 'draft');
    app.save(rec);
  }
}

/* ------------------------------------------------------------------ lock */

function publishAt(app, rec) {
  const util = u();
  const ent = app.findRecordById('entities', rec.getString('entity'));
  const st = L('lib_payroll').settingsView(app, L('lib_payroll').ensureSettings(app, ent), ent);
  if (st.publish === 'manual') return '';
  if (st.publish === 'immediate') return util.nowIso();
  const ms = util.utcOf(ent.getString('timezone') || 'UTC', rec.getString('pay_date'), util.pad(st.publish_hour) + ':00');
  return new Date(Math.max(ms, Date.now())).toISOString();
}

/** payruns.lock: freeze an approved run with your PIN; payslips become immutable and the run's effects happen in one go. */
function lock(ctx, p) {
  const util = u();
  const app = ctx.app;
  const engine = L('lib_engine');
  const rec = runRef(app, util.req(p, 'payrun'));
  needRun(ctx, rec, 'full', 'lock pay runs');
  if (rec.getString('status') !== 'approved') throw util.fail(409, 'Only an approved run can be locked (this one is ' + rec.getString('status') + ').', 'not_approved');
  const sum = issueSummary(app, rec);
  if (sum.blockers > 0) throw util.fail(409, 'The run has blockers.', 'blockers');
  let count = 0;
  app.runInTransaction((tx) => {
    const t = L('lib_auth').withApp(ctx, tx);
    const r = tx.findRecordById('payruns', rec.id);
    const kind = r.getString('kind');
    const slips = util.findMany(tx, 'payslips', 'payrun = {:r}', 'employment', 0, { r: r.id });
    const hashes = [];
    const inputs = [];
    const expenseRefs = [];
    const encash = [];
    for (const s of slips) {
      if (s.getString('status') !== 'calculated') throw util.fail(409, 'A payslip is ' + s.getString('status') + '; recalculate the run.', 'stale');
      const ih = util.sha(engine.stableStringify(util.jsonOf(s, 'input', {})));
      if (ih !== s.getString('input_hash')) throw util.fail(409, 'A payslip input changed after calculation; recalculate the run.', 'stale');
      s.set('status', 'locked');
      tx.save(s);
      hashes.push(s.getString('employment') + ':' + s.getString('hash') + ':' + s.getInt('net_minor'));
      inputs.push(ih);
      count++;
      for (const l of util.findMany(tx, 'payslip_lines', "payslip = {:p} && source = 'input' && ref != ''", 'sort', 0, { p: s.id })) {
        const rk = l.getString('ref_kind');
        if (rk === 'pay_input') {
          const pi = util.byId(tx, 'pay_inputs', l.getString('ref'));
          if (pi !== null) {
            pi.set('status', 'used');
            pi.set('payrun', r.id);
            tx.save(pi);
          }
        } else if (rk === 'loan') {
          const ln = util.byId(tx, 'loans', l.getString('ref'));
          if (ln !== null) {
            const rp = util.newRecord(tx, 'loan_repayments');
            rp.set('loan', ln.id);
            rp.set('employment', s.getString('employment'));
            rp.set('payrun', r.id);
            rp.set('payslip', s.id);
            rp.set('day', r.getString('pay_date'));
            rp.set('amount_minor', l.getInt('amount_minor'));
            rp.set('kind', 'payroll');
            rp.set('note', r.getString('number'));
            tx.save(rp);
            const bal = ln.getInt('balance_minor') - l.getInt('amount_minor');
            ln.set('balance_minor', bal);
            if (bal <= 0) ln.set('status', 'closed');
            tx.save(ln);
          }
        } else if (rk === 'claim' || rk === 'advance_payout') {
          if (expenseRefs.indexOf(l.getString('ref')) < 0) expenseRefs.push(l.getString('ref'));
        } else if (rk === 'advance') expenseRefs.push({ advance: l.getString('ref'), amount_minor: l.getInt('amount_minor') });
        else if (rk === 'encash') encash.push(l.getString('ref'));
      }
      for (const h of util.findMany(tx, 'salary_holds', "payrun = {:r} && employment = {:e} && status = 'held'", '', 0, { r: r.id, e: s.getString('employment') })) {
        h.set('payslip', s.id);
        h.set('amount_minor', s.getInt('net_minor'));
        h.set('currency', s.getString('currency'));
        tx.save(h);
      }
      if (kind === 'regular' || kind === 'termination') {
        const m = tx.findRecordById('employments', s.getString('employment'));
        const from = m.getString('start_day') > r.getString('period_start') ? m.getString('start_day') : r.getString('period_start');
        let to = m.getString('end_day') !== '' && m.getString('end_day') < r.getString('period_end') ? m.getString('end_day') : r.getString('period_end');
        // Only days up to the run's input cutoff lock: later days stay open for punches (time pays changes as adjustments).
        if (r.getString('cutoff_day') !== '' && r.getString('cutoff_day') < to) to = r.getString('cutoff_day');
        if (from <= to) L('lib_time').lockDays(tx, m.id, from, to, r.id);
      }
    }
    if (expenseRefs.length > 0) L('lib_expenses').markPaid(tx, expenseRefs, r.id);
    if (encash.length > 0) L('lib_leave').markEncashPaid(tx, encash, r.id);
    hashes.sort();
    inputs.sort();
    r.set('hash', util.sha(hashes.join('\n')));
    r.set('input_hash', util.sha(inputs.join('\n')));
    r.set('status', 'locked');
    r.set('locked_by', ctx.memberId);
    r.set('locked_at', util.nowIso());
    r.set('publish_at', publishAt(tx, r));
    tx.save(r);
    staleOthers(tx, ctx, r, r.getString('number') + ' was locked: its payslips are now in the year to date of the same people.');
    addNote(tx, r, null, { actor: 'person', member: ctx.memberId, kind: 'note', body: 'Locked by ' + ctx.name + ' with the approval PIN: ' + count + ' payslips, fingerprint ' + r.getString('hash').slice(0, 12) + '.' });
    L('lib_audit').write(t, { op: 'payruns.lock', collection: 'payruns', record: r.id, summary: 'Locked pay run ' + r.getString('number') + ' (' + count + ' payslips, net ' + L('lib_money').format(r.getInt('net_minor'), r.getString('currency')) + ')', after: { hash: r.getString('hash'), input_hash: r.getString('input_hash') } });
  });
  ctx.audited = true;
  const events = L('lib_events').emit(ctx, 'payrun.locked', { payrun: rec.id });
  const fresh = app.findRecordById('payruns', rec.id);
  if (fresh.getString('publish_at') !== '' && Date.parse(fresh.getString('publish_at')) <= Date.now() + 1000) publishRun(app, fresh, ctx);
  return { payrun: runView(app, app.findRecordById('payruns', rec.id)), events: events };
}

/* ----------------------------------------------------------- publish */

/** Publish a locked run's payslips: employees see them and get a notice (no amounts in it). */
function publishRun(app, rec, ctx) {
  const util = u();
  const ent = app.findRecordById('entities', rec.getString('entity'));
  const st = L('lib_payroll').settingsView(app, L('lib_payroll').ensureSettings(app, ent), ent);
  let n = 0;
  app.runInTransaction((tx) => {
    const r = tx.findRecordById('payruns', rec.id);
    if (r.getString('published_at') !== '') return;
    for (const s of util.findMany(tx, 'payslips', "payrun = {:r} && status = 'locked'", '', 0, { r: r.id })) {
      s.set('status', 'published');
      s.set('published_at', util.nowIso());
      s.set('notified_at', util.nowIso());
      tx.save(s);
      L('lib_notify').toEmployee(tx, s.getString('employee'), { kind: 'payslip', title: 'Your payslip for ' + r.getString('period_start') + ' to ' + r.getString('period_end') + ' is ready', body: 'Pay day ' + r.getString('pay_date') + '.', link: '#/payroll/payslip/' + s.id, email: st.email_payslips, facts: [{ type: 'range', key: 'period', label: 'Period', from: r.getString('period_start'), to: r.getString('period_end') }, { type: 'day', key: 'pay_date', label: 'Pay day', value: r.getString('pay_date') }] });
      n++;
    }
    r.set('published_at', util.nowIso());
    if (r.getString('publish_at') === '') r.set('publish_at', util.nowIso());
    tx.save(r);
  });
  L('lib_bus').touch('payslips');
  return n;
}

function publish(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rec = runRef(app, util.req(p, 'payrun'));
  needRun(ctx, rec, 'full', 'publish payslips');
  if (rec.getString('status') !== 'locked' && rec.getString('status') !== 'paid') throw util.fail(409, 'Only a locked run publishes payslips.', 'not_locked');
  const at = util.str(p, 'at', '');
  if (at !== '') {
    const ms = Date.parse(at);
    if (Number.isNaN(ms)) throw util.fail(400, 'at is a date and time (ISO), e.g. 2026-11-25T07:00:00+08:00', 'invalid_param');
    rec.set('publish_at', new Date(ms).toISOString());
    app.save(rec);
    L('lib_audit').note(ctx, { collection: 'payruns', record: rec.id, summary: 'Payslips of ' + rec.getString('number') + ' will be published at ' + rec.getString('publish_at') });
    return { payrun: runView(app, rec), published: 0 };
  }
  const n = publishRun(app, rec, ctx);
  L('lib_audit').note(ctx, { collection: 'payruns', record: rec.id, summary: 'Published ' + n + ' payslips of ' + rec.getString('number') });
  return { payrun: runView(app, app.findRecordById('payruns', rec.id)), published: n };
}

/** Cron (every 15 minutes): publish runs whose time has come (the entity's local publication hour on pay day). */
function cronPublish(app) {
  const util = u();
  let n = 0;
  for (const r of util.findMany(app, 'payruns', "(status = 'locked' || status = 'paid') && published_at = '' && publish_at != '' && publish_at <= {:t}", 'publish_at', 50, { t: util.nowIso() })) {
    try {
      n += publishRun(app, r, L('lib_auth').systemCtx(app));
    } catch (err) {
      console.error('[hr] payslip publication failed for ' + r.getString('number') + ':', err);
    }
  }
  L('lib_bus').flush(app);
  return n;
}

/* --------------------------------------------------------- void, paid */

/** payruns.void: withdraw a locked, unpaid run with a reason and your PIN; a linked draft replaces it with the same inputs. */
function voidRun(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rec = runRef(app, util.req(p, 'payrun'));
  needRun(ctx, rec, 'full', 'void pay runs');
  if (rec.getString('status') !== 'locked') throw util.fail(409, rec.getString('status') === 'paid' ? 'A paid run is never voided: make a correction run.' : 'Only a locked run can be voided (this one is ' + rec.getString('status') + ').', 'not_locked');
  const reason = util.text(p, 'reason', 1000, '');
  if (reason === '') throw util.fail(400, 'reason is required: say what was wrong.', 'missing_param', { param: 'reason' });
  let repl = null;
  app.runInTransaction((tx) => {
    const t = L('lib_auth').withApp(ctx, tx);
    const r = tx.findRecordById('payruns', rec.id);
    const ent = tx.findRecordById('entities', r.getString('entity'));
    const sched = r.getString('schedule') !== '' ? util.byId(tx, 'pay_schedules', r.getString('schedule')) : null;
    const scope = util.jsonOf(r, 'scope', {}) || {};
    delete scope.todo;
    repl = newRun(tx, {
      ctx: ctx,
      entity: ent,
      schedule: sched,
      kind: r.getString('kind'),
      label: r.getString('label') + ' (replaces ' + r.getString('number') + ')',
      period_start: r.getString('period_start'),
      period_end: r.getString('period_end'),
      pay_date: r.getString('pay_date'),
      cutoff_day: r.getString('cutoff_day'),
      scope: scope,
      options: util.jsonOf(r, 'options', {}) || {},
      note: 'Replaces ' + r.getString('number') + ', voided: ' + reason,
      corrects: r.getString('corrects'),
      replaces: r.id,
      year_end: r.getBool('year_end'),
    });
    for (const s of util.findMany(tx, 'payslips', 'payrun = {:r}', '', 0, { r: r.id })) {
      for (const l of util.findMany(tx, 'payslip_lines', "payslip = {:p} && source = 'input' && ref != ''", 'sort', 0, { p: s.id })) {
        const rk = l.getString('ref_kind');
        if (rk === 'encash') {
          // Leave already marked the cash-in paid for the void run: the replacement pays it from a copy.
          const pi = util.newRecord(tx, 'pay_inputs');
          pi.set('employment', s.getString('employment'));
          pi.set('component', l.getString('component'));
          pi.set('period_start', r.getString('period_start'));
          pi.set('period_end', r.getString('period_end'));
          pi.set('amount_minor', l.getInt('amount_minor'));
          pi.set('qty', l.getFloat('qty'));
          pi.set('rate_minor', 0);
          pi.set('currency', s.getString('currency'));
          pi.set('source', 'leave');
          pi.set('ref', l.getString('ref'));
          pi.set('note', l.getString('name') + ' (from ' + r.getString('number') + ')');
          pi.set('payrun', repl.id);
          pi.set('status', 'open');
          pi.set('detail', { ref_kind: rk, from_run: r.id });
          tx.save(pi);
        }
      }
      s.set('status', 'void');
      tx.save(s);
    }
    // Inputs used by the void run go to the replacement; loan repayments are reversed.
    for (const pi of util.findMany(tx, 'pay_inputs', "payrun = {:r} && status = 'used'", '', 0, { r: r.id })) {
      pi.set('status', 'open');
      pi.set('payrun', repl.id);
      tx.save(pi);
    }
    for (const rp of util.findMany(tx, 'loan_repayments', "payrun = {:r} && kind = 'payroll'", '', 0, { r: r.id })) {
      const rev = util.newRecord(tx, 'loan_repayments');
      rev.set('loan', rp.getString('loan'));
      rev.set('employment', rp.getString('employment'));
      rev.set('payrun', r.id);
      rev.set('payslip', rp.getString('payslip'));
      rev.set('day', util.today(tx, ent.id));
      rev.set('amount_minor', -rp.getInt('amount_minor'));
      rev.set('kind', 'reversal');
      rev.set('note', 'Voided ' + r.getString('number'));
      tx.save(rev);
      const ln = util.byId(tx, 'loans', rp.getString('loan'));
      if (ln !== null) {
        ln.set('balance_minor', ln.getInt('balance_minor') + rp.getInt('amount_minor'));
        if (ln.getString('status') === 'closed') ln.set('status', 'active');
        tx.save(ln);
      }
    }
    for (const h of util.findMany(tx, 'salary_holds', "payrun = {:r} && status = 'held'", '', 0, { r: r.id })) {
      h.set('status', 'cancelled');
      h.set('note', 'Run voided');
      tx.save(h);
      const nh = util.newRecord(tx, 'salary_holds');
      nh.set('employment', h.getString('employment'));
      nh.set('payrun', repl.id);
      nh.set('amount_minor', 0);
      nh.set('currency', h.getString('currency'));
      nh.set('reason', h.getString('reason'));
      nh.set('status', 'held');
      nh.set('held_by', h.getString('held_by'));
      tx.save(nh);
    }
    if (r.getString('kind') === 'regular' || r.getString('kind') === 'termination') L('lib_time').unlockDays(tx, r.id);
    L('lib_expenses').unmarkPaid(tx, r.id);
    r.set('status', 'void');
    r.set('void_reason', reason);
    r.set('voided_by', ctx.memberId);
    r.set('voided_at', util.nowIso());
    r.set('replaced_by', repl.id);
    r.set('publish_at', '');
    tx.save(r);
    staleOthers(tx, ctx, r, r.getString('number') + ' was voided: its payslips left the year to date of the same people.');
    addNote(tx, r, null, { actor: 'person', member: ctx.memberId, kind: 'flag', severity: 'warning', code: 'voided', body: 'Voided by ' + ctx.name + ': ' + reason + '. Replaced by ' + repl.getString('number') + '.' });
    L('lib_audit').write(t, { op: 'payruns.void', collection: 'payruns', record: r.id, summary: 'Voided pay run ' + r.getString('number') + ' (' + reason + '); replaced by ' + repl.getString('number') });
  });
  ctx.audited = true;
  const events = L('lib_events').emit(ctx, 'payrun.voided', { payrun: rec.id, replaced_by: repl.id });
  return { voided: runView(app, app.findRecordById('payruns', rec.id)), replacement: runView(app, app.findRecordById('payruns', repl.id)), events: events };
}

/** For payroll-out: mark a locked run paid (after the bank upload is confirmed). */
function markPaid(ctx, runId, o) {
  const util = u();
  const app = ctx.app;
  const opt = o || {};
  const rec = runRef(app, runId);
  if (rec.getString('status') !== 'locked') throw util.fail(409, 'Only a locked run can be marked paid (this one is ' + rec.getString('status') + ').', 'not_locked');
  const day = opt.paid_at && util.isDay(opt.paid_at) ? opt.paid_at : util.today(app, rec.getString('entity'));
  const run = (tx) => {
    const r = tx.findRecordById('payruns', rec.id);
    r.set('status', 'paid');
    r.set('paid_at', day);
    r.set('paid_by', ctx.memberId || '');
    tx.save(r);
    addNote(tx, r, null, { actor: ctx.isAgent ? 'agent' : 'person', member: ctx.memberId, kind: 'note', body: 'Marked paid on ' + day + (opt.note ? ': ' + opt.note : '') + '.' });
    L('lib_audit').write(L('lib_auth').withApp(ctx, tx), { op: ctx.op || 'payruns.mark-paid', collection: 'payruns', record: r.id, summary: 'Pay run ' + r.getString('number') + ' paid on ' + day });
  };
  if (app.isTransactional()) run(app);
  else app.runInTransaction((tx) => run(tx));
  ctx.audited = true;
  L('lib_events').emit(ctx, 'payrun.paid', { payrun: rec.id, paid_at: day });
  return runView(app, app.findRecordById('payruns', rec.id));
}

/** For payroll-out: what a run pays out (net of every payslip not held, plus holds released into it). */
function payoutItems(app, runId) {
  const util = u();
  const people = L('lib_people');
  const out = [];
  for (const s of util.findMany(app, 'payslips', "payrun = {:r} && status != 'void'", '', 0, { r: runId })) {
    if (s.getBool('held') || s.getInt('net_minor') <= 0) continue;
    const e = app.findRecordById('employees', s.getString('employee'));
    out.push({ kind: 'payslip', payslip: s.id, employment: s.getString('employment'), employee: e.id, employee_number: e.getString('number'), name: people.displayName(e), legal_name: e.getString('legal_name'), amount_minor: s.getInt('net_minor'), currency: s.getString('currency'), pay_method: s.getString('pay_method'), bank_split: util.jsonOf(s, 'bank_split', []) || [], hold: '' });
  }
  for (const h of util.findMany(app, 'salary_holds', "released_payrun = {:r} && release_via = 'payrun' && status = 'released'", '', 0, { r: runId })) {
    const s = util.byId(app, 'payslips', h.getString('payslip'));
    const e = s ? app.findRecordById('employees', s.getString('employee')) : null;
    if (s === null || e === null) continue;
    out.push({ kind: 'hold_release', payslip: s.id, employment: s.getString('employment'), employee: e.id, employee_number: e.getString('number'), name: people.displayName(e), legal_name: e.getString('legal_name'), amount_minor: h.getInt('amount_minor'), currency: h.getString('currency'), pay_method: s.getString('pay_method'), bank_split: util.jsonOf(s, 'bank_split', []) || [], hold: h.id });
  }
  return out;
}

/* ----------------------------------------------------- delete, scope */

function deleteRun(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rec = runRef(app, util.req(p, 'payrun'));
  needRun(ctx, rec, 'full', 'delete pay runs');
  if (['draft', 'calculated', 'calculating'].indexOf(rec.getString('status')) < 0) throw util.fail(409, 'Only a draft or calculated run can be deleted. A locked run is voided, never deleted.', 'run_locked');
  app.runInTransaction((tx) => {
    const r = tx.findRecordById('payruns', rec.id);
    if (r.getString('approval') !== '') cancelApproval(tx, ctx, r, 'The run was deleted.');
    for (const pi of util.findMany(tx, 'pay_inputs', "payrun = {:r} && status = 'open'", '', 0, { r: r.id })) {
      pi.set('payrun', '');
      tx.save(pi);
    }
    tx.delete(r);
  });
  L('lib_audit').note(ctx, { collection: 'payruns', record: rec.id, summary: 'Deleted the draft pay run ' + rec.getString('number') });
  return { deleted: true };
}

/** payruns.people: add people to or leave people out of a run before it is locked. */
function people(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rec = runRef(app, util.req(p, 'payrun'));
  needRun(ctx, rec, 'edit', 'change who is in a pay run');
  assertOpen(rec, 'people');
  const add = (util.list(p, 'add') || []).map((r) => L('lib_people').employmentRef(app, String(r)).id);
  const remove = (util.list(p, 'remove') || []).map((r) => L('lib_people').employmentRef(app, String(r)).id);
  const reason = util.text(p, 'reason', 400, '');
  const scope = util.jsonOf(rec, 'scope', {}) || {};
  scope.employments = scope.employments || [];
  scope.excluded = scope.excluded || [];
  for (const id of add) {
    if (app.findRecordById('employments', id).getString('entity') !== rec.getString('entity')) throw util.fail(400, 'Everyone in a run belongs to its entity.', 'invalid_param');
    scope.excluded = scope.excluded.filter((x) => (typeof x === 'string' ? x : x.employment) !== id);
    if (rec.getString('kind') !== 'regular' && scope.employments.indexOf(id) < 0) scope.employments.push(id);
  }
  for (const id of remove) {
    if (rec.getString('kind') === 'regular') scope.excluded.push({ employment: id, reason: reason, by: ctx.memberId, at: util.nowIso() });
    else scope.employments = scope.employments.filter((x) => x !== id);
  }
  app.runInTransaction((tx) => {
    const r = tx.findRecordById('payruns', rec.id);
    r.set('scope', scope);
    if (r.getString('status') !== 'draft') {
      if (r.getString('approval') !== '') cancelApproval(tx, ctx, r, 'People changed.');
      r.set('status', 'draft');
    }
    for (const id of remove) util.exec(tx, 'DELETE FROM payslips WHERE payrun = {:r} AND employment = {:e}', { r: r.id, e: id });
    tx.save(r);
  });
  L('lib_audit').note(ctx, { collection: 'payruns', record: rec.id, summary: 'Changed who is in ' + rec.getString('number') + ' (' + add.length + ' added, ' + remove.length + ' left out)' });
  return { payrun: runView(app, app.findRecordById('payruns', rec.id)) };
}

/* ------------------------------------------------------- notes, jobs */

function addNote(app, rec, employmentId, o) {
  const util = u();
  const n = util.newRecord(app, 'payrun_notes');
  n.set('payrun', rec.id);
  n.set('employment', employmentId || '');
  n.set('actor', o.actor || 'system');
  n.set('member', o.member || '');
  n.set('kind', o.kind || 'note');
  n.set('severity', o.severity || 'info');
  n.set('code', util.clip(o.code || '', 60));
  n.set('body', util.clip(o.body || '', 20000));
  n.set('resolved', false);
  n.set('job', o.job || '');
  app.save(n);
  return n;
}

function noteView(app, n) {
  const util = u();
  const emp = n.getString('employment') !== '' ? util.byId(app, 'employments', n.getString('employment')) : null;
  const e = emp ? util.byId(app, 'employees', emp.getString('employee')) : null;
  return { id: n.id, payrun: n.getString('payrun'), employment: n.getString('employment'), employee_name: e ? L('lib_people').displayName(e) : '', employee_number: e ? e.getString('number') : '', actor: n.getString('actor'), who: n.getString('actor') === 'agent' ? 'Your AI agent' : n.getString('actor') === 'system' ? 'HR OS' : memberName(app, n.getString('member')), kind: n.getString('kind'), severity: n.getString('severity'), code: n.getString('code'), body: n.getString('body'), resolved: n.getBool('resolved'), resolved_by_name: memberName(app, n.getString('resolved_by')), created: n.getString('created') };
}

function notesOp(ctx, p) {
  const util = u();
  const rec = runRef(ctx.app, util.req(p, 'payrun'));
  needRun(ctx, rec, 'view');
  return { notes: util.findMany(ctx.app, 'payrun_notes', 'payrun = {:r}', '-created', 500, { r: rec.id }).map((n) => noteView(ctx.app, n)) };
}

/** payruns.note: a note on a run, or your AI agent's review or flag (it never approves). */
function noteAdd(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rec = runRef(app, util.req(p, 'payrun'));
  needRun(ctx, rec, 'view');
  const body = util.text(p, 'body', 20000, '');
  if (body === '') throw util.fail(400, 'body is required', 'missing_param', { param: 'body' });
  const kind = util.oneOf(p, 'kind', ['note', 'review', 'flag'], 'note');
  const empRef = util.str(p, 'employment', '');
  const emp = empRef !== '' ? L('lib_people').employmentRef(app, empRef).id : '';
  const code = util.str(p, 'code', '');
  if (code !== '' && !/^[a-z][a-z0-9_]{0,59}$/.test(code)) throw util.fail(400, 'code is snake_case, e.g. overtime_spike', 'invalid_param', { param: 'code' });
  const n = addNote(app, rec, emp, { actor: ctx.isAgent ? 'agent' : 'person', member: ctx.memberId, kind: kind, severity: util.oneOf(p, 'severity', ['info', 'warning', 'blocker'], kind === 'flag' ? 'warning' : 'info'), code: code, body: body });
  if (ctx.isAgent && kind !== 'note') L('lib_notify').toRole(app, 'payroll_admin', { kind: 'agent', title: 'Your AI agent ' + (kind === 'review' ? 'reviewed' : 'flagged') + ' pay run ' + rec.getString('number'), body: '', link: '#/payroll/runs/' + rec.id + '?tab=notes' });
  L('lib_audit').note(ctx, { collection: 'payrun_notes', record: n.id, summary: (kind === 'review' ? 'Review' : kind === 'flag' ? 'Flag' : 'Note') + ' on ' + rec.getString('number') });
  return { note: noteView(app, n) };
}

function noteResolve(ctx, p) {
  const util = u();
  const n = util.byId(ctx.app, 'payrun_notes', util.req(p, 'note'));
  if (n === null) throw util.fail(404, 'No such note.', 'not_found');
  const rec = ctx.app.findRecordById('payruns', n.getString('payrun'));
  needRun(ctx, rec, 'edit', 'resolve notes');
  n.set('resolved', util.bool(p, 'resolved', true));
  n.set('resolved_by', ctx.memberId);
  ctx.app.save(n);
  L('lib_audit').note(ctx, { collection: 'payrun_notes', record: n.id, summary: 'Resolved a note on ' + rec.getString('number') });
  return { note: noteView(ctx.app, n) };
}

function canReview(rec) {
  if (OPEN.indexOf(rec.getString('status')) < 0 && rec.getString('status') !== 'locked') throw u().fail(409, 'A ' + rec.getString('status') + ' run is not reviewed.', 'conflict');
}

/** agent.retry on payrun_review: payroll view rights on the run's entity. */
function mayAsk(ctx, rec) {
  needRun(ctx, rec, 'view');
  canReview(rec);
}

/** agent.retry on variance_explain: payroll view rights on the payslip's run. */
function mayAskSlip(ctx, slip) {
  needRun(ctx, ctx.app.findRecordById('payruns', slip.getString('payrun')), 'view');
}

/** payruns.review: ask your AI agent to review a run (payrun_review with the run's id): it writes a review and flags, never approves. */
function review(ctx, p) {
  const util = u();
  const rec = runRef(ctx.app, util.req(p, 'payrun'));
  mayAsk(ctx, rec);
  const r = L('lib_agent').ask(ctx, rec, 'payrun_review', { note: util.text(p, 'focus', 1000, '') });
  L('lib_audit').note(ctx, { collection: 'payruns', record: rec.id, summary: r.asked ? 'Asked your AI agent to review ' + rec.getString('number') : 'Your AI agent is already asked to review ' + rec.getString('number'), after: { trigger: 'payrun_review', request: r.request } });
  return { asked: r.asked, agent: L('lib_agent').view(ctx.app.findRecordById('payruns', rec.id), 'payrun_review') };
}

/** payruns.explain: ask your AI agent to explain the change of one person's pay against the last run (variance_explain with the payslip's id). */
function explain(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rec = runRef(app, util.req(p, 'payrun'));
  needRun(ctx, rec, 'view');
  const m = L('lib_people').employmentRef(app, util.req(p, 'employment'));
  const slip = util.findOne(app, 'payslips', 'payrun = {:r} && employment = {:e}', { r: rec.id, e: m.id });
  if (slip === null) throw util.fail(404, 'This person is not in the run.', 'not_found');
  const r = L('lib_agent').ask(ctx, slip, 'variance_explain', {});
  L('lib_audit').note(ctx, { collection: 'payruns', record: rec.id, summary: (r.asked ? 'Asked your AI agent to explain the pay change of ' : 'Your AI agent is already asked about the pay change of ') + L('lib_people').displayName(app.findRecordById('employees', m.getString('employee'))) + ' in ' + rec.getString('number'), after: { trigger: 'variance_explain', request: r.request } });
  return { asked: r.asked, agent: L('lib_agent').view(app.findRecordById('payslips', slip.id), 'variance_explain') };
}

/**
 * payruns.note by your AI agent delivers its asks (lib_agent.DELIVER): a
 * review note without a person closes payrun_review on the run; a review
 * note about a person closes variance_explain on their payslip.
 */
function deliveredBy(app, p) {
  const util = u();
  if (String(p.kind || 'note') !== 'review') return [];
  const rec = util.byId(app, 'payruns', String(p.payrun || '')) || util.findOne(app, 'payruns', 'number = {:n}', { n: String(p.payrun || '').toUpperCase() });
  if (rec === null) return [];
  if (String(p.employment || '') === '') return [{ rec: rec, trigger: 'payrun_review' }];
  const m = L('lib_people').employmentRef(app, String(p.employment));
  const slip = util.findOne(app, 'payslips', 'payrun = {:r} && employment = {:e}', { r: rec.id, e: m.id });
  return slip !== null ? [{ rec: slip, trigger: 'variance_explain' }] : [];
}

/* ----------------------------------------------------------------- holds */

function holdView(app, h) {
  const util = u();
  const m = util.byId(app, 'employments', h.getString('employment'));
  const e = m ? util.byId(app, 'employees', m.getString('employee')) : null;
  const r = util.byId(app, 'payruns', h.getString('payrun'));
  const rr = h.getString('released_payrun') !== '' ? util.byId(app, 'payruns', h.getString('released_payrun')) : null;
  return { id: h.id, employment: h.getString('employment'), employee_name: e ? L('lib_people').displayName(e) : '', employee_number: e ? e.getString('number') : '', payrun: h.getString('payrun'), payrun_number: r ? r.getString('number') : '', payslip: h.getString('payslip'), amount_minor: h.getInt('amount_minor'), currency: h.getString('currency'), reason: h.getString('reason'), status: h.getString('status'), release_via: h.getString('release_via'), released_payrun: h.getString('released_payrun'), released_payrun_number: rr ? rr.getString('number') : '', released_at: h.getString('released_at'), held_by_name: memberName(app, h.getString('held_by')), created: h.getString('created') };
}

function holdsList(ctx, p) {
  const util = u();
  L('lib_payroll').need(ctx, 'view');
  const status = util.oneOf(p, 'status', ['held', 'released', 'cancelled', 'all'], 'held');
  const rows = util.findMany(ctx.app, 'salary_holds', status === 'all' ? '1=1' : 'status = {:s}', '-created', 500, { s: status });
  return { holds: rows.map((h) => holdView(ctx.app, h)).filter((h) => h.payrun_number !== '') };
}

/** holds.hold: hold a person's net pay in a run (salary withholding); it is paid when released. */
function hold(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rec = runRef(app, util.req(p, 'payrun'));
  needRun(ctx, rec, 'edit', 'hold pay');
  assertOpen(rec, 'hold');
  const m = L('lib_people').employmentRef(app, util.req(p, 'employment'));
  const reason = util.text(p, 'reason', 1000, '');
  if (reason === '') throw util.fail(400, 'reason is required', 'missing_param', { param: 'reason' });
  const existing = util.findOne(app, 'salary_holds', "payrun = {:r} && employment = {:e} && status = 'held'", { r: rec.id, e: m.id });
  if (existing !== null) return { hold: holdView(app, existing) };
  let h = null;
  app.runInTransaction((tx) => {
    h = util.newRecord(tx, 'salary_holds');
    h.set('employment', m.id);
    h.set('payrun', rec.id);
    h.set('amount_minor', 0);
    h.set('currency', rec.getString('currency'));
    h.set('reason', reason);
    h.set('status', 'held');
    h.set('held_by', ctx.memberId);
    tx.save(h);
    const s = util.findOne(tx, 'payslips', 'payrun = {:r} && employment = {:e}', { r: rec.id, e: m.id });
    if (s !== null) {
      s.set('held', true);
      tx.save(s);
    }
    reapprove(tx, ctx, rec.id, 'A pay hold was added: what the run pays changed.');
  });
  L('lib_audit').note(ctx, { collection: 'salary_holds', record: h.id, summary: 'Held the pay of ' + L('lib_people').displayName(app.findRecordById('employees', m.getString('employee'))) + ' in ' + rec.getString('number') + ' (' + reason + ')' });
  return { hold: holdView(app, app.findRecordById('salary_holds', h.id)) };
}

/**
 * payruns.ask-fix: an issue the asker may not fix goes to the people who
 * can, as an Inbox item with the plain sentence and a link: the person's own
 * details (birth date, nationality, gender) to HR; a missing bank account to
 * the person when they have a sign-in (they add it, payroll approves it),
 * else HR; tax profile, employer fields and pay records to the payroll
 * administrators. Not repeated while the same item is unread.
 */
function askFix(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rec = runRef(app, util.req(p, 'payrun'));
  needRun(ctx, rec, 'view');
  const m = L('lib_people').employmentRef(app, util.req(p, 'employment'));
  const code = util.str(p, 'code', '');
  const scope = util.str(p, 'scope', '');
  const fieldLabel = util.text(p, 'field_label', 80, '') || util.str(p, 'field', '').replace(/_/g, ' ');
  const issueText = util.text(p, 'message', 600, '');
  const e = app.findRecordById('employees', m.getString('employee'));
  const who = L('lib_people').displayName(e);
  const num = e.getString('number');
  let route = 'payroll_admin';
  let link = '#/payroll/runs/' + rec.id + '?tab=issues';
  if ((code === 'data_missing' && scope === 'employee') || code === 'no_birth_date') {
    route = 'hr_admin';
    link = '#/people/' + num + '?tab=personal';
  } else if (code === 'bank_missing' || code === 'bank_currency_mismatch') {
    const member = util.findOne(app, 'members', 'employee = {:e}', { e: e.id });
    route = member !== null ? 'person' : 'hr_admin';
    link = member !== null ? '#/me' : '#/people/' + num + '?tab=bank';
  }
  const what = code === 'bank_missing' ? 'a bank account to pay into' : fieldLabel !== '' ? 'the ' + fieldLabel : 'a fix';
  const title = route === 'person' ? 'Add a bank account for your pay' : 'Payroll needs ' + what + ' for ' + who;
  const body = (issueText !== '' ? issueText + ' ' : '') + 'For the pay run ' + rec.getString('label') + ' (' + rec.getString('number') + '), asked by ' + (ctx.name || 'payroll') + '.';
  const already = util.count(app, 'SELECT COUNT(*) AS n FROM notifications WHERE title = {:t} AND link = {:l} AND read = FALSE', { t: title, l: link }) > 0;
  let sent = 0;
  if (!already) {
    const n = { kind: 'payroll', title: title, body: body, link: link, facts: [{ type: 'text', key: 'person', label: 'Person', value: who }, { type: 'text', key: 'run', label: 'Pay run', value: rec.getString('label') }] };
    if (route === 'person') sent = L('lib_notify').notify(app, [util.findOne(app, 'members', 'employee = {:e}', { e: e.id }).id], n).length;
    else sent = L('lib_notify').toRole(app, route, n).length;
  }
  L('lib_audit').note(ctx, { collection: 'payruns', record: rec.id, summary: 'Asked ' + (route === 'person' ? who : route.replace('_', ' ')) + ' to fix ' + what + ' for ' + who + ' (' + rec.getString('number') + ')' });
  return { routed_to: route, person: who, sent: sent, already: already };
}

/** A run sent for approval or approved goes back to calculated (the approval is cancelled) when what it pays changes. */
function reapprove(app, ctx, runId, why) {
  const r = app.findRecordById('payruns', runId);
  if (r.getString('status') !== 'approved' && r.getString('approval') === '') return;
  if (r.getString('approval') !== '') cancelApproval(app, ctx, r, why);
  if (r.getString('status') === 'approved') r.set('status', 'calculated');
  app.save(r);
  addNote(app, r, null, { actor: 'system', kind: 'flag', severity: 'warning', code: 'reapprove', body: why + ' Send it for approval again.' });
}

/** holds.cancel: take a hold off before the run is locked. */
function holdCancel(ctx, p) {
  const util = u();
  const app = ctx.app;
  const h = util.byId(app, 'salary_holds', util.req(p, 'hold'));
  if (h === null) throw util.fail(404, 'No such hold.', 'not_found');
  const rec = app.findRecordById('payruns', h.getString('payrun'));
  needRun(ctx, rec, 'edit', 'change holds');
  assertOpen(rec, 'hold');
  app.runInTransaction((tx) => {
    const x = tx.findRecordById('salary_holds', h.id);
    x.set('status', 'cancelled');
    tx.save(x);
    const s = util.findOne(tx, 'payslips', 'payrun = {:r} && employment = {:e}', { r: rec.id, e: h.getString('employment') });
    if (s !== null) {
      s.set('held', false);
      tx.save(s);
    }
    reapprove(tx, ctx, rec.id, 'A pay hold was taken off: what the run pays changed.');
  });
  L('lib_audit').note(ctx, { collection: 'salary_holds', record: h.id, summary: 'Took off a pay hold in ' + rec.getString('number') });
  return { hold: holdView(app, app.findRecordById('salary_holds', h.id)) };
}

/** holds.release: release held pay into a run's payout or as paid outside payroll (PIN). */
function holdRelease(ctx, p) {
  const util = u();
  const app = ctx.app;
  const h = util.byId(app, 'salary_holds', util.req(p, 'hold'));
  if (h === null) throw util.fail(404, 'No such hold.', 'not_found');
  const rec = app.findRecordById('payruns', h.getString('payrun'));
  needRun(ctx, rec, 'full', 'release held pay');
  if (h.getString('status') !== 'held') throw util.fail(409, 'This hold is ' + h.getString('status') + '.', 'conflict');
  if (rec.getString('status') !== 'locked' && rec.getString('status') !== 'paid') throw util.fail(409, 'The run is not locked yet: take the hold off instead (holds.cancel).', 'not_locked');
  const via = util.oneOf(p, 'via', ['payrun', 'outside'], 'payrun');
  let target = null;
  if (via === 'payrun') {
    target = runRef(app, util.req(p, 'into', 'PR-0005'));
    if (target.getString('entity') !== rec.getString('entity')) throw util.fail(400, 'Release into a run of the same entity.', 'invalid_param');
    if (['draft', 'calculating', 'calculated', 'approved', 'locked'].indexOf(target.getString('status')) < 0) throw util.fail(409, 'Release into a run that is not paid yet.', 'conflict');
  }
  h.set('status', 'released');
  h.set('release_via', via);
  h.set('released_payrun', target ? target.id : '');
  h.set('released_at', util.nowIso());
  h.set('released_by', ctx.memberId);
  h.set('note', util.text(p, 'note', 1000, ''));
  app.save(h);
  L('lib_audit').note(ctx, { collection: 'salary_holds', record: h.id, summary: 'Released held pay ' + L('lib_money').format(h.getInt('amount_minor'), h.getString('currency')) + (target ? ' into ' + target.getString('number') : ' as paid outside payroll') });
  return { hold: holdView(app, h) };
}

/* ------------------------------------------------------------- verify */

/** payruns.verify: recalculate every payslip of a run from its stored input and compare fingerprints. */
function verify(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rec = runRef(app, util.req(p, 'payrun'));
  needRun(ctx, rec, 'view');
  const calc = L('lib_payroll_calc');
  const out = [];
  let ok = 0;
  const hashes = [];
  for (const s of util.findMany(app, 'payslips', "payrun = {:r} && status != 'void'", 'employment', 0, { r: rec.id })) {
    const v = calc.recompute(app, s);
    if (v.input_ok && v.engine_ok) ok++;
    else out.push({ payslip: s.id, employment: s.getString('employment'), input_ok: v.input_ok, engine_ok: v.engine_ok });
    hashes.push(s.getString('employment') + ':' + v.engine_hash + ':' + s.getInt('net_minor'));
  }
  hashes.sort();
  const runHash = util.sha(hashes.join('\n'));
  return { payrun: rec.id, checked: ok + out.length, matching: ok, mismatches: out, run_hash: runHash, stored_run_hash: rec.getString('hash'), run_hash_ok: rec.getString('hash') === '' || rec.getString('hash') === runHash };
}

/* -------------------------------------------------------------- reminders */

/** Cron (every 15 minutes): pay run reminders before the input cutoff (days from the schedule), sent once, after 09:00 local. */
function cronReminders(app) {
  const util = u();
  const pr = L('lib_payroll');
  for (const s of util.findMany(app, 'pay_schedules', 'active = true', '', 0)) {
    try {
      const local = util.localNow(app, s.getString('entity'));
      if (local.hour < 9) continue;
      const n = pr.nextPeriod(app, s);
      if (n.run && (n.run.status === 'locked' || n.run.status === 'paid')) continue;
      const days = util.jsonOf(s, 'reminder_days', [3, 1, 0]) || [];
      const d = util.daysBetween(local.day, n.cutoff_day);
      if (days.indexOf(d) < 0) continue;
      const sent = util.jsonOf(s, 'reminders', {}) || {};
      const key = n.period_start;
      const list = sent[key] || [];
      if (list.indexOf(d) >= 0) continue;
      list.push(d);
      sent[key] = list;
      for (const k of Object.keys(sent)) if (k < util.dayAdd(local.day, -120)) delete sent[k];
      s.set('reminders', sent);
      app.save(s);
      const ent = app.findRecordById('entities', s.getString('entity'));
      const title = (d === 0 ? 'Payroll inputs close today: ' : 'Payroll inputs close in ' + d + (d === 1 ? ' day: ' : ' days: ')) + s.getString('name') + ', ' + ent.getString('name') + ' (pay day ' + n.pay_date + ')';
      L('lib_notify').toRole(app, 'payroll_admin', { kind: 'payroll', title: title, body: '', link: n.run ? '#/payroll/runs/' + n.run.id : '#/payroll/run?schedule=' + s.id, facts: [{ type: 'day', key: 'cutoff_day', label: 'Inputs close', value: n.cutoff_day }, { type: 'day', key: 'pay_date', label: 'Pay day', value: n.pay_date }, { type: 'range', key: 'period', label: 'Period', from: n.period_start, to: n.period_end }] });
    } catch (err) {
      console.error('[hr] payroll reminder failed:', err);
    }
  }
}

module.exports = {
  mayAsk: mayAsk,
  mayAskSlip: mayAskSlip,
  deliveredBy: deliveredBy,
  RUN_KINDS: RUN_KINDS,
  OPEN: OPEN,
  ACK_REASONS: ACK_REASONS,
  runRef: runRef,
  runView: runView,
  runSummary: runSummary,
  assertOpen: assertOpen,
  list: list,
  get: get,
  nextOp: nextOp,
  create: create,
  draftTermination: draftTermination,
  askFix: askFix,
  moveTermination: moveTermination,
  employmentsOf: employmentsOf,
  calculate: calculate,
  cronContinue: cronContinue,
  issuesOp: issuesOp,
  acknowledge: acknowledge,
  varianceOp: varianceOp,
  submit: submit,
  onPayrunDecision: onPayrunDecision,
  reopen: reopen,
  staleFor: staleFor,
  cancelApproval: cancelApproval,
  foldOpenings: foldOpenings,
  lock: lock,
  publish: publish,
  publishRun: publishRun,
  cronPublish: cronPublish,
  voidRun: voidRun,
  markPaid: markPaid,
  payoutItems: payoutItems,
  deleteRun: deleteRun,
  people: people,
  addNote: addNote,
  notesOp: notesOp,
  noteAdd: noteAdd,
  noteResolve: noteResolve,
  review: review,
  explain: explain,
  holdsList: holdsList,
  hold: hold,
  holdCancel: holdCancel,
  holdRelease: holdRelease,
  verify: verify,
  cronReminders: cronReminders,
};
