/// <reference path="../pb_data/types.d.ts" />
/**
 * Cards: the work on a board, and the rules every change follows.
 *
 *   - Columns are contracts. Entering a column the agent works hands the
 *     card to the agent and queues it (edge-triggered: only a move INTO the
 *     column queues, re-saving never does). A card assigned to the agent is
 *     worked in to-do and started columns; a card assigned to you elsewhere
 *     is never taken.
 *   - The agent may move cards into started and review columns only; Done
 *     and Canceled are the person's. WIP limits bind the agent (refused) and
 *     warn the person. A column's checklist gate holds the agent back until
 *     every item is ticked.
 *   - Review: approve moves the card on, request changes sends it back to
 *     the agent with your reason, reject hands it back to you. The agent
 *     never decides a review.
 *   - Every change is an event (who, what, before, after) that can be
 *     reverted, and bumps the card's version: a write carrying an older
 *     version is refused so the agent re-reads instead of overwriting.
 */

function U() {
  return require(`${__hooks}/lib_util.js`);
}
function M() {
  return require(`${__hooks}/lib_model.js`);
}

const PRIORITY_NAMES = { none: 0, urgent: 1, high: 2, medium: 3, low: 4 };
const PRIORITY_LABEL = ['No priority', 'Urgent', 'High', 'Medium', 'Low'];
const PROPOSALS_PER_DAY = 20;

/* --------------------------------------------------------------- helpers */

function priorityOf(p, name) {
  const u = U();
  const v = u.str(p, name, '');
  if (v === '') return null;
  const low = v.toLowerCase();
  if (PRIORITY_NAMES[low] !== undefined) return PRIORITY_NAMES[low];
  const n = Number(v);
  if (Number.isInteger(n) && n >= 0 && n <= 4) return n;
  throw u.fail(400, name + ' must be urgent, high, medium, low or none (or 0-4)');
}

function checkVersion(p, card) {
  const u = U();
  const v = u.int(p, 'version', null, 0, 1e9);
  if (v !== null && v !== card.getInt('version')) {
    throw u.fail(409, 'The card changed since you read it (version ' + v + ', now ' + card.getInt('version') + '). Read it again with cards.get and redo your change on the current text.', { code: 'version_conflict', version: card.getInt('version') });
  }
}

/** The agent may change a started card only while it works on it, and never a finished one. */
function agentEditGuard(app, w, card) {
  if (w.kind !== 'agent') return;
  const u = U();
  const col = u.byId(app, 'columns', card.getString('column'));
  const cat = col ? col.getString('category') : '';
  if (M().STARTED[cat] && card.getString('agent_state') !== 'working') throw u.fail(409, 'This card is in a started column: claim it first with work.next (or comment on it).', { code: 'claim_required' });
  if (M().CLOSED[cat]) throw u.fail(403, 'This card is finished; the person reopens it if more work is needed.', { code: 'human_only' });
}

/** The run to stamp on an event: the agent's current run on a card it works. */
function runOf(w, card) {
  return w.kind === 'agent' && card.getString('agent_state') === 'working' ? card.getString('run') : '';
}

/** End the agent session on a card (lease, run, progress). */
function endSession(app, card, outcome, note) {
  const u = U();
  const run = card.getString('run');
  if (run !== '') {
    const r = u.byId(app, 'runs', run);
    if (r !== null && r.getString('outcome') === 'working') {
      r.set('outcome', outcome);
      r.set('ended', u.pbTime());
      if (note) r.set('note', String(note).slice(0, 2000));
      app.save(r);
    }
  }
  card.set('lease_until', '');
  card.set('run', '');
  card.set('progress', '');
}

function markWork(app) {
  try {
    require(`${__hooks}/lib_work.js`).markDirty(app);
  } catch (err) {
    console.error('[kanban-board] work mark failed:', err);
  }
}

function fireWork(app) {
  try {
    require(`${__hooks}/lib_work.js`).fireIfNeeded(app);
  } catch (err) {
    console.error('[kanban-board] work fire failed:', err);
  }
}

/**
 * A card entered a column: decide whether the agent should take it. Returns
 * true when the card is now queued for the agent.
 */
function queueOnEntry(app, card, col) {
  const cat = col.getString('category');
  // A gate of the column it left (acceptance criteria) no longer applies.
  const gate = M().json(card, 'question', null);
  if (card.getString('agent_state') === 'needs_input' && gate && gate.kind === 'criteria') {
    card.set('agent_state', '');
    card.set('question', null);
  }
  if (M().CLOSED[cat]) {
    card.set('agent_state', '');
    card.set('question', null);
    return false;
  }
  if (cat === 'review') {
    card.set('agent_state', '');
    return false;
  }
  // Moving a card into a column the agent works is the handoff.
  if (col.getBool('agent')) {
    card.set('assignee', 'agent');
    return queueCard(app, card, col);
  }
  const assignee = card.getString('assignee');
  if (assignee === 'agent' && (cat === 'todo' || cat === 'doing')) return queueCard(app, card, col);
  if (card.getString('agent_state') === 'queued' || (assignee === 'you' && card.getString('agent_state') !== 'needs_attention')) card.set('agent_state', '');
  return false;
}

/** Queue a card for the agent, unless a gate makes it wait on the person first. */
function queueCard(app, card, col) {
  card.set('attention', '');
  if (col && col.getBool('need_criteria') && card.getString('acceptance').trim() === '') {
    card.set('agent_state', 'needs_input');
    card.set('question', { kind: 'criteria', text: 'Add acceptance criteria so the agent can start: what does done look like?', by: 'system', at: U().pbTime() });
    return false;
  }
  card.set('agent_state', 'queued');
  card.set('question', null);
  markWork(app);
  return true;
}

