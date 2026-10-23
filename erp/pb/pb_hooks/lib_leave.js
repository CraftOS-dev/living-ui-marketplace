/// <reference path="../pb_data/types.d.ts" />
/**
 * Leave: leave types, public holidays, requests, decisions, balances and the
 * team calendar.
 *
 * - A request counts working days (Settings, working days; Monday to Friday
 *   by default) between its first and last day, less holidays; a half day
 *   is one day only and counts 0.5.
 * - Types that need approval start "submitted" and wait for the employee's
 *   manager (anyone above them in the chain) or someone with full People
 *   rights; nobody decides their own. Other types are approved at once.
 * - Balances per type and year: entitled (days per year, prorated to the
 *   start date in the year it falls, rounded to half days) + carried
 *   (adjustments) - taken (approved) - pending (submitted) = remaining.
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

/** The line icons a leave type can wear (lucide names). */
const ICONS = ['sun', 'thermometer', 'calendar-off', 'baby', 'heart', 'plane', 'graduation-cap', 'briefcase', 'home', 'umbrella'];
const STATUSES = ['submitted', 'approved', 'rejected', 'cancelled'];

/* ============================================================ counting */

function workingDays(app) {
  const list = u().jsonOf(core().settings(app), 'working_days');
  if (!Array.isArray(list) || list.length === 0) return [1, 2, 3, 4, 5];
  return list.map((x) => Number(x)).filter((x) => Number.isInteger(x) && x >= 1 && x <= 7);
}

/** date -> holiday name, for days from..to. */
function holidaysIn(app, from, to) {
  const out = {};
  for (const r of u().rows(app, 'SELECT date, name FROM holidays WHERE date >= {:f} AND date <= {:t}', { date: '', name: '' }, { f: from, t: to })) out[r.date] = r.name;
  return out;
}

/** Working days from..to inclusive, less holidays: { days, byYear, holidays }. */
function countDays(app, from, to, half) {
  const util = u();
  const wd = workingDays(app);
  const hol = holidaysIn(app, from, to);
  const byYear = {};
  const hit = [];
  let days = 0;
  let d = from;
  let guard = 0;
  while (d <= to && guard < 800) {
    if (wd.indexOf(util.weekday(d)) >= 0) {
      if (hol[d] !== undefined) hit.push({ date: d, name: hol[d] });
      else {
        const y = d.slice(0, 4);
        byYear[y] = (byYear[y] || 0) + 1;
        days += 1;
      }
    }
    d = util.addDays(d, 1);
    guard++;
  }
  if (half && days > 0) {
    days = 0.5;
    for (const k of Object.keys(byYear)) byYear[k] = 0.5;
  }
  return { days: days, byYear: byYear, holidays: hit };
}

function daysInYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365;
}

/** Days a type gives for `year`, prorated when the employee started that year (half days). */
function entitlement(emp, type, year) {
  const util = u();
  const per = type.getFloat('days_per_year');
  if (!(per > 0)) return 0;
  const start = emp.getString('start_date');
  if (start === '') return util.q3(per);
  const sy = Number(start.slice(0, 4));
  if (sy < year) return util.q3(per);
  if (sy > year) return 0;
  const left = util.daysBetween(start, year + '-12-31') + 1;
  return Math.round(((per * left) / daysInYear(year)) * 2) / 2;
}

/** The part of a request that falls in `year`. */
function yearPortion(app, r, year) {
  const ys = year + '-01-01';
  const ye = year + '-12-31';
  if (r.from >= ys && r.to <= ye) return r.days;
  if (r.to < ys || r.from > ye) return 0;
  return countDays(app, r.from < ys ? ys : r.from, r.to > ye ? ye : r.to, r.half_day).days;
}

