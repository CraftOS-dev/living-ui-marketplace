/// <reference path="../pb_data/types.d.ts" />
/**
 * People: departments, the employee directory and the org chart, plus the
 * rights the leave, claims and payroll modules share.
 *
 * Who sees what about an employee:
 * - everyone: the directory basics (name, number, job title, department,
 *   manager, photo, email, phone, status);
 * - People view: every field except pay;
 * - Payroll view, or People full: pay too (basic pay, frequency, hourly
 *   cost, bank details, national id, tax number);
 * - the employee: their own record in full.
 * A manager is anyone above an employee in the manager chain (at most ten
 * levels); managers see and decide their reports' leave and claims.
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
let auditMod = null;
function audit() {
  if (auditMod === null) auditMod = require(`${__hooks}/lib_audit.js`);
  return auditMod;
}
let leaveLibMod = null;
function leaveLib() {
  if (leaveLibMod === null) leaveLibMod = require(`${__hooks}/lib_leave.js`);
  return leaveLibMod;
}
let claimsLibMod = null;
function claimsLib() {
  if (claimsLibMod === null) claimsLibMod = require(`${__hooks}/lib_claims.js`);
  return claimsLibMod;
}
let payrollLibMod = null;
function payrollLib() {
  if (payrollLibMod === null) payrollLibMod = require(`${__hooks}/lib_payroll.js`);
  return payrollLibMod;
}


const MAX_DEPTH = 10;
const STATUSES = ['active', 'on_leave', 'left'];
const EMPLOYMENT = ['full_time', 'part_time', 'contractor', 'intern', 'temporary'];
const FREQUENCIES = ['monthly', 'semi_monthly', 'biweekly', 'weekly'];
const PAY_FIELDS = ['pay_basic', 'pay_frequency', 'hourly_cost', 'bank_details', 'national_id', 'tax_number'];

/* ============================================================== rights */

/** True when `managerId` is above `employeeId` in the manager chain (at most ten levels). */
function manages(app, managerId, employeeId) {
  if (typeof managerId !== 'string' || managerId === '' || typeof employeeId !== 'string' || employeeId === '' || managerId === employeeId) return false;
  const util = u();
  let cur = employeeId;
  for (let i = 0; i < MAX_DEPTH; i++) {
    const r = util.one(app, "SELECT IFNULL(manager, '') AS manager FROM employees WHERE id = {:id}", { manager: '' }, { id: cur });
    if (r === null || r.manager === '') return false;
    if (r.manager === managerId) return true;
    cur = r.manager;
  }
  return false;
}

/**
 * A SQL subquery listing the ids of everyone below the employee bound to
 * `{:<bind>}` (direct and indirect reports, at most ten levels).
 */
function teamSql(bind) {
  const b = '{:' + bind + '}';
  return '(WITH RECURSIVE team(id, depth) AS (SELECT id, 1 FROM employees WHERE manager = ' + b + ' AND id != ' + b + ' UNION SELECT e.id, t.depth + 1 FROM employees e JOIN team t ON e.manager = t.id WHERE t.depth < ' + MAX_DEPTH + ') SELECT id FROM team)';
}

/** Ids of an employee's direct and indirect reports. */
function reportIds(app, managerId) {
  if (typeof managerId !== 'string' || managerId === '') return [];
  return u()
    .rows(app, 'SELECT id FROM ' + teamSql('m') + ' x', { id: '' }, { m: managerId })
    .map((r) => r.id)
    .filter((id) => id !== managerId);
}

/**
 * Everyone below ctx's employee as a JSON list of ids, from one recursive
 * query per request (the recursion is the slow part on big organisations;
 * lists then filter with json_each).
 */
function teamJson(ctx) {
  if (ctx._teamJson === undefined) {
    if (ctx.isAgent || ctx.employeeId === '') ctx._teamJson = '[]';
    else {
      const r = u().one(ctx.app, "SELECT IFNULL(json_group_array(x.id), '[]') AS ids FROM " + teamSql('m') + ' x', { ids: '' }, { m: ctx.employeeId });
      ctx._teamJson = r !== null && r.ids !== '' ? r.ids : '[]';
    }
  }
  return ctx._teamJson;
}

/** Everyone below ctx's employee as a lookup by id (once per request). */
function teamOf(ctx) {
  if (ctx._team === undefined) {
    const t = {};
    for (const id of JSON.parse(teamJson(ctx))) t[id] = true;
    ctx._team = t;
  }
  return ctx._team;
}

/** SQL: `column` holds someone below ctx's employee (binds {:team}). */
function inTeamSql(ctx, column, bind) {
  bind.team = teamJson(ctx);
  return column + ' IN (SELECT value FROM json_each({:team}))';
}

/** Throw unless the module is switched on. */
function needOn(ctx, module) {
  const a = auth();
  if (!a.moduleOn(ctx.app, module)) throw u().fail(403, a.MODULE_LABEL[module] + ' is switched off in Settings.', 'module_off', { module: module });
}

/**
 * Whether a module is on, read once per request (the settings row is read
 * on every call otherwise, and lists ask for every row).
 */
