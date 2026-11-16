/// <reference path="../pb_data/types.d.ts" />
/**
 * The time module's core: the plan of a day (shift or work schedule,
 * holiday, rest day, leave), punches turned into work sessions, the day's
 * attendance computed from them (auto attendance), and the contracts other
 * modules call (SPEC 3.5):
 *
 *   payInputs(app, employmentId, from, to)
 *     -> { worked_minutes, regular_minutes, overtime: [{ component, minutes, multiplier }],
 *          absent_days, late_minutes, night_minutes, holiday_worked_minutes,
 *          issues: [{ code, message, severity: 'blocker' | 'warning' }] }
 *   payInputsMany(app, employmentIds, from, to) -> { [employmentId]: <payInputs result> }
 *   payInputsDetail(app, employmentId, from, to) -> payInputs plus detail (days and parts)
 *   payInputsDetailMany(app, employmentIds, from, to) -> { [employmentId]: <payInputsDetail result> }
 *       (the Many forms give the same answers, read together: one query per kind of data for all of them)
 *   Each pay inputs result also has adjustments: [{ day, component, multiplier, minutes, days?, reason, locked_by_payrun }]
 *       (days an earlier locked run used that changed afterwards, a late clock out for example:
 *        the difference by component, to pay in this run; see adjustmentsOf)
 *   lockDays(app, employmentId, from, to, payrunId) -> { locked, created, skipped_future, settled }
 *       (payroll calls it when a run locks: the paid values of those days never change again;
 *        later punches still count, as adjustments; settled = adjustments this run paid)
 *   unlockDays(app, payrunId) -> { unlocked, reopened }   (payroll calls it when it voids a locked run before payment)
 *   profileFacts(ctx, employmentId) -> [{ label, value, tone, link }]
 *
 * Approved leave comes from the leave module's requests (leaveDays below):
 * leave_requests with status approved or cancelling and their `day_list`
 * [{ day, days, amount, hours, half }] (the leave module's contract,
 * reference/notes/leave.md), with the type's code, name and paid flag.
 *
 * A day's attendance is never recomputed once a person set it (source
 * manual, request or import) or a locked pay run used it.
 *
 * Days are local days in the employment's time zone (its location's zone,
 * else its entity's). Punch instants are UTC.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}

const DAYS_OFF = ['public', 'observed', 'company'];
const STALE_MS = 16 * 3600000;
const SHIFT_COLORS = ['grey', 'blue', 'teal', 'ink'];

/* ------------------------------------------------------------- helpers */

function ms(s) {
  if (s === undefined || s === null || s === '') return NaN;
  return Date.parse(String(s).replace(' ', 'T'));
}

function iso(t) {
  return new Date(t).toISOString();
}

function mins(hhmm) {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}

/** Structured facts for approvals and notifications (the kernel's item shape). */
const fact = {
  /** A day, or a range when the days differ. */
  days: (key, label, from, to) => (to === undefined || to === '' || to === from ? { type: 'day', key: key, label: label, value: from } : { type: 'range', key: key, label: label, from: from, to: to }),
  /** Minutes as hours (unit h, two decimals). */
  hours: (key, label, minutes) => ({ type: 'number', key: key, label: label, value: Math.round(((Number(minutes) || 0) / 60) * 100) / 100, unit: 'h' }),
  text: (key, label, value) => ({ type: 'text', key: key, label: label, value: String(value) }),
  state: (key, label, value) => ({ type: 'state', key: key, label: label, value: String(value) }),
  count: (key, label, value) => ({ type: 'number', key: key, label: label, value: Number(value) || 0 }),
};

/** Minutes as "7h 30m". */
function hm(m) {
  const n = Math.max(0, Math.round(Number(m) || 0));
  const h = Math.floor(n / 60);
  const r = n % 60;
  if (h === 0) return r + 'm';
  return r === 0 ? h + 'h' : h + 'h ' + r + 'm';
}

function shiftMinutes(start, end, breakMin) {
  let d = mins(end) - mins(start);
  if (d <= 0) d += 1440;
  return Math.max(0, d - (Number(breakMin) || 0));
}

/** Local HH:MM of an instant in a zone ('' for none). */
function localTime(zone, t) {
  if (!Number.isFinite(t)) return '';
  return u().localAt(zone, t).time;
}

/* ----------------------------------------------------------- bulk reads */

/** Placeholders and binds of an SQL IN list. */
function inList(ids, p) {
  const bind = {};
  const ph = [];
  for (let i = 0; i < ids.length; i++) {
    bind[p + i] = ids[i];
    ph.push('{:' + p + i + '}');
  }
  return { sql: ph.join(', '), bind: bind };
}

