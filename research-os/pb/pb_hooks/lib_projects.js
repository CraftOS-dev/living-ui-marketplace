/// <reference path="../pb_data/types.d.ts" />
/**
 * Projects: a research question and everything built for it (its reading
 * list, to-do, claims map, boards, experiments, manuscripts, screening reviews,
 * notes).
 * Papers stay in the shared library; a project lists the ones it uses.
 *
 * The journey (collect, read, map, synthesize, write) is derived from the
 * project's own counts, never stored, so it always tells the truth.
 * Confidential projects are invisible to your AI agent.
 */

const COLORS = ['ink', 'accent', 'blue', 'green', 'amber', 'red', 'violet', 'teal'];

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function core() {
  return require(`${__hooks}/lib_core.js`);
}
function act() {
  return require(`${__hooks}/lib_activity.js`);
}

function stats(app, id) {
  return u().one(
    app,
    "SELECT (SELECT COUNT(*) FROM project_works pw JOIN works w ON w.id = pw.work WHERE pw.project = {:p} AND w.trashed = FALSE) AS papers, (SELECT COUNT(*) FROM project_works pw JOIN works w ON w.id = pw.work WHERE pw.project = {:p} AND w.trashed = FALSE AND pw.status = 'read') AS read, (SELECT COUNT(*) FROM project_works pw JOIN works w ON w.id = pw.work WHERE pw.project = {:p} AND w.trashed = FALSE AND pw.status = 'reading') AS reading, (SELECT COUNT(*) FROM annotations a WHERE a.work IN (SELECT work FROM project_works WHERE project = {:p})) AS highlights, (SELECT COUNT(*) FROM nodes WHERE project = {:p} AND kind = 'question' AND status != 'researcher_rejected') AS questions, (SELECT COUNT(*) FROM nodes WHERE project = {:p} AND kind = 'claim' AND status != 'researcher_rejected') AS claims, (SELECT COUNT(*) FROM nodes WHERE project = {:p} AND kind = 'evidence' AND status != 'researcher_rejected') AS evidence, (SELECT COUNT(*) FROM nodes WHERE project = {:p} AND status = 'agent_proposed') + (SELECT COUNT(*) FROM relations WHERE project = {:p} AND status = 'agent_proposed') AS proposed, (SELECT COUNT(*) FROM relations WHERE project = {:p} AND kind = 'supports' AND status = 'researcher_confirmed') AS supports, (SELECT COUNT(*) FROM relations WHERE project = {:p} AND kind = 'opposes' AND status = 'researcher_confirmed') AS opposes, (SELECT COUNT(*) FROM notes WHERE project = {:p}) AS notes, (SELECT COUNT(*) FROM boards WHERE project = {:p}) AS boards, (SELECT COUNT(*) FROM manuscripts WHERE project = {:p}) AS manuscripts, (SELECT COUNT(*) FROM reviews WHERE project = {:p}) AS reviews, (SELECT COUNT(*) FROM tasks WHERE project = {:p} AND status != 'done') AS tasks_open, (SELECT COUNT(*) FROM tasks WHERE project = {:p} AND status != 'done' AND due != '' AND due < {:t}) AS tasks_overdue, (SELECT COUNT(*) FROM tasks WHERE project = {:p} AND status = 'done') AS tasks_done, (SELECT COUNT(*) FROM experiments WHERE project = {:p}) AS experiments, (SELECT COUNT(*) FROM experiments WHERE project = {:p} AND status = 'running') AS experiments_running, (SELECT COUNT(*) FROM repo_items WHERE project = {:p} AND kind = 'file') AS repo_files",
    { papers: 0, read: 0, reading: 0, highlights: 0, questions: 0, claims: 0, evidence: 0, proposed: 0, supports: 0, opposes: 0, notes: 0, boards: 0, manuscripts: 0, reviews: 0, tasks_open: 0, tasks_overdue: 0, tasks_done: 0, experiments: 0, experiments_running: 0, repo_files: 0 },
    { p: id, t: u().today() },
  );
}

