/// <reference path="../pb_data/types.d.ts" />
/**
 * SCRATCH ONLY (time builder's copy; never shipped): op wrappers so tests can
 * call what other modules and the kernel call (payroll's lockDays, cron jobs).
 */
function lockDays(ctx, p) {
  const u = require(`${__hooks}/lib_util.js`);
  const m = require(`${__hooks}/lib_people.js`).employmentRef(ctx.app, u.req(p, 'employment'));
  let out = null;
  ctx.app.runInTransaction((tx) => {
    out = require(`${__hooks}/lib_time.js`).lockDays(tx, m.id, u.req(p, 'from'), u.req(p, 'to'), u.req(p, 'payrun'));
  });
  return out;
}
function unlockDays(ctx, p) {
  const u = require(`${__hooks}/lib_util.js`);
  return require(`${__hooks}/lib_time.js`).unlockDays(ctx.app, u.req(p, 'payrun'));
}
function payInputs(ctx, p) {
  const u = require(`${__hooks}/lib_util.js`);
  const m = require(`${__hooks}/lib_people.js`).employmentRef(ctx.app, u.req(p, 'employment'));
  return require(`${__hooks}/lib_time.js`).payInputs(ctx.app, m.id, u.req(p, 'from'), u.req(p, 'to'));
}
function cron(ctx, p) {
  const u = require(`${__hooks}/lib_util.js`);
  const which = u.str(p, 'job', 'auto');
  if (which === 'auto') return { n: require(`${__hooks}/lib_time.js`).cronAuto(ctx.app) };
  return { n: require(`${__hooks}/lib_time_sheet.js`).cronReview(ctx.app) };
}
function facts(ctx, p) {
  const u = require(`${__hooks}/lib_util.js`);
  const m = require(`${__hooks}/lib_people.js`).employmentRef(ctx.app, u.req(p, 'employment'));
  return { facts: require(`${__hooks}/lib_time.js`).profileFacts(ctx, m.id) };
}
/**
 * Time payInputs over a period, server side, and prove the answers match:
 *   timing over the active employments: the old lib_time (before the speed
 *   work), the new payInputs one by one, and payInputsMany;
 *   equality over every employment of the seed (active or not): old
 *   payInputsDetail = new payInputsDetail (detail included), and new
 *   payInputs = payInputsMany.
 */
function payBench(ctx, p) {
  const u = require(`${__hooks}/lib_util.js`);
  const t = require(`${__hooks}/lib_time.js`);
  const old = require(`${__hooks}/lib_zstub_time_old.js`);
  const from = u.req(p, 'from');
  const to = u.req(p, 'to');
  const skipOld = u.str(p, 'skip_old', '') === 'true';
  const app = ctx.app;
  const safe = (f) => {
    try {
      return f();
    } catch (err) {
      return { error: String(err && err.status ? err.status : '') + ' ' + String(err && err.message ? err.message : err) };
    }
  };
  const active = require(`${__hooks}/lib_people.js`).activeEmployments(app, { from: from, to: to }).map((m) => m.id);
  const everyone = u.findMany(app, 'employments', '', 'created').map((r) => r.id);
  const per = (ms, n) => Math.round((ms / Math.max(1, n)) * 10) / 10;
  let oldMs = null;
  if (!skipOld) {
    const a = Date.now();
    for (const id of active) old.payInputs(app, id, from, to);
    oldMs = Date.now() - a;
  }
  // Best and median of 5 timed rounds each (the machine is shared).
  const oneTimes = [];
  const manyTimes = [];
  const dOneTimes = [];
  const dManyTimes = [];
  let one = {};
  let many = null;
  for (let rep = 0; rep < 5; rep++) {
    const a0 = Date.now();
    one = {};
    for (const id of active) one[id] = t.payInputs(app, id, from, to);
    const a1 = Date.now();
    many = t.payInputsMany(app, active, from, to);
    const a2 = Date.now();
    for (const id of active) t.payInputsDetail(app, id, from, to);
    const a3 = Date.now();
    t.payInputsDetailMany(app, active, from, to);
    const a4 = Date.now();
    oneTimes.push(a1 - a0);
    manyTimes.push(a2 - a1);
    dOneTimes.push(a3 - a2);
    dManyTimes.push(a4 - a3);
  }
  oneTimes.sort((x, y) => x - y);
  manyTimes.sort((x, y) => x - y);
  dOneTimes.sort((x, y) => x - y);
  dManyTimes.sort((x, y) => x - y);
  // Equality over the whole seed.
  const mism = [];
  let compared = 0;
  const manyAll = safe(() => t.payInputsMany(app, everyone, from, to));
  const detailAll = safe(() => t.payInputsDetailMany(app, everyone, from, to));
  for (const id of everyone) {
    compared++;
    const a0 = safe(() => old.payInputsDetail(app, id, from, to));
    // Since the old code: an adjustments list (punches after a lock; none on the seed) and issue
    // messages without written dates (the days travel as fields). Numbers and issue codes compare as they are.
    const strip = (x) => {
      if (x === null || typeof x !== 'object' || x.error !== undefined) return x;
      const y = Object.assign({}, x);
      if (Array.isArray(y.adjustments) && y.adjustments.length === 0) delete y.adjustments;
      if (Array.isArray(y.issues)) y.issues = y.issues.map((i) => ({ code: i.code, severity: i.severity }));
      return y;
    };
    const a = JSON.stringify(strip(a0));
    const b = JSON.stringify(strip(safe(() => t.payInputsDetail(app, id, from, to))));
    const c = JSON.stringify(safe(() => t.payInputs(app, id, from, to)));
    const d = JSON.stringify(manyAll.error ? manyAll : manyAll[id]);
    if (!skipOld && a !== b) mism.push({ id: id, what: 'old detail vs new detail', old: a.slice(0, 1500), now: b.slice(0, 1500) });
    if (c !== d) mism.push({ id: id, what: 'payInputs vs payInputsMany', one: c.slice(0, 800), many: d.slice(0, 800) });
    const e2 = JSON.stringify(strip(detailAll.error ? detailAll : detailAll[id]));
    if (b !== e2) mism.push({ id: id, what: 'payInputsDetail vs payInputsDetailMany', one: b.slice(0, 800), many: e2.slice(0, 800) });
  }
  for (const id of active) if (JSON.stringify(one[id]) !== JSON.stringify(many[id])) mism.push({ id: id, what: 'timed one vs many' });
  return {
    n: active.length,
    old_ms: oldMs,
    old_per_employee_ms: oldMs === null ? null : per(oldMs, active.length),
    one_ms: oneTimes[0],
    per_employee_ms: per(oneTimes[0], active.length),
    per_employee_median_ms: per(oneTimes[2], active.length),
    many_ms: manyTimes[0],
    many_per_employee_ms: per(manyTimes[0], active.length),
    many_per_employee_median_ms: per(manyTimes[2], active.length),
    detail_per_employee_ms: per(dOneTimes[0], active.length),
    detail_many_per_employee_ms: per(dManyTimes[0], active.length),
    compared: compared,
    same: mism.length === 0,
    mismatches: mism.slice(0, 4),
    sample: one[active[0]],
  };
}

