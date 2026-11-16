/// <reference path="../pb_data/types.d.ts" />
/**
 * Checklists: templates (onboarding, offboarding, custom; one default per
 * entity and kind), the checklists started from them (on a hire, on an
 * approved separation, or by hand) and their tasks.
 *
 * A task belongs to one lane: hr, it, manager, employee (the person the
 * checklist is about), member (a named member) or agent (your AI agent).
 * Its due day is the checklist's anchor day (first day or last day) plus
 * the template's offset. Document tasks complete with an upload, stored as
 * a document of the person; signature tasks with the assignee's word.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}
function lc() {
  return L('lib_lifecycle');
}

const KINDS = ['onboarding', 'offboarding', 'custom'];
const LANES = ['hr', 'manager', 'it', 'employee', 'agent'];
const TASK_KINDS = ['task', 'document', 'signature'];
const ITEM_KEYS = ['key', 'title', 'description', 'assignee', 'due_offset_days', 'kind', 'document_category', 'needs_document'];
const MAX_TASKS = 120;

/* ------------------------------------------------------------ templates */

function keyFor(title, i, seen) {
  let base = u().slug(title).replace(/-/g, '_').slice(0, 30) || 'task';
  let k = base;
  let n = 2;
  while (seen[k]) k = base + '_' + n++;
  seen[k] = true;
  return k;
}

/** Give every template task a stable key (used to link checklist tasks back to their template line). */
function withKeys(items) {
  const seen = {};
  return items.map((x, i) => {
    const o = Object.assign({}, x);
    if (!o.key || seen[o.key]) o.key = keyFor(o.title, i, seen);
    else seen[o.key] = true;
    return o;
  });
}

/** Read an assignee: hr | manager | it | employee | agent | member:<member id or email>. */
function readAssignee(app, raw, where) {
  const util = u();
  const s = String(raw === undefined || raw === null ? '' : raw).trim();
  if (LANES.indexOf(s) >= 0) return s;
  if (s.indexOf('member:') === 0) {
    const m = L('lib_auth').memberRef(app, s.slice(7));
    return 'member:' + m.id;
  }
  throw util.fail(400, where + ': assignee is one of hr, manager, it, employee, agent or member:<member id or email> (got "' + s + '").', 'invalid_param', { param: 'assignee' });
}

/** Validate a template's task list (a JSON list). */
function readItems(app, raw) {
  const util = u();
  if (!Array.isArray(raw)) throw util.fail(400, 'tasks must be a JSON list of {title, assignee, due_offset_days, kind}.', 'invalid_param', { param: 'tasks' });
  if (raw.length > MAX_TASKS) throw util.fail(400, 'A checklist has at most ' + MAX_TASKS + ' tasks.', 'invalid_param', { param: 'tasks' });
  const out = raw.map((x, i) => {
    const where = 'task ' + (i + 1);
    if (x === null || typeof x !== 'object' || Array.isArray(x)) throw util.fail(400, where + ' must be an object.', 'invalid_param', { param: 'tasks' });
    util.keysOnly(x, ITEM_KEYS, where);
    const title = util.squash(x.title);
    if (title === '') throw util.fail(400, where + ': title is required.', 'invalid_param', { param: 'tasks' });
    if (title.length > 200) throw util.fail(400, where + ': title is too long (200 characters at most).', 'invalid_param', { param: 'tasks' });
    const due = x.due_offset_days === undefined || x.due_offset_days === null || x.due_offset_days === '' ? 0 : Number(x.due_offset_days);
    if (!Number.isInteger(due) || due < -365 || due > 365) throw util.fail(400, where + ': due_offset_days is a whole number of days from -365 to 365.', 'invalid_param', { param: 'tasks' });
    let kind = x.kind === undefined || x.kind === '' ? 'task' : String(x.kind);
    if (x.needs_document === true || x.needs_document === 'true') kind = 'document';
    if (TASK_KINDS.indexOf(kind) < 0) throw util.fail(400, where + ': kind is task, document or signature.', 'invalid_param', { param: 'tasks' });
    const desc = util.squash(x.description === undefined ? '' : x.description);
    if (desc.length > 2000) throw util.fail(400, where + ': description is too long.', 'invalid_param', { param: 'tasks' });
    const cat = util.slug(x.document_category === undefined ? '' : x.document_category).replace(/-/g, '_').slice(0, 60);
    return { key: x.key ? util.slug(String(x.key)).replace(/-/g, '_').slice(0, 40) : '', title: title, description: desc, assignee: readAssignee(app, x.assignee, where), due_offset_days: due, kind: kind, document_category: kind === 'document' || kind === 'signature' ? cat : '', needs_document: kind === 'document' };
  });
  return withKeys(out);
}

function assigneeLabel(app, a) {
  if (a === 'hr') return 'HR';
  if (a === 'it') return 'IT';
  if (a === 'manager') return 'Manager';
  if (a === 'employee') return 'The person';
  if (a === 'agent') return 'Your AI agent';
  if (String(a).indexOf('member:') === 0) return lc().memberName(app, String(a).slice(7)) || 'A member';
  return String(a);
}

function templateView(app, r) {
  const util = u();
  const tasks = (util.jsonOf(r, 'tasks', []) || []).map((x) => Object.assign({}, x, { assignee_label: assigneeLabel(app, x.assignee) }));
  return {
    id: r.id,
    kind: r.getString('kind'),
    name: r.getString('name'),
    entity: r.getString('entity'),
    entity_name: lc().entityName(app, r.getString('entity')),
    country: r.getString('country'),
    description: r.getString('description'),
    tasks: tasks,
    task_count: tasks.length,
    is_default: r.getBool('is_default'),
    builtin: r.getBool('builtin'),
    archived: r.getBool('archived'),
    used: util.count(app, 'SELECT COUNT(*) AS n FROM checklists WHERE template = {:t}', { t: r.id }),
    created: r.getString('created'),
    updated: r.getString('updated'),
  };
}

function templateRef(app, ref) {
  return u().byIdOrName(app, 'checklist_templates', ref, 'name', 'checklist-templates.list');
}

/** The default template of a kind for an entity: the entity's own, else a company-wide one (entity empty). */
function defaultTemplate(app, entityId, kind) {
  const util = u();
  return (
    util.findOne(app, 'checklist_templates', 'entity = {:e} && kind = {:k} && is_default = true && archived = false', { e: entityId, k: kind }) ||
    util.findOne(app, 'checklist_templates', "entity = '' && kind = {:k} && is_default = true && archived = false", { k: kind })
  );
}

function templatesList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const where = [];
  const bind = {};
  const kind = util.oneOf(p, 'kind', KINDS, '');
  if (kind !== '') {
    where.push('kind = {:k}');
    bind.k = kind;
  }
  const ent = util.str(p, 'entity', '');
  if (ent !== '') {
    where.push("(entity = {:e} || entity = '')");
    bind.e = L('lib_org').entityRef(app, ent).id;
  }
  if (!util.bool(p, 'archived', false)) where.push('archived = false');
  const rows = util.findMany(app, 'checklist_templates', where.length > 0 ? where.join(' && ') : '1=1', 'kind,name', 500, bind).filter((r) => r.getString('entity') === '' || L('lib_auth').inScope(ctx, r.getString('entity')));
  return { templates: rows.map((r) => templateView(app, r)), lanes: LANES, task_kinds: TASK_KINDS };
}

function templatesGet(ctx, p) {
  return { template: templateView(ctx.app, templateRef(ctx.app, u().req(p, 'template'))) };
}

