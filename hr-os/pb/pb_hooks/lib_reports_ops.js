/**
 * Reports over the work itself: absence and overtime (from the time and
 * leave modules' pay-input contracts, so a report counts exactly what
 * payroll would), the hiring funnel with time to hire, and training
 * completion. Reads only.
 */
let _m = {};
function L(n) {
  if (_m[n] === undefined) _m[n] = require(`${__hooks}/${n}.js`);
  return _m[n];
}
const u = () => L('lib_util');
const R = () => L('lib_reports');

/* -------------------------------------------------------------- absence */

/**
 * Per month and person: scheduled working days, days absent, late minutes,
 * overtime minutes and leave days by type, as lib_reports_cache counts them
 * company-wide from the time module's classified days and the approved
 * leave; this report keeps the people inside the filters (on the day they
 * were last in work in each month) and adds them up. `fresh` counts the
 * months again at once. The period widens to whole months.
 */
function absence(ctx, p) {
  const util = u();
  const r = R();
  const app = ctx.app;
  const f = r.filters(ctx, p, { span: 3, maxMonths: 12 });
  // Counted by whole months (the company figures are kept per month): the period widens to the months it touches.
  f.from = r.monthStart(f.from.slice(0, 7));
  f.to = r.monthEnd(f.to.slice(0, 7));
  const fresh = util.bool(p, 'fresh', false);
  const names = r.namer(app);
  const last = f.to > f.today ? f.today : f.to;
  const months = r.monthsBetween(f.from, f.to);
  const cache = L('lib_reports_cache');
  const byMonth = {};
  for (const mk of months) byMonth[mk] = { month: mk, people: 0, scheduled_days: 0, absent_days: 0, leave_days: 0, overtime_minutes: 0, late_minutes: 0 };
  const people = {};
  const groups = {};
  const types = {};
  let countedAt = '';
  for (const mk of months) {
    const start = r.monthStart(mk) < f.from ? f.from : r.monthStart(mk);
    const end0 = r.monthEnd(mk) > f.to ? f.to : r.monthEnd(mk);
    const end = end0 > last ? last : end0;
    if (start > end) continue;
    const c = cache.absenceMonth(app, mk, fresh);
    if (c.computed_at !== '' && (countedAt === '' || c.computed_at < countedAt)) countedAt = c.computed_at;
    const seen = {};
    for (const x of r.population(app, f, end).concat(r.movers(app, f, 'end_day', start, end))) {
      if (seen[x.employment]) continue;
      seen[x.employment] = true;
      const v = c.rows[x.employment];
      if (v === undefined) continue;
      const m = byMonth[mk];
      const pp = (people[x.employment] = people[x.employment] || { number: x.number, name: x.name, entity: names.entity(x.entity), department: names.department(x.department), dept: x.department, scheduled_days: 0, absent_days: 0, leave_days: 0, overtime_minutes: 0, late_minutes: 0 });
      m.people++;
      m.scheduled_days += v.s;
      m.absent_days += v.a;
      m.leave_days += v.v;
      m.overtime_minutes += v.o;
      m.late_minutes += v.l;
      pp.scheduled_days += v.s;
      pp.absent_days += v.a;
      pp.leave_days += v.v;
      pp.overtime_minutes += v.o;
      pp.late_minutes += v.l;
      for (const code of Object.keys(v.t || {})) types[code] = (types[code] || 0) + v.t[code];
    }
  }
  const series = months.map((mk) => Object.assign(byMonth[mk], { absence_pct: r.pct(byMonth[mk].absent_days, byMonth[mk].scheduled_days), leave_pct: r.pct(byMonth[mk].leave_days, byMonth[mk].scheduled_days), overtime_hours: r.round1(byMonth[mk].overtime_minutes / 60) }));
  const rows = Object.keys(people).map((k) => {
    const x = people[k];
    const g = (groups[x.dept] = groups[x.dept] || { key: x.dept, label: x.department || 'Not set', people: 0, scheduled_days: 0, absent_days: 0, leave_days: 0, overtime_minutes: 0 });
    g.people++;
    g.scheduled_days += x.scheduled_days;
    g.absent_days += x.absent_days;
    g.leave_days += x.leave_days;
    g.overtime_minutes += x.overtime_minutes;
    delete x.dept;
    return Object.assign(x, { leave_days: r.round1(x.leave_days), absence_pct: r.pct(x.absent_days, x.scheduled_days), overtime_hours: r.round1(x.overtime_minutes / 60) });
  });
  const tot = series.reduce((a, m) => ({ s: a.s + m.scheduled_days, ab: a.ab + m.absent_days, lv: a.lv + m.leave_days, ot: a.ot + m.overtime_minutes, late: a.late + m.late_minutes }), { s: 0, ab: 0, lv: 0, ot: 0, late: 0 });
  const typeNames = {};
  for (const t of util.rows(app, 'SELECT code, name FROM leave_types', { code: '', name: '' })) typeNames[t.code] = t.name;
  return {
    filters: r.shown(f),
    counted_at: countedAt,
    months: series,
    readouts: { scheduled_days: r.round1(tot.s), absent_days: r.round1(tot.ab), leave_days: r.round1(tot.lv), absence_pct: r.pct(tot.ab, tot.s), leave_pct: r.pct(tot.lv, tot.s), overtime_hours: r.round1(tot.ot / 60), overtime_hours_per_person: rows.length ? r.round1(tot.ot / 60 / rows.length) : 0, late_minutes: tot.late },
    groups: Object.keys(groups)
      .map((k) => Object.assign(groups[k], { absence_pct: r.pct(groups[k].absent_days, groups[k].scheduled_days), leave_pct: r.pct(groups[k].leave_days, groups[k].scheduled_days), overtime_hours: r.round1(groups[k].overtime_minutes / 60) }))
      .sort((a, b) => b.absence_pct - a.absence_pct),
    leave_types: Object.keys(types)
      .map((k) => ({ type: k, name: typeNames[k] || k, days: r.round1(types[k]) }))
      .sort((a, b) => b.days - a.days),
    table: r.table(
      [
        { key: 'number', label: 'Number', kind: 'text' },
        { key: 'name', label: 'Name', kind: 'text' },
        { key: 'department', label: 'Department', kind: 'text' },
        { key: 'scheduled_days', label: 'Work days', kind: 'number' },
        { key: 'absent_days', label: 'Absent days', kind: 'number' },
        { key: 'absence_pct', label: 'Absence %', kind: 'number' },
        { key: 'leave_days', label: 'Leave days', kind: 'number' },
        { key: 'overtime_hours', label: 'Overtime hours', kind: 'number' },
        { key: 'late_minutes', label: 'Minutes late', kind: 'number' },
      ],
      rows.sort((a, b) => b.absence_pct - a.absence_pct || b.overtime_hours - a.overtime_hours),
    ),
  };
}

