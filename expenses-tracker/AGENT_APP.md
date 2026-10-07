# Expenses tracker

> Per-project plan, context and index. Keep it current with every change.

## What this app does

A personal expense tracker for one person with one home currency. Home is a
dashboard (spending ring, daily bars, dark calendar, budget gauge, pace,
recent expenses); the "+" grows into a full-screen entry of three numbered
steps (amount on a keypad, category, details and Save) where only the amount
is required. The full list, insights, budgets, recurring
payments, receipts, CSV import and export, categories and settings sit on
the left icon rail (a bottom bar on phones). No emoji anywhere: categories
wear line icons from a fixed set (`pb_hooks/lib_icons.js`, mirrored in
`frontend/src/app/lib/icons.tsx`).

An AI agent operates the app through the `agent-app` CLI with the same
operations the UI calls, and the app hands work back to the agent through two
triggers (read uploaded receipts, categorize uncategorized expenses). The app
names no particular agent: the UI says "your AI agent", and what the agent
adds is marked `agent`.

**Start every agent session with `agent-app run <project> app.guide`**: it
returns the conventions, today's date, the home currency, the category names
and ready-to-run recipes (receipt image, bank CSV, summaries, fixes).

## Requirements

See `reference/requirements.md` (binding). Feature checklist:

- [x] Dashboard: spending ring (Nexora-style segmented ring, labels on the band, icon chips in the gap) with legend, daily bars under it, dark spending calendar with month switch, budget gauge, pace against last month, recent expenses
- [x] "+" opens a full-screen entry (circular reveal) in three numbered steps (1 amount: keypad and keyboard; 2 category tiles; 3 note, day with an in-app day picker, receipt, other currency, Save); Undo pill after saving
- [x] Scan receipt from Home or the entry header (no amount typed: the AI agent reads it) or attach a receipt (amount typed)
- [x] Month overview on Home: total, comparison with last month by the same day, budget left, daily bars, top categories, recent
- [x] First-open currency question (no sample data)
- [x] Expenses page: month switcher, search across months, category filter, day groups with totals, edit dialog, select mode with bulk category and delete
- [x] Ask the AI agent to sort uncategorized expenses (trigger)
- [x] Insights: month stats, by category (with budget meters), last 12 months, biggest expenses
- [x] Budgets: whole month and per category
- [x] Recurring expenses (weekly, monthly, yearly) that add themselves, with catch-up
- [x] Categories: cards; editor with name, line-icon picker, delete with move-to
- [x] Receipts page: upload many, status (waiting, reading, added, could not be read), type it in, try again, delete
- [x] CSV import with preview, data-derived column and format detection, duplicate skipping, undo; CSV export by range
- [x] Expenses in other currencies converted at the day's rate (ECB via Frankfurter, else currency-api; original kept)
- [x] Every UI action has a CLI operation

## Entities

Money is an integer count of the home currency's minor unit (cents for USD,
yen for JPY); never a float. Days are `YYYY-MM-DD` text.

| Collection | Purpose | Notes |
|------------|---------|-------|
| settings | One row: `currency` (ISO), `currency_confirmed`, `monthly_budget` (minor) | Seeded USD, unconfirmed |
| categories | `name` (unique, case-insensitive), `icon` (one of the fixed line icons), `budget` (minor, 0 = none), `sort` | 12 seeded; icons since migration 1700000300 |
| expenses | `amount` (minor, > 0), `date`, `note`, `category`, `source` (app, agent, receipt, csv, recurring), `receipt`, `import`, `recurring`, `original_amount`/`original_currency`/`fx_rate`, `dedupe_key` | Record hooks validate every write and derive `dedupe_key` |
| receipts | `file` (image or PDF), `status` (waiting, reading, done, failed), `error`, `added_by` (app, agent; migration 1700000400) | The expense links to it via `expenses.receipt` |
| recurring | `note`, `amount`, `category`, `cadence`, `start_date`, `next_date`, `count_added`, `active` | Occurrence n is computed from `start_date` |
| imports | `file` (the CSV), `filename`, `status` (previewed, imported, undone), `rows`, `added`, `skipped`, `mapping` | Expenses link via `expenses.import` |

## Operations

40 operations in `operations.json` (`agent-app ops <project>`). Groups:
`app.guide`; `settings.*`; `summary.month`, `summary.trend`;
`expenses.list|get|add|add-many|update|delete|delete-many|set-category|attach-receipt|remove-receipt`;
`categories.list|add|update|delete`;
`receipts.list|get|add|start|complete|fail|retry|delete`;
`import.preview|run|list|undo`; `export.csv`;
`recurring.list|add|update|delete|run-due`; `fx.rate`.

