/// <reference path="../pb_data/types.d.ts" />
/**
 * Routines (when your AI agent is asked by itself) and the minute tick.
 *
 * Three routines, all switched off until the person turns them on:
 * - morning_note: your AI agent writes the note for the day on Home
 *   (the weather, what matters, a nudge) and may propose a plan for the day;
 * - evening_checkin: one short message about the day, offering to move
 *   what is left;
 * - weekly_recap: your AI agent writes its paragraph for the week's recap.
 * Each fires its declared trigger, outside quiet hours. A routine more than
 * two hours late (the app was not running) is recorded as missed.
 *
 * Times are this machine's local time. PocketBase's cron runs in UTC, so a
 * single per-minute tick (hooks.pb.js) reads the local clock here.
 *
 * The day job runs once per person-day: goal pace moves with the calendar,
 * bought things leave the shopping list, old routine runs go.
 */

let u_ = null;
function u() {
  return u_ || (u_ = require(`${__hooks}/lib_util.js`));
}
let core_ = null;
function core() {
  return core_ || (core_ = require(`${__hooks}/lib_core.js`));
}

const KINDS = ['morning_note', 'evening_checkin', 'weekly_recap'];
const TRIGGER = { morning_note: 'morning_note_due', evening_checkin: 'evening_checkin', weekly_recap: 'recap_requested' };
const LATE_MINUTES = 120;

function dueOn(app, r, date) {
  const days = u().jsonOf(r, 'days') || [];
  return days.indexOf(core().weekday(date)) >= 0;
}

/** The next time a routine comes due, from now. */
function nextDue(app, r) {
  const C = core();
  const now = C.now(app);
  const time = r.getString('time');
  for (let i = 0; i < 14; i++) {
    const d = C.addDays(now.date, i);
    if (!dueOn(app, r, d)) continue;
    const stamp = d + ' ' + time;
    if (stamp > now.stamp && stamp > r.getString('last_due')) return stamp;
  }
  return '';
}

function inQuiet(app, time) {
  const C = core();
  const s = C.settings(app);
  const a = C.minutesOf(s.getString('quiet_start'));
  const b = C.minutesOf(s.getString('quiet_end'));
  const t = C.minutesOf(time);
  if (a < 0 || b < 0 || a === b) return false;
  return a < b ? t >= a && t < b : t >= a || t < b;
}

function runOut(x) {
  return { id: x.id, routine: x.getString('routine'), due_at: x.getString('due_at'), state: x.getString('state'), request: x.getString('request'), note: x.getString('note'), created: x.getString('created') };
}

function out(app, r) {
  const util = u();
  const runs = app.findRecordsByFilter('routine_runs', 'routine = {:r}', '-due_at', 5, 0, { r: r.id }).map(runOut);
  return { id: r.id, kind: r.getString('kind'), enabled: r.getBool('enabled'), days: util.jsonOf(r, 'days') || [], time: r.getString('time'), last_due: r.getString('last_due'), next_due: r.getBool('enabled') ? nextDue(app, r) : '', runs: runs, trigger: TRIGGER[r.getString('kind')] };
}

/** routines.list */
function list(ctx) {
  const s = core().settings(ctx.app);
  return { routines: ctx.app.findRecordsByFilter('routines', '', 'created', 0, 0).sort((a, b) => KINDS.indexOf(a.getString('kind')) - KINDS.indexOf(b.getString('kind'))).map((r) => out(ctx.app, r)), quiet: { start: s.getString('quiet_start'), end: s.getString('quiet_end') } };
}

function find(app, p) {
  const util = u();
  const key = util.req(p, 'routine');
  const r = KINDS.indexOf(key) >= 0 ? util.findOne(app, 'routines', 'kind = {:k}', { k: key }) : util.byId(app, 'routines', key);
  if (r === null) throw util.fail(404, 'No routine "' + key + '"; it is one of ' + KINDS.join(', ') + '.', 'not_found');
  return r;
}

