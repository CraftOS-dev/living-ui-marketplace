/// <reference path="../pb_data/types.d.ts" />
/**
 * Grievances: a person reports a concern (by type, optionally anonymously:
 * then even HR sees "Anonymous"); HR (people:full) investigates, may assign
 * an investigator and share the case with named members or with your AI
 * agent; the reporter follows the status and the notes meant for them.
 * Managers never see a grievance unless HR assigns or shares it; your AI
 * agent sees only the count until HR shares one. Subjects, descriptions,
 * notes and resolutions stay out of the audit trail and notifications.
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

const STATUSES = ['open', 'investigating', 'resolved', 'closed', 'withdrawn'];

/* ---------------------------------------------------------------- types */

function typeView(r) {
  return { id: r.id, code: r.getString('code'), name: r.getString('name'), description: r.getString('description'), confidential: r.getBool('confidential'), archived: r.getBool('archived'), sort: r.getInt('sort') };
}

function typesList(ctx, p) {
  const util = u();
  return { types: util.findMany(ctx.app, 'grievance_types', util.bool(p, 'archived', false) ? '1=1' : 'archived = false', 'sort,name', 200).map(typeView) };
}

function typesSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  lc().needHr(ctx, '', 'full', 'change grievance types');
  const ref = util.str(p, 'type', '');
  const r = ref !== '' ? util.byIdOrName(app, 'grievance_types', ref, 'code', 'grievance-types.list') : util.newRecord(app, 'grievance_types');
  const before = ref !== '' ? typeView(r) : null;
  if (ref === '' || util.has(p, 'name')) {
    const n = util.squash(util.text(p, 'name', 120, ''));
    if (n === '') throw util.fail(400, 'name is required', 'missing_param', { param: 'name' });
    r.set('name', n);
  }
  if (ref === '') {
    let code = util.slug(util.str(p, 'code', '') || r.getString('name')).replace(/-/g, '_').slice(0, 40) || 'type';
    if (util.findOne(app, 'grievance_types', 'code = {:c}', { c: code }) !== null) throw util.fail(409, 'There is already a grievance type with the code ' + code + '.', 'duplicate');
    r.set('code', code);
    const max = util.one(app, 'SELECT COALESCE(MAX(sort), 0) AS s FROM grievance_types', { s: 0 });
    r.set('sort', (max ? max.s : 0) + 10);
  }
  if (util.has(p, 'description')) r.set('description', util.text(p, 'description', 400, ''));
  if (util.has(p, 'confidential')) r.set('confidential', util.bool(p, 'confidential', true));
  else if (ref === '') r.set('confidential', true);
  if (util.has(p, 'archived')) r.set('archived', util.bool(p, 'archived', false));
  app.save(r);
  L('lib_audit').note(ctx, { collection: 'grievance_types', record: r.id, summary: (ref === '' ? 'Added' : 'Changed') + ' the grievance type ' + r.getString('name'), before: before, after: typeView(r) });
  return { type: typeView(r) };
}

function typesDelete(ctx, p) {
  const util = u();
  const app = ctx.app;
  lc().needHr(ctx, '', 'full', 'delete grievance types');
  const r = util.byIdOrName(app, 'grievance_types', util.req(p, 'type'), 'code', 'grievance-types.list');
  const used = util.count(app, 'SELECT COUNT(*) AS n FROM grievances WHERE type = {:t}', { t: r.id });
  if (used > 0) throw util.fail(409, used + ' grievance(s) use this type. Archive it instead.', 'in_use');
  app.delete(r);
  L('lib_audit').note(ctx, { collection: 'grievance_types', record: r.id, summary: 'Deleted the grievance type ' + r.getString('name') });
  return { deleted: true };
}

/* ----------------------------------------------------------- visibility */

function isHr(ctx, g) {
  return !ctx.isAgent && ctx.actor === 'person' && L('lib_auth').can(ctx, 'people', 'full') && L('lib_auth').inScope(ctx, g.getString('entity'));
}

