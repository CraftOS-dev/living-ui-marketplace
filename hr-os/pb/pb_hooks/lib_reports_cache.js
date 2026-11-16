/**
 * Report figures that cost a run of the time or leave engine for every
 * person (home-reports module): absence and overtime per person and month,
 * leave balances per person and type on a day. They are computed
 * company-wide once, kept in `report_cache` with a fingerprint of their
 * inputs, and filtered and added up by the reports at read time, so a report
 * at 300 people answers in well under two seconds.
 *
 * A closed month or a day's balances are used while their fingerprint (row
 * counts and last changes of every collection they read) matches; the month
 * still running is also used for up to 20 minutes after it was counted
 * (punches change it all day). `reports_warm` (every 10 minutes) counts the
 * current month and today's balances again when their inputs changed, so
 * people rarely wait. `fresh` on a report counts again at once.
 */
let _m = {};
function L(n) {
  if (_m[n] === undefined) _m[n] = require(`${__hooks}/${n}.js`);
  return _m[n];
}
const u = () => L('lib_util');
const R = () => L('lib_reports');

const OPEN_MAX_AGE_MS = 20 * 60 * 1000;

/* ------------------------------------------------------------ the cache */

function load(app, key) {
  return u().findOne(app, 'report_cache', 'key = {:k}', { k: key });
}

/**
 * The cached figures under `key`, or newly computed ones: { data, computed_at }.
 * Used as they are when the fingerprint matches, or (maxAgeMs > 0) when they
 * are younger than maxAgeMs.
 */
function cached(app, key, kind, period, fingerprint, maxAgeMs, compute, force) {
  const util = u();
  const rec = load(app, key);
  if (rec !== null && force !== true) {
    const same = rec.getString('fingerprint') === fingerprint;
    const age = Date.now() - Date.parse(rec.getString('computed_at'));
    if (same || (maxAgeMs > 0 && age >= 0 && age < maxAgeMs)) return { data: util.jsonOf(rec, 'data', {}) || {}, computed_at: rec.getString('computed_at'), fresh: same };
  }
  const t0 = Date.now();
  const data = compute();
  const r = rec !== null ? rec : util.newRecord(app, 'report_cache');
  r.set('key', key);
  r.set('kind', kind);
  r.set('period', period);
  r.set('fingerprint', fingerprint);
  r.set('data', data);
  r.set('rows', Object.keys(data).length);
  r.set('computed_at', new Date().toISOString());
  r.set('ms', Date.now() - t0);
  app.save(r);
  return { data: data, computed_at: r.getString('computed_at'), fresh: true };
}

/** "count:last change" of each query, joined: changes when any input row is added, changed or removed. */
function stamp(app, parts, bind) {
  const sql = 'SELECT ' + parts.map((p, i) => "(SELECT COUNT(*) || ':' || COALESCE(MAX(updated), '') FROM " + p + ') AS f' + i).join(', ');
  const shape = {};
  parts.forEach((_, i) => (shape['f' + i] = ''));
  const r = u().one(app, sql, shape, bind || {});
  return r === null ? '' : parts.map((_, i) => r['f' + i]).join('|');
}

/* -------------------------------------------------- absence per month */

/** Who was in work in a window and when they started and ended, as one short digest (the kernel's daily status refresh does not change it). */
function peopleDigest(app, from, to) {
  const rows = u().rows(app, "SELECT id, start_day, end_day FROM employments WHERE start_day <= {:b} AND (end_day = '' OR end_day >= {:a}) ORDER BY id", { id: '', start_day: '', end_day: '' }, { a: from, b: to });
  return rows.length + ':' + $security.sha256(rows.map((r) => r.id + r.start_day + r.end_day).join(','));
}

