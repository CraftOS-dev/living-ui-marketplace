/// <reference path="../pb_data/types.d.ts" />
/**
 * lib_agent.js — the logic behind the agent operations in agent_ops.pb.js.
 *
 * Every operation does what one of the person's clicks does in the View. The
 * View's real behaviour lives in its browser-side data layer,
 * frontend/src/app/services/apiAdapter.ts: canvas placement, the
 * question/answer/idea <-> `kind` mapping, and what the AI buttons write after
 * calling the ops in ops.pb.js. The parts the View relies on are ported here
 * (each port names its source), and the three AI prompts are copied from
 * ops.pb.js. If either source changes, change the port with it.
 *
 * Every node an operation creates is stored with created_by 'agent', so its
 * card reads "Created by AI", as the nodes of the View's AI buttons do.
 *
 * Each operation returns { status, body }; the route answers
 * e.json(status, body). Errors use this app's { error: '...' } shape.
 */

// Layout constants — apiAdapter.ts (CANVAS_CENTER_X … CARD_H, "V1 layout constants").
const CANVAS_CENTER_X = 1500.0;
const CANVAS_CENTER_Y = 400.0;
const CHILD_Y_OFFSET = 220.0;
const CHILD_X_SPACING = 280.0;
const CARD_W = 260.0;
const CARD_H = 160.0;
// The View loads at most 500 nodes per session, oldest first
// (apiAdapter.ts resolveNodes: `sort=created&perPage=500`).
const VIEW_NODE_LIMIT = 500;

const NODE_TYPES = ['question', 'answer', 'idea'];
// The AI Explore dialog's choices (MainView.tsx): search strategy and effort
// in steps (Low 2, Medium 3, High 5).
const EXPLORE_STRATEGIES = ['bfs', 'dfs'];
const EXPLORE_EFFORTS = [2, 3, 5];
// The error every AI route in ops.pb.js answers when callLLM returns ''.
const AI_UNAVAILABLE = 'AI is unavailable (app not running inside CraftBot)';

// ---------------------------------------------------------------- replies

function reply(status, body) {
  return { status: status, body: body };
}

function ok(body) {
  return reply(200, body);
}

function badRequest(message) {
  return reply(400, { error: message });
}

function notFound(what, id) {
  return reply(404, { error: what + ' not found: ' + id });
}

// ------------------------------------------------------------- parameters

// Params from the query AND the JSON body (body wins), so a GET operation keeps
// working when it is served as POST /api/ops/<name> with a JSON body.
function paramsOf(e) {
  const info = e.requestInfo();
  const params = {};
  const query = info.query || {};
  for (const key of Object.keys(query)) params[key] = query[key];
  const body = info.body;
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    for (const key of Object.keys(body)) params[key] = body[key];
  }
  return params;
}

// Same extraction as ops.pb.js: String(body.x || '').
function idParam(params, name) {
  return String(params[name] || '');
}

function hasParam(params, name) {
  return params[name] !== undefined && params[name] !== null;
}

// Trimmed, non-empty text within the collection's max — the View trims and
// refuses empty input (SessionSidebar.tsx submitCreate, MainView.tsx
// submitAddChild / handleSaveEdit); PocketBase enforces the max.
function textParam(params, name, max) {
  const value = hasParam(params, name) ? String(params[name]).trim() : '';
  if (value === '') return { error: name + ' is required' };
  if (value.length > max) return { error: name + ' must be at most ' + max + ' characters' };
  return { value: value };
}

// The View's three node types (MainView.tsx type selects).
function typeParam(params, fallback) {
  if (!hasParam(params, 'type') || params.type === '') return { value: fallback };
  const value = String(params.type);
  if (NODE_TYPES.indexOf(value) < 0) return { error: 'type must be question, answer or idea' };
  return { value: value };
}

function findRecord(app, collection, id) {
  if (id === '') return null;
  try {
    return app.findRecordById(collection, id);
  } catch (_) {
    return null;
  }
}

// ------------------------------------------------------- type vocabulary