/** Balances of every active type for an employee and year. */
function balancesFor(app, emp, year) {
  const util = u();
  const ys = year + '-01-01';
  const ye = year + '-12-31';
  const used = {};
  const reqs = util.rows(
    app,
    "SELECT type, [[from]] AS f, [[to]] AS t, days, half_day, status FROM leave_requests WHERE employee = {:e} AND status IN ('submitted', 'approved') AND [[to]] >= {:ys} AND [[from]] <= {:ye}",
    { type: '', f: '', t: '', days: -0, half_day: false, status: '' },
    { e: emp.id, ys: ys, ye: ye },
  );
  for (const r of reqs) {
    const k = r.type;
    const x = used[k] || { taken: 0, pending: 0 };
    const part = yearPortion(app, { from: r.f, to: r.t, days: r.days, half_day: r.half_day }, year);
    if (r.status === 'approved') x.taken += part;
    else x.pending += part;
    used[k] = x;
  }
  const carried = {};
  for (const r of util.rows(app, 'SELECT type, IFNULL(SUM(days), 0) AS d FROM leave_adjustments WHERE employee = {:e} AND year = {:y} GROUP BY type', { type: '', d: -0 }, { e: emp.id, y: year })) carried[r.type] = r.d;
  const types = app.findRecordsByFilter('leave_types', 'archived = false', 'sort,name', 0, 0);
  return {
    employee: people().empBrief(app, emp.id, {}),
    year: year,
    types: types.map((t) => {
      const ent = entitlement(emp, t, year);
      const x = used[t.id] || { taken: 0, pending: 0 };
      const car = util.q3(carried[t.id] || 0);
      const limited = t.getFloat('days_per_year') > 0;
      return {
        type: typeBrief(t),
        limited: limited,
        entitled: ent,
        carried: car,
        taken: util.q3(x.taken),
        pending: util.q3(x.pending),
        remaining: util.q3(ent + car - x.taken - x.pending),
      };
    }),
  };
}

/* =============================================================== types */

function typeBrief(t) {
  return { id: t.id, name: t.getString('name'), icon: t.getString('icon') || 'calendar-off', paid: t.getBool('paid'), days_per_year: u().q3(t.getFloat('days_per_year')) };
}

function typeOut(t) {
  const util = u();
  return {
    id: t.id,
    name: t.getString('name'),
    days_per_year: util.q3(t.getFloat('days_per_year')),
    paid: t.getBool('paid'),
    needs_approval: t.getBool('needs_approval'),
    carry_over_max: util.q3(t.getFloat('carry_over_max')),
    icon: t.getString('icon') || 'calendar-off',
    archived: t.getBool('archived'),
    sort: t.getInt('sort'),
  };
}

function listTypes(ctx, p) {
  const util = u();
  const withArchived = util.bool(p, 'archived', false);
  return {
    types: ctx.app.findRecordsByFilter('leave_types', withArchived ? '' : 'archived = false', 'sort,name', 0, 0).map(typeOut),
    icons: ICONS,
    can: { edit: !ctx.isAgent && people().has(ctx, 'people', 'full') },
  };
}

function readType(ctx, app, r, p, isNew) {
  const util = u();
  if (util.has(p, 'name')) {
    const n = util.squash(util.text(p, 'name', 60, ''));
    if (n === '') throw util.fail(400, 'name cannot be empty', 'invalid_param', { param: 'name' });
    if (util.idsNocaseFind(app, 'leave_types', 'name', n, r.id || '')) throw util.fail(409, 'There is already a leave type called ' + n + '.', 'duplicate');
    r.set('name', n);
  }
  if (isNew && r.getString('name') === '') throw util.fail(400, 'name is required, e.g. name="Study leave"', 'missing_param', { param: 'name' });
  if (util.has(p, 'days_per_year')) {
    const d = util.qty(p, 'days_per_year') || 0;
    if (d > 366) throw util.fail(400, 'days_per_year can be at most 366', 'invalid_param', { param: 'days_per_year' });
    r.set('days_per_year', d);
  }
  if (util.has(p, 'carry_over_max')) {
    const d = util.qty(p, 'carry_over_max') || 0;
    if (d > 366) throw util.fail(400, 'carry_over_max can be at most 366', 'invalid_param', { param: 'carry_over_max' });
    r.set('carry_over_max', d);
  }
  if (util.has(p, 'paid')) r.set('paid', util.bool(p, 'paid', true));
  if (util.has(p, 'needs_approval')) r.set('needs_approval', util.bool(p, 'needs_approval', true));
  if (util.has(p, 'icon')) {
    const icon = util.str(p, 'icon', '');
    if (ICONS.indexOf(icon) < 0) throw util.fail(400, 'icon must be one of: ' + ICONS.join(', '), 'invalid_param', { param: 'icon' });
    r.set('icon', icon);
  }
  if (util.has(p, 'sort')) r.set('sort', util.int(p, 'sort', 0, 0, 100000));
}

function needTypes(ctx) {
  auth().need(ctx, 'people', 'full', 'change leave types');
}

function addType(ctx, p) {
  needTypes(ctx);
  const util = u();
  const app = ctx.app;
  const r = util.newRecord(app, 'leave_types');
  r.set('days_per_year', 0);
  r.set('carry_over_max', 0);
  r.set('paid', true);
  r.set('needs_approval', true);
  r.set('icon', 'calendar-off');
  r.set('archived', false);
  r.set('sort', 100);
  readType(ctx, app, r, p, true);
  app.runInTransaction((tx) => {
    tx.save(r);
    audit().write(tx, ctx, { kind: 'create', entity: 'leave_types', ref: r.id, label: r.getString('name'), summary: 'Added the leave type ' + r.getString('name') });
  });
  return typeOut(app.findRecordById('leave_types', r.id));
}