/** A list in parts of at most n (IN lists stay short). */
function partsOf(list, n) {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

/** Records of a collection whose `field` is one of `ids` (and `where`), in `order`. */
function recordsIn(app, collection, field, ids, where, bind, order) {
  const out = [];
  for (const part of partsOf(ids, 300)) {
    const q = inList(part, 'i');
    const list = arrayOf(new Record());
    app
      .recordQuery(collection)
      .andWhere($dbx.exp('[[' + field + ']] IN (' + q.sql + ')' + (where ? ' AND ' + where : ''), Object.assign({}, q.bind, bind || {})))
      .orderBy(order)
      .all(list);
    for (const r of list) out.push(r);
  }
  return out;
}

/** Raw rows whose `field` is one of `ids`: `sql` holds {IN} where the list goes. */
function rowsIn(app, sql, shape, ids, bind) {
  const util = u();
  const out = [];
  for (const part of partsOf(ids, 300)) {
    const q = inList(part, 'i');
    for (const r of util.rows(app, sql.replace('{IN}', q.sql), shape, Object.assign({}, q.bind, bind || {}))) out.push(r);
  }
  return out;
}

/**
 * Plain rows (JS objects) of a query as one JSON text per part of the ids:
 * `cols` are the columns, `rest` the SQL after SELECT ... with {IN} where
 * the id list goes. Reading one text instead of many record fields is what
 * makes bulk reads cheap here. Values come back as SQLite holds them
 * (numbers, 0/1 for bools, text).
 */
function plainIn(app, cols, rest, ids, bind) {
  const util = u();
  const obj = 'json_object(' + cols.map((c) => "'" + c + "', [[" + c + ']]').join(', ') + ')';
  const out = [];
  for (const part of partsOf(ids, 300)) {
    const q = inList(part, 'i');
    const r = util.one(app, 'SELECT json_group_array(' + obj + ') AS j ' + rest.replace('{IN}', q.sql), { j: '' }, Object.assign({}, q.bind, bind || {}));
    if (r !== null && r.j !== '') for (const x of JSON.parse(r.j)) out.push(x);
  }
  return out;
}

/** As record.getInt / getString / getBool on a plain value. */
function intOf(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}
function strOf(v) {
  return v === null || v === undefined ? '' : String(v);
}
function boolOf(v) {
  return v === true || v === 1 || v === '1' || v === 'true';
}
/** As util.jsonOf(rec, field, []) || [] on a raw JSON text. */
function flagsOf(raw) {
  const t = strOf(raw);
  if (t === '' || t === 'null') return [];
  try {
    return JSON.parse(t) || [];
  } catch {
    return [];
  }
}

const ATT_COLS = ['employment', 'day', 'status', 'day_kind', 'worked_min', 'night_min', 'expected_min', 'leave_min', 'late_min', 'flags', 'source', 'locked', 'payrun'];

/** The attendance fields day facts read, from a record or a plain row. */
function attFacts(r) {
  if (typeof r.getString === 'function') {
    return { status: r.getString('status'), day_kind: r.getString('day_kind'), worked_min: r.getInt('worked_min'), night_min: r.getInt('night_min'), expected_min: r.getInt('expected_min'), leave_min: r.getInt('leave_min'), late_min: r.getInt('late_min'), flags: u().jsonOf(r, 'flags', []) || [], source: r.getString('source'), locked: r.getBool('locked'), payrun: r.getString('payrun') };
  }
  return { status: strOf(r.status), day_kind: strOf(r.day_kind), worked_min: intOf(r.worked_min), night_min: intOf(r.night_min), expected_min: intOf(r.expected_min), leave_min: intOf(r.leave_min), late_min: intOf(r.late_min), flags: flagsOf(r.flags), source: strOf(r.source), locked: boolOf(r.locked), payrun: strOf(r.payrun) };
}

/* --------------------------------------------------------------- leave */

/**
 * Approved leave of employments by day between two days:
 * { [employmentId]: [{ day, type, name, paid, half: '' | 'am' | 'pm', hours, request }] }
 * (hours > 0 only for part of a day taken by the hour).
 */
function leaveDaysMany(app, ids, from, to) {
  const rows = rowsIn(
    app,
    "SELECT id, employment, type, unit, day_list FROM leave_requests WHERE employment IN ({IN}) AND [[start]] <= {:t} AND [[end]] >= {:f} AND status IN ('approved', 'cancelling') ORDER BY [[start]], rowid",
    { id: '', employment: '', type: '', unit: '', day_list: '' },
    ids,
    { f: from, t: to },
  );
  const types = {};
  const want = [];
  for (const r of rows) if (types[r.type] === undefined && want.indexOf(r.type) < 0 && r.type !== '') want.push(r.type);
  if (want.length > 0) for (const t of rowsIn(app, 'SELECT id, code, name, paid FROM leave_types WHERE id IN ({IN})', { id: '', code: '', name: '', paid: false }, want)) types[t.id] = { code: t.code, name: t.name, paid: t.paid };
  const out = {};
  for (const id of ids) out[id] = [];
  for (const r of rows) {
    const ty = types[r.type] !== undefined ? types[r.type] : { code: '', name: '', paid: true };
    let list = [];
    try {
      list = JSON.parse(r.day_list || '[]');
    } catch {
      list = [];
    }
    for (const d of Array.isArray(list) ? list : []) {
      if (!d || typeof d.day !== 'string' || d.day < from || d.day > to) continue;
      const days = Number(d.days) || 0;
      const hours = Number(d.hours) || 0;
      if (days <= 0 && hours <= 0) continue;
      const half = d.half === 'am' || d.half === 'pm' ? d.half : '';
      if (out[r.employment] === undefined) out[r.employment] = [];
      out[r.employment].push({ day: d.day, type: ty.code, name: ty.name, paid: ty.paid, half: half, hours: half === '' && days < 1 && hours > 0 ? hours : 0, request: r.id });
    }
  }
  return out;
}

/**
 * Approved leave of an employment by day between two days:
 * [{ day, type, name, paid, half: '' | 'am' | 'pm', hours, request }]
 * (hours > 0 only for part of a day taken by the hour).
 */
function leaveDays(app, empId, from, to) {
  return leaveDaysMany(app, [empId], from, to)[empId] || [];
}

/* ------------------------------------------------------------ resolver */

/**
 * A per-call cache of what day plans need (employments with their job
 * records, entities, locations, schedules, holidays, shift types,
 * assignments, leave, rule sets). The calendar and schedule of a day follow
 * the kernel rule: the job record in effect, then the location's calendar,
 * then the entity's defaults.
 *
 * R.preload(ids, from, to) reads, in one query each, what pay inputs for
 * those employments over that period need (see payWindow); the readers
 * below (attRows, tsDays, histRows, punches, pendingCount, sheetStatuses,
 * otApproved) answer from it when it covers the asked range, else they query.
 */
function resolver(app) {
  const util = u();
  const c = { emp: {}, ent: {}, loc: {}, sch: {}, hol: {}, st: {}, asg: {}, leave: {}, rs: {}, rsv: {}, et: {}, today: {}, entToday: {}, asgPre: {}, asgCov: {}, leavePre: {}, jod: {}, zn: {}, so: {}, co: {} };
  let pre = null;
  const R = { app: app };
  const empView = (rec, jobs) => ({
    id: rec.id,
    rec: rec,
    entity: rec.getString('entity'),
    employee: rec.getString('employee'),
    start: rec.getString('start_day'),
    end: rec.getString('end_day'),
    jobs: jobs,
  });
  R.emp = (id) => {
    if (c.emp[id] === undefined) {
      const rec = util.byId(app, 'employments', id);
      if (rec === null) throw util.fail(404, 'No employment ' + id + '.', 'not_found');
      c.emp[id] = empView(rec, util.findMany(app, 'job_records', 'employment = {:e}', 'effective_from', 0, { e: id }));
    }
    return c.emp[id];
  };
  R.entity = (id) => {
    if (c.ent[id] === undefined) c.ent[id] = util.byId(app, 'entities', id);
    return c.ent[id];
  };
  R.location = (id) => {
    if (!id) return null;
    if (c.loc[id] === undefined) c.loc[id] = util.byId(app, 'locations', id);
    return c.loc[id];
  };
  R.jobOn = (id, day) => {
    const k = id + '|' + day;
    if (c.jod[k] === undefined) {
      let best = null;
      for (const j of R.emp(id).jobs) if (j.getString('effective_from') <= day) best = j;
      c.jod[k] = best;
    }
    return c.jod[k];
  };
  /** Zone, schedule and calendar follow from the job in effect: worked out once per job. */
  const jobKey = (id, day) => {
    const j = R.jobOn(id, day);
    return id + '|' + (j !== null ? j.id : '');
  };
  R.locationOn = (id, day) => {
    const j = R.jobOn(id, day);
    return j !== null ? j.getString('location') : '';
  };
  R.schedule = (sid) => {
    if (!sid) return null;
    if (c.sch[sid] === undefined) {
      const r = util.byId(app, 'work_schedules', sid);
      c.sch[sid] = r === null ? null : L('lib_calendar').scheduleView(r);
    }
    return c.sch[sid];
  };
  R.scheduleOn = (id, day) => {
    const k = jobKey(id, day);
    if (c.so[k] === undefined) {
      const j = R.jobOn(id, day);
      const ent = R.entity(R.emp(id).entity);
      const sid = j !== null && j.getString('schedule') !== '' ? j.getString('schedule') : ent ? ent.getString('default_schedule') : '';
      c.so[k] = R.schedule(sid);
    }
    return c.so[k];
  };
  R.calendarOn = (id, day) => {
    const k = jobKey(id, day);
    if (c.co[k] === undefined) {
      const j = R.jobOn(id, day);
      if (j !== null && j.getString('calendar') !== '') c.co[k] = j.getString('calendar');
      else {
        const loc = j !== null ? R.location(j.getString('location')) : null;
        if (loc !== null && loc.getString('calendar') !== '') c.co[k] = loc.getString('calendar');
        else {
          const ent = R.entity(R.emp(id).entity);
          c.co[k] = ent ? ent.getString('default_calendar') : '';
        }
      }
    }
    return c.co[k];
  };
  R.holiday = (calId, day) => {
    if (!calId) return null;
    const key = calId + ':' + day.slice(0, 4);
    if (c.hol[key] === undefined) {
      const map = {};
      for (const h of L('lib_calendar').holidaysBetween(app, calId, day.slice(0, 4) + '-01-01', day.slice(0, 4) + '-12-31')) {
        if (DAYS_OFF.indexOf(h.kind) < 0) continue;
        const prev = map[h.day];
        if (prev === undefined || (prev.half && !h.half)) map[h.day] = { name: h.name, half: h.half, kind: h.kind };
      }
      c.hol[key] = map;
    }
    return c.hol[key][day] || null;
  };
  R.zone = (id, day) => {
    const k = jobKey(id, day);
    if (c.zn[k] === undefined) {
      const loc = R.location(R.locationOn(id, day));
      if (loc !== null && loc.getString('timezone') !== '') c.zn[k] = loc.getString('timezone');
      else {
        const ent = R.entity(R.emp(id).entity);
        c.zn[k] = ent && ent.getString('timezone') !== '' ? ent.getString('timezone') : 'UTC';
      }
    }
    return c.zn[k];
  };
  R.today = (id) => {
    if (c.today[id] === undefined) {
      const ent = R.emp(id).entity;
      if (c.entToday[ent] === undefined) {
        // As util.today: the entity's zone, else the company's first zone.
        const er = R.entity(ent);
        c.entToday[ent] = er !== null && er.getString('timezone') !== '' ? util.localAt(er.getString('timezone'), Date.now()).day : util.today(app, ent);
      }
      c.today[id] = util.localAt(R.zone(id, c.entToday[ent]), Date.now()).day;
    }
    return c.today[id];
  };
  R.shiftType = (sid) => {
    if (!sid) return null;
    if (c.st[sid] === undefined) {
      const r = util.byId(app, 'shift_types', sid);
      c.st[sid] = r === null ? null : shiftTypeView(r);
    }
    return c.st[sid];
  };
  const covers = (r, from, to) => r !== undefined && from >= r[0] && to <= r[1];
  /** Assignments of an employment by day (prefetch a range with loadAssignments). */
  R.loadAssignments = (id, from, to) => {
    if (covers(c.asgPre[id], from, to)) return;
    if (c.asg[id] === undefined) c.asg[id] = {};
    for (const r of util.findMany(app, 'shift_assignments', 'employment = {:e} && day >= {:f} && day <= {:t}', 'day', 0, { e: id, f: from, t: to })) c.asg[id][r.getString('day')] = r;
    if (c.asgCov[id] === undefined) c.asgCov[id] = [];
    c.asgCov[id].push([from, to]);
  };
  R.assignment = (id, day) => {
    if (c.asg[id] === undefined || c.asg[id][day] === undefined) {
      const loaded = c.asgCov[id] !== undefined && c.asgCov[id].some((r) => day >= r[0] && day <= r[1]);
      if (!loaded) {
        if (c.asg[id] === undefined) c.asg[id] = {};
        c.asg[id][day] = util.findOne(app, 'shift_assignments', 'employment = {:e} && day = {:d}', { e: id, d: day });
      }
    }
    return c.asg[id][day] || null;
  };
  const addLeave = (id, list, from, to) => {
    if (c.leave[id] === undefined) c.leave[id] = { ranges: [], days: {} };
    for (const x of list) {
      const prev = c.leave[id].days[x.day];
      if (prev === undefined || (!x.half && !(x.hours > 0))) c.leave[id].days[x.day] = x;
    }
    c.leave[id].ranges.push([from, to]);
  };
  /** Approved leave by day, from the leave module. */
  R.loadLeave = (id, from, to) => {
    if (covers(c.leavePre[id], from, to)) return;
    addLeave(id, leaveDays(app, id, from, to), from, to);
  };
  R.leaveOn = (id, day) => {
    if (c.leave[id] === undefined || !c.leave[id].ranges.some((r) => day >= r[0] && day <= r[1])) R.loadLeave(id, day, day);
    return c.leave[id].days[day] || null;
  };
  R.employmentType = (id, day) => {
    const j = R.jobOn(id, day);
    const et = j !== null ? j.getString('employment_type') : '';
    if (!et) return '';
    if (c.et[et] === undefined) {
      const r = util.byId(app, 'employment_types', et);
      c.et[et] = r === null ? '' : r.getString('code');
    }
    return c.et[et];
  };
  R.ruleSet = (id, day) => {
    const e = R.emp(id);
    if (c.rs[e.entity] === undefined) c.rs[e.entity] = util.findMany(app, 'overtime_rules', 'entity = {:e} && active = true', 'created', 0, { e: e.entity });
    const code = R.employmentType(id, day);
    const key = e.entity + '|' + code;
    if (c.rsv[key] !== undefined) return c.rsv[key];
    let pick = null;
    for (const r of c.rs[e.entity]) {
      const ap = util.jsonOf(r, 'applies', {}) || {};
      const types = Array.isArray(ap.employment_types) ? ap.employment_types : [];
      if (types.length > 0 && code !== '' && types.indexOf(code) >= 0) {
        pick = r;
        break;
      }
    }
    if (pick === null) {
      for (const r of c.rs[e.entity]) {
        const ap = util.jsonOf(r, 'applies', {}) || {};
        if (!Array.isArray(ap.employment_types) || ap.employment_types.length === 0) {
          pick = r;
          break;
        }
      }
    }
    c.rsv[key] = ruleSetView(pick, R.entity(e.entity));
    return c.rsv[key];
  };

  /* Readers that answer from a preload when it covers the range. */
  const preHas = (id, range, from, to) => pre !== null && pre.ids[id] === true && range !== null && from >= range[0] && to <= range[1];
  /** Saved attendance of an employment by day (the fields day facts read, see attFacts). */
  R.attRows = (id, from, to) => {
    const out = {};
    if (preHas(id, pre && pre.attRange, from, to)) {
      const m = pre.att[id] || {};
      for (const d of Object.keys(m)) if (d >= from && d <= to) out[d] = attFacts(m[d]);
      return out;
    }
    for (const r of util.findMany(app, 'attendance', 'employment = {:e} && day >= {:f} && day <= {:t}', 'day', 0, { e: id, f: from, t: to })) out[r.getString('day')] = attFacts(r);
    return out;
  };
  /** Minutes by day from approved timesheets (0 for a day of an approved week without hours). */
  R.tsDays = (id, from, to) => {
    const ts = {};
    if (preHas(id, pre && pre.sheetRange, from, to)) {
      for (const s of pre.sheets[id] || []) {
        if (s.status !== 'approved' || s.period_end < from || s.period_start > to) continue;
        for (const d of Object.keys(s.entries)) ts[d] = (ts[d] || 0) + s.entries[d];
        for (let d = s.period_start; d <= s.period_end; d = util.dayAdd(d, 1)) if (ts[d] === undefined) ts[d] = 0;
      }
      return ts;
    }
    for (const t of util.findMany(app, 'timesheets', "employment = {:e} && status = 'approved' && period_end >= {:f} && period_start <= {:t}", 'period_start', 0, { e: id, f: from, t: to })) {
      for (const x of util.findMany(app, 'timesheet_entries', "timesheet = {:t} && (kind = 'regular' || kind = 'overtime')", 'day', 0, { t: t.id })) {
        const d = x.getString('day');
        ts[d] = (ts[d] || 0) + x.getInt('minutes');
      }
      for (let d = t.getString('period_start'); d <= t.getString('period_end'); d = util.dayAdd(d, 1)) if (ts[d] === undefined) ts[d] = 0;
    }
    return ts;
  };
  const HIST_COLS = ['employment', 'day', 'day_kind', 'worked_min', 'leave_min'];
  const HIST_SQL = "FROM attendance WHERE employment IN ({IN}) AND day >= {:f} AND day <= {:t} AND status != ''";
  const histRow = (r) => ({ day_kind: strOf(r.day_kind), worked_min: intOf(r.worked_min), leave_min: intOf(r.leave_min) });
  /** Saved attendance with a status, narrow: { day: { day_kind, worked_min, leave_min } }. */
  R.histRows = (id, from, to) => {
    if (preHas(id, pre && pre.histRange, from, to) && pre.histIds[id] === true) {
      const out = {};
      const m = pre.hist[id] || {};
      for (const d of Object.keys(m)) if (d >= from && d <= to) out[d] = m[d];
      return out;
    }
    const out = {};
    for (const r of plainIn(app, HIST_COLS, HIST_SQL, [id], { f: from, t: to })) out[strOf(r.day)] = histRow(r);
    return out;
  };
  const PUNCH_SQL = 'SELECT id, employment, day, at, kind, flagged, source FROM checkins WHERE employment IN ({IN}) AND day >= {:f} AND day <= {:t} AND voided = FALSE ORDER BY at, created';
  /** Non-voided punches between two local days, oldest first (as punchesBetween). */
  R.punches = (id, from, to) => {
    if (!preHas(id, pre && pre.punchRange, from, to)) return punchesBetween(app, id, from, to);
    if (pre.punches === null) {
      pre.punches = {};
      for (const r of rowsIn(app, PUNCH_SQL, { id: '', employment: '', day: '', at: '', kind: '', flagged: false, source: '' }, pre.list, { f: pre.punchRange[0], t: pre.punchRange[1] })) {
        if (pre.punches[r.employment] === undefined) pre.punches[r.employment] = [];
        pre.punches[r.employment].push({ day: r.day, id: r.id, t: ms(r.at), kind: r.kind, flagged: r.flagged, source: r.source });
      }
    }
    const out = [];
    for (const p of pre.punches[id] || []) if (p.day >= from && p.day <= to) out.push({ id: p.id, t: p.t, kind: p.kind, flagged: p.flagged, source: p.source });
    return out;
  };
  /** Days up to `to` a locked run used that changed afterwards (open adjustments), oldest first. */
  R.adjustedDays = (id, to) => {
    if (pre !== null && pre.adjIds[id] === true) return (pre.adj[id] || []).filter((d) => d <= to).sort();
    return util.rows(app, 'SELECT day FROM attendance WHERE employment = {:e} AND adjusted_after_lock = TRUE AND locked = TRUE AND day <= {:t} ORDER BY day', { day: '' }, { e: id, t: to }).map((r) => r.day);
  };
  /** Pending attendance requests touching the days f..t. */
  R.pendingCount = (id, f, t) => {
    if (pre !== null && pre.ids[id] === true) {
      let n = 0;
      for (const r of pre.pending[id] || []) if (r.from_day <= t && (r.to_day === '' || r.to_day >= f || r.from_day >= f)) n++;
      return n;
    }
    return util.count(app, "SELECT COUNT(*) AS n FROM attendance_requests WHERE employment = {:e} AND status = 'pending' AND from_day <= {:t} AND (to_day = '' OR to_day >= {:f} OR from_day >= {:f})", { e: id, f: f, t: t });
  };
  /** Timesheet status by week start, for sheets touching f..t. */
  R.sheetStatuses = (id, f, t) => {
    const out = {};
    if (preHas(id, pre && pre.sheetRange, f, t)) {
      for (const s of pre.sheets[id] || []) if (s.period_end >= f && s.period_start <= t) out[s.period_start] = s.status;
      return out;
    }
    for (const s of util.findMany(app, 'timesheets', 'employment = {:e} && period_end >= {:f} && period_start <= {:t}', 'period_start', 0, { e: id, f: f, t: t })) out[s.getString('period_start')] = s.getString('status');
    return out;
  };
  /** Approved overtime minutes by day (overtime asked for in advance). */
  R.otApproved = (id, f, t) => {
    const out = {};
    if (preHas(id, pre && pre.otRange, f, t)) {
      if (pre.ot === null) {
        pre.ot = {};
        for (const r of rowsIn(app, "SELECT employment, day, approved_min FROM overtime_requests WHERE employment IN ({IN}) AND status = 'approved' AND day >= {:f} AND day <= {:t} ORDER BY day", { employment: '', day: '', approved_min: 0 }, pre.list, { f: pre.otRange[0], t: pre.otRange[1] })) {
          if (pre.ot[r.employment] === undefined) pre.ot[r.employment] = [];
          pre.ot[r.employment].push(r);
        }
      }
      for (const r of pre.ot[id] || []) if (r.day >= f && r.day <= t) out[r.day] = (out[r.day] || 0) + r.approved_min;
      return out;
    }
    for (const r of util.findMany(app, 'overtime_requests', "employment = {:e} && status = 'approved' && day >= {:f} && day <= {:t}", 'day', 0, { e: id, f: f, t: t })) out[r.getString('day')] = (out[r.getString('day')] || 0) + r.getInt('approved_min');
    return out;
  };

  /**
   * Read, in one query each, what pay inputs of these employments over
   * from..to need: the employments and job records, then over the union of
   * their windows (payWindow) the shift assignments, approved leave, saved
   * attendance (and the narrow history the overtime limits look back on),
   * timesheets with their approved hours and pending attendance requests.
   * Punches and approved overtime requests are read the first time one is
   * needed, for all of them at once.
   */
  const uniq = (ids) => {
    const seen = {};
    const list = [];
    for (const id of ids || []) {
      if (typeof id !== 'string' || id === '' || seen[id]) continue;
      seen[id] = true;
      list.push(id);
    }
    return list;
  };
  /** Employments with their job records, for the ids not read yet (one query each). */
  const loadEmps = (list) => {
    const missing = list.filter((id) => c.emp[id] === undefined);
    if (missing.length === 0) return;
    const jobs = {};
    for (const j of recordsIn(app, 'job_records', 'employment', missing, '', {}, 'effective_from ASC')) {
      const k = j.getString('employment');
      if (jobs[k] === undefined) jobs[k] = [];
      jobs[k].push(j);
    }
    for (const rec of recordsIn(app, 'employments', 'id', missing, '', {}, 'id ASC')) c.emp[rec.id] = empView(rec, jobs[rec.id] || []);
  };
  /** Shift assignments and approved leave of employments over lo..hi (one query each). */
  const loadPlans = (list, lo, hi) => {
    for (const id of list) if (c.asg[id] === undefined) c.asg[id] = {};
    for (const r of recordsIn(app, 'shift_assignments', 'employment', list, 'day >= {:f} AND day <= {:t}', { f: lo, t: hi }, 'day ASC')) c.asg[r.getString('employment')][r.getString('day')] = r;
    for (const id of list) {
      if (c.asgCov[id] === undefined) c.asgCov[id] = [];
      c.asgCov[id].push([lo, hi]);
      c.asgPre[id] = [lo, hi];
    }
    const lv = leaveDaysMany(app, list, lo, hi);
    for (const id of list) {
      addLeave(id, lv[id] || [], lo, hi);
      c.leavePre[id] = [lo, hi];
    }
  };
  /** What day plans of these employments over from..to need, read together (the board, views of many people). */
  R.preloadPlans = (ids, from, to) => {
    const list = uniq(ids);
    if (list.length === 0) return;
    loadEmps(list);
    const have = list.filter((id) => c.emp[id] !== undefined);
    if (have.length > 0) loadPlans(have, from, to);
  };
  R.preload = (ids, from, to) => {
    const list = uniq(ids);
    const P = { ids: {}, list: [], histIds: {}, attRange: null, histRange: null, sheetRange: null, punchRange: null, otRange: null, att: {}, hist: {}, sheets: {}, pending: {}, punches: null, ot: null, adjIds: {}, adj: {} };
    if (list.length === 0) {
      pre = P;
      return;
    }
    loadEmps(list);
    // Days earlier runs locked that changed afterwards (open adjustments), for everyone asked.
    for (const id of list) P.adjIds[id] = true;
    for (const r of plainIn(app, ['employment', 'day'], 'FROM attendance WHERE employment IN ({IN}) AND adjusted_after_lock = TRUE AND locked = TRUE ORDER BY day', list, {})) {
      const k = strOf(r.employment);
      if (P.adj[k] === undefined) P.adj[k] = [];
      P.adj[k].push(strOf(r.day));
    }
    const lo = (a, b) => (a === null || b < a ? b : a);
    const hi = (a, b) => (a === null || b > a ? b : a);
    let cLo = null;
    let cHi = null;
    let hLo = null;
    let hHi = null;
    let fLo = null;
    let tHi = null;
    const hist = [];
    for (const id of list) {
      if (c.emp[id] === undefined) continue;
      const w = payWindow(R, id, from, to);
      if (w.empty) continue;
      P.ids[id] = true;
      P.list.push(id);
      cLo = lo(cLo, w.ctxFrom);
      cHi = hi(cHi, w.ctxTo);
      fLo = lo(fLo, w.f);
      tHi = hi(tHi, w.t);
      if (w.hist !== null && w.hist[0] <= w.hist[1]) {
        P.histIds[id] = true;
        hist.push(id);
        hLo = lo(hLo, w.hist[0]);
        hHi = hi(hHi, w.hist[1]);
      }
    }
    pre = P;
    if (P.list.length === 0) return;
    const L2 = P.list;
    loadPlans(L2, cLo, cHi);
    // Saved attendance over the windows.
    for (const r of plainIn(app, ATT_COLS, 'FROM attendance WHERE employment IN ({IN}) AND day >= {:f} AND day <= {:t}', L2, { f: cLo, t: cHi })) {
      const k = strOf(r.employment);
      if (P.att[k] === undefined) P.att[k] = {};
      P.att[k][strOf(r.day)] = r;
    }
    P.attRange = [cLo, cHi];
    // The history overtime limits look back on (narrow rows).
    if (hist.length > 0) {
      for (const r of plainIn(app, HIST_COLS, HIST_SQL, hist, { f: hLo, t: hHi })) {
        const k = strOf(r.employment);
        if (P.hist[k] === undefined) P.hist[k] = {};
        P.hist[k][strOf(r.day)] = histRow(r);
      }
      P.histRange = [hLo, hHi];
    }
    // Timesheets touching any window, with the hours of the approved ones.
    const sLo = hLo !== null && hLo < cLo ? hLo : cLo;
    const byId = {};
    for (const s of rowsIn(app, 'SELECT id, employment, period_start, period_end, status FROM timesheets WHERE employment IN ({IN}) AND period_end >= {:f} AND period_start <= {:t} ORDER BY period_start', { id: '', employment: '', period_start: '', period_end: '', status: '' }, L2, { f: sLo, t: cHi })) {
      const v = { id: s.id, period_start: s.period_start, period_end: s.period_end, status: s.status, entries: {} };
      byId[s.id] = v;
      if (P.sheets[s.employment] === undefined) P.sheets[s.employment] = [];
      P.sheets[s.employment].push(v);
    }
    const approved = Object.keys(byId).filter((k) => byId[k].status === 'approved');
    if (approved.length > 0) {
      for (const x of rowsIn(app, "SELECT timesheet, day, minutes FROM timesheet_entries WHERE timesheet IN ({IN}) AND (kind = 'regular' OR kind = 'overtime')", { timesheet: '', day: '', minutes: 0 }, approved)) {
        const s = byId[x.timesheet];
        s.entries[x.day] = (s.entries[x.day] || 0) + x.minutes;
      }
    }
    P.sheetRange = [sLo, cHi];
    for (const r of rowsIn(app, "SELECT employment, from_day, to_day FROM attendance_requests WHERE employment IN ({IN}) AND status = 'pending'", { employment: '', from_day: '', to_day: '' }, L2)) {
      if (P.pending[r.employment] === undefined) P.pending[r.employment] = [];
      P.pending[r.employment].push(r);
    }
    P.punchRange = [util.dayAdd(cLo, -1), util.dayAdd(cHi, 1)];
    P.otRange = [fLo, tHi];
  };
  return R;
}

function ruleSetView(rec, ent) {
  const util = u();
  const rules = L('lib_time_rules');
  const settings = rules.normaliseSettings(rec !== null ? util.jsonOf(rec, 'settings', {}) || {} : {});
  if (settings.week_start === null) settings.week_start = ent ? ent.getInt('week_start') : 1;
  if (settings.unapproved === '') settings.unapproved = settings.timesheets === 'required' ? 'blocker' : 'warning';
  return {
    id: rec !== null ? rec.id : '',
    name: rec !== null ? rec.getString('name') : '',
    rules: rec !== null ? util.jsonOf(rec, 'rules', []) || [] : [],
    settings: settings,
    caps: rec !== null ? util.jsonOf(rec, 'caps', {}) || {} : {},
  };
}

/* --------------------------------------------------------------- views */

function shiftTypeView(r) {
  return {
    id: r.id,
    entity: r.getString('entity'),
    name: r.getString('name'),
    code: r.getString('code'),
    start: r.getString('start'),
    end: r.getString('end'),
    break_min: r.getInt('break_min'),
    minutes: shiftMinutes(r.getString('start'), r.getString('end'), r.getInt('break_min')),
    color: r.getString('color') || 'grey',
    overnight: r.getBool('overnight'),
    grace_in_min: r.getInt('grace_in_min'),
    grace_out_min: r.getInt('grace_out_min'),
    half_day_below_min: r.getInt('half_day_below_min'),
    absent_below_min: r.getInt('absent_below_min'),
    auto_attendance: r.getBool('auto_attendance'),
    location: r.getString('location'),
    sort: r.getInt('sort'),
    archived: r.getBool('archived'),
  };
}

function checkinView(r, zone) {
  const util = u();
  const t = ms(r.getString('at'));
  return {
    id: r.id,
    employment: r.getString('employment'),
    at: r.getString('at'),
    day: r.getString('day'),
    time: localTime(zone, t),
    kind: r.getString('kind'),
    source: r.getString('source'),
    location: r.getString('location'),
    lat: r.getFloat('lat'),
    lng: r.getFloat('lng'),
    accuracy_m: r.getInt('accuracy_m'),
    distance_m: r.getInt('distance_m'),
    flagged: r.getBool('flagged'),
    flags: util.jsonOf(r, 'flags', []) || [],
    note: r.getString('note'),
    device: r.getString('device'),
    by_member: r.getString('by_member'),
    voided: r.getBool('voided'),
    void_reason: r.getString('void_reason'),
    replaces: r.getString('replaces'),
    created: r.getString('created'),
  };
}

function attendanceView(r, zone) {
  const util = u();
  return {
    id: r.id,
    employment: r.getString('employment'),
    day: r.getString('day'),
    status: r.getString('status'),
    day_kind: r.getString('day_kind'),
    shift_type: r.getString('shift_type'),
    first_in: r.getString('first_in'),
    last_out: r.getString('last_out'),
    first_in_time: localTime(zone, ms(r.getString('first_in'))),
    last_out_time: localTime(zone, ms(r.getString('last_out'))),
    worked_min: r.getInt('worked_min'),
    break_min: r.getInt('break_min'),
    expected_min: r.getInt('expected_min'),
    late_min: r.getInt('late_min'),
    early_min: r.getInt('early_min'),
    overtime_min: r.getInt('overtime_min'),
    night_min: r.getInt('night_min'),
    leave_type: r.getString('leave_type'),
    leave_half: r.getString('leave_half'),
    leave_min: r.getInt('leave_min'),
    source: r.getString('source'),
    locked: r.getBool('locked'),
    payrun: r.getString('payrun'),
    flags: util.jsonOf(r, 'flags', []) || [],
    note: r.getString('note'),
    computed_at: r.getString('computed_at'),
    adjusted_after_lock: r.getBool('adjusted_after_lock'),
    after_lock: util.jsonOf(r, 'after_lock', null),
    updated: r.getString('updated'),
  };
}

/* ---------------------------------------------------------------- plan */

/**
 * The plan of one day: { day, kind: 'work'|'rest'|'holiday'|'outside', source: 'shift'|'schedule'|'none',
 * shift_type, shift_name, start, end, overnight, break_min, expected_min, normal_min, grace_in, grace_out,
 * flexible, holiday, half_day_below, absent_below, location, zone, published, draft }.
 * Only what was published counts: a draft shift is not part of the plan yet.
 */
function planOf(R, empId, day) {
  const util = u();
  const e = R.emp(empId);
  const zone = R.zone(empId, day);
  const base = { day: day, kind: 'outside', source: 'none', shift_type: '', shift_name: '', shift_code: '', start: '', end: '', overnight: false, break_min: 0, expected_min: 0, normal_min: 0, grace_in: 0, grace_out: 0, flexible: false, holiday: null, half_day_below: 0, absent_below: 0, location: R.locationOn(empId, day), zone: zone, draft: null };
  if (day < e.start || (e.end !== '' && day > e.end)) return base;
  const asg = R.assignment(empId, day);
  const snap = asg !== null ? util.jsonOf(asg, 'published', null) : null;
  const shift = snap && snap.shift_type ? R.shiftType(snap.shift_type) : null;
  if (asg !== null && asg.getString('status') !== 'published') base.draft = { status: asg.getString('status'), shift_type: asg.getString('shift_type') };
  const sch = R.scheduleOn(empId, day);
  const hol = R.holiday(R.calendarOn(empId, day), day);
  const cal = L('lib_calendar');
  const dow = util.weekday(day);
  const rows = sch ? (sch.week || []).filter((r) => Number(r.dow) === dow) : [];
  const p = base;
  p.flexible = sch ? sch.flexible === true : false;
  p.grace_in = sch ? sch.grace_min || 0 : 0;
  p.holiday = hol;
  if (shift !== null) {
    p.source = 'shift';
    p.shift_type = shift.id;
    p.shift_name = shift.name;
    p.shift_code = shift.code;
    p.start = shift.start;
    p.end = shift.end;
    p.break_min = shift.break_min;
    p.expected_min = shift.minutes;
    p.normal_min = shift.minutes;
    p.grace_in = shift.grace_in_min;
    p.grace_out = shift.grace_out_min;
    p.half_day_below = shift.half_day_below_min;
    p.absent_below = shift.absent_below_min;
    p.flexible = false;
    if (snap.location) p.location = snap.location;
    else if (shift.location) p.location = shift.location;
  } else if (rows.length > 0) {
    p.source = 'schedule';
    const sorted = rows.slice().sort((a, b) => (a.start < b.start ? -1 : 1));
    p.start = sorted[0].start;
    p.end = sorted[sorted.length - 1].end;
    p.break_min = rows.reduce((t, r) => t + (Number(r.break_min) || 0), 0);
    p.expected_min = cal.weekMinutes(sch.week, day);
    p.normal_min = p.expected_min;
  }
  p.overnight = p.start !== '' && p.end !== '' && p.end <= p.start;
  if (hol !== null && !hol.half) {
    p.kind = 'holiday';
    if (shift === null) p.expected_min = 0;
  } else if (hol !== null && hol.half) {
    p.kind = 'work';
    if (shift === null) p.expected_min = Math.round(p.expected_min / 2);
  } else p.kind = p.expected_min > 0 || shift !== null ? 'work' : 'rest';
  const pl = p.location !== '' ? R.location(p.location) : null;
  if (pl !== null && pl.getString('timezone') !== '') p.zone = pl.getString('timezone');
  return p;
}

/* ----------------------------------------------------------- punches */

/** Non-voided punches of an employment between two local days, oldest first. */
function punchesBetween(app, empId, from, to) {
  return u()
    .findMany(app, 'checkins', 'employment = {:e} && day >= {:f} && day <= {:t} && voided = false', 'at,created', 0, { e: empId, f: from, t: to })
    .map((r) => ({ id: r.id, t: ms(r.getString('at')), kind: r.getString('kind'), flagged: r.getBool('flagged'), source: r.getString('source') }));
}

/**
 * Work sessions from punches: [{ in, out, breaks: [[a, b]], open, orphan, ids, flagged }].
 * An `in` while a session is open closes the old one as open (missed out);
 * an `out` with no session is an orphan (missed in).
 */
function sessionsOf(punches) {
  const out = [];
  let cur = null;
  for (const p of punches) {
    if (p.kind === 'in') {
      if (cur !== null) {
        cur.open = true;
        out.push(cur);
      }
      cur = { in: p.t, out: null, breaks: [], brk: null, open: false, orphan: false, flagged: p.flagged };
    } else if (p.kind === 'break_start') {
      if (cur !== null && cur.brk === null) cur.brk = p.t;
    } else if (p.kind === 'break_end') {
      if (cur !== null && cur.brk !== null) {
        cur.breaks.push([cur.brk, p.t]);
        cur.brk = null;
      }
    } else if (p.kind === 'out') {
      if (cur !== null) {
        if (cur.brk !== null) {
          cur.breaks.push([cur.brk, p.t]);
          cur.brk = null;
        }
        cur.out = p.t;
        cur.flagged = cur.flagged || p.flagged;
        out.push(cur);
        cur = null;
      } else out.push({ in: null, out: p.t, breaks: [], brk: null, open: false, orphan: true, flagged: p.flagged });
    }
  }
  if (cur !== null) {
    cur.open = true;
    out.push(cur);
  }
  return out;
}

/**
 * The sessions of a punch list that start on a local day (an orphan out
 * counts on its own day), in order. The sessions and their days are worked
 * out once per list and zone (computeDay runs for every day of a range).
 */
function sessionsOn(punches, zone, day) {
  if (punches.__sessions === undefined) {
    punches.__sessions = sessionsOf(punches);
    punches.__byZone = {};
  }
  if (punches.__byZone[zone] === undefined) {
    const util = u();
    const m = {};
    for (const s of punches.__sessions) {
      const d = util.localAt(zone, s.in !== null ? s.in : s.out).day;
      if (m[d] === undefined) m[d] = [];
      m[d].push(s);
    }
    punches.__byZone[zone] = m;
  }
  return punches.__byZone[zone][day] || [];
}

/** Work segments of a session (the session minus its breaks). */
function segmentsOf(s) {
  const segs = [];
  let a = s.in;
  const brks = s.breaks.slice().sort((x, y) => x[0] - y[0]);
  for (const b of brks) {
    if (b[0] > a) segs.push([a, Math.min(b[0], s.out)]);
    a = Math.max(a, b[1]);
  }
  if (s.out > a) segs.push([a, s.out]);
  return segs;
}

/** Minutes of work segments inside the night window (from, to HH:MM) around a local day. */
function nightMinutes(segs, win, zone, day) {
  if (!win || segs.length === 0) return 0;
  const util = u();
  let t = 0;
  for (let k = -1; k <= 1; k++) {
    const d = util.dayAdd(day, k);
    const a = util.utcOf(zone, d, win.from);
    const b = util.utcOf(zone, win.to <= win.from ? util.dayAdd(d, 1) : d, win.to);
    for (const s of segs) t += Math.max(0, Math.min(s[1], b) - Math.max(s[0], a));
  }
  return Math.round(t / 60000);
}

/* --------------------------------------------------------- the day */

/**
 * Compute one day's attendance from the plan, punches and leave (nothing
 * saved). `punches` covers at least the day before to the day after.
 * Returns the attendance values, or { status: '' } when nothing is known yet
 * (a working day today before the shift has ended, with no punch).
 */
function computeDay(R, empId, day, punches, now) {
  const util = u();
  const plan = planOf(R, empId, day);
  if (plan.kind === 'outside') return null;
  const rs = R.ruleSet(empId, day);
  const zone = plan.zone;
  const today = R.today(empId);
  const ss = sessionsOn(punches, zone, day);
  const lv = R.leaveOn(empId, day);
  const flags = [];
  let workedMs = 0;
  let breakMs = 0;
  let first = null;
  let last = null;
  let complete = 0;
  const segs = [];
  for (const s of ss) {
    if (s.flagged && flags.indexOf('outside_geofence') < 0) flags.push('outside_geofence');
    if (s.orphan) {
      flags.push('missed_in');
      last = last === null ? s.out : Math.max(last, s.out);
      continue;
    }
    first = first === null ? s.in : Math.min(first, s.in);
    if (s.out === null) {
      flags.push(now - s.in < STALE_MS && day >= util.dayAdd(today, -1) ? 'open' : 'missed_out');
      continue;
    }
    last = last === null ? s.out : Math.max(last, s.out);
    let b = 0;
    for (const br of s.breaks) b += Math.max(0, br[1] - br[0]);
    breakMs += b;
    workedMs += Math.max(0, s.out - s.in - b);
    complete++;
    for (const sg of segmentsOf(s)) segs.push(sg);
  }
  let worked = Math.round(workedMs / 60000);
  let brk = Math.round(breakMs / 60000);
  if (complete > 0 && brk === 0 && plan.break_min > 0 && worked > rs.settings.auto_break_after_min) {
    worked = Math.max(0, worked - plan.break_min);
    brk = plan.break_min;
    flags.push('auto_break');
  }
  // Leave changes what was expected.
  let expected = plan.expected_min;
  let leaveMin = 0;
  if (lv !== null) {
    if (lv.hours > 0) {
      leaveMin = Math.round(lv.hours * 60);
      expected = Math.max(0, expected - leaveMin);
    } else if (lv.half) {
      leaveMin = Math.round(plan.normal_min / 2);
      expected = Math.round(expected / 2);
    } else {
      leaveMin = plan.normal_min;
      expected = 0;
    }
  }
  let late = 0;
  let early = 0;
  const tracked = plan.start !== '' && !plan.flexible && lv === null && plan.kind !== 'rest' && !(plan.kind === 'holiday' && plan.source !== 'shift');
  if (tracked && first !== null) {
    const startAt = util.utcOf(zone, day, plan.start);
    if (first - startAt > plan.grace_in * 60000) late = Math.round((first - startAt) / 60000);
  }
  if (tracked && last !== null && flags.indexOf('open') < 0 && flags.indexOf('missed_out') < 0) {
    const endAt = util.utcOf(zone, plan.overnight ? util.dayAdd(day, 1) : day, plan.end);
    if (endAt - last > plan.grace_out * 60000) early = Math.round((endAt - last) / 60000);
  }
  const night = nightMinutes(segs, L('lib_time_rules').nightWindow(rs.rules), zone, day);
  const hasPunch = ss.length > 0;
  let status = '';
  if (lv !== null && !lv.half && !(lv.hours > 0)) {
    status = 'on_leave';
    if (worked > 0) flags.push('worked_on_leave');
  } else if (!hasPunch) {
    if (lv !== null) {
      status = 'half_day';
      if (rs.settings.tracking === 'exception' && plan.kind === 'work') {
        worked = expected;
        flags.push('no_clock');
      }
    } else if (plan.kind === 'holiday') status = 'holiday';
    else if (plan.kind === 'rest') status = 'weekly_off';
    else if (rs.settings.tracking === 'exception') {
      if (day > today) return { status: '' };
      status = 'present';
      worked = expected;
      flags.push('no_clock');
    } else {
      const endAt = plan.end !== '' ? util.utcOf(zone, plan.overnight ? util.dayAdd(day, 1) : day, plan.end) : util.utcOf(zone, util.dayAdd(day, 1), '00:00');
      if (day < today || now > endAt + 3600000) status = 'absent';
      else return { status: '' };
    }
  } else {
    status = lv !== null ? 'half_day' : 'present';
    const broken = flags.indexOf('missed_in') >= 0 || flags.indexOf('missed_out') >= 0 || flags.indexOf('open') >= 0;
    if (lv === null && !broken && plan.kind === 'work' && plan.half_day_below > 0 && worked < plan.half_day_below) status = plan.absent_below > 0 && worked < plan.absent_below ? 'absent' : 'half_day';
  }
  return {
    employment: empId,
    day: day,
    status: status,
    day_kind: plan.kind,
    shift_type: plan.shift_type,
    first_in: first !== null ? iso(first) : '',
    last_out: last !== null ? iso(last) : '',
    worked_min: worked,
    break_min: brk,
    expected_min: expected,
    late_min: late,
    early_min: early,
    overtime_min: plan.kind === 'work' ? Math.max(0, worked - expected) : worked,
    night_min: night,
    leave_type: lv !== null ? String(lv.type || '') : '',
    leave_half: lv !== null && lv.half ? String(lv.half) : '',
    leave_min: leaveMin,
    flags: flags,
  };
}

const FIELDS = ['status', 'day_kind', 'shift_type', 'first_in', 'last_out', 'worked_min', 'break_min', 'expected_min', 'late_min', 'early_min', 'overtime_min', 'night_min', 'leave_type', 'leave_half', 'leave_min', 'flags'];

function sameAs(rec, v) {
  for (const k of FIELDS) {
    const cur = k === 'flags' ? JSON.stringify(u().jsonOf(rec, 'flags', []) || []) : k === 'first_in' || k === 'last_out' ? String(ms(rec.getString(k)) || '') : String(rec.get(k));
    const want = k === 'flags' ? JSON.stringify(v.flags || []) : k === 'first_in' || k === 'last_out' ? String(ms(v[k]) || '') : String(v[k]);
    if (cur !== want) return false;
  }
  return true;
}

/** The attendance values (FIELDS) of a row. */
function valuesOf(rec) {
  const v = {};
  for (const k of FIELDS) v[k] = k === 'flags' ? u().jsonOf(rec, 'flags', []) || [] : /_min$/.test(k) ? rec.getInt(k) : rec.getString(k);
  return v;
}

/** The attendance values (FIELDS) of a computed day. */
function pickValues(v) {
  const out = {};
  for (const k of FIELDS) out[k] = k === 'flags' ? (v.flags || []).slice() : v[k];
  return out;
}

function sameValues(a, b) {
  for (const k of FIELDS) {
    const x = k === 'flags' ? JSON.stringify(a.flags || []) : k === 'first_in' || k === 'last_out' ? String(ms(a[k]) || '') : String(a[k]);
    const y = k === 'flags' ? JSON.stringify(b.flags || []) : k === 'first_in' || k === 'last_out' ? String(ms(b[k]) || '') : String(b[k]);
    if (x !== y) return false;
  }
  return true;
}

/** What a locked day counts as paid: the latest adjustment a later run paid, else the row as its run locked it. */
function baselineOf(rec, log0) {
  const log = log0 !== undefined ? log0 : u().jsonOf(rec, 'adjust_log', []) || [];
  const last = Array.isArray(log) && log.length > 0 ? log[log.length - 1] : null;
  return last !== null && last.values ? last.values : valuesOf(rec);
}

/**
 * A fact changed a day a locked run already used (a punch, or an approved
 * attendance or shift request): the row keeps what was paid, after_lock holds
 * what the day is now ({ ...values, source: 'auto' | 'request' }), and
 * adjusted_after_lock says there is a difference the next run pays (payInputs
 * adjustments). Once a request decided the day, punches no longer change it
 * (as for an open day set by a request).
 */
function noteAfterLock(app, rec, v, source) {
  const src = source === 'request' ? 'request' : 'auto';
  const prev = u().jsonOf(rec, 'after_lock', null);
  if (src === 'auto' && prev !== null && prev.source === 'request') return;
  const now = v === null || v.status === '' ? null : Object.assign(pickValues(v), { source: src });
  const open = now !== null && !sameValues(now, baselineOf(rec));
  const same = (prev === null && now === null) || (prev !== null && now !== null && sameValues(prev, now) && (prev.source || 'auto') === src);
  if (same && rec.getBool('adjusted_after_lock') === open) return;
  rec.set('after_lock', now);
  rec.set('adjusted_after_lock', open);
  app.save(rec);
}

/** Save computed values as the day's auto attendance (never over a manual, request or locked day; a locked day notes what changed). */
function saveAuto(app, empId, day, v) {
  const util = u();
  const rec = util.findOne(app, 'attendance', 'employment = {:e} && day = {:d}', { e: empId, d: day });
  if (rec !== null && rec.getBool('locked')) {
    if (rec.getString('source') === 'auto') noteAfterLock(app, rec, v);
    return 'kept';
  }
  if (rec !== null && rec.getString('source') !== 'auto') return 'kept';
  if (v === null || v.status === '') {
    if (rec !== null) {
      app.delete(rec);
      return 'removed';
    }
    return 'none';
  }
  if (rec !== null && sameAs(rec, v)) return 'same';
  const r = rec !== null ? rec : util.newRecord(app, 'attendance');
  r.set('employment', empId);
  r.set('day', day);
  for (const k of FIELDS) r.set(k, v[k]);
  r.set('source', 'auto');
  r.set('computed_at', util.nowIso());
  app.save(r);
  return rec !== null ? 'updated' : 'created';
}

/** Recompute and save the auto attendance of an employment for local days from..to. */
function processRange(app, empId, from, to, R0) {
  const util = u();
  const R = R0 || resolver(app);
  const e = R.emp(empId);
  const f = from < e.start ? e.start : from;
  const t = e.end !== '' && to > e.end ? e.end : to;
  const out = { created: 0, updated: 0, removed: 0, kept: 0, same: 0, none: 0 };
  if (t < f) return out;
  const now = Date.now();
  const punches = punchesBetween(app, empId, util.dayAdd(f, -1), util.dayAdd(t, 1));
  R.loadAssignments(empId, f, t);
  R.loadLeave(empId, f, t);
  for (let d = f; d <= t; d = util.dayAdd(d, 1)) {
    const v = computeDay(R, empId, d, punches, now);
    out[saveAuto(app, empId, d, v)]++;
  }
  return out;
}

/** Recompute one day (after a punch, a correction or a decision). */
function processDay(app, empId, day) {
  return processRange(app, empId, day, day);
}

/** Cron: every 30 minutes, auto attendance for yesterday and today in every entity. */
function cronAuto(app) {
  const util = u();
  const people = L('lib_people');
  let n = 0;
  for (const ent of util.findMany(app, 'entities', 'active = true', 'created')) {
    const today = util.today(app, ent.id);
    const from = util.dayAdd(today, -1);
    const R = resolver(app);
    for (const m of people.activeEmployments(app, { entity: ent.id, from: from, to: today })) {
      try {
        processRange(app, m.id, from, today, R);
        n++;
      } catch (err) {
        console.error('[hr] auto attendance for ' + m.number + ' failed:', err);
      }
    }
  }
  return n;
}

/* -------------------------------------------------------- day facts */

/**
 * Per-day facts for pay and timesheets, for local days from..to: the saved
 * attendance, or (for a past day without a row) the computed one, with an
 * approved timesheet's hours taking the place of the punches.
 * [{ day, kind, worked, night, expected, leave, status, late, flags, source, locked, payrun, from_timesheet, future }]
 */
function dayFacts(R, empId, from, to, o) {
  const util = u();
  const opts = o || {};
  const e = R.emp(empId);
  const today = R.today(empId);
  const rows = R.attRows(empId, from, to);
  const ts = R.tsDays(empId, from, to);
  let punches = null;
  const out = [];
  const now = Date.now();
  for (let d = from; d <= to; d = util.dayAdd(d, 1)) {
    if (d < e.start || (e.end !== '' && d > e.end)) continue;
    let v = null;
    let src = '';
    let locked = false;
    let payrun = '';
    if (rows[d] !== undefined) {
      const r = rows[d];
      v = { status: r.status, day_kind: r.day_kind, worked_min: r.worked_min, night_min: r.night_min, expected_min: r.expected_min, leave_min: r.leave_min, late_min: r.late_min, flags: r.flags };
      src = r.source;
      locked = r.locked;
      payrun = r.payrun;
    } else if (d <= today && opts.compute !== false) {
      if (punches === null) {
        punches = R.punches(empId, util.dayAdd(from, -1), util.dayAdd(to, 1));
        R.loadAssignments(empId, from, to);
        R.loadLeave(empId, from, to);
      }
      v = computeDay(R, empId, d, punches, now);
      src = 'computed';
    }
    const plan = v === null || v.status === '' ? planOf(R, empId, d) : null;
    const kind = v !== null && v.status !== '' ? v.day_kind || 'work' : plan.kind === 'outside' ? 'work' : plan.kind;
    const fact = {
      day: d,
      kind: kind,
      worked: v !== null && v.status !== '' ? v.worked_min : 0,
      night: v !== null && v.status !== '' ? v.night_min : 0,
      expected: v !== null && v.status !== '' ? v.expected_min : plan.expected_min,
      leave: v !== null && v.status !== '' ? v.leave_min : 0,
      status: v !== null ? v.status : '',
      late: v !== null && v.status !== '' ? v.late_min : 0,
      flags: v !== null && v.status !== '' ? v.flags : [],
      source: src,
      locked: locked,
      payrun: payrun,
      from_timesheet: false,
      future: d > today,
    };
    if (ts[d] !== undefined) {
      fact.worked = ts[d];
      fact.night = Math.min(fact.night, fact.worked);
      fact.from_timesheet = true;
    }
    out.push(fact);
  }
  return out;
}

/**
 * The days overtime limits look back on, from..to: what classify would
 * count of dayFacts(R, empId, from, to, { compute: false }), so only days
 * with worked or leave minutes ([{ day, kind, worked, leave }], day order).
 * A day without either adds nothing to any bucket, so it is left out
 * instead of planned. `months` lists every month with a day of the
 * employment in the range (the limits average over those).
 */
function histFacts(R, empId, from, to) {
  const util = u();
  const e = R.emp(empId);
  const rows = R.histRows(empId, from, to);
  const ts = R.tsDays(empId, from, to);
  const days = {};
  for (const d of Object.keys(rows)) days[d] = true;
  for (const d of Object.keys(ts)) days[d] = true;
  const out = [];
  for (const d of Object.keys(days).sort()) {
    if (d < from || d > to || d < e.start || (e.end !== '' && d > e.end)) continue;
    const v = rows[d];
    let worked = v !== undefined ? v.worked_min : 0;
    const leave = v !== undefined ? v.leave_min : 0;
    if (ts[d] !== undefined) worked = ts[d];
    if (worked <= 0 && leave <= 0) continue;
    let kind = '';
    if (v !== undefined) kind = v.day_kind || 'work';
    else {
      const plan = planOf(R, empId, d);
      kind = plan.kind === 'outside' ? 'work' : plan.kind;
    }
    out.push({ day: d, kind: kind, worked: worked, leave: leave });
  }
  const a = from < e.start ? e.start : from;
  const b = e.end !== '' && to > e.end ? e.end : to;
  const months = [];
  if (a <= b) for (let m = a.slice(0, 7) + '-01'; m <= b; m = util.addMonths(m, 1)) months.push(m.slice(0, 7));
  return { days: out, months: months };
}

/* ------------------------------------------------------- pay inputs */

function monthStart(d) {
  return d.slice(0, 8) + '01';
}

/** The agreement year start (MM-DD) on or before `day`. */
function yearStartOf(day, mmdd) {
  const md = mmdd || '01-01';
  const y = Number(day.slice(0, 4));
  const cand = y + '-' + md;
  return cand <= day ? cand : y - 1 + '-' + md;
}

function sum(list, f) {
  let t = 0;
  for (const x of list) t += f(x);
  return t;
}

/** Absent days a fact counts for (a half day absent counts 0.5). */
function absentOf(x, tracking) {
  if (x.status === 'absent') return 1;
  if (x.status === 'half_day' && x.kind === 'work' && (x.leave === 0 || x.worked === 0) && x.flags.indexOf('no_clock') < 0) return x.leave > 0 ? (x.worked === 0 && tracking === 'punch' ? 0.5 : 0) : 0.5;
  return 0;
}

/**
 * Adjustments for the next pay run: days up to `to` that a locked run used
 * and that changed afterwards (a late clock out, a missed punch fixed). The
 * weeks and months around them are classified twice, as paid and as now, and
 * every difference is a row: { day, component, multiplier, minutes, reason,
 * locked_by_payrun } with component 'regular' (multiplier 1), an overtime or
 * premium code (its multiplier), 'late' (minutes) or 'absent' (minutes 0,
 * days). A difference on a day that did not change itself is overtime moving
 * inside the week or month. Days of an approved timesheet keep its hours.
 */
function adjustmentsOf(R, empId, to) {
  const util = u();
  const rules = L('lib_time_rules');
  const app = R.app;
  const days = R.adjustedDays(empId, to);
  if (days.length === 0) return [];
  let wFrom = null;
  let wTo = null;
  for (const d of days) {
    const wsd = R.ruleSet(empId, d).settings.week_start;
    const a = [rules.weekStartOf(d, wsd), monthStart(d)].sort()[0];
    const b = [rules.dayAdd(rules.weekStartOf(d, wsd), 6), util.monthEnd(d)].sort()[1];
    if (wFrom === null || a < wFrom) wFrom = a;
    if (wTo === null || b > wTo) wTo = b;
  }
  const rs = R.ruleSet(empId, days[days.length - 1]);
  const over = {};
  for (const x of util.rows(app, "SELECT id FROM attendance WHERE employment = {:e} AND day >= {:f} AND day <= {:t} AND locked = TRUE AND (adjusted_after_lock = TRUE OR (json_valid(adjust_log) AND json_type(adjust_log) = 'array' AND json_array_length(adjust_log) > 0))", { id: '' }, { e: empId, f: wFrom, t: wTo })) {
    const r = app.findRecordById('attendance', x.id);
    const base = baselineOf(r);
    const open = r.getBool('adjusted_after_lock');
    over[r.getString('day')] = { base: base, now: open ? util.jsonOf(r, 'after_lock', null) || base : base, open: open };
  }
  const facts = dayFacts(R, empId, wFrom, wTo, {});
  const factOf = (x, v) => (v === undefined || x.from_timesheet ? x : { day: x.day, kind: v.day_kind || 'work', worked: v.worked_min, night: v.night_min, leave: v.leave_min, status: v.status, late: v.late_min, flags: v.flags || [], future: x.future, payrun: x.payrun });
  const A = facts.map((x) => factOf(x, over[x.day] !== undefined ? over[x.day].base : undefined));
  const B = facts.map((x) => factOf(x, over[x.day] !== undefined ? over[x.day].now : undefined));
  const input = (list) => list.map((x) => ({ day: x.day, kind: x.kind, worked: x.future ? 0 : x.worked, night: x.future ? 0 : x.night, leave: x.leave }));
  const opts = { week_start: rs.settings.week_start, counts_leave: rs.settings.counts_leave };
  const ca = rules.classify(input(A), rs.rules, opts);
  const cb = rules.classify(input(B), rs.rules, opts);
  const out = [];
  for (let i = 0; i < facts.length; i++) {
    const x = facts[i];
    if (x.future) continue;
    const reason = over[x.day] !== undefined && over[x.day].open ? 'Changed after its pay run locked (a punch was added or taken out).' : 'Overtime moved inside the week or month after a locked day changed.';
    const row = (component, multiplier, minutes, extra) => Object.assign({ day: x.day, component: component, multiplier: multiplier, minutes: minutes, reason: reason, locked_by_payrun: x.payrun }, extra || {});
    if (cb[i].regular !== ca[i].regular) out.push(row('regular', 1, cb[i].regular - ca[i].regular));
    const parts = {};
    for (const p of ca[i].parts) parts[p.component + '|' + p.multiplier] = (parts[p.component + '|' + p.multiplier] || 0) - p.minutes;
    for (const p of cb[i].parts) parts[p.component + '|' + p.multiplier] = (parts[p.component + '|' + p.multiplier] || 0) + p.minutes;
    for (const k of Object.keys(parts).sort()) if (parts[k] !== 0) out.push(row(k.split('|')[0], Number(k.split('|')[1]), parts[k]));
    const ab = absentOf(B[i], rs.settings.tracking) - absentOf(A[i], rs.settings.tracking);
    if (ab !== 0) out.push(row('absent', 0, 0, { days: ab }));
    if (B[i].late !== A[i].late) out.push(row('late', 0, B[i].late - A[i].late));
  }
  return out;
}

function adjustmentIssue(adjustments) {
  const own = {};
  for (const a of adjustments) if (a.reason.indexOf('Changed after') === 0) own[a.day] = true;
  const n = Math.max(1, Object.keys(own).length);
  return { code: 'adjustments_after_lock', message: n + (n === 1 ? ' day' : ' days') + ' changed after an earlier pay run locked: pay the difference listed in adjustments in this run.', severity: 'warning' };
}

function checkPeriod(from, to) {
  const util = u();
  if (!util.isDay(from) || !util.isDay(to) || to < from) throw util.fail(400, 'from and to must be days with from <= to.', 'invalid_param');
  if (util.daysBetween(from, to) > 400) throw util.fail(400, 'Ask for at most about a year at a time.', 'invalid_param');
}

/**
 * The days pay inputs of an employment over from..to look at: the period
 * inside the employment (f..t), the whole weeks and month around it
 * (ctxFrom..ctxTo) and, when the rule set has overtime limits, the earlier
 * days the limits look back on (hist).
 */
function payWindow(R, empId, from, to) {
  const util = u();
  const rules = L('lib_time_rules');
  const e = R.emp(empId);
  const rs = R.ruleSet(empId, to);
  const ws = rs.settings.week_start;
  const f = from < e.start ? e.start : from;
  const t = e.end !== '' && to > e.end ? e.end : to;
  if (t < f) return { e: e, rs: rs, ws: ws, f: f, t: t, empty: true };
  const ctxFrom = [rules.weekStartOf(f, ws), monthStart(f)].sort()[0];
  const ctxTo = [rules.dayAdd(rules.weekStartOf(t, ws), 6), t].sort()[1];
  const capKeys = Object.keys(rs.caps).filter((k) => k !== 'year_start');
  let ys = '';
  let hist = null;
  if (capKeys.length > 0) {
    ys = yearStartOf(t, rs.caps.year_start);
    const histFrom = [ys, util.addMonths(monthStart(t), -5)].sort()[0];
    if (histFrom < ctxFrom) hist = [histFrom < e.start ? e.start : histFrom, util.dayAdd(ctxFrom, -1)];
  }
  return { e: e, rs: rs, ws: ws, f: f, t: t, empty: false, ctxFrom: ctxFrom, ctxTo: ctxTo, capKeys: capKeys, ys: ys, hist: hist };
}

/**
 * The SPEC 3.5 contract plus `detail` (per day and per week) when asked
 * through the op. `R0` is a resolver already preloaded for this period
 * (payInputsMany); without it one is made and preloaded for this employment.
 */
function payInputsDetail(app, employmentId, from, to, R0) {
  const rules = L('lib_time_rules');
  checkPeriod(from, to);
  let R = R0;
  if (!R) {
    R = resolver(app);
    R.preload([employmentId], from, to);
  }
  const w = payWindow(R, employmentId, from, to);
  const rs = w.rs;
  const ws = w.ws;
  const f = w.f;
  const t = w.t;
  const issues = [];
  const adjustments = adjustmentsOf(R, employmentId, to);
  const empty = { worked_minutes: 0, regular_minutes: 0, overtime: [], absent_days: 0, late_minutes: 0, night_minutes: 0, holiday_worked_minutes: 0, issues: issues, adjustments: adjustments };
  if (w.empty) {
    if (adjustments.length > 0) issues.push(adjustmentIssue(adjustments));
    return Object.assign(empty, { detail: { days: [], rule_set: rs.id } });
  }
  const facts = dayFacts(R, employmentId, w.ctxFrom, w.ctxTo, {});
  const cls = rules.classify(
    facts.map((x) => ({ day: x.day, kind: x.kind, worked: x.future ? 0 : x.worked, night: x.future ? 0 : x.night, leave: x.leave })),
    rs.rules,
    { week_start: ws, counts_leave: rs.settings.counts_leave },
  );
  const inside = (d) => d >= f && d <= t;
  const pf = facts.filter((x) => inside(x.day) && !x.future);
  const pc = cls.filter((x) => inside(x.day));
  const ot = {};
  for (const d of pc) {
    for (const p of d.parts) {
      const k = p.component + '|' + p.multiplier;
      if (ot[k] === undefined) ot[k] = { component: p.component, minutes: 0, multiplier: p.multiplier };
      ot[k].minutes += p.minutes;
    }
  }
  const overtime = Object.keys(ot)
    .map((k) => ot[k])
    .filter((x) => x.minutes > 0)
    .sort((a, b) => (a.component < b.component ? -1 : 1));
  let absent = 0;
  for (const x of pf) absent += absentOf(x, rs.settings.tracking);
  // Issues: punches that need a fix.
  const broken = pf.filter((x) => x.flags.indexOf('missed_in') >= 0 || x.flags.indexOf('missed_out') >= 0);
  if (broken.length > 0) issues.push({ code: 'missing_punch', message: broken.length + (broken.length === 1 ? ' day has' : ' days have') + ' a missing punch. Fix them with a correction or an attendance request.', severity: rs.settings.missing_punch, days: broken.map((x) => x.day) });
  const pendingReq = R.pendingCount(employmentId, f, t);
  if (pendingReq > 0) issues.push({ code: 'attendance_requests_pending', message: pendingReq + ' attendance request' + (pendingReq === 1 ? ' waits' : 's wait') + ' for a decision in this period.', severity: 'warning' });
  // Timesheets.
  if (rs.settings.timesheets !== 'off') {
    const weeks = {};
    for (const x of pf) if (x.worked > 0) weeks[rules.weekStartOf(x.day, ws)] = true;
    const sheets = R.sheetStatuses(employmentId, f, t);
    const missing = [];
    const waiting = [];
    for (const wk of Object.keys(weeks).sort()) {
      const st = sheets[wk];
      if (st === 'approved') continue;
      if (st === 'submitted' || st === 'rejected') waiting.push(wk);
      else if (rs.settings.timesheets === 'required') missing.push(wk);
    }
    if (waiting.length > 0) issues.push({ code: 'timesheet_unapproved', message: (waiting.length === 1 ? 'The timesheet of one week is' : 'The timesheets of ' + waiting.length + ' weeks are') + ' not approved yet.', severity: rs.settings.unapproved, weeks: waiting });
    if (missing.length > 0) issues.push({ code: 'timesheet_missing', message: 'No approved timesheet for ' + (missing.length === 1 ? 'one week' : missing.length + ' weeks') + ' (this entity pays from approved timesheets).', severity: rs.settings.unapproved, weeks: missing });
  }
  // Overtime that should have been approved first.
  if (rs.settings.preapproval) {
    const approved = R.otApproved(employmentId, f, t);
    let over = 0;
    const days = [];
    for (const d of pc) {
      const m = sum(
        d.parts.filter((p) => p.when !== 'night'),
        (p) => p.minutes,
      );
      if (m > (approved[d.day] || 0)) {
        over += m - (approved[d.day] || 0);
        days.push(d.day);
      }
    }
    if (over > 0) issues.push({ code: 'overtime_not_approved', message: hm(over) + ' of overtime on ' + days.length + (days.length === 1 ? ' day' : ' days') + ' was not approved in advance. It is still paid (worked time is owed); talk to the person or approve it after the fact.', severity: 'warning', days: days });
  }
  // Days another locked run already paid.
  const lockedElsewhere = pf.filter((x) => x.locked && x.payrun !== '');
  if (lockedElsewhere.length > 0) issues.push({ code: 'days_locked', message: lockedElsewhere.length + ' day' + (lockedElsewhere.length === 1 ? ' was' : 's were') + ' already used by a locked pay run (' + lockedElsewhere[0].payrun + '). Pay only adjustments for them.', severity: 'warning', days: lockedElsewhere.map((x) => x.day) });
  if (adjustments.length > 0) issues.push(adjustmentIssue(adjustments));
  if (to > R.today(employmentId)) issues.push({ code: 'period_open', message: 'The period runs past today: hours count up to today, later days are not worked yet.', severity: 'warning' });
  // Overtime limits (36 agreement style).
  if (w.capKeys.length > 0) {
    const months = {};
    const addMonth = (list) => {
      for (const d of list) {
        const mo = d.day.slice(0, 7);
        if (months[mo] === undefined) months[mo] = { ot: 0, rest: 0 };
        for (const p of d.parts) {
          if (rules.OT_WHEN.indexOf(p.when) >= 0) months[mo].ot += p.minutes;
          else if (p.when === 'rest_day') months[mo].rest += p.minutes;
        }
      }
    };
    const ys = w.ys;
    if (w.hist !== null && w.hist[0] <= w.hist[1]) {
      const hist = histFacts(R, employmentId, w.hist[0], w.hist[1]);
      for (const mo of hist.months) if (months[mo] === undefined) months[mo] = { ot: 0, rest: 0 };
      addMonth(rules.classify(hist.days.map((x) => ({ day: x.day, kind: x.kind, worked: x.worked, night: 0, leave: x.leave })), rs.rules, { week_start: ws, counts_leave: rs.settings.counts_leave }));
    }
    addMonth(cls.filter((x) => x.day <= t));
    const checked = {};
    for (const d of pc) {
      const mo = d.day.slice(0, 7);
      if (checked[mo]) continue;
      checked[mo] = true;
      const yearMonths = Object.keys(months)
        .filter((m) => m + '-01' >= ys.slice(0, 8) + '01' && m <= mo)
        .sort();
      for (const i of rules.capIssues(rs.caps, months, mo, yearMonths, rs.settings.cap_severity)) if (!issues.some((x) => x.code === i.code)) issues.push({ code: i.code, message: i.message, severity: i.severity, month: mo });
    }
  }
  const out = {
    worked_minutes: sum(pf, (x) => x.worked),
    regular_minutes: sum(pc, (x) => x.regular),
    overtime: overtime,
    absent_days: absent,
    late_minutes: sum(pf, (x) => x.late),
    night_minutes: sum(pf, (x) => x.night),
    holiday_worked_minutes: sum(
      pf.filter((x) => x.kind === 'holiday'),
      (x) => x.worked,
    ),
    issues: issues,
    adjustments: adjustments,
  };
  const byDay = {};
  for (const y of pc) if (byDay[y.day] === undefined) byDay[y.day] = y;
  out.detail = {
    from: f,
    to: t,
    rule_set: rs.id,
    rule_set_name: rs.name,
    tracking: rs.settings.tracking,
    days: pf.map((x) => {
      const c = byDay[x.day];
      return { day: x.day, kind: x.kind, status: x.status, worked: x.worked, regular: c ? c.regular : 0, parts: c ? c.parts : [], night: x.night, late: x.late, leave: x.leave, flags: x.flags, source: x.source, from_timesheet: x.from_timesheet, locked: x.locked };
    }),
  };
  return out;
}

/** SPEC 3.5: lib_time.payInputs(app, employmentId, from, to). */
function payInputs(app, employmentId, from, to) {
  const d = payInputsDetail(app, employmentId, from, to);
  delete d.detail;
  return d;
}

/**
 * payInputsDetail of many employments over one period, read together:
 * { [employmentId]: <payInputsDetail result> }, the same answers as calling
 * payInputsDetail for each (an unknown id fails the call with 404, as the
 * single call would for it). Reports call it for a whole team.
 */
function payInputsDetailMany(app, employmentIds, from, to) {
  checkPeriod(from, to);
  const seen = {};
  const ids = [];
  for (const id of Array.isArray(employmentIds) ? employmentIds : []) {
    if (typeof id !== 'string' || id === '' || seen[id] === true) continue;
    seen[id] = true;
    ids.push(id);
  }
  const out = {};
  // In parts of 100: each part is read together (one resolver), memory stays small.
  for (const part of partsOf(ids, 100)) {
    const R = resolver(app);
    R.preload(part, from, to);
    for (const id of part) out[id] = payInputsDetail(app, id, from, to, R);
  }
  return out;
}

/**
 * payInputs of many employments over one period, read together:
 * { [employmentId]: <payInputs result> }, the same answers as calling
 * payInputs for each (an unknown id fails the call with 404, as payInputs
 * would for it). Payroll calls it once per run.
 */
function payInputsMany(app, employmentIds, from, to) {
  const out = payInputsDetailMany(app, employmentIds, from, to);
  for (const id of Object.keys(out)) delete out[id].detail;
  return out;
}

/**
 * Payroll calls this when a pay run locks (inside its transaction): every
 * day of the period up to today gets a saved attendance row (computed when
 * missing) and is locked to the run; approved timesheets inside the period
 * are locked too. Days after today are left open.
 */
function lockDays(app, employmentId, from, to, payrunId) {
  const util = u();
  const R = resolver(app);
  const e = R.emp(employmentId);
  const today = R.today(employmentId);
  const f = from < e.start ? e.start : from;
  let t = e.end !== '' && to > e.end ? e.end : to;
  let future = 0;
  if (t > today) {
    future = util.daysBetween(today, t);
    t = today;
  }
  const out = { locked: 0, created: 0, skipped_future: future, settled: 0 };
  // This run pays the open adjustments its pay inputs listed (days up to `to` an earlier run locked).
  const run = String(payrunId || '');
  for (const r of util.findMany(app, 'attendance', 'employment = {:e} && adjusted_after_lock = true && locked = true && payrun != {:p} && day <= {:t}', 'day', 0, { e: employmentId, p: run, t: to })) {
    const log = util.jsonOf(r, 'adjust_log', []) || [];
    log.push({ payrun: run, at: util.nowIso(), values: util.jsonOf(r, 'after_lock', null) || baselineOf(r) });
    r.set('adjust_log', log);
    r.set('adjusted_after_lock', false);
    app.save(r);
    out.settled++;
  }
  if (t < f) return out;
  const now = Date.now();
  const punches = punchesBetween(app, employmentId, util.dayAdd(f, -1), util.dayAdd(t, 1));
  R.loadAssignments(employmentId, f, t);
  R.loadLeave(employmentId, f, t);
  for (let d = f; d <= t; d = util.dayAdd(d, 1)) {
    let rec = util.findOne(app, 'attendance', 'employment = {:e} && day = {:d}', { e: employmentId, d: d });
    if (rec === null) {
      const v = computeDay(R, employmentId, d, punches, now);
      if (v === null || v.status === '') continue;
      saveAuto(app, employmentId, d, v);
      rec = util.findOne(app, 'attendance', 'employment = {:e} && day = {:d}', { e: employmentId, d: d });
      out.created++;
    }
    if (rec === null || rec.getBool('locked')) continue;
    rec.set('locked', true);
    rec.set('payrun', String(payrunId || ''));
    app.save(rec);
    out.locked++;
  }
  for (const s of util.findMany(app, 'timesheets', 'employment = {:e} && period_start >= {:f} && period_end <= {:t} && locked = false', '', 0, { e: employmentId, f: f, t: to })) {
    s.set('locked', true);
    s.set('payrun', String(payrunId || ''));
    app.save(s);
  }
  return out;
}

/** Payroll calls this when it voids a locked run before payment: the run's days open again. */
function unlockDays(app, payrunId) {
  const util = u();
  const id = String(payrunId || '');
  if (id === '') return { unlocked: 0 };
  let n = 0;
  for (const r of util.findMany(app, 'attendance', 'payrun = {:p}', '', 0, { p: id })) {
    r.set('locked', false);
    r.set('payrun', '');
    // Open again: a request decided after the lock now sets the day; otherwise it follows its punches.
    const al = util.jsonOf(r, 'after_lock', null);
    if (al !== null && al.source === 'request') {
      for (const k of FIELDS) if (al[k] !== undefined) r.set(k, al[k]);
      r.set('source', 'request');
      r.set('computed_at', util.nowIso());
    }
    r.set('after_lock', null);
    r.set('adjusted_after_lock', false);
    r.set('adjust_log', []);
    app.save(r);
    n++;
  }
  // Adjustments this run paid are open again for the next run.
  let reopened = 0;
  for (const x of util.rows(app, "SELECT a.id AS id FROM attendance a WHERE json_valid(a.adjust_log) AND json_type(a.adjust_log) = 'array' AND EXISTS (SELECT 1 FROM json_each(a.adjust_log) j WHERE json_extract(j.value, '$.payrun') = {:p})", { id: '' }, { p: id })) {
    const r = app.findRecordById('attendance', x.id);
    const log = (util.jsonOf(r, 'adjust_log', []) || []).filter((e) => e.payrun !== id);
    r.set('adjust_log', log);
    const now = util.jsonOf(r, 'after_lock', null);
    r.set('adjusted_after_lock', now !== null && !sameValues(now, baselineOf(r, log)));
    app.save(r);
    reopened++;
  }
  for (const s of util.findMany(app, 'timesheets', 'payrun = {:p}', '', 0, { p: id })) {
    s.set('locked', false);
    s.set('payrun', '');
    app.save(s);
  }
  return { unlocked: n, reopened: reopened };
}

/* ----------------------------------------------------------- access */

/**
 * What the caller may do with an employment's time: 'full' | 'edit' | 'view'
 * (time rights within their entities), 'self', 'team' (a manager of the
 * person), 'agent', 'system' or 'none'.
 */
function access(ctx, empRec) {
  if (ctx.actor === 'system') return 'system';
  if (ctx.isAgent) return 'agent';
  const auth = L('lib_auth');
  const lvl = auth.level(ctx, 'time');
  if (lvl !== 'none' && auth.inScope(ctx, empRec.getString('entity'))) return lvl;
  if (auth.selfEmployee(ctx) !== '' && auth.selfEmployee(ctx) === empRec.getString('employee')) return 'self';
  if (ctx.teamScope && auth.isManagerOf(ctx, empRec.id, u().today(ctx.app, empRec.getString('entity')))) return 'team';
  return 'none';
}

function needSee(ctx, empRec) {
  const a = access(ctx, empRec);
  if (a === 'none') throw u().fail(403, 'You cannot see this person\'s time.', 'not_permitted');
  return a;
}

/** Edit rights: time edit or full in scope, a manager of the person, your AI agent (the catalog decides propose or allow), the app. */
function needEdit(ctx, empRec, what) {
  const a = access(ctx, empRec);
  if (['full', 'edit', 'team', 'agent', 'system'].indexOf(a) < 0) throw u().fail(403, (ctx.isAgent ? 'Your AI agent' : 'Your role') + ' cannot ' + (what || 'change this person\'s time') + ' (needs edit access to Time, or being their manager).', 'not_permitted');
  return a;
}

/** The employment a self-service op acts on: --employment when given (must be the caller's), else the caller's primary one. */
function selfEmployment(ctx, ref) {
  const util = u();
  const people = L('lib_people');
  if (ctx.employeeId === '') throw util.fail(409, 'Your sign-in is not linked to an employee record. Ask an administrator to link it (Settings, Members).', 'no_employee');
  if (ref) {
    const m = people.employmentRef(ctx.app, ref);
    if (m.getString('employee') !== ctx.employeeId) throw util.fail(403, 'That is not one of your employments.', 'not_permitted');
    return m;
  }
  const id = people.primaryEmployment(ctx.app, ctx.employeeId, util.today(ctx.app));
  if (id === '') throw util.fail(409, 'You have no employment yet.', 'no_employment');
  return ctx.app.findRecordById('employments', id);
}

/** An employment by ref that the caller may see (or, with no ref, the caller's own). */
function employmentFor(ctx, ref) {
  if (!ref) return selfEmployment(ctx, '');
  const m = L('lib_people').employmentRef(ctx.app, ref);
  needSee(ctx, m);
  return m;
}

/**
 * lib_people.activeEmployments read in bulk: the same rows in the same order
 * (the same rule: started by `to`, not ended before `from`, in the entity,
 * among the ids), with the employment and employee records read in one
 * query each instead of two lookups a person. Views of hundreds of people
 * (the board, the week, the month) use it.
 */
function activePool(app, o) {
  const util = u();
  const people = L('lib_people');
  const where = ['m.start_day <= {:to}', "(m.end_day = '' OR m.end_day >= {:from})"];
  const bind = { from: o.from, to: o.to };
  if (o.entity) {
    where.push('m.entity = {:ent}');
    bind.ent = o.entity;
  }
  if (Array.isArray(o.ids)) {
    if (o.ids.length === 0) return [];
    const q = inList(o.ids.map(String), 'i');
    where.push('m.id IN (' + q.sql + ')');
    Object.assign(bind, q.bind);
  }
  const ids = util.rows(app, 'SELECT m.id AS id FROM employments m WHERE ' + where.join(' AND ') + ' ORDER BY m.number', { id: '' }, bind).map((r) => r.id);
  const emps = {};
  for (const r of recordsIn(app, 'employments', 'id', ids, '', {}, 'id ASC')) emps[r.id] = r;
  const wanted = {};
  for (const id of ids) wanted[emps[id].getString('employee')] = true;
  const ees = {};
  for (const r of recordsIn(app, 'employees', 'id', Object.keys(wanted), '', {}, 'id ASC')) ees[r.id] = r;
  return ids.map((id) => {
    const m = emps[id];
    const e = ees[m.getString('employee')];
    return Object.assign(people.employmentView(m), { name: people.displayName(e), employee_number: e.getString('number') });
  });
}

/**
 * The people the caller sees in time views, active between from and to:
 * time viewers everyone in their entities; managers their reports (deep);
 * everyone themself. o: { entity, location, department, team (reports only), ids, day }.
 * Rows: { employment, employee, number, name, entity, title, location, location_name, department, department_name, manager }.
 */
function roster(ctx, from, to, o) {
  const util = u();
  const auth = L('lib_auth');
  const people = L('lib_people');
  const app = ctx.app;
  const opt = o || {};
  const day = opt.day || to;
  const entity = opt.entity ? L('lib_org').entityRef(app, opt.entity).id : '';
  const broad = ctx.isAgent || ctx.actor === 'system' || auth.can(ctx, 'time', 'view');
  let pool = [];
  if (broad && opt.team !== true) {
    const sc = auth.scope(ctx);
    pool = activePool(app, { entity: entity || undefined, from: from, to: to }).filter((m) => sc.length === 0 || sc.indexOf(m.entity) >= 0);
  } else {
    const ids = {};
    if (ctx.employeeId !== '' && opt.team !== true) for (const r of util.rows(app, 'SELECT id FROM employments WHERE employee = {:e}', { id: '' }, { e: ctx.employeeId })) ids[r.id] = true;
    if (ctx.teamScope && ctx.employeeId !== '') for (const r of people.reportsOf(app, ctx.employeeId, day, true)) ids[r.employment] = true;
    pool = activePool(app, { entity: entity || undefined, from: from, to: to, ids: Object.keys(ids) });
  }
  const want = Array.isArray(opt.ids) && opt.ids.length > 0 ? opt.ids : null;
  const loc = opt.location ? L('lib_org').kindRef(app, 'location', opt.location).id : '';
  const dep = opt.department ? L('lib_org').kindRef(app, 'department', opt.department).id : '';
  const names = { loc: {}, dep: {} };
  const nameOf = (kind, col, id) => {
    if (!id) return '';
    if (names[kind][id] === undefined) {
      const r = util.byId(app, col, id);
      names[kind][id] = r ? r.getString('name') : '';
    }
    return names[kind][id];
  };
  const kept = pool.filter((m) => want === null || want.indexOf(m.id) >= 0);
  // The job in effect for each (as people.rowOn), read in one query.
  const jobsOf = {};
  for (const j of recordsIn(app, 'job_records', 'employment', kept.map((m) => m.id), '', {}, 'effective_from ASC')) {
    const k = j.getString('employment');
    if (jobsOf[k] === undefined) jobsOf[k] = [];
    jobsOf[k].push(j);
  }
  const out = [];
  for (const m of kept) {
    const on = day < m.start_day ? m.start_day : day;
    let job = null;
    for (const j of jobsOf[m.id] || []) if (j.getString('effective_from') <= on) job = j;
    const l = job ? job.getString('location') : '';
    const d = job ? job.getString('department') : '';
    if (loc !== '' && l !== loc) continue;
    if (dep !== '' && d !== dep) continue;
    out.push({ employment: m.id, employee: m.employee, number: m.employee_number, employment_number: m.number, name: m.name, entity: m.entity, title: job ? job.getString('title') : '', location: l, location_name: nameOf('loc', 'locations', l), department: d, department_name: nameOf('dep', 'departments', d), manager: job ? job.getString('manager') : '' });
  }
  out.sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0));
  return out;
}

