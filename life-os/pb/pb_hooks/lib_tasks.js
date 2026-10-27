/// <reference path="../pb_data/types.d.ts" />
/**
 * Tasks are cards on a board whose lists are time: Inbox (no day yet),
 * Today, Coming up (the next seven days), Later (someday, or further off)
 * and Done. A card's list follows from its do date, so moving a card sets
 * the date. A card can carry an area, a goal (its progress shows on the
 * card), a project, a person (finishing "Call Mum" counts as being in touch
 * with Mum), a checklist, a time and a duration, a repeat, and a star (one
 * of today's top three).
 *
 * Projects are journeys of steps (tasks with the project): to do, doing,
 * done, in order.
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

const COLUMNS = ['inbox', 'today', 'coming', 'later', 'done'];
const TOP_CAP = 3;
const FIELDS = ['title', 'notes', 'area', 'project', 'goal', 'person', 'state', 'stage', 'do_date', 'due_date', 'start_time', 'duration_min', 'someday', 'top', 'recurrence', 'series', 'checklist', 'done_at', 'done_date', 'rank'];
const JSON_FIELDS = ['recurrence', 'checklist'];

function columnOf(t, today) {
  if (t.getString('state') === 'done') return 'done';
  const d = t.getString('do_date');
  if (t.getBool('someday')) return 'later';
  if (d === '') return 'inbox';
  if (d <= today) return 'today';
  if (core().between(today, d) <= 7) return 'coming';
  return 'later';
}

function taskOut(app, t, today) {
  const util = u();
  const C = core();
  const gm = C.goalMap(app);
  const pm = C.projectMap(app);
  const people = C.personMap(app);
  const goal = gm[t.getString('goal')] || null;
  const project = pm[t.getString('project')] || null;
  const person = people[t.getString('person')] || null;
  const checklist = util.jsonOf(t, 'checklist') || [];
  const due = t.getString('due_date');
  return {
    id: t.id,
    title: t.getString('title'),
    notes: t.getString('notes'),
    area: t.getString('area'),
    goal: goal === null ? null : { id: goal.id, title: goal.title, progress: goal.progress },
    project: project === null ? null : { id: project.id, title: project.title },
    person: person === null ? null : { id: person.id, name: person.name, look: person.look },
    state: t.getString('state'),
    stage: t.getString('stage') || 'todo',
    column: columnOf(t, today),
    do_date: t.getString('do_date'),
    due_date: due,
    overdue: due !== '' && due < today && t.getString('state') === 'open',
    late: t.getString('do_date') !== '' && t.getString('do_date') < today && t.getString('state') === 'open',
    start_time: t.getString('start_time'),
    duration_min: t.getInt('duration_min'),
    someday: t.getBool('someday'),
    top: t.getBool('top'),
    recurrence: util.jsonOf(t, 'recurrence'),
    checklist: checklist,
    checked: checklist.filter((c) => c.done).length,
    done_at: t.getString('done_at'),
    done_date: t.getString('done_date'),
    rank: t.getFloat('rank'),
    actor: t.getString('actor'),
  };
}

function readRecurrence(p) {
  const util = u();
  if (!util.has(p, 'recurrence')) return undefined;
  if (util.str(p, 'recurrence', '') === '' || util.scalar(p.recurrence) === null) return null;
  const r = util.obj(p, 'recurrence');
  if (r === undefined || r === null) return null;
  util.keysOnly(r, ['every', 'unit', 'weekdays'], 'recurrence');
  const unit = util.choice(r.unit, ['day', 'week', 'month'], 'day', 'recurrence.unit', 'recurrence');
  const every = Number(r.every || 1);
  if (!Number.isInteger(every) || every < 1 || every > 365) throw util.fail(400, 'recurrence.every is a whole number from 1 to 365', 'invalid_param', { param: 'recurrence' });
  const wd = Array.isArray(r.weekdays) ? r.weekdays.map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6) : [];
  return { every: every, unit: unit, weekdays: unit === 'week' ? wd.filter((x, i, a) => a.indexOf(x) === i).sort() : [] };
}

function nextDate(rec0, from) {
  const C = core();
  if (rec0.unit === 'day') return C.addDays(from, rec0.every);
  if (rec0.unit === 'month') return C.addMonths(from, rec0.every);
  if (rec0.weekdays.length > 0) {
    for (let i = 1; i <= 7 * rec0.every + 7; i++) {
      const d = C.addDays(from, i);
      if (rec0.weekdays.indexOf(C.weekday(d)) >= 0 && (rec0.every === 1 || Math.floor(C.between(from, d) / 7) % rec0.every === 0)) return d;
    }
  }
  return C.addDays(from, 7 * rec0.every);
}

function readChecklist(p, existing) {
  const util = u();
  const raw = util.list(p, 'checklist');
  if (raw === undefined) return undefined;
  return raw.slice(0, 100).map((c, i) => {
    const text = util.squash(String(typeof c === 'string' ? c : (c && c.text) || ''));
    if (text === '') throw util.fail(400, 'Checklist line ' + (i + 1) + ' needs text.', 'invalid_param', { param: 'checklist' });
    const old = (existing || []).find((x) => x.text === text);
    return { id: old ? old.id : util.token(8).toLowerCase(), text: text.slice(0, 200), done: old ? old.done : !!(c && c.done) };
  });
}

/** Apply a list (column) to a card: the date follows. */
function placeIn(t, column, today) {
  const C = core();
  if (column === 'today') {
    t.set('do_date', today);
    t.set('someday', false);
  } else if (column === 'coming') {
    const d = t.getString('do_date');
    if (d === '' || d <= today || C.between(today, d) > 7) t.set('do_date', C.addDays(today, 1));
    t.set('someday', false);
  } else if (column === 'later') {
    t.set('do_date', '');
    t.set('someday', true);
    t.set('top', false);
  } else if (column === 'inbox') {
    t.set('do_date', '');
    t.set('someday', false);
    t.set('top', false);
  }
}

