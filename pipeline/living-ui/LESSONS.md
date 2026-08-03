# LESSONS — the pipeline's memory

Append-only log of distilled lessons from past runs. **Every runner reads this file in full at the start of every run, immediately after [README.md](README.md)** — it is the mechanism by which the pipeline improves itself without anyone editing the SOPs.

## Rules

1. **Append-only.** New entries go at the bottom. The single exception: when this file exceeds ~150 lines, the retrospective stage (C8) may consolidate duplicate/superseded bullets — that consolidation is itself logged as an entry.
2. **Entries never override the Hard Rules** in README/CREATION/IMPROVEMENT/QA/RESEARCH docs. A lesson that conflicts with a rule becomes a `PROPOSAL:` line for the human to act on (by editing the docs), not a self-granted exception.
3. **Entry format** — one per completed run (or notable blocked run):

   ```markdown
   ## <YYYY-MM-DD> — <slug> (<run_id>)
   - [qa-gap]   <imperative rule, ≤2 lines, naming the failure it prevents>
   - [research] <...>
   - [design]   <...>
   - [build]    <...>
   - [process]  <...>
   - PROPOSAL: <suggested doc change, if any>
   ```

   Max **5 bullets** per entry — distill, don't dump. Tags: `[qa-gap]` (human review caught something self-QA passed — **mandatory whenever that happened**), `[research]`, `[design]`, `[build]`, `[process]`, `[handoff]` (the research bundle got something wrong or incomplete that the creation runner discovered — mandatory whenever SPEC §9 has amendment rows). A clean run records the single line `No new lessons (clean run).`
   **Propagation:** every `[research]`, `[design]`, or `[handoff]` lesson must ALSO be added as a numbered order in [RESEARCH_PIPELINE.md](RESEARCH_PIPELINE.md) §2 Standing corrections — the research runner (CraftBot) reads only that file, so a lesson recorded here alone never reaches it.
4. **Dedupe before appending.** If the lesson already exists, don't repeat it — strengthen the existing bullet's wording only during a consolidation pass.
5. **Entries dated before 2026-08-03 describe the V1 platform** (FastAPI + SQLAlchemy backend, `_template/` scaffolding, `{{PORT}}` placeholders, `test_runner.py`, marketplace PR publish). They are kept for the *failure patterns* they record — weak-model gate rationalization, silently-dropped feedback, shallow specs, handing over a dirty deliverable — all of which recur on any platform. Read them for the pattern, never for the commands; the V2 procedures are in the pipeline docs.

---

## 2026-07-08 — pipeline-bootstrap (seed entry)

- [process] Run `git config --global --add safe.directory <MARKETPLACE_ROOT>` pre-flight; the marketplace repo is nested inside CraftBot's checkout and trips git's dubious-ownership guard, which otherwise fails every git command at C7.
- [process] Resolve skill-reference links from `<CRAFTBOT_ROOT>/skills/living-ui-creator/` — LIVING_UI_GUIDE.md's relative `../CraftBot/...` links assume a sibling layout and 404 here (README §1 table).

## 2026-07-10 — tierlist (tierlist-20260709) — mid-run, human review round 0

- [qa-gap] Hand the human an IMPORT-READY folder, always: human review caught a placeholder-substituted, node_modules-laden folder that all of G1–G7 happily passed — the import into CraftBot threw backend errors and the size blocked upload. Fixed structurally as gate G8 (QA_GATES §7), mandatory before every C6/I6.
- [process] `git checkout <slug>/` is a silent no-op on an untracked folder — commit the app BEFORE running setup_local.py (C4 pre-QA commit) or the documented revert reverts nothing.
- [build] Template-owned files (`main.py`, `ApiService.ts`, `ConsoleCapture.ts`, `StatePersistence.ts`, `index.html`, `vite.config.ts`) can be byte-restored from `_template/` when no commit exists; only `manifest.json` and app files embedding the backend URL need hand-restoring.
- [process] Run 1 cost 124% of a Sonnet session vs ≤80% target. The waste, measured: research reports paid for ~3× (generate → full context transit → re-transcribe), 7 image reads incl. a 390×10,229px full-page capture, ~17 pytest tests duplicating test_runner's auto-CRUD, full gate cascades on frontend-only fixes. Corrections live in README §9; research depth itself was explicitly kept (user decision — quality over cost there).
- [qa-gap] G6 scripts must exercise every SPEC-promised interaction, not just the desktop path: the touch tap-to-place fallback was implemented but initially never driven in a browser; two script bugs also burned re-runs — start from the QA_GATES §9 skeleton.

## 2026-07-13 — craft-calendar (craft-calendar-20260713) — self-QA, human review not yet reached

