/// <reference path="../pb_data/types.d.ts" />
/**
 * app.guide: what an AI agent needs before operating the POS, in one call.
 * Conventions, today's trading day, the money format, the catalog's shape,
 * what the agent may and may not do, and ready-to-run recipes.
 */

function guide(app) {
  const util = require(`${__hooks}/lib_util.js`);
  const core = require(`${__hooks}/lib_core.js`);
  const s = core.shop(app);
  const st = s.record;
  const example = s.exp === 0 ? '500' : '4.50';
  return {
    app: 'POS: point of sale for ' + (st.getString('business_name') || 'a shop (not set up yet)'),
    setup_done: s.setup_done,
    today: util.businessDay(s.day_cutoff_hour),
    currency: s.currency,
    currency_decimals: s.exp,
    prices: s.price_mode === 'inclusive' ? 'Prices include tax.' : 'Prices are before tax; tax is added at checkout.',
    conventions: [
      'Money you send is text in ' + s.currency + ' major units with "." as the decimal point, e.g. price=' + example + '. Money you read is an integer of minor units (' + (s.exp === 0 ? 'yen-like: no decimals' : '1/' + Math.pow(10, s.exp) + ' of a unit') + ') next to a *_text field in major units.',
      'Percentages are text like 10 or 12.5.',
      'Products are named by id, SKU, barcode or exact name; categories, tax classes, modifier groups and discounts by id or exact name; registers by id or code (R1); sales by id or receipt number (R1-000123).',
      'Lists and objects are JSON strings, e.g. --variants \'[{"name":"Large","price":"' + example + '"}]\'.',
      'Days are trading days written YYYY-MM-DD (local date' + (s.day_cutoff_hour > 0 ? ', a day ends at ' + s.day_cutoff_hour + ':00 the next morning' : '') + ').',
      'Training sales are practice: they never count in reports, stock or cash.',
      'Everything you change is recorded in the audit trail as done by your AI agent.',
    ],
    you_may: [
      'Read everything: sales, receipts, shifts and Z reports, stock, customers, reports, the audit trail.',
      'Run the catalog: categories, products (variants, barcodes, modifier groups, stock tracking), modifier groups, discounts, sold-out switches.',
      'Receive, adjust and count stock.',
      'Add and update customers.',
      'Import menus and price lists (products you import wait for a person to approve them).',
      'Save a ticket for an order you took by phone or chat (tickets.draft): staff take the payment.',
      'Email receipts to customers (receipts.email asks you through the receipt_email_requested trigger).',
      'Change the business details and receipt wording in settings (business_name, address, phone, email, website, receipt_header, receipt_footer).',
      'Clear a forgotten PIN when the owner asks (staff.reset-pin): that person chooses a new one at their next sign-in.',
    ],
    you_may_not: [
      'Take payments, refund, void tickets, open or close a register, or move cash: these happen at the counter under a person\'s PIN. If a refund is due, tell the user what to refund and why.',
      'See, set or receive any PIN, add staff or change roles.',
      'Change taxes, prices modes, payment methods, registers or other owner settings.',
      'Approve the products you imported.',
    ],
    tax_classes: app.findRecordsByFilter('tax_classes', 'archived = false', 'sort', 0, 0).map((t) => ({
      id: t.id,
      name: t.getString('name'),
      rate: util.bpText(t.getInt('rate_bp')) + '%',
      dine_in_rate: t.getInt('dine_in_rate_bp') >= 0 ? util.bpText(t.getInt('dine_in_rate_bp')) + '%' : '',
      is_default: t.getBool('is_default'),
    })),
    categories: app.findRecordsByFilter('categories', '', 'sort', 0, 0).map((c) => ({ id: c.id, name: c.getString('name'), kitchen: c.getBool('kitchen') })),
    registers: app.findRecordsByFilter('registers', 'archived = false', 'code', 0, 0).map((r) => ({ id: r.id, code: r.getString('code'), name: r.getString('name') })),
    order_types: s.order_types,
    category_icons: require(`${__hooks}/lib_icons.js`).ICONS,
    recipes: {
      today: 'reports.summary (today by default; --from/--to YYYY-MM-DD for a range): net sales, orders, average, top products, tenders, hours, taxes, and the same numbers for the previous period.',
      find_a_sale: 'sales.list --q "<receipt number, ticket name, customer or order number>" [--from --to], then sales.get --sale <number>. sales.receipt-text --sale <number> gives the receipt as text.',
      add_product: 'products.add --name "Iced latte" --category "Coffee" --price ' + example + ' [--variants \'[{"name":"Regular","price":"' + example + '"},{"name":"Large","price":"..."}]\'] [--modifier_groups \'["Milk"]\'] [--barcodes \'["9555..."]\'] [--track_stock true --stock 24 --low_stock 5]. Read it back with products.get.',
      change_price: 'products.update --product "<name or SKU>" --price <amount> (variants: pass the full --variants list with each variant\'s price).',
      sold_out: 'products.set-available --product "<name>" --available false (and true when it is back). Options: modifiers.set-available --group "Milk" --option "Oat" --available false.',
      options: 'modifiers.add-group --name "Milk" --min 0 --max 1 --options \'[{"name":"Oat","price":"1.00"},{"name":"Soy","price":"1.00"}]\', then add it to products with products.update --modifier_groups \'["Milk"]\'.',
      stock: 'stock.list [--only low]; stock.receive --product <p> [--variant <v>] --qty 24 --reason "Delivery from <supplier>"; stock.count --product <p> --counted 18; stock.history --product <p>.',
      import_menu: 'When asked by the menu_import_waiting trigger: imports.list --status waiting; for each: imports.start, read the file at file_path, then products.import --import <id> --rows \'[{"name":"...","category":"...","price":"...","variants":[...]}]\' and imports.complete --summary "...", or imports.fail --reason "...".',
      phone_order: 'tickets.draft --name "Phone order: Sam" --lines \'[{"product":"Latte","variant":"Large","qty":2,"modifiers":["Oat"]}]\' [--customer "<phone>"] [--order_type takeaway] [--note "Pick up 12:30"]. Use sales.preview with the same lines first to quote the total.',
      customers: 'customers.list --q "<name, phone or email>"; customers.get --customer <id>; customers.add --name ... --phone ... --email ...',
      email_receipt: 'receipts.email --sale <number> --email <address> (this asks you, through the receipt_email_requested trigger, to send sales.receipt-text from the user\'s email account).',
      cash_up: 'shifts.list; shifts.report --shift <id> gives the X report of an open shift or the Z report of a closed one.',
      audit: 'audit.list [--group money|exceptions|changes|agent] [--from --to] [--staff <name>] [--q "<text>"].',
    },
  };
}

module.exports = { guide: guide };
