/// <reference path="../pb_data/types.d.ts" />
/**
 * Lifecycle: shared helpers, the event subscribers (events_lifecycle.js),
 * the lifecycle home, the profile tab, the new hire's welcome page and the
 * daily job.
 *
 * Who is who here:
 *   HR        people:edit (or more) within the caller's entities
 *   IT        members whose role code is `it`; while nobody has that role,
 *             HR takes IT tasks
 *   manager   the person's manager on the day (job record), resolved to
 *             their member account when the checklist starts and again
 *             when the job record changes
 *   employee  the person the checklist is about (their own member account)
 *
 * Other modules use (SPEC 3.4): events `separation.approved { separation,
 * employment, last_day, kind }`, `separation.changed { separation,
 * employment, last_day, kind }`, `checklist.completed { checklist,
 * employment, kind }`; approval kind `separation`; profile facts.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}

/** Onboarding starts automatically for hires whose first day is at most this many days ago. */
const LATE_START_DAYS = 30;

/* ------------------------------------------------------------- helpers */

/** May the caller act as HR (people:<level>) for an entity ('' = any entity)? Your AI agent reads; the app itself may do anything. */
function hrCan(ctx, entityId, level) {
  const auth = L('lib_auth');
  if (ctx.actor === 'system') return true;
  if (ctx.isAgent) return true;
  if (!auth.can(ctx, 'people', level || 'edit')) return false;
  return !entityId || auth.inScope(ctx, entityId);
}

function needHr(ctx, entityId, level, what) {
  if (hrCan(ctx, entityId, level)) return;
  throw u().fail(403, 'Your role cannot ' + (what || 'do this') + ' (needs ' + (level || 'edit') + ' access to People).', 'not_permitted', { module: 'people', level: level || 'edit' });
}

/** SQL fragment limiting `alias.entity` to the caller's entities (empty scope = all). */
function scopeSql(ctx, alias, bind) {
  const sc = L('lib_auth').scope(ctx);
  if (sc.length === 0) return '1 = 1';
  return alias + '.entity IN (' + sc.map((id, i) => ((bind['sc' + i] = id), '{:sc' + i + '}')).join(',') + ')';
}

function roleCodeOf(app, member) {
  const r = u().byId(app, 'roles', member.getString('role'));
  return r === null ? '' : r.getString('code');
}

function memberInEntity(member, entityId, owner) {
  if (owner || !entityId) return true;
  const ents = u().jsonOf(member, 'entities', []) || [];
  return ents.length === 0 || ents.indexOf(entityId) >= 0;
}

/** Active members who act as HR (people:edit or more) for an entity. */
function hrMembers(app, entityId) {
  const auth = L('lib_auth');
  const out = [];
  for (const m of u().findMany(app, 'members', "status = 'active'", 'created')) {
    const role = u().byId(app, 'roles', m.getString('role'));
    if (role === null) continue;
    const owner = role.getString('code') === 'owner';
    if (!owner && auth.rank(auth.levelsOfRole(role).people) < auth.rank('edit')) continue;
    if (memberInEntity(m, entityId, owner)) out.push(m.id);
  }
  return out;
}

/** Active members with the `it` role for an entity. */
function itMembers(app, entityId) {
  const out = [];
  for (const m of u().findMany(app, 'members', "status = 'active'", 'created')) {
    if (roleCodeOf(app, m) !== 'it') continue;
    if (memberInEntity(m, entityId, false)) out.push(m.id);
  }
  return out;
}

/** Is the caller an IT member (role code `it`)? */
function isIt(ctx) {
  return !ctx.isAgent && ctx.roleCode === 'it';
}

/** True when no active member has the `it` role (HR then takes IT tasks). */
function noItTeam(app) {
  const role = L('lib_auth').roleByCode(app, 'it');
  if (role === null) return true;
  return u().count(app, "SELECT COUNT(*) AS n FROM members WHERE role = {:r} AND status = 'active'", { r: role.id }) === 0;
}

/** The active member account of an employee ('' when none). */
function memberOfEmployee(app, employeeId) {
  if (!employeeId) return '';
  const e = u().byId(app, 'employees', employeeId);
  if (e === null || e.getString('member') === '') return '';
  const m = u().byId(app, 'members', e.getString('member'));
  return m !== null && m.getString('status') === 'active' ? m.id : '';
}

