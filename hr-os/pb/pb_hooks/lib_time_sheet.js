/// <reference path="../pb_data/types.d.ts" />
/**
 * Weekly timesheets. A week's timesheet is built from attendance (regular,
 * overtime, leave and holiday rows per day, split by the entity's overtime
 * rules); the person may split their time over projects and tasks or
 * correct a day (their rows then replace the attendance rows of that day,
 * and the approver sees the difference). Submitting opens an approval of
 * kind timesheet for the manager with the week's numbers and exceptions.
 * Your AI agent checks a week of timesheets when a person asks (a
 * timesheet_reviews record and the timesheet_review trigger with its id) or,
 * when the company switched the weekly check on, last week of an entity with
 * missed punches (timesheet_check): it proposes fixes, reports anomalies
 * with timesheet-reviews.done, and never approves.
 *
 * Reading a draft never writes: the view is computed from attendance and
 * the saved rows; the record is written when the person saves or submits.
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

const ENTRY_KINDS = ['regular', 'overtime', 'leave', 'holiday'];
const EXC = {
  missing_punch: { message: 'A punch is missing', severity: 'warning' },
  absent: { message: 'Absent on a working day', severity: 'warning' },
  late: { message: 'Came in late', severity: 'info' },
  early: { message: 'Left early', severity: 'info' },
  outside_area: { message: 'Clocked outside the location area', severity: 'info' },
  long_day: { message: 'Worked more than 12 hours', severity: 'warning' },
  rest_day_work: { message: 'Worked on a rest day', severity: 'info' },
  holiday_work: { message: 'Worked on a public holiday', severity: 'info' },
  edited: { message: 'Hours differ from the punches', severity: 'warning' },
  open: { message: 'Still clocked in', severity: 'info' },
};

function periodFor(R, empId, ref) {
  const rules = L('lib_time_rules');
  const rs = R.ruleSet(empId, ref);
  const from = rules.weekStartOf(ref, rs.settings.week_start);
  return { from: from, to: rules.dayAdd(from, 6), rs: rs };
}

/** What attendance says about a week: entries by day, exceptions, per-day facts. */
function fromAttendance(R, empId, from, to) {
  const util = u();
  const t = T();
  const rules = L('lib_time_rules');
  const rs = R.ruleSet(empId, to);
  const facts = t.dayFacts(R, empId, from, to, {}).map((x) => Object.assign({}, x, { worked: x.future ? 0 : x.worked }));
  const cls = rules.classify(
    facts.map((x) => ({ day: x.day, kind: x.kind, worked: x.worked, night: x.night, leave: x.leave })),
    rs.rules,
    { week_start: rs.settings.week_start, counts_leave: rs.settings.counts_leave },
  );
  const entries = [];
  const exceptions = [];
  const byDay = {};
  for (const f of facts) {
    const c = cls.filter((x) => x.day === f.day)[0];
    const reg = c ? c.regular : f.worked;
    const ot = c ? c.parts.filter((p) => p.when !== 'night').reduce((s, p) => s + p.minutes, 0) : 0;
    const list = [];
    if (reg > 0) list.push({ day: f.day, kind: 'regular', minutes: reg });
    if (ot > 0) list.push({ day: f.day, kind: 'overtime', minutes: ot });
    if (f.leave > 0) list.push({ day: f.day, kind: 'leave', minutes: f.leave });
    if (f.kind === 'holiday' && f.worked === 0 && f.status === 'holiday') {
      const plan = t.planOf(R, empId, f.day);
      const sch = R.scheduleOn(empId, f.day);
      const normal = sch ? L('lib_calendar').weekMinutes(sch.week, f.day) : plan.normal_min;
      if (normal > 0) list.push({ day: f.day, kind: 'holiday', minutes: normal });
    }
    for (const e of list) entries.push(Object.assign({ id: '', project: '', task: '', note: '', source: 'attendance' }, e));
    byDay[f.day] = { day: f.day, status: f.status, kind: f.kind, worked: f.worked, regular: reg, overtime: ot, leave: f.leave, night: f.night, late: f.late, flags: f.flags, future: f.future };
    const add = (code) => exceptions.push({ day: f.day, code: code, message: EXC[code].message, severity: EXC[code].severity });
    if (f.flags.indexOf('missed_in') >= 0 || f.flags.indexOf('missed_out') >= 0) add('missing_punch');
    if (f.flags.indexOf('open') >= 0) add('open');
    if (f.status === 'absent') add('absent');
    if (f.late > 0) add('late');
    if (f.flags.indexOf('outside_geofence') >= 0) add('outside_area');
    if (f.worked > 720) add('long_day');
    if (f.kind === 'rest' && f.worked > 0) add('rest_day_work');
    if (f.kind === 'holiday' && f.worked > 0) add('holiday_work');
  }
  return { entries: entries, exceptions: exceptions, days: byDay, rule_set: rs };
}

function entryView(r) {
  return { id: r.id, day: r.getString('day'), kind: r.getString('kind'), minutes: r.getInt('minutes'), project: r.getString('project'), task: r.getString('task'), note: r.getString('note'), source: r.getString('source') };
}

function totalsOf(entries) {
  const t = { regular_min: 0, overtime_min: 0, leave_min: 0, holiday_min: 0, total_min: 0 };
  for (const e of entries) {
    t[e.kind + '_min'] += e.minutes;
    t.total_min += e.minutes;
  }
  return t;
}

