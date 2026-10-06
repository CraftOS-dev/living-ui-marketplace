# Requirements: NetSentry — Increment 1 (Foundation + Attack Surface)

Binding spec for the build that walk-verify checks against. Full product plan:
`docs/PLAN.md`. This increment is phases **P0 (foundation)** and **P1
(external attack surface, "Tier 0")**. Later phases extend this file under
`## Changes`, never by silently rewriting it.

## Purpose

NetSentry is a team security console that watches what an organisation exposes
to the internet — domains, subdomains, public IPs, open services, known
vulnerabilities, certificates, DNS/email configuration, domain registration and
blocklist reputation. It explains every finding in plain language with fix
steps. An agent operates the same data through declared operations.

## Scope of this increment

**Goals**
1. A user can add a domain or IP and, within one scan, see real observations
   and findings fetched from live public sources (no mock data).
2. Findings open, auto-resolve, reopen and can be acknowledged/suppressed with
   an auditable trail.
3. A multi-user workspace with admin/analyst/viewer roles enforced server-side.
4. Every mutation is recorded in a tamper-evident (hash-chained) audit log.

**Not in this increment** (later phases, see docs/PLAN.md): incidents &
correlation, agent triggers, alert notifiers, the Sensor (host/network/cloud),
remediation execution, lookalike domains, web-header checks.

## Product perspective

- `authMode: multi-user`. One workspace per install.
- Data sources (all keyless, called from hooks only): Shodan InternetDB,
  Cloudflare DNS-over-HTTPS, crt.sh (fallback: SSLMate CertSpotter), RDAP
  (rdap.org), CISA KEV, FIRST EPSS, Spamhaus DROP, abuse.ch Feodo Tracker and
  URLhaus host file.
- Passive only: NetSentry never port-scans or probes targets in this increment.

## Constraints

- C-1 Roles: `admin`, `analyst`, `viewer`. Fixed vocabulary.
- C-2 Severities: `info`, `low`, `medium`, `high`, `critical`. Fixed.
- C-3 Finding statuses: `open`, `acknowledged`, `resolved`, `suppressed`. Fixed.
- C-4 Asset kinds a user may add: `domain`, `ip` (IPv4). `subdomain` and `ip`
  may also be discovered automatically (ownership `discovered`).
- C-5 Asset ownership: `unverified`, `verified`, `discovered`.
- C-6 Source health: `unknown`, `ok`, `degraded`, `failing`.
- C-7 Audit log and change log are append-only; no role can edit or delete rows
  (retention pruning of the change log by an admin is the only exception).
- C-8 Only human admins may change roles or workspace settings; the agent never can.

## Assumptions

- A-1 Volume ceiling: 500 assets, 5,000 observations, 2,000 findings per workspace.

## Features

### Workspace
- F-WS-1 The first account registered becomes `admin`. After that, sign-up is
  closed unless an admin opens it; accounts created while open become `viewer`.
- F-WS-2 An admin can change a member's role. The last admin cannot be demoted.
- F-WS-3 An admin can open or close sign-up and rename the workspace.
- F-WS-4 Everyone can view the audit log: time, actor (user email / agent /
  system), action, target. An admin can run "Verify chain", which reports
  "intact" or the first broken entry.
- F-WS-5 Non-admins see settings and role controls as read-only (no editable controls).

### Assets
- F-AS-1 An analyst or admin can add a domain or IPv4 address. Invalid input is
  rejected inline with the reason; a duplicate is rejected with "already watched".
- F-AS-2 The assets list shows kind, identifier, ownership, open findings count
  and last seen, with a search box and kind filter.
- F-AS-3 Asset detail shows observations grouped by kind, a change timeline,
  its findings, its sources, and (for domains) the ownership-verification
  TXT record to publish.
- F-AS-4 "Verify ownership" checks DNS TXT for `netsentry-verify=<token>` and
  reports verified / not found.
- F-AS-5 "Scan now" runs every source of that asset immediately and shows the outcome.
- F-AS-6 Scanning a domain discovers its IPv4 addresses (A records) and, from
  certificate transparency, its subdomains; these appear as assets with
  ownership `discovered` linked to their parent.
- F-AS-7 An analyst/admin can retire an asset (scanning stops). An admin can
  delete an asset after a confirmation that names what will be removed.

### Scanning & sources
- F-SRC-1 Adding an asset creates its sources automatically (domain: DNS,
  certificate transparency, registration, reputation; subdomain: DNS; IP:
  InternetDB, reputation).
