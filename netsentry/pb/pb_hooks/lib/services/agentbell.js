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

module.exports = { ring, reringTriageIfWaiting };
