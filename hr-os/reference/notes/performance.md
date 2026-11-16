# performance notes (HR OS performance module)

Built 2026-11-04 by the performance builder. 88 operations in 6 catalog files
(32 read, 56 write; 40 people only, 18 proposals of kind `performance`,
9 destructive). Migration `1730007000_performance.js`. Tests:
`reference/tests/performance/` (t01 to t05 plus the i18n check and the
screenshot pass; seed data in `seed_perf.mjs`).

## Files

- `pb/pb_migrations/1730007000_performance.js`: 15 collections (below), the
  company settings row, three built-in templates (Annual review, Probation
  review, Quarterly check-in) and the default `review_signoff` approval flow
  (one step: role `hr_admin`; admins can change it in Settings, Approvals).
- `pb/pb_hooks/lib_performance.js` (access, settings, Home, Inbox, profile tab,
  profile facts, employment.ended, reminders), `lib_performance_goals.js`,
  `lib_performance_reviews.js` (templates, cycles, participants, reviews,
  sharing, sign-off, calibration, summaries, context, export),
  `lib_performance_feedback.js`, `lib_performance_skills.js`,
  `lib_performance_training.js`.
- `cat_performance_{core,goals,reviews,feedback,skills,training}.js`,
  `events_performance.js`, `cron_performance.js`, `guide_performance.js`.
- Frontend: `pages/performance/*` (Home, Goals, GoalPage, Cycles, CycleWizard,
  Review, Calibration, Feedback, Skills, Training, Settings, ProfileTab,
  index), `components/performance/{types.ts,bits.tsx,dialogs.tsx}`,
  `i18n/performance.en.ts`.

## Access model (lib_performance.relation)

For one employee the caller has `hr` (their performance level within their
entities), `self`, and `depth` (1 direct manager, 2+ above; team-scope roles
only, like `lib_auth.isManagerOf`). Managers act on their whole tree without
module rights. Company and team goals are visible to everyone; personal goals
to the person, their managers, HR and your AI agent. Reviews: the reviewer
always; the person their self review and, once shared, the manager review;
managers and HR the submitted reviews (HR full also drafts); peer and upward
reviews never reach the person; upward reviews are shown without the
reviewer's name except to HR. `reviews.context` gives a peer or upward
reviewer only public praise (no goals, check-ins or trainings).

## Decisions

- Cycle `status` is draft, active, closed; phases are dated rows and the
  current phase is computed from today (phases may overlap). People can submit
  late while the cycle is active; due days and reminders follow the phases.
  HR moves a phase with "start now" and "end now" (edits its days).
- Sharing, acknowledgement and sign-off live on `review_participants.stage`
  (open, submitted, shared, acknowledged, signoff, signed, removed). The
  manager shares from the sharing phase on (or at once when the cycle has no
  sharing phase); HR at any time or all at once.
- The overall rating is the reviewer's choice; the weighted score from the
  section ratings is shown beside it for reference only. Calibration sets
  `final` with a required reason, a history entry and an audit row with before
  and after; `final 0` returns to the manager's rating. Only before sharing.
- Autosave (`reviews.save`) writes no audit row (it fires every few seconds);
  submit, reopen, share, acknowledge, calibrate and every other write do.
- The summary job: `reviews.request-summary` (the reviewer) queues
  `draft_review_summary`; your AI agent reads `reviews.context --summary <id>`
  (computed as the requesting reviewer) and answers with
  `review-summaries.submit` (text plus sources of kind goal, checkin,
  feedback, praise, training, review). The op has no rating parameter, and the
  submit closes the job (`lib_jobs.finishFor`). A failed or cancelled job shows
  as failed with the reason; dismissing a pending request cancels its job.
- Required trainings: "within N days of joining" counts from the later of the
  start day and the day the requirement was added, so adding a requirement
  does not make long-tenured people overdue at once. Completions expire after
  the program's `valid_months`; an expired one is overdue from its expiry day.
- Skills: the kernel's `employee_skills` holds people's levels (skill name as
  text); the library's `name` is the join key, so a skill people hold keeps its
  name (rename refused, archive instead). Expected levels per job title live on
  the library skill (`expected` json).
- Reminders: one hourly cron; review reminders at 09:00 local per cycle entity
  (company-wide cycles use the first entity), training reminders Mondays at
  09:00 per person's entity; `perf_nudges` keys make each reminder once a day
  per review (once a week per training requirement); pruned after 120 days.
