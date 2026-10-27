/// <reference path="../pb_data/types.d.ts" />
/**
 * The areas of life as one map: which areas are on, and for each a pulse
 * worked out from its own data (water today, money left this month, who to
 * call, chores due, the next trip...), its goals and what is open in it.
 * Nothing here is typed by the person: it is read from the area tools.
 */

let u_ = null;
function u() {
  return u_ || (u_ = require(`${__hooks}/lib_util.js`));
}
let core_ = null;
function core() {
  return core_ || (core_ = require(`${__hooks}/lib_core.js`));
}

/** One area's pulse: a short line, a level (good, ok, attention, quiet) and a number to show on the map. */
function pulse(app, kind, today) {
  const util = u();
  const C = core();
  const week0 = C.addDays(today, -6);
  const n = (sql, bind) => util.count(app, sql, bind || {});
  const pr = C.prefs(app);
  if (kind === 'health') {
    const log = util.findOne(app, 'health_logs', 'date = {:d}', { d: today });
    const water = log === null ? 0 : log.getInt('water');
    const moves = n('SELECT COUNT(DISTINCT date) AS n FROM workouts WHERE date >= {:s} AND date <= {:t}', { s: week0, t: today });
    return { line: water + ' of ' + pr.water_goal + ' glasses today, moved on ' + moves + ' of 7 days', level: moves >= 3 ? 'good' : moves >= 1 ? 'ok' : 'quiet', value: moves, unit: 'days moved' };
  }
  if (kind === 'money') {
    const spent = n("SELECT IFNULL(SUM(amount), 0) AS n FROM money_entries WHERE kind = 'spend' AND date >= {:s} AND date <= {:t}", { s: C.monthStart(today), t: today });
    const budget = pr.month_budget;
    const late = require(`${__hooks}/lib_money.js`).billsFor(app, today.slice(0, 7), today).filter((b) => b.late).length;
    if (budget > 0) {
      const left = budget - spent;
      return { line: (left >= 0 ? C.money(app, left) + ' left this month' : C.money(app, -left) + ' over budget') + (late > 0 ? ', ' + late + ' bill' + (late === 1 ? '' : 's') + ' late' : ''), level: left < 0 || late > 0 ? 'attention' : left < budget * 0.15 ? 'ok' : 'good', value: Math.max(0, Math.round((left / budget) * 100)), unit: '% left', money: left };
    }
    return { line: C.money(app, spent) + ' spent this month' + (late > 0 ? ', ' + late + ' bill' + (late === 1 ? '' : 's') + ' late' : ''), level: late > 0 ? 'attention' : spent > 0 ? 'ok' : 'quiet', value: null, unit: '', money: spent };
  }
  if (kind === 'relationships') {
    const P = require(`${__hooks}/lib_people.js`);
    const people = app.findRecordsByFilter('people', 'archived = false', 'rank', 0, 0).map((p) => P.personOut(app, p, today));
    const due = people.filter((p) => p.due);
    const bday = people.filter((p) => p.next_birthday !== null && p.next_birthday.in_days <= 14).sort((a, b) => a.next_birthday.in_days - b.next_birthday.in_days)[0];
    if (people.length === 0) return { line: 'Nobody here yet', level: 'quiet', value: 0, unit: 'people' };
    return { line: (bday ? bday.name + "'s birthday " + (bday.next_birthday.in_days === 0 ? 'today' : 'in ' + bday.next_birthday.in_days + ' days') + '. ' : '') + (due.length > 0 ? due.length + ' to reach out to' : 'Everyone in touch'), level: due.length > 0 || bday ? 'attention' : 'good', value: due.length, unit: 'to reach', people: people.slice(0, 5).map((p) => ({ id: p.id, name: p.name, look: p.look, due: p.due })) };
  }
  if (kind === 'work') {
    const focus = n('SELECT IFNULL(SUM(minutes), 0) AS n FROM focus_sessions WHERE date >= {:s} AND date <= {:t}', { s: C.weekStart(app, today), t: today });
    const wins = n('SELECT COUNT(*) AS n FROM wins WHERE date >= {:s} AND date <= {:t}', { s: C.weekStart(app, today), t: today });
    return { line: Math.round(focus / 6) / 10 + ' h focused this week, ' + wins + ' win' + (wins === 1 ? '' : 's'), level: focus >= 300 ? 'good' : focus > 0 ? 'ok' : 'quiet', value: Math.round(focus / 6) / 10, unit: 'h focus' };
  }
  if (kind === 'home') {
    const H = require(`${__hooks}/lib_house.js`);
    const due = H.choreList({ app: app }).chores.filter((c) => c.due_in <= 0).length;
    const shop = n('SELECT COUNT(*) AS n FROM shopping_items WHERE done = FALSE');
    return { line: (due > 0 ? due + ' chore' + (due === 1 ? '' : 's') + ' due' : 'Chores up to date') + (shop > 0 ? ', ' + shop + ' to buy' : ''), level: due > 2 ? 'attention' : due > 0 ? 'ok' : 'good', value: due, unit: 'due' };
  }
  if (kind === 'growth') {
    const reading = app.findRecordsByFilter('books', "status = 'reading'", 'rank', 1, 0);
    const year = n("SELECT COUNT(*) AS n FROM books WHERE status = 'done' AND substr(finished_on, 1, 4) = {:y}", { y: today.slice(0, 4) });
    return { line: (reading.length > 0 ? 'Reading "' + reading[0].getString('title') + '". ' : '') + year + ' book' + (year === 1 ? '' : 's') + ' read this year', level: reading.length > 0 ? 'good' : year > 0 ? 'ok' : 'quiet', value: year, unit: 'books this year' };
  }
  if (kind === 'fun') {
    const trip = app.findRecordsByFilter('trips', 'start_date >= {:t}', 'start_date', 1, 0, { t: today });
    const done = n("SELECT COUNT(*) AS n FROM bucket_items WHERE done_on != ''");
    const left = n("SELECT COUNT(*) AS n FROM bucket_items WHERE done_on = ''");
    return { line: (trip.length > 0 ? trip[0].getString('title') + ' in ' + C.between(today, trip[0].getString('start_date')) + ' days. ' : '') + done + ' of ' + (done + left) + ' bucket list done', level: trip.length > 0 ? 'good' : done + left > 0 ? 'ok' : 'quiet', value: trip.length > 0 ? C.between(today, trip[0].getString('start_date')) : null, unit: trip.length > 0 ? 'days to go' : '' };
  }
  // mind
  const moods = util.rows(app, 'SELECT mood FROM days WHERE date >= {:s} AND date <= {:t} AND mood > 0', { mood: 0 }, { s: week0, t: today });
  const calm = n('SELECT IFNULL(SUM(mind_min), 0) AS n FROM health_logs WHERE date >= {:s} AND date <= {:t}', { s: week0, t: today });
  const avg = moods.length > 0 ? moods.reduce((a, m) => a + m.mood, 0) / moods.length : null;
  return { line: (avg !== null ? 'Feeling ' + ['rough', 'low', 'okay', 'good', 'great'][Math.round(avg) - 1] + ' lately' : 'No moods noted this week') + ', ' + calm + ' calm minutes', level: avg === null ? 'quiet' : avg >= 3.5 ? 'good' : avg >= 2.5 ? 'ok' : 'attention', value: calm, unit: 'calm min' };
}

