/// <reference path="../pb_data/types.d.ts" />
/**
 * AGENT HOOKS — custom verbs beyond plain collection CRUD live here (spec B3).
 * Every route added here MUST have a matching entry in operations.json (the
 * gate enforces it) so any agent can discover it via GET /api/_ops.
 *
 * Word Improve is a git-style prose-merge tool. Sessions/variants/segments are
 * plain collection records (the fetch adapter does all the sentence-splitting,
 * alignment, and word-diff CLIENT-SIDE). The ONLY thing the browser can't do is
 * reach the configured LLM provider — that lives behind the server-side
 * CraftBot bridge — so exactly two server verbs exist here:
 *   - ai.generate          run one prompt through the bridge, return raw text
 *   - integrations.status  is the bridge configured? (honest LLM banner)
 *
 * NOTE: routerAdd handlers run in ISOLATED contexts — shared helpers must be
 * require()d inside each handler, never referenced from this file's scope.
 * Read the request body with e.requestInfo().body (never e.request.body).
 */

// ai.generate — one LLM call via the CraftBot bridge. Returns the raw text
// (empty string when the app runs outside CraftBot); the client falls back to
// stub variants on empty output, exactly like the V1 backend did.
routerAdd('POST', '/api/ops/ai/generate', (e) => {
  const bridge = require(`${__hooks}/_craftbot_bridge.js`);
  const body = e.requestInfo().body || {};
  const prompt = String(body.prompt || '');
  const system = String(body.system || '');
  if (prompt === '') {
    return e.json(400, { error: 'prompt is required' });
  }
  const raw = bridge.callLLM(prompt, system);
  return e.json(200, { text: raw || '' });
});

// integrations.status — whether the CraftBot LLM bridge is configured, so the
// frontend can show an honest LLM-available banner (the browser itself has no
// way to see these env vars).
routerAdd('GET', '/api/ops/integrations/status', (e) => {
  const configured = !!($os.getenv('CRAFTBOT_BRIDGE_URL') && $os.getenv('CRAFTBOT_BRIDGE_TOKEN'));
  return e.json(200, { llmAvailable: configured });
});