function readTask(ctx, p, t, creating) {
  const util = u();
  const C = core();
  const app = ctx.app;
  const today = C.today(app);
  if (creating || util.has(p, 'title')) t.set('title', C.name(p, 'title', 300));
  if (util.has(p, 'notes')) t.set('notes', util.text(p, 'notes', 8000, ''));
  const k = C.kind(p, 'area', false);
  if (k !== undefined) t.set('area', k);
  const project = C.ref(app, p, 'project', 'projects', 'project');
  if (project !== undefined) {
    t.set('project', project);
    if (project !== '' && t.getString('area') === '') t.set('area', app.findRecordById('projects', project).getString('area'));
  }
  const goal = C.ref(app, p, 'goal', 'goals', 'goal');
  if (goal !== undefined) {
    t.set('goal', goal);
    if (goal !== '' && t.getString('area') === '') t.set('area', app.findRecordById('goals', goal).getString('area'));
  }
  const person = C.ref(app, p, 'person', 'people', 'person');
  if (person !== undefined) {
    t.set('person', person);
    if (person !== '' && t.getString('area') === '') t.set('area', require(`${__hooks}/lib_people.js`).AREA_OF[app.findRecordById('people', person).getString('circle')]);
  }
  if (util.has(p, 'column')) placeIn(t, util.oneOf(p, 'column', ['inbox', 'today', 'coming', 'later'], 'inbox'), today);
  if (util.has(p, 'do_date')) {
    t.set('do_date', util.day(p, 'do_date', ''));
    if (t.getString('do_date') !== '') t.set('someday', false);
  }
  if (util.has(p, 'someday')) {
    t.set('someday', util.bool(p, 'someday', false));
    if (t.getBool('someday')) t.set('do_date', '');
  }
  if (util.has(p, 'due_date')) t.set('due_date', util.day(p, 'due_date', ''));
  if (util.has(p, 'start_time')) t.set('start_time', C.time(p, 'start_time', ''));
  if (util.has(p, 'duration_min')) t.set('duration_min', util.int(p, 'duration_min', 0, 0, 1440));
  if (util.has(p, 'stage')) t.set('stage', util.oneOf(p, 'stage', ['todo', 'doing'], 'todo'));
  const recur = readRecurrence(p);
  if (recur !== undefined) {
    t.set('recurrence', recur);
    if (recur !== null && t.getString('series') === '') t.set('series', util.token(10).toLowerCase());
    if (recur !== null && t.getString('do_date') === '') t.set('do_date', today);
  }
  const cl = readChecklist(p, util.jsonOf(t, 'checklist') || []);
  if (cl !== undefined) t.set('checklist', cl);
  if (creating) {
    t.set('state', 'open');
    if (t.getString('stage') === '') t.set('stage', 'todo');
    if ((util.jsonOf(t, 'checklist') || null) === null) t.set('checklist', []);
    t.set('rank', C.nextRank(app, 'tasks'));
  }
  if (util.has(p, 'top')) setTop(app, t, util.bool(p, 'top', false), today);
}

function setTop(app, t, top, today) {
  const util = u();
  if (top) {
    const n = util.count(app, "SELECT COUNT(*) AS n FROM tasks WHERE state = 'open' AND top = TRUE AND id != {:id}", { id: t.id || '' });
    if (n >= TOP_CAP && !t.getBool('top')) throw util.fail(409, 'Today already has its top ' + TOP_CAP + '. Take one off first.', 'top_full');
    if (t.getString('do_date') === '' || t.getString('do_date') > today) t.set('do_date', today);
    t.set('someday', false);
  }
  t.set('top', top);
}

function goalsOf(app, t) {
  const out = [];
  if (t.getString('goal') !== '') out.push(t.getString('goal'));
  const pr = u().byId(app, 'projects', t.getString('project'));
  if (pr !== null && pr.getString('goal') !== '') out.push(pr.getString('goal'));
  return out;
}

function afterTask(app, refs) {
  const G = require(`${__hooks}/lib_goals.js`);
  const ids = [].concat((refs && refs.goals) || [], (refs && refs.before && refs.before.goals) || []).filter((x, i, a) => x && a.indexOf(x) === i);
  ids.forEach((g) => G.recompute(app, g));
}

const crud = rec().crud({
  collection: 'tasks',
  param: 'task',
  one: 'task',
  noun: (r) => '"' + r.getString('title') + '"',
  fields: FIELDS,
  json: JSON_FIELDS,
  read: readTask,
  out: (app, r) => taskOut(app, r, core().today(app)),
  refs: (r) => ({ goals: goalsOf($app, r) }),
  after: afterTask,
  afterName: 'lib_tasks.afterTask',
});

