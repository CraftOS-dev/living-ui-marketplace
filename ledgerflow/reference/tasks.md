# Tasks: Ledgerflow

Every task cites what it implements. These features already exist in the published app `ledgerflow` 2.0.0, so the build tasks are recorded as done.

## Build
- [x] T-1 (F-FRM-1, F-FRM-2, F-FRM-3, F-FRM-5): the frame: the 52 px icon rail with the New menu, the view counts and hover labels, and the phone bottom bar with New and More (`components/Shell.tsx`).
- [x] T-2 (F-FRM-4): the title bar: view name, business name, status chips (AI on N, Locked to, overdue), Search (Ctrl K), Ask AI, and Undo and Redo.
- [x] T-3 (F-FRM-6, F-FRM-7): colors derived from the host theme with contrast checks and re-derived on every theme change (`lib/themeColors.ts`). The near-monochrome, flat, compact visual system lives in `theme.css`.
- [x] T-4 (F-FRM-8): one realtime hub over every app collection, and the reload onto a new build after a reconnect or a tab show, waiting while a dialog is open (`lib/live.ts`).
- [x] T-5 (F-ONB-1, F-ONB-2, F-ONB-3): "Set up your books" (entity, name, home currency, tax region, fiscal year) and the optional opening balances. `setup.apply` seeds the chart of accounts with "use it for" texts and the region's tax codes (`views/Onboarding.tsx`, `lib_setup.js`).
- [x] T-6 (F-HOME-1, F-HOME-2, F-HOME-6): Home's range switch and headline numbers against the period before, counting up, each opening its view (`views/Home.tsx`, `app.dashboard`, `lib_dashboard.js`).
- [x] T-7 (F-HOME-3): Home's charts: cash balance, money in and out with profit, categories donut, who owes you by age, coming up, account trends and budgets (`components/charts.tsx`).
- [x] T-8 (F-HOME-4, F-HOME-5): "Needs your attention" with the inbox mix, and the AI agent's latest runs with revert.
- [x] T-9 (F-INB-1, F-INB-2, F-INB-3): the Inbox tabs, account filter and search. Each line's suggestion shows its method chip and confidence bars, and the keyboard review uses J/K, Enter, X, Space, A and I (`views/Inbox.tsx`).
- [x] T-10 (F-INB-4, F-INB-7): the selection bar (book suggestions, ask AI, exclude), "N sure / Book them", restoring excluded lines and "Recheck suggestions" (`inbox.accept_many`, `inbox.exclude`, `inbox.refresh`).
- [x] T-11 (F-INB-5, F-INB-6): the line inspector: category with tax, split, transfer, or a match to an entry, document or the other line, and "Make a rule" (`inbox.accept`, `inbox.unmatch`).
- [x] T-12 (F-INB-8, F-AGT-3, F-AGT-7): the suggestion chain of match, document, transfer, rule, memory and the AI agent, with three confidence levels (`lib_inbox.js`). Lines without a confident suggestion go to the agent (`lines_imported`), and `inbox.queue`, `inbox.propose`, the agent's `inbox.accept` / `inbox.accept_many` and its `transactions.create` are bound by the posting policy (`lib_inbox_io.mayAutoPost` / `mayPost` / `acceptLine`, `lib_txns.agentPost`).
- [x] T-13 (F-IMP-1, F-IMP-2, F-IMP-3, F-IMP-4): the statement import dialog for a file or pasted text, with a preview. Parsers cover OFX/QFX, QIF, CSV, CAMT.053 and MT940; CSV gets column mapping, the day/month order and layouts remembered per account (`lib_import.js`, `components/dialogs.tsx`).
- [x] T-14 (F-IMP-5, F-SET-8): three-layer duplicate protection (file hash, fingerprint, matches), statement import undo, and saved CSV layouts with delete (`inbox.undo_import`, `profiles.*`).
- [x] T-15 (F-FIL-1, F-FIL-2, F-FIL-3, F-AGT-4): receipts and documents: the upload dialog (25 MB each), the Receipts and documents tab with candidates, attach, Ask AI, archive and delete, and the `documents_received` recipe (`lib_files.js`, `files.*`).
- [x] T-16 (F-RUL-1, F-RUL-2): ordered rules with all or any conditions, a test of what they match, reorder, turn on and off, and delete. AI-proposed rules wait to be turned on, and automatic and one-time rules are supported (`lib_rules.js`, Setup › Rules).
- [x] T-17 (F-LED-1, F-LED-2): the chart of accounts with balances, account registers with a running balance and reconciliation state, and every entry with its filters (`views/Ledger.tsx`, `ledger.register`, `transactions.list`).
- [x] T-18 (F-LED-3, F-LED-4, F-LED-5): the entry inspector: lines, origin (bank line, document, rule, the agent's reason and confidence, the AI run), files and history. It approves and rejects, edits, voids, reverses, copies and repeats an entry.
- [x] T-19 (F-LED-6): the entry dialog for expense, income, transfer (with a second currency) and journal, with balance checking (`components/dialogs.tsx`, `transactions.create`, `lib_ledger.js`).
- [x] T-20 (F-DOC-1, F-DOC-2, F-DOC-3, F-DOC-7): Sales and Purchases lists with what is owed, the line editor with account and tax per line, inclusive or exclusive prices and other currencies, and numbering and posting on approval. States are derived (`views/Docs.tsx`, `lib_docs.js`).
- [x] T-21 (F-DOC-4, F-DOC-5, F-DOC-6): possible-duplicate warnings on bills; payments across currencies with the exchange difference; credits, removing an allocation and write-offs; reminders drafted by the AI agent; mark sent, duplicate, credit note, schedule, attach, print or PDF, and void.
- [x] T-22 (F-REC-1, F-REC-2, F-REC-3): reconciliation per account: the start form prefilled from the statement, ticking with matched lines pre-ticked, and finish at zero locking the entries. It can finish with a Suspense adjustment, stop, and undo the latest (`views/Reconcile.tsx`, `lib_recon.js`).
- [x] T-23 (F-REP-1, F-REP-2, F-REP-3, F-REP-4, F-REP-6): the ten reports from one ledger, with periods, basis, columns and comparisons. Each has its chart, the UK VAT boxes 1 to 9, and the cash-flow consistency note (`views/Reports.tsx`, `lib_reports.js`).
- [x] T-24 (F-REP-5): drill-down to the entries behind an amount (`reports.drill`), CSV export, print or PDF without charts, and Explain through the AI agent (`reports.explain`).
- [x] T-25 (F-BUD-1): budgets per account per fiscal year (12 months, monthly or annual) and budget against actual (`budgets.get`, `budgets.set`).
- [x] T-26 (F-CLS-1, F-CLS-2, F-CLS-3): the month list, the health checks, the manual checklist and the month's notes (`views/Close.tsx`, `lib_close.js`).
- [x] T-27 (F-CLS-4, F-CLS-5, F-CLS-6, F-AGT-6): "Ask AI to prepare" (`close_requested`) with the agent's note, and sign-off with optional lock or reopen. The lock-dates dialog sets the books and AI agent lock dates (`close.*`, `locks.set`).
- [x] T-28 (F-ACT-1, F-ACT-2, F-ACT-3): the activity log with undo and redo per change, Ctrl Z / Ctrl Y from anywhere, and AI runs with revert. Every changing operation runs through `lib_activity.run` (`views/Activity.tsx`).
- [x] T-29 (F-SET-1, F-SET-2, F-SET-3, F-SET-4): Setup › Business, Accounts (with opening balances), Contacts (with merge) and Tax codes (`views/Setup.tsx`).
- [x] T-30 (F-SET-5): recurring schedules for entries, invoices and bills: create from an entry or document, pause, resume, run what is due, delete. The hourly job `lf_recurring` creates what is due (`lib_recurring.js`).
- [x] T-31 (F-SET-6): exchange rates with "Fetch 30 days" from the European Central Bank (20 s timeout), rates typed in, delete, and revaluation of foreign-currency accounts (`lib_fx.js`, `fx.*`).
- [x] T-32 (F-SET-7): Setup › AI agent: sending new lines to the agent, the posting policy (auto-post up to a ceiling per line, the methods that post on import), house rules, and the limits (`policy.update`, `settings.update`).
- [x] T-33 (F-SET-9): export of the books as Beancount, an hledger journal or CSV of every posting for a date range (`lib_export.js`, `export.books`).
- [x] T-34 (F-ASK-1, F-ASK-2, F-AGT-5): the Ask AI panel with suggestions, what is on screen as context (`app.ui`), the question states, links and delete, and the `agent_asked` recipe (`components/AskPanel.tsx`, `asks.*`).
- [x] T-35 (F-KEY-1, F-KEY-2): the Ctrl K palette (go to, create, find accounts, contacts, documents, entries or an amount) and the E, N and I keys (`components/Palette.tsx`, `App.tsx`).
- [x] T-36 (F-AGT-1, F-AGT-2, F-AGT-11): the 139 operations in `operations.json`, served to agents by `a2app_routes.pb.js` through the same handlers the View calls, and `app.guide` with conventions and recipes (`lib_guide.js`). Destructive operations go through the adapter's approval.
- [x] T-37 (F-AGT-8, F-AGT-9): the person-only refusals (policy, locks, approve, delete files, write off, finish or undo a reconciliation, sign off and reopen, automatic schedules) and the AI agent's own lock date (`lib_ledger.checkLock`).
- [x] T-38 (F-AGT-10): the four agent queues with one trigger each, the minute job `lf_agent` retrying refused fires, and hand-back after 4 minutes quiet or 25 minutes (`lib_agent.js`). The nightly `lf_prune` removes old activity and old answered questions.

## Verification
- [ ] Agent App Framework gate (`agent-app <dir> validate`) passes, including the describe budget on a dev instance.
- [ ] Every declared operation answers through `a2app` on a live instance.
- [ ] The View renders identically to the published build (screenshot comparison).