function updateType(ctx, p) {
  needTypes(ctx);
  const util = u();
  const app = ctx.app;
  const found = core().resolve(app, 'leave_types', util.req(p, 'type', '"Annual leave"'));
  const r = app.findRecordById('leave_types', found.id);
  readType(ctx, app, r, p, false);
  app.runInTransaction((tx) => {
    tx.save(r);
    audit().write(tx, ctx, { kind: 'update', entity: 'leave_types', ref: r.id, label: r.getString('name'), summary: 'Changed the leave type ' + r.getString('name') });
  });
  return typeOut(app.findRecordById('leave_types', r.id));
}

function archiveType(ctx, p) {
  needTypes(ctx);
  const util = u();
  const app = ctx.app;
  const found = core().resolve(app, 'leave_types', util.req(p, 'type', '"Annual leave"'));
  const archived = util.bool(p, 'archived', true);
  app.runInTransaction((tx) => {
    const r = tx.findRecordById('leave_types', found.id);
    r.set('archived', archived);
    tx.save(r);
    audit().write(tx, ctx, { kind: 'update', entity: 'leave_types', ref: r.id, label: r.getString('name'), summary: (archived ? 'Archived' : 'Restored') + ' the leave type ' + r.getString('name') });
  });
  return typeOut(app.findRecordById('leave_types', found.id));
}

/* ============================================================ holidays */

function holidayOut(app, h, wd) {
  const util = u();
  const d = h.getString('date');
  return { id: h.id, date: d, name: h.getString('name'), weekday: util.weekday(d), working_day: wd.indexOf(util.weekday(d)) >= 0 };
}

function listHolidays(ctx, p) {
  const util = u();
  const app = ctx.app;
  const year = util.int(p, 'year', Number(util.today().slice(0, 4)), 1900, 2200);
  const wd = workingDays(app);
  const recs = app.findRecordsByFilter('holidays', 'date >= {:f} && date <= {:t}', 'date', 0, 0, { f: year + '-01-01', t: year + '-12-31' });
  return { year: year, holidays: recs.map((h) => holidayOut(app, h, wd)), working_days: wd, can: { edit: people().has(ctx, 'people', 'edit') } };
}

function addHoliday(ctx, p) {
  auth().need(ctx, 'people', 'edit', 'change holidays');
  const util = u();
  const app = ctx.app;
  const date = util.day(p, 'date', '');
  if (date === '') throw util.fail(400, 'date is required, e.g. date=' + util.today(), 'missing_param', { param: 'date' });
  const name = util.squash(util.text(p, 'name', 120, ''));
  if (name === '') throw util.fail(400, 'name is required, e.g. name="National Day"', 'missing_param', { param: 'name' });
  const other = util.findOne(app, 'holidays', 'date = {:d}', { d: date });
  if (other !== null) throw util.fail(409, date + ' is already a holiday (' + other.getString('name') + ').', 'duplicate');
  const r = util.newRecord(app, 'holidays');
  r.set('date', date);
  r.set('name', name);
  app.runInTransaction((tx) => {
    tx.save(r);
    audit().write(tx, ctx, { kind: 'create', entity: 'holidays', ref: r.id, label: name, summary: 'Added the holiday ' + name + ' on ' + date });
  });
  return holidayOut(app, app.findRecordById('holidays', r.id), workingDays(app));
}

function deleteHoliday(ctx, p) {
  auth().need(ctx, 'people', 'edit', 'change holidays');
  const util = u();
  const app = ctx.app;
  const h = core().resolve(app, 'holidays', util.req(p, 'holiday', '2026-12-25'));
  if (util.bool(p, 'preview', false)) return { preview: true, date: h.getString('date'), name: h.getString('name') };
  app.runInTransaction((tx) => {
    tx.delete(tx.findRecordById('holidays', h.id));
    audit().write(tx, ctx, { kind: 'delete', entity: 'holidays', ref: h.id, label: h.getString('name'), summary: 'Deleted the holiday ' + h.getString('name') + ' on ' + h.getString('date') });
  });
  return { deleted: true };
}

/* ============================================================ requests */

function isOwnRequest(ctx, r) {
  return people().isOwn(ctx, r.getString('employee'));
}

function canCancelOf(ctx, status, employeeId, from) {
  if (ctx.isAgent || (status !== 'submitted' && status !== 'approved')) return false;
  if (people().has(ctx, 'people', 'edit')) return true;
  if (!people().isOwn(ctx, employeeId)) return false;
  return status === 'submitted' || from > u().today();
}

