# Payroll (payroll-core)

How your AI agent works with pay runs, payslips and pay items. The ops below are the same the screens use; `app.guide` lists every parameter.

## A pay run

- States: draft, calculating, calculated, approved, locked, paid, void. A locked run never changes and is never unlocked. Before payment a person voids and replaces it (`payruns.void`, PIN); after payment a correction run pays the differences only.
- Start: `payruns.create --schedule <id>` opens the next due regular run (or gives back the open one). Other kinds: `--kind off_cycle|bonus --employments '["E0001"]'` (or `--all true`), `--kind termination --employment E0001`, `--kind correction --corrects PR-0003 --employments '[...]'`, `--kind reimbursement`.
- Calculate: `payruns.calculate --payrun PR-0004`. Large runs work in chunks: while the answer says `done: false`, call again with `--continue true`.
- Year to date: every locked payslip of the tax year counts, whatever its pay date, so a bonus dated before a locked regular run of the same period sees it (warning `paid_before_locked_run`). Locking or voiding a run sends the same people's other calculated or approved runs back to draft.
- Held pay: `payruns.get` gives `to_pay_minor` (net less held pay, plus holds released into the run: the bank file total), `held_minor` and `held_count`. A held person's bank issues show as `held` and do not block.
- List: `payruns.list --status all` (default), `open`, or one status.
- Leaving: unused leave paid out on leaving is on `LEAVE_EXIT` (tags `exit_leave_payout`, `termination` and the enabled packs' own), set by the packs; never edit its tags.
- The approval of a run carries net to pay without held pay, and held pay apart; a hold added or taken off after it was sent asks for approval again.
- Check: `payruns.issues` (blockers stop approval; warnings need a person's acknowledgement with a reason; every issue has a code, a plain message and a fix link; a formula that read an empty value is `data_missing` with the field, a pack that failed otherwise is `pack_error`, the engine text in `detail`), `payruns.variance` (totals against the last regular run, people and components by size of change, with reasons from the data: raise, new_joiner, first_run, overtime, unpaid_leave, bonus, reimbursement, tax_profile, pack_version).
- Explain: `payslips.get --payslip <id>` and `payslips.line --line <id>` give the rule (formula, condition, rounding), every value it read, table rows and the pack version and sources. Quote those; never guess a rule.
- Reviews: triggers `payrun_review` (`payrun_id`) and `variance_explain` (`payslip_id`), asked by a person (recipes in app.guide). You write `payruns.note --kind review|flag`. You never approve, lock, void, publish, acknowledge warnings or release held pay: tell the person what to do.

## Pay items (proposals for you)

- One-off: `pay-inputs.add --employment E0001 --component BONUS --amount 500.00` (next period; `--payrun` to aim at a run). CSV: `pay-inputs.import-check --csv "..."` (a dry run you may run), then `pay-inputs.import`.
- Every period: `recurring.save --employment E0001 --component ALLOWANCE --amount 200.00 --from_day 2026-12-01`.
- Pay change: `comp.request --employment E0001 --amount 7000.00 --reason raise --effective_from 2027-01-01` (a pay_change approval decides it). Back-dated into a locked period: `backpay.preview`, then `backpay.apply --target next|off_cycle`.
- Loans: `loans.request` (loan approval; repaid through payroll at lock), benefits: `benefits.enroll`, tax profile: `taxprofile.submit --fields '{...}'` (pack field keys from `payroll.fields` or `taxprofile.get`), opening year to date figures: `ytd.set`.

## Data rules

- Money in answers is `_minor` integers of the currency; money params are major-unit text.
- Component tags are what rule packs read (us_fit_wages, sg_ow, jp_taxable, in_salary...). A new component copies the tags of the pack component of the same kind of pay.
- Pay figures are visible to you only while the owner allows it (`agent_sees_pay`).

## Events

`payrun.locked { payrun }`, `payrun.voided { payrun, replaced_by }`, `payrun.paid { payrun, paid_at }`, and `employment.changed { kind: pay | tax }` from approved pay changes and declarations.