/* ------------------------------------------------------ clock state */

/** The clock state of an employment now: { state: 'out'|'in'|'break', since, last } from its latest punch. */
function clockState(app, empId) {
  const util = u();
  const r = util.findOne(app, 'checkins', 'employment = {:e} && voided = false', { e: empId });
  const last = util.findMany(app, 'checkins', 'employment = {:e} && voided = false', '-at,-created', 1, { e: empId })[0] || null;
  if (r === null || last === null) return { state: 'out', since: '', last: null };
  return stateAfter(last);
}

/** The clock state after the latest punch. */
function stateAfter(last) {
  const t = ms(last.getString('at'));
  const kind = last.getString('kind');
  if (Date.now() - t > STALE_MS || kind === 'out') return { state: 'out', since: kind === 'out' ? last.getString('at') : '', last: last };
  return { state: kind === 'break_start' ? 'break' : 'in', since: last.getString('at'), last: last };
}

/** clockState of many employments, read together: { [employmentId]: { state, since, last } }. */
function clockStates(app, ids) {
  const util = u();
  const out = {};
  for (const id of ids) out[id] = { state: 'out', since: '', last: null };
  const lastIds = [];
  for (const part of partsOf(ids, 300)) {
    const q = inList(part, 'i');
    for (const r of util.rows(app, "SELECT COALESCE((SELECT c.id FROM checkins c WHERE c.employment = m.id AND c.voided = FALSE ORDER BY c.at DESC, c.created DESC LIMIT 1), '') AS id FROM employments m WHERE m.id IN (" + q.sql + ')', { id: '' }, q.bind)) if (r.id !== '') lastIds.push(r.id);
  }
  if (lastIds.length > 0) for (const last of recordsIn(app, 'checkins', 'id', lastIds, '', {}, 'id ASC')) out[last.getString('employment')] = stateAfter(last);
  return out;
}