// apiAdapter.ts toPbKind: View type -> stored kind.
function toKind(nodeType) {
  switch (String(nodeType == null ? '' : nodeType)) {
    case 'answer': return 'insight';
    case 'question': return 'question';
    case 'idea': return 'idea';
    default: return 'idea';
  }
}

// apiAdapter.ts toV1Type: stored kind -> View type.
function toType(kind) {
  switch (String(kind == null ? '' : kind)) {
    case 'insight': return 'answer';
    case 'question': return 'question';
    case 'idea': return 'idea';
    case 'task': return 'idea';
    default: return 'idea';
  }
}

// ------------------------------------------------------------ canvas layout

// apiAdapter.ts collides (V1 _collides).
function collides(x, y, existing) {
  for (const pair of existing) {
    if (Math.abs(x - pair[0]) < CARD_W && Math.abs(y - pair[1]) < CARD_H) return true;
  }
  return false;
}

// apiAdapter.ts childPositions (V1 _child_positions).
function childPositions(parentX, parentY, existingCount, newCount, allPositions) {
  const total = existingCount + newCount;
  const yBase = parentY + CHILD_Y_OFFSET;
  const results = [];
  const used = allPositions.slice();
  for (let i = 0; i < newCount; i++) {
    const idx = existingCount + i;
    const offset = (idx - (total - 1) / 2) * CHILD_X_SPACING;
    const x = parentX + offset;
    let y = yBase;
    let attempts = 0;
    while (collides(x, y, used) && attempts < 8) {
      y += CHILD_Y_OFFSET;
      attempts += 1;
    }
    results.push([x, y]);
    used.push([x, y]);
  }
  return results;
}

// apiAdapter.ts resolveNodes: a session's nodes as the View sees them — the
// first 500 by creation, each with its depth and effective x/y (stored, or
// laid out when still at 0/0). Read-only: like the View, nothing is saved.
function layout(app, sessionId) {
  const rows = Array.from(
    app.findRecordsByFilter('nodes', 'session = {:session}', 'created', VIEW_NODE_LIMIT + 1, 0, { session: sessionId }),
  );
  const truncated = rows.length > VIEW_NODE_LIMIT;
  const items = rows.slice(0, VIEW_NODE_LIMIT).map((r) => ({
    record: r,
    id: r.id,
    parent: r.getString('parent'),
    content: r.getString('content'),
    kind: r.getString('kind'),
    createdBy: r.getString('created_by'),
    storedX: r.getFloat('x'),
    storedY: r.getFloat('y'),
    x: 0,
    y: 0,
    depth: 0,
  }));
  const isPlaced = (it) => it.storedX !== 0 || it.storedY !== 0;

  const ids = new Set(items.map((it) => it.id));
  const childrenOf = new Map();
  const roots = [];
  for (const it of items) {
    if (it.parent && ids.has(it.parent)) {
      const arr = childrenOf.get(it.parent);
      if (arr) arr.push(it);
      else childrenOf.set(it.parent, [it]);
    } else {
      roots.push(it);
    }
  }

  const reached = new Set();
  const used = [];
  for (const it of items) {
    if (isPlaced(it)) used.push([it.storedX, it.storedY]);
  }

  const queue = [];
  let rootAuto = 0;
  for (const r of roots) {
    r.depth = 0;
    if (isPlaced(r)) {
      r.x = r.storedX;
      r.y = r.storedY;
    } else {
      r.x = CANVAS_CENTER_X + rootAuto * CHILD_X_SPACING;
      r.y = CANVAS_CENTER_Y;
      rootAuto += 1;
      used.push([r.x, r.y]);
    }
    reached.add(r.id);
    queue.push(r);
  }

  let head = 0;
  while (head < queue.length) {
    const parent = queue[head];
    head += 1;
    const kids = childrenOf.get(parent.id) || [];
    const placed = kids.filter((k) => isPlaced(k));
    const unplaced = kids.filter((k) => !isPlaced(k));
    for (const k of placed) {
      k.x = k.storedX;
      k.y = k.storedY;
    }
    const positions = childPositions(parent.x, parent.y, placed.length, unplaced.length, used);
    for (let i = 0; i < unplaced.length; i++) {
      unplaced[i].x = positions[i][0];
      unplaced[i].y = positions[i][1];
      used.push([positions[i][0], positions[i][1]]);
    }
    for (const k of kids) {
      k.depth = parent.depth + 1;
      reached.add(k.id);
      queue.push(k);
    }
  }

  // Never reached from a root (only a parent cycle does that): the View keeps
  // the stored position and depth 0.
  for (const it of items) {
    if (!reached.has(it.id)) {
      it.x = it.storedX;
      it.y = it.storedY;
      it.depth = 0;
    }
  }
  return { nodes: items, truncated: truncated };
}

