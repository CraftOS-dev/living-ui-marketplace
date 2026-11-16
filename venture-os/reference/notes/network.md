# network builder notes (Venture OS)

Built 2026-11-12 on scratch port 3184 (mock bridge 3284). Relationship capture, strength, intro paths, intros, the
calendar, meeting briefs, research, the Network page, the Company and Person pages, the Today panel and the brief
Sheet, Settings, Capture. 27 operations, 3 job kinds, 4 cron entries, 1 Next kind, 2 import targets. Tests (fix round,
on a fresh copy of the merged APP): 179 backend checks and the UI pass, all passing; `node tools/gen.mjs` succeeds in
APP (378 ops merged).

## Files (all copied into APP)

- `pb/pb_migrations/1741001000_network.js`: `capture_state, cal_events, interactions, strengths, intros, briefs` (rules null).
- `pb/pb_hooks/lib_network.js` (firm view, strength, paths, contracts, reads, timeline, search, app.today, imports, events),
  `lib_network_capture.js` (mail and calendar capture, consent, interactions ops), `lib_network_work.js` (intros, briefs,
  calendar ops, Next items, research queue).
- `cat_network_graph.js`, `cat_network_work.js`, `events_network.js`, `cron_network.js`, `guide_network.js`.
- `frontend/src/app/pages/network/` (`index.tsx`, `NetworkPage.tsx`, `RecordPages.tsx`) and
  `frontend/src/app/components/network/` (`Today.tsx`, `BriefSheet.tsx`, `Paths.tsx`, `Tables.tsx`, `Timeline.tsx`,
  `CaptureSettings.tsx`, `parts.tsx`, `types.ts`).
- Tests: `reference/tests/network/` (see the end).

## Data model

- `capture_state`: kind `firm` (config: capture_address, capture_account, firm_domains, exclude_domains), `member`
  (who, consent opt-in, consent_at, exclude_domains), `source` (mail_owner, mail_firm, calendar: state never, ok,
  partial, offline, error; last_try_at, last_ok_at, cursor with seen Gmail ids and the backfill day, counts).
- `cal_events`: the owner's Google Calendar, one row per event id: title, start_at, end_at, attendees JSON
  `[{ email, name, response, organizer, member, person, external }]`, external, company, deal, status
  (confirmed, tentative, cancelled, gone), ended_at (meeting.ended sent), note_state (none, opened, skipped).
- `interactions`: kind (meeting, call, email, message), direction, at, who (the member), people (relation list),
  company, deal, cal_event, subject, source (gmail, capture_mailbox, calendar, manual, agent, import), ext_id (unique
  when set), body_kept (always false: headers only).
- `strengths`: kind `edge` (who, person), `person` (best edge), `company` (best edge to anyone working there now;
  people_known); score 0 to 100, band, s, counted, last_at, computed_at. Derived data only.
- `intros`: target, target_company, via (the member on the path), connector, path_kind, path snapshot, requested_by,
  deal, note, status (requested, drafted, sent, failed, made, declined, no_answer, cancelled), outbound, job, to_email.
- `briefs`: cal_event (unique), company, deal, person, state (queued, reading, ready, failed; reading and failed are
  also read live from the job), job, sections JSON `{ who: [{ name, email, person, text }], history, deal,
  questions: [], news: [{ title, url, day, source }] }`, prepared_at.

## How it works

- Capture, mail (cron every 15 minutes): headers only (`get_gmail` without the body), owner mailbox and, when
  `capture_account` is set, the capture mailbox (through `account`). Not read at all while nobody opted in. Per
  message: the sender a member (or the Gmail SENT label) is "out" for that member; otherwise "in" for every member on
  To or Cc (the mailbox owner when none is). Only consenting members, never excluded domains (firm list or the
  member's), never firm addresses (members, members' work domains, firm_domains, the capture address). Bulk is skipped
  by structure: SPAM, TRASH, DRAFT and CATEGORY_* labels, List-Id or List-Unsubscribe, Precedence bulk/list/junk, more
  than 25 addresses. New people are created (origin capture; existing records are never changed by capture); free mail
  makes no company (lib_records). ext_id `mail:<Message-ID>:<member>` (one email in two mailboxes counts once).
  Paging (fix round): Gmail's search answers at most 100 ids and has no page token, so the cursor in capture_state walks
  time windows of at most a day (`after:` and `before:` in epoch seconds): forward from `hw` to now (new mail first,
  10-minute overlap), then back from `back` to 30 days ago. A window answering a full page is split in halves (down to
  15 minutes). A window counts as done only when every id was read; read ids are kept (5,000) so a window left at the
  cap is resumed, never read twice. One run reads for at most 15 s (owner two thirds when a capture mailbox is set up)
  or 400 headers; strength of the people touched follows from the minute job; a lock in the app store keeps the cron
  and capture.sync from running at once (`busy`). counts carry `caught_up`, `backfill_days`, `searches`.
