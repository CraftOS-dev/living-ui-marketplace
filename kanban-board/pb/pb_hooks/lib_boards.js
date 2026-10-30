/// <reference path="../pb_data/types.d.ts" />
/**
 * Boards, their columns (each a small contract: category, WIP limit,
 * policy, whether the agent works it, gates, next stage, review return,
 * lease and attempts) and labels. Structure is the person's: the agent reads
 * it, and is refused when it tries to change it.
 */

function U() {
  return require(`${__hooks}/lib_util.js`);
}
function M() {
  return require(`${__hooks}/lib_model.js`);
}

/** Starting points for a new board. `agent` on a column = the agent works every card that enters it. */
const TEMPLATES = {
  simple: {
    label: 'Simple',
    description: 'Backlog, To do, In progress, Review, Done. Assign any card to the agent; its work comes back to Review.',
    columns: [
      { name: 'Backlog', category: 'backlog' },
      { name: 'To do', category: 'todo' },
      { name: 'In progress', category: 'doing', wip: 4 },
      { name: 'Review', category: 'review', policy: 'Agent work waits here for you: approve it, request changes or reject it.' },
      { name: 'Done', category: 'done' },
    ],
  },
  pipeline: {
    label: 'Agent pipeline',
    description: 'Cards you move to Agent working are taken by the agent, worked under a WIP limit and sent to you for review.',
    columns: [
      { name: 'Proposed', category: 'triage', policy: 'Cards the agent suggests. Accept the useful ones; archive the rest.' },
      { name: 'Ready', category: 'todo', policy: 'Ready means clear acceptance criteria and everything the agent needs.' },
      { name: 'Agent working', category: 'doing', wip: 3, agent: true, need_criteria: true, instructions: 'Do the card end to end. Show your evidence when you submit.' },
      { name: 'Review', category: 'review', wip: 6, policy: 'Approve, request changes (the agent reworks it) or reject.' },
      { name: 'Done', category: 'done' },
    ],
  },
  content: {
    label: 'Content studio',
    description: 'The agent researches an idea, then drafts it, and you review it before it ships.',
    columns: [
      { name: 'Ideas', category: 'backlog' },
      { name: 'Research', category: 'doing', wip: 3, agent: true, instructions: 'Collect the facts, sources and angles the draft needs. Put your notes in the card description under "Research".' },
      { name: 'Draft', category: 'doing', wip: 3, agent: true, instructions: 'Write the piece from the research notes, in the board\'s voice. Put the draft in the description under "Draft".' },
      { name: 'Review', category: 'review', policy: 'Read the draft. Approve to publish, or request changes with what to fix.' },
      { name: 'Published', category: 'done' },
    ],
  },
  software: {
    label: 'Software',
    description: 'Triage, Backlog, Ready, In progress, In review, Done and Canceled, with plan approval for the agent.',
    columns: [
      { name: 'Triage', category: 'triage' },
      { name: 'Backlog', category: 'backlog' },
      { name: 'Ready', category: 'todo', need_criteria: true },
      { name: 'In progress', category: 'doing', wip: 3, plan_first: true, instructions: 'Post a short plan first. Work in small, reviewable steps; say how you tested.' },
      { name: 'In review', category: 'review', wip: 5 },
      { name: 'Done', category: 'done' },
      { name: 'Canceled', category: 'canceled' },
    ],
  },
  basic: {
    label: 'Three columns',
    description: 'To do, Doing, Done.',
    columns: [
      { name: 'To do', category: 'todo' },
      { name: 'Doing', category: 'doing' },
      { name: 'Done', category: 'done' },
    ],
  },
};

const HOW = [
  'How we work on this board:',
  '- Keep each change small and focused on the card.',
  '- Before you submit, check your work against the acceptance criteria and say how you checked it.',
  '- If the card is unclear or you would have to guess, ask one clear question instead.',
  '- Never delete or archive anything; hand a card back when it is not agent work.',
].join('\n');

/* ---------------------------------------------------------------- boards */

function stats(app, boardId) {
  const rows = U().rows(
    app,
    "SELECT COALESCE(SUM(CASE WHEN agent_state = 'working' THEN 1 ELSE 0 END), 0) AS working, COALESCE(SUM(CASE WHEN agent_state = 'queued' THEN 1 ELSE 0 END), 0) AS queued, COALESCE(SUM(CASE WHEN agent_state IN ('needs_input','needs_attention') OR review_state = 'pending' OR proposed = 1 THEN 1 ELSE 0 END), 0) AS needs_you, COUNT(*) AS cards FROM cards WHERE board = {:b} AND archived = 0",
    { working: 0, queued: 0, needs_you: 0, cards: 0 },
    { b: boardId },
  );
  const r = rows[0] || {};
  return { working: r.working || 0, queued: r.queued || 0, needs_you: r.needs_you || 0, cards: r.cards || 0 };
}

