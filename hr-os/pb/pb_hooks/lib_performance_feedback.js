/// <reference path="../pb_data/types.d.ts" />
/**
 * Continuous feedback (Frappe employee feedback and performance feedback;
 * Lattice, Culture Amp, HiBob praise and feedback):
 *
 *   praise    to a person, public (the praise wall) or private, with the
 *             company's values as tags
 *   feedback  to a person (private: they and the writer see it) or about a
 *             person to their manager (manager: their managers and HR see
 *             it, the person does not)
 *   request   a person asks someone for feedback about themself, or a
 *             manager asks about a report; the answer is a feedback row
 *             linked by `request` (private when about the asker, manager
 *             otherwise)
 *
 * Your AI agent never gives, asks for or deletes feedback: these are
 * people's words. It reads feedback for a review summary through
 * reviews.context, which shows only what the reviewer may see.
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

/* -------------------------------------------------------------- access */

function canSee(ctx, r) {
  if (ctx.isAgent || ctx.actor === 'system') return true;
  const me = ctx.employeeId || '';
  if (me !== '' && r.getString('from_employee') === me) return true;
  if (ctx.memberId && r.getString('from_member') === ctx.memberId) return true;
  const kind = r.getString('kind');
  const to = r.getString('to_employee');
  if (kind === 'request') return me !== '' && to === me;
  const vis = r.getString('visibility');
  if (vis === 'public') return true;
  if (vis === 'private') return me !== '' && to === me;
  const rel = core().relation(ctx, to);
  return rel.team || core().atLeast(rel.hr, 'view');
}

function valuesMap(app) {
  const out = {};
  for (const v of core().settingsOf(app).values) out[v.code] = v;
  return out;
}

function view(ctx, r, vals) {
  const util = u();
  const app = ctx.app;
  const vm = vals || valuesMap(app);
  const values = (util.jsonOf(r, 'values', []) || []).map((c) => vm[c] || { code: c, name: c, icon: 'Star', description: '' });
  const out = {
    id: r.id,
    kind: r.getString('kind'),
    from: r.getString('from_employee') !== '' ? core().chip(ctx, r.getString('from_employee')) : null,
    from_name: r.getString('from_employee') === '' ? core().memberName(app, r.getString('from_member')) : '',
    to: core().chip(ctx, r.getString('to_employee')),
    about: r.getString('about_employee') !== '' ? core().chip(ctx, r.getString('about_employee')) : null,
    text: r.getString('text'),
    values: values,
    visibility: r.getString('visibility'),
    status: r.getString('status'),
    due: r.getString('due'),
    request: r.getString('request'),
    declined_reason: r.getString('declined_reason'),
    created: r.getString('created'),
    mine: !ctx.isAgent && !!ctx.employeeId && r.getString('from_employee') === ctx.employeeId,
  };
  out.can_delete = !ctx.isAgent && (out.mine || (r.getString('visibility') === 'public' && L('lib_auth').can(ctx, 'performance', 'full')));
  return out;
}

function ref(ctx, id) {
  const r = u().byId(ctx.app, 'feedback', String(id || ''));
  if (r === null) throw u().fail(404, 'No feedback ' + id + '.', 'not_found');
  return r;
}

/* ------------------------------------------------------------------ ops */