// ------------------------------------------------------------------ views

function sessionView(record) {
  return {
    id: record.id,
    title: record.getString('title'),
    topic: record.getString('topic'),
    created: record.getString('created'),
    updated: record.getString('updated'),
  };
}

// Who made a node, as its card shows it (apiAdapter.ts nodeDict): 'agent'
// reads "Created by AI"; 'user' or empty (older rows, the seed) reads
// "Created by you".
function authorOf(createdBy) {
  return createdBy === 'agent' ? 'agent' : 'user';
}

// A node as the View shows it: `type` in the View's words, `kind` as stored,
// `created_by` for the card's AI/you mark, `x`/`y` where the card is drawn,
// `placed` false while the card is laid out automatically (stored 0/0).
function nodeView(it) {
  return {
    id: it.id,
    parent: it.parent || null,
    type: toType(it.kind),
    kind: it.kind,
    content: it.content,
    created_by: authorOf(it.createdBy),
    depth: it.depth,
    x: it.x,
    y: it.y,
    placed: it.storedX !== 0 || it.storedY !== 0,
  };
}

function nodeViewOf(app, record) {
  const found = layout(app, record.getString('session')).nodes.filter((it) => it.id === record.id)[0];
  if (found) return nodeView(found);
  // Past the View's 500-node window: stored values only.
  return {
    id: record.id,
    parent: record.getString('parent') || null,
    type: toType(record.getString('kind')),
    kind: record.getString('kind'),
    content: record.getString('content'),
    created_by: authorOf(record.getString('created_by')),
    depth: null,
    x: record.getFloat('x'),
    y: record.getFloat('y'),
    placed: record.getFloat('x') !== 0 || record.getFloat('y') !== 0,
  };
}

// What the View does right after each AI op (apiAdapter.ts handleNodeExpand /
// handleNodeAnswer / handleSessionExplore): lay the session out with the new
// nodes still unplaced, then store each new node's x/y where it landed (plus
// `extra` fields, e.g. Expand's kind:'question'). Only nodes inside the View's
// 500-node window are touched, as in the View.
function pinNew(app, sessionId, newIds, extra) {
  const byId = new Map();
  for (const it of layout(app, sessionId).nodes) byId.set(it.id, it);
  const out = [];
  for (const id of newIds) {
    const it = byId.get(id);
    if (!it) continue;
    it.record.set('x', it.x);
    it.record.set('y', it.y);
    if (extra) {
      for (const key of Object.keys(extra)) it.record.set(key, extra[key]);
      if (extra.kind !== undefined) it.kind = extra.kind;
    }
    app.save(it.record);
    it.storedX = it.x;
    it.storedY = it.y;
    out.push(nodeView(it));
  }
  return out;
}

// ops.pb.js nodes.suggest / sessions.explore: one idea per line, list markers
// stripped, at most `max`.
function ideaLines(raw, max) {
  return raw
    .split('\n')
    .map((line) => line.replace(/^[-*\d.\s]+/, '').trim())
    .filter((line) => line !== '')
    .slice(0, max);
}

// -------------------------------------------------------------- operations

