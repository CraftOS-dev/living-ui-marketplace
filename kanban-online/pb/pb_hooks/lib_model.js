/// <reference path="../pb_data/types.d.ts" />
/**
 * The model shared by every operation: who is calling (a person or an
 * agent), loading boards, columns and cards, card keys (OPS-12), positions,
 * the activity log, and the JSON shapes the UI and the agents read.
 *
 * Identity: people sign in (PocketBase users); an account must be approved
 * (status active) before it reads or changes anything. The agent-app CLI
 * signs in as the app's machine superuser and names itself with
 * X-A2App-Agent; each name is one agent (generic CLI names are CraftBot). A
 * new name is registered as an agent the first time it calls. Agent names
 * are declared by the caller, so these rules catch mistakes, not malice.
 *
 * Keys: an assignee or an actor is stored as 'user:<id>', 'agent:<id>',
 * 'pool' (any agent may take it), 'rule:<id>' or 'system'.
 */

const CATEGORIES = ['triage', 'backlog', 'todo', 'doing', 'review', 'done', 'canceled'];
const CAT_LABEL = { triage: 'Proposed', backlog: 'Backlog', todo: 'To do', doing: 'In progress', review: 'Review', done: 'Done', canceled: 'Canceled' };
const CLOSED = { done: 1, canceled: 1 };
const STARTED = { doing: 1, review: 1 };
const LABEL_COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'];
const TONES = ['orange', 'blue', 'green', 'purple', 'teal', 'pink', 'yellow', 'red', 'gray'];
// CLI names that mean CraftBot itself (and its own verification tools).
const GENERIC = { '': 1, 'a2app-cli': 1, cli: 1, craftbot: 1, agent: 1, 'lui-cli': 1, 'ops-verify': 1, 'op-smoke': 1 };

function U() {
  return require(`${__hooks}/lib_util.js`);
}

/* ------------------------------------------------------------------ who */

