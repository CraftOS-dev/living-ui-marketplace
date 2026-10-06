# NetSentry

> Per-project plan / context / index. Keep current after every feature.
> Binding spec: `reference/requirements.md`. Full product plan: `docs/PLAN.md`.
> Architecture + how to extend: `docs/ARCHITECTURE.md`.

## What this app does

A team security console that watches what an organisation exposes to the
internet — domains, subdomains, public IPs, open services, known CVEs,
certificates, DNS/email configuration, registration and blocklist reputation —
and explains every finding with fix steps. Increment 1 = plan phases P0 + P1.

## Status — Increment 1 (P0 foundation + P1 attack surface)

- [x] Multi-user workspace: first account = admin, sign-up closed by default, viewer/analyst/admin enforced server-side (F-WS-1..3, F-WS-5)
- [x] Hash-chained audit log + "Verify chain" (F-WS-4)
- [x] Add domain / public IPv4 with inline validation and duplicate check (F-AS-1)
- [x] Assets list with search + kind/status filters and open-finding counts (F-AS-2)
- [x] Asset detail: observations by kind, change timeline, findings, sources, discovered children, TXT verification (F-AS-3, F-AS-4)
- [x] Scan now / retire / reactivate / delete-with-impact-confirmation (F-AS-5, F-AS-7)
- [x] Discovery: A records → IP assets, certificate names → subdomain assets (F-AS-6)
- [x] Auto-created sources, minute scheduler with time budget + failure backoff + health (F-SRC-1, F-SRC-2)
- [x] Sources page with health, run now, enable/disable, 24 h scan runs (F-SRC-3)
- [x] Daily intel: CISA KEV, FIRST EPSS, Spamhaus DROP, abuse.ch Feodo + URLhaus (F-SRC-4)
- [x] Findings queue with filters, explain drawer, acknowledge / resolve / suppress / unsuppress (F-FD-1..3)
- [x] Automatic resolve / reopen lifecycle (F-FD-4) and the 11 checks (F-FD-5)
- [x] Rules page: enable/disable + severity override (admin); port baselines (F-RL-1, F-RL-2)
- [x] Overview: posture score + breakdown, severity chart, top risks, 24 h changes, source/intel health, onboarding empty state (F-OV-1, F-OV-2)
- [x] Agent operations + audit attribution + human-only guard (F-AGT-1..3)
- [x] Independent walk-verify (2026-09-30): first walk "defects" (1 medium, 8 low) → fixed → independent re-verify: 8/9 pass, no regressions; sign-out form residue found and fixed. Remaining: sidebar nav buttons show no accessible name in the test tool's a11y tree (kit `SidebarNav`, hash-locked; label is text content, so real browsers name it).
- [ ] Not observable on live data during the walk (covered by unit tests): source degraded/failing backoff, automatic resolve, 9 of 11 checks firing, baseline suppressing EXP-003.

## Status — Increment 3 (P3 Sensor + host security)

- [x] `sensors` auth collection; register (token once) / revoke (tokenKey rotated); sensor-only ops `sensors.checkin` / `sensors.report` (F-SN-1..4)
- [x] Read rules narrowed to people (`@request.auth.collectionName = "users"`) so sensor principals read nothing (F-SN-2)
- [x] Host asset + sensor-linked sources; reports applied through the shared pipeline (`pipeline.applyResult`) (F-SN-3, F-SN-6)
- [x] Signals path (`signals`, 7-day retention) for login events; detectors HOST-005 / HOST-016 (F-HO-2)
- [x] 14 host/device/resilience checks (F-HO-1), liveness → RES-002 (F-SN-5)
- [x] Python sensor (`sensor/`, stdlib only): 10 collectors × Linux/Windows/macOS, redaction, spool, `check` mode; 18 parser tests
- [x] Independent walk-verify of increments 3–6 (2026-09-30): 12 defects (1 stale-server, 3 medium, 8 low) → fixed → independent re-check: all fixed (cost display not observable live)

## Status — Increment 4 (P4 network monitoring)

- [x] Sensor collectors `host.connections` (programs on the network + `net.conn` signals), `host.dns` (`net.dns`), `host.ids` (Suricata eve.json / CrowdSec → `ids.alert`); 13 collectors total
- [x] NET-001 threat-intel hit (IP or domain), NET-004 tunnelling / generated domains, NET-006 mining-pool / backdoor ports, NET-007 new program on the network, NET-008 Tor ports, NET-009 IDS alert
- [x] Network page: destinations, DNS names, programs, IDS alerts
- [x] Existing assets get new collectors at boot (`assets.backfillSources`) and on sensor check-in
- [x] Live on Windows (connections, DNS) and in an Ubuntu container

## Status — Increment 5 (P5 fixes: suggest → plan → approve → agent applies → NetSentry verifies)

- [x] 19 playbooks (`lib/playbooks/`), risk classes auto / approve / high / guided; `remediations.suggest` per finding
- [x] Lifecycle plan_requested → planned → approved (bound to the plan hash, 24 h TTL) → executing (backup reference required for approve/high) → verifying → done / failed / rolled_back / expired / cancelled
- [x] Agent writes the plan, claims, reports each step, completes with the executed plan hash; a hash mismatch fails the fix
- [x] Only a human admin approves or rejects; the agent is refused. Kill switch `remediation_paused`; optional auto-approve for the `auto` class only
- [x] Verification = the finding's own rule after the next report; passive collectors cannot prove a failure
- [x] Fixes page + drawer, "Fix it" section in the finding drawer, Workspace → Fixes settings
- [x] ~~Triggers `plans_requested`, `remediation_approved`~~ — retired in N-B43: the agent never writes or runs command plans; every change is applied by the server's own monitor
- [x] End to end in an Ubuntu container (2026-09-30): HOST-003 → agent plan → admin approve → 4 steps executed → re-report → verified done; negative path (plan-hash mismatch) failed correctly; audit chain intact

## Status — Increment 6 (P6 cloud, via the instance's own identity — no keys)

