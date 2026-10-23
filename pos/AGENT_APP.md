# POS

> Per-project plan, context and index. Keep it current with every change.

## What this app does

Point of sale for cafes, restaurants and shops, in the Expenses tracker's
visual family (a warm canvas, one rounded shell, borderless white, sand and
dark cards, pills and round icon buttons). The home page is the register: a
greeting and search, product tiles by category (favorites first), the sale
in its own card on the right with one large Pay button in the dark card at
its foot. Tapping a tile adds it; a product with sizes or options opens a
dialog for them. Pay grows into a full screen of three numbered steps and
takes cash (quick amounts, change, cash rounding), card, QR or other
methods, split across several; the receipt prints or is emailed. Returns and exchanges start from the
receipt. Open tickets (tabs, tables, phone orders) are saved and resumed on
any register.

Around the register, on the left icon rail (a bottom bar on phones): Orders
(every receipt, reprint, email, return), Kitchen (tickets from paid orders),
Products (products with sizes, barcodes and stock; categories; options;
discounts; stock; imports), Customers, Reports (sales and the audit trail),
Cash and shifts (open, cash in and out, blind close, X and Z reports) and
Settings. A customer display and an order board open in their own windows.

Staff sign in with a 4 to 6 digit PIN on the lock screen; roles (owner,
manager, cashier) decide what each person may do, and a manager's PIN
approves a cashier's discount over the limit, price change, refund, void or
cash move in place. Each register (one per counter device) has gapless
receipt numbers and a hash chain over its sales. Money is integer minor
units; taxes are per rate, rounded once per receipt, inclusive or exclusive,
with regional presets (Malaysia, Singapore, Japan with the dine-in rate,
Australia, New Zealand, UK, US, other).

