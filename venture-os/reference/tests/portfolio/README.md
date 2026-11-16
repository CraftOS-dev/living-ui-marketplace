# portfolio tests

Run against a scratch copy of the app (never a live port 3100 to 3179):

1. Copy the app without `pb/pb_data`. Until funds and committee are in the copy, add the scratch-only stubs `stubs/lib_funds.js` (markOf) and `stubs/lib_committee.js` (decisionOf) to `pb/pb_hooks/`; they read `pb/pb_data/vo_test_marks.json` and `vo_test_decisions.json`, which the tests write. Never ship them.
2. `node tools/gen.mjs`, `npm run build --prefix frontend` (t04 and the screenshots need the built page).
3. `VO_APP=<scratch app> VO_PORT=3189 node run_all.mjs` (each file resets the database through `tools/dev/reset.sh` and serves it with the mock bridge on port + 100).

Files: `t01_sweep.mjs` (empty and data read sweep, people-only refusals), `t02_invest.mjs` (Mark invested, SAFE vectors, conversion, pro rata, marks, the committee gate, restricted deals, holdings import), `t03_monitoring.mjs` (requests, Gmail sweep, update_extract through the agent token, verify, runway, alerts, asks, board briefs, KPI import), `t04_ui_flows.mjs` (the screens in headless Chromium through playwright-core), `seed_ui.mjs` (a realistic portfolio through ops), `ui_shots.mjs` (screenshots light and dark at 1440 and 390, word counts, console errors, hover sweep; `EMPTY=1` for the empty database), `lib.mjs` (harness).