function moduleOnFor(ctx, module) {
  if (ctx._modulesOn === undefined) ctx._modulesOn = {};
  if (ctx._modulesOn[module] === undefined) ctx._modulesOn[module] = auth().moduleOn(ctx.app, module);
  return ctx._modulesOn[module];
}

/** Level on a module, counting a switched-off module as none (your AI agent has every level). */
function has(ctx, module, level) {
  if (!moduleOnFor(ctx, module)) return false;
  return ctx.isAgent || auth().can(ctx, module, level);
}

function isOwn(ctx, employeeId) {
  return !ctx.isAgent && ctx.employeeId !== '' && employeeId === ctx.employeeId;
}

function canViewPeople(ctx) {
  return ctx.isAgent || has(ctx, 'people', 'view');
}

/** What ctx sees about everyone (computed once per request). */
function rightsOf(ctx) {
  if (ctx._peopleRights === undefined) {
    ctx._peopleRights = {
      details: canViewPeople(ctx),
      pay: ctx.isAgent || has(ctx, 'payroll', 'view') || has(ctx, 'people', 'full'),
    };
  }
  return ctx._peopleRights;
}

function seesDetails(ctx, employeeId) {
  return rightsOf(ctx).details || isOwn(ctx, employeeId);
}

function seesPay(ctx, employeeId) {
  return rightsOf(ctx).pay || isOwn(ctx, employeeId);
}

/** The base currency, read once per request. */
function currencyOf(ctx) {
  if (ctx._currency === undefined) ctx._currency = core().currency(ctx.app);
  return ctx._currency;
}

function editsPay(ctx) {
  return ctx.isAgent || has(ctx, 'payroll', 'edit') || has(ctx, 'people', 'full');
}

/** May ctx see this employee's leave and claims (self, a manager above them, People view)? */
function seesSelfService(ctx, employeeId) {
  return canViewPeople(ctx) || isOwn(ctx, employeeId) || manages(ctx.app, ctx.employeeId, employeeId);
}

/** The caller's own employee record id, or a clear refusal. */
function ownEmployee(ctx) {
  if (ctx.isAgent) throw u().fail(400, 'employee is required: your AI agent acts for a named employee.', 'missing_param', { param: 'employee' });
  if (ctx.employeeId === '' || u().byId(ctx.app, 'employees', ctx.employeeId) === null) {
    throw u().fail(409, 'Your account is not linked to an employee record. Ask an administrator to link it under Members.', 'no_employee');
  }
  return ctx.employeeId;
}

/**
 * The employee an operation acts for: the `employee` param (People edit when
 * it is someone else) or the caller.
 */
function targetEmployee(ctx, p, what) {
  const util = u();
  const ref = util.str(p, 'employee', '');
  if (ref === '') return ctx.app.findRecordById('employees', ownEmployee(ctx));
  const emp = core().resolve(ctx.app, 'employees', ref);
  if (!isOwn(ctx, emp.id)) auth().need(ctx, 'people', 'edit', what || 'act for other employees');
  return emp;
}

/* ============================================================ outputs */

function photoUrl(rec) {
  if (rec === null) return '';
  const f = rec.getString('photo');
  return f === '' ? '' : '/api/files/employees/' + rec.id + '/' + f;
}

/** id -> {id, name, number, job_title, photo} (cached; null when empty). */
function empBrief(app, id, cache) {
  if (typeof id !== 'string' || id === '') return null;
  const c = cache || {};
  const key = 'e:' + id;
  if (c[key] !== undefined) return c[key];
  const r = u().byId(app, 'employees', id);
  c[key] = r === null ? null : { id: r.id, name: r.getString('name'), number: r.getString('number'), job_title: r.getString('job_title'), photo: photoUrl(r), status: r.getString('status') };
  return c[key];
}

function deptBrief(app, id, cache) {
  if (typeof id !== 'string' || id === '') return null;
  const c = cache || {};
  const key = 'd:' + id;
  if (c[key] !== undefined) return c[key];
  const r = u().byId(app, 'departments', id);
  c[key] = r === null ? null : { id: r.id, name: r.getString('name'), code: r.getString('code') };
  return c[key];
}

/** An employee for ctx: the basics, plus details and pay where ctx may see them. */
function employeeOut(app, ctx, r, cache) {
  const c = cache || {};
  const out = {
    id: r.id,
    number: r.getString('number'),
    name: r.getString('name'),
    job_title: r.getString('job_title'),
    department: deptBrief(app, r.getString('department'), c),
    manager: empBrief(app, r.getString('manager'), c),
    photo: photoUrl(r),
    email: r.getString('email'),
    phone: r.getString('phone'),
    status: r.getString('status'),
    own: isOwn(ctx, r.id),
    details: false,
    pay: false,
  };
  if (seesDetails(ctx, r.id)) {
    const m = u().byId(app, 'members', r.getString('member'));
    Object.assign(out, {
      details: true,
      employment: r.getString('employment'),
      start_date: r.getString('start_date'),
      end_date: r.getString('end_date'),
      address: r.getString('address'),
      birthday: r.getString('birthday'),
      emergency_contact: r.getString('emergency_contact'),
      notes: r.getString('notes'),
      member: m !== null ? { id: m.id, name: m.getString('name'), email: m.getString('email'), status: m.getString('status') } : null,
      created: r.getString('created'),
    });
  }
  if (seesPay(ctx, r.id)) {
    const cur = currencyOf(ctx);
    Object.assign(out, {
      pay: true,
      pay_basic: r.getInt('pay_basic'),
      pay_basic_text: money().minorText(r.getInt('pay_basic'), cur),
      pay_frequency: r.getString('pay_frequency') || 'monthly',
      hourly_cost: r.getInt('hourly_cost'),
      hourly_cost_text: money().minorText(r.getInt('hourly_cost'), cur),
      bank_details: r.getString('bank_details'),
      national_id: r.getString('national_id'),
      tax_number: r.getString('tax_number'),
      currency: cur,
    });
  }
  return out;
}

