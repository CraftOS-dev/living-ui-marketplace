/// <reference path="../pb_data/types.d.ts" />
/**
 * In-app notifications per member, plus an optional email through your AI
 * agent's Gmail (the bridge action send_gmail) when the company turned
 * email on (settings.email_notifications). Emails are queued with the
 * notification and sent by the minute job, outside any transaction; they
 * carry the title and a link, never amounts.
 *
 *   notify(app, memberIds, { kind, title, body, link, email, facts })   (facts: lib_util.facts shape)
 *   toRole(app, roleCode, { ... })         every active member with the role
 *   toEmployee(app, employeeId, { ... })   the member linked to the employee
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}

function notify(app, memberIds, n) {
  const util = u();
  const s = require(`${__hooks}/lib_settings.js`).row(app);
  const email = s.getBool('email_notifications') && n.email !== false;
  const out = [];
  const seen = {};
  for (const id of memberIds || []) {
    if (!id || seen[id]) continue;
    seen[id] = true;
    const m = util.byId(app, 'members', id);
    if (m === null || m.getString('status') !== 'active') continue;
    const r = util.newRecord(app, 'notifications');
    r.set('member', id);
    r.set('kind', util.clip(n.kind || 'info', 40));
    r.set('title', util.clip(n.title || '', 200));
    r.set('body', util.clip(n.body || '', 2000));
    r.set('link', util.clip(n.link || '', 300));
    r.set('facts', util.facts(n.facts));
    r.set('read', false);
    r.set('email', email ? 'pending' : 'none');
    app.save(r);
    out.push(r.id);
  }
  return out;
}

function toRole(app, roleCode, n) {
  const role = require(`${__hooks}/lib_auth.js`).roleByCode(app, roleCode);
  if (role === null) return [];
  return notify(
    app,
    u()
      .findMany(app, 'members', "role = {:r} && status = 'active'", '', 0, { r: role.id })
      .map((m) => m.id),
    n,
  );
}

function toEmployee(app, employeeId, n) {
  const e = u().byId(app, 'employees', employeeId);
  if (e === null || e.getString('member') === '') return [];
  return notify(app, [e.getString('member')], n);
}

/** The minute job: send queued emails (at most 20 a minute). */
function sendPending(app) {
  const util = u();
  const rows = util.findMany(app, 'notifications', "email = 'pending'", 'created', 20);
  if (rows.length === 0) return 0;
  const bridge = require(`${__hooks}/_craftbot_bridge.js`);
  const s = require(`${__hooks}/lib_settings.js`).row(app);
  let sent = 0;
  for (const r of rows) {
    const m = util.byId(app, 'members', r.getString('member'));
    if (m === null) continue;
    const res = bridge.callAction('send_gmail', {
      to: m.getString('email'),
      subject: '[' + (s.getString('company_name') || 'HR OS') + '] ' + r.getString('title'),
      body: r.getString('title') + '\n\nOpen HR OS to see it.',
    });
    const ok = res && (res.status === 200 || res.ok === true || res.success === true);
    r.set('email', ok ? 'sent' : 'failed');
    app.save(r);
    if (ok) sent++;
    else console.log('[hr] notification email not sent: ' + JSON.stringify(res).slice(0, 300));
  }
  return sent;
}


