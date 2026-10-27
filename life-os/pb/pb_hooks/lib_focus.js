/// <reference path="../pb_data/types.d.ts" />
/**
 * Work: focus sessions (the timer on the Work screen logs one when it
 * rings; a session can name the task it was for) and wins, one line each.
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

function sessionOut(app, r) {
  const t = u().byId(app, 'tasks', r.getString('task'));
  return { id: r.id, date: r.getString('date'), minutes: r.getInt('minutes'), task: t === null ? null : { id: t.id, title: t.getString('title') }, note: r.getString('note'), actor: r.getString('actor') };
}

function readSession(ctx, p, r, creating) {
  const util = u();
  const C = core();
  if (creating || util.has(p, 'date')) r.set('date', util.day(p, 'date', C.today(ctx.app)));
  if (creating || util.has(p, 'minutes')) r.set('minutes', util.int(p, 'minutes', 25, 1, 600));
  const task = C.ref(ctx.app, p, 'task', 'tasks', 'task');
  if (task !== undefined) r.set('task', task);
  if (util.has(p, 'note')) r.set('note', util.text(p, 'note', 300, ''));
}

const sessions = rec().crud({
  collection: 'focus_sessions',
  param: 'session',
  one: 'session',
  listKey: 'sessions',
  noun: (r) => 'a ' + r.getInt('minutes') + ' minute focus session',
  fields: ['date', 'minutes', 'task', 'note'],
  read: readSession,
  out: sessionOut,
  sort: '-date,-created',
  where: (ctx, p) => {
    const util = u();
    const C = core();
    const to = util.day(p, 'to', C.today(ctx.app));
    return { filter: 'date >= {:f} && date <= {:t}', bind: { f: util.day(p, 'from', C.addDays(to, -13)), t: to } };
  },
});

/** focus.week: minutes of focus day by day this week, and the total. */
function week(ctx, p) {
  const util = u();
  const C = core();
  const day = util.day(p, 'date', C.today(ctx.app));
  const start = C.weekStart(ctx.app, day);
  const end = C.addDays(start, 6);
  const by = {};
  ctx.app.findRecordsByFilter('focus_sessions', 'date >= {:f} && date <= {:t}', 'date', 0, 0, { f: start, t: end }).forEach((r) => (by[r.getString('date')] = (by[r.getString('date')] || 0) + r.getInt('minutes')));
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = C.addDays(start, i);
    days.push({ date: d, minutes: by[d] || 0 });
  }
  return { week_start: start, days: days, total: days.reduce((a, d) => a + d.minutes, 0), today: by[C.today(ctx.app)] || 0 };
}

function winOut(r) {
  return { id: r.id, text: r.getString('text'), date: r.getString('date'), area: r.getString('area'), actor: r.getString('actor') };
}

function readWin(ctx, p, r, creating) {
  const util = u();
  const C = core();
  if (creating || util.has(p, 'text')) r.set('text', C.name(p, 'text', 300));
  if (creating || util.has(p, 'date')) r.set('date', util.day(p, 'date', C.today(ctx.app)));
  const k = C.kind(p, 'area', false);
  if (k !== undefined) r.set('area', k);
  else if (creating) r.set('area', 'work');
}

const wins = rec().crud({
  collection: 'wins',
  param: 'win',
  one: 'win',
  noun: (r) => 'the win "' + r.getString('text') + '"',
  fields: ['text', 'date', 'area'],
  read: readWin,
  out: (app, r) => winOut(r),
  sort: '-date,-created',
  where: (ctx, p) => {
    const k = core().kind(p, 'area', false) || '';
    return { filter: k !== '' ? 'area = {:a}' : '', bind: { a: k }, limit: u().int(p, 'limit', 50, 1, 500) };
  },
});

module.exports = { sessionList: sessions.list, sessionAdd: sessions.create, sessionRemove: sessions.remove, week: week, winList: wins.list, winAdd: wins.create, winUpdate: wins.update, winRemove: wins.remove };
