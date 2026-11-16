/// <reference path="../pb_data/types.d.ts" />
/**
 * Goals and OKRs: personal goals (an employee), team goals (a department)
 * and company goals (neither), each with optional key results
 * [{ key, title, start, target, current, unit }], a weight for reviews, a
 * status (on_track, at_risk, off_track, done, dropped), a due day and an
 * optional parent goal it aligns to (a simple tree, no cycles).
 *
 * Progress fills itself: from the key results when there are any, else
 * from the aligned goals below it, else from the last check-in. Every
 * change of progress walks up the parent chain.
 *
 * Visibility: company and team goals are visible to everyone signed in;
 * a personal goal to the person, their managers, HR (performance view in
 * their entities) and your AI agent. Changes: the person (their own), their
 * managers, HR editors; team goals also the department's head or approver
 * and team-scope managers of that department; company goals HR editors.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}
function core() {
  return L('lib_performance');
}

const KINDS = ['goal', 'kra', 'okr'];
const STATUSES = ['on_track', 'at_risk', 'off_track', 'done', 'dropped'];
const OPEN = ['on_track', 'at_risk', 'off_track'];
const MAX_KR = 10;

/* ---------------------------------------------------------------- math */

function krPct(kr) {
  const start = Number(kr.start) || 0;
  const target = Number(kr.target);
  const current = Number(kr.current) || 0;
  if (!Number.isFinite(target)) return 0;
  if (target === start) return current >= target ? 1 : 0;
  const x = (current - start) / (target - start);
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function krProgress(krs) {
  if (!krs || krs.length === 0) return null;
  let s = 0;
  for (const k of krs) s += krPct(k);
  return Math.round((s / krs.length) * 100);
}

function scopeOf(rec) {
  if (rec.getString('employee') !== '') return 'personal';
  if (rec.getString('department') !== '') return 'team';
  return 'company';
}

/* -------------------------------------------------------------- access */

function canSeeGoal(ctx, rec) {
  if (scopeOf(rec) !== 'personal') return true;
  return core().relation(ctx, rec.getString('employee')).any;
}

function deptLead(ctx, departmentId) {
  if (!departmentId || ctx.isAgent || !ctx.employeeId) return false;
  const d = u().byId(ctx.app, 'departments', departmentId);
  if (d !== null && (d.getString('head') === ctx.employeeId || d.getString('approver') === ctx.employeeId)) return true;
  if (!ctx.teamScope) return false;
  const me = core().person(ctx, ctx.employeeId);
  return me !== null && me.department === departmentId;
}

function hrEdit(ctx, employeeId) {
  return core().atLeast(core().hrLevel(ctx, employeeId || ''), 'edit');
}

function canEditGoal(ctx, rec) {
  const s = scopeOf(rec);
  if (s === 'personal') {
    const r = core().relation(ctx, rec.getString('employee'));
    return r.self || r.team || core().atLeast(r.hr, 'edit');
  }
  if (s === 'team') return hrEdit(ctx, '') || deptLead(ctx, rec.getString('department'));
  return hrEdit(ctx, '');
}

function needEdit(ctx, rec) {
  if (!canEditGoal(ctx, rec)) throw u().fail(403, (ctx.isAgent ? 'Your AI agent' : 'You') + ' cannot change this goal (its owner, their managers and HR editors can).', 'not_permitted');
}

/* --------------------------------------------------------------- views */

function needsUpdate(rec, today, checkinDays) {
  const status = rec.getString('status');
  if (OPEN.indexOf(status) < 0) return [];
  const out = [];
  if (status === 'at_risk') out.push('at_risk');
  if (status === 'off_track') out.push('off_track');
  const due = rec.getString('due');
  if (due !== '' && due < today) out.push('overdue');
  else if (due !== '' && u().daysBetween(today, due) <= 14) out.push('due_soon');
  const last = (rec.getString('last_checkin') || rec.getString('created')).slice(0, 10);
  if (last !== '' && u().isDay(last) && u().daysBetween(last, today) >= checkinDays) out.push('stale');
  return out;
}

function nameOf(app, collection, id, field) {
  if (!id) return '';
  const r = u().byId(app, collection, id);
  return r === null ? '' : r.getString(field || 'name');
}

function view(ctx, rec, extra) {
  const util = u();
  const app = ctx.app;
  const today = (extra && extra.today) || util.today(app);
  const checkinDays = (extra && extra.checkinDays) || core().settingsOf(app).checkin_days;
  const krs = (util.jsonOf(rec, 'key_results', []) || []).map((k) => Object.assign({}, k, { pct: Math.round(krPct(k) * 100) }));
  const parentId = rec.getString('parent');
  const reasons = needsUpdate(rec, today, checkinDays);
  return {
    id: rec.id,
    title: rec.getString('title'),
    description: rec.getString('description'),
    kind: rec.getString('kind'),
    scope: scopeOf(rec),
    employee: rec.getString('employee') !== '' ? core().chip(ctx, rec.getString('employee')) : null,
    department: rec.getString('department') !== '' ? { id: rec.getString('department'), name: nameOf(app, 'departments', rec.getString('department')) } : null,
    entity: rec.getString('entity'),
    cycle: rec.getString('cycle') !== '' ? { id: rec.getString('cycle'), name: nameOf(app, 'review_cycles', rec.getString('cycle')) } : null,
    parent: parentId !== '' ? { id: parentId, title: nameOf(app, 'goals', parentId, 'title') } : null,
    key_results: krs,
    progress_from: krs.length > 0 ? 'key_results' : util.count(app, "SELECT COUNT(*) AS n FROM goals WHERE parent = {:g} AND status != 'dropped'", { g: rec.id }) > 0 ? 'aligned' : 'checkins',
    weight: rec.getInt('weight'),
    progress: rec.getInt('progress'),
    status: rec.getString('status'),
    start_day: rec.getString('start_day'),
    due: rec.getString('due'),
    last_checkin: rec.getString('last_checkin'),
    origin: rec.getString('origin') || 'person',
    needs_update: reasons.length > 0,
    reasons: reasons,
    can: { edit: !ctx.isAgent && canEditGoal(ctx, rec) },
    created: rec.getString('created'),
    updated: rec.getString('updated'),
  };
}

/* ------------------------------------------------------------ progress */

/** Progress a goal shows now (key results, else aligned goals, else what it has). */
function computed(app, rec) {
  const util = u();
  const krs = util.jsonOf(rec, 'key_results', []) || [];
  const fromKr = krProgress(krs);
  if (fromKr !== null) return fromKr;
  const kids = util.one(app, "SELECT COUNT(*) AS n, CAST(COALESCE(ROUND(AVG(progress)), 0) AS INTEGER) AS avg FROM goals WHERE parent = {:g} AND status != 'dropped'", { n: 0, avg: 0 }, { g: rec.id });
  if (kids !== null && kids.n > 0) return kids.avg;
  return rec.getInt('progress');
}

/** Recompute the parents of a goal up the chain (cycle safe). */
function rollUp(app, rec) {
  const util = u();
  const seen = {};
  let cur = rec;
  for (let i = 0; i < 12; i++) {
    const pid = cur.getString('parent');
    if (pid === '' || seen[pid]) return;
    seen[pid] = true;
    const parent = util.byId(app, 'goals', pid);
    if (parent === null) return;
    const krs = util.jsonOf(parent, 'key_results', []) || [];
    if (krs.length > 0) return;
    const next = computed(app, parent);
    if (next === parent.getInt('progress')) return;
    parent.set('progress', next);
    app.save(parent);
    cur = parent;
  }
}

/* -------------------------------------------------------------- params */

function readKrs(p, existing) {
  const util = u();
  const raw = util.list(p, 'key_results');
  if (raw === undefined) return undefined;
  if (raw.length > MAX_KR) throw util.fail(400, 'At most ' + MAX_KR + ' key results on one goal.', 'invalid_param', { param: 'key_results' });
  const old = {};
  for (const k of existing || []) old[k.key] = k;
  const used = {};
  return raw.map((k, i) => {
    util.keysOnly(k, ['key', 'title', 'start', 'target', 'current', 'unit'], 'key result ' + (i + 1));
    const title = util.squash(k.title || '');
    if (title === '' || title.length > 200) throw util.fail(400, 'key result ' + (i + 1) + ': a title of 1 to 200 characters.', 'invalid_param', { param: 'key_results' });
    const n = (v, d, name) => {
      if (v === undefined || v === null || v === '') return d;
      const x = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim());
      if (!Number.isFinite(x)) throw util.fail(400, 'key result ' + (i + 1) + ': ' + name + ' must be a number.', 'invalid_param', { param: 'key_results' });
      return x;
    };
    let key = String(k.key || '').trim();
    if (key === '' || used[key]) {
      let j = i + 1;
      while (used['kr' + j] || (old['kr' + j] && key === '')) j++;
      key = key !== '' && !used[key] ? key : 'kr' + j;
    }
    used[key] = true;
    const prev = old[key];
    const start = n(k.start, prev ? Number(prev.start) || 0 : 0, 'start');
    const target = n(k.target, prev ? Number(prev.target) : 100, 'target');
    const current = n(k.current, prev ? Number(prev.current) || 0 : start, 'current');
    return { key: key, title: title, start: start, target: target, current: current, unit: util.clip(util.squash(k.unit || ''), 12) };
  });
}

