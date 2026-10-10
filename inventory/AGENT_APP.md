# Inventory

> Per-project plan, context and index. Keep it current with every change.

## What this app does

Inventory for a small team's stockroom: what is in stock, where it is kept,
and when to reorder. Home opens with the stockroom map: the places and their
stock as a 3D isometric model to move around, zoom and work in (click a place
or a box for its panel, drag a box onto another place to move it, arrange
mode moves and resizes any place to match the real space). Below it, a dashboard (stock health ring, stock value,
what needs attention, 30 days of stock in and out, incoming orders, most
used, where stock is kept, recent activity). The "+" grows into a full-screen
stock change in three numbered steps (item, how many on a keypad, where and
why) with Undo after saving; "New item" grows into a three-step item editor.
Items, locations (a tree), scanning, reordering, purchase orders, stock
counts, activity, suppliers, labels, import and export, and settings sit on
the left icon rail (a bottom bar on phones). No emoji anywhere: categories
wear line icons from a fixed set (`pb_hooks/lib_icons.js`, mirrored in
`frontend/src/app/lib/icons.tsx`).

Barcode scanners that type like a keyboard (USB or Bluetooth) work
everywhere: on the Scan page, in counts, in the stock change and item
screens, and anywhere else a scan opens what it belongs to. No camera or
other browser permission is used. Labels (Code 128 or QR) print on label
rolls or office label sheets.

An AI agent operates the app through the `agent-app` CLI with the same
operations the UI calls, and the app hands work back to the agent through
three triggers (draft reorders, read packing slips and invoices, email a
purchase order). The app names no particular agent: the UI says "your AI
agent", and what the agent records is marked `agent`.

**Start every agent session with `agent-app run <project> app.guide`**: it
returns the conventions, today's date, the currency, the locations with their
codes, the categories, the reasons per kind of change, and ready-to-run
recipes (deliveries, reorders, counts, imports, history).

## Requirements

See `reference/requirements.md` (binding). Feature checklist:

- [x] Home: stock health ring (in stock, low, out, over; legend; shortcuts in the gap), stock value with items to reorder and idle stock, needs attention with level bars, stock in and out over 30 days, coming in, most used, where it is (value by place), recent activity with Undo, first-time setup checklist
- [x] Stock change screen (circular reveal): item (search or scan), In / Out / Move / Set on a keypad, place and reason, cost on receipts, note; Undo pill
- [x] Item editor (circular reveal): photo, name, category tiles, unit, part units; SKU (automatic when empty), barcodes (scan to add), opening stock and place or home place; reorder point, target level, supplier, cost, lead time, description; archive and delete
- [x] Items: search (a scanned code opens its item), status chips with counts, category, place, sort, archived; cards or list; quick In and Out; infinite scroll; select mode with category, labels, archive, delete
- [x] Item page: on hand with In / Out / Move / Set, incoming, reorder point, target, days left, worth; stock level chart with the reorder line; where it is (move from a place); reorder card with a one-step draft order; codes and label; history with Undo
- [x] Locations: tree with expand and "+" on each row; detail with items, units, value, the places inside, what is stored (out and move per row), count here, label, edit, delete (empty places only)
- [x] Scan page: look up, receive, take out, move; place by scanning its label; each scan counts N; one list recorded as one change; unknown codes become a new item or are added to one; scan sounds
- [x] Reorder: suggestions per supplier with editable quantities and a plain-words why; draft orders per supplier; ask the AI agent; automatic agent drafts when something runs low (setting)
- [x] Purchase orders: status chips; order page with editable lines (quantity, cost), mark as ordered (expected date from lead time), receive in full or in part to a place, close short, cancel, back to draft, reopen, delete, order as text, email it through the AI agent; receipts history with Undo; documents panel (packing slips and invoices for the AI agent)
- [x] Stock counts: start for a place (and inside) or everything, blind option; scan to count, type counts, matches button, found something else, filters; review differences with value; complete (uncounted kept or zero); reopen undoes it; cancel; delete
- [x] Activity: every change grouped by action and day, filters (kind, who, place, item, dates, one change), Undo, delete from history, CSV export
- [x] Suppliers: cards; editor with contact, delivery days, notes, items supplied, latest orders; delete
- [x] Labels: items or places, roll sizes and A4 / Letter sheets, barcode or QR, name on or off, copies, live preview, print
- [x] Import (CSV with column mapping, set or add quantities, create missing categories, suppliers and places, row problems, undo) and export (items, stock by place, history)
- [x] Settings: currency, negative stock, automatic agent drafts, categories with line-icon picker
- [x] Every UI action has a CLI operation