/** The journey: each step with whether it has begun, and the next step. */
function journey(s) {
  const steps = [
    { key: 'collect', label: 'Collect papers', done: s.papers > 0, count: s.papers },
    { key: 'read', label: 'Read and mark', done: s.read + s.reading > 0 || s.highlights > 0, count: s.read },
    { key: 'map', label: 'Map the claims', done: s.claims > 0, count: s.claims },
    { key: 'synthesize', label: 'Compare and synthesize', done: s.boards > 0, count: s.boards },
    { key: 'write', label: 'Write', done: s.manuscripts > 0, count: s.manuscripts },
  ];
  const next = steps.find((x) => !x.done);
  return { steps: steps, next: next ? next.key : 'write', stage: next ? next.key : 'write' };
}

function out(app, pr, withStats) {
  const o = {
    id: pr.id,
    name: pr.getString('name'),
    question: pr.getString('question'),
    description: pr.getString('description'),
    color: pr.getString('color'),
    confidentiality: pr.getString('confidentiality'),
    state: pr.getString('state'),
    pinned: pr.getBool('pinned'),
    opened_at: pr.getString('opened_at'),
    created: pr.getString('created'),
    updated: pr.getString('updated'),
  };
  if (withStats !== false) {
    const s = u().plain([stats(app, pr.id)])[0];
    o.stats = s;
    o.journey = journey(s);
    o.next_task = require(`${__hooks}/lib_tasks.js`).nextOf(app, pr.id);
  }
  return o;
}

/** projects.list: active projects (or archived), pinned first, newest change first. */
function list(ctx, p) {
  const util = u();
  const state = util.oneOf(p, 'state', ['active', 'archived', 'all'], 'active');
  const where = [];
  if (state !== 'all') where.push("state = '" + state + "'");
  if (ctx.isAgent) where.push("confidentiality = 'normal'");
  const recs = ctx.app.findRecordsByFilter('projects', where.join(' && '), '-pinned,-updated', 500, 0);
  return { projects: recs.map((r) => out(ctx.app, r)) };
}

function create(ctx, p) {
  const util = u();
  const name = util.squash(util.text(p, 'name', 200, ''));
  if (name === '') throw util.fail(400, 'A project needs a name.', 'missing_param', { param: 'name' });
  const pr = util.newRecord(ctx.app, 'projects');
  pr.set('name', name);
  pr.set('question', util.text(p, 'question', 4000, ''));
  pr.set('description', util.text(p, 'description', 8000, ''));
  pr.set('color', util.oneOf(p, 'color', COLORS, COLORS[util.count(ctx.app, 'SELECT COUNT(*) AS n FROM projects') % COLORS.length]));
  pr.set('confidentiality', ctx.isAgent ? 'normal' : util.oneOf(p, 'confidentiality', ['normal', 'confidential'], 'normal'));
  pr.set('state', 'active');
  ctx.app.save(pr);
  // Every project starts with its research repository (a README and the usual folders).
  require(`${__hooks}/lib_repo.js`).ensure(ctx.app, pr.id);
  act().write(ctx.app, ctx, { label: 'Started the project ' + name, target: 'projects', record: pr.id, project: pr.id });
  return { project: out(ctx.app, ctx.app.findRecordById('projects', pr.id)) };
}

