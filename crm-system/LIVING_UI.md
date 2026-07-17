# CRM System

An Attio/Folk-class CRM for a small team: People, Companies, and Deals as linked records with custom typed attributes, browsed through saved table/kanban views with inline editing, worked through 3-panel record pages with activity timelines, and accelerated by on-demand AI.

## Overview

CRM System is a full-featured, multi-user CRM Living UI. The primary browsing surface is a dense, spreadsheet-style data table with saved views, click-to-edit cells, filter chips, bulk selection, and CSV import/export on the toolbar. Deals move through multiple drag-and-drop kanban pipelines whose stages are edited inline on the board (add, rename, recolor, reorder, won/lost — never buried in Settings). Clicking a record opens a 3-panel record page (details sidebar, tabbed activity timeline with composer, related-records panel); tables also support a side-panel peek. Tasks roll up into a My Work screen; a Cmd+K command palette provides fuzzy record search and quick actions; a dashboard and reports cover funnel conversion, win rate, velocity, and activity volume; SMTP powers real email sending with templates; and CraftBot's LLM provides on-demand AI (record summary, email drafting, lead scoring, "ask your CRM" chat) that degrades gracefully to honest empty states when unconfigured.

Built for the AI-agent-startup founder workflow: the demo seed ships a Sales Pipeline and a Fundraising pipeline (deals), a Design Partners list (companies), and a Community list (people) with realistic data.

## Requirements

Gathered in Phase 0 (two batches, answered 2026-07-16) on top of the full spec in `CRM_LIVING_UI_REQUIREMENTS.md` at repo root.

### Phase 0 decisions

**Batch 1 — data & features:**
1. **Multi-user with login** — CraftBot auth module (JWT + bcrypt); first registered user becomes admin.
2. **Replaces the old `crm_system` catalogue entry** (that folder no longer existed in the repo; the stale registry entry is replaced).
3. **Demo seed ships four pipelines/lists** (Sales, Fundraising, Design Partners, Community) — and users create/configure their own pipelines and stages inline on the board.
4. **Gmail auto-population is out of v1.** First-run "aha" comes from the demo seed and CSV import.

**Batch 2 — design & layout:**
1. **shadcn/ui frontend** — explicitly NOT the template's preset `components/ui` library. Tailwind + shadcn primitives, sonner toasts, lucide-react icons, react-hook-form + zod forms.
2. **Host-owned theming** — shadcn design tokens keyed off the host's `data-theme` attribute; no in-app theme toggle; light + dark both ship.
3. **Sidebar as specced:** Home, My Work, People, Companies, Deals, Lists section (+ New list), Reports, Settings; icon rail below 1024px, sheet below 768px.
4. **Shared workspace:** all users see the same CRM data; admin role gates SMTP config and the team list.

### Entities & Data Model

Attio's architecture on SQLite: fixed core objects (Person, Company, Deal) with system fields as real columns + a custom-attribute EAV pair (Attribute/AttributeValue) that powers both object-scoped and list-scoped fields. Lists layer on top of objects: a ListEntry carries workflow state (stage, board position) without altering the record, so a deal can sit in multiple pipelines with independent stages. Stages belong to lists. Views persist layout + filters + sorts + columns server-side. Every meaningful mutation writes an Activity row — the timeline is generated, never hand-maintained.

### Layout & Design

Data-table-first. Neutral grayscale surfaces, one accent (primary token), dense 1px-bordered 36px-row tables, soft pastel pills with strong same-hue text, avatars everywhere (initials on deterministic pastel; company favicons with initial fallback), 13px body, 11px bold ALL-CAPS section labels, tabular numerals for currency. Chart palette validated with the dataviz six-checks validator for both light and dark surfaces. Max one level of tabs on record pages; inline editing first; modals only for creation flows and destructive confirmations (alert-dialog, never window.confirm).

### Features

All MUST requirements from CRM_LIVING_UI_REQUIREMENTS.md §5 (F1–F11) are implemented; see API/Components below.

### Assumptions