/**
 * How an area is going as one number from 0 to 1, read from its own data
 * (null when there is not enough to say). It draws the balance chart.
 */
function score(app, kind, today) {
  const util = u();
  const C = core();
  const week0 = C.addDays(today, -6);
  const n = (sql, bind) => util.count(app, sql, bind || {});
  const clamp = (x) => Math.max(0, Math.min(1, x));
  const pr = C.prefs(app);
  if (kind === 'health') {
    const moves = n('SELECT COUNT(DISTINCT date) AS n FROM workouts WHERE date >= {:s} AND date <= {:t}', { s: week0, t: today });
    const logs = util.rows(app, 'SELECT water, sleep_h FROM health_logs WHERE date >= {:s} AND date <= {:t}', { water: 0, sleep_h: -0 }, { s: week0, t: today });
    if (moves === 0 && logs.length === 0) return null;
    const water = logs.length > 0 ? logs.reduce((a, l) => a + Math.min(1, l.water / Math.max(1, pr.water_goal)), 0) / 7 : 0;
    const slept = logs.filter((l) => l.sleep_h > 0);
    const sleep = slept.length > 0 ? slept.reduce((a, l) => a + Math.min(1, l.sleep_h / Math.max(1, pr.sleep_goal)), 0) / slept.length : 0.5;
    return clamp(0.45 * Math.min(1, moves / 4) + 0.3 * water + 0.25 * sleep);
  }
  if (kind === 'money') {
    if (pr.month_budget <= 0) return null;
    const spent = n("SELECT IFNULL(SUM(amount), 0) AS n FROM money_entries WHERE kind = 'spend' AND date >= {:s} AND date <= {:t}", { s: C.monthStart(today), t: today });
    const days = C.between(C.monthStart(today), C.monthEnd(today)) + 1;
    const gone = (C.between(C.monthStart(today), today) + 1) / days;
    const late = require(`${__hooks}/lib_money.js`).billsFor(app, today.slice(0, 7), today).filter((b) => b.late).length;
    // On pace (spent the share of the month that has gone) is 0.75; under it climbs to 1, over it falls.
    return clamp(0.75 + (gone - spent / pr.month_budget) * 1.5 - 0.15 * late);
  }
  if (kind === 'relationships') {
    const P = require(`${__hooks}/lib_people.js`);
    const people = app.findRecordsByFilter('people', 'archived = false && keep_in_touch_days > 0', 'rank', 0, 0).map((p) => P.personOut(app, p, today));
    if (people.length === 0) return null;
    return people.filter((p) => !p.due).length / people.length;
  }
  if (kind === 'work') {
    const ws = C.weekStart(app, today);
    const focus = n('SELECT IFNULL(SUM(minutes), 0) AS n FROM focus_sessions WHERE date >= {:s} AND date <= {:t}', { s: ws, t: today });
    const wins = n('SELECT COUNT(*) AS n FROM wins WHERE date >= {:s} AND date <= {:t}', { s: week0, t: today });
    const done = n("SELECT COUNT(*) AS n FROM tasks WHERE state = 'done' AND area = 'work' AND done_date >= {:s} AND done_date <= {:t}", { s: week0, t: today });
    if (focus === 0 && wins === 0 && done === 0) return null;
    return clamp(0.6 * Math.min(1, focus / 300) + 0.2 * Math.min(1, wins / 2) + 0.2 * Math.min(1, done / 5));
  }
  if (kind === 'home') {
    const chores = require(`${__hooks}/lib_house.js`).choreList({ app: app }).chores;
    if (chores.length === 0) return null;
    return chores.filter((c) => c.due_in >= 0).length / chores.length;
  }
  if (kind === 'growth') {
    const reading = n("SELECT COUNT(*) AS n FROM books WHERE status = 'reading'");
    const year = n("SELECT COUNT(*) AS n FROM books WHERE status = 'done' AND substr(finished_on, 1, 4) = {:y}", { y: today.slice(0, 4) });
    const practiced = n('SELECT COUNT(*) AS n FROM learning WHERE archived = FALSE AND last_practiced >= {:s}', { s: week0 });
    const learning = n('SELECT COUNT(*) AS n FROM learning WHERE archived = FALSE');
    if (reading === 0 && year === 0 && learning === 0) return null;
    return clamp(0.35 * (reading > 0 ? 1 : 0) + 0.35 * (learning > 0 ? practiced / learning : 0) + 0.3 * Math.min(1, year / 12));
  }
  if (kind === 'fun') {
    const trip = n('SELECT COUNT(*) AS n FROM trips WHERE start_date >= {:t} AND start_date <= {:e}', { t: today, e: C.addDays(today, 90) });
    const done = n("SELECT COUNT(*) AS n FROM bucket_items WHERE done_on != ''");
    const all = n('SELECT COUNT(*) AS n FROM bucket_items');
    if (trip === 0 && all === 0) return null;
    return clamp(0.55 * (trip > 0 ? 1 : 0) + 0.45 * (all > 0 ? done / all : 0));
  }
  // mind
  const moods = util.rows(app, 'SELECT mood FROM days WHERE date >= {:s} AND date <= {:t} AND mood > 0', { mood: 0 }, { s: week0, t: today });
  const calm = n('SELECT IFNULL(SUM(mind_min), 0) AS n FROM health_logs WHERE date >= {:s} AND date <= {:t}', { s: week0, t: today });
  if (moods.length === 0 && calm === 0) return null;
  const avg = moods.length > 0 ? moods.reduce((a, m) => a + m.mood, 0) / moods.length : 3;
  return clamp(0.75 * ((avg - 1) / 4) + 0.25 * Math.min(1, calm / 70));
}

