# Requirements: Habit Tracker

PART A — REQUIREMENTS (SRS). User-approved before build; frozen after; changes via ## Changes.

## Introduction

### Purpose
Habit Tracker is a compact habit tracker for one person who builds daily habits, used in the browser with no accounts or sign-in. Its one job is a low-friction daily check-in with insight looking back, without bloat.
- **Front:** a today-focused list where each habit is checked off, counted up or timed in one press, with its streak and a 30-day strip beside it.
- **Dashboard:** a side panel shows today's progress and this week's rate.
- **Detail:** any habit opens into its streaks, its 30-day rate, a 365-day heatmap, a 30-day trend and an editor for any day's value and note.

An AI agent works on the same data through A2App: every action a person can take, and every number the screen shows, is a declared operation.

### Scope
**Goals**
1. A habit can be checked in for today from its row with one press (binary and avoid habits), or with + and − (count habits), and the row's streak updates at once.
2. Every number on screen comes from the stored entries by one fixed rule set: done or partial, current and best streak, 30-day rate, weekly rate, and active streaks of 7 days or more.
3. Any day of the last 365 days can be corrected or annotated from the habit's heatmap, and one habit has at most one entry per day.
4. Every person action and every number the screen shows is available to an agent as an operation, and the agent's writes produce the same records as the person's.

**Core functionalities:** today's habit list with one-press check-in · binary, count, duration and avoid habits · streaks and rates · dashboard of today and this week · per-habit 365-day heatmap and 30-day trend · day editor with notes · categories with filter chips · search · drag-and-drop ordering · archive and delete · keyboard shortcuts · agent operations

### Approval
Approved by the user: 2026-11-11 — carried over from the published marketplace app `habit-tracker` 1.0.0, whose requirements were approved when it was built; this document restates them in the framework's form without changing any feature.

## Product Description

### Product Perspective
- **Access:** `authMode: none`. One person uses the app on their own machine with no sign-in. It serves on loopback only, and the collection rules are open (`''`).
- **Integrations:** `manifest.json` declares none (`capabilities.integrations: []`). The app calls no outside service. The CraftBot bridge module (`_craftbot_bridge.js`) is shipped with the kit but nothing in the app calls it.
- **How the View is built:** it is the original V1 frontend, unchanged. It talks to PocketBase through a client-side shim (`frontend/src/app/services/apiAdapter.ts`). The shim answers the frontend's REST calls from PocketBase records, and computes streaks, rates, heatmap cells and the dashboard in the browser.
- **The agent's side:** the operations in `pb/pb_hooks/agent_ops.pb.js` and `lib_agent.js` port those same functions to the server for agents.
- **What it deliberately is not:** it has no reminders, no schedules other than daily, no AI features of its own, and no sync with other devices or calendars.

### User Characteristics
One person checking in on their habits once or a few times a day, and reviewing a habit's history now and then. On a desktop they use the side panel, drag-and-drop ordering and keyboard shortcuts. On a phone they check in from compact rows with larger tap targets and open a habit's detail full screen. Widths from phones (the mobile layout up to 767 px) to wide desktops are in scope.

### Constraints
- C-1: A day is a calendar day written `YYYY-MM-DD` and stored as text, never as an instant. "Today" is the local date: the browser's on screen, and the local date of the machine running the app for operations. Day arithmetic uses calendar-day ordinals, so a daylight-saving change never shifts a day.
- C-2: A habit has at most one entry per day (unique index on `habit, day`).
- C-3: The form offers four habit types: Binary (done / not done), Count (increment to a target), Duration (minutes per day) and Avoid (habit to break, `negative`). `type` keeps the completion rule: count and duration are stored as `quantity`, binary and avoid as `binary`. `kind` keeps the exact choice, so every type shows as chosen after a reload. A habit saved without a `kind` shows as count (quantity) or binary.
- C-4: When a day counts as done:
  - a binary or avoid day when its value is above 0;
  - a quantity day when its value reaches the target (above 0 when there is no target);
  - a quantity day between 0 and the target is "partial".
- C-5: Values:
  - The app writes 0 or 1 for binary and avoid habits.
  - A quantity value is 0 or more, and decimals are accepted.
  - Count and duration habits need a positive per-day target. An empty unit becomes `reps` (count) or `min` (duration).
  - Binary and avoid habits are stored with target 0 and no unit.
- C-6: Streaks and rates:
  - **Current streak:** consecutive done days ending today, or ending yesterday while today is not done.
  - **Best streak:** the longest run of consecutive done days.
  - **30-day rate:** done days in the last 30 days (today included) ÷ 30.
  - **Weekly rate:** done habit-days in the last 7 days ÷ (7 × active habits).
  - **Active streak:** a current streak of 7 days or more.
  - Rates are rounded to four decimals, and shown as whole percentages.
- C-7: Colours and icons:
  - Habits and categories take colours from a palette of 18.
  - Icons come from a set of 89 lucide names. The `icon` field holds up to 40 characters, so every one can be stored.
- C-8: Field limits:
  - habit name: 200 characters;
  - category name: 120 characters;
  - description and note: 2,000 characters;
  - unit: 40 characters;
  - colour: 20 characters.
