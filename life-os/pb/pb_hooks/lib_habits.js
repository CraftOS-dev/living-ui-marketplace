/// <reference path="../pb_data/types.d.ts" />
/**
 * Habits, as a tracker: each habit is a drawing and a schedule (every day,
 * some weekdays, or so many times a week), done with a tap (or counted up
 * to a target, like 8 glasses). The numbers people expect from a tracker:
 * the streak (a skipped day does not break it), the best streak, the
 * share of the last 30 days done, and every day's state for the grid and
 * the month calendar.
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
let act_ = null;
function act() {
  return act_ || (act_ = require(`${__hooks}/lib_activity.js`));
}

const SCHEDULES = ['daily', 'weekdays', 'per_week'];
const TIMES = ['morning', 'afternoon', 'evening', 'anytime'];
/** Body-log numbers a habit can count itself from (glasses of water, calm minutes). */
const SOURCES = ['water', 'mind_min'];

function sched(h) {
  const util = u();
  return { kind: h.getString('schedule'), days: util.jsonOf(h, 'days') || [], times: Math.max(1, h.getInt('times')), target: Math.max(1, h.getInt('target')), start: h.getString('started_on') || String(h.getString('created')).slice(0, 10) };
}

/** Is `day` (a day number) one the habit is due on? (per_week habits: any day counts.) */
function scheduled(s, n) {
  if (s.kind === 'weekdays') return s.days.indexOf(core().wdOf(n)) >= 0;
  return true;
}

/** Logs of some habits between two days: { habitId: { 'YYYY-MM-DD': { value, state, note } } }. */
function loadLogs(app, ids, from, to) {
  const out = {};
  for (const id of ids) out[id] = {};
  if (ids.length === 0) return out;
  const util = u();
  const bind = { f: from, t: to };
  const list = ids.map((id, i) => {
    bind['h' + i] = id;
    return '{:h' + i + '}';
  });
  util.rows(app, 'SELECT habit, date, value, state, note FROM habit_logs WHERE date >= {:f} AND date <= {:t} AND habit IN (' + list.join(',') + ')', { habit: '', date: '', value: 0, state: '', note: '' }, bind).forEach((r) => {
    out[r.habit][r.date] = { value: r.value, state: r.state, note: r.note };
  });
  return out;
}

function isDone(l, s) {
  return l !== undefined && l.state === 'done' && l.value >= s.target;
}

