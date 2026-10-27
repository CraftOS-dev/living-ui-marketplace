/// <reference path="../pb_data/types.d.ts" />
/**
 * Goals live inside an area of life and, wherever they can, measure
 * themselves from that area's own data, so nobody types progress:
 *
 *   pot        a savings pot: saved of target (money)
 *   books      books finished since the goal started (growth)
 *   weight     the latest weigh-in, from where it started to the target (health)
 *   habits     how often the goal's habits were done in the last 30 days
 *   tasks      the goal's tasks (and its projects' tasks) done
 *   milestones ticked off by hand
 *   number_up / number_down   check-ins (the latest value counts)
 *   none       done or not
 *
 * Pace: with a start and a deadline, where it would be by today on a steady
 * line; ahead / on track / behind within a tenth.
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

const STATES = ['active', 'paused', 'done', 'dropped'];
const MEASURES = ['number_up', 'number_down', 'milestones', 'tasks', 'habits', 'pot', 'books', 'weight', 'none'];

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function milestonesOf(g) {
  const list = u().jsonOf(g, 'milestones');
  return Array.isArray(list) ? list : [];
}

/** Work out progress, current and pace for one goal and save them. */
function recompute(app, goalId) {
  const util = u();
  const C = core();
  if (typeof goalId !== 'string' || goalId === '') return;
  const g = util.byId(app, 'goals', goalId);
  if (g === null) return;
  const today = C.today(app);
  const measure = g.getString('measure');
  const start = g.getString('start_date') || String(g.getString('created')).slice(0, 10);
  let progress = 0;
  let last = '';
  const later = (d) => {
    if (typeof d === 'string' && d.length >= 10 && d.slice(0, 10) > last) last = d.slice(0, 10);
  };
  if (measure === 'number_up' || measure === 'number_down') {
    const ck = app.findRecordsByFilter('goal_checkins', 'goal = {:g}', 'date,created', 0, 0, { g: g.id });
    ck.forEach((c) => later(c.getString('date')));
    const base = g.getFloat('baseline');
    const target = g.getFloat('target');
    const current = ck.length > 0 ? ck[ck.length - 1].getFloat('value') : base;
    g.set('current', current);
    if (target === base) progress = current === target ? 1 : 0;
    else progress = measure === 'number_up' ? (current - base) / (target - base) : (base - current) / (base - target);
  } else if (measure === 'milestones') {
    const ms = milestonesOf(g);
    ms.forEach((m) => m.done && later(String(m.done_at || '')));
    progress = ms.length > 0 ? ms.filter((m) => m.done === true).length / ms.length : 0;
    g.set('current', ms.filter((m) => m.done === true).length);
  } else if (measure === 'tasks') {
    const r = util.one(app, "SELECT IFNULL(SUM(CASE WHEN state = 'done' THEN 1 ELSE 0 END), 0) AS done, COUNT(*) AS total, IFNULL(MAX(done_date), '') AS last FROM tasks WHERE goal = {:g} OR project IN (SELECT id FROM projects WHERE goal = {:g})", { done: 0, total: 0, last: '' }, { g: g.id });
    progress = r !== null && r.total > 0 ? r.done / r.total : 0;
    g.set('current', r === null ? 0 : r.done);
    if (r !== null) later(r.last);
  } else if (measure === 'habits') {
    const ids = app.findRecordsByFilter('habits', 'goal = {:g} && archived = false', '', 0, 0, { g: g.id }).map((h) => h.id);
    const rate = require(`${__hooks}/lib_habits.js`).rateOf(app, ids);
    progress = rate === null ? 0 : rate;
    g.set('current', Math.round(progress * 100));
    const h = util.one(app, "SELECT IFNULL(MAX(l.date), '') AS last FROM habit_logs l JOIN habits h ON h.id = l.habit WHERE h.goal = {:g} AND l.state = 'done'", { last: '' }, { g: g.id });
    if (h !== null) later(h.last);
  } else if (measure === 'pot') {
    const pot = util.byId(app, 'money_pots', g.getString('pot'));
    if (pot !== null) {
      g.set('target', pot.getInt('target'));
      g.set('current', pot.getInt('saved'));
      progress = pot.getInt('target') > 0 ? pot.getInt('saved') / pot.getInt('target') : 0;
      later(String(pot.getString('updated')).slice(0, 10));
    }
  } else if (measure === 'books') {
    const end = g.getString('deadline') || '9999-12-31';
    const n = util.count(app, "SELECT COUNT(*) AS n FROM books WHERE status = 'done' AND finished_on >= {:s} AND finished_on <= {:e}", { s: start, e: end });
    const lastBook = util.one(app, "SELECT IFNULL(MAX(finished_on), '') AS d FROM books WHERE status = 'done'", { d: '' }, {});
    if (lastBook !== null) later(lastBook.d);
    g.set('current', n);
    progress = g.getFloat('target') > 0 ? n / g.getFloat('target') : 0;
  } else if (measure === 'weight') {
    const lw = require(`${__hooks}/lib_health.js`).lastWeight(app, today);
    const base = g.getFloat('baseline');
    const target = g.getFloat('target');
    const current = lw === null ? base : lw.weight;
    if (lw !== null) later(lw.date);
    g.set('current', current);
    progress = target === base ? (current === target ? 1 : 0) : target < base ? (base - current) / (base - target) : (current - base) / (target - base);
  } else {
    progress = g.getString('state') === 'done' ? 1 : 0;
  }
  if (g.getString('state') === 'done') progress = Math.max(progress, measure === 'none' ? 1 : progress);
  progress = clamp01(progress);
  g.set('progress', Math.round(progress * 10000) / 10000);
  const deadline = g.getString('deadline');
  let pace = null;
  let st = 'none';
  if (g.getString('state') === 'done' || progress >= 1) st = 'done';
  else if (deadline !== '' && C.between(start, deadline) > 0 && measure !== 'none' && measure !== 'habits') {
    pace = clamp01(C.between(start, today) / C.between(start, deadline));
    const diff = progress - pace;
    st = diff >= 0.1 ? 'ahead' : diff >= -0.1 ? 'on_track' : 'behind';
  }
  g.set('pace', pace === null ? 0 : Math.round(pace * 10000) / 10000);
  g.set('pace_state', st);
  if (last === '') last = start;
  g.set('last_activity', last);
  app.saveNoValidate(g);
}

