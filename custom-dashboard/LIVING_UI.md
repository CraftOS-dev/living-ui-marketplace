# {{PROJECT_NAME}}

{{PROJECT_DESCRIPTION}}

## Overview

Personal Dashboard is a Living UI that acts as a customizable homepage. It displays up to 7 widgets in a responsive drag-and-drop grid. Users can enable/disable widgets via the Widget Store, reorder them by dragging, and click any widget card to open its dedicated full-page view for detailed management.

Built for anyone who wants a single place to track the time, weather, upcoming events, tasks, notes, reminders, and an AI-generated daily briefing.

## Requirements

### Entities & Data Model

- **WidgetConfig** — per-widget on/off toggle, position, and arbitrary settings JSON (e.g. clock format)
- **WeatherCache** — singleton row; city name + lat/lon + current conditions + 3-day forecast; refreshed when >30 min stale
- **CalendarEvent** — user-created events with date, optional start/end time, description, and color
- **Task** — to-do items with title, priority (none/low/medium/high), position, and completed flag
- **Note** — titled free-text notes with optional pin; sorted pinned-first then by updated_at
- **Reminder** — title + optional due date/time + completed flag; filterable to upcoming only
- **DailyBriefing** — singleton row; LLM-generated summary of the user's data; falls back to template if LLM unavailable

### Layout & Design

- Auto-responsive CSS Grid: `repeat(auto-fill, minmax(320px, 1fr))` — 3 columns on wide screens, 2 on medium, 1 on mobile
- Colors: Primary `#FF4F18`, Secondary `#262626`, Accent `#E64515` (from global.css)
- Widget cards: modern with soft shadow (`var(--shadow-md)`) via WidgetCard wrapper
- Full-page views: dedicated state-based nav (no browser routing; view state in MainView)

### Features

- Drag-and-drop grid reordering (`@dnd-kit/core` + `@dnd-kit/sortable`)
- Widget Store tab to toggle any of the 7 widgets on/off; positions persisted to backend
- Clock: live time with seconds; 12h/24h toggle persisted per-widget
- Weather: Open-Meteo API (no key), single request per refresh, 30-min SQLite cache; city set by user
- Calendar: full month-grid view; click a day to see/add/delete events; color-coded dots on grid
- To-Do: full list with drag-to-reorder, priority badges, one-click complete, separate pending/completed sections
- Notes: sidebar list + editor pane; 500 ms auto-save debounce; pin/unpin; delete with instant feedback
- Reminders: pending/done filter; time-remaining pill (overdue shown in red); add via modal
- Daily Briefing: CraftBot LLM bridge (`integration_client.py`); fallback template aggregation if unavailable

### Assumptions

- Weather location starts empty; user sets their city in the Weather widget's full-page view
- Clock defaults to 12-hour format
- All 7 widgets are enabled by default
- Reminders are time-based only (no push notifications in V1)
- The briefing LLM prompt aggregates tasks, reminders, weather, and next calendar event

## Data Model

### Backend Models (backend/models.py)

| Model | Purpose | Key Fields |
|-------|---------|------------|
| WidgetConfig | Widget on/off + order + settings | widget_id (unique), enabled, position, widget_settings (JSON) |
| WeatherCache | Singleton weather cache (id=1) | city_name, latitude, longitude, current_temp, weather_code, apparent_temp, temp_high, temp_low, forecast (JSON), fetched_at |
| CalendarEvent | User calendar events | title, event_date (YYYY-MM-DD), start_time, end_time, description, color |
| Task | To-do items | title, completed, priority (none/low/medium/high), position |
| Note | Free-text notes | title, content (Text), pinned, updated_at |
| Reminder | Time-based reminders | title, due_date (YYYY-MM-DD), due_time (HH:MM), completed |
| DailyBriefing | Singleton AI briefing (id=1) | content (Text), generated_at |

## API Endpoints

