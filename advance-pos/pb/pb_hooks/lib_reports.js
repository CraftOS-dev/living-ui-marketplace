/// <reference path="../pb_data/types.d.ts" />
/**
 * Reports over paid sales. Amounts "as priced" follow the store's pricing
 * (with tax when prices include it); net_ex_tax never includes tax.
 *
 *   gross_sales  what sold items were priced at, before discounts
 *   returns      what returned items refunded
 *   discounts    every discount on sold items
 *   net_sales    gross_sales - returns - discounts
 *   net_ex_tax   net_sales without tax (what the business earned)
 *   tax          tax collected (returns subtract)
 *   cost, profit cost of goods sold (returns put back on the shelf are
 *                credited) and net_ex_tax - cost
 *   tips, rounding, gift_cards (sold gift cards: a balance owed, not sales)
 *   collected    payments taken, by tender (refunds subtract)
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function auth() {
  return require(`${__hooks}/lib_auth.js`);
}

function moneyOf(db) {
  return require(`${__hooks}/lib_money.js`).of(auth().settingsRow(db));
}

/** The SQL condition over orders `o` for a report's filters, and its bindings. */
function scope(p, r) {
  const util = u();
  const where = ["o.status = 'paid'", 'o.paid_at >= {:a}', 'o.paid_at < {:b}'];
  const bind = { a: util.dbDate(r.start), b: util.dbDate(r.end) };
  const reg = util.str(p, 'register', '');
  if (reg !== '') {
    where.push('o.register = {:reg}');
    bind.reg = reg;
  }
  const staff = util.str(p, 'staff', '');
  if (staff !== '') {
    where.push('o.closed_by = {:staff}');
    bind.staff = staff;
  }
  return { where: where.join(' AND '), bind: bind };
}

/** The headline numbers for sales matching `where` (SQL over orders o). */
function aggregate(db, where, bind) {
  const util = u();
  const L = util.rows(
    db,
    'SELECT ' +
      "COALESCE(SUM(CASE WHEN l.qty > 0 AND l.kind != 'gift_card' THEN l.gross ELSE 0 END), 0) AS gross, " +
      'COALESCE(SUM(CASE WHEN l.qty < 0 THEN -l.gross ELSE 0 END), 0) AS returns, ' +
      "COALESCE(SUM(CASE WHEN l.qty > 0 AND l.kind != 'gift_card' THEN l.discount ELSE 0 END), 0) AS discounts, " +
      "COALESCE(SUM(CASE WHEN l.kind != 'gift_card' THEN l.tax ELSE 0 END), 0) AS tax, " +
      "COALESCE(SUM(CASE WHEN l.kind != 'gift_card' THEN l.net ELSE 0 END), 0) AS net_ex_tax, " +
      "COALESCE(SUM(CASE WHEN l.kind = 'gift_card' THEN l.total ELSE 0 END), 0) AS gift_cards, " +
      "COALESCE(SUM(CASE WHEN l.kind = 'item' AND (l.qty > 0 OR l.restock = TRUE) THEN l.unit_cost * l.qty ELSE 0 END), 0) AS cost, " +
      "COALESCE(SUM(CASE WHEN l.qty > 0 AND l.kind != 'gift_card' THEN l.qty ELSE 0 END), 0) AS items_sold, " +
      'COALESCE(SUM(CASE WHEN l.qty < 0 THEN -l.qty ELSE 0 END), 0) AS items_returned ' +
      'FROM order_lines l JOIN orders o ON o.id = l."order" WHERE ' +
      where,
    { gross: 0, returns: 0, discounts: 0, tax: 0, net_ex_tax: 0, gift_cards: 0, cost: -0, items_sold: -0, items_returned: -0 },
    bind,
  )[0];
  const O = util.rows(
    db,
    'SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN o.total >= 0 THEN 1 ELSE 0 END), 0) AS sales, COALESCE(SUM(CASE WHEN o.has_returns = TRUE THEN 1 ELSE 0 END), 0) AS with_returns, ' +
      'COALESCE(SUM(o.tip), 0) AS tips, COALESCE(SUM(o.rounding), 0) AS rounding, COALESCE(SUM(o.total + o.tip + o.rounding), 0) AS due FROM orders o WHERE ' +
      where,
    { n: 0, sales: 0, with_returns: 0, tips: 0, rounding: 0, due: 0 },
    bind,
  )[0];
  const tenders = util.rows(
    db,
    'SELECT p.tender AS tender, p.label AS label, COUNT(*) AS n, COALESCE(SUM(p.amount), 0) AS amount FROM payments p JOIN orders o ON o.id = p."order" WHERE p.status = \'captured\' AND ' + where + ' GROUP BY p.tender, p.label ORDER BY amount DESC',
    { tender: '', label: '', n: 0, amount: 0 },
    bind,
  );
  const net = L.gross - L.returns - L.discounts;
  const cost = Math.round(L.cost);
  return {
    orders: O.n,
    sales: O.sales,
    with_returns: O.with_returns,
    gross_sales: L.gross,
    returns: L.returns,
    discounts: L.discounts,
    net_sales: net,
    net_ex_tax: L.net_ex_tax,
    tax: L.tax,
    tips: O.tips,
    rounding: O.rounding,
    gift_cards: L.gift_cards,
    cost: cost,
    profit: L.net_ex_tax - cost,
    margin: L.net_ex_tax > 0 ? Math.round(((L.net_ex_tax - cost) * 1000) / L.net_ex_tax) / 10 : null,
    average_sale: O.sales > 0 ? Math.round(net / O.sales) : 0,
    items_sold: Math.round(L.items_sold * 1000) / 1000,
    items_returned: Math.round(L.items_returned * 1000) / 1000,
    collected: tenders.reduce((a, t) => a + t.amount, 0),
    tenders: tenders.map((t) => ({ tender: t.tender, label: t.label || tenderLabel(t.tender), count: t.n, amount: t.amount })),
  };
}

