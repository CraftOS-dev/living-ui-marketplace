# Kanban Online

A Trello-like Kanban board for organizing tasks with boards, lists, cards, labels, priorities, checklists, due dates, drag-and-drop, search/filter, and statistics. This is the multi-user online version with sign-up/login (auth integrated).

## Overview

- **Project ID**: a1b2c3d4
- **Frontend Port**: 3104
- **Backend Port**: 3105
- **Theme**: System (dark/light)

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
| POST | /boards | Create board (auto-creates 3 lists) |
| GET | /boards/{id} | Get board with lists, cards, labels |
| PUT | /boards/{id} | Rename board |
| DELETE | /boards/{id} | Delete board (cascades) |
| POST | /boards/{id}/lists | Add list to board |
| PUT | /lists/{id} | Rename list |
| DELETE | /lists/{id} | Delete list (cascades) |
| PUT | /lists/{id}/move | Reorder list |
| POST | /lists/{id}/cards | Create card in list |
| GET | /cards/{id} | Get card with labels + checklist |
| PUT | /cards/{id} | Update card fields |
| DELETE | /cards/{id} | Delete card |
| PUT | /cards/{id}/move | Move card to list at position |
| GET | /boards/{id}/labels | List labels |
| POST | /boards/{id}/labels | Create label |
| PUT | /labels/{id} | Update label |
| DELETE | /labels/{id} | Delete label |
| POST | /cards/{cid}/labels/{lid} | Assign label |
| DELETE | /cards/{cid}/labels/{lid} | Remove label |
| POST | /cards/{id}/checklist | Add checklist item |
| PUT | /checklist/{id} | Update checklist item |
| DELETE | /checklist/{id} | Delete checklist item |
| PUT | /checklist/{id}/move | Reorder checklist item |
| GET | /boards/{id}/search | Search/filter cards |
| GET | /boards/{id}/stats | Board statistics |

## Frontend Components

| Component | Purpose |
|-----------|---------|
| MainView.tsx | Top-level layout, board state management |
| Header.tsx | Board selector dropdown, search bar, sidebar toggle |
| BoardView.tsx | Horizontal scrolling board with list columns |
| ListColumn.tsx | Single list column with cards |
| CardItem.tsx | Compact card with labels, priority, due date, checklist |
| CardDetailModal.tsx | Full card editor modal |
| Sidebar.tsx | Filters, label manager, statistics tabs |

## Key Files

| File | Purpose |
|------|---------|
| backend/models.py | 6 SQLAlchemy models for Kanban data |
| backend/routes.py | 26 REST API endpoints |
| frontend/types.ts | TypeScript interfaces |
| frontend/AppController.ts | State management + API client |
| frontend/components/MainView.tsx | Main UI orchestrator |

## Features

1. Board Management - Create, rename, delete, switch between boards
2. List Management - Create, rename, delete, reorder lists within a board
3. Card CRUD - Create, edit, delete, archive cards with full detail modal
4. Drag & Drop - Move cards between lists via HTML5 drag-and-drop
5. Labels - Create colored labels, assign/remove from cards
6. Priorities - None/Low/Medium/High/Urgent with color-coded left border
7. Due Dates - Date picker with overdue (red) and upcoming (yellow) badges
8. Checklists - Subtasks with toggle, progress bar, completion tracking
9. Search & Filter - Text search, filter by priority/label/due status
10. Statistics - Card counts, priority breakdown, overdue count, checklist progress

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

36 tests covering boards, lists, cards, labels, checklists, search, and statistics.
