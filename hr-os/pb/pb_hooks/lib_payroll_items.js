/// <reference path="../pb_data/types.d.ts" />
/**
 * Pay items (payroll-core): recurring items, one-off pay inputs (single and
 * CSV with a dry run), opening year-to-date balances, compensation changes
 * through pay_change approvals, the back pay (arrears) wizard, employee
 * loans (approval kind loan) and benefit plans with enrolments.
 *
 * Anything a locked pay run used is never edited: a used pay input, a
 * recurring item or a loan installment already paid stays as it was; change
 * them from a new day (and pay the difference as back pay or a correction).
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}

const LOAN_KINDS = ['salary_advance', 'personal', 'housing', 'vehicle', 'education', 'medical', 'other'];
const PLAN_KINDS = ['health', 'dental', 'vision', 'life', 'retirement', 'transport', 'meal', 'wellness', 'other'];
const PAY_REASONS = ['hire', 'raise', 'promotion', 'adjustment', 'correction', 'change'];
const PAY_PER_LABEL = { year: 'Yearly pay', month: 'Monthly pay', week: 'Weekly pay', day: 'Daily rate', hour: 'Hourly rate' };

function people() {
  return L('lib_people');
}

function employment(ctx, ref, lvl) {
  const m = people().employmentRef(ctx.app, ref);
  L('lib_payroll').need(ctx, lvl, m.getString('entity'));
  return m;
}

function currencyOf(app, m) {
  return app.findRecordById('entities', m.getString('entity')).getString('currency');
}

function nameOf(app, m) {
  return people().displayName(app.findRecordById('employees', m.getString('employee')));
}

/** Open runs of the employment go back to draft (only `runId` when the change is for that run alone). */
function stale(ctx, employmentId, why, runId) {
  L('lib_payroll_runs').staleFor(ctx.app, ctx, employmentId, why, runId || '');
}

/** Did a locked (or paid) pay run use this record (a line with this ref)? */
function usedByLocked(app, refId) {
  return u().count(app, "SELECT COUNT(*) AS n FROM payslip_lines l JOIN payslips s ON s.id = l.payslip WHERE l.ref = {:r} AND s.status IN ('locked', 'published')", { r: refId }) > 0;
}

/* --------------------------------------------------------- recurring */

function recurringView(app, r) {
  const util = u();
  const c = util.byId(app, 'pay_components', r.getString('component'));
  const m = util.byId(app, 'employments', r.getString('employment'));
  const today = m ? util.today(app, m.getString('entity')) : '';
  return {
    id: r.id,
    employment: r.getString('employment'),
    employee_name: m ? nameOf(app, m) : '',
    employee_number: m ? app.findRecordById('employees', m.getString('employee')).getString('number') : '',
    component: r.getString('component'),
    component_code: c ? c.getString('code') : '',
    component_name: c ? c.getString('name') : '',
    kind: c ? c.getString('kind') : '',
    amount_minor: r.getInt('amount_minor'),
    percent: r.getFloat('percent'),
    currency: r.getString('currency'),
    from_day: r.getString('from_day'),
    to_day: r.getString('to_day'),
    note: r.getString('note'),
    state: r.getString('from_day') > today ? 'scheduled' : r.getString('to_day') !== '' && r.getString('to_day') < today ? 'ended' : 'current',
    used: usedByLocked(app, r.id),
  };
}

function recurringList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const pr = L('lib_payroll');
  pr.need(ctx, 'view');
  const where = [];
  const bind = {};
  const er = util.str(p, 'employment', '');
  if (er !== '') {
    where.push('employment = {:e}');
    bind.e = people().employmentRef(app, er).id;
  }
  const rows = util.findMany(app, 'recurring_items', where.length ? where.join(' && ') : '1=1', '-from_day', 1000, bind).map((r) => recurringView(app, r));
  const state = util.str(p, 'state', '');
  return { items: state === '' ? rows : rows.filter((x) => x.state === state) };
}

function recurringSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const pr = L('lib_payroll');
  const id = util.str(p, 'item', '');
  let rec;
  let m;
  if (id !== '') {
    rec = util.byId(app, 'recurring_items', id);
    if (rec === null) throw util.fail(404, 'No recurring item ' + id + '.', 'not_found');
    m = app.findRecordById('employments', rec.getString('employment'));
    pr.need(ctx, 'edit', m.getString('entity'), 'change pay items');
  } else {
    m = employment(ctx, util.req(p, 'employment'), 'edit');
    rec = util.newRecord(app, 'recurring_items');
    rec.set('employment', m.id);
    rec.set('created_by', ctx.memberId);
  }
  const cur = currencyOf(app, m);
  const before = id !== '' ? recurringView(app, rec) : null;
  const used = id !== '' && usedByLocked(app, rec.id);
  if (used && (util.has(p, 'amount') || util.has(p, 'percent') || util.has(p, 'from_day') || util.has(p, 'component'))) throw util.fail(409, 'A locked pay run used this item: end it (to_day) and add a new one from the day the change applies.', 'locked');
  if (id === '' || util.has(p, 'component')) {
    const c = pr.componentRef(app, m.getString('entity'), util.req(p, 'component', 'ALLOWANCE'));
    if (c.getBool('archived')) throw util.fail(409, 'The component ' + c.getString('code') + ' is archived.', 'archived');
    rec.set('component', c.id);
  }
  if (util.has(p, 'amount')) rec.set('amount_minor', util.money(p, 'amount', cur, {}) || 0);
  if (util.has(p, 'percent')) rec.set('percent', util.num(p, 'percent', { min: -100, max: 1000 }) || 0);
  if (id === '' && !util.has(p, 'amount') && !util.has(p, 'percent')) throw util.fail(400, 'Give --amount (e.g. 250.00) or --percent.', 'missing_param', { param: 'amount' });
  rec.set('currency', cur);
  if (id === '' || util.has(p, 'from_day')) rec.set('from_day', util.day(p, 'from_day', util.today(app, m.getString('entity'))));
  if (util.has(p, 'to_day')) rec.set('to_day', util.day(p, 'to_day', ''));
  if (rec.getString('to_day') !== '' && rec.getString('to_day') < rec.getString('from_day')) throw util.fail(400, 'to_day is before from_day.', 'invalid_param');
  if (util.has(p, 'note')) rec.set('note', util.text(p, 'note', 1000, ''));
  app.save(rec);
  stale(ctx, m.id, 'Pay items changed.');
  const after = recurringView(app, rec);
  L('lib_audit').note(ctx, { collection: 'recurring_items', record: rec.id, summary: (id === '' ? 'Added' : 'Changed') + ' the recurring ' + after.component_name + ' of ' + after.employee_name, before: before, after: after });
  return { item: after };
}

function recurringEnd(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rec = util.byId(app, 'recurring_items', util.req(p, 'item'));
  if (rec === null) throw util.fail(404, 'No such recurring item.', 'not_found');
  const m = app.findRecordById('employments', rec.getString('employment'));
  L('lib_payroll').need(ctx, 'edit', m.getString('entity'), 'change pay items');
  const before = recurringView(app, rec);
  const day = util.day(p, 'to_day', util.today(app, m.getString('entity')));
  if (!usedByLocked(app, rec.id) && day < rec.getString('from_day')) {
    app.delete(rec);
    stale(ctx, m.id, 'Pay items changed.');
    L('lib_audit').note(ctx, { collection: 'recurring_items', record: rec.id, summary: 'Removed the recurring ' + before.component_name + ' of ' + before.employee_name, before: before });
    return { deleted: true };
  }
  if (day < rec.getString('from_day')) throw util.fail(400, 'to_day is before the item starts.', 'invalid_param');
  rec.set('to_day', day);
  app.save(rec);
  stale(ctx, m.id, 'Pay items changed.');
  L('lib_audit').note(ctx, { collection: 'recurring_items', record: rec.id, summary: 'Ended the recurring ' + before.component_name + ' of ' + before.employee_name + ' on ' + day, before: before, after: recurringView(app, rec) });
  return { item: recurringView(app, rec) };
}

/* -------------------------------------------------------- pay inputs */

