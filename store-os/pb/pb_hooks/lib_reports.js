/// <reference path="../pb_data/types.d.ts" />
/**
 * The dashboard: what needs you, and how money moves, across every shop in
 * the base currency.
 *
 *   net sales  items - discounts + shipping charged - refunds (tax excluded)
 *   profit     net sales - platform fees - your shipping cost - cost of goods
 *
 * Paid orders count on the day they were placed (unpaid and cancelled ones
 * do not). Other currencies are converted at today's rates; an order whose
 * currency has no rate is left out of totals and counted in `unconverted`.
 * Fees are estimated from each shop's fee rates until real fees arrive; the
 * share of estimated fees is reported so the number is never mistaken for a
 * settled payout.
 */

const RANGES = { '7d': 7, '30d': 30, '90d': 90, '12m': 365, mtd: 31 };

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

/**
 * Period bounds and bucket keys in the seller's time zone (settings
 * utc_offset, minutes east of UTC, kept by the app from the seller's own
 * clock). 12m buckets by month, the rest by day. Bounds are UTC instants of
 * the seller's midnights; keys are the seller's dates.
 */
function period(range, offsetMin) {
  const off = (offsetMin || 0) * 60000;
  const local = new Date(Date.now() + off);
  const today = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const endL = today + 86400000;
  const monthly = range === '12m';
  // mtd: the 1st of this month to today; like every range, compared with as many days just before.
  const days = range === 'mtd' ? local.getUTCDate() : RANGES[range] || 30;
  const startL = monthly ? Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - 11, 1) : endL - days * 86400000;
  const s = new Date(startL);
  const prevL = monthly ? Date.UTC(s.getUTCFullYear() - 1, s.getUTCMonth(), 1) : startL - days * 86400000;
  const keys = [];
  if (monthly) for (let i = 0; i < 12; i++) keys.push(new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + i, 1)).toISOString().slice(0, 7));
  else for (let t = startL; t < endL; t += 86400000) keys.push(new Date(t).toISOString().slice(0, 10));
  return { start: new Date(startL - off).toISOString(), end: new Date(endL - off).toISOString(), prevStart: new Date(prevL - off).toISOString(), monthly: monthly, keys: keys, days: days, off: off, from_day: new Date(startL).toISOString().slice(0, 10), to_day: new Date(endL - 86400000).toISOString().slice(0, 10) };
}

/** The seller's date (or month) of a UTC instant. */
function bucketOf(iso, per) {
  const d = new Date(new Date(iso).getTime() + per.off).toISOString();
  return per.monthly ? d.slice(0, 7) : d.slice(0, 10);
}

function offsetOf(app) {
  return L('lib_store').settings(app).getInt('utc_offset');
}

/** The previous period's bucket that lines up with `key`. */
function prevKey(key, per) {
  if (per.monthly) {
    const y = Number(key.slice(0, 4));
    return y - 1 + key.slice(4);
  }
  return new Date(new Date(key + 'T00:00:00Z').getTime() - per.days * 86400000).toISOString().slice(0, 10);
}

/** One order's numbers in base minor units (null when its currency has no rate). */
function figures(app, o, table) {
  const S = L('lib_store');
  const cur = o.getString('currency');
  const net = o.getInt('subtotal_minor') - o.getInt('discount_minor') + o.getInt('shipping_minor') - o.getInt('refund_minor');
  const after = net - o.getInt('fees_minor') - o.getInt('ship_cost_minor');
  const netBase = S.toBase(app, net, cur, table);
  const afterBase = S.toBase(app, after, cur, table);
  if (netBase === null || afterBase === null) return null;
  return {
    net: netBase,
    profit: afterBase - o.getInt('cogs_minor'),
    refund: S.toBase(app, o.getInt('refund_minor'), cur, table) || 0,
    gross: S.toBase(app, o.getInt('subtotal_minor'), cur, table) || 0,
    discount: S.toBase(app, o.getInt('discount_minor'), cur, table) || 0,
    shipping: S.toBase(app, o.getInt('shipping_minor'), cur, table) || 0,
    fees: S.toBase(app, o.getInt('fees_minor'), cur, table) || 0,
    ship_cost: S.toBase(app, o.getInt('ship_cost_minor'), cur, table) || 0,
    cogs: o.getInt('cogs_minor'),
  };
}