/* --------------------------------------------------------------- hiring */

const FUNNEL = ['applied', 'screen', 'interview', 'offer', 'hired'];

/** Applications made in the period through each stage kind (a later stage counts the earlier ones), conversion, and days from application to hire. */
function hiring(ctx, p) {
  const util = u();
  const r = R();
  const app = ctx.app;
  const f = r.filters(ctx, p, { span: 12, maxMonths: 36 });
  const names = r.namer(app);
  const bind = { a: f.from, b: f.to };
  let where = "a.applied_at >= {:a} AND a.applied_at <= {:b}" + r.entityWhere(f, bind, 'o.entity');
  if (f.departments.length > 0) where += ' AND ' + r.listWhere(f.departments, bind, 'o.department', 'dp');
  if (f.location !== '') {
    bind.loc = f.location;
    where += ' AND o.location = {:loc}';
  }
  const apps = util.rows(
    app,
    "SELECT a.id AS id, a.opening AS opening, a.stage AS stage, a.status AS status, a.applied_at AS applied_at, COALESCE(a.hired_at, '') AS hired_at, COALESCE(a.source, '') AS source, o.title AS title, o.number AS number, o.entity AS entity, COALESCE(o.department, '') AS department, o.stages AS stages, COALESCE(o.opened_at, '') AS opened_at FROM applications a JOIN openings o ON o.id = a.opening WHERE " +
      where,
    { id: '', opening: '', stage: '', status: '', applied_at: '', hired_at: '', source: '', title: '', number: '', entity: '', department: '', stages: '', opened_at: '' },
    bind,
  );
  const kindOf = {};
  const openings = {};
  for (const a of apps) {
    if (kindOf[a.opening] === undefined) {
      kindOf[a.opening] = {};
      let st = [];
      try {
        st = JSON.parse(a.stages || '[]') || [];
      } catch (e) {
        st = [];
      }
      for (const s of st) kindOf[a.opening][s.key] = s.kind;
    }
  }
  const moved = {};
  if (apps.length > 0) {
    const b2 = {};
    for (const ev of util.rows(app, "SELECT application, COALESCE(to_stage, '') AS to_stage FROM hiring_events WHERE kind IN ('moved', 'hired', 'offer') AND " + r.listWhere(apps.map((a) => a.id), b2, 'application', 'ap'), { application: '', to_stage: '' }, b2)) (moved[ev.application] = moved[ev.application] || []).push(ev.to_stage);
  }
  const funnel = FUNNEL.map((k) => ({ kind: k, count: 0 }));
  const hireDays = [];
  const sources = {};
  for (const a of apps) {
    const km = kindOf[a.opening];
    let far = 0;
    const touch = (key) => {
      const i = FUNNEL.indexOf(km[key] || '');
      if (i > far) far = i;
    };
    touch(a.stage);
    for (const s of moved[a.id] || []) touch(s);
    if (a.status === 'hired') far = FUNNEL.length - 1;
    for (let i = 0; i <= far; i++) funnel[i].count++;
    const o = (openings[a.opening] = openings[a.opening] || { opening: a.opening, number: a.number, title: a.title, entity: names.entity(a.entity), department: names.department(a.department), applications: 0, in_process: 0, hired: 0, rejected: 0, days: [], opened_at: a.opened_at });
    o.applications++;
    if (a.status === 'active') o.in_process++;
    if (a.status === 'rejected' || a.status === 'withdrawn') o.rejected++;
    const src = (sources[a.source || 'other'] = sources[a.source || 'other'] || { source: a.source || 'other', applications: 0, hired: 0 });
    src.applications++;
    if (a.status === 'hired' && a.hired_at !== '') {
      const d = util.daysBetween(a.applied_at.slice(0, 10), a.hired_at.slice(0, 10));
      hireDays.push(d);
      o.hired++;
      o.days.push(d);
      src.hired++;
    }
  }
  for (let i = 0; i < funnel.length; i++) funnel[i].conversion_pct = i === 0 ? 100 : r.pct(funnel[i].count, funnel[i - 1].count);
  const rows = Object.keys(openings).map((k) => {
    const o = openings[k];
    const days = o.days;
    delete o.days;
    return Object.assign(o, { days_to_hire_avg: days.length ? r.round1(days.reduce((a, b) => a + b, 0) / days.length) : null, hire_rate_pct: r.pct(o.hired, o.applications) });
  });
  return {
    filters: r.shown(f),
    funnel: funnel,
    readouts: { applications: apps.length, hired: funnel[funnel.length - 1].count, hire_rate_pct: r.pct(funnel[funnel.length - 1].count, apps.length), days_to_hire_avg: hireDays.length ? r.round1(hireDays.reduce((a, b) => a + b, 0) / hireDays.length) : null, days_to_hire_median: hireDays.length ? r.round1(r.median(hireDays)) : null, in_process: apps.filter((a) => a.status === 'active').length },
    sources: Object.keys(sources)
      .map((k) => sources[k])
      .sort((a, b) => b.applications - a.applications),
    table: r.table(
      [
        { key: 'number', label: 'Opening', kind: 'text' },
        { key: 'title', label: 'Title', kind: 'text' },
        { key: 'entity', label: 'Entity', kind: 'text' },
        { key: 'department', label: 'Department', kind: 'text' },
        { key: 'applications', label: 'Applications', kind: 'number' },
        { key: 'in_process', label: 'In process', kind: 'number' },
        { key: 'hired', label: 'Hired', kind: 'number' },
        { key: 'hire_rate_pct', label: 'Hire rate %', kind: 'number' },
        { key: 'days_to_hire_avg', label: 'Days to hire', kind: 'number' },
      ],
      rows.sort((a, b) => b.applications - a.applications),
    ),
  };
}