/** The numbers of one habit from its logs (today = the person's today). */
function metrics(app, h, logs, today) {
  const C = core();
  const s = sched(h);
  const t = C.dnum(today);
  const s0 = C.dnum(s.start);
  const L = logs || {};
  const at = (n) => L[C.dstr(n)];
  const todayLog = at(t);
  const res = { today: { value: todayLog ? todayLog.value : 0, done: isDone(todayLog, s), skipped: todayLog !== undefined && todayLog.state === 'skipped', due: false }, streak: 0, best: 0, rate30: null, cells: [], week: null };

  // The grid: the last 14 days.
  for (let n = t - 13; n <= t; n++) {
    const l = at(n);
    let st;
    if (n < s0) st = 'before';
    else if (l !== undefined && l.state === 'skipped') st = 'skip';
    else if (isDone(l, s)) st = 'done';
    else if (l !== undefined && l.value > 0) st = 'part';
    else if (!scheduled(s, n)) st = 'rest';
    else st = n === t ? 'open' : 'miss';
    res.cells.push({ date: C.dstr(n), state: st, value: l ? l.value : 0 });
  }

  if (s.kind === 'per_week') {
    const first = C.weekStartsOn(app);
    const weekOf = (n) => n - ((C.wdOf(n) - first + 7) % 7);
    const doneIn = (a) => {
      let d = 0;
      for (let n = a; n < a + 7; n++) if (isDone(at(n), s)) d += 1;
      return d;
    };
    const cur = weekOf(t);
    const nowDone = doneIn(cur);
    res.week = { done: nowDone, times: s.times };
    res.today.due = nowDone < s.times && !res.today.done && t >= s0;
    // Streak in weeks: this week counts once met; earlier weeks must be met.
    let streak = 0;
    let w = cur;
    if (nowDone >= s.times) streak = 1;
    w -= 7;
    while (w + 6 >= s0) {
      if (doneIn(w) >= s.times) streak += 1;
      else break;
      w -= 7;
    }
    res.streak = streak;
    let best = 0;
    let run = 0;
    for (let a = weekOf(s0); a <= cur; a += 7) {
      if (doneIn(a) >= s.times) {
        run += 1;
        if (run > best) best = run;
      } else if (a !== cur) run = 0;
    }
    res.best = best;
    // Rate: partial credit over the last 4 full weeks (and this week when met).
    let credit = 0;
    let weeks = 0;
    for (let k = 0; k < 4; k++) {
      const a = cur - 7 * (k + 1);
      if (a + 6 < s0) break;
      credit += Math.min(1, doneIn(a) / s.times);
      weeks += 1;
    }
    if (nowDone >= s.times) {
      credit += 1;
      weeks += 1;
    }
    res.rate30 = weeks > 0 ? credit / weeks : null;
    return res;
  }

  res.today.due = scheduled(s, t) && !res.today.done && !res.today.skipped && t >= s0;
  // Streak: scheduled days done in a row, back from today (today only once done); a skip does not break it.
  let streak = 0;
  for (let n = res.today.done ? t : t - 1; n >= s0; n--) {
    if (!scheduled(s, n)) continue;
    const l = at(n);
    if (l !== undefined && l.state === 'skipped') continue;
    if (isDone(l, s)) streak += 1;
    else break;
  }
  res.streak = streak;
  let best = 0;
  let run = 0;
  for (let n = s0; n <= t; n++) {
    if (!scheduled(s, n)) continue;
    const l = at(n);
    if (l !== undefined && l.state === 'skipped') continue;
    if (isDone(l, s)) {
      run += 1;
      if (run > best) best = run;
    } else if (n !== t) run = 0;
  }
  res.best = best;
  let chances = 0;
  let taken = 0;
  for (let n = Math.max(s0, t - 29); n <= t; n++) {
    if (!scheduled(s, n)) continue;
    const l = at(n);
    if (l !== undefined && l.state === 'skipped') continue;
    if (n === t && !isDone(l, s)) continue;
    chances += 1;
    if (isDone(l, s)) taken += 1;
  }
  res.rate30 = chances > 0 ? taken / chances : null;
  return res;
}

function out(app, h, logs, today) {
  const util = u();
  const gm = core().goalMap(app);
  const goal = gm[h.getString('goal')] || null;
  return Object.assign(
    {
      id: h.id,
      name: h.getString('name'),
      art: h.getString('art') || 'sprout',
      area: h.getString('area'),
      goal: goal === null ? null : { id: goal.id, title: goal.title },
      schedule: h.getString('schedule'),
      days: util.jsonOf(h, 'days') || [],
      times: h.getInt('times'),
      target: Math.max(1, h.getInt('target')),
      unit: h.getString('unit'),
      time_of_day: h.getString('time_of_day') || 'anytime',
      cue: h.getString('cue'),
      source: h.getString('source'),
      started_on: h.getString('started_on'),
      archived: h.getBool('archived'),
      rank: h.getInt('rank'),
      actor: h.getString('actor'),
    },
    metrics(app, h, logs, today),
  );
}

function listRecords(app, archived) {
  return app.findRecordsByFilter('habits', archived ? 'archived = true' : 'archived = false', 'rank,created', 0, 0);
}

/** Many habits with their numbers (reads ~400 days of logs at once). */
function outMany(app, recs, today) {
  const C = core();
  const logs = loadLogs(
    app,
    recs.map((h) => h.id),
    C.addDays(today, -400),
    today,
  );
  return recs.map((h) => out(app, h, logs[h.id], today));
}

/** habits.list: every habit with its streak, rate and the last 14 days. */
function list(ctx, p) {
  const util = u();
  const C = core();
  const today = util.day(p, 'date', C.today(ctx.app));
  const recs = listRecords(ctx.app, util.bool(p, 'archived', false));
  const area = C.kind(p, 'area', false) || '';
  const habits = outMany(ctx.app, area === '' ? recs : recs.filter((h) => h.getString('area') === area), today);
  return { date: today, habits: habits, due: habits.filter((h) => h.today.due || h.today.done).length, done: habits.filter((h) => h.today.done).length };
}

