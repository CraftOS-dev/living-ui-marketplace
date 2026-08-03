# Improvement Pipeline — human feedback to re-review

The standing operating procedure for turning a human's issue list into a fixed, fully re-QA'd build. Runner: **Claude Code** (the creation runner). Entered from [CREATION_PIPELINE.md](CREATION_PIPELINE.md) stage C6 (reply with issues) or a fresh **IMPROVE `<slug>`** kickoff ([README.md](README.md) §5).

Stages: **I1** parse feedback → **I2** clarify (if needed) → **I3** fix plan → **I4** implement → **I5** full re-QA → **I6** re-present. Loops with the human until `APPROVED`.

Notation (README §2): `LUI = node living-ui-v2/tools/src/cli.ts`, `RUN = .../runs/<run_id>`, `APP = <RUN>/app`.

---

## 0. Hard rules

1. **Every human-reported issue ends in exactly one documented state:** `fixed`, `could-not-reproduce` (with the reproduction attempt as evidence), or `deferred-with-human-approval`. **Never silently dropped.** Silently curated feedback is how trust in an autonomous pipeline dies — the human stops believing "done" means done.
2. **QA rerun after any code change, scoped by the impact matrix** (QA_GATES §4) — every gate the change class touches, **always ending with G7**. Never skip a gate the matrix names; never hand the human a ZIP that hasn't passed G7 that round.
3. **Never argue with feedback.** If an issue seems wrong, either reproduce your understanding and ask (I2), or fix it as stated. "Works as intended" is a question for the human, not a disposition the runner assigns itself.
4. **`review_round` increments at the start of every round** and is logged in ITERATION_LOG. **Max 5 rounds** — then §8's exit.
5. **New-feature requests are not bug fixes.** Anything that would add a new collection or a Must-sized feature gets flagged (I3), not smuggled into a fix round.
6. **The V2 ownership rule and migration discipline hold in every round** (README rule 5) — see I4.

---

## 1. Stage I1 — Parse feedback

Log status `IMPROVING`, increment `review_round`, log entry.

Write `runs/<run_id>/qa/feedback-round-<n>.md`:

```markdown
# Feedback round <n> — <slug> — <date>

Source: <in-conversation reply | IMPROVE kickoff>

| # | Verbatim feedback | Interpretation | Type | Ambiguous? |
|---|---|---|---|---|
| 1 | "<exact words>" | <what will actually change> | bug / change / new-feature | Y/N |
```

Rules: one row per distinct issue even when the human bundled several in one line; the verbatim column is untouched quotation; the interpretation column is falsifiable ("clicking Save on an empty title shows inline validation instead of a toast"), not a restatement.

**Note on where the human tested.** They imported the ZIP, so they were running a *copy* with a different project id and port, its own `pb/pb_data`, and a kit re-vendored at import time. Two consequences: (a) "it broke on my machine" reports about ports, ids, or the admin/setup page are import-side, not app-side — reproduce locally before treating them as app bugs; (b) their data is not your data, so an issue about a specific record may only reproduce after you seed the same shape.

## 2. Stage I2 — Clarify (only if needed)

If any row is marked ambiguous: ask the human **one batch** of questions covering all ambiguous rows at once (a permitted contact point — this is the one exception to "no questions mid-run", because guessing at feedback wastes a whole round). Concrete options beat open questions ("side panel or modal?").

No ambiguous rows → proceed. Never more than one batch; if the answer is still unclear, implement the most conservative interpretation and say so in I6.

## 3. Stage I3 — Fix plan

Extend `feedback-round-<n>.md` with a plan per issue:

```markdown
## Fix plan

### Issue 1 — <short name>
- Root cause: <found by reading code/logs, not assumed>
- Change: <what, where — files listed, all app-owned>
- Check: <the gate or browser step that will prove it>
```

- **`new-feature` rows:** if it fits the round (small, no new collection), fold it in and note that. If it exceeds a round's scope, flag it in I6's re-present message with options (defer to a separate follow-up request / human approves scope growth). Deferral requires the human's explicit OK → disposition `deferred-with-human-approval`.
- **Suspected non-bugs:** attempt reproduction first. Reproduced → it's a bug. Not reproduced → record the exact steps tried; disposition `could-not-reproduce`, surfaced prominently in I6 with "tell me the steps and I'll take another pass".
- **Rows that would need a system-owned file** (kit component, `main.tsx`, `manifest.json`, `_system.pb.js`): that's a platform change. Compose a wrapper in `frontend/src/app/` instead; if genuinely impossible, it's a `needs-decision` row plus a `PROPOSAL:` line in LESSONS.md.

## 4. Stage I4 — Implement

Scoped to the fix plan, in app-owned paths only. Additional obligations:

