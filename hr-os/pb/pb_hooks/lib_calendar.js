/// <reference path="../pb_data/types.d.ts" />
/**
 * Holiday calendars and holidays, work schedules, and the working-day
 * contract other modules call (SPEC 3.2):
 *
 *   isHoliday(app, calendarId, day)            -> { id, day, name, kind, half } | null
 *       (public, observed and company holidays; optional holidays are not days off)
 *   holidaysBetween(app, calendarId, from, to) -> [{ id, day, name, kind, half }] (every kind)
 *   calendarOf(app, employmentId, day)         -> { id, code, name, country, region } | null
 *   scheduleOf(app, employmentId, day)         -> { id, name, week, hours_per_week, flexible, grace_min, night_from, night_to } | null
 *   workingDays(app, employmentId, from, to)   -> { count, days, holidays, off, outside }
 *   expectedMinutes(app, employmentId, day)    -> minutes scheduled that day (0 when off)
 *
 * The calendar and schedule of an employment on a day come from its job
 * record in effect that day, then its location's calendar, then the
 * entity's defaults. A half-day holiday counts as half a working day.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}

function mins(hhmm) {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}

/** Minutes of one week row {dow, start, end, break_min} (overnight when end <= start). */
function rowMinutes(row) {
  if (!row || !u().isTime(row.start) || !u().isTime(row.end)) return 0;
  let d = mins(row.end) - mins(row.start);
  if (d <= 0) d += 1440;
  return Math.max(0, d - (Number(row.break_min) || 0));
}

function weekHours(week) {
  let t = 0;
  for (const r of week || []) t += rowMinutes(r);
  return Math.round((t / 60) * 100) / 100;
}

/* ---------------------------------------------------------------- views */

function holidayView(r) {
  return { id: r.id, calendar: r.getString('calendar'), day: r.getString('day'), name: r.getString('name'), kind: r.getString('kind'), half: r.getBool('half'), source: r.getString('source') };
}

function calendarView(app, r) {
  return {
    id: r.id,
    code: r.getString('code'),
    name: r.getString('name'),
    country: r.getString('country'),
    region: r.getString('region'),
    entity: r.getString('entity'),
    builtin: r.getBool('builtin'),
    seeded_years: u().jsonOf(r, 'seeded_years', []) || [],
    archived: r.getBool('archived'),
  };
}

function scheduleView(r) {
  return {
    id: r.id,
    name: r.getString('name'),
    entity: r.getString('entity'),
    week: u().jsonOf(r, 'week', []) || [],
    hours_per_week: r.getFloat('hours_per_week'),
    flexible: r.getBool('flexible'),
    grace_min: r.getInt('grace_min'),
    night_from: r.getString('night_from'),
    night_to: r.getString('night_to'),
    archived: r.getBool('archived'),
  };
}

function calendarRef(app, ref) {
  const util = u();
  const r = String(ref || '').trim();
  const rec = util.byId(app, 'holiday_calendars', r) || util.findOne(app, 'holiday_calendars', 'code = {:c}', { c: r });
  if (rec !== null) return rec;
  return util.byIdOrName(app, 'holiday_calendars', r, 'name', 'calendars.list');
}

function scheduleRef(app, ref) {
  return u().byIdOrName(app, 'work_schedules', ref, 'name', 'schedules.list');
}

/* ------------------------------------------------------------- contract */

const DAYS_OFF = ['public', 'observed', 'company'];

function isHoliday(app, calendarId, day) {
  if (!calendarId) return null;
  const r = u().findOne(app, 'holidays', 'calendar = {:c} && day = {:d}', { c: calendarId, d: day });
  if (r === null) return null;
  const all = u().findMany(app, 'holidays', 'calendar = {:c} && day = {:d}', 'name', 0, { c: calendarId, d: day }).filter((x) => DAYS_OFF.indexOf(x.getString('kind')) >= 0);
  if (all.length === 0) return null;
  const full = all.filter((x) => !x.getBool('half'))[0];
  return holidayView(full || all[0]);
}