function inputView(app, r) {
  const util = u();
  const c = util.byId(app, 'pay_components', r.getString('component'));
  const m = util.byId(app, 'employments', r.getString('employment'));
  const run = r.getString('payrun') !== '' ? util.byId(app, 'payruns', r.getString('payrun')) : null;
  const e = m ? app.findRecordById('employees', m.getString('employee')) : null;
  return {
    id: r.id,
    employment: r.getString('employment'),
    employee_name: e ? people().displayName(e) : '',
    employee_number: e ? e.getString('number') : '',
    component: r.getString('component'),
    component_code: c ? c.getString('code') : '',
    component_name: c ? c.getString('name') : '',
    kind: c ? c.getString('kind') : '',
    period_start: r.getString('period_start'),
    period_end: r.getString('period_end'),
    amount_minor: r.getInt('amount_minor'),
    qty: r.getFloat('qty'),
    rate_minor: r.getInt('rate_minor'),
    total_minor: r.getInt('amount_minor') !== 0 ? r.getInt('amount_minor') : L('lib_money').round(r.getFloat('qty') * r.getInt('rate_minor'), 'half_up'),
    currency: r.getString('currency'),
    source: r.getString('source'),
    ref: r.getString('ref'),
    note: r.getString('note'),
    payrun: r.getString('payrun'),
    payrun_number: run ? run.getString('number') : '',
    status: r.getString('status'),
    batch: r.getString('batch'),
    detail: util.jsonOf(r, 'detail', null),
    created: r.getString('created'),
  };
}

function inputsList(ctx, p) {
  const util = u();
  const app = ctx.app;
  L('lib_payroll').need(ctx, 'view');
  const where = [];
  const bind = {};
  const er = util.str(p, 'employment', '');
  if (er !== '') {
    where.push('employment = {:e}');
    bind.e = people().employmentRef(app, er).id;
  }
  const run = util.str(p, 'payrun', '');
  if (run !== '') {
    where.push('payrun = {:r}');
    bind.r = L('lib_payroll_runs').runRef(app, run).id;
  }
  const st = util.oneOf(p, 'status', ['open', 'used', 'void', 'all'], 'open');
  if (st !== 'all') {
    where.push('status = {:s}');
    bind.s = st;
  }
  const pg = util.page(p, 100, 1000);
  const rows = util.findMany(app, 'pay_inputs', where.length ? where.join(' && ') : '1=1', '-created', 0, bind).filter((r) => {
    const m = util.byId(app, 'employments', r.getString('employment'));
    return m !== null && L('lib_auth').inScope(ctx, m.getString('entity'));
  });
  return { inputs: rows.slice(pg.offset, pg.offset + pg.limit).map((r) => inputView(app, r)), total: rows.length };
}

/** The period a new input belongs to by default: the employment's next open regular period. */
function defaultPeriod(app, m) {
  const pr = L('lib_payroll');
  const util = u();
  const s = util.byId(app, 'pay_schedules', pr.scheduleOfEmployment(app, m.id, util.today(app, m.getString('entity'))));
  if (s === null) {
    const t = util.today(app, m.getString('entity'));
    return { start: t.slice(0, 8) + '01', end: util.monthEnd(t) };
  }
  const n = pr.nextPeriod(app, s);
  return { start: n.period_start, end: n.period_end };
}

/** Check and build one input's values (shared by add, update and CSV import). */
function inputValues(app, m, p, current) {
  const util = u();
  const pr = L('lib_payroll');
  const cur = currencyOf(app, m);
  const out = Object.assign({}, current || {});
  if (util.has(p, 'component') || !current) {
    const c = pr.componentRef(app, m.getString('entity'), util.req(p, 'component', 'BONUS'));
    if (c.getBool('archived')) throw util.fail(409, 'The component ' + c.getString('code') + ' is archived.', 'archived');
    out.component = c.id;
  }
  if (util.has(p, 'amount')) out.amount_minor = util.money(p, 'amount', cur, { allowNegative: true }) || 0;
  if (util.has(p, 'qty')) out.qty = util.num(p, 'qty', { min: -100000, max: 100000 }) || 0;
  if (util.has(p, 'rate')) out.rate_minor = util.money(p, 'rate', cur, {}) || 0;
  if (!current && !(out.amount_minor || (out.qty && out.rate_minor))) throw util.fail(400, 'Give --amount (e.g. 500.00), or --qty with --rate.', 'missing_param', { param: 'amount' });
  const dp = defaultPeriod(app, m);
  if (util.has(p, 'period_start') || !current) out.period_start = util.day(p, 'period_start', dp.start);
  if (util.has(p, 'period_end') || !current) out.period_end = util.day(p, 'period_end', util.has(p, 'period_start') ? util.monthEnd(out.period_start) : dp.end);
  if (out.period_end < out.period_start) throw util.fail(400, 'period_end is before period_start.', 'invalid_param');
  if (util.has(p, 'payrun')) {
    const ref = util.str(p, 'payrun', '');
    if (ref === '') out.payrun = '';
    else {
      const run = L('lib_payroll_runs').runRef(app, ref);
      L('lib_payroll_runs').assertOpen(run, 'add inputs');
      if (run.getString('entity') !== m.getString('entity')) throw util.fail(400, 'The run belongs to another entity.', 'invalid_param');
      out.payrun = run.id;
    }
  }
  if (util.has(p, 'note')) out.note = util.text(p, 'note', 1000, '');
  out.currency = cur;
  return out;
}

function saveInput(app, rec, v) {
  for (const k of ['component', 'amount_minor', 'qty', 'rate_minor', 'period_start', 'period_end', 'payrun', 'note', 'currency']) if (v[k] !== undefined) rec.set(k, v[k]);
  app.save(rec);
}

function inputsAdd(ctx, p) {
  const util = u();
  const app = ctx.app;
  const m = employment(ctx, util.req(p, 'employment'), 'edit');
  const v = inputValues(app, m, p, null);
  const rec = util.newRecord(app, 'pay_inputs');
  rec.set('employment', m.id);
  rec.set('source', ctx.isAgent ? 'agent' : 'manual');
  rec.set('status', 'open');
  rec.set('created_by', ctx.memberId);
  saveInput(app, rec, Object.assign({ payrun: '', note: '' }, v));
  if (v.payrun) {
    const run = app.findRecordById('payruns', v.payrun);
    const sc = util.jsonOf(run, 'scope', {}) || {};
    if (run.getString('kind') !== 'regular' && (sc.employments || []).indexOf(m.id) < 0 && !sc.all) {
      sc.employments = (sc.employments || []).concat([m.id]);
      run.set('scope', sc);
      app.save(run);
    }
  }
  stale(ctx, m.id, 'Pay inputs changed.', rec.getString('payrun'));
  const view = inputView(app, rec);
  L('lib_audit').note(ctx, { collection: 'pay_inputs', record: rec.id, summary: 'Added ' + view.component_name + ' ' + L('lib_money').format(view.total_minor, view.currency) + ' for ' + view.employee_name + ' (' + view.period_start + ' to ' + view.period_end + ')', after: view });
  return { input: view };
}

function openInput(ctx, ref) {
  const util = u();
  const rec = util.byId(ctx.app, 'pay_inputs', ref);
  if (rec === null) throw util.fail(404, 'No pay input ' + ref + '. Run pay-inputs.list.', 'not_found');
  const m = ctx.app.findRecordById('employments', rec.getString('employment'));
  L('lib_payroll').need(ctx, 'edit', m.getString('entity'), 'change pay inputs');
  if (rec.getString('status') !== 'open') throw util.fail(409, 'This input is ' + rec.getString('status') + (rec.getString('status') === 'used' ? ' by a locked pay run and can never change. Add a new input for the difference.' : '.'), 'locked');
  if (rec.getString('payrun') !== '') {
    const run = util.byId(ctx.app, 'payruns', rec.getString('payrun'));
    if (run !== null) L('lib_payroll_runs').assertOpen(run, 'change inputs');
  }
  return { rec: rec, m: m };
}

function inputsUpdate(ctx, p) {
  const util = u();
  const x = openInput(ctx, util.req(p, 'input'));
  const before = inputView(ctx.app, x.rec);
  const v = inputValues(ctx.app, x.m, p, { component: x.rec.getString('component'), amount_minor: x.rec.getInt('amount_minor'), qty: x.rec.getFloat('qty'), rate_minor: x.rec.getInt('rate_minor'), period_start: x.rec.getString('period_start'), period_end: x.rec.getString('period_end') });
  saveInput(ctx.app, x.rec, v);
  stale(ctx, x.m.id, 'Pay inputs changed.', x.rec.getString('payrun'));
  const after = inputView(ctx.app, x.rec);
  L('lib_audit').note(ctx, { collection: 'pay_inputs', record: x.rec.id, summary: 'Changed ' + after.component_name + ' for ' + after.employee_name, before: before, after: after });
  return { input: after };
}

