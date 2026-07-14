# RESEARCH PIPELINE — run by CraftBot (stages R1–R8)

This document is **complete and self-contained**. Do not read README.md, LIVING_UI_GUIDE.md, QA_GATES.md, or CREATION_PIPELINE.md — everything you need is in this file. Follow the stages **in order, one at a time**. Do not skip a stage. Do not start a stage before the previous stage's EXIT GATE passed.

**Paths.** Two forms, used for different tools:

- File actions (`read_file`, `write_file`, `list_folder`, `grep_files`): use workspace paths, e.g. `/workspace/pipeline/living-ui/queue/`.
- `run_shell`: always pass `"cwd": "d:\\tempCraftBot\\CraftBot"` and use repo-relative paths, e.g. `agent_file_system\workspace\pipeline\living-ui\queue\`.

They are the same folder: `/workspace/` = `agent_file_system\workspace\` inside the repo.

---

## 0. Why you are doing this

You are **stage 1 of 2** in building a **Living UI** — a small full-stack web app (FastAPI backend + React frontend) that gets published to the CraftBot marketplace. You do the research and write the specs. A second agent (**the creation runner**, a Claude Code session) does the coding. Your final stage launches it automatically.

Your output — `SPEC.md`, `DESIGN_SPEC.md`, the `research/` files, and the `reference-shots/` screenshots — is **everything the builder gets** besides the human's original 1–10 sentence request. Anything you leave vague, the builder has to guess. Anything you get wrong, the builder builds wrong. The human is asleep during all of this: nobody will answer questions, so your specs must be complete.

**Gold standard.** Before writing SPEC.md (stage R5) and DESIGN_SPEC.md (stage R7) you will read these two files in full and match their depth:

- `/workspace/pipeline/living-ui/runs/tierlist-20260709/SPEC.md`
- `/workspace/pipeline/living-ui/runs/tierlist-20260709/DESIGN_SPEC.md`

A previous run in the same product category produced specs half that depth. That run's app was rejected. Shallow specs fail this pipeline.

---

## 1. Hard rules

Read all of these now. Each one exists because a past run broke it and the run failed.

1. **The queue file's `status` field is the only state store.** Every status change edits the queue file AND appends one line to `runs/<run_id>/ITERATION_LOG.md`, immediately, in that order.
2. **You own exactly four statuses: `QUEUED` (claim it), `RESEARCHING`, `SPEC_READY`, `HANDOFF`.** Never write any other status except `BLOCKED`. Statuses `BUILDING`, `SELF_QA`, `AWAITING_HUMAN_REVIEW`, `IMPROVING`, `PUBLISHING`, `DONE` belong to the creation runner — if a queue file is in one of those states, do not touch that file.
3. **Every gate is mechanical.** A gate passes when the command's printed output meets the stated pass condition — nothing else counts. You must paste the command output into ITERATION_LOG. **You may not explain a red result into a green one.** The words "expected", "artifact", "noise", "effectively", "should be fine" are banned in gate log lines. A past run logged a failing check as "expected test runner fuzzing artifacts" while the output said `"status": "fail"` — that run failed human review. If the output does not literally show the pass condition, the gate is red: fix the artifact and re-run the gate.
4. **Every SPEC claim must trace to a source**: the request body, a human-pinned reference, a file in `runs/<run_id>/research/`, or a named Safe Assumption (§5.6). Claims with no source get cut.
5. **The request text beats research.** If the human asked for something unusual, research informs *how*, never *whether*.
6. **Scope caps: at most 6 entities, at most 8 Must features.** Overflow goes under `Won't (v1)` with a one-line note.
7. **References inform structure, never identity.** Screenshots and competitor products dictate where things go and how they behave — never colors, fonts, logos, product names, or copy text. Visual identity is always CraftBot's design tokens. (Exception: colors that are the app's *user data* — e.g. tier-row colors in a tier-list app — belong in SPEC §3 as data.)
8. **No feature may require credentials or external services** unless the request's `## Constraints` section explicitly says so.
9. **Write files only inside `runs/<run_id>/`, plus status edits to your one claimed queue file.** Nothing anywhere else.

**FORBIDDEN — never do these:**

| Forbidden | Why (the failure it caused) |
|---|---|
| Calling the `living_ui_scaffold` action, or any app-scaffolding/build action | You are not building. A past run scaffolded mid-pipeline and broke every downstream assumption. Building is the creation runner's job. |
| Skipping screenshot capture without writing `research/capture-fallback.md` (stage R6) | Run tiermaker-20260713 wrote "(no visual shots captured, text derived)" without attempting the fallback ladder. Its DESIGN_SPEC was shallow and the run was rejected. |
| Summarizing, shortening, or paraphrasing a subagent's research brief before writing it to `research/` | Thin research files starve the SPEC. Write the returned brief **verbatim**. |
| Marking a gate passed without pasting the command output | See hard rule 3. |
| Editing files under `_template/`, any app folder, `LIVING_UI_GUIDE.md`, or any pipeline doc | Ground truth is read-only. |
| Polling, waiting on, or editing the queue file after stage R8's launch verification | After handoff the creation runner owns the file. Two writers on one file corrupts state. |
| Asking the human a question | The human is asleep. Use a Safe Assumption (§5.6) and record it, or go BLOCKED (§6) if truly stuck. |