/** Recompute every live goal measured one way (a pot, books, weight changed). */
function recomputeMeasure(app, measure) {
  app.findRecordsByFilter('goals', "measure = {:m} && state != 'dropped'", '', 0, 0, { m: measure }).forEach((g) => recompute(app, g.id));
}

/** The day job: pace moves with the calendar. */
function recomputeAll(app) {
  app.findRecordsByFilter('goals', "state = 'active'", '', 0, 0).forEach((g) => recompute(app, g.id));
}

const SOURCE = {
  pot: (app, g) => {
    const pot = u().byId(app, 'money_pots', g.getString('pot'));
    return pot === null ? 'Its savings pot is gone' : 'From the "' + pot.getString('name') + '" pot';
  },
  books: () => 'Books you finish count by themselves',
  weight: () => 'Your weigh-ins count by themselves',
  habits: () => 'How often its habits are done (30 days)',
  tasks: () => 'Its tasks and steps done',
  milestones: () => 'Milestones ticked',
  number_up: () => 'Your check-ins',
  number_down: () => 'Your check-ins',
  none: () => 'Done or not',
};

function out(app, g, withLinks) {
  const util = u();
  const C = core();
  const today = C.today(app);
  const deadline = g.getString('deadline');
  const pot = g.getString('pot') !== '' ? util.byId(app, 'money_pots', g.getString('pot')) : null;
  const o = {
    id: g.id,
    title: g.getString('title'),
    area: g.getString('area'),
    state: g.getString('state'),
    measure: g.getString('measure'),
    unit: g.getString('unit'),
    baseline: g.getFloat('baseline'),
    target: g.getFloat('target'),
    current: g.getFloat('current'),
    pot: pot === null ? null : { id: pot.id, name: pot.getString('name'), saved: pot.getInt('saved'), target: pot.getInt('target') },
    milestones: milestonesOf(g),
    start_date: g.getString('start_date'),
    deadline: deadline,
    days_left: deadline === '' ? null : C.between(today, deadline),
    purpose: g.getString('purpose'),
    progress: g.getFloat('progress'),
    pace: g.getString('pace_state') === 'none' ? null : g.getFloat('pace'),
    pace_state: g.getString('pace_state') || 'none',
    last_activity: g.getString('last_activity'),
    done_at: g.getString('done_at'),
    source: (SOURCE[g.getString('measure')] || SOURCE.none)(app, g),
    rank: g.getInt('rank'),
    actor: g.getString('actor'),
  };
  if (withLinks) {
    const T = require(`${__hooks}/lib_tasks.js`);
    o.tasks = app.findRecordsByFilter('tasks', "goal = {:g} && state = 'open'", 'do_date,rank', 50, 0, { g: g.id }).map((t) => T.taskOut(app, t, today));
    o.done_tasks = util.count(app, "SELECT COUNT(*) AS n FROM tasks WHERE goal = {:g} AND state = 'done'", { g: g.id });
    o.habits = require(`${__hooks}/lib_habits.js`).outMany(app, app.findRecordsByFilter('habits', 'goal = {:g} && archived = false', 'rank', 0, 0, { g: g.id }), today);
    o.projects = app.findRecordsByFilter('projects', "goal = {:g} && state != 'dropped'", 'rank', 0, 0, { g: g.id }).map((p) => T.projectOut(app, p, true));
    o.checkins = app.findRecordsByFilter('goal_checkins', 'goal = {:g}', '-date,-created', 60, 0, { g: g.id }).map((c) => ({ id: c.id, date: c.getString('date'), value: c.getFloat('value'), note: c.getString('note'), actor: c.getString('actor') }));
  }
  return o;
}