function canCancel(ctx, r) {
  return canCancelOf(ctx, r.getString('status'), r.getString('employee'), r.getString('from'));
}

/** `many`: deciding for a list, where the caller's whole team is looked up once. */
function canDecideOf(ctx, status, employeeId, many) {
  if (ctx.isAgent || status !== 'submitted' || people().isOwn(ctx, employeeId)) return false;
  const P = people();
  if (P.has(ctx, 'people', 'full')) return true;
  return many === true ? P.teamOf(ctx)[employeeId] === true : P.manages(ctx.app, ctx.employeeId, employeeId);
}

function canDecide(ctx, r, many) {
  return canDecideOf(ctx, r.getString('status'), r.getString('employee'), many);
}

function requestOut(app, ctx, r, cache, many) {
  const util = u();
  const c = cache || {};
  const tkey = 't:' + r.getString('type');
  if (c[tkey] === undefined) {
    const t = util.byId(app, 'leave_types', r.getString('type'));
    c[tkey] = t === null ? null : typeBrief(t);
  }
  const names = c.members || (c.members = {});
  const emp = people().empBrief(app, r.getString('employee'), c);
  return {
    id: r.id,
    employee: emp,
    type: c[tkey],
    from: r.getString('from'),
    to: r.getString('to'),
    half_day: r.getBool('half_day'),
    days: util.q3(r.getFloat('days')),
    reason: r.getString('reason'),
    status: r.getString('status'),
    requested_by: r.getString('actor') === 'agent' ? 'Your AI agent' : audit().memberName(app, r.getString('member'), names),
    decided_by: audit().memberName(app, r.getString('decided_by'), names),
    decided_at: r.getString('decided_at'),
    decision_note: r.getString('decision_note'),
    created: r.getString('created'),
    can: { cancel: canCancel(ctx, r), decide: canDecide(ctx, r, many) },
  };
}

function loadRequest(ctx, ref) {
  const util = u();
  const r = core().resolve(ctx.app, 'leave_requests', ref);
  if (!people().seesSelfService(ctx, r.getString('employee'))) throw util.fail(403, 'You cannot see that leave request.', 'not_permitted');
  return r;
}

function request(ctx, p) {
  const util = u();
  const P = people();
  const app = ctx.app;
  P.needOn(ctx, 'people');
  const emp = P.targetEmployee(ctx, p, 'request leave for other employees');
  if (emp.getString('status') === 'left') throw util.fail(409, emp.getString('name') + ' has left.', 'invalid_state');
  const type = core().resolve(app, 'leave_types', util.req(p, 'type', '"Annual leave"'));
  if (type.getBool('archived')) throw util.fail(409, type.getString('name') + ' is archived. Choose another leave type.', 'archived');
  const from = util.day(p, 'from', '');
  if (from === '') throw util.fail(400, 'from is required, e.g. from=' + util.today(), 'missing_param', { param: 'from' });
  const to = util.day(p, 'to', from);
  if (to < from) throw util.fail(400, 'to (' + to + ') is before from (' + from + ').', 'invalid_param', { param: 'to' });
  if (util.daysBetween(from, to) > 366) throw util.fail(400, 'One request covers at most a year. Split it.', 'invalid_param', { param: 'to' });
  const half = util.bool(p, 'half_day', false);
  if (half && from !== to) throw util.fail(400, 'A half day is a single day: from and to must be the same day.', 'invalid_param', { param: 'half_day' });
  const reason = util.text(p, 'reason', 1000, '');
  const cnt = countDays(app, from, to, half);
  if (cnt.days === 0) {
    throw util.fail(409, 'There are no working days from ' + from + ' to ' + to + (cnt.holidays.length > 0 ? ' (' + cnt.holidays.map((h) => h.name).join(', ') + ')' : '') + ', so there is nothing to request.', 'no_working_days');
  }
  const clash = util.one(
    app,
    "SELECT id, [[from]] AS f, [[to]] AS t, status FROM leave_requests WHERE employee = {:e} AND status IN ('submitted', 'approved') AND [[from]] <= {:to} AND [[to]] >= {:from} LIMIT 1",
    { id: '', f: '', t: '', status: '' },
    { e: emp.id, from: from, to: to },
  );
  if (clash !== null) {
    throw util.fail(409, emp.getString('name') + ' already has ' + clash.status + ' leave from ' + clash.f + ' to ' + clash.t + ' that overlaps these days.', 'overlap', { request: clash.id });
  }
  if (type.getFloat('days_per_year') > 0 && !P.has(ctx, 'people', 'edit')) {
    for (const y of Object.keys(cnt.byYear)) {
      const bal = balancesFor(app, emp, Number(y)).types.find((x) => x.type.id === type.id);
      const left = bal ? bal.remaining : 0;
      if (cnt.byYear[y] > left + 1e-9) {
        throw util.fail(409, 'Only ' + Math.max(0, left) + ' days of ' + type.getString('name') + ' are left in ' + y + '; this request needs ' + cnt.byYear[y] + '.', 'over_balance', { remaining: left, needed: cnt.byYear[y], year: Number(y) });
      }
    }
  }
  const status = type.getBool('needs_approval') ? 'submitted' : 'approved';
  const r = util.newRecord(app, 'leave_requests');
  r.set('employee', emp.id);
  r.set('type', type.id);
  r.set('from', from);
  r.set('to', to);
  r.set('half_day', half);
  r.set('days', cnt.days);
  r.set('reason', reason);
  r.set('status', status);
  r.set('member', ctx.memberId || '');
  r.set('actor', ctx.isAgent ? 'agent' : 'person');
  if (status === 'approved') {
    r.set('decided_at', util.nowIso());
    r.set('decision_note', 'No approval needed');
  }
  app.runInTransaction((tx) => {
    tx.save(r);
    audit().write(tx, ctx, {
      kind: 'create',
      entity: 'leave_requests',
      ref: r.id,
      label: emp.getString('name'),
      summary: (status === 'approved' ? 'Recorded ' : 'Requested ') + cnt.days + (cnt.days === 1 ? ' day' : ' days') + ' of ' + type.getString('name') + ' for ' + emp.getString('name') + ' (' + from + (to !== from ? ' to ' + to : '') + ')',
    });
  });
  const out = requestOut(app, ctx, app.findRecordById('leave_requests', r.id), {});
  out.holidays_skipped = cnt.holidays;
  return out;
}

