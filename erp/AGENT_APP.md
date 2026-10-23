# ERP

> Per-project plan, context and index. Keep it current with every change.

## What this app does

One app to run a company of 1 to 5,000 people: sales (quotes, orders,
deliveries, invoices, credit notes), purchasing (orders, goods receipts,
bills, supplier credits), inventory and manufacturing (items, warehouses,
stock changes, reorder, bills of materials, builds), money (payments in and
out, bank accounts with statement import and reconciliation), accounting
(double-entry ledger, chart of accounts, journals, month-end close, fixed
assets, budgets, opening balances), reports (profit and loss, balance sheet,
cash flow, trial balance, general ledger, aging, sales, purchases, stock
valuation, tax, budget against actual), people (directory, org chart, leave,
expense claims, payroll) and projects (tasks board, timesheets, billing time,
profitability).

Easy on the surface: each person sees only what their role and the
switched-on modules allow; Home is shaped by role; the next step is always
one obvious button; advanced fields sit behind "More options". The app has
its own team accounts (members, invited by an administrator) with roles that
grant a level per module (none, view, edit, full).

Your AI agent operates the app through the `agent-app` CLI with the same
operations the screens call, under the same rights checks. It reads and
drafts anything; posting, voiding and money become **proposals** a person
with the right approves (optionally, named low-risk kinds post on their own
under an amount ceiling set in Settings; money never does). The app hands
work back through triggers (read Inbox files, reconcile a bank, draft
reorders, chase overdue invoices, send a document, review the month close,
answer a question). The UI says "your AI agent" and never names a product.

**Start every agent session with `agent-app run <project> app.guide`**: it
returns the conventions, today's date, the base currency, banks, taxes,
modules and ready-to-run recipes.

## Requirements

See `reference/requirements.md` (binding, 44 numbered requirements).

Backend (done, tested):

- [x] Foundations: base currency + foreign documents with rates; integer money (minor units), prices e4, rates e8, tax basis points; double-entry journals (append-only, reversals), lock dates (soft, hard), gapless numbering on post, audit trail
- [x] Members, invites (code shown once, 7 days), lockout (10 wrong passwords, 15 minutes), roles with per-module levels, approval limits, owner protections; setup wizard with 22 country presets
- [x] One document engine for 9 types with flows (quote to order or invoice, order to delivery and invoice, PO to receipt and bill, invoice to credit note), statuses derived from fulfilment, billing, payments and due dates; posting rules incl. COGS at average cost, GRNI clearing with price variance, exact voids
- [x] Payments with allocation (oldest first), credits, realized FX differences, voids that unallocate
- [x] Banks: CSV import with column detection, duplicates skipped, undo; suggestions; match, create payment, book an entry, transfer, ignore
- [x] Accounts, manual journals, reversal, taxes, terms, currencies (live rates), opening balances (accounts, documents, stock)
- [x] Reports (12 kinds) with CSV export; month-end close checklist and close; fixed assets with straight-line depreciation; budgets
- [x] Inventory: items, categories with line icons, warehouses, moving-average valuation equal to the ledger, stock changes (adjust, count, transfer) with exact voids, reorder suggestions to draft POs
- [x] Manufacturing: BOMs, builds that consume components at average cost plus extra cost
- [x] People: departments, employees, org chart, leave types, holidays, requests with working-day counting, balances, approvals; expense claims with receipts, approval, posting, reimbursement; payroll components, runs, payslips, approve, post, pay
- [x] Projects: tasks, weekly timesheets with approval, billing time to a draft invoice, profitability
- [x] Your AI agent: proposals with preview journal lines and reasons, autonomy settings, Inbox, questions, field marks, requests from the app (`agent.request`), triggers
- [x] Home summary and "Needs you" counts shaped by role; global search

Frontend (see `frontend/src/app`):

