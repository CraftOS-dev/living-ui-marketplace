/// <reference path="../pb_data/types.d.ts" />
/**
 * Attendance: the live board (who is in, on a break, out, late, absent, on
 * leave, remote, by location and team), the month grid per person, one
 * day in detail, marking by hand (one person or many at once, the employee
 * attendance tool), going back to auto, processing on demand, CSV export,
 * and attendance requests (missed punch, correction, work from home, on
 * duty) decided as approvals of kind attendance_request.
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

const STATUSES = ['present', 'absent', 'half_day', 'on_leave', 'holiday', 'weekly_off', 'remote', 'on_duty'];
const MARKABLE = ['present', 'absent', 'half_day', 'remote', 'on_duty', 'holiday', 'weekly_off'];
const CODE = { present: 'P', absent: 'A', half_day: 'HD', on_leave: 'L', holiday: 'H', weekly_off: 'O', remote: 'R', on_duty: 'D' };
const REQ_KINDS = ['missed_punch', 'correction', 'remote', 'on_duty'];
const REQ_LABEL = { missed_punch: 'Missed punch', correction: 'Correction', remote: 'Work from home', on_duty: 'On duty' };

function inList(ids, bind, prefix) {
  return '(' + ids.map((id, i) => ((bind[prefix + i] = id), '{:' + prefix + i + '}')).join(',') + ')';
}

/* --------------------------------------------------------------- board */

/** attendance.board: one day (today by default) by person, with readouts by location and team. */
function board(ctx, p) {
  const util = u();
  const t = T();
  const app = ctx.app;
  const entity = util.str(p, 'entity', '');
  const entityId = entity !== '' ? L('lib_org').entityRef(app, entity).id : '';
  const today = util.today(app, entityId || undefined);
  const day = util.day(p, 'day', today);
  const people = t.roster(ctx, day, day, { entity: entityId, location: util.str(p, 'location', ''), department: util.str(p, 'department', ''), team: util.bool(p, 'team', false) });
  const R = t.resolver(app);
  const now = Date.now();
  const rows = [];
  const atts = {};
  const punches = {};
  let states = {};
  if (people.length > 0) {
    // Everyone's plan data, the day's attendance, punches and clock states, read together.
    const ids = people.map((x) => x.employment);
    R.preloadPlans(ids, day, day);
    for (const r of t.recordsIn(app, 'attendance', 'employment', ids, 'day = {:d}', { d: day }, 'id ASC')) atts[r.getString('employment')] = r;
    for (const r of t.recordsIn(app, 'checkins', 'employment', ids, 'voided = FALSE AND day >= {:y} AND day <= {:d}', { d: day, y: util.dayAdd(day, -1) }, 'at ASC')) {
      const k = r.getString('employment');
      if (punches[k] === undefined) punches[k] = [];
      punches[k].push(r);
    }
    if (day === today) states = t.clockStates(app, ids);
  }
  for (const person of people) {
    const id = person.employment;
    const plan = t.planOf(R, id, day);
    if (plan.kind === 'outside') continue;
    const zone = plan.zone;
    const lv = R.leaveOn(id, day);
    const att = atts[id] || null;
    const rs = R.ruleSet(id, day);
    const mine = (punches[id] || []).filter((r) => r.getString('day') === day);
    const firstIn = mine.filter((r) => r.getString('kind') === 'in')[0] || null;
    const lastOut = mine.filter((r) => r.getString('kind') === 'out').slice(-1)[0] || null;
    const startAt = plan.start !== '' ? util.utcOf(zone, day, plan.start) : null;
    const endAt = plan.end !== '' ? util.utcOf(zone, plan.overnight ? util.dayAdd(day, 1) : day, plan.end) : null;
    const lateBy = firstIn !== null && startAt !== null && !plan.flexible ? Math.round((t.ms(firstIn.getString('at')) - startAt) / 60000) : 0;
    let state = '';
    let over = false;
    let late = lateBy > plan.grace_in ? lateBy : 0;
    if ((att !== null && att.getString('status') === 'on_leave') || (lv !== null && !lv.half && !(lv.hours > 0))) state = 'on_leave';
    else if (att !== null && (att.getString('status') === 'remote' || att.getString('status') === 'on_duty') && att.getString('source') !== 'auto') state = att.getString('status') === 'remote' ? 'remote' : 'on_duty';
    else if (day === today) {
      const st = states[id];
      if (st.state === 'in') state = 'in';
      else if (st.state === 'break') state = 'break';
      else if (mine.length > 0) state = 'out';
      else if (plan.kind !== 'work') state = 'off';
      else if (att !== null && att.getString('source') !== 'auto') state = att.getString('status') === 'absent' ? 'absent' : att.getString('status') === 'present' ? 'out' : att.getString('status');
      else if (rs.settings.tracking === 'exception') {
        state = startAt !== null && now < startAt ? 'expected' : 'untracked';
        over = state === 'untracked' && endAt !== null && now > endAt;
      }
      else if (startAt === null || now < startAt + plan.grace_in * 60000) state = 'expected';
      else if (endAt !== null && now > endAt) state = 'absent';
      else {
        state = 'late';
        late = Math.round((now - startAt) / 60000);
      }
    } else if (att !== null) {
      const s = att.getString('status');
      state = s === 'present' || s === 'half_day' ? 'out' : s === 'weekly_off' || s === 'holiday' ? 'off' : s;
      late = att.getInt('late_min');
    } else state = plan.kind !== 'work' ? 'off' : day > today ? 'expected' : 'none';
    const flagged = mine.some((r) => r.getBool('flagged'));
    rows.push({
      employment: id,
      employee: person.employee,
      number: person.number,
      name: person.name,
      title: person.title,
      entity: person.entity,
      location: plan.location || person.location,
      location_name: (R.location(plan.location) && R.location(plan.location).getString('name')) || person.location_name,
      department: person.department,
      department_name: person.department_name,
      state: state,
      late_min: late,
      first_in_time: firstIn !== null ? t.localTime(zone, t.ms(firstIn.getString('at'))) : '',
      last_out_time: lastOut !== null ? t.localTime(zone, t.ms(lastOut.getString('at'))) : '',
      shift: plan.kind === 'work' || plan.source === 'shift' ? { name: plan.shift_name, start: plan.start, end: plan.end, source: plan.source } : null,
      holiday: plan.holiday ? plan.holiday.name : '',
      leave: lv !== null ? { type: lv.type, name: lv.name, half: lv.half } : null,
      worked_min: att !== null ? att.getInt('worked_min') : 0,
      flagged: flagged,
      flags: att !== null ? util.jsonOf(att, 'flags', []) || [] : [],
      tracking: rs.settings.tracking,
      shift_over: over,
    });
  }
  const count = (list) => {
    const c = { in: 0, break: 0, out: 0, late: 0, absent: 0, on_leave: 0, remote: 0, expected: 0, off: 0, untracked: 0, over: 0, scheduled: 0 };
    for (const r of list) {
      if (r.state === 'in' || r.state === 'break') c.in++;
      if (r.state === 'break') c.break++;
      if (r.state === 'out') c.out++;
      if (r.state === 'late' || r.late_min > 0) c.late++;
      if (r.state === 'absent') c.absent++;
      if (r.state === 'on_leave') c.on_leave++;
      if (r.state === 'remote' || r.state === 'on_duty') c.remote++;
      if (r.state === 'expected') c.expected++;
      if (r.state === 'off') c.off++;
      if (r.state === 'untracked' && !r.shift_over) c.untracked++;
      if (r.state === 'untracked' && r.shift_over) c.over++;
      if (r.shift !== null && r.state !== 'off' && r.state !== 'on_leave') c.scheduled++;
    }
    return c;
  };
  const groupBy = (key, nameKey) => {
    const g = {};
    for (const r of rows) {
      const k = r[key] || '';
      if (g[k] === undefined) g[k] = { id: k, name: r[nameKey] || '', rows: [] };
      g[k].rows.push(r);
    }
    return Object.keys(g)
      .map((k) => ({ id: g[k].id, name: g[k].name, people: g[k].rows.length, counts: count(g[k].rows) }))
      .sort((a, b) => (a.name < b.name ? -1 : 1));
  };
  const order = { late: 0, absent: 1, in: 2, break: 3, expected: 4, untracked: 5, out: 6, remote: 7, on_duty: 7, on_leave: 8, off: 9, none: 10 };
  rows.sort((a, b) => (order[a.state] !== order[b.state] ? (order[a.state] || 0) - (order[b.state] || 0) : a.name < b.name ? -1 : 1));
  return { day: day, today: today, is_today: day === today, readouts: count(rows), by_location: groupBy('location', 'location_name'), by_department: groupBy('department', 'department_name'), people: rows };
}