function checkParent(ctx, goalId, parentRef) {
  const util = u();
  if (parentRef === '') return '';
  const parent = util.byId(ctx.app, 'goals', parentRef);
  if (parent === null) throw util.fail(404, 'No goal ' + parentRef + ' to align to. Run goals.list.', 'not_found');
  if (!canSeeGoal(ctx, parent)) throw util.fail(403, 'You cannot align to a goal you cannot see.', 'not_permitted');
  let cur = parent;
  for (let i = 0; i < 20 && cur !== null; i++) {
    if (cur.id === goalId) throw util.fail(400, 'A goal cannot align to itself or to a goal below it.', 'invalid_param', { param: 'parent' });
    cur = cur.getString('parent') !== '' ? util.byId(ctx.app, 'goals', cur.getString('parent')) : null;
  }
  return parent.id;
}

function ref(ctx, id) {
  const r = u().byId(ctx.app, 'goals', String(id || ''));
  if (r === null) throw u().fail(404, 'No goal ' + id + '. Run goals.list.', 'not_found');
  return r;
}

/* ------------------------------------------------------------------ ops */

function list(ctx, p) {
  const util = u();
  const app = ctx.app;
  const today = util.today(app);
  const pg = util.page(p, 50, 300);
  const where = [];
  const bind = {};
  const ids = core().visibleIds(ctx);
  where.push("(g.employee = '' OR " + core().inList('g.employee', ids, bind, 'v') + ')');
  const view0 = util.oneOf(p, 'view', ['mine', 'team', 'company', 'all'], 'all');
  if (view0 === 'mine') {
    const me = core().selfOrFail(ctx);
    where.push('g.employee = {:me}');
    bind.me = me;
  } else if (view0 === 'team') {
    const team = Object.keys(core().teamOf(ctx));
    const mine = ctx.employeeId ? core().person(ctx, ctx.employeeId) : null;
    const dept = mine !== null && mine.department !== '' ? mine.department : '-';
    bind.tdept = dept;
    where.push('(' + core().inList('g.employee', team, bind, 't') + " OR (g.employee = '' AND g.department = {:tdept}))");
  } else if (view0 === 'company') where.push("g.employee = '' AND g.department = ''");
  const emp = util.str(p, 'employee', '');
  if (emp !== '') {
    const e = L('lib_people').employeeRef(app, emp);
    core().needSee(ctx, e.id);
    where.push('g.employee = {:emp}');
    bind.emp = e.id;
  }
  const dep = util.str(p, 'department', '');
  if (dep !== '') {
    where.push('g.department = {:dep}');
    bind.dep = L('lib_org').kindRef(app, 'department', dep).id;
  }
  const cyc = util.str(p, 'cycle', '');
  if (cyc !== '') {
    where.push('g.cycle = {:cyc}');
    bind.cyc = cyc;
  }
  const scope = util.oneOf(p, 'scope', ['personal', 'team', 'company', 'any'], 'any');
  if (scope === 'personal') where.push("g.employee != ''");
  else if (scope === 'team') where.push("g.employee = '' AND g.department != ''");
  else if (scope === 'company') where.push("g.employee = '' AND g.department = ''");
  const status = util.oneOf(p, 'status', ['open', 'done', 'dropped', 'closed', 'all'].concat(OPEN), 'open');
  let statusCond = '';
  if (status === 'open') statusCond = " AND g.status IN ('on_track', 'at_risk', 'off_track')";
  else if (status === 'closed') statusCond = " AND g.status IN ('done', 'dropped')";
  else if (status !== 'all') {
    statusCond = ' AND g.status = {:st}';
    bind.st = status;
  }
  const parent = util.str(p, 'parent', '');
  if (parent === 'none') where.push("g.parent = ''");
  else if (parent !== '') {
    where.push('g.parent = {:par}');
    bind.par = parent;
  }
  const q = util.str(p, 'q', '');
  if (q !== '') {
    where.push("(g.title LIKE {:q} ESCAPE '\\' OR g.description LIKE {:q} ESCAPE '\\')");
    bind.q = util.like(q);
  }
  const base = ' FROM goals g WHERE ' + where.join(' AND ');
  const sql = base + statusCond;
  const checkinDays = core().settingsOf(app).checkin_days;
  const onlyNeeds = util.bool(p, 'needs_update', false);
  const order = " ORDER BY CASE g.status WHEN 'off_track' THEN 0 WHEN 'at_risk' THEN 1 WHEN 'on_track' THEN 2 ELSE 3 END, CASE WHEN g.due = '' THEN 1 ELSE 0 END, g.due, g.title COLLATE NOCASE";
  let rows;
  let total;
  if (onlyNeeds) {
    const all = util.rows(app, 'SELECT g.id AS id' + sql + order, { id: '' }, bind).map((r) => app.findRecordById('goals', r.id));
    const need = all.filter((r) => needsUpdate(r, today, checkinDays).length > 0);
    total = need.length;
    rows = need.slice(pg.offset, pg.offset + pg.limit);
  } else {
    total = util.count(app, 'SELECT COUNT(*) AS n' + sql, bind);
    rows = util.rows(app, 'SELECT g.id AS id' + sql + order + ' LIMIT ' + pg.limit + ' OFFSET ' + pg.offset, { id: '' }, bind).map((r) => app.findRecordById('goals', r.id));
  }
  const counts = {};
  for (const r of util.rows(app, 'SELECT g.status AS status, COUNT(*) AS n' + base + ' GROUP BY g.status', { status: '', n: 0 }, bind)) counts[r.status] = r.n;
  return { goals: rows.map((r) => view(ctx, r, { today: today, checkinDays: checkinDays })), total: total, counts: counts, limit: pg.limit, offset: pg.offset, today: today };
}