/** tasks.complete: done (or open again). A repeating card makes its next one; a card with a person counts as being in touch. */
function complete(ctx, p) {
  const util = u();
  const C = core();
  const id = util.req(p, 'task');
  const done = util.bool(p, 'done', true);
  let next = null;
  rec().tx(ctx.app, (t) => {
    const r = C.need(t, 'tasks', id, 'task');
    const today = C.today(t);
    const before = rec().snapshot(r, FIELDS, JSON_FIELDS);
    if ((r.getString('state') === 'done') === done) return;
    r.set('state', done ? 'done' : 'open');
    r.set('done_at', done ? util.nowIso() : '');
    r.set('done_date', done ? today : '');
    if (done) r.set('top', r.getBool('top'));
    t.save(r);
    let interaction = '';
    if (done && r.getString('person') !== '') {
      const i = util.newRecord(t, 'interactions');
      i.set('person', r.getString('person'));
      i.set('date', today);
      i.set('kind', 'other');
      i.set('note', r.getString('title').slice(0, 1000));
      i.set('actor', ctx.actor);
      t.save(i);
      require(`${__hooks}/lib_people.js`).refresh(t, { person: r.getString('person') });
      interaction = i.id;
    }
    const recur = util.jsonOf(r, 'recurrence');
    if (done && recur !== null && recur.unit) {
      const n = util.newRecord(t, 'tasks');
      for (const f of FIELDS) n.set(f, r.get(f));
      n.set('checklist', (util.jsonOf(r, 'checklist') || []).map((c) => Object.assign({}, c, { done: false })));
      n.set('recurrence', recur);
      n.set('state', 'open');
      n.set('done_at', '');
      n.set('done_date', '');
      n.set('top', false);
      n.set('do_date', nextDate(recur, r.getString('do_date') || today));
      if (r.getString('due_date') !== '') n.set('due_date', nextDate(recur, r.getString('due_date')));
      n.set('actor', 'system');
      t.save(n);
      next = n.id;
    }
    afterTask(t, { goals: goalsOf(t, r) });
    act().write(t, ctx, { label: (done ? 'Done: "' : 'Opened again: "') + r.getString('title') + '"', target: 'tasks', record: r.id, undo: { fn: 'lib_tasks.undoComplete', args: { task: r.id, fields: before, next: next, interaction: interaction, person: r.getString('person') } } });
  });
  const today = C.today(ctx.app);
  return { task: taskOut(ctx.app, ctx.app.findRecordById('tasks', id), today), next: next === null ? null : taskOut(ctx.app, ctx.app.findRecordById('tasks', next), today) };
}

function undoComplete(ctx, args) {
  const util = u();
  rec().undoUpdate(ctx, { collection: 'tasks', id: args.task, fields: args.fields });
  if (args.next) {
    const n = util.byId(ctx.app, 'tasks', args.next);
    if (n !== null) ctx.app.delete(n);
  }
  if (args.interaction) {
    const i = util.byId(ctx.app, 'interactions', args.interaction);
    if (i !== null) ctx.app.delete(i);
    require(`${__hooks}/lib_people.js`).refresh(ctx.app, { person: args.person });
  }
  const t = util.byId(ctx.app, 'tasks', args.task);
  if (t !== null) afterTask(ctx.app, { goals: goalsOf(ctx.app, t) });
}

/** tasks.move: drop a card in a list (its date follows), in the order given. */
function move(ctx, p) {
  const util = u();
  const C = core();
  const id = util.req(p, 'task');
  const column = util.oneOf(p, 'column', COLUMNS, '');
  if (column === '') throw util.fail(400, 'column is one of ' + COLUMNS.join(', '), 'missing_param', { param: 'column' });
  if (column === 'done') return complete(ctx, { task: id, done: true });
  const order = util.has(p, 'order') ? util.ids(p, 'order', 500) : [];
  rec().tx(ctx.app, (t) => {
    const r = C.need(t, 'tasks', id, 'task');
    const today = C.today(t);
    const before = rec().snapshot(r, FIELDS, JSON_FIELDS);
    if (r.getString('state') === 'done') {
      r.set('state', 'open');
      r.set('done_at', '');
      r.set('done_date', '');
    }
    if (util.has(p, 'do_date')) {
      r.set('do_date', util.day(p, 'do_date', ''));
      r.set('someday', false);
    } else placeIn(r, column, today);
    t.save(r);
    order.forEach((oid, i) => {
      const x = util.byId(t, 'tasks', oid);
      if (x !== null) {
        x.set('rank', i + 1);
        t.saveNoValidate(x);
      }
    });
    act().write(t, ctx, { label: 'Moved "' + r.getString('title') + '" to ' + ({ inbox: 'Inbox', today: 'Today', coming: 'Coming up', later: 'Later' }[column] || column) + (util.has(p, 'do_date') && r.getString('do_date') !== '' ? ' (' + C.words(t, r.getString('do_date')) + ')' : ''), target: 'tasks', record: r.id, undo: { fn: 'lib_rec.undoUpdate', args: { collection: 'tasks', id: r.id, fields: before } } });
  });
  return { task: taskOut(ctx.app, ctx.app.findRecordById('tasks', id), C.today(ctx.app)) };
}

