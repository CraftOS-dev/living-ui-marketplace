# portfolio notes (Venture OS, SPEC 7.10)

Built 2026-11-12 by the portfolio builder (scratch `SCR/portfolio/app`, port 3189, mock bridge 3289). Positions (holdings, rounds, securities, ownership), the Mark invested flow with SAFE previews and conversion at a priced round, pro rata, founder requests by Gmail, founder updates filed from Gmail or dropped files, KPI staging by your AI agent with sources, one-click verification, KPI series with currency modes, runway, alerts once per breach, asks as tracked work, board meetings with briefs, the Portfolio page, the portfolio company page, the deal page's Investment tab, Focus cards, the Settings section.

## Files (copied into APP)

- `pb/pb_migrations/1741006000_portfolio.js`: holdings, rounds, securities, ownership, kpi_defs (seeded: revenue, arr, mrr, gross_margin, net_burn, cash, runway computed, headcount, customers, nrr), updates, kpi_values, requests, alerts, asks, board_meetings. Every rule null.
- `pb/pb_hooks/lib_portfolio.js` (positions, invest flow, the committee gate, SAFE preview and conversion, pro rata, contracts holdingsOf, kpiSeries, runway, search, timeline, holdings import), `lib_portfolio_kpi.js` (definitions, values, staging and verification, series, runway, the Portfolio list, alerts, KPI import), `lib_portfolio_updates.js` (requests, updates and the Gmail sweep, asks, board meetings, Next items, timeline items).
- `pb/pb_hooks/cat_portfolio_positions.js`, `cat_portfolio_kpis.js`, `cat_portfolio_work.js`, `events_portfolio.js`, `cron_portfolio.js`, `guide_portfolio.js`.
- `frontend/src/app/pages/portfolio/` (index, PortfolioPage, RequestDialog, CompanyPage, Overview, Updates, Holdings, Asks, BoardTab, AddUpdate, Investment, Settings, types) and `frontend/src/app/components/portfolio/` (kit, cards).
- Tests `reference/tests/portfolio/` (see its README).

## Operations (38) and agent rules

| Op | Perm | Your AI agent |
|---|---|---|
| holdings.list, holdings.get, holdings.company, holdings.invest-check, ownership.get, prorata.preview, safe.preview | portfolio:view | allow (reads) |
| holdings.create-from-deal (Mark invested; multipart closing documents) | portfolio:edit and pipeline:edit | deny |
| holdings.update | portfolio:edit | propose (holdings) |
| rounds.save, securities.save | portfolio:edit | propose (securities) |
| kpis.list, kpi-defs.list, alerts.list | portfolio:view | allow (reads) |
| kpis.stage | portfolio:edit | allow (every value needs quote or anchor) |
| kpis.verify, kpis.reject, kpis.save, kpi-defs.save, alerts.ack, alerts.rules-save | portfolio:edit | deny |
| alerts.run | portfolio:edit | allow (deterministic) |
| requests.list, updates.list, updates.get, asks.list, board.list | portfolio:view | allow (reads) |
| requests.schedule, requests.send (both untracked: they send), requests.template-save | portfolio:edit | deny |
| updates.add (multipart, or --paths for your AI agent) | portfolio:edit | allow |
| updates.assign | portfolio:edit | propose (updates) |
| updates.dismiss, updates.sweep (untracked) | portfolio:edit | deny |
| asks.save | portfolio:edit | propose (asks, promotable) |
| asks.update | portfolio:edit | deny |
| board.save | portfolio:edit | propose (board_meetings) |
| board.brief-save | portfolio:edit | allow |

Counts: 15 reads, 4 allowed writes, 6 proposals, 13 people only.

## Next items (needsYou)

- `verify` (rank 40, card `kpis`): one per update with staged values, "Acme Robotics · Oct · 5 values", StepTrack Received, Reading, Staged, Verified at Staged, data.values with source snippets; action Verify all (kpis.verify --update). The card body fixes one value in place (kpis.verify --id --value).
- `alert` (rank 50, card `alert`): figure, threshold, cash; data.alert with its series; action Acknowledge. The frame's Open goes to the company.
- `task` (rank 60): asks owned by me (Done, Start); updates that came without a company (File to with a company chip per portfolio company, Dismiss).
- `task` (rank 30): Mark invested for open deals at IC, Term sheet or Closed whose committee decision is invest with no open conditions (lib_committee.decisionOf); one click with the deal's terms.