/** routines.update: on or off, the time, the days. */
function update(ctx, p) {
  const util = u();
  const C = core();
  const r0 = find(ctx.app, p);
  ctx.app.runInTransaction((tx) => {
    const r = tx.findRecordById('routines', r0.id);
    if (util.has(p, 'time')) r.set('time', C.time(p, 'time', r.getString('time')));
    if (util.has(p, 'days')) {
      const days = (util.list(p, 'days') || []).map(Number);
      days.forEach((d) => {
        if (!Number.isInteger(d) || d < 0 || d > 6) throw util.fail(400, 'days are weekdays 0 (Sunday) to 6, e.g. [1,2,3,4,5]', 'invalid_param', { param: 'days' });
      });
      r.set('days', days.filter((d, i, a) => a.indexOf(d) === i).sort());
    }
    if (util.has(p, 'enabled')) {
      const on = util.bool(p, 'enabled', false);
      // Switching on does not fire for a time already passed today.
      if (on && !r.getBool('enabled')) {
        const now = C.now(tx);
        const stamp = now.date + ' ' + r.getString('time');
        if (dueOn(tx, r, now.date) && now.stamp >= stamp) r.set('last_due', stamp);
      }
      r.set('enabled', on);
    }
    if ((util.jsonOf(r, 'days') || []).length === 0 && r.getBool('enabled')) throw util.fail(400, 'Pick at least one day for this routine.', 'invalid_param', { param: 'days' });
    tx.save(r);
    require(`${__hooks}/lib_activity.js`).write(tx, ctx, { label: 'Changed the routine ' + r.getString('kind').replace('_', ' '), target: 'routines', record: r.id });
  });
  return { routine: out(ctx.app, ctx.app.findRecordById('routines', r0.id)) };
}

/** Fire a routine's trigger (outside quiet hours) and record the run. */
function run(app, r, due, mode) {
  const util = u();
  const C = core();
  const kind = r.getString('kind');
  const now = C.now(app);
  const params = kind === 'weekly_recap' ? { week_start: C.weekStart(app, now.today) } : { date: now.today };
  let state = 'fired';
  let request = '';
  let note = '';
  if (mode === 'missed') state = 'missed';
  else if (mode !== 'now' && inQuiet(app, now.time)) state = 'quiet';
  else {
    const fired = require(`${__hooks}/_triggers_lib.js`).fire(app, TRIGGER[kind], params, 'hook');
    if (fired && fired.ok === true) request = fired.id;
    else {
      state = 'refused';
      note = fired ? fired.code + (fired.message ? ': ' + fired.message : '') : 'not sent';
    }
  }
  const x = util.newRecord(app, 'routine_runs');
  x.set('routine', r.id);
  x.set('due_at', due);
  x.set('state', state);
  x.set('request', request);
  x.set('note', note.slice(0, 400));
  app.save(x);
  return runOut(x);
}

/** routines.run-now: ask now (to try it). */
function runNow(ctx, p) {
  const r = find(ctx.app, p);
  const res = run(ctx.app, r, core().now(ctx.app).stamp, 'now');
  return { run: res, routine: out(ctx.app, ctx.app.findRecordById('routines', r.id)) };
}

/** Once per person-day. */
function dayJob(app, today) {
  const util = u();
  require(`${__hooks}/lib_goals.js`).recomputeAll(app);
  try {
    require(`${__hooks}/lib_house.js`).tidy(app);
  } catch (err) {
    console.error('[lo] shopping tidy failed:', err);
  }
  util.exec(app, 'DELETE FROM routine_runs WHERE created < {:c}', { c: new Date(Date.now() - 120 * 86400000).toISOString().replace('T', ' ') });
  void today;
}

/** The minute tick. */
function tick(app) {
  const C = core();
  const now = C.now(app);
  const s = C.settings(app);
  if (s.getString('last_day_job') !== now.today) {
    try {
      app.runInTransaction((tx) => {
        dayJob(tx, now.today);
        const s2 = C.settings(tx);
        s2.set('last_day_job', now.today);
        tx.saveNoValidate(s2);
      });
    } catch (err) {
      console.error('[lo] day job failed:', err);
    }
  }
  app.findRecordsByFilter('routines', 'enabled = true', '', 0, 0).forEach((r0) => {
    try {
      if (!dueOn(app, r0, now.date)) return;
      const due = now.date + ' ' + r0.getString('time');
      if (now.stamp < due || r0.getString('last_due') >= due) return;
      const late = C.minutesOf(now.time) - C.minutesOf(r0.getString('time')) > LATE_MINUTES;
      app.runInTransaction((tx) => {
        const r = tx.findRecordById('routines', r0.id);
        if (r.getString('last_due') >= due) return;
        r.set('last_due', due);
        tx.saveNoValidate(r);
        run(tx, r, due, late ? 'missed' : 'run');
      });
    } catch (err) {
      console.error('[lo] routine ' + r0.getString('kind') + ' failed:', err);
    }
  });
  try {
    require(`${__hooks}/lib_calendar.js`).due(app);
  } catch (err) {
    console.error('[lo] calendar failed:', err);
  }
  try {
    require(`${__hooks}/lib_world.js`).warm(app);
  } catch (err) {
    console.error('[lo] weather failed:', err);
  }
}

module.exports = { KINDS: KINDS, TRIGGER: TRIGGER, dueOn: dueOn, nextDue: nextDue, inQuiet: inQuiet, out: out, list: list, update: update, run: run, runNow: runNow, dayJob: dayJob, tick: tick };
