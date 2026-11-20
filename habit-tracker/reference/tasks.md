# Tasks: Habit Tracker

Every task cites what it implements. These features already exist in the published app `habit-tracker` 1.0.0, so the build tasks are recorded as done.

## Build
- [x] T-1 (F-FRM-1, F-FRM-2): one page with the top bar, the habit list and the right panel. The top bar has the title, today's date, search, category chips, "Categories" and "Add habit" (`components/MainView.tsx`, `TopBar.tsx`).
- [x] T-2 (F-FRM-3): the right panel can be resized by dragging (460–900 px) and reset with a double-click, and its width is kept in the browser (`components/ResizablePanel.tsx`).
- [x] T-3 (F-FRM-4): keyboard shortcuts `/`, `n`, `1`–`9` and Escape, ignored while typing or while a form is open (`MainView.tsx`).
- [x] T-4 (F-FRM-5, F-DSH-5): phone layout up to 767 px. The top bar wraps, the chips scroll, a dashboard strip sits above the list, and the detail opens full screen (`lib/hooks.ts` `useViewport`).
- [x] T-5 (F-FRM-6): the app's design variables map onto the kit theme tokens, and the brutalist pack flattens corners (`styles/global.css`, `styles/theme-bridge.css`).
- [x] T-6 (F-FRM-7, F-FRM-8): "Loading habits…" until the first load completes, and react-toastify toasts in the top-right corner for saves and failures (`App.tsx`).
- [x] T-7 (F-LST-1, F-LST-2, F-LST-3): habit rows show the icon on a colour tint, the name, the meta line, the 30-day strip (from 720 px) and the flame streak badge (`components/HabitRow.tsx`, `MiniHeatmap.tsx`).
- [x] T-8 (F-LST-4, F-LST-5, F-LST-6): type-specific check-in controls: the check button (with a ban icon for avoid habits), +/− for count habits, and the target button for duration habits. Each is disabled while it saves (`HabitRow.tsx`, `HabitList.tsx`, `AppController.toggleToday`).
- [x] T-9 (F-LST-7, F-LST-9, F-LST-10): name search, a category chip that toggles, "Showing X of Y habits", a row click or Enter that opens or closes the detail, and the "No habits yet" empty state (`MainView.tsx`, `HabitList.tsx`).
- [x] T-10 (F-LST-8): drag-and-drop reorder of the visible rows. The row drops in before the target, a drop line shows the spot, and the order is saved (`HabitList.tsx`, `AppController.reorderHabits`).
- [x] T-11 (F-DSH-1, F-DSH-2, F-DSH-3, F-DSH-4): the dashboard sidebar: Today with its progress ring, This week (rate and active streaks of 7 days or more), Top streak and Tips (`components/DashboardSidebar.tsx`).
- [x] T-12 (F-DET-1, F-DET-2, F-DET-10): the detail panel header with Edit and Close, the four stat tiles, and the description under "Notes" (`components/HabitDetailPanel.tsx`).
- [x] T-13 (F-DET-3, F-DET-4): the 365-day heatmap: weeks from Monday to Sunday, month and weekday labels, the legend and tooltips, and cells sized to fit the width. A clicked day opens in the editor, which defaults to today (`components/FullHeatmap.tsx`).
- [x] T-14 (F-DET-5, F-DET-6, F-DET-7, F-DET-8): the day editor: Mark done / not done, a value field that commits on blur or Enter, the status words, and the note with "Save note".
- [x] T-15 (F-DET-9): the 30-day trend bars with the date range and "n / 30 days" (`components/TrendChart.tsx`).
- [x] T-16 (F-HAB-1, F-HAB-2, F-HAB-3): the New habit / Edit habit dialog. It has the four types, the category select, the target and unit for count and duration (positive target, unit defaults), the 18-colour palette and the icon picker with search (`components/HabitFormModal.tsx`, `lib/icons.ts`).
- [x] T-17 (F-HAB-4, F-HAB-5, F-HAB-6): Archive / Unarchive and Delete with confirmation in the edit form. A new habit goes to the end of the list, and deleting a habit cascades to its entries (`HabitFormModal.tsx`, `apiAdapter.ts` `handleHabitCreate`).
- [x] T-18 (F-CAT-1, F-CAT-2, F-CAT-3, F-CAT-4): the Categories dialog: add (Enter, emerald by default, placed last), the ordered list with colour dots, inline edit, and delete with confirmation, which leaves the category's habits uncategorized (`components/CategoryManagerModal.tsx`).
- [x] T-19 (F-AGT-1, F-AGT-2, F-AGT-3, F-AGT-4): agent reads ported from the browser shim to `pb/pb_hooks/lib_agent.js`, behind routes in `agent_ops.pb.js`: `app.guide`, `app.state`, `habits.get` and `habits.history`. They compute the same numbers as the screen.
- [x] T-20 (F-AGT-5, F-AGT-9): agent entry writes `entries.set`, `entries.mark` and `entries.add`. Each upsert runs in one transaction with the day window and value rules, and archived habits are refused with a conflict.
- [x] T-21 (F-AGT-6, F-AGT-7, F-AGT-8): agent habit and category writes `habits.create`, `habits.update`, `habits.archive`, `habits.reorder`, `habits.delete`, `categories.create` and `categories.delete` follow the form's rules. `habits.clear-entries` stays in `ops.pb.js`. Destructive operations go through the adapter's approval, and `a2app_routes.pb.js` serves every operation as `POST /api/ops/<name>`.
- [x] T-22 (F-AGT-10): habits, entries and categories are exposed as entities for `a2app <app> data` (manifest modules), under the open collection rules and the field definitions.

## Verification
- [x] Framework-files check (`validateFrameworkFiles` of the Agent App CLI) reports no problems for manifest.json, operations.json, AGENT_APP.md, reference/requirements.md and reference/tasks.md.
- [x] ## Operations Design in reference/requirements.md lists exactly the 15 operations of operations.json, each under its declared module.
- [x] The agent operations match the View's browser shim on the same data (682 parity checks on a scratch instance, 2026-11-11).
- [ ] Agent App Framework gate (`agent-app <dir> validate`) passes, including the describe budget on a dev instance.
- [ ] Every declared operation answers through `a2app` on a live instance.
- [ ] The View renders identically to the published build (screenshot comparison).
