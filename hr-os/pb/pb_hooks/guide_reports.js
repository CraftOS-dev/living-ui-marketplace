/**
 * app.guide section: Home and Reports. Plain data. The module has no trigger
 * of its own; questions about numbers arrive with question_asked and are
 * answered from these reads.
 */
module.exports = {
  title: 'Home and reports',
  rules: [
    'What needs attention across HR: home.admin (approvals, your pending proposals, pay run blockers, identity and other documents expiring within 60 days, starters and leavers without an onboarding or offboarding checklist, probations ending within 14 days). Its items carry an action (op and params) people run with one tap; you may propose checklists.start yourself.',
    'A manager team question ("who in my team is out", "whose probation ends"): home.manager as that manager is not possible for you; use attendance.board, leave.out and people.directory with the department or manager filters.',
    'People analytics, all reads with the filters --entity, --department (sub-departments count), --location, --from, --to: reports.headcount (month ends, --group_by entity|department|location), reports.movement (joiners, leavers, turnover voluntary or involuntary from the separation kind), reports.tenure, reports.span, reports.diversity, reports.absence (at most 12 months), reports.hiring (funnel and days to hire), reports.training.',
    'Pay reports need pay access (and the company switch that lets you read pay): reports.cost (locked and paid runs by pay month, gross plus employer costs, in --currency, default the company reporting currency), reports.comp-bands (yearly full-time pay against the grade range), reports.leave-liability (days for everyone with the report, money with pay access; --basis payout (types paid out when someone leaves) by default, or paid).',
    'Money in reports is minor units of the currency named next to it. Converted figures use the kernel exchange rate of the month end or the day; groups without a rate are left out and listed in missing_fx: say so in your answer, and suggest fx.refresh or fx.set to a person.',
    'Diversity is aggregate only: groups of fewer than 5 people come back with count null, shown as "fewer than 5", and a second group is hidden when only one would be. Never try to work out who is in a small group, never combine reports to narrow a group down, and never name anyone in a diversity answer.',
    'Turnover is leavers in the period divided by the average headcount of its months (turnover_annual_pct scales it to a year). A leaver without an approved separation counts as not_recorded, never guessed from the end reason text.',
    'CSV files (reports.export) are for people; you read the reports themselves.',
    'Op details: reports.absence counts half days as half; company figures are kept per month (counted_at) and --fresh true counts them again now. home.admin shows the cost chart only with pay access, and its globe gives each office (entity, or location with one entity) with place, time zone, headcount, in now, remote, on leave, open roles, next pay day and the payroll this month; home.me --places also gives the Me place counts (tasks, pages to read, last payslip, kiosk PIN).',
  ],
  recipes: {},
  events: [],
};