function inputsVoid(ctx, p) {
  const util = u();
  const x = openInput(ctx, util.req(p, 'input'));
  const before = inputView(ctx.app, x.rec);
  x.rec.set('status', 'void');
  x.rec.set('note', util.clip((x.rec.getString('note') + ' ' + util.text(p, 'reason', 400, '')).trim(), 1000));
  ctx.app.save(x.rec);
  stale(ctx, x.m.id, 'Pay inputs changed.', x.rec.getString('payrun'));
  L('lib_audit').note(ctx, { collection: 'pay_inputs', record: x.rec.id, summary: 'Voided ' + before.component_name + ' for ' + before.employee_name, before: before });
  return { input: inputView(ctx.app, x.rec) };
}

const CSV_COLUMNS = ['employee', 'component', 'amount', 'qty', 'rate', 'period_start', 'period_end', 'note', 'payrun'];

/** Check a pay inputs CSV row by row (nothing changes). */
function importPlan(ctx, csvText) {
  const util = u();
  const app = ctx.app;
  const parsed = util.csvObjects(csvText);
  const problems = [];
  for (const h of parsed.header) if (CSV_COLUMNS.indexOf(h) < 0) problems.push({ row: 1, column: h, message: 'Unknown column "' + h + '"' + (util.nearest(h, CSV_COLUMNS) ? ' (did you mean ' + util.nearest(h, CSV_COLUMNS) + '?)' : '') + '. Columns: ' + CSV_COLUMNS.join(', ') });
  if (parsed.header.indexOf('employee') < 0 || parsed.header.indexOf('component') < 0) problems.push({ row: 1, message: 'The columns employee and component are required.' });
  if (parsed.items.length > 5000) problems.push({ row: 0, message: 'At most 5,000 rows at a time.' });
  const rows = [];
  if (problems.length === 0) {
    parsed.items.forEach((it, i) => {
      const row = i + 2;
      try {
        const m = people().employmentRef(app, it.employee);
        if (!L('lib_auth').inScope(ctx, m.getString('entity'))) throw util.fail(403, 'You cannot work on payroll of this entity.', 'not_permitted');
        const p = {};
        for (const k of CSV_COLUMNS) if (it[k] !== undefined && it[k] !== '' && k !== 'employee') p[k] = it[k];
        const v = inputValues(app, m, p, null);
        const c = app.findRecordById('pay_components', v.component);
        rows.push({ row: row, employment: m.id, employee: it.employee, name: nameOf(app, m), component: c.getString('code'), values: v, total_minor: v.amount_minor || L('lib_money').round((v.qty || 0) * (v.rate_minor || 0), 'half_up'), currency: v.currency, ok: true });
      } catch (err) {
        problems.push({ row: row, message: String((err && err.message) || err) });
      }
    });
  }
  return { rows: rows, problems: problems, ok: problems.length === 0 && rows.length > 0 };
}

function importCheck(ctx, p) {
  L('lib_payroll').need(ctx, 'edit');
  const text = L('lib_files').csvInput(ctx, p, 'file', 'csv');
  const plan = importPlan(ctx, text);
  return { rows: plan.rows.map((r) => ({ row: r.row, employee: r.employee, name: r.name, component: r.component, total_minor: r.total_minor, currency: r.currency, period_start: r.values.period_start, period_end: r.values.period_end })), problems: plan.problems, ok: plan.ok, would_add: plan.ok ? plan.rows.length : 0 };
}

/** pay-inputs.import: add every row of a checked CSV (all rows or none). */
function importCommit(ctx, p) {
  const util = u();
  const app = ctx.app;
  L('lib_payroll').need(ctx, 'edit');
  const text = L('lib_files').csvInput(ctx, p, 'file', 'csv');
  const plan = importPlan(ctx, text);
  if (!plan.ok) throw util.fail(400, 'The CSV has problems (' + plan.problems.length + '); nothing was added. Run pay-inputs.import-check.', 'import_problems', { problems: plan.problems.slice(0, 50) });
  const batch = util.token(12);
  const touched = {};
  app.runInTransaction((tx) => {
    for (const r of plan.rows) {
      const rec = util.newRecord(tx, 'pay_inputs');
      rec.set('employment', r.employment);
      rec.set('source', 'import');
      rec.set('status', 'open');
      rec.set('batch', batch);
      rec.set('created_by', ctx.memberId);
      saveInput(tx, rec, Object.assign({ payrun: '', note: '' }, r.values));
      touched[r.employment] = true;
    }
    for (const id of Object.keys(touched)) L('lib_payroll_runs').staleFor(tx, ctx, id, 'Pay inputs imported.');
  });
  L('lib_audit').note(ctx, { collection: 'pay_inputs', summary: 'Imported ' + plan.rows.length + ' pay inputs (batch ' + batch + ')' });
  return { added: plan.rows.length, batch: batch };
}

/* ------------------------------------------------------------ openings */

function openingView(app, r) {
  const util = u();
  return { id: r.id, employment: r.getString('employment'), day: r.getString('day'), currency: r.getString('currency'), by_tag: util.jsonOf(r, 'by_tag', {}) || {}, by_code: util.jsonOf(r, 'by_code', {}) || {}, source: r.getString('source'), note: r.getString('note'), created: r.getString('created') };
}

function openingsList(ctx, p) {
  const util = u();
  const m = employment(ctx, util.req(p, 'employment'), 'view');
  return { openings: util.findMany(ctx.app, 'ytd_openings', 'employment = {:e}', 'day', 0, { e: m.id }).map((r) => openingView(ctx.app, r)) };
}

/** ytd.set: year-to-date figures from before HR OS or from a previous employer (become an opening history row). */
function openingsSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const m = employment(ctx, util.req(p, 'employment'), 'full');
  const day = util.day(p, 'day', '');
  if (day === '') throw util.fail(400, 'day is required: the go-live day the figures are up to (exclusive).', 'missing_param', { param: 'day' });
  const nums = (o, what) => {
    const out = {};
    for (const k of Object.keys(o || {})) {
      if (!/^[A-Za-z0-9_]{1,60}$/.test(k)) throw util.fail(400, what + ' keys are tags or codes.', 'invalid_param');
      const n = Number(o[k]);
      if (!Number.isFinite(n)) throw util.fail(400, what + '.' + k + ' must be a number (major units).', 'invalid_param');
      out[k] = n;
    }
    return out;
  };
  const rec = util.str(p, 'opening', '') !== '' ? util.byId(app, 'ytd_openings', util.str(p, 'opening', '')) : util.newRecord(app, 'ytd_openings');
  if (rec === null) throw util.fail(404, 'No such opening balance.', 'not_found');
  const before = rec.id ? openingView(app, rec) : null;
  rec.set('employment', m.id);
  rec.set('day', day);
  rec.set('currency', currencyOf(app, m));
  rec.set('by_tag', nums(util.obj(p, 'by_tag') || {}, 'by_tag'));
  rec.set('by_code', nums(util.obj(p, 'by_code') || {}, 'by_code'));
  rec.set('source', util.oneOf(p, 'source', ['migration', 'previous_employer'], 'migration'));
  rec.set('note', util.text(p, 'note', 1000, ''));
  rec.set('created_by', ctx.memberId);
  app.save(rec);
  stale(ctx, m.id, 'Opening balances changed.');
  L('lib_audit').note(ctx, { collection: 'ytd_openings', record: rec.id, summary: 'Saved opening year-to-date figures for ' + nameOf(app, m) + ' (to ' + day + ')', before: before, after: openingView(app, rec) });
  return { opening: openingView(app, rec) };
}

function openingsDelete(ctx, p) {
  const util = u();
  const rec = util.byId(ctx.app, 'ytd_openings', util.req(p, 'opening'));
  if (rec === null) throw util.fail(404, 'No such opening balance.', 'not_found');
  const m = ctx.app.findRecordById('employments', rec.getString('employment'));
  L('lib_payroll').need(ctx, 'full', m.getString('entity'));
  const before = openingView(ctx.app, rec);
  ctx.app.delete(rec);
  stale(ctx, m.id, 'Opening balances changed.');
  L('lib_audit').note(ctx, { collection: 'ytd_openings', record: rec.id, summary: 'Deleted opening figures of ' + nameOf(ctx.app, m), before: before });
  return { deleted: true };
}

