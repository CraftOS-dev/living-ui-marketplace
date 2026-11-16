# committee tests

Run against a scratch copy of the merged app (never the delivered folder, never a live port). `stubs/` holds the stand-ins used before the other modules landed; the merged app needs none. Every API test resets the scratch database and starts it with `tools/dev/serve.sh <app> <port> <bridge port>`.

    VO_APP=<scratch copy> VO_PORT=3188 VO_BRIDGE=3288 node run_all.mjs

- `t05_rules.test.mjs` (node --test): scales, tally, the three rules and the veto, juniors first, text markers, AI-use counters.
- `t01_empty_sweep.mjs`: every committee op refuses nobody; every read as owner, partner, analyst and your AI agent on an empty database (no 5xx); empty answers; people-only ops refuse your AI agent before params and PIN.
- `t02_memos.mjs`: open, typed and pasted counts, the memo_sections job, drafts as tracked changes, thesis, recommendation and scenarios refused for your AI agent, citation scope (another deal's file refused, notes, named public sources), Next card and Keep all, stale drafts, scenarios with the engine, submit and hash, frozen versions, next version, Word export.
- `t03_meetings_votes.mjs`: a deal at IC creates and joins the next meeting, assembly, pre-reads and cooling-off, votes with the PIN, no choice in any read path before the reveal (meetings, votes.status, Next, activity, audit, data export) for every role and your AI agent, reveal refusals, juniors first, the decision from Next, bear case, agenda proposals, removal and close.
- `t04_decisions_conditions.mjs`: decisions outside a meeting, corrections, the anti-portfolio and review notes, conditions in Next and as proposals, per-fund scale and rule, voter roles, restricted deals.
- `t06_nda_quotes.mjs`: a deck read at intake, cited by a confirmed diligence answer and a memo, then marked NDA: the decision snapshot (decisions.record, decisions.get, decisions.list, the anti-portfolio) and memo citations withhold its quotes from your AI agent without a matching claimed job (nda_job_required, nda_job_invalid) and from a partner outside the deal team (nda); the deal team and your AI agent inside its claimed NDA job read them.
- `seed_ui.mjs`, `shots.mjs`, `ux_audit.mjs`: a realistic seed, screenshots of every committee page and dialog (light and dark, 1440 and 390, word counts, black buttons, text under headings, console errors) and the pointer, hover, touch and sideways-scroll audit. They also check that old `?tab=memo` and `?tab=decision` links open the IC tab.
