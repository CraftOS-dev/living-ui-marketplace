/// <reference path="../pb_data/types.d.ts" />
/**
 * Who is calling. This app has one researcher and no sign-in (it binds to
 * this machine): a caller is the person, unless it presents the app's agent
 * token (X-A2App-Token, which the agent-app CLI sends and pages never see),
 * which makes it your AI agent.
 *
 * Your AI agent may read and capture; what it judges is stored as
 * agent_proposed (handlers do this); operations marked agent 'deny' are for
 * people only (settings, confirming, confidentiality); 'propose' turns its
 * call into a proposal a person approves (lib_agent.proposeOrRun).
 */

function header(e, name) {
  try {
    return String(e.request.header.get(name) || '');
  } catch {
    return '';
  }
}

/** True when the caller presents the app's agent token (constant-time compare). */
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

/** The context every handler receives. */
function context(e, spec) {
  const agent = isAgent(e);
  const ctx = { e: e, app: e.app, op: spec.name, isAgent: agent, actor: agent ? 'agent' : 'person', batch: '' };
  if (agent && spec.agent === 'deny') {
    throw require(`${__hooks}/lib_util.js`).fail(403, 'Your AI agent cannot run ' + spec.name + ': a person does this in the app. Tell them what to do instead.', 'agent_not_permitted');
  }
  return ctx;
}

/** A context for jobs and hooks (no request). */
function system(app) {
  return { e: null, app: app, op: '', isAgent: false, actor: 'system', batch: '' };
}

module.exports = { isAgent: isAgent, context: context, system: system };