/** goals.list: goals, by area (all areas by default). */
function list(ctx, p) {
  const util = u();
  const C = core();
  const area = C.kind(p, 'area', false) || '';
  const state = util.oneOf(p, 'state', STATES.concat(['live', 'all']), 'live');
  const where = [];
  const bind = {};
  if (area !== '') {
    where.push('area = {:a}');
    bind.a = area;
  }
  if (state === 'live') where.push("(state = 'active' || state = 'paused')");
  else if (state !== 'all') {
    where.push('state = {:s}');
    bind.s = state;
  }
  return { goals: ctx.app.findRecordsByFilter('goals', where.join(' && '), 'rank,created', 0, 0, bind).map((g) => out(ctx.app, g, false)) };
}

/** goals.get: one goal with its tasks, habits, projects and check-ins. */
function get(ctx, p) {
  const g = core().need(ctx.app, 'goals', u().req(p, 'goal'), 'goal');
  return { goal: out(ctx.app, g, true) };
}

function readMilestones(p, existing) {
  const util = u();
  const raw = util.list(p, 'milestones');
  if (raw === undefined) return undefined;
  return raw.slice(0, 50).map((m, i) => {
    const text = util.squash(String(typeof m === 'string' ? m : (m && m.text) || ''));
    if (text === '') throw util.fail(400, 'Milestone ' + (i + 1) + ' needs text.', 'invalid_param', { param: 'milestones' });
    const old = (existing || []).find((x) => x.text === text);
    return { id: old ? old.id : util.token(8).toLowerCase(), text: text.slice(0, 200), done: old ? old.done : m && m.done === true, done_at: old ? old.done_at : '' };
  });
}