/** tasks.top: star a card as one of today's top three (or not). */
function top(ctx, p) {
  const util = u();
  const C = core();
  const id = util.req(p, 'task');
  rec().tx(ctx.app, (t) => {
    const r = C.need(t, 'tasks', id, 'task');
    const before = rec().snapshot(r, ['top', 'do_date', 'someday']);
    const on = util.bool(p, 'top', !r.getBool('top'));
    setTop(t, r, on, C.today(t));
    t.save(r);
    act().write(t, ctx, { label: (on ? 'Starred "' : 'Unstarred "') + r.getString('title') + '"', target: 'tasks', record: r.id, undo: { fn: 'lib_rec.undoUpdate', args: { collection: 'tasks', id: r.id, fields: before } } });
  });
  return { task: taskOut(ctx.app, ctx.app.findRecordById('tasks', id), C.today(ctx.app)) };
}

/** tasks.check: tick, untick, add or remove a checklist line. */
function check(ctx, p) {
  const util = u();
  const C = core();
  const id = util.req(p, 'task');
  rec().tx(ctx.app, (t) => {
    const r = C.need(t, 'tasks', id, 'task');
    const before = rec().snapshot(r, ['checklist'], ['checklist']);
    let list = util.jsonOf(r, 'checklist') || [];
    const item = util.str(p, 'item', '');
    if (item === '') {
      list.push({ id: util.token(8).toLowerCase(), text: C.name(p, 'text', 200), done: false });
    } else {
      if (!list.some((c) => c.id === item)) throw util.fail(404, 'No checklist line ' + item + '.', 'not_found');
      if (util.bool(p, 'remove', false)) list = list.filter((c) => c.id !== item);
      else
        list = list.map((c) => {
          if (c.id !== item) return c;
          const x = Object.assign({}, c, { done: util.bool(p, 'done', !c.done) });
          if (util.has(p, 'text')) x.text = C.name(p, 'text', 200);
          return x;
        });
    }
    r.set('checklist', list);
    t.save(r);
    act().write(t, ctx, { label: 'Updated the checklist of "' + r.getString('title') + '"', target: 'tasks', record: r.id, undo: { fn: 'lib_rec.undoUpdate', args: { collection: 'tasks', id: r.id, fields: before } } });
  });
  return { task: taskOut(ctx.app, ctx.app.findRecordById('tasks', id), C.today(ctx.app)) };
}

/** tasks.get */
function get(ctx, p) {
  const C = core();
  const t = C.need(ctx.app, 'tasks', u().req(p, 'task'), 'task');
  const o = taskOut(ctx.app, t, C.today(ctx.app));
  o.history = ctx.app.findRecordsByFilter('activity', 'record = {:r}', '-created', 20, 0, { r: t.id }).map((a) => act().out(a));
  return { task: o };
}

/** tasks.list: cards by list or filter (for your AI agent and search). */
function list(ctx, p) {
  const util = u();
  const C = core();
  const today = C.today(ctx.app);
  const column = util.oneOf(p, 'column', COLUMNS.concat(['open', 'all']), 'open');
  const where = [];
  const bind = { today: today, week: C.addDays(today, 7) };
  if (column === 'done') where.push("state = 'done'");
  else if (column !== 'all') where.push("state = 'open'");
  // Steps of a project without a day stay in their project, not the inbox.
  if (column === 'inbox') where.push("do_date = '' && someday = false && project = ''");
  if (column === 'today') where.push("do_date != '' && do_date <= {:today} && someday = false");
  if (column === 'coming') where.push('do_date > {:today} && do_date <= {:week} && someday = false');
  if (column === 'later') where.push('(someday = true || do_date > {:week})');
  for (const f of ['project', 'goal', 'person']) {
    const v = util.str(p, f, '');
    if (v !== '') {
      where.push(f + ' = {:' + f + '}');
      bind[f] = v;
    }
  }
  const area = C.kind(p, 'area', false) || '';
  if (area !== '') {
    where.push('area = {:area}');
    bind.area = area;
  }
  const q = util.str(p, 'q', '');
  if (q !== '') {
    where.push('(title ~ {:q} || notes ~ {:q})');
    bind.q = q;
  }
  const pg = util.page(p, 200, 1000);
  const recs = ctx.app.findRecordsByFilter('tasks', where.join(' && '), column === 'done' ? '-done_date,-done_at' : 'rank,created', pg.limit + 1, pg.offset, bind);
  return { today: today, tasks: recs.slice(0, pg.limit).map((t) => taskOut(ctx.app, t, today)), more: recs.length > pg.limit };
}