/** hr | assignee | shared | reporter | agent | '' */
function see(ctx, g) {
  if (ctx.actor === 'system') return 'hr';
  if (ctx.isAgent) return g.getBool('agent_shared') ? 'agent' : '';
  if (isHr(ctx, g)) return 'hr';
  if (ctx.memberId !== '' && g.getString('assignee') === ctx.memberId) return 'assignee';
  if (ctx.memberId !== '' && (u().jsonOf(g, 'shared_with', []) || []).indexOf(ctx.memberId) >= 0) return 'shared';
  if (L('lib_auth').selfEmployee(ctx) === g.getString('employee')) return 'reporter';
  return '';
}

function view(ctx, g, full) {
  const util = u();
  const app = ctx.app;
  const s = see(ctx, g);
  const type = util.byId(app, 'grievance_types', g.getString('type'));
  const anon = g.getBool('anonymous');
  const v = {
    id: g.id,
    number: g.getString('number'),
    type: g.getString('type'),
    type_name: type !== null ? type.getString('name') : '',
    subject: g.getString('subject'),
    status: g.getString('status'),
    occurred_on: g.getString('occurred_on'),
    confidential: g.getBool('confidential'),
    anonymous: anon,
    resolution: g.getString('resolution'),
    created: g.getString('created'),
    updated: g.getString('updated'),
    closed_at: g.getString('closed_at'),
    see: s,
  };
  const notes = util.jsonOf(g, 'notes', []) || [];
  if (s === 'reporter') {
    if (full) {
      v.description = g.getString('description');
      v.notes = notes.filter((n) => n.visible_to_reporter);
    }
    return v;
  }
  v.reporter = anon ? '' : g.getString('employee');
  v.reporter_name = anon ? 'Anonymous' : lc().employeeName(app, g.getString('employee'));
  v.entity = g.getString('entity');
  v.entity_name = lc().entityName(app, g.getString('entity'));
  v.against = g.getString('against_employee');
  v.against_name = lc().employeeName(app, g.getString('against_employee'));
  v.assignee = g.getString('assignee');
  v.assignee_name = lc().memberName(app, g.getString('assignee'));
  v.shared_with = (util.jsonOf(g, 'shared_with', []) || []).map((id) => ({ id: id, name: lc().memberName(app, id) }));
  v.agent_shared = g.getBool('agent_shared');
  v.notes_count = notes.length;
  if (full) {
    v.description = g.getString('description');
    v.notes = notes;
  }
  return v;
}

function ref(app, r0) {
  const util = u();
  const r = String(r0 || '').trim();
  const rec = util.byId(app, 'grievances', r) || util.findOne(app, 'grievances', 'number = {:n}', { n: r.toUpperCase() });
  if (rec === null) throw util.fail(404, 'No grievance ' + r + '.', 'not_found');
  return rec;
}

function mustSee(ctx, g) {
  const s = see(ctx, g);
  if (s === '') {
    if (ctx.isAgent) throw u().fail(403, 'This grievance is confidential. HR can share it with you (grievances.share --agent true).', 'agent_not_permitted');
    throw u().fail(403, 'You cannot see this grievance.', 'not_permitted');
  }
  return s;
}

/* -------------------------------------------------------------- reading */

function list(ctx, p) {
  const util = u();
  const app = ctx.app;
  const pg = util.page(p, 50, 300);
  const where = [];
  const bind = {};
  const status = util.oneOf(p, 'status', STATUSES.concat(['active', 'all']), 'active');
  if (status === 'active') where.push("g.status IN ('open', 'investigating')");
  else if (status !== 'all') {
    where.push('g.status = {:st}');
    bind.st = status;
  }
  const mine = util.oneOf(p, 'view', ['all', 'mine'], 'all') === 'mine';
  const hr = !ctx.isAgent && ctx.actor === 'person' && L('lib_auth').can(ctx, 'people', 'full');
  if (ctx.isAgent) where.push('g.agent_shared = TRUE');
  else if (hr && !mine) where.push(lc().scopeSql(ctx, 'g', bind));
  else {
    where.push('(g.employee = {:self} OR g.assignee = {:me} OR EXISTS (SELECT 1 FROM json_each(g.shared_with) j WHERE j.value = {:me}))');
    bind.self = ctx.employeeId || '-';
    bind.me = ctx.memberId || '-';
  }
  const w = where.join(' AND ');
  const total = util.count(app, 'SELECT COUNT(*) AS n FROM grievances g WHERE ' + w, bind);
  const rows = util.rows(app, "SELECT g.id AS id FROM grievances g WHERE " + w + " ORDER BY g.status = 'open' DESC, g.created DESC LIMIT " + pg.limit + ' OFFSET ' + pg.offset, { id: '' }, bind);
  const out = { grievances: rows.map((r) => view(ctx, app.findRecordById('grievances', r.id), false)).filter((x) => x.see !== ''), total: total, hr: hr, limit: pg.limit, offset: pg.offset };
  if (ctx.isAgent) out.not_shared_active = util.count(app, "SELECT COUNT(*) AS n FROM grievances WHERE status IN ('open', 'investigating') AND agent_shared = FALSE");
  return out;
}

