/// <reference path="../pb_data/types.d.ts" />
/**
 * Projects, tasks and timesheets.
 *
 * - A project has a customer, a manager (an employee), a budget, a billing
 *   type (fixed, time and materials, non-billable) and an hourly rate (e4).
 * - Tasks sit on a board (todo, doing, done), ordered by `sort` per column.
 * - Time is logged per employee, project, task and day. A week is saved as a
 *   whole (the grid): the save replaces the week's draft and rejected
 *   entries; submitted, approved and invoiced time never changes there. The
 *   employee submits the week; their manager (anywhere up the manager chain)
 *   or someone with full Projects rights approves or rejects it.
 * - Approved billable time of a time-and-materials project is billed to ONE
 *   draft invoice (lib_docs.create) and the entries point at it. An entry
 *   whose invoice was deleted or voided reads as approved again and can be
 *   billed again: that status is derived on read (EFF), never rewritten.
 * - Profitability: revenue is posted invoices less posted credit notes, net
 *   of tax in the base currency, counted by each line's project or else its
 *   document's; costs come from the books (expense accounts with the
 *   project); time cost is hours x the employee's hourly cost when logged.
 *   Hours and time cost count every entry except rejected ones.
 *
 * Who sees what: view access to Projects sees every project; anyone else sees
 * the projects they are a member of (its manager, assigned a task in it, or
 * with time on it). Everyone with an employee record logs their own time on
 * active projects.
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
let auditLibMod = null;
function auditLib() {
  if (auditLibMod === null) auditLibMod = require(`${__hooks}/lib_audit.js`);
  return auditLibMod;
}
let docsLibMod = null;
function docsLib() {
  if (docsLibMod === null) docsLibMod = require(`${__hooks}/lib_docs.js`);
  return docsLibMod;
}
function audit(h, ctx, entry) {
  return auditLib().write(h, ctx, entry);
}

const STATUSES = ['active', 'on_hold', 'done', 'cancelled'];
const BILLING = ['fixed', 'time_materials', 'non_billable'];
const TASK_STATUSES = ['todo', 'doing', 'done'];
const TS_STATUSES = ['draft', 'submitted', 'approved', 'rejected', 'invoiced'];
const LOCKED = ['submitted', 'approved', 'invoiced'];
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** A time entry's status as people read it: invoiced only while its invoice exists and is not void. */
const EFF = "(CASE WHEN ts.status = 'invoiced' AND IFNULL(inv.state, '') IN ('', 'void') THEN 'approved' ELSE ts.status END)";
const TS_JOIN = ' LEFT JOIN documents inv ON inv.id = ts.invoice';
/** Projects `pr` the employee {:me} is a member of. */
const MEMBER_SQL =
  '(pr.manager = {:me} OR EXISTS (SELECT 1 FROM project_tasks mt WHERE mt.project = pr.id AND mt.assignee = {:me}) OR EXISTS (SELECT 1 FROM timesheets ms WHERE ms.project = pr.id AND ms.employee = {:me}))';
/** Everyone below {:me} in the manager chain, as the table `team`. */
const TEAM_CTE = 'WITH RECURSIVE team(id) AS (SELECT id FROM employees WHERE manager = {:me} UNION SELECT e2.id FROM employees e2 JOIN team ON e2.manager = team.id) ';

/* ============================================================== rights */

function on(ctx) {
  if (!auth().moduleOn(ctx.app, 'projects')) throw u().fail(403, 'Projects is switched off in Settings.', 'module_off', { module: 'projects' });
}

function canViewAll(ctx) {
  return auth().can(ctx, 'projects', 'view');
}

function canEdit(ctx) {
  return auth().can(ctx, 'projects', 'edit');
}

function canFull(ctx) {
  return auth().can(ctx, 'projects', 'full');
}

/** True when employee `empId` manages, is assigned a task in, or logged time on project `projectId`. */
function memberOf(app, projectId, empId) {
  if (!empId || !projectId) return false;
  const r = u().one(
    app,
    'SELECT CASE WHEN EXISTS (SELECT 1 FROM projects WHERE id = {:p} AND manager = {:e}) OR EXISTS (SELECT 1 FROM project_tasks WHERE project = {:p} AND assignee = {:e}) OR EXISTS (SELECT 1 FROM timesheets WHERE project = {:p} AND employee = {:e}) THEN 1 ELSE 0 END AS n',
    { n: 0 },
    { p: projectId, e: empId },
  );
  return r !== null && r.n === 1;
}

/**
 * True when ctx's employee is a member of the project `ref` (a project id or
 * a task id): its manager, assigned a task in it, or with time on it.
 */
function isMember(app, ctx, ref) {
  const util = u();
  if (!ctx || !ctx.employeeId) return false;
  const r = String(ref === undefined || ref === null ? '' : ref);
  if (r === '') return false;
  let pid = '';
  if (util.byId(app, 'projects', r) !== null) pid = r;
  else {
    const t = util.byId(app, 'project_tasks', r);
    if (t === null) return false;
    pid = t.getString('project');
  }
  return memberOf(app, pid, ctx.employeeId);
}

function needSee(ctx, project) {
  if (canViewAll(ctx) || memberOf(ctx.app, project.id, ctx.employeeId)) return;
  throw u().fail(403, 'You can see only the projects you work on (the others need view access to Projects).', 'not_permitted');
}

function needWork(ctx, project) {
  if (canEdit(ctx) || memberOf(ctx.app, project.id, ctx.employeeId)) return;
  throw u().fail(403, 'Only people on ' + project.getString('code') + ' (or with edit access to Projects) change its tasks.', 'not_permitted');
}

/** True when `mgrId` is above `empId` in the manager chain. */
function manages(app, mgrId, empId) {
  const util = u();
  if (!mgrId || !empId || mgrId === empId) return false;
  const seen = {};
  let cur = empId;
  for (let i = 0; i < 60; i++) {
    const e = util.byId(app, 'employees', cur);
    if (e === null) return false;
    const m = e.getString('manager');
    if (m === '' || seen[m]) return false;
    if (m === mgrId) return true;
    seen[m] = true;
    cur = m;
  }
  return false;
}

/* ============================================================= helpers */

function r2(x) {
  return Math.round(Number(x || 0) * 100) / 100;
}

function pct(a, b) {
  return b > 0 ? Math.round((a * 1000) / b) / 10 : null;
}

function mondayOf(day) {
  const util = u();
  return util.addDays(day, 1 - util.weekday(day));
}

/** Sum of (thousandths of hours x e4) -> minor units of `cur`, rounded once. */
function timeValue(mc, cur) {
  const m = money();
  return m.mulDiv(mc, 1, 1000 * m.pow10(4 - m.exp(cur)));
}

/** 'none' (or nothing) clears an optional reference. */
function cleared(v) {
  return v === undefined || v === null || String(v).trim() === '' || String(v).trim().toLowerCase() === 'none';
}

function fmtH(h) {
  return u().fmtQty(r2(h));
}

function label(pr) {
  return pr.getString('code') + ' ' + pr.getString('name');
}

function binds(ids, prefix, bind) {
  return ids.map((id, i) => {
    bind[prefix + i] = id;
    return '{:' + prefix + i + '}';
  });
}

/**
 * Money and time per project: hours, billable hours, time cost and billable
 * value (as sums of thousandths x e4), revenue (net, base) and spent (books).
 * ids: project ids, or null for every project.
 */
function figures(app, ids, from, to) {
  const util = u();
  const out = {};
  const get = (id) => {
    if (out[id] === undefined) out[id] = { hours: 0, hours_billable: 0, cost_mc: 0, value_mc: 0, revenue: 0, books: 0 };
    return out[id];
  };
  if (ids !== null && ids.length === 0) return out;
  const bind = {};
  const list = ids === null ? null : binds(ids, 'fp', bind).join(', ');
  const inP = (col) => (list === null ? col + " != ''" : col + ' IN (' + list + ')');
  if (from) bind.ff = from;
  if (to) bind.ft = to;
  const dates = (col) => (from ? ' AND ' + col + ' >= {:ff}' : '') + (to ? ' AND ' + col + ' <= {:ft}' : '');
  for (const r of util.rows(
    app,
    "SELECT ts.project AS p, IFNULL(SUM(ts.hours), 0) AS h, IFNULL(SUM(CASE WHEN ts.billable THEN ts.hours ELSE 0 END), 0) AS hb, IFNULL(SUM(CAST(ROUND(ts.hours * 1000) AS INTEGER) * ts.cost), 0) AS c, IFNULL(SUM(CASE WHEN ts.billable THEN CAST(ROUND(ts.hours * 1000) AS INTEGER) * ts.rate ELSE 0 END), 0) AS v FROM timesheets ts WHERE ts.status != 'rejected' AND " +
      inP('ts.project') +
      dates('ts.date') +
      ' GROUP BY ts.project',
    { p: '', h: -0, hb: -0, c: 0, v: 0 },
    bind,
  )) {
    const f = get(r.p);
    f.hours = r.h;
    f.hours_billable = r.hb;
    f.cost_mc = r.c;
    f.value_mc = r.v;
  }
  // Revenue: lines of the project's documents (lines without their own project) ...
  for (const r of util.rows(
    app,
    "SELECT d.project AS p, IFNULL(SUM(CASE WHEN d.type = 'invoice' THEN dl.net_base ELSE -dl.net_base END), 0) AS v FROM documents d JOIN document_lines dl ON dl.doc = d.id WHERE d.type IN ('invoice', 'credit_note') AND d.state = 'posted' AND " +
      inP('d.project') +
      " AND (dl.project = '' OR dl.project = d.project)" +
      dates('d.date') +
      ' GROUP BY d.project',
    { p: '', v: 0 },
    bind,
  )) get(r.p).revenue += r.v;
  // ... and lines that name the project on documents of another project or none.
  for (const r of util.rows(
    app,
    "SELECT dl.project AS p, IFNULL(SUM(CASE WHEN d.type = 'invoice' THEN dl.net_base ELSE -dl.net_base END), 0) AS v FROM document_lines dl JOIN documents d ON d.id = dl.doc WHERE d.type IN ('invoice', 'credit_note') AND d.state = 'posted' AND " +
      inP('dl.project') +
      ' AND dl.project != d.project' +
      dates('d.date') +
      ' GROUP BY dl.project',
    { p: '', v: 0 },
    bind,
  )) get(r.p).revenue += r.v;
  for (const r of util.rows(
    app,
    "SELECT jl.project AS p, IFNULL(SUM(jl.debit - jl.credit), 0) AS v FROM journal_lines jl JOIN accounts a ON a.id = jl.account WHERE a.type = 'expense' AND " + inP('jl.project') + dates('jl.date') + ' GROUP BY jl.project',
    { p: '', v: 0 },
    bind,
  )) get(r.p).books = r.v;
  return out;
}