function listLeave(ctx, p) {
  const util = u();
  const P = people();
  const app = ctx.app;
  P.needOn(ctx, 'people');
  const scope = util.oneOf(p, 'scope', ['mine', 'team', 'all'], ctx.isAgent || (ctx.employeeId === '' && P.canViewPeople(ctx)) ? 'all' : 'mine');
  const pg = util.page(p, 50, 500);
  const where = ['1 = 1'];
  const bind = {};
  let me = '';
  if (scope === 'mine') {
    where.push('lr.employee = {:me}');
    bind.me = P.ownEmployee(ctx);
  } else if (scope === 'team') {
    me = P.ownEmployee(ctx);
    where.push(P.inTeamSql(ctx, 'lr.employee', bind));
  } else if (!P.canViewPeople(ctx)) {
    throw util.fail(403, 'Your role cannot see everyone\'s leave (needs view access to People). Use scope mine or team.', 'not_permitted');
  }
  const empRef = util.str(p, 'employee', '');
  if (empRef !== '') {
    const emp = core().resolve(app, 'employees', empRef);
    if (scope === 'team' && !P.manages(app, me, emp.id)) throw util.fail(403, emp.getString('name') + ' is not in your team.', 'not_permitted');
    where.push('lr.employee = {:emp}');
    bind.emp = emp.id;
  }
  const typeRef = util.str(p, 'type', '');
  if (typeRef !== '') {
    where.push('lr.type = {:type}');
    bind.type = core().resolve(app, 'leave_types', typeRef).id;
  }
  const from = util.day(p, 'from', '');
  if (from !== '') {
    where.push('lr."to" >= {:f}');
    bind.f = from;
  }
  const to = util.day(p, 'to', '');
  if (to !== '') {
    where.push('lr."from" <= {:t}');
    bind.t = to;
  }
  const scoped = where.slice();
  const status = util.oneOf(p, 'status', STATUSES, '');
  if (status !== '') {
    where.push('lr.status = {:s}');
    bind.s = status;
  }
  // One query for the page: each request with its employee, type and the
  // names of who asked and who decided.
  const rows = util.rows(
    app,
    'SELECT lr.id AS id, lr.employee AS e_id, lr."from" AS f, lr."to" AS t, lr.half_day AS half_day, lr.days AS days, lr.reason AS reason, lr.status AS status, lr.actor AS actor, ' +
      'lr.member AS member, lr.decided_by AS decided_by, lr.decided_at AS decided_at, lr.decision_note AS decision_note, lr.created AS created, ' +
      "IFNULL(e.name, '') AS e_name, IFNULL(e.number, '') AS e_number, IFNULL(e.job_title, '') AS e_title, IFNULL(e.photo, '') AS e_photo, IFNULL(e.status, '') AS e_status, " +
      "IFNULL(lt.id, '') AS t_id, IFNULL(lt.name, '') AS t_name, IFNULL(lt.icon, '') AS t_icon, IFNULL(lt.paid, FALSE) AS t_paid, IFNULL(lt.days_per_year, 0) AS t_days, " +
      "IFNULL(m1.name, '') AS member_name, IFNULL(m2.name, '') AS decided_name " +
      'FROM leave_requests lr LEFT JOIN employees e ON e.id = lr.employee LEFT JOIN leave_types lt ON lt.id = lr.type LEFT JOIN members m1 ON m1.id = lr.member LEFT JOIN members m2 ON m2.id = lr.decided_by WHERE ' +
      where.join(' AND ') +
      ' ORDER BY lr."from" DESC, lr.created DESC LIMIT ' +
      pg.limit +
      ' OFFSET ' +
      pg.offset,
    {
      id: '', e_id: '', f: '', t: '', half_day: false, days: -0, reason: '', status: '', actor: '', member: '', decided_by: '', decided_at: '', decision_note: '', created: '',
      e_name: '', e_number: '', e_title: '', e_photo: '', e_status: '', t_id: '', t_name: '', t_icon: '', t_paid: false, t_days: -0, member_name: '', decided_name: '',
    },
    bind,
  );
  // The counts per status also give the total (one scan of the scope instead of two).
  const counts = { submitted: 0, approved: 0, rejected: 0, cancelled: 0 };
  for (const r of util.rows(app, 'SELECT lr.status AS status, COUNT(lr.id) AS n FROM leave_requests lr WHERE ' + scoped.join(' AND ') + ' GROUP BY lr.status', { status: '', n: 0 }, bind)) counts[r.status] = r.n;
  const total = status !== '' ? counts[status] || 0 : counts.submitted + counts.approved + counts.rejected + counts.cancelled;
  const name = (id, n) => (id === '' ? '' : n !== '' ? n : 'Former member');
  const requests = rows.map((r) => ({
    id: r.id,
    employee: r.e_name === '' ? null : { id: r.e_id, name: r.e_name, number: r.e_number, job_title: r.e_title, photo: r.e_photo === '' ? '' : '/api/files/employees/' + r.e_id + '/' + r.e_photo, status: r.e_status },
    type: r.t_id === '' ? null : { id: r.t_id, name: r.t_name, icon: r.t_icon || 'calendar-off', paid: r.t_paid, days_per_year: util.q3(r.t_days) },
    from: r.f,
    to: r.t,
    half_day: r.half_day,
    days: util.q3(r.days),
    reason: r.reason,
    status: r.status,
    requested_by: r.actor === 'agent' ? 'Your AI agent' : name(r.member, r.member_name),
    decided_by: name(r.decided_by, r.decided_name),
    decided_at: r.decided_at,
    decision_note: r.decision_note,
    created: r.created,
    can: { cancel: canCancelOf(ctx, r.status, r.e_id, r.f), decide: canDecideOf(ctx, r.status, r.e_id, true) },
  }));
  return { scope: scope, requests: requests, total: total, counts: counts };
}