**Progress tracking:** at R1, create one todo item per stage R1–R8 with `task_update_todos`. Mark each stage done only after its EXIT GATE output is pasted into ITERATION_LOG.

---

## 2. Standing corrections

Lessons from past runs, restated as orders. (The creation runner appends here after each run's retrospective — never delete entries.)

1. Acceptance criteria must name a user action AND an observable result. "No blank canvas state" is not a criterion; "A new list opens with exactly 5 tiers labeled S, A, B, C, D, all empty" is.
2. At least 3 acceptance criteria in the SPEC must verify persistence by saying what survives a page **reload**.
3. Living UI apps have a FastAPI backend with a database. Never spec "fully client-side", "localStorage persistence", or "no backend" — a past SPEC did, contradicting the platform, and the builder had to rewrite it.
4. Every assumption needs a concrete `Fallback:` — what the builder changes if the assumption is wrong. "User confusion" is a risk, not a fallback.
5. Enum-like fields (statuses, stages, categories with fixed values) must list every value explicitly in SPEC §3 — they become `Literal[...]` types. Never spec a field named `metadata`.
6. The unranked/uncategorized "pool" pattern (items not yet placed) is modeled as a **nullable foreign key**, not a separate entity — check `research/data-model.md` for your category's equivalent core mechanic and make sure SPEC §3 models it.

---

## 3. The queue

The queue is the folder `/workspace/pipeline/living-ui/queue/` — one markdown file per request, named `<YYYYMMDD>-<slug>.md`. Front matter fields:

| Field | Who writes it | Notes |
|---|---|---|
| `app_name`, `slug`, `tags`, `priority`, `requested` | human | read-only for you |
| `status` | human writes `QUEUED`; then **you**, per hard rule 2 | `1` = high priority, claim first |
| `claimed_by` | you, at claim | write `craftbot-research` |
| `run_id` | you, at claim | `<slug>-<YYYYMMDD>` using today's date |
| `updated` | you, at every status change | `YYYY-MM-DD` |
| `review_round`, `pr_url` | creation runner | never touch |
| `blocked_reason` | you, only when entering `BLOCKED` | prefix with `research: ` |

Body sections you read: `## Requirement` (what to build), `## References` (**pinned** — these outrank everything your research finds), `## Constraints` (read literally; only listed integrations are allowed).

**Claim rule:** among `status: QUEUED` files pick lowest `priority` number, then oldest `requested`, then oldest filename. But first: if any queue file has `status: RESEARCHING` or `SPEC_READY`, resume that run instead (read its `ITERATION_LOG.md` bottom-up, verify the last logged claim against the actual files, continue from the first stage whose EXIT GATE output is not in the log).

---

## 4. Stages

Every stage below has the same shape: STEPS (numbered — do them in order) and an EXIT GATE (run the command, paste the output into ITERATION_LOG, check it against the pass condition).

ITERATION_LOG line format (one line per event, appended with `write_file` append or `stream_edit`):

```
<YYYY-MM-DD HH:MM> | <STATUS> | <what was done / gate output summary> | next: <what comes next>
```

When a gate output is multi-line, paste it in a fenced block directly under the log line.

---

### R1 — Claim & preflight

**Entry:** you were kicked off in Mode RESEARCH and no research-owned run is in flight.

1. List the queue folder: `list_folder` on `/workspace/pipeline/living-ui/queue/`.
2. Read every queue file's front matter. Apply the claim rule (§3). If nothing is claimable, report "queue empty" to the chat and stop.
3. Verify the creation runner is launchable NOW (so a broken handoff fails at minute 1, not hour 6). Run:
   ```json
   run_shell: { "command": "where claude", "shell": "cmd", "cwd": "d:\\tempCraftBot\\CraftBot" }
   ```
   **If the output is empty or an error**: set the queue file to `status: BLOCKED`, `blocked_reason: "research: claude CLI not on PATH — install standalone Claude Code CLI"`, tell the human, stop.
4. Edit the claimed queue file front matter: `status: RESEARCHING`, `claimed_by: craftbot-research`, `run_id: <slug>-<YYYYMMDD>`, `updated: <today>`.
5. Create the run folder skeleton:
   ```json
   run_shell: { "command": "mkdir agent_file_system\\workspace\\pipeline\\living-ui\\runs\\<run_id>\\research agent_file_system\\workspace\\pipeline\\living-ui\\runs\\<run_id>\\reference-shots", "shell": "cmd", "cwd": "d:\\tempCraftBot\\CraftBot" }
   ```
6. Write `/workspace/pipeline/living-ui/runs/<run_id>/ITERATION_LOG.md`:
   ```markdown
   # ITERATION LOG — <run_id>
   Request: queue/<file>   Claimed: <timestamp> by craftbot-research
   Pipeline: RESEARCH (R1–R8)
   ---
   <timestamp> | RESEARCHING | claimed request, run folder created, claude CLI found at <path from step 3> | next: R2 decompose
   ```
7. Create the R1–R8 todo list with `task_update_todos`.

**EXIT GATE** (paste all three outputs):
```json
run_shell: { "command": "where claude & dir /b agent_file_system\\workspace\\pipeline\\living-ui\\runs\\<run_id> & findstr /c:\"status: RESEARCHING\" agent_file_system\\workspace\\pipeline\\living-ui\\queue\\<file>.md", "shell": "cmd", "cwd": "d:\\tempCraftBot\\CraftBot" }
```
**Pass:** a claude path is printed, `research` and `reference-shots` are listed, and the `status: RESEARCHING` line is printed. Anything missing → fix it, re-run the gate.

---

### R2 — Decompose the request

1. Read the claimed queue file in full.
2. Fill this template — replace every `<...>`; copy everything else exactly — and write it to `/workspace/pipeline/living-ui/runs/<run_id>/research/decomposition.md`:

   ```markdown
   # Decomposition — <run_id>

   ## Category
   <one line: "this is a <tier list maker / habit tracker / invoicing tool / ...> app">

   ## Constraints
   <every line from the queue file's ## Constraints section, verbatim; or "none stated">

   ## Pinned references
   <every product/URL from ## References, one per line; or "none pinned">

   ## Vague phrases
   <every underspecified phrase from ## Requirement, quoted, one per line — e.g. "basic user stuff", "make it look good"; or "none">
   ```

**EXIT GATE** (paste output):
```json
run_shell: { "command": "findstr /c:\"## Category\" /c:\"## Constraints\" /c:\"## Pinned references\" /c:\"## Vague phrases\" agent_file_system\\workspace\\pipeline\\living-ui\\runs\\<run_id>\\research\\decomposition.md", "shell": "cmd", "cwd": "d:\\tempCraftBot\\CraftBot" }
```
**Pass:** exactly 4 heading lines printed.

---

### R3 — Four research lanes (parallel subagents)

1. Build four queries from the template in §5.1 — one per lane: `features`, `competitors`, `ux-patterns`, `data-model`. Each query must be fully self-contained (the subagent sees nothing of your context): include the category, the verbatim requirement text, the constraints, and the lane task block.
2. Emit **all four `spawn_subagent` calls in one decision batch** (they run in parallel), `agent_type: "research_agent"`.
3. When each returns, take its `result` and write it **verbatim, unshortened** to `/workspace/pipeline/living-ui/runs/<run_id>/research/<lane>.md` with `write_file`. Do not summarize. Do not merge lanes into one file.
4. If a subagent fails or returns fewer than 30 lines: re-spawn **that lane once**, appending to its query: "Your previous brief was too thin. The brief must be at least 40 lines of substantive markdown following the required output format." One retry per lane, maximum.

**EXIT GATE** (paste output):
```json
run_shell: { "command": "for %f in (features competitors ux-patterns data-model) do @find /c /v \"\" agent_file_system\\workspace\\pipeline\\living-ui\\runs\\<run_id>\\research\\%f.md", "shell": "cmd", "cwd": "d:\\tempCraftBot\\CraftBot" }
```
**Pass:** four lines printed, each showing a count of **30 or more**. Any file below 30 after its one retry → BLOCKED (§6) with the counts pasted.

---

### R4 — Merge findings & questionnaire self-interview

1. Read all four `research/*.md` files.
2. Build one candidate feature/entity set. Resolve every conflict by this precedence, highest first:
   ```
   request body > pinned references > research consensus (2+ lanes agree) > single-lane finding > Safe Assumption
   ```
3. Apply the scope caps (hard rule 6). Rank Must candidates by: core to the category (features lane) → needed by another Must → effort. Cut from the bottom into `Should`, then `Won't (v1)`.
4. If the lanes genuinely disagree on something build-critical (e.g. the core entity model), you may spawn **one** follow-up subagent with a narrow question. One for the whole run. Log it.
5. Answer the questionnaire (§5.5) — all 6 categories, in writing, to `/workspace/pipeline/living-ui/runs/<run_id>/research/questionnaire.md` using the §5.5 template. Rules:
   - Every answer is a concrete choice ("kanban columns with a modal detail view"). The strings `TBD`, `either works`, and `maybe` are banned.
   - Every vague phrase from decomposition.md gets an explicit expansion (§5.6 has the standard expansions).
   - Every gap research didn't cover gets a Safe Assumption from §5.6, recorded with `source: safe-assumption`.

**EXIT GATE** (paste both outputs):
```json
run_shell: { "command": "findstr /c:\"## Category\" agent_file_system\\workspace\\pipeline\\living-ui\\runs\\<run_id>\\research\\questionnaire.md & findstr /i /c:\"TBD\" /c:\"either works\" /c:\"maybe\" agent_file_system\\workspace\\pipeline\\living-ui\\runs\\<run_id>\\research\\questionnaire.md & echo GATE-DONE", "shell": "cmd", "cwd": "d:\\tempCraftBot\\CraftBot" }
```
**Pass:** exactly 6 `## Category` lines printed, then NO lines between them and `GATE-DONE` (i.e. zero banned-word hits).

---

### R5 — Write SPEC.md

1. **Read `/workspace/pipeline/living-ui/runs/tierlist-20260709/SPEC.md` in full, now.** Your SPEC must match its depth. Compare these before writing a single criterion:

   **REJECTED** (from a failed run): `- [ ] No blank canvas state` · `- [ ] Zero latency drag interaction`
   **GOLD** (from the accepted run): `- [ ] A new list opens with exactly 5 tiers labeled S, A, B, C, D in canonical colors, all empty, plus an empty pool.` · `- [ ] × on a ranked item returns it to the end of the pool; the item is not deleted.` · `- [ ] A .txt or 15 MB file is rejected with a user-visible error toast; valid files in the same batch still land.`

   The difference: the gold criteria name a **user action and an observable result**, cover **edge cases** (wrong file type, oversized file, partial batch), and check **persistence across reload**. Write yours like the gold ones.

   One place NOT to copy the gold file: its assumptions table has a "Risk if wrong" column. **Your** table uses the newer template (§5.2) — the last column is `Fallback` and every cell in it starts with the literal text `Fallback:` (the gate counts that string).

2. Fill the SPEC template (§5.2) and write it to `/workspace/pipeline/living-ui/runs/<run_id>/SPEC.md`. Section-by-section requirements:
   - **§3 Entities:** every field with a type; every enum's values listed; relationships explicit; the category's core mechanic modeled (Standing correction 6). At most 6 entities. Persistence is a FastAPI backend + database — never localStorage (Standing correction 3).
   - **§4 Musts:** 4–8 features, each with 3–4 acceptance criteria written like the GOLD examples. At least 3 criteria across the SPEC must include the word "reload" or "persist".
   - **§6 Assumptions:** at least 6 rows. Every row's last cell starts with `Fallback:` followed by the concrete change the builder makes if the assumption is wrong.
   - Every claim traceable (hard rule 4); the source column/parenthetical says which.

3. Set queue file `status: SPEC_READY`, `updated: <today>`; append the ITERATION_LOG line.

**EXIT GATE** (paste output):
```json
run_shell: { "command": "$f='agent_file_system/workspace/pipeline/living-ui/runs/<run_id>/SPEC.md'; $t=Get-Content $f; \"LINES=$($t.Count)\"; \"SECTIONS=$(($t | Select-String -Pattern '^## [1-8]\\.').Count)\"; \"CRITERIA=$(($t | Select-String -SimpleMatch '- [ ]').Count)\"; \"RELOAD=$(($t | Select-String -Pattern 'reload|persist').Count)\"; \"FALLBACKS=$(($t | Select-String -SimpleMatch 'Fallback:').Count)\"; \"BANNED=$(($t | Select-String -Pattern 'TBD|either works|localStorage').Count)\"", "shell": "powershell", "cwd": "d:\\tempCraftBot\\CraftBot" }
```
**Pass, all six:** `LINES` ≥ 110 · `SECTIONS` = 8 · `CRITERIA` ≥ 18 · `RELOAD` ≥ 3 · `FALLBACKS` ≥ 6 · `BANNED` = 0.
Fail → revise the SPEC (not the numbers' meaning) and re-run. **Maximum 2 revision loops**, then BLOCKED with the gate output pasted.

---

### R6 — Reference capture (Playwright screenshots)

1. Pick 1–2 reference products, in this priority order: (a) human-pinned reference from decomposition.md — always chosen if present; (b) the category leader with a publicly viewable UI (competitors lane nominates candidates); (c) the most-imitated UX in the category. Two maximum; the second only if it shows a screen type the first lacks.
2. Capture with the Playwright browser tools, per reference, **at most 6 shots**:
   1. `browser_navigate` to the product's main editor / dashboard / demo page.
   2. `browser_resize` to width 1280, height 800.
   3. `browser_take_screenshot` with filename `<product>-<screen>-1280.png`. **Never full-page.**
   4. `browser_resize` to width 390, height 844; `browser_take_screenshot` with filename `<product>-<screen>-390.png`.
   5. Repeat for a detail view and a create/edit flow. Skip pricing/login/blog pages.
3. Each screenshot tool result shows where the PNG was saved. Copy every capture into the run folder with `run_shell` (`copy "<saved path>" "agent_file_system\workspace\pipeline\living-ui\runs\<run_id>\reference-shots\"`, shell cmd, cwd as always).
4. **If a reference blocks capture** (login wall, bot blocker like Cloudflare): work down this ladder, and for EVERY rung you attempt, record in `/workspace/pipeline/living-ui/runs/<run_id>/research/capture-fallback.md` the rung number, the URL tried, and what happened:
   - `Rung 1:` the product's marketing homepage (most SaaS homepages show the product UI).
   - `Rung 2:` official docs / help-center articles (walkthroughs contain UI screenshots).
   - `Rung 3:` an alternative product from the competitors lane with a public UI (capture that instead — note the substitution).
   - `Rung 4:` a web image search for `<product> app screenshot` — capture the results page as a low-fidelity mosaic.
   Only if all four rungs are attempted and logged may this stage end with zero shots — then DESIGN_SPEC is written from `research/ux-patterns.md` text alone. **Skipping capture without the written ladder is forbidden** (this is the exact violation that got run tiermaker-20260713 rejected).

**EXIT GATE** (paste output):
```json
run_shell: { "command": "dir /b agent_file_system\\workspace\\pipeline\\living-ui\\runs\\<run_id>\\reference-shots & findstr /c:\"Rung 1\" /c:\"Rung 2\" /c:\"Rung 3\" /c:\"Rung 4\" agent_file_system\\workspace\\pipeline\\living-ui\\runs\\<run_id>\\research\\capture-fallback.md & echo GATE-DONE", "shell": "cmd", "cwd": "d:\\tempCraftBot\\CraftBot" }
```
**Pass:** at least 4 `.png` files listed, **OR** all 4 `Rung` lines printed from capture-fallback.md. (The `findstr` erroring with "cannot open" is fine when shots exist.)

---

### R7 — Write DESIGN_SPEC.md

1. **Read `/workspace/pipeline/living-ui/runs/tierlist-20260709/DESIGN_SPEC.md` in full, now.** Match its depth: it reads real measurements and behaviors off the screenshots ("label cells are ~70px colored squares … each row's right edge holds a gear icon and stacked ▲▼ chevrons") and states responsive behavior breakpoint by breakpoint. One place NOT to copy it: it doesn't tag SPEC Must IDs — **your** doc must write `M1`, `M2`, … next to the screens and interactions that host them (template §5.3; the gate counts them).
2. **Identity rule (this is where past runs violated it):** colors, fonts, spacing, radii, shadows come from CraftBot's design tokens ONLY — never from the screenshots. Screenshots dictate *where things go and how they behave*. Zero hex colors, zero font names in DESIGN_SPEC.md. Colors that are user DATA belong in SPEC §3, not here.
3. Fill the template (§5.3) and write it to `/workspace/pipeline/living-ui/runs/<run_id>/DESIGN_SPEC.md`:
   - **§3 Layout per screen:** one ASCII wireframe per screen (box-drawing with `+--` borders) plus information hierarchy (what the eye hits first/second/third) plus responsive behavior at 768px and 360px.
   - **§2/§3 must cover every SPEC Must:** each M-number appears next to the screen that hosts it.
   - **§6 Component mapping:** every observed UI pattern → a CraftBot preset component name, or "compose from Card/primitives", or "dropped — <why>".
4. Append the ITERATION_LOG line (status stays `SPEC_READY`).

**EXIT GATE** (paste output):
```json
run_shell: { "command": "$d=Get-Content 'agent_file_system/workspace/pipeline/living-ui/runs/<run_id>/DESIGN_SPEC.md'; $s=Get-Content 'agent_file_system/workspace/pipeline/living-ui/runs/<run_id>/SPEC.md'; \"LINES=$($d.Count)\"; \"SECTIONS=$(($d | Select-String -Pattern '^## [1-7]\\.').Count)\"; \"WIREFRAME=$(($d | Select-String -SimpleMatch '+--').Count)\"; \"HEX=$(($d | Select-String -Pattern '#[0-9a-fA-F]{6}').Count)\"; \"MUSTS=$(($s | Select-String -Pattern '^#### M[0-9]').Count)\"; \"COVERED=$((($d | Select-String -Pattern 'M[0-9]' -AllMatches).Matches.Value | Sort-Object -Unique).Count)\"", "shell": "powershell", "cwd": "d:\\tempCraftBot\\CraftBot" }
```
**Pass, all five:** `LINES` ≥ 90 · `SECTIONS` = 7 · `WIREFRAME` ≥ 6 · `HEX` = 0 · `COVERED` ≥ `MUSTS`.
Fail → fix DESIGN_SPEC.md and re-run. Maximum 2 revision loops, then BLOCKED.

---

### R8 — Handoff & launch the creation runner

1. Run the handoff manifest check (paste the full output):
   ```json
   run_shell: { "command": "$r='agent_file_system/workspace/pipeline/living-ui/runs/<run_id>'; foreach ($f in 'SPEC.md','DESIGN_SPEC.md','ITERATION_LOG.md','research/decomposition.md','research/features.md','research/competitors.md','research/ux-patterns.md','research/data-model.md','research/questionnaire.md') { if (Test-Path \"$r/$f\") { \"PASS $f\" } else { \"FAIL $f\" } }; $png=(Get-ChildItem \"$r/reference-shots\" -Filter *.png -ErrorAction SilentlyContinue).Count; $fb=Test-Path \"$r/research/capture-fallback.md\"; if ($png -ge 4 -or $fb) { \"PASS shots ($png png, fallback=$fb)\" } else { \"FAIL shots ($png png, no fallback file)\" }", "shell": "powershell", "cwd": "d:\\tempCraftBot\\CraftBot" }
   ```
   **Every line must say PASS.** Any FAIL → go back to the stage that owns that artifact, fix it, re-run this manifest.
2. Edit the queue file: `status: HANDOFF`, `updated: <today>`. Append the ITERATION_LOG line: `... | HANDOFF | manifest all-PASS, launching creation runner | next: creation pipeline C1`.
3. Launch the creation runner. Use this payload **exactly** — replace only `<run_id>`:
   ```json
   run_shell: {
     "command": "claude -p \"You are the Living UI CREATION pipeline runner. Read agent_file_system/workspace/pipeline/living-ui/README.md and CREATION_PIPELINE.md in the CraftBot repo and follow them exactly. Mode: CREATE — resume any in-flight creation run first; otherwise claim the oldest queue file with status HANDOFF, validate the handoff bundle, and take it to AWAITING_HUMAN_REVIEW. If nothing is in flight or HANDOFF, report that and stop.\" --dangerously-skip-permissions > agent_file_system\\workspace\\pipeline\\living-ui\\runs\\<run_id>\\creation.log 2>&1",
     "shell": "cmd",
     "cwd": "d:\\tempCraftBot\\CraftBot",
     "background": true
   }
   ```
   The response must show `"status": "background"` and a `pid`. Note the pid.
4. Use the `wait` action to wait **120 seconds**.
5. Verify the launch (paste both outputs):
   ```json
   run_shell: { "command": "tasklist /FI \"PID eq <pid>\" & powershell -Command \"Get-Content 'agent_file_system/workspace/pipeline/living-ui/runs/<run_id>/creation.log' -TotalCount 10\"", "shell": "cmd", "cwd": "d:\\tempCraftBot\\CraftBot" }
   ```
   **Healthy** = the process is listed, OR creation.log already shows Claude output (a session that finished fast is also healthy if the log is non-empty and error-free).
   **Failure signatures:** `'claude' is not recognized` (CLI missing), an empty log with no listed process (crash), `Invalid API key`/auth errors in the log. On failure: set `status: BLOCKED`, `blocked_reason: "research: HANDOFF launch failed — <first error line>"`, append the log line with the evidence, and include the manual fallback in your final message.
6. Post your final chat message, from this template, then **end the task** (hard-forbidden to keep polling or touch the queue file again):
   ```
   Living UI research complete for <app_name> (<run_id>).
   SPEC.md and DESIGN_SPEC.md passed all gates; handoff manifest all-PASS.
   Creation runner launched (PID <pid>), log: pipeline/living-ui/runs/<run_id>/creation.log.
   The build, QA, and review request now happen autonomously.
   If the queue file still says "status: HANDOFF" tomorrow morning, the launch died —
   paste the Creation kickoff prompt from pipeline/living-ui/README.md §5 into a
   Claude Code session to resume.
   ```

---

## 5. Templates

### 5.1 Research subagent query (all four lanes)

Common part — fill the angle brackets, keep everything else:

```
You are a research subagent. Research the topic below using web search.
Ground every claim in a named source (publication / vendor / URL). Be concrete
and selective — a prioritized shortlist with justifications beats an exhaustive dump.

Return your FULL research brief as well-structured markdown (headings, tables,
bullet lists). It must be at least 40 lines of substantive content — it becomes
a permanent research file that a builder relies on. End with a section
"## Build-critical findings" listing the specific facts the app's spec/design/build
must act on.

Product category: <category>
The app being built (verbatim requirement): "<requirement text>"
Constraints: <constraints, or "none stated">

Task:
<lane task block below>
```

**Lane `features`:**
```
What makes a great <category> app in <year>?
1. Table-stakes features — what every credible product has (2+ sources each).
2. Differentiator features — what the best products add on top.
3. A single prioritized feature list (max ~15) with a one-line justification and source per feature.
4. Anti-features: things products in this category regret or users complain about.
```

**Lane `competitors`:**
```
Survey the top 3–5 <category> products.
Per product: name, positioning, 3–5 standout features, which features are
free-tier vs paid (free tier = what the market considers core).
Then nominate 2–3 DESIGN REFERENCE candidates — products whose UI is publicly
viewable WITHOUT login — with direct URLs to a live demo, marketing screenshots,
or screenshot-rich docs pages. Note any that block automated browsers.
```

**Lane `ux-patterns`:**
```
Document the canonical UX of <category> apps.
1. Dominant layout(s): list / board / split-pane / calendar / dashboard — and when each is used.
2. Navigation model: sidebar, top tabs, breadcrumbs; typical screen inventory.
3. Information hierarchy on the main screen: what users see first/second/third.
4. Signature interactions: inline edit, drag-and-drop, bulk actions, keyboard use — including
   the touch/mobile equivalents.
5. Empty-state and onboarding conventions.
Describe patterns in words precise enough to draw a wireframe from.
```

**Lane `data-model`:**
```
Document the standard domain model of <category> apps.
1. Core entities and their typical fields (with types).
2. Relationships between entities — including how "unassigned / not yet placed"
   items are modeled, if the category has that concept.
3. Lifecycle/status enums and their exact typical values.
4. Computed/derived values products commonly show.
5. Common validations and domain rules (limits, required fields, min/max counts).
```

### 5.2 SPEC.md template

Copy verbatim; replace `<...>`; keep all headings including their numbers.

```markdown
# SPEC — <App Name> (<slug>)

- Run: <run_id>   Date: <YYYY-MM-DD>
- Source request: queue/<file>   Category: <category>

## 1. Summary
<Elevator pitch. Target user. The 2–3 jobs-to-be-done. What research says the
bar is for this category and where this app wins.>

## 2. Scope
**In (v1):** <one line per Must/Should feature>
**Out (explicit non-goals):** <from Constraints + platform non-goals>
**Won't (v1):** <research-suggested features cut by scope caps, one-line note each>

## 3. Entities & data model
| Entity | Fields (name: type) | Relations | Notes |
|---|---|---|---|
<max 6 entities; enum fields list every value; never a field named metadata;
persistence = FastAPI backend + database. State how ordering, file uploads,
and the category's core mechanic are modeled.>

## 4. Features (MoSCoW)
### Must
#### M1 — <feature name>
<one-paragraph description>
Acceptance criteria:
- [ ] <user action + observable result>
- [ ] <edge case>
- [ ] <persistence: what survives a reload>
<repeat per Must, max 8, 3–4 criteria each>
### Should
<name + one line each — built only if all Musts are done>
### Won't (v1)
<mirror of §2>

## 5. Questionnaire answers
<paste the 6 category answers from research/questionnaire.md>

## 6. Assumptions register
| # | Assumption | Source (request / reference / research:<file> / safe-assumption) | Fallback |
|---|---|---|---|
<at least 6 rows; every Fallback cell starts with "Fallback:" and names the
concrete change if the assumption is wrong>

## 7. Design direction (handoff to R6/R7)
<2–3 reference candidates from research/competitors.md + why; pinned human
references listed first; note which block automated capture>

## 8. Build notes
<Auth needed? Integrations (only if Constraints allow)? Libraries the template
already ships that should be reused? Anything that changes the builder's
default path. Never "fully client-side" — this platform has a backend.>
```

### 5.3 DESIGN_SPEC.md template

````markdown
# DESIGN SPEC — <App Name> (<slug>)

- Run: <run_id>   Date: <YYYY-MM-DD>
- References: <product(s)> — <chosen because …>   (or "no visual reference — text-derived, see research/capture-fallback.md")

## 1. References & shot inventory
| File (reference-shots/) | Product | Screen | Width | What it informs |
|---|---|---|---|---|

## 2. Navigation model & screen inventory
<Sidebar / topbar / tabs. Then one row per screen: name, purpose, SPEC Musts it hosts (M1, M2, …).>

## 3. Layout per screen
### <Screen name>  (hosts: M<n>, M<n>)
Information hierarchy: <first / second / third>
```
+----------------------------------------------+
| <ASCII wireframe>                            |
+----------------------------------------------+
```
Responsive: <what collapses/stacks at 768px and 360px>
<repeat per screen>

## 4. Interaction patterns
<Detail view: modal vs side panel vs inline. Drag-and-drop incl. touch fallback.
Bulk actions. Keyboard affordances. One entry per SPEC Must that has interaction.>

## 5. Empty / loading / error conventions
<Per list view: what the empty state says and offers. Loading pattern. Error surfacing.>

## 6. Component mapping
| Observed pattern | CraftBot preset component | Notes |
|---|---|---|
<unmapped patterns: "compose from Card/primitives" or "dropped — <why>">

## 7. Non-goals of the reference pass
<What was deliberately NOT copied from the references, and why — ads, login,
gradients, brand colors, features out of scope.>
````

### 5.4 ITERATION_LOG line

```
<YYYY-MM-DD HH:MM> | <STATUS> | <done + gate evidence> | next: <next step>
```

### 5.5 Questionnaire template (`research/questionnaire.md`)

Answer all six; one concrete choice per line; expansions and Safe Assumptions labeled.

```markdown
# Questionnaire — <run_id>

## Category 1: Design & Visual Identity
<theme (default: follow system), layout style, visual style — CraftBot tokens always>

## Category 2: Data & Entities
<the main "things", their fields, relations, statuses/workflows>

## Category 3: Features & Functionality
<CRUD scope, search/filter/sort, media, detail views, drag-and-drop, bulk ops>

## Category 4: Layout & Navigation
<single vs multi page, nav model, content organization, detail panel vs modal>

## Category 5: UX & Polish
<empty states, responsiveness, specific interactions>

## Category 6: Users & Access
<multi-user? accounts? admin? sharing? (default: single user, no auth)>
```

### 5.6 Vague-phrase expansions & Safe Assumptions

Standard expansions (record which you applied):

| Human says | Expand to |
|---|---|
| "basic user stuff" / "user management" | login, signup, profiles, member list, admin/member roles |
| "normal/standard layout" | left sidebar nav, main content area, responsive, top header |
| "simple dashboard" | 3–4 stat cards, recent activity list, quick-action buttons |
| "basic CRUD" / "the usual" | create/read/update/delete with confirm dialogs, search/filter, sort by date |
| "make it look good" / "clean design" | modern minimal, system theme, CraftBot tokens, card layout |
| "basic search" | text search on primary fields, filter dropdowns, clear-filters button |
| "drag and drop" | reorder via drag, visual drop indicator, touch fallback (tap-select then tap-target) |
| "tags" / "labels" | colored chips, create/delete, filter by tag, multi-tag per item |
| "notifications" | toasts for CRUD feedback |

Safe Assumptions (usable without a source when request and research are silent — record each in SPEC §6 with `source: safe-assumption`):

- System theme preference (light/dark follows OS)
- Responsive design (mobile + desktop)
- Standard CRUD on all entities
- Loading spinners on async operations
- Confirmation dialogs on destructive actions
- Empty states with a helpful message + action button
- CraftBot design tokens for all visual identity
- Search/filter on primary text fields
- Newest-first default sort
- Single user, no auth

---

## 6. When things go wrong (BLOCKED protocol)

Use this from any stage when a bound is hit or something outside your control fails:

1. Set the queue file to `status: BLOCKED`, fill `blocked_reason: "research: <one line>"`, bump `updated`.
2. Append an ITERATION_LOG line stating exactly where the run stopped, with the failing gate output pasted.
3. Post a message to the human: what happened, what was tried (with the pasted evidence), and 2–3 concrete options. Then **end the task**. Do not keep retrying past a stated bound.

| Failure | Action |
|---|---|
| Queue file malformed (missing `slug`, `app_name`, or `## Requirement`) | BLOCKED — never guess intent fields |
| `where claude` empty at R1 | BLOCKED immediately (R1 step 3) |
| A research lane still <30 lines after its one retry | BLOCKED with the line counts |
| SPEC or DESIGN_SPEC gate still failing after 2 revision loops | BLOCKED with the gate output |
| All 4 capture rungs attempted, nothing capturable | NOT blocked — write capture-fallback.md, proceed text-derived (R6.4) |
| `claude` launch fails at R8 | BLOCKED with the first error line from creation.log + manual-fallback instructions |
| Anything else not on this table | BLOCKED — escalate with options rather than improvise past a rule |

A resumed run (fresh session, queue file in `RESEARCHING`/`SPEC_READY`): read ITERATION_LOG bottom-up, find the last stage whose EXIT GATE output is pasted, verify that artifact actually exists, log a `RESUMED` line, continue from the next stage.