/** Apply a set of field changes and log one event per field. */
function changeFields(app, w, card, changes, opts) {
  const o = opts || {};
  const diffs = [];
  for (const k of Object.keys(changes)) {
    const before = fieldValue(card, k);
    const after = changes[k];
    if (U().canonical(before) === U().canonical(after)) continue;
    card.set(k, after);
    diffs.push({ field: k, before: before, after: after });
  }
  return diffs.map((d) => Object.assign(d, { run: o.run || '' }));
}

function fieldValue(card, k) {
  if (k === 'labels') return card.getStringSlice('labels');
  if (k === 'checklist' || k === 'plan' || k === 'question' || k === 'review') return M().json(card, k, null);
  if (k === 'priority' || k === 'number' || k === 'version' || k === 'attempt') return card.getInt(k);
  if (k === 'estimate' || k === 'cost' || k === 'position') return card.getFloat(k);
  if (k === 'blocked' || k === 'archived' || k === 'proposed' || k === 'plan_ok') return card.getBool(k);
  return card.getString(k);
}

function bump(card) {
  card.set('version', card.getInt('version') + 1);
}

/* ------------------------------------------------------------------ move */

/**
 * Move a card (or re-place it in its column). The one place column entry
 * effects happen: started/done stamps, sessions ending, review decisions by
 * drag, queueing for the agent, then the board's rules.
 */
function place(app, w, card, toCol, opts) {
  const u = U();
  const m = M();
  const o = opts || {};
  const fromId = card.getString('column');
  const fromCol = u.byId(app, 'columns', fromId);
  const fromCat = fromCol ? fromCol.getString('category') : '';
  const toCat = toCol.getString('category');
  const same = fromId === toCol.id;
  const warnings = [];
  if (!same) {
    const forward = fromCol ? toCol.getFloat('position') > fromCol.getFloat('position') : true;
    const wip = toCol.getInt('wip');
    const count = wip > 0 ? m.cardsIn(app, toCol.id).filter((c) => c.id !== card.id).length : 0;
    const items = m.json(card, 'checklist', []);
    const open = items.filter((x) => x && !x.done).length;
    if (w.kind === 'agent') {
      if (m.CLOSED[toCat]) throw u.fail(403, 'Only the person moves cards to ' + toCol.getString('name') + '. Finish with work.submit: the person reviews and approves.', { code: 'human_only' });
      if (wip > 0 && count >= wip) throw u.fail(409, toCol.getString('name') + ' is at its WIP limit (' + count + '/' + wip + '). Finish or hand back work there first; do not start more.', { code: 'wip_full' });
      if (forward && fromCol && fromCol.getBool('need_checklist') && open > 0) throw u.fail(409, 'Tick every checklist item before this card leaves ' + fromCol.getString('name') + ' (' + open + ' open).', { code: 'checklist_open' });
    } else {
      if (wip > 0 && count >= wip) warnings.push(toCol.getString('name') + ' is over its WIP limit (' + (count + 1) + '/' + wip + ')');
      if (forward && fromCol && fromCol.getBool('need_checklist') && open > 0) warnings.push(open + ' checklist ' + (open === 1 ? 'item is' : 'items are') + ' still open');
    }
  }
  card.set('column', toCol.id);
  card.set('position', m.positionIn(app, toCol.id, o.where === undefined ? (same ? 'bottom' : 'top') : o.where, card.id));
  let queued = false;
  if (!same) {
    const now = u.pbTime();
    card.set('column_at', now);
    if ((toCat === 'doing' || toCat === 'review') && card.getString('started_at') === '') card.set('started_at', now);
    if (toCat === 'done' || toCat === 'canceled') {
      card.set('done_at', now);
      card.set('done_kind', toCat === 'canceled' ? 'canceled' : card.getString('assignee') === 'agent' || card.getString('done_kind') === 'agent' ? 'agent' : 'you');
    } else if (fromCat === 'done' || fromCat === 'canceled') {
      card.set('done_at', '');
      card.set('done_kind', '');
    }
    if (toCat === 'doing' && (fromCat === 'todo' || fromCat === 'backlog' || fromCat === 'triage')) card.set('work_column', toCol.id);
    if (toCat === 'doing' && card.getString('work_column') === '') card.set('work_column', toCol.id);
    // A person moving a card the agent is working on stops that work.
    if (card.getString('agent_state') === 'working' && w.kind !== 'agent' && !o.keepSession) {
      endSession(app, card, 'stopped', 'Moved by ' + (w.kind === 'rule' ? 'a rule' : 'the person'));
      card.set('agent_state', '');
    }
    // Reviews decided by dragging.
    if (card.getString('review_state') === 'pending' && w.kind === 'you' && !o.keepReview) {
      if (toCat === 'done') decide(app, card, 'approved', 'Approved by moving it to ' + toCol.getString('name'));
      else if (fromCol && toCol.getFloat('position') < fromCol.getFloat('position')) card.set('review_state', '');
    }
    if (!o.noQueue) queued = queueOnEntry(app, card, toCol);
  }
  bump(card);
  app.save(card);
  if (!same && !o.quiet) {
    m.log(app, {
      board: card.getString('board'),
      card: card.id,
      actor: w,
      kind: 'moved',
      field: 'column',
      before: { id: fromId, name: fromCol ? fromCol.getString('name') : '' },
      after: { id: toCol.id, name: toCol.getString('name') },
      run: o.run || '',
      text: o.reason || '',
    });
  }
  if (!same && !o.fromRule) {
    try {
      require(`${__hooks}/lib_auto.js`).run(app, 'enters_column', card.id, { column: toCol.id });
    } catch (err) {
      console.error('[kanban-board] rules failed:', err);
    }
  }
  if (queued) fireWork(app);
  return { warnings: warnings, queued: queued };
}

/** Record a review decision on the run that produced the work. */
function decide(app, card, decision, note) {
  const u = U();
  const review = M().json(card, 'review', null);
  card.set('review_state', decision === 'approved' ? 'approved' : decision === 'changes' ? 'changes' : 'rejected');
  if (review && review.run) {
    const r = u.byId(app, 'runs', review.run);
    if (r !== null && r.getString('decision') === '') {
      r.set('decision', decision);
      r.set('decided', u.pbTime());
      app.save(r);
    }
  }
  void note;
}

