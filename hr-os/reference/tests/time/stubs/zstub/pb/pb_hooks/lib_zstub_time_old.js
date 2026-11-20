// SCRATCH ONLY: lib_time.js as it was before the payInputs speed work (2026-11-04), kept to prove the new one answers the same.
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
 *   lockDays(app, employmentId, from, to, payrunId) -> { locked, created, skipped_future }
 *       (payroll calls it when a run locks: those days are never recomputed or edited again)
 *   unlockDays(app, payrunId) -> { unlocked }   (payroll calls it when it voids a locked run before payment)
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

/* --------------------------------------------------------------- leave */

/**
 * Approved leave of an employment by day between two days:
 * [{ day, type, name, paid, half: '' | 'am' | 'pm', hours, request }]
 * (hours > 0 only for part of a day taken by the hour).
 */
function leaveDays(app, empId, from, to) {
  const util = u();
  const rows = util.rows(
    app,
    "SELECT id, type, unit, day_list FROM leave_requests WHERE employment = {:m} AND [[start]] <= {:t} AND [[end]] >= {:f} AND status IN ('approved', 'cancelling')",
    { id: '', type: '', unit: '', day_list: '' },
    { m: empId, f: from, t: to },
  );
  const types = {};
  const out = [];
  for (const r of rows) {
    if (types[r.type] === undefined) {
      const t = util.byId(app, 'leave_types', r.type);
      types[r.type] = t === null ? { code: '', name: '', paid: true } : { code: t.getString('code'), name: t.getString('name'), paid: t.getBool('paid') };
    }
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
      out.push({ day: d.day, type: types[r.type].code, name: types[r.type].name, paid: types[r.type].paid, half: half, hours: half === '' && days < 1 && hours > 0 ? hours : 0, request: r.id });
    }
  }
  return out;
}

/* ------------------------------------------------------------ resolver */

/**
 * A per-call cache of what day plans need (employments with their job
 * records, entities, locations, schedules, holidays, shift types,
 * assignments, leave, rule sets). The calendar and schedule of a day follow
 * the kernel rule: the job record in effect, then the location's calendar,
 * then the entity's defaults.
 */