function projectsOf(entries) {
  const p = {};
  for (const e of entries) {
    if (e.project === '' || (e.kind !== 'regular' && e.kind !== 'overtime')) continue;
    const k = e.project + (e.task ? ' / ' + e.task : '');
    p[k] = (p[k] || 0) + e.minutes;
  }
  return Object.keys(p)
    .sort()
    .map((k) => ({ project: k, minutes: p[k] }));
}

/** The timesheet view of one employment and week (computed for drafts, saved rows otherwise). */
function sheetView(app, m, ref) {
  const util = u();
  const t = T();
  const R = t.resolver(app);
  const per = periodFor(R, m.id, ref);
  const rec = util.findOne(app, 'timesheets', 'employment = {:e} && period_start = {:f}', { e: m.id, f: per.from });
  const att = fromAttendance(R, m.id, per.from, per.to);
  const saved = rec !== null ? util.findMany(app, 'timesheet_entries', 'timesheet = {:t}', 'day,sort,created', 0, { t: rec.id }).map(entryView) : [];
  const status = rec !== null ? rec.getString('status') : 'draft';
  let entries;
  const own = {};
  for (const e of saved) if (e.source !== 'attendance') own[e.day] = true;
  if (status === 'draft' || status === 'rejected') entries = att.entries.filter((e) => !own[e.day]).concat(saved.filter((e) => e.source !== 'attendance'));
  else entries = saved;
  entries.sort((a, b) => (a.day !== b.day ? (a.day < b.day ? -1 : 1) : ENTRY_KINDS.indexOf(a.kind) - ENTRY_KINDS.indexOf(b.kind)));
  const exceptions = att.exceptions.slice();
  for (const d of Object.keys(own)) {
    const mine = entries.filter((e) => e.day === d && (e.kind === 'regular' || e.kind === 'overtime')).reduce((s, e) => s + e.minutes, 0);
    const a = att.days[d] ? att.days[d].worked : 0;
    if (mine !== a) exceptions.push({ day: d, code: 'edited', message: EXC.edited.message + ' (' + t.hm(mine) + ' against ' + t.hm(a) + ' punched)', severity: 'warning' });
  }
  exceptions.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const emp = app.findRecordById('employees', m.getString('employee'));
  const days = [];
  for (let d = per.from; d <= per.to; d = util.dayAdd(d, 1)) days.push(att.days[d] || { day: d, status: '', kind: 'work', worked: 0, regular: 0, overtime: 0, leave: 0, night: 0, late: 0, flags: [], future: d > R.today(m.id), outside: true });
  return {
    id: rec !== null ? rec.id : '',
    employment: m.id,
    employee: { id: emp.id, number: emp.getString('number'), name: L('lib_people').displayName(emp) },
    period_start: per.from,
    period_end: per.to,
    status: status,
    basis: rec !== null ? rec.getString('basis') || 'attendance' : 'attendance',
    note: rec !== null ? rec.getString('note') : '',
    decided_note: rec !== null ? rec.getString('decided_note') : '',
    approval: rec !== null ? rec.getString('approval') : '',
    submitted_at: rec !== null ? rec.getString('submitted_at') : '',
    decided_at: rec !== null ? rec.getString('decided_at') : '',
    locked: rec !== null ? rec.getBool('locked') : false,
    entries: entries,
    totals: totalsOf(entries),
    projects: projectsOf(entries),
    exceptions: exceptions,
    days: days,
    rule_set: per.rs.name,
    tracking: per.rs.settings.tracking,
  };
}

function editable(ctx, m, status) {
  const a = T().access(ctx, m);
  if (a === 'self') return status === 'draft' || status === 'rejected';
  return ['full', 'edit', 'agent', 'system'].indexOf(a) >= 0 && status !== 'approved';
}

function sheetMine(ctx, p) {
  const util = u();
  const t = T();
  const m = t.selfEmployment(ctx, util.str(p, 'employment', ''));
  const v = sheetView(ctx.app, m, util.day(p, 'week', t.resolver(ctx.app).today(m.id)));
  v.can = { edit: editable(ctx, m, v.status), submit: v.status === 'draft' || v.status === 'rejected', withdraw: v.status === 'submitted' };
  return { timesheet: v };
}

function sheetGet(ctx, p) {
  const util = u();
  const t = T();
  const app = ctx.app;
  let m;
  let ref;
  const id = util.str(p, 'timesheet', '');
  if (id !== '') {
    const rec = util.byId(app, 'timesheets', id);
    if (rec === null) throw util.fail(404, 'No such timesheet.', 'not_found');
    m = app.findRecordById('employments', rec.getString('employment'));
    t.needSee(ctx, m);
    ref = rec.getString('period_start');
  } else {
    m = t.employmentFor(ctx, util.str(p, 'employment', ''));
    ref = util.day(p, 'week', t.resolver(app).today(m.id));
  }
  const v = sheetView(app, m, ref);
  const a = t.access(ctx, m);
  v.can = { edit: editable(ctx, m, v.status), submit: a === 'self' && (v.status === 'draft' || v.status === 'rejected'), withdraw: a === 'self' && v.status === 'submitted', reopen: ['full', 'edit'].indexOf(a) >= 0 && v.status === 'approved' && !v.locked };
  return { timesheet: v };
}

