# Email Manager

Kanban-style Gmail inbox with customizable filter columns, unread counts, and AI-powered per-column summaries.

## Overview

Email Manager is a Kanban-style email dashboard that connects to Gmail via the CraftBot Google Workspace integration. It shows 5 columns side by side: 4 user-configurable Gmail-query columns and 1 locked general inbox feed. Each column fetches emails live from Gmail using its configured search query. A toggleable AI Insights card at the top of each column provides CraftBot-generated summaries. The app requires Gmail integration — if not connected, a gate screen explains how to set it up.

## Requirements

### Entities & Data Model

- **Columns**: 5 persistent column configurations (title, Gmail query, icon, AI instructions, AI toggle). Positions 0–3 are user-editable; position 4 (Everything) is locked.
- **Emails**: Fetched live from Gmail — not stored in SQLite.
- **AI Insights**: Generated on demand per column via the CraftBot LLM bridge — not persisted.

### Layout & Design

- 5-column horizontal Kanban board, horizontally scrollable on desktop.
- Mobile: columns stack vertically, each with `max-height: 50vh` and their own scroll.
- Dark theme following system preference, brand colors: primary `#4a2317`, secondary `#b44646`, accent `#29909e`.
- Unread count badge on each column header.
- Sparkles icon toggles AI Insights per column; Settings gear opens the column config modal.

### Features

- Gmail integration gate: shows instructions instead of the board if Gmail is not connected.
- 5 seeded default columns (GitHub, Social, Updates, Finance, Everything).
- Column settings modal: edit title, Gmail query, icon (emoji picker), AI instructions, and toggle AI.
- Empty state per column when no emails match the query.
- Refresh button to manually re-fetch all columns.
- AI Insights (Part 3): per-column CraftBot LLM summary with bullet points and loading state.
- Gmail email fetching (Part 2): live Gmail API calls via the CraftBot integration bridge.

### Assumptions

- Users have CraftBot's Google Workspace integration connected (Gmail OAuth).
- Columns are always exactly 5; users reconfigure them but cannot add or delete.
- The general "Everything" column (`in:inbox`) is not user-configurable.
- Emails are not stored locally — always fetched live.
- AI Insights are generated on demand, not cached between page loads.
- Default column set covers the most common categorization use case.

## Data Model

### Backend Models (backend/models.py)

| Model | Purpose | Key Fields |
|-------|---------|------------|
| AppState | Generic JSON state storage | id, data (JSON) |
| UISnapshot | UI state for agent observation | id, html_structure, visible_text, component_state |
| UIScreenshot | Screenshot for agent visual observation | id, image_data (base64 PNG) |
| ColumnConfig | Email column configuration | id, title, query, icon, ai_instructions, ai_enabled, position, is_general, unread_count |

## API Endpoints

### Custom Routes (backend/routes.py)

| Method | Path | Description |
|--------|------|-------------|
| GET | /columns | List all 5 column configs ordered by position |
| PUT | /columns/{id} | Update a column's title, query, icon, AI instructions, or AI toggle |
| GET | /gmail/status | Check if google_workspace integration is connected |
| GET | /emails/{column_id} | Fetch emails for a column via Gmail API |
| POST | /columns/{column_id}/insights | Generate AI summary for a column |
| GET | /state | Generic state read (template) |
| PUT | /state | Generic state write (template) |
| POST | /action | Agent action trigger (template) |
| GET | /ui-snapshot | Agent UI observation (template) |
| GET | /ui-screenshot | Agent visual observation (template) |

## Frontend Components

### Components (frontend/components/)

| Component | Purpose |
|-----------|---------|
| MainView.tsx | State subscriber; renders GmailGate or ColumnBoard based on connection status |
| GmailGate.tsx | "Gmail Integration Required" screen with step-by-step setup instructions |
| ColumnBoard.tsx | Top bar + 5-column horizontal Kanban layout; coordinates data flow |
| EmailColumn.tsx | Single column: header (icon, title, unread badge, AI toggle, settings), insight card, email list |
| EmailCard.tsx | Single email card: sender avatar initial, subject, snippet, formatted timestamp |
| InsightCard.tsx | AI summary card with bullet points and loading state |
| ColumnSettingsModal.tsx | Modal to edit column title, Gmail query, icon, AI instructions, AI toggle |

## Key Files

| File | Purpose |
|------|---------|
| backend/models.py | ColumnConfig model + seed_default_columns() |
| backend/routes.py | All API endpoints |
| backend/tests/test_columns.py | 16 backend tests for column CRUD and stubs |
| frontend/types.ts | Column, Email, InsightSummary, AppState interfaces |
| frontend/AppController.ts | Gmail status check, column load/update, email fetch, insight generation |
| frontend/components/MainView.tsx | Root view with gate/board routing and state subscription |
| frontend/components/ColumnBoard.tsx | Board layout and top bar |
| frontend/components/EmailColumn.tsx | Per-column component |
| frontend/styles/global.css | Brand color overrides (primary/secondary/accent) |

## State Flow

```
User opens app
  → MainView mounts, subscribes to AppController
  → AppController.initialize()
      → checkGmailStatus() → GET /api/gmail/status
        → connected? → loadColumns() → GET /api/columns
          → ColumnBoard renders, fetchEmails(per column)
        → not connected? → GmailGate renders

User edits column settings
  → ColumnSettingsModal.onSave()
  → AppController.updateColumn() → PUT /api/columns/{id}
  → column list patched locally → EmailColumn re-renders

User toggles AI Insights
  → AppController.updateColumn({ aiEnabled: true })
  → AppController.generateInsights(columnId) → POST /api/columns/{id}/insights
  → InsightCard renders summary
```

## Testing

1. Run backend tests: `cd backend && python -m pytest tests/ -v`
2. Run `python setup_local.py` then `npm install && npm run build` to verify the frontend build.
3. Start backend: `cd backend && python -m uvicorn main:app --port 3200`
4. Open browser at `http://localhost:3200` — shows the Gmail gate (no integration in local dev).
5. After Part 2 (Gmail integration): verify emails load per column query.
6. After Part 3 (AI Insights): verify summaries generate and toggle correctly.