- Small-team concurrency via SQLite WAL; views refetch on navigation and on `crm:data-changed` events (no realtime sync).
- All authenticated users share one workspace; `admin` gates SMTP settings and the team list; demo seed/clear is available to all (guarded by a destructive-confirm dialog).
- Email sends via admin-configured SMTP; no OAuth. AI via CraftBot's LLM interface (sibling-repo import) with honest disabled states.
- Currency is per-deal (USD default); reports sum numeric values across currencies.
- Record merge (F1.5, SHOULD) is not in v1 — duplicate detection warns inline at create time with links to the existing record.

## Data Model

### Backend Models (backend/models.py + auth_models.py)

| Model | Purpose | Key Fields |
|-------|---------|------------|
| Person | People records | first_name, last_name, emails (JSON), phones (JSON), job_title, company_id FK, linkedin, location, avatar_color, last_interaction_at |
| Company | Company records | name, domain, industry, size, location, annual_revenue, avatar_color, last_interaction_at |
| Deal | Deal records (stage lives on ListEntry) | name, value, currency, company_id FK, primary_person_id FK, owner, status (open/won/lost), expected_close_date, closed_at |
| DealPerson | Deal↔person many-to-many | deal_id, person_id (unique pair) |
| Attribute | Custom field definition (object- or list-scoped) | object_type, list_id, name, slug, type (14 types), options (JSON), is_system, ai_prompt, position |
| AttributeValue | EAV value storage | attribute_id, record_type, record_id, list_entry_id (0 = record scope), value (JSON) |
| RecordList | A workflow list/pipeline | name, icon, color, parent_object, position |
| Stage | Kanban column (belongs to a list) | list_id, name, color, position, is_won, is_lost, probability |
| ListEntry | Record membership in a list | list_id, record_type, record_id, stage_id, position, stage_entered_at |
| SavedView | Saved view | object_type or list_id, name, layout (table/kanban), filters, sorts, visible_columns, group_by, is_default |
| Activity | Timeline entry (system-written + manual logs) | record_type, record_id, type, title, body, actor, occurred_at, extra (JSON) |
| Note | Markdown-ish notes with pinning | record_type, record_id, title, content, pinned, created_by |
| Task | Tasks with due dates + record links | title, description, due_date, completed_at, record_type, record_id |
| SmtpConfig | Singleton SMTP settings | host, port, username, password, from_email, from_name, use_tls |
| EmailLog | Sent + manually logged emails | person_id, record ref, direction, to/from, subject, body, status, error |
| EmailTemplate | Reusable emails with `{{variable}}` rendering | name, subject, body |
| Tag / RecordTag | Cross-object labels + assignments | name, color / tag_id, record_type, record_id |
| Attachment | Files tab storage (backend/uploads/) | record_type, record_id, file_name, file_path, size, mime |
| AiRun | Audit of every AI invocation | kind, record ref, input, output, model, created_by |
| User / Membership / Invite | Auth module (JWT + bcrypt; first user = admin) | email, username, password_hash, role |
| AppState / UISnapshot / UIScreenshot | Template state + agent observation | data (JSON) / DOM snapshot / PNG base64 |

## API Endpoints

### System + agent API (backend/routes.py)

| Method | Path | Description |
|--------|------|-------------|
| GET/PUT | /state | App state; GET adds a `crm` summary (counts, pipeline, recent activity) for agents |
| POST | /state/replace, DELETE /state | Replace / clear state |
| POST | /action | Agent actions: create_contact, create_deal, move_deal, add_note, complete_task, seed_demo, refresh |
| GET/POST | /ui-snapshot, /ui-screenshot | Agent observation (template) |
| POST | /auth/register, /auth/login, … | Auth module (register/login/me/users/members/invites) |

### CRM routers (backend/api/*, all JWT-protected)