## Entities

Quantities are never typed into a record. `movements` is the ledger; `stock`
keeps the balance per item and place and is written in the same transaction.
Unit costs are integers of 1/10000 of the currency unit (a screw at $0.034
keeps its price). Quantities are numbers rounded to 3 decimals (whole units
unless the item is `fractional`). Days are `YYYY-MM-DD` text.

| Collection | Purpose | Notes |
|------------|---------|-------|
| settings | One row: `currency`, `currency_confirmed`, `allow_negative`, `auto_restock`, `restock_sig` (items last asked about), `restock_asked_on` | Seeded USD; changes only through `settings.update` |
| categories | `name` (unique, case-insensitive), `icon` (fixed line icons), `sort` | 8 seeded |
| locations | `name`, `code` (unique scannable code, automatic LOC-001...), `kind` (site, room, area, container, vehicle, rack, shelf, cabinet, fridge, drawer, pallet, bin, box, other), `parent` (self relation), `notes`, `sort`, `map` (any place: `{x, z, w, d}` on the Home map in map units of about a metre, kept to the centimetre; x, z the centre, on the floor for a top-level place, from the far corner (min x, min z) of its parent for a place inside another; w, d the size, null for automatic; empty for the automatic layout) | One seeded ("Main stockroom", LOC-001). No cycles, 8 levels; places nest by size (`HOLDS` in `lib_locations.js`, mirrored as `PLACE_HOLDS` in `lib/icons.tsx`); refused to delete while holding stock or when a place inside would not fit one level up; a place whose parent changes (moved, or its parent deleted) loses its map layout |
| suppliers | `name` (unique), `contact`, `email`, `phone`, `website`, `lead_time_days`, `notes` | |
| items | `name`, `sku` (unique scannable code, automatic SKU-0001...), `category`, `unit`, `fractional`, `photo`, `description`, `min_qty` (reorder point), `max_qty` (target level), `unit_cost` (1/10000, moving average), `supplier`, `lead_time_days`, `default_location` (home), `archived` | Record hooks check every write |
| codes | Extra barcodes: `code` (unique), `item` | No code may equal another item's SKU or barcode or a location code |
| stock | `item`, `location`, `qty` (balance) | Ledger only (API writes refused) |
| movements | `item`, `location`, `qty` (signed), `kind` (in, out, move, adjust, count), `reason`, `batch` (one action), `ref_type`/`ref` (order, count, import, document), `po_line`, `unit_cost`, `balance` (after), `actor` (you, agent, system), `note`, `reverses` (the batch it undoes) | Ledger only |
| orders | `number` (PO-0001), `supplier`, `location` (deliver to), `status` (draft, ordered, partial, received, cancelled), `expected_on`, `ordered_on`, `received_on`, `closed_short`, `note`, `origin` (you, agent, reorder), `agent_note` | Operations only; status follows the ledger |
| order_lines | `po`, `item`, `qty`, `received` (derived from movements tagged with the line), `unit_cost`, `sort` | Operations only |
| counts | `number` (C-0001), `location` (empty: everything), `include_sub`, `status` (counting, completed, cancelled), `blind`, `note`, `completed_on`, `batch`, `summary` | Operations only; completed while its batch stands in the history |
| count_lines | `session`, `item`, `location`, `expected` (snapshot), `counted`, `counted_set` | Operations only |
| documents | `file` (image or PDF), `status` (waiting, reading, done, failed), `summary`, `error`, `po`, `batch`, `added_by` | Operations only |
| imports | `file` (CSV), `filename`, `status` (previewed, imported, undone), `rows`, `added`, `changed`, `skipped`, `mapping`, `result` (what to undo) | Operations only |