/** board.get: the five lists, with what the day holds. */
function board(ctx, p) {
  const util = u();
  const C = core();
  const today = C.today(ctx.app);
  const area = C.kind(p, 'area', false) || '';
  const recs = ctx.app.findRecordsByFilter('tasks', "(state = 'open' || done_date >= {:d})" + (area !== '' ? ' && area = {:a}' : ''), 'rank,created', 0, 0, { d: C.addDays(today, -6), a: area });
  const cols = { inbox: [], today: [], coming: [], later: [], done: [] };
  recs.forEach((t) => {
    const c = columnOf(t, today);
    // Steps of a project without a day stay in their project, not the inbox.
    if (c === 'inbox' && t.getString('project') !== '') return;
    cols[c].push(taskOut(ctx.app, t, today));
  });
  cols.coming.sort((a, b) => (a.do_date < b.do_date ? -1 : a.do_date > b.do_date ? 1 : a.rank - b.rank));
  cols.today.sort((a, b) => (a.top !== b.top ? (a.top ? -1 : 1) : a.start_time !== b.start_time ? (a.start_time === '' ? 1 : b.start_time === '' ? -1 : a.start_time < b.start_time ? -1 : 1) : a.rank - b.rank));
  cols.done.sort((a, b) => (a.done_at < b.done_at ? 1 : -1));
  const weather = require(`${__hooks}/lib_world.js`).byDate(ctx.app);
  const events = util.count(ctx.app, 'SELECT COUNT(*) AS n FROM calendar_events WHERE date = {:t}', { t: today }) + util.count(ctx.app, 'SELECT COUNT(*) AS n FROM events WHERE date = {:t}', { t: today });
  return {
    today: today,
    columns: COLUMNS.map((k) => ({ key: k, tasks: k === 'done' ? cols.done.slice(0, 40) : cols[k] })),
    meta: {
      weather: weather[today] || null,
      planned_min: cols.today.reduce((a, t) => a + t.duration_min, 0),
      events: events,
      top: cols.today.filter((t) => t.top).length,
      top_cap: TOP_CAP,
      done_today: cols.done.filter((t) => t.done_date === today).length,
    },
  };
}

/** board.week: seven days with their cards, events and weather. */
function week(ctx, p) {
  const util = u();
  const C = core();
  const today = C.today(ctx.app);
  // Seven days from a given first day (the next seven by default), or the calendar week around a date.
  const start = util.has(p, 'date') ? C.weekStart(ctx.app, util.day(p, 'date', today)) : util.day(p, 'start', today);
  const end = C.addDays(start, 6);
  const weather = require(`${__hooks}/lib_world.js`).byDate(ctx.app);
  const recs = ctx.app.findRecordsByFilter('tasks', "((state = 'open' && do_date >= {:s} && do_date <= {:e}) || (state = 'done' && done_date >= {:s} && done_date <= {:e}))", 'rank,created', 0, 0, { s: start, e: end });
  const cal = ctx.app.findRecordsByFilter('calendar_events', 'date >= {:s} && date <= {:e}', 'date,start', 0, 0, { s: start, e: end });
  const evs = ctx.app.findRecordsByFilter('events', 'date >= {:s} && date <= {:e}', 'date,time', 0, 0, { s: start, e: end });
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = C.addDays(start, i);
    days.push({
      date: d,
      is_today: d === today,
      past: d < today,
      weather: weather[d] || null,
      tasks: recs.filter((t) => (t.getString('state') === 'done' ? t.getString('done_date') : t.getString('do_date')) === d).map((t) => taskOut(ctx.app, t, today)),
      events: cal
        .filter((e) => e.getString('date') === d)
        .map((e) => ({ id: e.id, title: e.getString('title'), time: e.getBool('all_day') ? '' : String(e.getString('start')).slice(11, 16), source: 'calendar' }))
        .concat(evs.filter((e) => e.getString('date') === d).map((e) => ({ id: e.id, title: e.getString('title'), time: e.getString('time'), source: 'plan' }))),
    });
  }
  const inbox = ctx.app.findRecordsByFilter('tasks', "state = 'open' && do_date = '' && someday = false && project = ''", 'rank,created', 60, 0).map((t) => taskOut(ctx.app, t, today));
  return { week_start: start, week_end: end, today: today, days: days, inbox: inbox };
}

/* ------------------------------------------------------------ projects */

function projectOut(app, pr, withCounts) {
  const util = u();
  const C = core();
  const today = C.today(app);
  const gm = C.goalMap(app);
  const goal = gm[pr.getString('goal')] || null;
  const deadline = pr.getString('deadline');
  const o = {
    id: pr.id,
    title: pr.getString('title'),
    area: pr.getString('area'),
    goal: goal === null ? null : { id: goal.id, title: goal.title, progress: goal.progress },
    state: pr.getString('state'),
    deadline: deadline,
    days_left: deadline === '' ? null : C.between(today, deadline),
    notes: pr.getString('notes'),
    look: pr.getInt('look'),
    rank: pr.getInt('rank'),
    done_at: pr.getString('done_at'),
    actor: pr.getString('actor'),
  };
  if (withCounts) {
    const c = util.one(app, "SELECT IFNULL(SUM(CASE WHEN state = 'open' AND (stage = 'todo' OR stage = '') THEN 1 ELSE 0 END), 0) AS todo, IFNULL(SUM(CASE WHEN state = 'open' AND stage = 'doing' THEN 1 ELSE 0 END), 0) AS doing, IFNULL(SUM(CASE WHEN state = 'done' THEN 1 ELSE 0 END), 0) AS done FROM tasks WHERE project = {:p}", { todo: 0, doing: 0, done: 0 }, { p: pr.id });
    o.counts = { todo: c === null ? 0 : c.todo, doing: c === null ? 0 : c.doing, done: c === null ? 0 : c.done };
    const total = o.counts.todo + o.counts.doing + o.counts.done;
    o.progress = pr.getString('state') === 'done' ? 1 : total > 0 ? o.counts.done / total : 0;
    const next = app.findRecordsByFilter('tasks', "project = {:p} && state = 'open'", '-stage,rank,created', 1, 0, { p: pr.id });
    o.next = next.length > 0 ? { id: next[0].id, title: next[0].getString('title'), stage: next[0].getString('stage') || 'todo' } : null;
    o.steps = app.findRecordsByFilter('tasks', 'project = {:p}', 'rank,created', 60, 0, { p: pr.id }).map((t) => ({ id: t.id, title: t.getString('title'), done: t.getString('state') === 'done', stage: t.getString('stage') || 'todo' }));
  }
  return o;
}