function getRequest(ctx, p) {
  const r = loadRequest(ctx, u().req(p, 'request'));
  return requestOut(ctx.app, ctx, r, {});
}

function calendar(ctx, p) {
  const util = u();
  const P = people();
  const app = ctx.app;
  P.needOn(ctx, 'people');
  const month = util.monthParam(p, 'month', util.today().slice(0, 7));
  const ms = util.monthStart(month);
  const me = util.monthEnd(month);
  let scope = util.oneOf(p, 'scope', ['visible', 'mine', 'team', 'all'], 'visible');
  const where = ["lr.status IN ('submitted', 'approved')", 'lr."from" <= {:me}', 'lr."to" >= {:ms}'];
  const bind = { ms: ms, me: me };
  if (scope === 'visible') scope = P.canViewPeople(ctx) ? 'all' : 'mine_team';
  if (scope === 'all' && !P.canViewPeople(ctx)) throw util.fail(403, 'Your role cannot see everyone\'s leave (needs view access to People).', 'not_permitted');
  if (scope === 'mine') {
    where.push('lr.employee = {:me_id}');
    bind.me_id = P.ownEmployee(ctx);
  } else if (scope === 'team') {
    P.ownEmployee(ctx);
    where.push(P.inTeamSql(ctx, 'lr.employee', bind));
  } else if (scope === 'mine_team') {
    if (ctx.employeeId === '') where.push('1 = 0');
    else {
      bind.me_id = ctx.employeeId;
      where.push('(lr.employee = {:me_id} OR ' + P.inTeamSql(ctx, 'lr.employee', bind) + ')');
    }
  }
  // One query: each request with its employee and leave type.
  const rows = util.rows(
    app,
    'SELECT lr.id AS id, lr."from" AS f, lr."to" AS t, lr.half_day AS half_day, lr.days AS days, lr.status AS status, ' +
      'e.id AS e_id, e.name AS e_name, e.number AS e_number, e.job_title AS e_title, e.photo AS e_photo, e.status AS e_status, ' +
      "IFNULL(lt.id, '') AS t_id, IFNULL(lt.name, '') AS t_name, IFNULL(lt.icon, '') AS t_icon, IFNULL(lt.paid, FALSE) AS t_paid, IFNULL(lt.days_per_year, 0) AS t_days " +
      'FROM leave_requests lr JOIN employees e ON e.id = lr.employee LEFT JOIN leave_types lt ON lt.id = lr.type WHERE ' +
      where.join(' AND ') +
      ' ORDER BY lr."from", lr.created',
    { id: '', f: '', t: '', half_day: false, days: -0, status: '', e_id: '', e_name: '', e_number: '', e_title: '', e_photo: '', e_status: '', t_id: '', t_name: '', t_icon: '', t_paid: false, t_days: -0 },
    bind,
  );
  const entries = rows.map((r) => ({
    id: r.id,
    employee: { id: r.e_id, name: r.e_name, number: r.e_number, job_title: r.e_title, photo: r.e_photo === '' ? '' : '/api/files/employees/' + r.e_id + '/' + r.e_photo, status: r.e_status },
    type: r.t_id === '' ? null : { id: r.t_id, name: r.t_name, icon: r.t_icon || 'calendar-off', paid: r.t_paid, days_per_year: util.q3(r.t_days) },
    from: r.f,
    to: r.t,
    half_day: r.half_day,
    days: util.q3(r.days),
    status: r.status,
  }));
  const wd = workingDays(app);
  const holidays = app.findRecordsByFilter('holidays', 'date >= {:f} && date <= {:t}', 'date', 0, 0, { f: ms, t: me }).map((h) => holidayOut(app, h, wd));
  return { month: month, from: ms, to: me, scope: scope === 'mine_team' ? 'visible' : scope, entries: entries, holidays: holidays, working_days: wd };
}