function holidaysBetween(app, calendarId, from, to) {
  if (!calendarId) return [];
  return u()
    .findMany(app, 'holidays', 'calendar = {:c} && day >= {:f} && day <= {:t}', 'day,name', 0, { c: calendarId, f: from, t: to })
    .map(holidayView);
}

/** The employment's job records (oldest first), its entity and the location calendars, read once. */
function context(app, employmentId) {
  const util = u();
  const emp = util.byId(app, 'employments', employmentId);
  if (emp === null) throw util.fail(404, 'No employment ' + employmentId + '.', 'not_found');
  const ent = app.findRecordById('entities', emp.getString('entity'));
  const jobs = util.findMany(app, 'job_records', 'employment = {:e}', 'effective_from', 0, { e: employmentId });
  return { emp: emp, ent: ent, jobs: jobs, locCal: {} };
}

function jobOn(c, day) {
  let best = null;
  for (const j of c.jobs) if (j.getString('effective_from') <= day) best = j;
  return best;
}

function calendarIdOn(app, c, day) {
  const j = jobOn(c, day);
  if (j !== null && j.getString('calendar') !== '') return j.getString('calendar');
  if (j !== null && j.getString('location') !== '') {
    const loc = j.getString('location');
    if (c.locCal[loc] === undefined) {
      const l = u().byId(app, 'locations', loc);
      c.locCal[loc] = l ? l.getString('calendar') : '';
    }
    if (c.locCal[loc] !== '') return c.locCal[loc];
  }
  return c.ent.getString('default_calendar');
}

function scheduleIdOn(c, day) {
  const j = jobOn(c, day);
  if (j !== null && j.getString('schedule') !== '') return j.getString('schedule');
  return c.ent.getString('default_schedule');
}

function calendarOf(app, employmentId, day) {
  const c = context(app, employmentId);
  const id = calendarIdOn(app, c, day);
  const r = u().byId(app, 'holiday_calendars', id);
  return r === null ? null : { id: r.id, code: r.getString('code'), name: r.getString('name'), country: r.getString('country'), region: r.getString('region') };
}

function scheduleOf(app, employmentId, day) {
  const c = context(app, employmentId);
  const r = u().byId(app, 'work_schedules', scheduleIdOn(c, day));
  return r === null ? null : scheduleView(r);
}

/** Scheduled minutes on `day` of a week (0 when the weekday has no row). */
function weekMinutes(week, day) {
  const dow = u().weekday(day);
  let t = 0;
  for (const r of week || []) if (Number(r.dow) === dow) t += rowMinutes(r);
  return t;
}

function workingDays(app, employmentId, from, to) {
  const util = u();
  if (!util.isDay(from) || !util.isDay(to) || to < from) throw util.fail(400, 'from and to must be days with from <= to.', 'invalid_param');
  if (util.daysBetween(from, to) > 800) throw util.fail(400, 'Ask for at most about two years at a time.', 'invalid_param');
  const c = context(app, employmentId);
  const start = c.emp.getString('start_day');
  const end = c.emp.getString('end_day');
  const hol = {};
  const sch = {};
  const out = { count: 0, days: [], holidays: [], off: [], outside: [] };
  for (let d = from; d <= to; d = util.dayAdd(d, 1)) {
    if (d < start || (end !== '' && d > end)) {
      out.outside.push(d);
      continue;
    }
    const sid = scheduleIdOn(c, d);
    if (sch[sid] === undefined) {
      const r = util.byId(app, 'work_schedules', sid);
      sch[sid] = r ? util.jsonOf(r, 'week', []) || [] : [];
    }
    if (weekMinutes(sch[sid], d) === 0) {
      out.off.push(d);
      continue;
    }
    const cid = calendarIdOn(app, c, d);
    if (cid !== '' && hol[cid] === undefined) {
      hol[cid] = {};
      for (const h of holidaysBetween(app, cid, from, to)) {
        if (DAYS_OFF.indexOf(h.kind) < 0) continue;
        const prev = hol[cid][h.day];
        if (prev === undefined || (prev.half && !h.half)) hol[cid][h.day] = h;
      }
    }
    const h = cid !== '' ? hol[cid][d] : undefined;
    if (h !== undefined) {
      out.holidays.push({ day: d, name: h.name, half: h.half });
      if (h.half) {
        out.count += 0.5;
        out.days.push(d);
      }
      continue;
    }
    out.count += 1;
    out.days.push(d);
  }
  return out;
}

