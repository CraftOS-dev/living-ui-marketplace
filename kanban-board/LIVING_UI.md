# Kanban Board

A Trello-like Kanban board for organizing tasks with boards, lists, cards, labels, priorities, checklists, due dates, drag-and-drop, search/filter, and statistics. **This is the local single-user no-auth version** — no sign-up, no login, no per-user data scoping. All boards are visible to whoever opens the app on this machine.

For the multi-user online version with login/sign-up, see "Kanban Online".

## Overview

- **Project ID**: 3d8a5c92
- **Frontend Port**: 3112
- **Backend Port**: 3113
- **Theme**: System (dark/light)
- **Auth**: None (local, single-user)

## Data Model

### Backend Models (backend/models.py)

| Model | Purpose | Key Fields |
|-------|---------|------------|
| Board | A named collection of lists | id, name, created_at, updated_at |
| BoardList | Vertical column on a board | id, board_id, title, position |
| Card | Task/item within a list | id, list_id, title, description, priority, due_date, position, archived |
| Label | Colored tag per board | id, board_id, name, color |
| card_labels | Many-to-many Card-Label | card_id, label_id |
| ChecklistItem | Subtask within a card | id, card_id, text, completed, position |

## API Endpoints

### Custom Routes (backend/routes.py)

| Method | Path | Description |
|--------|------|-------------|
| GET | /boards | List all boards |
| POST | /boards | Create board (auto-creates 3 default lists) |
| GET | /boards/{id} | Get board with lists, cards, labels |
| PUT | /boards/{id} | Rename board |
| DELETE | /boards/{id} | Delete board (cascades) |
| POST | /lists | Add list to board |
| PUT | /lists/{id} | Rename / reorder list |
| DELETE | /lists/{id} | Delete list (cascades) |
| POST | /cards | Create card in list |
| GET | /cards/{id} | Get card with labels + checklist |
| PUT | /cards/{id} | Update card fields |
| DELETE | /cards/{id} | Delete card |
| PUT | /cards/{id}/move | Move card to list at position |
| POST | /labels | Create label |
| PUT | /labels/{id} | Update label |
| DELETE | /labels/{id} | Delete label |
| PUT | /cards/{cid}/labels/{lid} | Assign label to card |
| DELETE | /cards/{cid}/labels/{lid} | Remove label from card |
| POST | /checklist | Add checklist item |
| PUT | /checklist/{id} | Update / reorder checklist item |
| DELETE | /checklist/{id} | Delete checklist item |
| POST | /search | Search/filter cards within a board |
| POST | /stats | Board statistics |

Plus framework routes: `/state` (GET/PUT/POST/DELETE), `/action`, `/ui-snapshot`, `/ui-screenshot`.

## Frontend Components

| Component | Purpose |
|-----------|---------|
| App.tsx | Root component — directly renders MainView (no AuthGate) |
| MainView.tsx | Top-level layout, board state management |
| Header.tsx | Board selector dropdown, search bar, sidebar toggle |
| BoardView.tsx | Horizontal scrolling board with list columns |
| ListColumn.tsx | Single list column with cards |
| CardItem.tsx | Compact card with labels, priority, due date, checklist progress |
| CardDetailModal.tsx | Full card editor modal |
| Sidebar.tsx | Filters, label manager, statistics tabs (no Members tab) |

## Key Files

| File | Purpose |
|------|---------|
| backend/models.py | 6 SQLAlchemy models for Kanban data |
| backend/routes.py | REST API endpoints |
| frontend/types.ts | TypeScript interfaces |
| frontend/AppController.ts | State management + API client (plain fetch, no auth) |
| frontend/components/MainView.tsx | Main UI orchestrator |

## Differences from Kanban Online

- No `auth_*.py` files (deleted: `auth_models.py`, `auth_service.py`, `auth_middleware.py`, `auth_routes.py`)
- No `frontend/auth_types.ts`, `frontend/services/AuthService.ts`, or `frontend/components/auth/` directory
- `Board` model has no `user_id` column
- Board endpoints have no `Depends(get_current_user)` and no membership filtering
- `App.tsx` does not wrap MainView in `AuthProvider` / `AuthGate`
- `Header.tsx` does not render `<UserMenu />`
- `Sidebar.tsx` has no Members tab
- `requirements.txt` does not include `bcrypt` or `PyJWT`

## State Flow

```
User Action -> Frontend Component -> AppController -> Backend API -> SQLite DB
                                        |
                                  Update UI State
```

## Testing

```bash
cd backend && python -m pytest tests/ -v --tb=short
```

The `auth_headers` fixture in `tests/conftest.py` is now a no-op returning `{}` so existing test signatures continue to work.