/* ------------------------------------------------------------- reading */

function list(app, p, e) {
  const u = U();
  const m = M();
  const filters = ['id != ""'];
  const bind = {};
  let board = null;
  if (u.has(p, 'board')) {
    board = m.mustBoard(app, u.str(p, 'board', ''));
    filters.push('board = {:b}');
    bind.b = board.id;
  }
  if (u.has(p, 'column')) {
    const col = m.mustColumn(app, u.str(p, 'column', ''), board ? board.id : null);
    filters.push('column = {:c}');
    bind.c = col.id;
  }
  filters.push(u.bool(p, 'archived', false) ? 'archived = true' : 'archived = false');
  const state = u.oneOf(p, 'state', ['queued', 'working', 'needs_input', 'needs_attention', 'idle'], '');
  if (state === 'idle') filters.push("agent_state = ''");
  else if (state !== '') {
    filters.push('agent_state = {:s}');
    bind.s = state;
  }
  if (u.bool(p, 'review', false)) filters.push("review_state = 'pending'");
  const who = u.oneOf(p, 'assignee', ['you', 'agent', 'none'], '');
  if (who !== '') {
    filters.push('assignee = {:a}');
    bind.a = who === 'none' ? '' : who;
  }
  const q = u.str(p, 'q', '');
  if (q !== '') {
    filters.push('(title ~ {:q} || description ~ {:q})');
    bind.q = q;
  }
  const limit = u.int(p, 'limit', 300, 1, 2000);
  const rows = app.findRecordsByFilter('cards', filters.join(' && '), 'board,position', limit, 0, bind);
  const ctxs = {};
  const out = [];
  for (const c of rows) {
    const b = c.getString('board');
    if (!ctxs[b]) ctxs[b] = m.ctxFor(app, b);
    if (u.has(p, 'label')) {
      const want = u.str(p, 'label', '').toLowerCase();
      const names = c.getStringSlice('labels').map((id) => (ctxs[b].labels[id] ? ctxs[b].labels[id].getString('name').toLowerCase() : ''));
      if (names.indexOf(want) < 0 && c.getStringSlice('labels').indexOf(u.str(p, 'label', '')) < 0) continue;
    }
    out.push(m.forAgent(e, p) ? m.cardBrief(c, ctxs[b]) : m.cardJson(c, ctxs[b], u.bool(p, 'full', false)));
  }
  return { cards: out, count: out.length };
}

function get(app, p, e) {
  const u = U();
  const m = M();
  const card = m.mustCard(app, u.req(p, 'card', 'OPS-12'));
  const ctx = m.ctxFor(app, card.getString('board'));
  if (m.forAgent(e, p)) {
    const cols = m.columnsOf(app, card.getString('board'));
    return {
      card: m.cardForAgent(app, card, ctx),
      board: { key: ctx.board.getString('key'), name: ctx.board.getString('name'), how_we_work: ctx.board.getString('instructions') },
      columns: cols.map((c) => c.getString('name')),
      note: 'A lean view for the agent; add --full true for every field.',
    };
  }
  const col = ctx.cols[card.getString('column')];
  const events = app.findRecordsByFilter('events', 'card = {:c}', 'created', 400, 0, { c: card.id });
  const runs = app.findRecordsByFilter('runs', 'card = {:c}', '-started', 50, 0, { c: card.id });
  return {
    card: m.cardJson(card, ctx, true),
    board: m.boardJson(ctx.board),
    column: m.columnJson(col),
    events: events.map((e) => m.eventJson(e)),
    runs: runs.map((r) => runJson(r)),
    columns: m.columnsOf(app, card.getString('board')).map((c) => ({ id: c.id, name: c.getString('name'), category: c.getString('category'), agent: c.getBool('agent') })),
    labels: Object.values(ctx.labels).map((l) => ({ id: l.id, name: l.getString('name'), color: l.getString('color') || 'gray' })),
  };
}

function runJson(r) {
  return {
    id: r.id,
    card: r.getString('card'),
    column: r.getString('column'),
    attempt: r.getInt('attempt'),
    started: r.getString('started'),
    ended: r.getString('ended'),
    outcome: r.getString('outcome'),
    note: r.getString('note'),
    cost: r.getFloat('cost') || 0,
    decision: r.getString('decision'),
    decided: r.getString('decided'),
  };
}

/* ------------------------------------------------------------- writing */

function labelIds(app, p, boardId) {
  const u = U();
  const raw = u.has(p, 'labels') ? u.json(p, 'labels') : undefined;
  if (raw === undefined) return null;
  let names = raw;
  if (typeof raw === 'string') names = raw.split(',');
  if (!Array.isArray(names)) throw u.fail(400, 'labels must be a list of label names or ids, e.g. labels=\'["Bug"]\'');
  const all = app.findRecordsByFilter('labels', 'board = {:b}', '', 0, 0, { b: boardId });
  const out = [];
  for (const n of names) {
    const s = String(n).trim();
    if (s === '') continue;
    const l = all.find((x) => x.id === s || x.getString('name').toLowerCase() === s.toLowerCase());
    if (!l) throw u.fail(400, 'No label "' + s + '" on this board. Labels: ' + (all.map((x) => x.getString('name')).join(', ') || 'none') + ' (labels.save adds one).');
    if (out.indexOf(l.id) < 0) out.push(l.id);
  }
  return out;
}