- C-9: A person can edit today from the list, and any of the last 365 days (today included) from the heatmap. No future day can be logged.
- C-10: An archived habit is left out of the list and the dashboard, and its entries are kept. Deleting a habit deletes its entries. Deleting a category leaves its habits uncategorized.
- C-11: The first start seeds two categories (Health, Focus) and five habits. Exercise, Sleep 8h and Read are binary. Drink water (target 8 glasses) and Deep work (target 4 hours) are quantity. The seeded icons are emoji, which the app draws as a plain circle. No entries are seeded.

### Assumptions
- A-1: Volume ceiling: about 20 active habits with two years of daily entries (around 15,000 entry rows). Every refresh of the list and the dashboard reads every entry, at 500 per request in the View.
- A-2: The machine running the app is the person's own, so its local date is the person's date.
- A-3: Changes made outside the open page, by an agent or another tab, are seen after the person reloads the page.

## Features

### Module: Frame
- F-FRM-1: The user sees one page: a top bar, the habit list, and (from 768 px) a right-hand panel that shows the dashboard, or the selected habit's detail.
- F-FRM-2: The user sees a top bar with the title "Habit Tracker" and today's date (desktop), a search box ("Search habits…  (press / )"), category filter chips ("All" plus one per category), a "Categories" button and an "Add habit" button.
- F-FRM-3: The user can resize the right panel by dragging its left edge (460–900 px), and reset it with a double-click. The width is remembered in the browser.
- F-FRM-4: The user can use keyboard shortcuts:
  - `/` focuses the search;
  - `n` opens the new-habit form;
  - `1`–`9` open the Nth visible habit's detail;
  - Escape closes the open form, the category manager or the detail panel.
  
  Shortcuts other than Escape do nothing while typing in a field or while a form is open.
- F-FRM-5: On phones (up to 767 px) the top bar wraps into rows: title and buttons, then search, then a scrolling row of chips. A selected habit's detail covers the whole screen.
- F-FRM-6: WHEN the host changes the theme (pack, light or dark) THE SYSTEM SHALL recolour the app from the kit's theme tokens. Each habit's own colour accents its icon, row tint, streak badge, controls and charts.
- F-FRM-7: WHEN the app starts THE SYSTEM SHALL show "Loading habits…" until the first load completes. IF PocketBase does not answer at start THE SYSTEM SHALL show the alert "Backend unavailable. Start the backend server." under the top bar, and IF the list, categories or dashboard cannot be read THE SYSTEM SHALL show "Failed to load data from backend".
- F-FRM-8: The user sees each save, delete and failure confirmed by a toast in the top-right corner.

### Module: Habit list (habits, entries)
- F-LST-1: The user sees the active habits in their saved order (position, then creation time). Each row shows the habit's icon on a tint of its colour, its name, and a meta line. The meta line reads "value/target unit" for count and duration habits with a target. Otherwise it shows the category name, or "binary" / "avoid".
- F-LST-2: The user sees each habit's current streak as a flame badge "<n>d", tinted in the habit's colour when above 0.
- F-LST-3: The user sees a strip of the last 30 days on each row, today at the right. Done and partial days fill in the habit's colour by intensity, and each day has a tooltip with its date and value. The strip updates after each check-in or edit and when the date changes. It is hidden on phones and below 720 px.
- F-LST-4: The user can mark a binary or avoid habit done for today with its check button, and press it again to undo. An avoid habit shows a ban icon until it is done.
- F-LST-5: The user can press + or − on a count habit to change today's count by one. − is disabled at 0, and + fills with the habit's colour once the target is reached.
- F-LST-6: The user can press a duration habit's "<target> <unit>" button to record its target for today, and press it again to reset today to 0.
- F-LST-7: The user can search habits by name (case-insensitive) and narrow the list to one category with a chip; the active chip clears it. "Showing X of Y habits" appears under a filtered list.
- F-LST-8: The user can reorder habits on desktop by dragging a row onto another. The row drops in before the target, a line in the habit's colour marks the spot, and the new order is saved.
- F-LST-9: The user can open a habit's detail by clicking its row or pressing Enter on it, and close it by clicking the row again.
- F-LST-10: WHEN no habit is visible THE SYSTEM SHALL show "No habits yet" with "Add your first habit and check in today." and a "New habit" button.

### Module: Dashboard (app)
- F-DSH-1: The user sees "Today" when no habit is selected: habits done today out of all active habits ("done today"), with a progress ring and its percentage.
- F-DSH-2: The user sees "This week": the completion percentage over the last 7 days, and the number of active streaks of 7 days or more.
- F-DSH-3: The user sees "Top streak": the habit with the longest current streak and "<n> days in a row". It shows only when some streak is above 0, and the first such habit in list order wins.
- F-DSH-4: The user sees "Tips" with the keyboard shortcuts. With no habits, it also shows "Add your first habit to see stats."
- F-DSH-5: On phones the user sees the same numbers as a strip above the list: today "x / y", week %, streaks ≥7d, and a progress bar.