function employeeName(app, employeeId) {
  const e = u().byId(app, 'employees', employeeId || '');
  return e === null ? '' : L('lib_people').displayName(e);
}

function memberName(app, memberId) {
  const m = u().byId(app, 'members', memberId || '');
  return m === null ? '' : m.getString('name');
}

function entityName(app, entityId) {
  const e = u().byId(app, 'entities', entityId || '');
  return e === null ? '' : e.getString('name');
}

/** A day written in the entity's country format (YYYY/MM/DD for Japan, DD/MM/YYYY for India...). */
/** The entity's date style ('DD/MM/YYYY', 'YYYY/MM/DD', ...; YYYY-MM-DD when its country has none). */
function dateFormatOf(app, entityId) {
  const ent = u().byId(app, 'entities', entityId || '');
  let fmt = 'YYYY-MM-DD';
  if (ent !== null) {
    const c = L('lib_countries');
    if (c.has(ent.getString('country'))) fmt = c.get(ent.getString('country')).date_format || fmt;
  }
  return fmt;
}

/** A day in a date style. */
function dayAs(fmt, day) {
  if (!u().isDay(day)) return '';
  return fmt.replace('YYYY', day.slice(0, 4)).replace('MM', day.slice(5, 7)).replace('DD', day.slice(8, 10));
}

function dayIn(app, entityId, day) {
  if (!u().isDay(day)) return '';
  return dayAs(dateFormatOf(app, entityId), day);
}

/** The later of two days. */
function later(a, b) {
  return a > b ? a : b;
}

/** Audit row written from inside an event subscriber, without marking the caller's op as audited. */
function auditFrom(ctx, entry) {
  L('lib_audit').write(Object.assign({}, ctx), entry);
}

/** The employment record behind an employment or employee reference. */
function employmentOf(app, ref) {
  return L('lib_people').employmentRef(app, ref);
}

/** Run fn(tx) inside a transaction, or directly when the handle already is one. */
function inTx(app, fn) {
  if (app.isTransactional()) return fn(app);
  let out;
  app.runInTransaction((tx) => {
    out = fn(tx);
  });
  return out;
}

/* -------------------------------------------------------------- seeding */

/** Add the country defaults an entity lacks: checklist templates, letter templates, the exit form and grievance types. */
function seedEntity(ctx, entityId) {
  const util = u();
  const app = ctx.app;
  const d = L('lib_lifecycle_defaults');
  const ent = app.findRecordById('entities', entityId);
  const country = ent.getString('country');
  const added = { templates: 0, letters: 0, exit_forms: 0, grievance_types: 0 };
  inTx(app, (tx) => {
    for (const kind of ['onboarding', 'offboarding']) {
      const has = util.count(tx, "SELECT COUNT(*) AS n FROM checklist_templates WHERE entity = {:e} AND kind = {:k} AND builtin = TRUE", { e: ent.id, k: kind });
      if (has > 0) continue;
      const anyDefault = util.count(tx, 'SELECT COUNT(*) AS n FROM checklist_templates WHERE entity = {:e} AND kind = {:k} AND is_default = TRUE AND archived = FALSE', { e: ent.id, k: kind });
      const r = util.newRecord(tx, 'checklist_templates');
      r.set('kind', kind);
      r.set('name', (kind === 'onboarding' ? 'Onboarding' : 'Offboarding') + ' (' + ent.getString('name') + ')');
      r.set('entity', ent.id);
      r.set('country', country);
      r.set('description', (kind === 'onboarding' ? 'First-day essentials, equipment, accounts and the documents ' : 'Handover, equipment, accounts, final pay and the filings ') + (d.COUNTRY_NAMES[country] ? 'for ' + d.COUNTRY_NAMES[country] : 'every country needs') + '.');
      r.set('tasks', L('lib_lifecycle_checklists').withKeys(d.templateTasks(kind, country)));
      r.set('is_default', anyDefault === 0);
      r.set('builtin', true);
      r.set('archived', false);
      tx.save(r);
      added.templates++;
      if (kind === 'onboarding' && anyDefault === 0) {
        const e2 = tx.findRecordById('entities', ent.id);
        e2.set('default_onboarding_template', r.id);
        tx.save(e2);
      }
    }
    for (const lt of d.LETTERS) {
      if (lt.country !== '' && lt.country !== country) continue;
      const has = util.count(tx, 'SELECT COUNT(*) AS n FROM letter_templates WHERE builtin = TRUE AND kind = {:k} AND name = {:n} AND country = {:c}', { k: lt.kind, n: lt.name, c: lt.country });
      if (has > 0) continue;
      const r = util.newRecord(tx, 'letter_templates');
      r.set('kind', lt.kind);
      r.set('name', lt.name);
      r.set('country', lt.country);
      r.set('language', lt.language);
      r.set('body', lt.body);
      r.set('needs_ack', lt.needs_ack === true);
      r.set('builtin', true);
      r.set('archived', false);
      tx.save(r);
      added.letters++;
    }
    if (util.count(tx, 'SELECT COUNT(*) AS n FROM exit_forms') === 0) {
      const r = util.newRecord(tx, 'exit_forms');
      r.set('name', 'Exit interview');
      r.set('questions', d.EXIT_QUESTIONS);
      r.set('is_default', true);
      r.set('builtin', true);
      r.set('archived', false);
      tx.save(r);
      added.exit_forms++;
    }
    if (util.count(tx, 'SELECT COUNT(*) AS n FROM grievance_types') === 0) {
      d.GRIEVANCE_TYPES.forEach((g, i) => {
        const r = util.newRecord(tx, 'grievance_types');
        r.set('code', g.code);
        r.set('name', g.name);
        r.set('description', g.description);
        r.set('confidential', g.confidential === true);
        r.set('archived', false);
        r.set('sort', (i + 1) * 10);
        tx.save(r);
        added.grievance_types++;
      });
    }
  });
  return added;
}