// sessions.get — opening a session in the View (apiAdapter.ts
// handleSessionNodes -> resolveNodes), the toolbar's node count and the Summary
// view's stats strip (SummaryView.tsx: questions/answers/ideas, levels deep =
// max depth + 1).
function getSession(app, params) {
  const sessionId = idParam(params, 'session_id');
  if (sessionId === '') return badRequest('session_id is required');
  const session = findRecord(app, 'sessions', sessionId);
  if (!session) return notFound('session', sessionId);

  const resolved = layout(app, session.id);
  const nodes = resolved.nodes.map(nodeView);
  const count = (type) => nodes.filter((n) => n.type === type).length;
  let maxDepth = 0;
  for (const n of nodes) if (n.depth > maxDepth) maxDepth = n.depth;
  return ok({
    session: sessionView(session),
    stats: {
      nodes: nodes.length,
      questions: count('question'),
      answers: count('answer'),
      ideas: count('idea'),
      levels: nodes.length > 0 ? maxDepth + 1 : 0,
    },
    truncated: resolved.truncated,
    nodes: nodes,
  });
}

// sessions.create — the New Brainstorm Session dialog (SessionSidebar.tsx
// submitCreate: title and topic trimmed, both required) -> AppController
// createSession -> apiAdapter.ts handleSessionCreate: the session, then its
// root node { content: topic, kind: 'idea', x: 1500, y: 400 }.
function createSession(app, params) {
  const title = textParam(params, 'title', 255);
  if (title.error) return badRequest(title.error);
  const topic = textParam(params, 'topic', 2000);
  if (topic.error) return badRequest(topic.error);

  let sessionId = '';
  let rootId = '';
  app.runInTransaction((txApp) => {
    const session = new Record(txApp.findCollectionByNameOrId('sessions'));
    session.set('title', title.value);
    session.set('topic', topic.value);
    txApp.save(session);
    sessionId = session.id;

    const root = new Record(txApp.findCollectionByNameOrId('nodes'));
    root.set('session', session.id);
    root.set('content', topic.value);
    root.set('kind', 'idea');
    root.set('created_by', 'agent');
    root.set('x', CANVAS_CENTER_X);
    root.set('y', CANVAS_CENTER_Y);
    txApp.save(root);
    rootId = root.id;
  });

  return ok({
    session: sessionView(app.findRecordById('sessions', sessionId)),
    root: nodeViewOf(app, app.findRecordById('nodes', rootId)),
  });
}

// nodes.add — the Add node dialog (MainView.tsx submitAddChild: content
// trimmed and required, type defaults to 'question', parent = the clicked
// node) -> AppController createNode -> apiAdapter.ts handleNodeCreate: the
// child's slot is computed from the parent's effective position and its
// existing children, and stored.
function addNode(app, params) {
  const parentId = idParam(params, 'parent_id');
  if (parentId === '') return badRequest('parent_id is required');
  const content = textParam(params, 'content', 2000);
  if (content.error) return badRequest(content.error);
  const nodeType = typeParam(params, 'question');
  if (nodeType.error) return badRequest(nodeType.error);
  const parent = findRecord(app, 'nodes', parentId);
  if (!parent) return notFound('node', parentId);

  // The View adds into the open session, which is always the parent's.
  const sessionId = parent.getString('session');
  let x = CANVAS_CENTER_X;
  let y = CANVAS_CENTER_Y;
  const resolved = layout(app, sessionId).nodes;
  const parentItem = resolved.filter((it) => it.id === parentId)[0];
  if (parentItem) {
    const existingCount = resolved.filter((it) => it.parent === parentId).length;
    const allPositions = resolved.map((it) => [it.x, it.y]);
    const p = childPositions(parentItem.x, parentItem.y, existingCount, 1, allPositions)[0];
    x = p[0];
    y = p[1];
  }

  const record = new Record(app.findCollectionByNameOrId('nodes'));
  record.set('session', sessionId);
  record.set('content', content.value);
  record.set('kind', toKind(nodeType.value));
  record.set('created_by', 'agent');
  record.set('x', x);
  record.set('y', y);
  record.set('parent', parentId);
  app.save(record);
  return ok({ node: nodeViewOf(app, record) });
}

