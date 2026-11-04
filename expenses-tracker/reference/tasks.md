# Tasks: Expenses Tracker

Every task cites what it implements. These features already exist in the published app `expenses-tracker` 1.0.0, so the build tasks are recorded as done.

## Build
- [x] T-1 (F-FRM-1, F-FRM-2, F-FRM-3): app frame. The left icon rail in three groups shows the current page as a solid circle and names each page on hover. The phone bottom bar has a raised "+" and a menu for the remaining pages (`components/Shell.tsx`).
- [x] T-2 (F-FRM-4): every page reflows down to 320 px. Fixed-width elements fit, and the ring measures its container.
- [x] T-3 (F-FRM-5, F-FRM-6): numbers read "1,234.50" in every locale (`NUMBER_LOCALE`). `normalizeAmount` refuses misplaced commas, and "," types nothing.
- [x] T-4 (F-FRM-7): colors derive from the host theme tokens with contrast checks, and the surface scopes re-derive on each theme change (`lib/themeColors.ts`, `theme.css`).
- [x] T-5 (F-FRM-8, F-FRM-9): line icons only, from the curated set (`lib_icons.js`, `lib/icons.tsx`, migration 1700000300). "Your AI agent" copy, and `agent` as the source and added_by value (migration 1700000400).
- [x] T-6 (F-FRM-10): an open page reloads onto a newly deployed build after a reconnect or a tab show, waiting while a dialog is open (`lib/live.ts`).
- [x] T-7 (F-HOME-1, F-HOME-2): Home header (greeting, date, search, "Add expense"), plus the first-open currency question; the seed adds only settings and categories.
- [x] T-8 (F-HOME-3, F-HOME-4): "Spending in <month>" with the legend and the segmented ring. Labels sit on the band, the gap holds the shortcuts, the hover readout shows numbers, and a click opens the expenses (`components/Donut.tsx`).
- [x] T-9 (F-HOME-5): "Daily spending" bars: today in the accent, over-allowance days in coral, allowance bars behind, and a click opens the day.
- [x] T-10 (F-HOME-6, F-HOME-7): the dark "Spending days" calendar, with the three biggest days in the accent, today ringed, and the month menu switching the dashboard.
- [x] T-11 (F-HOME-8, F-HOME-9): the "Monthly budget" gauge with the spent bubble and "Change", and "Compared with <last month>" by the same day.
- [x] T-12 (F-HOME-10, F-HOME-11): "Recent expenses" (the five latest, "Add new +", a link to all) and the receipt status line linking to Receipts.
- [x] T-13 (F-ENT-1, F-ENT-2): full-screen entry with the circular reveal (an opacity fade under reduced motion), Back/Escape, and three numbered steps that stack on narrow screens.
- [x] T-14 (F-ENT-3, F-ENT-4): the amount display with its caret, keypad and keyboard input, Enter to save, Save disabled until the amount is above zero, and the currency's decimals.
- [x] T-15 (F-ENT-5, F-ENT-6): category tiles by recent use, plus the details: note, Today / Yesterday / Other day with the in-app day picker, and a receipt file.
- [x] T-16 (F-ENT-7): "Paid in another currency" with a live preview. The rates come from Frankfurter, then currency-api, then Frankfurter again, 6 s each, cached in memory, with the original kept (`lib_fx.js`).
- [x] T-17 (F-ENT-8): "Have a receipt? Let your AI agent read it" uploads photos or PDFs as waiting receipts and closes the screen.
- [x] T-18 (F-ENT-9, F-ENT-10): the dark "Added …" pill with Undo, and the same screen for editing with Delete.
- [x] T-19 (F-EXP-1, F-EXP-2): Expenses page: month switcher, day cards with totals, search across months, category filter.
- [x] T-20 (F-EXP-3): select mode with the floating dark bar (move to a category, delete), with transactional bulk operations.
- [x] T-21 (F-EXP-4, F-EXP-5, F-AGT-5): "Ask your AI agent to sort them" fires `categorize_requested` and follows the request (sent, working, done, refused). It comes with the `categorize_requested` playbook.
- [x] T-22 (F-INS-1, F-INS-2, F-INS-3, F-INS-4, F-INS-5): Insights: month stats, ring and legend, category rows with segmented bars, last 12 months, biggest expenses (`summary.month`, `summary.trend`).
- [x] T-23 (F-BUD-1, F-BUD-2, F-BUD-3, F-BUD-4): Budgets: the whole-month gauge and per-category limits, saved on Enter or blur, in outlined fields that read "Set limit" or "1,250.00".
- [x] T-24 (F-REC-1, F-REC-2, F-REC-3): recurring expenses (weekly, monthly, yearly) that record themselves, with catch-up on create, pause, edit, and delete that keeps history. The jobs are `et_recurring` and `et_recurring_boot` (`lib_recurring.js`).
- [x] T-25 (F-CAT-1, F-CAT-2, F-CAT-3, F-CAT-4): category cards, the editor with name and line-icon picker, delete with move-to, and names unique ignoring case (index plus checks while typing).
- [x] T-26 (F-RCP-1, F-RCP-2, F-RCP-3, F-RCP-4, F-AGT-4, F-AGT-6): Receipts page with multi-file drop, the per-row states, Type it in, Try again and Delete. The `receipts_waiting` trigger is fired from the receipt hook and retried by `et_receipts`, and stale "reading" receipts are settled. It comes with the `receipts_waiting` playbook.
- [x] T-27 (F-IMP-1, F-IMP-2, F-IMP-3): CSV import with data-derived detection of delimiter, header, columns, date layout, decimal mark and spending sign. The preview gives counts and first rows, nothing is written before Import, and duplicates are skipped by `dedupe_key` (`lib_csv.js`, `lib_import.js`).
- [x] T-28 (F-IMP-4, F-IMP-5): past imports with Undo (`import.undo`), and CSV export of any range (`export.csv`).
- [x] T-29 (F-SET-1, F-SET-2): Settings: home currency switch with the "Switch to <code>?" confirmation and rescaling of minor units, plus the dark "Let your AI agent do it" card.
- [x] T-30 (F-AGT-1, F-AGT-2, F-AGT-7): the 38 operations in `operations.json`, served to agents by `a2app_routes.pb.js` through the same handlers the View calls. `app.guide` gives conventions and recipes, and destructive operations go through the adapter's approval.
- [x] T-31 (F-AGT-3): record hooks hold the expense rules (`checkRecord`) and category icon rules for every writer (`hooks.pb.js`).

## Verification
- [x] Framework-files check (`validateFrameworkFiles` of the Agent App CLI) reports no problems for manifest.json, operations.json, AGENT_APP.md, reference/requirements.md and reference/tasks.md.
- [x] ## Operations Design in reference/requirements.md lists exactly the 38 operations of operations.json, each under its declared module.
- [ ] Agent App Framework gate (`agent-app <dir> validate`) passes, including the describe budget on a dev instance.
- [ ] Every declared operation answers through `a2app` on a live instance.
- [ ] The View renders identically to the published build (screenshot comparison).