/* --------------------------------------------------------------- month */

function monthRange(p, today) {
  const util = u();
  const m = util.str(p, 'month', '') || today.slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw util.fail(400, 'month is YYYY-MM, e.g. 2026-11.', 'invalid_param', { param: 'month' });
  const from = m + '-01';
  return { month: m, from: from, to: util.monthEnd(from) };
}

/** attendance.month: the month grid, one person (--employment) or everyone the caller sees (filters). */
function month(ctx, p) {
  const util = u();
  const t = T();
  const app = ctx.app;
  const today = util.today(app);
  const mr = monthRange(p, today);
  let people;
  if (util.str(p, 'employment', '') !== '') {
    const m = t.employmentFor(ctx, util.str(p, 'employment', ''));
    const e = app.findRecordById('employees', m.getString('employee'));
    people = [{ employment: m.id, employee: e.id, number: e.getString('number'), name: L('lib_people').displayName(e), entity: m.getString('entity'), title: '', location_name: '', department_name: '' }];
  } else people = t.roster(ctx, mr.from, mr.to, { entity: util.str(p, 'entity', ''), location: util.str(p, 'location', ''), department: util.str(p, 'department', ''), team: util.bool(p, 'team', false), day: mr.to < today ? mr.to : today });
  const pg = util.page(p, 100, 500);
  const total = people.length;
  people = people.slice(pg.offset, pg.offset + pg.limit);
  const R = t.resolver(app);
  const days = [];
  for (let d = mr.from; d <= mr.to; d = util.dayAdd(d, 1)) days.push(d);
  const rows = [];
  const byEmp = {};
  if (people.length > 0) {
    const bind = { f: mr.from, t: mr.to };
    const keys = inList(
      people.map((x) => x.employment),
      bind,
      'e',
    );
    for (const x of util.rows(app, 'SELECT id, employment FROM attendance WHERE day >= {:f} AND day <= {:t} AND employment IN ' + keys, { id: '', employment: '' }, bind)) {
      const r = app.findRecordById('attendance', x.id);
      if (byEmp[x.employment] === undefined) byEmp[x.employment] = {};
      byEmp[x.employment][r.getString('day')] = r;
    }
  }
  for (const person of people) {
    const id = person.employment;
    R.loadAssignments(id, mr.from, mr.to);
    R.loadLeave(id, mr.from, mr.to);
    const cells = {};
    const tot = { present: 0, absent: 0, half_day: 0, late: 0, leave: 0, remote: 0, worked_min: 0, overtime_min: 0, missing: 0 };
    for (const d of days) {
      const r = (byEmp[id] || {})[d];
      if (r !== undefined) {
        const s = r.getString('status');
        const flags = util.jsonOf(r, 'flags', []) || [];
        cells[d] = { status: s, code: CODE[s] || '', worked_min: r.getInt('worked_min'), late_min: r.getInt('late_min'), overtime_min: r.getInt('overtime_min'), source: r.getString('source'), locked: r.getBool('locked'), flags: flags, leave_type: r.getString('leave_type') };
        if (s === 'present' || s === 'on_duty') tot.present++;
        if (s === 'absent') tot.absent++;
        if (s === 'half_day') tot.half_day++;
        if (s === 'on_leave') tot.leave++;
        if (s === 'remote') tot.remote++;
        if (r.getInt('late_min') > 0) tot.late++;
        if (flags.indexOf('missed_in') >= 0 || flags.indexOf('missed_out') >= 0) tot.missing++;
        tot.worked_min += r.getInt('worked_min');
        tot.overtime_min += r.getInt('overtime_min');
        continue;
      }
      const plan = t.planOf(R, id, d);
      if (plan.kind === 'outside') {
        cells[d] = { status: 'outside', code: '' };
        continue;
      }
      const lv = R.leaveOn(id, d);
      cells[d] = { status: '', code: '', planned: lv !== null ? 'leave' : plan.kind === 'holiday' ? 'holiday' : plan.kind === 'rest' ? 'off' : plan.source === 'shift' ? 'shift' : 'work', shift_code: plan.shift_code, future: d > today };
    }
    rows.push(Object.assign({}, person, { cells: cells, totals: tot }));
  }
  return { month: mr.month, from: mr.from, to: mr.to, days: days, people: rows, total: total, limit: pg.limit, offset: pg.offset, codes: CODE };
}