function pct(now, before) {
  if (before === 0) return now === 0 ? 0 : null;
  return Math.round(((now - before) / Math.abs(before)) * 1000) / 10;
}

function soldOrders(app, from, to, shopId) {
  return app.findRecordsByFilter('orders', "placed_at >= {:a} && placed_at < {:b} && status != 'cancelled' && status != 'unpaid'" + (shopId ? ' && shop = {:s}' : ''), 'placed_at', 0, 0, { a: from, b: to, s: shopId || '' });
}

/* ------------------------------------------------------------------- ops */

function overview(ctx, p) {
  const U = L('lib_util');
  const S = L('lib_store');
  const app = ctx.app;
  const range = RANGES[p.range] ? p.range : '30d';
  const per = period(range, offsetOf(app));
  const shopId = p.shop ? L('lib_shops').ref(app, p.shop).id : '';
  const base = S.baseOrEmpty(app);
  const table = S.fxTable(app);
  const M = (minor) => U.toMajor(minor, base);
  const quality = { orders_missing_cost: 0, orders_without_ship_cost: 0 };

  const shops = app.findRecordsByFilter('shops', '1=1', 'sort,created', 0, 0);
  const series = {};
  for (const k of per.keys) series[k] = { key: k, net: 0, profit: 0, orders: 0, prev_net: 0, by_shop: {} };
  const prevBuckets = {};
  const cur = { net: 0, profit: 0, orders: 0, refunds: 0, units: 0, fees_est: 0, fees: 0 };
  const prev = { net: 0, profit: 0, orders: 0, refunds: 0 };
  const perShop = {};
  for (const s of shops) perShop[s.id] = { net: 0, profit: 0, orders: 0, prev_net: 0, spark: {} };
  let unconverted = 0;
  const productUnits = {};
  const productOf = {};

  const orders = soldOrders(app, per.prevStart, per.end, shopId);
  const inPeriod = [];
  for (const o of orders) {
    const f = figures(app, o, table);
    if (f === null) {
      unconverted++;
      continue;
    }
    const at = o.getString('placed_at');
    const sid = o.getString('shop');
    if (at >= per.start) {
      cur.net += f.net;
      cur.profit += f.profit;
      cur.orders++;
      cur.refunds += f.refund;
      cur.fees += f.fees;
      if (o.getBool('fees_estimated')) cur.fees_est += f.fees;
      if (o.getBool('cost_missing')) quality.orders_missing_cost++;
      if (o.getInt('ship_cost_minor') === 0) quality.orders_without_ship_cost++;
      const b = series[bucketOf(at, per)];
      if (b) {
        b.net += f.net;
        b.profit += f.profit;
        b.orders++;
        b.by_shop[sid] = (b.by_shop[sid] || 0) + f.net;
      }
      if (perShop[sid]) {
        perShop[sid].net += f.net;
        perShop[sid].profit += f.profit;
        perShop[sid].orders++;
        const k = bucketOf(at, per);
        perShop[sid].spark[k] = (perShop[sid].spark[k] || 0) + f.net;
      }
      inPeriod.push(o);
    } else {
      prev.net += f.net;
      prev.profit += f.profit;
      prev.orders++;
      prev.refunds += f.refund;
      const k = bucketOf(at, per);
      prevBuckets[k] = (prevBuckets[k] || 0) + f.net;
      if (perShop[sid]) perShop[sid].prev_net += f.net;
    }
  }
  for (const k of per.keys) series[k].prev_net = prevBuckets[prevKey(k, per)] || 0;

  // Best sellers: units per product in the period.
  if (inPeriod.length > 0) {
    const ids = {};
    for (const o of inPeriod) ids[o.id] = o;
    for (const r of U.rows(app, "SELECT l.order_ref AS ord, l.variant AS variant, l.title AS title, l.qty AS qty, l.price_minor AS price FROM order_lines l JOIN orders o ON o.id = l.order_ref WHERE o.placed_at >= {:a} AND o.placed_at < {:b} AND o.status NOT IN ('cancelled', 'unpaid')", { a: per.start, b: per.end }, { ord: '', variant: '', title: '', qty: 0, price: 0 })) {
      const o = ids[r.ord];
      if (!o) continue;
      cur.units += r.qty;
      let pid = '';
      if (r.variant) {
        if (productOf[r.variant] === undefined) {
          const v = U.byId(app, 'variants', r.variant);
          productOf[r.variant] = v ? v.getString('product') : '';
        }
        pid = productOf[r.variant];
      }
      const key = pid || 'title:' + r.title;
      if (!productUnits[key]) productUnits[key] = { product: pid, title: r.title, units: 0, net: 0 };
      productUnits[key].units += r.qty;
      const nb = S.toBase(app, r.qty * r.price, o.getString('currency'), table);
      if (nb !== null) productUnits[key].net += nb;
    }
  }
  const top = Object.keys(productUnits)
    .map((k) => productUnits[k])
    .sort((a, b) => b.units - a.units || b.net - a.net)
    .slice(0, 8)
    .map((t) => {
      const prod = t.product ? U.byId(app, 'products', t.product) : null;
      return { product: t.product, title: prod ? prod.getString('title') : t.title, image: prod ? L('lib_stock').firstImage(prod) : '', units: t.units, net: M(t.net) };
    });

  const kpi = (now, before) => ({ value: M(now), previous: M(before), delta_pct: pct(now, before) });
  const margin = cur.net > 0 ? Math.round((cur.profit / cur.net) * 1000) / 10 : null;
  const prevMargin = prev.net > 0 ? Math.round((prev.profit / prev.net) * 1000) / 10 : null;

  return {
    range: range,
    currency: base,
    monthly: per.monthly,
    from: per.start,
    to: per.end,
    kpis: {
      net_sales: kpi(cur.net, prev.net),
      profit: kpi(cur.profit, prev.profit),
      orders: { value: cur.orders, previous: prev.orders, delta_pct: pct(cur.orders, prev.orders) },
      aov: kpi(cur.orders > 0 ? Math.round(cur.net / cur.orders) : 0, prev.orders > 0 ? Math.round(prev.net / prev.orders) : 0),
      margin: { value: margin, previous: prevMargin, delta_pct: margin !== null && prevMargin !== null ? Math.round((margin - prevMargin) * 10) / 10 : null },
      refunds: kpi(cur.refunds, prev.refunds),
      units: { value: cur.units },
    },
    fees_estimated_share: cur.fees > 0 ? Math.round((cur.fees_est / cur.fees) * 100) : 0,
    quality: quality,
    from_day: per.from_day,
    to_day: per.to_day,
    series: per.keys.map((k) => ({ key: k, net: M(series[k].net), profit: M(series[k].profit), orders: series[k].orders, prev_net: M(series[k].prev_net), by_shop: Object.keys(series[k].by_shop).reduce((o, s) => Object.assign(o, { [s]: M(series[k].by_shop[s]) }), {}) })),
    shops: shops
      .filter((s) => !shopId || s.id === shopId)
      .map((s) => {
        const x = perShop[s.id];
        return { id: s.id, name: s.getString('name'), platform: s.getString('platform'), net: M(x.net), profit: M(x.profit), orders: x.orders, margin: x.net > 0 ? Math.round((x.profit / x.net) * 1000) / 10 : null, delta_pct: pct(x.net, x.prev_net), spark: per.keys.map((k) => M(x.spark[k] || 0)) };
      }),
    top_products: top,
    unconverted: unconverted,
  };
}

