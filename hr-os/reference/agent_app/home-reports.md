### Home, Me and Reports

The first page everyone sees, by role, the employee self-service hub, and the people analytics across every module. Home places the modules' Home widgets (order and size from their exports) around its own panels; Reports lists every report in the app and runs eleven cross-module reports with filters, a chart first, the table and CSV.

#### Requirements

- [x] Admin Home (HR, payroll, finance): Needs you grouped by type, each group opening in place and gone when empty: approvals waiting for you (approve in one tap; PIN ones ask the PIN), your AI agent's proposals, pay runs with blockers, identity and other documents expiring within 60 days, starters without an onboarding checklist and leavers without an offboarding one (Start onboarding or offboarding in one tap), probations ending within 14 days, and every module's Inbox section (tasks, reviews and feedback owed, expenses, filings, shift swaps)
- [x] The pay runs of every schedule (days to pay day and to the input cutoff, the run's state and blockers, from payroll.home), readouts (headcount with a 12-month sparkline, joiners this month, out today of everyone, the last locked month's payroll cost in the reporting currency, naming any currency without a rate), a quiet 12-month chart of gross pay and employer costs with the headcount line (joiners and leavers without pay access), your AI agent's recent jobs and actions with the ask box
- [x] Setup guide from the kernel's setup steps, led by the next step with its action (a new company: "Add your first people", hire or import), gone once every step is done
- [x] Manager Home: Needs you (approvals, probations, module sections), the person's own clock, Team today from the time board (in, not in, away, off), team readouts (team and direct, out today, leave days this month, probations in 30 days), the manager widgets
- [x] Employee Home: the clock and the leave balance first (on a phone the first two things), Needs you (documents to acknowledge in one tap, every module's items), the employee widgets, my requests across every module with status, my questions to your AI agent with the answers
- [x] A sign-in without an employee record: administrators link it to their person in place or add themselves as an employee; anyone else is told who links it
- [x] Me hub: who I am here, the facts every module keeps on me, and my places: details (personal, emergency contacts, address, dependants; bank change requests; tax details from the payroll module with its own form for changes; the kiosk PIN), documents, pay, requests, tasks, goals and reviews, handbook, directory, your AI agent, time, leave, expenses
- [x] Company directory for everyone (work details only), searchable, by department
- [x] Reports hub: every report the person may open (the eleven here and the modules' own, listed by their routes)
- [x] Reports: headcount over time (by entity, department or location), joiners, leavers and turnover (voluntary and involuntary from the separation kind, not recorded otherwise), tenure, span of control, diversity (aggregate counts, groups of fewer than 5 hidden, a second group hidden when one would be worked out), pay against grade ranges (payroll view), payroll cost (reporting currency), leave liability (days; money with pay access), absence and overtime, hiring funnel and time to hire, training completion
- [x] Each report: filters (entity, department with its sub-departments, location, period or day, reporting currency) kept in the address, a chart first, the figures, the table, CSV export (people only, audited)

#### Entities

| Collection | Purpose | Notes |
|------------|---------|-------|
| report_cache | Company figures that need the time and leave engines for everyone (absence per person and month, leave balances per person on a day) | kind absence_month or leave_balances; used while the fingerprint of its inputs matches (the running month also 20 minutes); computed again otherwise; never a source of truth |

Everything else is read from the kernel's and the modules' collections (reads only, aggregates with COALESCE and CAST, no sealed value).

#### Operations

Group `home` (4 operations, reads): `home.admin` (HR, payroll and finance), `home.manager`, `home.me` (`places` adds the Me hub's facts and counts), `home.directory`. Each draws a whole page in one read, running the modules' reads it shows as the caller. Group `reports` (13 operations, reads): `reports.list`, `reports.headcount`, `reports.movement`, `reports.tenure`, `reports.span`, `reports.diversity`, `reports.comp-bands` and `reports.cost` (payroll view; your AI agent only when the company lets it read pay), `reports.leave-liability`, `reports.absence` (whole months; `fresh` counts again), `reports.hiring`, `reports.training`, and `reports.export` (CSV of any of them; people only).

#### Cron and events

- `cron_reports.js`: `reports_warm` every 10 minutes: the current month's absence figures (and the last month's in the first five days) and today's leave balances counted again when their inputs changed; balance days older than 14 days are dropped.
- No events.