function resolver(app) {
  const util = u();
  const c = { emp: {}, ent: {}, loc: {}, sch: {}, hol: {}, st: {}, asg: {}, leave: {}, rs: {}, et: {} };
  const R = { app: app };
  R.emp = (id) => {
    if (c.emp[id] === undefined) {
      const rec = util.byId(app, 'employments', id);
      if (rec === null) throw util.fail(404, 'No employment ' + id + '.', 'not_found');
      c.emp[id] = {
        id: rec.id,
        rec: rec,
        entity: rec.getString('entity'),
        employee: rec.getString('employee'),
        start: rec.getString('start_day'),
        end: rec.getString('end_day'),
        jobs: util.findMany(app, 'job_records', 'employment = {:e}', 'effective_from', 0, { e: id }),
      };
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
    let best = null;
    for (const j of R.emp(id).jobs) if (j.getString('effective_from') <= day) best = j;
    return best;
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
    const j = R.jobOn(id, day);
    const ent = R.entity(R.emp(id).entity);
    const sid = j !== null && j.getString('schedule') !== '' ? j.getString('schedule') : ent ? ent.getString('default_schedule') : '';
    return R.schedule(sid);
  };
  R.calendarOn = (id, day) => {
    const j = R.jobOn(id, day);
    if (j !== null && j.getString('calendar') !== '') return j.getString('calendar');
    const loc = j !== null ? R.location(j.getString('location')) : null;
    if (loc !== null && loc.getString('calendar') !== '') return loc.getString('calendar');
    const ent = R.entity(R.emp(id).entity);
    return ent ? ent.getString('default_calendar') : '';
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
    const loc = R.location(R.locationOn(id, day));
    if (loc !== null && loc.getString('timezone') !== '') return loc.getString('timezone');
    const ent = R.entity(R.emp(id).entity);
    return ent && ent.getString('timezone') !== '' ? ent.getString('timezone') : 'UTC';
  };
  R.today = (id) => util.localAt(R.zone(id, util.today(app, R.emp(id).entity)), Date.now()).day;
  R.shiftType = (sid) => {
    if (!sid) return null;
    if (c.st[sid] === undefined) {
      const r = util.byId(app, 'shift_types', sid);
      c.st[sid] = r === null ? null : shiftTypeView(r);
    }
    return c.st[sid];
  };
  /** Assignments of an employment by day (prefetch a range with loadAssignments). */
  R.loadAssignments = (id, from, to) => {
    if (c.asg[id] === undefined) c.asg[id] = {};
    for (const r of util.findMany(app, 'shift_assignments', 'employment = {:e} && day >= {:f} && day <= {:t}', 'day', 0, { e: id, f: from, t: to })) c.asg[id][r.getString('day')] = r;
    c.asg[id]['__' + from + ':' + to] = true;
  };
  R.assignment = (id, day) => {
    if (c.asg[id] === undefined || c.asg[id][day] === undefined) {
      const loaded = c.asg[id] && Object.keys(c.asg[id]).some((k) => k.indexOf('__') === 0 && day >= k.slice(2, 12) && day <= k.slice(13, 23));
      if (!loaded) {
        if (c.asg[id] === undefined) c.asg[id] = {};
        c.asg[id][day] = util.findOne(app, 'shift_assignments', 'employment = {:e} && day = {:d}', { e: id, d: day });
      }
    }
    return c.asg[id][day] || null;
  };
  /** Approved leave by day, from the leave module. */
  R.loadLeave = (id, from, to) => {
    if (c.leave[id] === undefined) c.leave[id] = { ranges: [], days: {} };
    for (const x of leaveDays(app, id, from, to)) {
      const prev = c.leave[id].days[x.day];
      if (prev === undefined || (!x.half && !(x.hours > 0))) c.leave[id].days[x.day] = x;
    }
    c.leave[id].ranges.push([from, to]);
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
    return ruleSetView(pick, R.entity(e.entity));
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
  if (p.location !== '' && R.location(p.location) !== null && R.location(p.location).getString('timezone') !== '') p.zone = R.location(p.location).getString('timezone');
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
  const all = sessionsOf(punches);
  const ss = all.filter((s) => util.localAt(zone, s.in !== null ? s.in : s.out).day === day);
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

/** Save computed values as the day's auto attendance (never over a manual, request or locked day). */
function saveAuto(app, empId, day, v) {
  const util = u();
  const rec = util.findOne(app, 'attendance', 'employment = {:e} && day = {:d}', { e: empId, d: day });
  if (rec !== null && (rec.getString('source') !== 'auto' || rec.getBool('locked'))) return 'kept';
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
  const app = R.app;
  const e = R.emp(empId);
  const today = R.today(empId);
  const rows = {};
  for (const r of util.findMany(app, 'attendance', 'employment = {:e} && day >= {:f} && day <= {:t}', 'day', 0, { e: empId, f: from, t: to })) rows[r.getString('day')] = r;
  const ts = {};
  for (const t of util.findMany(app, 'timesheets', "employment = {:e} && status = 'approved' && period_end >= {:f} && period_start <= {:t}", 'period_start', 0, { e: empId, f: from, t: to })) {
    for (const x of util.findMany(app, 'timesheet_entries', "timesheet = {:t} && (kind = 'regular' || kind = 'overtime')", 'day', 0, { t: t.id })) {
      const d = x.getString('day');
      ts[d] = (ts[d] || 0) + x.getInt('minutes');
    }
    for (let d = t.getString('period_start'); d <= t.getString('period_end'); d = util.dayAdd(d, 1)) if (ts[d] === undefined) ts[d] = 0;
  }
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
      v = { status: r.getString('status'), day_kind: r.getString('day_kind'), worked_min: r.getInt('worked_min'), night_min: r.getInt('night_min'), expected_min: r.getInt('expected_min'), leave_min: r.getInt('leave_min'), late_min: r.getInt('late_min'), flags: util.jsonOf(r, 'flags', []) || [] };
      src = r.getString('source');
      locked = r.getBool('locked');
      payrun = r.getString('payrun');
    } else if (d <= today && opts.compute !== false) {
      if (punches === null) {
        punches = punchesBetween(app, empId, util.dayAdd(from, -1), util.dayAdd(to, 1));
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

/** The SPEC 3.5 contract plus `detail` (per day and per week) when asked through the op. */
function payInputsDetail(app, employmentId, from, to) {
  const util = u();
  const rules = L('lib_time_rules');
  if (!util.isDay(from) || !util.isDay(to) || to < from) throw util.fail(400, 'from and to must be days with from <= to.', 'invalid_param');
  if (util.daysBetween(from, to) > 400) throw util.fail(400, 'Ask for at most about a year at a time.', 'invalid_param');
  const R = resolver(app);
  const e = R.emp(employmentId);
  const rs = R.ruleSet(employmentId, to);
  const ws = rs.settings.week_start;
  const issues = [];
  const empty = { worked_minutes: 0, regular_minutes: 0, overtime: [], absent_days: 0, late_minutes: 0, night_minutes: 0, holiday_worked_minutes: 0, issues: issues };
  const f = from < e.start ? e.start : from;
  const t = e.end !== '' && to > e.end ? e.end : to;
  if (t < f) return Object.assign(empty, { detail: { days: [], rule_set: rs.id } });
  const ctxFrom = [rules.weekStartOf(f, ws), monthStart(f)].sort()[0];
  const ctxTo = [rules.dayAdd(rules.weekStartOf(t, ws), 6), t].sort()[1];
  const facts = dayFacts(R, employmentId, ctxFrom, ctxTo, {});
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
  for (const x of pf) {
    if (x.status === 'absent') absent += 1;
    else if (x.status === 'half_day' && x.kind === 'work' && (x.leave === 0 || x.worked === 0) && x.flags.indexOf('no_clock') < 0) absent += x.leave > 0 ? (x.worked === 0 && rs.settings.tracking === 'punch' ? 0.5 : 0) : 0.5;
  }
  // Issues: punches that need a fix.
  const broken = pf.filter((x) => x.flags.indexOf('missed_in') >= 0 || x.flags.indexOf('missed_out') >= 0);
  if (broken.length > 0) issues.push({ code: 'missing_punch', message: broken.length + (broken.length === 1 ? ' day has' : ' days have') + ' a missing punch (' + broken.slice(0, 5).map((x) => x.day).join(', ') + (broken.length > 5 ? ', ...' : '') + '). Fix them with a correction or an attendance request.', severity: rs.settings.missing_punch });
  const pendingReq = util.count(app, "SELECT COUNT(*) AS n FROM attendance_requests WHERE employment = {:e} AND status = 'pending' AND from_day <= {:t} AND (to_day = '' OR to_day >= {:f} OR from_day >= {:f})", { e: employmentId, f: f, t: t });
  if (pendingReq > 0) issues.push({ code: 'attendance_requests_pending', message: pendingReq + ' attendance request' + (pendingReq === 1 ? ' waits' : 's wait') + ' for a decision in this period.', severity: 'warning' });
  // Timesheets.
  if (rs.settings.timesheets !== 'off') {
    const weeks = {};
    for (const x of pf) if (x.worked > 0) weeks[rules.weekStartOf(x.day, ws)] = true;
    const sheets = {};
    for (const s of util.findMany(app, 'timesheets', 'employment = {:e} && period_end >= {:f} && period_start <= {:t}', 'period_start', 0, { e: employmentId, f: f, t: t })) sheets[s.getString('period_start')] = s.getString('status');
    const missing = [];
    const waiting = [];
    for (const w of Object.keys(weeks).sort()) {
      const st = sheets[w];
      if (st === 'approved') continue;
      if (st === 'submitted' || st === 'rejected') waiting.push(w);
      else if (rs.settings.timesheets === 'required') missing.push(w);
    }
    if (waiting.length > 0) issues.push({ code: 'timesheet_unapproved', message: 'The timesheet' + (waiting.length === 1 ? ' for the week of ' + waiting[0] + ' is' : 's for the weeks of ' + waiting.join(', ') + ' are') + ' not approved yet.', severity: rs.settings.unapproved });
    if (missing.length > 0) issues.push({ code: 'timesheet_missing', message: 'No approved timesheet for the week' + (missing.length === 1 ? ' of ' + missing[0] : 's of ' + missing.join(', ')) + ' (this entity pays from approved timesheets).', severity: rs.settings.unapproved });
  }
  // Overtime that should have been approved first.
  if (rs.settings.preapproval) {
    const approved = {};
    for (const r of util.findMany(app, 'overtime_requests', "employment = {:e} && status = 'approved' && day >= {:f} && day <= {:t}", 'day', 0, { e: employmentId, f: f, t: t })) approved[r.getString('day')] = (approved[r.getString('day')] || 0) + r.getInt('approved_min');
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
    if (over > 0) issues.push({ code: 'overtime_not_approved', message: hm(over) + ' of overtime on ' + days.slice(0, 5).join(', ') + (days.length > 5 ? ', ...' : '') + ' was not approved in advance. It is still paid (worked time is owed); talk to the person or approve it after the fact.', severity: 'warning' });
  }
  // Days another locked run already paid.
  const lockedElsewhere = pf.filter((x) => x.locked && x.payrun !== '');
  if (lockedElsewhere.length > 0) issues.push({ code: 'days_locked', message: lockedElsewhere.length + ' day' + (lockedElsewhere.length === 1 ? ' was' : 's were') + ' already used by a locked pay run (' + lockedElsewhere[0].payrun + '). Pay only adjustments for them.', severity: 'warning' });
  if (to > R.today(employmentId)) issues.push({ code: 'period_open', message: 'The period runs past today: hours count up to today, later days are not worked yet.', severity: 'warning' });
  // Overtime limits (36 agreement style).
  const capKeys = Object.keys(rs.caps).filter((k) => k !== 'year_start');
  if (capKeys.length > 0) {
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
    const ys = yearStartOf(t, rs.caps.year_start);
    const histFrom = [ys, util.addMonths(monthStart(t), -5)].sort()[0];
    if (histFrom < ctxFrom) {
      const hist = dayFacts(R, employmentId, histFrom < e.start ? e.start : histFrom, util.dayAdd(ctxFrom, -1), { compute: false });
      addMonth(rules.classify(hist.map((x) => ({ day: x.day, kind: x.kind, worked: x.worked, night: 0, leave: x.leave })), rs.rules, { week_start: ws, counts_leave: rs.settings.counts_leave }));
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
      for (const i of rules.capIssues(rs.caps, months, mo, yearMonths, rs.settings.cap_severity)) if (!issues.some((x) => x.code === i.code)) issues.push({ code: i.code, message: i.message, severity: i.severity });
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
  };
  out.detail = {
    from: f,
    to: t,
    rule_set: rs.id,
    rule_set_name: rs.name,
    tracking: rs.settings.tracking,
    days: pf.map((x) => {
      const c = pc.filter((y) => y.day === x.day)[0];
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
  const out = { locked: 0, created: 0, skipped_future: future };
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
    app.save(r);
    n++;
  }
  for (const s of util.findMany(app, 'timesheets', 'payrun = {:p}', '', 0, { p: id })) {
    s.set('locked', false);
    s.set('payrun', '');
    app.save(s);
  }
  return { unlocked: n };
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
    pool = people.activeEmployments(app, { entity: entity || undefined, from: from, to: to }).filter((m) => sc.length === 0 || sc.indexOf(m.entity) >= 0);
  } else {
    const ids = {};
    if (ctx.employeeId !== '' && opt.team !== true) for (const r of util.rows(app, 'SELECT id FROM employments WHERE employee = {:e}', { id: '' }, { e: ctx.employeeId })) ids[r.id] = true;
    if (ctx.teamScope && ctx.employeeId !== '') for (const r of people.reportsOf(app, ctx.employeeId, day, true)) ids[r.employment] = true;
    pool = people.activeEmployments(app, { entity: entity || undefined, from: from, to: to, ids: Object.keys(ids) });
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
  const out = [];
  for (const m of pool) {
    if (want !== null && want.indexOf(m.id) < 0) continue;
    const job = people.rowOn(app, 'job_records', m.id, day < m.start_day ? m.start_day : day);
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
  const t = ms(last.getString('at'));
  const kind = last.getString('kind');
  if (Date.now() - t > STALE_MS || kind === 'out') return { state: 'out', since: kind === 'out' ? last.getString('at') : '', last: last };
  return { state: kind === 'break_start' ? 'break' : 'in', since: last.getString('at'), last: last };
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
  SHIFT_COLORS: SHIFT_COLORS,
  STALE_MS: STALE_MS,
  ms: ms,
  iso: iso,
  mins: mins,
  hm: hm,
  shiftMinutes: shiftMinutes,
  localTime: localTime,
  leaveDays: leaveDays,
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
  processRange: processRange,
  processDay: processDay,
  cronAuto: cronAuto,
  dayFacts: dayFacts,
  monthStart: monthStart,
  payInputs: payInputs,
  payInputsDetail: payInputsDetail,
  lockDays: lockDays,
  unlockDays: unlockDays,
  access: access,
  needSee: needSee,
  needEdit: needEdit,
  selfEmployment: selfEmployment,
  employmentFor: employmentFor,
  roster: roster,
  clockState: clockState,
  profileFacts: profileFacts,
  onEntityCreated: onEntityCreated,
  onEmploymentEnded: onEmploymentEnded,
};