/** Open goals of one employee (for the profile tab). */
function listFor(ctx, employeeId, opts) {
  const util = u();
  const today = util.today(ctx.app);
  const checkinDays = core().settingsOf(ctx.app).checkin_days;
  const where = 'employee = {:e}' + (opts && opts.open ? " && status != 'dropped'" : '');
  return util.findMany(ctx.app, 'goals', where, 'status,due', 100, { e: employeeId }).map((r) => view(ctx, r, { today: today, checkinDays: checkinDays }));
}

/** Goals that need an update: { goals, total } for { employee } | { team } | { all }. */
function needingUpdate(ctx, who, today, limit) {
  const util = u();
  const app = ctx.app;
  const bind = {};
  let where = "status IN ('on_track', 'at_risk', 'off_track')";
  if (who.employee) {
    where += ' AND employee = {:e}';
    bind.e = who.employee;
  } else if (who.team) where += ' AND ' + core().inList('employee', Object.keys(core().teamOf(ctx)), bind, 't');
  else where += " AND (employee = '' OR " + core().inList('employee', core().visibleIds(ctx), bind, 'v') + ')';
  const checkinDays = core().settingsOf(app).checkin_days;
  const recs = util.rows(app, 'SELECT id FROM goals WHERE ' + where + ' ORDER BY due', { id: '' }, bind).map((r) => app.findRecordById('goals', r.id));
  const need = recs.filter((r) => needsUpdate(r, today, checkinDays).length > 0);
  return { goals: limit > 0 ? need.slice(0, limit).map((r) => view(ctx, r, { today: today, checkinDays: checkinDays })) : [], total: need.length };
}

