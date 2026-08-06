# Kanban Board

A Trello-like Kanban board for organizing tasks with boards, lists, cards, labels, priorities, checklists, due dates, drag-and-drop, search/filter, and statistics. **This is the local single-user no-auth version** — no sign-up, no login, no per-user data scoping. All boards are visible to whoever opens the app on this machine.

For the multi-user online version with login/sign-up, see "Kanban Online".

## Overview

- **Platform**: Living UI V2 (PocketBase)
- **Port**: single port — PocketBase serves both the built frontend and the API
- **Theme**: System (dark/light), synced from the CraftBot shell via the kit's `ThemeBridge`
- **Auth**: None (`authMode: "none"`, `AUTH_MODE = 'none'` in `frontend/src/config.gen.ts`)

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

PocketBase collections, created by `pb/pb_migrations/1700000000_init_kanban.js`. Auth mode is `none`, so all rules are open (`''`) — the app binds loopback.

| Collection | Purpose | Fields |
|------------|---------|--------|
| `boards` | A named collection of lists | `name`, `created`, `updated` |
| `labels` | Colored tag, scoped to a board | `board` (relation → boards, cascade), `name`, `color` |
| `lists` | Vertical column on a board | `board` (relation → boards, cascade), `title`, `position`, `created`, `updated` |
| `cards` | Task/item within a list | `list` (relation → lists, cascade), `title`, `description`, `priority`, `due_date`, `position`, `archived`, `labels` (relation → labels, multi), `checklist` (json), `created`, `updated` |

Checklist items live in a `json` field on the card rather than in their own collection — there is no `checklist_items` collection to query.

`pb/pb_migrations/1700000001_seed_board.js` seeds a starter board so the app is not empty on first open.

## API

Everything is PocketBase's REST API — `GET/POST/PATCH/DELETE /api/collections/{collection}/records` — reached from the frontend through the kit's PocketBase client (`kit/pb/client.ts`, `useCollection` / `useRecord`).

Custom routes beyond CRUD live in `pb/pb_hooks/ops.pb.js` and **must** have a matching entry in `operations.json`:

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/ops/cards/clear-archived` | Delete all archived cards, returns `{ cleared: n }` |

System routes from `pb/pb_hooks/_system.pb.js`: `GET /api/health` (PocketBase built-in), `GET /api/_ops` (operations manifest), `POST /api/_console` (frontend console relay).

When adding a hook, read the request body with `e.requestInfo().body` — `e.request.body` is a Go stream and reads as empty.

## Frontend Components

Under `frontend/src/app/components/`:

| Component | Purpose |
|-----------|---------|
| MainView.tsx | Top-level layout, board state management |
| Header.tsx | Board selector dropdown, search bar, sidebar toggle |
| BoardView.tsx | Horizontal scrolling board with list columns |
| ListColumn.tsx | Single list column with cards |
| CardItem.tsx | Compact card with labels, priority, due date, checklist progress |
| CardDetailModal.tsx | Full card editor modal |
| Sidebar.tsx | Filters, label manager, statistics tabs (no Members tab) |

`frontend/src/app/App.tsx` renders MainView directly. `frontend/src/main.tsx` is a system file: it wraps the app in the kit `Shell`, and in `LoginGate` only when `AUTH_MODE === 'multi-user'` — which this app is not.

## Differences from Kanban Online

- `authMode: "none"` in manifest.json and `AUTH_MODE = 'none'` in `config.gen.ts`
- No owner relation on `boards`, and no per-user filtering in the collection rules
- `Header.tsx` does not render a user menu; `Sidebar.tsx` has no Members tab
- The kit's `LoginGate` is compiled in but never mounted

## State Flow

```
User action → component → PocketBase SDK (kit/pb) → PocketBase → SQLite
                              ↓
                     useCollection re-renders
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