/** habits.get: one habit with its month, its year and its notes. */
function get(ctx, p) {
  const util = u();
  const C = core();
  const h = C.need(ctx.app, 'habits', util.req(p, 'habit'), 'habit');
  const today = C.today(ctx.app);
  const logs = loadLogs(ctx.app, [h.id], C.addDays(today, -400), today)[h.id];
  const o = out(ctx.app, h, logs, today);
  const s = sched(h);
  const year = [];
  const span = util.int(p, 'days', 365, 7, 365);
  for (let i = span - 1; i >= 0; i--) {
    const d = C.addDays(today, -i);
    const l = logs[d];
    year.push({ date: d, state: d < s.start ? 'before' : l && l.state === 'skipped' ? 'skip' : isDone(l, s) ? 'done' : l && l.value > 0 ? 'part' : 'none' });
  }
  o.year = year;
  o.notes = Object.keys(logs)
    .filter((d) => logs[d].note !== '')
    .sort()
    .reverse()
    .slice(0, 30)
    .map((d) => ({ date: d, note: logs[d].note }));
  o.total_done = Object.keys(logs).filter((d) => isDone(logs[d], s)).length;
  return { habit: o };
}

function readHabit(ctx, p, h, creating) {
  const util = u();
  const C = core();
  if (creating || util.has(p, 'name')) h.set('name', C.name(p, 'name', 120));
  if (creating || util.has(p, 'art')) h.set('art', C.art(p, 'art', creating ? 'sprout' : h.getString('art')));
  const k = C.kind(p, 'area', false);
  if (k !== undefined) h.set('area', k);
  const goal = C.ref(ctx.app, p, 'goal', 'goals', 'goal');
  if (goal !== undefined) h.set('goal', goal);
  if (creating || util.has(p, 'schedule')) h.set('schedule', util.oneOf(p, 'schedule', SCHEDULES, creating ? 'daily' : h.getString('schedule')));
  if (util.has(p, 'days')) {
    const days = (util.list(p, 'days') || []).map(Number);
    days.forEach((d) => {
      if (!Number.isInteger(d) || d < 0 || d > 6) throw util.fail(400, 'days are weekdays 0 (Sunday) to 6, e.g. [1,3,5]', 'invalid_param', { param: 'days' });
    });
    h.set('days', days.filter((d, i, a) => a.indexOf(d) === i).sort());
  }
  if (h.getString('schedule') === 'weekdays' && (util.jsonOf(h, 'days') || []).length === 0) h.set('days', [1, 2, 3, 4, 5]);
  if (creating || util.has(p, 'times')) h.set('times', util.int(p, 'times', 3, 1, 7));
  if (creating || util.has(p, 'target')) h.set('target', util.int(p, 'target', 1, 1, 100));
  if (util.has(p, 'unit')) h.set('unit', C.name(p, 'unit', 30, ''));
  if (creating || util.has(p, 'time_of_day')) h.set('time_of_day', util.oneOf(p, 'time_of_day', TIMES, creating ? 'anytime' : h.getString('time_of_day')));
  if (util.has(p, 'cue')) h.set('cue', util.text(p, 'cue', 200, ''));
  if (util.has(p, 'source')) h.set('source', util.oneOf(p, 'source', SOURCES.concat(['']), ''));
  if (creating || util.has(p, 'started_on')) h.set('started_on', util.day(p, 'started_on', C.today(ctx.app)));
  if (util.has(p, 'archived')) h.set('archived', util.bool(p, 'archived', false));
  if (creating) h.set('rank', C.nextRank(ctx.app, 'habits'));
}

function afterHabit(app, refs) {
  const G = require(`${__hooks}/lib_goals.js`);
  for (const g of [refs && refs.goal, refs && refs.before && refs.before.goal]) if (g) G.recompute(app, g);
  if (refs && refs.id && refs.source) backfill(app, refs.id);
}

