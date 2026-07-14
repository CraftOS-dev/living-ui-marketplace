# `pipeline/living-ui/` — Autonomous Living UI creation pipeline

This folder owns the process of turning a short, human-written requirement into a finished, reviewed, published Living UI app in the [living-ui-marketplace](../../living-ui-marketplace/) — with the human involved at exactly three points: **enqueue a request**, **paste a kickoff prompt into CraftBot chat**, and **test the app at one review gate**.

It is the autonomous replacement for the manual flow in [NEW_APP_PROMPT.md](NEW_APP_PROMPT.md). The work is split across **two runners**:

- The **research runner** — **CraftBot** (the agent app, a cheaper model). It claims the request, researches the product category with parallel subagents, writes the requirements spec (`SPEC.md`), captures UX references from state-of-the-art products, writes the layout spec (`DESIGN_SPEC.md`), and then hands off by launching the creation runner. It reads **only** [RESEARCH_PIPELINE.md](RESEARCH_PIPELINE.md), which is fully self-contained.
- The **creation runner** — a **Claude Code session**. It validates the handoff bundle, builds per [LIVING_UI_GUIDE.md](LIVING_UI_GUIDE.md), self-QAs against hard gates, iterates on human feedback, and opens the marketplace PR itself.

The handoff is automatic: the research runner's last stage launches `claude -p` headless with the Creation kickoff prompt (§5). The whole path from kickoff to `AWAITING_HUMAN_REVIEW` runs unattended.

## Read in this order

| Doc | What it is | Who reads it, when |
|---|---|---|
| **README.md** (this file) | Hard rules, path resolution, queue spec + state machine, run artifacts, mode routing, kickoff prompts | Creation runner + human, start of **every** run. The research runner does **not** read this — its doc restates everything it needs |
| [LESSONS.md](LESSONS.md) | Append-only lessons from past runs | Creation runner, start of **every** run, immediately after this file |
| [RESEARCH_PIPELINE.md](RESEARCH_PIPELINE.md) | The research SOP (stages R1–R8): claim → research subagents → SPEC.md → Playwright reference capture → DESIGN_SPEC.md → handoff launch. **Written for CraftBot; fully self-contained** | Research runner (CraftBot), its only required reading. C8 keeps its §2 Standing corrections in sync |
| [CREATION_PIPELINE.md](CREATION_PIPELINE.md) | The creation SOP (stages C1–C8): claim handed-off run → validate bundle → build → QA → review → publish | Creation runner, mode CREATE |
| [QA_GATES.md](QA_GATES.md) | The automated gate list G1–G8 (G8 = restore to import-ready state), fix–retest impact matrix, QA report template | Creation runner, from stage C5 and improvement stage I5 |
| [IMPROVEMENT_PIPELINE.md](IMPROVEMENT_PIPELINE.md) | Human-feedback iteration loop (stages I1–I6) | Creation runner, mode IMPROVE, or when a review reply lists issues |
| [LIVING_UI_GUIDE.md](LIVING_UI_GUIDE.md) | The underlying build workflow (Phases 0–10). **Not part of this pipeline's docs — it is the ground truth the pipeline drives.** | Creation runner, from stage C4 |

`PIPELINE_OVERVIEW.drawio` is the visual companion (page 1 = whole pipeline, page 2 = QA loop). It documents; the markdown governs.

---

## 0. Hard rules

