# diligence builder notes (Venture OS)

Built 2026-11-12 on scratch port 3187 (mock bridge 3287). SPEC 7.8: checklists from templates, answers your AI agent proposes with citations and a person confirms or rejects with one click, the reader at the quote, references, comparison grids, OCR. 20 operations, 3 job kinds, no cron.

## Files (copied into APP)

- `pb/pb_migrations/1741004000_diligence.js`: `dd_templates, dd_questions, dd_answers, compare_grids, references` (every rule null); seeds the checklists `seed` (51 questions) and `series_a` (68), areas Team, Market, Product, Traction, Financials, Legal, Technology, Customers (6 to 12 questions each, every question typed text, number, yes_no or date; numbers carry a unit: `money` = a currency the answer names, `%`, or a word).
- `pb/pb_hooks/lib_diligence.js` (checklists, questions, answers, confirm/reject, dd.get, Next, events, contract), `lib_diligence_refs.js` (references), `lib_diligence_grid.js` (grids, grid search)
- `pb/pb_hooks/cat_diligence_dd.js`, `cat_diligence_refs.js`, `cat_diligence_compare.js`, `events_diligence.js`, `guide_diligence.js`
- `frontend/src/app/pages/diligence/index.tsx` (routes, dealTabs, cards, settings), `Compare.tsx`
- `frontend/src/app/components/diligence/`: `DiligenceTab.tsx`, `References.tsx`, `Reader.tsx`, `CompareGrid.tsx`, `AnswersCard.tsx`, `TemplatesSettings.tsx`, `parts.tsx`, `compare.ts`, `types.ts`
- `reference/tests/diligence/`: `t01..t05` (backend), `ui_seed.mjs`, `ui_shots.mjs`, `ui_flows.mjs`, `lib.mjs`, `run_all.mjs`

## Data

- `dd_questions`: deal, key (template key; unique per deal when set), template, area, area_label, text, type, unit, sort, source (`template, person, agent, grid`), `state` (`open, proposed, confirmed`) and `answer` (the answer shown) kept by the app, checked_at and check_note (your AI agent looked and did not find it), deleted_at.
- `dd_answers`: question and deal, or a grid cell (grid, company, col_key) of a company without a room; typed value (`value_text`, `value_minor` when the unit is a currency, `value_ppm` for %, `value_e6` for other units, `value_bool`, `value_day`), unit, `num_kind` (quoted, computed with `formula`, external with `sources`, entered), `grade`, `anchors` (ids), `cites` (snapshot: anchor, file, page, quote, nda), `sources` (links), note, `status` (`agent_proposed, confirmed, rejected, superseded`), job, run, confirmed_by/at, rejected_by/at, reason.
- `compare_grids`: name, rows `[{company, deal}]`, columns `[{key, text, type, unit, area, area_label}]`, origin (`deals, markets, manual`), market_ref, deleted_at.
- `references`: deal, person, name, title, company, founder, kind (`provided, backchannel, customer, expert`), signal (`positive, neutral, negative`), note, status (`suggested, logged, dismissed`), why, day, called_by, job.

## Operations (20) and agent rules

| Op | Perm | Your AI agent |
|---|---|---|
| dd.get (checklist, answers, progress per area, room, job StepTrack; `--state open`, `--job` for NDA quotes) | diligence:view | allow |
| dd.templates | diligence:view | allow |
| dd.template-save | settings:edit or diligence:full | propose (kind `templates`) |
| dd.template-apply (default: seed for pre-seed/seed rounds, series_a later) | diligence:edit | allow |
| dd.questions-save (add, change, remove) | diligence:edit | propose (kind `dd_questions`) |
| dd.answer (batch up to 100; one bad item refuses all, each named) | diligence:edit | allow: lands `agent_proposed`, must cite |
| dd.confirm, dd.reject (one or a list) | diligence:edit | deny |
| dd.ask (queue dd_answers now) | diligence:edit | deny |
| refs.list, refs.candidates | diligence:view | allow |
| refs.log | diligence:edit | allow (a call a person described in a note) |
| refs.suggest | diligence:edit | allow |
| refs.dismiss, refs.ask | diligence:edit | deny |
| compare.list (items carry origin and market_ref; filters `--market_ref` one id or a JSON list, `--origin`), compare.get | diligence:view or markets:view | allow |
| compare.save (fills empty cells unless `--fill false`) | diligence:edit | allow |
| compare.fill, compare.delete | diligence:edit | deny |