/** Make one template the default of its entity and kind (and mirror the onboarding one on the entity). */
function setDefault(app, r) {
  const util = u();
  util.exec(app, 'UPDATE checklist_templates SET is_default = FALSE WHERE entity = {:e} AND kind = {:k} AND id != {:id}', { e: r.getString('entity'), k: r.getString('kind'), id: r.id });
  L('lib_bus').touch('checklist_templates');
  if (r.getString('kind') === 'onboarding' && r.getString('entity') !== '') {
    const e = app.findRecordById('entities', r.getString('entity'));
    e.set('default_onboarding_template', r.id);
    app.save(e);
  }
}

function templatesSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const ref = util.str(p, 'template', '');
  const rec = ref !== '' ? templateRef(app, ref) : util.newRecord(app, 'checklist_templates');
  const before = ref !== '' ? templateView(app, rec) : null;
  if (ref !== '') lc().needHr(ctx, rec.getString('entity'), 'edit', 'change checklist templates');
  if (ref === '' || util.has(p, 'kind')) rec.set('kind', util.oneOf(p, 'kind', KINDS, ref === '' ? 'onboarding' : rec.getString('kind')));
  if (ref === '' || util.has(p, 'name')) {
    const n = util.squash(util.text(p, 'name', 120, ''));
    if (n === '') throw util.fail(400, 'name is required, e.g. --name "Onboarding (Singapore)"', 'missing_param', { param: 'name' });
    rec.set('name', n);
  }
  if (util.has(p, 'entity')) {
    const e = util.str(p, 'entity', '');
    const ent = e === '' ? null : L('lib_org').entityRef(app, e);
    rec.set('entity', ent === null ? '' : ent.id);
    rec.set('country', ent === null ? '' : ent.getString('country'));
  }
  lc().needHr(ctx, rec.getString('entity'), 'edit', 'change checklist templates');
  if (util.has(p, 'description')) rec.set('description', util.text(p, 'description', 1000, ''));
  if (util.has(p, 'tasks')) rec.set('tasks', readItems(app, util.list(p, 'tasks')));
  else if (ref === '') rec.set('tasks', []);
  if (util.has(p, 'archived')) rec.set('archived', util.bool(p, 'archived', false));
  if (ref === '') rec.set('builtin', false);
  if (ref === '') rec.set('created_by', ctx.memberId || '');
  const makeDefault = util.has(p, 'is_default') ? util.bool(p, 'is_default', false) : ref === '' ? defaultTemplate(app, rec.getString('entity'), rec.getString('kind')) === null && rec.getString('kind') !== 'custom' : rec.getBool('is_default');
  if (rec.getBool('archived') && makeDefault) throw util.fail(409, 'An archived template cannot be the default.', 'invalid');
  rec.set('is_default', makeDefault);
  lc().inTx(app, (tx) => {
    tx.save(rec);
    if (makeDefault) setDefault(tx, rec);
  });
  const after = templateView(app, rec);
  L('lib_audit').note(ctx, { collection: 'checklist_templates', record: rec.id, summary: (ref === '' ? 'Added' : 'Changed') + ' the checklist template ' + after.name + ' (' + after.task_count + ' tasks)', before: before, after: after });
  return { template: after };
}

function templatesCopy(ctx, p) {
  const util = u();
  const app = ctx.app;
  const src = templateRef(app, util.req(p, 'template'));
  const r = util.newRecord(app, 'checklist_templates');
  r.set('kind', src.getString('kind'));
  r.set('name', util.squash(util.text(p, 'name', 120, '')) || 'Copy of ' + src.getString('name'));
  const ent = util.has(p, 'entity') ? util.str(p, 'entity', '') : src.getString('entity');
  const er = ent === '' ? null : L('lib_org').entityRef(app, ent);
  lc().needHr(ctx, er === null ? '' : er.id, 'edit', 'add checklist templates');
  r.set('entity', er === null ? '' : er.id);
  r.set('country', er === null ? '' : er.getString('country'));
  r.set('description', src.getString('description'));
  r.set('tasks', util.jsonOf(src, 'tasks', []) || []);
  r.set('is_default', false);
  r.set('builtin', false);
  r.set('archived', false);
  r.set('created_by', ctx.memberId || '');
  app.save(r);
  L('lib_audit').note(ctx, { collection: 'checklist_templates', record: r.id, summary: 'Copied the checklist template ' + src.getString('name') + ' as ' + r.getString('name') });
  return { template: templateView(app, r) };
}

function templatesDelete(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = templateRef(app, util.req(p, 'template'));
  lc().needHr(ctx, r.getString('entity'), 'full', 'delete checklist templates');
  const used = util.count(app, 'SELECT COUNT(*) AS n FROM checklists WHERE template = {:t}', { t: r.id });
  if (used > 0) throw util.fail(409, 'This template started ' + used + (used === 1 ? ' checklist' : ' checklists') + '. Archive it instead (checklist-templates.save --archived true).', 'in_use');
  if (r.getString('kind') === 'onboarding' && r.getString('entity') !== '') {
    const e = app.findRecordById('entities', r.getString('entity'));
    if (e.getString('default_onboarding_template') === r.id) {
      e.set('default_onboarding_template', '');
      app.save(e);
    }
  }
  app.delete(r);
  L('lib_audit').note(ctx, { collection: 'checklist_templates', record: r.id, summary: 'Deleted the checklist template ' + r.getString('name') });
  return { deleted: true };
}

/** checklist-templates.seed: add the country defaults an entity lacks (templates, letters, exit form, grievance types). */
function templatesSeed(ctx, p) {
  const util = u();
  const ent = L('lib_org').entityRef(ctx.app, util.req(p, 'entity'));
  lc().needHr(ctx, ent.id, 'edit', 'add checklist templates');
  const added = lc().seedEntity(ctx, ent.id);
  L('lib_audit').note(ctx, { collection: 'entities', record: ent.id, summary: 'Added the lifecycle defaults of ' + ent.getString('name') + ' (' + added.templates + ' checklist templates, ' + added.letters + ' letter templates)' });
  return { added: added, templates: templatesList(ctx, { entity: ent.id }).templates };
}

/* ----------------------------------------------------------- checklists */

function openChecklist(app, employmentId, kind) {
  return u().findOne(app, 'checklists', "employment = {:m} && kind = {:k} && status = 'open'", { m: employmentId, k: kind });
}

function latestChecklist(app, employmentId, kind) {
  const r = u().findMany(app, 'checklists', "employment = {:m} && kind = {:k} && status != 'cancelled'", '-created', 1, { m: employmentId, k: kind });
  return r.length > 0 ? r[0] : null;
}

/** Resolve a template assignee for a checklist: { kind, member }. */
function resolve(app, assignee, m, day) {
  if (String(assignee).indexOf('member:') === 0) {
    const mm = u().byId(app, 'members', String(assignee).slice(7));
    if (mm !== null && mm.getString('status') === 'active') return { kind: 'member', member: mm.id };
    return { kind: 'hr', member: '' };
  }
  if (assignee === 'manager') {
    const mgr = L('lib_people').managerOf(app, m.id, day);
    return { kind: 'manager', member: mgr !== null ? lc().memberOfEmployee(app, mgr.id) : '' };
  }
  return { kind: assignee, member: '' };
}

/** The day the manager is read on: the first day for someone not started yet, else today. */
function managerDay(app, m) {
  return lc().later(u().today(app, m.getString('entity')), m.getString('start_day'));
}

/**
 * One task record. `pre` (optional, from startChecklist) carries what is the same for
 * every task of a list: the tasks collection, today, and the resolved assignees.
 */