/** A habit that counts itself from the body log takes that number for a day (no log when it is 0, unless skipped or noted). */
function mirrorOne(app, h, date, value) {
  const util = u();
  let r = util.findOne(app, 'habit_logs', 'habit = {:h} && date = {:d}', { h: h.id, d: date });
  const v = Math.max(0, Math.min(1000, Math.round(value)));
  if (v === 0) {
    if (r === null) return;
    if (r.getString('state') !== 'skipped' && r.getString('note') === '') app.delete(r);
    else if (r.getString('state') !== 'skipped') {
      r.set('value', 0);
      app.save(r);
    }
    return;
  }
  if (r === null) {
    r = util.newRecord(app, 'habit_logs');
    r.set('habit', h.id);
    r.set('date', date);
    r.set('actor', 'system');
  }
  r.set('value', v);
  r.set('state', 'done');
  app.save(r);
}

/** After the body log of a day changed: every habit counting itself from a changed number follows it. */
function mirror(app, date, fields) {
  const util = u();
  const log = util.findOne(app, 'health_logs', 'date = {:d}', { d: date });
  for (const f of SOURCES) {
    if (fields.indexOf(f) < 0) continue;
    const value = log === null ? 0 : log.getInt(f);
    app.findRecordsByFilter('habits', 'archived = false && source = {:s}', '', 0, 0, { s: f }).forEach((h) => {
      mirrorOne(app, h, date, value);
      if (h.getString('goal') !== '') require(`${__hooks}/lib_goals.js`).recompute(app, h.getString('goal'));
    });
  }
}

/** A habit just set to count itself: its days from the body log since it started. */
function backfill(app, id) {
  const util = u();
  const h = util.byId(app, 'habits', id);
  if (h === null || SOURCES.indexOf(h.getString('source')) < 0) return;
  const f = h.getString('source');
  const from = h.getString('started_on') || core().addDays(core().today(app), -30);
  util.rows(app, 'SELECT date, ' + f + ' AS v FROM health_logs WHERE date >= {:f}', { date: '', v: 0 }, { f: from }).forEach((x) => mirrorOne(app, h, x.date, x.v));
}

/** Log a habit that counts itself: the number goes to the body log (which the habit then follows). */
function toBody(ctx, h, date, value) {
  const params = { date: date };
  params[h.getString('source')] = Math.max(0, value);
  require(`${__hooks}/lib_health.js`).log(ctx, params);
}

const crud = rec().crud({
  collection: 'habits',
  param: 'habit',
  one: 'habit',
  noun: (r) => 'the habit "' + r.getString('name') + '"',
  fields: ['name', 'art', 'area', 'goal', 'schedule', 'days', 'times', 'target', 'unit', 'time_of_day', 'cue', 'source', 'started_on', 'archived', 'rank'],
  json: ['days'],
  read: readHabit,
  out: (app, r) => {
    const today = core().today(app);
    return out(app, r, loadLogs(app, [r.id], core().addDays(today, -400), today)[r.id], today);
  },
  refs: (r) => ({ goal: r.getString('goal'), id: r.id, source: r.getString('source') }),
  after: afterHabit,
  afterName: 'lib_habits.afterHabit',
});

/** habits.reorder */
function reorder(ctx, p) {
  const util = u();
  const ids = util.ids(p, 'habits', 200);
  rec().tx(ctx.app, (t) => {
    ids.forEach((id, i) => {
      const h = core().need(t, 'habits', id, 'habit');
      h.set('rank', i + 1);
      t.save(h);
    });
  });
  return { ok: true };
}

/* ------------------------------------------------------------- logging */

function saveLog(ctx, h, date, set, label) {
  const util = u();
  const C = core();
  rec().tx(ctx.app, (t) => {
    let r = util.findOne(t, 'habit_logs', 'habit = {:h} && date = {:d}', { h: h.id, d: date });
    const before = r === null ? null : { value: r.getInt('value'), state: r.getString('state'), note: r.getString('note') };
    if (set === null) {
      if (r === null) return;
      t.delete(r);
    } else {
      if (r === null) {
        r = util.newRecord(t, 'habit_logs');
        r.set('habit', h.id);
        r.set('date', date);
      }
      r.set('value', set.value);
      r.set('state', set.state);
      if (set.note !== undefined) r.set('note', set.note);
      r.set('actor', ctx.actor);
      t.save(r);
    }
    if (h.getString('goal') !== '') require(`${__hooks}/lib_goals.js`).recompute(t, h.getString('goal'));
    act().write(t, ctx, { label: label + (date !== C.today(t) ? ' (' + C.words(t, date) + ')' : ''), target: 'habit_logs', record: h.id, undo: { fn: 'lib_habits.undoLog', args: { habit: h.id, date: date, before: before } } });
  });
}