### Module: Habit detail (habits, entries)
- F-DET-1: The user sees the habit's header: its icon, name, type, target and unit, and category, with Edit and Close.
- F-DET-2: The user sees four tiles: Current streak, Best streak, 30-day rate and Total completions.
- F-DET-3: The user sees "Last 365 days", a heatmap of weeks from Monday to Sunday. It has month labels, weekday labels when there is room, a Less–More legend, and a tooltip per day with the date and "completed", the value, or "—".
- F-DET-4: The user can click any day of the heatmap to edit it. The editor opens on today, marked "Today".
- F-DET-5: The user can mark the chosen day done or not done on a binary or avoid habit.
- F-DET-6: The user can type the chosen day's value on a count or duration habit. It saves when the field loses focus or on Enter, and a negative value reverts.
- F-DET-7: The user sees the chosen day's status: "completed", "partial" or "—".
- F-DET-8: The user can write a note for the chosen day and save it ("Note saved"). An empty note clears it.
- F-DET-9: The user sees "30-day trend": one bar per day by intensity, with the first and last date and "n / 30 days" done.
- F-DET-10: The user sees the habit's description under "Notes" when it has one.

### Module: Habits (habits)
- F-HAB-1: The user can create a habit from "Add habit", the empty list's "New habit" or `n`. The form takes:
  - name, required;
  - description;
  - type: Binary, Count, Duration or Avoid;
  - category, or Uncategorized;
  - colour, from 18 swatches;
  - icon, from a picker with search.
- F-HAB-2: WHEN the type is count or duration THE SYSTEM SHALL ask for a target per day, which must be a positive number, and a unit. An empty unit becomes "reps" or "min".
- F-HAB-3: The user can change every field of a habit from the Edit button in its detail.
- F-HAB-4: The user can archive a habit from its edit form. It leaves the list and the dashboard, and its history is kept.
- F-HAB-5: The user can delete a habit after confirming "Delete "<name>"? This will remove all of its history.". Its entries are deleted with it.
- F-HAB-6: WHEN a habit is created THE SYSTEM SHALL place it at the end of the list.

### Module: Categories (categories)
- F-CAT-1: The user can open "Categories" and add a category with a name and one of the 18 colours (emerald by default). Enter adds it, and it goes last among the chips.
- F-CAT-2: The user sees the categories in order, each with its colour dot, under a count ("2 categories").
- F-CAT-3: The user can edit a category's name and colour in place. Enter saves and Escape cancels.
- F-CAT-4: The user can delete a category after confirming "Delete category "<name>"? Habits in it will become uncategorized.". Its habits stay, uncategorized.

### Agent (via A2App)
- F-AGT-1: The agent can perform every action a person can take, and read every number the screen shows, through the 15 operations in ## Operations Design, across the modules app, habits, entries and categories.
- F-AGT-2: The agent can read from `app.guide` what the app is, the habit types, the completion and streak rules, the day window, the valid colours and icons, today's date, and ready-to-run recipes.
- F-AGT-3: The agent can read the main screen in one call with `app.state`:
  - the dashboard and the top streak;
  - the category chips;
  - every active habit with today's entry and current streak.
  
  The same search and category filter as the app apply, and archived habits can be added on request.
- F-AGT-4: The agent can read one habit's detail with `habits.get` (tiles and 30-day trend), and its heatmap with `habits.history` (7–730 days, logged days only, or all days). Both use the same rules as the screen.
- F-AGT-5: The agent can log a day with `entries.set` (value and/or note), `entries.mark` (done or not done) and `entries.add` (+/−). These take the same values and the same 365-day window as the app's controls, and write one entry per day.
- F-AGT-6: The agent can manage habits and categories with the form's rules:
  - `habits.create`, `habits.update`, `habits.archive` (`archived` true or false), `habits.reorder` and `habits.delete`;
  - `categories.create` and `categories.delete`.
  
  The rules are a positive target for count and duration, the default units, the palette, the picker's icons, and a new habit or category going last. A deleted category's habits become uncategorized.
- F-AGT-7: The agent can clear one habit's whole history with `habits.clear-entries`.
- F-AGT-8: WHEN the agent calls a destructive operation (`habits.delete`, `habits.clear-entries`, `categories.delete`) THE SYSTEM SHALL answer `approval_required` until the person has approved that call.
- F-AGT-9: WHEN the agent writes to an archived habit's entries or settings THE SYSTEM SHALL refuse with a conflict naming `habits.archive --archived false`.
- F-AGT-10: The agent can read and write raw habits, entries and categories records with `a2app <app> data`, under the collection rules and the field definitions.

## Non-Functional Requirements
- N-1: A check-in from a row updates the row's count, streak, 30-day strip and the dashboard after one save and one reload of the list (no page reload).
- N-2: Day arithmetic is done on calendar-day ordinals, so a daylight-saving change never shifts a day, a streak or a heatmap cell.
- N-3: Breakpoints:
  - **Phones:** the mobile layout applies up to 767 px.
  - **Panel:** the right panel shows from 768 px, and the 30-day strip from 720 px.
  - **Tap targets:** controls grow on phones (rows 52 px, buttons 36 px).