function list(app, p) {
  const u = U();
  const m = M();
  const all = u.bool(p, 'archived', false);
  const rows = app.findRecordsByFilter('boards', all ? "id != ''" : 'archived = false', 'sort,created', 0, 0);
  return { boards: rows.map((b) => m.boardJson(b, { stats: stats(app, b.id) })) };
}

function get(app, p, e) {
  const u = U();
  const m = M();
  const board = m.mustBoard(app, u.req(p, 'board', 'OPS'));
  const ctx = m.ctxFor(app, board.id);
  const cards = app.findRecordsByFilter('cards', 'board = {:b} && archived = false', 'position,created', 0, 0, { b: board.id });
  const count = {};
  for (const c of cards) count[c.getString('column')] = (count[c.getString('column')] || 0) + 1;
  const cols = m.columnsOf(app, board.id);
  if (m.forAgent(e, p)) {
    // The agent's view: the board's rules, its columns in order, and each card in brief.
    return {
      board: { key: board.getString('key'), name: board.getString('name'), description: board.getString('description'), how_we_work: board.getString('instructions'), frozen: board.getBool('frozen') },
      columns: cols.map((c) => {
        const o = { name: c.getString('name'), category: c.getString('category'), cards: count[c.id] || 0, agent_works_it: c.getBool('agent') };
        if (c.getInt('wip') > 0) o.wip = c.getInt('wip');
        if (c.getString('policy') !== '') o.policy = c.getString('policy');
        return o;
      }),
      cards: cards.map((c) => m.cardBrief(c, ctx)),
      labels: Object.values(ctx.labels).map((l) => l.getString('name')),
      note: 'A lean view for the agent; add --full true for every field. cards.get --card <key> reads one card in full.',
    };
  }
  return {
    board: m.boardJson(board, { stats: stats(app, board.id) }),
    columns: cols.map((c) => m.columnJson(c, count[c.id] || 0)),
    cards: cards.map((c) => m.cardJson(c, ctx, u.bool(p, 'full', false))),
    labels: Object.values(ctx.labels).map((l) => ({ id: l.id, name: l.getString('name'), color: l.getString('color') || 'gray' })),
    rules: app.findRecordsByFilter('rules', 'board = {:b}', '', 0, 0, { b: board.id }).length,
    archived_cards: app.findRecordsByFilter('cards', 'board = {:b} && archived = true', '', 0, 0, { b: board.id }).length,
  };
}