function newTask(app, c, m, item, sort, pre) {
  const util = u();
  const a = String(item.assignee);
  let who = pre ? pre.who[a] : undefined;
  if (who === undefined) {
    who = resolve(app, item.assignee, m, pre ? pre.managerDay : managerDay(app, m));
    if (pre) pre.who[a] = who;
  }
  const t = pre ? new Record(pre.col) : util.newRecord(app, 'tasks');
  t.set('checklist', c.id);
  t.set('employment', m.id);
  t.set('employee', m.getString('employee'));
  t.set('entity', m.getString('entity'));
  t.set('title', util.clip(item.title, 200));
  t.set('description', util.clip(item.description || '', 2000));
  t.set('assignee_kind', who.kind);
  t.set('assignee_member', who.member);
  // A template task whose day is already past when the list starts (a hire made close to the first day) is due today, not late.
  const today = pre ? pre.today : util.today(app, m.getString('entity'));
  const planned = item.due !== undefined ? item.due : util.dayAdd(c.getString('anchor_day'), Number(item.due_offset_days) || 0);
  t.set('due', item.due === undefined && planned !== '' && planned < today ? today : planned);
  t.set('status', 'open');
  t.set('kind', TASK_KINDS.indexOf(item.kind) >= 0 ? item.kind : 'task');
  t.set('document_category', item.document_category || '');
  t.set('link', item.link || '');
  t.set('sort', sort);
  t.set('template_key', item.key || '');
  // A list's tasks come from a template already checked by readItems: no field re-validation per task.
  if (pre) app.saveNoValidate(t);
  else app.save(t);
  return t;
}

function agentTasksOpen(app, checklistId) {
  return u().count(app, "SELECT COUNT(*) AS n FROM tasks WHERE checklist = {:c} AND assignee_kind = 'agent' AND status = 'open'", { c: checklistId });
}

/**
 * Ask your AI agent to do the open tasks assigned to it on a checklist
 * (onboarding_help with the checklist's id; once while that ask is open).
 * who: a person's ctx, or an app for Automatic work; o: lib_agent.ask options.
 * Returns the ask's answer, or null when no open task is your AI agent's.
 */
function askAgent(who, c, o) {
  const app = who && who.app ? who.app : who;
  if (agentTasksOpen(app, c.id) === 0) return null;
  return L('lib_agent').ask(who, c, 'onboarding_help', o || {});
}

/** No open task of your AI agent is left on the checklist: its onboarding_help ask is closed. */
function settleAgentAsk(app, checklistId, outcome) {
  const c = u().byId(app, 'checklists', checklistId);
  if (c === null || agentTasksOpen(app, checklistId) > 0) return false;
  return L('lib_agent').end(app, c, 'onboarding_help', outcome || 'done');
}

/** agent.retry on onboarding_help: HR edit rights, an open checklist with a task of your AI agent. */
function mayAsk(ctx, c) {
  lc().needHr(ctx, c.getString('entity'), 'edit', 'ask your AI agent about checklists');
  if (c.getString('status') !== 'open' || agentTasksOpen(ctx.app, c.id) === 0) throw u().fail(409, 'No open task on this checklist is assigned to your AI agent.', 'invalid');
}

/**
 * Start a checklist (callers check rights): o = { employment (record), kind,
 * template (record or null), anchor_day, name, separation, tasks (items
 * when no template), today, deferAgent }. Returns { id, tasks }. Your AI
 * agent is asked about its tasks only when the company switched
 * "Start your AI agent's checklist tasks" on (Automatic work); with
 * deferAgent (event subscribers: a hire, an ending, an approved separation,
 * inside the caller's transaction) the ask is sent by the minute job.
 */
function startChecklist(ctx, o) {
  const util = u();
  const m = o.employment;
  const today = o.today || util.today(ctx.app, m.getString('entity'));
  const items = o.template ? util.jsonOf(o.template, 'tasks', []) || [] : o.tasks || [];
  let id = '';
  let count = 0;
  lc().inTx(ctx.app, (tx) => {
    const c = util.newRecord(tx, 'checklists');
    c.set('employment', m.id);
    c.set('employee', m.getString('employee'));
    c.set('entity', m.getString('entity'));
    c.set('kind', o.kind);
    c.set('template', o.template ? o.template.id : '');
    c.set('name', util.clip(o.name || (o.template ? o.template.getString('name') : o.kind === 'onboarding' ? 'Onboarding' : o.kind === 'offboarding' ? 'Offboarding' : 'Checklist'), 120));
    c.set('status', 'open');
    c.set('anchor_day', o.anchor_day);
    c.set('separation', o.separation || '');
    c.set('first_day', {});
    c.set('started_by', ctx.memberId || '');
    c.set('started_actor', ctx.isAgent ? 'agent' : ctx.actor === 'person' ? 'person' : 'system');
    tx.save(c);
    // Read once for the whole list: the collection, today, each assignee (the manager once).
    const pre = { col: tx.findCollectionByNameOrId('tasks'), today: today, managerDay: lc().later(today, m.getString('start_day')), who: {} };
    const agentTasks = [];
    items.forEach((item, i) => {
      const t = newTask(tx, c, m, item, (i + 1) * 10, pre);
      if (t.getString('assignee_kind') === 'agent') agentTasks.push(t);
      count++;
    });
    id = c.id;
    if (agentTasks.length > 0 && o.deferAgent === true && L('lib_agent').autoOn(tx, 'checklist_tasks')) L('lib_agent').ask(tx, c, 'onboarding_help', { source: 'checklist_tasks', later: true });
  });
  if (o.deferAgent !== true && L('lib_agent').autoOn(ctx.app, 'checklist_tasks')) askAgent(ctx.app, ctx.app.findRecordById('checklists', id), { source: 'checklist_tasks', defer: true });
  return { id: id, tasks: count };
}

function checklistView(app, c) {
  const people = L('lib_people');
  const e = u().byId(app, 'employees', c.getString('employee'));
  const m = u().byId(app, 'employments', c.getString('employment'));
  const job = m !== null ? people.rowOn(app, 'job_records', m.id, c.getString('kind') === 'onboarding' ? lc().later(c.getString('anchor_day'), u().today(app)) : u().today(app)) || people.rowOn(app, 'job_records', m.id, '9999-12-31') : null;
  const tpl = u().byId(app, 'checklist_templates', c.getString('template'));
  return {
    id: c.id,
    kind: c.getString('kind'),
    name: c.getString('name'),
    status: c.getString('status'),
    anchor_day: c.getString('anchor_day'),
    anchor_shown: lc().dayIn(app, c.getString('entity'), c.getString('anchor_day')),
    employment: c.getString('employment'),
    employee: c.getString('employee'),
    employee_name: e !== null ? people.displayName(e) : '',
    employee_number: e !== null ? e.getString('number') : '',
    employee_status: e !== null ? e.getString('status') : '',
    photo: e !== null && e.getString('photo') !== '',
    title: job !== null ? job.getString('title') : '',
    entity: c.getString('entity'),
    entity_name: lc().entityName(app, c.getString('entity')),
    template: c.getString('template'),
    template_name: tpl !== null ? tpl.getString('name') : '',
    separation: c.getString('separation'),
    first_day: u().jsonOf(c, 'first_day', {}) || {},
    started_actor: c.getString('started_actor'),
    started_by_name: c.getString('started_actor') === 'agent' ? 'Your AI agent' : c.getString('started_actor') === 'system' ? 'HR OS' : lc().memberName(app, c.getString('started_by')),
    done_at: c.getString('done_at'),
    created: c.getString('created'),
  };
}