/** timesheets.list: a week's timesheets of everyone the caller sees (exceptions first), for review. */
function sheetList(ctx, p) {
  const util = u();
  const t = T();
  const app = ctx.app;
  const rules = L('lib_time_rules');
  const entity = util.str(p, 'entity', '');
  const entityId = entity !== '' ? L('lib_org').entityRef(app, entity).id : '';
  const ref = util.day(p, 'week', util.today(app, entityId || undefined));
  const ent = entityId ? app.findRecordById('entities', entityId) : util.findMany(app, 'entities', 'active = true', 'created', 1)[0] || null;
  const ws = ent ? ent.getInt('week_start') : 1;
  const from = rules.weekStartOf(ref, ws);
  const to = util.dayAdd(from, 6);
  const people = t.roster(ctx, from, to, { entity: entityId, location: util.str(p, 'location', ''), department: util.str(p, 'department', ''), team: util.bool(p, 'team', false) });
  const want = util.str(p, 'status', '');
  const rows = [];
  for (const person of people) {
    const m = app.findRecordById('employments', person.employment);
    const v = sheetView(app, m, from);
    if (want !== '' && v.status !== want) continue;
    rows.push({ id: v.id, employment: m.id, number: person.number, name: person.name, title: person.title, department_name: person.department_name, period_start: v.period_start, period_end: v.period_end, status: v.status, totals: v.totals, exceptions: v.exceptions.filter((x) => x.severity !== 'info').length, exception_codes: v.exceptions.map((x) => x.code), approval: v.approval, locked: v.locked });
  }
  const order = { submitted: 0, rejected: 1, draft: 2, approved: 3 };
  rows.sort((a, b) => (order[a.status] !== order[b.status] ? order[a.status] - order[b.status] : b.exceptions !== a.exceptions ? b.exceptions - a.exceptions : a.name < b.name ? -1 : 1));
  const counts = { draft: 0, submitted: 0, approved: 0, rejected: 0, with_exceptions: 0 };
  for (const r of rows) {
    counts[r.status]++;
    if (r.exceptions > 0) counts.with_exceptions++;
  }
  return { from: from, to: to, timesheets: rows, counts: counts };
}

/** The timesheet record of a week (created as a draft when missing). */
function ensureRecord(app, m, from, to) {
  const util = u();
  let rec = util.findOne(app, 'timesheets', 'employment = {:e} && period_start = {:f}', { e: m.id, f: from });
  if (rec === null) {
    rec = util.newRecord(app, 'timesheets');
    rec.set('employment', m.id);
    rec.set('period_start', from);
    rec.set('period_end', to);
    rec.set('status', 'draft');
    rec.set('basis', 'attendance');
    rec.set('exceptions', []);
    app.save(rec);
  }
  return rec;
}

function sheetFor(ctx, p) {
  const util = u();
  const t = T();
  const app = ctx.app;
  const id = util.str(p, 'timesheet', '');
  if (id !== '') {
    const rec = util.byId(app, 'timesheets', id);
    if (rec === null) throw util.fail(404, 'No such timesheet.', 'not_found');
    return { m: app.findRecordById('employments', rec.getString('employment')), week: rec.getString('period_start') };
  }
  const m = util.str(p, 'employment', '') !== '' ? L('lib_people').employmentRef(app, util.str(p, 'employment', '')) : t.selfEmployment(ctx, '');
  return { m: m, week: util.day(p, 'week', t.resolver(app).today(m.id)) };
}

