/// <reference path="../pb_data/types.d.ts" />
/**
 * AGENT HOOKS — custom verbs beyond CRUD live here (spec B3/D4).
 * Every route here must have a matching entry in operations.json (the gate
 * enforces it) so any agent can discover it via GET /api/_ops.
 *
 * NOTE: routerAdd handlers run in ISOLATED contexts — helpers must be
 * defined inside the handler (or require()d), never top-level.
 */

// READING A REQUEST BODY — the ONLY correct way in PB hooks:
//   const data = e.requestInfo().body;   // pre-parsed object
// NEVER use e.request.body / toString(e.request.body): that is a Go stream
// and reads as EMPTY, so your param checks will 400 on every request.

// sessions.summarize — AI summary of the whole session via the CraftBot
// LLM bridge (returns 503 when running outside CraftBot).
routerAdd('POST', '/api/ops/sessions/summarize', (e) => {
  const bridge = require(`${__hooks}/_craftbot_bridge.js`);
  const sessionId = String((e.requestInfo().body || {}).session_id || '');
  if (sessionId === '') return e.json(400, { error: 'session_id is required' });
  let session;
  try {
    session = e.app.findRecordById('sessions', sessionId);
  } catch (_) {
    return e.json(404, { error: 'session not found: ' + sessionId });
  }
  const records = e.app.findRecordsByFilter('nodes', `session = "${sessionId}"`, 'created', 0, 0);
  const lines = records.map(
    (r) => '- [' + (r.get('kind') || 'idea') + '] ' + r.get('content'),
  );
  const summary = bridge.callLLM(
    'Summarize this brainstorm session titled "' +
      session.get('title') +
      '" (topic: ' +
      session.get('topic') +
      ') in 3-5 crisp bullet points, ending with one suggested next step.\n\nNodes:\n' +
      lines.join('\n'),
    'You are a concise brainstorming facilitator.',
  );
  if (!summary) {
    return e.json(503, { error: 'AI is unavailable (app not running inside CraftBot)' });
  }
  return e.json(200, { summary: summary });
});

// nodes.suggest — AI-generated child ideas for a node (LLM bridge).
routerAdd('POST', '/api/ops/nodes/suggest', (e) => {
  const bridge = require(`${__hooks}/_craftbot_bridge.js`);
  const nodeId = String((e.requestInfo().body || {}).node_id || '');
  if (nodeId === '') return e.json(400, { error: 'node_id is required' });
  let node;
  try {
    node = e.app.findRecordById('nodes', nodeId);
  } catch (_) {
    return e.json(404, { error: 'node not found: ' + nodeId });
  }
  const session = e.app.findRecordById('sessions', node.get('session'));
  const raw = bridge.callLLM(
    'Brainstorm session topic: ' +
      session.get('topic') +
      '\nBranch: ' +
      node.get('content') +
      '\n\nSuggest exactly 3 short, concrete follow-up ideas for this branch. ' +
      'Output ONLY the 3 ideas, one per line, no numbering, max 12 words each.',
    'You are a creative brainstorming partner.',
  );
  if (!raw) {
    return e.json(503, { error: 'AI is unavailable (app not running inside CraftBot)' });
  }
  const ideas = raw
    .split('\n')
    .map((line) => line.replace(/^[-*\d.\s]+/, '').trim())
    .filter((line) => line !== '')
    .slice(0, 3);
  const collection = e.app.findCollectionByNameOrId('nodes');
  const created = [];
  for (const idea of ideas) {
    const record = new Record(collection);
    record.set('session', node.get('session'));
    record.set('parent', nodeId);
    record.set('content', idea);
    record.set('kind', 'idea');
    e.app.save(record);
    created.push(idea);
  }
  return e.json(200, { created: created });
});

