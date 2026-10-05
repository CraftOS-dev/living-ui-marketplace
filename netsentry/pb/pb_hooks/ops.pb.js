/// <reference path="../pb_data/types.d.ts" />
/**
 * AGENT HOOKS — every route here has a matching entry in operations.json.
 * Routes are one line each: the dispatcher in lib/ops.js resolves the actor,
 * checks the role, reads params and calls the service. Handlers run in
 * isolated VMs, so each one require()s the dispatcher itself.
 */

routerAdd('POST', '/api/ops/assets-rescan', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'assets.rescan'));
routerAdd('POST', '/api/ops/assets-retire', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'assets.retire'));
routerAdd('POST', '/api/ops/assets-reactivate', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'assets.reactivate'));
routerAdd('POST', '/api/ops/assets-delete', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'assets.delete'));
routerAdd('GET', '/api/ops/assets-impact', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'assets.impact'));
routerAdd('GET', '/api/ops/assets-timeline', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'assets.timeline'));

routerAdd('POST', '/api/ops/findings-acknowledge', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'findings.acknowledge'));
routerAdd('POST', '/api/ops/findings-resolve', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'findings.resolve'));
routerAdd('POST', '/api/ops/findings-suppress', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'findings.suppress'));
routerAdd('POST', '/api/ops/findings-unsuppress', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'findings.unsuppress'));
routerAdd('GET', '/api/ops/findings-explain', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'findings.explain'));
routerAdd('GET', '/api/ops/posture-overview', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'posture.overview'));

routerAdd('POST', '/api/ops/sources-run-now', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'sources.run-now'));
routerAdd('POST', '/api/ops/sources-set-enabled', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'sources.set-enabled'));
routerAdd('POST', '/api/ops/rules-configure', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'rules.configure'));

routerAdd('POST', '/api/ops/members-set-role', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'members.set-role'));
routerAdd('POST', '/api/ops/settings-update', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'settings.update'));
routerAdd('GET', '/api/ops/audit-verify-chain', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'audit.verify-chain'));
routerAdd('GET', '/api/ops/audit-export', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'audit.export'));
routerAdd('POST', '/api/ops/retention-prune', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'retention.prune'));

routerAdd('GET', '/api/ops/incidents-untriaged', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'incidents.untriaged'));
routerAdd('GET', '/api/ops/incidents-context', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'incidents.context'));
routerAdd('POST', '/api/ops/incidents-triage', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'incidents.triage'));
routerAdd('POST', '/api/ops/incidents-request-triage', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'incidents.request-triage'));
routerAdd('POST', '/api/ops/incidents-set-status', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'incidents.set-status'));
routerAdd('POST', '/api/ops/incidents-assign', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'incidents.assign'));
routerAdd('POST', '/api/ops/incidents-add-note', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'incidents.add-note'));

routerAdd('POST', '/api/ops/notifiers-create', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'notifiers.create'));
routerAdd('POST', '/api/ops/notifiers-update', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'notifiers.update'));
routerAdd('POST', '/api/ops/notifiers-delete', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'notifiers.delete'));
routerAdd('POST', '/api/ops/notifiers-test', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'notifiers.test'));
routerAdd('GET', '/api/ops/digest-preview', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'digest.preview'));
routerAdd('POST', '/api/ops/digest-send-now', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'digest.send-now'));

routerAdd('GET', '/api/ops/sensors-install-info', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'sensors.install-info'));
routerAdd('POST', '/api/ops/sensors-register', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'sensors.register'));
routerAdd('POST', '/api/ops/sensors-revoke', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'sensors.revoke'));
routerAdd('POST', '/api/ops/sensors-checkin', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'sensors.checkin'));
routerAdd('POST', '/api/ops/sensors-live', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'sensors.live'));
routerAdd('POST', '/api/ops/sensors-report', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'sensors.report'));
routerAdd('POST', '/api/ops/baselines-accept-listeners', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'baselines.accept-listeners'));

