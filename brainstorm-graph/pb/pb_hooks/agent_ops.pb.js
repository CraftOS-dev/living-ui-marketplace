/// <reference path="../pb_data/types.d.ts" />
/**
 * AGENT OPERATIONS — what a person does in the View, offered to agents.
 * Each route has a matching entry in operations.json (the gate enforces it).
 * The logic lives in lib_agent.js, which ports the View's own data layer
 * (frontend/src/app/services/apiAdapter.ts) and the AI prompts of ops.pb.js.
 *
 * NOTE: routerAdd handlers run in ISOLATED contexts — every handler require()s
 * what it needs itself, never through a top-level binding.
 */

// sessions.get — one session as the View shows it (read-only).
routerAdd('GET', '/api/ops/sessions/get', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  const out = lib.run(e, lib.getSession);
  return e.json(out.status, out.body);
});

// sessions.create — the New Brainstorm Session dialog.
routerAdd('POST', '/api/ops/sessions/create', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  const out = lib.run(e, lib.createSession);
  return e.json(out.status, out.body);
});

// sessions.ai-explore — the AI Explore button (LLM bridge).
routerAdd('POST', '/api/ops/sessions/ai-explore', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  const out = lib.run(e, lib.aiExplore);
  return e.json(out.status, out.body);
});

// nodes.add — the Add node dialog.
routerAdd('POST', '/api/ops/nodes/add', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  const out = lib.run(e, lib.addNode);
  return e.json(out.status, out.body);
});

// nodes.edit — the node editor's Save.
routerAdd('POST', '/api/ops/nodes/edit', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  const out = lib.run(e, lib.editNode);
  return e.json(out.status, out.body);
});

// nodes.expand — the Expand button (LLM bridge).
routerAdd('POST', '/api/ops/nodes/expand', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  const out = lib.run(e, lib.expandNode);
  return e.json(out.status, out.body);
});

// nodes.ai-answer — the Answer button on question nodes (LLM bridge).
routerAdd('POST', '/api/ops/nodes/ai-answer', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  const out = lib.run(e, lib.aiAnswer);
  return e.json(out.status, out.body);
});

// nodes.delete — delete a node and its descendants (destructive).
routerAdd('POST', '/api/ops/nodes/delete', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  const out = lib.run(e, lib.deleteNode);
  return e.json(out.status, out.body);
});
