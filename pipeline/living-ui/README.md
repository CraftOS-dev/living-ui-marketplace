# `pipeline/living-ui/` — Autonomous Living UI creation pipeline

This folder owns the process of turning a short, human-written requirement into a finished, reviewed, published Living UI app in the [living-ui-marketplace](../../living-ui-marketplace/) — with the human involved at exactly three points: **enqueue a request**, **paste a kickoff prompt**, and **test the app at one review gate**.

It is the autonomous replacement for the manual flow in [NEW_APP_PROMPT.md](NEW_APP_PROMPT.md). The agent (a Claude Code session, called the **runner** throughout these docs) does everything else: researches the product category with parallel subagents, writes its own requirements spec, captures UX references from state-of-the-art products, builds per [LIVING_UI_GUIDE.md](LIVING_UI_GUIDE.md), self-QAs against hard gates, iterates on human feedback, and opens the marketplace PR itself.

## Read in this order

| Doc | What it is | When the runner reads it |
|---|---|---|
| **README.md** (this file) | Hard rules, path resolution, queue spec + state machine, run artifacts, mode routing, kickoff prompts | Start of **every** run |
| [LESSONS.md](LESSONS.md) | Append-only lessons from past runs | Start of **every** run, immediately after this file |
| [CREATION_PIPELINE.md](CREATION_PIPELINE.md) | The end-to-end creation SOP (stages C1–C8) | When running mode AUTO |
| [RESEARCH_AND_DESIGN.md](RESEARCH_AND_DESIGN.md) | Stage detail: research subagents → SPEC.md; Playwright reference capture → DESIGN_SPEC.md | From stages C2/C3 |
| [QA_GATES.md](QA_GATES.md) | The automated gate list G1–G8 (G8 = restore to import-ready state), fix–retest impact matrix, QA report template | From stage C5 and improvement stage I5 |
| [IMPROVEMENT_PIPELINE.md](IMPROVEMENT_PIPELINE.md) | Human-feedback iteration loop (stages I1–I6) | When running mode IMPROVE, or when a review reply lists issues |
| [LIVING_UI_GUIDE.md](LIVING_UI_GUIDE.md) | The underlying build workflow (Phases 0–10). **Not part of this pipeline's docs — it is the ground truth the pipeline drives.** | From stage C4 |

`PIPELINE_OVERVIEW.drawio` is the visual companion (page 1 = whole pipeline, page 2 = QA loop). It documents; the markdown governs.

---

## 0. Hard rules

1. **Read [LESSONS.md](LESSONS.md) before doing anything else, every run.** Lessons are corrections paid for by past failures; skipping them re-buys the same failures.
2. **The queue file's `status` field is the only state store.** Every transition edits the queue file *and* appends one line to the run's `ITERATION_LOG.md`. A run whose status doesn't match reality is a process bug — stop and fix it before continuing.
3. **One request in flight per session. Resume before you claim.** If any queue file is in a non-terminal, non-`QUEUED` state, resume that run (see §8) before claiming new work. v1 assumes a single runner; never run two sessions against the queue at once.
4. **Never edit `_template/`, [LIVING_UI_GUIDE.md](LIVING_UI_GUIDE.md), the skill references, or `GLOBAL_LIVING_UI.md`.** If a run reveals they should change, record a `PROPOSAL:` line in LESSONS.md and continue. The pipeline improves itself through LESSONS.md, not by mutating its ground truth.
5. **Marketplace repo: branch + PR only.** Never commit to its default branch, never `--force`, never merge your own PR. The human reviews and merges.
6. **Human contact happens only at the review gate (C6/I6) and BLOCKED escalations.** Everywhere the guide says "ask the user", the pipeline means: consult `SPEC.md` / `DESIGN_SPEC.md`; if silent, apply a Safe Assumption from [QUESTIONNAIRE.md](../../skills/living-ui-creator/references/QUESTIONNAIRE.md) and log it in the assumptions register and ITERATION_LOG.
7. **Visual identity is CraftBot's, always.** Reference products inform *structure and behavior* (layout, navigation, interactions). Colors, fonts, spacing, radii, and components come exclusively from [GLOBAL_LIVING_UI.md](../../agent_file_system/GLOBAL_LIVING_UI.md), the `global.css` design tokens, and the preset components. No exceptions, ever.
8. **Never weaken a gate to pass it.** No deleting failing tests, no lowering thresholds, no skipping viewports, no "this check doesn't apply here". Fix the app, or go BLOCKED with the failure documented. This rule exists because a gate you can quietly bend is not a gate.
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