An AI agent operates the back office through the `agent-app` CLI with the
same operations the UI calls (catalog, stock, customers, reports, imports,
draft tickets, receipt emails) and never moves money. The app hands work back
through three triggers (read a menu file into products for review, email a
receipt, write the day's brief when a register is closed). The UI says "your
AI agent"; what the agent does is marked `agent` in the audit trail. No emoji
anywhere: categories wear line icons from a fixed set (`pb_hooks/lib_icons.js`,
mirrored in `frontend/src/app/lib/icons.tsx`).

**Start every agent session with `agent-app run <project> app.guide`**: it
returns the conventions (money as text in, minor units out), today's trading
day, the currency, tax classes, categories, registers, what the agent may and
may not do, and ready-to-run recipes.

## Requirements

See `reference/requirements.md` (binding). Feature checklist:

- [x] First open: two-step setup (business name and country, which sets currency, price mode, tax classes and cash rounding; the owner's name and PIN), then the register opens with a counted float
- [x] Lock screen: who is at the register, PIN keypad (keyboard too), five wrong PINs lock that person for five minutes, idle lock after N minutes, the cart is kept
- [x] Register: square tiles by category (the photo, or the category's line icon on its color), the name centered under each tile (a long name rolls), the price under the name (a setting), favorites, search (F2 or /), barcode scan anywhere, custom amount keypad, arrange tiles (drag to reorder, per-tile menu), sold-out marks, stock left on tracked items
- [x] Item dialog: sizes, option groups (a card each) with min and max, quantity, note; reopened from a cart line to change its options
- [x] Cart lines: tap to open quantity, discount, price change (approval), note, options; remove with Undo
- [x] Sale: order type (dine-in, takeaway, delivery), ticket name, customer (search or add), order discount (presets or typed, percent or amount, cashier limit with approval), line and order notes, totals with tax rows per rate and service charge
- [x] Pay (F9): a full screen of three steps (paid by, amount, take it) that grows out of the pay button: cash with quick amounts and change, card, QR (shows the shop's QR image), other; split payments; references; cash rounding on the cash part only; refunds pay out; Esc goes back
- [x] Done: change due, print or email the receipt (or the shop's setting), order number, new sale
- [x] Returns and exchanges: find the receipt (number, scan or recent list), pick lines and quantities, restock or not, refund to the original methods or cash, exchange by adding new items; blind returns with approval
- [x] Open tickets: save with a name, list, resume on any register, release, void with reason (approval); your AI agent can draft phone orders
- [x] Orders: every receipt as a row card with filters (kind, register, staff, dates, search), detail with lines, taxes, payments and approvals, reprint, email, start a return
- [x] Kitchen: tickets for products in kitchen categories, new, ready (called), collected, recall, open and collected views, timers; the order board shows numbers in preparation and ready; the customer display mirrors the cart, totals and change
- [x] Products: status chips (active, drafts to review, archived), category filter, search, sold-out switch, editor as a full screen of three steps (what it is: name, category, price or open price, tax class; sizes and options: sizes with own price, SKU and cost, options offered; stock and details: SKU, cost, barcodes, stock tracking with opening stock and low level, for sale, favorite, color, photo, description), approve or discard drafts
- [x] Categories (color, line icon, kitchen, order), options (groups with min and max, prices, defaults, sold out), discounts (percent or amount, order or item)
- [x] Stock: levels with low and out, receive, adjust with reason, count, history per product
- [x] Import: CSV with a template and row problems; menus and price lists (photo, PDF, spreadsheet) read by your AI agent into drafts
- [x] Customers: search, a card per customer opening their contact, notes for the counter, marketing consent, visits, spend and recent receipts, archive
- [x] Reports: today, yesterday, the last 7 or 30 days, this month or chosen dates, by register; collected, net sales, orders, average, refunds, discounts, tax, service charge, each against the previous period; the headline on the dark card; collected by hour or day; top products and categories; payment methods as a ring; taxes; staff; CSV export
- [x] Activity: the audit trail grouped (money, exceptions, changes, your AI agent), filters, search
- [x] Cash and shifts: open with a float counted by denomination, cash in, out and drops with reasons (approval for cashiers), blind close as a full screen of two steps (count the drawer, check and close), the Z report frozen at close (printable), X report while open, history
- [x] Settings (sections as pill tabs): business and receipts (logo, header, footer, width 80 or 58 mm, tax and company numbers, barcode, after-sale printing), taxes and money (price mode, rounding, cash rounding, tax classes with dine-in rate and receipt mark), selling (order types, service charge, cashier discount limit, kitchen, order numbers, prices on tiles, idle lock, day cutoff), payment methods, registers, staff (roles, PIN resets, training mode), your AI agent
- [x] Training mode per person: practice sales numbered TR..., never in reports, stock or cash
- [x] Every UI action has a CLI operation; the agent cannot take payments, refund, void, open or close a register, move cash, see PINs or change owner settings

## Entities

Money is an integer of minor units (cents, sen, yen); rates are basis points
(600 is 6%). Days are trading days `YYYY-MM-DD` (a day may end after midnight:
`day_cutoff_hour`). Sales, their lines and payments are written once and
never changed; a refund or exchange is a new sale whose return lines point at
the lines they return (`origin`). Every collection changes only through the
operations: request hooks refuse direct API writes, even a superuser's.

| Collection | Purpose | Notes |
|------------|---------|-------|
| settings | One row: business details, `region`, `currency`, `price_mode` (inclusive, exclusive), `tax_rounding` (half_up, floor, ceil), `cash_rounding` (0, 5, 10 minor units), `order_types`, `default_order_type`, service charge (`service_charge_bp`, `_scope`, `_tax`), receipt fields (`receipt_header`, `_footer`, `_width` 80/58, `_barcode`, `after_sale` ask/print/none, `logo`), `kitchen_enabled`, `order_numbers`, `show_tile_prices`, `lock_minutes`, `cashier_discount_bp`, `day_cutoff_hour`, `setup_done` | Seeded not set up (`setup.complete` applies a region preset) |
| tax_classes | `name`, `rate_bp`, `dine_in_rate_bp` (-1 none), `mark` (receipt mark, e.g. Japan's reduced rate), `sort`, `is_default`, `archived` | Archived, never deleted (sales keep their name and rate) |
| registers | `name`, `code` (R1, prints on receipts), `z_seq`, `archived` | One seeded; at least one stays in use |
| counters | Hidden: `key` (`receipt:<register>`, `training:<register>`, `hash:<register>`, `order`), `num`, `text` | The hot counters of a sale, so a sale never rewrites settings or registers (which every device watches) |
| tenders | `name`, `kind` (cash, card, qr, other), `qr` (image shown to the customer), `ask_reference`, `active`, `sort` | Cash, Card and QR pay seeded |
| staff | `name`, `role` (owner, manager, cashier), `color`, `active`, `training`, `pin_set`, `failed`, `locked_until` | |
| staff_pins | Hidden: `staff`, `salt`, `hash` (sha256) | Never readable through the API |
| sessions | Hidden: `staff`, `register`, `token_hash`, `expires` (16 h), `ended` | Lock ends the session |
| approvals | Hidden: one-time manager approvals: `action`, `approver`, `for_staff`, `scope`, `token_hash`, `expires` (30 min), `used` | Consumed inside the transaction that uses them |
| customers | `name`, `phone`, `email`, `notes`, `marketing`, `archived` | Visits and spend come from sales |
| categories | `name`, `color` (slot 1 to 8), `icon` (fixed line icons), `sort`, `kitchen` | |
| modifier_groups, modifiers | Option groups (`min`, `max`, `sort`) and their options (`price`, `is_default`, `available`, `sort`) | |
| products | `name`, `category`, `price`, `open_price`, `tax_class`, `sku`, `description`, `photo`, `color`, `cost`, `available` (sold-out switch), `archived`, `status` (active, draft: imported, waiting for review), `track_stock`, `low_stock`, `favorite`, `sort`, `fav_sort`, `modifier_groups`, `import_ref` | |
| variants | Sizes: `product`, `name`, `price`, `sku`, `cost`, `sort`, `archived` | |
| codes | Barcodes: `code` (unique), `product`, `variant` | No code may equal another product's SKU or code |
| discounts | Presets: `name`, `kind` (percent, amount), `value`, `scope` (order, item), `sort` | |
| shifts | `register`, `number`, `status` (open, closed), float and close (`opening_float`, `opening_counts`, `counted_cash`, `closing_counts`, `expected_cash`, `variance`), `summary` (the frozen Z report) | One open shift per register |
| sales | `ref` (client idempotency key, unique), `body_hash`, `number` (R1-000123, gapless per register; training TR1-...), `seq`, `register`, `shift`, `staff`, `customer`, `order_type`, `order_no` (daily), `kind` (sale, refund, exchange), totals (`subtotal`, `discount_total`, `service_charge`, `tax_total`, `taxes` per rate, `rounding`, `total`, `paid`, `change`), `business_day`, `header` (shop details printed), `approvals`, `prev_hash`, `hash` | Write-once |
| sale_lines | Snapshot of what was sold: names, `qty` (negative for returns), `unit`, `modifiers`, `gross`, `line_discount`, `order_discount`, `net`, tax (`tax_name`, `rate_bp`, `mark`, `tax`), `cost`, `kitchen`, `restock`, `price_changed`, `origin` (the line a return returns) | Write-once |
| payments | `sale`, `tender`, `kind`, `amount` (negative pays out), `tendered`, `change`, `reference`, `register`, `shift`, `staff`, `training`, `business_day` | Write-once |
| carts | Open tickets: `ref`, `register`, `staff`, `status` (parked, resumed, done, void), `source` (counter, agent), `name`, `order_type`, `customer`, `lines`, `discount`, `note`, `total`, `items`, `sale`, `void_reason`, `voided_by` | |
| cash_moves | `shift`, `kind` (pay_in, pay_out, drop), `amount`, `reason`, `staff`, `approver` | |
| stock, stock_moves | Balance per product or size, and its ledger (`kind` sale, refund, receive, adjust, count; `balance` after; `actor` staff or agent) | Written in the same transaction |
| tickets | Kitchen tickets: `sale`, `order_no`, `number`, `name`, `order_type`, `items`, `note`, `status` (new, ready, done), `ready_at`, `done_at`, `training` | One per paid order with kitchen lines |
| imports | Menu files for the agent: `file`, `status` (waiting, reading, done, failed), `summary`, `error`, `created_count`, `added_by` | |
| audit | Every money event, exception and change: `kind`, `actor` (staff, agent, system), `staff`, `approver`, `register`, `ref`, `summary`, `data` | Append-only |

## Operations

101 operations in `operations.json` (`agent-app ops <project>`). Groups:
`app.guide|status`; `setup.regions|complete`;
`auth.me|login|logout|first-pin|change-pin|approve`;
`staff.list|add|update|set-pin|reset-pin`; `settings.get|update`;
`tax.list|add|update|archive`; `tenders.list|add|update`;
`registers.list|add|update`; `catalog.register`;
`categories.list|add|update|delete|reorder`;
`products.list|get|add|update|set-available|archive|restore|reorder|approve|discard|import`;
`modifiers.list|add-group|update-group|delete-group|set-available`;
`discounts.list|add|update|delete`; `lookup.code`;
`stock.list|history|receive|adjust|count`;
`imports.list|add|start|complete|fail|retry|delete`;
`tickets.list|get|park|resume|release|void|draft`;
`sales.finalize|preview|list|get|refundable|receipt-text`;
`receipts.email|reprint`; `shifts.current|list|report|open|close`;
`cash.move`; `kitchen.list|board|bump|recall`;
`customers.list|get|add|update|archive`; `reports.summary|export`;
`audit.list`.

Routes live in `pb/pb_hooks/ops.pb.js` (guide, status, setup, auth, staff,
settings, taxes, tenders, registers), `ops_catalog.pb.js` (catalog,
categories, products, options, discounts, lookup, stock, imports) and
`ops_sales.pb.js` (tickets, sales, receipts, shifts, cash, kitchen,
customers, reports, audit); logic in the `lib_*.js` modules (required inside
each handler). `operations.json` mirrors the routes one to one (every route
has an entry with its params, every entry a route): add both together.

Permissions: `lib_auth.gate(e, app, action, p, agentAction)` resolves the
caller (a staff session from `X-Pos-Session`, or the agent from a valid
`X-A2App-Token`) and checks `ROLE_PERMS` or `AGENT_PERMS`. Approvable actions
take `--approvals '["<token>"]'` from `auth.approve`.

## Agent triggers

| Trigger | Fired when | What the agent does |
|---------|------------|--------------------|
| `menu_import_waiting` | A menu or price-list file is added on Products > Import (or retried); a minute cron re-asks when a fire was refused by the cooldown or lost to a restart | Reads each waiting file, adds its products as drafts with `products.import`, then `imports.complete` with a summary or `imports.fail` with a reason; never approves |
| `receipt_email_requested` | "Email" on the done screen or a receipt (with the customer's address) | Sends `sales.receipt-text` as a plain-text email from the user's account |
| `day_closed` | A register is closed (the Z report is written) | Reads the Z report, the day's summary against the day before, exceptions and low stock; sends one short brief |

## External data

None. Everything the app knows is typed, scanned, imported, or recorded by
the AI agent. Card and QR payments are taken on the shop's own terminal or QR
code; the app records them.

## Background jobs

- `pos_imports` (every minute): asks the agent about waiting menu files only when an ask is outstanding (in-memory flag; no blind polling).
- `pos_cleanup` (hourly): ends expired sessions, deletes used approvals and those expired over a day ago, and ended sessions after 30 days.

## Gotchas

- Hooks do not hot-reload (`--hooksWatch=false`): restart the app after any hook change.
- Hook callbacks run in isolated VMs: shared code lives in `lib_*.js` and is required inside each callback.
- `runInTransaction` bodies use only the transaction handle (`tx`); `$app` or `e.app` inside one deadlocks.
- Never bind an empty string to a filter placeholder: PocketBase renders `{:v}` = `''` as the two-character string `""`, so `variant = {:v}` never matches an empty relation. Write the literal `''` (see `lib_stock.post`) or leave the clause out. SQL through `newQuery().bind()` is not affected.
- Lines your AI agent writes (`tickets.draft`, `sales.preview`) go through `lib_carts.resolveLines`: products by id, SKU, barcode or exact name, sizes and options by id or name, default options where a group has none named; a return line (`return_of`) is read as the counter sends it. So a quote always matches the ticket it becomes.
- A sale's first statement in its transaction is the counter UPDATE (`lib_core.bump`): it takes SQLite's write lock, so receipt numbers stay gapless under concurrent registers, and a failed sale gives its number back. Never read a counter before bumping it.
- `sales.finalize` is idempotent by `ref` + `body_hash`: a retry with the same body returns the stored sale (`replayed: true`); a different body answers `ref_conflict`. `expected_total` makes the server refuse a sale whose total changed since the counter priced it (`total_changed`).
- The totals engine exists twice and must agree to the minor unit: `pb/pb_hooks/lib_calc.js` (server, authoritative) and `frontend/src/app/lib/calc.ts` (counter). Tax is computed once per RATE per receipt, the order discount is shared by largest remainder (BigInt beyond 2^53), cash rounding applies to the cash-settled part only. `tools/calc_parity.mjs` fuzzes both with 20,000 carts.
- Return lines are priced from the original line's fixed shares (`returnShare`), so returning part of a discounted line refunds exactly its share and the last return takes the remainder.
- The UI subscribes to all collections once at startup (`lib/live.ts`): the SDK drops subscriptions made while its first connection is being set up. Views reload (debounced) when their collections change; `AppDataProvider` (`lib/context.tsx`) loads settings, catalog, taxes, tenders, registers, staff and the status counts once for the page. An open page reloads itself when the served app script changes, waiting while a dialog is open or the cart is not empty.
- Rate limits: the seed migration sets PocketBase's limits with `/api/ops/` at 1800 per minute, because every LAN register, kitchen screen and display reaches the app through the relay's one address. The platform's bootstrap leaves limits it finds enabled.
- Every money parameter is text in major units (`"4.50"`, `"500"` in yen); every money value read back is an integer of minor units. `lib_util.money` parses, `moneyText` formats.
- Scans: `lib/scanner.ts` tells a scanner's burst (4+ characters, under 40 ms apart, ended by Enter or Tab or a pause) from typing; the register looks a scan up in the catalog (product SKU, size SKU, barcode) or as a receipt number (opens the return).
- The customer display follows its register through a `BroadcastChannel`: it must open in the same browser on the same machine (a second screen). The order board reads the server and works on any device.
- Printing: receipts and Z reports render into a print-only host (`lib/print.tsx`) with an `@page` sized to the receipt width; they print black on white whatever the theme. A reprint (from Orders, or a second print on the done screen) is marked COPY and recorded with `receipts.reprint`.
- The drawer lines of X and Z reports keep cash taken and cash refunded apart (`cash.cash_taken`, `cash.cash_refunded`); expected cash = float + taken - refunded + paid in - paid out - drops.
- Look: `theme.css` and `components/ui.tsx` are the design system (Expenses tracker family): `Card` (white, sand, dark), `Button` pills (`dot` marks a screen's main action; the dot always sits in the pill's start, also in a full-width pill where the label is centered, never beside the label in the middle, and holds the spinner while the button works), round `IconButton`s, pill fields (`inputCls` in cards, `pillInput` / `tone="card"` on the shell), `Chip`, `Tabs`, `Segmented`, `Badge`, `IconBadge`, `Modal`, and `RevealScreen` + `ScreenHeader` + `Step` for the full screens that grow out of a button (pay, new product, closing a register). No borders, no tables, one type scale (12, 13, 14, 15, 26).
- Colors: `lib/themeColors.ts` derives every `--ps-*` color from the kit theme tokens with contrast checks and re-derives on every theme change. The accent has three roles per surface: `--ps-accent` for marks and text (solved to 4.6:1 on cards, ink and the dark card), `--ps-accent-fill` for fills that carry `--ps-on-accent` text, `--ps-dot` + `--ps-on-dot` for round icon badges. Surfaces set a scope class (`ps-on-dark`, `ps-on-sand`, `ps-on-ink`, `ps-on-card`) so accent and muted text re-point. The eight category hues are fixed, each with a derived tint and text color. Never hardcode a hex color in components; never override `--agent-app-*` colors.
- Register tiles (`components/register/Catalog.tsx`): the square is the card; the name and the price (when `show_tile_prices` is on) sit under it, outside the card. `components/RollingText.tsx` measures the name and rolls it only when it does not fit (centered otherwise, an ellipsis with reduced motion). `tile_url` is the 480 px photo that dense screens load; `thumb_url` stays the 160 px one.
- Numbers on screen follow `lib/format.ts`; typed amounts accept "." as the decimal point.

## Ownership map

- Editable: `frontend/src/app/`, `pb/pb_migrations/` (new files only), `pb/pb_hooks/*.pb.js` and `lib_*.js` (not the `_*.js` system files), `operations.json` (non-system entries), `triggers.json`, this file, `reference/`.
- System-managed (never edit): `frontend/src/kit/`, `frontend/src/main.tsx`, `frontend/src/config.gen.ts`, the underscore hooks (`pb/pb_hooks/_*.js`), `manifest.json`.