/* --------------------------------------------------------- profile facts */

function profileFacts(ctx, employmentId) {
  const util = u();
  const app = ctx.app;
  const R = resolver(app);
  const today = R.today(employmentId);
  const plan = planOf(R, employmentId, today);
  if (plan.kind === 'outside') return [];
  const facts = [];
  let shift = 'Day off';
  if (plan.kind === 'holiday' && plan.source !== 'shift') shift = 'Holiday' + (plan.holiday ? ': ' + plan.holiday.name : '');
  else if (plan.source === 'shift') shift = plan.shift_name + ' ' + plan.start + ' to ' + plan.end;
  else if (plan.kind === 'work') shift = plan.start + ' to ' + plan.end;
  const lv = R.leaveOn(employmentId, today);
  if (lv !== null) shift = 'On leave' + (lv.name ? ': ' + lv.name : '') + (lv.half ? ' (half day)' : '');
  facts.push({ label: 'Today', value: shift, link: '#/time' });
  const st = clockState(app, employmentId);
  const zone = plan.zone;
  if (st.state === 'in') facts.push({ label: 'Clock', value: 'In since ' + localTime(zone, ms(st.since)), tone: 'good' });
  else if (st.state === 'break') facts.push({ label: 'Clock', value: 'On a break since ' + localTime(zone, ms(st.since)), tone: 'warn' });
  else if (st.last !== null && st.last.getString('day') === today) facts.push({ label: 'Clock', value: 'Out at ' + localTime(zone, ms(st.since)) });
  else if (plan.kind === 'work' && lv === null) facts.push({ label: 'Clock', value: 'Not clocked in today' });
  const m = util.one(app, "SELECT COALESCE(SUM(CASE WHEN status IN ('present','half_day','remote','on_duty') THEN 1 ELSE 0 END),0) AS present, COALESCE(SUM(CASE WHEN late_min > 0 THEN 1 ELSE 0 END),0) AS late, COALESCE(SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END),0) AS absent, CAST(COALESCE(SUM(worked_min),0) AS INTEGER) AS worked FROM attendance WHERE employment = {:e} AND day >= {:f} AND day <= {:t}", { present: 0, late: 0, absent: 0, worked: 0 }, { e: employmentId, f: monthStart(today), t: today });
  if (m !== null && (m.present > 0 || m.absent > 0)) {
    facts.push({ label: 'This month', value: m.present + (m.present === 1 ? ' day, ' : ' days, ') + hm(m.worked) + (m.late > 0 ? ', ' + m.late + ' late' : '') + (m.absent > 0 ? ', ' + m.absent + ' absent' : ''), tone: m.absent > 0 ? 'bad' : m.late > 0 ? 'warn' : 'neutral', link: '#/time/attendance' });
  }
  return facts;
}