1. **Read [LESSONS.md](LESSONS.md) before doing anything else, every run.** Lessons are corrections paid for by past failures; skipping them re-buys the same failures. (Research-runner equivalent: RESEARCH_PIPELINE §2 Standing corrections, which C8 keeps in sync.)
2. **The queue file's `status` field is the only state store.** Every transition edits the queue file *and* appends one line to the run's `ITERATION_LOG.md`. A run whose status doesn't match reality is a process bug — stop and fix it before continuing.
3. **One request in flight per pipeline. Resume before you claim — within the states your pipeline owns.** The research runner owns `QUEUED` → entry into `HANDOFF`; the creation runner owns exit from `HANDOFF` → `DONE` (state table in §3.2 has the Owner column). Neither runner ever claims, advances, or edits a queue file sitting in the other pipeline's states. If a queue file in your pipeline's states is in a non-terminal active state, resume that run (see §8) before claiming new work. v1 assumes at most one live session per pipeline; never run two sessions of the same pipeline against the queue at once.
4. **Never edit `_template/`, [LIVING_UI_GUIDE.md](LIVING_UI_GUIDE.md), the skill references, or `GLOBAL_LIVING_UI.md`.** If a run reveals they should change, record a `PROPOSAL:` line in LESSONS.md and continue. The pipeline improves itself through LESSONS.md, not by mutating its ground truth.
5. **Marketplace repo: branch + PR only.** Never commit to its default branch, never `--force`, never merge your own PR. The human reviews and merges.
6. **Human contact happens only at the review gate (C6/I6) and BLOCKED escalations.** Everywhere the guide says "ask the user", the pipeline means: consult `SPEC.md` / `DESIGN_SPEC.md`; if silent, apply a Safe Assumption from [QUESTIONNAIRE.md](../../skills/living-ui-creator/references/QUESTIONNAIRE.md) and log it in the assumptions register and ITERATION_LOG.
7. **Visual identity is CraftBot's, always.** Reference products inform *structure and behavior* (layout, navigation, interactions). Colors, fonts, spacing, radii, and components come exclusively from [GLOBAL_LIVING_UI.md](../../agent_file_system/GLOBAL_LIVING_UI.md), the `global.css` design tokens, and the preset components. No exceptions, ever.
8. **Never weaken a gate to pass it.** No deleting failing tests, no lowering thresholds, no skipping viewports, no "this check doesn't apply here". Fix the app, or go BLOCKED with the failure documented. This rule exists because a gate you can quietly bend is not a gate. **This also covers re-characterizing a red result as passing or non-blocking in a log line** — e.g. calling a failed test "an expected artifact" or "fuzzing noise" — **without independently-verified, quoted command evidence** (the exact command and its output, pasted into ITERATION_LOG or the QA report) proving it isn't a real failure. A run-1 incident logged "PUT failures are expected test runner fuzzing artifacts" over a gate whose own JSON output said `"status": "fail"`; no test was deleted, so the letter of this rule didn't catch it — the spirit does. If you can't produce the command output that justifies dismissing a failure, it isn't dismissible: fix it or go BLOCKED.
9. **All run artifacts live under `runs/<run_id>/`.** Nothing in the repo root, nothing in system temp dirs. A fresh session must be able to find everything a dead session left behind.
10. **The human only ever sees an import-ready app.** The human tests by importing the folder into CraftBot — so QA gate **G8 (restore to base import-ready state + audit)** must pass before *every* review handoff (C6 and each I6 round), not just at publish. Base state means: placeholders (`{{PORT}}` / `{{BACKEND_PORT}}` / `{{PROJECT_ID}}`) intact, and zero runtime artifacts (`node_modules/`, `dist/`, `package-lock.json`, `__pycache__/`, `living_ui.db*`, `logs/`, `uploads/`, caches). This rule exists because run 1 handed over a placeholder-substituted folder with `node_modules/` — the import threw backend errors and the size blocked upload.
11. **Respect the token budget (§9).** A run to the review gate should cost **≤ ~80% of a Sonnet session** so headroom remains for feedback rounds. Run 1 cost 124%; the §9 rules are the correction — follow them unless they'd compromise output quality (research depth and QA rigor are explicitly not budget cuts).

---

## 1. Repo layout and path resolution

Two repos are involved. Resolve them once at run start and use absolute paths everywhere:

- **`CRAFTBOT_ROOT`** — the CraftBot repo containing this folder (`<CRAFTBOT_ROOT>/pipeline/living-ui/`).
- **`MARKETPLACE_ROOT`** — the marketplace working copy at `<CRAFTBOT_ROOT>/living-ui-marketplace/`. It is its own git repo (remote `CraftOS-dev/living-ui-marketplace`), **nested inside** CraftBot's repo.

> **Nested-layout warning:** [LIVING_UI_GUIDE.md](LIVING_UI_GUIDE.md) assumes a *sibling* layout and links to `../CraftBot/...` — those relative links 404 in this checkout. Whenever the guide references a skill file, resolve it from these locations instead:
>
> | Guide reference | Actual location |
> |---|---|
> | `../CraftBot/skills/living-ui-creator/SKILL.md` and `references/*.md` | `<CRAFTBOT_ROOT>/skills/living-ui-creator/` |
> | `../CraftBot/agent_file_system/GLOBAL_LIVING_UI.md` | `<CRAFTBOT_ROOT>/agent_file_system/GLOBAL_LIVING_UI.md` |
> | `../CraftBot/app/data/living_ui_modules/auth/` | `<CRAFTBOT_ROOT>/app/data/living_ui_modules/auth/` |