- N-4: The View reads records 500 at a time and pages until it has them all, so long histories are never cut off.
- N-5: The agent operations compute the same numbers as the View's shim for the same data. Every list, dashboard, stats, trend and heatmap number was checked equal (682 checks) on 2026-11-11.

## Data Requirements
- **categories** (module: categories): name (string, required, max 120), color (string, max 20), order (number), created (datetime, server-set), updated (datetime, server-set).
- **habits** (module: habits): name (string, required, max 200), description (string, max 2000), type (enum), kind (enum), target (number), unit (string, max 40), color (string, max 20), icon (string, max 40), category (ref → categories), order (number), archived (boolean), created (datetime, server-set), updated (datetime, server-set).
- **entries** (module: entries): habit (ref, required → habits), day (string, required, max 10), value (number), note (string, max 2000), created (datetime, server-set), updated (datetime, server-set).

## External Interfaces
- **Human (browser):** one single-user View served by PocketBase at the app's own origin. It is a single page with no routes: a top bar, the habit list and the right panel (the dashboard, or the habit detail). Over it open the "New habit" / "Edit habit" dialog and the "Categories" dialog. There is no file input or output.
- **Agent (A2App):** the modules and collections in AGENT_APP.md § Modules; operations exactly as declared in ## Operations Design. No other machine interface is offered to agents; the app's own screens call their own routes.

## Out of Scope
- More than one person: accounts, sign-in, sharing or roles.
- Schedules other than daily (specific weekdays, weekly or monthly goals), and goals other than a per-day target.
- Reminders, notifications or streak alerts.
- Logging a future day, or a day more than 364 days back, from the app.
- Deleting a single day's entry from the app: "not done" sets the day to 0, and an empty note clears the note.
- Viewing archived habits in the app, or unarchiving from it (archived habits are never listed).
- Reordering categories.
- Import or export of habits or history.
- Live updates of an open page when data changes elsewhere (an agent or another tab).
- AI features inside the app, and integrations with other services.

## Quality of Life
- The right panel's width is remembered in the browser, and a double-click on its edge resets it.
- The search placeholder shows its shortcut ("press /"), and the dashboard's Tips list the keyboard shortcuts.
- The icon picker has a search box.
- Each heatmap and strip day shows its date and value as a tooltip.

PART B — TECHNICAL SPECIFICATION.

## System Overview
PocketBase 0.39 (JS hooks, migrations) + React 19 / Vite / Tailwind 4 View in `frontend/` built into `pb/pb_public/`, on the `blueprint-pocketbase-kit` toolkit.

The View is the V1 frontend:
- `AppController.ts` holds the state, and the components live in `components/`.
- Its calls go to a sentinel host, and `services/apiAdapter.ts` answers them. The shim reads and writes the `categories`, `habits` and `entries` records through PocketBase's records API, and computes every derived number in the browser.

The agent operations are served by the app's own routes `/api/ops/<group>/<verb>` in `agent_ops.pb.js` (GET reads, POST writes). Their logic is ported from the shim into `lib_agent.js`. The older route `habits.clear-entries` is in `ops.pb.js`. The generated `a2app_routes.pb.js` serves the same handlers to agents as `POST /api/ops/<name>`.

Modules → navigation map:

| Module (manifest) | Where a person meets it | Route |
| --- | --- | --- |
| `app` | The dashboard in the right panel (or the phone strip), the category chips and the habit list | — (single page) |
| `habits` | Habit rows; the habit detail panel; the "New habit" / "Edit habit" dialog | — |
| `entries` | Row check-in controls (check, +/−, duration button); the detail panel's heatmap, day editor and note | — |
| `categories` | The "Categories" dialog; the filter chips; the category select in the habit form | — |

The page has no navigation of its own. The top bar holds search, the chips, "Categories" and "Add habit". A row click opens a habit's detail in the right panel, or full screen on phones.

## UI Design
- **Design system:**
  - **Variables:** the app's own "CraftBot Browser Interface" variables live in `frontend/src/app/styles/global.css`:
    - Inter / system sans;
    - a type scale from 12 to 20 px (the compact components set 10–22 px inline);
    - spacing on a 4 px grid;
    - radii 4, 6, 8 and 12 px;
    - transitions of 100, 150 and 200 ms;
    - a z-index scale.
  - **Theme mapping:** `styles/theme-bridge.css` maps those variables onto the kit 0.5.0 tokens (`--agent-app-bg/surface/text/border/accent`, with the legacy `--lui-*` names as a fallback). It derives the secondary, tertiary, muted and border shades with `color-mix`, and flattens every corner under the brutalist pack.
  - **Components:** presentational components are in `components/ui/index.tsx`: Button, Input, Textarea, Select, Modal, Alert, EmptyState and others.
  - **Icons and palette:** lucide-react. `lib/icons.ts` holds 89 habit icon names and the 18-colour palette.
  - **Toasts:** react-toastify.
  - **Charts:** the heatmaps, trend bars and progress ring are drawn by the app (divs and SVG).