/** Where payInputs time goes (scratch profiling). */
function payProfile(ctx, p) {
  const u = require(`${__hooks}/lib_util.js`);
  const t = require(`${__hooks}/lib_time.js`);
  const rules = require(`${__hooks}/lib_time_rules.js`);
  const from = u.req(p, 'from');
  const to = u.req(p, 'to');
  const reps = u.int(p, 'reps', 3);
  const app = ctx.app;
  const active = require(`${__hooks}/lib_people.js`).activeEmployments(app, { from: from, to: to }).map((m) => m.id);
  const best = {};
  const keep = (k, v) => {
    if (best[k] === undefined || v < best[k]) best[k] = v;
  };
  for (let rep = 0; rep < reps; rep++) {
    let pre = 0;
    let facts = 0;
    let cls = 0;
    let whole = 0;
    for (const id of active) {
      const a = Date.now();
      const R = t.resolver(app);
      R.preload([id], from, to);
      const b = Date.now();
      const e = R.emp(id);
      const rs = R.ruleSet(id, to);
      const ws = rs.settings.week_start;
      const f = from < e.start ? e.start : from;
      const tt = e.end !== '' && to > e.end ? e.end : to;
      if (tt < f) continue;
      const ctxFrom = [rules.weekStartOf(f, ws), t.monthStart(f)].sort()[0];
      const ctxTo = [rules.dayAdd(rules.weekStartOf(tt, ws), 6), tt].sort()[1];
      const fx = t.dayFacts(R, id, ctxFrom, ctxTo, {});
      const c = Date.now();
      rules.classify(
        fx.map((x) => ({ day: x.day, kind: x.kind, worked: x.future ? 0 : x.worked, night: x.future ? 0 : x.night, leave: x.leave })),
        rs.rules,
        { week_start: ws, counts_leave: rs.settings.counts_leave },
      );
      const d = Date.now();
      t.payInputsDetail(app, id, from, to, R);
      const e2 = Date.now();
      pre += b - a;
      facts += c - b;
      cls += d - c;
      whole += e2 - d;
    }
    keep('preload', pre);
    keep('dayFacts', facts);
    keep('classify', cls);
    keep('detail_again_same_R', whole);
    const a = Date.now();
    for (const id of active) t.payInputs(app, id, from, to);
    keep('payInputs', Date.now() - a);
    const b = Date.now();
    t.payInputsMany(app, active, from, to);
    keep('payInputsMany', Date.now() - b);
  }
  const per = {};
  for (const k of Object.keys(best)) per[k] = Math.round((best[k] / active.length) * 10) / 10;
  const micro = {};
  const time = (k, n, f) => {
    const a = Date.now();
    for (let i = 0; i < n; i++) f(i);
    micro[k] = Math.round(((Date.now() - a) * 1000) / n) / 1;
  };
  const id0 = active[0];
  const R0 = t.resolver(app);
  R0.preload([id0], from, to);
  const att = u.findMany(app, 'attendance', 'employment = {:e}', 'day', 1, { e: id0 })[0];
  time('rules.weekStartOf_us', 3000, (i) => rules.weekStartOf('2026-10-' + String((i % 28) + 1).padStart(2, '0'), 1));
  time('util.dayAdd_us', 3000, (i) => u.dayAdd('2026-10-01', i % 40));
  time('util.weekday_us', 3000, (i) => u.weekday('2026-10-01'));
  if (att) time('rec.getString_us', 3000, () => att.getString('status'));
  if (att) time('rec.getInt_us', 3000, () => att.getInt('worked_min'));
  if (att) time('jsonOf_us', 3000, () => u.jsonOf(att, 'flags', []));
  time('planOf_us', 300, (i) => t.planOf(R0, id0, u.dayAdd(from, i % 30)));
  time('R.zone_us', 1000, (i) => R0.zone(id0, from));
  time('R.jobOn_us', 1000, (i) => R0.jobOn(id0, from));
  time('R.assignment_us', 1000, (i) => R0.assignment(id0, u.dayAdd(from, i % 30)));
  time('R.scheduleOn_us', 1000, (i) => R0.scheduleOn(id0, from));
  time('R.holiday_us', 1000, (i) => R0.holiday(R0.calendarOn(id0, from), from));
  time('empty_fn_us', 3000, () => null);
  time('date_new_us', 3000, (i) => new Date(1790000000000 + i).getUTCDay());
  const days = [];
  for (let d = from; d <= u.dayAdd(from, 41); d = u.dayAdd(d, 1)) days.push({ day: d, kind: 'work', worked: 480, night: 0, leave: 0 });
  const rs0 = R0.ruleSet(id0, to);
  time('classify42_us', 50, () => rules.classify(days, rs0.rules, { week_start: 1, counts_leave: false }));
  return { n: active.length, best_total_ms: best, best_per_employee_ms: per, micro: micro, rules0: rs0.rules };
}