/** The money summary of one project from its figures. */
function sums(f, budget, cur) {
  const m = money();
  const x = f || { hours: 0, hours_billable: 0, cost_mc: 0, value_mc: 0, revenue: 0, books: 0 };
  const timeCost = timeValue(x.cost_mc, cur);
  const used = x.books + timeCost;
  return {
    hours: r2(x.hours),
    billable_hours: r2(x.hours_billable),
    time_cost: timeCost,
    time_cost_text: m.minorText(timeCost, cur),
    billable_value: timeValue(x.value_mc, cur),
    revenue: x.revenue,
    revenue_text: m.minorText(x.revenue, cur),
    spent: x.books,
    spent_text: m.minorText(x.books, cur),
    budget_used: used,
    budget_used_text: m.minorText(used, cur),
    budget_used_pct: pct(used, budget),
    over_budget: budget > 0 && used > budget,
  };
}

/* ============================================================ projects */

function personBrief(app, id, cache) {
  if (!id) return null;
  if (cache && cache['e:' + id] !== undefined) return cache['e:' + id];
  const e = u().byId(app, 'employees', id);
  const out = e === null ? null : { id: e.id, name: e.getString('name'), number: e.getString('number') };
  if (cache) cache['e:' + id] = out;
  return out;
}

function projectOut(app, r, cur, cache) {
  const m = money();
  const c = cache || {};
  let customer = null;
  if (r.getString('customer') !== '') {
    const key = 'p:' + r.getString('customer');
    if (c[key] === undefined) {
      const pa = u().byId(app, 'parties', r.getString('customer'));
      c[key] = pa === null ? null : { id: pa.id, code: pa.getString('code'), name: pa.getString('name') };
    }
    customer = c[key];
  }
  return {
    id: r.id,
    code: r.getString('code'),
    name: r.getString('name'),
    status: r.getString('status'),
    billing: r.getString('billing'),
    customer: customer,
    manager: personBrief(app, r.getString('manager'), c),
    start: r.getString('start'),
    end: r.getString('end'),
    budget: r.getInt('budget'),
    budget_text: m.minorText(r.getInt('budget'), cur),
    rate: r.getInt('rate'),
    rate_text: m.e4Text(r.getInt('rate'), cur),
    description: r.getString('description'),
    color: r.getInt('color'),
    created: r.getString('created'),
    updated: r.getString('updated'),
  };
}

/** Visibility of projects `pr` for ctx, as SQL. */
function visibleSql(ctx, bind) {
  if (canViewAll(ctx)) return '1 = 1';
  if (ctx.employeeId === '') return '1 = 0';
  bind.me = ctx.employeeId;
  return MEMBER_SQL;
}

function list(ctx, p) {
  const util = u();
  on(ctx);
  const app = ctx.app;
  const cur = core().currency(app);
  const pg = util.page(p, 50, 500);
  const bind = {};
  const vis = visibleSql(ctx, bind);
  const where = [vis];
  if (util.bool(p, 'mine', false)) {
    if (ctx.employeeId === '') where.push('1 = 0');
    else {
      bind.me = ctx.employeeId;
      where.push(MEMBER_SQL);
    }
  }
  const status = util.oneOf(p, 'status', STATUSES.concat(['open', 'all']), 'all');
  if (status === 'open') where.push("pr.status IN ('active', 'on_hold')");
  else if (status !== 'all') {
    where.push('pr.status = {:st}');
    bind.st = status;
  }
  const billing = util.oneOf(p, 'billing', BILLING, '');
  if (billing !== '') {
    where.push('pr.billing = {:bi}');
    bind.bi = billing;
  }
  const q = util.str(p, 'q', '');
  if (q !== '') {
    where.push("(pr.name LIKE {:q} ESCAPE '\\' OR pr.code LIKE {:q} ESCAPE '\\' OR IFNULL(c.name, '') LIKE {:q} ESCAPE '\\')");
    bind.q = util.like(q);
  }
  const customer = util.str(p, 'customer', '');
  if (customer !== '') {
    where.push('pr.customer = {:cu}');
    bind.cu = core().resolve(app, 'parties', customer).id;
  }
  const manager = util.str(p, 'manager', '');
  if (manager !== '') {
    where.push('pr.manager = {:mg}');
    bind.mg = core().resolve(app, 'employees', manager).id;
  }
  const sorts = { name: 'pr.name COLLATE NOCASE', code: 'pr.code', status: 'pr.status', start: 'pr.start', end: 'pr."end"', budget: 'pr.budget', created: 'pr.created', updated: 'pr.updated' };
  const sortKey = util.oneOf(p, 'sort', Object.keys(sorts), 'name');
  const desc = util.bool(p, 'desc', sortKey === 'created' || sortKey === 'updated' || sortKey === 'budget');
  const from = ' FROM projects pr LEFT JOIN parties c ON c.id = pr.customer WHERE ' + where.join(' AND ');
  const total = util.one(app, 'SELECT COUNT(pr.id) AS n' + from, { n: 0 }, bind).n;
  const ids = util.rows(app, 'SELECT pr.id AS id' + from + ' ORDER BY ' + sorts[sortKey] + (desc ? ' DESC' : ' ASC') + ', pr.code LIMIT ' + pg.limit + ' OFFSET ' + pg.offset, { id: '' }, bind).map((x) => x.id);
  const figs = figures(app, ids, '', '');
  const tb = {};
  const tasks = {};
  if (ids.length > 0) {
    for (const r of util.rows(app, "SELECT project AS p, COUNT(id) AS n, IFNULL(SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END), 0) AS d FROM project_tasks WHERE project IN (" + binds(ids, 'tp', tb).join(', ') + ') GROUP BY project', { p: '', n: 0, d: 0 }, tb)) {
      tasks[r.p] = { done: r.d, total: r.n };
    }
  }
  const cache = {};
  const projects = ids.map((id) => {
    const rec = app.findRecordById('projects', id);
    const out = projectOut(app, rec, cur, cache);
    Object.assign(out, sums(figs[id], rec.getInt('budget'), cur));
    const t = tasks[id] || { done: 0, total: 0 };
    out.progress = { done: t.done, total: t.total, pct: t.total > 0 ? Math.round((t.done * 100) / t.total) : null };
    out.member = memberOf(app, id, ctx.employeeId);
    return out;
  });
  const cb = {};
  const counts = { active: 0, on_hold: 0, done: 0, cancelled: 0 };
  for (const r of util.rows(app, 'SELECT pr.status AS s, COUNT(pr.id) AS n FROM projects pr WHERE ' + visibleSql(ctx, cb) + ' GROUP BY pr.status', { s: '', n: 0 }, cb)) counts[r.s] = r.n;
  return { projects: projects, total: total, counts: counts, currency: cur, can: { add: canEdit(ctx) } };
}

/** The latest time entries matching `where` (SQL over ts), in list shape. */
function entryRows(app, cte, where, bind, order, limit, offset, cur) {
  const util = u();
  const m = money();
  const rows = util.rows(
    app,
    cte +
      "SELECT ts.id AS id, ts.date AS date, ts.employee AS employee, IFNULL(e.name, '') AS employee_name, ts.project AS project, IFNULL(pr.code, '') AS project_code, IFNULL(pr.name, '') AS project_name, ts.task AS task, IFNULL(t.title, '') AS task_title, ts.hours AS hours, ts.billable AS billable, ts.description AS description, " +
      EFF +
      " AS status, ts.rate AS rate, ts.cost AS cost, ts.invoice AS invoice, IFNULL(inv.number, '') AS invoice_number, IFNULL(inv.state, '') AS invoice_state, ts.approved_by AS approved_by, ts.actor AS actor FROM timesheets ts" +
      TS_JOIN +
      ' LEFT JOIN employees e ON e.id = ts.employee LEFT JOIN projects pr ON pr.id = ts.project LEFT JOIN project_tasks t ON t.id = ts.task WHERE ' +
      where +
      ' ORDER BY ' +
      order +
      ' LIMIT ' +
      limit +
      ' OFFSET ' +
      offset,
    {
      id: '',
      date: '',
      employee: '',
      employee_name: '',
      project: '',
      project_code: '',
      project_name: '',
      task: '',
      task_title: '',
      hours: -0,
      billable: false,
      description: '',
      status: '',
      rate: 0,
      cost: 0,
      invoice: '',
      invoice_number: '',
      invoice_state: '',
      approved_by: '',
      actor: '',
    },
    bind,
  );
  const names = {};
  return rows.map((r) => {
    const value = r.billable ? m.stockValue(r.hours, r.rate, cur) : 0;
    const cost = m.stockValue(r.hours, r.cost, cur);
    return {
      id: r.id,
      date: r.date,
      employee: { id: r.employee, name: r.employee_name },
      project: { id: r.project, code: r.project_code, name: r.project_name },
      task: r.task !== '' ? { id: r.task, title: r.task_title } : null,
      hours: r2(r.hours),
      billable: r.billable,
      description: r.description,
      status: r.status,
      locked: LOCKED.indexOf(r.status) >= 0,
      rate: r.rate,
      rate_text: m.e4Text(r.rate, cur),
      value: value,
      value_text: m.minorText(value, cur),
      cost: cost,
      cost_text: m.minorText(cost, cur),
      invoice: r.status === 'invoiced' ? { id: r.invoice, number: r.invoice_number, state: r.invoice_state } : null,
      approved_by: r.approved_by === '' ? '' : auditLib().memberName(app, r.approved_by, names),
      actor: r.actor,
    };
  });
}

