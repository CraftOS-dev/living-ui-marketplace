# Improvement Pipeline — human feedback to re-review

The standing operating procedure for turning a human's issue list into a fixed, fully re-QA'd build. Runner: **Claude Code** (the creation runner). Entered from [CREATION_PIPELINE.md](CREATION_PIPELINE.md) stage C6 (reply with issues) or a fresh **IMPROVE `<slug>`** kickoff ([README.md](README.md) §2/§5).

Stages: **I1** parse feedback → **I2** clarify (if needed) → **I3** fix plan → **I4** implement → **I5** full re-QA → **I6** re-present. Loops with the human until `APPROVED`.

---

## 0. Hard rules

1. **Every human-reported issue ends in exactly one documented state:** `fixed`, `could-not-reproduce` (with the reproduction attempt as evidence), or `deferred-with-human-approval`. **Never silently dropped.** This mirrors the per-file accounting rule that governs migrations (MIGRATION_GUIDE §0.9) and exists for the same reason: silently curated feedback is how trust in an autonomous pipeline dies — the human stops believing "done" means done.
2. **QA rerun after any code change, scoped by the impact matrix** (QA_GATES §4) — every gate the change class touches, **always ending with G8**. Never skip a gate the matrix names; never hand the human a folder that hasn't passed G8 that round.
3. **Never argue with feedback.** If an issue seems wrong, either reproduce your understanding and ask (I2), or fix it as stated. "Works as intended" is a question for the human, not a disposition the runner assigns itself.
4. **`review_round` increments at the start of every round** and is written to the queue file. **Max 5 rounds** — then §8's exit.
5. **New-feature requests are not bug fixes.** Anything that would add a new entity or a Must-sized feature gets flagged (I3), not smuggled into a fix round.

---

## 1. Stage I1 — Parse feedback

Set `status: IMPROVING`, increment `review_round`, bump `updated`, log entry.

Write `runs/<run_id>/qa/feedback-round-<n>.md`:

```markdown
# Feedback round <n> — <slug> — <date>

Source: <in-conversation reply | IMPROVE kickoff>

| # | Verbatim feedback | Interpretation | Type | Ambiguous? |
|---|---|---|---|---|
| 1 | "<exact words>" | <what will actually change> | bug / change / new-feature | Y/N |
```

Rules: one row per distinct issue even when the human bundled several in one line; the verbatim column is untouched quotation; the interpretation column is falsifiable ("clicking Save on an empty title shows inline validation instead of a toast"), not a restatement.

## 2. Stage I2 — Clarify (only if needed)

If any row is marked ambiguous: ask the human **one batch** of questions covering all ambiguous rows at once (a permitted contact point — this is the one exception to "no questions mid-run", because guessing at feedback wastes a whole round). Concrete options beat open questions ("side panel or modal?").

No ambiguous rows → proceed. Never more than one batch; if the answer is still unclear, implement the most conservative interpretation and say so in I6.

## 3. Stage I3 — Fix plan

Extend `feedback-round-<n>.md` with a plan per issue:

```markdown
## Fix plan

### Issue 1 — <short name>
- Root cause: <found by reading code/logs, not assumed>
- Change: <what, where — files listed>
- Test: <the pytest/browser check that will prove it, added or updated first>
```

- **`new-feature` rows:** if it fits the round (small, no new entity), fold it in and note that. If it exceeds a round's scope, flag it in I6's re-present message with options (defer to a follow-up request in the queue / human approves scope growth). Deferral requires the human's explicit OK → disposition `deferred-with-human-approval`.
- **Suspected non-bugs:** attempt reproduction first. Reproduced → it's a bug. Not reproduced → record the exact steps tried; disposition `could-not-reproduce`, surfaced prominently in I6 with "tell me the steps and I'll take another pass".

## 4. Stage I4 — Implement

Test-first, per the guide's Phases 2–7 pattern (failing test → fix → green), scoped to the fix plan. Additional obligations:

- Data model or endpoint changes → update the app's `LIVING_UI.md` (guide Phase 9 stays true after every round).
- DESIGN_SPEC-relevant changes (layout/interaction feedback) → append a dated amendment to `DESIGN_SPEC.md` so the spec keeps matching the app.
- One ITERATION_LOG line per issue as it lands.

## 5. Stage I5 — Re-QA

Rounds may freely run `setup_local.py` + installs for verification — but execute [QA_GATES.md](QA_GATES.md) per the impact matrix for what the round changed, same bounds (≤5 iterations, 2-strike), fresh `qa-report-<n>.md`. Re-capture `thumbnail.png` only if the main screen visibly changed.

**G8 closes every round, no exceptions**: revert substitutions (`git checkout -- <slug>/` against the pre-QA commit, or the template-byte-restore fallback in QA_GATES §7.3), delete runtime artifacts, run the audit, then commit the round's work on `app/<slug>` (unless the human is holding commits). The human always receives an import-ready folder — run 1's review failed precisely because this didn't happen.

Bound hit → BLOCKED per README §8, with the round's feedback table and final QA report attached.

## 6. Stage I6 — Re-present

Set `status: AWAITING_HUMAN_REVIEW`, log it. Append to `runs/<run_id>/REVIEW_REQUEST.md` and post as the message, then **end the turn**:

```markdown
# Round <n> results — <App Name> (<slug>)

| # | Your feedback | State | What changed |
|---|---|---|---|
| 1 | "<verbatim>" | fixed / could-not-reproduce / deferred-with-your-approval / needs-decision | <one line> |

## How to re-test just these
<per fixed issue: the 1–2 step check>

## Full QA
Gates re-run per impact matrix: <PASS summary from qa-report-<n>>
G8: folder restored to import-ready base state (audit green) — import it as before.

## Open questions
<needs-decision items with options>  (empty → "None.")

---
Reply **APPROVED** to publish, or list remaining/new issues. Round <n> of 5.
```

**Reply routing** (same as C6): `APPROVED` → [CREATION_PIPELINE.md](CREATION_PIPELINE.md) stage C7 (publish), then C8 — **the retrospective must name which of this run's issues self-QA should have caught**, as `[qa-gap]` bullets. Issues → I1, next round.

---

## 7. Self-check per round

- [ ] Every feedback row has a disposition; zero silently dropped (count rows in vs rows out).
- [ ] `could-not-reproduce` rows show the attempted steps.
- [ ] Deferrals have explicit human approval, or are presented as `needs-decision` this round.
- [ ] Impact-matrix gate rerun evidenced in a new qa-report, ending with a green G8 audit (import-ready folder).
- [ ] `review_round` in the queue file matches the round number in the messages.
- [ ] App `LIVING_UI.md`/`DESIGN_SPEC.md` updated if the round changed model/endpoints/layout.

## 8. When things go wrong

- **Round 5 reached without APPROVED:** stop. Present the history (rounds, what changed, what keeps bouncing) and offer: (a) park as BLOCKED for the human to take over the code, (b) human triages the remaining issues to `deferred` and approves, (c) abandon → FAILED. Do not start round 6 on your own authority.
- **Feedback contradicts SPEC/earlier feedback:** the newest human statement wins; note the supersession in the feedback table and update SPEC §6's register.
- **Fix requires touching DO-NOT-EDIT files** (`main.py`, `main.tsx`, `themes.ts`, `_template/`): BLOCKED — that class of fix is a platform change, not an app change.
- **Human replies with a brand-new app idea mid-round:** that's a new queue request — say so, point at `queue/REQUEST_TEMPLATE.md`, finish the current round.
