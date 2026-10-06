/**
 * Ringing the agent. Triggers are doorbells: they carry no data beyond ids,
 * and the work queue itself is state in NetSentry's own collections (e.g.
 * incidents.needs_triage). So a refused fire (cooldown, hourly cap, no agent)
 * loses nothing — the next ring, or the agent's own polling, finds the work.
 * The app never reads or writes agent_requests directly; it only fires.
 */

const RERING_MS = 6 * 3600000;

function ring(app, name, params) {
  const r = require(`${__hooks}/_triggers_lib.js`).fire(app, name, params || {}, 'hook');
  if (r.ok) app.store().set('netsentry-rang-' + name, String(Date.now()));
  else if (r.code !== 'cooldown') console.log(`[netsentry] trigger ${name} not fired: ${r.code} ${r.message || ''}`);
  return r;
}

/** Re-ring triage while work is waiting, at most every 6 h (the agent may have been offline). */
function reringTriageIfWaiting(app) {
  const repo = require('../infra/repo.js');
  const waiting = repo.find(app, 'incidents', 'needs_triage = true && (status = "new" || status = "investigating")', {}, '', 1).length;
  if (!waiting) return;
  const last = Number(app.store().get('netsentry-rang-triage_queue_ready') || 0);
  if (Date.now() - last >= RERING_MS) ring(app, 'triage_queue_ready', {});
}

const HELP_RERING_MS = 5 * 60000;
const HELP_FOR_MS = 24 * 3600000;

/**
 * Ask the agent again while a person's question waits (N-B43): it was offline, or CraftBot hadn't been
 * allowed yet to pass NetSentry's requests on — a refused ring is not retried by anyone else.
 */
function reringHelpIfWaiting(app) {
  const repo = require('../infra/repo.js');
  const since = new Date(Date.now() - HELP_FOR_MS).toISOString().replace('T', ' ');
  const waiting = repo.find(app, 'help_requests', 'status = "waiting" && created >= {:s}', { s: since }, '', 1).length;
  if (!waiting) return;
  const last = Number(app.store().get('netsentry-rang-help_requested') || 0);
  if (Date.now() - last >= HELP_RERING_MS) ring(app, 'help_requested', {});
}

module.exports = { ring, reringTriageIfWaiting, reringHelpIfWaiting };