function readGoal(ctx, p, g, creating) {
  const util = u();
  const C = core();
  const app = ctx.app;
  if (creating || util.has(p, 'title')) g.set('title', C.name(p, 'title', 200));
  if (creating) sameGoal(app, g.getString('title'));
  const k = C.kind(p, 'area', creating);
  if (k !== undefined) g.set('area', k);
  if (creating || util.has(p, 'measure')) g.set('measure', util.oneOf(p, 'measure', MEASURES, creating ? 'none' : g.getString('measure')));
  const measure = g.getString('measure');
  if (util.has(p, 'unit')) g.set('unit', C.name(p, 'unit', 30, ''));
  if (measure === 'pot') {
    const t = C.amount(app, p, 'target', false);
    let potId = C.ref(app, p, 'pot', 'money_pots', 'pot');
    if ((potId === undefined || potId === '') && g.getString('pot') === '') {
      // A money goal without a pot gets its own, named after the goal.
      const pot = util.newRecord(app, 'money_pots');
      pot.set('name', g.getString('title').slice(0, 80));
      pot.set('target', t === undefined ? 0 : t);
      pot.set('saved', C.amount(app, p, 'baseline', false) || 0);
      pot.set('look', Math.floor(Math.random() * 8));
      pot.set('rank', C.nextRank(app, 'money_pots'));
      pot.set('actor', ctx.actor);
      app.save(pot);
      potId = pot.id;
    } else if (t !== undefined && potId !== undefined && potId !== '') {
      const pot = app.findRecordById('money_pots', potId);
      pot.set('target', t);
      app.save(pot);
    }
    if (potId !== undefined && potId !== '') g.set('pot', potId);
  } else {
    if (util.has(p, 'baseline')) g.set('baseline', util.num(p, 'baseline', 0, -1e12, 1e12));
    if (util.has(p, 'target')) g.set('target', util.num(p, 'target', 0, -1e12, 1e12));
    if (measure === 'weight' && creating && !util.has(p, 'baseline')) {
      const lw = require(`${__hooks}/lib_health.js`).lastWeight(app, C.today(app));
      g.set('baseline', lw === null ? 0 : lw.weight);
    }
    if (measure === 'books' && creating && !util.has(p, 'target')) g.set('target', 12);
  }
  const ms = readMilestones(p, milestonesOf(g));
  if (ms !== undefined) g.set('milestones', ms);
  if (creating || util.has(p, 'start_date')) g.set('start_date', util.day(p, 'start_date', measure === 'books' && creating ? C.today(app).slice(0, 4) + '-01-01' : C.today(app)));
  if (util.has(p, 'deadline')) g.set('deadline', util.day(p, 'deadline', ''));
  if (util.has(p, 'purpose')) g.set('purpose', util.text(p, 'purpose', 1000, ''));
  if (creating) {
    g.set('state', 'active');
    g.set('rank', C.nextRank(app, 'goals'));
  }
}

const crud = rec().crud({
  collection: 'goals',
  param: 'goal',
  one: 'goal',
  noun: (r) => 'the goal "' + r.getString('title') + '"',
  fields: ['title', 'area', 'state', 'measure', 'unit', 'baseline', 'target', 'current', 'pot', 'milestones', 'start_date', 'deadline', 'purpose', 'rank', 'done_at'],
  json: ['milestones'],
  read: readGoal,
  out: (app, r) => out(app, r, false),
  refs: (r) => ({ goal: r.id }),
  after: (app, refs) => recompute(app, refs.goal),
  afterName: 'lib_goals.afterUndo',
});

function afterUndo(app, refs) {
  if (refs && refs.goal) recompute(app, refs.goal);
}

