# {{PROJECT_NAME}}

> Per-project plan / context / index. The building agent keeps this current
> (spec A3). Only agent-owned areas are listed under "Editable".

## What this app does

{{PROJECT_DESCRIPTION}}

A Trello-like kanban board: multiple boards, each with ordered lists and
cards. Cards carry labels, a priority, a due date, a checklist, and can be
archived. Cards move between lists by drag-and-drop.

## Requirements

Feature checklist:

- [x] Multiple boards (create, switch)
- [x] Lists per board (create, delete when empty, ordered)
- [x] Cards per list (create, edit title/description, delete)
- [x] Drag-and-drop cards between lists
- [x] Board-scoped labels (seeded palette, toggle per card, colored chips)
- [x] Card priority (none/low/medium/high, badge on card)
- [x] Due dates (date picker, overdue shown in red)
- [x] Checklists per card (add/toggle/remove, progress bar on card)
- [x] Archive cards (hidden from board; bulk-purge via cards.clear-archived op)
- [x] Starter board seeded on first launch (My Board + To Do/In Progress/Done)

## Entities

| Collection | Purpose | Notes |
|------------|---------|-------|
| boards     | Top-level boards | name |
| lists      | Columns of a board | board (rel), title, position |
| cards      | Cards in a list | list (rel), title, description, priority, due_date, position, archived, labels (rel multiple), checklist (json) |
| labels     | Board-scoped label palette | board (rel), name, color |

## Operations

Declared in `operations.json`; discoverable at `GET /api/_ops`.

- `cards.clear-archived` (destructive) — delete all archived cards.

## Ownership map

- Editable: `frontend/src/app/`, `pb/pb_migrations/`, `pb/pb_hooks/ops.pb.js`,
  `operations.json` (non-system entries), this file.
- System-managed (never edit): `frontend/src/kit/`, `frontend/src/main.tsx`,
  `pb/pb_hooks/_system.pb.js`, `manifest.json`, build configs.