/** Progress of a checklist: { id, kind, name, status, anchor_day, progress: { done, skipped, open, overdue, total, percent } }. */
function progressOf(app, c) {
  const util = u();
  const today = util.today(app, c.getString('entity'));
  const r = util.one(
    app,
    "SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END), 0) AS done, COALESCE(SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END), 0) AS skipped, COALESCE(SUM(CASE WHEN status = 'open' AND due != '' AND due < {:d} THEN 1 ELSE 0 END), 0) AS overdue FROM tasks WHERE checklist = {:c}",
    { total: 0, done: 0, skipped: 0, overdue: 0 },
    { c: c.id, d: today },
  ) || { total: 0, done: 0, skipped: 0, overdue: 0 };
  const closed = r.done + r.skipped;
  return {
    id: c.id,
    kind: c.getString('kind'),
    name: c.getString('name'),
    status: c.getString('status'),
    anchor_day: c.getString('anchor_day'),
    progress: { done: r.done, skipped: r.skipped, open: r.total - closed, overdue: r.overdue, total: r.total, percent: r.total === 0 ? 100 : Math.round((closed * 100) / r.total) },
  };
}

/** What the caller may see of a checklist: 'all' (HR, your AI agent, the manager), 'own' (the person: their tasks), 'tasks' (someone with a task on it), '' (nothing). */
function seeChecklist(ctx, c) {
  const util = u();
  if (ctx.isAgent || ctx.actor === 'system') return 'all';
  if (lc().hrCan(ctx, c.getString('entity'), 'view')) return 'all';
  if (ctx.memberId !== '' && util.count(ctx.app, "SELECT COUNT(*) AS n FROM tasks WHERE checklist = {:c} AND assignee_kind = 'manager' AND assignee_member = {:me}", { c: c.id, me: ctx.memberId }) > 0) return 'all';
  if (ctx.teamScope && L('lib_auth').isManagerOf(ctx, c.getString('employment'), managerDay(ctx.app, ctx.app.findRecordById('employments', c.getString('employment'))))) return 'all';
  if (L('lib_auth').selfEmployee(ctx) === c.getString('employee')) return 'own';
  const mine = util.count(ctx.app, 'SELECT COUNT(*) AS n FROM tasks t WHERE t.checklist = {:c} AND ' + mineSql(ctx, { c: c.id }), Object.assign({ c: c.id }, mineBind(ctx)));
  return mine > 0 ? 'tasks' : '';
}

function checklistRef(app, ref) {
  const r = u().byId(app, 'checklists', String(ref || ''));
  if (r === null) throw u().fail(404, 'No checklist ' + ref + '. Run checklists.list.', 'not_found');
  return r;
}

function checklistsList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const pg = util.page(p, 50, 300);
  const bind = {};
  const where = [];
  const status = util.oneOf(p, 'status', ['open', 'done', 'cancelled', 'all'], 'open');
  if (status !== 'all') {
    where.push('c.status = {:st}');
    bind.st = status;
  }
  const kind = util.oneOf(p, 'kind', KINDS, '');
  if (kind !== '') {
    where.push('c.kind = {:k}');
    bind.k = kind;
  }
  const empRef = util.str(p, 'employee', '');
  if (empRef !== '') {
    where.push('c.employee = {:e}');
    bind.e = L('lib_people').employeeRef(app, empRef).id;
  }
  const ent = util.str(p, 'entity', '');
  if (ent !== '') {
    where.push('c.entity = {:en}');
    bind.en = L('lib_org').entityRef(app, ent).id;
  }
  if (lc().hrCan(ctx, '', 'view')) where.push(lc().scopeSql(ctx, 'c', bind));
  else {
    // Managers: checklists with a manager task for them or of their reports; everyone: their own.
    const parts = ['c.employee = {:self}'];
    bind.self = ctx.employeeId || '-';
    bind.me = ctx.memberId || '-';
    parts.push("EXISTS (SELECT 1 FROM tasks t WHERE t.checklist = c.id AND t.assignee_kind = 'manager' AND t.assignee_member = {:me})");
    if (ctx.teamScope && ctx.employeeId !== '') {
      const ids = L('lib_people').reportsOf(app, ctx.employeeId, util.today(app), true).map((r) => r.employment);
      if (ids.length > 0) parts.push('c.employment IN (' + ids.map((id, i) => ((bind['r' + i] = id), '{:r' + i + '}')).join(',') + ')');
    }
    where.push('(' + parts.join(' OR ') + ')');
  }
  const w = where.length > 0 ? where.join(' AND ') : '1 = 1';
  const total = util.count(app, 'SELECT COUNT(*) AS n FROM checklists c WHERE ' + w, bind);
  const rows = util.rows(app, 'SELECT c.id AS id FROM checklists c WHERE ' + w + " ORDER BY c.status = 'open' DESC, c.anchor_day " + (status === 'open' ? 'ASC' : 'DESC') + ' LIMIT ' + pg.limit + ' OFFSET ' + pg.offset, { id: '' }, bind);
  return {
    checklists: rows.map((r) => {
      const c = app.findRecordById('checklists', r.id);
      const v = checklistView(app, c);
      v.progress = progressOf(app, c).progress;
      return v;
    }),
    total: total,
    limit: pg.limit,
    offset: pg.offset,
  };
}

function checklistsGet(ctx, p) {
  const util = u();
  const app = ctx.app;
  const c = checklistRef(app, util.req(p, 'checklist'));
  const see = seeChecklist(ctx, c);
  if (see === '') throw util.fail(403, 'You cannot see this checklist.', 'not_permitted');
  const v = checklistView(app, c);
  v.progress = progressOf(app, c).progress;
  const all = util.findMany(app, 'tasks', 'checklist = {:c}', 'due,sort', 500, { c: c.id });
  const memo = viewMemo(ctx);
  const tasks = (see === 'all' ? all : all.filter((t) => canAct(ctx, t, memo))).map((t) => taskView(ctx, t, c, memo));
  v.tasks = tasks;
  v.see = see;
  v.can = { edit: !ctx.isAgent && lc().hrCan(ctx, c.getString('entity'), 'edit'), ask_agent: !ctx.isAgent && lc().hrCan(ctx, c.getString('entity'), 'edit') && all.some((t) => t.getString('assignee_kind') === 'agent' && t.getString('status') === 'open') };
  v.agent = L('lib_agent').view(c, 'onboarding_help');
  v.no_it_team = lc().noItTeam(app);
  return { checklist: v };
}

function anchorFor(app, m, kind, p) {
  const util = u();
  const given = util.day(p, 'anchor_day', '');
  if (given !== '') return given;
  if (kind === 'onboarding') return m.getString('start_day');
  if (kind === 'offboarding' && m.getString('end_day') !== '') return m.getString('end_day');
  return util.today(app, m.getString('entity'));
}

function checklistsStart(ctx, p) {
  const util = u();
  const app = ctx.app;
  const m = lc().employmentOf(app, util.req(p, 'employment'));
  lc().needHr(ctx, m.getString('entity'), 'edit', 'start checklists');
  const kind = util.oneOf(p, 'kind', KINDS, 'custom');
  if (kind !== 'custom' && openChecklist(app, m.id, kind) !== null) throw util.fail(409, lc().employeeName(app, m.getString('employee')) + ' already has an open ' + kind + ' checklist.', 'duplicate');
  const tplRef = util.str(p, 'template', '');
  const tpl = tplRef !== '' ? templateRef(app, tplRef) : defaultTemplate(app, m.getString('entity'), kind);
  if (tpl === null && kind !== 'custom') throw util.fail(409, 'There is no default ' + kind + ' template for this entity. Add one (checklist-templates.seed --entity ...) or give --template.', 'no_template');
  if (tpl !== null && tpl.getString('kind') !== kind) throw util.fail(400, 'The template ' + tpl.getString('name') + ' is for ' + tpl.getString('kind') + ', not ' + kind + '.', 'invalid_param', { param: 'template' });
  const anchor = anchorFor(app, m, kind, p);
  const out = startChecklist(ctx, { employment: m, kind: kind, template: tpl, anchor_day: anchor, name: util.squash(util.text(p, 'name', 120, '')) });
  const c = app.findRecordById('checklists', out.id);
  L('lib_audit').note(ctx, { collection: 'checklists', record: c.id, summary: 'Started ' + c.getString('name') + ' for ' + lc().employeeName(app, m.getString('employee')) + ' (' + out.tasks + ' tasks, from ' + anchor + ')' });
  return checklistsGet(ctx, { checklist: c.id });
}