function absenceFingerprint(app, from, to) {
  return (
    to +
    '|' +
    peopleDigest(app, from, to) +
    '|' +
    stamp(
      app,
      [
        'attendance WHERE day >= {:a} AND day <= {:b}',
        'checkins WHERE day >= {:pa} AND day <= {:pb}',
        'leave_requests WHERE [[start]] <= {:b} AND [[end]] >= {:a}',
        'timesheets WHERE period_start <= {:b} AND period_end >= {:a}',
        'shift_assignments WHERE day >= {:a} AND day <= {:b}',
        "attendance_requests WHERE from_day <= {:b} AND (to_day = '' OR to_day >= {:a})",
        'overtime_requests WHERE day >= {:a} AND day <= {:b}',
        'job_records WHERE effective_from <= {:b}',
        'holidays WHERE day >= {:a} AND day <= {:b}',
        'overtime_rules',
        'work_schedules',
        'shift_types',
        'leave_types',
      ],
      { a: from, b: to, pa: u().dayAdd(from, -1), pb: u().dayAdd(to, 1) },
    )
  );
}

/**
 * Per person in work during a month (up to today): scheduled working days,
 * days absent, late minutes, overtime minutes and leave days by type, from
 * one lib_time.payInputsDetailMany read and the approved leave's day lists.
 * { [employment]: { s, a, l, o, v, t: { code: days } } }
 */
function computeAbsence(app, from, to) {
  const util = u();
  const r = R();
  const ids = util.rows(app, "SELECT id FROM employments WHERE start_day <= {:b} AND (end_day = '' OR end_day >= {:a})", { id: '' }, { a: from, b: to }).map((x) => x.id);
  const out = {};
  if (ids.length === 0) return out;
  const detail = L('lib_time').payInputsDetailMany(app, ids, from, to);
  for (const id of ids) {
    const row = { s: 0, a: 0, l: 0, o: 0, v: 0, t: {} };
    const ti = detail[id];
    for (const d of ti && ti.detail ? ti.detail.days || [] : []) {
      if (d.day < from || d.day > to) continue;
      if (d.kind === 'work') row.s += 1;
      row.a += d.status === 'absent' ? 1 : d.status === 'half_day' && d.kind === 'work' && !(d.leave > 0) ? 0.5 : 0;
      for (const part of d.parts || []) if (part.multiplier >= 1) row.o += part.minutes;
      row.l += d.late || 0;
    }
    out[id] = row;
  }
  const typeOf = {};
  for (const t of util.rows(app, 'SELECT id, code, unit FROM leave_types', { id: '', code: '', unit: '' })) typeOf[t.id] = t;
  for (let i = 0; i < ids.length; i += 400) {
    const bind = { a: from, b: to };
    const where = r.listWhere(ids.slice(i, i + 400), bind, 'employment', 'lv');
    for (const q of util.rows(app, "SELECT employment, type, COALESCE(unit, '') AS unit, day_list FROM leave_requests WHERE status IN ('approved', 'cancelling') AND [[start]] <= {:b} AND [[end]] >= {:a} AND " + where, { employment: '', type: '', unit: '', day_list: '' }, bind)) {
      const t = typeOf[q.type];
      const row = out[q.employment];
      if (t === undefined || row === undefined) continue;
      const hourUnit = (q.unit || t.unit) === 'hour';
      let list = [];
      try {
        list = JSON.parse(q.day_list || '[]') || [];
      } catch (e) {
        list = [];
      }
      for (const dd of Array.isArray(list) ? list : []) {
        if (!dd || dd.day < from || dd.day > to) continue;
        // Counted as the leave module's pay inputs count them: hour types by their day equivalent.
        const days = hourUnit ? Number(dd.days) || 0 : Number(dd.amount) || 0;
        row.v += days;
        row.t[t.code] = (row.t[t.code] || 0) + days;
      }
    }
  }
  return out;
}

/** The figures of one month: { from, to, rows, computed_at } (rows empty for a month that has not started). */
function absenceMonth(app, month, force) {
  const util = u();
  const r = R();
  const today = util.today(app);
  const from = r.monthStart(month);
  const end = r.monthEnd(month);
  const to = end > today ? today : end;
  if (from > to) return { from: from, to: to, rows: {}, computed_at: '' };
  const fp = absenceFingerprint(app, from, to);
  const c = cached(app, 'absence:' + month, 'absence_month', month, fp, end >= today ? OPEN_MAX_AGE_MS : 0, () => computeAbsence(app, from, to), force);
  return { from: from, to: to, rows: c.data, computed_at: c.computed_at };
}

