# Advance POS: requirements

Binding. The bar is the current leading point of sale systems (Square,
Shopify POS, Toast, Lightspeed, Clover): a cashier rings up a sale in a few
taps with no training, and the owner runs the shop (catalog, stock, cash,
customers, staff, promotions, reports) from the same app. Money is exact,
nothing financial is ever deleted, and every sensitive action is recorded.

## Who uses it

- Cashiers: sell, take payment, print or send receipts, look up a sale.
- Managers: returns, voids, discounts over the limit, cash in and out,
  closing the drawer, stock, reports, staff.
- The owner: everything, including settings and permissions.
- Your AI agent: through the same operations (the `agent-app` CLI) with
  its own permission role. It sends receipts, reviews each closed shift,
  drafts restock lists and answers questions about the business.

## Money and numbers

1. One currency per store, set at setup (ISO code and its minor digits).
   Every amount is stored as whole minor units (cents); operations accept
   and answer major units as text ("4.50") and minor integers alongside.
2. Prices include tax or exclude it (a store setting). Taxes are computed
   per rate on the order, then shared back to the lines so lines add up
   exactly. Rounding is half away from zero.
3. Cash rounding (to 0.05, 0.10 or any step) applies only to cash paying
   the last of the balance and is recorded on the sale.
4. Quantities may have up to 3 decimals (items sold by weight).

## Selling (the home page)

5. Home is the register: a product grid (favorites first, categories,
   search, barcode scan from any wedge scanner without clicking) beside the
   cart. Each product is a square tile showing its picture (or its initials
   in its color) with the name centered under the tile (a name too long
   rolls) and under it the price, when the store shows prices on tiles (a
   setting, on at first). Tap a product to add it; products with variants
   or required options ask once, in one small dialog. One big Charge button
   shows the amount due.
6. The cart is stored on the server as an open ticket: a reload, a second
   register or your AI agent sees the same cart. Tickets can be named and
   parked, and picked up again from any register.
7. Lines: change quantity, set a price (permission), discount by percent
   or amount with a reason (over the cashier's limit needs a manager PIN),
   note, remove. Order: customer, ticket name, note, order discount
   (manual, a promotion, or a coupon code), tax exemption (permission).
8. Automatic promotions apply on their own and show on the line:
   percent or amount off items, categories or the whole order, minimum
   spend, buy X get Y, scheduled days and hours, coupon codes.
9. Charge: cash (exact and next bills, change shown large), card from the
   shop's own terminal (approval code or last 4 recorded when the store
   asks), gift card, store credit, loyalty points, and the store's own
   tenders. Split across any tenders; split evenly. Tips with presets when
   enabled. A payment taken by mistake can be voided before the sale
   completes. Double submits never charge twice.
10. When paid: a receipt number, stock goes down, gift cards are issued or
    topped up, points are earned, the customer's history updates. The
    receipt screen offers Print (58 or 80 mm), Send through your AI agent
    and New sale.
11. Returns and exchanges are one flow: from a past sale, pick what comes
    back (never more than was bought, at the price actually paid), choose
    to restock, add new items for an exchange, and settle the difference
    to cash, card, store credit or a gift card. Returns without a receipt
    need the return permission.
12. A second screen shows the customer the cart and the total live.

## Cash and shifts

13. Each register has a drawer session (shift): open with a counted float,
    pay in, pay out, open the drawer without a sale (recorded), a live X
    report, close by counting (by denomination or a total) against the
    expected cash, with the difference recorded and a Z report kept.
14. A store setting requires an open shift before selling.

## Staff and permissions

15. Staff sign in at the register with a 4 to 8 digit PIN (stored as a
    salted hash); the register locks on demand, after idle minutes and
    optionally after each sale. Wrong PINs are rate limited.
16. Roles owner, manager, cashier and agent each have a set of permissions
    (editable by the owner). A missing permission can be granted for one
    action by a manager's PIN, recorded as the approver.
17. Time clock: clock in and out, entries editable by managers, hours in
    reports.

## Catalog and stock

18. Products with categories, images, colors, description, tax rate (or
    exempt), favorites, modifier groups (options with prices, minimum and
    maximum choices), and variants built from up to three options (size,
    color); each variant has its own SKU, barcode, price, cost and stock.
    Codes are unique across the store.
19. Stock per variant from an append-only ledger: sales, returns,
    receiving (updates the average cost), adjustments with a reason, and
    counts. Low and out of stock views; stock value at cost.
20. Import and export products and customers as CSV.

## Customers

21. Customers with contact, notes, tax exemption, marketing consent, visit
    and spend history, loyalty points and store credit (each an
    append-only ledger with adjustments by permission).
22. Gift cards: sold as a line (issued or topped up when the sale is
    paid), redeemed as a tender, balance lookup, adjustments by
    permission, every movement recorded.

## Reports

23. For any date range (and register or staff member): gross sales,
    returns, discounts, net sales, tax, tips, rounding, total collected by
    tender, cost and gross profit, number of sales and average sale; by
    hour, day, category, product, staff member, tender, tax rate and
    discount; top sellers. CSV export of sales and of each breakdown.

## Records and audit

24. Paid sales, payments, shifts, stock and balance ledgers and the audit
    log are permanent: a mistake is corrected with a return, a void (open
    sales only) or an adjustment, never by deleting. Everything else
    (products, variants, categories, taxes, modifiers, discounts, gift
    cards with no history, customers, registers, staff with no history,
    time entries, requests) can be deleted with a preview of what it
    affects.
25. The audit log records voids, removed lines, price overrides,
    discounts, returns, drawer openings, cash movements, shift open and
    close, sign in and failed PINs, approvals, and changes to staff,
    permissions and settings.

## The AI agent

26. Every action in the app is an operation the agent can run
    (`agent-app run <project> <op>`); `app.guide` teaches the conventions.
27. Triggers hand work to the agent: send a receipt to a customer, review
    a closed shift, draft a restock list, answer a question about the
    business. Each is a request the person can follow in the app.

## Design

28. The visual system follows Inventory and CAD Workshop: the icon rail,
    the warm palette and dark accent cards from Inventory, CAD Workshop's
    compact density (28 px controls, 4 to 10 px corners, hairline panels,
    dense tables). The register's touch targets are at least 44 px. Every
    color comes from the theme tokens with contrast checked in all 16
    packs, light and dark. Line icons only, no emoji. Hash routes.
29. The interface explains itself through what it shows; help lives in
    tooltips. Works from a 360 px phone to a wide desktop.