function previewStart(ctx, p) {
  const util = u();
  const app = ctx.app;
  const m = lc().employmentOf(app, util.str(p, 'employment', ''));
  const kind = util.oneOf(p, 'kind', KINDS, 'custom');
  const tplRef = util.str(p, 'template', '');
  const tpl = tplRef !== '' ? templateRef(app, tplRef) : defaultTemplate(app, m.getString('entity'), kind);
  const items = tpl !== null ? util.jsonOf(tpl, 'tasks', []) || [] : [];
  return {
    label: 'Start ' + (tpl !== null ? tpl.getString('name') : kind) + ' for ' + lc().employeeName(app, m.getString('employee')),
    target: 'employments:' + m.id,
    fields: [
      { name: 'checklist', before: '', after: tpl !== null ? tpl.getString('name') : kind },
      { name: 'from', before: '', after: anchorFor(app, m, kind, p) },
      { name: 'tasks', before: '', after: items.length },
    ],
    notes: items.slice(0, 8).map((x) => x.title + ' (' + assigneeLabel(app, x.assignee) + ')'),
    risk: 'low',
  };
}

/** Close a checklist when every task is done or skipped; emits checklist.completed. */
function maybeFinish(ctx, checklistId) {
  const util = u();
  const app = ctx.app;
  const c = util.byId(app, 'checklists', checklistId);
  if (c === null || c.getString('status') !== 'open') return false;
  const open = util.count(app, "SELECT COUNT(*) AS n FROM tasks WHERE checklist = {:c} AND status = 'open'", { c: c.id });
  if (open > 0) return false;
  c.set('status', 'done');
  c.set('done_at', util.nowIso());
  app.save(c);
  L('lib_agent').end(app, c, 'onboarding_help', 'done', 'The checklist is complete.');
  L('lib_events').emit(ctx, 'checklist.completed', { checklist: c.id, employment: c.getString('employment'), kind: c.getString('kind') });
  return true;
}

function checklistsCancel(ctx, p) {
  const util = u();
  const app = ctx.app;
  const c = checklistRef(app, util.req(p, 'checklist'));
  lc().needHr(ctx, c.getString('entity'), 'edit', 'cancel checklists');
  if (c.getString('status') !== 'open') throw util.fail(409, 'This checklist is already ' + c.getString('status') + '.', 'conflict');
  c.set('status', 'cancelled');
  c.set('note', util.text(p, 'note', 2000, c.getString('note')));
  app.save(c);
  L('lib_agent').end(app, c, 'onboarding_help', 'closed', 'The checklist was cancelled.');
  L('lib_audit').note(ctx, { collection: 'checklists', record: c.id, summary: 'Cancelled ' + c.getString('name') + ' of ' + lc().employeeName(app, c.getString('employee')) });
  return checklistsGet(ctx, { checklist: c.id });
}

/** checklists.first-day: what the new hire sees on their welcome page. */
function checklistsFirstDay(ctx, p) {
  const util = u();
  const app = ctx.app;
  const c = checklistRef(app, util.req(p, 'checklist'));
  lc().needHr(ctx, c.getString('entity'), 'edit', 'change first-day details');
  const before = util.jsonOf(c, 'first_day', {}) || {};
  const fd = Object.assign({}, before);
  if (util.has(p, 'time')) {
    const t = util.str(p, 'time', '');
    if (t !== '' && !util.isTime(t)) throw util.fail(400, 'time is HH:MM, e.g. 09:00', 'invalid_param', { param: 'time' });
    fd.time = t;
  }
  if (util.has(p, 'place')) fd.place = util.text(p, 'place', 300, '');
  if (util.has(p, 'contact')) {
    const ref = util.str(p, 'contact', '');
    const e = ref === '' ? null : L('lib_people').employeeRef(app, ref);
    fd.contact = e === null ? '' : e.id;
    fd.contact_name = e === null ? '' : L('lib_people').displayName(e);
  }
  if (util.has(p, 'bring')) fd.bring = util.text(p, 'bring', 1000, '');
  if (util.has(p, 'note')) fd.note = util.text(p, 'note', 2000, '');
  c.set('first_day', fd);
  app.save(c);
  L('lib_audit').note(ctx, { collection: 'checklists', record: c.id, summary: 'Changed the first-day details for ' + lc().employeeName(app, c.getString('employee')), before: before, after: fd });
  return checklistsGet(ctx, { checklist: c.id });
}

function previewFirstDay(ctx, p) {
  const util = u();
  const c = checklistRef(ctx.app, util.str(p, 'checklist', ''));
  const before = util.jsonOf(c, 'first_day', {}) || {};
  const fields = [];
  for (const k of ['time', 'place', 'contact', 'bring', 'note']) if (util.has(p, k)) fields.push({ name: k, before: k === 'contact' ? before.contact_name || '' : before[k] || '', after: util.str(p, k, '') });
  return { label: 'First-day details for ' + lc().employeeName(ctx.app, c.getString('employee')), target: 'checklists:' + c.id, fields: fields, notes: [], risk: 'low' };
}

function checklistsAskAgent(ctx, p) {
  const util = u();
  const c = checklistRef(ctx.app, util.req(p, 'checklist'));
  mayAsk(ctx, c);
  const a = askAgent(ctx, c, {});
  if (a === null) throw util.fail(409, 'No open task on this checklist is assigned to your AI agent.', 'invalid');
  L('lib_audit').note(ctx, { collection: 'checklists', record: c.id, summary: (a.asked ? 'Asked your AI agent to help with ' : 'Your AI agent is already asked about ') + c.getString('name'), after: { trigger: 'onboarding_help', request: a.request } });
  return { asked: a.asked, agent: L('lib_agent').view(ctx.app.findRecordById('checklists', c.id), 'onboarding_help') };
}

/** Open manager tasks of an employment follow its manager (after a job record change). */
function refreshManagerTasks(app, employmentId) {
  const util = u();
  const m = util.byId(app, 'employments', employmentId);
  if (m === null) return 0;
  const mgr = L('lib_people').managerOf(app, m.id, managerDay(app, m));
  const member = mgr !== null ? lc().memberOfEmployee(app, mgr.id) : '';
  let n = 0;
  for (const t of util.findMany(app, 'tasks', "employment = {:m} && assignee_kind = 'manager' && status = 'open'", '', 0, { m: m.id })) {
    if (t.getString('assignee_member') === member) continue;
    t.set('assignee_member', member);
    app.save(t);
    n++;
  }
  return n;
}

/* ---------------------------------------------------------------- tasks */

function mineBind(ctx) {
  return { me: ctx.memberId || '-', self: ctx.employeeId || '-' };
}

/** SQL (alias t) for tasks assigned to the caller; adds its scope binds to `bind`. */
function mineSql(ctx, bind) {
  if (ctx.isAgent) return "t.assignee_kind = 'agent'";
  if (ctx.actor !== 'person') return '1 = 0';
  const parts = ["(t.assignee_kind IN ('manager', 'member') AND t.assignee_member = {:me})"];
  if (ctx.employeeId !== '') parts.push("(t.assignee_kind = 'employee' AND t.employee = {:self})");
  const app = ctx.app;
  const sc = lc().scopeSql(ctx, 't', bind);
  if (lc().hrCan(ctx, '', 'edit')) parts.push("((t.assignee_kind = 'hr' OR (t.assignee_kind IN ('manager', 'member') AND t.assignee_member = '')" + (lc().noItTeam(app) ? " OR t.assignee_kind = 'it'" : '') + ') AND ' + sc + ')');
  if (lc().isIt(ctx)) parts.push("(t.assignee_kind = 'it' AND " + sc + ')');
  return '(' + parts.join(' OR ') + ')';
}