/* --------------------------------------------------------------- events */

/** entity.created: the country's onboarding and offboarding templates, letter templates and the shared lists. */
function onEntityCreated(ctx, payload) {
  const added = seedEntity(ctx, payload.entity);
  if (added.templates + added.letters > 0) auditFrom(ctx, { op: 'lifecycle.seed', collection: 'entities', record: payload.entity, summary: 'Added the ' + payload.country + ' onboarding and offboarding checklists and ' + added.letters + ' letter templates' });
  return added;
}

/** employment.hired: start onboarding from the entity's default template (first day today, ahead, or at most 30 days ago). */
function onHire(ctx, payload) {
  const util = u();
  const app = ctx.app;
  const m = util.byId(app, 'employments', payload.employment);
  if (m === null) return { started: false, reason: 'no employment' };
  const today = util.today(app, m.getString('entity'));
  if (m.getString('start_day') < util.dayAdd(today, -LATE_START_DAYS)) return { started: false, reason: 'started more than ' + LATE_START_DAYS + ' days ago' };
  const cl = L('lib_lifecycle_checklists');
  if (cl.openChecklist(app, m.id, 'onboarding') !== null) return { started: false, reason: 'already has onboarding' };
  const tpl = cl.defaultTemplate(app, m.getString('entity'), 'onboarding');
  if (tpl === null) return { started: false, reason: 'no onboarding template for this entity' };
  const out = cl.startChecklist(ctx, { employment: m, kind: 'onboarding', template: tpl, anchor_day: m.getString('start_day'), today: today, deferAgent: true });
  auditFrom(ctx, { op: 'lifecycle.onboarding', collection: 'checklists', record: out.id, summary: 'Started onboarding for ' + employeeName(app, m.getString('employee')) + ' (' + out.tasks + ' tasks)' });
  return { started: true, checklist: out.id, tasks: out.tasks };
}

/** employment.ended without a separation: start offboarding from the default template (separations start their own). */
function onEnded(ctx, payload) {
  const util = u();
  const app = ctx.app;
  const m = util.byId(app, 'employments', payload.employment);
  if (m === null) return { started: false };
  const cl = L('lib_lifecycle_checklists');
  if (cl.openChecklist(app, m.id, 'offboarding') !== null) return { started: false, reason: 'already has offboarding' };
  const today = util.today(app, m.getString('entity'));
  if (payload.end_day < util.dayAdd(today, -LATE_START_DAYS)) return { started: false, reason: 'ended more than ' + LATE_START_DAYS + ' days ago' };
  const tpl = cl.defaultTemplate(app, m.getString('entity'), 'offboarding');
  if (tpl === null) return { started: false, reason: 'no offboarding template for this entity' };
  const out = cl.startChecklist(ctx, { employment: m, kind: 'offboarding', template: tpl, anchor_day: payload.end_day, today: today, deferAgent: true });
  auditFrom(ctx, { op: 'lifecycle.offboarding', collection: 'checklists', record: out.id, summary: 'Started offboarding for ' + employeeName(app, m.getString('employee')) + ' (last day ' + payload.end_day + ')' });
  return { started: true, checklist: out.id };
}