/** timesheets.save-entries: the person's rows for some days (projects, tasks, corrections) replace those days' attendance rows. */
function saveEntries(ctx, p) {
  const util = u();
  const t = T();
  const app = ctx.app;
  const sf = sheetFor(ctx, p);
  const m = sf.m;
  t.needSee(ctx, m);
  const R = t.resolver(app);
  const per = periodFor(R, m.id, sf.week);
  const cur = util.findOne(app, 'timesheets', 'employment = {:e} && period_start = {:f}', { e: m.id, f: per.from });
  const status = cur !== null ? cur.getString('status') : 'draft';
  if (cur !== null && cur.getBool('locked')) throw util.fail(409, 'This week was paid in a locked pay run.', 'locked');
  if (!editable(ctx, m, status)) throw util.fail(409, status === 'submitted' ? 'This timesheet waits for approval: withdraw it to change it.' : status === 'approved' ? 'This timesheet is approved. HR can reopen it.' : 'You cannot change this timesheet.', 'not_editable');
  const items = util.list(p, 'entries');
  if (items === undefined) throw util.fail(400, 'entries is a JSON list of rows [{"day":"2026-11-02","kind":"regular","minutes":240,"project":"Website","task":"Design","note":""}]. Every day you list is replaced by your rows; [] for a day with "days" clears it back to the punches.', 'missing_param', { param: 'entries' });
  if (items.length > 200) throw util.fail(400, 'At most 200 rows.', 'invalid_param');
  const days = {};
  const clean = items.map((x, i) => {
    util.keysOnly(x, ['day', 'kind', 'minutes', 'project', 'task', 'note'], 'entry ' + (i + 1));
    const d = String(x.day || '');
    if (!util.isDay(d) || d < per.from || d > per.to) throw util.fail(400, 'entry ' + (i + 1) + ': day must be inside the week ' + per.from + ' to ' + per.to + '.', 'invalid_param');
    const kind = String(x.kind || 'regular');
    if (ENTRY_KINDS.indexOf(kind) < 0) throw util.fail(400, 'entry ' + (i + 1) + ': kind is one of ' + ENTRY_KINDS.join(', '), 'invalid_param');
    const mins = Number(x.minutes);
    if (!Number.isInteger(mins) || mins < 0 || mins > 1440) throw util.fail(400, 'entry ' + (i + 1) + ': minutes is a whole number from 0 to 1440.', 'invalid_param');
    days[d] = true;
    return { day: d, kind: kind, minutes: mins, project: util.clip(util.squash(x.project || ''), 120), task: util.clip(util.squash(x.task || ''), 120), note: util.clip(String(x.note || ''), 500) };
  });
  for (const d of util.list(p, 'days') || []) {
    if (!util.isDay(String(d)) || String(d) < per.from || String(d) > per.to) throw util.fail(400, 'days must be inside the week.', 'invalid_param');
    days[String(d)] = true;
  }
  for (const d of Object.keys(days)) {
    const tot = clean.filter((x) => x.day === d).reduce((s, x) => s + x.minutes, 0);
    if (tot > 1440) throw util.fail(400, d + ' adds up to more than 24 hours.', 'invalid_param');
  }
  const before = sheetView(app, m, per.from).totals;
  app.runInTransaction((tx) => {
    const rec = ensureRecord(tx, m, per.from, per.to);
    for (const d of Object.keys(days)) for (const e of util.findMany(tx, 'timesheet_entries', 'timesheet = {:t} && day = {:d}', '', 0, { t: rec.id, d: d })) tx.delete(e);
    let n = 0;
    for (const x of clean) {
      if (x.minutes === 0 && x.project === '' && x.note === '') continue;
      const r = util.newRecord(tx, 'timesheet_entries');
      r.set('timesheet', rec.id);
      r.set('day', x.day);
      r.set('kind', x.kind);
      r.set('minutes', x.minutes);
      r.set('project', x.project);
      r.set('task', x.task);
      r.set('note', x.note);
      r.set('source', ctx.isAgent ? 'agent' : 'person');
      r.set('sort', n++);
      tx.save(r);
    }
    if (util.has(p, 'note')) rec.set('note', util.text(p, 'note', 2000, ''));
    if (rec.getString('status') === 'rejected') rec.set('status', 'draft');
    tx.save(rec);
  });
  const v = sheetView(app, m, per.from);
  L('lib_audit').note(ctx, { collection: 'timesheets', record: v.id, summary: 'Changed the timesheet of ' + v.employee.number + ' for the week of ' + per.from + ' (' + Object.keys(days).length + ' days)', before: before, after: v.totals });
  return { timesheet: v };
}

function previewSaveEntries(ctx, p) {
  const util = u();
  const app = ctx.app;
  const sf = sheetFor(ctx, p);
  const v = sheetView(app, sf.m, sf.week);
  const items = util.list(p, 'entries') || [];
  const days = {};
  for (const x of items) days[String(x.day)] = (days[String(x.day)] || 0) + (Number(x.minutes) || 0);
  const fields = Object.keys(days)
    .sort()
    .map((d) => {
      const was = v.entries.filter((e) => e.day === d).reduce((s, e) => s + e.minutes, 0);
      return { name: 'hours on ' + d, before: T().hm(was), after: T().hm(days[d]) };
    });
  return { label: 'Change the timesheet of ' + v.employee.name + ' for the week of ' + v.period_start, target: 'employments:' + sf.m.id, fields: fields, notes: [util.str(p, 'note', '')].filter((x) => x !== ''), risk: 'low' };
}

