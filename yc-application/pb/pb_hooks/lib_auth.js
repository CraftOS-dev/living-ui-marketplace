/// <reference path="../pb_data/types.d.ts" />
/**
 * Who is calling. The app binds to this machine and has no sign-in: a caller
 * is the founder, unless it presents the app's agent token (X-A2App-Token,
 * which the agent-app CLI sends and pages never see), which makes it your AI
 * agent. Operations marked agent 'deny' are for the founders only (pressing
 * Submit, confirming an answer, starting your AI agent's work).
 */

function header(e, name) {
  try {
    return String(e.request.header.get(name) || '');
  } catch {
    return '';
  }
}

function isAgent(e) {
  const presented = header(e, 'X-A2App-Token').trim();
  if (presented === '') return false;
  let tok = '';
  try {
    tok = toString($os.readFile($filepath.join(__hooks, '..', '..', '.agent-token'))).trim();
  } catch {
    return false;
  }
  return tok !== '' && $security.equal(presented, tok);
}

function context(e, spec) {
  const agent = isAgent(e);
  if (agent && spec.agent === 'deny') {
    throw require(`${__hooks}/lib_util.js`).fail(403, 'Your AI agent cannot run ' + spec.name + ': a founder does this in the app' + (spec.press ? ', with ' + spec.press : '') + '. Tell them.', 'agent_not_permitted', { press: spec.press || '' });
  }
  return { e: e, app: e.app, op: spec.name, isAgent: agent, actor: agent ? 'agent' : 'person' };
}

/** A context for background jobs (no request). */
function system(app) {
  return { e: null, app: app, op: '', isAgent: false, actor: 'system' };
}

module.exports = { isAgent: isAgent, context: context, system: system };