- **Layout:**
  - **Page:** a full-height column: the top bar, then the scrolling habit list, with the resizable right panel beside it from 768 px.
  - **Rows:** compact and borderless, 40 px tall (52 px on phones), with 6 px corners. The selected row gets a tint and a 3 px left stripe in the habit's colour.
  - **Panel:** the right panel holds blocks with small uppercase section titles: TODAY, THIS WEEK, TOP STREAK and TIPS, or the detail's sections.
  - **Dialogs:** centred over a dark overlay, 420 px wide (categories) or 560 px (habit form).
- **Screen — Main (habit list and dashboard):**
  - **Primary object:** today's active habits.
  - **Primary action:** the row's check-in control; "Add habit" for new ones.
  - **Loading:** "Loading habits…" centred until the first load; each row's 30-day strip shows grey placeholders while it loads.
  - **Empty:** "No habits yet" with "Add your first habit and check in today." and "New habit". The dashboard adds "Add your first habit to see stats.".
  - **Error:** an Alert under the top bar: "Backend unavailable. Start the backend server." when PocketBase does not answer at start, or "Failed to load data from backend" when a reload of the list fails. Failed writes toast what went wrong, or else e.g. "Failed to update habit" and "Failed to reorder habits".
  - **In-flight:** a row's control is disabled while its save runs.
  - **Success:** the row, its streak and the dashboard update after the save.
  - **Narrow:** the phone layout of F-FRM-5 and the dashboard strip of F-DSH-5. The 30-day strip and the drag handle are hidden.
- **Screen — Habit detail:**
  - **Primary object:** one habit's history.
  - **Primary action:** edit a day: mark it done, or type its value and note.
  - **Loading:** "Loading…" in the heatmap and trend sections. A failed load toasts why ("Habit not found", "Could not reach the backend."), or else "Failed to load habit detail".
  - **Day editor:** titled "Edit <Wed, Nov 11, 2026>" with a "Today" badge for today. It has the status "completed", "partial" or "—", the note box with "Save note", and the habit's target.
  - **Success:** "Note saved". The heatmap, the tiles and the trend reload after each change.
  - **Error:** the operation's message as a toast ("Failed to update entry", "Failed to save note").
  - **Narrow:** opens full screen over the page (`role="dialog"`). The tiles use 2 columns instead of 4, and the heatmap shrinks its cells and drops the weekday labels to fit.
- **Screen — New habit / Edit habit (dialog):**
  - **Primary object:** one habit.
  - **Primary action:** Create or Save.
  - **Fields:** Name (placeholder "Meditate, Pushups, No soda…"), Description ("Why this habit matters to you"), Type, Category, then "Target per day" and Unit for count and duration, the colour swatches, and the icon picker with search ("No icons match "<q>".").
  - **Validation:** "Name is required" and "Target must be a positive number", shown under the field.
  - **In-flight:** the Save button shows a spinner and the other buttons are disabled.
  - **Edit-only buttons:** Archive (or Unarchive) and Delete. Delete asks through the browser's confirm dialog.
  - **Success:** toasts "Habit created", "Habit updated", "Habit archived" and "Habit deleted". An error toasts PocketBase's reason, for example "name: Must be no more than 200 character(s).", or "Could not reach the backend; the change was not saved.".
  - **Narrow:** the dialog takes the screen's width up to 560 px, and the field pairs wrap.
- **Screen — Categories (dialog):**
  - **Primary object:** the categories.
  - **Primary action:** "Add category". It is disabled until a name is typed.
  - **Empty:** "No categories yet" and "Group your habits to filter the list quickly. Pick a category color to give the chip in the top bar a distinctive look.".
  - **Rows:** each has Edit (in place, with Cancel and Save) and Delete. Delete asks through the browser's confirm dialog.
  - **Success:** toasts "Category created", "Category updated" and "Category deleted".
  - **Narrow:** the dialog takes the screen's width up to 420 px.
- **Formatting:**
  - **Dates:**
    - the top bar reads "Wednesday, Nov 11", in the browser's locale;
    - the day editor and heatmap tooltips read "Wed, Nov 11, 2026", also in the browser's locale;
    - the 30-day strip and trend tooltips and the trend's end labels use `YYYY-MM-DD`;
    - month labels are "Jan"…"Dec".
  - **Numbers:** streaks read "<n>d" or "<n> days in a row". Percentages are whole numbers. Quantities read "value/target unit".
  - **Empty values:** an empty day reads "—", and a habit without a category shows "Uncategorized" in the form. Screens show names, never record ids.

## Quality Conformance

