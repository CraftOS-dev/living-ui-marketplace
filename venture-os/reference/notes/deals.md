# deals module notes (Venture OS)

Built 2026-11-12 by the deals builder (scratch `SCR/deals/app`, port 3186, mock bridge 3286). SPEC 7.7: the pipeline views kernel-records left open (funnel, stalls, merges), meeting notes with transcripts and the `note_review` job, the stall Next items and cron, the Deals page (funnel strip, board, table, phone rows), the deal page with its Overview, Files and Notes tabs, the company Notes tab, the stall Focus card and the Settings section "Pipelines".

## Files (copied into APP)

- `pb/pb_migrations/1741003000_deals_notes.js`: `note_templates` (seeded First call, Partner meeting, Reference, Board, Free; `stages` = the stage keys a template opens for) and `notes`.
- `pb/pb_hooks/lib_deals_notes.js` (notes, templates, transcripts, review, contract `forDeal`, events, timeline, search), `lib_deals_flow.js` (funnel, stalls, members, merge, decisions, Next, cron), `lib_deals_funnel.js` (pure funnel math, Node tested).
- `pb/pb_hooks/cat_deals_flow.js`, `cat_deals_notes.js`, `events_deals.js`, `cron_deals.js`, `guide_deals.js`.
- `frontend/src/app/pages/deals/` (`index.tsx`, `DealsPage.tsx`, `DealPage.tsx`) and `frontend/src/app/components/deals/` (`actions.ts`, `types.ts`, `FunnelStrip`, `DealCard` (card, peek, phone row), `DealActions` (primary by stage, overflow dialogs), `OverviewTab`, `NotesTab`, `NoteEditor`, `FilesTab`, `PipelinesSettings`, `StallCard`).
- `reference/tests/deals/`: t00 to t04, `ui_flows.mjs`, `shots.mjs`, `seed_demo.mjs`, `run_all.mjs`, `lib.mjs`, README, and `stubs/` (the scratch-only stand-ins the tests need; never in pb_hooks of APP).

## Data model

- `note_templates`: key (unique), name, sections JSON `[{key, label}]`, stages JSON (stage keys), sort, archived, builtin, actor, member.
- `notes`: deal (rel, optional), company (rel), template (key), title, body JSON `{section key: text}` (the person's words), body_text (flattened, for search), meeting_day, cal_event (network's event id as text; unique per deal), consent `informed|not_recorded|unknown`, status `draft|saved`, saved_at, transcript (file id: a `files` row owned by the note, folder Notes, tied to the deal), summary JSON `{headline, sections}`, summary_at, summary_by, review JSON `{proposals, tasks, refs}`, review_job, review_hash, author (rel members), run, deleted_at, actor, member.

## Operations (14) and agent rules

| Op | Perm | Your AI agent |
|---|---|---|
| deals.funnel | signed (visible deals; hidden n) | allow |
| deals.stalls | signed | allow |
| deals.members | signed | allow |
| deals.merge | pipeline:edit | propose (kind merges, promotable; preview) |
| notes.templates | signed | allow |
| notes.template-save | settings:edit | propose (kind templates) |
| notes.list, notes.get | signed (deal visibility; hidden n) | allow (notes.get gives the transcript text) |
| notes.create | pipeline:edit or portfolio:edit (deal: pipeline edit or the deal team) | allow |
| notes.update | same | allow, but a person's note is refused (`not_permitted`): your AI agent changes only notes it wrote |
| notes.attach-transcript | same (multipart field `file`; `--path` for your AI agent; .txt .vtt .srt .docx) | allow |
| notes.summary-save | same | allow |
| notes.review | same | deny |
| notes.delete | same (author or owner; soft delete, Undo) | deny |

Counts: 10 allow, 2 propose, 2 deny.

## Next, jobs, cron, events