/** A link is an in-app route only: '#/' and path characters, never a scheme or a host. */
function safeLink(text) {
  const util = require(`${__hooks}/lib_util.js`);
  const t = String(text || '').trim();
  if (t === '') return '';
  if (!/^#\/[A-Za-z0-9\-._~\/?=&%]*$/.test(t) || t.indexOf('//') >= 0) throw util.fail(400, 'link must be an in-app route starting with #/ (for example #/people/E0015?tab=bank), or use --record. Got "' + util.clip(t, 80) + '".', 'invalid_param', { param: 'link' });
  return t;
}

/**
 * A record named by your AI agent, resolved on the server to its in-app
 * link: an employee (number, email or name), a pay run (number or id), an
 * approval, a proposal or a question to your AI agent (id).
 */
function recordLink(app, ref) {
  const util = require(`${__hooks}/lib_util.js`);
  const r = String(ref || '').trim();
  if (r === '') return null;
  const tries = [
    ['approvals', (x) => '#/inbox/approvals/' + x.id, (x) => x.getString('summary')],
    ['proposals', (x) => '#/inbox/proposals/' + x.id, (x) => x.getString('title')],
    ['agent_questions', () => '#/inbox?view=agent', (x) => x.getString('question').slice(0, 120)],
  ];
  for (const [col, link, label] of tries) {
    const rec = util.byId(app, col, r);
    if (rec !== null) return { key: col + ':' + rec.id, link: link(rec), label: label(rec) };
  }
  if (app.hasTable('payruns')) {
    const run = util.byId(app, 'payruns', r) || util.findOne(app, 'payruns', 'number = {:n}', { n: r.toUpperCase() });
    if (run !== null) return { key: 'payruns:' + run.id, link: '#/payroll/runs/' + run.id, label: run.getString('number') || run.id };
  }
  const people = require(`${__hooks}/lib_people.js`);
  const emp = people.employeeRef(app, r);
  return { key: 'employees:' + emp.id, link: '#/people/' + emp.getString('number'), label: people.displayName(emp) + ' (' + emp.getString('number') + ')', employee: emp };
}

/** Which role does an op belong to, by its permission module. */
const MODULE_ROLE = { people: 'hr_admin', time: 'hr_admin', leave: 'hr_admin', hiring: 'hr_admin', performance: 'hr_admin', reports: 'hr_admin', payroll: 'payroll_admin', expenses: 'payroll_admin', admin: 'owner' };
// Self-service kernel ops (perm signed) whose requests belong to payroll.
const GROUP_ROLE = { bank: 'payroll_admin', seal: 'payroll_admin', pay: 'payroll_admin', tax: 'payroll_admin' };

/** The members a hand-over goes to: a member, a role, or the role of an op. Returns { ids, to }. */
function recipients(app, p, spec, opName) {
  const util = require(`${__hooks}/lib_util.js`);
  const auth = require(`${__hooks}/lib_auth.js`);
  const ids = [];
  const member = util.str(p, 'member', '');
  if (member !== '') {
    const m = auth.memberRef(app, member);
    if (m.getString('status') !== 'active') throw util.fail(409, m.getString('name') + ' is not an active member.', 'no_recipient');
    return { ids: [m.id], to: m.getString('name'), key: 'member:' + m.id };
  }
  let roleCode = util.str(p, 'role', '');
  if (roleCode === '' && spec !== null) {
    const perm = String(spec.perm || '').split('|')[0];
    const module = perm === 'admin' ? 'admin' : perm.split(':')[0];
    roleCode = GROUP_ROLE[opName.split('.')[0]] || MODULE_ROLE[module] || 'hr_admin';
    if (opName === 'approvals.decide' || opName === 'proposals.accept' || opName === 'proposals.dismiss') roleCode = 'hr_admin';
  }
  if (roleCode === '') roleCode = 'hr_admin';
  const role = auth.roleRef(app, roleCode);
  for (const m of util.findMany(app, 'members', "status = 'active' && role = {:r}", 'created', 0, { r: role.id })) ids.push(m.id);
  let to = role.getString('name');
  if (ids.length === 0) {
    const owner = auth.roleByCode(app, 'owner');
    for (const m of util.findMany(app, 'members', "status = 'active' && role = {:r}", 'created', 0, { r: owner.id })) ids.push(m.id);
    to = 'Owner (no active ' + role.getString('name') + ')';
  }
  return { ids: ids, to: to, key: 'role:' + role.getString('code') };
}

/**
 * Hand a request to people as an Inbox item (kind agent_request). Only your
 * AI agent uses it. The request is untrusted text: it is stored quoted, under
 * a fixed title, never as the title; links are in-app routes only. The same
 * hand-over (kind, person told, record) while it is unread is not repeated.
 * Used by inbox.route.
 */
function handOver(ctx, o) {
  const util = require(`${__hooks}/lib_util.js`);
  const app = ctx.app;
  const what = o.op !== '' ? o.op : o.kind;
  const quoted = util
    .clip(String(o.request || ''), 2000)
    .split(/\r?\n/)
    .map((l) => '> ' + l)
    .join('\n');
  const body = 'Your AI agent passed on this request' + (o.asked_by ? ' from ' + o.asked_by : '') + ':\n' + quoted + (o.op !== '' ? '\n\nIt needs ' + o.op + ', which a person does in HR OS.' : '');
  const title = 'Your AI agent passed on a request' + (o.record_label ? ': ' + util.clip(o.record_label, 120) : '');
  const ref = util.clip(what + '|' + (o.record_key || '-'), 200);
  const facts = [{ type: 'text', key: 'request', label: 'Request', value: util.clip(String(o.request || ''), 300) }];
  if (o.op !== '') facts.push({ type: 'text', key: 'op', label: 'Needs', value: o.op });
  if (o.asked_by) facts.push({ type: 'text', key: 'asked_by', label: 'Asked by', value: o.asked_by });
  if (o.record_label) facts.push({ type: 'text', key: 'record', label: 'About', value: o.record_label });
  facts.push({ type: 'state', key: 'status', value: 'open' });
  const fresh = o.ids.filter((id) => util.findOne(app, 'notifications', "member = {:m} && kind = 'agent_request' && ref = {:r} && read = false", { m: id, r: ref }) === null);
  const made = notify(app, fresh, { kind: 'agent_request', title: title, body: body, link: o.link, facts: facts });
  for (const id of made) {
    const rec = app.findRecordById('notifications', id);
    rec.set('ref', ref);
    app.save(rec);
  }
  return { made: made, already: o.ids.length - fresh.length };
}

/**
 * inbox.route (your AI agent only): hand a request it may not do (a
 * people-only op, an approval, a refused change) to the people who can.
 */
function route(ctx, p) {
  const util = require(`${__hooks}/lib_util.js`);
  const app = ctx.app;
  if (!ctx.isAgent) throw util.fail(403, 'inbox.route is for your AI agent. People ask each other in the app.', 'not_permitted');
  const request = util.text(p, 'request', 2000, '');
  if (request === '') throw util.fail(400, 'Write the request for the person (what was asked, with the record, dates and amounts).', 'missing_param', { param: 'request' });
  let spec = null;
  const opName = util.str(p, 'op', '');
  if (opName !== '') spec = require(`${__hooks}/lib_catalog.js`).get(opName);
  const people = require(`${__hooks}/lib_people.js`);
  let rec = recordLink(app, util.str(p, 'record', ''));
  let emp = rec !== null && rec.employee ? rec.employee : null;
  if (util.str(p, 'employee', '') !== '') {
    emp = people.employeeRef(app, util.str(p, 'employee', ''));
    if (rec === null) rec = { key: 'employees:' + emp.id, link: '#/people/' + emp.getString('number'), label: people.displayName(emp) + ' (' + emp.getString('number') + ')' };
  }
  let askedBy = '';
  if (util.str(p, 'asked_by', '') !== '') {
    const ab = util.str(p, 'asked_by', '');
    const m = util.byId(app, 'members', ab) || require(`${__hooks}/lib_auth.js`).memberByEmail(app, ab);
    askedBy = m !== null ? m.getString('name') : people.displayName(people.employeeRef(app, ab));
  }
  const who = recipients(app, p, spec, opName);
  let toldEmployee = '';
  const selfService = spec !== null && (spec.perm === 'signed' || spec.perm === 'self');
  if (emp !== null && selfService) {
    if (emp.getString('member') !== '' && util.byId(app, 'members', emp.getString('member')) !== null && util.byId(app, 'members', emp.getString('member')).getString('status') === 'active') {
      if (who.ids.indexOf(emp.getString('member')) < 0) who.ids.push(emp.getString('member'));
      toldEmployee = 'told';
    } else toldEmployee = 'not a member';
  }
  const link = util.str(p, 'link', '') !== '' ? safeLink(util.str(p, 'link', '')) : rec !== null ? rec.link : '#/inbox';
  const out = handOver(ctx, { kind: 'route', op: opName, request: request, asked_by: askedBy, record_key: (rec ? rec.key : '-') + '|' + who.key, record_label: rec ? rec.label : '', link: link, ids: who.ids });
  require(`${__hooks}/lib_audit.js`).note(ctx, { collection: 'notifications', summary: 'Your AI agent passed a request to ' + who.to + (opName ? ' (' + opName + ')' : '') });
  const tell = emp !== null && selfService ? (toldEmployee === 'told' ? ' ' + people.displayName(emp) + ' was told too (it is their own self-service step).' : ' ' + people.displayName(emp) + ' was not told: they have no active member account.') : '';
  return {
    routed: out.made.length,
    already: out.already,
    to: who.to,
    employee_told: toldEmployee === 'told',
    link: link,
    message: (out.made.length > 0 ? 'In the Inbox of ' + out.made.length + ' person' + (out.made.length === 1 ? '' : 's') + ' (' + who.to + ').' : 'The same hand-over is already waiting in their Inbox.') + tell + ' Tell the person who asked that it was handed over.',
  };
}

function view(r) {
  return { id: r.id, kind: r.getString('kind'), title: r.getString('title'), body: r.getString('body'), link: r.getString('link'), facts: u().jsonOf(r, 'facts', []) || [], read: r.getBool('read'), created: r.getString('created') };
}

function list(ctx, p) {
  const util = u();
  if (ctx.member === null) return { notifications: [], unread: 0, total: 0 };
  const pg = util.page(p, 30, 200);
  const unreadOnly = util.bool(p, 'unread', false);
  const where = 'member = {:m}' + (unreadOnly ? ' && read = false' : '');
  const rows = util.findMany(ctx.app, 'notifications', where, '-created', pg.limit + pg.offset, { m: ctx.memberId }).slice(pg.offset);
  return {
    notifications: rows.map(view),
    unread: util.count(ctx.app, 'SELECT COUNT(*) AS n FROM notifications WHERE member = {:m} AND read = FALSE', { m: ctx.memberId }),
    total: util.count(ctx.app, 'SELECT COUNT(*) AS n FROM notifications WHERE member = {:m}', { m: ctx.memberId }),
  };
}

function read(ctx, p) {
  const util = u();
  const r = util.byId(ctx.app, 'notifications', util.req(p, 'notification'));
  if (r === null || r.getString('member') !== ctx.memberId) throw util.fail(404, 'No such notification.', 'not_found');
  r.set('read', util.bool(p, 'read', true));
  ctx.app.save(r);
  ctx.audited = true;
  return { notification: view(r) };
}

function readAll(ctx) {
  if (ctx.member === null) return { updated: 0 };
  const util = u();
  const n = util.count(ctx.app, 'SELECT COUNT(*) AS n FROM notifications WHERE member = {:m} AND read = FALSE', { m: ctx.memberId });
  util.exec(ctx.app, 'UPDATE notifications SET read = TRUE WHERE member = {:m} AND read = FALSE', { m: ctx.memberId });
  require(`${__hooks}/lib_bus.js`).touch('notifications');
  ctx.audited = true;
  return { updated: n };
}

module.exports = { route: route, handOver: handOver, recipients: recipients, safeLink: safeLink, recordLink: recordLink, MODULE_ROLE: MODULE_ROLE, notify: notify, toRole: toRole, toEmployee: toEmployee, sendPending: sendPending, list: list, read: read, readAll: readAll };