/* ------------------------------------------------ compensation changes */

function compView(app, r) {
  const util = u();
  return { id: r.id, employment: r.getString('employment'), effective_from: r.getString('effective_from'), basis: r.getString('basis'), amount_minor: r.getInt('amount_minor'), currency: r.getString('currency'), per: r.getString('per'), pay_schedule: r.getString('pay_schedule'), reason: r.getString('reason'), note: r.getString('note'), status: r.getString('status'), approval: r.getString('approval'), pay_record: r.getString('pay_record'), retro: r.getBool('retro'), backpay: r.getString('backpay'), requested_by_name: r.getString('requested_actor') === 'agent' ? 'Your AI agent' : (util.byId(app, 'members', r.getString('requested_by')) || { getString: () => '' }).getString('name'), created: r.getString('created') };
}

/** May the caller ask for a pay change for this employment (payroll edit, or their manager)? */
function canRequestPay(ctx, m) {
  const auth = L('lib_auth');
  if (ctx.isAgent) return true;
  if (auth.can(ctx, 'payroll', 'edit') && auth.inScope(ctx, m.getString('entity'))) return true;
  return auth.isManagerOf(ctx, m.id, u().today(ctx.app, m.getString('entity')));
}

/** comp.list: the pay timeline (past, current, scheduled) and the change requests of an employment. */
function compList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const m = people().employmentRef(app, util.req(p, 'employment'));
  people().needSee(ctx, m);
  if (!people().canSeePay(ctx, m)) throw util.fail(403, 'You cannot see the pay of this person.', 'not_permitted');
  const today = util.today(app, m.getString('entity'));
  const recs = util.findMany(app, 'pay_records', 'employment = {:e}', 'effective_from', 0, { e: m.id }).map((r, i, arr) => {
    const v = people().payView(r);
    const next = arr[i + 1];
    v.state = r.getString('effective_from') > today ? 'scheduled' : next && next.getString('effective_from') <= today ? 'past' : 'current';
    return v;
  });
  return { employment: m.id, currency: currencyOf(app, m), today: today, start_day: m.getString('start_day'), records: recs, requests: util.findMany(app, 'comp_changes', 'employment = {:e}', '-created', 100, { e: m.id }).map((r) => compView(app, r)), can_request: canRequestPay(ctx, m) };
}

/** comp.request: ask for a pay change from a day; a pay_change approval decides it. */
function compRequest(ctx, p) {
  const util = u();
  const app = ctx.app;
  const m = people().employmentRef(app, util.req(p, 'employment'));
  if (!canRequestPay(ctx, m)) throw util.fail(403, 'Only payroll or the person\'s manager can ask for a pay change.', 'not_permitted');
  const cur = currencyOf(app, m);
  const day = util.day(p, 'effective_from', util.today(app, m.getString('entity')));
  if (day < m.getString('start_day')) throw util.fail(400, 'Pay can start on the first day of work or later.', 'before_start', { param: 'effective_from', start_day: m.getString('start_day') });
  const cur0 = people().rowOn(app, 'pay_records', m.id, day);
  const basis = util.oneOf(p, 'basis', ['salary', 'hourly', 'daily'], cur0 ? cur0.getString('basis') : 'salary');
  const per = util.oneOf(p, 'per', ['year', 'month', 'week', 'day', 'hour'], cur0 ? cur0.getString('per') : basis === 'hourly' ? 'hour' : basis === 'daily' ? 'day' : 'month');
  if (basis === 'hourly' && per !== 'hour') throw util.fail(400, 'An hourly rate is per hour.', 'invalid_param');
  if (basis === 'daily' && per !== 'day') throw util.fail(400, 'A daily rate is per day.', 'invalid_param');
  const amount = util.money(p, 'amount', cur, { required: true, positive: true });
  const reason = util.oneOf(p, 'reason', PAY_REASONS, '');
  if (reason === '') throw util.fail(400, 'reason is one of: ' + PAY_REASONS.join(', '), 'missing_param', { param: 'reason' });
  const lockedAfter = util.count(app, "SELECT COUNT(*) AS n FROM payslips WHERE employment = {:e} AND status IN ('locked', 'published') AND period_end >= {:d}", { e: m.id, d: day });
  let rec = null;
  let approval = null;
  app.runInTransaction((tx) => {
    const t = L('lib_auth').withApp(ctx, tx);
    rec = util.newRecord(tx, 'comp_changes');
    rec.set('employment', m.id);
    rec.set('effective_from', day);
    rec.set('basis', basis);
    rec.set('amount_minor', amount);
    rec.set('currency', cur);
    rec.set('per', per);
    rec.set('pay_schedule', util.text(p, 'pay_schedule', 30, '') || (cur0 ? cur0.getString('pay_schedule') : ''));
    rec.set('reason', reason);
    rec.set('note', util.text(p, 'note', 2000, ''));
    rec.set('status', 'pending');
    rec.set('retro', lockedAfter > 0);
    rec.set('backpay', lockedAfter > 0 ? 'none' : '');
    rec.set('requested_by', ctx.memberId);
    rec.set('requested_actor', ctx.isAgent ? 'agent' : 'person');
    tx.save(rec);
    const was = cur0 ? L('lib_money').format(cur0.getInt('amount_minor'), cur) + ' a ' + cur0.getString('per') : 'none';
    approval = L('lib_approvals').open(t, {
      kind: 'pay_change',
      ref_collection: 'comp_changes',
      ref_id: rec.id,
      employment: m.id,
      summary: 'Pay change for ' + nameOf(tx, m) + ' from ' + day + ' (' + reason + ')',
      amount_minor: amount,
      currency: cur,
      facts: (cur0 ? [{ type: 'money', key: 'before', label: (PAY_PER_LABEL[cur0.getString('per')] || 'Pay') + ' before', amount_minor: cur0.getInt('amount_minor'), currency: cur0.getString('currency') || cur }] : []).concat([{ type: 'money', key: 'after', label: (PAY_PER_LABEL[per] || 'Pay') + ' after', amount_minor: amount, currency: cur }, { type: 'day', key: 'effective_from', label: 'From', value: day }, { type: 'state', key: 'reason', label: 'Reason', value: reason }]),
      payload: { employment: m.id, effective_from: day, basis: basis, per: per, amount_minor: amount, before_minor: cur0 ? cur0.getInt('amount_minor') : 0, before_per: cur0 ? cur0.getString('per') : '', before_text: was, reason: reason, retro: lockedAfter > 0 },
    });
    const r2 = tx.findRecordById('comp_changes', rec.id);
    if (r2.getString('status') === 'pending') {
      r2.set('approval', approval.id);
      tx.save(r2);
    }
    L('lib_audit').write(t, { op: 'comp.request', collection: 'comp_changes', record: rec.id, summary: 'Asked for a pay change for ' + nameOf(tx, m) + ' from ' + day });
  });
  ctx.audited = true;
  return { request: compView(app, app.findRecordById('comp_changes', rec.id)), approval: approval };
}

function compCancel(ctx, p) {
  const util = u();
  const rec = util.byId(ctx.app, 'comp_changes', util.req(p, 'request'));
  if (rec === null) throw util.fail(404, 'No such pay change request.', 'not_found');
  if (rec.getString('status') !== 'pending') throw util.fail(409, 'This request is ' + rec.getString('status') + '.', 'conflict');
  L('lib_approvals').cancel(ctx, rec.getString('approval'), util.text(p, 'note', 1000, ''));
  return { request: compView(ctx.app, ctx.app.findRecordById('comp_changes', rec.id)) };
}