/* ------------------------------------------------------------ events */

/** entity.created: the country's default overtime rules and a first shift type from the work week. */
function onEntityCreated(ctx, payload) {
  const util = u();
  const app = ctx.app;
  const ent = util.byId(app, 'entities', payload.entity);
  if (ent === null) return null;
  const out = { overtime_rules: '', shift_type: '' };
  if (util.findOne(app, 'overtime_rules', 'entity = {:e}', { e: ent.id }) === null) {
    out.overtime_rules = L('lib_time_ot').seedDefaults(app, ent, 'builtin').id;
  }
  if (util.findOne(app, 'shift_types', 'entity = {:e}', { e: ent.id }) === null) {
    const sch = util.byId(app, 'work_schedules', ent.getString('default_schedule'));
    const week = sch ? util.jsonOf(sch, 'week', []) || [] : [];
    const row = week[0];
    if (row && util.isTime(row.start) && util.isTime(row.end)) {
      const r = util.newRecord(app, 'shift_types');
      r.set('entity', ent.id);
      r.set('name', 'Day');
      r.set('code', 'D');
      r.set('start', row.start);
      r.set('end', row.end);
      r.set('break_min', Number(row.break_min) || 0);
      r.set('color', 'blue');
      r.set('overnight', row.end <= row.start);
      r.set('grace_in_min', sch.getInt('grace_min'));
      r.set('grace_out_min', 0);
      r.set('auto_attendance', true);
      r.set('sort', 0);
      app.save(r);
      out.shift_type = r.id;
    }
  }
  return out;
}

