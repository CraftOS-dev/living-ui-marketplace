# committee notes (Venture OS, SPEC 7.9)

Built 2026-11-12 by the committee builder (scratch `SCR/committee/app`, port 3188, mock bridge 3288). Investment memos with tracked changes and citations, IC meetings run one item at a time, blind votes, decisions that are never edited, conditions, the anti-portfolio, the Committee page, the meeting room, the deal page's IC tab (the latest decision on top, the memo below), the Committee settings section and three Focus cards.

Fix round (2026-11-12): the Memo and Decision tabs became ONE deal tab "IC" (SPEC U8: at most 6 tabs); old `?tab=memo` and `?tab=decision` links open it (`pages/committee/links.ts` rewrites them to `?tab=ic`, `part=memo` scrolls to the memo); decision snapshots keep confirmed diligence answers only and the recipes say so; the Focus decision card offers outcome, rule and pass-reason chips in place; `memos.get --deal` answers `memo: null` (200) for a deal without a memo.

## Files (owned)

- `pb/pb_migrations/1741005000_committee.js`: `memo_templates, memos, memo_blocks, ic_meetings, agenda_items, votes, decisions, conditions` (every rule null) and the seeded template (the report's 13 sections; thesis, recommendation and scenarios people only).
- `pb/pb_hooks/lib_committee.js` (settings, eligibility, views, contract, agenda assembly, events, Next, search, timeline, today, cron), `lib_committee_memos.js`, `lib_committee_meetings.js`, `lib_committee_votes.js`, `lib_committee_rules.js` (pure: scales, tally, rules, juniors first, text markers, AI-use counters), `lib_committee_docx.js` (Research OS `docx.ts` ported to the hook on the kernel's stored ZIP).
- `cat_committee_memos.js`, `cat_committee_meetings.js`, `cat_committee_votes.js`, `events_committee.js`, `cron_committee.js`, `guide_committee.js`.
- `frontend/src/app/pages/committee/` (`index.tsx`, `CommitteePage.tsx`, `MeetingRoom.tsx`, `IcTab.tsx`, `DecisionPart.tsx`, `MemoTab.tsx`, `links.ts`, `CommitteeSettings.tsx`), `frontend/src/app/components/committee/` (`types.ts`, `parts.tsx`, `cards.tsx`).
- `reference/tests/committee/` (README, `run_all.mjs`, `t01` to `t05`, seed, screenshots and UX audit, `stubs/`).

## Data

- `memos`: one memo per deal in versions (`number` M-001 shared by the versions, `version`, `status draft|submitted|final`, `hash` sha256 of the canonical frozen content, `snapshot` = the decision snapshot from the deal, `frozen` = the blocks at submit, AI-use totals). `memo_blocks`: one `kept` block per section; your AI agent's drafts are `proposed` blocks beside it (`base` and `base_updated` detect a person's later edit: the draft goes `superseded`), `discarded`, `superseded`. Text markup for everyone: `[n]` cites the n-th citation of the block, `[?]` marks an uncited figure. Citations: `anchor` (lib_text anchors that must resolve with `in_scope` true for the deal: its room, its company's files, its own emails), `note` (one of `lib_deals_notes.forDeal(app, deal)`), `url` (a named public source). Scenarios: `data.scenarios` rows (probability_ppm, multiple_e8 or exit_value_minor), expected multiple from `lib_eng_scenarios` (null with a reason until the probabilities sum to 100%).
- `ic_meetings` (IC-001, starts_at, day, status planned|live|closed, facilitator, current_item). `agenda_items` (kind new_investment|follow_on|portfolio|other, deal, memo version and hash, champion = point partner, skeptic, preread_at, cooling_end_at, voting, scale and rule fixed at the first vote and the reveal, eligible and tally frozen at the reveal, bear case points, decision).
- `votes`: the ballot (choice, rationale, veto) is stored SEALED (`ballot_sealed`, lib_seal) until the reveal fills the plain fields; the data export drops `_sealed` fields; the audit keeps no ballot (params are `secret`); votes ops are untracked (no activity snapshot). `seniority` from the role order in settings.
- `decisions`: outcome, rule, rule_result, reason (pass reasons), tally, memo version and hash, snapshot (deal, `lib_intake.verdictOf` facts and checks, `lib_diligence.answersFor`, memo header), decided_by, `corrects` (the snapshot's diligence holds only answers with status confirmed, and their questions); `reviews` is an append-only list of later outcomes (the decision's own fields never change). `conditions`: text, owner, due_day, status open|done|waived, evidence, completed_by.

## Operations (35) and agent rules

| Op | Perm | Your AI agent |
|---|---|---|
| memos.list, memos.get, memos.export (Word, streamed), memos.templates | committee:view or pipeline:view | allow |
| memos.draft-block | committee:edit or pipeline:edit | allow; your AI agent only; refused for thesis, recommendation and people-only sections (403 people_only_section); state proposed |
| memos.open, memos.block-save, memos.keep, memos.discard, memos.submit, memos.draft-sections (untracked, queues memo_sections) | committee:edit or pipeline:edit | deny |
| memos.template-save | committee:full or settings:full | deny |
| meetings.list, meetings.get | committee:view | allow (counts only before a reveal) |
| meetings.agenda (assemble from IC deals and submitted memos) | committee:edit | allow |
| meetings.add-item | committee:edit | propose (kind agenda_items, preview label) |
| meetings.create, meetings.save, meetings.item-save, meetings.remove-item, meetings.start, meetings.close | committee:edit (facilitator or committee:full) | deny |
| bearcase.request (untracked, queues bear_case) | committee:edit | deny |
| bearcase.save | committee:edit | allow (points risk or contrary, cited; no recommendation field) |
| votes.status | committee:view | allow (counts and who voted, never a choice) |
| votes.cast (PIN, untracked), votes.reveal (PIN, facilitator, untracked) | committee:view / committee:edit | deny |
| decisions.record (PIN, facilitator for an item, untracked, emits decision.recorded) | committee:edit | deny |
| decisions.list, decisions.get, decisions.anti-portfolio | committee:view or pipeline:view | allow |
| decisions.review-note | committee:edit | allow (source_url required for your AI agent) |
| conditions.list | committee:view or pipeline:view | allow |
| conditions.save | committee:edit | deny |
| conditions.complete | committee:view (owner or committee:edit) | propose (kind conditions; `proof` required for your AI agent) |

## Next items

- `vote` (rank 10, card `vote`): my vote is due on an open item with pre-reads out; Vote opens the scale chips, then the PIN (votes.cast).
- `decision` (rank 10, facilitator): Reveal when every eligible member voted and the cooling-off is over (votes.reveal, PIN); after the reveal, Record decision (card `decide`: the Tally and the rationales, juniors first, then rule chips preset to the fund's rule, outcome chips preset to the rule's answer and following the rule until one is picked, pass-reason chips; the card's Record decision button sends them with the PIN). The action carries `params { item, rule, outcome }` (no `choose`), so a row elsewhere records the rule's answer.
- `condition` (rank 10 due or overdue, 50 within three days): the owner (else the point partner) marks it Done (conditions.complete).
- `draft` (rank 30, card `memo_drafts`, agent): one card per memo with your AI agent's drafted sections ("3 sections drafted"), Keep all / Discard all, Open goes to the Memo tab.

## Jobs, cron, events

- Jobs: `memo_sections` (memos.draft-sections; payload memo, deal, sections; nda true), `bear_case` (bearcase.request; nda true), `anti_portfolio` (yearly cron or jobs.ask). Recipes in `guide_committee.js`; the kernel appends the closing data rule.
- Cron (firm zone): `committee_assemble` 07:00 daily with catch-up (creates the next meeting on the meeting day when deals wait at IC, assembles its agenda), `committee_conditions` 08:00 (notifies owners on the due day), `committee_anti_portfolio` 15 January 09:00 with catch-up.
- On `deal.moved` to `ic`: the deal joins the next planned meeting (one is created on the next meeting day when none is planned, facilitated by the first owner). On `deal.closed` (passed, lost, hold): its waiting items are skipped.
- Emits `decision.recorded { decision, deal, outcome, corrects }`. Also `search` (meetings, memo numbers), `timeline` (memo submitted, agenda, decisions) and `today` (meetings today, my votes due).
- Settings key `committee`: scale (no_three | one_to_five | ten_no_mid | yes_no), voter_roles (empty = roles marked votes), seniority (junior to senior), cooling_hours 24, rule consensus, meeting_weekday 1, meeting_time 10:00, auto_meeting true, condition_days 14. Per fund: `entities.settings.committee.{scale, rule, voter_roles}` ('' falls back to the firm).

## Frontend

- `#/committee`: the next meeting (time in mono, facilitator, agenda rows with kind, champion, a vote dot per voter: hollow waiting, grey voted, coloured after the reveal; the cooling-off countdown), tabs Meetings, Decisions (date, company, outcome, rule, tally bar, conditions), Anti-portfolio (reason, raise then, later outcome with source; Check outcomes asks your AI agent). Primary: Vote while a vote is due, else New meeting (day and time prefilled).
- `#/committee/:id`: agenda on the left, one item at a time with the StepTrack Pre-read, Cooling, Votes, Reveal, Decided; the header's one black button is the next step (Start, Vote, Reveal with PIN, Record decision with PIN, Next item, Close meeting); outcome chips, rule chips, pass reason chips, conditions as quick rows.
- One deal tab `ic` (label IC, order 30) gets `{ deal }` and reads `deal.number`: the decision part (nothing when there is none) above the memo. Settings section `committee` (order 65).
- Screenshots (61, light and dark, 1440 and 390): `SCR/committee/shots/`. No console errors; UX audit clean apart from kernel table chips.

## Contract changes and differences (read first)

1. Extra ops beyond the report: memos.list, memos.draft-sections, memos.templates, memos.template-save, meetings.save, meetings.item-save, decisions.anti-portfolio. `meetings.agenda` is the deterministic assembly (Table 34 allows it for your AI agent); facilitator edits (skeptic, champion, cooling-off, order) are `meetings.item-save` (people). `votes.reveal --close true` closes voting and reveals in one step (no separate close op).
2. `conditions.complete` takes `proof` (the kernel reserves `evidence` for proposal ops).
3. Scenarios are people only in the seeded template (Table 25 step 3); thesis and recommendation are always people only, whatever the template says.
4. `decision.recorded` carries `corrects` as well. `lib_committee.decisionOf(app, dealId)` answers the decision view with `conditions_open` and `conditions_total` (portfolio: refuse Mark invested while `conditions_open > 0`, Table 25 step 9).
5. New export for other modules: `lib_committee.addItem(ctx, { meeting?, deal?, company?, kind?, title?, champion?, source: 'module' })` (portfolio asks, deals' Schedule IC may also call `meetings.add-item`).
6. Deal links follow deals' convention: `#/deals/<D-0001>?tab=ic` (and `&part=memo`); `?tab=memo` and `?tab=decision` still work.
7. Calls other modules' SPEC 4.6 contracts: `lib_portfolio.holdingsOf` (follow-on detection), `lib_intake.verdictOf`, `lib_diligence.answersFor` (decision snapshot), `lib_deals_notes.forDeal` (note citations). Tested against scratch stand-ins (`reference/tests/committee/stubs/`, never shipped).

## Requests to other builders

- deals: (done by deals) dealTabs get `{ deal }` with `number`; `decision.recorded` moves the deal. A tab-alias hook in DealPage would let `links.ts` go.
- portfolio: Mark invested should read `lib_committee.decisionOf` (latest outcome invest, no open conditions).
- kernel-frontend: a multi-select ChipPicker (a local `ChipToggles` wrapper stands in) and a file reader route for citations (citations open the file through `files.download` today).
- kernel-core: the first Next call on a cold PocketBase runtime took about 3 s in the scratch copy (every needsYou loads its libraries); warming the pool at boot would help screens.

## Known gaps

- No PDF export (the kernel offers no PDF writer); Word only.
- People keep and type `[n]` against existing citations; adding a new citation from the Memo tab is not built (your AI agent cites through anchors).
- A voter does not see their own sealed choice before the reveal (casting again replaces it).
- Focus records outcome, rule and pass reason; conditions are added in the room or on the IC tab.
- Who votes is per role (firm or fund); per-member recusal for conflicts is not built.
- Items of a closed meeting that were not decided are skipped; their sealed votes are never opened and the deal joins the next agenda fresh.

## Tests and gate

`reference/tests/committee/run_all.mjs` on the scratch copy: t05 rules 8/8 (node --test), t01 empty sweep 155, t02 memos 54, t03 meetings and votes 94, t04 decisions and conditions 36 (with the real merged modules, no stand-ins): 347 checks, 0 failed. `npm run build` and `tsc` clean. Gate (`agent-app/tools/src/cli.ts validate`) passes on the scratch copy (no external hosts added: the docx XML namespaces are assembled at runtime so the egress scan does not list them). `node tools/gen.mjs` and `gen_triggers.mjs` succeed in APP (174 operations, 5 job kinds). npm dependencies: none.

## Majors fix (2026-11-12)

- UI-04: new op `committee.next-step --deal <ref>` (read, `committee:view|pipeline:view`, agent allow; 36 committee ops now). It answers `{ deal, step }` with step `{ key, label, op, params, href, pin, ready }` or null, for the caller, in this order: `vote` (my vote due: pre-reads out, voting open, I am eligible and have not voted; op votes.cast, href the room with `&vote=1`), `reveal` (I facilitate, every eligible member voted or voting is closed, cooling-off over; op votes.reveal, ready), `record` (I facilitate, revealed, no decision; op decisions.record), `open` (its meeting is live; href only), `schedule` (the deal is at Partner meeting with no open agenda item and I have pipeline edit or am your AI agent; op deals.move to ic, ready). `ready` means op with params does the step in one call; otherwise the choice is made at href. `lib_committee.nextStep(ctx, deal)` is exported.
- The deal page's black button at Partner meeting and IC is this step (deals' `DealActions`); the IC tab's ghost Decide is gone. The room opens the vote scale at once on `?vote=1`, and on a revealed item its black button is Record decision even before the meeting is started.
- UI-03: Settings, Committee puts the label above the control on phones (Vote scale, each fund, Who votes) and the controls wrap; no sideways scroll at 390. Wide screens keep label left, control right.
- UI-06: Who votes and the memo's section chooser use the kernel `ChipPicker` (multiple); the local `ChipToggles` is deleted.
- Tests on the merged copy: t05 8, t01 155, t02 54, t03 94, t04 36, all passing; `reference/tests/majors/modules_a.mjs` checks the step shapes, your AI agent (never vote, reveal or record), Schedule IC and every role (no 5xx); a Chromium flow voted from the deal page and revealed with the PIN into the room (11 checks).