function get(ctx, p) {
  const util = u();
  const g = ref(ctx.app, util.req(p, 'grievance'));
  const s = mustSee(ctx, g);
  const v = view(ctx, g, true);
  const open = ['open', 'investigating'].indexOf(g.getString('status')) >= 0;
  v.can = { manage: s === 'hr', status: (s === 'hr' || s === 'assignee') && g.getString('status') !== 'withdrawn', note: s === 'hr' || s === 'assignee' || (s === 'reporter' && open) || s === 'agent', withdraw: s === 'reporter' && open };
  return { grievance: v };
}

/* -------------------------------------------------------------- writing */

function notifyHr(app, entityId, title, link) {
  const auth = L('lib_auth');
  const ids = [];
  for (const m of u().findMany(app, 'members', "status = 'active'", 'created')) {
    const role = u().byId(app, 'roles', m.getString('role'));
    if (role === null) continue;
    const owner = role.getString('code') === 'owner';
    if (!owner && auth.rank(auth.levelsOfRole(role).people) < auth.rank('full')) continue;
    const ents = u().jsonOf(m, 'entities', []) || [];
    if (!owner && entityId && ents.length > 0 && ents.indexOf(entityId) < 0) continue;
    ids.push(m.id);
  }
  L('lib_notify').notify(app, ids, { kind: 'grievance', title: title, body: '', link: link });
}

/** grievances.report: the signed-in person reports a concern. */
function report(ctx, p) {
  const util = u();
  const app = ctx.app;
  const people = L('lib_people');
  const self = L('lib_auth').selfEmployee(ctx);
  if (self === '') throw util.fail(409, 'Your account is not linked to an employee record, so a report cannot be filed here. Ask HR directly.', 'not_linked');
  const subject = util.squash(util.text(p, 'subject', 200, ''));
  if (subject === '') throw util.fail(400, 'Give a short subject.', 'missing_param', { param: 'subject' });
  const description = util.text(p, 'description', 10000, '');
  if (description.trim() === '') throw util.fail(400, 'Say what happened.', 'missing_param', { param: 'description' });
  const typeRef = util.str(p, 'type', '');
  const type = typeRef !== '' ? util.byIdOrName(app, 'grievance_types', typeRef, 'code', 'grievance-types.list') : util.findOne(app, 'grievance_types', "code = 'other'", {});
  const empId = people.primaryEmployment(app, self, util.today(app));
  const m = empId !== '' ? app.findRecordById('employments', empId) : null;
  const againstRef = util.str(p, 'against', '');
  const against = againstRef !== '' ? people.employeeRef(app, againstRef) : null;
  if (against !== null && against.id === self) throw util.fail(400, 'The person concerned cannot be you.', 'invalid_param', { param: 'against' });
  const g = util.newRecord(app, 'grievances');
  g.set('number', 'G' + String(util.nextNumber(app, 'grievance')).padStart(4, '0'));
  g.set('employee', self);
  g.set('employment', m !== null ? m.id : '');
  g.set('entity', m !== null ? m.getString('entity') : '');
  g.set('type', type !== null ? type.id : '');
  g.set('subject', subject);
  g.set('description', description);
  g.set('against_employee', against !== null ? against.id : '');
  g.set('occurred_on', util.day(p, 'occurred_on', ''));
  g.set('confidential', type !== null ? type.getBool('confidential') : true);
  g.set('anonymous', util.bool(p, 'anonymous', false));
  g.set('status', 'open');
  g.set('shared_with', []);
  g.set('agent_shared', false);
  g.set('notes', []);
  g.set('reported_by', ctx.memberId);
  app.save(g);
  notifyHr(app, g.getString('entity'), 'A concern was reported (' + g.getString('number') + ')', '#/lifecycle/grievances/' + g.id);
  L('lib_audit').note(ctx, { collection: 'grievances', record: g.id, summary: 'Reported ' + g.getString('number') });
  return get(ctx, { grievance: g.id });
}

