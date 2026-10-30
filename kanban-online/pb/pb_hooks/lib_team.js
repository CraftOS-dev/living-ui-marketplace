/// <reference path="../pb_data/types.d.ts" />
/**
 * The team: people (accounts with a role and a status) and the AI agents
 * that connect through the agent-app CLI.
 *
 *   me.get / me.update        your account: display name, avatar colour,
 *                             inbox preferences (an agent gets its own entry)
 *   people.list / people.update   the members; admins let new accounts in,
 *                             suspend them and choose who else is an admin
 *   agents.list / agents.update / agents.remove   every agent, live: what it
 *                             works, what waits for it, when it was last seen;
 *                             any member pauses one, admins rename it, set its
 *                             limit and remove it
 *
 * Sign-up: the first account runs the workspace (admin, active); later ones
 * join as members. An account made on this computer is always let in at
 * once (whoever runs the app already controls it); one made through a link
 * the owner shared joins at once too, unless the workspace asks an admin to
 * approve new people.
 */

function U() {
  return require(`${__hooks}/lib_util.js`);
}
function M() {
  return require(`${__hooks}/lib_model.js`);
}

const ONLINE_MS = 120000;
// How the system hooks tell a shared-link request from one made on this computer (_a2app_lib.isRemoteRequest).
const REMOTE_MARKERS = ['Cf-Ray', 'Cf-Connecting-Ip', 'Cf-Visitor', 'Cdn-Loop', 'X-Forwarded-For', 'X-Forwarded-Host', 'Forwarded'];
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

/** True when the request was made on this computer, not through a link the owner shared. */
function fromThisComputer(e) {
  try {
    // Routes carry the HTTP request as e.request; record hooks as e.requestEvent.request.
    const req = e.request || (e.requestEvent && e.requestEvent.request);
    if (!req) return false;
    for (const h of REMOTE_MARKERS) if (String(req.header.get(h) || '') !== '') return false;
    return LOOPBACK_HOST.test(String(req.host || '').trim());
  } catch {
    return false;
  }
}

const ATTENTION = ['interrupt', 'inbox', 'digest'];

/* ------------------------------------------------------------- presence */

/** Where each person is in the app (from app.ui), and whether they are online. */
function presence(app, names) {
  const out = {};
  const now = Date.now();
  for (const id of Object.keys(names.people)) {
    const s = app.store().get('kb.ui:' + id);
    if (!s || !s.at) continue;
    out[id] = { view: s.view || '', board: s.board || '', card: s.card || '', at: U().pbTime(s.at), online: now - s.at < ONLINE_MS };
  }
  return out;
}

/* ------------------------------------------------------------------- me */

function meJson(app, rec) {
  const m = M();
  const prefs = m.json(rec, 'prefs', {}) || {};
  return {
    id: rec.id,
    kind: 'person',
    email: rec.getString('email'),
    name: m.personName(rec),
    named: rec.getString('name').trim() !== '',
    tone: rec.getString('tone') || 'gray',
    role: rec.getString('role') || 'member',
    status: rec.getString('status') || 'active',
    prefs: { attention: Object.assign({ reviews: 'inbox', questions: 'interrupt', attention: 'interrupt', updates: 'digest' }, prefs.attention || {}), inbox: prefs.inbox === 'all' ? 'all' : 'mine' },
    seen_at: rec.getString('seen_at'),
    joined: rec.getString('created'),
  };
}

function me(app, e, p) {
  const m = M();
  const w = m.who(app, e, { allowPending: true });
  if (w.kind === 'agent') return { kind: 'agent', agent: agentNow(app, w.rec) };
  const s = m.settings(app);
  const out = Object.assign(meJson(app, app.findRecordById('users', w.id)), { workspace: s.getString('name') || 'Our team' });
  // Someone waiting to join sees who can let them in.
  if (w.status !== 'active') out.admins = app.findRecordsByFilter('users', "role = 'admin' && status = 'active'", 'created', 10, 0).map((r) => m.personName(r));
  return out;
}