/* ========================================================= departments */

function departmentOut(app, d, counts, cache) {
  return {
    id: d.id,
    name: d.getString('name'),
    code: d.getString('code'),
    parent: deptBrief(app, d.getString('parent'), cache),
    manager: empBrief(app, d.getString('manager'), cache),
    archived: d.getBool('archived'),
    sort: d.getInt('sort'),
    employees: counts[d.id] || 0,
  };
}

function deptCounts(app) {
  const counts = {};
  for (const r of u().rows(app, "SELECT IFNULL(department, '') AS d, COUNT(id) AS n FROM employees WHERE status != 'left' GROUP BY department", { d: '', n: 0 })) counts[r.d] = r.n;
  return counts;
}

function listDepartments(ctx, p) {
  const util = u();
  const app = ctx.app;
  const withArchived = util.bool(p, 'archived', false);
  const counts = deptCounts(app);
  const cache = {};
  const recs = app.findRecordsByFilter('departments', withArchived ? '' : 'archived = false', 'sort,name', 0, 0);
  return {
    departments: recs.map((d) => departmentOut(app, d, counts, cache)),
    without_department: counts[''] || 0,
    can: { edit: has(ctx, 'people', 'edit') },
  };
}

function readDepartment(ctx, app, r, p, isNew) {
  const util = u();
  const c = core();
  if (util.has(p, 'name')) {
    const n = util.squash(util.text(p, 'name', 80, ''));
    if (n === '') throw util.fail(400, 'name cannot be empty', 'invalid_param', { param: 'name' });
    if (util.idsNocaseFind(app, 'departments', 'name', n, r.id || '')) throw util.fail(409, 'There is already a department called ' + n + '.', 'duplicate');
    r.set('name', n);
  }
  if (isNew && r.getString('name') === '') throw util.fail(400, 'name is required, e.g. name=Engineering', 'missing_param', { param: 'name' });
  if (util.has(p, 'code')) {
    const code = util.text(p, 'code', 20, '').toUpperCase();
    if (code !== '' && util.idsNocaseFind(app, 'departments', 'code', code, r.id || '')) throw util.fail(409, 'The department code ' + code + ' is taken.', 'duplicate');
    r.set('code', code);
  }
  if (util.has(p, 'parent')) {
    const parent = c.resolveOpt(app, 'departments', util.str(p, 'parent', ''));
    if (parent !== null) {
      if (!isNew) {
        let cur = parent;
        for (let i = 0; i < 20 && cur !== null; i++) {
          if (cur.id === r.id) throw util.fail(409, 'A department cannot sit inside itself or one of its own sub-departments.', 'loop');
          cur = util.byId(app, 'departments', cur.getString('parent'));
        }
      }
    }
    r.set('parent', parent !== null ? parent.id : '');
  }
  if (util.has(p, 'manager')) {
    const m = c.resolveOpt(app, 'employees', util.str(p, 'manager', ''));
    r.set('manager', m !== null ? m.id : '');
  }
  if (util.has(p, 'archived')) r.set('archived', util.bool(p, 'archived', false));
  if (util.has(p, 'sort')) r.set('sort', util.int(p, 'sort', 0, 0, 100000));
}

function departmentResult(ctx, id) {
  const app = ctx.app;
  return departmentOut(app, app.findRecordById('departments', id), deptCounts(app), {});
}

function addDepartment(ctx, p) {
  auth().need(ctx, 'people', 'edit', 'change departments');
  const util = u();
  const app = ctx.app;
  const r = util.newRecord(app, 'departments');
  r.set('archived', false);
  r.set('sort', 100);
  readDepartment(ctx, app, r, p, true);
  app.runInTransaction((tx) => {
    tx.save(r);
    audit().write(tx, ctx, { kind: 'create', entity: 'departments', ref: r.id, label: r.getString('name'), summary: 'Added the department ' + r.getString('name') });
  });
  return departmentResult(ctx, r.id);
}

function updateDepartment(ctx, p) {
  auth().need(ctx, 'people', 'edit', 'change departments');
  const util = u();
  const app = ctx.app;
  const found = core().resolve(app, 'departments', util.req(p, 'department'));
  const r = app.findRecordById('departments', found.id);
  readDepartment(ctx, app, r, p, false);
  app.runInTransaction((tx) => {
    tx.save(r);
    audit().write(tx, ctx, { kind: 'update', entity: 'departments', ref: r.id, label: r.getString('name'), summary: 'Changed the department ' + r.getString('name') });
  });
  return departmentResult(ctx, r.id);
}

