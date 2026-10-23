/// <reference path="../pb_data/types.d.ts" />
/**
 * Stock for products that track it. `stock_moves` is the ledger (sold,
 * refunded, received, adjusted, counted); `stock` keeps the balance per
 * product and variant, written in the same transaction as the move. A sale
 * never waits on stock: selling below zero is allowed and shows as negative
 * on hand, because the till must never refuse a customer over a count.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}

/**
 * Post one stock move and update the balance (call inside a transaction,
 * with its handle). row: { product, variant, qty (signed), kind, reason,
 * sale, staff, actor }. Returns the balance after.
 */
function post(tx, row) {
  const util = u();
  // A filter placeholder bound to '' never matches an empty relation (PocketBase
  // renders it as '""'): a product without sizes is looked up with the literal ''.
  let bal = row.variant
    ? util.findOne(tx, 'stock', 'product = {:p} && variant = {:v}', { p: row.product, v: row.variant })
    : util.findOne(tx, 'stock', "product = {:p} && variant = ''", { p: row.product });
  if (bal === null) {
    bal = new Record(tx.findCollectionByNameOrId('stock'));
    bal.set('product', row.product);
    bal.set('variant', row.variant || '');
    bal.set('qty', 0);
  }
  const after = bal.getInt('qty') + row.qty;
  bal.set('qty', after);
  tx.save(bal);
  const m = new Record(tx.findCollectionByNameOrId('stock_moves'));
  m.set('product', row.product);
  m.set('variant', row.variant || '');
  m.set('qty', row.qty);
  m.set('kind', row.kind);
  m.set('reason', String(row.reason || '').slice(0, 200));
  m.set('sale', row.sale || '');
  m.set('balance', after);
  m.set('staff', row.staff || '');
  m.set('actor', row.actor === 'agent' ? 'agent' : 'staff');
  tx.save(m);
  return after;
}

function onHand(app, productId, variantId) {
  const util = u();
  return util.scalarSql(app, 'SELECT IFNULL(SUM(qty), 0) AS v FROM stock WHERE product = {:p} AND variant = {:v}', { p: productId, v: variantId || '' });
}

/** The variant a stock change is for: required when the product has variants. */
function variantFor(app, product, ref) {
  const util = u();
  const variants = app.findRecordsByFilter('variants', 'product = {:p} && archived = false', 'sort', 0, 0, { p: product.id });
  const r = String(ref || '').trim();
  if (variants.length === 0) {
    if (r !== '') throw util.fail(400, '"' + product.getString('name') + '" has no variants');
    return null;
  }
  if (r === '') throw util.fail(400, '"' + product.getString('name') + '" has variants: say which one with variant (' + variants.map((v) => v.getString('name')).join(', ') + ')');
  const hit = variants.filter((v) => v.id === r || v.getString('name').toLowerCase() === r.toLowerCase())[0];
  if (!hit) throw util.fail(400, '"' + product.getString('name') + '" has no variant "' + r + '" (it has ' + variants.map((v) => v.getString('name')).join(', ') + ')');
  return hit;
}

/** Stock in (a delivery) or a correction: qty is added (negative takes away). */
function change(app, product, variant, qty, kind, reason, ctx) {
  const util = u();
  if (!product.getBool('track_stock')) throw util.fail(400, '"' + product.getString('name') + '" does not track stock. Turn on stock tracking for it first.', 'not_tracked');
  if (qty === 0) throw util.fail(400, 'qty cannot be 0');
  let after = 0;
  app.runInTransaction((tx) => {
    after = post(tx, { product: product.id, variant: variant ? variant.id : '', qty: qty, kind: kind, reason: reason, staff: ctx.staff ? ctx.staff.id : '', actor: ctx.actor });
    require(`${__hooks}/lib_core.js`).audit(tx, {
      kind: 'stock_change',
      actor: ctx.actor,
      staff: ctx.staff ? ctx.staff.id : '',
      ref: product.getString('name'),
      summary: (kind === 'receive' ? 'Received ' : 'Adjusted ') + (qty > 0 ? '+' : '') + qty + ' ' + product.getString('name') + (variant ? ' ' + variant.getString('name') : '') + (reason ? ' (' + reason + ')' : ''),
    });
  });
  return { product: product.id, variant: variant ? variant.id : '', qty: qty, on_hand: after };
}