- Capture, calendar (cron every 10 minutes): `list_google_calendar_events` primary, two days back to eight ahead.
  Events stored for everyone (Today needs them); people created only when a consenting member attends; past external
  meetings become a `meeting` touch for each consenting member who did not decline. External meetings starting within
  18 hours get a brief job; an ended external meeting emits `meeting.ended { cal_event, deal, company }` once (within
  two days; older ones end quietly). Events Google no longer returns are `gone`.
- Every bridge answer goes through `lib_mail.answer` (HTTP 200 with `{ status: 'error' }` is an error; 503 offline).
- Strength (lib_eng_strength): recomputed after each capture for the people touched, nightly at 02:35 (catch-up) for
  everyone, and every minute for people an op marked (`markDirty`, so derived rows never join an op's undo unit;
  `interactions.log` answers the new strength computed in place with `scoresFor`).
- Paths (lib_eng_paths): direct paths, then one hop through a person seen in the same thread or meeting as the target;
  person-to-person ties are scored by the strength engine over the touches both shared (a shared email counts as a
  message). Only active members. A one-hop path of a member who knows the target directly is left out.
- Intros: `intros.request` re-checks the path against the ranked paths (409 path_gone otherwise), refuses a second open
  ask (already_asked), picks the recipient (the connector; the member on a direct path; the target when the asker
  knows them), queues `intro_draft`. `intros.draft` makes an outbound draft (kind intro, module network, approver = the
  asker); `outbound.sent`/`outbound.failed` move the intro to sent or failed; `intros.outcome` records made, declined or
  no_answer. A person may draft by hand (the job closes).
- Briefs: `briefs.request` (people and your AI agent), `briefs.save` (your AI agent for its job; a person by hand,
  which closes the job; your AI agent never overwrites a person's brief). The app adds the numbers (strength per
  attendee, best member, stage); a deal hidden from the viewer hides its section.
- Research: `deal.moved` to `first_meeting` queues `research` on the company (ref companies:<id>); on request it is
  `jobs.ask --kind research --ref_collection companies --ref_id <id>` (same job, deduped).

## Operations (27)

| Op | Perm | Your AI agent |
|---|---|---|
| capture.status | signed | allow (read) |
| capture.consent | signed (self only) | deny |
| capture.configure | settings:edit | deny |
| capture.sync | signed (track false; 30 s apart per source kind, 409 too_soon) | allow |
| interactions.list | network:view (subject only to its member and the owner; restricted deals hidden: n) | allow |
| interactions.log | network:edit (ext_id dedupe; only for consenting members) | allow |
| network.strength, network.paths, network.find, network.coverage, network.people, network.companies, network.record | network:view | allow (reads) |
| network.recompute | network:edit (track false) | allow |
| intros.request | network:edit | deny |
| intros.draft | network:edit | allow |
| intros.outcome, intros.cancel | network:edit | deny |
| intros.list, intros.get | network:view | allow |
| briefs.list, briefs.get | network:view (meetings the viewer attends; the owner and your AI agent all) | allow |
| briefs.request | network:view | allow |
| briefs.save | network:edit | allow |
| calendar.list | network:view (my meetings; declined ones left out) | allow |
| calendar.add-note, calendar.skip-note | network:view | deny |

Counts: 20 allow (14 reads, 6 writes), 0 propose, 7 deny (capture.consent, capture.configure, intros.request,
intros.outcome, intros.cancel, calendar.add-note, calendar.skip-note).

