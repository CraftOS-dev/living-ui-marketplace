/// <reference path="../pb_data/types.d.ts" />
/**
 * Stock: one ledger for every shop.
 *
 *   on hand    what is on your shelf; changes only through a stock move
 *              (opening, received, sale, return, adjust, damage, count)
 *   reserved   ordered on any shop but not shipped yet (open orders)
 *   available  on hand minus reserved: the one number every shop is fed from
 *
 * Each shop shows a share of what is available (its stock rule: a share, a
 * safety buffer and a maximum). The push plan lists, per shop and SKU, the
 * number the shop should show where it differs from the last number set
 * there; your AI agent (or you) sets them and marks them done.
 */

const REASONS = ['opening', 'received', 'sale', 'return', 'adjust', 'damage', 'count'];

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

/** A variant by id or SKU (any case). */
function variantRef(app, value, what) {
  const U = L('lib_util');
  const v = String(value || '').trim();
  if (v === '') throw U.fail(400, 'Name the item with --' + (what || 'variant') + ' <id or SKU>.', 'missing_param', { param: what || 'variant' });
  const byId = U.byId(app, 'variants', v);
  if (byId !== null) return byId;
  const bySku = U.findOne(app, 'variants', 'sku = {:s}', { s: v });
  if (bySku !== null) return bySku;
  const rows = U.rows(app, 'SELECT id AS id FROM variants WHERE sku = {:s} COLLATE NOCASE LIMIT 1', { s: v }, { id: '' });
  if (rows.length > 0) return app.findRecordById('variants', rows[0].id);
  throw U.fail(404, 'No SKU or variant "' + v + '". Run stock.overview --q "' + v + '" or products.list.', 'not_found');
}

/** Reserved quantity per variant id (open orders: unpaid or to ship). */
function reservedMap(app) {
  const U = L('lib_util');
  const out = {};
  for (const r of U.rows(app, "SELECT l.variant AS variant, COALESCE(SUM(l.qty - l.qty_shipped), 0) AS n FROM order_lines l JOIN orders o ON o.id = l.order_ref WHERE o.status IN ('unpaid', 'to_ship') AND l.variant != '' GROUP BY l.variant", {}, { variant: '', n: 0 })) {
    out[r.variant] = Math.max(0, r.n);
  }
  return out;
}

function reservedOf(app, variantId) {
  return L('lib_util').count(app, "SELECT COALESCE(SUM(l.qty - l.qty_shipped), 0) AS n FROM order_lines l JOIN orders o ON o.id = l.order_ref WHERE o.status IN ('unpaid', 'to_ship') AND l.variant = {:v}", { v: variantId });
}

/** Record a stock move and keep the variant's on-hand count in step. Returns the new on hand. */
function move(app, variant, qty, reason, ref, note, actor) {
  const U = L('lib_util');
  if (REASONS.indexOf(reason) < 0) throw new Error('unknown stock reason ' + reason);
  const q = Math.round(Number(qty || 0));
  if (q === 0) return variant.getInt('on_hand');
  const balance = variant.getInt('on_hand') + q;
  variant.set('on_hand', balance);
  app.save(variant);
  const m = U.newRecord(app, 'stock_moves');
  m.set('variant', variant.id);
  m.set('qty', q);
  m.set('reason', reason);
  m.set('ref', U.clip(ref || '', 120));
  m.set('note', U.clip(note || '', 300));
  m.set('actor', actor || 'person');
  m.set('balance', balance);
  app.save(m);
  return balance;
}

function lowOf(app, v) {
  const own = v.getInt('low_stock');
  return own > 0 ? own : L('lib_store').settings(app).getInt('low_stock');
}

function variantStock(app, v, reserved) {
  const res = reserved !== undefined ? reserved : reservedOf(app, v.id);
  const onHand = v.getInt('on_hand');
  const available = onHand - res;
  const low = lowOf(app, v);
  return { on_hand: onHand, reserved: res, available: available, low_stock: low, state: available <= 0 ? 'out' : available <= low ? 'low' : 'ok' };
}

/** The number a shop should show for `available` under its stock rule. */
function ruleQty(shop, available) {
  const share = shop.getInt('stock_share');
  let q = Math.floor((Math.max(0, available) * (share > 0 ? share : 0)) / 100) - shop.getInt('stock_buffer');
  if (q < 0) q = 0;
  const max = shop.getInt('stock_max');
  if (max > 0 && q > max) q = max;
  return q;
}

