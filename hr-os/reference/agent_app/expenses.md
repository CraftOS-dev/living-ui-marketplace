### Expenses

Claims with receipts your AI agent reads, employee advances and travel
requests, reimbursed through payroll or by bank transfer.

#### Requirements

- [x] Categories per entity, seeded on `entity.created`: meals, travel, lodging, mileage (the country's common rate as an editable default: US 72.5 cents a mile, GB 45p a mile, AU 88c, CA 72c, DE 30c, SG and MY 0.60, JP 20 yen, IN 12 rupees a km), phone and internet, training, office supplies, client entertainment, other; limit per expense and per day, receipt rule (always, from an amount, never), taxable, pay component (REIMB), GL account, archive instead of delete once used
- [x] Expenses policy per entity: finance also approves from an amount, age and weekend flags, how claims and advances are paid, how advances are settled and when recovery from pay starts
- [x] One-line expense (amount, category, day) or a receipt photo; the photo makes a draft line and asks your AI agent about the claim (trigger `receipt_review`, once while that ask is open); your AI agent reads the file by its local path and writes a suggestion the employee uses or dismisses (filled in directly when the owner set expenses to automatic, never over what the person typed)
- [x] Lines in any currency with the rate of the day to the claim currency (Frankfurter, then currency-api, then the company's stored rates; or the rate the person typed); mileage is distance times the category rate
- [x] Policy flags per line, shown and never blocking: over the limit, over the day limit, missing receipt, weekend, duplicate (same merchant, amount and day), older than the policy allows; your AI agent's flags (possible duplicate, generated or edited image, not a receipt, unclear, restricted item, amount differs) until a person clears them; a reason field per line; only missing data blocks a submission
- [x] Submit opens an approval of kind `claim` (its flow, plus finance at or above the entity's amount); approvers leave single expenses out with a reason and approve the rest, from the Inbox in one tap with receipt thumbnails
- [x] Reimbursement with the next pay run (`payInputs`, `markPaid` at lock, `unmarkPaid` at void) or by a separate reimbursement run (`payInputs` with `via: 'bank'`) or marked paid by finance with a reference; "paid" comes only from payroll, a person with a reference, or full settlement against an advance
- [x] Advances: request, approval `advance` (manager then finance), paid by finance (or with the pay run), settled by later claims, a repayment, or recovery from pay (`advanceRecovery`); the whole balance of a leaver is recovered from the final pay
- [x] Travel requests: purpose, days, destinations, itinerary, estimate by category, approval `travel`; claims link to the trip and the trip shows what was claimed against the estimate
- [x] Pages: home for HR, finance and managers, the claims list (dense, filtered, CSV of claims or lines), claim detail (lines beside their receipts, flags, approvals, history), the employee view (one "Add expense", the camera on a phone), advances, trips, settings; profile tab; Home widgets; an Inbox section for the employee's own drafts

#### Entities

| Collection | Purpose | Notes |
|------------|---------|-------|
| expense_categories | Categories of an entity | `limit_minor`, `per_day_limit_minor`, `receipt_rule`, `receipt_over_minor`, `mileage_rate_minor` (minor units per km or mile; may be fractional), `component`, `gl_account`, `archived` |
| expense_policies | One per entity | finance amount, age, weekends, pay and recovery choices |
| claims | A person's claim | number `EXP-0001`, claim currency = entity currency, `total_minor`, `approved_minor`, `advance_applied_minor`, `pay_via`, `payrun`, `paid_via`, `paid_reference`, `flags` summary |
| claim_lines | Expenses of a claim | own amount and currency, `fx_rate`, `fx_day`, `fx_source`, `base_minor`, `tax_minor`, `receipt` (protected file), `receipt_status`, `flags`, `agent_read` (your AI agent's reading), `agent_flags`, `edited`, `status` included or rejected with `reject_reason` |
| advances | Advances | number `ADV-0001`, `balance_minor` (amount paid less settlements), `pay_via`, `recover_via`, `recover_from` |
| advance_settlements | How an advance was settled | kind claim, payroll or repayment |
| travel_requests | Trips | number `TRV-0001`, `destinations`, `itinerary`, `costs`, `estimate_minor` |

#### Operations

46 operations in `cat_expenses_claims.js`, `cat_expenses_admin.js`, `cat_expenses_trips.js`. Groups: `expenses` (home, me, spend, policy, policy-save), `expense-categories` (list, save, seed, delete), `claims` (list, get, create, update, submit, withdraw, reopen, cancel, delete, reject-lines, mark-paid, set-payment, export), `claim-lines` (add, update, delete, receipt, read-again, read-result, read-failed, accept-reading, dismiss-reading, flag, clear-flag, waiting), `advances` (list, get, request, cancel, mark-paid, settle, update), `travel` (list, get, save, submit, cancel).

Your AI agent: reads everything; drafts claims, lines and trips for a person who asked; reads receipts (`claim-lines.receipt` gives the local path; `claim-lines.read-result` or `read-failed` answers; the last receipt of the claim closes the ask); flags lines; category and policy changes are proposals (kind expenses). People only: submitting, withdrawing, cancelling, approving (kernel), rejecting lines, accepting or dismissing a reading, clearing flags, marking paid, payment routing, advances, exports.

#### Contracts (payroll calls these; lib_expenses.js)

- `payInputs(app, employmentId, upToDay, currency, opts)` -> `[{ claim, advance, ref, kind: 'claim'|'advance', number, component, amount_minor, currency, taxable, name, categories: [{ code, gl_account, amount_minor }], pay_via, original_minor?, original_currency?, issue? }]`. Approved claims with `approved_day <= upToDay`, one item per claim and pay component (an advance applied to the claim is taken off). `opts.via`: `payroll` (default, a regular run), `bank` (a reimbursement run), `any`. Advances paid out with payroll come as `kind: 'advance'`, component `ADVANCE`. Another currency is converted at the stored rate of `upToDay` (`issue: { code: 'no_rate', severity: 'blocker' }` when there is none).
- `markPaid(app, ids, payrunId)` at lock, on payroll's transaction handle: pass each item's `ref` from payInputs and, for advance recoveries, `{ advance, amount_minor }` with the amount actually deducted (a bare advance id recovers the whole balance). Idempotent per run.
- `unmarkPaid(app, payrunId)` when a locked run is voided before payment: its claims go back to approved, its advance payouts back to approved, its recoveries are undone.
- `advanceRecovery(app, employmentId, upToDay)` -> `[{ advance, number, amount_minor, currency, purpose, name, reason: 'due'|'leaving' }]`.
- `outstanding(app, employmentId)` -> `{ approved_unpaid_minor, open_claims, advance_balance_minor, advances_unpaid }` for the final settlement.

#### Events, approvals, cron, triggers

- Subscribes to `entity.created` (categories and policy). Handles approval kinds `claim`, `advance`, `travel` (default flows seeded by the migration: claim manager; advance manager then finance; travel manager). Profile facts: open claims, awaiting reimbursement, advance to settle.
- Cron: `expenses_reminders` Mondays 01:00 UTC (drafts left a week; bank claims to pay). Nothing asks your AI agent again about a receipt: the claim shows an unanswered ask with Retry.
- Trigger `receipt_review` (params `claim_id`; recipe in `guide_expenses.js`; run `node tools/gen_triggers.mjs` after merging).
