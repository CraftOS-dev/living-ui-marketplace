/// <reference path="../pb_data/types.d.ts" />
/**
 * The model shared by every operation: who is calling (you or the agent),
 * loading boards, columns and cards, card keys (OPS-12), positions, the
 * activity log, and the JSON shapes the UI and the agent read.
 *
 * Identity: the UI sends no agent header, so its calls are "you". The
 * agent-app CLI sends X-A2App-Agent, so its calls are the agent. One agent
 * works this board. Identity is declared by the caller, so these rules catch
 * mistakes, not malice.
 */

const CATEGORIES = ['triage', 'backlog', 'todo', 'doing', 'review', 'done', 'canceled'];
const CAT_LABEL = { triage: 'Proposed', backlog: 'Backlog', todo: 'To do', doing: 'In progress', review: 'Review', done: 'Done', canceled: 'Canceled' };
const CLOSED = { done: 1, canceled: 1 };
const STARTED = { doing: 1, review: 1 };
const LABEL_COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'];

function U() {
  return require(`${__hooks}/lib_util.js`);
}

/* ------------------------------------------------------------------ who */

const YOU = 'you';
const AGENT = { kind: 'agent', id: 'agent', name: 'Agent' };

/** Who is calling: {kind: 'you'} from the UI, the agent from the CLI. */
function who(app, e) {
  const header = e ? U().agentHeader(e) : '';
  if (header === '') return { kind: YOU, id: YOU, name: settingsName(app) };
  touch(app);
  return AGENT;
}

/** The agent was here: settings.agent_seen, written at most every 30 s. */
function touch(app) {
  const store = app.store();
  const last = Number(store.get('kb_agent_seen') || 0);
  const now = Date.now();
  store.set('kb_agent_seen', now);
  if (now - last < 30000) return;
  try {
    const s = settings(app);
    if (now - U().ms(s.getString('agent_seen')) < 30000) return;
    s.set('agent_seen', U().pbTime(now));
    app.saveNoValidate(s);
  } catch {
    /* bookkeeping only */
  }
}

function settings(app) {
  const rows = app.findRecordsByFilter('settings', "id != ''", 'created', 1, 0);
  if (rows.length > 0) return rows[0];
  const r = new Record(app.findCollectionByNameOrId('settings'));
  r.set('attention', { reviews: 'inbox', questions: 'interrupt', attention: 'interrupt', updates: 'digest' });
  r.set('defaults', { lease_minutes: 15, max_attempts: 3 });
  r.set('max_working', 2);
  app.save(r);
  return r;
}

function settingsName(app) {
  try {
    return settings(app).getString('name') || 'You';
  } catch {
    return 'You';
  }
}

/** Refuse a person-only action to an agent. */
function personOnly(w, what) {
  if (w.kind === 'agent') throw U().fail(403, what + ' is the person\'s decision. Hand the card back with work.return, ask with work.ask, or leave a comment.', { code: 'person_only' });
}

/** Refuse agent writes while the board is frozen or the agent is paused. */
function agentMayWrite(app, w, board) {
  if (w.kind !== 'agent') return;
  const u = U();
  if (board && board.getBool('frozen')) throw u.fail(423, 'The board "' + board.getString('name') + '" is frozen: the agent cannot change it until the person unfreezes it.', { code: 'board_frozen' });
  if (settings(app).getBool('paused')) throw u.fail(423, 'The person paused the agent. Stop and report what you were doing.', { code: 'agent_paused' });
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

/**
 * Append one event. who: {kind: you|agent|rule|system, id}. Never throws:
 * the activity log must not break the change it records.
 */
function log(app, ev) {
  try {
    const col = app.findCollectionByNameOrId('events');
    const r = new Record(col);
    const w = ev.actor || { kind: 'system', id: 'system' };
    if (ev.board) r.set('board', ev.board);
    if (ev.card) r.set('card', ev.card);
    r.set('actor', w.kind === 'you' || w.kind === 'agent' ? w.kind : w.id || w.kind);
    r.set('actor_kind', w.kind === 'agent' ? 'agent' : w.kind === 'rule' ? 'rule' : w.kind === 'system' ? 'system' : 'you');
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
    console.error('[kanban-board] activity log failed:', err);
    return null;
  }
}

/* ---------------------------------------------------------------- shapes */

function json(rec, field, dflt) {
  const v = U().getJson(rec, field);
  return v === null || v === undefined ? dflt : v;
}

/** Lookup tables for serializing many cards of one board at once. */
function ctxFor(app, boardId) {
  const cols = {};
  for (const c of columnsOf(app, boardId)) cols[c.id] = c;
  const labels = {};
  for (const l of app.findRecordsByFilter('labels', 'board = {:b}', 'name', 0, 0, { b: boardId })) labels[l.id] = l;
  return { cols: cols, labels: labels, board: U().byId(app, 'boards', boardId) };
}

/** '' (nobody), 'you' or 'agent'. */
function assigneeOf(card) {
  const v = card.getString('assignee');
  return v === 'you' || v === 'agent' ? v : '';
}

function cardJson(card, ctx, full) {
  const u = U();
  const col = ctx.cols[card.getString('column')];
  const board = ctx.board;
  const checklist = json(card, 'checklist', []);
  const columnAt = u.ms(card.getString('column_at')) || u.ms(card.getString('created'));
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
    assignee: assigneeOf(card),
    created_by: card.getString('created_by'),
    proposed: card.getBool('proposed'),
    agent_state: card.getString('agent_state'),
    lease_until: card.getString('lease_until'),
    attempt: card.getInt('attempt'),
    progress: card.getString('progress'),
    attention: card.getString('attention'),
    question: json(card, 'question', null),
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
    out.feedback = card.getString('feedback');
    out.run = card.getString('run');
    out.handoffs = card.getInt('handoffs');
    out.work_column = card.getString('work_column');
    out.column_name = col ? col.getString('name') : '';
  }
  return out;
}

