/// <reference path="../pb_data/types.d.ts" />
/**
 * Days: how today feels (a mood sticker, energy), your AI agent's note for
 * the day on Home, and a month of days for the calendars (what got done,
 * how it felt, whether there was writing or movement).
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

function dayOut(r, date) {
  if (r === null) return { date: date, mood: 0, energy: 0, agent_note: '', agent_note_at: '' };
  return { date: r.getString('date'), mood: r.getInt('mood'), energy: r.getInt('energy'), agent_note: r.getString('agent_note'), agent_note_at: r.getString('agent_note_at') };
}

function find(app, date) {
  return u().findOne(app, 'days', 'date = {:d}', { d: date });
}

function ensure(app, date) {
  let r = find(app, date);
  if (r === null) {
    r = u().newRecord(app, 'days');
    r.set('date', date);
    app.save(r);
  }
  return r;
}

/** days.get */
function get(ctx, p) {
  const util = u();
  const date = util.day(p, 'date', core().today(ctx.app));
  return { day: dayOut(find(ctx.app, date), date) };
}

/** days.mood: how the day feels (a person's own; your AI agent cannot set it). */
function mood(ctx, p) {
  const util = u();
  const C = core();
  const date = util.day(p, 'date', C.today(ctx.app));
  rec().tx(ctx.app, (t) => {
    const r = ensure(t, date);
    const before = rec().snapshot(r, ['mood', 'energy']);
    if (util.has(p, 'mood')) r.set('mood', util.int(p, 'mood', 0, 0, 5));
    if (util.has(p, 'energy')) r.set('energy', util.int(p, 'energy', 0, 0, 5));
    t.save(r);
    require(`${__hooks}/lib_activity.js`).write(t, ctx, { label: 'Noted how ' + (date === C.today(t) ? 'today' : C.words(t, date)) + ' feels', target: 'days', record: r.id, undo: { fn: 'lib_rec.undoUpdate', args: { collection: 'days', id: r.id, fields: before } } });
  });
  return { day: dayOut(find(ctx.app, date), date) };
}

/** days.note: your AI agent's note for the day on Home (empty text clears it). */
function note(ctx, p) {
  const util = u();
  const C = core();
  const date = util.day(p, 'date', C.today(ctx.app));
  const text = util.text(p, 'text', 1200, '');
  if (C.hasEmoji(text)) throw util.fail(400, 'No emoji in the note.', 'emoji_not_allowed', { param: 'text' });
  rec().tx(ctx.app, (t) => {
    const r = ensure(t, date);
    const before = rec().snapshot(r, ['agent_note', 'agent_note_at']);
    r.set('agent_note', text);
    r.set('agent_note_at', text === '' ? '' : util.nowIso());
    t.save(r);
    require(`${__hooks}/lib_activity.js`).write(t, ctx, { label: text === '' ? 'Cleared the note for the day' : 'Wrote the note for the day', target: 'days', record: r.id, undo: { fn: 'lib_rec.undoUpdate', args: { collection: 'days', id: r.id, fields: before } } });
  });
  return { day: dayOut(find(ctx.app, date), date) };
}

/** days.month: every day of a month with what happened (for the calendars). */
function month(ctx, p) {
  const util = u();
  const C = core();
  const today = C.today(ctx.app);
  const m = util.str(p, 'month', today.slice(0, 7));
  if (!/^\d{4}-\d{2}$/.test(m)) throw util.fail(400, 'month is YYYY-MM', 'invalid_param', { param: 'month' });
  const start = m + '-01';
  const end = C.monthEnd(start);
  const bind = { s: start, e: end };
  const by = (sql, shape) => {
    const o = {};
    util.rows(ctx.app, sql, shape, bind).forEach((r) => (o[r.d] = r));
    return o;
  };
  const days = by('SELECT date AS d, mood, energy FROM days WHERE date >= {:s} AND date <= {:e}', { d: '', mood: 0, energy: 0 });
  const done = by("SELECT done_date AS d, COUNT(*) AS n FROM tasks WHERE state = 'done' AND done_date >= {:s} AND done_date <= {:e} GROUP BY done_date", { d: '', n: 0 });
  const habits = by("SELECT date AS d, COUNT(*) AS n FROM habit_logs WHERE state = 'done' AND date >= {:s} AND date <= {:e} GROUP BY date", { d: '', n: 0 });
  const journal = by('SELECT date AS d, COUNT(*) AS n, MAX(mood) AS mood FROM journal_entries WHERE date >= {:s} AND date <= {:e} GROUP BY date', { d: '', n: 0, mood: 0 });
  const moves = by('SELECT date AS d, SUM(minutes) AS n FROM workouts WHERE date >= {:s} AND date <= {:e} GROUP BY date', { d: '', n: 0 });
  const events = by('SELECT date AS d, COUNT(*) AS n FROM events WHERE date >= {:s} AND date <= {:e} GROUP BY date', { d: '', n: 0 });
  const cal = by('SELECT date AS d, COUNT(*) AS n FROM calendar_events WHERE date >= {:s} AND date <= {:e} GROUP BY date', { d: '', n: 0 });
  const out = [];
  for (let d = start; d <= end; d = C.addDays(d, 1)) {
    const mood = (days[d] && days[d].mood) || (journal[d] && journal[d].mood) || 0;
    out.push({ date: d, mood: mood, energy: days[d] ? days[d].energy : 0, done: done[d] ? done[d].n : 0, habits: habits[d] ? habits[d].n : 0, journal: journal[d] ? journal[d].n : 0, workout_min: moves[d] ? moves[d].n : 0, events: (events[d] ? events[d].n : 0) + (cal[d] ? cal[d].n : 0) });
  }
  return { month: m, today: today, week_starts_on: C.weekStartsOn(ctx.app), days: out };
}

module.exports = { dayOut: dayOut, find: find, ensure: ensure, get: get, mood: mood, note: note, month: month };
