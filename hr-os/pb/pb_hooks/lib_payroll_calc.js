/// <reference path="../pb_data/types.d.ts" />
/**
 * Payroll calculation (payroll-core): database rows to the engine input
 * (reference/ENGINE.md section 9), the engine call, the pre-flight checks
 * and the stored payslip with its lines.
 *
 *   runContext(app, runRec)                 -> rc (read once per run)
 *   buildInput(app, rc, employmentId, mode) -> { input, explains, refs, issues, packs, meta } | null
 *   calcOne(app, rc, employmentId)          -> stored payslip view
 *   prefetch(app, rc, employmentIds)        -> reads a chunk's time inputs together (lib_time.payInputsMany)
 *   recompute(app, payslipRec)              -> { hash, engine_hash, matches } (determinism check)
 *
 * Money inside the engine is major units; everything stored is minor units
 * (lib_money, exact for the currency's exponent).
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}

const HISTORY_DAYS = 550;
/** Pack issues that say a payslip lacks the year's earlier pay: folded into opening_balances_missing when that is the cause. */
const OPENING_CODES = { my_pcb_year_history_missing: true };
const STD_PER_YEAR = { monthly: 12, semi_monthly: 24, biweekly: 26, weekly: 52 };

/** Where each issue code is fixed (a hash link), for the Issues tab's "Fix". */
function fixFor(code, o) {
  const emp = o.employment || '';
  const num = o.number || '';
  switch (code) {
    case 'tax_profile_missing':
    case 'profile_missing':
    case 'profile_invalid':
    case 'field_conflict':
      return { label: 'Tax profile', link: '#/payroll/tax/' + emp };
    case 'entity_missing':
    case 'entity_invalid':
    case 'entity_field_missing':
      return { label: 'Payroll settings', link: '#/payroll/settings?entity=' + (o.entity || '') };
    case 'data_missing':
      if (o.scope === 'employee') return { label: 'Personal details', link: '#/people/' + num + '?tab=personal' };
      if (o.scope === 'entity') return { label: 'Payroll settings', link: '#/payroll/settings?entity=' + (o.entity || '') };
      return { label: 'Tax profile', link: '#/payroll/tax/' + emp };
    case 'pack_error':
      return { label: 'Rule packs', link: '#/payroll/packs' + (o.pack ? '/' + o.pack : '') };
    case 'paid_before_locked_run':
      return { label: 'Pay runs', link: '#/payroll/runs' };
    case 'bank_missing':
    case 'bank_changed_recently':
    case 'bank_currency_mismatch':
      return { label: 'Bank account', link: '#/people/' + num + '?tab=bank' };
    case 'no_active_pay':
    case 'currency_mismatch':
      return { label: 'Pay record', link: '#/people/' + num + '?tab=job' };
    case 'pack_not_active':
    case 'pack_not_in_force':
    case 'pack_unknown':
    case 'pack_invalid':
    case 'pack_missing':
    case 'pack_duplicate':
    case 'step_error':
      return { label: 'Rule packs', link: '#/payroll/packs' + (o.pack ? '/' + o.pack : '') };
    case 'history_short':
    case 'opening_balances_missing':
      return { label: 'Opening balances', link: '#/payroll/openings?entity=' + (o.entity || '') + (o.payrun ? '&payrun=' + o.payrun : '') };
    case 'component_missing':
    case 'component_formula':
      return { label: 'Components', link: '#/payroll/components' };
    case 'negative_net':
    case 'zero_gross':
    case 'below_min_wage':
    case 'variance_over_threshold':
    case 'joiner_proration':
    case 'leaver_proration':
      return { label: 'Payslip', link: '#/payroll/runs/' + (o.payrun || '') + '?employment=' + emp };
    case 'duplicate_regular_slip':
      return { label: 'Pay runs', link: '#/payroll/runs' };
    case 'leaver_pending':
      return { label: 'Loans', link: '#/payroll/loans?employment=' + emp };
    case 'leaver_leave_unpaid':
      return { label: 'Leave', link: '#/people/' + num + '?tab=m.leave' };
    default:
      if (o.module === 'time') return { label: 'Time', link: '#/time' };
      if (o.module === 'leave') return { label: 'Leave', link: '#/leave' };
      if (o.module === 'expenses') return { label: 'Expenses', link: '#/expenses' };
      return { label: 'Payslip', link: '#/payroll/runs/' + (o.payrun || '') + '?employment=' + emp };
  }
}

function issue(severity, code, message, extra) {
  const o = { severity: severity, code: code, message: message };
  if (extra) for (const k of Object.keys(extra)) o[k] = extra[k];
  return o;
}

/* ---------------------------------------------------------- run context */

function componentsOf(app, entityId) {
  const util = u();
  const pr = L('lib_payroll');
  const byCode = {};
  const byRole = {};
  const rows = util.findMany(app, 'pay_components', "entity = {:e} || entity = ''", 'sort,code', 0, { e: entityId });
  // Entity rows win over company-wide rows of the same code.
  rows.sort((a, b) => (a.getString('entity') === '' ? 1 : 0) - (b.getString('entity') === '' ? 1 : 0));
  for (const r of rows) {
    const v = pr.componentView(app, r);
    if (byCode[v.code] === undefined) byCode[v.code] = v;
  }
  const list = Object.keys(byCode).map((k) => byCode[k]);
  list.sort((a, b) => a.sort - b.sort || (a.code < b.code ? -1 : 1));
  for (const v of list) if (!v.archived && v.role !== '' && byRole[v.role] === undefined) byRole[v.role] = v;
  return { byCode: byCode, byRole: byRole };
}

/** Everything a run's payslips share, read once. */
function runContext(app, runRec) {
  const util = u();
  const pr = L('lib_payroll');
  const ent = app.findRecordById('entities', runRec.getString('entity'));
  const sched = runRec.getString('schedule') !== '' ? util.byId(app, 'pay_schedules', runRec.getString('schedule')) : util.byId(app, 'pay_schedules', ent.getString('default_pay_schedule'));
  const frequency = sched ? sched.getString('frequency') : 'monthly';
  const currency = ent.getString('currency');
  const settings = pr.settingsView(app, pr.ensureSettings(app, ent), ent);
  const options = util.jsonOf(runRec, 'options', {}) || {};
  const country = L('lib_countries').has(ent.getString('country')) ? L('lib_countries').get(ent.getString('country')) : null;
  const run = {
    id: runRec.id,
    number: runRec.getString('number'),
    kind: runRec.getString('kind'),
    period_start: runRec.getString('period_start'),
    period_end: runRec.getString('period_end'),
    pay_date: runRec.getString('pay_date'),
    cutoff_day: runRec.getString('cutoff_day'),
    corrects: runRec.getString('corrects'),
    replaces: runRec.getString('replaces'),
    year_end: runRec.getBool('year_end'),
    options: options,
    created: runRec.getString('created'),
  };
  return {
    run: run,
    ent: ent,
    entId: ent.id,
    country: ent.getString('country'),
    region: ent.getString('region'),
    countryData: country,
    currency: currency,
    exponent: L('lib_money').exponent(currency),
    settings: settings,
    sched: sched,
    frequency: frequency,
    ppy: sched ? pr.periodsPerYear(app, ent, sched, run.pay_date) : STD_PER_YEAR[frequency] || 12,
    std_ppy: STD_PER_YEAR[frequency] || 12,
    comps: componentsOf(app, ent.id),
    packCache: {},
    fyStart: fiscalStart(ent.getString('fiscal_year_start') || '01-01', run.pay_date),
    // The first day HR OS pays for this entity while opening balances matter (its first regular run, or a go-live day set).
    openingFrom: L('lib_payroll_openings').startOf(app, ent.id, settings.go_live_day, run),
  };
}

/** The first day of the fiscal year (MM-DD start) that contains `day`. */
function fiscalStart(mmdd, day) {
  const y = Number(day.slice(0, 4));
  const start = y + '-' + mmdd;
  return start <= day ? start : y - 1 + '-' + mmdd;
}

/* ------------------------------------------------------------- helpers */

function major(minor, cur) {
  return L('lib_money').toMajor(Math.round(minor), cur);
}

function minor(majorValue, cur) {
  return L('lib_money').majorToMinor(majorValue, cur);
}

function roundMinor(x) {
  return L('lib_money').round(x, 'half_up');
}

/** Working days of a full period by a week (rows per weekday) and a calendar, ignoring the employment dates. */
function periodWorkingDays(app, week, calendarId, from, to) {
  const util = u();
  const cal = L('lib_calendar');
  const hol = {};
  if (calendarId) for (const h of cal.holidaysBetween(app, calendarId, from, to)) if (h.kind !== 'optional') hol[h.day] = hol[h.day] && !hol[h.day].half ? hol[h.day] : h;
  let n = 0;
  for (let d = from; d <= to; d = util.dayAdd(d, 1)) {
    if (cal.weekMinutes(week, d) === 0) continue;
    const h = hol[d];
    if (h) {
      if (h.half) n += 0.5;
      continue;
    }
    n += 1;
  }
  return n;
}

/** Scheduled minutes over working days of [from, to] by a week (holidays not removed). */
function scheduledMinutes(week, from, to) {
  const util = u();
  const cal = L('lib_calendar');
  let m = 0;
  for (let d = from; d <= to; d = util.dayAdd(d, 1)) m += cal.weekMinutes(week, d);
  return m;
}

/** Days a fixed 30-day month counts for [from, to] inside [ps, pe]. */
function days30(from, to, ps, pe) {
  const util = u();
  if (from === ps && to === pe) return 30;
  return Math.min(30, util.daysBetween(from, to) + 1);
}

/** A pay record's amount for one full period of `rc.frequency`, in minor units (a float before rounding). */
function periodAmount(rc, payRec, workDaysInPeriod, minutesInPeriod) {
  const amt = payRec.amount_minor;
  const per = payRec.per;
  const f = rc.frequency;
  const ppy = rc.std_ppy;
  if (per === 'month') return f === 'monthly' ? amt : (amt * 12) / ppy;
  if (per === 'year') return amt / ppy;
  if (per === 'week') return f === 'weekly' ? amt : (amt * 52) / ppy;
  if (per === 'day') return amt * workDaysInPeriod;
  return (amt * minutesInPeriod) / 60;
}

/** Countries that pay leave out at a month over 26 days (MY Employment Act 1955 s 60I ordinary rate of pay; India's 26 working day month). */
const LEAVE_MONTH_OF_26 = { MY: true, IN: true };

/**
 * The rate leave is cashed in or paid out at, per day (and per hour), in minor
 * units (floats). Daily and hourly rated people: their own rate (a day is the
 * schedule's hours a day). Salaried: annual pay over 52 weeks of the
 * schedule's working days, which is SG's gross rate of pay for one day, the
 * US and AU final rate of pay and UK 1/260 of a year for a five day week; MY
 * and IN use the monthly pay over 26. Not the period's own working days: a
 * day of leave is worth the same in a short month and a long one.
 */
function leaveRate(rc, payNow, annual, hoursPerWeek, daysPerWeek) {
  const hoursPerDay = hoursPerWeek / daysPerWeek;
  if (!payNow) return { day: 0, hour: 0, rule: 'no pay record' };
  if (payNow.basis === 'daily') return { day: payNow.amount_minor, hour: payNow.amount_minor / hoursPerDay, rule: 'the day rate' };
  if (payNow.basis === 'hourly') return { day: payNow.amount_minor * hoursPerDay, hour: payNow.amount_minor, rule: 'the hourly rate x ' + Math.round(hoursPerDay * 100) / 100 + ' hours a day' };
  if (LEAVE_MONTH_OF_26[rc.country]) {
    const day = annual / 12 / 26;
    return { day: day, hour: day / hoursPerDay, rule: 'monthly pay / 26' };
  }
  const day = annual / (52 * daysPerWeek);
  return { day: day, hour: annual / (52 * hoursPerWeek), rule: 'annual pay / (52 x ' + daysPerWeek + ' working days)' };
}

