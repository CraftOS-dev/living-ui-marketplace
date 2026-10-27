/// <reference path="../pb_data/types.d.ts" />
/**
 * The body: one log per day (water by the glass, hours slept, steps,
 * weight, minutes of calm for the mind) and workouts by kind. Everything is
 * a tap or a single number; the trends draw themselves. A weight goal reads
 * the latest weigh-in (lib_goals).
 */

let u_ = null;
function u() {
  return u_ || (u_ = require(`${__hooks}/lib_util.js`));
}
let core_ = null;
function core() {
  return core_ || (core_ = require(`${__hooks}/lib_core.js`));
}
let rec_ = null;
function rec() {
  return rec_ || (rec_ = require(`${__hooks}/lib_rec.js`));
}

const WORKOUTS = ['walk', 'run', 'gym', 'yoga', 'bike', 'swim', 'sport', 'dance'];
const FIELDS = ['water', 'sleep_h', 'steps', 'weight', 'mind_min'];

function logOut(r, date) {
  if (r === null) return { date: date, water: 0, sleep_h: 0, steps: 0, weight: 0, mind_min: 0 };
  return { date: r.getString('date'), water: r.getInt('water'), sleep_h: r.getFloat('sleep_h'), steps: r.getInt('steps'), weight: r.getFloat('weight'), mind_min: r.getInt('mind_min') };
}

function workoutOut(w) {
  return { id: w.id, date: w.getString('date'), kind: w.getString('kind'), minutes: w.getInt('minutes'), note: w.getString('note'), actor: w.getString('actor') };
}

/** health.day: a day's body log, its workouts and the person's daily goals. */
function day(ctx, p) {
  const util = u();
  const C = core();
  const date = util.day(p, 'date', C.today(ctx.app));
  const r = util.findOne(ctx.app, 'health_logs', 'date = {:d}', { d: date });
  const pr = C.prefs(ctx.app);
  return {
    log: logOut(r, date),
    workouts: ctx.app.findRecordsByFilter('workouts', 'date = {:d}', 'created', 0, 0, { d: date }).map(workoutOut),
    goals: { water: pr.water_goal, sleep_h: pr.sleep_goal, steps: pr.steps_goal },
    units: pr.units,
    last_weight: lastWeight(ctx.app, date),
  };
}

function lastWeight(app, upto) {
  const r = app.findRecordsByFilter('health_logs', 'weight > 0 && date <= {:d}', '-date', 1, 0, { d: upto });
  return r.length > 0 ? { date: r[0].getString('date'), weight: r[0].getFloat('weight') } : null;
}

/** health.log: set or add to a day's numbers (water, sleep, steps, weight, mind minutes). */
function log(ctx, p) {
  const util = u();
  const C = core();
  const date = util.day(p, 'date', C.today(ctx.app));
  const out = rec().tx(ctx.app, (t) => {
    let r = util.findOne(t, 'health_logs', 'date = {:d}', { d: date });
    const created = r === null;
    const before = created ? null : rec().snapshot(r, FIELDS);
    if (created) {
      r = util.newRecord(t, 'health_logs');
      r.set('date', date);
    }
    const changed = [];
    if (util.has(p, 'water')) {
      r.set('water', util.int(p, 'water', 0, 0, 40));
      changed.push('water');
    }
    if (util.has(p, 'add_water')) {
      r.set('water', Math.max(0, Math.min(40, r.getInt('water') + util.int(p, 'add_water', 1, -40, 40))));
      changed.push('water');
    }
    if (util.has(p, 'sleep_h')) {
      r.set('sleep_h', Math.round(util.num(p, 'sleep_h', 0, 0, 24) * 4) / 4);
      changed.push('sleep');
    }
    if (util.has(p, 'steps')) {
      r.set('steps', util.int(p, 'steps', 0, 0, 200000));
      changed.push('steps');
    }
    if (util.has(p, 'weight')) {
      r.set('weight', Math.round(util.num(p, 'weight', 0, 0, 1000) * 10) / 10);
      changed.push('weight');
    }
    if (util.has(p, 'mind_min')) {
      r.set('mind_min', util.int(p, 'mind_min', 0, 0, 1440));
      changed.push('calm minutes');
    }
    if (util.has(p, 'add_mind')) {
      r.set('mind_min', Math.max(0, Math.min(1440, r.getInt('mind_min') + util.int(p, 'add_mind', 5, -1440, 1440))));
      changed.push('calm minutes');
    }
    if (changed.length === 0) throw util.fail(400, 'Give at least one of water, add_water, sleep_h, steps, weight, mind_min, add_mind.', 'missing_param');
    t.save(r);
    if (changed.indexOf('weight') >= 0) require(`${__hooks}/lib_goals.js`).recomputeMeasure(t, 'weight');
    // Habits that count themselves from water or calm minutes follow the new numbers.
    require(`${__hooks}/lib_habits.js`).mirror(t, date, ['water', 'mind_min']);
    require(`${__hooks}/lib_activity.js`).write(t, ctx, {
      label: 'Logged ' + changed.filter((x, i, a) => a.indexOf(x) === i).join(', ') + (date !== C.today(t) ? ' for ' + C.words(t, date) : ''),
      target: 'health_logs',
      record: r.id,
      undo: created ? { fn: 'lib_rec.undoCreate', args: { collection: 'health_logs', id: r.id, after: 'lib_health.afterUndo', refs: { date: date } } } : { fn: 'lib_rec.undoUpdate', args: { collection: 'health_logs', id: r.id, fields: before, after: 'lib_health.afterUndo', refs: { date: date } } },
    });
    return r.id;
  });
  return { log: logOut(ctx.app.findRecordById('health_logs', out), date) };
}

