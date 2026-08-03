# `pipeline/living-ui/` — Autonomous Living UI creation pipeline (V2)

This folder owns the process of turning a short, human-written requirement into a finished, reviewed **Living UI V2** app — with the human involved at exactly two points: **fill in and paste [NEW_APP_PROMPT.md](NEW_APP_PROMPT.md)**, and **test the app at one review gate**. One app at a time — there's no queue.

The work is split across **two runners**:

- The **research runner** — **CraftBot** (the agent app, a cheaper model). It starts the request, researches the product category with parallel subagents, writes the requirements spec (`SPEC.md`), captures UX references from state-of-the-art products, writes the layout spec (`DESIGN_SPEC.md`), and then hands off by launching the creation runner. It reads **only** [RESEARCH_PIPELINE.md](RESEARCH_PIPELINE.md), which is fully self-contained.
- The **creation runner** — a **Claude Code session**. It validates the handoff bundle, scaffolds a V2 project with `lui create`, builds it per [living-ui-v2/docs/agent-guide.md](../../../../living-ui-v2/docs/agent-guide.md), self-QAs against hard gates, iterates on human feedback, and packages the importable ZIP the human receives.

The handoff is automatic: the research runner's last stage launches `claude -p --model claude-sonnet-5` headless with the Creation kickoff prompt (§5). The whole path from kickoff to `AWAITING_HUMAN_REVIEW` runs unattended.

## Read in this order

| Doc | What it is | Who reads it, when |
|---|---|---|
| **README.md** (this file) | Hard rules, platform contract, path resolution, state machine, run artifacts, mode routing, kickoff prompts | Creation runner + human, start of **every** run. The research runner does **not** read this — its doc restates everything it needs |
| [NEW_APP_PROMPT.md](NEW_APP_PROMPT.md) | The single fill-in-and-paste block that starts a run — no separate queue or request file | Human, to start a request |
| [LESSONS.md](LESSONS.md) | Append-only lessons from past runs | Creation runner, start of **every** run, immediately after this file |
| [RESEARCH_PIPELINE.md](RESEARCH_PIPELINE.md) | The research SOP (stages R1–R8): start → research subagents → SPEC.md → Playwright reference capture → DESIGN_SPEC.md → handoff launch. **Written for CraftBot; fully self-contained** | Research runner (CraftBot), its only required reading. C8 keeps its §2 Standing corrections in sync |
| [RESEARCH_PIPELINE_CLAUDE.md](RESEARCH_PIPELINE_CLAUDE.md) | Same R1–R8 stages, same output contract — a lighter, judgment-based variant for when a Claude Code session does research instead of CraftBot | Research runner (Claude Code), if you choose this runner for a given request |
| [CREATION_PIPELINE.md](CREATION_PIPELINE.md) | The creation SOP (stages C1–C8): claim handed-off run → validate bundle → scaffold → build → QA → review → package | Creation runner, mode CREATE |
| [QA_GATES.md](QA_GATES.md) | The automated gate list G1–G7 (G7 = package the importable ZIP), fix–retest impact matrix, QA report template | Creation runner, from stage C5 and improvement stage I5 |
| [IMPROVEMENT_PIPELINE.md](IMPROVEMENT_PIPELINE.md) | Human-feedback iteration loop (stages I1–I6) | Creation runner, mode IMPROVE, or when a review reply lists issues |
| [living-ui-v2/docs/agent-guide.md](../../../../living-ui-v2/docs/agent-guide.md) | The V2 build workflow: ownership, build loop, migrations, operations, kit usage. **Not part of this pipeline's docs — it is the ground truth the pipeline drives.** | Creation runner, from stage C3 |

`PIPELINE_OVERVIEW.drawio` is the visual companion (page 1 = whole pipeline, page 2 = QA loop). It documents; the markdown governs.
`scripts/package.py` and `scripts/audit.py` are the two mechanical gate scripts G7 runs (§7 of QA_GATES).

---

## 0. Hard rules

