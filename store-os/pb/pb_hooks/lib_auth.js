/// <reference path="../pb_data/types.d.ts" />
/**
 * Who is calling. The app binds to this machine and has no sign-in: a caller
 * is you (the seller), unless it presents the app's agent token
 * (X-A2App-Token, which the agent-app CLI sends and pages never see), which
 * makes it your AI agent. Operations marked agent 'deny' are yours only
 * (approving changes, deleting a shop, your AI agent's limits).
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
    throw require(`${__hooks}/lib_util.js`).fail(403, 'Your AI agent cannot run ' + spec.name + ': the seller does this in the app' + (spec.press ? ', with ' + spec.press : '') + '. Tell them.', 'agent_not_permitted', { press: spec.press || '' });
  }
  return { e: e, app: e.app, op: spec.name, isAgent: agent, actor: agent ? 'agent' : 'person' };
}

/** A context for background jobs (no request). */
function system(app) {
  return { e: null, app: app, op: '', isAgent: false, actor: 'system' };
}

/** A context for applying an approved change: the seller's approval runs it. */
function approved(app) {
  return { e: null, app: app, op: '', isAgent: false, actor: 'person', approved: true };
}

module.exports = { isAgent: isAgent, context: context, system: system, approved: approved };