function balances(ctx, p) {
  const util = u();
  const P = people();
  const app = ctx.app;
  P.needOn(ctx, 'people');
  const ref = util.str(p, 'employee', '');
  const emp = ref === '' ? app.findRecordById('employees', P.ownEmployee(ctx)) : core().resolve(app, 'employees', ref);
  if (!P.seesSelfService(ctx, emp.id)) throw util.fail(403, 'You cannot see ' + emp.getString('name') + "'s leave.", 'not_permitted');
  const year = util.int(p, 'year', Number(util.today().slice(0, 4)), 1900, 2200);
  const out = balancesFor(app, emp, year);
  const names = {};
  out.adjustments = app.findRecordsByFilter('leave_adjustments', 'employee = {:e} && year = {:y}', '-created', 200, 0, { e: emp.id, y: year }).map((a) => {
    const t = util.byId(app, 'leave_types', a.getString('type'));
    return { id: a.id, type: t !== null ? typeBrief(t) : null, days: util.q3(a.getFloat('days')), reason: a.getString('reason'), by: audit().memberName(app, a.getString('member'), names), created: a.getString('created') };
  });
  out.start_date = P.seesDetails(ctx, emp.id) ? emp.getString('start_date') : '';
  out.can = { adjust: !ctx.isAgent && P.has(ctx, 'people', 'full') };
  return out;
}

function cancel(ctx, p) {
  const util = u();
  const app = ctx.app;
  people().needOn(ctx, 'people');
  const r = loadRequest(ctx, util.req(p, 'request'));
  const status = r.getString('status');
  if (status !== 'submitted' && status !== 'approved') throw util.fail(409, 'This request is already ' + status + '.', 'invalid_state');
  if (!canCancel(ctx, r)) {
    if (isOwnRequest(ctx, r) && status === 'approved') throw util.fail(409, 'This leave has already started. Ask HR to cancel it.', 'started');
    throw util.fail(403, 'You can cancel only your own leave (or anyone\'s with edit access to People).', 'not_permitted');
  }
  const note = util.text(p, 'note', 500, '');
  app.runInTransaction((tx) => {
    const x = tx.findRecordById('leave_requests', r.id);
    x.set('status', 'cancelled');
    if (note !== '') x.set('decision_note', note);
    tx.save(x);
    const emp = people().empBrief(tx, x.getString('employee'), {});
    audit().write(tx, ctx, { kind: 'cancel', entity: 'leave_requests', ref: x.id, label: emp ? emp.name : '', summary: 'Cancelled the leave from ' + x.getString('from') + ' to ' + x.getString('to') + (emp ? ' for ' + emp.name : '') + (note !== '' ? ' (' + note + ')' : '') });
  });
  return requestOut(app, ctx, app.findRecordById('leave_requests', r.id), {});
}

