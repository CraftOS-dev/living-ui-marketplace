/// <reference path="../pb_data/types.d.ts" />
/**
 * Suppliers: who stock is bought from. An item can name its usual supplier;
 * reorder suggestions and draft purchase orders are grouped by it.
 */

function apply(rec, p) {
  const u = require(`${__hooks}/lib_util.js`);
  if (u.has(p, 'name')) rec.set('name', u.str(p, 'name', ''));
  if (u.has(p, 'contact')) rec.set('contact', u.str(p, 'contact', '').slice(0, 80));
  if (u.has(p, 'email')) {
    const email = u.str(p, 'email', '');
    if (email !== '' && (email.indexOf('@') < 1 || email.indexOf('@') === email.length - 1 || /\s/.test(email))) {
      throw u.fail(400, 'email must be an email address like orders@supplier.com (got "' + email + '")');
    }
    rec.set('email', email.slice(0, 120));
  }
  if (u.has(p, 'phone')) rec.set('phone', u.str(p, 'phone', '').slice(0, 40));
  if (u.has(p, 'website')) rec.set('website', u.str(p, 'website', '').slice(0, 200));
  if (u.has(p, 'lead_time_days')) rec.set('lead_time_days', u.int(p, 'lead_time_days', 0, 0, 365));
  if (u.has(p, 'notes')) rec.set('notes', u.str(p, 'notes', '').slice(0, 1000));
}

function stats(app) {
  const u = require(`${__hooks}/lib_util.js`);
  const items = {};
  for (const r of u.rows(app, "SELECT supplier, COUNT(id) AS n FROM items WHERE archived = false AND supplier != '' GROUP BY supplier", { supplier: '', n: 0 })) items[r.supplier] = r.n;
  const open = {};
  for (const r of u.rows(app, "SELECT supplier, COUNT(id) AS n FROM orders WHERE status IN ('draft', 'ordered', 'partial') AND supplier != '' GROUP BY supplier", { supplier: '', n: 0 })) open[r.supplier] = r.n;
  const last = {};
  for (const r of u.rows(app, "SELECT supplier, IFNULL(MAX(ordered_on), 0) AS d FROM orders WHERE ordered_on != '' AND supplier != '' GROUP BY supplier", { supplier: '', d: '' })) last[r.supplier] = r.d;
  return { items: items, open: open, last: last };
}

function brief(rec, st) {
  return {
    id: rec.id,
    name: rec.getString('name'),
    contact: rec.getString('contact'),
    email: rec.getString('email'),
    phone: rec.getString('phone'),
    website: rec.getString('website'),
    lead_time_days: rec.getInt('lead_time_days'),
    notes: rec.getString('notes'),
    items: st.items[rec.id] || 0,
    open_orders: st.open[rec.id] || 0,
    last_ordered_on: st.last[rec.id] || '',
  };
}

function list(app) {
  const st = stats(app);
  return { suppliers: app.findRecordsByFilter('suppliers', '', 'name', 0, 0).map((r) => brief(r, st)) };
}

/** A supplier with the items it supplies and its latest orders. */
function get(app, rec) {
  const core = require(`${__hooks}/lib_core.js`);
  const items = require(`${__hooks}/lib_items.js`);
  const orders = require(`${__hooks}/lib_orders.js`);
  const cur = core.currency(app);
  const ctx = items.context(app);
  const b = brief(rec, stats(app));
  const recs = app.findRecordsByFilter('items', 'supplier = {:s} && archived = false', 'name', 0, 0, { s: rec.id });
  const octx = { currency: cur, locs: require(`${__hooks}/lib_locations.js`).index(app), cats: ctx.cats };
  return Object.assign(b, {
    currency: cur,
    supplied: recs.map((r) => items.brief(app, r, ctx, cur)),
    orders: app.findRecordsByFilter('orders', 'supplier = {:s}', '-created', 20, 0, { s: rec.id }).map((o) => orders.serialize(app, o, octx)),
  });
}

function deletePreview(app, rec) {
  const st = stats(app);
  const u = require(`${__hooks}/lib_util.js`);
  const all = u.rows(app, 'SELECT COUNT(id) AS n FROM orders WHERE supplier = {:s}', { n: 0 }, { s: rec.id });
  return {
    supplier: { id: rec.id, name: rec.getString('name') },
    items_unlinked: st.items[rec.id] || 0,
    orders_without_supplier: all.length > 0 ? all[0].n : 0,
    open_orders: st.open[rec.id] || 0,
  };
}

/** Delete a supplier: its items and orders stay, without a supplier. */
function remove(app, rec) {
  const out = deletePreview(app, rec);
  app.runInTransaction((tx) => {
    for (const it of tx.findRecordsByFilter('items', 'supplier = {:s}', '', 0, 0, { s: rec.id })) {
      it.set('supplier', '');
      tx.save(it);
    }
    for (const o of tx.findRecordsByFilter('orders', 'supplier = {:s}', '', 0, 0, { s: rec.id })) {
      o.set('supplier', '');
      tx.save(o);
    }
    tx.delete(tx.findRecordById('suppliers', rec.id));
  });
  out.deleted = true;
  return out;
}

module.exports = { apply: apply, list: list, get: get, deletePreview: deletePreview, remove: remove };