- F-SRC-2 Sources run on schedule in the background; failures back off and mark
  the source `degraded` (1–2 consecutive failures) or `failing` (3+).
- F-SRC-3 The Sources page lists every source with target, health, last run,
  next run and last error, plus recent scan runs; "Run now" per source.
- F-SRC-4 Threat intelligence (KEV, EPSS, blocklists) refreshes daily and its
  freshness is shown.

### Findings
- F-FD-1 The findings queue lists open findings sorted by severity with filters
  for severity, status and category.
- F-FD-2 Opening a finding shows its rationale, evidence and remediation steps.
- F-FD-3 An analyst/admin can acknowledge, resolve (with note) or suppress
  (reason required, optional expiry) a finding; viewers cannot.
- F-FD-4 WHEN a later scan no longer shows the problem, the finding SHALL become
  `resolved` automatically; WHEN it reappears it SHALL reopen.
- F-FD-5 Checks in this increment: EXP-001 sensitive service exposed, EXP-002
  exposed service with known CVE (critical when in CISA KEV), EXP-003 open port
  not in accepted baseline, DNS-001 DNS record changed, DNS-002 dangling CNAME,
  MAIL-001 SPF/DMARC missing or not enforcing, CT-001 certificate from a
  new issuer, CT-002 new subdomain discovered, TLS-001 latest certificate
  expiring soon, REG-001 domain registration expiring, REP-001 asset on a blocklist.

### Rules & baselines
- F-RL-1 The rules page lists every check with category, severity and enabled
  state; an admin can enable/disable and override severity.
- F-RL-2 An analyst/admin can accept an IP's current open ports as its baseline;
  EXP-003 then stops flagging those ports.

### Overview
- F-OV-1 Overview shows the posture score (0–100) with its breakdown, open
  findings by severity, changes in the last 24 hours and source health.
- F-OV-2 With no assets, Overview shows an onboarding empty state with an input
  to add the first domain or IP.

### Agent (via operations)
- F-AGT-1 The agent can add assets, rescan, read posture, read an asset
  timeline, explain/acknowledge/resolve/suppress findings, accept baselines and
  run sources — exactly the operations in `operations.json`.
- F-AGT-2 Every agent mutation is recorded in the audit log with actor `agent`.
- F-AGT-3 The agent cannot change roles or settings (rejected with 403).

## Non-functional

- N-1 Every external call has a timeout (≤ 60 s) and a failure never blocks
  other sources in the same scheduler tick (tick budget 40 s).
- N-2 No external request is made from the browser.
- N-3 First paint on an empty database produces no errors.

## Data (collections)

users(+role) · settings · audit_log · assets · sources · scan_runs ·
observations · changes · rules · baselines · findings · suppressions · intel ·
indicators — field lists in `AGENT_APP.md`. Domain collections are read-only
over the REST API for signed-in users; all writes go through operations.

## Out of scope (this increment)

Incidents, correlation, triggers, notifiers, sensors, remediation, network
traffic, host checks, cloud accounts, identity, code, devices, lookalike
domains, active scanning, IPv6 assets, CIDR ranges, CSV import/export.

## Changes

- 2026-09-30 — Increment 1 defined (P0 + P1).
- 2026-09-30 — **Increment 2 (P2: incidents, agent loop, alerts)** added below.
  Decision: admins may enter webhook / heartbeat URLs (stored encrypted).

### Increment 2 features

**Incidents**
- F-IN-1 WHEN a finding of severity high or critical opens, reopens, or is
  raised to high/critical, it SHALL join the active incident for its root asset
  (the domain it was discovered from, or itself), or open a new incident. Lower
  severities never open incidents.
- F-IN-2 The Incidents page lists incidents with severity, root asset, finding
  count, status and "Needs triage", filterable by Active / Awaiting triage /
  Mitigated / Closed.
- F-IN-3 Incident detail shows the assessment (summary, who triaged, when,
  confidence), linked findings, and a timeline of system events and notes.
- F-IN-4 An analyst/admin can change status (new → investigating → mitigated →
  closed / false positive; closed and false positive need a note), assign a
  member, add notes, write the assessment, or ask the agent to triage.
- F-IN-5 WHEN every linked finding is resolved or suppressed, the incident SHALL
  become mitigated automatically with a timeline entry.