function areaOut(app, a, today) {
  const util = u();
  const kind = a.getString('kind');
  const goals = app.findRecordsByFilter('goals', "area = {:k} && state = 'active'", 'rank', 0, 0, { k: kind });
  return {
    kind: kind,
    name: core().KIND_NAMES[kind],
    enabled: a.getBool('enabled'),
    rank: a.getInt('rank'),
    goals: goals.length,
    goal_progress: goals.length > 0 ? goals.reduce((s, g) => s + g.getFloat('progress'), 0) / goals.length : null,
    open_tasks: util.count(app, "SELECT COUNT(*) AS n FROM tasks WHERE state = 'open' AND area = {:k}", { k: kind }),
    habits: util.count(app, 'SELECT COUNT(*) AS n FROM habits WHERE archived = FALSE AND area = {:k}', { k: kind }),
    pulse: pulse(app, kind, today),
    score: (function (x) {
      return x === null ? null : Math.round(x * 100) / 100;
    })(score(app, kind, today)),
  };
}

/** life.overview: every area (on and off) with its pulse, and the goals across them. */
/** What switching or ordering the parts of life by your AI agent will do. */
function preview(ctx, p) {
  const util = u();
  const C = core();
  if (ctx.op === 'areas.reorder') {
    const list = util.list(p, 'areas') || [];
    return { kind: 'areas', title: 'Put the parts of life in this order', summary: list.map((k) => C.KIND_NAMES[k] || k).join(', '), preview: { areas: list } };
  }
  const k = C.kind(p, 'area', true);
  const on = util.bool(p, 'enabled', true);
  return { kind: 'areas', title: (on ? 'Switch on ' : 'Put away ') + C.KIND_NAMES[k], summary: on ? 'It shows in the sidebar and on My life again.' : 'Its things stay; it leaves the sidebar and My life.', preview: { area: k, enabled: on } };
}