function deleteDepartment(ctx, p) {
  auth().need(ctx, 'people', 'edit', 'change departments');
  const util = u();
  const app = ctx.app;
  const d = core().resolve(app, 'departments', util.req(p, 'department'));
  const n = util.one(app, 'SELECT COUNT(id) AS n FROM employees WHERE department = {:d}', { n: 0 }, { d: d.id }).n;
  if (n > 0) throw util.fail(409, d.getString('name') + ' has ' + n + (n === 1 ? ' employee' : ' employees') + '. Move them to another department first.', 'has_employees', { employees: n });
  let used = 0;
  for (const t of ['journal_lines', 'documents', 'document_lines', 'assets']) used += util.one(app, 'SELECT COUNT(id) AS n FROM ' + t + ' WHERE department = {:d}', { n: 0 }, { d: d.id }).n;
  if (used > 0) throw util.fail(409, d.getString('name') + ' is used on entries and documents. Archive it instead, so the books keep its name.', 'has_history');
  const children = app.findRecordsByFilter('departments', 'parent = {:d}', '', 0, 0, { d: d.id });
  if (util.bool(p, 'preview', false)) return { preview: true, name: d.getString('name'), sub_departments_moved_up: children.length };
  app.runInTransaction((tx) => {
    for (const ch of children) {
      const x = tx.findRecordById('departments', ch.id);
      x.set('parent', d.getString('parent'));
      tx.save(x);
    }
    tx.delete(tx.findRecordById('departments', d.id));
    audit().write(tx, ctx, { kind: 'delete', entity: 'departments', ref: d.id, label: d.getString('name'), summary: 'Deleted the department ' + d.getString('name') });
  });
  return { deleted: true, sub_departments_moved_up: children.length };
}

/* =========================================================== employees */

function listEmployees(ctx, p) {
  const util = u();
  const app = ctx.app;
  const c = core();
  const pg = util.page(p, 100, 1000);
  const where = ['1 = 1'];
  const bind = {};
  const q = util.str(p, 'q', '');
  if (q !== '') {
    where.push("(e.name LIKE {:q} ESCAPE '\\' OR e.number LIKE {:q} ESCAPE '\\' OR e.email LIKE {:q} ESCAPE '\\' OR e.job_title LIKE {:q} ESCAPE '\\')");
    bind.q = util.like(q);
  }
  const dept = util.str(p, 'department', '');
  if (dept !== '') {
    if (dept.toLowerCase() === 'none') where.push("e.department = ''");
    else {
      where.push('e.department = {:d}');
      bind.d = c.resolve(app, 'departments', dept).id;
    }
  }
  const mgr = util.str(p, 'manager', '');
  if (mgr !== '') {
    where.push('e.manager = {:m}');
    bind.m = c.resolve(app, 'employees', mgr).id;
  }
  const status = util.oneOf(p, 'status', ['active', 'on_leave', 'left', 'current', 'all'], 'current');
  if (status === 'current') where.push("e.status != 'left'");
  else if (status !== 'all') {
    where.push('e.status = {:s}');
    bind.s = status;
  }
  const sql = ' FROM employees e WHERE ' + where.join(' AND ');
  const total = util.one(app, 'SELECT COUNT(e.id) AS n' + sql, { n: 0 }, bind).n;
  // One query for the page: each employee with their department, manager,
  // app account and number of current reports.
  const rows = util.rows(
    app,
    'SELECT e.id AS id, e.number AS number, e.name AS name, e.job_title AS job_title, e.photo AS photo, e.email AS email, e.phone AS phone, e.status AS status, ' +
      'e.employment AS employment, e.start_date AS start_date, e.end_date AS end_date, e.address AS address, e.birthday AS birthday, e.emergency_contact AS emergency_contact, e.notes AS notes, e.created AS created, ' +
      'IFNULL(e.pay_basic, 0) AS pay_basic, e.pay_frequency AS pay_frequency, IFNULL(e.hourly_cost, 0) AS hourly_cost, e.bank_details AS bank_details, e.national_id AS national_id, e.tax_number AS tax_number, ' +
      "IFNULL(d.id, '') AS d_id, IFNULL(d.name, '') AS d_name, IFNULL(d.code, '') AS d_code, " +
      "IFNULL(m.id, '') AS m_id, IFNULL(m.name, '') AS m_name, IFNULL(m.number, '') AS m_number, IFNULL(m.job_title, '') AS m_title, IFNULL(m.photo, '') AS m_photo, IFNULL(m.status, '') AS m_status, " +
      "IFNULL(mb.id, '') AS mb_id, IFNULL(mb.name, '') AS mb_name, IFNULL(mb.email, '') AS mb_email, IFNULL(mb.status, '') AS mb_status, " +
      "(SELECT COUNT(x.id) FROM employees x WHERE x.manager = e.id AND x.status != 'left') AS reports" +
      ' FROM employees e LEFT JOIN departments d ON d.id = e.department LEFT JOIN employees m ON m.id = e.manager LEFT JOIN members mb ON mb.id = e.member WHERE ' +
      where.join(' AND ') +
      ' ORDER BY e.name COLLATE NOCASE, e.number LIMIT ' +
      pg.limit +
      ' OFFSET ' +
      pg.offset,
    {
      id: '', number: '', name: '', job_title: '', photo: '', email: '', phone: '', status: '',
      employment: '', start_date: '', end_date: '', address: '', birthday: '', emergency_contact: '', notes: '', created: '',
      pay_basic: 0, pay_frequency: '', hourly_cost: 0, bank_details: '', national_id: '', tax_number: '',
      d_id: '', d_name: '', d_code: '', m_id: '', m_name: '', m_number: '', m_title: '', m_photo: '', m_status: '',
      mb_id: '', mb_name: '', mb_email: '', mb_status: '', reports: 0,
    },
    bind,
  );
  const rights = rightsOf(ctx);
  const cur = currencyOf(ctx);
  const m = money();
  const file = (id, f) => (f === '' ? '' : '/api/files/employees/' + id + '/' + f);
  const employees = rows.map((r) => {
    const own = isOwn(ctx, r.id);
    const out = {
      id: r.id,
      number: r.number,
      name: r.name,
      job_title: r.job_title,
      department: r.d_id !== '' ? { id: r.d_id, name: r.d_name, code: r.d_code } : null,
      manager: r.m_id !== '' ? { id: r.m_id, name: r.m_name, number: r.m_number, job_title: r.m_title, photo: file(r.m_id, r.m_photo), status: r.m_status } : null,
      photo: file(r.id, r.photo),
      email: r.email,
      phone: r.phone,
      status: r.status,
      own: own,
      details: false,
      pay: false,
    };
    if (rights.details || own) {
      Object.assign(out, {
        details: true,
        employment: r.employment,
        start_date: r.start_date,
        end_date: r.end_date,
        address: r.address,
        birthday: r.birthday,
        emergency_contact: r.emergency_contact,
        notes: r.notes,
        member: r.mb_id !== '' ? { id: r.mb_id, name: r.mb_name, email: r.mb_email, status: r.mb_status } : null,
        created: r.created,
      });
    }
    if (rights.pay || own) {
      Object.assign(out, {
        pay: true,
        pay_basic: r.pay_basic,
        pay_basic_text: m.minorText(r.pay_basic, cur),
        pay_frequency: r.pay_frequency || 'monthly',
        hourly_cost: r.hourly_cost,
        hourly_cost_text: m.minorText(r.hourly_cost, cur),
        bank_details: r.bank_details,
        national_id: r.national_id,
        tax_number: r.tax_number,
        currency: cur,
      });
    }
    out.reports = r.reports;
    return out;
  });
  const byStatus = { active: 0, on_leave: 0, left: 0 };
  for (const r of util.rows(app, 'SELECT status, COUNT(id) AS n FROM employees GROUP BY status', { status: '', n: 0 })) byStatus[r.status] = r.n;
  const counts = deptCounts(app);
  const departments = app.findRecordsByFilter('departments', '', 'sort,name', 0, 0).map((d) => ({ id: d.id, name: d.getString('name'), archived: d.getBool('archived'), count: counts[d.id] || 0 }));
  departments.push({ id: '', name: 'No department', archived: false, count: counts[''] || 0 });
  return {
    employees: employees,
    total: total,
    counts: { status: byStatus, departments: departments.filter((d) => d.count > 0 || (d.id !== '' && !d.archived)) },
    can: { add: has(ctx, 'people', 'edit'), pay: editsPay(ctx) },
  };
}

