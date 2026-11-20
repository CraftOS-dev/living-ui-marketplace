### Time and attendance

Shifts and the schedule, clocking in and out (own phone or web, and a kiosk
tablet with a personal PIN), attendance worked out from punches, attendance
requests, weekly timesheets, overtime rules per entity and the hours payroll
pays.

#### Requirements

- [x] Shift types per entity (start, end, break, grace, half-day and absence thresholds, colour, code, default location)
- [x] Shift locations are the kernel's locations with their geofence (lat, lng, radius) and kiosk code
- [x] The week schedule by person: draft then publish; only the people whose shifts changed are told; drafts are invisible to employees and do not change attendance
- [x] Drag a shift type onto a day, or pick a type and tap days; copy last week (fill or replace); discard drafts
- [x] Repeating shift patterns laid over many people for a date range (the bulk shift assignment tool)
- [x] Approved leave and public holidays shown on the schedule; a shift on a leave day is a conflict
- [x] Shift requests: a different shift on some days, or a swap the colleague agrees to first; the manager decides (approval kind shift_request)
- [x] Clock page: one big button (Clock in, Start break, End break, Clock out), today's punches, the week, hours so far
- [x] Location read once at the punch, only where the place checks an area; outside the area the punch is flagged, never refused; no tracking in between
- [x] Web punch from the sidebar's strong action for employees
- [x] Kiosk tablet (#/time/kiosk/<kiosk code>): HR starts the tablet once, people pick their face or name and type a personal 4 to 6 digit PIN (hashed, locked after 5 wrong tries), works for people without a sign-in
- [x] Auto attendance every 30 minutes and on demand: status, first in, last out, worked, break (scheduled break taken off when none was punched), late, early, overtime, night minutes; approved leave and holidays respected; a day set by hand, by a request or used by a locked pay run is never recomputed
- [x] Two ways to count per entity: people clock in (a working day without punches is an absence) or exceptions only (a working day counts as worked unless marked)
- [x] Attendance board: today by location and team (in, late, absent, on leave, remote, done) with readouts and a dense list; a row opens the day
- [x] Month grid per person with codes, totals, late, missing punches, hand-set days; one person's month as a calendar
- [x] Corrections in place: add a punch, take one out (kept with the reason), set a day by hand, back to following the punches
- [x] Bulk mark (the employee attendance tool) for many people and days
- [x] Attendance requests: missed punch, a whole day's hours, work from home, on duty (approval kind attendance_request)
- [x] Weekly timesheets from attendance (regular, overtime, leave, holiday rows) with project and task rows; submit; the manager approves in the Inbox with the week's numbers and exceptions (approval kind timesheet); withdraw, reopen
- [x] Your AI agent checks a week of timesheets (trigger timesheet_review when a person asks; timesheet_check every week when punches are missing and the company switched it on): it proposes fixes, never approves
- [x] Overtime rules per entity: daily, weekly, monthly (Japan over 60 hours), seventh consecutive day (California), rest day, public holiday, night premium, with multipliers and pay component codes; defaults per country on entity.created (US FLSA plus California, Japan with the 36 agreement limits, Singapore Part IV, India, Malaysia 1.5x, 2x, 3x, United Kingdom none, Australia placeholders); a rule set per employment type
- [x] Overtime pre-approval when the entity asks for it (approval kind overtime); unapproved overtime is still paid and flagged
- [x] Hours for payroll (lib_time.payInputs) with issues: missing punches, unapproved or missing timesheets, overtime limits, days another locked run used; lockDays and unlockDays for pay runs
- [x] Profile tab Time (this month, schedule, punches) and profile facts (today's shift, clock state, this month)

#### Entities

| Collection | Purpose | Notes |
|------------|---------|-------|
| shift_types | Shift definitions per entity | start, end, break, grace in and out, thresholds, colour, code |
| shift_patterns | Repeating cycles of shift types and days off | days json, one item per day of the cycle |
| shift_assignments | The schedule, one row per employment and day | status draft, published, removed; `published` keeps what people see |
| shift_requests | Change and swap requests | awaiting_peer, pending, approved, rejected, declined, cancelled |
| checkins | Punches | kind in, out, break_start, break_end; source web, phone, kiosk, manual, request, agent; location snapshot, flags; voided with a reason, never edited |
| kiosk_devices | Kiosk tablets started by HR | token stored as a hash |
| kiosk_pins | Personal kiosk PINs | hidden auth records, bcrypt; never readable |
| attendance | One row per employment and day | source auto, manual, request, import; `locked` and `payrun` once a pay run used it |
| attendance_requests | Regularisation requests | missed_punch, correction, remote, on_duty |
| timesheets, timesheet_entries | Weekly timesheets and their rows | entries source attendance, person, agent |
| overtime_rules | Rule sets per entity | rules, settings, caps (minutes), applies (employment types) |
| overtime_requests | Overtime pre-approval | approved_min |

#### Operations

Groups: `clock` (status, punch), `checkins` (list, flagged, add, void),
`kiosk` (start, devices, stop, roster, punch, photo, pin-set, pin-clear,
pin-status), `shift-types`, `shift-patterns`, `shifts` (week, set,
copy-week, assign-pattern, discard, publish, mine, of, colleagues),
`shift-requests`, `attendance` (board, month, get, list, export, mark,
mark-bulk, reset, process), `attendance-requests`, `timesheets` (mine, get,
list, save-entries, submit, withdraw, reopen, review-ask), `time` (review,
payroll-check, pay-inputs), `overtime-rules` (list, defaults, save, reset,
delete, try), `overtime-requests`.

Your AI agent proposes punch corrections, hand-set days, timesheet fixes,
publishing, rule and shift type changes; it may change the draft schedule;
it never punches, submits, approves, starts kiosks or sets PINs. The kiosk
operations are public and need the tablet token in the X-Kiosk-Device
header.

Contracts for other modules: `lib_time.payInputs(app, employmentId, from,
to)` (SPEC 3.5), `lib_time.payInputsDetail(app, employmentId, from, to)`
(plus per-day detail), their batch forms `lib_time.payInputsMany(app,
employmentIds, from, to)` and `lib_time.payInputsDetailMany(app,
employmentIds, from, to)` (`{ [employmentId]: result }`, the same answers,
read together: use them for a pay run or a report),
`lib_time.lockDays(app, employmentId, from, to, payrunId)`,
`lib_time.unlockDays(app, payrunId)`. Every pay inputs answer has
`adjustments` (days an earlier locked run used that changed afterwards: a
punch is never refused, the difference is paid in the next run). Approved leave is read from the leave
module's `leave_requests` (approved or cancelling) and their `day_list`.

#### Triggers

`timesheet_review` (a person asks from Timesheets; a `timesheet_reviews` record
names the week) and `timesheet_check` (the weekly check, only when the company
switched it on). Your AI agent finishes with `timesheet-reviews.done`.

#### External data

None.
