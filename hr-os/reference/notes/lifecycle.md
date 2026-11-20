# lifecycle notes (HR OS)

Built 2026-11-04 by the lifecycle builder. 78 operations in `cat_lifecycle_checklists.js`,
`cat_lifecycle_letters.js`, `cat_lifecycle_separations.js`, `cat_lifecycle_records.js`.
Gate passes on the scratch copy. Tests in `reference/tests/lifecycle/`.

## Files

- Migration `pb/pb_migrations/1730006000_lifecycle.js`: 13 collections (checklist_templates,
  separations, checklists, tasks, letter_templates, letters, exit_forms, assets, handbook,
  handbook_versions, handbook_acks, grievance_types, grievances) and the default approval flow of
  the kind `separation` (`[{type: manager}, {type: role, role: hr_admin}]`).
- Libraries: `lib_lifecycle.js` (helpers, event subscribers, home, profile tab, welcome, daily
  job), `lib_lifecycle_checklists.js`, `lib_lifecycle_letters.js`, `lib_lifecycle_separations.js`,
  `lib_lifecycle_assets.js`, `lib_lifecycle_handbook.js`, `lib_lifecycle_grievances.js`,
  `lib_lifecycle_defaults.js` (plain data: country tasks, letter templates, exit questions,
  grievance types).
- `events_lifecycle.js`, `cron_lifecycle.js`, `guide_lifecycle.js`.
- Frontend: `pages/lifecycle/*` (index, Home, Board, Lists, Templates, Letters, Separations,
  Assets, Handbook, Grievances, Welcome, ProfileTab, widgets), `components/lifecycle/*` (types,
  bits, Acts, TaskRow, dialogs, Markdown), `i18n/lifecycle.en.ts`.

## Contracts other builders and the coordinator need

1. **Events emitted** (subscribe in your `events_<module>.js`):
   - `separation.approved { separation, employment, last_day, kind }`: emitted inside the
     approval decision's transaction (`ctx.app` is the transaction). Payroll: create the
     termination run here and **return `{ payrun: '<id>' }`**; lifecycle keeps it as
     `separations.settlement_payrun` and the full and final statement reads that run (link
     `#/payroll/runs/<id>`). Any subscriber result and error is stored in `separations.events`.
   - `separation.changed { separation, employment, last_day, kind }`: the last day of an
     approved separation moved (the kernel employment end moved with it).
   - `checklist.completed { checklist, employment, kind }`.
2. **Contracts lifecycle reads** (SPEC 3.5, called directly, no fallback):
   `lib_expenses.payInputs(app, employmentId, lastDay, currency, { via: 'any' })` (claims to
   reimburse and approved advances to pay out, by payroll or bank),
   `lib_expenses.advanceRecovery(app, employmentId, lastDay)` (advances to recover),
   `lib_leave.balance(app, employmentId, typeCode, lastDay)` for each row of
   `leave_types WHERE payout_on_exit = TRUE AND archived = FALSE AND (entity = <entity> OR entity = '')`,
   active `loans` (`employment`, `kind`, `balance_minor`, `currency`, `status = 'active'`),
   `payruns` by id (`number`, `kind`, `status`, `period_start`, `period_end`, `pay_date`,
   `currency`), the person's `payslips` row in it (not void: `gross_minor`, `deductions_minor`,
   `reimbursement_minor`, `net_minor`, `currency`) and its `payslip_lines` with `ref_kind =
   'encash'` (`code`, `name`, `qty`, `amount_minor`), and the approved exit cash-ins of the
   separation (`leave_encash_requests` with `kind = 'exit'`, `separation`, `status = 'approved'`;
   `days`, `type`) with their `leave_types` name.
   **Statement totals**: once payroll calculated the final run, `totals` is the person's
   payslip (`source: 'payrun'`: gross, deductions, reimbursements, net per currency); before
   that an estimate (`source: 'estimate'`: to pay, to recover, net). **Leave rows** come from
   the payslip's encash lines (days and amount, `valued: 'payrun'`), else the leave module's
   approved exit cash-ins of this separation, else (before those exist) the balances of the
   types paid out on exit, so the statement shows what final pay pays (`leave_from`: payrun, requests,
   balance); payroll exposes no daily rate, so until the payslip exists the days show
   "valued in final pay" (`amount_minor: null`).
3. **Kernel functions used**: `lib_people.endEmployment` on approval (then lifecycle sets
   `employments.notice_day` on the same record), `lib_approvals.open/cancel`, `lib_jobs.enqueue/
   finishFor`, `lib_notify.notify`, `lib_files.fileParam`, `lib_events.emit`. A letter is stored
   as a `documents` row (`source: letter`, `category: letter`, a plain-text copy as the file);
   its acknowledgement is the document's `acked_at` (one record).
4. **Profile facts** (`profileFacts: 'lib_lifecycle.profileFacts'`) return typed `ProfileFact`s
   (`lib/contract.ts`): `lifecycle.<kind>.open` and `lifecycle.<kind>.late` (`count`) per open
   checklist, `lifecycle.assets` (`count`), `lifecycle.last_day` (`date`, YYYY-MM-DD) for a
   separation in progress; never formatted text.
