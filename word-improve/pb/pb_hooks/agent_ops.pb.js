/// <reference path="../pb_data/types.d.ts" />
/**
 * AGENT OPERATIONS — everything a person does in Word Improve, for agents.
 * Every route here has a matching entry in operations.json.
 *
 * The UI does its work in the browser (frontend/src/app/services/apiAdapter.ts)
 * and stores one `sessions` record per run. These routes make the same writes
 * from the server, with the ported engine (lib_agent_text.js) and the app's
 * own LLM bridge (_craftbot_bridge.callLLM, as ai.generate uses it):
 *
 *   sessions.list        the sidebar list                          (read)
 *   sessions.get         one session as the merge view shows it    (read)
 *   sessions.result      the compiled result: text, diff, counts   (read)
 *   sessions.create      the new-session form + Generate variants  (write)
 *   sessions.regenerate  Regenerate / Generate variants            (destructive: drops the picks)
 *   sessions.pick        pick a version / include or skip an addition (write)
 *   sessions.delete      Delete (the UI confirms first)            (destructive)
 *
 * NOTE: routerAdd handlers run in ISOLATED contexts — shared helpers are
 * require()d inside each handler. Params come from e.requestInfo().body.
 */

routerAdd('POST', '/api/ops/sessions/list', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.listSessions(app));
});

routerAdd('POST', '/api/ops/sessions/get', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.getSession(app, p));
});

routerAdd('POST', '/api/ops/sessions/result', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.sessionResult(app, p));
});

routerAdd('POST', '/api/ops/sessions/create', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.createSession(app, p));
});

routerAdd('POST', '/api/ops/sessions/regenerate', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.regenerateSession(app, p));
});

routerAdd('POST', '/api/ops/sessions/pick', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.pickSegments(app, p));
});

routerAdd('POST', '/api/ops/sessions/delete', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.deleteSession(app, p));
});