function getEmployee(ctx, p) {
  const util = u();
  const app = ctx.app;
  const emp = core().resolve(app, 'employees', util.req(p, 'employee', 'EMP-0001'));
  const cache = {};
  const out = employeeOut(app, ctx, emp, cache);
  out.reports = util
    .rows(
      app,
      "SELECT e.id AS id, e.name AS name, e.number AS number, e.job_title AS job_title, e.photo AS photo, e.status AS status, IFNULL(d.id, '') AS d_id, IFNULL(d.name, '') AS d_name, IFNULL(d.code, '') AS d_code FROM employees e LEFT JOIN departments d ON d.id = e.department WHERE e.manager = {:m} AND e.status != 'left' ORDER BY e.name COLLATE NOCASE",
      { id: '', name: '', number: '', job_title: '', photo: '', status: '', d_id: '', d_name: '', d_code: '' },
      { m: emp.id },
    )
    .map((r) => ({
      id: r.id,
      name: r.name,
      number: r.number,
      job_title: r.job_title,
      photo: r.photo === '' ? '' : '/api/files/employees/' + r.id + '/' + r.photo,
      status: r.status,
      department: r.d_id !== '' ? { id: r.d_id, name: r.d_name, code: r.d_code } : null,
    }));
  const chain = [];
  const seen = {};
  let cur = emp.getString('manager');
  for (let i = 0; i < MAX_DEPTH && cur !== '' && !seen[cur]; i++) {
    seen[cur] = true;
    const m = util.byId(app, 'employees', cur);
    if (m === null) break;
    chain.push(empBrief(app, m.id, cache));
    cur = m.getString('manager');
  }
  out.chain = chain;
  const self = seesSelfService(ctx, emp.id);
  if (self) {
    out.leave = leaveLib().balancesFor(app, emp, Number(util.today().slice(0, 4)));
  }
  if (self || has(ctx, 'accounting', 'view')) {
    out.claims = claimsLib().recentFor(app, emp.id, 5);
  }
  if (out.pay) out.components = payrollLib().assignedFor(app, emp.id);
  out.can = {
    edit: has(ctx, 'people', 'edit'),
    pay: editsPay(ctx),
    delete: !ctx.isAgent && has(ctx, 'people', 'full'),
    leave: self,
  };
  return out;
}

