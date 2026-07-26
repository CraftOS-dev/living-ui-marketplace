# {{PROJECT_NAME}}

> Per-project plan / context / index. The building agent keeps this current
> (spec A3). Only agent-owned areas are listed under "Editable".

## What this app does

{{PROJECT_DESCRIPTION}}

A compact habit tracker: habits grouped by category on a 14-day grid.
Click a cell to toggle a done/not-done habit or log a value for a
quantity habit (e.g. 8 glasses of water). Streaks and 7-day completion
rates are shown per habit.

## Requirements

Feature checklist:

- [x] Categories (colored group headers, seeded: Health, Focus)
- [x] Habits: binary (done/not) and quantity (value vs target + unit)
- [x] 14-day grid; click toggles binary / opens value logger for quantity
- [x] Partial progress shown for quantity habits (value below target)
- [x] Streak per habit (missing today doesn't break it) and 7-day rate
- [x] New-habit dialog (type, target, unit, color palette, category)
- [x] Archive habits (hidden from grid; history kept)
- [x] Habit detail panel (streak/rate badges, 12-month heatmap, 60-day trend chart)
- [x] Edit habits (all fields), emoji icons, per-entry notes (tooltip on grid)
- [x] Category manager (add, rename, recolor, reorder, delete)
- [x] Reorder habits (↑ ↓ on hover), hard-delete a habit, archived-habits manager (restore/delete)
- [x] Inline 5-week mini heatmap on every habit row
- [x] Seeded starter habits so the grid is usable immediately
- [x] `habits.clear-entries` op to reset one habit's history

## Entities

| Collection | Purpose | Notes |
|------------|---------|-------|
| categories | Habit groups | name, color, order |
| habits     | Tracked habits | type binary/quantity, target, unit, color, category (rel), archived |
| entries    | One per habit per day | habit (rel), day (YYYY-MM-DD text), value, note; unique (habit, day) |

## Operations

Declared in `operations.json`; discoverable at `GET /api/_ops`.

- `habits.clear-entries` (destructive) — delete one habit's full history.

## Ownership map

- Editable: `frontend/src/app/`, `pb/pb_migrations/`, `pb/pb_hooks/ops.pb.js`,
  `operations.json` (non-system entries), this file.
- System-managed (never edit): `frontend/src/kit/`, `frontend/src/main.tsx`,
  `pb/pb_hooks/_system.pb.js`, `manifest.json`, build configs.