function expectedMinutes(app, employmentId, day) {
  const util = u();
  const c = context(app, employmentId);
  const start = c.emp.getString('start_day');
  const end = c.emp.getString('end_day');
  if (day < start || (end !== '' && day > end)) return 0;
  const r = util.byId(app, 'work_schedules', scheduleIdOn(c, day));
  const m = r ? weekMinutes(util.jsonOf(r, 'week', []) || [], day) : 0;
  if (m === 0) return 0;
  const h = isHoliday(app, calendarIdOn(app, c, day), day);
  if (h === null) return m;
  return h.half ? Math.round(m / 2) : 0;
}

/* -------------------------------------------------------------- seeding */

/**
 * Copy the country data's holidays into a builtin calendar for the given
 * years (null: every year the data has that the calendar has not been
 * seeded with). A holiday a person deleted from a seeded year stays deleted.
 */
function seedYears(app, cal, years) {
  const util = u();
  const countries = L('lib_countries');
  if (!cal.getBool('builtin') || !countries.has(cal.getString('country'))) return 0;
  const seeded = (util.jsonOf(cal, 'seeded_years', []) || []).map(String);
  const rows = countries.holidays(cal.getString('country'), years ? years.map(String) : [], cal.getString('region'));
  const want = {};
  for (const h of rows) {
    const y = String(h.day).slice(0, 4);
    if (years === null && seeded.indexOf(y) >= 0) continue;
    want[y] = true;
  }
  let n = 0;
  for (const h of rows) {
    const y = String(h.day).slice(0, 4);
    if (!want[y]) continue;
    if (util.findOne(app, 'holidays', 'calendar = {:c} && day = {:d} && name = {:n}', { c: cal.id, d: h.day, n: h.name }) !== null) continue;
    const r = util.newRecord(app, 'holidays');
    r.set('calendar', cal.id);
    r.set('day', h.day);
    r.set('name', util.clip(h.name, 160));
    r.set('kind', h.kind || 'public');
    r.set('half', h.half === true);
    r.set('source', 'builtin');
    app.save(r);
    n++;
  }
  const ys = Object.keys(want);
  if (ys.length > 0) {
    const all = seeded.concat(ys.filter((y) => seeded.indexOf(y) < 0)).sort();
    cal.set('seeded_years', all);
    app.save(cal);
  }
  return n;
}

/** Boot: add the years new country data brings to every builtin calendar. */
function seedAll(app) {
  let n = 0;
  for (const cal of u().findMany(app, 'holiday_calendars', 'builtin = true && archived = false', 'code')) n += seedYears(app, cal, null);
  return n;
}

/* ------------------------------------------------------------- calendar ops */

function calendarsList(ctx, p) {
  const util = u();
  const rows = util.findMany(ctx.app, 'holiday_calendars', util.bool(p, 'archived', false) ? '1=1' : 'archived = false', 'code');
  const year = String(util.int(p, 'year', Number(util.today(ctx.app).slice(0, 4)), 1990, 2100));
  return {
    calendars: rows.map((r) => {
      const v = calendarView(ctx.app, r);
      v.holidays_this_year = util.count(ctx.app, 'SELECT COUNT(*) AS n FROM holidays WHERE calendar = {:c} AND day >= {:f} AND day <= {:t}', { c: r.id, f: year + '-01-01', t: year + '-12-31' });
      v.used_by = util.count(ctx.app, 'SELECT COUNT(*) AS n FROM entities WHERE default_calendar = {:c}', { c: r.id }) + util.count(ctx.app, 'SELECT COUNT(*) AS n FROM locations WHERE calendar = {:c}', { c: r.id });
      return v;
    }),
    year: year,
  };
}

function calendarsGet(ctx, p) {
  const util = u();
  const cal = calendarRef(ctx.app, util.req(p, 'calendar'));
  const year = String(util.int(p, 'year', Number(util.today(ctx.app).slice(0, 4)), 1990, 2100));
  return { calendar: calendarView(ctx.app, cal), year: year, holidays: holidaysBetween(ctx.app, cal.id, year + '-01-01', year + '-12-31') };
}