function get(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rec = ref(ctx, util.req(p, 'goal'));
  if (!canSeeGoal(ctx, rec)) throw util.fail(403, 'You cannot see this goal.', 'not_permitted');
  const out = view(ctx, rec);
  out.checkins = util.findMany(app, 'goal_checkins', 'goal = {:g}', '-created', 100, { g: rec.id }).map((c) => checkinView(ctx, c));
  out.children = util
    .findMany(app, 'goals', 'parent = {:g}', 'title', 200, { g: rec.id })
    .filter((c) => canSeeGoal(ctx, c))
    .map((c) => view(ctx, c));
  const chain = [];
  let cur = rec;
  for (let i = 0; i < 10 && cur.getString('parent') !== ''; i++) {
    const par = util.byId(app, 'goals', cur.getString('parent'));
    if (par === null || !canSeeGoal(ctx, par)) break;
    chain.unshift({ id: par.id, title: par.getString('title'), progress: par.getInt('progress'), scope: scopeOf(par) });
    cur = par;
  }
  out.chain = chain;
  return { goal: out };
}

function checkinView(ctx, c) {
  const util = u();
  return {
    id: c.id,
    goal: c.getString('goal'),
    at: c.getString('created'),
    who: c.getString('actor') === 'agent' ? 'Your AI agent' : core().memberName(ctx.app, c.getString('member')),
    actor: c.getString('actor'),
    note: c.getString('note'),
    progress_before: c.getInt('progress_before'),
    progress_after: c.getInt('progress_after'),
    status_before: c.getString('status_before'),
    status_after: c.getString('status_after'),
    key_results: util.jsonOf(c, 'key_results', []) || [],
  };
}

/** Alignment tree: company -> team -> personal, as nodes with their parent. */
function tree(ctx, p) {
  const util = u();
  const app = ctx.app;
  const bind = {};
  const where = ["(employee = '' OR " + core().inList('employee', core().visibleIds(ctx), bind, 'v') + ')'];
  if (!util.bool(p, 'include_closed', false)) where.push("status NOT IN ('done', 'dropped')");
  else where.push("status != 'dropped'");
  const cyc = util.str(p, 'cycle', '');
  if (cyc !== '') {
    where.push("(cycle = {:c} OR employee = '')");
    bind.c = cyc;
  }
  const ent = util.str(p, 'entity', '');
  if (ent !== '') {
    where.push("(entity = {:en} OR entity = '')");
    bind.en = L('lib_org').entityRef(app, ent).id;
  }
  const rows = util.rows(app, 'SELECT id FROM goals WHERE ' + where.join(' AND ') + ' ORDER BY title COLLATE NOCASE LIMIT 2000', { id: '' }, bind);
  const nodes = rows.map((r) => {
    const g = app.findRecordById('goals', r.id);
    const owner = g.getString('employee') !== '' ? core().chip(ctx, g.getString('employee')) : null;
    return { id: g.id, title: g.getString('title'), scope: scopeOf(g), kind: g.getString('kind'), owner: owner, department: g.getString('department') !== '' ? nameOf(app, 'departments', g.getString('department')) : '', progress: g.getInt('progress'), status: g.getString('status'), due: g.getString('due'), parent: g.getString('parent'), children: 0 };
  });
  const byId = {};
  for (const n of nodes) byId[n.id] = n;
  for (const n of nodes) if (n.parent !== '' && byId[n.parent]) byId[n.parent].children++;
  const roots = nodes.filter((n) => n.parent === '' || byId[n.parent] === undefined).map((n) => n.id);
  return { nodes: nodes, roots: roots, total: nodes.length };
}

