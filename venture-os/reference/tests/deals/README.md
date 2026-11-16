# deals module tests

Scratch app: `VO_APP` (default `../app`), port `VO_PORT` (default 3186), mock bridge port + 100. Each file starts from a fresh database (stop, reset, serve).

The scratch app carries stand-ins that are never shipped: `pb/pb_hooks/cat_zz_stub.js` and `lib_zz_stub.js` (diligence `refs.log`, intake `intake.verdict`, network `briefs.list` and `briefs.get` in their real shapes, and the test helpers `zz.emit` (emit an event as the app), `zz.cron` (run a cron fn now), `zz.backdate` (move a deal's stage entry back N days)). To run these tests against APP, copy those two files into a scratch copy of APP first.

- `t00_funnel.test.mjs` (`node --test`): the pure funnel math of `lib_deals_funnel.js` (cohort conversion, skipped stages, window edges, median days, quarters).
- `t01_empty.mjs`: before setup and on an empty firm: every read op of the whole catalog as owner, partner, analyst, scout and your AI agent (no 5xx); the module's reads answer their empty shapes; people-only and role refusals.
- `t02_notes.mjs`: a First call note written, autosaved and saved; your AI agent reviews it through ops (jobs.next, notes.get, one deals.update proposal per field with its quote, tasks.save, refs.log, notes.summary-save, jobs.done) with the StepTrack states Saved, Reading, Summary, Ready; the partner accepts and dismisses change by change; transcripts (.vtt read by the kernel text step, a new review queued), consent rules, your AI agent's own notes, restricted deals, the meeting draft from meeting.ended, timeline, search, delete and undo, templates.
- `t03_flow.mjs`: funnel figures from real moves, stalls, the stall Next items and their actions (Move with a stage chip, Pass with a reason chip, Snooze), the 08:00 notice once per stall, a merge proposed by your AI agent and accepted (notes, tasks, team move; Undo restores), agent rules, the SPV pipeline on first use.
- `t04_perf.mjs` (slow, not in run_all: 600 deals through ops under the 300 a minute rate limit, about 11 minutes): timing of deals.funnel, deals.board, deals.stalls, next.list and deals.list.
- `seed_demo.mjs`: a realistic deals dataset for screenshots (`--empty` for a fresh firm only).
- `shots.mjs`: Playwright screenshots of every deals page, sheet and dialog (light and dark, 1440 and 390) with console error capture.

`node run_all.mjs` runs t00 to t03.