- F-IN-7 WHEN a finding linked to a mitigated incident is present again (reopened
  by a scan or unsuppressed by a person), the incident SHALL reopen to
  investigating with a timeline entry, and severity SHALL follow its findings
  up and down.
- F-IN-6 Overview shows active incidents and how many await triage; the nav shows
  an active-incident count; a finding in an incident links to it.

**Agent loop**
- F-TR-1 Opening or growing an incident fires `triage_queue_ready`; a failing
  source (3 consecutive failures) fires `source_unhealthy`; the digest fires
  `daily_digest`. Fires land as pending requests (verifiable without an agent).
- F-TR-2 The agent can list incidents awaiting triage, read a bounded context
  bundle (evidence marked untrusted), and record a triage, which clears
  "Needs triage" and appears in the UI attributed to the agent.
- F-TR-3 "Ask agent to triage" shows the request's state honestly (waiting / working / done).

**Alerts (independent of any agent)**
- F-AL-1 An admin can add alert destinations: webhook (Slack, Discord, ntfy,
  JSON), heartbeat (pinged every N minutes), or email via CraftBot. URLs must be
  public https; private, loopback, link-local and internal hosts are refused.
- F-AL-2 Destination URLs are never returned by the API; only a hint is shown.
- F-AL-3 "Test" sends a test alert and reports delivered / the failure reason.
  Each destination shows its last result.
- F-AL-4 New incidents (and critical findings joining one) alert destinations
  whose minimum severity they meet; failing sources alert at medium.
- F-AL-5 A daily digest is sent at the configured UTC hour (or off) to
  destinations with "digest" on; an admin can send it now.
- F-AL-6 Only human admins manage destinations; the agent is refused.

**Correctness fix in this increment**
- Certificate transparency fallback (CertSpotter) is treated as a partial view:
  it only adds names/issuers, never removes or modifies them, and issuer names are
  normalised across sources.

- 2026-09-30 — **Increment 3 (P3: the Sensor, host security)** added below.

### Increment 3 features

**Sensors**
- F-SN-1 An admin can register a sensor by name and receives a token shown once,
  with the exact command to run. Sensors are listed with status (pending /
  online / offline / revoked), host, OS, whether it runs as admin/root, cloud or
  container environment, last check-in, and per-collector availability with reasons.
- F-SN-2 A sensor can only check in and report; people and the agent are refused
  on those operations, and a sensor cannot read any workspace data.
- F-SN-3 On first check-in a `host` asset is created and linked, with one source
  per sensor collector; sources show "Reported by sensor", and "Unavailable" with
  the reason when the host cannot provide that data.
- F-SN-4 An admin can revoke a sensor; its token stops working immediately.
- F-SN-5 WHEN a sensor stops checking in for 10 minutes, RES-002 SHALL open on its
  host (and alert like any high finding); it resolves when the sensor is back.
- F-SN-6 Reports are validated (declared kinds only, size caps, sane timestamps);
  the sensor spools reports while the console is unreachable.