function meUpdate(app, e, p) {
  const u = U();
  const m = M();
  const w = m.who(app, e, { allowPending: true });
  m.personOnly(w, 'Changing an account');
  const rec = app.findRecordById('users', w.id);
  if (u.has(p, 'name')) {
    const n = u.squash(u.str(p, 'name', ''));
    if (n === '') throw u.fail(400, 'name cannot be empty: the name your team sees, e.g. "Ada Park"');
    rec.set('name', n.slice(0, 60));
  }
  if (u.has(p, 'tone')) rec.set('tone', u.oneOf(p, 'tone', m.TONES, 'gray'));
  if (u.has(p, 'prefs')) {
    if (w.status !== 'active') throw u.fail(403, 'Your account waits for an admin to let you in.', { code: w.status });
    const next = u.obj(p, 'prefs', '{"attention":{"questions":"interrupt"},"inbox":"mine"}') || {};
    const cur = m.json(rec, 'prefs', {}) || {};
    const att = Object.assign({}, cur.attention || {});
    const asked = next.attention || {};
    for (const k of ['reviews', 'questions', 'attention', 'updates']) if (asked[k] !== undefined && ATTENTION.indexOf(asked[k]) >= 0) att[k] = asked[k];
    cur.attention = att;
    if (next.inbox === 'mine' || next.inbox === 'all') cur.inbox = next.inbox;
    rec.set('prefs', cur);
  }
  app.save(rec);
  return meJson(app, rec);
}

/* --------------------------------------------------------------- people */

function personJson(rec, pres, open) {
  const m = M();
  const at = pres[rec.id];
  return {
    id: rec.id,
    kind: 'person',
    name: m.personName(rec),
    email: rec.getString('email'),
    tone: rec.getString('tone') || 'gray',
    role: rec.getString('role') || 'member',
    status: rec.getString('status') || 'active',
    online: !!(at && at.online),
    where: at ? { view: at.view, board: at.board, card: at.card } : null,
    last_active: at ? at.at : '',
    open_cards: open['user:' + rec.id] || 0,
    joined: rec.getString('created'),
  };
}

/** Open cards per assignee key. */
function openCounts(app) {
  const out = {};
  const rows = U().rows(app, "SELECT assignee AS k, COUNT(*) AS n FROM cards WHERE archived = 0 AND done_at = '' AND assignee != '' GROUP BY assignee", { k: '', n: 0 });
  for (const r of rows) out[r.k] = r.n;
  return out;
}

function peopleList(app, e, p) {
  const m = M();
  const w = m.who(app, e, p);
  const admin = w.kind === 'person' && w.role === 'admin';
  const names = m.namesFor(app);
  const pres = presence(app, names);
  const open = openCounts(app);
  const rows = app.findRecordsByFilter('users', "id != ''", 'created', 0, 0);
  // Members see the team; admins also see who waits to join and who is suspended.
  const people = rows.filter((r) => admin || (r.getString('status') || 'active') === 'active' || r.id === w.id).map((r) => personJson(r, pres, open));
  return { people: people, pending: admin ? people.filter((x) => x.status === 'pending').length : 0 };
}

function peopleUpdate(app, e, p) {
  const u = U();
  const m = M();
  const w = m.who(app, e, p);
  m.adminOnly(w, 'Changing a member');
  const ref = u.req(p, 'person', 'ada@example.com');
  const rec = m.personRef(app, ref);
  if (rec === null) throw u.fail(404, 'No member "' + ref + '"', { code: 'no_person' });
  if (rec.id === w.id && (u.has(p, 'status') || u.has(p, 'role'))) throw u.fail(409, 'You cannot change your own role or status; ask another admin.', { code: 'self' });
  const admins = () => app.findRecordsByFilter('users', "role = 'admin' && status = 'active'", '', 0, 0).filter((r) => r.id !== rec.id).length;
  const was = { status: rec.getString('status') || 'active', role: rec.getString('role') || 'member' };
  if (u.has(p, 'status')) rec.set('status', u.oneOf(p, 'status', ['active', 'suspended'], 'active'));
  if (u.has(p, 'role')) rec.set('role', u.oneOf(p, 'role', ['admin', 'member'], 'member'));
  if (was.role === 'admin' && (rec.getString('role') !== 'admin' || rec.getString('status') !== 'active') && admins() === 0) {
    throw u.fail(409, 'The workspace needs at least one active admin. Make someone else an admin first.', { code: 'last_admin' });
  }
  app.save(rec);
  const name = m.personName(rec);
  const status = rec.getString('status');
  if (was.status !== status) {
    const kind = status === 'active' ? (was.status === 'pending' ? 'person_approved' : 'person_restored') : 'person_suspended';
    m.log(app, { actor: w, kind: kind, text: name, meta: { person: rec.id } });
  }
  if (was.role !== rec.getString('role')) m.log(app, { actor: w, kind: 'role_changed', text: name + ' is now ' + (rec.getString('role') === 'admin' ? 'an admin' : 'a member'), meta: { person: rec.id } });
  const names = m.namesFor(app);
  return { ok: true, person: personJson(rec, presence(app, names), openCounts(app)) };
}