/** What each shop should show and does not yet: one row per live listing and SKU. */
function plan(app, shopId) {
  const U = L('lib_util');
  const reserved = reservedMap(app);
  const out = [];
  const filter = "status = 'live'" + (shopId ? ' && shop = {:s}' : '');
  const shops = {};
  for (const l of app.findRecordsByFilter('listings', filter, '', 0, 0, { s: shopId || '' })) {
    const sid = l.getString('shop');
    if (shops[sid] === undefined) shops[sid] = U.byId(app, 'shops', sid);
    const shop = shops[sid];
    if (shop === null) continue;
    const product = U.byId(app, 'products', l.getString('product'));
    if (product === null) continue;
    const pushed = U.json(l, 'pushed', {});
    for (const v of app.findRecordsByFilter('variants', 'product = {:p}', 'sort,created', 0, 0, { p: product.id })) {
      const available = v.getInt('on_hand') - (reserved[v.id] || 0);
      const target = ruleQty(shop, available);
      const last = pushed[v.id] === undefined ? null : Number(pushed[v.id]);
      if (last === target) continue;
      out.push({ shop: { id: shop.id, name: shop.getString('name'), platform: shop.getString('platform') }, listing: l.id, product: product.id, title: product.getString('title'), variant: v.id, sku: v.getString('sku'), option: v.getString('option'), qty: target, last: last, available: available });
    }
  }
  return out;
}

/* ------------------------------------------------------------------- ops */

function overview(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const reserved = reservedMap(app);
  const q = String(p.q || '').trim().toLowerCase();
  const base = L('lib_store').baseOrEmpty(app);
  const rows = [];
  const products = {};
  for (const v of app.findRecordsByFilter('variants', '1=1', 'sku', 0, 0)) {
    const pid = v.getString('product');
    if (products[pid] === undefined) products[pid] = U.byId(app, 'products', pid);
    const prod = products[pid];
    if (prod === null) continue;
    if (q !== '' && (v.getString('sku') + ' ' + v.getString('option') + ' ' + prod.getString('title') + ' ' + v.getString('barcode')).toLowerCase().indexOf(q) < 0) continue;
    const st = variantStock(app, v, reserved[v.id] || 0);
    if (p.filter === 'low' && st.state !== 'low') continue;
    if (p.filter === 'out' && st.state !== 'out') continue;
    if (p.filter === 'attention' && st.state === 'ok') continue;
    rows.push(Object.assign({ variant: v.id, product: pid, title: prod.getString('title'), sku: v.getString('sku'), option: v.getString('option'), price: U.toMajor(v.getInt('price_minor'), base), cost: U.toMajor(v.getInt('cost_minor'), base), cost_missing: v.getInt('cost_minor') <= 0, value: U.toMajor(v.getInt('cost_minor') * Math.max(0, v.getInt('on_hand')), base), image: firstImage(prod) }, st));
  }
  const limit = Math.min(Math.max(Math.round(p.limit || 200), 1), 1000);
  const totals = { skus: rows.length, low: rows.filter((r) => r.state === 'low').length, out: rows.filter((r) => r.state === 'out').length, units: rows.reduce((n, r) => n + Math.max(0, r.on_hand), 0), value: Number(rows.reduce((n, r) => n + r.value, 0).toFixed(U.exp(base))) };
  return { currency: base, totals: totals, rows: rows.slice(0, limit) };
}

function firstImage(prod) {
  const imgs = prod.getStringSlice('images');
  if (!imgs || imgs.length === 0) return '';
  return '/api/files/products/' + prod.id + '/' + imgs[0] + '?thumb=200x200';
}

function moves(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const v = variantRef(app, p.variant);
  const limit = Math.min(Math.max(Math.round(p.limit || 50), 1), 500);
  return {
    variant: v.id,
    sku: v.getString('sku'),
    moves: app.findRecordsByFilter('stock_moves', 'variant = {:v}', '-created', limit, 0, { v: v.id }).map((m) => ({ id: m.id, qty: m.getInt('qty'), reason: m.getString('reason'), ref: m.getString('ref'), note: m.getString('note'), actor: m.getString('actor'), balance: m.getInt('balance'), created: m.getString('created') })),
    stock: variantStock(app, v),
  };
}

function adjust(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const v = variantRef(app, p.variant);
  const qty = U.int(p.qty, 'qty');
  if (qty === 0) throw U.fail(400, 'qty must not be 0: give +12 for stock received, -2 for damaged.', 'invalid_param', { param: 'qty' });
  const reason = p.reason || (qty > 0 ? 'received' : 'adjust');
  if (['received', 'adjust', 'damage', 'return'].indexOf(reason) < 0) throw U.fail(400, 'reason must be one of: received, adjust, damage, return.', 'invalid_param', { param: 'reason' });
  const balance = move(app, v, qty, reason, p.ref || '', p.note || '', ctx.actor);
  L('lib_store').log(app, ctx.actor, (qty > 0 ? '+' : '') + qty + ' ' + v.getString('sku') + ' (' + reason + '), now ' + balance + ' on hand', 'variant:' + v.id);
  return { variant: v.id, sku: v.getString('sku'), stock: variantStock(app, v) };
}