- Next kind `stall` (rank 60, card `stall`) for the point partner of each open deal past its stage's stall days: Move (chip of the later stages), Pass (reason chip), Snooze a week; actions carry `done` and `undo` for the kernel to pass through. Key `deals:stall:<deal>:<stage>` (a new stage is a new item).
- Tasks due today are the kernel's (`lib_tasks.nextItems`, action Done); not duplicated. Snooze on them needs the kernel (request below).
- Job `note_review` (recipe `guide_deals.note_review`): queued when a person saves a note (`save true`) with text or a ready transcript, when a saved note's transcript is read (`file.text_ready`), or on `notes.review`. Not queued on a restricted deal your AI agent may not work on (review state `off`), nor twice for unchanged content (`review_hash`). The recipe: notes.get, one `deals.update` proposal per field with `--evidence` (the sentence), `tasks.save` for stated next steps (a vague intention is not a date), `refs.log` for references, `notes.summary-save` with the ids, `jobs.done`.
- Review picture (StepTrack Saved, Reading, Summary, Ready) is derived from the note, its transcript's text state and the job: `draft, saved, reading, waiting, working, summary, ready, failed, off`.
- Cron `deal_stalls` 08:00 firm zone (catch-up): one notification per stall episode to the point partner (ref `deals:stall:<deal>:<stage_entered_at>`, never twice even once read), and empty system drafts older than 30 days are removed.
- Subscribers: `meeting.ended` (an open deal's meeting gets an empty draft in the template its stage calls for, author the point partner; `notes.create --deal --cal_event` answers the same note), `file.text_ready` (transcript read: review), `record.merged` of companies (notes follow), `decision.recorded` (invest: Term sheet; pass and hold: statuses; more_diligence: Diligence; a held deal is reopened before it moves; an invested deal is left alone).
- Emits `note.saved { note, deal }` (each save) and `record.merged { kind: 'deals', keep, drop }` (deals.merge, inside its undo unit).
- `search` (notes by title and text, restricted deals hidden), `timeline` (saved notes of a deal or company).
- Contract `lib_deals_notes.forDeal(app, dealId)` -> `[{ id, deal, company, template, title, meeting_day, cal_event, consent, status, empty, author, actor, body_text, transcript, summary, created, updated }]` newest first. Network and committee already read it.
- `lib_deals_flow.funnel(ctx, { pipeline, quarter, fund })` for home's Deal flow block (same answer as deals.funnel).

## Funnel rules (lib_deals_funnel.js)

One cohort funnel per period: the calendar quarter in the firm's zone (`--quarter 2026-Q4`, default this quarter). Deal flow: the cohort is the intake items received in the quarter (not merged; with `--fund`, items whose deal is in another fund are left out); the first bar Inbound is the whole cohort, then each stage bar counts how many of THAT cohort ever reached the stage or a later one (a skipped stage counts as passed; a deal the caller may not see counts as not reached). Other pipelines: the cohort is the deals created in the quarter, no Inbound bar. Bars only shrink; `conversion_ppm` = a bar over the bar before it (null for the first bar and when the bar before is 0). Median days in stage = median `days_in_from` of moves out of the stage in the quarter (lower middle). 6 Node tests.

`deals.funnel` and `lib_deals_flow.funnel(ctx, { pipeline, quarter, fund })` answer (home draws the same):
`{ pipeline: { key, name, kind }, quarter: { key, start_day, end_day }, stages: [{ key, label, count, conversion_ppm, now, median_days, stall_days }], cohort, open, hidden }`. The first bar of deal flow is `{ key: 'inbound', label: 'Inbound', now: null, median_days: null, stall_days: null }`; `now` = open and held deals in the stage now; `cohort` = the first bar's count; `open` and `hidden` = open deals the caller sees and does not see.

## Frontend

- `routes`: `/deals` (dense, perm pipeline:view), `/deals/:id`. `nav` order 30. `cards: { stall }`. `dealTabs`: overview 10, files 70, notes 80 (the deal object passed to every tab carries `number`). `companyTabs`: notes 80. `settings`: pipelines 40 (settings:edit). `commands`: Deal board, Deals table.
- Deals page: FunnelStrip (count now and the cohort conversion in mono; a local strip because the kernel `Funnel` computes value over value), Board (drag to move with Undo; click opens the peek Sheet with Open), Table (filters Active, Mine, Passed, All; saved views `deals.table`; column picker; scroll paging; with diligence edit, selecting 2+ rows offers Compare through diligence's `compareDeals`). Pipeline Segmented only when there is more than one pipeline. Primary: Add deal through the registry's `primary`. Phone: stage count tiles (tap to filter) and my deals as rows with Move to.
- Deal page: letter avatar, StageTrack (click a stage: one-line confirm, then the move with Undo), status tag, lock, point and team avatars; FigureStrip Round, Raise, Valuation, Check, Ownership (left out when all five are unknown, e.g. SPV deals). Primary by stage: Advance; Diligence and Partner meeting: Schedule IC (moves to IC; committee's `deal.moved` subscriber puts it on the next agenda); IC: none; Term sheet: Mark invested (opens `?tab=investment`); hold: Reopen. Overflow: Assign, Team, Restrict, Pass, Lost, Hold (reason chips), Reopen, Merge.
- Overview: Deal facts (only the known ones), deck facts with GradeDot and page citation, thesis CheckChips and missing slides (intake's `intake.verdict`, called by name through `runOp` so the page compiles before intake lands), the next meeting's brief (network `briefs.list` filtered to the deal; Sheet from `briefs.get`), next steps (tasks; add inline; check to complete), timeline (`records.timeline`).
- Notes: rows with template, headline, pending change count, review StepTrack or Sparkle, author, day; `?note=<id>` opens the editor; `?event=<calendar event>` (network's Add note) opens or makes the meeting's note. Editor: template chips while empty, day, sections with headings as placeholders, autosave 800 ms (a new note is stored on its first words only), consent chips, transcript drop, Save; then the StepTrack, the headline, each change (before to after, quote, Accept or Dismiss; Accept all), the tasks and the summary, in place.
- Files: the deal room (`files.list --deal`), folder chips, drop with an NDA switch, per file open, download, new version, versions sheet, delete with Undo.

## Decisions

- Merging deals soft deletes the duplicate and writes an `aliases` row (kind deals); every moved row and the deletion are one undo unit; other modules re-point on `record.merged`.
- Stall notifications are deduplicated by their own ref, not lib_notify's unread check, so a read notice never repeats.
- Notes are written by people with Deals edit rights or a seat on the deal team (company notes: Deals or Portfolio edit); only the author (or the owner) changes a body.
- Proposed field values in the note show money in the deal's currency and enum codes as words (structural by field name, no text matching).
- Template sections keep their keys when a label is kept; a new label gets a key from its words.

## Known gaps

- `lib_deals.ref` (kernel-records) answers 404 for a soft-deleted deal before reading aliases, so a merged deal's old id does not yet resolve to the kept one (the alias row is written).
- 7 tabs on a deal at Term sheet (Overview, Diligence, Memo, Decision, Investment, Files, Notes) against U8's 6: committee could show Decision only from IC until invested, or portfolio Investment only from Term sheet.
- A transcript attached to a company-only note needs Deals edit (kernel-records' file rights for owner `notes` are pipeline rights).
- No op changes the NDA flag of a stored file; the room sets it at upload (kernel-records could add `files.set-nda`).
- `deals.board` (kernel-records) took 840 ms with 600 deals (per-card lookups); funnel 152 ms, stalls 255 ms, Next stall items 162 ms.
- .docx transcripts rely on the kernel text engine's office reader (not covered by a test; .vtt is).

## Requests to other builders

- kernel-core: `lib_tasks.nextItems` could add a Snooze action (`next.snooze`) beside Done (brief: Done, Snooze); `lib_next` passing `done` and `undo` through (already requested by kernel-frontend) lights the stall Undo toast.
- kernel-frontend: `Funnel` could take a conversion per stage (the cohort figure from an engine) instead of value over value; a shared `useNarrow()` hook (phone width) would save each module its own.
- network: `briefs.list` could take `--deal` (the deal page filters the list by `event.deal`).
- committee: see the tab count gap above.

## Tests (scratch, mock bridge)

`run_all.mjs`: t00 funnel 5 passed; t01 empty 32 (every read op of the whole catalog as owner, partner, analyst, scout and your AI agent: no 5xx); t02 notes 65; t03 flow 47. `t04_perf` 5 passed (600 deals). `ui_flows.mjs` 23 passed in Chromium (drag and Undo, stage track confirm, Advance, Schedule IC, note autosave and Save with the StepTrack, accept and dismiss in place, room upload, stage rename, phone Move to; no console errors). `shots.mjs`: 62 seeded and 20 empty screenshots (light, dark, 1440, 390), no console errors, no sideways scroll; checked again on a merged copy of APP with committee, diligence, network, portfolio, funds and markets. Gate passes on the scratch copy; `tools/gen.mjs` succeeds in APP.

## npm dependencies

None.

## Majors fix (2026-11-12)

- UI-01: the funnel is one cohort per quarter (Funnel rules above): Inbound, then how many of the inbound reached each stage, each percentage its bar over the bar before. The strip (`FunnelStrip`) draws it; the phone stage tiles show the deals in each stage now (`now`) without a percentage. The answer dropped `entered`, `reached_next` and `moved_out` (home's block reads the same answer in batch B).
- UI-04: at Partner meeting and IC the deal page's black button is committee's `committee.next-step` (Vote, Reveal, Record decision, Open meeting, Schedule IC): a ready step runs in place (Reveal with the PIN, then the room shows the tally; Schedule IC moves the deal with Undo), the others open the room on the item. It shows for whoever the step names, not only deal editors. Diligence keeps Schedule IC.
- UI-06: a note template's Opens at chips are the kernel `ChipPicker` (multiple).
- Tests on the merged copy: t00 6, t01 32 passing; t03 48 passed, 1 failed (QA m10: it expects a 404 for a merged deal) with the zz helpers of `stubs/`; t02 stops at `refs.log` "Jane Doe" (QA m10, not touched here). `reference/tests/majors/modules_a.mjs` checks the funnel on the seeded firm (Inbound 31, Sourced 12, Screen 12, First meeting 9, Diligence 4, Partner meeting 3, IC 1, Term sheet 1, Closed 0).

## Fix 3 (2026-11-13): board order, full-height board, plain funnel

- Order: migration `1741009000_board_ranks.js` adds `deals.board_rank` (0 = not placed). `deals.board` orders each column by `lib_deals.BOARD_ORDER`: placed deals by rank, then the rest longest in stage first (unchanged when nobody sorted). `deals.move` sets the moved deal back to 0 (the end of its new column).
- New op `deals.reorder` (people only, tracked: one Undo puts every card back): `--deal`, `--stage` (moves first, as `deals.move`, open deals only), `--before <deal>` (none: the end) or `--index n` (among the deals the caller sees in that column). Every open or held deal of the column then carries rank 1..n. Logic in `lib_deals.reorder` (kernel-records file, sorting only); the op in `lib_deals_flow.opReorder` / `cat_deals_flow.js`.
- The board uses the kernel `Board` `onMove(cardId, toColumnKey, toIndex)`: `components/deals/actions.ts` `placeDeal` shows the card at once (reshape of `deals.board`), sends `deals.reorder` with `before` = the card now at that index, and offers Undo for a move to another stage. `fill` (full page height) is the Board default.
- Funnel strip: "30 inbound", "11 deals", the stage name, then "37% moved on". Deal cards: "USD 3.5M", "12 days"; the point partner sits beside the days (the Board's Move button owns the top right corner). Phone stage tiles: "5 deals".
- Test: `reference/tests/deals/t05_board_order.mjs` (29 checks: sort, index, end, cross-stage move, Undo, agent and status rules, asks order, portfolio.company).
