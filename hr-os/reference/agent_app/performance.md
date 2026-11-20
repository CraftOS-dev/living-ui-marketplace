### Performance

Goals and OKRs with key results, review cycles (self, manager, peer and
upward reviews with autosaved drafts, sharing, acknowledgement and HR
sign-off), calibration of final ratings with reasons, continuous feedback
and praise with company values, the skill library and team skills matrix,
and training (programs, sessions, attendance, certificates, required
trainings with due days). Employment decisions are high risk: your AI agent
summarises and drafts; it never rates, ranks, calibrates or decides.

#### Requirements

- [x] Goals for a person, a team (department) or the company; kinds goal, KRA, OKR; key results `{key, title, start, target, current, unit}`; weight for reviews; status on track, at risk, off track, done, dropped; due days
- [x] Progress fills itself: from key results, else from the goals aligned below, else from check-ins; changes roll up the alignment tree (no cycles allowed)
- [x] Check-ins with a short note, new key result values, progress and status; history with before and after; the manager hears when a report's goal goes off track
- [x] Goals page opens on what needs an update (at risk, off track, overdue, due soon, no check-in for N days), quiet progress bars, list or alignment tree, CSV import (check, then commit) and export
- [x] Review templates: rating scale 3 to 7 points with labels, sections (goals with weight and per-goal rating, competencies with descriptions, open questions with required flags), who answers each section, who gives an overall rating; three built in (annual, probation, quarterly check-in)
- [x] Review cycles: a short wizard (kind, name, entity, period; everyone, departments, chosen people or probations ending, joined-before filter; template; phases goals, self, peer, upward, manager, calibration, sharing with days); defaults per kind and the entity's fiscal year; draft, launch (template copied), close
- [x] Reviews per participant: self, manager, upward (made at launch for each direct report), peers (added by the person, their managers or HR); autosaved drafts; submit with the list of what is missing; decline (peer, upward); reopen and reassign (HR)
- [x] Progress per cycle and who has not submitted; reminders daily at 09:00 local during a phase that ends within the reminder window or is late (once a day per review), and on demand
- [x] Sharing (the manager from the sharing phase, HR any time, or all at once), acknowledgement with a comment, HR sign-off approval `review_signoff` where the entity requires it (approved: signed; rejected: back to the manager with the note)
- [x] Calibration: distribution of ratings per department and overall as quiet bars, the list of people with manager rating, score, final rating; changes need a reason, keep a history and an audit row; no automatic curve
- [x] `review_summary_draft`: the reviewer asks; your AI agent reads `reviews.context` (only what the reviewer may see) and posts a neutral summary with sources; the reviewer uses it as a starting point or dismisses it; the schema has no rating field
- [x] Feedback: praise (public praise wall or private, tagged with company values), private feedback to a person or to their manager only, requests about yourself (or a report, for managers) answered privately or to the manager, decline, removal (writer; HR on the wall)
- [x] Skills: library (category, level descriptions, the level each job title expects), people's levels (kernel `employee-skills.*`, managers verify), team skills matrix with gaps, CSV
- [x] Training: programs (course, workshop, certification, validity), sessions (days, times, place or link, seats, cost in minor units, status), enrolment (self, managers, HR) with capacity, attendance and results, the attendee's feedback, certificates as protected files, external completions (verified by a manager or HR), required trainings by entity, department or job title with a due day and/or days after joining, renewals, compliance done, expiring, due, overdue, weekly reminders
- [x] Performance Home (what you owe, the current cycle and its phase, goals needing an update with a one-tap check-in, praise this week, team counts), the profile tab, profile facts, the Inbox section, Home widgets

#### Entities

| Collection | Purpose | Notes |
|------------|---------|-------|
| perf_settings | Company values, praise wall, check-in and reminder days (company row, entity ''), HR sign-off per entity (entity rows) | one row per entity, unique |
| goals | Goals and OKRs | `employee` (personal), `department` (team) or neither (company); `key_results` json; `parent` (alignment); `origin` person or agent |
| goal_checkins | Check-ins | progress and status before and after, key result changes |
| review_templates | Templates | `scale`, `sections`, `overall_kinds`; `builtin`, `archived` |
| review_cycles | Cycles | status draft, active, closed; `phases` json; `participants` rule json; `template_snapshot` (copied at launch) |
| review_participants | One person in a cycle | stage open, submitted, shared, acknowledged, signoff, signed, removed; `overall` (manager), `final` (calibrated), `final_reason`, `calibration` history json, `signoff` approval id |
| reviews | One review per reviewer | kind self, manager, peer, upward; status draft, submitted, declined; `answers` and `ratings` json keyed `<section>.<item>` or `<section>.<goal id>`; `overall`, `score` |
| review_summaries | Your AI agent's summaries | status requested, ready, used, dismissed, failed; `text`, `sources`; no rating |
| feedback | Praise, feedback, requests | `visibility` private, manager, public; `request` links an answer; `values` codes |
| skills | Skill library | `name` is the join key with `employee_skills.skill` (case-insensitive) |
| training_programs, trainings, training_attendees, training_requirements | Training | `certificate` is a protected file; `valid_months` drives expiry and renewals |
| perf_nudges | Reminder dedupe keys | pruned after 120 days |

#### Operations (88)

Groups: `perf` (home, inbox, profile, settings), `goals`, `review-templates`,
`cycles`, `participants`, `reviews`, `review-summaries`, `calibration`,
`feedback`, `skills`, `training-programs`, `trainings`, `training-attendees`,
`training-requirements`. People only (40): every review write, sharing,
acknowledgement, calibration, cycle launch, phases, reminders and close,
feedback, settings, exports, deletions and certificate files. Proposals
(18, kind `performance`): goals (create, update, check-in, import), templates
and draft cycles, the skill library, training programs, sessions,
enrolment, attendance and requirements. `review-summaries.submit` is your AI
agent's only direct write.

Events emitted: `goal.checked_in`, `review_cycle.launched`,
`review.submitted`, `review.shared`, `review.acknowledged`, `review.signed`,
`training.completed`. Subscribes to `employment.ended` (leaves open cycles).
Approval kind `review_signoff` (default flow: role hr_admin, seeded).
Cron `performance_reminders` (hourly; acts at 09:00 local per entity).
