/// <reference path="../pb_data/types.d.ts" />
/**
 * records.delete: the one delete path, with a preview of what a delete
 * affects or why it is refused. Financial records are permanent: sales are
 * corrected with a return, open sales are voided, balances are adjusted,
 * records with history are archived or turned off instead.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function auth() {
  return require(`${__hooks}/lib_auth.js`);
}

const DELETABLE = {
  products: 'manage_catalog',
  variants: 'manage_catalog',
  categories: 'manage_catalog',
  modifier_groups: 'manage_catalog',
  taxes: 'manage_settings',
  registers: 'manage_settings',
  discounts: 'manage_discounts',
  customers: 'manage_customers',
  gift_cards: 'adjust_balances',
  staff: 'manage_staff',
  timeclock: 'manage_staff',
  requests: '',
  orders: 'sell',
};

const PERMANENT = {
  payments: 'Payments are permanent; void a payment on an open sale (payments.void) or refund it with a return.',
  order_lines: 'Lines change through orders.line and orders.remove while the sale is open; a paid sale is corrected with a return.',
  shifts: 'Drawer sessions are permanent records of the cash.',
  cash_moves: 'Cash movements are permanent; pay the opposite way to correct one.',
  stock_moves: 'Stock history is permanent; correct stock with stock.change.',
  account_moves: 'Balance history is permanent; correct a balance with customers.adjust or giftcards.adjust.',
  events: 'The audit log is permanent.',
  settings: 'Settings change through settings.update.',
};

function count(db, coll, sql, bind) {
  return db.countRecords(coll, $dbx.exp(sql, bind || {}));
}

/** What deleting a record would do: { name, affects, blocked } (blocked: why it cannot go). */
function inspect(db, coll, rec) {
  const util = u();
  const C = require(`${__hooks}/lib_catalog.js`);
  if (coll === 'products') {
    const vs = db.findRecordsByFilter('variants', 'product = {:p}', '', 0, 0, { p: rec.id });
    const hist = vs.filter((v) => C.hasHistory(db, v.id)).length;
    return { name: rec.getString('name'), affects: { variants: vs.length, discounts: count(db, 'discounts', "products LIKE {:p}", { p: '%' + rec.id + '%' }) }, blocked: hist > 0 ? rec.getString('name') + ' has sales or stock history; archive it instead (it stays in reports)' : '' };
  }
  if (coll === 'variants') {
    const prod = util.byId(db, 'products', rec.getString('product'));
    const live = count(db, 'variants', 'product = {:p} AND archived = FALSE AND id != {:i}', { p: rec.getString('product'), i: rec.id });
    let blocked = C.hasHistory(db, rec.id) ? 'This variant has sales or stock history; archive it instead' : '';
    if (!blocked && live === 0) blocked = 'A product needs at least one variant; delete or archive the product instead';
    return { name: (prod ? prod.getString('name') : '') + (rec.getString('title') ? ' (' + rec.getString('title') + ')' : ''), affects: {}, blocked: blocked };
  }
  if (coll === 'categories') return { name: rec.getString('name'), affects: { products_uncategorized: count(db, 'products', 'category = {:c}', { c: rec.id }) }, blocked: '' };
  if (coll === 'modifier_groups') return { name: rec.getString('name'), affects: { products_losing_it: count(db, 'products', 'modifier_groups LIKE {:g}', { g: '%' + rec.id + '%' }) }, blocked: '' };
  if (coll === 'taxes') {
    const using = count(db, 'products', 'tax = {:t}', { t: rec.id });
    return { name: rec.getString('name'), affects: { products_to_default: using, default_rate: rec.getBool('is_default') }, blocked: rec.getBool('is_default') && count(db, 'taxes', 'id != {:t}', { t: rec.id }) > 0 ? 'Make another rate the default first' : '' };
  }
  if (coll === 'registers') {
    const hist = count(db, 'shifts', 'register = {:r}', { r: rec.id }) + count(db, 'orders', 'register = {:r}', { r: rec.id });
    return { name: rec.getString('name'), affects: {}, blocked: hist > 0 ? rec.getString('name') + ' has sales or drawer history; turn it off instead' : count(db, 'registers', 'id != {:r}', { r: rec.id }) === 0 ? 'The store needs a register' : '' };
  }
  if (coll === 'discounts') return { name: rec.getString('name'), affects: { uses: rec.getInt('uses') }, blocked: '' };
  if (coll === 'customers') {
    const blocked = rec.getInt('credit') > 0 ? rec.getString('name') + ' has store credit; adjust it to zero first' : '';
    return { name: rec.getString('name'), affects: { sales_keep_without_name: count(db, 'orders', 'customer = {:c}', { c: rec.id }), points_lost: rec.getInt('points'), gift_cards_unlinked: count(db, 'gift_cards', 'customer = {:c}', { c: rec.id }) }, blocked: blocked };
  }
  if (coll === 'gift_cards') {
    const moves = count(db, 'account_moves', 'gift_card = {:g}', { g: rec.id });
    return { name: '•••• ' + rec.getString('code').slice(-4), affects: {}, blocked: moves > 0 || rec.getInt('balance') !== 0 ? 'This card has history or a balance; disable it instead' : '' };
  }
  if (coll === 'staff') {
    const hist = count(db, 'orders', 'opened_by = {:s} OR closed_by = {:s}', { s: rec.id }) + count(db, 'payments', 'staff = {:s}', { s: rec.id }) + count(db, 'shifts', 'opened_by = {:s} OR closed_by = {:s}', { s: rec.id }) + count(db, 'cash_moves', 'staff = {:s}', { s: rec.id });
    let blocked = hist > 0 ? rec.getString('name') + ' has sales or drawer history; turn them off (active=false) instead' : '';
    if (!blocked && rec.getString('role') === 'owner' && count(db, 'staff', "role = 'owner' AND active = TRUE AND id != {:s}", { s: rec.id }) === 0) blocked = 'The store needs at least one active owner';
    return { name: rec.getString('name'), affects: { time_entries: count(db, 'timeclock', 'staff = {:s}', { s: rec.id }) }, blocked: blocked };
  }
  if (coll === 'timeclock') return { name: 'Time entry', affects: {}, blocked: '' };
  if (coll === 'requests') return { name: rec.getString('title'), affects: {}, blocked: '' };
  if (coll === 'orders') {
    let blocked = '';
    if (rec.getString('status') !== 'open') blocked = 'A ' + rec.getString('status') + ' sale is permanent; correct a paid sale with a return';
    else if (count(db, 'payments', '"order" = {:o}', { o: rec.id }) > 0) blocked = 'This sale has payment history; void it with orders.void instead (it stays on record)';
    return { name: rec.getString('label') || 'Open sale', affects: { lines: count(db, 'order_lines', '"order" = {:o}', { o: rec.id }) }, blocked: blocked };
  }
  return { name: '', affects: {}, blocked: 'Cannot delete ' + coll };
}

