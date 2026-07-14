# Creation Pipeline — handed-off research to published PR

The standing operating procedure for mode **CREATE** (runner: **Claude Code**; `AUTO` is a deprecated alias): take one handed-off request from claim to a marketplace PR. Read [README.md](README.md) (rules, paths, queue spec) and [LESSONS.md](LESSONS.md) first — this doc assumes both.

Research and design happen **before** this pipeline, in [RESEARCH_PIPELINE.md](RESEARCH_PIPELINE.md) (stages R1–R8, run by CraftBot). This pipeline is normally launched headless by that pipeline's R8 stage; the manual Creation kickoff (README §5) enters it identically.

Stages: **C1** claim → **C2** handoff validation & spec review → ~~C3~~ (retired) → **C4** build → **C5** self-QA → **C6** human review gate → **C7** publish → **C8** retrospective.

---

## 0. Hard rules

1. **Stage order is fixed.** No stage starts before the previous one's exit condition is met and logged. In particular: no code before C2's bundle validation passes, no review request before all QA gates are green, no publish before `APPROVED`.
2. **Track progress with TodoWrite**: one item per stage at C1, expanded with one item per feature at C4. The todo list and ITERATION_LOG must agree.
3. **The guide's FORBIDDEN list applies verbatim** ([LIVING_UI_GUIDE.md](LIVING_UI_GUIDE.md) "FORBIDDEN actions") — never `metadata` as a column name, never relative backend imports, never raw HTML elements, never edit `main.py`/`main.tsx`/`themes.ts`, never edit `_template/`, etc.
4. **All README hard rules remain in force** — especially rule 3 (per-pipeline state ownership), rule 6 (human contact only at C6/BLOCKED) and rule 10 (placeholders).
5. **Iteration bounds are absolute**: QA loop ≤5 iterations + 2-strike (C5). Bound hit → BLOCKED, never "one more try".
6. **Research-owned statuses are off-limits.** `QUEUED`, `RESEARCHING`, and `SPEC_READY` belong to the research runner (CraftBot). Never claim, advance, or edit a queue file in those states. If the queue holds only research-owned or terminal states and nothing creation-owned is in flight, report "nothing handed off yet" and stop.

---

## 1. Stage C1 — Claim

1. Apply the README §7 pre-run self-check. The in-flight scan covers **creation-owned states only**: `HANDOFF` (with no live launcher session working it), `BUILDING`, `SELF_QA`, `IMPROVING`, `PUBLISHING` — resume beats claim (README §8).
2. Otherwise claim the **oldest `updated` file with `status: HANDOFF`**. None → report "nothing handed off yet" and stop (hard rule 6).
3. The run folder `runs/<run_id>/` already exists — the research runner created it (`run_id` is in the queue front matter). **Do not flip `status` yet** — C2 does that, so a stuck handoff (launch died before Claude started) stays distinguishable in the queue file from a claimed one.
4. Create the missing QA folder and append to the existing ITERATION_LOG:
   ```sh
   mkdir -p pipeline/living-ui/runs/<run_id>/qa
   ```
   ```
   <timestamp> | HANDOFF | CLAIMED (creation) by <session label>; resuming from research handoff | next: C2 validate bundle
   ```
