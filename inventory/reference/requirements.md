# Inventory: requirements

For a small team's stockroom (a shop's back room, a workshop, a small
warehouse, a van): what is in stock, where it is, and when to reorder. One
currency, no accounts or sign-in. The front shows what matters; everything
else is one click away. No emoji anywhere: categories wear line icons.

Visual language: the same family as the Expenses tracker. A warm canvas
holding one app shell with large rounded corners; white, sand and one dark
card per page; dark primary pills with an accent dot; generous radii, no card
borders; Manrope; one type scale of 12, 13, 14, 15 and 26 px on a 4 px grid;
pointer cursor on everything clickable. Every color comes from the host's
theme tokens, with contrast checks in every pack, light and dark. The only
fixed colors are the stock states (green in stock, amber low, red out),
always shown with a label too. The app names no particular AI agent: it says
"your AI agent". Numbers read "1,234.50" whatever the browser language. Every
page works down to 320 px wide.

## Stock truth

1. Every quantity comes from a ledger of changes; nothing types a quantity
   into a record. Each action (a receipt, a move, a scanned list, a count) is
   one batch with one Undo. Undo keeps both in the history; deleting a batch
   from the history takes the stock back as if it never happened.
2. Stock cannot go below zero unless the setting allows it.
3. Every scannable code (an item's SKU, its extra barcodes, a place's code)
   is unique, so one scan always means one thing. SKUs and place codes are
   numbered automatically when left empty.
4. Statuses: out (nothing on hand), low (at or below the reorder point),
   over (above the target level, when it is above the reorder point), in
   stock. An item needs reordering when on hand plus incoming is at or below
   its reorder point; the suggestion fills it to the target level (twice the
   reorder point without a target above it). Usage and
   days left come from what went out over the last 30 days.
5. Costs keep up to 4 decimals; receipts with a cost move the item's
   average cost.

## Frame

6. A slim icon rail on the left (wide screens): Home, Items, Locations,
   Activity; Scan, Reorder, Purchase orders, Stock counts; Suppliers,
   Labels, Import and export, Settings at the bottom. Counts sit on Reorder
   (items to reorder), Purchase orders (late orders and unreadable
   documents) and Stock counts (in progress). On phones a floating bottom bar
   with Home, Items, a raised "+" (stock change), Scan and a menu for the
   rest.
7. A scanner scan anywhere outside a form opens its item or place; a code
   nothing has yet offers to create an item with it or add it to one.

## Home

8. Greeting, date, a search box (a typed or scanned code opens its item or
   place), New item and Stock change.
9. Status pills for documents with the AI agent, documents that could not be
   read, late orders and counts in progress.
10. Until items and reorder points exist, a setup checklist: places, items
    (or import), reorder points, suppliers.
11. Stock health: a ring of items in stock, low, out and over, with a legend,
    the number of items in the middle and shortcuts (scan, reorder, count) in
    its gap; a slice or legend row opens those items.
12. Stock value at average cost, units, items and places, items to reorder,
    stock idle for 90 days.
13. Needs attention: out and low items with level bars; Reorder; ask the AI
    agent to draft the orders.
14. Stock in and out over 30 days (in above the line, out below); a day opens
    its history.
15. Coming in (open orders with expected dates and progress), most used
    (30 days), where it is (value by top-level place), recent activity with
    Undo.

## Stock change and items

16. The "+" grows into a full screen (circular reveal) of three numbered
    steps: the item (search or scan), how many on a keypad (In, Out, Move,
    Set; the physical keyboard works too), where and why (places that hold
    it, other places, reasons, cost on receipts, note), Save. A pill offers
    Undo after saving.
17. New item grows into a full screen of three steps: what it is (photo,
    name, category, unit, part units), codes and place (SKU, barcodes by
    scanning, starting stock and its place, or the home place), reorder and
    buying (reorder point, target level, supplier, cost, lead time,
    description). Only the name is required. Edit uses the same screen and
    adds archive and delete.