1. **Read [LESSONS.md](LESSONS.md) before doing anything else, every run.** Lessons are corrections paid for by past failures; skipping them re-buys the same failures. (Research-runner equivalent: RESEARCH_PIPELINE §2 Standing corrections, which C8 keeps in sync.)
2. **The run's `ITERATION_LOG.md` is the only state store.** Its last logged status line is the run's current status — there is no separate request/queue file to keep in sync. A run whose log doesn't match reality is a process bug — stop and fix it before continuing.
3. **One request in flight, ever. Resume before you start something new — within the states your pipeline owns.** The research runner owns everything up to entry into `HANDOFF`; the creation runner owns exit from `HANDOFF` → `DONE` (state table in §3.1 has the Owner column). Neither runner ever advances a run sitting in the other pipeline's states. Before doing anything else, scan `runs/` for a folder whose ITERATION_LOG hasn't reached a terminal status (`DONE`/`FAILED`) — if one exists, resume it (see §8) instead of starting new work.
4. **Never edit the V2 platform.** `living-ui-v2/` (kit, blueprint, tools, `spec/`, `docs/agent-guide.md`), the `skills/living-ui-*` skills, and `GLOBAL_LIVING_UI.md` are read-only ground truth. If a run reveals they should change, record a `PROPOSAL:` line in LESSONS.md and continue. The pipeline improves itself through LESSONS.md, not by mutating its ground truth. (One sanctioned exception: `npm install --no-save playwright` inside `living-ui-v2/` — it writes only to the gitignored `node_modules/`, see §1.)
5. **Ownership inside the app is enforced by a hash gate, not by good intentions.** You edit only `frontend/src/app/`, `pb/pb_migrations/`, `pb/pb_hooks/ops.pb.js` (+ new `*.pb.js`), `operations.json` (non-`system` entries), `LIVING_UI.md`, and `reference/`. Everything else — `frontend/src/kit/`, `main.tsx`, `config.gen.ts`, `app.css`, `index.html`, `vite.config.ts`, `tsconfig.json`, `pb/pb_hooks/_system.pb.js`, `_craftbot_bridge.js`, `manifest.json` — is hashed at scaffold time and **fails `lui validate` if touched**. Need different behavior from a kit component? Wrap it in `app/`.
6. **Human contact happens only at the review gate (C6/I6) and BLOCKED escalations.** Everywhere the guide says "ask the user", the pipeline means: consult `SPEC.md` (§9 first) / `DESIGN_SPEC.md`; if silent, apply a Safe Assumption (RESEARCH_PIPELINE §5.6) and log it in the assumptions register and ITERATION_LOG.
7. **Visual identity is CraftBot's, always.** Reference products inform *structure and behavior* (layout, navigation, interactions). Colors, fonts, spacing, and radii come exclusively from the kit's design tokens (`var(--lui-*)`) plus the palette and enabled rules in [GLOBAL_LIVING_UI.md](../../../GLOBAL_LIVING_UI.md). Never hardcode a color — theming is host-owned and must keep working when the host switches style packs or dark mode. (GLOBAL_LIVING_UI.md still names some V1 mechanisms — react-toastify, `global.css`. Take its *palette and enabled rules* as binding; the kit owns the *mechanism*: `toast` from `../kit/index.ts`, Tailwind utilities, `var(--lui-*)` tokens.)
8. **Never weaken a gate to pass it.** No deleting failing checks, no lowering thresholds, no skipping viewports — and no re-characterizing a red result as passing or non-blocking without quoting the command output that proves it. Fix the app, or go BLOCKED with the failure documented.
9. **All run artifacts live under `runs/<run_id>/`, including the app itself.** Nothing in the repo root, nothing in system temp dirs, nothing in `living-ui-v2/examples/`. A fresh session must be able to find everything a dead session left behind.
10. **The human only ever receives an importable ZIP.** They test by importing it into CraftBot — so QA gate **G7 (package + audit)** must pass before *every* review handoff (C6 and each I6 round), not just at the end. This rule's V1 ancestor existed because a run once handed over a folder with `node_modules/` that the import choked on; the shape changed, the failure mode didn't.
11. **Respect the token budget (§9).**

