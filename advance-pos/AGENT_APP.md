# Advance POS

> Per-project plan, context and index. Keep it current with every change.

## What this app does

A point of sale for a shop or cafe, at the standard of Square, Shopify POS,
Toast, Lightspeed and Clover. The home page is the register: product tiles
(favorites, categories, search, any keyboard-wedge barcode scanner) beside
the sale, with one Charge button. A sale lives on the server as an open
ticket, so a reload, another register or your AI agent sees the same sale.
Checkout takes cash (suggested notes, change, cash rounding), card (from
the shop's own terminal, with its approval code), gift cards, store credit,
loyalty points and the shop's own tenders, split any way, with tips.
Returns and exchanges come back onto the sale on screen as negative lines.
Behind it: products with variants and option groups, stock with history,
customers with points and credit, promotions (by hand, automatic, with a
code, buy X get Y, scheduled), gift cards, the cash drawer with X and Z
reports, staff with PINs, roles, manager approvals and a time clock, an
audit log, reports with CSV export, receipts printed at 58 or 80 mm, and a
customer-facing display.

Your AI agent operates the app through the `agent-app` CLI with the same
operations the UI calls, and the app hands work back through four triggers:
send a receipt, review a closed drawer session, draft a restock list, and
answer a question about the business. The app names no particular agent:
the UI says "your AI agent", and what the agent does is recorded with the
actor `agent`.

**Start every agent session with `agent-app run <project> app.guide`**: it
returns the conventions (money in minor units, the agent's permissions),
the sale lifecycle, the error codes and recipes for each request.

## Requirements

See `reference/requirements.md` (binding). Feature checklist:

- [x] First run: store, currency (minor digits from the currency), tax rate, prices with or without tax, the owner and their PIN; opens signed in
- [x] Lock screen: store, clock, PIN pad (keyboard too), clock in or out by PIN without signing in, this device's register; wrong PINs rate limited (8 a minute)
- [x] Sessions: a signed session per person and register (16 h); locks when idle (setting) and optionally after every sale; the open sale stays on the server
- [x] Sell: square tiles with the picture or initials in the product's or category's color, the name centered under the tile (a long name rolls), the price under the name (a setting), variant count, low and out marks; favorites, all, categories, keypad (custom amounts, gift cards); search by name, SKU or barcode, Enter on a code adds it; wedge scanners work anywhere on the page
- [x] Item sheet: options as button rows (impossible combinations off), option groups with min and max, quantity or weight, note
- [x] Sale panel: customer (search or create, points and credit shown), lines (tap to change quantity, price with a reason, discount by percent or amount with quick chips, options, note, restock for returns, remove), promotions shown per line, totals per tax rate, Charge / Refund / Complete
- [x] Sale menu: name and note, discount on the sale (by hand, saved discounts, codes), remove tax, return or exchange, gift card, custom amount, no sale, pay in, pay out, clear the sale
- [x] Open tickets on every register: switch, start a new sale (keep the current one under a name, or clear it)
- [x] Checkout: tip presets or an amount; cash with suggested notes, a keypad for cash given and the change; card with approval code (off, optional or required); gift card by scan or number with balance check; store credit; points; custom tenders; split payments; void a payment; refunds the same ways (new gift card for a refund); every attempt idempotent
- [x] Done: change due, print receipt or gift receipt, send by email or text through your AI agent, new sale (locks first when set)
- [x] Returns and exchanges: with a receipt (scan, number, customer, recent sales; per-line quantity and restock; return everything) or without one (needs the return permission); the refund is the share actually paid
- [x] Manager approval: anything a role may not do asks for the PIN of someone who may, once, recorded with the approver; wrong PINs answered in place
- [x] Customer display (`#/display?register=<id>`): the sale line by line, what is due, then thank you and the change; no sign-in
- [x] Sales: paid, open, cleared or all, by days, search, with returns; a sale's page with lines, sources of returns, what can still come back, payments, history, print, gift receipt, send, return items, open a ticket on the register
- [x] Products: list with filters, favorites, archive, import and export CSV; editor with category (pick or new), sold by each or weight, up to three options generating variants (price, cost, SKU, barcode, stock counting, opening stock, low level per variant), option groups, picture or tile color, tax rate or none; categories (color, order); option groups (min, max, prices)
- [x] Stock: value at cost, units, low and out, levels with filters; receive (with unit cost: moving average), count, adjust, damaged, lost, by scanning in one item after another; full history; restock list from your AI agent
- [x] Customers: list, sort, import and export CSV; profile with spent, visits, average, points, credit, sales, balance history, gift cards; adjust points or credit with a reason; new sale for them
- [x] Promotions: saved discounts (manual), automatic, codes, buy X get Y; whole sale or some items (categories or products); minimum spend or quantity; days, hours and dates; needs a manager; on or off; uses counted
- [x] Gift cards: owed in total, list, balance and history, issue without a sale, adjust, disable, delete when unused
- [x] Cash drawer: open with a counted float (by note and coin or a total), pay in, pay out, no sale, live X report, close with a count (expected, counted, short or over), Z report printed, past sessions, automatic review by your AI agent
- [x] Reports: net sales, sales, average sale, gross profit and margin against the days before; sales by hour or day; payments; summary; breakdowns by product, category, staff, customer, payment, discount, tax, weekday, register; CSV of items sold, sales and every breakdown; ask your AI agent a question
- [x] Team: people (role, PIN, color, can sign in), time clock (hours per person, corrections recorded), permissions per role with the discount limit and the agent role (owner only)
- [x] Activity: the permanent audit log with filters
- [x] Requests: receipts, reviews, restock lists and questions with their answers
- [x] Settings: store and logo; receipts (header, footer, width, numbering) with a live preview; tax rates and inclusive pricing; payments (card code, cash rounding, notes and coins, custom tenders, tips); loyalty; registers, this device and their customer displays; register rules (drawer required, negative stock, prices on tiles, lock when idle, lock after sale, automatic reviews, low stock default)
- [x] Every record type deletes through `records.delete` with a preview; sales, payments, drawer sessions, cash movements, stock and balance history and the audit log are permanent and say how to correct them
- [x] Phone, tablet and desktop layouts; colors from the host theme with contrast checked in every theme pack, light and dark
- [x] Every UI action has a CLI operation

## Entities

Money is whole minor units (cents) everywhere; `*_text` fields are
formatted. Every collection is written only through the operations
(`hooks.pb.js` refuses direct API writes and names the operation to use).

| Collection | Purpose | Notes |
|------------|---------|-------|
| settings | One row: store, receipt, currency and digits, tax inclusion, cash rounding, denominations, tips, card reference, custom tenders, loyalty, numbering, register rules, `show_tile_prices`, `permissions` (the role matrix), `secret` (hidden; signs sessions) | Seeded with defaults |
| registers | `name`, `active`, `current_order`, `display_message` | The customer display follows `current_order` |
| staff | `name`, `role` (owner, manager, cashier), `pin_hash`, `pin_salt` (hidden), `active`, `color`, `email`, `phone`, `last_signed_in` | At least one active owner |
| timeclock | `staff`, `clock_in`, `clock_out`, `note`, `edited_by` | One open entry per person |
| categories | `name`, `color`, `sort` | |
| taxes | `name`, `rate`, `is_default` | One default |
| modifier_groups | `name`, `min`, `max`, `options` [{id, name, price}], `sort` | |
| products | `name`, `description`, `category`, `image` (thumbs 160 and 480), `color`, `tax`, `tax_exempt`, `modifier_groups`, `option_names`, `sold_by`, `unit`, `favorite`, `sort`, `archived` | |
| variants | `product`, `title`, `options`, `sku`, `barcode`, `price`, `cost` (moving average), `track_stock`, `stock`, `low_at`, `position`, `archived` | SKU and barcode unique across variants |
| customers | `name`, `phone`, `email`, `notes`, `tags`, `tax_exempt`, `marketing`, `birthday`, `points`, `credit`, `visits`, `spent`, `last_visit` | Email and phone unique |
| gift_cards | `code`, `balance`, `issued`, `status`, `customer`, `last_used`, `note` | |
| discounts | `name`, `kind` (percent, amount, bogo), `value`, `scope` (order, item), `applies`, `categories`, `products`, `mode` (manual, auto, code), `code`, `min_subtotal`, `min_qty`, `buy_qty`, `get_qty`, `days`, `start_time`, `end_time`, `starts_on`, `ends_on`, `manager_only`, `active`, `uses` | |
| shifts | `register`, `number`, `status`, `opened_by`, `opened_at`, `opening_float`, `closed_by`, `closed_at`, `counted`, `counts`, `expected`, `difference`, `note`, `report` (the Z report) | One open per register |
| cash_moves | `shift`, `kind` (pay_in, pay_out, no_sale), `amount`, `reason`, `staff`, `approved_by` | |
| orders | `number`, `status` (open, paid, void), `label`, `note`, `register`, `shift`, `customer`, `opened_by`, `closed_by`, `order_discount`, `applied_discount`, `tax_exempt`, totals, `taxes`, `tip`, `rounding`, `paid_total`, `change_total`, `balance`, `has_returns`, `return_status`, `points_earned`, `version` | An open order is the cart; `version` guards concurrent edits |
| order_lines | `order`, `kind` (item, custom, gift_card), product and variant snapshot, `qty`, `unit_price`, `list_price`, `modifiers`, `price_override`, `line_discount`, `auto_discount`, tax snapshot, `gross`, `discount`, `tax`, `net`, `total`, `return_of`, `refund_amount`, `returned_qty`, `restock`, `gift_code`, `note` | Returns are negative lines |
| payments | `order`, `tender`, `label`, `amount` (negative for refunds), `tendered`, `change`, `reference`, `gift_card`, `customer`, `points`, `status`, `client_ref` (unique) | |
| stock_moves | `variant`, `delta`, `after`, `reason`, `unit_cost`, `order`, `batch`, `note` | Permanent |
| account_moves | `account` (points, credit, gift_card), `delta`, `after`, `reason`, `order`, `payment`, `note` | Permanent |
| events | `kind`, `actor`, `staff`, `approved_by`, `register`, `order`, `amount`, `detail`, `data` | The audit log; permanent |
| requests | `kind` (receipt, shift_review, restock, question), `title`, `body`, `contact`, `order`, `shift`, `customer`, `status` (sent, working, done, failed), `result` | Requests to your AI agent |

## Operations

75 operations in `operations.json` (`agent-app ops <project>`):
`app.guide|status`; `setup.status|complete`; `auth.unlock|session`;
`settings.get|update`; `permissions.update`; `registers.list|save|focus`;
`display.get`; `staff.list|save|clock`; `timeclock.list|save`;
`catalog.register`; `categories.list|save`; `taxes.list|save`;
`modifiers.list|save`; `products.list|get|lookup|save|import|export`;
`stock.levels|change|moves`;
`customers.list|get|save|adjust|import|export`;
`giftcards.list|get|save|adjust`; `discounts.list|save`;
`orders.list|get|add|line|remove|update|return|void|complete|receipt`;
`payments.add|void`; `shifts.current|open|cash|close|list|get`;
`reports.summary|breakdown|export`; `events.list`;
`requests.create|list|get|update`; `records.delete`.

People act through a session (`till`, from `auth.unlock`); the agent acts
through the CLI with the `agent` role and passes `register` where a
register matters. A refused permission answers `approval_needed` with the
permission; the same call with `approve_pin` of someone who has it goes
through once and records them. The agent has no approval path and never
takes cash. Order changes take `expected_version` and answer `stale` when
the sale changed meanwhile; payments take a `client_ref` so a repeat never
charges twice.

Routes live in `pb/pb_hooks/ops.pb.js`; logic in the `lib_*.js` modules
(required inside each handler): `lib_util.js`, `lib_money.js` (minor units,
parsing, allocation), `lib_auth.js` (PINs, sessions, permissions,
approvals), `lib_audit.js`, `lib_settings.js` (settings, setup, status),
`lib_people.js` (registers, display, staff, time clock), `lib_catalog.js`,
`lib_stock.js`, `lib_customers.js` (customers, balances, gift cards),
`lib_discounts.js`, `lib_pricing.js` (the pricing engine), `lib_orders.js`
(the sale lifecycle), `lib_payments.js`, `lib_shifts.js`, `lib_reports.js`,
`lib_receipt.js` (receipt data and 40-column text), `lib_requests.js`,
`lib_csv.js`, `lib_delete.js`, `lib_guide.js`, `lib_rules.js`.

## Pricing

Per line: the price (or an approved override) plus options times the
quantity. One item discount per line: a manual one, otherwise the best of
the automatic and code promotions (including buy X get Y). Then the order
discount, shared over the discountable lines by largest remainder. Tax per
rate, sales and returns apart, computed on the total of each rate and
shared back to its lines, inclusive or exclusive; rounding half away from
zero. Returned lines refund their share of what was actually paid,
counted cumulatively so returning everything refunds exactly the line.

## Triggers

`triggers.json`: `receipt_requested`, `shift_review_requested` (fired
automatically when a drawer closes, when the setting is on),
`restock_requested`, `question_asked`. Each passes `request`; the agent
reads it with `requests.get`, moves it to `working`, and finishes it with
`requests.update --status done|failed --result ...`.

## Frontend

`frontend/src/app/`: `App.tsx` (setup, lock, providers, routes),
`lib/` (`api.ts` typed operations with the session, approvals and
idempotency; `session.tsx` sign-in and locking; `context.tsx` settings,
catalog and status, live; `live.ts` one realtime hub; `format.ts` money and
dates; `print.ts` receipts and Z reports; `scanner.ts` wedge scanners;
`themeColors.ts` colors from the host theme), `components/` (`Shell.tsx`
rail and phone bar, `LockScreen.tsx`, `Setup.tsx`, `Approval.tsx`,
`pads.tsx` PIN and amount pads, `DrawerDialogs.tsx`, `DeleteButton.tsx`,
`ImportDialog.tsx`, `charts.tsx`, `common.tsx`, `ui.tsx`, `RollingText.tsx`
(a name too long for its tile rolls), and `sell/`: `ticket.tsx` the sale
state, `Catalog.tsx` (search, tabs and the product tiles), `TicketPanel.tsx`,
`ItemDialog.tsx`, `LineDialog.tsx`, `Checkout.tsx`, `ReturnDialog.tsx`,
`dialogs.tsx`, `intent.ts`), `pages/` (Sell, Orders, Products, Product,
Stock, Customers, Promotions, Reports, Drawer, Team, Activity, Requests,
Settings, Display).

Visual system: a slim icon rail, compact back office (28 px controls,
hairline panels, 4 to 10 px corners, dense tables), a touch-first sell
screen (tiles, keypads, one dark charge card); one type scale (12, 13, 14,
15, 26); every color is a `--ps-*` token derived from the host's
`--agent-app-*` tokens with contrast checks (`themeColors.ts`).

## External data

| Source | Used for | Auth | Called from |
|--------|----------|------|-------------|
| (none) | Card payments are taken on the shop's own terminal and recorded; receipts by email or text are sent by your AI agent with its own tools | | |

## Ownership map

- Editable: `frontend/src/app/`, `pb/pb_migrations/`, `pb/pb_hooks/ops.pb.js`,
  `pb/pb_hooks/lib_*.js`, `pb/pb_hooks/hooks.pb.js`, `operations.json`
  (non-system entries), `triggers.json`, `reference/`, this file.
- System-managed (never edit): `frontend/src/kit/`, `frontend/src/config.gen.ts`,
  the underscore hooks (`pb/pb_hooks/_*.js`), `manifest.json`.