Pre-flight commands (also in the §7 checklist):

```sh
# Nested checkout trips git's "dubious ownership" guard. Global config change —
# tell the human you're doing it the first time.
git config --global --add safe.directory <MARKETPLACE_ROOT>

# PR creation needs an authenticated gh with push rights to the marketplace repo.
gh auth status
```

If `gh auth status` fails, that is not a blocker for stages C1–C6 — flag it in the first ITERATION_LOG entry and escalate only if still broken at C7 (publish).

**`claude` CLI (machine prerequisite, human-owned):** the research→creation handoff launches `claude -p` headless, so the standalone Claude Code CLI must resolve on PATH on the machine CraftBot runs on (`where claude` prints a path). Install with `irm https://claude.ai/install.ps1 | iex` (or `npm install -g @anthropic-ai/claude-code`). The VS Code extension's bundled binary does **not** count — it is not on PATH and its path breaks on every extension update. RESEARCH_PIPELINE stage R1 gates on this so a missing CLI fails the run at minute 1, not at handoff time.

**Authoritative copy:** this folder (`<CRAFTBOT_ROOT>/agent_file_system/workspace/pipeline/living-ui/`) is the **sole authoritative** pipeline tree. The `living-ui-marketplace/pipeline/living-ui/` folder holds only legacy run artifacts from early runs — never read pipeline docs from there.

---

## 2. Modes

The kickoff prompt (§5) sets the mode on its `Mode:` line.

| Mode | Runner | Behavior |
|---|---|---|
| **RESEARCH** | CraftBot | Resume any in-flight research run (states `RESEARCHING`/`SPEC_READY`). Otherwise claim the next `QUEUED` request (claim rule in §3) and run [RESEARCH_PIPELINE.md](RESEARCH_PIPELINE.md) stages R1–R8, ending with the handoff launch. If the queue is empty and nothing research-owned is in flight: report "queue empty" and stop. |
| **CREATE** | Claude Code | Resume any in-flight creation run per §8 (states `HANDOFF` with a dead launcher, `BUILDING`, `SELF_QA`, `IMPROVING`, `PUBLISHING`). Otherwise claim the oldest `HANDOFF` file and run [CREATION_PIPELINE.md](CREATION_PIPELINE.md) as far as it goes without the human — normally until `AWAITING_HUMAN_REVIEW`. If nothing is in flight or `HANDOFF`: report "nothing handed off yet" and stop — never claim `QUEUED`/`RESEARCHING`/`SPEC_READY` files (those belong to the research pipeline). |
| **IMPROVE `<slug>`** | Claude Code | Locate the queue file for `<slug>`. Its status must be `AWAITING_HUMAN_REVIEW` or `BLOCKED` — anything else, report the mismatch and stop. Take the feedback from the kickoff message and run [IMPROVEMENT_PIPELINE.md](IMPROVEMENT_PIPELINE.md). A feedback message of exactly `APPROVED` routes to publish (CREATION_PIPELINE §7) instead. |

`AUTO` is a **deprecated alias for CREATE** (pre-split kickoffs used it); treat it identically to CREATE.

A bare in-conversation reply after a review request (same session still open) is treated identically to an IMPROVE kickoff — the prompt variant exists only for fresh sessions.

---

## 3. Queue specification

The queue is the folder `pipeline/living-ui/queue/`. One markdown file per request. **This schema is the adapter contract**: a future Google Sheets (or DB) intake replaces only this section — one row per request, columns = the front-matter fields, and the status state machine is unchanged.

### 3.1 Request file

Name: `queue/<YYYYMMDD>-<slug>.md` (date prefix gives FIFO ordering within a priority). Humans create requests by copying [queue/REQUEST_TEMPLATE.md](queue/REQUEST_TEMPLATE.md).

| Field | Type | Written by | When |
|---|---|---|---|
| `app_name` | string | human | at enqueue — display name for catalogue/manifest |
| `slug` | kebab-case string | human | at enqueue — app folder name **and** catalogue id |
| `tags` | list of 3–5 strings | human | at enqueue — catalogue tags |
| `priority` | 1 (high) / 2 (normal) / 3 (low) | human | at enqueue |
| `status` | state name | human writes `QUEUED` once; **runner only** after claim | every transition |
| `requested` | YYYY-MM-DD | human | at enqueue |
| `claimed_by` | string | runner | at claim — short session label |
| `run_id` | string | runner | at claim — `<slug>-<YYYYMMDD>` |
| `updated` | YYYY-MM-DD | runner | every status change |
| `review_round` | int | runner | starts 0; +1 per improvement round |
| `pr_url` | URL | runner | at publish |
| `blocked_reason` | string | runner | when entering BLOCKED/FAILED; cleared on resume |