| Method | Path | Description |
|--------|------|-------------|
| POST/GET | /records/{type} | Create / list records (person, company, deal) |
| POST | /records/{type}/query | Table query: filters, sorts, search, pagination, list scope |
| GET | /records/{type}/check-duplicates | Inline duplicate warning by email/domain |
| GET/PUT/DELETE | /records/{type}/{id} | Detail (memberships + related) / partial update with field-change activities / idempotent cascade delete |
| POST/DELETE | /deals/{id}/people[/{person_id}] | Deal↔person links |
| GET | /search | Global fuzzy search for the command palette |
| GET/POST/PUT/DELETE | /attributes[/{id}] | Custom attribute definitions (inline "+ column") |
| POST | /attribute-values | Single-cell write for inline editing |
| GET/POST/PUT/DELETE | /lists[/{id}] | Lists/pipelines (delete never deletes records) |
| GET | /lists/{id}/board | Kanban payload: columns, cards, counts, value sums |
| POST/DELETE | /lists/{id}/entries[/{entry_id}] | Add/remove records on a list |
| PUT | /entries/{id}/move | Drag-drop move: stage_change activity, stage_entered_at, won/lost → deal status |
| POST/PUT/DELETE | /lists/{id}/stages, /stages/{id}, /lists/{id}/stages-reorder | Inline stage editing on the board |
| GET/POST/PUT/DELETE | /views[/{id}] | Saved views (single default per scope) |
| GET | /timeline/{type}/{id} | Paginated timeline with type filter chips |
| POST/DELETE | /activities[/{id}] | Manual call/meeting/email logging |
| GET/POST/PUT/DELETE | /notes… | Notes with pinning (writes note_created activities) |
| GET/POST/PUT/DELETE | /tasks[/{id}], GET /tasks/my-work | Tasks + My Work buckets (overdue/today/upcoming/no-date/completed) |
| GET/PUT | /email/config, POST /email/config/test | SMTP settings (admin) + test send |
| POST | /email/send, /email/log | SMTP send with template rendering / manual thread logging |
| GET | /email/logs, CRUD /email/templates… | Email history + templates |
| GET/POST/PUT/DELETE | /tags…, /tags/{id}/records… | Tags + assignments |
| POST/GET/DELETE | /files…, GET /files/download/{id} | Attachments (JSON base64 upload, 10 MB cap) |
| GET | /dashboard | Counts, pipeline summary, won this/last month, tasks due, recent activity, reconnect, checklist |
| GET | /reports/funnel, /reports/win-rate, /reports/velocity, /reports/activity-volume, /reports/export | Reports + CSV export |
| POST | /import/csv, GET /import/fields, GET /export/csv | CSV import (mapping + dedupe) / export (view, list, or selection scope) |
| POST | /seed/demo, /seed/clear | Demo dataset / clean workspace (keeps users + SMTP) |
| GET/POST | /ai/status, /ai/summary, /ai/email-draft, /ai/score, /ai/chat, GET /ai/runs | On-demand AI; 200 + `configured:false` when no LLM |

Smoke-test contract: enum-like body fields use `Literal`, date/email fields carry `format` hints, no DELETE requires query params, all PUT/DELETE return 200 no-ops on missing rows, and GET path params that the runner substitutes ids into are plain strings.

## Frontend Components