---

## 1. The platform, in one screen

Everything the pipeline builds is a **Living UI V2** project. Internalize this before writing or reviewing anything — the whole V1 vocabulary (FastAPI, SQLAlchemy, two ports, `_template/`, placeholders) is gone.

- **One process.** PocketBase serves the API, the database, auth, realtime, custom verbs, *and* the built frontend from `pb/pb_public`. There is no separate backend/frontend port in production. `lui dev` additionally runs Vite on `port + 1`, for HMR during development only.
- **Schema** = JavaScript migrations in `pb/pb_migrations/`, one new file per change, never edit an applied one. Collection **rules** are the security boundary and must match `manifest.json`'s `authMode` (`''` open for `none`; `@request.auth.id != ""`, or owner-scoped `owner = @request.auth.id` against a `relation` to `users`, for `multi-user`). Relation fields need the **target collection's id**: `app.findCollectionByNameOrId('words').id`, never its name.
- **Custom verbs** = a `routerAdd` route in `pb/pb_hooks/ops.pb.js` **plus** a matching entry in `operations.json`. `lui validate` fails ops without routes and warns about routes without ops. Discovery is `GET /api/_ops`. Read request bodies with `e.requestInfo().body` — `toString(e.request.body)` reads a Go stream as empty and 400s every request. Mark data-deleting ops `"destructive": true`.
- **Frontend** = `frontend/src/app/`, importing **only** from `../kit/index.ts`. Data via `useCollection('items', { sort: '-created' })` — realtime, never poll, never reload. Writes via `getPbClient().call((pb) => …)` — errors toast automatically. Styling is Tailwind utilities + `var(--lui-*)` tokens.
- **The CraftBot bridge** gives hook routes the host's LLM and connected integrations with zero keys — `require` the system module `_craftbot_bridge.js` from `__hooks`, then call `bridge.callLLM(prompt, system)` or `bridge.callIntegration('slack', 'POST', '/chat.postMessage', {...})`. Outside CraftBot they return `''` / `{status: 503}` — degrade gracefully, never crash the route.
- **Platform limits a spec must respect:** the app runs on localhost, so **no inbound webhooks or callback URLs**; **never** OAuth flows, personal access tokens, or API-key entry — external data is *pulled* through the bridge on load/refresh or by a scheduled op; realtime is native for the app's **own** records only; never build a feature that depends on a browser permission prompt (location, notifications, camera).

## 2. Repo layout, tooling, and preflight

Resolve these once at run start and use them everywhere:

| Name | Value |
|---|---|
| `CRAFTBOT_ROOT` | the CraftBot repo (`d:\tempCraftBot\CraftBot` on this machine) |
| `LUI_ROOT` | `<CRAFTBOT_ROOT>/living-ui-v2` — the V2 workspace (kit, blueprint, tools, docs) |
| `LUI` | `node <CRAFTBOT_ROOT>/living-ui-v2/tools/src/cli.ts` — the CLI, invoked **from `CRAFTBOT_ROOT`** |
| `RUN` | `agent_file_system/workspace/pipeline/living-ui/runs/<run_id>` |
| `APP` | `<RUN>/app` — the project being built |

> Run every `lui` command with the working directory at `CRAFTBOT_ROOT` and pass repo-relative paths. Shell tools keep their working directory between calls — a stray `cd` into the app folder makes `node living-ui-v2/tools/src/cli.ts` resolve against the wrong root and fail with `Cannot find module`.

**Machine prerequisites** (human-owned; verified working on this machine):

```sh
node --version                 # must be >= 24 (V2 tooling runs TypeScript directly)
node living-ui-v2/tools/src/cli.ts help
node living-ui-v2/tools/src/cli.ts pb path      # downloads+caches the pinned PocketBase on first use
where claude                                     # standalone Claude Code CLI, for the R8 headless handoff
```

