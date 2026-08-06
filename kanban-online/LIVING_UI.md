# Kanban Online

A Trello-like Kanban board for organizing tasks with boards, lists, cards, labels, priorities, checklists, due dates, drag-and-drop, search/filter, and statistics. This is the multi-user online version with sign-up/login.

For the local single-user version with no auth, see "Kanban Board".

## Overview

- **Platform**: Living UI V2 (PocketBase)
- **Port**: single port — PocketBase serves both the built frontend and the API
- **Theme**: System (dark/light), synced from the CraftBot shell via the kit's `ThemeBridge`
- **Auth**: Multi-user (`authMode: "multi-user"`, `AUTH_MODE = 'multi-user'` in `frontend/src/config.gen.ts`)

## Layout

```
manifest.json          livingUIVersion 2, pbVersion, and the install/build/start pipeline
operations.json        agent-discoverable verbs (served at GET /api/_ops)
pb/pb_migrations/      collection schema, seed data, and user visibility rules
pb/pb_hooks/           custom API routes; _system.pb.js and _craftbot_bridge.js are system files
pb/pb_public/          Vite build output — generated, never edited by hand
frontend/src/kit/      vendored Living UI kit (system-managed, never edited by agents)
frontend/src/app/      the app itself — this is what you change
```

## Auth

PocketBase's built-in `users` auth collection backs sign-up and login. The kit's `LoginGate` (mounted from `frontend/src/main.tsx` because `AUTH_MODE === 'multi-user'`) blocks the app until a session exists, and `kit/pb/auth.ts` exposes `useAuth`.

This is a **shared workspace**, not per-user data: every collection rule is `@request.auth.id != ""`, so any signed-in user sees and edits every board. `pb/pb_migrations/1700000002_users_visibility.js` widens the `users` collection's list/view rules to signed-in users so the member list can show teammates' names; its down-migration restores PocketBase's default `id = @request.auth.id`. Registration is open self-sign-up.

If you need per-user boards, that is a schema change: add an owner relation to `boards` and tighten the rules to match it.

## Data Model

PocketBase collections, created by `pb/pb_migrations/1700000000_init_kanban.js`.

| Collection | Purpose | Fields |
|------------|---------|--------|
| `users` | PocketBase auth collection (built-in) | email, password, name, avatar |
| `boards` | A named collection of lists | `name`, `created`, `updated` |
| `labels` | Colored tag, scoped to a board | `board` (relation → boards, cascade), `name`, `color` |
| `lists` | Vertical column on a board | `board` (relation → boards, cascade), `title`, `position`, `created`, `updated` |
| `cards` | Task/item within a list | `list` (relation → lists, cascade), `title`, `description`, `priority`, `due_date`, `position`, `archived`, `labels` (relation → labels, multi), `checklist` (json), `created`, `updated` |

Checklist items live in a `json` field on the card rather than in their own collection.

`pb/pb_migrations/1700000001_seed_board.js` seeds a starter board so the app is not empty on first open.

## API

Everything is PocketBase's REST API — `GET/POST/PATCH/DELETE /api/collections/{collection}/records`, plus the `users` auth endpoints for login and sign-up — reached through the kit's PocketBase client (`kit/pb/client.ts`, `useCollection` / `useRecord`).

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
| Header.tsx | Board selector dropdown, search bar, sidebar toggle, user menu |
| BoardView.tsx | Horizontal scrolling board with list columns |
| ListColumn.tsx | Single list column with cards |
| CardItem.tsx | Compact card with labels, priority, due date, checklist progress |
| CardDetailModal.tsx | Full card editor modal |
| Sidebar.tsx | Filters, label manager, statistics, and Members tabs |
| auth/AuthProvider.tsx | Session context over the kit's `useAuth` |
| auth/AuthLayout.tsx | Shared chrome for the login/register pages |
| auth/LoginPage.tsx, auth/RegisterPage.tsx | Sign-in and self sign-up forms |
| auth/UserMenu.tsx, auth/ProfilePage.tsx | Current-user menu and profile editing |
| auth/MemberList.tsx, auth/InviteModal.tsx | Workspace members and invitations |

## State Flow

```
User action → component → PocketBase SDK (kit/pb) → PocketBase → SQLite
                              ↓
                     useCollection re-renders
```

## Differences from Kanban Board

- `authMode: "multi-user"`; the kit's `LoginGate` actually mounts
- Collection rules require a session (`@request.auth.id != ""`) instead of being open
- `frontend/src/app/components/auth/` and the Members tab exist only here
- The extra `1700000002_users_visibility.js` migration

## Local Development

```bash
npm install --prefix frontend
npm run build --prefix frontend      # emits into pb/pb_public
pocketbase serve --http=127.0.0.1:8090 \
  --dir pb/pb_data --hooksDir pb/pb_hooks \
  --migrationsDir pb/pb_migrations --publicDir pb/pb_public
```

`npm run typecheck --prefix frontend` runs `tsc` alone; the build runs it first and fails on any type error.