/* ----------------------------------------------------------------- day */

function dayGet(ctx, p) {
  const util = u();
  const t = T();
  const app = ctx.app;
  const m = t.employmentFor(ctx, util.str(p, 'employment', ''));
  const R = t.resolver(app);
  const day = util.day(p, 'day', R.today(m.id));
  const plan = t.planOf(R, m.id, day);
  const zone = plan.zone;
  const att = util.findOne(app, 'attendance', 'employment = {:e} && day = {:d}', { e: m.id, d: day });
  const punches = util.findMany(app, 'checkins', 'employment = {:e} && day = {:d}', 'at,created', 0, { e: m.id, d: day }).map((r) => t.checkinView(r, zone));
  const requests = util.findMany(app, 'attendance_requests', 'employment = {:e} && from_day <= {:d} && (to_day >= {:d} || (to_day = "" && from_day = {:d}))', '-created', 20, { e: m.id, d: day }).map((r) => requestView(app, r));
  const a = t.access(ctx, m);
  const emp = app.findRecordById('employees', m.getString('employee'));
  return {
    employment: m.id,
    employee: { id: emp.id, number: emp.getString('number'), name: L('lib_people').displayName(emp) },
    day: day,
    plan: { kind: plan.kind, source: plan.source, shift_name: plan.shift_name, start: plan.start, end: plan.end, expected_min: plan.expected_min, holiday: plan.holiday, location: plan.location },
    leave: R.leaveOn(m.id, day),
    attendance: att !== null ? t.attendanceView(att, zone) : null,
    punches: punches,
    requests: requests,
    can: { edit: ['full', 'edit', 'team', 'agent', 'system'].indexOf(a) >= 0, request: a === 'self' || ['full', 'edit'].indexOf(a) >= 0 },
  };
}

function list(ctx, p) {
  const util = u();
  const t = T();
  const app = ctx.app;
  const today = util.today(app);
  const from = util.day(p, 'from', util.dayAdd(today, -30));
  const to = util.day(p, 'to', today);
  if (to < from || util.daysBetween(from, to) > 400) throw util.fail(400, 'from to to is at most about a year.', 'invalid_param');
  let people;
  if (util.str(p, 'employment', '') !== '') {
    const m = t.employmentFor(ctx, util.str(p, 'employment', ''));
    const e = app.findRecordById('employees', m.getString('employee'));
    people = [{ employment: m.id, number: e.getString('number'), name: L('lib_people').displayName(e) }];
  } else people = t.roster(ctx, from, to, { entity: util.str(p, 'entity', ''), location: util.str(p, 'location', ''), department: util.str(p, 'department', ''), team: util.bool(p, 'team', false) });
  if (people.length === 0) return { rows: [], total: 0 };
  const names = {};
  for (const x of people) names[x.employment] = x;
  const bind = { f: from, t: to };
  const where = ['day >= {:f}', 'day <= {:t}', 'employment IN ' + inList(Object.keys(names), bind, 'e')];
  const st = util.str(p, 'status', '');
  if (st !== '') {
    if (STATUSES.indexOf(st) < 0) throw util.fail(400, 'status is one of ' + STATUSES.join(', '), 'invalid_param');
    where.push('status = {:s}');
    bind.s = st;
  }
  if (util.bool(p, 'late', false)) where.push('late_min > 0');
  if (util.bool(p, 'issues', false)) where.push("(flags LIKE '%missed%' OR flags LIKE '%outside_geofence%')");
  const pg = util.page(p, 100, 2000);
  const w = where.join(' AND ');
  const total = util.count(app, 'SELECT COUNT(*) AS n FROM attendance WHERE ' + w, bind);
  const R = t.resolver(app);
  const rows = util.rows(app, 'SELECT id FROM attendance WHERE ' + w + ' ORDER BY day DESC, employment LIMIT ' + pg.limit + ' OFFSET ' + pg.offset, { id: '' }, bind).map((x) => {
    const r = app.findRecordById('attendance', x.id);
    const v = t.attendanceView(r, R.zone(r.getString('employment'), r.getString('day')));
    v.name = names[v.employment].name;
    v.number = names[v.employment].number;
    return v;
  });
  return { rows: rows, total: total, limit: pg.limit, offset: pg.offset, from: from, to: to };
}