function update(ctx, p) {
  const util = u();
  const pr = core().project(ctx.app, util.req(p, 'project'));
  core().guardProject(ctx, pr);
  if (util.has(p, 'name')) {
    const name = util.squash(util.text(p, 'name', 200, ''));
    if (name === '') throw util.fail(400, 'A project needs a name.', 'invalid_param');
    pr.set('name', name);
  }
  if (util.has(p, 'question')) pr.set('question', util.text(p, 'question', 4000, ''));
  if (util.has(p, 'description')) pr.set('description', util.text(p, 'description', 8000, ''));
  if (util.has(p, 'color')) pr.set('color', util.oneOf(p, 'color', COLORS, pr.getString('color')));
  if (util.has(p, 'pinned')) pr.set('pinned', util.bool(p, 'pinned', false));
  if (util.has(p, 'state')) pr.set('state', util.oneOf(p, 'state', ['active', 'archived'], 'active'));
  if (util.has(p, 'confidentiality')) {
    if (ctx.isAgent) throw util.fail(403, 'Only a person sets whether a project is confidential.', 'agent_not_permitted');
    pr.set('confidentiality', util.oneOf(p, 'confidentiality', ['normal', 'confidential'], 'normal'));
  }
  ctx.app.save(pr);
  return { project: out(ctx.app, pr) };
}

/** projects.opened: remember when a project was last opened (Home's order). */
function opened(ctx, p) {
  const pr = core().project(ctx.app, u().req(p, 'project'));
  pr.set('opened_at', u().nowIso());
  ctx.app.save(pr);
  return { ok: true };
}

/** projects.delete: the project and everything made in it; its papers stay in the library. */
function remove(ctx, p) {
  const util = u();
  const pr = core().project(ctx.app, util.req(p, 'project'));
  const s = util.plain([stats(ctx.app, pr.id)])[0];
  if (util.bool(p, 'preview', false)) return { preview: true, takes: s };
  ctx.app.runInTransaction((tx) => {
    for (const n of tx.findRecordsByFilter('notes', 'project = {:p}', '', 0, 0, { p: pr.id })) require(`${__hooks}/lib_search.js`).dropNote(tx, n.id);
    tx.delete(tx.findRecordById('projects', pr.id));
    act().write(tx, ctx, { label: 'Deleted the project ' + pr.getString('name'), target: 'projects', record: pr.id, data: { detail: s } });
  });
  return { deleted: true, took: s };
}

/** projects.get: one project with its numbers, journey and recent changes. */
function get(ctx, p) {
  const util = u();
  const pr = core().project(ctx.app, util.req(p, 'project'));
  core().guardProject(ctx, pr);
  const recent = ctx.app.findRecordsByFilter('activity', 'project = {:p}', '-created', 12, 0, { p: pr.id }).map((r) => act().out(r));
  return { project: out(ctx.app, pr), recent: recent };
}

/* -------------------------------------------------------- reading list */

/** projects.works: the reading list (papers with their status, role and progress here). */
function works(ctx, p) {
  const util = u();
  const app = ctx.app;
  const pr = core().project(app, util.req(p, 'project'));
  core().guardProject(ctx, pr);
  const status = util.oneOf(p, 'status', ['to_read', 'reading', 'read', 'excluded'], '');
  const rows = util.plain(
    util.rows(
      app,
      'SELECT pw.id AS link, pw.work AS work, pw.status AS status, pw.role AS role, pw.note AS note, pw.added_by AS added_by, pw.created AS added, (SELECT COUNT(*) FROM nodes n WHERE n.project = pw.project AND n.work = pw.work) AS nodes, (SELECT COUNT(*) FROM nodes n WHERE n.project = pw.project AND n.work = pw.work AND n.status = \'agent_proposed\') AS proposed FROM project_works pw JOIN works w ON w.id = pw.work WHERE pw.project = {:p} AND w.trashed = FALSE' + (status !== '' ? ' AND pw.status = {:s}' : '') + ' ORDER BY pw.sort, pw.created',
      { link: '', work: '', status: '', role: '', note: '', added_by: '', added: '', nodes: 0, proposed: 0 },
      { p: pr.id, s: status },
    ),
  );
  const W = require(`${__hooks}/lib_works.js`);
  const byId = {};
  for (const r of W.rowsFor(app, rows.map((r) => r.work))) byId[r.id] = r;
  return { project: pr.id, works: rows.filter((r) => byId[r.work]).map((r) => Object.assign({ link: r.link, status: r.status, role: r.role, note: r.note, project_added_by: r.added_by, added: r.added, project_nodes: r.nodes, project_proposed: r.proposed }, { work: byId[r.work] })) };
}

