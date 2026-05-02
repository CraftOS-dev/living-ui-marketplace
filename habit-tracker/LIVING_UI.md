# Habit Tracker

Compact, customizable habit tracker with streaks, GitHub-style heatmap, and per-habit analytics. Tracks binary, count, duration, and avoidance habits in a Notion-monochrome layout.

## Overview

Habit Tracker is a single-user, production-ready Living UI for building daily habits. It is opinionated: today-focused list at the front, side panel for full per-habit analytics, and a calendar heatmap for at-a-glance consistency. Designed for people who want a low-friction daily check-in plus rich retrospective insight without bloat.

The visual style is "Notion-monochrome": grayscale chrome, ultra-compact rows, borderless surfaces, with each habit's chosen color used as the only accent. Icons come from `lucide-react`.

## Requirements

### Entities & Data Model

- **Category** — optional grouping for habits (e.g., Health, Mindfulness, Work). Has name, color, order.
- **Habit** — the core entity. Fields:
  - `name`, `description` (optional), `type` (`binary` | `count` | `duration` | `negative`)
  - `target` (number, used by count/duration; e.g., 8 glasses, 30 minutes)
  - `unit` (string, used by count/duration; e.g., "glasses", "min", "reps")
  - `color` (hex string, drives the per-habit accent throughout the UI)
  - `icon` (lucide-react icon name string, e.g., `"Dumbbell"`, `"Book"`, `"Coffee"`)
  - `category_id` (FK, nullable)
  - `order` (int, supports drag-and-drop reorder)
  - `archived` (bool, soft archive — preserves history without showing in today list)
  - `created_at`, `updated_at`
- **HabitEntry** — one per (habit, date). Fields:
  - `habit_id`, `date` (YYYY-MM-DD)
  - `value` (float — for binary/negative: 1 if done; for count: count value; for duration: minutes)
  - `note` (optional text — quick reflection on the day)
  - `created_at`, `updated_at`
  - Unique constraint on `(habit_id, date)`.

Computed (not stored): current streak, best streak, completion percentage, daily score.

### Layout & Design

- **Layout style**: Compact list + heatmap. Today-focused.
  - Left: vertical list of today's habits. Each row shows icon, name, type-specific quick-action (checkbox / +1 / minute input / "stayed clean"), current streak badge, and a 30-day mini-heatmap.
  - Right: dashboard sidebar — today's completion ring (X/Y), weekly summary, total active streaks.
  - Top: app title, search, category filter, Add Habit button.
  - Click a habit row → right side panel opens with: full 365-day heatmap (clickable for backfill), 30-day trend chart, current/best streak, completion %, edit form, delete.
- **Visual style**: Notion-monochrome. Background uses design tokens (`--bg-primary`, `--bg-secondary`); borders are subtle/borderless on rows; per-habit color is the only chromatic element (icon tint, completed cells, streak badge). Lucide-react icons throughout. Follows system theme (light/dark).
- **Density**: Ultra-compact rows (~36 px tall). No card chrome on rows.

### Features

1. **Habits CRUD** — create/edit/archive/delete habits with name, type, target/unit, color, icon, category.
2. **Categories CRUD** — manage categories with name and color.
3. **Daily check-in** — type-aware: toggle for binary/negative, increment/decrement (or numeric input) for count, time input for duration.
4. **Backfill / past-day editing** — click any heatmap cell (mini or full) to edit that day's entry.
5. **Streaks** — current streak (consecutive completed days, ending today or yesterday) and best streak per habit, computed on the backend.
6. **Heatmaps** — 30-day inline mini-heatmap on each row, full 365-day GitHub-style grid in the side panel, color-graded by habit's color.
7. **Trend chart** — 30-day per-habit completion sparkline in the side panel.
8. **Dashboard summary** — today's completion ratio (e.g., 4/6 done), weekly completion %, total active streaks ≥ 7 days.
9. **Search & filter** — filter habits by name, category.
10. **Drag-and-drop reorder** — pointer-driven row reordering, persisted via `order` field.
11. **Keyboard shortcuts** — `1`–`9` toggle the Nth habit, `n` opens new-habit modal, `/` focuses search, `Esc` closes panels.
12. **Agent observability** — UI snapshot/screenshot/state/action endpoints from the template work out-of-the-box. Custom actions: `complete_habit`, `uncomplete_habit`, `set_habit_value` for agent-driven check-ins.

### Assumptions