function checkManager(app, r, managerRec) {
  const util = u();
  if (managerRec === null) return;
  if (r.id && managerRec.id === r.id) throw util.fail(409, 'An employee cannot be their own manager.', 'loop');
  if (r.id && manages(app, r.id, managerRec.id)) throw util.fail(409, managerRec.getString('name') + ' reports to ' + (r.getString('name') || 'this employee') + ', so they cannot also be their manager.', 'loop');
  if (managerRec.getString('status') === 'left') throw util.fail(409, managerRec.getString('name') + ' has left; choose a current employee as manager.', 'invalid_param', { param: 'manager' });
}

function readEmployee(ctx, app, r, p, isNew) {
  const util = u();
  const c = core();
  const cur = c.currency(app);
  if (util.has(p, 'name')) {
    const n = util.squash(util.text(p, 'name', 120, ''));
    if (n === '') throw util.fail(400, 'name cannot be empty', 'invalid_param', { param: 'name' });
    r.set('name', n);
  }
  if (isNew && r.getString('name') === '') throw util.fail(400, 'name is required, e.g. name="Sam Lee"', 'missing_param', { param: 'name' });
  if (util.has(p, 'number')) {
    const num = util.text(p, 'number', 20, '');
    if (num !== '') {
      if (util.idsNocaseFind(app, 'employees', 'number', num, r.id || '')) throw util.fail(409, 'The employee number ' + num + ' is taken.', 'duplicate');
      r.set('number', num);
    } else if (!isNew) throw util.fail(400, 'number cannot be empty', 'invalid_param', { param: 'number' });
  }
  if (util.has(p, 'email')) {
    const email = auth().normEmail(util.str(p, 'email', ''));
    if (email !== '') {
      auth().checkEmail(email);
      const other = util.one(app, 'SELECT name FROM employees WHERE LOWER(email) = {:e} AND id != {:x} LIMIT 1', { name: '' }, { e: email, x: r.id || '' });
      if (other !== null) throw util.fail(409, email + ' already belongs to ' + other.name + '.', 'duplicate');
    }
    r.set('email', email);
  }
  if (util.has(p, 'phone')) r.set('phone', util.text(p, 'phone', 40, ''));
  if (util.has(p, 'job_title')) r.set('job_title', util.text(p, 'job_title', 120, ''));
  if (util.has(p, 'department')) {
    const d = c.resolveOpt(app, 'departments', util.str(p, 'department', ''));
    r.set('department', d !== null ? d.id : '');
  }
  if (util.has(p, 'manager')) {
    const m = c.resolveOpt(app, 'employees', util.str(p, 'manager', ''));
    checkManager(app, r, m);
    r.set('manager', m !== null ? m.id : '');
  }
  if (util.has(p, 'start_date')) r.set('start_date', util.day(p, 'start_date', ''));
  else if (isNew) r.set('start_date', util.today());
  if (util.has(p, 'end_date')) r.set('end_date', util.day(p, 'end_date', ''));
  if (r.getString('end_date') !== '' && r.getString('start_date') !== '' && r.getString('end_date') < r.getString('start_date')) {
    throw util.fail(400, 'end_date cannot be before start_date (' + r.getString('start_date') + ').', 'invalid_param', { param: 'end_date' });
  }
  if (util.has(p, 'status')) r.set('status', util.oneOf(p, 'status', STATUSES, 'active'));
  else if (isNew) r.set('status', 'active');
  if (r.getString('status') === 'left' && r.getString('end_date') === '') r.set('end_date', util.today());
  if (util.has(p, 'employment')) r.set('employment', util.oneOf(p, 'employment', EMPLOYMENT, 'full_time'));
  else if (isNew) r.set('employment', 'full_time');
  if (util.has(p, 'address')) r.set('address', util.text(p, 'address', 600, ''));
  if (util.has(p, 'birthday')) r.set('birthday', util.day(p, 'birthday', ''));
  if (util.has(p, 'emergency_contact')) r.set('emergency_contact', util.text(p, 'emergency_contact', 300, ''));
  if (util.has(p, 'notes')) r.set('notes', util.text(p, 'notes', 2000, ''));
  const payGiven = PAY_FIELDS.filter((f) => util.has(p, f));
  if (payGiven.length > 0 && !editsPay(ctx)) {
    throw util.fail(403, 'Your role cannot change pay details (' + payGiven.join(', ') + '): that needs edit access to Payroll, or full access to People.', 'not_permitted', { module: 'payroll', level: 'edit' });
  }
  if (util.has(p, 'pay_basic')) r.set('pay_basic', util.money(p, 'pay_basic', cur) || 0);
  if (util.has(p, 'pay_frequency')) r.set('pay_frequency', util.oneOf(p, 'pay_frequency', FREQUENCIES, 'monthly'));
  else if (isNew) r.set('pay_frequency', 'monthly');
  if (util.has(p, 'hourly_cost')) r.set('hourly_cost', util.money(p, 'hourly_cost', cur) || 0);
  if (util.has(p, 'bank_details')) r.set('bank_details', util.text(p, 'bank_details', 300, ''));
  if (util.has(p, 'national_id')) r.set('national_id', util.text(p, 'national_id', 60, ''));
  if (util.has(p, 'tax_number')) r.set('tax_number', util.text(p, 'tax_number', 60, ''));
  if (ctx.e) {
    const photo = util.uploaded(ctx.e, 'photo');
    if (photo !== null) r.set('photo', photo);
  }
  if (util.bool(p, 'remove_photo', false)) r.set('photo', null);
  return payGiven;
}