/* --------------------------------------------------------------- agents */

/** One agent, live: paused, working, waiting (work queued for it) or idle, and whether it is online. */
function agentNow(app, a, shared) {
  const u = U();
  const m = M();
  const W = require(`${__hooks}/lib_work.js`);
  const teamPaused = shared ? shared.paused : m.settings(app).getBool('paused');
  const working = W.workingCards(app, a.id);
  const q = W.queueCounts(app, a);
  const seen = Number(app.store().get('kb_seen:' + a.id) || 0) || u.ms(a.getString('last_seen'));
  const paused = teamPaused || a.getBool('paused');
  const boards = {};
  return Object.assign(m.agentBrief(a), {
    craftbot: a.getString('kind') === 'craftbot',
    status: a.getBool('archived') ? 'removed' : paused ? 'paused' : working.length > 0 ? 'working' : q.total > 0 ? 'waiting' : 'idle',
    team_paused: teamPaused,
    working: working.length,
    working_on: working.map((c) => {
      const b = c.getString('board');
      if (boards[b] === undefined) boards[b] = u.byId(app, 'boards', b);
      return { id: c.id, key: boards[b] ? m.keyOf(boards[b], c) : '', board: b, title: c.getString('title'), progress: c.getString('progress') };
    }),
    queued: q.total,
    max_working: m.maxWorking(app, a),
    own_limit: a.getInt('max_working') || 0,
    last_seen: seen ? u.pbTime(seen) : '',
    online: seen > 0 && Date.now() - seen < ONLINE_MS,
    joined: a.getString('created'),
  });
}

/** Every agent the team has (removed ones with all=true): CraftBot first, then the most recently seen. */
function agentsNow(app, all) {
  const shared = { paused: M().settings(app).getBool('paused') };
  const rows = app.findRecordsByFilter('agents', all ? "id != ''" : 'archived = false', '-last_seen,created', 0, 0);
  const out = rows.map((a) => agentNow(app, a, shared));
  out.sort((x, y) => (y.craftbot ? 1 : 0) - (x.craftbot ? 1 : 0) || (x.removed ? 1 : 0) - (y.removed ? 1 : 0));
  return out;
}

function agentsList(app, e, p) {
  const u = U();
  M().who(app, e, p);
  const days = u.int(p, 'days', 7, 1, 90);
  const A = require(`${__hooks}/lib_app.js`);
  return { agents: agentsNow(app, u.bool(p, 'all', false)).map((a) => Object.assign(a, { stats: A.agentStats(app, days, '', a.id) })), days: days };
}

function mustAgentRec(app, p) {
  const u = U();
  const ref = u.req(p, 'agent', 'craftbot');
  const a = M().agentRef(app, ref);
  if (a === null) throw u.fail(404, 'No agent "' + ref + '". agents.list shows the team\'s agents.', { code: 'no_agent' });
  return a;
}

function agentsUpdate(app, e, p) {
  const u = U();
  const m = M();
  const w = m.who(app, e, p);
  m.personOnly(w, 'Changing an agent');
  const a = mustAgentRec(app, p);
  // Pausing is everyone's brake; the rest is the admins'.
  const adminKeys = ['name', 'tone', 'max_working', 'restore'].filter((k) => u.has(p, k));
  if (adminKeys.length > 0) m.adminOnly(w, 'Changing an agent (' + adminKeys.join(', ') + ')');
  const was = a.getBool('paused');
  if (u.has(p, 'restore') && u.bool(p, 'restore', false)) {
    a.set('archived', false);
    m.log(app, { actor: w, kind: 'agent_restored', text: a.getString('name'), meta: { agent: a.id } });
  }
  if (a.getBool('archived')) throw u.fail(409, a.getString('name') + ' was removed. Bring it back with --restore true first.', { code: 'agent_removed' });
  if (u.has(p, 'name')) {
    const n = u.squash(u.str(p, 'name', ''));
    if (n === '') throw u.fail(400, 'name cannot be empty');
    a.set('name', n.slice(0, 60));
  }
  if (u.has(p, 'tone')) a.set('tone', u.oneOf(p, 'tone', m.TONES, 'orange'));
  if (u.has(p, 'max_working')) a.set('max_working', u.int(p, 'max_working', 0, 0, 10));
  if (u.has(p, 'paused')) a.set('paused', u.bool(p, 'paused', false));
  app.save(a);
  const now = a.getBool('paused');
  if (was !== now) {
    m.log(app, { actor: w, kind: now ? 'agent_paused' : 'agent_resumed', text: now ? 'Paused ' + a.getString('name') : a.getString('name') + ' may work again', meta: { agent: a.id } });
    if (!now) {
      require(`${__hooks}/lib_work.js`).markDirty(app);
      require(`${__hooks}/lib_work.js`).fireIfNeeded(app);
    }
  }
  return { ok: true, agent: agentNow(app, a) };
}