function memberRefs(app, raw) {
  return (raw || []).map((x) => L('lib_auth').memberRef(app, String(x)).id);
}

/** Members who may never be given a case: the reporter and the person concerned. */
function excluded(app, g) {
  return [lc().memberOfEmployee(app, g.getString('employee')), lc().memberOfEmployee(app, g.getString('against_employee'))].filter((x) => x !== '');
}

function assign(ctx, p) {
  const util = u();
  const app = ctx.app;
  const g = ref(app, util.req(p, 'grievance'));
  if (!isHr(ctx, g)) throw util.fail(403, 'HR (people full access) assigns grievances.', 'not_permitted');
  const mref = util.str(p, 'member', '');
  const mid = mref === '' ? '' : L('lib_auth').memberRef(app, mref).id;
  if (mid !== '' && excluded(app, g).indexOf(mid) >= 0) throw util.fail(409, 'The reporter and the person concerned cannot investigate this case.', 'conflict_of_interest');
  g.set('assignee', mid);
  if (mid !== '' && g.getString('status') === 'open') g.set('status', 'investigating');
  app.save(g);
  if (mid !== '' && mid !== ctx.memberId) L('lib_notify').notify(app, [mid], { kind: 'grievance', title: 'You were asked to look into ' + g.getString('number'), body: '', link: '#/lifecycle/grievances/' + g.id });
  L('lib_audit').note(ctx, { collection: 'grievances', record: g.id, summary: (mid === '' ? 'Unassigned ' : 'Assigned ') + g.getString('number') + (mid !== '' ? ' to ' + lc().memberName(app, mid) : '') });
  return get(ctx, { grievance: g.id });
}

function share(ctx, p) {
  const util = u();
  const app = ctx.app;
  const g = ref(app, util.req(p, 'grievance'));
  if (!isHr(ctx, g)) throw util.fail(403, 'HR (people full access) shares grievances.', 'not_permitted');
  const before = { shared_with: util.jsonOf(g, 'shared_with', []) || [], agent: g.getBool('agent_shared') };
  if (util.has(p, 'members')) {
    const ids = memberRefs(app, util.list(p, 'members'));
    const ex = excluded(app, g);
    if (ids.some((x) => ex.indexOf(x) >= 0)) throw util.fail(409, 'The reporter and the person concerned cannot be given the case.', 'conflict_of_interest');
    const added = ids.filter((x) => before.shared_with.indexOf(x) < 0 && x !== ctx.memberId);
    g.set('shared_with', ids);
    if (added.length > 0) L('lib_notify').notify(app, added, { kind: 'grievance', title: g.getString('number') + ' was shared with you', body: '', link: '#/lifecycle/grievances/' + g.id });
  }
  if (util.has(p, 'agent')) g.set('agent_shared', util.bool(p, 'agent', false));
  app.save(g);
  L('lib_audit').note(ctx, { collection: 'grievances', record: g.id, summary: 'Changed who sees ' + g.getString('number'), before: before, after: { shared_with: util.jsonOf(g, 'shared_with', []) || [], agent: g.getBool('agent_shared') } });
  return get(ctx, { grievance: g.id });
}