### Custom Routes (backend/routes.py)

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/widget-configs | Get all 7 widget configs (creates defaults if absent) |
| PUT | /api/widget-configs/{widget_id} | Update enabled, position, or widget_settings |
| GET | /api/weather | Get cached weather (auto-refreshes if >30 min stale) |
| PUT | /api/weather/city | Set city → geocode → fetch Open-Meteo weather |
| GET | /api/calendar-events | List events; optional `?month=YYYY-MM` filter |
| POST | /api/calendar-events | Create event |
| GET | /api/calendar-events/{id} | Get single event |
| PUT | /api/calendar-events/{id} | Update event |
| DELETE | /api/calendar-events/{id} | Delete event (idempotent, returns 200) |
| GET | /api/tasks | List all tasks |
| POST | /api/tasks | Create task |
| PUT | /api/tasks/{id} | Update task (title, completed, priority, position) |
| DELETE | /api/tasks/{id} | Delete task (idempotent, returns 200) |
| GET | /api/notes | List notes (pinned first) |
| POST | /api/notes | Create note |
| GET | /api/notes/{id} | Get single note |
| PUT | /api/notes/{id} | Update note |
| DELETE | /api/notes/{id} | Delete note (idempotent, returns 200) |
| GET | /api/reminders | List reminders; optional `?upcoming=true` filter |
| POST | /api/reminders | Create reminder |
| PUT | /api/reminders/{id} | Update reminder |
| DELETE | /api/reminders/{id} | Delete reminder (idempotent, returns 200) |
| GET | /api/briefing | Get last briefing |
| POST | /api/briefing/generate | Generate new briefing via LLM (or fallback) |

## Frontend Components

### Components (frontend/components/)

| Component | Purpose |
|-----------|---------|
| MainView.tsx | State-based router + top nav bar (Dashboard / Widget Store / Back) |
| DashboardHome.tsx | dnd-kit sortable grid of enabled widget cards |
| WidgetCard.tsx | Card wrapper with drag handle and expand button |
| WidgetStoreView.tsx | 7-widget toggle grid for enabling/disabling widgets |
| ClockWidget.tsx | Compact: live time + date, ticks every second |
| ClockFull.tsx | Full page: large clock, format toggle persisted to backend |
| WeatherWidget.tsx | Compact: current temp + condition emoji + high/low |
| WeatherFull.tsx | Full page: 3-day forecast cards + city input |
| CalendarWidget.tsx | Compact: next 3 upcoming events with color border |
| CalendarFull.tsx | Full page: month grid + day event list + add/delete modal |
| TodoWidget.tsx | Compact: top 5 pending tasks with priority badges |
| TodoFull.tsx | Full page: sortable task list (dnd-kit), add/complete/delete |
| NotesWidget.tsx | Compact: most recent/pinned note title + 120-char preview |
| NotesFull.tsx | Full page: sidebar list + editor pane with 500 ms auto-save |
| RemindersWidget.tsx | Compact: next 3 reminders with time-remaining label |
| RemindersFull.tsx | Full page: pending/done toggle, time-remaining badge, add/complete/delete |
| BriefingWidget.tsx | Compact: 150-char preview + regenerate button |
| BriefingFull.tsx | Full page: full briefing text + generate button + timestamp |

## Key Files

| File | Purpose |
|------|---------|
| backend/models.py | SQLAlchemy models for all 7 widget data types + framework models |
| backend/routes.py | All API endpoints (28 custom + framework routes) |
| backend/tests/ | 7 test files, 48 tests covering all CRUD routes |
| frontend/types.ts | TypeScript interfaces for all models and API responses |
| frontend/AppController.ts | API client with all method groups (weather, calendar, tasks, notes, reminders, briefing) |
| frontend/components/MainView.tsx | State-based router with top nav |
| frontend/components/DashboardHome.tsx | dnd-kit drag-and-drop widget grid |
| package.json | @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities added |

## State Flow

```
User Action → Frontend Component → AppController.method() → fetch /api/...
                                                                    ↓
                                                            FastAPI route handler
                                                                    ↓
                                                            SQLite via SQLAlchemy
                                                                    ↓
                                                         JSON response → setState
```

Weather data additionally calls Open-Meteo geocoding + forecast APIs (external, no key required).
Daily Briefing calls CraftBot's `integration.request()` with fallback to local template aggregation.

## Testing

1. Run `python setup_local.py` to replace template placeholders
2. `cd backend && pip install -r requirements.txt`
3. `python -m pytest tests/ -v` — all 48 tests should pass
4. `cd .. && npm install && npm run build` — TypeScript must compile cleanly
5. Start backend: `uvicorn main:app --port 3200`
6. Open `http://localhost:3200` in browser
7. Verify: drag widgets to reorder, toggle in Widget Store, set weather city, add a calendar event, create tasks/notes/reminders, generate daily briefing