/** goals.set-state: active, paused, done (celebrated) or dropped. */
function setState(ctx, p) {
  const util = u();
  const C = core();
  const id = util.req(p, 'goal');
  const state = util.oneOf(p, 'state', STATES, '');
  if (state === '') throw util.fail(400, 'state is one of ' + STATES.join(', '), 'missing_param', { param: 'state' });
  rec().tx(ctx.app, (t) => {
    const g = C.need(t, 'goals', id, 'goal');
    const before = rec().snapshot(g, ['state', 'done_at']);
    g.set('state', state);
    g.set('done_at', state === 'done' ? g.getString('done_at') || util.nowIso() : '');
    t.save(g);
    recompute(t, g.id);
    act().write(t, ctx, { label: { active: 'Took up ', paused: 'Paused ', done: 'Reached ', dropped: 'Let go of ' }[state] + 'the goal "' + g.getString('title') + '"', target: 'goals', record: g.id, undo: { fn: 'lib_rec.undoUpdate', args: { collection: 'goals', id: g.id, fields: before, after: 'lib_goals.afterUndo', refs: { goal: g.id } } } });
  });
  return { goal: out(ctx.app, ctx.app.findRecordById('goals', id), false) };
}

/** goals.checkin: a number for a number goal (the latest counts). */
function checkin(ctx, p) {
  const util = u();
  const C = core();
  const id = util.req(p, 'goal');
  rec().tx(ctx.app, (t) => {
    const g = C.need(t, 'goals', id, 'goal');
    if (['number_up', 'number_down'].indexOf(g.getString('measure')) < 0) throw util.fail(409, 'This goal measures itself (' + g.getString('measure') + '); check-ins are for number goals.', 'invalid_state');
    const c = util.newRecord(t, 'goal_checkins');
    c.set('goal', g.id);
    c.set('date', util.day(p, 'date', C.today(t)));
    c.set('value', util.num(p, 'value', NaN, -1e12, 1e12));
    if (!Number.isFinite(c.getFloat('value')) || !util.has(p, 'value')) throw util.fail(400, 'value is required', 'missing_param', { param: 'value' });
    c.set('note', util.text(p, 'note', 500, ''));
    c.set('actor', ctx.actor);
    t.save(c);
    recompute(t, g.id);
    act().write(t, ctx, { label: 'Checked in ' + c.getFloat('value') + (g.getString('unit') !== '' ? ' ' + g.getString('unit') : '') + ' on "' + g.getString('title') + '"', target: 'goal_checkins', record: c.id, undo: { fn: 'lib_rec.undoCreate', args: { collection: 'goal_checkins', id: c.id, after: 'lib_goals.afterUndo', refs: { goal: g.id } } } });
  });
  return { goal: out(ctx.app, ctx.app.findRecordById('goals', id), false) };
}

/** goals.uncheckin: take a check-in back. */
function uncheckin(ctx, p) {
  const util = u();
  const C = core();
  const c0 = C.need(ctx.app, 'goal_checkins', util.req(p, 'checkin'), 'check-in');
  const goal = c0.getString('goal');
  rec().tx(ctx.app, (t) => {
    const c = t.findRecordById('goal_checkins', c0.id);
    const fields = rec().snapshot(c, ['goal', 'date', 'value', 'note', 'actor']);
    t.delete(c);
    recompute(t, goal);
    act().write(t, ctx, { label: 'Took back a check-in', target: 'goal_checkins', record: c0.id, undo: { fn: 'lib_rec.undoRemove', args: { collection: 'goal_checkins', id: c0.id, fields: fields, after: 'lib_goals.afterUndo', refs: { goal: goal } } } });
  });
  return { goal: out(ctx.app, ctx.app.findRecordById('goals', goal), false) };
}