## Jobs, cron, events

- Jobs: `update_extract` (queued when an update's files all have text, or at once for text; payload update, company, metrics asked, asked period, reporting currency, fiscal year end), `closing_extract` (closing documents uploaded with Mark invested; proposes rounds.save and securities.save with anchors), `board_brief` (48 hours before a meeting, or at once when a meeting within 48 hours is saved, or on request through jobs.ask; writes board.brief-save). Recipes in `guide_portfolio.js`; the kernel appends the closing data rule.
- Cron (firm zone): `portfolio_mail` every 5 minutes (Gmail sweep), `portfolio_requests` 09:00 with catch-up (requests and reminders), `portfolio_alerts` 07:30 with catch-up, `portfolio_board` hourly at :20.
- Emits `holding.created { holding, company, fund, deal }`, `kpi.verified { company, period_end }`, `alert.fired { alert, company, rule }`. Subscribes `file.text_ready` (updates' files).
- Search: portfolio companies (href `#/portfolio/<company>`). Timeline: investments, rounds, updates, alerts, board meetings. Imports: `holdings` (company, fund, instrument, amount, day, valuation, currency) and `kpi_values` (company, period end as a month or a day, metric key or label, value, currency, months, forecast).
- settingsKeys `portfolio`: runway_months 6, cash_months 3, burn_up_pct 30, missed_update_days 45, request_subject, request_body, request_day 3, reminder_1_days 7, reminder_2_days 14, company_mail true.

## Decisions

- Values: one live value per company, metric, period (months 1, 3 or 12) and forecast flag; staging a different value for a verified period keeps the verified one until a person verifies the new one (the old becomes superseded) and flags it `restated`. Money in minor units of its own currency, percents in ppm, counts whole. Definitional problems are flag codes (contracted_not_live, gross_not_net, bookings_not_revenue, run_rate, period_unclear, currency_unclear, restated, other), never free text matching.
- Sources: a quote found in the update's text becomes a kernel message anchor (offsets in the update body); file values carry an anchors.create anchor. Your AI agent's values without a source are refused.
- A person's manual entry (kpis.save) and a person's KPI import are verified at once; an import run by your AI agent stays staged.
- Runway is lib_eng_runway over verified cash and verified net burn only (monthly or quarterly rows, never overlapping); unknown says why (missing months listed), never 0.
- Series pick one granularity per flow metric (monthly first); currency conversion through the kernel's lib_fx (flows at the period average, balances at period end); no rate answers null with a reason.
- Value of a holding: the latest approved mark (lib_funds.markOf), else held at cost (`value_basis: cost`), exited and written off at 0 with proceeds counted. MOIC from lib_eng_metrics.gross.
- Mark invested: a capped SAFE owns investment over the cap (engine); a priced check owns shares over post shares when given, else amount over post-money; discount and MFN SAFEs and notes own nothing until they convert. The round price is derived from pre-money over pre-money shares when both are given. The preview's conversion scenario is the next round at twice the cap selling 20% (a notional share count when the real one is unknown; only ppm is shown then).
- The committee gate (coordinator's request): Mark invested is refused with `decision_not_invest` or `conditions_open` (409) unless an owner or a partner passes `override` (audited, `overrode` in the answer); no decision at all does not block. `holdings.invest-check` feeds the Terms step's chip.
- A priced round (rounds.save with price and pre shares) converts the fund's outstanding SAFEs and notes of that company (lib_eng_safe.convert), writes the new shares and restates ownership over the engine's post shares.
- Founder requests: off until a person turns them on (requests.schedule); the request for the period that just ended goes out at once when due (request_day after the period end), released by the person who turned the schedule on (kernel outbound kind request, approved by them); reminders at 7 and 14 days while no update came. The sweep files the updates label, and (fix round) mail from every active portfolio company: its root domains and its founders' and people's free-mail addresses, deduped by message id, skipping messages the Inbox already filed; Settings, Portfolio, Company mail (settings key company_mail, requests.template-save --company_mail) turns that off, leaving the label and replies to requests. The query uses Gmail's from:(a OR b) in chunks of 15 (the mock bridge reads one sender at a time; t05 tests one at a time).
- Alerts: a rule fires once per breach (no new alert while one of the rule is open or acknowledged; it resolves itself when the condition ends). Cash under 3 months is the sharper form of runway under 6 and resolves the runway alert. Missed update: no update within the threshold after the period a request asked for.
- Board briefs are stored on the meeting (`board_meetings.brief`) through board.brief-save, not network's briefs.

## Contract notes (SPEC 4.6)

- Fund scope (fix round): `lib_portfolio.holdingsFor(ctx, { company | fund }) -> rows` answers only the holdings the caller may see (funds in members.funds scope, restricted deals by their team); the same as `holdingsOf(app, { company | fund, ctx })`. `holdingsOf(app, { company | fund })` without ctx stays the app-level call for system work (NAV, metrics, cron). Markets (map tiles) and anything answering a person should call holdingsFor.
- `lib_portfolio.holdingsOf(app, { company | fund, ctx })` rows: id, company, company_name, fund, fund_name, deal, status, currency, cost_minor, value_minor, value_basis (mark, cost, exited, written_off), ownership_ppm, first_day, exit_day, proceeds_minor, flows [{ day, amount_minor }] (investments negative, proceeds positive).
- `lib_portfolio.kpiSeries(app, companyId, key, { from_day, to_day, currency, forecast })` -> [{ id, period_start, period_end, months, value, currency, status, forecast }] (converted points add native_value, native_currency, rate_e8, mode, reason).
- `lib_portfolio.runway(app, companyId)` -> { months, state, reason, cash_minor, avg_burn_minor, as_of_day, missing, zero_day, currency }.
- Calls: `lib_funds.markOf`, `lib_committee.decisionOf` (reads outcome, outcome_label, conditions_open, conditions_total).

## Requests to other builders

- deals: the deal page's Term sheet action "Mark invested" should open `#/deals/<number>?tab=investment` (dealTabs key `investment`, shown when the deal is invested or open at IC, Term sheet or Closed).
- network: companyTabs `portfolio` decides `show` from the firm's held companies, loaded once in the background; a company record carrying an `invested` or `holdings` field would let it show on the first render.
- kernel-frontend (small): Sparkline cannot draw staged points dashed; the Portfolio grid's sparkline draws staged and verified alike (the company page charts split them).
- home: `lib_portfolio.runway` per company, or `holdings.list` rows (runway months, state) for the three shortest runways.

## Known gaps

- Mark invested leaves the deal's documents in the deal room (not moved to the company).
- asks.update `intro` stores network's intro id without checking it (no SPEC 4.6 contract).
- Message anchors are not re-validated (kernel: message anchors have no text check); the update keeps its text, so the snippet stays right.
- An update from an unknown sender is filed only when it carries the updates label; one sent to the owner's inbox without the label is not seen.
- KPI currency conversion needs stored or fetchable rates (offline: null with a reason).
- No in-app benchmark across companies (not in scope).

## Tests and results

`reference/tests/portfolio/run_all.mjs` (scratch port 3189, mock bridge 3289): t01 empty and data sweep of every read op as owner, partner, analyst, platform lead and your AI agent (no 5xx) and the 13 people-only ops refusing your AI agent; t02 investing (engine vectors, Mark invested, closing documents read by your AI agent as accepted proposals, conversion at a priced round, pro rata, marks, Mark invested from Next, the committee gate and override, restricted deals, holdings import); t03 monitoring (requests through the mock bridge, the Gmail sweep, unfiled updates, jobs through ops with the agent token, staging with sources, Next verify cards, Fix one, reject, Verify all, series, currency, runway, alerts once per breach, asks as proposals, board briefs, a dropped file, dismiss, KPI import, search, timeline); t04 the screens in Chromium (Fix one and Verify all in Focus, Request updates, Add update, Mark invested in three steps, Add meeting, Add ask, alert thresholds); t05 the fix round (holdingsFor fund scope through the scratch-only zzp test ops in `stubs/`, company mail on and off, a founder at gmail.com). On the merged APP copy: t01 41, t02 54 (stub-steered marks and committee sections skipped), t03 80, t04 18, t05 13, all passing. Screenshots: `ui_shots.mjs` (every page and dialog light and dark at 1440 and 390, word counts, console errors, sideways scroll, hover sweep). Scratch-only stubs of `lib_funds.markOf` and `lib_committee.decisionOf` read JSON files in pb_data (never shipped).

Results: t01 41, t02 67, t03 80, t04 18 checks, all passing (206). Screenshots in `SCR/portfolio/shots/` (18 screens x light and dark x 1440 and 390, plus the empty database): no console errors, no sideways scroll, hover sweep clean. Gate (`agent-app/tools/src/cli.ts validate`) passes on the scratch copy. In APP after the copy: `tools/gen.mjs` generates 324 operations; the merged frontend (committee, diligence, funds, network, portfolio pages) typechecks.

npm dependencies: none.

## Majors fix (2026-11-12)

- M2: a holdings import row whose Company is a domain (`arclightsec.com`) matches the company by its domain and never renames it (only the domain goes to `lib_records.upsertCompany`; a name sends only the name).
- UI-06: Request updates' Metrics chips are the kernel `ChipPicker` (multiple); the local `ToggleChips` in `components/portfolio/kit.tsx` is gone.
- Tests on the merged copy: t01 41, t02 54, t03 80, t04 18 passing; t05 13 passing with its scratch-only `stubs/` installed. `reference/tests/majors/modules_a.mjs` imports `arclightsec.com` into Fund I: no rename, no new holding.

## Fix 3 (2026-11-13): company page hero and dashboard, asks order

- New op `portfolio.company --company` (read, your AI agent too; 404 when the caller holds nothing in it): company (one line from the description's first sentence, else the newest intake one-liner; sector, stage from the latest round, HQ, founded, team size, website, `logo_domain` = the domain, '' in a demo firm), people (founder roles on its deals, else the people at the company), links (latest deck = folder Deck, latest board deck, latest update, file count, founders' emails), position per holding (fund, invested, value and basis, multiple, ownership), last round, latest update with a summary (its first paragraph of 40+ characters), open asks (in progress first), next board meeting, files (company files, deal room, update files and email-only updates, board decks; readable only) newest first.
- Page: `CompanyHero.tsx` above the tabs (logo through `components/portfolio/Logo.tsx`: Google's favicon service at 128 px, the letter avatar when it fails or answers its 16 px globe; quick links Website, Latest deck, Data room (scrolls to Files), Latest update, Board deck, Email the founders; fund position on the right). Overview is `Dashboard.tsx`: KPI tiles (ARR or revenue, growth, net burn, cash, runway on a 0 to 24 month track with the 6-month line, headcount; only what is reported), Latest update, Open asks, Next board meeting, Files, News (markets `listNews('company', id, 6)` and `NewsList`), then the KPI charts (`Overview strip={false}`). The network company tab still uses `Overview` with its strip.
- Asks: migration adds `asks.rank`; `asks.list` answers in board order (placed first, then newest first); new op `asks.reorder` (people only: `--ask`, `--status`, `--before` or `--index`); `asks.update` with a new status resets the rank. The asks board sorts and moves with the kernel Board placeholder.
- Demo data gap (seed is not ours): the demo portfolio companies have no description, city or deck, so their hero shows no one line and no Latest deck; a demo firm shows letter avatars (several demo domains belong to real companies).

## Fix 5 (2026-11-13): edit the company, its numbers and the investment

- `portfolio.company` company adds `logo_url`, `stage_key` (the stage a person gave it); `stage` is that stage's label,
  else the latest round's. Founders: deal founder seats, then current jobs marked founder; titles from the job there.
- Hero (`CompanyHero.tsx`): the logo is a `LogoPicker` for network editors (click or drop an image: it shows at once,
  `components/company/actions.ts` setCompanyLogo); Edit (aria "Edit company") opens the company sheet
  (`components/company/EditCompany.tsx`); Edit beside Fund position (aria "Edit investment") opens `EditInvestment.tsx`.
  The header's More menu: Edit company, Edit numbers, Edit investment, Request updates.
- `EditNumbers.tsx`: pick the month (each with "n numbers"), one row per metric (value, currency for money, Verified,
  Staged or Not reported); Save enters each changed value with `kpis.save` (verified, the person as source, audited). A
  reported number is corrected, never cleared here. Opened from More and from "KPIs over time".
- `EditInvestment.tsx`: per holding and security: security kind, amount, date, cap (convertibles) or shares; its round
  (the security's own, else the company's round of the same day, else a pick or "A new round"): round, date, post-money,
  raised. Saves with `rounds.save` and `securities.save` (linking the security to the round shown).
- The three sheets load as their own chunks (`lazyPage`) and read without a remembered answer, so a form always starts
  from the stored values.
- Portfolio grid rows use the shared `CompanyLogo` with `logo_url`.