// nodes.edit — the node editor's Save (MainView.tsx handleSaveEdit: content
// trimmed and required, type from the select) -> AppController updateNode ->
// apiAdapter.ts handleNodeUpdate. Save always writes kind = toPbKind(type), so
// an omitted type re-writes the node's current View type (task/'' -> idea),
// exactly as an untouched Save does. Position, parent and session never change.
function editNode(app, params) {
  const nodeId = idParam(params, 'node_id');
  if (nodeId === '') return badRequest('node_id is required');
  const giveContent = hasParam(params, 'content');
  const giveType = hasParam(params, 'type') && params.type !== '';
  if (!giveContent && !giveType) return badRequest('content or type is required');
  let content = null;
  if (giveContent) {
    content = textParam(params, 'content', 2000);
    if (content.error) return badRequest(content.error);
  }
  const node = findRecord(app, 'nodes', nodeId);
  if (!node) return notFound('node', nodeId);
  const nodeType = typeParam(params, toType(node.getString('kind')));
  if (nodeType.error) return badRequest(nodeType.error);

  if (content) node.set('content', content.value);
  node.set('kind', toKind(nodeType.value));
  app.save(node);
  return ok({ node: nodeViewOf(app, node) });
}

// nodes.expand — the Expand button (MainView.tsx handleExpand ->
// AppController expandNode -> apiAdapter.ts handleNodeExpand): runs
// ops.pb.js nodes.suggest (same prompt, same parsing, children saved as
// 'idea'), then turns each new child into a 'question' and stores its x/y.
function expandNode(app, params) {
  const bridge = require(`${__hooks}/_craftbot_bridge.js`);
  const nodeId = idParam(params, 'node_id');
  if (nodeId === '') return badRequest('node_id is required');
  const node = findRecord(app, 'nodes', nodeId);
  if (!node) return notFound('node', nodeId);
  const session = findRecord(app, 'sessions', node.getString('session'));
  if (!session) return notFound('session', node.getString('session'));

  // Prompt copied from ops.pb.js nodes.suggest.
  const raw = bridge.callLLM(
    'Brainstorm session topic: ' +
      session.get('topic') +
      '\nBranch: ' +
      node.get('content') +
      '\n\nSuggest exactly 3 short, concrete follow-up ideas for this branch. ' +
      'Output ONLY the 3 ideas, one per line, no numbering, max 12 words each.',
    'You are a creative brainstorming partner.',
  );
  if (!raw) return reply(503, { error: AI_UNAVAILABLE });
  const ideas = ideaLines(raw, 3);

  const sessionId = node.getString('session');
  let created = [];
  app.runInTransaction((txApp) => {
    const collection = txApp.findCollectionByNameOrId('nodes');
    const ids = [];
    for (const idea of ideas) {
      const record = new Record(collection);
      record.set('session', sessionId);
      record.set('parent', nodeId);
      record.set('content', idea);
      record.set('kind', 'idea');
      record.set('created_by', 'agent');
      txApp.save(record);
      ids.push(record.id);
    }
    created = pinNew(txApp, sessionId, ids, { kind: 'question' });
  });
  return ok({ node_id: nodeId, created: created });
}

// nodes.ai-answer — the Answer button, shown on question nodes only
// (NodeCard.tsx / TreeView.tsx) -> AppController answerNode -> apiAdapter.ts
// handleNodeAnswer, which refuses non-questions, runs ops.pb.js nodes.answer
// (same prompt; the answer is saved as an 'insight' child) and stores the
// answer's x/y.
function aiAnswer(app, params) {
  const bridge = require(`${__hooks}/_craftbot_bridge.js`);
  const nodeId = idParam(params, 'node_id');
  if (nodeId === '') return badRequest('node_id is required');
  const node = findRecord(app, 'nodes', nodeId);
  if (!node) return notFound('node', nodeId);
  if (toType(node.getString('kind')) !== 'question') {
    return badRequest('Only question nodes can be answered');
  }
  const session = findRecord(app, 'sessions', node.getString('session'));
  if (!session) return notFound('session', node.getString('session'));

  // Prompt copied from ops.pb.js nodes.answer.
  const answer = bridge.callLLM(
    'Brainstorm topic: ' + session.get('topic') +
      '\nQuestion: ' + node.get('content') +
      '\n\nAnswer it in 2-3 sentences, concrete and useful. Output only the answer.',
    'You are a sharp brainstorming partner.',
  );
  if (!answer) return reply(503, { error: AI_UNAVAILABLE });

  const sessionId = node.getString('session');
  let pinned = [];
  app.runInTransaction((txApp) => {
    const record = new Record(txApp.findCollectionByNameOrId('nodes'));
    record.set('session', sessionId);
    record.set('parent', nodeId);
    record.set('content', answer.trim());
    record.set('kind', 'insight');
    record.set('created_by', 'agent');
    txApp.save(record);
    pinned = pinNew(txApp, sessionId, [record.id], null);
  });
  return ok({ node_id: nodeId, answer: pinned.length > 0 ? pinned[0] : null });
}

