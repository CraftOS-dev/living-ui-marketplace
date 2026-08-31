# Company OS

> Per-project plan / context / index. The building agent keeps this current
> (spec A3). Only agent-owned areas are listed under "Editable".

## What this app does

A generic company operating system: a guided Journey from idea to scale
(Validate, Set Up, First Customers, Grow, Scale), the canonical business
records every management framework converges on (profile/plan, customers,
money, projects, goals + weekly scorecard, team + seats, meetings + issues,
processes, marketing, notes), progressive module activation driven by a
data-detected stage engine, deterministic in-app workflows, and exactly two
draft-only AI assists. CraftBot is the external general agent that operates
the app (A2APP + one declared trigger). Visual identity: CraftOS Command
Center language (warm charcoal/cream, CraftBot orange, sharp corners, Inter).

## Requirements

See `reference/requirements.md` (binding). Feature checklist:

- [x] Onboarding wizard (one question per screen, skippable, no tech setup)
- [x] onboarding.complete op: company + vocab pack + modules + journey seeds + metric/meeting starters
- [x] Home: journey card, stage chip, key numbers, attention counts, suggestions, checkup trigger
- [x] Journey page: 5 stages, locked/open, why-lines, attest + module actions
- [x] journey.autocheck op (data-detected completion)
- [x] stage.recompute suggestion + stage.advance confirm flow
- [x] Sidebar shows only active modules; Settings module toggles (hide, never delete)
- [x] Company Profile one-page plan (+ Draft with AI, degrades gracefully)
- [x] Notes (docs with category, search)
- [x] Customers (vocab-driven noun + pipeline stages, list + board, follow-ups)
- [x] Money (ledger, cash on hand, monthly summary, runway, invoices; not-accounting note)
- [x] Projects (projects + tasks, list + board)
- [x] Goals (year goals, quarterly priorities, Numbers weekly scorecard grid)
- [x] Team (directory, seats, hiring tab from Grow stage)
- [x] Meetings (definitions with agenda, notes, Issues list; solo Weekly Review seed)
- [x] Processes (SOP library, type-specific starter templates)
- [x] Marketing (channels tracker, promo calendar)
- [x] Workflows: weekly digest, journey autocheck, stage check, attention sweep + daily cron
- [x] Suggestions surface (accept/dismiss, nothing self-applies)
- [x] Multi-user auth (kit LoginGate), owner recorded at onboarding, Money/Settings owner-gated
- [x] A2APP preserved; ops declared; company_checkup_requested trigger
- [x] Responsive, loading/empty/error states, toasts, confirmations, realtime

## Entities

| Collection | Purpose |
|------------|---------|
| company | Singleton: identity, type, stage, vocab pack (json), profile/plan fields, owner, onboarding flag |
| modules | One row per module key: active, suggested, activation timestamps |
| journey_steps | Seeded steps: stage, order, title, why, kind (form/module/attest), auto_rule, module key, status |
| suggestions | Proactive cards: kind, title, body, payload (json), status open/accepted/dismissed |
| customers | Contacts: name, org flag, pipeline stage (vocab), email/phone, value, follow_up, notes |
| money_entries | Ledger: kind in/out, amount, category, note, date |
| invoices | number, customer rel, amount, status draft/sent/paid, dates, recorded flag |
| projects | name, status, due, note |
| tasks | project rel, title, status todo/doing/done, owner text, due, order |
| goals | year goals: title, year, measure, status |
| priorities | quarter, title, owner_member rel, status on_track/at_risk/done, note |
| metrics | scorecard defs: name, owner_member rel, goal number, unit, direction, order, active |
| metric_entries | metric rel, week_start date, value |
| team_members | name, email, notes, active, is_owner_user marker |
| seats | name, responsibilities (json), accountable rel team_members |
| candidates | name, seat text, stage applied..hired/passed, notes |
| processes | name, category, owner_member rel, steps (json checklist) |
| meetings | name, cadence, agenda (json checklist) |
| meeting_notes | meeting rel, date, notes, decisions |
| issues | title, detail, status open/solved, solution |
| channels | marketing channels: name, monthly_cost, note, active |
| promos | calendar: title, channel rel, date, status idea/planned/done |
| notes | docs: title, category, body, pinned |
| workflow_runs | workflow key, status, summary, finished |

All collections carry `@request.auth.id != ""` rules (multi-user mode).

## Operations

Declared in `operations.json`; discoverable at `GET /api/_ops`.

| Op | Purpose |
|----|---------|
| onboarding.complete | Create company from wizard answers; seed vocab, modules, journey, metrics, meetings |
| journey.autocheck | Mark data-detectable journey steps done; returns which |
| stage.recompute | Compute suggested stage from data; open a suggestion when it differs |
| stage.advance | User-confirmed stage change; unlock steps, suggest modules |
| workflows.run | Run a built-in workflow by key (digest / autocheck / stagecheck / attention) |
| ai.draft-plan | Draft empty profile plan fields via CraftBot bridge LLM (draft-only, degrades) |

## Agent triggers (triggers.json)

| Trigger | Fired by | Instruction summary |
|---------|----------|---------------------|
| company_checkup_requested | Home button "Ask CraftBot for a company checkup" | Review records via lui data/ops, write a checkup note into `notes`, solve nothing destructive |

## External data

| Source | Used for | Auth | Called from |
|--------|----------|------|-------------|
| (none) | The app is fully self-contained; the CraftBot bridge (callLLM) is the only optional external surface and degrades gracefully. | | |

## Scheduled jobs

`cronAdd('companyOsDailyTick', '0 6 * * *')` → journey.autocheck + stage.recompute + attention sweep (suggestion cards only; nothing outward).

## Ownership map

- Editable: `frontend/src/app/`, `pb/pb_migrations/`, `pb/pb_hooks/ops.pb.js`
  (+ `lib_company.js`, `workflows.js` modules), `operations.json` (non-system
  entries), `triggers.json`, this file.
- System-managed (never edit): `frontend/src/kit/`, `frontend/src/main.tsx`,
  `pb/pb_hooks/_system.pb.js`, `manifest.json`, build configs.

## Change log

- 2026-08-22: Added an app-owned module refresh event and an explicit modules refetch path so the sidebar and gated pages update immediately after module activation from Home, Settings, or ActivateGate.
- 2026-08-22: Settings now visibly shows the company owner value from the company record.
- 2026-08-22: Home now treats `company_checkup_requested` as actively working only after a request is claimed, and shows the honest pending state when no agent is connected yet.
- 2026-08-22: Saving a customer now triggers the existing `journey-autocheck` and `stage-recompute` ops so first-customer journey completion and related suggestions refresh immediately without a manual workflow run.
- 2026-08-23: Full UI/UX redesign after a SOTA research pass (Linear, Stripe, Mercury, Attio, Notion, Shopify patterns): new primitive layer (tinted status pills with dots, identity chips, hover-revealed row actions, relative dates, signed tabular money, stat tiles with sparklines, guided empty states), grouped sidebar nav, Stripe-style Home with a Needs Attention list, Shopify/Duolingo-style Journey rail, Attio-style customer rows and pipeline board with value rollups, Mercury-style Money verdict header with runway sentence and month-grouped ledger, EOS scorecard grid with pass/fail tinting and per-row sparklines, Linear-style project rows with progress rings, label-left Settings rows. Root-cause fix: PocketBase SDK auto-cancellation disabled at startup (concurrent same-collection list requests were randomly blanking views, including the old Team page failure). Past-tense dates now render as 'ago', never 'overdue'.