/** employment.changed (job): open manager tasks follow the new manager. */
function onChanged(ctx, payload) {
  if (!payload || payload.kind !== 'job') return null;
  return { reassigned: L('lib_lifecycle_checklists').refreshManagerTasks(ctx.app, payload.employment) };
}

/**
 * Facts for the profile and Home, as the kernel shows them: [{ label, value,
 * tone, link }]: each open checklist with its progress, the assets the
 * person holds, a separation in progress.
 */
function profileFacts(ctx, employmentId) {
  const util = u();
  const app = ctx.app;
  const m = util.byId(app, 'employments', employmentId);
  if (m === null) return [];
  const today = util.today(app, m.getString('entity'));
  const lists = util.rows(
    app,
    "SELECT c.id AS id, c.kind AS kind, c.name AS name, c.anchor_day AS anchor_day, (SELECT COUNT(*) FROM tasks t WHERE t.checklist = c.id) AS total, (SELECT COUNT(*) FROM tasks t WHERE t.checklist = c.id AND t.status != 'open') AS done, (SELECT COUNT(*) FROM tasks t WHERE t.checklist = c.id AND t.status = 'open' AND t.due != '' AND t.due < {:d}) AS late FROM checklists c WHERE c.employment = {:m} AND c.status = 'open' ORDER BY c.anchor_day",
    { id: '', kind: '', name: '', anchor_day: '', total: 0, done: 0, late: 0 },
    { m: m.id, d: today },
  );
  // Typed facts (lib/contract.ts ProfileFact): counts as numbers, days as YYYY-MM-DD; the kernel formats them.
  const KIND = { onboarding: 'Onboarding', offboarding: 'Offboarding', custom: 'Checklist' };
  const out = [];
  for (const r of lists) {
    const name = KIND[r.kind] || r.kind;
    const link = '#/lifecycle/checklists/' + r.id;
    out.push({ key: 'lifecycle.' + r.kind + '.open', label: name + ': tasks open', value: r.total - r.done, kind: 'count', tone: r.done === r.total ? 'good' : 'neutral', link: link });
    if (r.late > 0) out.push({ key: 'lifecycle.' + r.kind + '.late', label: name + ': tasks late', value: r.late, kind: 'count', tone: 'bad', link: link });
  }
  const assets = util.count(app, "SELECT COUNT(*) AS n FROM assets WHERE employee = {:e} AND status = 'issued'", { e: m.getString('employee') });
  if (assets > 0) out.push({ key: 'lifecycle.assets', label: 'Assets held', value: assets, kind: 'count', tone: 'neutral', link: '#/lifecycle/assets' });
  const sep = util.findOne(app, 'separations', "employment = {:m} && (status = 'pending' || status = 'approved')", { m: m.id });
  if (sep !== null) {
    const kind = L('lib_lifecycle_separations').KIND_LABEL[sep.getString('kind')] || sep.getString('kind');
    out.push({ key: 'lifecycle.last_day', label: kind + ': last day' + (sep.getString('status') === 'pending' ? ' (waiting for approval)' : ''), value: sep.getString('last_day'), kind: 'date', tone: 'warn', link: '#/lifecycle/separations/' + sep.id });
  }
  return out;
}

/* ----------------------------------------------------------------- home */

