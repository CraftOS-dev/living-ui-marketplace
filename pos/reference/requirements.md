# POS: requirements

A point of sale for cafes, restaurants and shops, from a one-person kiosk to
a few registers, a kitchen screen and an order board. The home page is the
register and must be usable by a new cashier without training; everything
else (products, stock, customers, reports, cash and shifts, settings) sits
one click away for the people allowed to use it. No emoji anywhere:
categories wear line icons.

Visual language: the Expenses tracker family. A warm canvas holding one app
shell with large rounded corners; a slim rail of white pill groups with round
icon buttons; white, sand and one dark card per screen, with no borders;
ink pills with an accent dot for a screen's main action; pill fields and
chips; round icon badges; large round touch targets at the counter (tiles,
keypad keys and the pay button are 56 to 64 px). Taking payment, a new
product and closing a register each grow out of the button that was pressed
into a full screen of numbered step cards. Manrope; one type scale of 12,
13, 14, 15 and 26 px on a 4 px grid; pointer cursor on everything
clickable. Every color comes from the host's theme tokens with
contrast checks in every pack, light and dark, and custom colors. The only
fixed colors are the states (green, amber, red, always with a label) and the
eight category hues (a till's categories stay recognisable from day to day).
Receipts print black on white. The app names no particular AI agent: it says
"your AI agent". Every page works down to 320 px wide.

## Money truth

1. Money is an integer of minor units in one currency; percentages are basis
   points. No floating point touches money on the server or at the counter.
2. Totals: line discounts first, then the order discount shared across lines
   by largest remainder; tax computed once per rate per receipt (not per
   line) with the shop's rounding (nearest, down, up), prices inclusive or
   exclusive of tax; a dine-in rate replaces a class's rate on dine-in
   orders (Japan's 8% food rate becomes 10%); the service charge applies to
   the net before tax and is taxed with its own class. Cash rounding (to 5
   or 10 minor units) applies only to the part paid in cash and is recorded
   as rounding.
3. The counter and the server compute the same totals to the minor unit.
   The server is the authority: it recomputes every sale and refuses one
   whose total changed since the counter priced it.
4. Sales, their lines and payments are written once and never edited or
   deleted. A refund or an exchange is a new sale whose return lines point
   at the lines they return; a line can never be returned more than once
   in total, and each return refunds exactly its share of the original
   discounts and tax.
5. Receipt numbers are gapless per register (R1-000001); a sale that fails
   takes no number. Training sales have their own series (TR1-...). Order
   numbers for calling orders restart every trading day. Every register keeps
   a hash chain over its sales.
6. A sale is recorded once even if the counter sends it twice (network
   retries): the same sale returns the stored result; a different sale under
   the same key is refused.
7. A trading day may end after midnight (day cutoff hour), so late-night
   sales count in the evening they belong to.

## Frame

8. A slim rail (wide screens) with the mark, then the pages in white pill
   groups: Register, Orders, Kitchen (when the kitchen is on); Products,
   Customers, Cash and shifts, Reports; Settings and the signed-in person at
   the bottom. The current page is a solid round button. Counts sit on
   Register (tickets your AI agent drafted), Kitchen (open tickets) and
   Products (drafts to review and low stock). On phones a floating bar with
   Register, Orders, the sale button raised in the middle (with the number
   of items), a menu for the rest, and the person. Each person sees only the
   pages their role allows.
9. The person at the register is always shown; their menu changes the PIN,
   locks the register or switches person. The register locks after the idle
   time in settings; the cart is kept.
10. A page left open picks up a new version of the app by itself, but never
    while a dialog is open or the cart has items.

## Setup and signing in

11. First open: two numbered step cards on one screen. The business name
    and the country (Malaysia, Singapore, Japan, Australia, New Zealand,
    United Kingdom, United States, other) set the currency, price mode, tax
    classes, tax rounding and cash rounding; then the owner's name and PIN.
    The register opens with a counted float.
12. The lock screen asks who is at the register (people as tiles) and their
    PIN on a keypad (or the keyboard). PINs are 4 to 6 digits, unique, stored
    salted and hashed. Five wrong PINs lock that person for five minutes. A
    person without a PIN chooses one at their first sign-in.
13. With more than one register, a new device asks which register it is.

## The register (home)

14. A greeting with the person's name, the date and the register's state;
    then product tiles by category: a row of pills (Amount, Favorites, All
    and each category with its color and icon), soft rounded square tiles
    showing the product's photo (or a round icon badge on the category's
    tint), with the name centered under the tile (a name too long rolls)
    and under it the price (or "from" price) when the shop shows prices on
    tiles (a setting, on at first), a sold-out mark, stock left when
    tracked and low. Tiles are big enough for fingers and keep their order.
15. Search (F2 or /) narrows the tiles as you type; Enter adds the only
    match. A barcode scanner works anywhere on the register: a product's SKU,
    a size's SKU or a barcode adds it; a receipt number opens its return; an
    unknown code offers to attach it to a product.
16. A product with sizes or options opens a dialog: sizes, option groups
    (each in its own card) with their minimum and maximum (required groups
    say so), quantity and a note. The Amount pill opens a keypad for an
    amount with no product.
17. The sale on the right, always in view in its own card (a full-screen
    sheet on phones, opened from a pill with the item count and total or
    the bar's sale button): order type (dine-in, takeaway, delivery), ticket
    name, customer, lines as soft rows with their options and notes; tapping
    a line opens quantity, discount, price change, note and options;
    removing a line offers Undo. The dark card at its foot holds subtotal,
    discounts, service charge, tax per rate (with its receipt mark), the
    total and the pay button.
18. Discounts: presets or a typed percent or amount, on a line or the order.
    A cashier's discount above the shop's limit, a price change, a refund, a
    blind return, voiding a ticket and moving cash need a manager: the
    manager types their PIN on the same screen and the action goes through
    with their name on it.
19. Arrange mode (people who may change products): drag tiles to reorder
    them, and a tile menu to mark a favorite, mark sold out or edit.
20. Keyboard: F2 search, F9 pay, Esc back.

## Paying and receipts

21. Pay grows out of the pay button into a full screen of three numbered
    steps: how (the methods the shop turned on, as tiles), the amount (due
    on a dark display, large), and the button that takes it.
    Cash: quick amounts (exact and the next notes), a keypad, change due.
    Card and other: the exact amount, with a reference when the method asks
    for one. QR: shows the shop's QR image (and on the customer display).
    Payments can be split across methods; the remaining balance is always
    shown; card payments cannot exceed what is due.
22. Done (the same screen turns into it): the change due large, the receipt
    number and order number, print or email the receipt (or print
    automatically, by setting), New sale, which shrinks the screen back
    into the register.
23. Receipts: the shop's logo, details, tax and company numbers, header and
    footer; every line with options and discounts; tax per rate with marks;
    service charge; payments, change and rounding; the cashier; a barcode of
    the receipt number (by setting); 80 or 58 mm paper. Reprints are marked
    as copies and recorded.
24. The customer display (a second window on the same machine, facing the
    customer) mirrors the cart, the amount due, the QR code to scan and the
    change.

## Returns, exchanges and tickets

25. Return items: find the receipt (number, scan, or today's recent
    receipts), choose lines and quantities still returnable, restock or not,
    then add new items for an exchange. Refunds go back to the original
    methods by default; the person can refund in cash instead, the whole
    refund in one tap or part of it typed. A return without a receipt needs
    a manager.
26. Open tickets: save the sale with a name (a table, a tab, a phone order),
    see every open ticket with its age and total, resume it on any register,
    release it, or void it with a reason (manager). Tickets your AI agent
    drafted are marked.

## Kitchen and order board

27. Products in categories marked for the kitchen make a kitchen ticket when
    the order is paid: order number, name, order type, items with options and
    notes, time waiting. Tickets go new, ready (the number is called),
    collected; recall moves one back. Open and collected views.
28. The order board (any device) shows the numbers being prepared and ready
    to collect, large, with zoom.

## Products and stock

29. Products: status chips (for sale, drafts to review, archived) with
    counts, category filter, search, a for-sale switch per product, sold-out
    count. The editor grows out of the product (or the new-product button)
    into a full screen of three numbered steps. What it is: name, category,
    price or open price, tax class. Sizes and options: sizes (each with
    price, SKU and cost) and the options offered. Stock and details: SKU,
    cost, barcodes, stock tracking with opening stock and a low level, for
    sale now, favorite, tile color, photo, description. Archive and
    restore; nothing that was sold is deleted.
30. Categories (name, color, line icon, kitchen, order), option groups
    (options with prices, defaults, minimum and maximum, sold out per
    option) and discount presets (percent or amount, order or line).
31. Stock for tracked products and sizes: levels with low and out, receive,
    adjust with a reason, count, history per product. Sales take stock out,
    returns put it back when restocked; training never touches stock.
32. Import: a CSV with a template and row-by-row problems; menus and price
    lists (photos, PDFs, spreadsheets) read by your AI agent into drafts that
    a person approves or discards.

## Customers, reports and activity

33. Customers: search by name, phone or email; a card each, opening contact details,
    notes for the counter, marketing consent, visits, spend, top products and
    recent receipts; archive.
34. Reports: today, yesterday, the last 7 or 30 days, this month or chosen
    dates, per register or all: collected, net sales, orders, average order,
    refunds, discounts, tax and service charge, each against the previous
    period (collected leads on the dark card); collected by hour (one day)
    or by day; top products and categories; payment methods as a ring with
    its legend; taxes by rate; staff; CSV export. Training sales never
    count.
35. Activity: the audit trail of every sale, refund, override, void, cash
    move, shift, sign-in failure, PIN lock, approval, reprint, receipt email
    and change to staff, settings, products, stock and customers, by person,
    agent or system; grouped (money, exceptions, changes, your AI agent),
    filtered and searchable.

## Cash and shifts

36. A register is opened with a float counted by denomination. While open:
    cash in, cash out and safe drops with a reason (a cashier needs a
    manager), and the X report.
37. Closing is blind, on a full screen of two numbered steps that grows out
    of the close button: the person counts the drawer by denomination
    before the screen shows what was expected; then the difference, a note
    when it is over or short, and the Z report: orders, net sales, tax, service charge, discounts, refunds,
    payment methods, cash expected and counted, cash moves, voids and
    overrides. The Z report is frozen at close and printable. Shift numbers
    are gapless per register. Closing a register asks your AI agent for the
    day's brief.

## Staff and settings

38. Roles: an owner can do everything; a manager everything but settings and
    staff; a cashier sells, saves tickets, gives discounts up to the limit,
    opens and closes the register, adds customers, works the kitchen screen
    and reprints. Training mode per person.
39. Settings (owner): business and receipts; taxes and money (price mode,
    tax rounding, cash rounding, tax classes with a dine-in rate and a
    receipt mark); selling (order types and the default, service charge,
    the cashier discount limit, kitchen, order numbers, idle lock, day
    cutoff); payment methods (cash, card, QR with its image, other; asking
    for references); registers; staff (add, role, color, reset a PIN,
    training, turn off). A page showing what your AI agent does here.

## The AI agent

40. Every action in the UI has a CLI operation. The agent reads everything
    and runs the back office: catalog, stock, customers, imports, reports,
    receipt emails, draft tickets for phone or chat orders, business details
    and receipt wording, clearing a forgotten PIN when the owner asks.
41. The agent never moves money: it cannot take payments, refund, void
    tickets, open or close a register or move cash. It cannot see or set
    PINs, add staff, change roles, change taxes, payment methods, registers
    or owner settings, or approve the products it imported.
42. The app hands work back through triggers: read waiting menu files into
    drafts; email a receipt; write the day's brief when a register closes.
    What the agent does is recorded as done by the agent.