/** Approval subscriber (kind pay_change): approved -> the kernel pay record from the day. */
function onPayChange(ctx, approval, decision, note) {
  const util = u();
  const app = ctx.app;
  const rec = util.byId(app, 'comp_changes', approval.ref_id);
  if (rec === null) return;
  if (decision !== 'approved') {
    rec.set('status', decision === 'rejected' ? 'rejected' : 'cancelled');
    app.save(rec);
    return;
  }
  const m = app.findRecordById('employments', rec.getString('employment'));
  const values = { basis: rec.getString('basis'), amount_minor: rec.getInt('amount_minor'), currency: rec.getString('currency'), per: rec.getString('per'), pay_schedule: rec.getString('pay_schedule') };
  let pay = util.findOne(app, 'pay_records', 'employment = {:e} && effective_from = {:d}', { e: m.id, d: rec.getString('effective_from') });
  if (pay !== null) {
    const block = L('lib_payroll').onRecordEditing(ctx, { collection: 'pay_records', id: pay.id, employment: m.id, effective_from: pay.getString('effective_from') });
    if (block && block.block) throw util.fail(409, block.block + ' Ask for the change from a later day.', 'locked');
    for (const k of ['basis', 'amount_minor', 'per', 'pay_schedule']) pay.set(k, values[k]);
    pay.set('reason', rec.getString('reason'));
    pay.set('approved_by', ctx.memberId || '');
    app.save(pay);
  } else pay = people().writePay(app, m.id, rec.getString('effective_from'), values, rec.getString('reason'), rec.getString('note'), ctx.memberId || '');
  rec.set('status', 'approved');
  rec.set('pay_record', pay.id);
  app.save(rec);
  L('lib_events').emit(ctx, 'employment.changed', { employment: m.id, kind: 'pay', record: pay.id, effective_from: rec.getString('effective_from') });
}

/* ------------------------------------------------------------ back pay */

/** employment.changed (pay): a change back-dated into a locked period asks payroll for back pay. */
function suggestBackpay(ctx, employmentId, effectiveFrom) {
  const util = u();
  const app = ctx.app;
  const n = util.count(app, "SELECT COUNT(*) AS n FROM payslips WHERE employment = {:e} AND kind = 'regular' AND status IN ('locked', 'published') AND period_end >= {:d}", { e: employmentId, d: effectiveFrom });
  if (n === 0) return { backpay: false };
  for (const c of util.findMany(app, 'comp_changes', "employment = {:e} && status = 'approved' && effective_from = {:d}", '', 0, { e: employmentId, d: effectiveFrom })) {
    c.set('retro', true);
    c.set('backpay', 'suggested');
    app.save(c);
  }
  const m = app.findRecordById('employments', employmentId);
  L('lib_notify').toRole(app, 'payroll_admin', { kind: 'payroll', title: 'Back pay to review: ' + nameOf(app, m) + ' from ' + effectiveFrom + ' (' + n + ' locked period' + (n === 1 ? '' : 's') + ')', body: '', link: '#/payroll/backpay?employment=' + employmentId + '&from=' + effectiveFrom, facts: [{ type: 'day', key: 'effective_from', label: 'From', value: effectiveFrom }, { type: 'number', key: 'periods', label: 'Locked periods', value: n, unit: n === 1 ? 'period' : 'periods' }] });
  return { backpay: true, periods: n };
}

/** Per locked period since `from`: what the base pay was and what it is with today's pay records, and the net effect with the then-active packs. */
function backpayPlan(app, m, from) {
  const util = u();
  const calc = L('lib_payroll_calc');
  const engine = L('lib_engine');
  const slips = util.findMany(app, 'payslips', "employment = {:e} && kind = 'regular' && (status = 'locked' || status = 'published') && period_end >= {:d}", 'period_start', 0, { e: m.id, d: from });
  const out = [];
  const roleOf = {};
  for (const r of util.findMany(app, 'pay_components', "entity = {:e} || entity = ''", '', 0, { e: m.getString('entity') })) roleOf[r.getString('code')] = r.getString('role');
  const baseRoles = { basic: true, hourly: true, daily: true, unpaid: true };
  for (const s of slips) {
    const run = app.findRecordById('payruns', s.getString('payrun'));
    if (run.getString('status') === 'void') continue;
    const rc = calc.runContext(app, run);
    const built = calc.buildInput(app, rc, m.id, { correction: s });
    if (built === null) continue;
    const cur = rc.currency;
    const was = util.rows(app, "SELECT code, amount_minor FROM payslip_lines WHERE payslip = {:p} AND source = 'input'", { code: '', amount_minor: 0 }, { p: s.id }).filter((l) => baseRoles[roleOf[l.code]]).reduce((a, l) => a + l.amount_minor, 0);
    let now = 0;
    for (const l of built.input.lines) if (baseRoles[roleOf[l.code]]) now += L('lib_money').majorToMinor(l.amount, cur);
    const res = engine.calculate(built.input, built.packs);
    let net = 0;
    for (const l of res.lines) {
      const a = L('lib_money').majorToMinor(l.amount, cur);
      if (l.kind === 'earning' || l.kind === 'reimbursement') net += a;
      else if (l.kind === 'deduction') net -= a;
    }
    out.push({ payslip: s.id, payrun: run.id, payrun_number: run.getString('number'), period_start: s.getString('period_start'), period_end: s.getString('period_end'), pay_date: s.getString('pay_date'), was_minor: was, now_minor: now, diff_minor: now - was, net_was_minor: s.getInt('net_minor'), net_now_minor: net, net_diff_minor: net - s.getInt('net_minor'), packs: built.packs.map((p) => p.code + ' ' + p.version), currency: cur });
  }
  return out.filter((x) => x.diff_minor !== 0);
}

function backpayPreview(ctx, p) {
  const util = u();
  const app = ctx.app;
  const m = employment(ctx, util.req(p, 'employment'), 'view');
  const from = util.day(p, 'from_day', '');
  if (from === '') throw util.fail(400, 'from_day is required: the day the pay change applies from.', 'missing_param', { param: 'from_day' });
  const plan = backpayPlan(app, m, from);
  return { employment: m.id, name: nameOf(app, m), from_day: from, currency: currencyOf(app, m), periods: plan, total_minor: plan.reduce((a, x) => a + x.diff_minor, 0), net_effect_minor: plan.reduce((a, x) => a + x.net_diff_minor, 0) };
}

/** backpay.apply: put the differences in the next regular run, or in a new off-cycle run, as back pay lines (one per period). */
function backpayApply(ctx, p) {
  const util = u();
  const app = ctx.app;
  const m = employment(ctx, util.req(p, 'employment'), 'edit');
  const from = util.day(p, 'from_day', '');
  if (from === '') throw util.fail(400, 'from_day is required.', 'missing_param', { param: 'from_day' });
  const target = util.oneOf(p, 'target', ['next', 'off_cycle'], 'next');
  const overrides = util.obj(p, 'amounts') || {};
  const plan = backpayPlan(app, m, from);
  if (plan.length === 0) throw util.fail(409, 'There is no difference to pay for those periods.', 'nothing_to_pay');
  const c = L('lib_payroll').componentByRole(app, m.getString('entity'), 'arrears');
  if (c === null) throw util.fail(409, 'There is no back pay component (role arrears). Add one in Components.', 'component_missing');
  const cur = currencyOf(app, m);
  let runId = '';
  if (target === 'off_cycle') {
    const res = L('lib_payroll_runs').create(ctx, { kind: 'off_cycle', entity: m.getString('entity'), employments: [m.id], label: 'Back pay ' + nameOf(app, m), pay_date: util.day(p, 'pay_date', util.today(app, m.getString('entity'))) });
    runId = res.payrun.id;
  }
  const dp = defaultPeriod(app, m);
  const added = [];
  app.runInTransaction((tx) => {
    for (const x of plan) {
      let amt = x.diff_minor;
      if (overrides[x.payslip] !== undefined) {
        const v = L('lib_money').toMinor(String(overrides[x.payslip]), cur, true);
        if (v === null) throw util.fail(400, 'amounts.' + x.payslip + ' is not an amount in ' + cur + '.', 'invalid_param');
        amt = v;
      }
      if (amt === 0) continue;
      const rec = util.newRecord(tx, 'pay_inputs');
      rec.set('employment', m.id);
      rec.set('component', c.id);
      rec.set('period_start', dp.start);
      rec.set('period_end', dp.end);
      rec.set('amount_minor', amt);
      rec.set('qty', 0);
      rec.set('rate_minor', 0);
      rec.set('currency', cur);
      rec.set('source', 'backpay');
      rec.set('ref', x.payslip);
      rec.set('note', 'Back pay for ' + x.period_start + ' to ' + x.period_end);
      rec.set('payrun', runId);
      rec.set('status', 'open');
      rec.set('detail', { period_start: x.period_start, period_end: x.period_end, original_payslip: x.payslip, was_minor: x.was_minor, now_minor: x.now_minor, from_day: from });
      rec.set('created_by', ctx.memberId);
      tx.save(rec);
      added.push(rec.id);
    }
    for (const cc of util.findMany(tx, 'comp_changes', "employment = {:e} && status = 'approved' && retro = true && effective_from >= {:d}", '', 0, { e: m.id, d: from })) {
      cc.set('backpay', 'applied');
      tx.save(cc);
    }
    L('lib_payroll_runs').staleFor(tx, ctx, m.id, 'Back pay added.');
  });
  L('lib_audit').note(ctx, { collection: 'pay_inputs', summary: 'Added back pay for ' + nameOf(app, m) + ' from ' + from + ' (' + added.length + ' periods) to ' + (target === 'next' ? 'the next run' : 'an off-cycle run') });
  return { added: added.length, payrun: runId, inputs: added.map((id) => inputView(app, app.findRecordById('pay_inputs', id))) };
}