function tenderLabel(t) {
  return { cash: 'Cash', card: 'Card', gift_card: 'Gift card', store_credit: 'Store credit', points: 'Points', other: 'Other' }[t] || t;
}

/** Money fields of a summary with their readings, for the agent. */
function withText(sum, money) {
  const out = Object.assign({}, sum);
  for (const k of ['gross_sales', 'returns', 'discounts', 'net_sales', 'net_ex_tax', 'tax', 'tips', 'rounding', 'gift_cards', 'cost', 'profit', 'average_sale', 'collected']) out[k + '_text'] = money.text(sum[k]);
  return out;
}

function needReports(app, e, p) {
  const c = auth().context(app, e, p);
  auth().need(app, c, 'view_reports', p, { what: 'Reports' });
  return c;
}

/** Headline numbers for a date range (and register or staff member), with the period before it. */
function summary(app, e, p) {
  const util = u();
  needReports(app, e, p);
  const money = moneyOf(app);
  const r = util.range(p, 1);
  const sc = scope(p, r);
  const days = Math.round((r.end - r.start) / 86400000);
  const prevEnd = new Date(r.start.getTime());
  const prevStart = new Date(r.start.getTime());
  prevStart.setDate(prevStart.getDate() - days);
  const prev = scope(p, { start: prevStart, end: prevEnd });
  const cur = aggregate(app, sc.where, sc.bind);
  const before = aggregate(app, prev.where, prev.bind);
  return {
    from: r.from,
    to: r.to,
    days: days,
    summary: withText(cur, money),
    previous: { from: util.dayOf(prevStart), to: util.dayOf(new Date(prevEnd.getTime() - 86400000)), net_sales: before.net_sales, sales: before.sales, average_sale: before.average_sale, profit: before.profit },
    currency: money.currency,
  };
}

