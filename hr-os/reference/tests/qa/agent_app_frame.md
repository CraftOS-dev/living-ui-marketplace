# HR OS

HR and payroll for one company with several legal entities, countries and
currencies: people and the org chart, time and attendance, leave, expenses,
payroll with country rule packs, hiring, performance and the employee
lifecycle. Your AI agent reads receipts, reviews pay runs, drafts letters and
answers questions; what it changes waits in the Inbox for a person, unless the
owner set that kind of change to automatic.

Binding build spec: `reference/BUILD_SPEC.md`. Builder notes and contract
changes: `reference/notes/<builder>.md` (they win over the spec). Module
sections of this file: `reference/agent_app/<module>.md` (the coordinator
merges them below).

## Requirements

Feature checklist (kernel; each module adds its own list in its section):

- [x] First-run setup: company, first legal entity (country defaults), owner with password, approval PIN and a recovery code shown once
- [x] Team sign-in (`members`), invites with codes, lockout after wrong passwords, sign out everywhere, owner recovery
- [x] Roles with a level per module (people, time, leave, expenses, payroll, hiring, performance, reports, admin), team scope for managers, entity scope per member
- [x] Approval PIN (six digits, bcrypt, lockout) for the serious steps (`effect: 'confirm'` ops and approvals that need it)
- [x] Legal entities (country, region, currency, time zone, fiscal year, packs), locations with geofence and kiosk code, departments with head and approver, job titles, grades with pay ranges, cost centres, employment types
- [x] Holiday calendars seeded from country data (new years added at boot), company holidays, CSV import; work schedules
- [x] People: employees and employments (several entities per person), effective-dated job, pay and tax records (Update keeps history, Edit corrects in place until a locked run used it), scheduled changes, timeline
- [x] Personal details with self-service (contact details, emergency contacts, dependants), documents with acknowledgement, skills, identity documents and bank accounts sealed (masked; reveal with the PIN for five minutes, audited)
- [x] Bank accounts wait for a payroll administrator's approval with the PIN (two-person rule)
- [x] Directory with filters and as-of days, org chart, CSV import (check, then commit) and export
- [x] Approvals with flows (manager, manager of manager, department approver, role, member; auto-approve limits; no self-approval except the only administrator)
- [x] Your AI agent's proposals (before and after, accept or dismiss, stale check, autonomy per kind), and one trigger per piece of work fired from the action that needs it (the ask kept on the record, Retry once, Automatic work switches off by default)
- [x] Notifications (in app, optional email through your AI agent's Gmail without amounts), Ctrl-K search, audit trail on every write, exchange rates for reports

## Entities

Kernel collections (module collections are listed in the module sections).
Every collection is closed to the raw API (rules null) and refuses direct
writes, even a superuser's (`hooks.pb.js`); screens and your AI agent use the
operations.

| Collection | Purpose | Notes |
|------------|---------|-------|
| settings | One row: company, reporting currency, date style, autonomy per kind, agent and manager pay visibility, email, payslip hour, sign-in limits | `extra` json for later settings |
| roles | Roles with `levels` per module and `team_scope` | seven built-in roles (`system`) |
| members | Team sign-in (auth) | `entities` scope (empty = all), `employee` link, lockout and PIN lock fields, owner `recovery_hash` |
| pin_vault | The approval PINs (auth, bcrypt), one per member | never readable through the API |
| entities | Legal entities | `packs` json, `default_calendar`, `default_schedule`, ids of module defaults |
| locations, departments, job_titles, grades, cost_centers, employment_types | Organisation | `archived` instead of delete once used |
| holiday_calendars, holidays | Public and company holidays | `builtin` calendars fill from `data/countries/<cc>.js`, `seeded_years` |
| work_schedules | The work week | `week` [{dow, start, end, break_min}], hours per week |
| employees | People | number `E0001`, names (order, kana), personal details, `emergency` and `dependants` json |
| employments | A person at an entity | number, start and end days, status pre_hire, active, on_leave, notice, ended |
| job_records, pay_records, tax_profiles | Effective-dated records | one per employment and day; greatest `effective_from <= day` is in effect |
| bank_accounts, identity_docs | Sealed numbers (`*_sealed` with `lib_seal`, `*_masked`) | bank accounts are pending until approved |
| documents | Documents of a person | protected file, sharing, acknowledgement, expiry |
| employee_skills | Skills (name and level 1 to 5) | the performance module owns `skills` (catalogue) |
| audit | Who did what (person, your AI agent, the app) | before and after for corrections; sealed values never |
| approvals, approval_flows | Generic approvals and their flows | `steps`, `step`, `approvers`, `history`, `needs_pin` |
| proposals | Your AI agent's proposals | items with op, params, before and after, state |
| agent_questions | A person's question to your AI agent and its answer | the `question_asked` trigger; `agent_asks` |
| timesheet_reviews | A week of timesheets your AI agent is asked to check | `timesheet_review` (a person), `timesheet_check` (weekly, when switched on) |
| notifications | Per member | `email` pending, sent, failed |
| fx_rates | Exchange rates per day | reports only |
| imports | CSV checks and imports | report json |
| counters | Number sequences | employee numbers |

## Operations

Generated from the catalog (`pb/pb_hooks/cat_*.js`, auto-discovered) by
`node tools/gen.mjs` into `pb/pb_hooks/routes.pb.js`, `operations.json` and
`frontend/src/app/lib/ops.gen.ts`; never edit those three by hand. Every op
runs through `lib_ops.js`: caller (member token, or your AI agent by
`X-A2App-Token`), permission (`perm`), parameters, the approval PIN for
`effect: 'confirm'`, proposal or run, audit, JSON answer, realtime signal.
`app.guide` lists every op with its marks; module ops are described in the
module sections.

Kernel groups: `app`, `setup`, `countries`, `search`, `auth`, `pin`,
`members`, `roles`, `settings`, `audit`, `fx`, `imports`, `entities`,
`locations`, `departments`, `titles`, `grades`, `cost-centers`,
`employment-types`, `calendars`, `holidays`, `schedules`, `people`,
`employments`, `job`, `pay`, `tax`, `documents`, `employee-skills`, `ids`,
`bank`, `seal`, `approvals`, `approval-flows`, `proposals`, `jobs`,
`notifications`.

Marks: `[People only.]` ops are refused for your AI agent; `[Becomes a
proposal ...]` ops wait in the Inbox unless the owner set that kind to
automatic; confirm ops need the person's six-digit PIN (`--pin`).

## Triggers

One trigger per piece of work (`triggers.json`, written by `node
tools/gen_triggers.mjs` from `pb/pb_hooks/lib_agent.js` and the instructions
in `pb/pb_hooks/guide_*.js`), fired from the action that needs it with the
record's id; the ask is kept on the record (`agent_asks`). See "Agent
triggers" in AGENT_APP.md (built by `build_agent_app.mjs` with
`agent_triggers_md.mjs`).

