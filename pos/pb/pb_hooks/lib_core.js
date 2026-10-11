/// <reference path="../pb_data/types.d.ts" />
/**
 * Shared lookups: the settings row, the shop's money rules, records found by
 * id or by the names people use (a SKU, a barcode, a register code, a
 * category name), and the audit trail.
 *
 * Every finder accepts an id first, then the human handle, compared without
 * case. A name that matches more than one record is refused with the
 * candidates, never guessed.
 */

const ZERO = ['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'];
const THREE = ['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND'];

/** Decimals of a currency (JPY 0, MYR 2, KWD 3). */
function exponent(currency) {
  if (ZERO.indexOf(currency) >= 0) return 0;
  if (THREE.indexOf(currency) >= 0) return 3;
  return 2;
}

function isCurrency(code) {
  return typeof code === 'string' && /^[A-Z]{3}$/.test(code);
}

function settings(app) {
  const rows = app.findRecordsByFilter('settings', '', '', 1, 0);
  if (rows.length === 0) throw require(`${__hooks}/lib_util.js`).fail(500, 'The settings row is missing');
  return rows[0];
}

/** The money and tax rules every computation needs, read once per call. */
function shop(app) {
  const s = settings(app);
  const currency = s.getString('currency');
  return {
    record: s,
    currency: currency,
    exp: exponent(currency),
    price_mode: s.getString('price_mode'),
    tax_rounding: s.getString('tax_rounding'),
    cash_rounding: s.getInt('cash_rounding'),
    order_types: s.getStringSlice('order_types'),
    default_order_type: s.getString('default_order_type'),
    service_charge_bp: s.getInt('service_charge_bp'),
    service_charge_scope: s.getString('service_charge_scope') || 'dine_in',
    service_charge_tax: s.getString('service_charge_tax'),
    kitchen_enabled: s.getBool('kitchen_enabled'),
    order_numbers: s.getBool('order_numbers'),
    cashier_discount_bp: s.getInt('cashier_discount_bp'),
    day_cutoff_hour: s.getInt('day_cutoff_hour'),
    setup_done: s.getBool('setup_done'),
  };
}

/* ------------------------------------------------------------- finders */

function u() {
  return require(`${__hooks}/lib_util.js`);
}

function notFound(what, ref, hint) {
  return u().fail(404, 'No ' + what + ' "' + ref + '".' + (hint ? ' ' + hint : ''), 'not_found');
}

/** One record by id, else by a case-insensitive match on `column`. */
function byIdOrName(app, collection, ref, column, what, hint) {
  const util = u();
  const r = String(ref || '').trim();
  if (r === '') throw util.fail(400, what + ' is required');
  const hit = util.byId(app, collection, r);
  if (hit !== null) return hit;
  const ids = util.idsNocase(app, collection, column, util.squash(r), 3);
  if (ids.length === 1) return app.findRecordById(collection, ids[0]);
  if (ids.length > 1) throw util.fail(400, 'More than one ' + what + ' is called "' + r + '". Use its id.', 'ambiguous');
  throw notFound(what, r, hint);
}

function category(app, ref) {
  return byIdOrName(app, 'categories', ref, 'name', 'category', 'List them with categories.list.');
}

function taxClass(app, ref) {
  return byIdOrName(app, 'tax_classes', ref, 'name', 'tax class', 'List them with tax.list.');
}

function group(app, ref) {
  return byIdOrName(app, 'modifier_groups', ref, 'name', 'modifier group', 'List them with modifiers.list.');
}

function discount(app, ref) {
  return byIdOrName(app, 'discounts', ref, 'name', 'discount', 'List them with discounts.list.');
}

function staff(app, ref) {
  return byIdOrName(app, 'staff', ref, 'name', 'staff member', 'List them with staff.list.');
}

function register(app, ref) {
  return byIdOrName(app, 'registers', ref, 'code', 'register', 'List them with registers.list (give its id or code, e.g. R1).');
}

function tender(app, ref) {
  return byIdOrName(app, 'tenders', ref, 'name', 'payment method', 'List them with tenders.list.');
}

/** A product by id, SKU, barcode or exact name. */
function product(app, ref) {
  const util = u();
  const r = String(ref || '').trim();
  if (r === '') throw util.fail(400, 'product is required (its id, SKU, barcode or exact name)');
  const hit = util.byId(app, 'products', r);
  if (hit !== null) return hit;
  const bySku = util.idsNocase(app, 'products', 'sku', r, 2);
  if (bySku.length === 1) return app.findRecordById('products', bySku[0]);
  const code = util.rows(app, 'SELECT product FROM codes WHERE LOWER(code) = LOWER({:c}) LIMIT 1', { product: '' }, { c: r });
  if (code.length === 1) return app.findRecordById('products', code[0].product);
  const variantSku = util.rows(app, 'SELECT product FROM variants WHERE LOWER(sku) = LOWER({:c}) LIMIT 1', { product: '' }, { c: r });
  if (variantSku.length === 1) return app.findRecordById('products', variantSku[0].product);
  const byName = util.rows(app, 'SELECT id FROM products WHERE LOWER(name) = LOWER({:n}) AND archived = false LIMIT 3', { id: '' }, { n: util.squash(r) });
  if (byName.length === 1) return app.findRecordById('products', byName[0].id);
  if (byName.length > 1) throw util.fail(400, 'More than one product is called "' + r + '". Use its id or SKU.', 'ambiguous');
  throw notFound('product', r, 'Find it with products.list --q "<part of the name>".');
}

