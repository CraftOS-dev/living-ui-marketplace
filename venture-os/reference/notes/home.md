# home builder notes (Venture OS, wave 3)

Built 2026-11-12 on scratch port 3192 (mock bridge 3292). SPEC 3.1 (Home, five blocks), SPEC 2 U7 (Next and Focus mode walked across every NextItem kind), SPEC 7.13 (the morning digest, `app.today`'s home block, `AGENT_APP.md`, the trigger regenerated), plus the demo firm `tools/dev/seed_demo.mjs` for QA and demos. 3 operations, no job kinds, 1 cron entry, no collections.

## Files (copied into APP)

- `pb/pb_hooks/lib_home.js` (home.summary, the app.today block, the digest), `cat_home_core.js`, `events_home.js` (`today`, `settingsKeys.home.digest_time`), `cron_home.js`, `guide_home.js`.
- `frontend/src/app/pages/home/` (`index.tsx`: route `/`, nav Home order 10, Settings section Digest order 75, Ctrl K "Ask your AI agent"; `HomePage.tsx`).
- `frontend/src/app/components/home/` (`AskBar.tsx`, `Blocks.tsx` (Next, Deal flow, Funds and portfolio), `DigestSettings.tsx`, `types.ts`).
- `tools/dev/seed_demo.mjs` (the demo firm, through ops only).
- `AGENT_APP.md` (assembled: kernel-core's frame plus one generated section per module).
- `reference/tests/home/` (see Tests).

## Operations (3)

| Op | Perm | Your AI agent |
|---|---|---|
| home.summary | signed | allow (read) |
| home.digest | signed | deny (a person's own digest: settings and today's preview) |
| home.digest-send | signed, track false (sends) | deny |

Turning the digest on is the member's profile preference (`auth.update-profile --prefs '{"digest":true,"digest_link":"<app address>"}'`, kernel op); the Settings section does it in one switch.

## home.summary

`{ today, first_name, next: { items (top 5), total, counts }, meetings, inbound: { weeks[12]: { start_day, count }, total, this_week, last_week }, funnel: { quarter, stages: [{ key, label, count, entered, conversion_ppm }], entered, open, hidden }, fund: { id, name, label, currency, tvpi_e8, dpi_e8, rvpi_e8, net_irr_ppm, paid_in_minor, reasons, curve: [{ quarter, end, net_minor, nav_minor, value_minor }] }, runways: { rows: [{ company, months, as_of_day, zero_day }], companies, unknown, threshold_months, hidden }, hidden: [block], errors: [{ block, error }], ms, timing: { block: ms } }`

- Every number comes from the owning module's contract or op: Next `lib_next.list` (kernel), meetings `lib_network.today` (wraps `upcoming`), inbound from `intake_items.received_at` by week (settings.week_start, firm zone; scouts count only their own), the funnel `lib_deals_flow.funnel` (the deals engine's cohort conversion), fund figures `lib_funds.books/metricsOf/jcurve` (= `metrics.fund`), runways `lib_portfolio.runway` per active holding the caller may see.
- Each block runs alone: a failure is named in `errors` and answers its empty value; a block the role may not see is named in `hidden` and answers null (never read as empty): meetings need network view, inbound intake view, funnel pipeline view, fund funds view, runways portfolio view.
- The fund: `--fund` when given (the sidebar scope), else the member's first scoped fund, else the fund with the most capital called. Runways follow `--fund` when given, else every fund the caller sees.
- J-curve: the LPs' net value by quarter (distributions less calls, plus NAV), from funds' jcurve rows.
- Speed: the funnel (per person), the fund block and the runways are kept in the app store under a fingerprint of the tables they read (row count and last update of deals, stage_events, deal_people, members, pipelines; ledger, marks, holdings, entities, capital_events; kpi_values, holdings, fx_rates, companies) and the firm's day, so they build again only when those rows change; `timing` reports each block's milliseconds.
- Contracts used beyond SPEC 4.6: `lib_deals_flow.funnel` (deals' documented export for Home), `lib_network.today` (network's app.today block, which wraps `upcoming`), `lib_funds.visibleFunds`, `books`, `metricsOf`, `jcurve` (the funds module's own exports behind metrics.fund and funds.get, used for the J-curve in one pass), `lib_portfolio.visible` (holding visibility), `lib_next.list/collect` (kernel).

## Frontend

- Home: title "Good morning|afternoon|evening, <first name>" by the device clock, nothing under it; Start (the one black button) opens Focus mode. Five blocks: the Ask bar (full width), Next (7 of 12 columns) beside Today (network's `TodayPanel`), Deal flow beside the fund. Phone: Ask, Next, Today, Deal flow, fund, stacked.
- Ask bar: one field, placeholder only. Enter sends `chat.ask` (the agent panel stays closed); under the field the question, the StepTrack Queued, Working, Done with "Waiting for your AI agent", then the answer with the Sparkle (followed live through `jobs.get`), a close icon. A link alone (typed, pasted into the empty field or dropped) adds the deal (`intake.add --url`, as the Add deal dialog does) and opens it in the Inbox; files dropped on the bar or picked with the paperclip go to the registry's drop handlers (intake: a deck becomes a new deal).
- Next: the top five as the kernel's `NextRow` (kind icon, title, one figure, the primary action inline; the row opens Focus at that item), the total in mono; empty "All clear".
- Deal flow: inbound per week (BarChart, this week highlighted, this week's count in mono) and this quarter's funnel (deals entered per stage with the engine's cohort conversion; a local strip because the kernel Funnel divides value by value, as deals reported). Empty: "No deals yet" with Add deal (the registry's primary).
- Fund: TVPI, DPI, Net IRR as 26 px mono figures (tooltips explain), the J-curve (LineChart, 112 px), Runway: three rows with the kernel Meter (months, the alert threshold marked, red under it, amber under twice it), each opening the company. Empty: "No capital called".
- Settings, Digest: the switch (off by default; 07:00 in the member's zone) and Send now with its result in place.

## Digest

Cron `home_digest` every 15 minutes: each active member with the preference on gets it once per local day, at or after `settings.modules.home.digest_time` (07:00) in their own zone (members.zone, else the firm's) and before noon; nothing when the bridge is offline or the day is empty. Lines: the day's meetings (time in their zone), items past due (Next kind stall), votes and decisions due, alerts; one line each with a link back (`<digest_link>#/...`, the address the member's browser used when they turned it on). It is a kernel outbound message: kind digest, module the first the member may draft in, to their own address, approver themselves, approved as them (their opt-in is the standing approval), so it is audited, deduplicated per local day and never sent twice.

## Next and Focus mode (walk on the demo firm)

`reference/tests/home/focus_walk.mjs` walks the owner's whole queue on the demo firm (26 cards, every one of the 14 kinds) with J, then K, X, E on the pass email draft (the editor opens) and A on Fund I's marks (the PIN dialog opens, Esc leaves the card in place); a screenshot of every card (light 1440) and one per kind on a phone (dark 390); no console errors. Every card shows the result its module prepared and 1 to 3 actions with A on the primary:

| Kind | Module, card | Shows |
|---|---|---|
| stall | intake `triage` | reply overdue, the one-liner, facts with grades and sources, thesis chips, missing slides; Pass, Hold, Advance |
| condition | committee, generic | due day, deal; Done |
| decision | committee (`decide` after the reveal) | votes 3 of 3, raise, check; Reveal (PIN) |
| vote | committee `vote` | raise, check, memo version, meeting; Vote (chips, PIN) |
| verdict | intake `triage` | as stall |
| proposal | kernel `proposal` | before and after, your AI agent's reason and quote; Dismiss, Accept |
| draft | kernel `draft` | recipient, the full text; Edit (E), Cancel, Approve and send |
| mark | funds `marks` | every holding's draft mark, method, change; Approve all (PIN) |
| payment | funds `payment` | due, call, days late, the paid bar; Remind, Record received |
| verify | portfolio `kpis`; diligence `answers` | each value beside its quote; each answer with its source; Verify all, Confirm high grade |
| alert | portfolio `alert` | runway, threshold, cash, the series; Acknowledge |
| task | portfolio, funds, generic | due or quarter end; Start, Done, Open quarter |
| note | network, generic | ended, with; No note, Add note |
| candidate | markets `candidates` | each candidate with its line and source; Dismiss all, Add all |

Findings are reported to their owners (Requests below); none needed a change in Home's files.

## AGENT_APP.md

`reference/tests/home/gen_agent_md.mjs <app> [--port <seeded server>]` keeps kernel-core's frame (up to "## Modules", op count refreshed) and writes one section per module from the code: the guide section (each module's own words), the operations by group with your AI agent's rule (+ proposal, * people only) and the proposal kinds, the job kinds with each recipe's first line, the Next kinds seen on a seeded server by module, cron, events emitted and listened to, settings keys, import targets; the external data table from manifest.json capabilities. Refuses en and em dashes.

## Demo firm (`tools/dev/seed_demo.mjs`)

`node tools/dev/seed_demo.mjs <app dir> <port> [bridge port] [--fresh]` (about 10 to 15 minutes on a loaded machine; about 900 operations, every one through the catalog; refuses live and shadow ports and a database already set up). With a bridge port it writes `<app>/logs/demo_fixtures/` (the demo calendar relative to now; Gmail empty) and starts the mock bridge on it before the app; `--fresh` stops both, wipes the scratch database (never the delivered folder) and starts them. Every date is relative to today, so the story holds whenever it runs.

- Larkspur Ventures, USD, New York. Team (password demo-pass-1, PIN 123456): owner@venture.test Olivia Hart (owner), partner@ Daniel Reyes and partner2@ Mei Tanaka (partners), principal@ Sam Okafor, analyst@ Lena Fischer, finance@ Priya Raman (CFO), platform@ Ava Brooks.
- Fund I (2023, USD 60M, 2/20 European, 8% hurdle) and Fund II (2025, USD 120M), wire details approved by a second member, 12 LPs (endowment, pension, funds of funds, family offices, foundation, insurer, corporates, angels, the GP commitment) committed to both.
- 15 portfolio companies (11 in Fund I, 4 in Fund II; holdings imported with follow-ons) with 18 months of verified KPIs (ARR or revenue, net burn, cash, headcount, customers): Kestrel Robotics breaks out (ARR 0.6M to 8.1M, a Series B, marked up to USD 18M), Lumora Energy runs short (runway about 3.4 months, a runway alert), Tidewater Health is written down (revenue falling, mark USD 0.6M on a USD 2M cost); Kestrel's latest month arrives as a founder update your AI agent staged with quotes (Verify).
- Capital: Fund I calls twice a year since its first close (fees, investments, the audit), all paid except two LPs late on this quarter's fee call (Payment items); a USD 4.2M distribution from a Brightline Payments secondary; Fund II quarterly calls and this quarter's call for Halcyon AI's extension, issued a week ago and half paid. Fund I: TVPI about 1.6x, DPI 0.13x, net IRR about 20%; Fund II early in its J-curve (TVPI about 0.8x).
- Quarters: Fund I's two previous quarters marked, frozen, the letter finalised and the LP packs sent; last quarter open with your AI agent's draft marks waiting for approval (Mark item).
- Deal flow: 52 inbound deals over 12 weeks (rising), 21 passed with reason chips, 2 held, 4 read by your AI agent (3 Ready verdicts, 1 past its reply day), 2 still waiting for it, a pass email it drafted (Draft); 34 deals across Sourced to IC (6 passed or held), 22 of them advanced from the Inbox.
- Committee: IC a week ago (Rowan Robotics invest with two conditions, one due today; Ember Analytics passed on valuation) and today's meeting live: Northstar Ledger with every vote in (Reveal for the facilitator), Basalt Energy and Mosaic Health with Olivia's vote due.
- Markets: three theses (Industrial automation, Fintech infrastructure, Climate software) with radars and 7 candidates your AI agent researched.
- Today: four external meetings ahead of now (a board meeting, a partner meeting with your AI agent's brief ready, an LP check-in, an intro call) and yesterday's first meeting without a note; a proposal from your AI agent (Orchard AI's new round size), diligence answers with public sources to confirm, asks as tasks.
- Owner's Next: every one of the 14 kinds.

## Tests

All in `reference/tests/home/` (README there), scratch port 3192, mock bridge 3292, on the refreshed copy of APP (kernel fix rounds included):

- `t01_empty.mjs`: 108 passed. Before setup 401; the empty firm for owner, partner, principal, analyst, finance, platform, scout, venture partner and your AI agent: every block in its empty state (12 empty weeks, 8 stages with conversion null, fund figures null with reasons, no runways), `hidden` per role (finance: no deal flow; platform: no fund; scout and venture partner: theirs), no block errors; app.today home block; the digest off by default, turned on, sent through the mock bridge as an outbound message of kind digest approved by the member, nothing left in Next; every GET op of the catalog as owner and agent without a 5xx.
- `t02_seeded.mjs`: 52 passed on the demo firm. Next equals next.count and runs in rank order with 1 to 3 actions; all 14 NextItem kinds present; Today equals calendar.list with the brief ready; inbound 50 over 12 weeks and rising; the funnel equals deals.funnel; Fund I equals metrics.fund (TVPI 1.57x, DPI 0.13x, net IRR 18.7%), the J-curve from below zero to above it; the Fund II switch (TVPI 0.8x) and its 4 runways; runways equal the portfolio engine (Lumora 3.4, Pinecrest 9.6, Tidewater 11 months) and Lumora's alert; finance, platform and your AI agent scopes; app.today in words; the digest's lines and links.
- `t03_perf.mjs`: 5,000 deals: home.summary warm median 17 ms server side (max 20); right after a change 86 ms (the kernel rebuilds Next in 57 ms; the funnel rebuilds in about 230 ms when deals change). Before the block cache the same firm took 187 ms (the funnel alone 139 ms).
- `t04_digest_cron.mjs`: 4 passed: the cron sends one digest to a member in their own morning, through the bridge; a member with it off gets none.
- `ui_shots.mjs`: 44 passed seeded, 32 empty. Light and dark at 1440 and 390: five blocks, 36 to 38 interface words at rest seeded (data rows included) and 21 to 23 empty, one black primary (Start) at 1440, none on a phone (the bottom bar's Next), nothing under any title, pointer cursors, hover distinct from containers (Next rows, Brief, runway rows, Ask bar), phone order Ask, Next, Today, no sideways scroll, 40 px targets, no console errors or 5xx; the Ask flow (StepTrack and "Waiting for your AI agent", the answer in place after your AI agent's jobs.next and jobs.done); Start opens Focus; Settings, Digest.
- `focus_walk.mjs`: 9 passed (see Next and Focus mode).
- tsc and `vite build` clean; `node tools/gen.mjs` (384 operations) and `gen_triggers.mjs` succeed; the gate (`agent-app/tools/src/cli.ts validate`) passes on the scratch copy.
- Screenshots: `SCR/home/shots/` (`home_*`, `home_empty_*`, `home_ask_*`, `settings_digest_*`, `focus_*`). Best Home: `home_light_1440.png`, `home_dark_1440.png`, `home_light_390.png`, `home_dark_390.png`.

## Known gaps and decisions

- Today's meetings are only as good as the time the seed runs: the demo calendar puts them ahead of now (business hours before 08:00 New York); seeded late in the evening they have already ended (and raise Note items), which is the honest state of that day.
- The greeting follows the device clock (a partner travelling sees their own morning); meeting times are in the firm's zone (kernel format).
- Phone: Start is hidden on Home under 768 px (the bottom bar's Next, with its count, opens Focus mode) so the greeting keeps its room; at 1440 Start is the one black button.
- The funnel shows deals that entered each stage this quarter with the deals engine's cohort conversion; deals advanced from the Inbox enter at Screen, so Screen can exceed Sourced.
- The J-curve is the LPs' net value (distributions less calls, plus NAV) from funds' jcurve rows; Home draws no number of its own.
- The fund and runway blocks are cached under a data fingerprint; Next is the kernel's cache. home.summary right after a restart waits for the kernel's cold Next build (2 to 4 s once).
- The digest cron has no catch-up by design (a morning digest is not sent in the afternoon); a member who never opened the app from a browser has no link base, so their lines carry no links.
- Home exports no `homeBlocks`: the page composes its five blocks itself (the registry hook stays for later use).
- No job kinds: questions from the Ask bar are the kernel's `chat` jobs.

## Requests to other builders

1. kernel-core and kernel-frontend: an outbound draft's Next item sends `data.edit = { op, params, fields: { subject, body } }` but `NextCard` reads `edit.field` (a string) and saves `{ [field]: text }`: E in Focus edits the text and saves nothing (the op gets a param named "undefined"). One side must change (the frontend type says `field: 'body'`).
2. kernel-core (lib_proposals Next items): the title reads "Change raise, post_money of D-0019" and the lines "12000000.00 > 15000000"; use the op's param labels, the deal's name and the money format (and the deal currency); the chip shows the kind code ("note fields").
3. diligence: `AnswersCard` sets text answers in the mono face (mono is for figures); before its fix round a long text answer squeezed the question column to one letter a line.
4. markets: the `candidates` card marks your AI agent three times per row (Sparkle on the name, a "Your AI agent" source chip, the card chip); one mark is enough.
5. intake: the drop handler accepts files only, so a link pasted outside a field goes nowhere; Home's Ask bar adds a pasted link with `intake.add --url` itself. A `url` handler in `drops` would make the global paste work too.
6. portfolio: the holdings importer (`importHolding`) renames an existing company to the text of the Company column when that text is a domain (upsertCompany with name = the domain): import by domain turns "Lumora Energy" into "lumoraenergy.com". It should resolve the domain and keep the name. The demo seed imports by company name.
7. kernel-core: the first `next.list` after a restart still takes 2 to 4 s (cold runtimes), and home.summary's first answer after a restart waits on it.
8. network: a calendar meeting is matched to a company only through people already on file (the Orchard AI attendees had no person records, so the meeting had no company until they were added); matching by the attendee's work domain against companies.domain would catch it.

## npm dependencies

None.

## Majors fix (2026-11-12)

- UI-01: Deal flow draws deals' cohort funnel exactly (`lib_deals_flow.funnel`; home.summary passes `stages: [{ key, label, count, now, conversion_ppm }], cohort, open, hidden`): Inbound first, bars only shrink, each bar carries its count and, right after it, its percentage of the bar before. Inbound per week: each week is split into this quarter (`weeks[].quarter`) and before; the quarter's part is drawn in the funnel's colour (stacked, earlier weeks muted) and adds up to the funnel's Inbound (`inbound.quarter.count` = `funnel.cohort`, same items: received in the quarter, not merged). When the quarter began before the 12 weeks, the chart starts at the quarter's first week (up to 14 weeks). "This week" labels the weekly figure. The funnel cache also watches `intake_items`. app.today: funnel stages `{ stage, reached, now, conversion }`, inbound `this_quarter`.
- UI-08 demo seed: 25 touches through `interactions.log` (pipeline founders of Orchard AI, Northstar Ledger, Basalt Energy, Bluefin Logistics, Keystone Grid, Rivet Health, Marlow Payments, Summit Freight; portfolio CEOs; Kestrel's CEO with Rowan Robotics' founder and Brightline's CEO with Copperline's at shared meetings), then `network.recompute`. Who knows: Orchard AI 2 paths (strong), Rowan Robotics 3 (one direct, two one-hop through Nadia Volkova), Copperline 2, Northstar Ledger and Basalt Energy strong; pipeline coverage strong 4, good 5, weak 1. One map per thesis (`maps.save`, `maps.place` by Mei): Industrial automation 15 tiles, Fintech infrastructure 13, Climate software 12, across portfolio, pipeline, passed, tracked and competitor (fintech has no passed deal to show). 887 operations, 0 failed; Next still holds all 14 kinds.
- Tests on the merged copy: t02 55, t01 108, t04 3, ui_shots 44 seeded and 32 empty (words 40 and 23), focus_walk 9 (the verify card shows no figure strip and one Confirm all).

## Fix 3 (2026-11-13)

Home was rebuilt for ease of use: the hero sits on the page (the constellation now means the firm, committed capital
and the share called, one orbit per fund, one node per company placed by the day first invested, TVPI and DPI on the
axes), Today's meetings moved beside Waiting for you, News joined (markets' `news.list`), Pipeline flow moved beside
New deals by source, and every title and figure says what it is with its unit. Details, the new `home.summary` visual
fields and the tests: `kernel-frontend.md`, "Fix 3", section Home. `components/home/constellation.ts` (the canvas) is
gone; `components/home/Constellation.tsx` and `components/home/News.tsx` are new.

## Fix 4 (2026-11-13)

The hero moves (the sphere, companies on their orbits, pulsing attention rings; a canvas over a still SVG, paused on
hover, still with reduced motion), names every fund and company, drops the legend and shows the firm's key numbers in
a column on the left (new `home.summary` readouts: `net_irr_ppm`, `called_ppm`, `dry_powder_minor`, `fund_nav_minor`,
`companies`). News became a small dashboard with category tabs and your AI agent's take (markets' `news.list` and
`news.insights`). Every Home panel has a divider under its title. Details: `kernel-frontend.md`, "Fix 4".