---

## 2. Modes

The kickoff prompt (§5) sets the mode on its `Mode:` line.

| Mode | Behavior |
|---|---|
| **AUTO** (default) | Resume any in-flight run per §8. Otherwise claim the next `QUEUED` request (claim rule in §3) and run [CREATION_PIPELINE.md](CREATION_PIPELINE.md) as far as it goes without the human — normally until `AWAITING_HUMAN_REVIEW`. If the queue is empty and nothing is in flight: report "queue empty" and stop. |
| **IMPROVE `<slug>`** | Locate the queue file for `<slug>`. Its status must be `AWAITING_HUMAN_REVIEW` or `BLOCKED` — anything else, report the mismatch and stop. Take the feedback from the kickoff message and run [IMPROVEMENT_PIPELINE.md](IMPROVEMENT_PIPELINE.md). A feedback message of exactly `APPROVED` routes to publish (CREATION_PIPELINE §7) instead. |

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
QUEUED → RESEARCHING → SPEC_READY → BUILDING → SELF_QA → AWAITING_HUMAN_REVIEW
                                                              │
                                              ┌───────────────┤
                                              │ (issues)      │ (APPROVED)
                                              ▼               ▼
                                          IMPROVING ──►  PUBLISHING ──► DONE
                                              │  (back to AWAITING_HUMAN_REVIEW
                                              ▼   after each round)
        BLOCKED  ◄── reachable from ANY active state; blocked_reason set, human pinged
           │
           ├── human unblocks → back to the state it left
           └── human abandons → FAILED (terminal)
```

| State | Meaning | Exits to |
|---|---|---|
| `QUEUED` | Human dropped the file; untouched by any runner | `RESEARCHING` (claim) |
| `RESEARCHING` | Claimed; research subagents → SPEC.md in progress | `SPEC_READY`, `BLOCKED` |
| `SPEC_READY` | SPEC.md passed its rubric; design-reference capture happens here too | `BUILDING`, `BLOCKED` |
| `BUILDING` | Guide Phases 1–9 in progress | `SELF_QA`, `BLOCKED` |
| `SELF_QA` | QA_GATES loop running | `AWAITING_HUMAN_REVIEW`, `BLOCKED` |
| `AWAITING_HUMAN_REVIEW` | Review request posted; runner idle or session ended | `PUBLISHING` (APPROVED), `IMPROVING` (issues) |
| `IMPROVING` | Feedback round in progress; `review_round` incremented | `AWAITING_HUMAN_REVIEW`, `BLOCKED` |
| `PUBLISHING` | Revert → clean → catalogue → branch → PR in progress | `DONE`, `BLOCKED` |
| `DONE` | **Terminal.** `pr_url` filled, retrospective appended to LESSONS.md | — |
| `BLOCKED` | Escape hatch; `blocked_reason` filled; human message posted (§8) | previous state (unblock), `FAILED` |
| `FAILED` | **Terminal.** Human explicitly abandoned the request | — |

**Claim rule:** among `status: QUEUED` files, pick lowest `priority` number, then oldest `requested`, then oldest filename. But rule 3 applies first — resume any in-flight run before claiming.

---

## 4. Run artifacts

Each run gets `pipeline/living-ui/runs/<run_id>/` (git-ignored — the durable record is the marketplace PR plus LESSONS.md):

```
runs/<slug>-<YYYYMMDD>/
├── ITERATION_LOG.md        # append-only journal — the resume anchor
├── SPEC.md                 # generated requirements spec (replaces guide Phase 0 output)
├── DESIGN_SPEC.md          # layout/UX spec from reference capture
├── research/               # raw subagent outputs: features.md, competitors.md,
│                           #   ux-patterns.md, data-model.md
├── reference-shots/        # Playwright PNGs of reference products
├── qa/                     # qa-report-1.md … N, feedback-round-1.md … N
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