function countSet(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const v = variantRef(app, p.variant);
  const target = U.int(p.on_hand, 'on_hand');
  if (target < 0) throw U.fail(400, 'on_hand cannot be negative.', 'invalid_param', { param: 'on_hand' });
  const delta = target - v.getInt('on_hand');
  move(app, v, delta, 'count', '', p.note || 'Counted', ctx.actor);
  L('lib_store').log(app, ctx.actor, 'Counted ' + v.getString('sku') + ': ' + target + ' on hand (' + (delta >= 0 ? '+' : '') + delta + ')', 'variant:' + v.id);
  return { variant: v.id, sku: v.getString('sku'), stock: variantStock(app, v) };
}

function planOp(ctx, p) {
  const app = ctx.app;
  const shopId = p.shop ? L('lib_shops').ref(app, p.shop).id : '';
  let rows = plan(app, shopId);
  if (p.sku) {
    const v = variantRef(app, p.sku, 'sku');
    rows = rows.filter((r) => r.product === v.getString('product'));
  }
  return { rows: rows, shop_count: Object.keys(rows.reduce((o, r) => Object.assign(o, { [r.shop.id]: 1 }), {})).length };
}

/**
 * Record that shops now show these quantities (your AI agent set them, or you
 * did). Each item names its shop, or --shop names it for all of them.
 */
function markPushed(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const Sh = L('lib_shops');
  const fallback = p.shop ? Sh.ref(app, p.shop) : null;
  let items = U.list(p.items, 'items');
  if (p.all === true) {
    if (fallback === null && !p.sku) throw U.fail(400, '--all true needs --shop (every row of that shop) or --sku (that product on every shop).', 'missing_param', { param: 'shop' });
    let rows = plan(app, fallback === null ? '' : fallback.id);
    if (p.sku) {
      const pv = variantRef(app, p.sku, 'sku');
      rows = rows.filter((r) => r.product === pv.getString('product'));
    }
    items = rows.map((r) => ({ shop: r.shop.id, sku: r.sku, qty: r.qty }));
  }
  if (items.length === 0) throw U.fail(400, 'Give --items \'[{"shop":"Shopee MY","sku":"MUG-BLU","qty":12}]\' (shop may be left out with --shop) or --shop and --all true for every row of stock.plan.', 'missing_param', { param: 'items' });
  const now = U.now();
  const problems = [];
  const done = {};
  const shops = {};
  for (const it of items) {
    let shop = fallback;
    if (it.shop) {
      try {
        shop = Sh.ref(app, it.shop);
      } catch (err) {
        problems.push(String(it.shop) + ': ' + err.message);
        continue;
      }
    }
    if (shop === null) {
      problems.push(String(it.sku || it.variant) + ': name its shop ("shop" in the item, or --shop)');
      continue;
    }
    let v;
    try {
      v = variantRef(app, it.sku || it.variant, 'sku');
    } catch (err) {
      problems.push(String(it.sku || it.variant) + ': ' + err.message);
      continue;
    }
    const l = U.findOne(app, 'listings', 'product = {:p} && shop = {:s}', { p: v.getString('product'), s: shop.id });
    if (l === null) {
      problems.push(v.getString('sku') + ': not listed on ' + shop.getString('name'));
      continue;
    }
    const pushed = U.json(l, 'pushed', {});
    pushed[v.id] = U.int(it.qty, 'qty');
    l.set('pushed', pushed);
    l.set('pushed_at', now);
    app.save(l);
    shops[shop.id] = shop;
    done[shop.id] = (done[shop.id] || 0) + 1;
  }
  let updated = 0;
  for (const id of Object.keys(done)) {
    const name = shops[id].getString('name');
    updated += done[id];
    L('lib_store').log(app, ctx.actor, 'Set stock on ' + name + ' for ' + done[id] + ' SKU' + (done[id] === 1 ? '' : 's'), 'shop:' + id);
    if (plan(app, id).length === 0) L('lib_tasks').finishFor(app, 'shop:' + id, 'push_stock', 'Stock set for ' + done[id] + ' SKUs');
  }
  return { updated: updated, problems: problems, left: plan(app, '').length };
}

function requestPush(ctx, p) {
  const app = ctx.app;
  const shop = L('lib_shops').ref(app, p.shop);
  const rows = plan(app, shop.id);
  if (rows.length === 0) return { task: null, rows: 0 };
  const t = L('lib_tasks').queue(app, 'push_stock', 'shop:' + shop.id, 'Set stock on ' + shop.getString('name') + ' for ' + rows.length + ' SKU' + (rows.length === 1 ? '' : 's'), { shop: shop.id }, ctx.actor);
  return { task: t, rows: rows.length };
}

module.exports = {
  REASONS: REASONS,
  variantRef: variantRef,
  reservedMap: reservedMap,
  reservedOf: reservedOf,
  move: move,
  variantStock: variantStock,
  ruleQty: ruleQty,
  plan: plan,
  firstImage: firstImage,
  overview: overview,
  moves: moves,
  adjust: adjust,
  countSet: countSet,
  planOp: planOp,
  markPushed: markPushed,
  requestPush: requestPush,
};