function give(ctx, p) {
  const util = u();
  const app = ctx.app;
  if (ctx.isAgent) throw util.fail(403, 'Feedback is in people\'s own words; your AI agent does not give it.', 'agent_not_permitted');
  const me = core().selfOrFail(ctx);
  const st = core().settingsOf(app);
  let request = null;
  const reqId = util.str(p, 'request', '');
  if (reqId !== '') {
    request = ref(ctx, reqId);
    if (request.getString('kind') !== 'request' || request.getString('to_employee') !== me) throw util.fail(403, 'This request was not sent to you.', 'not_permitted');
    if (request.getString('status') !== 'open') throw util.fail(409, 'This request is already ' + request.getString('status') + '.', 'conflict');
  }
  const kind = request !== null ? 'feedback' : util.oneOf(p, 'kind', ['praise', 'feedback'], 'praise');
  let toId;
  if (request !== null) toId = request.getString('about_employee') || request.getString('from_employee');
  else toId = L('lib_people').employeeRef(app, util.req(p, 'to', 'E0002')).id;
  if (toId === me) throw util.fail(400, 'Feedback goes to someone else.', 'invalid_param', { param: 'to' });
  const text0 = util.text(p, 'text', 4000, '');
  if (text0.trim() === '') throw util.fail(400, 'Write the ' + kind + '.', 'missing_param', { param: 'text' });
  let visibility;
  if (request !== null) visibility = request.getString('about_employee') === request.getString('from_employee') ? 'private' : 'manager';
  else if (kind === 'praise') visibility = util.oneOf(p, 'visibility', ['public', 'private'], st.praise_wall ? 'public' : 'private');
  else visibility = util.oneOf(p, 'visibility', ['private', 'manager'], 'private');
  if (visibility === 'public' && !st.praise_wall) throw util.fail(400, 'The praise wall is switched off; send it privately.', 'invalid_param', { param: 'visibility' });
  const codes = util.list(p, 'values') || [];
  const known = valuesMap(app);
  for (const c of codes) if (known[String(c)] === undefined) throw util.fail(400, 'Unknown value "' + c + '". Values: ' + Object.keys(known).join(', ') + '.', 'invalid_param', { param: 'values' });
  const to = core().person(ctx, toId);
  const r = util.newRecord(app, 'feedback');
  r.set('from_employee', me);
  r.set('from_member', ctx.memberId || '');
  r.set('from_actor', 'person');
  r.set('to_employee', toId);
  r.set('about_employee', toId);
  r.set('kind', kind);
  r.set('text', text0);
  r.set('values', codes.map(String).slice(0, 6));
  r.set('visibility', visibility);
  r.set('status', '');
  r.set('entity', to ? to.entity : '');
  if (request !== null) r.set('request', request.id);
  app.save(r);
  if (request !== null) {
    request.set('status', 'answered');
    app.save(request);
  }
  const from = core().chip(ctx, me);
  if (visibility === 'manager') {
    const asker = request !== null ? request.getString('from_employee') : to ? to.manager : '';
    if (asker) core().notifyEmployee(app, asker, { kind: 'performance', title: (from ? from.name : '') + ' shared feedback about ' + (to ? to.name : ''), link: '#/performance/feedback?view=about&employee=' + toId });
  } else core().notifyEmployee(app, toId, { kind: 'performance', title: (from ? from.name : '') + (kind === 'praise' ? ' praised you' : ' sent you feedback'), link: '#/performance/feedback' });
  L('lib_audit').note(ctx, { collection: 'feedback', record: r.id, summary: (kind === 'praise' ? 'Praised ' : 'Gave feedback to ') + (to ? to.name : '') + ' (' + visibility + ')' });
  return { feedback: view(ctx, r, known) };
}

