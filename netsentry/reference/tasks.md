# Tasks: NetSentry

Every task cites what it implements. These features already exist in the published app `netsentry` 1.0.0, so the build tasks are recorded as done.

## Build
- [x] T-1 (F-ACC-1, F-ACC-2, F-ACC-7): membership. The first account is admin and later accounts are viewers while sign-up is open. Roles are set only by `members.set-role`, the last admin is kept, and UI gating is mirrored by the server's checks (`bootstrap.pb.js`, `lib/core/roles.js`, `lib/me.tsx`).
- [x] T-2 (F-ACC-3, F-ACC-4, F-ACC-5): the shell. The sidebar has five places and the account foot, phones get the "Navigate" select, and every level of detail has its own hash route with breadcrumbs and legacy redirects (`App.tsx`, `lib/nav.ts`, `components/Breadcrumbs.tsx`).
- [x] T-3 (F-ACC-6, F-STP-1, F-STP-2, F-STP-3): the setup guide in three steps, with the per-OS install command and a one-day, one-use join key, live "Reporting ✓", and who should reach each app. It is offered once to admins when no monitor exists (`pages/Setup.tsx`, `pages/AppsSetup.tsx`, `sensors.create-join-token`).
- [x] T-4 (F-ACC-8): the Slate palette that overrides the kit tokens for light and dark, plus the fixed status colours (`theme.css`, `components/visual.tsx`).
- [x] T-5 (F-HOME-1, F-HOME-2, F-HOME-4): the Home status card with the headline, server line, live meters and 80 s graphs, and "Check now" (`pages/ServerHome.tsx`, `lib/liveStatus.tsx`, `assets.rescan`).
- [x] T-6 (F-HOME-3): the reconnect and update-the-monitor drawers with the one-command flow (`components/Reconnect.tsx`).
- [x] T-7 (F-HOME-5, F-HOME-6, F-HOME-7, F-HOME-8): "Needs you" tiles grouped by cause, broken-now first, six then "Show <n> more", each with its one action, the busy and changes-off states, and the all-clear (`home.overview`, `lib/v2/todo.js`).
- [x] T-8 (F-HOME-9, F-HOME-10): "Your apps" rows with live state and Open / Start / Manage, and "Recent activity" with changes, stop and start events, and Undo.
- [x] T-9 (F-HOME-11, F-HOME-12, F-HOME-13): "Ask the agent": ask, wait, answer, the prepared changes with Review, withdraw, honest agent presence and the 15-minute note (`help.*`, `agent.presence`, `lib/services/help.js`).
- [x] T-10 (F-HOME-14, F-SRV-13): the not-set-up states on Home and Server.
- [x] T-11 (F-CHG-1, F-CHG-2, F-CHG-3, F-CHG-4, F-CHG-5): one change panel for every change. It prepares, previews, confirms against the plan hash and follows the change live to its end, with a toast after closing, withdraw on "Not now", and Undo inside the panel (`components/Controls.tsx useChange`, `changes.confirm`, `changes.undo`).
- [x] T-12 (F-CHG-6): "Changes made" lists for the server and each app, with Review for waiting changes and "Show all" (`ChangeHistory`, `changes.list`).
- [x] T-13 (F-APP-1, F-APP-2): the Apps list with groups, search, live numbers and memory bars, beside the app from 1024 px and as separate pages below (`pages/Apps.tsx`).
- [x] T-14 (F-APP-3, F-APP-4, F-APP-15): the app page header, run controls, tabs, Overview, and the gone state (`pages/AppPage.tsx`).
- [x] T-15 (F-APP-5): logs on request, with a 300-line answer, a filter and follow new lines (`LogsView`, `logs.request`, `logs.result`).
- [x] T-16 (F-APP-6, F-APP-7): the app Settings tab and "Edit the Compose file", with risk ticks, health check and automatic put-back (`components/AppJobs.tsx`, `apps.settings-save`, `apps.compose-save`).
- [x] T-17 (F-APP-8, F-APP-9): app updates (preview, safe update, roll back within 14 days) and update policies (`components/Updates.tsx`, `updates.*`).
- [x] T-18 (F-APP-10, F-APP-11): NetSentry's own backups with 7/4/6 retention and monthly restore tests, run now, test, restore, and heartbeat links shown once for other tools (`components/OwnBackups.tsx`, `backups.*`, `/api/netsentry/hb/{token}`).
- [x] T-19 (F-APP-12, F-APP-13): "Access & safety": reach paths in words, the reach chooser, the away-from-home guide, safety checks, accounts behind a read-only key with owner, importance and access review (`components/AppAccess.tsx`, `components/RemoteGuide.tsx`, `apps.set-intent`, `accounts.*`).
- [x] T-20 (F-APP-14): "Remove…" with keep or everything and back up first, confirmed in the change panel (`apps.remove`).
- [x] T-21 (F-INS-1, F-INS-2, F-INS-3, F-INS-4): Add an app from the 13 templates or a pasted Compose file, with every risk ticked. The changes-off state, and unrecognised apps managed like any other (`pages/InstallApp.tsx`, `lib/v2/install.js`, `installs.*`).
- [x] T-22 (F-SRV-1, F-SRV-2, F-SRV-3): the Server header and tabs, with health over ranges, operating-system updates and restart, the server's own tiles and changes (`pages/Server.tsx`, `components/Health.tsx`, `os.request`).
- [x] T-23 (F-SRV-4): Files: allowed folders, edit with a line-by-line diff, stale-save refusal, 20 MB transfers, folders, rename, and delete to the bin (`components/FilesPanel.tsx`, `files.*`, `server.read`).
- [x] T-24 (F-SRV-5, F-SRV-6): Disk space clean-ups and biggest folders, and Programs with Stop and the protected dash (`components/ServerJobs.tsx`, `disk.cleanup`, `processes.stop`).
- [x] T-25 (F-SRV-7, F-SRV-8, F-PRB-13): Network & firewall: the firewall in words, open, close and switch on, Windows toggles, Tailscale install and sign-in, and expected open ports (`firewall.change`, `remote.tailscale-install`, `baselines.accept-listeners`).
- [x] T-26 (F-SRV-9): Users & keys, with add a public key and remove, and the lock-out refusals (`keys.*`).
- [x] T-27 (F-SRV-10): Scheduled jobs in words, pause and resume, new jobs on the five schedules, and delete for jobs made in NetSentry (`schedules.*`).
- [x] T-28 (F-SRV-11): the recorded terminal with the password re-check, idle close, past sessions and transcripts, on its own stream routes (`components/TerminalPanel.tsx`, `terminal.*`, `/api/netsentry/terminal/*`).
- [x] T-29 (F-SRV-12): History and Details (score link, problem table, coverage, everything the monitor sees) (`components/ServerParts.tsx`, `components/Coverage.tsx`).
- [x] T-30 (F-ACT-1, F-ACT-2, F-ACT-3): Activity: To review with Expected / Looks wrong, changes over 7 days, the Network view and Who did what (`pages/Activity.tsx`, `pages/Network.tsx`, `detections.verdict`).
- [x] T-31 (F-PRB-1, F-PRB-2, F-PRB-3, F-PRB-4): the issue page with fix choices, risk words, other options and "Is this expected?" (`pages/IssuePage.tsx`, `findings.*`, `remediations.request-plan`).
- [x] T-32 (F-PRB-5, F-PRB-6): the automatic resolve and reopen lifecycle, and Accepted risks with end dates of up to a year (`lib/core/lifecycle.js`, `pages/AcceptedRisks.tsx`).
- [x] T-33 (F-PRB-7): fix pages with live steps, reject, mark done by hand and verification by the rule (`pages/Fixes.tsx`, `remediations.*`).
- [x] T-34 (F-PRB-8, F-PRB-9, F-PRB-10, F-PRB-11): cases. High and critical problems are correlated into a case, which has an assessment, issues, a timeline, status, assignee, notes and triage, and is mitigated and reopened automatically (`lib/core/correlate.js`, `pages/Incidents.tsx`, `pages/IncidentDetail.tsx`, `incidents.*`).
- [x] T-35 (F-PRB-12): the security score page and every problem, one by one and in a table (`pages/Home.tsx`, `pages/Issues.tsx`, `pages/Findings.tsx`).
- [x] T-36 (F-SET-1, F-SET-2): Settings tabs, More settings and Monitor with the update and changes commands (`pages/Settings.tsx`, `pages/SensorsPanel.tsx`).
- [x] T-37 (F-SET-3, F-SET-4, F-SET-5, F-SET-6): alert destinations with SSRF-safe https checks, encrypted URLs, test and last result, routing by minimum severity, and the daily summary at a UTC hour with an audit checkpoint (`pages/AlertsPanel.tsx`, `lib/services/alerts.js`, `notifiers.*`, `digest.*`).
- [x] T-38 (F-SET-7, F-SET-8): Team roles and General & fixes (name, retention, sign-up, fix pause, delete old history) (`pages/SettingsPanels.tsx`, `settings.update`, `retention.prune`).
- [x] T-39 (F-SET-9): weekly maintenance windows in the browser's time zone (`WindowsPanel`, `windows.*`).
- [x] T-40 (F-SET-10, F-SET-11): detection rules and checks with run now, enable and disable, and 24-hour history (`pages/Rules.tsx`, `pages/Sources.tsx`, `rules.configure`, `sources.*`).
- [x] T-41 (F-SET-12, F-AGT-9): the hash-chained audit log with the 30-day view, actor filter, Verify chain and JSON Lines download, plus `scripts/verify-audit-export.cjs` (`lib/core/auditchain.js`, `audit.*`).
- [x] T-42 (F-AGT-1, F-AGT-3, F-AGT-8): the 122 operations in `operations.json`, served to agents by `a2app_routes.pb.js` through the same handlers the View calls. The agent gets analyst rights with human-only and sensor-only refusals, and destructive operations go through the adapter's approval.
- [x] T-43 (F-AGT-2, F-AGT-6): the `help_requested` trigger from `help.ask`, re-rung every 5 minutes for a day, with its playbook (`lib/services/agentbell.js`).
- [x] T-44 (F-AGT-4, F-AGT-5, F-AGT-6): the `triage_queue_ready`, `daily_digest` and `source_unhealthy` triggers with their playbooks, and triage re-rung every 6 hours (`incidents.untriaged`, `incidents.context`, `incidents.triage`).
- [x] T-45 (F-AGT-7): `commands.prepare`, only while the terminal is on at the server: shown verbatim, run by the monitor after an admin confirms, output masked.

## Verification
- [ ] Agent App Framework gate (`agent-app <dir> validate`) passes, including the describe budget on a dev instance.
- [ ] Every declared operation answers through `a2app` on a live instance.
- [ ] The View renders identically to the published build (screenshot comparison).
