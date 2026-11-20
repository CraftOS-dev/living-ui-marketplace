/**
 * app.guide section: payroll (payroll-core). Plain data; tools/gen_triggers.mjs reads the recipes.
 */
module.exports = {
  title: 'Payroll: pay runs, payslips, pay items, loans, tax profiles',
  rules: [
    'A pay run goes draft, calculated, approved, locked, paid. You may start and calculate runs (payruns.create, payruns.calculate), read issues and variance, and write review notes and flags (payruns.note). You never approve, lock, void, publish, release held pay or acknowledge warnings: tell the person what to do.',
    'payruns.create --schedule <id> starts the next regular run (it gives back the open one). Other kinds: --kind off_cycle|bonus --employments [...], --kind termination --employment E0001, --kind correction --corrects PR-0003 --employments [...], --kind reimbursement.',
    'payruns.calculate --payrun PR-0004; when the answer says done false, call it again with --continue true. Then payruns.issues (blockers stop approval; each has a fix link) and payruns.variance (people and components by size of change, with reasons).',
    'Every payslip line explains itself: payslips.get --payslip <id> and payslips.line --line <id> show the formula, the values it read, table rows and the pack version. Quote those when you explain pay; never guess a rule.',
    'Pay items are proposals for you: pay-inputs.add --employment E0001 --component BONUS --amount 500.00 (one-off; --payrun to aim at a run), recurring.save (every period), comp.request (a pay change, decided by a pay_change approval), loans.request, benefits.enroll, taxprofile.submit --fields \'{...}\'. A CSV of inputs: pay-inputs.import-check first (a dry run you may run), then pay-inputs.import.',
    'Back pay for a back-dated raise: backpay.preview --employment E0001 --from_day 2026-06-01 shows each locked period; backpay.apply --target next|off_cycle adds ARREARS inputs (a proposal).',
    'Codes, tags and roles are data: a component\'s tags are what rule packs read (us_fit_wages, sg_ow, jp_taxable, in_salary...). Copy the tags of the pack component of the same kind of pay when you suggest a new component.',
    'Locked runs never change. Before payment a person voids and replaces one (payruns.void); after payment a correction run pays the differences only.',
    'Year to date is every locked payslip of the tax year, whatever its pay date: a run dated before a locked run of the same people counts it (warning paid_before_locked_run). Locking or voiding a run sends the same people\'s other calculated or approved runs back to draft: calculate them again.',
    'Held pay is not paid with its run: to_pay_minor is net less held pay (plus holds released into the run), the bank file total. A held person\'s bank issues do not block the run.',
    'payruns.list --status all (default) | open | draft | calculated | approved | locked | paid | void.',
    'pay-schedules.save --pay_day_rule examples: {"kind":"day_of_month","day":25,"adjust":"before"} (the 25th, moved before a weekend or holiday) or {"kind":"period_end","offset_days":0}. payroll.settings employer fields are values the packs read, for example US SUI rates and wage bases, the JP insurer, the MY HRDF rate.',
    'payroll.settings-save: entity_fields is JSON of pack employer fields ({"ca_ui_rate":0.034}); approver_steps is the pay run approval flow ([{"type":"role","role":"finance"}]); go_live_day is the first pay day in HR OS.',
    'payruns.lock (people only, with the PIN): payslips freeze, inputs are marked used, loans repaid, time days locked, claims and advances marked paid; payslips publish on the schedule. payruns.ask-fix is for people: you hand an issue over with inbox.route.',
    'Opening balances: an entity\'s first pay run (or any run while a first pay day in HR OS is set) is blocked by opening_balances_missing, one blocker for the entity, when someone was employed before HR OS in a tax year that began earlier. ytd.sheet --entity <id> (or --payrun) lists those people and the figures their packs need (columns are tags and codes, for example us_fica_wages, us_futa_wages, US_FIT, in_salary, IN_TDS, sg_cpf_ow, SG_CPF_EE, gb_paye_taxable, GB_PAYE). From a file the owner gives you: ytd.import-check --csv (a dry run you may run), then ytd.import (a proposal); one person: ytd.sheet-save --employment E0001 --values \'{"us_fica_wages":"52000"}\' (a proposal). Amounts are major units. Only a person may confirm that nobody was paid earlier this tax year (ytd.no-earlier-pay): never claim it, ask them.',
    'ytd.set --day is the day the figures are up to (the day before the first HR OS pay period); by_tag and by_code are JSON in major units ({"us_fica_wages":42000}, {"US_FIT":5100}).',
    'payroll.person-set (a proposal): payroll fills only the personal fields packs read (birth_date, nationality, gender) when a payslip says data_missing for them; other personal details go to HR (people.update, or inbox.route).',
    'Op details: payruns.create --kind regular gives back the open run of the period when one exists; termination pays final pay to the last day; correction needs --corrects (a paid run) and --employments; reimbursement pays approved claims only. Locked runs never recalculate.',
  ],
  triggers: {
    payrun_review: 'Review one calculated pay run before a person approves it (params.payrun_id). payruns.get --payrun <payrun_id> (agent.note is what the person asked you to look at), payruns.issues and payruns.variance; open the payslips with the biggest changes (payslips.get, payslips.line). Look for what a careful payroll checker would: unexplained changes, people missing or new, zero or negative pay, unusual overtime or bonuses, tax lines that moved without a cause, warnings nobody acknowledged. For each finding: payruns.note --payrun <id> --kind flag --code <snake_case> --employment <id> --severity warning --body "<what, the numbers, which line>". Done: payruns.note --payrun <id> --kind review --body "<what you checked, what you found, what a person should do>". Never approve, lock or acknowledge. Use only the data you read.',
    variance_explain: 'Explain why one person\'s pay changed against the last run (params.payslip_id). payslips.get --payslip <payslip_id> gives the run, the person and the variance (prev_payslip, reasons); open the previous payslip and compare line by line, reading payslips.line --line <id> for the values a changed line used. Write the reasons in plain words with the amounts (for example overtime 6.5 hours more at 1.5x, a raise from 1 June, 2 days of unpaid leave). Done: payruns.note --payrun <run> --employment <employment> --kind review --body "<explanation>". Never guess a rule: quote the lines.',
  },
  recipes: {
    payrun_review: [
      'Review a calculated pay run before a person approves it (payrun_review; params.payrun_id).',
      '1) payruns.get --payrun <payrun_id> (its agent.note says what the person asked you to look at), payruns.issues --payrun <id> and payruns.variance --payrun <id>. Open the payslips with the biggest changes (payslips.get) and the lines that changed (payslips.line).',
      '2) Look for what a careful payroll checker would: unexplained changes over the threshold, a person missing or new, zero or negative pay, overtime or bonuses far from usual, tax lines that moved without a pay or profile change, warnings nobody acknowledged. Use only the data you read.',
      '3) For each finding: payruns.note --payrun <id> --kind flag --code <snake_case> --employment <id> --severity warning --body "<what, the numbers, which line>".',
      '4) Then payruns.note --payrun <id> --kind review --body "<summary: what you checked, what you found, what a person should do>". That closes the ask. Never approve, lock or acknowledge.',
    ],
    variance_explain: [
      'Explain why one person\'s pay changed against the last run (variance_explain; params.payslip_id).',
      '1) payslips.get --payslip <payslip_id> and the previous payslip (variance.prev_payslip). Compare line by line; for each changed line read payslips.line for the values it used.',
      '2) Write the reasons in plain words with the amounts (for example: overtime 6.5 hours more at 1.5x, a raise from 1 June, unpaid leave 2 days). variance.reasons lists what the data already shows.',
      '3) payruns.note --payrun <run> --employment <employment> --kind review --body "<explanation>". That closes the ask.',
    ],
  },
  events: ['payrun.locked { payrun }', 'payrun.voided { payrun, replaced_by }', 'payrun.paid { payrun, paid_at }', 'employment.changed { employment, kind: pay | tax, record, effective_from } (approved pay changes and tax declarations)'],
};