/** The kind (voluntary | exit) of leave cash-ins by request id (leave_encash_requests.kind). */
function encashKinds(app, items) {
  const util = u();
  const ids = items.map((x) => String(x.request || '')).filter((x) => x !== '');
  const out = {};
  if (ids.length === 0) return out;
  const bind = {};
  const keys = ids.map((id, i) => {
    bind['q' + i] = id;
    return '{:q' + i + '}';
  });
  for (const r of util.rows(app, 'SELECT id, kind FROM leave_encash_requests WHERE id IN (' + keys.join(',') + ')', { id: '', kind: '' }, bind)) out[r.id] = r.kind;
  return out;
}

/** A pay record's amount for a year, in minor units (float). */
function annualAmount(payRec, hoursPerWeek, daysPerWeek) {
  const a = payRec.amount_minor;
  if (payRec.per === 'year') return a;
  if (payRec.per === 'month') return a * 12;
  if (payRec.per === 'week') return a * 52;
  if (payRec.per === 'day') return a * daysPerWeek * 52;
  return a * hoursPerWeek * 52;
}

function payRecView(r) {
  return { id: r.id, effective_from: r.getString('effective_from'), basis: r.getString('basis'), amount_minor: r.getInt('amount_minor'), currency: r.getString('currency'), per: r.getString('per'), pay_schedule: r.getString('pay_schedule') };
}

/** The packs of a calculation: active versions in force for the run, and blockers for the others. */
function packsFor(app, rc, codes, runIn, issues) {
  const pr = L('lib_payroll');
  const engine = L('lib_engine');
  const key = codes.slice().sort().join(',');
  let slot = rc.packCache[key];
  if (slot === undefined) {
    slot = pr.packRows(app, codes);
    rc.packCache[key] = slot;
  }
  const candidates = [];
  for (const c of codes) for (const b of slot[c].active) candidates.push(b);
  const picked = engine.pickVersions(candidates, runIn);
  const got = {};
  for (const p of picked) got[p.code] = p;
  for (const c of codes) {
    if (got[c]) continue;
    const s = slot[c];
    if (s.active.length > 0) issues.push(issue('blocker', 'pack_not_in_force', 'No version of the ' + s.name + ' pack covers this pay run (' + runIn.pay_date + '). Add or activate the version in force.', { pack: c }));
    else if (s.rows.length > 0) issues.push(issue('blocker', 'pack_not_active', 'The ' + s.name + ' pack is a draft: a person checks and activates it, or it comes off this person\'s tax profile packs.', { pack: c }));
    else issues.push(issue('blocker', 'pack_unknown', 'There is no rule pack ' + c + '.', { pack: c }));
  }
  return picked;
}

/* ------------------------------------------------- cached reference data */

function cached(rc, kind, id, load) {
  if (rc.cache === undefined) rc.cache = {};
  if (rc.cache[kind] === undefined) rc.cache[kind] = {};
  if (rc.cache[kind][id] === undefined) rc.cache[kind][id] = load();
  return rc.cache[kind][id];
}

/** What the calculation reads of an employment on a day: employee, job, location, schedule and calendar (reference rows cached per run). */
function employmentOn(app, rc, m, day) {
  const util = u();
  const people = L('lib_people');
  const e = app.findRecordById('employees', m.getString('employee'));
  const job = people.rowOn(app, 'job_records', m.id, day);
  const locId = job ? job.getString('location') : '';
  const loc = locId === '' ? null : cached(rc, 'loc', locId, () => {
    const r = util.byId(app, 'locations', locId);
    return r === null ? null : { id: r.id, country: r.getString('country'), region: r.getString('region'), calendar: r.getString('calendar') };
  });
  const schId = job && job.getString('schedule') !== '' ? job.getString('schedule') : rc.ent.getString('default_schedule');
  const schedule = schId === '' ? null : cached(rc, 'sch', schId, () => {
    const r = util.byId(app, 'work_schedules', schId);
    return r === null ? null : { id: r.id, week: util.jsonOf(r, 'week', []) || [], hours_per_week: r.getFloat('hours_per_week') };
  });
  const calId = job && job.getString('calendar') !== '' ? job.getString('calendar') : loc && loc.calendar !== '' ? loc.calendar : rc.ent.getString('default_calendar');
  const etId = job ? job.getString('employment_type') : '';
  const etype = etId === '' ? '' : cached(rc, 'et', etId, () => {
    const r = util.byId(app, 'employment_types', etId);
    return r === null ? '' : r.getString('code');
  });
  return {
    employee: { id: e.id, number: e.getString('number'), name: people.displayName(e), birth_date: e.getString('birth_date'), nationality: e.getString('nationality'), gender: e.getString('gender') },
    job: job === null ? null : { fte: job.getFloat('fte'), employment_type_code: etype, title: job.getString('title') },
    location: loc,
    schedule: schedule,
    calendarId: calId,
  };
}

/**
 * Time inputs of a chunk of employments, read together (lib_time.payInputsMany,
 * one call per employment window) before the chunk is calculated. Regular and
 * final pay runs only; buildInput takes them from rc.timeOf.
 */
function prefetch(app, rc, employmentIds) {
  const util = u();
  rc.timeOf = {};
  if ((rc.run.kind !== 'regular' && rc.run.kind !== 'termination') || employmentIds.length === 0) return;
  const bind = {};
  const keys = employmentIds.map((id, i) => {
    bind['m' + i] = id;
    return '{:m' + i + '}';
  });
  const groups = {};
  for (const m of util.rows(app, 'SELECT id, start_day, end_day FROM employments WHERE id IN (' + keys.join(',') + ')', { id: '', start_day: '', end_day: '' }, bind)) {
    const ws = m.start_day > rc.run.period_start ? m.start_day : rc.run.period_start;
    const we = m.end_day !== '' && m.end_day < rc.run.period_end ? m.end_day : rc.run.period_end;
    if (ws > we) continue;
    const k = ws + '|' + we;
    (groups[k] = groups[k] || []).push(m.id);
  }
  for (const k of Object.keys(groups)) {
    const w = k.split('|');
    try {
      const got = L('lib_time').payInputsMany(app, groups[k], w[0], w[1]);
      for (const id of groups[k]) rc.timeOf[id + '|' + k] = got[id];
    } catch (err) {
      // Each payslip then reads its own time inputs and reports its own error.
      console.error('[hr] payroll: time inputs of ' + groups[k].length + ' employments for ' + k + ' failed:', err);
    }
  }
}

/** One employment's time inputs for its window (from the chunk's read when there is one). */
function timeInputs(app, rc, employmentId, ws, we) {
  const k = employmentId + '|' + ws + '|' + we;
  if (rc.timeOf && rc.timeOf[k] !== undefined) return rc.timeOf[k];
  return L('lib_time').payInputsMany(app, [employmentId], ws, we)[employmentId];
}

/* ---------------------------------------------------------- the input */

/**
 * The engine input of one employment in a run. mode: 'run' (the run's own
 * kind) or { correction: origPayslipRec } (what the original payslip should
 * have been, for a correction run). Null when the employment is outside the
 * period.
 */
