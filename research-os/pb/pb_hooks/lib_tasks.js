/// <reference path="../pb_data/types.d.ts" />
/**
 * Research tasks: each project's own to-do list.
 *
 * A task belongs to one project. It has a status (todo, doing, waiting,
 * done), a priority, an optional due day, labels, a checklist, links to the
 * project's records (papers, claims, manuscripts, boards, notes, experiments) and
 * an optional repeat (completing a repeating task makes the next one). A
 * person may hand a task to your AI agent: the task_assigned trigger fires
 * and the agent works it through these same operations. Confidential
 * projects keep the agent out of their tasks too.
 *
 * Home reads tasks.summary: every open task across projects, counted by due
 * day, with what is next.
 */

const STATUS = ['todo', 'doing', 'waiting', 'done'];
const PRIORITY = ['none', 'low', 'medium', 'high', 'urgent'];
const RECUR = ['none', 'daily', 'weekly', 'monthly'];
const LINKS = { work: 'works', node: 'nodes', manuscript: 'manuscripts', board: 'boards', note: 'notes', experiment: 'experiments' };
const RANK = { urgent: 4, high: 3, medium: 2, low: 1, none: 0 };

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function core() {
  return require(`${__hooks}/lib_core.js`);
}
function act() {
  return require(`${__hooks}/lib_activity.js`);
}

/* --------------------------------------------------------------- values */

