# intake builder notes (Venture OS, the Inbox)

Built 2026-11-12. SPEC 7.6 end to end: every channel into one Inbox (Add deal drop, the global drop, the Gmail sweep of the deals label, scouts, CSV deal lists, sourced items from your AI agent), the reply SLA in business days, triage by your AI agent (facts with grade and page anchor, missing standard slides, questions, prior history), deterministic thesis fit, the verdicts (Advance, Pass, Hold, Merge, Reopen, Keep), the pass email drafted by your AI agent and sent through kernel outbound, revisits, scouts, search, timeline, the deal page's intake view. 23 operations, 3 job kinds, 2 cron jobs, 4 collections, the Inbox page, the Add deal dialog, the global deck drop, the Focus card `triage` and the Intake settings section.

## Files (copied into APP)

- `pb/pb_migrations/1741002000_intake.js`: `scouts`, `intake_items`, `facts`, `passes` (every rule null).
- `pb/pb_hooks/lib_intake.js` (items, add, list, card, verdicts, history, Next, search, timeline, today, events, CSV row), `lib_intake_triage.js` (triage ops, fact values and anchors), `lib_intake_pass.js` (pass, pass email, template, revisit), `lib_intake_mail.js` (Gmail sweep, intake settings view), `lib_intake_scouts.js`.
- `pb/pb_hooks/cat_intake_items.js`, `cat_intake_triage.js`, `events_intake.js`, `cron_intake.js`, `guide_intake.js`.
- `frontend/src/app/pages/intake/*`, `frontend/src/app/components/intake/*` (see Frontend).
- `reference/tests/intake/` (t01 to t04, `seed.mjs`, `lib.mjs`, `ui.mjs`, `run_all.mjs`).

## Data model