function addEmployee(ctx, p) {
  auth().need(ctx, 'people', 'edit', 'add employees');
  const util = u();
  const app = ctx.app;
  const r = util.newRecord(app, 'employees');
  readEmployee(ctx, app, r, p, true);
  app.runInTransaction((tx) => {
    if (r.getString('number') === '') {
      let num = core().nextNumber(tx, 'employee');
      let guard = 0;
      while (util.findOne(tx, 'employees', 'number = {:n}', { n: num }) !== null && guard < 50) {
        num = core().nextNumber(tx, 'employee');
        guard++;
      }
      r.set('number', num);
    }
    tx.save(r);
    audit().write(tx, ctx, { kind: 'create', entity: 'employees', ref: r.id, label: r.getString('number'), summary: 'Added the employee ' + r.getString('name') + (r.getString('job_title') !== '' ? ' (' + r.getString('job_title') + ')' : '') });
  });
  return getEmployee(ctx, { employee: r.id });
}

function updateEmployee(ctx, p) {
  auth().need(ctx, 'people', 'edit', 'change employees');
  const util = u();
  const app = ctx.app;
  const found = core().resolve(app, 'employees', util.req(p, 'employee', 'EMP-0001'));
  const r = app.findRecordById('employees', found.id);
  const before = r.getString('status');
  const payChanged = readEmployee(ctx, app, r, p, false);
  app.runInTransaction((tx) => {
    tx.save(r);
    const parts = [];
    if (before !== r.getString('status')) parts.push('status ' + before + ' to ' + r.getString('status'));
    if (payChanged.length > 0) parts.push('pay details');
    audit().write(tx, ctx, {
      kind: 'update',
      entity: 'employees',
      ref: r.id,
      label: r.getString('number'),
      summary: 'Changed the employee ' + r.getString('name') + (parts.length > 0 ? ' (' + parts.join(', ') + ')' : ''),
      data: { fields: Object.keys(p).filter((k) => k !== 'employee') },
    });
  });
  return getEmployee(ctx, { employee: r.id });
}

function deleteEmployee(ctx, p) {
  auth().need(ctx, 'people', 'full', 'delete employees');
  const util = u();
  const app = ctx.app;
  const emp = core().resolve(app, 'employees', util.req(p, 'employee', 'EMP-0001'));
  const count = (t) => util.one(app, 'SELECT COUNT(id) AS n FROM ' + t + ' WHERE employee = {:e}', { n: 0 }, { e: emp.id }).n;
  const history = {
    leave_requests: count('leave_requests'),
    expense_claims: count('expense_claims'),
    timesheets: count('timesheets'),
    payslips: count('payslips'),
    journal_lines: count('journal_lines'),
  };
  const kinds = Object.keys(history).filter((k) => history[k] > 0);
  if (kinds.length > 0) {
    throw util.fail(409, emp.getString('name') + ' has ' + kinds.map((k) => history[k] + ' ' + k.replace(/_/g, ' ')).join(', ') + '. Set their status to left instead, so the history keeps their name.', 'has_history', history);
  }
  const reports = app.findRecordsByFilter('employees', 'manager = {:e}', '', 0, 0, { e: emp.id });
  const newManager = emp.getString('manager');
  if (util.bool(p, 'preview', false)) {
    return { preview: true, name: emp.getString('name'), number: emp.getString('number'), reports_moved: reports.length, reports_move_to: empBrief(app, newManager, {}) };
  }
  app.runInTransaction((tx) => {
    for (const rep of reports) {
      const x = tx.findRecordById('employees', rep.id);
      x.set('manager', newManager === rep.id ? '' : newManager);
      tx.save(x);
    }
    for (const d of tx.findRecordsByFilter('departments', 'manager = {:e}', '', 0, 0, { e: emp.id })) {
      const x = tx.findRecordById('departments', d.id);
      x.set('manager', '');
      tx.save(x);
    }
    for (const pr of tx.findRecordsByFilter('projects', 'manager = {:e}', '', 0, 0, { e: emp.id })) {
      const x = tx.findRecordById('projects', pr.id);
      x.set('manager', '');
      tx.save(x);
    }
    for (const m of tx.findRecordsByFilter('members', 'employee = {:e}', '', 0, 0, { e: emp.id })) {
      const x = tx.findRecordById('members', m.id);
      x.set('employee', '');
      tx.save(x);
    }
    for (const a of tx.findRecordsByFilter('leave_adjustments', 'employee = {:e}', '', 0, 0, { e: emp.id })) tx.delete(tx.findRecordById('leave_adjustments', a.id));
    for (const a of tx.findRecordsByFilter('employee_components', 'employee = {:e}', '', 0, 0, { e: emp.id })) tx.delete(tx.findRecordById('employee_components', a.id));
    tx.delete(tx.findRecordById('employees', emp.id));
    audit().write(tx, ctx, { kind: 'delete', entity: 'employees', ref: emp.id, label: emp.getString('number'), summary: 'Deleted the employee ' + emp.getString('name') });
  });
  return { deleted: true, reports_moved: reports.length };
}