/** timesheets.submit: send the week for approval (the manager sees the numbers and the exceptions). */
function submit(ctx, p) {
  const util = u();
  const t = T();
  const app = ctx.app;
  const sf = sheetFor(ctx, p);
  const m = sf.m;
  if (t.access(ctx, m) !== 'self') throw util.fail(403, 'Only the person submits their own timesheet.', 'not_permitted');
  const v0 = sheetView(app, m, sf.week);
  if (v0.status === 'submitted') throw util.fail(409, 'This timesheet already waits for approval.', 'conflict');
  if (v0.status === 'approved') throw util.fail(409, 'This timesheet is approved.', 'conflict');
  if (v0.period_start > t.resolver(app).today(m.id)) throw util.fail(400, 'This week has not started yet.', 'invalid_param');
  let ap = null;
  app.runInTransaction((tx) => {
    const rec = ensureRecord(tx, m, v0.period_start, v0.period_end);
    for (const e of util.findMany(tx, 'timesheet_entries', "timesheet = {:t} && source = 'attendance'", '', 0, { t: rec.id })) tx.delete(e);
    let n = 0;
    for (const e of v0.entries) {
      if (e.source !== 'attendance') continue;
      const r = util.newRecord(tx, 'timesheet_entries');
      r.set('timesheet', rec.id);
      r.set('day', e.day);
      r.set('kind', e.kind);
      r.set('minutes', e.minutes);
      r.set('source', 'attendance');
      r.set('sort', n++);
      tx.save(r);
    }
    rec.set('regular_min', v0.totals.regular_min);
    rec.set('overtime_min', v0.totals.overtime_min);
    rec.set('leave_min', v0.totals.leave_min);
    rec.set('holiday_min', v0.totals.holiday_min);
    rec.set('total_min', v0.totals.total_min);
    rec.set('exceptions', v0.exceptions);
    if (util.has(p, 'note')) rec.set('note', util.text(p, 'note', 2000, ''));
    rec.set('status', 'submitted');
    rec.set('submitted_at', util.nowIso());
    rec.set('decided_note', '');
    tx.save(rec);
    const tctx = L('lib_auth').withApp(ctx, tx);
    ap = L('lib_approvals').open(tctx, {
      kind: 'timesheet',
      ref_collection: 'timesheets',
      ref_id: rec.id,
      employment: m.id,
      summary: 'Timesheet of ' + v0.employee.name + ', week of ' + L('lib_time_shift').rangeLabel(v0.period_start, v0.period_end) + ': ' + t.hm(v0.totals.regular_min + v0.totals.overtime_min) + ' worked' + (v0.totals.overtime_min > 0 ? ', ' + t.hm(v0.totals.overtime_min) + ' overtime' : ''),
      facts: [t.fact.days('week', 'Week', v0.period_start, v0.period_end), t.fact.hours('worked', 'Worked', v0.totals.regular_min + v0.totals.overtime_min)].concat(
        v0.totals.overtime_min > 0 ? [t.fact.hours('overtime', 'Overtime', v0.totals.overtime_min)] : [],
        v0.totals.leave_min > 0 ? [t.fact.hours('leave', 'Leave', v0.totals.leave_min)] : [],
        v0.exceptions.filter((x) => x.severity !== 'info').length > 0 ? [t.fact.count('exceptions', 'Exceptions', v0.exceptions.filter((x) => x.severity !== 'info').length)] : [],
      ),
      payload: { timesheet: rec.id, period_start: v0.period_start, period_end: v0.period_end, totals: v0.totals, exceptions: v0.exceptions.filter((x) => x.severity !== 'info').slice(0, 12), notes: v0.exceptions.filter((x) => x.severity === 'info').slice(0, 12), days: v0.days.map((d) => ({ day: d.day, status: d.status, kind: d.kind, worked: d.worked, regular: d.regular, overtime: d.overtime, leave: d.leave })), projects: v0.projects, note: util.text(p, 'note', 2000, '') },
    });
    const fresh = tx.findRecordById('timesheets', rec.id);
    fresh.set('approval', ap.id);
    tx.save(fresh);
  });
  const v = sheetView(app, m, sf.week);
  L('lib_audit').note(ctx, { collection: 'timesheets', record: v.id, summary: 'Submitted the timesheet for the week of ' + v.period_start });
  return { timesheet: v, approval: ap };
}

function withdraw(ctx, p) {
  const util = u();
  const t = T();
  const app = ctx.app;
  const sf = sheetFor(ctx, p);
  if (t.access(ctx, sf.m) !== 'self' && !L('lib_auth').can(ctx, 'time', 'full')) throw util.fail(403, 'Only the person (or HR) withdraws a timesheet.', 'not_permitted');
  const rec = util.findOne(app, 'timesheets', 'employment = {:e} && period_start = {:f}', { e: sf.m.id, f: periodFor(t.resolver(app), sf.m.id, sf.week).from });
  if (rec === null || rec.getString('status') !== 'submitted') throw util.fail(409, 'Only a submitted timesheet can be withdrawn.', 'conflict');
  if (rec.getString('approval') !== '') L('lib_approvals').cancel(ctx, rec.getString('approval'), 'Withdrawn');
  const fresh = app.findRecordById('timesheets', rec.id);
  if (fresh.getString('status') !== 'draft') {
    fresh.set('status', 'draft');
    app.save(fresh);
  }
  L('lib_audit').note(ctx, { collection: 'timesheets', record: rec.id, summary: 'Withdrew the timesheet for the week of ' + rec.getString('period_start') });
  return { timesheet: sheetView(app, sf.m, sf.week) };
}

function reopen(ctx, p) {
  const util = u();
  const t = T();
  const app = ctx.app;
  const sf = sheetFor(ctx, p);
  const a = t.access(ctx, sf.m);
  if (['full', 'edit'].indexOf(a) < 0) throw util.fail(403, 'HR (edit access to Time) reopens an approved timesheet.', 'not_permitted');
  const rec = util.findOne(app, 'timesheets', 'employment = {:e} && period_start = {:f}', { e: sf.m.id, f: periodFor(t.resolver(app), sf.m.id, sf.week).from });
  if (rec === null || rec.getString('status') !== 'approved') throw util.fail(409, 'Only an approved timesheet can be reopened.', 'conflict');
  if (rec.getBool('locked')) throw util.fail(409, 'This week was paid in a locked pay run.', 'locked');
  rec.set('status', 'draft');
  rec.set('decided_note', util.text(p, 'note', 2000, ''));
  app.save(rec);
  L('lib_audit').note(ctx, { collection: 'timesheets', record: rec.id, summary: 'Reopened the timesheet of ' + sf.m.getString('number') + ' for the week of ' + rec.getString('period_start') });
  return { timesheet: sheetView(app, sf.m, sf.week) };
}

/** Approval subscriber (kind timesheet). */
function onDecision(ctx, approval, decision, note) {
  const util = u();
  const app = ctx.app;
  const rec = util.byId(app, 'timesheets', approval.ref_id);
  if (rec === null) return null;
  if (decision === 'approved') rec.set('status', 'approved');
  else if (decision === 'rejected') rec.set('status', 'rejected');
  else rec.set('status', 'draft');
  rec.set('decided_at', util.nowIso());
  rec.set('decided_note', util.clip(note || '', 2000));
  app.save(rec);
  return { status: rec.getString('status') };
}