- [x] Sensor `host.cloud` collector: AWS (IMDSv2 + instance role, SigV4 in stdlib, checked against AWS's test vector), GCP (metadata server token), Azure (IMDS managed identity)
- [x] Without an identity: instance metadata only, marked partial with the missing permission; any denied call → partial (never resolves findings)
- [x] CLD-001 world-open sensitive port in security group / firewall / NSG; CLD-002 GuardDuty finding; CLD-003 who changed the security group (CloudTrail, high when it opened to the internet); CLD-004 GuardDuty off; CLD-005 unencrypted EBS; CLD-006 IMDSv1 allowed
- [x] Playbooks: close-exposed-port (CLD-001), enable-cloud-threat-detection, encrypt-cloud-disk (high), require-imdsv2; CLD-002/003 → investigate-compromise
- [x] Console path verified with a simulated EC2 sensor: firewall change + resulting exposure land in one host incident; partial report resolves nothing; fix report resolves
- [x] `docs/DEPLOYMENT.md` (anywhere / single EC2 / GCP / Azure), `docs/PERMISSIONS.md` (read-only policies)
- [ ] **Not run against a live AWS/GCP/Azure account** (by design no keys were used; parsers tested on documented response formats)
- [x] Independent walk-verify of increments 3–6 — see increment 3

## Status — Increment 7 (P7 breadth)

- [x] Console `web` collector (daily, public-address-only) → WEB-001, WEB-004; `.git`/`.env` probe on verified assets → WEB-003
- [x] Sensor `host.deps` (OSV.dev, verified live) → CODE-002 with KEV/EPSS; `host.secrets` (gitleaks, secret never sent) → CODE-001
- [x] Zeek (dns.log, notice.log) and Falco adapters; shared log tailer that never skips lines past its limit
- [x] GCP / Azure firewall rules (in the P6 cloud collector)
- [x] Independent walk-verify (2026-09-30): PASS; 5 low defects + verifying-fix-cannot-be-cancelled → fixed (raw TLS errors, evidence lists, closed fixes group, switch label, verifying→cancelled)
- [ ] Identity (MFA, sign-ins), lookalike domains, HTTP→HTTPS redirect — not built (see requirements)
- [ ] gitleaks not run live (binary download not approved); parsers tested on its documented JSON

## Status — Increment 8 (P8 fleet & off-box evidence)

- [x] Sensor: https required for non-local consoles, no redirects, `--ca-file`
- [x] `audit.export` (admin, paged) + Download button + `scripts/verify-audit-export.cjs`
- [x] Audit checkpoint in the daily digest
- [x] DEPLOYMENT.md: remote sensors behind a sensor-only reverse proxy, separate security VM, off-box audit
- [x] Independent walk-verify (2026-09-30): PASS (export verified offline, tamper detected, checkpoint matches digest)
- [ ] Whole-account / Organizations cloud scanning; CraftBot share-channel enrolment — not built
- [ ] Marketplace packaging: `{{PORT}}`/`{{PROJECT_ID}}` manifest placeholders + catalogue.json entry — scripted, not applied (breaks local `agent-app dev`)

## Status — Increment 2 (P2 incidents, agent loop, alerts)

- [x] Correlation of high/critical findings into incidents per root asset; escalation opens incidents (F-IN-1)
- [x] Incidents list + detail: assessment, findings, timeline, status/assignee/notes/ask agent/write triage (F-IN-2..4, F-IN-6)
- [x] Auto-mitigate when all linked findings are gone (F-IN-5)
- [x] Triggers `triage_queue_ready`, `source_unhealthy`, `daily_digest`; re-ring every 6 h while triage waits (F-TR-1)
- [x] Agent ops `incidents.untriaged / context / triage`; request status shown in UI (F-TR-2, F-TR-3)
- [x] Notifiers: webhook (slack/discord/ntfy/json), heartbeat, CraftBot email; encrypted URLs; SSRF-safe validation; test; per-destination status (F-AL-1..3, F-AL-6)
- [x] Direct alerts for incidents and failing sources; daily digest (F-AL-4, F-AL-5)
- [x] CT fallback treated as partial snapshot (fix for false "new CA / removed issuer" findings)
- [x] Independent walk-verify of increment 2 (2026-09-30): first walk "defects" (SSRF bypass via loopback-resolving names / short IP forms, incident not escalating, missing agent state, inline error) → fixed → re-verify PASS (29 SSRF bypass URLs refused). Follow-up gap found (mitigated incident not reopening) → fixed: F-IN-7, live-verified.
- [ ] Not observed live (logic covered): source_unhealthy after 3 real failures; agent "working/done" states (needs a connected agent).

## Status — Increment 9 (UX redesign, docs/UX-PLAN.md)

- [x] Five places (Home, Issues, Protected, Activity, Settings) + legacy hash redirects (F-UX-1)
- [x] Plain vocabulary in `frontend/src/app/lib/words.ts`; rule/playbook/audit texts reworded (F-UX-2)
- [x] Home to-do queue, score meaning, being handled, protected + coverage (F-UX-3)
- [x] Setup guide with live "Connected ✓" and real sensor path (`sensors.install-info`) (F-UX-4)
- [x] Issues/Cases/Fixes tabs; issue view order; fix progress steps; risk words (F-UX-5, F-UX-6)
- [x] Protected groups + item Coverage tab (`components/Coverage.tsx`) (F-UX-7)
- [x] Activity + Settings consolidation (F-UX-8)
- [x] Boot-time catalogue sync on a brand-new DB no longer logs an error (explains the first-tick sync)
- [x] Independent walk-verify of increment 9 (2026-09-30): 3 rounds on throwaway instances — 8 defects + jargon → fixed → re-check: 8/8 + 6/6 fixed; last round found cancel-fix left the issue "being handled" → fixed + verified (cancel releases only a fix-requested acknowledgement). Remaining cosmetic: audit-log action codes (technical record), old audit/timeline entries keep pre-rewording words.

## Status — Increment 10 (Simple / Detailed views)

- [x] Simple/Detailed switch per person (`frontend/src/app/lib/view.tsx`) (F-LV-1)
- [x] Plain-language layer for all 42 checks (`pb/pb_hooks/lib/rules/plain.js`), `findings.plain_title` (migration 8), backfill on the minute tick (F-LV-2)
- [x] Simple view: plain titles, urgency words, plain steps, simple lists, fewer places (F-LV-3, F-LV-4)
- [x] Detailed view: everything technical (F-LV-5)
- [x] Independent walk-verify of increment 10 (2026-09-30): 3 rounds on a throwaway copy — Simple-view jargon + context-wrong steps (file sharing / Windows service got database advice) + 4 bugs → fixed (plain fix names, `when` on playbooks, turn-off-file-sharing guided fix) → final check PASS; small leftovers polished.

## Status — Increment 11 (interactive Simple view)

- [x] Simple Home: status ring, tiles, one problem card at a time (issues, approvals, "your turn" guided fixes, alerts), being-handled link to a filtered list (F-IX-1)
- [x] Problem card with Fix it for me / Show me how (checklist) / It's fine, Why toggle (`components/ProblemCard.tsx`) (F-IX-2)
- [x] Card as the Simple issue view and item page; coverage chip grid flags checks with an open problem (F-IX-3)
- [x] Protected tiles, list icons, no intro text, setup picture tiles (F-IX-4)
- [x] Independent walk-verify (2026-09-30): PASS with minor defects → fixed (card above tiles on phones, 40px tap targets, counts, your-turn cards, chip "!" flags)

## Status — Increment 12 (real Check now, honest agent, details per screen)

- [x] Check now for machines via `sensors.run_requested` (migration 10) + monitor check-in every 30 s (F-RL-1)
- [x] `agent.presence`; Fix it for me honest without an agent; Ask anyway (F-RL-2)
- [x] Per-screen Details (`DetailScope` in lib/view.tsx), no global switch; #/overview = full detailed Home (F-RL-3)
- [x] Hand-tested end to end in a browser with a real monitor on a throwaway instance (F-RL-4)
- [x] Re-adding a monitor on the same computer takes over its record; deleting a machine removes its monitor

## Entities

| Collection | Purpose | Written by |
|---|---|---|
| users (+`role`) | members; role admin/analyst/viewer | sign-up hook, `members.set-role` |
| settings | single row: workspace name, sign-up open, retention days | `settings.update` |
| audit_log | append-only, hash-chained (`seq`, `prev_hash`, `hash`, `at` as ISO text) | every mutating op |
| assets | domain / subdomain / ip; ownership unverified/verified/discovered; `parent` self-relation | `assets.*`, discovery |
| sources | collector × target × schedule; health, backoff, `next_run` | asset creation, pipeline |
| scan_runs | one row per collector run | pipeline |
| observations | latest snapshot per `(asset, kind, subject)`; `present` flag | pipeline |
| changes | append-only diff log (added/removed/modified) | pipeline |
| rules | check catalogue (synced from code at boot) + enabled / severity override / params | boot sync, `rules.configure` |
| baselines | accepted state per asset (ports) | first scan, `baselines.accept` |
| findings | one per `rule|asset|subject` fingerprint; lifecycle status | pipeline, `findings.*` |
| suppressions | by fingerprint, reason, optional expiry | `findings.suppress` |
| intel | CVE → KEV / EPSS | intel sources |
| indicators | blocklist entries (cidr / ip / domain) per list | intel sources |
| incidents | correlated high/critical findings per root asset; `needs_triage`, summary, confidence, assignee | pipeline, `incidents.*` |
| incident_notes | timeline: system events + notes | incident ops, pipeline |
| sensors (auth) | registered sensors: status, host facts, capabilities, linked host asset | `sensors.*` |
| signals | aggregated sensor events (auth.failure / auth.success per source per minute), 7-day retention | sensor reports |
| remediations | one fix attempt: playbook, risk class, plan + plan hash, approval, steps log, verify result | `remediations.*` |
| agent_access | (retired N-B43 — kept for old rows; nothing writes it) | — |
| notifiers | alert destinations; `url_encrypted` (hidden field, key in pb_data/.netsentry_key), `url_hint`, last result | `notifiers.*` |

All domain collections: list/view for signed-in users; **every REST write is
refused** (including superuser) — writes go through operations.

## Operations

Declared in `operations.json`, routes in `pb/pb_hooks/ops.pb.js` (one line
each) → dispatcher `lib/ops.js` → services. Roles in `lib/core/roles.js`.

| Operation | Min role | Notes |
|---|---|---|
| assets.add | analyst | runs a first scan (≤25 s) |
| assets.verify-ownership | analyst | DNS TXT `netsentry-verify=<token>` |
| assets.rescan / retire / reactivate | analyst | |
| assets.delete | admin | destructive; `assets.impact` first |
| assets.impact / assets.timeline | viewer | read-only |
| findings.acknowledge / resolve / suppress / unsuppress | analyst | resolve & suppress need a note/reason |
| findings.explain / posture.overview | viewer | read-only |
| sources.run-now | analyst | |
| sources.set-enabled | admin | |
| baselines.accept | analyst | |
| rules.configure | admin, human only | |
| members.set-role / settings.update / retention.prune | admin, human only | |
| audit.verify-chain / audit.export | admin | read-only; export is paged (follow next_seq) |
| incidents.untriaged / incidents.context | viewer | read-only; context is token-bounded, evidence marked untrusted |
| incidents.triage / request-triage / set-status / assign / add-note | analyst | |
| notifiers.create / update / delete / test | admin, human only | URLs are secrets |
| digest.preview | viewer | read-only |
| digest.send-now | admin | |
| sensors.register / sensors.revoke | admin, human only | token shown once |
| sensors.checkin / sensors.report | **sensor only** | people and the agent are refused |
| baselines.accept-listeners | analyst | host listener baseline |
| remediations.suggest / queue | viewer | read-only |
| remediations.request-plan / cancel / mark-manual | analyst | built-in fix → typed plan; guided → steps; anything else → the person's question to the agent (people only) |
| remediations.approve / reject | admin, **human only** | approval is bound to the plan hash |

The agent acts with analyst rights; human-only ops refuse it.

## Agent Triggers

Declared in `triggers.json` (doorbells — ids only; the queue is NetSentry state):

| Trigger | Fired when | Agent does |
|---|---|---|
| triage_queue_ready | incident opened/grew; "Ask agent"; re-ring every 6 h while triage waits | `incidents.untriaged` → `incidents.context` → `incidents.triage` |
| source_unhealthy (source_id) | source crosses 3 consecutive failures | diagnose, tell the user; change nothing |
| daily_digest | digest hour (UTC) or "Send digest now" | brief the user; change nothing |

| help_requested | a person asked from Home or "Ask the agent to fix it"; re-rung every 5 min while a question waits (≤ 1 day) | `help.pending` → look (read-only) → prepare (`changes.request`, `updates.request`, `changes.prepare-fix`, `commands.prepare`) → `help.answer` |

Fired only via `_triggers_lib.fire()` (lib/services/agentbell.js); the app never reads agent_requests.

## External data

| Source | Used for | Auth | Called from |
|---|---|---|---|
| cloudflare-dns.com (DoH JSON) | DNS records, SPF/DMARC, CNAME targets, TXT verification | none | collectors/dns.js, services/assets.js |
| internetdb.shodan.io | open ports, CPEs, CVEs (passive, ~weekly) | none | collectors/internetdb.js |
| crt.sh → api.certspotter.com fallback | certificate transparency | none | collectors/ct.js |
| rdap.org | domain expiry / registrar | none | collectors/rdap.js |
| www.cisa.gov KEV feed | actively exploited CVEs | none | collectors/intel.js |
| api.first.org EPSS | exploit probability | none | collectors/intel.js |
| www.spamhaus.org DROP, feodotracker.abuse.ch, urlhaus.abuse.ch | blocklists | none | collectors/intel.js |
| the user's own domains (https://<asset>/) | website checks; `.git`/`.env` only on verified assets | none | collectors/web.js (public addresses only; host is dynamic so not in external_hosts) |
| api.osv.dev (from the **Sensor**, opt-in) | vulnerable dependencies | none | sensor/netsentry_sensor/collectors/code.py |
| cloud provider APIs (from the **Sensor**) | CLD checks, with the VM's own identity | instance identity | sensor/netsentry_sensor/collectors/cloud.py |

All URLs live in `pb/pb_hooks/external_hosts.js` (the gate reads them into
`manifest.capabilities.external_hosts`). Every call has a timeout; failures mark
the source degraded/failing and back off. No mock data anywhere.

## Known gaps / notes

- Kit auto-cancellation bugs are worked around in `frontend/src/app/lib/me.tsx`
  (no `useAuth()` in app code) and `App.tsx` (`autoCancellation(false)`).
- The gate's egress/action scans do not recurse into `pb_hooks/lib/`, hence the
  top-level `external_hosts.js` and `craftbot_actions.js`.
- Alert destination hosts are user-entered, so they are not in
  `manifest.capabilities.external_hosts`; they are validated at entry instead.
- InternetDB is passive and refreshed ~weekly by Shodan; the UI says so.
- Cloud adapters call the provider from the Sensor (Python), not the Console, so
  cloud API hosts are not Console egress and not in `external_hosts`.

## Ownership map

- Editable: `frontend/src/app/`, `pb/pb_migrations/`, `pb/pb_hooks/ops.pb.js`,
  `scheduler.pb.js`, `bootstrap.pb.js`, `external_hosts.js`, `lib/**`,
  `operations.json` (non-system entries), `triggers.json`, this file, `reference/`, `docs/`, `tests/`.
- System-managed (never edit): `frontend/src/kit/`, `frontend/src/main.tsx`,
  `frontend/src/config.gen.ts`, `pb/pb_hooks/_*.js`, `manifest.json`, build configs.

## Tests

`node --test tests/*.test.js` — pure core, collectors (recorded real responses
in `tests/fixtures/`), rules (host, network, cloud), correlation, alert formatting/URL safety, remediation lifecycle, web/code. 69 tests.
Sensor: `cd sensor && python -m unittest discover -s tests` (49 tests: parsers on synthetic format samples, SigV4 vector, cloud flow through a fake IMDS, OSV on recorded responses, log tailer, console URL safety).
Offline audit check: `node scripts/verify-audit-export.cjs <export.jsonl> [--checkpoint seq:hash]`.
`scripts/gen-operations.cjs` is the source of truth for `operations.json`.

## Status — Increment 13 (breadcrumb drill-down, live monitoring)

- Per-screen "Details" toggles removed; issues, fixes, cases, items and their parts are routed pages with breadcrumbs (docs/UX-PLAN.md §10). Issue and fix drawers became `pages/IssuePage.tsx` and `FixPage`.
- Live layer: `activity.stats` op (GET, viewer) — checks today, things watched, connections today, open problems, last check; `components/Live.tsx` (LiveBar, Counters, LiveFeed) + `lib/live.ts` (latest-N realtime hook, ticking clock).
- "Fix it for me" goes straight to the fix's page, which updates live through plan → approval → applying → checking.
- Liveness: a monitor going quiet or coming back re-runs the host's liveness check on the next tick (was up to 5 min); liveness and source backfill use the live monitor, not a revoked one left from a re-add.
- Verified by hand on a throwaway instance with a real machine monitor and a test agent: live counters/feed, drill-down to technical and back via breadcrumbs, fix loop, lost-contact auto-clearing, phone width. Gate passes; 71 JS tests pass.

## Status — v2 P0 (foundations), docs/SYSTEM-V2-PLAN.md

Built alongside v1; v1 keeps working. For machines, the v2 engine runs after every monitor report and on the minute tick.
- **Model:** collections `apps`, `intents`, `backup_plans`, `evaluations` (one row per check × subject: pass / fail / not_applicable / unknown) and `app_intel` (migrations 11–12). v1 `assets` remain the machine records until the release migration.
- **Engine** (`pb_hooks/lib/v2/`, pure, node-tested):
  - catalogue (Jellyfin, qBittorrent; every fact cited) and recognition (containers, processes, the app's own answer);
  - intent, reachability (listening address + router UPnP forwards; host firewall recorded as "not checked yet"), versions and advisory ranges;
  - content layers + lint (≤ 80-char titles, no jargon in plain layers, no unfilled slots) + reviewed snapshot.
- **12 checks:**
  - REACH-BEYOND-INTENT, APP-JELLYFIN-SETUP-OPEN, APP-QBIT-AUTH-BYPASS
  - UPD-APP-SECURITY (GitHub releases + repository advisories), UPD-OS-SECURITY
  - BKP-NONE, BKP-STALE (heartbeat link), UP-APP-DOWN, STO-FULL-SOON
  - HST-SSH-PASSWORD, HST-FIREWALL-OFF, NS-MONITOR-SILENT

  They replace v1 HOST-003, DEV-002, HOST-007 and RES-002 on machines.
- **Failing checks** become issues in today's Issues UI; `findings.explain` serves their rendered text.
- **Monitor collectors:** host.containers, host.app_config (only catalogue-listed keys; secrets described, never read), host.storage (`NETSENTRY_SKIP_MOUNTS`), probe.router (UPnP, read-only), probe.apps (GET only, this machine's addresses only); host.info also reports addresses.
- **Ops:** apps.set-intent, apps.update, apps.evaluate-now, backups.create-plan / new-link / delete-plan; public route `/api/netsentry/hb/{token}`.
- **Proof:**
  - `tests/lab` (see its README): `python tests/lab/lab.py e2e` passes — 20 verdicts as built, plus 3 fixes (finish Jellyfin setup, untick qBittorrent bypass, remove router forward) turning green on their own with their issues resolved;
  - 84 JS tests, 62 monitor tests, gate green.
- **Not yet:** the apps-first UI (P1), fix actions (P2), organisation mode (P3), cloud (P4).

## Status — v2 P1 (apps first, home), docs/SYSTEM-V2-PLAN.md

- **Catalogue: 23 apps**, each fact cited AND recorded from the real app in the lab (`tests/lab/catalogue_probe.py` → `tests/fixtures/catalogue/*.json`): media (Jellyfin, Plex, Emby, Jellyseerr), downloads (Sonarr, Radarr, Lidarr, Prowlarr, Bazarr, qBittorrent, Transmission, SABnzbd), home (Home Assistant, AdGuard Home, Pi-hole, Node-RED), files (Nextcloud, Syncthing, Vaultwarden), image-only (Immich, PhotoPrism, Paperless-ngx, Frigate).
- **Generic app checks from catalogue specs:** APP-SETUP-OPEN, APP-NO-PASSWORD, APP-KEY-EXPOSED (value masked `[exposed]` by the monitor), APP-OPEN-SIGNUP, APP-ADMIN-SECRET-PLAIN.
- **Activity** (v1 HOST-006/008/009, NET-007) moved to `detections` (7-day learning, known-good publishers, expected / looks wrong); **setup mode** home / organisation (migration 15).
- **UI:** Home "Your apps", app page with outcome parts, Setup › Your apps (one question per app), Activity inbox, plain problem cards.
- Deployed to 8471 after a pb_data backup (`…-before-v2-p1`).

## Status — v2 P2 (safe remote access, NetSentry's own fixes)

- **Remote access** (`host.remote_access`: Tailscale, Tailscale serve/Funnel, Cloudflare Tunnel, VPN) feeds reachability ("your own devices when away"); app page › "Use it from away, safely" guide.
- **Typed actions** (`lib/v2/actions.js`): router.remove_port_mapping, ssh.disable_passwords, app.config.set. The **monitor applies them only when fixing is switched on at the machine** (`NETSENTRY_EXECUTOR=on`), saves the previous state, undoes on failure, and refuses the SSH change without a sign-in key (lock-out guard). NetSentry verifies (check green + app still answers) or has it undone.
- Windows update check; storage trend needs a day of history.
- **Proof:** lab e2e — 22 verdicts as built, 3 fixes by hand + 3 by NetSentry verified green, lock-out guard held. Deployed to 8471 after a backup (`…-before-v2-p2`).

## Status — v2 P3 (organisations: Sam)

- **Catalogue: 46 apps.** Business apps are recorded from their real images in the lab, fresh and in common set-ups (`tests/fixtures/catalogue/<app>_<variant>.json`):
  - code: Gitea, Forgejo;
  - infrastructure: Portainer, Traefik, Caddy, Nginx Proxy Manager;
  - monitoring: Grafana, Uptime Kuma;
  - business and chat: Odoo, Mattermost, Wiki.js, Keycloak;
  - databases: PostgreSQL, MariaDB/MySQL, Redis, MongoDB, Elasticsearch;
  - image-only: BookStack, SuiteCRM, EspoCRM, Twenty, Rocket.Chat, GitLab.
- **New check:** APP-ADMIN-PAGE-OPEN (Odoo's database manager).
- **Lab-measured facts:**
  - **Portainer:** a stranger can't take it over from 2.43.0 (setup token), nor after its 5-minute window.
  - **Gitea:** turning sign-ups off still shows the first-account line, so the checks look for "Registration is disabled".
  - **Keycloak** refuses remote admin creation, so it has no setup check.
- **The monitor** can ask a TCP greeting (Redis PING, Postgres' SSL byte), look for named phrases on a page, keep named JSON keys, and use HTTPS.
- **Networks & discovery:**
  - The monitors propose the networks they are on (Docker's own are skipped).
  - An admin confirms each one; this consent is human-only.
  - `probe.discovery` scans only confirmed private ranges up to /22: well-known ports plus each web page's title. It never signs in.
  - `devices` names what it recognises (catalogue apps; the UPnP router).
  - A device that appears after the first scan becomes NET-NEW-DEVICE to review; "It's ours" answers it.
- **Policy templates** (internal, critical, admin tool, behind-the-scenes, public) can be applied in bulk, and each app records which one it follows. Apps also have owners and importance.
- **Accounts (D12):** an opt-in read-only key, encrypted and never returned. Gitea/Forgejo `read:admin` is proven in the lab to list accounts and be refused writes. Checks: ACC-ADMIN-COUNT and ACC-STALE-USERS. Access reviews come with a monthly reminder when due.
- **Monthly report** (`reports`):
  - built from measurements only (uptime counts only measured time; "not measured" otherwise);
  - printable to PDF;
  - emailed on the 1st via SMTP, else to the owner through CraftBot.
- **Rollout:**
  - join tokens (time-limited, capped, revocable, hashed), with `/api/netsentry/join`;
  - `netsentry_sensor enrol`;
  - `/api/netsentry/sensor/install.sh` (systemd), an Ansible playbook and cloud-init.
- **Auditor role.**
- **UI (organisation mode):**
  - Network page: map, internet exposure, coverage, devices, rollout;
  - Reports page;
  - apps table and setup checklist on Home;
  - policy panel and owners in Setup › Your apps;
  - app › Who has access.
- **Fixed on the way:**
  - security-advisory matching now respects `patched_versions`, which removed false "needs a security update" on current Grafana/Gitea and 2 on Jellyfin 10.10.7;
  - single-file bind mounts are no longer "disks";
  - stale ARP entries no longer count as devices.
- **Proof:**
  - `tests/lab/office.py e2e` passes from a clean start:
    - the join-token rollout;
    - the network consent and discovery (wiki-02 and the router named);
    - templates and 17 office verdicts;
    - Gitea accounts;
    - Odoo hardened by hand;
    - a new device flagged;
    - the report.
  - `install.sh` ran end to end in a clean container (systemd stubbed).
  - `lab.py e2e` (home) still passes.
  - Tests: 104 JS and 89 monitor; the gate is green.
  - Hand-tested in the browser: Network, Reports, Who has access, the policy panel and the checklist.
- **Deployed** to 8471 after a backup (`…-before-v2-p3`).
- **Not built:**
  - **Owners-get-their-app's-alerts routing:** owner is a name, not a notifier.
  - **Exceptions with expiry:** those are P5's accepted-risk register.
  - **Windows install script:** Linux only.

## Status — v2 P4 (cloud: Riya), P5 (trust), P6 (release)

**P4 — cloud VPC (AWS first, keyless):**
- **The monitor** reads the instance's network with its own role (no keys):
  - reads: security groups, the subnet's network ACL and route table, disks and snapshots;
  - a permission self-test on every read;
  - an AWS dry run of "could this role change a security group?".
  - GCP and Azure report their permissions too.
- **Cloud reachability** (`lib/v2/cloudreach.js`) runs public address → route to an internet gateway → first matching ACL rule → security group. A layer NetSentry can't read counts as open. The VPC is the "local network".
- **Checks:**
  - CLD-ADMIN-PORT-OPEN, CLD-IMDS-V1, CLD-VOLUME-UNENCRYPTED, CLD-NO-SNAPSHOT;
  - NS-CLOUD-ACCESS and NS-IDENTITY-TOO-BROAD.
  - v1 CLD-001/005/006 step aside.
  - Steps are given for the console, the AWS CLI and Terraform.
- **Fix:** `cloud.aws.revoke_ingress` removes exactly one whole-internet rule. It needs an opt-in role right plus fixing switched on at the instance, and it can put the rule back.
- **Keyless enrolment** (`/api/netsentry/join-aws`, `sensor enrol --aws`):
  - the instance signs `sts:GetCallerIdentity`, bound to the console's address by a signed header;
  - the console sends it only to the global STS endpoint;
  - allowed roles are in `settings.cloud_enrol_roles`;
  - a replay can't enrol twice.
- **Proof:** `tests/lab/riya.py e2e` against moto (an open-source AWS emulator) with an emulated metadata service:
  - keyless enrolment, VPC reach and 7 verdicts;
  - the SSH rule closed at AWS by NetSentry and verified;
  - a snapshot turning backups green;
  - no v1 duplicates.
  - The reachability engine is tested on 288 combinations.
  - **Not yet run on a real AWS/GCP/Azure account.**

**P5 — trust:**
- **Freshness:** a pass on evidence older than 3 collector intervals (at least 30 minutes) becomes "can't tell".
- **NetSentry-itself checks** (§16.10): NS-STALE-DATA, NS-SOURCE-FAILING, NS-PERMISSION-MISSING, NS-UNMONITORED-MACHINE, NS-MODEL-DISAGREES, NS-CATALOGUE-OLD and NS-IDENTITY-TOO-BROAD.
- **Self-exposure:** NetSentry recognises its own console as an app (`/api/netsentry/whoami`, confirm-required), so the reach check covers it.
- **Accepted-risk register:**
  - a reason and an end date (required, at most a year, in organisation mode);
  - the check reads "accepted", then lapses by itself, and the digest says so;
  - the `#/accepted` page lists them.
- **Versions:** every check and app entry has one, listed in `docs/CHECKS-CHANGELOG.md` and enforced by a test.
- **macOS:** networks come from `netstat -rn`.
- **Docs:** `docs/PLATFORM-MATRIX.md` (what was proven where); an independent security review of the attack surface.

**P6 — release:**
- **Release migration 1700000019:** v1 issues that a v2 check replaced are resolved, and v1 activity alerts move to Activity. Tested on a copy of Ahmad's real v1 pb_data.
- **`assets` is not renamed** (plan §32 B1).
- **Docs:** ARCHITECTURE (v2 section), DEPLOYMENT (rollout), PERMISSIONS (v2 cloud, app keys) and guides per situation (GUIDE-HOME / ORGANISATION / CLOUD). Build decisions are in plan §32.

**Security review (2026-09-30), `docs/SECURITY-REVIEW.md`:** 13 findings; 10 fixed. The main fixes:
- `pb_hooks/security.pb.js` blocks PocketBase's superuser API. It refuses impersonation, logs, backups (creating one is still allowed), settings, schema changes and record writes.
- REST writes are refused by default for every collection.
- The monitor keeps its own allow-list of what it reads and which TCP questions it sends.
- The executor checks the target of every fix.
- `settings.console_url` is the only address used for the install script and keyless enrolment.
- The agent can no longer do what would silence NetSentry.

Still open: #8 (a website check could be redirected to an internal address) and two low-severity findings.

**Upgrading monitors:** a monitor older than the console doesn't have the v2 parts. NS-STALE-DATA now says "the monitor is older than NetSentry — update it" instead of "out of date".

**Proof:**
- 113 JS tests and 93 monitor tests pass; the gate is green.
- `lab.py`, `office.py` and `riya.py` e2e pass from a clean start.
- `install.sh` ran in a clean container.
- The upgrade was tested on a copy of the v1 backup.

**Deployed to 8471:** P3 (backup `…-20260930-232321-before-v2-p3`), then P4–P6 plus the security fixes (backup `…-20261001-001449-before-v2-p4-p6`). Migrations 16–20 are applied, and Ahmad's monitor checks in. His v1 host issues had already been resolved by the P3 run, so migration 19 had nothing to move.

## Status — v3 (one app to run the server and keep it safe), docs/SYSTEM-V3-PLAN.md

Approved 2026-10-01 with every recommendation (V3-D1…D9). Build decisions: plan §21 B1–B12.

**Built:**
- **M1 health:** CPU, memory, disk, temperature, per-app numbers (`metrics`, 1m/15m/1h tiers, kept 90 days); disk health (SMART, mdadm, ZFS); failed services; restart loops; Docker log growth; "restart needed". Checks UP-RESTART-LOOP, UP-SERVICE-FAILED, HL-*.
- **M2 control:** start/stop/restart of containers and services and logs on request (secrets masked on the machine). One change pipeline (`remediations.purpose`); typed actions only; plan hash; a person confirms (never the agent); only the machine's own monitor runs them. Check-in every 10 s, 2 s while someone watches.
- **M3 updates:** registry intel (Docker Hub, GHCR) → patch/minor/major and risk (databases' majors never automatic). Safe update on the machine: pull → stop → copy settings → recreate with only what the owner set → health gate → undo by itself. Roll back for 14 days. Maintenance windows for opted-in apps. OS security updates (risky packages left for a person) and a planned restart.
- **M4 backups:** NetSentry's own backups to a local/NAS folder (settings + database dumps), checksums, retention 7/4/6, regular restore tests, restore.
- **M5 installs:** 15 app templates, rendered by the console as data and validated by the monitor's own allow-list; passwords generated on the machine; reach set at install.
- **M6 fleet + org:** many machines at once (batches stop at the first failure), CSV export of changes, Odoo account review (admins, stale users).
- **Windows monitor:** `install.ps1` (embeddable Python pinned by SHA-256, SYSTEM startup task). **Monitor image:** `sensor/Dockerfile`, compose + Unraid template, GHCR workflow.

**Blocked:** M0's CraftBot part (machine channel, machineRoutes). The framework permission check refused it as weakening the caller guard. It waits for Ahmad's go-ahead (§21 B1).

**Found by hand-testing, fixed (B10–B12):**
- A stopped old container left for Roll back was adopted and started by `docker compose up`. It is now removed, and Roll back rebuilds it.
- An update lost image-declared volumes (the real Sonarr's `/config`).
- A long change froze the monitor's check-ins. Changes now run on their own thread.
- Jellyfin 12 release tags were mistaken for nightlies.
- PocketBase mismatched filter values with a backslash; `repo.find` works around it (Windows drives broke every check).
- The Odoo template lost `data_dir` (every page answered 500) and used the wrong user id.

## Status — v4 (one server, easy to use), docs/SYSTEM-V4-PLAN.md

Approved 2026-10-01: "yes to all" (V4-D1…D10). NetSentry looks after **the server it runs on, and nothing else**.

**N0 done:**
- The Windows uninstall bug is fixed (15/15 steps pass in Windows Sandbox).
- v3 is deployed to 8471; the pb_data backup was taken first.

**N1 built and walk-verified (PASS, round 10, 2026-10-01; lab only; not yet deployed to 8471):**
- **Removed:**
  - machines and enrolling other machines (keyless cloud enrolment, rollout files);
  - the fleet: batches across machines, its CSV export, M0;
  - watching domains, websites and IP addresses (14 rules, 6 collectors, their playbooks and fixtures);
  - device discovery;
  - home/organisation modes, reports, policy templates.
- **Kept, for installing and updating the monitor on this server:**
  - join tokens;
  - `install.sh` / `install.ps1`.
- **Migration 1700000026:**
  - retires the old outside assets;
  - resolves the issues of removed checks;
  - moves HOST-004 to Activity;
  - deletes the dead schedules;
  - adds `help_requests`.
- **New operations:**
  - `home.overview`: server summary, To fix grouped by cause (`lib/v2/todo.js`), and the apps with their running state;
  - `changes.prepare-fix`: a built-in fix behind the same confirm as every change;
  - `help.ask`, `help.pending`, `help.answer` and `help.withdraw` (a person takes back a waiting question), with the `help_requested` trigger. The question is read back through `help.pending` and is never a trigger parameter.
- **UI:**
  - menu Home · Apps · Server · Activity · Settings;
  - new Home (`pages/ServerHome.tsx`);
  - App page with tabs;
  - Server page (`pages/Server.tsx`);
  - setup is "look after this server" (the real installer);
  - Settings → Monitor;
  - "local network" and "server" wording, plain labels for every check.
- **Fixed on the way (all on Windows):**
  - PocketBase mishandles backslashes in filter values; `repo.find` now handles them (C20).
  - Uninstall could not remove the monitor's folder: the monitor now runs from `%SystemRoot%`.
- **Walk-verify rounds 1–4 (2026-10-01):** each round's defects were fixed. Changes made:
  - one confirm for every change: a prepared fix marks nothing until it is confirmed;
  - no auto-approval;
  - the monitor waits for the console instead of quitting;
  - the backup folder is created safely;
  - app names appear in titles;
  - the issue-page preview stays open across monitor reports.
- **Backups are judged per app (round 4):**
  - BKP-NONE v3 covers an app only with a copy of that app and no newer failure;
  - BKP-STALE v4 checks only backups that another tool runs;
  - Home groups failing backups as "Backups of N apps aren't working", with a button to see what went wrong;
  - an app's Backups tab shows that app's own last copy and last failure.
- **Walk-verify round 5:** the round-4 fixes held; defects were found and fixed:
  - built-in fixes were missing from "Changes made" because `changes.list` filtered out an empty `purpose`;
  - change-history rows showed rule ids;
  - the daily summary now uses Home's grouped to-fix list and count;
  - `home.overview` `server.backups` counts per app (`apps_failing`, `apps_not_backed_up`);
  - operation descriptions now speak of one server.
- **Walk-verify round 6:**
  - App pages still missed built-in fixes, because a fix never recorded which app it was for. Fixes now record it (`appOfFinding` in remediations.js), and migration 1700000027 fills it in for existing rows.
  - The operation descriptions are now edited at their source, `scripts/gen-operations.cjs`; operations.json is generated from it.
  - Wording: "local-network", "N new problems", a plain tamper-check line, "Started" without the backup note, one "to look at" count on the Apps list, and "Name shown at the top".
- **Walk-verify round 7 (no major defects):**
  - The Docker-publishing group now names its apps. Home maps a container to its app, and the steps use each app's real ports, for example "8096:8096" → "127.0.0.1:8096:8096".
  - The problem table offers only today's areas. Retired areas still show a name on old rows.
  - A question nobody answers says so after 15 minutes. Waiting questions always stay in sight, and `help.withdraw` takes one back.
  - Server History says new / gone / changed, as Activity does.
- **Walk-verify round 8 (no major defects):**
  - A server check that names a container now records the app in the problem's evidence (`withApp` in findings.js), so the problem shows on that app's page and tile; migration 1700000028 fills it in for problems already stored.
  - The App page lists the same problems Home counts for it, and Home's round-7 container mapping is removed.
  - The area label is "Security", and the link to the audit log points to the right place.
- **Walk-verify round 9:**
  - The Apps list counted problems from the newer checks only. It now counts open problems that name the app, the same way as Home's tiles and the app page (one count everywhere).
  - In a grouped item, each app name links to that app's page, and a multi-app group's button says whose steps it opens.
  - A group with one problem uses that problem's own title.
  - The score page explains that it counts problems, while Home counts things to fix.
- **Walk-verify round 10: PASS.** Three small issues are left for later:
  - The problem table's Docker rows use the check's own wording and container names.
  - Activity → Network's empty-state hint shows the setting name `NETSENTRY_PIHOLE_URL`.
  - A backup that can never work (for example Node-RED with nothing to copy) is retried at every hourly check, and each failure is logged as "didn't work · put back".
**N2–N4 built 2026-10-01 ("complete the app"), lab-proven; walk-verify PASS (round 6, 2026-10-02); deployed to 8471 2026-10-02 (backup `netsentry-pb_data-backup-20261002-111341-before-v4-n2-n4`). Design: SYSTEM-V4-PLAN.md §15 (N-B9…N-B21):**
- **One read channel.** `server.read` / `server.read-result` / `sensors.read-reply` (services/serverreads.js ↔ sensor reads.py). It covers files, app settings, Compose checks, disk, programs, firewall, users and schedules, and Tailscale's sign-in link.
- **New typed changes** (v2/actions.js ⇄ executor.py V4_ACTIONS), all admin-confirmed: `files.write/mkdir/move/delete/upload`, `app.settings.set`, `app.compose.apply`, `app.remove`, `app.install` (template `custom`), `disk.cleanup`, `process.stop`, `firewall.allow/remove/enable`, `ssh.key.add/remove`, `schedule.set`, `remote.tailscale.install`, `command.run`.
- **Monitor modules:** files.py, compose.py, disk.py, procs.py, firewall.py, keys.py, schedules.py, remote_access.py, terminal.py, reads.py.
- **Console services:** jobs.js, serverreads.js, terminal.js and transfers.js. Migrations:
  - 29 adds the new purposes, `file_transfers`, `terminal_sessions` and `terminal_io`;
  - 30 adds the `undone` status;
  - 31 makes transfers writable through operations only.
- **Undo** (`changes.undo`, people only): files and removals for 7 days, settings 14, firewall, keys and jobs 30. The monitor reverses a change from what it recorded.
- **Apps NetSentry doesn't recognise** (catalogue `generic.js`) are apps too, so a pasted-Compose install can be managed like any other.
- **UI:**
  - Server tabs: Files, Disk space, Programs, Scheduled jobs, Terminal (xterm.js), plus the firewall, reach-from-away and keys panels;
  - an App Settings tab and Remove…;
  - Add an app → paste a Compose file.
- **Installer:** asks about the terminal (NETSENTRY_TERMINAL, NETSENTRY_TERMINAL_USER = the sudo user; on Windows it runs as SYSTEM, which the question says).
- **Security review** C21–C32 (docs/SECURITY-REVIEW.md).
- **Fixed on the way:**
  - bootstrap.pb.js declared things at the top level that its handlers can't see, so refusals were 400 and people couldn't change their own password;
  - a refusal read as "put back";
  - "remove everything" failing half-way left the app stopped.
- **Tests:** monitor 146 (test_v4.py) and console 112.
- **Lab-proven:** files (save, stale save refused, rename, delete then Undo, read-only refusal, upload, download), programs (stop; sshd refused), cron pause then Undo, keys add/remove (700/600), firewall (allow, switch on, last-SSH refusal, Undo, close), a custom install (unaccepted risk refused, accepted installed), settings change then Undo, Compose edit (privileged refused, then accepted, then Undo), remove keep and everything with Undo, the terminal as joe (masked transcript), commands (masked output, exit code shown), disk clean-up.
- **Not proven in the lab:** a Tailscale sign-in (it needs an account).
- **Walk-verify N2–N4 round 1 found defects, now fixed:**
  - app names replaced parts of words in change text (a container called `pt` turned "kept" into "kePlex"); now only whole names are replaced;
  - a terminal ended on one dropped connection; the monitor now retries for about 8 s and keeps the output;
  - a command's output just before `exit` was lost; it is now kept;
  - close reasons are plain words;
  - a removed app's page now says so and shows no controls;
  - the settings preview lists each new value;
  - a pasted private key is refused with a specific reason;
  - nits.
- **Walk-verify round 2 found one major defect, fixed:** the terminal polled `/api/ops` 10 times a second and hit the 300-per-minute limit. The stream now has its own route and the console holds requests while idle (C33). Nits fixed: upload sizes, installs can be undone, no lone "Nothing." in previews.
- **Walk-verify round 3 confirmed the terminal fix** (a 5.5-minute session, no 429s). It found the Settings tab crashing for apps NetSentry can't change. Fixed at the source: the monitor always returns what Docker says the app runs with, and the screen doesn't assume the lists. Also fixed: the app header reads the same container report as Home, the install page says when it's finished, and 0.0.0.0 reads "every address".
- **Walk-verify round 4: no major defects.** Minors fixed:
  - a change waiting for a person gets Review in Changes made (`previewOf` moved to Controls);
  - the monitor checks in between its checks, so a read right after a change is answered in about 10 s, not 30;
  - volumes are named in words, with no sideways scroll on phones;
  - nits.

  It couldn't open a live terminal (the permission check refused reading the lab password); my own lab script covers that.
- **Walk-verify round 5: no major defects.** Minor fixed: a settings save or Compose edit started a stopped app. A stopped app now stays stopped (`up --no-start`), and Undo puts it back as it was. Nits fixed.
- **Upgrade test passed** on a copy of 8471's pb_data, on a throwaway console at 8494: migrations 29–31 applied, 23 apps and 52 open problems intact, no errors.
- **Walk-verify round 6: PASS.** Optional nits fixed: Save labels are neutral, and Compose-edit wording no longer says "bring it up".
- **N5 done 2026-10-02 (Ahmad: "please complete"):**
  - **Name:** "NetSentry" is kept.
  - **Packaged** for the marketplace: manifest placeholders, and a catalogue entry with the v4 description at version 1.0.0. A simulated install, with only the shipped files and the placeholders filled, passes the full gate. No pb_data, lab state or tokens ship.
  - **Agent one tap, lab-proven:** three scripted breakages (an app stopped, a runaway cron job, an unreadable file). Each time the agent prepared the fix with its own credential and answered; its own confirm was refused (403); a person's single confirm fixed it, checked on the server.
- **Still not proven:** a real Tailscale sign-in (needs Ahmad's account) and the real CraftBot agent (proven via its credential and operations, not CraftBot itself).
- **The owner's monitor ("Home") is offline on v0.1.0.** Re-run its installer (Settings → Monitor) to get the new jobs and the terminal question.
- **Note:** this folder is now a marketplace template (`{{PORT}}`), so `agent-app dev` on it no longer starts 8471. The 8471 that is running keeps running; after that, install it through CraftBot.

## Status — v4 N6 (Slate look + live data), docs/SYSTEM-V4-PLAN.md §16

Approved 2026-10-02 from the mockup; Ahmad chose **NetSentry forces Slate** and **realtime in the same pass**.

- **Look**: `frontend/src/app/theme.css` sets the kit colour tokens (light + dark, `!important`); kit files untouched.
  `ProblemCard` used `text-white` on the accent → `--agent-app-accent-contrast`.
- **Home** (`pages/ServerHome.tsx`): status card with live graphs, Needs-you tiles, apps beside Recent activity
  (`changes.list` + `changes` of kind `container.health`), Ask the agent. No timer: reloads on findings,
  remediations, backup plans, apps, monitors and live app states.
- **Confirm drawer** (`components/Controls.tsx` `useChange`): kit `Drawer`, stepper, live progress from the change's
  own record, Undo via `changes.undo`. Change history follows `remediations` (no 15 s timer); log *Follow new lines*
  asks again as soon as an answer arrives.
- **Live**: migration `1700000032_v4_live_status.js` (`live_status`, one record per server, people read, nobody writes);
  `sensors.live` (sensor-only: stores a re-shaped sample — `services/live.js` — and answers whether anyone still
  watches); check-in config `live: true` while watched (`changes.watching`). Frontend `lib/liveStatus.tsx`
  (`LiveProvider` in `App.tsx`: watch while the tab is visible, follow `live_status`, 40-point history, stop/start toasts).
- **Monitor** (`sensor/netsentry_sensor/live.py`): sampler thread (2 s, stops when the console says nobody looks);
  Docker events thread (Engine API `/events`, CLI fallback) → `Runner.poke()` makes containers/stats/probe due now and
  wakes the loop. `collectors/storage.py` `usages()` shared; `containers.py` `DockerApi.stream()`.
- **Undo**: a restart is not undoable (`changes.undoDays`).
- **Apps** (`pages/Apps.tsx`): list beside `AppPage` (`embedded`) at ≥1024 px; `#/app/<id>` routes there too.
- **Proof (lab 8495)**: samples every 2.0 s; an app stopped on the server showed in Home's report and Needs-you in
  ~1 s and its change record (running → exited) was kept; started again, cleared in ~0.8 s; sampling stopped once the
  watch ran out; people writing `live_status` or calling `sensors.live` → 403. Tests: console 115 incl. live.test.js,
  monitor 153 (test_live.py); gate passes.
- **Walk-verify (2026-10-02): PASS in round 4.**
  - Round 1 found D1–D8: the headline's urgent count, the stopped app hidden and with no Start button, a tile with two buttons, Undo outside the drawer, the live subscription stopping after a page load, no not-live fallback, and the Server tabs cut off.
  - Round 2 found Home slow to clear after an Undo, plus wording issues.
  - Round 3 found it still slow, at 8–10 s. Two causes: the event's checks waited behind slow checks (they now run on their own thread), and the first probe ran before Docker had the app's port up (the monitor now probes again 1–20 s after a start).
  - Also found and fixed: a 429 in the middle of a change left it "executing" (fixed by retries and the report outbox, C36).
  - Round 4: Home clears 0.5–2.5 s after Start or Undo, no change hung, and there were no regressions.
- **Not deployed to 8471** (the folder is the template; 8471 needs a rendered copy and a pb_data backup first).