function readProject(ctx, p, pr, creating) {
  const util = u();
  const C = core();
  if (creating || util.has(p, 'title')) pr.set('title', C.name(p, 'title', 200));
  const k = C.kind(p, 'area', false);
  if (k !== undefined) pr.set('area', k);
  const goal = C.ref(ctx.app, p, 'goal', 'goals', 'goal');
  if (goal !== undefined) {
    pr.set('goal', goal);
    if (goal !== '' && pr.getString('area') === '') pr.set('area', ctx.app.findRecordById('goals', goal).getString('area'));
  }
  if (util.has(p, 'deadline')) pr.set('deadline', util.day(p, 'deadline', ''));
  if (util.has(p, 'notes')) pr.set('notes', util.text(p, 'notes', 8000, ''));
  if (util.has(p, 'look')) pr.set('look', util.int(p, 'look', 0, 0, 7));
  else if (creating) pr.set('look', Math.floor(Math.random() * 8));
  if (creating) {
    pr.set('state', 'active');
    pr.set('rank', C.nextRank(ctx.app, 'projects'));
  }
}

const projects = rec().crud({
  collection: 'projects',
  param: 'project',
  one: 'project',
  noun: (r) => 'the project "' + r.getString('title') + '"',
  fields: ['title', 'area', 'goal', 'state', 'deadline', 'notes', 'look', 'rank', 'done_at'],
  read: readProject,
  out: (app, r) => projectOut(app, r, true),
  refs: (r) => ({ goals: r.getString('goal') !== '' ? [r.getString('goal')] : [] }),
  after: afterTask,
  afterName: 'lib_tasks.afterTask',
});

/** projects.list */
function projectList(ctx, p) {
  const util = u();
  const C = core();
  const state = util.oneOf(p, 'state', ['active', 'someday', 'done', 'dropped', 'all'], 'active');
  const area = C.kind(p, 'area', false) || '';
  const where = [];
  const bind = {};
  if (state !== 'all') {
    where.push('state = {:s}');
    bind.s = state;
  }
  if (area !== '') {
    where.push('area = {:a}');
    bind.a = area;
  }
  return { projects: ctx.app.findRecordsByFilter('projects', where.join(' && '), 'rank,created', 0, 0, bind).map((r) => projectOut(ctx.app, r, true)) };
}

/** projects.get: the project with its steps by stage. */
function projectGet(ctx, p) {
  const C = core();
  const pr = C.need(ctx.app, 'projects', u().req(p, 'project'), 'project');
  const today = C.today(ctx.app);
  const o = projectOut(ctx.app, pr, true);
  const tasks = ctx.app.findRecordsByFilter('tasks', 'project = {:p}', 'rank,created', 500, 0, { p: pr.id }).map((t) => taskOut(ctx.app, t, today));
  o.todo = tasks.filter((t) => t.state === 'open' && t.stage !== 'doing');
  o.doing = tasks.filter((t) => t.state === 'open' && t.stage === 'doing');
  o.done = tasks.filter((t) => t.state === 'done').sort((a, b) => (a.done_at < b.done_at ? 1 : -1));
  return { project: o };
}

/** projects.set-state: active, someday, done or dropped. */
function projectSetState(ctx, p) {
  const util = u();
  const C = core();
  const id = util.req(p, 'project');
  const state = util.oneOf(p, 'state', ['active', 'someday', 'done', 'dropped'], '');
  if (state === '') throw util.fail(400, 'state is one of active, someday, done, dropped', 'missing_param', { param: 'state' });
  rec().tx(ctx.app, (t) => {
    const pr = C.need(t, 'projects', id, 'project');
    const before = rec().snapshot(pr, ['state', 'done_at']);
    pr.set('state', state);
    pr.set('done_at', state === 'done' ? pr.getString('done_at') || util.nowIso() : '');
    t.save(pr);
    if (pr.getString('goal') !== '') require(`${__hooks}/lib_goals.js`).recompute(t, pr.getString('goal'));
    act().write(t, ctx, { label: { active: 'Took up ', someday: 'Parked ', done: 'Finished ', dropped: 'Dropped ' }[state] + 'the project "' + pr.getString('title') + '"', target: 'projects', record: pr.id, undo: { fn: 'lib_rec.undoUpdate', args: { collection: 'projects', id: pr.id, fields: before } } });
  });
  return { project: projectOut(ctx.app, ctx.app.findRecordById('projects', id), true) };
}