/** Remove an agent: its cards go back to the pool (or to nobody), its own columns to any agent. */
function agentsRemove(app, e, p) {
  const u = U();
  const m = M();
  const C = require(`${__hooks}/lib_cards.js`);
  const w = m.who(app, e, p);
  m.adminOnly(w, 'Removing an agent');
  const a = mustAgentRec(app, p);
  if (a.getBool('archived')) return { ok: true, cards: 0 };
  const key = 'agent:' + a.id;
  let n = 0;
  for (const c of app.findRecordsByFilter('cards', "archived = false && done_at = '' && (assignee = {:k} || claimed_by = {:a})", '', 0, 0, { k: key, a: a.id })) {
    const st = c.getString('agent_state');
    if (st === 'working') {
      C.endSession(app, c, 'stopped', a.getString('name') + ' was removed');
      c.set('agent_state', 'queued');
    }
    if (c.getString('assignee') === key) c.set('assignee', c.getString('agent_state') !== '' ? 'pool' : '');
    c.set('version', c.getInt('version') + 1);
    app.save(c);
    n++;
  }
  for (const col of app.findRecordsByFilter('columns', 'agent = {:a}', '', 0, 0, { a: a.id })) {
    col.set('agent', '');
    col.set('agent_mode', 'any');
    app.save(col);
  }
  a.set('archived', true);
  a.set('paused', false);
  app.save(a);
  m.log(app, { actor: w, kind: 'agent_removed', text: a.getString('name') + (n > 0 ? ': ' + u.plural(n, 'card') + ' went back to the team' : ''), meta: { agent: a.id } });
  if (n > 0) {
    require(`${__hooks}/lib_work.js`).markDirty(app);
    require(`${__hooks}/lib_work.js`).fireIfNeeded(app);
  }
  return { ok: true, cards: n };
}

/* --------------------------------------------------------------- sign-up */

/** A new account (from the sign-in page): the first runs the workspace; the rest join as members. */
function onSignup(e) {
  const app = e.app;
  const m = M();
  const r = e.record;
  const count = app.findRecordsByFilter('users', "id != ''", '', 0, 0).length;
  const superuser = e.hasSuperuserAuth();
  if (!superuser || r.getString('role') === '') r.set('role', count === 0 ? 'admin' : 'member');
  if (!superuser || r.getString('status') === '') {
    const open = (m.settings(app).getString('joining') || 'open') === 'open';
    r.set('status', count === 0 || open || fromThisComputer(e) ? 'active' : 'pending');
  }
  if (r.getString('tone') === '' || !superuser) r.set('tone', m.TONES[count % m.TONES.length]);
  if (!superuser) {
    r.set('prefs', null);
    r.set('seen_at', '');
  }
}

function onJoined(e) {
  const m = M();
  const r = e.record;
  const pending = r.getString('status') === 'pending';
  m.log(e.app, { actor: { kind: 'system', id: 'system' }, kind: pending ? 'person_waiting' : 'person_joined', text: m.personName(r) + (pending ? ' asked to join' : ' joined'), meta: { person: r.id } });
}

/** People change their own name, email and password from the app; only admins change roles and status. */
function onSelfUpdate(e) {
  if (e.hasSuperuserAuth()) return;
  const r = e.record;
  const before = r.original();
  for (const f of ['role', 'status', 'seen_at']) {
    if (r.getString(f) !== before.getString(f)) throw new ForbiddenError('Only an admin changes ' + f + ' (people.update).');
  }
  if (r.getString('tone') !== '' && M().TONES.indexOf(r.getString('tone')) < 0) throw new BadRequestError('tone must be one of ' + M().TONES.join(', '));
}

module.exports = {
  ONLINE_MS: ONLINE_MS,
  presence: presence,
  meJson: meJson,
  me: me,
  meUpdate: meUpdate,
  personJson: personJson,
  openCounts: openCounts,
  peopleList: peopleList,
  peopleUpdate: peopleUpdate,
  agentNow: agentNow,
  agentsNow: agentsNow,
  agentsList: agentsList,
  agentsUpdate: agentsUpdate,
  agentsRemove: agentsRemove,
  onSignup: onSignup,
  onJoined: onJoined,
  onSelfUpdate: onSelfUpdate,
};