function overview(ctx) {
  const C = core();
  const today = C.today(ctx.app);
  const areas = ctx.app.findRecordsByFilter('areas', '', 'rank', 0, 0).map((a) => areaOut(ctx.app, a, today));
  const G = require(`${__hooks}/lib_goals.js`);
  // What deserves a look: parts flagged now, goals behind pace, chores overdue, bills late.
  const on = areas.filter((a) => a.enabled).map((a) => a.kind);
  const attention = areas.filter((a) => a.enabled && a.pulse.level === 'attention').map((a) => ({ area: a.kind, kind: 'pulse', why: a.name + ': ' + a.pulse.line }));
  const goals = ctx.app.findRecordsByFilter('goals', "state = 'active' || state = 'paused'", 'rank,created', 0, 0).map((g) => G.out(ctx.app, g, false));
  goals.filter((g) => g.pace_state === 'behind' && on.indexOf(g.area) >= 0).forEach((g) => attention.push({ area: g.area, kind: 'goal', id: g.id, why: '"' + g.title + '" is behind pace (' + Math.round(g.progress * 100) + '%)' }));
  if (on.indexOf('home') >= 0)
    require(`${__hooks}/lib_house.js`)
      .choreList(ctx)
      .chores.filter((c) => c.due_in < 0)
      .forEach((c) => attention.push({ area: 'home', kind: 'chore', id: c.id, why: '"' + c.name + '" is overdue by ' + -c.due_in + ' day' + (c.due_in === -1 ? '' : 's') }));
  if (on.indexOf('money') >= 0)
    require(`${__hooks}/lib_money.js`)
      .billsFor(ctx.app, today.slice(0, 7), today)
      .filter((b) => b.late)
      .forEach((b) => attention.push({ area: 'money', kind: 'bill', id: b.id, why: b.name + ' is late' }));
  return { today: today, needs_attention: attention, areas: areas, goals: goals };
}