function keyFor(app, name, wanted) {
  const u = U();
  let k = String(wanted || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
  if (k !== '') {
    if (!/^[A-Z]/.test(k)) throw u.fail(400, 'key must start with a letter (2 to 6 letters or digits, e.g. OPS)');
    if (u.findOne(app, 'boards', 'key = {:k}', { k: k }) !== null) throw u.fail(409, 'Another board already uses the key ' + k);
    return k;
  }
  const words = String(name || 'Board')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  let base = words.length > 1 ? words.map((w) => w[0]).join('').slice(0, 4) : (words[0] || 'BRD').slice(0, 3);
  if (!/^[A-Z]/.test(base)) base = 'B' + base;
  k = base;
  let n = 2;
  while (u.findOne(app, 'boards', 'key = {:k}', { k: k }) !== null) k = base.slice(0, 4) + n++;
  return k;
}

function create(app, e, p) {
  const u = U();
  const m = M();
  const w = m.who(app, e, p);
  m.personOnly(w, 'Creating boards');
  const name = u.squash(u.req(p, 'name', '"Launch plan"')).slice(0, 80);
  const tpl = TEMPLATES[u.oneOf(p, 'template', Object.keys(TEMPLATES), 'simple')];
  const b = new Record(app.findCollectionByNameOrId('boards'));
  b.set('name', name);
  b.set('key', keyFor(app, name, u.str(p, 'key', '')));
  b.set('description', u.str(p, 'description', '').slice(0, 400));
  b.set('instructions', u.has(p, 'instructions') ? u.str(p, 'instructions', '') : HOW);
  b.set('seq', 0);
  b.set('sort', app.findAllRecords('boards').length);
  b.set('swimlanes', 'none');
  app.save(b);
  tpl.columns.forEach((c, i) => {
    const col = new Record(app.findCollectionByNameOrId('columns'));
    col.set('board', b.id);
    col.set('name', c.name);
    col.set('category', c.category);
    col.set('position', i);
    col.set('wip', c.wip || 0);
    col.set('policy', c.policy || '');
    col.set('instructions', c.instructions || '');
    col.set('agent', !!c.agent);
    col.set('plan_first', !!c.plan_first);
    col.set('need_criteria', !!c.need_criteria);
    col.set('lease_minutes', 15);
    col.set('max_attempts', 3);
    app.save(col);
  });
  for (const [n, c] of [
    ['Bug', 'red'],
    ['Feature', 'blue'],
    ['Research', 'purple'],
    ['Docs', 'teal'],
  ]) {
    const l = new Record(app.findCollectionByNameOrId('labels'));
    l.set('board', b.id);
    l.set('name', n);
    l.set('color', c);
    app.save(l);
  }
  m.log(app, { board: b.id, actor: w, kind: 'board_created', text: name });
  return { ok: true, board: m.boardJson(b) };
}

function update(app, e, p) {
  const u = U();
  const m = M();
  const w = m.who(app, e, p);
  m.personOnly(w, 'Changing a board');
  const b = m.mustBoard(app, u.req(p, 'board', 'OPS'));
  const before = m.boardJson(b);
  if (u.has(p, 'name')) {
    const n = u.squash(u.str(p, 'name', ''));
    if (n === '') throw u.fail(400, 'name cannot be empty');
    b.set('name', n.slice(0, 80));
  }
  if (u.has(p, 'key') && u.str(p, 'key', '').toUpperCase() !== b.getString('key')) b.set('key', keyFor(app, b.getString('name'), u.str(p, 'key', '')));
  if (u.has(p, 'description')) b.set('description', u.str(p, 'description', '').slice(0, 400));
  if (u.has(p, 'instructions')) b.set('instructions', u.str(p, 'instructions', ''));
  if (u.has(p, 'frozen')) b.set('frozen', u.bool(p, 'frozen', false));
  if (u.has(p, 'archived')) b.set('archived', u.bool(p, 'archived', false));
  if (u.has(p, 'swimlanes')) b.set('swimlanes', u.oneOf(p, 'swimlanes', ['none', 'assignee', 'priority'], 'none'));
  if (u.has(p, 'sort')) b.set('sort', u.number(p, 'sort', {}) || 0);
  app.save(b);
  const after = m.boardJson(b);
  if (before.frozen !== after.frozen) m.log(app, { board: b.id, actor: w, kind: after.frozen ? 'board_frozen' : 'board_unfrozen', text: after.frozen ? 'Agents cannot change this board' : 'Agents may work on this board again' });
  else if (before.instructions !== after.instructions) m.log(app, { board: b.id, actor: w, kind: 'board_updated', field: 'instructions', before: before.instructions, after: after.instructions });
  if (before.frozen && !after.frozen) {
    require(`${__hooks}/lib_work.js`).markDirty(app);
    require(`${__hooks}/lib_work.js`).fireIfNeeded(app);
  }
  return { ok: true, board: after };
}

function remove(app, e, p) {
  const u = U();
  const m = M();
  const w = m.who(app, e, p);
  m.personOnly(w, 'Deleting boards');
  const b = m.mustBoard(app, u.req(p, 'board', 'OPS'));
  if (app.findRecordsByFilter('boards', 'archived = false', '', 0, 0).filter((x) => x.id !== b.id).length === 0 && !b.getBool('archived')) {
    throw u.fail(409, 'This is your only board; create another one before deleting it');
  }
  const name = b.getString('name');
  // Cards point at columns without cascade: remove cards first.
  for (const c of app.findRecordsByFilter('cards', 'board = {:b}', '', 0, 0, { b: b.id })) app.delete(c);
  app.delete(b);
  m.log(app, { actor: w, kind: 'board_deleted', text: name });
  return { ok: true };
}

function templates() {
  return {
    templates: Object.keys(TEMPLATES).map((k) => ({ id: k, label: TEMPLATES[k].label, description: TEMPLATES[k].description, columns: TEMPLATES[k].columns.map((c) => ({ name: c.name, category: c.category, agent: !!c.agent })) })),
  };
}

/* --------------------------------------------------------------- columns */

function applyColumn(app, col, p, boardId) {
  const u = U();
  const m = M();
  if (u.has(p, 'name')) {
    const n = u.squash(u.str(p, 'name', ''));
    if (n === '') throw u.fail(400, 'name cannot be empty');
    col.set('name', n.slice(0, 60));
  }
  if (u.has(p, 'category')) col.set('category', u.oneOf(p, 'category', m.CATEGORIES, 'todo'));
  if (u.has(p, 'wip')) col.set('wip', u.int(p, 'wip', 0, 0, 999));
  if (u.has(p, 'policy')) col.set('policy', u.str(p, 'policy', '').slice(0, 4000));
  if (u.has(p, 'instructions')) col.set('instructions', u.str(p, 'instructions', '').slice(0, 8000));
  if (u.has(p, 'agent')) col.set('agent', u.bool(p, 'agent', false));
  if (u.has(p, 'plan_first')) col.set('plan_first', u.bool(p, 'plan_first', false));
  if (u.has(p, 'need_criteria')) col.set('need_criteria', u.bool(p, 'need_criteria', false));
  if (u.has(p, 'need_checklist')) col.set('need_checklist', u.bool(p, 'need_checklist', false));
  for (const f of ['next', 'return_to']) {
    if (!u.has(p, f)) continue;
    const v = u.str(p, f, '');
    if (v === '') col.set(f, '');
    else {
      const t = m.mustColumn(app, v, boardId);
      if (t.id === col.id) throw u.fail(400, f + ' cannot be the column itself');
      col.set(f, t.id);
    }
  }
  if (u.has(p, 'lease_minutes')) col.set('lease_minutes', u.int(p, 'lease_minutes', 15, 2, 240));
  if (u.has(p, 'max_attempts')) col.set('max_attempts', u.int(p, 'max_attempts', 3, 1, 10));
  if (u.has(p, 'aging_days')) col.set('aging_days', u.number(p, 'aging_days', { min: 0, max: 365 }) || 0);
  if (u.has(p, 'collapsed')) col.set('collapsed', u.bool(p, 'collapsed', false));
  const cat = col.getString('category');
  // The agent works to-do and started columns; review and finished ones are the person's.
  if ((cat === 'done' || cat === 'canceled' || cat === 'review') && col.getBool('agent')) col.set('agent', false);
}

function columnAdd(app, e, p) {
  const u = U();
  const m = M();
  const w = m.who(app, e, p);
  m.personOnly(w, 'Adding columns');
  const b = m.mustBoard(app, u.req(p, 'board', 'OPS'));
  const cols = m.columnsOf(app, b.id);
  const col = new Record(app.findCollectionByNameOrId('columns'));
  col.set('board', b.id);
  col.set('name', 'Column');
  col.set('category', 'todo');
  col.set('agent', false);
  col.set('lease_minutes', 15);
  col.set('max_attempts', 3);
  const at = u.int(p, 'index', cols.length, 0, cols.length);
  col.set('position', at >= cols.length ? (cols.length ? cols[cols.length - 1].getFloat('position') + 1 : 0) : at === 0 ? cols[0].getFloat('position') - 1 : (cols[at - 1].getFloat('position') + cols[at].getFloat('position')) / 2);
  applyColumn(app, col, p, b.id);
  app.save(col);
  m.log(app, { board: b.id, actor: w, kind: 'column_added', text: col.getString('name') });
  return { ok: true, column: m.columnJson(col, 0) };
}

function columnUpdate(app, e, p) {
  const u = U();
  const m = M();
  const w = m.who(app, e, p);
  m.personOnly(w, 'Changing a column');
  const col = m.mustColumn(app, u.req(p, 'column', '<column id>'), null);
  const before = m.columnJson(col);
  applyColumn(app, col, p, col.getString('board'));
  app.save(col);
  const after = m.columnJson(col);
  const changed = Object.keys(after).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k]) && k !== 'collapsed');
  if (changed.length > 0) m.log(app, { board: col.getString('board'), actor: w, kind: 'column_updated', text: after.name + ': ' + changed.join(', '), before: before, after: after });
  // Turning the agent on queues the cards already sitting there (yours stay yours).
  if (!before.agent && after.agent) {
    const C = require(`${__hooks}/lib_cards.js`);
    for (const c of m.cardsIn(app, col.id)) {
      if (c.getString('agent_state') !== '' || c.getString('assignee') === 'you' || c.getBool('proposed')) continue;
      C.queueOnEntry(app, c, col);
      c.set('version', c.getInt('version') + 1);
      app.save(c);
    }
    require(`${__hooks}/lib_work.js`).fireIfNeeded(app);
  }
  return { ok: true, column: after };
}