- [x] Frame: sidebar with modules as trees (chevron, inline "+"), fold to rail, phone bottom bar with raised "+" and menu sheet; search palette (Ctrl K, "/"); "New" full screen (circular reveal); sign-in, invite code, first-run setup
- [x] Home (role-shaped: cash, owed both ways, sales, profit, overdue, bills due, pipeline, stock, projects, you, your AI agent with a question box, setup checklist) and Needs you (decide in place)
- [x] Sales and purchasing: one list for all 9 document types (summary cards, chips with counts, search, party and date filters, bulk reminders), the document page (paper view, draft edited in place, one next-step button, convert, post and void with the journal previewed, flow chain, payments, proposals, activity), the new-document flow in three numbered steps, customers and suppliers, the party page (aging ring, statement, contacts)
- [x] Money and books: payments with the full-screen "Record a payment", bank accounts, the bank page (statement import with column detection, reconcile with one-tap suggestions, book, transfer, ignore, undo imports), chart of accounts, account ledger, journals (balanced entry grid), month-end close, fixed assets, budgets, the report gallery and one report page for every report (presets, comparison, chart, drill-down, CSV, print)
- [x] Inventory and manufacturing: items (cards or list, item editor with photo and category icons), item page (stock chart, movements), stock on hand, stock changes (full-screen change screen), reorder by supplier, warehouses, bills of materials, builds
- [x] People and projects: directory, employee page, org chart, leave (balances, requests, team approvals, calendar, settings), expense claims (receipt photos, approvals, post and pay), payroll (runs, payslips, components), projects (cards, task board with drag and drop, time, money, billing time), weekly timesheets with approvals
- [x] Your AI agent: proposals (approve or reject with the exact journal lines), Inbox (drop files), questions, what it did; Settings (company, modules, team and invites, roles matrix, numbering, taxes, terms, currencies, default accounts, autonomy, lock dates, opening balances, import and export, audit trail) and your profile

## Entities