## Registrations

- Next kind `note` (rank 60): an external meeting I attended (not declined) ended in the last 7 days with no note
  (deals' `lib_deals_notes.forDeal`: a non-empty note for the event, or one written since it started). Title = the
  meeting's title; chips company and stage; figures Ended, With; actions Add note (`calendar.add-note`, primary,
  answers `{ href }`: `#/deals/<number>?tab=notes&event=<id>`, else `#/companies/<id>?tab=notes&event=<id>`, which
  deals' Notes tab opens on the meeting's note) and No note (`calendar.skip-note`). Generic card (no custom renderer). Intro drafts are the
  kernel's outbound items.
- Jobs: `brief`, `research`, `intro_draft` (recipes in `guide_network.js`, each ends with the data rule; the job's
  ref_id names the brief or the company, so a `jobs.ask` job works too).
- Cron: `capture_mail` `*/15`, `capture_calendar` `*/10`, `strength` `35 2 * * *` (catch-up), `strength_touched`
  every minute.
- Events: emits `meeting.ended`; listens to `deal.moved`, `record.merged` (people, companies, deals: re-points rows
  inside the merge's unit and marks strengths), `outbound.sent`, `outbound.failed`, `job.done`, `job.failed`.
- Search: people by a second email, companies by a second domain (kernel-records already answers names, primary
  emails and domains; no duplicates).
- Timeline: touches (subject to its member and the owner only), intros, briefs. `today`: `{ key: 'meetings', day,
  meetings }`. Imports: `people`, `companies` (header synonyms).
- Frontend: routes `/network`, `/companies/:id`, `/people/:id` (perm network:view); nav order 70 (Waypoints);
  `companyTabs` and `personTabs` Overview (10) and Network (20); Settings section `capture` (80); command "Who knows"
  (`#/network?focus=1`). `components/network/Today.tsx` exports `Today` (rows) and `TodayPanel` (in a panel labelled
  Today) for Home; `BriefSheet` (`event` id, '' closed).

## Contracts (SPEC 4.6)

- `strengthOf(app, personId) -> { score, last_at, best_member }` as specified.
- `paths(ctx, { company | person }) -> [{ path, weakest, last_at, kind, member, connector, target, band, edges, nodes }]`
  (the spec fields plus names for screens).
- `upcoming(ctx, { from_at, to_at }) -> [{ cal_event, start_at, attendees, company, deal, title, end_at, location, meet,
  deal_hidden, brief }]`; meetings the viewer declined are left out.

## Decisions and contract notes

- `calendar.*` for meeting ops (committee owns `meetings.*`).
- Calendar events are read without consent (Today and briefs need them); touches and new people need consent.
- Free-mail contacts are captured (a founder on gmail.com matters); a member can exclude domains.
- Owner of a row in the tables = the member who knows them best.
- `network.record` reads portfolio's `lib_portfolio.holdingsOf` (portfolio viewers): `invested` (true when the firm
  holds the company; on a person page their company), `holdings` (count), `invested_cost` (per currency, company page
  only). The Company and Person pages wait for it and give registry tabs the record with `invested` and `holdings`, so a
  tab's `show` can decide on first render (fix round).
- `briefs.list --deal | --company` (fix round): every brief of that deal or company, latest meeting first (deals'
  Overview). A brief follows its meeting's company and deal when a deal opens after the brief was queued.
- The note check reads deals' `lib_deals_notes.forDeal` (`empty`, `cal_event`, `created`).

## Fix round (2026-11-12)

- `briefs.list --deal | --company`; a brief follows its meeting's deal and company.
- `network.record` carries `invested`, `holdings`, `invested_cost`; Company and Person pages give tabs the record with
  `invested` and `holdings` and render tabs once both reads are in (the Portfolio tab shows on first render).