/* --------------------------------------------------------------- review */

/** time.review: everyone's exceptions for a period (missed punches first), for HR and your AI agent. */
function review(ctx, p) {
  const util = u();
  const t = T();
  const app = ctx.app;
  const today = util.today(app);
  const from = util.day(p, 'from', util.dayAdd(today, -7));
  const to = util.day(p, 'to', util.dayAdd(today, -1) < from ? from : util.dayAdd(today, -1));
  if (to < from || util.daysBetween(from, to) > 62) throw util.fail(400, 'At most two months at a time.', 'invalid_param');
  const only = util
    .str(p, 'people', '')
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x !== '');
  const people = t.roster(ctx, from, to, { entity: util.str(p, 'entity', ''), team: util.bool(p, 'team', false), ids: only });
  const R = t.resolver(app);
  const out = [];
  const order = { missing_punch: 0, absent: 1, long_day: 2, edited: 3, outside_area: 4, rest_day_work: 5, holiday_work: 6, late: 7, early: 8, open: 9 };
  for (const person of people) {
    const att = fromAttendance(R, person.employment, from, to);
    const issues = att.exceptions.filter((x) => x.code !== 'open');
    if (issues.length === 0) continue;
    const zone = R.zone(person.employment, to);
    const enriched = issues.map((x) => {
      const d = att.days[x.day];
      const plan = t.planOf(R, person.employment, x.day);
      const out1 = { day: x.day, code: x.code, message: x.message, severity: x.severity, planned: plan.start !== '' ? plan.start + ' to ' + plan.end : '', worked_min: d ? d.worked : 0 };
      if (x.code === 'missing_punch' || x.code === 'outside_area' || x.code === 'long_day') out1.punches = util.findMany(app, 'checkins', 'employment = {:e} && day = {:d} && voided = false', 'at', 0, { e: person.employment, d: x.day }).map((r) => ({ id: r.id, kind: r.getString('kind'), time: t.localTime(zone, t.ms(r.getString('at'))), source: r.getString('source'), flagged: r.getBool('flagged') }));
      return out1;
    });
    enriched.sort((a, b) => (order[a.code] !== order[b.code] ? order[a.code] - order[b.code] : a.day < b.day ? -1 : 1));
    out.push({ employment: person.employment, number: person.number, name: person.name, issues: enriched, missing: enriched.filter((x) => x.code === 'missing_punch').length });
  }
  out.sort((a, b) => b.missing - a.missing || b.issues.length - a.issues.length);
  return { from: from, to: to, people: out, total: out.length };
}

const REVIEW_TRIGGERS = ['timesheet_review', 'timesheet_check'];

function reviewView(app, r) {
  const ag = L('lib_agent');
  let ask = ag.openView(r, REVIEW_TRIGGERS);
  if (ask === null) ask = ag.view(r, r.getString('source') === 'weekly' ? 'timesheet_check' : 'timesheet_review');
  return {
    id: r.id,
    entity: r.getString('entity'),
    entity_name: r.getString('entity_name'),
    from: r.getString('week_start'),
    to: r.getString('week_end'),
    team: r.getBool('team'),
    people: u().jsonOf(r, 'people', []) || [],
    missing_punch_days: r.getInt('missing_punch_days'),
    note: r.getString('note'),
    source: r.getString('source'),
    status: r.getString('status'),
    result: u().jsonOf(r, 'result', null),
    done_at: r.getString('done_at'),
    asked_by: r.getString('asked_by'),
    asked_by_name: r.getString('asked_by_name'),
    agent: ask,
    created: r.getString('created'),
  };
}

function reviewRef(app, id) {
  const r = u().byId(app, 'timesheet_reviews', String(id || ''));
  if (r === null) throw u().fail(404, 'No timesheet check ' + id + '. Run timesheet-reviews.list.', 'not_found');
  return r;
}

/** Who may see or ask again: the person who asked, or Time edit rights on its entity (any entity when it covers all). */
function mayAskReview(ctx, r) {
  if (ctx.isAgent) return;
  if (r.getString('asked_by') !== '' && r.getString('asked_by') === ctx.memberId) return;
  const auth = L('lib_auth');
  if (!auth.can(ctx, 'time', 'edit') || (r.getString('entity') !== '' && !auth.inScope(ctx, r.getString('entity')))) throw u().fail(403, 'Only the person who asked, or Time editors of the entity, can do this.', 'not_permitted');
}

/** timesheet-reviews.list: the latest checks of your AI agent the caller may see. */
function reviewList(ctx, p) {
  const util = u();
  const rows = util.findMany(ctx.app, 'timesheet_reviews', '1=1', '-created', util.int(p, 'limit', 10, 1, 100), {});
  const out = [];
  for (const r of rows) {
    try {
      mayAskReview(ctx, r);
      out.push(reviewView(ctx.app, r));
    } catch {
      /* not the caller's */
    }
  }
  return { reviews: out };
}

/** timesheet-reviews.get: one check (the week, the entity or the people, the person's note, the result). */
function reviewGet(ctx, p) {
  const r = reviewRef(ctx.app, u().req(p, 'review'));
  mayAskReview(ctx, r);
  return { review: reviewView(ctx.app, r) };
}