function exportCsv(ctx, p) {
  const util = u();
  const out = list(ctx, Object.assign({}, p, { limit: 2000, offset: 0 }));
  const lines = [['number', 'name', 'day', 'status', 'first_in', 'last_out', 'worked_min', 'break_min', 'late_min', 'early_min', 'overtime_min', 'night_min', 'leave_type', 'source', 'locked', 'flags', 'note']];
  for (const r of out.rows) lines.push([r.number, r.name, r.day, r.status, r.first_in_time, r.last_out_time, r.worked_min, r.break_min, r.late_min, r.early_min, r.overtime_min, r.night_min, r.leave_type, r.source, r.locked ? 'yes' : 'no', (r.flags || []).join(' '), r.note]);
  L('lib_audit').note(ctx, { collection: 'attendance', summary: 'Exported ' + out.rows.length + ' attendance rows (' + out.from + ' to ' + out.to + ')' });
  return { csv: util.csvText(lines), filename: 'attendance-' + out.from + '-to-' + out.to + '.csv', rows: out.rows.length, total: out.total };
}

/* -------------------------------------------------------------- marking */

const LOCKED_MSG = 'This day was paid in a locked pay run, so its figures cannot be edited by hand. File an attendance request for it instead (a missed punch, a correction, work from home or on duty): once it is approved, the difference goes to the next pay run.';

/**
 * Save a day set by a person (source manual) or a decision (source request).
 * On a day a locked pay run used, a decision is a fact and is recorded beside
 * what was paid (the difference goes to the next run); a hand edit is refused.
 */
function saveAs(app, empId, day, v, source, note, memberId) {
  const util = u();
  let rec = util.findOne(app, 'attendance', 'employment = {:e} && day = {:d}', { e: empId, d: day });
  if (rec !== null && rec.getBool('locked')) {
    if (source !== 'request') throw util.fail(409, LOCKED_MSG, 'day_locked', { day: day });
    T().noteAfterLock(app, rec, v, 'request');
    return { rec: rec, before: T().attendanceView(rec, 'UTC'), after_lock: true };
  }
  const before = rec !== null ? T().attendanceView(rec, 'UTC') : null;
  if (rec === null) {
    rec = util.newRecord(app, 'attendance');
    rec.set('employment', empId);
    rec.set('day', day);
  }
  for (const k of Object.keys(v)) rec.set(k, v[k]);
  rec.set('source', source);
  rec.set('note', util.clip(note || '', 1000));
  if (memberId) rec.set('by_member', memberId);
  rec.set('computed_at', util.nowIso());
  app.save(rec);
  return { rec: rec, before: before };
}

/** Values for a day marked with a status (and optional local times). */
function markedValues(R, empId, day, status, inTime, outTime, breakMin) {
  const util = u();
  const t = T();
  const plan = t.planOf(R, empId, day);
  if (plan.kind === 'outside') throw util.fail(400, 'This person is not employed on that day.', 'invalid_param', { day: day });
  const zone = plan.zone;
  const v = { status: status, day_kind: plan.kind, shift_type: plan.shift_type, expected_min: plan.expected_min, first_in: '', last_out: '', worked_min: 0, break_min: 0, late_min: 0, early_min: 0, overtime_min: 0, night_min: 0, leave_type: '', leave_half: '', leave_min: 0, flags: ['marked'] };
  if (inTime && outTime) {
    const a = util.utcOf(zone, day, inTime);
    let b = util.utcOf(zone, day, outTime);
    if (b <= a) b = util.utcOf(zone, util.dayAdd(day, 1), outTime);
    const brk = breakMin === null || breakMin === undefined ? (b - a > 360 * 60000 ? plan.break_min : 0) : breakMin;
    v.first_in = t.iso(a);
    v.last_out = t.iso(b);
    v.break_min = brk;
    v.worked_min = Math.max(0, Math.round((b - a) / 60000) - brk);
    const rs = R.ruleSet(empId, day);
    v.night_min = t.nightMinutes([[a, b]], L('lib_time_rules').nightWindow(rs.rules), zone, day);
    if (plan.start !== '' && !plan.flexible && plan.kind === 'work') {
      const s = util.utcOf(zone, day, plan.start);
      if (a - s > plan.grace_in * 60000) v.late_min = Math.round((a - s) / 60000);
      const e = util.utcOf(zone, plan.overnight ? util.dayAdd(day, 1) : day, plan.end);
      if (e - b > plan.grace_out * 60000) v.early_min = Math.round((e - b) / 60000);
    }
  } else if (status === 'present' || status === 'remote' || status === 'on_duty') v.worked_min = plan.expected_min || plan.normal_min;
  else if (status === 'half_day') v.worked_min = Math.round((plan.expected_min || plan.normal_min) / 2);
  v.overtime_min = plan.kind === 'work' ? Math.max(0, v.worked_min - v.expected_min) : v.worked_min;
  return v;
}

function readTimes(p) {
  const util = u();
  const a = util.str(p, 'in_time', '');
  const b = util.str(p, 'out_time', '');
  if (a !== '' && !util.isTime(a)) throw util.fail(400, 'in_time is HH:MM.', 'invalid_param', { param: 'in_time' });
  if (b !== '' && !util.isTime(b)) throw util.fail(400, 'out_time is HH:MM.', 'invalid_param', { param: 'out_time' });
  if ((a === '') !== (b === '')) throw util.fail(400, 'Give both in_time and out_time, or neither.', 'invalid_param');
  return { in: a, out: b, brk: util.num(p, 'break_min', { whole: true, min: 0, max: 600 }) };
}