Body sections (free text): `## Requirement` (1–10 sentences), `## References` (products/URLs the human already likes — these are **pinned** and outrank all research findings), `## Constraints` (auth needs, integrations, explicit non-goals).

### 3.2 Status state machine

```
      RESEARCH PIPELINE (CraftBot)          │        CREATION PIPELINE (Claude Code)
                                            │
QUEUED → RESEARCHING → SPEC_READY → HANDOFF ──► BUILDING → SELF_QA → AWAITING_HUMAN_REVIEW
(human)                          (launch claude)                          │
                                            │             ┌──────────────┤
                                            │             │ (issues)     │ (APPROVED)
                                            │             ▼              ▼
                                            │         IMPROVING ──► PUBLISHING ──► DONE
                                            │             │  (back to AWAITING_HUMAN_REVIEW
                                            │             ▼   after each round)
        BLOCKED  ◄── reachable from ANY active state, by either runner;
           │         blocked_reason prefixed "research:" or "creation:", human pinged
           ├── human unblocks → back to the state it left
           └── human abandons → FAILED (terminal)
```

| State | Owner | Meaning | Exits to |
|---|---|---|---|
| `QUEUED` | human | Human dropped the file; untouched by any runner | `RESEARCHING` (research claim, R1) |
| `RESEARCHING` | research | Claimed; research subagents → SPEC.md in progress | `SPEC_READY`, `BLOCKED` |
| `SPEC_READY` | research | SPEC.md passed its gate; design-reference capture + DESIGN_SPEC.md happen here | `HANDOFF`, `BLOCKED` |
| `HANDOFF` | boundary | Research complete; bundle verified; creation runner launched. **The creation runner flips this to `BUILDING` as its very first queue write (C2)** — a file sitting in `HANDOFF` for more than ~10 minutes means the launch died; paste the Creation kickoff (§5) manually | `BUILDING`, `BLOCKED` |
| `BUILDING` | creation | Bundle validated; guide Phases 1–9 in progress | `SELF_QA`, `BLOCKED` |
| `SELF_QA` | creation | QA_GATES loop running | `AWAITING_HUMAN_REVIEW`, `BLOCKED` |
| `AWAITING_HUMAN_REVIEW` | creation | Review request posted; runner idle or session ended | `PUBLISHING` (APPROVED), `IMPROVING` (issues) |
| `IMPROVING` | creation | Feedback round in progress; `review_round` incremented | `AWAITING_HUMAN_REVIEW`, `BLOCKED` |
| `PUBLISHING` | creation | Revert → clean → catalogue → branch → PR in progress | `DONE`, `BLOCKED` |
| `DONE` | — | **Terminal.** `pr_url` filled, retrospective appended to LESSONS.md | — |
| `BLOCKED` | either | Escape hatch; `blocked_reason` filled (prefixed with the pipeline that hit it); human message posted (§8) | previous state (unblock), `FAILED` |
| `FAILED` | — | **Terminal.** Human explicitly abandoned the request | — |

**Claim rule (research):** among `status: QUEUED` files, pick lowest `priority` number, then oldest `requested`, then oldest filename. **Claim rule (creation):** among `status: HANDOFF` files, pick the oldest `updated`. For both: rule 3 applies first — resume any in-flight run in your own pipeline's states before claiming.

---

## 4. Run artifacts

Each run gets `pipeline/living-ui/runs/<run_id>/` (git-ignored — the durable record is the marketplace PR plus LESSONS.md):

```
runs/<slug>-<YYYYMMDD>/
├── ITERATION_LOG.md        # append-only journal — the resume anchor
├── SPEC.md                 # generated requirements spec (replaces guide Phase 0 output)
├── DESIGN_SPEC.md          # layout/UX spec from reference capture
├── research/               # research artifacts: decomposition.md, features.md,
│                           #   competitors.md, ux-patterns.md, data-model.md,
│                           #   questionnaire.md, (capture-fallback.md if no shots)
├── reference-shots/        # Playwright PNGs of reference products
├── qa/                     # qa-report-1.md … N, feedback-round-1.md … N
├── creation.log            # stdout/stderr of the auto-launched creation session (R8)
├── REVIEW_REQUEST.md       # every human-handoff message, appended per round
└── thumbnail.png           # captured during QA; copied into the app folder at publish
```