Money is an integer of the currency's minor unit (cents). Unit prices and
costs are integers of 1/10000 (`*_e4`); exchange rates 1/10^8 (`fx_e8`); tax
rates basis points (`rate_bp`, 900 = 9%). Quantities have at most 3 decimals.
Days are `YYYY-MM-DD` text. Every collection's API rules are null: nothing
reads or writes records directly; everything goes through `/api/ops/*`, which
checks rights (record hooks also refuse direct API writes, even a superuser's).

| Group | Collections |
|-------|-------------|
| Company and people | `settings` (one row: company, modules, numbering, defaults, agent autonomy, locks), `counters` (numbering series), `roles`, `members` (auth collection: the app's accounts), `audit`, `notes`, `attachments`, `field_marks`, `departments`, `employees` |
| Books | `accounts` (code, type, subtype, `system_key`, `control`), `journals` (append-only; `reverses`/`reversed_by`), `journal_lines` (base debit/credit, currency amount, party, doc, department, project), `ledger_months` (balance cache per account and month), `payment_terms`, `currencies` (`rate_e8`), `taxes` |
| Trade | `parties` (customers and suppliers), `contacts`, `documents` (9 types, `state`, totals, `balance`, `fulfil_status`, `bill_status`, `source`), `document_lines` (`qty_fulfilled`, `qty_invoiced`, `recv_value`, `cleared_value`, `cost_value`, `source_line`) |
| Stock | `item_categories`, `warehouses`, `items`, `valuation` (running qty and value per item: the moving average), `stock` (qty per item and warehouse), `stock_changes`, `stock_moves` (the stock ledger) |
| Money | `banks` (each with its own ledger account), `payments` (`planned` allocations for drafts), `allocations`, `imports`, `bank_lines` (unique `dedupe` per bank) |
| Your AI agent | `inbox`, `proposals`, `asks`, plus the platform's `agent_requests` queue |
| People | `leave_types`, `holidays`, `leave_requests`, `leave_adjustments`, `expense_claims`, `claim_lines`, `pay_components`, `employee_components`, `payroll_runs`, `payslips`, `timesheets` |
| Projects and making | `projects`, `project_tasks`, `boms`, `bom_lines`, `builds`, `assets`, `budgets` |

Schema: `pb/pb_migrations/1700000100_erp_schema.js`; seed (settings row,
built-in roles, payment terms, platform log, proxy and rate-limit settings):
`1700000200_erp_seed.js`. Setup (chart of accounts template, banks, taxes,
warehouse, categories, leave types, owner): `lib_setup.js`.

## Operations

301 operations in `operations.json` (`agent-app ops <project>`),
generated from the catalog: `pb/pb_hooks/cat_system.js`, `cat_sales.js`,
`cat_stock.js`, `cat_money.js`, `cat_books.js`, `cat_people.js`,
`cat_work.js`, `cat_agent.js`. Each entry names its handler (`lib_x.fn`),
method, rights (`perm`: public, self, admin, `module:level`, `a:full|b:full`
for any of, `doc:level`, `pay:level`), agent rule (`deny`, `propose` with a
`preview` handler, `allow`) and typed params. **After any catalog change run
`node tools/gen.mjs`**: it validates the catalog (handlers exist, params are
typed, `why` is reserved on proposals) and writes `pb/pb_hooks/routes.pb.js`,
`operations.json` and `frontend/src/app/lib/ops.gen.ts`.

`lib_ops.js` dispatches every route: reads raw params (query, JSON, or
multipart), authenticates (`lib_auth.context`: the agent by its token, a
person by their member session token), validates params against the spec
(unknown params refused; `''` clears a string field), runs the handler or
turns an agent call into a proposal (`lib_agent.proposeOrRun`; the agent's
explanation is the reserved `why` param), and flushes the live-update bus.

## Agent triggers

| Trigger | Fired when | What the agent does |
|---------|------------|--------------------|
| `inbox_waiting` | A file is added to the Inbox (and a minute cron re-asks when a fire was refused or lost) | Reads each file; bills become draft bills (or bills converted from the matching PO) proposed for posting; statements are imported; `inbox.complete` / `inbox.fail` |
| `bank_lines_waiting` (`bank_id`) | A statement import adds lines; "Ask your AI agent" on a bank | Matches certain lines, proposes payments, entries and transfers for the rest |
| `question_asked` (`ask_id`) | A person asks a question in the app | Answers with read operations only, within the asker's rights |
| `reorder_review` | "Draft orders" on Reorder or Home | `reorder.create-orders` drafts one PO per supplier; never confirms |
| `collections_requested` | "Ask your AI agent to chase" on overdue invoices | Emails polite reminders with the user's email account, or leaves them as notes |
| `doc_send_requested` (`doc_id`) | "Send by your AI agent" on a document | Emails `docs.text` to the party, then `docs.mark-sent` |
| `close_review_requested` (`month`) | "Ask your AI agent" on Month-end close | Works the checklist, proposes what is missing, never closes |

Screens ask through `agent.request`, which checks the person's rights for
that kind of work and fires the trigger server-side (`_triggers_lib.fire`);
they follow progress by reading the platform's request queue (realtime). App
hooks never read or write that queue (the platform gate enforces it).

## External data

| Source | Used for | Auth | Called from |
|--------|----------|------|-------------|
| Frankfurter (api.frankfurter.dev), then the currency-api mirror (cdn.jsdelivr.net) | Exchange rates on "Get today's rates" | none | `lib_accounts.refreshRates` via `$http.send` with a timeout; failures leave the stored rates |

## Background jobs

- `erp_inbox` (every minute): re-asks your AI agent about waiting Inbox files only when an ask is outstanding (in-memory flag), and flushes live updates.
- `erp_hourly` (minute 13): scheduled work (`lib_jobs.hourly`).
- Both skip a round when `$app` is transactional (PocketBase points a pooled runtime's `$app` at a record hook's transaction; a stale one fails every query).

## Gotchas

- Hooks do not hot-reload (`--hooksWatch=false`): restart the app after any hook change.
- `require` modules inside each handler; only use `tx` inside `runInTransaction`.
- `util.rows` returns PocketBase host objects: you may assign only fields declared in the shape (`Object.assign(row, { extra })` throws "Cannot assign to property ... of a host object"); map to plain objects to add fields.
- SQL aggregates return NULL on no rows: wrap in `IFNULL(..., 0)`; text from LEFT JOINs too. A seeded database hides the mistake (the customer counts failed only until the first customer existed), so check every page on an empty company that has only finished setup, too.
- A view that shows a skeleton while its data is null must also check its error: summaries and shortcuts step aside (the page's main list shows the error), panels say they did not load. Otherwise a failed load shimmers forever.
- List pages the sidebar offers to some roles only (`LISTED` in `lib/nav.ts`) open only for members whose sidebar offers them; anyone else (an old or shared link) sees "This page is not part of your role". Detail pages check the record themselves.
- Unique indexes (names, codes, SKUs) are checked in the handlers first so people read "There is already a category called X" instead of PocketBase's raw message.
- PocketBase dev mode echoes every SQL statement to the log; `hooks.pb.js` switches the echo off at boot. Logs keep 14 days at level 4.
- Live updates: no record is ever streamed. After each operation `lib_bus.flush` sends one message on the custom realtime topic `erp` naming the changed collections; `frontend/src/app/lib/live.ts` subscribes once at startup and reloads the views that read them (debounced, paused while the tab is hidden).
- Sessions: `members` tokens (30 days) ride as the Authorization header; the page renews every 12 hours of use. Signing out forgets the token in that browser; "sign out everywhere" (members.signout) rotates the member's token key.
- Colors: `frontend/src/app/lib/themeColors.ts` derives every `--erp-*` token from the host theme with contrast checks (all 16 packs, light and dark, 37 pairings each including the dark-card chart colors: 1,184 checked, 0 below minimum). Only the state colors are fixed. Never hardcode a color in components.
- Numbers on screen read "1,234.50" whatever the browser language (`lib/format.ts`).
- Pages load on first visit (`frontend/src/app/routes.tsx`, one chunk per page).
- Scratch instances for testing must create a superuser before `serve`, or PocketBase opens its installer page in the browser.
- Planner statistics: `hooks.pb.js` runs a sampled `ANALYZE` at boot and `PRAGMA optimize` hourly. Without them SQLite chose a per-party scan that made the customer list take 30 s at 2,000 customers; with them every list and report measured 15 to 160 ms on a load test (5,000 employees, 2,300 parties, 400 items, 4,000 invoices with payments, 1,000 bills); Home is about 250 ms.
- PocketBase's `require()` costs about 2 ms per call in this engine: libraries load the modules they need once, never inside per-row loops.
- Pages remount only when `page`, `id`, `kind`, `type` or `new` change in the address; filters, tabs and searches update in place (`replaceQuery` also replaces the Back trail entry).
- Every operation response carries `Server-Timing: op;dur=<ms>`.
- Transfer (`hooks.pb.js`): the hashed files under `/assets/` are sent with `Cache-Control: public, max-age=31536000, immutable`, and they and every `/api/ops/` answer go gzip-compressed (main script 463 KB to 143 KB). The page itself stays `no-store` (platform `_system.pb.js`), which is how open tabs notice a new build. CraftBot's LAN relay and share tunnel pass compressed bodies through untouched (`auto_decompress=False`). No Redis: one PocketBase process on one SQLite file, with month totals kept in `ledger_months`, answers every list and report in 15 to 160 ms at 5,000 people; a separate cache server would only add a hop.
- Agent safety (2026-10-21 review):
  - **Proposals stay what was shown.** A proposal stores its target's `updated` (documents, journals, stock changes, payments, builds, pay runs, claims). Approval refuses with `stale_proposal` when the record changed since, and checks the approval limit against the larger of the proposed and the current amount (`lib_agent.approve`).
  - **Retries and deletions.** A retry returns the waiting proposal (`already_waiting`). Deleting a draft closes its waiting proposals in the same transaction (`hooks.pb.js` onRecordDelete).
  - **Deletions the agent runs itself** need `--confirm true`; without it the answer says what would go. `confirm` is reserved like `why` (tools/gen.mjs, lib_catalog), gated in `lib_ops.run`.
  - **Every object inside a JSON list** is checked with `util.keysOnly`: an unknown key is refused with the closest allowed one. A new list reader must call it.
  - **Money input** (`lib_money.toMinor`): never more decimals than the currency, and a currency code in front must match. Thousands separators are fine.
  - **Not found and refusals.** A "not found" names up to three close records (`lib_core.closest`). Refusals of the agent say what to do instead.
  - **Agent answers** carry a `units` note on how to read money integers (`lib_ops.unitsNote`). Screens never get it.
  - **Duplicate names.** `parties.add` from the agent refuses a name already in use unless `same_name` is true.
- Security (2026-10-21 audit):
  - **Local files.** A local `--path` file is agent-only (`util.localFile`). Inside the app folder only `pb_data/storage` (uploads) may be read; never the token, `.superuser` or the database.
  - **CSV exports** prefix text cells starting with `= + - @` with an apostrophe (`lib_csv.toCsv`), and `parseRows` strips it on import.
  - **Server faults** (5xx) answer with a fixed message; the details go to the log only.
  - **Sign-in** gives one answer for an unknown email, a pending invite and a wrong password. A disabled account is named only after the right password.
  - **Rate limits.** Login limits are per address. CraftBot's LAN relay drops visitor-sent address headers (`app/agent_app/sharing.py` CLIENT_ADDRESS_HEADERS), so `Cf-Connecting-Ip` cannot be spoofed through it.
- Layout follows the space a page gets, not the window (2026-10-21). The app runs beside a 264px sidebar, in CraftBot's narrow side panel and on phones, so window breakpoints laid out cramped columns.
  - **Size containers:** `<main>`, every `Card`, dialog boxes, full screens and the search palette are size containers (`@container`). Pages and components use container variants: `@min-[480px]:` (was `sm:`), `@min-[640px]:` (`md:`), `@min-[900px]:` (`lg:`), `@min-[1100px]:` (`xl:`), `@min-[1300px]:` (`2xl:`).
  - **Window breakpoints** remain only in the frame: `Shell`, the sign-in screens, fixed phone bars and the padding that clears them, and the new-document page's desktop buttons that pair with its phone bar.
  - **Tables:** `DataTable` measures itself. It drops optional columns (`hide`, the most optional first) until every column has its minimum width; flexible columns never shrink below their floor. Below 520px, or when the columns still don't fit, rows become cards.
  - **Scroll boxes:** every sideways-scrolling box is `relative`, so an absolutely positioned child can't widen the page.
  - **Self-measuring drawings** (charts, the donut, the table) use `[contain:inline-size]` and measure before paint; otherwise they lock at their first guess inside a grid slot.
  - **Sticky:** a sticky card must be last in its column (`TotalsCard sticky` only where it stands alone), or the cards after it scroll over it.
  - **Badges** (`ActorPill`) stay on one line and shorten with "…".
  - **Checks:** `layout_check.mjs` in the session scratchpad covers every page at 390/600/768/900/1024/1280/1440, scrolled top, middle and bottom.
- Live updates (2026-10-21):
  - **Covered:** every list and record page follows changes made elsewhere (`live_matrix.mjs`: 26 scenarios, including across a server restart).
  - **Unsaved draft:** a draft with unsaved edits does not reload under the person. It shows "changed elsewhere" with "Load the new version", and saving keeps theirs.
  - **Session:** it refreshes when `settings` or `roles` change (modules, rights), but not on `members`, which changes at every sign-in.
- Popovers (`components/ui.tsx`) draw in the page's top layer (inside the open dialog when the trigger is in one), placed from the trigger's box: table scroll areas, frozen columns and the sidebar's scroll area never clip them. The trigger's wrapper is the anchor; `side="right"` opens beside it.

## Ownership map

- Editable: `frontend/src/app/`, `pb/pb_migrations/` (new files only), `pb/pb_hooks/*.pb.js`, `lib_*.js` and `cat_*.js` (not the `_*.js` system files), `tools/`, `operations.json` and `routes.pb.js` (generated by `tools/gen.mjs`), `triggers.json`, this file, `reference/`.
- System-managed (never edit): `frontend/src/kit/`, `frontend/src/main.tsx`, `frontend/src/config.gen.ts`, the underscore hooks (`pb/pb_hooks/_*.js`), `manifest.json`.