/** attendance.mark: set one day by hand (kept from then on; auto attendance never overwrites it). */
function mark(ctx, p) {
  const util = u();
  const t = T();
  const app = ctx.app;
  const m = L('lib_people').employmentRef(app, util.req(p, 'employment'));
  t.needEdit(ctx, m, 'mark this person\'s attendance');
  const day = util.day(p, 'day', '');
  if (day === '') throw util.fail(400, 'day is required.', 'missing_param', { param: 'day' });
  const status = util.oneOf(p, 'status', MARKABLE, '');
  if (status === '') throw util.fail(400, 'status is one of ' + MARKABLE.join(', '), 'missing_param', { param: 'status' });
  const note = util.text(p, 'note', 1000, '');
  if (note === '') throw util.fail(400, 'Say why in note.', 'missing_param', { param: 'note' });
  const tm = readTimes(p);
  const R = t.resolver(app);
  if (day > R.today(m.id) && status !== 'remote' && status !== 'on_duty') throw util.fail(400, 'Only work from home and on duty can be marked ahead of the day.', 'invalid_param');
  const v = markedValues(R, m.id, day, status, tm.in, tm.out, tm.brk);
  let res = null;
  app.runInTransaction((tx) => {
    res = saveAs(tx, m.id, day, v, 'manual', note, ctx.memberId);
  });
  const view = t.attendanceView(res.rec, R.zone(m.id, day));
  L('lib_audit').note(ctx, { collection: 'attendance', record: res.rec.id, summary: 'Marked ' + m.getString('number') + ' ' + status.replace('_', ' ') + ' on ' + day + ': ' + note, before: res.before, after: view });
  return { attendance: view };
}

function previewMark(ctx, p) {
  const util = u();
  const app = ctx.app;
  const m = L('lib_people').employmentRef(app, util.str(p, 'employment', ''));
  const emp = app.findRecordById('employees', m.getString('employee'));
  const day = util.str(p, 'day', '');
  const cur = util.findOne(app, 'attendance', 'employment = {:e} && day = {:d}', { e: m.id, d: day });
  const fields = [{ name: 'status on ' + day, before: cur ? cur.getString('status') : '', after: util.str(p, 'status', '') }];
  if (util.str(p, 'in_time', '') !== '') fields.push({ name: 'hours', before: cur ? T().attendanceView(cur, T().resolver(app).zone(m.id, day)).first_in_time + ' to ' + T().attendanceView(cur, T().resolver(app).zone(m.id, day)).last_out_time : '', after: util.str(p, 'in_time', '') + ' to ' + util.str(p, 'out_time', '') });
  return { label: 'Set the attendance of ' + L('lib_people').displayName(emp) + ' on ' + day, target: 'employments:' + m.id, fields: fields, notes: [util.str(p, 'note', '')].filter((x) => x !== ''), risk: cur && cur.getBool('locked') ? 'high' : 'low' };
}

/** attendance.mark-bulk: one status for many people on one or more days (the employee attendance tool). */
function markBulk(ctx, p) {
  const util = u();
  const t = T();
  const app = ctx.app;
  const people = L('lib_people');
  const refs = util.list(p, 'employments') || [];
  if (refs.length === 0) throw util.fail(400, 'employments is a JSON list, e.g. ["E0004","E0005"].', 'missing_param', { param: 'employments' });
  if (refs.length > 500) throw util.fail(400, 'At most 500 people at a time.', 'invalid_param');
  const from = util.day(p, 'from', util.day(p, 'day', ''));
  if (from === '') throw util.fail(400, 'day (or from and to) is required.', 'missing_param', { param: 'day' });
  const to = util.day(p, 'to', from);
  if (to < from || util.daysBetween(from, to) > 30) throw util.fail(400, 'At most 31 days at a time.', 'invalid_param');
  const status = util.oneOf(p, 'status', MARKABLE, '');
  if (status === '') throw util.fail(400, 'status is one of ' + MARKABLE.join(', '), 'missing_param', { param: 'status' });
  const note = util.text(p, 'note', 1000, '');
  if (note === '') throw util.fail(400, 'Say why in note.', 'missing_param', { param: 'note' });
  const R = t.resolver(app);
  const done = [];
  const skipped = [];
  app.runInTransaction((tx) => {
    const R2 = t.resolver(tx);
    for (const ref of refs) {
      const m = people.employmentRef(tx, String(ref));
      t.needEdit(ctx, m, 'mark this person\'s attendance');
      for (let d = from; d <= to; d = util.dayAdd(d, 1)) {
        if (d > R.today(m.id) && status !== 'remote' && status !== 'on_duty') {
          skipped.push({ employment: m.getString('number'), day: d, reason: 'future' });
          continue;
        }
        const plan = t.planOf(R2, m.id, d);
        if (plan.kind === 'outside') {
          skipped.push({ employment: m.getString('number'), day: d, reason: 'not employed' });
          continue;
        }
        const cur = util.findOne(tx, 'attendance', 'employment = {:e} && day = {:d}', { e: m.id, d: d });
        if (cur !== null && cur.getBool('locked')) {
          skipped.push({ employment: m.getString('number'), day: d, reason: 'paid in a locked pay run: file an attendance request for it' });
          continue;
        }
        saveAs(tx, m.id, d, markedValues(R2, m.id, d, status, '', '', null), 'manual', note, ctx.memberId);
        done.push({ employment: m.getString('number'), day: d });
      }
    }
  });
  L('lib_audit').note(ctx, { collection: 'attendance', summary: 'Marked ' + done.length + ' days ' + status.replace('_', ' ') + ' for ' + refs.length + ' people (' + from + (to !== from ? ' to ' + to : '') + '): ' + note });
  return { marked: done.length, skipped: skipped, status: status, from: from, to: to };
}