**Playwright** — `lui verify` and `lui probe` `import('playwright')` from the V2 workspace. If it isn't installed there they exit **2 with `{"status":"skipped"}`**, which is *not* a pass. One-time fix (writes only to the gitignored `living-ui-v2/node_modules/`, leaves `package.json` untouched):

```sh
cd living-ui-v2 && npm install --no-save --no-audit --no-fund playwright && cd ..
```

Browser binaries live in `%LOCALAPPDATA%\ms-playwright` and are already cached on this machine; if they aren't, `npx playwright install chromium`.

If the `claude` CLI is missing the research runner can't hand off — RESEARCH_PIPELINE stage R1 gates on it so a broken handoff fails at minute 1, not at hour 6. The VS Code extension's bundled binary does **not** count: it isn't on PATH and its path breaks on every extension update.

**Authoritative copy:** this folder (`<CRAFTBOT_ROOT>/agent_file_system/workspace/pipeline/living-ui/`) is the **sole authoritative** pipeline tree. `living-ui-marketplace/` — including its stale `pipeline/living-ui/` copy — is legacy V1 and out of scope; never read pipeline docs from there.

---

## 3. Starting a request

There is no queue — one request in flight at a time (rule 3). The human fills in and pastes [NEW_APP_PROMPT.md](NEW_APP_PROMPT.md) directly into a chat; that message **is** the request. The research runner parses it for:

| Field | Where it comes from | Used for |
|---|---|---|
| `app_name` (display name) | NEW_APP_PROMPT.md `APP` block | `lui create` name, manifest, review request |
| `slug` | NEW_APP_PROMPT.md `APP` block | `run_id = <slug>-<YYYYMMDD>` and the deliverable ZIP name |
| `tags` | NEW_APP_PROMPT.md `APP` block | descriptive only (recorded in the log and review request) |
| `auth_mode` | NEW_APP_PROMPT.md `APP` block | `lui create --auth none\|multi-user` — decided up front because collection rules depend on it |
| requirement text | NEW_APP_PROMPT.md `REQUIREMENT` paragraph | everything research and the spec are built from — references and constraints are written directly into this paragraph rather than kept as separate structured fields |

All of it gets copied verbatim into the new run's `ITERATION_LOG.md` header at R1 (§4) — that's the only place it's persisted, so a resumed session can always recover the original ask.

`review_round`, `blocked_reason` (during a BLOCKED episode), and the deliverable path aren't structured fields either — they're stated in the relevant ITERATION_LOG line when they matter (e.g. `... | BLOCKED | reason: ... | next: ...`).

### 3.1 Status state machine

```
      RESEARCH PIPELINE (CraftBot)          │        CREATION PIPELINE (Claude Code)
                                            │
        RESEARCHING → SPEC_READY → HANDOFF ──► BUILDING → SELF_QA → AWAITING_HUMAN_REVIEW
(human pastes NEW_APP_PROMPT.md)  (launch claude)                          │
                                            │             ┌──────────────┤
                                            │             │ (issues)     │ (APPROVED)
                                            │             ▼              ▼
                                            │         IMPROVING ──► PACKAGING ──► DONE
                                            │             │  (back to AWAITING_HUMAN_REVIEW
                                            │             ▼   after each round)
        BLOCKED  ◄── reachable from ANY active state, by either runner;
           │         blocked_reason prefixed "research:" or "creation:", human pinged
           ├── human unblocks → back to the state it left
           └── human abandons → FAILED (terminal)
```

Every state above is a value that gets **logged in `ITERATION_LOG.md`**, not written to a separate file — see rule 2.