- [qa-gap] G5 must be checked against `test_results.json`'s own `status`/`errors` fields, never against the agent's summary of it: this run logged "PUT failures are expected test runner fuzzing artifacts" while the file said `"status": "fail"` for all 4 PUT routes. Fixed structurally — G1/G5 now require quoting a scripted pass/fail check (QA_GATES §2), and hard rule 4 (README §0.8 / QA_GATES §0.4) now explicitly covers re-characterizing a red result as non-blocking, not just mechanical test deletion.
- [build] The `_generate_value` anyOf/oneOf-dead-code bug (this run's actual root cause) is the *same* BLOCKER the tierlist run (2026-07-10) found and fixed locally — but never escalated via `PROPOSAL:`, so it silently resurfaced here. Fixed at the source this time: `_template/backend/test_runner.py` patched directly (human maintainer action, not a runner edit) and the impact matrix now makes the `PROPOSAL:` line mandatory whenever a template-owned file is patched locally.
- [qa-gap] `LIVING_UI.md` was logged "documentation updated" at the SELF_QA transition while Overview/Requirements still held unfilled HTML-comment placeholders. Fixed structurally — Phase 9, CREATION_PIPELINE C4's exit condition, and QA_GATES G7 all now require quoting `grep -n "<!-- Agent:" LIVING_UI.md` (must be empty) instead of a prose claim.
- [build] `RecurrenceRule.frequency` was implemented as plain `str` despite SPEC.md itself specifying `Literal["DAILY","WEEKLY","MONTHLY","YEARLY"]` — the guide's own "never `str` for enum-like fields" rule was advisory prose with nothing enforcing it. Not yet fixed structurally (no cheap mechanical check for "should this be Literal" without false positives); flagged for G7 human-reviewer attention in the meantime.
- [build] 2 of 4 entities (RecurrenceRule, Reminder) had full typed API-client CRUD methods but zero UI wired to reach them, plus `data as any` casts on 3 of 4 API calls bypassing TS type checks — neither is caught by G4 (build succeeds) or G5 (routes exist). Fixed structurally — QA_GATES G7 checklist now requires a `grep -rn "as any" frontend/` pass and a per-SPEC-entity UI-reachability check.

## 2026-07-13 — tiermaker (tiermaker-20260713) — self-QA, human review not yet reached

- [process] Stage C4 scaffolded via the `living_ui_scaffold` action instead of `cp -r _template/ <slug>/` — it copies a *different* template (`app/data/living_ui_template/`) into `agent_file_system/workspace/living_ui/<slug>_<hexid>/` with no `setup_local.py` and no placeholders, silently breaking every downstream marketplace-layout assumption (G8's audit, QA_GATES §1, the eventual PR path). This is what made `setup_local.py` "go missing" at QA setup — a process error two stages upstream, not a QA-stage problem. Fixed structurally — C4 now runs a mechanical `test -f setup_local.py` check right after scaffolding and explicitly forbids calling `living_ui_scaffold`; QA_GATES §1 now points back to this instead of inviting a manual-setup workaround.
- [build] `app/data/living_ui_template/backend/test_runner.py` had the identical anyOf/oneOf dead-code bug as the marketplace template (craft-calendar entry above) — confirmed as the same root cause of this run's G5 PUT 422s (`tier_id`/`position` sent as `"test"`). This run's G5 dismissal ("test harness noise, not real application bugs") predates this session's QA_GATES hardening, so it's corroborating evidence, not a sign the fix failed. Fixed at the source: `app/data/living_ui_template/backend/test_runner.py` patched directly (human maintainer action) — this template is higher-traffic than the marketplace one since it's also what ordinary non-pipeline chat-driven builds use.
- [build] TypeScript null-safety errors in `AppController.ts`/`MainView.tsx` were resolved legitimately with `!` non-null assertions inside a closure where an outer guard already established non-null — not a shortcut, no fix needed. Noted here only so a future run isn't second-guessed for the same correct pattern.

## 2026-07-14 — pipeline-split (maintainer entry, no run)

- [process] The pipeline is now two pipelines: RESEARCH_PIPELINE.md (R1–R8, runner = CraftBot, weak model) produces SPEC/DESIGN_SPEC and launches the creation runner headless (`claude -p`, status `HANDOFF`); CREATION_PIPELINE.md (runner = Claude Code) starts at C1 claim-of-HANDOFF and C2 bundle-validation/spec-review. RESEARCH_AND_DESIGN.md was folded into RESEARCH_PIPELINE.md and deleted. Motivation: the weak model executes research acceptably under mechanical gates but cannot be trusted with build/QA judgment (see 2026-07-13 entries); the strong model is now reserved for the phases that need it.
- [process] New tag `[handoff]` + propagation rule added above: research-relevant lessons must be mirrored into RESEARCH_PIPELINE §2 Standing corrections by C8, because the research runner reads nothing else.

## 2026-07-14 — queue removed (maintainer entry, no run)

- [process] Per mentor feedback (usage doesn't warrant a multi-request queue), the `queue/` folder, `REQUEST_TEMPLATE.md`, and the front-matter schema (priority/claimed_by/requested/etc.) are gone. [NEW_APP_PROMPT.md](NEW_APP_PROMPT.md) is now the single fill-in-and-paste entry point (folds the old separate `## References`/`## Constraints` sections into the requirement paragraph), and `runs/<run_id>/ITERATION_LOG.md` is the **sole** state store — its last logged status line is the run's current status, and its header captures the original ask verbatim since there's no request file to fall back on. The state machine and stage docs (R1–R8, C1–C2) are otherwise unchanged, just re-pointed from "edit the queue file" to "log a line."
- [process] `RESEARCH_AND_DESIGN.md` (deleted in the v1.5 split) reappeared in the workspace between sessions with no clear cause — deleted again. If it keeps coming back, check whether something (a stale worktree, a sync script) is restoring it before assuming it's a one-off.

## 2026-08-03 — v2-migration (maintainer entry, no run)

- [process] The platform is now **Living UI V2** (`living-ui-v2/`): one PocketBase process serving a React frontend built from a vendored kit, scaffolded by `lui create`, gated by one `lui validate`, with hash-enforced file ownership. Every V1 mechanism the pipeline was built on is gone — `_template/` + `cp -r`, `setup_local.py`, `{{PORT}}`/`{{PROJECT_ID}}` placeholders, FastAPI/SQLAlchemy, `test_runner.py`, pytest, and the marketplace git-PR publish. `LIVING_UI_GUIDE.md` and `LIVING_UI.md` were deleted from this folder; [living-ui-v2/docs/agent-guide.md](../../../../living-ui-v2/docs/agent-guide.md) is the build ground truth now. Rule of thumb for reading anything older than this entry: keep the failure pattern, discard the commands.
- [process] Gates went from G1–G8 to **G1–G7**. `lui validate` alone replaces old G1–G4 (deps policy, tsc, Vite build, migrations on a fresh DB, ops structure + route matching, ownership hashes) and reports the offending source line per failure. G8's placeholder-restore procedure is deleted outright, not ported: V2 has no placeholders after scaffold, and CraftBot's ZIP import reassigns id/port and re-runs `kit-sync` itself — the old restore dance would corrupt the manifest rather than protect it.
- [process] The deliverable is now **an importable ZIP** at `runs/<run_id>/deliverable/<slug>.zip`, built by `scripts/package.py` (mirrors CraftBot's own `export_project_zip` skip rules) and proven by `scripts/audit.py` (`G7-PASS`). The app itself is built at `runs/<run_id>/app/`, so a run is entirely self-contained. **Never build the ZIP with PowerShell** — `Compress-Archive` / `ZipFile::CreateFromDirectory` on Windows PowerShell 5.1 write backslash path separators (measured: 49 of 52 entries), which violates the ZIP spec; `audit.py` fails the gate on that signature.
- [build] Two environment facts the migration dry-run established, both of which silently degrade a gate rather than failing it loudly: (1) `lui verify` / `lui probe` need Playwright resolvable **from `living-ui-v2/`** — otherwise they exit 2 with `{"status":"skipped"}`, which is not a pass; fix with `npm install --no-save playwright` there (gitignored, `package.json` untouched). (2) A QA harness under `runs/` must be **CommonJS + `NODE_PATH`**, because ESM resolves bare specifiers relative to the importing file, not the working directory.
- PROPOSAL: `skills/living-ui-creator/references/*.md` (COMPONENTS, EXAMPLES, INTEGRATIONS, MVC-A, QUESTIONNAIRE, STANDARDS, TROUBLESHOOTING, VERIFY) are still entirely V1 — SQLAlchemy models, MVC-A, `components/ui` imports — even though `SKILL.md` itself migrated and no longer links them. The pipeline no longer depends on any of them (the questionnaire and the adversarial checklist are inlined in RESEARCH_PIPELINE §5.5/§5.6 and QA_GATES §3), but the stale files should be rewritten or deleted at the source. Same for `agent_file_system/GLOBAL_LIVING_UI.md`, which still names react-toastify and `global.css`: the pipeline now takes its palette and enabled rules as binding while explicitly deferring to the kit for mechanism.