/* ---------------------------------------------------- leave balances */

function balancesFingerprint(app, day) {
  return day + '|' + u().today(app) + '|' + peopleDigest(app, day, day) + '|' + stamp(app, ['leave_ledger', 'leave_requests', 'leave_policy_assignments', 'leave_policies', 'leave_types', 'leave_comp_offs', 'leave_encash_requests', 'job_records', 'work_schedules', 'holidays']);
}

/**
 * Every positive tracked balance of a paid leave type on a day, for everyone
 * in work that day, through one leave session (ledgers and assignments read
 * together): { [employment]: [{ t, c, n, u, x, b }] } (type id, code, name,
 * unit, paid out on leaving, balance).
 */
function computeBalances(app, day) {
  const r = R();
  const lv = L('lib_leave');
  const S = lv.session(app);
  const pop = r.population(app, { entities: [], departments: [], location: '' }, day);
  for (let i = 0; i < pop.length; i += 100) lv.preload(S, pop.slice(i, i + 100).map((x) => x.employment));
  const types = {};
  const out = {};
  for (const x of pop) {
    const emp = lv.employmentOf(S, x.employment);
    if (emp === null) continue;
    if (types[x.entity] === undefined) types[x.entity] = lv.typesFor(S, x.entity, false).filter((t) => t.getBool('paid'));
    const list = [];
    for (const tr of types[x.entity]) {
      const code = tr.getString('code');
      if (!lv.tracked(lv.ruleFor(S, emp, code, day))) continue;
      // The ledger walked up to the day (lib_leave.simulate, as the leave module's own balances): its balance then.
      const sim = lv.simulate(S, emp, tr, day, {});
      const bal = sim.tracked ? Number(sim.balance) || 0 : 0;
      if (!(bal > 0)) continue;
      list.push({ t: tr.id, c: code, n: tr.getString('name'), u: tr.getString('unit'), x: tr.getBool('payout_on_exit'), b: Math.round(bal * 100) / 100 });
    }
    if (list.length > 0) out[x.employment] = list;
  }
  return out;
}

function balancesOn(app, day, force) {
  const c = cached(app, 'balances:' + day, 'leave_balances', day, balancesFingerprint(app, day), 0, () => computeBalances(app, day), force);
  return { day: day, rows: c.data, computed_at: c.computed_at };
}

/* ------------------------------------------------------------ warm-up */

/** Cron: count the current month (and in its first days the month before) and today's balances again when their inputs changed; drop old balance days. */
function warm(app) {
  const util = u();
  const today = util.today(app);
  const errors = [];
  const run = (what, fn) => {
    try {
      fn();
    } catch (err) {
      console.error('[hr] reports warm-up (' + what + ') failed:', err);
      errors.push(what + ': ' + String((err && err.message) || err));
    }
  };
  run('absence ' + today.slice(0, 7), () => absenceMonth(app, today.slice(0, 7), false));
  if (Number(today.slice(8, 10)) <= 5) run('absence last month', () => absenceMonth(app, util.addMonths(today.slice(0, 7) + '-01', -1).slice(0, 7), false));
  run('balances ' + today, () => balancesOn(app, today, false));
  run('prune', () => {
    for (const rec of util.findMany(app, 'report_cache', "kind = 'leave_balances' && period < {:d}", '', 200, { d: util.dayAdd(today, -14) })) app.delete(rec);
  });
  if (errors.length > 0) throw new Error(errors.join('; '));
  return { ok: true };
}

module.exports = { cached: cached, absenceMonth: absenceMonth, computeAbsence: computeAbsence, balancesOn: balancesOn, computeBalances: computeBalances, warm: warm, OPEN_MAX_AGE_MS: OPEN_MAX_AGE_MS };
