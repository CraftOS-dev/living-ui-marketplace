/// <reference path="../pb_data/types.d.ts" />
/**
 * Payroll as data: pay components, pay runs and payslips. No statutory
 * calculations are built in; components are earnings, deductions and
 * employer contributions, each a fixed amount or a percent of basic pay,
 * with the accounts they post to.
 *
 *   draft (computed, adjustable) -> approved -> posted -> paid
 *
 * - Basic pay per month from the pay frequency: monthly x1, semi-monthly x2,
 *   biweekly x26/12, weekly x52/12 (exact, rounded half away from zero).
 * - A component applies to everyone ('all') or to people it is assigned to
 *   ('selected'); an assignment may override the amount or the percent.
 * - Gross = basic + earnings; net = gross - deductions; employer
 *   contributions are a cost on top.
 * - Posting writes ONE entry per run, aggregated by account: Dr salaries
 *   and earning accounts, Dr employer contribution accounts; Cr deduction
 *   accounts, Cr employer liability accounts, Cr salaries payable (net).
 *   Paying: Dr salaries payable, Cr the bank account.
 * - Payslips keep the accounts they were computed with, so a component
 *   changed later never changes a run already approved.
 */

/* require() resolves the module path on every call (milliseconds each); each module is looked up once. */
let uMod = null;
function u() {
  if (uMod === null) uMod = require(`${__hooks}/lib_util.js`);
  return uMod;
}
let coreMod = null;
function core() {
  if (coreMod === null) coreMod = require(`${__hooks}/lib_core.js`);
  return coreMod;
}
let authMod = null;
function auth() {
  if (authMod === null) authMod = require(`${__hooks}/lib_auth.js`);
  return authMod;
}
let moneyMod = null;
function money() {
  if (moneyMod === null) moneyMod = require(`${__hooks}/lib_money.js`);
  return moneyMod;
}
let peopleMod = null;
function people() {
  if (peopleMod === null) peopleMod = require(`${__hooks}/lib_people.js`);
  return peopleMod;
}
let auditMod = null;
function audit() {
  if (auditMod === null) auditMod = require(`${__hooks}/lib_audit.js`);
  return auditMod;
}
let ledgerMod = null;
function ledger() {
  if (ledgerMod === null) ledgerMod = require(`${__hooks}/lib_ledger.js`);
  return ledgerMod;
}
let claimsLibMod = null;
function claimsLib() {
  if (claimsLibMod === null) claimsLibMod = require(`${__hooks}/lib_claims.js`);
  return claimsLibMod;
}


