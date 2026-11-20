/// <reference path="../pb_data/types.d.ts" />
/**
 * Performance (core): who may see and change whose performance data, the
 * module settings (company values, HR sign-off per entity), Performance
 * Home, the profile tab, the facts on profiles and Home, the review
 * sign-off subscriber, the daily reminders and the employment events.
 *
 * Who is who for one employee (relation()):
 *   hr      performance level within the caller's entities (view, edit, full)
 *   self    the caller is the employee
 *   depth   1 when the caller is the direct manager, 2+ for a manager above
 *           (team-scope roles only, as the kernel's isManagerOf)
 * Your AI agent reads everything (it holds 'full' on reads); the catalog's
 * agent rules decide what it may change, and handlers never let it rate,
 * rank, decide or speak for a person.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}

const RANK = { none: 0, view: 1, edit: 2, full: 3 };
const VALUE_ICONS = ['Heart', 'Star', 'Rocket', 'Users', 'Lightbulb', 'ShieldCheck', 'Target', 'Handshake', 'Zap', 'Leaf', 'Compass', 'Award', 'Smile', 'Flag', 'Gem', 'Mountain', 'Sun', 'Flame', 'BookOpen', 'Scale'];

/* ------------------------------------------------------------- access */

function atLeast(level, want) {
  return (RANK[level] || 0) >= (RANK[want] || 0);
}

/** Employee id -> depth (1 = direct report) for a team-scope caller; cached on ctx. */
function teamOf(ctx) {
  if (ctx._perfTeam !== undefined) return ctx._perfTeam;
  const out = {};
  if (!ctx.isAgent && ctx.teamScope && ctx.employeeId) {
    for (const r of L('lib_people').reportsOf(ctx.app, ctx.employeeId, u().today(ctx.app), true)) {
      if (out[r.employee] === undefined || r.depth < out[r.employee]) out[r.employee] = r.depth;
    }
  }
  ctx._perfTeam = out;
  return out;
}

function entitiesOf(app, employeeId) {
  return u()
    .rows(app, 'SELECT DISTINCT entity FROM employments WHERE employee = {:e}', { entity: '' }, { e: employeeId })
    .map((r) => r.entity);
}

/** The caller's performance level for one employee (entity scope applied). */
function hrLevel(ctx, employeeId) {
  if (ctx.actor === 'system') return 'full';
  const auth = L('lib_auth');
  const lvl = auth.level(ctx, 'performance');
  if (lvl === 'none' || ctx.isAgent) return lvl;
  const sc = auth.scope(ctx);
  if (sc.length === 0 || !employeeId) return lvl;
  const ents = entitiesOf(ctx.app, employeeId);
  return ents.length === 0 || ents.some((e) => sc.indexOf(e) >= 0) ? lvl : 'none';
}

/** How the caller stands to one employee: { hr, self, depth, manager, team, any }. */
function relation(ctx, employeeId) {
  const hr = hrLevel(ctx, employeeId);
  const self = !ctx.isAgent && !!ctx.employeeId && ctx.employeeId === employeeId;
  const depth = (employeeId && teamOf(ctx)[employeeId]) || 0;
  return { hr: hr, self: self, depth: depth, manager: depth === 1, team: depth > 0, any: hr !== 'none' || self || depth > 0 };
}

/** May the caller manage this employee's goals, trainings and reviews as a manager or HR editor? */
function canManage(ctx, employeeId) {
  const r = relation(ctx, employeeId);
  return atLeast(r.hr, 'edit') || r.team;
}

function needSee(ctx, employeeId) {
  const r = relation(ctx, employeeId);
  if (!r.any) throw u().fail(403, 'You cannot see the performance records of this person.', 'not_permitted');
  return r;
}

/** Employee ids the caller may see (null = everyone). */
function visibleIds(ctx) {
  if (ctx.isAgent || ctx.actor === 'system') return null;
  const auth = L('lib_auth');
  const ids = {};
  if (auth.can(ctx, 'performance', 'view')) {
    const sc = auth.scope(ctx);
    if (sc.length === 0) return null;
    const bind = {};
    const keys = sc.map((x, i) => ((bind['s' + i] = x), '{:s' + i + '}'));
    for (const r of u().rows(ctx.app, 'SELECT DISTINCT employee FROM employments WHERE entity IN (' + keys.join(',') + ')', { employee: '' }, bind)) ids[r.employee] = true;
  }
  if (ctx.employeeId) ids[ctx.employeeId] = true;
  for (const k of Object.keys(teamOf(ctx))) ids[k] = true;
  return Object.keys(ids);
}