routerAdd('GET', '/api/ops/remediations-suggest', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'remediations.suggest'));
routerAdd('GET', '/api/ops/remediations-queue', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'remediations.queue'));
routerAdd('POST', '/api/ops/remediations-request-plan', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'remediations.request-plan'));
routerAdd('POST', '/api/ops/remediations-plan', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'remediations.plan'));
routerAdd('POST', '/api/ops/remediations-approve', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'remediations.approve'));
routerAdd('POST', '/api/ops/remediations-reject', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'remediations.reject'));
routerAdd('POST', '/api/ops/remediations-claim', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'remediations.claim'));
routerAdd('POST', '/api/ops/remediations-report-step', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'remediations.report-step'));
routerAdd('POST', '/api/ops/remediations-complete', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'remediations.complete'));
routerAdd('POST', '/api/ops/remediations-fail', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'remediations.fail'));
routerAdd('POST', '/api/ops/remediations-mark-manual', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'remediations.mark-manual'));
routerAdd('POST', '/api/ops/remediations-cancel', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'remediations.cancel'));
routerAdd('GET', '/api/ops/activity-stats', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'activity.stats'));
routerAdd('GET', '/api/ops/agent-presence', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'agent.presence'));
routerAdd('POST', '/api/ops/fixes-monitor-report', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'fixes.monitor-report'));
routerAdd('POST', '/api/ops/detections-verdict', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'detections.verdict'));
routerAdd('GET', '/api/ops/catalogue-list', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'catalogue.list'));
routerAdd('POST', '/api/ops/apps-set-intent', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'apps.set-intent'));
routerAdd('POST', '/api/ops/sensors-create-join-token', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'sensors.create-join-token'));
routerAdd('POST', '/api/ops/sensors-revoke-join-token', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'sensors.revoke-join-token'));
routerAdd('POST', '/api/ops/accounts-set-access', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'accounts.set-access'));
routerAdd('POST', '/api/ops/accounts-remove-access', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'accounts.remove-access'));
routerAdd('POST', '/api/ops/accounts-review', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'accounts.review'));
routerAdd('GET', '/api/ops/accounts-reviews-due', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'accounts.reviews-due'));
routerAdd('POST', '/api/ops/apps-update', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'apps.update'));
routerAdd('POST', '/api/ops/apps-evaluate-now', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'apps.evaluate-now'));
routerAdd('POST', '/api/ops/backups-create-plan', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'backups.create-plan'));
routerAdd('POST', '/api/ops/backups-new-link', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'backups.new-link'));
routerAdd('POST', '/api/ops/backups-delete-plan', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'backups.delete-plan'));
routerAdd('POST', '/api/ops/agent-access-report', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'agent.access-report'));

// v3 M1–M2: how it's running, start / stop / restart, logs.
routerAdd('GET', '/api/ops/metrics-series', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'metrics.series'));
routerAdd('POST', '/api/ops/changes-request', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'changes.request'));
routerAdd('POST', '/api/ops/help-ask', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'help.ask'));
routerAdd('GET', '/api/ops/help-pending', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'help.pending'));
routerAdd('POST', '/api/ops/help-answer', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'help.answer'));
routerAdd('POST', '/api/ops/help-withdraw', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'help.withdraw'));
routerAdd('POST', '/api/ops/changes-prepare-fix', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'changes.prepare-fix'));
routerAdd('GET', '/api/ops/home-overview', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'home.overview'));
routerAdd('POST', '/api/ops/changes-confirm', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'changes.confirm'));
routerAdd('GET', '/api/ops/changes-list', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'changes.list'));
routerAdd('POST', '/api/ops/machines-watch', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'machines.watch'));
routerAdd('POST', '/api/ops/logs-request', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'logs.request'));
routerAdd('GET', '/api/ops/logs-result', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'logs.result'));
routerAdd('POST', '/api/ops/sensors-logs-reply', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'sensors.logs-reply'));