/** Profitability of one project over [from, to] (either may be empty). */
function profitData(app, pr, from, to) {
  const util = u();
  const m = money();
  const cur = core().currency(app);
  const bind = { p: pr.id };
  if (from) bind.f = from;
  if (to) bind.t = to;
  const dates = (col) => (from ? ' AND ' + col + ' >= {:f}' : '') + (to ? ' AND ' + col + ' <= {:t}' : '');
  const docs = util.rows(
    app,
    "SELECT d.id AS id, d.type AS type, d.number AS number, d.date AS date, IFNULL(SUM(dl.net_base), 0) AS net FROM document_lines dl JOIN documents d ON d.id = dl.doc WHERE d.type IN ('invoice', 'credit_note') AND d.state = 'posted' AND (dl.project = {:p} OR (dl.project = '' AND d.project = {:p}))" +
      dates('d.date') +
      ' GROUP BY d.id ORDER BY d.date, d.number',
    { id: '', type: '', number: '', date: '', net: 0 },
    bind,
  );
  let invoiced = 0;
  let credited = 0;
  for (const d of docs) {
    if (d.type === 'invoice') invoiced += d.net;
    else credited += d.net;
  }
  const revenue = invoiced - credited;
  const accounts = util.rows(
    app,
    "SELECT a.id AS id, a.code AS code, a.name AS name, IFNULL(SUM(jl.debit - jl.credit), 0) AS v FROM journal_lines jl JOIN accounts a ON a.id = jl.account WHERE jl.project = {:p} AND a.type = 'expense'" + dates('jl.date') + ' GROUP BY a.id ORDER BY a.code',
    { id: '', code: '', name: '', v: 0 },
    bind,
  ).filter((a) => a.v !== 0);
  let costs = 0;
  for (const a of accounts) costs += a.v;
  const time = util.one(
    app,
    "SELECT IFNULL(SUM(ts.hours), 0) AS h, IFNULL(SUM(CASE WHEN ts.billable THEN ts.hours ELSE 0 END), 0) AS hb, IFNULL(SUM(CAST(ROUND(ts.hours * 1000) AS INTEGER) * ts.cost), 0) AS c, IFNULL(SUM(CASE WHEN ts.billable THEN CAST(ROUND(ts.hours * 1000) AS INTEGER) * ts.rate ELSE 0 END), 0) AS v FROM timesheets ts WHERE ts.project = {:p} AND ts.status != 'rejected'" +
      dates('ts.date'),
    { h: -0, hb: -0, c: 0, v: 0 },
    bind,
  );
  const timeCost = timeValue(time.c, cur);
  const booksMargin = revenue - costs;
  const afterTime = revenue - costs - timeCost;
  const budget = pr.getInt('budget');
  const used = costs + timeCost;
  const t = (v) => m.minorText(v, cur);
  return {
    project: { id: pr.id, code: pr.getString('code'), name: pr.getString('name'), billing: pr.getString('billing') },
    from: from || '',
    to: to || '',
    currency: cur,
    revenue: revenue,
    revenue_text: t(revenue),
    invoiced: invoiced,
    invoiced_text: t(invoiced),
    credited: credited,
    credited_text: t(credited),
    costs: costs,
    costs_text: t(costs),
    time_cost: timeCost,
    time_cost_text: t(timeCost),
    hours: r2(time.h),
    billable_hours: r2(time.hb),
    billable_value: timeValue(time.v, cur),
    billable_value_text: t(timeValue(time.v, cur)),
    books_margin: booksMargin,
    books_margin_text: t(booksMargin),
    books_margin_pct: revenue !== 0 ? Math.round((booksMargin * 1000) / revenue) / 10 : null,
    margin_after_time: afterTime,
    margin_after_time_text: t(afterTime),
    margin_after_time_pct: revenue !== 0 ? Math.round((afterTime * 1000) / revenue) / 10 : null,
    budget: budget,
    budget_text: t(budget),
    budget_used: used,
    budget_used_text: t(used),
    budget_used_pct: pct(used, budget),
    budget_left: budget > 0 ? budget - used : null,
    documents: docs.map((d) => ({ id: d.id, type: d.type, number: d.number, date: d.date, net: d.type === 'invoice' ? d.net : -d.net, net_text: t(d.type === 'invoice' ? d.net : -d.net) })),
    cost_accounts: accounts.map((a) => ({ account: { id: a.id, code: a.code, name: a.name }, amount: a.v, amount_text: t(a.v) })),
    note: 'Time cost is not in the books unless payroll is posted to the project, so both margins are shown.',
  };
}

function taskOut(app, t, hours, cache) {
  return {
    id: t.id,
    project: t.getString('project'),
    title: t.getString('title'),
    status: t.getString('status'),
    assignee: personBrief(app, t.getString('assignee'), cache),
    due: t.getString('due'),
    overdue: t.getString('status') !== 'done' && t.getString('due') !== '' && t.getString('due') < u().today(),
    estimate_hours: r2(t.getFloat('estimate_hours')),
    hours: r2(hours || 0),
    sort: t.getInt('sort'),
    notes: t.getString('notes'),
    created: t.getString('created'),
    updated: t.getString('updated'),
  };
}

/** Hours logged per task of a project (rejected time not counted). */
function taskHours(app, projectId) {
  const out = {};
  for (const r of u().rows(app, "SELECT task AS t, IFNULL(SUM(hours), 0) AS h FROM timesheets WHERE project = {:p} AND task != '' AND status != 'rejected' GROUP BY task", { t: '', h: -0 }, { p: projectId })) out[r.t] = r.h;
  return out;
}

function get(ctx, p) {
  const util = u();
  on(ctx);
  const app = ctx.app;
  const pr = core().resolve(app, 'projects', util.req(p, 'project', 'PRJ-0001'));
  needSee(ctx, pr);
  const cur = core().currency(app);
  const m = money();
  const cache = {};
  const out = projectOut(app, pr, cur, cache);
  const figs = figures(app, [pr.id], '', '');
  Object.assign(out, sums(figs[pr.id], pr.getInt('budget'), cur));
  const hours = taskHours(app, pr.id);
  const tasks = { todo: [], doing: [], done: [] };
  let done = 0;
  let all = 0;
  for (const t of app.findRecordsByFilter('project_tasks', 'project = {:p}', 'sort,created', 0, 0, { p: pr.id })) {
    tasks[t.getString('status')].push(taskOut(app, t, hours[t.id], cache));
    all++;
    if (t.getString('status') === 'done') done++;
  }
  out.tasks = tasks;
  out.progress = { done: done, total: all, pct: all > 0 ? Math.round((done * 100) / all) : null };
  out.people = util
    .rows(
      app,
      "SELECT ts.employee AS id, IFNULL(e.name, '') AS name, IFNULL(SUM(ts.hours), 0) AS h, IFNULL(SUM(CASE WHEN ts.billable THEN ts.hours ELSE 0 END), 0) AS hb, IFNULL(SUM(CAST(ROUND(ts.hours * 1000) AS INTEGER) * ts.cost), 0) AS c FROM timesheets ts LEFT JOIN employees e ON e.id = ts.employee WHERE ts.project = {:p} AND ts.status != 'rejected' GROUP BY ts.employee ORDER BY h DESC",
      { id: '', name: '', h: -0, hb: -0, c: 0 },
      { p: pr.id },
    )
    .map((r) => ({ employee: { id: r.id, name: r.name }, hours: r2(r.h), billable_hours: r2(r.hb), cost: timeValue(r.c, cur), cost_text: m.minorText(timeValue(r.c, cur), cur) }));
  out.timesheets = entryRows(app, '', 'ts.project = {:p}', { p: pr.id }, 'ts.date DESC, ts.created DESC', 15, 0, cur);
  const today = util.today();
  const docs = docsLib();
  out.documents = util.rows(app, 'SELECT id FROM documents WHERE project = {:p} ORDER BY date DESC, created DESC LIMIT 50', { id: '' }, { p: pr.id }).map((x) => {
    const d = app.findRecordById('documents', x.id);
    return {
      id: d.id,
      type: d.getString('type'),
      number: d.getString('number'),
      label: docs.docLabel(d),
      state: d.getString('state'),
      status: docs.statusOf(d, today),
      date: d.getString('date'),
      total: d.getInt('total'),
      total_text: m.minorText(d.getInt('total'), d.getString('currency') || cur),
      currency: d.getString('currency') || cur,
    };
  });
  const toBill = util.one(
    app,
    'SELECT COUNT(ts.id) AS n, IFNULL(SUM(ts.hours), 0) AS h, IFNULL(SUM(CAST(ROUND(ts.hours * 1000) AS INTEGER) * ts.rate), 0) AS v FROM timesheets ts' + TS_JOIN + ' WHERE ts.project = {:p} AND ts.billable = TRUE AND ts.hours > 0 AND ' + EFF + " = 'approved'",
    { n: 0, h: -0, v: 0 },
    { p: pr.id },
  );
  out.to_bill = { entries: toBill.n, hours: r2(toBill.h), value: timeValue(toBill.v, cur), value_text: m.minorText(timeValue(toBill.v, cur), cur) };
  out.to_approve = util.one(app, "SELECT COUNT(id) AS n FROM timesheets WHERE project = {:p} AND status = 'submitted'", { n: 0 }, { p: pr.id }).n;
  out.profit = profitData(app, pr, '', '');
  out.member = memberOf(app, pr.id, ctx.employeeId);
  out.currency = cur;
  out.can = {
    edit: canEdit(ctx),
    delete: canFull(ctx) && !ctx.isAgent,
    tasks: canEdit(ctx) || out.member,
    log_time: ctx.employeeId !== '' && pr.getString('status') === 'active',
    bill: (canFull(ctx) || auth().can(ctx, 'sales', 'edit')) && pr.getString('billing') === 'time_materials' && pr.getString('customer') !== '' && toBill.n > 0,
  };
  return out;
}

