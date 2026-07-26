# {{PROJECT_NAME}}

> Per-project plan / context / index. The building agent keeps this current
> (spec A3). Only agent-owned areas are listed under "Editable".

## What this app does

{{PROJECT_DESCRIPTION}}

A multi-user CRM (sign-up/login via the kit LoginGate): dashboard,
people and companies, a staged deal pipeline (drag deals between stages),
tabbed record pages (overview / notes / tasks / timeline) with AI
summaries, a task list, and a ⌘K command palette. Remaining V1 features
not ported (add as modifications when needed): SMTP/email sending,
custom attribute (EAV) system, saved views, attachments.

## Requirements

Feature checklist:

- [x] Deal pipeline board: seeded stages (Lead → Qualified → Proposal → Won/Lost)
- [x] Drag deals between stages; per-stage total value shown
- [x] Deals: create/edit dialog (value, stage, company, contact), delete, notes
- [x] People: table, create/edit dialog, company link, delete, notes
- [x] Companies: table with people count, quick-add, detail dialog, notes
- [x] Notes on deals, people and companies (timestamped)
- [x] Tasks: add with due date, done toggle, overdue in red, person badge
- [x] Multi-user auth (LoginGate sign-up/login; all collections require auth)
- [x] Dashboard tab (open pipeline value, per-stage bars, tasks due, recent activity)
- [x] Tabbed record pages: Overview / Notes / Tasks / Timeline on deals, people, companies
- [x] Activity timeline (auto-logged: record created, stage moved, note/task events)
- [x] ⌘K command palette (search people/companies/deals + quick create)
- [x] Keyboard shortcuts (⌘K, D new deal, P new person, ? help dialog) + header quick-add task
- [x] Settings tab: email template manager + delivery explanation
- [x] AI record summaries (✨ button — CraftBot LLM bridge, graceful 503 outside)
- [x] Multi-contact deals (any number of people per deal)
- [x] Tags (manager, chips on tables, assign per record, filterable)
- [x] List filters + saved views on People/Companies/Deals
- [x] File attachments (Files tab, native PB storage, download links)
- [x] Custom fields (EAV: text/number/select per entity, manage dialog)
- [x] Email: compose from a person (templates, Gmail via CraftBot bridge, local log fallback), Emails tab
- [x] AI assistant chat (pipeline-aware, LLM bridge)
- [x] Reports tab (win rate, value won, deals/month, top companies)
- [x] Pipeline stage manager (add, rename, recolor, reorder, delete when empty)
- [x] CSV import (people, companies) and CSV export (people, companies, deals)
- [x] Record lists: named lists of people/companies/deals, each with its OWN stages —
      a per-list board with drag-and-drop (or a plain table when it has no stages)
- [x] My work list on the dashboard
- [x] Seeded example data (2 companies, 2 people, 2 deals, 1 task)
- [x] `pipeline.summary` op — per-stage deal count + total value

## Entities

| Collection | Purpose | Notes |
|------------|---------|-------|
| companies  | Accounts | name, domain, industry |
| people     | Contacts | name, email, phone, title, company (rel) |
| stages     | Pipeline stages | name, order, color; empty `list` = main deal pipeline, set = that list's own stages |
| deals      | Opportunities | name, value, stage (rel), company (rel), person (rel), close_date |
| notes      | Notes on any record | body + optional person/company/deal rels (cascade) |
| tasks      | To-dos | title, due (YYYY-MM-DD), done, optional deal/person rels |
| activities | Timeline events | kind, body, optional person/company/deal rels (cascade) |
| lists      | Record lists | name, entity (people/companies/deals), description |
| list_entries | Membership of a record in a list | list (rel), record_id, stage (rel), position; unique (list, record_id) |

## Operations

Declared in `operations.json`; discoverable at `GET /api/_ops`.

- `pipeline.summary` — deal count and total value per stage.
- `records.summarize` — AI summary of a person/company/deal via the LLM bridge.

## Ownership map

- Editable: `frontend/src/app/`, `pb/pb_migrations/`, `pb/pb_hooks/ops.pb.js`,
  `operations.json` (non-system entries), this file.
- System-managed (never edit): `frontend/src/kit/`, `frontend/src/main.tsx`,
  `pb/pb_hooks/_system.pb.js`, `manifest.json`, build configs.
