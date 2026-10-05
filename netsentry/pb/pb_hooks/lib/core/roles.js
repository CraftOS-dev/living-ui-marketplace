/**
 * PURE — who may run which operation.
 *
 * Actors: a signed-in user (role admin | analyst | viewer), the agent (acts
 * with analyst rights), a sensor (may only check in and report), or the
 * system scheduler. HUMAN_ONLY operations are
 * refused for the agent regardless of the credential it holds — the agent may
 * operate the console but never govern it.
 */

// auditor: reads everything and the reports, changes nothing (organisations, plan §12.1).
const LEVEL = { auditor: 1, viewer: 1, analyst: 2, admin: 3 };
const AGENT_ROLE = 'analyst';

const MIN_ROLE = {
  'assets.rescan': 'analyst',
  'assets.retire': 'analyst',
  'assets.delete': 'admin',
  'assets.timeline': 'viewer',
  'findings.acknowledge': 'analyst',
  'findings.resolve': 'analyst',
  'findings.suppress': 'analyst',
  'findings.unsuppress': 'analyst',
  'findings.explain': 'viewer',
  'posture.overview': 'viewer',
  'sources.run-now': 'analyst',
  'sources.set-enabled': 'admin',
  'rules.configure': 'admin',
  'members.set-role': 'admin',
  'settings.update': 'admin',
  'audit.verify-chain': 'admin',
  'audit.export': 'admin',
  'retention.prune': 'admin',
  'incidents.untriaged': 'viewer',
  'incidents.context': 'viewer',
  'incidents.triage': 'analyst',
  'incidents.request-triage': 'analyst',
  'incidents.set-status': 'analyst',
  'incidents.assign': 'analyst',
  'incidents.add-note': 'analyst',
  'notifiers.create': 'admin',
  'notifiers.update': 'admin',
  'notifiers.delete': 'admin',
  'notifiers.test': 'admin',
  'digest.preview': 'viewer',
  'digest.send-now': 'admin',
  'sensors.install-info': 'admin',
  'sensors.register': 'admin',
  'sensors.revoke': 'admin',
  'sensors.checkin': 'sensor',
  'sensors.live': 'sensor',
  'sensors.report': 'sensor',
  'baselines.accept-listeners': 'analyst',
  'remediations.suggest': 'viewer',
  'remediations.queue': 'viewer',
  'remediations.request-plan': 'analyst',
  'remediations.plan': 'analyst',
  'remediations.approve': 'admin',
  'remediations.reject': 'admin',
  'remediations.claim': 'analyst',
  'remediations.report-step': 'analyst',
  'remediations.complete': 'analyst',
  'remediations.fail': 'analyst',
  'remediations.mark-manual': 'analyst',
  'remediations.cancel': 'analyst',
  'agent.access-report': 'analyst',
  'agent.presence': 'viewer',
  'activity.stats': 'viewer',
  'catalogue.list': 'viewer',
  'fixes.monitor-report': 'sensor',
  'sensors.logs-reply': 'sensor',
  'detections.verdict': 'analyst',
  'apps.set-intent': 'analyst',
  'apps.update': 'analyst',
  'metrics.series': 'viewer',
  'changes.request': 'analyst',
  'updates.request': 'analyst',
  'backups.run-now': 'analyst',
  'installs.templates': 'viewer',
  'installs.request': 'analyst',
  'backups.test-now': 'analyst',
  'backups.restore': 'analyst',
  'updates.rollback': 'analyst',
  'updates.set-policy': 'admin',
  'updates.check-now': 'analyst',
  'os.request': 'analyst',
  'windows.save': 'admin',
  'windows.delete': 'admin',
  'changes.confirm': 'analyst',
  'changes.prepare-fix': 'analyst',
  'home.overview': 'viewer',
  'help.ask': 'viewer',
  'help.pending': 'analyst',
  'help.withdraw': 'viewer',
  'help.answer': 'analyst',
  'changes.list': 'viewer',
  'machines.watch': 'viewer',
  // Logs can hold personal data: people who look after the machines, and the agent when asked.
  'logs.request': 'analyst',
  'logs.result': 'analyst',
  'accounts.set-access': 'admin',
  'sensors.create-join-token': 'admin',
  'sensors.revoke-join-token': 'admin',
  'accounts.remove-access': 'admin',
  'accounts.review': 'analyst',
  'accounts.reviews-due': 'viewer',
  'apps.evaluate-now': 'analyst',
  'backups.create-plan': 'analyst',
  'backups.new-link': 'analyst',
  'backups.delete-plan': 'analyst',
  // v4 N2–N4: every change is confirmed by an admin (changes.confirm); these prepare or look
  'changes.undo': 'admin',
  'files.stage-upload': 'admin',
  'sensors.transfer-put': 'sensor',
  'server.read': 'analyst',
  'server.read-result': 'analyst',
  'sensors.read-reply': 'sensor',
  'files.save': 'admin',
  'files.new-folder': 'admin',
  'files.rename': 'admin',
  'files.delete': 'admin',
  'files.upload': 'admin',
  'apps.settings-save': 'admin',
  'apps.compose-save': 'admin',
  'apps.remove': 'analyst',
  'installs.request-custom': 'analyst',
  'disk.cleanup': 'analyst',
  'processes.stop': 'analyst',
  'firewall.change': 'analyst',
  'keys.add': 'analyst',
  'keys.remove': 'analyst',
  'schedules.set': 'analyst',
  'schedules.create': 'analyst',
  'schedules.delete': 'analyst',
  'remote.tailscale-install': 'analyst',
  'commands.prepare': 'analyst',
  'terminal.open': 'admin',
  'terminal.input': 'admin',
  'terminal.resize': 'admin',
  'terminal.close': 'admin',
  'terminal.sessions': 'admin',
  'terminal.transcript': 'admin',
  'sensors.terminal-exchange': 'sensor',
};