## External data

| Source | Used for | Auth | Called from |
|--------|----------|------|-------------|
| api.frankfurter.dev (ECB rates) | Exchange rates for reports | none | `lib_fx.js` (every six hours, `fx.refresh`) |
| cdn.jsdelivr.net (currency-api) | Rates Frankfurter lacks | none | `lib_fx.js` |
| CraftBot bridge `send_gmail` | Notification emails when the company turned them on | bridge token | `lib_notify.js` (minute job) |

## Ownership map

- Kernel (kernel-backend): `manifest.json`, `pb/pb_migrations/17300000xx`, `1730000100_people.js`, `pb/pb_hooks/hooks.pb.js`, `ops.pb.js`, `lib_util`, `lib_money`, `lib_auth`, `lib_ops`, `lib_catalog`, `lib_bus`, `lib_audit`, `lib_settings`, `lib_org`, `lib_calendar`, `lib_people`, `lib_seal`, `lib_approvals`, `lib_proposals`, `lib_agent`, `lib_notify`, `lib_search`, `lib_files`, `lib_guide`, `lib_countries`, `lib_fx`, `lib_events`, `events_kernel.js`, `guide_kernel.js`, `cat_app_*`, `cat_org_*`, `cat_people_*`, `cat_admin_*`, `cat_inbox_*`, `tools/gen.mjs`, `tools/gen_triggers.mjs`, `triggers.json`, `tools/dev/*`, this frame.
- Kernel frontend: `frontend/src/app/` shell, `lib/*` (except `ops.gen.ts`), `components/ui.tsx`, `pages/{setup,auth,settings,people,inbox}`, `pages/print/index.tsx`, `i18n/kernel.en.ts`.
- Engine: `lib_expr.js`, `lib_engine.js`, `lib_packcheck.js`, `packs/generic.js`, `tools/packs/*`, `reference/ENGINE.md`.
- Packs: `packs/<cc>*.js`, `data/countries/<cc>.js`.
- Modules (time, leave, expenses, payroll, hiring, lifecycle, performance, home-reports): their migration range, `lib_<module>*.js`, `cat_<module>_*.js`, `events_<module>.js`, `cron_<module>.js`, `guide_<module>.js`, `frontend/src/app/pages/<module>/`, `components/<module>/`, `i18n/<module>.en.ts`.
- System-managed (never edit): `frontend/src/kit/`, `frontend/src/config.gen.ts`, `pb/pb_hooks/_*.js`.
- Secrets in the app folder, never in the database or a backup of `pb_data`: `.agent-token` (platform), `.superuser` (platform), `.seal-key` (made at first boot; without it sealed numbers cannot be read).

## Modules

(Module sections are merged here from `reference/agent_app/<module>.md`.)