/* --------------------------------------------------------------- loans */

function loanView(app, r) {
  const util = u();
  const m = util.byId(app, 'employments', r.getString('employment'));
  const reps = util.findMany(app, 'loan_repayments', 'loan = {:l}', 'day,created', 0, { l: r.id });
  const paid = reps.reduce((a, x) => a + x.getInt('amount_minor'), 0);
  const total = r.getInt('total_minor') || r.getInt('principal_minor');
  // The schedule ahead: installments from the next period until the balance is gone.
  const ahead = [];
  let bal = r.getInt('balance_minor');
  let month = r.getString('start_period') || '';
  const today = m ? util.today(app, m.getString('entity')).slice(0, 7) : '';
  if (month !== '' && month < today) month = today;
  for (let i = 0; i < 600 && bal > 0 && r.getString('status') === 'active' && month !== ''; i++) {
    const a = Math.min(r.getInt('installment_minor'), bal);
    if (a <= 0) break;
    ahead.push({ period: month, amount_minor: a, balance_after_minor: bal - a });
    bal -= a;
    month = util.addMonths(month + '-01', 1).slice(0, 7);
  }
  return {
    id: r.id,
    employment: r.getString('employment'),
    employee_name: m ? nameOf(app, m) : '',
    employee_number: m ? app.findRecordById('employees', m.getString('employee')).getString('number') : '',
    kind: r.getString('kind'),
    principal_minor: r.getInt('principal_minor'),
    total_minor: total,
    currency: r.getString('currency'),
    interest_pct: r.getFloat('interest_pct'),
    installments: r.getInt('installments'),
    installment_minor: r.getInt('installment_minor'),
    start_period: r.getString('start_period'),
    balance_minor: r.getInt('balance_minor'),
    repaid_minor: paid,
    status: r.getString('status'),
    paused: r.getBool('paused'),
    approval: r.getString('approval'),
    reason: r.getString('reason'),
    note: r.getString('note'),
    disbursed_day: r.getString('disbursed_day'),
    repayments: reps.map((x) => ({ id: x.id, day: x.getString('day'), amount_minor: x.getInt('amount_minor'), kind: x.getString('kind'), payrun: x.getString('payrun'), note: x.getString('note') })),
    schedule: ahead,
    created: r.getString('created'),
  };
}

function loanAccess(ctx, m) {
  const auth = L('lib_auth');
  if (ctx.isAgent) return 'view';
  if (auth.can(ctx, 'payroll', 'view') && auth.inScope(ctx, m.getString('entity'))) return auth.can(ctx, 'payroll', 'edit') ? 'edit' : 'view';
  if (auth.selfEmployee(ctx) === m.getString('employee')) return 'self';
  return 'none';
}

function loansList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const auth = L('lib_auth');
  const er = util.str(p, 'employment', '');
  let rows;
  if (er !== '') {
    const m = people().employmentRef(app, er);
    if (loanAccess(ctx, m) === 'none') throw util.fail(403, 'You cannot see these loans.', 'not_permitted');
    rows = util.findMany(app, 'loans', 'employment = {:e}', '-created', 0, { e: m.id });
  } else if (ctx.isAgent || auth.can(ctx, 'payroll', 'view')) {
    const st = util.str(p, 'status', '');
    rows = util.findMany(app, 'loans', st !== '' ? 'status = {:s}' : '1=1', '-created', 1000, { s: st }).filter((r) => {
      const m = util.byId(app, 'employments', r.getString('employment'));
      return m !== null && auth.inScope(ctx, m.getString('entity'));
    });
  } else {
    const self = auth.selfEmployee(ctx);
    rows = self === '' ? [] : util.rows(app, 'SELECT l.id AS id FROM loans l JOIN employments m ON m.id = l.employment WHERE m.employee = {:e} ORDER BY l.created DESC', { id: '' }, { e: self }).map((x) => app.findRecordById('loans', x.id));
  }
  return { loans: rows.map((r) => loanView(app, r)), kinds: LOAN_KINDS };
}

function loanRef(ctx, ref) {
  const util = u();
  const r = util.byId(ctx.app, 'loans', String(ref || ''));
  if (r === null) throw util.fail(404, 'No loan ' + ref + '. Run loans.list.', 'not_found');
  return { rec: r, m: ctx.app.findRecordById('employments', r.getString('employment')) };
}

function loansGet(ctx, p) {
  const x = loanRef(ctx, u().req(p, 'loan'));
  if (loanAccess(ctx, x.m) === 'none') throw u().fail(403, 'You cannot see this loan.', 'not_permitted');
  return { loan: loanView(ctx.app, x.rec) };
}

/** Total to repay with simple yearly interest over monthly installments, and the installment. */
function loanTerms(principal, pct, n) {
  const total = Math.round(principal + (principal * pct * n) / 1200);
  return { total: total, installment: Math.ceil(total / n) };
}

/** loans.request: an employee asks for a loan (or payroll records one); a loan approval decides it. */
function loansRequest(ctx, p) {
  const util = u();
  const app = ctx.app;
  const m = people().employmentRef(app, util.req(p, 'employment'));
  const access = loanAccess(ctx, m);
  if (access !== 'self' && access !== 'edit' && !ctx.isAgent) throw util.fail(403, 'You can ask for a loan for yourself; payroll for anyone.', 'not_permitted');
  const cur = currencyOf(app, m);
  const principal = util.money(p, 'amount', cur, { required: true, positive: true });
  const n = util.int(p, 'installments', 12, 1, 600);
  const pct = access === 'self' ? 0 : util.num(p, 'interest_pct', { min: 0, max: 100, dflt: 0 }) || 0;
  const today = util.today(app, m.getString('entity'));
  const start = util.str(p, 'start_period', '') || util.addMonths(today.slice(0, 8) + '01', 1).slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(start)) throw util.fail(400, 'start_period is a month YYYY-MM, e.g. 2026-12', 'invalid_param');
  const terms = loanTerms(principal, pct, n);
  let rec = null;
  let approval = null;
  app.runInTransaction((tx) => {
    const t = L('lib_auth').withApp(ctx, tx);
    rec = util.newRecord(tx, 'loans');
    rec.set('employment', m.id);
    rec.set('kind', util.oneOf(p, 'kind', LOAN_KINDS, 'personal'));
    rec.set('principal_minor', principal);
    rec.set('currency', cur);
    rec.set('interest_pct', pct);
    rec.set('installments', n);
    rec.set('start_period', start);
    rec.set('installment_minor', terms.installment);
    rec.set('balance_minor', 0);
    rec.set('total_minor', terms.total);
    rec.set('status', 'requested');
    rec.set('reason', util.text(p, 'reason', 1000, ''));
    rec.set('paused', false);
    rec.set('requested_by', ctx.memberId);
    rec.set('requested_actor', ctx.isAgent ? 'agent' : 'person');
    tx.save(rec);
    approval = L('lib_approvals').open(t, {
      kind: 'loan',
      ref_collection: 'loans',
      ref_id: rec.id,
      employment: m.id,
      summary: 'Loan for ' + nameOf(tx, m) + ': ' + n + ' installments from ' + start,
      amount_minor: principal,
      currency: cur,
      facts: [{ type: 'money', key: 'principal', label: 'Loan', amount_minor: principal, currency: cur }, { type: 'number', key: 'installments', label: 'Installments', value: n, unit: n === 1 ? 'installment' : 'installments' }, { type: 'money', key: 'installment', label: 'Each installment', amount_minor: terms.installment, currency: cur }, { type: 'range', key: 'first_month', label: 'First installment', from: start + '-01', to: util.monthEnd(start + '-01') }],
      payload: { principal_minor: principal, total_minor: terms.total, installment_minor: terms.installment, installments: n, start_period: start, interest_pct: pct, kind: rec.getString('kind'), reason: rec.getString('reason') },
    });
    const r2 = tx.findRecordById('loans', rec.id);
    if (r2.getString('status') === 'requested') {
      r2.set('approval', approval.id);
      tx.save(r2);
    }
    L('lib_audit').write(t, { op: 'loans.request', collection: 'loans', record: rec.id, summary: 'Asked for a loan of ' + L('lib_money').format(principal, cur) + ' for ' + nameOf(tx, m) });
  });
  ctx.audited = true;
  return { loan: loanView(app, app.findRecordById('loans', rec.id)), approval: approval };
}

