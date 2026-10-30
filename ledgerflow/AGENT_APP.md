# Ledgerflow

> Per-project plan, context and index. Keep it current with every change.

## What this app does

Double-entry books for a small business, a household, or both in one set
of books (a freelancer or sole trader), kept together with an AI agent.
Bank statements land in an inbox where every line gets a labelled
suggestion; the person reviews by keyboard, the AI agent proposes what the
system cannot decide, and nothing it does reaches the books without the
person's policy allowing it.

- **Home** (the landing page): a dashboard for the chosen range (this
  month, last month, this quarter, year to date, 12 months) with the
  numbers compared to the period before: cash in the bank with its trend,
  money in, money out, net profit (or saved), what customers owe (overdue
  in red) or what is owed on cards, runway or savings rate. Charts: the
  daily cash balance, money in and out by month with profit, where money
  went (or came from) by category, who owes you by age, coming up (invoices
  and bills due, recurring entries), each account with its 30-day trend,
  budgets this month, and what needs attention (the inbox by suggestion
  kind, overdue, bills due this week, proposals, receipts, accounts to
  reconcile) next to the AI agent's latest runs. Every number opens the
  view behind it.
- **Setup**: business, household or both; home currency (45 ISO
  currencies with their minor units); a sales tax / VAT preset (UK, EU,
  Australia, New Zealand, Singapore, Malaysia, Canada, US, India, none);
  fiscal year start; a chart of accounts to match, each account with a
  "use it for" text the AI agent reads; opening balances.
- **Inbox**: statement import from OFX/QFX, QIF, CSV (column mapping
  remembered per bank layout, day/month order detected or asked), CAMT.053
  and MT940, or lines the AI agent reads from a PDF. Three layers of
  duplicate protection (file hash, bank id or content fingerprint, the
  same line in another format). Each line gets one suggestion, in order:
  an entry already in the books (match), an open invoice or bill for the
  exact amount (dated after the document), the opposite line in another
  own account (transfer, both sides), the first rule that applies, how the
  payee was booked before (memory), or the AI agent's proposal with its
  reason and confidence (high, medium, low). Review with J/K, Enter (book),
  X (exclude), Space (select), A (ask AI), I (import); bulk-book every
  high-confidence suggestion; book as a category (with tax), a split, a
  transfer or a match; make a rule from a line. Receipts and documents
  dropped in go to the AI agent, which reads them, attaches each to its
  entry or drafts the bill.