/** People starting or leaving between two days who the caller may see: [{ employment, ... }]. */
function movers(ctx, kind, from, to) {
  const util = u();
  const app = ctx.app;
  const auth = L('lib_auth');
  const bind = { f: from, t: to };
  const where = [kind === 'starting' ? 'm.start_day >= {:f} AND m.start_day <= {:t}' : "m.end_day != '' AND m.end_day >= {:f} AND m.end_day <= {:t}"];
  if (hrCan(ctx, '', 'view')) where.push(scopeSql(ctx, 'm', bind));
  else if (ctx.teamScope && ctx.employeeId !== '') {
    // A manager: people whose job record on the day (first day or last day) names them.
    where.push("COALESCE((SELECT j.manager FROM job_records j WHERE j.employment = m.id AND j.effective_from <= " + (kind === 'starting' ? 'm.start_day' : 'm.end_day') + ' ORDER BY j.effective_from DESC LIMIT 1), \'\') = {:me}');
    bind.me = ctx.employeeId;
  } else return [];
  const rows = util.rows(
    app,
    'SELECT m.id AS id, m.employee AS employee, m.entity AS entity, m.start_day AS start_day, m.end_day AS end_day FROM employments m WHERE ' + where.join(' AND ') + ' ORDER BY ' + (kind === 'starting' ? 'm.start_day' : 'm.end_day') + ' LIMIT 200',
    { id: '', employee: '', entity: '', start_day: '', end_day: '' },
    bind,
  );
  const cl = L('lib_lifecycle_checklists');
  return rows.map((r) => {
    const e = app.findRecordById('employees', r.employee);
    const job = L('lib_people').rowOn(app, 'job_records', r.id, kind === 'starting' ? r.start_day : r.end_day);
    const list = cl.openChecklist(app, r.id, kind === 'starting' ? 'onboarding' : 'offboarding') || cl.latestChecklist(app, r.id, kind === 'starting' ? 'onboarding' : 'offboarding');
    const sep = kind === 'leaving' ? util.findOne(app, 'separations', "employment = {:m} && status != 'withdrawn' && status != 'rejected'", { m: r.id }) : null;
    return {
      employment: r.id,
      employee: r.employee,
      number: e.getString('number'),
      name: L('lib_people').displayName(e),
      title: job !== null ? job.getString('title') : '',
      entity: r.entity,
      entity_name: entityName(app, r.entity),
      day: kind === 'starting' ? r.start_day : r.end_day,
      checklist: list === null ? null : cl.progressOf(app, list),
      separation: sep === null ? null : { id: sep.id, kind: sep.getString('kind'), status: sep.getString('status') },
      has_member: e.getString('member') !== '',
      photo: e.getString('photo') !== '',
    };
  });
}

/** lifecycle.home: who starts and leaves in the next 30 days, overdue tasks, letters to issue, open grievances (HR). */
function home(ctx, p) {
  const util = u();
  const app = ctx.app;
  const days = util.int(p, 'days', 30, 1, 120);
  const today = util.today(app);
  const until = util.dayAdd(today, days);
  const hr = hrCan(ctx, '', 'view') && !ctx.isAgent ? true : ctx.isAgent;
  const cl = L('lib_lifecycle_checklists');
  const mine = cl.listTasks(ctx, { view: 'mine', status: 'open', limit: 12 });
  const overdue = cl.listTasks(ctx, { view: hr ? 'all' : 'mine', status: 'open', overdue: true, limit: 12 });
  const out = {
    today: today,
    days: days,
    hr: hr,
    starting: movers(ctx, 'starting', today, until),
    leaving: movers(ctx, 'leaving', today, until),
    my_tasks: mine.tasks,
    my_tasks_total: mine.total,
    overdue: overdue.tasks,
    overdue_total: overdue.total,
  };
  if (hr) {
    const bind = {};
    const sc = scopeSql(ctx, 'l', bind);
    out.letters_to_issue = util.count(app, "SELECT COUNT(*) AS n FROM letters l WHERE l.status = 'draft' AND " + sc, bind);
    out.letters = L('lib_lifecycle_letters').listLetters(ctx, { status: 'draft', limit: 6 }).letters;
    const b2 = {};
    out.separations_pending = util.count(app, "SELECT COUNT(*) AS n FROM separations s WHERE s.status = 'pending' AND " + scopeSql(ctx, 's', b2), b2);
    out.templates_missing = util
      .rows(app, "SELECT e.id AS id, e.name AS name, e.country AS country FROM entities e WHERE e.active = TRUE AND NOT EXISTS (SELECT 1 FROM checklist_templates t WHERE t.entity = e.id AND t.kind = 'onboarding' AND t.is_default = TRUE AND t.archived = FALSE)", { id: '', name: '', country: '' })
      .filter((r) => L('lib_auth').inScope(ctx, r.id));
  }
  if (!ctx.isAgent && L('lib_auth').can(ctx, 'people', 'full')) {
    const b3 = {};
    out.grievances_open = util.count(app, "SELECT COUNT(*) AS n FROM grievances g WHERE g.status IN ('open', 'investigating') AND " + scopeSql(ctx, 'g', b3), b3);
  }
  if (ctx.isAgent) out.grievances_open = util.count(app, "SELECT COUNT(*) AS n FROM grievances WHERE status IN ('open', 'investigating')");
  return out;
}