function checklistOf(p) {
  const u = U();
  const raw = u.json(p, 'checklist');
  if (raw === undefined) return null;
  let items = raw;
  if (typeof raw === 'string') items = raw.split('\n');
  if (!Array.isArray(items)) throw u.fail(400, 'checklist must be a list of items, e.g. checklist=\'["Draft","Check links"]\'');
  return items
    .map((it) => (typeof it === 'string' ? { id: u.newId(), text: it.trim(), done: false } : { id: String(it.id || u.newId()), text: String(it.text || '').trim(), done: !!it.done }))
    .filter((it) => it.text !== '')
    .slice(0, 200);
}

/** '' (nobody), 'you' or 'agent'. */
function assigneeValue(ref) {
  const r = String(ref || '').trim().toLowerCase();
  if (r === '' || r === 'none' || r === 'nobody') return '';
  if (r === 'you' || r === 'me') return 'you';
  if (r === 'agent') return 'agent';
  throw U().fail(400, 'assignee must be you, agent or none');
}

function add(app, e, p) {
  const u = U();
  const m = M();
  const w = m.who(app, e, p);
  const board = m.mustBoard(app, u.req(p, 'board', 'OPS'));
  m.agentMayWrite(app, w, board);
  const cols = m.columnsOf(app, board.id);
  if (cols.length === 0) throw u.fail(409, 'This board has no columns yet');
  let col = null;
  if (u.has(p, 'column')) col = m.mustColumn(app, u.str(p, 'column', ''), board.id);
  if (w.kind === 'agent') {
    // What the agent creates is a proposal: it lands in Proposed (or the first column) until the person accepts it.
    const today = u.pbTime(Date.now() - 86400000);
    const made = app.findRecordsByFilter('cards', "created_by = 'agent' && created >= {:t}", '', 0, 0, { t: today }).length;
    if (made >= PROPOSALS_PER_DAY) throw u.fail(429, 'You proposed ' + made + ' cards in the last day (the limit is ' + PROPOSALS_PER_DAY + '). Wait for the person to go through them.', { code: 'proposal_cap' });
    col = m.firstOf(cols, ['triage']) || m.firstOf(cols, ['backlog', 'todo']) || cols[0];
  }
  if (col === null) col = m.firstOf(cols, ['todo', 'backlog']) || cols[0];
  if (w.kind !== 'agent' && m.CLOSED[col.getString('category')]) {
    /* allowed: logging finished work */
  }
  const title = u.squash(u.req(p, 'title', '"Write the release notes"'));
  const pri = priorityOf(p, 'priority');
  const lbl = labelIds(app, p, board.id);
  const check = checklistOf(p);
  // Yours unless you say otherwise (or the column is the agent's); the agent's proposals are nobody's yet.
  let assignee = u.has(p, 'assignee') ? assigneeValue(u.str(p, 'assignee', '')) : w.kind === 'agent' ? '' : col.getBool('agent') ? 'agent' : 'you';
  if (w.kind === 'agent') assignee = '';
  const due = u.str(p, 'due', '');
  if (due !== '' && !isFinite(Date.parse(due))) throw u.fail(400, 'due must be a date like 2026-11-15');
  let card = null;
  app.runInTransaction((tx) => {
    const b = tx.findRecordById('boards', board.id);
    const n = b.getInt('seq') + 1;
    b.set('seq', n);
    tx.save(b);
    const c = new Record(tx.findCollectionByNameOrId('cards'));
    c.set('board', board.id);
    c.set('column', col.id);
    c.set('number', n);
    c.set('title', title.slice(0, 300));
    c.set('description', u.str(p, 'description', ''));
    c.set('acceptance', u.str(p, 'acceptance', ''));
    c.set('priority', pri === null ? 0 : pri);
    if (lbl !== null) c.set('labels', lbl);
    if (due !== '') c.set('due', new Date(Date.parse(due)).toISOString().replace('T', ' '));
    c.set('estimate', u.number(p, 'estimate', { min: 0, max: 1000 }) || 0);
    c.set('checklist', check || []);
    c.set('assignee', assignee);
    c.set('created_by', w.kind === 'agent' ? 'agent' : 'you');
    c.set('proposed', w.kind === 'agent');
    c.set('position', m.positionIn(tx, col.id, u.oneOf(p, 'position', ['top', 'bottom'], 'top')));
    c.set('version', 1);
    c.set('column_at', u.pbTime());
    const cat = col.getString('category');
    if (cat === 'doing' || cat === 'review') c.set('started_at', u.pbTime());
    if (cat === 'done') {
      c.set('done_at', u.pbTime());
      c.set('done_kind', 'you');
    }
    tx.save(c);
    card = c;
  });
  card = app.findRecordById('cards', card.id);
  let queued = false;
  if (w.kind !== 'agent') {
    queued = queueOnEntry(app, card, col);
    app.save(card);
  }
  m.log(app, { board: board.id, card: card.id, actor: w, kind: w.kind === 'agent' ? 'proposed' : 'created', text: title, meta: { column: col.getString('name'), reason: u.str(p, 'reason', '') } });
  try {
    const A = require(`${__hooks}/lib_auto.js`);
    A.run(app, 'created', card.id, {});
    A.run(app, 'enters_column', card.id, { column: col.id });
  } catch (err) {
    console.error('[kanban-board] rules failed:', err);
  }
  if (queued) fireWork(app);
  const fresh = app.findRecordById('cards', card.id);
  const shaped = m.forAgent(e, p) ? m.cardBrief(fresh, m.ctxFor(app, board.id)) : m.cardJson(fresh, m.ctxFor(app, board.id), true);
  return { ok: true, card: shaped, proposed: w.kind === 'agent', message: w.kind === 'agent' ? 'Proposed: the card waits in ' + col.getString('name') + ' until the person accepts it.' : undefined };
}

