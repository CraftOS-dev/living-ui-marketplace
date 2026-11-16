# expenses builder notes (HR OS)

Built 2026-11-04. 46 operations (14 read, 32 write; 19 people only, 3 proposals, 3 destructive). Module section: `reference/agent_app/expenses.md`. Tests: `reference/tests/expenses/` (208 API checks in t01 to t04, all passing on empty and seeded scratch databases; t05 screenshot pass and the kernel's UX and 16-pack contrast audits on the expenses pages, all clean). Gate passes on the scratch copy.

## Files

- `pb/pb_migrations/1730003000_expenses.js`: expense_categories, expense_policies, travel_requests, advances, claims, claim_lines, advance_settlements; default approval flows for claim, advance, travel.
- `pb/pb_hooks/lib_expenses.js` (core: access, flags, views, events, approval subscriber, payroll contracts, cron), `lib_expenses_claims.js`, `lib_expenses_trips.js`, `lib_expenses_admin.js`, `lib_expenses_fx.js` (rate of the day), `lib_expenses_seed.js` (defaults); `cat_expenses_{claims,admin,trips}.js`, `events_expenses.js`, `cron_expenses.js`, `guide_expenses.js`.
- Frontend: `pages/expenses/*` (index, Home, Mine, Claims, Claim, Advances, Travel, Settings, approvals, types), `components/expenses/*` (parts, AddExpense, LineEditor, SpendBars, ApprovalViews, Panels), `i18n/expenses.en.ts`.

## Frappe parity (expenses list)

Expense claim type (categories with limits, receipt rule, GL account, pay component) yes; expense claim and details yes; taxes and charges on claims: tax included per line (no separate charge rows); employee advance and settlement against claims yes (plus repayment and payroll recovery); travel request with itinerary and costing yes; purpose of travel yes (fixed list); mileage yes (vehicle log and service as mileage lines); receipt capture read by your AI agent yes; reimbursement through payroll or a bank reimbursement run yes (the bank file itself is payroll's).

## Decisions

1. Receipt readings are a suggestion on the line, not a kernel proposal: kernel proposals go to HR (`expenses:edit`), but the claimant must confirm their own receipt. `claim-lines.read-result` is `agent: 'allow'` and writes `agent_read`; with autonomy expenses = auto it fills only the fields the person has not typed. The claimant uses it (`accept-reading`) or dismisses it; a reading still waiting blocks submission.
2. Finance above an amount: kernel flows have no amount condition, so `claims.submit` appends a `{ type: 'role', role: 'finance' }` step to the new approval's steps (same transaction) when the total is at or above the entity's `finance_over_minor` and the flow has no finance step. If the kernel adds conditional steps later, this moves into the seeded flow.
3. Limits are per expense line and per day (not per claim): that is what catches a single large meal and several meals on one day.
4. Flags are computed on every change and stored (lists filter on `flag_count`); a policy change shows on the next change or at submission (submit recomputes every line).
5. Claim currency is the entity's pay currency; lines keep their own currency, rate, rate day and source.
6. Mileage rates are minor units per unit and may be fractional (72.5 US cents a mile); every amount computed from them is a whole minor unit.
7. Money on screen goes through the kernel `Money` only (codes when currencies mix, blank behind Hide pay); amounts never travel as server-formatted text (flag sentences are drawn from the flag code and params, audit summaries carry no amounts, profile facts are typed).
8. "Paid" by settlement: a claim fully covered by an advance the person already received becomes paid (`paid_via: advance`).

## Contract changes (SPEC 3.5, additive)

- `payInputs` takes an optional 5th `opts { via }` and its items carry `ref` (pass it to markPaid), `advance`, `kind`, `number`, `name`, `categories`, `pay_via`, and on conversion `original_minor`, `original_currency` or `issue`.
- `markPaid` accepts claim ids, advance ids (payout via payroll, or full recovery) and `{ advance, amount_minor }` (partial recovery).
- New `unmarkPaid(app, payrunId)` and `outstanding(app, employmentId)`.
- `markPaid` sets `paid_day` to the run's `pay_date` and `paid_reference` to its number (today and "Pay run <id>" when the id is not a pay run).
- Profile facts follow the kernel `ProfileFact` (lib/contract.ts): `{ key, label, value, kind: 'money' | 'count', currency?, tone: 'neutral' | 'warn', link }`, money as integer minor units, no formatted text.
- `advanceRecovery` items add `number`, `purpose`, `name`, `reason`.

## QA round (2026-11-05, UI_FINDINGS E1 to E9)

- E1 phone summary as rows (no truncated tiles); E2 a receipt being read is a wait (flag severity `wait`, neutral note, quiet agent mark), and typing the amount or submitting closes the read job; E3 the expense editor saves optimistically; E4 claims and advances paid by a run take the run's pay date and number; E5 Home card: action inside the panel, drafts listed, no letter index; E6 "Ask for an advance" on the empty advances list; E7 a manager with no employee record gets an empty team, not a 403; E8 no repeated category, panels numbered in order; E9 typed facts (`kind: money`, value in minor units, `currency`).
- Shared rules: type scale 12, 13, 14, 15, 26 (10.5 only through `.hr-label`); 40 px touch areas (`hit`, 40 px chips, page actions in a phone row at the top of the body so the header keeps the title); dates through `format.ts`; no `always` on Money.
- QA2 N18: the reading card shows only while your AI agent reads, suggests, filled in or failed, or when the person used its reading (`shownReading` in parts.tsx), so a line the person typed in shows none; a paid claim's "Paid by" says how it was paid (payroll with the pay run number, bank with its reference, or an advance); claim lists show one cell, the number then the title when there is one (`ClaimName`), so no "EXP-0001 · EXP-0001". One primary button per screen: the Home "Decide in the Inbox" button is default, the Home header "Claims" is default when there is nothing yet, and My expenses hides its header "Add expense" while the empty state carries it. t04 writes its receipt to a temp folder outside the app (the app refuses its own files) and points at `APP/.agent-token`, so it passes from APP's `reference/tests/expenses/` too.
- QA2 N3: timestamps show the office's day: sent days and approval history through `fmtStampDay(ts, { entity })`, and every default or latest day picked (add expense, paid on, repayment) through `today({ entity })` with the claim's, advance's or employment's entity (`AddExpense` takes an `entity`). The kernel's `sweep_stamps.py` dry run finds nothing left in expenses files.

## Needs

- Payroll: a non-taxable reimbursement component `REIMB`, a non-taxable payout component `ADVANCE` (advances paid with the run), and a deduction component for advance recovery; call `payInputs` when calculating (regular runs default `via: payroll`; a `reimbursement` run with `via: 'bank'`), `markPaid` with the refs at lock, `unmarkPaid` at void.
- Lifecycle: `outstanding(app, employmentId)` for the full and final statement.
- Coordinator: run `node tools/gen_triggers.mjs` in APP so `triggers.json` carries the `read_receipt` recipe.
- Kernel-frontend: the Inbox card header uses `Money` with the symbol display, so SGD and USD both read "$"; `display: 'code'` there would remove the ambiguity.

## Known gaps

- No per diem rate tables, no corporate card feeds, no splitting one receipt across categories (add two lines).
- PDF receipts show an icon (open in a new tab), not a thumbnail; HEIC photos preview only where the browser decodes them (uploads are kept as they are).
- Advances have no write-off; settle by claims, repayment or payroll recovery.
- Exchange rates: a line whose rate cannot be found waits for the person to type it; the home chart converts mixed currencies at stored or fetched rates and lists any currency it could not convert.