/* -------------------------------------------------------------- profile */

/** lifecycle.profile: the Lifecycle tab of a person: checklists, assets, letters, separation, handbook to read. */
function profile(ctx, p) {
  const util = u();
  const app = ctx.app;
  const people = L('lib_people');
  const emp = people.employeeRef(app, util.req(p, 'employee'));
  const access = people.access(ctx, emp);
  if (access === 'none') throw util.fail(403, 'You cannot see this person.', 'not_permitted');
  const own = L('lib_auth').selfEmployee(ctx) === emp.id;
  const hr = access === 'full' || access === 'edit' || access === 'view' || ctx.isAgent;
  const cl = L('lib_lifecycle_checklists');
  const lists = util.findMany(app, 'checklists', 'employee = {:e}', '-anchor_day', 50, { e: emp.id }).map((c) => {
    const v = cl.checklistView(app, c);
    v.progress = cl.progressOf(app, c).progress;
    return v;
  });
  const tasks = cl.listTasks(ctx, { view: hr ? 'all' : 'mine', employee: emp.id, status: 'open', limit: 100 });
  const assets = util.findMany(app, 'assets', 'employee = {:e}', '-issued_day', 100, { e: emp.id }).map((a) => L('lib_lifecycle_assets').assetView(app, a, hr));
  const letters = util
    .findMany(app, 'letters', hr ? "employee = {:e} && status != 'void'" : "employee = {:e} && status = 'issued'", '-created', 100, { e: emp.id })
    .map((r) => L('lib_lifecycle_letters').letterView(app, r, false));
  const seps = util.findMany(app, 'separations', "employee = {:e} && status != 'withdrawn'", '-created', 10, { e: emp.id }).map((s) => L('lib_lifecycle_separations').separationView(ctx, s, false));
  const out = { employee: emp.id, number: emp.getString('number'), name: people.displayName(emp), access: access, own: own, checklists: lists, tasks: tasks.tasks, assets: assets, letters: letters, separations: seps };
  if (own || hr) out.handbook = L('lib_lifecycle_handbook').pendingFor(app, emp.id);
  return out;
}

/* -------------------------------------------------------------- welcome */

/** lifecycle.welcome: the signed-in person's onboarding: first-day details, their tasks, documents and letters to acknowledge, handbook pages to read. */
const WELCOME_DAYS = 42;