/** Where attendance.board time goes at scale (scratch profiling). */
function boardProfile(ctx, p) {
  const u = require(`${__hooks}/lib_util.js`);
  const t = require(`${__hooks}/lib_time.js`);
  const app = ctx.app;
  const out = {};
  const day = u.today(app);
  let a = Date.now();
  const pool = require(`${__hooks}/lib_people.js`).activeEmployments(app, { from: day, to: day });
  out.activeEmployments = Date.now() - a;
  a = Date.now();
  const people = t.roster(ctx, day, day, {});
  out.roster_total = Date.now() - a;
  const ids = people.map((x) => x.employment);
  const R = t.resolver(app);
  a = Date.now();
  R.preloadPlans(ids, day, day);
  out.preloadPlans = Date.now() - a;
  a = Date.now();
  t.recordsIn(app, 'attendance', 'employment', ids, 'day = {:d}', { d: day }, 'id ASC');
  t.recordsIn(app, 'checkins', 'employment', ids, 'voided = FALSE AND day >= {:y} AND day <= {:d}', { d: day, y: u.dayAdd(day, -1) }, 'at ASC');
  out.att_and_punches = Date.now() - a;
  a = Date.now();
  t.clockStates(app, ids);
  out.clockStates = Date.now() - a;
  a = Date.now();
  for (const id of ids) {
    t.planOf(R, id, day);
    R.leaveOn(id, day);
    R.ruleSet(id, day);
  }
  out.plans_loop = Date.now() - a;
  a = Date.now();
  require(`${__hooks}/lib_time_att.js`).board(ctx, {});
  out.board = Date.now() - a;
  out.n = ids.length;
  out.pool = pool.length;
  const pe = require(`${__hooks}/lib_people.js`);
  const ent = u.findMany(app, 'entities', '', 'created')[0];
  const some = pool.slice(0, 7).map((m) => m.id).concat(['nope']);
  const checks = [
    { from: day, to: day },
    { from: u.dayAdd(day, -400), to: day },
    { from: day, to: u.dayAdd(day, 30), entity: ent ? ent.id : undefined },
    { from: day, to: day, ids: some },
    { from: day, to: day, ids: [] },
  ];
  out.pool_same = checks.every((o) => JSON.stringify(pe.activeEmployments(app, o)) === JSON.stringify(t.activePool(app, o)));
  return out;
}

module.exports = { boardProfile: boardProfile, payProfile: payProfile, payBench: payBench, lockDays: lockDays, unlockDays: unlockDays, payInputs: payInputs, cron: cron, facts: facts };