/** What needs you now, in counts that each open a filtered list. */
function attention(ctx) {
  const U = L('lib_util');
  const app = ctx.app;
  const now = new Date().toISOString();
  const soon = new Date(Date.now() + 86400000).toISOString();
  const toShip = U.count(app, "SELECT COUNT(*) AS n FROM orders WHERE status = 'to_ship'", {});
  const late = U.count(app, "SELECT COUNT(*) AS n FROM orders WHERE status IN ('to_ship', 'unpaid') AND ship_by != '' AND ship_by < {:now}", { now: now });
  const dueSoon = U.count(app, "SELECT COUNT(*) AS n FROM orders WHERE status IN ('to_ship', 'unpaid') AND ship_by >= {:now} AND ship_by < {:soon}", { now: now, soon: soon });
  const unpaid = U.count(app, "SELECT COUNT(*) AS n FROM orders WHERE status = 'unpaid'", {});
  let exceptions = 0;
  const shipped = app.findRecordsByFilter('orders', "status = 'shipped'", '', 0, 0);
  if (shipped.length > 0) {
    const ships = {};
    for (const s of app.findRecordsByFilter('shipments', '1=1', 'created', 0, 0)) {
      const k = s.getString('order_ref');
      if (!ships[k]) ships[k] = [];
      ships[k].push(s);
    }
    for (const o of shipped) {
      const h = L('lib_orders').health(o, ships[o.id] || []);
      if (h === 'exception' || h === 'stalled') exceptions++;
    }
  }
  const open = U.count(app, "SELECT COUNT(*) AS n FROM threads WHERE status = 'open'", {});
  const overdue = U.count(app, "SELECT COUNT(*) AS n FROM threads WHERE status = 'open' AND due_at != '' AND due_at < {:now}", { now: now });
  const drafted = U.count(app, "SELECT COUNT(*) AS n FROM threads WHERE status = 'open' AND draft != ''", {});
  const approvals = U.count(app, "SELECT COUNT(*) AS n FROM proposals WHERE status = 'pending'", {});
  const products = L('lib_products').list(ctx, { limit: 1 });
  const unlinked = U.count(app, "SELECT COUNT(*) AS n FROM order_lines l JOIN orders o ON o.id = l.order_ref WHERE l.variant = '' AND o.status IN ('unpaid', 'to_ship')", {});
  const missingCost = U.count(app, "SELECT COUNT(*) AS n FROM orders WHERE cost_missing = 1 AND status NOT IN ('cancelled', 'unpaid') AND placed_at >= {:a}", { a: U.addDays('', -30) });
  const toPush = L('lib_stock').plan(app, '').length;
  const tasksOpen = U.count(app, "SELECT COUNT(*) AS n FROM tasks WHERE state IN ('queued', 'asked', 'working')", {});
  // The late orders by number, oldest ship-by first, so a summary can name them.
  const lateOrders = U.rows(app, "SELECT o.number AS number, s.name AS shop FROM orders o JOIN shops s ON s.id = o.shop WHERE o.status IN ('to_ship', 'unpaid') AND o.ship_by != '' AND o.ship_by < {:now} ORDER BY o.ship_by LIMIT 5", { now: now }, { number: '', shop: '' });
  return {
    to_ship: toShip,
    late: late,
    late_orders: lateOrders.map((r) => r.number + ' (' + r.shop + ')'),
    due_soon: dueSoon,
    unpaid: unpaid,
    exceptions: exceptions,
    messages_open: open,
    messages_overdue: overdue,
    drafts_ready: drafted,
    approvals: approvals,
    listing_issues: products.counts.issues,
    low_stock: products.counts.low,
    out_of_stock: products.counts.out,
    missing_cost_products: products.counts.missing_cost,
    missing_cost_orders: missingCost,
    unlinked_lines: unlinked,
    stock_to_push: toPush,
    tasks_open: tasksOpen,
  };
}