/** goals.milestone: add a milestone, tick or untick one, or remove one. */
function milestone(ctx, p) {
  const util = u();
  const C = core();
  const id = util.req(p, 'goal');
  rec().tx(ctx.app, (t) => {
    const g = C.need(t, 'goals', id, 'goal');
    const before = rec().snapshot(g, ['milestones'], ['milestones']);
    let ms = milestonesOf(g);
    const item = util.str(p, 'item', '');
    let label;
    if (item === '') {
      const text = C.name(p, 'text', 200);
      ms.push({ id: util.token(8).toLowerCase(), text: text, done: false, done_at: '' });
      label = 'Added the milestone "' + text + '"';
    } else {
      const m = ms.find((x) => x.id === item);
      if (!m) throw util.fail(404, 'No milestone ' + item + ' on this goal.', 'not_found');
      if (util.bool(p, 'remove', false)) {
        ms = ms.filter((x) => x.id !== item);
        label = 'Removed the milestone "' + m.text + '"';
      } else {
        const done = util.bool(p, 'done', !m.done);
        ms = ms.map((x) => (x.id === item ? Object.assign({}, x, { done: done, done_at: done ? C.today(t) : '' }) : x));
        label = (done ? 'Reached ' : 'Reopened ') + '"' + m.text + '"';
      }
    }
    g.set('milestones', ms);
    t.save(g);
    recompute(t, g.id);
    act().write(t, ctx, { label: label, target: 'goals', record: g.id, undo: { fn: 'lib_rec.undoUpdate', args: { collection: 'goals', id: g.id, fields: before, after: 'lib_goals.afterUndo', refs: { goal: g.id } } } });
  });
  return { goal: out(ctx.app, ctx.app.findRecordById('goals', id), false) };
}

/** goals.delete: the goal goes; its tasks, habits and projects stay, unlinked. */
function remove(ctx, p) {
  const util = u();
  const C = core();
  const id = util.req(p, 'goal');
  rec().tx(ctx.app, (t) => {
    const g = C.need(t, 'goals', id, 'goal');
    const fields = rec().snapshot(g, ['title', 'area', 'state', 'measure', 'unit', 'baseline', 'target', 'current', 'pot', 'milestones', 'start_date', 'deadline', 'purpose', 'progress', 'pace', 'pace_state', 'last_activity', 'rank', 'done_at', 'actor'], ['milestones']);
    const links = { tasks: [], habits: [], projects: [] };
    for (const col of ['tasks', 'habits', 'projects']) {
      t.findRecordsByFilter(col, 'goal = {:g}', '', 0, 0, { g: g.id }).forEach((r) => {
        links[col].push(r.id);
        r.set('goal', '');
        t.saveNoValidate(r);
      });
    }
    const checkins = t.findRecordsByFilter('goal_checkins', 'goal = {:g}', '', 0, 0, { g: g.id }).map((c) => ({ id: c.id, fields: rec().snapshot(c, ['date', 'value', 'note', 'actor']) }));
    t.delete(g);
    act().write(t, ctx, { label: 'Deleted the goal "' + fields.title + '"', target: 'goals', record: id, undo: { fn: 'lib_goals.undoRemove', args: { id: id, fields: fields, links: links, checkins: checkins } } });
  });
  return { deleted: true };
}

function undoRemove(ctx, args) {
  const util = u();
  rec().undoRemove(ctx, { collection: 'goals', id: args.id, fields: args.fields });
  for (const c of args.checkins || []) rec().undoRemove(ctx, { collection: 'goal_checkins', id: c.id, fields: Object.assign({ goal: args.id }, c.fields) });
  for (const col of ['tasks', 'habits', 'projects']) {
    for (const rid of (args.links || {})[col] || []) {
      const r = util.byId(ctx.app, col, rid);
      if (r !== null) {
        r.set('goal', args.id);
        ctx.app.saveNoValidate(r);
      }
    }
  }
  recompute(ctx.app, args.id);
}

/* --------------------------------------------- breakdown (your AI agent) */

const ITEM_KINDS = ['task', 'habit', 'milestone', 'project'];