/** Approval subscriber (kind loan). */
function onLoanDecision(ctx, approval, decision, note) {
  const util = u();
  const app = ctx.app;
  const rec = util.byId(app, 'loans', approval.ref_id);
  if (rec === null) return;
  if (decision === 'approved') {
    rec.set('status', 'active');
    rec.set('balance_minor', rec.getInt('total_minor') || rec.getInt('principal_minor'));
    rec.set('disbursed_day', util.today(app, app.findRecordById('employments', rec.getString('employment')).getString('entity')));
    rec.set('note', util.clip(note || '', 2000));
  } else rec.set('status', decision === 'rejected' ? 'rejected' : 'cancelled');
  app.save(rec);
}

function loansCancel(ctx, p) {
  const util = u();
  const x = loanRef(ctx, util.req(p, 'loan'));
  if (x.rec.getString('status') !== 'requested') throw util.fail(409, 'Only a loan still waiting for approval can be withdrawn.', 'conflict');
  L('lib_approvals').cancel(ctx, x.rec.getString('approval'), util.text(p, 'note', 1000, ''));
  return { loan: loanView(ctx.app, ctx.app.findRecordById('loans', x.rec.id)) };
}

/** loans.reschedule: change the installment, pause or resume, or move the start (payroll). */
function loansReschedule(ctx, p) {
  const util = u();
  const app = ctx.app;
  const x = loanRef(ctx, util.req(p, 'loan'));
  L('lib_payroll').need(ctx, 'full', x.m.getString('entity'), 'change loans');
  if (x.rec.getString('status') !== 'active') throw util.fail(409, 'Only an active loan is rescheduled.', 'conflict');
  const before = loanView(app, x.rec);
  if (util.has(p, 'installment')) x.rec.set('installment_minor', util.money(p, 'installment', x.rec.getString('currency'), { positive: true }));
  if (util.has(p, 'installments')) x.rec.set('installment_minor', Math.ceil(x.rec.getInt('balance_minor') / util.int(p, 'installments', 1, 1, 600)));
  if (util.has(p, 'paused')) x.rec.set('paused', util.bool(p, 'paused', false));
  if (util.has(p, 'start_period')) {
    const s = util.str(p, 'start_period', '');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) throw util.fail(400, 'start_period is YYYY-MM.', 'invalid_param');
    x.rec.set('start_period', s);
  }
  app.save(x.rec);
  stale(ctx, x.m.id, 'Loan changed.');
  L('lib_audit').note(ctx, { collection: 'loans', record: x.rec.id, summary: 'Rescheduled the loan of ' + nameOf(app, x.m), before: before, after: loanView(app, x.rec) });
  return { loan: loanView(app, x.rec) };
}

/** loans.repay: record a repayment made outside payroll (cash or transfer). */
function loansRepay(ctx, p) {
  const util = u();
  const app = ctx.app;
  const x = loanRef(ctx, util.req(p, 'loan'));
  L('lib_payroll').need(ctx, 'full', x.m.getString('entity'), 'record loan repayments');
  if (x.rec.getString('status') !== 'active') throw util.fail(409, 'Only an active loan takes repayments.', 'conflict');
  const amt = util.money(p, 'amount', x.rec.getString('currency'), { required: true, positive: true });
  if (amt > x.rec.getInt('balance_minor')) throw util.fail(400, 'That is more than the balance (' + L('lib_money').format(x.rec.getInt('balance_minor'), x.rec.getString('currency')) + ').', 'invalid_param');
  app.runInTransaction((tx) => {
    const r = util.newRecord(tx, 'loan_repayments');
    r.set('loan', x.rec.id);
    r.set('employment', x.m.id);
    r.set('day', util.day(p, 'day', util.today(tx, x.m.getString('entity'))));
    r.set('amount_minor', amt);
    r.set('kind', 'manual');
    r.set('note', util.text(p, 'note', 1000, ''));
    r.set('recorded_by', ctx.memberId);
    tx.save(r);
    const l = tx.findRecordById('loans', x.rec.id);
    l.set('balance_minor', l.getInt('balance_minor') - amt);
    if (l.getInt('balance_minor') <= 0) l.set('status', 'closed');
    tx.save(l);
  });
  stale(ctx, x.m.id, 'Loan repaid.');
  L('lib_audit').note(ctx, { collection: 'loans', record: x.rec.id, summary: 'Recorded a loan repayment of ' + L('lib_money').format(amt, x.rec.getString('currency')) + ' from ' + nameOf(app, x.m) });
  return { loan: loanView(app, app.findRecordById('loans', x.rec.id)) };
}

/** loans.write-off: write off the balance (PIN). */
function loansWriteOff(ctx, p) {
  const util = u();
  const app = ctx.app;
  const x = loanRef(ctx, util.req(p, 'loan'));
  L('lib_payroll').need(ctx, 'full', x.m.getString('entity'), 'write off loans');
  if (x.rec.getString('status') !== 'active') throw util.fail(409, 'Only an active loan is written off.', 'conflict');
  const reason = util.text(p, 'reason', 1000, '');
  if (reason === '') throw util.fail(400, 'reason is required.', 'missing_param', { param: 'reason' });
  const bal = x.rec.getInt('balance_minor');
  app.runInTransaction((tx) => {
    const r = util.newRecord(tx, 'loan_repayments');
    r.set('loan', x.rec.id);
    r.set('employment', x.m.id);
    r.set('day', util.today(tx, x.m.getString('entity')));
    r.set('amount_minor', bal);
    r.set('kind', 'writeoff');
    r.set('note', reason);
    r.set('recorded_by', ctx.memberId);
    tx.save(r);
    const l = tx.findRecordById('loans', x.rec.id);
    l.set('balance_minor', 0);
    l.set('status', 'written_off');
    tx.save(l);
  });
  stale(ctx, x.m.id, 'Loan written off.');
  L('lib_audit').note(ctx, { collection: 'loans', record: x.rec.id, summary: 'Wrote off ' + L('lib_money').format(bal, x.rec.getString('currency')) + ' of the loan of ' + nameOf(app, x.m) + ' (' + reason + ')' });
  return { loan: loanView(app, app.findRecordById('loans', x.rec.id)) };
}

/* ------------------------------------------------------------ benefits */

function planView(app, r) {
  const util = u();
  const code = (id) => {
    const c = id ? util.byId(app, 'pay_components', id) : null;
    return c ? c.getString('code') : '';
  };
  return { id: r.id, entity: r.getString('entity'), name: r.getString('name'), kind: r.getString('kind'), employee_component: r.getString('employee_component'), employee_component_code: code(r.getString('employee_component')), employer_component: r.getString('employer_component'), employer_component_code: code(r.getString('employer_component')), amount_minor: r.getInt('amount_minor'), employer_amount_minor: r.getInt('employer_amount_minor'), percent: r.getFloat('percent'), employer_percent: r.getFloat('employer_percent'), currency: r.getString('currency'), active: r.getBool('active'), note: r.getString('note'), enrolled: util.count(app, "SELECT COUNT(*) AS n FROM benefit_enrollments WHERE plan = {:p} AND (to_day = '' OR to_day >= {:d})", { p: r.id, d: util.today(app, r.getString('entity')) }) };
}