const KINDS = ['earning', 'deduction', 'employer'];
const CALCS = ['fixed', 'percent'];
const APPLIES = ['all', 'selected'];
const FACTOR = { monthly: [1, 1], semi_monthly: [2, 1], biweekly: [26, 12], weekly: [52, 12] };
const RUN_STATUSES = ['draft', 'approved', 'posted', 'paid'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function monthName(m) {
  return MONTHS[Number(m.slice(5, 7)) - 1] + ' ' + m.slice(0, 4);
}

/* ============================================================ accounts */

const DEFAULT_KEY = { earning: 'salaries', deduction: 'payroll_liabilities', employer: 'employer_contributions' };

function defaultAccount(app, kind) {
  return core().systemAccount(app, DEFAULT_KEY[kind]).id;
}

function defaultLiability(app) {
  return core().systemAccount(app, 'payroll_liabilities').id;
}

function payAccount(app, ref, what) {
  const util = u();
  const a = core().resolve(app, 'accounts', ref);
  if (a.getBool('archived')) throw util.fail(409, what + ': ' + a.getString('code') + ' ' + a.getString('name') + ' is archived.', 'account_archived');
  if (a.getBool('control')) throw util.fail(400, what + ': ' + a.getString('code') + ' ' + a.getString('name') + ' is a control account.', 'control_account');
  return a;
}

function accBrief(app, id, cache) {
  if (typeof id !== 'string' || id === '') return null;
  const key = 'a:' + id;
  if (cache[key] === undefined) {
    const a = u().byId(app, 'accounts', id);
    cache[key] = a === null ? null : { id: a.id, code: a.getString('code'), name: a.getString('name') };
  }
  return cache[key];
}

/* ========================================================== components */

function componentOut(app, c, counts, cache) {
  const cur = core().currency(app);
  const m = money();
  return {
    id: c.id,
    name: c.getString('name'),
    kind: c.getString('kind'),
    calc: c.getString('calc'),
    amount: c.getInt('amount'),
    amount_text: m.minorText(c.getInt('amount'), cur),
    percent: m.bpText(c.getInt('percent_bp')),
    percent_bp: c.getInt('percent_bp'),
    account: accBrief(app, c.getString('account'), cache),
    liability_account: accBrief(app, c.getString('liability_account'), cache),
    applies: c.getString('applies'),
    active: c.getBool('active'),
    sort: c.getInt('sort'),
    assigned: counts[c.id] || 0,
  };
}

function assignCounts(app) {
  const counts = {};
  for (const r of u().rows(app, 'SELECT component, COUNT(id) AS n FROM employee_components GROUP BY component', { component: '', n: 0 })) counts[r.component] = r.n;
  return counts;
}

function listComponents(ctx, p) {
  auth().need(ctx, 'payroll', 'view', 'see pay components');
  const util = u();
  const app = ctx.app;
  const onlyActive = util.bool(p, 'active', false);
  const counts = assignCounts(app);
  const cache = {};
  const recs = app.findRecordsByFilter('pay_components', onlyActive ? 'active = true' : '', 'sort,name', 0, 0);
  return {
    components: recs.map((c) => componentOut(app, c, counts, cache)),
    kinds: KINDS,
    calcs: CALCS,
    currency: core().currency(app),
    can: { edit: !ctx.isAgent && people().has(ctx, 'payroll', 'full'), assign: people().has(ctx, 'payroll', 'edit') },
  };
}

function readComponent(ctx, app, r, p, isNew) {
  const util = u();
  const cur = core().currency(app);
  if (util.has(p, 'name')) {
    const n = util.squash(util.text(p, 'name', 80, ''));
    if (n === '') throw util.fail(400, 'name cannot be empty', 'invalid_param', { param: 'name' });
    if (util.idsNocaseFind(app, 'pay_components', 'name', n, r.id || '')) throw util.fail(409, 'There is already a pay component called ' + n + '.', 'duplicate');
    r.set('name', n);
  }
  if (isNew && r.getString('name') === '') throw util.fail(400, 'name is required, e.g. name="Transport allowance"', 'missing_param', { param: 'name' });
  const oldKind = r.getString('kind');
  if (util.has(p, 'kind')) r.set('kind', util.oneOf(p, 'kind', KINDS, 'earning'));
  if (r.getString('kind') === '') throw util.fail(400, 'kind is required: earning, deduction or employer', 'missing_param', { param: 'kind' });
  const kind = r.getString('kind');
  if (util.has(p, 'calc')) r.set('calc', util.oneOf(p, 'calc', CALCS, 'fixed'));
  if (util.has(p, 'amount')) r.set('amount', util.money(p, 'amount', cur) || 0);
  if (util.has(p, 'percent')) r.set('percent_bp', util.percent(p, 'percent', 10000) || 0);
  if (util.has(p, 'account')) {
    const ref = util.str(p, 'account', '');
    r.set('account', ref === '' ? defaultAccount(app, kind) : payAccount(app, ref, 'account').id);
  } else if (isNew || oldKind !== kind) r.set('account', defaultAccount(app, kind));
  if (kind === 'employer') {
    if (util.has(p, 'liability_account')) {
      const ref = util.str(p, 'liability_account', '');
      r.set('liability_account', ref === '' ? defaultLiability(app) : payAccount(app, ref, 'liability_account').id);
    } else if (r.getString('liability_account') === '') r.set('liability_account', defaultLiability(app));
  } else {
    if (util.has(p, 'liability_account') && util.str(p, 'liability_account', '') !== '') throw util.fail(400, 'Only employer contributions have a liability account.', 'invalid_param', { param: 'liability_account' });
    r.set('liability_account', '');
  }
  if (util.has(p, 'applies')) r.set('applies', util.oneOf(p, 'applies', APPLIES, 'all'));
  if (util.has(p, 'active')) r.set('active', util.bool(p, 'active', true));
  if (util.has(p, 'sort')) r.set('sort', util.int(p, 'sort', 0, 0, 100000));
}

function addComponent(ctx, p) {
  auth().need(ctx, 'payroll', 'full', 'change pay components');
  const util = u();
  const app = ctx.app;
  const r = util.newRecord(app, 'pay_components');
  r.set('calc', 'fixed');
  r.set('amount', 0);
  r.set('percent_bp', 0);
  r.set('applies', 'all');
  r.set('active', true);
  r.set('sort', 100);
  readComponent(ctx, app, r, p, true);
  app.runInTransaction((tx) => {
    tx.save(r);
    audit().write(tx, ctx, { kind: 'create', entity: 'pay_components', ref: r.id, label: r.getString('name'), summary: 'Added the pay component ' + r.getString('name') + ' (' + r.getString('kind') + ')' });
  });
  return componentOut(app, app.findRecordById('pay_components', r.id), assignCounts(app), {});
}

function updateComponent(ctx, p) {
  auth().need(ctx, 'payroll', 'full', 'change pay components');
  const util = u();
  const app = ctx.app;
  const found = core().resolve(app, 'pay_components', util.req(p, 'component', '"Transport allowance"'));
  const r = app.findRecordById('pay_components', found.id);
  readComponent(ctx, app, r, p, false);
  app.runInTransaction((tx) => {
    tx.save(r);
    audit().write(tx, ctx, { kind: 'update', entity: 'pay_components', ref: r.id, label: r.getString('name'), summary: 'Changed the pay component ' + r.getString('name') });
  });
  return componentOut(app, app.findRecordById('pay_components', r.id), assignCounts(app), {});
}

function deleteComponent(ctx, p) {
  auth().need(ctx, 'payroll', 'full', 'change pay components');
  const util = u();
  const app = ctx.app;
  const c = core().resolve(app, 'pay_components', util.req(p, 'component', '"Transport allowance"'));
  const posted = util.one(
    app,
    "SELECT COUNT(s.id) AS n FROM payslips s JOIN payroll_runs r ON r.id = s.run WHERE r.status IN ('posted', 'paid') AND s.lines LIKE {:pat}",
    { n: 0 },
    { pat: '%' + c.id + '%' },
  ).n;
  if (posted > 0) throw util.fail(409, c.getString('name') + ' is on ' + posted + ' posted payslips. Switch it off instead (active=false), so history keeps it.', 'in_use', { payslips: posted });
  const assigned = util.one(app, 'SELECT COUNT(id) AS n FROM employee_components WHERE component = {:c}', { n: 0 }, { c: c.id }).n;
  if (util.bool(p, 'preview', false)) return { preview: true, name: c.getString('name'), assignments_removed: assigned };
  app.runInTransaction((tx) => {
    for (const a of tx.findRecordsByFilter('employee_components', 'component = {:c}', '', 0, 0, { c: c.id })) tx.delete(tx.findRecordById('employee_components', a.id));
    tx.delete(tx.findRecordById('pay_components', c.id));
    audit().write(tx, ctx, { kind: 'delete', entity: 'pay_components', ref: c.id, label: c.getString('name'), summary: 'Deleted the pay component ' + c.getString('name') });
  });
  return { deleted: true, assignments_removed: assigned };
}

/** An employee's component assignments. */
function assignedFor(app, employeeId) {
  const util = u();
  const m = money();
  const cur = core().currency(app);
  return app
    .findRecordsByFilter('employee_components', 'employee = {:e}', 'created', 0, 0, { e: employeeId })
    .map((r) => {
      const c = util.byId(app, 'pay_components', r.getString('component'));
      if (c === null) return null;
      const override = r.getBool('override');
      let uses;
      if (override) uses = r.getInt('percent_bp') > 0 ? m.bpText(r.getInt('percent_bp')) + '% of basic pay' : m.fmt(r.getInt('amount'), cur);
      else uses = c.getString('calc') === 'percent' ? m.bpText(c.getInt('percent_bp')) + '% of basic pay' : m.fmt(c.getInt('amount'), cur);
      return {
        id: r.id,
        component: { id: c.id, name: c.getString('name'), kind: c.getString('kind'), calc: c.getString('calc'), applies: c.getString('applies'), active: c.getBool('active') },
        override: override,
        amount: r.getInt('amount'),
        amount_text: m.minorText(r.getInt('amount'), cur),
        percent: m.bpText(r.getInt('percent_bp')),
        percent_bp: r.getInt('percent_bp'),
        uses: uses,
      };
    })
    .filter((x) => x !== null);
}

function assign(ctx, p) {
  auth().need(ctx, 'payroll', 'edit', 'assign pay components');
  const util = u();
  const app = ctx.app;
  const cur = core().currency(app);
  const emp = core().resolve(app, 'employees', util.req(p, 'employee', 'EMP-0001'));
  const comp = core().resolve(app, 'pay_components', util.req(p, 'component', '"Transport allowance"'));
  const amount = util.money(p, 'amount', cur);
  const percent = util.percent(p, 'percent', 10000);
  if (amount !== null && percent !== null) throw util.fail(400, 'Give amount or percent, not both.', 'invalid_param', { param: 'percent' });
  const active = util.bool(p, 'active', true);
  let summary = '';
  app.runInTransaction((tx) => {
    const row = util.findOne(tx, 'employee_components', 'employee = {:e} && component = {:c}', { e: emp.id, c: comp.id });
    if (!active) {
      if (row !== null) tx.delete(tx.findRecordById('employee_components', row.id));
      summary = 'Removed ' + comp.getString('name') + ' from ' + emp.getString('name');
    } else {
      const r = row !== null ? tx.findRecordById('employee_components', row.id) : util.newRecord(tx, 'employee_components');
      r.set('employee', emp.id);
      r.set('component', comp.id);
      r.set('amount', amount !== null ? amount : 0);
      r.set('percent_bp', percent !== null ? percent : 0);
      r.set('override', amount !== null || percent !== null);
      tx.save(r);
      summary =
        'Gave ' + emp.getString('name') + ' ' + comp.getString('name') + (amount !== null ? ' at ' + money().fmt(amount, cur) : percent !== null ? ' at ' + money().bpText(percent) + '% of basic pay' : '');
    }
    audit().write(tx, ctx, { kind: 'update', entity: 'employees', ref: emp.id, label: emp.getString('number'), summary: summary });
  });
  return { employee: people().empBrief(app, emp.id, {}), components: assignedFor(app, emp.id), summary: summary };
}

/* ============================================================ payslips */

function payContext(app) {
  return {
    comps: app.findRecordsByFilter('pay_components', 'active = true', 'sort,name', 0, 0),
    defaults: { earning: defaultAccount(app, 'earning'), deduction: defaultAccount(app, 'deduction'), employer: defaultAccount(app, 'employer'), liability: defaultLiability(app) },
  };
}

function basicOf(emp) {
  const f = FACTOR[emp.getString('pay_frequency')] || FACTOR.monthly;
  return money().mulDiv(emp.getInt('pay_basic'), f[0], f[1]);
}

function totalsOf(lines) {
  let basic = 0;
  let gross = 0;
  let deductions = 0;
  let employer = 0;
  for (const l of lines) {
    if (l.basic) basic += l.amount;
    if (l.kind === 'earning') gross += l.amount;
    else if (l.kind === 'deduction') deductions += l.amount;
    else if (l.kind === 'employer') employer += l.amount;
  }
  return { basic: basic, gross: gross, deductions: deductions, employer: employer, net: gross - deductions };
}

/** One employee's payslip for a month, from their pay and the components (no writes). */
function computeSlip(app, emp, pc) {
  const m = money();
  const basic = basicOf(emp);
  const rows = {};
  for (const r of app.findRecordsByFilter('employee_components', 'employee = {:e}', '', 0, 0, { e: emp.id })) rows[r.getString('component')] = r;
  const lines = [{ component: '', basic: true, name: 'Basic pay', kind: 'earning', amount: basic, account: pc.defaults.earning, liability_account: '' }];
  for (const c of pc.comps) {
    const row = rows[c.id];
    if (c.getString('applies') === 'selected' && row === undefined) continue;
    let amount;
    if (row !== undefined && row.getBool('override')) amount = row.getInt('percent_bp') > 0 ? m.mulDiv(basic, row.getInt('percent_bp'), 10000) : row.getInt('amount');
    else amount = c.getString('calc') === 'percent' ? m.mulDiv(basic, c.getInt('percent_bp'), 10000) : c.getInt('amount');
    if (!(amount > 0)) continue;
    const kind = c.getString('kind');
    lines.push({
      component: c.id,
      basic: false,
      name: c.getString('name'),
      kind: kind,
      amount: amount,
      account: c.getString('account') || pc.defaults[kind],
      liability_account: kind === 'employer' ? c.getString('liability_account') || pc.defaults.liability : '',
    });
  }
  return Object.assign({ employee: emp.id, lines: lines }, totalsOf(lines));
}

/** Who a run pays by default: current employees in the month with basic pay or an assignment. */
function eligible(app, month) {
  const util = u();
  return util
    .rows(
      app,
      "SELECT id FROM employees WHERE status != 'left' AND (start_date = '' OR start_date <= {:me}) AND (end_date = '' OR end_date >= {:ms}) AND (pay_basic > 0 OR id IN (SELECT employee FROM employee_components)) ORDER BY name COLLATE NOCASE",
      { id: '' },
      { ms: util.monthStart(month), me: util.monthEnd(month) },
    )
    .map((r) => app.findRecordById('employees', r.id));
}

function readEmployees(app, p) {
  const util = u();
  const refs = util.list(p, 'employees');
  if (refs === undefined) return null;
  const out = [];
  const seen = {};
  for (const ref of refs) {
    const e = core().resolve(app, 'employees', String(ref));
    if (seen[e.id]) continue;
    seen[e.id] = true;
    out.push(e);
  }
  return out;
}

function writeSlips(tx, runId, slips) {
  const col = tx.findCollectionByNameOrId('payslips');
  for (const s of slips) {
    const r = new Record(col);
    r.set('run', runId);
    r.set('employee', s.employee);
    r.set('basic', s.basic);
    r.set('gross', s.gross);
    r.set('deductions', s.deductions);
    r.set('employer', s.employer);
    r.set('net', s.net);
    r.set('lines', s.lines);
    r.set('note', '');
    tx.save(r);
  }
}

function runTotals(tx, runId) {
  const t = u().one(
    tx,
    'SELECT COUNT(id) AS n, IFNULL(SUM(gross), 0) AS gross, IFNULL(SUM(deductions), 0) AS deductions, IFNULL(SUM(employer), 0) AS employer, IFNULL(SUM(net), 0) AS net FROM payslips WHERE run = {:r}',
    { n: 0, gross: 0, deductions: 0, employer: 0, net: 0 },
    { r: runId },
  );
  const run = tx.findRecordById('payroll_runs', runId);
  run.set('count', t.n);
  run.set('gross', t.gross);
  run.set('deductions', t.deductions);
  run.set('employer', t.employer);
  run.set('net', t.net);
  tx.save(run);
  return run;
}

/* ============================================================== outputs */

function runLabel(r) {
  return 'Pay run ' + r.getString('number') + ' (' + monthName(r.getString('month')) + ')';
}

function slipLines(app, s, cur, cache) {
  return linesOut(app, u().jsonOf(s, 'lines') || [], cur, cache);
}

function linesOut(app, list, cur, cache) {
  const m = money();
  return list.map((l) => ({
    component: l.component || '',
    basic: l.basic === true,
    name: l.name,
    kind: l.kind,
    amount: l.amount,
    amount_text: m.minorText(l.amount, cur),
    account: accBrief(app, l.account || '', cache),
    liability_account: accBrief(app, l.liability_account || '', cache),
  }));
}

function slipOut(app, s, cur, cache) {
  const m = money();
  const P = people();
  const emp = P.empBrief(app, s.getString('employee'), cache);
  const rec = u().byId(app, 'employees', s.getString('employee'));
  return {
    id: s.id,
    employee: emp === null ? null : Object.assign({}, emp, { department: rec !== null ? P.deptBrief(app, rec.getString('department'), cache) : null }),
    basic: s.getInt('basic'),
    basic_text: m.minorText(s.getInt('basic'), cur),
    gross: s.getInt('gross'),
    gross_text: m.minorText(s.getInt('gross'), cur),
    deductions: s.getInt('deductions'),
    deductions_text: m.minorText(s.getInt('deductions'), cur),
    employer: s.getInt('employer'),
    employer_text: m.minorText(s.getInt('employer'), cur),
    net: s.getInt('net'),
    net_text: m.minorText(s.getInt('net'), cur),
    lines: slipLines(app, s, cur, cache),
    note: s.getString('note'),
  };
}

function journalBrief(app, id) {
  const j = u().byId(app, 'journals', id);
  return j === null ? null : { id: j.id, number: j.getString('number'), date: j.getString('date'), state: j.getString('state') };
}

/**
 * The payslips of a run with their employee and department, in one query
 * (runs reach thousands of people). `page` ({q, limit, offset}) narrows them.
 */
function runSlips(app, runId, cur, page) {
  const util = u();
  const m = money();
  const cache = {};
  const rows = util.rows(
    app,
    'SELECT s.id AS id, s.basic AS basic, s.gross AS gross, s.deductions AS deductions, s.employer AS employer, s.net AS net, s.lines AS lines, s.note AS note, ' +
      "IFNULL(e.id, '') AS e_id, IFNULL(e.name, '') AS e_name, IFNULL(e.number, '') AS e_number, IFNULL(e.job_title, '') AS e_title, IFNULL(e.photo, '') AS e_photo, IFNULL(e.status, '') AS e_status, " +
      "IFNULL(d.id, '') AS d_id, IFNULL(d.name, '') AS d_name, IFNULL(d.code, '') AS d_code " +
      'FROM payslips s LEFT JOIN employees e ON e.id = s.employee LEFT JOIN departments d ON d.id = e.department WHERE s.run = {:r}' +
      (page && page.q !== '' ? " AND (e.name LIKE {:q} ESCAPE '\\' OR e.number LIKE {:q} ESCAPE '\\' OR IFNULL(d.name, '') LIKE {:q} ESCAPE '\\')" : '') +
      ' ORDER BY e.name COLLATE NOCASE, e.number' +
      (page && page.limit > 0 ? ' LIMIT ' + page.limit + ' OFFSET ' + page.offset : ''),
    { id: '', basic: 0, gross: 0, deductions: 0, employer: 0, net: 0, lines: '', note: '', e_id: '', e_name: '', e_number: '', e_title: '', e_photo: '', e_status: '', d_id: '', d_name: '', d_code: '' },
    page && page.q !== '' ? { r: runId, q: util.like(page.q) } : { r: runId },
  );
  return rows.map((s) => {
    let list = [];
    try {
      list = s.lines === '' ? [] : JSON.parse(s.lines) || [];
    } catch {
      list = [];
    }
    return {
      id: s.id,
      employee:
        s.e_id === ''
          ? null
          : {
              id: s.e_id,
              name: s.e_name,
              number: s.e_number,
              job_title: s.e_title,
              photo: s.e_photo === '' ? '' : '/api/files/employees/' + s.e_id + '/' + s.e_photo,
              status: s.e_status,
              department: s.d_id !== '' ? { id: s.d_id, name: s.d_name, code: s.d_code } : null,
            },
      basic: s.basic,
      basic_text: m.minorText(s.basic, cur),
      gross: s.gross,
      gross_text: m.minorText(s.gross, cur),
      deductions: s.deductions,
      deductions_text: m.minorText(s.deductions, cur),
      employer: s.employer,
      employer_text: m.minorText(s.employer, cur),
      net: s.net,
      net_text: m.minorText(s.net, cur),
      lines: linesOut(app, list, cur, cache),
      note: s.note,
    };
  });
}

function runOut(app, ctx, r, full, page) {
  const m = money();
  const cur = people().currencyOf(ctx);
  const names = {};
  const bank = u().byId(app, 'banks', r.getString('bank'));
  const status = r.getString('status');
  const out = {
    id: r.id,
    number: r.getString('number'),
    month: r.getString('month'),
    month_name: monthName(r.getString('month')),
    pay_date: r.getString('pay_date'),
    status: status,
    count: r.getInt('count'),
    gross: r.getInt('gross'),
    gross_text: m.minorText(r.getInt('gross'), cur),
    deductions: r.getInt('deductions'),
    deductions_text: m.minorText(r.getInt('deductions'), cur),
    employer: r.getInt('employer'),
    employer_text: m.minorText(r.getInt('employer'), cur),
    net: r.getInt('net'),
    net_text: m.minorText(r.getInt('net'), cur),
    cost: r.getInt('gross') + r.getInt('employer'),
    cost_text: m.minorText(r.getInt('gross') + r.getInt('employer'), cur),
    journal: journalBrief(app, r.getString('journal')),
    pay_journal: journalBrief(app, r.getString('pay_journal')),
    bank: bank !== null ? { id: bank.id, name: bank.getString('name') } : null,
    approved_by: audit().memberName(app, r.getString('approved_by'), names),
    posted_by: audit().memberName(app, r.getString('posted_by'), names),
    paid_on: r.getString('paid_on'),
    note: r.getString('note'),
    created: r.getString('created'),
    currency: cur,
  };
  if (full) {
    out.payslips = runSlips(app, r.id, cur, page);
    if (page) {
      out.payslips_total =
        page.q === ''
          ? r.getInt('count')
          : u().one(
              app,
              "SELECT COUNT(s.id) AS n FROM payslips s LEFT JOIN employees e ON e.id = s.employee LEFT JOIN departments d ON d.id = e.department WHERE s.run = {:r} AND (e.name LIKE {:q} ESCAPE '\\' OR e.number LIKE {:q} ESCAPE '\\' OR IFNULL(d.name, '') LIKE {:q} ESCAPE '\\')",
              { n: 0 },
              { r: r.id, q: u().like(page.q) },
            ).n;
    }
    const P = people();
    out.can = {
      edit: status === 'draft' && P.has(ctx, 'payroll', 'edit'),
      approve: status === 'draft' && !ctx.isAgent && P.has(ctx, 'payroll', 'full'),
      post: status === 'approved' && P.has(ctx, 'payroll', 'full'),
      pay: status === 'posted' && P.has(ctx, 'payroll', 'full') && P.has(ctx, 'banking', 'full'),
      delete: status === 'draft' && P.has(ctx, 'payroll', 'edit'),
    };
    for (const k of ['journal', 'pay_journal']) {
      const j = u().byId(app, 'journals', r.getString(k));
      if (j !== null) out[k === 'journal' ? 'entry' : 'pay_entry'] = ledger().journalOut(app, j, true);
    }
  }
  return out;
}

function loadRun(app, ref) {
  return core().resolve(app, 'payroll_runs', ref);
}

/* ================================================================= runs */

function listRuns(ctx, p) {
  auth().need(ctx, 'payroll', 'view', 'see pay runs');
  const util = u();
  const app = ctx.app;
  const pg = util.page(p, 24, 500);
  const where = ['1 = 1'];
  const bind = {};
  const status = util.oneOf(p, 'status', RUN_STATUSES, '');
  if (status !== '') {
    where.push('status = {:s}');
    bind.s = status;
  }
  const year = util.int(p, 'year', 0, 1900, 2200);
  if (year > 0) {
    where.push('month LIKE {:y}');
    bind.y = year + '-%';
  }
  const sql = ' FROM payroll_runs WHERE ' + where.join(' AND ');
  const tot = util.one(app, 'SELECT COUNT(id) AS n, IFNULL(SUM(gross), 0) AS gross, IFNULL(SUM(net), 0) AS net, IFNULL(SUM(employer), 0) AS employer' + sql, { n: 0, gross: 0, net: 0, employer: 0 }, bind);
  const ids = util.rows(app, 'SELECT id' + sql + ' ORDER BY month DESC, created DESC LIMIT ' + pg.limit + ' OFFSET ' + pg.offset, { id: '' }, bind);
  const cur = core().currency(app);
  const m = money();
  return {
    runs: ids.map((x) => runOut(app, ctx, app.findRecordById('payroll_runs', x.id), false)),
    total: tot.n,
    totals: { gross: tot.gross, gross_text: m.minorText(tot.gross, cur), net: tot.net, net_text: m.minorText(tot.net, cur), employer: tot.employer, employer_text: m.minorText(tot.employer, cur) },
    currency: cur,
    can: { create: people().has(ctx, 'payroll', 'edit') },
  };
}

function getRun(ctx, p) {
  auth().need(ctx, 'payroll', 'view', 'see pay runs');
  const util = u();
  const r = loadRun(ctx.app, util.req(p, 'run', 'PR-0001'));
  // Screens page through the payslips of big runs; without a limit every payslip comes back.
  const paged = util.has(p, 'limit') || util.has(p, 'q');
  const page = paged ? { q: util.str(p, 'q', ''), limit: util.int(p, 'limit', 50, 1, 1000), offset: util.int(p, 'offset', 0, 0, 10000000) } : null;
  return runOut(ctx.app, ctx, r, true, page);
}

function createRun(ctx, p) {
  auth().need(ctx, 'payroll', 'edit', 'create pay runs');
  const util = u();
  const app = ctx.app;
  const month = util.monthParam(p, 'month', '');
  if (month === '') throw util.fail(400, 'month is required, e.g. month=' + util.today().slice(0, 7), 'missing_param', { param: 'month' });
  const payDate = util.day(p, 'pay_date', util.monthEnd(month));
  const dup = util.one(app, 'SELECT number, status FROM payroll_runs WHERE month = {:m} LIMIT 1', { number: '', status: '' }, { m: month });
  if (dup !== null) throw util.fail(409, 'There is already a pay run for ' + monthName(month) + ' (' + dup.number + ', ' + dup.status + '). Open it, or delete the draft first.', 'duplicate', { number: dup.number });
  const chosen = readEmployees(app, p);
  const emps = chosen !== null ? chosen : eligible(app, month);
  if (emps.length === 0) throw util.fail(409, 'Nobody to pay for ' + monthName(month) + ': give employees basic pay or assign pay components first, or name them in employees.', 'no_employees');
  const pc = payContext(app);
  const slips = emps.map((e) => computeSlip(app, e, pc));
  const note = util.text(p, 'note', 1000, '');
  let id = '';
  app.runInTransaction((tx) => {
    const r = util.newRecord(tx, 'payroll_runs');
    r.set('number', core().nextNumber(tx, 'payroll'));
    r.set('month', month);
    r.set('pay_date', payDate);
    r.set('status', 'draft');
    r.set('gross', 0);
    r.set('deductions', 0);
    r.set('employer', 0);
    r.set('net', 0);
    r.set('count', 0);
    r.set('note', note);
    tx.save(r);
    id = r.id;
    writeSlips(tx, r.id, slips);
    const run = runTotals(tx, r.id);
    audit().write(tx, ctx, {
      kind: 'create',
      entity: 'payroll_runs',
      ref: r.id,
      label: r.getString('number'),
      summary: 'Drafted ' + runLabel(r) + ' for ' + slips.length + (slips.length === 1 ? ' employee' : ' employees') + ': net ' + money().fmt(run.getInt('net'), core().currency(tx)),
    });
  });
  return runOut(app, ctx, app.findRecordById('payroll_runs', id), true);
}

function needDraft(r) {
  if (r.getString('status') !== 'draft') throw u().fail(409, runLabel(r) + ' is ' + r.getString('status') + '; only a draft run changes.', 'invalid_state');
}

/** Payslip lines from params (amounts as money text), no writes. */
function readSlipLines(app, input, pc) {
  const util = u();
  const c = core();
  const cur = c.currency(app);
  if (input.length > 200) throw util.fail(400, 'At most 200 lines per payslip.', 'invalid_param', { param: 'lines' });
  return input.map((raw, i) => {
    const where = 'Line ' + (i + 1);
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw util.fail(400, where + ' must be an object like {"component":"Transport allowance","amount":"200.00"}', 'invalid_param', { param: 'lines' });
    util.keysOnly(raw, ['component', 'name', 'kind', 'amount', 'basic', 'account', 'liability_account'], where);
    const amtRaw = raw.amount === undefined || raw.amount === null ? '' : String(raw.amount);
    const amount = money().toMinor(amtRaw, cur, false);
    if (amount === null) throw util.fail(400, where + ': amount must be an amount in ' + cur + ', e.g. "200.00" (got "' + amtRaw + '")', 'invalid_amount', { param: 'lines' });
    const compRef = raw.component === undefined || raw.component === null ? '' : String(raw.component).trim();
    const name = util.squash(raw.name === undefined || raw.name === null ? '' : String(raw.name));
    if (raw.basic === true || raw.basic === 'true' || (compRef === '' && name.toLowerCase() === 'basic pay')) {
      return { component: '', basic: true, name: 'Basic pay', kind: 'earning', amount: amount, account: pc.defaults.earning, liability_account: '' };
    }
    if (compRef !== '') {
      const comp = c.resolve(app, 'pay_components', compRef);
      const kind = comp.getString('kind');
      return {
        component: comp.id,
        basic: false,
        name: comp.getString('name'),
        kind: kind,
        amount: amount,
        account: comp.getString('account') || pc.defaults[kind],
        liability_account: kind === 'employer' ? comp.getString('liability_account') || pc.defaults.liability : '',
      };
    }
    if (name === '') throw util.fail(400, where + ' needs a component, or a name and kind for a one-off line (e.g. {"name":"Bonus","kind":"earning","amount":"500.00"}).', 'invalid_param', { param: 'lines' });
    if (name.length > 80) throw util.fail(400, where + ': name is too long (at most 80 characters)', 'invalid_param', { param: 'lines' });
    const kind = String(raw.kind || '').trim();
    if (KINDS.indexOf(kind) < 0) throw util.fail(400, where + ': kind must be one of ' + KINDS.join(', '), 'invalid_param', { param: 'lines' });
    const accRef = raw.account === undefined || raw.account === null ? '' : String(raw.account).trim();
    const liaRef = raw.liability_account === undefined || raw.liability_account === null ? '' : String(raw.liability_account).trim();
    return {
      component: '',
      basic: false,
      name: name,
      kind: kind,
      amount: amount,
      account: accRef !== '' ? payAccount(app, accRef, where + ' account').id : pc.defaults[kind],
      liability_account: kind === 'employer' ? (liaRef !== '' ? payAccount(app, liaRef, where + ' liability_account').id : pc.defaults.liability) : '',
    };
  });
}

function payslipUpdate(ctx, p) {
  auth().need(ctx, 'payroll', 'edit', 'change payslips');
  const util = u();
  const app = ctx.app;
  const s = core().resolve(app, 'payslips', util.req(p, 'payslip'));
  const run = app.findRecordById('payroll_runs', s.getString('run'));
  needDraft(run);
  const pc = payContext(app);
  let lines = null;
  if (util.has(p, 'lines')) {
    lines = readSlipLines(app, util.list(p, 'lines') || [], pc);
    if (lines.length === 0) throw util.fail(400, 'A payslip needs at least its basic pay line (amount 0 is fine).', 'invalid_param', { param: 'lines' });
  }
  const note = util.has(p, 'note') ? util.text(p, 'note', 500, '') : null;
  const emp = people().empBrief(app, s.getString('employee'), {});
  app.runInTransaction((tx) => {
    const r = tx.findRecordById('payroll_runs', run.id);
    needDraft(r);
    const x = tx.findRecordById('payslips', s.id);
    if (lines !== null) {
      const t = totalsOf(lines);
      x.set('lines', lines);
      x.set('basic', t.basic);
      x.set('gross', t.gross);
      x.set('deductions', t.deductions);
      x.set('employer', t.employer);
      x.set('net', t.net);
    }
    if (note !== null) x.set('note', note);
    tx.save(x);
    runTotals(tx, run.id);
    audit().write(tx, ctx, { kind: 'update', entity: 'payroll_runs', ref: run.id, label: run.getString('number'), summary: 'Adjusted the payslip of ' + (emp ? emp.name : '') + ' in ' + runLabel(run) + ': net ' + money().fmt(x.getInt('net'), core().currency(tx)) });
  });
  return runOut(app, ctx, app.findRecordById('payroll_runs', run.id), true);
}

function runRecompute(ctx, p) {
  auth().need(ctx, 'payroll', 'edit', 'recompute pay runs');
  const util = u();
  const app = ctx.app;
  const run = loadRun(app, util.req(p, 'run', 'PR-0001'));
  needDraft(run);
  let emps = readEmployees(app, p);
  if (emps === null) emps = app.findRecordsByFilter('payslips', 'run = {:r}', '', 0, 0, { r: run.id }).map((s) => app.findRecordById('employees', s.getString('employee')));
  if (emps.length === 0) emps = eligible(app, run.getString('month'));
  if (emps.length === 0) throw util.fail(409, 'Nobody to pay in ' + runLabel(run) + '.', 'no_employees');
  const pc = payContext(app);
  const slips = emps.map((e) => computeSlip(app, e, pc));
  app.runInTransaction((tx) => {
    const r = tx.findRecordById('payroll_runs', run.id);
    needDraft(r);
    for (const s of tx.findRecordsByFilter('payslips', 'run = {:r}', '', 0, 0, { r: run.id })) tx.delete(tx.findRecordById('payslips', s.id));
    writeSlips(tx, run.id, slips);
    const t = runTotals(tx, run.id);
    audit().write(tx, ctx, { kind: 'update', entity: 'payroll_runs', ref: run.id, label: run.getString('number'), summary: 'Recomputed ' + runLabel(run) + ' for ' + slips.length + (slips.length === 1 ? ' employee' : ' employees') + ': net ' + money().fmt(t.getInt('net'), core().currency(tx)) });
  });
  return runOut(app, ctx, app.findRecordById('payroll_runs', run.id), true);
}

function runApprove(ctx, p) {
  auth().need(ctx, 'payroll', 'full', 'approve pay runs');
  const util = u();
  const app = ctx.app;
  const run = loadRun(app, util.req(p, 'run', 'PR-0001'));
  needDraft(run);
  if (run.getInt('count') === 0) throw util.fail(409, runLabel(run) + ' has no payslips.', 'no_employees');
  const neg = util.one(app, 'SELECT COUNT(id) AS n FROM payslips WHERE run = {:r} AND net < 0', { n: 0 }, { r: run.id }).n;
  if (neg > 0) throw util.fail(409, neg + (neg === 1 ? ' payslip has' : ' payslips have') + ' deductions above gross pay (a negative net). Fix them first.', 'negative_net');
  app.runInTransaction((tx) => {
    const r = tx.findRecordById('payroll_runs', run.id);
    needDraft(r);
    r.set('status', 'approved');
    r.set('approved_by', ctx.memberId || '');
    tx.save(r);
    audit().write(tx, ctx, { kind: 'approve', entity: 'payroll_runs', ref: r.id, label: r.getString('number'), summary: 'Approved ' + runLabel(r) + ': net ' + money().fmt(r.getInt('net'), core().currency(tx)) });
  });
  return runOut(app, ctx, app.findRecordById('payroll_runs', run.id), true);
}

/** The run's journal lines, aggregated by account (no writes). */
function postLines(app, run) {
  const util = u();
  const pc = payContext(app);
  const debit = {};
  const credit = {};
  const dOrder = [];
  const cOrder = [];
  const add = (side, order, account, amount, name) => {
    if (!(amount > 0)) return;
    if (side[account] === undefined) {
      side[account] = { amount: 0, names: [] };
      order.push(account);
    }
    side[account].amount += amount;
    if (side[account].names.indexOf(name) < 0) side[account].names.push(name);
  };
  let net = 0;
  for (const s of app.findRecordsByFilter('payslips', 'run = {:r}', '', 0, 0, { r: run.id })) {
    net += s.getInt('net');
    for (const l of util.jsonOf(s, 'lines') || []) {
      const kind = l.kind;
      const account = l.account || pc.defaults[kind] || pc.defaults.earning;
      const amount = Number(l.amount) || 0;
      if (kind === 'earning') add(debit, dOrder, account, amount, l.name);
      else if (kind === 'deduction') add(credit, cOrder, account, amount, l.name);
      else if (kind === 'employer') {
        add(debit, dOrder, account, amount, l.name);
        add(credit, cOrder, l.liability_account || pc.defaults.liability, amount, l.name);
      }
    }
  }
  if (net < 0) throw util.fail(409, runLabel(run) + ' has a negative net total.', 'negative_net');
  const label = run.getString('number') + ' ' + monthName(run.getString('month'));
  const lines = [];
  for (const a of dOrder) lines.push({ account: a, debit: debit[a].amount, credit: 0, memo: (label + ': ' + debit[a].names.join(', ')).slice(0, 300) });
  for (const a of cOrder) lines.push({ account: a, debit: 0, credit: credit[a].amount, memo: (label + ': ' + credit[a].names.join(', ')).slice(0, 300) });
  lines.push({ account: core().systemAccount(app, 'salaries_payable').id, debit: 0, credit: net, memo: label + ': net pay' });
  return { lines: lines, net: net };
}

function previewRunPost(ctx, p) {
  const util = u();
  const app = ctx.app;
  const run = loadRun(app, util.req(p, 'run', 'PR-0001'));
  if (run.getString('status') !== 'approved') throw util.fail(409, runLabel(run) + ' is ' + run.getString('status') + '; approve it before posting.', 'invalid_state');
  const r = postLines(app, run);
  const cur = core().currency(app);
  const m = money();
  return {
    kind: 'payroll',
    auto: '',
    amount: run.getInt('gross') + run.getInt('employer'),
    title: 'Post ' + runLabel(run),
    summary: run.getInt('count') + (run.getInt('count') === 1 ? ' payslip' : ' payslips') + ' dated ' + run.getString('pay_date') + ': gross ' + m.fmt(run.getInt('gross'), cur) + ', deductions ' + m.fmt(run.getInt('deductions'), cur) + ', employer ' + m.fmt(run.getInt('employer'), cur) + ', net ' + m.fmt(run.getInt('net'), cur) + '.',
    lines: ledger().describeLines(app, ledger().compact(r.lines)),
    currency: cur,
    target: { entity: 'payroll_runs', id: run.id, label: run.getString('number') },
  };
}

function runPost(ctx, p) {
  auth().need(ctx, 'payroll', 'full', 'post pay runs');
  const util = u();
  const app = ctx.app;
  const run = loadRun(app, util.req(p, 'run', 'PR-0001'));
  if (run.getString('status') !== 'approved') throw util.fail(409, runLabel(run) + ' is ' + run.getString('status') + '; approve it before posting.', 'invalid_state');
  const r = postLines(app, run);
  ledger().checkDate(app, ctx, run.getString('pay_date'));
  app.runInTransaction((tx) => {
    const x = tx.findRecordById('payroll_runs', run.id);
    if (x.getString('status') !== 'approved') throw util.fail(409, runLabel(x) + ' was posted a moment ago.', 'invalid_state');
    const j = ledger().post(tx, ctx, { kind: 'payroll', date: x.getString('pay_date'), memo: runLabel(x), source: { entity: 'payroll_runs', id: x.id, label: x.getString('number') }, lines: r.lines }, { allowControl: true });
    x.set('status', 'posted');
    x.set('journal', j !== null ? j.id : '');
    x.set('posted_by', ctx.memberId || '');
    tx.save(x);
    audit().write(tx, ctx, { kind: 'post', entity: 'payroll_runs', ref: x.id, label: x.getString('number'), summary: 'Posted ' + runLabel(x) + (j !== null ? ' as ' + j.getString('number') : '') });
  });
  return runOut(app, ctx, app.findRecordById('payroll_runs', run.id), true);
}

function readRunPay(ctx, p) {
  const util = u();
  const app = ctx.app;
  const run = loadRun(app, util.req(p, 'run', 'PR-0001'));
  if (run.getString('status') !== 'posted') throw util.fail(409, runLabel(run) + ' is ' + run.getString('status') + '; post it before paying.', 'invalid_state');
  const bank = claimsLib().payBank(app, util.str(p, 'bank', ''));
  const date = util.day(p, 'date', util.today());
  const net = run.getInt('net');
  const label = run.getString('number') + ' ' + monthName(run.getString('month'));
  const lines = [
    { account: core().systemAccount(app, 'salaries_payable').id, debit: net, credit: 0, memo: label + ': net pay' },
    { account: bank.getString('account'), debit: 0, credit: net, memo: label + ': salaries paid' },
  ];
  return { run: run, bank: bank, date: date, lines: lines, net: net };
}

function previewRunPay(ctx, p) {
  const app = ctx.app;
  const r = readRunPay(ctx, p);
  const cur = core().currency(app);
  return {
    kind: 'payment',
    auto: '',
    amount: r.net,
    title: 'Pay salaries of ' + runLabel(r.run) + ': ' + money().fmt(r.net, cur),
    summary: 'Net pay of ' + r.run.getInt('count') + (r.run.getInt('count') === 1 ? ' employee' : ' employees') + ' from ' + r.bank.getString('name') + ' on ' + r.date + '.',
    lines: ledger().describeLines(app, r.lines),
    currency: cur,
    target: { entity: 'payroll_runs', id: r.run.id, label: r.run.getString('number') },
  };
}

function runPay(ctx, p) {
  auth().need(ctx, 'payroll', 'full', 'pay salaries');
  auth().need(ctx, 'banking', 'full', 'pay salaries');
  const util = u();
  const app = ctx.app;
  const r = readRunPay(ctx, p);
  ledger().checkDate(app, ctx, r.date);
  app.runInTransaction((tx) => {
    const x = tx.findRecordById('payroll_runs', r.run.id);
    if (x.getString('status') !== 'posted') throw util.fail(409, runLabel(x) + ' was paid a moment ago.', 'invalid_state');
    const j = ledger().post(tx, ctx, { kind: 'payroll_payment', date: r.date, memo: 'Salaries of ' + runLabel(x), source: { entity: 'payroll_runs', id: x.id, label: x.getString('number') }, lines: r.lines }, { allowControl: true });
    x.set('status', 'paid');
    x.set('bank', r.bank.id);
    x.set('paid_on', r.date);
    x.set('pay_journal', j !== null ? j.id : '');
    tx.save(x);
    audit().write(tx, ctx, { kind: 'pay', entity: 'payroll_runs', ref: x.id, label: x.getString('number'), summary: 'Paid the salaries of ' + runLabel(x) + ' from ' + r.bank.getString('name') + ' on ' + r.date + (j !== null ? ' (' + j.getString('number') + ')' : '') });
  });
  return runOut(app, ctx, app.findRecordById('payroll_runs', r.run.id), true);
}

function runDelete(ctx, p) {
  auth().need(ctx, 'payroll', 'edit', 'delete pay runs');
  const util = u();
  const app = ctx.app;
  const run = loadRun(app, util.req(p, 'run', 'PR-0001'));
  needDraft(run);
  const n = util.one(app, 'SELECT COUNT(id) AS n FROM payslips WHERE run = {:r}', { n: 0 }, { r: run.id }).n;
  if (util.bool(p, 'preview', false)) return { preview: true, number: run.getString('number'), month: run.getString('month'), payslips: n };
  app.runInTransaction((tx) => {
    const r = tx.findRecordById('payroll_runs', run.id);
    needDraft(r);
    for (const s of tx.findRecordsByFilter('payslips', 'run = {:r}', '', 0, 0, { r: run.id })) tx.delete(tx.findRecordById('payslips', s.id));
    tx.delete(r);
    audit().write(tx, ctx, { kind: 'delete', entity: 'payroll_runs', ref: run.id, label: run.getString('number'), summary: 'Deleted the draft ' + runLabel(run) });
  });
  return { deleted: true };
}

/* ========================================================== self-service */

function myPayslips(ctx, p) {
  const util = u();
  const P = people();
  const app = ctx.app;
  P.needOn(ctx, 'payroll');
  const me = P.ownEmployee(ctx);
  const pg = util.page(p, 24, 200);
  const cur = core().currency(app);
  const m = money();
  const sql = " FROM payslips s JOIN payroll_runs r ON r.id = s.run WHERE s.employee = {:e} AND r.status IN ('posted', 'paid')";
  const total = util.one(app, 'SELECT COUNT(s.id) AS n' + sql, { n: 0 }, { e: me }).n;
  const rows = util.rows(
    app,
    'SELECT s.id AS id, s.basic AS basic, s.gross AS gross, s.deductions AS deductions, s.net AS net, r.id AS run, r.number AS number, r.month AS month, r.pay_date AS pay_date, r.status AS status, r.paid_on AS paid_on' + sql + ' ORDER BY r.month DESC, r.created DESC LIMIT ' + pg.limit + ' OFFSET ' + pg.offset,
    { id: '', basic: 0, gross: 0, deductions: 0, net: 0, run: '', number: '', month: '', pay_date: '', status: '', paid_on: '' },
    { e: me },
  );
  return {
    payslips: rows.map((r) => ({
      id: r.id,
      run: { id: r.run, number: r.number, month: r.month, month_name: monthName(r.month), pay_date: r.pay_date, status: r.status, paid_on: r.paid_on },
      basic: r.basic,
      basic_text: m.minorText(r.basic, cur),
      gross: r.gross,
      gross_text: m.minorText(r.gross, cur),
      deductions: r.deductions,
      deductions_text: m.minorText(r.deductions, cur),
      net: r.net,
      net_text: m.minorText(r.net, cur),
    })),
    total: total,
    currency: cur,
  };
}

function payslipGet(ctx, p) {
  const util = u();
  const P = people();
  const app = ctx.app;
  P.needOn(ctx, 'payroll');
  const s = core().resolve(app, 'payslips', util.req(p, 'payslip'));
  const run = app.findRecordById('payroll_runs', s.getString('run'));
  const own = P.isOwn(ctx, s.getString('employee'));
  const released = run.getString('status') === 'posted' || run.getString('status') === 'paid';
  if (!(own && released) && !P.has(ctx, 'payroll', 'view')) {
    if (own) throw util.fail(403, 'Your payslip shows once the pay run is posted.', 'not_released');
    throw util.fail(403, 'You can see only your own payslips (or all with view access to Payroll).', 'not_permitted');
  }
  const cur = core().currency(app);
  const out = slipOut(app, s, cur, {});
  const emp = util.byId(app, 'employees', s.getString('employee'));
  if (emp !== null && out.employee !== null) {
    Object.assign(out.employee, { tax_number: emp.getString('tax_number'), national_id: emp.getString('national_id'), bank_details: emp.getString('bank_details'), pay_frequency: emp.getString('pay_frequency') || 'monthly' });
  }
  out.run = { id: run.id, number: run.getString('number'), month: run.getString('month'), month_name: monthName(run.getString('month')), pay_date: run.getString('pay_date'), status: run.getString('status'), paid_on: run.getString('paid_on') };
  out.company = core().settings(app).getString('company_name');
  out.currency = cur;
  return out;
}

module.exports = {
  KINDS: KINDS,
  CALCS: CALCS,
  FACTOR: FACTOR,
  monthName: monthName,
  basicOf: basicOf,
  computeSlip: computeSlip,
  assignedFor: assignedFor,
  listComponents: listComponents,
  addComponent: addComponent,
  updateComponent: updateComponent,
  deleteComponent: deleteComponent,
  assign: assign,
  listRuns: listRuns,
  getRun: getRun,
  createRun: createRun,
  payslipUpdate: payslipUpdate,
  runRecompute: runRecompute,
  runApprove: runApprove,
  previewRunPost: previewRunPost,
  runPost: runPost,
  previewRunPay: previewRunPay,
  runPay: runPay,
  runDelete: runDelete,
  myPayslips: myPayslips,
  payslipGet: payslipGet,
};