/** Read and check project params (before any transaction). Returns the fields to set. */
function readProject(ctx, p, existing) {
  const util = u();
  const app = ctx.app;
  const isNew = existing === null;
  const set = {};
  if (util.has(p, 'name')) {
    const n = util.squash(util.text(p, 'name', 160, ''));
    if (n === '') throw util.fail(400, 'name cannot be empty', 'invalid_param');
    set.name = n;
  }
  if (isNew && set.name === undefined) throw util.fail(400, 'name is required, e.g. name="Website rebuild"', 'missing_param');
  if (util.has(p, 'code')) {
    const c = util.text(p, 'code', 20, '');
    if (c !== '') {
      if (util.idsNocaseFind(app, 'projects', 'code', c, existing ? existing.id : '')) throw util.fail(409, 'The code ' + c + ' is taken by another project.', 'duplicate');
      set.code = c;
    }
  }
  if (util.has(p, 'customer')) {
    const ref = util.str(p, 'customer', '');
    set.customer = cleared(ref) ? '' : core().resolve(app, 'parties', ref).id;
  }
  if (util.has(p, 'manager')) {
    const ref = util.str(p, 'manager', '');
    set.manager = cleared(ref) ? '' : core().resolve(app, 'employees', ref).id;
  }
  if (util.has(p, 'status')) set.status = util.oneOf(p, 'status', STATUSES, 'active');
  else if (isNew) set.status = 'active';
  for (const f of ['start', 'end']) {
    if (!util.has(p, f)) continue;
    const v = util.str(p, f, '');
    set[f] = cleared(v) ? '' : util.day(p, f, '');
  }
  const start = set.start !== undefined ? set.start : existing ? existing.getString('start') : '';
  const end = set.end !== undefined ? set.end : existing ? existing.getString('end') : '';
  if (start !== '' && end !== '' && end < start) throw util.fail(400, 'end (' + end + ') is before start (' + start + ').', 'invalid_param');
  if (util.has(p, 'budget')) set.budget = util.money(p, 'budget', core().currency(app)) || 0;
  if (util.has(p, 'billing')) set.billing = util.oneOf(p, 'billing', BILLING, 'time_materials');
  else if (isNew) set.billing = 'time_materials';
  if (util.has(p, 'rate')) set.rate = util.price(p, 'rate') || 0;
  if (util.has(p, 'description')) set.description = util.text(p, 'description', 2000, '');
  if (util.has(p, 'color')) set.color = util.int(p, 'color', 0, 0, 7);
  return set;
}

function add(ctx, p) {
  const util = u();
  on(ctx);
  auth().need(ctx, 'projects', 'edit', 'add projects');
  const app = ctx.app;
  const set = readProject(ctx, p, null);
  let id = '';
  app.runInTransaction((tx) => {
    const r = util.newRecord(tx, 'projects');
    r.set('budget', 0);
    r.set('rate', 0);
    if (set.color === undefined) set.color = util.one(tx, 'SELECT COUNT(id) AS n FROM projects', { n: 0 }).n % 8;
    for (const k of Object.keys(set)) r.set(k, set[k]);
    if (r.getString('code') === '') r.set('code', core().nextNumber(tx, 'project'));
    tx.save(r);
    audit(tx, ctx, { kind: 'create', entity: 'projects', ref: r.id, label: label(r), summary: 'Added the project ' + label(r) });
    id = r.id;
  });
  return get(ctx, { project: id });
}

function update(ctx, p) {
  const util = u();
  on(ctx);
  auth().need(ctx, 'projects', 'edit', 'change projects');
  const app = ctx.app;
  const pr = core().resolve(app, 'projects', util.req(p, 'project', 'PRJ-0001'));
  const set = readProject(ctx, p, pr);
  const changed = Object.keys(set);
  app.runInTransaction((tx) => {
    const r = tx.findRecordById('projects', pr.id);
    for (const k of changed) r.set(k, set[k]);
    tx.save(r);
    audit(tx, ctx, { kind: 'update', entity: 'projects', ref: r.id, label: label(r), summary: 'Changed ' + (changed.length > 0 ? changed.join(', ') : 'nothing') + ' of ' + label(r), data: { fields: changed } });
  });
  return get(ctx, { project: pr.id });
}

function remove(ctx, p) {
  const util = u();
  on(ctx);
  auth().need(ctx, 'projects', 'full', 'delete projects');
  const app = ctx.app;
  const pr = core().resolve(app, 'projects', util.req(p, 'project', 'PRJ-0001'));
  const n = (sql) => util.one(app, sql, { n: 0 }, { p: pr.id }).n;
  const time = n('SELECT COUNT(id) AS n FROM timesheets WHERE project = {:p}');
  const docs = n('SELECT COUNT(DISTINCT d.id) AS n FROM documents d WHERE d.project = {:p} OR d.id IN (SELECT doc FROM document_lines WHERE project = {:p})');
  const lines = n('SELECT COUNT(id) AS n FROM journal_lines WHERE project = {:p}');
  const claims = n('SELECT COUNT(DISTINCT c.id) AS n FROM expense_claims c WHERE c.project = {:p} OR c.id IN (SELECT claim FROM claim_lines WHERE project = {:p})');
  if (time + docs + lines + claims > 0) {
    const parts = [];
    if (time > 0) parts.push(time + (time === 1 ? ' time entry' : ' time entries'));
    if (docs > 0) parts.push(docs + (docs === 1 ? ' document' : ' documents'));
    if (lines > 0) parts.push(lines + (lines === 1 ? ' journal line' : ' journal lines'));
    if (claims > 0) parts.push(claims + (claims === 1 ? ' expense claim' : ' expense claims'));
    throw util.fail(409, label(pr) + ' has ' + parts.join(', ') + '. Set its status to done or cancelled instead, so its history keeps the project.', 'has_history', { timesheets: time, documents: docs, journal_lines: lines, claims: claims });
  }
  const taskIds = util.rows(app, 'SELECT id FROM project_tasks WHERE project = {:p}', { id: '' }, { p: pr.id }).map((x) => x.id);
  if (util.bool(p, 'preview', false)) return { preview: true, project: { id: pr.id, code: pr.getString('code'), name: pr.getString('name') }, tasks: taskIds.length };
  app.runInTransaction((tx) => {
    const refs = [['projects', pr.id]].concat(taskIds.map((t) => ['project_tasks', t]));
    for (const ref of refs) {
      for (const c of ['notes', 'attachments', 'field_marks']) {
        for (const x of tx.findRecordsByFilter(c, 'entity = {:e} && ref = {:r}', '', 0, 0, { e: ref[0], r: ref[1] })) tx.delete(tx.findRecordById(c, x.id));
      }
    }
    for (const t of taskIds) {
      const rec = util.byId(tx, 'project_tasks', t);
      if (rec !== null) tx.delete(rec);
    }
    tx.delete(tx.findRecordById('projects', pr.id));
    audit(tx, ctx, { kind: 'delete', entity: 'projects', ref: pr.id, label: label(pr), summary: 'Deleted the project ' + label(pr) + (taskIds.length > 0 ? ' and its ' + taskIds.length + (taskIds.length === 1 ? ' task' : ' tasks') : '') });
  });
  return { deleted: true, tasks: taskIds.length };
}

function profit(ctx, p) {
  const util = u();
  on(ctx);
  const app = ctx.app;
  const pr = core().resolve(app, 'projects', util.req(p, 'project', 'PRJ-0001'));
  needSee(ctx, pr);
  const from = util.day(p, 'from', '');
  const to = util.day(p, 'to', '');
  if (from !== '' && to !== '' && to < from) throw util.fail(400, 'to (' + to + ') is before from (' + from + ').', 'invalid_param');
  return profitData(app, pr, from, to);
}

function summary(ctx) {
  const util = u();
  on(ctx);
  auth().need(ctx, 'projects', 'view');
  const app = ctx.app;
  const cur = core().currency(app);
  const m = money();
  const counts = { active: 0, on_hold: 0, done: 0, cancelled: 0 };
  for (const r of util.rows(app, 'SELECT status AS s, COUNT(id) AS n FROM projects GROUP BY status', { s: '', n: 0 })) counts[r.s] = r.n;
  const month = util.today().slice(0, 7);
  const hm = util.one(
    app,
    "SELECT IFNULL(SUM(hours), 0) AS h, IFNULL(SUM(CASE WHEN billable THEN hours ELSE 0 END), 0) AS hb FROM timesheets WHERE status != 'rejected' AND date >= {:a} AND date <= {:b}",
    { h: -0, hb: -0 },
    { a: util.monthStart(month), b: util.monthEnd(month) },
  );
  const toBill = util.one(
    app,
    'SELECT COUNT(ts.id) AS n, IFNULL(SUM(ts.hours), 0) AS h, IFNULL(SUM(CAST(ROUND(ts.hours * 1000) AS INTEGER) * ts.rate), 0) AS v FROM timesheets ts' +
      TS_JOIN +
      " JOIN projects pr ON pr.id = ts.project WHERE pr.billing = 'time_materials' AND ts.billable = TRUE AND ts.hours > 0 AND " +
      EFF +
      " = 'approved'",
    { n: 0, h: -0, v: 0 },
  );
  const toApprove = util.one(app, "SELECT COUNT(id) AS n, IFNULL(SUM(hours), 0) AS h FROM timesheets WHERE status = 'submitted'", { n: 0, h: -0 });
  // Budgeted projects still running, by how far over budget they are.
  const budgeted = util.rows(app, "SELECT id FROM projects WHERE budget > 0 AND status IN ('active', 'on_hold')", { id: '' }).map((x) => x.id);
  const figs = figures(app, budgeted, '', '');
  const over = [];
  const cache = {};
  for (const id of budgeted) {
    const rec = app.findRecordById('projects', id);
    const s = sums(figs[id], rec.getInt('budget'), cur);
    if (!s.over_budget) continue;
    over.push(Object.assign({ id: id, code: rec.getString('code'), name: rec.getString('name'), status: rec.getString('status'), manager: personBrief(app, rec.getString('manager'), cache), budget: rec.getInt('budget'), budget_text: m.minorText(rec.getInt('budget'), cur), over_by: s.budget_used - rec.getInt('budget'), over_by_text: m.minorText(s.budget_used - rec.getInt('budget'), cur) }, s));
  }
  over.sort((a, b) => (b.budget_used_pct !== a.budget_used_pct ? b.budget_used_pct - a.budget_used_pct : b.over_by - a.over_by));
  return {
    counts: counts,
    month: month,
    hours_this_month: r2(hm.h),
    billable_hours_this_month: r2(hm.hb),
    to_bill: { entries: toBill.n, hours: r2(toBill.h), value: timeValue(toBill.v, cur), value_text: m.minorText(timeValue(toBill.v, cur), cur) },
    to_approve: { entries: toApprove.n, hours: r2(toApprove.h) },
    over_budget: over.slice(0, 5),
    currency: cur,
  };
}

/* =============================================================== tasks */

function loadTask(app, ref, projectRef) {
  const util = u();
  const c = core();
  const pref = String(projectRef === undefined || projectRef === null ? '' : projectRef).trim();
  if (pref !== '') {
    const pr = c.resolve(app, 'projects', pref);
    const t = c.resolve(app, 'project_tasks', ref, { where: 'project = {:tp}', bind: { tp: pr.id } });
    if (t.getString('project') !== pr.id) throw util.fail(400, 'That task belongs to another project.', 'invalid_param');
    return t;
  }
  return c.resolve(app, 'project_tasks', ref);
}