function create(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rec = util.newRecord(app, 'goals');
  const company = util.bool(p, 'company', false);
  const depRef = util.str(p, 'department', '');
  const empRef = util.str(p, 'employee', '');
  if (empRef !== '') {
    const e = L('lib_people').employeeRef(app, empRef);
    rec.set('employee', e.id);
    const pr = core().person(ctx, e.id);
    rec.set('entity', pr ? pr.entity : '');
  } else if (company) {
    rec.set('employee', '');
  } else if (depRef !== '') {
    const d = L('lib_org').kindRef(app, 'department', depRef);
    rec.set('department', d.id);
    rec.set('entity', d.getString('entity'));
  } else {
    const me = core().selfOrFail(ctx);
    rec.set('employee', me);
    const pr = core().person(ctx, me);
    rec.set('entity', pr ? pr.entity : '');
  }
  if (empRef !== '' && depRef !== '') rec.set('department', '');
  const ent = util.str(p, 'entity', '');
  if (ent !== '' && rec.getString('employee') === '') rec.set('entity', L('lib_org').entityRef(app, ent).id);
  needEdit(ctx, rec);
  rec.set('title', util.squash(util.req(p, 'title', '"Launch the new onboarding flow"')));
  if (rec.getString('title').length > 200) throw util.fail(400, 'title is too long (at most 200 characters)', 'invalid_param', { param: 'title' });
  rec.set('description', util.text(p, 'description', 4000, ''));
  const krs = readKrs(p, []) || [];
  rec.set('kind', util.oneOf(p, 'kind', KINDS, krs.length > 0 ? 'okr' : 'goal'));
  rec.set('key_results', krs);
  rec.set('weight', util.int(p, 'weight', 0, 0, 100));
  rec.set('status', util.oneOf(p, 'status', OPEN, 'on_track'));
  rec.set('start_day', util.day(p, 'start_day', util.today(app)));
  rec.set('due', util.day(p, 'due', ''));
  if (rec.getString('due') !== '' && rec.getString('due') < rec.getString('start_day')) throw util.fail(400, 'The due day is before the start day.', 'invalid_param', { param: 'due' });
  const cyc = util.str(p, 'cycle', '');
  if (cyc !== '') {
    const c = util.byId(app, 'review_cycles', cyc);
    if (c === null) throw util.fail(404, 'No review cycle ' + cyc + '. Run cycles.list.', 'not_found');
    rec.set('cycle', c.id);
  }
  rec.set('created_by', ctx.memberId || '');
  rec.set('origin', ctx.isAgent ? 'agent' : 'person');
  const parent = checkParent(ctx, '', util.str(p, 'parent', ''));
  rec.set('parent', parent);
  rec.set('progress', krProgress(krs) !== null ? krProgress(krs) : util.int(p, 'progress', 0, 0, 100));
  app.save(rec);
  rollUp(app, rec);
  const who = rec.getString('employee') !== '' ? core().chip(ctx, rec.getString('employee')) : null;
  L('lib_audit').note(ctx, { collection: 'goals', record: rec.id, summary: 'Added the goal "' + rec.getString('title') + '"' + (who ? ' for ' + who.name : scopeOf(rec) === 'team' ? ' for a team' : ' for the company'), after: view(ctx, rec) });
  if (who && !ctx.isAgent && rec.getString('employee') !== ctx.employeeId) core().notifyEmployee(app, rec.getString('employee'), { kind: 'performance', title: 'New goal for you: ' + util.clip(rec.getString('title'), 120), link: '#/performance/goals/' + rec.id });
  return { goal: view(ctx, rec) };
}

function update(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rec = ref(ctx, util.req(p, 'goal'));
  needEdit(ctx, rec);
  const before = view(ctx, rec);
  if (util.has(p, 'title')) {
    const t = util.squash(util.req(p, 'title'));
    if (t.length > 200) throw util.fail(400, 'title is too long (at most 200 characters)', 'invalid_param', { param: 'title' });
    rec.set('title', t);
  }
  if (util.has(p, 'description')) rec.set('description', util.text(p, 'description', 4000, ''));
  if (util.has(p, 'kind')) rec.set('kind', util.oneOf(p, 'kind', KINDS, rec.getString('kind')));
  const krs = readKrs(p, util.jsonOf(rec, 'key_results', []) || []);
  if (krs !== undefined) rec.set('key_results', krs);
  if (util.has(p, 'weight')) rec.set('weight', util.int(p, 'weight', 0, 0, 100));
  if (util.has(p, 'status')) {
    const s = util.oneOf(p, 'status', STATUSES, rec.getString('status'));
    rec.set('status', s);
    if (s === 'done' && (util.jsonOf(rec, 'key_results', []) || []).length === 0) rec.set('progress', 100);
  }
  if (util.has(p, 'start_day')) rec.set('start_day', util.day(p, 'start_day', ''));
  if (util.has(p, 'due')) rec.set('due', util.day(p, 'due', ''));
  if (rec.getString('due') !== '' && rec.getString('start_day') !== '' && rec.getString('due') < rec.getString('start_day')) throw util.fail(400, 'The due day is before the start day.', 'invalid_param', { param: 'due' });
  if (util.has(p, 'cycle')) {
    const cyc = util.str(p, 'cycle', '');
    if (cyc !== '' && util.byId(app, 'review_cycles', cyc) === null) throw util.fail(404, 'No review cycle ' + cyc + '.', 'not_found');
    rec.set('cycle', cyc);
  }
  const oldParent = rec.getString('parent');
  if (util.has(p, 'parent')) rec.set('parent', checkParent(ctx, rec.id, util.str(p, 'parent', '')));
  rec.set('progress', computed(app, rec));
  app.save(rec);
  rollUp(app, rec);
  if (oldParent !== '' && oldParent !== rec.getString('parent')) {
    const op = util.byId(app, 'goals', oldParent);
    if (op !== null && (util.jsonOf(op, 'key_results', []) || []).length === 0) {
      op.set('progress', computed(app, op));
      app.save(op);
      rollUp(app, op);
    }
  }
  L('lib_audit').note(ctx, { collection: 'goals', record: rec.id, summary: 'Changed the goal "' + rec.getString('title') + '"', before: before, after: view(ctx, rec) });
  return { goal: view(ctx, rec) };
}