- **Ledger**: the chart of accounts with balances; account registers with
  running balance and reconciliation state (with the balance over time as
  a chart); every entry with filters (who
  added it, AI runs, proposed, voided, words or an amount); the entry
  inspector with its lines, where it came from (statement line, document,
  rule, the AI agent's reason and confidence), files and history; quick
  entries (expense, income, transfer with a second currency) and journal
  entries; edit, void, reverse, approve or reject proposed entries.
- **Reconcile**: per bank, card, cash or loan account: the statement date
  and balance (prefilled from the imported statement), tick until the
  difference is zero (matched lines are ticked already), finish to lock
  those entries; undo the latest; finish with an adjustment to Suspense.
- **Sales and Purchases**: invoices, credit notes, bills and vendor credits
  with lines (account and tax per line, prices with or without tax, line or
  document rounding), numbering on approval, other currencies at a rate;
  payments (also across currencies, the difference booked as an exchange
  gain or loss), credits applied, bad-debt write-off, derived state (open,
  part paid, overdue with days, paid), possible-duplicate warnings on
  bills, print or save as PDF, payment reminders drafted by the AI agent.
- **Reports**: profit and loss (accrual or cash basis, by month or
  quarter, compared with the previous period or year), balance sheet,
  cash flow (direct), trial balance, aged receivables and payables, tax
  summary (UK VAT return boxes 1 to 9), budget vs actual, spending, net
  worth; each with its chart (profit by month or as a waterfall, balance
  sheet composition, cash flow waterfall, aging bars, spending donut);
  every amount opens the entries behind it; CSV export, print (charts are
  left out), Explain with AI.
- **Close**: per month, the checks an accountant runs (inbox empty,
  proposals approved, uncategorized and suspense clear, transfers settled,
  accounts reconciled, drafts and receipts dealt with, duplicates,
  negative cash, overdue invoices, revaluation), a manual checklist,
  notes, the AI agent's preparation note; closing can lock the books.
  Lock dates: the books, and a separate one for the AI agent.
- **Setup**: business and invoice details, accounts, contacts (with what
  they owe, merge duplicates), tax codes, rules (ordered, AI-proposed rules
  wait to be turned on, automatic rules), recurring entries, invoices and
  bills, exchange rates (European Central Bank fetch, revaluation), the AI
  agent's policy and house rules, imports (undo) and saved CSV layouts,
  export to Beancount, hledger or CSV.
- **AI agent**: does everything the person can through the ops, plus four
  triggers (below). Its entries are proposed, its rules wait, it cannot
  sign off a month, finish a reconciliation, write off a debt, move lock
  dates or change its own policy. Every change by anyone is in the activity
  log with undo and redo; the agent's changes are grouped into runs that
  can be reverted as a whole. Ask AI (title bar) sends a question with what
  is on screen.
- **Keyboard**: Ctrl K palette (go to, create, find entries, documents,
  contacts, accounts or an amount), Ctrl Z / Ctrl Y undo and redo, N new
  expense, I import, the inbox keys above.

The look follows CAD Workshop: a 52px icon rail (new button, badges), a
title bar with status chips, then the view edge to edge; flat panels split
by hairlines, 28px controls, 30px rows, tabular numbers; near-monochrome,
color only for money in, owed or overdue, warnings, and the accent for the
selection and everything the AI agent proposes. Numbers are shown as
charts wherever a trend or a share matters (Home, reports, registers, the
inbox mix, aging, close checks): small SVG charts in
`components/charts.tsx` (area, grouped bars with a line, donut, stacked
bar, one-line meter, aligned horizontal bars, waterfall, sparkline) with
hover values, and a categorical palette `--lf-c1..c8` for categories only.
Share bars sit on one line with their legend (`Meter`), aging is shown as
aligned rows (`HBars`) or as columns over the aging table's own columns.
Line icons mark panels, KPIs, stats, report and account lists. Motion is
light and once only: views fade in, Home panels rise, charts grow from their
baseline and headline numbers count up (theme.css `lf-*` classes, off under
reduced motion). No emoji, line icons only.
Colors are derived from the host theme (`lib/themeColors.ts`), light and
dark. Phone layout with a bottom bar.

**Start every agent session with `agent-app run <project> app.guide`**: it
returns the books, the policy and house rules, conventions (money in
answers is in minor units, money sent is a decimal), every account with
when to use it, tax codes, what is on screen and recipes.

## Requirements

See `reference/requirements.md` and the research behind the design in
`../reports/Bookkeeping software UI UX survey.md`.

## Entities

- `settings` (one row): books, invoice details, lock dates, `policy`
  (agent_auto_post, ceiling, auto_methods, house_rules), agent_categorize.
- `accounts`: code, name, type (asset, liability, equity, income,
  expense), subtype, currency, `system` role (ar, ap, tax, opening,
  retained, suspense, transfers, uncat_income, uncat_expense, fx, rounding,
  bad_debt, sales), cashflow class, parent.
- `transactions` and `postings`: amounts are integers in minor units of
  the posting's currency (`amount` > 0 debit, < 0 credit) with
  `home_amount` in the home currency; every transaction sums to zero at
  home. Postings carry the transaction's date and status (proposed, posted,
  voided), `recon_state` (cleared, reconciled) and the `statement_line`
  they cleared.
- `statement_imports`, `statement_lines` (status new, proposed, posted,
  matched, excluded; `suggestion` json with method, confidence, reason,
  `by` system|rule|agent|user and `final` once booked), `csv_profiles`.
- `documents`, `doc_lines`, `allocations` (payment, credit, writeoff).
- `files` (receipts and documents, `extracted`, link), `rules`,
  `recurring`, `budgets`, `periods`, `fx_rates`, `reconciliations`,
  `contacts`, `tax_codes`, `asks`, `activity` (undo/redo steps).

## Operations

141 operations in `operations.json` (generated from the routes; every UI
action is an op). Groups: app, setup, settings, policy, locks, accounts,
contacts, tax, transactions, ledger, inbox, rules, profiles, files, docs,
reconcile, reports, budgets, close, fx, recurring, asks, activity, export.
`app.dashboard` (range) returns everything Home shows in one call
(`lib_dashboard.js`): KPIs with the previous period, the daily cash series,
12 months of income and expense, categories, aging, what is due, accounts
with their trends, budgets, the inbox mix and the agent's latest runs; the
AI agent can use it for a quick read of how the books stand.
Mutating ops run through `lib_activity.run`: one transaction with a
tracked app handle that records every save and delete, so each change is
undone as a unit (and refused when something it touched changed later, or
it falls in a locked period).