**ITERATION_LOG.md format** — one line per event, appended immediately when it happens:

```
2026-07-08 14:02 | BUILDING | feature 3/6 done: categories CRUD, 12 tests green | next: feature 4 (media attachments)
2026-07-08 14:40 | SELF_QA  | entered QA loop, iteration 1 | next: G1
```

Rule: a fresh session must be able to reconstruct where the run stands from ITERATION_LOG alone. Write every log line with that reader in mind — state what is done, what is verified, and what comes next.

---

## 5. Kickoff prompts

These are the only things the human pastes to start a runner. **They never change** — all routing and logic lives in these docs, so the pipeline can evolve without re-teaching the human.

**Research (paste into CraftBot chat — this is the one prompt that starts the whole autonomous run):**

```
You are the Living UI RESEARCH pipeline runner.
Read the file /workspace/pipeline/living-ui/RESEARCH_PIPELINE.md in full and
follow it exactly, stage by stage, in order.
Mode: RESEARCH — resume any in-flight research run, otherwise claim the next
QUEUED request, and take it through stage R8 (handoff).
```

**Creation (auto-launched by RESEARCH_PIPELINE R8; paste the same words into a Claude Code session if the queue file is stuck in HANDOFF):**

```
You are the Living UI CREATION pipeline runner.
Read agent_file_system/workspace/pipeline/living-ui/README.md and
CREATION_PIPELINE.md in the CraftBot repo and follow them exactly.
Mode: CREATE — resume any in-flight creation run first; otherwise claim the
oldest queue file with status HANDOFF, validate the handoff bundle, and take
it to AWAITING_HUMAN_REVIEW. If nothing is in flight or HANDOFF, report that
and stop.
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

---

## 6. Pipeline at a glance

```
┌──────────────────────────────────────────────────────────────────┐
│ Human: copy queue/REQUEST_TEMPLATE.md → queue/<date>-<slug>.md   │
│        paste RESEARCH kickoff prompt into CraftBot chat          │
└───────────────┬──────────────────────────────────────────────────┘
                ▼