/** A count: set what is on hand to what was counted (the move is the difference). */
function count(app, product, variant, counted, reason, ctx) {
  const util = u();
  if (!product.getBool('track_stock')) throw util.fail(400, '"' + product.getString('name') + '" does not track stock. Turn on stock tracking for it first.', 'not_tracked');
  let after = 0;
  let diff = 0;
  app.runInTransaction((tx) => {
    const now = onHand(tx, product.id, variant ? variant.id : '');
    diff = counted - now;
    after = now;
    if (diff !== 0) {
      after = post(tx, { product: product.id, variant: variant ? variant.id : '', qty: diff, kind: 'count', reason: reason || 'Counted', staff: ctx.staff ? ctx.staff.id : '', actor: ctx.actor });
      require(`${__hooks}/lib_core.js`).audit(tx, {
        kind: 'stock_change',
        actor: ctx.actor,
        staff: ctx.staff ? ctx.staff.id : '',
        ref: product.getString('name'),
        summary: 'Counted ' + counted + ' ' + product.getString('name') + (variant ? ' ' + variant.getString('name') : '') + ' (' + (diff > 0 ? '+' : '') + diff + ')',
      });
    }
  });
  return { product: product.id, variant: variant ? variant.id : '', counted: counted, difference: diff, on_hand: after };
}

/** Tracked products with what is on hand, lowest first relative to their alert level. */
function list(app, p) {
  const util = u();
  const catalog = require(`${__hooks}/lib_catalog.js`);
  const q = util.str(p, 'q', '').toLowerCase();
  const only = util.oneOf(p, 'only', ['all', 'low', 'out'], 'all');
  let recs = app.findRecordsByFilter('products', "track_stock = true && archived = false && status = 'active'", 'name', 0, 0);
  if (q !== '') recs = recs.filter((r) => r.getString('name').toLowerCase().indexOf(q) >= 0 || r.getString('sku').toLowerCase().indexOf(q) >= 0);
  let items = catalog.serializeProducts(app, recs).map((x) => ({
    id: x.id,
    name: x.name,
    sku: x.sku,
    category_name: x.category_name,
    icon: x.icon,
    color: x.color,
    thumb_url: x.thumb_url,
    stock: x.stock || 0,
    low_stock: x.low_stock,
    low: x.low,
    out: (x.stock || 0) <= 0,
    variants: x.variants.map((v) => ({ id: v.id, name: v.name, stock: v.stock || 0 })),
  }));
  if (only === 'low') items = items.filter((x) => x.low || x.out);
  if (only === 'out') items = items.filter((x) => x.out);
  const counts = { all: 0, low: 0, out: 0 };
  for (const x of catalog.serializeProducts(app, app.findRecordsByFilter('products', "track_stock = true && archived = false && status = 'active'", '', 0, 0))) {
    counts.all++;
    if ((x.stock || 0) <= 0) counts.out++;
    else if (x.low) counts.low++;
  }
  return { items: items, counts: counts };
}

/** The moves of one product (newest first). */
function history(app, product, limit) {
  const util = u();
  const names = {};
  for (const v of app.findRecordsByFilter('variants', 'product = {:p}', '', 0, 0, { p: product.id })) names[v.id] = v.getString('name');
  const staff = {};
  for (const s of app.findRecordsByFilter('staff', '', '', 0, 0)) staff[s.id] = s.getString('name');
  const sales = {};
  const moves = app.findRecordsByFilter('stock_moves', 'product = {:p}', '-created', limit, 0, { p: product.id });
  for (const m of moves) {
    const sid = m.getString('sale');
    if (sid !== '' && sales[sid] === undefined) {
      const s = util.byId(app, 'sales', sid);
      sales[sid] = s === null ? '' : s.getString('number');
    }
  }
  return {
    product: { id: product.id, name: product.getString('name') },
    moves: moves.map((m) => ({
      id: m.id,
      variant: m.getString('variant'),
      variant_name: names[m.getString('variant')] || '',
      qty: m.getInt('qty'),
      kind: m.getString('kind'),
      reason: m.getString('reason'),
      sale: m.getString('sale'),
      sale_number: sales[m.getString('sale')] || '',
      balance: m.getInt('balance'),
      by: m.getString('actor') === 'agent' ? 'Your AI agent' : staff[m.getString('staff')] || '',
      actor: m.getString('actor'),
      created: m.getString('created'),
    })),
  };
}

module.exports = { post: post, onHand: onHand, variantFor: variantFor, change: change, count: count, list: list, history: history };