/** A check-in: a short note, the new progress or key result values, the status. */
function checkin(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rec = ref(ctx, util.req(p, 'goal'));
  needEdit(ctx, rec);
  if (rec.getString('status') === 'dropped') throw util.fail(409, 'This goal was dropped. Reopen it (goals.update --status on_track) to check in.', 'conflict');
  const before = { progress: rec.getInt('progress'), status: rec.getString('status') };
  const krs = util.jsonOf(rec, 'key_results', []) || [];
  const changes = [];
  if (util.has(p, 'key_results')) {
    let raw = util.scalar(p.key_results);
    if (typeof raw === 'string') {
      try {
        raw = raw.trim() === '' ? {} : JSON.parse(raw);
      } catch {
        throw util.fail(400, 'key_results must be JSON, e.g. {"kr1": 40} or [{"key":"kr1","current":40}]', 'invalid_param', { param: 'key_results' });
      }
    }
    const map = {};
    if (Array.isArray(raw)) {
      for (const it of raw) {
        util.keysOnly(it, ['key', 'current'], 'key_results item');
        map[String(it.key)] = it.current;
      }
    } else if (raw !== null && typeof raw === 'object') for (const k of Object.keys(raw)) map[k] = raw[k];
    else throw util.fail(400, 'key_results must be JSON, e.g. {"kr1": 40}', 'invalid_param', { param: 'key_results' });
    for (const key of Object.keys(map)) {
      const kr = krs.filter((k) => k.key === key)[0];
      if (kr === undefined) throw util.fail(400, 'No key result "' + key + '" on this goal. Keys: ' + krs.map((k) => k.key).join(', '), 'invalid_param', { param: 'key_results' });
      const v = typeof map[key] === 'number' ? map[key] : Number(String(map[key]).replace(/,/g, '').trim());
      if (!Number.isFinite(v)) throw util.fail(400, 'Key result "' + key + '": the value must be a number.', 'invalid_param', { param: 'key_results' });
      if (v !== Number(kr.current)) changes.push({ key: key, title: kr.title, before: Number(kr.current), after: v, unit: kr.unit || '' });
      kr.current = v;
    }
    rec.set('key_results', krs);
  }
  if (krs.length === 0 && util.has(p, 'progress')) rec.set('progress', util.int(p, 'progress', rec.getInt('progress'), 0, 100));
  if (util.has(p, 'status')) rec.set('status', util.oneOf(p, 'status', STATUSES.filter((s) => s !== 'dropped'), rec.getString('status')));
  if (rec.getString('status') === 'done' && krs.length === 0) rec.set('progress', 100);
  rec.set('progress', computed(app, rec));
  const note = util.text(p, 'note', 2000, '');
  if (note === '' && changes.length === 0 && before.progress === rec.getInt('progress') && before.status === rec.getString('status')) throw util.fail(400, 'Nothing to check in: write a short note or change the progress, a key result or the status.', 'missing_param', { param: 'note' });
  rec.set('last_checkin', util.nowIso());
  app.save(rec);
  rollUp(app, rec);
  const c = util.newRecord(app, 'goal_checkins');
  c.set('goal', rec.id);
  c.set('member', ctx.memberId || '');
  c.set('employee', ctx.isAgent ? '' : ctx.employeeId || '');
  c.set('actor', ctx.isAgent ? 'agent' : ctx.actor === 'person' ? 'person' : 'system');
  c.set('note', note);
  c.set('progress_before', before.progress);
  c.set('progress_after', rec.getInt('progress'));
  c.set('status_before', before.status);
  c.set('status_after', rec.getString('status'));
  c.set('key_results', changes);
  app.save(c);
  const emp = rec.getString('employee');
  const worse = (rec.getString('status') === 'off_track' || rec.getString('status') === 'at_risk') && before.status !== rec.getString('status');
  if (worse && emp !== '' && emp === ctx.employeeId) {
    const pr = core().person(ctx, emp);
    if (pr && pr.manager) core().notifyEmployee(app, pr.manager, { kind: 'performance', title: pr.name + ': "' + util.clip(rec.getString('title'), 100) + '" is ' + (rec.getString('status') === 'off_track' ? 'off track' : 'at risk'), link: '#/performance/goals/' + rec.id, facts: [{ type: 'state', key: 'status', value: rec.getString('status') }] });
  }
  L('lib_audit').note(ctx, { collection: 'goals', record: rec.id, summary: 'Checked in on "' + rec.getString('title') + '": ' + before.progress + '% to ' + rec.getInt('progress') + '%' + (before.status !== rec.getString('status') ? ', ' + rec.getString('status').replace('_', ' ') : '') });
  L('lib_events').emit(ctx, 'goal.checked_in', { goal: rec.id, employee: emp, progress: rec.getInt('progress'), status: rec.getString('status') });
  return { goal: view(ctx, rec), checkin: checkinView(ctx, c) };
}

function remove(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rec = ref(ctx, util.req(p, 'goal'));
  needEdit(ctx, rec);
  const title = rec.getString('title');
  const parent = rec.getString('parent');
  app.runInTransaction((tx) => {
    for (const k of tx.findRecordsByFilter('goals', 'parent = {:g}', '', 0, 0, { g: rec.id })) {
      const kid = tx.findRecordById('goals', k.id);
      kid.set('parent', parent);
      tx.save(kid);
    }
    tx.delete(tx.findRecordById('goals', rec.id));
    if (parent !== '') {
      const par = u().byId(tx, 'goals', parent);
      if (par !== null && (u().jsonOf(par, 'key_results', []) || []).length === 0) {
        par.set('progress', computed(tx, par));
        tx.save(par);
        rollUp(tx, par);
      }
    }
  });
  L('lib_audit').note(ctx, { collection: 'goals', record: rec.id, summary: 'Deleted the goal "' + title + '"' });
  return { deleted: true };
}