function columnMove(app, e, p) {
  const u = U();
  const m = M();
  const w = m.who(app, e, p);
  m.personOnly(w, 'Reordering columns');
  const col = m.mustColumn(app, u.req(p, 'column', '<column id>'), null);
  const cols = m.columnsOf(app, col.getString('board')).filter((c) => c.id !== col.id);
  const at = u.int(p, 'index', 0, 0, cols.length);
  cols.splice(at, 0, col);
  cols.forEach((c, i) => {
    if (c.getFloat('position') !== i) {
      c.set('position', i);
      app.save(c);
    }
  });
  return { ok: true };
}

function columnRemove(app, e, p) {
  const u = U();
  const m = M();
  const w = m.who(app, e, p);
  m.personOnly(w, 'Removing columns');
  const col = m.mustColumn(app, u.req(p, 'column', '<column id>'), null);
  const boardId = col.getString('board');
  const cols = m.columnsOf(app, boardId);
  if (cols.length <= 1) throw u.fail(409, 'A board needs at least one column');
  const cards = app.findRecordsByFilter('cards', 'column = {:c}', '', 0, 0, { c: col.id });
  if (cards.length > 0) {
    if (!u.has(p, 'move_to')) throw u.fail(409, col.getString('name') + ' still holds ' + cards.length + ' card(s): give move_to (another column) to move them first', { code: 'not_empty', cards: cards.length });
    const to = m.mustColumn(app, u.str(p, 'move_to', ''), boardId);
    if (to.id === col.id) throw u.fail(400, 'move_to must be another column');
    const C = require(`${__hooks}/lib_cards.js`);
    for (const c of cards) C.place(app, w, c, to, { where: 'bottom', fromRule: true });
  }
  for (const c of cols) {
    let dirty = false;
    for (const f of ['next', 'return_to']) {
      if (c.getString(f) === col.id) {
        c.set(f, '');
        dirty = true;
      }
    }
    if (dirty) app.save(c);
  }
  for (const r of app.findRecordsByFilter('rules', 'board = {:b} && column = {:c}', '', 0, 0, { b: boardId, c: col.id })) {
    r.set('enabled', false);
    r.set('paused_reason', 'Its column was removed');
    app.save(r);
  }
  const name = col.getString('name');
  app.delete(col);
  m.log(app, { board: boardId, actor: w, kind: 'column_removed', text: name });
  return { ok: true };
}