function plansList(ctx, p) {
  const util = u();
  L('lib_payroll').need(ctx, 'view');
  const ent = L('lib_payroll').entityParam(ctx, p, false);
  return { plans: util.findMany(ctx.app, 'benefit_plans', ent ? 'entity = {:e}' : '1=1', 'name', 0, { e: ent ? ent.id : '' }).filter((r) => L('lib_auth').inScope(ctx, r.getString('entity'))).map((r) => planView(ctx.app, r)), kinds: PLAN_KINDS };
}

function planSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const pr = L('lib_payroll');
  const id = util.str(p, 'plan', '');
  let rec;
  let ent;
  if (id !== '') {
    rec = util.byId(app, 'benefit_plans', id);
    if (rec === null) throw util.fail(404, 'No such plan.', 'not_found');
    ent = app.findRecordById('entities', rec.getString('entity'));
  } else {
    ent = pr.entityParam(ctx, p, true);
    rec = util.newRecord(app, 'benefit_plans');
    rec.set('entity', ent.id);
    rec.set('active', true);
  }
  pr.need(ctx, 'full', ent.id, 'change benefit plans');
  const before = id !== '' ? planView(app, rec) : null;
  if (id === '' || util.has(p, 'name')) {
    const n = util.squash(util.text(p, 'name', 120, ''));
    if (n === '') throw util.fail(400, 'name is required', 'missing_param', { param: 'name' });
    rec.set('name', n);
  }
  if (id === '' || util.has(p, 'kind')) rec.set('kind', util.oneOf(p, 'kind', PLAN_KINDS, 'other'));
  for (const k of ['employee_component', 'employer_component']) {
    if (!util.has(p, k)) continue;
    const ref = util.str(p, k, '');
    if (ref === '') rec.set(k, '');
    else {
      const c = pr.componentRef(app, ent.id, ref);
      const want = k === 'employee_component' ? 'deduction' : 'employer';
      if (c.getString('kind') !== want) throw util.fail(400, k + ' must be a ' + want + ' component (' + c.getString('code') + ' is ' + c.getString('kind') + ').', 'invalid_param');
      rec.set(k, c.id);
    }
  }
  const cur = ent.getString('currency');
  if (util.has(p, 'amount')) rec.set('amount_minor', util.money(p, 'amount', cur, {}) || 0);
  if (util.has(p, 'employer_amount')) rec.set('employer_amount_minor', util.money(p, 'employer_amount', cur, {}) || 0);
  if (util.has(p, 'percent')) rec.set('percent', util.num(p, 'percent', { min: 0, max: 100 }) || 0);
  if (util.has(p, 'employer_percent')) rec.set('employer_percent', util.num(p, 'employer_percent', { min: 0, max: 100 }) || 0);
  rec.set('currency', cur);
  if (util.has(p, 'active')) rec.set('active', util.bool(p, 'active', true));
  if (util.has(p, 'note')) rec.set('note', util.text(p, 'note', 1000, ''));
  if (rec.getString('employee_component') === '' && rec.getString('employer_component') === '') throw util.fail(400, 'A plan needs an employee_component (deduction) or an employer_component (employer cost).', 'missing_param');
  app.save(rec);
  L('lib_audit').note(ctx, { collection: 'benefit_plans', record: rec.id, summary: (id === '' ? 'Added' : 'Changed') + ' the benefit plan ' + rec.getString('name'), before: before, after: planView(app, rec) });
  return { plan: planView(app, rec) };
}

function enrollmentView(app, r) {
  const util = u();
  const plan = util.byId(app, 'benefit_plans', r.getString('plan'));
  return { id: r.id, employment: r.getString('employment'), plan: r.getString('plan'), plan_name: plan ? plan.getString('name') : '', kind: plan ? plan.getString('kind') : '', from_day: r.getString('from_day'), to_day: r.getString('to_day'), override: r.getBool('override'), amount_minor: r.getInt('amount_minor'), employer_amount_minor: r.getInt('employer_amount_minor'), coverage: r.getString('coverage'), note: r.getString('note') };
}

function enrollmentsList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const m = people().employmentRef(app, util.req(p, 'employment'));
  people().needSee(ctx, m);
  if (!people().canSeePay(ctx, m)) throw util.fail(403, 'You cannot see the pay of this person.', 'not_permitted');
  return { enrollments: util.findMany(app, 'benefit_enrollments', 'employment = {:e}', '-from_day', 0, { e: m.id }).map((r) => enrollmentView(app, r)) };
}

function enroll(ctx, p) {
  const util = u();
  const app = ctx.app;
  const m = employment(ctx, util.req(p, 'employment'), 'edit');
  const plan = util.byId(app, 'benefit_plans', util.req(p, 'plan'));
  if (plan === null || plan.getString('entity') !== m.getString('entity')) throw util.fail(404, 'No such plan for this entity. Run benefits.plans.', 'not_found');
  const cur = currencyOf(app, m);
  const rec = util.newRecord(app, 'benefit_enrollments');
  rec.set('employment', m.id);
  rec.set('plan', plan.id);
  rec.set('from_day', util.day(p, 'from_day', util.today(app, m.getString('entity'))));
  rec.set('to_day', util.day(p, 'to_day', ''));
  const override = util.has(p, 'amount') || util.has(p, 'employer_amount');
  rec.set('override', override);
  rec.set('amount_minor', util.money(p, 'amount', cur, {}) || 0);
  rec.set('employer_amount_minor', util.money(p, 'employer_amount', cur, {}) || 0);
  rec.set('coverage', util.text(p, 'coverage', 60, ''));
  rec.set('note', util.text(p, 'note', 1000, ''));
  app.save(rec);
  stale(ctx, m.id, 'Benefits changed.');
  L('lib_audit').note(ctx, { collection: 'benefit_enrollments', record: rec.id, summary: 'Enrolled ' + nameOf(app, m) + ' in ' + plan.getString('name') + ' from ' + rec.getString('from_day') });
  return { enrollment: enrollmentView(app, rec) };
}

function enrollEnd(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rec = util.byId(app, 'benefit_enrollments', util.req(p, 'enrollment'));
  if (rec === null) throw util.fail(404, 'No such enrolment.', 'not_found');
  const m = app.findRecordById('employments', rec.getString('employment'));
  L('lib_payroll').need(ctx, 'edit', m.getString('entity'), 'change benefits');
  const day = util.day(p, 'to_day', util.today(app, m.getString('entity')));
  if (day < rec.getString('from_day')) throw util.fail(400, 'to_day is before the enrolment starts.', 'invalid_param');
  rec.set('to_day', day);
  app.save(rec);
  stale(ctx, m.id, 'Benefits changed.');
  L('lib_audit').note(ctx, { collection: 'benefit_enrollments', record: rec.id, summary: 'Ended a benefit of ' + nameOf(app, m) + ' on ' + day });
  return { enrollment: enrollmentView(app, rec) };
}

module.exports = {
  LOAN_KINDS: LOAN_KINDS,
  PLAN_KINDS: PLAN_KINDS,
  usedByLocked: usedByLocked,
  recurringView: recurringView,
  recurringList: recurringList,
  recurringSave: recurringSave,
  recurringEnd: recurringEnd,
  inputView: inputView,
  inputsList: inputsList,
  inputsAdd: inputsAdd,
  inputsUpdate: inputsUpdate,
  inputsVoid: inputsVoid,
  importCheck: importCheck,
  importCommit: importCommit,
  openingsList: openingsList,
  openingsSave: openingsSave,
  openingsDelete: openingsDelete,
  compView: compView,
  compList: compList,
  compRequest: compRequest,
  compCancel: compCancel,
  onPayChange: onPayChange,
  suggestBackpay: suggestBackpay,
  backpayPreview: backpayPreview,
  backpayApply: backpayApply,
  loanView: loanView,
  loansList: loansList,
  loansGet: loansGet,
  loansRequest: loansRequest,
  onLoanDecision: onLoanDecision,
  loansCancel: loansCancel,
  loansReschedule: loansReschedule,
  loansRepay: loansRepay,
  loansWriteOff: loansWriteOff,
  plansList: plansList,
  planSave: planSave,
  enrollmentsList: enrollmentsList,
  enroll: enroll,
  enrollEnd: enrollEnd,
};