/** SQL "col IN (...)" for a list of ids (adds binds); "1 = 0" for none, "1 = 1" for null (everyone). */
function inList(column, ids, bind, prefix) {
  if (ids === null) return '1 = 1';
  if (ids.length === 0) return '1 = 0';
  const keys = ids.map((x, i) => {
    bind[prefix + i] = x;
    return '{:' + prefix + i + '}';
  });
  return column + ' IN (' + keys.join(',') + ')';
}

/* ------------------------------------------------------------- people */

/** One employee as the performance pages show them (cached on ctx): id, number, name, member, employment, entity, title, department. */
function person(ctx, employeeId) {
  if (!employeeId) return null;
  if (ctx._perfPeople === undefined) ctx._perfPeople = {};
  if (ctx._perfPeople[employeeId] !== undefined) return ctx._perfPeople[employeeId];
  const util = u();
  const app = ctx.app;
  const people = L('lib_people');
  const e = util.byId(app, 'employees', employeeId);
  if (e === null) {
    ctx._perfPeople[employeeId] = null;
    return null;
  }
  const today = util.today(app);
  const emp = people.primaryEmployment(app, e.id, today);
  const m = emp !== '' ? util.byId(app, 'employments', emp) : null;
  const job = m !== null ? people.rowOn(app, 'job_records', m.id, today < m.getString('start_day') ? m.getString('start_day') : today) : null;
  let deptName = '';
  if (job !== null && job.getString('department') !== '') {
    const d = util.byId(app, 'departments', job.getString('department'));
    deptName = d !== null ? d.getString('name') : '';
  }
  const out = {
    id: e.id,
    number: e.getString('number'),
    name: people.displayName(e),
    family_name: e.getString('family_name'),
    given_name: e.getString('given_name'),
    name_order: e.getString('name_order') || 'given_first',
    member: e.getString('member'),
    photo: e.getString('photo') !== '',
    employment: m !== null ? m.id : '',
    entity: m !== null ? m.getString('entity') : '',
    start_day: m !== null ? m.getString('start_day') : '',
    title: job !== null ? job.getString('title') : '',
    job_title: job !== null ? job.getString('job_title') : '',
    department: job !== null ? job.getString('department') : '',
    department_name: deptName,
    manager: job !== null ? job.getString('manager') : '',
  };
  ctx._perfPeople[employeeId] = out;
  return out;
}

/** The short form used inside lists. */
function chip(ctx, employeeId) {
  const p = person(ctx, employeeId);
  if (p === null) return null;
  return { id: p.id, number: p.number, name: p.name, title: p.title, department_name: p.department_name, photo: p.photo };
}

function memberName(app, id) {
  if (!id) return '';
  const m = u().byId(app, 'members', id);
  return m === null ? '' : m.getString('name');
}

function notifyEmployee(app, employeeId, n) {
  if (!employeeId) return [];
  return L('lib_notify').toEmployee(app, employeeId, n);
}

/** The employee the caller acts for (their own), or a 400 that says so. */
function selfOrFail(ctx) {
  if (ctx.isAgent || !ctx.employeeId) throw u().fail(400, 'Your sign-in is not linked to an employee record, so there is nothing of your own here. An administrator links it in Settings, Members.', 'no_employee');
  return ctx.employeeId;
}

/** --employee param or the caller's own employee. */
function employeeParam(ctx, p, name) {
  const util = u();
  const ref = util.str(p, name || 'employee', '');
  if (ref === '') return selfOrFail(ctx);
  return L('lib_people').employeeRef(ctx.app, ref).id;
}

/* ----------------------------------------------------------- settings */

function companyRow(app) {
  const util = u();
  let r = util.findOne(app, 'perf_settings', "entity = ''");
  if (r === null) {
    r = util.newRecord(app, 'perf_settings');
    r.set('entity', '');
    r.set('values', []);
    r.set('signoff', false);
    r.set('praise_wall', true);
    r.set('checkin_days', 14);
    r.set('reminder_days', 3);
    r.set('extra', {});
    app.save(r);
  }
  return r;
}

/** Does this entity require HR sign-off of reviews? (the entity's row, else the company default) */
function signoffFor(app, entityId) {
  if (entityId) {
    const r = u().findOne(app, 'perf_settings', 'entity = {:e}', { e: entityId });
    if (r !== null) return r.getBool('signoff');
  }
  return companyRow(app).getBool('signoff');
}

function settingsOf(app) {
  const c = companyRow(app);
  const util = u();
  return {
    values: util.jsonOf(c, 'values', []) || [],
    praise_wall: c.getBool('praise_wall'),
    checkin_days: c.getInt('checkin_days') || 14,
    reminder_days: c.getInt('reminder_days'),
    signoff_default: c.getBool('signoff'),
  };
}