18. Items: search (name, SKU, barcode, description), status chips with
    counts, category, place, sort, active or archived; photo cards or a list;
    quick In and Out on each; more load on scroll; select mode with category,
    labels, archive and delete.
19. Item page: on hand and its worth, In / Out / Move / Set, incoming,
    reorder point, target, how long it lasts; the stock level since it was
    added (up to 90 days) with the reorder line; where it is with a move from
    each place; reordering with a one-step draft order and the open order
    lines; codes and its label; history with Undo.

## Places and scanning

20. Locations as a tree: expand a place, add a place inside it from its row.
    A place shows its items (and those inside it), units and value, the
    places inside it, Count here, its label, edit and delete (only when
    empty; places inside move up a level, and only where they fit).
20a. Places come in 14 kinds: site, room, area, container, vehicle, pallet
    rack, shelf, cabinet, fridge, drawer, pallet, bin, box and other. They
    nest by size: a site holds anything but a site; a room holds areas,
    vehicles and furniture; an area holds containers, vehicles and furniture;
    a container holds racks and furniture; a vehicle holds shelves, cabinets,
    fridges, drawers, pallets, bins and boxes; a rack holds pallets, bins and
    boxes; a cabinet or fridge holds shelves, drawers, bins and boxes; a
    shelf, drawer or pallet holds bins and boxes; bins and boxes hold
    nothing; "other" holds shelves, drawers, pallets, bins, boxes and other
    places. Any kind may stand at the top level. A place that does not fit
    is refused with what its parent can hold; the place form only offers
    kinds and parents that fit, and import picks fitting kinds for the
    levels it creates.
21. Scan page: look up, receive, take out, move. Scanning a place's label
    sets the place (in move: first where it comes from, then where it goes).
    Each scan adds to a list (scanning again adds to its line; each scan
    counts N); the list is recorded as one change. Unknown codes offer a new
    item or adding the code to one. Beeps can be turned off.

## Buying

22. Reorder: suggestions grouped by supplier with editable quantities, a
    plain-words reason for each, the drafts they are already on; a draft order
    per supplier, or all at once; ask the AI agent; a setting lets the AI
    agent draft orders on its own whenever an item newly runs low (it never
    sends them).
