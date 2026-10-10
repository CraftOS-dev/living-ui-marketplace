/// <reference path="../pb_data/types.d.ts" />
/**
 * CSV exports.
 *
 *   items      one row per item: its details (re-importable to bulk-edit
 *              them) followed by read-only figures (on hand, value, status).
 *   stock      one row per item and location with its quantity: importing it
 *              back sets the stock to those numbers (a stock take).
 *   movements  the history between two days.
 */

function items(app) {
  const u = require(`${__hooks}/lib_util.js`);
  const core = require(`${__hooks}/lib_core.js`);
  const lib = require(`${__hooks}/lib_items.js`);
  const csv = require(`${__hooks}/lib_csv.js`);
  const ix = require(`${__hooks}/lib_locations.js`).index(app);
  const cur = core.currency(app);
  const ctx = lib.context(app);
  const codes = {};
  for (const c of app.findRecordsByFilter('codes', '', 'created', 0, 0)) {
    const it = c.getString('item');
    if (codes[it] === undefined) codes[it] = [];
    codes[it].push(c.getString('code'));
  }
  const where = {};
  for (const s of app.findRecordsByFilter('stock', 'qty != 0', '', 0, 0)) {
    const it = s.getString('item');
    if (where[it] === undefined) where[it] = [];
    where[it].push(ix.path(s.getString('location')) + ': ' + u.fmtQty(s.getFloat('qty')));
  }
  const rows = [['Name', 'SKU', 'Barcode', 'Category', 'Unit', 'Reorder point', 'Target level', 'Unit cost', 'Supplier', 'Description', 'Total on hand', 'Incoming', 'Value', 'Status', 'Stock by location']];
  const recs = app.findRecordsByFilter('items', '', 'name', 0, 0);
  for (const r of recs) {
    const b = lib.brief(app, r, ctx, cur);
    rows.push([
      b.name,
      b.sku,
      (codes[r.id] || []).join(' | '),
      b.category !== null ? b.category.name : '',
      b.unit,
      b.min_qty || '',
      b.max_qty || '',
      b.unit_cost_e4 > 0 ? b.unit_cost : '',
      b.supplier !== null ? b.supplier.name : '',
      r.getString('description'),
      b.on_hand,
      b.incoming || '',
      b.value_text,
      b.status,
      (where[r.id] || []).join('; '),
    ]);
  }
  return { filename: 'items-' + u.today() + '.csv', rows: recs.length, content: csv.toCsv(rows), currency: cur };
}

function stock(app) {
  const u = require(`${__hooks}/lib_util.js`);
  const core = require(`${__hooks}/lib_core.js`);
  const csv = require(`${__hooks}/lib_csv.js`);
  const ix = require(`${__hooks}/lib_locations.js`).index(app);
  const cur = core.currency(app);
  const rows = [['Name', 'SKU', 'Location', 'Quantity', 'Unit', 'Unit cost', 'Value']];
  const data = u.rows(
    app,
    'SELECT i.name AS name, i.sku AS sku, i.unit AS unit, i.unit_cost AS cost, s.location AS location, s.qty AS qty FROM stock s JOIN items i ON i.id = s.item WHERE s.qty != 0 ORDER BY i.name, s.location',
    { name: '', sku: '', unit: '', cost: 0, location: '', qty: -0 },
  );
  for (const r of data) {
    rows.push([r.name, r.sku, ix.path(r.location), u.q3(r.qty), r.unit, r.cost > 0 ? core.costText(r.cost, cur) : '', core.costText(Math.round(r.qty * r.cost), cur)]);
  }
  return { filename: 'stock-' + u.today() + '.csv', rows: data.length, content: csv.toCsv(rows), currency: cur };
}

function movements(app, from, to) {
  const u = require(`${__hooks}/lib_util.js`);
  const csv = require(`${__hooks}/lib_csv.js`);
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const recs = app.findRecordsByFilter(
    'movements',
    'created >= {:from} && created < {:to}',
    'created,id',
    0,
    0,
    { from: u.dayStartTs(from), to: u.dayStartTs(u.addDays(to, 1)) },
  );
  const ctx = ledger.context(app, recs);
  const rows = [['Date', 'Time', 'Item', 'SKU', 'Location', 'Change', 'Unit', 'Kind', 'Reason', 'Balance after', 'Unit cost', 'By', 'Note', 'Reference', 'Batch']];
  for (const m of recs) {
    const s = ledger.serialize(m, ctx);
    const t = new Date(Date.parse(s.created.replace(' ', 'T')));
    rows.push([
      u.localDay(s.created),
      u.pad(t.getHours()) + ':' + u.pad(t.getMinutes()),
      s.item.name,
      s.item.sku,
      s.location.path,
      s.qty,
      s.item.unit,
      s.kind,
      s.reason_label,
      s.balance,
      s.unit_cost,
      s.actor === 'agent' ? 'AI agent' : s.actor === 'system' ? 'App' : 'You',
      s.note,
      s.ref_label,
      s.batch,
    ]);
  }
  return { filename: 'history-' + from + '-to-' + to + '.csv', rows: recs.length, content: csv.toCsv(rows) };
}

/** An empty CSV with the import columns, to fill in. */
function template() {
  const csv = require(`${__hooks}/lib_csv.js`);
  const imp = require(`${__hooks}/lib_import.js`);
  return {
    filename: 'items-template.csv',
    content: csv.toCsv([imp.templateHeader()]),
  };
}

module.exports = { items: items, stock: stock, movements: movements, template: template };
