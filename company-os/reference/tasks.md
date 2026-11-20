# Tasks: Company OS

Every task cites what it implements. These features already exist in the published app `company-os` 1.0.0, so the build tasks are recorded as done.

## Build
- [x] T-1 (F-ACC-1, F-ACC-8): the kit's sign-in gate (`LoginGate`, email and an 8-character password) around the app, and the sidebar foot with the account's email and "Sign out".
- [x] T-2 (F-ACC-2): the sign-up guard (`access.pb.js`): new accounts are forced to pending members; the next sign-up while no approved owner exists becomes the approved owner.
- [x] T-3 (F-ACC-3): `useAuth.ts` exposes role and approval and refreshes the token on mount; `PendingApproval.tsx` shows "Waiting for approval" with "check again" and "Sign out"; migration `1700000700_access.js` limits every business collection to approved accounts.
- [x] T-4 (F-ACC-4): the onboarding wizard (`Onboarding.tsx`): welcome, six one-question screens with choice cards, step dots, Skip, Back, Next, Finish setup, and the building screen.
- [x] T-5 (F-ACC-5): `onboarding-complete` and `lib_company.seedCompany`: the company with its vocabulary pack, eight module rows by stage, 30 Journey steps, four starter metrics, the weekly meeting ritual, and the finishing person made the approved owner.
- [x] T-6 (F-ACC-6, F-ACC-7): Team > Access (`AccessManager`) listing pending and active accounts, and the `member-access` route enforcing who may approve, revoke, promote, demote and remove.
- [x] T-7 (F-NAV-1, F-NAV-2, F-NAV-5): `Sidebar.tsx`: brand block with initials and stage, grouped links filtered by active modules and role, the mobile top bar and drawer.
- [x] T-8 (F-NAV-3, F-NAV-4): `App.tsx` gating: inactive module pages render `ActivateGate` ("Turn on <Module>"), and members get the owner-only message on Money and Settings.
- [x] T-9 (F-NAV-6, F-JRN-5): the Journey auto-check (`lib_company.runAutocheck`, the `journey-autocheck` route) with one rule per step, called silently on app load and Journey open.
- [x] T-10 (F-HOME-1, F-AGT-7): the "CraftBot checkup" button firing `company_checkup_requested` through the trigger queue, and the status line following the request.
- [x] T-11 (F-HOME-2, F-JRN-6): suggestion cards (Advance through `stage-advance`, Take a look, Dismiss) and recommended-module cards on Home; `lib_company.runStageCheck` opens at most one stage suggestion.
- [x] T-12 (F-HOME-3): the cash hero: this month's in and out, the 90-day balance curve with a 60-day projection and run-out date (`CashFlowChart`), and the runway sentence.
- [x] T-13 (F-HOME-4, F-HOME-5): the "This week in your company" constellation and the momentum wall of metric panels (`viz.tsx`).
- [x] T-14 (F-HOME-6): the month calendar (`MonthCalendar`) fed by follow-ups, due unfinished cards, unpaid invoices and unpublished content, with month navigation.
- [x] T-15 (F-HOME-7, F-HOME-8, F-HOME-9, F-HOME-10): the Journey card, "Needs attention", "Open tasks" with click-to-advance status, and "This quarter" on Home.
- [x] T-16 (F-JRN-1, F-JRN-2, F-JRN-3): the Journey rail (`Journey.tsx`): stage nodes with taglines and progress, expanded steps, "Mark as done", "Undo" and "Do it now".
- [x] T-17 (F-JRN-4, F-JRN-7): the next stage's lock as a button once the current stage is complete; `lib_company.advanceStage` sets the stage, marks newly recommended modules as suggestions and closes open stage suggestions.
- [x] T-18 (F-CUS-1, F-CUS-2): Customers list with search and the pipeline board with per-stage count and value, drag to change stage (`Customers.tsx`).
- [x] T-19 (F-CUS-3, F-CUS-4): the customer form with the vocabulary's stages, the follow-up auto-check and stage recompute after each save, and delete with confirmation.
- [x] T-20 (F-CUS-5, F-MON-5): exports in `lib/export.ts`: contacts and ledger CSV downloads, and print documents for the pipeline summary, the financial summary and an invoice.
- [x] T-21 (F-MON-1, F-MON-2): Money's cash block with Update, runway sentence, stat tiles, and the month-grouped ledger with add and delete.
- [x] T-22 (F-MON-3, F-MON-4): invoices with the dynamic badge, Mark sent, Mark paid, Record income (Sales entry and `recorded`), edit and delete.
- [x] T-23 (F-KAN-1, F-KAN-2): the three-column Kanban board with card faces, quick add and drag between columns (`Kanban.tsx`).
- [x] T-24 (F-KAN-3, F-KAN-4, F-KAN-5, F-KAN-6): the task dialog: title, status, due, person in charge, the TipTap Markdown note with debounced save, the three-state checklist, attachments, and delete with confirmation.
- [x] T-25 (F-GOL-1): priorities and goals on the Goals tab with their forms and confirmations.
- [x] T-26 (F-GOL-2, F-GOL-3, F-GOL-4): the Numbers scorecard (8 weeks, hit and miss tint, 4-week average, sparkline) with editable cells, and the metric manager.
- [x] T-27 (F-GOL-5, F-GOL-6, F-GOL-7, F-GOL-8): the roadmap canvas (`RoadmapCanvas.tsx`, `NodeGraph.tsx`): milestones, prerequisite links with the cycle check, selection, copy and paste, undo, auto-layout, pan, zoom, minimap and time dividers.
- [x] T-28 (F-TEAM-1, F-TEAM-2, F-TEAM-3): Team's People, Seats and Hiring tabs with their forms, the seats each person holds, and the Hiring tab from the Grow stage.
- [x] T-29 (F-MTG-1, F-MTG-2, F-MTG-3): Meetings: rituals with cadence, agenda and last held, logged notes and decisions, and the issues list with solve.
- [x] T-30 (F-PRC-1, F-PRC-2): Processes with numbered steps and the per-type starter templates on the empty page.
- [x] T-31 (F-MKT-1, F-MKT-7): the marketing KPI strip, the reading sentence, the insights and funnel coverage, computed from channels, campaigns, content, money and customers.
- [x] T-32 (F-MKT-2, F-MKT-3): campaign cards grouped by status with the goal filter, budget and target progress, Set active, Mark done, and Record spend (Marketing expense plus spend).
- [x] T-33 (F-MKT-4, F-MKT-5): the AI ideas dialog (`ai-campaign-ideas`), the content pipeline and calendar, next-status buttons, and Draft copy (`ai-content-draft`).
- [x] T-34 (F-MKT-6): channels with monthly cost and the "Where the money goes" mix bar.
- [x] T-35 (F-NOT-1): Notes cards with pinned first, search, the reading dialog and the note form.
- [x] T-36 (F-FIL-1, F-FIL-2, F-FIL-3, F-FIL-4): Files: folders and breadcrumb, four views remembered in local storage, upload, new folder, drag to move, the full-page preview, and deletes with confirmation.
- [x] T-37 (F-PRF-1, F-PRF-2, F-PRF-3): the Company Profile: six plan sections saved on blur with the auto-check, values capped at five, and "Draft empty fields with AI" (`ai-draft-plan`).
- [x] T-38 (F-SET-1, F-SET-2): Settings: company name, the stage select with its confirmation dialog, the owner row, and module switches that hide and keep data.
- [x] T-39 (F-SET-3, F-SET-4, F-SET-5): the four workflows (`workflows-run`, recorded in `workflow_runs`), the daily `companyOsDailyTick` cron at 06:00, and the weekly digest note with the optional AI paragraph.
- [x] T-40 (F-AGT-1): the read-only agent operations in `lib_agent.js`: `company.overview`, `journey.status`, `customers.pipeline`, `money.summary`, `goals.scorecard`, `marketing.dashboard`, `team.list`, `files.download`.
- [x] T-41 (F-AGT-2, F-AGT-5): the write agent operations mirroring the screens' rules and follow-ups (`company.update`, `journey.set_step`, `customers.save`, `money.record_invoice_income`, `marketing.record_spend`, `goals.set_number`, `roadmap.link`, `processes.use_template`, `files.upload`, `kanban.attach`), with role and module checks and coded refusals.
- [x] T-42 (F-AGT-3, F-AGT-4): the agent surface in the framework files: 28 entity collections with login accounts hidden, onboarding and member access not declared, and the `no_company` refusal.
- [x] T-43 (F-AGT-6): `kanban.detach` and `roadmap.auto_layout` declared destructive, so the adapter asks for the person's approval.

## Verification
- [ ] Agent App Framework gate (`agent-app <dir> validate`) passes, including the describe budget on a dev instance.
- [ ] Every declared operation answers through `a2app` on a live instance.
- [ ] The View renders identically to the published build (screenshot comparison).