function del(app, e, p) {
  const util = u();
  const coll = util.str(p, 'collection', '');
  if (PERMANENT[coll]) throw util.fail(400, PERMANENT[coll], { code: 'permanent' });
  if (DELETABLE[coll] === undefined) throw util.fail(400, 'collection must be one of: ' + Object.keys(DELETABLE).join(', '));
  const c = auth().context(app, e, p);
  const id = util.req(p, 'id', '<record id>');
  const rec = util.byId(app, coll, id);
  if (rec === null) throw util.fail(404, 'No ' + coll + ' record ' + id);
  const info = inspect(app, coll, rec);
  if (util.bool(p, 'preview', false)) return { preview: true, collection: coll, id: rec.id, name: info.name, affects: info.affects, blocked: info.blocked };
  if (info.blocked) throw util.fail(400, info.blocked, { code: 'blocked' });
  const approver = DELETABLE[coll] === '' ? null : auth().need(app, c, DELETABLE[coll], p, { what: 'Deleting this' });
  if (coll === 'staff' && rec.getString('role') === 'owner' && c.role !== 'owner' && (approver === null || approver.getString('role') !== 'owner')) throw util.fail(403, 'Only an owner can remove an owner', { code: 'forbidden' });
  app.runInTransaction((tx) => {
    const fresh = tx.findRecordById(coll, rec.id);
    if (coll === 'orders') {
      const lines = tx.findRecordsByFilter('order_lines', 'order = {:o}', '', 0, 0, { o: rec.id });
      if (lines.length) require(`${__hooks}/lib_audit.js`).log(tx, 'order_voided', c, { order: rec.id, amount: fresh.getInt('total'), detail: 'Deleted an open sale with ' + util.plural(lines.length, 'line') });
    }
    tx.delete(fresh);
    if (coll !== 'orders' && coll !== 'requests') require(`${__hooks}/lib_audit.js`).log(tx, 'delete', c, { approver: approver, detail: 'Deleted ' + coll.replace('_', ' ').replace(/s$/, '') + ': ' + info.name });
  });
  return { deleted: true, collection: coll, id: rec.id, name: info.name };
}

module.exports = { DELETABLE: DELETABLE, PERMANENT: PERMANENT, inspect: inspect, del: del };