/** The org chart: roots are people without a (shown) manager; children by manager. */
function org(ctx, p) {
  const util = u();
  const app = ctx.app;
  const withLeft = util.bool(p, 'include_left', false);
  // The whole organisation in one row of JSON: reading thousands of rows one
  // by one into the hooks costs far more than parsing one string.
  const packed = util.one(
    app,
    "SELECT IFNULL(json_group_array(json_array(x.id, x.number, x.name, x.job_title, x.photo, x.status, x.manager, x.department, x.department_name)), '[]') AS j FROM (" +
      "SELECT e.id AS id, e.number AS number, e.name AS name, e.job_title AS job_title, e.photo AS photo, e.status AS status, IFNULL(e.manager, '') AS manager, IFNULL(e.department, '') AS department, IFNULL(d.name, '') AS department_name FROM employees e LEFT JOIN departments d ON d.id = e.department" +
      (withLeft ? '' : " WHERE e.status != 'left'") +
      ' ORDER BY e.name COLLATE NOCASE) x',
    { j: '' },
  );
  // Plain loops over arrays: the hooks' JavaScript is slow per object and
  // per closure, and the chart holds everyone.
  const list = JSON.parse(packed !== null && packed.j !== '' ? packed.j : '[]');
  const n = list.length;
  const nodes = new Array(n);
  const managers = new Array(n);
  const at = {};
  const depts = {};
  for (let i = 0; i < n; i++) {
    const a = list[i];
    if (a[7] && depts[a[7]] === undefined) depts[a[7]] = { id: a[7], name: a[8] || '' };
    nodes[i] = {
      id: a[0],
      number: a[1],
      name: a[2],
      job_title: a[3],
      photo: a[4] ? '/api/files/employees/' + a[0] + '/' + a[4] : '',
      status: a[5],
      department: a[7] ? depts[a[7]] : null,
      reports: 0,
      children: [],
    };
    managers[i] = a[6] || '';
    at[a[0]] = i;
  }
  const roots = [];
  for (let i = 0; i < n; i++) {
    const m = managers[i];
    const pi = m !== '' && m !== nodes[i].id ? at[m] : undefined;
    if (pi === undefined) roots.push(nodes[i]);
    else nodes[pi].children.push(nodes[i]);
  }
  // Walk down from the top; anyone not reached sits in a cycle (bad data):
  // they become a top of their own and the link back is cut, so the tree ends.
  const placed = {};
  let maxDepth = 0;
  const walkFrom = (top) => {
    const stack = [top, 1];
    placed[top.id] = true;
    while (stack.length > 0) {
      const depth = stack.pop();
      const node = stack.pop();
      if (depth > maxDepth) maxDepth = depth;
      let kids = node.children;
      for (let k = 0; k < kids.length; k++) {
        if (placed[kids[k].id] === true) {
          kids = kids.filter((ch) => placed[ch.id] !== true);
          node.children = kids;
          break;
        }
      }
      node.reports = kids.length;
      for (let k = 0; k < kids.length; k++) {
        placed[kids[k].id] = true;
        stack.push(kids[k], depth + 1);
      }
    }
  };
  for (let i = 0; i < roots.length; i++) walkFrom(roots[i]);
  for (let i = 0; i < n; i++) {
    if (placed[nodes[i].id] !== true) {
      roots.push(nodes[i]);
      walkFrom(nodes[i]);
    }
  }
  return { roots: roots, count: n, depth: maxDepth };
}

module.exports = {
  MAX_DEPTH: MAX_DEPTH,
  STATUSES: STATUSES,
  EMPLOYMENT: EMPLOYMENT,
  FREQUENCIES: FREQUENCIES,
  manages: manages,
  teamSql: teamSql,
  reportIds: reportIds,
  teamOf: teamOf,
  teamJson: teamJson,
  inTeamSql: inTeamSql,
  needOn: needOn,
  has: has,
  rightsOf: rightsOf,
  currencyOf: currencyOf,
  isOwn: isOwn,
  canViewPeople: canViewPeople,
  seesDetails: seesDetails,
  seesPay: seesPay,
  editsPay: editsPay,
  seesSelfService: seesSelfService,
  ownEmployee: ownEmployee,
  targetEmployee: targetEmployee,
  photoUrl: photoUrl,
  empBrief: empBrief,
  deptBrief: deptBrief,
  employeeOut: employeeOut,
  listDepartments: listDepartments,
  addDepartment: addDepartment,
  updateDepartment: updateDepartment,
  deleteDepartment: deleteDepartment,
  listEmployees: listEmployees,
  getEmployee: getEmployee,
  addEmployee: addEmployee,
  updateEmployee: updateEmployee,
  deleteEmployee: deleteEmployee,
  org: org,
};