**Host checks** (on sensor data)
- F-HO-1 HOST-001 sensitive service listening on all interfaces; HOST-002 Docker
  port published on all interfaces; HOST-003 SSH password / root login;
  HOST-004 new listener vs baseline (baseline from the first report; "Accept current
  listeners" on the host page); HOST-006 new user, new administrator or SSH key;
  HOST-007 security updates pending > 7 days; HOST-008 watched critical file
  added / changed / removed; HOST-009 new autostart entry; DEV-001 disk not
  encrypted; DEV-002 host firewall off; DEV-004 real-time antivirus off.
- F-HO-2 HOST-005 failed-login burst (≥20 from one source in 15 min) and HOST-016
  successful login from a source with ≥10 recent failures (critical). Because
  host findings share the host's root, a break-in chain lands in one incident.
- F-HO-3 Event checks (HOST-006/008/009) never fire on a collector's first report.
- F-HO-4 Command lines are redacted on the host (passwords, tokens, URL
  credentials, long keys); SSH keys are reported by fingerprint only.


- 2026-09-30 — **Increment 4 (P4: network monitoring)** added below.

### Increment 4 features

- F-NW-1 The sensor reports which programs talk to the network and aggregated
  outbound connections and DNS lookups (signals), and IDS alerts when Suricata or
  CrowdSec is installed; unavailable with the reason otherwise.
- F-NW-2 NET-001 contact with a blocklisted IP/domain (Spamhaus, Feodo, URLhaus);
  NET-004 tunnelling-like or generated DNS names; NET-006 mining-pool/backdoor
  ports; NET-007 new program on the network (silent on first report); NET-008 Tor
  ports; NET-009 IDS alert.
- F-NW-3 A Network page shows destinations, DNS names, programs and IDS alerts.
- F-NW-4 Existing hosts get newly added collectors without being re-added.

- 2026-09-30 — **Increment 5 (P5: fixes applied by the agent, verified by NetSentry)** added below.

### Increment 5 features

- F-FX-1 Each finding lists the fixes that apply to it (playbooks) with risk,
  downtime, cost, lockout risk and what verifies it.
- F-FX-2 An analyst can ask the agent for a plan; the agent writes concrete steps
  with rollback for each, blast radius and downtime.
- F-FX-3 ONLY a human admin can approve or reject a plan. Approval is bound to the
  exact plan (hash) and expires after 24 h; `high` fixes need a backup reference
  before they may start.
- F-FX-4 The agent claims an approved fix, reports every step, and completes with
  the hash of the plan it executed; a mismatch fails the fix and flags it.
- F-FX-5 After completion NetSentry re-checks the finding with its own rule on the
  next report: resolved → done, still present → failed. `guided` fixes are done
  by a person and marked manually.
- F-FX-6 An admin can pause all fixes (kill switch) and may allow automatic
  approval of the `auto` class only.
- ~~F-FX-7 Triggers `plans_requested` and `remediation_approved` wake the agent;
  every step is in the audit log.~~ Retired (N-B43, 2026-10-05): the agent never writes or runs command
  plans — it ran them on its own machine, not necessarily the server. A fix NetSentry has no built-in
  action for becomes the person's question to the agent, which prepares changes the server's monitor
  applies after a person confirms.

- 2026-09-30 — **Increment 6 (P6: cloud, via the instance's identity)** added below.

### Increment 6 features

- F-CL-1 On AWS/GCP/Azure the sensor reads its own cloud context with the VM's
  identity (instance role / service account / managed identity). NetSentry never
  asks for cloud keys. Without an identity it reports instance metadata and names
  the missing permission.
- F-CL-2 CLD-001 cloud firewall opens a sensitive port (or every port) to the
  internet; CLD-002 GuardDuty findings; CLD-003 security-group changes with the
  actor (high when opened to the internet; silent on first report); CLD-004
  GuardDuty off; CLD-005 unencrypted disk; CLD-006 IMDSv1 allowed.
- F-CL-3 A denied or failed cloud call never resolves existing findings.
- F-CL-4 A firewall change and the exposure it creates join one incident.
- F-CL-5 DEPLOYMENT.md and PERMISSIONS.md document every setup and the exact
  read-only permissions.

- 2026-09-30 — **Increment 7 (P7: breadth — web, code, more engines, GCP/Azure)** added below.

### Increment 7 features

- F-BR-1 Once a day the console requests each domain/subdomain's front page over
  HTTPS (only when it resolves to public addresses only) and records whether
  HTTPS works and which security headers are sent. WEB-001 missing HSTS /
  clickjacking protection / nosniff (low); WEB-004 HTTP works but HTTPS fails
  (medium). Response bodies are never stored.
- F-BR-2 On assets with VERIFIED ownership only, it checks whether `/.git/HEAD` or
  `/.env` is publicly readable — WEB-003 (critical).
- F-BR-3 Opt-in code checks on a sensor host (NETSENTRY_CODE_PATHS): lockfiles
  (npm, PyPI, crates.io, Go, Packagist) → OSV.dev (only name + version + ecosystem
  leave the host) → CODE-002, severity raised by EPSS and critical on CISA KEV;
  gitleaks when installed → CODE-001 (critical) with file/line/rule only, never
  the secret.
- F-BR-4 IDS alerts also come from Zeek (notice.log) and Falco (JSON output); DNS
  names on Linux also come from Zeek dns.log.
- F-BR-5 GCP and Azure VMs: firewall / NSG rules via the VM's own identity (CLD-001).
- F-BR-6 Playbooks for every new check (security headers, exposed files, HTTPS,
  rotate a leaked secret, upgrade a dependency).

Not in this increment (documented as gaps): identity/MFA checks (need connected
account integrations), lookalike domains, HTTP→HTTPS redirect check (the console
HTTP client always follows redirects).

- 2026-09-30 — **Increment 8 (P8: fleet & off-box evidence)** added below.

### Increment 8 features

- F-FL-1 A sensor can report from another machine: it requires `https://` for any
  console that is not on its own machine, never follows redirects, and accepts a
  private CA (`--ca-file`). DEPLOYMENT.md shows a reverse proxy that publishes
  only the three sensor endpoints.
- F-FL-2 Admins can export the whole audit log (`audit.export`, paged; Workspace →
  Audit log → Download) as JSON Lines; `scripts/verify-audit-export.cjs` verifies
  a copy anywhere, optionally against a checkpoint.
- F-FL-3 Every daily digest carries an audit checkpoint (entry number + hash).
- F-FL-4 DEPLOYMENT.md documents a separate security VM.

Not in this increment: whole-account / AWS Organizations scanning, built-in fleet
enrolment through CraftBot's share channel.

- 2026-09-30 — **Increment 9 (UX: plain words, five places, one to-do list, setup guide)** added below. Design: docs/UX-PLAN.md.

### Increment 9 features

- F-UX-1 Navigation has five places: Home, Issues, Protected, Activity, Settings. Old links (#/findings, #/assets/<id>, #/incidents/<id>, #/workspace…) open the matching new place.
- F-UX-2 The UI uses plain words: issue (not finding), case (not incident), machine monitor (not sensor), check (not source/collector), protected item (not asset), "expected" (not baseline), mute (not suppress). Severities carry an action word (Critical · Act now, High · Today, Medium · This week, Low · When convenient).
- F-UX-3 Home answers "Am I OK? What needs me?": a headline ("N things need you" / "All clear"), the security score with a one-line meaning, ONE "Needs you" queue (serious issues, grouped cases, fixes waiting for approval for admins, smaller issues rolled into one line, broken checks, missing alert destination), each item with one button; "Being handled"; and the protected items with their coverage.
- F-UX-4 A setup guide (#/setup) — choose what to protect; for a machine it shows the exact command (real folder path, per OS) and turns to "Connected ✓" live when the monitor reports; website/IP input; code and cloud instructions; alert destinations; what the agent can and cannot do. It opens automatically on the first visit when nothing is protected, can be skipped, and Home offers "Continue setup" until finished.
- F-UX-5 Issues has three tabs: Issues, Cases (only real groups are presented as cases), Fixes. An issue always reads: what we found → why it matters → how to fix it (do it yourself / let the agent do it / other options: I'm on it, I fixed it, not a problem — mute) → technical details collapsed.
- F-UX-6 A fix shows its progress as steps (Plan → Approval → Applying → Checking → Fixed, or the guided variant) with who acts next; risk is shown as Low risk / Medium risk / High impact / Done by you with a one-line meaning.
- F-UX-7 Protected groups items as Machines, Websites and domains, IP addresses and "Found automatically" (collapsed), each with a coverage badge and its worst open issue. An item page has Issues, Coverage, What we see, Changes (and "Found from this" for domains); Coverage lists each check as Working / Having trouble / Not working / Not available here / Starting / Turned off, and for "Not available here" says what would switch it on.
- F-UX-8 Activity has Network, Changes (7 days, all items) and Actions (a readable 7-day slice of the audit log). Settings has Machine monitors, Alerts, Team, General & fixes, Detection rules, Checks, Audit log.

- 2026-09-30 — **Increment 10 (two levels: Simple for everyone, Detailed for experts)** added below.

### Increment 10 features

- F-LV-1 A Simple / Detailed switch (sidebar; top of the page on phones; Settings) chooses the view for this person. Simple is the default.
- F-LV-2 Every check has an everyday-language version (lib/rules/plain.js): a plain title built from the issue's own facts, "what this means" and "what to do" steps a person without IT knowledge can follow. Each issue stores its plain title (`plain_title`); older issues get one automatically.
- F-LV-3 Simple view: plain titles everywhere (Home, Issues, item pages, cases, fixes); urgency words (Urgent / Important / Soon / When you have time); the issue view shows "What this means" and plain numbered steps, technical details collapsed; the Issues list is a simple list (no table, no "area" filter); cases read "N related problems on X"; fix plans show steps without commands; the score says "Higher is safer".
- F-LV-4 Simple view hides the expert places: Activity (network, changes, actions), an item's "What we see / Changes / Found from this" tabs and domain ownership proof, and Settings → Detection rules / Checks / Audit log (with a pointer to the Detailed view). Links to them still work.
- F-LV-5 Detailed view shows everything: technical titles (with the plain one underneath), severity + action ("High · Today"), the rule's rationale and technical fix, technical details open, the issues table with areas, commands in fix plans, and all places and tabs.

- 2026-09-30 — **Increment 11 (interactive Simple view: less text, more doing)** added below.

### Increment 11 features

- F-IX-1 Simple Home: a status ring (score, colour = state) with one line ("N things to look at" / "You're protected"); your things as tiles (icon, name, coloured dot + two-word state, tap to open); problems one at a time as a card with a counter, Previous / "Skip for now"; approvals and "set up alerts" appear as their own cards; "N being handled" as one link.
- F-IX-2 The problem card: urgency chip, icon, one-line plain title, "Why does this matter?" toggle, and big buttons — "Fix it for me" (asks the agent for a plan; nothing changes until approved), "Show me how" (the plain steps as a checklist; "I've done it" after every step is ticked), "It's fine" (confirm → hidden; for "something new appeared" issues: "I know this — it's fine" closes it). A fix already under way shows its state instead. Viewers see the card without action buttons.
- F-IX-3 The same card is the issue view in Simple (technical details collapsed below it) and the list on an item page, where a chip grid shows what is watched (✓ / ! / –; tap a chip for one line).
- F-IX-4 Protected in Simple is a tile grid (found-automatically items behind a toggle); the Issues list shows an icon per problem; intro paragraphs and page subtitles are hidden in Simple; setup choices are picture tiles.

- 2026-09-30 — **Increment 12 (does what it says: real "Check now", honest agent state, details per screen)** added below.

### Increment 12 features

- F-RL-1 "Check now" on a computer asks its monitor to run every check straight away (picked up at the next check-in, every 30 s); the message says whether that happened, or that the monitor is not running / not set up.
- F-RL-2 "Fix it for me" says plainly when no AI agent has ever worked in NetSentry (NetSentry never changes machines itself), offers "Show me how instead" and "Ask anyway — it waits for the agent". `agent.presence` (from agent actions in the audit log) drives this; the server's reply to a plan request is honest too.
- F-RL-3 No global Simple/Detailed switch: every screen starts simple and has its own "Details" button (issue, fix, item, issue list, cases, settings "More settings", protected); Home links to "Details: full overview" and "Details: activity".
- F-RL-4 Verified by using the app in a browser with a real monitor running: sign-up → setup command → Connected ✓ → real issues → Fix it for me (no agent) → Ask anyway → agent plan → Home "The agent has a plan" → approve → agent applies → Check now → re-check → "Did not work" (test steps changed nothing) → issue needs attention again.

### v4 — one server, easy to use (docs/SYSTEM-V4-PLAN.md, N1) — SUPERSEDES earlier increments where they conflict

NetSentry now looks after **the one server it runs on**, and nothing else (V4-D8). Removed, and must
NOT appear anywhere in the UI: adding or watching domains, websites or IP addresses; a list of machines
or "add a machine"; changes across many machines; home/organisation/cloud setup modes; an organisation
menu (Network, Reports); devices on the local network. Earlier requirements about those are withdrawn.

**Navigation:** Home · Apps · Server · Activity · Settings (no Issues entry). Every page is its own
address; Back works; addresses from earlier versions (#/machines, #/item/…, #/protected, #/network)
land on the Server page.

**Home** (`home.overview`) answers "is everything OK?" in this order:
1. One status line: how many things to fix (or "Everything's running and safe" / "<server> isn't
   reporting"), the server's name, how many apps are running, any stopped app by name; processor,
   memory and fullest-disk meters.
2. **To fix**: problems grouped by cause — several apps without a backup are ONE item ("N apps aren't
   backed up"); Docker publishing several apps is one item. Worst first, five shown, "Show N more".
   Each item has the one button that fixes it: *Update to X* (opens the safe-update preview),
   *Fix it* (NetSentry's built-in fix, preview first), *Back them up* (folder + daily plan),
   *Choose who can reach it* (app's Access & safety tab), *Open <app> to finish setup* (+ *Stop it for
   now*), or *Show me how* when NetSentry can't do it. Every change shows exactly what will happen
   and needs a person's confirmation; closing the preview withdraws it.
3. **Your apps**: one tile per app — running / stopped / problems, *Open* (the app's address on this
   server) and *Restart* (or *Start*).
4. **Ask the agent**: a person types a question in their own words; it waits for the agent; the
   agent's answer appears there, with any change it prepared shown as *Review* → confirm.
   The agent never confirms a change. A question nobody answers within 15 minutes says so,
   rather than "looking" forever, and the person can withdraw a waiting question.
One count everywhere: the number of things to fix is the number of To-fix items.

**App page** (#/app/<id>[/<tab>]): a header with name, what it is, version, Running/Stopped and
*Open* / *Restart* / *Stop*; tabs **Overview** (its numbers, its problems, changes made) · **Logs** ·
**Updates** · **Backups** · **Access & safety** (who can reach it vs who should, sign-in and safety
checks, accounts inside it — for apps whose accounts NetSentry can read with a read-only key: Gitea, Forgejo, Odoo — every check, technical details).

**Server page** (#/server[/<tab>]): header with monitor reporting / OS / version, Changes allowed or
switched off, *Check now*; tabs **Overview** (health, operating-system updates and restart, the server's
own problems, changes made) · **Network & firewall** · **Users & keys** · **History** · **Details**
(every check, everything the monitor sees, links to the security score and the problems table).

**Activity**: To review · On the server · Network · Who did what; links to All problems and Accepted
risks.

**Settings**: Monitor (status, version, the command to update it, the command to allow or switch off
changes — only the server can change that) · Alerts · Team · General & fixes · Updates · More settings.

**Setup** ("Let NetSentry look after this server"): 1. install the monitor here — one command with a
one-time key (Linux: install.sh via curl | sudo sh; Windows: install.ps1), waits live until it
reports; 2. who should reach each app; 3. alerts.

**Words**: no internal names on screen (no `host.container_stats`, collector ids or rule ids outside
technical details); "server", never "machine"; "your local network", never home/office.

### v4 — everyday jobs, server jobs, terminal (docs/SYSTEM-V4-PLAN.md §6–§8, §15; N2–N4)

Every job below is a change NetSentry prepares, shows exactly, and an **admin confirms**; the server's
monitor applies it (only when changes are allowed at the server) and re-checks what it may touch by
its own rules. The agent may prepare any of them; it never confirms. A change that worked can be
**undone** (Changes made → *Undo*): files and app removals for 7 days, app settings 14, firewall,
keys and scheduled jobs 30. A refusal before anything happened reads "didn't work", never "put back".

**Server page** tabs (in order): Overview · **Files** · **Disk space** · **Programs** · Network & firewall ·
Users & keys · **Scheduled jobs** · **Terminal** · History · Details.

1. **Files**: the folders the server allows (set on the server itself — each app's own folder, /srv and
   folders its owner listed can be changed; /etc and logs only read; NetSentry's own folders never
   shown). Browse; open and edit text — the change is shown line by line before saving, and a file
   changed on the server meanwhile is refused; upload and download up to 20 MB; new folder; rename;
   delete (to NetSentry's bin, 7 days). Opening, editing, uploading and downloading files are for
   admins and people only (the agent may only list names).
2. **Disk space**: each disk's free space; what can be cleaned safely with what each frees — Docker
   images no app uses, Docker's build cache, the system journal (to 200 MB), roll-back copies older
   than 3 days, NetSentry's bin — never volumes or people's files; the biggest folders.
3. **Programs**: the busiest programs (CPU, memory, user, which app); *Stop* (asked to close, forced
   after 10 s). Never the operating system, remote login, Docker or NetSentry, nor a program inside
   an app (stop the app instead) — shown with a dash.
4. **Network & firewall**: the firewall (ufw, firewalld, Windows Firewall changed; plain nftables only
   shown) in words — "Jellyfin — open to your local network"; *Open a port for an app*, *Close*,
   *Switch it on* (remote login and NetSentry's own port are allowed first; closing the last rule
   that lets SSH in is refused). **Reach it from away**: *Install Tailscale* (its official installer)
   and *Sign it in* (the sign-in link is shown only to the admin who asked, never stored); Cloudflare
   Tunnel stays guided.
5. **Users & keys**: who can sign in, administrators, their SSH keys; *Add a key* (one public key line —
   a private key is refused), *Remove* (refused when it would leave no administrator able to sign in
   while password logins are off).
6. **Scheduled jobs**: cron lines, systemd timers and Windows tasks in words ("every day at 02:30");
   *Pause* / *Resume*; NetSentry's own jobs aren't paused here.
7. **Terminal**: a real shell on the server for admins — only when switched on at the server itself
   (the installer asks; it runs as the installer's sudo user, never root unless chosen); your password
   again before it opens; recorded (what it shows, secrets hidden — typed passwords never kept); closes
   after 15 minutes without typing, 4 hours at most; past sessions with *What it showed*. The agent
   never gets a terminal.

**App page**: a **Settings** tab — ports, settings it starts with (secret values hidden unless you type a
new one), restart rule, folders; *Edit the Compose file* (shown line by line; anything new it lets
the app do beyond its own folder must be ticked to accept); saved changes restart it, and if it
doesn't come back healthy the old settings go back by themselves. Containers not started with
Compose: settings shown, not changed. Header: *Remove…* — keep its data (Undo starts it again) or
remove everything (folder to NetSentry's bin for 7 days; Docker volumes deleted for good); *Back it
up first* when NetSentry backs it up.

**Add an app**: also **any other app — paste its Compose file**: NetSentry asks Docker to read it, lists
what it will run and every risk it sees (full control, extra powers, the Docker socket, system
folders, the server's network, open on every address, root); each must be ticked before *Install*.
Apps NetSentry doesn't recognise still appear under Apps (named after their Compose project, or what
the person called it at install) with logs, settings, updates, reach, backups and Remove.

**The agent** may prepare a command for what no button covers (*commands.prepare*): the exact command,
why, a time limit — shown verbatim, run as root after an admin confirms, output recorded with secrets
hidden; off unless the terminal is switched on at the server.

### v4 N-B43 — the agent prepares, the monitor applies (found testing inside CraftBot, 2026-10-05)

1. "Ask the agent to fix it" on a problem NetSentry can't fix itself asks the agent (as the person's
   question, answered under *Ask the agent* on Home). The agent prepares changes for the server's own
   monitor — never runs anything itself — and a person confirms each.
2. A question that waits (the agent was away, or CraftBot had not been allowed to pass requests on yet)
   is asked again every 5 minutes for a day.
3. Inside CraftBot, *Ask the agent* knows an agent is connected from the start; outside it, it says to
   open NetSentry from CraftBot.
4. The marketplace card shows NetSentry's Home.

### v4 N-B42 — make scheduled jobs (docs/SYSTEM-V4-PLAN.md §17; asked 2026-10-05)

1. Server → Scheduled jobs has **New scheduled job** (when the terminal is on at the server; otherwise it
   says why): a name, the command (one line), and how often — every 5/10/15/30 minutes, every hour, every
   day or every week at a time, or when the server starts. It shows "Runs every Monday at 03:00, as root".
2. The change is shown exactly and an admin confirms; *Undo* deletes the job.
3. Jobs made in NetSentry are marked "made in NetSentry" and can be paused or **deleted** (Undo puts it
   back); every other job can be paused and resumed, never deleted.
4. Each Windows task says when it runs.

### v4 N6 — Slate look and live data (docs/SYSTEM-V4-PLAN.md §16; approved 2026-10-02 from the mockup)

1. **Slate colours, always**: blue-grey neutrals with a near-black (light) / near-white (dark) accent; NetSentry keeps
   them whatever style CraftBot is set to. Status colours (green / amber / red) are unchanged.
2. **Home**: one sentence on how the server is ("3 things need you — 1 urgent"), *Live* and "updated N s ago"
   while someone looks, small live graphs of processor and memory, the fullest disk; *Check now*.
   **Needs you**: one tile per cause — how serious, *Why?*, what it means, and the one button that fixes it.
   **Your apps** (running or stopped, live; *Open* / *Start*, *Manage*) beside **Recent activity** (changes made
   here, with *Undo* while it's possible, and apps the monitor saw stop or start). **Ask the agent** below.
3. **Every change opens a side panel**: Prepared → Review → Confirm → Checked. *Not now* withdraws it; after
   *Confirm* the panel follows the change live (each step, the check) and ends with done / didn't work /
   put back, and *Undo* when it can be undone (a restart has nothing to undo). Closing it never cancels.
4. **Live**: while NetSentry is open in a visible tab, the server's numbers and every app's state, CPU and
   memory update every 2 s; nobody looking, the monitor stops sampling. An app that stops, crashes or
   starts — even with nobody looking — reaches NetSentry within seconds (Docker's own events), so Home's
   tile, the app's state and a "just stopped" notice appear without a reload.
5. **Apps**: on a wide screen the list (Running / Stopped, live memory and CPU) stays beside the app you
   chose; on a phone they are two pages.