5. **Frontend exports** of `pages/lifecycle/index.tsx`:
   - `inboxSections`: `{ key: 'lifecycle.tasks', label: 'Checklist tasks', useItems, order: 30 }`
     (the viewer's open tasks due within 14 days or late, from `tasks.list --view mine --status
     open --due_before <today+14>`; item `{ id, title, sub: checklist name, link:
     '#/lifecycle/checklists/<id>', due, person, actions: [Done] }`, Done only when the task
     needs no file) and `{ key: 'lifecycle.read', label: 'To read', useItems, order: 35 }`
     (handbook pages the viewer still has to acknowledge). The kernel Inbox reads both
     (checked in the screenshot pass: `hr_inbox_*`).
   - `profileTabs`: `{ key: 'lifecycle', perm: 'people:view', order: 60 }` (also the person and
     their managers); open it with `#/people/<number>?tab=m.lifecycle`.
   - `homeWidgets`: `lifecycle.movers` (admin wide in two columns, manager narrow in one
     column; an empty state with Hire someone for `people:full`), `lifecycle.first_days`
     (employee narrow; renders nothing when there is nothing to show).
   - `nav` children under Lifecycle; employees reach their pages through the Inbox, Home
     widget, notifications and their profile tab (the Lifecycle place is `people:view|team`).
6. **Job kinds**: `onboarding_help`, `draft_letter` (recipes in `guide_lifecycle.js`). A checklist
   started by an event (hire, ending, approved separation) does not ask your AI agent inside
   that transaction: the cron job `lifecycle_agent` (every minute) asks about open checklists
   with open agent tasks that never had an `onboarding_help` job; lists started by hand ask at
   once. Run
   `node tools/gen_triggers.mjs` in APP so `triggers.json` carries them (lifecycle does not own
   that file).
7. **Notification links**: `#/lifecycle/tasks`, `#/lifecycle/letters/<id>`,
   `#/lifecycle/handbook/<id>`, `#/lifecycle/grievances/<id>`.

## Decisions

- Permissions use the kernel's `people` module (there is no `lifecycle` module level): HR =
  `people:edit` in scope; grievances need `people:full`; deleting templates and assets needs
  `people:full`.
- Onboarding starts only for first days at most 30 days ago (imports of existing staff start
  nothing); `checklists.start` covers the rest by hand.
- "IT" is members with the role code `it`; while no active member has it, HR takes IT tasks (a
  notice on the board says so). Unassignable manager or member tasks show to HR.
- Speed: `employment.hired` (onHire) reads the template once, resolves each assignee once
  (the manager once), saves the template's tasks without re-validating each field and defers the
  agent ask: about 20 to 30 ms for a 17-task list on the scratch copy (it was about 110 ms there,
  169 ms in the kernel's measure). Task lists share one memo per answer (today, names, date
  style, HR right per entity) and load task records in one read: `tasks.list` about 20 ms,
  `lifecycle.home` about 50 ms, `checklists.get` about 55 ms on the demo seed.
- Due offsets count calendar days; a task without a due day never reminds. A template task
  whose day is already past when its checklist starts is due today (a hire made close to the
  first day has nothing late); moving a last day never makes a task late that was not.
- The welcome page is for joiners: before the first day, the first 42 days, or while
  onboarding is open (`lifecycle.welcome` answers `joining`); others see a pointer to the
  handbook.
- Screens show dates only through `format.ts` (`fmtDay`; timestamps through `fmtStampDay` and
  `stampDayKey` with the record's entity, today through `today({ entity })`), money only through `Money`; the
  server's `*_shown` strings are for letters and notifications. Panels are numbered in
  reading order as they render (`panelNumbers()`), tiles carry no number; loading is
  skeleton rows; the Inbox Done action is a plain button (one primary per screen); the task
  check is a 40 px target.
- `letters.draft --kind <kind>` without `--template` uses the template of that kind for the
  person's entity, then its country, then the company (a built-in one first); a kind with none
  there is refused (400 `no_template`, listing the templates of that kind), and a draft with no
  text is refused (400), so no empty letter is ever stored or proposed.
- Letter placeholders are validated by exact key (`{{employee.name}}` ... or `{{letter.<word>}}`
  for a value given with the letter); missing values block issuing; pay placeholders render
  `[hidden]` for anyone without the right to see that pay, who then cannot issue.
- Grievance and separation texts and exit interview answers are `secret` params: they never
  reach the audit trail, and notifications carry only numbers.
- An approved separation cannot be withdrawn (the kernel cannot clear an employment end);
  HR moves the last day instead.
- Scratch-only stubs (never shipped): `lib_expenses.js`, `lib_leave.js`, `lib_payroll.js`,
  `events_payroll.js`, `lib_zstub.js`, `cat_zstub_core.js`, migration `1730009990_scratch_stubs.js`.

## Known gaps

- No stored PDF (print pages only, as SPEC 10 allows).
- The board sorts tasks by due day; there is no manual order per lane (the template order is
  kept in `sort`).
- PocketBase rate limiting: the kernel notes say the UI should retry a 429 once; `lib/api.ts`
  does not yet, so a burst can leave a view empty until the next change.
- Employee referrals are the hiring module's (as briefed).