/** timesheet-reviews.done (your AI agent): what it proposed and found; closes the ask and tells who asked. */
function reviewDone(ctx, p) {
  const util = u();
  if (!ctx.isAgent) throw util.fail(403, 'timesheet-reviews.done is for your AI agent.', 'not_permitted');
  const r = reviewRef(ctx.app, util.req(p, 'review'));
  if (r.getString('status') !== 'asked') throw util.fail(409, 'This check is already ' + r.getString('status') + '.', 'conflict');
  const note = util.text(p, 'note', 2000, '');
  if (util.squash(note) === '') throw util.fail(400, 'note: one line for HR on what you checked and found.', 'missing_param', { param: 'note' });
  const anomalies = (util.list(p, 'anomalies') || []).slice(0, 200).map((x) => ({ employment: util.clip(String((x && x.employment) || ''), 30), day: util.clip(String((x && x.day) || ''), 10), note: util.clip(util.squash(String((x && x.note) || '')), 300) }));
  const proposals = (util.list(p, 'proposals') || []).slice(0, 200).map((x) => util.clip(String(x || ''), 30));
  r.set('status', 'done');
  r.set('done_at', util.nowIso());
  r.set('result', { note: note, people: util.int(p, 'people', 0, 0, 100000), proposals: proposals, anomalies: anomalies });
  ctx.app.save(r);
  for (const t of REVIEW_TRIGGERS) L('lib_agent').end(ctx.app, ctx.app.findRecordById('timesheet_reviews', r.id), t, 'done', note);
  const title = 'Your AI agent checked the timesheets of ' + (r.getString('team') ? 'your team' : r.getString('entity_name') || 'every entity') + ' for the week of ' + r.getString('week_start');
  if (r.getString('asked_by') !== '') L('lib_notify').notify(ctx.app, [r.getString('asked_by')], { kind: 'agent', title: title, body: util.clip(note, 600), link: '#/time/timesheets' });
  else L('lib_notify').toRole(ctx.app, 'hr_admin', { kind: 'agent', title: title, body: util.clip(note, 600), link: '#/time/timesheets' });
  L('lib_audit').note(ctx, { collection: 'timesheet_reviews', record: r.id, summary: title + ': ' + util.clip(note, 160) });
  return { review: reviewView(ctx.app, ctx.app.findRecordById('timesheet_reviews', r.id)) };
}

/**
 * timesheets.review-ask: ask your AI agent to check a week's timesheets and
 * propose fixes (a timesheet_reviews record, and the timesheet_review
 * trigger with its id). Time editors ask for an entity or every entity they
 * cover; a manager without time edit (or anyone with --team) asks for their
 * own team only, and the check names those people.
 */
function reviewAsk(ctx, p) {
  const util = u();
  const app = ctx.app;
  const auth = L('lib_auth');
  const rules = L('lib_time_rules');
  const entity = util.str(p, 'entity', '');
  let ent = entity !== '' ? L('lib_org').entityRef(app, entity) : null;
  if (ent !== null && !auth.inScope(ctx, ent.id)) throw util.fail(403, 'This entity is outside your scope.', 'not_permitted');
  const editor = auth.can(ctx, 'time', 'edit');
  const team = !editor || util.bool(p, 'team', false);
  if (team && (!ctx.teamScope || ctx.employeeId === '')) throw util.fail(403, 'Asking your AI agent to check timesheets needs edit access to Time, or being a manager (it then checks your own team).', 'not_permitted');
  if (!team && ent === null) {
    const sc = auth.scope(ctx);
    if (sc.length === 1) ent = app.findRecordById('entities', sc[0]);
    else if (sc.length > 1) throw util.fail(400, 'Pick the entity to check (your role covers only some entities).', 'missing_param', { param: 'entity' });
  }
  const ws = ent ? ent.getInt('week_start') : 1;
  const today = util.today(app, ent ? ent.id : undefined);
  const ref = util.day(p, 'week', util.dayAdd(today, -7));
  const from = rules.weekStartOf(ref, ws);
  const to = util.dayAdd(from, 6);
  let people = [];
  if (team) {
    people = T().roster(ctx, from, to, { entity: ent ? ent.id : '', team: true }).map((x) => x.employment);
    if (people.length === 0) throw util.fail(409, 'No one in your team works in that week.', 'nothing_to_check', { from: from });
  }
  const whose = team ? 'your team (' + people.length + (people.length === 1 ? ' person' : ' people') + ')' : ent ? ent.getString('name') : 'every entity';
  const r = util.newRecord(app, 'timesheet_reviews');
  r.set('entity', ent ? ent.id : '');
  r.set('entity_name', ent ? ent.getString('name') : '');
  r.set('week_start', from);
  r.set('week_end', to);
  r.set('team', team);
  r.set('people', people);
  r.set('note', util.text(p, 'note', 1000, ''));
  r.set('source', 'person');
  r.set('status', 'asked');
  r.set('asked_by', ctx.memberId || '');
  r.set('asked_by_name', ctx.name || '');
  r.set('agent_asks', {});
  app.save(r);
  const a = L('lib_agent').ask(ctx, r, 'timesheet_review', { note: r.getString('note'), defer: true });
  L('lib_audit').note(ctx, { collection: 'timesheet_reviews', record: r.id, summary: 'Asked your AI agent to check the timesheets of ' + whose + ' for the week of ' + from, after: { trigger: 'timesheet_review', request: a.request } });
  return { review: reviewView(app, app.findRecordById('timesheet_reviews', r.id)), asked: a.asked };
}