const BY = ['hour', 'day', 'weekday', 'category', 'product', 'staff', 'register', 'tender', 'tax', 'discount', 'customer'];

/** Sales broken down one way: by hour, day, weekday, category, product, staff, register, tender, tax rate, discount or customer. */
function breakdown(app, e, p) {
  const util = u();
  needReports(app, e, p);
  const by = util.oneOf(p, 'by', BY, '');
  if (by === '') throw util.fail(400, 'by is required: ' + BY.join(', '));
  const r = util.range(p, 1);
  const sc = scope(p, r);
  const rows = rowsBy(app, by, sc);
  const limit = util.int(p, 'limit', 500, 1, 5000);
  return { by: by, from: r.from, to: r.to, rows: rows.slice(0, limit), more: rows.length > limit };
}

function names(db, coll, field) {
  const out = {};
  for (const r of db.findRecordsByFilter(coll, '', '', 0, 0)) out[r.id] = r.getString(field || 'name');
  return out;
}

function rowsBy(app, by, sc) {
  const util = u();
  const lineSum =
    "COALESCE(SUM(CASE WHEN l.kind != 'gift_card' THEN l.qty ELSE 0 END), 0) AS qty, COALESCE(SUM(CASE WHEN l.kind != 'gift_card' THEN l.gross - l.discount ELSE 0 END), 0) AS net_sales, " +
    "COALESCE(SUM(CASE WHEN l.kind != 'gift_card' THEN l.net ELSE 0 END), 0) AS net_ex_tax, COALESCE(SUM(CASE WHEN l.kind = 'item' AND (l.qty > 0 OR l.restock = TRUE) THEN l.unit_cost * l.qty ELSE 0 END), 0) AS cost, COALESCE(SUM(CASE WHEN l.qty > 0 AND l.kind != 'gift_card' THEN l.discount ELSE 0 END), 0) AS discounts";
  const shape = { key: '', label: '', qty: -0, net_sales: 0, net_ex_tax: 0, cost: -0, discounts: 0 };
  const finish = (x) => ({ key: x.key, label: x.label, qty: Math.round(x.qty * 1000) / 1000, net_sales: x.net_sales, net_ex_tax: x.net_ex_tax, cost: Math.round(x.cost), profit: x.net_ex_tax - Math.round(x.cost), discounts: x.discounts });
  const from = 'FROM order_lines l JOIN orders o ON o.id = l."order" WHERE ' + sc.where;
  if (by === 'category') {
    const cats = names(app, 'categories');
    return util
      .rows(app, 'SELECT l.category AS key, \'\' AS label, ' + lineSum + ' ' + from + " AND l.kind != 'gift_card' GROUP BY l.category ORDER BY net_sales DESC", shape, sc.bind)
      .map((x) => Object.assign(finish(x), { label: x.key === '' ? 'No category' : cats[x.key] || 'Removed category' }));
  }
  if (by === 'product') {
    return util
      .rows(app, "SELECT (CASE WHEN l.variant != '' THEN l.variant ELSE 'custom:' || l.name END) AS key, l.name || (CASE WHEN l.variant_title != '' THEN ' (' || l.variant_title || ')' ELSE '' END) AS label, " + lineSum + ' ' + from + " AND l.kind != 'gift_card' GROUP BY key ORDER BY net_sales DESC", shape, sc.bind)
      .map(finish);
  }
  if (by === 'tax') {
    return util
      .rows(app, "SELECT l.tax_name || ' ' || l.tax_rate AS key, l.tax_name AS label, l.tax_rate AS rate, COALESCE(SUM(l.net), 0) AS base, COALESCE(SUM(l.tax), 0) AS tax " + from + " AND l.kind != 'gift_card' GROUP BY l.tax_name, l.tax_rate ORDER BY tax DESC", { key: '', label: '', rate: -0, base: 0, tax: 0 }, sc.bind)
      .map((x) => ({ key: x.key, label: x.label === '' ? 'No tax' : x.label + ' ' + util.fmt(x.rate) + '%', rate: x.rate, base: x.base, tax: x.tax }));
  }
  if (by === 'tender') {
    return aggregate(app, sc.where, sc.bind).tenders.map((t) => ({ key: t.tender + (t.label ? ':' + t.label : ''), label: t.label, count: t.count, amount: t.amount }));
  }
  if (by === 'staff' || by === 'register' || by === 'customer') {
    const col = by === 'staff' ? 'o.closed_by' : 'o.' + by;
    const map = by === 'staff' ? names(app, 'staff') : by === 'register' ? names(app, 'registers') : names(app, 'customers');
    const empty = by === 'staff' ? 'Your AI agent' : by === 'register' ? 'No register' : 'No customer';
    return util
      .rows(
        app,
        'SELECT ' + col + ' AS key, COUNT(*) AS orders, COALESCE(SUM(o.total), 0) AS total, COALESCE(SUM(o.tip), 0) AS tips, COALESCE(SUM(o.discount_total), 0) AS discounts, COALESCE(SUM(CASE WHEN o.has_returns = TRUE THEN 1 ELSE 0 END), 0) AS returns FROM orders o WHERE ' + sc.where + ' GROUP BY ' + col + ' ORDER BY total DESC',
        { key: '', orders: 0, total: 0, tips: 0, discounts: 0, returns: 0 },
        sc.bind,
      )
      .map((x) => ({ key: x.key, label: x.key === '' ? empty : map[x.key] || 'Removed', orders: x.orders, total: x.total, average: x.orders > 0 ? Math.round(x.total / x.orders) : 0, tips: x.tips, discounts: x.discounts, returns: x.returns }));
  }
  if (by === 'discount') {
    const out = {};
    const add = (key, label, amount) => {
      if (!out[key]) out[key] = { key: key, label: label, uses: 0, amount: 0 };
      out[key].uses += 1;
      out[key].amount += amount;
    };
    for (const x of util.rows(app, "SELECT COALESCE(l.auto_discount, '') AS auto, COALESCE(l.line_discount, '') AS manual, l.discount - l.order_discount AS amount " + from + ' AND l.qty > 0 AND (l.discount - l.order_discount) > 0', { auto: '', manual: '', amount: 0 }, sc.bind)) {
      const a = parse(x.auto);
      const m = parse(x.manual);
      if (a && a.name) add('promo:' + (a.id || a.name), a.name, x.amount);
      else if (m) add('manual:' + (m.reason || ''), m.reason ? 'By hand: ' + m.reason : 'By hand', x.amount);
    }
    for (const x of util.rows(app, "SELECT COALESCE(o.applied_discount, '') AS applied FROM orders o WHERE " + sc.where + " AND COALESCE(o.applied_discount, '') NOT IN ('', 'null')", { applied: '' }, sc.bind)) {
      const d = parse(x.applied);
      if (d && d.amount > 0) add('order:' + (d.id || d.name + ':' + (d.reason || '')), d.source === 'manual' && !d.id ? 'Order, by hand' + (d.reason ? ': ' + d.reason : '') : d.name, d.amount);
    }
    return Object.keys(out)
      .map((k) => out[k])
      .sort((a, b) => b.amount - a.amount);
  }
  // Time: hour, day, weekday (local time).
  const acc = {};
  for (const x of util.rows(app, 'SELECT o.paid_at AS at, o.total AS total, o.tip AS tip, (CASE WHEN o.total >= 0 THEN 1 ELSE 0 END) AS sale FROM orders o WHERE ' + sc.where, { at: '', total: 0, tip: 0, sale: 0 }, sc.bind)) {
    const d = new Date(x.at.replace(' ', 'T'));
    const key = by === 'hour' ? String(d.getHours()) : by === 'weekday' ? String(d.getDay()) : util.dayOf(d);
    if (!acc[key]) acc[key] = { key: key, orders: 0, total: 0, tips: 0 };
    acc[key].orders += x.sale;
    acc[key].total += x.total;
    acc[key].tips += x.tip;
  }
  const keys = Object.keys(acc).sort((a, b) => (by === 'day' ? (a < b ? -1 : a > b ? 1 : 0) : Number(a) - Number(b)));
  const label = (k) => (by === 'hour' ? (k.length === 1 ? '0' : '') + k + ':00' : by === 'weekday' ? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][Number(k)] : k);
  return keys.map((k) => ({ key: k, label: label(k), orders: acc[k].orders, total: acc[k].total, tips: acc[k].tips, average: acc[k].orders > 0 ? Math.round(acc[k].total / acc[k].orders) : 0 }));
}