These are the only things the human pastes to start the runner. **They never change** — all routing and logic lives in these docs, so the pipeline can evolve without re-teaching the human.

**Creation / continue (AUTO):**

```
You are the Living UI pipeline runner.
Read pipeline/living-ui/README.md in the CraftBot repo and follow it exactly.
Mode: AUTO — resume any in-flight run, otherwise claim the next queued request,
and take it as far as the pipeline allows without me.
```

**Feedback / approval (IMPROVE):**

```
You are the Living UI pipeline runner.
Read pipeline/living-ui/README.md in the CraftBot repo and follow it exactly.
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
│        paste AUTO kickoff prompt                                 │
└───────────────┬──────────────────────────────────────────────────┘
                ▼
┌──────────────────────────────────────────────────────────────────┐
│ C1 Claim & setup            status → RESEARCHING                 │
│ C2 Research (4 parallel subagents) → SPEC.md   → SPEC_READY      │
│ C3 Design reference (Playwright) → DESIGN_SPEC.md                │
│ C4 Build (LIVING_UI_GUIDE Phases 1–9)          → BUILDING        │
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

Before touching the queue, confirm:

- [ ] This README and [LESSONS.md](LESSONS.md) read in full this session.
- [ ] `CRAFTBOT_ROOT` and `MARKETPLACE_ROOT` resolved; `MARKETPLACE_ROOT` exists and `git -C <MARKETPLACE_ROOT> status` works (apply the `safe.directory` fix from §1 if not).
- [ ] `git -C <MARKETPLACE_ROOT> status --short` is clean, or every dirty path belongs to a run being resumed.
- [ ] `gh auth status` checked (result logged; only blocks C7).
- [ ] Mode determined from the kickoff prompt.
- [ ] In-flight-run scan done (§8) before any claim.
- [ ] On claim: queue file updated (`status`, `claimed_by`, `run_id`, `updated`) and ITERATION_LOG header written.

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

Target: a creation run to `AWAITING_HUMAN_REVIEW` costs **≤ ~80% of a Sonnet session**. (Honest calibration from run 1: with research kept at full depth, an app of tierlist's complexity lands ~85–95% unless the rules below are followed; the rules below are what closes the gap.) Quality is never the cut — research depth, the browser pass, and the adversarial review all earned their cost in run 1; the waste was plumbing.

Standing rules (each traces to a measured run-1 cost):

1. **Research subagents write their own reports to disk** and return ≤150-word summaries (RESEARCH_AND_DESIGN A2). Run 1 paid for every report ~3×: generation, full context transit, re-transcription.
2. **Image reads are budgeted**: ≤1 reference screenshot in C3, ≤1 QA screenshot (the thumbnail) per QA cycle; viewport captures only, never full-page. Run 1 read 7 images including a 390×10,229px capture.
3. **Pytest = domain logic only**; `test_runner.py --unit`/`--external` owns generic CRUD (QA_GATES G1). Run 1 wrote 35 tests where ~18 carried the unique coverage.
4. **Gate re-runs follow the impact matrix** (QA_GATES §4), quiet output flags always (`pytest -q`, `tail -5`). Run 1's full cascades on frontend-only fixes caught nothing.
5. **Artifacts are terse**: ITERATION_LOG entries ≤2 lines; QA reports summarize with failure excerpts only; no full logs pasted anywhere.
