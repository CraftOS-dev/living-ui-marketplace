/// <reference path="../pb_data/types.d.ts" />
/**
 * Orders from every shop in one queue.
 *
 *   unpaid -> to_ship -> shipped -> delivered      (returned, cancelled)
 *
 * Amounts are minor units of the order's currency; cost of goods is in the
 * base currency (each line keeps the unit cost it sold at; a missing cost is
 * filled in when you add it later). Profit = net sales (items - discount +
 * shipping charged - refunds) - platform fees - your shipping cost - cost of
 * goods. Fees are estimated from the shop's fee rates until real fees arrive.
 *
 * Stock: open orders reserve their items; shipping one in Store OS takes the
 * items off the shelf (a "sale" stock move). An order that arrives already
 * shipped (an import of past orders) does not move stock: those items left
 * before your stock count.
 *
 * Ship-by: when the order must be handed over, from the shop's days to ship
 * unless the platform gave a date. "late" is past it, "due soon" within a day.
 * A shipment with no new tracking event for 7 days is "stalled".
 */

const STATUSES = ['unpaid', 'to_ship', 'shipped', 'delivered', 'returned', 'cancelled'];
const PAYMENTS = ['paid', 'pending', 'cod', 'refunded', 'partial_refund'];
const TRACK = ['pending', 'info_received', 'in_transit', 'out_for_delivery', 'available_for_pickup', 'delivered', 'failed_attempt', 'exception', 'returned'];
const VIEWS = ['to_ship', 'unpaid', 'at_risk', 'shipped', 'exceptions', 'delivered', 'returns', 'cancelled', 'unlinked', 'all'];
const RANK = { unpaid: 0, to_ship: 1, shipped: 2, delivered: 3, returned: 4, cancelled: 5 };
const STALL_DAYS = 7;

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