function undoLog(ctx, args) {
  const util = u();
  const r = util.findOne(ctx.app, 'habit_logs', 'habit = {:h} && date = {:d}', { h: args.habit, d: args.date });
  if (args.before === null) {
    if (r !== null) ctx.app.delete(r);
  } else {
    const x = r !== null ? r : util.newRecord(ctx.app, 'habit_logs');
    x.set('habit', args.habit);
    x.set('date', args.date);
    x.set('value', args.before.value);
    x.set('state', args.before.state);
    x.set('note', args.before.note);
    ctx.app.save(x);
  }
  const h = util.byId(ctx.app, 'habits', args.habit);
  if (h !== null && h.getString('goal') !== '') require(`${__hooks}/lib_goals.js`).recompute(ctx.app, h.getString('goal'));
}

function current(app, h, date) {
  const r = u().findOne(app, 'habit_logs', 'habit = {:h} && date = {:d}', { h: h.id, d: date });
  return r === null ? null : { value: r.getInt('value'), state: r.getString('state'), note: r.getString('note') };
}

function after(ctx, h) {
  const today = core().today(ctx.app);
  return { habit: out(ctx.app, h, loadLogs(ctx.app, [h.id], core().addDays(today, -400), today)[h.id], today) };
}

/** habits.tap: the one-tap log. A check habit flips done; a counted one adds one (past the target it starts again at zero). */
function tap(ctx, p) {
  const util = u();
  const C = core();
  const h = C.need(ctx.app, 'habits', util.req(p, 'habit'), 'habit');
  const date = util.day(p, 'date', C.today(ctx.app));
  if (date > C.today(ctx.app)) throw util.fail(400, 'A day that has not come yet cannot be logged.', 'invalid_param', { param: 'date' });
  const s = sched(h);
  const cur = current(ctx.app, h, date);
  const name = h.getString('name');
  if (h.getString('source') !== '') {
    const v = cur === null || cur.state === 'skipped' ? 0 : cur.value;
    toBody(ctx, h, date, s.target <= 1 ? (v > 0 ? 0 : 1) : v >= s.target ? 0 : v + 1);
    return after(ctx, h);
  }
  if (s.target <= 1) {
    if (cur !== null && cur.state === 'done') saveLog(ctx, h, date, null, 'Unmarked "' + name + '"');
    else saveLog(ctx, h, date, { value: 1, state: 'done' }, 'Did "' + name + '"');
  } else {
    const v = cur === null || cur.state === 'skipped' ? 0 : cur.value;
    const next = v >= s.target ? 0 : v + 1;
    if (next === 0) saveLog(ctx, h, date, null, 'Reset "' + name + '"');
    else saveLog(ctx, h, date, { value: next, state: 'done' }, (next >= s.target ? 'Did "' : 'Logged ') + (next >= s.target ? name + '"' : next + ' of ' + s.target + (h.getString('unit') !== '' ? ' ' + h.getString('unit') : '') + ' for "' + name + '"'));
  }
  return after(ctx, h);
}