| State | Owner | Meaning | Exits to |
|---|---|---|---|
| `RESEARCHING` | research | Request started (R1); research subagents → SPEC.md in progress | `SPEC_READY`, `BLOCKED` |
| `SPEC_READY` | research | SPEC.md passed its gate; design-reference capture + DESIGN_SPEC.md happen here | `HANDOFF`, `BLOCKED` |
| `HANDOFF` | boundary | Research complete; bundle verified; creation runner launched. **The creation runner logs `BUILDING` as its very first status write (C2)** — a run sitting at `HANDOFF` for more than ~10 minutes means the launch died; paste the Creation kickoff (§5) manually | `BUILDING`, `BLOCKED` |
| `BUILDING` | creation | Bundle validated; scaffold + build in progress (C3–C4) | `SELF_QA`, `BLOCKED` |
| `SELF_QA` | creation | QA_GATES loop running | `AWAITING_HUMAN_REVIEW`, `BLOCKED` |
| `AWAITING_HUMAN_REVIEW` | creation | Review request posted with the deliverable ZIP; runner idle or session ended | `PACKAGING` (APPROVED), `IMPROVING` (issues) |
| `IMPROVING` | creation | Feedback round in progress; `review_round` incremented | `AWAITING_HUMAN_REVIEW`, `BLOCKED` |
| `PACKAGING` | creation | Final validate → clean → ZIP → audit in progress | `DONE`, `BLOCKED` |
| `DONE` | — | **Terminal.** Deliverable ZIP path stated, retrospective appended to LESSONS.md | — |
| `BLOCKED` | either | Escape hatch; reason filled (prefixed with the pipeline that hit it); human message posted (§8) | previous state (unblock), `FAILED` |
| `FAILED` | — | **Terminal.** Human explicitly abandoned the request | — |

`PUBLISHING` is a **deprecated alias for `PACKAGING`** (pre-V2 runs used it); treat it identically when resuming an old run.

---

## 4. Run artifacts

Each run gets `pipeline/living-ui/runs/<run_id>/` (git-ignored — the durable record is the deliverable ZIP plus LESSONS.md):

```
runs/<slug>-<YYYYMMDD>/
├── ITERATION_LOG.md        # append-only journal — the resume anchor
├── SPEC.md                 # generated requirements spec (research output)
├── DESIGN_SPEC.md          # layout/UX spec from reference capture
├── research/               # research artifacts: decomposition.md, features.md,
│                           #   competitors.md, ux-patterns.md, data-model.md,
│                           #   questionnaire.md, (capture-fallback.md if no shots)
├── reference-shots/        # Playwright PNGs of reference products
├── app/                    # THE PROJECT — scaffolded by `lui create` at C3
├── qa/                     # qa-report-1.md … N, feedback-round-1.md … N, g5.cjs, screenshots
├── deliverable/<slug>.zip  # what the human imports (built + audited at G7)
├── creation.log            # stdout/stderr of the auto-launched creation session (R8)
├── REVIEW_REQUEST.md       # every human-handoff message, appended per round
└── thumbnail.png           # copied out of app/logs/verify/home.png before G7 wipes logs/
```

**ITERATION_LOG.md format** — one line per event, appended immediately when it happens. The `<STATUS>` token in each line **is** the state store (rule 2) — nothing else records it:

```
2026-07-08 14:02 | BUILDING | feature 3/6 done: categories CRUD + ops, gate green | next: feature 4 (media attachments)
2026-07-08 14:40 | SELF_QA  | entered QA loop, iteration 1 | next: G1
```

**Timestamp is `YYYY-MM-DD HH:MM` — date-only lines are non-compliant.** The human isn't watching the CLI's own output live, so the log's time-of-day is the only way to tell a run is progressing versus stalled. (One run logged 8 of its 10 lines date-only — undetectable from the log alone whether BUILDING took 10 minutes or 2 hours.) Mechanical check, run before C6 and again before final DONE — must return 0:

```
run_shell: { "command": "(Get-Content 'agent_file_system/workspace/pipeline/living-ui/runs/<run_id>/ITERATION_LOG.md' | Select-String -Pattern '^\d{4}-\d{2}-\d{2} \|').Count", "shell": "powershell", "cwd": "d:\\tempCraftBot\\CraftBot" }
```

Any non-zero count → you can't fix past entries, but log the current line correctly and don't let it recur.

**Heartbeat rule** — BUILDING and SELF_QA are the longest, quietest stages; a run can go dark for over an hour between naturally-triggered lines. If more than 10 minutes elapses inside a stage with no event to log naturally, write a one-line heartbeat anyway: `<timestamp> | <STATUS> | heartbeat: <what's in progress right now> | next: <what's next>`.