- Single-user app; no auth module.
- Daily frequency only (per Phase 0 — no weekly/X-times-per-week scheduling). Skipping a day breaks the streak.
- No reminders/notifications (would require a server-side scheduler; out of scope for a Living UI).
- Theme follows system preference (light/dark via OS setting); no explicit toggle.
- Notes are stored on entries (per-day reflection) but the UI exposes them only inside the side panel detail view — they are optional and small.
- For negative habits, "completed" means "successfully avoided today"; the user marks themselves as having stayed clean.
- Time zone: dates use the server's local date for entries. Single-user assumption makes this acceptable.

## Data Model

### Backend Models (backend/models.py)

| Model | Purpose | Key Fields |
|-------|---------|------------|
| Category | Habit grouping | name, color, order |
| Habit | Core entity | name, type, target, unit, color, icon, category_id, order, archived |
| HabitEntry | One per (habit, date) | habit_id, date, value, note |

The template's `AppState`, `UISnapshot`, `UIScreenshot`, and `Item` models are kept for the standard agent endpoints.

## API Endpoints

### Custom Routes (backend/routes.py)

| Method | Path | Description |
|--------|------|-------------|
| GET | /categories | List categories |
| POST | /categories | Create category |
| PUT | /categories/{id} | Update category |
| DELETE | /categories/{id} | Delete category (un-categorizes habits) |
| GET | /habits | List habits with category, today's entry, current streak |
| POST | /habits | Create habit |
| GET | /habits/{id} | Get one habit + full stats |
| PUT | /habits/{id} | Update habit |
| DELETE | /habits/{id} | Delete habit (cascades entries) |
| POST | /habits/reorder | Persist drag-and-drop order |
| GET | /habits/{id}/entries | List all entries for a habit |
| GET | /habits/{id}/heatmap | 365-day heatmap data |
| GET | /habits/{id}/stats | Streak + completion + 30-day trend |
| PUT | /habits/{id}/entry | Upsert one entry by date (toggle / set value / set note) |
| DELETE | /habits/{id}/entry | Delete one entry by date |
| GET | /dashboard | Today summary: completion ratio, weekly %, active streaks |

## Frontend Components

### Components (frontend/components/)

| Component | Purpose |
|-----------|---------|
| MainView.tsx | Layout shell: top bar, today list, dashboard sidebar, side panel |
| TopBar.tsx | App title, search, category filter, add-habit button |
| HabitList.tsx | Today's habits as compact rows, with drag-and-drop |
| HabitRow.tsx | One habit row: icon, name, check action, streak badge, mini-heatmap |
| MiniHeatmap.tsx | 30-day inline grid |
| FullHeatmap.tsx | 365-day GitHub-style grid (clickable for backfill) |
| TrendChart.tsx | Inline 30-day completion sparkline |
| DashboardSidebar.tsx | Today completion ring, weekly summary, active streaks |
| HabitFormModal.tsx | Create/edit habit |
| HabitDetailPanel.tsx | Slide-in panel with full stats, heatmap, trend, edit/delete |
| CategoryManagerModal.tsx | Manage categories |
| IconPicker.tsx | Lucide icon picker (curated set) |
| ColorPicker.tsx | Habit color swatch picker |

## Key Files

| File | Purpose |
|------|---------|
| backend/models.py | Category, Habit, HabitEntry models |
| backend/routes.py | All habit/category/entry/dashboard endpoints |
| backend/services/streaks.py | Streak and stats computation |
| frontend/types.ts | TypeScript interfaces |
| frontend/AppController.ts | State management + API orchestration |
| frontend/components/MainView.tsx | Main UI |

## State Flow

```
User Action → React Component → AppController.method() → ApiService → /api/<route>
                                       ↓
                                 SQLite (Habit, HabitEntry)
                                       ↓
                          Recomputed stats + UI snapshot
                                       ↓
                            AppController updates state
                                       ↓
                                  Re-renders UI
```

## Testing

1. Create a binary habit (e.g., "Meditate"), pick a color and icon.
2. Tap the row to mark today done — toast shows, streak badge shows "1d", today cell in the mini-heatmap fills.
3. Reload the page — habit + completion persist.
4. Click the row → side panel opens with full heatmap. Click yesterday's cell → backfilled. Streak now reads "2d".
5. Add a count habit (target 8 "glasses"). Increment to 8 — shown as completed.
6. Drag a habit to reorder; reload — order persists.
7. Delete a habit; entries are removed.
8. Press `1` → toggles the first habit.