const PRI_NAMES = ['none', 'urgent', 'high', 'medium', 'low'];

/** Whether the caller is the agent's CLI (it gets lean answers unless it asks for full ones). */
function forAgent(e, p) {
  const u = U();
  return !!e && u.agentHeader(e) !== '' && !u.bool(p || {}, 'full', false);
}

/**
 * A card as the agent reads it in lists: what it is, where it is, who has
 * it and where it stands; no ids, positions or bookkeeping. Empty fields are
 * left out.
 */
function cardBrief(card, ctx) {
  const col = ctx.cols[card.getString('column')];
  const out = {
    key: ctx.board ? keyOf(ctx.board, card) : String(card.getInt('number')),
    title: card.getString('title'),
    column: col ? col.getString('name') : '',
    category: col ? col.getString('category') : '',
    assignee: card.getString('assignee') || 'nobody',
    priority: PRI_NAMES[card.getInt('priority')] || 'none',
    version: card.getInt('version'),
  };
  const state = card.getBool('proposed') ? 'proposed' : card.getString('agent_state') || (card.getString('review_state') === 'pending' ? 'in_review' : '');
  if (state !== '') out.state = state;
  if (card.getString('agent_state') === 'working' && card.getString('progress') !== '') out.progress = card.getString('progress');
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

/** One card in full, as the agent reads it: the brief plus its text, checklist, plan, review and the last of its activity. */
function cardForAgent(app, card, ctx) {
  const out = cardBrief(card, ctx);
  out.description = card.getString('description');
  out.acceptance = card.getString('acceptance');
  const items = json(card, 'checklist', []);
  if (items.length > 0) out.checklist_items = items.map((x, i) => ({ n: i + 1, text: x.text, done: !!x.done }));
  const plan = json(card, 'plan', []);
  if (plan.length > 0) out.plan = plan;
  const review = json(card, 'review', null);
  if (review) out.review = { by: review.by, summary: review.summary, criteria: review.criteria, decision: card.getString('review_state') };
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
    return { at: ev.getString('created').slice(0, 16), who: ev.getString('actor_kind') === 'you' ? 'person' : ev.getString('actor_kind'), kind: kind, text: String(text || '').slice(0, 400) };
  });
  return out;
}

function columnJson(col, count) {
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
    agent: col.getBool('agent'),
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

function eventJson(ev) {
  return {
    id: ev.id,
    board: ev.getString('board'),
    card: ev.getString('card'),
    actor_kind: ev.getString('actor_kind'),
    actor_id: ev.getString('actor'),
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
  AGENT: AGENT,
  who: who,
  settings: settings,
  personOnly: personOnly,
  agentMayWrite: agentMayWrite,
  mustBoard: mustBoard,
  columnsOf: columnsOf,
  mustColumn: mustColumn,
  mustCard: mustCard,
  keyOf: keyOf,
  nextColumn: nextColumn,
  firstOf: firstOf,
  cardsIn: cardsIn,
  positionIn: positionIn,
  log: log,
  json: json,
  ctxFor: ctxFor,
  forAgent: forAgent,
  cardBrief: cardBrief,
  cardForAgent: cardForAgent,
  cardJson: cardJson,
  columnJson: columnJson,
  boardJson: boardJson,
  eventJson: eventJson,
};