- **Schema changes are new, additive migrations.** The human's imported copy holds *their* data — but so does `<APP>/pb/pb_data` for your own testing. Never edit an already-applied migration, never drop-and-recreate a collection that holds data. To alter a collection, write a new migration that loads it, modifies it, and saves it (`app.findCollectionByNameOrId(...)` → modify → `app.save(...)`). Relation fields still need the target's **id**, never its name.
- **Operations stay declared.** A new or renamed route needs its `operations.json` entry updated in the same change (G1 fails ops without routes, warns about routes without ops).
- **Update `reference/requirements.md`** whenever a round changes features, data, design, or the operations surface. It is the binding spec that travels inside the ZIP — if it drifts, the next agent to touch this app (CraftBot's `living-ui-modify`, or its launch verifier) works from a lie.
- **Update `LIVING_UI.md`** for model/ops changes, and append a dated amendment to `DESIGN_SPEC.md` for layout/interaction feedback so the run's own specs keep matching the app.
- Run `$LUI validate <APP>` as you go; one ITERATION_LOG line per issue as it lands.

## 5. Stage I5 — Re-QA

Execute [QA_GATES.md](QA_GATES.md) per the impact matrix for what the round changed, same bounds (≤5 iterations, 2-strike), fresh `qa-report-<n>.md`. A schema change means the full runtime set (G1–G5) — re-run G2 from a **deleted `pb/pb_data`** so the migration chain is proven from zero, exactly as it will run on the human's next import. Re-capture `thumbnail.png` only if the main screen visibly changed.

**G7 closes every round, no exceptions**: stop processes, thumbnail out, `scripts/package.py`, `scripts/audit.py` → `G7-PASS`, producing a fresh `deliverable/<slug>.zip`. The human always receives an audited ZIP — a round that hands back the previous round's ZIP is a silent regression.

Bound hit → BLOCKED per README §8, with the round's feedback table and final QA report attached.

## 6. Stage I6 — Re-present

Log status `AWAITING_HUMAN_REVIEW`. Append to `runs/<run_id>/REVIEW_REQUEST.md` and post as the message, then **end the turn**:

```markdown
# Round <n> results — <App Name> (<slug>)

| # | Your feedback | State | What changed |
|---|---|---|---|
| 1 | "<verbatim>" | fixed / could-not-reproduce / deferred-with-your-approval / needs-decision | <one line> |

## How to re-test just these
<per fixed issue: the 1–2 step check>

## Re-import
    <RUN>/deliverable/<slug>.zip   (<size>, rebuilt this round)
Import it as a NEW project as before. <If this round changed the schema: your
previous import's data does not carry over — import fresh and re-seed.>

## Full QA
Gates re-run per impact matrix: <PASS summary from qa-report-<n>>
G7: G7-PASS (audited).

## Open questions
<needs-decision items with options>  (empty → "None.")

---
Reply **APPROVED** to finish, or list remaining/new issues. Round <n> of 5.
```

**Reply routing** (same as C6): `APPROVED` → [CREATION_PIPELINE.md](CREATION_PIPELINE.md) stage C7 (package & deliver), then C8 — **the retrospective must name which of this run's issues self-QA should have caught**, as `[qa-gap]` bullets. Issues → I1, next round.

---

## 7. Self-check per round

- [ ] Every feedback row has a disposition; zero silently dropped (count rows in vs rows out).
- [ ] `could-not-reproduce` rows show the attempted steps.
- [ ] Deferrals have explicit human approval, or are presented as `needs-decision` this round.
- [ ] Impact-matrix gate rerun evidenced in a new qa-report, ending with `G7-PASS` and a freshly built ZIP.
- [ ] `review_round` in ITERATION_LOG matches the round number in the messages.
- [ ] `reference/requirements.md` updated if the round changed features/data/design/operations; `LIVING_UI.md` and `DESIGN_SPEC.md` updated if the round changed model or layout.

## 8. When things go wrong

- **Round 5 reached without APPROVED:** stop. Present the history (rounds, what changed, what keeps bouncing) and offer: (a) park as BLOCKED for the human to take over the code, (b) human triages the remaining issues to `deferred` and approves, (c) abandon → FAILED. Do not start round 6 on your own authority.
- **Feedback contradicts SPEC/earlier feedback:** the newest human statement wins; note the supersession in the feedback table and update SPEC §6's register and `reference/requirements.md`.
- **Fix requires touching a system-owned file** (`frontend/src/kit/`, `main.tsx`, `config.gen.ts`, `app.css`, `index.html`, `vite.config.ts`, `tsconfig.json`, `pb/pb_hooks/_system.pb.js`, `_craftbot_bridge.js`, `manifest.json`) or anything under `living-ui-v2/`: BLOCKED — that class of fix is a platform change, not an app change. Record a `PROPOSAL:` line in LESSONS.md so it reaches the maintainer.
- **A gate that was green last round is now red for an unrelated reason** (e.g. `lui validate`'s ownership step): check whether something re-vendored the kit or rewrote a hashed file. `kit-sync` re-canonizes hashes and is the *only* legitimate way that changes — if nothing ran it, an edit landed where it shouldn't have. Revert the edit; don't re-canonize to make the gate quiet.
- **Human replies with a brand-new app idea mid-round:** that's a separate request — say so, point at [NEW_APP_PROMPT.md](NEW_APP_PROMPT.md) (start it only once the current run reaches a terminal state — one request in flight at a time), finish the current round.