function settingsGet(ctx) {
  const util = u();
  const app = ctx.app;
  const out = settingsOf(app);
  const rows = util.rows(app, "SELECT e.id AS id, e.name AS name, e.country AS country, COALESCE(s.signoff, -1) AS signoff FROM entities e LEFT JOIN perf_settings s ON s.entity = e.id WHERE e.active = TRUE ORDER BY e.created", { id: '', name: '', country: '', signoff: 0 });
  out.entities = rows.map((r) => ({ entity: r.id, name: r.name, country: r.country, signoff: r.signoff === -1 ? out.signoff_default : r.signoff === 1, own: r.signoff !== -1 }));
  out.value_icons = VALUE_ICONS;
  out.can_edit = !ctx.isAgent && L('lib_auth').can(ctx, 'performance', 'full');
  return out;
}

function readValues(p) {
  const util = u();
  const raw = util.list(p, 'values');
  if (raw === undefined) return undefined;
  if (raw.length > 12) throw util.fail(400, 'Keep to 12 company values at most.', 'invalid_param', { param: 'values' });
  const seen = {};
  return raw.map((v, i) => {
    const item = typeof v === 'string' ? { name: v } : v;
    util.keysOnly(item, ['code', 'name', 'description', 'icon'], 'values item ' + (i + 1));
    const name = util.squash(item.name || '');
    if (name === '' || name.length > 40) throw util.fail(400, 'values item ' + (i + 1) + ': a name of 1 to 40 characters.', 'invalid_param', { param: 'values' });
    const code = util.slug(item.code || name).slice(0, 30) || 'value-' + (i + 1);
    if (seen[code]) throw util.fail(400, 'Two values are called "' + name + '".', 'invalid_param', { param: 'values' });
    seen[code] = true;
    const icon = String(item.icon || 'Star');
    if (VALUE_ICONS.indexOf(icon) < 0) throw util.fail(400, 'values item ' + (i + 1) + ': icon is one of ' + VALUE_ICONS.join(', ') + '.', 'invalid_param', { param: 'values' });
    return { code: code, name: name, description: util.clip(util.squash(item.description || ''), 200), icon: icon };
  });
}

function settingsUpdate(ctx, p) {
  const util = u();
  const app = ctx.app;
  const before = settingsGet(ctx);
  const entRef = util.str(p, 'entity', '');
  if (entRef !== '') {
    const ent = L('lib_org').entityRef(app, entRef);
    if (!L('lib_auth').inScope(ctx, ent.id)) throw util.fail(403, 'This entity is outside your entities.', 'not_permitted');
    if (!util.has(p, 'signoff')) throw util.fail(400, 'With --entity, give --signoff true or false (the other settings are company wide).', 'missing_param', { param: 'signoff' });
    let r = util.findOne(app, 'perf_settings', 'entity = {:e}', { e: ent.id });
    if (r === null) {
      r = util.newRecord(app, 'perf_settings');
      r.set('entity', ent.id);
      r.set('values', []);
      r.set('praise_wall', true);
      r.set('checkin_days', 14);
      r.set('reminder_days', 3);
      r.set('extra', {});
    }
    r.set('signoff', util.bool(p, 'signoff', false));
    app.save(r);
    L('lib_audit').note(ctx, { collection: 'perf_settings', record: r.id, summary: (r.getBool('signoff') ? 'HR signs off reviews in ' : 'No HR sign-off of reviews in ') + ent.getString('name'), before: before, after: settingsGet(ctx) });
    return settingsGet(ctx);
  }
  const c = companyRow(app);
  const values = readValues(p);
  if (values !== undefined) c.set('values', values);
  if (util.has(p, 'praise_wall')) c.set('praise_wall', util.bool(p, 'praise_wall', true));
  if (util.has(p, 'signoff')) c.set('signoff', util.bool(p, 'signoff', false));
  if (util.has(p, 'checkin_days')) c.set('checkin_days', util.int(p, 'checkin_days', 14, 1, 365));
  if (util.has(p, 'reminder_days')) c.set('reminder_days', util.int(p, 'reminder_days', 3, 0, 60));
  app.save(c);
  L('lib_audit').note(ctx, { collection: 'perf_settings', record: c.id, summary: 'Changed the performance settings', before: before, after: settingsGet(ctx) });
  return settingsGet(ctx);
}

/* --------------------------------------------------------------- home */