## Operations

84 operations in `operations.json` (`agent-app ops <project>`). Groups:
`app.guide`; `settings.get|update`; `dashboard.summary`; `map.get`; `lookup.code`;
`categories.list|add|update|delete`; `locations.list|get|add|update|place|arrange|delete`;
`suppliers.list|get|add|update|delete`;
`items.list|get|add|update|delete|delete-many|set-category|set-archived|add-barcode|remove-barcode`;
`stock.in|out|move|set|batch`; `movements.list|undo|delete`;
`reorder.list|create-orders`;
`orders.list|get|text|create|update|add-line|update-line|remove-line|mark-ordered|back-to-draft|receive|close|cancel|reopen|delete`;
`counts.list|get|start|set-line|scan|add-item|remove-line|complete|cancel|reopen|delete`;
`documents.list|add|start|complete|fail|retry|delete`;
`import.preview|run|list|undo|delete`; `export.items|stock|movements|template`.

Routes live in `pb/pb_hooks/ops.pb.js` (guide, settings, overview, map,
lookup, categories, locations, suppliers), `ops_stock.pb.js` (items, barcodes, stock,
history), `ops_buy.pb.js` (reorder, orders, documents) and `ops_counts.pb.js`
(counts, import, export); logic in the `lib_*.js` modules (required inside
each handler). `lib_ledger.js` is the only place quantities change.

## Agent triggers

| Trigger | Fired when | What the agent does |
|---------|------------|--------------------|
| `restock_review` | "Ask your AI agent to draft them" on Reorder or Home; and, with automatic drafts on, whenever an item newly needs reordering (a minute cron after stock, items, orders or settings change, and once after start; an ask refused by the cooldown is retried) | Checks `reorder.list` and drafts one order per supplier with `reorder.create-orders` and a note; never orders or emails |
| `documents_waiting` | A packing slip or invoice is added (hook) or retried; a minute cron re-asks when a fire was refused by the cooldown or lost to a restart | Reads each document, receives it on its order (`orders.receive`) or as stock (`stock.batch`), then `documents.complete` with a summary, or `documents.fail` with a reason |
| `order_send_requested` | "Email it with your AI agent" on a draft order whose supplier has an email | Sends `orders.text` to the supplier through the user's email account, then `orders.mark-ordered` |

## External data

None. Everything the app knows is typed, scanned, imported, or recorded by
the AI agent.

## Background jobs

- `inv_documents` (every minute): asks the agent about waiting documents only when an ask is outstanding (in-memory flag; no blind polling).
- `inv_restock` (every minute, only after stock, items, orders or settings changed, and once after a start): with automatic drafts on, asks the agent when an item newly needs reordering; an ask refused by the trigger cooldown is retried on the next minute.

## Gotchas