function calendarsAdd(ctx, p) {
  const util = u();
  const app = ctx.app;
  const code = util.req(p, 'code', 'SG-COMPANY').toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(code)) throw util.fail(400, 'code is letters, digits, - and _ (e.g. SG-COMPANY).', 'invalid_param', { param: 'code' });
  if (util.findOne(app, 'holiday_calendars', 'code = {:c}', { c: code }) !== null) throw util.fail(409, 'There is already a calendar ' + code + '.', 'duplicate');
  const rec = util.newRecord(app, 'holiday_calendars');
  rec.set('code', code);
  rec.set('name', util.squash(util.req(p, 'name')));
  const country = util.str(p, 'country', '').toUpperCase();
  if (country !== '') L('lib_countries').get(country);
  rec.set('country', country);
  rec.set('region', util.str(p, 'region', '').toUpperCase());
  if (util.str(p, 'entity', '') !== '') rec.set('entity', L('lib_org').entityRef(app, util.str(p, 'entity', '')).id);
  rec.set('builtin', false);
  rec.set('seeded_years', []);
  app.save(rec);
  let copied = 0;
  const from = util.str(p, 'copy_from', '');
  if (from !== '') {
    const src = calendarRef(app, from);
    for (const h of util.findMany(app, 'holidays', 'calendar = {:c}', 'day', 0, { c: src.id })) {
      const r = util.newRecord(app, 'holidays');
      r.set('calendar', rec.id);
      r.set('day', h.getString('day'));
      r.set('name', h.getString('name'));
      r.set('kind', h.getString('kind'));
      r.set('half', h.getBool('half'));
      r.set('source', 'person');
      app.save(r);
      copied++;
    }
  }
  L('lib_audit').note(ctx, { collection: 'holiday_calendars', record: rec.id, summary: 'Added the holiday calendar ' + code + (copied > 0 ? ' with ' + copied + ' holidays copied' : '') });
  return { calendar: calendarView(app, rec), copied: copied };
}

function calendarsUpdate(ctx, p) {
  const util = u();
  const cal = calendarRef(ctx.app, util.req(p, 'calendar'));
  const before = calendarView(ctx.app, cal);
  if (util.has(p, 'name')) cal.set('name', util.squash(util.req(p, 'name')));
  if (util.has(p, 'archived')) cal.set('archived', util.bool(p, 'archived', false));
  ctx.app.save(cal);
  L('lib_audit').note(ctx, { collection: 'holiday_calendars', record: cal.id, summary: 'Changed the holiday calendar ' + cal.getString('code'), before: before, after: calendarView(ctx.app, cal) });
  return { calendar: calendarView(ctx.app, cal) };
}

function calendarsDelete(ctx, p) {
  const util = u();
  const app = ctx.app;
  const cal = calendarRef(app, util.req(p, 'calendar'));
  const used = util.count(app, 'SELECT COUNT(*) AS n FROM entities WHERE default_calendar = {:c}', { c: cal.id }) + util.count(app, 'SELECT COUNT(*) AS n FROM locations WHERE calendar = {:c}', { c: cal.id }) + util.count(app, 'SELECT COUNT(*) AS n FROM job_records WHERE calendar = {:c}', { c: cal.id });
  if (used > 0) throw util.fail(409, 'This calendar is in use. Archive it instead (calendars.update --archived true).', 'in_use');
  app.delete(cal);
  L('lib_audit').note(ctx, { collection: 'holiday_calendars', record: cal.id, summary: 'Deleted the holiday calendar ' + cal.getString('code') });
  return { deleted: true };
}