/** Read and check task params (before any transaction). */
function readTask(ctx, p, isNew) {
  const util = u();
  const app = ctx.app;
  const set = {};
  if (util.has(p, 'title')) {
    const t = util.squash(util.text(p, 'title', 200, ''));
    if (t === '') throw util.fail(400, 'title cannot be empty', 'invalid_param');
    set.title = t;
  }
  if (isNew && set.title === undefined) throw util.fail(400, 'title is required, e.g. title="Draft the homepage"', 'missing_param');
  if (util.has(p, 'status')) set.status = util.oneOf(p, 'status', TASK_STATUSES, 'todo');
  else if (isNew) set.status = 'todo';
  if (util.has(p, 'assignee')) {
    const ref = util.str(p, 'assignee', '');
    set.assignee = cleared(ref) ? '' : core().resolve(app, 'employees', ref).id;
  }
  if (util.has(p, 'due')) {
    const v = util.str(p, 'due', '');
    set.due = cleared(v) ? '' : util.day(p, 'due', '');
  }
  if (util.has(p, 'estimate_hours')) {
    const h = util.qty(p, 'estimate_hours') || 0;
    if (h > 100000) throw util.fail(400, 'estimate_hours is too large', 'invalid_param');
    set.estimate_hours = h;
  }
  if (util.has(p, 'notes')) set.notes = util.text(p, 'notes', 2000, '');
  return set;
}

function endOfColumn(app, projectId, status, exceptId) {
  const r = u().one(app, 'SELECT IFNULL(MAX(sort), -1) AS s FROM project_tasks WHERE project = {:p} AND status = {:s} AND id != {:x}', { s: 0 }, { p: projectId, s: status, x: exceptId || '' });
  return (r ? r.s : -1) + 1;
}

function listTasks(ctx, p) {
  const util = u();
  on(ctx);
  const app = ctx.app;
  const pr = core().resolve(app, 'projects', util.req(p, 'project', 'PRJ-0001'));
  needSee(ctx, pr);
  const filters = ['project = {:p}'];
  const bind = { p: pr.id };
  const status = util.oneOf(p, 'status', TASK_STATUSES, '');
  if (status !== '') {
    filters.push('status = {:s}');
    bind.s = status;
  }
  const assignee = util.str(p, 'assignee', '');
  if (assignee !== '') {
    filters.push('assignee = {:a}');
    bind.a = core().resolve(app, 'employees', assignee).id;
  }
  const hours = taskHours(app, pr.id);
  const cache = {};
  const order = { todo: 0, doing: 1, done: 2 };
  const tasks = app
    .findRecordsByFilter('project_tasks', filters.join(' && '), 'sort,created', 0, 0, bind)
    .map((t) => taskOut(app, t, hours[t.id], cache))
    .sort((a, b) => order[a.status] - order[b.status] || a.sort - b.sort);
  const counts = { todo: 0, doing: 0, done: 0 };
  for (const r of util.rows(app, 'SELECT status AS s, COUNT(id) AS n FROM project_tasks WHERE project = {:p} GROUP BY status', { s: '', n: 0 }, { p: pr.id })) counts[r.s] = r.n;
  return { project: { id: pr.id, code: pr.getString('code'), name: pr.getString('name'), status: pr.getString('status') }, tasks: tasks, counts: counts, can: { edit: canEdit(ctx) || memberOf(app, pr.id, ctx.employeeId), delete: canEdit(ctx) } };
}

function oneTask(app, id) {
  const t = app.findRecordById('project_tasks', id);
  return taskOut(app, t, taskHours(app, t.getString('project'))[t.id], {});
}

function addTask(ctx, p) {
  const util = u();
  on(ctx);
  const app = ctx.app;
  const pr = core().resolve(app, 'projects', util.req(p, 'project', 'PRJ-0001'));
  needWork(ctx, pr);
  const set = readTask(ctx, p, true);
  let id = '';
  app.runInTransaction((tx) => {
    const t = util.newRecord(tx, 'project_tasks');
    t.set('project', pr.id);
    t.set('estimate_hours', 0);
    for (const k of Object.keys(set)) t.set(k, set[k]);
    t.set('sort', endOfColumn(tx, pr.id, set.status, ''));
    tx.save(t);
    audit(tx, ctx, { kind: 'create', entity: 'project_tasks', ref: t.id, label: t.getString('title'), summary: 'Added the task "' + t.getString('title') + '" to ' + label(pr) });
    id = t.id;
  });
  return oneTask(app, id);
}

function updateTask(ctx, p) {
  const util = u();
  on(ctx);
  const app = ctx.app;
  const task = loadTask(app, util.req(p, 'task'), util.str(p, 'project', ''));
  const pr = app.findRecordById('projects', task.getString('project'));
  needWork(ctx, pr);
  const set = readTask(ctx, p, false);
  const changed = Object.keys(set);
  app.runInTransaction((tx) => {
    const t = tx.findRecordById('project_tasks', task.id);
    const moved = set.status !== undefined && set.status !== t.getString('status');
    for (const k of changed) t.set(k, set[k]);
    if (moved) t.set('sort', endOfColumn(tx, pr.id, set.status, t.id));
    tx.save(t);
    audit(tx, ctx, { kind: 'update', entity: 'project_tasks', ref: t.id, label: t.getString('title'), summary: 'Changed ' + (changed.length > 0 ? changed.join(', ') : 'nothing') + ' of the task "' + t.getString('title') + '" on ' + pr.getString('code') });
  });
  return oneTask(app, task.id);
}

/** A board drag: put the task at position `sort` of column `status` and renumber that column. */
function moveTask(ctx, p) {
  const util = u();
  on(ctx);
  const app = ctx.app;
  const task = loadTask(app, util.req(p, 'task'), util.str(p, 'project', ''));
  const pr = app.findRecordById('projects', task.getString('project'));
  needWork(ctx, pr);
  const status = util.oneOf(p, 'status', TASK_STATUSES, '');
  if (status === '') throw util.fail(400, 'status is required: ' + TASK_STATUSES.join(', '), 'missing_param');
  const pos = util.int(p, 'sort', 1000000, 0, 1000000);
  const from = task.getString('status');
  app.runInTransaction((tx) => {
    const others = tx.findRecordsByFilter('project_tasks', 'project = {:p} && status = {:s} && id != {:x}', 'sort,created', 0, 0, { p: pr.id, s: status, x: task.id });
    const t = tx.findRecordById('project_tasks', task.id);
    const at = Math.min(pos, others.length);
    const column = others.slice(0, at).concat([t]).concat(others.slice(at));
    t.set('status', status);
    column.forEach((x, i) => {
      if (x.id === t.id) {
        x.set('sort', i);
        tx.save(x);
      } else if (x.getInt('sort') !== i) {
        const y = tx.findRecordById('project_tasks', x.id);
        y.set('sort', i);
        tx.save(y);
      }
    });
    audit(tx, ctx, { kind: 'update', entity: 'project_tasks', ref: t.id, label: t.getString('title'), summary: from === status ? 'Reordered the task "' + t.getString('title') + '"' : 'Moved the task "' + t.getString('title') + '" from ' + from + ' to ' + status });
  });
  return oneTask(app, task.id);
}

function removeTask(ctx, p) {
  const util = u();
  on(ctx);
  auth().need(ctx, 'projects', 'edit', 'delete tasks');
  const app = ctx.app;
  const task = loadTask(app, util.req(p, 'task'), util.str(p, 'project', ''));
  const n = util.one(app, 'SELECT COUNT(id) AS n FROM timesheets WHERE task = {:t}', { n: 0 }, { t: task.id }).n;
  if (n > 0) throw util.fail(409, 'The task "' + task.getString('title') + '" has ' + n + (n === 1 ? ' time entry' : ' time entries') + '. Mark it done instead, so the time keeps its task.', 'has_time', { timesheets: n });
  if (util.bool(p, 'preview', false)) return { preview: true, task: { id: task.id, title: task.getString('title') } };
  app.runInTransaction((tx) => {
    for (const c of ['notes', 'attachments', 'field_marks']) {
      for (const x of tx.findRecordsByFilter(c, "entity = 'project_tasks' && ref = {:r}", '', 0, 0, { r: task.id })) tx.delete(tx.findRecordById(c, x.id));
    }
    tx.delete(tx.findRecordById('project_tasks', task.id));
    audit(tx, ctx, { kind: 'delete', entity: 'project_tasks', ref: task.id, label: task.getString('title'), summary: 'Deleted the task "' + task.getString('title') + '"' });
  });
  return { deleted: true };
}

/* ========================================================== timesheets */

/** A time entry's status as people read it (see EFF). */
function effStatus(app, rec) {
  const st = rec.getString('status');
  if (st !== 'invoiced') return st;
  const d = u().byId(app, 'documents', rec.getString('invoice'));
  return d === null || d.getString('state') === 'void' ? 'approved' : 'invoiced';
}

/**
 * The employee a timesheet call is about: the `employee` param, else the
 * caller's own. mode 'view': self, their manager, Projects view, People edit;
 * mode 'save': self, People edit, Projects full, or your AI agent when asked.
 */
function employeeParam(ctx, p, mode) {
  const util = u();
  const app = ctx.app;
  const ref = util.str(p, 'employee', '');
  let emp;
  if (ref === '') {
    if (ctx.employeeId === '') {
      throw util.fail(
        400,
        ctx.isAgent ? 'employee is required: your AI agent keeps no timesheet of its own.' : 'Your account is not linked to an employee record, so it has no timesheet. An administrator links it under Members; or give employee.',
        'no_employee',
      );
    }
    emp = util.byId(app, 'employees', ctx.employeeId);
    if (emp === null) throw util.fail(400, 'Your linked employee record no longer exists.', 'no_employee');
  } else emp = core().resolve(app, 'employees', ref);
  if (emp.id === ctx.employeeId) return emp;
  const people = auth().can(ctx, 'people', 'edit');
  if (mode === 'view' && (canViewAll(ctx) || people || manages(app, ctx.employeeId, emp.id))) return emp;
  if (mode === 'save' && (ctx.isAgent || canFull(ctx) || people)) return emp;
  throw util.fail(
    403,
    mode === 'view' ? 'You can see your own time and your team\'s (others need view access to Projects).' : 'You log your own time; logging it for ' + emp.getString('name') + ' needs edit access to People or full access to Projects.',
    'not_permitted',
  );
}