Routes live in `pb/pb_hooks/ops.pb.js` and `ops_more.pb.js`; logic in the
`lib_*.js` modules (required inside each handler).

## Agent triggers

| Trigger | Fired when | What the agent does |
|---------|------------|--------------------|
| `receipts_waiting` | A receipt is uploaded with status waiting (hook), or retried; a minute cron re-asks when a fire was refused by the cooldown or lost to a restart | Reads every waiting receipt and records it with `receipts.complete`, or `receipts.fail` with a reason |
| `categorize_requested` | The user presses "Ask your AI agent to sort them" on the Expenses page | Puts uncategorized expenses into existing categories with `expenses.set-category` |

## External data

| Source | Used for | Auth | Called from |
|--------|----------|------|-------------|
| Frankfurter (`api.frankfurter.dev`, ECB reference rates) | Converting an expense paid in another currency on its day (asked first, and once more last) | None (keyless) | `lib_fx.js` |
| currency-api (`cdn.jsdelivr.net/npm/@fawazahmed0/currency-api`) | The same, when Frankfurter does not answer or lacks the currency (TWD and 170+ others; dated history from 2024-03-02) | None (keyless) | `lib_fx.js` |

## Background jobs

- `et_receipts` (every minute): asks the agent about waiting receipts only when an ask is outstanding (in-memory flag; no blind polling).
- `et_recurring` (hourly at :07) and `et_recurring_boot` (once after start): add due recurring expenses.

## Gotchas

- Hooks do not hot-reload (`--hooksWatch=false`): restart the app after any hook change.
- `getString('mapping')` reads the imports json field; never parse a raw byte slice.
- Receipts `file_path` is absolute so the agent can read the file from disk.
- The UI subscribes to all collections once at startup (`lib/live.ts`): the SDK drops subscriptions made while its first connection is being set up.
- The base font size sits on `body` only; putting it on `html` shrinks every rem-based size.
- An open page keeps the code it loaded; `lib/live.ts` compares its app script with the one the server serves (on every realtime reconnect after the first, and when the tab becomes visible) and reloads when they differ, waiting while any `[role="dialog"]` is open.
- Numbers on screen always read "1,234.50" (`NUMBER_LOCALE` in `lib/money.ts`), whatever the browser language: "," separates thousands and "." is the decimal point the keypad types. Typing "," in the entry screen adds nothing; `normalizeAmount` accepts commas only between thousands, so "12,50" is rejected, never misread.
- Api.frankfurter.dev is intermittently unreachable from some networks (requests hang to the timeout). `lib_fx.rate` asks Frankfurter, then currency-api, then Frankfurter again, 6 s each; the entry-screen preview is a quiet call that shows a failure in place. Op errors carry an `agentHint` (the `rate=` param) that `lib_util.handle` adds only for agent calls.
- Colors: `lib/themeColors.ts` reads what the kit theme tokens (`--agent-app-bg/surface/text/muted/border/accent/accent-contrast`) resolve to and writes every `--et-*` color on `<html>`, again on each theme change. It checks each pairing: some packs use the text color as the accent (ink, atelier, drafting) or the background as the surface (ink, brutalist, drafting, clay), so the accent, cards, ring colors and muted text fall back to theme colors that contrast. Dark cards, ink pills and sand cards carry the scope classes `et-on-dark`, `et-on-ink`, `et-on-sand` (and `et-on-card` for a light panel inside them), which switch `--et-accent`, `--et-on-accent` and `--et-muted` to the variant made for that background. Never hardcode a hex color in components; never override `--agent-app-*` colors. Font and radius are the app's own, set on `html:root[data-theme=...]` to out-rank the kit defaults.
- Fixed-width elements must fit 320 px (the ring measures its container); an overflow makes phones zoom out and misplaces the floating bar.

## Ownership map

- Editable: `frontend/src/app/`, `pb/pb_migrations/` (new files only), `pb/pb_hooks/*.pb.js` and `lib_*.js` (not the `_*.js` system files), `operations.json` (non-system entries), `triggers.json`, this file, `reference/`.
- System-managed (never edit): `frontend/src/kit/`, `frontend/src/main.tsx`, `frontend/src/config.gen.ts`, the underscore hooks (`pb/pb_hooks/_*.js`), `manifest.json`.
