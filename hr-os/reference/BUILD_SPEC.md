# HR OS build spec (the contract every builder follows)

Owner: the CraftBot owner, building for very important clients in many countries (US, Japan, Singapore, India first; Malaysia, UK, Australia and others next). Production level. Written 2026-11-04.

Read this whole file before you write a line. When this spec and your instinct disagree, the spec wins. When the spec is silent, follow the reference apps named here, then the design report. If you change a contract named here, say so in your final report.

## 0. Non-negotiables (owner rules, all binding)

- Build it yourself. Never let CraftBot build, verify-fix or import the app (no `agent_app_import`, no factory, no walk-verify). Do not register the app; the coordinator does that last.
- Never touch real agent state or any other app. Only write inside your owned files (section 13) and your own scratch folder. Never write to `living-ui-marketplace`. Never edit `agent_file_system/workspace/agent_app_projects.json`.
- Never commit or push. Do not `git add` anything.
- No fallback or migration shims: one schema, one code path. No "if the other module is missing" branches in shipped code (stubs live only in your scratch copy).
- No pattern matching on free text (no substring routing, no keyword blocklists on LLM output). Use enums, schemas and structure.
- Every feature ships with its operations (`/api/ops/...` through the catalog) and the UI calls those same operations. The UI never writes collections directly.
- Copy and enum values never name CraftBot: say "your AI agent". No em dashes (U+2014) or en dashes (U+2013) anywhere: code comments, copy, docs. Use commas, colons, parentheses.
- No emoji anywhere in the UI. Icons are lucide-react line icons. Never draw logos, marks or SVG illustrations; the app title is plain text next to a lucide icon. Charts and data figures drawn from data are fine.
- Pointer cursor on everything clickable. Hover states never equal their container or their children (use the dedicated hover token). Subtle motion only (no cascades, loops, pops, count-ups, bounces).
- Long words wrap (`overflow-wrap:anywhere` on free text, `min-w-0` on grid/flex children).
- Instruction text on screen is a UX failure: use direct manipulation, good defaults, labels and empty states that offer the first action.
- Test on an EMPTY database first, then seeded. `SUM/MIN/MAX` in SQL must be wrapped in `COALESCE(...,0)` and `CAST(... AS INTEGER)` for money.
- Sidebar children expand as trees with an inline "+", never a `<select>` in a sidebar. No "Show more" on lists: paginate by scroll.
- Money is integer minor units, never floats in storage. Days are `YYYY-MM-DD` text. Times of day are `HH:MM` text. Timestamps are PocketBase dates (UTC).

## 1. Identity

| Item | Value |
|---|---|
| Name | HR OS |
| App id | `37878b99` |
| Folder | `C:/Users/zfoong/Desktop/agent/code/git/CraftBot/agent_file_system/workspace/agent_app/hr_os_37878b99` (below: `APP/`) |
| Live port (manifest) | 3119 |
| Format | CraftBot agent app format 2 (`agentAppVersion: 2`, PocketBase 0.39.x, kit 0.6.0), same as Store OS, Research OS, YC Application |
| authMode | `none` at the platform level; the app has its own team sign-in (`members` auth collection), copied from the ERP app |
| Gate | `node C:/Users/zfoong/Desktop/agent/code/git/CraftBot/agent-app/tools/src/cli.ts validate APP` must pass. Never use the global `agent-app`/`a2app` on PATH (a different framework). |
| Icon | `lucide:Users` |
| PocketBase binary | `C:/Users/zfoong/.craftbot/bin/pocketbase-0.39.6.exe` |

Reference apps (read, never edit):
- ERP (closest kernel: members, roles, perms, invites, PIN-free approvals, people/leave/claims/payroll v0): `WS/_verify/9cc5cf11/snapshot/` where `WS = C:/Users/zfoong/Desktop/agent/code/git/CraftBot/agent_file_system/workspace/agent_app`. Its tests and AGENT_APP.md live in `C:/Users/zfoong/AppData/Local/Temp/claude/c--Users-zfoong-Desktop-agent-code-git-CraftBot/58488f4f*/scratchpad/` (glob it).
- Store OS (newest catalog generator `tools/gen.mjs`, proposals with autonomy, one-trigger job queue, phone lists): `WS/store_os_4b6e444b/`.
- Advance POS (approve PIN pattern): `WS/_verify/5e7a2c91/snapshot/pb/pb_hooks/lib_auth.js`.
- Research OS (hook-spawned Node for files, confined tools): `WS/research_os_b3b8a83b/`.
- Piano Coach (THE LOOK, section 12): `C:/Users/zfoong/Desktop/agent/code/git/living-ui-marketplace/piano-coach/frontend/src/app/` (read only; it is in the new framework format, copy only its frontend look and patterns).
- Frappe HRMS (feature parity checklist, section 2): https://github.com/frappe/hrms (doctypes under `hrms/hr/doctype` and `hrms/payroll/doctype`).
- Design report: `C:/Users/zfoong/Desktop/agent/code/git/CraftBot/reports/HR and payroll landscape and design.md` (Part 2: IA tables, flows, data model, engine, ops, autonomy, documents) and its notes folder `research_notes/HR and payroll landscape and design/` (Japan, Malaysia, Singapore statutory detail, UI patterns, AI rules).

Changes from the report, decided by the owner's new brief: all countries (US, JP, SG, IN first), multiple legal entities and currencies in one app, recruiting and performance are IN (Frappe parity), one trigger with a job queue (Store OS pattern) instead of six triggers.

## 2. Scope: Frappe HRMS parity plus the state of the art

Every Frappe doctype maps to a feature here (module in brackets). Builders: check your module's list off in your final report.

- Organisation [kernel]: company/legal entities, branches (locations with geofence), departments with approvers, designations (job titles), employee grades, employment types, cost centres, holiday lists and holiday list assignment, HR settings, identification document types.
- People [kernel]: employee, employee property history (effective-dated records with Update vs Edit), promotion, transfer, skills (skill, employee skill map), health insurance and other details as documents, identification documents (sealed), bank accounts (sealed), emergency contacts, dependants, org chart, directory.
- Lifecycle [lifecycle]: onboarding template and onboarding, boarding activities, separation template and separation, exit interview, full and final statement (outstanding, assets), appointment letter templates and letters, offer terms, employee assets, documents with acknowledgement, handbook and policies, employee grievance and grievance types, employee referral.
- Time [time]: shift type, shift location, shift schedule and assignment (and the bulk assignment tool), shift request, employee checkin (web, phone, kiosk PIN), auto attendance from checkins, attendance, attendance request (regularisation), employee attendance tool (bulk mark), overtime type, overtime details and overtime slip (overtime into payroll), timesheets, work schedules, vehicle log and vehicle service (as mileage in expenses).
- Leave [leave]: leave type, leave period, leave policy and details, leave policy assignment, leave allocation, earned leave schedule (accrual), leave application (full, half, hours), compensatory leave request, leave encashment, leave adjustment, leave ledger entry, leave block list (dates, allow list), leave control panel (bulk allocate), statutory country defaults (JP 5-day obligation and register, MY Employment Act, IN state rules, SG, US PTO, UK holiday entitlement).
- Expenses [expenses]: expense claim type, expense claim and details, taxes and charges on claims, employee advance and settlement against claims, travel request with itinerary and costing, purpose of travel, mileage, receipt capture (your AI agent reads receipts), reimbursement through payroll or bank file.
- Payroll [payroll]: payroll settings, payroll period and dates, salary component (with accounts), salary structure and (bulk) salary structure assignment, additional salary, employee incentive, retention bonus, arrear (back pay), payroll correction, salary withholding and cycles, payroll entry (pay run) and payroll employee detail, salary slip with leave, loan and timesheet detail, employee loans and repayment, employee benefit application, claim and ledger, employee tax exemption category, sub category, declaration and proof submission (IN and others), employee other income, income tax slab and taxable salary slab and other charges (as rule packs), gratuity rules, slabs and gratuity (as rule-pack steps in termination runs), employee cost centre split, bank payment files, GL journal export, statutory filings ledger, year-end documents per country.
- Recruiting [hiring]: staffing plan and details, job requisition, job opening and templates, job applicant and source, interview type, round, interview, interviewer, interview feedback with criteria, job offer with components and terms, appointment letter, referral, skill expectations.
- Performance [performance]: appraisal cycle, appraisal template with goals and KRAs, appraisal (self, manager, peer), appraisee, goal (with progress and key results), KRA, employee performance feedback with criteria and ratings, employee feedback (praise), skills and skill assessment, training program, training event, attendees, training result and training feedback.
- State of the art additions: one Inbox for approvals, tasks and your AI agent's proposals; Home that opens on what needs you; "Hide pay" toggle; payroll pre-flight checks with blockers and warnings; run-over-run variance; locked runs with void and replace; rule packs with golden test vectors; per-line explanation of every payslip figure; scheduled payslip publication; employee self-service on phones; Ctrl-K search; CSV import and export everywhere; audit trail with person or agent attribution.