/* ------------------------------------------------------------- training */

/** Places on training sessions that ended in the period (and courses recorded as completed elsewhere): completion by program and department. */
function training(ctx, p) {
  const util = u();
  const r = R();
  const app = ctx.app;
  const f = r.filters(ctx, p, { span: 12, maxMonths: 36 });
  const names = r.namer(app);
  const bind = { a: f.from, b: f.to };
  const att = util.rows(
    app,
    "SELECT t.id AS id, t.employee AS employee, t.status AS status, COALESCE(t.result, '') AS result, COALESCE(t.source, '') AS source, COALESCE(t.completed_on, '') AS completed_on, COALESCE([[s.end]], '') AS ends, COALESCE([[s.start]], '') AS starts, COALESCE(s.status, '') AS session_status, COALESCE(t.program, '') AS program, COALESCE(pg.name, '') AS program_name, CAST(ROUND(COALESCE(pg.duration_hours, 0) * 10) AS INTEGER) AS hours10 " +
      'FROM training_attendees t LEFT JOIN trainings s ON s.id = t.training LEFT JOIN training_programs pg ON pg.id = t.program ' +
      "WHERE t.status != 'cancelled' AND ((t.training != '' AND [[s.end]] >= {:a} AND [[s.end]] <= {:b} AND s.status != 'cancelled') OR (t.training = '' AND t.completed_on >= {:a} AND t.completed_on <= {:b}))",
    { id: '', employee: '', status: '', result: '', source: '', completed_on: '', ends: '', starts: '', session_status: '', program: '', program_name: '', hours10: 0 },
    bind,
  );
  // Department and entity of each person on the day the session ended (the population filters apply).
  const inFilter = {};
  const deptOf = {};
  const dayCache = {};
  const popOn = (day) => {
    if (dayCache[day] === undefined) {
      dayCache[day] = {};
      for (const x of r.population(app, f, day)) dayCache[day][x.employee] = x;
    }
    return dayCache[day];
  };
  const programs = {};
  const groups = {};
  const counts = { places: 0, completed: 0, attended: 0, no_show: 0, waiting: 0, failed: 0, hours: 0 };
  for (const a of att) {
    const day = a.ends !== '' ? a.ends : a.completed_on;
    const x = popOn(day)[a.employee];
    if (x === undefined) continue;
    inFilter[a.id] = true;
    deptOf[a.id] = x.department;
    const done = a.status === 'completed' || a.status === 'attended';
    const pk = a.program;
    const pg = (programs[pk] = programs[pk] || { program: pk, name: a.program_name || 'Other', places: 0, completed: 0, no_show: 0, waiting: 0, hours: 0 });
    const gk = x.department;
    const gg = (groups[gk] = groups[gk] || { key: gk, label: names.department(gk) || 'Not set', places: 0, completed: 0 });
    pg.places++;
    gg.places++;
    counts.places++;
    if (done) {
      pg.completed++;
      gg.completed++;
      counts.completed++;
      pg.hours += a.hours10 / 10;
      counts.hours += a.hours10 / 10;
    }
    if (a.status === 'attended') counts.attended++;
    if (a.status === 'no_show') {
      pg.no_show++;
      counts.no_show++;
    }
    if (a.status === 'invited' || a.status === 'enrolled') {
      pg.waiting++;
      counts.waiting++;
    }
    if (a.result === 'fail') counts.failed++;
  }
  const rows = Object.keys(programs)
    .map((k) => Object.assign(programs[k], { completion_pct: r.pct(programs[k].completed, programs[k].places), hours: r.round1(programs[k].hours) }))
    .sort((a, b) => b.places - a.places);
  return {
    filters: r.shown(f),
    readouts: { places: counts.places, completed: counts.completed, completion_pct: r.pct(counts.completed, counts.places), no_show: counts.no_show, waiting: counts.waiting, failed: counts.failed, hours: r.round1(counts.hours), programs: rows.length },
    groups: Object.keys(groups)
      .map((k) => Object.assign(groups[k], { completion_pct: r.pct(groups[k].completed, groups[k].places) }))
      .sort((a, b) => b.places - a.places),
    table: r.table(
      [
        { key: 'name', label: 'Program', kind: 'text' },
        { key: 'places', label: 'Places', kind: 'number' },
        { key: 'completed', label: 'Completed', kind: 'number' },
        { key: 'completion_pct', label: 'Completion %', kind: 'number' },
        { key: 'no_show', label: 'No shows', kind: 'number' },
        { key: 'waiting', label: 'Not done', kind: 'number' },
        { key: 'hours', label: 'Hours', kind: 'number' },
      ],
      rows,
    ),
  };
}

module.exports = { absence: absence, hiring: hiring, training: training, FUNNEL: FUNNEL };