function parse(s) {
  if (!s || s === 'null') return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/* ----------------------------------------------------------------- export */

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) || /^[=+\-@]/.test(s) ? '"' + (/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""') + '"' : s;
}

function csv(header, rows) {
  return [header.map(csvCell).join(',')].concat(rows.map((r) => r.map(csvCell).join(','))).join('\r\n') + '\r\n';
}

/** A CSV of every sold line in the range, or of one breakdown. */
function exportCsv(app, e, p) {
  const util = u();
  needReports(app, e, p);
  const money = moneyOf(app);
  const kind = util.oneOf(p, 'kind', ['lines', 'orders'].concat(BY), 'lines');
  const r = util.range(p, 1);
  const sc = scope(p, r);
  const m = (x) => money.plain(Math.round(x));
  let text = '';
  if (kind === 'lines' || kind === 'orders') {
    const staff = names(app, 'staff');
    const regs = names(app, 'registers');
    const custs = names(app, 'customers');
    if (kind === 'orders') {
      const rows = util.rows(app, 'SELECT o.number AS number, o.paid_at AS at, o.register AS reg, o.closed_by AS staff, o.customer AS cust, o.items AS items, o.subtotal AS subtotal, o.discount_total AS discounts, o.tax_total AS tax, o.total AS total, o.tip AS tip, o.rounding AS rounding FROM orders o WHERE ' + sc.where + ' ORDER BY o.paid_at', { number: '', at: '', reg: '', staff: '', cust: '', items: -0, subtotal: 0, discounts: 0, tax: 0, total: 0, tip: 0, rounding: 0 }, sc.bind);
      text = csv(
        ['Receipt', 'Paid at', 'Register', 'Staff', 'Customer', 'Items', 'Subtotal', 'Discounts', 'Tax', 'Total', 'Tip', 'Rounding'],
        rows.map((x) => [x.number, x.at, regs[x.reg] || '', staff[x.staff] || (x.staff === '' ? 'Your AI agent' : ''), custs[x.cust] || '', x.items, m(x.subtotal), m(x.discounts), m(x.tax), m(x.total), m(x.tip), m(x.rounding)]),
      );
    } else {
      const rows = util.rows(app, 'SELECT o.number AS number, o.paid_at AS at, o.closed_by AS staff, l.kind AS kind, l.name AS name, l.variant_title AS variant, l.sku AS sku, l.qty AS qty, l.gross AS gross, l.discount AS discount, l.net AS net, l.tax AS tax, l.total AS total, l.tax_name AS tax_name, l.unit_cost AS unit_cost FROM order_lines l JOIN orders o ON o.id = l."order" WHERE ' + sc.where + ' ORDER BY o.paid_at, l.position', { number: '', at: '', staff: '', kind: '', name: '', variant: '', sku: '', qty: -0, gross: 0, discount: 0, net: 0, tax: 0, total: 0, tax_name: '', unit_cost: -0 }, sc.bind);
      text = csv(
        ['Receipt', 'Paid at', 'Staff', 'Kind', 'Item', 'Variant', 'SKU', 'Qty', 'Gross', 'Discount', 'Net', 'Tax', 'Total', 'Tax rate', 'Unit cost'],
        rows.map((x) => [x.number, x.at, staff[x.staff] || '', x.kind, x.name, x.variant, x.sku, x.qty, m(x.gross), m(x.discount), m(x.net), m(x.tax), m(x.total), x.tax_name, m(x.unit_cost)]),
      );
    }
  } else {
    const rows = rowsBy(app, kind, sc);
    if (rows.length === 0) text = csv(['Label'], []);
    else {
      const cols = Object.keys(rows[0]).filter((k) => k !== 'key');
      const moneyCols = ['net_sales', 'net_ex_tax', 'cost', 'profit', 'discounts', 'total', 'tips', 'average', 'amount', 'base', 'tax'];
      text = csv(cols, rows.map((x) => cols.map((k) => (moneyCols.indexOf(k) >= 0 ? m(x[k]) : x[k]))));
    }
  }
  return { filename: 'sales-' + kind + '-' + r.from + (r.to !== r.from ? '-to-' + r.to : '') + '.csv', csv: text, from: r.from, to: r.to };
}