## 3. Architecture (backend)

Copy the ERP kernel, adapt it, keep its contracts. Store OS's `tools/gen.mjs` is the generator to adapt (it adds catalog checks); the ERP dispatcher adds permissions.

### 3.1 Files and the catalog

- `pb/pb_hooks/cat_<module>_<area>.js`: plain data arrays of operations (no PocketBase globals at module top level). **The catalog is auto-discovered**: `lib_catalog.js` lists `cat_*.js` with `$os.readDir(__hooks)`, `tools/gen.mjs` with `fs.readdirSync`. No shared FILES list.
- `pb/pb_hooks/lib_<name>.js`: handlers, exported as `module.exports = { a: a, b: b }`. Helpers are `require`d INSIDE function bodies (top-level helper imports break in Goja) and cached per call.
- `node tools/gen.mjs` writes `pb/pb_hooks/routes.pb.js`, `operations.json` and `frontend/src/app/lib/ops.gen.ts`. Never edit those three by hand.
- Op names are `group.verb` with exactly one dot, lower case, `[a-z0-9-]` (for example `payruns.calculate`, `leave.request`). Route `METHOD /api/ops/<group>/<verb>`.

Operation fields (the generator enforces them):

| Field | Meaning |
|---|---|
| `name` | `group.verb` |
| `method` | `GET` for reads, `POST` for writes |
| `fn` | `lib_x.fn`, called as `fn(ctx, params)` |
| `perm` | `public` (no sign-in: auth status, login, setup, invite accept), `signed` (any signed-in member), `self` (signed in; the handler scopes to what the caller may see), `<module>:<level>` (levels `view < edit < full`), `admin` |
| `agent` | `allow` (default) / `propose` (your AI agent's call becomes a proposal unless the owner set that kind to automatic) / `deny` (people only). Rules: `effect: 'confirm'` ops are `deny`. Every money-moving, locking, exporting, sealing, revealing, bank-detail or role op is `deny`. |
| `kind` | for `propose`: `people`, `time`, `leave`, `expenses`, `payroll`, `hiring`, `performance`, `packs` |
| `effect` | `read`, `write`, `confirm` (needs the approval PIN; the dispatcher checks `pin` param against the caller's PIN hash before the handler runs) |
| `destructive` | true for deletes (adds a `confirm` param for your AI agent, as Store OS) |
| `desc` | what it does, written for your AI agent (under 400 chars) |
| `params` | `{ name: { type: 'string'|'number'|'boolean', required, enum, desc, example } }`. Lists and objects travel as JSON strings; handlers parse with `u.list` / `u.obj`. |
| `files` | multipart file fields (the agent gives local `--paths`) |

The dispatcher order: catalog lookup, caller identity (member token, or the agent by `X-A2App-Token` against `APP/.agent-token`), permission check, param check, PIN check for `confirm`, propose-or-run, handler, audit write for every write, JSON answer `{status, message, code, data}` on error, bus flush (realtime "changed" signal), `Server-Timing` header.

The agent is a principal: `ctx.isAgent = true`, `ctx.member = null`, it may read everything except sealed values and (when the company switch is off) pay figures; it can never hold a PIN.

### 3.2 Kernel libraries (owned by the kernel builder; module builders call them, never edit them)

| Library | Purpose and key exports |
|---|---|
| `lib_util.js` | `fail(status,msg,code,extra)`, `statusOf`, `nearest`, `list`, `obj`, `str`, `num`, `bool`, `today(app, entityId?)` (in the entity's timezone), `dayAdd`, `daysBetween`, `isDay`, `page(params)`, `findOne`, `findMany`, `byIdOrName(app, collection, ref, nameField)`, `slug`, `csv` helpers |
| `lib_money.js` | ERP's BigInt-safe parser and formatter: `toMinor(str, currency)`, `fromMinor(int, currency)`, `exponent(currency)` (JPY 0, KRW 0, VND 0, IDR 2 (shown 0), KWD/BHD/OMR/JOD 3, default 2), `round(minorFloat, mode)`, `add`, `mul(minor, rate)`, `allocate(minor, parts)` |
| `lib_auth.js` | members, roles, levels, invites, lockout, approval PIN (set, change, verify, reset by admin, owner recovery code), `context(e, spec)`, `can(ctx, module, level)`, `need(ctx, module, level)`, `scope(ctx)` (entity ids the caller may see; empty = all), `selfEmployee(ctx)`, `isManagerOf(ctx, employmentId, day)` |
| `lib_ops.js`, `lib_catalog.js` | dispatcher and catalog (3.1) |
| `lib_bus.js` | `touch(collection)`, `flush(app)` (Store OS) |
| `lib_audit.js` | `write(ctx, {op, collection, record, summary, before, after})` (sealed values never logged), `list` |
| `lib_settings.js` | the one `settings` row (company name, reporting currency, date style, autonomy per proposal kind, `agent_sees_pay`, setup steps, payslip publication hour, rate limits), `get(app)`, `update` |
| `lib_org.js` | entities, locations, departments, job titles, grades, cost centres, employment types, countries list (`lib_countries.js` data) |
| `lib_calendar.js` | holiday calendars and holidays, work schedules: `isHoliday(app, calendarId, day)`, `holidaysBetween`, `workingDays(app, employmentId, from, to)` (uses the employment's schedule and calendar as of each day), `calendarOf(app, employmentId, day)`, `scheduleOf(app, employmentId, day)`, `expectedMinutes(app, employmentId, day)` |
| `lib_people.js` | employees, employments, records, contacts, dependants, documents, sealed fields: `asOf(app, employmentId, day)` returns `{employee, employment, entity, job, pay, tax, location, schedule, calendar}`; `activeEmployments(app, {entity, from, to, ids})`; `managerOf(app, employmentId, day)`; `reportsOf(app, employeeId, day, deep)`; `ageOn(employee, day)` |
| `lib_seal.js` | `seal(app, plain)`, `unseal(app, sealed)`, `mask(plain, kind)`; key in `APP/.seal-key` (generated at boot, 32 random bytes hex, never in the database, never logged); uses `$security.encrypt/decrypt` |
| `lib_approvals.js` | generic approvals with flows: `open(ctx, {kind, ref_collection, ref_id, entity, employment, summary, amount_minor, currency, payload})`, `decide(ctx, approvalId, 'approved'|'rejected', note)`, `cancel`, `pendingFor(ctx)`. On a final decision it calls the kind's subscriber from the `approvals` maps in `events_*.js` (3.4): `fn(ctx, approval, decision, note)`. Flow steps: `manager`, `manager_of_manager`, `department_approver`, `role:<role code>`, `member:<id>`; auto-approve rules by amount or days. Self-approval forbidden except a sole-admin company (logged). |
| `lib_proposals.js` | your AI agent's proposals (Store OS model): before and after preview, accept (runs the op as the accepting person), dismiss, stale check |
| `lib_agent.js` | asking your AI agent (section 9): one trigger per piece of work, `ask(ctx or app, record, trigger, opts)` fires once with the record's id and keeps the ask on the record (`agent_asks`), `end`, `view`, the Automatic work switches, questions to your AI agent |
| `lib_notify.js` | in-app notifications per member, plus optional Gmail email through the bridge (`send_gmail`) when the company enabled it |
| `lib_search.js` | Ctrl-K search across people, runs, requests, candidates (modules register nothing; the kernel queries the known collections by name and skips a collection that does not exist yet only in dev stubs) |
| `lib_files.js` | protected file serving through ops with rights checks (ERP pattern) |
| `lib_guide.js` | `app.guide` text for your AI agent (kernel writes the frame; each module adds a section in its own `guide_<module>.js` export that `lib_guide` concatenates by auto-discovery of `guide_*.js`) |
| `lib_events.js` | `emit(ctx, name, payload)`, `approvalHandler(kind)`, `profileFacts(ctx, employmentId)` by auto-discovery of `events_*.js` (3.4) |
| `lib_countries.js` | country metadata (code, name, currency, date format, week start, weekend days, ID document types with labels and masks, statutory pack codes, bank file formats, default leave types, minimum wage reference). Packs builders supply the data in `pb/pb_hooks/data/countries/<cc>.js`; `lib_countries` auto-discovers that folder. |

### 3.3 Sign-in, roles, permissions

- `members` auth collection (email, password, name, role, employee (relation, optional), entities (json list of entity ids; empty = all), status active|disabled|invited, pin_hash, pin_set_at, fails, locked_until, last_seen, recovery code hash for the owner). First open runs Setup: company, first entity (country, currency, timezone), owner account with password and approval PIN, and the recovery code shown once.
- Roles (seeded, editable, more can be added): `owner` (everything, admin), `hr_admin` (people full, time full, leave full, expenses full, payroll view, hiring full, performance full, reports full), `payroll_admin` (payroll full, people view, time view, leave view, expenses full, reports full), `finance` (expenses full, payroll view, reports view), `manager` (team scope: people view of reports, approve their time, leave, expenses; hiring edit as interviewer; performance edit for reports), `recruiter` (hiring full), `employee` (self only). Modules for levels: `people, time, leave, expenses, payroll, hiring, performance, reports, admin`.
- Team scope: managers see and act on their direct and indirect reports (via `job_records.manager`) without module rights; `self` ops scope to the caller's own employee.
- Field visibility: pay figures need `payroll:view` (or self, or manager when the company enabled "managers see team pay"); sealed values (bank numbers, national IDs, My Number) show masked to everyone; reveal is the `confirm` op `seal.reveal` (PIN, audited, 5 minute view).
- The approval PIN is six digits, hashed (bcrypt via `$security` or PocketBase password hashing of a hidden auth collection; reuse POS/ERP code). It is required for: locking and voiding pay runs, exporting bank and statutory files, approving bank account changes, revealing sealed values, activating rule packs, changing roles and members, deleting people.

### 3.4 Events and approval kinds (subscriptions, no shared map)

Modules never call each other's hooks through a hard-coded map. Each module ships `pb/pb_hooks/events_<module>.js` exporting plain data:

```
module.exports = {
  on: { 'employment.hired': 'lib_lifecycle.onHire', 'separation.approved': 'lib_payroll.onSeparation' },
  approvals: { leave_request: 'lib_leave.onDecision', comp_off: 'lib_leave.onDecision' },
  profileFacts: 'lib_leave.profileFacts'   // optional: facts the profile and Home show (balances, next shift)
};
```

`lib_events.js` (kernel) auto-discovers `events_*.js`, `emit(ctx, name, payload)` calls every subscriber (each in its own try, errors logged and returned, never swallowed silently), and `lib_approvals` finds the handler for a kind from `approvals` maps. A kind with no subscriber cannot be opened (`lib_approvals.open` refuses an unknown kind), so a missing module fails loudly at the point of use, never at boot.

Kernel events (emitted by the kernel): `employment.hired`, `employment.changed` (job or pay record added), `employment.ended`, `employee.updated`, `bank_account.approved`, `member.linked`. Module events: each module documents what it emits in its guide section. Approval kinds and their owners: `leave_request`, `leave_encash`, `comp_off` (leave); `attendance_request`, `shift_request`, `timesheet`, `overtime` (time); `claim`, `advance`, `travel` (expenses); `pay_change`, `payrun`, `loan`, `tax_declaration` (payroll); `bank_account` (kernel people); `requisition`, `offer` (hiring); `separation` (lifecycle); `review_signoff` (performance).

### 3.5 Cross-module contracts (exact signatures; implement them in your module, call them from others)

```
lib_time.payInputs(app, employmentId, from, to)
  -> { worked_minutes, regular_minutes, overtime: [{ component: 'OT150', minutes, multiplier }],
       absent_days, late_minutes, night_minutes, holiday_worked_minutes, issues: [{ code, message, severity: 'blocker'|'warning' }] }
lib_leave.payInputs(app, employmentId, from, to)
  -> { unpaid_days, unpaid_hours, paid_days: { <typeCode>: days }, encash: [{ type, days, request }],
       issues: [{ code, message, severity }] }
lib_leave.balance(app, employmentId, typeCode, day) -> { type, unit, balance, taken, pending, granted, expiring: [{ day, amount }] }
lib_expenses.payInputs(app, employmentId, upToDay, currency)
  -> [{ claim, component: 'REIMB', amount_minor, currency, taxable: false }]
lib_expenses.markPaid(app, claimIds, payrunId)  // called by payroll at lock
lib_expenses.advanceRecovery(app, employmentId, upToDay) -> [{ advance, amount_minor, currency }]
lib_payroll.recentPayslips(app, employmentId, n) -> [{ id, period_start, period_end, pay_date, net_minor, currency, status }]
lib_payroll.compensationOf(app, employmentId, day) -> { basis, amount_minor, currency, period, pay_schedule }
// event subscribers (section 3.4), payload shapes:
// 'employment.hired'     { employment, employee, entity, start_day, from_application }
// 'separation.approved'  { separation, employment, last_day, kind }
// 'offer.accepted'       { application, offer, candidate }   (hiring emits; kernel people.hire is then run by a person or proposed by your AI agent)
```

While building in parallel, put stubs of the OTHER modules' functions only in your scratch copy. Never ship them.

### 3.6 Cron (PocketBase `cronAdd`, using the app handle stored at boot, as Advance Life OS `hooks.pb.js`)

Kernel owns `hooks.pb.js` (boot: seal key, settings row, superuser checks are platform; rule-pack seeding from `pb/pb_hooks/packs/`, holiday seeding from country data) and registers module cron by auto-discovering `cron_<module>.js` files that export `[{ name, schedule, fn: 'lib_x.fn' }]`. Planned jobs: `time` auto attendance from checkins (every 30 min), `leave` monthly accrual and expiry (daily 00:30 local per entity), `payroll` scheduled payslip publication (every 15 min), filing reminders (daily), `lifecycle` task reminders (daily), the kernel minute job sends an ask the cooldown held back (once; nothing is ever asked again on its own), document expiry alerts (daily).

## 4. Data model (collections; each module writes its own migration)

Migration file names: kernel `1730000000_kernel.js`, `1730000100_people.js`; time `1730001000_time.js`; leave `1730002000_leave.js`; expenses `1730003000_expenses.js`; payroll `1730004000_payroll.js`; hiring `1730005000_hiring.js`; lifecycle `1730006000_lifecycle.js`; performance `1730007000_performance.js`; reports/home `1730008000_reports.js` (if needed). Later fixes are NEW files with a higher number in your range. Relations reference `app.findCollectionByNameOrId(name).id`. All collection API rules are `null` (only ops and superuser); request guards in the kernel refuse raw collection access even for the superuser token except the platform's own needs (see Store OS/ERP `_a2app_rules` usage). Every collection has `created`/`updated` autodates.

Kernel: `settings` (one row), `members` (auth), `roles` (code, name, levels json, team_scope bool, system bool), `entities` (name, legal_name, country, region, currency, timezone, fiscal_year_start `MM-DD`, week_start 0-6, tax_ids json `{label: value}`, address, registration json, default_pay_schedule, default_calendar, default_schedule, default_leave_policy, default_onboarding_template, packs json (pack codes enabled), bank json (employer bank for files), active), `locations` (entity, name, address, country, region, timezone, lat, lng, radius_m, calendar, kiosk_code), `departments` (name, code, parent, entity, head (employee), approver (employee), cost_center), `job_titles` (name, family, grade, description), `grades` (code, name, entity, currency, pay_min_minor, pay_max_minor), `cost_centers` (code, name, entity), `employment_types` (code, name, statutory json per country), `holiday_calendars` (code, name, country, region, entity), `holidays` (calendar, day, name, kind public|company|optional|observed, half bool), `work_schedules` (name, entity, week json `[{dow, start, end, break_min}]`, hours_per_week, flexible, grace_min, night_from, night_to), `audit`, `approvals` (kind, ref_collection, ref_id, entity, employment, requester (member), steps json, step, approver_member, approver_role, status pending|approved|rejected|cancelled, decided_by, decided_at, note, summary, amount_minor, currency, payload json, due), `approval_flows` (kind, entity, department, steps json, auto json), `proposals`, `agent_jobs` (kind, ref_collection, ref_id, summary, payload json, status queued|asked|claimed|done|failed|cancelled, priority, result json, error, asked_at, claimed_at, done_at, request_id), `notifications` (member, kind, title, body, link, read, created), `fx_rates` (day, base, quote, rate), `imports` (kind, file, status, report json).

People (kernel): `employees` (number auto `E0001` per company, legal_name, preferred_name, family_name, given_name, name_order family_first|given_first, kana json (JP furigana), photo, birth_date, gender (optional, self-described allowed), nationality, personal_email, work_email, phone, address json, emergency json list, dependants json list, member (relation back), status active|on_leave|leaving|left|pre_hire, archived), `employments` (employee, entity, number, start_day, end_day, probation_end, status pre_hire|active|on_leave|notice|ended, primary bool, end_reason), `job_records` (employment, effective_from, title, job_title (relation), department, location, manager (employee), grade, employment_type, fte, schedule, calendar, cost_center, reason hire|promotion|transfer|change|correction, note, approved_by), `pay_records` (employment, effective_from, basis salary|hourly|daily, amount_minor, currency, per year|month|week|day|hour, pay_schedule, reason, note, approved_by) (owned by payroll for edits but the collection is created by the kernel), `tax_profiles` (employment, effective_from, country, packs json (codes), fields json (pack profile fields), note), `bank_accounts` (employee, label, country, bank_name, bank_code, branch_code, account_type, holder, number_sealed, number_masked, iban_sealed, swift, split json `{kind: rest|percent|fixed, value}`, status pending|active|retired, approved_by, approved_at), `identity_docs` (employee, type, country, number_sealed, number_masked, issued, expires, file), `documents` (employee, employment, category, title, file, visible_to_employee, needs_ack, acked_at, expires, source upload|letter|payslip|agent), `employee_skills` (employee, skill, level 1-5, verified_by).

Time: `shift_types` (name, entity, start, end, break_min, color, overnight, grace_in_min, grace_out_min, auto_attendance bool), `shift_assignments` (employment, shift_type, day, status draft|published, location), `shift_requests`, `checkins` (employment, at, kind in|out|break_start|break_end, source web|phone|kiosk|import|agent, location, lat, lng, accuracy_m, note, device, flagged), `attendance` (employment, day, status present|absent|half_day|on_leave|holiday|weekly_off|remote, first_in, last_out, worked_min, break_min, late_min, early_min, overtime_min, night_min, source auto|manual|request|import, locked (by payroll), note), `attendance_requests`, `timesheets` (employment, period_start, period_end, status draft|submitted|approved|rejected, regular_min, overtime_min, note), `timesheet_entries` (timesheet, day, project, task, minutes, kind regular|overtime|leave|holiday, note), `overtime_rules` (entity, name, rules json `[{when: 'daily_over'|'weekly_over'|'rest_day'|'holiday'|'night', threshold_min, multiplier, component}]`, applies json).

Leave: `leave_types` (code, name, entity, country, paid, unit day|hour, color, icon (lucide name), allow_half, allow_hours, allow_negative, max_negative, attachment_after_days, min_notice_days, max_consecutive_days, counts_holidays, counts_weekends, statutory, gender_specific (optional), encashable, comp_off bool, archived), `leave_policies` (name, entity, rules json per type: entitlement method fixed|monthly_accrual|per_hours_worked|tenure_table|statutory_jp, amount, tenure table, proration join|none, carryover max, carryover expiry months, accrual day, period_start `MM-DD`), `leave_policy_assignments` (employment, policy, effective_from), `leave_ledger` (employment, type, day, amount (number, 2 dp, days or hours), kind grant|accrual|take|adjust|carryover|expire|encash|comp_off, ref, note, actor), `leave_requests` (employment, type, start, end, start_half am|pm|'', end_half, hours, days (computed), reason, attachment, status pending|approved|rejected|cancelled|withdrawn, approval, decided_note), `leave_blocks` (entity, department, from, to, reason, allow json employee ids), `leave_encash_requests`.

Expenses: `expense_categories` (code, name, entity, icon, limit_minor, per_day_limit_minor, receipt_over_minor, mileage_rate_minor, unit km|mile, taxable, component, gl_account, archived), `claims` (employment, title, currency, total_minor, status draft|submitted|approved|rejected|paid|cancelled, pay_via payroll|bank, payrun, advance, approval, submitted_at, paid_at, flags json), `claim_lines` (claim, day, category, merchant, description, amount_minor, currency, fx_rate, base_minor, tax_minor, receipt (file), distance, flags json, agent_read json), `advances` (employment, purpose, currency, amount_minor, status requested|approved|paid|settled|rejected, balance_minor, approval, recover_via payroll|claim), `travel_requests` (employment, purpose, from_day, to_day, destinations json, itinerary json, estimate_minor, currency, status, approval).

Payroll: `pay_schedules` (entity, name, frequency monthly|semi_monthly|biweekly|weekly, period_anchor, pay_day_rule json, cutoff_days, currency, active), `pay_components` (code, name, entity (empty = all), country, kind earning|deduction|employer|reimbursement|info, stage pre|statutory|post (deductions), calc fixed|percent|hours|days|formula|input|pack, amount_minor, percent, base, formula, tags json, taxable, recurring, gl_account, liability_account, payslip_group, sort, archived), `recurring_items` (employment, component, amount_minor, percent, from_day, to_day, note), `pay_inputs` (employment, component, period_start, period_end, amount_minor, qty, rate_minor, source manual|time|leave|claims|agent|import|loan|advance, ref, note, payrun (once used), status open|used|void), `loans` (employment, kind, principal_minor, currency, interest_pct, installments, start_period, installment_minor, balance_minor, status requested|active|closed|written_off, approval), `payruns` (entity, schedule, kind regular|off_cycle|bonus|termination|correction|reimbursement, period_start, period_end, pay_date, status draft|calculating|calculated|approved|locked|paid|void, corrects (payrun), replaces (payrun), employee_count, gross_minor, deductions_minor, employer_minor, net_minor, currency, issues json, variance json, hash, locked_by, locked_at, publish_at, published_at, note), `payslips` (payrun, employment, employee, currency, gross_minor, deductions_minor, employer_minor, net_minor, ytd json, status draft|calculated|locked|published|void, hash, issues json, explain json, pay_method bank|cash|cheque, bank_split json), `payslip_lines` (payslip, payrun, employment, code, name, kind, stage, amount_minor, qty, rate, base_minor, pack, pack_version, step, explain, sort), `rule_packs` (code, country, region, name, version, effective_from, effective_to, status draft|tested|active|retired, body json, vectors_passed, vectors_total, tested_at, activated_by, activated_at, source (builtin|agent|person), notes), `tax_declarations` (employment, fiscal_year, country, regime, items json, proofs json, status draft|submitted|approved|rejected, approval), `benefit_plans` (entity, name, kind, employee_component, employer_component, amount_minor, percent), `benefit_enrollments` (employment, plan, from_day, to_day, amount_minor), `filings` (entity, country, kind, period, due_day, status todo|prepared|submitted|accepted|rejected|not_needed, amount_minor, currency, payrun, file, reference, note, submitted_by), `bank_files` (payrun, format, file, total_minor, count, hash, exported_by, exported_at), `journal_exports` (payrun, file, lines json).

Hiring: `staffing_plans`, `requisitions` (entity, department, title, headcount, reason, budget_minor, currency, status draft|pending|approved|rejected|filled|closed, approval), `jobs` (requisition, entity, title, description (markdown), location, remote, employment_type, salary_min_minor, salary_max_minor, currency, stages json, status draft|open|on_hold|closed, opened_at), `candidates` (name, email, phone, location, source, resume (file), links json, tags json, consent bool, consent_at, notes), `applications` (job, candidate, stage, status active|hired|rejected|withdrawn, rejected_reason, owner (member), applied_at, hired_employment), `interviews` (application, kind, round, at, duration_min, interviewers json (member ids), location, link, status scheduled|done|cancelled|no_show), `interview_feedback` (interview, interviewer, recommendation strong_no|no|yes|strong_yes, scores json, notes, submitted_at), `offers` (application, title, start_day, pay_basis, amount_minor, currency, components json, terms json, letter (file), status draft|pending|approved|sent|accepted|declined|withdrawn, approval, expires_day), `referrals`.

Lifecycle: `checklist_templates` (kind onboarding|offboarding|custom, name, entity, tasks json `[{title, assignee: hr|manager|it|employee|member:<id>, due_offset_days, needs_document, document_category}]`), `checklists` (employment, kind, template, status open|done|cancelled, start_day), `tasks` (checklist, employment, title, assignee_member, assignee_role, due, status open|done|skipped, done_at, done_by, kind task|document|signature, link), `letter_templates` (kind offer|appointment|confirmation|experience|salary_certificate|warning|relieving|custom, name, country, body (markdown with `{{placeholders}}`)), `letters` (employee, template, body, file, status draft|issued, issued_at), `separations` (employment, kind resignation|termination|retirement|end_of_contract|death|other, notice_day, last_day, reason, rehire_eligible, exit_interview json, settlement_payrun, status pending|approved|completed|withdrawn, approval), `assets` (name, tag, category, serial, employee, issued_day, returned_day, condition, value_minor, currency), `handbook` (title, body markdown, category, published, version), `grievance_types`, `grievances` (employee, type, subject, description, against_employee, confidential, status open|investigating|resolved|closed, resolution, assignee).

Performance: `review_cycles` (name, entity, kind annual|half_year|quarterly|probation|project, period_start, period_end, status draft|goals|self|manager|calibration|closed, template, participants json), `review_templates` (name, sections json: goals weight, competencies `[{name, description}]`, questions, rating scale json), `goals` (employee, cycle, title, description, kind goal|kra|okr, key_results json `[{title, target, current, unit}]`, weight, progress, status on_track|at_risk|off_track|done|dropped, due, parent), `reviews` (cycle, employee, reviewer, kind self|manager|peer|upward, answers json, ratings json, overall, status draft|submitted|shared|signed, submitted_at, signed_at), `feedback` (from_employee, to_employee, kind praise|feedback|request, text, values json, visibility private|manager|public, created), `skills` (name, category, description), `trainings` (title, kind course|workshop|certification, provider, start, end, location, link, capacity, status planned|open|done|cancelled, cost_minor, currency), `training_attendees` (training, employee, status invited|enrolled|attended|completed|no_show, score, feedback, certificate (file)).

## 5. Effective dating, corrections and history

- `job_records`, `pay_records`, `tax_profiles`, `leave_policy_assignments` are effective-dated: the row active on day D is the one with the greatest `effective_from <= D`. "Update" adds a row (history kept, reason required); "Edit" corrects a row in place (audited with before and after; allowed until a locked pay run used it, after which corrections are new rows plus back pay).
- Future-dated rows are allowed (a raise from next month). The profile timeline shows past, current and scheduled changes.
- Locked pay runs are never edited and never unlocked. Before payment: void and replace (`payruns.void` creates a draft copy linked by `replaces`). After payment: a `correction` run linked by `corrects`.
- Leave balances are a ledger (sum of entries); balances are never stored as editable numbers.

## 6. Money, currencies, time zones

- Each entity has one pay currency. Payslips are in the employment's pay currency. Reports convert to the reporting currency with `fx_rates` (Frankfurter, then currency-api on jsdelivr; the egress hosts must be literal in hooks so the gate derives them; reuse Store OS `lib_fx` code).
- `today()` is per entity timezone. Cron runs every few minutes and computes per entity whether its local time passed the target hour.
- Number display uses `Intl.NumberFormat` with the currency's exponent; inputs accept the user's locale grouping only between thousands (Expenses tracker rules).

## 7. Payroll engine and rule packs (the core)

### 7.1 Files

- `pb/pb_hooks/lib_expr.js`: a safe expression parser and evaluator (no `eval`, no `Function`, no property access to globals; pure JS usable in Node and Goja). Owner: engine builder.
- `pb/pb_hooks/lib_engine.js`: `calculate(input, packs) -> { lines, totals, explain, issues }`, pure, deterministic. Owner: engine builder.
- `pb/pb_hooks/lib_packcheck.js`: `validate(pack) -> problems[]` and `runVectors(pack, extraPacks) -> { passed, total, failures }`. Owner: engine builder.
- `pb/pb_hooks/packs/<code>.js`: built-in packs, one JS module each exporting the pack object. Owners: packs builders. Each pack carries `ship: 'active'` (verified against official sources with passing vectors) or `ship: 'draft'` (seeded as a draft a person must complete and activate; used when an official source could not be fully verified). Never ship a guessed formula as active.
- `pb/pb_hooks/data/countries/<cc>.js`: country metadata and holidays. Owners: packs builders.
- `tools/packs/test.mjs`: Node runner that loads every pack and runs its vectors (`node tools/packs/test.mjs [code]`), exits non-zero on failure. Owner: engine builder.
- `lib_payroll*.js` (payroll builder) turns database rows into the engine input and stores the output.

### 7.2 Engine input (built by payroll, consumed by the engine)

```
{
  run: { kind, period_start, period_end, pay_date, periods_per_year, period_index, periods_remaining,
         frequency, days_in_period, working_days_in_period, worked_days, first_period_of_year },
  employee: { id, birth_date, age, hire_day, end_day, nationality, gender, years_of_service },
  employment: { id, entity_country, entity_region, work_country, work_region, fte, employment_type },
  profile: { ...tax profile fields, keyed as declared by the packs },
  currency: { code, exponent },
  lines: [ { code, name, kind: 'earning'|'deduction'|'employer'|'reimbursement'|'info', stage: 'pre'|'post'|'',
             amount: <major units number>, qty, rate, tags: [...] } ],   // everything not computed by packs
  ytd: { tax_year_start: { <packCode>: 'YYYY-MM-DD' }, by_tag: { <packCode>: { <tag>: major } },
         by_code: { <packCode>: { <code>: major } }, periods_paid: { <packCode>: n } },
  context: { min_wage_hourly, ...free data payroll wants packs to see }
}
```

Amounts inside the engine are major units (numbers), because statutory tables are written in major units. Each output line is rounded by its step's rounding rule, then converted to minor units by payroll with `lib_money` (exact for the currency exponent).

### 7.3 Pack object

```
{
  code: 'us-federal', country: 'US', region: '', name: 'United States federal (FIT, FICA, FUTA)',
  version: '2026.1', effective_from: '2026-01-01', effective_to: '2026-12-31',
  currency: 'USD', tax_year: { start: '01-01' }, requires: [], order: 10,
  sources: [{ title, url, retrieved: 'YYYY-MM-DD', note }],
  notes: 'what is and is not covered, plainly',
  profile_fields: [{ key, label, type: 'enum'|'number'|'boolean'|'text'|'date'|'money', options: [{value,label}],
                     default, required, help, form: 'W-4 Step 1(c)' }],
  tags: [{ tag: 'fit_wages', label, help }],            // which component tags this pack reads
  seed_components: [{ code, name, kind, stage, calc, tags, taxable, sort }],   // defaults for a new entity in this country
  tables: { <name>: { type: 'brackets', rows: [{ over: 0, rate: 0.10, base: 0 }] }
          | { type: 'bands', rows: [{ from, to, values: { employee, employer } }] }
          | { type: 'map', rows: { <key>: <number or object> } } },
  steps: [
    { var: 'annual_wages', expr: 'sum("fit_wages") * run.periods_per_year' },
    { code: 'US_FIT', name: 'Federal income tax', kind: 'deduction', stage: 'statutory',
      when: '!profile.exempt', amount: 'max(0, table("fit_" + profile.filing_status, annual_taxable) / run.periods_per_year)',
      round: { mode: 'half_up', step: 0.01 }, tags: ['tax'], payee: 'IRS', filing: 'us_941', explain: 'Pub 15-T percentage method, Worksheet 1A' }
  ],
  vectors: [{ name, source: 'official'|'derived', reference, input: { ...partial engine input }, expect: { US_FIT: 123.45 } }],
  min_wage: { hourly, monthly, note }, filings: [{ code, name, frequency, due_rule, form }],
  documents: [{ code: 'w2', name: 'Form W-2 data', year_end: true }]
}
```

### 7.4 Expression language (exact)

- Literals: numbers (`12`, `0.062`, `1e3`), strings in double quotes, `true`, `false`.
- Names: `run.x`, `employee.x`, `employment.x`, `profile.x`, `context.x`, and earlier `var` names. Unknown names are an error at validation time (pack check) and at run time.
- Operators by precedence: `!` and unary `-`; `* / %`; `+ -` (string `+` concatenates); `< <= > >=`; `== !=`; `&&`; `||`; `c ? a : b`. Parentheses.
- Functions: `min(...)`, `max(...)`, `abs(x)`, `floor(x)`, `ceil(x)`, `round(x, dp)` (half away from zero), `round_even(x, dp)`, `round_up(x, step)`, `round_down(x, step)`, `round_to(x, step)`, `clamp(x, lo, hi)`, `if(c, a, b)`, `coalesce(a, b)`, `in(x, a, b, ...)`, `sum(tag)` (this payslip's lines with the tag, including earlier pack steps), `sum_code(code)`, `line(code)` (an earlier step's result), `ytd(tag)` and `ytd_code(code)` (before this run, within this pack's tax year), `table(name, x)` (progressive brackets: sum over rows of `(min(x, next.over) - row.over) * row.rate`, plus `base` when given), `band(name, x, column)` (the row with `from <= x <= to`), `map(name, key)` and `map(name, key, column)`, `days_between(a, b)`, `age_on(day)`, `year(day)`, `month(day)`, `periods()` (= run.periods_per_year), `prorate(x)` (x times worked_days / working_days_in_period).
- Steps run in order across packs sorted by `order`; a step with `var` stores a number or string; a step with `code` emits a line (amount can be 0; zero lines are kept only when `keep_zero: true`).
- Rounding modes: `half_up` (away from zero), `half_even`, `up`, `down`, with `step` (0.01, 1, 10, 100). Japanese rules that round the employee share at 50 sen use `mode: 'half_down_50sen'` only if the engine builder implements it; otherwise express it with `floor`/`ceil`.
- Errors carry the pack code, step index and message. The engine never throws on a single employee: the payslip gets a blocker issue.

### 7.5 Built-in packs to ship (with honest coverage notes)

| Pack code | Builder | Must cover |
|---|---|---|
| `us-federal` | west | 2026 Pub 15-T percentage method (automated, 2020+ W-4 and pre-2020 W-4 with allowances), Social Security 6.2% to the 2026 wage base, Medicare 1.45% plus 0.9% additional over 200,000 YTD, FUTA 0.6% employer to 7,000, supplemental flat rate 22% (37% over 1M) for bonus runs, pre-tax tags (401k, section 125) |
| `us-<st>` | west | state income tax withholding 2026 for at least CA, NY (state; NYC and Yonkers resident as profile switches), NJ, IL, PA (state, plus local EIT as a profile rate), MA, GA, NC, OH (state), VA, MI, CO, AZ, plus a `us-no-income-tax` pack for AK FL NV NH SD TN TX WA WY that only carries SUI and WA PFML/WA Cares; employer SUI as a per-entity rate field with each state's 2026 wage base; mark any state not done as not shipped (never ship guessed formulas) |
| `gb` | west | 2026-27 PAYE (tax code parsing for common codes: 1257L, BR, D0, D1, NT, 0T, K codes, S and C prefixes for Scotland and Wales with their bands, cumulative and week1/month1), employee and employer Class 1 NI (category A, H, M, Z basic), student and postgraduate loan plans, workplace pension auto-enrolment qualifying earnings |
| `au` | west | 2025-26 PAYG withholding Schedule 1 formula coefficients (scales 1 to 6, weekly formula scaled to fortnightly and monthly as the ATO rules say), STSL, Medicare levy variations as profile fields, Super Guarantee 12% (and the 2026 payday super rule as a note) |
| `ca-federal` | west, optional if time allows | federal tax plus CPP, CPP2, EI 2026 (T4127 formula); provinces as `ca-on` at least |
| `jp` | asia | 2026 (令和8年分) and 2027 (令和9年分) electronic withholding formula (甲 and 乙, 月額, 賞与), health insurance by prefecture (協会けんぽ FY2026 rates for all 47 prefectures as a map) and nursing care 40 to 64, 子ども・子育て支援金 from 2026-04, employees' pension 18.3% with the standard monthly remuneration grade table, employment insurance FY2026, resident tax as a per-employee monthly amount field (June to May), year-end adjustment as a year-end function (section 7.6) |
| `sg` | asia | CPF 2026 rates by age band and residency (SC, SPR year 1 and 2 graduated, SPR 3+), Ordinary Wage ceiling S$8,000 a month and the S$102,000 annual limit with Additional Wage ceiling, SDL 0.25% (min 2, max 11.25), SHG funds (CDAC, MBMF, SINDA, ECF) by profile, no income tax withholding (IR8A year-end data), and the 2027 rate change as a second version |
| `in` | asia | FY2026-27 TDS on salary under section 192 for the new regime (default) and the old regime (profile), standard deduction, rebate under 87A with marginal relief, surcharge and 4% cess, annualised projection with YTD, EPF 12/12 with EPS 8.33% on the 15,000 ceiling and EDLI, admin charges, VPF, ESI 0.75/3.25 under 21,000, plus `in-pt-<state>` professional tax packs for MH, KA, TN, WB, TG, GJ, AP and LWF where simple; note the new Labour Codes wage definition (50% rule) if in force |
| `my` | asia | EPF (Third Schedule bands as table, citizen and foreign worker 2%), SOCSO categories, EIS, LINDUNG 24 Jam (foreign workers mandatory), PCB computerised calculation (2026 specification as far as the notes and official PDFs allow; vectors from LHDN worked examples), HRD Corp levy (employer), zakat offset |
| `generic` | engine | a template pack with flat-rate income tax and flat employee and employer social contributions as profile and entity fields, for countries without a built-in pack; clearly labelled "set by you" |

Country data files `data/countries/<cc>.js` for at least: US, GB, AU, CA, JP, SG, IN, MY, plus metadata-only entries (no pack) for PH, ID, TH, VN, HK, CN, KR, TW, AE, SA, DE, FR, NL, IE, ES, IT, NZ, BR, MX, ZA, NG, KE (name, currency, week, weekend, ID types, date format, statutory leave minimums where well known). Holidays: public holidays 2026 and 2027 for US (federal), GB (England and Wales, Scotland, Northern Ireland), AU (national plus state rows tagged by region), CA (federal plus ON), JP, SG, IN (central gazetted list; states as optional), MY (federal plus states tagged by region), and for the metadata-only countries where an official list is easy to fetch. Each holiday row: `{ day, name, region: '' or code, kind }`.

### 7.6 Year-end and documents

Packs may declare `year_end` steps (Japan 年末調整 recomputation from the year's lines and declarations, India final TDS true-up in March, UK P60 figures). The payroll builder implements year-end runs (`kind: 'correction'` with `year_end: true` in the run note or a dedicated `year_end` flag in `payruns.issues` json) and the documents: US W-2 data, JP 源泉徴収票 and 給与支払報告書 data, SG IR8A data, IN Form 16 Part B and 24Q summary data, MY EA and CP8D data, GB P60 and P45, AU payment summary data. Documents render as print-ready HTML pages in the app and CSV data exports; a stored PDF is optional (section 10).

### 7.7 Bank files (payroll builder)

Formats: `generic_csv`, `nacha_ppd` (US ACH), `aba` (AU Cemtext), `sepa_pain001` (EU and GB SEPA XML pain.001.001.03), `bacs_csv` (GB, a documented simple CSV), `zengin` (JP 120-byte records, half-width katakana names), `sg_giro_csv`, `in_neft_csv`, `my_maybank_csv`, `my_cimb_txt` (from the notes; mark "check with your bank" where the layout is not official). Exporting is a `confirm` op (PIN), stored in `bank_files` with a hash, and marks the run `paid` only when the person confirms the upload.

## 8. Autonomy model (your AI agent)

- Reads: everything the owner allows; pay figures only when `settings.agent_sees_pay` (default true); sealed values never.
- Propose (becomes an Inbox proposal unless autonomy for the kind is `auto`): people record updates, pay inputs and recurring items, leave adjustments, timesheet edits, claims from receipts, job posts, interview summaries, goals, letters, pack drafts.
- Allowed directly: drafts that change nothing official (draft claims for an employee who asked, notes, task completion it was assigned, job results).
- Never (`agent: 'deny'`): approving or rejecting anything, locking, voiding, exporting files, changing bank accounts, revealing sealed values, activating packs, changing members and roles, deleting people, ranking or rejecting candidates, changing ratings.

## 9. Agent triggers (one per piece of work)

- Changed 2026-11-14 (it replaced the one trigger `work_requested` and the `agent_jobs` queue): every task that needs your AI agent's judgment is its own trigger in `triggers.json` whose only param is the record's id (`receipt_review { claim_id }`, `payrun_review { payrun_id }`, `variance_explain { payslip_id }`, `pack_update_draft` and `rule_update_check { pack_id }`, `letter_draft { letter_id }`, `job_post_draft { opening_id }`, `interview_summary { interview_id }`, `timesheet_review` and `timesheet_check { review_id }`, `review_summary_draft { summary_id }`, `onboarding_help { checklist_id }`, `question_asked { question_id }`), each with an instruction under 1,000 characters (what to read, which ops, what done looks like) and its own cooldown.
- A trigger fires only from a person's action on the record, or from an Automatic work switch the company turned on (all off by default). One fire is one piece of work; while an ask of that trigger on that record is open nothing fires again; nothing asks again on its own; a person's Retry fires once. The record keeps the ask (`agent_asks`); hooks never read `agent_requests`.
- `tools/gen_triggers.mjs` writes `triggers.json` from `lib_agent.js` and the instructions in `guide_*.js`.

## 10. Documents and files

- Payslips, letters and year-end forms render as print-ready HTML pages (`#/print/...` routes with print CSS, A4, the entity's name as plain text). `window.print()` works in a normal browser tab; inside the CraftBot frame, offer "Open in a new tab" first.
- Optional stored PDF: only if the builder proves a hook-spawned Node renderer works (Research OS pattern). Not required for v1.
- Email: payslip notice emails go through `send_gmail` via the bridge only when the company turned it on, without amounts in the body.

## 11. Frontend architecture

- Kit 0.6.0 preset (React 19, Tailwind 4, Vite 7, PocketBase SDK). Own code only in `frontend/src/app/`. Never edit `frontend/src/kit/`, `main.tsx`, `config.gen.ts`, `vite.config.ts`.
- Hash routes (`#/people/E0001`). `frontend/src/app/routes.tsx` (kernel) imports every module's `pages/<module>/index.tsx`, each of which exports `routes: RouteDef[]` (`{ path: '/time/attendance', page: Component, title, perm }`) and optional `nav: NavChild[]`. Module builders own their `index.tsx` and every file in their folder.
- `lib/api.ts` (kernel): `op(name, params)` with the member token, typed by `ops.gen.ts`; errors as `{status, message, code, data}`; `useOp(name, params, deps)` with realtime refresh by collection (`lib/live.ts`, subscribe all collections in one tick at startup); optimistic `act()` for instant UI (Advance Life OS pattern: `reference_agent_app_instant_ui`).
- `lib/format.ts` (kernel): money by currency exponent, days, times, names in the right order for the locale (family-first for JP, CN, KR, HU), relative days.
- `lib/i18n.ts` (kernel): all copy goes through `t('key')` with English as the only catalog in v1, Japanese catalog later; module builders add keys in their own `i18n/<module>.en.ts` files that the kernel auto-loads via `import.meta.glob`.
- Phone: below 768 px the sidebar becomes a bottom bar (Home, Clock, Leave, Pay, Me for employees; Home, Inbox, People, Payroll, More for admins). Tables become stacked rows (`PhoneList` pattern from Store OS). Tap targets 40 px, inputs 16 px on iOS.

## 12. The look: Piano Coach (copy it faithfully)

Source: `living-ui-marketplace/piano-coach/frontend/src/app/theme.css`, `components/ui.tsx`, `components/Sidebar.tsx`, `App.tsx`, `pages/Today.tsx`, `pages/Library.tsx`, `pages/Settings.tsx`, and `thumbnail.png` in that app's folder.

- "A quiet instrument": cool light greys derived from the host's `--agent-app-*` tokens with `color-mix` (copy the token block, rename `--pc-*` to `--hr-*` and `.pc-*` classes to `.hr-*`), hairline panels (`--hr-line`, `--hr-hair`), small monospaced uppercase readout labels (`.hr-label`: JetBrains Mono 10.5 px, 0.08em tracking), thin mono numerals for every figure (`.hr-mono .hr-num`), Inter Variable 13 px body. Light and dark follow the host (`data-theme`).
- Colour carries meaning only: blue `--hr-rh` (primary series: employee pay, earnings, present), teal `--hr-lh` (secondary series: employer cost, time, remote), red `--hr-bad` (blockers, rejected, wrong), amber `--hr-warn`, green `--hr-good`. Everything else is ink and grey.
- Your AI agent is black and white with a star (lucide `Sparkle`), like Piano Coach's coach: never an accent colour.
- Shell: left sidebar (`--hr-side`) with the app title as plain text plus a lucide `Users` icon (no drawn mark), one strong black action at the top (admins: "Run payroll" to the next due run; managers: "Approvals"; employees: "Clock in" / "Clock out"), then the places, then at the foot your AI agent (what it is doing, Count of open jobs) and Settings. It folds to a rail (`PanelLeftClose`/`PanelLeftOpen`) and folds automatically on dense pages. Active row: `--hr-active` with a 2 px ink bar on the left.
- Page header: title 15 px semibold and a mono meta line (`ACME PTE LTD · SG · 42 PEOPLE`), actions on the right as Segmented controls and IconButtons, as on the practice screen.
- Panels: hairline-bordered, `--hr-panel`, radius `min(var(--agent-app-radius), 8px)`, an optional index label like `01 · PAY RUN` in `.hr-label`. Dense tables (36 px rows, mono numerals right-aligned, sticky header), Sheet (right drawer) for record details, Dialog for confirmations, Popover menus, Toggle, Segmented, Count badges, Empty states with one action, StageDots-style status dots for statuses.
- Canvas surfaces (org chart, schedule grid, leave wallchart) use the sunk grey with the fine grid lines of Piano Coach's sheet view.
- Type scale: 10.5 (mono labels only), 12, 13, 14, 15, 26 (the one big readout number per page, mono). 4 px grid. Radius 4 to 8 px; round only for dots, switches and count badges.
- Motion: Piano Coach's quiet transitions only (150 to 200 ms colour and opacity on hover, a 6 px settle on panels when a page opens).
- Contrast: every text and control pairing passes WCAG AA in all 16 CraftBot theme packs in light and dark; if `color-mix` fails a pack, derive tokens at runtime (Expenses tracker `lib/themeColors.ts` pattern).
- Easy for anyone: one primary action per page, plain words ("Run payroll", "Request time off", "Add expense"), forms in one column with smart defaults from the country, inline validation, autosave drafts, the next step offered after every action, no jargon without a hover definition (Piano Coach Reference/glossary style `?` hints).

## 13. File ownership (who writes what)

| Builder | Owns |
|---|---|
| kernel-backend | `manifest.json`, `pb/pb_migrations/1730000000_kernel.js`, `1730000100_people.js` (and 17300000xx fixes), `pb/pb_hooks/` kernel files of 3.2 (`lib_util, lib_money, lib_auth, lib_ops, lib_catalog, lib_bus, lib_audit, lib_settings, lib_org, lib_calendar, lib_people, lib_seal, lib_approvals, lib_proposals, lib_agent, lib_notify, lib_search, lib_files, lib_guide, lib_countries, lib_fx, hooks.pb.js, ops.pb.js`), `cat_app_*.js`, `cat_org_*.js`, `cat_people_*.js`, `cat_admin_*.js`, `cat_inbox_*.js`, `events_kernel.js`, `lib_events.js`, `guide_kernel.js`, `tools/gen.mjs`, `tools/gen_triggers.mjs`, `triggers.json`, `tools/dev/*` (scratch runner), `AGENT_APP.md` frame |
| kernel-frontend | `frontend/package.json` (dependencies only, no devDependencies changes), `frontend/src/app/App.tsx`, `routes.tsx`, `theme.css`, `lib/*` (except `ops.gen.ts`), `components/ui.tsx`, `components/shell/*`, `pages/setup/*`, `pages/auth/*`, `pages/settings/*`, `pages/people/*`, `pages/inbox/*`, `pages/print/index.tsx` (print frame), `i18n/kernel.en.ts`, and the initial stub `pages/<module>/index.tsx` for every other module (handed over to that module's builder) |
| engine | `lib_expr.js`, `lib_engine.js`, `lib_packcheck.js`, `packs/generic.js`, `tools/packs/*`, `docs` section in `reference/ENGINE.md` |
| packs-asia | `packs/jp*.js`, `packs/sg*.js`, `packs/in*.js`, `packs/my*.js`, `data/countries/{jp,sg,in,my,ph,id,th,vn,hk,cn,kr,tw}.js` |
| packs-west | `packs/us*.js`, `packs/gb*.js`, `packs/au*.js`, `packs/ca*.js`, `data/countries/{us,gb,au,ca,ae,sa,de,fr,nl,ie,es,it,nz,br,mx,za,ng,ke}.js` |
| time | `1730001xxx` migrations, `lib_time*.js`, `cat_time_*.js`, `cron_time.js`, `events_time.js`, `guide_time.js`, `frontend/src/app/pages/time/*`, `components/time/*`, `i18n/time.en.ts` |
| leave | same pattern with `leave` (`1730002xxx`, `events_leave.js`) |
| expenses | same pattern with `expenses` (`1730003xxx`) |
| payroll | same pattern with `payroll` (`1730004xxx`), plus `lib_bankfiles.js`, `lib_payroll_docs.js` and the print pages `pages/print/payroll/*` |
| hiring | `hiring` (`1730005xxx`) |
| lifecycle | `lifecycle` (`1730006xxx`), print pages `pages/print/letters/*` |
| performance | `performance` (`1730007xxx`) |
| home-reports (wave 3) | `reports` (`1730008xxx`), `pages/home/*`, `pages/reports/*`, `pages/me/*` |

Each module builder works in its OWN scratch copy of `APP/` (section 14), then copies only its owned files back into `APP/` at the end, and runs `node tools/gen.mjs` in `APP/` once to confirm the merged catalog still generates (do not fix other builders' problems; report them).

## 14. Testing and gates

- Scratch root: `C:/Users/zfoong/AppData/Local/Temp/claude/c--Users-zfoong-Desktop-agent-code-git-CraftBot/c0e5901d-2062-4482-8bdc-490138be0b72/scratchpad/hr_os/` (below `SCR/`). Your folder: `SCR/<builder>/`. Copy `APP/` into `SCR/<builder>/app/` with `cp -r` (exclude `pb/pb_data`, `frontend/node_modules` is fine to copy or reinstall).
- Scratch ports (one per builder, never 3100-3179 live ports, never 3900+ shadow ports): kernel-backend 3181, kernel-frontend 3182, engine (Node only), packs (Node only), time 3183, leave 3184, expenses 3185, payroll 3186, hiring 3187, lifecycle 3188, performance 3189, home-reports 3190, QA 3191 to 3195.
- `tools/dev/serve.sh <app dir> <port>` (kernel-backend writes it): migrate up into `<app dir>/pb/pb_data`, upsert a superuser BEFORE serve (or PocketBase opens its installer in a browser), write `.agent-token` if missing, serve on `127.0.0.1:<port>` with `--hooksWatch=false` in the background, wait for `/api/health`, print the PID. `tools/dev/stop.sh <port>`. `tools/dev/reset.sh <app dir>` wipes `pb_data`.
- `tools/dev/api.mjs` (kernel-backend): a tiny Node client `op(name, params, {as: 'owner'|'agent'|<email>})` used by every builder's test scripts; it logs in members through `auth.login`.
- Each builder writes tests in `SCR/<builder>/tests/*.mjs`, runs them against its scratch port, and ships a copy into `APP/reference/tests/<builder>/` (the coordinator keeps them for regression).
- Required per module: an empty-database sweep of every read op as the owner, an employee and the agent (no 5xx); the module's flows end to end as the right roles; permission refusals (employee cannot see others, agent cannot run deny ops, proposals are created for propose ops); frontend `npm run build` passes and `tsc` has no errors; a Playwright screenshot pass of every page in light and dark at 1440 and 390 wide (playwright-core is available; run Chromium headless) checked for console errors.
- Gate: `node C:/Users/zfoong/Desktop/agent/code/git/CraftBot/agent-app/tools/src/cli.ts validate <app dir>` on your scratch copy before you hand back.

## 15. Definition of done per builder

1. Every item in your section 2 list is implemented end to end (data, ops, UI, permission, audit) or listed as deliberately left out with the reason.
2. Tests pass on an empty database and on seeded data; screenshots reviewed by you.
3. Your owned files are copied into `APP/` and `node tools/gen.mjs` succeeds there.
4. A short `APP/reference/notes/<builder>.md`: what you built, op count, decisions, known gaps, contract changes.
5. Final message to the coordinator under 300 words: done or not, op count, tests run and results, gaps, any contract changes or problems in other builders' files.
