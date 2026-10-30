# Store OS

Every online shop of one seller in one place. Open new shops (a setup
checklist per platform with the platform's own sign-up and seller-centre
links) or add the ones you run; keep one catalog with a listing per shop
(its own title, text and price, checked against that platform); one stock
ledger that every shop is fed from; every order, shipment and buyer message
from every shop in one queue; sales and profit by shop in the base currency.
Your AI agent syncs shops, writes listings, drafts and sends replies, checks
tracking and helps set shops up; changes it proposes wait in Approvals.

Design and research: `reports/Multichannel ecommerce landscape and design.md`
and `research_notes/Multichannel ecommerce landscape and design/` in the
CraftBot repository.

## Requirements

See `reference/requirements.md` (binding). Feature checklist:

- [x] Shops: add a shop you run or open a new one (16 platforms, by country); setup checklist with links and "Ask your AI agent"; connection (your AI agent syncs it, file imports, by hand); fee rates, ship-by days, reply hours, stock rule, policies
- [x] Catalog: products with SKUs (price and cost in the base currency), pictures, facts with their source, a listing per shop with pre-flight checks (title limit, price, pictures, description, below cost, live without stock), "changes not on the shop yet"
- [x] Stock: one ledger (opening, received, sale, return, adjust, damage, count), reserved by open orders, available; per-shop stock rule and the "set on shops" plan
- [x] Orders: one queue across shops (to ship by ship-by, at risk, unpaid, shipped, exceptions, delivered, returns, cancelled), ship (single and bulk), deliver, cancel, refund, return with restock, link unknown SKUs, pick list; profit per order (fees estimated until real ones arrive)
- [x] Shipments: normalised tracking status, events, stalled and failed-delivery exceptions
- [x] Inbox: buyer conversations from every shop with reply clocks, drafts by your AI agent with its reasons, a marketplace-rules check, send by copying into the seller centre or through your AI agent
- [x] Customers across shops
- [x] Approvals: your AI agent's listing, price, stock and order changes wait for the seller; before and after; re-checked on approval (stale items skipped); undo for listing text, prices and stock
- [x] Overview: net sales, orders, profit, margin with the previous period; the sales chart; what needs you; recent orders; best sellers; sales by shop
- [x] File imports of seller-centre exports (CSV, Excel) with column matching
- [x] Your AI agent: chat, its tasks and their outcomes, activity; one batched trigger
- [x] Exchange rates (currency-api, then the ECB through Frankfurter), buyer-data purge, export of everything

## Entities

| Collection | Purpose | Notes |
|------------|---------|-------|
| settings | One row (`storesettings01`): business, base currency, country, time zone, autonomy, guards, buyer-data days, low-stock default, exchange rates | |
| shops | A shop on a platform (Direct is seeded) | fees in basis points, stock rule, policies, setup steps done |
| products | Catalog products | images (up to 12), facts `{key: {value, source}}` |
| variants | SKUs | price and cost in base minor units; `on_hand` kept by the ledger |
| stock_moves | The stock ledger | reason, ref, actor, balance after |
| listings | A product on a shop | price in the shop's minor units; `pushed` = quantity last set there per variant |
| customers | Buyers across shops | key: email, else phone, else shop and name |
| orders | Orders from every shop | minor units of the order currency; `cogs_minor` in base |
| order_lines | Lines | unit cost snapshot; qty shipped and returned |
| shipments | Parcels | normalised status and events |
| threads, messages | Buyer conversations | due_at from the shop's reply hours |
| proposals | Your AI agent's changes waiting for approval | items: op, params, fields before and after |
| tasks | Work handed to your AI agent | queued, asked, working, done, failed, cancelled |
| chats | The seller's messages to your AI agent | |
| imports | File imports and their results | |
| activity | Who changed what | |

Every collection is closed to the raw API (rules null) and refuses direct
writes (hooks.pb.js); screens and agents use the operations.

## Operations

Generated from the catalog (`pb/pb_hooks/cat_*.js`) by `node tools/gen.mjs`
into `pb/pb_hooks/routes.pb.js`, `operations.json` and
`frontend/src/app/lib/ops.gen.ts` (101 operations). Every route runs through
`lib_ops.js` (caller, parameters, propose-or-run, handler, JSON errors with a
`code`, live-update flush). Start with `app.guide`.
Seller only (`agent: 'deny'`): settings.autonomy, shops.remove, inbox.reply,
proposals.approve, proposals.reject, proposals.undo, chats.send, orders.remove.
Proposed when your AI agent calls them (unless that kind is set to
automatic): listings.draft, variants.set-price, stock.adjust, stock.count,
orders.cancel, orders.refund, orders.return.

## Triggers

One trigger, `work_requested`, written from the recipes in `lib_guide.js` by
`node tools/gen_triggers.mjs`. Every job is a task; one request covers every
task waiting (the platform allows one fire per 10 s and 30 an hour); the
minute job asks again for waiting tasks, re-queues tasks asked 30 minutes
ago and never started, and fails tasks started 3 hours ago and never
finished. Kinds: sync, publish, push_stock, setup_help, prepare_listing,
draft_reply, send_reply, tracking, exception, chat.

## External data

| Source | Used for | Auth | Called from |
|--------|----------|------|-------------|
| currency-api on jsDelivr (`cdn.jsdelivr.net/npm/@fawazahmed0/currency-api`) | Today's rates against the base currency | none | lib_store.js |
| ECB rates through Frankfurter (`api.frankfurter.dev`) | Rates when currency-api does not answer | none | lib_store.js |

Shops themselves are read and written by your AI agent with its own tools
(integrations, the seller centre in its browser) through the operations; the
app never holds a platform password or key.

## Look

The client's references (a Saledash-style dashboard and a Finexy-style
finance app): grey canvas, rounded frame, white cards, black pill buttons,
one orange accent, green and red delta chips, round icon badges, a sliding
tab pill. `frontend/src/app/theme.css`. Light and dark follow CraftBot's mode.
Type scale 12/13/14/15/26. No emoji, no em dashes in copy, "your AI agent",
platform marks from Simple Icons (an initial where none is published).

## Ownership map

- Editable: `frontend/src/app/`, `pb/pb_migrations/`, `pb/pb_hooks/ops.pb.js` and the app's own `lib_*.js`, `cat_*.js`, `hooks.pb.js`, `routes.pb.js` (generated), `operations.json` (generated, non-system entries), `triggers.json` (generated), `tools/`, this file, `reference/`.
- System-managed (never edit): `frontend/src/kit/`, `frontend/src/config.gen.ts`, the underscore hooks (`pb/pb_hooks/_*.js`), `manifest.json`.
