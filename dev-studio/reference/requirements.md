# Requirements: Development Studio — Milestone 0
PART A — REQUIREMENTS (SRS).
## Introduction
### Purpose
Prove the new-framework development application's execution and harness boundaries before building an IDE.
### Scope
Goals: real local execution, secure interactive terminal transport, real standalone harness delivery, and an actual CraftBot native-import/round-trip result.
A failure at the host boundary is a recorded blocker, never a compatibility pass.
### Approval
Approved by the user's explicit instruction on 24 October 2026: begin Milestone 0 using the new framework and prove CraftBot and standalone before the full workspace.
## Product Description
### Product Perspective
Single-user localhost Agent App. New React/Hono/SQLite blueprint, upstream commit pinned in framework.lock.json.
### User Characteristics
One developer, Windows desktop browser; lab status and actions also usable at 390px.
### Constraints
C-1: UI receipt statuses: passed, failed, blocked; request statuses: queued, passed, blocked, failed, canceled.
C-2: A maximum of two managed interactive terminals; each starts in the app's disposable proof folder.
C-3: No source-framework, system-server, adapter or post-scaffold manifest edits.
C-4: A native CraftBot pass requires actual installation, launch and agent round trip; the classifier alone is only a compatibility preflight.
C-5: All test fixtures are explicitly disposable local proof data, not substitutes for external services.
### Assumptions
A-1: Judged volume: 1,000 receipts and requests combined; only the 20 most recent of each render.
A-2: Installed harness credentials are managed by that harness.
A-3: Shell commands run with the local operating-system account's permissions; this is not a sandbox.
## Modules
workspace, workbench, execution, changes, agents, settings. The initial manifest declares all six.
Milestone-zero screens group these foundations into Overview, Execution and Connections; editor/change-review screens are deferred.
## Features
### Module: workspace
- F-WOR-1: The user can run a proof that writes and reads a real file.
- F-WOR-2: The proof observes a real filesystem-watcher event.
- F-WOR-3: The proof verifies the file through a separate child process.
- F-WOR-4: The user can inspect the stored result, file path, digest and execution outcome.
### Module: execution
- F-EXE-1: The user can open an interactive local terminal in the proof folder.
- F-EXE-2: The user can type commands and see their actual output.
- F-EXE-3: The terminal resizes with its available area.
- F-EXE-4: The user can close an owned terminal and its process tree.
- F-EXE-5: The user can stop the execution service after an in-app confirmation.
- F-EXE-6: Invalid, expired, replayed or foreign-origin terminal connections are refused.
- F-EXE-7: When the app disconnects, its execution service closes owned terminals and exits.
### Module: agents
- F-AGE-1: The user can queue a titled review for standalone or CraftBot.
- F-AGE-2: A queued request shows queued rather than claiming an agent has run.
- F-AGE-3: The agent can discover the request, read its linked evidence and submit a result through A2App.
- F-AGE-4: Invalid challenge answers and attempts to submit through the UI are refused.
- F-AGE-5: The user sees the stored agent result without reloading the page.
- F-AGE-6: A release proof invokes a real installed standalone harness through the framework bridge.
- F-AGE-7: Cancelled/failed framework tasks become terminal request records and refuse late submissions.
### Module: settings
- F-SET-1: The user can see the framework revision and execution-service state.
- F-SET-2: The user can inspect a supplied CraftBot installation with its actual importer implementation.
- F-SET-3: A rejected new-framework format is recorded as blocked with a next step.
- F-SET-4: The app installs and launches from a clean package without the original framework checkout.
### Shared experience
- F-UI-1: All three lab screens are reachable through persistent navigation.
- F-UI-2: First run has an explanatory empty state and a local-proof action.
- F-UI-3: Actions show pending, success or actionable failure feedback.
- F-UI-4: At 390px controls remain reachable without horizontal page scrolling.
## Non-Functional Requirements
N-1: Terminal transport binds loopback and needs a single-use 15-second ticket plus an allowed app origin.
N-2: Startup/action calls have bounded timeouts; writes are not automatically retried.
N-3: No harness credentials, terminal output or user conversations ship in the package.
## Data Requirements
proofs: server-managed kind, status, JSON details, created instant.
requests: title; server-managed mode, status, challenge operands, proof reference, task id, agent, summary and timestamps.
No seed evidence. Runtime files live under the framework-selected data directory.
## External Interfaces
Human: React lab. Agent: A2App only. Terminal bytes: scoped WebSocket ticket created by an A2App operation.
CraftBot: current importer preflight; native installation remains a mandatory milestone gate.
## Out of Scope
- Full editor, arbitrary-project registration, Git workflow and debugging.
- Remote development, deployment, multi-user accounts and model API settings.
- Fabricated agents or modifications to CraftBot or the framework.
## Quality of Life
Designed degraded states; evidence timestamps; structured expandable receipts; preserved form input on failures.
PART B — TECHNICAL SPECIFICATION.
## System Overview
Pinned official blueprint. A private derivative declares only initial modules before scaffold; executable system files are unchanged.
Runtime worker is lazily forked through app-owned operation code, communicates over IPC, and exits on parent disconnect.
SQLite is framework-owned. Proof files remain real filesystem files.
## UI Design
Use the shipped warm-neutral semantic token system, system font, one reusable button/card/status pattern, light/dark.
Overview primary object: proof receipts; primary action: Run local proof.
Execution primary object: live terminal; primary action: Open terminal.
Connections primary object: requests; primary action: Queue review.
All screens: loading indication, empty explanation, pending disabled controls, inline error and retry, stored success.
At 640px navigation becomes a top row and cards/forms stack. Terminal output scrolls inside its container.
## Quality Conformance
- **Q1:** Three persistent lab destinations; unfinished workspace modules are explicitly outside scope rather than dead navigation.
- **Q2:** Blueprint semantic tokens; status text supplements colour. No custom raster assets or external fonts.
- **Q3:** Desktop rail and aligned cards; one column at narrow widths; code wraps in evidence containers.
- **Q4:** Labelled forms, immediate pending controls, Enter submission, focus-visible outlines; stop-service confirmation names terminal loss.
- **Q5:** Empty receipts explain the action; queued is distinct from passed; retained data stays visible if refresh fails.
- **Q6:** No decorative motion; reduced-motion rule disables app transitions.
- **Q7:** Plain operational language; no claims of IDE readiness or native compatibility without evidence.
- **Q8:** Real buttons/labels, live announcements for errors and toasts, 44px narrow-width controls, token text colours.
- **Q9:** 390px and desktop verification; stacked forms, no horizontal page overflow.
- **Q10:** Recent 20 records per collection; terminal lazy-loaded; scrollback bounded to 1,500 lines.
- **Q11:** Preserve the framework update watcher; data changes trigger rereads; only unfinished framework task receipts are polled.
- **Q12:** Proof/status/authority fields are readOnly in schema; challenge and linked evidence validated in the submit operation.
- **Q13:** A2App handles app operations; runtime HTTP exposes no unauthenticated execution API; WS input is size/type bounded.
- **Q14:** React screens, operations, runtime manager and worker are separate modules; operations.json mirrors schema declarations.
- **Q15:** Bounded startup and operation deadlines; explicit failures; IPC disconnect triggers owned-process cleanup.
- **Q16:** Loopback only; one-use WS tickets; no credentials in URLs; no arbitrary executable fields exposed to agents; terminal env removes common secret-bearing names.
- **Q17:** Framework identity is health; stored receipts include actual outcomes and timestamps; package evidence names verified and blocked paths separately.
- **Q18:** Source and pinned distributable dependencies are reviewable; runtime/user data is ignored; no automatic commits during this milestone.
### Conventions and overrides
Global conventions read before implementation. Q1.4: six framework modules are grouped into three lab screens for this milestone; revisit when workspace features exist.
Q18.3: vendor/*.tgz contains deliberate distributable MIT framework dependencies pinned by commit and SHA-256 because these versions are unpublished; not runtime/user artifacts.
Q18.1: leave changes uncommitted for user review in this shared worktree; no automatic commits.
## Process Flows
Local proof -> receipt -> agent request -> framework claim -> evidence review -> stored result.
CraftBot classifier refusal -> blocked receipt -> host compatibility change required; no full-workspace development.
## Operations Design
Authoritative declarations: operations.json, mirrored from app/operations.mjs by scripts/sync-operations.mjs.
studio-status (settings, readOnly/idempotent); run-local-proof (workspace);
open-terminal, close-terminal(id), stop-runtime (execution);
create-proof-request(mode,title), sync-proof-requests(), submit-proof-result(request,answer,decision,summary) (agents);
inspect-craftbot(root,python) (settings). No data-deleting operations.
## Changes
Initial milestone scope derives from the approved release plan. Any host/framework code change requires a separately scoped change.
- 2026-10-24: The user authorizes CraftBot host compatibility changes for new-framework native import, managed launch/stop/restart and real CraftBot task claim, evidence review, stored result and completion. This supersedes the original exclusion of CraftBot source modifications; framework system files remain unchanged. Preserve format-2 imports, strip donor credentials, assign fresh identity/port, and keep standalone operation working. Do not begin the full workspace until this proof passes.
- 2026-10-25: The user authorizes completing all first-release milestones in reference/RELEASE_PLAN.md. This supersedes the historical Milestone-0-only scope and its editor/project/Git/debugging exclusions. Keep the six declared modules and unchanged framework system files. The previous proof gate has passed; continue through the workspace, execution, agent development, review/delivery and release verification.
- 2026-10-25 M1: Users can open existing folders without changing their contents, create empty/JS/Python starters or clone a repository into a new destination, retain recent projects, and explicitly enable execution. They can browse/create/rename/move/trash files, edit with Monaco tabs and split view, search and review replacement, preview Markdown/images, restore unsaved buffers after refresh, and resolve external-write conflicts without silently losing text. Files stay authoritative on disk; filesystem operations reject escaping paths/symlinks/junctions. Plain folders and dirty Git repositories work.
- 2026-10-25 M2: Users can configure commands and working directories; run/test/build/format with bounded logs, actual exit codes, source fingerprints and stale-result detection; use interactive project terminals; stop owned process trees; open isolated loopback web previews; use JS/TS and Python language-server diagnostics/completion/hover/definition; and debug Node/Python with breakpoints, continue/step, call stack and locals. Missing tools have actionable errors. Jobs interrupted by restart are reconciled honestly.
- 2026-10-25 M3: Users can connect/disconnect an installed standalone Codex CLI bridge or use CraftBot, create goal/acceptance/context work items, dispatch one isolated writer per project, see progress and questions, answer/resume, cancel with confirmed process state, retry as a new attempt and inspect retained results. Both actual agents must complete a real coding task through A2App operations. No fabricated responses; manual development works without either agent.
- 2026-10-25 M4: Agent changes use an isolated Git worktree or recoverable plain-folder copy and recorded content baseline. Users can inspect file/binary diffs and check evidence, accept selected files/all or reject, resolve destination conflicts explicitly and restore checkpoints. User dirty files/unsaved buffers are protected; stale checks are labeled. Users can initialize Git explicitly, stage/unstage, commit, inspect history, fetch, fast-forward pull and push; no automatic publication, force push, stash or destructive reset.
- 2026-10-25 M5: Validate all release scenarios from RELEASE_PLAN.md with real disposable JS/Python/non-Git projects, actual CraftBot and standalone coding, runtime/security and recovery tests, independent browser verification including narrow widths and keyboard access, and clean distributable installation. ~~Preserve the integration lab under Diagnostics.~~ Keep changes reviewable and uncommitted; no marketplace publication is implied by local completion.


~~- 2026-10-27 visual design: The user can recognize the development workflow through a restrained custom SVG project/editor illustration, clearer welcome copy and consistent tool icons. Welcome and selected empty states have useful visual cues without fabricated projects, counters or test outcomes. Open/New/Clone, recent projects and the existing development workflow remain functional and keyboard-accessible. Visuals follow the existing light/dark tokens, remain readable at 390px and respect reduced motion. Preserve the user’s reset live workspace; verification fixtures stay in the disposable candidate.~~
- 2026-10-27 development-tool redesign: Supersedes the earlier decorative visual direction after user feedback. Use researched JetBrains, Zed and VS Code interaction/layout conventions: compact Start/Recent Projects view with real Open/New/Clone and ~~command/diagnostics actions~~; dense, readable tool chrome and file rows; a code-first editor; bottom execution panels; an optional, remembered Agent work dock with a functional toggle. Opening agent tasks/reviews reveals the dock. Remove the promotional hero, decorative illustrations and repeated welcome prose. Keep real task reports available without dominating the diff. All existing project, execution, review and agent operations remain available in light/dark and at390px; preserve the reset live data and keep verification fixtures isolated.

- 2026-10-27 native folder selection: In Open an existing folder, Browse opens the Windows Explorer folder picker. Selecting a real folder fills the path; Cancel preserves the current input and project. Open folder explicitly registers the selection without executing it. Browsing has a pending state, prevents duplicate dialogs, handles failure/timeout and is unavailable to agent credentials. Manual absolute-path entry remains available, including on unsupported platforms. Preserve existing projects and pending agent review. Module: workspace; operation: project-browse.

- 2026-10-27 VS Code panel refinement: An inspection-mode project terminal shows a neutral execution-disabled state with an explicit Enable execution confirmation, and never invokes project-terminal/reconnect before execution is enabled. Trusted projects retain real terminal open/close/reconnect. Search has compact inputs, collapsible Replace, grouped file matches with counts and navigation to the matched line, and honest empty/no-results states. Source Control separates collapsible Staged Changes and Changes, shows filename plus muted directory for long paths, offers only the applicable stage/unstage action, and moves fetch/pull/push/history to a contextual menu. Git writes remain disabled in inspection mode and require explicit enablement. Preserve diff/history/commit/search-replace functionality, both themes, narrow layouts and user project/Git/agent data. Module scope: existing workbench/execution/changes; no new operations.

- 2026-10-27 terminal viewport fit: The project terminal uses the actual remaining execution-panel height after its tabs and toolbar. The xterm screen, last row and cursor stay fully inside the visible host without a second outer scrollbar, including after resize, hide/show, tab switches and at narrow widths. App form styles must not impose padding/minimum dimensions on xterm’s hidden helper textarea. Preserve execution guards and real shell I/O/reconnect. No backend or schema changes.

- 2026-10-27 full application acceptance and UX: Validate the complete first-release manual, standalone and CraftBot workflows on current code and a fresh distributable. Exercise project entry, real editor/file/search/recovery flows, command/test/preview/artifact execution, terminals and resizing/reconnect, JS/TS/Python tools/debugging, Git delivery, real agent implementation/questions/revisions/cancel/review/application/conflicts, settings/~~Diagnostics~~ and responsive keyboard use. Correct observed functional defects and UX friction (unclear next actions, stale/hidden state, overcrowding, missing progress or actionable errors) without expanding the release boundaries. Keep verification fixtures isolated and preserve the user’s CraftOS source/Git changes, current project metadata and existing agent work. Report exact coverage and any unverified or externally blocked capabilities honestly.

- 2026-10-28 agent handoff and responsiveness: Small standalone development tasks use a concise scoped execution path and standard reasoning by default, with an explicit thorough option and the user's configured model retained. Show truthful elapsed time and current activity without invented progress percentages. Submitting a finished change set closes its delivery and revokes further agent writes before advertising Ready for review, so the human can apply or reject immediately without retrying or waiting for a hidden second completion. Interrupted handoffs stay visibly Preparing review and reconcile safely. Human review never starts new work automatically. Preserve current projects, applied changes, execution permissions and cancellation/revision/question behavior; verify the actual agent round trip and immediate review interaction on disposable fixtures before release.
- 2026-10-28 connection feedback: Standalone shows connected only after the framework bridge's own live readiness record matches this installation's managed job. Starting, disconnected, and another-instance conflicts remain truthful and refresh automatically; a queued task must not appear to have an active agent merely because a launch shell started. Test installations must not disconnect the user's existing bridge.

- 2026-10-28 IDE settings and developer-test separation: The ordinary IDE header, Start screen and command palette lead to useful Settings rather than the milestone integration lab. Settings is available with or without a project and groups actual agent connection, appearance, local tools/interpreter and current project execution/recovery controls. ~~Historical proof receipts and optional test actions remain available only through Settings → Advanced → Developer test lab, explicitly labeled as historical developer tests rather than current IDE health or prerequisites.~~ Opening settings ~~or the advanced lab~~ preserves the mounted workspace, dirty buffers, selected work and connected terminals; returning restores context. Do not run proofs, queue agent reviews, enable execution or change configuration merely by opening these views. Preserve projects, files, applied work and real agent behavior. This supersedes the earlier prominent Diagnostics entry points; underlying proof operations/data remain intact.

- 2026-10-28 remove the developer lab from the product: Remove all developer-test/integration-lab screens, navigation entries, Settings sections and lazy-loaded routes from the IDE interface. Settings should contain only useful agent/development/project controls, with no Advanced test-lab entry. Startup, refresh and old hash URLs always open the normal workspace or Settings. Keep existing verification receipts and maintenance/proof operations intact outside the product UI; do not delete user data or change agent behavior. This supersedes the earlier decision to expose the lab under Advanced. Verify the removed screen cannot be reached while normal settings, editing, tasks and terminal state continue to work.