function addWorks(ctx, p) {
  const util = u();
  const pr = core().project(ctx.app, util.req(p, 'project'));
  core().guardProject(ctx, pr);
  const list = util.ids(p, 'works', 2000);
  if (list.length === 0) throw util.fail(400, 'Give --works.', 'missing_param');
  let added = 0;
  ctx.app.runInTransaction((tx) => {
    for (const id of list) {
      const w = core().need(tx, 'works', id, 'paper');
      core().guardWork(ctx, w);
      if (util.findOne(tx, 'project_works', 'project = {:p} && work = {:w}', { p: pr.id, w: id }) !== null) continue;
      const pw = util.newRecord(tx, 'project_works');
      pw.set('project', pr.id);
      pw.set('work', id);
      pw.set('role', util.oneOf(p, 'role', ['core', 'background'], 'core'));
      pw.set('status', w.getString('read_state') === 'read' ? 'read' : w.getString('read_state') === 'reading' ? 'reading' : 'to_read');
      pw.set('added_by', ctx.actor);
      tx.save(pw);
      added++;
    }
    act().write(tx, ctx, { label: 'Added ' + (list.length === 1 ? 'a paper' : list.length + ' papers') + ' to ' + pr.getString('name'), target: 'project_works', project: pr.id, undo: { fn: 'lib_projects.undoAdd', args: { project: pr.id, works: list } } });
  });
  return { added: added };
}

function undoAdd(ctx, args) {
  ctx.app.runInTransaction((tx) => {
    for (const id of args.works || []) {
      const pw = u().findOne(tx, 'project_works', 'project = {:p} && work = {:w}', { p: args.project, w: id });
      if (pw !== null) tx.delete(pw);
    }
  });
}

/** projects.remove-works: take papers off the reading list (claims and evidence from them stay). */
function removeWorks(ctx, p) {
  const util = u();
  const pr = core().project(ctx.app, util.req(p, 'project'));
  core().guardProject(ctx, pr);
  const list = util.ids(p, 'works', 2000);
  undoAdd(ctx, { project: pr.id, works: list });
  act().write(ctx.app, ctx, { label: 'Took ' + (list.length === 1 ? 'a paper' : list.length + ' papers') + ' off ' + pr.getString('name'), target: 'project_works', project: pr.id });
  return { removed: list.length };
}

/** projects.set-work: a paper's status, role or note in this project. */
function setWork(ctx, p) {
  const util = u();
  const pr = core().project(ctx.app, util.req(p, 'project'));
  core().guardProject(ctx, pr);
  const list = util.ids(p, 'works', 2000);
  let n = 0;
  ctx.app.runInTransaction((tx) => {
    for (const id of list) {
      const pw = util.findOne(tx, 'project_works', 'project = {:p} && work = {:w}', { p: pr.id, w: id });
      if (pw === null) continue;
      if (util.has(p, 'status')) pw.set('status', util.oneOf(p, 'status', ['to_read', 'reading', 'read', 'excluded'], 'to_read'));
      if (util.has(p, 'role')) pw.set('role', util.oneOf(p, 'role', ['core', 'background'], 'core'));
      if (util.has(p, 'note')) pw.set('note', util.text(p, 'note', 4000, ''));
      tx.save(pw);
      n++;
    }
  });
  return { updated: n };
}

module.exports = { COLORS: COLORS, stats: stats, journey: journey, out: out, list: list, create: create, update: update, opened: opened, remove: remove, get: get, works: works, addWorks: addWorks, undoAdd: undoAdd, removeWorks: removeWorks, setWork: setWork };