- Gmail capture pages by time windows with the cursor until caught up (15 s of reading per run, run lock), see Capture.
- `calendar.add-note` answers the deal or company note editor href (`?tab=notes&event=`).
- Kernel audit: no links inside table rows that are links (name and company cells are plain), `hit` on small text
  links (identity row, brief Sheet), selected path rows on `--vo-active` with `--vo-active-hover`, every page, tab and
  section through `lazyPage` (network code left the main chunk; RecordPages wraps registry tabs in Suspense), no
  citations shown by network. `lib_bus.touch('strengths')` after each raw strength delete.

## Requests to other builders

1. kernel-frontend: `runNextAction` follows an `href` the op answers (in progress); `calendar.add-note` answers it.
2. portfolio: the company tab's `show` can read `company.invested` (or `holdings`) instead of its own lazy cache, so
   the Portfolio tab shows on first render.
3. kernel-frontend: the Focus "Skip" button is called Skip, so module actions avoid that word (mine is "No note").

## Known gaps

- Only the owner's Google calendar and mailbox, plus one capture mailbox account; per-member accounts need the host to
  hold them (spike S4). Calls are logged by hand or by your AI agent (`interactions.log`).
- More than 100 messages inside one 15-minute window keep only the newest 100 (Gmail's page with no token).
- After an Undo of a logged touch, strength rows refresh at the nightly run.
- A company note link (`#/companies/<id>?tab=notes`) needs a company tab named notes (deals); without it the page opens
  on Overview.
- On a cold server the first reads take 2 to 4 s (PocketBase starting its JS runtimes); warm reads are 2 to 20 ms.

## Tests (`reference/tests/network/`)

Run against a fresh scratch copy of the merged APP (real deals notes and portfolio holdings). The only scratch stub is
`scratch_stubs/pages/zz_netdev` (a page showing Today and a brief, for ui_shots); it never ships.
`VO_APP=<scratch app> VO_PORT=3184 node run_all.mjs`; `node ui_shots.mjs` after `npm run build --prefix app/frontend`.
The mock bridge runs with `fixtures/` (Gmail headers with SENT, Cc, a promotions label, List-Unsubscribe, an excluded
domain, free mail, an old message; calendar events past, soon, later, internal, declined); t04 runs its own
`mock_paging.mjs` (after: and before: honoured, 70 ms per header).

- t01 empty database (no bridge): every read op of the merged catalog as owner, partner, analyst and your AI agent, no
  5xx; empty shapes; people-only refusals before params; 38 checks.
- t02 capture: opt-in, headers to touches by structure, bulk and exclusions skipped, SENT, Cc members, free mail,
  backfill, subject privacy, calendar touches, ext_id dedupe, strength from the engine, coverage, tables, figures
  (invested false, holdings 0), logging with dedupe and consent, the brief job by the agent token, briefs by hand, the
  note item with deals' real notes (an empty draft keeps it, a saved note clears it), Add note hrefs (deal and company
  note editors), No note, briefs.list --deal and --company, offline and 200-with-error, consent off; 82 checks.
- t03 intros: paths ranking and shape, the intro flow (request, agent draft, Next, approve and send through the mock,
  outcome), refusals, cancel, bounce to failed, drafting by hand, research on First meeting and on request,
  network.record invested and holdings after portfolio's Mark invested, imports (a proposal for your AI agent),
  merges, Ctrl K, restricted deals hidden; 49 checks.
- t04 paging: 260 messages (150 in six hours, more than a page): a run stays under 20 s and stops at its cap, the full
  window is split, the next run resumes, all 260 read once (the bridge counts 260 header fetches), caught up, a later
  run reads nothing; 10 checks.
- ui_shots: empty and seeded pages light and dark at 1440 and 390 (screenshots in `SCR/network/shots/`), word counts,
  one black primary, pointer cursor, hover sweep, no sideways scroll, no console errors, the Portfolio tab of a held
  company on first render; flows: Who knows to Ask for intro (StepTrack in place), consent switch, No note in Focus.

No npm dependencies added.

## Fix 5 (2026-11-13)

- The company page shows `CompanyLogo` (own logo, else website icon, else letter); network editors click it to choose an
  image and get Edit (aria "Edit company"), the shared edit sheet (`components/company/EditCompany.tsx`).
  `network.record` carries `logo_url` and `logo_domain` for a company. The People panel lists founders too
  (`companies.get` people, kernel-records Fix 5).