/** attendance.reset: drop a hand-set day and follow the punches again. */
function reset(ctx, p) {
  const util = u();
  const t = T();
  const app = ctx.app;
  const m = L('lib_people').employmentRef(app, util.req(p, 'employment'));
  t.needEdit(ctx, m, 'change this person\'s attendance');
  const day = util.day(p, 'day', '');
  if (day === '') throw util.fail(400, 'day is required.', 'missing_param', { param: 'day' });
  const cur = util.findOne(app, 'attendance', 'employment = {:e} && day = {:d}', { e: m.id, d: day });
  if (cur !== null && cur.getBool('locked')) throw util.fail(409, LOCKED_MSG, 'day_locked', { day: day });
  const before = cur !== null ? t.attendanceView(cur, 'UTC') : null;
  app.runInTransaction((tx) => {
    const c = util.findOne(tx, 'attendance', 'employment = {:e} && day = {:d}', { e: m.id, d: day });
    if (c !== null) tx.delete(c);
    t.processDay(tx, m.id, day);
  });
  const after = util.findOne(app, 'attendance', 'employment = {:e} && day = {:d}', { e: m.id, d: day });
  const view = after !== null ? t.attendanceView(after, t.resolver(app).zone(m.id, day)) : null;
  L('lib_audit').note(ctx, { collection: 'attendance', record: after ? after.id : '', summary: 'Set ' + m.getString('number') + ' on ' + day + ' back to auto attendance', before: before, after: view });
  return { attendance: view };
}

/** attendance.process: work out auto attendance now (one person, or everyone the caller may edit). */
function processOp(ctx, p) {
  const util = u();
  const t = T();
  const app = ctx.app;
  const today = util.today(app);
  const from = util.day(p, 'from', util.dayAdd(today, -1));
  const to = util.day(p, 'to', today);
  if (to < from || util.daysBetween(from, to) > 92) throw util.fail(400, 'At most three months at a time.', 'invalid_param');
  let ids = [];
  if (util.str(p, 'employment', '') !== '') {
    const m = L('lib_people').employmentRef(app, util.str(p, 'employment', ''));
    t.needEdit(ctx, m, 'process this person\'s attendance');
    ids = [m.id];
  } else ids = t.roster(ctx, from, to, { entity: util.str(p, 'entity', '') }).map((r) => r.employment);
  const sum = { people: 0, created: 0, updated: 0, removed: 0, kept: 0, same: 0, none: 0 };
  const R = t.resolver(app);
  for (const id of ids) {
    const r = t.processRange(app, id, from, to, R);
    sum.people++;
    for (const k of Object.keys(r)) sum[k] += r[k];
  }
  L('lib_audit').note(ctx, { collection: 'attendance', summary: 'Worked out attendance for ' + sum.people + ' people, ' + from + ' to ' + to + ' (' + sum.created + ' new, ' + sum.updated + ' changed)' });
  return Object.assign({ from: from, to: to }, sum);
}

/* ------------------------------------------------------------- requests */

function requestView(app, r) {
  const util = u();
  const m = util.byId(app, 'employments', r.getString('employment'));
  const e = m ? util.byId(app, 'employees', m.getString('employee')) : null;
  return {
    id: r.id,
    employment: r.getString('employment'),
    name: e ? L('lib_people').displayName(e) : '',
    number: e ? e.getString('number') : '',
    kind: r.getString('kind'),
    kind_label: REQ_LABEL[r.getString('kind')] || r.getString('kind'),
    from_day: r.getString('from_day'),
    to_day: r.getString('to_day') || r.getString('from_day'),
    half_day: r.getBool('half_day'),
    in_time: r.getString('in_time'),
    out_time: r.getString('out_time'),
    break_min: r.getInt('break_min'),
    reason: r.getString('reason'),
    status: r.getString('status'),
    approval: r.getString('approval'),
    decided_note: r.getString('decided_note'),
    created: r.getString('created'),
  };
}