/** The whole Home page in one call. */
function home(ctx, p) {
  const U = L('lib_util');
  const S = L('lib_store');
  const app = ctx.app;
  const settings = S.settingsView(S.settings(app));
  // Your AI agent gets each shop in brief (its full record, policies included, is shops.get).
  const shops = L('lib_shops')
    .list(ctx)
    .shops.map((s) => (ctx.isAgent ? { id: s.id, name: s.name, platform: s.platform, status: s.status, connection: s.connection, sync_at: s.sync_at, to_ship: s.to_ship, late: s.late, open_threads: s.open_threads, live_listings: s.live_listings } : s));
  const recent = app.findRecordsByFilter('orders', '1=1', '-placed_at', 7, 0).map((o) => L('lib_orders').rowView(app, o, null, null, null));
  return {
    settings: settings,
    shops: shops,
    attention: attention(ctx),
    report: settings.base_currency !== '' ? overview(ctx, p) : null,
    recent_orders: recent,
    activity: app.findRecordsByFilter('activity', '1=1', '-created', 12, 0).map((a) => ({ id: a.id, actor: a.getString('actor'), text: a.getString('text'), target: a.getString('target'), created: a.getString('created') })),
    counts: { products: U.count(app, 'SELECT COUNT(*) AS n FROM products', {}), orders: U.count(app, 'SELECT COUNT(*) AS n FROM orders', {}) },
  };
}