const HUMAN_ONLY = {
  // a question to the agent is a person's (the agent asking itself would loop)
  'help.ask': true,
  'help.withdraw': true,
  // undoing a change is a person's decision, like confirming one
  'changes.undo': true,
  'files.stage-upload': true,
  // v4 N-B12/N-B20: file contents, app settings and the terminal are people's, never the agent's
  'files.save': true,
  'files.new-folder': true,
  'files.rename': true,
  'files.delete': true,
  'files.upload': true,
  'apps.settings-save': true,
  'apps.compose-save': true,
  'terminal.open': true,
  'terminal.input': true,
  'terminal.resize': true,
  'terminal.close': true,
  'terminal.transcript': true,
  // what NetSentry may scan is a person's consent (plan §10.2 step 3), never the agent's
  // a key into another app is a person's decision (D12)
  'accounts.set-access': true,
  // what would silence an alert is a person's decision, never the agent's (security review 2026-09-30):
  // a fake heartbeat link, "reviewed", "expected"/"it's ours", or "it's fine"
  'backups.create-plan': true,
  'backups.new-link': true,
  'backups.delete-plan': true,
  'accounts.review': true,
  'detections.verdict': true,
  'findings.suppress': true,
  // new monitors on the organisation's machines: a person's decision
  'sensors.create-join-token': true,
  'members.set-role': true,
  'settings.update': true,
  'rules.configure': true,
  'retention.prune': true,
  // Alert destinations are secrets and decide who gets told — people only.
  'notifiers.create': true,
  'notifiers.update': true,
  'notifiers.delete': true,
  'notifiers.test': true,
  // Sensors are credentials to a machine's view of itself — people decide who gets one.
  'sensors.register': true,
  'sensors.revoke': true,
  // The agent may plan and execute fixes; only a person may approve or reject them.
  'remediations.approve': true,
  // v3 M2: a person confirms every start / stop / restart (D13); the agent may only ask for one.
  'changes.confirm': true,
  // a standing "update it in my window" is a person's confirmation made once (V3-D3) — never the agent's
  'updates.set-policy': true,
  'windows.save': true,
  'windows.delete': true,
  'remediations.reject': true,
};

/** @returns null when allowed, else a human-readable refusal. */
function authorize(actor, op) {
  const need = MIN_ROLE[op];
  if (!need) return `Unknown operation "${op}".`;
  if (!actor) return 'Sign in to use NetSentry.';
  if (actor.type === 'system') return null;
  // Sensors may do exactly two things, and only sensors may do them.
  if (need === 'sensor') return actor.type === 'sensor' ? null : 'Only a registered NetSentry sensor can call this.';
  if (actor.type === 'sensor') return 'Sensors can only check in and report.';
  if (actor.type === 'agent') {
    if (HUMAN_ONLY[op]) return `"${op}" can only be done by a person (signed in to NetSentry), never by the agent.`;
    return LEVEL[AGENT_ROLE] >= LEVEL[need] ? null : `The agent is not allowed to run "${op}".`;
  }
  const have = LEVEL[actor.role] || 0;
  if (have >= LEVEL[need]) return null;
  return `Your role (${actor.role || 'none'}) cannot do this — it needs ${need}.`;
}

module.exports = { authorize, MIN_ROLE, HUMAN_ONLY, LEVEL };