/* ---------------------------------------------------------------- labels */

function labelSave(app, e, p) {
  const u = U();
  const m = M();
  const w = m.who(app, e, p);
  m.personOnly(w, 'Changing labels');
  let l = null;
  if (u.has(p, 'label')) {
    l = u.byId(app, 'labels', u.str(p, 'label', ''));
    if (l === null) throw u.fail(404, 'No such label');
  } else {
    const b = m.mustBoard(app, u.req(p, 'board', 'OPS'));
    l = new Record(app.findCollectionByNameOrId('labels'));
    l.set('board', b.id);
    l.set('color', 'gray');
  }
  if (u.has(p, 'name') || !u.has(p, 'label')) {
    const n = u.squash(u.req(p, 'name', '"Bug"')).slice(0, 40);
    const dup = app.findRecordsByFilter('labels', 'board = {:b}', '', 0, 0, { b: l.getString('board') }).find((x) => x.id !== l.id && x.getString('name').toLowerCase() === n.toLowerCase());
    if (dup) throw u.fail(409, 'This board already has a label "' + n + '"');
    l.set('name', n);
  }
  if (u.has(p, 'color')) l.set('color', u.oneOf(p, 'color', m.LABEL_COLORS, 'gray'));
  app.save(l);
  return { ok: true, label: { id: l.id, name: l.getString('name'), color: l.getString('color') } };
}

function labelRemove(app, e, p) {
  const u = U();
  const m = M();
  const w = m.who(app, e, p);
  m.personOnly(w, 'Removing labels');
  const l = u.byId(app, 'labels', u.req(p, 'label', '<label id>'));
  if (l === null) throw u.fail(404, 'No such label');
  for (const c of app.findRecordsByFilter('cards', 'labels ~ {:l}', '', 0, 0, { l: l.id })) {
    c.set('labels', c.getStringSlice('labels').filter((x) => x !== l.id));
    app.save(c);
  }
  app.delete(l);
  return { ok: true };
}

module.exports = {
  TEMPLATES: TEMPLATES,
  list: list,
  get: get,
  create: create,
  update: update,
  remove: remove,
  templates: templates,
  columnAdd: columnAdd,
  columnUpdate: columnUpdate,
  columnMove: columnMove,
  columnRemove: columnRemove,
  labelSave: labelSave,
  labelRemove: labelRemove,
};
