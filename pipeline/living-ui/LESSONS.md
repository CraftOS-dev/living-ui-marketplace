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

   Max **5 bullets** per entry — distill, don't dump. Tags: `[qa-gap]` (human review caught something self-QA passed — **mandatory whenever that happened**), `[research]`, `[design]`, `[build]`, `[process]`. A clean run records the single line `No new lessons (clean run).`
4. **Dedupe before appending.** If the lesson already exists, don't repeat it — strengthen the existing bullet's wording only during a consolidation pass.

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