function welcome(ctx) {
  const util = u();
  const app = ctx.app;
  const people = L('lib_people');
  const empId = L('lib_auth').selfEmployee(ctx);
  if (empId === '') return { linked: false };
  const emp = app.findRecordById('employees', empId);
  const today = util.today(app);
  const employmentId = people.primaryEmployment(app, emp.id, today);
  const m = employmentId !== '' ? app.findRecordById('employments', employmentId) : null;
  const cl = L('lib_lifecycle_checklists');
  const list = m !== null ? cl.openChecklist(app, m.id, 'onboarding') || cl.latestChecklist(app, m.id, 'onboarding') : null;
  let firstDay = null;
  let manager = null;
  let job = null;
  if (m !== null) {
    const at = later(today, m.getString('start_day'));
    const jr = people.rowOn(app, 'job_records', m.id, at);
    const nameIn = (collection, id) => {
      const r = util.byId(app, collection, id);
      return r === null ? '' : r.getString('name');
    };
    job = jr !== null ? { title: jr.getString('title'), department: nameIn('departments', jr.getString('department')), location: nameIn('locations', jr.getString('location')) } : null;
    const mg = people.managerOf(app, m.id, at);
    manager = mg === null ? null : { name: mg.name, number: mg.number };
    const fd = list !== null ? util.jsonOf(list, 'first_day', {}) || {} : {};
    const sched = L('lib_calendar').scheduleOf(app, m.id, at);
    let start = '';
    if (sched && Array.isArray(sched.week)) {
      const dow = util.weekday(m.getString('start_day'));
      const row = sched.week.filter((x) => Number(x.dow) === dow)[0];
      if (row) start = row.start || '';
    }
    let address = null;
    if (jr !== null && jr.getString('location') !== '') {
      const loc = util.byId(app, 'locations', jr.getString('location'));
      if (loc !== null) address = util.jsonOf(loc, 'address', null);
    }
    firstDay = {
      day: m.getString('start_day'),
      day_shown: dayIn(app, m.getString('entity'), m.getString('start_day')),
      days_to_go: util.daysBetween(today, m.getString('start_day')),
      time: fd.time || start,
      place: fd.place || '',
      address: address,
      contact: fd.contact_name || (manager ? manager.name : ''),
      bring: fd.bring || '',
      note: fd.note || '',
    };
  }
  const tasks = cl.listTasks(ctx, { view: 'mine', employee: emp.id, status: 'all', limit: 100 }).tasks.filter((x) => x.assignee_kind === 'employee');
  const docs = util
    .findMany(app, 'documents', "employee = {:e} && needs_ack = true && visible_to_employee = true", '-created', 50, { e: emp.id })
    .map((r) => ({ id: r.id, title: r.getString('title'), category: r.getString('category'), acked_at: r.getString('acked_at'), source: r.getString('source'), has_file: r.getString('file') !== '', letter: (util.findOne(app, 'letters', 'document = {:d}', { d: r.id }) || { id: '' }).id }));
  return {
    linked: true,
    employee: { id: emp.id, number: emp.getString('number'), name: people.displayName(emp), status: emp.getString('status') },
    pre_hire: emp.getString('status') === 'pre_hire',
    entity: m !== null ? { id: m.getString('entity'), name: entityName(app, m.getString('entity')) } : null,
    job: job,
    manager: manager,
    first_day: firstDay,
    // The page is for joiners: before the first day, the first six weeks, or while onboarding is open.
    joining: firstDay !== null && (firstDay.days_to_go > -WELCOME_DAYS || (list !== null && list.getString('status') === 'open')),
    checklist: list === null ? null : cl.progressOf(app, list),
    tasks: tasks,
    documents: docs,
    handbook: L('lib_lifecycle_handbook').pendingFor(app, emp.id),
    today: today,
  };
}

/* ------------------------------------------------------------------ cron */

/**
 * The daily job (runs hourly; each entity's work runs once its local time
 * passes 09:00): reminders for tasks due today or overdue (one digest per
 * member), your AI agent asked again for its open tasks, and approved
 * separations completed once the last day passed and offboarding is done.
 */
function cronDaily(app) {
  return runDaily(app, '');
}

/** The daily work for every entity: as of `day` when given (tests), else once its local time passed 09:00. */
function runDaily(app, day) {
  const util = u();
  const cl = L('lib_lifecycle_checklists');
  const ents = util.rows(app, 'SELECT id FROM entities WHERE active = TRUE', { id: '' });
  let reminded = 0;
  let completed = 0;
  for (const e of ents) {
    const now = util.localNow(app, e.id);
    if (!day && now.hour < 9) continue;
    const d = day || now.day;
    reminded += cl.remind(app, e.id, d);
    completed += L('lib_lifecycle_separations').completeDue(app, e.id, d);
  }
  return { reminded: reminded, completed: completed };
}

module.exports = {
  LATE_START_DAYS: LATE_START_DAYS,
  L: L,
  hrCan: hrCan,
  needHr: needHr,
  scopeSql: scopeSql,
  hrMembers: hrMembers,
  itMembers: itMembers,
  isIt: isIt,
  noItTeam: noItTeam,
  memberOfEmployee: memberOfEmployee,
  employeeName: employeeName,
  memberName: memberName,
  entityName: entityName,
  dayIn: dayIn,
  dateFormatOf: dateFormatOf,
  dayAs: dayAs,
  later: later,
  auditFrom: auditFrom,
  employmentOf: employmentOf,
  inTx: inTx,
  seedEntity: seedEntity,
  onEntityCreated: onEntityCreated,
  onHire: onHire,
  onEnded: onEnded,
  onChanged: onChanged,
  profileFacts: profileFacts,
  movers: movers,
  home: home,
  profile: profile,
  welcome: welcome,
  cronDaily: cronDaily,
  runDaily: runDaily,
};
