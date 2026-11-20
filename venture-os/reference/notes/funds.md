# funds module notes (Venture OS)

Built 2026-11-12 by the funds builder (scratch `SCR/funds/app`, port 3190, mock bridge 3290). SPEC 7.11 end to end:
LPs and commitments, sealed wire details with a second approval, capital calls and distributions in three steps with
one PIN, PDF notices with their ILPA CSV sent through kernel outbound, payments, the append-only ledger, opening
balances, statements and reconciliation, marks, NAV and metrics (net beside gross), reserves and scenarios, the
quarter close with the LP letter and per-LP packs, ILPA and XLSX exports, the LP fund raise board, LP questions.

## Files

- `pb/pb_migrations/1741007000_funds.js`: `lps, commitments, bank_blocks, capital_events, capital_lines, payments,
  ledger, quarters, nav, marks, reserves, scenarios, reports, statements` (every rule null). Holding ids are text
  (portfolio's `holdings`), read through `lib_portfolio.holdingsFor` for people and your AI agent and `holdingsOf` for
  system work.
- `pb/pb_hooks/lib_funds.js` (fund refs, ledger reading, capital accounts, NAV, metrics contract, markOf, J-curve,
  Next, search, cron), `lib_funds_lps.js` (LPs, commitments, wire details, raise, LP questions, LP importer),
  `lib_funds_capital.js` (calls, distributions, waterfall, payments, ledger, statements), `lib_funds_close.js` (marks,
  reserves, scenarios, quarters, reports, exports), `lib_funds_docs.js` (notice, CSV and pack wording; runs the PDF
  engine).
- `engine/funds/`: `render.mjs` (pdf-lib and @pdf-lib/fontkit bundled by esbuild, 1.5 MB), `fonts/` (Noto Sans 400
  and 700 for Latin, Greek and Cyrillic; Noto Sans JP, SC and KR 400; 353 WOFF slices from @fontsource with
  `fonts.json` and the OFL licence, 9.7 MB), `src/` (the source and `build.mjs`, which rebuilds both from a folder with
  those packages). 11.2 MB in all.
- `cat_funds_core.js`, `cat_funds_capital.js`, `cat_funds_close.js`; `events_funds.js`, `cron_funds.js`, `guide_funds.js`.
- `frontend/src/app/pages/funds/index.tsx`; `frontend/src/app/components/funds/*` (FundsPage, OverviewTab, LpsTab,
  LpPage, CapitalTab, CallSheet, EventPage, MarksTab, ReservesTab, ReportsTab, RaisePage, FundTerms, cards, common, types).
- Tests: `reference/tests/funds/` (see its README).

## Operations (65) and agent rules

33 allow, 7 propose, 25 people only (11 of them with the PIN).

- allow: funds.list, funds.get, funds.holdings, metrics.fund, metrics.lp, metrics.holding, metrics.sources, lps.list,
  lps.get, commitments.list, raise.board, lpq.log, lpq.list, calls.list, calls.get, calls.preview, calls.note,
  distributions.preview, waterfall.preview, payments.list, ledger.list, statements.list, statements.get,
  statements.explain, marks.list, marks.draft, reserves.get, reserves.preview, scenarios.compare, quarters.list,
  quarters.get, reports.letter-draft, reports.statement-preview
- propose: lps.upsert (lp_records), calls.draft and distributions.draft (capital), payments.record (payments),
  statements.import (statements), reserves.plan-save (reserves), scenarios.save (scenarios). None is promotable.
- people only: commitments.save, bank.list, raise.add, raise.move, raise.soft, calls.notice, payments.remind,
  ledger.record, statements.resolve, quarters.open, reports.letter-save, reports.pack, reports.send, exports.xlsx
- people only with the PIN: bank.view, bank.change, bank.approve (a second member), calls.issue, calls.void,
  distributions.issue, ledger.opening, marks.approve, quarters.freeze, reports.finalize, exports.ilpa
- LP data (lps.*, commitments, payments, ledger, statements.get, metrics.lp, packs) is refused to your AI agent
  with `fund_data_off` while `settings.agent_sees_fund_data` is off; people need LPs view.
- Approvers: marks.approve, reports.letter-save and reports.finalize take finance (funds edit) or a partner (portfolio
  and committee edit), checked in the handler (the catalog perm cannot say "and"). reports.send is funds edit
  (outbound needs edit on the module): the partner finalises, finance sends.

## Books and numbers

- Ledger types: call_investment, call_fees, call_expenses, call_other, call_recall, call_subline, dist_capital (with the recallable part),
  dist_gain, opening_contributed, opening_distributed, opening_recallable, opening_recalled, opening_cash, investment,
  proceeds, carry. Calls and distributions are booked on the due day; a void writes reversing rows.
- Capital accounts: `lib_eng_capital.account` over an LP's rows (called amounts, not receipts).
- NAV = holdings at their latest approved mark (money invested after the mark's day added at cost; at cost without a
  mark; exited or written off without a mark at 0) + cash (called for investments, other, recalls and subscription line
  repayments, minus investments made
  outside opening balances, plus proceeds, minus distributions and carry, plus opening cash). Fees and expenses are
  paid out as called.
- `lib_funds.metrics(app, fundId, asOfDay)` is `lib_eng_metrics.fund` (SPEC 4.6 fields plus as_of_day, reasons,
  holdings_value_minor, cash_minor). Net figures use every LP's flows (not only fee-paying ones; see gaps).
- Gross flows are the ledger's fund-to-company rows: an investment call naming a holding books the investment on the
  due day; opening balances book holdings at cost; ledger.record books other investments and proceeds; a distribution
  with a source holding books its proceeds.
- Call lines: `lib_eng_capital.callLines` (pro rata of signed commitments, largest remainder; fee lines only to
  fee-paying LPs; an LP's own rate as a flat schedule; waivers); "other" purposes by `allocate`. Fee schedule from the
  LPA from the fund's first close (`first_close_day`, else 1 January of the vintage); `net_invested` and `nav` bases
  are refused (`fee_basis_unsupported`). Default fee period: after the last called period, to that quarter's end.
  Zero lines (the GP in a fees-only call) get no notice. A recall (call_recall) is allocated pro rata of each LP's
  recallable balance (refused `over_recall` beyond the fund's total), lowers recallable and leaves unfunded unchanged;
  with a holding it books the investment like an investment call. A subscription line repayment (call_subline) is
  pro rata of commitments and stays as cash (it settles investments the line funded).
- Distributions: the waterfall estimate (European over every LP contribution and prior gross distribution; American
  per holding with clawback); carry = cumulative GP share minus carry already booked; LPs get the rest, split into
  return of capital and gain, pro rata of contributed capital; recallable part allocated the same way.
- Issue re-runs the preview and refuses `stale_preview` when anything moved; issue needs approved wire details
  (`no_wire`). Issue is `track: false`: one transaction writes the event, lines (PDF and CSV file fields on
  `capital_lines`, never readable by your AI agent because of the wire block), ledger rows and outbound drafts; a
  second transaction approves them (the kernel's minute job sends, 20 a minute). Every notice is drawn before the
  transaction in one run of `engine/funds/render.mjs` (spawned with `$os.cmd('node', ...)`, a job file in
  `pb_data/funds_render/<random>` removed after): each run of text takes the first font with the glyph (Latin, Greek
  and Cyrillic, then Han in the LP's form: JP for Japan or kana, KR for Korea or hangul, else SC), and only the glyphs
  used are embedded (a notice stays under 120 KB). Without Node the issue is refused (424 `pdf_engine`) and nothing
  is issued. Packs are drawn the same way at finalise.
- Voiding an issued call or distribution drafts a void notice (outbound, kind notice, not approved) for every LP whose
  notice was sent or sending; they wait in Next for a person to approve.
- Reserves: `lib_eng_reserves.plan` with budget = the fund's callable capital and each holding's allocation net of
  follow-ons already deployed; scenarios are sets of per-holding overrides compared with the same engine.
- Quarter: open (asks mark_note per holding), freeze (PIN; refuses while draft marks wait; snapshot with fund and LP
  figures, hash, NAV row, asks lp_letter), finalise (PIN; letter final, one pack PDF per LP on `reports.file`), send
  (approved lp_pack messages with the pack and the quarter's notices); the quarter turns `sent` when every pack left.

## Next items (rank)

payment (35: overdue call lines; Record received, Remind; card `payment`), mark (30: draft marks of a quarter;
Approve all with the PIN; card `marks`; approvers only), draft (30: calls and distributions ready to issue with Issue
(PIN); the letter of a frozen quarter with Finalize (PIN); LP packs to send with Send packs), verify (30: wire
details waiting for a second member, Approve (PIN); 40: statements with open differences, Accept all), task (60: a
quarter ended and not opened, Open quarter). Outbound drafts (LP question answers) are kernel items.

## Jobs, events, cron, imports, search

- Jobs: mark_note (ref holdings:<id>, payload quarter), notice_review (ref capital_events), reconcile (ref
  statements), lp_letter (ref quarters), lp_questions (no ref; payload lp, to, question). Recipes in guide_funds.js;
  the kernel appends the closing data rule to each.
- Emits `call.issued { event }` and `quarter.frozen { quarter }`. Listens to outbound.sent and outbound.failed (pack
  delivery) and record.merged (LP company and person links).
- Cron: `daily` 08:12 (catch-up): settles fully paid events; tells funds full members once about overdue calls.
- Import targets (kernel importer, `imports` in events_funds.js): `lp_commitments` (lps edit: LP name, kind, contact,
  email, country, fund, commitment, fee-paying, closing), `statement_lines` (funds edit: an administrator's capital
  account lines, one statement per fund and period end with its differences and a reconcile job), `bank_lines`
  (funds edit: receipts matched to call lines still due), `opening_balances` (funds full: an LP's contributed,
  distributed, recallable and recalled as of the opening day) and `opening_holdings` (funds full: a holding at cost).
  Opening rows are refused once the fund has anything else on its ledger or the LP or holding already has one.
  `statements.import` stays for the page's one-file flow.
- Search: LPs by name (LP data rule), calls and distributions by number.
- Settings key `funds.notice_business_days` (10).

## Frontend

- Routes: `/funds`, `/funds/:fund` (tabs Overview, LPs, Capital, Marks, Reserves, Reports through `?tab=`),
  `/funds/:fund/events/:event`, `/funds/lps/:id`, `/funds/raise` (dense; Board). Nav Funds (order 60) with the tree
  child Fund raise. Cards `marks`, `payment`. Settings section `fund_terms` "Fund terms" (order 22): legal name, first
  close, preferred return compounding (saved in the LPA through entities.save), wire details (Show with the PIN, Change, a second member's Approve). Commands
  New call, Fund raise.
- The landing visual: FigureStrip TVPI, DPI, RVPI, Net IRR, Gross MOIC (same size) over the J-curve BarChart (calls
  below, distributions above, NAV line). New call is the one black button: a Sheet with StepTrack Amount, Preview,
  Issue (purpose chips Investment, Fees, Expenses, Recall, Line repayment; one amount, the holding picker, Add fees; then every LP's line with the exact total and your AI
  agent's review; then the exact total, LPs, due day and the wire account, Issue call with the PIN), landing on the
  event page whose paid bar fills as Record received is clicked.
- Word counts at rest (light 1440): 26 to 38 on the fund tabs, 11 to 48 on event pages (the 48 is your AI agent's
  review note, data), 21 on an LP, 31 on the raise board, 14 in Settings.

## Contract changes and requests

1. `pref_compounding` (compound|simple) lives in the LPA JSON (`entities.lpa`, kernel-core's `LPA_KEYS`); lib_funds.lpaOf
   reads it there and the Fund terms section saves it through entities.save. Nothing is kept in entity settings.
2. Holdings: `lib_portfolio.holdingsFor(ctx, { fund })` for every read on behalf of a person or your AI agent (pickers,
   holding refs in calls, distributions, ledger.record, opening balances, marks, reserves, metrics.holding,
   metrics.sources, ledger.list, event purposes, quarters.get and quarters.open lists, exports). Rows of holdings the
   caller may not see (fund scope, restricted deals) are withheld and counted (`hidden`; Marks and Reserves show a
   lock tag with the count); in ledger.list, event purposes and exports the amount stays and the holding is withheld
   (`withheld: true`, printed "Withheld"), so the books still add up. Fund totals (NAV, metrics, reserve budget) stay
   whole. `holdingsOf(app, { fund })` serves system work: NAV, the metrics contract, freeze snapshots, packs, cron.
   Rows are read for `id, company, status, ownership_ppm` (names through lib_records.mini); funds never reads the
   portfolio's cost: the fund's books are the ledger. marks.approve with a quarter approves every draft of it (the
   close is fund-wide).
3. `lib_funds.markOf(app, holdingId, asOfDay)` answers the latest approved mark on or before the day (SPEC 4.6).
4. Added ops beyond the brief: funds.holdings, raise.add, raise.move, raise.soft, ledger.record, calls.notice,
   reports.pack, reports.letter-save, statements.list/get/explain/resolve, quarters.list/get, scenarios.compare.
5. Distributions are voided with `calls.void` (one op for both kinds).
6. lp_raise deals follow LP rights in raise.*: the ops give the kernel's deal lib a context with pipeline view.

## Known gaps

- Net metrics use all LPs' flows; ILPA's "fee-paying LP allocation" and per-LP NAV by capital account are not
  modelled: an LP's NAV share is pro rata of signed commitments (labelled an estimate on screens and statements).
- CJK text prints at regular weight only (bold Han, kana and hangul fall back to 400); scripts outside Latin, Greek,
  Cyrillic, Han, kana and hangul (Arabic, Hebrew, Thai, Devanagari) are not bundled and are left out of the PDF (the
  CSV keeps them).
- The PDF engine needs Node on the computer (kernel-records' text engine already does).
- Payments on a voided call must be undone first.
- The kernel importer asks no PIN, so opening balances by import rely on funds full (your AI agent's import is a
  proposal); ledger.opening keeps the PIN.
- Unverified KPIs before a quarter opens are not listed by quarters.open (portfolio data).

## npm dependencies

None at run time beyond the kernel's: the PDF engine is a prebuilt bundle. To rebuild it: install pdf-lib@1.17.1,
@pdf-lib/fontkit@1.1.1, esbuild and @fontsource/noto-sans, -jp, -sc and -kr (5.x) in a tools folder, then
`node engine/funds/src/build.mjs <that folder>`. WOFF (not WOFF2) slices are used: fontkit cannot subset composite
glyphs from WOFF2.

## Tests and gate

`reference/tests/funds/run_all.mjs` on the scratch copy: t01_empty 48, t02_capital 96, t03_close 67, t04_agent 23, t05_fixes 66,
flow_ui 12 (screens: a call in three screens and one PIN, Record received, Approve all from Focus, hover and pointer),
all passing; shots.mjs: every page and dialog light and dark at 1440 and 390, no console errors, no sideways scroll.
Gate passes on the scratch copy (fix round, 2026-11-12, with every module merged). pdf_shot.mjs renders the Japanese LP's notice and pack for review.

## Majors fix (2026-11-12)

- M3: `marks.approve` approves only marks of holdings the approver may see (`seenHoldings`, portfolio's `holdingsFor`: fund scope and restricted deals). One mark by id of a hidden holding answers 404 like an unknown mark; Approve all leaves hidden marks as drafts, never returns them and answers `{ approved, hidden }` (a quarter whose only drafts are hidden answers 409 nothing_to_approve with `hidden`).
- M4 (funds side): the `opening_balances` and `opening_holdings` import targets register `pin: true`; kernel-core enforces the PIN for runs and for accepting a proposal of them.
- UI-06: the LP sheet's Side letter chips are the kernel `ChipPicker` (multiple), no local black chips.
- Tests on the merged copy: run_all t01 48, t02 96, t03 67, t04 23, t05 66, flow_ui 12, all passing; `reference/tests/majors/modules_a.mjs` (seeded copy) covers M3 and M4.