/** Goals of the person for a review: linked to the cycle, or open during its period. */
function forReview(ctx, employeeId, cycle) {
  const util = u();
  const app = ctx.app;
  const ps = cycle.getString('period_start');
  const pe = cycle.getString('period_end');
  const rows = util.rows(
    app,
    "SELECT id FROM goals WHERE employee = {:e} AND status != 'dropped' AND (cycle = {:c} OR (cycle = '' AND (due = '' OR due >= {:ps}) AND (start_day = '' OR start_day <= {:pe}))) ORDER BY weight DESC, title COLLATE NOCASE LIMIT 50",
    { id: '' },
    { e: employeeId, c: cycle.id, ps: ps, pe: pe },
  );
  return rows.map((r) => view(ctx, app.findRecordById('goals', r.id)));
}

/** Check-ins of a person's goals in a period (for review context). */
function checkinsIn(ctx, employeeId, from, to) {
  const util = u();
  return util
    .rows(ctx.app, "SELECT c.id AS id FROM goal_checkins c JOIN goals g ON g.id = c.goal WHERE g.employee = {:e} AND c.created >= {:f} AND c.created <= {:t} ORDER BY c.created DESC LIMIT 200", { id: '' }, { e: employeeId, f: from + ' 00:00:00', t: to + ' 23:59:59.999Z' })
    .map((r) => {
      const c = ctx.app.findRecordById('goal_checkins', r.id);
      const v = checkinView(ctx, c);
      v.goal_title = nameOf(ctx.app, 'goals', c.getString('goal'), 'title');
      return v;
    });
}

/* ----------------------------------------------------------- CSV in/out */

const CSV_COLUMNS = ['employee', 'department', 'title', 'kind', 'description', 'weight', 'start_day', 'due', 'status', 'kr_title', 'kr_start', 'kr_target', 'kr_current', 'kr_unit'];

function exportCsv(ctx, p) {
  const util = u();
  const app = ctx.app;
  const res = list(ctx, Object.assign({}, p, { limit: 300, offset: 0 }));
  let all = res.goals;
  let offset = all.length;
  for (let i = 0; i < 40 && offset < res.total; i++) {
    const more = list(ctx, Object.assign({}, p, { limit: 300, offset: offset })).goals;
    if (more.length === 0) break;
    all = all.concat(more);
    offset += more.length;
  }
  const rows = [CSV_COLUMNS.concat(['progress', 'parent', 'last_checkin'])];
  for (const g of all) {
    const base = [g.employee ? g.employee.number : '', g.department ? g.department.name : '', g.title, g.kind, g.description, g.weight, g.start_day, g.due, g.status];
    const tail = [g.progress, g.parent ? g.parent.title : '', g.last_checkin.slice(0, 10)];
    if (g.key_results.length === 0) rows.push(base.concat(['', '', '', '', '']).concat(tail));
    else for (const k of g.key_results) rows.push(base.concat([k.title, k.start, k.target, k.current, k.unit]).concat(tail));
  }
  L('lib_audit').write(ctx, { op: 'goals.export', collection: 'goals', summary: 'Exported ' + all.length + ' goals to CSV' });
  return { filename: 'goals-' + util.today(app) + '.csv', rows: rows.length - 1, csv: util.csvText(rows) };
}

/** Plan a goals CSV (rows with the same employee or department and title become one goal with several key results). */
function importPlan(ctx, text) {
  const util = u();
  const app = ctx.app;
  const parsed = util.csvObjects(text);
  const problems = [];
  for (const h of parsed.header) if (CSV_COLUMNS.indexOf(h) < 0 && ['progress', 'parent', 'last_checkin'].indexOf(h) < 0) problems.push({ row: 1, message: 'Unknown column "' + h + '". Columns: ' + CSV_COLUMNS.join(', ') });
  if (parsed.header.indexOf('title') < 0) problems.push({ row: 1, message: 'The title column is required.' });
  const goals = {};
  const order = [];
  parsed.items.forEach((it, i) => {
    const row = i + 2;
    const bad = (m) => problems.push({ row: row, message: m });
    if (!it.title) return bad('title is empty');
    let employee = '';
    let department = '';
    if (it.employee) {
      try {
        const e = L('lib_people').employeeRef(app, it.employee);
        if (!core().canManage(ctx, e.id) && !(ctx.employeeId === e.id)) return bad('you cannot add goals for ' + it.employee);
        employee = e.id;
      } catch (err) {
        return bad(String(err.message));
      }
    } else if (it.department) {
      try {
        department = L('lib_org').kindRef(app, 'department', it.department).id;
      } catch (err) {
        return bad(String(err.message));
      }
    }
    if (it.kind && KINDS.indexOf(it.kind) < 0) return bad('kind is one of ' + KINDS.join(', '));
    if (it.status && OPEN.concat(['done']).indexOf(it.status) < 0) return bad('status is one of on_track, at_risk, off_track, done');
    for (const d of ['start_day', 'due']) if (it[d] && !util.isDay(it[d])) return bad(d + ' must be YYYY-MM-DD');
    if (it.weight && !(Number(it.weight) >= 0 && Number(it.weight) <= 100)) return bad('weight is 0 to 100');
    for (const k of ['kr_start', 'kr_target', 'kr_current']) if (it[k] && !Number.isFinite(Number(String(it[k]).replace(/,/g, '')))) return bad(k + ' must be a number');
    const key = employee + '|' + department + '|' + it.title.toLowerCase();
    if (goals[key] === undefined) {
      goals[key] = { employee: employee, department: department, title: util.squash(it.title), kind: it.kind || '', description: it.description || '', weight: it.weight ? Number(it.weight) : 0, start_day: it.start_day || '', due: it.due || '', status: it.status || 'on_track', key_results: [] };
      order.push(key);
    }
    if (it.kr_title) goals[key].key_results.push({ title: it.kr_title, start: it.kr_start || 0, target: it.kr_target || 100, current: it.kr_current || it.kr_start || 0, unit: it.kr_unit || '' });
  });
  return { goals: order.map((k) => goals[k]), problems: problems, rows: parsed.items.length };
}