/**
 * What many task rows of one answer share, read once per call: today and
 * the date style per entity, people's names and numbers, member names,
 * checklists, the caller's HR right per entity.
 */
function viewMemo(ctx) {
  const util = u();
  const app = ctx.app;
  const m = { today: {}, emp: {}, member: {}, hr: {}, fmt: {}, list: {} };
  return {
    today: (e) => (m.today[e] !== undefined ? m.today[e] : (m.today[e] = util.today(app, e))),
    employee: (id) => {
      if (m.emp[id] === undefined) {
        const r = util.byId(app, 'employees', id || '');
        m.emp[id] = r === null ? { name: '', number: '' } : { name: L('lib_people').displayName(r), number: r.getString('number') };
      }
      return m.emp[id];
    },
    memberName: (id) => (id === '' ? '' : m.member[id] !== undefined ? m.member[id] : (m.member[id] = lc().memberName(app, id))),
    hrEdit: (e) => (m.hr[e] !== undefined ? m.hr[e] : (m.hr[e] = lc().hrCan(ctx, e, 'edit'))),
    dayIn: (e, d) => {
      if (m.fmt[e] === undefined) m.fmt[e] = lc().dateFormatOf(app, e);
      return lc().dayAs(m.fmt[e], d);
    },
    checklist: (id) => (m.list[id] !== undefined ? m.list[id] : (m.list[id] = util.byId(app, 'checklists', id))),
  };
}

/** May the caller complete, skip or reopen this task? */
function canAct(ctx, t, memo) {
  const app = ctx.app;
  const kind = t.getString('assignee_kind');
  if (ctx.isAgent) return kind === 'agent';
  if (ctx.actor === 'system') return true;
  if (memo ? memo.hrEdit(t.getString('entity')) : lc().hrCan(ctx, t.getString('entity'), 'edit')) return true;
  if ((kind === 'manager' || kind === 'member') && t.getString('assignee_member') === ctx.memberId) return true;
  if (kind === 'employee' && ctx.employeeId !== '' && t.getString('employee') === ctx.employeeId) return true;
  if (kind === 'it' && lc().isIt(ctx) && L('lib_auth').inScope(ctx, t.getString('entity'))) return true;
  return false;
}

function laneLabel(app, t, memo) {
  const kind = t.getString('assignee_kind');
  if (kind === 'hr') return 'HR';
  if (kind === 'it') return 'IT';
  if (kind === 'agent') return 'Your AI agent';
  if (kind === 'employee') return memo ? memo.employee(t.getString('employee')).name : lc().employeeName(app, t.getString('employee'));
  const name = memo ? memo.memberName(t.getString('assignee_member')) : lc().memberName(app, t.getString('assignee_member'));
  if (kind === 'manager') return name !== '' ? name : 'Manager (no account yet)';
  return name !== '' ? name : 'Member (no longer active)';
}

function taskView(ctx, t, c0, memo0) {
  const util = u();
  const app = ctx.app;
  const memo = memo0 || viewMemo(ctx);
  const c = c0 || memo.checklist(t.getString('checklist'));
  const today = memo.today(t.getString('entity'));
  const due = t.getString('due');
  const open = t.getString('status') === 'open';
  const doc = util.byId(app, 'documents', t.getString('document'));
  const person = memo.employee(t.getString('employee'));
  return {
    id: t.id,
    checklist: t.getString('checklist'),
    checklist_name: c !== null ? c.getString('name') : '',
    checklist_kind: c !== null ? c.getString('kind') : '',
    anchor_day: c !== null ? c.getString('anchor_day') : '',
    employment: t.getString('employment'),
    employee: t.getString('employee'),
    employee_name: person.name,
    employee_number: person.number,
    entity: t.getString('entity'),
    title: t.getString('title'),
    description: t.getString('description'),
    assignee_kind: t.getString('assignee_kind'),
    assignee_member: t.getString('assignee_member'),
    assignee_label: laneLabel(app, t, memo),
    due: due,
    due_shown: memo.dayIn(t.getString('entity'), due),
    days_left: due !== '' ? util.daysBetween(today, due) : null,
    overdue: open && due !== '' && due < today,
    status: t.getString('status'),
    kind: t.getString('kind'),
    document_category: t.getString('document_category'),
    document: doc !== null ? { id: doc.id, title: doc.getString('title'), has_file: doc.getString('file') !== '' } : null,
    link: t.getString('link'),
    sort: t.getInt('sort'),
    done_at: t.getString('done_at'),
    done_actor: t.getString('done_actor'),
    done_by_name: t.getString('done_actor') === 'agent' ? 'Your AI agent' : memo.memberName(t.getString('done_by')),
    note: t.getString('note'),
    can: { act: canAct(ctx, t, memo), edit: !ctx.isAgent && memo.hrEdit(t.getString('entity')) },
  };
}

/**
 * Tasks the caller may see. view: mine (assigned to the caller, default) |
 * all (HR: their entities; managers: their reports and the checklists they
 * have tasks on; everyone else: their own). status: open (default) | done |
 * skipped | closed | all. Also employee, checklist, overdue, due_before.
 */
function listTasks(ctx, p) {
  const util = u();
  const app = ctx.app;
  const pg = util.page(p, 50, 500);
  const view = util.oneOf(p, 'view', ['mine', 'all'], 'mine');
  const bind = mineBind(ctx);
  const where = ["c.status != 'cancelled'"];
  if (view === 'mine') where.push(mineSql(ctx, bind));
  else if (lc().hrCan(ctx, '', 'view')) where.push(lc().scopeSql(ctx, 't', bind));
  else {
    const parts = [mineSql(ctx, bind), "t.checklist IN (SELECT x.checklist FROM tasks x WHERE x.assignee_kind = 'manager' AND x.assignee_member = {:me})"];
    if (ctx.teamScope && ctx.employeeId !== '') {
      const ids = L('lib_people').reportsOf(app, ctx.employeeId, util.today(app), true).map((r) => r.employment);
      if (ids.length > 0) parts.push('t.employment IN (' + ids.map((id, i) => ((bind['r' + i] = id), '{:r' + i + '}')).join(',') + ')');
    }
    where.push('(' + parts.join(' OR ') + ')');
  }
  const status = util.oneOf(p, 'status', ['open', 'done', 'skipped', 'closed', 'all'], 'open');
  if (status === 'closed') where.push("t.status != 'open'");
  else if (status !== 'all') {
    where.push('t.status = {:st}');
    bind.st = status;
  }
  const empRef = util.str(p, 'employee', '');
  if (empRef !== '') {
    where.push('t.employee = {:emp}');
    bind.emp = L('lib_people').employeeRef(app, empRef).id;
  }
  const cl = util.str(p, 'checklist', '');
  if (cl !== '') {
    where.push('t.checklist = {:cl}');
    bind.cl = cl;
  }
  const today = util.today(app);
  if (util.bool(p, 'overdue', false)) {
    where.push("t.status = 'open' AND t.due != '' AND t.due < {:today}");
    bind.today = today;
  }
  const before = util.day(p, 'due_before', '');
  if (before !== '') {
    where.push("t.due != '' AND t.due <= {:before}");
    bind.before = before;
  }
  const kind = util.oneOf(p, 'checklist_kind', KINDS, '');
  if (kind !== '') {
    where.push('c.kind = {:ck}');
    bind.ck = kind;
  }
  const w = where.join(' AND ');
  const from = ' FROM tasks t JOIN checklists c ON c.id = t.checklist WHERE ' + w;
  const total = util.count(app, 'SELECT COUNT(*) AS n' + from, bind);
  const rows = util.rows(app, "SELECT t.id AS id" + from + " ORDER BY t.status = 'open' DESC, t.due = '', t.due, t.sort LIMIT " + pg.limit + ' OFFSET ' + pg.offset, { id: '' }, bind);
  const memo = viewMemo(ctx);
  const recs = {};
  if (rows.length > 0) for (const t of app.findRecordsByIds('tasks', rows.map((r) => r.id))) recs[t.id] = t;
  const tasks = rows.filter((r) => recs[r.id] !== undefined).map((r) => taskView(ctx, recs[r.id], null, memo));
  return { tasks: tasks, total: total, limit: pg.limit, offset: pg.offset, today: today };
}

