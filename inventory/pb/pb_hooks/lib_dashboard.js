/// <reference path="../pb_data/types.d.ts" />
/**
 * The Home overview in one call: stock health, value, the last 30 days of
 * movement, what needs attention, what is coming, where stock is kept, and
 * how far the first-time setup has got.
 */

function summary(app) {
  const u = require(`${__hooks}/lib_util.js`);
  const core = require(`${__hooks}/lib_core.js`);
  const items = require(`${__hooks}/lib_items.js`);
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const orders = require(`${__hooks}/lib_orders.js`);
  const locs = require(`${__hooks}/lib_locations.js`);
  const cur = core.currency(app);
  const ctx = items.context(app);
  const recs = app.findRecordsByFilter('items', 'archived = false', 'name', 0, 0);
  const briefs = recs.map((r) => items.brief(app, r, ctx, cur));

  const status = { ok: 0, low: 0, out: 0, over: 0 };
  let units = 0;
  let value = 0;
  let reorder = 0;
  for (const b of briefs) {
    status[b.status] += 1;
    units = u.q3(units + Math.max(0, b.on_hand));
    value += b.value;
    if (b.reorder_qty > 0) reorder += 1;
  }

  // Needs attention: out first, then low, soonest to run out first.
  const rank = { out: 0, low: 1 };
  const attention = briefs
    .filter((b) => b.status === 'out' || b.status === 'low')
    .sort((a, b) => rank[a.status] - rank[b.status] || (a.days_left === null ? 1e9 : a.days_left) - (b.days_left === null ? 1e9 : b.days_left) || (a.name < b.name ? -1 : 1))
    .slice(0, 8);

  // Movement per local day over the last 30 days (moves between places excluded).
  const t = u.today();
  const startDay = u.addDays(t, -29);
  const offsetMin = -new Date().getTimezoneOffset();
  const perDay = {};
  for (const r of u.rows(
    app,
    "SELECT date(created, {:off}) AS d, IFNULL(SUM(CASE WHEN qty > 0 THEN qty ELSE 0 END), 0) AS inq, IFNULL(SUM(CASE WHEN qty < 0 THEN -qty ELSE 0 END), 0) AS outq, " +
      'IFNULL(SUM(CASE WHEN qty > 0 THEN qty * unit_cost ELSE 0 END), 0) AS inv, IFNULL(SUM(CASE WHEN qty < 0 THEN -qty * unit_cost ELSE 0 END), 0) AS outv, COUNT(id) AS n ' +
      "FROM movements WHERE kind != 'move' AND reverses = '' AND batch NOT IN (SELECT reverses FROM movements WHERE reverses != '') AND created >= {:since} GROUP BY d",
    { d: '', inq: -0, outq: -0, inv: -0, outv: -0, n: 0 },
    { off: (offsetMin >= 0 ? '+' : '') + offsetMin + ' minutes', since: u.dayStartTs(startDay) },
  )) {
    perDay[r.d] = r;
  }
  const days = [];
  let inTotal = 0;
  let outTotal = 0;
  for (let i = 0; i < 30; i++) {
    const d = u.addDays(startDay, i);
    const r = perDay[d];
    const inq = r ? u.q3(r.inq) : 0;
    const outq = r ? u.q3(r.outq) : 0;
    inTotal = u.q3(inTotal + inq);
    outTotal = u.q3(outTotal + outq);
    days.push({ day: d, in: inq, out: outq, in_value: r ? Math.round(r.inv) : 0, out_value: r ? Math.round(r.outv) : 0, entries: r ? r.n : 0 });
  }

  // Most used over the last 30 days.
  const movers = briefs
    .filter((b) => b.usage_30d > 0)
    .sort((a, b) => b.usage_30d - a.usage_30d)
    .slice(0, 6)
    .map((b) => ({ id: b.id, name: b.name, sku: b.sku, unit: b.unit, photo: b.photo, icon: b.icon, used: b.usage_30d, on_hand: b.on_hand, status: b.status, days_left: b.days_left }));

  // Not touched in 90 days but still on the shelf.
  const quietSince = u.dayStartTs(u.addDays(t, -90));
  const touched = {};
  for (const r of u.rows(app, 'SELECT DISTINCT item FROM movements WHERE created >= {:s}', { item: '' }, { s: quietSince })) touched[r.item] = true;
  const idle = briefs.filter((b) => b.on_hand > 0 && touched[b.id] !== true);
  const idleValue = idle.reduce((s, b) => s + b.value, 0);

  const recentRows = app.findRecordsByFilter('movements', '', '-created,-id', 8, 0);
  const lctx = ledger.context(app, recentRows);

  const openOrders = app.findRecordsByFilter('orders', "status = 'ordered' || status = 'partial'", 'expected_on,created', 5, 0);
  const octx = { currency: cur, locs: locs.index(app), cats: items.categoryMap(app) };

  const tree = locs.tree(app).tree;
  const counting = u.rows(app, "SELECT COUNT(id) AS n FROM counts WHERE status = 'counting'", { n: 0 });
  const docs = { waiting: 0, reading: 0, failed: 0 };
  for (const r of u.rows(app, "SELECT status, COUNT(id) AS n FROM documents WHERE status != 'done' GROUP BY status", { status: '', n: 0 })) docs[r.status] = r.n;
  const s = core.settings(app);
  const codesCount = u.rows(app, 'SELECT COUNT(id) AS n FROM codes', { n: 0 });

  return {
    currency: cur,
    currency_confirmed: s.getBool('currency_confirmed'),
    totals: {
      items: briefs.length,
      units: units,
      value: value,
      value_text: core.moneyText(value, cur),
      locations: locs.index(app).list.length,
      suppliers: Object.keys(ctx.suppliers).length,
    },
    status: status,
    reorder: reorder,
    attention: attention,
    days: days,
    in_30d: inTotal,
    out_30d: outTotal,
    movers: movers,
    idle: { items: idle.length, value: idleValue, value_text: core.moneyText(idleValue, cur) },
    recent: recentRows.map((m) => ledger.serialize(m, lctx)),
    incoming: { counts: orders.counts(app), orders: openOrders.map((o) => orders.serialize(app, o, octx)) },
    places: tree.map((n) => ({ id: n.id, name: n.name, kind: n.kind, units: n.total.units, items: n.total.items, value: n.total.value, value_text: core.moneyText(n.total.value, cur) })),
    counting: counting.length > 0 ? counting[0].n : 0,
    documents: docs,
    setup: {
      locations: locs.index(app).list.length > 1,
      items: briefs.length > 0,
      stock: units > 0,
      reorder_points: briefs.some((b) => b.min_qty > 0),
      suppliers: Object.keys(ctx.suppliers).length > 0,
      barcodes: (codesCount.length > 0 ? codesCount[0].n : 0) > 0,
    },
  };
}

module.exports = { summary: summary };