/** An order by id, or by its number (with --shop when two shops share a number). */
function ref(app, value, shopValue) {
  const U = L('lib_util');
  const v = String(value || '').trim();
  if (v === '') throw U.fail(400, 'Name the order with --order <id or order number>.', 'missing_param', { param: 'order' });
  const byId = U.byId(app, 'orders', v);
  if (byId !== null) return byId;
  const filter = shopValue ? 'number = {:n} && shop = {:s}' : 'number = {:n}';
  const shopId = shopValue ? L('lib_shops').ref(app, shopValue).id : '';
  const found = app.findRecordsByFilter('orders', filter, '', 3, 0, { n: v.replace(/^#/, ''), s: shopId });
  if (found.length === 1) return found[0];
  if (found.length > 1) throw U.fail(409, 'Order number ' + v + ' exists in more than one shop; add --shop.', 'ambiguous');
  throw U.fail(404, 'No order "' + v + '". Run orders.list --q "' + v + '".', 'not_found');
}

function linesOf(app, orderId) {
  return app.findRecordsByFilter('order_lines', 'order_ref = {:o}', 'sort,created', 0, 0, { o: orderId });
}

function shipmentsOf(app, orderId) {
  return app.findRecordsByFilter('shipments', 'order_ref = {:o}', 'created', 0, 0, { o: orderId });
}

/** late | due_soon | ok | exception | stalled | done */
function health(o, ships) {
  const U = L('lib_util');
  const st = o.getString('status');
  if (st === 'unpaid' || st === 'to_ship') {
    const h = U.hoursUntil(o.getString('ship_by'));
    if (h === null) return 'ok';
    if (h < 0) return 'late';
    if (h < 24) return 'due_soon';
    return 'ok';
  }
  if (st === 'shipped') {
    const s = ships && ships.length > 0 ? ships[ships.length - 1] : null;
    const ts = s ? s.getString('status') : '';
    if (ts === 'failed_attempt' || ts === 'exception' || ts === 'returned') return 'exception';
    const last = (s && (s.getString('last_event_at') || s.getString('shipped_at'))) || o.getString('shipped_at');
    if (last && Date.now() - new Date(last).getTime() > STALL_DAYS * 86400000) return 'stalled';
    return 'ok';
  }
  return 'done';
}

/* ------------------------------------------------------------- amounts */

/** Totals, estimated fees and cost of goods, from the lines and the shop. Saves the order. */
function recompute(app, o, shop) {
  const lines = linesOf(app, o.id);
  let subtotal = 0;
  let cogs = 0;
  let missing = false;
  for (const l of lines) {
    subtotal += l.getInt('qty') * l.getInt('price_minor');
    const kept = Math.max(0, l.getInt('qty') - l.getInt('qty_returned'));
    if (l.getString('kind') === 'extra') cogs += kept * l.getInt('cost_minor');
    else if (l.getString('variant') === '' || l.getInt('cost_minor') <= 0) {
      if (kept > 0) missing = true;
    } else cogs += kept * l.getInt('cost_minor');
  }
  if (lines.length > 0) o.set('subtotal_minor', subtotal);
  if (o.getString('status') === 'cancelled') {
    cogs = 0;
    missing = false;
  }
  o.set('cogs_minor', cogs);
  o.set('cost_missing', missing);
  if (o.getBool('fees_estimated')) {
    const sh = shop || app.findRecordById('shops', o.getString('shop'));
    const itemsNet = Math.max(0, o.getInt('subtotal_minor') - o.getInt('discount_minor'));
    const fee = o.getString('status') === 'cancelled' ? 0 : Math.round((itemsNet * sh.getInt('commission_bps')) / 10000 + (o.getInt('total_minor') * sh.getInt('payment_bps')) / 10000 + sh.getInt('fixed_fee_minor'));
    o.set('fees_minor', fee);
  }
  app.save(o);
}

/** Estimated fees again for every order of a shop whose fees were estimated (the fee rates changed). */
function refeeShop(app, shopId) {
  const shop = app.findRecordById('shops', shopId);
  for (const o of app.findRecordsByFilter('orders', 'shop = {:s} && fees_estimated = true', '', 0, 0, { s: shopId })) recompute(app, o, shop);
}

/** A cost was added to a SKU: lines that sold without a cost take it, and their orders' profit follows. */
function recostVariant(app, variantId) {
  const v = app.findRecordById('variants', variantId);
  const cost = v.getInt('cost_minor');
  if (cost <= 0) return;
  const touched = {};
  for (const l of app.findRecordsByFilter('order_lines', 'variant = {:v} && cost_minor <= 0', '', 0, 0, { v: variantId })) {
    l.set('cost_minor', cost);
    app.save(l);
    touched[l.getString('order_ref')] = true;
  }
  for (const id of Object.keys(touched)) recompute(app, app.findRecordById('orders', id), null);
}

/** Money of an order: native amounts plus profit in the base currency. */
function money(app, o, table) {
  const U = L('lib_util');
  const S = L('lib_store');
  const cur = o.getString('currency');
  const base = S.baseOrEmpty(app);
  const net = o.getInt('subtotal_minor') - o.getInt('discount_minor') + o.getInt('shipping_minor') - o.getInt('refund_minor');
  const afterCosts = net - o.getInt('fees_minor') - o.getInt('ship_cost_minor');
  const netBase = S.toBase(app, net, cur, table);
  const afterBase = S.toBase(app, afterCosts, cur, table);
  const profitBase = afterBase === null ? null : afterBase - o.getInt('cogs_minor');
  return {
    currency: cur,
    base: base,
    subtotal: U.toMajor(o.getInt('subtotal_minor'), cur),
    discount: U.toMajor(o.getInt('discount_minor'), cur),
    shipping: U.toMajor(o.getInt('shipping_minor'), cur),
    tax: U.toMajor(o.getInt('tax_minor'), cur),
    total: U.toMajor(o.getInt('total_minor'), cur),
    refund: U.toMajor(o.getInt('refund_minor'), cur),
    fees: U.toMajor(o.getInt('fees_minor'), cur),
    fees_estimated: o.getBool('fees_estimated'),
    ship_cost: U.toMajor(o.getInt('ship_cost_minor'), cur),
    net_sales: U.toMajor(net, cur),
    net_sales_base: netBase === null ? null : U.toMajor(netBase, base),
    cogs_base: U.toMajor(o.getInt('cogs_minor'), base),
    profit_base: profitBase === null ? null : U.toMajor(profitBase, base),
    margin_pct: netBase !== null && netBase > 0 && profitBase !== null ? Math.round((profitBase / netBase) * 1000) / 10 : null,
    cost_missing: o.getBool('cost_missing'),
  };
}

function round1(v) {
  return v === null || v === undefined ? null : Math.round(v * 10) / 10;
}

/** An order's stored values without its timestamps, to tell whether a sync changed anything. */
function snap(o) {
  const x = o.publicExport();
  const out = {};
  for (const k of Object.keys(x).sort()) if (k !== 'updated' && k !== 'created') out[k] = x[k];
  return JSON.stringify(out);
}

/* --------------------------------------------------------------- views */

function shipView(s) {
  const U = L('lib_util');
  return { id: s.id, carrier: s.getString('carrier'), tracking: s.getString('tracking'), url: s.getString('url'), status: s.getString('status') || 'pending', last_event: s.getString('last_event'), last_event_at: s.getString('last_event_at'), shipped_at: s.getString('shipped_at'), delivered_at: s.getString('delivered_at'), eta: s.getString('eta'), events: U.json(s, 'events', []), checked_at: s.getString('checked_at') };
}

function rowView(app, o, shopsMap, shipsMap, tasks) {
  const U = L('lib_util');
  const shop = (shopsMap && shopsMap[o.getString('shop')]) || U.byId(app, 'shops', o.getString('shop'));
  const ships = shipsMap ? shipsMap[o.id] || [] : shipmentsOf(app, o.id);
  const lines = linesOf(app, o.id);
  const last = ships.length > 0 ? ships[ships.length - 1] : null;
  const cur = o.getString('currency');
  return {
    id: o.id,
    number: o.getString('number'),
    shop: shop ? { id: shop.id, name: shop.getString('name'), platform: shop.getString('platform') } : { id: '', name: '', platform: '' },
    placed_at: o.getString('placed_at'),
    buyer_name: o.getString('buyer_name'),
    customer: o.getString('customer'),
    units: lines.reduce((n, l) => n + l.getInt('qty'), 0),
    first_item: lines.length > 0 ? lines[0].getString('title') : '',
    lines: lines.length,
    total: U.toMajor(o.getInt('total_minor'), cur),
    currency: cur,
    status: o.getString('status'),
    payment: o.getString('payment'),
    ship_by: o.getString('ship_by'),
    hours_left: o.getString('status') === 'to_ship' || o.getString('status') === 'unpaid' ? round1(U.hoursUntil(o.getString('ship_by'))) : null,
    health: health(o, ships),
    carrier: last ? last.getString('carrier') : '',
    tracking: last ? last.getString('tracking') : '',
    tracking_status: last ? last.getString('status') || 'pending' : '',
    unlinked: lines.some((l) => l.getString('variant') === '' && l.getString('kind') !== 'extra'),
    source: o.getString('source'),
    task: tasks ? tasks['order:' + o.id] || null : null,
  };
}

function detail(app, o, isAgent) {
  const U = L('lib_util');
  const shop = app.findRecordById('shops', o.getString('shop'));
  const ships = shipmentsOf(app, o.id);
  const lines = linesOf(app, o.id);
  const base = L('lib_store').baseOrEmpty(app);
  const cur = o.getString('currency');
  const tasks = L('lib_tasks').openMap(app);
  const row = rowView(app, o, { [shop.id]: shop }, { [o.id]: ships }, tasks);
  const lineViews = lines.map((l) => {
    const v = l.getString('variant') ? U.byId(app, 'variants', l.getString('variant')) : null;
    const prod = v ? U.byId(app, 'products', v.getString('product')) : null;
    return { id: l.id, kind: l.getString('kind') || 'item', sku: l.getString('sku'), title: l.getString('title'), option: l.getString('option'), qty: l.getInt('qty'), price: U.toMajor(l.getInt('price_minor'), cur), cost: U.toMajor(l.getInt('cost_minor'), base), qty_shipped: l.getInt('qty_shipped'), qty_returned: l.getInt('qty_returned'), variant: v ? v.id : '', product: prod ? prod.id : '', image: prod ? L('lib_stock').firstImage(prod) : '' };
  });
  const timeline = [];
  const push = (at, kind, text) => {
    if (at) timeline.push({ at: at, kind: kind, text: text });
  };
  push(o.getString('placed_at'), 'placed', 'Order placed on ' + shop.getString('name'));
  push(o.getString('shipped_at'), 'shipped', 'Shipped');
  push(o.getString('delivered_at'), 'delivered', 'Delivered');
  push(o.getString('cancelled_at'), 'cancelled', 'Cancelled' + (o.getString('cancel_reason') ? ': ' + o.getString('cancel_reason') : ''));
  for (const s of ships) for (const ev of U.json(s, 'events', [])) push(String(ev.at || ''), 'tracking', String(ev.text || ev.status || ''));
  for (const a of app.findRecordsByFilter('activity', 'target = {:t}', '-created', 40, 0, { t: 'order:' + o.id })) push(a.getString('created').replace(' ', 'T'), 'activity', a.getString('text') + (a.getString('actor') === 'agent' ? ' (your AI agent)' : ''));
  const threads = app.findRecordsByFilter('threads', 'order_ref = {:o}' + (o.getString('customer') ? ' || customer = {:c}' : ''), '-last_at', 10, 0, { o: o.id, c: o.getString('customer') });
  for (const t of threads) push(t.getString('last_at'), 'message', 'Conversation: ' + t.getString('subject'));
  timeline.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const cust = o.getString('customer') ? U.byId(app, 'customers', o.getString('customer')) : null;
  const custOrders = cust ? U.count(app, "SELECT COUNT(*) AS n FROM orders WHERE customer = {:c} AND status != 'cancelled'", { c: cust.id }) : 0;
  return Object.assign(row, {
    buyer_email: o.getString('buyer_email'),
    buyer_phone: o.getString('buyer_phone'),
    address: U.json(o, 'address', {}),
    purged: o.getBool('purged'),
    note: o.getString('note'),
    shipped_at: o.getString('shipped_at'),
    delivered_at: o.getString('delivered_at'),
    cancelled_at: o.getString('cancelled_at'),
    cancel_reason: o.getString('cancel_reason'),
    shop_detail: { id: shop.id, name: shop.getString('name'), platform: shop.getString('platform'), admin_url: L('lib_shops').view(app, shop, null, null).admin_url, ship_days: shop.getInt('ship_days') },
    money: money(app, o, null),
    lines_detail: lineViews,
    shipments: ships.map(shipView),
    customer_detail: cust ? { id: cust.id, name: cust.getString('name'), email: cust.getString('email'), phone: cust.getString('phone'), orders: custOrders } : null,
    threads: threads.map((t) => ({ id: t.id, subject: t.getString('subject'), status: t.getString('status'), last_at: t.getString('last_at') })),
    timeline: timeline,
    tasks: app.findRecordsByFilter('tasks', 'target = {:t}', '-created', 5, 0, { t: 'order:' + o.id }).map((t) => L('lib_tasks').view(t)),
  });
}

/* ------------------------------------------------------------------ reads */

function list(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const view = p.view || 'to_ship';
  const shopId = p.shop ? L('lib_shops').ref(app, p.shop).id : '';
  const q = String(p.q || '').trim().replace(/^#/, '');
  const parts = [];
  const params = { s: shopId, q: q, from: p.from ? U.isoDate(p.from, 'from') : '', to: p.to ? U.isoDate(p.to, 'to') : '' };
  if (shopId !== '') parts.push('shop = {:s}');
  if (q !== '') parts.push('(number ~ {:q} || buyer_name ~ {:q} || buyer_email ~ {:q} || buyer_phone ~ {:q})');
  if (params.from !== '') parts.push('placed_at >= {:from}');
  if (params.to !== '') parts.push('placed_at <= {:to}');
  const where = parts.length > 0 ? parts.join(' && ') : '1=1';
  const all = app.findRecordsByFilter('orders', where, '-placed_at', 0, 0, params);
  const shipsMap = {};
  for (const s of app.findRecordsByFilter('shipments', '1=1', 'created', 0, 0)) {
    const k = s.getString('order_ref');
    if (!shipsMap[k]) shipsMap[k] = [];
    shipsMap[k].push(s);
  }
  const shopsMap = {};
  for (const s of app.findRecordsByFilter('shops', '1=1', '', 0, 0)) shopsMap[s.id] = s;
  const counts = {};
  for (const v of VIEWS) counts[v] = 0;
  const picked = [];
  const unlinkedSet = {};
  for (const r of U.rows(app, "SELECT DISTINCT order_ref AS id FROM order_lines WHERE variant = '' AND kind != 'extra'", {}, { id: '' })) unlinkedSet[r.id] = true;
  for (const o of all) {
    const st = o.getString('status');
    const h = health(o, shipsMap[o.id] || []);
    const inView = {
      to_ship: st === 'to_ship',
      unpaid: st === 'unpaid',
      at_risk: (st === 'to_ship' || st === 'unpaid') && (h === 'late' || h === 'due_soon'),
      shipped: st === 'shipped',
      exceptions: st === 'shipped' && (h === 'exception' || h === 'stalled'),
      delivered: st === 'delivered',
      returns: st === 'returned' || o.getInt('refund_minor') > 0,
      cancelled: st === 'cancelled',
      unlinked: unlinkedSet[o.id] === true && st !== 'cancelled',
      all: true,
    };
    for (const v of VIEWS) if (inView[v]) counts[v]++;
    if (inView[view]) picked.push(o);
  }
  if (view === 'to_ship' || view === 'at_risk' || view === 'unpaid') picked.sort((a, b) => (a.getString('ship_by') || '9') < (b.getString('ship_by') || '9') ? -1 : 1);
  const limit = Math.min(Math.max(Math.round(p.limit || 100), 1), 500);
  const offset = Math.max(Math.round(p.offset || 0), 0);
  const tasks = L('lib_tasks').openMap(app);
  return { view: view, total: picked.length, counts: counts, orders: picked.slice(offset, offset + limit).map((o) => rowView(app, o, shopsMap, shipsMap, tasks)) };
}

function get(ctx, p) {
  return { order: detail(ctx.app, ref(ctx.app, p.order, p.shop), ctx.isAgent) };
}

/* ----------------------------------------------------------------- writes */

function addressOf(v) {
  const U = L('lib_util');
  if (v === undefined || v === null || v === '') return {};
  if (typeof v === 'object' && !Array.isArray(v)) {
    const out = {};
    for (const k of ['name', 'line1', 'line2', 'city', 'state', 'postcode', 'country', 'phone', 'text']) if (v[k] !== undefined && v[k] !== null && String(v[k]).trim() !== '') out[k] = U.clip(String(v[k]), 300);
    return out;
  }
  const s = String(v).trim();
  if (s.charAt(0) === '{') return addressOf(U.obj(s, 'address'));
  return { text: U.clip(s, 1000) };
}

function nextDirectNumber(app, shopId) {
  const n = L('lib_util').count(app, 'SELECT COUNT(*) AS n FROM orders WHERE shop = {:s}', { s: shopId });
  for (let i = n + 1001; i < n + 100000; i++) {
    if (app.findRecordsByFilter('orders', 'shop = {:s} && number = {:n}', '', 1, 0, { s: shopId, n: 'D' + i }).length === 0) return 'D' + i;
  }
  return 'D' + Date.now();
}

/** Lines from [{sku|variant|title, qty, price, option}] in the order's currency. */
function writeLines(ctx, o, items, cur) {
  const U = L('lib_util');
  const app = ctx.app;
  for (const old of linesOf(app, o.id)) app.delete(old);
  const unlinked = [];
  const extras = U.json(L('lib_store').settings(app), 'extras', {});
  items.forEach((it, i) => {
    if (!it || typeof it !== 'object') throw U.fail(400, 'Each line is an object like {"sku":"MUG-BLU","qty":2,"price":29}.', 'invalid_param', { param: 'lines' });
    let v = null;
    const key = String(it.variant || it.sku || '').trim();
    if (key !== '') {
      try {
        v = L('lib_stock').variantRef(app, key, 'sku');
      } catch {
        v = null;
      }
    }
    const qty = it.qty === undefined || it.qty === '' ? 1 : U.int(it.qty, 'qty');
    if (qty <= 0) throw U.fail(400, 'A line\'s qty must be at least 1.', 'invalid_param', { param: 'lines' });
    const l = U.newRecord(app, 'order_lines');
    l.set('order_ref', o.id);
    l.set('variant', v ? v.id : '');
    l.set('sku', U.clip(v ? v.getString('sku') : String(it.sku || ''), 120));
    let title = String(it.title || '').trim();
    if (title === '' && v) title = app.findRecordById('products', v.getString('product')).getString('title');
    l.set('title', U.clip(title || String(it.sku || 'Item'), 300));
    l.set('option', U.clip(it.option !== undefined ? it.option : v ? v.getString('option') : '', 120));
    l.set('qty', qty);
    let price = it.price;
    if ((price === undefined || price === '') && v) {
      const base = L('lib_store').baseOrEmpty(app);
      price = cur === base ? U.toMajor(v.getInt('price_minor'), base) : undefined;
    }
    l.set('price_minor', U.toMinor(price, cur, 'price'));
    l.set('cost_minor', v ? v.getInt('cost_minor') : 0);
    l.set('qty_shipped', 0);
    l.set('qty_returned', 0);
    l.set('sort', i);
    l.set('kind', 'item');
    if (!v) {
      // A line you marked as not a product before (gift card, gift wrap) keeps that.
      const known = extras[extraKey(l.getString('sku'), l.getString('title'))];
      if (known !== undefined) {
        l.set('kind', 'extra');
        l.set('cost_minor', Number(known) || 0);
      }
    }
    app.save(l);
    if (!v && l.getString('kind') !== 'extra') unlinked.push(String(it.sku || it.title || 'line ' + (i + 1)));
  });
  return unlinked;
}

/** How a line that is not a product is remembered: by its SKU, else its title. */
function extraKey(sku, title) {
  const k = String(sku || '').trim().toLowerCase();
  return k !== '' ? 'sku:' + k : 'title:' + String(title || '').trim().toLowerCase();
}

/** Take shipped items off the shelf (lines not shipped yet). */
function shipLines(ctx, o, postMoves) {
  const app = ctx.app;
  for (const l of linesOf(app, o.id)) {
    const left = l.getInt('qty') - l.getInt('qty_shipped');
    if (left <= 0) continue;
    if (postMoves && l.getString('variant') !== '') {
      const v = L('lib_util').byId(app, 'variants', l.getString('variant'));
      if (v !== null) L('lib_stock').move(app, v, -left, 'sale', 'order ' + o.getString('number'), '', ctx.actor);
    }
    l.set('qty_shipped', l.getInt('qty'));
    app.save(l);
  }
}

function upsertShipment(app, o, d) {
  const U = L('lib_util');
  const ships = shipmentsOf(app, o.id);
  let s = null;
  if (d.tracking) for (const x of ships) if (x.getString('tracking') === d.tracking) s = x;
  if (s === null && ships.length === 1 && ships[0].getString('tracking') === '') s = ships[0];
  if (s === null) {
    s = U.newRecord(app, 'shipments');
    s.set('order_ref', o.id);
    s.set('status', 'info_received');
    s.set('events', []);
  }
  if (d.carrier !== undefined) s.set('carrier', U.clip(d.carrier, 80));
  if (d.tracking !== undefined) s.set('tracking', U.clip(d.tracking, 120));
  if (d.url !== undefined) s.set('url', U.clip(d.url, 500));
  if (d.shipped_at) s.set('shipped_at', d.shipped_at);
  if (d.status) s.set('status', U.oneOf(d.status, TRACK, 'tracking status'));
  app.save(s);
  return s;
}

function setStatus(ctx, o, next, at) {
  const U = L('lib_util');
  const prev = o.getString('status');
  if (prev === next) return;
  if ((prev === 'unpaid' || prev === 'to_ship') && (next === 'shipped' || next === 'delivered')) shipLines(ctx, o, true);
  if (next === 'shipped' && o.getString('shipped_at') === '') o.set('shipped_at', at || U.now());
  if (next === 'delivered') {
    if (o.getString('shipped_at') === '') o.set('shipped_at', at || U.now());
    if (o.getString('delivered_at') === '') o.set('delivered_at', at || U.now());
  }
  if (next === 'cancelled' && o.getString('cancelled_at') === '') o.set('cancelled_at', at || U.now());
  o.set('status', next);
}

function add(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const base = L('lib_store').base(app);
  const shop = p.shop ? L('lib_shops').ref(app, p.shop) : U.findOne(app, 'shops', "platform = 'direct'", {});
  if (shop === null) throw U.fail(400, 'Name the shop with --shop.', 'missing_param', { param: 'shop' });
  const items = U.list(p.lines, 'lines');
  if (items.length === 0) throw U.fail(400, 'An order needs at least one line: --lines \'[{"sku":"MUG-BLU","qty":2,"price":29}]\'.', 'missing_param', { param: 'lines' });
  const number = String(p.number || '').trim().replace(/^#/, '') || nextDirectNumber(app, shop.id);
  if (app.findRecordsByFilter('orders', 'shop = {:s} && number = {:n}', '', 1, 0, { s: shop.id, n: number }).length > 0) throw U.fail(409, shop.getString('name') + ' already has order ' + number + '.', 'conflict');
  const cur = (p.currency ? String(p.currency).toUpperCase() : '') || shop.getString('currency') || base;
  const placed = p.placed_at ? U.isoDate(p.placed_at, 'placed_at') : U.now();
  const o = U.newRecord(app, 'orders');
  o.set('shop', shop.id);
  o.set('number', U.clip(number, 120));
  o.set('placed_at', placed);
  o.set('currency', cur);
  o.set('buyer_name', U.clip(p.buyer_name || '', 200));
  o.set('buyer_email', U.clip(p.buyer_email || '', 200));
  o.set('buyer_phone', U.clip(p.buyer_phone || '', 60));
  o.set('address', addressOf(p.address));
  o.set('status', p.status ? U.oneOf(p.status, ['unpaid', 'to_ship'], 'status') : 'to_ship');
  o.set('payment', p.payment ? U.oneOf(p.payment, PAYMENTS, 'payment') : 'paid');
  o.set('ship_by', p.ship_by ? U.isoDate(p.ship_by, 'ship_by') : U.addDays(placed, shop.getInt('ship_days') || 2));
  o.set('shipping_minor', U.toMinor(p.shipping, cur, 'shipping'));
  o.set('discount_minor', U.toMinor(p.discount, cur, 'discount'));
  o.set('tax_minor', U.toMinor(p.tax, cur, 'tax'));
  o.set('ship_cost_minor', U.toMinor(p.ship_cost, cur, 'ship_cost'));
  o.set('fees_estimated', p.fees === undefined || p.fees === '');
  o.set('fees_minor', U.toMinor(p.fees, cur, 'fees'));
  o.set('note', U.clip(p.note || '', 2000));
  o.set('source', ctx.isAgent ? 'agent' : 'manual');
  o.set('purged', false);
  const c = L('lib_customers').match(app, { name: p.buyer_name, email: p.buyer_email, phone: p.buyer_phone, shop: shop.id });
  if (c !== null) o.set('customer', c.id);
  app.save(o);
  const unlinked = writeLines(ctx, o, items, cur);
  recompute(app, o, shop);
  const lines = linesOf(app, o.id);
  const sub = lines.reduce((n, l) => n + l.getInt('qty') * l.getInt('price_minor'), 0);
  o.set('total_minor', p.total !== undefined && p.total !== '' ? U.toMinor(p.total, cur, 'total') : sub - o.getInt('discount_minor') + o.getInt('shipping_minor') + o.getInt('tax_minor'));
  recompute(app, o, shop);
  L('lib_store').log(app, ctx.actor, 'New order ' + number + ' on ' + shop.getString('name') + ' (' + U.fmt(o.getInt('total_minor'), cur) + ')', 'order:' + o.id);
  return { order: detail(app, o, ctx.isAgent), unlinked: unlinked };
}

/**
 * Create or update orders from a sync or an import. Matched on (shop, number):
 * a replayed batch changes nothing. Status only moves forward (a stale export
 * never puts a shipped order back to "to ship"); lines are rewritten only
 * while the order is still open.
 */
function upsertMany(ctx, p, importId) {
  const U = L('lib_util');
  const app = ctx.app;
  const base = L('lib_store').base(app);
  const shop = L('lib_shops').ref(app, p.shop);
  const items = U.list(p.items, 'items');
  if (items.length === 0) throw U.fail(400, 'Give --items as a JSON list of orders (see app.guide, "order rows").', 'missing_param', { param: 'items' });
  if (items.length > 2000) throw U.fail(400, 'Send at most 2000 orders at a time.', 'too_many');
  const out = { created: 0, updated: 0, unchanged: 0, skipped: 0, problems: [], unlinked: [], notes: [] };
  const cur0 = shop.getString('currency') || base;
  let paymentDefaulted = 0;
  items.forEach((it, i) => {
    const row = i + 1;
    try {
      if (!it || typeof it !== 'object') throw U.fail(400, 'not an object');
      const number = String(it.number || '').trim().replace(/^#/, '');
      if (number === '') throw U.fail(400, 'needs a number');
      let o = U.findOne(app, 'orders', 'shop = {:s} && number = {:n}', { s: shop.id, n: number });
      const isNew = o === null;
      const cur = (it.currency ? String(it.currency).toUpperCase() : '') || (o ? o.getString('currency') : '') || cur0;
      const before = o ? snap(o) : '';
      const status = it.status !== undefined && it.status !== '' ? U.oneOf(it.status, STATUSES, 'status') : isNew ? 'to_ship' : o.getString('status');
      if (isNew) {
        o = U.newRecord(app, 'orders');
        o.set('shop', shop.id);
        o.set('number', U.clip(number, 120));
        o.set('currency', cur);
        o.set('source', importId ? 'import' : ctx.isAgent ? 'agent' : 'import');
        o.set('import_id', importId || '');
        o.set('purged', false);
        o.set('fees_estimated', true);
        o.set('status', status);
      }
      const placed = it.placed_at ? U.isoDate(it.placed_at, 'placed_at') : isNew ? U.now() : o.getString('placed_at');
      o.set('placed_at', placed);
      if (it.buyer_name !== undefined) o.set('buyer_name', U.clip(it.buyer_name, 200));
      if (it.buyer_email !== undefined) o.set('buyer_email', U.clip(it.buyer_email, 200));
      if (it.buyer_phone !== undefined) o.set('buyer_phone', U.clip(it.buyer_phone, 60));
      if (it.address !== undefined && !o.getBool('purged')) o.set('address', addressOf(it.address));
      if (it.payment !== undefined && it.payment !== '') o.set('payment', U.oneOf(it.payment, PAYMENTS, 'payment'));
      else if (isNew) {
        o.set('payment', status === 'unpaid' ? 'pending' : 'paid');
        paymentDefaulted++;
      }
      if (it.ship_by) o.set('ship_by', U.isoDate(it.ship_by, 'ship_by'));
      else if (isNew) o.set('ship_by', U.addDays(placed, shop.getInt('ship_days') || 2));
      for (const k of ['shipping', 'discount', 'tax', 'refund', 'ship_cost']) if (it[k] !== undefined && it[k] !== '') o.set(k + '_minor', U.toMinor(it[k], cur, k));
      if (it.fees !== undefined && it.fees !== '') {
        o.set('fees_minor', U.toMinor(it.fees, cur, 'fees'));
        o.set('fees_estimated', false);
      }
      if (it.note !== undefined) o.set('note', U.clip(it.note, 2000));
      if (it.cancel_reason !== undefined) o.set('cancel_reason', U.clip(it.cancel_reason, 300));
      if (o.getString('customer') === '') {
        const c = L('lib_customers').match(app, { name: it.buyer_name, email: it.buyer_email, phone: it.buyer_phone, shop: shop.id });
        if (c !== null) o.set('customer', c.id);
      }
      app.save(o);
      const open = isNew || o.getString('status') === 'unpaid' || o.getString('status') === 'to_ship';
      const lines = U.list(it.lines, 'lines');
      if (lines.length > 0 && open) for (const x of writeLines(ctx, o, lines, cur)) out.unlinked.push(number + ': ' + x);
      if (isNew && RANK[status] >= RANK.shipped) {
        // Arrived already shipped: its items left before your stock count.
        shipLines(ctx, o, false);
        o.set('status', status);
        // Dates the data does not give stay empty (never made up from the order date).
        if (status === 'shipped' || status === 'delivered') o.set('shipped_at', it.shipped_at ? U.isoDate(it.shipped_at, 'shipped_at') : '');
        if (status === 'delivered') o.set('delivered_at', it.delivered_at ? U.isoDate(it.delivered_at, 'delivered_at') : '');
        if (status === 'cancelled') o.set('cancelled_at', it.cancelled_at ? U.isoDate(it.cancelled_at, 'cancelled_at') : '');
      } else if (!isNew && status !== o.getString('status')) {
        const prev = o.getString('status');
        const forward = status === 'cancelled' ? prev === 'unpaid' || prev === 'to_ship' : RANK[status] > RANK[prev];
        if (forward) setStatus(ctx, o, status, it[status + '_at'] ? U.isoDate(it[status + '_at'], status + '_at') : '');
        else if (prev !== 'cancelled') out.problems.push('Order ' + number + ': kept "' + prev + '" (the data said "' + status + '")');
      } else if (isNew) {
        o.set('status', status);
      }
      if (it.tracking || it.carrier) upsertShipment(app, o, { carrier: it.carrier, tracking: it.tracking ? String(it.tracking) : undefined, url: it.tracking_url, shipped_at: o.getString('shipped_at'), status: o.getString('status') === 'delivered' ? 'delivered' : undefined });
      // Totals: the given total wins; else items - discount + shipping + tax.
      recompute(app, o, shop);
      if (it.subtotal !== undefined && it.subtotal !== '' && linesOf(app, o.id).length === 0) o.set('subtotal_minor', U.toMinor(it.subtotal, cur, 'subtotal'));
      if (it.total !== undefined && it.total !== '') o.set('total_minor', U.toMinor(it.total, cur, 'total'));
      else if (isNew || lines.length > 0) o.set('total_minor', o.getInt('subtotal_minor') - o.getInt('discount_minor') + o.getInt('shipping_minor') + o.getInt('tax_minor'));
      if (o.getInt('refund_minor') > 0 && o.getString('payment') === 'paid') o.set('payment', o.getInt('refund_minor') >= o.getInt('total_minor') ? 'refunded' : 'partial_refund');
      app.save(o);
      recompute(app, o, shop);
      if (isNew) out.created++;
      else if (snap(o) !== before) out.updated++;
      else out.unchanged++;
    } catch (err) {
      out.skipped++;
      out.problems.push('Row ' + row + ': ' + String((err && err.message) || err));
    }
  });
  if (paymentDefaulted > 0) out.notes.push(paymentDefaulted + ' new order' + (paymentDefaulted === 1 ? '' : 's') + ' had no payment: set to paid (pending when unpaid).');
  L('lib_store').log(app, ctx.actor, 'Orders from ' + shop.getString('name') + ': ' + out.created + ' new, ' + out.updated + ' updated' + (out.skipped > 0 ? ', ' + out.skipped + ' skipped' : ''), 'shop:' + shop.id);
  return out;
}

function upsertOp(ctx, p) {
  return upsertMany(ctx, p, '');
}

function ship(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const o = ref(app, p.order, p.shop);
  const st = o.getString('status');
  if (st !== 'to_ship' && st !== 'unpaid' && st !== 'shipped') throw U.fail(409, 'Order ' + o.getString('number') + ' is ' + st + '; only orders to ship can be shipped.', 'conflict');
  const at = p.shipped_at ? U.isoDate(p.shipped_at, 'shipped_at') : U.now();
  setStatus(ctx, o, 'shipped', at);
  app.save(o);
  if (p.carrier || p.tracking || p.url) upsertShipment(app, o, { carrier: p.carrier || '', tracking: p.tracking || '', url: p.url || '', shipped_at: at, status: 'info_received' });
  recompute(app, o, null);
  L('lib_store').log(app, ctx.actor, 'Shipped order ' + o.getString('number') + (p.tracking ? ' (' + (p.carrier ? p.carrier + ' ' : '') + p.tracking + ')' : ''), 'order:' + o.id);
  return { order: detail(app, o, ctx.isAgent) };
}

function shipMany(ctx, p) {
  const U = L('lib_util');
  const items = U.list(p.items, 'items');
  if (items.length === 0) throw U.fail(400, 'Give --items \'[{"order":"1043","carrier":"J&T","tracking":"JT123"}]\'.', 'missing_param', { param: 'items' });
  const out = { shipped: 0, problems: [] };
  for (const it of items) {
    try {
      ship(ctx, { order: it.order, shop: it.shop, carrier: it.carrier, tracking: it.tracking, url: it.url, shipped_at: it.shipped_at });
      out.shipped++;
    } catch (err) {
      out.problems.push(String(it.order) + ': ' + String((err && err.message) || err));
    }
  }
  return out;
}

function deliver(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const o = ref(app, p.order, p.shop);
  if (o.getString('status') !== 'shipped' && o.getString('status') !== 'to_ship') throw U.fail(409, 'Order ' + o.getString('number') + ' is ' + o.getString('status') + '.', 'conflict');
  const at = p.delivered_at ? U.isoDate(p.delivered_at, 'delivered_at') : U.now();
  setStatus(ctx, o, 'delivered', at);
  app.save(o);
  for (const s of shipmentsOf(app, o.id)) {
    s.set('status', 'delivered');
    if (s.getString('delivered_at') === '') s.set('delivered_at', at);
    app.save(s);
  }
  L('lib_store').log(app, ctx.actor, 'Order ' + o.getString('number') + ' delivered', 'order:' + o.id);
  return { order: detail(app, o, ctx.isAgent) };
}

function cancel(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const o = ref(app, p.order, p.shop);
  const st = o.getString('status');
  if (st !== 'unpaid' && st !== 'to_ship') throw U.fail(409, 'Order ' + o.getString('number') + ' is ' + st + '. Only orders not shipped yet can be cancelled; record a return instead.', 'conflict');
  setStatus(ctx, o, 'cancelled', U.now());
  o.set('cancel_reason', U.clip(p.reason || '', 300));
  app.save(o);
  recompute(app, o, null);
  L('lib_store').log(app, ctx.actor, 'Cancelled order ' + o.getString('number') + (p.reason ? ': ' + p.reason : ''), 'order:' + o.id);
  return { order: detail(app, o, ctx.isAgent) };
}

function refund(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const o = ref(app, p.order, p.shop);
  const cur = o.getString('currency');
  const amount = U.toMinor(p.amount, cur, 'amount');
  if (amount <= 0) throw U.fail(400, 'amount must be more than 0.', 'invalid_param', { param: 'amount' });
  const room = o.getInt('total_minor') - o.getInt('refund_minor');
  if (amount > room) throw U.fail(400, 'At most ' + U.fmt(room, cur) + ' can still be refunded on this order.', 'invalid_param', { param: 'amount' });
  o.set('refund_minor', o.getInt('refund_minor') + amount);
  o.set('payment', o.getInt('refund_minor') >= o.getInt('total_minor') ? 'refunded' : 'partial_refund');
  app.save(o);
  recompute(app, o, null);
  L('lib_store').log(app, ctx.actor, 'Refund of ' + U.fmt(amount, cur) + ' on order ' + o.getString('number') + (p.reason ? ': ' + p.reason : ''), 'order:' + o.id);
  return { order: detail(app, o, ctx.isAgent) };
}

function returnItems(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const o = ref(app, p.order, p.shop);
  const st = o.getString('status');
  if (st !== 'shipped' && st !== 'delivered' && st !== 'returned') throw U.fail(409, 'Only shipped or delivered orders can have returns.', 'conflict');
  const lines = linesOf(app, o.id);
  let items = U.list(p.lines, 'lines');
  if (items.length === 0) items = lines.map((l) => ({ line: l.id, qty: l.getInt('qty') - l.getInt('qty_returned') }));
  let units = 0;
  for (const it of items) {
    const l = lines.filter((x) => x.id === it.line || (it.sku && x.getString('sku').toLowerCase() === String(it.sku).toLowerCase()))[0];
    if (!l) throw U.fail(400, 'No line ' + (it.line || it.sku) + ' on this order.', 'invalid_param', { param: 'lines' });
    const qty = U.int(it.qty, 'qty');
    if (qty <= 0) continue;
    if (l.getInt('qty_returned') + qty > l.getInt('qty')) throw U.fail(400, 'Only ' + (l.getInt('qty') - l.getInt('qty_returned')) + ' of ' + l.getString('title') + ' can still come back.', 'invalid_param');
    l.set('qty_returned', l.getInt('qty_returned') + qty);
    app.save(l);
    units += qty;
    if (p.restock === true && l.getString('variant') !== '') {
      const v = U.byId(app, 'variants', l.getString('variant'));
      if (v !== null) L('lib_stock').move(app, v, qty, 'return', 'order ' + o.getString('number'), '', ctx.actor);
    }
  }
  const all = linesOf(app, o.id).every((l) => l.getInt('qty_returned') >= l.getInt('qty'));
  if (all) o.set('status', 'returned');
  app.save(o);
  recompute(app, o, null);
  L('lib_store').log(app, ctx.actor, units + ' item' + (units === 1 ? '' : 's') + ' returned on order ' + o.getString('number') + (p.restock === true ? ', back in stock' : ''), 'order:' + o.id);
  return { order: detail(app, o, ctx.isAgent) };
}

function update(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const o = ref(app, p.order, p.shop);
  const cur = o.getString('currency');
  if (p.buyer_name !== undefined) o.set('buyer_name', U.clip(p.buyer_name, 200));
  if (p.buyer_email !== undefined) o.set('buyer_email', U.clip(p.buyer_email, 200));
  if (p.buyer_phone !== undefined) o.set('buyer_phone', U.clip(p.buyer_phone, 60));
  if (p.address !== undefined) o.set('address', addressOf(p.address));
  if (p.note !== undefined) o.set('note', U.clip(p.note, 2000));
  if (p.ship_by !== undefined) o.set('ship_by', p.ship_by === '' ? '' : U.isoDate(p.ship_by, 'ship_by'));
  if (p.payment !== undefined) o.set('payment', U.oneOf(p.payment, PAYMENTS, 'payment'));
  if (p.status !== undefined) {
    const next = U.oneOf(p.status, ['unpaid', 'to_ship'], 'status');
    if (o.getString('status') !== 'unpaid' && o.getString('status') !== 'to_ship') throw U.fail(409, 'Use orders.ship, orders.deliver, orders.cancel or orders.return to move an order on.', 'conflict');
    o.set('status', next);
  }
  if (p.fees !== undefined) {
    if (p.fees === '') o.set('fees_estimated', true);
    else {
      o.set('fees_minor', U.toMinor(p.fees, cur, 'fees'));
      o.set('fees_estimated', false);
    }
  }
  if (p.ship_cost !== undefined) o.set('ship_cost_minor', U.toMinor(p.ship_cost, cur, 'ship_cost'));
  // What the buyer pays: the total moves by the change (a platform's own total keeps
  // whatever else it holds), and a refund already made keeps its share.
  const charged = [];
  for (const k of ['shipping', 'discount', 'tax']) {
    if (p[k] === undefined) continue;
    const m = U.toMinor(p[k], cur, k);
    if (m < 0) throw U.fail(400, k + ' cannot be negative.', 'invalid_param', { param: k });
    if (o.getString('status') === 'cancelled') throw U.fail(409, 'Order ' + o.getString('number') + ' is cancelled: its charges no longer change.', 'conflict');
    const delta = m - o.getInt(k + '_minor');
    o.set(k + '_minor', m);
    o.set('total_minor', o.getInt('total_minor') + (k === 'discount' ? -delta : delta));
    charged.push(k + ' ' + U.fmt(m, cur));
  }
  if (charged.length > 0 && o.getInt('refund_minor') > 0) o.set('payment', o.getInt('refund_minor') >= o.getInt('total_minor') ? 'refunded' : 'partial_refund');
  app.save(o);
  recompute(app, o, null);
  const what = charged.length > 0 ? ': ' + charged.join(', ') + ', total ' + U.fmt(o.getInt('total_minor'), cur) : '';
  L('lib_store').log(app, ctx.actor, 'Edited order ' + o.getString('number') + what, 'order:' + o.id);
  return { order: detail(app, o, ctx.isAgent) };
}

/** Link an order line that matched no SKU to one of your SKUs. */
function linkLine(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const l = U.byId(app, 'order_lines', String(p.line || ''));
  if (l === null) throw U.fail(404, 'No order line ' + p.line + '.', 'not_found');
  const v = L('lib_stock').variantRef(app, p.variant, 'variant');
  const o = app.findRecordById('orders', l.getString('order_ref'));
  l.set('variant', v.id);
  l.set('kind', 'item');
  l.set('cost_minor', v.getInt('cost_minor'));
  app.save(l);
  // Every other open line with the same text SKU learns it too.
  if (p.all !== false && l.getString('sku') !== '') {
    for (const x of app.findRecordsByFilter('order_lines', "variant = '' && sku = {:s}", '', 0, 0, { s: l.getString('sku') })) {
      x.set('variant', v.id);
      x.set('cost_minor', v.getInt('cost_minor'));
      app.save(x);
      recompute(app, app.findRecordById('orders', x.getString('order_ref')), null);
    }
  }
  recompute(app, o, null);
  return { order: detail(app, o, ctx.isAgent) };
}

/**
 * A line that is not a product (a gift card, gift wrap, a service fee): it
 * moves no stock, has its own cost (0 when it costs nothing) and stops
 * counting as an unknown SKU. Remembered by its SKU, else its title, so the
 * same line in later orders is known too.
 */
function lineExtra(ctx, p) {
  const U = L('lib_util');
  const S = L('lib_store');
  const app = ctx.app;
  const l = U.byId(app, 'order_lines', String(p.line || ''));
  if (l === null) throw U.fail(404, 'No order line ' + p.line + '.', 'not_found');
  const base = S.base(app);
  const cost = U.toMinor(p.cost === undefined ? 0 : p.cost, base, 'cost');
  const key = extraKey(l.getString('sku'), l.getString('title'));
  const st = S.settings(app);
  const extras = U.json(st, 'extras', {});
  extras[key] = cost;
  st.set('extras', extras);
  app.save(st);
  const lines = p.all === false ? [l] : app.findRecordsByFilter('order_lines', "variant = ''", '', 0, 0).filter((x) => extraKey(x.getString('sku'), x.getString('title')) === key);
  const touched = {};
  for (const x of lines) {
    x.set('kind', 'extra');
    x.set('cost_minor', cost);
    app.save(x);
    touched[x.getString('order_ref')] = true;
  }
  for (const id of Object.keys(touched)) recompute(app, app.findRecordById('orders', id), null);
  const n = Object.keys(touched).length;
  S.log(app, ctx.actor, (l.getString('sku') || l.getString('title')) + ' is not a product (cost ' + U.fmt(cost, base) + '), on ' + n + ' order' + (n === 1 ? '' : 's'), 'order:' + l.getString('order_ref'));
  return { order: detail(app, app.findRecordById('orders', l.getString('order_ref')), ctx.isAgent), lines: lines.length };
}

function lookupOrder(ctx, p) {
  return 'order ' + ref(ctx.app, p.order, p.shop).getString('number');
}

function remove(ctx, p) {
  const app = ctx.app;
  const o = ref(app, p.order, p.shop);
  const n = o.getString('number');
  app.delete(o);
  L('lib_store').log(app, ctx.actor, 'Deleted order ' + n, '');
  return { removed: n };
}

function shipmentUpdate(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  let s = p.shipment ? U.byId(app, 'shipments', String(p.shipment)) : null;
  if (s === null) {
    const o = ref(app, p.order, p.shop);
    const ships = shipmentsOf(app, o.id);
    if (ships.length === 0) s = upsertShipment(app, o, { carrier: p.carrier || '', tracking: p.tracking || '' });
    else s = ships[ships.length - 1];
  }
  if (p.carrier !== undefined) s.set('carrier', U.clip(p.carrier, 80));
  if (p.tracking !== undefined) s.set('tracking', U.clip(p.tracking, 120));
  if (p.url !== undefined) s.set('url', U.clip(p.url, 500));
  if (p.eta !== undefined) s.set('eta', p.eta === '' ? '' : U.isoDate(p.eta, 'eta'));
  const at = p.event_at ? U.isoDate(p.event_at, 'event_at') : U.now();
  if (p.status !== undefined) s.set('status', U.oneOf(p.status, TRACK, 'status'));
  if (p.event !== undefined && p.event !== '') {
    const evs = U.json(s, 'events', []);
    if (!evs.some((e) => e.at === at && e.text === p.event)) evs.push({ at: at, text: U.clip(p.event, 300), status: s.getString('status') });
    evs.sort((a, b) => (a.at < b.at ? -1 : 1));
    s.set('events', evs.slice(-100));
    s.set('last_event', U.clip(p.event, 500));
    s.set('last_event_at', at);
  }
  s.set('checked_at', U.now());
  app.save(s);
  const o = app.findRecordById('orders', s.getString('order_ref'));
  if (s.getString('status') === 'delivered' && o.getString('status') === 'shipped') {
    setStatus(ctx, o, 'delivered', at);
    app.save(o);
  }
  L('lib_tasks').finishFor(app, 'order:' + o.id, 'tracking', 'Tracking: ' + s.getString('status'));
  return { order: detail(app, o, ctx.isAgent) };
}

/* ------------------------------------------------- work for your AI agent */

function requestHelp(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const o = ref(app, p.order, p.shop);
  const kind = U.oneOf(p.task, ['tracking', 'exception'], 'task');
  const label = kind === 'tracking' ? 'Check the tracking of order ' + o.getString('number') : 'Sort out the delivery problem on order ' + o.getString('number');
  const t = L('lib_tasks').queue(app, kind, 'order:' + o.id, label, { order: o.id, note: U.clip(p.note || '', 1000) }, ctx.actor);
  return { task: t };
}

function requestTrackAll(ctx) {
  const U = L('lib_util');
  const app = ctx.app;
  const ids = app.findRecordsByFilter('orders', "status = 'shipped'", '-shipped_at', 200, 0).map((o) => o.id);
  if (ids.length === 0) throw U.fail(400, 'No shipped orders are on their way.', 'nothing');
  const t = L('lib_tasks').queue(app, 'tracking', 'store:tracking', 'Check the tracking of ' + ids.length + ' parcel' + (ids.length === 1 ? '' : 's') + ' on their way', { orders: ids }, ctx.actor);
  return { task: t };
}

module.exports = {
  STATUSES: STATUSES,
  TRACK: TRACK,
  VIEWS: VIEWS,
  ref: ref,
  linesOf: linesOf,
  shipmentsOf: shipmentsOf,
  health: health,
  recompute: recompute,
  refeeShop: refeeShop,
  recostVariant: recostVariant,
  money: money,
  rowView: rowView,
  detail: detail,
  list: list,
  get: get,
  add: add,
  upsertMany: upsertMany,
  upsertOp: upsertOp,
  ship: ship,
  shipMany: shipMany,
  deliver: deliver,
  cancel: cancel,
  refund: refund,
  returnItems: returnItems,
  update: update,
  linkLine: linkLine,
  lineExtra: lineExtra,
  extraKey: extraKey,
  lookupOrder: lookupOrder,
  remove: remove,
  shipmentUpdate: shipmentUpdate,
  requestHelp: requestHelp,
  requestTrackAll: requestTrackAll,
};