/** life.area: one area's page (its goals, habits, open tasks, projects and pulse). */
function area(ctx, p) {
  const util = u();
  const C = core();
  const kind = C.kind(p, 'area', true);
  const today = C.today(ctx.app);
  const a = util.findOne(ctx.app, 'areas', 'kind = {:k}', { k: kind });
  const G = require(`${__hooks}/lib_goals.js`);
  const T = require(`${__hooks}/lib_tasks.js`);
  const H = require(`${__hooks}/lib_habits.js`);
  return {
    area: areaOut(ctx.app, a, today),
    goals: ctx.app.findRecordsByFilter('goals', "area = {:k} && (state = 'active' || state = 'paused')", 'rank,created', 0, 0, { k: kind }).map((g) => G.out(ctx.app, g, false)),
    done_goals: ctx.app.findRecordsByFilter('goals', "area = {:k} && state = 'done'", '-done_at', 10, 0, { k: kind }).map((g) => G.out(ctx.app, g, false)),
    habits: H.outMany(ctx.app, ctx.app.findRecordsByFilter('habits', 'area = {:k} && archived = false', 'rank', 0, 0, { k: kind }), today),
    tasks: ctx.app.findRecordsByFilter('tasks', "area = {:k} && state = 'open'", 'do_date,rank,created', 60, 0, { k: kind }).map((t) => T.taskOut(ctx.app, t, today)),
    projects: ctx.app.findRecordsByFilter('projects', "area = {:k} && state = 'active'", 'rank', 0, 0, { k: kind }).map((r) => T.projectOut(ctx.app, r, true)),
    today: today,
  };
}

/** areas.set: switch an area on or off. */
function set(ctx, p) {
  const util = u();
  const C = core();
  const kind = C.kind(p, 'area', true);
  const on = util.bool(p, 'enabled', true);
  ctx.app.runInTransaction((tx) => {
    const a = util.findOne(tx, 'areas', 'kind = {:k}', { k: kind });
    const before = { enabled: a.getBool('enabled') };
    a.set('enabled', on);
    tx.save(a);
    require(`${__hooks}/lib_activity.js`).write(tx, ctx, { label: (on ? 'Switched on ' : 'Switched off ') + C.KIND_NAMES[kind], target: 'areas', record: a.id, undo: { fn: 'lib_rec.undoUpdate', args: { collection: 'areas', id: a.id, fields: before } } });
  });
  return overview(ctx);
}

/** areas.reorder: the areas in a new order (kinds). */
function reorder(ctx, p) {
  const util = u();
  const C = core();
  const kinds = (util.list(p, 'areas') || []).map(String);
  kinds.forEach((k) => {
    if (C.KINDS.indexOf(k) < 0) throw util.fail(400, 'areas are kinds: ' + C.KINDS.join(', '), 'invalid_param', { param: 'areas' });
  });
  ctx.app.runInTransaction((tx) => {
    kinds.forEach((k, i) => {
      const a = util.findOne(tx, 'areas', 'kind = {:k}', { k: k });
      a.set('rank', i + 1);
      tx.save(a);
    });
  });
  return overview(ctx);
}

module.exports = {
  score: score, pulse: pulse, areaOut: areaOut, overview: overview, area: area, set: set, reorder: reorder, preview: preview };