function setStatus(ctx, p) {
  const util = u();
  const app = ctx.app;
  const g = ref(app, util.req(p, 'grievance'));
  const s = mustSee(ctx, g);
  if (s !== 'hr' && s !== 'assignee') throw util.fail(403, 'HR or the investigator changes the status.', 'not_permitted');
  if (g.getString('status') === 'withdrawn') throw util.fail(409, 'The reporter withdrew this grievance.', 'conflict');
  const status = util.oneOf(p, 'status', ['open', 'investigating', 'resolved', 'closed'], '');
  if (status === '') throw util.fail(400, 'status is open, investigating, resolved or closed', 'missing_param', { param: 'status' });
  const resolution = util.has(p, 'resolution') ? util.text(p, 'resolution', 4000, '') : g.getString('resolution');
  if ((status === 'resolved' || status === 'closed') && resolution.trim() === '') throw util.fail(400, 'Write the resolution the reporter will read.', 'missing_param', { param: 'resolution' });
  g.set('status', status);
  g.set('resolution', resolution);
  g.set('closed_at', status === 'resolved' || status === 'closed' ? util.nowIso() : '');
  app.save(g);
  const rm = lc().memberOfEmployee(app, g.getString('employee'));
  if (rm !== '') L('lib_notify').notify(app, [rm], { kind: 'grievance', title: 'Your report ' + g.getString('number') + ' is now ' + status, body: '', link: '#/lifecycle/grievances/' + g.id, facts: [{ type: 'state', key: 'status', value: status }] });
  L('lib_audit').note(ctx, { collection: 'grievances', record: g.id, summary: g.getString('number') + ' is ' + status });
  return get(ctx, { grievance: g.id });
}

function note(ctx, p) {
  const util = u();
  const app = ctx.app;
  const g = ref(app, util.req(p, 'grievance'));
  const s = mustSee(ctx, g);
  if (s === 'shared') throw util.fail(403, 'You can read this case; HR or the investigator adds notes.', 'not_permitted');
  if (s === 'reporter' && ['open', 'investigating'].indexOf(g.getString('status')) < 0) throw util.fail(409, 'This case is ' + g.getString('status') + '.', 'conflict');
  const text = util.text(p, 'text', 4000, '');
  if (text.trim() === '') throw util.fail(400, 'Write the note.', 'missing_param', { param: 'text' });
  const visible = s === 'reporter' ? true : s === 'agent' ? false : util.bool(p, 'visible_to_reporter', false);
  const notes = util.jsonOf(g, 'notes', []) || [];
  const by = s === 'agent' ? 'Your AI agent' : s === 'reporter' && g.getBool('anonymous') ? 'Anonymous' : ctx.name;
  notes.push({ id: util.token(10), at: util.nowIso(), by: s === 'agent' ? '' : ctx.memberId, by_name: by, as: s, text: text, visible_to_reporter: visible });
  if (notes.length > 500) throw util.fail(409, 'This case has too many notes.', 'invalid');
  g.set('notes', notes);
  app.save(g);
  const link = '#/lifecycle/grievances/' + g.id;
  if (s === 'reporter') {
    if (g.getString('assignee') !== '') L('lib_notify').notify(app, [g.getString('assignee')], { kind: 'grievance', title: 'New note on ' + g.getString('number'), body: '', link: link });
    else notifyHr(app, g.getString('entity'), 'New note on ' + g.getString('number'), link);
  } else if (visible) {
    const rm = lc().memberOfEmployee(app, g.getString('employee'));
    if (rm !== '') L('lib_notify').notify(app, [rm], { kind: 'grievance', title: 'An update on your report ' + g.getString('number'), body: '', link: link });
  }
  L('lib_audit').note(ctx, { collection: 'grievances', record: g.id, summary: 'Added a note to ' + g.getString('number') });
  return get(ctx, { grievance: g.id });
}

function withdraw(ctx, p) {
  const util = u();
  const app = ctx.app;
  const g = ref(app, util.req(p, 'grievance'));
  if (see(ctx, g) !== 'reporter') throw util.fail(403, 'Only the person who reported it can withdraw it.', 'not_permitted');
  if (['open', 'investigating'].indexOf(g.getString('status')) < 0) throw util.fail(409, 'This case is ' + g.getString('status') + '.', 'conflict');
  g.set('status', 'withdrawn');
  g.set('closed_at', util.nowIso());
  app.save(g);
  const to = g.getString('assignee');
  if (to !== '') L('lib_notify').notify(app, [to], { kind: 'grievance', title: g.getString('number') + ' was withdrawn', body: '', link: '#/lifecycle/grievances/' + g.id });
  L('lib_audit').note(ctx, { collection: 'grievances', record: g.id, summary: 'Withdrew ' + g.getString('number') });
  return get(ctx, { grievance: g.id });
}

module.exports = { STATUSES: STATUSES, typesList: typesList, typesSave: typesSave, typesDelete: typesDelete, see: see, view: view, list: list, get: get, report: report, assign: assign, share: share, setStatus: setStatus, note: note, withdraw: withdraw };
