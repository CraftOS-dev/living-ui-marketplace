/// <reference path="../pb_data/types.d.ts" />
/**
 * app.guide: how the AI agent operates this app through the agent-app CLI.
 * Conventions plus ready-to-run recipes for the jobs a user actually hands
 * over ("we got a delivery", "what is running low", "count shelf B").
 */

function guide(app) {
  const u = require(`${__hooks}/lib_util.js`);
  const core = require(`${__hooks}/lib_core.js`);
  const ix = require(`${__hooks}/lib_locations.js`).index(app);
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const s = core.settings(app);
  const run = 'agent-app run <project>';
  const reasons = {};
  for (const k of Object.keys(ledger.REASONS)) reasons[k] = ledger.REASONS[k];
  return {
    app: 'Inventory: what a small team has in stock, where it is kept, and when to reorder. One currency; no logins.',
    today: u.today(),
    currency: s.getString('currency'),
    negative_stock_allowed: s.getBool('allow_negative'),
    auto_restock: s.getBool('auto_restock'),
    locations: ix.list.map((l) => ({ code: l.code, path: ix.path(l.id), kind: l.kind })),
    place_kinds: require(`${__hooks}/lib_locations.js`).KINDS,
    place_holds: require(`${__hooks}/lib_locations.js`).HOLDS,
    categories: app.findRecordsByFilter('categories', '', 'sort,name', 0, 0).map((c) => c.getString('name')),
    category_icons: require(`${__hooks}/lib_icons.js`).ICONS,
    reasons: reasons,
    conventions: [
      'Places nest by size: place_holds lists what each kind of place can hold (a vehicle never goes inside a box). Any kind may stand at the top level. locations.add and locations.update refuse a place that does not fit, and say what the parent can hold.',
      'Quantities only change through operations: stock.in, stock.out, stock.move, stock.set, stock.batch, orders.receive, counts.complete (and items.add with qty, import.run, counts.reopen). Every change is a history entry with a batch id; movements.undo --batch <id> reverses it, cost included (a CSV import is undone as a whole with import.undo). Never try to write the stock or movements collections directly (refused).',
      'item: an item id, its SKU, one of its barcodes, or its exact name. location: an id, its code (e.g. LOC-001), its exact name, or its path ("Main stockroom / Shelf A"). supplier and category: id or exact name. order: id or number (PO-0001). count: id or number (C-0001).',
      'qty: a plain number with "." as the decimal point and no thousands separators (12 or 2.5). Items are whole units unless fractional=true.',
      'unit_cost: a plain number in ' + s.getString('currency') + ' per unit, up to 4 decimals (0.034 is fine), never negative. Receiving with a cost moves the item\'s average cost.',
      'Money in results: unit_cost and every *_text field (value_text, total_text, suggested_value_text) are plain amounts in ' + s.getString('currency') + ', ready to read. The integer money fields (value, total, unit_cost_e4, in_value, out_value, suggested_value) are in ten-thousandths of ' + s.getString('currency') + ' (450000 = 45.00), for arithmetic only.',
      'Statuses: out (nothing on hand), low (on hand at or below min_qty, the reorder point), over (above max_qty, the target level, when that is above the reorder point), ok. An item needs reordering when on hand plus incoming is at or below min_qty; the suggestion fills it to max_qty, or to twice min_qty when there is no target level above the reorder point.',
      'Lists (ids, lines, items) are JSON strings, e.g. --lines \'[{"kind":"in","item":"SKU-0001","qty":5}]\'.',
      'Every write returns the stored result: read it back (on hand, status, message) before telling the user it is done. Confirm with the user before any destructive operation (deletes, import.undo).',
      'Location may be left out when it is obvious: stock.in uses the item\'s home location (or the first top-level place when it has none); stock.out, stock.move and stock.set use the only place that holds the item, or its home location when that holds some (stock.set on an item stocked nowhere uses its home). Otherwise the error lists the places with how much each holds. In stock.batch every line is worked out before any runs, so give the location when an earlier line of the same batch is what puts the item there.',
      'Lists are short by default: movements.list returns the newest 25 entries (--limit up to 500, --offset to page; more=true means there are older ones).',
    ],
    recipes: {
      'Find an item': run + ' items.list --q "tape" (search name, SKU, barcode, description); ' + run + ' items.get --item SKU-0001 for stock per location, history and open orders.',
      'What is running low / needs reordering': run + ' reorder.list (grouped by supplier, with a "why" for each suggestion); ' + run + ' items.list --status low (or out, over, reorder).',
      'Add a new item': run + ' items.add --name "Packing tape 48mm" --category "Packaging" --unit roll --min_qty 10 --max_qty 40 --unit_cost 2.35 --supplier "<existing supplier>" --barcode 0012345678905 --qty 24 --location LOC-001 (qty and location record the opening stock; leave out sku to get SKU-0001 style numbering).',
      'Stock came in (not on a purchase order)': run + ' stock.in --item SKU-0001 --qty 12 [--location LOC-001] [--reason received|returned|found|produced] [--unit_cost 2.35] [--note "..."]',
      'Stock was used or sold': run + ' stock.out --item SKU-0001 --qty 3 [--location LOC-001] --reason used|sold|damaged|lost|expired|sample|returned',
      'Move stock': run + ' stock.move --item SKU-0001 --qty 5 --from LOC-001 --to LOC-002',
      'The stockroom map (Home)': run + ' map.get shows every place with its map layout, the items stored or missing, and stock by place. To lay the map out like the real space: ' + run + ' locations.place --location LOC-001 --x 6 --z 4 --w 10 --d 6 (map units of about a metre; x and z are the centre: on the floor for a top-level place, measured from the far corner of its parent for a place inside another; w and d are the size, empty for automatic). Several at once, all or nothing: ' + run + ' locations.arrange --positions \'[{"location":"LOC-001","x":6,"z":4,"w":10,"d":6},{"location":"Shelf A","x":1,"z":0.75}]\'. Give w and d to place precisely: a place without a size is drawn as big as its contents need. Refused, with the reason: two places with a size overlapping in the same space, a place outside a space whose size is set, and a place inside furniture (drawn as part of it; place the furniture). --reset true puts one back to the automatic layout; locations.place --all true --reset true resets them all.',
      'Correct a quantity (what is really there)': run + ' stock.set --item SKU-0001 --location LOC-001 --qty 18 [--reason correction]',
      'Several changes as one action': run + ' stock.batch --lines \'[{"kind":"out","item":"SKU-0001","qty":2,"reason":"sold"},{"kind":"move","item":"SKU-0002","qty":4,"from":"LOC-001","to":"LOC-002"}]\' [--note "..."]',
      'Draft purchase orders for everything low': run + ' reorder.list, check the suggestions (on hand, incoming, usage, supplier), then ' + run + ' reorder.create-orders [--items \'[{"item":"SKU-0001","qty":30}]\'] --note "<why, in one or two sentences>". This creates or updates ONE draft per supplier (idempotent). Never mark orders as ordered unless the user says so.',
      'Create an order by hand': run + ' orders.create --supplier "<name>" --lines \'[{"item":"SKU-0001","qty":20,"unit_cost":"2.10"}]\' [--expected_on YYYY-MM-DD]; then orders.add-line / orders.update-line --line <id> / orders.remove-line; ' + run + ' orders.mark-ordered --order PO-0001 once it is sent.',
      'A delivery arrived for an order': run + ' orders.get --order PO-0001 (lines with what is still to come), then ' + run + ' orders.receive --order PO-0001 --lines \'[{"line":"<line id>","qty":10}]\' (or --all true when everything came). Short deliveries stay open as "partial"; orders.close when the rest is not coming.',
      'Email an order to its supplier': run + ' orders.text --order PO-0001 gives the recipient, subject and body; send it only when the user asked, then ' + run + ' orders.mark-ordered --order PO-0001.',
      'A packing slip or invoice (photo or PDF)': run + ' documents.add --path "<absolute path>" stores it, then read it as in the documents_waiting trigger: match it to an open order and orders.receive, or stock.in / stock.batch for stock not on an order; finish with documents.complete --document <id> --summary "<what was recorded>" [--order PO-0001] [--batch <batch>].',
      'Count a shelf': run + ' counts.start --location LOC-002 [--blind true]; then counts.scan --count C-0001 --code <barcode> per item counted, or counts.set-line --line <id> --counted 14; review with counts.get --count C-0001 --reveal true; finish with counts.complete --count C-0001 [--uncounted keep|zero].',
      'History': run + ' movements.list [--item SKU-0001] [--location LOC-001] [--from YYYY-MM-DD --to YYYY-MM-DD] [--actor agent]. Undo a change with movements.undo --batch <batch>.',
      'Spreadsheet of items (CSV)': '1) ' + run + ' import.preview --path "<absolute path>" shows the column each field was matched to, counts (create, update, invalid) and problems per row. 2) Fix a mapping with --import_id <id> --map_quantity 4 (column number, first is 0) or --map_quantity "On hand"; choose --quantities set (the numbers are what is on the shelf) or add (a delivery). 3) ' + run + ' import.run --import_id <id> [same options]. import.undo --import_id <id> reverses it.',
      'Export': run + ' export.items (details and figures), export.stock (per location; importable back as a stock take), export.movements --from YYYY-MM-DD --to YYYY-MM-DD. Each returns the CSV text: save it where the user wants.',
      'Overview': run + ' dashboard.summary (stock value, statuses, the last 30 days of movement, what needs attention, incoming orders).',
    },
  };
}

module.exports = { guide: guide };
