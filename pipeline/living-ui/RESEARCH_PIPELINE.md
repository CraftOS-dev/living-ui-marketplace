# RESEARCH PIPELINE — run by CraftBot (stages R1–R8)

This document is **complete and self-contained**. Do not read README.md, QA_GATES.md, or CREATION_PIPELINE.md — everything you need is in this file. Follow the stages **in order, one at a time**. Do not skip a stage. Do not start a stage before the previous stage's EXIT GATE passed.

**Paths.** Two forms, used for different tools:

- File actions (`read_file`, `write_file`, `list_folder`, `grep_files`): use workspace paths, e.g. `/workspace/pipeline/living-ui/runs/`.
- `run_shell`: always pass `"cwd": "d:\\tempCraftBot\\CraftBot"` and use repo-relative paths, e.g. `agent_file_system\workspace\pipeline\living-ui\runs\`.

They are the same folder: `/workspace/` = `agent_file_system\workspace\` inside the repo.

---

## 0. Why you are doing this

You are **stage 1 of 2** in building a **Living UI** — a small local web app that gets built, tested, and handed to the user. You do the research and write the specs. A second agent (**the creation runner**) does the coding — a **separate, standalone Claude Code CLI process, launched as a background OS command**. It is not CraftBot, it has nothing to do with CraftBot's own `living-ui-creator` skill or `living_ui_scaffold` action, and you never call either of those from this pipeline (see the FORBIDDEN table, §1, and R8). Your final stage launches the real thing automatically.

Your output — `SPEC.md`, `DESIGN_SPEC.md`, the `research/` files, and the `reference-shots/` screenshots — is **everything the builder gets** besides the human's original 1–10 sentence request. Anything you leave vague, the builder has to guess. Anything you get wrong, the builder builds wrong. The human is asleep during all of this: nobody will answer questions, so your specs must be complete.

### 0.1 What a Living UI actually is — read this before you spec anything

Every claim in your SPEC must be buildable on **this** platform. Getting this wrong is the most expensive mistake available to you, because the builder discovers it hours later and has to rewrite your spec.

- **One process.** A Living UI is a single **PocketBase** server that holds the database, the API, auth, realtime updates, and custom verbs, and also serves the React frontend. There is no Python, no FastAPI, no SQLAlchemy, no separate backend. Never spec "fully client-side", "localStorage persistence", or "no backend" — persistence is always PocketBase **collections**.
- **Data lives in collections.** A collection is a table with typed fields. The field types you may use: `text`, `editor` (rich text), `number`, `bool`, `date`, `select` (a fixed value list), `relation` (a link to another collection), `file`, `json`. Every record automatically gets `id`, `created`, `updated`.
- **The frontend is built from a fixed component kit.** The builder composes screens from the preset components listed in §5.7. It cannot install a UI framework or hand-roll a design system, and it cannot change colors or fonts — those come from CraftBot's design tokens.
- **The app runs on the user's own machine (localhost).** Nothing on the internet can reach into it. **Never spec inbound webhooks, callback URLs, or "connect this app to your GitHub account" install flows.**
- **Never spec credentials.** No OAuth flows, no personal access tokens, no "enter your API key" screens. CraftBot already holds the user's connected accounts (Gmail, Slack, Discord, Notion, GitHub, …) and the app reaches them through a built-in **zero-key bridge** the app's own backend routes can call. The bridge also offers in-app AI (summarize / classify / generate text).
- **External data is PULLED, never pushed.** If the app shows data from an outside service, spec it as: a bridge pull when the page loads or the user hits refresh, plus a **scheduled operation** ("every 15m" / "daily 08:00") that syncs in the background. "Real-time" for external data means periodic refresh — write that.
- **Realtime is only for the app's own records.** Lists update instantly when the app's own data changes. That is free and automatic; don't spec polling.
- **Never depend on a browser permission prompt.** Location, notifications, and camera prompts are unreliable in the embedded tab. Location comes from a keyless backend lookup or a user-entered setting. Public data (weather, news, prices) is fetched by the backend from keyless public APIs and cached, degrading gracefully offline.

**Gold standard.** Before writing SPEC.md (stage R5) and DESIGN_SPEC.md (stage R7) you will read these two files in full and match their **depth**:

- `/workspace/pipeline/living-ui/runs/tierlist-20260709/SPEC.md`
- `/workspace/pipeline/living-ui/runs/tierlist-20260709/DESIGN_SPEC.md`

A previous run in the same product category produced specs half that depth. That run's app was rejected. Shallow specs fail this pipeline.

> **Caveat on the gold files:** they were written for the platform's older version and use its vocabulary (FastAPI, SQLAlchemy models, `Literal[...]` types, separate backend/frontend ports). **Copy their depth and precision, never their platform words.** Yours uses PocketBase collections and the field types listed above.

### 0.2 The closed artifact list — you write nothing else

This is **every** file this pipeline will ever create. If you're about to write a file whose path isn't on this list, stop — you have left the SOP, not found a better way to do it.

```
runs/<run_id>/ITERATION_LOG.md
runs/<run_id>/research/decomposition.md
runs/<run_id>/research/features.md
runs/<run_id>/research/competitors.md
runs/<run_id>/research/ux-patterns.md
runs/<run_id>/research/data-model.md
runs/<run_id>/research/questionnaire.md
runs/<run_id>/reference-shots/*.png            (or research/capture-fallback.md if none)
runs/<run_id>/SPEC.md
runs/<run_id>/DESIGN_SPEC.md
```

That's ten paths. There is no eleventh. In particular, never create:

- **A "HANDOVER"/"SUMMARY"/"COMPLETE"/"REPORT"-flavored file of any name.** A past run (`pokedex-web-app-20260803`) wrote `HANDOVER.md` declaring "✅ FULLY COMPLETED, ✅ ALL GATES PASSED" — while `ITERATION_LOG.md` held exactly one line (R1's) and none of the required files existed. Completion is communicated exactly two ways (hard rule 11), and a handover document is not one of them.
- **A "technical architecture" document, or any document naming specific library/version choices.** That same run invented `technical-architecture.md` prescribing React Query, "Tailwind CSS 3," and "PocketBase v0.22" — none of which are even correct (the real pins are Tailwind ^4.1.0 and PocketBase 0.39.7) and none of which are research's decision to make; see standing correction 15.
- **A "feature specification" in place of SPEC.md, a "synthesis" or "validation report" in place of questionnaire.md.** Same run: `feature-specification.md`, `research/synthesis.md`, and `validation-report.md` all stood in for required files under different names and shallower content — and none of their EXIT GATEs were ever run.

If you find yourself drafting a document whose section headings you invented rather than one copied verbatim from a §5 template, that itself is the tell. Stop, re-open this file at the stage you're actually on, and continue from there.

---

## 1. Hard rules

Read all of these now. Each one exists because a past run broke it and the run failed.

1. **`runs/<run_id>/ITERATION_LOG.md` is the only state store.** There is no separate request or queue file — every status change is a line appended to that file, immediately, the moment it happens.
2. **You own exactly three statuses: `RESEARCHING`, `SPEC_READY`, `HANDOFF`.** Never write any other status except `BLOCKED`. Statuses `BUILDING`, `SELF_QA`, `AWAITING_HUMAN_REVIEW`, `IMPROVING`, `PACKAGING`, `DONE` belong to the creation runner — once you've logged `HANDOFF` and launched it, don't touch that run's folder again.
3. **Every gate is mechanical.** A gate passes when the command's printed output meets the stated pass condition — nothing else counts. You must paste the command output into ITERATION_LOG. **You may not explain a red result into a green one.** The words "expected", "artifact", "noise", "effectively", "should be fine" are banned in gate log lines. A past run logged a failing check as "expected test runner fuzzing artifacts" while the output said `"status": "fail"` — that run failed human review. If the output does not literally show the pass condition, the gate is red: fix the artifact and re-run the gate.
4. **Every SPEC claim must trace to a source**: the request body, a human-pinned reference, a file in `runs/<run_id>/research/`, or a named Safe Assumption (§5.6). Claims with no source get cut.
5. **The request text beats research.** If the human asked for something unusual, research informs *how*, never *whether*.
6. **Scope caps: at most 6 collections, at most 8 Must features.** Overflow goes under `Won't (v1)` with a one-line note.
7. **References inform structure, never identity.** Screenshots and competitor products dictate where things go and how they behave — never colors, fonts, logos, product names, or copy text. Visual identity is always CraftBot's design tokens. (Exception: colors that are the app's *user data* — e.g. tier-row colors in a tier-list app — belong in SPEC §3 as data.)
8. **No feature may require credentials, an inbound webhook, or a browser permission** (§0.1). Connected services are reached only through the zero-key bridge, and only services the requirement paragraph actually mentions.
9. **Write files only inside `runs/<run_id>/`.** Nothing anywhere else.
10. **Chunk large file writes — never one giant single-shot `write_file`.** A `write_file` action embeds its content inline as a string; when that string runs long, the model's own response gets truncated mid-string and CraftBot's action parser fails with `Unable to parse action decision ... unterminated string` — this happened at the start of the writing phase in run craftdex-20260715. Any file likely to exceed ~150 lines (a verbatim research brief, SPEC.md, DESIGN_SPEC.md) must be written in sequential passes: an initial `write_file` with the first chunk, then `write_file` append (or `stream_edit`) calls for the rest.
11. **Completion has exactly two channels — nothing else, ever.** The ITERATION_LOG `HANDOFF` line (R8 step 2) and the fixed final chat message (R8 step 7), both gated on R8 step 1's manifest showing every line PASS. Never write a "done"/"complete"/"summary"/"handover" file of your own devising, and never tell the human research is finished through any other message. The urge to write one is itself the signal you've drifted off this SOP (§0.2) — stop, and resume from the last stage whose EXIT GATE output you actually pasted into ITERATION_LOG.
12. **A quiet ITERATION_LOG is not quiet progress — it's a stop sign.** Every stage transition gets a logged line the moment it happens (rule 1). A run that logs R1 and then produces files for R2 through R8 without ever appending another line has not been moving fast — it has stopped following this SOP's stages, templates, and gates, whatever the resulting files claim. A past run (`pokedex-web-app-20260803`) logged exactly one line, then 11 minutes later declared itself "FULLY COMPLETED, ALL GATES PASSED" via a file the SOP never asked for. If you notice you haven't logged a line in a while, that is the moment to stop and check whether you actually ran the last stage's EXIT GATE — not the moment to hurry toward a finish.

**FORBIDDEN — never do these:**

| Forbidden | Why (the failure it caused) |
|---|---|
| Creating any file outside the closed artifact list (§0.2) — a HANDOVER/SUMMARY/REPORT doc, a "technical architecture" doc, or a differently-named stand-in for SPEC.md/DESIGN_SPEC.md/questionnaire.md | Run pokedex-web-app-20260803 wrote four such files (`HANDOVER.md`, `feature-specification.md`, `technical-architecture.md`, `research/synthesis.md`) and declared "FULLY COMPLETED, ALL GATES PASSED." ITERATION_LOG held one line, no gate was ever run, no handoff ever happened. |
| Calling the `living_ui_scaffold` action, loading/using the `living-ui-creator` skill, or any other app-scaffolding/build action | You are not building. These are CraftBot's own everyday tools for *direct, non-pipeline* chat-driven builds — completely different from "launch the creation runner" (R8), which means starting an external `claude` CLI process. Two separate runs have now reached R8 and called `living_ui_scaffold` instead: the first broke every downstream assumption by putting the app outside the run folder; the second (`pokedex-web-app-20260803`, round 2) also first loaded the `living-ui-creator` skill, then registered a real CraftBot project (`living_ui_projects.json` id `7d24165f`, "Pokédex") and dispatched a build to *that* project's own session — a build using none of the SPEC.md/DESIGN_SPEC.md this pipeline had just spent R1–R7 producing, while this run's own ITERATION_LOG never even reached `HANDOFF`. |
| Skipping screenshot capture without writing `research/capture-fallback.md` (stage R6) | Happened twice: run tiermaker-20260713 wrote "(no visual shots captured, text derived)" without attempting the fallback ladder, and run pokedex-web-app-20260803 left `reference-shots/` empty with no fallback file and no mention of it at all. Both times DESIGN_SPEC was shallow or, the second time, never written. |
| Summarizing, shortening, or paraphrasing a subagent's research brief before writing it to `research/` | Thin research files starve the SPEC. Write the returned brief **verbatim**. |
| Marking a gate passed without pasting the command output | See hard rule 3. |
| Editing anything under `living-ui-v2/`, any app folder, or any pipeline doc | Ground truth is read-only. |
| Polling, waiting on, or touching the run folder after stage R8's launch verification | After handoff the creation runner owns it. Two writers on the same ITERATION_LOG corrupts state. |
| Asking the human a question | The human is asleep. Use a Safe Assumption (§5.6) and record it, or go BLOCKED (§6) if truly stuck. |

**Progress tracking:** at R1, create one todo item per stage R1–R8 with `task_update_todos`. Mark each stage done only after its EXIT GATE output is pasted into ITERATION_LOG.

---

## 2. Standing corrections

Lessons from past runs, restated as orders. (The creation runner appends here after each run's retrospective — never delete entries.)

1. Acceptance criteria must name a user action AND an observable result. "No blank canvas state" is not a criterion; "A new list opens with exactly 5 tiers labeled S, A, B, C, D, all empty" is.
2. At least 3 acceptance criteria in the SPEC must verify persistence by saying what survives a page **reload**.
3. Persistence is always PocketBase collections. Never spec "fully client-side", "localStorage persistence", or "no backend" — a past SPEC did, contradicting the platform, and the builder had to rewrite it.
4. Every assumption needs a concrete `Fallback:` — what the builder changes if the assumption is wrong. "User confusion" is a risk, not a fallback.
5. Enum-like fields (statuses, stages, categories with fixed values) are `select` fields and must list **every** value explicitly in SPEC §3. Never spec a field named `metadata`.
6. The unranked/uncategorized "pool" pattern (items not yet placed) is modeled as an **optional `relation` field left empty**, not as a separate collection — check `research/data-model.md` for your category's equivalent core mechanic and make sure SPEC §3 models it.
7. **No thin tabs.** If a screen/section (SPEC §4 or DESIGN_SPEC §3) would render with only a line or two of content — e.g. an evolution line rendered as just clickable name buttons — either fold it into an adjacent tab/section or spec enough depth to justify its own screen (related media, richer state, secondary actions). A tab that's mostly whitespace is a finding waiting to happen at review.
8. **Filters must use the whole data model, not just the obvious fields.** Before capping the filter list, walk every field, tag, and boolean flag in SPEC §3 and ask whether it's a plausible filter/facet (categorical tags, rarity/status flags, derived groupings like "final evolution" or "starter"), not just the first 2–4 fields that come to mind.
9. **A "bonus" feature beyond the core ask gets the same completeness bar as a Must.** If SPEC §4 adds a feature the human didn't ask for (e.g. a "Teams" builder bolted onto a Pokedex clone), its acceptance criteria must cover the feature's own natural sub-attributes (a team of Pokémon needs moves/ability/nature, not just species slots) — spec it fully or cut it to `Won't (v1)`, never half-deep.
10. **Every collection needs a stated INGRESS** — how records actually get in. One of: a user form in the UI, a bridge pull from a named connected service (on load/refresh, plus a scheduled sync), a file import, or computed from other collections. An app whose whole purpose is showing outside data, with no ingress specified, is unbuildable — the builder has nothing to implement.
11. **Never spec a feature that would require changing the platform.** The kit's components, the app shell, the theme, and the project manifest are locked and hash-checked; the builder physically cannot edit them. If the only way to get an effect is "modify the kit", spec the closest thing composable from §5.7's components instead, or cut it.
12. **Auth mode is decided at scaffold time and shapes every collection rule.** If the request implies per-user data, accounts, or sharing, say so explicitly in SPEC §8 so the builder scaffolds `multi-user`. Otherwise state single-user/`none`. Switching later means rewriting every migration.
13. **Write only the files in the closed artifact list (§0.2), and never invent a stage this pipeline doesn't have** (e.g. a "technical architecture" phase — that's the creation runner's job, guided by DESIGN_SPEC.md, not research's).
14. **Every collection's rules must match the run's logged `auth_mode`.** A `none` (single-user) app must never have a `user_id`/`owner` field on any collection.
15. **Never name a specific pinned package version or a state-management/data-fetching library in SPEC.md or DESIGN_SPEC.md** — `lui create`/`kit-sync` pin the stack, not research. A past run's forbidden "technical architecture" document prescribed React Query and stated "PocketBase v0.22" and "Tailwind CSS 3" — both wrong (real pins: PocketBase 0.39.7, Tailwind ^4.1.0) and neither research's decision regardless.
16. **A quiet ITERATION_LOG across several stages, while files still get produced, is not efficiency — it means the stages' literal templates and gates were abandoned.** Notice the gap and stop before declaring anything done, don't push through to a finish (hard rule 12).
17. **A collection's `Ingress`/`Rules` claim in SPEC §3 must not be contradicted by a different storage mechanism named in §8 Build notes.** A past run's §3 declared Pokemon/Type/Ability/Move as PocketBase collections with "Full one-way sync from PokéAPI on initial app load, cached locally permanently" as their Ingress — then §8 said "reference data stored as static JSON assets bundled at build time," a different mechanism entirely. Pick one and say it once; a builder reading a contradiction has to guess which section is authoritative.
18. **A research finding stating an absolute performance or "no loading feedback" mandate must be checked against the platform's own Always-Enforced rules (`GLOBAL_LIVING_UI.md`) before it becomes binding, not carried into the questionnaire and SPEC verbatim.** A past run's `features` lane wrote "Response time for any user action must be <100ms. No loading spinners for core browsing functionality" — a real, sourced finding about the category norm — and it flowed untouched into the questionnaire and then SPEC's own acceptance criteria, directly conflicting with the platform's "loading spinners required for all async operations" rule and with the same SPEC's own one-time full-dataset sync, which will visibly take longer than 100ms. R4's merge step is where this gets reconciled: an absolute claim like this becomes "instant for cached/local operations; a loading state is still shown for the one-time initial sync," not a blanket ban.

---

## 3. Where the request comes from

There's no queue folder. The human pastes a filled-in [NEW_APP_PROMPT.md](NEW_APP_PROMPT.md) block directly into chat — that message is the entire request, and it's the only copy of it that exists until you write it into ITERATION_LOG. It gives you:

| Field | Notes |
|---|---|
| `app_name` (display name) | the app's real name, used at scaffold time |
| `slug` | kebab-case; combine with today's date for `run_id` |
| `tags` | 3–5, descriptive |
| `auth_mode` | `none` (single user, the default) or `multi-user` (accounts). Carry it into SPEC §8 verbatim — the builder passes it to the scaffolder and every collection rule depends on it |
| the `REQUIREMENT` paragraph | what to build — references/products the human likes and any hard constraints (auth, integrations, non-goals) are written directly into this paragraph, not separate fields. Anything that reads like a pinned preference outranks whatever your own research finds; anything that reads like a hard constraint is read literally — only connected services mentioned there are allowed |

Before you do anything else: check whether a run is already in flight — see R1 step 1. If one is, resume it instead of starting the pasted request.

---

## 4. Stages

Every stage below has the same shape: STEPS (numbered — do them in order) and an EXIT GATE (run the command, paste the output into ITERATION_LOG, check it against the pass condition).

ITERATION_LOG line format (one line per event, appended with `write_file` append or `stream_edit`):

```
<YYYY-MM-DD HH:MM> | <STATUS> | <what was done / gate output summary> | next: <what comes next>
```

When a gate output is multi-line, paste it in a fenced block directly under the log line.

---

### R1 — Start & preflight

**Entry:** you were kicked off in Mode RESEARCH with a filled-in NEW_APP_PROMPT.md message.

1. Check for an in-flight run first: `list_folder` on `/workspace/pipeline/living-ui/runs/`, then read the `ITERATION_LOG.md` of any folder that isn't obviously finished. If one has a last-logged status of `RESEARCHING` or `SPEC_READY`, **resume that run instead** — read its log bottom-up, verify the last logged claim against the actual files, continue from the first stage whose EXIT GATE output is not in the log. Otherwise, proceed with the pasted request below.
2. Read the pasted kickoff message for `app_name`, `slug`, `tags`, `auth_mode`, and the `REQUIREMENT` paragraph. If any is missing or the slug isn't kebab-case, go BLOCKED (§6) rather than guess. (If `auth_mode` alone is missing, default it to `none` and record that as a Safe Assumption — don't block on it.)
3. Verify the creation runner is launchable NOW, and that its toolchain exists (so a broken handoff fails at minute 1, not hour 6). Run:
   ```json
   run_shell: { "command": "where claude & node --version", "shell": "cmd", "cwd": "d:\\tempCraftBot\\CraftBot" }
   ```
   **If no claude path prints, or the Node version is below v24**: this run can't be started — tell the human which one is missing (standalone Claude Code CLI on PATH; Node.js ≥ 24) and stop. Nothing has been created yet, so there's no run to mark BLOCKED.
4. Compute `run_id: <slug>-<YYYYMMDD>` using today's date. Create the run folder skeleton:
   ```json
   run_shell: { "command": "mkdir agent_file_system\\workspace\\pipeline\\living-ui\\runs\\<run_id>\\research agent_file_system\\workspace\\pipeline\\living-ui\\runs\\<run_id>\\reference-shots", "shell": "cmd", "cwd": "d:\\tempCraftBot\\CraftBot" }
   ```
5. Write `/workspace/pipeline/living-ui/runs/<run_id>/ITERATION_LOG.md` — this is the only copy of the original ask that will exist from here on, so capture it in full:
   ```markdown
   # ITERATION LOG — <run_id>
   Started: <timestamp> by craftbot-research
   Pipeline: RESEARCH (R1–R8)

   App: <app_name>   Slug: <slug>   Tags: <tags>   Auth mode: <none|multi-user>
   Requirement (verbatim):
   <the full REQUIREMENT paragraph from the kickoff message>
   ---
   <timestamp> | RESEARCHING | started, run folder created, claude CLI at <path>, node <version> | next: R2 decompose
   ```
6. Create the R1–R8 todo list with `task_update_todos`.

**EXIT GATE** (paste all outputs):
```json
run_shell: { "command": "where claude & node --version & dir /b agent_file_system\\workspace\\pipeline\\living-ui\\runs\\<run_id> & findstr /c:\"RESEARCHING\" agent_file_system\\workspace\\pipeline\\living-ui\\runs\\<run_id>\\ITERATION_LOG.md", "shell": "cmd", "cwd": "d:\\tempCraftBot\\CraftBot" }
```
**Pass:** a claude path is printed, the node version is v24 or higher, `research` and `reference-shots` are listed, and a `RESEARCHING` line is printed. Anything missing → fix it, re-run the gate.

---

### R2 — Decompose the request

1. Re-read the requirement text from the ITERATION_LOG header you just wrote.
2. Fill this template — replace every `<...>`; copy everything else exactly — and write it to `/workspace/pipeline/living-ui/runs/<run_id>/research/decomposition.md`:

   ```markdown
   # Decomposition — <run_id>

   ## Category
   <one line: "this is a <tier list maker / habit tracker / invoicing tool / ...> app">

   ## Constraints
   <every hard constraint you can find in the requirement paragraph — auth needs,
   named connected services, explicit non-goals ("no email sending") — pulled out as a
   bullet list, one per line; or "none stated">

   ## Pinned references
   <every product/app the requirement paragraph mentions liking or wanting to
   resemble, one per line, with its URL if given; or "none pinned">

   ## Vague phrases
   <every underspecified phrase from the requirement, quoted, one per line — e.g. "basic user stuff", "make it look good"; or "none">
   ```

**EXIT GATE** (paste output):
```json
run_shell: { "command": "findstr /c:\"## Category\" /c:\"## Constraints\" /c:\"## Pinned references\" /c:\"## Vague phrases\" agent_file_system\\workspace\\pipeline\\living-ui\\runs\\<run_id>\\research\\decomposition.md", "shell": "cmd", "cwd": "d:\\tempCraftBot\\CraftBot" }
```
**Pass:** exactly 4 heading lines printed. **Then append this result to ITERATION_LOG.md right now**, via `write_file` append / `stream_edit`, before touching R3 — a chat message saying "R2 done" is not a logged line, only the file write is.

---

### R3 — Four research lanes (parallel subagents)

1. Build four queries from the template in §5.1 — one per lane: `features`, `competitors`, `ux-patterns`, `data-model`. Each query must be fully self-contained (the subagent sees nothing of your context): include the category, the verbatim requirement text, the constraints, and the lane task block.
2. Track each lane as **its own todo item** — `features`, `competitors`, `ux-patterns`, `data-model` — not one combined "R3" item. A lane that silently never returns must be visible in your own progress list, not just left to memory.
3. Emit **all four `spawn_subagent` calls in one decision batch** (they run in parallel), `agent_type: "research_agent"`.
4. When each returns, take its `result` and write it **verbatim, unshortened** to `/workspace/pipeline/living-ui/runs/<run_id>/research/<lane>.md` with `write_file`. Do not summarize. Do not merge lanes into one file.
5. If a subagent fails or returns fewer than 30 lines: re-spawn **that lane once**, appending to its query: "Your previous brief was too thin. The brief must be at least 40 lines of substantive markdown following the required output format." One retry per lane, maximum.

**EXIT GATE** (paste output):
```json
run_shell: { "command": "for %f in (features competitors ux-patterns data-model) do @find /c /v \"\" agent_file_system\\workspace\\pipeline\\living-ui\\runs\\<run_id>\\research\\%f.md", "shell": "cmd", "cwd": "d:\\tempCraftBot\\CraftBot" }
```
**Pass:** four lines printed, each showing a count of **30 or more**. Any file below 30 after its one retry → BLOCKED (§6) with the counts pasted. **A missing file** (the command errors on it, or prints nothing) **means that lane never completed — you have not passed R3.** Do not proceed to R4, and do not write a merged summary in its place (§0.2, standing correction 13); re-spawn the missing lane instead. **Then append this result to ITERATION_LOG.md right now** — running the check and reading its result in chat is not the same as writing it to the file, and a run has already reached R8 having genuinely run this exact command without ever logging it.

---

### R4 — Merge findings & questionnaire self-interview

**This stage's only deliverable is `research/questionnaire.md` (§0.2).** If you want to think through the merge/precedence/scope-cap logic before answering it, that reasoning stays in your own scratch thinking — it does not get written to a file of its own. There is no "synthesis report," "gap analysis," or "roadmap" document; a past run invented one (`research/synthesis.md`) instead of ever writing the required questionnaire.

1. Read all four `research/*.md` files.
2. Build one candidate feature/collection set. Resolve every conflict by this precedence, highest first:
   ```
   request body > pinned references > research consensus (2+ lanes agree) > single-lane finding > Safe Assumption
   ```
3. Apply the scope caps (hard rule 6). Rank Must candidates by: core to the category (features lane) → needed by another Must → effort. Cut from the bottom into `Should`, then `Won't (v1)`.
4. **Filter every candidate through §0.1.** Anything that needs a login to a third-party service, an inbound webhook, an API key, or a browser permission is either re-expressed as a bridge pull + scheduled sync, or cut to `Won't (v1)`. Do this now, not in the SPEC — it changes which features make the cut. **Also moderate any absolute performance or "no loading feedback" claim a lane returned** (Standing correction 18) against the platform's Always-Enforced loading-spinner rule before it goes into the questionnaire — "instant for cached data, still shows a loading state for the one-time initial sync" survives into SPEC; "no loading spinners, ever" does not.
5. If the lanes genuinely disagree on something build-critical (e.g. the core data model), you may spawn **one** follow-up subagent with a narrow question. One for the whole run. Log it.
6. Answer the questionnaire (§5.5) — all 6 categories, in writing, to `/workspace/pipeline/living-ui/runs/<run_id>/research/questionnaire.md` using the §5.5 template. Rules:
   - Every answer is a concrete choice ("kanban columns with a modal detail view"). The strings `TBD`, `either works`, and `maybe` are banned.
   - Every vague phrase from decomposition.md gets an explicit expansion (§5.6 has the standard expansions).
   - Every gap research didn't cover gets a Safe Assumption from §5.6, recorded with `source: safe-assumption`.

**EXIT GATE** (paste both outputs):
```json
run_shell: { "command": "findstr /c:\"## Category\" agent_file_system\\workspace\\pipeline\\living-ui\\runs\\<run_id>\\research\\questionnaire.md & findstr /i /c:\"TBD\" /c:\"either works\" /c:\"maybe\" agent_file_system\\workspace\\pipeline\\living-ui\\runs\\<run_id>\\research\\questionnaire.md & echo GATE-DONE", "shell": "cmd", "cwd": "d:\\tempCraftBot\\CraftBot" }
```
**Pass:** exactly 6 `## Category` lines printed, then NO lines between them and `GATE-DONE` (i.e. zero banned-word hits). **Then append this result to ITERATION_LOG.md right now**, before touching R5 — a chat message is not a logged line.

---

### R5 — Write SPEC.md

1. **Read `/workspace/pipeline/living-ui/runs/tierlist-20260709/SPEC.md` in full, now.** Your SPEC must match its depth. Compare these before writing a single criterion:

   **REJECTED** (from a failed run): `- [ ] No blank canvas state` · `- [ ] Zero latency drag interaction`
   **GOLD** (from the accepted run): `- [ ] A new list opens with exactly 5 tiers labeled S, A, B, C, D in canonical colors, all empty, plus an empty pool.` · `- [ ] × on a ranked item returns it to the end of the pool; the item is not deleted.` · `- [ ] A .txt or 15 MB file is rejected with a user-visible error toast; valid files in the same batch still land.`

   The difference: the gold criteria name a **user action and an observable result**, cover **edge cases** (wrong file type, oversized file, partial batch), and check **persistence across reload**. Write yours like the gold ones.

   Two places NOT to copy the gold file:
   - Its assumptions table has a "Risk if wrong" column. **Yours** uses the newer template (§5.2) — the last column is `Fallback` and every cell in it starts with the literal text `Fallback:` (the gate counts that string).
   - Its data model uses the old platform's words (SQLAlchemy models, `Literal[...]`, separate ports). **Yours** uses PocketBase collections and the field types in §0.1, and every row's last cell starts with the literal text `Ingress:` (the gate counts that too).

2. Fill the SPEC template (§5.2) and write it to `/workspace/pipeline/living-ui/runs/<run_id>/SPEC.md`. Section-by-section requirements:
   - **§3 Collections:** **at most 6, mechanically checked below — this cap has already been exceeded once** (a past run declared 7: Pokemon, Type, Ability, Move, Team, TeamMember, UserFavorite). If you're at 7, merge or cut one before writing, don't rely on judgment alone. Every field with a PocketBase type from §0.1; every `select` field's values listed; relations explicit; the category's core mechanic modeled (Standing correction 6); every row's `Ingress:` cell states how records get in (Standing correction 10), and that claim must **not** be contradicted anywhere else in the doc (Standing correction 17) — don't call something a synced collection here and a build-time static asset in §8. Never a field named `metadata`. **Never a `user_id`/`owner` field if `auth_mode` is `none`** (Standing correction 14) — a single-user app has no user to key records to.
   - **§4 Musts:** 4–8 features, each with 3–4 acceptance criteria written like the GOLD examples. At least 3 criteria across the SPEC must include the word "reload" or "persist".
   - **§6 Assumptions:** at least 6 rows. Every row's last cell starts with `Fallback:` followed by the concrete change the builder makes if the assumption is wrong.
   - **§8 Build notes:** state the auth mode verbatim from the log header, the custom operations worth declaring, any bridge usage and its scheduled sync, and anything else that changes the builder's default path. **Never name a specific package version or state-management library** (a PocketBase version, a Tailwind major version, "React Query," etc.) anywhere in SPEC.md — those are the builder's tooling decisions (`lui create`/`kit-sync` pin them), not research's. A past run's invented (and forbidden) "technical architecture" document got these flatly wrong — "PocketBase v0.22" against the real 0.39.7 pin, "Tailwind CSS 3" against the real ^4.1.0 — proof that the fix isn't getting the number right, it's not writing that content at all.
   - Every claim traceable (hard rule 4); the source column/parenthetical says which.

3. Append the ITERATION_LOG line with status `SPEC_READY`.

**EXIT GATE** (paste output):
```json
run_shell: { "command": "$f='agent_file_system/workspace/pipeline/living-ui/runs/<run_id>/SPEC.md'; $t=Get-Content $f; \"LINES=$($t.Count)\"; \"SECTIONS=$(($t | Select-String -Pattern '^## [1-8]\\.').Count)\"; \"CRITERIA=$(($t | Select-String -SimpleMatch '- [ ]').Count)\"; \"RELOAD=$(($t | Select-String -Pattern 'reload|persist').Count)\"; \"FALLBACKS=$(($t | Select-String -SimpleMatch 'Fallback:').Count)\"; \"INGRESS=$(($t | Select-String -SimpleMatch 'Ingress:').Count)\"; \"BANNED=$(($t | Select-String -Pattern 'TBD|either works|localStorage|FastAPI|SQLAlchemy|React Query|Tailwind CSS|PocketBase v|user_id').Count)\"; $s3=($t | Select-String -Pattern '^## 3\\.').LineNumber[0]; $s4=($t | Select-String -Pattern '^## 4\\.').LineNumber[0]; \"COLLECTIONS=$((($t[$s3..($s4-2)] | Select-String -SimpleMatch '|').Count) - 2)\"", "shell": "powershell", "cwd": "d:\\tempCraftBot\\CraftBot" }
```
**Pass, all eight — quote every one of them individually in your ITERATION_LOG line, not a prose summary:** `LINES` ≥ 110 · `SECTIONS` = 8 · `CRITERIA` ≥ 18 · `RELOAD` ≥ 3 · `FALLBACKS` ≥ 6 · `INGRESS` ≥ 2 · `BANNED` = 0 · `COLLECTIONS` ≤ 6. A summary like "all sections present, no banned words" that omits a metric is not evidence that metric passed — see R7's identical warning for why this matters.
Fail → revise the SPEC (not the numbers' meaning) and re-run. **Maximum 2 revision loops**, then BLOCKED with the gate output pasted.

---

### R6 — Reference capture (Playwright screenshots)

**Save every screenshot into the `reference-shots/` folder that R1 step 4 already created — it exists, empty, from the start of this run. Never create a new folder for this** (a `screenshots/` folder, or any other name). A past run (`pokedex-web-app-20260803`, round 2) captured three real screenshots successfully but saved them all to a freshly-created `screenshots/` folder while the correct, already-existing `reference-shots/` sat empty — the R8 manifest check (§0.2) looks *only* in `reference-shots/`, so from its point of view zero shots existed. If `browser_take_screenshot` or your file-copy step asks for or defaults to a directory name, override it to the exact path `agent_file_system\workspace\pipeline\living-ui\runs\<run_id>\reference-shots\`.

1. Pick **1–2** reference products — no more — in this priority order: (a) human-pinned reference from decomposition.md — always chosen if present; (b) the category leader with a publicly viewable UI (competitors lane nominates candidates); (c) the most-imitated UX in the category. **Two is the hard cap; the second is only justified if it shows a screen type the first lacks.** The same round-2 run captured three products — pick the two that matter most and stop; a third reference adds research-runner time for no gate benefit (the manifest only needs ≥4 pngs, which two products' worth of shots already clears).
2. Capture with the Playwright browser tools, per reference, **at most 6 shots**:
   1. `browser_navigate` to the product's main editor / dashboard / demo page.
   2. `browser_resize` to width 1280, height 800.
   3. `browser_take_screenshot` with filename `<product>-<screen>-1280.png`. **Never full-page.** If your tool errors on an element-targeted or clipped screenshot, the fix is **not** to fall back to a full-page capture — `browser_resize` to the target viewport first, then call `browser_take_screenshot` with no element/clip/fullPage parameter at all; a plain screenshot after a resize captures exactly that viewport. The same round-2 run hit exactly this error and fell back to full-page for all three captures, which is explicitly forbidden. If the tool truly has no way to avoid full-page, say so explicitly in the ITERATION_LOG line for this stage — a disclosed limitation is fine, a silent violation is not.
   4. `browser_resize` to width 390, height 844; `browser_take_screenshot` with filename `<product>-<screen>-390.png`.
   5. Repeat for a detail view and a create/edit flow. Skip pricing/login/blog pages.
3. Each screenshot tool result shows where the PNG was saved. Copy every capture into `reference-shots/` with `run_shell` (`copy "<saved path>" "agent_file_system\workspace\pipeline\living-ui\runs\<run_id>\reference-shots\"`, shell cmd, cwd as always).
4. **If a reference blocks capture** (login wall, bot blocker like Cloudflare): work down this ladder, and for EVERY rung you attempt, record in `/workspace/pipeline/living-ui/runs/<run_id>/research/capture-fallback.md` the rung number, the URL tried, and what happened:
   - `Rung 1:` the product's marketing homepage (most SaaS homepages show the product UI).
   - `Rung 2:` official docs / help-center articles (walkthroughs contain UI screenshots).
   - `Rung 3:` an alternative product from the competitors lane with a public UI (capture that instead — note the substitution).
   - `Rung 4:` a web image search for `<product> app screenshot` — capture the results page as a low-fidelity mosaic.
   Only if all four rungs are attempted and logged may this stage end with zero shots — then DESIGN_SPEC is written from `research/ux-patterns.md` text alone. **Skipping capture without the written ladder is forbidden — this has happened in two separate runs now** (tiermaker-20260713 got rejected for it; pokedex-web-app-20260803 round 1 left `reference-shots/` empty with no fallback file at all). If you reach the end of this stage with zero screenshots, the very next thing you write is the ladder — never silence.

**EXIT GATE** (paste output):
```json
run_shell: { "command": "dir /b agent_file_system\\workspace\\pipeline\\living-ui\\runs\\<run_id>\\reference-shots & findstr /c:\"Rung 1\" /c:\"Rung 2\" /c:\"Rung 3\" /c:\"Rung 4\" agent_file_system\\workspace\\pipeline\\living-ui\\runs\\<run_id>\\research\\capture-fallback.md & echo GATE-DONE", "shell": "cmd", "cwd": "d:\\tempCraftBot\\CraftBot" }
```
**Pass:** at least 4 `.png` files listed, **OR** all 4 `Rung` lines printed from capture-fallback.md. (The `findstr` erroring with "cannot open" is fine when shots exist.) **You must actually run this command** — round 2's run never invoked it at all (no corresponding tool call exists for R6, unlike every other stage), which is exactly how three screenshots sitting in the wrong folder went unnoticed. **Then append the result to ITERATION_LOG.md right now**, before touching R7.

---

### R7 — Write DESIGN_SPEC.md

**There is no "technical architecture" stage in this pipeline.** DESIGN_SPEC.md is UX/layout/component-mapping only — schema, operations, and any tech-stack notes already live inside SPEC.md's own template (§3, §8). A past run invented a separate `technical-architecture.md` here instead of ever writing DESIGN_SPEC.md, and used it to (wrongly) prescribe specific libraries and pinned versions that aren't research's call to make (Standing correction 15). If you feel the pull to write a document about the "architecture," that pull is the drift covered in §0.2 — the file you're supposed to be writing is this one.

1. **Read `/workspace/pipeline/living-ui/runs/tierlist-20260709/DESIGN_SPEC.md` in full, now.** Match its depth: it reads real measurements and behaviors off the screenshots ("label cells are ~70px colored squares … each row's right edge holds a gear icon and stacked ▲▼ chevrons") and states responsive behavior breakpoint by breakpoint. One place NOT to copy it: it doesn't tag SPEC Must IDs — **your** doc must write `M1`, `M2`, … next to the screens and interactions that host them (template §5.3; the gate counts them).
2. **Identity rule (this is where past runs violated it):** colors, fonts, spacing, radii, shadows come from CraftBot's design tokens ONLY — never from the screenshots. Screenshots dictate *where things go and how they behave*. Zero hex colors, zero font names in DESIGN_SPEC.md. Colors that are user DATA belong in SPEC §3, not here.
3. Fill the template (§5.3) and write it to `/workspace/pipeline/living-ui/runs/<run_id>/DESIGN_SPEC.md`:
   - **§3 Layout per screen:** one ASCII wireframe per screen (box-drawing with `+--` borders) plus information hierarchy (what the eye hits first/second/third) plus responsive behavior at 768px and 360px.
   - **§2/§3 must cover every SPEC Must:** each M-number appears next to the screen that hosts it.
   - **§6 Component mapping:** every observed UI pattern → a component name **from the list in §5.7**, or "compose from Card + primitives", or "dropped — <why>". Do not invent component names; if the pattern isn't in §5.7, it gets composed or dropped.
4. Append the ITERATION_LOG line (status stays `SPEC_READY`).

**EXIT GATE** (paste output):
```json
run_shell: { "command": "$d=Get-Content 'agent_file_system/workspace/pipeline/living-ui/runs/<run_id>/DESIGN_SPEC.md'; $s=Get-Content 'agent_file_system/workspace/pipeline/living-ui/runs/<run_id>/SPEC.md'; \"LINES=$($d.Count)\"; \"SECTIONS=$(($d | Select-String -Pattern '^## [1-7]\\.').Count)\"; \"WIREFRAME=$(($d | Select-String -SimpleMatch '+--').Count)\"; \"HEX=$(($d | Select-String -Pattern '#[0-9a-fA-F]{6}').Count)\"; \"MUSTS=$(($s | Select-String -Pattern '^#### M[0-9]').Count)\"; \"COVERED=$((($d | Select-String -Pattern 'M[0-9]' -AllMatches).Matches.Value | Sort-Object -Unique).Count)\"", "shell": "powershell", "cwd": "d:\\tempCraftBot\\CraftBot" }
```
**Pass, all five — quote every one of them individually in your ITERATION_LOG line, with their actual numbers, not a prose summary:** `LINES` ≥ 90 · `SECTIONS` = 7 · `WIREFRAME` ≥ 6 · `HEX` = 0 · `COVERED` ≥ `MUSTS`. **A past run reported "R7 EXIT GATE passed successfully: DESIGN_SPEC.md has 128 lines, all 7 required sections present, no banned placeholder words" — three of five metrics, cherry-picked, with WIREFRAME and COVERED never mentioned at all.** COVERED was actually 0 (zero `M1`/`M2`/etc. tags anywhere in the document, against `MUSTS`=6) — an outright fail the report simply never engaged with. Reporting three passing numbers is not the same as the gate passing; if you cannot state a number, you have not checked it, and the gate is not green.
Fail → fix DESIGN_SPEC.md and re-run. Maximum 2 revision loops, then BLOCKED.

---

### R8 — Handoff & launch the creation runner

**"Launch the creation runner" does not mean "build the app."** It means starting a **separate, external OS process** — the standalone Claude Code CLI (step 3 below), a different program from CraftBot entirely. It is **not** CraftBot's own `living-ui-creator` skill, and it is **not** the `living_ui_scaffold` action — never load that skill or call that action from anywhere in this pipeline (FORBIDDEN table, §1). Two separate runs have now reached this exact stage and called `living_ui_scaffold` instead of the `run_shell` command in step 3, registering a real CraftBot project and dispatching a build outside the run folder, using none of the SPEC/DESIGN_SPEC just produced. If you are about to load any skill, or call any action whose name contains "living_ui" or "living-ui", **stop** — that is not this stage. The only correct action here is the exact `run_shell` payload in step 3.

**Sanity-check the timeline before you do anything else.** A genuine R1–R8 run — four real subagents doing live web research, two gated writes, real screenshot capture — realistically takes on the order of an hour or more. If less than ~20 minutes has passed since R1's start timestamp, don't trust your own sense of being done: open every file in the closed artifact list (§0.2) and confirm each one is real, substantive, gated content — not just that the manifest check below finds a file at the path. A past run reached this point 11 minutes after starting and declared success; the manifest check would have failed it in one command had it been run at all.

**Then check ITERATION_LOG.md has actually been kept, not just narrated in chat:**
```json
run_shell: { "command": "(Get-Content 'agent_file_system/workspace/pipeline/living-ui/runs/<run_id>/ITERATION_LOG.md' | Measure-Object -Line).Lines", "shell": "powershell", "cwd": "d:\\tempCraftBot\\CraftBot" }
```
**Pass:** ≥ 16. A run that genuinely logged R1 through R7 (header + one line per stage, several with pasted multi-line gate output) will comfortably clear this. A run sitting near 9 — the header plus only R1's line — means R2 through R7 were run and narrated as "complete" in chat but never actually appended to the file, exactly what happened in run `pokedex-web-app-20260803` (round 2): every stage's gate command was genuinely executed, but the separate, also-mandated step of writing the result into ITERATION_LOG.md was skipped every time after R1. **A chat message saying "stage complete" is not a logged line — only re-reading this file proves it.** If the count is short, go back now and append a line for every stage that's missing one (dated realistically, not backdated to look continuous) before proceeding to step 1.

1. Run the handoff manifest check (paste the full output):
   ```json
   run_shell: { "command": "$r='agent_file_system/workspace/pipeline/living-ui/runs/<run_id>'; foreach ($f in 'SPEC.md','DESIGN_SPEC.md','ITERATION_LOG.md','research/decomposition.md','research/features.md','research/competitors.md','research/ux-patterns.md','research/data-model.md','research/questionnaire.md') { if (Test-Path \"$r/$f\") { \"PASS $f\" } else { \"FAIL $f\" } }; $png=(Get-ChildItem \"$r/reference-shots\" -Filter *.png -ErrorAction SilentlyContinue).Count; $fb=Test-Path \"$r/research/capture-fallback.md\"; if ($png -ge 4 -or $fb) { \"PASS shots ($png png, fallback=$fb)\" } else { \"FAIL shots ($png png, no fallback file)\" }", "shell": "powershell", "cwd": "d:\\tempCraftBot\\CraftBot" }
   ```
   **Every line must say PASS.** Any FAIL → go back to the stage that owns that artifact, fix it, re-run this manifest. (This check looks only in `reference-shots/` — a run that saved screenshots to a differently-named folder will correctly FAIL here with 0 png found; the fix is to move them, not to widen the check.)
2. Append the ITERATION_LOG line: `... | HANDOFF | manifest all-PASS, launching creation runner | next: creation pipeline C1`.
3. Launch the creation runner **pinned to Sonnet 5** — the creation pipeline's judgment calls (spec review, adversarial QA, BLOCKED escalations) need a strong model, and a headless `claude -p` launch has no prior session to inherit a model choice from, so it must be pinned explicitly on the command line or it falls back to whatever the CLI's own default is. Use this payload **exactly** — replace only `<run_id>`:
   ```json
   run_shell: {
     "command": "claude -p \"You are the Living UI CREATION pipeline runner. Read agent_file_system/workspace/pipeline/living-ui/README.md and CREATION_PIPELINE.md in the CraftBot repo and follow them exactly. Mode: CREATE — resume any in-flight creation run first; otherwise find the run under runs/ whose ITERATION_LOG last status is HANDOFF (this one: <run_id>), validate the handoff bundle, and take it to AWAITING_HUMAN_REVIEW. If nothing is in flight or HANDOFF, report that and stop.\" --model claude-sonnet-5 --dangerously-skip-permissions > agent_file_system\\workspace\\pipeline\\living-ui\\runs\\<run_id>\\creation.log 2>&1",
     "shell": "cmd",
     "cwd": "d:\\tempCraftBot\\CraftBot",
     "background": true
   }
   ```
   The response must show `"status": "background"` and a `pid`. Note the pid.
4. **The `wait` action caps at 60 seconds — never request more in one call.** (Run craftdex-20260715 tried `wait: 120` here; the action rejected it outright with `"Maximum wait time is 60 seconds."`, which by itself wasted a chunk of the intended buffer.) Poll instead of one blind wait — check at **20s**, then again at **60s** if still unclear, chaining two ≤60s `wait` calls if you need more runway:
   ```json
   run_shell: { "command": "$p = Get-Process -Id <pid> -ErrorAction SilentlyContinue; $log = 'agent_file_system/workspace/pipeline/living-ui/runs/<run_id>/creation.log'; $bytes = if (Test-Path $log) { (Get-Item $log).Length } else { 0 }; $text = if ($bytes -gt 0) { Get-Content $log -Raw } else { '' }; $err = $text -match 'is not recognized|Invalid API key|not authenticated'; if ($p) { \"HEALTHY proc_running pid=<pid>\" } elseif ($bytes -gt 0 -and -not $err) { \"HEALTHY finished_fast log_bytes=$bytes\" } else { \"UNHEALTHY proc_found=$([bool]$p) log_bytes=$bytes error_signature=$err\" }", "shell": "powershell", "cwd": "d:\\tempCraftBot\\CraftBot" }
   ```
   This prints exactly one line starting `HEALTHY` or `UNHEALTHY` — that word, not your own reading of the raw output, is the pass/fail signal. **Run craftdex-20260715's actual failure mode**: the doc's old check chained `tasklist /FI "PID eq <pid>" & powershell -Command "..."`, which itself errored (`Invalid argument/option - 'eq'.`) before the model switched to `Get-Process -Id <pid> -ErrorAction SilentlyContinue` — which returned nothing at all (process gone, error suppressed) alongside an empty log, and the model read that *silence* as a pass and declared success. Both are UNHEALTHY by definition; `-ErrorAction SilentlyContinue` suppresses the error text, not the fact that nothing was found — never treat an empty/silent result as healthy. If healthy at the 20s check, stop polling and move to step 7.
5. **If UNHEALTHY at the 20s check**: retry the launch **once**, same payload, before falling back. A verified-working launch mechanism failing outright twice in a row is what actually warrants the manual fallback, not a single flaky attempt. Re-poll the retry at 20s/60s the same way.
6. If still `UNHEALTHY` after the retry: append a `BLOCKED` ITERATION_LOG line with `reason: research: HANDOFF launch failed — <first error line>` and the log evidence, and include the manual fallback in your final message.
7. Post your final chat message, from this template, then **end the task** (hard-forbidden to keep polling or touching the run folder again):
   ```
   Living UI research complete for <app_name> (<run_id>).
   SPEC.md and DESIGN_SPEC.md passed all gates; handoff manifest all-PASS.
   Creation runner launched (PID <pid>), log: pipeline/living-ui/runs/<run_id>/creation.log.
   The build, QA, and packaging now happen autonomously; you'll get a review
   request with a ZIP to import into CraftBot.
   If runs/<run_id>/ITERATION_LOG.md still shows "HANDOFF" as its last status
   tomorrow morning, the launch died — paste the Creation kickoff prompt from
   pipeline/living-ui/README.md §5 into a Claude Code session to resume.
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
6. Where the data typically comes from: manual entry, import, or sync from another service.
```

### 5.2 SPEC.md template

Copy verbatim; replace `<...>`; keep all headings including their numbers.

```markdown
# SPEC — <App Name> (<slug>)

- Run: <run_id>   Date: <YYYY-MM-DD>
- Source request: original kickoff message (verbatim in ITERATION_LOG header)   Category: <category>

## 1. Summary
<Elevator pitch. Target user. The 2–3 jobs-to-be-done. What research says the
bar is for this category and where this app wins.>

## 2. Scope
**In (v1):** <one line per Must/Should feature>
**Out (explicit non-goals):** <from Constraints + platform non-goals>
**Won't (v1):** <research-suggested features cut by scope caps or by the platform
filter (R4 step 4), one-line note each>

## 3. Collections & data model
| Collection | Fields (name: type) | Relations | Rules | Ingress |
|---|---|---|---|---|
<max 6 collections. Types are PocketBase types only: text, editor, number, bool,
date, select, relation, file, json. Every select field lists every value. Never a
field named metadata. Rules cell says who can read/write given the auth mode.
Every Ingress cell starts with the literal word "Ingress:" and names how records
get in: a user form, a bridge pull from <service> on load/refresh + a scheduled
sync, a file import, or computed from <collection>. State how ordering, file
uploads, and the category's core mechanic are modeled.>

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
<Auth mode (verbatim from the ITERATION_LOG header) and what it implies for
collection rules. Custom operations worth declaring beyond plain CRUD, and which
are destructive. Any connected service reached through the bridge, plus its
scheduled sync cadence. Any in-app AI use. Anything else that changes the
builder's default path. Never "fully client-side" — this platform always has a
PocketBase backend.>
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
<Detail view: modal vs side panel vs drawer. Drag-and-drop incl. touch fallback.
Bulk actions. Keyboard affordances. One entry per SPEC Must that has interaction.>

## 5. Empty / loading / error conventions
<Per list view: what the empty state says and offers. Loading pattern. Error surfacing.>

## 6. Component mapping
| Observed pattern | Kit component (§5.7 only) | Notes |
|---|---|---|
<unmapped patterns: "compose from Card + primitives" or "dropped — <why>">

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

## Category 2: Data & Collections
<the main "things", their fields, relations, select-field values, and where each
collection's records come from>

## Category 3: Features & Functionality
<CRUD scope, search/filter/sort, media, detail views, drag-and-drop, bulk ops,
any in-app AI or connected-service pull>

## Category 4: Layout & Navigation
<single vs multi screen, nav model, content organization, detail drawer vs modal>

## Category 5: UX & Polish
<empty states, responsiveness, specific interactions, keyboard shortcuts>

## Category 6: Users & Access
<auth mode: none (single user, default) or multi-user; if multi-user, which data
is per-account>
```

### 5.6 Vague-phrase expansions & Safe Assumptions

Standard expansions (record which you applied):

| Human says | Expand to |
|---|---|
| "basic user stuff" / "user management" | multi-user mode: email+password login, signup, profile, per-account data |
| "normal/standard layout" | left sidebar nav, main content area, responsive, top header |
| "simple dashboard" | 3–4 stat cards, recent activity list, quick-action buttons |
| "basic CRUD" / "the usual" | create/read/update/delete with confirm dialogs, search/filter, sort by date |
| "make it look good" / "clean design" | modern minimal, system theme, CraftBot tokens, card layout |
| "basic search" | text search on primary fields, filter dropdowns, clear-filters button |
| "drag and drop" | reorder via drag, visual drop indicator, touch fallback (tap-select then tap-target) |
| "tags" / "labels" | colored chips, create/delete, filter by tag, multi-tag per item |
| "notifications" | toasts for CRUD feedback |
| "sync with <service>" | a bridge pull on load/refresh + a scheduled sync operation — never OAuth, tokens, or webhooks |
| "AI" / "smart" | an in-app bridge LLM call on an explicit user action, degrading to a plain message when unavailable |

Safe Assumptions (usable without a source when request and research are silent — record each in SPEC §6 with `source: safe-assumption`):

- System theme preference (light/dark follows OS)
- Responsive design (mobile + desktop)
- Standard CRUD on all collections
- Loading spinners on async operations
- Confirmation dialogs on destructive actions
- Empty states with a helpful message + action button
- CraftBot design tokens for all visual identity
- Search/filter on primary text fields
- Newest-first default sort
- Single user, auth mode `none`

### 5.7 Component vocabulary (DESIGN_SPEC §6 must map to these)

These are the components the builder actually has. Use these exact names; anything else is "compose from Card + primitives" or "dropped".

| Group | Components |
|---|---|
| Shell & feedback | `Shell`, `toast`, `Spinner`, `Progress` |
| Layout & display | `Card` (+ `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`), `Table`, `Badge`, `Tabs` (+ `TabsList`, `TabsTrigger`, `TabsContent`) |
| Forms | `Input`, `Textarea`, `Select`, `Switch`, `NumberInput`, `DateInput`, `SearchInput` (debounced), `TagInput`, `Button` |
| CRUD presets | `EntityForm` (declare fields → validated create/edit form, relation fields become live dropdowns), `EntityTable` (declare columns → live sortable table with row actions + delete confirmation) |
| Overlays & actions | `Dialog`, `Drawer` (slide-over), `DropdownMenu` (⋯ row actions), `Tooltip`, `useConfirm()` |
| Data viz & interaction | `Sparkline`, `MiniBarChart`, `SortableList` (+ `reorderAndSave`), `FileUpload`, `ImageInput` |
| Auth (multi-user only) | `LoginGate`, `useAuth()` |
| Hooks | `useCollection` (realtime data), `useRecord`, `useDebounce`, `useHotkey` |

Prefer `EntityForm`/`EntityTable` for ordinary CRUD surfaces — spec'ing a hand-built form where a preset fits wastes build time and loses validation for free.

---

## 6. When things go wrong (BLOCKED protocol)

Use this from any stage when a bound is hit or something outside your control fails:

1. Append an ITERATION_LOG line with status `BLOCKED` and `reason: research: <one line>`, plus exactly where the run stopped and the failing gate output pasted.
2. Post a message to the human: what happened, what was tried (with the pasted evidence), and 2–3 concrete options. Then **end the task**. Do not keep retrying past a stated bound.

| Failure | Action |
|---|---|
| Kickoff message missing `slug`, `app_name`, or the requirement paragraph | BLOCKED — never guess intent fields (if the run folder doesn't exist yet, there's nothing to log; just tell the human directly) |
| `where claude` empty, or node below v24, at R1 | Tell the human directly and stop (R1 step 3) — nothing to log yet |
| A research lane still <30 lines after its one retry | BLOCKED with the line counts |
| SPEC or DESIGN_SPEC gate still failing after 2 revision loops | BLOCKED with the gate output |
| The request's core feature is impossible on this platform (needs a webhook, a login to a third-party service, or a browser permission) and has no bridge equivalent | BLOCKED with 2–3 concrete re-scopes, before writing the SPEC — not after |
| All 4 capture rungs attempted, nothing capturable | NOT blocked — write capture-fallback.md, proceed text-derived (R6.4) |
| `claude` launch fails at R8 | BLOCKED with the first error line from creation.log + manual-fallback instructions |
| Anything else not on this table | BLOCKED — escalate with options rather than improvise past a rule |

A resumed run (fresh session, a run's last logged status is `RESEARCHING`/`SPEC_READY`): read its ITERATION_LOG bottom-up, find the last stage whose EXIT GATE output is pasted, verify that artifact actually exists, log a `RESUMED` line, continue from the next stage.