// nodes.answer — AI answers a question node, attaching the answer as an
// 'insight' child (LLM bridge).
routerAdd('POST', '/api/ops/nodes/answer', (e) => {
  const bridge = require(`${__hooks}/_craftbot_bridge.js`);
  const nodeId = String((e.requestInfo().body || {}).node_id || '');
  if (nodeId === '') return e.json(400, { error: 'node_id is required' });
  let node;
  try {
    node = e.app.findRecordById('nodes', nodeId);
  } catch (_) {
    return e.json(404, { error: 'node not found: ' + nodeId });
  }
  const session = e.app.findRecordById('sessions', node.get('session'));
  const answer = bridge.callLLM(
    'Brainstorm topic: ' + session.get('topic') +
      '\nQuestion: ' + node.get('content') +
      '\n\nAnswer it in 2-3 sentences, concrete and useful. Output only the answer.',
    'You are a sharp brainstorming partner.',
  );
  if (!answer) {
    return e.json(503, { error: 'AI is unavailable (app not running inside CraftBot)' });
  }
  const collection = e.app.findCollectionByNameOrId('nodes');
  const record = new Record(collection);
  record.set('session', node.get('session'));
  record.set('parent', nodeId);
  record.set('content', answer.trim());
  record.set('kind', 'insight');
  e.app.save(record);
  return e.json(200, { answer: answer.trim() });
});

// sessions.explore — AI grows the whole session: proposes new top-level
// branches from the topic and the ideas already present (LLM bridge).
routerAdd('POST', '/api/ops/sessions/explore', (e) => {
  const bridge = require(`${__hooks}/_craftbot_bridge.js`);
  const sessionId = String((e.requestInfo().body || {}).session_id || '');
  if (sessionId === '') return e.json(400, { error: 'session_id is required' });
  let session;
  try {
    session = e.app.findRecordById('sessions', sessionId);
  } catch (_) {
    return e.json(404, { error: 'session not found: ' + sessionId });
  }
  const records = e.app.findRecordsByFilter('nodes', `session = "${sessionId}"`, 'created', 0, 0);
  const roots = records.filter((r) => !r.get('parent'));
  const existing = records.map((r) => '- ' + r.get('content')).join('\n');
  const raw = bridge.callLLM(
    'Brainstorm topic: ' + session.get('topic') +
      '\nExisting ideas:\n' + existing +
      '\n\nPropose 4 NEW angles not already covered. One per line, no numbering, max 12 words each.',
    'You are a lateral-thinking brainstorming partner.',
  );
  if (!raw) {
    return e.json(503, { error: 'AI is unavailable (app not running inside CraftBot)' });
  }
  const ideas = raw
    .split('\n')
    .map((line) => line.replace(/^[-*\d.\s]+/, '').trim())
    .filter((line) => line !== '')
    .slice(0, 4);
  const collection = e.app.findCollectionByNameOrId('nodes');
  const parentId = roots[0] ? roots[0].id : '';
  const created = [];
  for (const idea of ideas) {
    const record = new Record(collection);
    record.set('session', sessionId);
    if (parentId !== '') record.set('parent', parentId);
    record.set('content', idea);
    record.set('kind', 'idea');
    e.app.save(record);
    created.push(idea);
  }
  return e.json(200, { created: created });
});

// sessions.outline — the full node tree of a session as indented text
// (lets any agent read a brainstorm at a glance).
routerAdd('GET', '/api/ops/sessions/outline', (e) => {
  const sessionId = String(e.requestInfo().query.session_id || '');
  if (sessionId === '') {
    return e.json(400, { error: 'session_id query param required' });
  }
  let session;
  try {
    session = e.app.findRecordById('sessions', sessionId);
  } catch (_) {
    return e.json(404, { error: 'session not found: ' + sessionId });
  }
  const records = e.app.findRecordsByFilter('nodes', `session = "${sessionId}"`, 'created', 0, 0);
  const children = {};
  const roots = [];
  for (const record of records) {
    const parent = record.get('parent');
    if (parent) {
      (children[parent] = children[parent] || []).push(record);
    } else {
      roots.push(record);
    }
  }
  const lines = [];
  const walk = (record, depth) => {
    lines.push('  '.repeat(depth) + '- [' + (record.get('kind') || 'idea') + '] ' + record.get('content'));
    for (const child of children[record.id] || []) walk(child, depth + 1);
  };
  for (const root of roots) walk(root, 0);
  return e.json(200, {
    title: session.get('title'),
    topic: session.get('topic'),
    nodes: records.length,
    outline: lines.join('\n'),
  });
});