The header (written at R1) also carries the original ask verbatim — app name, slug, tags, auth mode, and the full requirement text — since there's no separate request file to fall back on.

Rule: a fresh session must be able to reconstruct where the run stands, and what was originally asked for, from ITERATION_LOG alone. Write every log line with that reader in mind.

---

## 5. Kickoff prompts

The prompt that **starts** a run lives entirely in [NEW_APP_PROMPT.md](NEW_APP_PROMPT.md) (both the CraftBot and Claude Code research variants) — fill it in, paste it, done. The prompts below are for what comes **after** that: the automatic handoff, and the human's replies at the review gate. **They never change** — all routing and logic lives in these docs, so the pipeline can evolve without re-teaching the human.

**Creation (auto-launched by the research stage's handoff step with `--model claude-sonnet-5`; paste the same words into a Claude Code session if a run is stuck in `HANDOFF`):** if pasting manually, set that session to Sonnet 5 first (`/model sonnet`) — a manually-pasted prompt has no `--model` flag to pin it.

```
You are the Living UI CREATION pipeline runner.
Read agent_file_system/workspace/pipeline/living-ui/README.md and
CREATION_PIPELINE.md in the CraftBot repo and follow them exactly.
Mode: CREATE — resume any in-flight creation run first; otherwise find the run
under runs/ whose ITERATION_LOG last status is HANDOFF, validate the handoff
bundle, and take it to AWAITING_HUMAN_REVIEW. If nothing is in flight or
HANDOFF, report that and stop.
```

**Feedback / approval (IMPROVE, paste into a Claude Code session):**

```
You are the Living UI CREATION pipeline runner.
Read agent_file_system/workspace/pipeline/living-ui/README.md in the CraftBot
repo and follow it exactly.
Mode: IMPROVE <slug>
My feedback on the current build:
- <issue 1>
- <issue 2>
(or the single word APPROVED)
```

### 5.1 Modes

The kickoff prompt sets the mode on its `Mode:` line.

| Mode | Runner | Behavior |
|---|---|---|
| **RESEARCH** | CraftBot (default) **or** Claude Code | Resume an in-flight research run (last status `RESEARCHING`/`SPEC_READY`) if one exists. Otherwise start the request from [NEW_APP_PROMPT.md](NEW_APP_PROMPT.md) and run stages R1–R8, ending with the handoff. CraftBot follows [RESEARCH_PIPELINE.md](RESEARCH_PIPELINE.md); a Claude Code session doing research instead follows [RESEARCH_PIPELINE_CLAUDE.md](RESEARCH_PIPELINE_CLAUDE.md) — same stages, same output contract, either is a valid producer of the handoff bundle. |
| **CREATE** | Claude Code | Resume an in-flight creation run per §8 (last status `HANDOFF` with a dead launcher, `BUILDING`, `SELF_QA`, `IMPROVING`, `PACKAGING`). Otherwise find the run whose last status is `HANDOFF` and run [CREATION_PIPELINE.md](CREATION_PIPELINE.md) as far as it goes without the human — normally until `AWAITING_HUMAN_REVIEW`. If nothing is in flight or `HANDOFF`: report "nothing handed off yet" and stop — never advance a run still logged as `RESEARCHING`/`SPEC_READY`. |
| **IMPROVE `<slug>`** | Claude Code | Locate `runs/<slug>-*/ITERATION_LOG.md`. Its last status must be `AWAITING_HUMAN_REVIEW` or `BLOCKED` — anything else, report the mismatch and stop. Take the feedback from the kickoff message and run [IMPROVEMENT_PIPELINE.md](IMPROVEMENT_PIPELINE.md). A feedback message of exactly `APPROVED` routes to packaging (CREATION_PIPELINE §7) instead. |

`AUTO` is a **deprecated alias for CREATE**; treat it identically. A bare in-conversation reply after a review request (same session still open) is treated identically to an IMPROVE kickoff — the prompt variant exists only for fresh sessions.

---

## 6. Pipeline at a glance

```
┌──────────────────────────────────────────────────────────────────┐
│ Human: fill in and paste NEW_APP_PROMPT.md into CraftBot chat    │
│        (or a Claude Code session, for the Claude Code variant)   │
└───────────────┬──────────────────────────────────────────────────┘
                ▼
┌──── RESEARCH PIPELINE — CraftBot ────────────────────────────────┐
│ R1 Start & preflight        status → RESEARCHING                 │
│ R2 Decompose request                                             │
│ R3 Research (4 parallel subagents) → research/*.md               │
│ R4 Merge + questionnaire self-interview                          │
│ R5 Write SPEC.md (gate)                        → SPEC_READY      │
│ R6 Reference capture (Playwright MCP)                            │
│ R7 Write DESIGN_SPEC.md (gate)                                   │
│ R8 Handoff: manifest check → status HANDOFF →                    │
│    launch `claude -p --model claude-sonnet-5` headless           │
└───────────────┬──────────────────────────────────────────────────┘
                ▼
┌──── CREATION PIPELINE — Claude Code ─────────────────────────────┐
│ C1 Find & resume the handed-off run                              │
│ C2 Validate bundle + spec review (amendments) → BUILDING         │
│ C3 Scaffold (`lui create`) + compile reference/requirements.md   │
│ C4 Build: per feature migration → ops → UI → `lui validate`      │
│ C5 Self-QA (QA_GATES G1–G7, ≤5 iterations,     → SELF_QA         │
│    G7 = package + audit the importable ZIP)                      │
└───────────────┬──────────────────────────────────────────────────┘
                ▼
┌──────────────────────────────────────────────────────────────────┐
│ C6 Review request posted             → AWAITING_HUMAN_REVIEW     │
│    Human imports deliverable/<slug>.zip into CraftBot, tests,    │
│    replies APPROVED or lists issues                              │
└───────┬───────────────────────────────────────┬──────────────────┘
        │ issues (≤5 rounds)                    │ APPROVED
        ▼                                       ▼
┌──────────────────────────┐   ┌───────────────────────────────────┐
│ I1–I6 Improvement round  │   │ C7 Package & deliver: final gate, │
│ parse → plan → fix →     │   │    clean, thumbnail, ZIP + audit  │
│ re-QA per matrix →       │   │              → PACKAGING → DONE   │
│ re-present → IMPROVING   │   │ C8 Retrospective → LESSONS.md     │
└──────────────────────────┘   └───────────────────────────────────┘
   Any stage may exit to BLOCKED (reason + human message) instead.
```

---

## 7. Pre-run self-check

**Creation runner (Claude Code)** — before touching anything, confirm:

- [ ] This README and [LESSONS.md](LESSONS.md) read in full this session.
- [ ] Model is Sonnet 5 (`--model claude-sonnet-5` if launched via `claude -p`; `/model sonnet` if this is a manually-pasted fallback session). The creation pipeline's judgment calls — spec repair, adversarial QA, BLOCKED escalations — assume a strong model.
- [ ] `CRAFTBOT_ROOT` / `LUI_ROOT` resolved; working directory is `CRAFTBOT_ROOT`.
- [ ] `node --version` ≥ 24; `node living-ui-v2/tools/src/cli.ts help` prints the command list.
- [ ] `node living-ui-v2/tools/src/cli.ts pb path` prints a real path (first call may download PocketBase).
- [ ] Playwright resolvable from `living-ui-v2/` (§2) — otherwise G3/G5 can only skip, which is not a pass.
- [ ] Mode determined from the kickoff prompt.
- [ ] Scan of `runs/*/ITERATION_LOG.md` done (§8) over **creation-owned states only** before claiming the handed-off run.
- [ ] On claim: ITERATION_LOG `CLAIMED (creation)` line written (status flips at C2, not C1).

**Research runner (CraftBot)** — its self-check lives inside [RESEARCH_PIPELINE.md](RESEARCH_PIPELINE.md) stage R1; it does not use this list.

---

## 8. When things go wrong

**BLOCKED protocol** — the only escape hatch, usable from any active state:

1. Append an ITERATION_LOG line: `status: BLOCKED`, with the reason stated inline (prefixed `research:` or `creation:` per which pipeline hit it).
2. Post a message to the human: *what happened, what was tried (with evidence), and 2–3 concrete options* (e.g. "A: relax constraint X, B: drop feature Y, C: abandon"). Then **end the turn**. Do not keep grinding past a bound "just in case".
3. On the human's answer: log the decision and the status being restored, continue.

**Session died mid-run** — a run under `runs/` hasn't reached a terminal status but no session is working it: read its `ITERATION_LOG.md` bottom-up to find the last verified position, verify that position against reality (does `app/` exist? does `lui validate` still pass? does the claimed feature actually work?), log a `RESUMED` line, and continue from there. Trust the log's *claims* only after spot-checking them.

**Mid-run requirement changes** — if the human sends new/changed requirements while a run is in flight (in chat — there's no request file to edit): treat it as feedback, log it, and fold it in at the next natural boundary (before C4 → into SPEC and `reference/requirements.md`; after C4 → as an improvement-round issue).

**Guide/pipeline contradiction** — if these docs and [agent-guide.md](../../../../living-ui-v2/docs/agent-guide.md) genuinely conflict: the guide wins for build mechanics, this pipeline wins for process/state; record the conflict as a `PROPOSAL:` in LESSONS.md.

**A research run that claims completion isn't necessarily one.** A run (`pokedex-web-app-20260803`) once declared "FULLY COMPLETED, ALL GATES PASSED" in a self-authored summary file while `ITERATION_LOG.md` held exactly one line and none of RESEARCH_PIPELINE.md's required `SPEC.md`/`DESIGN_SPEC.md`/lane files existed. Before trusting a "research complete" message: check `ITERATION_LOG.md` actually reached `HANDOFF`, and check the files that exist match RESEARCH_PIPELINE.md's named set (§0.2 of that doc) — not a plausible-sounding but different set of documents. If either check fails, the handoff didn't happen regardless of what the message says; treat it like any stuck `HANDOFF` (§5) and re-kick or resume manually.

---

## 9. Token budget

Target: a creation run to `AWAITING_HUMAN_REVIEW` costs **≤ ~80% of a Sonnet session**, so headroom remains for feedback rounds. Quality is never the cut — research depth, the browser pass, and the adversarial review all earn their cost; the waste is plumbing.

The **research runner's** budget is different in kind: CraftBot is TPM-limited, so its constraints are the subagent caps and stage bounds in RESEARCH_PIPELINE.md — wall-clock, not Sonnet-percentage. Research depth is explicitly not a budget cut in either pipeline.

Standing rules:

1. **`lui validate` is one command, not five gates.** It runs the dependency policy, `tsc`, the Vite build, migrations against a fresh temp database, `operations.json` structure + route matching, and the ownership hash check — in that order, reporting every failing step with the offending source line annotated. Run it after every meaningful change and read its output; never hand-roll equivalent checks.
2. **Research reports transit once.** Subagent lane briefs are written to `research/*.md` verbatim on arrival and merged from the files, never re-transcribed (RESEARCH_PIPELINE R3).
3. **Image reads are budgeted**: ≤1 reference screenshot during design (R6/C2), ≤1 QA screenshot (the thumbnail) per QA cycle; viewport captures only, never full-page. Trust the QA script's assertions — screenshots are artifacts for the human, not reading material for the runner.
4. **Never read `logs/pocketbase.log` whole.** It is a full SQL trace — a trivial boot is ~55 KB. Grep it for `Error`/`failed`/`panic` and quote only the matching lines.
5. **Gate re-runs follow the impact matrix** (QA_GATES §4), quiet output flags always (`| tail -20`). Full cascades on frontend-only fixes catch nothing.
6. **Artifacts are terse**: ITERATION_LOG entries ≤2 lines; QA reports summarize with failure excerpts only; no full logs pasted anywhere.