function readItems(p) {
  const util = u();
  const raw = util.list(p, 'items') || [];
  if (raw.length === 0) throw util.fail(400, 'items is a JSON list, e.g. [{"kind":"task","title":"Find a running plan"},{"kind":"habit","title":"Run","schedule":"per_week","times":3,"art":"run"}]', 'missing_param', { param: 'items' });
  if (raw.length > 40) throw util.fail(400, 'At most 40 items at once.', 'too_many');
  return raw.map((it, i) => {
    util.keysOnly(it, ['kind', 'title', 'do_date', 'schedule', 'times', 'days', 'target', 'unit', 'art', 'cue', 'time_of_day', 'notes'], 'Item ' + (i + 1));
    const kind = util.choice(it.kind, ITEM_KINDS, '', 'Item ' + (i + 1) + ' kind', 'items');
    if (kind === '') throw util.fail(400, 'Item ' + (i + 1) + ' needs a kind: ' + ITEM_KINDS.join(', '), 'invalid_param', { param: 'items' });
    const title = util.squash(String(it.title || ''));
    if (title === '') throw util.fail(400, 'Item ' + (i + 1) + ' needs a title.', 'invalid_param', { param: 'items' });
    if (core().hasEmoji(title)) throw util.fail(400, 'Item ' + (i + 1) + ': no emoji in titles.', 'emoji_not_allowed', { param: 'items' });
    if (it.art !== undefined && core().HABIT_ARTS.indexOf(String(it.art)) < 0) throw util.fail(400, 'Item ' + (i + 1) + ' art must be one of: ' + core().HABIT_ARTS.join(', '), 'invalid_param', { param: 'items' });
    return Object.assign({}, it, { kind: kind, title: title.slice(0, 200) });
  });
}

/** goals.breakdown: first steps for a goal (tasks, habits, milestones, a project) in one go. */
function breakdown(ctx, p) {
  const util = u();
  const C = core();
  const g = C.need(ctx.app, 'goals', util.req(p, 'goal'), 'goal');
  const items = readItems(p);
  const batch = 'bd_' + util.token(10);
  const made = [];
  rec().tx(ctx.app, (t) => {
    const bctx = Object.assign({}, ctx, { app: t, batch: batch });
    const T = require(`${__hooks}/lib_tasks.js`);
    const H = require(`${__hooks}/lib_habits.js`);
    items.forEach((it) => {
      if (it.kind === 'task') {
        const r = T.create(bctx, { title: it.title, goal: g.id, area: g.getString('area'), do_date: it.do_date ? String(it.do_date) : '', notes: it.notes ? String(it.notes) : '' });
        made.push({ kind: 'task', id: r.task.id, title: it.title });
      } else if (it.kind === 'habit') {
        const params = { name: it.title, goal: g.id, area: g.getString('area'), schedule: it.schedule || 'daily', art: it.art || 'sprout' };
        for (const k of ['times', 'target', 'unit', 'cue', 'time_of_day']) if (it[k] !== undefined) params[k] = String(it[k]);
        if (it.days !== undefined) params.days = JSON.stringify(it.days);
        const r = H.create(bctx, params);
        made.push({ kind: 'habit', id: r.habit.id, title: it.title });
      } else if (it.kind === 'project') {
        const r = T.projectCreate(bctx, { title: it.title, goal: g.id, area: g.getString('area') });
        made.push({ kind: 'project', id: r.project.id, title: it.title });
      } else {
        milestone(bctx, { goal: g.id, text: it.title });
        made.push({ kind: 'milestone', title: it.title });
      }
    });
  });
  return { made: made, batch: batch, goal: out(ctx.app, ctx.app.findRecordById('goals', g.id), false) };
}