## Agent triggers

- `lines_imported`: imported lines without a confident suggestion (and
  lines the person sends with Ask AI). The agent takes them with
  `inbox.queue`, proposes with `inbox.propose`, may propose rules.
- `documents_received`: files dropped in; `files.start` returns the path,
  `files.update --extracted`, `files.link` or `docs.create --kind bill`,
  `files.done` / `files.fail`.
- `agent_asked`: questions, report explanations and reminder drafts;
  `asks.start`, `asks.answer` / `asks.fail`, `docs.remind --text`.
- `close_requested`: a month to prepare; `close.start`, fixes, then
  `close.complete --note`.

Each queue drains in one run; a fire refused by the cooldown is retried by
the minute cron; work the agent took and left is handed back after 4
quiet minutes or 25 minutes (`lib_agent.js`).

## External data

- European Central Bank reference rates (`www.ecb.europa.eu`, daily and
  90-day XML) on request (`fx.fetch`). Nothing else leaves the machine.

## Money, dates and the ledger (`lib_money.js`, `lib_ledger.js`)

- Never floats for money: parse decimals exactly into minor units (half
  away from zero), multiply once, split totals with the largest-remainder
  method so parts always sum.
- Other currencies convert at the latest rate on or before the date; a
  transfer between currencies takes its home value from the home-currency
  side (implied rate); payments of foreign documents book the difference
  against the document's booked value to Exchange gains and losses.
- Tax: per line or per document rounding, inclusive or exclusive;
  reverse-charge codes book input and output tax that cancel.
- Locks: `checkLock` for every writer; the agent also stops at its own
  lock date. Reconciled postings keep account, amount and date.

## Background jobs

- `lf_agent` (every minute): re-asks the agent about waiting work and
  hands back work left busy, for the four queues.
- `lf_recurring` (hourly at :07): creates due recurring entries, invoices
  and bills (proposed or draft unless automatic).
- `lf_prune` (03:41 daily): activity and answered questions older than a
  year (the books themselves are never pruned).

## Gotchas

- Hooks do not hot-reload: restart the app after any hook change.
- Handlers run in isolated VMs: no helpers at file scope in `*.pb.js`;
  `require()` costs about 1.6 ms per call.
- The hooks' regexp engine doubles matches of lookahead patterns like
  `\B(?=(\d{3})+(?!\d))`: thousands separators are added by hand
  (`lib_money.format`).
- Year-first dates are never ambiguous: `lib_import.dateOf` accepts them
  whatever day/month order the file uses.
- A payment line only matches documents issued no more than 3 days after
  it; after a document is paid, other lines that pointed at it get a fresh
  suggestion.
- Inside `lib_activity.run` use the tracked handle (`t`) for every write,
  or the change is not undoable; parents are never deleted by cascade
  (children are deleted first through the handle).
- What is on screen (`app.ui`) is kept in server memory, not in the
  database, so it does not churn realtime.
- Dialogs are non-modal Radix dialogs with their own overlay: a modal one
  traps focus and blocks pointer events, which made pickers and menus
  (portaled to `<body>`) unusable inside dialogs. Popovers carry
  `data-lf-popover` so clicks in them do not close the dialog.
- `exactOptionalPropertyTypes` is on: optional props are typed
  `?: T | undefined`.
- Colors come only from `--lf-*` tokens; never hardcode a color in a
  component (the printed invoice uses fixed print colors). Charts use
  `--lf-pos`/`--lf-neg` for money in and out and `--lf-c1..c8` only to tell
  categories apart.
- Chart axes (`charts.tsx` `ticks`) always end at a tick at or above the
  highest value, or the tallest bar is clipped.

## Ownership map

- Editable: `frontend/src/app/`, `pb/pb_migrations/` (new files only),
  `pb/pb_hooks/*.pb.js` and `lib_*.js` (not the `_*.js` system files),
  `operations.json` (non-system entries), `triggers.json`, this file,
  `reference/`.
- System-managed (never edit): `frontend/src/kit/`,
  `frontend/src/main.tsx`, `frontend/src/config.gen.ts`, the underscore
  hooks (`pb/pb_hooks/_*.js`), `manifest.json` (capabilities are written by
  the gate).