- **Q1 Completeness & IA:**
  - **Orientation:** one page. The top bar holds search, the category chips, "Categories" and "Add habit". The right panel shows the dashboard, or the selected habit with its name in the header. The selected row is marked with a tint and a stripe in its colour.
  - **Reach:** every function is reachable from the top bar or a row (map in ## System Overview). Only `app.guide` has no screen.
  - **Names hold app-wide:** habit, category, day, streak, target, unit, archive.
  - **Working set:** the one list that can outgrow a screen, the habit list, has a name search and a category filter.
- **Q2 Design system:**
  - **Tokens:** the app's own variables in `global.css`, mapped onto the kit's `--agent-app-*` tokens by `theme-bridge.css` (see ## UI Design).
  - **Semantic roles:**
    - grey chrome from the theme;
    - the theme accent for focus rings, the progress ring and the primary button;
    - each habit's palette colour as its only accent;
    - red danger buttons for Delete.
  - **Icons:** lucide-react only.
  - **Colour scheme:** light and dark come from the host through the kit's theme bridge. `useSystemTheme` also mirrors the OS preference onto `data-theme`.
- **Q3 Layout & composition:**
  - **Spacing:** a 4 px base.
  - **Density:** rows are compact (40 px) and borderless. The dashboard and the detail use small uppercase section titles over plain blocks.
  - **Primary actions:** one primary button per surface: "Add habit", Create / Save, "Add category".
  - **Alignment:** numbers use tabular figures, and streak badges keep a fixed minimum width so rows align.
  - **Long names:** truncate with an ellipsis in rows and headers.
  - **No pagination:** the list shows every active habit, and the heatmap is fitted to the panel's width.
- **Q4 Interaction:**
  - **Affordance:** clickable rows, chips, swatches, icons and buttons use the pointer cursor. Rows tint on hover, the drag handle shows a grab cursor, and the panel edge shows a resize cursor. Disabled buttons dim to half opacity with a not-allowed cursor.
  - **Destructive actions:** deleting a habit or a category asks through the browser's confirm dialog. The question names the target and the consequence: "This will remove all of its history.", "Habits in it will become uncategorized.". There is no undo; archiving is the reversible alternative.
  - **Keyboard:**
    - the shortcuts in F-FRM-4;
    - Enter opens a focused row;
    - Enter adds a category or saves a category edit, and Escape cancels the edit;
    - Enter commits a day value;
    - Escape closes a dialog.
  - **Constrained inputs:** count/duration targets are number fields with a minimum of 1, and day values are number fields with a minimum of 0. Colours and icons are picked from fixed sets, never typed.
- **Q5 State & feedback:**
  - **States:** each screen's states are listed in ## UI Design.
  - **In-flight:** row controls are disabled while their save runs, which guards against double presses. The habit form's Save shows a spinner and disables the other buttons.
  - **Success:** a toast ("Habit created", "Note saved", …) plus the updated row, streak and dashboard.
  - **Errors:** a toast with the operation's message.
  - **Loading:** "Loading habits…" for the first load, "Loading…" in the detail sections, and grey placeholder squares for each 30-day strip.
  - **Agent results:** agent writes return the stored values and say that the open app shows them after a reload.
- **Q6 Motion:**
  - **Transitions:** row background and opacity change over 120 ms; the check and duration buttons over 120 ms, and a picked swatch scales over 100 ms. Dialogs fade their overlay in and slide up over 150 ms. The progress ring and bar move over 200 ms. Buttons show a 0.8 s spinner while busy.
  - **Reduced motion:** there is no `prefers-reduced-motion` rule (see ### Conventions and overrides).
- **Q7 Content:**
  - **Voice:** plain and short, in sentence case: "Add your first habit and check in today.", "Mark as done", "Note saved".
  - **Errors:** form errors say what is needed ("Name is required", "Target must be a positive number"). Operation errors name the parameter and show a valid value, e.g. "day must be a calendar date YYYY-MM-DD, e.g. 2026-11-11", or the list of allowed icons.
  - **Terminology:** habit, category, day, streak, target, unit, archive, done / completed, partial.
- **Q8 Accessibility:**
  - **Contrast:** text and surfaces follow the host theme tokens, with muted text mixed from the theme's text and background. Habit colours come from a fixed palette, and white marks sit on a filled habit colour.
  - **Focus:** `:focus-visible` draws a 2 px outline in the accent. Dialogs (`role="dialog"`, `aria-modal`) close on Escape but do not trap focus. The phone detail is also a `role="dialog"`.
  - **Labels:**
    - icon-only buttons carry `aria-label`: "Mark as done" / "Mark as not done", "Increment", "Decrement", "Mark target reached" / "Reset duration", "Close", "Add habit", "Manage categories", "Color <hex>";
    - the search boxes are labelled;
    - the detail is an `aside` labelled "<habit> details";
    - the resize handle is a `role="separator"` with a label;
    - rows are focusable `role="button"`;
    - heatmap days are buttons labelled with their date;
    - the 30-day strip is a `role="img"` with a label;
    - the Alert is `role="alert"`.
  - **Targets:** 36 px controls on phones and 26–28 px on desktop.
  - **Meaning is not colour alone:** the day status is written ("completed", "partial", "—"), a done check shows a check mark, and tooltips give values.
- **Q9 Responsiveness:**
  - **Breakpoints:** the phone layout runs up to 767 px, the side panel shows from 768 px, and the 30-day strip from 720 px.
  - **Phones:**
    - the top bar wraps;
    - the chips scroll sideways;
    - a dashboard strip sits above the list;
    - the detail opens full screen;
    - the drag handle is hidden;
    - controls grow to 36 px and rows to 52 px.
  - **Fitting:** the heatmap picks its cell size to fit its width and drops the weekday labels when narrow. Dialogs take the screen's width up to 420 or 560 px.
- **Q10 Performance:**
  - **Volume:** at A-1, each refresh of the View reads all habits, categories and entries (500 per request) and computes the list and the dashboard in memory. Each row's 30-day strip loads its habit's entries when the row mounts and again after each reload of the list. The detail panel loads the habit's 365-day heatmap and its stats.
  - **Server side:** `app.state` reads the three collections once per call; `habits.get` and `habits.history` read one habit's entries; `habits.history` is capped at 730 days. `lib_agent.js` is required once per handler.
  - **Assets:** the View loads no image files; icons are SVG components.
- **Q11 Caching & freshness:**
  - **Static:** the built bundle has content-hashed asset names, and the toolkit serves the document shell `no-store`.
  - **Data:** nothing is cached beyond the View's in-memory snapshot. The View re-reads the list, categories and dashboard after each of its own writes, and the detail panel re-reads its habit when the habit changes. There is no realtime subscription and no polling, so changes made elsewhere (an agent, another tab) show after a reload. Each row's 30-day strip reloads with the list, and the list reloads when the date rolls over.
- **Q12 Data integrity:**
  - **One entry per day:** a unique index on `entries (habit, day)`.
  - **Relations:**
    - `entries.habit` is required and cascades on delete;
    - `habits.category` is optional and does not cascade, so PocketBase empties it when its category is deleted.
  - **Vocabularies and limits:** `habits.type` is a select of `binary`/`quantity`, `habits.kind` a select of the four form types, and text fields have the limits in C-8. `entries.day` is 10-character text: the View writes local dates, and the operations check the format and the 365-day window.
  - **Multi-step writes in the operations:** each entry upsert runs in a transaction and retries once on a unique-index clash; `habits.reorder` is one transaction.
  - **Multi-step writes in the View:** it writes one record per call, and its reorder is one PATCH per habit.
  - **Migrations:** four (schema, seed, the 40-character `icon` field, the `kind` field), replayable on a fresh database.
- **Q13 API:**
  - **View:** uses PocketBase's records API through the shim.
  - **Agent routes:** the app's own `/api/ops/<group>/<verb>` (GET reads, POST writes), served to agents by the adapter as `POST /api/ops/<name>`. Parameters come from the query or the JSON body and accept typed or text values.
  - **Errors:** `{ error }` with 400 (bad input), 404 (unknown habit or category), 409 (archived habit) and 500. The adapter turns them into its `{ ok: false, code, message }` envelope.
  - **Repeat-safe:** `entries.mark` sets an explicit state, and `entries.set` with unchanged values writes nothing.
  - **Bounds:** history is capped at 730 days, and stack traces are never returned.
- **Q14 Architecture:**
  - **UI:** in `frontend/src/app`: `AppController.ts` (state), `components/`, `lib/` (dates, icons, hooks).
  - **View data access:** one module, `services/apiAdapter.ts`.
  - **Agent logic:** `pb/pb_hooks/lib_agent.js`, with routes in `agent_ops.pb.js` and `ops.pb.js`.
  - **Rules written twice:** the completion, streak, rate, heatmap and dashboard rules exist in the browser shim and in `lib_agent.js`, ported function for function with the source cited (see ### Conventions and overrides).
  - **Configuration:** `manifest.json` and the toolkit's launcher.
- **Q15 Resilience:**
  - **The shim reports failures:** every PocketBase call's result is checked, and none passes for a success.
    - A failed read answers PocketBase's own status and message, or 503 "Could not reach the backend." when it does not answer, so the error Alert or a toast shows instead of an empty list. "Habit not found" (404) means PocketBase answered 404, never that the backend was down. An unknown route answers an empty value.
    - A refused write (creating, editing or deleting a habit or a category, a reorder, writing or deleting a day's entry, clearing a habit's entries) answers with PocketBase's own status and says why (the refused field and its rule, "Habit not found", "Category not found" or "Entry not found"), and no answer at all is 503 "Could not reach the backend; the change was not saved." ("…; nothing was deleted." for a delete), so the toast says what happened. Deleting a day's entry that is already gone answers "not_found", as when there was none; clearing entries stops at the first refusal and says how many it cleared.
  - **Failed writes:** they toast, and a failed reorder stops at the refused habit and re-reads the list, so it shows the order that was saved.
  - **Operations:** PocketBase validation errors come back as 400 with the field's message. An upsert racing the app's own create on the same day retries once.
  - **Crashes:** a render crash shows the kit's "Something went wrong" panel with "Reload app".
  - **External calls:** none, so no timeouts are needed.
- **Q16 Security & privacy:**
  - **Access:** with `authMode: none`, the collection rules are open (`''`), because the app is single-user and binds loopback.
  - **Adapter checks:** the framework adapter runs its host check, framing policy and credential checks before any app hook, for agent and program calls to records and declared operations. Destructive operations need the person's approval.
  - **Filters:** the new operations bind filter values as parameters. The older `habits.clear-entries` interpolates the id into its filter, unchanged from the published app.
  - **Personal data:** notes and history stay in `pb/pb_data` and are not logged.
  - **Credentials:** runtime credentials (`.agent-token`, `.principal`, `.superuser`) are git-ignored.
- **Q17 Observability:**
  - **Server logs:** agent operations log `[habit-tracker] agent op failed: <message>` for 5xx errors, and the toolkit logs `[handler-error] <METHOD> <path>: <message>` for uncaught handler errors.
  - **Browser logs:** the kit's console relay ships browser errors and warnings to `logs/frontend_console.log` (capped at 2 MB). The V1 UI-capture and log posts go to the shim, which discards them.
  - **Health:** `/api/_a2app`, the adapter's identity document.
- **Q18 Version control:**
  - **Commits:** per app and per change ("Port habit-tracker Living UI to the V2 (PocketBase) platform", "habit-tracker: pass strict tsc for V2 import (build gate)").
  - **Ignored:** `.gitignore` excludes credentials, `pb/pb_data/`, the PocketBase binary, the built View `pb/pb_public/`, `frontend/node_modules/`, framework runtime state under `.a2app/`, and `logs/`.
  - **Clean build:** the app builds from a clean checkout with the manifest pipeline alone (`install`, `build`, `start`).

### Conventions and overrides
The published app is restated here unchanged, so these are standing decisions of the approved build, not new work. Revisit any of them when the app is next modified.
- Q11 (freshness): the View has no realtime subscription. It re-reads only after its own writes and when the date rolls over, so agent changes show after a reload, and AGENT_APP.md tells agents to say so.
- Q4 (confirmations): deletes ask through the browser's `confirm` dialog, not an in-app dialog, and nothing has undo.
- Q6 (reduced motion): there is no `prefers-reduced-motion` rule. The motion is limited to short (100–200 ms) fades, slides and colour changes.
- Q8 (focus): the app's Modal closes on Escape and on an overlay click, but does not trap focus.
- Q5.2 (designed loading): there are no skeletons beyond the strip placeholders; loading is text ("Loading habits…", "Loading…").
- Q12 (transactions): the View's reorder is one PATCH per habit, not one transaction; `habits.reorder` is one.
- Q14.4 (one implementation per rule):
  - the derived-number rules live in the browser shim (`apiAdapter.ts`) for the View, and in `lib_agent.js` for agents;
  - the local-date helper is repeated in `lib/dates.ts`, `AppController.ts`, `HabitList.tsx` and `apiAdapter.ts`.
- Mirrored global rules: none recorded for this app.

## Process Flows
None. No record has a lifecycle:
- a day's entry is one value (and note) per habit and day, and "partial" and "completed" are computed from it, never stored;
- archiving is a boolean on the habit;
- deletes cascade as in Q12.

## Operations Design
| Operation | Module | Entity | appliesWhen | Params | Flags |
| --- | --- | --- | --- | --- | --- |
| habits.clear-entries | habits | — | — | habit_id: string! | destructive |
| app.guide | app | — | — | — | readOnly |
| app.state | app | — | — | search: string, category_id: string, include_archived: boolean | readOnly |
| habits.get | habits | — | — | habit_id: string! | readOnly |
| habits.history | habits | — | — | habit_id: string!, days: number, all_days: boolean | readOnly |
| habits.create | habits | — | — | name: string!, type: enum, target: number, unit: string, description: string, color: enum, icon: enum, category_id: string | — |
| habits.update | habits | — | — | habit_id: string!, name: string, type: enum, target: number, unit: string, description: string, color: enum, icon: enum, category_id: string | — |
| habits.archive | habits | — | — | habit_id: string!, archived: boolean | — |
| habits.reorder | habits | — | — | habit_ids: string! | — |
| habits.delete | habits | — | — | habit_id: string! | destructive |
| entries.set | entries | — | — | habit_id: string!, day: string, value: number, note: string | — |
| entries.mark | entries | — | — | habit_id: string!, done: boolean!, day: string | — |
| entries.add | entries | — | — | habit_id: string!, amount: number, day: string | — |
| categories.create | categories | — | — | name: string!, color: enum | — |
| categories.delete | categories | — | — | category_id: string! | destructive |

## Changes
- 2026-11-11 defect fixes: the user asked for the published app's known defects to be fixed. Every picker icon, the form's default `CheckCircle2` included, can be saved (C-7, F-HAB-1); duration and avoid habits keep their type after a reload, stored in the new `kind` field (C-3, F-LST-6); each row's 30-day strip follows check-ins, edits and the date (F-LST-3, N-1); the error alert shows when PocketBase does not answer or the list cannot be loaded (F-FRM-7); a refused habit edit or archive toasts the real reason instead of "Habit not found" (F-FRM-8, Q15); a refused entry edit, habit delete or reorder now toasts its real reason too, instead of passing for saved (F-FRM-8, F-HAB-5, F-LST-8, Q15). The agent operations follow the same rules (F-AGT-6).
- 2026-11-12 failure reporting: the browser shim checks every PocketBase result. A refused habit or category create, category edit or delete, new day's entry, entry delete or entries clear now answers PocketBase's status and reason instead of a bare 500 "failed to save entry", a 404 "Category not found" or a silent success; a read with PocketBase down answers 503 "Could not reach the backend." instead of 404 "Habit not found"; and the habit detail's load toast says why (F-FRM-8, F-CAT-1, F-CAT-3, F-CAT-4, Q15). The agent operations already answered with PocketBase's own errors (F-AGT-6).