/** Performance Home: the current cycles and what the caller owes, goals that need an update, praise this week, trainings due. */
function home(ctx, p) {
  const util = u();
  const app = ctx.app;
  const today = util.today(app);
  const auth = L('lib_auth');
  const reviews = L('lib_performance_reviews');
  const goals = L('lib_performance_goals');
  const fb = L('lib_performance_feedback');
  const tr = L('lib_performance_training');
  const me = ctx.isAgent ? '' : ctx.employeeId || '';
  const out = { today: today, employee: me !== '' ? chip(ctx, me) : null, hr: !ctx.isAgent && auth.can(ctx, 'performance', 'view'), manager: Object.keys(teamOf(ctx)).length > 0 };
  out.cycles = reviews.activeCyclesFor(ctx, today);
  out.owe = me !== '' ? reviews.owedBy(ctx, me, today) : [];
  out.to_acknowledge = me !== '' ? reviews.toAcknowledge(ctx, me) : [];
  out.requests = me !== '' ? fb.openRequestsFor(ctx, me) : [];
  const g = goals.needingUpdate(ctx, me !== '' ? { employee: me } : { all: true }, today, 6);
  out.goals = g.goals;
  out.goals_total = g.total;
  if (out.manager) {
    const t = goals.needingUpdate(ctx, { team: true }, today, 0);
    out.team_goals_needing_update = t.total;
  }
  out.praise = fb.wallRows(ctx, { since: util.dayAdd(today, -7), limit: 6 });
  out.praise_total = fb.wallCount(ctx, util.dayAdd(today, -7));
  out.trainings = me !== '' ? tr.dueFor(ctx, me, today) : [];
  out.upcoming_trainings = me !== '' ? tr.upcomingFor(ctx, me, today, 4) : [];
  if (out.manager) out.team = { people: Object.keys(teamOf(ctx)).length, reviews_missing: reviews.teamMissing(ctx), trainings_overdue: tr.teamOverdue(ctx, today) };
  out.settings = { values: settingsOf(app).values, praise_wall: settingsOf(app).praise_wall };
  return out;
}

/** The caller's own open items for the Inbox (one light read): reviews to write, reviews to acknowledge, feedback requests. */
function inbox(ctx) {
  const util = u();
  const me = ctx.isAgent ? '' : ctx.employeeId || '';
  if (me === '') return { reviews: [], acknowledge: [], requests: [], total: 0 };
  const today = util.today(ctx.app);
  const reviews = L('lib_performance_reviews').owedBy(ctx, me, today);
  const acknowledge = L('lib_performance_reviews').toAcknowledge(ctx, me);
  const requests = L('lib_performance_feedback')
    .openRequestsFor(ctx, me)
    .map((f) => ({ id: f.id, from: f.from, text: f.text, due: f.due }));
  return { reviews: reviews, acknowledge: acknowledge, requests: requests, total: reviews.length + acknowledge.length + requests.length };
}

/* ------------------------------------------------------------ profile */

/** The profile tab: goals, reviews shared with the person, feedback received (what the caller may see), skills, trainings. */
function profile(ctx, p) {
  const util = u();
  const app = ctx.app;
  const emp = L('lib_people').employeeRef(app, util.req(p, 'employee'));
  const r = needSee(ctx, emp.id);
  const today = util.today(app);
  return {
    employee: chip(ctx, emp.id),
    relation: { self: r.self, manager: r.manager, team: r.team, hr: r.hr },
    goals: L('lib_performance_goals').listFor(ctx, emp.id, { open: true }),
    reviews: L('lib_performance_reviews').historyOf(ctx, emp.id),
    feedback: L('lib_performance_feedback').receivedBy(ctx, emp.id, 20),
    skills: L('lib_performance_skills').skillsOf(ctx, emp.id),
    trainings: L('lib_performance_training').historyOf(ctx, emp.id, today),
    today: today,
  };
}