/** projects.delete: the project goes; its steps stay as cards (or go too with with_tasks). */
function projectRemove(ctx, p) {
  const util = u();
  const C = core();
  const id = util.req(p, 'project');
  const withTasks = util.bool(p, 'with_tasks', false);
  rec().tx(ctx.app, (t) => {
    const pr = C.need(t, 'projects', id, 'project');
    const fields = rec().snapshot(pr, ['title', 'area', 'goal', 'state', 'deadline', 'notes', 'look', 'rank', 'done_at', 'actor']);
    const tasks = t.findRecordsByFilter('tasks', 'project = {:p}', '', 0, 0, { p: id }).map((x) => ({ id: x.id, fields: rec().snapshot(x, FIELDS.concat(['actor']), JSON_FIELDS) }));
    tasks.forEach((x) => {
      const r = t.findRecordById('tasks', x.id);
      if (withTasks) t.delete(r);
      else {
        r.set('project', '');
        t.saveNoValidate(r);
      }
    });
    t.delete(pr);
    act().write(t, ctx, { label: 'Deleted the project "' + fields.title + '"' + (withTasks ? ' and its ' + tasks.length + ' steps' : ''), target: 'projects', record: id, undo: { fn: 'lib_tasks.undoProjectRemove', args: { id: id, fields: fields, tasks: tasks, with_tasks: withTasks } } });
  });
  return { deleted: true };
}

function undoProjectRemove(ctx, args) {
  rec().undoRemove(ctx, { collection: 'projects', id: args.id, fields: args.fields });
  for (const x of args.tasks || []) {
    if (args.with_tasks) rec().undoRemove(ctx, { collection: 'tasks', id: x.id, fields: x.fields });
    else rec().undoUpdate(ctx, { collection: 'tasks', id: x.id, fields: { project: args.id } });
  }
}

/** projects.reorder / tasks.reorder: an order of ids. */
function reorderOf(collection) {
  return function (ctx, p) {
    const util = u();
    const ids = util.ids(p, collection, 500);
    rec().tx(ctx.app, (t) => {
      ids.forEach((id, i) => {
        const r = util.byId(t, collection, id);
        if (r !== null) {
          r.set('rank', i + 1);
          t.saveNoValidate(r);
        }
      });
    });
    return { ok: true };
  };
}

/* -------------------------------------------- a plan for the day (agent) */

function readPlan(p) {
  const util = u();
  const C = core();
  const moves = (util.list(p, 'moves') || []).map((m, i) => {
    util.keysOnly(m, ['task', 'column', 'do_date'], 'Move ' + (i + 1));
    const column = util.choice(m.column, ['inbox', 'today', 'coming', 'later', 'done'], '', 'Move ' + (i + 1) + ' column', 'moves');
    if (column === '' || !m.task) throw util.fail(400, 'Move ' + (i + 1) + ' needs task and column.', 'invalid_param', { param: 'moves' });
    return { task: String(m.task), column: column, do_date: m.do_date ? String(m.do_date) : '' };
  });
  const top = (util.list(p, 'top') || []).map(String);
  const fresh = (util.list(p, 'new_tasks') || []).map((t, i) => {
    util.keysOnly(t, ['title', 'column', 'area', 'goal', 'person', 'do_date', 'duration_min', 'start_time', 'notes'], 'New card ' + (i + 1));
    const title = util.squash(String(t.title || ''));
    if (title === '') throw util.fail(400, 'New card ' + (i + 1) + ' needs a title.', 'invalid_param', { param: 'new_tasks' });
    if (C.hasEmoji(title)) throw util.fail(400, 'New card ' + (i + 1) + ': no emoji.', 'emoji_not_allowed', { param: 'new_tasks' });
    if (t.area !== undefined && C.KINDS.indexOf(String(t.area)) < 0) throw util.fail(400, 'New card ' + (i + 1) + ' area is one of ' + C.KINDS.join(', '), 'invalid_param', { param: 'new_tasks' });
    return Object.assign({}, t, { title: title.slice(0, 300), column: util.choice(t.column, ['inbox', 'today', 'coming', 'later'], 'today', 'New card ' + (i + 1) + ' column', 'new_tasks') });
  });
  const note = util.text(p, 'note', 1200, '');
  if (moves.length + top.length + fresh.length === 0 && note === '') throw util.fail(400, 'A plan needs moves, top, new_tasks or a note.', 'missing_param');
  return { moves: moves, top: top, fresh: fresh, note: note };
}

/** tasks.add-many: several cards in one call (one batch: activity.undo --batch takes them all back). */
function addMany(ctx, p) {
  const util = u();
  const items = util.list(p, 'items') || [];
  if (items.length === 0 || items.length > 20) throw util.fail(400, 'items is a JSON list of 1 to 20 cards, e.g. [{"title":"Call the dentist","column":"coming","do_date":"tomorrow"}]', 'invalid_param', { param: 'items' });
  const keys = ['title', 'notes', 'area', 'project', 'goal', 'person', 'column', 'do_date', 'due_date', 'someday', 'start_time', 'duration_min', 'top'];
  items.forEach((t, i) => {
    if (t === null || typeof t !== 'object' || Array.isArray(t)) throw util.fail(400, 'Card ' + (i + 1) + ' is not an object.', 'invalid_param', { param: 'items' });
    util.keysOnly(t, keys, 'Card ' + (i + 1));
    if (typeof t.title !== 'string' || t.title.trim() === '') throw util.fail(400, 'Card ' + (i + 1) + ' needs a title.', 'invalid_param', { param: 'items' });
  });
  const batch = 'cards_' + util.token(10);
  const made = [];
  rec().tx(ctx.app, (t) => {
    const bctx = Object.assign({}, ctx, { app: t, batch: batch });
    items.forEach((x) => {
      const params = {};
      for (const k of keys) if (x[k] !== undefined && x[k] !== null && x[k] !== '') params[k] = typeof x[k] === 'string' ? x[k] : String(x[k]);
      made.push(crud.create(bctx, params).task.id);
    });
  });
  const today = core().today(ctx.app);
  return { tasks: made.map((id) => taskOut(ctx.app, ctx.app.findRecordById('tasks', id), today)), batch: batch };
}

