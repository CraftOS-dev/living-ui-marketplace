/**
 * PURE — finding lifecycle.
 *
 * Automatic path (a scan evaluated the rule):
 *   state rules  — failing ⇒ open (or kept); passing ⇒ resolved.
 *   event rules  — an event this run ⇒ open (reopens even if acknowledged,
 *                  because it is a NEW event); no event ⇒ no change.
 * Manual path (a person or the agent): acknowledge / resolve / suppress / unsuppress.
 */

const MANUAL = {
  acknowledge: { from: ['open'], to: 'acknowledged' },
  resolve: { from: ['open', 'acknowledged'], to: 'resolved' },
  suppress: { from: ['open', 'acknowledged'], to: 'suppressed' },
  unsuppress: { from: ['suppressed'], to: 'open' },
};

function manualTransition(currentStatus, action) {
  const t = MANUAL[action];
  if (!t) return { error: `Unknown action "${action}".` };
  if (t.from.indexOf(currentStatus) < 0) {
    return { error: `A finding that is ${currentStatus} cannot be ${t.to === 'open' ? 'unsuppressed' : t.to}.` };
  }
  return { status: t.to };
}

/**
 * Decide what a scan does to one finding.
 * @param existing   null | { status }
 * @param failing    boolean — the rule reported this subject this run
 * @param opts       { ruleKind: 'state' | 'event', suppressed: boolean }
 * @returns { action: 'create' | 'touch' | 'reopen' | 'resolve' | 'none', status? }
 */
function reconcile(existing, failing, opts) {
  const eventRule = opts.ruleKind === 'event';
  const target = opts.suppressed ? 'suppressed' : 'open';
  if (!existing) return failing ? { action: 'create', status: target } : { action: 'none' };

  const s = existing.status;
  if (failing) {
    if (s === 'resolved') return { action: 'reopen', status: target };
    if (eventRule && s === 'acknowledged') return { action: 'reopen', status: target };
    if (s === 'suppressed' && !opts.suppressed) return { action: 'reopen', status: 'open' };
    if (s !== 'suppressed' && opts.suppressed) return { action: 'touch', status: 'suppressed' };
    return { action: 'touch', status: s };
  }
  if (eventRule) return { action: 'none' };
  if (s === 'resolved') return { action: 'none' };
  return { action: 'resolve', status: 'resolved' };
}

/* ------------------------------------------------------------ incidents */

const INCIDENT_TRANSITIONS = {
  new: ['investigating', 'mitigated', 'closed', 'false_positive'],
  investigating: ['mitigated', 'closed', 'false_positive'],
  mitigated: ['investigating', 'closed'],
  closed: ['investigating'],
  false_positive: ['investigating'],
};

function incidentTransition(from, to, note) {
  const allowed = INCIDENT_TRANSITIONS[from] || [];
  if (allowed.indexOf(to) < 0) return { error: `An incident that is ${from.replace('_', ' ')} cannot move to ${to.replace('_', ' ')}.` };
  if ((to === 'false_positive' || to === 'closed') && !String(note || '').trim()) {
    return { error: `Add a note explaining why it is ${to === 'closed' ? 'closed' : 'a false positive'}.` };
  }
  return { status: to };
}

module.exports = { manualTransition, reconcile, MANUAL, incidentTransition, INCIDENT_TRANSITIONS };