/** Add a year's public holidays from the country data to a builtin calendar. */
function calendarsSeed(ctx, p) {
  const util = u();
  const cal = calendarRef(ctx.app, util.req(p, 'calendar'));
  if (!cal.getBool('builtin')) throw util.fail(409, 'Only country calendars fill from the country data. Add holidays to this calendar with holidays.add or holidays.import.', 'invalid');
  const years = (util.list(p, 'years') || []).map(String);
  const n = seedYears(ctx.app, cal, years.length > 0 ? years : null);
  L('lib_audit').note(ctx, { collection: 'holiday_calendars', record: cal.id, summary: 'Added ' + n + ' holidays to ' + cal.getString('code') + ' from the country data' });
  return { added: n, calendar: calendarView(ctx.app, ctx.app.findRecordById('holiday_calendars', cal.id)) };
}

function holidayParams(p, rec, creating) {
  const util = u();
  if (util.has(p, 'day') || creating) rec.set('day', util.day(p, 'day', '') || (() => {
    throw util.fail(400, 'day is required', 'missing_param', { param: 'day' });
  })());
  if (util.has(p, 'name') || creating) rec.set('name', util.squash(util.req(p, 'name')));
  if (util.has(p, 'kind')) rec.set('kind', util.oneOf(p, 'kind', ['public', 'company', 'optional', 'observed'], 'public'));
  if (util.has(p, 'half')) rec.set('half', util.bool(p, 'half', false));
}

function holidaysAdd(ctx, p) {
  const util = u();
  const cal = calendarRef(ctx.app, util.req(p, 'calendar'));
  const rec = util.newRecord(ctx.app, 'holidays');
  rec.set('calendar', cal.id);
  rec.set('kind', 'public');
  rec.set('source', ctx.isAgent ? 'agent' : 'person');
  holidayParams(p, rec, true);
  if (util.findOne(ctx.app, 'holidays', 'calendar = {:c} && day = {:d} && name = {:n}', { c: cal.id, d: rec.getString('day'), n: rec.getString('name') }) !== null) throw util.fail(409, 'That holiday is already in the calendar.', 'duplicate');
  ctx.app.save(rec);
  L('lib_audit').note(ctx, { collection: 'holidays', record: rec.id, summary: 'Added ' + rec.getString('name') + ' on ' + rec.getString('day') + ' to ' + cal.getString('code'), after: holidayView(rec) });
  return { holiday: holidayView(rec) };
}

function holidaysUpdate(ctx, p) {
  const util = u();
  const rec = util.byId(ctx.app, 'holidays', util.req(p, 'holiday'));
  if (rec === null) throw util.fail(404, 'No such holiday.', 'not_found');
  const before = holidayView(rec);
  holidayParams(p, rec, false);
  ctx.app.save(rec);
  L('lib_audit').note(ctx, { collection: 'holidays', record: rec.id, summary: 'Changed the holiday ' + rec.getString('name'), before: before, after: holidayView(rec) });
  return { holiday: holidayView(rec) };
}

function holidaysDelete(ctx, p) {
  const util = u();
  const rec = util.byId(ctx.app, 'holidays', util.req(p, 'holiday'));
  if (rec === null) throw util.fail(404, 'No such holiday.', 'not_found');
  ctx.app.delete(rec);
  L('lib_audit').note(ctx, { collection: 'holidays', record: rec.id, summary: 'Removed the holiday ' + rec.getString('name') + ' on ' + rec.getString('day'), before: holidayView(rec) });
  return { deleted: true };
}