function update(app, e, p) {
  const u = U();
  const m = M();
  const w = m.who(app, e, p);
  const card = m.mustCard(app, u.req(p, 'card', 'OPS-12'));
  const board = u.byId(app, 'boards', card.getString('board'));
  m.agentMayWrite(app, w, board);
  agentEditGuard(app, w, card);
  checkVersion(p, card);
  const changes = {};
  if (u.has(p, 'title')) {
    const t = u.squash(u.str(p, 'title', ''));
    if (t === '') throw u.fail(400, 'title cannot be empty');
    changes.title = t.slice(0, 300);
  }
  if (u.has(p, 'description')) changes.description = u.str(p, 'description', '');
  if (u.has(p, 'acceptance')) changes.acceptance = u.str(p, 'acceptance', '');
  if (u.has(p, 'priority')) changes.priority = priorityOf(p, 'priority') || 0;
  if (u.has(p, 'labels')) changes.labels = labelIds(app, p, board.id) || [];
  if (u.has(p, 'due')) {
    const d = u.str(p, 'due', '');
    if (d !== '' && !isFinite(Date.parse(d))) throw u.fail(400, 'due must be a date like 2026-11-15 (or empty to clear it)');
    changes.due = d === '' ? '' : new Date(Date.parse(d)).toISOString().replace('T', ' ');
  }
  if (u.has(p, 'estimate')) changes.estimate = u.number(p, 'estimate', { min: 0, max: 1000 }) || 0;
  if (u.has(p, 'checklist')) changes.checklist = checklistOf(p) || [];
  if (Object.keys(changes).length === 0) throw u.fail(400, 'Nothing to change: give title, description, acceptance, priority, labels, due, estimate or checklist');
  const before = m.json(card, 'checklist', []);
  const diffs = changeFields(app, w, card, changes, { run: runOf(w, card) });
  if (diffs.length === 0) return { ok: true, unchanged: true, card: m.forAgent(e, p) ? m.cardBrief(card, m.ctxFor(app, board.id)) : m.cardJson(card, m.ctxFor(app, board.id), true) };
  // Criteria added while the card waited for them: the agent can start now.
  const q = m.json(card, 'question', null);
  let requeue = false;
  if (changes.acceptance !== undefined && card.getString('agent_state') === 'needs_input' && q && q.kind === 'criteria' && card.getString('acceptance').trim() !== '') {
    card.set('agent_state', 'queued');
    card.set('question', null);
    requeue = true;
  }
  bump(card);
  app.save(card);
  for (const d of diffs) m.log(app, { board: board.id, card: card.id, actor: w, kind: 'updated', field: d.field, before: d.before, after: d.after, run: d.run });
  const after = m.json(card, 'checklist', []);
  if (changes.checklist && after.length > 0 && after.every((x) => x.done) && !(before.length === after.length && before.every((x) => x.done))) {
    try {
      require(`${__hooks}/lib_auto.js`).run(app, 'checklist_done', card.id, {});
    } catch (err) {
      console.error('[kanban-board] rules failed:', err);
    }
  }
  if (requeue) {
    markWork(app);
    fireWork(app);
  }
  const fresh = app.findRecordById('cards', card.id);
  return { ok: true, card: m.forAgent(e, p) ? m.cardBrief(fresh, m.ctxFor(app, board.id)) : m.cardJson(fresh, m.ctxFor(app, board.id), true) };
}

function move(app, e, p) {
  const u = U();
  const m = M();
  const w = m.who(app, e, p);
  const card = m.mustCard(app, u.req(p, 'card', 'OPS-12'));
  const board = u.byId(app, 'boards', card.getString('board'));
  m.agentMayWrite(app, w, board);
  agentEditGuard(app, w, card);
  checkVersion(p, card);
  if (card.getBool('archived')) throw u.fail(409, 'This card is archived; restore it first');
  const col = m.mustColumn(app, u.req(p, 'column', '"In progress"'), board.id);
  let where = u.has(p, 'index') ? u.int(p, 'index', 0, 0, 100000) : u.oneOf(p, 'position', ['top', 'bottom'], undefined);
  if (u.has(p, 'before') || u.has(p, 'after')) {
    const ref = m.mustCard(app, u.str(p, u.has(p, 'before') ? 'before' : 'after', ''));
    const list = m.cardsIn(app, col.id).filter((c) => c.id !== card.id);
    const i = list.findIndex((c) => c.id === ref.id);
    if (i >= 0) where = u.has(p, 'before') ? i : i + 1;
  }
  // The agent moving a card it works on keeps working on it (no new queueing).
  const holding = w.kind === 'agent' && card.getString('agent_state') === 'working';
  const res = place(app, w, card, col, { where: where, keepSession: holding, noQueue: holding, reason: u.str(p, 'reason', ''), run: holding ? card.getString('run') : '' });
  const fresh = app.findRecordById('cards', card.id);
  return { ok: true, warnings: res.warnings, queued: res.queued, card: m.forAgent(e, p) ? m.cardBrief(fresh, m.ctxFor(app, board.id)) : m.cardJson(fresh, m.ctxFor(app, board.id), true) };
}

/** Delegate a card: to you, to the agent, or to nobody. */
function assign(app, e, p) {
  const u = U();
  const m = M();
  const w = m.who(app, e, p);
  m.personOnly(w, 'Assigning cards');
  const card = m.mustCard(app, u.req(p, 'card', 'OPS-12'));
  const value = assigneeValue(u.str(p, 'assignee', ''));
  return { ok: true, card: setAssignee(app, w, card, value, u.str(p, 'note', '')) };
}