function profit(ctx, p) {
  const U = L('lib_util');
  const S = L('lib_store');
  const app = ctx.app;
  const range = RANGES[p.range] ? p.range : '30d';
  const per = period(range, offsetOf(app));
  const shopId = p.shop ? L('lib_shops').ref(app, p.shop).id : '';
  const base = S.baseOrEmpty(app);
  const table = S.fxTable(app);
  const M = (minor) => U.toMajor(minor, base);
  const blank = () => ({ gross: 0, discount: 0, shipping: 0, refunds: 0, net: 0, fees: 0, fees_est: 0, ship_cost: 0, no_ship_cost: 0, cogs: 0, profit: 0, orders: 0, cost_missing: 0 });
  const all = blank();
  const byShop = {};
  let unconverted = 0;
  for (const o of soldOrders(app, per.start, per.end, shopId)) {
    const f = figures(app, o, table);
    if (f === null) {
      unconverted++;
      continue;
    }
    const sid = o.getString('shop');
    if (!byShop[sid]) byShop[sid] = blank();
    for (const t of [all, byShop[sid]]) {
      t.gross += f.gross;
      t.discount += f.discount;
      t.shipping += f.shipping;
      t.refunds += f.refund;
      t.net += f.net;
      t.fees += f.fees;
      if (o.getBool('fees_estimated')) t.fees_est += f.fees;
      t.ship_cost += f.ship_cost;
      if (o.getInt('ship_cost_minor') === 0) t.no_ship_cost++;
      t.cogs += f.cogs;
      t.profit += f.profit;
      t.orders++;
      if (o.getBool('cost_missing')) t.cost_missing++;
    }
  }
  const out = (t) => ({
    items: M(t.gross),
    discount: M(t.discount),
    shipping_charged: M(t.shipping),
    refunds: M(t.refunds),
    net_sales: M(t.net),
    fees: M(t.fees),
    ship_cost: M(t.ship_cost),
    cogs: M(t.cogs),
    profit: M(t.profit),
    margin: t.net > 0 ? Math.round((t.profit / t.net) * 1000) / 10 : null,
    orders: t.orders,
    estimates: { fees_estimated_pct: t.fees > 0 ? Math.round((t.fees_est / t.fees) * 100) : 0, orders_missing_cost: t.cost_missing, orders_without_ship_cost: t.no_ship_cost },
  });
  return {
    range: range,
    currency: base,
    from_day: per.from_day,
    to_day: per.to_day,
    total: out(all),
    shops: Object.keys(byShop).map((id) => {
      const s = U.byId(app, 'shops', id);
      return Object.assign({ id: id, name: s ? s.getString('name') : '', platform: s ? s.getString('platform') : '' }, out(byShop[id]));
    }),
    unconverted: unconverted,
  };
}

module.exports = { RANGES: RANGES, overview: overview, attention: attention, home: home, profit: profit };