function weekEntries(app, empId, monday) {
  return u().rows(
    app,
    'SELECT ts.id AS id, ts.project AS project, ts.task AS task, ts.date AS date, ts.hours AS hours, ts.billable AS billable, ts.description AS description, ' +
      EFF +
      ' AS status, ts.actor AS actor, ts.invoice AS invoice FROM timesheets ts' +
      TS_JOIN +
      ' WHERE ts.employee = {:e} AND ts.date >= {:a} AND ts.date <= {:b} ORDER BY ts.date, ts.created',
    { id: '', project: '', task: '', date: '', hours: -0, billable: false, description: '', status: '', actor: '', invoice: '' },
    { e: empId, a: monday, b: u().addDays(monday, 6) },
  );
}

function weekOut(ctx, emp, monday) {
  const util = u();
  const app = ctx.app;
  const days = [];
  for (let i = 0; i < 7; i++) days.push(util.addDays(monday, i));
  const sunday = days[6];
  const holidays = {};
  for (const h of util.rows(app, 'SELECT date, name FROM holidays WHERE date >= {:a} AND date <= {:b}', { date: '', name: '' }, { a: monday, b: sunday })) holidays[h.date] = h.name;
  const entries = weekEntries(app, emp.id, monday);
  const pcache = {};
  const tcache = {};
  const projectOf = (id) => {
    if (pcache[id] === undefined) {
      const r = util.byId(app, 'projects', id);
      pcache[id] = r === null ? { id: id, code: '', name: 'Deleted project', color: 0, status: 'cancelled', billing: 'non_billable' } : { id: r.id, code: r.getString('code'), name: r.getString('name'), color: r.getInt('color'), status: r.getString('status'), billing: r.getString('billing') };
    }
    return pcache[id];
  };
  const taskOf = (id) => {
    if (id === '') return null;
    if (tcache[id] === undefined) {
      const t = util.byId(app, 'project_tasks', id);
      tcache[id] = t === null ? { id: id, title: 'Deleted task' } : { id: t.id, title: t.getString('title') };
    }
    return tcache[id];
  };
  const rows = {};
  const order = [];
  const dayTotals = [0, 0, 0, 0, 0, 0, 0];
  const byStatus = {};
  let billable = 0;
  const flat = [];
  for (const e of entries) {
    const key = e.project + '|' + e.task;
    if (rows[key] === undefined) {
      rows[key] = { key: key, project: projectOf(e.project), task: taskOf(e.task), cells: days.map((d) => ({ date: d, hours: 0, status: '', entries: [] })), total: 0 };
      order.push(key);
    }
    const i = util.daysBetween(monday, e.date);
    const cell = rows[key].cells[i];
    cell.hours += e.hours;
    cell.entries.push(e.id);
    cell.status = cell.status === '' || cell.status === e.status ? e.status : 'mixed';
    cell.locked = cell.locked === true || LOCKED.indexOf(e.status) >= 0;
    rows[key].total += e.hours;
    dayTotals[i] += e.hours;
    byStatus[e.status] = (byStatus[e.status] || 0) + e.hours;
    if (e.billable) billable += e.hours;
    let note = '';
    if (e.status === 'rejected') {
      const a = util.one(app, "SELECT data FROM audit WHERE entity = 'timesheets' AND ref = {:r} AND kind = 'timesheet_reject' ORDER BY created DESC LIMIT 1", { data: '' }, { r: e.id });
      if (a !== null) {
        try {
          note = (JSON.parse(a.data) || {}).note || '';
        } catch {
          note = '';
        }
      }
    }
    flat.push({ id: e.id, project: projectOf(e.project), task: taskOf(e.task), date: e.date, hours: r2(e.hours), billable: e.billable, description: e.description, status: e.status, locked: LOCKED.indexOf(e.status) >= 0, actor: e.actor, note: note });
  }
  const gridRows = order
    .map((k) => rows[k])
    .sort((a, b) => (a.project.code < b.project.code ? -1 : a.project.code > b.project.code ? 1 : (a.task ? a.task.title : '') < (b.task ? b.task.title : '') ? -1 : 1))
    .map((r) => ({ key: r.key, project: r.project, task: r.task, cells: r.cells.map((c) => ({ date: c.date, hours: r2(c.hours), status: c.status, locked: c.locked === true, entries: c.entries })), total: r2(r.total) }));
  const statuses = Object.keys(byStatus);
  const weekStatus = statuses.length === 0 ? 'empty' : statuses.length === 1 ? statuses[0] : 'mixed';
  const hoursBy = {};
  for (const s of statuses) hoursBy[s] = r2(byStatus[s]);
  // Where this employee can log time: every active project, theirs first.
  const active = util.rows(app, "SELECT id, code, name, color, billing FROM projects WHERE status = 'active' ORDER BY code", { id: '', code: '', name: '', color: 0, billing: '' });
  const taskRows = util.rows(app, "SELECT t.id AS id, t.project AS project, t.title AS title, t.status AS status, t.assignee AS assignee FROM project_tasks t JOIN projects pr ON pr.id = t.project WHERE pr.status = 'active' AND t.status != 'done' ORDER BY t.project, t.sort", { id: '', project: '', title: '', status: '', assignee: '' });
  const tasksBy = {};
  for (const t of taskRows) (tasksBy[t.project] = tasksBy[t.project] || []).push({ id: t.id, title: t.title, status: t.status, mine: t.assignee === emp.id });
  const projects = active
    .map((x) => ({ id: x.id, code: x.code, name: x.name, color: x.color, billing: x.billing, billable_default: x.billing !== 'non_billable', member: memberOf(app, x.id, emp.id), tasks: tasksBy[x.id] || [] }))
    .sort((a, b) => (a.member !== b.member ? (a.member ? -1 : 1) : a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  const own = emp.id === ctx.employeeId;
  const canSave = own || ctx.isAgent || canFull(ctx) || auth().can(ctx, 'people', 'edit');
  const hasOpen = (byStatus.draft || 0) + (byStatus.rejected || 0) > 0 || entries.some((e) => e.status === 'draft' || e.status === 'rejected');
  const hasSubmitted = entries.some((e) => e.status === 'submitted');
  return {
    employee: { id: emp.id, name: emp.getString('name'), number: emp.getString('number'), manager: personBrief(app, emp.getString('manager'), {}) },
    week: monday,
    prev_week: util.addDays(monday, -7),
    next_week: util.addDays(monday, 7),
    days: days.map((d, i) => ({ date: d, day: DAY_NAMES[i], holiday: holidays[d] || '', total: r2(dayTotals[i]) })),
    rows: gridRows,
    entries: flat,
    totals: { days: dayTotals.map(r2), total: r2(dayTotals.reduce((a, b) => a + b, 0)), billable: r2(billable), by_status: hoursBy },
    status: weekStatus,
    projects: projects,
    can: {
      edit: canSave,
      submit: own && hasOpen,
      decide: !own && !ctx.isAgent && hasSubmitted && (canFull(ctx) || manages(app, ctx.employeeId, emp.id)),
    },
  };
}

function week(ctx, p) {
  const util = u();
  on(ctx);
  const emp = employeeParam(ctx, p, 'view');
  return weekOut(ctx, emp, mondayOf(util.day(p, 'week', util.today())));
}

/**
 * Save a week of time: `entries` replaces the employee's draft and rejected
 * entries of that week. Cells (project, task, day) holding submitted,
 * approved or invoiced time cannot change: sending them with the same hours
 * is fine, anything else is refused with code 'locked'.
 */
function saveWeek(ctx, p) {
  const util = u();
  on(ctx);
  const app = ctx.app;
  const emp = employeeParam(ctx, p, 'save');
  const monday = mondayOf(util.day(p, 'week', util.today()));
  const sunday = util.addDays(monday, 6);
  const input = util.list(p, 'entries');
  if (input === undefined) throw util.fail(400, 'entries is required, e.g. [{"project":"PRJ-0001","date":"' + monday + '","hours":2}]', 'missing_param');
  if (input.length > 500) throw util.fail(400, 'At most 500 entries in one week.', 'invalid_param');
  const pcache = {};
  const tcache = {};
  const entries = [];
  input.forEach((raw, i) => {
    const where = 'Entry ' + (i + 1) + ': ';
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw util.fail(400, where + 'must be an object like {"project":"PRJ-0001","task":"Design","date":"' + monday + '","hours":2}', 'invalid_param');
    util.keysOnly(raw, ['project', 'task', 'date', 'hours', 'billable', 'description'], 'Entry ' + (i + 1));
    const pref = raw.project === undefined || raw.project === null ? '' : String(raw.project).trim();
    if (pref === '') throw util.fail(400, where + 'project is required', 'missing_param');
    if (pcache[pref] === undefined) pcache[pref] = core().resolve(app, 'projects', pref);
    const pr = pcache[pref];
    let task = null;
    const tref = raw.task === undefined || raw.task === null ? '' : String(raw.task).trim();
    if (!cleared(tref)) {
      const key = pr.id + '|' + tref;
      if (tcache[key] === undefined) tcache[key] = core().resolve(app, 'project_tasks', tref, { where: 'project = {:tp}', bind: { tp: pr.id } });
      task = tcache[key];
      if (task.getString('project') !== pr.id) throw util.fail(400, where + 'the task "' + task.getString('title') + '" belongs to another project.', 'invalid_param');
    }
    const date = raw.date === undefined || raw.date === null ? '' : String(raw.date).trim();
    if (!util.isDay(date)) throw util.fail(400, where + 'date must be a real date written YYYY-MM-DD, e.g. ' + monday, 'invalid_param');
    if (date < monday || date > sunday) throw util.fail(400, where + date + ' is outside the week of ' + monday + ' to ' + sunday + '.', 'outside_week');
    const hours = util.qtyOf(raw.hours === undefined || raw.hours === null || raw.hours === '' ? 0 : raw.hours, 'hours of entry ' + (i + 1), {});
    if (Math.abs(Math.round(hours * 100) - hours * 100) > 1e-6) throw util.fail(400, where + 'hours can have at most 2 decimals (0.25 is a quarter hour).', 'invalid_param');
    if (hours > 24) throw util.fail(400, where + 'at most 24 hours in one entry.', 'too_many_hours');
    let billable = pr.getString('billing') !== 'non_billable';
    if (raw.billable !== undefined && raw.billable !== null && raw.billable !== '') {
      const b = typeof raw.billable === 'string' ? raw.billable.trim().toLowerCase() : raw.billable;
      if (b === true || b === 'true' || b === 1 || b === '1') billable = true;
      else if (b === false || b === 'false' || b === 0 || b === '0') billable = false;
      else throw util.fail(400, where + 'billable must be true or false', 'invalid_param');
      if (pr.getString('billing') === 'non_billable') billable = false;
    }
    const description = raw.description === undefined || raw.description === null ? '' : String(raw.description).trim();
    if (description.length > 500) throw util.fail(400, where + 'the description is too long (at most 500 characters).', 'invalid_param');
    entries.push({ pr: pr, task: task, date: date, hours: hours, billable: billable, description: description, cell: pr.id + '|' + (task ? task.id : '') + '|' + date });
  });
  // What is already there: locked cells stay, the rest is replaced.
  const existing = weekEntries(app, emp.id, monday);
  const lockedSum = {};
  const lockedStatus = {};
  const dayHours = {};
  const replace = [];
  for (const x of existing) {
    if (LOCKED.indexOf(x.status) >= 0) {
      const cell = x.project + '|' + x.task + '|' + x.date;
      lockedSum[cell] = (lockedSum[cell] || 0) + x.hours;
      lockedStatus[cell] = x.status;
      dayHours[x.date] = (dayHours[x.date] || 0) + x.hours;
    } else replace.push(x.id);
  }
  const sent = {};
  for (const en of entries) sent[en.cell] = (sent[en.cell] || 0) + en.hours;
  const fresh = [];
  for (const en of entries) {
    if (lockedSum[en.cell] !== undefined) {
      if (Math.abs(sent[en.cell] - lockedSum[en.cell]) > 1e-6) {
        throw util.fail(
          409,
          'The time on ' + label(en.pr) + (en.task ? ' (' + en.task.getString('title') + ')' : '') + ' on ' + en.date + ' is ' + lockedStatus[en.cell] + ' (' + fmtH(lockedSum[en.cell]) + ' h) and cannot change. ' + (lockedStatus[en.cell] === 'submitted' ? 'Ask your manager to reject it first.' : 'Log a correction on another line.'),
          'locked',
          { date: en.date, project: en.pr.id, status: lockedStatus[en.cell] },
        );
      }
      continue;
    }
    if (en.hours <= 0) continue;
    if (en.pr.getString('status') !== 'active') throw util.fail(409, label(en.pr) + ' is ' + en.pr.getString('status').replace(/_/g, ' ') + '; time is logged on active projects only.', 'project_not_active');
    dayHours[en.date] = (dayHours[en.date] || 0) + en.hours;
    fresh.push(en);
  }
  for (const d of Object.keys(dayHours)) {
    if (dayHours[d] > 24 + 1e-9) throw util.fail(400, 'That is ' + fmtH(dayHours[d]) + ' hours on ' + d + '; a day has at most 24.', 'too_many_hours', { date: d });
  }
  const cost = emp.getInt('hourly_cost');
  let total = 0;
  for (const en of fresh) total += en.hours;
  app.runInTransaction((tx) => {
    for (const id of replace) {
      const r = util.byId(tx, 'timesheets', id);
      if (r === null) continue;
      if (LOCKED.indexOf(r.getString('status')) >= 0) throw util.fail(409, 'This week changed while you were saving. Reload it and try again.', 'conflict');
      tx.delete(r);
    }
    for (const en of fresh) {
      const r = util.newRecord(tx, 'timesheets');
      r.set('employee', emp.id);
      r.set('project', en.pr.id);
      r.set('task', en.task ? en.task.id : '');
      r.set('date', en.date);
      r.set('hours', en.hours);
      r.set('description', en.description);
      r.set('billable', en.billable);
      r.set('status', 'draft');
      r.set('rate', en.pr.getInt('rate'));
      r.set('cost', cost);
      r.set('invoice', '');
      r.set('approved_by', '');
      r.set('actor', ctx.isAgent ? 'agent' : 'person');
      tx.save(r);
    }
    const forOther = emp.id !== ctx.employeeId;
    audit(tx, ctx, {
      kind: 'timesheet',
      entity: 'employees',
      ref: emp.id,
      label: emp.getString('name'),
      summary: 'Saved ' + fmtH(total) + ' h of draft time for the week of ' + monday + (forOther ? ' for ' + emp.getString('name') : ''),
      data: { week: monday, entries: fresh.length, hours: r2(total), replaced: replace.length },
    });
  });
  return weekOut(ctx, emp, monday);
}

function submit(ctx, p) {
  const util = u();
  on(ctx);
  const app = ctx.app;
  if (ctx.employeeId === '') throw util.fail(400, ctx.isAgent ? 'Your AI agent keeps no timesheet; the employee submits their own week.' : 'Your account is not linked to an employee record, so it has no timesheet.', 'no_employee');
  const emp = util.byId(app, 'employees', ctx.employeeId);
  if (emp === null) throw util.fail(400, 'Your linked employee record no longer exists.', 'no_employee');
  const monday = mondayOf(util.day(p, 'week', util.today()));
  const open = weekEntries(app, emp.id, monday).filter((e) => e.status === 'draft' || e.status === 'rejected');
  if (open.length === 0) throw util.fail(409, 'Nothing to submit in the week of ' + monday + ': save some time first.', 'nothing_to_submit');
  let total = 0;
  for (const e of open) total += e.hours;
  app.runInTransaction((tx) => {
    for (const e of open) {
      const r = tx.findRecordById('timesheets', e.id);
      if (r.getString('status') !== 'draft' && r.getString('status') !== 'rejected') continue;
      r.set('status', 'submitted');
      r.set('approved_by', '');
      tx.save(r);
    }
    audit(tx, ctx, { kind: 'timesheet_submit', entity: 'employees', ref: emp.id, label: emp.getString('name'), summary: 'Submitted ' + fmtH(total) + ' h for the week of ' + monday, data: { week: monday, ids: open.map((e) => e.id) } });
  });
  return weekOut(ctx, emp, monday);
}

/** Approve or reject submitted time (the employee's manager, or full Projects rights; never one's own). */
function decide(ctx, p) {
  const util = u();
  on(ctx);
  const app = ctx.app;
  if (ctx.isAgent) throw util.fail(403, 'Your AI agent cannot approve or reject time. A manager does this.', 'agent_not_permitted');
  const ids = util.list(p, 'ids');
  if (ids === undefined || ids.length === 0) throw util.fail(400, 'ids is required: a JSON list of time entry ids, e.g. ["abc123def456ghi"]', 'missing_param');
  if (ids.length > 1000) throw util.fail(400, 'At most 1000 entries at once.', 'invalid_param');
  const approve = util.bool(p, 'approve', undefined);
  if (approve === undefined) throw util.fail(400, 'approve is required: true approves, false rejects', 'missing_param');
  const note = util.text(p, 'note', 500, '');
  const full = canFull(ctx);
  const seen = {};
  const recs = [];
  for (const raw of ids) {
    const id = String(raw === undefined || raw === null ? '' : raw).trim();
    if (id === '' || seen[id]) continue;
    seen[id] = true;
    const r = util.byId(app, 'timesheets', id);
    if (r === null) throw util.fail(404, 'No time entry ' + id + '. See timesheets.list.', 'not_found');
    const st = effStatus(app, r);
    if (st !== 'submitted') throw util.fail(409, 'The entry of ' + r.getString('date') + ' is ' + st + '; only submitted time is approved or rejected.', 'not_submitted', { id: id, status: st });
    if (r.getString('employee') === ctx.employeeId) throw util.fail(403, 'You cannot approve or reject your own time.', 'own_time');
    if (!full && !manages(app, ctx.employeeId, r.getString('employee'))) {
      const e = util.byId(app, 'employees', r.getString('employee'));
      throw util.fail(403, 'You do not manage ' + (e ? e.getString('name') : 'that employee') + '. Their manager, or someone with full access to Projects, decides their time.', 'not_permitted');
    }
    recs.push(r);
  }
  const next = approve ? 'approved' : 'rejected';
  const byEmp = {};
  app.runInTransaction((tx) => {
    for (const r0 of recs) {
      const r = tx.findRecordById('timesheets', r0.id);
      if (r.getString('status') !== 'submitted') throw util.fail(409, 'The entry of ' + r.getString('date') + ' changed meanwhile. Reload and try again.', 'conflict');
      r.set('status', next);
      r.set('approved_by', ctx.memberId);
      tx.save(r);
      const g = byEmp[r.getString('employee')] || { ids: [], hours: 0 };
      g.ids.push(r.id);
      g.hours += r.getFloat('hours');
      byEmp[r.getString('employee')] = g;
      if (!approve) {
        const pr = util.byId(tx, 'projects', r.getString('project'));
        audit(tx, ctx, {
          kind: 'timesheet_reject',
          entity: 'timesheets',
          ref: r.id,
          label: (pr ? pr.getString('code') : '') + ' ' + r.getString('date'),
          summary: 'Rejected ' + fmtH(r.getFloat('hours')) + ' h on ' + (pr ? label(pr) : 'a project') + ' on ' + r.getString('date') + (note !== '' ? ': ' + note : ''),
          data: { note: note },
        });
      }
    }
    for (const empId of Object.keys(byEmp)) {
      const e = util.byId(tx, 'employees', empId);
      const name = e ? e.getString('name') : 'an employee';
      audit(tx, ctx, {
        kind: approve ? 'timesheet_approve' : 'timesheet_reject_all',
        entity: 'employees',
        ref: empId,
        label: name,
        summary: (approve ? 'Approved ' : 'Rejected ') + fmtH(byEmp[empId].hours) + ' h of ' + name + "'s time" + (note !== '' ? ': ' + note : ''),
        data: { ids: byEmp[empId].ids, note: note },
      });
    }
  });
  const cur = core().currency(app);
  const bind = {};
  const list = recs.length > 0 ? binds(recs.map((r) => r.id), 'd', bind).join(', ') : "''";
  return { decided: recs.length, status: next, entries: entryRows(app, '', 'ts.id IN (' + list + ')', bind, 'ts.date, e.name', 1000, 0, cur) };
}

function listTime(ctx, p) {
  const util = u();
  on(ctx);
  const app = ctx.app;
  const cur = core().currency(app);
  const m = money();
  const pg = util.page(p, 50, 1000);
  const where = ['1 = 1'];
  const bind = {};
  const cte = '';
  let project = null;
  const pref = util.str(p, 'project', '');
  if (pref !== '') {
    project = core().resolve(app, 'projects', pref);
    where.push('ts.project = {:pr}');
    bind.pr = project.id;
  }
  const scope = util.oneOf(p, 'scope', ['mine', 'team', 'all'], ctx.employeeId !== '' && !ctx.isAgent ? 'mine' : 'all');
  if (scope === 'mine' || scope === 'team') {
    if (ctx.employeeId === '') throw util.fail(400, 'Your account is not linked to an employee record; use scope all.', 'no_employee');
    bind.me = ctx.employeeId;
    if (scope === 'mine') where.push('ts.employee = {:me}');
    else {
      // The team once, as a JSON list both queries below filter by (the recursion is the slow part).
      const team = util.one(app, TEAM_CTE + "SELECT IFNULL(json_group_array(id), '[]') AS ids FROM team", { ids: '' }, { me: ctx.employeeId });
      bind.team = team !== null && team.ids !== '' ? team.ids : '[]';
      where.push('ts.employee IN (SELECT value FROM json_each({:team}))');
    }
  } else if (!canViewAll(ctx) && !(project !== null && ctx.employeeId !== '' && project.getString('manager') === ctx.employeeId)) {
    throw util.fail(403, 'Everyone\'s time needs view access to Projects (a project manager sees their project with --project).', 'not_permitted');
  }
  const eref = util.str(p, 'employee', '');
  if (eref !== '') {
    where.push('ts.employee = {:em}');
    bind.em = core().resolve(app, 'employees', eref).id;
  }
  const status = util.oneOf(p, 'status', TS_STATUSES, '');
  if (status !== '') {
    where.push(EFF + ' = {:st}');
    bind.st = status;
  }
  const from = util.day(p, 'from', '');
  if (from !== '') {
    where.push('ts.date >= {:f}');
    bind.f = from;
  }
  const to = util.day(p, 'to', '');
  if (to !== '') {
    where.push('ts.date <= {:t}');
    bind.t = to;
  }
  const w = where.join(' AND ');
  const tot = util.one(
    app,
    cte +
      'SELECT COUNT(ts.id) AS n, IFNULL(SUM(ts.hours), 0) AS h, IFNULL(SUM(CASE WHEN ts.billable THEN ts.hours ELSE 0 END), 0) AS hb, IFNULL(SUM(CASE WHEN ts.billable THEN CAST(ROUND(ts.hours * 1000) AS INTEGER) * ts.rate ELSE 0 END), 0) AS v, IFNULL(SUM(CAST(ROUND(ts.hours * 1000) AS INTEGER) * ts.cost), 0) AS c FROM timesheets ts' +
      TS_JOIN +
      ' WHERE ' +
      w,
    { n: 0, h: -0, hb: -0, v: 0, c: 0 },
    bind,
  );
  const entries = entryRows(app, cte, w, bind, 'ts.date DESC, e.name COLLATE NOCASE, pr.code', pg.limit, pg.offset, cur);
  const value = timeValue(tot.v, cur);
  const cost = timeValue(tot.c, cur);
  return {
    scope: scope,
    entries: entries,
    total: tot.n,
    totals: { hours: r2(tot.h), billable_hours: r2(tot.hb), billable_value: value, billable_value_text: m.minorText(value, cur), cost: cost, cost_text: m.minorText(cost, cur) },
    currency: cur,
  };
}

/** Approved billable time of a project not yet on a live invoice, grouped per employee and rate. */
function billableTime(h, projectId, through) {
  const util = u();
  const rows = util.rows(
    h,
    "SELECT ts.id AS id, ts.employee AS employee, IFNULL(e.name, '') AS name, ts.date AS date, ts.hours AS hours, ts.rate AS rate FROM timesheets ts" +
      TS_JOIN +
      ' LEFT JOIN employees e ON e.id = ts.employee WHERE ts.project = {:p} AND ts.billable = TRUE AND ts.hours > 0 AND ts.date <= {:t} AND ' +
      EFF +
      " = 'approved' ORDER BY e.name COLLATE NOCASE, ts.employee, ts.rate, ts.date",
    { id: '', employee: '', name: '', date: '', hours: -0, rate: 0 },
    { p: projectId, t: through },
  );
  const groups = [];
  const at = {};
  for (const r of rows) {
    const key = r.employee + '|' + r.rate;
    if (at[key] === undefined) {
      at[key] = groups.length;
      groups.push({ employee: r.employee, name: r.name, rate: r.rate, first: r.date, last: r.date, hours: 0, ids: [] });
    }
    const g = groups[at[key]];
    if (r.date < g.first) g.first = r.date;
    if (r.date > g.last) g.last = r.date;
    g.hours += r.hours;
    g.ids.push(r.id);
  }
  for (const g of groups) g.hours = r2(g.hours);
  return { rows: rows, groups: groups };
}

/**
 * Bill a time-and-materials project's approved billable time through a date
 * to ONE draft invoice for its customer: one line per employee (and rate).
 */
function bill(ctx, p) {
  const util = u();
  on(ctx);
  const app = ctx.app;
  if (!canFull(ctx) && !auth().can(ctx, 'sales', 'edit')) throw util.fail(403, 'Your role cannot bill time (needs full access to Projects or edit access to Sales).', 'not_permitted');
  const pr = core().resolve(app, 'projects', util.req(p, 'project', 'PRJ-0001'));
  if (pr.getString('billing') !== 'time_materials') throw util.fail(409, label(pr) + ' is ' + (pr.getString('billing') === 'fixed' ? 'billed at a fixed price' : 'not billable') + '; only time-and-materials projects bill their time.', 'not_time_materials');
  if (pr.getString('customer') === '') throw util.fail(409, label(pr) + ' has no customer. Set one with projects.update --customer first.', 'no_customer');
  const through = util.day(p, 'through', util.today());
  const cur = core().currency(app);
  const m = money();
  const first = billableTime(app, pr.id, through);
  if (first.rows.length === 0) throw util.fail(409, 'No approved billable time on ' + label(pr) + ' up to ' + through + ' is waiting to be billed.', 'nothing_to_bill');
  const describe = (g) => pr.getString('name') + ': ' + g.name + ' ' + g.first + ' to ' + g.last;
  if (util.bool(p, 'preview', false)) {
    let amount = 0;
    const lines = first.groups.map((g) => {
      const v = m.stockValue(g.hours, g.rate, cur);
      amount += v;
      return { employee: { id: g.employee, name: g.name }, description: describe(g), from: g.first, to: g.last, hours: g.hours, rate: g.rate, rate_text: m.e4Text(g.rate, cur), amount: v, amount_text: m.minorText(v, cur), entries: g.ids.length };
    });
    const party = util.byId(app, 'parties', pr.getString('customer'));
    return { preview: true, project: { id: pr.id, code: pr.getString('code'), name: pr.getString('name') }, customer: party ? { id: party.id, name: party.getString('name') } : null, through: through, entries: first.rows.length, lines: lines, amount: amount, amount_text: m.minorText(amount, cur), currency: cur, note: 'Before tax; the invoice applies the customer\'s sales tax.' };
  }
  let account = '';
  try {
    account = core().systemAccount(app, 'service_revenue').id;
  } catch {
    account = '';
  }
  // Billing makes a draft invoice; full Projects rights may do that without Sales rights.
  const levels = Object.assign({}, ctx.levels);
  if (!auth().can(ctx, 'sales', 'edit')) levels.sales = 'edit';
  let docId = '';
  let hours = 0;
  let count = 0;
  app.runInTransaction((tx) => {
    const now = billableTime(tx, pr.id, through);
    if (now.rows.length === 0) throw util.fail(409, 'No approved billable time on ' + label(pr) + ' up to ' + through + ' is waiting to be billed.', 'nothing_to_bill');
    const lines = now.groups.map((g) => {
      const line = { description: describe(g), qty: g.hours, unit: 'hour', unit_price: m.e4Text(g.rate, cur), project: pr.id };
      if (account !== '') line.account = account;
      return line;
    });
    const c2 = Object.assign({}, ctx, { app: tx, levels: levels });
    const inv = docsLib().create(c2, {
      type: 'invoice',
      party: pr.getString('customer'),
      currency: cur,
      project: pr.id,
      internal_note: 'Time on ' + label(pr) + ' up to ' + through + ' (' + now.rows.length + (now.rows.length === 1 ? ' entry' : ' entries') + ').',
      lines: lines,
    });
    docId = inv.id;
    for (const r of now.rows) {
      const x = tx.findRecordById('timesheets', r.id);
      x.set('status', 'invoiced');
      x.set('invoice', docId);
      tx.save(x);
      hours += r.hours;
    }
    count = now.rows.length;
    audit(tx, ctx, {
      kind: 'bill',
      entity: 'projects',
      ref: pr.id,
      label: label(pr),
      summary: 'Billed ' + fmtH(hours) + ' h of time on ' + label(pr) + ' up to ' + through + ' to a draft invoice',
      data: { invoice: docId, entries: now.rows.map((r) => r.id) },
    });
  });
  const out = docsLib().get(Object.assign({}, ctx, { levels: levels }), { doc: docId });
  out.billed = { entries: count, hours: r2(hours), through: through, project: { id: pr.id, code: pr.getString('code'), name: pr.getString('name') } };
  return out;
}

module.exports = {
  STATUSES: STATUSES,
  BILLING: BILLING,
  TASK_STATUSES: TASK_STATUSES,
  TS_STATUSES: TS_STATUSES,
  isMember: isMember,
  memberOf: memberOf,
  manages: manages,
  effStatus: effStatus,
  figures: figures,
  profitData: profitData,
  list: list,
  get: get,
  add: add,
  update: update,
  remove: remove,
  profit: profit,
  summary: summary,
  listTasks: listTasks,
  addTask: addTask,
  updateTask: updateTask,
  moveTask: moveTask,
  removeTask: removeTask,
  week: week,
  saveWeek: saveWeek,
  submit: submit,
  decide: decide,
  listTime: listTime,
  bill: bill,
};