// apiAdapter.ts exploreFrontier: where AI Explore starts. The chosen start
// node alone; otherwise (Auto) every branch tip — a node with no children —
// shallowest first, oldest first within a depth. An empty session starts
// from '' (a step with no branch adds new top-level angles).
function exploreFrontier(items, startId) {
  if (startId !== '') return [startId];
  const parents = new Set();
  for (const it of items) if (it.parent) parents.add(it.parent);
  const tips = items
    .map((it, index) => ({ it: it, index: index }))
    .filter((t) => !parents.has(t.it.id))
    .sort((a, b) => a.it.depth - b.it.depth || a.index - b.index)
    .map((t) => t.it.id);
  return tips.length > 0 ? tips : [''];
}

// One AI Explore step: ops.pb.js sessions.explore (same prompt, same parsing;
// up to 4 'idea' nodes under the branch, or, with no branch, under the first
// parentless node or parentless when there is none), then each new node's x/y
// stored, as the View does after every step (apiAdapter.ts
// handleSessionExplore). Returns the new nodes, or null when the model gave
// no answer.
function exploreStep(app, bridge, session, branchId, strategy) {
  const sessionId = session.id;
  const records = Array.from(
    app.findRecordsByFilter('nodes', 'session = {:session}', 'created', 0, 0, { session: sessionId }),
  );
  const branch = branchId === '' ? null : records.filter((r) => r.id === branchId)[0] || null;
  if (branchId !== '' && !branch) return null;
  const roots = records.filter((r) => !r.get('parent'));
  const existing = records.map((r) => '- ' + r.get('content')).join('\n');
  // Prompt copied from ops.pb.js sessions.explore.
  let ask = 'Propose 4 NEW angles not already covered.';
  if (branch && strategy === 'dfs') {
    ask = 'Branch to explore: ' + branch.get('content') +
      '\n\nGo deep: propose 4 NEW ideas that drill further into this branch, more specific than it and not already covered.';
  } else if (branch) {
    ask = 'Branch to explore: ' + branch.get('content') +
      '\n\nGo broad: propose 4 NEW angles on this branch, side by side and not already covered.';
  }
  const raw = bridge.callLLM(
    'Brainstorm topic: ' + session.get('topic') +
      '\nExisting ideas:\n' + existing +
      '\n\n' + ask + ' One per line, no numbering, max 12 words each.',
    'You are a lateral-thinking brainstorming partner.',
  );
  if (!raw) return null;
  const ideas = ideaLines(raw, 4);
  const parentId = branch ? branch.id : roots[0] ? roots[0].id : '';

  let created = [];
  app.runInTransaction((txApp) => {
    const collection = txApp.findCollectionByNameOrId('nodes');
    const ids = [];
    for (const idea of ideas) {
      const record = new Record(collection);
      record.set('session', sessionId);
      if (parentId !== '') record.set('parent', parentId);
      record.set('content', idea);
      record.set('kind', 'idea');
      record.set('created_by', 'agent');
      txApp.save(record);
      ids.push(record.id);
    }
    created = pinNew(txApp, sessionId, ids, null);
  });
  return created;
}