| Component | Purpose |
|-----------|---------|
| MainView.tsx | Shell: hash routing, global shortcuts (⌘K / T / C / ?), UiActions context, dialog hosting |
| shell/Sidebar.tsx | Nav + lists + user menu; icon rail <1024px, sheet <768px |
| shell/CommandPalette.tsx | ⌘K: fuzzy record search (avatars + type badges), quick actions, navigation |
| shell/CreateRecordDialog.tsx | Person/company/deal creation (rhf+zod) with inline duplicate warning |
| shell/CreateListDialog.tsx / TaskQuickAdd.tsx / ShortcutsDialog.tsx | New pipeline, `T` task capture, `?` cheat sheet |
| views/ObjectPage.tsx | Toolbar: saved-view switcher, layout toggle, search, filter chips, Import/Export, + New; pagination |
| views/DataTable.tsx | Dense sticky-header table: hover checkboxes, shift-range select, column menus, inline "+ column", keyboard nav (↑↓/Enter/Space), mobile card list |
| views/CellEditor.tsx | Type-appropriate inline editors: text/number/currency/date inputs, select/status pills, multiselect, rating stars, checkbox, company picker |
| views/FilterBar.tsx | Filter chips + builder popover (field + operator + value, AND) |
| views/BulkBar.tsx | Floating bulk bar: edit field, tag, add to list, export CSV, delete (confirm) |
| views/ImportDialog.tsx | CSV upload → column mapping → dedupe → import report |
| views/RecordPeek.tsx | Space-key side-panel peek with expand-to-full-page |
| board/KanbanBoard.tsx | dnd-kit drag & drop, optimistic moves with rollback, column sums, days-in-stage, inline stage add/rename/recolor/reorder/won-lost/delete, touch move-to-stage menu |
| record/RecordPage.tsx | 3-panel record page: details (inline edit + tags + show-all), tabs, related panel (collapses <1100px, stacks on mobile), quick actions, rename, delete |
| record/TimelinePanel.tsx | Day-grouped timeline: composer on top, filter chips, compact system entries vs. content cards |
| record/OverviewTab / NotesTab / TasksTab / EmailsTab / FilesTab | Highlight tiles + digest; markdown-ish notes with pinning; record tasks; email history + manual log; attachments |
| record/ComposeEmailDialog.tsx | SMTP composer with templates + AI draft/refine with tone control |
| record/AiSummaryDialog.tsx / ai/AiChatSheet.tsx | On-demand record summary (save as pinned note) / "Ask your CRM" slide-over with record chips |
| pages/Dashboard.tsx | First-run welcome (seed/import/clean), stat tiles, pipeline bars, tasks, activity feed, reconnect, checklist |
| pages/MyWork.tsx / Reports.tsx / Settings.tsx | Task buckets; funnel/win-rate/velocity/volume charts (validated palette) + CSV export; SMTP/templates/data/AI/team settings |
| components/ui/* | shadcn/ui primitives (button, dialog, dropdown, select, command, sheet, table, form, sonner toaster, …) |
| common/RecordAvatar / Pill / EmptyState | Avatars everywhere, pastel pills, purposeful empty states |

## Key Files

| File | Purpose |
|------|---------|
| backend/models.py | All SQLAlchemy models |
| backend/crm_core.py | Shared helpers: record polymorphism, activity logging, cascade delete, smoke-safe no-ops |
| backend/api/*.py | Domain routers (records, attributes, lists, views, timeline, tasks, emails, tags, files, reports, ai, data_io) |
| backend/routes.py | System routes, agent state/actions, auth router, api/ auto-discovery |
| backend/bootstrap.py | Idempotent defaults: Sales Pipeline + default views on first read |
| backend/seed_data.py | Deterministic demo dataset (58 people, 20 companies, 4 lists, history) |
| backend/services/llm_service.py / email_service.py | CraftBot LLM wrapper (graceful None) / smtplib sender |
| backend/auth_*.py | Auth module (models, service, middleware, routes) |
| frontend/api.ts | Typed authenticated API client |
| frontend/types.ts | TypeScript interfaces mirroring backend payloads |
| frontend/lib/columns.ts / format.ts | Table column model / formatting + pill + favicon helpers |
| frontend/styles/global.css | Tailwind + shadcn tokens (dark default, `[data-theme="light"]` overrides, validated chart palette) |
| LIVING_UI.md | This document |

## State Flow

```
User Action → React component → api.ts (authFetch, JWT) → FastAPI router → SQLite
                     ↓                                          ↓
              optimistic update                        Activity row written
                     ↓                                          ↓
          rollback + toast on error            timeline / dashboard / reports
```

Agents: `GET /api/state` (counts + pipeline + recent activity) and `POST /api/action` (create_contact, create_deal, move_deal, add_note, complete_task, seed_demo) — both unauthenticated for the CraftBot bridge; the human UI is JWT-gated.

## Testing

1. `cd backend && python -m pytest tests/ -v` — 46 tests: auth, records/EAV, lists/board/moves, views, timeline/notes/tasks, email/tags/files, reports, AI degradation, CSV, seed, agent API.
2. `python test_runner.py --internal`, `--unit`, and (with the server running) `--external --port <port>` — all `ALL TESTS PASSED` against a fresh DB.
3. Browser (verified via headless Chromium): register → seed demo → dashboard populated → inline-edit a cell → bulk-select → drag a deal to Won on the board (status flips, toast) → open record → note via composer → task via `T` → complete in My Work → reports render → ⌘K search opens records → 360px: sidebar sheet, card lists, no horizontal overflow → light theme via `data-theme` flip.