function slug(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function authOf(e) {
  if (!e) return null;
  try {
    if (e.auth) return e.auth;
  } catch {
    /* no auth on this event */
  }
  try {
    const info = e.requestInfo();
    return info && info.auth ? info.auth : null;
  } catch {
    return null;
  }
}

function personName(rec) {
  const n = rec.getString('name').trim();
  if (n !== '') return n;
  const email = rec.getString('email');
  return email ? email.split('@')[0] : 'Someone';
}

/**
 * Who is calling: a person {kind: 'person', id, key, name, role} or an agent
 * {kind: 'agent', id, key, name, handle}. opts.allowPending lets an account
 * that waits for approval read its own state.
 */
function who(app, e, opts) {
  const u = U();
  const auth = authOf(e);
  if (auth === null) throw u.fail(401, 'Sign in first.', { code: 'signed_out' });
  const coll = auth.collection().name;
  if (coll === '_superusers') return agentCaller(app, e);
  if (coll !== 'users') throw u.fail(403, 'This account cannot use the board.', { code: 'not_member' });
  const status = auth.getString('status') || 'active';
  if (status !== 'active' && !(opts && opts.allowPending)) {
    throw u.fail(403, status === 'pending' ? 'Your account waits for an admin to let you in.' : 'Your account is suspended. Ask an admin.', { code: status });
  }
  return { kind: 'person', id: auth.id, key: 'user:' + auth.id, name: personName(auth), role: auth.getString('role') || 'member', status: status, rec: auth };
}

function agentCaller(app, e) {
  const u = U();
  const header = u.agentHeader(e);
  const handle = GENERIC[header.toLowerCase()] ? 'craftbot' : slug(header) || 'craftbot';
  let a = u.findOne(app, 'agents', 'handle = {:h}', { h: handle });
  if (a === null) a = registerAgent(app, handle, header);
  if (a.getBool('archived')) throw u.fail(403, 'The team removed the agent "' + a.getString('name') + '". An admin can bring it back on the Team page.', { code: 'agent_removed' });
  touchAgent(app, a);
  return { kind: 'agent', id: a.id, key: 'agent:' + a.id, name: a.getString('name'), handle: handle, rec: a };
}

/** A new agent name: registered the first time it calls. */
function registerAgent(app, handle, label) {
  const col = app.findCollectionByNameOrId('agents');
  const r = new Record(col);
  const used = app.findAllRecords('agents').length;
  r.set('handle', handle);
  r.set('name', handle === 'craftbot' ? 'CraftBot' : String(label || handle).slice(0, 60));
  r.set('kind', handle === 'craftbot' ? 'craftbot' : 'external');
  r.set('tone', TONES[used % TONES.length]);
  app.save(r);
  log(app, { kind: 'agent_joined', actor: { kind: 'system', id: 'system' }, text: r.getString('name') + ' connected', meta: { agent: r.id } });
  return r;
}

/** The agent was here: last_seen written at most every 30 s; the store keeps the exact time. */
function touchAgent(app, a) {
  const now = Date.now();
  app.store().set('kb_seen:' + a.id, now);
  if (now - U().ms(a.getString('last_seen')) < 30000) return;
  try {
    a.set('last_seen', U().pbTime(now));
    app.saveNoValidate(a);
  } catch {
    /* bookkeeping only */
  }
}

function settings(app) {
  const rows = app.findRecordsByFilter('settings', "id != ''", 'created', 1, 0);
  if (rows.length > 0) return rows[0];
  const r = new Record(app.findCollectionByNameOrId('settings'));
  r.set('name', 'Our team');
  r.set('joining', 'open');
  r.set('defaults', { lease_minutes: 15, max_attempts: 3 });
  r.set('max_working', 2);
  app.save(r);
  return r;
}

/** How many cards an agent works at once: its own limit, else the workspace default. */
function maxWorking(app, agent) {
  return (agent && agent.getInt('max_working')) || settings(app).getInt('max_working') || 2;
}

/** Refuse a person-only action to an agent. */
function personOnly(w, what) {
  if (w.kind === 'agent') throw U().fail(403, what + ' is for people, not agents. If a card needs it, say so with work.ask or work.return, or leave a comment for the team.', { code: 'person_only' });
}

/** Refuse an admin-only action to members and agents. */
function adminOnly(w, what) {
  personOnly(w, what);
  if (w.role !== 'admin') throw U().fail(403, what + ' is for admins.', { code: 'admin_only' });
}

/** Refuse agent writes while the board is frozen or the agent (or every agent) is paused. */
function agentMayWrite(app, w, board) {
  if (w.kind !== 'agent') return;
  const u = U();
  if (board && board.getBool('frozen')) throw u.fail(423, 'The board "' + board.getString('name') + '" is frozen: agents cannot change it until a person unfreezes it.', { code: 'board_frozen' });
  if (settings(app).getBool('paused')) throw u.fail(423, 'The team paused every agent. Stop and report what you were doing.', { code: 'agents_paused' });
  if (w.rec && w.rec.getBool('paused')) throw u.fail(423, 'The team paused you (' + w.name + '). Stop and report what you were doing.', { code: 'agent_paused' });
}

/* --------------------------------------------------------------- records */

function mustBoard(app, ref) {
  const u = U();
  const r = String(ref || '').trim();
  if (r === '') throw u.fail(400, 'board is required (an id or a key like OPS; boards.list gives them)');
  let b = u.byId(app, 'boards', r);
  if (b === null) b = u.findOne(app, 'boards', 'key = {:k}', { k: r.toUpperCase() });
  if (b === null) throw u.fail(404, 'No board "' + r + '" (boards.list gives the ids and keys)');
  return b;
}

function columnsOf(app, boardId) {
  return app.findRecordsByFilter('columns', 'board = {:b}', 'position,created', 0, 0, { b: boardId });
}

function mustColumn(app, ref, boardId) {
  const u = U();
  const r = String(ref || '').trim();
  if (r === '') throw u.fail(400, 'column is required (an id or a column name)');
  let c = u.byId(app, 'columns', r);
  if (c === null && boardId) {
    const low = r.toLowerCase();
    c = columnsOf(app, boardId).find((x) => x.getString('name').toLowerCase() === low) || null;
  }
  if (c === null || (boardId && c.getString('board') !== boardId)) throw u.fail(404, 'No column "' + r + '" on this board (boards.get lists the columns)');
  return c;
}

/** A card by id or key (OPS-12). */
function mustCard(app, ref) {
  const u = U();
  const r = String(ref || '').trim();
  if (r === '') throw u.fail(400, 'card is required (an id or a key like OPS-12)');
  let c = u.byId(app, 'cards', r);
  if (c === null) {
    const m = /^([A-Za-z][A-Za-z0-9]{0,5})-(\d+)$/.exec(r);
    if (m) {
      const b = u.findOne(app, 'boards', 'key = {:k}', { k: m[1].toUpperCase() });
      if (b !== null) c = u.findOne(app, 'cards', 'board = {:b} && number = {:n}', { b: b.id, n: Number(m[2]) });
    }
  }
  if (c === null) throw u.fail(404, 'No card "' + r + '" (cards.list gives the ids and keys)');
  return c;
}

/** An agent by id, handle or name. */
function agentRef(app, ref) {
  const u = U();
  const r = String(ref || '').trim();
  if (r === '') return null;
  return u.byId(app, 'agents', r) || u.findOne(app, 'agents', 'handle = {:h}', { h: slug(r) }) || u.findOne(app, 'agents', 'name = {:n}', { n: r });
}

/** A person by id, email or name. */
function personRef(app, ref) {
  const u = U();
  const r = String(ref || '').trim();
  if (r === '') return null;
  return u.byId(app, 'users', r) || u.findOne(app, 'users', 'email = {:e}', { e: r.toLowerCase() }) || u.findOne(app, 'users', 'name = {:n}', { n: r });
}

function keyOf(board, card) {
  return board.getString('key') + '-' + card.getInt('number');
}

/** The next column on the way forward: the column's own `next`, or the next by position. */
function nextColumn(cols, col) {
  const target = col.getString('next');
  if (target !== '') {
    const t = cols.find((c) => c.id === target);
    if (t) return t;
  }
  const i = cols.findIndex((c) => c.id === col.id);
  for (let k = i + 1; k < cols.length; k++) {
    if (cols[k].getString('category') !== 'canceled') return cols[k];
  }
  return null;
}

function firstOf(cols, cats) {
  for (const c of cols) if (cats.indexOf(c.getString('category')) >= 0) return c;
  return null;
}

/** Cards in a column (not archived), in order. */
function cardsIn(app, columnId) {
  return app.findRecordsByFilter('cards', 'column = {:c} && archived = false', 'position,created', 0, 0, { c: columnId });
}

/** A position at the top, the bottom, or at an index of a column (cards keep sparse float positions). */
function positionIn(app, columnId, where, exceptId) {
  const list = cardsIn(app, columnId).filter((c) => c.id !== exceptId);
  if (list.length === 0) return 1000;
  if (where === 'top' || where === 0) return list[0].getFloat('position') - 1000;
  if (where === 'bottom' || where === undefined || where === null || where >= list.length) return list[list.length - 1].getFloat('position') + 1000;
  const i = Math.max(0, Math.min(list.length, Number(where)));
  const a = list[i - 1].getFloat('position');
  const b = list[i].getFloat('position');
  return (a + b) / 2;
}

/* -------------------------------------------------------------- activity */

/** The stored key of an actor: user:<id>, agent:<id>, rule:<id> or system. */
function actorKey(w) {
  if (!w) return 'system';
  if (w.kind === 'person') return 'user:' + w.id;
  if (w.kind === 'agent') return 'agent:' + w.id;
  if (w.kind === 'rule') return 'rule:' + (w.id || '');
  return 'system';
}

/**
 * Append one event. who: a person, an agent, {kind: 'rule', id} or
 * {kind: 'system'}. Never throws: the activity log must not break the
 * change it records.
 */
function log(app, ev) {
  try {
    const col = app.findCollectionByNameOrId('events');
    const r = new Record(col);
    const w = ev.actor || { kind: 'system', id: 'system' };
    if (ev.board) r.set('board', ev.board);
    if (ev.card) r.set('card', ev.card);
    r.set('actor', actorKey(w));
    r.set('actor_kind', w.kind === 'person' || w.kind === 'agent' || w.kind === 'rule' ? w.kind : 'system');
    r.set('kind', ev.kind);
    if (ev.text) r.set('text', String(ev.text).slice(0, 20000));
    if (ev.field) r.set('field', ev.field);
    if (ev.before !== undefined) r.set('before', ev.before === undefined ? null : ev.before);
    if (ev.after !== undefined) r.set('after', ev.after === undefined ? null : ev.after);
    if (ev.run) r.set('run', ev.run);
    const meta = Object.assign({}, ev.meta || {});
    if (Object.keys(meta).length > 0) r.set('meta', meta);
    app.save(r);
    return r;
  } catch (err) {
    console.error('[kanban-online] activity log failed:', err);
    return null;
  }
}

/* ---------------------------------------------------------------- shapes */

function json(rec, field, dflt) {
  const v = U().getJson(rec, field);
  return v === null || v === undefined ? dflt : v;
}

/** Everyone who can appear on a card: people and agents, by id. */
function namesFor(app) {
  const people = {};
  for (const p of app.findAllRecords('users')) people[p.id] = p;
  const agents = {};
  for (const a of app.findAllRecords('agents')) agents[a.id] = a;
  return { people: people, agents: agents };
}

/** Lookup tables for serializing many cards of one board at once. */
function ctxFor(app, boardId, names) {
  const cols = {};
  for (const c of columnsOf(app, boardId)) cols[c.id] = c;
  const labels = {};
  for (const l of app.findRecordsByFilter('labels', 'board = {:b}', 'name', 0, 0, { b: boardId })) labels[l.id] = l;
  const n = names || namesFor(app);
  return { cols: cols, labels: labels, board: U().byId(app, 'boards', boardId), people: n.people, agents: n.agents };
}

function personBrief(rec) {
  if (!rec) return null;
  return { kind: 'person', id: rec.id, name: personName(rec), tone: rec.getString('tone') || 'gray' };
}

function agentBrief(rec) {
  if (!rec) return null;
  return { kind: 'agent', id: rec.id, name: rec.getString('name'), handle: rec.getString('handle'), tone: rec.getString('tone') || 'orange', paused: rec.getBool('paused'), removed: rec.getBool('archived') };
}

/** A stored key (user:<id>, agent:<id>, pool) as a brief: a person, an agent, any agent, or null. */
function partyOf(key, names) {
  const k = String(key || '');
  if (k === 'pool') return { kind: 'pool', name: 'Any agent' };
  if (k.indexOf('user:') === 0) return personBrief(names.people[k.slice(5)]) || { kind: 'person', id: k.slice(5), name: 'Former member', tone: 'gray' };
  if (k.indexOf('agent:') === 0) return agentBrief(names.agents[k.slice(6)]) || { kind: 'agent', id: k.slice(6), name: 'Removed agent', handle: '', tone: 'gray', paused: false, removed: true };
  if (k.indexOf('rule:') === 0) return { kind: 'rule', name: 'A rule' };
  if (k === 'system') return { kind: 'system', name: 'The board' };
  return null;
}

/** A party as one line for the agents' lean reads. */
function partyText(key, names) {
  const p = partyOf(key, names);
  if (p === null) return 'nobody';
  if (p.kind === 'pool') return 'any agent';
  if (p.kind === 'agent') return 'agent ' + p.name;
  return p.name;
}

function cardJson(card, ctx, full) {
  const u = U();
  const col = ctx.cols[card.getString('column')];
  const board = ctx.board;
  const checklist = json(card, 'checklist', []);
  const columnAt = u.ms(card.getString('column_at')) || u.ms(card.getString('created'));
  const names = { people: ctx.people, agents: ctx.agents };
  const out = {
    id: card.id,
    key: board ? keyOf(board, card) : String(card.getInt('number')),
    number: card.getInt('number'),
    board: card.getString('board'),
    column: card.getString('column'),
    category: col ? col.getString('category') : 'todo',
    title: card.getString('title'),
    priority: card.getInt('priority'),
    labels: card
      .getStringSlice('labels')
      .map((id) => ctx.labels[id])
      .filter(Boolean)
      .map((l) => ({ id: l.id, name: l.getString('name'), color: l.getString('color') || 'gray' })),
    due: card.getString('due'),
    estimate: card.getFloat('estimate') || null,
    checklist: { done: checklist.filter((x) => x && x.done).length, total: checklist.length },
    position: card.getFloat('position'),
    assignee: partyOf(card.getString('assignee'), names),
    requester: personBrief(ctx.people[card.getString('requester')]),
    created_by: partyOf(card.getString('created_by'), names),
    proposed: card.getBool('proposed'),
    agent_state: card.getString('agent_state'),
    claimed_by: agentBrief(ctx.agents[card.getString('claimed_by')]),
    lease_until: card.getString('lease_until'),
    attempt: card.getInt('attempt'),
    progress: card.getString('progress'),
    attention: card.getString('attention'),
    question: (function () {
      const q = json(card, 'question', null);
      if (q && q.by) q.by_party = partyOf(q.by, names);
      return q;
    })(),
    review_state: card.getString('review_state'),
    blocked: card.getBool('blocked'),
    blocked_reason: card.getString('blocked_reason'),
    has_criteria: card.getString('acceptance').trim() !== '',
    plan: (function () {
      const p = json(card, 'plan', []);
      return { done: p.filter((x) => x && x.status === 'done').length, total: p.length };
    })(),
    column_at: card.getString('column_at'),
    age_days: Math.max(0, Math.floor((Date.now() - columnAt) / 86400000)),
    started_at: card.getString('started_at'),
    done_at: card.getString('done_at'),
    cost: card.getFloat('cost') || 0,
    version: card.getInt('version'),
    archived: card.getBool('archived'),
    created: card.getString('created'),
    updated: card.getString('updated'),
  };
  if (full) {
    out.description = card.getString('description');
    out.acceptance = card.getString('acceptance');
    out.checklist_items = checklist;
    out.plan_steps = json(card, 'plan', []);
    out.plan_ok = card.getBool('plan_ok');
    out.review = json(card, 'review', null);
    if (out.review && out.review.by) out.review.by_party = partyOf(out.review.by, names);
    out.feedback = card.getString('feedback');
    out.run = card.getString('run');
    out.handoffs = card.getInt('handoffs');
    out.work_column = card.getString('work_column');
    out.column_name = col ? col.getString('name') : '';
  }
  return out;
}

const PRI_NAMES = ['none', 'urgent', 'high', 'medium', 'low'];

/** Whether the caller is an agent's CLI (it gets lean answers unless it asks for full ones). */
function forAgent(e, p) {
  const auth = authOf(e);
  return auth !== null && auth.collection().name === '_superusers' && !U().bool(p || {}, 'full', false);
}

/**
 * A card as an agent reads it in lists: what it is, where it is, who has it
 * and where it stands; no ids, positions or bookkeeping. Empty fields are
 * left out.
 */
function cardBrief(card, ctx) {
  const col = ctx.cols[card.getString('column')];
  const names = { people: ctx.people, agents: ctx.agents };
  const out = {
    key: ctx.board ? keyOf(ctx.board, card) : String(card.getInt('number')),
    title: card.getString('title'),
    column: col ? col.getString('name') : '',
    category: col ? col.getString('category') : '',
    assignee: partyText(card.getString('assignee'), names),
    priority: PRI_NAMES[card.getInt('priority')] || 'none',
    version: card.getInt('version'),
  };
  const req = ctx.people[card.getString('requester')];
  if (req) out.requester = personName(req);
  const state = card.getBool('proposed') ? 'proposed' : card.getString('agent_state') || (card.getString('review_state') === 'pending' ? 'in_review' : '');
  if (state !== '') out.state = state;
  if (card.getString('agent_state') === 'working') {
    const on = ctx.agents[card.getString('claimed_by')];
    if (on) out.worked_by = on.getString('name');
    if (card.getString('progress') !== '') out.progress = card.getString('progress');
  }
  const q = json(card, 'question', null);
  if (card.getString('agent_state') === 'needs_input' && q) out.waiting_on_person = String(q.text || '').slice(0, 200);
  const labels = card.getStringSlice('labels').map((id) => ctx.labels[id]).filter(Boolean).map((l) => l.getString('name'));
  if (labels.length > 0) out.labels = labels;
  const due = card.getString('due');
  if (due !== '') out.due = due.slice(0, 10);
  if (card.getBool('blocked')) out.blocked = card.getString('blocked_reason') || true;
  const items = json(card, 'checklist', []);
  if (items.length > 0) out.checklist = items.filter((x) => x && x.done).length + '/' + items.length;
  if (card.getString('acceptance').trim() !== '') out.has_criteria = true;
  if (!CLOSED[out.category]) out.age_days = Math.max(0, Math.floor((Date.now() - (U().ms(card.getString('column_at')) || U().ms(card.getString('created')))) / 86400000));
  return out;
}

/** One card in full, as an agent reads it: the brief plus its text, checklist, plan, review and the last of its activity. */
function cardForAgent(app, card, ctx) {
  const out = cardBrief(card, ctx);
  const names = { people: ctx.people, agents: ctx.agents };
  out.description = card.getString('description');
  out.acceptance = card.getString('acceptance');
  const items = json(card, 'checklist', []);
  if (items.length > 0) out.checklist_items = items.map((x, i) => ({ n: i + 1, text: x.text, done: !!x.done }));
  const plan = json(card, 'plan', []);
  if (plan.length > 0) out.plan = plan;
  const review = json(card, 'review', null);
  if (review) out.review = { by: partyText(review.by, names), summary: review.summary, criteria: review.criteria, decision: card.getString('review_state') };
  if (card.getString('feedback') !== '') out.feedback = card.getString('feedback');
  if (card.getString('agent_state') === 'working') {
    out.run = card.getString('run');
    out.lease_until = card.getString('lease_until');
  }
  // Copy before reversing: reverse() on the Go slice a query returns mirrors it (goja).
  const evs = Array.from(app.findRecordsByFilter('events', 'card = {:c}', '-created', 25, 0, { c: card.id })).reverse();
  out.activity = evs.map((ev) => {
    const kind = ev.getString('kind');
    let text = ev.getString('text');
    if (kind === 'moved') {
      const a = U().getJson(ev, 'after') || {};
      text = 'to ' + (a.name || '?') + (text ? ' (' + text + ')' : '');
    } else if (kind === 'updated') text = 'changed the ' + ev.getString('field');
    return { at: ev.getString('created').slice(0, 16), who: partyText(ev.getString('actor'), names), kind: kind, text: String(text || '').slice(0, 400) };
  });
  return out;
}

function columnJson(col, count, names) {
  const n = names || { people: {}, agents: {} };
  return {
    id: col.id,
    board: col.getString('board'),
    name: col.getString('name'),
    category: col.getString('category'),
    position: col.getFloat('position'),
    wip: col.getInt('wip'),
    count: count === undefined ? null : count,
    policy: col.getString('policy'),
    instructions: col.getString('instructions'),
    agent_mode: col.getString('agent_mode') || 'off',
    agent: agentBrief(n.agents[col.getString('agent')]),
    plan_first: col.getBool('plan_first'),
    need_criteria: col.getBool('need_criteria'),
    need_checklist: col.getBool('need_checklist'),
    next: col.getString('next'),
    return_to: col.getString('return_to'),
    lease_minutes: col.getInt('lease_minutes') || 15,
    max_attempts: col.getInt('max_attempts') || 3,
    aging_days: col.getFloat('aging_days') || 0,
    collapsed: col.getBool('collapsed'),
  };
}

function boardJson(b, extra) {
  return Object.assign(
    {
      id: b.id,
      name: b.getString('name'),
      key: b.getString('key'),
      description: b.getString('description'),
      instructions: b.getString('instructions'),
      frozen: b.getBool('frozen'),
      archived: b.getBool('archived'),
      swimlanes: b.getString('swimlanes') || 'none',
      sort: b.getFloat('sort'),
      created: b.getString('created'),
      updated: b.getString('updated'),
    },
    extra || {},
  );
}

function eventJson(ev, names) {
  return {
    id: ev.id,
    board: ev.getString('board'),
    card: ev.getString('card'),
    actor_kind: ev.getString('actor_kind'),
    actor_id: ev.getString('actor'),
    actor: partyOf(ev.getString('actor'), names),
    kind: ev.getString('kind'),
    text: ev.getString('text'),
    field: ev.getString('field'),
    before: U().getJson(ev, 'before'),
    after: U().getJson(ev, 'after'),
    run: ev.getString('run'),
    meta: U().getJson(ev, 'meta') || {},
    reverted: ev.getBool('reverted'),
    created: ev.getString('created'),
  };
}

module.exports = {
  CATEGORIES: CATEGORIES,
  CAT_LABEL: CAT_LABEL,
  CLOSED: CLOSED,
  STARTED: STARTED,
  LABEL_COLORS: LABEL_COLORS,
  TONES: TONES,
  slug: slug,
  authOf: authOf,
  who: who,
  personName: personName,
  settings: settings,
  maxWorking: maxWorking,
  personOnly: personOnly,
  adminOnly: adminOnly,
  agentMayWrite: agentMayWrite,
  mustBoard: mustBoard,
  columnsOf: columnsOf,
  mustColumn: mustColumn,
  mustCard: mustCard,
  agentRef: agentRef,
  personRef: personRef,
  keyOf: keyOf,
  nextColumn: nextColumn,
  firstOf: firstOf,
  cardsIn: cardsIn,
  positionIn: positionIn,
  actorKey: actorKey,
  log: log,
  json: json,
  namesFor: namesFor,
  ctxFor: ctxFor,
  personBrief: personBrief,
  agentBrief: agentBrief,
  partyOf: partyOf,
  partyText: partyText,
  forAgent: forAgent,
  cardBrief: cardBrief,
  cardForAgent: cardForAgent,
  cardJson: cardJson,
  columnJson: columnJson,
  boardJson: boardJson,
  eventJson: eventJson,
};