function setAssignee(app, w, card, value, note) {
  const u = U();
  const m = M();
  const before = card.getString('assignee');
  const col = u.byId(app, 'columns', card.getString('column'));
  const cat = col ? col.getString('category') : 'todo';
  if (card.getString('agent_state') === 'working' && value !== 'agent') {
    endSession(app, card, 'stopped', 'Reassigned by the person');
    card.set('agent_state', '');
  }
  card.set('assignee', value);
  card.set('attention', '');
  card.set('attempt', 0);
  card.set('handoffs', 0);
  let queued = false;
  if (value === 'agent' && card.getString('agent_state') !== 'working' && !m.CLOSED[cat] && cat !== 'review' && !card.getBool('proposed')) {
    card.set('plan_ok', false);
    queued = queueCard(app, card, col);
  } else if (value !== 'agent') {
    if (card.getString('agent_state') !== 'working') card.set('agent_state', '');
    card.set('question', null);
  }
  bump(card);
  app.save(card);
  const names = (v) => (v === 'you' ? 'you' : v === 'agent' ? 'the agent' : 'nobody');
  m.log(app, { board: card.getString('board'), card: card.id, actor: w, kind: 'assigned', field: 'assignee', before: before, after: value, text: note || 'Assigned to ' + names(value) });
  if (queued) fireWork(app);
  return m.cardJson(app.findRecordById('cards', card.id), m.ctxFor(app, card.getString('board')), true);
}

function comment(app, e, p) {
  const u = U();
  const m = M();
  const w = m.who(app, e, p);
  const card = m.mustCard(app, u.req(p, 'card', 'OPS-12'));
  const board = u.byId(app, 'boards', card.getString('board'));
  m.agentMayWrite(app, w, board);
  const text = u.req(p, 'text', '"Looks good; one question about the scope"').slice(0, 20000);
  const ev = m.log(app, { board: board.id, card: card.id, actor: w, kind: 'comment', text: text, run: runOf(w, card) });
  // The person's comment while the agent is working reaches it on its next heartbeat or claim.
  if (w.kind === 'you' && (card.getString('agent_state') === 'working' || card.getString('agent_state') === 'queued')) {
    card.set('feedback', ('Comment from the person: ' + text).slice(0, 4000));
    bump(card);
    app.save(card);
  }
  return { ok: true, event: ev ? ev.id : '' };
}

/** Tick, untick, add or remove one checklist item. */
function check(app, e, p) {
  const u = U();
  const m = M();
  const w = m.who(app, e, p);
  const card = m.mustCard(app, u.req(p, 'card', 'OPS-12'));
  const board = u.byId(app, 'boards', card.getString('board'));
  m.agentMayWrite(app, w, board);
  agentEditGuard(app, w, card);
  const items = m.json(card, 'checklist', []);
  const before = JSON.parse(JSON.stringify(items));
  const add = u.str(p, 'add', '');
  if (add !== '') items.push({ id: u.newId(), text: add.slice(0, 500), done: false });
  else {
    const ref = u.req(p, 'item', '<item id, number (1 = first) or text>');
    let i = items.findIndex((x) => x.id === ref);
    if (i < 0 && /^\d+$/.test(ref)) i = Number(ref) - 1;
    if (i < 0) i = items.findIndex((x) => String(x.text).toLowerCase() === ref.toLowerCase());
    if (i < 0 || i >= items.length) throw u.fail(404, 'No checklist item "' + ref + '" on this card');
    if (u.bool(p, 'remove', false)) {
      if (w.kind === 'agent') throw u.fail(403, 'The agent ticks items; removing them is the person\'s call', { code: 'person_only' });
      items.splice(i, 1);
    } else if (u.has(p, 'text')) items[i].text = u.req(p, 'text', '"New wording"').slice(0, 500);
    else items[i].done = u.bool(p, 'done', !items[i].done);
  }
  card.set('checklist', items);
  bump(card);
  app.save(card);
  m.log(app, { board: board.id, card: card.id, actor: w, kind: 'updated', field: 'checklist', before: before, after: items, run: runOf(w, card) });
  if (items.length > 0 && items.every((x) => x.done) && !(before.length > 0 && before.every((x) => x.done))) {
    try {
      require(`${__hooks}/lib_auto.js`).run(app, 'checklist_done', card.id, {});
    } catch (err) {
      console.error('[kanban-board] rules failed:', err);
    }
  }
  return { ok: true, checklist: items };
}

function block(app, e, p, on) {
  const u = U();
  const m = M();
  const w = m.who(app, e, p);
  const card = m.mustCard(app, u.req(p, 'card', 'OPS-12'));
  const board = u.byId(app, 'boards', card.getString('board'));
  m.agentMayWrite(app, w, board);
  const reason = on ? u.req(p, 'reason', '"Waiting for the logo files"') : '';
  card.set('blocked', on);
  card.set('blocked_reason', reason.slice(0, 600));
  bump(card);
  app.save(card);
  m.log(app, { board: board.id, card: card.id, actor: w, kind: on ? 'blocked' : 'unblocked', text: reason, field: 'blocked', before: !on, after: on });
  if (on) {
    try {
      require(`${__hooks}/lib_auto.js`).run(app, 'blocked', card.id, {});
    } catch (err) {
      console.error('[kanban-board] rules failed:', err);
    }
  } else if (card.getString('agent_state') === 'queued') fireWork(app);
  return { ok: true, blocked: on };
}

function archive(app, e, p, on) {
  const u = U();
  const m = M();
  const w = m.who(app, e, p);
  m.personOnly(w, on ? 'Archiving cards' : 'Restoring cards');
  const ids = (u.list(p, 'cards') || []).map(String);
  if (u.has(p, 'card')) ids.push(u.str(p, 'card', ''));
  if (ids.length === 0) throw u.fail(400, 'card (or cards) is required');
  let n = 0;
  for (const id of ids) {
    const card = m.mustCard(app, id);
    if (card.getBool('archived') === on) continue;
    if (on && card.getString('agent_state') === 'working') endSession(app, card, 'stopped', 'Archived');
    card.set('archived', on);
    if (on) card.set('agent_state', '');
    else card.set('position', m.positionIn(app, card.getString('column'), 'top', card.id));
    bump(card);
    app.save(card);
    m.log(app, { board: card.getString('board'), card: card.id, actor: w, kind: on ? 'archived' : 'restored', field: 'archived', before: !on, after: on });
    n++;
  }
  return { ok: true, changed: n };
}