Answer rules: your AI agent's answer needs anchors (in the deal's citation scope: its room or its company's files; NDA files only with `--job` of a claimed job for that deal) or public source links; grade `artifact` needs an anchor, `public` a link; `computed` a formula, `external` a link; amounts are plain numbers in the named currency (no k or M); a value a person rejected is not proposed again (`rejected_before`); the same value twice changes nothing. A proposal over a confirmed answer waits beside it until a person confirms it. A person's answer (by hand) is confirmed at once (num_kind `entered`). Confirming an answer already replaced answers `stale` (409).

## Next items

- `verify` (rank 40, card `answers`): one card per deal with proposed answers, for its point partner and deal team (everyone with diligence edit when the deal has neither). Figures: To check, High grade. Action: `Confirm N high grade` (dd.confirm with the ids; high grade = artifact or public). `data.answers`: each answer with question text, value, type, raw, unit, grade, quote (hidden for NDA files the person may not open), anchor, file, page, source. href `#/deals/<D-0001>?tab=diligence`.
- `verify` per grid (key `diligence:grid:<id>`) for the grid's maker, href `#/compare/<id>`.
- No `candidate` items.

## Jobs, events, settings, search, timeline

- Jobs: `dd_answers` (ref `deals:<id>`, `nda` on when the room holds NDA files; or ref `compare_grids:<id>` with `payload.cells` for companies without a room, public sources), `refs_suggest` (ref `deals:<id>`), `ocr` (ref `files:<id>`, payload.pages). Recipes in `guide_diligence.js` (the kernel appends the data rule).
- Queued when: a room file's text is ready and the deal has open questions (`file.text_ready`); questions are added while the room has files; a person asks (dd.ask, refs.ask, compare.fill, compare.save); a file ends its text step with pages needing OCR (any file your AI agent may read).
- `deal.moved` into `diligence`: the checklist for the round is applied when the deal never had questions (`settings.modules.diligence.auto_apply`, default true).
- `record.merged`: references and grid rows follow the record kept.
- Search: grids by name (Ctrl K). Timeline: logged references and answers confirmed per day (deal), references given (person).

## Contract

`lib_diligence.answersFor(app, dealId) -> { questions: [{ id, key, area, area_label, text, type, unit, state, answer }], answers: [answer views of confirmed AND agent_proposed answers, each with status, value, raw, unit, grade, num_kind, formula, cites, sources] }`. Committee: use `status === 'confirmed'` for memo facts.

Fix round (coordinator, markets): `compare.list` items carry `market_ref` (the map or thesis id a grid was made from) and the op filters by `--market_ref <id>` or `--market_ref '["id1","id2"]'` (and `--origin`); `compare.save --market_ref` sets it on new grids and changes it on existing ones; `compareCompanies(ids, 'markets', marketRef)` stores it.

Frontend exports for other modules: `CompareGrid` (`components/diligence/CompareGrid.tsx`, `{ gridId }`) for markets; `compareDeals(dealIds, columns?)` for the deals table selection bar and `compareCompanies(companyIds, 'markets', mapId)` for a map selection (`components/diligence/compare.ts`; both create the grid and open `#/compare/<id>`).

## Decisions

- Grid cells of companies without a room are answers stored on the grid and filled by a `dd_answers` job on the grid from public sources, not network's `research` job (that job has nowhere to store cited cells). A company with a room is answered through its deal's questions (missing column questions are added to the room, source `grid`).
- `compare.get` is a pure read; filling empty cells happens in `compare.save` and `compare.fill` (writes).
- Every number on screen comes from typed stored values (minor units, ppm, e6), formatted compactly in the UI ("USD 1.2M"), the exact value in the tooltip.
- The tab's "Ask your AI agent" is a default button with the Sparkle: the deal page header owns the page's one black button. The grid page's black button is its "Ask your AI agent".
- Reject reasons are optional chips on the op; the UI rejects with one click and no reason.
- The reader draws PDF pages with pdf.js (`lib/pdf.ts`, the session token as header) and the anchor's stored rectangles; other files show the stored page text with the passage marked. Confirm and Reject sit beside the value in the reader.

## Tests and results

