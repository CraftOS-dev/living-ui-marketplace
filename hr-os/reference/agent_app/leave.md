### Leave

Leave types per entity, policies with dated versions, a balance ledger worked out by one engine, requests through the kernel's approvals, the team wallchart, cashing in, unused leave paid out on termination, compensatory leave, the Japanese five-day rule and the annual paid leave register. Country defaults are seeded when an entity is created.

#### Requirements

- [x] Leave types per entity: paid or unpaid, days or hours, a lucide icon and a meaning colour of the theme, half days, hours, negative balance with a limit, certificate from N days, notice, longest stretch, calendar days (maternity), holidays inside counted or not, cash-in, paid out on termination (seeded where the law requires it), compensatory, who sees the type (type or only "away"), pay code, archive
- [x] Policies with one rule per type: fixed days a year, monthly accrual (at the start or end of each month, or progressive by day as in Australia), accrual per hours worked (from the time module), tenure tables (years or months of service, recalculated at the leave year or on each anniversary), the Japanese statutory grant schedule (full-time and proportional tables, 2-year expiry, oldest first), adjustments only, no balance; joining and leaving proration (a leaver's grants and accruals stop at the last day), rounding, waiting months, caps, carry-over limit and expiry, grant expiry, scaling by FTE or days a week (UK 5.6 weeks), bank holidays taken from the allowance (UK), one type counting another's days (Singapore and Malaysia hospitalisation includes sick leave), cash-in limit, hourly cap (Japan 5 days a year in hours)
- [x] Policy versions by day (changes apply from a day; earlier leave years keep their numbers), effective-dated assignments, the entity default followed from the first day by new hires
- [x] Bulk tools (leave control panel): assign a policy to many people, give or take days from many people, both with a preview
- [x] The ledger: grants, accruals, takes, adjustments with a reason, carry-over and expiry at the leave year close, lot expiry, cash-in, compensatory grants; the daily run (00:30 local per entity) writes what is due once by key, and corrections when a later change moves a number; reads always run the engine, so balances are right before the run and project to any future day
- [x] Balance explanation (how today's number was reached, with the running balance), lots and expiry, projection to a future day
- [x] Requests: full days, half days (morning, afternoon, start at noon, back at noon) and hours; working days of the person's schedule and holiday calendar; locked days with an allow list; notice; longest stretch; overlap refusal; balance check against the projection; who else in the team is away; certificate upload; approval kind `leave_request` through the kernel flows (auto-approve by days); managers and HR may go past a lock, notice or balance with a reason; HR may record leave as approved
- [x] Withdraw while waiting; cancel before the start at once; after the start the cancellation goes back for approval (HR cancels at once); come back early (cancel from a day)
- [x] Cashing in leave (kind `leave_encash`, manager then HR) reaches payroll through `payInputs.encash`; on `separation.approved` and `separation.changed` the unused balance of types paid out on termination becomes an approved cash-in on the last day (kept equal to the balance until payroll pays it with the final pay); compensatory leave for a rest day or holiday worked (kind `comp_off`) with expiry
- [x] Country defaults on `entity.created`: JP, SG, MY, IN, US (CA paid sick leave), GB, AU and a generic set for other countries, from the country data's statutory minimums plus this module's rules; `leave.seed-defaults` sets up an entity later
- [x] Japan: the five-day rule tracker (missed, at risk, on track, done; Monday notices to the person and HR) and the 年次有給休暇管理簿 register with CSV export (people only), kept for the grant period and 3 years
- [x] Pages: Leave home for HR (out today and this week, waiting, needs attention), the wallchart (month canvas, bars by type, hatched while waiting, days off and holidays per person, locked days, tap a day to request), the employee view (balances in one panel, "Request time off" in three taps: it opens on the calendar with the usual type), requests and one request, balances with the explanation and adjustments, settings (types, policies, locked days, bulk tools, daily run), the register; profile tab, Inbox approval context, Home widgets
- [x] Contracts: `lib_leave.payInputs(app, employmentId, from, to)`, `lib_leave.balance(app, employmentId, typeCode, day)`, `lib_leave.markEncashPaid(app, ids, payrunId)`, profile facts

#### Entities

| Collection | Purpose | Notes |
|------------|---------|-------|
| leave_types | Kinds of absence per entity | code unique per entity; colour rh, lh, good, warn, bad, ink; icon from a fixed list |
| leave_policies | Rules per type | `rules` (latest) and `history` [{from, rules}]: the version in effect on a day applies |
| leave_policy_assignments | Who follows which policy from a day | effective-dated, one row per employment and day |
| leave_ledger | Every movement of a balance | kind grant, accrual, take, adjust, carryover, expire, encash, comp_off; planned rows carry a `key`; balances are sums, never stored |
| leave_requests | Requests | status pending, approved, rejected, cancelled, withdrawn, cancelling; `day_list` per day; `warnings` it went past |
| leave_blocks | Locked days | entity, department, allow list of employees, types |
| leave_encash_requests | Cashing in leave | status pending, approved, rejected, withdrawn, paid; kind voluntary or exit (paid out on termination, with its `separation`); `pay_on`, `payrun`, `reserved_for`, `pay_history` |
| leave_comp_offs | Compensatory leave for a day worked | expiry from the policy |
| leave_sync | The daily run log | one row per entity and local day |

#### Operations

Group `leave` (45 operations): reads `leave.home`, `leave.attention`, `leave.mine`, `leave.balances`, `leave.balance`, `leave.ledger`, `leave.calendar`, `leave.out`, `leave.requests`, `leave.get`, `leave.check`, `leave.approval-context`, `leave.encashments`, `leave.comp-offs`, `leave.obligation`, `leave.register`, `leave.types`, `leave.policies`, `leave.policy`, `leave.assignments`, `leave.blocks`, `leave.sync-log`, `leave.attachment`; writes `leave.request` and `leave.comp-off-request` (proposals for your AI agent), `leave.withdraw`, `leave.cancel`, `leave.attach`, `leave.encash-request`, `leave.encash-withdraw`, `leave.comp-off-withdraw` (people only), `leave.adjust`, `leave.assign`, `leave.assign-bulk`, `leave.grant-bulk`, `leave.types-save`, `leave.policy-save`, `leave.block-save`, `leave.seed-defaults` (proposals for your AI agent), `leave.sync` (allowed), `leave.types-delete`, `leave.policy-delete`, `leave.assignment-delete`, `leave.block-delete`, `leave.register-export` (people only). Approvals are decided with the kernel's `approvals.decide` (people only).

#### Cron and events

- `cron_leave.js`: `leave_daily` every 15 minutes (UTC); each entity runs once a local day after 00:30.
- `events_leave.js`: `entity.created` (country defaults), `employment.hired` (default policy from the first day), `employment.changed` and `employment.ended` (balances again), `separation.approved` and `separation.changed` (payout on termination), `payrun.voided` and `payrun.locked` (cash-ins of a voided run paid by its replacement); approval kinds `leave_request`, `leave_encash`, `comp_off`; profile facts.