/**
 * Cron (hourly), only when the company switched the Weekly timesheet check
 * on: on each entity's first workweek day at 07:00 local, last week of that
 * entity goes to your AI agent when it has missed punches (one
 * timesheet_reviews record and one timesheet_check ask per entity and week).
 */
function cronReview(app) {
  const util = u();
  const rules = L('lib_time_rules');
  if (!L('lib_agent').autoOn(app, 'weekly_timesheet_check')) return 0;
  let n = 0;
  for (const ent of util.findMany(app, 'entities', 'active = true', 'created')) {
    const now = util.localNow(app, ent.id);
    if (now.weekday !== ent.getInt('week_start') || now.hour !== 7) continue;
    const from = rules.weekStartOf(util.dayAdd(now.day, -7), ent.getInt('week_start'));
    const to = util.dayAdd(from, 6);
    const broken = util.count(app, "SELECT COUNT(*) AS n FROM attendance a JOIN employments m ON m.id = a.employment WHERE m.entity = {:e} AND a.day >= {:f} AND a.day <= {:t} AND (a.flags LIKE '%missed_in%' OR a.flags LIKE '%missed_out%')", { e: ent.id, f: from, t: to });
    if (broken === 0) continue;
    if (util.findOne(app, 'timesheet_reviews', "entity = {:e} && week_start = {:f} && source = 'weekly'", { e: ent.id, f: from }) !== null) continue;
    const r = util.newRecord(app, 'timesheet_reviews');
    r.set('entity', ent.id);
    r.set('entity_name', ent.getString('name'));
    r.set('week_start', from);
    r.set('week_end', to);
    r.set('team', false);
    r.set('people', []);
    r.set('missing_punch_days', broken);
    r.set('source', 'weekly');
    r.set('status', 'asked');
    r.set('agent_asks', {});
    app.save(r);
    L('lib_agent').ask(app, r, 'timesheet_check', { source: 'weekly_timesheet_check', defer: true });
    n++;
  }
  return n;
}

/** time.payroll-check: hours for payroll per person for a period, with the issues to fix first. */
function payrollCheck(ctx, p) {
  const util = u();
  const t = T();
  const app = ctx.app;
  const entity = util.str(p, 'entity', '');
  if (entity === '') throw util.fail(400, 'entity is required (pay runs are per entity).', 'missing_param', { param: 'entity' });
  const ent = L('lib_org').entityRef(app, entity);
  const today = util.today(app, ent.id);
  const from = util.day(p, 'from', t.monthStart(today));
  const to = util.day(p, 'to', util.monthEnd(from));
  if (to < from || util.daysBetween(from, to) > 62) throw util.fail(400, 'At most two months at a time.', 'invalid_param');
  const people = t.roster(ctx, from, to, { entity: ent.id });
  const rows = [];
  const totals = { people: 0, worked_minutes: 0, overtime_minutes: 0, blockers: 0, warnings: 0 };
  for (const person of people) {
    const pi = t.payInputs(app, person.employment, from, to);
    const ot = pi.overtime.filter((x) => x.multiplier >= 1).reduce((s, x) => s + x.minutes, 0);
    rows.push({ employment: person.employment, number: person.number, name: person.name, worked_minutes: pi.worked_minutes, regular_minutes: pi.regular_minutes, overtime_minutes: ot, overtime: pi.overtime, absent_days: pi.absent_days, late_minutes: pi.late_minutes, night_minutes: pi.night_minutes, holiday_worked_minutes: pi.holiday_worked_minutes, issues: pi.issues.filter((x) => x.code !== 'period_open') });
    totals.people++;
    totals.worked_minutes += pi.worked_minutes;
    totals.overtime_minutes += ot;
    for (const i of pi.issues) {
      if (i.code === 'period_open') continue;
      if (i.severity === 'blocker') totals.blockers++;
      else totals.warnings++;
    }
  }
  rows.sort((a, b) => b.issues.length - a.issues.length || (a.name < b.name ? -1 : 1));
  return { entity: { id: ent.id, name: ent.getString('name') }, from: from, to: to, open: to > today, people: rows, totals: totals };
}

function payInputsOp(ctx, p) {
  const util = u();
  const t = T();
  const m = t.employmentFor(ctx, util.req(p, 'employment'));
  const today = t.resolver(ctx.app).today(m.id);
  const from = util.day(p, 'from', t.monthStart(today));
  const to = util.day(p, 'to', util.monthEnd(from));
  return Object.assign({ employment: m.id, from: from, to: to }, t.payInputsDetail(ctx.app, m.id, from, to));
}

module.exports = {
  mayAskReview: mayAskReview,
  reviewList: reviewList,
  reviewGet: reviewGet,
  reviewDone: reviewDone,
  ENTRY_KINDS: ENTRY_KINDS,
  fromAttendance: fromAttendance,
  sheetView: sheetView,
  sheetMine: sheetMine,
  sheetGet: sheetGet,
  sheetList: sheetList,
  saveEntries: saveEntries,
  previewSaveEntries: previewSaveEntries,
  submit: submit,
  withdraw: withdraw,
  reopen: reopen,
  onDecision: onDecision,
  review: review,
  reviewAsk: reviewAsk,
  cronReview: cronReview,
  payrollCheck: payrollCheck,
  payInputsOp: payInputsOp,
};