function buildInput(app, rc, employmentId, mode) {
  const util = u();
  const money = L('lib_money');
  const people = L('lib_people');
  const cal = L('lib_calendar');
  const pr = L('lib_payroll');
  const corr = mode && mode.correction ? mode.correction : null;
  const run = corr ? Object.assign({}, rc.run, { kind: corr.getString('kind'), pay_date: corr.getString('pay_date'), period_start: corr.getString('period_start'), period_end: corr.getString('period_end') }) : rc.run;
  const kind = run.kind;
  const cur = rc.currency;
  const m = app.findRecordById('employments', employmentId);
  const start = m.getString('start_day');
  const end = m.getString('end_day');
  const ws = start > run.period_start ? start : run.period_start;
  const we = end !== '' && end < run.period_end ? end : run.period_end;
  if (ws > we) return null;
  const issues = [];
  const lines = [];
  const explains = [];
  const refs = [];
  const at = employmentOn(app, rc, m, we);
  const employee = at.employee;
  const job = at.job;
  const schedule = at.schedule;
  const week = schedule ? schedule.week || [] : [];
  const hoursPerWeek = schedule && schedule.hours_per_week > 0 ? schedule.hours_per_week : 40;
  const daysPerWeek = Math.max(1, [0, 1, 2, 3, 4, 5, 6].filter((d) => week.some((r) => Number(r.dow) === d)).length || 5);
  const calendarId = at.calendarId;
  const extra = { employment: employmentId, number: employee.number, entity: rc.entId, payrun: run.id };

  // Days.
  const daysInPeriod = util.daysBetween(run.period_start, run.period_end) + 1;
  const workingDays = cached(rc, 'pwd', (schedule ? schedule.id : '') + '|' + calendarId + '|' + run.period_start + '|' + run.period_end, () => periodWorkingDays(app, week, calendarId, run.period_start, run.period_end));
  const wd = cal.workingDays(app, employmentId, ws, we);
  const employedWorking = wd.count;
  const fullPeriod = ws === run.period_start && we === run.period_end;

  // Other modules (SPEC 3.5).
  const regularish = kind === 'regular' || kind === 'termination';
  const time = regularish ? timeInputs(app, rc, employmentId, ws, we) : null;
  const leave = regularish ? L('lib_leave').payInputs(app, employmentId, ws, we) : null;
  for (const src of [
    ['time', time],
    ['leave', leave],
  ]) {
    if (!src[1]) continue;
    for (const i of src[1].issues || []) {
      let sev = i.severity === 'blocker' ? 'blocker' : 'warning';
      if (sev === 'blocker' && src[0] === 'time' && !rc.settings.require_approved_time) sev = 'warning';
      if (sev === 'blocker' && src[0] === 'leave' && !rc.settings.require_approved_leave) sev = 'warning';
      const more = {};
      for (const k of Object.keys(i)) if (k !== 'code' && k !== 'message' && k !== 'severity') more[k] = i[k];
      issues.push(issue(sev, String(i.code || src[0] + '_issue'), String(i.message || ''), Object.assign(more, { module: src[0] }, extra)));
    }
  }
  const unpaidDays = (leave ? Number(leave.unpaid_days) || 0 : 0) + (time ? Number(time.absent_days) || 0 : 0);
  const unpaidHours = leave ? Number(leave.unpaid_hours) || 0 : 0;
  const workedDays = Math.max(0, employedWorking - unpaidDays);

  // Proration of the employment window.
  const method = rc.settings.proration;
  const fraction = (from, to) => {
    if (from === run.period_start && to === run.period_end) return 1;
    if (method === 'calendar_days') return (util.daysBetween(from, to) + 1) / daysInPeriod;
    if (method === 'fixed_30') return days30(from, to, run.period_start, run.period_end) / 30;
    if (workingDays <= 0) return 0;
    if (from === ws && to === we) return employedWorking / workingDays;
    return cal.workingDays(app, employmentId, from, to).count / workingDays;
  };
  const empFraction = fraction(ws, we);

  const comp = (role, code) => {
    if (code) return rc.comps.byCode[code] || null;
    return rc.comps.byRole[role] || null;
  };
  const add = (c, amountMinor, o) => {
    const opt = o || {};
    if (amountMinor === 0 && !opt.keep) return;
    lines.push({
      code: c.code,
      name: opt.name || c.name,
      kind: c.kind,
      stage: c.kind === 'deduction' ? c.stage || 'post' : '',
      amount: major(amountMinor, cur),
      qty: typeof opt.qty === 'number' ? opt.qty : undefined,
      rate: typeof opt.rate === 'number' ? opt.rate : undefined,
      base: typeof opt.base === 'number' ? opt.base : undefined,
      tags: (c.tags || []).slice(),
      sort: c.sort,
      ref: opt.ref || '',
      component: c.id,
    });
    explains.push(Object.assign({ source: opt.source || 'component', component: c.code }, opt.explain || {}));
    refs.push({ ref_kind: opt.ref_kind || '', ref: opt.ref || '' });
  };
  const missingComp = (what) => issues.push(issue('blocker', 'component_missing', 'There is no pay component for ' + what + '. Add one in Components.', extra));

  // Pay records in the window.
  const payRecs = util.findMany(app, 'pay_records', 'employment = {:e} && effective_from <= {:t}', 'effective_from', 0, { e: employmentId, t: we }).map(payRecView);
  const segs = [];
  for (let i = 0; i < payRecs.length; i++) {
    const r = payRecs[i];
    const next = payRecs[i + 1];
    const sFrom = r.effective_from > ws ? r.effective_from : ws;
    const sTo = next && util.dayAdd(next.effective_from, -1) < we ? util.dayAdd(next.effective_from, -1) : we;
    if (sFrom <= sTo) segs.push({ rec: r, from: sFrom, to: sTo });
  }
  const payNow = payRecs.length > 0 ? payRecs[payRecs.length - 1] : null;
  for (const s of segs) if (s.rec.currency !== '' && s.rec.currency !== cur) issues.push(issue('blocker', 'currency_mismatch', 'The pay record from ' + s.rec.effective_from + ' is in ' + s.rec.currency + ' but ' + rc.ent.getString('name') + ' pays in ' + cur + '.', extra));
  const minutesInPeriod = scheduledMinutes(week, run.period_start, run.period_end);
  const fullAmount = payNow ? periodAmount(rc, payNow, workingDays, minutesInPeriod) : 0;
  const annual = payNow ? annualAmount(payNow, hoursPerWeek, daysPerWeek) : 0;
  const hourlyMinor = payNow ? (payNow.basis === 'hourly' ? payNow.amount_minor : annual / (52 * hoursPerWeek)) : 0;
  const dailyDivisor = method === 'calendar_days' ? daysInPeriod : method === 'fixed_30' ? 30 : workingDays;
  const dailyMinor = payNow ? (payNow.basis === 'daily' ? payNow.amount_minor : payNow.basis === 'hourly' ? (payNow.amount_minor * hoursPerWeek) / daysPerWeek : dailyDivisor > 0 ? fullAmount / dailyDivisor : 0) : 0;

  let basicMinor = 0;
  const payItems = kind === 'regular' || kind === 'termination';
  // A final pay run after the regular run of the same period was locked pays only the final items.
  const finalOnly =
    kind === 'termination' &&
    (rc.run.options.final_items_only === true ||
      util.count(app, "SELECT COUNT(*) AS n FROM payslips s JOIN payruns r ON r.id = s.payrun WHERE s.employment = {:e} AND r.kind = 'regular' AND r.status IN ('locked', 'paid') AND s.status IN ('locked', 'published') AND r.period_start = {:p}", { e: employmentId, p: run.period_start }) > 0);
  if (payItems && !finalOnly) {
    if (segs.length === 0) issues.push(issue('blocker', 'no_active_pay', 'No pay record for ' + ws + ' to ' + we + '.', Object.assign({ from: ws, to: we }, extra)));
    const salarySegs = segs.filter((s) => s.rec.basis === 'salary');
    if (salarySegs.length > 0) {
      const c = comp('basic');
      if (c === null) missingComp('base salary');
      else {
        let total = 0;
        const parts = [];
        for (const s of salarySegs) {
          const pa = periodAmount(rc, s.rec, workingDays, minutesInPeriod);
          const f = fraction(s.from, s.to);
          total += pa * f;
          parts.push({ from: s.from, to: s.to, pay_record: s.rec.id, amount_minor: s.rec.amount_minor, per: s.rec.per, period_amount_minor: roundMinor(pa), fraction: Math.round(f * 1e6) / 1e6 });
        }
        basicMinor = roundMinor(total);
        add(c, basicMinor, {
          keep: true,
          qty: Math.round(empFraction * 1e6) / 1e6,
          rate: major(roundMinor(fullAmount), cur),
          source: 'basic',
          explain: { method: method, days_in_period: daysInPeriod, working_days_in_period: workingDays, employed_days: employedWorking, segments: parts, note: fullPeriod && salarySegs.length === 1 ? 'Full period at the pay record amount.' : 'Prorated by ' + method.replace('_', ' ') + ' for the days employed and each pay record.' },
        });
      }
    }
    const hourlySegs = segs.filter((s) => s.rec.basis === 'hourly');
    if (hourlySegs.length > 0) {
      const c = comp('hourly');
      if (c === null) missingComp('hourly pay');
      else {
        const hours = time ? (Number(time.regular_minutes) || 0) / 60 : 0;
        const rate = hourlySegs[hourlySegs.length - 1].rec.amount_minor;
        basicMinor = roundMinor(hours * rate);
        add(c, basicMinor, { keep: true, qty: Math.round(hours * 100) / 100, rate: major(rate, cur), source: 'hours', explain: { regular_minutes: time ? time.regular_minutes : 0, rate_minor: rate, note: 'Regular hours from Time times the hourly rate.' } });
        const paidLeave = leave ? Object.keys(leave.paid_days || {}).reduce((a, k) => a + (Number(leave.paid_days[k]) || 0), 0) : 0;
        if (paidLeave > 0) {
          const lh = (paidLeave * hoursPerWeek) / daysPerWeek;
          add(c, roundMinor(lh * rate), { name: 'Paid leave', qty: Math.round(lh * 100) / 100, rate: major(rate, cur), source: 'leave', ref_kind: 'leave', explain: { paid_days: leave.paid_days, hours_per_day: hoursPerWeek / daysPerWeek, note: 'Paid leave days times the scheduled hours a day times the hourly rate.' } });
        }
      }
    }
    const dailySegs = segs.filter((s) => s.rec.basis === 'daily');
    if (dailySegs.length > 0) {
      const c = comp('daily');
      if (c === null) missingComp('daily pay');
      else {
        const rate = dailySegs[dailySegs.length - 1].rec.amount_minor;
        basicMinor = roundMinor(workedDays * rate);
        add(c, basicMinor, { keep: true, qty: workedDays, rate: major(rate, cur), source: 'days', explain: { worked_days: workedDays, rate_minor: rate, note: 'Days worked times the daily rate.' } });
      }
    }
    // Unpaid leave and absences (salaried pay).
    if (salarySegs.length > 0 && (unpaidDays > 0 || unpaidHours > 0)) {
      const c = comp('unpaid');
      if (c === null) missingComp('unpaid leave');
      else {
        const amt = Math.min(basicMinor, roundMinor(dailyMinor * unpaidDays + hourlyMinor * unpaidHours));
        add(c, -amt, { qty: unpaidDays + unpaidHours / (hoursPerWeek / daysPerWeek), rate: major(roundMinor(dailyMinor), cur), source: 'unpaid', ref_kind: 'leave', explain: { unpaid_days: leave ? leave.unpaid_days : 0, absent_days: time ? time.absent_days : 0, unpaid_hours: unpaidHours, daily_rate_minor: roundMinor(dailyMinor), divisor: dailyDivisor, method: method, note: 'Daily rate (period pay / ' + dailyDivisor + ') times the unpaid days.' } });
      }
    }
    // Overtime from Time.
    for (const ot of time ? time.overtime || [] : []) {
      const c = comp('', String(ot.component || ''));
      if (c === null) {
        issues.push(issue('blocker', 'component_missing', 'Time sent overtime ' + ot.component + ' but there is no pay component with that code. Add it in Components.', extra));
        continue;
      }
      const mult = Number(ot.multiplier) || c.multiplier || 1;
      const hours = (Number(ot.minutes) || 0) / 60;
      const rateMinor = hourlyMinor * mult;
      add(c, roundMinor(hours * rateMinor), { qty: Math.round(hours * 100) / 100, rate: major(roundMinor(rateMinor), cur), source: 'overtime', ref_kind: 'time', explain: { minutes: ot.minutes, multiplier: mult, hourly_rate_minor: roundMinor(hourlyMinor), hours_per_week: hoursPerWeek, note: 'Hours times the hourly rate (annual pay / 52 / ' + hoursPerWeek + ' hours) times ' + mult + '.' } });
    }
  }

  // Days an earlier locked run used that changed afterwards (time's adjustments): one line each, with
  // the day and the reason. Overtime and premiums at their multiplier, regular hours for hourly pay,
  // absence days at the day rate (salaried and daily pay); late minutes change no pay.
  if (time && !corr) {
    const hourlyRec = segs.filter((s) => s.rec.basis === 'hourly').map((s) => s.rec).pop() || null;
    const dailyRec = segs.filter((s) => s.rec.basis === 'daily').map((s) => s.rec).pop() || null;
    const salaried = segs.some((s) => s.rec.basis === 'salary');
    for (const a of time.adjustments) {
      const on = dayWords(String(a.day));
      const ex = { day: a.day, reason: a.reason, locked_by_payrun: a.locked_by_payrun || '', component: a.component, minutes: a.minutes, multiplier: a.multiplier, days: a.days === undefined ? null : a.days, note: a.reason };
      if (a.component === 'late') continue;
      if (a.component === 'absent') {
        const days = Number(a.days) || 0;
        if (days === 0) continue;
        const c = salaried ? comp('unpaid') : dailyRec ? comp('daily') : null;
        if (c === null) continue;
        const rate = salaried ? dailyMinor : dailyRec.amount_minor;
        add(c, -roundMinor(days * rate), { name: c.name + ' adjustment, ' + on, qty: -days, rate: major(roundMinor(rate), cur), source: 'time_adjustment', ref_kind: 'time', explain: ex });
        continue;
      }
      if (a.component === 'regular') {
        if (hourlyRec === null) continue;
        const c = comp('hourly');
        if (c === null) {
          missingComp('hourly pay');
          continue;
        }
        const hours = (Number(a.minutes) || 0) / 60;
        add(c, roundMinor(hours * hourlyRec.amount_minor), { name: c.name + ' adjustment, ' + on, qty: Math.round(hours * 100) / 100, rate: major(hourlyRec.amount_minor, cur), source: 'time_adjustment', ref_kind: 'time', explain: ex });
        continue;
      }
      const c = comp('', String(a.component || ''));
      if (c === null) {
        issues.push(issue('blocker', 'component_missing', 'Time sent an adjustment for ' + a.component + ' but there is no pay component with that code. Add it in Components.', extra));
        continue;
      }
      const mult = Number(a.multiplier) || c.multiplier || 1;
      const hours = (Number(a.minutes) || 0) / 60;
      add(c, roundMinor(hours * hourlyMinor * mult), { name: c.name + ' adjustment, ' + on, qty: Math.round(hours * 100) / 100, rate: major(roundMinor(hourlyMinor * mult), cur), source: 'time_adjustment', ref_kind: 'time', explain: ex });
    }
  }

  // Recurring items and benefits (regular and final pay).
  const earningsSoFar = () => lines.filter((l) => l.kind === 'earning').reduce((a, l) => a + minor(l.amount, cur), 0);
  const tagSoFar = (tag) => lines.filter((l) => (l.tags || []).indexOf(tag) >= 0).reduce((a, l) => a + minor(l.amount, cur), 0);
  const baseOf = (c) => (c.base === 'gross' ? earningsSoFar() : c.base && c.base.indexOf('tag:') === 0 ? tagSoFar(c.base.slice(4)) : basicMinor);
  if (payItems && !finalOnly) {
    for (const r of util.findMany(app, 'recurring_items', "employment = {:e} && from_day <= {:t} && (to_day = '' || to_day >= {:f})", 'created', 0, { e: employmentId, f: run.period_start, t: run.period_end })) {
      const c = rc.comps.byCode[codeOfComponent(app, r.getString('component'))];
      if (!c) {
        missingComp('a recurring item');
        continue;
      }
      if (r.getString('currency') !== '' && r.getString('currency') !== cur) {
        issues.push(issue('blocker', 'currency_mismatch', 'A recurring ' + c.name + ' is in ' + r.getString('currency') + ', not ' + cur + '.', extra));
        continue;
      }
      let amt;
      let ex;
      if (r.getFloat('percent') !== 0 || (c.calc === 'percent' && r.getInt('amount_minor') === 0)) {
        const pct = r.getFloat('percent') !== 0 ? r.getFloat('percent') : c.percent;
        const base = baseOf(c);
        amt = roundMinor((base * pct) / 100);
        ex = { percent: pct, base: c.base || 'basic', base_minor: base, note: pct + '% of ' + (c.base || 'basic pay') + '.' };
        add(c, amt, { rate: pct / 100, base: major(base, cur), source: 'recurring', ref: r.id, ref_kind: 'recurring', explain: ex });
      } else {
        const full = r.getInt('amount_minor') !== 0 ? r.getInt('amount_minor') : c.amount_minor;
        const itemFrom = r.getString('from_day') > ws ? r.getString('from_day') : ws;
        const itemTo = r.getString('to_day') !== '' && r.getString('to_day') < we ? r.getString('to_day') : we;
        const f = c.prorate ? (itemFrom > itemTo ? 0 : fraction(itemFrom, itemTo)) : 1;
        amt = roundMinor(full * f);
        add(c, amt, { qty: f !== 1 ? Math.round(f * 1e6) / 1e6 : undefined, rate: f !== 1 ? major(full, cur) : undefined, source: 'recurring', ref: r.id, ref_kind: 'recurring', explain: { amount_minor: full, fraction: f, note: f !== 1 ? 'Prorated for the days it applies.' : 'Fixed amount each period.' } });
      }
    }
    for (const en of util.findMany(app, 'benefit_enrollments', "employment = {:e} && from_day <= {:t} && (to_day = '' || to_day >= {:f})", 'created', 0, { e: employmentId, f: run.period_start, t: run.period_end })) {
      const plan = util.byId(app, 'benefit_plans', en.getString('plan'));
      if (plan === null || !plan.getBool('active')) continue;
      const eeC = plan.getString('employee_component') ? rc.comps.byCode[codeOfComponent(app, plan.getString('employee_component'))] : null;
      const erC = plan.getString('employer_component') ? rc.comps.byCode[codeOfComponent(app, plan.getString('employer_component'))] : null;
      const ee = en.getBool('override') ? en.getInt('amount_minor') : plan.getInt('amount_minor') > 0 ? plan.getInt('amount_minor') : roundMinor((basicMinor * plan.getFloat('percent')) / 100);
      const er = en.getBool('override') ? en.getInt('employer_amount_minor') : plan.getInt('employer_amount_minor') > 0 ? plan.getInt('employer_amount_minor') : roundMinor((basicMinor * plan.getFloat('employer_percent')) / 100);
      if (eeC && ee > 0) add(eeC, ee, { name: plan.getString('name'), source: 'benefit', ref: en.id, ref_kind: 'benefit', explain: { plan: plan.getString('name'), note: en.getBool('override') ? 'The amount set on the enrolment.' : plan.getInt('amount_minor') > 0 ? 'The plan amount.' : plan.getFloat('percent') + '% of basic pay.' } });
      if (erC && er > 0) add(erC, er, { name: plan.getString('name') + ' (employer)', source: 'benefit', ref: en.id, ref_kind: 'benefit', explain: { plan: plan.getString('name'), note: 'The employer share of the plan.' } });
    }
  }

  // One-off pay inputs: those meant for this run, and (regular and final pay) every open input due by the period end.
  const inputs = corr
    ? []
    : util.findMany(app, 'pay_inputs', payItems ? "employment = {:e} && status = 'open' && (payrun = {:r} || (payrun = '' && period_start <= {:t}))" : "employment = {:e} && status = 'open' && payrun = {:r}", 'period_start,created', 0, { e: employmentId, r: run.id, t: run.period_end });
  if (corr) {
    // A correction keeps what the original paid from inputs and other modules, and adds the inputs meant for the correction run.
    const orig = util.jsonOf(corr, 'input', {}) || {};
    const keepKinds = { pay_input: true, claim: true, advance: true, advance_payout: true, encash: true, loan: true, hold: true };
    const origRefs = util.findMany(app, 'payslip_lines', 'payslip = {:p}', 'sort', 0, { p: corr.id });
    for (let i = 0; i < (orig.lines || []).length; i++) {
      const ol = orig.lines[i];
      const lr = origRefs.filter((x) => x.getString('code') === ol.code && x.getString('ref') === (ol.ref || '') && x.getString('source') === 'input')[0];
      const rk = lr ? lr.getString('ref_kind') : '';
      if (!keepKinds[rk]) continue;
      lines.push(Object.assign({}, ol));
      explains.push({ source: 'original', note: 'Paid in the original payslip; kept as it was.' });
      refs.push({ ref_kind: rk, ref: ol.ref || '' });
    }
    for (const r of util.findMany(app, 'pay_inputs', "employment = {:e} && status = 'open' && payrun = {:r}", 'created', 0, { e: employmentId, r: rc.run.id })) inputs.push(r);
  }
  for (const r of inputs) {
    const c = rc.comps.byCode[codeOfComponent(app, r.getString('component'))];
    if (!c) {
      missingComp('a pay input');
      continue;
    }
    if (r.getString('currency') !== '' && r.getString('currency') !== cur) {
      issues.push(issue('blocker', 'currency_mismatch', 'A ' + c.name + ' input is in ' + r.getString('currency') + ', not ' + cur + '.', extra));
      continue;
    }
    const qty = r.getFloat('qty');
    const rate = r.getInt('rate_minor');
    const amt = r.getInt('amount_minor') !== 0 ? r.getInt('amount_minor') : roundMinor(qty * rate);
    add(c, amt, { qty: qty !== 0 ? qty : undefined, rate: rate !== 0 ? major(rate, cur) : undefined, source: 'pay_input', ref: r.id, ref_kind: 'pay_input', explain: { source_kind: r.getString('source'), period: r.getString('period_start') + ' to ' + r.getString('period_end'), note: r.getString('note') || 'One-off pay input.', detail: util.jsonOf(r, 'detail', null) } });
  }

  // Loans (regular and final pay): this period's installment, or the whole balance in a final pay.
  if (payItems && !corr) {
    const month = run.period_end.slice(0, 7);
    for (const ln of util.findMany(app, 'loans', "employment = {:e} && status = 'active' && paused = false && balance_minor > 0", 'created', 0, { e: employmentId })) {
      if (ln.getString('start_period') !== '' && ln.getString('start_period') > month) continue;
      const c = comp('loan');
      if (c === null) {
        missingComp('loan repayment');
        break;
      }
      const amt = kind === 'termination' || end !== '' && end <= run.period_end ? ln.getInt('balance_minor') : Math.min(ln.getInt('installment_minor'), ln.getInt('balance_minor'));
      add(c, amt, { name: c.name + ' (' + ln.getString('kind').replace('_', ' ') + ')', source: 'loan', ref: ln.id, ref_kind: 'loan', explain: { balance_minor: ln.getInt('balance_minor'), installment_minor: ln.getInt('installment_minor'), note: kind === 'termination' ? 'The whole balance is recovered from the final pay.' : 'This period\'s installment.' } });
    }
  }

  // Expenses (SPEC 3.5): approved claims and advances paid with this run (a regular or final pay run
  // pays what is due through payroll, a reimbursement run what is paid by bank), and advance recovery.
  if ((payItems || kind === 'reimbursement') && !corr) {
    const upTo = rc.run.cutoff_day || run.period_end;
    for (const it of L('lib_expenses').payInputs(app, employmentId, upTo, cur, { via: kind === 'reimbursement' ? 'bank' : 'payroll' }) || []) {
      if (it.issue) issues.push(issue(it.issue.severity === 'blocker' ? 'blocker' : 'warning', String(it.issue.code || 'expenses_issue'), String(it.issue.message || ''), Object.assign({ module: 'expenses' }, extra)));
      if (it.currency && it.currency !== cur) {
        if (!it.issue) issues.push(issue('blocker', 'currency_mismatch', String(it.name || it.ref) + ' is in ' + it.currency + ', not ' + cur + '.', Object.assign({ module: 'expenses' }, extra)));
        continue;
      }
      const code = String(it.component || '');
      const c = rc.comps.byCode[code];
      if (!c) {
        issues.push(issue('blocker', 'component_missing', String(it.name || 'An expense') + ' is paid with component ' + code + ', which ' + rc.ent.getString('name') + ' does not have. Add it in Components.', Object.assign({ module: 'expenses' }, extra)));
        continue;
      }
      const payout = it.kind === 'advance';
      add(c, Math.round(Number(it.amount_minor) || 0), {
        name: it.name ? String(it.name) : undefined,
        source: payout ? 'advance' : 'claims',
        ref: String(it.ref),
        ref_kind: payout ? 'advance_payout' : 'claim',
        explain: { ref: it.ref, number: it.number || '', kind: it.kind, taxable: it.taxable === true, categories: it.categories || [], original_minor: it.original_minor, original_currency: it.original_currency, note: payout ? 'Advance paid with this pay run.' : 'Approved expense claim.' },
      });
    }
    if (payItems) {
      for (const ad of L('lib_expenses').advanceRecovery(app, employmentId, upTo) || []) {
        if (ad.currency && ad.currency !== cur) {
          issues.push(issue('blocker', 'currency_mismatch', 'Advance ' + (ad.number || ad.advance) + ' is in ' + ad.currency + ', not ' + cur + '.', Object.assign({ module: 'expenses' }, extra)));
          continue;
        }
        const c = comp('advance');
        if (!c) {
          missingComp('advance recovery');
          continue;
        }
        add(c, Math.round(Number(ad.amount_minor) || 0), { name: ad.name ? String(ad.name) : undefined, source: 'advance', ref: String(ad.advance), ref_kind: 'advance', explain: { advance: ad.advance, number: ad.number || '', reason: ad.reason || '', note: ad.reason === 'leaving' ? 'The advance balance is recovered from the final pay.' : 'Recovery of an employee advance.' } });
      }
    }
    // A leaver's final pay: what Expenses still has open (claims not decided yet, advances not paid out).
    if (kind === 'termination' || (end !== '' && end <= run.period_end)) {
      const o = L('lib_expenses').outstanding(app, employmentId);
      if (o.open_claims > 0) issues.push(issue('warning', 'leaver_open_claims', o.open_claims + ' expense claim' + (o.open_claims === 1 ? '' : 's') + ' not decided yet: decide them before the final pay, or pay them later.', Object.assign({ module: 'expenses', n: o.open_claims }, extra)));
      if (o.advances_unpaid > 0) issues.push(issue('warning', 'leaver_open_advances', o.advances_unpaid + ' advance' + (o.advances_unpaid === 1 ? '' : 's') + ' requested or approved but not paid out.', Object.assign({ module: 'expenses', n: o.advances_unpaid }, extra)));
    }
  }

  // Leave cashed in, or paid out on leaving (SPEC 3.5): days (leave gives an hours type as hours over
  // the person's hours a day) at the leave day rate. Leave's exit cash-ins (kind exit, made when a
  // separation is approved) go on LEAVE_EXIT (role exit_leave, tags exit_leave_payout and termination);
  // a cash-in a person asked for stays on the encashment component.
  const lRate = leaveRate(rc, payNow, annual, hoursPerWeek, daysPerWeek);
  let exitLeaveDays = 0;
  if (leave && !corr && (leave.encash || []).length > 0) {
    const kinds = encashKinds(app, leave.encash);
    for (const ec of leave.encash) {
      const exit = kinds[String(ec.request || '')] === 'exit';
      if (exit) exitLeaveDays += Number(ec.days) || 0;
      const c = comp(exit ? 'exit_leave' : 'encash');
      if (!c) {
        missingComp(exit ? 'unused leave paid on leaving (LEAVE_EXIT)' : 'leave encashment');
        continue;
      }
      {
        const days = Number(ec.days) || 0;
        add(c, roundMinor(days * lRate.day), {
          qty: days,
          rate: major(roundMinor(lRate.day), cur),
          name: c.name + (ec.type ? ' (' + ec.type + ')' : ''),
          source: 'leave',
          ref: String(ec.request || ''),
          ref_kind: 'encash',
          explain: { type: ec.type, days: days, daily_rate_minor: roundMinor(lRate.day), rule: lRate.rule, exit: exit, note: (exit ? 'Unused leave paid out on leaving: days' : 'Days of leave') + ' times the leave day rate (' + lRate.rule + ').' },
        });
      }
    }
  }

  // A leaver's unused leave of the types paid out on leaving (leave marks them and makes the payouts
  // when the separation is approved): what is left on the last day with no payout line here is a warning.
  if (leave && !corr && end !== '' && end <= run.period_end && (kind === 'termination' || kind === 'regular')) {
    const paidHere = {};
    for (const ec of leave.encash || []) paidHere[String(ec.type || '')] = true;
    for (const tp of util.rows(app, "SELECT code, name, unit FROM leave_types WHERE payout_on_exit = TRUE AND archived = FALSE AND (entity = {:e} OR entity = '') ORDER BY name", { code: '', name: '', unit: '' }, { e: rc.entId })) {
      const b = L('lib_leave').balance(app, employmentId, tp.code, end);
      const left = Math.round((Number(b.balance) || 0) * 100) / 100;
      if (!b.tracked || left <= 0) continue;
      const unit = (b.unit || tp.unit) === 'hour' ? 'hour' : 'day';
      issues.push(
        issue('warning', 'leaver_leave_unpaid', left + ' ' + unit + (left === 1 ? '' : 's') + ' of ' + tp.name + ' left on the last day with ' + (paidHere[tp.code] ? 'only part of it' : 'nothing') + ' paid out in this run. Leave pays it out when the separation is approved: check the separation, or add a cash-in.', Object.assign({ module: 'leave', n: left, unit: unit, type: tp.code, type_name: tp.name, partly: paidHere[tp.code] === true }, extra)),
      );
    }
  }

  // Tax profile and packs.
  const pd = run.pay_date < start ? start : end !== '' && run.pay_date > end ? end : run.pay_date;
  const taxRec = people.rowOn(app, 'tax_profiles', employmentId, pd < start ? start : pd);
  if (taxRec === null) issues.push(issue('blocker', 'tax_profile_missing', 'No tax profile on ' + pd + '.', Object.assign({ day: pd }, extra)));
  const tax = taxRec !== null ? people.taxView(taxRec) : { packs: [], fields: {} };
  const codes = tax.packs && tax.packs.length > 0 ? tax.packs.slice() : util.jsonOf(rc.ent, 'packs', []) || [];

  const runIn = {
    kind: kind,
    period_start: run.period_start,
    period_end: run.period_end,
    pay_date: run.pay_date,
    frequency: rc.frequency,
    periods_per_year: rc.ppy,
    days_in_period: daysInPeriod,
    working_days_in_period: workingDays,
    worked_days: workedDays,
    year_end: run.year_end === true,
  };
  const packs = packsFor(app, rc, codes, runIn, issues);
  for (const i of issues) if (i.pack !== undefined) Object.assign(i, extra);

  // History: the locked payslips of this employment (same currency) up to the end of the latest tax
  // year a pack reads, whatever their pay date (a run dated before a locked run of the same period
  // must see it, or wage bases and caps are used twice), plus opening balances.
  const eng = L('lib_engine');
  let histTo = run.pay_date;
  for (const pk of packs) {
    const ty = eng.taxYearOf(pk, eng.basisDay(pk, runIn) || run.pay_date);
    if (ty.end > histTo) histTo = ty.end;
  }
  const hist = historyOf(app, employmentId, run, cur, corr, rc.run.id, histTo);
  if (!corr && hist.later.length > 0) {
    const same = hist.later.filter((x) => x.period_start === run.period_start && x.period_end === run.period_end);
    const x = (same.length > 0 ? same : hist.later)[0];
    const others = hist.later.length - 1;
    issues.push(
      issue(
        'warning',
        'paid_before_locked_run',
        'This pay date (' + run.pay_date + ') is before ' + x.number + ', already locked' + (same.length > 0 ? ' for the same period' : '') + ' with pay day ' + x.pay_date + (others > 0 ? ' (and ' + others + ' more locked payslip' + (others === 1 ? '' : 's') + ' dated later)' : '') + '. Its pay counts in this payslip\'s year to date, so wage bases and caps are not used twice.',
        Object.assign({ runs: hist.later.map((r) => r.number), run_number: x.number, day: run.pay_date, locked_day: x.pay_date, same_period: same.length > 0, others: others }, extra),
      ),
    );
  }
  let historyFrom = util.dayAdd(run.pay_date, -HISTORY_DAYS);
  if (start > historyFrom) historyFrom = start;
  // Pay before HR OS in a tax year that began earlier: the person's opening balance, or the entity's
  // confirmation that nobody was paid earlier this tax year; else the history starts at HR OS and the
  // payslip is blocked (opening_balances_missing).
  const OP = L('lib_payroll_openings');
  const opening = corr || rc.openingFrom === '' ? null : OP.needOf(rc.openingFrom, packs, runIn, start, end, hist.openingDays);
  let profileExtra = {};
  if (opening !== null && !opening.covered) {
    if (rc.settings.no_earlier_pay) profileExtra = OP.confirmedProfile(packs, tax.fields || {});
    else if (opening.from > historyFrom) historyFrom = opening.from;
  }

  // Context the packs read.
  const cd = rc.countryData;
  let minWage = null;
  if (cd && cd.min_wage && (!cd.min_wage.currency || cd.min_wage.currency === cur)) {
    const workRegion = at.location && at.location.region ? at.location.region : rc.region;
    const byR = cd.min_wage.by_region && cd.min_wage.by_region[workRegion];
    minWage = byR && byR.hourly ? Number(byR.hourly) : cd.min_wage.hourly ? Number(cd.min_wage.hourly) : null;
  }
  const workedMinutes = time && Number(time.worked_minutes) > 0 ? Number(time.worked_minutes) : null;
  let scheduled = 0;
  for (const d of wd.days) scheduled += cal.weekMinutes(week, d);
  for (const h of wd.holidays) if (h.half) scheduled -= cal.weekMinutes(week, h.day) / 2;
  const hoursWorked = workedMinutes !== null ? workedMinutes / 60 : (scheduled / 60) * (employedWorking > 0 ? workedDays / employedWorking : 1);
  const context = {
    hours_worked: Math.round(hoursWorked * 100) / 100,
    ma_annual_regular_wages: payNow ? major(roundMinor(annual), cur) : 0,
  };
  if (minWage !== null) context.min_wage_hourly = minWage;
  if (exitLeaveDays > 0) context.exit_leave_days = Math.round(exitLeaveDays * 100) / 100;
  if (rc.run.options && rc.run.options.jp_bonus_over_6_months === true) context.jp_bonus_over_6_months = true;

  const loc = at.location;
  const birth = employee.birth_date || '';
  const input = {
    run: runIn,
    employee: {
      id: employee.id,
      birth_date: birth !== '' ? birth : null,
      age: birth !== '' ? people.ageOn({ birth_date: birth }, run.period_end) : null,
      hire_day: start,
      end_day: end !== '' ? end : null,
      nationality: employee.nationality || '',
      gender: employee.gender || '',
      years_of_service: Math.max(0, Math.floor(util.daysBetween(start, run.period_end) / 365.25)),
    },
    employment: {
      id: employmentId,
      entity_country: rc.country,
      entity_region: rc.region,
      work_country: loc && loc.country ? loc.country : rc.country,
      work_region: loc && loc.region ? loc.region : rc.region,
      fte: job && job.fte > 0 ? job.fte : 1,
      employment_type: job ? job.employment_type_code || '' : '',
    },
    profile: Object.keys(profileExtra).length > 0 ? Object.assign({}, tax.fields || {}, profileExtra) : tax.fields || {},
    entity: rc.settings.entity_fields || {},
    currency: { code: cur, exponent: rc.exponent },
    lines: lines.map(clean),
    history: hist.rows,
    history_from: historyFrom,
    context: context,
  };
  // Joiners and leavers get a warning that says the days.
  if (!fullPeriod && kind === 'regular') {
    if (start > run.period_start) issues.push(issue('warning', 'joiner_proration', 'Joined on ' + start + ': pay is for ' + employedWorking + ' of ' + workingDays + ' working days.', Object.assign({ day: start, employed: employedWorking, working: workingDays }, extra)));
    if (end !== '' && end < run.period_end) issues.push(issue('warning', 'leaver_proration', 'Leaves on ' + end + ': pay is for ' + employedWorking + ' of ' + workingDays + ' working days. A final pay run settles leave and loans.', Object.assign({ day: end, employed: employedWorking, working: workingDays }, extra)));
  }
  return {
    input: input,
    explains: explains,
    refs: refs,
    issues: issues,
    packs: packs,
    employee: employee,
    employment: m,
    tax_profile: taxRec ? taxRec.id : '',
    opening: opening !== null && !opening.covered && !rc.settings.no_earlier_pay ? opening : null,
    meta: { window: { from: ws, to: we }, full_period: fullPeriod, fraction: empFraction, method: method, working_days: workingDays, employed_days: employedWorking, worked_days: workedDays, unpaid_days: unpaidDays, pack_codes: codes, pay_now: payNow, daily_rate_minor: roundMinor(dailyMinor), hourly_rate_minor: roundMinor(hourlyMinor), leave_day_rate_minor: roundMinor(lRate.day), leave_rate_rule: lRate.rule },
  };
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A day in a payslip line's name ("28 Nov 2026"): line names are text, like every other line name. */
function dayWords(day) {
  return Number(day.slice(8, 10)) + ' ' + MONTHS_SHORT[Number(day.slice(5, 7)) - 1] + ' ' + day.slice(0, 4);
}

/** A line for the engine without undefined keys (stored JSON must round-trip byte for byte). */
function clean(l) {
  const o = {};
  for (const k of Object.keys(l)) if (l[k] !== undefined) o[k] = l[k];
  return o;
}

let _codeCache = {};
function codeOfComponent(app, id) {
  if (_codeCache[id] !== undefined) return _codeCache[id];
  const r = u().byId(app, 'pay_components', id);
  const c = r ? r.getString('code') : '';
  if (Object.keys(_codeCache).length > 2000) _codeCache = {};
  _codeCache[id] = c;
  return c;
}

/**
 * Locked payslips (not void, same currency) dated from 550 days before the
 * pay date up to `upTo` (the end of the latest tax year a pack reads), as
 * engine history rows, plus opening balances. Payslips locked with a later pay
 * date than this run are in it too (the engine sums a tax year whatever the
 * order) and come back in `later`. For a correction recompute, the original
 * and its corrections are left out and only what was there when the original
 * was calculated counts.
 */
function historyOf(app, employmentId, run, cur, corr, thisRunId, upTo) {
  const util = u();
  const from = util.dayAdd(run.pay_date, -HISTORY_DAYS);
  const bind = { e: employmentId, f: from, t: run.pay_date, u: upTo && upTo > run.pay_date ? upTo : run.pay_date, c: cur, r: thisRunId };
  let extraWhere = '';
  if (corr) {
    bind.op = corr.getString('payrun');
    bind.oc = corr.getString('created');
    extraWhere = " AND s.payrun != {:op} AND COALESCE(r.corrects, '') != {:op} AND (s.pay_date < {:t} OR s.created < {:oc})";
  }
  const slips = util.rows(
    app,
    "SELECT s.id AS id, s.kind AS kind, s.pay_date AS pay_date, s.period_start AS period_start, s.period_end AS period_end, r.number AS number FROM payslips s JOIN payruns r ON r.id = s.payrun WHERE s.employment = {:e} AND s.status IN ('locked', 'published') AND r.status IN ('locked', 'paid') AND s.currency = {:c} AND s.pay_date >= {:f} AND s.pay_date <= {:u} AND s.payrun != {:r}" + extraWhere + ' ORDER BY s.pay_date, s.created',
    { id: '', kind: '', pay_date: '', period_start: '', period_end: '', number: '' },
    bind,
  );
  const later = slips.filter((s) => s.pay_date > run.pay_date).map((s) => ({ number: s.number, pay_date: s.pay_date, period_start: s.period_start, period_end: s.period_end, kind: s.kind }));
  const rows = [];
  if (slips.length > 0) {
    const keys = slips.map((s, i) => {
      bind['s' + i] = s.id;
      return '{:s' + i + '}';
    });
    const ls = util.rows(app, 'SELECT payslip, code, tags, amount_minor FROM payslip_lines WHERE payslip IN (' + keys.join(',') + ')', { payslip: '', code: '', tags: '', amount_minor: 0 }, bind);
    const by = {};
    for (const s of slips) by[s.id] = { id: s.id, kind: s.kind, pay_date: s.pay_date, period_start: s.period_start, period_end: s.period_end, by_tag: {}, by_code: {} };
    for (const l of ls) {
      const h = by[l.payslip];
      const amt = L('lib_money').toMajor(l.amount_minor, cur);
      h.by_code[l.code] = round12((h.by_code[l.code] || 0) + amt);
      let tags = [];
      try {
        tags = JSON.parse(l.tags || '[]') || [];
      } catch (e) {
        tags = [];
      }
      for (const t of tags) h.by_tag[t] = round12((h.by_tag[t] || 0) + amt);
    }
    for (const s of slips) rows.push(by[s.id]);
  }
  let hasOpening = false;
  const openingDays = [];
  for (const o of util.findMany(app, 'ytd_openings', 'employment = {:e} && day <= {:t}', 'day', 0, { e: employmentId, t: run.pay_date })) {
    if (o.getString('currency') !== '' && o.getString('currency') !== cur) continue;
    hasOpening = true;
    openingDays.push(o.getString('day'));
    if (o.getString('day') < from) continue;
    rows.unshift({ id: 'opening-' + o.id, kind: 'opening', pay_date: o.getString('day'), period_start: o.getString('day'), period_end: o.getString('day'), by_tag: util.jsonOf(o, 'by_tag', {}) || {}, by_code: util.jsonOf(o, 'by_code', {}) || {} });
  }
  return { rows: rows, hasOpening: hasOpening, openingDays: openingDays, later: later };
}

function round12(x) {
  return Math.round(x * 1e6) / 1e6;
}

/* ---------------------------------------------------------- the output */

/** The engine output in minor units: lines, totals, and the line explanations merged with ours. */
function convert(out, built, cur) {
  const lines = [];
  const nIn = built.input.lines.length;
  for (let i = 0; i < out.lines.length; i++) {
    const l = out.lines[i];
    const isInput = l.source === 'input' && i < nIn;
    lines.push({
      code: l.code,
      name: l.name,
      kind: l.kind,
      stage: l.stage || '',
      amount_minor: minor(l.amount, cur),
      qty: typeof l.qty === 'number' ? l.qty : 0,
      rate: typeof l.rate === 'number' ? l.rate : 0,
      base_minor: typeof l.base === 'number' ? minor(l.base, cur) : 0,
      pack: l.pack || '',
      pack_version: l.pack_version || '',
      step: typeof l.step === 'number' ? l.step : -1,
      phase: l.phase || '',
      source: l.source === 'input' ? 'input' : 'pack',
      explain: isInput ? Object.assign({}, built.explains[i] || {}) : l.explain || {},
      tags: l.tags || [],
      component: l.component || '',
      ref: isInput ? built.refs[i].ref : l.ref || '',
      ref_kind: isInput ? built.refs[i].ref_kind : '',
      payee: l.payee || '',
      filing: l.filing || '',
      sort: typeof l.sort === 'number' ? l.sort : i,
    });
  }
  return lines;
}

function totalsOf(lines) {
  const t = { gross: 0, pre: 0, statutory: 0, post: 0, deductions: 0, employer: 0, reimbursement: 0, net: 0 };
  for (const l of lines) {
    const a = l.amount_minor;
    if (l.kind === 'earning') t.gross += a;
    else if (l.kind === 'deduction') {
      if (l.stage === 'pre') t.pre += a;
      else if (l.stage === 'statutory') t.statutory += a;
      else t.post += a;
      t.deductions += a;
    } else if (l.kind === 'employer') t.employer += a;
    else if (l.kind === 'reimbursement') t.reimbursement += a;
  }
  t.net = t.gross - t.deductions + t.reimbursement;
  return t;
}

/** The rounding line that brings net to the entity's net rounding step, or null. */
function roundingLine(rc, net) {
  const step = rc.settings.net_rounding;
  if (!step || step === 'none') return null;
  const stepMinor = L('lib_money').majorToMinor(Number(step), rc.currency);
  if (stepMinor <= 1) return null;
  const rounded = Math.floor(net / stepMinor) * stepMinor;
  const diff = net - rounded;
  if (diff === 0) return null;
  const c = rc.comps.byRole.rounding;
  return { code: c ? c.code : 'NET_ROUNDING', name: c ? c.name : 'Rounding', kind: 'deduction', stage: 'post', amount_minor: diff, qty: 0, rate: 0, base_minor: 0, pack: '', pack_version: '', step: -1, phase: '', source: 'input', explain: { source: 'rounding', step: step, note: 'Net pay rounded down to a multiple of ' + step + '.' }, tags: [], component: c ? c.id : '', ref: '', ref_kind: '', payee: '', filing: '', sort: 99999 };
}

/** Pay method and bank split for an employee; issues for a missing or changed account. */
function payoutOf(app, rc, built, issues) {
  const util = u();
  const extra = { employment: built.employment.id, number: built.employee.number, entity: rc.entId };
  const method = rc.settings.pay_method;
  const accts = util.findMany(app, 'bank_accounts', "employee = {:e} && status = 'active'", 'sort,created', 0, { e: built.employee.id });
  const split = accts.map((a) => ({ bank_account: a.id, label: a.getString('label'), bank_name: a.getString('bank_name'), number_masked: a.getString('number_masked'), currency: a.getString('currency'), split: util.jsonOf(a, 'split', { kind: 'rest' }) || { kind: 'rest' }, approved_at: a.getString('approved_at') }));
  if (method === 'bank') {
    if (split.length === 0) issues.push(issue('blocker', 'bank_missing', 'No approved bank account to pay into.', extra));
    for (const s of split) {
      if (s.currency !== '' && s.currency !== rc.currency) issues.push(issue('blocker', 'bank_currency_mismatch', 'The bank account ' + s.number_masked + ' is in ' + s.currency + ', but pay is in ' + rc.currency + '.', extra));
      if (s.approved_at !== '' && rc.settings.bank_changed_days > 0) {
        const approved = s.approved_at.slice(0, 10);
        if (util.daysBetween(approved, rc.run.pay_date) <= rc.settings.bank_changed_days && approved <= rc.run.pay_date) issues.push(issue('warning', 'bank_changed_recently', 'The bank account ' + s.number_masked + ' was approved on ' + approved + ', within ' + rc.settings.bank_changed_days + ' days of pay day. Check it with the person on a number already on file.', extra));
      }
    }
  }
  return { method: method, split: split };
}

/** The previous regular locked payslip of the employment before this pay date (not this run). */
function prevRegular(app, employmentId, payDate, runId) {
  const util = u();
  const r = util.findMany(app, 'payslips', "employment = {:e} && kind = 'regular' && (status = 'locked' || status = 'published') && pay_date < {:d} && payrun != {:r}", '-pay_date,-created', 1, { e: employmentId, d: payDate, r: runId });
  return r.length > 0 ? r[0] : null;
}

/** Variance against the previous regular payslip, with the reasons we can tell from the data. */
function varianceOf(app, rc, built, lines, totals, issues) {
  const util = u();
  const extra = { employment: built.employment.id, number: built.employee.number, entity: rc.entId };
  const prev = rc.run.kind === 'regular' ? prevRegular(app, built.employment.id, rc.run.pay_date, rc.run.id) : null;
  const reasons = [];
  if (prev === null) {
    if (rc.run.kind === 'regular') reasons.push(built.employment.getString('start_day') >= rc.run.period_start ? 'new_joiner' : 'first_run');
    return { prev_payslip: '', prev_net_minor: 0, prev_gross_minor: 0, delta_net_minor: totals.net, delta_gross_minor: totals.gross, pct: null, reasons: reasons };
  }
  const pn = prev.getInt('net_minor');
  const pg = prev.getInt('gross_minor');
  const prevLines = util.rows(app, 'SELECT code, kind, amount_minor, ref_kind FROM payslip_lines WHERE payslip = {:p}', { code: '', kind: '', amount_minor: 0, ref_kind: '' }, { p: prev.id });
  const sumBy = (ls, pred) => ls.filter(pred).reduce((a, l) => a + l.amount_minor, 0);
  const roleOf = (code) => (rc.comps.byCode[code] ? rc.comps.byCode[code].role : '');
  const meta = built.meta;
  if (built.employment.getString('start_day') > prev.getString('period_end') && built.employment.getString('start_day') >= rc.run.period_start) reasons.push('new_joiner');
  if (!meta.full_period) {
    if (built.employment.getString('start_day') > rc.run.period_start) reasons.push('joiner_proration');
    if (built.employment.getString('end_day') !== '' && built.employment.getString('end_day') < rc.run.period_end) reasons.push('leaver');
  }
  const changed = util.count(app, 'SELECT COUNT(*) AS n FROM pay_records WHERE employment = {:e} AND effective_from > {:a} AND effective_from <= {:b}', { e: built.employment.id, a: prev.getString('period_end'), b: rc.run.period_end });
  const baseRole = (l) => ['basic', 'hourly', 'daily'].indexOf(roleOf(l.code)) >= 0;
  const prevFull = (util.jsonOf(prev, 'proration', {}) || {}).full_period !== false;
  if (changed > 0 || (meta.full_period && prevFull && sumBy(lines, baseRole) !== sumBy(prevLines, baseRole))) reasons.push('raise');
  const otNow = sumBy(lines, (l) => roleOf(l.code) === 'overtime');
  const otPrev = sumBy(prevLines, (l) => roleOf(l.code) === 'overtime');
  if (otNow !== otPrev) reasons.push('overtime');
  if (sumBy(lines, (l) => roleOf(l.code) === 'unpaid') !== sumBy(prevLines, (l) => roleOf(l.code) === 'unpaid')) reasons.push('unpaid_leave');
  const bon = (ls) => sumBy(ls, (l) => ['bonus', 'commission', 'arrears'].indexOf(roleOf(l.code)) >= 0);
  if (bon(lines) !== bon(prevLines)) reasons.push('bonus');
  if (sumBy(lines, (l) => l.kind === 'reimbursement') !== sumBy(prevLines, (l) => l.kind === 'reimbursement')) reasons.push('reimbursement');
  const taxChanged = util.count(app, 'SELECT COUNT(*) AS n FROM tax_profiles WHERE employment = {:e} AND effective_from > {:a} AND effective_from <= {:b}', { e: built.employment.id, a: prev.getString('pay_date'), b: rc.run.pay_date });
  if (taxChanged > 0) reasons.push('tax_profile');
  const pv = (util.jsonOf(prev, 'packs', []) || []).map((x) => x.code + '@' + x.version).sort().join(',');
  const nv = built.packs.map((x) => x.code + '@' + x.version).sort().join(',');
  if (pv !== nv) reasons.push('pack_version');
  const delta = totals.net - pn;
  const pct = pn !== 0 ? Math.round((delta / Math.abs(pn)) * 10000) / 100 : null;
  if (pct !== null && Math.abs(pct) > rc.settings.variance_pct && rc.run.kind === 'regular') {
    issues.push(issue('warning', 'variance_over_threshold', 'Net pay changed by ' + pct + '% against the last regular payslip (' + prev.getString('pay_date') + ').' + (reasons.length > 0 ? ' Seen: ' + reasons.join(', ').replace(/_/g, ' ') + '.' : ''), Object.assign({ pct: pct, day: prev.getString('pay_date'), reasons: reasons }, extra)));
  }
  if (reasons.length === 0 && delta !== 0) reasons.push('other');
  return { prev_payslip: prev.id, prev_net_minor: pn, prev_gross_minor: pg, delta_net_minor: delta, delta_gross_minor: totals.gross - pg, pct: pct, reasons: reasons };
}

/**
 * Warnings for employer fields a pack actually read with no value (nobody
 * set them and they have no default), for example a missing SUI rate or
 * wage base: the engine's explanation lists every name a step read.
 */
function entityFieldWarnings(rc, packs, out, issues) {
  const missing = {};
  const scan = (reads) => {
    for (const r of reads || []) if (typeof r.name === 'string' && r.name.indexOf('entity.') === 0 && (r.value === null || r.value === undefined)) missing[r.name.slice(7)] = true;
  };
  for (const l of out.lines || []) if (l.explain) scan(l.explain.reads);
  const vars = (out.explain && out.explain.vars) || {};
  for (const pc of Object.keys(vars)) for (const vn of Object.keys(vars[pc] || {})) scan(vars[pc][vn].reads);
  for (const i of out.issues || []) scan(i.reads);
  for (const p of packs) {
    for (const f of p.profile_fields || []) {
      if (f.scope !== 'entity' || !missing[f.key]) continue;
      issues.push(issue('warning', 'entity_field_missing', (f.label || f.key) + ' is not set for ' + rc.ent.getString('name') + ' (pack ' + p.code + '): the lines that need it stay at zero until it is.', { pack: p.code, field: f.key, entity: rc.entId }));
      missing[f.key] = false;
    }
  }
}

/** The fiscal year to date by code, in minor units, from locked payslips plus this one. */
function ytdOf(app, rc, employmentId, lines) {
  const util = u();
  const rows = util.rows(
    app,
    "SELECT l.code AS code, CAST(COALESCE(SUM(l.amount_minor), 0) AS INTEGER) AS amt FROM payslip_lines l JOIN payslips s ON s.id = l.payslip JOIN payruns r ON r.id = s.payrun WHERE s.employment = {:e} AND s.status IN ('locked', 'published') AND r.status IN ('locked', 'paid') AND s.currency = {:c} AND s.pay_date >= {:f} AND s.pay_date <= {:t} AND s.payrun != {:r} GROUP BY l.code",
    { code: '', amt: 0 },
    { e: employmentId, c: rc.currency, f: rc.fyStart, t: rc.run.pay_date, r: rc.run.id },
  );
  const by = {};
  for (const r of rows) by[r.code] = r.amt;
  for (const l of lines) by[l.code] = (by[l.code] || 0) + l.amount_minor;
  const tot = util.one(
    app,
    "SELECT CAST(COALESCE(SUM(s.gross_minor), 0) AS INTEGER) AS gross, CAST(COALESCE(SUM(s.net_minor), 0) AS INTEGER) AS net, CAST(COALESCE(SUM(s.deductions_minor), 0) AS INTEGER) AS ded, CAST(COALESCE(SUM(s.employer_minor), 0) AS INTEGER) AS er FROM payslips s JOIN payruns r ON r.id = s.payrun WHERE s.employment = {:e} AND s.status IN ('locked', 'published') AND r.status IN ('locked', 'paid') AND s.currency = {:c} AND s.pay_date >= {:f} AND s.pay_date <= {:t} AND s.payrun != {:r}",
    { gross: 0, net: 0, ded: 0, er: 0 },
    { e: employmentId, c: rc.currency, f: rc.fyStart, t: rc.run.pay_date, r: rc.run.id },
  );
  const t = totalsOf(lines);
  return { from: rc.fyStart, to: rc.run.pay_date, by_code: by, gross_minor: (tot ? tot.gross : 0) + t.gross, net_minor: (tot ? tot.net : 0) + t.net, deductions_minor: (tot ? tot.ded : 0) + t.deductions, employer_minor: (tot ? tot.er : 0) + t.employer };
}

/* ----------------------------------------------------------- calculate */

/**
 * Calculate one employment of a run and store its payslip and lines
 * (replacing a draft one). Returns { payslip, blockers, warnings } or null
 * when the employment is outside the period.
 */
function calcOne(app, rc, employmentId) {
  const util = u();
  const engine = L('lib_engine');
  const started = Date.now();
  const corrOf = rc.run.kind === 'correction' ? originalPayslip(app, rc, employmentId) : null;
  if (rc.run.kind === 'correction' && corrOf === null) return null;
  const built = buildInput(app, rc, employmentId, corrOf ? { correction: corrOf } : 'run');
  if (built === null) return null;
  // Off-cycle, bonus and reimbursement runs pay only people with something to pay.
  if (['off_cycle', 'bonus', 'reimbursement'].indexOf(rc.run.kind) >= 0 && built.input.lines.length === 0) return null;
  const cur = rc.currency;
  const issues = built.issues.slice();
  // The engine (pure): every pack in force, and blockers for the ones that are not.
  const out = engine.calculate(built.input, built.packs);
  for (const i of out.issues) {
    if (i.code === 'zero_gross' && rc.run.kind === 'correction') continue;
    // Pay before HR OS: one plain blocker instead of each pack's own (history_short, MY's year history).
    if (built.opening !== null && (i.code === 'history_short' || OPENING_CODES[i.code] === true || (i.code === 'step_error' && i.error === 'history_short'))) continue;
    issues.push(Object.assign({}, i, { employment: employmentId, number: built.employee.number, entity: rc.entId }));
  }
  if (built.opening !== null) {
    const o = built.opening;
    issues.push(issue('blocker', 'opening_balances_missing', 'Employed before HR OS this tax year (from ' + o.tax_year_start + '): add what was paid so far as opening balances, or confirm that nobody was paid earlier this tax year.', { employment: employmentId, number: built.employee.number, entity: rc.entId, payrun: rc.run.id, from: o.from, day: o.tax_year_start, packs: o.packs }));
  }
  entityFieldWarnings(rc, built.packs, out, issues);
  let lines = convert(out, built, cur);
  let explain = { engine: out.engine, packs: out.explain.packs, vars: out.explain.vars, meta: built.meta };
  if (corrOf) {
    const diff = correctionLines(app, rc, corrOf, lines);
    explain = Object.assign(explain, { corrects: corrOf.id, corrected_totals: totalsOf(lines) });
    lines = diff;
  }
  const t0 = totalsOf(lines);
  const rl = rc.run.kind === 'correction' ? null : roundingLine(rc, t0.net);
  if (rl !== null) lines.push(rl);
  const totals = totalsOf(lines);
  const payout = payoutOf(app, rc, built, issues);
  const variance = varianceOf(app, rc, built, lines, totals, issues);
  // Another regular run of the same period already pays this person.
  if (rc.run.kind === 'regular' && rc.sched) {
    const dup = util.one(app, "SELECT r.number AS number FROM payslips s JOIN payruns r ON r.id = s.payrun WHERE s.employment = {:e} AND r.kind = 'regular' AND r.status != 'void' AND r.id != {:r} AND r.schedule = {:s} AND r.period_start = {:p} LIMIT 1", { number: '' }, { e: employmentId, r: rc.run.id, s: rc.sched.id, p: rc.run.period_start });
    if (dup !== null) issues.push(issue('blocker', 'duplicate_regular_slip', 'Already in the regular run ' + dup.number + ' for this period. Use a correction run.', { employment: employmentId, number: built.employee.number, run_number: dup.number }));
  }
  // A leaver with a loan balance left after this run.
  if (rc.run.kind === 'regular' && built.employment.getString('end_day') !== '' && built.employment.getString('end_day') <= rc.run.period_end) {
    const left = util.count(app, "SELECT COUNT(*) AS n FROM loans WHERE employment = {:e} AND status = 'active' AND balance_minor > 0", { e: employmentId });
    if (left > 0) issues.push(issue('warning', 'leaver_pending', 'Leaves in this period with a loan balance: settle it in a final pay run.', { employment: employmentId, number: built.employee.number }));
  }
  const ytd = ytdOf(app, rc, employmentId, lines);
  const inputHash = util.sha(engine.stableStringify(built.input));
  let slip = util.findOne(app, 'payslips', 'payrun = {:r} && employment = {:e}', { r: rc.run.id, e: employmentId });
  if (slip !== null && slip.getString('status') !== 'draft' && slip.getString('status') !== 'calculated') throw util.fail(409, 'This payslip is ' + slip.getString('status') + ' and cannot change.', 'locked');
  if (slip === null) {
    slip = util.newRecord(app, 'payslips');
    slip.set('payrun', rc.run.id);
    slip.set('employment', employmentId);
    slip.set('employee', built.employee.id);
    slip.set('entity', rc.entId);
    slip.set('held', false);
  }
  const enriched = plainIssues(built, issues).map((i) => Object.assign({}, i, { fix: fixFor(i.code, Object.assign({ payrun: rc.run.id, pack: i.pack }, i)) }));
  slip.set('kind', rc.run.kind);
  slip.set('period_start', rc.run.period_start);
  slip.set('period_end', rc.run.period_end);
  slip.set('pay_date', rc.run.pay_date);
  slip.set('currency', cur);
  slip.set('gross_minor', totals.gross);
  slip.set('pre_minor', totals.pre);
  slip.set('statutory_minor', totals.statutory);
  slip.set('post_minor', totals.post);
  slip.set('deductions_minor', totals.deductions);
  slip.set('employer_minor', totals.employer);
  slip.set('reimbursement_minor', totals.reimbursement);
  slip.set('net_minor', totals.net);
  slip.set('ytd', ytd);
  slip.set('status', 'calculated');
  slip.set('hash', out.hash);
  slip.set('input_hash', inputHash);
  slip.set('issues', enriched);
  slip.set('explain', explain);
  slip.set('input', built.input);
  slip.set('packs', built.packs.map((p) => ({ code: p.code, version: p.version, name: p.name })));
  slip.set('proration', built.meta);
  slip.set('variance', variance);
  slip.set('pay_method', payout.method);
  slip.set('bank_split', payout.split);
  slip.set('calc_ms', Date.now() - started);
  app.save(slip);
  util.exec(app, 'DELETE FROM payslip_lines WHERE payslip = {:p}', { p: slip.id });
  L('lib_bus').touch('payslip_lines');
  for (const l of lines) {
    const r = util.newRecord(app, 'payslip_lines');
    r.set('payslip', slip.id);
    r.set('payrun', rc.run.id);
    r.set('employment', employmentId);
    r.set('code', l.code);
    r.set('name', util.clip(l.name, 200));
    r.set('kind', l.kind);
    r.set('stage', l.kind === 'deduction' ? l.stage || 'post' : '');
    r.set('amount_minor', l.amount_minor);
    r.set('qty', l.qty);
    r.set('rate', l.rate);
    r.set('base_minor', l.base_minor);
    r.set('pack', l.pack);
    r.set('pack_version', l.pack_version);
    r.set('step', l.step);
    r.set('phase', l.phase);
    r.set('source', l.source);
    r.set('explain', l.explain);
    r.set('tags', l.tags);
    r.set('component', l.component);
    r.set('ref', util.clip(l.ref || '', 60));
    r.set('ref_kind', l.ref_kind || '');
    r.set('payee', util.clip(l.payee || '', 80));
    r.set('filing', util.clip(l.filing || '', 60));
    r.set('payslip_group', rc.comps.byCode[l.code] ? rc.comps.byCode[l.code].payslip_group : '');
    r.set('sort', Math.round(l.sort));
    app.save(r);
  }
  const blockers = enriched.filter((i) => i.severity === 'blocker').length;
  return { payslip: slip.id, blockers: blockers, warnings: enriched.length - blockers, totals: totals };
}

/** Expression functions that read a person value they do not name (lib_expr: age_on uses the birth date). */
const FN_READS = { age_on: ['employee', 'birth_date'] };

/** What the person record calls the employee values packs read. */
const EMPLOYEE_LABELS = { birth_date: 'birth date', hire_day: 'start day', end_day: 'last day', nationality: 'nationality', gender: 'gender', age: 'birth date', years_of_service: 'start day' };
/** The person record field behind an employee value a pack reads (age comes from the birth date). */
const EMPLOYEE_FIELD = { age: 'birth_date', years_of_service: 'hire_day' };

/**
 * People read issues, not engine output. Each issue gets its pack's name and
 * its field's label; an engine step error becomes `data_missing` when the
 * failing formula reads a person, tax profile or employer value that is empty
 * (what to add and where), else `pack_error`. The engine's own text stays in
 * `detail` for support. The formula's names come from the expression's syntax
 * tree (lib_expr.refsOf), never from the error text.
 */
function plainIssues(built, issues) {
  const X = L('lib_expr');
  const packs = {};
  for (const p of built.packs) packs[p.code] = p;
  const fieldOf = (scope, key) => {
    for (const p of built.packs) for (const f of p.profile_fields || []) if (f.key === key && (f.scope || 'employee') === scope) return f;
    return null;
  };
  const valueOf = (root, key) => (root === 'employee' ? built.input.employee : root === 'profile' ? built.input.profile : root === 'entity' ? built.input.entity : null);
  return issues.map((i) => {
    const o = Object.assign({}, i);
    const p = i.pack ? packs[i.pack] : null;
    if (p) o.pack_name = p.name || p.code;
    if (i.code !== 'step_error' && i.field && typeof i.field === 'string') {
      const f = fieldOf(i.code.indexOf('entity') === 0 ? 'entity' : 'employee', i.field) || fieldOf('entity', i.field);
      if (f) o.field_label = f.label || f.key;
    }
    if (i.code !== 'step_error' || !p) return o;
    const list = i.phase === 'year_end_steps' ? p.year_end_steps : p.steps;
    const step = (list || [])[i.step] || {};
    const src = typeof step[i.field] === 'string' ? step[i.field] : '';
    let names = [];
    try {
      const refs = src !== '' ? X.refsOf(X.compile(src).tree) : { names: [], calls: [] };
      // Functions that read a person value without naming it (age_on reads the birth date).
      names = refs.calls.filter((c) => FN_READS[c.fn] !== undefined).map((c) => ({ path: FN_READS[c.fn] })).concat(refs.names);
    } catch (e) {
      names = [];
    }
    let gap = null;
    for (const n of names) {
      const root = n.path[0];
      const key = n.path[1];
      const vals = key ? valueOf(root, key) : null;
      if (vals === null) continue;
      const v = vals[key];
      const def = root === 'employee' ? null : fieldOf(root === 'profile' ? 'employee' : 'entity', key);
      if ((v === null || v === undefined || v === '') && !(def && def.default !== undefined && def.default !== null)) {
        gap = { scope: root, key: key, label: root === 'employee' ? EMPLOYEE_LABELS[key] || key.replace(/_/g, ' ') : def ? def.label || key : key };
        break;
      }
    }
    o.detail = i.message;
    o.step_name = i.name;
    if (gap !== null) {
      o.code = 'data_missing';
      o.scope = gap.scope;
      o.field = gap.scope === 'employee' ? EMPLOYEE_FIELD[gap.key] || gap.key : gap.key;
      o.field_label = gap.label;
      // Payroll may fill the personal fields packs need itself (payroll.person-set); the rest goes to HR.
      if (gap.scope === 'employee') o.payroll_may_set = L('lib_payroll_tax').PERSON_FIELDS.indexOf(o.field) >= 0;
      o.message = 'Add the ' + gap.label + ': ' + o.pack_name + ' needs it to work out pay.';
    } else {
      o.code = 'pack_error';
      o.message = o.pack_name + ' could not work out this payslip (' + String(i.name || 'a step').replace(/_/g, ' ') + '). Ask your AI agent to check the pack.';
    }
    return o;
  });
}

/** The locked payslip of the corrected run for this employment, or null. */
function originalPayslip(app, rc, employmentId) {
  if (!rc.run.corrects) return null;
  return u().findOne(app, 'payslips', "payrun = {:r} && employment = {:e} && (status = 'locked' || status = 'published')", { r: rc.run.corrects, e: employmentId });
}

/**
 * Difference lines: what the original payslip should have been (`target`
 * lines, recomputed) minus what was already paid (the original and every
 * earlier correction of it), by code. Zero differences are left out.
 */
function correctionLines(app, rc, orig, target) {
  const util = u();
  const paid = util.rows(
    app,
    "SELECT l.code AS code, l.name AS name, l.kind AS kind, l.stage AS stage, l.tags AS tags, l.pack AS pack, l.pack_version AS pack_version, l.payee AS payee, l.filing AS filing, CAST(COALESCE(SUM(l.amount_minor), 0) AS INTEGER) AS amt FROM payslip_lines l JOIN payslips s ON s.id = l.payslip JOIN payruns r ON r.id = s.payrun WHERE s.employment = {:e} AND s.status IN ('locked', 'published') AND r.status IN ('locked', 'paid') AND (s.id = {:o} OR r.corrects = {:or}) GROUP BY l.code, l.kind, l.stage",
    { code: '', name: '', kind: '', stage: '', tags: '', pack: '', pack_version: '', payee: '', filing: '', amt: 0 },
    { e: orig.getString('employment'), o: orig.id, or: orig.getString('payrun') },
  );
  const key = (c, k, s) => c + '|' + k + '|' + (k === 'deduction' ? s || 'post' : '');
  const t = {};
  const order = [];
  for (const l of target) {
    const k = key(l.code, l.kind, l.stage);
    if (t[k] === undefined) {
      t[k] = Object.assign({}, l, { amount_minor: 0, explain: {} });
      order.push(k);
    }
    t[k].amount_minor += l.amount_minor;
  }
  const p = {};
  for (const r of paid) {
    const k = key(r.code, r.kind, r.stage);
    p[k] = r;
    if (t[k] === undefined) {
      let tags = [];
      try {
        tags = JSON.parse(r.tags || '[]') || [];
      } catch (e) {
        tags = [];
      }
      t[k] = { code: r.code, name: r.name, kind: r.kind, stage: r.stage, amount_minor: 0, qty: 0, rate: 0, base_minor: 0, pack: r.pack, pack_version: r.pack_version, step: -1, phase: '', source: r.pack !== '' ? 'pack' : 'input', explain: {}, tags: tags, component: '', ref: '', ref_kind: '', payee: r.payee, filing: r.filing, sort: 0 };
      order.push(k);
    }
  }
  const out = [];
  let i = 0;
  for (const k of order) {
    const was = p[k] ? p[k].amt : 0;
    const should = t[k].amount_minor;
    const d = should - was;
    i++;
    if (d === 0) continue;
    out.push(Object.assign({}, t[k], { amount_minor: d, sort: i, ref: orig.id, ref_kind: 'correction', explain: { source: 'correction', should_be_minor: should, paid_minor: was, original_payslip: orig.id, note: 'Difference: what the original payslip should have been minus what was paid.' } }));
  }
  return out;
}

/**
 * Recalculate a payslip from its stored input with the pack versions it
 * used, and compare the engine fingerprint (determinism and tamper check).
 */
function recompute(app, slip) {
  const util = u();
  const engine = L('lib_engine');
  const input = util.jsonOf(slip, 'input', null);
  const used = util.jsonOf(slip, 'packs', []) || [];
  const packs = [];
  for (const pv of used) {
    const r = util.findOne(app, 'rule_packs', 'code = {:c} && version = {:v}', { c: pv.code, v: pv.version });
    if (r !== null) packs.push(L('lib_payroll').packBody(r));
  }
  const out = engine.calculate(input, packs);
  const inputHash = util.sha(engine.stableStringify(input));
  return { engine_hash: out.hash, stored_hash: slip.getString('hash'), input_hash: inputHash, stored_input_hash: slip.getString('input_hash'), input_ok: inputHash === slip.getString('input_hash'), engine_ok: out.hash === slip.getString('hash') };
}

module.exports = {
  HISTORY_DAYS: HISTORY_DAYS,
  fixFor: fixFor,
  runContext: runContext,
  buildInput: buildInput,
  historyOf: historyOf,
  calcOne: calcOne,
  prefetch: prefetch,
  totalsOf: totalsOf,
  recompute: recompute,
  periodWorkingDays: periodWorkingDays,
  componentsOf: componentsOf,
};