- Hooks do not hot-reload (`--hooksWatch=false`): restart the app after any hook change.
- Hook callbacks run in isolated VMs: shared code lives in `lib_*.js` and is required inside each callback (top-level functions in `*.pb.js` are invisible to callbacks).
- Errors thrown by record hooks (BadRequestError) reach the op handler as Go errors; `lib_util.handle` keeps their 4xx status (`err.value.status`).
- SQL aggregates return NULL on no rows: every `SUM`/`MAX` is wrapped in `IFNULL(..., 0)` (a NULL into an int column fails the scan).
- Undo posts a batch's lines in reverse order (last change first), so an in-then-out batch can be undone without going below zero.
- `lookup.code` answers `type: none` for a code nothing has (not a 404), so scanning unknown codes logs no errors.
- The UI subscribes to all collections once at startup (`lib/live.ts`): the SDK drops subscriptions made while its first connection is being set up. An open page reloads itself when the served app script changes (checked on realtime reconnects and when the tab becomes visible).
- Back buttons follow the app's own trail of pages (`lib/router.ts`); `history.back()` could leave the app inside the host's frame.
- Scans: `lib/scanner.ts` tells a scanner's burst (4+ characters, under 40 ms apart, ended by Enter or Tab or a pause) from typing. Keys typed into a text field stay with that field; elsewhere the most recently mounted listener gets the scan (a full screen over a page, a page over the app-wide lookup). The stock change keypad takes back digits a scan typed into it.
- Colors: `lib/themeColors.ts` derives every `--iv-*` color from the kit theme tokens with contrast checks and re-derives on every theme change. Only the stock state colors are fixed (green in stock, amber low, red out), with derived text variants. Label previews use `--iv-paper` / `--iv-paper-ink` (labels print black on white). Never hardcode a hex color in components; never override `--agent-app-*` colors.
- Printing: `pages/Labels.tsx` renders the labels into a `.iv-print-only` element (shown only in print) with an `@page` size for the roll or sheet.
- Numbers on screen always read "1,234.50" (`NUMBER_LOCALE` in `lib/format.ts`); typed numbers accept commas only between thousands.
- Places nest by size. `lib_locations.js` `HOLDS` says what each kind can hold; `checkRecord` refuses a place that does not fit its parent, and a kind change that would no longer hold what is inside; deleting a place is blocked when a place inside would not fit one level up; `newPathKinds` picks fitting kinds when an import creates a path. Keep `PLACE_HOLDS` in `lib/icons.tsx` the same (the place form uses it to offer only fitting kinds and parents).
- The stockroom map (`components/map/`): `layout.ts` turns `map.get` into bases (warehouse, room, area, container, van, or a plinth for furniture standing on its own), units drawn by kind (`modelOf`) and item spots; places deeper than the second level count toward the unit that holds them. `models.ts` builds the meshes; `shapes.ts` picks an item's look from its unit, then its category icon (`shapeFor`). `engine.ts` (three.js, loaded on its own) keeps one fixed isometric view (pan and zoom only), draws items as instanced parts, draws only when something changes, so an idle Home costs nothing; it takes every color from the theme (`--iv-floor` is the base color, kept off the stage) and reports clicks, drops and moves to `StockMap.tsx`, which owns selection, filters and arrange mode. A dropped box opens the stock change screen with the item and both places filled in; nothing moves until it is saved; a carried box stands on whatever is under the pointer, centred on it. Arrange mode picks any place (a base, or a unit inside a space; loose stock and furniture on its own pick the place they stand for; a label picks its own place), drags it within the space it stands in (`boundsOf`, the space's `inner` floor) and resizes it by four DOM corner handles (`limitsFor`: furniture down to its `minW`/`minD`, a space down to what stands in it, inside a space no further than its walls); furniture on its own is resized itself and its plinth follows (`plinthSize`). Drags are offsets per place (`zoneOffset`, `unitOffset`), summed along the nesting chain (`chain`), until the saved layout redraws. `commit` sends one `locations.arrange` with the place, every place next to it where it stands now, the space it stands in with the size it shows, and, after a resize, the places inside it re-measured, so nothing else moves. `layout.ts` honours saved positions and sizes (a saved size grows only when its contents need it; places placed by hand need no padding around them).

## Ownership map

- Editable: `frontend/src/app/`, `pb/pb_migrations/` (new files only), `pb/pb_hooks/*.pb.js` and `lib_*.js` (not the `_*.js` system files), `operations.json` (non-system entries), `triggers.json`, this file, `reference/`.
- System-managed (never edit): `frontend/src/kit/`, `frontend/src/main.tsx`, `frontend/src/config.gen.ts`, the underscore hooks (`pb/pb_hooks/_*.js`), `manifest.json`.