/** board.plan: a plan for the day in one step (moves, today's stars, new cards, a note on Home). */
function plan(ctx, p) {
  const util = u();
  const pl = readPlan(p);
  const batch = 'pl_' + util.token(10);
  rec().tx(ctx.app, (t) => {
    const bctx = Object.assign({}, ctx, { app: t, batch: batch });
    pl.moves.forEach((m) => move(bctx, m.do_date !== '' ? { task: m.task, column: m.column, do_date: m.do_date } : { task: m.task, column: m.column }));
    pl.fresh.forEach((f) => {
      const params = { title: f.title, column: f.column };
      for (const k of ['area', 'goal', 'person', 'do_date', 'duration_min', 'start_time', 'notes']) if (f[k] !== undefined && f[k] !== '') params[k] = String(f[k]);
      crud.create(bctx, params);
    });
    pl.top.forEach((id) => top(bctx, { task: id, top: true }));
    if (pl.note !== '') require(`${__hooks}/lib_days.js`).note(bctx, { text: pl.note });
  });
  return { ok: true, batch: batch };
}

function planPreview(ctx, p) {
  const util = u();
  const C = core();
  const pl = readPlan(p);
  const title = (id) => {
    const t = util.byId(ctx.app, 'tasks', id);
    return t === null ? 'a card that is gone' : t.getString('title');
  };
  const words = { inbox: 'to Inbox', today: 'to Today', coming: 'to Coming up', later: 'to Later', done: 'to Done' };
  const items = [];
  pl.moves.forEach((m, i) => items.push({ key: 'move:' + i, kind: 'move', label: 'Move', title: title(m.task), detail: m.do_date !== '' ? 'to ' + C.words(ctx.app, m.do_date) : words[m.column] }));
  pl.fresh.forEach((f, i) => {
    const who = f.person ? C.need(ctx.app, 'people', String(f.person), 'person for new card ' + (i + 1)).getString('name') : '';
    items.push({ key: 'new:' + i, kind: 'new', label: 'New card', title: f.title, detail: words[f.column] + (f.area ? ', ' + C.KIND_NAMES[f.area] : '') + (who !== '' ? ', with ' + who : '') });
  });
  pl.top.forEach((id, i) => items.push({ key: 'top:' + i, kind: 'top', label: 'Star', title: title(id), detail: "one of today's top three" }));
  if (pl.note !== '') items.push({ key: 'note', kind: 'note', label: 'Note', title: pl.note, detail: 'on Home' });
  return { kind: 'plan', title: 'A plan for today', summary: items.length + ' change' + (items.length === 1 ? '' : 's'), preview: { items: items, note: pl.note } };
}

function planPick(params, keys) {
  const pickList = (name, prefix) => {
    const raw = params[name];
    const list = raw === undefined ? [] : typeof raw === 'string' ? JSON.parse(raw) : raw;
    return JSON.stringify(list.filter((x, i) => keys.indexOf(prefix + i) >= 0));
  };
  return Object.assign({}, params, { moves: pickList('moves', 'move:'), new_tasks: pickList('new_tasks', 'new:'), top: pickList('top', 'top:'), note: keys.indexOf('note') >= 0 ? params.note || '' : '' });
}

/** Preview of a project change your AI agent proposes. */
function preview(ctx, p) {
  const util = u();
  const op = ctx.op;
  if (op === 'projects.create') return { kind: 'project', title: 'New project: ' + util.text(p, 'title', 200, ''), summary: p.area ? 'In ' + core().KIND_NAMES[String(p.area)] : '', preview: { fields: p } };
  const pr = core().need(ctx.app, 'projects', util.req(p, 'project'), 'project');
  if (op === 'projects.delete') return { kind: 'project', title: 'Delete the project "' + pr.getString('title') + '"', summary: util.bool(p, 'with_tasks', false) ? 'Its steps go too.' : 'Its steps stay as cards.', preview: {}, target: { collection: 'projects', id: pr.id } };
  const changes = {};
  for (const k of Object.keys(p)) if (k !== 'project') changes[k] = { from: pr.get(k), to: p[k] };
  return { kind: 'project', title: 'Change the project "' + pr.getString('title') + '"', summary: Object.keys(changes).join(', '), preview: { changes: JSON.parse(JSON.stringify(changes)) }, target: { collection: 'projects', id: pr.id } };
}

module.exports = {
  addMany: addMany,
  COLUMNS: COLUMNS,
  columnOf: columnOf,
  taskOut: taskOut,
  afterTask: afterTask,
  create: crud.create,
  update: crud.update,
  remove: crud.remove,
  complete: complete,
  undoComplete: undoComplete,
  move: move,
  top: top,
  check: check,
  get: get,
  list: list,
  board: board,
  week: week,
  reorder: reorderOf('tasks'),
  projectOut: projectOut,
  projectList: projectList,
  projectGet: projectGet,
  projectCreate: projects.create,
  projectUpdate: projects.update,
  projectSetState: projectSetState,
  projectRemove: projectRemove,
  undoProjectRemove: undoProjectRemove,
  projectReorder: reorderOf('projects'),
  plan: plan,
  planPreview: planPreview,
  planPick: planPick,
  preview: preview,
};