- employment.ended: the person leaves open cycles (stage removed) and their
  unwritten peer and upward reviews are declined.

## Contract changes from SPEC 4

- `review_cycles.status` draft, active, closed (not the phase enum); added
  `phases` json, `template_snapshot`, `launched_*`, `closed_*`.
- `reviews.status` draft, submitted, declined; added `participant`, `score`,
  `started_at`, `saved_at`, `declined_reason`, `reminded_on`. Shared and
  signed are participant stages.
- New collections: `perf_settings`, `goal_checkins`, `review_participants`,
  `review_summaries`, `training_programs`, `training_requirements`,
  `perf_nudges`.
- `goals`: added `department`, `entity`, `start_day`, `last_checkin`,
  `created_by`, `origin`, `sort`; key results carry `key` and `start`.
- `feedback`: added `from_member`, `from_actor`, `about_employee`, `status`,
  `due`, `cycle`, `entity`, `request`, `declined_reason`. `visibility manager`
  means the recipient's managers and HR see it, the recipient does not.
- `trainings` gained `program`, times, `trainer`, `description`;
  `training_attendees` gained `program`, `completed_on`, `expires_on`,
  `rating`, `verified_by`, `source` (session, external), `note`, `enrolled_by`.

## Frappe parity (SPEC 2, Performance)

Covered: appraisal cycle, appraisal template with goals (KRAs with weights)
and competencies and questions, appraisal (self, manager, peer; upward added),
appraisee (participants), goal with progress and key results, KRA (goal kind),
employee performance feedback with criteria and ratings (peer and manager
reviews), employee feedback (praise), skill and employee skill map (kernel
`employee_skills` plus the library and matrix), designation skill (expected
level per job title), training program, training event, attendees, training
result (score, pass or fail), training feedback.
Left out: the Frappe "appraisal goal score formula" field (a fixed weighted
average is used), a 9-box or talent grid and any ranking (your AI agent never
ranks; a person-made grid can come later), an anonymous aggregate of upward
reviews for the reviewed manager, peer nomination approval (peers are added
directly by the person, their managers or HR), training budgets.

## Needs and findings for other builders

1. kernel-frontend: `useShellCounts` is mounted three times (Sidebar,
   HeaderTools, AgentPanel), so every module's `inboxSections` hooks and
   `app.home` run three times per page load; with the realtime stream holding
   one of the browser's six connections, a page's own reads wait 3 to 8 s on
   the scratch server. One provider for the shell counts would fix it for all
   modules. Performance keeps its share to one light read (`perf.inbox`).
2. kernel-frontend: the sidebar place stays folded on its own module pages
   (Performance shows its chevron closed while you are in it).
3. Home-reports (wave 3): performance exports `homeWidgets`
   (`perf_goals_*`, `perf_praise_*`, narrow) and profile facts (Goals, Goals
   at risk, Last review, Training overdue or due, Praise 90 days).
4. kernel-frontend: `HomeWidget` gets no panel index, so the performance
   widgets on Home stay unnumbered (K10); an `index` prop from the host would
   let them follow the page's 01, 02, 03.

## UI QA fixes (2026-11-05, UI_FINDINGS PF1 to PF4)

- PF1: the cycle wizard's last step is Launch: it saves the draft (created
  once, updated after), reads `cycles.preview`, asks one confirm with the
  count, then `cycles.launch` and opens the cycle. "Save draft" stays as the
  ghost button; editing an active cycle ends on "Save changes". The Phases
  step's "answered by" lists only kinds whose phase is switched on.
- PF2: header buttons always carry their labels, also on phones (no icon-only
  squares, nothing hidden); the kit's PageHeader lays them out on a phone.
- PF3: one panel-header link style, `AsideLink` in components/performance/bits.tsx
  (mono caps, no underline, ink on hover, 40 px touch area).
- PF4: type sizes are 12, 13, 14, 26 plus `.hr-label` (10.5 mono labels).
- Also: panels numbered 01, 02, 03 in reading order (the review's side panels
  continue the form's numbers; no letters), stat tiles unnumbered; one primary
  per screen (empty-state actions and row actions are default buttons); list
  rows at least 40 px and lone links carry `hit`; day and number text through
  lib/format.ts (`dayKey`, `number`); notification titles carry no ISO days;
  default cycle names read "Probation reviews November 2026".