5. Read [GLOBAL_LIVING_UI.md](../../agent_file_system/GLOBAL_LIVING_UI.md) now (the guide's "Before You Start") — its colors, font, and enabled/always-enforced rules bind everything downstream.

**Exit:** claim logged; status still `HANDOFF`.

---

## 2. Stage C2 — Handoff validation & spec review

The research was done by a much weaker model. Your job here: verify the bundle is mechanically complete, then review its content like a tech lead reviewing a junior's spec — repair what you can, escalate what you can't.

### 2a. Mechanical bundle check

Same manifest the research runner ran at R8 — all lines must PASS:

```powershell
$r='agent_file_system/workspace/pipeline/living-ui/runs/<run_id>'
foreach ($f in 'SPEC.md','DESIGN_SPEC.md','ITERATION_LOG.md','research/decomposition.md','research/features.md','research/competitors.md','research/ux-patterns.md','research/data-model.md','research/questionnaire.md') {
  if (Test-Path "$r/$f") { "PASS $f" } else { "FAIL $f" } }
$png=(Get-ChildItem "$r/reference-shots" -Filter *.png -ErrorAction SilentlyContinue).Count
$fb=Test-Path "$r/research/capture-fallback.md"
if ($png -ge 4 -or $fb) { "PASS shots ($png png, fallback=$fb)" } else { "FAIL shots" }
```

Any FAIL → `status: BLOCKED`, `blocked_reason: "creation: handoff bundle incomplete — <failing items> — rerun research"`, message to the human, stop. (There is no live research session to bounce to; the human re-kicks the research pipeline.)

### 2b. Spec review

Read the queue request body, SPEC.md, and DESIGN_SPEC.md, and check:

- **Coverage** — every sentence of `## Requirement` maps to a Must/Should/Won't; every `## Constraints` line is respected.
- **Testability** — acceptance criteria name a user action and an observable result; persistence criteria exist.
- **Data-model sufficiency** — SPEC §3 supports every Must (fields, relations, the category's core mechanic); enum values enumerated; no `metadata` field; nothing specced as client-side-only.
- **Assumption plausibility** — SPEC §6 rows are sane and their fallbacks concrete.
- **Internal consistency** — build notes don't contradict the entities; DESIGN_SPEC screens cover every Must; no visual-identity leakage (hex colors/fonts) in DESIGN_SPEC.

**Repairs are amendments, never silent fixes.** Append a section to SPEC.md:

```markdown
## 9. Creation-runner amendments
| # | Change | Why | Evidence |
|---|---|---|---|
```

One row per gap you repaired (added criteria, fixed data model, re-scoped a Must, corrected a platform contradiction). Where SPEC §1–8 and §9 conflict, **§9 wins**. Amend up to moderate gaps yourself — a strong model repairing weak-model output is the designed path, cheaper than a research rerun. Escalate (BLOCKED) only when the *request itself* is ambiguous enough that amending would be guessing the human's intent, or on a 2a failure.

**Exit:** manifest all-PASS quoted in ITERATION_LOG; review done; §9 present (empty table with a "no amendments needed" row is a valid outcome); set **`status: BUILDING`** — this is deliberately the creation runner's first status write, and it must happen within minutes of session start so a queue file sitting in `HANDOFF` reliably signals a dead launch.

---

## 3. Stage C3 — retired

Design-reference capture and DESIGN_SPEC.md moved to the research pipeline ([RESEARCH_PIPELINE.md](RESEARCH_PIPELINE.md) stages R6–R7). C2 validates their output. This heading remains so cross-references to "C3" in older logs and docs still resolve.

---

## 4. Stage C4 — Build

Status is already `BUILDING` (set at C2 exit). Scaffold the app:

```sh
cd <MARKETPLACE_ROOT>
cp -r _template/ <slug>/        # never edit _template itself
test -f <slug>/setup_local.py && echo scaffold-ok || echo "WRONG SCAFFOLD MECHANISM — rescaffold with cp -r _template/"
```

**Never call the `living_ui_scaffold` action (or any other built-in Living UI scaffold tool) here.** That tool is for direct, non-pipeline chat-driven builds — it copies a *different* template (`app/data/living_ui_template/`) into `agent_file_system/workspace/living_ui/<slug>_<hexid>/` with ports/IDs already live-substituted and no `setup_local.py` at all. Using it here silently breaks the marketplace layout every later stage assumes (placeholders for G8's audit, `setup_local.py` for QA_GATES §1, the `<MARKETPLACE_ROOT>/<slug>/` path for the eventual PR). The `test -f setup_local.py` check above exists specifically to catch this mistake immediately — if it prints `WRONG SCAFFOLD MECHANISM`, stop and redo the scaffold with the `cp -r` command, don't improvise around the missing file.

Then **follow [LIVING_UI_GUIDE.md](LIVING_UI_GUIDE.md) Phases 1–9 exactly**, with these amendments — the only deltas; everything else is the guide, unmodified:

| Guide says | In this pipeline |
|---|---|
| Phase 0 — 2-batch human interview | **Skipped — already done.** SPEC.md §5 (questionnaire answers) *is* the completed interview. Before Phase 1, copy SPEC content into the app's `LIVING_UI.md` Requirements section (entities, layout/design, features, assumptions). **SPEC §9 amendments outrank §1–8 wherever they conflict.** |
| "Ask the user" anywhere in Phases 1–9 | Consult SPEC.md (§9 first), then DESIGN_SPEC.md. If both silent: apply a QUESTIONNAIRE.md Safe Assumption, add it to SPEC §6's register, log it. Never actually ask (README rule 6). |
| Phase 1 — plan features | Feature list = SPEC §4 Musts in dependency order. Shoulds queue after — built only if **all** Musts are done and QA-stable. |
| Phases 2–7, Step A (tests first) | **Domain-logic tests only.** `test_runner.py` already auto-generates per-entity CRUD (`--unit`) and route smoke tests (`--external`) — don't duplicate them in pytest. Write pytest for what the runner can't infer: SPEC acceptance criteria, cross-entity semantics, ordering rules, dedupe, smoke-contract tolerances. (Run 1 wrote 35 tests where ~18 carried all the unique coverage.) |
| Phases 2–7, Step D (frontend) | Layout, navigation, and interactions come from DESIGN_SPEC (wireframes + component mapping). Visual identity from tokens/presets only. |
| Manifest / `setup_local.py` scaffold-time edits | Set `name`, `description`, `createdAt`, `theme` in `config/manifest.json`; update `setup_local.py`'s PROJECT_NAME/PROJECT_DESCRIPTION defaults. Port/ID placeholders stay untouched. |
| Phase 8 — verification gate | **Superseded by Stage C5.** [QA_GATES.md](QA_GATES.md) is a strict superset of Phase 8; don't run Phase 8 separately. |
| Phase 9 — documentation | Unchanged — fill every `LIVING_UI.md` section, remove all placeholders/HTML comments. |
| Phase 10 — marketplace publish | **Deferred to Stage C7.** Never publish before the human gate. |

Log one ITERATION_LOG line per completed feature (tests green counts as complete; UI wired counts, not before).

**Pre-QA commit (mandatory before C5):** create the app branch and commit the pristine build **before** any `setup_local.py` run:

```sh
cd <MARKETPLACE_ROOT>
git checkout -b app/<slug>
git add <slug>/
git commit -m "feat(<slug>): add <Name> Living UI (pre-QA)"
```

This is what makes `git checkout -- <slug>/` a *real* revert during QA and improvement rounds. Run 1 skipped it — the folder was untracked, the documented revert was a silent no-op, and the human received a placeholder-substituted, `node_modules`-laden folder that failed to import. (If the human asks to hold commits, note it in ITERATION_LOG and rely on G8's template-byte-restore fallback instead.)

**Exit:** all Must features built with green feature tests; `LIVING_UI.md` real — verified mechanically, not by your own claim: `grep -n "<!-- Agent:" LIVING_UI.md` must be empty, quote it in the log line; pre-QA commit made; log shows every feature.

---

## 5. Stage C5 — Self-QA

Set `status: SELF_QA`. Execute [QA_GATES.md](QA_GATES.md) end-to-end (setup → G1–G7 → fix–retest loop per the impact matrix → thumbnail → **G8 restore to base import-ready state**).

- **Exit:** final `qa/qa-report-<n>.md` shows all gates PASS **including G8** (the folder imports into CraftBot as a fresh app); `thumbnail.png` captured; QA self-check (QA_GATES §8) done.
- **Escape hatch:** loop bound or 2-strike hit → BLOCKED with the final QA report attached.

---

## 6. Stage C6 — Human review gate

Set `status: AWAITING_HUMAN_REVIEW`. Write `runs/<run_id>/REVIEW_REQUEST.md` from this template, post its content as the message to the human, and **end the turn** — the runner does nothing further until the human replies.

```markdown
# Ready for review — <App Name> (<slug>) — round <review_round>

## What was built
| # | Must feature | Status | Where to see it |
|---|---|---|---|
<one row per SPEC Must; Shoulds listed separately if built>

## How to test
The folder <MARKETPLACE_ROOT>/<slug>/ is in base import-ready state
(G8 audit: placeholders intact, no node_modules/dist/db/uploads, <size>).
**Import it into CraftBot** via the marketplace / Add Living UI import flow —
CraftBot fills the placeholders, installs dependencies, and launches it.
(setup_local.py exists for standalone dev only; running it makes the folder
non-import-ready until reverted.)

## Look at these first
<2–3 flows that best exercise the app, one line each>

## Known limitations & assumptions
<SPEC §6 assumptions register, verbatim, + SPEC §9 creation-runner amendments,
verbatim, + G7 MINOR/NIT findings with dispositions>
(empty → "None.")

## QA evidence
<final qa-report gate table>

---
Reply **APPROVED** to publish, or list issues (one per line) and I'll run an
improvement round. Round limit: 5.
```

**Reply routing:**

- Reply is `APPROVED` (case-insensitive), alone or with clearly non-blocking notes → confirm the notes are non-blocking (if any doubt, treat as issues) → Stage C7. Log the approval.
- Anything else → the reply is the issue list → [IMPROVEMENT_PIPELINE.md](IMPROVEMENT_PIPELINE.md) stage I1.
- No reply (session ends) → the queue file already says `AWAITING_HUMAN_REVIEW`; a future session in either mode picks it up cleanly.

---

## 7. Stage C7 — Publish

Set `status: PUBLISHING`. The heavy lifting already happened: the app has been import-ready since the last G8, and it lives committed on `app/<slug>` since C4. Steps in order, in `<MARKETPLACE_ROOT>`:

1. **Safety re-check (cheap G8 re-audit).** `git status --short` — every dirty path must be under `<slug>/` or `catalogue.json`; and the placeholder audit must still pass:
   ```sh
   grep -c "{{PROJECT_ID}}\|{{PORT}}\|{{BACKEND_PORT}}" <slug>/config/manifest.json   # >= 7
   ```
   Anything unexpected: stop, report to the human (never a blind `git add -A`).
2. **Thumbnail.** Copy `runs/<run_id>/thumbnail.png` → `<slug>/thumbnail.png`.
3. **Catalogue entry.** Add to `catalogue.json` `apps` array:
   ```json
   {
     "id": "<slug>", "name": "<App Name>",
     "description": "<one-line description>",
     "folder": "<slug>", "tags": [<queue-file tags>], "version": "1.0.0"
   }
   ```
4. **Commit and push** (branch `app/<slug>` already exists from C4; create it now if commits were held at the human's request):
   ```sh
   git add <slug>/ catalogue.json
   git commit -m "feat(<slug>): add <App Name> Living UI"
   git push -u origin app/<slug>
   ```
5. **Open the PR** against the repo's default branch:
   ```sh
   gh pr create --title "feat(<slug>): add <App Name> Living UI" --body "<template below>"
   ```
   PR body template (empty sections say "None."):
   ```markdown
   ## Summary
   <2–3 sentences: what the app is, who it's for. Built by the autonomous
   Living UI pipeline; spec was research-generated and human-reviewed.>

   ## Features
   <SPEC Musts as a checklist, all checked; Shoulds if built>

   ## QA evidence
   <final qa-report gate table; review_round count; "human-approved on <date>">

   ## How to test locally
   <same commands as the review request>

   ## Known limitations
   <carried MINOR/NIT findings + accepted assumptions>

   ## Screenshot
   <thumbnail.png renders in the diff — reference it>
   ```
6. **Close out the queue file:** `status: DONE`, `pr_url: <url>`, `updated: <today>`; final ITERATION_LOG line with the PR URL.

**Escape hatches:** `gh` unauthenticated or push rejected → BLOCKED with the exact error (the branch/commit work is preserved locally; nothing is lost). Never retry with `--force`.

---

## 8. Stage C8 — Retrospective

Mandatory, even (especially) after a rough run. Append one entry to [LESSONS.md](LESSONS.md) in its required format, answering all four:

1. **What did human review catch that self-QA missed?** Each miss becomes a `[qa-gap]` bullet — these are the pipeline's most valuable output besides the app itself.
2. **What research/design step paid off, and what wasted time?** (e.g. "lane 4 enum research prevented 3 smoke-test failures" / "second reference product added nothing".)
3. **What ambiguity forced a judgment call?** Anything the docs didn't decide for you becomes a `PROPOSAL:` line.
4. **Grade the research handoff.** What did SPEC.md/DESIGN_SPEC.md get wrong or omit that you only discovered while building — i.e. what did SPEC §9 have to amend, and what slipped past even C2? Each becomes a `[handoff]` bullet.

**Propagation duty:** for every `[research]`, `[design]`, or `[handoff]` lesson, also add (or strengthen) a numbered order in [RESEARCH_PIPELINE.md](RESEARCH_PIPELINE.md) **§2 Standing corrections** — that section is the only lessons channel the research runner reads, so a lesson that stays here never reaches it. This is the one sanctioned edit to RESEARCH_PIPELINE.md; log it in the LESSONS entry.

If the answer to all four is genuinely "nothing" — a clean, boring run — write the one-line entry `No new lessons (clean run).` rather than inventing filler.

---

## 9. End-of-run self-check

Before reporting done:

- [ ] Queue file: `status: DONE`, `pr_url`, `updated`, `review_round` all correct.
- [ ] Placeholders intact **in the commit**: `git show HEAD:<slug>/config/manifest.json | grep "{{PORT}}"` succeeds.
- [ ] No artifacts in the commit: `git show --stat HEAD` lists no node_modules/dist/db/logs/__pycache__ paths.
- [ ] PR open, base = default branch, body complete.
- [ ] LESSONS.md entry appended.
- [ ] ITERATION_LOG closed with the PR URL.
- [ ] No servers left running; marketplace working tree clean on `app/<slug>`.

Report to the human: *"<App Name> published — PR: <url>. Review round count: <n>. Lessons recorded: <count or 'clean run'>."*

---

## 10. When things go wrong

| Stage | Failure | Action |
|---|---|---|
| C1 | Queue file malformed (missing `run_id`, bad slug) or run folder missing | BLOCKED — the research handoff is broken; ask the human to re-kick the research pipeline |
| C2 | Bundle mechanically incomplete (manifest FAIL) | BLOCKED with `blocked_reason: "creation: handoff bundle incomplete — rerun research"` |
| C2 | SPEC gaps too fundamental to amend (request intent unclear) | BLOCKED with the specific ambiguity + 2–3 interpretation options for the human |
| C4 | A Must feature turns out to need an un-requested external service | Don't build it silently and don't drop it silently — BLOCKED with options (drop to Won't / human authorizes the integration) |
| C5 | QA bound hit | BLOCKED with final qa-report (automatic per QA_GATES) |
| C6 | Human reply ambiguous (mixes praise, issues, and "maybe"s) | Treat as issues → improvement round; I2 handles clarification |
| C7 | Push/PR failures | BLOCKED with exact error; work is preserved on the local branch |
| any | Anything not on this table | README §8 BLOCKED protocol — when in doubt, escalate with options rather than improvise past a rule |