23. Purchase orders: open, drafts, ordered, partly received, received,
    cancelled. An order shows its lines (quantity and cost editable until it
    is received), totals, details (supplier, deliver to, expected, note), the
    AI agent's note, receipts with Undo and its documents. Draft: mark as
    ordered (expected date from the supplier's lead time), or let the AI
    agent email it to the supplier. Ordered: receive (all or part, to a
    place), back to draft, cancel. Partly received: close short. Cancelled
    or closed: reopen. Any: order as text, delete.
24. Documents: drop packing slips or invoices (photos or PDFs); the AI agent
    reads them and records what arrived, with a summary; unreadable ones say
    why and can be retried or deleted.
25. Suppliers: contact, delivery days, notes, items supplied, latest orders;
    add, edit, delete (their items and orders stay).

## Counts, history, labels, data

26. Stock counts for a place (and inside it) or everything, optionally
    blind. Scan to count (each scan adds one), type counts, mark a line as
    matching, add something found elsewhere; filter lines. Review shows the
    differences and their value; lines not counted are kept or set to zero;
    completing sets the counted stock. Reopening undoes the count's changes.
27. Activity: every change grouped by day and by action, with who made it
    (you, your AI agent, the app) and its source (order, count, import);
    filters by kind, who, place, item, dates; Undo; delete from history;
    export as CSV.
28. Labels for items (SKU) and places (code): barcode (Code 128) or QR, label
    rolls (50 x 25, 62 x 29, 100 x 50 mm) or sheets (A4 24 up, Letter 30 up),
    name on or off, copies; a preview of the first page; print.
29. Import items from CSV: columns matched by header and choosable;
    quantities set the stock or add to it; missing categories, suppliers and
    places created on request; rows with problems listed and skipped; undo.
    Export items, stock by place (importable back as a stock take) and the
    history.
30. Settings: currency (relabels costs), stock below zero, automatic agent
    drafts, categories (rename, line-icon picker, add, delete).

## Stockroom map

33. A card across the full width of Home, above Stock health and Stock
    value: the stockroom as a 3D isometric model to move around, zoom and
    work in.
    A white card; places stand on sand platforms; every color comes from the
    theme, and the stock states keep their fixed colors with labels.
34. What it shows: each top-level place is a base drawn by its kind: a site
    is a warehouse floor with walls and a roll-up door, a room a floor with
    two walls and a door, an area a marked floor, a container a shipping
    container with its doors open, a vehicle a van; furniture standing on
    its own sits on a low plinth. The places inside stand on it as models of
    their kind: shelving, a pallet rack with beams and decking, a cabinet
    with its doors open, a fridge with a glass door, a drawer unit with the
    top drawer pulled out, a pallet, a bin, an open carton with its flaps
    out, a room, a container, a van. Places deeper down count toward the
    one that holds them. Each item stored in a place takes a spot with one
    to three of its shape (how full it is against its target level) in its
    status color. The shape follows the unit it is counted in (rolls, a
    cable reel for lengths, a sack for weights, a bottle for liquids, a
    taped carton for boxes, a pack, a pair, a kit case for sets, cans,
    reams of sheets) and, for plain pieces, its category (a tool case,
    electronics, a spray bottle for cleaning, cans for food); anything else
    is a crate. An item that is out of stock shows as a dashed red empty
    spot at its home place.
35. Moving around: the view is always the same isometric angle; drag to
    move around, scroll or pinch to zoom; buttons zoom and fit everything,
    and the arrow keys move. The view eases from one position to the next.
    On first view the bases rise and the items drop in; reduced motion turns
    the animation off.
36. Pointing: hovering a place or an item lifts it a little and shows its name
    and figures. Clicking a place flies to it and opens its panel: items,
    units and value, what is stored there with quick In and Out, the places
    inside it, Stock change here, Count here and Open place. Clicking a box
    opens the item: how much is here and in total, its level, where else it
    is (each place flies there), In, Out, Move and Open item.
37. Managing: drag a box onto another place to move it there. The stock
    change screen opens with the item and both places filled in, so the
    amount is confirmed on the keypad. On touch, press and hold a box to
    pick it up.
38. Filters: All, Low, Out and Over with counts; the other boxes fade. Find
    an item: its boxes pulse and the view frames them.
39. Arrange: lay the map out like the real space. Press any place (a site,
    a room in it, an area, a rack, a shelf) or its label to pick it; drag it
    to move it, drag its corner handles to resize it, with its size shown
    while resizing. A place moves within the space it stands in (it stays
    inside the walls), and what stands in it moves with it; furniture made
    wider or deeper holds more spots, and a space cannot shrink past what
    stands in it. Everything snaps to a grid and places cannot overlap (a
    place dragged where it cannot go turns red and goes back). Each change is
    saved in one go for everyone, keeping everything else where it stands;
    the AI agent can set it too, and Reset layout returns to the automatic
    one. While an item is carried it stays right under the pointer.
40. It is live: when stock changes (here, on another screen or by the AI
    agent) the boxes grow, shrink, arrive or leave, and glow for a moment.
41. Expand shows the map full screen. Keyboard: arrows move around, plus and minus
    zoom, 0 fits everything, Escape closes the panel; the places are also a
    list for keyboards and screen readers. Without 3D support the card says
    so and links to Locations.
42. Operations: map.get (places with their layout and figures, items with
    their status, stock by place), locations.place (set or reset where one
    place stands and how big it is) and locations.arrange (several places at
    once, all or nothing).

## The AI agent

43. Every action in the app is an operation the AI agent can call; the app
    guide explains the conventions and recipes.
44. The app hands work to the AI agent: drafting reorders, reading documents,
    emailing a purchase order. Requests show honestly in the app (sent,
    working, done or refused) and say that it picks them up while the AI
    agent is running.