/** CSV import of holidays (columns day,name,kind,half): a dry run reports, a commit adds. */
function holidaysImport(ctx, p) {
  const util = u();
  const app = ctx.app;
  const cal = calendarRef(app, util.req(p, 'calendar'));
  const dry = util.bool(p, 'dry_run', true);
  const csv = L('lib_files').csvInput(ctx, p, 'file', 'csv');
  const parsed = util.csvObjects(csv);
  for (const need of ['day', 'name']) if (parsed.header.indexOf(need) < 0) throw util.fail(400, 'The CSV needs the columns day and name (optional kind, half). Found: ' + parsed.header.join(', '), 'bad_csv');
  const report = { rows: parsed.items.length, add: 0, skip: 0, errors: [] };
  const ok = [];
  parsed.items.forEach((row, i) => {
    const line = i + 2;
    if (!util.isDay(row.day)) return report.errors.push({ line: line, message: 'day must be YYYY-MM-DD (got "' + row.day + '")' });
    if (row.name === '') return report.errors.push({ line: line, message: 'name is empty' });
    const kind = row.kind || 'public';
    if (['public', 'company', 'optional', 'observed'].indexOf(kind) < 0) return report.errors.push({ line: line, message: 'kind must be public, company, optional or observed' });
    const half = ['true', 'yes', '1'].indexOf(String(row.half || '').toLowerCase()) >= 0;
    if (util.findOne(app, 'holidays', 'calendar = {:c} && day = {:d} && name = {:n}', { c: cal.id, d: row.day, n: row.name }) !== null) {
      report.skip++;
      return null;
    }
    ok.push({ day: row.day, name: util.clip(row.name, 160), kind: kind, half: half });
    report.add++;
    return null;
  });
  let importId = '';
  if (!dry && report.errors.length === 0) {
    app.runInTransaction((tx) => {
      for (const h of ok) {
        const r = util.newRecord(tx, 'holidays');
        r.set('calendar', cal.id);
        r.set('day', h.day);
        r.set('name', h.name);
        r.set('kind', h.kind);
        r.set('half', h.half);
        r.set('source', 'import');
        tx.save(r);
      }
      importId = L('lib_files').recordImport(L('lib_auth').withApp(ctx, tx), 'holidays', 'committed', report, parsed.items.length);
    });
  } else importId = L('lib_files').recordImport(ctx, 'holidays', dry ? 'dry_run' : 'failed', report, parsed.items.length);
  L('lib_audit').note(ctx, { collection: 'holiday_calendars', record: cal.id, summary: (dry ? 'Checked' : 'Imported') + ' a holiday CSV for ' + cal.getString('code') + ': ' + report.add + ' to add, ' + report.skip + ' already there, ' + report.errors.length + ' errors' });
  return { dry_run: dry, committed: !dry && report.errors.length === 0, import: importId, report: report };
}

/* ------------------------------------------------------------ schedule ops */

function readWeek(p) {
  const util = u();
  const raw = util.list(p, 'week');
  if (raw === undefined) return undefined;
  const seen = {};
  return raw.map((r, i) => {
    util.keysOnly(r, ['dow', 'start', 'end', 'break_min'], 'week item ' + (i + 1));
    const dow = Number(r.dow);
    if (!Number.isInteger(dow) || dow < 0 || dow > 6) throw util.fail(400, 'week item ' + (i + 1) + ': dow is 0 (Sunday) to 6.', 'invalid_param');
    if (!util.isTime(r.start) || !util.isTime(r.end)) throw util.fail(400, 'week item ' + (i + 1) + ': start and end are HH:MM.', 'invalid_param');
    const br = r.break_min === undefined ? 0 : Number(r.break_min);
    if (!Number.isInteger(br) || br < 0 || br > 600) throw util.fail(400, 'week item ' + (i + 1) + ': break_min is minutes.', 'invalid_param');
    const key = dow + ' ' + r.start;
    if (seen[key]) throw util.fail(400, 'week item ' + (i + 1) + ' repeats another.', 'invalid_param');
    seen[key] = true;
    return { dow: dow, start: r.start, end: r.end, break_min: br };
  });
}

function applySchedule(ctx, rec, p, creating) {
  const util = u();
  if (util.has(p, 'name') || creating) rec.set('name', util.squash(util.req(p, 'name')));
  if (util.has(p, 'entity')) rec.set('entity', util.str(p, 'entity', '') === '' ? '' : L('lib_org').entityRef(ctx.app, util.str(p, 'entity', '')).id);
  const week = readWeek(p);
  if (week !== undefined) {
    rec.set('week', week);
    rec.set('hours_per_week', weekHours(week));
  } else if (creating) throw util.fail(400, 'week is required, e.g. [{"dow":1,"start":"09:00","end":"18:00","break_min":60}]', 'missing_param', { param: 'week' });
  if (util.has(p, 'flexible')) rec.set('flexible', util.bool(p, 'flexible', false));
  if (util.has(p, 'grace_min')) rec.set('grace_min', util.int(p, 'grace_min', 0, 0, 240));
  for (const k of ['night_from', 'night_to']) {
    if (!util.has(p, k)) continue;
    const t = util.str(p, k, '');
    if (t !== '' && !util.isTime(t)) throw util.fail(400, k + ' is HH:MM.', 'invalid_param', { param: k });
    rec.set(k, t);
  }
  if (util.has(p, 'archived')) rec.set('archived', util.bool(p, 'archived', false));
}