function shiftDay(day, days, months) {
  const d = new Date(day + 'T12:00:00');
  if (months) d.setMonth(d.getMonth() + months);
  if (days) d.setDate(d.getDate() + days);
  const pad = (n) => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function cleanLabels(util, raw) {
  if (!Array.isArray(raw)) throw util.fail(400, 'labels is a JSON list of words, e.g. ["experiment","writing"]', 'invalid_param', { param: 'labels' });
  const out = [];
  for (const x of raw) {
    const v = util.squash(String(x)).toLowerCase().slice(0, 40);
    if (v !== '' && out.indexOf(v) < 0) out.push(v);
  }
  if (out.length > 12) throw util.fail(400, 'A task takes at most 12 labels.', 'invalid_param', { param: 'labels' });
  return out;
}

function cleanChecklist(util, raw, before) {
  if (!Array.isArray(raw)) throw util.fail(400, 'checklist is a JSON list: ["step one", {"text":"step two","done":true}]', 'invalid_param', { param: 'checklist' });
  if (raw.length > 100) throw util.fail(400, 'A checklist takes at most 100 items.', 'invalid_param', { param: 'checklist' });
  const known = {};
  for (const it of before || []) known[it.id] = true;
  return raw
    .map((it, i) => {
      if (typeof it === 'string') return { id: util.token(8), text: util.squash(it).slice(0, 500), done: false };
      util.keysOnly(it, ['id', 'text', 'done'], 'Checklist item ' + (i + 1));
      const id = typeof it.id === 'string' && known[it.id] ? it.id : util.token(8);
      return { id: id, text: util.squash(String(it.text || '')).slice(0, 500), done: it.done === true };
    })
    .filter((it) => it.text !== '');
}

/** Links to the project's own records (papers may be any in the library). */
function cleanLinks(ctx, util, raw, projectId) {
  if (!Array.isArray(raw)) throw util.fail(400, 'links is a JSON list: [{"kind":"work","id":"<paper>"}] (kinds: ' + Object.keys(LINKS).join(', ') + ')', 'invalid_param', { param: 'links' });
  if (raw.length > 30) throw util.fail(400, 'A task takes at most 30 links.', 'invalid_param', { param: 'links' });
  const out = [];
  raw.forEach((l, i) => {
    util.keysOnly(l, ['kind', 'id'], 'Link ' + (i + 1));
    const col = LINKS[l.kind];
    if (col === undefined) throw util.fail(400, 'Link ' + (i + 1) + ': kind is one of ' + Object.keys(LINKS).join(', '), 'invalid_param', { param: 'links' });
    const rec = core().need(ctx.app, col, String(l.id || ''), l.kind);
    if (l.kind === 'work') {
      if (rec.getBool('trashed')) throw util.fail(409, 'Link ' + (i + 1) + ': that paper is in the trash.', 'invalid_param');
      core().guardWork(ctx, rec);
    } else if (rec.getString('project') !== projectId) throw util.fail(400, 'Link ' + (i + 1) + ': that ' + l.kind + ' belongs to another project.', 'invalid_param');
    if (!out.some((x) => x.kind === l.kind && x.id === rec.id)) out.push({ kind: l.kind, id: rec.id });
  });
  return out;
}

function titleOf(rec, kind) {
  if (kind === 'work' || kind === 'node' || kind === 'manuscript' || kind === 'note') return rec.getString('title');
  if (kind === 'experiment') return require(`${__hooks}/lib_exp.js`).code(rec.getInt('number')) + ' ' + rec.getString('title');
  return rec.getString('name');
}

/* --------------------------------------------------------------- output */

function out(app, t, projects) {
  const util = u();
  const pid = t.getString('project');
  let pr = projects ? projects[pid] : undefined;
  if (pr === undefined) {
    const r = util.byId(app, 'projects', pid);
    pr = r !== null ? { name: r.getString('name'), color: r.getString('color') } : { name: '', color: 'ink' };
    if (projects) projects[pid] = pr;
  }
  const links = (util.jsonOf(t, 'links') || [])
    .map((l) => {
      const rec = LINKS[l.kind] ? util.byId(app, LINKS[l.kind], l.id) : null;
      return rec !== null ? { kind: l.kind, id: l.id, title: titleOf(rec, l.kind) } : null;
    })
    .filter((l) => l !== null);
  const due = t.getString('due');
  const today = util.today();
  const status = t.getString('status');
  return {
    id: t.id,
    project: pid,
    project_name: pr.name,
    project_color: pr.color,
    title: t.getString('title'),
    notes: t.getString('notes'),
    status: status,
    priority: t.getString('priority'),
    due: due,
    overdue: status !== 'done' && due !== '' && due < today,
    assignee: t.getString('assignee'),
    labels: util.jsonOf(t, 'labels') || [],
    checklist: util.jsonOf(t, 'checklist') || [],
    links: links,
    recur: t.getString('recur'),
    sort: t.getFloat('sort'),
    done_at: t.getString('done_at'),
    actor: t.getString('actor'),
    created: t.getString('created'),
    updated: t.getString('updated'),
  };
}

function taskOf(ctx, id) {
  const t = core().need(ctx.app, 'tasks', id, 'task');
  core().guardProjectId(ctx, t.getString('project'));
  return t;
}

function lastSort(app, projectId, status) {
  return u().count(app, 'SELECT CAST(COALESCE(MAX(sort), 0) AS INTEGER) + 1 AS n FROM tasks WHERE project = {:p} AND status = {:s}', { p: projectId, s: status });
}

/** A person handed the task to your AI agent: ask it (never in a confidential project). */
function askAgentFor(ctx, t, pr) {
  if (ctx.isAgent || t.getString('assignee') !== 'agent') return '';
  if (pr.getString('confidentiality') === 'confidential') return '';
  return require(`${__hooks}/lib_agent.js`).ask(ctx.app, 'task_assigned', { task_id: t.id, project_id: pr.id });
}

function snapshot(t) {
  const util = u();
  return {
    title: t.getString('title'),
    notes: t.getString('notes'),
    status: t.getString('status'),
    priority: t.getString('priority'),
    due: t.getString('due'),
    assignee: t.getString('assignee'),
    labels: util.jsonOf(t, 'labels') || [],
    checklist: util.jsonOf(t, 'checklist') || [],
    links: util.jsonOf(t, 'links') || [],
    recur: t.getString('recur'),
    sort: t.getFloat('sort'),
    done_at: t.getString('done_at'),
  };
}

function restore(t, s) {
  for (const k of Object.keys(s)) t.set(k, s[k]);
}

/* --------------------------------------------------------------- writes */

/** tasks.create: a task in a project's to-do list. */
function create(ctx, p) {
  const util = u();
  const app = ctx.app;
  const pr = core().project(app, util.req(p, 'project'));
  core().guardProject(ctx, pr);
  const title = util.squash(util.text(p, 'title', 400, ''));
  if (title === '') throw util.fail(400, 'A task needs a title.', 'missing_param', { param: 'title' });
  const assignee = util.oneOf(p, 'assignee', ['person', 'agent'], 'person');
  if (assignee === 'agent' && pr.getString('confidentiality') === 'confidential') throw util.fail(409, 'This project is confidential: your AI agent is kept out of it, so it cannot take its tasks.', 'confidential_project');
  const status = util.oneOf(p, 'status', STATUS, 'todo');
  const t = util.newRecord(app, 'tasks');
  t.set('project', pr.id);
  t.set('title', title);
  t.set('notes', util.text(p, 'notes', 20000, ''));
  t.set('status', status);
  t.set('priority', util.oneOf(p, 'priority', PRIORITY, 'none'));
  t.set('due', util.day(p, 'due', ''));
  t.set('assignee', assignee);
  t.set('labels', util.has(p, 'labels') ? cleanLabels(util, util.list(p, 'labels')) : []);
  t.set('checklist', util.has(p, 'checklist') ? cleanChecklist(util, util.list(p, 'checklist'), []) : []);
  t.set('links', util.has(p, 'links') ? cleanLinks(ctx, util, util.list(p, 'links'), pr.id) : []);
  t.set('recur', util.oneOf(p, 'recur', RECUR, 'none'));
  t.set('sort', util.str(p, 'after', '') === 'start' ? -Date.now() / 1000 : lastSort(app, pr.id, status));
  t.set('done_at', status === 'done' ? util.nowIso() : '');
  t.set('actor', ctx.actor);
  app.save(t);
  act().write(app, ctx, { label: 'Added the task "' + title.slice(0, 80) + '" to ' + pr.getString('name'), target: 'tasks', record: t.id, project: pr.id, undo: { fn: 'lib_tasks.undoCreate', args: { task: t.id } } });
  const request = askAgentFor(ctx, t, pr);
  return { task: out(app, t), request: request };
}

function undoCreate(ctx, args) {
  const t = u().byId(ctx.app, 'tasks', args.task);
  if (t !== null) ctx.app.delete(t);
}

/**
 * Change a task inside one transaction, read afresh there. PocketBase runs
 * transactions one at a time, so two quick edits (a label, then a step)
 * never save over each other. Our own errors keep their status and code.
 */
function locked(app, id, fn) {
  let res;
  let failure = null;
  try {
    app.runInTransaction((tx) => {
      try {
        res = fn(tx, tx.findRecordById('tasks', id));
      } catch (e) {
        failure = e;
        throw e;
      }
    });
  } catch (e) {
    throw failure !== null ? failure : e;
  }
  return res;
}

/** tasks.update: change any part of a task. */
function update(ctx, p) {
  const util = u();
  const app = ctx.app;
  const id = taskOf(ctx, util.req(p, 'task')).id;
  const pr = app.findRecordById('projects', app.findRecordById('tasks', id).getString('project'));
  // What does not depend on the task as it is now is checked first.
  let title = null;
  if (util.has(p, 'title')) {
    title = util.squash(util.text(p, 'title', 400, ''));
    if (title === '') throw util.fail(400, 'A task needs a title.', 'invalid_param', { param: 'title' });
  }
  const assignee = util.has(p, 'assignee') ? util.oneOf(p, 'assignee', ['person', 'agent'], 'person') : null;
  if (assignee === 'agent' && pr.getString('confidentiality') === 'confidential') throw util.fail(409, 'This project is confidential: your AI agent is kept out of it, so it cannot take its tasks.', 'confidential_project');
  const links = util.has(p, 'links') ? cleanLinks(ctx, util, util.list(p, 'links'), pr.id) : null;
  let before = null;
  const t = locked(app, id, (tx, t) => {
    before = snapshot(t);
    if (title !== null) t.set('title', title);
    if (util.has(p, 'notes')) t.set('notes', util.text(p, 'notes', 20000, ''));
    if (util.has(p, 'priority')) t.set('priority', util.oneOf(p, 'priority', PRIORITY, 'none'));
    if (util.has(p, 'due')) t.set('due', util.day(p, 'due', ''));
    if (util.has(p, 'recur')) t.set('recur', util.oneOf(p, 'recur', RECUR, 'none'));
    if (util.has(p, 'labels')) t.set('labels', cleanLabels(util, util.list(p, 'labels')));
    if (util.has(p, 'checklist')) t.set('checklist', cleanChecklist(util, util.list(p, 'checklist'), before.checklist));
    if (links !== null) t.set('links', links);
    if (assignee !== null) t.set('assignee', assignee);
    if (util.has(p, 'status')) {
      const s = util.oneOf(p, 'status', STATUS, before.status);
      if (s !== before.status) {
        t.set('status', s);
        t.set('sort', lastSort(tx, pr.id, s));
        t.set('done_at', s === 'done' ? util.nowIso() : '');
      }
    }
    tx.save(t);
    act().write(tx, ctx, { label: 'Changed the task "' + t.getString('title').slice(0, 80) + '"', target: 'tasks', record: t.id, project: pr.id, undo: { fn: 'lib_tasks.undoUpdate', args: { task: t.id, before: before } } });
    return t;
  });
  const request = before.assignee !== 'agent' ? askAgentFor(ctx, t, pr) : '';
  return { task: out(app, t), request: request };
}

function undoUpdate(ctx, args) {
  const t = u().byId(ctx.app, 'tasks', args.task);
  if (t === null) return;
  restore(t, args.before);
  ctx.app.save(t);
}

/** tasks.complete: tick a task off (or back on). A repeating task makes its next one. */
function complete(ctx, p) {
  const util = u();
  const app = ctx.app;
  const id = taskOf(ctx, util.req(p, 'task')).id;
  const done = util.bool(p, 'done', true);
  let next = null;
  const t = locked(app, id, (tx, t) => {
    const before = snapshot(t);
    const project = t.getString('project');
    if (done && before.status !== 'done') {
      t.set('status', 'done');
      t.set('done_at', util.nowIso());
      t.set('sort', lastSort(tx, project, 'done'));
      const r = before.recur;
      if (r !== 'none') {
        const base = before.due !== '' ? before.due : util.today();
        next = util.newRecord(tx, 'tasks');
        next.set('project', project);
        next.set('title', before.title);
        next.set('notes', before.notes);
        next.set('status', 'todo');
        next.set('priority', before.priority);
        next.set('due', r === 'daily' ? shiftDay(base, 1, 0) : r === 'weekly' ? shiftDay(base, 7, 0) : shiftDay(base, 0, 1));
        next.set('assignee', before.assignee);
        next.set('labels', before.labels);
        next.set('checklist', before.checklist.map((it) => ({ id: it.id, text: it.text, done: false })));
        next.set('links', before.links);
        next.set('recur', r);
        next.set('sort', lastSort(tx, project, 'todo'));
        next.set('done_at', '');
        next.set('actor', 'system');
      }
    } else if (!done && before.status === 'done') {
      t.set('status', 'todo');
      t.set('done_at', '');
      t.set('sort', lastSort(tx, project, 'todo'));
    } else return t;
    tx.save(t);
    if (next !== null) tx.save(next);
    act().write(tx, ctx, { label: (done ? 'Completed' : 'Reopened') + ' the task "' + before.title.slice(0, 80) + '"', target: 'tasks', record: t.id, project: project, undo: { fn: 'lib_tasks.undoComplete', args: { task: t.id, before: before, next: next !== null ? next.id : '' } } });
    return t;
  });
  return { task: out(app, t), next: next !== null ? out(app, next) : null };
}

function undoComplete(ctx, args) {
  const util = u();
  if (args.next) {
    const n = util.byId(ctx.app, 'tasks', args.next);
    if (n !== null) ctx.app.delete(n);
  }
  undoUpdate(ctx, args);
}

/** tasks.move: a new place on the board (status column) or in the list. */
function move(ctx, p) {
  const util = u();
  const app = ctx.app;
  const id = taskOf(ctx, util.req(p, 'task')).id;
  const after = util.str(p, 'after', '');
  if (after !== '' && after !== 'end' && after !== 'start') core().need(app, 'tasks', after, 'task');
  const t = locked(app, id, (tx, t) => {
    const project = t.getString('project');
    const status = util.oneOf(p, 'status', STATUS, t.getString('status'));
    let sort;
    if (after === '' || after === 'end') sort = lastSort(tx, project, status);
    else if (after === 'start') {
      const first = util.one(tx, 'SELECT COALESCE(MIN(sort), 1) AS s FROM tasks WHERE project = {:p} AND status = {:st} AND id != {:id}', { s: -0 }, { p: project, st: status, id: t.id });
      sort = (first !== null ? first.s : 1) - 1;
    } else {
      const a = core().need(tx, 'tasks', after, 'task');
      const nxt = util.one(tx, 'SELECT COALESCE(MIN(sort), {:x} + 2) AS s FROM tasks WHERE project = {:p} AND status = {:st} AND sort > {:x} AND id != {:id}', { s: -0 }, { p: project, st: status, x: a.getFloat('sort'), id: t.id });
      sort = (a.getFloat('sort') + (nxt !== null ? nxt.s : a.getFloat('sort') + 2)) / 2;
    }
    const wasDone = t.getString('status') === 'done';
    t.set('status', status);
    t.set('sort', sort);
    if (status === 'done' && !wasDone) t.set('done_at', util.nowIso());
    if (status !== 'done') t.set('done_at', '');
    tx.save(t);
    return t;
  });
  return { task: out(app, t) };
}

/** tasks.check: tick one checklist item, or add one (--text). */
function check(ctx, p) {
  const util = u();
  const app = ctx.app;
  const id = taskOf(ctx, util.req(p, 'task')).id;
  const item = util.str(p, 'item', '');
  const text = item === '' ? util.squash(util.text(p, 'text', 500, '')) : '';
  if (item === '' && text === '') throw util.fail(400, 'Give --item <checklist item id> to tick it, or --text to add an item.', 'missing_param');
  const t = locked(app, id, (tx, t) => {
    const list = util.jsonOf(t, 'checklist') || [];
    if (item === '') {
      if (list.length >= 100) throw util.fail(400, 'A checklist takes at most 100 items.', 'invalid_param');
      list.push({ id: util.token(8), text: text, done: util.bool(p, 'done', false) });
    } else {
      const it = list.find((x) => x.id === item);
      if (!it) throw util.fail(404, 'No checklist item ' + item + ' on this task.', 'not_found');
      it.done = util.bool(p, 'done', !it.done);
    }
    t.set('checklist', list);
    tx.save(t);
    return t;
  });
  return { task: out(app, t) };
}

/** tasks.delete: remove a task (Undo brings it back). */
function remove(ctx, p) {
  const util = u();
  const app = ctx.app;
  const t0 = taskOf(ctx, util.req(p, 'task'));
  if (util.bool(p, 'preview', false)) return { preview: true, task: out(app, t0) };
  locked(app, t0.id, (tx, t) => {
    const saved = Object.assign(snapshot(t), { project: t.getString('project'), actor: t.getString('actor') });
    tx.delete(t);
    act().write(tx, ctx, { label: 'Deleted the task "' + saved.title.slice(0, 80) + '"', target: 'tasks', record: t.id, project: saved.project, undo: { fn: 'lib_tasks.undoDelete', args: saved } });
  });
  return { deleted: true };
}

function undoDelete(ctx, args) {
  const t = u().newRecord(ctx.app, 'tasks');
  restore(t, args);
  ctx.app.save(t);
}

/* ---------------------------------------------------------------- reads */

/** The project ids your AI agent may not see (confidential). */
function hiddenProjects(ctx) {
  return ctx.isAgent ? ctx.app.findRecordsByFilter('projects', "confidentiality = 'confidential'", '', 0, 0).map((r) => r.id) : [];
}

function sortTasks(list) {
  return list.sort((a, b) => {
    const ad = a.due === '' ? '9999' : a.due;
    const bd = b.due === '' ? '9999' : b.due;
    if (ad !== bd) return ad < bd ? -1 : 1;
    if (RANK[a.priority] !== RANK[b.priority]) return RANK[b.priority] - RANK[a.priority];
    return a.sort - b.sort;
  });
}

/** The task to do next in a project, in the order every task list uses: its id, title and due day (null when nothing is open). */
function nextOf(app, projectId) {
  const open = app.findRecordsByFilter('tasks', "project = {:p} && status != 'done'", 'sort', 0, 0, { p: projectId }).map((t) => ({ id: t.id, title: t.getString('title'), due: t.getString('due'), priority: t.getString('priority'), sort: t.getFloat('sort') }));
  if (open.length === 0) return null;
  const t = sortTasks(open)[0];
  return { id: t.id, title: t.title, due: t.due, overdue: t.due !== '' && t.due < u().today() };
}

/** tasks.list: a project's tasks (or every project's), filtered. */
function list(ctx, p) {
  const util = u();
  const app = ctx.app;
  const where = [];
  const bind = {};
  const proj = util.str(p, 'project', '');
  if (proj !== '') {
    const pr = core().project(app, proj);
    core().guardProject(ctx, pr);
    where.push('project = {:p}');
    bind.p = pr.id;
  } else
    hiddenProjects(ctx).forEach((id, i) => {
      where.push('project != {:h' + i + '}');
      bind['h' + i] = id;
    });
  const status = util.oneOf(p, 'status', ['open', 'all'].concat(STATUS), 'open');
  if (status === 'open') where.push("status != 'done'");
  else if (status !== 'all') {
    where.push('status = {:s}');
    bind.s = status;
  }
  const who = util.oneOf(p, 'assignee', ['person', 'agent'], '');
  if (who !== '') {
    where.push('assignee = {:a}');
    bind.a = who;
  }
  const today = util.today();
  const due = util.oneOf(p, 'due', ['overdue', 'today', 'week', 'none'], '');
  if (due === 'overdue') where.push("due != '' && due < {:t} && status != 'done'");
  else if (due === 'today') where.push('due = {:t}');
  else if (due === 'week') {
    where.push('due >= {:t} && due <= {:w}');
    bind.w = shiftDay(today, 7, 0);
  } else if (due === 'none') where.push("due = ''");
  bind.t = today;
  const q = util.str(p, 'q', '');
  if (q !== '') {
    where.push('(title ~ {:q} || notes ~ {:q})');
    bind.q = q;
  }
  const pg = util.page(p, 200, 2000);
  const recs = app.findRecordsByFilter('tasks', where.length > 0 ? where.join(' && ') : '1=1', status === 'done' ? '-done_at' : 'sort', 0, 0, bind);
  const projects = {};
  let rows = recs.map((t) => out(app, t, projects));
  const label = util.str(p, 'label', '').toLowerCase();
  if (label !== '') rows = rows.filter((r) => r.labels.indexOf(label) >= 0);
  if (proj === '' && status !== 'done') rows = sortTasks(rows);
  return { tasks: rows.slice(pg.offset, pg.offset + pg.limit), total: rows.length };
}

/** tasks.get: one task with its links resolved. */
function get(ctx, p) {
  return { task: out(ctx.app, taskOf(ctx, u().req(p, 'task'))) };
}

/** tasks.summary: every open task across projects (or one project), counted by when it is due, with what comes next. */
function summary(ctx, p) {
  const util = u();
  const app = ctx.app;
  const where = ["status != 'done'"];
  const bind = {};
  const proj = util.str(p, 'project', '');
  if (proj !== '') {
    const pr = core().project(app, proj);
    core().guardProject(ctx, pr);
    where.push('project = {:p}');
    bind.p = pr.id;
  }
  hiddenProjects(ctx).forEach((id, i) => {
    where.push('project != {:h' + i + '}');
    bind['h' + i] = id;
  });
  // Across projects, archived projects' tasks wait with their project.
  if (proj === '') {
    const archived = app.findRecordsByFilter('projects', "state = 'archived'", '', 0, 0).map((r) => r.id);
    archived.forEach((id, i) => {
      where.push('project != {:x' + i + '}');
      bind['x' + i] = id;
    });
  }
  const projects = {};
  const open = app.findRecordsByFilter('tasks', where.join(' && '), 'sort', 5000, 0, bind).map((t) => out(app, t, projects));
  const today = util.today();
  const week = shiftDay(today, 7, 0);
  const c = { open: open.length, overdue: 0, today: 0, week: 0, doing: 0, waiting: 0, agent: 0, no_date: 0, urgent: 0 };
  const byProject = {};
  for (const t of open) {
    if (t.overdue) c.overdue++;
    if (t.due === today) c.today++;
    if (t.due !== '' && t.due >= today && t.due <= week) c.week++;
    if (t.due === '') c.no_date++;
    if (t.status === 'doing') c.doing++;
    if (t.status === 'waiting') c.waiting++;
    if (t.assignee === 'agent') c.agent++;
    if (t.priority === 'urgent' || t.priority === 'high') c.urgent++;
    const b = (byProject[t.project] = byProject[t.project] || { project: t.project, name: t.project_name, color: t.project_color, open: 0, overdue: 0, today: 0 });
    b.open++;
    if (t.overdue) b.overdue++;
    if (t.due === today) b.today++;
  }
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  c.done_week = util.count(app, "SELECT COUNT(*) AS n FROM tasks WHERE status = 'done' AND done_at >= {:w}" + (bind.p ? ' AND project = {:p}' : ''), { w: weekAgo, p: bind.p || '' });
  // What is next. In one project: every open task, by day then priority. Across
  // projects: overdue, today, the coming two weeks, then what is in progress or
  // urgent without a day.
  const horizon = shiftDay(today, 14, 0);
  const next = sortTasks(proj !== '' ? open : open.filter((t) => (t.due !== '' && t.due <= horizon) || (t.due === '' && (t.status === 'doing' || RANK[t.priority] >= 3))));
  return {
    counts: c,
    by_project: Object.keys(byProject)
      .map((k) => byProject[k])
      .sort((a, b) => b.overdue - a.overdue || b.today - a.today || b.open - a.open),
    next: next.slice(0, util.int(p, 'limit', 12, 1, 100)),
    today: today,
  };
}

module.exports = {
  STATUS: STATUS,
  create: create,
  undoCreate: undoCreate,
  update: update,
  undoUpdate: undoUpdate,
  complete: complete,
  undoComplete: undoComplete,
  move: move,
  check: check,
  remove: remove,
  undoDelete: undoDelete,
  list: list,
  get: get,
  summary: summary,
  nextOf: nextOf,
};