/** attendance-requests.add: ask for a missed punch, a correction, work from home or on duty (an approval for the manager). */
function requestsAdd(ctx, p) {
  const util = u();
  const t = T();
  const app = ctx.app;
  const auth = L('lib_auth');
  let m;
  const ref = util.str(p, 'employment', '');
  if (ref !== '' && ctx.employeeId !== '' && L('lib_people').employmentRef(app, ref).getString('employee') !== ctx.employeeId) {
    m = L('lib_people').employmentRef(app, ref);
    if (!auth.can(ctx, 'time', 'edit') || !auth.inScope(ctx, m.getString('entity'))) throw util.fail(403, 'You can ask only for yourself (HR can ask for others).', 'not_permitted');
  } else if (ref !== '' && ctx.employeeId === '') {
    m = L('lib_people').employmentRef(app, ref);
    if (!auth.can(ctx, 'time', 'edit') || !auth.inScope(ctx, m.getString('entity'))) throw util.fail(403, 'You can ask only for yourself (HR can ask for others).', 'not_permitted');
  } else m = t.selfEmployment(ctx, ref);
  const kind = util.oneOf(p, 'kind', REQ_KINDS, '');
  if (kind === '') throw util.fail(400, 'kind is one of ' + REQ_KINDS.join(', '), 'missing_param', { param: 'kind' });
  const from = util.day(p, 'from_day', '');
  if (from === '') throw util.fail(400, 'from_day is required.', 'missing_param', { param: 'from_day' });
  const to = kind === 'missed_punch' || kind === 'correction' ? from : util.day(p, 'to_day', from);
  if (to < from || util.daysBetween(from, to) > 30) throw util.fail(400, 'A request covers at most 31 days.', 'invalid_param');
  const R = t.resolver(app);
  const today = R.today(m.id);
  if ((kind === 'missed_punch' || kind === 'correction') && from > today) throw util.fail(400, 'A punch fix is for a day that has started.', 'invalid_param');
  const tm = { in: util.str(p, 'in_time', ''), out: util.str(p, 'out_time', '') };
  for (const k of ['in_time', 'out_time']) if (util.str(p, k, '') !== '' && !util.isTime(util.str(p, k, ''))) throw util.fail(400, k + ' is HH:MM.', 'invalid_param', { param: k });
  if (kind === 'missed_punch' && tm.in === '' && tm.out === '') throw util.fail(400, 'Give the time you came in (in_time) or left (out_time).', 'missing_param', { param: 'in_time' });
  if (kind === 'correction' && (tm.in === '' || tm.out === '')) throw util.fail(400, 'A correction gives both in_time and out_time.', 'missing_param', { param: 'in_time' });
  const reason = util.text(p, 'reason', 2000, '');
  if (reason === '') throw util.fail(400, 'Say why in reason.', 'missing_param', { param: 'reason' });
  // Any day may be asked for: on a day a locked pay run used, the approved request is paid as an adjustment in the next run.
  const dup = util.findOne(app, 'attendance_requests', "employment = {:e} && status = 'pending' && kind = {:k} && from_day = {:f}", { e: m.id, k: kind, f: from });
  if (dup !== null) throw util.fail(409, 'You already asked for this; it waits for a decision.', 'duplicate', { request: dup.id });
  const rec = util.newRecord(app, 'attendance_requests');
  rec.set('employment', m.id);
  rec.set('kind', kind);
  rec.set('from_day', from);
  rec.set('to_day', to);
  rec.set('half_day', util.bool(p, 'half_day', false));
  rec.set('in_time', tm.in);
  rec.set('out_time', tm.out);
  rec.set('break_min', util.int(p, 'break_min', 0, 0, 600));
  rec.set('reason', reason);
  rec.set('status', 'pending');
  rec.set('requester', ctx.memberId || '');
  let ap = null;
  const emp = app.findRecordById('employees', m.getString('employee'));
  const who = L('lib_people').displayName(emp);
  const sh = L('lib_time_shift');
  const what = kind === 'missed_punch' ? 'missed punch on ' + sh.dayLabel(from) + (tm.in ? ', in ' + tm.in : '') + (tm.out ? ', out ' + tm.out : '') : kind === 'correction' ? 'hours on ' + sh.dayLabel(from) + ': ' + tm.in + ' to ' + tm.out : REQ_LABEL[kind].toLowerCase() + ' ' + sh.rangeLabel(from, to);
  app.runInTransaction((tx) => {
    tx.save(rec);
    const tctx = L('lib_auth').withApp(ctx, tx);
    const cur = util.findOne(tx, 'attendance', 'employment = {:e} && day = {:d}', { e: m.id, d: from });
    const punches = util.findMany(tx, 'checkins', 'employment = {:e} && day = {:d} && voided = false', 'at', 0, { e: m.id, d: from }).map((r) => T().checkinView(r, R.zone(m.id, from)));
    const F = T().fact;
    const facts = [F.text('kind', 'Request', REQ_LABEL[kind])].concat(
      kind === 'missed_punch' || kind === 'correction' ? [F.days('day', 'Day', from)].concat(tm.in ? [F.text('in', 'In', tm.in)] : [], tm.out ? [F.text('out', 'Out', tm.out)] : []) : [F.days('days', 'Days', from, to)],
      cur !== null && cur.getBool('locked') ? [F.state('pay', 'Pay', 'paid in a locked run')] : [],
    );
    ap = L('lib_approvals').open(tctx, { kind: 'attendance_request', ref_collection: 'attendance_requests', ref_id: rec.id, employment: m.id, summary: REQ_LABEL[kind] + ' for ' + who + ': ' + what, facts: facts, payload: { request: rec.id, kind: kind, from_day: from, to_day: to, in_time: tm.in, out_time: tm.out, reason: reason, current: cur !== null ? { status: cur.getString('status'), worked_min: cur.getInt('worked_min'), flags: util.jsonOf(cur, 'flags', []) || [] } : null, punches: punches.map((x) => ({ kind: x.kind, time: x.time, voided: x.voided })) }, days: util.daysBetween(from, to) + 1 });
    const fresh = tx.findRecordById('attendance_requests', rec.id);
    fresh.set('approval', ap.id);
    tx.save(fresh);
  });
  L('lib_audit').note(ctx, { collection: 'attendance_requests', record: rec.id, summary: 'Asked for ' + what });
  return { request: requestView(app, app.findRecordById('attendance_requests', rec.id)), approval: ap };
}

function requestsList(ctx, p) {
  const util = u();
  const t = T();
  const app = ctx.app;
  const which = util.oneOf(p, 'view', ['mine', 'team'], 'mine');
  const status = util.oneOf(p, 'status', ['open', 'pending', 'approved', 'rejected', 'cancelled', 'all'], 'open');
  let ids = [];
  if (which === 'mine') {
    if (ctx.employeeId === '') return { requests: [] };
    ids = util.rows(app, 'SELECT id FROM employments WHERE employee = {:e}', { id: '' }, { e: ctx.employeeId }).map((r) => r.id);
  } else {
    const today = util.today(app);
    ids = t.roster(ctx, util.dayAdd(today, -120), util.dayAdd(today, 60), { entity: util.str(p, 'entity', '') }).map((r) => r.employment);
  }
  if (ids.length === 0) return { requests: [] };
  const bind = {};
  let sql = 'SELECT id FROM attendance_requests WHERE employment IN ' + inList(ids, bind, 'e');
  if (status === 'open') sql += " AND status = 'pending'";
  else if (status !== 'all') {
    sql += ' AND status = {:s}';
    bind.s = status;
  }
  sql += ' ORDER BY created DESC LIMIT 300';
  return { requests: util.rows(app, sql, { id: '' }, bind).map((x) => requestView(app, app.findRecordById('attendance_requests', x.id))) };
}