// sessions.ai-explore — the AI Explore dialog's Start Exploring (MainView.tsx
// startExplore -> AppController exploreSession -> apiAdapter.ts
// handleSessionExplore) with its three choices: `effort` steps (2, 3 or 5),
// one model call each; the frontier starts at the chosen node, or (Auto) at
// every branch tip; breadth-first ('bfs') takes the oldest frontier entry
// next, depth-first ('dfs') the newest, and each step's new nodes join the
// frontier. It stops early when the frontier runs out or a later step gets
// no answer from the model.
function aiExplore(app, params) {
  const bridge = require(`${__hooks}/_craftbot_bridge.js`);
  const sessionId = idParam(params, 'session_id');
  if (sessionId === '') return badRequest('session_id is required');
  const strategy = hasParam(params, 'strategy') && params.strategy !== '' ? String(params.strategy) : 'bfs';
  if (EXPLORE_STRATEGIES.indexOf(strategy) < 0) return badRequest('strategy must be bfs or dfs');
  const effort = hasParam(params, 'effort') && params.effort !== '' ? Number(params.effort) : 3;
  if (EXPLORE_EFFORTS.indexOf(effort) < 0) return badRequest('effort must be 2, 3 or 5');
  const session = findRecord(app, 'sessions', sessionId);
  if (!session) return notFound('session', sessionId);
  const startId = idParam(params, 'start_node_id');
  if (startId !== '') {
    const start = findRecord(app, 'nodes', startId);
    if (!start || start.getString('session') !== sessionId) return notFound('node', startId);
  }

  const frontier = exploreFrontier(layout(app, sessionId).nodes, startId);
  const steps = [];
  const created = [];
  for (let i = 0; i < effort && frontier.length > 0; i++) {
    const branchId = strategy === 'bfs' ? frontier.shift() : frontier.pop();
    const fresh = exploreStep(app, bridge, session, branchId, strategy);
    if (fresh === null) {
      if (steps.length === 0) return reply(503, { error: AI_UNAVAILABLE });
      break;
    }
    steps.push({ node_id: branchId || null, created: fresh.map((n) => n.id) });
    for (const n of fresh) {
      created.push(n);
      frontier.push(n.id);
    }
  }
  const out = {
    session_id: sessionId,
    strategy: strategy,
    effort: effort,
    start_node_id: startId || null,
    steps: steps,
    created: created,
  };
  // The View's toast when nothing new appeared (MainView.tsx startExplore).
  if (created.length === 0) out.message = 'Nothing left to explore';
  return ok(out);
}

// nodes.delete — the delete button and its confirm dialog ("This will delete
// the node and all its descendants.", MainView.tsx confirmDelete) ->
// AppController deleteNode -> apiAdapter.ts handleNodeDelete: one record
// delete; PocketBase removes the subtree through `parent`'s cascadeDelete. The
// subtree is listed first so the agent learns what went.
function deleteNode(app, params) {
  const nodeId = idParam(params, 'node_id');
  if (nodeId === '') return badRequest('node_id is required');
  const node = findRecord(app, 'nodes', nodeId);
  if (!node) return notFound('node', nodeId);

  const ids = [];
  const seen = new Set();
  const queue = [node.id];
  let head = 0;
  while (head < queue.length) {
    const id = queue[head];
    head += 1;
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    const children = Array.from(
      app.findRecordsByFilter('nodes', 'parent = {:parent}', 'created', 0, 0, { parent: id }),
    );
    for (const child of children) queue.push(child.id);
  }

  app.delete(node);
  return ok({ deleted: ids.length, ids: ids });
}

// Route wrapper: run one operation, answer an unexpected failure (a save
// PocketBase refuses, an LLM outage mid-way) as 500 in the app's error shape.
function run(e, operation) {
  try {
    return operation(e.app, paramsOf(e));
  } catch (err) {
    console.error('[brainstorm-graph] agent operation failed:', err);
    return reply(500, { error: String((err && err.message) || err) });
  }
}

module.exports = {
  run: run,
  getSession: getSession,
  createSession: createSession,
  addNode: addNode,
  editNode: editNode,
  expandNode: expandNode,
  aiAnswer: aiAnswer,
  aiExplore: aiExplore,
  deleteNode: deleteNode,
  // Exposed for parity checks against apiAdapter.ts.
  layout: layout,
  childPositions: childPositions,
  exploreFrontier: exploreFrontier,
  toKind: toKind,
  toType: toType,
};