function requestOp(ctx, p) {
  const util = u();
  const app = ctx.app;
  if (ctx.isAgent) throw util.fail(403, 'People ask each other for feedback; your AI agent does not.', 'agent_not_permitted');
  const me = core().selfOrFail(ctx);
  const aboutRef = util.str(p, 'about', '');
  const about = aboutRef === '' ? me : L('lib_people').employeeRef(app, aboutRef).id;
  if (about !== me && !core().canManage(ctx, about)) throw util.fail(403, 'You ask for feedback about yourself, or about people you manage.', 'not_permitted');
  const asked = (util.list(p, 'from') || []).map(String);
  if (asked.length === 0) throw util.fail(400, 'Give --from: a JSON list of the people to ask, e.g. ["E0004","E0005"].', 'missing_param', { param: 'from' });
  if (asked.length > 10) throw util.fail(400, 'Ask at most 10 people at once.', 'too_many');
  const question = util.text(p, 'text', 1000, '') || (about === me ? 'What should I keep doing, and what could I do better?' : 'What should they keep doing, and what could they do better?');
  const due = util.day(p, 'due', '');
  const out = [];
  const me0 = core().chip(ctx, me);
  const ab = core().chip(ctx, about);
  for (const x of asked) {
    const e = L('lib_people').employeeRef(app, x);
    if (e.id === me || e.id === about) continue;
    const r = util.newRecord(app, 'feedback');
    r.set('from_employee', me);
    r.set('from_member', ctx.memberId || '');
    r.set('from_actor', 'person');
    r.set('to_employee', e.id);
    r.set('about_employee', about);
    r.set('kind', 'request');
    r.set('text', question);
    r.set('values', []);
    r.set('visibility', 'private');
    r.set('status', 'open');
    r.set('due', due);
    r.set('entity', (core().person(ctx, e.id) || { entity: '' }).entity);
    app.save(r);
    out.push(view(ctx, r));
    core().notifyEmployee(app, e.id, { kind: 'performance', title: (me0 ? me0.name : '') + ' asks for your feedback' + (about !== me && ab ? ' about ' + ab.name : ''), link: '#/performance/feedback?view=requests' });
  }
  L('lib_audit').note(ctx, { collection: 'feedback', summary: 'Asked ' + out.length + ' people for feedback' + (about !== me && ab ? ' about ' + ab.name : '') });
  return { requests: out };
}

function decline(ctx, p) {
  const util = u();
  const r = ref(ctx, util.req(p, 'request'));
  if (r.getString('kind') !== 'request' || ctx.isAgent || r.getString('to_employee') !== ctx.employeeId) throw util.fail(403, 'This request was not sent to you.', 'not_permitted');
  if (r.getString('status') !== 'open') throw util.fail(409, 'This request is already ' + r.getString('status') + '.', 'conflict');
  r.set('status', 'declined');
  r.set('declined_reason', util.text(p, 'reason', 1000, ''));
  ctx.app.save(r);
  L('lib_audit').note(ctx, { collection: 'feedback', record: r.id, summary: 'Declined a feedback request' });
  return { request: view(ctx, r) };
}

function remove(ctx, p) {
  const util = u();
  const r = ref(ctx, util.req(p, 'feedback'));
  const v = view(ctx, r);
  if (!v.can_delete) throw util.fail(403, 'The writer removes their own feedback; HR removes posts from the praise wall.', 'not_permitted');
  ctx.app.delete(r);
  L('lib_audit').note(ctx, { collection: 'feedback', record: r.id, summary: 'Removed ' + (v.kind === 'request' ? 'a feedback request' : v.kind + (v.to ? ' to ' + v.to.name : '')) });
  return { deleted: true };
}

/** Public praise since a day (the wall). */
function wallRows(ctx, o) {
  const util = u();
  const where = ["kind = 'praise'", "visibility = 'public'"];
  const bind = {};
  if (o.since) {
    where.push('created >= {:t}');
    bind.t = o.since + ' 00:00:00';
  }
  if (o.value) {
    where.push('json_valid(\"values\") AND EXISTS (SELECT 1 FROM json_each(\"values\") WHERE value = {:val})');
    bind.val = o.value;
  }
  if (o.employee) {
    where.push('(to_employee = {:emp} OR from_employee = {:emp})');
    bind.emp = o.employee;
  }
  const vals = valuesMap(ctx.app);
  return util.rows(ctx.app, 'SELECT id FROM feedback WHERE ' + where.join(' AND ') + ' ORDER BY created DESC LIMIT ' + (o.limit || 30) + ' OFFSET ' + (o.offset || 0), { id: '' }, bind).map((r) => view(ctx, ctx.app.findRecordById('feedback', r.id), vals));
}

function wallCount(ctx, since) {
  return u().count(ctx.app, "SELECT COUNT(*) AS n FROM feedback WHERE kind = 'praise' AND visibility = 'public' AND created >= {:t}", { t: since + ' 00:00:00' });
}

function openRequestsFor(ctx, employeeId) {
  return u()
    .findMany(ctx.app, 'feedback', "kind = 'request' && status = 'open' && to_employee = {:e}", 'due,created', 50, { e: employeeId })
    .map((r) => view(ctx, r));
}

