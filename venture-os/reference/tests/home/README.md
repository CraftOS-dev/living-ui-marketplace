# home tests

Scratch app on port 3192 with the mock bridge on 3292 (`VO_APP`, `VO_PORT`, `VO_BRIDGE` to point elsewhere). Build the frontend first.

- `run_all.mjs`: everything below in order (`--no-seed` when the demo firm is loaded).
- `t02_seeded.mjs`: home.summary on the demo firm (`tools/dev/seed_demo.mjs <app> 3192 3292 --fresh`): Next top 5 and every NextItem kind, Today against calendar.list, inbound, the funnel equal to deals.funnel, Fund I equal to metrics.fund, the fund switch, runways equal to the portfolio engine, roles and hidden blocks, app.today in words, the digest lines, the timing.
- `ui_shots.mjs [--empty]`: Home light and dark at 1440 and 390 with the UX checks (words at rest, five blocks, one black primary, nothing under titles, pointer cursor, hover, phone order and targets, console errors), the Ask bar flow with your AI agent answering through the job ops, Start, Settings Digest.
- `focus_walk.mjs`: Focus mode across every card of the owner's queue (J, K, X, E on a draft, A on a PIN action then Esc), a screenshot per card, phone shots per kind.
- `t01_empty.mjs`: wipes the scratch database: Home on an empty firm for every role and your AI agent, app.today, the digest sent through the mock bridge, every read op of the catalog without a 5xx.
- `t03_perf.mjs`: adds deals up to 5,000 (`VO_DEALS`) and times home.summary warm and right after a change.
- `gen_agent_md.mjs <app> [--port <seeded server>]`: assembles `AGENT_APP.md`.
- `lib.mjs`, `ui_lib.mjs`: harness. Screenshots land in `../shots/` (`VO_SHOTS`).