function remove(app, e, p) {
  const u = U();
  const m = M();
  const w = m.who(app, e, p);
  m.personOnly(w, 'Deleting cards');
  const card = m.mustCard(app, u.req(p, 'card', 'OPS-12'));
  const board = u.byId(app, 'boards', card.getString('board'));
  const key = m.keyOf(board, card);
  const title = card.getString('title');
  app.delete(card);
  m.log(app, { board: board.id, actor: w, kind: 'deleted', text: key + ' ' + title });
  return { ok: true, deleted: key };
}

/** Accept a card the agent proposed: it joins the board (optionally in another column). */
function accept(app, e, p) {
  const u = U();
  const m = M();
  const w = m.who(app, e, p);
  m.personOnly(w, 'Accepting proposed cards');
  const card = m.mustCard(app, u.req(p, 'card', 'OPS-12'));
  if (!card.getBool('proposed')) throw u.fail(409, 'This card is not a proposal');
  card.set('proposed', false);
  const board = u.byId(app, 'boards', card.getString('board'));
  const cols = m.columnsOf(app, board.id);
  let col = u.has(p, 'column') ? m.mustColumn(app, u.str(p, 'column', ''), board.id) : null;
  const cur = u.byId(app, 'columns', card.getString('column'));
  if (col === null && cur && cur.getString('category') === 'triage') col = m.firstOf(cols, ['backlog', 'todo']) || cur;
  m.log(app, { board: board.id, card: card.id, actor: w, kind: 'accepted', text: card.getString('title') });
  if (col !== null && cur && col.id !== cur.id) place(app, w, card, col, { where: 'top' });
  else {
    bump(card);
    app.save(card);
  }
  return { ok: true, card: m.cardJson(app.findRecordById('cards', card.id), m.ctxFor(app, board.id), true) };
}

/** Answer the agent's question (or give the acceptance criteria it waits for); the card goes back to the agent. */
function answer(app, e, p) {
  const u = U();
  const m = M();
  const w = m.who(app, e, p);
  m.personOnly(w, 'Answering the agent');
  const card = m.mustCard(app, u.req(p, 'card', 'OPS-12'));
  const q = m.json(card, 'question', null);
  if (card.getString('agent_state') !== 'needs_input' || !q) throw u.fail(409, 'Nothing on this card waits for an answer');
  const text = u.req(p, 'text', '"Use the March numbers"').slice(0, 4000);
  if (q.kind === 'criteria') {
    const before = card.getString('acceptance');
    card.set('acceptance', text);
    m.log(app, { board: card.getString('board'), card: card.id, actor: w, kind: 'updated', field: 'acceptance', before: before, after: text });
  } else if (q.kind === 'plan') {
    card.set('plan_ok', false);
    card.set('feedback', ('Revise the plan: ' + text).slice(0, 4000));
  } else card.set('feedback', ('Answer to your question "' + String(q.text || '').slice(0, 300) + '": ' + text).slice(0, 4000));
  card.set('question', null);
  card.set('agent_state', 'queued');
  bump(card);
  app.save(card);
  m.log(app, { board: card.getString('board'), card: card.id, actor: w, kind: 'answer', text: text, meta: { question: q.text || '', of: q.kind || 'question' } });
  markWork(app);
  fireWork(app);
  return { ok: true };
}

/** Approve the plan the agent posted; it goes ahead. */
function approvePlan(app, e, p) {
  const u = U();
  const m = M();
  const w = m.who(app, e, p);
  m.personOnly(w, 'Approving a plan');
  const card = m.mustCard(app, u.req(p, 'card', 'OPS-12'));
  const q = m.json(card, 'question', null);
  if (!q || q.kind !== 'plan') throw u.fail(409, 'No plan waits for approval on this card');
  card.set('plan_ok', true);
  card.set('question', null);
  card.set('agent_state', 'queued');
  card.set('feedback', u.str(p, 'note', '') !== '' ? 'Plan approved: ' + u.str(p, 'note', '') : 'Plan approved: go ahead.');
  bump(card);
  app.save(card);
  m.log(app, { board: card.getString('board'), card: card.id, actor: w, kind: 'plan_approved', text: u.str(p, 'note', '') });
  markWork(app);
  fireWork(app);
  return { ok: true };
}

/** Stop the agent on a card now; it stays off the card until you delegate it again. */
function stop(app, e, p) {
  const u = U();
  const m = M();
  const w = m.who(app, e, p);
  m.personOnly(w, 'Stopping the agent');
  const card = m.mustCard(app, u.req(p, 'card', 'OPS-12'));
  if (card.getString('agent_state') === '' && card.getString('assignee') !== 'agent') throw u.fail(409, 'The agent is not on this card');
  endSession(app, card, 'stopped', 'Stopped by the person');
  card.set('agent_state', '');
  card.set('question', null);
  card.set('attention', '');
  card.set('assignee', 'you');
  bump(card);
  app.save(card);
  m.log(app, { board: card.getString('board'), card: card.id, actor: w, kind: 'stopped', text: u.str(p, 'reason', '') });
  return { ok: true };
}

/** Give a card that needs attention another go with the agent. */
function retry(app, e, p) {
  const u = U();
  const m = M();
  const w = m.who(app, e, p);
  m.personOnly(w, 'Retrying');
  const card = m.mustCard(app, u.req(p, 'card', 'OPS-12'));
  if (card.getString('assignee') !== 'agent') throw u.fail(409, 'Assign the card to the agent first (cards.assign)');
  const col = u.byId(app, 'columns', card.getString('column'));
  card.set('attempt', 0);
  card.set('handoffs', 0);
  card.set('attention', '');
  const note = u.str(p, 'note', '');
  if (note !== '') card.set('feedback', ('From the person: ' + note).slice(0, 4000));
  queueCard(app, card, col);
  bump(card);
  app.save(card);
  m.log(app, { board: card.getString('board'), card: card.id, actor: w, kind: 'retried', text: note });
  fireWork(app);
  return { ok: true };
}