/** habits.log: set a day exactly (a value, done, skipped, a note). */
function log(ctx, p) {
  const util = u();
  const C = core();
  const h = C.need(ctx.app, 'habits', util.req(p, 'habit'), 'habit');
  const date = util.day(p, 'date', C.today(ctx.app));
  if (date > C.today(ctx.app)) throw util.fail(400, 'A day that has not come yet cannot be logged.', 'invalid_param', { param: 'date' });
  const s = sched(h);
  const cur = current(ctx.app, h, date);
  const state = util.oneOf(p, 'state', ['done', 'skipped'], 'done');
  let value = cur === null ? 0 : cur.value;
  if (util.has(p, 'value')) value = util.int(p, 'value', 0, 0, 1000);
  else if (util.has(p, 'add')) value = Math.max(0, value + util.int(p, 'add', 1, -1000, 1000));
  else if (state === 'done') value = s.target;
  const note = util.has(p, 'note') ? util.text(p, 'note', 300, '') : undefined;
  const name = h.getString('name');
  if (cur !== null && cur.state === state && cur.value === (state === 'skipped' ? 0 : value) && (note === undefined || note === cur.note)) return Object.assign(after(ctx, h), { changed: false });
  if (h.getString('source') !== '' && state === 'done') {
    toBody(ctx, h, date, value);
    if (note !== undefined) saveLog(ctx, h, date, { value: Math.max(1, value), state: 'done', note: note }, 'Noted "' + name + '"');
    return after(ctx, h);
  }
  saveLog(ctx, h, date, { value: state === 'skipped' ? 0 : value, state: state, note: note === undefined && cur !== null ? cur.note : note }, state === 'skipped' ? 'Skipped "' + name + '"' : value >= s.target ? 'Did "' + name + '"' : 'Logged ' + value + ' for "' + name + '"');
  return after(ctx, h);
}

/** habits.unlog: clear a day. */
function unlog(ctx, p) {
  const util = u();
  const C = core();
  const h = C.need(ctx.app, 'habits', util.req(p, 'habit'), 'habit');
  const date = util.day(p, 'date', C.today(ctx.app));
  if (h.getString('source') !== '') toBody(ctx, h, date, 0);
  saveLog(ctx, h, date, null, 'Cleared "' + h.getString('name') + '"');
  return after(ctx, h);
}

/** The average 30-day rate of some habits (a goal measured by its habits). */
function rateOf(app, ids) {
  if (ids.length === 0) return null;
  const C = core();
  const today = C.today(app);
  const recs = ids.map((id) => u().byId(app, 'habits', id)).filter((h) => h !== null);
  const logs = loadLogs(
    app,
    recs.map((h) => h.id),
    C.addDays(today, -400),
    today,
  );
  const rates = recs.map((h) => metrics(app, h, logs[h.id], today).rate30).filter((x) => x !== null);
  return rates.length === 0 ? null : rates.reduce((a, b) => a + b, 0) / rates.length;
}

/** Preview of a habit change your AI agent proposes. */
function preview(ctx, p) {
  const util = u();
  const op = ctx.op;
  if (op === 'habits.create') return { kind: 'habit', title: 'New habit: ' + util.text(p, 'name', 120, ''), summary: [p.schedule === 'per_week' ? (p.times || 3) + ' times a week' : p.schedule === 'weekdays' ? 'some weekdays' : 'every day', p.cue ? 'Cue: ' + p.cue : '', p.area ? 'In ' + core().KIND_NAMES[String(p.area)] : ''].filter((x) => x !== '').join('. '), preview: { fields: p } };
  const h = core().need(ctx.app, 'habits', util.req(p, 'habit'), 'habit');
  if (op === 'habits.delete') return { kind: 'habit', title: 'Delete the habit "' + h.getString('name') + '"', summary: 'Its logged days go with it.', preview: {}, target: { collection: 'habits', id: h.id } };
  const changes = {};
  for (const k of Object.keys(p)) if (k !== 'habit') changes[k] = { from: h.get(k), to: p[k] };
  return { kind: 'habit', title: 'Change the habit "' + h.getString('name') + '"', summary: Object.keys(changes).join(', '), preview: { changes: JSON.parse(JSON.stringify(changes)) }, target: { collection: 'habits', id: h.id } };
}

module.exports = {
  SOURCES: SOURCES,
  mirror: mirror,
  backfill: backfill,
  SCHEDULES: SCHEDULES,
  sched: sched,
  scheduled: scheduled,
  loadLogs: loadLogs,
  metrics: metrics,
  out: out,
  outMany: outMany,
  listRecords: listRecords,
  list: list,
  get: get,
  create: crud.create,
  update: crud.update,
  remove: crud.remove,
  afterHabit: afterHabit,
  reorder: reorder,
  tap: tap,
  log: log,
  unlog: unlog,
  undoLog: undoLog,
  rateOf: rateOf,
  preview: preview,
};
