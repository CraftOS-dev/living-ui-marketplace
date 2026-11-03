/// <reference path="../pb_data/types.d.ts" />
/**
 * File imports: a seller centre's order or product export, read in the page
 * (CSV or Excel), its columns matched to Store OS fields by you, and the rows
 * sent here. Each import is kept with what it created, updated and skipped,
 * and the reasons, so a bad file is easy to see and fix. Orders are matched
 * on (shop, order number), products on SKU: importing the same file twice
 * changes nothing.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

function view(r) {
  const U = L('lib_util');
  return { id: r.id, kind: r.getString('kind'), shop: r.getString('shop'), file_name: r.getString('file_name'), rows: r.getInt('rows'), created_n: r.getInt('created_n'), updated_n: r.getInt('updated_n'), skipped_n: r.getInt('skipped_n'), problems: U.json(r, 'problems', []), by: r.getString('by'), created: r.getString('created') };
}

function record(app, kind, shopId, fileName, rows, out, by) {
  const U = L('lib_util');
  const r = U.newRecord(app, 'imports');
  r.set('kind', kind);
  r.set('shop', shopId || '');
  r.set('file_name', U.clip(fileName || '', 200));
  r.set('rows', rows);
  r.set('created_n', out.created || 0);
  r.set('updated_n', (out.updated || 0) + (out.listed && kind === 'products' ? 0 : 0));
  r.set('skipped_n', out.skipped || 0);
  r.set('problems', (out.problems || []).concat((out.unlinked || []).map((x) => 'No SKU in your catalog: ' + x)).slice(0, 500));
  r.set('by', by);
  app.save(r);
  return r;
}

function orders(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const shop = L('lib_shops').ref(app, p.shop);
  const items = U.list(p.items, 'items');
  const id = $security.randomStringWithAlphabet(15, 'abcdefghijklmnopqrstuvwxyz0123456789');
  const out = L('lib_orders').upsertMany(ctx, { shop: shop.id, items: items }, id);
  const r = record(app, 'orders', shop.id, p.file_name, items.length, out, ctx.actor);
  if (shop.getString('connection') === 'manual') {
    shop.set('connection', 'files');
    app.save(shop);
  }
  shop.set('sync_at', U.now());
  shop.set('sync_note', 'Imported ' + (p.file_name || 'a file') + ': ' + out.created + ' new, ' + out.updated + ' updated');
  app.save(shop);
  return Object.assign({ import: view(r) }, out);
}

function products(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const items = U.list(p.items, 'items');
  const out = L('lib_products').upsertMany(ctx, { items: items, shop: p.shop, stock_mode: p.stock_mode });
  const shopId = p.shop ? L('lib_shops').ref(app, p.shop).id : '';
  const r = record(app, 'products', shopId, p.file_name, items.length, out, ctx.actor);
  return Object.assign({ import: view(r) }, out);
}

function list(ctx, p) {
  const limit = Math.min(Math.max(Math.round(p.limit || 30), 1), 200);
  return { imports: ctx.app.findRecordsByFilter('imports', '1=1', '-created', limit, 0).map(view) };
}

module.exports = { orders: orders, products: products, list: list };