/* ---------------------------------------------------------------- review */

function reviewTarget(app, card, forward) {
  const u = U();
  const m = M();
  const cols = m.columnsOf(app, card.getString('board'));
  const col = cols.find((c) => c.id === card.getString('column'));
  if (forward) return col ? m.nextColumn(cols, col) : null;
  const back = (col && col.getString('return_to')) || card.getString('work_column');
  const t = cols.find((c) => c.id === back);
  if (t) return t;
  if (col && col.getString('category') === 'review') {
    const i = cols.indexOf(col);
    for (let k = i - 1; k >= 0; k--) if (cols[k].getString('category') === 'doing') return cols[k];
  }
  void u;
  return col || null;
}

function pendingReview(app, w, p) {
  const u = U();
  const m = M();
  m.personOnly(w, 'Deciding a review');
  const card = m.mustCard(app, u.req(p, 'card', 'OPS-12'));
  if (card.getString('review_state') !== 'pending') throw u.fail(409, 'This card is not waiting for review');
  return card;
}

function approve(app, e, p) {
  const u = U();
  const m = M();
  const w = m.who(app, e, p);
  const card = pendingReview(app, w, p);
  const note = u.str(p, 'note', '');
  decide(app, card, 'approved', note);
  card.set('feedback', '');
  card.set('agent_state', '');
  m.log(app, { board: card.getString('board'), card: card.id, actor: w, kind: 'approved', text: note });
  const target = u.has(p, 'column') ? m.mustColumn(app, u.str(p, 'column', ''), card.getString('board')) : reviewTarget(app, card, true);
  if (target && target.id !== card.getString('column')) place(app, w, card, target, { where: 'top', keepReview: true, noQueue: false });
  else {
    bump(card);
    app.save(card);
  }
  try {
    require(`${__hooks}/lib_auto.js`).run(app, 'approved', card.id, {});
  } catch (err) {
    console.error('[kanban-board] rules failed:', err);
  }
  return { ok: true, moved_to: target ? target.getString('name') : '' };
}

function changes(app, e, p) {
  const u = U();
  const m = M();
  const w = m.who(app, e, p);
  const card = pendingReview(app, w, p);
  const reason = u.req(p, 'reason', '"The intro repeats the title; cut it to two sentences"').slice(0, 4000);
  decide(app, card, 'changes', reason);
  card.set('feedback', ('Changes requested: ' + reason).slice(0, 4000));
  card.set('plan_ok', false);
  m.log(app, { board: card.getString('board'), card: card.id, actor: w, kind: 'changes_requested', text: reason });
  const target = reviewTarget(app, card, false);
  // Rework goes back to the agent when it did the work, as a new round.
  const review = m.json(card, 'review', null);
  if (review && review.by === 'agent') card.set('assignee', 'agent');
  card.set('attempt', 0);
  if (target && target.id !== card.getString('column')) place(app, w, card, target, { where: 'top', keepReview: true });
  else {
    queueCard(app, card, target);
    bump(card);
    app.save(card);
    fireWork(app);
  }
  try {
    require(`${__hooks}/lib_auto.js`).run(app, 'changes_requested', card.id, {});
  } catch (err) {
    console.error('[kanban-board] rules failed:', err);
  }
  return { ok: true, returned_to: target ? target.getString('name') : '' };
}

function reject(app, e, p) {
  const u = U();
  const m = M();
  const w = m.who(app, e, p);
  const card = pendingReview(app, w, p);
  const reason = u.req(p, 'reason', '"Not needed any more"').slice(0, 4000);
  decide(app, card, 'rejected', reason);
  card.set('assignee', 'you');
  card.set('agent_state', '');
  card.set('feedback', '');
  m.log(app, { board: card.getString('board'), card: card.id, actor: w, kind: 'rejected', text: reason });
  const target = reviewTarget(app, card, false);
  if (target && target.id !== card.getString('column')) place(app, w, card, target, { where: 'top', keepReview: true, noQueue: true });
  else {
    bump(card);
    app.save(card);
  }
  return { ok: true };
}

/** Everything waiting for your review, oldest first within priority. */
function reviewList(app, p) {
  const u = U();
  const m = M();
  const filters = ["review_state = 'pending' && archived = false"];
  const bind = {};
  if (u.has(p, 'board')) {
    filters.push('board = {:b}');
    bind.b = m.mustBoard(app, u.str(p, 'board', '')).id;
  }
  const rows = app.findRecordsByFilter('cards', filters.join(' && '), 'column_at', 200, 0, bind);
  const ctxs = {};
  const out = rows.map((c) => {
    const b = c.getString('board');
    if (!ctxs[b]) ctxs[b] = m.ctxFor(app, b);
    const j = m.cardJson(c, ctxs[b], true);
    j.board_name = ctxs[b].board ? ctxs[b].board.getString('name') : '';
    return j;
  });
  out.sort((a, z) => (a.priority || 9) - (z.priority || 9) || (a.column_at < z.column_at ? -1 : 1));
  return { cards: out };
}

module.exports = {
  PRIORITY_LABEL: PRIORITY_LABEL,
  priorityOf: priorityOf,
  checkVersion: checkVersion,
  agentEditGuard: agentEditGuard,
  endSession: endSession,
  runOf: runOf,
  queueOnEntry: queueOnEntry,
  queueCard: queueCard,
  place: place,
  decide: decide,
  setAssignee: setAssignee,
  runJson: runJson,
  list: list,
  get: get,
  add: add,
  update: update,
  move: move,
  assign: assign,
  comment: comment,
  check: check,
  block: block,
  archive: archive,
  remove: remove,
  accept: accept,
  answer: answer,
  approvePlan: approvePlan,
  stop: stop,
  retry: retry,
  approve: approve,
  changes: changes,
  reject: reject,
  reviewList: reviewList,
};