- Backend (`run_all.mjs`, scratch port 3187, rerun on a fresh copy of the merged APP in the fix round): t01 empty sweep 84, t02 answers 98, t03 references 33, t04 grid 42, t05 OCR and guide 18: 275 passed, 0 failed (every read op as owner, partner, analyst, venture partner, finance and your AI agent on an empty database, no 5xx; agent-denied ops refused before params; proposals accepted from Next; NDA and restricted deals).
- UI flows (`ui_flows.mjs`, headless Chromium): 18 passed (row confirm and reject, confirm in the reader, answer by hand, Confirm all, log a reference by signal click, Suggest names StepTrack, Apply checklist from the empty state, Focus card per-answer confirm and primary, grid), no console errors.
- Screenshots (`ui_shots.mjs`): Diligence tab (answers, job running, empty), reader, answer by hand, grid, Focus card, Settings (edit and read-only), light and dark at 1440 and 390. Words at rest: tab 38, running 34, empty 10, grid 25, Focus card 14, settings 16 to 21. Type scale, cursor, hover sweep and phone checks pass on my screens; one finding outside them (below).
- Frontend: tsc and vite build clean; the merged APP frontend (with committee and funds) typechecks. Gate passes on the scratch copy.
- The scratch copy keeps a scratch-only stand-in deal page (`pages/zz_stub`) to host the tab; it is not in APP.

## Known gaps

- No full-text index over pages; the reader shows one page at a time (no find).
- Checklist editor: no drag reordering; new questions go to the end of their area.
- Suggested reference names do not show who in the firm knows them (network strength not used).
- An owner off a deal team does not see NDA quotes (the kernel NDA rule is the deal team only).

## Problems in other builders' files (not fixed)

1. kernel-core `lib_proposals.dealOf(params)` keeps `params.deal` as given: a proposal made with a display id (`--deal D-0001`, which every deal op accepts) gets `deal = 'D-0001'`, and `canSee` then fails `dealVisible` for everyone, so the proposal never shows in Next. Resolve it with `lib_deals.ref(app, params.deal).id`. (My tests pass the record id.)
2. kernel-frontend Settings frame: the selected section row shows no hover change (hover sweep "no hover" on the active row).
3. The deals module hosts the Diligence tab (dealTabs key `diligence`, order 20) and should link the Files tab as `?tab=files` (the room strip links there); its table selection bar can call `compareDeals`.

## npm dependencies

None beyond kernel-frontend's (`pdfjs-dist` 6.4.299, `lucide-react`).

## Majors fix (2026-11-12)

- UI-05 tab: the answers waiting for a person come first ("To check": one row each, Confirm all, a High grade filter chip when the grades are mixed; Confirm all confirms the rows shown). Then the checklist folded by area: each area row shows its ring (confirmed of total), its counts and a Sparkle count of answers waiting; a click unfolds its questions (waiting first, then confirmed, then open). The ring strip on top is gone (each row carries its ring). Nothing answered yet: one empty state ("No answers yet", Ask your AI agent, an Answer by hand icon that shows the folded areas), or "Waiting for your AI agent" with the StepTrack while the job runs. Words at rest in the tab (QA method): 14 with nothing answered, 32 on Bluefin with 3 answers waiting.
- UI-07 answers card: the tab and Focus share one row (`CheckRow` in parts.tsx): the question above its answer, grade dot and one source chip in their own column (the quote in its tooltip, a click opens the reader), Reject and Confirm. Answers in the text face, mono only for numbers (`AnswerText`). Focus registers `{ body: AnswersCard, figures: false }` (no figure strip; Home's row keeps the To check figure). The card's one primary is the Next item's "Confirm all" (every answer of the card); when only some are high grade the kernel's chips ask "High grade N" or "All N" before it runs: `dd.confirm --grade high` confirms only the high-grade answers of the list and leaves the rest waiting (409 `none_high` when none is). No second button in the body. A filter chip in the Focus body cannot narrow the frame's primary (kernel NextCard runs the item's own params), hence the chips on the action.
- Tests on the merged copy: t01 84, t02 100, t03 33, t04 42, t05 18 (277 passed); ui_flows 22 (areas folded at rest, unfold, nothing answered shows one empty state, one Confirm all on the card); ui_shots clean (type scale, cursor, hover, phone).