function taskRef(app, ref) {
  const r = u().byId(app, 'tasks', String(ref || ''));
  if (r === null) throw u().fail(404, 'No task ' + ref + '. Run tasks.list.', 'not_found');
  return r;
}

function needAct(ctx, t) {
  if (canAct(ctx, t)) return;
  if (ctx.isAgent) throw u().fail(403, 'Your AI agent completes only the tasks assigned to it. This one is for ' + laneLabel(ctx.app, t) + '.', 'agent_not_permitted');
  throw u().fail(403, 'This task is for ' + laneLabel(ctx.app, t) + '.', 'not_permitted');
}

function openChecklistOf(app, t) {
  const c = app.findRecordById('checklists', t.getString('checklist'));
  if (c.getString('status') === 'cancelled') throw u().fail(409, 'This checklist was cancelled.', 'conflict');
  return c;
}

/** tasks.complete: done, with an optional note; document tasks need a file (an upload, or your AI agent's --path) or an existing document. */
function tasksComplete(ctx, p) {
  const util = u();
  const app = ctx.app;
  const t = taskRef(app, util.req(p, 'task'));
  needAct(ctx, t);
  const c = openChecklistOf(app, t);
  if (t.getString('status') === 'done') return { task: taskView(ctx, t), checklist_done: c.getString('status') === 'done' };
  const note = util.text(p, 'note', 2000, '');
  let docId = t.getString('document');
  const f = L('lib_files').fileParam(ctx, p, 'file', 'path');
  const docRef = util.str(p, 'document', '');
  if (t.getString('kind') === 'document' && f === null && docRef === '' && docId === '') throw util.fail(400, 'This task needs a document: upload the file (or give --document with an existing document id).', 'file_required', { param: 'file' });
  let finished = false;
  lc().inTx(app, (tx) => {
    if (f !== null) {
      const d = util.newRecord(tx, 'documents');
      d.set('employee', t.getString('employee'));
      d.set('employment', t.getString('employment'));
      d.set('category', t.getString('document_category') || 'other');
      d.set('title', util.clip(t.getString('title'), 200));
      d.set('visible_to_employee', true);
      d.set('needs_ack', false);
      d.set('source', ctx.isAgent ? 'agent' : 'upload');
      d.set('note', 'From the task "' + util.clip(t.getString('title'), 120) + '"');
      d.set('added_by', ctx.memberId || '');
      d.set('file', f);
      tx.save(d);
      docId = d.id;
    } else if (docRef !== '') {
      const d = util.byId(tx, 'documents', docRef);
      if (d === null || d.getString('employee') !== t.getString('employee')) throw util.fail(404, 'No document ' + docRef + ' of this person.', 'not_found');
      docId = d.id;
    }
    const fresh = tx.findRecordById('tasks', t.id);
    fresh.set('status', 'done');
    fresh.set('done_at', util.nowIso());
    fresh.set('done_by', ctx.memberId || '');
    fresh.set('done_actor', ctx.isAgent ? 'agent' : ctx.actor === 'person' ? 'person' : 'system');
    fresh.set('note', note);
    fresh.set('document', docId);
    tx.save(fresh);
    finished = maybeFinish(L('lib_auth').withApp(ctx, tx), c.id);
  });
  if (!finished && t.getString('assignee_kind') === 'agent') settleAgentAsk(app, c.id, ctx.isAgent ? 'done' : 'closed');
  const done = app.findRecordById('tasks', t.id);
  L('lib_audit').note(ctx, { collection: 'tasks', record: t.id, summary: 'Done: ' + t.getString('title') + ' (' + lc().employeeName(app, t.getString('employee')) + ')' + (note !== '' ? ': ' + util.clip(note, 120) : '') });
  return { task: taskView(ctx, done), checklist_done: finished };
}

function setStatus(ctx, p, status) {
  const util = u();
  const app = ctx.app;
  const t = taskRef(app, util.req(p, 'task'));
  if (status === 'skipped') lc().needHr(ctx, t.getString('entity'), 'edit', 'skip tasks');
  else needAct(ctx, t);
  const c = openChecklistOf(app, t);
  let finished = false;
  lc().inTx(app, (tx) => {
    const fresh = tx.findRecordById('tasks', t.id);
    fresh.set('status', status);
    fresh.set('done_at', status === 'open' ? '' : util.nowIso());
    fresh.set('done_by', status === 'open' ? '' : ctx.memberId || '');
    fresh.set('done_actor', status === 'open' ? '' : ctx.isAgent ? 'agent' : 'person');
    if (util.has(p, 'note')) fresh.set('note', util.text(p, 'note', 2000, ''));
    tx.save(fresh);
    if (status === 'open' && c.getString('status') === 'done') {
      const cc = tx.findRecordById('checklists', c.id);
      cc.set('status', 'open');
      cc.set('done_at', '');
      tx.save(cc);
    }
    if (status === 'skipped') finished = maybeFinish(L('lib_auth').withApp(ctx, tx), c.id);
  });
  if (status === 'skipped' && !finished && t.getString('assignee_kind') === 'agent') settleAgentAsk(app, c.id, 'closed');
  L('lib_audit').note(ctx, { collection: 'tasks', record: t.id, summary: (status === 'open' ? 'Reopened: ' : 'Skipped: ') + t.getString('title') + ' (' + lc().employeeName(app, t.getString('employee')) + ')' });
  return { task: taskView(ctx, app.findRecordById('tasks', t.id)), checklist_done: finished };
}

function tasksReopen(ctx, p) {
  return setStatus(ctx, p, 'open');
}

function tasksSkip(ctx, p) {
  return setStatus(ctx, p, 'skipped');
}

/** tasks.add: one more task on an open checklist. */
function tasksAdd(ctx, p) {
  const util = u();
  const app = ctx.app;
  const c = checklistRef(app, util.req(p, 'checklist'));
  lc().needHr(ctx, c.getString('entity'), 'edit', 'add tasks');
  if (c.getString('status') === 'cancelled') throw util.fail(409, 'This checklist was cancelled.', 'conflict');
  const item = readItems(app, [{ title: util.str(p, 'title', ''), assignee: util.str(p, 'assignee', 'hr'), due_offset_days: util.int(p, 'due_offset_days', 0, -365, 365), kind: util.str(p, 'kind', 'task'), description: util.str(p, 'description', ''), document_category: util.str(p, 'document_category', '') }])[0];
  const due = util.day(p, 'due', '');
  if (due !== '') item.due = due;
  item.key = '';
  const m = app.findRecordById('employments', c.getString('employment'));
  const max = util.one(app, 'SELECT COALESCE(MAX(sort), 0) AS s FROM tasks WHERE checklist = {:c}', { s: 0 }, { c: c.id });
  let t = null;
  lc().inTx(app, (tx) => {
    t = newTask(tx, c, m, item, (max ? max.s : 0) + 10);
    if (c.getString('status') === 'done') {
      const cc = tx.findRecordById('checklists', c.id);
      cc.set('status', 'open');
      cc.set('done_at', '');
      tx.save(cc);
    }
  });
  if (item.assignee === 'agent' && !ctx.isAgent) askAgent(ctx, app.findRecordById('checklists', c.id), { defer: true });
  L('lib_audit').note(ctx, { collection: 'tasks', record: t.id, summary: 'Added the task ' + t.getString('title') + ' to ' + c.getString('name') + ' of ' + lc().employeeName(app, c.getString('employee')) });
  return { task: taskView(ctx, app.findRecordById('tasks', t.id)) };
}