/** Facts for the profile header and Home (events_performance.js profileFacts). */
function profileFacts(ctx, employmentId) {
  const util = u();
  const app = ctx.app;
  const m = util.byId(app, 'employments', employmentId);
  if (m === null) return [];
  const empId = m.getString('employee');
  const r = relation(ctx, empId);
  if (!r.any && !ctx.isAgent) return [];
  const today = util.today(app, m.getString('entity'));
  const facts = [];
  const g = util.one(app, "SELECT COUNT(*) AS n, CAST(COALESCE(AVG(progress), 0) AS INTEGER) AS avg FROM goals WHERE employee = {:e} AND status NOT IN ('done', 'dropped')", { n: 0, avg: 0 }, { e: empId });
  if (g !== null && g.n > 0) facts.push({ label: 'Goals', value: g.n + ' open, ' + g.avg + '% on average', link: '#/performance/goals?employee=' + empId });
  const risk = util.count(app, "SELECT COUNT(*) AS n FROM goals WHERE employee = {:e} AND status IN ('at_risk', 'off_track')", { e: empId });
  if (risk > 0) facts.push({ label: 'Goals at risk', value: String(risk), tone: 'warn', link: '#/performance/goals?employee=' + empId });
  const last = L('lib_performance_reviews').lastShared(ctx, empId);
  if (last !== null) facts.push({ label: 'Last review', value: last.cycle_name + (last.rating_label !== '' ? ', ' + last.rating_label : ''), link: '#/performance/reviews/' + last.review });
  const due = L('lib_performance_training').dueFor(ctx, empId, today);
  const overdue = due.filter((x) => x.state === 'overdue').length;
  if (overdue > 0) facts.push({ label: 'Training overdue', value: String(overdue), tone: 'bad', link: '#/performance/training' });
  else if (due.length > 0) facts.push({ label: 'Training due', value: String(due.length), tone: 'warn', link: '#/performance/training' });
  const praise = util.count(app, "SELECT COUNT(*) AS n FROM feedback WHERE to_employee = {:e} AND kind = 'praise' AND created >= {:t}", { e: empId, t: util.dayAdd(today, -90) + ' 00:00:00' });
  if (praise > 0) facts.push({ label: 'Praise, 90 days', value: String(praise), link: '#/performance/feedback?employee=' + empId });
  return facts;
}

/* ------------------------------------------------------------- events */

/** employment.ended: the person leaves open review cycles; their unwritten reviews of others are declined. */
function onEmploymentEnded(ctx, payload) {
  const util = u();
  const app = ctx.app;
  const employment = payload && payload.employment;
  if (!employment) return null;
  let n = 0;
  for (const r of util.findMany(app, 'review_participants', "employment = {:m} && stage = 'open'", '', 0, { m: employment })) {
    const c = util.byId(app, 'review_cycles', r.getString('cycle'));
    if (c === null || c.getString('status') !== 'active') continue;
    r.set('stage', 'removed');
    r.set('note', util.clip('Left on ' + (payload.end_day || '') + '. ' + r.getString('note'), 2000));
    app.save(r);
    n++;
  }
  const emp = util.byId(app, 'employments', employment);
  if (emp !== null && payload.end_day && payload.end_day <= util.today(app, emp.getString('entity'))) {
    for (const rv of util.findMany(app, 'reviews', "reviewer = {:e} && status = 'draft' && (kind = 'peer' || kind = 'upward')", '', 0, { e: emp.getString('employee') })) {
      rv.set('status', 'declined');
      rv.set('declined_reason', 'The reviewer left the company.');
      app.save(rv);
    }
  }
  return { removed: n };
}

/* ------------------------------------------------------------- nudges */

/** Remember that a reminder went out (key once); false when it already did. */
function nudgeOnce(app, key, day) {
  const util = u();
  if (util.findOne(app, 'perf_nudges', 'key = {:k}', { k: key }) !== null) return false;
  const r = util.newRecord(app, 'perf_nudges');
  r.set('key', util.clip(key, 200));
  r.set('day', day);
  app.save(r);
  return true;
}

/** Cron (hourly): at 09:00 local time per entity, remind reviewers and people with trainings due; prune old nudges. */
function cronReminders(app) {
  const util = u();
  const ctx = L('lib_auth').systemCtx(app);
  let sent = 0;
  sent += L('lib_performance_reviews').remindDue(ctx, false);
  sent += L('lib_performance_training').remindDue(ctx, false);
  const old = util.dayAdd(util.today(app), -120);
  util.exec(app, "DELETE FROM perf_nudges WHERE day != '' AND day < {:d}", { d: old });
  return sent;
}

module.exports = {
  RANK: RANK,
  VALUE_ICONS: VALUE_ICONS,
  atLeast: atLeast,
  teamOf: teamOf,
  hrLevel: hrLevel,
  relation: relation,
  canManage: canManage,
  needSee: needSee,
  visibleIds: visibleIds,
  inList: inList,
  person: person,
  chip: chip,
  memberName: memberName,
  notifyEmployee: notifyEmployee,
  selfOrFail: selfOrFail,
  employeeParam: employeeParam,
  companyRow: companyRow,
  signoffFor: signoffFor,
  settingsOf: settingsOf,
  settingsGet: settingsGet,
  settingsUpdate: settingsUpdate,
  home: home,
  inbox: inbox,
  profile: profile,
  profileFacts: profileFacts,
  onEmploymentEnded: onEmploymentEnded,
  nudgeOnce: nudgeOnce,
  cronReminders: cronReminders,
};
