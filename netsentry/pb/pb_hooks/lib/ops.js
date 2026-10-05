/**
 * Operation dispatcher — the one place that turns an HTTP request into a
 * service call: resolve the actor, authorize, read params, run, map errors.
 * Route files stay one line per operation (see ops.pb.js).
 */
const { resolveActor } = require('./infra/actor.js');
const { authorize } = require('./core/roles.js');
const repo = require('./infra/repo.js');
const assets = require('./services/assets.js');
const findings = require('./services/findings.js');
const workspace = require('./services/workspace.js');
const pipeline = require('./services/pipeline.js');
const audit = require('./services/audit.js');
const incidents = require('./services/incidents.js');
const alerts = require('./services/alerts.js');
const bell = require('./services/agentbell.js');
const sensors = require('./services/sensors.js');
const remediations = require('./services/remediations.js');
const { OpError } = require('./core/util.js');

const SCAN_BUDGET_MS = 25000;

function need(p, key) {
  const v = p[key];
  if (v === undefined || v === null || String(v).trim() === '') throw new OpError(400, `Missing required parameter "${key}".`);
  return String(v).trim();
}

const OPS = {
  'assets.rescan': (app, actor, p) => {
    const a = assets.requireAsset(app, need(p, 'asset_id'));
    if (a.getString('status') !== 'active') throw new OpError(409, 'Reactivate the asset before scanning it.');
    audit.append(app, actor, 'asset.rescanned', { collection: 'assets', id: a.id }, `Manual scan of ${a.getString('identifier')}`, null);
    const scanned = pipeline.scanAsset(app, a.id, SCAN_BUDGET_MS);
    // A machine's own checks run on the machine: ask its monitor to run them all now.
    const monitor = a.getString('kind') === 'host' ? sensors.requestRun(app, a.id) : null;
    return Object.assign({ ok: true, asset_id: a.id, monitor }, scanned);
  },
  'assets.retire': (app, actor, p) => assets.setStatus(app, actor, { asset_id: need(p, 'asset_id'), reason: p.reason }, 'retired'),
  'assets.reactivate': (app, actor, p) => assets.setStatus(app, actor, { asset_id: need(p, 'asset_id') }, 'active'),
  'assets.delete': (app, actor, p) => assets.remove(app, actor, { asset_id: need(p, 'asset_id') }),
  'assets.impact': (app, _actor, p) => assets.impact(app, { asset_id: need(p, 'asset_id') }),
  'assets.timeline': (app, _actor, p) => assets.timeline(app, p),
  'findings.acknowledge': (app, actor, p) => findings.transition(app, actor, 'acknowledge', { finding_id: need(p, 'finding_id'), note: p.note }),
  'findings.resolve': (app, actor, p) => findings.transition(app, actor, 'resolve', { finding_id: need(p, 'finding_id'), note: p.note }),
  'findings.suppress': (app, actor, p) =>
    findings.transition(app, actor, 'suppress', { finding_id: need(p, 'finding_id'), reason: p.reason, until: p.until }),
  'findings.unsuppress': (app, actor, p) => findings.transition(app, actor, 'unsuppress', { finding_id: need(p, 'finding_id'), note: p.note }),
  'findings.explain': (app, _actor, p) => findings.explain(app, { finding_id: need(p, 'finding_id') }),
  'posture.overview': (app) => workspace.overview(app),
  'activity.stats': (app, actor, p) => require('./services/activity.js').stats(app, p),
  'sources.run-now': (app, actor, p) => {
    const s = repo.byId(app, 'sources', need(p, 'source_id'));
    if (!s) throw new OpError(404, 'Source not found.', 'not_found');
    if (!s.getBool('enabled')) throw new OpError(409, 'Enable the source before running it.');
    const r = pipeline.runSource(app, s, 'manual');
    audit.append(app, actor, 'source.run', { collection: 'sources', id: s.id }, `Ran ${s.getString('collector')} manually (${r.status})`, null);
    return Object.assign({ ok: r.status !== 'error', source_id: s.id }, r);
  },
  'sources.set-enabled': (app, actor, p) => workspace.setSourceEnabled(app, actor, { source_id: need(p, 'source_id'), enabled: p.enabled }),
  'rules.configure': (app, actor, p) => workspace.configureRule(app, actor, Object.assign({}, p, { rule_id: need(p, 'rule_id') })),
  'members.set-role': (app, actor, p) => workspace.setRole(app, actor, { user_id: need(p, 'user_id'), role: need(p, 'role') }),
  'settings.update': (app, actor, p) => workspace.updateSettings(app, actor, p),
  'audit.verify-chain': (app) => Object.assign({ ok: true }, audit.verify(app)),
  'audit.export': (app, actor, p) => audit.exportFrom(app, p.from_seq, p.limit),
  'retention.prune': (app, actor) => workspace.prune(app, actor),

  'incidents.untriaged': (app, _actor, p) => incidents.untriaged(app, p),
  'incidents.context': (app, _actor, p) => incidents.context(app, { incident_id: need(p, 'incident_id') }),
  'incidents.triage': (app, actor, p) => incidents.triage(app, actor, Object.assign({}, p, { incident_id: need(p, 'incident_id') })),
  'incidents.request-triage': (app, actor, p) => {
    const inc = incidents.requireIncident(app, need(p, 'incident_id'));
    repo.update(app, inc, { needs_triage: true });
    const r = bell.ring(app, 'triage_queue_ready', {});
    if (r.ok) repo.update(app, inc, { agent_request: r.id });
    incidents.note(app, inc.id, 'event', actor, 'Asked the agent to triage.');
    audit.append(app, actor, 'incident.triage_requested', { collection: 'incidents', id: inc.id }, `Asked the agent to triage "${inc.getString('title')}"`, { fired: r.ok, code: r.code || null });
    return {
      ok: true,
      incident_id: inc.id,
      request_id: r.ok ? r.id : null,
      message: r.ok
        ? 'The agent has been asked. Its summary appears here when it finishes.'
        : r.code === 'cooldown'
          ? 'The agent was asked moments ago; this incident is in its queue.'
          : 'Queued for triage. No agent could be reached right now — it will be picked up when one connects.',
    };
  },
  'incidents.set-status': (app, actor, p) =>
    incidents.setStatus(app, actor, { incident_id: need(p, 'incident_id'), status: need(p, 'status'), note: p.note }),
  'incidents.assign': (app, actor, p) => incidents.assign(app, actor, { incident_id: need(p, 'incident_id'), user_id: p.user_id }),
  'incidents.add-note': (app, actor, p) => incidents.addNote(app, actor, { incident_id: need(p, 'incident_id'), body: p.body }),

  'notifiers.create': (app, actor, p) => alerts.create(app, actor, p),
  'notifiers.update': (app, actor, p) => alerts.update(app, actor, Object.assign({}, p, { notifier_id: need(p, 'notifier_id') })),
  'notifiers.delete': (app, actor, p) => alerts.remove(app, actor, { notifier_id: need(p, 'notifier_id') }),
  'notifiers.test': (app, actor, p) => alerts.test(app, actor, { notifier_id: need(p, 'notifier_id') }),
  'sensors.install-info': () => sensors.installInfo(),
  'sensors.register': (app, actor, p) => sensors.register(app, actor, p),
  'sensors.revoke': (app, actor, p) => sensors.revoke(app, actor, { sensor_id: need(p, 'sensor_id') }),
  'sensors.checkin': (app, actor, p) => sensors.checkin(app, actor, { info: p.info }),
  'sensors.live': (app, actor, p) => sensors.live(app, actor, { sample: p.sample }),
  'sensors.report': (app, actor, p) => sensors.report(app, actor, { payload: p.payload }),
  'baselines.accept-listeners': (app, actor, p) => workspace.acceptListeners(app, actor, { asset_id: need(p, 'asset_id') }),
  'remediations.suggest': (app, _actor, p) => remediations.suggest(app, { finding_id: need(p, 'finding_id') }),
  'remediations.queue': (app, _actor, p) => remediations.queue(app, p),
  'remediations.request-plan': (app, actor, p) => remediations.requestPlan(app, actor, { finding_id: need(p, 'finding_id'), playbook_id: p.playbook_id }),
  'remediations.approve': (app, actor, p) => remediations.approve(app, actor, { remediation_id: need(p, 'remediation_id') }),
  'remediations.reject': (app, actor, p) => remediations.reject(app, actor, { remediation_id: need(p, 'remediation_id'), note: p.note }),
  'remediations.mark-manual': (app, actor, p) => remediations.markManual(app, actor, { remediation_id: need(p, 'remediation_id'), note: p.note }),
  'remediations.cancel': (app, actor, p) => remediations.cancel(app, actor, { remediation_id: need(p, 'remediation_id'), note: p.note }),
  'agent.presence': (app) => remediations.agentPresence(app),
  'fixes.monitor-report': (app, actor, p) => require('./services/fixjobs.js').report(app, actor, p),
  'detections.verdict': (app, actor, p) => require('./services/detections.js').setVerdict(app, actor, { detection_id: need(p, 'detection_id'), verdict: need(p, 'verdict') }),
  'catalogue.list': () => ({
    ok: true,
    apps: require('./v2/catalogue/index.js').ALL.map((e) => ({
      id: e.id, name: e.name, category: e.category, what: e.what, default_intent: e.defaultIntent,
      important: (e.data && e.data.important) || [], skip: (e.data && e.data.skip) || [], sources: e.sources,
      accounts: e.accounts ? { how: e.accounts.how } : null,
    })),
    checks: require('./v2/controls/index.js').ALL.map((c) => ({ id: c.id, title: c.title, outcome: c.outcome, subject: c.subject, references: c.references || [] })),
  }),
  'apps.set-intent': (app, actor, p) => require('./services/apps.js').setIntent(app, actor, { app_id: need(p, 'app_id'), reach: need(p, 'reach') }),
  'sensors.create-join-token': (app, actor, p) => require('./services/enrol.js').createJoinToken(app, actor, p),
  'sensors.revoke-join-token': (app, actor, p) => require('./services/enrol.js').revokeJoinToken(app, actor, { join_token_id: need(p, 'join_token_id') }),
  'accounts.set-access': (app, actor, p) => require('./services/accounts.js').setAccess(app, actor, { app_id: need(p, 'app_id'), token: need(p, 'token') }),
  'accounts.remove-access': (app, actor, p) => require('./services/accounts.js').removeAccess(app, actor, { app_id: need(p, 'app_id') }),
  'accounts.review': (app, actor, p) => require('./services/accounts.js').review(app, actor, { app_id: need(p, 'app_id'), note: p.note }),
  'accounts.reviews-due': (app) => ({ ok: true, due: require('./services/accounts.js').reviewsDue(app, require('./infra/repo.js').nowIso()) }),
  // v3 M5: install an app (services/installs.js).
  'installs.templates': () => require('./services/installs.js').list(),
  'installs.request': (app, actor, p) => require('./services/installs.js').request(app, actor, p),
  // v3 M4: NetSentry's own backups (services/backupjobs.js).
  'backups.run-now': (app, actor, p) => require('./services/backupjobs.js').runNow(app, actor, { app_id: need(p, 'app_id') }),
  'backups.test-now': (app, actor, p) => require('./services/backupjobs.js').testNow(app, actor, { app_id: need(p, 'app_id'), backup_id: p.backup_id }),
  'backups.restore': (app, actor, p) => require('./services/backupjobs.js').restore(app, actor, { app_id: need(p, 'app_id'), backup_id: need(p, 'backup_id') }),
  // v3 M3: updates (services/updates.js).
  'updates.request': (app, actor, p) => require('./services/updates.js').request(app, actor, { app_id: need(p, 'app_id'), to: p.to, anyway: p.anyway === true || p.anyway === 'true' }),
  'updates.rollback': (app, actor, p) => require('./services/updates.js').rollbackRequest(app, actor, { change_id: need(p, 'change_id') }),
  'updates.set-policy': (app, actor, p) => require('./services/updates.js').setPolicy(app, actor, { app_id: need(p, 'app_id'), policy: need(p, 'policy') }),
  'updates.check-now': (app) => ({ ok: true, checked: require('./services/updates.js').refreshIntel(app, null, true) }),
  'os.request': (app, actor, p) => require('./services/updates.js').osRequest(app, actor, { asset_id: need(p, 'asset_id'), what: need(p, 'what'), delay_minutes: p.delay_minutes }),
  'windows.save': (app, actor, p) => require('./services/updates.js').saveWindow(app, actor, p),
  'windows.delete': (app, actor, p) => require('./services/updates.js').deleteWindow(app, actor, { window_id: need(p, 'window_id') }),
  // v3 M2: start / stop / restart and logs (services/changes.js).
  'changes.request': (app, actor, p) => require('./services/changes.js').request(app, actor, p),
  // v4 §5.1: "Ask the agent" from Home (services/help.js)
  'help.ask': (app, actor, p) => require('./services/help.js').ask(app, actor, { question: need(p, 'question') }),
  'help.pending': (app) => require('./services/help.js').pending(app),
  'help.withdraw': (app, actor, p) => require('./services/help.js').withdraw(app, actor, { help_id: need(p, 'help_id') }),
  'help.answer': (app, actor, p) => require('./services/help.js').answer(app, actor, { help_id: need(p, 'help_id'), answer: need(p, 'answer'), remediation_ids: p.remediation_ids }),
  'changes.prepare-fix': (app, actor, p) => require('./services/changes.js').prepareFix(app, actor, { finding_id: need(p, 'finding_id') }),
  'home.overview': (app) => require('./services/home.js').overview(app),
  'changes.confirm': (app, actor, p) => require('./services/changes.js').confirm(app, actor, { remediation_id: need(p, 'remediation_id'), plan_hash: need(p, 'plan_hash') }),
  'changes.list': (app, actor, p) => require('./services/changes.js').list(app, p),
  'machines.watch': (app, actor, p) => require('./services/changes.js').watch(app, { asset_id: need(p, 'asset_id') }),
  'logs.request': (app, actor, p) => require('./services/changes.js').logsRequest(app, actor, p),
  'logs.result': (app, actor, p) => require('./services/changes.js').logsResult(app, { request_id: need(p, 'request_id') }),
  'sensors.logs-reply': (app, actor, p) => require('./services/changes.js').logsReply(app, actor, p),
  // v4 N2–N4 (docs/SYSTEM-V4-PLAN.md §6–§8): looking at the server, everyday and server jobs, the terminal.
  'files.stage-upload': (app, actor, p, e) => require('./services/transfers.js').stageUpload(app, actor, p, e),
  'sensors.transfer-put': (app, actor, p, e) => require('./services/transfers.js').monitorPut(app, actor, p, e),
  'changes.undo': (app, actor, p) => require('./services/changes.js').undo(app, actor, p),
  'server.read': (app, actor, p) => require('./services/serverreads.js').request(app, actor, p),
  'server.read-result': (app, actor, p) => require('./services/serverreads.js').result(app, actor, p),
  'sensors.read-reply': (app, actor, p) => require('./services/serverreads.js').reply(app, actor, p),
  'files.save': (app, actor, p) => require('./services/jobs.js').files.save(app, actor, p),
  'files.new-folder': (app, actor, p) => require('./services/jobs.js').files.newFolder(app, actor, p),
  'files.rename': (app, actor, p) => require('./services/jobs.js').files.rename(app, actor, p),
  'files.delete': (app, actor, p) => require('./services/jobs.js').files.remove(app, actor, p),
  'files.upload': (app, actor, p) => require('./services/jobs.js').files.upload(app, actor, p),
  'apps.settings-save': (app, actor, p) => require('./services/jobs.js').settingsSave(app, actor, p),
  'apps.compose-save': (app, actor, p) => require('./services/jobs.js').composeSave(app, actor, p),
  'apps.remove': (app, actor, p) => require('./services/jobs.js').removeApp(app, actor, p),
  'installs.request-custom': (app, actor, p) => require('./services/jobs.js').installCustom(app, actor, p),
  'disk.cleanup': (app, actor, p) => require('./services/jobs.js').cleanup(app, actor, p),
  'processes.stop': (app, actor, p) => require('./services/jobs.js').stopProcess(app, actor, p),
  'firewall.change': (app, actor, p) => require('./services/jobs.js').firewall(app, actor, p),
  'keys.add': (app, actor, p) => require('./services/jobs.js').addKey(app, actor, p),
  'keys.remove': (app, actor, p) => require('./services/jobs.js').removeKey(app, actor, p),
  'schedules.set': (app, actor, p) => require('./services/jobs.js').schedule(app, actor, p),
  'schedules.create': (app, actor, p) => require('./services/jobs.js').scheduleCreate(app, actor, p),
  'schedules.delete': (app, actor, p) => require('./services/jobs.js').scheduleDelete(app, actor, p),
  'remote.tailscale-install': (app, actor, p) => require('./services/jobs.js').tailscale(app, actor),
  'commands.prepare': (app, actor, p) => require('./services/jobs.js').command(app, actor, p),
  'terminal.open': (app, actor, p) => require('./services/terminal.js').open(app, actor, p),
  'terminal.input': (app, actor, p) => require('./services/terminal.js').input(app, actor, p),
  'terminal.resize': (app, actor, p) => require('./services/terminal.js').resize(app, actor, p),
  'terminal.close': (app, actor, p) => require('./services/terminal.js').close(app, actor, p),
  'terminal.sessions': (app, actor, p) => require('./services/terminal.js').list(app),
  'terminal.transcript': (app, actor, p) => require('./services/terminal.js').transcript(app, p),
  'sensors.terminal-exchange': (app, actor, p) => require('./services/terminal.js').exchange(app, actor, p),
  // v3 M1: a chart's worth of a machine's or an app's numbers.
  'metrics.series': (app, actor, p) => Object.assign({ ok: true }, require('./services/metrics.js').series(app, { asset_id: need(p, 'asset_id'), subject: p.subject, range: p.range })),
  'apps.update': (app, actor, p) => require('./services/apps.js').update(app, actor, Object.assign({}, p, { app_id: need(p, 'app_id') })),
  'apps.evaluate-now': (app, actor, p) => {
    const a = assets.requireAsset(app, need(p, 'asset_id'));
    const r = require('./services/v2.js').evaluateAndAlert(app, a.id);
    return { ok: true, apps: r ? r.apps : 0, results: r ? r.results : 0, failing: r ? r.failing : 0 };
  },
  'backups.create-plan': (app, actor, p) => require('./services/backups.js').createPlan(app, actor, Object.assign({}, p, { asset_id: need(p, 'asset_id'), name: need(p, 'name') })),
  'backups.new-link': (app, actor, p) => require('./services/backups.js').newLink(app, actor, { plan_id: need(p, 'plan_id') }),
  'backups.delete-plan': (app, actor, p) => require('./services/backups.js').deletePlan(app, actor, { plan_id: need(p, 'plan_id') }),
  'digest.preview': (app) => Object.assign({ ok: true }, alerts.buildDigest(app)),
  'digest.send-now': (app, actor) => {
    const d = alerts.buildDigest(app);
    const results = alerts.dispatch(app, d);
    bell.ring(app, 'daily_digest', {});
    audit.append(app, actor, 'digest.sent', null, `Digest sent to ${results.filter((r) => r.ok).length} of ${results.length} notifier(s)`, { results });
    return { ok: true, digest: d, results };
  },
};

// Read-only ops share the viewer role with explain/overview.
const ROLE_ALIAS = { 'assets.reactivate': 'assets.retire', 'assets.impact': 'assets.timeline' };

function handle(e, name) {
  try {
    const actor = resolveActor(e);
    const denied = authorize(actor, ROLE_ALIAS[name] || name);
    if (denied) throw new OpError(actor ? 403 : 401, denied, 'forbidden');
    const info = e.requestInfo();
    const method = String(e.request.method || 'GET').toUpperCase();
    const params = method === 'GET' ? info.query || {} : info.body || {};
    return e.json(200, OPS[name](e.app, actor, params, e)); // e: for the few that take a file (multipart)
  } catch (err) {
    if (err && err.status) return e.json(err.status, { ok: false, error: err.message, message: err.message, code: err.code });
    console.error(`[netsentry] ${name} failed:`, err);
    return e.json(500, { ok: false, error: 'Internal error while running ' + name + ' — see the app log.', message: 'Internal error while running ' + name + ' — see the app log.', detail: String(err) });
  }
}

module.exports = { handle, OPS };