/** Praise and feedback a person received that the caller may see (newest first). */
function receivedBy(ctx, employeeId, limit) {
  const util = u();
  const vals = valuesMap(ctx.app);
  return util
    .findMany(ctx.app, 'feedback', "to_employee = {:e} && kind != 'request'", '-created', 400, { e: employeeId })
    .filter((r) => canSee(ctx, r))
    .slice(0, limit || 20)
    .map((r) => view(ctx, r, vals));
}

/** Feedback and praise about a person in a period that the caller may see (review context). */
function aboutIn(ctx, employeeId, from, to) {
  const util = u();
  const vals = valuesMap(ctx.app);
  return util
    .findMany(ctx.app, 'feedback', "to_employee = {:e} && kind != 'request' && created >= {:f} && created <= {:t}", '-created', 500, { e: employeeId, f: from + ' 00:00:00', t: to + ' 23:59:59.999Z' })
    .filter((r) => canSee(ctx, r))
    .map((r) => view(ctx, r, vals));
}

function list(ctx, p) {
  const util = u();
  const app = ctx.app;
  const which = util.oneOf(p, 'view', ['received', 'given', 'requests', 'asked', 'about', 'wall'], 'received');
  const pg = util.page(p, 30, 200);
  const since = util.day(p, 'since', '');
  const vals = valuesMap(app);
  if (which === 'wall') {
    const empRef = util.str(p, 'employee', '');
    const rows = wallRows(ctx, { since: since, limit: pg.limit + 1, offset: pg.offset, value: util.str(p, 'value', ''), employee: empRef !== '' ? L('lib_people').employeeRef(app, empRef).id : '' });
    return { feedback: rows.slice(0, pg.limit), has_more: rows.length > pg.limit, values: core().settingsOf(app).values };
  }
  let filter;
  const bind = {};
  if (which === 'about') {
    const e = L('lib_people').employeeRef(app, util.req(p, 'employee'));
    core().needSee(ctx, e.id);
    filter = "to_employee = {:e} && kind != 'request'";
    bind.e = e.id;
  } else {
    if (ctx.isAgent) return { feedback: [], has_more: false, values: core().settingsOf(app).values };
    const me = core().selfOrFail(ctx);
    bind.e = me;
    if (which === 'received') filter = "to_employee = {:e} && kind != 'request' && visibility != 'manager'";
    else if (which === 'given') filter = "from_employee = {:e} && kind != 'request'";
    else if (which === 'requests') filter = "to_employee = {:e} && kind = 'request'";
    else filter = "from_employee = {:e} && kind = 'request'";
  }
  const kind = util.oneOf(p, 'kind', ['praise', 'feedback', ''], '');
  if (kind !== '') {
    filter += ' && kind = {:k}';
    bind.k = kind;
  }
  if (since !== '') {
    filter += ' && created >= {:t}';
    bind.t = since + ' 00:00:00';
  }
  const rows = util
    .findMany(app, 'feedback', filter, which === 'requests' ? 'status,-created' : '-created', pg.offset + pg.limit + 200, bind)
    .filter((r) => canSee(ctx, r));
  const page = rows.slice(pg.offset, pg.offset + pg.limit);
  const out = { feedback: page.map((r) => view(ctx, r, vals)), has_more: rows.length > pg.offset + pg.limit, values: core().settingsOf(app).values };
  if (which === 'asked') {
    for (const f of out.feedback) {
      const ans = util.findOne(app, 'feedback', 'request = {:r}', { r: f.id });
      f.answer = ans !== null && canSee(ctx, ans) ? view(ctx, ans, vals) : null;
    }
  }
  return out;
}

module.exports = { canSee: canSee, view: view, give: give, requestOp: requestOp, decline: decline, remove: remove, wallRows: wallRows, wallCount: wallCount, openRequestsFor: openRequestsFor, receivedBy: receivedBy, aboutIn: aboutIn, list: list };
