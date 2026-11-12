# Tasks: CRM System

Every task cites what it implements. These features already exist in the published app `crm-system` 2.0.0, so the build tasks are recorded as done.

## Build
- [x] T-1 (F-FRM-1, F-FRM-2, F-FRM-3, F-FRM-4, F-FRM-5): app frame. The 52 px rail has the mark, the New menu, the main views and Activity and Setup at the foot, with hover names, an accent bar and counts. The title bar has the view, workspace, status chips, Search, Ask AI, Undo and Redo, and phones get a bottom bar with More (`components/Shell.tsx`).
- [x] T-2 (F-FRM-6): command palette on Ctrl K: search through `search.all`, go-to entries, create actions, lists, pipeline boards and "Ask your AI agent" (`components/Palette.tsx`).
- [x] T-3 (F-FRM-7): global keys: Ctrl Z, Ctrl Y and Ctrl Shift Z through `activity.undo` and `activity.redo`, plus P, D, L and T, which give way to record pages and Today (`App.tsx`).
- [x] T-4 (F-FRM-8, F-FRM-9): `--cr-*` colors derived from the host theme tokens with contrast checks and re-derived on every theme change; near-monochrome tokens with meaning-only color and lucide icons (`lib/themeColors.ts`, `theme.css`).
- [x] T-5 (F-FRM-10, F-FRM-11): one realtime hub over the 21 collections with debounced `useLive` views, and a reload onto a newly deployed build after a reconnect or a tab show, waiting while a dialog is open (`lib/live.ts`, `lib/store.tsx`).
- [x] T-6 (F-ONB-1, F-ONB-2, F-ONB-3): first-run onboarding: workspace, owner, currency and pipeline templates through `setup.apply`, then the three ways to bring people in; the migration seeds settings only (`views/Onboarding.tsx`).
- [x] T-7 (F-HOME-1, F-HOME-2, F-HOME-3): Home range control and the six headline numbers against the period before, with formula tooltips and count-ups; revenue pipelines only (`app.dashboard`, `lib_reports.dashboard`).
- [x] T-8 (F-HOME-4, F-HOME-5): the pipeline-by-stage panel with the pipeline menu, and "Needs your attention" with its rows and "All caught up".
- [x] T-9 (F-HOME-6, F-HOME-7): the 6-month forecast (won, weighted, best-case line, undated deals) and won and lost by month (`components/charts.tsx` BarChart).
- [x] T-10 (F-HOME-8): one panel per fundraising pipeline (committed against the round target) and per hiring pipeline (hired, in process, by stage).
- [x] T-11 (F-HOME-9, F-HOME-10, F-HOME-11, F-HOME-12, F-HOME-13): interactions per week, relationships (mix, going cold, strongest), sources donut, Coming up, and the AI agent panel with Revert.
- [x] T-12 (F-TOD-1, F-TOD-2, F-TOD-3, F-TOD-4, F-TOD-6): Today groups from `tasks.today`, quick add, done, snooze and delete, J/K/X/S/Enter/N keys, and the "AI" chip (`views/Today.tsx`).
- [x] T-13 (F-TOD-5): Today side panel: proposals banner, going stale, no next step with "Task", and keep in touch with a one-click log.
- [x] T-14 (F-REC-1, F-REC-7): People and Companies sidebar with presets, lists (with "New list"), saved views, Duplicates and Trash (`views/Records.tsx`).
- [x] T-15 (F-REC-2, F-REC-3, F-REC-5): dense record table with marks, sortable headers, the filter bar (`{field, op, value}`, all or any), and in-place cell editing through the field specs (`components/Table.tsx`, `components/fields.tsx`).
- [x] T-16 (F-REC-4): column chooser remembered in this browser, and save or update a view (`views.save`).
- [x] T-17 (F-REC-6, F-REC-9): selection with shift ranges, the bulk bar (tag, add to or remove from list, research, merge two, trash; `people.bulk`, `companies.bulk`), and the J/K/Enter/X/slash keys.
- [x] T-18 (F-REC-8): CSV import from the table and export of the filtered table (`people.export`, `companies.export`).
- [x] T-19 (F-PAGE-1, F-PAGE-2, F-PAGE-3, F-PAGE-4): record page and 520 px peek, with the header, the action bar (Log, Email, Task, Research, More) and the highlight strip per object (`components/RecordView.tsx`).
- [x] T-20 (F-PAGE-5, F-PAGE-6, F-PAGE-7, F-PAGE-8): tabs with Focus, the note box (Ctrl+Enter, N), and one timeline per record with in-place pin, finish, send and discard (`timeline.get`, `components/Timeline.tsx`).
- [x] T-21 (F-PAGE-9): details sidebar with in-place editing of built-in and custom fields, provenance marks, lists, work history, and added and changed dates (`components/fields.tsx` DetailRow).
- [x] T-22 (F-PAGE-10, F-PAGE-11, F-PAGE-12): deal stage bar with days per stage, Won, Lost with a reason, and Reopen; deal people with roles; a company's people and alumni (`deals.move`, `deals.close`, `deals.reopen`, `deals.add_person`, `deals.remove_person`).
- [x] T-23 (F-PAGE-13, F-PAGE-14): merged ids resolve to the survivor (aliases), and restore from the page (`people.restore`, `companies.restore`, `deals.restore`).
- [x] T-24 (F-DEAL-1, F-DEAL-2, F-DEAL-3): Deals with the pipeline sidebar and totals, board columns per open stage, and cards with value, close, days in stage against the target, next-activity dot, people, rotting edge and the AI mark (`views/Deals.tsx`).
- [x] T-25 (F-DEAL-4): drag between stages and positions, and Won and Lost drop zones with the lost-reason dialog.
- [x] T-26 (F-DEAL-5, F-DEAL-6): the deals table with totals and presets, search (/), the filter bar, and the bulk bar (move to a stage, tag, trash; `deals.bulk`).
- [x] T-27 (F-CAP-1, F-CAP-2, F-CAP-3, F-CAP-4, F-CAP-10): New person, company and deal dialogs, the "Already in your CRM" panel from the 409 candidates, role suggestions per pipeline kind, and opening the new record (`components/dialogs.tsx`).
- [x] T-28 (F-CAP-5, F-CAP-6): Log an interaction: kind, direction, people, deal, time, subject and summary. `interactions.log` updates strength, keep-in-touch and rotting, and meeting review queues notes of at least 40 characters (`lib_interactions.js`).
- [x] T-29 (F-CAP-7, F-CAP-8): New task with quick due dates and kinds, and the email composer with draft, send (queued for the agent) and "Open in my mail app instead".
- [x] T-30 (F-CAP-9): CSV import with column matching, per-row preview, fill-only or replace, add to a list, and one undoable change (`import.preview`, `import.apply`, `lib_import.js`).
- [x] T-31 (F-REV-1, F-REV-2, F-REV-3, F-REV-4): Review waiting tab: proposals grouped by record with changes, evidence, reason, source and confidence. It offers Accept, Edit then accept, Reject, Y/N/J/K, and "Accept the sure ones" (`proposals.decide`, `components/Proposal.tsx`, `lib_review.js`).
- [x] T-32 (F-REV-5, F-REV-6): Review Emails tab (failed with Edit, Retry and Mail app; queued; sent) and History and trust with per-kind acceptance rates and the automatic switches (`proposals.stats`, `policy.update`).
- [x] T-33 (F-RPT-1, F-RPT-2, F-RPT-3, F-RPT-4, F-RPT-5): Reports frame: the eight presets in two groups, period and pipeline, the formula line, click-through rows, CSV download and Explain (`views/Reports.tsx`).
- [x] T-34 (F-RPT-6, F-RPT-7, F-RPT-8, F-RPT-9): the report bodies (`reports.pipeline`, `reports.funnel`, `reports.forecast`, `reports.winloss`, `reports.stage_time`, `reports.sources`, `reports.activity`, `reports.relationships`).
- [x] T-35 (F-ACT-1, F-ACT-2, F-ACT-3): Activity: every change with actor, run and field changes, undo and redo per entry, the Who filter and Show more, and AI agent runs with Review and Revert (`activity.*`, `lib_activity.js`).
- [x] T-36 (F-SET-1, F-SET-2, F-SET-3): Setup Workspace and Pipelines: templates, currency, round target, archive, delete when empty, and the stage table with color, kind, probability, rotting and target days, reorder and delete with move-to (`views/Setup.tsx`).
- [x] T-37 (F-SET-4, F-SET-5): custom fields with types, options and AI instructions (values kept on delete), and list management.
- [x] T-38 (F-SET-6, F-SET-7): the AI agent policy per kind, meeting review, auto research, the daily brief hour, and house rules (`policy.update`, `lib_setup.js`).
- [x] T-39 (F-SET-8): Currencies: in-use currencies and their latest rate, ECB fetch, typed rates, and the stored rates list (`fx.*`, `lib_fx.js`).
- [x] T-40 (F-SET-9, F-SET-10, F-SET-11): Import and export buttons, Duplicates with merge and "Not the same" (`dupes.list`, `dupes.dismiss`), and the Trash with restore (`trash.list`).
- [x] T-41 (F-ASK-1, F-ASK-2, F-ASK-3): Ask AI panel with suggestions, live question states, answers with record links, and delete (`asks.*`, `components/AskPanel.tsx`).
- [x] T-42 (F-UPG-1, F-UPG-2): the schema migration converts an earlier CRM System install in place and removes the old collections (`pb/pb_migrations/1730000000_crm_schema.js`).
- [x] T-43 (F-AGT-1, F-AGT-2, F-AGT-3, F-AGT-15): the 129 operations in `operations.json`, served to agents by `a2app_routes.pb.js` through the same handlers the View calls. They include `app.guide` with conventions and recipes, and `app.context` and `app.summary`, and destructive operations go through the adapter's approval.
- [x] T-44 (F-AGT-4, F-AGT-5, F-AGT-6, F-AGT-7): the write-or-propose decision (`lib_setup.mustPropose`), proposals with evidence (`lib_review.js`), the person-only refusals, `proposals.withdraw`, the agent's own-run revert, and fill-only agent imports.
- [x] T-45 (F-AGT-8, F-AGT-9, F-AGT-10, F-AGT-11): the four triggers and their playbooks (`events.json`, AGENT_APP.md § Work the app asks for), and the work queues `asks`, `research`, `meetings` and `emails` (`lib_agent.js`, `ops_work.pb.js`).
- [x] T-46 (F-AGT-12, F-AGT-13, F-AGT-14): job `cr_agent` every minute: re-asks for waiting work, hands back unfinished work after 4 or 25 minutes, recomputes relationships once after a start, and sends the daily brief. `cr_nightly` recomputes strength, empties the 90-day trash and prunes year-old activity (`hooks.pb.js`).

## Verification
- [x] Framework-files check (`validateFrameworkFiles` of the Agent App CLI) reports no problems for manifest.json, operations.json, AGENT_APP.md, reference/requirements.md and reference/tasks.md.
- [x] ## Operations Design in reference/requirements.md lists exactly the 129 operations of operations.json, each under its declared module.
- [ ] Agent App Framework gate (`agent-app <dir> validate`) passes, including the describe budget on a dev instance.
- [ ] Every declared operation answers through `a2app` on a live instance.
- [ ] The View renders identically to the published build (screenshot comparison).