function requestsCancel(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rec = util.byId(app, 'attendance_requests', util.req(p, 'request'));
  if (rec === null) throw util.fail(404, 'No such request.', 'not_found');
  const m = app.findRecordById('employments', rec.getString('employment'));
  const mine = (ctx.employeeId !== '' && m.getString('employee') === ctx.employeeId) || (ctx.memberId !== '' && rec.getString('requester') === ctx.memberId);
  if (!mine && !L('lib_auth').can(ctx, 'time', 'full')) throw util.fail(403, 'Only the person who asked (or HR) can cancel this request.', 'not_permitted');
  if (rec.getString('status') !== 'pending') return { request: requestView(app, rec) };
  if (rec.getString('approval') !== '') L('lib_approvals').cancel(ctx, rec.getString('approval'), util.text(p, 'note', 500, ''));
  else {
    rec.set('status', 'cancelled');
    app.save(rec);
  }
  L('lib_audit').note(ctx, { collection: 'attendance_requests', record: rec.id, summary: 'Cancelled an attendance request' });
  return { request: requestView(app, app.findRecordById('attendance_requests', rec.id)) };
}

/** Approval subscriber (kind attendance_request): apply what was asked as the day's attendance (source request). */
function onDecision(ctx, approval, decision, note) {
  const util = u();
  const t = T();
  const app = ctx.app;
  const rec = util.byId(app, 'attendance_requests', approval.ref_id);
  if (rec === null) return null;
  rec.set('decided_note', util.clip(note || '', 2000));
  if (decision !== 'approved') {
    rec.set('status', decision === 'rejected' ? 'rejected' : 'cancelled');
    app.save(rec);
    return { status: rec.getString('status') };
  }
  const m = app.findRecordById('employments', rec.getString('employment'));
  const R = t.resolver(app);
  const kind = rec.getString('kind');
  const from = rec.getString('from_day');
  const to = rec.getString('to_day') || from;
  const by = ctx.memberId || '';
  const reason = rec.getString('reason');
  const clock = L('lib_time_clock');
  if (kind === 'missed_punch' || kind === 'correction') {
    const zone = R.zone(m.id, from);
    const existing = util.findMany(app, 'checkins', 'employment = {:e} && day = {:d} && voided = false', 'at', 0, { e: m.id, d: from });
    if (kind === 'correction') {
      for (const c of existing) {
        c.set('voided', true);
        c.set('void_reason', 'Replaced by an approved correction');
        if (by) c.set('voided_by', by);
        c.set('voided_at', util.nowIso());
        app.save(c);
      }
    }
    const kept = kind === 'correction' ? [] : existing;
    const hasIn = kept.some((c) => c.getString('kind') === 'in');
    const lastKind = kept.length > 0 ? kept[kept.length - 1].getString('kind') : '';
    const inT = rec.getString('in_time');
    const outT = rec.getString('out_time');
    if (inT !== '' && !hasIn) clock.addPunch(app, m, { kind: 'in', at: util.utcOf(zone, from, inT), source: 'request', note: 'Approved request: ' + reason, by_member: by, flags: ['request'] });
    if (outT !== '' && lastKind !== 'out') {
      let at = util.utcOf(zone, from, outT);
      if (inT !== '' && outT <= inT) at = util.utcOf(zone, util.dayAdd(from, 1), outT);
      clock.addPunch(app, m, { kind: 'out', at: at, source: 'request', note: 'Approved request: ' + reason, by_member: by, flags: ['request'] });
    }
    const punches = t.punchesBetween(app, m.id, util.dayAdd(from, -1), util.dayAdd(from, 1));
    const R2 = t.resolver(app);
    const v = t.computeDay(R2, m.id, from, punches, Date.now());
    if (v !== null && v.status !== '') {
      if (kind === 'correction' && rec.getInt('break_min') > 0) {
        v.worked_min = Math.max(0, v.worked_min + v.break_min - rec.getInt('break_min'));
        v.break_min = rec.getInt('break_min');
      }
      const vals = {};
      for (const k of ['status', 'day_kind', 'shift_type', 'first_in', 'last_out', 'worked_min', 'break_min', 'expected_min', 'late_min', 'early_min', 'overtime_min', 'night_min', 'leave_type', 'leave_half', 'leave_min', 'flags']) vals[k] = v[k];
      vals.flags = (v.flags || []).filter((f) => f !== 'missed_in' && f !== 'missed_out').concat(['request']);
      saveAs(app, m.id, from, vals, 'request', REQ_LABEL[kind] + ': ' + reason, by);
    }
  } else {
    const R2 = t.resolver(app);
    for (let d = from; d <= to; d = util.dayAdd(d, 1)) {
      const plan = t.planOf(R2, m.id, d);
      if (plan.kind !== 'work') continue;
      const v = markedValues(R2, m.id, d, kind === 'remote' ? 'remote' : 'on_duty', '', '', null);
      if (rec.getBool('half_day')) v.worked_min = Math.round(v.worked_min / 2);
      v.flags = ['request'];
      saveAs(app, m.id, d, v, 'request', REQ_LABEL[kind] + ': ' + reason, by);
    }
  }
  rec.set('status', 'approved');
  app.save(rec);
  return { status: 'approved' };
}

module.exports = {
  STATUSES: STATUSES,
  MARKABLE: MARKABLE,
  CODE: CODE,
  REQ_KINDS: REQ_KINDS,
  board: board,
  month: month,
  dayGet: dayGet,
  list: list,
  exportCsv: exportCsv,
  saveAs: saveAs,
  markedValues: markedValues,
  mark: mark,
  previewMark: previewMark,
  markBulk: markBulk,
  reset: reset,
  processOp: processOp,
  requestView: requestView,
  requestsAdd: requestsAdd,
  requestsList: requestsList,
  requestsCancel: requestsCancel,
  onDecision: onDecision,
};