function importCheck(ctx, p) {
  const plan = importPlan(ctx, L('lib_files').csvInput(ctx, p, 'file', 'csv'));
  return { ok: plan.problems.length === 0, rows: plan.rows, goals: plan.goals.length, problems: plan.problems, preview: plan.goals.slice(0, 20) };
}

function importCommit(ctx, p) {
  const util = u();
  const plan = importPlan(ctx, L('lib_files').csvInput(ctx, p, 'file', 'csv'));
  if (plan.problems.length > 0) throw util.fail(400, 'The CSV has ' + plan.problems.length + ' problem(s); nothing was imported. Run goals.import-check to see them.', 'invalid_csv', { problems: plan.problems.slice(0, 50) });
  let n = 0;
  ctx.app.runInTransaction((tx) => {
    const t = L('lib_auth').withApp(ctx, tx);
    for (const g of plan.goals) {
      const params = { title: g.title, description: g.description, weight: g.weight, status: g.status === 'done' ? 'on_track' : g.status, key_results: g.key_results };
      if (g.kind) params.kind = g.kind;
      if (g.start_day) params.start_day = g.start_day;
      if (g.due) params.due = g.due;
      if (g.employee) params.employee = g.employee;
      else if (g.department) params.department = g.department;
      else params.company = true;
      const out = create(t, params);
      if (g.status === 'done') update(t, { goal: out.goal.id, status: 'done' });
      n++;
    }
  });
  L('lib_files').recordImport(ctx, 'goals', 'committed', { goals: n, rows: plan.rows }, plan.rows);
  L('lib_audit').note(ctx, { collection: 'goals', summary: 'Imported ' + n + ' goals from CSV' });
  return { imported: n };
}

function previewCreate(ctx, p) {
  const util = u();
  const who = util.str(p, 'employee', '') !== '' ? L('lib_people').displayName(L('lib_people').employeeRef(ctx.app, util.str(p, 'employee', ''))) : util.str(p, 'department', '') !== '' ? 'a team' : 'the company';
  const krs = util.list(p, 'key_results') || [];
  return {
    label: 'Add the goal "' + util.str(p, 'title', '') + '" for ' + who,
    target: '',
    fields: [{ name: 'title', before: '', after: util.str(p, 'title', '') }, { name: 'due', before: '', after: util.str(p, 'due', '') }, { name: 'key results', before: '', after: krs.map((k) => k.title + ' (' + (k.target === undefined ? '' : k.target) + (k.unit ? ' ' + k.unit : '') + ')').join('; ') }].filter((f) => f.after !== ''),
    notes: [],
    risk: 'low',
  };
}

function previewCheckin(ctx, p) {
  const util = u();
  const rec = util.byId(ctx.app, 'goals', util.str(p, 'goal', ''));
  const fields = [];
  if (rec !== null) {
    if (util.has(p, 'progress')) fields.push({ name: 'progress', before: rec.getInt('progress'), after: util.str(p, 'progress', '') });
    if (util.has(p, 'status')) fields.push({ name: 'status', before: rec.getString('status'), after: util.str(p, 'status', '') });
    if (util.has(p, 'key_results')) fields.push({ name: 'key results', before: (util.jsonOf(rec, 'key_results', []) || []).map((k) => k.key + ' ' + k.current).join(', '), after: JSON.stringify(util.obj(p, 'key_results') || util.list(p, 'key_results') || {}) });
    if (util.str(p, 'note', '') !== '') fields.push({ name: 'note', before: '', after: util.str(p, 'note', '') });
  }
  return { label: 'Check in on "' + (rec !== null ? rec.getString('title') : util.str(p, 'goal', '')) + '"', target: rec !== null ? 'goals:' + rec.id : '', fields: fields, notes: [], risk: 'low' };
}

module.exports = {
  KINDS: KINDS,
  STATUSES: STATUSES,
  krPct: krPct,
  krProgress: krProgress,
  scopeOf: scopeOf,
  canSeeGoal: canSeeGoal,
  canEditGoal: canEditGoal,
  needsUpdate: needsUpdate,
  view: view,
  list: list,
  listFor: listFor,
  needingUpdate: needingUpdate,
  get: get,
  tree: tree,
  create: create,
  update: update,
  checkin: checkin,
  remove: remove,
  forReview: forReview,
  checkinsIn: checkinsIn,
  exportCsv: exportCsv,
  importCheck: importCheck,
  importCommit: importCommit,
  previewCreate: previewCreate,
  previewCheckin: previewCheckin,
};