/** A customer by id, phone, email or exact name. */
function customer(app, ref) {
  const util = u();
  const r = String(ref || '').trim();
  if (r === '') throw util.fail(400, 'customer is required');
  const hit = util.byId(app, 'customers', r);
  if (hit !== null) return hit;
  for (const col of ['phone', 'email', 'name']) {
    const ids = util.idsNocase(app, 'customers', col, r, 3);
    if (ids.length === 1) return app.findRecordById('customers', ids[0]);
    if (ids.length > 1) throw util.fail(400, 'More than one customer has the ' + col + ' "' + r + '". Use their id.', 'ambiguous');
  }
  throw notFound('customer', r, 'Find them with customers.list --q "<name, phone or email>".');
}

/**
 * Who already uses a scannable code (a barcode or SKU), or null. Codes are
 * unique across product SKUs, variant SKUs and barcodes, so a scan always
 * means one thing. `exceptProduct` skips one product's own codes.
 */
function codeOwner(app, code, exceptProduct) {
  const util = u();
  const c = String(code || '').trim();
  if (c === '') return null;
  const ex = exceptProduct || '';
  const p = util.rows(app, 'SELECT id, name FROM products WHERE LOWER(sku) = LOWER({:c}) AND id != {:x} LIMIT 1', { id: '', name: '' }, { c: c, x: ex });
  if (p.length > 0) return { product: p[0].id, label: '"' + p[0].name + '" (its SKU)' };
  const v = util.rows(
    app,
    'SELECT v.product AS product, p.name AS name, v.name AS vname FROM variants v JOIN products p ON p.id = v.product WHERE LOWER(v.sku) = LOWER({:c}) AND v.product != {:x} LIMIT 1',
    { product: '', name: '', vname: '' },
    { c: c, x: ex },
  );
  if (v.length > 0) return { product: v[0].product, label: '"' + v[0].name + ' ' + v[0].vname + '" (its SKU)' };
  const b = util.rows(app, 'SELECT c.product AS product, p.name AS name FROM codes c JOIN products p ON p.id = c.product WHERE LOWER(c.code) = LOWER({:c}) AND c.product != {:x} LIMIT 1', { product: '', name: '' }, { c: c, x: ex });
  if (b.length > 0) return { product: b[0].product, label: '"' + b[0].name + '" (a barcode)' };
  return null;
}

/* ------------------------------------------------------------- counters */

/**
 * Add one to a counter and return it (inside a transaction, as its first
 * write: the UPDATE takes the database's write lock, so two registers never
 * get the same number, and a sale that fails gives its number back).
 */
function bump(tx, key) {
  tx.db().newQuery('UPDATE counters SET num = num + 1 WHERE key = {:k}').bind({ k: key }).execute();
  let c = u().findOne(tx, 'counters', 'key = {:k}', { k: key });
  if (c === null) {
    c = new Record(tx.findCollectionByNameOrId('counters'));
    c.set('key', key);
    c.set('num', 1);
    c.set('text', '');
    tx.save(c);
  }
  return c;
}

function counter(app, key) {
  return u().findOne(app, 'counters', 'key = {:k}', { k: key });
}

/* --------------------------------------------------------------- audit */

/**
 * One audit row. Call it with the same handle that does the change (the
 * transaction handle inside a transaction), so the record of an action
 * exists exactly when the action does.
 */
function audit(app, row) {
  const rec = new Record(app.findCollectionByNameOrId('audit'));
  rec.set('kind', row.kind);
  rec.set('actor', row.actor || 'staff');
  rec.set('staff', row.staff || '');
  rec.set('approver', row.approver || '');
  rec.set('register', row.register || '');
  rec.set('ref', String(row.ref || '').slice(0, 80));
  rec.set('summary', String(row.summary || '').slice(0, 300));
  rec.set('data', row.data || {});
  app.save(rec);
  return rec;
}

module.exports = {
  exponent: exponent,
  isCurrency: isCurrency,
  settings: settings,
  shop: shop,
  byIdOrName: byIdOrName,
  category: category,
  taxClass: taxClass,
  group: group,
  discount: discount,
  staff: staff,
  register: register,
  tender: tender,
  product: product,
  customer: customer,
  codeOwner: codeOwner,
  bump: bump,
  counter: counter,
  audit: audit,
};