/* ----------------------------------------------------------- the drawer */

/** The X (open) or Z (closed) report of a drawer session. */
function shiftReport(db, shift) {
  const util = u();
  const money = moneyOf(db);
  const sum = aggregate(db, "o.status = 'paid' AND o.shift = {:s}", { s: shift.id });
  const pays = util.rows(db, "SELECT tender, label, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS amount, COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS taken, COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) AS refunded FROM payments WHERE shift = {:s} AND status = 'captured' GROUP BY tender, label ORDER BY amount DESC", { tender: '', label: '', n: 0, amount: 0, taken: 0, refunded: 0 }, { s: shift.id });
  const moves = util.rows(db, 'SELECT kind, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS amount FROM cash_moves WHERE shift = {:s} GROUP BY kind', { kind: '', n: 0, amount: 0 }, { s: shift.id });
  const mv = (k) => moves.find((x) => x.kind === k) || { n: 0, amount: 0 };
  const cash = pays.filter((x) => x.tender === 'cash');
  const cashTaken = cash.reduce((a, x) => a + x.taken, 0);
  const cashRefunded = cash.reduce((a, x) => a + x.refunded, 0);
  const expected = shift.getInt('opening_float') + cashTaken - cashRefunded + mv('pay_in').amount - mv('pay_out').amount;
  const opened = shift.getString('opened_at');
  const closed = shift.getString('closed_at') || util.dbDate(new Date());
  const evt = (k) => db.countRecords('events', $dbx.and($dbx.exp('kind = {:k}', { k: k }), $dbx.exp('register = {:r}', { r: shift.getString('register') }), $dbx.exp('created >= {:a}', { a: opened }), $dbx.exp('created <= {:b}', { b: closed })));
  return {
    summary: withText(sum, money),
    payments: pays.map((x) => ({ tender: x.tender, label: x.label || tenderLabel(x.tender), count: x.n, amount: x.amount, taken: x.taken, refunded: x.refunded })),
    cash: {
      opening_float: shift.getInt('opening_float'),
      cash_sales: cashTaken,
      cash_refunds: cashRefunded,
      pay_ins: mv('pay_in').amount,
      pay_outs: mv('pay_out').amount,
      no_sales: mv('no_sale').n,
      expected: expected,
      expected_text: money.text(expected),
    },
    voids: { sales: evt('order_voided'), lines: evt('line_removed'), payments: evt('payment_voided') },
    open_tickets: db.countRecords('orders', $dbx.exp("status = 'open' AND register = {:r}", { r: shift.getString('register') })),
  };
}

module.exports = { aggregate: aggregate, summary: summary, breakdown: breakdown, exportCsv: exportCsv, shiftReport: shiftReport, csv: csv, csvCell: csvCell, BY: BY, tenderLabel: tenderLabel, withText: withText };
