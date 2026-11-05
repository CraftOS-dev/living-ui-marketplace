# Tasks: Store OS

Every task cites what it implements. These features already exist in the published app `store-os` 1.0.0, so the build tasks are recorded as done.

## Build
- [x] T-1 (F-FRM-1, F-FRM-2, F-FRM-3, F-FRM-4, F-FRM-5): the frame. The sidebar has the main menu with live counts, the shop tree with status dots and "+", and Settings. It collapses to a rail (remembered) and becomes a drawer below 1024 px (`components/Shell.tsx`).
- [x] T-2 (F-FRM-6): the top bar: search (Ctrl K), today's date, the "What needs you" bell, "Ask your AI agent" with its working dot, and the store menu.
- [x] T-3 (F-FRM-7, F-FRM-8): the `--so-*` light and dark palettes, the Inter type scale and the shared widgets (`theme.css`, `components/ui.tsx`). Platform marks come from Simple Icons or an initial (`components/PlatformMark.tsx`), and the copy says "your AI agent" with no emoji.
- [x] T-4 (F-FRM-9, F-FRM-10): the live layer. One realtime topic `store` (`lib_bus.js`) and `lib/live.ts` reload views. An open page reloads onto a new build, and "Store OS cannot reach its data" shows when settings or shops fail.
- [x] T-5 (F-ONB-1, F-ONB-2, F-ONB-3): "Set up your store" (business, your name, country, base currency, the browser's time zone), shown until a base currency is set (`pages/Overview.tsx`).
- [x] T-6 (F-ONB-4, F-OVR-1, F-OVR-2, F-OVR-3): Overview header and greeting, "Add your first shop", and the four figures with their deltas and the profit warning (`app.home`, `lib_reports.js`).
- [x] T-7 (F-OVR-4, F-OVR-8, F-OVR-9): the sales line chart (Net sales, Profit, Orders; 7d to 12m, remembered) and "Sales by shop" stacked bars with sparklines (`components/Charts.tsx`). Orders without a rate are left out and counted.
- [x] T-8 (F-OVR-5, F-OVR-6, F-OVR-7): "Needs you" from `reports.attention`, "Recent orders", and the "Best sellers" carousel.
- [x] T-9 (F-SHP-1, F-SHP-2, F-SHP-3): the add-shop dialog (path, platform, details) over the 16 platforms, 26 countries and 28 currencies, with unique shop names and the setup checklists per platform kind (`components/AddShopDialog.tsx`, `lib_platforms.js`, `lib_shops.js`).
- [x] T-10 (F-SHP-4, F-SHP-5, F-SHP-13): the setup checklist card. Each step has its platform link per country and "Ask your AI agent" (`shops.help`), and a shop becomes active when every step is done. Sync now (`shops.sync`) shows the last sync and its note.
- [x] T-11 (F-SHP-6, F-SHP-7, F-SHP-8): Shops cards and the shop page: its figures, latest orders, how orders come in (agent, files, by hand) and the main action that follows it (`pages/Shops.tsx`, `pages/Shop.tsx`).
- [x] T-12 (F-SHP-9, F-SHP-10, F-SHP-11, F-SHP-12): a shop's rules (fees, deadlines, stock rule with a live example), policies, details dialog, pause, activate, mark as open, and delete by typing the name (Direct is kept).
- [x] T-13 (F-PRD-1, F-PRD-2, F-PRD-3): the catalog with listing marks per shop, eight filters with counts, a shop filter and search, loaded 100 at a time up to 500 (`pages/Products.tsx`, `products.list`).
- [x] T-14 (F-PED-1, F-PED-2, F-PED-3): the new-product page. One checked `products.create` call makes the product, its options (up to 3) and SKUs (up to 100), and the draft listings; pictures upload after (`pages/Product.tsx`, `components/OptionsEditor.tsx`).
- [x] T-15 (F-PED-4, F-PED-7, F-PED-8, F-PED-9): the saved-product page. Fields save when left, the Variants table edits in place, status and delete are in the menu, and the margin is flagged below the minimum (`components/SkuTable.tsx`).
- [x] T-16 (F-PED-5, F-PED-6): the Media card (12 pictures, 10 MB each, cover, viewer) and product facts with their source (`components/MediaCard.tsx`, `products.facts`).
- [x] T-17 (F-LST-1, F-LST-2, F-LST-3, F-LST-4): the listing panel with its own title, text, price and keywords. The pre-flight checks come from `lib_products.preflight`, alongside "Changes not on the shop yet", publish through the agent, mark live, pause and remove (`components/ListingDrawer.tsx`).
- [x] T-18 (F-LST-5): "Write listings with your AI agent" for chosen shops (`products.prepare`, a prepare_listing task), with drafts returning through Approvals.
- [x] T-19 (F-STK-1, F-STK-2, F-STK-3, F-STK-5): the stock ledger (`lib_stock.js`): on hand, reserved and available, the low and out states, the stock dialogs (received, count, damaged, returned, adjust) and each SKU's history.
- [x] T-20 (F-STK-4): "Set on shops". `stock.plan` applies each shop's rule, "I set them" runs `stock.mark-pushed`, and "Ask your AI agent to set them" runs `stock.push`.
- [x] T-21 (F-ORD-1, F-ORD-2, F-ORD-4): the order queue with ten views and counts, a shop filter, search, selection, bulk ship (`orders.ship-many`) and the pick-list CSV (`pages/Orders.tsx`).
- [x] T-22 (F-ORD-3, F-ORD-6, F-ORD-9, F-ORD-10): add an order by hand. Ship, deliver, refund, return with restock, cancel and delete it. Shipping records a sale move, and orders arriving already shipped move no stock (`components/OrderDialogs.tsx`, `lib_orders.js`).
- [x] T-23 (F-ORD-5, F-ORD-7, F-ORD-8): the order panel with money down to profit and margin, and editable fees and shipping cost. Lines link to a SKU or are marked as not a product, and tracking and delivery problems can be handed to the agent (`components/OrderDrawer.tsx`, `orders.help`, `orders.track-all`).
- [x] T-24 (F-TRK-1, F-TRK-2, F-TRK-3): shipments with normalised status and events (`shipments.update`). A delivered shipment marks the order delivered, and failed, problem, returned or stalled (7 days) parcels list under Problems.
- [x] T-25 (F-INB-1, F-INB-2, F-INB-10): the inbox views, list and conversation, and the reply clock from each shop's reply hours (`pages/Inbox.tsx`, `lib_inbox.js`).
- [x] T-26 (F-INB-3, F-INB-4, F-INB-5, F-INB-6, F-INB-7): the composer: the agent's draft with why, and the marketplace warnings (`lib_inbox.lint`). It sends by copy and seller centre, through the agent or as marked sent (remembered per shop), handles failed sends, and asks for drafts one by one or all (`components/InboxParts.tsx`).
- [x] T-27 (F-INB-8, F-INB-9): conversation status, link or unlink an order, private notes, log a buyer message, and the buyer panel with orders and policies.
- [x] T-28 (F-CUS-1, F-CUS-2, F-CUS-3): customers across shops by email, else phone, else name in one shop. The list shows All or Repeat buyers, and the buyer panel edits in place (`pages/Customers.tsx`, `lib_customers.js`).
- [x] T-29 (F-APR-1, F-APR-2, F-APR-3, F-APR-4, F-APR-5): Approvals cards with before and after, risk and notes. Sets are approved all or in part (rechecked, stale items skipped) or rejected with a note, with J/K/A/R keys (`pages/Approvals.tsx`, `lib_proposals.js`).
- [x] T-30 (F-APR-6, F-APR-7, F-APR-8): History with outcomes and undo for listing, price and stock changes. Proposals expire after 14 days in `store_nightly`, and the guards set the risk.
- [x] T-31 (F-STG-1, F-STG-2, F-STG-3, F-STG-4, F-STG-5): Settings sections Business, Your AI agent (`settings.autonomy`, seller only), Guards, Stock and Buyer data, each saved when left (`pages/Settings.tsx`).
- [x] T-32 (F-STG-6, F-STG-7, F-STG-8): exchange rates with "Refresh now" (currency-api, then Frankfurter, 8 s, every six hours: `lib_store.fxRefresh`, `store_fx`), "Download everything" (`app.export`) and the activity trail.
- [x] T-33 (F-IMP-1, F-IMP-2, F-IMP-3, F-IMP-4, F-IMP-5, F-IMP-6, F-IMP-7): the import dialog. It reads CSV and Excel in the browser, matches columns from the usual export headers, maps statuses, previews, and sends batches of 200 to `imports.orders` and `imports.products`. Orders match on number and products on SKU, and the result and the last import show (`components/ImportDialog.tsx`, `lib_imports.js`).
- [x] T-34 (F-AGP-1, F-AGP-2, F-AGP-3, F-AGP-4, F-SRC-1): the agent panel with Chat (`chats.send`), Tasks (with cancel) and Activity, the task badges, and the search palette over `app.search` (`components/AgentPanel.tsx`, `components/SearchPalette.tsx`).
- [x] T-35 (F-AGT-1, F-AGT-2, F-AGT-3, F-AGT-10): the 96 declared operations in `operations.json`, generated from the catalog by `tools/gen.mjs`, and `app.guide` and `app.status` (`lib_guide.js`). The one batched `work_requested` trigger is written by `tools/gen_triggers.mjs`, and the task queue (`lib_tasks.js`, job `store_tasks`) asks again, re-queues after 30 minutes and fails after 3 hours.
- [x] T-36 (F-AGT-4, F-AGT-6, F-AGT-7): the agent's sync and record operations: the upserts matched on the shop's own ids, `shops.sync-finish`, `inbox.draft`, `inbox.sent`, `inbox.send-failed`, `shipments.update`, `stock.mark-pushed` and `chats.reply`.
- [x] T-37 (F-AGT-5, F-AGT-8, F-AGT-9): propose-or-run in `lib_ops.js` by the seller's limits, `proposals.create` and `proposals.withdraw`, the seller-only operations refused to the agent (`lib_auth.js`), and `--confirm true` on the remove operations.
- [x] T-38 (F-STG-5): the nightly buyer-data purge of addresses and phone numbers of finished orders (`lib_app.purge`, `store_nightly`), and the write guards that refuse raw record writes (`hooks.pb.js`).

## Verification
- [ ] Agent App Framework gate (`agent-app <dir> validate`) passes, including the describe budget on a dev instance.
- [ ] Every declared operation answers through `a2app` on a live instance.
- [ ] The View renders identically to the published build (screenshot comparison).