function schedulesList(ctx, p) {
  const util = u();
  const where = util.bool(p, 'archived', false) ? '1=1' : 'archived = false';
  return { schedules: util.findMany(ctx.app, 'work_schedules', where, 'name').map(scheduleView) };
}

function schedulesAdd(ctx, p) {
  const rec = u().newRecord(ctx.app, 'work_schedules');
  rec.set('grace_min', 5);
  applySchedule(ctx, rec, p, true);
  ctx.app.save(rec);
  L('lib_audit').note(ctx, { collection: 'work_schedules', record: rec.id, summary: 'Added the work schedule ' + rec.getString('name'), after: scheduleView(rec) });
  return { schedule: scheduleView(rec) };
}

function schedulesUpdate(ctx, p) {
  const util = u();
  const rec = scheduleRef(ctx.app, util.req(p, 'schedule'));
  const before = scheduleView(rec);
  applySchedule(ctx, rec, p, false);
  ctx.app.save(rec);
  L('lib_audit').note(ctx, { collection: 'work_schedules', record: rec.id, summary: 'Changed the work schedule ' + rec.getString('name'), before: before, after: scheduleView(rec) });
  return { schedule: scheduleView(rec) };
}

function schedulesDelete(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rec = scheduleRef(app, util.req(p, 'schedule'));
  const used = util.count(app, 'SELECT COUNT(*) AS n FROM entities WHERE default_schedule = {:s}', { s: rec.id }) + util.count(app, 'SELECT COUNT(*) AS n FROM job_records WHERE schedule = {:s}', { s: rec.id });
  if (used > 0) throw util.fail(409, 'This schedule is in use. Archive it instead (schedules.update --archived true).', 'in_use');
  app.delete(rec);
  L('lib_audit').note(ctx, { collection: 'work_schedules', record: rec.id, summary: 'Deleted the work schedule ' + rec.getString('name') });
  return { deleted: true };
}

/** working days of one employment, as an op (people see their own; HR anyone in scope). */
function workingDaysOp(ctx, p) {
  const util = u();
  const people = L('lib_people');
  const emp = people.employmentRef(ctx.app, util.req(p, 'employment'));
  people.needSee(ctx, emp);
  const from = util.day(p, 'from', util.today(ctx.app, emp.getString('entity')));
  const to = util.day(p, 'to', util.dayAdd(from, 30));
  return { employment: emp.id, from: from, to: to, working: workingDays(ctx.app, emp.id, from, to), calendar: calendarOf(ctx.app, emp.id, from), schedule: scheduleOf(ctx.app, emp.id, from) };
}

module.exports = {
  rowMinutes: rowMinutes,
  weekHours: weekHours,
  weekMinutes: weekMinutes,
  holidayView: holidayView,
  calendarView: calendarView,
  scheduleView: scheduleView,
  calendarRef: calendarRef,
  scheduleRef: scheduleRef,
  isHoliday: isHoliday,
  holidaysBetween: holidaysBetween,
  calendarOf: calendarOf,
  scheduleOf: scheduleOf,
  workingDays: workingDays,
  expectedMinutes: expectedMinutes,
  seedYears: seedYears,
  seedAll: seedAll,
  calendarsList: calendarsList,
  calendarsGet: calendarsGet,
  calendarsAdd: calendarsAdd,
  calendarsUpdate: calendarsUpdate,
  calendarsDelete: calendarsDelete,
  calendarsSeed: calendarsSeed,
  holidaysAdd: holidaysAdd,
  holidaysUpdate: holidaysUpdate,
  holidaysDelete: holidaysDelete,
  holidaysImport: holidaysImport,
  schedulesList: schedulesList,
  schedulesAdd: schedulesAdd,
  schedulesUpdate: schedulesUpdate,
  schedulesDelete: schedulesDelete,
  workingDaysOp: workingDaysOp,
};