function afterUndo(app, refs) {
  require(`${__hooks}/lib_goals.js`).recomputeMeasure(app, 'weight');
  if (refs && refs.date) require(`${__hooks}/lib_habits.js`).mirror(app, refs.date, ['water', 'mind_min']);
}

/** health.trend: the last `days` days, day by day (for the charts). */
function trend(ctx, p) {
  const util = u();
  const C = core();
  const days = util.int(p, 'days', 30, 7, 400);
  const to = util.day(p, 'to', C.today(ctx.app));
  const from = C.addDays(to, -(days - 1));
  const logs = {};
  ctx.app.findRecordsByFilter('health_logs', 'date >= {:f} && date <= {:t}', 'date', 0, 0, { f: from, t: to }).forEach((r) => (logs[r.getString('date')] = logOut(r, r.getString('date'))));
  const wk = {};
  ctx.app.findRecordsByFilter('workouts', 'date >= {:f} && date <= {:t}', 'date', 0, 0, { f: from, t: to }).forEach((w) => {
    const d = w.getString('date');
    wk[d] = wk[d] || { minutes: 0, kinds: [] };
    wk[d].minutes += w.getInt('minutes');
    if (wk[d].kinds.indexOf(w.getString('kind')) < 0) wk[d].kinds.push(w.getString('kind'));
  });
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = C.addDays(from, i);
    const l = logs[d] || logOut(null, d);
    out.push(Object.assign({}, l, { workout_min: wk[d] ? wk[d].minutes : 0, workout_kinds: wk[d] ? wk[d].kinds : [] }));
  }
  const avg = (key) => {
    const xs = out.map((x) => x[key]).filter((x) => x > 0);
    return xs.length === 0 ? null : Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;
  };
  return { from: from, to: to, days: out, averages: { water: avg('water'), sleep_h: avg('sleep_h'), steps: avg('steps'), mind_min: avg('mind_min') }, workouts: out.filter((x) => x.workout_min > 0).length, last_weight: lastWeight(ctx.app, to) };
}

function readWorkout(ctx, p, r, creating) {
  const util = u();
  const C = core();
  if (creating || util.has(p, 'date')) r.set('date', util.day(p, 'date', C.today(ctx.app)));
  if (creating || util.has(p, 'kind')) r.set('kind', util.oneOf(p, 'kind', WORKOUTS, creating ? 'walk' : r.getString('kind')));
  if (creating || util.has(p, 'minutes')) r.set('minutes', util.int(p, 'minutes', 30, 1, 600));
  if (util.has(p, 'note')) r.set('note', util.text(p, 'note', 300, ''));
}

const workouts = rec().crud({
  collection: 'workouts',
  param: 'workout',
  one: 'workout',
  noun: (r) => 'a ' + r.getInt('minutes') + ' minute ' + r.getString('kind'),
  fields: ['date', 'kind', 'minutes', 'note'],
  read: readWorkout,
  out: (app, r) => workoutOut(r),
  sort: '-date,-created',
  where: (ctx, p) => {
    const util = u();
    const C = core();
    const to = util.day(p, 'to', C.today(ctx.app));
    const from = util.day(p, 'from', C.addDays(to, -30));
    return { filter: 'date >= {:f} && date <= {:t}', bind: { f: from, t: to } };
  },
});

module.exports = { WORKOUTS: WORKOUTS, day: day, log: log, afterUndo: afterUndo, trend: trend, lastWeight: lastWeight, workoutList: workouts.list, workoutAdd: workouts.create, workoutUpdate: workouts.update, workoutRemove: workouts.remove };