// v4 N2–N4: looking at the server, everyday and server jobs, the terminal.
routerAdd('POST', '/api/ops/files-stage-upload', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'files.stage-upload'));
routerAdd('POST', '/api/ops/sensors-transfer-put', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'sensors.transfer-put'));
routerAdd('POST', '/api/ops/changes-undo', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'changes.undo'));
routerAdd('POST', '/api/ops/server-read', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'server.read'));
routerAdd('GET', '/api/ops/server-read-result', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'server.read-result'));
routerAdd('POST', '/api/ops/sensors-read-reply', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'sensors.read-reply'));
routerAdd('POST', '/api/ops/files-save', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'files.save'));
routerAdd('POST', '/api/ops/files-new-folder', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'files.new-folder'));
routerAdd('POST', '/api/ops/files-rename', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'files.rename'));
routerAdd('POST', '/api/ops/files-delete', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'files.delete'));
routerAdd('POST', '/api/ops/files-upload', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'files.upload'));
routerAdd('POST', '/api/ops/apps-settings-save', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'apps.settings-save'));
routerAdd('POST', '/api/ops/apps-compose-save', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'apps.compose-save'));
routerAdd('POST', '/api/ops/apps-remove', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'apps.remove'));
routerAdd('POST', '/api/ops/installs-request-custom', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'installs.request-custom'));
routerAdd('POST', '/api/ops/disk-cleanup', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'disk.cleanup'));
routerAdd('POST', '/api/ops/processes-stop', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'processes.stop'));
routerAdd('POST', '/api/ops/firewall-change', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'firewall.change'));
routerAdd('POST', '/api/ops/keys-add', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'keys.add'));
routerAdd('POST', '/api/ops/keys-remove', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'keys.remove'));
routerAdd('POST', '/api/ops/schedules-set', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'schedules.set'));
routerAdd('POST', '/api/ops/schedules-create', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'schedules.create'));
routerAdd('POST', '/api/ops/schedules-delete', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'schedules.delete'));
routerAdd('POST', '/api/ops/remote-tailscale-install', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'remote.tailscale-install'));
routerAdd('POST', '/api/ops/commands-prepare', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'commands.prepare'));
routerAdd('POST', '/api/ops/terminal-open', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'terminal.open'));
// The terminal's live stream has its own routes: keystrokes and output aren't operations a minute's limit should cap (v4 walk).
routerAdd('POST', '/api/netsentry/terminal/input', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'terminal.input'));
routerAdd('POST', '/api/ops/terminal-resize', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'terminal.resize'));
routerAdd('POST', '/api/ops/terminal-close', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'terminal.close'));
routerAdd('GET', '/api/ops/terminal-sessions', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'terminal.sessions'));
routerAdd('GET', '/api/ops/terminal-transcript', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'terminal.transcript'));
routerAdd('POST', '/api/netsentry/terminal/exchange', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'sensors.terminal-exchange'));
routerAdd('POST', '/api/ops/updates-request', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'updates.request'));
routerAdd('POST', '/api/ops/updates-rollback', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'updates.rollback'));
routerAdd('POST', '/api/ops/updates-set-policy', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'updates.set-policy'));
routerAdd('POST', '/api/ops/updates-check-now', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'updates.check-now'));
routerAdd('POST', '/api/ops/os-request', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'os.request'));
routerAdd('POST', '/api/ops/windows-save', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'windows.save'));
routerAdd('POST', '/api/ops/windows-delete', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'windows.delete'));
routerAdd('POST', '/api/ops/backups-run-now', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'backups.run-now'));
routerAdd('POST', '/api/ops/backups-test-now', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'backups.test-now'));
routerAdd('POST', '/api/ops/backups-restore', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'backups.restore'));
routerAdd('GET', '/api/ops/installs-templates', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'installs.templates'));
routerAdd('POST', '/api/ops/installs-request', (e) => require(`${__hooks}/lib/ops.js`).handle(e, 'installs.request'));