┌──── RESEARCH PIPELINE — CraftBot ────────────────────────────────┐
│ R1 Claim & preflight        status → RESEARCHING                 │
│ R2 Decompose request                                             │
│ R3 Research (4 parallel subagents) → research/*.md               │
│ R4 Merge + questionnaire self-interview                          │
│ R5 Write SPEC.md (gate)                        → SPEC_READY      │
│ R6 Reference capture (Playwright MCP)                            │
│ R7 Write DESIGN_SPEC.md (gate)                                   │
│ R8 Handoff: manifest check → status HANDOFF →                    │
│    launch `claude -p <Creation kickoff>` headless                │
└───────────────┬──────────────────────────────────────────────────┘
                ▼
┌──── CREATION PIPELINE — Claude Code ─────────────────────────────┐
│ C1 Claim handed-off run                                          │
│ C2 Validate bundle + spec review (amendments) → BUILDING         │
│ C4 Build (LIVING_UI_GUIDE Phases 1–9)                            │
│ C5 Self-QA (QA_GATES G1–G8, ≤5 iterations,     → SELF_QA         │
│    G8 = restore to import-ready base state)                      │
└───────────────┬──────────────────────────────────────────────────┘
                ▼
┌──────────────────────────────────────────────────────────────────┐
│ C6 Review request posted             → AWAITING_HUMAN_REVIEW     │
│    Human tests locally, replies APPROVED or lists issues         │
└───────┬───────────────────────────────────────┬──────────────────┘
        │ issues (≤5 rounds)                    │ APPROVED
        ▼                                       ▼
┌──────────────────────────┐   ┌───────────────────────────────────┐
│ I1–I6 Improvement round  │   │ C7 Publish: revert placeholders,  │
│ parse → plan → fix →     │   │    clean, catalogue + thumbnail,  │
│ full re-QA → re-present  │   │    branch, commit, gh pr create   │
│      → IMPROVING         │   │              → PUBLISHING → DONE  │
└──────────────────────────┘   │ C8 Retrospective → LESSONS.md     │
                               └───────────────────────────────────┘
   Any stage may exit to BLOCKED (reason + human message) instead.
```

---

## 7. Pre-run self-check

**Creation runner (Claude Code)** — before touching the queue, confirm:

- [ ] This README and [LESSONS.md](LESSONS.md) read in full this session.
- [ ] `CRAFTBOT_ROOT` and `MARKETPLACE_ROOT` resolved; `MARKETPLACE_ROOT` exists and `git -C <MARKETPLACE_ROOT> status` works (apply the `safe.directory` fix from §1 if not).
- [ ] `git -C <MARKETPLACE_ROOT> status --short` is clean, or every dirty path belongs to a run being resumed.
- [ ] `gh auth status` checked (result logged; only blocks C7).
- [ ] Mode determined from the kickoff prompt.
- [ ] In-flight-run scan done (§8) over **creation-owned states only** before any claim.
- [ ] On claim: ITERATION_LOG `CLAIMED (creation)` line written (status flips at C2, not C1).

**Research runner (CraftBot)** — its self-check lives inside [RESEARCH_PIPELINE.md](RESEARCH_PIPELINE.md) stage R1; it does not use this list.

---

## 8. When things go wrong

**BLOCKED protocol** — the only escape hatch, usable from any active state:

1. Set `status: BLOCKED` and fill `blocked_reason` in the queue file; bump `updated`.
2. Append an ITERATION_LOG line stating exactly where the run stopped and why.
3. Post a message to the human: *what happened, what was tried (with evidence), and 2–3 concrete options* (e.g. "A: relax constraint X, B: drop feature Y, C: abandon"). Then **end the turn**. Do not keep grinding past a bound "just in case".
4. On the human's answer: restore `status` to the state that was left (clear `blocked_reason`), log the decision, continue.

**Session died mid-run** — a queue file is in an active state but no session is working it: read its `ITERATION_LOG.md` bottom-up to find the last verified position, verify that position against reality (do the files/tests it claims actually exist/pass?), log a `RESUMED` line, and continue from there. Trust the log's *claims* only after spot-checking them.

**Double claim** — two queue files claimed by different `claimed_by` labels, or one file claimed twice: stop, report both to the human, let them pick. v1 has no locking; the "resume before claim" rule is the mitigation.

**Queue file conflicts** — if the queue file was hand-edited while a run was in flight (human changed requirements mid-build): treat the edit as feedback, log it, and fold it in at the next natural boundary (before C4 → into SPEC; after C4 → as an improvement-round issue). Never silently overwrite a human edit.

**Guide/pipeline contradiction** — if these docs and [LIVING_UI_GUIDE.md](LIVING_UI_GUIDE.md) genuinely conflict beyond the documented amendments (CREATION_PIPELINE §4): the guide wins for build mechanics, this pipeline wins for process/state; record the conflict as a `PROPOSAL:` in LESSONS.md.

---

## 9. Token budget

Target: a creation run to `AWAITING_HUMAN_REVIEW` costs **≤ ~80% of a Sonnet session**. (Honest calibration from run 1: with research kept at full depth, an app of tierlist's complexity lands ~85–95% unless the rules below are followed; the rules below are what closes the gap.) Quality is never the cut — research depth, the browser pass, and the adversarial review all earned their cost in run 1; the waste was plumbing. Now that research/design moved to the research pipeline, the creation session's budget covers validation + build + QA only.

The **research runner's** budget is different in kind: CraftBot is TPM-limited (slow mode), so its constraints are the subagent caps and stage bounds in RESEARCH_PIPELINE.md — wall-clock, not Sonnet-percentage. Research depth is explicitly not a budget cut in either pipeline.

Standing rules (each traces to a measured run-1 cost):

1. **Research reports transit once.** Subagent lane briefs are written to `research/*.md` verbatim on arrival and merged from the files, never re-transcribed (RESEARCH_PIPELINE R3). Run 1 paid for every report ~3×: generation, full context transit, re-transcription.
2. **Image reads are budgeted**: ≤1 reference screenshot during design (R6/C2), ≤1 QA screenshot (the thumbnail) per QA cycle; viewport captures only, never full-page. Run 1 read 7 images including a 390×10,229px capture.
3. **Pytest = domain logic only**; `test_runner.py --unit`/`--external` owns generic CRUD (QA_GATES G1). Run 1 wrote 35 tests where ~18 carried the unique coverage.
4. **Gate re-runs follow the impact matrix** (QA_GATES §4), quiet output flags always (`pytest -q`, `tail -5`). Run 1's full cascades on frontend-only fixes caught nothing.
5. **Artifacts are terse**: ITERATION_LOG entries ≤2 lines; QA reports summarize with failure excerpts only; no full logs pasted anywhere.