function previewTaskAdd(ctx, p) {
  const util = u();
  const c = checklistRef(ctx.app, util.str(p, 'checklist', ''));
  return {
    label: 'Add a task to ' + c.getString('name') + ' of ' + lc().employeeName(ctx.app, c.getString('employee')),
    target: 'checklists:' + c.id,
    fields: [
      { name: 'title', before: '', after: util.str(p, 'title', '') },
      { name: 'for', before: '', after: assigneeLabel(ctx.app, util.str(p, 'assignee', 'hr')) },
      { name: 'due', before: '', after: util.str(p, 'due', '') || util.dayAdd(c.getString('anchor_day'), util.int(p, 'due_offset_days', 0, -365, 365)) },
    ],
    notes: [],
    risk: 'low',
  };
}

/** tasks.update: title, description, assignee, due day, kind. */
function tasksUpdate(ctx, p) {
  const util = u();
  const app = ctx.app;
  const t = taskRef(app, util.req(p, 'task'));
  lc().needHr(ctx, t.getString('entity'), 'edit', 'change tasks');
  const before = taskView(ctx, t);
  if (util.has(p, 'title')) {
    const s = util.squash(util.text(p, 'title', 200, ''));
    if (s === '') throw util.fail(400, 'title cannot be empty', 'invalid_param', { param: 'title' });
    t.set('title', s);
  }
  if (util.has(p, 'description')) t.set('description', util.text(p, 'description', 2000, ''));
  if (util.has(p, 'due')) t.set('due', util.day(p, 'due', ''));
  if (util.has(p, 'kind')) t.set('kind', util.oneOf(p, 'kind', TASK_KINDS, 'task'));
  if (util.has(p, 'document_category')) t.set('document_category', util.slug(util.str(p, 'document_category', '')).replace(/-/g, '_').slice(0, 60));
  if (util.has(p, 'assignee')) {
    const a = readAssignee(app, util.str(p, 'assignee', ''), 'assignee');
    const m = app.findRecordById('employments', t.getString('employment'));
    const who = resolve(app, a, m, managerDay(app, m));
    t.set('assignee_kind', who.kind);
    t.set('assignee_member', who.member);
  }
  if (util.has(p, 'sort')) t.set('sort', util.int(p, 'sort', t.getInt('sort'), 0, 100000));
  app.save(t);
  if (t.getString('assignee_kind') === 'agent' && t.getString('status') === 'open' && !ctx.isAgent) askAgent(ctx, app.findRecordById('checklists', t.getString('checklist')), { defer: true });
  else settleAgentAsk(app, t.getString('checklist'), 'closed');
  const after = taskView(ctx, t);
  L('lib_audit').note(ctx, { collection: 'tasks', record: t.id, summary: 'Changed the task ' + t.getString('title'), before: before, after: after });
  return { task: after };
}

function tasksDelete(ctx, p) {
  const util = u();
  const app = ctx.app;
  const t = taskRef(app, util.req(p, 'task'));
  lc().needHr(ctx, t.getString('entity'), 'edit', 'delete tasks');
  const cid = t.getString('checklist');
  app.delete(t);
  maybeFinish(ctx, cid);
  L('lib_audit').note(ctx, { collection: 'tasks', record: t.id, summary: 'Deleted the task ' + t.getString('title') + ' of ' + lc().employeeName(app, t.getString('employee')) });
  return { deleted: true };
}

/* ------------------------------------------------------------ reminders */

/** One digest notification per member for the open tasks of an entity due on `day` or earlier; your AI agent asked again for its own. */
function remind(app, entityId, day) {
  const util = u();
  const rows = util.findMany(app, 'tasks', "entity = {:e} && status = 'open' && due != '' && due <= {:d} && (reminded_on = '' || reminded_on < {:d})", 'due', 2000, { e: entityId, d: day });
  if (rows.length === 0) return 0;
  const per = {};
  const add = (mid, t) => {
    if (!mid) return;
    if (per[mid] === undefined) per[mid] = { due: 0, overdue: 0 };
    if (t.getString('due') < day) per[mid].overdue++;
    else per[mid].due++;
  };
  let hr = null;
  let it = null;
  let n = 0;
  for (const t of rows) {
    const c = util.byId(app, 'checklists', t.getString('checklist'));
    if (c === null || c.getString('status') !== 'open') continue;
    const kind = t.getString('assignee_kind');
    if (kind === 'agent') continue;
    else if ((kind === 'manager' || kind === 'member') && t.getString('assignee_member') !== '') add(t.getString('assignee_member'), t);
    else if (kind === 'employee') add(lc().memberOfEmployee(app, t.getString('employee')), t);
    else if (kind === 'it') {
      if (it === null) it = lc().itMembers(app, entityId);
      if (it.length > 0) for (const mid of it) add(mid, t);
      else {
        if (hr === null) hr = lc().hrMembers(app, entityId);
        for (const mid of hr) add(mid, t);
      }
    } else {
      if (hr === null) hr = lc().hrMembers(app, entityId);
      for (const mid of hr) add(mid, t);
    }
    t.set('reminded_on', day);
    app.save(t);
    n++;
  }
  for (const mid of Object.keys(per)) {
    const x = per[mid];
    const total = x.due + x.overdue;
    L('lib_notify').notify(app, [mid], { kind: 'task', title: total === 1 ? 'A lifecycle task needs you' : 'Lifecycle tasks need you', body: '', link: '#/lifecycle/tasks', facts: [{ type: 'number', key: 'tasks', label: 'Tasks', value: total, unit: total === 1 ? 'task' : 'tasks' }].concat(x.overdue > 0 ? [{ type: 'number', key: 'overdue', label: 'Overdue', value: x.overdue, unit: 'overdue' }] : []) });
  }
  return n;
}


module.exports = {
  KINDS: KINDS,
  LANES: LANES,
  TASK_KINDS: TASK_KINDS,
  withKeys: withKeys,
  readItems: readItems,
  templateView: templateView,
  defaultTemplate: defaultTemplate,
  templatesList: templatesList,
  templatesGet: templatesGet,
  templatesSave: templatesSave,
  templatesCopy: templatesCopy,
  templatesDelete: templatesDelete,
  templatesSeed: templatesSeed,
  openChecklist: openChecklist,
  latestChecklist: latestChecklist,
  startChecklist: startChecklist,
  checklistView: checklistView,
  progressOf: progressOf,
  checklistsList: checklistsList,
  checklistsGet: checklistsGet,
  checklistsStart: checklistsStart,
  previewStart: previewStart,
  checklistsCancel: checklistsCancel,
  checklistsFirstDay: checklistsFirstDay,
  previewFirstDay: previewFirstDay,
  checklistsAskAgent: checklistsAskAgent,
  refreshManagerTasks: refreshManagerTasks,
  maybeFinish: maybeFinish,
  canAct: canAct,
  taskView: taskView,
  listTasks: listTasks,
  tasksComplete: tasksComplete,
  tasksReopen: tasksReopen,
  tasksSkip: tasksSkip,
  tasksAdd: tasksAdd,
  previewTaskAdd: previewTaskAdd,
  tasksUpdate: tasksUpdate,
  tasksDelete: tasksDelete,
  remind: remind,
  mayAsk: mayAsk,
  settleAgentAsk: settleAgentAsk,
};