function breakdownPreview(ctx, p) {
  const util = u();
  const g = core().need(ctx.app, 'goals', util.req(p, 'goal'), 'goal');
  const items = readItems(p);
  const words = { task: 'Task', habit: 'Habit', milestone: 'Milestone', project: 'Project' };
  return {
    kind: 'breakdown',
    title: 'First steps for "' + g.getString('title') + '"',
    summary: items.length + ' step' + (items.length === 1 ? '' : 's'),
    preview: { goal: { id: g.id, title: g.getString('title') }, items: items.map((it, i) => ({ key: String(i), kind: it.kind, label: words[it.kind], title: it.title, detail: it.kind === 'habit' ? (it.schedule === 'per_week' ? (it.times || 3) + ' times a week' : it.schedule === 'weekdays' ? 'some weekdays' : 'every day') : it.kind === 'task' && it.do_date ? 'on ' + it.do_date : '' })) },
    target: { collection: 'goals', id: g.id },
  };
}

/** Keep only the items a person ticked (Apply selected). */
function breakdownPick(params, keys) {
  const items = JSON.parse(typeof params.items === 'string' ? params.items : JSON.stringify(params.items || []));
  return Object.assign({}, params, { items: JSON.stringify(items.filter((it, i) => keys.indexOf(String(i)) >= 0)) });
}

/** Preview of a goal change your AI agent proposes. */
/** An active or paused goal with the same title is the same goal: refuse a second one. */
function sameGoal(app, title) {
  const util = u();
  const x = util.rows(app, "SELECT id, title FROM goals WHERE lower(title) = lower({:t}) AND state IN ('active', 'paused') LIMIT 1", { id: '', title: '' }, { t: String(title).trim() })[0];
  if (x) throw util.fail(409, 'There already is this goal: "' + x.title + '" (' + x.id + '). Update it instead.', 'duplicate', { duplicate_of: x.id });
}

function preview(ctx, p) {
  const util = u();
  const C = core();
  const op = ctx.op;
  if (op === 'goals.create') {
    sameGoal(ctx.app, util.text(p, 'title', 200, ''));
    return { kind: 'goal', title: 'New goal in ' + (C.KIND_NAMES[String(p.area || '')] || 'an area') + ': ' + util.text(p, 'title', 200, ''), summary: [p.measure ? 'Measured by ' + p.measure : '', p.target ? 'Target ' + p.target + (p.unit ? ' ' + p.unit : '') : '', p.deadline ? 'By ' + p.deadline : ''].filter((x) => x !== '').join('. '), preview: { fields: p } };
  }
  const g = C.need(ctx.app, 'goals', util.req(p, 'goal'), 'goal');
  if (op === 'goals.delete') return { kind: 'goal', title: 'Delete the goal "' + g.getString('title') + '"', summary: 'Its tasks, habits and projects stay, unlinked.', preview: {}, target: { collection: 'goals', id: g.id } };
  if (op === 'goals.set-state') return { kind: 'goal', title: 'Mark "' + g.getString('title') + '" as ' + String(p.state || ''), summary: '', preview: { from: g.getString('state'), to: p.state }, target: { collection: 'goals', id: g.id } };
  const changes = {};
  for (const k of Object.keys(p)) if (k !== 'goal') changes[k] = { from: g.get(k), to: p[k] };
  return { kind: 'goal', title: 'Change the goal "' + g.getString('title') + '"', summary: Object.keys(changes).join(', '), preview: { changes: JSON.parse(JSON.stringify(changes)) }, target: { collection: 'goals', id: g.id } };
}

module.exports = {
  STATES: STATES,
  MEASURES: MEASURES,
  recompute: recompute,
  recomputeMeasure: recomputeMeasure,
  recomputeAll: recomputeAll,
  out: out,
  list: list,
  get: get,
  create: crud.create,
  update: crud.update,
  afterUndo: afterUndo,
  setState: setState,
  checkin: checkin,
  uncheckin: uncheckin,
  milestone: milestone,
  remove: remove,
  undoRemove: undoRemove,
  breakdown: breakdown,
  breakdownPreview: breakdownPreview,
  breakdownPick: breakdownPick,
  preview: preview,
};
