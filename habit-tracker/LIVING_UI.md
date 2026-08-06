# Habit Tracker

Compact, customizable habit tracker with streaks, a GitHub-style heatmap, and per-habit analytics, in a Notion-monochrome layout.

## Overview

Habit Tracker is a single-user Living UI for building daily habits. It is opinionated: a today-focused list at the front, a side panel for full per-habit analytics, and a calendar heatmap for at-a-glance consistency. Designed for a low-friction daily check-in plus retrospective insight without bloat.

The visual style is "Notion-monochrome": grayscale chrome, ultra-compact rows, borderless surfaces, with each habit's chosen color as the only accent. Icons come from `lucide-react`.

- **Platform**: Living UI V2 (PocketBase)
- **Port**: single port — PocketBase serves both the built frontend and the API
- **Theme**: System (dark/light), synced from the CraftBot shell via the kit's `ThemeBridge`
- **Auth**: None (`authMode: "none"`, `AUTH_MODE = 'none'` in `frontend/src/config.gen.ts`) — collection rules are open (`''`) and the app binds loopback

## Layout

```
manifest.json          livingUIVersion 2, pbVersion, and the install/build/start pipeline
operations.json        agent-discoverable verbs (served at GET /api/_ops)
pb/pb_migrations/      collection schema + seed data (JS migrations)
pb/pb_hooks/           custom API routes; _system.pb.js and _craftbot_bridge.js are system files
pb/pb_public/          Vite build output — generated, never edited by hand
frontend/src/kit/      vendored Living UI kit (system-managed, never edited by agents)
frontend/src/app/      the app itself — this is what you change
```

## Data Model

PocketBase collections, created by `pb/pb_migrations/1700000000_init_habits.js`:

| Collection | Purpose | Fields |
|---|---|---|
| `categories` | Grouping for habits | `name`, `color`, `order`, `created`, `updated` |
| `habits` | One tracked habit | `name`, `description`, `type` (`binary`\|`quantity`), `target`, `unit`, `color`, `icon`, `order`, `archived`, `category` (relation → categories), `created`, `updated` |
| `entries` | One day's record for a habit | `habit` (relation → habits, cascade), `day` (text, `YYYY-MM-DD`), `value`, `note`, `created`, `updated` |

Two habit types exist in the schema: `binary` (did it / didn't) and `quantity` (a number against `target`, labelled with `unit`). Durations are modelled as a `quantity` habit whose `unit` is minutes; there is no separate duration or avoidance type.

`day` is a text field, not a date — entries are keyed by calendar day (`YYYY-MM-DD`) so a check-in is timezone-stable. Streaks and heatmap cells are computed on the frontend from the `entries` for a habit.

`pb/pb_migrations/1700000001_seed_habits.js` seeds starter habits so the app is not empty on first open.

## API

CRUD is PocketBase's REST API — `GET/POST/PATCH/DELETE /api/collections/{collection}/records` — used from the frontend through the kit's PocketBase client (`kit/pb/client.ts`, `useCollection` / `useRecord`).

Custom routes beyond CRUD live in `pb/pb_hooks/ops.pb.js` and **must** have a matching entry in `operations.json`:

| Method | Path | Params | Description |
|---|---|---|---|
| POST | `/api/ops/habits/clear-entries` | `habit_id` (required) | Delete a habit's entire entry history, returns how many were removed |

System routes from `pb/pb_hooks/_system.pb.js`: `GET /api/health` (PocketBase built-in), `GET /api/_ops` (operations manifest), `POST /api/_console` (frontend console relay).

Two hook gotchas worth keeping in mind when editing:

- `routerAdd` handlers run in **isolated** contexts, so shared helpers must be `require`d inside each handler.
- Read a request body with `e.requestInfo().body`; `e.request.body` is a Go stream and reads as empty.

## Frontend Components

Under `frontend/src/app/components/`:

| Component | Purpose |
|---|---|
| MainView.tsx | Top-level layout, list + detail panel orchestration |
| TopBar.tsx | Date context, add-habit entry point |
| DashboardSidebar.tsx | Category and filter navigation |
| HabitList.tsx | Today-focused list of habits |
| HabitRow.tsx | One compact habit row with its check-in control |
| HabitDetailPanel.tsx | Per-habit analytics side panel |
| HabitFormModal.tsx | Create/edit a habit |
| CategoryManagerModal.tsx | Manage categories |
| MiniHeatmap.tsx | Inline consistency strip per habit |
| FullHeatmap.tsx | GitHub-style calendar heatmap |
| TrendChart.tsx | Value/completion trend over time |
| ResizablePanel.tsx | Draggable split between list and detail |
| ui/ | App-local presentational components |

## State Flow

```
User action → component → PocketBase SDK (kit/pb) → PocketBase → SQLite
                              ↓
                     useCollection re-renders; streaks/heatmap recomputed client-side
```

## Local Development

```bash
npm install --prefix frontend
npm run build --prefix frontend      # emits into pb/pb_public
pocketbase serve --http=127.0.0.1:8090 \
  --dir pb/pb_data --hooksDir pb/pb_hooks \
  --migrationsDir pb/pb_migrations --publicDir pb/pb_public
```

`npm run typecheck --prefix frontend` runs `tsc` alone; the build runs it first and fails on any type error.