function decide(ctx, p) {
  const util = u();
  const app = ctx.app;
  people().needOn(ctx, 'people');
  if (ctx.isAgent) throw util.fail(403, 'Your AI agent does not decide leave; the manager does.', 'agent_not_permitted');
  const r = loadRequest(ctx, util.req(p, 'request'));
  if (r.getString('status') !== 'submitted') throw util.fail(409, 'This request is already ' + r.getString('status') + '.', 'invalid_state');
  if (isOwnRequest(ctx, r)) throw util.fail(403, 'You cannot decide your own leave. Your manager does.', 'own_request');
  if (!canDecide(ctx, r)) throw util.fail(403, 'Only the employee\'s manager, or someone with full access to People, decides this.', 'not_permitted');
  if (!util.has(p, 'approve')) throw util.fail(400, 'approve is required: true to approve, false to reject.', 'missing_param', { param: 'approve' });
  const approve = util.bool(p, 'approve', true);
  const note = util.text(p, 'note', 500, '');
  app.runInTransaction((tx) => {
    const x = tx.findRecordById('leave_requests', r.id);
    if (x.getString('status') !== 'submitted') throw util.fail(409, 'This request was decided a moment ago.', 'invalid_state');
    x.set('status', approve ? 'approved' : 'rejected');
    x.set('decided_by', ctx.memberId);
    x.set('decided_at', util.nowIso());
    x.set('decision_note', note);
    tx.save(x);
    const emp = people().empBrief(tx, x.getString('employee'), {});
    audit().write(tx, ctx, {
      kind: approve ? 'approve' : 'reject',
      entity: 'leave_requests',
      ref: x.id,
      label: emp ? emp.name : '',
      summary: (approve ? 'Approved ' : 'Rejected ') + util.q3(x.getFloat('days')) + ' days of leave from ' + x.getString('from') + ' for ' + (emp ? emp.name : '') + (note !== '' ? ' (' + note + ')' : ''),
    });
  });
  return requestOut(app, ctx, app.findRecordById('leave_requests', r.id), {});
}

function adjust(ctx, p) {
  const util = u();
  const app = ctx.app;
  auth().need(ctx, 'people', 'full', 'adjust leave balances');
  const emp = core().resolve(app, 'employees', util.req(p, 'employee', 'EMP-0001'));
  const type = core().resolve(app, 'leave_types', util.req(p, 'type', '"Annual leave"'));
  const year = util.int(p, 'year', Number(util.today().slice(0, 4)), 1900, 2200);
  const days = util.qty(p, 'days', { required: true, allowNegative: true });
  if (days === 0) throw util.fail(400, 'days cannot be 0 (a minus takes days away).', 'invalid_param', { param: 'days' });
  if (Math.abs(days) > 366) throw util.fail(400, 'days can be at most 366 either way', 'invalid_param', { param: 'days' });
  const reason = util.text(p, 'reason', 300, '');
  const r = util.newRecord(app, 'leave_adjustments');
  r.set('employee', emp.id);
  r.set('type', type.id);
  r.set('year', year);
  r.set('days', days);
  r.set('reason', reason);
  r.set('member', ctx.memberId || '');
  app.runInTransaction((tx) => {
    tx.save(r);
    audit().write(tx, ctx, {
      kind: 'adjust',
      entity: 'employees',
      ref: emp.id,
      label: emp.getString('number'),
      summary: (days > 0 ? 'Added ' : 'Took away ') + Math.abs(days) + ' days of ' + type.getString('name') + ' for ' + year + ' for ' + emp.getString('name') + (reason !== '' ? ' (' + reason + ')' : ''),
    });
  });
  const out = balances(ctx, { employee: emp.id, year: year });
  out.adjustment = r.id;
  return out;
}

module.exports = {
  ICONS: ICONS,
  STATUSES: STATUSES,
  workingDays: workingDays,
  countDays: countDays,
  entitlement: entitlement,
  balancesFor: balancesFor,
  listTypes: listTypes,
  addType: addType,
  updateType: updateType,
  archiveType: archiveType,
  listHolidays: listHolidays,
  addHoliday: addHoliday,
  deleteHoliday: deleteHoliday,
  request: request,
  listLeave: listLeave,
  getRequest: getRequest,
  calendar: calendar,
  balances: balances,
  cancel: cancel,
  decide: decide,
  adjust: adjust,
};