/** employment.ended: shifts after the last day that were never published go; published ones are marked to remove. */
function onEmploymentEnded(ctx, payload) {
  const util = u();
  const app = ctx.app;
  let n = 0;
  for (const r of util.findMany(app, 'shift_assignments', 'employment = {:e} && day > {:d}', '', 0, { e: payload.employment, d: payload.end_day })) {
    if (util.jsonOf(r, 'published', null) === null) app.delete(r);
    else {
      r.set('status', 'removed');
      app.save(r);
    }
    n++;
  }
  return { shifts: n };
}

module.exports = {
  fact: fact,
  SHIFT_COLORS: SHIFT_COLORS,
  STALE_MS: STALE_MS,
  ms: ms,
  iso: iso,
  mins: mins,
  hm: hm,
  shiftMinutes: shiftMinutes,
  localTime: localTime,
  leaveDays: leaveDays,
  leaveDaysMany: leaveDaysMany,
  resolver: resolver,
  ruleSetView: ruleSetView,
  shiftTypeView: shiftTypeView,
  checkinView: checkinView,
  attendanceView: attendanceView,
  planOf: planOf,
  punchesBetween: punchesBetween,
  sessionsOf: sessionsOf,
  segmentsOf: segmentsOf,
  nightMinutes: nightMinutes,
  computeDay: computeDay,
  saveAuto: saveAuto,
  noteAfterLock: noteAfterLock,
  processRange: processRange,
  processDay: processDay,
  cronAuto: cronAuto,
  dayFacts: dayFacts,
  monthStart: monthStart,
  payInputs: payInputs,
  payInputsMany: payInputsMany,
  payInputsDetail: payInputsDetail,
  payInputsDetailMany: payInputsDetailMany,
  lockDays: lockDays,
  unlockDays: unlockDays,
  access: access,
  needSee: needSee,
  needEdit: needEdit,
  selfEmployment: selfEmployment,
  employmentFor: employmentFor,
  roster: roster,
  clockState: clockState,
  clockStates: clockStates,
  recordsIn: recordsIn,
  activePool: activePool,
  profileFacts: profileFacts,
  onEntityCreated: onEntityCreated,
  onEmploymentEnded: onEmploymentEnded,
};