- `intake_items`: number `IN-0001` (settings.seq), channel `email|upload|scout|csv|sourced`, status `new|held|passed|advanced|merged`, step `received|reading|facts|ready` (the StepTrack; Reading is also shown while the triage job is claimed), triage_state `none|waiting|working|done|failed`, triage_job, triage_note, name (company name, else the email subject, file name or guessed domain), one_liner, company, guess_domain (the sender's or website's work domain before a company is set: a guess never creates a company), website, source_person, scout, submitted_by, thesis, url and link_kind `docsend|papermark|drive|website` (by host), licence `public|internal_only` (markets' licensed sources; never in LP outputs), text (email body or pasted text), message_id (unique when set), thread_id, email_from, email_subject, received_at, reply_due_day, files (ids, they survive the move to the deal room), people `[{person, role}]`, missing (slide keys), questions, hold_until, revisit_day, decided_by, decided_at, deal, pass, merged_into, note, prov, run, actor, member.
- `facts`: one row per (item, key), key from `lib_theses.FACT_KEYS`, value JSON (money in minor units, percents in ppm), currency (money), grade, num_kind, status `agent_proposed|confirmed`, source `deck|email|public|person`, file, page, quote, anchor (lib_text anchor: a page anchor for deck facts whose page has text; a message anchor for email facts), url, note, run, actor, member.
- `passes`: item, company, reason `team|market|product|traction|valuation|thesis_fit|timing|other`, criterion, revisit_milestone, revisit_day, revisit_state `none|open|reopened|kept`, note, email_state `none|waiting|draft|sent|failed|cancelled` (shown from the outbound message's status when there is one), outbound, to, job, snapshot (facts and fit at the time, for the anti-portfolio), decided_at, actor, member.
- `scouts`: name, email (unique when set), person, account (member), status `active|paused`, note, actor, member.

## Operations (23) and agent rules

| Op | Perm | Your AI agent |
|---|---|---|
| intake.list, intake.get, intake.settings, scouts.list, triage.fit, passes.list | intake:view | allow |
| intake.verdict | pipeline:view or intake:view (deal visibility) | allow |
| intake.add | intake:edit (files: multipart `file`; `--paths` for your AI agent; bodyLimit 200 MB) | allow (channel sourced) |
| intake.sweep | intake:edit, track false (bridge) | allow |
| triage.start, triage.facts-save, passes.draft | intake:edit | allow |
| intake.merge | intake:edit | propose (kind `merges`, promotable) |
| intake.update, intake.advance, intake.pass, intake.hold, intake.reopen, intake.keep, intake.retriage, triage.confirm, passes.write, scouts.save | intake:edit | deny |

Scouts (role `own_items`) see and add only their own items; every verdict, fact save, sweep, pass list and scout change refuses them (403).

## Contracts (SPEC 4.6)

- `lib_intake.add(ctx, { channel, company?, url?, files?: [{ path, name }], text?, source_person?, scout?, thesis?, name?, website?, received_at?, licence? })` -> item view (licence `public` default or `internal_only`; anything else 400). `files` paths are your AI agent's (lib_files.add checks them) unless `trusted: true` (hook-held paths: the sweep uses lib_files.fromPath). Markets: call it with `channel: 'sourced'`.
- `lib_intake.verdictOf(app, itemId)` -> `{ item, licence, status, facts, figures, checks, missing, questions }` (checks = one entry per active thesis: `{ thesis, state, counts, required, checks }`). Op `intake.verdict --deal` wraps it for the deal page (deal visibility checked).
- Events: `intake.added { item }`, `intake.ready { item }`, `intake.advanced { item, deal }`, `intake.passed { item, pass }`.
- Subscribes to: `file.added` (an intake item's file: remembered, triage queued), `job.done` / `job.failed` (triage, fetch_link, pass_draft), `outbound.sent` / `outbound.failed` (pass emails), `record.merged` (companies and people re-pointed in items, passes, scouts).

## Next items

- `verdict` (rank 20, card `triage`): new items whose step is Ready, and held items on their hold day. Actions: Advance (primary), Pass (`choose` reason from the firm's chips), Hold (`choose` days: 1 week, 1 month, 3 months). `data`: item, number, one_liner, due_day, due_state, step.
- `stall` (rank 10, card `triage`): new items past their reply day, read or not; same actions.
- `verdict` (rank 20, generic card): a passed item on its revisit day: Re-open (primary) / Keep passed.
- `draft` (rank 30): a pass email your AI agent could not draft, for the person who passed: Write (passes.write). Drafts themselves come from the kernel (outbound, approver = the person who passed).

## Jobs and cron

- `triage` (an item with a file, an email body or a website), `fetch_link` (a DocSend, Papermark or Drive link alone), `pass_draft` (a pass with recipients and email on). Recipes in `guide_intake.js`; the kernel appends the data rule.
- Cron: `gmail_sweep` every 5 minutes while settings `intake.sweep` is on (Check now in Settings runs it regardless); `reply_due` 08:00 with catch-up: one notification to the people who decide when deals are past their reply day.

## Settings (`settings.modules.intake`)

`reply_sla_days` 5, `sweep` true, `pass_reasons` (the 8 keys, the order and subset the firm uses), `pass_template` ('' = the built-in template with {first_name}, {company}, {reason}, {criterion}, {milestone}, {sender}, {firm}). The deals label is the kernel's `settings.mail.deals_label`. `intake.settings` reads all of it; people change it with `settings.update`.

## Decisions

- Waiting = passed items whose email is not sent yet (your AI agent drafting, a draft, a failed send); it empties when the email is sent or there is none.
- The email sender becomes the source person; a guessed company domain is kept (guess_domain, shown and used for prior history) until your AI agent or a person names the company, so an introducer's firm never becomes the deal's company. Advance without a company answers 400 `company_needed`; the card then asks for the company in one field (Focus mode shows the same field).
- Source on Advance: scout, sourced, other (CSV), inbound when the sender's work domain is the company's, else referral.
- Decks live in folder `Deck`, on the item and then in the deal room (Advance moves every version).
- A person's fact save is `confirmed`; your AI agent never overwrites a confirmed fact (reported back as `kept`), never computes a number (`num_kind computed` refused), and money in another currency than the item's currency fact counts as unknown for fit.
- Thesis chip state per thesis: the required criteria's state when the thesis has required criteria, else unmet when any criterion is unmet, unknown when any is unknown, met otherwise. No score.
- Hold defaults to 14 days; the Next chips offer 7, 30 and 90.
- Email attachments: documents (pdf, pptx, ppt, key, docx, doc); pictures only when no document came (signature logos never become decks).

## Frontend (`pages/intake/`, `components/intake/`)

- `index.tsx` exports `routes` (`/inbox`, the selected deal in `?item=IN-0007`, the segment in `?seg=`), `nav` (Inbox, order 20, count of Next `verdict` and `stall`), `primary` (Add deal: opens the dialog in its own small React root, so it works over any page), `drops` (a PDF, PPTX or Keynote dropped or pasted anywhere is a new deal; the shell opens it), `cards` (`triage`: `{ body, figures: false }`), `settings` (Intake, order 45), `commands` (Add deal, Import a deal list).
- Inbox: a FigureStrip (Ready, Overdue, Reply time: the median business days to a verdict over 90 days, from lib_eng_days), then the list (Segmented New / Waiting / Held with counts, search, 52px rows: company, source, the one-liner, the reply day in mono going amber then red, a compact StepTrack while reading, then thesis chips; scroll pagination; hover reveals a checkbox; bulk Pass with one chip and an Undo toast) and the card. J and K move; A advances, P opens the reason chips (keys 1 to 8, with Criterion behind More), H opens the hold chips. Verdicts are optimistic (`act` with drop and patch) and end with an Undo toast (activity.undo). The verdict bar sticks to the bottom of the card. On a phone the list and the card take turns.
- The card: company and one-liner (Sparkle when your AI agent wrote it), the StepTrack and "Waiting for your AI agent" while reading (a failed read shows its note and Ask again), the figure strip with grade dots, facts with GradeDots and Citations (p.7 opens `DeckSheet`: the PDF page drawn with lib/pdf.ts and the quote marked from anchors.resolve; web and email citations show their source), thesis CheckChips per thesis, missing slides, Seen before, the deck files, the email behind More; after Pass the reason, criterion, revisit and the email: Write it myself, or the draft with Edit and Approve and send; Advanced shows the deal; Held shows its day.
- Add deal dialog: one drop zone and "Paste a link or email" (Enter adds a link); More: company, from, scout, thesis. A dropped deck closes the dialog at once and its row shows at the top of New (optimistic), then the Inbox opens on it.
- Settings, Intake: reply SLA days, deals label, Check email (switch, last check, Check now), pass reasons (checkboxes), the pass template behind More, scouts (name, email, sent / advanced, active switch, add).
- Word counts at rest (light 1440, data excluded): Inbox 21 to 27, empty Inbox 16, Settings Intake 42.

## Tests (`reference/tests/intake/`, port 3185, mock bridge 3285)

- t01 empty sweep: every intake read op (and Next, search, today, guide) as owner, partner, analyst, scout, finance and your AI agent, before setup, empty and with data: no 5xx; the ten people-only ops refuse your AI agent before any param.
- t02 flows (116 checks): the sweep (dedupe, the 200-with-error shape), one drop, links, triage by your AI agent (anchors, grades, refusals: unknown keys, computed numbers, quotes not on the page), fit, Next verdicts, confirm and kept facts, the merge proposal accepted, Advance (deal at Screen, terms, founders, the deck in the deal room, intake.verdict), Advance needing a company, Pass with the drafted email approved and sent once, revisit, Hold, a failed read asked again, fetch_link, scouts, bulk pass and Undo, licence, passes.write, the reply SLA stall, CSV import (synonyms, skip while waiting, history of an earlier pass), search, timeline, settings.
- t03 rules (31): Next actions run as Focus does them (choose values), restricted deals (intake.verdict and history hide them), proposal dry runs, agent limits, a scout's email, company merges re-point items, speed with 120 items (intake.list about 230 ms, next.list about 390 ms).
- t04 UI (143): screenshots light and dark at 1440 and 390 of the empty Inbox, every card state, the Add deal dialog, the pass chips, the deck at the quote, Focus with the triage card, Settings; word counts, pointer cursors, no sideways scroll, no console errors; flows by mouse and keyboard (one drop, A, P then 2, Write it myself, Approve and send, bulk Pass with Undo, the global drop on another page); hover contrast light and dark; a scout's Inbox.

## Known gaps

- Scouts and kernel files: `lib_files` grants intake files by module level (intake view), so a scout could read another scout's deck through `files.get` if they knew its id; `outbound.list` for module intake has the same gap. Needs an own-items check in kernel-records' `ownerRights` (owner intake_items) and kernel-core's outbound `canSee`.
- `lib_files.chain` filters `folder = {:f}`: a file in the root folder (folder '') matches nothing (the PB empty-placeholder gotcha), so `files.move` and versions of root-folder files silently do nothing. Intake keeps its decks in folder `Deck`, which avoids it; kernel-records should write the literal `''` or use SQL.
- No full sweep history (the last run lives in the app store and resets on restart).
- Revisit milestones are text; nothing checks them against later facts.
- Focus mode: Advance on an item without a company answers "Name the company first"; the card body shows the company field to fix it in place.
- A cold scratch server answers its first browser requests slowly (each pooled runtime loads every hook library once; ops took 2 to 5 s until warm, about 20 ms after). Not intake's alone; worth a kernel warm-up of the module libraries at boot.

## Contract changes and requests

- Additions to SPEC 4.6: `lib_intake.add` also takes `name, website, received_at, licence` (licence at markets' request); `verdictOf` answers `item, licence, figures, questions` beside `facts, checks, missing, status`.
- Links to an item are `#/inbox?item=IN-0007` (Next, search, timeline, history).
- For kernel-records: `lib_files.chain` (files.move, versions) misses root-folder files (`folder = {:f}` bound to ''); an own-items check for owner `intake_items` in `ownerRights`.
- For kernel-core: `outbound` reads by module level let a scout (intake edit) list intake drafts; a warm-up of the module libraries at boot would spare the first browser requests seconds.
- `tools/gen_triggers.mjs` must be run once more in APP to fold the intake recipes into triggers.json (kernel-core's file).
- npm dependencies: none.

## Majors fix (2026-11-12)

- M5: a fact quoting a deck marked NDA keeps its verbatim quote only for those who may read that file, the rule `anchors.resolve` applies (`lib_files.canRead`: the deal team; your AI agent only inside a claimed NDA job for that deal). Everyone else gets the quote withheld: `quote: ''`, `hidden: true`, `hidden_reason` (`nda`, `nda_job_required`, `nda_job_invalid`, `not_visible`); value, grade, page and anchor id stay. Applies to `intake.get` (and every card answer), `intake.verdict` and `verdictOf`. Both ops take `--job` (your claimed job). Contract: `verdictOf(app, itemId, { ctx, job })`; without ctx (system work such as the decision snapshot) the facts are whole. Helper `guardQuotes(ctx, facts, job)` exported.
- Tests on the merged copy: t01 24, t02 116, t03 31 passing; t04_ui 141 passed, 2 failed that this fix does not touch (the dropped PDF lands in the Inbox but is not the first row of New; Settings, Intake shows 50 words at rest). `reference/tests/majors/modules_a.mjs` checks your AI agent without a job (nda_job_required), a job that is not its deal's (nda_job_invalid), a member outside the team (nda), the team (quote shown) and Next.

## Fix 3 (2026-11-13): the Inbox card in reading order

- Card (`components/intake/ItemCard.tsx`): logo (`logo_domain` on `intake.get`, '' in a demo firm), name, one line, "From Chris Doyle, 6 Nov" and one reply chip (Reply by, Reply today, Reply overdue, Held until); key numbers only when known; "About the deal" as a label / value list without the figures already shown, its source said once ("From the email", deck pages on hover; each row's source and quote in its tooltip); "Fit with your theses" one line per thesis ("Fits Climate software: 2 of 3 checks met"), checks when opened; "Missing" in words; Open deck / Open email (a sheet) / the link; the verdict bar sticky at the bottom (Pass, Hold, then Advance as the one black primary with tooltips). The Inbox header's Add deal is a plain button (the sidebar keeps the black one).
- List rows: name and received day, the one line on up to two lines, then one thesis chip (best fit) and "+n", "Reply overdue", or the StepTrack with its word. The figure strip is one line: "4 ready to decide", "1 reply overdue", "Typical reply: 43 days".

## Fix 4 (2026-11-13): dividers on the Inbox card

The card is built from the kernel `Sections` and `Section` (a full-width hairline between sections, each title at
the top left, "Source: email" once in the About the deal title row); the top strip shows each figure under its label
with hairlines between. Details: `kernel-frontend.md`, "Fix 4", section Inbox.
